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

/** Cache only immutable syntax; binding origins and guard verdicts remain per report. */
const programSyntaxModels = new WeakMap();
function programSyntax(program) {
  if (!programSyntaxModels.has(program)) {
    const entries = [...nodes(program)];
    programSyntaxModels.set(program, { entries, parents: new Map(entries.map(({ node, parent }) => [node, parent])) });
  }
  return programSyntaxModels.get(program);
}

/** Follow imports from roots; never execute the modules being checked. */
const parsedModules = new Map();
function networkReport(read, roots) {
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
  violations.push(...globalWrites(modules));
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
    } else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((element, index) => bind(element?.type === 'RestElement' ? element.argument : element, scope, value, value ? [...path, element?.type === 'RestElement' ? { rest: index } : String(index)] : [], fallback));
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
      if (node.type === 'FunctionDeclaration') {
        scopes.set(node.id, scope);
        bind(node.id, scope, node);
      }
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

/** All statically possible origins; unknown branches never hide a known guarded function. */
const originVariants = (value) => value?.alternatives ? value.alternatives.flatMap(originVariants) : value === undefined ? [] : [value];

/** Resolve static module, namespace, destructured and defaulted bindings in their lexical scopes. */
function processBindings(modules) {
  const models = new Map([...modules].map(([file, { program }]) => [file, lexical(program)]));
  const assignments = new WeakMap();
  const memberStores = new Map();
  const storeRecords = new WeakSet();
  const assigned = (file, pattern, value, path = []) => {
    if (pattern.type === 'Identifier') {
      const binding = models.get(file).lookup(pattern);
      if (binding) assignments.set(binding, [...(assignments.get(binding) ?? []), { file, value, path }]);
    } else if (pattern.type === 'MemberExpression' && memberName(pattern) !== undefined) {
      const stored = { file, object: pattern.object, value, path };
      const name = memberName(pattern);
      memberStores.set(name, [...(memberStores.get(name) ?? []), stored]);
      storeRecords.add(stored);
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) assigned(file, property.type === 'RestElement' ? property.argument : property.value, value, property.type === 'RestElement' ? path : [...path, memberName(property)]);
    } else if (pattern.type === 'ArrayPattern') {
      pattern.elements.forEach((part, index) => { if (part) assigned(file, part.type === 'RestElement' ? part.argument : part, value, [...path, part.type === 'RestElement' ? { rest: index } : String(index)]); });
    } else if (pattern.type === 'AssignmentPattern') assigned(file, pattern.left, value, [...path, { fallback: pattern.right }]);
  };
  for (const [file, { program }] of modules) for (const { node } of nodes(program)) {
    if (node.type === 'AssignmentExpression' && ['=', '||=', '&&=', '??='].includes(node.operator)) assigned(file, node.left, node.right);
  }
  const partial = (seen) => [...seen].some((value) => assignments.has(value) || storeRecords.has(value));
  const namespaces = new Map();
  const exports = new Map();
  const bindingValues = new WeakMap();
  const objects = new WeakMap();
  const opaqueCalls = new WeakMap();
  const memberOrigins = new WeakMap();
  const operations = new Map(['call', 'apply', 'bind'].map((operation) => [operation, { operation }]));
  const alternatives = (values) => {
    const found = [...new Set(values.flatMap(originVariants))];
    return found.length === 1 ? found[0] : found.length ? { alternatives: found } : undefined;
  };
  const namespace = (file) => {
    if (!namespaces.has(file)) namespaces.set(file, { namespace: file });
    return namespaces.get(file);
  };
  const target = (file, source) => source.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), source)) : source.startsWith('node:') ? source : `node:${source}`;
  const exported = (file, name, seen = new Set()) => {
    const key = `${file}#${name}`;
    if (exports.has(key)) return exports.get(key);
    const value = readExport(file, name, seen);
    if (value !== undefined && !partial(seen)) exports.set(key, value);
    return value;
  };
  const readExport = (file, name, seen) => {
    if (BUILTINS.has(file) && name === 'default') return namespace(file);
    // node:url exports the same constructor as the admitted global URL (checked by the matrix).
    if (file === 'node:url' && name === 'URL') return namespace('global:URL');
    if (!modules.has(file)) return `${file}#${name}`;
    const key = `${file}#${name}`;
    if (seen.has(key)) return;
    seen = new Set([...seen, key]);
    const declarations = modules.get(file).program.body;
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
  // An unresolved receiver may alias any receiver holding the same literal member name.
  const uncertainReceiver = (value) => value === undefined || value?.unknownCall || (value?.parentOrigin && uncertainReceiver(value.parentOrigin));
  const member = (base, name, seen) => {
    if (name === undefined) return;
    if (base?.alternatives) return alternatives(base.alternatives.map((value) => member(value, name, seen)));
    const stored = (memberStores.get(name) ?? []).map((record) => {
      if (seen.has(record)) return;
      const visiting = new Set([...seen, record]);
      const receivers = originVariants(origin(record.file, record.object, visiting));
      if (!uncertainReceiver(base) && receivers.length && !receivers.some(uncertainReceiver) && !receivers.includes(base)) return;
      return project(record.file, origin(record.file, record.value, visiting), record.path, visiting);
    });
    return alternatives([declaredMember(base, name, seen), ...stored]);
  };
  const declaredMember = (base, name, seen) => {
    if (operations.has(name) && (typeof base === 'string' || base?.bound || base?.operation || ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(base?.type))) return operations.get(name);
    if (base?.array && /^(0|[1-9][0-9]*)$/.test(name)) return origin(base.file, base.array.elements[Number(name)], seen);
    if (base?.namespace === 'global' && GLOBALS.has(name)) return namespace(`global:${name}`);
    if (base?.namespace) return exported(base.namespace, name, seen);
    if (typeof base === 'string' && base.startsWith('global:') && base.includes('#')) return `${base}.${name}`;
    if (base?.object) {
      if (seen.has(base)) return;
      seen = new Set([...seen, base]);
      return alternatives(base.object.properties.map((property) => {
        if (property.type === 'SpreadElement') return member(origin(base.file, property.argument, seen), name, seen);
        if (memberName(property) !== name) return;
        if (property.kind === 'get') {
          const body = property.value.body.body;
          return body.length === 1 && body[0].type === 'ReturnStatement' ? origin(base.file, body[0].argument, seen) : undefined;
        }
        return origin(base.file, property.value, seen);
      }));
    }
    if (base?.identifier || base?.parentOrigin || base?.unknownCall) {
      if (!memberOrigins.has(base)) memberOrigins.set(base, new Map());
      const members = memberOrigins.get(base);
      if (!members.has(name)) members.set(name, { parentOrigin: base, name });
      return members.get(name);
    }
  };
  const rests = new WeakMap();
  const rest = (value, offset) => {
    if (value?.alternatives) return alternatives(value.alternatives.map((part) => rest(part, offset)));
    if (!value?.array) return;
    if (!rests.has(value)) rests.set(value, new Map());
    const views = rests.get(value);
    if (!views.has(offset)) views.set(offset, { file: value.file, array: { ...value.array, elements: value.array.elements.slice(offset) } });
    return views.get(offset);
  };
  const project = (file, value, path, seen) => {
    for (const part of path) value = typeof part === 'string' ? member(value, part, seen)
      : part && 'rest' in part ? rest(value, part.rest)
      : part && 'fallback' in part ? alternatives([value, origin(file, part.fallback, seen)]) : undefined;
    return value;
  };
  const bindingOrigin = (file, binding, seen) => {
    if (!binding || seen.has(binding)) return;
    if (bindingValues.has(binding)) return bindingValues.get(binding);
    seen = new Set([...seen, binding]);
    let value = project(file, origin(file, binding.value, seen), binding.path ?? [], seen);
    if (value?.namespace === 'global:undefined') value = undefined;
    value ??= origin(file, binding.fallback, seen);
    value = alternatives([value, ...(assignments.get(binding) ?? []).map((assignment) => {
      return project(assignment.file, origin(assignment.file, assignment.value, seen), assignment.path, seen);
    })]) ?? binding;
    // Stored ancestors can participate in alias cycles; cache only complete traversals.
    if (!partial(seen)) bindingValues.set(binding, value);
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
      if (!binding && (GLOBALS.has(node.name) || node.name === 'Reflect')) return namespace(`global:${node.name}`);
      if (!binding && ['globalThis', 'global'].includes(node.name)) return namespace('global');
      return bindingOrigin(file, binding, seen);
    }
    if (node.type === 'AwaitExpression') return origin(file, node.argument, seen);
    if (node.type === 'ImportExpression' && typeof node.source.value === 'string') return namespace(target(file, node.source.value));
    if (node.type === 'ConditionalExpression') return alternatives([origin(file, node.consequent, seen), origin(file, node.alternate, seen)]);
    if (node.type === 'LogicalExpression') return alternatives([origin(file, node.left, seen), origin(file, node.right, seen)]);
    if (node.type === 'SequenceExpression') return origin(file, node.expressions.at(-1), seen);
    if (node.type === 'AssignmentExpression' && ['=', '||=', '&&=', '??='].includes(node.operator)) return alternatives([origin(file, node.left, seen), origin(file, node.right, seen)]);
    if (node.type === 'MemberExpression') return member(origin(file, node.object, seen), memberName(node), seen);
    if (['ObjectExpression', 'ArrayExpression'].includes(node.type)) {
      if (!objects.has(node)) objects.set(node, { [node.type === 'ObjectExpression' ? 'object' : 'array']: node, file });
      return objects.get(node);
    }
    if (node.type === 'CallExpression' && syntaxShape(node.callee) === expressionShape('Object.freeze') && !models.get(file).lookup(node.callee.object) && node.arguments.length === 1) return origin(file, node.arguments[0], seen);
    if (node.type === 'CallExpression') {
      if (seen.has(node)) return;
      if (!objects.has(node)) {
        const values = invocation(file, node, new Set([...seen, node])).filter((call) => call.created).map(({ created }) => created);
        // Keep unresolved call values in conditional origins instead of discarding that branch.
        if (!opaqueCalls.has(node)) opaqueCalls.set(node, { file, unknownCall: node });
        const value = alternatives(values) ?? opaqueCalls.get(node);
        if (!partial(seen)) objects.set(node, value);
        return value;
      }
      return objects.get(node);
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'Literal'].includes(node.type)) return node;
  };
  const argument = (file, node) => ({ file, node });
  const valueOf = (value, seen) => value && origin(value.file, value.node, seen);
  const arrayArguments = (value, seen) => {
    const array = valueOf(value, seen);
    if (!array?.array || array.array.elements.some((part) => !part || part.type === 'SpreadElement')) return;
    return array.array.elements.map((node) => argument(array.file, node));
  };
  // Function.prototype methods use their actual receiver, including when the method is aliased.
  const sameArgument = (left, right) => left?.file === right?.file && left?.node === right?.node;
  const invoke = (symbol, receiver, args, seen, active = []) => {
    if (active.some((call) => call.symbol === symbol && sameArgument(call.receiver, receiver) && call.args?.length === args?.length && (args ?? []).every((arg, index) => sameArgument(arg, call.args[index])))) return [];
    active = [...active, { symbol, receiver, args }];
    if (symbol?.alternatives) return symbol.alternatives.flatMap((value) => invoke(value, receiver, args, seen, active));
    if (symbol?.bound) return invoke(symbol.bound.target, symbol.bound.receiver, args && [...symbol.bound.prefix, ...args], seen, active);
    if (symbol?.operation) {
      const target = valueOf(receiver, seen);
      if (symbol.operation === 'bind') return args ? [{ created: { bound: { target, receiver: args[0], prefix: args.slice(1) } } }] : [];
      return invoke(target, args?.[0], symbol.operation === 'call' ? args?.slice(1) : arrayArguments(args?.[1], seen), seen, active);
    }
    if (symbol === 'global:Reflect#apply') return invoke(valueOf(args?.[0], seen), args?.[1], arrayArguments(args?.[2], seen), seen, active);
    return [{ symbol, args }];
  };
  const invocation = (file, node, seen = new Set()) => invoke(origin(file, node.callee, seen), node.callee.type === 'MemberExpression' ? argument(file, node.callee.object) : undefined, node.arguments.map((node) => argument(file, node)), seen);
  const named = (file, name, nested = false) => {
    const model = models.get(file);
    let binding = nested ? undefined : model.root.names.get(name);
    if (!binding) {
      const declarations = programSyntax(modules.get(file).program).entries.filter(({ node }) => node.type === 'VariableDeclarator' && node.id.name === name && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type) && (!nested || model.lookup(node.id)?.scope !== model.root));
      if (declarations.length === 1) binding = model.lookup(declarations[0].node.id);
    }
    return bindingOrigin(file, binding, new Set());
  };
  return { origin, exported, models, invocation, named };
}

