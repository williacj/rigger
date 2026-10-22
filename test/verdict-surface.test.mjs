// ABOUTME: Tests the `verdict` verb's surface: only the CLI's verb table imports it, `--help` lists it
// as it did before it landed, and nothing it reads, an environment variable, a config key or an
// option, lets it post without asking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'acorn';

import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { PULL, assertRefused, run, world } from './verdict-world.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERB = 'src/cli/verdict.mjs';
const BOUND = { timeout: 120_000 };

/** The syntax nodes under `node`, `node` first. */
function* nodesOf(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    for (const held of Array.isArray(value) ? value : [value]) if (held && typeof held === 'object') yield* nodesOf(held);
  }
}

/**
 * The string `node` always evaluates to, where the source fixes it: a string literal, a template
 * whose every part is fixed, or a `+` of two fixed strings. Undefined anywhere else.
 */
function fixed(node) {
  if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node?.type === 'TemplateLiteral') {
    const parts = node.expressions.map(fixed);
    if (parts.some((part) => part === undefined)) return undefined;
    return node.quasis.map((quasi, at) => quasi.value.cooked + (parts[at] ?? '')).join('');
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const [left, right] = [fixed(node.left), fixed(node.right)];
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/**
 * The URL Node's ESM resolver gives `specifier`, imported by the module at `parent`, or undefined
 * where it resolves to none here. A specifier starting `/`, `./` or `../` resolves as a URL
 * against the importer's URL. Any other specifier that parses as an absolute URL, whatever its
 * scheme or the scheme's letter case, is that URL. Anything else is a bare specifier, which reaches
 * a package, and the package declares no `exports` or `imports` that could reach the verb.
 * A specifier that is not a URL at all, such as one with an escaped slash, Node refuses too.
 */
function resolved(specifier, parent) {
  try {
    if (/^\.{0,2}\//.test(specifier)) return new URL(specifier, parent);
    return new URL(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Whether the paths `one` and `other` are one file, as the filesystem identifies it: the same
 * device and inode. A file is never told apart by how its path is spelled. A filesystem that folds
 * case or normalises Unicode, as macOS's does, reaches one file by several spellings, and a
 * symbolic or hard link reaches it by another path. A path that names nothing is no file.
 */
function oneFile(one, other) {
  try {
    const [held, wanted] = [statSync(one), statSync(other)];
    return held.dev === wanted.dev && held.ino === wanted.ino;
  } catch {
    return false;
  }
}

/** Whether two `file:` URLs load one file. A `file:` URL naming a host other than this one loads nothing. */
function sameFile(url, target) {
  try {
    return oneFile(fileURLToPath(url), fileURLToPath(target));
  } catch {
    return false;
  }
}

/** Each syntax node under `node`, `node` first, with the nodes enclosing it, outermost first. */
function* withAncestors(node, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  yield [node, ancestors];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    for (const held of Array.isArray(value) ? value : [value]) if (held && typeof held === 'object') yield* withAncestors(held, [...ancestors, node]);
  }
}

/** The names a binding pattern binds. */
function boundNames(pattern) {
  switch (pattern?.type) {
    case 'Identifier': return [pattern.name];
    case 'ObjectPattern': return pattern.properties.flatMap((held) => boundNames(held.type === 'RestElement' ? held.argument : held.value));
    case 'ArrayPattern': return pattern.elements.flatMap(boundNames);
    case 'RestElement': return boundNames(pattern.argument);
    case 'AssignmentPattern': return boundNames(pattern.left);
    default: return [];
  }
}

/** Each binding under `node`, as `[name, node binding it]`: declarations, parameters, imports, functions, classes and caught errors. */
function bindingsIn(node) {
  const found = [];
  for (const [held] of withAncestors(node)) {
    if (held.type === 'VariableDeclarator') found.push(...boundNames(held.id).map((name) => [name, held]));
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(held.type)) {
      if (held.id) found.push([held.id.name, held]);
      found.push(...held.params.flatMap(boundNames).map((name) => [name, held]));
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(held.type) && held.id) found.push([held.id.name, held]);
    if (held.type === 'CatchClause') found.push(...boundNames(held.param).map((name) => [name, held]));
    if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(held.type)) found.push([held.local.name, held]);
  }
  return found;
}

/**
 * The one name `program` binds, anywhere, to export `exported` of module `from`, imported by name,
 * or undefined where it binds that name otherwise too, so a shadow could stand in for it.
 */
function soleImport(program, from, exported) {
  const declaration = program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === from);
  const local = declaration?.specifiers.find((held) => held.type === 'ImportSpecifier' && (held.imported.name ?? held.imported.value) === exported)?.local.name;
  if (local === undefined) return undefined;
  return bindingsIn(program).filter(([name]) => name === local).length === 1 ? local : undefined;
}

/** The string `module` exports as the const `name`, initialised to a string literal, or undefined. */
function exportedString(module, name) {
  for (const node of module.body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration?.type !== 'VariableDeclaration' || node.declaration.kind !== 'const') continue;
    const held = node.declaration.declarations.find((declarator) => declarator.id.type === 'Identifier' && declarator.id.name === name);
    if (held) return held.init?.type === 'Literal' && typeof held.init.value === 'string' ? held.init.value : undefined;
  }
  return undefined;
}

