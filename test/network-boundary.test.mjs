// ABOUTME: Refuses unreviewed protected-name mentions and network routes in the production import closure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { parse } from 'acorn';

// proves R-SAFE-2
test('P1 to P6: unreviewed mentions are refused in every static name form on their cooked value', () => {
  const classes = [
    ['P1', ['runCommand']],
    ['P2', ['child_process', 'node:child_process', 'childProcess', 'spawn', 'spawnSync', 'execFile']],
    ['P3', ['env', 'environment', 'gitEnvironment']],
    ['P4', ['env']], // process.env is gated by the env member, as Table P specifies.
    ['P5', ['URL', '__proto__']],
    ['P6', ['stepAnswer', 'stepDispatch', 'dispatchStep', 'provisioning', 'step', 'run', 'command']],
  ];
  const forms = [
    ['binding identifier', (name) => `const ${name} = 0;`, true],
    ['reference identifier', (name) => `function local(${name}) { return ${name}; }`, true],
    ['escaped identifier', (name) => `const \\u${name.charCodeAt(0).toString(16).padStart(4, '0')}${name.slice(1)} = 0;`, true],
    ['dotted member', (name) => `const holder = {}; holder.${name};`, true],
    ['computed string member', (name) => `const holder = {}; holder[${JSON.stringify(name)}];`],
    ['computed template member', (name) => `const holder = {}; holder[\`${name}\`];`],
    ['optional member', (name) => `const holder = {}; holder?.[${JSON.stringify(name)}];`],
    ['object key', (name) => `const holder = { ${JSON.stringify(name)}: 0 };`],
    ['destructuring key', (name) => `const { ${JSON.stringify(name)}: local } = {};`],
    ['class field', (name) => `class Holder { [${JSON.stringify(name)}] = 0; }`],
    ['class method', (name) => `class Holder { [${JSON.stringify(name)}]() {} }`],
    ['imported name', (name) => `import { ${JSON.stringify(name)} as local } from 'node:path';`],
    ['import binding', (name) => `import { value as ${name} } from 'node:path';`, true],
    ['exported name', (name) => `const local = 0; export { local as ${JSON.stringify(name)} };`],
    ['re-exported name', (name) => `export { ${JSON.stringify(name)} as local } from 'node:path';`],
    ['module specifier', (name) => `import ${JSON.stringify(name)};`],
    ['string literal', (name) => `${JSON.stringify(name)};`],
    ['template literal', (name) => `\`${name}\`;`],
    ['escaped string', (name) => `'\\x${name.charCodeAt(0).toString(16)}${name.slice(1)}';`],
    ['escaped template', (name) => `\`\\x${name.charCodeAt(0).toString(16)}${name.slice(1)}\`;`],
  ];
  const missed = [];
  for (const [group, names] of classes) for (const name of names) for (const [form, make, identifier] of forms) {
    if (identifier && !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const source = make(name);
    const report = networkReport(() => source, ['fixture.mjs'], []);
    if (!report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes(JSON.stringify(name)))) missed.push(`${group} / ${name} / ${form}`);
  }
  assert.deepEqual(missed, [], 'Every unreviewed protected mention must name its file, line and cooked name');
  assert.deepEqual(networkReport(() => '// env runCommand URL\n"prefix env suffix"; `environment suffix`;', ['fixture.mjs'], []).violations, [], 'Comments and literals with a different cooked value are not mentions');
});

// proves R-SAFE-2
test('P reviewed lines: only the exact text and independently counted mentions are admitted', () => {
  for (const [text, mentions] of [
    ['const env = {};', 1],
    ['const env = {}; const holder = { env };', 2],
    ['const { env: environment } = {};', 2],
    ["import { env } from 'node:path';", 1],
    ['const env = 0; export { env };', 2],
    ["'\\x65nv';", 1],
    ['`\\x65nv`;', 1],
    ['class Holder { #env = 0; value() { return this.#env; } }', 2],
    ['const childProcess = {}; const holder = { get spawn() { return childProcess.spawn; } };', 4],
  ]) {
    const site = { file: 'fixture.mjs', text, mentions, line: 1, reason: 'An independently counted mention fixture.' };
    assert.deepEqual(networkReport(() => text, ['fixture.mjs'], [site]).violations, [], `The reviewed line admits its ${mentions} source occurrences: ${text}`);
    const wrong = networkReport(() => text, ['fixture.mjs'], [{ ...site, mentions: mentions + 1 }]);
    assert.ok(wrong.violations.some((line) => line.startsWith('fixture.mjs:1 P ')), `A wrong declared mention count refuses ${text}`);
  }
});

// proves R-SAFE-2
test('P missing entries: a reviewed line absent from the closure refuses its inventory entry', () => {
  const site = { file: 'fixture.mjs', text: 'process.env;', mentions: 1, line: 1, reason: 'The fixture engine environment read.' };
  for (const source of ['process.version;', '// process.env;']) {
    const report = networkReport(() => source, ['fixture.mjs'], [site]);
    assert.ok(report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes('entry 1') && line.includes(site.text)), `A missing reviewed entry is refused even after its last protected mention is removed: ${source}`);
  }
  const outside = networkReport(() => '0;', ['fixture.mjs'], [{ ...site, file: 'outside.mjs' }]);
  assert.ok(outside.violations.some((line) => line.startsWith('outside.mjs:1 P ') && line.includes('entry 1')), 'An inventory entry outside the reached closure is also missing');
});

// proves R-SAFE-2
test('P duplicate lines: each inventory entry admits exactly one source occurrence', () => {
  const site = { file: 'fixture.mjs', text: 'process.env;', mentions: 1, line: 1, reason: 'One fixture engine environment read.' };
  const report = networkReport(() => 'process.env;\nprocess.env;', ['fixture.mjs'], [site]);
  assert.ok(report.violations.some((line) => line.startsWith('fixture.mjs:2 P ') && line.includes('"env"')), 'The duplicate line needs its own reviewed entry');
  assert.deepEqual(networkReport(() => 'process.env;\nprocess.env;', ['fixture.mjs'], [site, { ...site, line: 2 }]).violations, [], 'Two identical source lines require two entries');
  assert.deepEqual(networkReport(() => '\nprocess.env;', ['fixture.mjs'], [site]).violations, [], 'The stored line number is a missing-entry diagnostic, never an admission condition');
});

// proves R-SAFE-2
test('P changed lines: changing one character of a reviewed source line is refused', () => {
  const site = { file: 'fixture.mjs', text: 'const env = 0;', mentions: 1, line: 1, reason: 'The fixture environment declaration.' };
  const report = networkReport(() => 'const env = 1;', ['fixture.mjs'], [site]);
  assert.ok(report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes('"env"')), 'One changed character invalidates the exact reviewed line');
});

// proves R-SAFE-2
test('N1 and N2: the closure refuses unlisted built-ins through imports, re-exports and literal imports', () => {
  for (const specifier of ['node:https', 'node:child_process', 'http', 'dns/promises', 'node:dns/promises', '_http_client', '_http_agent', '_tls_wrap', 'inspector', 'node:quic', 'module', 'cluster', 'vm', 'worker_threads']) {
    for (const source of [`import '${specifier}';`, `export * from '${specifier}';`, `import('${specifier}');`]) {
      const report = networkReport(() => source, ['fixture.mjs']);
      assert.ok(report.violations.some((line) => line.includes('fixture.mjs:1') && line.includes('N1') && line.includes(specifier)), `N1 must refuse ${source}: ${report.violations.join('\n')}`);
    }
  }
  assert.deepEqual(networkReport(() => "import 'fs'; import 'node:fs';", ['fixture.mjs']).violations, []);
  const nativeImport = "import 'node:child_process';";
  assert.deepEqual(networkReport(() => nativeImport, ['src/substrate/host.mjs'], [{ file: 'src/substrate/host.mjs', text: nativeImport, mentions: 1, line: 1, reason: 'The native import control is confined to the real host.' }]).violations, []);
  const tree = new Map([
    ['entry.mjs', "import './static.mjs'; export * from './exported.mjs'; import('./literal.mjs');"],
    ['static.mjs', "import './entry.mjs'; import 'node:net';"],
    ['exported.mjs', "export * from 'node:tls';"],
    ['literal.mjs', "import('node:http2');"],
  ]);
  const report = networkReport((file) => tree.get(file), ['entry.mjs']);
  for (const file of ['static.mjs', 'exported.mjs', 'literal.mjs']) {
    assert.ok(report.violations.some((line) => line.startsWith(`${file}:1 N1`)), `the closure must follow ${file}: ${report.violations.join('\n')}`);
  }
});

/** Built-ins in the reviewed closure, each admitted for the operation it supplies. */
const BUILTINS = new Map([
  ['node:child_process', 'OS process starts and reads, only in the real host.'],
  ['node:crypto', 'Hashes and dispatch identifiers.'],
  ['node:events', 'Local event and child-process lifecycle coordination.'],
  ['node:fs', 'Local files and directory metadata.'],
  ['node:os', 'The account home directory.'],
  ['node:path', 'Filesystem path construction and comparison.'],
  ['node:readline', 'The terminal confirmation input.'],
  ['node:timers/promises', 'The real host clock pause.'],
  ['node:url', 'File URL conversion and parsing.'],
  ['node:util', 'Inspection and plain-data type checks.'],
]);

/** Table P gates the first mention of a capability, before any alias can be made. */
const PROTECTED_NAMES = new Map([
  ['runCommand', 'P1: the L0 process starter.'],
  ['child_process', 'P2: the bare native-process module specifier.'],
  ['node:child_process', 'P2: the native-process module specifier.'],
  ['childProcess', 'P2: the reviewed native-process namespace.'],
  ['spawn', 'P2: the asynchronous native process start.'],
  ['spawnSync', 'P2: the synchronous native process start.'],
  ['execFile', 'P2: the native program reader.'],
  ['env', 'P3/P4: dispatch options and the engine process.env member.'],
  ['environment', 'P3: the environment prepared for a dispatch.'],
  ['gitEnvironment', 'P3: the engine-environment copier used by git and dispatch.'],
  ['URL', 'P5: the URL constructor gates every route to its prototype.'],
  ['__proto__', 'P5: the ordinary prototype member.'],
  ['stepAnswer', 'P6: the L2 configured-step producer.'],
  ['stepDispatch', 'P6: the configured step to shell-input adapter.'],
  ['dispatchStep', 'P6: the L3 configured-step dispatch helper.'],
  ['provisioning', 'P6: the declared configured-step collection.'],
  ['step', 'P6: the configured step and its selectors.'],
  ['run', 'P6: the configured command line and reviewed execution functions.'],
  ['command', 'P6: the program selected for an execution.'],
]);

/** Count source occurrences once, including shorthand nodes Acorn exposes in two roles. */
function protectedMentions(program) {
  const found = new Map();
  for (const { node } of nodes(program)) {
    const name = ['Identifier', 'PrivateIdentifier'].includes(node.type) ? node.name
      : node.type === 'Literal' && typeof node.value === 'string' ? node.value
        : node.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;
    if (PROTECTED_NAMES.has(name)) found.set(`${node.start}:${node.end}`, { name, line: node.loc.start.line });
  }
  return [...found.values()];
}

/** Every protected mention is refused until its exact source line is reviewed. */
function mentionReport(modules, sites) {
  const violations = [];
  const used = new Set();
  for (const [file, { program, source }] of modules) {
    const lines = source.split(/\r\n|[\r\n\u2028\u2029]/);
    const mentions = new Map();
    for (const { name, line } of protectedMentions(program)) {
      if (!mentions.has(line)) mentions.set(line, []);
      mentions.get(line).push(name);
    }
    for (const [line, names] of mentions) {
      const index = sites.findIndex((entry, index) => !used.has(index) && entry.file === file && entry.text === lines[line - 1] && entry.mentions === names.length);
      if (index === -1) for (const name of new Set(names)) violations.push(`${file}:${line} P refuses ${JSON.stringify(name)}`);
      else used.add(index);
    }
  }
  sites.forEach((entry, index) => {
    if (!used.has(index)) violations.push(`${entry.file}:${entry.line} P missing inventory entry ${index + 1}: ${entry.text}`);
  });
  return violations;
}

/** Syntax descendants, including imports nested inside a function. */
function* nodes(node, parent = null, owner = '<module>') {
  if (node.type === 'FunctionDeclaration' && node.id) owner = node.id.name;
  if (node.type === 'VariableDeclarator' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) owner = node.id.name;
  yield { node, parent, owner };
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') yield* nodes(child, node, owner);
    }
  }
}

/** Follow imports from roots; never execute the modules being checked. */
const parsedModules = new Map();
function networkReport(read, roots, sites = []) {
  const modules = new Map();
  const violations = [];
  const dynamic = [];
  const admitted = new Set();
  const visit = (file) => {
    if (modules.has(file)) return;
    const source = read(file);
    if (parsedModules.get(file)?.source !== source) parsedModules.set(file, {
      source, program: parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true }),
    });
    const { program } = parsedModules.get(file);
    modules.set(file, { source, program });
    for (const { node, parent, owner } of nodes(program)) {
      const named = node.type === 'Identifier' ? node.name : ['MemberExpression', 'Property'].includes(node.type) ? memberName(node) : undefined;
      if (['createRequire', 'require'].includes(named) || (['MemberExpression', 'Property'].includes(node.type) && ['binding', '_linkedBinding', 'dlopen', 'getBuiltinModule'].includes(named))) violations.push(`${file}:${node.loc.start.line} N5 refuses ${named}`);
      if (['eval', 'Function'].includes(named)) violations.push(`${file}:${node.loc.start.line} N6 refuses ${named}`);
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) continue;
      const specifier = node.source?.type === 'Literal' ? node.source.value : undefined;
      if (typeof specifier !== 'string') {
        if (node.type === 'ImportExpression') {
          const exception = DYNAMIC_IMPORTS.find((entry) => entry.file === file && entry.owner === owner && expressionShape(entry.argument) === syntaxShape(node.source));
          const key = `${file}#${owner}#${syntaxShape(node.source)}`;
          dynamic.push({ file, owner, argument: syntaxShape(node.source), line: node.loc.start.line });
          if (!exception || admitted.has(key)) violations.push(`${file}:${node.loc.start.line} N3 refuses import(${source.slice(node.source.start, node.source.end)}) in ${owner}`);
          else admitted.add(key);
        }
        continue;
      }
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        visit(posix.normalize(posix.join(posix.dirname(file), specifier)));
      } else {
        const builtin = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
        if (!BUILTINS.has(builtin) || (builtin === 'node:child_process' && file !== 'src/substrate/host.mjs')) {
          violations.push(`${file}:${node.loc.start.line} N1 refuses ${specifier}`);
        }
      }
    }
    for (const { node, parent } of unbound(program)) {
      if (['globalThis', 'global'].includes(node.name)) {
        if (parent?.type === 'MemberExpression' && parent.object === node && !parent.computed && GLOBALS.has(memberName(parent))) continue;
        violations.push(`${file}:${node.loc.start.line} N4 refuses ${parent?.type === 'MemberExpression' ? source.slice(parent.start, parent.end) : node.name}`);
      } else if (!GLOBALS.has(node.name)) {
        violations.push(`${file}:${node.loc.start.line} N4 refuses unbound ${node.name}`);
      }
    }
  };
  for (const root of roots) visit(root);
  violations.push(...mentionReport(modules, sites));
  return { violations, modules, dynamic };
}