/** Native starts remain starts through aliases and namespace/member access. */
const nativeProgram = (symbol) => typeof symbol === 'string' && (symbol.startsWith('node:child_process#') || symbol === 'global:process#execve');

/** Reviewed process sites, program inputs and constructed environments, checked without running them. */
function programReport(modules) {
  const violations = [];
  const calls = [];
  const references = [];
  const nativeBindings = new Map([...modules.keys()].map((file) => [file, new Set()]));
  const bindings = processBindings(modules);
  const originBindings = new Map();
  const readerBindings = new Map();
  const readerInputs = new Set(['ask', 'decide', 'facts', 'atPull', 'take']);
  const checkedValues = [];
  const entriesByFile = new Map([...modules].map(([file, { program }]) => [file, programSyntax(program).entries]));
  const parentsByFile = new Map([...modules].map(([file, { program }]) => [file, programSyntax(program).parents]));
  const links = [];
  const originKey = (file, owner, kind, name) => `${file}#${owner}#${kind}#${name}`;
  const reviewed = new Set();
  for (const [file, names, nested] of PROGRAM_DEFINITIONS) for (const name of names) {
    const symbol = bindings.named(file, name, nested);
    if (symbol === undefined) violations.push(`${file} N8 missing reviewed process definition ${name}`);
    else for (const value of originVariants(symbol)) reviewed.add(value);
  }
  const fail = (file, node, reason) => violations.push(`${file}:${node.loc.start.line} N8 ${reason}`);
  for (const [file, { program }] of modules) {
    const entries = entriesByFile.get(file);
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
      const invocations = bindings.invocation(file, node).filter((call) => !call.created);
      const guarded = invocations.filter(({ symbol }) => reviewed.has(symbol) || nativeProgram(symbol));
      if (guarded.length || processMember(callee)) {
        const key = `${file}#${owner}#${syntaxShape(callee)}`;
        const candidates = PROGRAM_CALLS.filter((entry) => entry[0] === file && entry[1] === owner && expressionShape(entry[2]) === syntaxShape(callee));
        const expected = candidates.length === 1 ? candidates[0] : candidates.find((entry) => syntaxShape(node.arguments) === syntaxShape(parseExpressionAt(`[${entry[4]}]`, 0, { ecmaVersion: 'latest', sourceType: 'module' }).elements));
        calls.push(key);
        if (!expected) { fail(file, node, `unlisted process site ${owner}: ${modules.get(file).source.slice(callee.start, callee.end)}`); continue; }
        for (const call of guarded.length ? guarded : invocations) {
          const args = call.args?.map(({ node }) => node);
          const value = expected[3] === 'command' ? objectValue(args?.[0], 'command') : expected[3] === 'all' ? args : args?.[expected[3] === 'second' ? 1 : 0];
          const parsed = parseExpressionAt(`[${expected[4]}]`, 0, { ecmaVersion: 'latest', sourceType: 'module' }).elements;
          const wanted = expected[3] === 'all' ? parsed : parsed[0];
          for (const root of Array.isArray(value) ? value : [value]) if (root) checkedValues.push({ file, root });
          if (syntaxShape(value) !== syntaxShape(wanted)) fail(file, node, `program/input differs at ${owner}`);
          if (expected[6]) {
            for (const [index, kind, name] of Array.isArray(expected[6][0]) ? expected[6] : [expected[6]]) links.push({ file, owner, node, value: call.args?.[index], kind, name });
          }
          if (nativeProgram(call.symbol) || processMember(callee)) {
            const functions = entries.filter(({ node }) => node.type === 'FunctionDeclaration' && node.id.name === owner);
            const parameter = functions.length === 1 ? functions[0].node.params[0] : undefined;
            const fields = parameter?.type === 'ObjectPattern' ? parameter.properties.filter((property) => !property.computed && memberName(property) === 'command') : [];
            const declared = owner === 'runCommand' ? (fields.length === 1 ? fields[0].value : undefined) : parameter;
            const model = bindings.models.get(file);
            if (declared?.type === 'Identifier') nativeBindings.get(file).add(model.lookup(declared));
            if (declared?.type !== 'Identifier' || declared.name !== wanted.name || value?.type !== 'Identifier' || call.args[0].file !== file || model.lookup(value) !== model.lookup(declared)) fail(file, node, `program binding differs at ${owner}`);
            if (args?.[2]?.type !== 'ObjectExpression' || args[2].properties.some((property) => property.type !== 'Property' || property.computed || ['shell', 'uid', 'gid'].includes(memberName(property)))) fail(file, node, 'native start options may not spread, compute keys, or set shell/uid/gid');
          }
        }
      }
      if ((callee.name === 'workspaces' || (bindings.exported('src/substrate/worktrees.mjs', 'workspaces') !== undefined && invocations.some(({ symbol }) => symbol === bindings.exported('src/substrate/worktrees.mjs', 'workspaces')))) && (node.arguments[0]?.type !== 'ObjectExpression' || node.arguments[0].properties.some((property) => property.type === 'SpreadElement' || memberName(property) === 'git'))) fail(file, node, 'workspaces overrides the default git program');
    }
  }
  const expectedCalls = PROGRAM_CALLS.flatMap(([file, owner, callee, , , count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(callee)}`));
  if (syntaxShape(calls.sort()) !== syntaxShape(expectedCalls.sort())) violations.push('N8 process-site inventory differs (missing, duplicate or unlisted site)');
  const expectedReferences = PROCESS_REFERENCES.flatMap(([file, owner, expression, count = 1]) => Array(count).fill(`${file}#${owner}#${expressionShape(expression)}`));
  if (syntaxShape(references.sort()) !== syntaxShape(expectedReferences.sort())) violations.push('N8 native process references differ (unreviewed alias or method)');
  const protectedByFile = new Map([...modules.keys()].map((file) => [file, new Set(['global:process#env', ...nativeBindings.get(file)])]));
  const protectedValues = new Set(reviewed);
  for (const [file, owner, kind, name, expression, source, fields, bare] of PROGRAM_ORIGINS) {
    const model = bindings.models.get(file);
    const key = originKey(file, owner, kind, name);
    const selected = new Set();
    const expectedValues = Array.isArray(expression) ? expression : [expression];
    const remember = (identifier, origin = key) => {
      const binding = model.lookup(identifier);
      if (!originBindings.has(origin)) originBindings.set(origin, new Set());
      originBindings.get(origin).add(binding);
      if (kind === 'reader' || readerInputs.has(identifier.name)) {
        const reader = `${file}#${identifier.name}`;
        if (!readerBindings.has(reader)) readerBindings.set(reader, new Set());
        readerBindings.get(reader).add(binding);
      }
    };
    const matches = entriesByFile.get(file).filter(({ node, parent, owner: at }) => at === owner && (
      kind === 'binding' ? node.type === 'VariableDeclarator' && syntaxShape(node.id) === syntaxShape(parse(`const ${name} = null`, { ecmaVersion: 'latest' }).body[0].declarations[0].id) :
      kind === 'reader' ? (node.type === 'FunctionDeclaration' && node.id.name === name) || (node.type === 'VariableDeclarator' && node.id.name === name && model.lookup(node.id)?.scope !== model.root) :
      kind === 'parameter' ? node.type === 'Identifier' && node.name === name && model.bindings.has(node) && model.lookup(node)?.scope?.kind === 'parameters' :
      kind === 'variable' ? node.type === 'VariableDeclarator' && node.id.name === name :
      kind === 'default' ? node.type === 'AssignmentPattern' && node.left.name === name :
      kind === 'function' ? node.type === 'FunctionDeclaration' && node.id.name === name :
      kind === 'return' ? node.type === 'ReturnStatement' :
      kind === 'iteration' ? node.type === 'ForOfStatement' && !node.await && syntaxShape(node.left) === syntaxShape(parse(`for (${name} of []) {}`, { ecmaVersion: 'latest' }).body[0].left) :
      node.type === 'Property' && parent.type === 'ObjectExpression' && memberName(node) === name
    )).filter(({ node }) => {
      if (selected.has(node)) return false;
      selected.add(node);
      return true;
    }).map(({ node, parent }) => {
      if (bare === true && !parent.params?.includes(node)) fail(file, node, 'a configured receiving parameter must be a bare identifier without a default');
      if (kind === 'parameter' && model.lookup(node)?.fallback) fail(file, node, 'a reviewed receiving parameter may not supply a default');
      if (bare === 'return') {
        const parents = parentsByFile.get(file);
        const enclosing = (part) => {
          for (let at = parents.get(part); at; at = parents.get(at)) if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(at.type)) return at;
        };
        const factory = model.root.names.get(owner)?.value;
        const returns = entriesByFile.get(file).filter(({ node: part }) => part.type === 'ReturnStatement' && enclosing(part) === factory);
        if (returns.length !== 1 || returns[0].node.argument !== parent) fail(file, node, 'a reviewed transport property must be returned directly by its factory');
      }
      const protectedBindings = protectedByFile.get(file) ?? new Set();
      protectedByFile.set(file, protectedBindings);
      const value = kind === 'reader' && node.type === 'FunctionDeclaration' ? { ...node, type: 'FunctionExpression' } : ['binding', 'variable', 'reader'].includes(kind) ? node.init : kind === 'parameter' ? node : kind === 'default' ? node.right : kind === 'function' ? { ...node, type: 'FunctionExpression' } : kind === 'return' ? node.argument : kind === 'iteration' ? node.right : node.value;
      if (value) checkedValues.push({ file, root: value });
      const declared = kind === 'parameter' ? node : kind === 'default' ? node.left : node.id;
      if (declared?.type === 'Identifier') remember(declared);
      const reader = value?.type === 'AwaitExpression' ? value.argument?.callee : value?.type === 'CallExpression' ? value.callee : undefined;
      if (source) links.push({ file, owner, node, value: { file, node: source[2] === 'callee' ? reader : value }, kind: source[0], name: source[1] });
      if (kind === 'property') protectedValues.add(bindings.origin(file, parent));
      if (kind === 'property' && parent.properties.some((property) => property.type !== 'Property' || property.computed)) fail(file, node, 'a reviewed origin object may not spread or compute sibling keys');
      // Linked sources have their own pin; an index dependency is not the selected step.
      const pattern = kind === 'iteration' ? node.left.declarations[0].id : node.id;
      const identifiers = fields ? [...writeTargets(pattern)].filter((identifier) => fields.includes(identifier.name)) : [node.id];
      if (fields) for (const identifier of identifiers) remember(identifier, originKey(file, owner, 'binding', identifier.name));
      const closedReader = kind === 'reader' || (kind === 'property' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(value?.type));
      const roots = closedReader || source || kind === 'return' ? fields ? identifiers : [node.id] : fields ? [...identifiers, reader] : [value, ...(['binding', 'variable'].includes(kind) ? identifiers : kind === 'default' ? [node.left] : [])];
      for (const root of roots) {
        if (root) for (const { node: part, parent } of nodes(root)) if (part.type === 'Identifier' && (model.bindings.has(part) || referenceIdentifier(part, parent, model.bindings))) {
          const binding = model.lookup(part);
          if (binding) {
            protectedBindings.add(binding);
            const origin = bindings.origin(file, part);
            if (origin !== undefined) protectedValues.add(origin);
          }
        }
      }
      return value;
    });
    if (matches.length !== expectedValues.length) originBindings.delete(key);
    if (matches.length !== expectedValues.length || matches.some((value, index) => syntaxShape(value) !== expressionShape(expectedValues[index]))) violations.push(`${file} N8 ${owner}'s ${name} program origin differs`);
  }
  for (const { file, owner, node, value, kind, name } of links) {
    let root = value?.node;
    while (root?.type === 'MemberExpression') root = root.object;
    const expected = originBindings.get(originKey(file, kind === 'reader' ? name : owner, kind, name));
    if (!expected || value?.file !== file || root?.type !== 'Identifier' || !expected.has(bindings.models.get(file).lookup(root))) fail(file, node, `configured input binding differs at ${owner}`);
  }
  for (const [file, protectedBindings] of protectedByFile) {
    const { program } = modules.get(file);
    const writes = [...nodes(program)].map(({ node }) => node).filter((node) => node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.left.name === 'invoked');
    const admitted = new Set();
    if (file === 'src/execution/role.mjs' && writes.length === 1 && writes[0].operator === '=' && writes[0].right.type === 'AwaitExpression' && writes[0].right.argument.type === 'CallExpression' && syntaxShape(writes[0].right.argument.callee) === expressionShape('adapters[provider].invocation')) admitted.add(writes[0]);
    const allowed = file === 'src/execution/role.mjs' ? ['delete environment[name]', 'Object.assign(environment, set)'] : file === 'src/substrate/git-environment.mjs' ? ['env[name] = value'] : file === 'src/scheduling/loop.mjs' ? [
      'answer = unmade',
      'answer = askAttempt([], { attempt: number })',
      'answer = askAttempt([...outcomes], { attempt: number })',
      'answer = askAttempt([], { attempt: number, maker: outcome })',
      'current = named(answer, role)',
      'next = next.following',
      "settled[at] = { status: 'fulfilled', value: { role: judge.role, outcome: failure } }",
      '[settled[at]] = await Promise.allSettled([judged(card, judge, repeat, scope)])',
    ] : [];
    for (const expression of allowed) {
      const matches = [...nodes(program)].map(({ node }) => node).filter((node) => syntaxShape(node) === expressionShape(expression));
      if (matches.length === 1) {
        const reader = file === 'src/scheduling/loop.mjs' && matches[0].right?.type === 'CallExpression' ? matches[0].right.callee : undefined;
        if (!reader || (reader.type === 'Identifier' && originBindings.get(originKey(file, reader.name, 'reader', reader.name))?.has(bindings.models.get(file).lookup(reader)))) {
          admitted.add(matches[0]);
          checkedValues.push({ file, root: matches[0] });
        }
      }
    }
    const protectedInputs = new Set([...protectedBindings, ...protectedValues]);
    for (const node of bindingWrites(program, bindings.models.get(file), protectedInputs, (node) => bindings.origin(file, node), { bindings, file })) if (!admitted.has(node)) fail(file, node, 'rewrites a reviewed input binding or its member');
  }
  for (const { file, root } of checkedValues) {
    const model = bindings.models.get(file);
    for (const { node, parent } of nodes(root)) if (node.type === 'Identifier' && referenceIdentifier(node, parent, model.bindings)) {
      const binding = model.lookup(node);
      if (binding?.identifier?.start >= root.start && binding.identifier.end <= root.end) continue;
      if (GLOBALS.has(node.name) && binding) fail(file, node, `reviewed global input binding differs: ${node.name}`);
      const expected = readerBindings.get(`${file}#${node.name}`);
      if (expected && (readerInputs.has(node.name) || (parent?.type === 'CallExpression' && parent.callee === node)) && !expected.has(binding)) fail(file, node, `reviewed reader input binding differs: ${node.name}`);
    }
  }
  return violations;
}