/**
 * Whether the dynamic `import()` `node`, in module `file` of `tree`, can load nothing but a file
 * whose name is a fixed one other than `target`'s, as the config load does:
 * `import(pathToFileURL(path))`, `path` being the one binding of its name in the function the
 * import is in, a top-level `const path = join(…, NAME)` there, with `pathToFileURL` from
 * `node:url`, `join` from `node:path` and `NAME` imported from a module of `tree` exporting it as
 * a const string that is a plain file name that is not the verb's file. Each of those names is bound once in its module, so
 * no shadow stands in for it. `path.join` ends its answer in its last argument where that is a
 * plain name, so the import loads a file of that name, whatever the directory.
 */
function loadsOnlyNamed(node, ancestors, program, file, tree, target) {
  const url = soleImport(program, 'node:url', 'pathToFileURL');
  const joined = soleImport(program, 'node:path', 'join');
  const call = node.source;
  if (url === undefined || joined === undefined || call.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.callee.name !== url) return false;
  if (call.arguments.length !== 1 || call.arguments[0].type !== 'Identifier') return false;
  const path = call.arguments[0].name;
  const fn = [...ancestors].reverse().find((held) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(held.type));
  if (fn?.body?.type !== 'BlockStatement') return false;
  const bound = bindingsIn(fn).filter(([name]) => name === path);
  if (bound.length !== 1 || bound[0][1].type !== 'VariableDeclarator') return false;
  const declarator = bound[0][1];
  const statement = fn.body.body.find((held) => held.type === 'VariableDeclaration' && held.declarations.includes(declarator));
  if (statement?.kind !== 'const' || declarator.id.type !== 'Identifier') return false;
  const init = declarator.init;
  if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier' || init.callee.name !== joined || init.arguments.length < 1) return false;
  const last = init.arguments.at(-1);
  if (last.type !== 'Identifier') return false;
  const from = program.body.find((held) => held.type === 'ImportDeclaration' && held.specifiers.some((specifier) => specifier.type === 'ImportSpecifier' && specifier.local.name === last.name));
  const imported = from?.specifiers.find((specifier) => specifier.local.name === last.name);
  if (!from || soleImport(program, from.source.value, imported.imported.name ?? imported.imported.value) !== last.name) return false;
  const exporter = resolved(from.source.value, pathToFileURL(join(ROOT, file)));
  const module = exporter?.protocol === 'file:' ? tree.get(fileURLToPath(exporter).slice(ROOT.length + 1)) : undefined;
  if (module === undefined) return false;
  const name = exportedString(parse(module, { ecmaVersion: 'latest', sourceType: 'module' }), imported.imported.name ?? imported.imported.value);
  // A plain name loads the verb only from the verb's own directory, and there only where the
  // filesystem makes that name the verb's file, so it is asked rather than the names compared.
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name) && !oneFile(join(ROOT, dirname(target), name), join(ROOT, target));
}

/**
 * The builtins a module may import without counting: those src/ imports today, each of which
 * runs no code it is handed, from a string or a path. `child_process` starts another process,
 * whose module graph is its own, so it imports nothing into the module that spawns it; and rule 7
 * of `test/layer-boundaries.mjs` lets only L0's process adapter import it. Every other builtin
 * counts, `module`, `vm`, `worker_threads`, `inspector`, `repl`, `test`, `sqlite`, `wasi` and
 * `sea` among them, and so does any builtin Node adds.
 */
