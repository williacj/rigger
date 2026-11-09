// ABOUTME: Guards the entry-point import closure and process programs against network routes outside the owner's tools.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { parse } from 'acorn';

// proves R-SAFE-2
test('N1 and N2: the closure refuses unlisted built-ins through imports, re-exports and literal imports', () => {
  for (const specifier of ['node:https', 'node:child_process', 'http', 'dns/promises', 'node:dns/promises', '_http_client', '_http_agent', '_tls_wrap', 'inspector', 'node:quic', 'module', 'cluster', 'vm', 'worker_threads']) {
    for (const source of [`import '${specifier}';`, `export * from '${specifier}';`, `import('${specifier}');`]) {
      const report = networkReport(() => source, ['fixture.mjs']);
      assert.ok(report.violations.some((line) => line.includes('fixture.mjs:1') && line.includes('N1') && line.includes(specifier)), `N1 must refuse ${source}: ${report.violations.join('\n')}`);
    }
  }
  assert.deepEqual(networkReport(() => "import 'fs'; import 'node:fs';", ['fixture.mjs']).violations, []);
  assert.deepEqual(networkReport(() => "import 'node:child_process';", ['src/substrate/host.mjs']).violations, []);
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
function networkReport(read, roots) {
  const modules = new Map();
  const violations = [];
  const dynamic = [];
  const admitted = new Set();
  const visit = (file) => {
    if (modules.has(file)) return;
    const source = read(file);
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
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
  }, ENTRY_POINTS);
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
  assert.deepEqual(configReport(report.modules), [], 'N11: the real config import has a pinned binding and immutable target path');
  const missed = [];
  for (const [id, file, before, after] of CONFIG_COUNTEREXAMPLES) {
    const sources = new Map([...report.modules].map(([path, { source }]) => [path, source]));
    assert.equal(sources.get(file).split(before).length - 1, 1, `${id}: the config counterexample anchor is unique`);
    sources.set(file, sources.get(file).replace(before, after));
    const changed = networkReport((path) => sources.get(path), ENTRY_POINTS);
    if (!configReport(changed.modules).some((line) => line.includes(file))) missed.push(id);
  }
  assert.deepEqual(missed, [], 'N11: config reassignment and alternate filename bindings must be refused');
});

const PACKAGE_ROOT = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
const ENTRY_POINTS = ['src/cli/rigger.mjs', 'scripts/gate-check.mjs'];

/** Compare syntax, not quote style, whitespace or source positions. */
const syntaxShape = (node) => JSON.stringify(node, (key, value) => ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : value);
const expressionShape = (source) => syntaxShape(parseExpressionAt(source, 0, { ecmaVersion: 'latest', sourceType: 'module' }));

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
function lexical(program) {
  const scopes = new WeakMap();
  const bindings = new WeakSet();
  const root = { parent: null, kind: 'module', names: new Map() };
  const inner = (parent, kind = 'block') => ({ parent, kind, names: new Map() });
  const bind = (pattern, scope, value, path = [], fallback) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      scope.names.set(pattern.name, { identifier: pattern, scope, value, path, fallback });
      bindings.add(pattern);
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') bind(property.argument, scope, value, path);
        else bind(property.value, scope, value, value ? [...path, memberName(property)] : [], fallback);
      }
    } else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((element, index) => bind(element, scope, value, value ? [...path, String(index)] : [], fallback));
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, value ?? pattern.right, path, pattern.right);
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope, value, path, fallback);
  };
  const children = (node, scope) => {
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') collect(child, scope);
    }
  };
  const collect = (node, scope) => {
    scopes.set(node, scope);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      if (node.type === 'FunctionDeclaration') bind(node.id, scope, node);
      const parameters = inner(scope, 'parameters');
      bind(node.id, parameters, node);
      if (node.type !== 'ArrowFunctionExpression') parameters.names.set('arguments', { implicit: true });
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
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) bind(specifier.local, scope, { type: 'ImportedBinding', source: node.source.value, name: specifier.type === 'ImportNamespaceSpecifier' ? '*' : specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name ?? specifier.imported.value });
    if (node.type === 'VariableDeclaration') {
      let destination = scope;
      if (node.kind === 'var') while (!['module', 'function'].includes(destination.kind)) destination = destination.parent;
      for (const declaration of node.declarations) bind(declaration.id, destination, declaration.init);
    }
    children(node, scope);
  };
  collect(program, root);
  const lookup = (node) => {
    let scope = scopes.get(node);
    while (scope && !scope.names.has(node.name)) scope = scope.parent;
    return scope?.names.get(node.name);
  };
  return { root, lookup, bindings };
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
  assert.deepEqual(report.violations, [], 'N1 to N6: every real module must satisfy the positive boundary');
  for (const root of ENTRY_POINTS) assert.ok(report.modules.has(root), `N2: follows ${root}`);
  assert.deepEqual(report.dynamic.map(({ file, owner, argument }) => ({ file, owner, argument })), DYNAMIC_IMPORTS.map(({ file, owner, argument }) => ({ file, owner, argument: expressionShape(argument) })), 'N3: the exception list is exactly the nonliteral sites');
  for (const [name, reason] of [...BUILTINS, ...GLOBALS, ...DYNAMIC_IMPORTS.map(({ file, reason }) => [file, reason])]) {
    assert.ok(typeof reason === 'string' && reason.trim() && !reason.includes('\n'), `N1/N3/N4: ${name} has a one-line reason`);
  }
});

/** Read only package modules reached from the two production entry points. */
const packageReport = () => networkReport((file) => readFileSync(join(PACKAGE_ROOT, file), 'utf8'), ENTRY_POINTS);

