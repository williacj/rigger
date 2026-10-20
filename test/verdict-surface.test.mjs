// ABOUTME: Tests the `verdict` verb's surface: only the CLI's verb table imports it, `--help` lists it
// as it did before it landed, and nothing it reads, an environment variable, a config key or an
// option, lets it post without asking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Whether two `file:` URLs load one module. Node loads a module by its real path, so a path
 * reaching the file through a symbolic link loads it too. A path that does not exist, or a
 * `file:` URL naming a host other than this one, loads nothing, so names no file.
 */
function sameFile(url, target) {
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(fileURLToPath(target));
  } catch {
    return false;
  }
}

/** The source text a `data:` URL holds, as Node reads a JavaScript module from one. */
function dataSource(url) {
  const comma = url.pathname.indexOf(',');
  const head = url.pathname.slice(0, comma);
  const body = url.href.slice(url.href.indexOf(',') + 1);
  return head.endsWith(';base64') ? Buffer.from(decodeURIComponent(body), 'base64').toString('utf8') : decodeURIComponent(body);
}

/**
 * Whether the module `source`, at `parent`, imports the file at `target`'s URL, or may: a static
 * import, a re-export, or a dynamic `import()`, each specifier evaluated where the source fixes it
 * and resolved as Node resolves it. A `file:` URL names the file its path names, whatever its
 * query, fragment, host or escapes. A `data:` URL holds a module of its own, whose imports are
 * read the same way. A dynamic `import()` whose specifier the source does not fix could name
 * `target`, so it counts, unless `exempted` admits it by its line.
 */
function imports(source, parent, target, exempted = () => false) {
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
  const named = [...nodesOf(program)].filter((node) => ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type) && node.source);
  return named.some((node) => {
    const specifier = fixed(node.source);
    if (specifier === undefined) return node.type === 'ImportExpression' && !exempted(node.loc.start.line);
    const url = resolved(specifier, parent);
    if (url?.protocol === 'file:') return sameFile(url, target);
    if (url?.protocol === 'data:') return imports(dataSource(url), url, target);
    return false;
  });
}

/**
 * Every module of `tree`, a map of repository path to source, that imports `target`, or may, as
 * `imports` reads each. `target` is read too, since the verb's module importing itself is a
 * module under src/ importing it. The one unfixed `import()` admitted is the config load
 * `boundaryReport` exempts, which loads the consumer's config.
 */
export function importersOf(tree, target) {
  const exempt = boundaryReport(tree).exempt;
  const url = pathToFileURL(join(ROOT, target));
  return [...tree]
    .filter(([file]) => /\.(?:m|c)?js$/.test(file))
    .filter(([file, source]) => imports(source, pathToFileURL(join(ROOT, file)), url, (line) => exempt.some((held) => held.file === file && held.line === line)))
    .map(([file]) => file)
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
test('a module under src/ importing the verdict verb through a symbolic link to it is named by the check above, and one naming another host is not', (t) => {
  const tree = new Map(sourceTree(ROOT));
  const linked = join(temporaryDirectory('rigger-verdict-link-', { context: t }), 'owner.mjs');
  symlinkSync(join(ROOT, VERB), linked);
  tree.set('src/workflow/through-a-link.mjs', `export const later = () => import(${JSON.stringify(pathToFileURL(linked).href)});\n`);
  tree.set('src/scheduling/elsewhere.mjs', `export const later = () => import(${JSON.stringify(`file://elsewhere.example${pathToFileURL(join(ROOT, VERB)).pathname}`)});\n`);

  assert.deepEqual(importersOf(tree, VERB).filter((file) => file.startsWith('src/')), ['src/cli/verbs.mjs', 'src/workflow/through-a-link.mjs']);
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