const INERT_BUILTINS = ['crypto', 'events', 'fs', 'os', 'path', 'readline', 'timers/promises', 'url', 'util', 'child_process'];

/**
 * The rules of `boundaryReport` that refuse a route to code besides `import`: a loader such as
 * `createRequire` or `process.getBuiltinModule`, code built at run time by `eval`, `Function` or a
 * function's `constructor`, a native addon, a worker, an internal binding, and an import the rules
 * cannot resolve. A module breaking one may load the verb by that route, so it counts.
 */
const LOADING_RULES = ['the dynamic-import rule', 'the code-generation rule', 'the unresolved-import rule', 'rule 7'];

/**
 * Whether module `file` of `tree` imports `target`, or may. An import counts unless the check can
 * prove it loads another module:
 * - a specifier the source fixes, resolved as Node resolves it, that is a `file:` URL whose real
 *   path is not `target`'s, or a builtin;
 * - a dynamic `import()` whose specifier the source does not fix, only where `loadsOnlyNamed`
 *   proves it loads a file of another fixed name.
 * Everything else counts, a `data:` URL, another scheme and a bare specifier among them: their
 * spellings are Node's to read, and no module under src/ uses one.
 */
function imports(file, tree, target) {
  const program = parse(tree.get(file), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
  const parent = pathToFileURL(join(ROOT, file));
  const url = pathToFileURL(join(ROOT, target));
  return [...withAncestors(program)]
    .filter(([node]) => ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type) && node.source)
    .some(([node, ancestors]) => {
      const specifier = fixed(node.source);
      if (specifier === undefined) return node.type !== 'ImportExpression' || !loadsOnlyNamed(node, ancestors, program, file, tree, target);
      const found = resolved(specifier, parent);
      if (found?.protocol === 'file:') return sameFile(found, url);
      if ((found === undefined || found.protocol === 'node:') && isBuiltin(specifier)) return !INERT_BUILTINS.includes(specifier.replace(/^node:/, ''));
      return true;
    });
}

/**
 * Every module of `tree`, a map of repository path to source, that imports `target`, or may, as
 * `imports` reads each, or that reaches code by a route `LOADING_RULES` names. `target` is read too, since the verb's module importing itself is a
 * module under src/ importing it.
 */
export function importersOf(tree, target) {
  const loading = new Set(boundaryReport(tree).violations.filter((violation) => LOADING_RULES.includes(violation.rule)).map((violation) => violation.file));
  return [...tree.keys()]
    .filter((file) => /\.(?:m|c)?js$/.test(file))
    .filter((file) => loading.has(file) || imports(file, tree, target))
    .sort();
}

// proves R-VERDICT-11
test('no module under src/ but src/cli/verbs.mjs imports the verdict verb\'s module', () => {
  const tree = sourceTree(ROOT);
  assert.ok(tree.has(VERB), 'the source tree holds no verdict verb');
  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), ['src/cli/verbs.mjs']);
});

// proves R-VERDICT-11
test('a module under src/ importing the verdict verb, by a static import, a re-export or a dynamic import(), is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  tree.set('src/workflow/posts-for-the-owner.mjs', "import { verdict } from '../cli/verdict.mjs';\nexport const post = verdict;\n");
  tree.set('src/scheduling/hands-it-on.mjs', "export { verdict } from '../cli/verdict.mjs';\n");
  tree.set('src/execution/loads-it.mjs', "export const later = () => import(`../cli/./verdict.mjs`);\n");
  tree.set('src/cli/beside-it.mjs', "import * as owner from './verdict.mjs';\nexport default owner;\n");

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), [
    'src/cli/beside-it.mjs',
    'src/cli/verbs.mjs',
    'src/execution/loads-it.mjs',
    'src/scheduling/hands-it-on.mjs',
    'src/workflow/posts-for-the-owner.mjs',
  ]);
});