// proves R-SAFE-2
test('N3 to N6: the guard refuses unreviewed imports, globals, loaders and code generation by site', () => {
  const cases = [
    ['N3', "const specifier = './other.mjs'; import(specifier);", 'import'],
    ['N3', 'import(`./other.mjs`);', 'import'],
    ['N4', 'fetch("https://example.invalid");', 'fetch'],
    ['N4', 'new WebSocket("wss://example.invalid");', 'WebSocket'],
    ['N4', 'new EventSource("https://example.invalid");', 'EventSource'],
    ['N4', 'new UnreviewedTransport();', 'UnreviewedTransport'],
    ['N4', 'globalThis.fetch("https://example.invalid");', 'globalThis'],
    ['N4', 'globalThis["fetch"]("https://example.invalid");', 'globalThis'],
    ['N4', 'globalThis["Array"];', 'globalThis'],
    ['N4', 'global.fetch("https://example.invalid");', 'global'],
    ['N4', 'const other = globalThis;', 'globalThis'],
    ['N4', 'function local(fetch) { return fetch; } fetch("outside");', 'fetch'],
    ['N4', 'function local(value = fetch) { var fetch; return value; }', 'fetch'],
    ['N5', "createRequire('file:///fixture.mjs');", 'createRequire'],
    ['N5', "require('node:net');", 'require'],
    ['N5', "process.binding('tcp_wrap');", 'binding'],
    ['N5', "process['binding']('tcp_wrap');", 'binding'],
    ['N5', "process._linkedBinding('tcp_wrap');", '_linkedBinding'],
    ['N5', "process.dlopen({}, 'addon.node');", 'dlopen'],
    ['N5', "process.getBuiltinModule('net');", 'getBuiltinModule'],
    ['N5', 'const { binding: load } = process;', 'binding'],
    ['N6', 'eval("0");', 'eval'],
    ['N6', '(0, eval)("0");', 'eval'],
    ['N6', 'new Function("return 0");', 'Function'],
    ['N6', 'globalThis.Function("return 0");', 'Function'],
  ];
  for (const [row, source, site] of cases) {
    const report = networkReport(() => source, ['fixture.mjs']);
    assert.ok(report.violations.some((line) => line.startsWith(`fixture.mjs:1 ${row}`) && line.includes(site)), `${row} must name ${site} in ${source}: ${report.violations.join('\n')}`);
  }
  for (const source of [
    'const fetch = () => 0; fetch();',
    'function local(fetch) { return fetch(); }',
    'try { throw 0; } catch (fetch) { fetch(); }',
    'const object = { fetch: 0 }; const { fetch: read } = object; read;',
    'globalThis.Array; global.process;',
    'const factory = (async () => {}).constructor;', // N13 is explicitly outside the guard.
  ]) assert.deepEqual(networkReport(() => source, ['fixture.mjs']).violations, [], source);
  const config = "import { pathToFileURL } from 'node:url'; import { join } from 'node:path'; const CONFIG = 'rigger.config.mjs'; export async function consumerConfig(target) { const path = join(target, CONFIG); return import(pathToFileURL(path)); }";
  assert.deepEqual(networkReport(() => config, ['src/cli/doctor.mjs']).violations, [], 'N3 admits the named consumer config site');
  const other = networkReport(() => config.replace('consumerConfig', 'otherConfig'), ['src/cli/doctor.mjs']);
  assert.ok(other.violations.some((line) => line.includes('N3')), 'N3 refuses the same import in a different function');
  const twice = networkReport(() => config.replace('return import(pathToFileURL(path));', 'await import(pathToFileURL(path)); return import(pathToFileURL(path));'), ['src/cli/doctor.mjs']);
  assert.ok(twice.violations.some((line) => line.includes('N3')), 'N3 refuses an extra copy of the named site');
});

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpressionAt } from 'acorn';
import { consumerConfig } from '../src/cli/doctor.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// proves R-SAFE-2
test('N11: consumerConfig loads only the target config outside the guarded closure', async () => {
  const root = temporaryDirectory('rigger-network-config-');
  const absent = join(root, 'absent root config');
  mkdirSync(join(absent, '.rigger'), { recursive: true });
  writeFileSync(join(absent, '.rigger', 'rigger.config.mjs'), '// ABOUTME: A nested decoy must never become the target config.\nexport default { decoy: true };\n');
  const absentRead = await consumerConfig(absent);
  assert.equal(absentRead.config, undefined, 'N11: an absent target config never loads the nested decoy');
  assert.match(absentRead.problem, /rigger\.config\.mjs.*is not in/, 'N11: an absent target config is reported absent');
  const consumers = ['one', 'two'].map((name) => {
    const target = join(root, `${name}'s $target\nconfig`);
    mkdirSync(target);
    const expected = { marker: name, value: "the consumer's value\nwith a line ending" };
    const path = join(target, 'rigger.config.mjs');
    // This import would fail N1 if followed. Merely loading net starts no socket.
    writeFileSync(path, `// ABOUTME: Exports a consumer marker outside the package guard.\nimport 'node:net';\nexport default ${JSON.stringify(expected)};\n`);
    return { target, expected, native: realpathSync.native(path) };
  });
  const reads = [];
  const report = networkReport((file) => {
    const path = realpathSync.native(join(PACKAGE_ROOT, file));
    reads.push(path);
    return readFileSync(path, 'utf8');
  }, ENTRY_POINTS, REVIEWED_SITES);
  assert.deepEqual(report.violations, [], 'N11: the package closure is admitted without loading a consumer module');
  assert.equal(report.modules.has('rigger.config.mjs'), false, 'N11: the consumer import never enters the package config');
  const doctor = report.modules.get('src/cli/doctor.mjs');
  const factory = doctor.program.body.map((node) => node.declaration ?? node).find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'consumerConfig');
  assert.ok(factory, 'N11: the named consumerConfig factory exists');
  const paths = [...nodes(factory)].map(({ node }) => node).filter((node) => node.type === 'VariableDeclarator' && node.id.name === 'path');
  assert.equal(paths.length, 1, 'N11: exactly one const path feeds the named import');
  assert.equal(syntaxShape(paths[0].init), expressionShape('join(target, CONFIG)'), 'N11: the import path is the target joined with CONFIG');
  const imports = [...nodes(factory)].map(({ node }) => node).filter((node) => node.type === 'ImportExpression');
  assert.equal(imports.length, 1, 'N11: exactly one consumer import');
  assert.equal(syntaxShape(imports[0].source), expressionShape('pathToFileURL(path)'), 'N11: the named import uses that path as a file URL');
  const init = report.modules.get('src/cli/init.mjs');
  const filename = [...nodes(init.program)].map(({ node }) => node).find((node) => node.type === 'VariableDeclarator' && node.id.name === 'CONFIG');
  assert.equal(filename.init.value, 'rigger.config.mjs', 'N11: CONFIG is only the declared consumer filename');
  for (const { target, expected, native } of consumers) {
    assert.ok(!reads.includes(native), 'N11: the guard never reads the existing consumer module');
    assert.deepEqual((await consumerConfig(target)).config, expected, 'N11: parsed exports come from this target, including special characters');
  }

});

const PACKAGE_ROOT = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
const ENTRY_POINTS = ['src/cli/rigger.mjs', 'scripts/gate-check.mjs'];

/** Compare syntax, not quote style, whitespace or source positions. */
const syntaxShapes = new WeakMap();
const expressionShapes = new Map();
const syntaxShape = (node) => {
  const tree = node && typeof node === 'object' && typeof node.type === 'string';
  if (tree && syntaxShapes.has(node)) return syntaxShapes.get(node);
  const shape = JSON.stringify(node, (key, value) => ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : value);
  if (tree) syntaxShapes.set(node, shape);
  return shape;
};
const expressionShape = (source) => {
  if (!expressionShapes.has(source)) expressionShapes.set(source, syntaxShape(parseExpressionAt(source, 0, { ecmaVersion: 'latest', sourceType: 'module' })));
  return expressionShapes.get(source);
};

/** The sole nonliteral site imports the consumer's own code, outside N11 under M8-U3 Q15 a. */
const DYNAMIC_IMPORTS = [{ file: 'src/cli/doctor.mjs', owner: 'consumerConfig', argument: 'pathToFileURL(path)', reason: 'Loads the target consumer config; N11 pins its filename and target directory.' }];

/** Every admitted unbound global has a reviewed, non-network purpose in this closure. */
const GLOBALS = new Map([
  ['AggregateError', 'Combines local failures.'],
  ['Array', 'In-memory collections.'],
  ['Atomics', 'The synchronous standard-error retry wait.'],
  ['BigInt', 'Compares forge integration identifiers without numeric truncation.'],
  ['Boolean', 'Coerces and filters local values.'],
  ['Buffer', 'Process input and output bytes.'],
  ['Date', 'Calendar calculations and the real host clock.'],
  ['Error', 'Local failure construction.'],
  ['Infinity', 'Unbounded sentinel values for local calculations.'],
  ['Int32Array', 'The synchronous standard-error wait cell.'],
  ['JSON', 'Plain-data encoding and decoding.'],
  ['Map', 'Local indexes and caches.'],
  ['Math', 'Numeric bounds and schedules.'],
  ['NaN', 'Invalid calendar calculation sentinel.'],
  ['Number', 'Numeric conversion and validation.'],
  ['Object', 'Plain-data inspection and composition.'],
  ['Promise', 'In-process asynchronous coordination.'],
  ['RangeError', 'Invalid clock occurrence diagnostics.'],
  ['RegExp', 'Local text matching.'],
  ['Set', 'In-memory membership and deduplication.'],
  ['SharedArrayBuffer', 'The synchronous standard-error wait cell storage.'],
  ['String', 'Local text conversion.'],
  ['TypeError', 'Invalid local argument diagnostics.'],
  ['URL', 'File and repository URL parsing, without opening a connection.'],
  ['WeakMap', 'Associates local objects with their outcomes.'],
  ['WeakSet', 'Tracks local object identities.'],
  ['clearTimeout', 'Cancels the real host deadline.'],
  ['console', 'Terminal output.'],
  ['encodeURIComponent', 'Encodes names handed to gh in arguments.'],
  ['parseInt', 'Parses local text fields.'],
  ['performance', 'The real dispatch duration clock.'],
  ['process', 'Arguments, environment, local streams, process metadata and exit; N5 guards loaders.'],
  ['queueMicrotask', 'Local lifecycle coordination.'],
  ['setImmediate', 'Local lifecycle coordination without a delayed timer.'],
  ['setTimeout', 'The real host deadline scheduler.'],
  ['undefined', 'The absent-value sentinel.'],
]);

/** A statically named member or object-pattern key. Computed runtime names are N13's limit. */
function memberName(node) {
  const key = node.type === 'MemberExpression' ? node.property : node.key;
  if (!node.computed && key?.type === 'Identifier') return key.name;
  if (key?.type === 'Literal') return String(key.value);
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0].value.cooked;
}

/** Read lexical bindings before references, keeping parameter defaults outside body var scope. */
const lexicalModels = new WeakMap();
function lexical(program) {
  if (lexicalModels.has(program)) return lexicalModels.get(program);
  const scopes = new WeakMap();
  const bindings = new WeakSet();
  const root = { parent: null, kind: 'module', names: new Set() };
  const inner = (parent, kind = 'block') => ({ parent, kind, names: new Set() });
  const bind = (pattern, scope) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      scope.names.add(pattern.name);
      bindings.add(pattern);
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) bind(property.type === 'RestElement' ? property.argument : property.value, scope);
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements) bind(element, scope);
    } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope);
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope);
  };
  const children = (node, scope) => {
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') collect(child, scope);
    }
  };
  const collect = (node, scope) => {
    scopes.set(node, scope);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      if (node.type === 'FunctionDeclaration') {
        scopes.set(node.id, scope);
        bind(node.id, scope);
      }
      const parameters = inner(scope, 'parameters');
      bind(node.id, parameters);
      if (node.type !== 'ArrowFunctionExpression') parameters.names.add('arguments');
      for (const parameter of node.params) bind(parameter, parameters);
      for (const parameter of node.params) collect(parameter, parameters);
      collect(node.body, inner(parameters, 'function'));
      return;
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
      if (node.type === 'ClassDeclaration') bind(node.id, scope);
      const body = inner(scope);
      bind(node.id, body);
      children(node, body);
      return;
    }
    if (['BlockStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement', 'CatchClause', 'StaticBlock'].includes(node.type)) {
      scope = inner(scope, node.type === 'StaticBlock' ? 'function' : 'block');
      scopes.set(node, scope);
      if (node.type === 'CatchClause') bind(node.param, scope);
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) bind(specifier.local, scope);
    if (node.type === 'VariableDeclaration') {
      let destination = scope;
      if (node.kind === 'var') while (!['module', 'function'].includes(destination.kind)) destination = destination.parent;
      for (const declaration of node.declarations) bind(declaration.id, destination);
    }
    children(node, scope);
  };
  collect(program, root);
  const lookup = (node) => {
    let scope = scopes.get(node);
    while (scope && !scope.names.has(node.name)) scope = scope.parent;
    return scope;
  };
  const model = { root, lookup, bindings };
  lexicalModels.set(program, model);
  return model;
}