// proves R-SAFE-2
test('N8: every process site has a reviewed program and shell input', () => {
  const report = packageReport();
  for (const [program, reason] of LOCAL_PROGRAMS) assert.ok(reason.trim() && !reason.includes('\n'), `N8: ${program} has a local-operation reason`);
  assert.deepEqual(programReport(report.modules), [], 'N8: the real process sites and their program origins must remain closed');
  for (const [file, before, after] of [
    ['src/substrate/providers/claude.mjs', "command: 'claude'", "command: 'curl'"],
    ['src/substrate/forge/runners.mjs', "const FORGE = 'gh'", "const FORGE = 'curl'"],
    ['src/substrate/worktrees.mjs', "git = 'git'", "git = 'curl'"],
    ['src/substrate/host.mjs', " : '/bin/ps'", " : '/bin/curl'"],
    ['src/substrate/host.mjs', " : '/usr/sbin/lsof'", " : '/usr/bin/curl'"],
    ['src/cli/doctor.mjs', 'const [command, ...args] = adapter.auth;', "const [command, ...args] = ['curl'];"],
    ['src/substrate/process.mjs', 'tool: lsof', "tool: 'curl'"],
    ['src/substrate/process.mjs', "run(ps, ['-g', String(group), '-o', 'pid=,stat=']", "run('curl', ['-g', String(group), '-o', 'pid=,stat=']"],
    ['src/execution/step.mjs', "['-c', step.run]", "['-c', 'echo alternate']"],
    ['src/cli/rigger.mjs', "import { run } from './verbs.mjs';", "import { run } from './verbs.mjs'; import { runCommand } from '../substrate/process.mjs'; function extra() { return runCommand({command:'git'}); }"],
    ...['spawn', 'spawnSync', 'execFile'].map((method) => ['src/cli/rigger.mjs', "import { run } from './verbs.mjs';", `import { run } from './verbs.mjs'; function extra(host) { return host.${method}('git', []); }`]),
    ['src/cli/rigger.mjs', "import { run } from './verbs.mjs';", "import { run } from './verbs.mjs'; function extra() { return process.execve('/usr/bin/curl', [], {}); }"],
  ]) {
    const sources = new Map([...report.modules].map(([path, { source }]) => [path, source]));
    assert.ok(sources.get(file).includes(before), `N8: counterexample anchor exists in ${file}`);
    sources.set(file, sources.get(file).replace(before, after));
    const changed = networkReport((path) => sources.get(path), ENTRY_POINTS);
    assert.ok(programReport(changed.modules).some((line) => line.includes(file)), `N8: refuses the counterexample at ${file}`);
  }
});

/** Resolve static module, namespace, destructured and defaulted bindings in their lexical scopes. */
function processBindings(modules) {
  const models = new Map([...modules].map(([file, { program }]) => [file, lexical(program)]));
  const namespaces = new Map();
  const exports = new Map();
  const bindingValues = new WeakMap();
  const objects = new WeakMap();
  const namespace = (file) => {
    if (!namespaces.has(file)) namespaces.set(file, { namespace: file });
    return namespaces.get(file);
  };
  const target = (file, source) => source.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), source)) : source.startsWith('node:') ? source : `node:${source}`;
  const exported = (file, name, seen = new Set()) => {
    const key = `${file}#${name}`;
    if (exports.has(key)) return exports.get(key);
    const value = readExport(file, name, seen);
    if (value !== undefined) exports.set(key, value);
    return value;
  };
  const readExport = (file, name, seen) => {
    if (!modules.has(file)) return `${file}#${name}`;
    const key = `${file}#${name}`;
    if (seen.has(key)) return;
    seen = new Set([...seen, key]);
    const declarations = [...nodes(modules.get(file).program)].map(({ node }) => node);
    const star = (node) => node.type === 'ExportAllDeclaration' && !node.exported;
    const ordered = [...declarations.filter((node) => !star(node)), ...declarations.filter(star)];
    let builtin;
    for (const node of ordered) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration && models.get(file).root.names.has(name)) {
          const binding = models.get(file).root.names.get(name);
          if (node.declaration === binding.value || node.declaration.declarations?.some((declaration) => declaration.init === binding.value)) return bindingOrigin(file, binding, seen);
        }
        for (const specifier of node.specifiers) if ((specifier.exported.name ?? specifier.exported.value) === name) {
          const local = specifier.local.name ?? specifier.local.value;
          return node.source ? exported(target(file, node.source.value), local, seen) : bindingOrigin(file, models.get(file).root.names.get(local), seen);
        }
      }
      if (node.type === 'ExportAllDeclaration') {
        if (node.exported && (node.exported.name ?? node.exported.value) === name) return namespace(target(file, node.source.value));
        if (!node.exported) {
          const source = target(file, node.source.value);
          const found = exported(source, name, seen);
          if (found !== undefined) {
            // A built-in's unknown export set must not mask a package re-export.
            if (!modules.has(source)) { builtin ??= found; continue; }
            return found;
          }
        }
      }
      if (node.type === 'ExportDefaultDeclaration' && name === 'default') return origin(file, node.declaration, seen);
    }
    return builtin;
  };
  const member = (base, name, seen) => {
    if (name === undefined) return;
    if (base?.namespace === 'global' && name === 'process') return namespace('global:process');
    if (base?.namespace) return exported(base.namespace, name, seen);
    if (base?.object) {
      if (base.object.properties.some((property) => property.type === 'SpreadElement' || property.computed)) return;
      const matches = base.object.properties.filter((property) => memberName(property) === name);
      if (matches.length !== 1) return;
      const property = matches[0];
      if (property.kind === 'get') {
        const body = property.value.body.body;
        return body.length === 1 && body[0].type === 'ReturnStatement' ? origin(base.file, body[0].argument, seen) : undefined;
      }
      return origin(base.file, property.value, seen);
    }
  };
  const bindingOrigin = (file, binding, seen) => {
    if (!binding || seen.has(binding)) return;
    if (bindingValues.has(binding)) return bindingValues.get(binding);
    seen = new Set([...seen, binding]);
    let value = origin(file, binding.value, seen);
    for (const name of binding.path ?? []) value = member(value, name, seen);
    value ??= origin(file, binding.fallback, seen);
    if (value !== undefined) bindingValues.set(binding, value);
    return value;
  };
  const origin = (file, node, seen = new Set()) => {
    if (!node) return;
    if (node.type === 'ImportedBinding') {
      const source = target(file, node.source);
      return node.name === '*' || (source === 'node:child_process' && node.name === 'default') ? namespace(source) : exported(source, node.name, seen);
    }
    if (node.type === 'Identifier') {
      const binding = models.get(file).lookup(node);
      if (!binding && node.name === 'process') return namespace('global:process');
      if (!binding && ['Object', 'Reflect'].includes(node.name)) return namespace(`global:${node.name}`);
      if (!binding && ['globalThis', 'global'].includes(node.name)) return namespace('global');
      return bindingOrigin(file, binding, seen);
    }
    if (node.type === 'MemberExpression') return member(origin(file, node.object, seen), memberName(node), seen);
    if (node.type === 'ObjectExpression') {
      if (!objects.has(node)) objects.set(node, { object: node, file });
      return objects.get(node);
    }
    if (node.type === 'CallExpression' && syntaxShape(node.callee) === expressionShape('Object.freeze') && !models.get(file).lookup(node.callee.object) && node.arguments.length === 1) return origin(file, node.arguments[0], seen);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'Literal'].includes(node.type)) return node;
  };
  return { origin, exported, models, named: (file, name) => bindingOrigin(file, models.get(file).root.names.get(name), new Set()) };
}