// proves R-VERDICT-11
test('a module under src/ importing the verdict verb through a specifier built at run time, or one the check cannot read, is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  // The judge's round-1 counterexample, appended to a module that exists.
  tree.set('src/cli/once.mjs', `${tree.get('src/cli/once.mjs')}\nexport const verdictImportedAtRuntime = () => import('./' + 'verdict.mjs');\n`);
  tree.set('src/workflow/spelled-in-parts.mjs', "export const later = () => import(`../cli/${'verdict'}.mjs`);\n");
  tree.set('src/scheduling/by-name.mjs', 'export const later = (name) => import(name);\n');
  tree.set('src/execution/joined.mjs', "export const later = () => import(['..', 'cli', 'verdict.mjs'].join('/'));\n");

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), [
    'src/cli/once.mjs',
    'src/cli/verbs.mjs',
    'src/execution/joined.mjs',
    'src/scheduling/by-name.mjs',
    'src/workflow/spelled-in-parts.mjs',
  ]);
});

// proves R-VERDICT-11
test('the verdict verb\'s module importing itself is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  // The judge's round-2 counterexample: the verb's own module, as an importer of itself.
  tree.set(VERB, `${tree.get(VERB)}\nexport const loadSelf = () => import('./verdict.mjs');\n`);

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), ['src/cli/verbs.mjs', VERB]);
});

// proves R-VERDICT-11
test('a module under src/ importing the verdict verb by a specifier carrying a query, a fragment, an escape or a file URL is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  // The judge's round-3 counterexample, appended to a module that exists.
  tree.set('src/cli/once.mjs', `${tree.get('src/cli/once.mjs')}\nexport { verdict as judged } from './verdict.mjs?judge';\n`);
  tree.set('src/workflow/by-fragment.mjs', "import { verdict } from '../cli/verdict.mjs#owner';\nexport default verdict;\n");
  tree.set('src/scheduling/escaped.mjs', "export const later = () => import('../cli/verd%69ct.mjs');\n");
  tree.set('src/execution/by-url.mjs', `import * as owner from ${JSON.stringify(pathToFileURL(join(ROOT, VERB)).href)};\nexport default owner;\n`);

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), [
    'src/cli/once.mjs',
    'src/cli/verbs.mjs',
    'src/execution/by-url.mjs',
    'src/scheduling/escaped.mjs',
    'src/workflow/by-fragment.mjs',
  ]);
});

// proves R-VERDICT-11
test('a module under src/ importing the verdict verb by any spelling Node resolves to it, a scheme in any case, a URL with a host, an absolute path or a data: URL importing it, is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  const url = pathToFileURL(join(ROOT, VERB));
  const exported = `export * from ${JSON.stringify(url.href)};`;
  const spelled = (specifier) => `export const later = () => import(${JSON.stringify(specifier)});\n`;
  // The judge's round-4 counterexample, appended to a module that exists.
  tree.set('src/cli/once.mjs', `${tree.get('src/cli/once.mjs')}\n${spelled(url.href.replace(/^file:/, 'FILE:'))}`);
  tree.set('src/workflow/mixed-case.mjs', spelled(url.href.replace(/^file:/, 'FiLe:')));
  tree.set('src/scheduling/with-host.mjs', spelled(`file://localhost${url.pathname}`));
  tree.set('src/execution/one-slash.mjs', spelled(`file:${url.pathname}`));
  tree.set('src/observation/absolute-path.mjs', spelled(join(ROOT, VERB)));
  tree.set('src/improvement/by-data.mjs', spelled(`data:text/javascript,${encodeURIComponent(exported)}`));
  tree.set('src/config/by-base64.mjs', spelled(`data:text/javascript;base64,${Buffer.from(exported).toString('base64')}`));

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), [
    'src/cli/once.mjs',
    'src/cli/verbs.mjs',
    'src/config/by-base64.mjs',
    'src/execution/one-slash.mjs',
    'src/improvement/by-data.mjs',
    'src/observation/absolute-path.mjs',
    'src/scheduling/with-host.mjs',
    'src/workflow/mixed-case.mjs',
  ]);
});