/** Follow ordinary local aliases when refusing writes to a pinned input, including member mutations. */
function bindingWrites(program, model, protectedBindings, origin = () => undefined, context) {
  const entries = programSyntax(program).entries;
  const writers = new Set(['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set', 'Reflect.deleteProperty'].map(expressionShape));
  const protectedValue = (value) => protectedBindings.has(value) || context?.protectedOrigin?.(value) || (value?.parentOrigin && protectedValue(value.parentOrigin));
  const root = (node, file = context?.file) => {
    while (node) {
      const value = context ? context.bindings.origin(file, node) : origin(node);
      const found = originVariants(value).find(protectedValue);
      if (found !== undefined) return found;
      if (node.type !== 'MemberExpression') break;
      node = node.object;
    }
    return node?.type === 'Identifier' ? (context ? context.bindings.models.get(file) : model).lookup(node) : undefined;
  };
  const localFunctions = new Set(entries.map(({ node }) => node).filter((node) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)));
  const parameterTransfers = context ? entries.flatMap(({ node }) => node.type === 'CallExpression' ? context.bindings.invocation(context.file, node).filter(({ symbol, created }) => !created && localFunctions.has(symbol)) : []) : [];
  let previous;
  do {
    previous = protectedBindings.size;
    for (const { symbol, args } of parameterTransfers) for (const [index, parameter] of symbol.params.entries()) {
      if (!protectedValue(root(args?.[index]?.node, args?.[index]?.file))) continue;
      for (const identifier of writeTargets(parameter)) if (model.bindings.has(identifier)) protectedBindings.add(model.lookup(identifier));
    }
    for (const { node } of entries) if (node.type === 'VariableDeclarator' && protectedValue(root(node.init))) {
      for (const { node: identifier } of nodes(node.id)) if (model.bindings.has(identifier)) protectedBindings.add(model.lookup(identifier));
    }
  } while (previous !== protectedBindings.size);
  return entries.map(({ node }) => node).filter((node) => {
    if (['AssignmentExpression', 'UpdateExpression', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
      const target = node.left ?? node.argument;
      return [...writeTargets(target)].some((part) => protectedValue(root(part)));
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') return protectedValue(root(node.argument));
    if (node.type !== 'CallExpression') return false;
    const calls = context ? context.bindings.invocation(context.file, node) : [{ symbol: origin(node.callee), args: node.arguments.map((node) => ({ node })) }];
    if (calls.some(({ symbol, args }) => ((!context && writers.has(syntaxShape(node.callee))) || ['global:Object#assign', 'global:Object#defineProperty', 'global:Object#defineProperties', 'global:Reflect#set', 'global:Reflect#deleteProperty'].includes(symbol)) && protectedValue(root(args?.[0]?.node, args?.[0]?.file)))) return true;
    return ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'delete', 'clear'].includes(memberName(node.callee)) && protectedValue(root(node.callee.object));
  });
}

/** Static writes cannot replace admitted global members, including prototypes and imported aliases. */
function globalWrites(modules) {
  const bindings = processBindings(modules);
  const violations = [];
  const protectedOrigin = (value) => {
    if (value?.namespace === 'global') return true;
    const name = (value?.namespace?.startsWith('global:') ? value.namespace.slice('global:'.length) : undefined) ?? (typeof value === 'string' && value.startsWith('global:') ? value.slice('global:'.length).split('#')[0] : undefined);
    if (!GLOBALS.has(name)) return false;
    // Primitive sentinels are values, while even a write syntactically naming their member is refused.
    return typeof value === 'string' || !['undefined', 'NaN', 'Infinity'].includes(name);
  };
  for (const [file, { program }] of modules) {
    const statements = [...nodes(program)].filter(({ node, owner }) => file === 'scripts/gate-check.mjs' && owner === '<module>' && node.type === 'IfStatement' && syntaxShape(node) === statementShape('if (ranDirectly) process.exitCode = await main(process.argv.slice(2), process.env);'));
    const admitted = statements.length === 1 ? statements[0].node.consequent.expression : undefined;
    const context = { bindings, file, protectedOrigin };
    for (const node of bindingWrites(program, bindings.models.get(file), new Set(), undefined, context)) if (node !== admitted) violations.push(`${file}:${node.loc.start.line} N11 protected global write`);
  }
  return violations;
}

/** Parse a complete reviewed statement, including its condition and surrounding syntax. */
const statementShape = (source) => syntaxShape(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body[0]);

/** Assignment patterns write their targets, never their keys, defaults or computed operands. */
function* writeTargets(node) {
  if (!node) return;
  if (['Identifier', 'MemberExpression'].includes(node.type)) yield node;
  else if (node.type === 'AssignmentPattern') yield* writeTargets(node.left);
  else if (node.type === 'RestElement') yield* writeTargets(node.argument);
  else if (node.type === 'ArrayPattern') for (const part of node.elements) yield* writeTargets(part);
  else if (node.type === 'ObjectPattern') for (const property of node.properties) yield* writeTargets(property.type === 'RestElement' ? property.argument : property.value);
  // A loop's let/const declares a fresh binding; var can write an existing function binding.
  else if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const declaration of node.declarations) yield* writeTargets(declaration.id);
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
  ['src/scheduling/loop.mjs', ['dispatchStep', 'attempt', 'judges', 'judged', 'judgeWork', 'work', 'named'], true],
  ['src/scheduling/loop.mjs', ['claiming']],
  ['src/cli/doctor.mjs', ['asked']],
  ['src/substrate/forge/runners.mjs', ['throughL0']],
];

/** Site, input expression, occurrence count, and optional argument-to-origin binding link. */
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
  ['src/scheduling/loop.mjs', 'dispatchStep', 'stepDispatch', 'all', 'step, path, environment', 1, [0, 'parameter', 'step']],
  ['src/scheduling/loop.mjs', 'attempt', 'dispatchStep', 'all', 'card, answer.step, path, { attempt: number }', 1, [1, 'variable', 'answer']],
  ['src/scheduling/loop.mjs', 'judgeWork', 'dispatchStep', 'all', 'card, step, head, { role }', 1, [1, 'variable', 'step']],
  ['src/scheduling/loop.mjs', 'work', 'attempt', 'all', 'card, next, kept, remember, placed, scope', 1, [1, 'variable', 'next']],
  ['src/scheduling/loop.mjs', 'work', 'judges', 'all', 'card, next, (options) => answerFrom(atPull, card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember, placed, scope', 1, [1, 'variable', 'next']],
  ['src/scheduling/loop.mjs', 'attempt', 'judges', 'all', 'card, judging, ask, (ended) => kept({ ...reached, judges: ended }), remember, placed, scope', 1, [[1, 'variable', 'judging'], [2, 'reader', 'ask']]],
  ['src/scheduling/loop.mjs', 'judges', 'judged', 'all', 'card, judge, ask, scope', 1, [[1, 'parameter', 'judge'], [2, 'parameter', 'ask']]],
  ['src/scheduling/loop.mjs', 'judges', 'judged', 'all', 'card, judge, repeat, scope', 1, [[1, 'binding', 'judge'], [2, 'reader', 'repeat']]],
  ['src/scheduling/loop.mjs', 'judged', 'judgeWork', 'all', 'card, judge, ask, scope', 1, [[1, 'parameter', 'judge'], [2, 'parameter', 'ask']]],
  ['src/scheduling/loop.mjs', 'trigger', 'work', 'all', 'claim, freed, setAsides', 1, [0, 'parameter', 'claim']],
  ['src/scheduling/loop.mjs', 'judgeWork', 'named', 'all', 'answer, role', 2, [0, 'variable', 'answer']],
  ["src/scheduling/loop.mjs", "loop", "claiming", "all", "{ config, board, facts, l2, sink, kill, readAdmission: () => admissionRecord.read(), follow: () => follow(), halted: () => unsaved !== undefined }"],
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