/** Native starts remain starts through aliases and namespace/member access. */
const nativeProgram = (symbol) => typeof symbol === 'string' && (symbol.startsWith('node:child_process#') || symbol === 'global:process#execve');

/** Reviewed process sites, program inputs and constructed environments, checked without running them. */
function programReport(modules) {
  const violations = [];
  const calls = [];
  const references = [];
  const bindings = processBindings(modules);
  const reviewed = new Set();
  for (const [file, names] of PROGRAM_DEFINITIONS) for (const name of names) {
    const symbol = bindings.named(file, name);
    if (symbol === undefined) violations.push(`${file} N8 missing reviewed process definition ${name}`);
    else reviewed.add(symbol);
  }
  const fail = (file, node, reason) => violations.push(`${file}:${node.loc.start.line} N8 ${reason}`);
  for (const [file, { program }] of modules) {
    const entries = [...nodes(program)];
    const processMember = (node) => node?.type === 'MemberExpression' && (nativeProgram(bindings.origin(file, node)) || ['spawn', 'spawnSync', 'execFile'].includes(memberName(node)));
    for (const { node, parent, owner } of entries) {
      if (node.type === 'Property' && parent.type === 'ObjectExpression' && memberName(node) === 'tool' && !(file === 'src/substrate/process.mjs' && owner === 'list')) fail(file, node, 'unlisted local-reader program origin');
      if (file === 'src/substrate/process.mjs' && node.type === 'VariableDeclarator') {
        if (['ps', 'lsof'].includes(node.id.name)) fail(file, node, 'unreviewed local reader binding');
        if (node.id.type === 'ObjectPattern' && node.id.properties.some((property) => ['ps', 'lsof'].includes(memberName(property))) && syntaxShape(node.init) !== expressionShape('host')) fail(file, node, 'local readers must come from the host');
      }
      if (node.type === 'Property' && parent.type === 'ObjectExpression' && ['ps', 'lsof'].includes(memberName(node)) && file !== 'src/substrate/host.mjs' && syntaxShape(node.value) !== expressionShape(memberName(node))) fail(file, node, 'local reader forwarding differs');
      if (processMember(node)) references.push(`${file}#${owner}#${syntaxShape(node)}`);
      if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        const target = node.left ?? node.argument;
        if (['command', 'git', 'FORGE', 'ps', 'lsof'].includes(target.name) || (target.type === 'MemberExpression' && ['command', 'auth', 'ps', 'lsof'].includes(memberName(target)))) fail(file, node, 'rewrites a reviewed program origin');
      }
      if (node.type !== 'CallExpression') continue;
      const callee = node.callee;
      const symbol = bindings.origin(file, callee);
      if (reviewed.has(symbol) || nativeProgram(symbol) || processMember(callee)) {
        const key = `${file}#${owner}#${syntaxShape(callee)}`;
        const expected = PROGRAM_CALLS.find((entry) => entry[0] === file && entry[1] === owner && expressionShape(entry[2]) === syntaxShape(callee));
        calls.push(key);
        if (!expected) { fail(file, node, `unlisted process site ${owner}: ${modules.get(file).source.slice(callee.start, callee.end)}`); continue; }
        const value = expected[3] === 'command' ? objectValue(node.arguments[0], 'command') : expected[3] === 'all' ? node.arguments : node.arguments[expected[3] === 'second' ? 1 : 0];
        const parsed = parseExpressionAt(`[${expected[4]}]`, 0, { ecmaVersion: 'latest', sourceType: 'module' }).elements;
        const wanted = expected[3] === 'all' ? parsed : parsed[0];
        if (syntaxShape(value) !== syntaxShape(wanted)) fail(file, node, `program/input differs at ${owner}`);
        if (nativeProgram(symbol) || processMember(callee)) {
          if (node.arguments[2]?.type !== 'ObjectExpression' || node.arguments[2].properties.some((property) => property.type !== 'Property' || property.computed || ['shell', 'uid', 'gid'].includes(memberName(property)))) fail(file, node, 'native start options may not spread, compute keys, or set shell/uid/gid');
        }
      }
      if ((callee.name === 'workspaces' || (bindings.exported('src/substrate/worktrees.mjs', 'workspaces') !== undefined && symbol === bindings.exported('src/substrate/worktrees.mjs', 'workspaces'))) && (node.arguments[0]?.type !== 'ObjectExpression' || node.arguments[0].properties.some((property) => property.type === 'SpreadElement' || memberName(property) === 'git'))) fail(file, node, 'workspaces overrides the default git program');
    }
  }
  const expectedCalls = PROGRAM_CALLS.flatMap(([file, owner, callee, , , count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(callee)}`));
  if (syntaxShape(calls.sort()) !== syntaxShape(expectedCalls.sort())) violations.push('N8 process-site inventory differs (missing, duplicate or unlisted site)');
  const expectedReferences = PROCESS_REFERENCES.flatMap(([file, owner, expression, count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(expression)}`));
  if (syntaxShape(references.sort()) !== syntaxShape(expectedReferences.sort())) violations.push('N8 native process references differ (unreviewed alias or method)');
  const protectedByFile = new Map([...modules.keys()].map((file) => [file, new Set(['global:process#env'])]));
  for (const [file, owner, kind, name, expression] of PROGRAM_ORIGINS) {
    const matches = [...nodes(modules.get(file).program)].filter(({ node, parent, owner: at }) => at === owner && (
      kind === 'binding' ? node.type === 'VariableDeclarator' && syntaxShape(node.id) === syntaxShape(parse(`const ${name} = null`, { ecmaVersion: 'latest' }).body[0].declarations[0].id) :
      kind === 'variable' ? node.type === 'VariableDeclarator' && node.id.name === name :
      kind === 'default' ? node.type === 'AssignmentPattern' && node.left.name === name :
      kind === 'function' ? node.type === 'FunctionDeclaration' && node.id.name === name :
      node.type === 'Property' && parent.type === 'ObjectExpression' && memberName(node) === name
    )).map(({ node, parent }) => {
      const model = bindings.models.get(file);
      const protectedBindings = protectedByFile.get(file) ?? new Set();
      protectedByFile.set(file, protectedBindings);
      const value = ['binding', 'variable'].includes(kind) ? node.init : kind === 'default' ? node.right : kind === 'function' ? { ...node, type: 'FunctionExpression' } : node.value;
      if (kind === 'property' && parent.properties.some((property) => property.type !== 'Property' || property.computed)) fail(file, node, 'a reviewed origin object may not spread or compute sibling keys');
      for (const root of [value, ...(['binding', 'variable'].includes(kind) ? [node.id] : kind === 'default' ? [node.left] : [])]) {
        if (root) for (const { node: part, parent } of nodes(root)) if (part.type === 'Identifier' && (model.bindings.has(part) || referenceIdentifier(part, parent, model.bindings))) {
          const binding = model.lookup(part);
          if (binding) protectedBindings.add(binding);
        }
      }
      return value;
    });
    if (matches.length !== 1 || syntaxShape(matches[0]) !== expressionShape(expression)) violations.push(`${file} N8 ${owner}'s ${name} program origin differs`);
  }
  for (const [file, protectedBindings] of protectedByFile) {
    const { program } = modules.get(file);
    const writes = [...nodes(program)].map(({ node }) => node).filter((node) => node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.left.name === 'invoked');
    const admitted = new Set();
    if (file === 'src/execution/role.mjs' && writes.length === 1 && writes[0].operator === '=' && writes[0].right.type === 'AwaitExpression' && writes[0].right.argument.type === 'CallExpression' && syntaxShape(writes[0].right.argument.callee) === expressionShape('adapters[provider].invocation')) admitted.add(writes[0]);
    const allowed = file === 'src/execution/role.mjs' ? ['delete environment[name]', 'Object.assign(environment, set)'] : file === 'src/substrate/git-environment.mjs' ? ['env[name] = value'] : [];
    for (const expression of allowed) {
      const matches = [...nodes(program)].map(({ node }) => node).filter((node) => syntaxShape(node) === expressionShape(expression));
      if (matches.length === 1) admitted.add(matches[0]);
    }
    for (const node of bindingWrites(program, bindings.models.get(file), protectedBindings, (node) => bindings.origin(file, node))) if (!admitted.has(node)) fail(file, node, 'rewrites a reviewed input binding or its member');
  }
  return violations;
}