// proves R-VERDICT-11
test('a module under src/ importing the verdict verb through a symbolic link to it is named by the check above, and so is one naming another host, which the rules cannot resolve', (t) => {
  const tree = new Map(sourceTree(ROOT));
  const linked = join(temporaryDirectory('rigger-verdict-link-', { context: t }), 'owner.mjs');
  symlinkSync(join(ROOT, VERB), linked);
  tree.set('src/workflow/through-a-link.mjs', `export const later = () => import(${JSON.stringify(pathToFileURL(linked).href)});\n`);
  tree.set('src/scheduling/elsewhere.mjs', `export const later = () => import(${JSON.stringify(`file://elsewhere.example${pathToFileURL(join(ROOT, VERB)).pathname}`)});\n`);

  // Node refuses a `file:` URL naming another host, but the layer-boundary rules cannot resolve it,
  // and an import they cannot resolve counts.
  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), ['src/cli/verbs.mjs', 'src/scheduling/elsewhere.mjs', 'src/workflow/through-a-link.mjs']);
});

// proves R-VERDICT-11
test('a module under src/ importing anything the check cannot prove is a module other than the verb, a data: URL in any spelling, another scheme or a bare specifier that is no builtin, is named by the check above', () => {
  const tree = new Map(sourceTree(ROOT));
  const exported = Buffer.from(`export * from ${JSON.stringify(pathToFileURL(join(ROOT, VERB)).href)};`).toString('base64');
  const spelled = (specifier) => `export const later = () => import(${JSON.stringify(specifier)});\n`;
  // The judge's round-5 counterexample, appended to a module that exists.
  tree.set('src/cli/once.mjs', `${tree.get('src/cli/once.mjs')}\n${spelled(`data:text/javascript;BASE64,${exported}`)}`);
  tree.set('src/workflow/mixed-base64.mjs', spelled(`data:text/javascript;BaSe64,${exported}`));
  tree.set('src/scheduling/over-https.mjs', spelled('https://example.invalid/src/cli/verdict.mjs'));
  tree.set('src/execution/package-import.mjs', "import { verdict } from '#owner-verdict';\nexport default verdict;\n");
  tree.set('src/observation/package-name.mjs', "export * from '@williacj/rigger/src/cli/verdict.mjs';\n");
  // A builtin, by either spelling, is no module of this repository.
  tree.set('src/config/builtins.mjs', "import { join } from 'node:path';\nimport { readFileSync } from 'fs';\nexport { join, readFileSync };\n");

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), [
    'src/cli/once.mjs',
    'src/cli/verbs.mjs',
    'src/execution/package-import.mjs',
    'src/observation/package-name.mjs',
    'src/scheduling/over-https.mjs',
    'src/workflow/mixed-base64.mjs',
  ]);
});

/** `src/cli/doctor.mjs` with its config path's declaration replaced by `declared`. */
function doctorDeclaring(declared) {
  const source = sourceTree(ROOT).get('src/cli/doctor.mjs');
  const original = '  const path = join(target, CONFIG);\n';
  assert.equal(source.split(original).length, 2, 'doctor.mjs declares its config path other than once, as this test expects');
  return source.replace(original, declared);
}

// proves R-VERDICT-11
test('doctor\'s config load is admitted only while it can load nothing but a file named rigger.config.mjs', () => {
  const routes = {
    // The judge's round-5 counterexample: only the path's declaration changed.
    'a path chosen by the target': "  const path = target.endsWith('/judge-verdict') ? join(dirname(fileURLToPath(import.meta.url)), 'verdict.mjs') : join(target, CONFIG);\n",
    'a path joined past the config': "  const path = join(target, CONFIG, '..', 'src', 'cli', 'verdict.mjs');\n",
    'a path joined to another name': "  const path = join(target, 'verdict.mjs');\n",
    'a path that can be reassigned': "  let path = join(target, CONFIG);\n  if (target.endsWith('/judge-verdict')) path = fileURLToPath(new URL('./verdict.mjs', import.meta.url));\n",
    'a path made by another call that ends in CONFIG': "  const path = String(new URL('./verdict.mjs', import.meta.url).pathname, CONFIG);\n",
    'a path shadowed where it is loaded': "  const path = join(target, CONFIG);\n  { const path = fileURLToPath(new URL('./verdict.mjs', import.meta.url)); void path; }\n",
  };
  for (const [route, declared] of Object.entries(routes)) {
    const tree = new Map(sourceTree(ROOT));
    tree.set('src/cli/doctor.mjs', doctorDeclaring(declared));
    assert.ok(importersOf(tree, VERB).includes('src/cli/doctor.mjs'), `doctor.mjs with ${route} is not named`);
  }
  // The name doctor joins last, `CONFIG` from init.mjs, made the verb's name, or a path to it.
  // `cli/verdict.mjs` names no file beside the verb, but joined to the package's `src` directory it is the verb.
  for (const name of ['verdict.mjs', '../cli/verdict.mjs', '..', 'cli/verdict.mjs']) {
    const tree = new Map(sourceTree(ROOT));
    const init = tree.get('src/cli/init.mjs');
    assert.equal(init.split("export const CONFIG = 'rigger.config.mjs';").length, 2, 'init.mjs exports CONFIG other than once, as this test expects');
    tree.set('src/cli/init.mjs', init.replace("export const CONFIG = 'rigger.config.mjs';", `export const CONFIG = ${JSON.stringify(name)};`));
    assert.ok(importersOf(tree, VERB).includes('src/cli/doctor.mjs'), `doctor.mjs joining CONFIG ${JSON.stringify(name)} is not named`);
  }
  // The control: the declaration as it stands is admitted.
  const tree = new Map(sourceTree(ROOT));
  tree.set('src/cli/doctor.mjs', doctorDeclaring('  const path = join(target, CONFIG);\n'));
  assert.ok(!importersOf(tree, VERB).includes('src/cli/doctor.mjs'));
});