/** Closed origins, lexical source links and local readers; the consumer line remains N10. */
const PROGRAM_ORIGINS = [
  ["src/scheduling/loop.mjs", "judgeWork", "return", "judge results", ["{ role, held: await heldJudge(card, role, answer), decision: answer }", "{ role, outcome: made, escalation: answer, decision: answer }", "{ role, withheld: { directory: made }, decision: answer }", "{ role, withheld: { step: step.name, outcome: outcomes.at(-1) }, decision: answer }", "{ role, outcome, halt: true, decision: answer }", "{ role, held: await heldJudge(card, role, answer), decision: answer }", "{ role, outcome, escalation: answer, decision: answer }", "{ role, retry: { judge: current, failure: outcome } }", "{ role, decision: answer, failure: Object.assign(new Error(`card #${card.number}'s judge \\`${role}\\` was stopped after two dispatches:\\nfirst: ${JSON.stringify(answer.firstFailure)}\\nsecond: ${JSON.stringify(answer.failure)}`), { card: card.number, role, decision: 'stop', firstFailure: answer.firstFailure, failure: answer.failure }) }", "{ role, withheld: { scratch: outcome }, decision: answer }", "{ role, outcome }"]],
  ["src/scheduling/loop.mjs", "judges", "iteration", "const [at, each]", "settled.entries()", ["variable", "settled", "callee"], ["each"]],
  ["src/scheduling/loop.mjs", "claiming", "property", "take", "async (limit, setAsides, poll = false, memory) => {\n      await killed();\n      const failures = [];\n      let unrecorded = false;\n      try {\n        record('trigger', { trigger: 'pull' });\n      } catch (refusal) {\n        unrecorded = true;\n        failures.push(refused('the event sink refused to record the pull trigger', refusal));\n      }\n      const { notices, unrecorded: unwritten } = await follow();\n      failures.push(...unwritten);\n      // A poll whose trigger the sink refused claims nothing (\"A poll in each idle state\").\n      if (poll && unrecorded) return { claims: [], failures, notices };\n      const read = setAsides?.read();\n      try {\n        return await claim(limit, setAsides, read, failures, notices, memory);\n      } catch (thrown) {\n        // A later read that fails keeps what this trigger already did and could not record.\n        const kept = [...failures, ...notices.map(noticeFailure)];\n        // The read's own failure stays original beside the trigger's earlier refusals.\n        const reason = thrown;\n        throw kept.length === 0 ? reason : Object.assign(new AggregateError([...kept, reason], `${reason.message}, after ${kept.length} earlier failure${kept.length === 1 ? '' : 's'} of this trigger`), { cause: reason });\n      } finally {\n        if (read !== undefined) setAsides.done(read);\n      }\n    }", null, null, "return"],
  ["src/scheduling/loop.mjs", "loop", "binding", "{ concurrency, claims, killed, record, refused, take, start, release }", "claiming({ config, board, facts, l2, sink, kill, readAdmission: () => admissionRecord.read(), follow: () => follow(), halted: () => unsaved !== undefined })", null, ["take"]],
  ["src/scheduling/loop.mjs", "judges", "variable", "settled", "await Promise.allSettled(answer.judges.map((judge) => judged(card, judge, ask, scope)))"],
  ["src/scheduling/loop.mjs", "repeat", "reader", "repeat", "(options) => ask({ ...options, ...(options.directories === undefined ? {} : {\n        directories: Object.fromEntries(Object.entries(options.directories).map(([role, outcome]) => [role, { ...outcome, firstFailure: failure }])),\n      }) })"],
  ["src/scheduling/loop.mjs", "work", "binding", "{ card, decide: atPull, scope }", "claim", ["parameter", "claim"], ["atPull"]],
  ["src/scheduling/loop.mjs", "trigger", "variable", "worked", "await Promise.allSettled(claimed.map((claim) => (claim.next.action === 'merge' ? merged(claim, setAsides) : work(claim, freed, setAsides))))"],
  ["src/scheduling/loop.mjs", "judgeWork", "variable", "answer", ["ask({ directories: { [role]: made } })", "ask({ judged: { [role]: [...outcomes] } })", "ask({ directories: { [role]: outcome } })"], ["parameter", "ask", "callee"]],
  ["src/scheduling/loop.mjs", "judgeWork", "property", "judge", "current", ["variable", "current"]],
  ["src/scheduling/loop.mjs", "judged", "return", "judgeWork result", "await judgeWork(card, judge, ask, scope)"],
  ["src/scheduling/loop.mjs", "claim", "variable", "decide", "await facts(offered)"],
  ["src/scheduling/loop.mjs", "judges", "parameter", "ask", "ask", null, null, true],
  ["src/scheduling/loop.mjs", "judged", "parameter", "ask", "ask", null, null, true],
  ["src/scheduling/loop.mjs", "judgeWork", "parameter", "ask", "ask", null, null, true],
  ["src/scheduling/loop.mjs", "loop", "parameter", "decide", "decide", null, null, false],
  ["src/scheduling/loop.mjs", "loop", "parameter", "facts", "facts", null, null, false],
  ["src/scheduling/loop.mjs", "claiming", "parameter", "facts", "facts", null, null, false],
  ["src/scheduling/loop.mjs", "eligible", "reader", "eligible", "function eligible(card, next, memory) {\n  if (memory?.barred.has(card.number) && makerAction(next)) next = { action: 'ignore' };\n  if (memory !== undefined && next.action === 'judge') {\n    const judges = next.judges.filter((judge) => !memory.actions.has(`${card.number}:${judgeIdentity(judge)}`) && !memory.deferred.has(`${card.number}:${judgeIdentity(judge)}`));\n    next = judges.length === 0 ? { action: 'ignore' } : { ...next, judges };\n  }\n  if (memory !== undefined && makerAction(next) && (memory.actions.has(`${card.number}:${actionIdentity(next)}`) || memory.deferred.has(`${card.number}:${actionIdentity(next)}`))) next = { action: 'ignore' };\n  return next;\n}"],
  ["src/scheduling/loop.mjs", "claim", "reader", "claim", "async (limit, setAsides, read, failures, notices, memory) => {\n    const columns = await board.readColumns();\n    const { items, declared } = await board.readPriority();\n    /** A board item neither claimed nor skipped by this run's memory of the cards it set aside. */\n    const available = (item) => !claims.has(item.number) && !setAsides?.skips(item, read);\n    const offered = items.filter(available);\n    const offeredAt = new Map(offered.map(({ number }) => [number, generations.get(number)]));\n    const decide = await facts(offered);\n    // Only this read's original offer at its original generation can reach decide, even if an\n    // intervening claim already released or its start failed before this read finished.\n    const unclaimed = offered.filter((item) => available(item) && generations.get(item.number) === offeredAt.get(item.number));\n    // Each card's answer is kept as L2 gave it at the pull, so L3 asks nothing again to begin.\n    const answers = new Map();\n    const { pulls } = pullOrder({ items: unclaimed, columns, declared }, (card) => {\n      const next = eligible(card, decide(card), memory);\n      answers.set(card.number, next);\n      return next;\n    });\n    if (halted()) return { claims: [], failures, notices };\n    const admissionState = readAdmission();\n    if (admissionState.state === 'unreadable') {\n      const { unreadable } = admissionState;\n      throw Object.assign(new Error(`admission cannot be read, so this pull claims nothing: ${unreadable.map(({ path, cause }) => `${path} (${cause})`).join(', ')}`), { unreadable });\n    }\n    if (admissionState.state === 'closed') return { claims: [], failures, admission: admissionState, notices };\n    const taken = [];\n    for (const pull of pulls) {\n      if (limit !== undefined && taken.length >= limit) break;\n      const next = answers.get(pull.card);\n      // A merge claim holds no slot, so N does not bound it (the architect's r2 ruling 3); a limit\n      // given counts every card claimed, since each claim finishes a card.\n      const merge = next.action === 'merge';\n      if (!merge && slots.size >= concurrency) continue;\n      claims.add(pull.card);\n      generations.set(pull.card, (generations.get(pull.card) ?? 0) + 1);\n      if (!merge) slots.add(pull.card);\n      const card = unclaimed.find((item) => item.number === pull.card);\n      setAsides?.claimed(card.number, card.column, read);\n      taken.push({ ...pull, card, next, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size });\n    }\n    return { claims: taken, failures, notices };\n  }"],
  ["src/scheduling/loop.mjs", "work", "parameter", "claim", "claim", null, null, true],
  ["src/scheduling/loop.mjs", "work", "variable", "next", "claim.next", ["parameter", "claim"]],
  ["src/scheduling/loop.mjs", "judged", "parameter", "judge", "judge", null, null, true],
  ["src/scheduling/loop.mjs", "judges", "parameter", "answer", "answer", null, null, true],
  ['src/scheduling/loop.mjs', 'judges', 'parameter', 'judge', 'judge', null, null, true],
  ['src/scheduling/loop.mjs', 'trigger', 'parameter', 'claim', 'claim', null, null, true],
  ['src/scheduling/loop.mjs', 'attempt', 'variable', 'judging', 'eligible(card, ask({}), scope?.memory)'],
  ["src/scheduling/loop.mjs", "judges", "binding", "{ judge, failure }", "each.value.retry", ["binding", "each"], ["judge"]],
  ["src/scheduling/loop.mjs", "trigger", "binding", "{ claims: claimed, failures, admission: closed, notices = [] }", "await take(limit, setAsides, poll, memory)", null, ["claimed"]],

  ['src/scheduling/loop.mjs', 'loop', 'parameter', 'environment', 'environment'],
  ['src/scheduling/loop.mjs', 'dispatchStep', 'parameter', 'step', 'step', null, null, true],
  ['src/scheduling/loop.mjs', 'attempt', 'parameter', 'next', 'next', null, null, true],
  ['src/scheduling/loop.mjs', 'attempt', 'variable', 'answer', 'next', ['parameter', 'next']],
  ['src/scheduling/loop.mjs', 'judgeWork', 'parameter', 'judge', 'judge', null, null, true],
  ['src/scheduling/loop.mjs', 'judgeWork', 'variable', 'current', 'judge', ['parameter', 'judge']],
  ['src/scheduling/loop.mjs', 'judgeWork', 'variable', 'step', 'current.steps[outcomes.length]', ['variable', 'current']],
  ['src/scheduling/loop.mjs', 'answerFrom', 'reader', 'answerFrom', '(answer, ...args) => { try { return answer(...args); } catch (failure) { if (failure?.halt === true) refusedAnswers.add(failure); throw failure; } }'],
  ['src/scheduling/loop.mjs', 'askAttempt', 'reader', 'askAttempt', '(outcomes, options) => answerFrom(decide, card, outcomes, { ...options, firstFailure: failures[0], continuing })'],
  ['src/scheduling/loop.mjs', 'ask', 'reader', 'ask', '(options) => answerFrom(decide, card, [], { ...options, forge: settled.value })'],
  ['src/scheduling/loop.mjs', 'named', 'reader', 'named', "(answer, role) => (answer.action === 'judge' ? answer.judges.find((judge) => judge.role === role) : undefined)"],
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
  ['src/execution/step.mjs', 'stepDispatch', 'parameter', 'step', 'step', null, null, true],
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
  ['A5-copier-binding-reassignment', 'src/substrate/git-environment.mjs', 'export function gitEnvironment(from = process.env) {', "if (process.env.RIGGER_EXTRA) gitEnvironment = (from = process.env) => ({ ...from, EXTRA_TOKEN: 'injected' });\nexport function gitEnvironment(from = process.env) {"],
  ["m2b-imported-origin-write", "src/cli/once.mjs", "import { NOT_STARTED } from '../substrate/process.mjs';", "import { NOT_STARTED } from '../substrate/process.mjs';\nimport { auth as providerAuth } from '../substrate/providers/claude.mjs';\nfunction unlistedProgramWrite() { if (process.env.RIGGER_AUTH_COMMAND) providerAuth[0] = process.env.RIGGER_AUTH_COMMAND; }"],
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
  ["m6-local-config-binding", "src/cli/doctor.mjs", "export async function consumerConfig(target) {\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await import(pathToFileURL(path))).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n}", "export async function consumerConfig(target) {\n  const configFromModule = CONFIG;\n  {\n    const CONFIG = process.env.RIGGER_CONFIG ?? configFromModule;\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await import(pathToFileURL(path))).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n  }\n}"],
  ["m5-local-target-binding", "src/cli/doctor.mjs", "export async function consumerConfig(target) {\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await import(pathToFileURL(path))).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n}", "export async function consumerConfig(target) {\n  const requestedTarget = target;\n  {\n    const target = process.env.RIGGER_CONFIG_TARGET ?? requestedTarget;\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await import(pathToFileURL(path))).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n  }\n}"],
  ["m5-local-import-path-binding", "src/cli/doctor.mjs", "export async function consumerConfig(target) {\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await import(pathToFileURL(path))).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n}", "export async function consumerConfig(target) {\n  const path = join(target, CONFIG);\n  const file = join(real(target), CONFIG);\n  if (!held.has(file)) {\n    let read;\n    try {\n      read = existsSync(path) ? copied((await ((path) => import(pathToFileURL(path)))(process.env.RIGGER_CONFIG_FILE ?? path)).default)\n        : { problem: `\\`${CONFIG}\\` is not in ${target}, and \\`rigger init\\` is what writes it` };\n    } catch (threw) {\n      read = { problem: `\\`${CONFIG}\\` could not be read: ${wentWrong(threw)}` };\n    }\n    held.set(file, read);\n  }\n  const { config, problem } = held.get(file);\n  return problem ? { problem } : copied(config);\n}"],
  ["m6-exported-filename-write", "src/cli/init.mjs", "export const CONFIG = 'rigger.config.mjs';", "export let CONFIG = 'rigger.config.mjs';\nif (process.env.RIGGER_CONFIG) CONFIG = process.env.RIGGER_CONFIG;"],
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
  const initFile = 'src/cli/init.mjs';
  const init = modules.get(initFile);
  const initModel = bindings.models.get(initFile);
  const filenameBinding = initModel.root.names.get('CONFIG');
  const filenames = [...nodes(init.program)].filter(({ node }) => node.type === 'VariableDeclarator' && node.id.name === 'CONFIG' && initModel.lookup(node.id) === filenameBinding);
  if (filenames.length !== 1 || filenames[0].parent.kind !== 'const' || filenames[0].node.init?.type !== 'Literal' || filenames[0].node.init.value !== 'rigger.config.mjs') violations.push(`${initFile} N11 the exported filename must be a const literal`);
  for (const node of bindingWrites(init.program, initModel, new Set([filenameBinding]))) violations.push(`${initFile}:${node.loc.start.line} N11 rewrites the exported filename`);
  const factory = bindings.named(file, 'consumerConfig');
  if (factory?.type !== 'FunctionDeclaration' || syntaxShape(factory.params) !== syntaxShape(parseExpressionAt('(target) => 0', 0, { ecmaVersion: 'latest' }).params)) {
    fail('consumerConfig must take only the target path');
    return violations;
  }
  const entries = [...nodes(factory)];
  const paths = entries.filter(({ node }) => node.type === 'VariableDeclarator' && node.id.name === 'path');
  const imports = entries.filter(({ node }) => node.type === 'ImportExpression');
  if (paths.length !== 1 || paths[0].parent.kind !== 'const' || syntaxShape(paths[0].node.init) !== expressionShape('join(target, CONFIG)') || bindings.origin(file, paths[0].node.init.callee) !== 'node:path#join' || model.lookup(paths[0].node.init.arguments[0]) !== model.lookup(factory.params[0]) || model.lookup(paths[0].node.init.arguments[1]) !== model.root.names.get('CONFIG')) fail('path must use the target parameter and the module CONFIG binding');
  if (imports.length !== 1 || syntaxShape(imports[0].node.source) !== expressionShape('pathToFileURL(path)') || bindings.origin(file, imports[0].node.source.callee) !== 'node:url#pathToFileURL' || paths.length !== 1 || model.lookup(imports[0].node.source.arguments[0]) !== model.lookup(paths[0].node.id)) fail('the sole import must convert the declared constant path binding to a file URL');
  const protectedBindings = new Set([model.root.names.get('CONFIG'), model.lookup(factory.params[0]), ...paths.map(({ node }) => model.lookup(node.id))]);
  for (const node of bindingWrites(modules.get(file).program, model, protectedBindings)) fail(`rewrites the filename or target path at line ${node.loc.start.line}`);
  return violations;
}