/** Identifier uses, excluding declarations, property labels and module syntax. */
function referenceIdentifier(node, parent, bindings) {
  if (node.type !== 'Identifier' || bindings.has(node)) return false;
  if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier', 'ExportAllDeclaration', 'MetaProperty'].includes(parent?.type)) return false;
  if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && parent.key === node && !parent.computed && !(parent.shorthand && parent.value === node)) return false;
  return !(['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) && parent.label === node);
}

/** Read lexical bindings before references, keeping parameter defaults outside body var scope. */
function unbound(program) {
  const { lookup, bindings } = lexical(program);
  const found = [];
  for (const { node, parent } of nodes(program)) {
    if (referenceIdentifier(node, parent, bindings) && !lookup(node)) found.push({ node, parent });
  }
  return found;
}

// proves R-SAFE-2
test('the real entry-point closure admits only the reviewed network boundaries', () => {
  const report = packageReport();
  assert.deepEqual(report.violations, [], 'N1 to N6 and Table P: every real module must satisfy the positive boundary');
  for (const root of ENTRY_POINTS) assert.ok(report.modules.has(root), `N2: follows ${root}`);
  assert.deepEqual(report.dynamic.map(({ file, owner, argument }) => ({ file, owner, argument })), DYNAMIC_IMPORTS.map(({ file, owner, argument }) => ({ file, owner, argument: expressionShape(argument) })), 'N3: the exception list is exactly the nonliteral sites');
  for (const [name, reason] of [...BUILTINS, ...GLOBALS, ...PROTECTED_NAMES, ...DYNAMIC_IMPORTS.map(({ file, reason }) => [file, reason])]) {
    assert.ok(typeof reason === 'string' && reason.trim() && !reason.includes('\n'), `N1/N3/N4/Table P: ${name} has a one-line reason`);
  }
  for (const site of REVIEWED_SITES) {
    assert.ok(Number.isInteger(site.mentions) && site.mentions > 0, `The reviewed count is positive for ${site.file}:${site.line}`);
    assert.ok(site.reason.trim() && !/[\r\n]/.test(site.reason), `Each reviewed site has its own one-line reason: ${site.file}:${site.line}`);
  }
});

/** Read only package modules reached from the two production entry points. */
const packageReport = () => networkReport((file) => readFileSync(join(PACKAGE_ROOT, file), 'utf8'), ENTRY_POINTS, REVIEWED_SITES);

/** Local programs observe host state; N9 and N10 explicitly bound tool and consumer internals. */
const LOCAL_PROGRAMS = new Map([
  ['/bin/ps', 'ps(1) reads selected local process information.'],
  ['src/substrate/process-table.sh', 'The packaged Linux shim reads local /proc and ps output.'],
  ['/usr/sbin/lsof', 'The cwd-only lsof read uses -n/-P to suppress address and service lookup.'],
  ['/usr/bin/lsof', 'The Linux lsof uses the same local cwd-only -n/-P read.'],
  ['launchctl', 'launchctl print queries the local launchd bootstrap domain.'],
]);

// proves R-SAFE-2
test('N8: every process-starting inventory entry declares only programs in the closed set', () => {
  const closed = new Set(['gh', 'git', 'claude', 'codex', '/bin/sh', ...LOCAL_PROGRAMS.keys()]);
  const report = packageReport();
  assert.deepEqual(report.violations, [], 'Program declarations belong to an admitted real closure');
  const starts = new Set();
  for (const [file, { program, source }] of report.modules) for (const { node } of nodes(program)) {
    if (node.type !== 'CallExpression') continue;
    const callee = node.callee.type === 'Identifier' ? node.callee.name : memberName(node.callee);
    if (['runCommand', 'spawn', 'spawnSync', 'execFile'].includes(callee)) starts.add(JSON.stringify([file, source.split('\n')[node.loc.start.line - 1]]));
  }
  assert.ok(starts.size > 0, 'The process-start premise reaches real native and L0 calls');
  for (const site of REVIEWED_SITES) {
    if (starts.has(JSON.stringify([site.file, site.text]))) assert.ok(site.programs?.length, `Declare the program of ${site.file}:${site.line}`);
    if (site.programs) for (const program of site.programs) assert.ok(closed.has(program), `${site.file}:${site.line} declares an unreviewed program ${program}`);
  }
  for (const [program, reason] of LOCAL_PROGRAMS) assert.ok(reason.trim(), `${program} has a local-operation reason`);
});

/** Reviewed source sites; each row admits one occurrence, not every equal line. */
const REVIEWED_SITES = [
  { file: 'scripts/gate-check.mjs', text: 'function eventNumber(env) {', mentions: 1, reason: 'Receive the gate event environment to determine its issue or pull number.', line: 72 },
  { file: 'scripts/gate-check.mjs', text: '  const number = Number(env.NUMBER);', mentions: 1, reason: 'Read the NUMBER supplied by the gate event.', line: 73 },
  { file: 'scripts/gate-check.mjs', text: '  if (!Number.isInteger(number) || number < 1) throw new Error(`NUMBER is ${JSON.stringify(env.NUMBER)}, which is no issue or pull request number`);', mentions: 1, reason: 'Refuse an invalid event number before making forge reads.', line: 74 },
  { file: 'scripts/gate-check.mjs', text: 'export async function card({ env, reads, out, log }) {', mentions: 1, reason: 'Receive the event environment for the card check.', line: 83 },
  { file: 'scripts/gate-check.mjs', text: '  const number = eventNumber(env);', mentions: 1, reason: 'Resolve the card-check event number from that environment.', line: 84 },
  { file: 'scripts/gate-check.mjs', text: '  if (env.IS_PULL !== \'true\') {', mentions: 1, reason: 'Distinguish an issue event from a pull-request event.', line: 85 },
  { file: 'scripts/gate-check.mjs', text: '  const { config, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);', mentions: 1, reason: 'Load the card check\'s repository configuration from its event repository.', line: 96 },
  { file: 'scripts/gate-check.mjs', text: 'export async function map({ env, reads, out, log }) {', mentions: 1, reason: 'Receive the event environment for the pull-to-card mapping check.', line: 109 },
  { file: 'scripts/gate-check.mjs', text: '  const number = eventNumber(env);', mentions: 1, reason: 'Resolve the mapping event number from that environment.', line: 110 },
  { file: 'scripts/gate-check.mjs', text: '  if (env.IS_PULL === \'true\') {', mentions: 1, reason: 'Distinguish a pull-request mapping event from an issue event.', line: 111 },
  { file: 'scripts/gate-check.mjs', text: '  const { config, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);', mentions: 1, reason: 'Load the mapping check\'s repository configuration from its event repository.', line: 115 },
  { file: 'scripts/gate-check.mjs', text: 'async function rule({ env, reads, number, out, log }) {', mentions: 1, reason: 'Receive the repository environment for a pull\'s branch rule.', line: 138 },
  { file: 'scripts/gate-check.mjs', text: '      ? `pull request #${number}\'s head repository was deleted, so its head is not ${env.GITHUB_REPOSITORY}\'s`', mentions: 1, reason: 'Describe a deleted head repository relative to the event repository.', line: 156 },
  { file: 'scripts/gate-check.mjs', text: '      : `pull request #${number} is from ${pull.headRepository}, not ${env.GITHUB_REPOSITORY}`);', mentions: 1, reason: 'Describe a head repository differing from the event repository.', line: 157 },
  { file: 'scripts/gate-check.mjs', text: '  const { config, at, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);', mentions: 1, reason: 'Load the branch rule\'s repository configuration from the event repository.', line: 160 },
  { file: 'scripts/gate-check.mjs', text: '  if (issue === null) return refuse(`pull request #${number}\'s branch ${pull.branch} names #${cardNumber}, which is no issue in ${env.GITHUB_REPOSITORY}`);', mentions: 1, reason: 'Report a branch naming no issue in the event repository.', line: 173 },
  { file: 'scripts/gate-check.mjs', text: 'async function main(argv, env) {', mentions: 1, reason: 'Receive CLI arguments and environment for the gate\'s selected mode.', line: 216 },
  { file: 'scripts/gate-check.mjs', text: '  if (!/^[^/\\s]+\\/[^/\\s]+$/.test(env.GITHUB_REPOSITORY ?? \'\')) {', mentions: 1, reason: 'Validate the event repository before building its forge reader.', line: 224 },
  { file: 'scripts/gate-check.mjs', text: '    log(`gate-check: GITHUB_REPOSITORY is ${JSON.stringify(env.GITHUB_REPOSITORY)}, which names no repository as owner/name`);', mentions: 1, reason: 'Report a malformed event repository without starting a reader.', line: 225 },
  { file: 'scripts/gate-check.mjs', text: '    const reads = repositoryReads({ repo: env.GITHUB_REPOSITORY, project: \'none\' }, { emitter: sink.emitter({ layer: \'L0\' }) });', mentions: 1, reason: 'Build the forge reader for the validated event repository.', line: 235 },
  { file: 'scripts/gate-check.mjs', text: '      return await MODES[mode]({ env, reads, number, out, log });', mentions: 1, reason: 'Forward the received environment to the selected gate mode.', line: 237 },
  { file: 'scripts/gate-check.mjs', text: 'if (ranDirectly) process.exitCode = await main(process.argv.slice(2), process.env);', mentions: 1, reason: 'Give a direct gate invocation the account environment and its returned exit status.', line: 249 },
  { file: 'src/cli/doctor.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the repository-safe environment copier for doctor probes.', line: 9 },
  { file: 'src/cli/doctor.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'../substrate/process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for doctor tool probes.', line: 12 },
  { file: 'src/cli/doctor.mjs', text: 'export async function asked(command, args, { emitter, timeout }) {', mentions: 1, reason: 'Accept the program and arguments selected by a doctor probe.', line: 35 },
  { file: 'src/cli/doctor.mjs', text: '  const { exit, timedOut, stdout, stderr } = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Run git or an agent authentication probe through L0 with a copied account environment.', line: 36, programs: ['git', 'claude', 'codex'] },
  { file: 'src/cli/doctor.mjs', text: '  const step = relative(outer, inner);', mentions: 1, reason: 'Compute a local relative-path segment for directory containment.', line: 103 },
  { file: 'src/cli/doctor.mjs', text: '  return step === \'\' || (step !== \'..\' && !step.startsWith(`..${sep}`) && !isAbsolute(step));', mentions: 4, reason: 'Accept only a relative-path segment inside the containing directory.', line: 104 },
  { file: 'src/cli/doctor.mjs', text: '    const [command, ...args] = adapter.auth;', mentions: 1, reason: 'Take an authentication command from the selected provider adapter.', line: 341 },
  { file: 'src/cli/doctor.mjs', text: '    const spelled = `\\`${[command, ...args].join(\' \')}\\``;', mentions: 1, reason: 'Format the selected authentication command for the doctor\'s diagnostic.', line: 342 },
  { file: 'src/cli/doctor.mjs', text: '      said = await ask(command, args, { emitter, timeout });', mentions: 1, reason: 'Hand the provider authentication command to the bounded probe runner.', line: 345 },
  { file: 'src/cli/doctor.mjs', text: '  const step = (key) => (list && index(key) ? `[${key}]`', mentions: 1, reason: 'Build a local property-path segment while copying plain consumer data.', line: 454 },
  { file: 'src/cli/doctor.mjs', text: '    const at = `${path}${step(key)}`;', mentions: 1, reason: 'Append a property-path segment to a consumer-data diagnostic path.', line: 457 },
  { file: 'src/cli/doctor.mjs', text: '    for (const key of keys) if (!index(key)) refuse(\'a property that is not an index\', `${path}${step(key)}`);', mentions: 1, reason: 'Report a non-index property in a consumer-data array.', line: 464 },
  { file: 'src/cli/doctor.mjs', text: '  const environment = await obtain(\'readEnvironment\', GATE_ENVIRONMENT);', mentions: 1, reason: 'Read the forge gate environment as repository policy data.', line: 744 },
  { file: 'src/cli/doctor.mjs', text: '  if (environment === null) faults.push(`environment ${GATE_ENVIRONMENT} is absent, or not readable with this token`);', mentions: 1, reason: 'Report an absent or unreadable forge gate environment.', line: 745 },
  { file: 'src/cli/doctor.mjs', text: '  if (environment !== null) {', mentions: 1, reason: 'Inspect the gate environment only after its read succeeds.', line: 748 },
  { file: 'src/cli/doctor.mjs', text: '    if (environment && environment.canAdminsBypass !== false) faults.push(`environment ${GATE_ENVIRONMENT} requires can_admins_bypass: false`);', mentions: 2, reason: 'Require the gate environment to disallow administrator bypass.', line: 752 },
  { file: 'src/cli/doctor.mjs', text: '    const policy = environment?.deploymentBranchPolicy;', mentions: 1, reason: 'Read the gate environment\'s deployment-branch policy.', line: 755 },
  { file: 'src/cli/doctor.mjs', text: '    if (environment?.policies === null) faults.push(`environment ${GATE_ENVIRONMENT}\'s deployment-branch policy list is absent, or not readable with this token`);', mentions: 1, reason: 'Report an unavailable deployment-branch policy list.', line: 756 },
  { file: 'src/cli/doctor.mjs', text: '    else if (environment && branch && (policy?.protectedBranches !== false || policy?.customBranchPolicies !== true || environment.policies?.length !== 1', mentions: 2, reason: 'Require exactly the configured custom deployment-branch policy.', line: 757 },
  { file: 'src/cli/doctor.mjs', text: '      || environment.policies[0].type !== \'branch\' || environment.policies[0].name !== branch.name)) {', mentions: 2, reason: 'Compare the gate environment\'s policy type and branch name.', line: 758 },
  { file: 'src/cli/doctor.mjs', text: '    else if (environment !== null && !appKnown) faults.push(`${GATE_CONTEXT}\'s integration pin was not judged against ${GATE_APP_ID}`);', mentions: 1, reason: 'Report an App pin that could not be checked against its identity.', line: 764 },
  { file: 'src/cli/doctor.mjs', text: '    else if (environment !== null && BigInt(rule.integration_id) !== BigInt(app)) faults.push(`${GATE_CONTEXT} is pinned to integration ${rule.integration_id}, rather than the gate App`);', mentions: 1, reason: 'Compare the required gate integration with the observed App identity.', line: 765 },
  { file: 'src/cli/once.mjs', text: 'export const noticeLine = (verb, id, { step, cause, made, unrecorded }) => (made === undefined', mentions: 1, reason: 'Receive the failed notice operation for a CLI diagnostic.', line: 189 },
  { file: 'src/cli/once.mjs', text: '  ? `rigger ${verb}: the notice for hold ${id} failed to ${outsideText(step)}: ${outsideText(cause)}`', mentions: 1, reason: 'Describe a notice operation that failed before making its issue.', line: 190 },
  { file: 'src/cli/once.mjs', text: '  : `rigger ${verb}: the notice for hold ${id} made its step to ${outsideText(step)}${unrecorded === undefined ? \'\' : `, but the sink refused its record, so these events went unrecorded: ${unrecorded.map(({ event }) => outsideText(event)).join(\', \')}`}: ${outsideText(cause)}`);', mentions: 1, reason: 'Describe a partly completed notice and any unrecorded operation.', line: 191 },
  { file: 'src/cli/once.mjs', text: '      roles: config.roles, topic: worktreeTopic(config), provisioning: config.provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace: unmade, maker, forge: settledFacts, judged, directories, continuing,', mentions: 2, reason: 'Give L2 the consumer\'s declared provisioning map with its configured roles.', line: 265 },
  { file: 'src/cli/once.mjs', text: '      const how = failed(outcomes.at(-1), config.provisioning[name], { number }, name);', mentions: 1, reason: 'Classify a judge step outcome against that named provisioning step.', line: 284 },
  { file: 'src/cli/once.mjs', text: '    const drained = push === undefined ? undefined : (handOver) => push({ sink, run: opened.run, config, repository: named, directory: state, handOver });', mentions: 2, reason: 'Associate the return-time telemetry push with the current engine run.', line: 472 },
  { file: 'src/cli/once.mjs', text: '    const l3 = loop({ config, board, decide, facts, l2, sink, kill, workspace, workspaceTip, judgeDirectory, escalationDirectory, removeDirectories, state, readRecord, environment: process.env, run: opened.run, clock, drained });', mentions: 4, reason: 'Hand L3 the engine account environment and current run identifier.', line: 473 },
  { file: 'src/cli/once.mjs', text: '    return verb === \'run\' ? l3.run({ handOver, stop }) : l3.pull(limit);', mentions: 2, reason: 'Select the continuous run verb or the bounded pull path.', line: 474 },
  { file: 'src/cli/pause.mjs', text: '  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: opened.sink, ...(fs && { fs }) });', mentions: 2, reason: 'Associate an admission close with the current recorded run.', line: 35 },
  { file: 'src/cli/plan.mjs', text: '    const answer = nextAction(card, config.kinds, config.epicLabel, { roles: config.roles, provisioning: config.provisioning ?? {}, sink: UNRECORDED });', mentions: 2, reason: 'Give plan\'s L2 decision the consumer\'s provisioning map.', line: 78 },
  { file: 'src/cli/recording.mjs', text: '  const run = randomUUID();', mentions: 1, reason: 'Allocate the engine run\'s local recording identifier.', line: 36 },
  { file: 'src/cli/recording.mjs', text: '  const sink = openSink({ run, now: Date.now });', mentions: 1, reason: 'Open the event sink for that run identifier.', line: 37 },
  { file: 'src/cli/recording.mjs', text: '    const answer = await work({ sink, run, name, admitted: (read) => { config = read; } });', mentions: 1, reason: 'Hand the recorded run identifier to the verb\'s work callback.', line: 46 },
  { file: 'src/cli/recording.mjs', text: '    return await push({ sink, run, config, repository, directory: join(repository, STATE), answer });', mentions: 1, reason: 'Associate return-time stream pushing with the completed run.', line: 48 },
  { file: 'src/cli/report.mjs', text: 'function runLines({ run, from, to, releases, pulled, n, throughput, utilization, queue }) {', mentions: 1, reason: 'Receive one run\'s aggregate figures for report formatting.', line: 36 },
  { file: 'src/cli/report.mjs', text: '  const heading = `  run ${outsideText(run)}: from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a span of ${hours(span)}`;', mentions: 1, reason: 'Format the recorded run identifier and its observed interval.', line: 38 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, forge, git }) => [`  run ${outsideText(run)}`, faultLine(\'forge\', forge, \'this run\'), faultLine(\'git\', git, \'this run\')]),', mentions: 2, reason: 'Label per-run forge and git fault summaries.', line: 66 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, durations, survivors }) => [', mentions: 1, reason: 'Iterate recorded runs when formatting dispatch durations and survivors.', line: 76 },
  { file: 'src/cli/report.mjs', text: '      `  run ${outsideText(run)}`,', mentions: 1, reason: 'Label a run\'s dispatch-duration report.', line: 77 },
  { file: 'src/cli/report.mjs', text: '    ...stream.redos.map(({ card, run }) => `    redo after an interruption: card #${outsideText(card)}, run ${outsideText(run)}`),', mentions: 2, reason: 'Attribute an interruption redo to its recorded run.', line: 85 },
  { file: 'src/cli/report.mjs', text: '  return [...runs.flatMap((each) => counted(`in run ${shown(each.run)}`, each)), ...counted(\'across the stream\', stream)];', mentions: 1, reason: 'Label per-run escalation-cause counts.', line: 123 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, count, entries }) => [', mentions: 1, reason: 'Iterate runs when formatting their admission holds.', line: 138 },
  { file: 'src/cli/report.mjs', text: '      `  admission holds in run ${shown(run)}: ${count}`,', mentions: 1, reason: 'Label a run\'s admission-hold count.', line: 139 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, hostFaults, escalations }) => [', mentions: 1, reason: 'Iterate runs when formatting L2 faults and escalations.', line: 173 },
  { file: 'src/cli/report.mjs', text: '      `  run ${outsideText(run)}`, line(hostFaults, \'this run\'), escalationLine(escalations, \'this run\'), ...escalationLines(escalations.entries),', mentions: 1, reason: 'Label a run\'s L2 fault and escalation summary.', line: 174 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap((each) => [`  run ${outsideText(each.run)}`, `    rework: ${each.rework}`]),', mentions: 1, reason: 'Label a run\'s rework count.', line: 190 },
  { file: 'src/cli/resume.mjs', text: '  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: sink ?? opened.sink, ...(fs && { fs }) });', mentions: 2, reason: 'Associate an admission reopen with the current recorded run.', line: 36 },
  { file: 'src/cli/rigger.mjs', text: 'import { run } from \'./verbs.mjs\';', mentions: 1, reason: 'Import the CLI argument dispatcher at the executable entry point.', line: 5 },
  { file: 'src/cli/rigger.mjs', text: 'const { text, code } = await run(process.argv.slice(2));', mentions: 1, reason: 'Send the executable\'s arguments to the CLI dispatcher.', line: 10 },
  { file: 'src/cli/run.mjs', text: 'export const run = (options) => claimVerb(\'run\', undefined, options);', mentions: 2, reason: 'Route the continuous run verb into the shared claiming implementation.', line: 10 },
  { file: 'src/cli/verbs.mjs', text: 'import { run as runVerb } from \'./run.mjs\';', mentions: 1, reason: 'Import the continuous run verb into the verb registry.', line: 12 },
  { file: 'src/cli/verbs.mjs', text: '  [\'run\', \'claim cards and dispatch their makers until the board drains, or, while a clock trigger is declared, until stopped\'],', mentions: 1, reason: 'Declare the run verb\'s CLI help description.', line: 34 },
  { file: 'src/cli/verbs.mjs', text: 'export const LANDED = { init, doctor, \'setup-board\': setupBoard, plan, once, run: runVerb, pause, resume, report, verdict };', mentions: 1, reason: 'Map the run verb to its implemented handler.', line: 47 },
  { file: 'src/cli/verbs.mjs', text: 'export async function run(argv) {', mentions: 1, reason: 'Define the CLI argument dispatcher independently of any process starter.', line: 68 },
  { file: 'src/config/validate.mjs', text: '    provisioning: { entries: \'step\' },', mentions: 2, reason: 'Describe provisioning-map entries as configured steps in the validation schema.', line: 57 },
  { file: 'src/config/validate.mjs', text: '    provisioning: {},', mentions: 1, reason: 'Supply the empty provisioning-map schema default.', line: 133 },
  { file: 'src/config/validate.mjs', text: '  step: {', mentions: 1, reason: 'Define the configured-step validation schema.', line: 138 },
  { file: 'src/config/validate.mjs', text: '    run: { required: true },', mentions: 1, reason: 'Require a configured step to declare a run line.', line: 139 },
  { file: 'src/config/validate.mjs', text: 'function readProvisioning(provisioning, refusals) {', mentions: 1, reason: 'Receive the consumer\'s provisioning map for validation.', line: 653 },
  { file: 'src/config/validate.mjs', text: '  if (!declares(provisioning)) return;', mentions: 1, reason: 'Skip provisioning validation only when no map is declared.', line: 655 },
  { file: 'src/config/validate.mjs', text: '  for (const [name, step] of Object.entries(provisioning)) {', mentions: 2, reason: 'Iterate each named provisioning step for validation.', line: 656 },
  { file: 'src/config/validate.mjs', text: '    readLabels(step?.select, `${where}.select.labels`, refusals);', mentions: 1, reason: 'Validate the configured step\'s label selector.', line: 658 },
  { file: 'src/config/validate.mjs', text: '    if (!declares(step)) continue;', mentions: 1, reason: 'Defer absent or malformed step entries to their schema diagnostic.', line: 661 },
  { file: 'src/config/validate.mjs', text: '    if (Object.hasOwn(step, \'run\') && !names(step.run)) {', mentions: 4, reason: 'Require a declared step run line to be a nonempty string.', line: 662 },
  { file: 'src/config/validate.mjs', text: '    if (Object.hasOwn(step, \'cwd\')) readStepDirectory(step.cwd, where, refusals);', mentions: 2, reason: 'Validate an optional configured working directory.', line: 665 },
  { file: 'src/config/validate.mjs', text: '    readTimeout(step, where, refusals);', mentions: 1, reason: 'Validate the configured step\'s timeout.', line: 666 },
  { file: 'src/config/validate.mjs', text: '  const declared = Object.hasOwn(config, \'provisioning\') ? config.provisioning : {};', mentions: 2, reason: 'Read the declared provisioning map for kind-step validation.', line: 677 },
  { file: 'src/config/validate.mjs', text: '    if (!declares(kind) || !Object.hasOwn(kind, \'provisioning\')) continue;', mentions: 1, reason: 'Inspect only kinds declaring a provisioning sequence.', line: 680 },
  { file: 'src/config/validate.mjs', text: '    const steps = kind.provisioning;', mentions: 1, reason: 'Read a kind\'s configured provisioning sequence.', line: 681 },
  { file: 'src/config/validate.mjs', text: '    for (const step of steps) {', mentions: 1, reason: 'Inspect each step name in a kind\'s sequence.', line: 688 },
  { file: 'src/config/validate.mjs', text: '      if (!Object.hasOwn(declared, step)) {', mentions: 1, reason: 'Require each selected step name to exist in the provisioning map.', line: 689 },
  { file: 'src/config/validate.mjs', text: '        refusals.push(`\\`kinds.${name}\\` names the step \\`${step}\\`, which \\`provisioning\\` does not declare`);', mentions: 1, reason: 'Explain a kind referring to an undeclared provisioning step.', line: 690 },
  { file: 'src/config/validate.mjs', text: '  readProvisioning(config.provisioning, refusals);', mentions: 1, reason: 'Validate the provisioning map during complete configuration validation.', line: 887 },
  { file: 'src/config/validate.mjs', text: 'export const workRequires = (step) => step?.required === true;', mentions: 2, reason: 'Read whether a configured step is required for work to continue.', line: 903 },
  { file: 'src/config/validate.mjs', text: 'export const stepTimeout = (step) => step.timeout ?? 1_800_000;', mentions: 2, reason: 'Read a configured step\'s timeout or its documented default.', line: 909 },
  { file: 'src/config/validate.mjs', text: '  const selectors = [...Object.values(config.kinds), ...Object.values(config.provisioning ?? {})];', mentions: 1, reason: 'Include provisioning selectors when validating all configuration label selectors.', line: 937 },
  { file: 'src/execution/role.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the environment copier for role preparation.', line: 9 },
  { file: 'src/execution/role.mjs', text: 'export async function roleDispatch({ answer, cwd, directory, scratch, repository, reach, maker = false, env, sink, id, card, adapters = ADAPTERS }) {', mentions: 1, reason: 'Receive the engine environment and selected adapter for a role dispatch.', line: 57 },
  { file: 'src/execution/role.mjs', text: '  const environment = gitEnvironment(env);', mentions: 3, reason: 'Copy the account environment while removing git redirection variables.', line: 71 },
  { file: 'src/execution/role.mjs', text: '      environment,', mentions: 1, reason: 'Hand the copied environment to the provider invocation builder.', line: 84 },
  { file: 'src/execution/role.mjs', text: '      const { command, file, ...detail } = cause.startCause;', mentions: 1, reason: 'Separate a provider startup command from its other failure details.', line: 90 },
  { file: 'src/execution/role.mjs', text: '      failure.startCause = { ...detail, ...(command === undefined ? {} : { provider }), ...(file === undefined ? {} : { file: answer.agent }) };', mentions: 1, reason: 'Attribute an adapter command failure to the provider without exposing a command operand.', line: 91 },
  { file: 'src/execution/role.mjs', text: '  const { command, args, input, unset, env: set, folder } = invoked;', mentions: 2, reason: 'Read command, input and reviewed environment changes from the adapter result.', line: 96 },
  { file: 'src/execution/role.mjs', text: '  for (const name of unset) delete environment[name];', mentions: 1, reason: 'Remove only the variables the adapter\'s invocation declares unset.', line: 104 },
  { file: 'src/execution/role.mjs', text: '  Object.assign(environment, set);', mentions: 1, reason: 'Apply the adapter\'s declared environment additions to the copied environment.', line: 105 },
  { file: 'src/execution/role.mjs', text: '  return { provider, command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest };', mentions: 3, reason: 'Return the prepared program and environment with the role\'s workspace and timeout.', line: 106 },
  { file: 'src/execution/role.mjs', text: '  if (Object.keys(gitEnvironment({ [key]: \'\' })).length === 0) return disallowed(\'is a variable that redirects git, which L1 removes\');', mentions: 1, reason: 'Recognize git-redirecting variables that role configuration may not restore.', line: 129 },
  { file: 'src/execution/run.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the environment copier for L1\'s real process handoff.', line: 9 },
  { file: 'src/execution/run.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, identityOf, killRecordedGroup, runCommand } from \'../substrate/process.mjs\';', mentions: 1, reason: 'Import the L0 starter alongside process identity and cleanup operations.', line: 10 },
  { file: 'src/execution/run.mjs', text: 'export async function dispatch({ id, card, directory, sink, provider, command, args, input, cwd, workspace, scratch, env, folder, timeout, facts, digest, host, readTimeout, clock = () => performance.now() }) {', mentions: 2, reason: 'Receive a prepared program, environment and identity for real L1 dispatch.', line: 90 },
  { file: 'src/execution/run.mjs', text: '  if (id === undefined || id === null || id === \'\') throw startFailure(Object.assign(new Error(`L1 was given no dispatch id, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');', mentions: 1, reason: 'Refuse a process start whose dispatch identifier is absent.', line: 93 },
  { file: 'src/execution/run.mjs', text: '  if (!holdsDispatch(id, card)) throw startFailure(Object.assign(new Error(`L1\'s record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');', mentions: 1, reason: 'Refuse a process start whose identity cannot be recorded.', line: 96 },
  { file: 'src/execution/run.mjs', text: '  const start = { command, timeout, ...(workspace === undefined ? {} : { workspace }), ...(facts === undefined ? {} : { facts }), ...(digest === undefined ? {} : { digest }) };', mentions: 1, reason: 'Record the selected program in the dispatch-start event.', line: 99 },
  { file: 'src/execution/run.mjs', text: '      throw startFailure(Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED }), \'groups-unwritable\');', mentions: 1, reason: 'Describe why the process-group record could not be written before a start.', line: 118 },
  { file: 'src/execution/run.mjs', text: '    if (escape !== undefined) throw Object.assign(new Error(`dispatch ${id} did not start ${command}: ${escape}`), { code: NOT_STARTED, startCause });', mentions: 1, reason: 'Refuse a start in a workspace whose safety checks failed.', line: 123 },
  { file: 'src/execution/run.mjs', text: '    if (unread !== undefined) throw startFailure(Object.assign(new Error(`dispatch ${id} did not start ${command}: ${unread}`), { code: NOT_STARTED }), \'directory-unusable\');', mentions: 1, reason: 'Refuse a start whose dispatch directory could not be read.', line: 127 },
  { file: 'src/execution/run.mjs', text: '    result = await runCommand({', mentions: 1, reason: 'Start the prepared role CLI or configured shell through the sole L0 adapter.', line: 129, programs: ['claude', 'codex', '/bin/sh'] },
  { file: 'src/execution/run.mjs', text: '      command,', mentions: 1, reason: 'Forward the prepared program unchanged into L0 options.', line: 130 },
  { file: 'src/execution/run.mjs', text: '      env: workspace === undefined ? env : gitEnvironment(env),', mentions: 4, reason: 'Remove git redirection variables when starting in a card workspace.', line: 136 },
  { file: 'src/execution/run.mjs', text: '    if (failure.startCause?.command !== undefined) {', mentions: 1, reason: 'Recognize a program-bearing structured startup failure.', line: 187 },
  { file: 'src/execution/run.mjs', text: '      const { command: named, ...cause } = failure.startCause;', mentions: 1, reason: 'Remove the raw program from startup-failure details before attribution.', line: 188 },
  { file: 'src/execution/run.mjs', text: '        failure = Object.assign(new Error(`${named(id, card)} ran ${command}, which exited ${result.exit}, and ${kept}`), { code: RECORD_REFUSED, result, recordFailure });', mentions: 1, reason: 'Describe a command result whose process-record removal was refused.', line: 211 },
  { file: 'src/execution/step.mjs', text: 'export const stepDispatch = (step, workspace, env = process.env) => ({', mentions: 4, reason: 'Receive the configured step, workspace and inherited account environment.', line: 19 },
  { file: 'src/execution/step.mjs', text: '  command: \'/bin/sh\',', mentions: 1, reason: 'Select /bin/sh exclusively for the consumer\'s configured step line.', line: 20 },
  { file: 'src/execution/step.mjs', text: '  args: [\'-c\', step.run],', mentions: 2, reason: 'Supply the configured step\'s run line as the shell\'s -c operand.', line: 21 },
  { file: 'src/execution/step.mjs', text: '  cwd: join(workspace, step.cwd ?? \'.\'),', mentions: 1, reason: 'Resolve the configured step\'s working directory inside its workspace.', line: 22 },
  { file: 'src/execution/step.mjs', text: '  env,', mentions: 1, reason: 'Pass the inherited environment into the step dispatch options.', line: 24 },
  { file: 'src/execution/step.mjs', text: '  timeout: stepTimeout(step),', mentions: 1, reason: 'Use the configured step\'s bounded timeout.', line: 25 },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local workspace-operation wrapper that reports failed creation steps.', line: 106 },
  { file: 'src/execution/workspace.mjs', text: '  const removed = await step(async () => {', mentions: 1, reason: 'Remove a replaceable workspace through the checked operation wrapper.', line: 113 },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => head === undefined ? adapter.make(path, branch) : adapter.makeAt(path, branch, head));', mentions: 1, reason: 'Create the requested workspace and branch through the checked operation wrapper.', line: 124 },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local detached-directory operation wrapper with cleanup diagnostics.', line: 164 },
  { file: 'src/execution/workspace.mjs', text: '  const found = await step(() => judgeChecked({ adapter, path, repository }));', mentions: 1, reason: 'Check an existing judge directory before replacing it.', line: 177 },
  { file: 'src/execution/workspace.mjs', text: '  const main = await step(async () => {', mentions: 1, reason: 'Build the detached main directory through checked workspace operations.', line: 178 },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => judgeCleared(adapter, found));', mentions: 1, reason: 'Clear a replaceable judge directory before constructing its head.', line: 186 },
  { file: 'src/execution/workspace.mjs', text: '  await step(async () => {', mentions: 1, reason: 'Construct the detached judge head through the checked operation wrapper.', line: 188 },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local scratch-operation wrapper that records refusal context.', line: 212 },
  { file: 'src/execution/workspace.mjs', text: '  const there = await step(() => scratchReplaceable({ base, path, repository, adapter: workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) }) }));', mentions: 1, reason: 'Check whether the role scratch directory can safely be replaced.', line: 222 },
  { file: 'src/execution/workspace.mjs', text: '    await step(async () => {', mentions: 1, reason: 'Remove a replaceable role scratch directory through the checked operation wrapper.', line: 224 },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => mkdirSync(path, { recursive: true }));', mentions: 1, reason: 'Create the role scratch directory through the checked operation wrapper.', line: 230 },
  { file: 'src/observation/push.mjs', text: 'export function pushAtReturn({ side = PUSH_DEFAULTS.side, spawn, write = PUSH_DEFAULTS.write, now = PUSH_DEFAULTS.now } = {}) {', mentions: 1, reason: 'Receive an optional injected telemetry process starter for the push side.', line: 39 },
  { file: 'src/observation/push.mjs', text: '  const perform = async ({ sink, run, config, repository, directory, answer, handOver }) => {', mentions: 1, reason: 'Receive the recorded run identifier for a return-time telemetry push.', line: 52 },
  { file: 'src/observation/push.mjs', text: '    if (!stream.includes(`"run":${JSON.stringify(run)}`)) return answer;', mentions: 1, reason: 'Push only an event stream containing this run\'s envelope.', line: 64 },
  { file: 'src/observation/push.mjs', text: '      answered = await side({ repository, stream, emitter: sink.emitter({ layer: \'L0\' }), now, ...(spawn === undefined ? {} : { spawn }) });', mentions: 2, reason: 'Forward an explicitly injected starter to the telemetry push side.', line: 67 },
  { file: 'src/observation/report.mjs', text: '    if (!runs.has(event.run)) runs.set(event.run, []);', mentions: 2, reason: 'Group recorded event envelopes by their run identifier.', line: 15 },
  { file: 'src/observation/report.mjs', text: '    runs.get(event.run).push(event);', mentions: 1, reason: 'Append each event to its own run\'s report group.', line: 16 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(events)].map(([run, recorded]) => ({ run, ...rates(recorded) })), stream: rates(events) };', mentions: 2, reason: 'Compute process-tool rates per recorded run and across the stream.', line: 34 },
  { file: 'src/observation/report.mjs', text: '  const runs = [...byRun(events)].map(([run, recorded]) => ({', mentions: 1, reason: 'Compute dispatch summaries from each recorded run\'s events.', line: 58 },
  { file: 'src/observation/report.mjs', text: '    run, durations: ends(recorded).map(({ dispatch, card, ms }) => ({ dispatch, card, ms })), survivors: survivors(recorded),', mentions: 1, reason: 'Return a run identifier with its durations and survivors.', line: 59 },
  { file: 'src/observation/report.mjs', text: '  || (event.event === \'attempt.failed\' && event.class === \'environment\' && event.maker === undefined));', mentions: 1, reason: 'Classify recorded environment failures as host faults.', line: 66 },
  { file: 'src/observation/report.mjs', text: '    if (earlier && earlier.pull.run !== event.run && earlier.interrupted) redos.push({ card: event.card, run: event.run });', mentions: 4, reason: 'Identify a card redone after an interrupted earlier run.', line: 102 },
  { file: 'src/observation/report.mjs', text: '      infrastructure: (classes.get(\'environment\') ?? 0) + (classes.get(\'card-local\') ?? 0) };', mentions: 1, reason: 'Count environment and card-local causes as infrastructure escalations.', line: 129 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(recorded)].map(([run, entries]) => ({ run, ...counts(entries) })), stream: counts(recorded) };', mentions: 2, reason: 'Return escalation-cause counts per run and for the whole stream.', line: 131 },
  { file: 'src/observation/report.mjs', text: '  return events.filter((event) => event.layer === \'L3\' && event.event === \'dispatch\' && event.role !== undefined && event.step === undefined', mentions: 1, reason: 'Distinguish maker dispatch windows from provisioning-step dispatches.', line: 181 },
  { file: 'src/observation/report.mjs', text: '  const runs = [...byRun(events)].map(([run, recorded]) => ({', mentions: 1, reason: 'Compute L2 summaries separately for each recorded run.', line: 262 },
  { file: 'src/observation/report.mjs', text: '    run, hostFaults: { faults: recorded.filter(hostFault).length, claims: workClaims(recorded).length }, escalations: escalationsIn(recorded),', mentions: 1, reason: 'Return a run identifier with its host-fault and escalation summary.', line: 263 },
  { file: 'src/observation/report.mjs', text: '  return [...byRun(events)].map(([run, recorded]) => {', mentions: 1, reason: 'Build L3 interval and utilization summaries for each recorded run.', line: 289 },
  { file: 'src/observation/report.mjs', text: '      run, from, to, releases, pulled, n, queue,', mentions: 1, reason: 'Return the recorded run identifier with its L3 interval figures.', line: 308 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(closes)].map(([run, recorded]) => ({ run, ...counts(recorded) })), stream: counts(closes) };', mentions: 2, reason: 'Count admission holds per run and over the complete stream.', line: 323 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer !== \'L3\' || event.event !== \'dispatch\' || event.card == null || event.step !== undefined', mentions: 1, reason: 'Exclude provisioning-step dispatches from role tier-accuracy measurements.', line: 355 },
  { file: 'src/observation/report.mjs', text: '    runs: [...byRun(events)].map(([run, recorded]) => ({ run, rework: rework(recorded) })),', mentions: 2, reason: 'Return a run identifier beside its rework count.', line: 367 },
  { file: 'src/observation/sink.mjs', text: 'const ENVELOPE = [\'ts\', \'run\', \'layer\', \'event\', \'card\', \'dispatch\'];', mentions: 1, reason: 'Define run as a required field in the local event envelope.', line: 19 },
  { file: 'src/observation/sink.mjs', text: 'export function openSink({ directory, run, now }) {', mentions: 1, reason: 'Receive the run identifier when opening an event sink.', line: 45 },
  { file: 'src/observation/sink.mjs', text: '  required(run, \'run\');', mentions: 2, reason: 'Refuse an event sink without its required run identifier.', line: 46 },
  { file: 'src/observation/sink.mjs', text: '          run,', mentions: 1, reason: 'Write the sink\'s run identifier into each event envelope.', line: 95 },
  { file: 'src/scheduling/admission.mjs', text: '  && typeof content.run === \'string\' && content.run !== \'\';', mentions: 2, reason: 'Validate a hold record\'s nonempty run identifier.', line: 53 },
  { file: 'src/scheduling/admission.mjs', text: 'export function admission({ directory, run, now, sink, ids = randomId, fs = nodeFs }) {', mentions: 1, reason: 'Receive the current run identifier for admission-record operations.', line: 92 },
  { file: 'src/scheduling/admission.mjs', text: '        const { reason, time, run: by } = found.content;', mentions: 1, reason: 'Read the run that wrote an existing admission closer.', line: 159 },
  { file: 'src/scheduling/admission.mjs', text: '        closers.push({ name: entry.name, path, ...named, reason, time, run: by });', mentions: 1, reason: 'Return the recorded closing run beside its reason and timestamp.', line: 160 },
  { file: 'src/scheduling/admission.mjs', text: '    const content = { reason, time: now(), run };', mentions: 1, reason: 'Write the current run into a newly created admission closer.', line: 197 },
  { file: 'src/scheduling/loop.mjs', text: 'import { stepDispatch } from \'../execution/step.mjs\';', mentions: 1, reason: 'Import the configured-step to shell-input adapter into L3.', line: 14 },
  { file: 'src/scheduling/loop.mjs', text: 'function noticeFailed({ step, cause, made, unrecorded }) {', mentions: 1, reason: 'Receive a failed notice operation for structured failure reporting.', line: 48 },
  { file: 'src/scheduling/loop.mjs', text: '  return { step: causeOf(step), cause: causeOf(cause), ...(made === undefined ? {} : { made, unrecorded }) };', mentions: 2, reason: 'Convert a failed notice operation and cause into recordable diagnostics.', line: 49 },
  { file: 'src/scheduling/loop.mjs', text: 'const noticeFailure = ({ id, step, cause, made, unrecorded }) => Object.assign(new Error(made === undefined', mentions: 1, reason: 'Construct an error for a failed notice operation.', line: 58 },
  { file: 'src/scheduling/loop.mjs', text: '  ? `the notice for hold ${id} failed to ${step}: ${cause}`', mentions: 1, reason: 'Explain a notice failure before any issue was made.', line: 59 },
  { file: 'src/scheduling/loop.mjs', text: '  : `the notice for hold ${id} made its step to ${step}, but the sink refused its record, so these events went unrecorded: ${eventsOf(unrecorded)}: ${cause}`), { notice: { id, step, cause, ...(made === undefined ? {} : { made, unrecorded }) } });', mentions: 2, reason: 'Explain partial notice completion with its recorded operation and cause.', line: 60 },
  { file: 'src/scheduling/loop.mjs', text: '  if (!named(event.run) || typeof event.layer !== \'string\' || !/^L[0-5]$/.test(event.layer) || !named(event.event)) return \'its envelope names no run, layer or event\';', mentions: 1, reason: 'Require a valid run field in a recorded event envelope.', line: 408 },
  { file: 'src/scheduling/loop.mjs', text: 'export function loop({ config, board, decide, facts, l2, sink, kill, workspace, workspaceTip, judgeDirectory, escalationDirectory, removeDirectories, state, readRecord = () => [], environment, run, host, readTimeout, clock, drained }) {', mentions: 2, reason: 'Receive L3\'s engine environment and recorded run identifier.', line: 543 },
  { file: 'src/scheduling/loop.mjs', text: '  if (environment === null || typeof environment !== \'object\') throw new Error(`L3 was handed no environment for the dispatches it makes, so it cannot dispatch: the environment is ${environment === null ? \'null\' : typeof environment}`);', mentions: 4, reason: 'Refuse L3 construction without an object environment for real dispatch.', line: 567 },
  { file: 'src/scheduling/loop.mjs', text: '  if (typeof run !== \'string\' || run === \'\') throw new Error(`L3 was handed no run id, so it cannot record a hold\'s closer: the run id is ${JSON.stringify(run) ?? \'undefined\'}`);', mentions: 3, reason: 'Refuse L3 construction without a nonempty recorded run identifier.', line: 568 },
  { file: 'src/scheduling/loop.mjs', text: '  admissionRecord = admission({ directory: state, run, now, sink });', mentions: 1, reason: 'Bind admission operations to L3\'s current run and sink.', line: 569 },
  { file: 'src/scheduling/loop.mjs', text: '  const dispatchStep = async (card, step, path, fields) => {', mentions: 2, reason: 'Receive the configured step and workspace in L3\'s step helper.', line: 614 },
  { file: 'src/scheduling/loop.mjs', text: '      sink.emitter({ layer: \'L3\', card: card.number, dispatch: id }).emit(\'dispatch\', { step: step.name, ...fields });', mentions: 2, reason: 'Record a configured step\'s named start before calling L1.', line: 617 },
  { file: 'src/scheduling/loop.mjs', text: '      throw refusedStart(`card #${card.number}\'s step \\`${step.name}\\` was not started, because the event sink refused to record its start`, refusal);', mentions: 1, reason: 'Refuse a configured step start when its event could not be recorded.', line: 619 },
  { file: 'src/scheduling/loop.mjs', text: '    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', mentions: 3, reason: 'Adapt the configured step and engine environment before the real L1 handoff.', line: 621 },
  { file: 'src/scheduling/loop.mjs', text: '    const run = async () => {', mentions: 1, reason: 'Define the bounded role-start closure used by L3 dispatch.', line: 647 },
  { file: 'src/scheduling/loop.mjs', text: '      const handed = await roleDispatch({ answer: stamp(answer, id), cwd, directory, scratch, repository, reach, maker, env: environment, sink, id, card: card.number });', mentions: 2, reason: 'Prepare the selected role with L3\'s inherited engine environment.', line: 648 },
  { file: 'src/scheduling/loop.mjs', text: '    const [outcome] = await Promise.allSettled([run()]);', mentions: 1, reason: 'Settle the role-start closure without losing its rejection outcome.', line: 651 },
  { file: 'src/scheduling/loop.mjs', text: '    noticing = noticing.then(() => noticed(id, hold, issueState)).catch((thrown) => ({ failed: { step: \'notice\', cause: causeOf(thrown) } }));', mentions: 1, reason: 'Preserve a failed asynchronous hold-notice operation as diagnostic data.', line: 707 },
  { file: 'src/scheduling/loop.mjs', text: '      return { failed: { step: \'notice\', cause: causeOf(thrown) }, unrecorded };', mentions: 1, reason: 'Return an unrecorded hold-notice failure with its operation name.', line: 755 },
  { file: 'src/scheduling/loop.mjs', text: '        const failed = { step: `read issue #${issue}\'s state`, cause: failure };', mentions: 1, reason: 'Attribute a failed hold-state read to that local notice operation.', line: 797 },
  { file: 'src/scheduling/loop.mjs', text: '        while (answer.action === \'dispatch\' && answer.step !== undefined) {', mentions: 1, reason: 'Continue a provisioning attempt only while L2 supplies a configured step.', line: 911 },
  { file: 'src/scheduling/loop.mjs', text: '          outcomes.push(await dispatchStep(card, answer.step, path, { attempt: number }));', mentions: 2, reason: 'Dispatch the exact configured step L2 placed on the attempt answer.', line: 912 },
  { file: 'src/scheduling/loop.mjs', text: '      const step = current.steps[outcomes.length];', mentions: 1, reason: 'Select the next step from the current judge\'s configured step sequence.', line: 1084 },
  { file: 'src/scheduling/loop.mjs', text: '      outcomes.push(await dispatchStep(card, step, head, { role }));', mentions: 2, reason: 'Dispatch the selected judge provisioning step in its checked head directory.', line: 1085 },
  { file: 'src/scheduling/loop.mjs', text: '      if (current === undefined) return { role, withheld: { step: step.name, outcome: outcomes.at(-1) }, decision: answer };', mentions: 2, reason: 'Record which configured judge step was withheld after a changed decision.', line: 1088 },
  { file: 'src/scheduling/loop.mjs', text: '    run: async ({ handOver = () => {}, stop } = {}) => {', mentions: 1, reason: 'Expose L3\'s continuous run operation to the CLI.', line: 1435 },
  { file: 'src/substrate/data-ref.mjs', text: 'import { gitEnvironment } from \'./git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for the git stream push.', line: 4 },
  { file: 'src/substrate/data-ref.mjs', text: 'import { EVENT_REFUSED, runCommand } from \'./process.mjs\';', mentions: 1, reason: 'Import the L0 starter used by the git stream push.', line: 5 },
  { file: 'src/substrate/data-ref.mjs', text: 'export async function pushStream({ repository, stream, emitter, limit = PUSH_TIMEOUT, spawn: run = runCommand, now = Date.now, environment = process.env }) {', mentions: 5, reason: 'Receive the stream push\'s starter and inherited engine environment.', line: 37 },
  { file: 'src/substrate/data-ref.mjs', text: '  const env = { ...gitEnvironment(environment), GIT_TERMINAL_PROMPT: \'0\' };', mentions: 3, reason: 'Disable git terminal prompting in a copy of the inherited environment.', line: 39 },
  { file: 'src/substrate/data-ref.mjs', text: '    const result = await run({ command: \'git\', args, cwd: repository, env, input, timeout, emitter });', mentions: 3, reason: 'Run the git stream operation through the selected L0 starter.', line: 53, programs: ['git'] },
  { file: 'src/substrate/forge/read.mjs', text: 'async function environment(board, via, name, addressed) {', mentions: 1, reason: 'Define a forge-environment reader for repository policy data.', line: 336 },
  { file: 'src/substrate/forge/read.mjs', text: '    const matching = runs.filter((run) => run.name === context && (pin === null || run.app?.id === pin));', mentions: 3, reason: 'Select only check runs matching the required context and App identity.', line: 380 },
  { file: 'src/substrate/forge/read.mjs', text: '    const run = matching.sort((a, b) => b.id - a.id)[0];', mentions: 1, reason: 'Choose the newest matching forge check run.', line: 381 },
  { file: 'src/substrate/forge/read.mjs', text: '    const runState = !run ? null : run.status !== \'completed\' ? \'pending\'', mentions: 2, reason: 'Translate the selected check run\'s status into a gate state.', line: 383 },
  { file: 'src/substrate/forge/read.mjs', text: '      : [\'success\', \'neutral\', \'skipped\'].includes(run.conclusion) ? \'passed\' : \'failed\';', mentions: 1, reason: 'Accept only a completed successful, neutral or skipped forge check run.', line: 384 },
  { file: 'src/substrate/forge/read.mjs', text: '    return labelled(\'readEnvironment\', board, addressed, () => environment(board, via, name, addressed));', mentions: 1, reason: 'Expose the forge-environment read through the repository read runner.', line: 935 },
  { file: 'src/substrate/forge/runners.mjs', text: 'import { gitEnvironment } from \'../git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for forge tool execution.', line: 4 },
  { file: 'src/substrate/forge/runners.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'../process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for authenticated gh operations.', line: 5 },
  { file: 'src/substrate/forge/runners.mjs', text: 'async function throughL0(command, args, { emitter, timeout, side }) {', mentions: 1, reason: 'Receive the reviewed forge command and arguments for a bounded L0 call.', line: 32 },
  { file: 'src/substrate/forge/runners.mjs', text: '    result = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Execute gh with a copied engine environment through the sole L0 starter.', line: 36, programs: ['gh'] },
  { file: 'src/substrate/git-environment.mjs', text: 'export function gitEnvironment(from = process.env) {', mentions: 2, reason: 'Define the account-environment copier with process.env as its default input.', line: 48 },
  { file: 'src/substrate/git-environment.mjs', text: '  const env = {};', mentions: 1, reason: 'Create the destination environment object without inherited properties.', line: 49 },
  { file: 'src/substrate/git-environment.mjs', text: '    if (!REMOVED.has(name.toUpperCase())) env[name] = value;', mentions: 1, reason: 'Copy each account value except a named git redirection variable.', line: 51 },
  { file: 'src/substrate/git-environment.mjs', text: '  return env;', mentions: 1, reason: 'Return the copied repository-safe environment.', line: 53 },
  { file: 'src/substrate/host.mjs', text: 'import * as childProcess from \'node:child_process\';', mentions: 2, reason: 'Confine the native child-process namespace import to the real host module.', line: 3 },
  { file: 'src/substrate/host.mjs', text: '  ps: process.platform === \'linux\' ? fileURLToPath(new URL(\'./process-table.sh\', import.meta.url)) : \'/bin/ps\',', mentions: 1, reason: 'Select local ps or the packaged Linux process-table shim via a file URL.', line: 9 },
  { file: 'src/substrate/host.mjs', text: '  get execFile() { return childProcess.execFile; },', mentions: 3, reason: 'Expose the native execFile reader through the real host getter.', line: 11 },
  { file: 'src/substrate/host.mjs', text: '  get spawn() { return childProcess.spawn; },', mentions: 3, reason: 'Expose the native asynchronous starter through the real host getter.', line: 12 },
  { file: 'src/substrate/host.mjs', text: '  get spawnSync() { return childProcess.spawnSync; },', mentions: 3, reason: 'Expose the native synchronous starter through the real host getter.', line: 13 },
  { file: 'src/substrate/launchd.mjs', text: 'import { runCommand } from \'./process.mjs\';', mentions: 1, reason: 'Import the L0 starter for the local launchd loaded-job read.', line: 5 },
  { file: 'src/substrate/launchd.mjs', text: 'import { gitEnvironment } from \'./git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for that launchd read.', line: 6 },
  { file: 'src/substrate/launchd.mjs', text: 'export async function loadedJob(label, { uid = process.getuid(), emitter, timeout = FORGE_TIMEOUT, run = runCommand } = {}) {', mentions: 2, reason: 'Accept a loaded-job query with L0 as its default starter.', line: 10 },
  { file: 'src/substrate/launchd.mjs', text: '  const result = await run({ command: \'launchctl\', args: [\'print\', `gui/${uid}/${label}`],', mentions: 2, reason: 'Query the local per-user launchd domain with launchctl print.', line: 11, programs: ['launchctl'] },
  { file: 'src/substrate/launchd.mjs', text: '    cwd: process.cwd(), env: gitEnvironment(), emitter, timeout });', mentions: 2, reason: 'Give launchctl the current working directory and copied account environment.', line: 12 },
  { file: 'src/substrate/process.mjs', text: 'export function atExit(step) {', mentions: 1, reason: 'Register a local cleanup callback for engine exit.', line: 206 },
  { file: 'src/substrate/process.mjs', text: '  steps.push(step);', mentions: 1, reason: 'Retain the registered cleanup callback for exit processing.', line: 207 },
  { file: 'src/substrate/process.mjs', text: '  for (const step of steps) attempt(step);', mentions: 2, reason: 'Attempt each registered cleanup callback on engine exit.', line: 294 },
  { file: 'src/substrate/process.mjs', text: 'function attempt(step) {', mentions: 1, reason: 'Define the cleanup-callback refusal boundary.', line: 341 },
  { file: 'src/substrate/process.mjs', text: '    step();', mentions: 1, reason: 'Execute the selected local cleanup callback within that refusal boundary.', line: 343 },
  { file: 'src/substrate/process.mjs', text: '      rows = rowsOf(await run(ps, [\'-g\', String(group), \'-o\', \'pid=,stat=\'], readTimeout, readTimeout, host));', mentions: 1, reason: 'Read the local process group\'s membership through the bounded process reader.', line: 454, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '      const lines = yield* column(\'command\');', mentions: 1, reason: 'Read the local lsof command column for the directory census.', line: 796 },
  { file: 'src/substrate/process.mjs', text: '      const commands = yield* column(\'command\');', mentions: 1, reason: 'Read the second command column needed to validate the lsof census separator.', line: 798 },
  { file: 'src/substrate/process.mjs', text: '        printed = await run(...toolOf(look.value, ps), deadline - host.clock.now(), timeout, host);', mentions: 1, reason: 'Execute the chosen local ps or lsof read within its remaining deadline.', line: 893, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function readingNow(looks, ps, timeout, deadline, now = realHost.clock.now, spawn = realHost.spawnSync) {', mentions: 2, reason: 'Accept a synchronous local process-table starter for bounded read retries.', line: 910 },
  { file: 'src/substrate/process.mjs', text: '      printed = runNow(...toolOf(look.value, ps), deadline - now(), timeout, now, spawn);', mentions: 1, reason: 'Forward that synchronous starter into the bounded local read.', line: 920 },
  { file: 'src/substrate/process.mjs', text: 'function run(ps, args, remaining, timeout, host = realHost) {', mentions: 1, reason: 'Define the asynchronous local ps or lsof program reader.', line: 980 },
  { file: 'src/substrate/process.mjs', text: '    const read = host.execFile(ps, args, { env: PS_ENV, ...reader(remaining), timeout: 0 }, (error, stdout, stderr) => {', mentions: 2, reason: 'Run only the named local process reader with its fixed minimal environment.', line: 984, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function runNow(ps, args, remaining, timeout, now = realHost.clock.now, spawn = realHost.spawnSync) {', mentions: 2, reason: 'Accept a synchronous local-reader starter with the real host as default.', line: 1008 },
  { file: 'src/substrate/process.mjs', text: '    const printed = runOnce(ps, args, remaining, timeout, spawn);', mentions: 1, reason: 'Forward the selected starter to one bounded synchronous read attempt.', line: 1011 },
  { file: 'src/substrate/process.mjs', text: 'function runOnce(ps, args, remaining, timeout, spawn = realHost.spawnSync) {', mentions: 2, reason: 'Define one synchronous local-reader attempt with the real host as default.', line: 1021 },
  { file: 'src/substrate/process.mjs', text: '  const { error, status, signal: ending, stdout, stderr } = spawn(ps, args, { env: PS_ENV, ...reader(remaining) });', mentions: 2, reason: 'Start the local ps or lsof reader with its fixed minimal environment and bound.', line: 1024, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  const within = (step, spare = 0) => {', mentions: 1, reason: 'Define a local cleanup-stage reader within the containment deadline.', line: 1076 },
  { file: 'src/substrate/process.mjs', text: '    return reading(step(deadline), ps, readTimeout, deadline + spare, trace, host);', mentions: 1, reason: 'Obtain the cleanup-stage reads and execute them with their remaining bound.', line: 1078 },
  { file: 'src/substrate/process.mjs', text: '  const spawn = host.spawnSync;', mentions: 2, reason: 'Use this host\'s synchronous starter for synchronous containment reads.', line: 1160 },
  { file: 'src/substrate/process.mjs', text: '  const within = (step, spare = 0) => {', mentions: 1, reason: 'Define a local synchronous cleanup-stage reader within its deadline.', line: 1164 },
  { file: 'src/substrate/process.mjs', text: '    return readingNow(step(deadline), ps, readTimeout, deadline + spare, now, spawn);', mentions: 2, reason: 'Forward the cleanup-stage reads to the chosen synchronous starter.', line: 1166 },
  { file: 'src/substrate/process.mjs', text: '    ({ leader, stuck } = readingNow(emptied(group, seen, kill, readTimeout, now), ps, readTimeout, undefined, now, spawn));', mentions: 1, reason: 'Read the emptied process group through the chosen synchronous starter.', line: 1184 },
  { file: 'src/substrate/process.mjs', text: '  const found = readingNow(sweeping(directory, lsof, kill, true, host), ps, readTimeout, began + readTimeout, host.clock.now, host.spawnSync);', mentions: 1, reason: 'Use the host\'s synchronous starter for a directory-census sweep.', line: 1665 },
  { file: 'src/substrate/process.mjs', text: '  return sweptEvents(directory, readingNow(settled(found, kill, readTimeout, host.clock.now), ps, readTimeout, (found.killedAt ?? began) + readTimeout, host.clock.now, host.spawnSync), killed);', mentions: 1, reason: 'Check the settled directory census through that same synchronous starter.', line: 1670 },
  { file: 'src/substrate/process.mjs', text: 'export async function runCommand({ command, args, cwd, env, input, timeout, emitter, onGroup, onExit, directory, scratch, host = realHost, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND, trace }) {', mentions: 3, reason: 'Receive the reviewed program, inherited environment and containment options at L0.', line: 1783 },
  { file: 'src/substrate/process.mjs', text: '  if (typeof emitter?.emit !== \'function\') throw startFailure(Object.assign(new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`), { code: NOT_STARTED }), \'event-emitter-missing\');', mentions: 1, reason: 'Refuse a process start when no L0 event emitter was supplied.', line: 1789 },
  { file: 'src/substrate/process.mjs', text: '    throw startFailure(Object.assign(new Error(`the process adapter was given the timeout ${shown(timeout)} (of type ${type}), which is not a positive finite number of milliseconds, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-timeout\');', mentions: 1, reason: 'Refuse a process start with a nonpositive or nonfinite timeout.', line: 1793 },
  { file: 'src/substrate/process.mjs', text: '  if (unfit !== undefined) throw startFailure(notStarted(command, unfit), \'directory-unusable\');', mentions: 1, reason: 'Refuse a process start in an unsuitable working directory.', line: 1796 },
  { file: 'src/substrate/process.mjs', text: '  if (why !== undefined) throw startFailure(notStarted(command, why), real === undefined ? \'directory-unusable\' : \'directory-illegible\', real === undefined ? {} : { path: real });', mentions: 1, reason: 'Refuse a process start when its real working directory is illegible.', line: 1800 },
  { file: 'src/substrate/process.mjs', text: '  if (scratchWhy !== undefined) throw startFailure(notStarted(command, scratchWhy), scratchReal === undefined ? \'directory-unusable\' : \'scratch-illegible\', scratchReal === undefined ? {} : { path: scratchReal });', mentions: 1, reason: 'Refuse a process start when its scratch directory is unsuitable or illegible.', line: 1802 },
  { file: 'src/substrate/process.mjs', text: '  const child = spawned(command, () => host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, \'pipe\', \'pipe\'] }), cwd, host);', mentions: 4, reason: 'Start the selected reviewed tool or configured shell with its inherited environment.', line: 1805, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', 'launchctl'] },
  { file: 'src/substrate/process.mjs', text: '    throw spawnFailure(command, error, cwd, host);', mentions: 1, reason: 'Classify a native start failure without inventing a process outcome.', line: 1809 },
  { file: 'src/substrate/process.mjs', text: '  if (unrecorded.length > 0) throw refused(unrecorded, result, timedOut ? `the timeout of ${timeout} ms ended ${command}, and ` : \'\');', mentions: 1, reason: 'Report events refused while the selected command was ending.', line: 1870 },
  { file: 'src/substrate/process.mjs', text: '  const read = host.spawnSync(ps, [\'-p\', String(pid), \'-o\', \'lstart=\'], { env: PS_ENV, timeout, killSignal: \'SIGKILL\', encoding: \'utf8\' });', mentions: 2, reason: 'Read a local PID\'s start time with ps or the packaged Linux shim.', line: 1971, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '      rows = rowsOf(await run(ps, [\'-ww\', \'-g\', String(group), \'-o\', \'pid=,stat=,lstart=\'], remaining, timeout, host));', mentions: 1, reason: 'Read local group members and start times through the bounded process reader.', line: 2039, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: 'function spawned(command, spawning, cwd, host = realHost) {', mentions: 1, reason: 'Define the native-start error boundary for the selected program.', line: 2091 },
  { file: 'src/substrate/process.mjs', text: '    throw spawnFailure(command, error, cwd, host);', mentions: 1, reason: 'Attribute a synchronous native-start refusal to the selected program.', line: 2095 },
  { file: 'src/substrate/process.mjs', text: 'function spawnFailure(command, error, cwd, host = realHost) {', mentions: 1, reason: 'Construct the selected program\'s structured native-start failure.', line: 2112 },
  { file: 'src/substrate/process.mjs', text: '  const failure = notStarted(command, error.message);', mentions: 1, reason: 'Preserve the native error message in the selected program\'s start failure.', line: 2113 },
  { file: 'src/substrate/process.mjs', text: '    ? { kind: \'directory-unusable\' } : { kind, ...(executable ? { command } : {}) };', mentions: 1, reason: 'Record a program operand only for executable-related native startup failures.', line: 2117 },
  { file: 'src/substrate/process.mjs', text: 'const notStarted = (command, why) => Object.assign(new Error(`the process adapter did not start ${command}: ${why}`), { code: NOT_STARTED });', mentions: 2, reason: 'Describe a program that never started without claiming it ran.', line: 2176 },
  { file: 'src/substrate/process.mjs', text: '    const step = Math.min(left, TIMER_MAX);', mentions: 1, reason: 'Compute a local timer segment no longer than the platform\'s maximum delay.', line: 2201 },
  { file: 'src/substrate/process.mjs', text: '    timer = schedule(() => (left > step ? arm(left - step) : done()), step);', mentions: 3, reason: 'Chain the remaining local timer segments before completing the requested wait.', line: 2202 },
  { file: 'src/substrate/providers/claude.mjs', text: 'export function cliFolder(directory, environment) {', mentions: 1, reason: 'Receive the account environment when locating the Claude CLI folder.', line: 119 },
  { file: 'src/substrate/providers/claude.mjs', text: '  const home = Object.hasOwn(environment, \'CLAUDE_CONFIG_DIR\')', mentions: 1, reason: 'Prefer the account\'s explicitly configured Claude home.', line: 120 },
  { file: 'src/substrate/providers/claude.mjs', text: '    ? environment.CLAUDE_CONFIG_DIR', mentions: 1, reason: 'Use the account\'s configured Claude home without constructing another credential path.', line: 121 },
  { file: 'src/substrate/providers/claude.mjs', text: '    : (typeof environment.HOME === \'string\' ? join(environment.HOME, \'.claude\') : undefined);', mentions: 2, reason: 'Fall back to the account\'s HOME when locating its Claude home.', line: 122 },
  { file: 'src/substrate/providers/claude.mjs', text: 'export async function invocation({ agent, tier, prompt, directory, card, reach = [], emitter, environment = process.env }) {', mentions: 2, reason: 'Receive the account environment and role inputs for a Claude invocation.', line: 370 },
  { file: 'src/substrate/providers/claude.mjs', text: '    command: \'claude\',', mentions: 1, reason: 'Select the configured Claude agent CLI as the role program.', line: 396 },
  { file: 'src/substrate/providers/claude.mjs', text: '    env: { [TMPDIR_KEY]: join(real, TMPDIR_NAME) },', mentions: 1, reason: 'Add only the workspace-derived Claude temporary-directory variable.', line: 411 },
  { file: 'src/substrate/providers/claude.mjs', text: '    folder: cliFolder(real, environment),', mentions: 1, reason: 'Locate the role\'s CLI folder using the same inherited account environment.', line: 412 },
  { file: 'src/substrate/providers/codex.mjs', text: 'import { gitEnvironment } from \'../git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for the Codex skill probe.', line: 11 },
  { file: 'src/substrate/providers/codex.mjs', text: 'import { runCommand } from \'../process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for the bounded Codex skill probe.', line: 12 },
  { file: 'src/substrate/providers/codex.mjs', text: '  const { exit, timedOut, stdout, stderr } = await runCommand({ command: \'codex\', args, cwd: directory, env: { ...gitEnvironment(), CODEX_HOME: home }, timeout, emitter, host });', mentions: 4, reason: 'Run the Codex probe with the made Codex home and copied account environment.', line: 255, programs: ['codex'] },
  { file: 'src/substrate/providers/codex.mjs', text: 'const ownerHome = () => process.env.CODEX_HOME || join(homedir(), \'.codex\');', mentions: 1, reason: 'Locate the account\'s own Codex home for its existing configuration and auth link.', line: 272 },
  { file: 'src/substrate/providers/codex.mjs', text: '    command: \'codex\',', mentions: 1, reason: 'Select the configured Codex agent CLI as the role program.', line: 328 },
  { file: 'src/substrate/providers/codex.mjs', text: '    env: { CODEX_HOME: home, TMPDIR: temporary, TMPPREFIX: join(temporary, \'zsh\') },', mentions: 1, reason: 'Add only the made Codex home and scratch-derived temporary-directory variables.', line: 341 },
  { file: 'src/substrate/worktrees.mjs', text: 'import { gitEnvironment } from \'./git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for git workspace operations.', line: 8 },
  { file: 'src/substrate/worktrees.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'./process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for git workspace operations.', line: 9 },
  { file: 'src/substrate/worktrees.mjs', text: 'function queued(step) {', mentions: 1, reason: 'Define a local serialized workspace-operation callback.', line: 78 },
  { file: 'src/substrate/worktrees.mjs', text: '  const ran = tail.then(step);', mentions: 1, reason: 'Queue that workspace operation after the earlier operation settles.', line: 79 },
  { file: 'src/substrate/worktrees.mjs', text: '      result = await runCommand({ command: git, args, cwd: repository, env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Run git workspace operations through L0 with a repository-safe account environment.', line: 97, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const command = `\\`${[git, ...args].join(\' \')}\\``;', mentions: 1, reason: 'Format the selected git invocation for a failure diagnostic.', line: 511 },
  { file: 'src/substrate/worktrees.mjs', text: '  if (timedOut) return new Error(`${command} ran past its timeout of ${timeout} ms, and L0 ended it`);', mentions: 1, reason: 'Explain that the selected git invocation exceeded its bound.', line: 512 },
  { file: 'src/substrate/worktrees.mjs', text: '  return new Error(`${command} exited ${exit}: ${firstLine(stderr)}`);', mentions: 1, reason: 'Explain the selected git invocation\'s nonzero exit and first stderr line.', line: 513 },
  { file: 'src/workflow/form-check.mjs', text: '  const run = /^ {0,3}(`+|~+)[ \\t]*$/.exec(line)?.[1];', mentions: 1, reason: 'Read the marker length of a local Markdown closing fence.', line: 30 },
  { file: 'src/workflow/form-check.mjs', text: '  return run !== undefined && run[0] === marks[0] && run.length >= marks.length;', mentions: 3, reason: 'Require the closing fence to match the opening marker and minimum length.', line: 31 },
  { file: 'src/workflow/judges.mjs', text: 'import { failed, kindOf, panelOf, selectedSteps, stepAnswer, tierOf } from \'./next-action.mjs\';', mentions: 1, reason: 'Import L2\'s configured-step producer into judge decision construction.', line: 14 },
  { file: 'src/workflow/judges.mjs', text: 'export function judgeAnswer(card, kinds, epicLabel, { roles = {}, provisioning = {}, sink, outcomes = {}, directories: reports = {} } = {}) {', mentions: 1, reason: 'Receive the consumer\'s provisioning map when constructing a judge decision.', line: 99 },
  { file: 'src/workflow/judges.mjs', text: '  const steps = selectedSteps(card, declared, provisioning);', mentions: 1, reason: 'Select the judge\'s configured provisioning steps for this card.', line: 137 },
  { file: 'src/workflow/judges.mjs', text: '        || withheld(card, role, steps, outcomes[role] ?? [], provisioning, sink);', mentions: 1, reason: 'Check whether configured provisioning failures withhold a judge.', line: 148 },
  { file: 'src/workflow/judges.mjs', text: '      ...(governing.has(role) ? { comment: governing.get(role).comment } : {}), steps: steps.map((name) => stepAnswer(name, provisioning)) }));', mentions: 2, reason: 'Construct each judge\'s configured steps through the shared L2 step producer.', line: 153 },
  { file: 'src/workflow/judges.mjs', text: '    const classified = (report) => ({ class: \'environment\', ...judgeFailure(retry, report), ...(report?.dispatch === undefined ? {} : { dispatch: report.dispatch }) });', mentions: 1, reason: 'Classify a judge execution failure as an environment failure.', line: 159 },
  { file: 'src/workflow/judges.mjs', text: '    record(sink, card, \'judge.withheld\', { role, scratch: missing, reason: message, class: \'environment\' }, `judge ${role}\'s scratch directory was not made`);', mentions: 1, reason: 'Record a judge withheld because its scratch directory was not made.', line: 241 },
  { file: 'src/workflow/judges.mjs', text: '  record(sink, card, \'judge.withheld\', { role, directory: outcome.reason.path, reason: outcome.reason.message, class: \'environment\' }, `judge ${role}\'s directory was not made`);', mentions: 1, reason: 'Record a judge withheld because its checked directory was not made.', line: 248 },
  { file: 'src/workflow/judges.mjs', text: 'function withheld(card, role, steps, outcomes, provisioning, sink) {', mentions: 1, reason: 'Receive the provisioning map when deciding whether to withhold a judge.', line: 256 },
  { file: 'src/workflow/judges.mjs', text: '    const failure = failed(outcome, provisioning[name], card, name);', mentions: 1, reason: 'Classify a named judge provisioning-step outcome against its declaration.', line: 259 },
  { file: 'src/workflow/judges.mjs', text: '    if (failure === undefined || !workRequires(provisioning[name])) continue;', mentions: 1, reason: 'Continue past successful or optional judge provisioning steps.', line: 260 },
  { file: 'src/workflow/judges.mjs', text: '    record(sink, card, \'judge.withheld\', { role, step: name, ...failure, class: \'environment\' }, `judge ${role}\'s required step \\`${name}\\` failed`);', mentions: 2, reason: 'Record the required configured step whose failure withholds a judge.', line: 261 },
  { file: 'src/workflow/marker.mjs', text: '      const run = /^ {0,3}(`+|~+)[ \\t]*$/.exec(line)?.[1];', mentions: 1, reason: 'Read the marker length of a second local Markdown fenced block.', line: 219 },
  { file: 'src/workflow/marker.mjs', text: '      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length) fence = null;', mentions: 3, reason: 'Close that Markdown block only for a matching marker of sufficient length.', line: 220 },
  { file: 'src/workflow/next-action.mjs', text: 'export function nextAction(given, kinds, epicLabel, { roles, topic = worktreeTopic(), provisioning, outcomes = [], sink, attempt = 1, firstFailure, workspace, maker, forge, judged, directories, continuing } = {}) {', mentions: 1, reason: 'Receive the consumer\'s provisioning map for an L2 next-action decision.', line: 98 },
  { file: 'src/workflow/next-action.mjs', text: '    && !(provisioning !== undefined && (attempt !== 1 || workspace !== undefined || outcomes.length > 0));', mentions: 1, reason: 'Avoid the early routing path once provisioning or an attempt outcome needs evaluation.', line: 105 },
  { file: 'src/workflow/next-action.mjs', text: '    return within(card, kind, kinds[kind], { roles, tier: tier?.tier, topic, provisioning: provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace, maker, continuing });', mentions: 2, reason: 'Pass the declared provisioning map into L2\'s maker-work decision.', line: 125 },
  { file: 'src/workflow/next-action.mjs', text: '  if (held?.action === \'judge\') return routed(reviewAnswer(card, kinds, epicLabel, { roles, provisioning, sink, outcomes: judged, directories }));', mentions: 1, reason: 'Give a held judge decision the same consumer provisioning map.', line: 129 },
  { file: 'src/workflow/next-action.mjs', text: '  if (provisioning === undefined && maker === undefined) return removing({ action: \'dispatch\', kind });', mentions: 1, reason: 'Preserve the early routing answer when no provisioning or maker decision is supplied.', line: 143 },
  { file: 'src/workflow/next-action.mjs', text: '  return removing(within(card, kind, kinds[kind], { roles, tier: tier?.tier, topic, provisioning: provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace, maker }));', mentions: 2, reason: 'Build a complete maker-work answer with the declared provisioning map.', line: 144 },
  { file: 'src/workflow/next-action.mjs', text: 'function within(card, kind, declared, { roles, tier, topic, provisioning, outcomes, sink, attempt, firstFailure, workspace, maker, continuing }) {', mentions: 1, reason: 'Receive declared provisioning while evaluating a maker-work decision.', line: 204 },
  { file: 'src/workflow/next-action.mjs', text: '  const steps = selectedSteps(card, declared, provisioning);', mentions: 1, reason: 'Select configured provisioning steps for this card and kind.', line: 212 },
  { file: 'src/workflow/next-action.mjs', text: '    const failure = failed(outcome, provisioning[name], card, name);', mentions: 1, reason: 'Classify a completed configured step against its declared failure policy.', line: 218 },
  { file: 'src/workflow/next-action.mjs', text: '    if (workRequires(provisioning[name])) return failedAttempt(card, attempt, firstFailure, { step: name, ...failure, ...dispatchOf(outcome) }, sink);', mentions: 2, reason: 'Stop a maker attempt when its required configured step failed.', line: 220 },
  { file: 'src/workflow/next-action.mjs', text: '        sink.emitter({ layer: \'L2\', card: card.number }).emit(\'step.failed\', { step: name, ...failure, optional: true });', mentions: 1, reason: 'Record a failed optional configured step without withholding work.', line: 223 },
  { file: 'src/workflow/next-action.mjs', text: '  return { action: \'dispatch\', kind, step: stepAnswer(steps[outcomes.length], provisioning) };', mentions: 3, reason: 'Produce the next configured step through the shared L2 step producer.', line: 230 },
  { file: 'src/workflow/next-action.mjs', text: 'export function stepAnswer(name, provisioning) {', mentions: 2, reason: 'Receive a declared step name and the consumer\'s provisioning map.', line: 237 },
  { file: 'src/workflow/next-action.mjs', text: '  const { run, cwd, timeout } = provisioning[name];', mentions: 2, reason: 'Read the selected step\'s run line, directory and timeout from its declaration.', line: 238 },
  { file: 'src/workflow/next-action.mjs', text: '  return { name, run, ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) };', mentions: 1, reason: 'Return the configured run line and optional directory and timeout unchanged.', line: 239 },
  { file: 'src/workflow/next-action.mjs', text: '  if (first?.class !== \'environment\' || second.class !== \'environment\') return false;', mentions: 2, reason: 'Compare two recorded infrastructure failures only within the environment class.', line: 247 },
  { file: 'src/workflow/next-action.mjs', text: '  if (first.step === undefined || second.step === undefined || first.step !== second.step) return false;', mentions: 4, reason: 'Treat infrastructure failures as the same route only for the same configured step.', line: 251 },
  { file: 'src/workflow/next-action.mjs', text: '  const failure = { class: cardLocal ? \'card-local\' : out ? \'out\' : \'environment\', ...what };', mentions: 1, reason: 'Classify a failed attempt without confusing card-local and environment causes.', line: 273 },
  { file: 'src/workflow/next-action.mjs', text: '  const again = refusals.length === 0 && failure.class === \'environment\' && attempt < ATTEMPTS;', mentions: 1, reason: 'Retry an environment failure only within the declared attempt bound.', line: 275 },
  { file: 'src/workflow/next-action.mjs', text: 'export function failed(outcome, step, card, name) {', mentions: 1, reason: 'Receive a configured step when classifying its execution outcome.', line: 312 },
  { file: 'src/workflow/next-action.mjs', text: '  if (timedOut) return { timeout: stepTimeout(step) };', mentions: 1, reason: 'Attribute a timed-out step to that configured step\'s timeout.', line: 319 },
  { file: 'src/workflow/next-action.mjs', text: 'export const selectedSteps = (card, kind, provisioning) => (kind.provisioning ?? [])', mentions: 2, reason: 'Read a kind\'s configured provisioning sequence.', line: 328 },
  { file: 'src/workflow/next-action.mjs', text: '  .filter((name) => provisioning[name].select?.labels.some((label) => carries(card, label)) ?? true);', mentions: 1, reason: 'Filter configured provisioning steps by their declared card-label selectors.', line: 329 },
  { file: 'src/workflow/status-issue.mjs', text: 'const failedPart = (failure) => (failure.step !== undefined ? `step \\`${failure.step}\\``', mentions: 2, reason: 'Format the configured step named by a failure for a status issue.', line: 17 },
  { file: 'src/workflow/status-issue.mjs', text: 'export function holdBody({ id, reason, run, hold, admission }) {', mentions: 1, reason: 'Receive the recorded closing run for a hold\'s status-issue body.', line: 25 },
  { file: 'src/workflow/status-issue.mjs', text: '    `- Run: ${run}`,', mentions: 1, reason: 'Include that recorded run identifier in the hold\'s status issue.', line: 32 },
  { file: 'src/workflow/status-issue.mjs', text: '    const step = (named, act) => {', mentions: 1, reason: 'Define a local notice-operation wrapper that records partial completion.', line: 120 },
  { file: 'src/workflow/status-issue.mjs', text: '      readNewestNumber: () => step(\'read the newest number\', () => reads.readNewestNumber()),', mentions: 1, reason: 'Read the newest status-issue number through the notice-operation wrapper.', line: 135 },
  { file: 'src/workflow/status-issue.mjs', text: '      readIssue: (number) => step(`read issue #${number}`, () => reads.readIssue(number)),', mentions: 1, reason: 'Read a status issue through the notice-operation wrapper.', line: 136 },
  { file: 'src/workflow/status-issue.mjs', text: '      readPermission: (author) => step(`read ${author}\'s permission`, () => reads.readPermission(author)),', mentions: 1, reason: 'Read its author\'s permission through the notice-operation wrapper.', line: 137 },
  { file: 'src/workflow/status-issue.mjs', text: '      const issue = await step(`read issue #${number}`, () => reads.readIssue(number));', mentions: 1, reason: 'Read a followed status issue through the notice-operation wrapper.', line: 146 },
  { file: 'src/workflow/status-issue.mjs', text: '      const timeline = await step(`read issue #${number}\'s timeline`, () => reads.readIssueTimeline(number));', mentions: 1, reason: 'Read the followed issue\'s timeline through the notice-operation wrapper.', line: 148 },
  { file: 'src/workflow/status-issue.mjs', text: '        && WRITERS.includes(await step(`read ${issue.author}\'s permission`, () => reads.readPermission(issue.author)));', mentions: 1, reason: 'Check the followed issue author\'s permission through the same wrapper.', line: 150 },
  { file: 'src/workflow/status-issue.mjs', text: '      if (!reached) await step(`comment on issue #${number}`, () => writes.postIssueComment(number, holdComment({ id: closer.id, reason: closer.reason, card: hold?.card })));', mentions: 1, reason: 'Comment on a reached hold-status issue through the notice-operation wrapper.', line: 154 },
  { file: 'src/workflow/status-issue.mjs', text: '      const item = (await step(\'read the board\', () => board.readItems())).find((each) => each.number === number);', mentions: 1, reason: 'Find the hold-status issue on the board through the notice-operation wrapper.', line: 165 },
  { file: 'src/workflow/status-issue.mjs', text: '        const id = item?.id ?? await step(`add issue #${number} to the board`, () => items.addIssue(number));', mentions: 1, reason: 'Add an absent status issue to the board through the notice-operation wrapper.', line: 167 },
  { file: 'src/workflow/status-issue.mjs', text: '        await step(`move issue #${number} to Owner`, () => items.moveItem(id, columns.owner));', mentions: 1, reason: 'Move that status issue to Owner through the notice-operation wrapper.', line: 168 },
  { file: 'src/workflow/status-issue.mjs', text: '        return { failed: { step: at, cause: causeOf(failure), made, ...(unrecorded === undefined ? {} : { unrecorded }) } };', mentions: 1, reason: 'Report partial notice completion with the failed operation and any unrecorded events.', line: 182 },
  { file: 'src/workflow/status-issue.mjs', text: '      const failed = { step: at, cause: causeOf(failure) };', mentions: 1, reason: 'Preserve the current notice operation when returning its failure.', line: 184 },
  { file: 'src/workflow/status-issue.mjs', text: '        if (isStatus(await step(`read issue #${other}`, () => reads.readIssue(other)))) {', mentions: 1, reason: 'Check an existing candidate status issue through the notice-operation wrapper.', line: 199 },
  { file: 'src/workflow/status-issue.mjs', text: '      number ??= (await step(`read the open issues labelled ${status}`, () => reads.readLabelledIssues(status)))[0];', mentions: 1, reason: 'Read the open labelled status issue through the notice-operation wrapper.', line: 204 },
  { file: 'src/workflow/status-issue.mjs', text: '        await step(`comment on issue #${number}`, () => writes.postIssueComment(number, holdComment({ id: closer.id, reason: closer.reason, card: hold?.card })));', mentions: 1, reason: 'Comment on the selected status issue through the notice-operation wrapper.', line: 207 },
  { file: 'src/workflow/status-issue.mjs', text: '        yield* renamed(\'after\', await step(\'read the newest number\', () => reads.readNewestNumber()));', mentions: 1, reason: 'Verify the newest number after writing a status issue through the same wrapper.', line: 209 },
  { file: 'src/workflow/status-issue.mjs', text: '        number = await step(\'open the status issue\', () => writes.openIssue(TITLE, holdBody({ id: closer.id, reason: closer.reason, run: closer.run, hold, admission }), status));', mentions: 3, reason: 'Open the hold-status issue with its recorded closing run and track its operation.', line: 210 },
  { file: 'src/workflow/transitions.mjs', text: '        return ownerEscalation(next, { class: \'environment\', category: \'ambiguous\', reason: `role ${next.destination} did not start twice: ${firstFailure.reason.message}; ${outcome.reason.message}`, dispatch });', mentions: 1, reason: 'Escalate a destination role that failed to start twice as an environment failure.', line: 390 },
  { file: 'src/workflow/transitions.mjs', text: '        if (outcome.reason?.code === NOT_STARTED) note(card, \'maker.failed\', { class: \'environment\', reason: outcome.reason.message }, { dispatch });', mentions: 1, reason: 'Record a maker startup failure in the environment class.', line: 474 },
];

/** Table S is copied from the card; offsets and cooked names are independent refusal oracles. */
const TABLE_S = [
  { id: 'S1', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nimport { runCommand as attackStart } from \'../substrate/process.mjs\';\nfunction attackPick() { return attackStart; }\nconst attackThrough = (start) => start({ command: \'curl\', args: [\'https://example.invalid\'] });\nclass AttackHolder { start = attackStart; }\nconst attackHeld = new Map([[\'start\', attackStart]]);\nconst attackPending = Promise.resolve(attackStart);\nconst attackEngine = () => process.env;\nconst attackPrototype = () => URL.prototype;\nasync function unlistedAttack3() { attackPick()({ command: \'curl\', args: [\'https://example.invalid\'] }); attackThrough(attackStart); new AttackHolder().start({ command: \'curl\', args: [\'https://example.invalid\'] }); attackHeld.get(\'start\')({ command: \'curl\', args: [\'https://example.invalid\'] }); (await attackPending)({ command: \'curl\', args: [\'https://example.invalid\'] }); attackEngine().HTTPS_PROXY = \'http://example.invalid\'; attackPrototype().toString = () => process.env.RIGGER_PLUGIN; }', checks: [[1, "runCommand"], [3, "command"], [7, "env"], [8, "URL"], [9, "command"]] },
  { id: 'S2', file: 'src/execution/role.mjs', anchor: '  Object.assign(environment, set);', replacement: '  Object.assign(environment, set);\n  const located = () => environment;\n  if (env.RIGGER_EXTRA) located().EXTRA_TOKEN = \'invented\';\n  for (const saved of [environment]) if (env.RIGGER_EXTRA) saved.EXTRA_TOKEN = \'invented\';\n  if (env.RIGGER_EXTRA) Object.assign(located(), { EXTRA_TOKEN: \'invented\' });', checks: [[1, "environment"], [2, "env"], [3, "environment"], [4, "env"]] },
  { id: 'S3', file: 'src/scheduling/loop.mjs', anchor: '    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', replacement: '    for (const located of [step]) located.run = \'curl https://example.invalid\';\n    Object.assign((() => step)(), { run: \'curl https://example.invalid\' });\n    new (class { constructor(s) { s.run = \'curl https://example.invalid\'; } })(step);\n    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', checks: [[0, "step"], [1, "run"], [2, "run"]] },
  { id: 'S4', file: 'src/workflow/next-action.mjs', anchor: '  const { run, cwd, timeout } = provisioning[name];', replacement: '  const { cwd, timeout } = provisioning[name];\n  const run = \'curl https://example.invalid\';', checks: [[0, "provisioning"], [1, "run"]] },
  { id: 'S5', file: 'src/substrate/host.mjs', anchor: 'export const realHost = {', replacement: 'function natives() { return childProcess; }\nfunction unlistedAttack3() { return natives().exec(\'curl https://example.invalid\'); }\nexport const realHost = {', checks: [[0, "childProcess"]] },
  { id: 'S6', file: 'src/workflow/judges.mjs', anchor: 'steps: steps.map((name) => stepAnswer(name, provisioning)) }));', replacement: 'steps: steps.map((name) => ({ ...stepAnswer(name, provisioning), run: \'curl https://example.invalid\' })) }));', checks: [[0, "run"]] },
  { id: 'S7', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nconst holder = {}; holder.start = runCommand;\nconst { start = runCommand } = {};', checks: [[1, "runCommand"], [2, "runCommand"]] },
  { id: 'S8', file: 'src/scheduling/loop.mjs', anchor: '    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', replacement: 'step = { ...step, run: \'curl https://example.invalid\' };\n    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', checks: [[0, "step"]] },
  { id: 'S9', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nprocess[`env`].HTTPS_PROXY = \'http://example.invalid\';\nnew URL(\'a:b\').__proto__.toString = () => \'\';\nObject.getPrototypeOf(new URL(\'a:b\')).toString = () => \'\';', checks: [[1, "env"], [2, "__proto__"], [2, "URL"], [3, "URL"]] },
  { id: 'S10', file: 'src/workflow/next-action.mjs', anchor: '  return { name, run, ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) };', replacement: '  return { name, run: \'curl https://example.invalid\', ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) };', checks: [[0, "run"]] },
  { id: 'S11', file: 'src/execution/step.mjs', anchor: '  args: [\'-c\', step.run],', replacement: '  args: [\'-c\', \'curl https://example.invalid\'],', checks: [[0, "run"]] },
  { id: 'S12', file: 'src/execution/step.mjs', anchor: '  command: \'/bin/sh\',', replacement: '  command: \'/usr/bin/curl\',', checks: [[0, "command"]] },
  { id: 'S13', file: 'src/substrate/host.mjs', anchor: '};\n', replacement: '};\nexport const unreviewedNative = {\n  get spawn() { return childProcess.spawn; },\n};\n', checks: [[2, "spawn"]] },
  { id: 'S14', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nconst k = `\\x65nv`; process[k];\nprocess[`\\x65nv`];', checks: [[1, "env"], [2, "env"]] },
];

// proves R-SAFE-2
test('S1 to S14: the card fixtures are refused at their added or changed source lines', () => {
  const original = packageReport();
  assert.deepEqual(original.violations, [], 'The real closure is the admitted fixture premise');
  for (const { id, file, anchor, replacement, checks } of TABLE_S) {
    const sources = new Map([...original.modules].map(([name, { source }]) => [name, source]));
    const source = sources.get(file);
    assert.equal(source.split(anchor).length - 1, 1, `${id}: the card anchor occurs exactly once`);
    const start = source.slice(0, source.indexOf(anchor)).split('\n').length;
    sources.set(file, source.replace(anchor, replacement));
    assert.ok(sources.get(file).includes(replacement), `${id}: the exact replacement is present in the closure copy`);
    const report = networkReport((name) => sources.get(name), ENTRY_POINTS, REVIEWED_SITES);
    for (const [offset, name] of checks) assert.ok(report.violations.some((line) => line.startsWith(`${file}:${start + offset} P `) && line.slice(line.indexOf(' P ') + 3).includes(name)), `${id}: refuse ${name} at ${file}:${start + offset}: ${report.violations.join('\n')}`);
  }
});