/** Whether the filesystem makes `spelled`, a path, the verb's own file: the same device and inode. */
const isVerbFile = (spelled) => {
  try {
    const [one, other] = [statSync(spelled), statSync(join(ROOT, VERB))];
    return one.dev === other.dev && one.ino === other.ino;
  } catch {
    return false;
  }
};

/**
 * Every route by which a judge made a module under src/ import the verb past this check, rounds
 * 1 to 6 on #810, each as the module it changes and the source it gives that module. A direct
 * unresolved import is named conservatively; a fixed CONFIG filename is named only where it aliases.
 */
function judgedEscapes() {
  const tree = sourceTree(ROOT);
  const url = pathToFileURL(join(ROOT, VERB)).href;
  const appended = (file, line) => `${tree.get(file)}\n${line}\n`;
  const doctor = tree.get('src/cli/doctor.mjs');
  const init = tree.get('src/cli/init.mjs');
  return [
    { round: 1, route: 'a specifier built by +', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', "export const escape = () => import('./' + 'verdict.mjs');") },
    { round: 2, route: 'the verb importing itself', file: VERB, source: appended(VERB, "export const escape = () => import('./verdict.mjs');") },
    { round: 3, route: 'a query on the specifier', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', "export { verdict as escape } from './verdict.mjs?judge';") },
    { round: 4, route: 'an uppercase FILE: scheme', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', `export const escape = () => import(${JSON.stringify(url.replace(/^file:/, 'FILE:'))});`) },
    { round: 5, route: 'an uppercase ;BASE64 data: URL', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', `export const escape = () => import(${JSON.stringify(`data:text/javascript;BASE64,${Buffer.from(`export * from ${JSON.stringify(url)};`).toString('base64')}`)});`) },
    { round: 5, route: 'doctor\'s config path chosen by the target', file: 'src/cli/doctor.mjs', source: doctor.replace('  const path = join(target, CONFIG);\n', "  const path = target.endsWith('/judge-verdict') ? join(dirname(fileURLToPath(import.meta.url)), 'verdict.mjs') : join(target, CONFIG);\n") },
    { round: 6, route: 'a dynamic import of the verb\'s name in another case', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', "export const escape = () => import('./Verdict.mjs');") },
    { round: 6, route: 'a static import of the verb\'s name in another case', file: 'src/cli/once.mjs', source: appended('src/cli/once.mjs', "export * from './VERDICT.mjs';") },
    { round: 6, route: 'doctor joining CONFIG spelled as the verb\'s name in another case', file: 'src/cli/doctor.mjs', changes: 'src/cli/init.mjs', source: init.replace("export const CONFIG = 'rigger.config.mjs';", "export const CONFIG = 'Verdict.mjs';"), aliased: join(ROOT, 'src/cli/Verdict.mjs') },
  ];
}

// proves R-VERDICT-11
test('every route by which a judge made a module under src/ import the verb past the check, rounds 1 to 6, is named by the check above', () => {
  for (const { round, route, file, changes = file, source, aliased } of judgedEscapes()) {
    const tree = new Map(sourceTree(ROOT));
    assert.notEqual(source, tree.get(changes), `round ${round}, ${route}: the fixture changed nothing`);
    tree.set(changes, source);
    // A direct import is named even when its other-case path is unresolved. Doctor's sanctioned
    // fixed CONFIG filename is named only where the filesystem makes that name the verb's file.
    const isNamed = aliased === undefined || isVerbFile(aliased);
    assert.equal(importersOf(tree, VERB).includes(file), isNamed, `round ${round}, ${route}: ${file} is ${isNamed ? 'not ' : ''}named`);
  }
});

/**
 * Each route Node 26 gives a module to have code it names run in this process, besides `import`:
 * a loader, a module that compiles or evaluates code, a native addon, and a global that turns a
 * string into code. Each is written as the module would use it to reach the verb.
 */
const LOADER_ROUTES = {
  'module.createRequire, the judge\'s round-7 route': "import { createRequire } from 'node:module';\nexport const escape = () => createRequire(import.meta.url)('./verdict.mjs');",
  'module.register, a module hook': "import { register } from 'module';\nexport const escape = () => register('./verdict.mjs', import.meta.url);",
  'module.registerHooks': "import * as modules from 'node:module';\nexport const escape = () => modules.registerHooks({});",
  'process.getBuiltinModule': "export const escape = () => process.getBuiltinModule('node:module').createRequire(import.meta.url)('./verdict.mjs');",
  'process.mainModule': "export const escape = () => process.mainModule?.require('./verdict.mjs');",
  'node:vm': "import vm from 'node:vm';\nexport const escape = () => vm.runInThisContext(\"import('./verdict.mjs')\");",
  'eval': "export const escape = () => eval(\"import('./verdict.mjs')\");",
  'the Function constructor': "export const escape = () => new Function(\"return import('./verdict.mjs')\")();",
  'a function\'s constructor': "export const escape = () => (async () => {}).constructor(\"return import('./verdict.mjs')\")();",
  'node:worker_threads': "import { Worker } from 'node:worker_threads';\nexport const escape = () => new Worker(new URL('./verdict.mjs', import.meta.url));",
  'node:inspector': "import { Session } from 'node:inspector';\nexport const escape = () => new Session();",
  'node:inspector/promises': "import { Session } from 'node:inspector/promises';\nexport const escape = () => new Session();",
  'node:repl': "import repl from 'node:repl';\nexport const escape = () => repl.start();",
  'node:test\'s mock.module': "import { mock } from 'node:test';\nexport const escape = () => mock.module('./verdict.mjs');",
  'node:sqlite\'s extensions': "import { DatabaseSync } from 'node:sqlite';\nexport const escape = () => new DatabaseSync(':memory:', { allowExtension: true });",
  'node:wasi': "import { WASI } from 'node:wasi';\nexport const escape = () => new WASI({ version: 'preview1' });",
  'node:sea': "import { getAsset } from 'node:sea';\nexport const escape = getAsset;",
  'process.dlopen, a native addon': "export const escape = () => process.dlopen({ exports: {} }, './verdict.node');",
  'process.binding': "export const escape = () => process.binding('contextify');",
};

// proves R-VERDICT-11
test('a module under src/ using any route Node 26 gives it to run code it names, besides import, is named by the check above', () => {
  for (const [route, line] of Object.entries(LOADER_ROUTES)) {
    const tree = new Map(sourceTree(ROOT));
    tree.set('src/cli/once.mjs', `${tree.get('src/cli/once.mjs')}\n${line}\n`);
    assert.ok(importersOf(tree, VERB).includes('src/cli/once.mjs'), `src/cli/once.mjs using ${route} is not named`);
  }
  // The control: every builtin src/ imports today, by either spelling, names no module.
  const tree = new Map(sourceTree(ROOT));
  tree.set('src/config/builtins-used.mjs', ['node:crypto', 'node:events', 'node:fs', 'node:os', 'node:path', 'node:readline', 'node:timers/promises', 'node:url', 'node:util', 'fs', 'path']
    .map((specifier, at) => `import * as used${at} from ${JSON.stringify(specifier)};\nexport { used${at} };`).join('\n'));
  assert.ok(!importersOf(tree, VERB).includes('src/config/builtins-used.mjs'));
});

/** The rule-5 violations `boundaryReport` finds in the tree with `file` holding `appended` after its source. */
function rule5(file, appended) {
  const tree = sourceTree(ROOT);
  tree.set(file, `${tree.get(file) ?? ''}\n${appended}\n`);
  return boundaryReport(tree).violations.filter((violation) => violation.rule === 'rule 5').map((violation) => violation.file);
}

test('rule 5 admits the verdict verb by its path, to the repository-write side alone', () => {
  // The verb itself breaks nothing, as the source tree stands.
  assert.deepEqual(rule5(VERB, ''), []);
  // Another verb beside it importing the repository-write side still breaks rule 5.
  assert.deepEqual(rule5('src/cli/once.mjs', "import { repositoryWriteSide } from '../substrate/forge/repository-write.mjs';"), ['src/cli/once.mjs']);
  // And the verb importing the item-write side breaks it too.
  assert.deepEqual(rule5(VERB, "import { itemWriteSide } from '../substrate/forge/item-write.mjs';"), [VERB]);
});

/** What `rigger` prints and exits with for `args`, run from a directory that is no repository. */
function rigger(...args) {
  const ran = spawnSync(process.execPath, [join(ROOT, 'src', 'cli', 'rigger.mjs'), ...args], { encoding: 'utf8', cwd: dirname(ROOT) });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

test('`rigger --help` lists verdict with the text it had before the verb landed', () => {
  const shown = rigger('--help');

  assert.equal(shown.status, 0, shown.err);
  // The text at the base, `a8335de`, written out rather than read from the verb table.
  assert.ok(shown.out.split('\n').some((line) => /^ {2}verdict +post your verdict on a pull request, once you confirm it$/.test(line)), shown.out);
});

test('`rigger verdict` no longer answers "not yet implemented"', () => {
  for (const args of [[], [String(PULL), 'sound']]) {
    const ran = rigger('verdict', ...args);

    assert.notEqual(ran.status, 0);
    assert.doesNotMatch(ran.out + ran.err, /not yet implemented/);
    assert.match(ran.err, /^rigger verdict: /);
  }
});

/** The verb's module, parsed. */
const verbProgram = () => parse(readFileSync(join(ROOT, VERB), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });

// proves R-VERDICT-9
test('src/cli/verdict.mjs reads no environment variable', () => {
  const nodes = [...nodesOf(verbProgram())];
  const env = nodes.filter((node) => (node.type === 'Identifier' && node.name === 'env') || (node.type === 'Literal' && node.value === 'env')
    || (node.type === 'MemberExpression' && node.property.type === 'Identifier' && node.property.name === 'env'));
  assert.deepEqual(env.map((node) => node.start), []);
  // `process` is reached for its working directory and its standard input and output alone.
  const reached = nodes.filter((node) => node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'process').map((node) => node.property.name);
  assert.deepEqual([...new Set(reached)].sort(), ['cwd', 'stdin', 'stdout']);
});

// proves R-VERDICT-9
test('src/cli/verdict.mjs takes no option but the words after the verb, and reads no config key but the repository', () => {
  const nodes = [...nodesOf(verbProgram())];
  const exported = nodes.find((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'verdict').declaration;
  const [parameter] = exported.params;
  assert.equal(exported.params.length, 1);
  assert.deepEqual(parameter.left.properties.map((property) => property.key.name), ['args']);
  // A config is read as `config` or as the default branch's `main.config`; only `repo` is read of
  // either here, and the topic rule through `worktreeTopic`, as the gate reads it.
  const keys = nodes.filter((node) => node.type === 'MemberExpression' && ((node.object.type === 'Identifier' && node.object.name === 'config')
    || (node.object.type === 'MemberExpression' && node.object.property.name === 'config'))).map((node) => node.property.name);
  assert.deepEqual([...new Set(keys)], ['repo']);
});

// proves R-VERDICT-9, R-VERDICT-10
test('no environment variable a session or a scheduler sets lets the verb post a piped y without asking', BOUND, () => {
  const where = world();
  const before = where.comments();
  where.env = { ...where.env, CI: 'true', YES: '1', RIGGER_YES: '1', RIGGER_CONFIRM: 'y', FORCE: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };

  const ran = run(where, [String(PULL), 'sound'], { stdin: { text: 'y\n' } });

  assertRefused(where, ran, before, /no terminal to ask on/);
});