/** Parse one independently specified source edit without executing the counterexample. */
function changedPackage(report, file, before, after, reason) {
  const sources = new Map([...report.modules].map(([path, { source }]) => [path, source]));
  assert.equal(sources.get(file).split(before).length - 1, 1, `${reason}: the counterexample anchor is unique`);
  sources.set(file, sources.get(file).replace(before, after));
  return networkReport((path) => sources.get(path), ENTRY_POINTS);
}

// proves R-SAFE-2
test('N8 static invocations: direct, call, apply, Reflect.apply and bound calls follow every static import origin', () => {
  const report = packageReport();
  assert.deepEqual(programReport(report.modules), [], 'N8 static invocation control: the real sites pass');
  const origins = [
    ['named import', "import { runCommand } from '../substrate/process.mjs';", '', 'runCommand'],
    ['namespace import', "import * as processes from '../substrate/process.mjs';", '', 'processes.runCommand'],
    ['literal import destructure', '', "const { runCommand: start } = await import('../substrate/process.mjs');", 'start'],
    ['import alias', "import { runCommand as imported } from '../substrate/process.mjs';", 'const start = imported;', 'start'],
    ['array alias', "import { runCommand as imported } from '../substrate/process.mjs';", 'const [start] = [imported];', 'start'],
    ['object alias', "import { runCommand as imported } from '../substrate/process.mjs';", 'const holder = { start: imported }; const start = holder.start;', 'start'],
    ['literal import namespace alias', '', "const processes = await import('../substrate/process.mjs'); const start = processes.runCommand;", 'start'],
  ];
  const forms = [
    ['direct', (name) => `${name}({ command: 'curl', args: [] });`],
    ['call', (name) => `${name}.call(null, { command: 'curl', args: [] });`],
    ['apply', (name) => `${name}.apply(null, [{ command: 'curl', args: [] }]);`],
    ['Reflect.apply', (name) => `Reflect.apply(${name}, null, [{ command: 'curl', args: [] }]);`],
    ['bind then call', (name) => `const bound = ${name}.bind(null); bound({ command: 'curl', args: [] });`],
    ['bind arguments then call', (name) => `const bound = ${name}.bind(null, { command: 'curl', args: [] }); bound();`],
    ['call method alias', (name) => `const invoke = ${name}.call.bind(${name}); invoke(null, { command: 'curl', args: [] });`],
    ['apply method alias', (name) => `const invoke = ${name}.apply.bind(${name}); invoke(null, [{ command: 'curl', args: [] }]);`],
    ['Reflect.apply alias', (name) => `const invoke = Reflect.apply; invoke(${name}, null, [{ command: 'curl', args: [] }]);`],
  ];
  const file = 'src/cli/once.mjs';
  const anchor = "import { NOT_STARTED } from '../substrate/process.mjs';";
  const missed = [];
  for (const [origin, imported, setup, name] of origins) for (const [form, invoke] of forms) {
    const label = `${origin} / ${form}`;
    const source = `${anchor}\n${imported}\nasync function unlistedStaticInvocation() { ${setup} ${invoke(name)} }`;
    const changed = changedPackage(report, file, anchor, source, label);
    if (!programReport(changed.modules).some((line) => line.includes(file) && line.includes('unlisted process site'))) missed.push(label);
  }

  for (const [form, invoke] of forms) {
    const label = `literal native default namespace / ${form}`;
    const file = 'src/substrate/host.mjs';
    const anchor = 'export const realHost = {';
    const call = invoke('native.execFile').replaceAll("{ command: 'curl', args: [] }", "'curl', ['https://example.invalid']");
    const source = `async function unlistedStaticInvocation() { const { default: native } = await import('node:child_process'); ${call} }\n${anchor}`;
    const changed = changedPackage(report, file, anchor, source, label);
    if (!programReport(changed.modules).some((line) => line.includes(file) && line.includes('unlisted process site'))) missed.push(label);
  }

  for (const [form, setup] of [
    ['conditional first branch', 'const start = process.env.RIGGER_SELECT ? imported : (() => 0);'],
    ['conditional second branch', 'const start = process.env.RIGGER_SELECT ? (() => 0) : imported;'],
    ['logical alias', 'const start = imported || (() => 0);'],
    ['sequence alias', 'const start = (0, imported);'],
    ['undefined destructuring default', 'const { start = imported } = { start: undefined };'],
  ]) {
    const source = `${anchor}\nimport { runCommand as imported } from '../substrate/process.mjs'; function unlistedAlias() { ${setup} start({ command: 'curl', args: [] }); }`;
    const changed = changedPackage(report, file, anchor, source, form);
    if (!programReport(changed.modules).some((line) => line.includes(file) && line.includes('unlisted process site'))) missed.push(form);
  }
  assert.deepEqual(missed, [], 'N8: every static invocation form and binding origin must enter the process inventory');
  for (const [form, call] of [
    ['nested call method', "runCommand.call.call(runCommand, null, { command: 'curl' });"],
    ['nested Reflect.apply', "Reflect.apply(Reflect.apply, null, [runCommand, null, [{ command: 'curl' }]]);"],
    ['method with a different receiver', "const local = () => 0; const call = local.call.bind(runCommand); call(null, { command: 'curl' });"],
  ]) {
    const changed = changedPackage(report, file, anchor, `${anchor}\nimport { runCommand } from '../substrate/process.mjs'; function unlistedMethodReceiver() { ${call} }`, form);
    assert.ok(programReport(changed.modules).some((line) => line.includes(file) && line.includes('unlisted process site')), `N8: the actual method receiver determines ${form}`);
  }
  for (const [form, setup, name] of [
    ['assigned alias', 'let start; start = runCommand;', 'start'],
    ['destructuring-assigned alias', 'let start; ({ start } = { start: runCommand });', 'start'],
    ['namespace spread alias', 'const holder = { ...processes };', 'holder.runCommand'],
    ['object spread alias', 'const holder = { ...{ start: runCommand } };', 'holder.start'],
  ]) {
    const changed = changedPackage(report, file, anchor, `${anchor}\nimport { runCommand } from '../substrate/process.mjs'; import * as processes from '../substrate/process.mjs'; function unlistedStoredAlias() { ${setup} ${name}({ command: 'curl' }); }`, form);
    assert.ok(programReport(changed.modules).some((line) => line.includes(file) && line.includes('unlisted process site')), `N8: static alias origins include ${form}`);
  }
  const rebound = changedPackage(report, 'src/substrate/data-ref.mjs', 'run = runCommand', "run = runCommand.bind(null, { command: 'curl', args: [] })", 'bound arguments at an existing site');
  assert.ok(programReport(rebound.modules).some((line) => line.includes('src/substrate/data-ref.mjs')), 'N8: bound prefix arguments must not replace the reviewed git input');
  const uncalled = changedPackage(report, file, anchor, `${anchor}\nimport { runCommand } from '../substrate/process.mjs'; function configuredLater() { const bound = runCommand.bind(null); return bound; }`, 'bind without a call');
  assert.deepEqual(programReport(uncalled.modules), [], 'N8: creating an uncalled bound function is not an invocation');
});

// proves R-SAFE-2
test('N8 native bindings: parameter, catch and inner declaration shadows change the reviewed program', () => {
  const report = packageReport();
  assert.deepEqual(programReport(report.modules), [], 'N8 native binding control: the real sites pass');
  const file = 'src/substrate/process.mjs';
  const model = report.modules.get(file);
  const sites = [['run', 'host.execFile', 'ps'], ['runCommand', 'host.spawn', 'command'], ['startOf', 'host.spawnSync', 'ps'], ['runOnce', 'spawn', 'ps']];
  const shadows = [
    ['parameter', (name, call) => `((${name}) => ${call})(process.env.RIGGER_COMMAND ?? ${name})`],
    ['catch', (name, call) => `(() => { try { throw process.env.RIGGER_COMMAND ?? ${name}; } catch (${name}) { return ${call}; } })()`],
    ['inner declaration', (name, call) => `((original) => { const ${name} = process.env.RIGGER_COMMAND ?? original; return ${call}; })(${name})`],
  ];
  const missed = [];
  for (const [owner, callee, name] of sites) {
    const calls = [...nodes(model.program)].filter(({ node, owner: at }) => at === owner && node.type === 'CallExpression' && syntaxShape(node.callee) === expressionShape(callee));
    assert.equal(calls.length, 1, `${owner}: exactly one native start establishes the fixture`);
    const call = model.source.slice(calls[0].node.start, calls[0].node.end);
    const sameBinding = changedPackage(report, file, call, `(() => ${call})()`, `${owner} retains its binding`);
    assert.deepEqual(programReport(sameBinding.modules), [], 'N8: a closure retaining the reviewed binding remains admitted');
    for (const [form, rewrite] of shadows) {
      const label = `${owner} / ${form}`;
      const changed = changedPackage(report, file, call, rewrite(name, call), label);
      if (!programReport(changed.modules).some((line) => line.includes(file) && line.includes('program binding differs'))) missed.push(label);
    }
  }
  assert.deepEqual(missed, [], 'N8: native program arguments must keep the reviewed binding identity under every shadow form');
});