/** Follow ordinary local aliases when refusing writes to a pinned input, including member mutations. */
function bindingWrites(program, model, protectedBindings, origin = () => undefined) {
  const entries = [...nodes(program)];
  const writers = new Set(['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set', 'Reflect.deleteProperty'].map(expressionShape));
  const root = (node) => {
    while (node) {
      if (origin(node) === 'global:process#env') return 'global:process#env';
      if (node.type !== 'MemberExpression') break;
      node = node.object;
    }
    return node?.type === 'Identifier' ? model.lookup(node) : undefined;
  };
  let previous;
  do {
    previous = protectedBindings.size;
    for (const { node } of entries) if (node.type === 'VariableDeclarator' && protectedBindings.has(root(node.init))) {
      for (const { node: identifier } of nodes(node.id)) if (model.bindings.has(identifier)) protectedBindings.add(model.lookup(identifier));
    }
  } while (previous !== protectedBindings.size);
  return entries.map(({ node }) => node).filter((node) => {
    if (['AssignmentExpression', 'UpdateExpression'].includes(node.type)) {
      const target = node.left ?? node.argument;
      return [...nodes(target)].some(({ node: part }) => protectedBindings.has(root(part)));
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') return protectedBindings.has(root(node.argument));
    if (node.type !== 'CallExpression') return false;
    const writer = origin(node.callee);
    if (writers.has(syntaxShape(node.callee)) || ['global:Object#assign', 'global:Object#defineProperty', 'global:Object#defineProperties', 'global:Reflect#set', 'global:Reflect#deleteProperty'].includes(writer)) return protectedBindings.has(root(node.arguments[0]));
    return ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'delete', 'clear'].includes(memberName(node.callee)) && protectedBindings.has(root(node.callee.object));
  });
}

