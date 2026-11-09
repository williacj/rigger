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
function unbound(program) {
  const scopes = new WeakMap();
  const bindings = new WeakSet();
  const root = { parent: null, kind: 'module', names: new Set() };
  const inner = (parent, kind = 'block') => ({ parent, kind, names: new Set() });
  const bind = (pattern, scope) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') { scope.names.add(pattern.name); bindings.add(pattern); }
    else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) bind(property.type === 'RestElement' ? property.argument : property.value, scope);
    else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) bind(element, scope);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope);
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
      if (node.type === 'FunctionDeclaration') bind(node.id, scope);
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
  const found = [];
  for (const { node, parent } of nodes(program)) {
    if (node.type !== 'Identifier' || bindings.has(node)) continue;
    if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier', 'ExportAllDeclaration', 'MetaProperty'].includes(parent?.type)) continue;
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) continue;
    if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && parent.key === node && !parent.computed && !(parent.shorthand && parent.value === node)) continue;
    if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) && parent.label === node) continue;
    let scope = scopes.get(node);
    while (scope && !scope.names.has(node.name)) scope = scope.parent;
    if (!scope) found.push({ node, parent });
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

/** Reviewed program sites and origins, checked without running any program. */
function programReport(modules) {
  const violations = [];
  const calls = [];
  const references = [];
  const fail = (file, node, reason) => violations.push(`${file}:${node.loc.start.line} N8 ${reason}`);
  for (const [file, { program }] of modules) {
    const entries = [...nodes(program)];
    const aliases = new Set(['runCommand', ...(file === 'src/substrate/process.mjs' ? ['run', 'runNow', 'runOnce', 'reading', 'readingNow', 'ended', 'contain', 'swept', 'sweptNow', 'startOf', 'startsIn', 'sweeping'] : [])]);
    const native = new Set();
    for (const { node } of entries) {
      if (node.type !== 'ImportDeclaration') continue;
      for (const specifier of node.specifiers) {
        if (specifier.imported?.name === 'runCommand') aliases.add(specifier.local.name);
        if (['node:child_process', 'child_process'].includes(node.source.value)) {
          if (specifier.type === 'ImportSpecifier') aliases.add(specifier.local.name);
          else native.add(specifier.local.name);
        }
      }
    }
    const processMember = (node) => node?.type === 'MemberExpression' && (['spawn', 'spawnSync', 'execFile'].includes(memberName(node)) || native.has(node.object.name) || (node.object.name === 'process' && memberName(node) === 'execve'));
    // Include defaulted and local aliases: data-ref/launchd's run and synchronous spawn reads.
    for (let size = -1; size !== aliases.size;) {
      size = aliases.size;
      for (const { node } of entries) {
        const left = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentPattern' ? node.left : undefined;
        const right = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentPattern' ? node.right : undefined;
        if (left?.type === 'Identifier' && (aliases.has(right?.name) || processMember(right))) aliases.add(left.name);
        if (node.type === 'Property' && ['spawn', 'spawnSync', 'execFile'].includes(memberName(node)) && node.value.type === 'Identifier') aliases.add(node.value.name);
      }
    }
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
      const reader = file === 'src/substrate/process.mjs' && ['run', 'runNow', 'runOnce', 'reading', 'readingNow', 'ended', 'contain', 'swept', 'sweptNow', 'startOf', 'startsIn', 'sweeping'].includes(callee.name);
      const upstream = reader || (file === 'src/substrate/forge/runners.mjs' && callee.name === 'send') || (file === 'src/cli/doctor.mjs' && callee.name === 'ask') || ['dispatchOnL1', 'roleDispatch', 'stepDispatch'].includes(callee.name);
      if (aliases.has(callee.name) || processMember(callee) || upstream) {
        const key = `${file}#${owner}#${syntaxShape(callee)}`;
        const expected = PROGRAM_CALLS.find((entry) => entry[0] === file && entry[1] === owner && expressionShape(entry[2]) === syntaxShape(callee));
        calls.push(key);
        if (!expected) { fail(file, node, `unlisted process site ${owner}: ${modules.get(file).source.slice(callee.start, callee.end)}`); continue; }
        const value = expected[3] === 'command' ? objectValue(node.arguments[0], 'command') : expected[3] === 'all' ? node.arguments : node.arguments[expected[3] === 'second' ? 1 : 0];
        const parsed = parseExpressionAt(`[${expected[4]}]`, 0, { ecmaVersion: 'latest', sourceType: 'module' }).elements;
        const wanted = expected[3] === 'all' ? parsed : parsed[0];
        if (syntaxShape(value) !== syntaxShape(wanted)) fail(file, node, `program/input differs at ${owner}`);
        if (processMember(callee) || (file === 'src/substrate/process.mjs' && callee.name === 'spawn')) {
          if (node.arguments[2]?.type !== 'ObjectExpression' || node.arguments[2].properties.some((property) => property.type === 'Property' && memberName(property) === 'shell')) fail(file, node, 'native start may not add a shell');
        }
      }
      if (callee.name === 'workspaces' && (node.arguments[0]?.type !== 'ObjectExpression' || node.arguments[0].properties.some((property) => property.type === 'SpreadElement' || memberName(property) === 'git'))) fail(file, node, 'workspaces overrides the default git program');
    }
  }
  const expectedCalls = PROGRAM_CALLS.flatMap(([file, owner, callee, , , count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(callee)}`));
  if (syntaxShape(calls.sort()) !== syntaxShape(expectedCalls.sort())) violations.push('N8 process-site inventory differs (missing, duplicate or unlisted site)');
  const expectedReferences = PROCESS_REFERENCES.flatMap(([file, owner, expression, count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(expression)}`));
  if (syntaxShape(references.sort()) !== syntaxShape(expectedReferences.sort())) violations.push('N8 native process references differ (unreviewed alias or method)');
  for (const [file, owner, kind, name, expression] of PROGRAM_ORIGINS) {
    const matches = [...nodes(modules.get(file).program)].filter(({ node, parent, owner: at }) => at === owner && (
      kind === 'binding' ? node.type === 'VariableDeclarator' && syntaxShape(node.id) === syntaxShape(parse(`const ${name} = null`, { ecmaVersion: 'latest' }).body[0].declarations[0].id) :
      kind === 'variable' ? node.type === 'VariableDeclarator' && node.id.name === name :
      kind === 'default' ? node.type === 'AssignmentPattern' && node.left.name === name :
      node.type === 'Property' && parent.type === 'ObjectExpression' && memberName(node) === name
    )).map(({ node }) => ['binding', 'variable'].includes(kind) ? node.init : kind === 'default' ? node.right : node.value);
    if (matches.length !== 1 || syntaxShape(matches[0]) !== expressionShape(expression)) violations.push(`${file} N8 ${owner}'s ${name} program origin differs`);
  }
  return violations;
}

/** One explicit command property, with no spread or duplicate that could override it. */
function objectValue(node, key) {
  if (node?.type !== 'ObjectExpression' || node.properties.some((property) => property.type === 'SpreadElement')) return;
  const matches = node.properties.filter((property) => memberName(property) === key);
  return matches.length === 1 ? matches[0].value : undefined;
}

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

/** The closed programs and their data origins; the step's consumer line is N10, out of scope. */
const PROGRAM_ORIGINS = [
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