// proves R-SAFE-2, R-SAFE-4
test('N8 and A5 writes: assignment, update, for-of, for-in and destructuring protect programs and environments', () => {
  const report = packageReport();
  assert.deepEqual(programReport(report.modules), [], 'protected write control: the real program and environment construction passes');
  const forms = [
    ['assignment', (target, value) => `${target} = ${value};`],
    ['update', (target) => `${target}++;`],
    ['for-of', (target, value) => `for (${target} of [${value}]);`],
    ['for-in', (target) => `for (${target} in { proxy: true });`],
    ['object assignment', (target, value) => `({ proxy: ${target} } = { proxy: ${value} });`],
    ['array assignment', (target, value) => `[${target}] = [${value}];`],
    ['nested assignment', (target, value) => `({ outer: [${target}] } = { outer: [${value}] });`],
    ['default assignment', (target, value) => `[${target} = ${value}] = [];`],
    ['array rest assignment', (target, value) => `[...${target}] = [${value}];`],
    ['object rest assignment', (target, value) => `({ ...${target} } = { proxy: ${value} });`],
    ['for-of destructuring', (target, value) => `for ([${target}] of [[${value}]]);`],
    ['for-in destructuring', (target) => `for ([${target}] in { proxy: true });`],
  ];
  const importLine = "import { NOT_STARTED } from '../substrate/process.mjs';";
  const startLine = "  const stdin = input === undefined ? 'ignore' : 'pipe';";
  const targets = [
    ['engine environment', 'src/cli/once.mjs', importLine, 'process.env.HTTPS_PROXY', 'process.env.RIGGER_PROXY', (write) => `${importLine}\nfunction unlistedProtectedWrite() { ${write} }`],
    ['native program parameter', 'src/substrate/process.mjs', startLine, 'command', "'curl'", (write) => `  ${write}\n${startLine}`],
  ];
  const missed = [];
  for (const [name, file, anchor, target, value, source] of targets) for (const [form, write] of forms) {
    const label = `${name} / ${form}`;
    const changed = changedPackage(report, file, anchor, source(write(target, value)), label);
    if (!programReport(changed.modules).some((line) => line.includes(file) && line.includes('rewrites a reviewed'))) missed.push(label);
  }
  assert.deepEqual(missed, [], 'N8/A5: every static write target must protect the reviewed program and engine environment');
});

import { URL as URLExport } from 'node:url';
import urlModule from 'node:url';