/** One explicit command property, with no spread or duplicate that could override it. */
function objectValue(node, key) {
  if (node?.type !== 'ObjectExpression' || node.properties.some((property) => property.type === 'SpreadElement')) return;
  const matches = node.properties.filter((property) => memberName(property) === key);
  return matches.length === 1 ? matches[0].value : undefined;
}

/** Definitions that start a process or accept a program chosen by their reviewed callers. */
const PROGRAM_DEFINITIONS = [
  ['src/substrate/process.mjs', ['runCommand', 'run', 'runNow', 'runOnce', 'reading', 'readingNow', 'ended', 'contain', 'swept', 'sweptNow', 'startOf', 'startsIn', 'sweeping']],
  ['src/execution/run.mjs', ['dispatch']],
  ['src/execution/role.mjs', ['roleDispatch']],
  ['src/execution/step.mjs', ['stepDispatch']],
  ['src/cli/doctor.mjs', ['asked']],
  ['src/substrate/forge/runners.mjs', ['throughL0']],
];

/** Site, program expression (or full forwarding arguments), and occurrence count. */
const PROGRAM_CALLS = [
  ["src/substrate/process.mjs", "ended", "run", "first", "ps"],
  ["src/substrate/process.mjs", "reading", "run", "first", "...toolOf(look.value, ps)"],
  ["src/substrate/process.mjs", "readingNow", "runNow", "first", "...toolOf(look.value, ps)"],
  ["src/substrate/process.mjs", "runNow", "runOnce", "first", "ps"],
  ["src/substrate/process.mjs", "within", "reading", "second", "ps"],
  ["src/substrate/process.mjs", "contain", "ended", "second", "{ ps, readTimeout, kill, host }"],
  ["src/substrate/process.mjs", "contain", "reading", "second", "ps"],
  ["src/substrate/process.mjs", "within", "readingNow", "second", "ps"],
  ["src/substrate/process.mjs", "containNow", "readingNow", "second", "ps"],
  ["src/substrate/process.mjs", "swept", "reading", "second", "ps", 2],
  ["src/substrate/process.mjs", "swept", "sweeping", "second", "lsof"],
  ["src/substrate/process.mjs", "sweptNow", "readingNow", "second", "ps", 2],
  ["src/substrate/process.mjs", "sweptNow", "sweeping", "second", "lsof"],
  ["src/substrate/process.mjs", "censused", "swept", "second", "call"],
  ["src/substrate/process.mjs", "endedNow", "sweptNow", "second", "call"],
  ["src/substrate/process.mjs", "runCommand", "startOf", "first", "ps"],
  ["src/substrate/process.mjs", "runCommand", "contain", "second", "call", 3],
  ["src/substrate/process.mjs", "killRecordedGroup", "startsIn", "first", "ps"],
  ["src/substrate/process.mjs", "killRecordedGroup", "contain", "second", "{ ps, readTimeout, kill, host }"],
  ["src/substrate/process.mjs", "killRecordedGroup", "swept", "second", "{ ps, lsof, readTimeout, kill, host }"],
  ["src/substrate/process.mjs", "startsIn", "run", "first", "ps"],
  ['src/cli/doctor.mjs', 'asked', 'runCommand', 'command', 'command'],
  ['src/execution/run.mjs', 'dispatch', 'runCommand', 'command', 'command'],
  ['src/substrate/worktrees.mjs', 'call', 'runCommand', 'command', 'git'],
  ['src/substrate/forge/runners.mjs', 'throughL0', 'runCommand', 'command', 'command'],
  ['src/substrate/providers/codex.mjs', 'probed', 'runCommand', 'command', "'codex'"],
  ['src/substrate/process.mjs', 'run', 'host.execFile', 'first', 'ps'],
  ['src/substrate/process.mjs', 'runCommand', 'host.spawn', 'first', 'command'],
  ['src/substrate/process.mjs', 'startOf', 'host.spawnSync', 'first', 'ps'],
  ['src/substrate/process.mjs', 'runOnce', 'spawn', 'first', 'ps'],
  ['src/substrate/data-ref.mjs', 'git', 'run', 'command', "'git'"],
  ['src/substrate/launchd.mjs', 'loadedJob', 'run', 'command', "'launchctl'"],
  ['src/cli/doctor.mjs', 'gitAnswer', 'ask', 'first', "'git'"],
  ['src/cli/doctor.mjs', 'agentAuth', 'ask', 'first', 'command'],
  ...['readRunner', 'schemaWriteRunner', 'itemWriteRunner', 'repositoryWriteRunner'].map((owner) => ['src/substrate/forge/runners.mjs', owner, 'send', 'first', 'FORGE', owner === 'itemWriteRunner' ? 2 : 1]),
  ['src/scheduling/loop.mjs', 'dispatchStep', 'dispatchOnL1', 'all', '{ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) }'],
  ['src/scheduling/loop.mjs', 'run', 'dispatchOnL1', 'all', '{ id, card: card.number, directory: state, sink, host, readTimeout, ...handed }'],
  ['src/scheduling/loop.mjs', 'run', 'roleDispatch', 'all', '{ answer: stamp(answer, id), cwd, directory, scratch, repository, reach, maker, env: environment, sink, id, card: card.number }'],
  ['src/scheduling/loop.mjs', 'dispatchStep', 'stepDispatch', 'all', 'step, path, environment'],
];

/** Every native-method read, including methods forwarded without calling them at that site. */
const PROCESS_REFERENCES = [
  ...['execFile', 'spawn', 'spawnSync'].map((name) => ['src/substrate/host.mjs', '<module>', `childProcess.${name}`]),
  ...['readingNow', 'runNow', 'runOnce'].map((owner) => ['src/substrate/process.mjs', owner, 'realHost.spawnSync']),
  ['src/substrate/process.mjs', 'run', 'host.execFile'],
  ['src/substrate/process.mjs', 'containNow', 'host.spawnSync'],
  ['src/substrate/process.mjs', 'sweptNow', 'host.spawnSync', 2],
  ['src/substrate/process.mjs', 'runCommand', 'host.spawn'],
  ['src/substrate/process.mjs', 'startOf', 'host.spawnSync'],
];

/** Closed program and environment origins; the consumer step line itself remains outside N10. */
const PROGRAM_ORIGINS = [
  ["src/substrate/providers/claude.mjs", "invocation", "property", "env", "{ [TMPDIR_KEY]: join(real, TMPDIR_NAME) }"],
  ["src/substrate/providers/claude.mjs", "<module>", "variable", "TMPDIR_KEY", "'CLAUDE_CODE_TMPDIR'"],
  ["src/substrate/providers/claude.mjs", "<module>", "variable", "TMPDIR_NAME", "'.claude-tmp'"],
  ["src/substrate/providers/claude.mjs", "invocation", "variable", "real", "atStart('directory-unusable', () => realpathSync.native(directory))"],
  ["src/substrate/providers/codex.mjs", "invocation", "property", "env", "{ CODEX_HOME: home, TMPDIR: temporary, TMPPREFIX: join(temporary, 'zsh') }"],
  ["src/substrate/providers/codex.mjs", "probed", "property", "env", "{ ...gitEnvironment(), CODEX_HOME: home }"],
  ["src/substrate/providers/codex.mjs", "<module>", "variable", "HOME", "'codex-home'"],
  ["src/substrate/providers/codex.mjs", "<module>", "variable", "TEMPORARY", "'tmp'"],
  ["src/substrate/providers/codex.mjs", "invocation", "variable", "home", "homeFor(directory, scratch)"],
  ["src/substrate/providers/codex.mjs", "invocation", "variable", "temporary", "join(atStart('directory-unusable', () => realpathSync.native(scratch)), TEMPORARY)"],
  ["src/substrate/providers/codex.mjs", "homeFor", "variable", "home", "join(atStart('directory-unusable', () => realpathSync.native(scratch)), HOME)"],
  ["src/execution/role.mjs", "roleDispatch", "variable", "environment", "gitEnvironment(env)"],
  ["src/execution/role.mjs", "roleDispatch", "property", "env", "environment"],
  ["src/execution/run.mjs", "dispatch", "property", "env", "workspace === undefined ? env : gitEnvironment(env)"],
  ["src/execution/step.mjs", "stepDispatch", "property", "env", "env"],
  ["src/cli/once.mjs", "claiming", "property", "environment", "process.env"],
  ["src/substrate/process.mjs", "runCommand", "property", "env", "env"],
  ["src/substrate/git-environment.mjs", "gitEnvironment", "function", "gitEnvironment", "function gitEnvironment(from = process.env) { const env = {}; for (const [name, value] of Object.entries(from)) { if (!REMOVED.has(name.toUpperCase())) env[name] = value; } return env; }"],
  ['src/substrate/forge/runners.mjs', '<module>', 'variable', 'FORGE', "'gh'"],
  ['src/substrate/worktrees.mjs', 'workspaces', 'default', 'git', "'git'"],
  ['src/substrate/providers/adapters.mjs', '<module>', 'variable', 'ADAPTERS', 'Object.freeze({ claude, codex })'],
  ['src/execution/role.mjs', 'roleDispatch', 'default', 'adapters', 'ADAPTERS'],
  ['src/execution/role.mjs', 'roleDispatch', 'binding', '{ command, args, input, unset, env: set, folder }', 'invoked'],
  ['src/execution/role.mjs', 'roleDispatch', 'property', 'command', 'command'],
  ['src/cli/doctor.mjs', 'agentAuth', 'binding', '[command, ...args]', 'adapter.auth'],
  ...['claude', 'codex'].map((provider) => [`src/substrate/providers/${provider}.mjs`, 'invocation', 'property', 'command', JSON.stringify(provider)]),
  ['src/substrate/providers/claude.mjs', '<module>', 'variable', 'auth', "['claude', 'auth', 'status', '--json']"],
  ['src/substrate/providers/codex.mjs', '<module>', 'variable', 'auth', "['codex', 'login', 'status']"],
  ['src/execution/step.mjs', 'stepDispatch', 'property', 'command', "'/bin/sh'"],
  ['src/execution/step.mjs', 'stepDispatch', 'property', 'args', "['-c', step.run]"],
  ['src/substrate/host.mjs', '<module>', 'property', 'ps', "process.platform === 'linux' ? fileURLToPath(new URL('./process-table.sh', import.meta.url)) : '/bin/ps'"],
  ['src/substrate/host.mjs', '<module>', 'property', 'lsof', "process.platform === 'linux' ? '/usr/bin/lsof' : '/usr/sbin/lsof'"],
  ['src/substrate/process.mjs', 'toolOf', 'variable', 'toolOf', '(read, ps) => (Array.isArray(read) ? [ps, read] : [read.tool, read.args])'],
  ['src/substrate/process.mjs', 'list', 'property', 'tool', 'lsof'],
];