// proves R-SAFE-2
test('N11 global writes: admitted globals, prototypes and aliases reject static writes and mutators', () => {
  assert.equal(URLExport, globalThis.URL, 'N11: node:url exports the admitted global URL constructor');
  assert.equal(urlModule.URL, globalThis.URL, 'N11: the builtin default export reaches the same admitted URL constructor');
  const forms = [
    ['prototype assignment', 'URL.prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['builtin default import', "import urls from 'node:url'; urls.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['named default import', "import { default as urls } from 'node:url'; urls.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['literal default import namespace', "const { default: urls } = await import('node:url'); urls.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['nested literal default import destructure', "const { default: { URL: ConfigURL } } = await import('node:url'); ConfigURL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['imported constructor alias', "import { URL as ConfigURL } from 'node:url'; ConfigURL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['imported constructor namespace', "import * as urls from 'node:url'; urls.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['literal imported constructor', "const { URL: ConfigURL } = await import('node:url'); ConfigURL.prototype.toString = () => process.env.RIGGER_PLUGIN;"],
    ['globalThis member', 'globalThis.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['global member', 'global.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['constructor alias', 'const ConfigURL = URL; ConfigURL.prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['conditional constructor alias', 'const ConfigURL = process.env.RIGGER_USE_URL ? URL : Object; ConfigURL.prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['prototype alias', 'const prototype = URL.prototype; prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['prototype destructure', 'const { prototype } = URL; prototype.toString = () => process.env.RIGGER_PLUGIN;'],
    ['update', 'URL.prototype.toString++;'],
    ['for-of', 'for (URL.prototype.toString of [() => process.env.RIGGER_PLUGIN]);'],
    ['for-in', 'for (URL.prototype.toString in { plugin: true });'],
    ['destructuring assignment', '[URL.prototype.toString] = [() => process.env.RIGGER_PLUGIN];'],
    ['delete', 'delete URL.prototype.toString;'],
    ['Object.assign', 'Object.assign(URL.prototype, { toString: () => process.env.RIGGER_PLUGIN });'],
    ['Object.assign.call', 'Object.assign.call(null, URL.prototype, { toString: () => process.env.RIGGER_PLUGIN });'],
    ['Object.assign.apply', 'Object.assign.apply(null, [URL.prototype, { toString: () => process.env.RIGGER_PLUGIN }]);'],
    ['Reflect.apply mutator', 'Reflect.apply(Object.assign, null, [URL.prototype, { toString: () => process.env.RIGGER_PLUGIN }]);'],
    ['bound mutator', 'const write = Object.assign.bind(null, URL.prototype); write({ toString: () => process.env.RIGGER_PLUGIN });'],
    ['Object.defineProperty', "Object.defineProperty(URL.prototype, 'toString', { value: () => process.env.RIGGER_PLUGIN });"],
    ['Reflect.set', "Reflect.set(URL.prototype, 'toString', () => process.env.RIGGER_PLUGIN);"],
    ...[...GLOBALS.keys()].map((name) => [`admitted ${name}`, `${name}.guardedMember = 0;`]),
  ];
  const missed = [];
  for (const [form, source] of forms) {
    const report = networkReport(() => source, ['fixture.mjs']);
    if (!report.violations.some((line) => line.startsWith('fixture.mjs:1 N11') && line.includes('protected global write'))) missed.push(form);
  }
  assert.deepEqual(missed, [], 'N11: every admitted global and statically reached prototype must reject protected writes');
  for (const [exported, write] of [['URL.prototype', 'shared.toString = () => process.env.RIGGER_PLUGIN;'], ['URL.prototype.toString', 'shared.plugin = process.env.RIGGER_PLUGIN;']]) {
    const sources = new Map([['entry.mjs', `import { shared } from './origin.mjs'; ${write}`], ['origin.mjs', `export const shared = ${exported};`]]);
    const crossed = networkReport((file) => sources.get(file), ['entry.mjs']);
    assert.ok(crossed.violations.some((line) => line.startsWith('entry.mjs:1 N11') && line.includes('protected global write')), 'N11: static global-member aliases remain protected across imports');
  }
  for (const source of ['const URL = { prototype: {} }; URL.prototype.toString = () => 0;', 'function local(URL) { URL.prototype.toString = () => 0; }']) {
    assert.deepEqual(networkReport(() => source, ['fixture.mjs']).violations, [], 'N11: a local object sharing a global name remains local');
  }
  const report = packageReport();
  assert.deepEqual(report.violations, [], 'N11: real package reads and the reviewed exit-status write remain admitted');
  const exitWrite = 'if (ranDirectly) process.exitCode = await main(process.argv.slice(2), process.env);';
  for (const rewrite of ['if (ranDirectly) process.exitCode = 0;', `${exitWrite}\n${exitWrite}`]) {
    const changed = changedPackage(report, 'scripts/gate-check.mjs', exitWrite, rewrite, 'reviewed global write');
    assert.ok(changed.violations.some((line) => line.startsWith('scripts/gate-check.mjs:') && line.includes('N11 protected global write')), 'N11: the reviewed exit-status statement may neither change nor duplicate');
  }

  const anchor = "import { NOT_STARTED } from '../substrate/process.mjs';";
  const changed = changedPackage(report, 'src/cli/once.mjs', anchor, `${anchor}\nasync function selectedConfig(named) { return consumerConfig(process.env.RIGGER_TARGET ?? named); }`, 'n21 remains out of scope');
  assert.deepEqual(changed.violations, [], 'M8-K13: selecting a consumer target is outside this guard');
  assert.deepEqual(configReport(changed.modules), [], 'M8-K13: the admitted import still resolves within its supplied target');
});

// proves R-SAFE-2, R-SAFE-4
test('N8 A5 N11 static stores: each store form preserves or refuses protected process, environment and prototype origins', () => {
  const report = packageReport();
  assert.deepEqual(report.violations, [], 'static-store control: the real global reads pass');
  assert.deepEqual(programReport(report.modules), [], 'static-store control: the real process and environment construction passes');
  const forms = [
    ['call receiver store', (value, key) => [`const holder = {}; const locateStore = () => holder; locateStore().${key} = ${value};`, `holder.${key}`]],
    ['call receiver read', (value, key) => [`const holder = {}; const locateStore = () => holder; holder.${key} = ${value};`, `locateStore().${key}`]],
    ['call receiver both', (value, key) => [`const holder = {}; const locateStore = () => holder; locateStore().${key} = ${value};`, `locateStore().${key}`]],
    ['call receiver nested field', (value, key) => [`const holder = {}; const locateStore = () => holder; locateStore().nested = { ${key}: ${value} };`, `holder.nested.${key}`]],
    ['this receiver store', (value, key) => [`const holder = {}; function saveStore() { this.${key} = ${value}; } saveStore.call(holder);`, `holder.${key}`]],
    ['conditional call receiver store', (value, key) => [`const holder = {}; const other = {}; const locateStore = () => holder; (process.env.RIGGER_STORE ? other : locateStore()).${key} = ${value};`, `holder.${key}`]],
    ['conditional receiver alias store', (value, key) => [`const holder = {}; const other = {}; const locateStore = () => holder; const receiver = process.env.RIGGER_STORE ? other : locateStore(); receiver.${key} = ${value};`, `holder.${key}`]],
    ['dotted assignment', (value, key) => [`const holder = {}; holder.${key} = ${value};`, `holder.${key}`]],
    ['literal assignment', (value, key) => [`const holder = {}; holder['${key}'] = ${value};`, `holder['${key}']`]],
    ['object field', (value, key) => [`const holder = { ${key}: ${value} };`, `holder.${key}`]],
    ['shorthand field', (value) => [`const saved = ${value}; const holder = { saved };`, 'holder.saved']],
    ['nested member', (value, key) => [`const holder = { nested: {} }; holder.nested.${key} = ${value};`, `holder.nested.${key}`]],
    ['nested object field', (value, key) => [`const holder = { nested: { ${key}: ${value} } };`, `holder.nested.${key}`]],
    ['assigned object field', (value, key) => [`const holder = {}; holder.nested = { ${key}: ${value} };`, `holder.nested.${key}`]],
    ['receiver alias', (value, key) => [`const holder = { nested: {} }; const receiver = holder.nested; receiver.${key} = ${value};`, `holder.nested.${key}`]],
    ['stored container alias', (value, key) => [`const stored = { ${key}: ${value} }; const holder = {}; holder.nested = stored;`, `holder.nested.${key}`]],
    ['destructuring store', (value, key) => [`const holder = {}; ({ saved: holder.${key} } = { saved: ${value} });`, `holder.${key}`]],
    ['destructuring default store', (value, key) => [`const holder = {}; ({ saved: holder.${key} = ${value} } = {});`, `holder.${key}`]],
    ['array rest after prefix', (value) => [`const holder = {}; [, ...holder.saved] = [null, ${value}];`, 'holder.saved[0]']],
    ['logical assignment', (value, key) => [`const holder = {}; holder.${key} ||= ${value};`, `holder.${key}`]],
    ['spread field', (value, key) => [`const holder = { ...{ ${key}: ${value} } };`, `holder.${key}`]],
    ['assigned getter field', (value, key) => [`const holder = {}; holder.nested = { get ${key}() { return ${value}; } };`, `holder.nested.${key}`]],
    ['assigned array field', (value) => [`const holder = {}; holder.saved = [${value}];`, 'holder.saved[0]']],
    ['cyclic receiver alias', (value, key) => [`const holder = {}; holder.nested = holder; holder.nested.${key} = ${value};`, `holder.${key}`]],
  ];
  const once = 'src/cli/once.mjs';
  const importLine = "import { NOT_STARTED } from '../substrate/process.mjs';";
  const origins = [
    ['process starter', 'call', once, importLine, "import { runCommand } from '../substrate/process.mjs';", 'runCommand', 'start', (name) => `${name}({ command: 'curl', args: ['https://example.invalid'] });`],
    ['renamed process starter', 'call', once, importLine, "import { runCommand as fieldCommand } from '../substrate/process.mjs';", 'fieldCommand', 'start', (name) => `${name}({ command: 'curl', args: ['https://example.invalid'], cwd, env: process.env, timeout: 1000, emitter });`],
    ['native starter', 'call', 'src/substrate/host.mjs', 'export const realHost = {', `import { execFile as fieldCommand } from '${['node', 'child_process'].join(':')}';`, 'fieldCommand', 'start', (name) => `${name}('curl', ['https://example.invalid']);`],
    ['namespace starter', 'call', once, importLine, "import * as processes from '../substrate/process.mjs';", 'processes', 'processes', (name) => `${name}.runCommand({ command: 'curl', args: [] });`],
    ['bound starter', 'call', once, importLine, "import { runCommand as fieldCommand } from '../substrate/process.mjs';", 'fieldCommand.bind(null)', 'start', (name) => `${name}({ command: 'curl', args: [] });`],
    ['invocation method', 'call', once, importLine, "import { runCommand as fieldCommand } from '../substrate/process.mjs';", 'fieldCommand.call', 'start', (name) => `${name}.call(fieldCommand, null, { command: 'curl', args: [] });`],
    ['engine environment', 'env write', once, importLine, '', 'process.env', 'environment', (name) => `${name}.RIGGER_ACCOUNT_EXTRA = '/tmp/injected';`],
    ['dispatch environment', 'env write', 'src/execution/role.mjs', '  Object.assign(environment, set);', '', 'environment', 'saved', (name) => `if (env.RIGGER_EXTRA) ${name}.EXTRA_TOKEN = 'invented';`],
    ['L3 dispatch environment', 'env write', 'src/scheduling/loop.mjs', '  const dispatchStep = async (card, step, path, fields) => {', '', 'environment', 'saved', (name) => `if (environment.RIGGER_EXTRA) ${name}.EXTRA_TOKEN = 'invented';`],
    ['environment parameter', 'env write', 'src/substrate/process.mjs', "  const stdin = input === undefined ? 'ignore' : 'pipe';", '', 'env', 'saved', (name) => `if (env.RIGGER_EXTRA) ${name}.EXTRA_TOKEN = 'invented';`],
    ['global namespace', 'prototype write', once, importLine, "import * as urls from 'node:url';", 'urls', 'urls', (name) => `${name}.URL.prototype.toString = () => process.env.RIGGER_PLUGIN;`],
    ['global mutator', 'prototype write', once, importLine, '', 'Object.assign', 'write', (name) => `${name}(URL.prototype, { toString: () => process.env.RIGGER_PLUGIN });`],
    ['admitted global', 'prototype write', once, importLine, '', 'URL', 'saved', (name) => `${name}.prototype.toString = () => process.env.RIGGER_PLUGIN;`],
    ['prototype saved', 'prototype write', once, importLine, '', 'URL.prototype', 'saved', (name) => `${name}.toString = () => process.env.RIGGER_PLUGIN;`],
    ['prototype named', 'prototype write', once, importLine, '', 'URL.prototype', 'prototype', (name) => `${name}.toString = () => process.env.RIGGER_PLUGIN;`],
  ];
  for (const [form, store] of forms) {
    const [localSetup, local] = store('{}', 'saved');
    const control = changedPackage(report, once, importLine, `${importLine}\nfunction localStore() { ${localSetup} ${local}.value = 0; }`, `local / ${form}`);
    assert.deepEqual(control.violations, [], `${form}: storing and writing an ordinary local object remains admitted`);
    assert.deepEqual(programReport(control.modules), [], `${form}: an ordinary local store is no process or environment origin`);
    for (const [origin, use, file, anchor, imported, value, key, act] of origins) {
      const label = `${form} / ${origin} / ${use}`;
      const [setup, name] = store(value, key);
      const body = `${setup} ${act(name)}`;
      const replacement = file === once ? `${anchor}\n${imported}\nfunction unlistedStoredOrigin(cwd, emitter) { ${body} }`
        : file === 'src/substrate/host.mjs' ? `${imported}\nfunction unlistedStoredOrigin() { ${body} }\n${anchor}`
          : file === 'src/execution/role.mjs' ? `${anchor}\n  ${body}` : `  ${body}\n${anchor}`;
      const changed = changedPackage(report, file, anchor, replacement, label);
      const violations = use === 'prototype write' ? changed.violations : programReport(changed.modules);
      assert.ok(violations.some((line) => line.includes(file) && line.includes(use === 'prototype write' ? 'N11' : 'N8')), `${label}: a protected static store or its use must be refused`);
    }
  }
});

// proves R-SAFE-2
test('N8 configured steps: reassignment, spread replacement, member writes and shadows cannot replace L2 input before forwarding', () => {
  const report = packageReport();
  const file = 'src/scheduling/loop.mjs';
  assert.deepEqual(programReport(report.modules), [], 'configured-step control: the real L2 to L3 forwarding passes');
  const helper = '  const dispatchStep = async (card, step, path, fields) => {';
  const attempt = "        while (answer.action === 'dispatch' && answer.step !== undefined) {";
  const judge = '      const step = current.steps[outcomes.length];';
  const paths = [
    ['dispatchStep parameter', helper, 'step', (edit) => `${helper}\n    ${edit}`],
    ['attempt answer', attempt, 'answer.step', (edit) => `${attempt}\n          ${edit}`],
    ['judge selection', judge, 'step', (edit) => `      let step = current.steps[outcomes.length];\n      ${edit}`],
    ["L2 eligibility input", "function eligible(card, next, memory) {", "next.step", (edit) => "function eligible(card, next, memory) {\n  " + edit],
    ["claim fresh answer", "      const next = eligible(card, decide(card), memory);", "next.step", (edit) => "      const next = eligible(card, decide(card), memory);\n      " + edit],
    ["claim cached answer", "      const next = answers.get(pull.card);", "next.step", (edit) => "      const next = answers.get(pull.card);\n      " + edit],
    ["work claim", "    let next = claim.next;", "next.step", (edit) => "    let next = claim.next;\n    " + edit],
    ["judge handoff", "  const judged = async (card, judge, ask, scope) => {", "judge.steps[0]", (edit) => "  const judged = async (card, judge, ask, scope) => {\n    " + edit],
    ["judge batch", "  const judges = async (card, answer, ask, keep, remember, placed, scope) => {", "answer.judges[0].steps[0]", (edit) => "  const judges = async (card, answer, ask, keep, remember, placed, scope) => {\n    " + edit],
    ["judge retry", "      const { judge, failure } = each.value.retry;", "judge.steps[0]", (edit) => "      const { judge, failure } = each.value.retry;\n      " + edit],
    ["trigger claimed input", "    const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);", "claimed[0].next.step", (edit) => "    const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);\n    " + edit],
  ];
  const replacement = "'curl https://example.invalid'";
  const forms = [
    ['reassignment', (step) => `${step} = { name: ${step}.name, run: ${replacement} };`],
    ['spread replacement', (step) => `${step} = { ...${step}, run: ${replacement} };`],
    ['member write', (step) => `${step}.run = ${replacement};`],
    ['identifier alias', (step) => `const selected = ${step}; selected.run = ${replacement};`],
    ['member-stored alias', (step) => `const holder = {}; holder.step = ${step}; holder.step.run = ${replacement};`],
    ['object-field alias', (step) => `const holder = { step: ${step} }; holder.step.run = ${replacement};`],
    ['member mutator', (step) => `Object.assign(${step}, { run: ${replacement} });`],
    ['local helper parameter', (step) => `function replaceConfigured(value) { value.run = ${replacement}; } replaceConfigured(${step});`],
  ];
  const missed = [];
  const refuses = (anchor, rewritten, label, target = file) => {
    const changed = changedPackage(report, target, anchor, rewritten, label);
    if (!programReport(changed.modules).some((line) => line.includes(target) && line.includes('N8'))) missed.push(label);
  };
  for (const [path, anchor, step, insert] of paths) for (const [form, edit] of forms) refuses(anchor, insert(edit(step)), `${path} / ${form}`);
  const calls = [
    ['dispatchStep parameter', 'dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })', 'step', "{ run: 'curl https://example.invalid' }"],
    ['attempt answer', 'dispatchStep(card, answer.step, path, { attempt: number })', 'answer', "{ step: { run: 'curl https://example.invalid' } }"],
    ['judge selection', 'dispatchStep(card, step, head, { role })', 'step', "{ run: 'curl https://example.invalid' }"],
  ];
  for (const [path, call, name, forged] of calls) {
    const closure = changedPackage(report, file, call, `(() => ${call})()`, `${path} / unchanged binding closure`);
    assert.deepEqual(programReport(closure.modules), [], `${path}: a closure retaining the configured binding stays admitted`);
    for (const [form, rewritten] of [
      ['parameter shadow', `((${name}) => ${call})(${forged})`],
      ['catch shadow', `(() => { try { throw ${forged}; } catch (${name}) { return ${call}; } })()`],
      ['inner declaration shadow', `(() => { const ${name} = ${forged}; return ${call}; })()`],
    ]) refuses(call, rewritten, `${path} / ${form}`);
  }
  refuses(attempt, `${attempt}\n          answer = { ...answer, step: { ...answer.step, run: ${replacement} } };`, 'attempt answer / container replacement');
  refuses(judge, `      current.steps = [{ run: ${replacement} }];\n${judge}`, 'judge selection / array replacement');
  refuses(judge, `      current.steps[outcomes.length] = { run: ${replacement} };\n${judge}`, 'judge selection / selected field replacement');
  refuses(judge, `      const current = { steps: [{ run: ${replacement} }] };\n${judge}`, 'judge selection / source binding shadow');
  const readers = [
    ['answerFrom', 'try { return answer(...args); }', `try { return { step: { run: ${replacement} } }; }`],
    ['askAttempt', '(outcomes, options) => answerFrom(decide, card, outcomes, { ...options, firstFailure: failures[0], continuing })', `(outcomes, options) => ({ action: 'dispatch', step: { run: ${replacement} } })`],
    ['ask', '(options) => answerFrom(decide, card, [], { ...options, forge: settled.value })', `(options) => ({ action: 'judge', judges: [{ steps: [{ run: ${replacement} }] }] })`],
    ['named', "(answer, role) => (answer.action === 'judge' ? answer.judges.find((judge) => judge.role === role) : undefined)", `(answer, role) => ({ steps: [{ run: ${replacement} }] })`],
  ];
  for (const [reader, anchor, rewritten] of readers) refuses(anchor, rewritten, `L2 reader / ${reader} replacement`);
  for (const [path, update, reader, forged] of [
    ['judge selection', 'current = named(answer, role)', 'named', `({ steps: [{ run: ${replacement} }] })`],
    ['attempt answer', 'answer = askAttempt([...outcomes], { attempt: number })', 'askAttempt', `({ action: 'dispatch', step: { run: ${replacement} } })`],
  ]) refuses(update, `((${reader}) => { ${update}; })(() => ${forged})`, `${path} / admitted reader binding shadow`);
  const forwardingCalls = [
    ['work to attempt', 'attempt(card, next, kept, remember, placed, scope)', 'attempt(card, ', 'next', `{ ...next, step: { run: ${replacement} } }`],
    ['work to judges', 'judges(card, next, (options) => answerFrom(atPull, card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember, placed, scope)', 'judges(card, ', 'next', `{ ...next, judges: [{ steps: [{ run: ${replacement} }] }] }`],
    ['attempt to judges', 'judges(card, judging, ask, (ended) => kept({ ...reached, judges: ended }), remember, placed, scope)', 'judges(card, ', 'judging', `{ ...judging, judges: [{ steps: [{ run: ${replacement} }] }] }`],
    ['judge map to judged', 'judged(card, judge, ask, scope)', 'judged(card, ', 'judge', `{ ...judge, steps: [{ run: ${replacement} }] }`],
    ['judge retry to judged', 'judged(card, judge, repeat, scope)', 'judged(card, ', 'judge', `{ ...judge, steps: [{ run: ${replacement} }] }`],
    ['judged to judgeWork', 'judgeWork(card, judge, ask, scope)', 'judgeWork(card, ', 'judge', `{ ...judge, steps: [{ run: ${replacement} }] }`],
    ['trigger to work', 'work(claim, freed, setAsides)', 'work(', 'claim', `{ ...claim, next: { action: 'dispatch', step: { run: ${replacement} } } }`],
    ['judgeWork to dispatchStep', 'dispatchStep(card, step, head, { role })', 'dispatchStep(card, ', 'step', `{ ...step, run: ${replacement} }`],
    ['dispatchStep to stepDispatch', 'stepDispatch(step, path, environment)', 'stepDispatch(', 'step', `{ ...step, run: ${replacement} }`],
    ['refreshed named selection', 'current = named(answer, role)', 'named(', 'answer', `{ action: 'judge', judges: [{ role, steps: [{ run: ${replacement} }] }] }`],
    ['withheld named selection', 'if (named(answer, role) === undefined)', 'named(', 'answer', `{ action: 'judge', judges: [{ role, steps: [{ run: ${replacement} }] }] }`],
    ['claim to answer map', 'answers.set(card.number, next)', 'answers.set(card.number, ', 'next', `{ ...next, step: { run: ${replacement} } }`],
    ['attempt selected step', 'dispatchStep(card, answer.step, path, { attempt: number })', 'dispatchStep(card, ', 'answer.step', `{ ...answer.step, run: ${replacement} }`],
    ['claim configured producer', 'eligible(card, decide(card), memory)', 'eligible(card, ', 'decide(card)', `{ action: 'dispatch', step: { run: ${replacement} } }`],
    ['settled configured producer', 'eligible(card, ask({}), scope?.memory)', 'eligible(card, ', 'ask({})', `{ action: 'judge', judges: [{ role: 'reviewer', steps: [{ run: ${replacement} }] }] }`],
    ['claim container store', 'taken.push({ ...pull, card, next, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size })', 'taken.push(', '{ ...pull, card, next, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size }', `{ ...pull, card, next: { ...next, step: { run: ${replacement} } }, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size }`],
  ];
  const argumentForms = [
    ['spread argument', (name, forged) => forged],
    ['object literal argument', (name, forged) => `({ substituted: ${forged} })`],
    ['conditional argument', (name, forged) => `(process.env.RIGGER_STEP ? ${forged} : ${name})`],
    ['call argument', (name, forged) => `(() => (${forged}))()`],
    ['member argument', (name, forged) => `({ value: ${forged} }).value`],
    ['argument list spread', (name, forged) => `...[${forged}]`],
  ];
  for (const [path, call, prefix, name, forged] of forwardingCalls) for (const [form, edit] of argumentForms) {
    const rewritten = call.replace(`${prefix}${name}`, `${prefix}${edit(name, forged)}`);
    refuses(call, rewritten, `${path} / ${form}`);
  }
  const selectorCalls = [
    ['configured answer step', 'dispatchStep(card, answer.step, path, { attempt: number })', 'answer.step'],
    ['claim L2 producer', 'eligible(card, decide(card), memory)', 'decide(card)'],
    ['settled L2 producer', 'eligible(card, ask({}), scope?.memory)', 'ask({})'],
    ['claimed container producer', 'taken.push({ ...pull, card, next, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size })', '{ ...pull, card, next, decide, order: order++, scope: memory === undefined ? undefined : { memory }, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size }'],
  ];
  for (const [path, call, selected] of selectorCalls) for (const [form, edit] of [
    ['selector spread', (value) => `({ ...${value} })`],
    ['selector fallback', (value) => `(${value} ?? { run: ${replacement} })`],
    ['selector call', (value) => `((value) => value)(${value})`],
    ['selector member', (value) => `({ selected: ${value} }).selected`],
  ]) refuses(call, call.replace(selected, edit(selected)), `${path} / ${form}`);
  const receiving = [
    ['work claim', file, 'const work = async (claim, freed, setAsides) =>', 'async (', 'claim'],
    ['attempt next', file, 'const attempt = async (card, next, kept, remember, placed, scope) =>', 'async (card, ', 'next'],
    ['judges answer', file, 'const judges = async (card, answer, ask, keep, remember, placed, scope) =>', 'async (card, ', 'answer'],
    ['judged judge', file, 'const judged = async (card, judge, ask, scope) =>', 'async (card, ', 'judge'],
    ['judgeWork judge', file, 'const judgeWork = async (card, judge, ask, scope) =>', 'async (card, ', 'judge'],
    ['dispatchStep step', file, 'const dispatchStep = async (card, step, path, fields) =>', 'async (card, ', 'step'],
    ['judge map binding', file, 'answer.judges.map((judge) => judged(card, judge, ask, scope))', '.map((', 'judge'],
    ['claim map binding', file, 'claimed.map((claim) =>', '.map((', 'claim'],
    ['stepDispatch step', 'src/execution/step.mjs', 'export const stepDispatch = (step, workspace, env = process.env) =>', '= (', 'step'],
    ['named answer', file, 'const named = (answer, role) =>', '= (', 'answer'],
    ['eligible next', file, 'function eligible(card, next, memory) {', '(card, ', 'next'],
  ];
  const fallback = `{ action: 'dispatch', step: { run: ${replacement} }, steps: [{ run: ${replacement} }], run: ${replacement} }`;
  for (const [path, target, anchor, prefix, name] of receiving) for (const [form, parameter] of [
    ['parameter default', `${name} = ${fallback}`],
    ['destructuring default', `{ ${name} = ${fallback} }`],
  ]) refuses(anchor, anchor.replace(`${prefix}${name}`, `${prefix}${parameter}`), `${path} / ${form}`, target);
  for (const [path, anchor, replacementText] of [
    ['judge retry binding', 'const { judge, failure } = each.value.retry;', `const { judge = ${fallback}, failure } = each.value.retry;`],
    ['claimed binding', 'const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);', `const { claims: claimed = [${fallback}], failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);`],
    ['retry iterator binding', 'for (const [at, each] of settled.entries()) {', `for (const [at, each = ${fallback}] of settled.entries()) {`],
  ]) refuses(anchor, replacementText, `${path} / destructuring default`);
  const selectedValues = [
    ['selected judge step', 'const step = current.steps[outcomes.length];', 'current.steps[outcomes.length]'],
    ['selected work answer', 'let next = claim.next;', 'claim.next'],
    ['selected retry', 'const { judge, failure } = each.value.retry;', 'each.value.retry'],
    ['selected cached answer', 'const next = answers.get(pull.card);', 'answers.get(pull.card)'],
    ['returned claim list', 'return { claims: taken, failures, notices };', '{ claims: taken, failures, notices }'],
    ['returned claim result', 'return await claim(limit, setAsides, read, failures, notices, memory);', 'await claim(limit, setAsides, read, failures, notices, memory)'],
    ['returned judge result', 'return await judgeWork(card, judge, ask, scope);', 'await judgeWork(card, judge, ask, scope)'],
  ];
  for (const [path, anchor, selected] of selectedValues) for (const [form, value] of [
    ['selector spread', `({ ...${selected} })`],
    ['selector fallback', `(${selected} ?? ${fallback})`],
    ['selector call', `((value) => value)(${selected})`],
    ['selector member', `({ selected: ${selected} }).selected`],
  ]) refuses(anchor, anchor.replace(selected, value), `${path} / ${form}`);
  const transfers = [
    ['judge map source', 'answer.judges.map((judge) => judged(card, judge, ask, scope))', `[{ role: 'reviewer', steps: [{ run: ${replacement} }] }].map((judge) => judged(card, judge, ask, scope))`],
    ['claim map source', 'claimed.map((claim) =>', `[{ ...claimed[0], next: { action: 'dispatch', step: { run: ${replacement} } } }].map((claim) =>`],
    ['claim result', 'return await claim(limit, setAsides, read, failures, notices, memory);', `return ((answer) => ({ ...answer, claims: answer.claims.map((claim) => ({ ...claim, next: { action: 'dispatch', step: { run: ${replacement} } } })) }))(await claim(limit, setAsides, read, failures, notices, memory));`],
    ['judge refreshed answer', 'const answer = ask({ judged: { [role]: [...outcomes] } });', `const answer = { action: 'judge', judges: [{ role, steps: [{ run: ${replacement} }] }] };`],
    ['judge retry payload', 'return { role, retry: { judge: current, failure: outcome } };', `return { role, retry: { judge: { ...current, steps: [{ run: ${replacement} }] }, failure: outcome } };`],
    ['judge result return', 'return await judgeWork(card, judge, ask, scope);', `return { ...await judgeWork(card, judge, ask, scope), retry: { judge: { role: judge.role, steps: [{ run: ${replacement} }] }, failure: {} } };`],
    ['selected answer binding', 'current = named(answer, role);', `((answer) => { current = named(answer, role); })({ action: 'judge', judges: [{ role, steps: [{ run: ${replacement} }] }] });`],
    ['forwarded reader binding', 'judgeWork(card, judge, ask, scope)', `(() => { const substitute = () => ({ action: 'judge', judges: [{ role: judge.role, steps: [{ run: ${replacement} }] }] }); const ask = substitute; return judgeWork(card, judge, ask, scope); })()`],
    ['L2 reader capture', 'const askAttempt = (outcomes, options) =>', `const substitute = () => ({ action: 'dispatch', step: { run: ${replacement} } }); const decide = substitute;\n    const askAttempt = (outcomes, options) =>`],
    ['work reader capture', 'judges(card, next, (options) => answerFrom(atPull, card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember, placed, scope)', `((atPull) => judges(card, next, (options) => answerFrom(atPull, card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember, placed, scope))(() => ({ action: 'judge', judges: [{ role: 'reviewer', steps: [{ run: ${replacement} }] }] }))`],
    ['returned retry binding', 'return { role, retry: { judge: current, failure: outcome } };', `{ function substitute(value) { return { ...value, retry: { judge: { ...current, steps: [{ run: ${replacement} }] }, failure: outcome } }; } return substitute({ role, retry: { judge: current, failure: outcome } }); }`],
    ['claim reader binding', 'const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);', `const substitute = async () => ({ claims: [], failures: [], notices: [] }); const take = substitute;\n    const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, setAsides, poll, memory);`],
    ['retry iterator source', 'for (const [at, each] of settled.entries()) {', `for (const [at, each] of [[0, { status: 'fulfilled', value: { retry: { judge: { ...answer.judges[0], steps: [{ run: ${replacement} }] }, failure: {} } } }]]) {`],
    ['retry iterator binding', 'for (const [at, each] of settled.entries()) {', `for (const [at, each] of settled.entries()) { const each = { status: 'fulfilled', value: { retry: { judge: { ...answer.judges[0], steps: [{ run: ${replacement} }] }, failure: {} } } };`],
  ];
  for (const [path, anchor, rewritten] of transfers) refuses(anchor, rewritten, `${path} / changed transfer`);
  const factory = report.modules.get(file).program.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'claiming');
  const factoryReturns = factory.body.body.filter((node) => node.type === 'ReturnStatement');
  assert.equal(factoryReturns.length, 1, 'claim factory fixture has one direct return');
  const factorySource = report.modules.get(file).source;
  const returned = factoryReturns[0];
  const returnedValue = factorySource.slice(returned.argument.start, returned.argument.end);
  refuses(factorySource.slice(returned.start, returned.end), `function substitute(value) { return { ...value, take: async (...args) => { const result = await value.take(...args); return { ...result, claims: result.claims.map((claim) => ({ ...claim, next: { ...claim.next, step: { run: ${replacement} } } })) }; } }; }\n  return substitute(${returnedValue});`, 'claim factory / replaced return');
  const stepImport = "import { stepDispatch } from '../execution/step.mjs';";
  for (const [name, shadow] of [
    ['Map', `const Map = class extends globalThis.Map { get(key) { const value = super.get(key); return value?.action === undefined ? value : { ...value, step: { run: ${replacement} } }; } };`],
    ['Promise', `const Promise = class extends globalThis.Promise { static async allSettled(values) { const result = await super.allSettled(values); return result.map((entry) => entry.value?.role === undefined ? entry : { status: 'fulfilled', value: { role: entry.value.role, retry: { judge: { role: entry.value.role, steps: [{ run: ${replacement} }] }, failure: {} } } }); } };`],
  ]) refuses(stepImport, `${stepImport}\n${shadow}`, `transfer producer / shadowed ${name}`);
  const local = changedPackage(report, file, stepImport, `${stepImport}\nfunction unrelatedLocalMap() { const Map = 3; return Map; }`, 'unrelated local global-name control');
  assert.deepEqual(programReport(local.modules), [], 'a local global-name binding outside a reviewed transfer remains admitted');
  assert.deepEqual(missed, [], 'N8: every configured-step matrix cell must refuse substitution before forwarding');
});