/** Local programs read host state; tool internals and the consumer's step line are N9/N10. */
const LOCAL_PROGRAMS = new Map([
  ['/bin/ps', 'ps(1): displays selected local process information.'],
  ['src/substrate/process-table.sh', 'The packaged shim reads Linux /proc and local ps output.'],
  ['/usr/sbin/lsof', 'lsof(8): cwd-only file listing, with -n/-P suppressing address/service lookup.'],
  ['/usr/bin/lsof', 'The Linux lsof uses the same cwd-only -n/-P arguments.'],
  ['launchctl', 'launchctl(1) print queries the local launchd domain, a Mach bootstrap subset.'],
]);

// proves R-SAFE-2, R-SAFE-4
test('N8: bound process calls and program inputs reject ordinary code edits', () => {
  const report = packageReport();
  assert.deepEqual(programReport(report.modules), [], 'N8: the real bound process sites pass before counterexamples');
  const missed = [];
  for (const [id, file, before, after] of PROCESS_COUNTEREXAMPLES) {
    const sources = new Map([...report.modules].map(([path, { source }]) => [path, source]));
    assert.equal(sources.get(file).split(before).length - 1, 1, `${id}: the counterexample anchor is unique`);
    sources.set(file, sources.get(file).replace(before, after));
    const changed = networkReport((path) => sources.get(path), ENTRY_POINTS);
    if (!programReport(changed.modules).some((line) => line.includes(file))) missed.push(`${id} N8: must reject the changed process binding or program input in ${file}`);
  }
  assert.deepEqual(missed, [], 'N8: every ordinary process-binding counterexample must be refused');
});

/** Ordinary edits that must not escape the process inventory or its input provenance. */
const PROCESS_COUNTEREXAMPLES = [
  ["m3-star-reexport-priority", "src/cli/once.mjs", "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nexport * from 'node:fs';\nexport * from '../execution/run.mjs';\nimport { dispatch as reexportedStart } from './once.mjs';\nfunction unlistedReexportedDispatch() { return reexportedStart({ command: 'curl', args: [] }); }"],
  ["m3-reexport-priority", "src/cli/once.mjs", "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nexport * from 'node:fs';\nexport { dispatch } from '../execution/run.mjs';\nimport { dispatch as reexportedStart } from './once.mjs';\nfunction unlistedReexportedDispatch() { return reexportedStart({ command: 'curl', args: [] }); }"],
  ["A5-aliased-mutator", "src/execution/role.mjs", "  Object.assign(environment, set);", "  Object.assign(environment, set);\n  const mergeEnvironment = Object.assign;\n  if (env.RIGGER_EXTRA) mergeEnvironment(environment, { EXTRA_TOKEN: 'injected' });"],
  ["A5-engine-write", "src/cli/once.mjs", "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nfunction unlistedEnvironmentWrite() { if (process.env.RIGGER_EXTRA) process.env.EXTRA_TOKEN = 'injected'; }"],
  ["origin-return-wrapper", "src/execution/role.mjs", "return { provider, command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest };", "return Object.assign({ provider, command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest }, { command: 'curl' });"],
  ["A5-conditional-codex", "src/substrate/providers/codex.mjs", "env: { CODEX_HOME: home, TMPDIR: temporary, TMPPREFIX: join(temporary, 'zsh') }", "env: { ...(process.env.RIGGER_EXTRA ? { EXTRA_TOKEN: home } : {}), CODEX_HOME: home, TMPDIR: temporary, TMPPREFIX: join(temporary, 'zsh') }"],
  ["A5-conditional-claude", "src/substrate/providers/claude.mjs", "env: { [TMPDIR_KEY]: join(real, TMPDIR_NAME) }", "env: { ...(environment.RIGGER_EXTRA ? { EXTRA_TOKEN: real } : {}), [TMPDIR_KEY]: join(real, TMPDIR_NAME) }"],
  ["A5-conditional-copy", "src/substrate/git-environment.mjs", "  return env;", "  if (from.RIGGER_EXTRA) env.EXTRA_TOKEN = 'injected';\n  return env;"],
  ["A5-conditional-role", "src/execution/role.mjs", "  Object.assign(environment, set);", "  Object.assign(environment, set);\n  if (env.RIGGER_EXTRA) environment.EXTRA_TOKEN = 'injected';"],
  ["A5-conditional-once", "src/cli/once.mjs", "environment: process.env, run: opened.run", "environment: { ...process.env, ...(process.env.RIGGER_EXTRA ? { EXTRA_TOKEN: 'injected' } : {}) }, run: opened.run"],
  ["A5-conditional-native", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "(env.RIGGER_EXTRA && (env.EXTRA_TOKEN = 'injected'), host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] }))"],
  ["m7", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "host.spawn(command, args, { ...(env.RIGGER_SHELL ? { shell: env.RIGGER_SHELL } : {}), cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })"],
  ["m7-computed", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "host.spawn(command, args, { ['shell']: env.RIGGER_SHELL, cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })"],
  ["A4-conditional-uid", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "host.spawn(command, args, { ...(env.RIGGER_UID ? { uid: Number(env.RIGGER_UID) } : {}), cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })"],
  ["A4-conditional-gid", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "host.spawn(command, args, { ...(env.RIGGER_GID ? { gid: Number(env.RIGGER_GID) } : {}), cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })"],
  ["A4-computed-uid", "src/substrate/process.mjs", "host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })", "host.spawn(command, args, { ['uid']: Number(env.RIGGER_UID), cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })"],
  ["m2b", "src/execution/role.mjs", "  const { command, args, input, unset, env: set, folder } = invoked;", "  invoked = Object.assign({}, invoked, JSON.parse(env.RIGGER_INVOCATION ?? '{}'));\n  const { command, args, input, unset, env: set, folder } = invoked;"],
  ["m1", "src/execution/step.mjs", "(step, workspace, env = process.env) => ({\n  command: '/bin/sh',\n  args: ['-c', step.run],\n  cwd: join(workspace, step.cwd ?? '.'),\n  workspace,\n  env,\n  timeout: stepTimeout(step),\n});\n", "(step, workspace, env = process.env) => { step = { ...step, run: `${env.RIGGER_STEP_PREFIX ?? ''}${step.run}` }; return ({\n  command: '/bin/sh',\n  args: ['-c', step.run],\n  cwd: join(workspace, step.cwd ?? '.'),\n  workspace,\n  env,\n  timeout: stepTimeout(step),\n}); };\n"],
  ['m3-alias', 'src/cli/once.mjs', "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nimport { dispatch as startImported } from '../execution/run.mjs';\nfunction unlistedRenamedDispatch() { return startImported({ command: 'curl', args: [] }); }"],
  ['m4-direct', 'src/substrate/host.mjs', 'export const realHost = {', "const { exec: execute } = childProcess;\nfunction unlistedDestructuredExec() { return execute('curl https://example.invalid'); }\nexport const realHost = {"],
  ['m3', 'src/cli/once.mjs', "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nimport { dispatch } from '../execution/run.mjs';\nfunction unlistedImportedDispatch() { return dispatch({ command: 'curl', args: [] }); }"],
  ['m4', 'src/substrate/host.mjs', 'export const realHost = {', "const { exec } = childProcess;\nfunction unlistedHostExec() { return realHost.exec('curl https://example.invalid'); }\nexport const realHost = {\n  exec,"],
  ['m14', 'src/cli/once.mjs', "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nimport * as processes from '../substrate/process.mjs';\nfunction unlistedNamespaceCall() { return processes.runCommand({ command: 'curl', args: [] }); }"],
];

/** Counterexamples to the target-only consumer import. */
const CONFIG_COUNTEREXAMPLES = [
  [
    "m5",
    "src/cli/doctor.mjs",
    "const path = join(target, CONFIG);",
    "let path = join(target, CONFIG); if (!existsSync(path)) path = join(target, '.rigger', CONFIG);"
  ],
  [
    "m6",
    "src/cli/doctor.mjs",
    "import { CONFIG } from './init.mjs';",
    "import { CONFIG as CONFIG_NAME } from './init.mjs';\nconst CONFIG = process.env.RIGGER_CONFIG ?? CONFIG_NAME;"
  ]
];

/** The consumer import pins its filename binding and path. */
function configReport(modules) {
  const file = 'src/cli/doctor.mjs';
  const bindings = processBindings(modules);
  const model = bindings.models.get(file);
  const violations = [];
  const fail = (reason) => violations.push(`${file} N11 ${reason}`);
  const config = bindings.named(file, 'CONFIG');
  if (config?.type !== 'Literal' || config.value !== 'rigger.config.mjs' || config !== bindings.named('src/cli/init.mjs', 'CONFIG')) fail('CONFIG must resolve to the imported consumer filename');
  const factory = bindings.named(file, 'consumerConfig');
  if (factory?.type !== 'FunctionDeclaration' || syntaxShape(factory.params) !== syntaxShape(parseExpressionAt('(target) => 0', 0, { ecmaVersion: 'latest' }).params)) {
    fail('consumerConfig must take only the target path');
    return violations;
  }
  const entries = [...nodes(factory)];
  const paths = entries.filter(({ node }) => node.type === 'VariableDeclarator' && node.id.name === 'path');
  const imports = entries.filter(({ node }) => node.type === 'ImportExpression');
  if (paths.length !== 1 || paths[0].parent.kind !== 'const' || syntaxShape(paths[0].node.init) !== expressionShape('join(target, CONFIG)') || bindings.origin(file, paths[0].node.init.callee) !== 'node:path#join') fail('path must be the constant target joined with CONFIG');
  if (imports.length !== 1 || syntaxShape(imports[0].node.source) !== expressionShape('pathToFileURL(path)') || bindings.origin(file, imports[0].node.source.callee) !== 'node:url#pathToFileURL') fail('the sole import must convert that path to a file URL');
  const protectedBindings = new Set([model.root.names.get('CONFIG'), model.lookup(factory.params[0]), ...paths.map(({ node }) => model.lookup(node.id))]);
  for (const node of bindingWrites(modules.get(file).program, model, protectedBindings)) fail(`rewrites the filename or target path at line ${node.loc.start.line}`);
  return violations;
}
