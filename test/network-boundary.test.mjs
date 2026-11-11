// ABOUTME: Refuses unreviewed protected-name mentions and network routes in the production import closure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { parse, tokenizer } from 'acorn';

// proves R-SAFE-2
test('P1 to P9: unreviewed mentions are refused in every static name form on their cooked value', () => {
  const classes = [
    ['P1', ['runCommand']],
    ['P2', ['child_process', 'node:child_process', 'childProcess', 'spawn', 'spawnSync', 'execFile']],
    ['P3', ['env', 'environment', 'gitEnvironment']],
    ['P4', ['env']], // process.env is gated by the env member, as Table P specifies.
    ['P5', ['URL', '__proto__']],
    ['P6', ['stepAnswer', 'stepDispatch', 'dispatchStep', 'provisioning', 'step', 'run', 'command']],
    ['P7', ['protectedWrapper']],
    ['P8', ['process']],
    ['P9', ['ps', 'lsof', 'PS', 'LSOF', 'tool', 'PS_ENV', 'shell']],
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
    let source = make(name);
    let report;
    if (group === 'P7') {
      const seed = ['const runCommand = () => 0;', 'export function protectedWrapper() { return runCommand({}); }'];
      const sites = seed.map((text, index) => ({ file: 'seed.mjs', text, mentions: index + 1, line: index + 1, reason: 'The fixture starter and its reviewed wrapper declaration.' }));
      if (form === 'binding identifier' || form === 'escaped identifier') {
        const binding = form === 'escaped identifier' ? '\\u0070rotectedWrapper' : name;
        source = `function ${binding}() {\n  native.spawn();\n}\nconst native = {};`;
        sites.push({ file: 'fixture.mjs', text: '  native.spawn();', mentions: 1, line: 2, reason: 'The reviewed native call makes its enclosing declaration a wrapper.' });
      }
      if (form === 'reference identifier') source = `${name};`;
      if (form === 'import binding') source = "import { protectedWrapper } from './seed.mjs';";
      const tree = new Map([['entry.mjs', "import './seed.mjs'; import './fixture.mjs';"], ['seed.mjs', seed.join('\n')], ['fixture.mjs', source]]);
      report = networkReport((file) => tree.get(file), ['entry.mjs'], sites);
    } else report = networkReport(() => source, ['fixture.mjs'], []);
    if (!report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes(JSON.stringify(name)))) missed.push(`${group} / ${name} / ${form}`);
  }
  assert.deepEqual(missed, [], 'Every unreviewed protected mention must name its file, line and cooked name');
  assert.deepEqual(networkReport(() => '// env runCommand URL\n"prefix env suffix"; `environment suffix`;', ['fixture.mjs'], []).violations, [], 'Comments and literals with a different cooked value are not mentions');
});

// proves R-SAFE-2
test('P7: reviewed wrapper calls reach a fixed point and retain static import identity', () => {
  const file = 'wrappers.mjs';
  const lines = [
    'const runCommand = () => 0;',
    'export function leaf() { return runCommand({}); }',
    'export function middle() { return leaf(); }',
    'export function outer() { return middle(); }',
  ];
  const sites = lines.map((text, index) => ({ file, text, mentions: index === 0 ? 1 : 2, line: index + 1, reason: 'A reviewed fixture starter or fixed-point wrapper.' }));
  const imported = "import { outer as start } from './wrappers.mjs';";
  const tree = new Map([[file, lines.join('\n')], ['entry.mjs', `${imported}\nstart();`]]);
  const reviewed = [...sites, { file: 'entry.mjs', text: imported, mentions: 2, line: 1, reason: 'The reviewed import retains the outer wrapper identity.' }];
  const report = networkReport((name) => tree.get(name), ['entry.mjs'], reviewed);
  assert.ok(report.violations.some((line) => line.startsWith('entry.mjs:2 P ') && line.includes('"start"')), 'The third-hop wrapper remains protected through its imported local name');
  tree.set('entry.mjs', imported);
  assert.deepEqual(networkReport((name) => tree.get(name), ['entry.mjs'], reviewed).violations, [], 'Every reviewed hop is admitted after the fixed point');
  for (const shadow of [
    'function local(outer) { return outer(); }',
    '{ const outer = () => 0; outer(); }',
    'try { throw 0; } catch (outer) { outer(); }',
    'const local = function outer() { return outer; };',
  ]) {
    tree.set(file, `${lines.join('\n')}\n${shadow}`);
    assert.deepEqual(networkReport((name) => tree.get(name), [file], sites).violations, [], `Only identifiers of a different declaration are exempt: ${shadow}`);
  }
  for (const mention of [
    'const holder = { outer: 0 };',
    'const holder = {}; holder.outer;',
    'const holder = {}; holder["outer"];',
    'const { outer: local } = {};',
    'const local = 0; export { local as outerName }; "outer";',
    'function local(value = outer) { var outer; return value; }',
    'switch (outer()) { case 0: let outer; }',
  ]) {
    tree.set(file, `${lines.join('\n')}\n${mention}`);
    assert.ok(networkReport((name) => tree.get(name), [file], sites).violations.some((line) => line.startsWith(`${file}:5 P `) && line.includes('"outer"')), `A key, literal or original declaration reference is protected: ${mention}`);
  }
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
  const text = 'export const checked = () => 1;';
  const pin = { file: 'fixture.mjs', name: 'checked', kind: 'statement', text, start: 0, ordinal: 0, line: 1, reason: 'One reviewed fixture producer.' };
  const duplicate = networkReport(() => `${text}\n${text}`, ['fixture.mjs'], [], [pin]);
  assert.ok(duplicate.violations.some((line) => line.startsWith('fixture.mjs:2 P pin ') && line.includes('checked')), 'The duplicate top-level pin is refused even when duplicate exports cannot parse');
  const comment = `/* ${text} */\n${text}`;
  assert.deepEqual(networkReport(() => comment, ['fixture.mjs'], [], [pin]).violations, [], 'An exact copy inside a leading comment is outside the parser statement range');
  const filePin = { file: 'fixture.sh', name: 'fixture script', kind: 'file', text: '#!/bin/sh\nexit 0\n', line: 1, reason: 'One complete local program.' };
  const files = new Map([['fixture.mjs', '0;'], ['fixture.sh', filePin.text.repeat(2)]]);
  const doubledFile = networkReport((file) => files.get(file), ['fixture.mjs'], [], [filePin]);
  assert.ok(doubledFile.violations.some((line) => line.startsWith('fixture.sh:3 P pin ') && line.includes(filePin.name)), 'A whole-file pin cannot be duplicated');

});

// proves R-SAFE-2
test('P changed lines: changing one character of a reviewed source line is refused', () => {
  const site = { file: 'fixture.mjs', text: 'const env = 0;', mentions: 1, line: 1, reason: 'The fixture environment declaration.' };
  const report = networkReport(() => 'const env = 1;', ['fixture.mjs'], [site]);
  assert.ok(report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes('"env"')), 'One changed character invalidates the exact reviewed line');
  const text = 'export const checked = () => {\n  // inside\n  return 1;\n};';
  const pin = { file: 'fixture.mjs', name: 'checked', kind: 'statement', text, start: 0, ordinal: 0, line: 1, reason: 'The complete fixture producer.' };
  const first = text.indexOf('1');
  for (const index of [first, ...Array.from({ length: text.length }, (_, index) => index).filter((index) => index !== first)]) {
    const changed = text.slice(0, index) + (text[index] === 'x' ? 'y' : 'x') + text.slice(index + 1);
    const line = text.slice(0, index).split('\n').length;
    const result = networkReport(() => changed, ['fixture.mjs'], [], [pin]);
    assert.ok(result.violations.some((message) => message.startsWith(`fixture.mjs:${line} P pin `) && message.includes('checked')), `Every character in the parser range is pinned, including comments: ${index}`);
  }
  const script = '#!/bin/sh\nexit 0\n';
  const filePin = { file: 'fixture.sh', name: 'fixture script', kind: 'file', text: script, line: 1, reason: 'The complete fixture program.' };
  for (let index = 0; index < script.length; index += 1) {
    const changed = script.slice(0, index) + (script[index] === 'x' ? 'y' : 'x') + script.slice(index + 1);
    const line = script.slice(0, index).split('\n').length;
    const result = networkReport((file) => file === 'fixture.sh' ? changed : '0;', ['fixture.mjs'], [], [filePin]);
    assert.ok(result.violations.some((message) => message.startsWith(`fixture.sh:${line} P pin `) && message.includes(filePin.name)), `Every script byte is pinned: ${index}`);
  }

  const original = packageReport();
  for (const actualPin of WHOLE_TEXT_PINS) {
    const source = original.pinnedFiles.get(actualPin.file);
    if (actualPin.kind === 'statement') {
      const statement = original.modules.get(actualPin.file).program.body[actualPin.ordinal];
      assert.equal(source.slice(statement.start, statement.end), actualPin.text, 'A real pin is exactly its parser statement range, including export and excluding the leading comment');
    }
    for (const index of new Set([0, actualPin.text.indexOf('//'), Math.floor(actualPin.text.length / 2), actualPin.text.length - 1].filter((index) => index >= 0))) {
      const start = actualPin.kind === 'file' ? 0 : actualPin.start;
      const absolute = start + index;
      const changed = source.slice(0, absolute) + (source[absolute] === 'x' ? 'y' : 'x') + source.slice(absolute + 1);
      const read = (file) => file === actualPin.file ? changed : original.pinnedFiles.get(file) ?? original.modules.get(file)?.source;
      const result = networkReport(read, ENTRY_POINTS, REVIEWED_SITES, WHOLE_TEXT_PINS);
      const line = source.slice(0, absolute).split('\n').length;
      assert.ok(result.violations.some((message) => message.startsWith(`${actualPin.file}:${line} P pin `) && message.includes(actualPin.name)), `The real ${actualPin.name} pin refuses a changed character at ${line}`);
    }
  }

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
  ['ps', 'P9: the process-table program passed to local readers.'],
  ['lsof', 'P9: the program used to census working directories.'],
  ['PS', 'P9: the exported default process-table program.'],
  ['LSOF', 'P9: the exported default cwd census program.'],
  ['tool', 'P9: a reader-selected program or a tool permission name.'],
  ['PS_ENV', 'P9: the fixed environment of local process-table reads.'],
  ['shell', 'P9: the native option that can turn arguments into shell input.'],
]);

/** Identifier and literal spellings are compared on their decoded value. */
const mentionedName = (node) => ['Identifier', 'PrivateIdentifier'].includes(node.type) ? node.name
  : node.type === 'Literal' && typeof node.value === 'string' ? node.value
    : node.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;

/** Count source occurrences once, including shorthand nodes Acorn exposes in two roles. */
function protectedMentions(program, wrappers, file) {
  const found = new Map();
  const { lookup, bindings } = lexical(program);
  for (const { node, parent } of nodes(program)) {
    const name = mentionedName(node);
    const identifier = node.type === 'Identifier' && (bindings.has(node) || referenceIdentifier(node, parent, bindings))
      && !(parent?.type === 'Property' && parent.key === node) && !(parent?.type === 'ImportSpecifier' && parent.imported === node);
    const declaration = identifier && lookup(node);
    const imported = identifier && wrappers?.targets(declaration).some((target) => wrappers.functions.has(target));
    const wrapper = imported || (wrappers?.names.has(name) && (!identifier || !declaration));
    if (PROTECTED_NAMES.has(name) || wrapper) found.set(`${node.start}:${node.end}`, { name, line: node.loc.start.line });
  }
  return [...found.values()];
}

/** P8 admits only the process members used for these reviewed local operations. */
const PROCESS_MEMBERS = new Map([
  ['argv', 'Reads CLI arguments.'],
  ['cpuUsage', 'Records local CPU usage in reader diagnostics.'],
  ['cwd', 'Reads the local current working directory.'],
  ['env', 'Reads the account environment; P3/P4 also pin each env mention.'],
  ['exit', 'Ends the CLI with its result status.'],
  ['exitCode', 'Sets the gate CLI result status.'],
  ['getuid', 'Reads the account uid for local census and launchd queries.'],
  ['kill', 'Signals a local recorded process or group.'],
  ['listenerCount', 'Checks whether an intercepted signal has another listener.'],
  ['listeners', 'Reads local process signal listeners.'],
  ['on', 'Registers local exit and listener-change handlers.'],
  ['pid', 'Reads the local engine process identity.'],
  ['platform', 'Selects the local OS process and filesystem adapters.'],
  ['prependListener', 'Installs the local exit-cleanup signal handler first.'],
  ['removeListener', 'Removes a local signal handler.'],
  ['stderr', 'Writes local diagnostics and observes the error stream.'],
  ['stdin', 'Reads local terminal confirmation input.'],
  ['stdout', 'Writes local CLI results.'],
  ['versions', 'Checks the running Node version.'],
]);

/** No process object may be captured, destructured, reflected on or indexed dynamically. */
function processReport(file, program) {
  const parents = new WeakMap();
  for (const { node, parent } of nodes(program)) if (parent) parents.set(node, parent);
  const refused = new Map();
  for (const { node, parent } of nodes(program)) {
    if (mentionedName(node) !== 'process') continue;
    let object = node.type === 'Identifier' ? node : undefined;
    if (parent?.type === 'MemberExpression' && parent.property === node && ['globalThis', 'global'].includes(parent.object.name) && memberName(parent) === 'process') object = parent;
    while (object && parents.get(object)?.type === 'ChainExpression') object = parents.get(object);
    const access = object && parents.get(object);
    if (access?.type === 'MemberExpression' && access.object === object && PROCESS_MEMBERS.has(memberName(access))) continue;
    const name = access?.type === 'MemberExpression' && access.object === object ? memberName(access) ?? 'process' : 'process';
    refused.set(`${node.start}:${node.end}`, `${file}:${node.loc.start.line} P refuses process appearance ${JSON.stringify(name)}`);
  }
  return [...refused.values()];
}

// proves R-SAFE-2
test('P8: only listed literal process members may receive the engine object', () => {
  for (const object of ['process', 'globalThis.process', 'global.process']) {
    for (const access of ['.cwd()', '["cwd"]()', '[`\\x63wd`]()', '?.cwd()']) {
      const source = `${object}${access};`;
      assert.deepEqual(networkReport(() => source, ['fixture.mjs']).violations, [], `P8 admits this literal local operation: ${source}`);
    }
  }
  const forbidden = [
    ['const saved = process;', 'process'],
    ['const { execve: start } = process;', 'process'],
    ['const saved = { ...process };', 'process'],
    ['function local(value = process) {}', 'process'],
    ['Reflect.get(process, "cwd");', 'process'],
    ['const key = "cwd"; process[key];', 'process'],
    ['const saved = globalThis.process;', 'process'],
    ['global.process;', 'process'],
    ['const saved = global["process"];', 'process'],
    ['Reflect.get(globalThis.process, "cwd");', 'process'],
  ];
  for (const object of ['process', 'globalThis.process', 'global["process"]']) {
    for (const member of ['execve', 'loadEnvFile', 'getBuiltinModule', 'unreviewedMember']) {
      for (const access of [`.${member}`, `[${JSON.stringify(member)}]`, `[\`${member}\`]`]) forbidden.push([`${object}${access};`, member]);
    }
  }
  for (const [source, name] of forbidden) {
    const report = networkReport(() => source, ['fixture.mjs']);
    assert.ok(report.violations.some((line) => line.startsWith('fixture.mjs:1 P ') && line.includes(JSON.stringify(name))), `P8 refuses ${name}: ${source}`);
  }
  for (const source of ['globalThis["process"].cwd();', 'global[`process`].cwd();']) {
    assert.ok(networkReport(() => source, ['fixture.mjs']).violations.some((line) => line.startsWith('fixture.mjs:1 N4 ')), 'N4 still refuses computed access on the global object itself');
  }
});

/** Every protected mention is refused until its exact source line is reviewed. */
function mentionReport(modules, sites, wrappers) {
  const violations = [];
  const used = new Set();
  for (const [file, { program, source }] of modules) {
    const lines = source.split(/\r\n|[\r\n\u2028\u2029]/);
    const mentions = new Map();
    for (const { name, line } of protectedMentions(program, wrappers, file)) {
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

/** P7 follows declaration and import bindings, never assigned values or returned carriers. */
function wrapperModel(modules, sites) {
  const declarations = new WeakMap();
  const models = new Map();
  const calls = [];
  const reviewed = new Set(sites.map(({ file, text }) => JSON.stringify([file, text])));
  const identifierName = (node) => node?.name ?? node?.value;
  for (const [file, { program, source }] of modules) {
    const scope = lexical(program);
    const parents = new WeakMap();
    const functions = new WeakMap();
    const model = { scope, imports: new Map(), exports: new Map(), stars: [] };
    models.set(file, model);
    for (const { node, parent } of nodes(program)) {
      if (parent) parents.set(node, parent);
      if (!['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) continue;
      const names = new Set();
      const ids = [node.id, parent?.type === 'VariableDeclarator' ? parent.id : undefined].filter((id) => id?.type === 'Identifier');
      for (const id of ids) names.add(id.name);
      if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && memberName(parent) !== undefined) names.add(memberName(parent));
      if (parent?.type === 'ExportDefaultDeclaration') names.add('default');
      const record = { file, node, names: [...names], line: node.loc.start.line };
      functions.set(node, record);
      for (const id of ids) declarations.set(id, record);
    }
    for (const statement of program.body) {
      if (statement.type === 'ImportDeclaration') {
        const target = posix.normalize(posix.join(posix.dirname(file), statement.source.value));
        for (const specifier of statement.specifiers) model.imports.set(scope.lookup(specifier.local), { file: target, name: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.type === 'ImportNamespaceSpecifier' ? '*' : identifierName(specifier.imported) });
      }
      if (statement.type === 'ExportNamedDeclaration') {
        if (statement.declaration) for (const { node } of nodes(statement.declaration)) {
          if (node.type === 'Identifier' && scope.bindings.has(node) && scope.lookup(node) === scope.root.names.get(node.name)) model.exports.set(node.name, { binding: scope.lookup(node) });
        }
        for (const specifier of statement.specifiers) model.exports.set(identifierName(specifier.exported), statement.source
          ? { file: posix.normalize(posix.join(posix.dirname(file), statement.source.value)), name: identifierName(specifier.local) }
          : { binding: scope.lookup(specifier.local) });
      }
      if (statement.type === 'ExportDefaultDeclaration') model.exports.set('default', functions.has(statement.declaration) ? { function: functions.get(statement.declaration) } : { binding: scope.lookup(statement.declaration) });
      if (statement.type === 'ExportAllDeclaration' && !statement.exported) model.stars.push(posix.normalize(posix.join(posix.dirname(file), statement.source.value)));
    }
    const lines = source.split('\n');
    for (const { node } of nodes(program)) {
      if (!['CallExpression', 'NewExpression'].includes(node.type) || !reviewed.has(JSON.stringify([file, lines[node.loc.start.line - 1]]))) continue;
      const enclosing = [];
      for (let ancestor = parents.get(node); ancestor; ancestor = parents.get(ancestor)) if (functions.has(ancestor)) enclosing.push(functions.get(ancestor));
      calls.push({ file, node, enclosing });
    }
  }
  const functions = new Set();
  const names = new Set();
  const importedBindings = new Map([...models.values()].flatMap((model) => [...model.imports]));
  const exported = (file, name, seen) => {
    const key = JSON.stringify([file, name]);
    if (seen.has(key)) return [];
    seen = new Set([...seen, key]);
    const model = models.get(file);
    const entry = model?.exports.get(name);
    if (entry?.function) return [entry.function];
    if (entry?.binding) return resolve(entry.binding, seen);
    if (entry?.file) return exported(entry.file, entry.name, seen);
    return name === 'default' ? [] : (model?.stars ?? []).flatMap((target) => exported(target, name, seen));
  };
  const resolve = (binding, seen) => {
    if (!binding || seen.has(binding)) return [];
    seen = new Set([...seen, binding]);
    const local = [...binding.declarations].map((id) => declarations.get(id)).filter(Boolean);
    const imported = importedBindings.get(binding);
    return [...local, ...(imported && imported.name !== '*' ? exported(imported.file, imported.name, seen) : [])];
  };
  const cache = new Map();
  const targets = (binding) => {
    if (!cache.has(binding)) cache.set(binding, resolve(binding, new Set()));
    return cache.get(binding);
  };
  const starters = new Set(['runCommand', 'spawn', 'spawnSync', 'execFile']);
  const starts = (file, expression) => {
    if (expression?.type === 'ChainExpression') return starts(file, expression.expression);
    if (expression?.type === 'Identifier') {
      const binding = models.get(file).scope.lookup(expression);
      return starters.has(expression.name) || targets(binding).some((target) => functions.has(target)) || (!binding && names.has(expression.name));
    }
    if (expression?.type === 'MemberExpression') {
      const name = memberName(expression);
      return starters.has(name) || names.has(name) || (['call', 'apply'].includes(name) && starts(file, expression.object));
    }
    return expression?.type === 'CallExpression' && expression.callee.type === 'MemberExpression' && memberName(expression.callee) === 'bind' && starts(file, expression.callee.object);
  };
  let changed;
  do {
    changed = false;
    for (const { file, node, enclosing } of calls) if (starts(file, node.callee)) for (const record of enclosing) {
      if (!functions.has(record)) {
        functions.add(record);
        record.reason = `P7: contains a reviewed call to a starter or wrapper name at ${file}:${node.loc.start.line}.`;
        changed = true;
      }
    }
    for (const record of functions) for (const name of record.names) if (!names.has(name)) { names.add(name); changed = true; }
    for (const [file, model] of models) for (const name of model.exports.keys()) {
      if (!names.has(name) && exported(file, name, new Set()).some((record) => functions.has(record))) { names.add(name); changed = true; }
    }
  } while (changed);
  const list = [...functions].filter((record) => record.names.length).map(({ file, names, line, reason }) => ({ file, names, line, reason })).sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { functions, names, targets, starts, list };
}

/** Pins compare parser statement ranges; token starts exclude copies in comments or strings. */
function pinReport(read, modules, pins) {
  const violations = [];
  const files = new Map();
  const lineAt = (source, index) => source.slice(0, index).split(/\r\n|[\r\n\u2028\u2029]/).length;
  for (const pin of pins) {
    const source = modules.get(pin.file)?.source ?? read(pin.file);
    files.set(pin.file, source);
    let starts;
    let statement;
    if (pin.kind === 'file') {
      starts = [];
      for (let index = source.indexOf(pin.text); index !== -1; index = source.indexOf(pin.text, index + pin.text.length)) starts.push(index);
    } else {
      starts = [];
      try {
        for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })) {
          if (source.startsWith(pin.text, token.start)) starts.push(token.start);
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const body = modules.get(pin.file)?.program.body ?? [];
      statement = body.find((entry) => {
        const declaration = entry.declaration ?? entry;
        return declaration.id?.name === pin.name || declaration.declarations?.some(({ id }) => id.name === pin.name);
      });
      // Ordinal and original offset locate a missing/invalid pin's diagnostic, never admit it.
      statement ??= body[pin.ordinal];
    }
    if (starts.length > 1) {
      violations.push(`${pin.file}:${lineAt(source, starts[1])} P pin refuses duplicate ${JSON.stringify(pin.name)}`);
      continue;
    }
    const start = pin.kind === 'file' ? 0 : statement?.start ?? pin.start;
    const actual = pin.kind === 'file' ? source : statement ? source.slice(statement.start, statement.end) : source.slice(start, start + pin.text.length);
    if (starts.length !== 1 || actual !== pin.text) {
      let changed = 0;
      while (changed < pin.text.length && pin.text[changed] === actual[changed]) changed += 1;
      violations.push(`${pin.file}:${lineAt(source, start + changed)} P pin refuses changed ${JSON.stringify(pin.name)}`);
    }
  }
  return { violations, files };
}

/** Follow imports from roots; never execute the modules being checked. */
const parsedModules = new Map();
function networkReport(read, roots, sites = [], pins = []) {
  const modules = new Map();
  const violations = [];
  const dynamic = [];
  const admitted = new Set();
  const visit = (file) => {
    if (modules.has(file)) return;
    const source = read(file);
    if (parsedModules.get(file)?.source !== source) {
      try {
        parsedModules.set(file, { source, program: parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true }) });
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        parsedModules.set(file, { source, program: { type: 'Program', body: [] }, error });
      }
    }
    const { program, error } = parsedModules.get(file);
    if (error) violations.push(`${file}:${error.loc.line} syntax refuses ${error.message}`);
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
    violations.push(...processReport(file, program));
  };
  for (const root of roots) visit(root);
  const wrappers = wrapperModel(modules, sites);
  violations.push(...mentionReport(modules, sites, wrappers));
  const pinned = pinReport(read, modules, pins);
  violations.push(...pinned.violations);
  return { violations, modules, dynamic, wrappers, pinnedFiles: pinned.files };
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
    'globalThis.Array; global.process.cwd();',
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
  }, ENTRY_POINTS, REVIEWED_SITES, WHOLE_TEXT_PINS);
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
  const root = { parent: null, kind: 'module', names: new Map() };
  const inner = (parent, kind = 'block') => ({ parent, kind, names: new Map() });
  const bind = (pattern, scope) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      if (!scope.names.has(pattern.name)) scope.names.set(pattern.name, { name: pattern.name, declarations: new Set() });
      scope.names.get(pattern.name).declarations.add(pattern);
      bindings.add(pattern);
      scopes.set(pattern, scope);
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
      const named = node.type === 'FunctionExpression' && node.id ? inner(scope, 'function-name') : scope;
      if (named !== scope) bind(node.id, named);
      const parameters = inner(named, 'parameters');
      if (node.type !== 'ArrowFunctionExpression') parameters.names.set('arguments', { name: 'arguments', declarations: new Set() });
      for (const parameter of node.params) bind(parameter, parameters);
      for (const parameter of node.params) collect(parameter, parameters);
      const body = inner(parameters, 'function');
      const expressions = node.params.some((parameter) => [...nodes(parameter)].some(({ node }) => node.type === 'AssignmentPattern' || (node.type === 'Property' && node.computed)));
      if (!expressions) body.names = parameters.names;
      if (node.body.type === 'BlockStatement') {
        scopes.set(node.body, body);
        for (const statement of node.body.body) collect(statement, body);
      } else collect(node.body, body);
      return;
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
      if (node.type === 'ClassDeclaration') bind(node.id, scope);
      const body = inner(scope);
      bind(node.id, body);
      children(node, body);
      return;
    }
    if (node.type === 'SwitchStatement') {
      collect(node.discriminant, scope);
      const cases = inner(scope);
      for (const clause of node.cases) collect(clause, cases);
      return;
    }
    if (['BlockStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'CatchClause', 'StaticBlock'].includes(node.type)) {
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
  assert.deepEqual(report.violations, [], 'N1 to N6 and Table P: every real module must satisfy the positive boundary');
  for (const root of ENTRY_POINTS) assert.ok(report.modules.has(root), `N2: follows ${root}`);
  assert.deepEqual(report.dynamic.map(({ file, owner, argument }) => ({ file, owner, argument })), DYNAMIC_IMPORTS.map(({ file, owner, argument }) => ({ file, owner, argument: expressionShape(argument) })), 'N3: the exception list is exactly the nonliteral sites');
  for (const [name, reason] of [...BUILTINS, ...GLOBALS, ...PROTECTED_NAMES, ...PROCESS_MEMBERS, ...WHOLE_TEXT_PINS.map(({ name, reason }) => [name, reason]), ...report.wrappers.list.map(({ names, reason }) => [names.join(', '), reason]), ...DYNAMIC_IMPORTS.map(({ file, reason }) => [file, reason])]) {
    assert.ok(typeof reason === 'string' && reason.trim() && !reason.includes('\n'), `N1/N3/N4/Table P: ${name} has a one-line reason`);
  }
  for (const site of REVIEWED_SITES) {
    assert.ok(Number.isInteger(site.mentions) && site.mentions > 0, `The reviewed count is positive for ${site.file}:${site.line}`);
    assert.ok(site.reason.trim() && !/[\r\n]/.test(site.reason), `Each reviewed site has its own one-line reason: ${site.file}:${site.line}`);
  }
});

/** Read only package modules reached from the two production entry points. */
const packageReport = () => networkReport((file) => readFileSync(join(PACKAGE_ROOT, file), 'utf8'), ENTRY_POINTS, REVIEWED_SITES, WHOLE_TEXT_PINS);

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
    if (!['CallExpression', 'NewExpression'].includes(node.type)) continue;
    if (report.wrappers.starts(file, node.callee)) starts.add(JSON.stringify([file, source.split('\n')[node.loc.start.line - 1]]));
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
  { file: 'scripts/gate-check.mjs', text: '  const { kind, answer } = kindOf(held, config.kinds, config.epicLabel);', mentions: 1, reason: 'Inspect kind selection\'s answer before checking the pull request\'s gate.', line: 175 },
  { file: 'scripts/gate-check.mjs', text: '  const round = { card: cardNumber, pull: number, head: pull.head, digest: acceptanceDigest(issue.body), count: items.length };', mentions: 1, reason: 'Check markers against the exact card, pull request, head and acceptance digest.', line: 195 },
  { file: 'scripts/gate-check.mjs', text: '  const ruled = gateAnswer({ comments, ...round, judges, checks: {} });', mentions: 1, reason: 'Check the recorded marker panel for all required judge roles.', line: 197 },
  { file: 'scripts/gate-check.mjs', text: 'async function main(argv, env) {', mentions: 1, reason: 'Receive CLI arguments and environment for the gate\'s selected mode.', line: 216 },
  { file: 'scripts/gate-check.mjs', text: '  if (!/^[^/\\s]+\\/[^/\\s]+$/.test(env.GITHUB_REPOSITORY ?? \'\')) {', mentions: 1, reason: 'Validate the event repository before building its forge reader.', line: 224 },
  { file: 'scripts/gate-check.mjs', text: '    log(`gate-check: GITHUB_REPOSITORY is ${JSON.stringify(env.GITHUB_REPOSITORY)}, which names no repository as owner/name`);', mentions: 1, reason: 'Report a malformed event repository without starting a reader.', line: 225 },
  { file: 'scripts/gate-check.mjs', text: '    const reads = repositoryReads({ repo: env.GITHUB_REPOSITORY, project: \'none\' }, { emitter: sink.emitter({ layer: \'L0\' }) });', mentions: 1, reason: 'Build the forge reader for the validated event repository.', line: 235 },
  { file: 'scripts/gate-check.mjs', text: '      return await MODES[mode]({ env, reads, number, out, log });', mentions: 1, reason: 'Forward the received environment to the selected gate mode.', line: 237 },
  { file: 'scripts/gate-check.mjs', text: 'if (ranDirectly) process.exitCode = await main(process.argv.slice(2), process.env);', mentions: 1, reason: 'Give a direct gate invocation the account environment and its returned exit status.', line: 249 },
  { file: 'src/cli/doctor.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the repository-safe environment copier for doctor probes.', line: 9 },
  { file: 'src/cli/doctor.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'../substrate/process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for doctor tool probes.', line: 12 },
  { file: 'src/cli/doctor.mjs', text: 'export async function asked(command, args, { emitter, timeout }) {', mentions: 2, reason: 'Accept the program and arguments selected by a doctor probe.', line: 35 },
  { file: 'src/cli/doctor.mjs', text: '  const { exit, timedOut, stdout, stderr } = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Run git or an agent authentication probe through L0 with a copied account environment.', line: 36, programs: ['gh', 'git', 'claude', 'codex'] },
  { file: 'src/cli/doctor.mjs', text: '  const step = relative(outer, inner);', mentions: 1, reason: 'Compute a local relative-path segment for directory containment.', line: 103 },
  { file: 'src/cli/doctor.mjs', text: '  return step === \'\' || (step !== \'..\' && !step.startsWith(`..${sep}`) && !isAbsolute(step));', mentions: 4, reason: 'Accept only a relative-path segment inside the containing directory.', line: 104 },
  { file: 'src/cli/doctor.mjs', text: 'export async function gitAnswer(args, { ask = asked, emitter, timeout = CALL_TIMEOUT } = {}) {', mentions: 1, reason: 'Use the reviewed process wrapper as the default git-answer operation.', line: 153 },
  { file: 'src/cli/doctor.mjs', text: '  const rules = Object.values(config.kinds).flatMap((kind) => kind.judges.flatMap((entry) => {', mentions: 1, reason: 'Inspect each configured kind\'s judge entries before checking its role sources.', line: 312 },
  { file: 'src/cli/doctor.mjs', text: 'export async function agentAuth({ ask = asked, adapters, target, emitter, timeout = CALL_TIMEOUT } = {}) {', mentions: 1, reason: 'Use the reviewed process wrapper for agent authentication checks.', line: 336 },
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
  { file: 'src/cli/once.mjs', text: 'import { killRecordedGroups } from \'../execution/run.mjs\';', mentions: 1, reason: 'Import the reviewed previous-dispatch cleanup wrapper.', line: 11 },
  { file: 'src/cli/once.mjs', text: 'import { escalationDirectoryHandle, judgeDirectoryHandle, removeCardDirectories, workspaceHandle } from \'../execution/workspace.mjs\';', mentions: 4, reason: 'Import the reviewed workspace-factory and directory-removal wrappers.', line: 12 },
  { file: 'src/cli/once.mjs', text: 'import { loop } from \'../scheduling/loop.mjs\';', mentions: 1, reason: 'Import the reviewed scheduling-loop factory.', line: 13 },
  { file: 'src/cli/once.mjs', text: 'import { PACKAGE, closerLine, outsideText, consumerConfig, gitAnswer, real, sameTree, settled, unreadableAdmission, within } from \'./doctor.mjs\';', mentions: 1, reason: 'Import CLI context helpers, including the independent path-containment helper.', line: 22 },
  { file: 'src/cli/once.mjs', text: '  if (settle.status === \'fulfilled\' && settle.value?.action === \'escalate\' && settle.value.raiser === \'loop\') return { said: `Rigger escalated it as ${settle.value.category}: ${loopReason(settle.value)}`, review: false };', mentions: 1, reason: 'Render a fulfilled scheduling-loop escalation for the CLI caller.', line: 63 },
  { file: 'src/cli/once.mjs', text: 'function mergeOutcome({ pull, merge }) {', mentions: 1, reason: 'Receive the pull request associated with a merge outcome.', line: 82 },
  { file: 'src/cli/once.mjs', text: 'export const noticeLine = (verb, id, { step, cause, made, unrecorded }) => (made === undefined', mentions: 1, reason: 'Receive the failed notice operation for a CLI diagnostic.', line: 189 },
  { file: 'src/cli/once.mjs', text: '  ? `rigger ${verb}: the notice for hold ${id} failed to ${outsideText(step)}: ${outsideText(cause)}`', mentions: 1, reason: 'Describe a notice operation that failed before making its issue.', line: 190 },
  { file: 'src/cli/once.mjs', text: '  : `rigger ${verb}: the notice for hold ${id} made its step to ${outsideText(step)}${unrecorded === undefined ? \'\' : `, but the sink refused its record, so these events went unrecorded: ${unrecorded.map(({ event }) => outsideText(event)).join(\', \')}`}: ${outsideText(cause)}`);', mentions: 1, reason: 'Describe a partly completed notice and any unrecorded operation.', line: 191 },
  { file: 'src/cli/once.mjs', text: 'export const claimVerb = async (verb, limit, options) => {', mentions: 1, reason: 'Declare the recorded CLI claim-operation wrapper.', line: 193 },
  { file: 'src/cli/once.mjs', text: '  const answer = await recording((opened) => claiming(verb, limit, opened, options, handed), options?.push);', mentions: 1, reason: 'Run the invocation\'s claim work through its recorded wrapper.', line: 196, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/once.mjs', text: 'async function claiming(verb, limit, opened, {', mentions: 1, reason: 'Declare the invocation\'s claim and scheduling-loop wrapper.', line: 205 },
  { file: 'src/cli/once.mjs', text: '    workspace = await workspaceHandle({ root, topic: worktreeTopic(config), repository: named, sink });', mentions: 1, reason: 'Create the reviewed workspace handle for this invocation.', line: 232, programs: ['git'] },
  { file: 'src/cli/once.mjs', text: '  const judgeDirectory = judgeDirectoryHandle({ root, topic: worktreeTopic(config), repository: named, sink });', mentions: 1, reason: 'Create the reviewed judge-directory handle for this invocation.', line: 236, programs: ['git'] },
  { file: 'src/cli/once.mjs', text: '  const escalationDirectory = escalationDirectoryHandle({ root, topic: worktreeTopic(config), repository: named, sink });', mentions: 1, reason: 'Create the reviewed escalation-directory handle for this invocation.', line: 237, programs: ['git'] },
  { file: 'src/cli/once.mjs', text: '  const workspaceTip = workspace.tip;', mentions: 1, reason: 'Take the workspace handle\'s verified tip reader.', line: 238 },
  { file: 'src/cli/once.mjs', text: '  const removeDirectories = (card) => removeCardDirectories({ root, topic: worktreeTopic(config), card, repository: named, sink });', mentions: 2, reason: 'Bind a card number to the reviewed directory-removal wrapper.', line: 239, programs: ['git'] },
  { file: 'src/cli/once.mjs', text: '  const cardReads = (card, dispatch) => repositoryReads(forge, { send, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) });', mentions: 1, reason: 'Scope per-card forge reads to their dispatch identity.', line: 243 },
  { file: 'src/cli/once.mjs', text: '  const decide = (card, outcomes, { attempt, firstFailure, workspace: unmade, maker, forge: settledFacts, judged, directories, continuing } = {}) => {', mentions: 2, reason: 'Receive the attempt ordinal when deciding a card\'s next action.', line: 263 },
  { file: 'src/cli/once.mjs', text: '      roles: config.roles, topic: worktreeTopic(config), provisioning: config.provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace: unmade, maker, forge: settledFacts, judged, directories, continuing,', mentions: 4, reason: 'Give L2 the consumer\'s declared provisioning map with its configured roles.', line: 265 },
  { file: 'src/cli/once.mjs', text: '    for (const judge of next.judges) panel.named.set(judge.role, judge);', mentions: 1, reason: 'Retain each selected judge under its configured role name.', line: 280 },
  { file: 'src/cli/once.mjs', text: '    const absent = (role) => !next.judges.some((judge) => judge.role === role);', mentions: 1, reason: 'Check whether a role is absent from the selected judge panel.', line: 281 },
  { file: 'src/cli/once.mjs', text: '      const how = failed(outcomes.at(-1), config.provisioning[name], { number }, name);', mentions: 1, reason: 'Classify a judge step outcome against that named provisioning step.', line: 284 },
  { file: 'src/cli/once.mjs', text: '  const kill = () => killRecordedGroups({ directory: state, sink, host, readTimeout });', mentions: 2, reason: 'Bind invocation state to the reviewed recorded-group cleanup wrapper.', line: 296, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/cli/once.mjs', text: '        return: `returned acceptance on pull request #${each.pull}`,', mentions: 1, reason: 'Describe returned acceptance on the selected pull request.', line: 316 },
  { file: 'src/cli/once.mjs', text: '        escalate: each.settled?.status === \'fulfilled\' && each.settled.value?.action === \'escalate\' && each.settled.value.raiser === \'loop\'', mentions: 1, reason: 'Recognize a settled scheduling-loop escalation in CLI output.', line: 317 },
  { file: 'src/cli/once.mjs', text: '  const judgesOf = ({ card, judges = [] }) => {', mentions: 1, reason: 'Receive the judge list while building the CLI\'s panel context.', line: 336 },
  { file: 'src/cli/once.mjs', text: '    const owner = config.kinds[panel.kind].judges.includes(OWNER) && panel.named.size > 0;', mentions: 1, reason: 'Check whether the configured panel includes the owner after named judges.', line: 349 },
  { file: 'src/cli/once.mjs', text: '    ...worked.flatMap(({ card, workspace: path, said: what, judgeLines, action, pull, head }) => [', mentions: 1, reason: 'Render completed work with its selected pull-request identity.', line: 358 },
  { file: 'src/cli/once.mjs', text: '      const carried = new Set(reachedCards.flatMap(({ judges = [] }) => judges.flatMap(({ failure: held }) => (held === undefined ? [] : [held]))));', mentions: 1, reason: 'Collect failures carried by the already reached judge roles.', line: 431 },
  { file: 'src/cli/once.mjs', text: '    const drained = push === undefined ? undefined : (handOver) => push({ sink, run: opened.run, config, repository: named, directory: state, handOver });', mentions: 2, reason: 'Associate the return-time telemetry push with the current engine run.', line: 472 },
  { file: 'src/cli/once.mjs', text: '    const l3 = loop({ config, board, decide, facts, l2, sink, kill, workspace, workspaceTip, judgeDirectory, escalationDirectory, removeDirectories, state, readRecord, environment: process.env, run: opened.run, clock, drained });', mentions: 7, reason: 'Hand L3 the engine account environment and current run identifier.', line: 473, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/once.mjs', text: '    return verb === \'run\' ? l3.run({ handOver, stop }) : l3.pull(limit);', mentions: 3, reason: 'Select the continuous run verb or the bounded pull path.', line: 474, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/once.mjs', text: 'export const once = (options) => claimVerb(\'once\', 1, options);', mentions: 3, reason: 'Perform a single CLI claim through the reviewed claim wrapper.', line: 488, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/pause.mjs', text: '  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: opened.sink, ...(fs && { fs }) });', mentions: 2, reason: 'Associate an admission close with the current recorded run.', line: 35 },
  { file: 'src/cli/plan.mjs', text: 'const pullLine = ({ card, kind, redo, judges, action, to, pull, head, category, reason, following }) => {', mentions: 2, reason: 'Receive the selected judge panel while rendering a planned action.', line: 17 },
  { file: 'src/cli/plan.mjs', text: '  if (action === \'remove\') return `${prefix}remove directories, then ${pullLine({ card, redo, ...following }).slice(prefix.length)}`;', mentions: 1, reason: 'Describe directory removal before rendering its following planned action.', line: 20 },
  { file: 'src/cli/plan.mjs', text: '    const answer = nextAction(card, config.kinds, config.epicLabel, { roles: config.roles, provisioning: config.provisioning ?? {}, sink: UNRECORDED });', mentions: 2, reason: 'Give plan\'s L2 decision the consumer\'s provisioning map.', line: 78 },
  { file: 'src/cli/recording.mjs', text: '  const run = randomUUID();', mentions: 1, reason: 'Allocate the engine run\'s local recording identifier.', line: 36 },
  { file: 'src/cli/recording.mjs', text: '  const sink = openSink({ run, now: Date.now });', mentions: 1, reason: 'Open the event sink for that run identifier.', line: 37 },
  { file: 'src/cli/recording.mjs', text: '    const answer = await work({ sink, run, name, admitted: (read) => { config = read; } });', mentions: 1, reason: 'Hand the recorded run identifier to the verb\'s work callback.', line: 46 },
  { file: 'src/cli/recording.mjs', text: '    return await push({ sink, run, config, repository, directory: join(repository, STATE), answer });', mentions: 2, reason: 'Associate return-time stream pushing with the completed run.', line: 48 },
  { file: 'src/cli/report.mjs', text: 'function runLines({ run, from, to, releases, pulled, n, throughput, utilization, queue }) {', mentions: 2, reason: 'Receive one run\'s aggregate figures for report formatting.', line: 36 },
  { file: 'src/cli/report.mjs', text: '  const heading = `  run ${outsideText(run)}: from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a span of ${hours(span)}`;', mentions: 1, reason: 'Format the recorded run identifier and its observed interval.', line: 38 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, forge, git }) => [`  run ${outsideText(run)}`, faultLine(\'forge\', forge, \'this run\'), faultLine(\'git\', git, \'this run\')]),', mentions: 2, reason: 'Label per-run forge and git fault summaries.', line: 66 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, durations, survivors }) => [', mentions: 1, reason: 'Iterate recorded runs when formatting dispatch durations and survivors.', line: 76 },
  { file: 'src/cli/report.mjs', text: '      `  run ${outsideText(run)}`,', mentions: 1, reason: 'Label a run\'s dispatch-duration report.', line: 77 },
  { file: 'src/cli/report.mjs', text: '      ...durations.map(({ dispatch, card, ms }) => `    dispatch ${outsideText(dispatch)}${card === undefined ? \'\' : `, card #${outsideText(card)}`}: ${outsideText(ms)} ms`),', mentions: 1, reason: 'Render observed dispatch durations without exposing unescaped identifiers.', line: 78 },
  { file: 'src/cli/report.mjs', text: '    `    dispatch.end events: ${stream.ended}, each listed under its run`,', mentions: 1, reason: 'Describe the recorded dispatch-ending count in report output.', line: 82 },
  { file: 'src/cli/report.mjs', text: '    ...stream.redos.map(({ card, run }) => `    redo after an interruption: card #${outsideText(card)}, run ${outsideText(run)}`),', mentions: 2, reason: 'Attribute an interruption redo to its recorded run.', line: 85 },
  { file: 'src/cli/report.mjs', text: 'const escalationLine = ({ escalated, pulled }, where) => rateLine(\'escalation rate\', \'cards escalated\', \'cards pulled\',', mentions: 1, reason: 'Render the escalation rate from the observed escalated and pulled counts.', line: 90 },
  { file: 'src/cli/report.mjs', text: '  return [...runs.flatMap((each) => counted(`in run ${shown(each.run)}`, each)), ...counted(\'across the stream\', stream)];', mentions: 1, reason: 'Label per-run escalation-cause counts.', line: 123 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, count, entries }) => [', mentions: 1, reason: 'Iterate runs when formatting their admission holds.', line: 138 },
  { file: 'src/cli/report.mjs', text: '      `  admission holds in run ${shown(run)}: ${count}`,', mentions: 1, reason: 'Label a run\'s admission-hold count.', line: 139 },
  { file: 'src/cli/report.mjs', text: '  const by = (dispatches) => dispatches.map(({ dispatch, role }) => `, dispatch ${shown(dispatch)} (role ${shown(role)})`).join(\'\');', mentions: 1, reason: 'Render the dispatch identities and roles associated with each card change.', line: 150 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap(({ run, hostFaults, escalations }) => [', mentions: 1, reason: 'Iterate runs when formatting L2 faults and escalations.', line: 173 },
  { file: 'src/cli/report.mjs', text: '      `  run ${outsideText(run)}`, line(hostFaults, \'this run\'), escalationLine(escalations, \'this run\'), ...escalationLines(escalations.entries),', mentions: 1, reason: 'Label a run\'s L2 fault and escalation summary.', line: 174 },
  { file: 'src/cli/report.mjs', text: '    ...runs.flatMap((each) => [`  run ${outsideText(each.run)}`, `    rework: ${each.rework}`]),', mentions: 1, reason: 'Label a run\'s rework count.', line: 190 },
  { file: 'src/cli/report.mjs', text: '  const markerLines = markers.map(({ card, role, head, dispatch, reason }) =>', mentions: 1, reason: 'Render refused marker evidence with its dispatch identity and reason.', line: 222 },
  { file: 'src/cli/resume.mjs', text: '  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: sink ?? opened.sink, ...(fs && { fs }) });', mentions: 2, reason: 'Associate an admission reopen with the current recorded run.', line: 36 },
  { file: 'src/cli/rigger.mjs', text: 'import { run } from \'./verbs.mjs\';', mentions: 1, reason: 'Import the CLI argument dispatcher at the executable entry point.', line: 5 },
  { file: 'src/cli/rigger.mjs', text: 'const { text, code } = await run(process.argv.slice(2));', mentions: 1, reason: 'Send the executable\'s arguments to the CLI dispatcher.', line: 10 },
  { file: 'src/cli/run.mjs', text: 'import { claimVerb } from \'./once.mjs\';', mentions: 1, reason: 'Import the reviewed CLI claim wrapper for the continuing run verb.', line: 4 },
  { file: 'src/cli/run.mjs', text: 'export const run = (options) => claimVerb(\'run\', undefined, options);', mentions: 3, reason: 'Route the continuous run verb into the shared claiming implementation.', line: 10, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/verbs.mjs', text: 'import { once } from \'./once.mjs\';', mentions: 1, reason: 'Import the reviewed single-card CLI operation.', line: 7 },
  { file: 'src/cli/verbs.mjs', text: 'import { run as runVerb } from \'./run.mjs\';', mentions: 2, reason: 'Import the continuous run verb into the verb registry.', line: 12 },
  { file: 'src/cli/verbs.mjs', text: 'import { verdict } from \'./verdict.mjs\';', mentions: 1, reason: 'Import the reviewed owner-verdict CLI operation.', line: 14 },
  { file: 'src/cli/verbs.mjs', text: '  [\'once\', \'claim one card, provision its workspace and dispatch its maker, then exit\'],', mentions: 1, reason: 'Describe the once verb in the CLI contract\'s verb table.', line: 33 },
  { file: 'src/cli/verbs.mjs', text: '  [\'run\', \'claim cards and dispatch their makers until the board drains, or, while a clock trigger is declared, until stopped\'],', mentions: 1, reason: 'Declare the run verb\'s CLI help description.', line: 34 },
  { file: 'src/cli/verbs.mjs', text: '  [\'verdict\', \'post your verdict on a pull request, once you confirm it\'],', mentions: 1, reason: 'Describe the owner-verdict verb in the CLI contract\'s verb table.', line: 38 },
  { file: 'src/cli/verbs.mjs', text: 'export const LANDED = { init, doctor, \'setup-board\': setupBoard, plan, once, run: runVerb, pause, resume, report, verdict };', mentions: 4, reason: 'Map the run verb to its implemented handler.', line: 47 },
  { file: 'src/cli/verbs.mjs', text: 'export async function run(argv) {', mentions: 1, reason: 'Define the CLI argument dispatcher independently of any process starter.', line: 68 },
  { file: 'src/cli/verdict.mjs', text: '  return { pull: Number(pull), verdict, unmet, toSound: given[\'--to-sound\'], insufficient: given[\'--insufficient\'] };', mentions: 2, reason: 'Parse the explicit pull-request number from owner-verdict arguments.', line: 65 },
  { file: 'src/cli/verdict.mjs', text: 'function lineFrom(input) {', mentions: 1, reason: 'Declare terminal-line collection with protected once-member subscriptions.', line: 69 },
  { file: 'src/cli/verdict.mjs', text: '    lines.once(\'line\', (line) => {', mentions: 1, reason: 'Subscribe to the terminal interface\'s first line; its once member collides with the CLI wrapper name.', line: 72, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/verdict.mjs', text: '    lines.once(\'close\', () => resolve(null));', mentions: 1, reason: 'Subscribe to the terminal interface\'s close event under the same protected member name.', line: 76, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/verdict.mjs', text: 'export async function verdict({ args = [], push } = {}) {', mentions: 1, reason: 'Declare the owner-verdict CLI operation and its recorded posting work.', line: 85 },
  { file: 'src/cli/verdict.mjs', text: '  return recording((opened) => posting(opened, given), push);', mentions: 1, reason: 'Run owner-verdict posting through the recorded CLI operation wrapper.', line: 89, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/verdict.mjs', text: 'async function posting(opened, given) {', mentions: 1, reason: 'Declare the owner-verdict posting wrapper and its local confirmation read.', line: 93 },
  { file: 'src/cli/verdict.mjs', text: '  const { named, refusal } = await settled(\'verdict\', opened, { target: process.cwd(), packageRoot: PACKAGE });', mentions: 1, reason: 'Open the owner-verdict CLI context for the selected target repository.', line: 94 },
  { file: 'src/cli/verdict.mjs', text: '  const number = given.pull;', mentions: 1, reason: 'Take the parsed target pull-request number for owner verdict posting.', line: 118 },
  { file: 'src/cli/verdict.mjs', text: '    pull: number,', mentions: 1, reason: 'Carry the target pull request into the owner-verdict fields.', line: 139 },
  { file: 'src/cli/verdict.mjs', text: '    verdict: given.verdict,', mentions: 2, reason: 'Carry the explicit owner verdict into the marker fields.', line: 143 },
  { file: 'src/cli/verdict.mjs', text: '  const body = composeMarker(marker, `The owner\'s verdict on pull request #${number}: ${given.verdict}.`);', mentions: 1, reason: 'Compose the owner\'s marker with the selected pull request and verdict.', line: 149 },
  { file: 'src/cli/verdict.mjs', text: '  const answer = await lineFrom(process.stdin);', mentions: 1, reason: 'Read the owner\'s terminal confirmation through the protected line helper.', line: 159, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/cli/verdict.mjs', text: '    if (error.made) return { text: `rigger verdict: posted the owner\'s verdict on pull request #${number}: ${error.made.answer.html_url}, and the event sink refused to record it: ${unrecordedNamed(error)}`, code: 1 };', mentions: 1, reason: 'Report the actual posted verdict URL when recording its write was refused.', line: 177 },
  { file: 'src/config/validate.mjs', text: '    provisioning: { entries: \'step\' },', mentions: 2, reason: 'Describe provisioning-map entries as configured steps in the validation schema.', line: 57 },
  { file: 'src/config/validate.mjs', text: '    triggers: { entries: \'trigger\' },', mentions: 1, reason: 'Name the trigger-entry schema used by configured clock jobs.', line: 66 },
  { file: 'src/config/validate.mjs', text: '  trigger: {', mentions: 1, reason: 'Declare that trigger-entry schema.', line: 68 },
  { file: 'src/config/validate.mjs', text: '    judges: { required: true },', mentions: 1, reason: 'Require the configured kind\'s judge list.', line: 129 },
  { file: 'src/config/validate.mjs', text: '    provisioning: {},', mentions: 1, reason: 'Supply the empty provisioning-map schema default.', line: 133 },
  { file: 'src/config/validate.mjs', text: '  step: {', mentions: 1, reason: 'Define the configured-step validation schema.', line: 138 },
  { file: 'src/config/validate.mjs', text: '    run: { required: true },', mentions: 1, reason: 'Require a configured step to declare a run line.', line: 139 },
  { file: 'src/config/validate.mjs', text: '    if (kind?.judges === undefined) continue;', mentions: 1, reason: 'Leave an absent judge list for the required-field diagnostic.', line: 381 },
  { file: 'src/config/validate.mjs', text: '    if (!Array.isArray(kind.judges) || kind.judges.length === 0) {', mentions: 2, reason: 'Require a nonempty array of judge entries.', line: 382 },
  { file: 'src/config/validate.mjs', text: '    const formed = kind.judges.map((entry, position) => readJudgeEntry(entry, `${where}.judges[${position}]`, coercedMaker ? [] : makerProviders(roleUnder(roles, kind.maker)), refusals));', mentions: 1, reason: 'Validate each judge entry against its configured role and maker providers.', line: 390 },
  { file: 'src/config/validate.mjs', text: '    const named = kind.judges.map((entry, position) => (formed[position] ? judgeRole(entry) : undefined));', mentions: 1, reason: 'Read each validated entry\'s judge role name.', line: 391 },
  { file: 'src/config/validate.mjs', text: '      if (judge === OWNER && position !== kind.judges.length - 1) {', mentions: 1, reason: 'Require the owner to be the last configured judge.', line: 412 },
  { file: 'src/config/validate.mjs', text: '        refusals.push(`\\`${where}.judges\\` names \\`${OWNER}\\` at position ${position + 1} of ${kind.judges.length}, and the owner judges last`);', mentions: 1, reason: 'Describe a configured owner judge at the wrong list position.', line: 413 },
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
  { file: 'src/config/validate.mjs', text: '      const { answer } = kindOf({ labels }, config.kinds, config.epicLabel);', mentions: 1, reason: 'Inspect kind selection\'s answer while validating configured cards.', line: 836 },
  { file: 'src/config/validate.mjs', text: '    if (Object.hasOwn(trigger, \'catchUp\') && ![\'fire\', \'skip\'].includes(trigger.catchUp)) {', mentions: 1, reason: 'Validate the configured catch-up policy as fire or skip.', line: 864 },
  { file: 'src/config/validate.mjs', text: '  readProvisioning(config.provisioning, refusals);', mentions: 1, reason: 'Validate the provisioning map during complete configuration validation.', line: 887 },
  { file: 'src/config/validate.mjs', text: 'export const workRequires = (step) => step?.required === true;', mentions: 2, reason: 'Read whether a configured step is required for work to continue.', line: 903 },
  { file: 'src/config/validate.mjs', text: 'export const stepTimeout = (step) => step.timeout ?? 1_800_000;', mentions: 2, reason: 'Read a configured step\'s timeout or its documented default.', line: 909 },
  { file: 'src/config/validate.mjs', text: '  const selectors = [...Object.values(config.kinds), ...Object.values(config.provisioning ?? {})];', mentions: 1, reason: 'Include provisioning selectors when validating all configuration label selectors.', line: 937 },
  { file: 'src/execution/groups.mjs', text: '  && holdsDispatch(entry.dispatch, entry.card);', mentions: 1, reason: 'Validate that a process-group entry has a usable dispatch identity.', line: 55 },
  { file: 'src/execution/kept-output.mjs', text: '        sink.emitter({ layer: \'L1\', card, dispatch: id }).emit(\'output.failed\', { path, reason: cause.message });', mentions: 1, reason: 'Attribute an output-file refusal to its L1 dispatch identity.', line: 15 },
  { file: 'src/execution/role.mjs', text: 'import { within } from \'./run.mjs\';', mentions: 1, reason: 'Import the independent path-containment helper for role preparation.', line: 7 },
  { file: 'src/execution/role.mjs', text: 'import { SCRATCH_REFUSED, WORKSPACE_NOT_MADE, makeScratch } from \'./workspace.mjs\';', mentions: 1, reason: 'Import the reviewed scratch-preparation wrapper and its refusal types.', line: 8 },
  { file: 'src/execution/role.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the environment copier for role preparation.', line: 9 },
  { file: 'src/execution/role.mjs', text: 'import { workspaces } from \'../substrate/worktrees.mjs\';', mentions: 1, reason: 'Import the reviewed git-workspace factory for maker git-directory discovery.', line: 13 },
  { file: 'src/execution/role.mjs', text: 'export async function roleDispatch({ answer, cwd, directory, scratch, repository, reach, maker = false, env, sink, id, card, adapters = ADAPTERS }) {', mentions: 3, reason: 'Receive the engine environment and selected adapter for a role dispatch.', line: 57 },
  { file: 'src/execution/role.mjs', text: '    made = await makeScratch({ base: scratch, role: answer.role, card, dispatch: id, repository, sink });', mentions: 2, reason: 'Prepare the role\'s scratch directory under its card and dispatch identity.', line: 64, programs: ['git'] },
  { file: 'src/execution/role.mjs', text: '  const environment = gitEnvironment(env);', mentions: 3, reason: 'Copy the account environment while removing git redirection variables.', line: 71 },
  { file: 'src/execution/role.mjs', text: '    invoked = await adapters[provider].invocation({', mentions: 1, reason: 'Prepare the selected adapter invocation under the role\'s configured bounds.', line: 75, programs: ['codex'] },
  { file: 'src/execution/role.mjs', text: '      ...(maker ? { gitDirectories: () => workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }) }).gitDirectories(cwd) } : {}),', mentions: 4, reason: 'Discover maker git metadata through the reviewed workspace factory.', line: 83, programs: ['git'] },
  { file: 'src/execution/role.mjs', text: '      environment,', mentions: 1, reason: 'Hand the copied environment to the provider invocation builder.', line: 84 },
  { file: 'src/execution/role.mjs', text: '      emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }),', mentions: 1, reason: 'Scope adapter invocation preparation to its L0 dispatch identity.', line: 85 },
  { file: 'src/execution/role.mjs', text: '      const { command, file, ...detail } = cause.startCause;', mentions: 1, reason: 'Separate a provider startup command from its other failure details.', line: 90 },
  { file: 'src/execution/role.mjs', text: '      failure.startCause = { ...detail, ...(command === undefined ? {} : { provider }), ...(file === undefined ? {} : { file: answer.agent }) };', mentions: 1, reason: 'Attribute an adapter command failure to the provider without exposing a command operand.', line: 91 },
  { file: 'src/execution/role.mjs', text: '  const { command, args, input, unset, env: set, folder } = invoked;', mentions: 2, reason: 'Read command, input and reviewed environment changes from the adapter result.', line: 96 },
  { file: 'src/execution/role.mjs', text: '  for (const name of unset) delete environment[name];', mentions: 1, reason: 'Remove only the variables the adapter\'s invocation declares unset.', line: 104 },
  { file: 'src/execution/role.mjs', text: '  Object.assign(environment, set);', mentions: 1, reason: 'Apply the adapter\'s declared environment additions to the copied environment.', line: 105 },
  { file: 'src/execution/role.mjs', text: '  return { provider, command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest };', mentions: 3, reason: 'Return the prepared program and environment with the role\'s workspace and timeout.', line: 106 },
  { file: 'src/execution/role.mjs', text: '  if (Object.keys(gitEnvironment({ [key]: \'\' })).length === 0) return disallowed(\'is a variable that redirects git, which L1 removes\');', mentions: 1, reason: 'Recognize git-redirecting variables that role configuration may not restore.', line: 129 },
  { file: 'src/execution/run.mjs', text: 'import { gitEnvironment } from \'../substrate/git-environment.mjs\';', mentions: 1, reason: 'Import the environment copier for L1\'s real process handoff.', line: 9 },
  { file: 'src/execution/run.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, identityOf, killRecordedGroup, runCommand } from \'../substrate/process.mjs\';', mentions: 2, reason: 'Import the L0 starter alongside process identity and cleanup operations.', line: 10 },
  { file: 'src/execution/run.mjs', text: 'export async function dispatch({ id, card, directory, sink, provider, command, args, input, cwd, workspace, scratch, env, folder, timeout, facts, digest, host, readTimeout, clock = () => performance.now() }) {', mentions: 3, reason: 'Receive a prepared program, environment and identity for real L1 dispatch.', line: 90 },
  { file: 'src/execution/run.mjs', text: '  if (id === undefined || id === null || id === \'\') throw startFailure(Object.assign(new Error(`L1 was given no dispatch id, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');', mentions: 1, reason: 'Refuse a process start whose dispatch identifier is absent.', line: 93 },
  { file: 'src/execution/run.mjs', text: '  if (!holdsDispatch(id, card)) throw startFailure(Object.assign(new Error(`L1\'s record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');', mentions: 1, reason: 'Refuse a process start whose identity cannot be recorded.', line: 96 },
  { file: 'src/execution/run.mjs', text: '  const events = sink.emitter({ layer: \'L1\', card, dispatch: id });', mentions: 1, reason: 'Scope L1 lifecycle events to the dispatch being started.', line: 97 },
  { file: 'src/execution/run.mjs', text: '  const start = { command, timeout, ...(workspace === undefined ? {} : { workspace }), ...(facts === undefined ? {} : { facts }), ...(digest === undefined ? {} : { digest }) };', mentions: 1, reason: 'Record the selected program in the dispatch-start event.', line: 99 },
  { file: 'src/execution/run.mjs', text: '      throw startFailure(Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED }), \'groups-unwritable\');', mentions: 1, reason: 'Describe why the process-group record could not be written before a start.', line: 118 },
  { file: 'src/execution/run.mjs', text: '    if (escape !== undefined) throw Object.assign(new Error(`dispatch ${id} did not start ${command}: ${escape}`), { code: NOT_STARTED, startCause });', mentions: 1, reason: 'Refuse a start in a workspace whose safety checks failed.', line: 123 },
  { file: 'src/execution/run.mjs', text: '    if (unread !== undefined) throw startFailure(Object.assign(new Error(`dispatch ${id} did not start ${command}: ${unread}`), { code: NOT_STARTED }), \'directory-unusable\');', mentions: 1, reason: 'Refuse a start whose dispatch directory could not be read.', line: 127 },
  { file: 'src/execution/run.mjs', text: '    result = await runCommand({', mentions: 1, reason: 'Start the prepared role CLI or configured shell through the sole L0 adapter.', line: 129, programs: ['claude', 'codex', '/bin/sh'] },
  { file: 'src/execution/run.mjs', text: '      command,', mentions: 1, reason: 'Forward the prepared program unchanged into L0 options.', line: 130 },
  { file: 'src/execution/run.mjs', text: '      env: workspace === undefined ? env : gitEnvironment(env),', mentions: 4, reason: 'Remove git redirection variables when starting in a card workspace.', line: 136 },
  { file: 'src/execution/run.mjs', text: '      emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }),', mentions: 1, reason: 'Scope L0 child lifecycle events to that same dispatch identity.', line: 142 },
  { file: 'src/execution/run.mjs', text: '        addGroup(directory, { group, started, dispatch: id, card, ...(place === undefined ? {} : { workspace: place, ...identity }), ...(held === undefined ? {} : { scratch: held }) });', mentions: 1, reason: 'Record the spawned group\'s identity under its dispatch id.', line: 157 },
  { file: 'src/execution/run.mjs', text: '    if (failure.startCause?.command !== undefined) {', mentions: 1, reason: 'Recognize a program-bearing structured startup failure.', line: 187 },
  { file: 'src/execution/run.mjs', text: '      const { command: named, ...cause } = failure.startCause;', mentions: 1, reason: 'Remove the raw program from startup-failure details before attribution.', line: 188 },
  { file: 'src/execution/run.mjs', text: '        failure = Object.assign(new Error(`${named(id, card)} ran ${command}, which exited ${result.exit}, and ${kept}`), { code: RECORD_REFUSED, result, recordFailure });', mentions: 1, reason: 'Describe a command result whose process-record removal was refused.', line: 211 },
  { file: 'src/execution/run.mjs', text: '  return { escape: `its directory ${place} is held by ${named(holder.dispatch, holder.card)}, whose entry in the record names ${holder.workspace}`, startCause: { kind: \'directory-occupied\' } };', mentions: 1, reason: 'Describe the dispatch whose existing workspace record occupies a directory.', line: 295 },
  { file: 'src/execution/run.mjs', text: 'export async function killRecordedGroups({ directory, sink, host, readTimeout }) {', mentions: 1, reason: 'Declare the wrapper that cleans L1\'s previously recorded dispatch groups.', line: 380 },
  { file: 'src/execution/run.mjs', text: '    await killEntries({ directory, sink, host, readTimeout, entries });', mentions: 1, reason: 'End each process-group entry left by a previous engine invocation.', line: 384, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/execution/run.mjs', text: 'async function killEntries({ directory, sink, host, readTimeout, entries }) {', mentions: 1, reason: 'Declare cleanup of the process groups L1 previously recorded.', line: 407 },
  { file: 'src/execution/run.mjs', text: '    const { group, started, dispatch, card, workspace, device, inode, scratch } = entry;', mentions: 1, reason: 'Read a recorded group\'s dispatch identity before ending it.', line: 413 },
  { file: 'src/execution/run.mjs', text: '      await killRecordedGroup({ group, started, directory: workspace, identity: { device, inode }, scratch, host, readTimeout, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) });', mentions: 2, reason: 'End the recorded group and attribute cleanup to its recorded dispatch.', line: 416, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/execution/step.mjs', text: 'export const stepDispatch = (step, workspace, env = process.env) => ({', mentions: 4, reason: 'Receive the configured step, workspace and inherited account environment.', line: 19 },
  { file: 'src/execution/step.mjs', text: '  command: \'/bin/sh\',', mentions: 1, reason: 'Select /bin/sh exclusively for the consumer\'s configured step line.', line: 20 },
  { file: 'src/execution/step.mjs', text: '  args: [\'-c\', step.run],', mentions: 2, reason: 'Supply the configured step\'s run line as the shell\'s -c operand.', line: 21 },
  { file: 'src/execution/step.mjs', text: '  cwd: join(workspace, step.cwd ?? \'.\'),', mentions: 1, reason: 'Resolve the configured step\'s working directory inside its workspace.', line: 22 },
  { file: 'src/execution/step.mjs', text: '  env,', mentions: 1, reason: 'Pass the inherited environment into the step dispatch options.', line: 24 },
  { file: 'src/execution/step.mjs', text: '  timeout: stepTimeout(step),', mentions: 1, reason: 'Use the configured step\'s bounded timeout.', line: 25 },
  { file: 'src/execution/workspace.mjs', text: 'import { within as underOrAt } from \'./run.mjs\';', mentions: 1, reason: 'Import the independent path-containment helper under its descriptive local name.', line: 7 },
  { file: 'src/execution/workspace.mjs', text: 'import { ADDING, FETCH_FAILED as L0_FETCH_FAILED, LINE_DELETED as L0_LINE_DELETED, LINE_MOVED as L0_LINE_MOVED, workspaces } from \'../substrate/worktrees.mjs\';', mentions: 1, reason: 'Import the reviewed git-workspace factory and its refusal constants.', line: 9 },
  { file: 'src/execution/workspace.mjs', text: 'export async function makeWorkspace({ root, topic, card, head, repository, sink, timeout }) {', mentions: 1, reason: 'Declare the git-backed maker-workspace preparation wrapper.', line: 100 },
  { file: 'src/execution/workspace.mjs', text: '  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card }), timeout, rejectFailedChecks: true });', mentions: 1, reason: 'Create the reviewed git adapter for workspace construction.', line: 104, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local workspace-operation wrapper that reports failed creation steps.', line: 106 },
  { file: 'src/execution/workspace.mjs', text: '  const removed = await step(async () => {', mentions: 1, reason: 'Remove a replaceable workspace through the checked operation wrapper.', line: 113 },
  { file: 'src/execution/workspace.mjs', text: '    const { accepted, why } = await adapter.acceptsBranch(branch);', mentions: 1, reason: 'Check the topic branch name through the reviewed git adapter.', line: 115, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '      const elsewhere = (await adapter.listing()).find((each) => each.branch === branch && nearestReal(each.at) !== nearestReal(path));', mentions: 1, reason: 'Check whether the topic branch is already held by another registered worktree.', line: 118, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    return cleared({ adapter, card, branch, path, repository }, head === undefined ? undefined : () => adapter.fetchLineAt(branch, head));', mentions: 2, reason: 'Clear the verified workspace and optionally fetch its requested branch head.', line: 121, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => head === undefined ? adapter.make(path, branch) : adapter.makeAt(path, branch, head));', mentions: 3, reason: 'Create the requested workspace and branch through the checked operation wrapper.', line: 124, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function readWorkspaceTip({ card, dispatch, path, branch, repository, sink }) {', mentions: 2, reason: 'Receive a dispatch identity while reading the continuing workspace tip.', line: 130 },
  { file: 'src/execution/workspace.mjs', text: '    return await workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) }).tip(path, branch);', mentions: 3, reason: 'Read that workspace tip through the reviewed git-workspace factory.', line: 132, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export const makeJudgeDirectory = (options) => makeDetachedDirectory({ ...options, family: \'judges\' });', mentions: 3, reason: 'Prepare a judge directory through the shared detached-directory wrapper.', line: 152, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export const makeEscalationDirectory = (options) => makeDetachedDirectory({ ...options, family: \'escalations\' });', mentions: 2, reason: 'Prepare an escalation directory through the shared detached-directory wrapper.', line: 155, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function makeDetachedDirectory({ root, topic, card, role, head, repository, sink, family }) {', mentions: 1, reason: 'Declare the git-backed detached judge or escalation directory wrapper.', line: 158 },
  { file: 'src/execution/workspace.mjs', text: '  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card }), rejectFailedChecks: family === \'escalations\' });', mentions: 1, reason: 'Create the reviewed git adapter for judge or escalation directories.', line: 161, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local detached-directory operation wrapper with cleanup diagnostics.', line: 164 },
  { file: 'src/execution/workspace.mjs', text: '  const found = await step(() => judgeChecked({ adapter, path, repository }));', mentions: 2, reason: 'Check an existing judge directory before replacing it.', line: 177, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const main = await step(async () => {', mentions: 1, reason: 'Build the detached main directory through checked workspace operations.', line: 178 },
  { file: 'src/execution/workspace.mjs', text: '    const { commit } = await adapter.fetchMainLine();', mentions: 1, reason: 'Read the repository main-line commit before preparing detached directories.', line: 179, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '      const { held, why } = await adapter.holdsAfterFetch(head);', mentions: 1, reason: 'Verify the requested detached head after the adapter\'s fetch.', line: 181, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => judgeCleared(adapter, found));', mentions: 2, reason: 'Clear a replaceable judge directory before constructing its head.', line: 186, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await step(async () => {', mentions: 1, reason: 'Construct the detached judge head through the checked operation wrapper.', line: 188 },
  { file: 'src/execution/workspace.mjs', text: '    await adapter.makeDetached(trees.main, main);', mentions: 1, reason: 'Create the judge\'s detached main directory through the reviewed git adapter.', line: 189, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    if (trees.head !== undefined) await adapter.makeDetached(trees.head, head);', mentions: 1, reason: 'Create a detached proposed-head directory where the judge needs one.', line: 190, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export async function makeScratch({ base, role, card, dispatch, repository, sink }) {', mentions: 2, reason: 'Declare scratch preparation with its role and dispatch identity.', line: 209 },
  { file: 'src/execution/workspace.mjs', text: '  const events = sink.emitter({ layer: \'L1\', card, dispatch });', mentions: 1, reason: 'Scope scratch-preparation events to the calling role dispatch.', line: 210 },
  { file: 'src/execution/workspace.mjs', text: '  const step = async (work) => {', mentions: 1, reason: 'Define a local scratch-operation wrapper that records refusal context.', line: 212 },
  { file: 'src/execution/workspace.mjs', text: '  const there = await step(() => scratchReplaceable({ base, path, repository, adapter: workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) }) }));', mentions: 4, reason: 'Check whether the role scratch directory can safely be replaced.', line: 222, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    await step(async () => {', mentions: 1, reason: 'Remove a replaceable role scratch directory through the checked operation wrapper.', line: 224 },
  { file: 'src/execution/workspace.mjs', text: '  await step(() => mkdirSync(path, { recursive: true }));', mentions: 1, reason: 'Create the role scratch directory through the checked operation wrapper.', line: 230 },
  { file: 'src/execution/workspace.mjs', text: 'async function scratchReplaceable({ base, path, repository, adapter }) {', mentions: 1, reason: 'Declare verification of a scratch path before its replacement.', line: 236 },
  { file: 'src/execution/workspace.mjs', text: '  await unregistered({ path, there, repository, adapter });', mentions: 1, reason: 'Verify that no registered worktree blocks creation of the scratch directory.', line: 239, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function unregistered({ path, there, repository, adapter }) {', mentions: 1, reason: 'Declare verification of registrations occupying a proposed scratch directory.', line: 334 },
  { file: 'src/execution/workspace.mjs', text: '  for (const listed of await adapter.registered()) {', mentions: 1, reason: 'Read registered worktrees before deciding which paths the card owns.', line: 336, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function judgeChecked({ adapter, path, repository }) {', mentions: 1, reason: 'Declare the git-backed verification of an existing judge directory.', line: 503 },
  { file: 'src/execution/workspace.mjs', text: '  const handed = realpathSync.native(await adapter.topLevel());', mentions: 1, reason: 'Read the canonical repository root before checking workspace ownership.', line: 534, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const listed = (await adapter.listing()).map((record) => ({ ...record, real: real(record.at) }));', mentions: 1, reason: 'Read and canonicalize registered worktree paths before removal checks.', line: 536, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    if (!lstatSync(tree).isDirectory() || !(await adapter.isWorktree(tree))) throw leaves(`holds ${tree}, which is not a worktree of the repository`);', mentions: 1, reason: 'Check that the recorded directory is still a git worktree before using it.', line: 547, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function judgeCleared(adapter, { real, present: there, trees, unlocking }) {', mentions: 1, reason: 'Declare the reviewed cleanup of verified judge worktrees.', line: 566 },
  { file: 'src/execution/workspace.mjs', text: '  for (const tree of unlocking) await adapter.unlock(tree);', mentions: 1, reason: 'Unlock verified interrupted registrations before removing their directories.', line: 567, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  for (const tree of trees) await adapter.remove(tree);', mentions: 1, reason: 'Remove the verified card worktrees through the git adapter.', line: 570, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function cleared({ adapter, card, branch, path, repository }, beforeRemove = async () => {}) {', mentions: 1, reason: 'Declare the git-backed clearing of a card workspace.', line: 582 },
  { file: 'src/execution/workspace.mjs', text: '    await unlockedIfAdding(adapter, path, branch);', mentions: 1, reason: 'Recover a verified interrupted registration before clearing the workspace.', line: 585, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  if (!(await adapter.isWorktree(path))) {', mentions: 1, reason: 'Refuse a directory that the reviewed git adapter does not identify as a worktree.', line: 588, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  if (real === (await adapter.topLevel())) {', mentions: 1, reason: 'Compare the workspace path with the canonical repository root before removal.', line: 592, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const held = await adapter.registration(real);', mentions: 1, reason: 'Read the selected workspace\'s existing git registration.', line: 595, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const nested = (await adapter.registered()).find((listed) => within(path, real, listed));', mentions: 1, reason: 'Refuse removal when a nested registered worktree occupies the directory.', line: 600, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await adapter.remove(real);', mentions: 1, reason: 'Remove the verified card worktree through git.', line: 606, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export async function workspaceHandle({ root, topic, repository, sink }) {', mentions: 1, reason: 'Declare the maker-workspace factory that checks configured branch names.', line: 639 },
  { file: 'src/execution/workspace.mjs', text: '  const { accepted, why } = await workspaces({ repository, emitter: sink.emitter({ layer: \'L0\' }) }).acceptsBranch(name);', mentions: 2, reason: 'Ask git whether the configured topic branch name is acceptable.', line: 641, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const handle = (card, head) => makeWorkspace({ root, topic, card, head, repository, sink });', mentions: 2, reason: 'Bind the maker card and head to the reviewed workspace-construction wrapper.', line: 643, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  handle.tip = ({ card, dispatch, path, branch }) => readWorkspaceTip({ card, dispatch, path, branch, repository, sink });', mentions: 5, reason: 'Forward the continuing workspace\'s dispatch identity into its tip read.', line: 644, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  return handle;', mentions: 1, reason: 'Return the reviewed card-workspace handle to its caller.', line: 645 },
  { file: 'src/execution/workspace.mjs', text: 'export const judgeDirectoryHandle = ({ root, topic, repository, sink }) => (card, role, head) => makeJudgeDirectory({ root, topic, card, role, head, repository, sink });', mentions: 2, reason: 'Bind card and judge identifiers to the detached judge-directory wrapper.', line: 654, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export const escalationDirectoryHandle = ({ root, topic, repository, sink }) => (card, role, head) => makeEscalationDirectory({ root, topic, card, role, head, repository, sink });', mentions: 2, reason: 'Bind card and escalation identifiers to the detached directory wrapper.', line: 657, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'export async function removeCardDirectories({ root, topic, card, repository, sink, timeout }) {', mentions: 1, reason: 'Declare the git-backed removal of a card\'s recorded workspace directories.', line: 660 },
  { file: 'src/execution/workspace.mjs', text: '  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card }), timeout, rejectFailedChecks: true });', mentions: 1, reason: 'Create the reviewed git adapter for workspace-directory removal.', line: 664, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    const held = await adapter.registration(workspace);', mentions: 1, reason: 'Read the maker workspace registration before final directory cleanup.', line: 682, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    const gone = await cleared({ adapter, card, branch: name, path: workspace, repository }, async () => {', mentions: 1, reason: 'Clear the verified card workspace before final directory cleanup.', line: 684, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '      if (held?.locked === ADDING) await adapter.unlock(workspace);', mentions: 1, reason: 'Unlock a verified interrupted registration while clearing the workspace.', line: 686, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  const removeDetached = async ({ path, begin }) => {', mentions: 1, reason: 'Declare removal of one verified detached judge or escalation directory.', line: 725 },
  { file: 'src/execution/workspace.mjs', text: '    const found = await judgeChecked({ adapter, path, repository });', mentions: 1, reason: 'Verify an existing judge worktree through the checked git wrapper.', line: 726, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    await judgeCleared(adapter, found);', mentions: 1, reason: 'Clear the detached directory only after verifying its ownership.', line: 729, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await children(\'judges\', removeDetached);', mentions: 2, reason: 'Remove the card\'s recorded judge-directory children.', line: 732 },
  { file: 'src/execution/workspace.mjs', text: '  await children(\'escalations\', removeDetached);', mentions: 1, reason: 'Remove the card\'s escalation directories through the same verified wrapper.', line: 733 },
  { file: 'src/execution/workspace.mjs', text: '    const there = await scratchReplaceable({ base, path, repository, adapter });', mentions: 1, reason: 'Check whether an existing scratch path can be safely replaced.', line: 735, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  for (const kind of [\'judges\', \'escalations\']) {', mentions: 1, reason: 'Inspect both judge and escalation directory families during cleanup.', line: 742 },
  { file: 'src/execution/workspace.mjs', text: '        for (const record of await adapter.listing()) {', mentions: 1, reason: 'Read registered worktrees while recovering interrupted detached directories.', line: 751, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '            await adapter.unlock(record.at);', mentions: 1, reason: 'Unlock verified interrupted detached-directory registrations.', line: 757, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '    await adapter.prune();', mentions: 1, reason: 'Prune stale registrations after verified detached-directory cleanup.', line: 772, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: 'async function unlockedIfAdding(adapter, path, branch) {', mentions: 1, reason: 'Declare recovery of a verified interrupted maker worktree registration.', line: 789 },
  { file: 'src/execution/workspace.mjs', text: '  const held = await adapter.registration(path);', mentions: 1, reason: 'Read the selected path\'s registration before recovery.', line: 790, programs: ['git'] },
  { file: 'src/execution/workspace.mjs', text: '  await adapter.unlock(path);', mentions: 1, reason: 'Unlock the verified interrupted workspace registration.', line: 796, programs: ['git'] },
  { file: 'src/observation/push.mjs', text: 'export function pushAtReturn({ side = PUSH_DEFAULTS.side, spawn, write = PUSH_DEFAULTS.write, now = PUSH_DEFAULTS.now } = {}) {', mentions: 1, reason: 'Receive an optional injected telemetry process starter for the push side.', line: 39 },
  { file: 'src/observation/push.mjs', text: '  const perform = async ({ sink, run, config, repository, directory, answer, handOver }) => {', mentions: 2, reason: 'Receive the recorded run identifier for a return-time telemetry push.', line: 52 },
  { file: 'src/observation/push.mjs', text: '    if (!stream.includes(`"run":${JSON.stringify(run)}`)) return answer;', mentions: 1, reason: 'Push only an event stream containing this run\'s envelope.', line: 64 },
  { file: 'src/observation/push.mjs', text: '      answered = await side({ repository, stream, emitter: sink.emitter({ layer: \'L0\' }), now, ...(spawn === undefined ? {} : { spawn }) });', mentions: 2, reason: 'Forward an explicitly injected starter to the telemetry push side.', line: 67 },
  { file: 'src/observation/push.mjs', text: '      sink.emitter({ layer: \'L5\', dispatch: null }).emit(\'push.end\', { ref: DATA_REF, outcome, ms: now() - start, ...fields });', mentions: 1, reason: 'Record a push outcome without attributing it to an agent dispatch.', line: 74 },
  { file: 'src/observation/report.mjs', text: '    if (!runs.has(event.run)) runs.set(event.run, []);', mentions: 2, reason: 'Group recorded event envelopes by their run identifier.', line: 15 },
  { file: 'src/observation/report.mjs', text: '    runs.get(event.run).push(event);', mentions: 1, reason: 'Append each event to its own run\'s report group.', line: 16 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(events)].map(([run, recorded]) => ({ run, ...rates(recorded) })), stream: rates(events) };', mentions: 2, reason: 'Compute process-tool rates per recorded run and across the stream.', line: 34 },
  { file: 'src/observation/report.mjs', text: '    .filter((event) => event.layer === \'L0\' && [\'survivor.killed\', \'group.killed\'].includes(event.event) && event.dispatch != null)', mentions: 1, reason: 'Select L0 survivor events that carry an actual dispatch identity.', line: 52 },
  { file: 'src/observation/report.mjs', text: '    .map((event) => event.dispatch));', mentions: 1, reason: 'Collect the dispatch identities of calls with recorded survivor kills.', line: 53 },
  { file: 'src/observation/report.mjs', text: '    return { killed: counted.filter((event) => killed.has(event.dispatch)).length, of: counted.length };', mentions: 1, reason: 'Count dispatches with survivor kills against the dispatches observed.', line: 56 },
  { file: 'src/observation/report.mjs', text: '  const runs = [...byRun(events)].map(([run, recorded]) => ({', mentions: 1, reason: 'Compute dispatch summaries from each recorded run\'s events.', line: 58 },
  { file: 'src/observation/report.mjs', text: '    run, durations: ends(recorded).map(({ dispatch, card, ms }) => ({ dispatch, card, ms })), survivors: survivors(recorded),', mentions: 3, reason: 'Return a run identifier with its durations and survivors.', line: 59 },
  { file: 'src/observation/report.mjs', text: '  return { runs, stream: { ended: ends(events).length, survivors: survivors(events), ...attempts(events) } };', mentions: 1, reason: 'Report the stream\'s count of recorded dispatch endings.', line: 61 },
  { file: 'src/observation/report.mjs', text: '  || (event.event === \'attempt.failed\' && event.class === \'environment\' && event.maker === undefined));', mentions: 1, reason: 'Classify recorded environment failures as host faults.', line: 66 },
  { file: 'src/observation/report.mjs', text: '    if (event.event === \'pull\') {', mentions: 1, reason: 'Recognize a recorded card pull while rebuilding work claims.', line: 78 },
  { file: 'src/observation/report.mjs', text: '      const claim = { pull: event, merging: false, didSomething: false, interrupted: true };', mentions: 1, reason: 'Retain the original pull event with its claim state.', line: 79 },
  { file: 'src/observation/report.mjs', text: '    if (event.event === \'dispatch\') claim.didSomething = true;', mentions: 1, reason: 'Recognize the L3 dispatch action as work for the card\'s claim.', line: 86 },
  { file: 'src/observation/report.mjs', text: '  const claims = new Map([...byRun(events).values()].flatMap(workClaims).map((claim) => [claim.pull, claim]));', mentions: 1, reason: 'Index rebuilt work claims by their original pull event.', line: 94 },
  { file: 'src/observation/report.mjs', text: '    if (earlier && earlier.pull.run !== event.run && earlier.interrupted) redos.push({ card: event.card, run: event.run });', mentions: 5, reason: 'Identify a card redone after an interrupted earlier run.', line: 102 },
  { file: 'src/observation/report.mjs', text: '  const pulls = recorded.filter((event) => event.layer === \'L3\' && event.event === \'pull\' && event.card != null);', mentions: 1, reason: 'Select recorded L3 card-pull events for report counts.', line: 112 },
  { file: 'src/observation/report.mjs', text: '    escalated: new Set(escalations.map((event) => event.card)).size, pulled: new Set(pulls.map((event) => event.card)).size,', mentions: 1, reason: 'Report the distinct escalated and pulled card counts.', line: 114 },
  { file: 'src/observation/report.mjs', text: '      infrastructure: (classes.get(\'environment\') ?? 0) + (classes.get(\'card-local\') ?? 0) };', mentions: 1, reason: 'Count environment and card-local causes as infrastructure escalations.', line: 129 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(recorded)].map(([run, entries]) => ({ run, ...counts(entries) })), stream: counts(recorded) };', mentions: 2, reason: 'Return escalation-cause counts per run and for the whole stream.', line: 131 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer === \'L2\' && event.event === \'merge.decided\' && event.judges?.every(({ verdict }) => verdict === \'sound\')) {', mentions: 2, reason: 'Require sound verdicts from each judge recorded in a merge decision.', line: 142 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer === \'L3\' && event.event === \'pull\' && event.card != null && event.kind != null) kinds.set(event.card, event.kind);', mentions: 1, reason: 'Associate a pulled card with its recorded configured kind.', line: 157 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer === \'L1\' && event.event === \'dispatch.start\' && !starts.has(event.dispatch)) starts.set(event.dispatch, { index, ts: Date.parse(event.ts) });', mentions: 2, reason: 'Record each L1 dispatch\'s first observed start time.', line: 177 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer === \'L1\' && event.event === \'dispatch.end\' && !ends.has(event.dispatch)) ends.set(event.dispatch, Date.parse(event.ts));', mentions: 2, reason: 'Record each L1 dispatch\'s first observed ending time.', line: 178 },
  { file: 'src/observation/report.mjs', text: '  return events.filter((event) => event.layer === \'L3\' && event.event === \'dispatch\' && event.role !== undefined && event.step === undefined', mentions: 2, reason: 'Distinguish maker dispatch windows from provisioning-step dispatches.', line: 181 },
  { file: 'src/observation/report.mjs', text: '    && starts.has(event.dispatch)).map(({ card, dispatch, role, attempt }) => {', mentions: 3, reason: 'Join L3 role and attempt facts to their matching L1 dispatch starts.', line: 182 },
  { file: 'src/observation/report.mjs', text: '    return { card, dispatch, role, maker: attempt !== undefined, from: ts, to };', mentions: 1, reason: 'Return the joined role dispatch identity and observed time interval.', line: 186 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer === \'L3\' && event.event === \'pull\' && event.card != null && !pulled.has(event.card)) pulled.set(event.card, Date.parse(event.ts));', mentions: 1, reason: 'Record each card\'s first observed pull time.', line: 224 },
  { file: 'src/observation/report.mjs', text: '        answer.changes.push({ card, editedAt, editor, dispatches: by.map(({ dispatch, role }) => ({ dispatch, role })),', mentions: 2, reason: 'Attach the dispatch identities and roles associated with a card change.', line: 238 },
  { file: 'src/observation/report.mjs', text: '  const runs = [...byRun(events)].map(([run, recorded]) => ({', mentions: 1, reason: 'Compute L2 summaries separately for each recorded run.', line: 262 },
  { file: 'src/observation/report.mjs', text: '    run, hostFaults: { faults: recorded.filter(hostFault).length, claims: workClaims(recorded).length }, escalations: escalationsIn(recorded),', mentions: 1, reason: 'Return a run identifier with its host-fault and escalation summary.', line: 263 },
  { file: 'src/observation/report.mjs', text: '  return [...byRun(events)].map(([run, recorded]) => {', mentions: 1, reason: 'Build L3 interval and utilization summaries for each recorded run.', line: 289 },
  { file: 'src/observation/report.mjs', text: '      if (event.event === \'pull\') pulledAt.set(event.card, Date.parse(event.ts));', mentions: 1, reason: 'Track a pulled card\'s observed queue entry time.', line: 298 },
  { file: 'src/observation/report.mjs', text: '    const queue = l3.filter((event) => event.event === \'pull\').map(({ card, queueDepth }) => ({ card, queueDepth }));', mentions: 1, reason: 'Read the queue depth recorded by each L3 pull event.', line: 306 },
  { file: 'src/observation/report.mjs', text: '      run, from, to, releases, pulled, n, queue,', mentions: 2, reason: 'Return the recorded run identifier with its L3 interval figures.', line: 308 },
  { file: 'src/observation/report.mjs', text: '  return { runs: [...byRun(closes)].map(([run, recorded]) => ({ run, ...counts(recorded) })), stream: counts(closes) };', mentions: 2, reason: 'Count admission holds per run and over the complete stream.', line: 323 },
  { file: 'src/observation/report.mjs', text: '    if (event.layer !== \'L3\' || event.event !== \'dispatch\' || event.card == null || event.step !== undefined', mentions: 2, reason: 'Exclude provisioning-step dispatches from role tier-accuracy measurements.', line: 355 },
  { file: 'src/observation/report.mjs', text: '    runs: [...byRun(events)].map(([run, recorded]) => ({ run, rework: rework(recorded) })),', mentions: 2, reason: 'Return a run identifier beside its rework count.', line: 367 },
  { file: 'src/observation/report.mjs', text: '  if (typeof marker.dispatch !== \'string\' || marker.dispatch === \'\') return false;', mentions: 2, reason: 'Require a nonempty dispatch identity before accepting marker provenance.', line: 374 },
  { file: 'src/observation/report.mjs', text: '  const l3 = dispatches.get(marker.dispatch);', mentions: 1, reason: 'Find the L3 role dispatch claimed by a marker.', line: 375 },
  { file: 'src/observation/report.mjs', text: '  const l1 = starts.get(marker.dispatch);', mentions: 1, reason: 'Find the L1 start claimed by the same marker dispatch.', line: 376 },
  { file: 'src/observation/report.mjs', text: '    && l1?.facts?.pull === marker.pull && l1.facts.head === marker.head', mentions: 2, reason: 'Match the marker\'s pull request and head to its L1 start facts.', line: 378 },
  { file: 'src/observation/report.mjs', text: '  const dispatches = new Map(events.filter((event) => event.layer === \'L3\' && event.event === \'dispatch\').map((event) => [event.dispatch, event]));', mentions: 2, reason: 'Index L3 role-dispatch events by their dispatch identity.', line: 384 },
  { file: 'src/observation/report.mjs', text: '  const starts = new Map(events.filter((event) => event.layer === \'L1\' && event.event === \'dispatch.start\').map((event) => [event.dispatch, event]));', mentions: 1, reason: 'Index L1 start events by their dispatch identity.', line: 385 },
  { file: 'src/observation/report.mjs', text: '    const key = JSON.stringify([event.card, event.role, event.head, event.digest, event.evidence, event.dispatch, event.verdict, event.reason]);', mentions: 2, reason: 'Deduplicate markers using their dispatch identity and other authority fields.', line: 389 },
  { file: 'src/observation/report.mjs', text: '    if (typeof marker.dispatch !== \'string\' || marker.dispatch === \'\') continue;', mentions: 2, reason: 'Ignore a marker that carries no usable dispatch identity.', line: 394 },
  { file: 'src/observation/report.mjs', text: '    uses.set(marker.dispatch, (uses.get(marker.dispatch) ?? 0) + 1);', mentions: 2, reason: 'Count repeated uses of each marker dispatch identity.', line: 395 },
  { file: 'src/observation/report.mjs', text: '    .filter((marker) => (uses.get(marker.dispatch) ?? 0) > 1 || !wroteMarker(marker, dispatches, starts))', mentions: 1, reason: 'Reject repeated or uncorroborated marker dispatch identities.', line: 398 },
  { file: 'src/observation/report.mjs', text: '    .map(({ card, role, head, dispatch, reason }) => ({ card, role, head, dispatch, reason }));', mentions: 2, reason: 'Report refused markers with their role, dispatch and reason.', line: 399 },
  { file: 'src/observation/sink.mjs', text: 'const ENVELOPE = [\'ts\', \'run\', \'layer\', \'event\', \'card\', \'dispatch\'];', mentions: 2, reason: 'Define run as a required field in the local event envelope.', line: 19 },
  { file: 'src/observation/sink.mjs', text: 'export function openSink({ directory, run, now }) {', mentions: 1, reason: 'Receive the run identifier when opening an event sink.', line: 45 },
  { file: 'src/observation/sink.mjs', text: '  required(run, \'run\');', mentions: 2, reason: 'Refuse an event sink without its required run identifier.', line: 46 },
  { file: 'src/observation/sink.mjs', text: '  function emitter({ layer, card, dispatch }) {', mentions: 1, reason: 'Receive a dispatch identity when constructing a scoped event emitter.', line: 84 },
  { file: 'src/observation/sink.mjs', text: '          run,', mentions: 1, reason: 'Write the sink\'s run identifier into each event envelope.', line: 95 },
  { file: 'src/observation/sink.mjs', text: '          dispatch,', mentions: 1, reason: 'Carry that dispatch identity in every event written by the emitter.', line: 99 },
  { file: 'src/scheduling/admission.mjs', text: '  && typeof content.run === \'string\' && content.run !== \'\';', mentions: 2, reason: 'Validate a hold record\'s nonempty run identifier.', line: 53 },
  { file: 'src/scheduling/admission.mjs', text: 'export function admission({ directory, run, now, sink, ids = randomId, fs = nodeFs }) {', mentions: 1, reason: 'Receive the current run identifier for admission-record operations.', line: 92 },
  { file: 'src/scheduling/admission.mjs', text: '        const { reason, time, run: by } = found.content;', mentions: 1, reason: 'Read the run that wrote an existing admission closer.', line: 159 },
  { file: 'src/scheduling/admission.mjs', text: '        closers.push({ name: entry.name, path, ...named, reason, time, run: by });', mentions: 1, reason: 'Return the recorded closing run beside its reason and timestamp.', line: 160 },
  { file: 'src/scheduling/admission.mjs', text: '    const content = { reason, time: now(), run };', mentions: 1, reason: 'Write the current run into a newly created admission closer.', line: 197 },
  { file: 'src/scheduling/clock.mjs', text: 'export function clockWakes({ triggers, poll: interval } = {}, clock = {}, { fire, polled }, { armings = new Map(), started } = {}) {', mentions: 2, reason: 'Receive the scheduler\'s clock and polling fire callbacks.', line: 22 },
  { file: 'src/scheduling/lane.mjs', text: 'export function lane({ board, facts, l2, record, refused, removeDirectories, clock = {} }) {', mentions: 1, reason: 'Receive directory removal while constructing the serialized card lane.', line: 20 },
  { file: 'src/scheduling/lane.mjs', text: '    const fields = { pull: next.pull, head: next.head };', mentions: 2, reason: 'Scope the merge lane\'s observations to the selected pull request and head.', line: 52 },
  { file: 'src/scheduling/lane.mjs', text: '      throw refused(`card #${card.number}\'s merge of pull request #${next.pull} was not started, because the event sink refused to record its start`, refusal);', mentions: 1, reason: 'Describe the pull request whose merge-start event could not be recorded.', line: 56 },
  { file: 'src/scheduling/lane.mjs', text: '      ({ item, again, ended, failure } = reading);', mentions: 1, reason: 'Read the lane\'s settled ending record from its completed work.', line: 70 },
  { file: 'src/scheduling/lane.mjs', text: '          failure = new Error(`card #${card.number}\'s merge of pull request #${next.pull} was made, and the event sink refused to record it: ${unrecordedNamed(thrown)}`, { cause: thrown });', mentions: 1, reason: 'Describe a merge actually made before its event record was refused.', line: 95 },
  { file: 'src/scheduling/lane.mjs', text: '          ended = { ...named(thrown.made.answer), sha: thrown.made.answer.sha };', mentions: 2, reason: 'Retain the actual merge answer when an unrecorded write changed the forge.', line: 96 },
  { file: 'src/scheduling/lane.mjs', text: '          failure = new Error(`card #${card.number}\'s merge of pull request #${next.pull} failed: ${thrown.message}`, { cause: thrown });', mentions: 1, reason: 'Describe the selected pull request whose merge failed.', line: 98 },
  { file: 'src/scheduling/lane.mjs', text: '      const unrecorded = refused(`card #${card.number}\'s merge of pull request #${next.pull} ended ${ended.outcome}, and the event sink refused to record its end, so nothing more is done for it`, refusal);', mentions: 1, reason: 'Describe the merge ending whose event could not be recorded.', line: 109 },
  { file: 'src/scheduling/lane.mjs', text: '      const unchanged = again.action === \'merge\' && again.pull === next.pull && again.head === next.head;', mentions: 2, reason: 'Continue the merge lane only for the same pull request and head.', line: 135 },
  { file: 'src/scheduling/lane.mjs', text: '      if (again.pull !== undefined) details.push(`pull request #${again.pull}`);', mentions: 2, reason: 'Describe the replacement pull-request identity in a changed lane answer.', line: 137 },
  { file: 'src/scheduling/lane.mjs', text: '      if (again.judges !== undefined) details.push(`judges ${again.judges.map(({ role, facts }) => `${role} at ${facts.head}`).join(\', \')}`);', mentions: 2, reason: 'Describe the judge heads associated with an unmerged lane outcome.', line: 141 },
  { file: 'src/scheduling/lane.mjs', text: '        ? `L2 answered ${details.join(\' at \')}, after the lane pulled pull request #${next.pull} at head ${next.head}`', mentions: 1, reason: 'Explain a changed lane answer relative to the pull request already taken.', line: 143 },
  { file: 'src/scheduling/lane.mjs', text: '      return { item, again, ...(unchanged ? {} : { ended: { outcome: \'not merged\', action: again.action, reason } }), failure: null };', mentions: 1, reason: 'Record an unmerged lane ending when another action replaced its work.', line: 145 },
  { file: 'src/scheduling/lane.mjs', text: '      return { ended: { outcome: \'not merged\', reason: thrown.message }, failure };', mentions: 1, reason: 'Record an unmerged lane ending when its work threw.', line: 148 },
  { file: 'src/scheduling/loop.mjs', text: 'import { roleDispatch } from \'../execution/role.mjs\';', mentions: 1, reason: 'Import the reviewed role-preparation wrapper.', line: 10 },
  { file: 'src/scheduling/loop.mjs', text: 'import { dispatch as dispatchOnL1 } from \'../execution/run.mjs\';', mentions: 2, reason: 'Import L1\'s reviewed dispatch wrapper under its local layer name.', line: 13 },
  { file: 'src/scheduling/loop.mjs', text: 'import { stepDispatch } from \'../execution/step.mjs\';', mentions: 1, reason: 'Import the configured-step to shell-input adapter into L3.', line: 14 },
  { file: 'src/scheduling/loop.mjs', text: 'function noticeFailed({ step, cause, made, unrecorded }) {', mentions: 1, reason: 'Receive a failed notice operation for structured failure reporting.', line: 48 },
  { file: 'src/scheduling/loop.mjs', text: '  return { step: causeOf(step), cause: causeOf(cause), ...(made === undefined ? {} : { made, unrecorded }) };', mentions: 2, reason: 'Convert a failed notice operation and cause into recordable diagnostics.', line: 49 },
  { file: 'src/scheduling/loop.mjs', text: 'const noticeFailure = ({ id, step, cause, made, unrecorded }) => Object.assign(new Error(made === undefined', mentions: 1, reason: 'Construct an error for a failed notice operation.', line: 58 },
  { file: 'src/scheduling/loop.mjs', text: '  ? `the notice for hold ${id} failed to ${step}: ${cause}`', mentions: 1, reason: 'Explain a notice failure before any issue was made.', line: 59 },
  { file: 'src/scheduling/loop.mjs', text: '  : `the notice for hold ${id} made its step to ${step}, but the sink refused its record, so these events went unrecorded: ${eventsOf(unrecorded)}: ${cause}`), { notice: { id, step, cause, ...(made === undefined ? {} : { made, unrecorded }) } });', mentions: 2, reason: 'Explain partial notice completion with its recorded operation and cause.', line: 60 },
  { file: 'src/scheduling/loop.mjs', text: '    const judges = next.judges.filter((judge) => !memory.actions.has(`${card.number}:${judgeIdentity(judge)}`) && !memory.deferred.has(`${card.number}:${judgeIdentity(judge)}`));', mentions: 1, reason: 'Remove remembered or deferred judge work from the selected panel.', line: 71 },
  { file: 'src/scheduling/loop.mjs', text: '    next = judges.length === 0 ? { action: \'ignore\' } : { ...next, judges };', mentions: 1, reason: 'Ignore a card whose remaining judge panel is empty.', line: 72 },
  { file: 'src/scheduling/loop.mjs', text: 'function claiming({ config, board, facts, l2, sink, kill, readAdmission, follow, halted }) {', mentions: 1, reason: 'Receive the cleanup callback while constructing card claiming.', line: 180 },
  { file: 'src/scheduling/loop.mjs', text: '        record(\'trigger\', { trigger: \'pull\' });', mentions: 3, reason: 'Record a pull wake as the scheduling loop\'s trigger.', line: 294 },
  { file: 'src/scheduling/loop.mjs', text: '        record(\'pull\', { kind, queueDepth, inFlight }, card.number);', mentions: 1, reason: 'Record a card pull with its kind and queue state.', line: 327 },
  { file: 'src/scheduling/loop.mjs', text: '      return [\'dispatch\', \'judge\', \'continue\'].includes(next.action) ? l2.claimed(card, next) : undefined;', mentions: 1, reason: 'Notify L2 only for actions that can start maker or judge work.', line: 334 },
  { file: 'src/scheduling/loop.mjs', text: '  if (!named(event.run) || typeof event.layer !== \'string\' || !/^L[0-5]$/.test(event.layer) || !named(event.event)) return \'its envelope names no run, layer or event\';', mentions: 1, reason: 'Require a valid run field in a recorded event envelope.', line: 408 },
  { file: 'src/scheduling/loop.mjs', text: '  if (event.event === \'trigger\' && !named(event.trigger)) return \'it is a trigger naming no trigger\';', mentions: 2, reason: 'Validate the name of a recorded trigger event.', line: 409 },
  { file: 'src/scheduling/loop.mjs', text: '  const kind = event.event === \'trigger\' ? (event.trigger === \'clock\' ? \'clock\' : undefined)', mentions: 2, reason: 'Distinguish recorded clock triggers from ordinary pull triggers.', line: 410 },
  { file: 'src/scheduling/loop.mjs', text: '    if (event.event === \'trigger\' && event.trigger === \'clock\') of(event.name).starts.set(event.occurrence,', mentions: 2, reason: 'Retain each recorded clock trigger\'s occurrence start.', line: 439 },
  { file: 'src/scheduling/loop.mjs', text: 'export function loop({ config, board, decide, facts, l2, sink, kill, workspace, workspaceTip, judgeDirectory, escalationDirectory, removeDirectories, state, readRecord = () => [], environment, run, host, readTimeout, clock, drained }) {', mentions: 5, reason: 'Receive L3\'s engine environment and recorded run identifier.', line: 543 },
  { file: 'src/scheduling/loop.mjs', text: '  const { concurrency, claims, killed, record, refused, take, start, release } = claiming({ config, board, facts, l2, sink, kill, readAdmission: () => admissionRecord.read(), follow: () => follow(), halted: () => unsaved !== undefined });', mentions: 1, reason: 'Pass recorded cleanup into the card-claiming component.', line: 545 },
  { file: 'src/scheduling/loop.mjs', text: '  const { merge } = lane({ board, facts, l2: laneL2, record, refused, removeDirectories, clock });', mentions: 1, reason: 'Pass the directory-removal callback into the card\'s serialized lane.', line: 560 },
  { file: 'src/scheduling/loop.mjs', text: '  if (environment === null || typeof environment !== \'object\') throw new Error(`L3 was handed no environment for the dispatches it makes, so it cannot dispatch: the environment is ${environment === null ? \'null\' : typeof environment}`);', mentions: 4, reason: 'Refuse L3 construction without an object environment for real dispatch.', line: 567 },
  { file: 'src/scheduling/loop.mjs', text: '  if (typeof run !== \'string\' || run === \'\') throw new Error(`L3 was handed no run id, so it cannot record a hold\'s closer: the run id is ${JSON.stringify(run) ?? \'undefined\'}`);', mentions: 3, reason: 'Refuse L3 construction without a nonempty recorded run identifier.', line: 568 },
  { file: 'src/scheduling/loop.mjs', text: '  admissionRecord = admission({ directory: state, run, now, sink });', mentions: 1, reason: 'Bind admission operations to L3\'s current run and sink.', line: 569 },
  { file: 'src/scheduling/loop.mjs', text: '  const dispatchStep = async (card, step, path, fields) => {', mentions: 2, reason: 'Receive the configured step and workspace in L3\'s step helper.', line: 614 },
  { file: 'src/scheduling/loop.mjs', text: '      sink.emitter({ layer: \'L3\', card: card.number, dispatch: id }).emit(\'dispatch\', { step: step.name, ...fields });', mentions: 4, reason: 'Record a configured step\'s named start before calling L1.', line: 617 },
  { file: 'src/scheduling/loop.mjs', text: '      throw refusedStart(`card #${card.number}\'s step \\`${step.name}\\` was not started, because the event sink refused to record its start`, refusal);', mentions: 1, reason: 'Refuse a configured step start when its event could not be recorded.', line: 619 },
  { file: 'src/scheduling/loop.mjs', text: '    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);', mentions: 4, reason: 'Adapt the configured step and engine environment before the real L1 handoff.', line: 621, programs: ['claude', 'codex', '/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '    return { ...outcome, dispatch: id };', mentions: 1, reason: 'Return the configured-step dispatch identity with its settled outcome.', line: 622 },
  { file: 'src/scheduling/loop.mjs', text: '  const dispatchRole = async (card, answer, { cwd, directory, reach, scratch, repository, maker }, fields, stamp = (given) => given) => {', mentions: 1, reason: 'Declare the role preparation and L1 dispatch wrapper.', line: 640 },
  { file: 'src/scheduling/loop.mjs', text: '      sink.emitter({ layer: \'L3\', card: card.number, dispatch: id }).emit(\'dispatch\', { role: answer.role, tier: answer.tier, ...fields });', mentions: 2, reason: 'Record the role dispatch\'s L3 start with its prepared fields.', line: 643 },
  { file: 'src/scheduling/loop.mjs', text: '    const run = async () => {', mentions: 1, reason: 'Define the bounded role-start closure used by L3 dispatch.', line: 647 },
  { file: 'src/scheduling/loop.mjs', text: '      const handed = await roleDispatch({ answer: stamp(answer, id), cwd, directory, scratch, repository, reach, maker, env: environment, sink, id, card: card.number });', mentions: 4, reason: 'Prepare the selected role with L3\'s inherited engine environment.', line: 648, programs: ['git', 'codex'] },
  { file: 'src/scheduling/loop.mjs', text: '      return dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...handed });', mentions: 1, reason: 'Forward the prepared role invocation to L1\'s reviewed dispatch wrapper.', line: 649, programs: ['claude', 'codex', '/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '    const [outcome] = await Promise.allSettled([run()]);', mentions: 1, reason: 'Settle the role-start closure without losing its rejection outcome.', line: 651, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '    return { ...outcome, dispatch: id };', mentions: 1, reason: 'Return the role dispatch identity with its settled outcome.', line: 654 },
  { file: 'src/scheduling/loop.mjs', text: '    noticing = noticing.then(() => noticed(id, hold, issueState)).catch((thrown) => ({ failed: { step: \'notice\', cause: causeOf(thrown) } }));', mentions: 1, reason: 'Preserve a failed asynchronous hold-notice operation as diagnostic data.', line: 707 },
  { file: 'src/scheduling/loop.mjs', text: '      return { failed: { step: \'notice\', cause: causeOf(thrown) }, unrecorded };', mentions: 1, reason: 'Return an unrecorded hold-notice failure with its operation name.', line: 755 },
  { file: 'src/scheduling/loop.mjs', text: '        const failed = { step: `read issue #${issue}\'s state`, cause: failure };', mentions: 1, reason: 'Attribute a failed hold-state read to that local notice operation.', line: 797 },
  { file: 'src/scheduling/loop.mjs', text: '    return { answer: answerFrom(decide, card, [], { attempt: number, firstFailure, workspace: outcome, continuing }) };', mentions: 2, reason: 'Pass the attempt ordinal into the post-workspace policy decision.', line: 835 },
  { file: 'src/scheduling/loop.mjs', text: '  const attempt = async (card, next, kept, remember, placed, scope) => {', mentions: 1, reason: 'Declare the reviewed configured-step and maker-attempt wrapper.', line: 869 },
  { file: 'src/scheduling/loop.mjs', text: '      if (answer.action === \'again\' && answer.attempt === number + 1) {', mentions: 1, reason: 'Accept a retry decision only for the next attempt ordinal.', line: 889 },
  { file: 'src/scheduling/loop.mjs', text: '      const { path, branch, scratch, repository, answer: unmade } = await made(card, number, continuing, failures[0]);', mentions: 1, reason: 'Take the policy answer returned by maker-workspace preparation.', line: 905 },
  { file: 'src/scheduling/loop.mjs', text: '        if (number > 1 || continuing !== undefined) answer = askAttempt([], { attempt: number });', mentions: 1, reason: 'Request a policy decision for a continuing or retried attempt.', line: 909 },
  { file: 'src/scheduling/loop.mjs', text: '        while (answer.action === \'dispatch\' && answer.step !== undefined) {', mentions: 2, reason: 'Continue a provisioning attempt only while L2 supplies a configured step.', line: 911 },
  { file: 'src/scheduling/loop.mjs', text: '          outcomes.push(await dispatchStep(card, answer.step, path, { attempt: number }));', mentions: 3, reason: 'Dispatch the exact configured step L2 placed on the attempt answer.', line: 912, programs: ['/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '          answer = askAttempt([...outcomes], { attempt: number });', mentions: 1, reason: 'Request a policy decision using this attempt\'s configured-step outcomes.', line: 913 },
  { file: 'src/scheduling/loop.mjs', text: '      if (answer.action !== \'dispatch\') {', mentions: 1, reason: 'Stop the attempt when policy did not select a maker dispatch.', line: 918 },
  { file: 'src/scheduling/loop.mjs', text: '      const outcome = await dispatchRole(card, answer.maker, { cwd: path, directory: path, reach: [], scratch, repository, maker: true }, { attempt: number }, (given, id) => {', mentions: 2, reason: 'Prepare the maker role with this attempt\'s ordinal and continuing workspace.', line: 922, programs: ['git', 'claude', 'codex', '/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '      const settling = (options) => Promise.allSettled([l2.settled(card, outcome, { dispatch, placed, ...options })]);', mentions: 1, reason: 'Settle the card\'s policy outcome under its dispatch identity.', line: 933 },
  { file: 'src/scheduling/loop.mjs', text: '          expectedHead = await workspaceTip({ card: card.number, dispatch, path, branch, repository });', mentions: 1, reason: 'Read the maker workspace tip under the same dispatch identity.', line: 941 },
  { file: 'src/scheduling/loop.mjs', text: '          ...(exitedZero ? { tip: expectedHead, tipUnread: tipFailure, workspace: path } : {}) });', mentions: 1, reason: 'Carry the verified maker tip only after a successful process exit.', line: 965 },
  { file: 'src/scheduling/loop.mjs', text: '              roleOutcome = await dispatchRole(card, routed.role, {', mentions: 1, reason: 'Run the selected escalation role through the reviewed role wrapper.', line: 991, programs: ['git', 'claude', 'codex', '/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '            const ended = await l2.roleSettled(card, escalation, roleOutcome, { dispatch: roleId, firstFailure });', mentions: 1, reason: 'Settle an escalation role under that role\'s dispatch identity.', line: 995 },
  { file: 'src/scheduling/loop.mjs', text: '        answer = askAttempt([], { attempt: number, maker: outcome });', mentions: 1, reason: 'Request the next retry decision after a maker outcome.', line: 1014 },
  { file: 'src/scheduling/loop.mjs', text: '      const reached = { card: card.number, workspace: path, outcome, settled, ...(continuing === undefined ? {} : { action: \'continue\', pull: continuing.pull, head: continuing.head }) };', mentions: 2, reason: 'Carry the existing pull request and head into a continuing maker outcome.', line: 1018 },
  { file: 'src/scheduling/loop.mjs', text: '      return { ...reached, judges: await judges(card, judging, ask, (ended) => kept({ ...reached, judges: ended }), remember, placed, scope) };', mentions: 3, reason: 'Return settled judge results while retaining each intermediate panel outcome.', line: 1034, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '  const named = (answer, role) => (answer.action === \'judge\' ? answer.judges.find((judge) => judge.role === role) : undefined);', mentions: 1, reason: 'Find the selected role within a judge policy answer.', line: 1042 },
  { file: 'src/scheduling/loop.mjs', text: '  const judgeWork = async (card, judge, ask, scope) => {', mentions: 1, reason: 'Declare the reviewed judge-role work wrapper.', line: 1067 },
  { file: 'src/scheduling/loop.mjs', text: '      const step = current.steps[outcomes.length];', mentions: 1, reason: 'Select the next step from the current judge\'s configured step sequence.', line: 1084 },
  { file: 'src/scheduling/loop.mjs', text: '      outcomes.push(await dispatchStep(card, step, head, { role }));', mentions: 2, reason: 'Dispatch the selected judge provisioning step in its checked head directory.', line: 1085, programs: ['/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '      const answer = ask({ judged: { [role]: [...outcomes] } });', mentions: 1, reason: 'Pass the current judge outcomes into the next policy decision.', line: 1086 },
  { file: 'src/scheduling/loop.mjs', text: '      if (current === undefined) return { role, withheld: { step: step.name, outcome: outcomes.at(-1) }, decision: answer };', mentions: 2, reason: 'Record which configured judge step was withheld after a changed decision.', line: 1088 },
  { file: 'src/scheduling/loop.mjs', text: '    const outcome = await dispatchRole(card, current, { cwd: main, directory: path, reach: [head], scratch, repository }, {}, dispatched);', mentions: 1, reason: 'Run a selected judge through the reviewed role wrapper.', line: 1090, programs: ['git', 'claude', 'codex', '/bin/sh'] },
  { file: 'src/scheduling/loop.mjs', text: '  const judged = async (card, judge, ask, scope) => {', mentions: 1, reason: 'Declare the wrapper that owns one judge\'s work and cleanup.', line: 1109 },
  { file: 'src/scheduling/loop.mjs', text: '      return await judgeWork(card, judge, ask, scope);', mentions: 1, reason: 'Run one judge\'s work through the reviewed role-work wrapper.', line: 1111, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '  const judges = async (card, answer, ask, keep, remember, placed, scope) => {', mentions: 1, reason: 'Declare the wrapper that settles the selected judge panel.', line: 1141 },
  { file: 'src/scheduling/loop.mjs', text: '    const settled = await Promise.allSettled(answer.judges.map((judge) => judged(card, judge, ask, scope)));', mentions: 2, reason: 'Settle the selected judges through their reviewed work wrapper.', line: 1142, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '      [settled[at]] = await Promise.allSettled([judged(card, judge, repeat, scope)]);', mentions: 1, reason: 'Repeat the selected judge through that same reviewed wrapper.', line: 1154, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '    remember(ask({ judged: Object.fromEntries(settled.map((each, at) => [answer.judges[at].role, { decision: each.status === \'fulfilled\' ? each.value.decision : undefined }])) }));', mentions: 2, reason: 'Remember each judge role\'s settled decision for the next policy step.', line: 1157 },
  { file: 'src/scheduling/loop.mjs', text: '      : { role: answer.judges[at].role, failure: noOutcome(`card #${card.number}\'s judge \\`${answer.judges[at].role}\\` handed back no outcome`, each.reason) }));', mentions: 2, reason: 'Describe a judge role that returned no usable outcome.', line: 1161 },
  { file: 'src/scheduling/loop.mjs', text: '  const work = async (claim, freed, setAsides) => {', mentions: 1, reason: 'Declare the wrapper that owns an admitted card\'s active work.', line: 1206 },
  { file: 'src/scheduling/loop.mjs', text: '      if (next.action === \'remove\') {', mentions: 1, reason: 'Handle an admitted directory-removal action before new work.', line: 1231 },
  { file: 'src/scheduling/loop.mjs', text: '        if ([\'dispatch\', \'judge\', \'continue\'].includes(next.action)) {', mentions: 1, reason: 'Admit only maker, judge or continuation actions to claiming.', line: 1239 },
  { file: 'src/scheduling/loop.mjs', text: '        reached = { card: card.number, action: \'return\', pull: next.pull };', mentions: 2, reason: 'Carry the selected pull request into a returned-card outcome.', line: 1252 },
  { file: 'src/scheduling/loop.mjs', text: '          ? { card: card.number, judges: await judges(card, next, (options) => answerFrom(atPull, card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember, placed, scope) }', mentions: 3, reason: 'Run the selected judges through the reviewed panel wrapper.', line: 1262, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '          : await attempt(card, next, kept, remember, placed, scope);', mentions: 1, reason: 'Run the admitted maker or configured-step attempt through its wrapper.', line: 1263, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '  const trigger = async (freed = () => {}, limit = undefined, setAsides, settlePending = () => {}, { taken = () => {}, poll = false, carry = false, memory, drained } = {}) => {', mentions: 1, reason: 'Declare one scheduling trigger\'s admitted card-work wrapper.', line: 1348 },
  { file: 'src/scheduling/loop.mjs', text: '        record(\'trigger\', { trigger: \'drain\' });', mentions: 2, reason: 'Record a scheduling drain trigger after its pulls settle.', line: 1367 },
  { file: 'src/scheduling/loop.mjs', text: '    const worked = await Promise.allSettled(claimed.map((claim) => (claim.next.action === \'merge\' ? merged(claim, setAsides) : work(claim, freed, setAsides))));', mentions: 1, reason: 'Settle each admitted card through its reviewed work or merge path.', line: 1374, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '    pull: async (limit) => {', mentions: 1, reason: 'Expose the loop\'s admitted pull operation.', line: 1394 },
  { file: 'src/scheduling/loop.mjs', text: '      return trigger(() => {}, limit);', mentions: 1, reason: 'Run one admitted trigger through its reviewed work wrapper.', line: 1396, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '    run: async ({ handOver = () => {}, stop } = {}) => {', mentions: 1, reason: 'Expose L3\'s continuous run operation to the CLI.', line: 1435 },
  { file: 'src/scheduling/loop.mjs', text: '        try { record(\'trigger\', { trigger: \'clock\', name, occurrence: at, ...(after === undefined ? {} : { after }) }); }', mentions: 2, reason: 'Record the selected clock job\'s trigger occurrence.', line: 1573 },
  { file: 'src/scheduling/loop.mjs', text: '      const fire = (polling) => trigger(() => (kept && ending() ? undefined : fire()), undefined, setAsides, settlePending, { ...polling, carry: true, memory, ...(kept && drained !== undefined && { drained: drain }) }).then((each) => {', mentions: 3, reason: 'Run polling work through the reviewed scheduling trigger wrapper.', line: 1609, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '        await fire();', mentions: 1, reason: 'Fire the admitted scheduling work before settling its wake.', line: 1645, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '      const pulled = (polling) => {', mentions: 1, reason: 'Declare the polling pull callback that fires admitted scheduling work.', line: 1666 },
  { file: 'src/scheduling/loop.mjs', text: '        return fire(polling).then(settled);', mentions: 1, reason: 'Fire admitted polling work before settling its wake.', line: 1668, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '      const polled = () => new Promise((resolve) => {', mentions: 1, reason: 'Declare the polling wake wrapper that owns admitted pull work.', line: 1671 },
  { file: 'src/scheduling/loop.mjs', text: '        pulled({ poll: true, taken: (count) => {', mentions: 1, reason: 'Run the initial polling pull while recording how much work it takes.', line: 1673, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/loop.mjs', text: '      const wakes = clockWakes(config.clock, clock, { fire: fireOccurrence, polled }, atStart);', mentions: 2, reason: 'Pass clock and polling callbacks into the clock-wake scheduler.', line: 1682 },
  { file: 'src/scheduling/loop.mjs', text: '        stop?.addEventListener(\'abort\', stopped, { once: true });', mentions: 1, reason: 'Remove the abort listener after its first notification.', line: 1689 },
  { file: 'src/scheduling/loop.mjs', text: '        if (!ending()) pulled().then((going) => { if (going) wakes.poll(); });', mentions: 1, reason: 'Run an initial admitted pull and arm polling only while work remains.', line: 1692, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', '/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof', 'launchctl'] },
  { file: 'src/scheduling/pull-order.mjs', text: '    if (next.action === \'dispatch\') pulls.push({ card, kind: next.kind, redo });', mentions: 1, reason: 'Order actions that select a maker dispatch for claiming.', line: 37 },
  { file: 'src/scheduling/pull-order.mjs', text: '    if (next.action === \'judge\') pulls.push({ card, kind: next.kind, redo, judges: next.judges.map((judge) => judge.role) });', mentions: 2, reason: 'Order selected judge panels for claiming.', line: 38 },
  { file: 'src/scheduling/pull-order.mjs', text: '    if ([\'move\', \'continue\', \'return\', \'escalate\', \'merge\', \'remove\'].includes(next.action)) pulls.push({ card, redo, ...next });', mentions: 1, reason: 'Order admitted move, continuation, return, escalation, merge and removal actions.', line: 39 },
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
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (branch) => `the pull requests from branch ${branch}`,', mentions: 1, reason: 'Describe a pull-request read by its selected branch.', line: 582 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (names) => `the branches ${names.join(\', \')}`,', mentions: 1, reason: 'Describe the branches whose forge state is being read.', line: 600 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `pull request #${number}\'s diff`,', mentions: 1, reason: 'Describe the selected pull request\'s diff read.', line: 612 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `pull request #${number}\'s merge base`,', mentions: 1, reason: 'Describe the selected pull request\'s merge-base read.', line: 621 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `pull request #${number}\'s mergeability`,', mentions: 1, reason: 'Describe the selected pull request\'s mergeability read.', line: 633 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `pull request #${number}\'s comments`,', mentions: 1, reason: 'Describe the selected pull request\'s comment read.', line: 644 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `issue #${number}\'s comments`,', mentions: 1, reason: 'Describe the selected issue\'s comment read.', line: 653 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: () => \'the default branch\',', mentions: 1, reason: 'Describe the repository default-branch read.', line: 665 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `issue #${number}`,', mentions: 1, reason: 'Describe the selected issue read.', line: 681 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `issue #${number}\'s body history`,', mentions: 1, reason: 'Describe the selected issue\'s body-history read.', line: 716 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `issue #${number}\'s timeline`,', mentions: 1, reason: 'Describe the selected issue\'s timeline read.', line: 745 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (label) => `the open issues labelled ${label}`,', mentions: 1, reason: 'Describe the labelled open-issue read.', line: 765 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: () => \'the newest issue or pull request\',', mentions: 1, reason: 'Describe the newest issue or pull-request read.', line: 776 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: () => \'the visibility\',', mentions: 1, reason: 'Describe the repository-visibility read.', line: 787 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: () => \'the Actions event policies\',', mentions: 1, reason: 'Describe the Actions event-policy read.', line: 804 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (login) => `${login}\'s permission`,', mentions: 1, reason: 'Describe the selected account\'s repository-permission read.', line: 819 },
  { file: 'src/substrate/forge/read.mjs', text: '    reading: (number) => `pull request #${number}`,', mentions: 1, reason: 'Describe the selected pull-request read.', line: 830 },
  { file: 'src/substrate/forge/read.mjs', text: '  const reads = Object.fromEntries(Object.entries(REPOSITORY_READS).map(([operation, { reading: what, read }]) => [', mentions: 1, reason: 'Take each repository read\'s human-readable operation description.', line: 918 },
  { file: 'src/substrate/forge/read.mjs', text: '    return labelled(\'readEnvironment\', board, addressed, () => environment(board, via, name, addressed));', mentions: 1, reason: 'Expose the forge-environment read through the repository read runner.', line: 935 },
  { file: 'src/substrate/forge/repository-write.mjs', text: '          throw Object.assign(new Error(`openIssue created issue #${opened.number} without label ${missing.join(\', \')}`), { made: { answer: opened.number } });', mentions: 1, reason: 'Retain the actual created issue number when its required label is missing.', line: 135 },
  { file: 'src/substrate/forge/runners.mjs', text: 'import { gitEnvironment } from \'../git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for forge tool execution.', line: 4 },
  { file: 'src/substrate/forge/runners.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'../process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for authenticated gh operations.', line: 5 },
  { file: 'src/substrate/forge/runners.mjs', text: 'async function throughL0(command, args, { emitter, timeout, side }) {', mentions: 2, reason: 'Receive the reviewed forge command and arguments for a bounded L0 call.', line: 32 },
  { file: 'src/substrate/forge/runners.mjs', text: '    result = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Execute gh with a copied engine environment through the sole L0 starter.', line: 36, programs: ['gh'] },
  { file: 'src/substrate/forge/runners.mjs', text: 'export async function readRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {', mentions: 1, reason: 'Default the read-only forge runner to the reviewed gh process wrapper.', line: 163 },
  { file: 'src/substrate/forge/runners.mjs', text: 'export async function schemaWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {', mentions: 1, reason: 'Default the schema-write forge runner to the reviewed gh process wrapper.', line: 398 },
  { file: 'src/substrate/forge/runners.mjs', text: 'export async function itemWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {', mentions: 1, reason: 'Default the item-write forge runner to the reviewed gh process wrapper.', line: 471 },
  { file: 'src/substrate/forge/runners.mjs', text: 'export async function repositoryWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {', mentions: 1, reason: 'Default the repository-write runner to the reviewed gh process wrapper.', line: 487 },
  { file: 'src/substrate/forge/write-made.mjs', text: '        failure.made = { answer: check({ status: exit, timedOut, stdout: String(stdout), stderr: String(stderr) }) };', mentions: 1, reason: 'Retain the parsed actual answer of a successful write whose event was refused.', line: 22 },
  { file: 'src/substrate/git-environment.mjs', text: 'export function gitEnvironment(from = process.env) {', mentions: 2, reason: 'Define the account-environment copier with process.env as its default input.', line: 48 },
  { file: 'src/substrate/git-environment.mjs', text: '  const env = {};', mentions: 1, reason: 'Create the destination environment object without inherited properties.', line: 49 },
  { file: 'src/substrate/git-environment.mjs', text: '    if (!REMOVED.has(name.toUpperCase())) env[name] = value;', mentions: 1, reason: 'Copy each account value except a named git redirection variable.', line: 51 },
  { file: 'src/substrate/git-environment.mjs', text: '  return env;', mentions: 1, reason: 'Return the copied repository-safe environment.', line: 53 },
  { file: 'src/substrate/host.mjs', text: 'import * as childProcess from \'node:child_process\';', mentions: 2, reason: 'Confine the native child-process namespace import to the real host module.', line: 3 },
  { file: 'src/substrate/host.mjs', text: '  ps: process.platform === \'linux\' ? fileURLToPath(new URL(\'./process-table.sh\', import.meta.url)) : \'/bin/ps\',', mentions: 2, reason: 'Select local ps or the packaged Linux process-table shim via a file URL.', line: 9 },
  { file: 'src/substrate/host.mjs', text: '  lsof: process.platform === \'linux\' ? \'/usr/bin/lsof\' : \'/usr/sbin/lsof\',', mentions: 1, reason: 'Select the platform\'s local cwd census executable.', line: 10 },
  { file: 'src/substrate/host.mjs', text: '  get execFile() { return childProcess.execFile; },', mentions: 3, reason: 'Expose the native execFile reader through the real host getter.', line: 11 },
  { file: 'src/substrate/host.mjs', text: '  get spawn() { return childProcess.spawn; },', mentions: 3, reason: 'Expose the native asynchronous starter through the real host getter.', line: 12 },
  { file: 'src/substrate/host.mjs', text: '  get spawnSync() { return childProcess.spawnSync; },', mentions: 3, reason: 'Expose the native synchronous starter through the real host getter.', line: 13 },
  { file: 'src/substrate/host.mjs', text: '  killChild: (child, name) => child.kill(name),', mentions: 2, reason: 'Signal a child handle through its native kill member; the name is conservatively protected.', line: 14, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/host.mjs', text: '  signal: (target, name) => process.kill(target, name),', mentions: 2, reason: 'Signal a recorded local pid or group through the allowed process.kill operation.', line: 20, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/launchd.mjs', text: 'import { runCommand } from \'./process.mjs\';', mentions: 1, reason: 'Import the L0 starter for the local launchd loaded-job read.', line: 5 },
  { file: 'src/substrate/launchd.mjs', text: 'import { gitEnvironment } from \'./git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for that launchd read.', line: 6 },
  { file: 'src/substrate/launchd.mjs', text: 'export async function loadedJob(label, { uid = process.getuid(), emitter, timeout = FORGE_TIMEOUT, run = runCommand } = {}) {', mentions: 2, reason: 'Accept a loaded-job query with L0 as its default starter.', line: 10 },
  { file: 'src/substrate/launchd.mjs', text: '  const result = await run({ command: \'launchctl\', args: [\'print\', `gui/${uid}/${label}`],', mentions: 2, reason: 'Query the local per-user launchd domain with launchctl print.', line: 11, programs: ['launchctl'] },
  { file: 'src/substrate/launchd.mjs', text: '    cwd: process.cwd(), env: gitEnvironment(), emitter, timeout });', mentions: 2, reason: 'Give launchctl the current working directory and copied account environment.', line: 12 },
  { file: 'src/substrate/process.mjs', text: 'import { once } from \'node:events\';', mentions: 1, reason: 'Import the independent node:events promise helper, not the CLI once wrapper.', line: 8 },
  { file: 'src/substrate/process.mjs', text: 'export const PS = realHost.ps;', mentions: 2, reason: 'Export the real host\'s process-table program as the default reader.', line: 27 },
  { file: 'src/substrate/process.mjs', text: 'const PS_ENV = { LC_ALL: \'C.UTF-8\', TZ: \'UTC0\' };', mentions: 1, reason: 'Fix local process-table reads to the declared locale and time zone.', line: 33 },
  { file: 'src/substrate/process.mjs', text: 'export function atExit(step) {', mentions: 1, reason: 'Register a local cleanup callback for engine exit.', line: 206 },
  { file: 'src/substrate/process.mjs', text: '  steps.push(step);', mentions: 1, reason: 'Retain the registered cleanup callback for exit processing.', line: 207 },
  { file: 'src/substrate/process.mjs', text: '  process.on(\'exit\', cleanup);', mentions: 1, reason: 'Register the reviewed containment cleanup on engine exit.', line: 226 },
  { file: 'src/substrate/process.mjs', text: '  for (const name of HANDLED) process.prependListener(name, onSignal);', mentions: 1, reason: 'Register the reviewed signal-cleanup handler for each handled signal.', line: 227 },
  { file: 'src/substrate/process.mjs', text: '  if (!listeners.includes(onSignal) || listeners[0] === onSignal) return;', mentions: 2, reason: 'Leave an already correctly ordered signal-cleanup handler unchanged.', line: 236 },
  { file: 'src/substrate/process.mjs', text: '  process.prependListener(name, onSignal);', mentions: 1, reason: 'Put the reviewed cleanup handler before other signal listeners.', line: 238 },
  { file: 'src/substrate/process.mjs', text: '  process.removeListener(name, onSignal);', mentions: 1, reason: 'Remove the duplicate cleanup handler after reordering it.', line: 239 },
  { file: 'src/substrate/process.mjs', text: 'function onSignal(name) {', mentions: 1, reason: 'Declare the signal entry point that performs recorded exit cleanup.', line: 252 },
  { file: 'src/substrate/process.mjs', text: '  cleanup();', mentions: 1, reason: 'Perform containment cleanup before restoring the engine\'s signal handling.', line: 253, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  process.removeListener(name, onSignal);', mentions: 1, reason: 'Remove the current signal handler before forwarding normal signal behavior.', line: 254 },
  { file: 'src/substrate/process.mjs', text: '  if (process.listenerCount(name) === 0) realHost.signal(process.pid, name);', mentions: 1, reason: 'Restore default signal behavior by signalling the local engine only when no listener remains.', line: 255, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  else setImmediate(() => process.listeners(name).includes(onSignal) || process.prependListener(name, onSignal));', mentions: 2, reason: 'Restore the reviewed cleanup handler where another listener remains.', line: 256 },
  { file: 'src/substrate/process.mjs', text: 'function cleanup() {', mentions: 1, reason: 'Declare the synchronous exit-containment wrapper.', line: 277 },
  { file: 'src/substrate/process.mjs', text: '  for (const [read, host] of reads) host.killChild(read, \'SIGKILL\');', mentions: 1, reason: 'End active local reader children during synchronous engine cleanup.', line: 278, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '      ended.push([group, call, call.contained ? {} : now - began < EXIT_CARE_BOUND ? endedNow(group, call) : killedBare(group, call)]);', mentions: 1, reason: 'Collect bounded synchronous containment results for each exiting dispatch.', line: 288, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  for (const step of steps) attempt(step);', mentions: 2, reason: 'Attempt each registered cleanup callback on engine exit.', line: 294 },
  { file: 'src/substrate/process.mjs', text: 'function killedBare(group, { kill }) {', mentions: 1, reason: 'Receive the dispatch\'s signal operation for a group left outside the exit-care bound.', line: 304 },
  { file: 'src/substrate/process.mjs', text: 'function attempt(step) {', mentions: 1, reason: 'Define the cleanup-callback refusal boundary.', line: 341 },
  { file: 'src/substrate/process.mjs', text: '    step();', mentions: 1, reason: 'Execute the selected local cleanup callback within that refusal boundary.', line: 343 },
  { file: 'src/substrate/process.mjs', text: 'const SIGNAL = realHost.signal;', mentions: 1, reason: 'Take the real host\'s local signal operation as the default containment signal.', line: 389 },
  { file: 'src/substrate/process.mjs', text: 'async function ended(group, { ps, readTimeout, kill, host }, bound, listed) {', mentions: 3, reason: 'Receive the process-table reader for group-exit confirmation.', line: 434 },
  { file: 'src/substrate/process.mjs', text: '      rows = rowsOf(await run(ps, [\'-g\', String(group), \'-o\', \'pid=,stat=\'], readTimeout, readTimeout, host));', mentions: 2, reason: 'Read the local process group\'s membership through the bounded process reader.', line: 454, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    return { named: [...named, ...late], left, listed };', mentions: 1, reason: 'Return the observed membership list with a group\'s census result.', line: 605 },
  { file: 'src/substrate/process.mjs', text: '      const lines = yield* column(\'command\');', mentions: 1, reason: 'Read the local lsof command column for the directory census.', line: 796 },
  { file: 'src/substrate/process.mjs', text: '      const commands = yield* column(\'command\');', mentions: 1, reason: 'Read the second command column needed to validate the lsof census separator.', line: 798 },
  { file: 'src/substrate/process.mjs', text: 'async function reading(looks, ps, timeout, deadline, trace, host = realHost) {', mentions: 2, reason: 'Receive the process-table program for asynchronous generator reads.', line: 878 },
  { file: 'src/substrate/process.mjs', text: '        printed = await run(...toolOf(look.value, ps), deadline - host.clock.now(), timeout, host);', mentions: 2, reason: 'Execute the chosen local ps or lsof read within its remaining deadline.', line: 893, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'const toolOf = (read, ps) => (Array.isArray(read) ? [ps, read] : [read.tool, read.args]);', mentions: 3, reason: 'Choose the default process-table program or the generator\'s explicitly named local tool.', line: 907 },
  { file: 'src/substrate/process.mjs', text: 'function readingNow(looks, ps, timeout, deadline, now = realHost.clock.now, spawn = realHost.spawnSync) {', mentions: 4, reason: 'Accept a synchronous local process-table starter for bounded read retries.', line: 910 },
  { file: 'src/substrate/process.mjs', text: '      printed = runNow(...toolOf(look.value, ps), deadline - now(), timeout, now, spawn);', mentions: 3, reason: 'Forward that synchronous starter into the bounded local read.', line: 920, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'const exited = (tool, args, status) => new Error(`${tool} ${args.join(\' \')} ended with ${status}`);', mentions: 2, reason: 'Describe a failed local read by its program, arguments and exit status.', line: 952 },
  { file: 'src/substrate/process.mjs', text: 'function run(ps, args, remaining, timeout, host = realHost) {', mentions: 2, reason: 'Define the asynchronous local ps or lsof program reader.', line: 980 },
  { file: 'src/substrate/process.mjs', text: '    const read = host.execFile(ps, args, { env: PS_ENV, ...reader(remaining), timeout: 0 }, (error, stdout, stderr) => {', mentions: 4, reason: 'Run only the named local process reader with its fixed minimal environment.', line: 984, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '      if (error && !(error.code === 1 && stdout === \'\')) return reject(typeof error.code === \'number\' || error.signal ? exited(ps, args, error.code ?? error.signal) : error);', mentions: 3, reason: 'Attribute a nonempty failed read to its selected local program and arguments.', line: 989 },
  { file: 'src/substrate/process.mjs', text: '      host.killChild(read, \'SIGKILL\');', mentions: 1, reason: 'End the local read child when its reader deadline expires.', line: 994, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function runNow(ps, args, remaining, timeout, now = realHost.clock.now, spawn = realHost.spawnSync) {', mentions: 4, reason: 'Accept a synchronous local-reader starter with the real host as default.', line: 1008 },
  { file: 'src/substrate/process.mjs', text: '    const printed = runOnce(ps, args, remaining, timeout, spawn);', mentions: 3, reason: 'Forward the selected starter to one bounded synchronous read attempt.', line: 1011, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function runOnce(ps, args, remaining, timeout, spawn = realHost.spawnSync) {', mentions: 4, reason: 'Define one synchronous local-reader attempt with the real host as default.', line: 1021 },
  { file: 'src/substrate/process.mjs', text: '  if (unanswered.has(ps)) throw new Error(`${timedOut(unanswered.get(ps)).message} earlier in the exit cleanup, which does not wait on it again`);', mentions: 2, reason: 'Refuse another synchronous read from a process-table program that already timed out.', line: 1023 },
  { file: 'src/substrate/process.mjs', text: '  const { error, status, signal: ending, stdout, stderr } = spawn(ps, args, { env: PS_ENV, ...reader(remaining) });', mentions: 5, reason: 'Start the local ps or lsof reader with its fixed minimal environment and bound.', line: 1024, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    unanswered.set(ps, timeout);', mentions: 1, reason: 'Remember the local program whose synchronous read exceeded its bound.', line: 1026 },
  { file: 'src/substrate/process.mjs', text: '  if (status !== 0 && !(status === 1 && stdout === \'\')) throw exited(ps, args, status ?? ending);', mentions: 1, reason: 'Report a synchronous local read\'s failed status with its program and arguments.', line: 1031 },
  { file: 'src/substrate/process.mjs', text: 'async function contain(group, { ps, readTimeout, kill = SIGNAL, trace, host = realHost }, killed) {', mentions: 3, reason: 'Receive the process-table program for bounded group containment.', line: 1073 },
  { file: 'src/substrate/process.mjs', text: '  const within = (step, spare = 0) => {', mentions: 2, reason: 'Define a local cleanup-stage reader within the containment deadline.', line: 1076 },
  { file: 'src/substrate/process.mjs', text: '    return reading(step(deadline), ps, readTimeout, deadline + spare, trace, host);', mentions: 3, reason: 'Obtain the cleanup-stage reads and execute them with their remaining bound.', line: 1078, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    const { members, sightings } = await within((deadline) => census(group, kill, deadline, host.clock.now, trace));', mentions: 1, reason: 'Take the first bounded census through the asynchronous reader wrapper.', line: 1085, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '    ({ named, left, listed } = await within((deadline) => beforeKill(group, members, sightings, kill, readTimeout, deadline, host.clock.now), readTimeout));', mentions: 2, reason: 'Confirm the census members before signalling through the same bounded wrapper.', line: 1086, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  const { stuck, joined, unread, unlisted, unconfirmed } = await ended(group, { ps, readTimeout, kill, host }, KILL_BOUND, listed);', mentions: 3, reason: 'Confirm group exit through the selected process-table reader.', line: 1090, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  const unended = await reading(described(unshown, named), ps, readTimeout, undefined, undefined, host).catch(() => unshown);', mentions: 2, reason: 'Describe unresolved members through the selected process-table reader.', line: 1094, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'export function containNow(group, { readTimeout, host = realHost }) {', mentions: 1, reason: 'Expose synchronous containment for recorded exit cleanup.', line: 1156 },
  { file: 'src/substrate/process.mjs', text: '  const { ps } = host;', mentions: 1, reason: 'Take the host\'s process-table program for synchronous containment.', line: 1158 },
  { file: 'src/substrate/process.mjs', text: '  const spawn = host.spawnSync;', mentions: 2, reason: 'Use this host\'s synchronous starter for synchronous containment reads.', line: 1160 },
  { file: 'src/substrate/process.mjs', text: '  const kill = host.signal;', mentions: 1, reason: 'Take the host\'s signal operation for synchronous containment.', line: 1161 },
  { file: 'src/substrate/process.mjs', text: '  const within = (step, spare = 0) => {', mentions: 2, reason: 'Define a local synchronous cleanup-stage reader within its deadline.', line: 1164 },
  { file: 'src/substrate/process.mjs', text: '    return readingNow(step(deadline), ps, readTimeout, deadline + spare, now, spawn);', mentions: 4, reason: 'Forward the cleanup-stage reads to the chosen synchronous starter.', line: 1166, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    const { members, sightings } = within((deadline) => census(group, kill, deadline, now));', mentions: 1, reason: 'Take the synchronous bounded census before ending a recorded group.', line: 1173, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '    ({ named, left, listed } = within((deadline) => beforeKill(group, members, sightings, kill, readTimeout, deadline, now), readTimeout));', mentions: 2, reason: 'Confirm synchronous census members before signalling them.', line: 1174, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  const seen = { live: false, first: unnamed === undefined && left === undefined, listed: listed ?? new Set((named ?? []).map(({ pid }) => pid)), named: new Map(), asked: new Set() };', mentions: 2, reason: 'Track which previously unlisted pids have already been queried.', line: 1179 },
  { file: 'src/substrate/process.mjs', text: '    ({ leader, stuck } = readingNow(emptied(group, seen, kill, readTimeout, now), ps, readTimeout, undefined, now, spawn));', mentions: 3, reason: 'Read the emptied process group through the chosen synchronous starter.', line: 1184, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    if ([...states.keys()].some((pid) => !seen.listed.has(pid))) seen.live = true;', mentions: 1, reason: 'Remember whether every observed pid appeared in the original census list.', line: 1268 },
  { file: 'src/substrate/process.mjs', text: '    const unlisted = living.filter((pid) => !seen.listed.has(pid) && !seen.asked.has(pid));', mentions: 2, reason: 'Select newly observed pids that still need an identity query.', line: 1276 },
  { file: 'src/substrate/process.mjs', text: '    for (const pid of unlisted) seen.asked.add(pid);', mentions: 1, reason: 'Remember each pid for which an identity query was made.', line: 1277 },
  { file: 'src/substrate/process.mjs', text: 'export const LSOF = realHost.lsof;', mentions: 2, reason: 'Export the real host\'s cwd census program as the default reader.', line: 1349 },
  { file: 'src/substrate/process.mjs', text: '    const left = pids.filter((pid) => observed.get(pid) !== \'ended\' && answers(pid, kill));', mentions: 1, reason: 'Exclude processes already observed ended from further live checks.', line: 1502 },
  { file: 'src/substrate/process.mjs', text: 'function* sweeping(directory, lsof, kill, observeAfterKill = false, host = realHost) {', mentions: 1, reason: 'Receive the cwd census program while sweeping a dispatch directory.', line: 1561 },
  { file: 'src/substrate/process.mjs', text: '    return workingIn(yield { tool: lsof, args: listing(pids, host) }, directory, host);', mentions: 2, reason: 'Yield the cwd census program with its fixed listing arguments.', line: 1573 },
  { file: 'src/substrate/process.mjs', text: '          for (const pid of killedNow) observed.set(pid, state.has(pid) ? (live(state.get(pid)) ? \'live\' : \'ended\') : \'ended\');', mentions: 2, reason: 'Record whether each signalled process was observed live or ended.', line: 1623 },
  { file: 'src/substrate/process.mjs', text: 'async function swept(directory, { ps, lsof, readTimeout, kill = SIGNAL, host = realHost }, killed) {', mentions: 4, reason: 'Receive the process-table and cwd census programs for an asynchronous directory sweep.', line: 1645 },
  { file: 'src/substrate/process.mjs', text: '  const found = await reading(sweeping(directory, lsof, kill, false, host), ps, readTimeout, undefined, undefined, host);', mentions: 3, reason: 'Run the directory sweep with its cwd census and process-table readers.', line: 1648, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  return sweptEvents(directory, await reading(settled(found, kill, KILL_BOUND, host.clock.now), ps, readTimeout, host.clock.now() + KILL_BOUND + readTimeout, undefined, host), killed);', mentions: 2, reason: 'Confirm the directory sweep\'s surviving processes within the shared kill bound.', line: 1649, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function sweptNow(directory, { ps, lsof, readTimeout, kill = SIGNAL, host = realHost }, killed) {', mentions: 4, reason: 'Receive the process-table and cwd census programs for synchronous exit cleanup.', line: 1660 },
  { file: 'src/substrate/process.mjs', text: '  const answered = !unanswered.has(ps);', mentions: 1, reason: 'Check whether the selected process-table program can still answer during exit cleanup.', line: 1664 },
  { file: 'src/substrate/process.mjs', text: '  const found = readingNow(sweeping(directory, lsof, kill, true, host), ps, readTimeout, began + readTimeout, host.clock.now, host.spawnSync);', mentions: 4, reason: 'Use the host\'s synchronous starter for a directory-census sweep.', line: 1665, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  if (answered && found.killedAt !== undefined) unanswered.delete(ps);', mentions: 1, reason: 'Clear a previous reader refusal after a synchronous sweep answered.', line: 1669 },
  { file: 'src/substrate/process.mjs', text: '  return sweptEvents(directory, readingNow(settled(found, kill, readTimeout, host.clock.now), ps, readTimeout, (found.killedAt ?? began) + readTimeout, host.clock.now, host.spawnSync), killed);', mentions: 3, reason: 'Check the settled directory census through that same synchronous starter.', line: 1670, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'async function censused(call) {', mentions: 1, reason: 'Declare asynchronous census of all directories held by a dispatch.', line: 1687 },
  { file: 'src/substrate/process.mjs', text: '  for (const directory of sweptBy(call)) events.push(...(await swept(directory, call, \'survivor.killed\')));', mentions: 1, reason: 'Sweep the dispatch directories and collect their recorded survivor outcomes.', line: 1689, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function endedNow(group, call) {', mentions: 1, reason: 'Declare the synchronous containment and directory-census wrapper.', line: 1697 },
  { file: 'src/substrate/process.mjs', text: '  const look = containNow(group, call);', mentions: 1, reason: 'Contain a dispatch synchronously during engine exit.', line: 1698, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  for (const directory of sweptBy(call)) look.kills = [...look.kills, ...sweptNow(directory, call, \'survivor.killed\')];', mentions: 1, reason: 'Add synchronous directory-sweep outcomes to the containment results.', line: 1699, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'export async function runCommand({ command, args, cwd, env, input, timeout, emitter, onGroup, onExit, directory, scratch, host = realHost, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND, trace }) {', mentions: 3, reason: 'Receive the reviewed program, inherited environment and containment options at L0.', line: 1783 },
  { file: 'src/substrate/process.mjs', text: '  const { ps, lsof, signal: kill } = host;', mentions: 3, reason: 'Take the real host\'s local census programs and signal operation for one dispatch.', line: 1785 },
  { file: 'src/substrate/process.mjs', text: '  if (typeof emitter?.emit !== \'function\') throw startFailure(Object.assign(new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`), { code: NOT_STARTED }), \'event-emitter-missing\');', mentions: 1, reason: 'Refuse a process start when no L0 event emitter was supplied.', line: 1789 },
  { file: 'src/substrate/process.mjs', text: '    throw startFailure(Object.assign(new Error(`the process adapter was given the timeout ${shown(timeout)} (of type ${type}), which is not a positive finite number of milliseconds, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-timeout\');', mentions: 1, reason: 'Refuse a process start with a nonpositive or nonfinite timeout.', line: 1793 },
  { file: 'src/substrate/process.mjs', text: '  if (unfit !== undefined) throw startFailure(notStarted(command, unfit), \'directory-unusable\');', mentions: 1, reason: 'Refuse a process start in an unsuitable working directory.', line: 1796 },
  { file: 'src/substrate/process.mjs', text: '  if (why !== undefined) throw startFailure(notStarted(command, why), real === undefined ? \'directory-unusable\' : \'directory-illegible\', real === undefined ? {} : { path: real });', mentions: 1, reason: 'Refuse a process start when its real working directory is illegible.', line: 1800 },
  { file: 'src/substrate/process.mjs', text: '  if (scratchWhy !== undefined) throw startFailure(notStarted(command, scratchWhy), scratchReal === undefined ? \'directory-unusable\' : \'scratch-illegible\', scratchReal === undefined ? {} : { path: scratchReal });', mentions: 1, reason: 'Refuse a process start when its scratch directory is unsuitable or illegible.', line: 1802 },
  { file: 'src/substrate/process.mjs', text: '  const child = spawned(command, () => host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, \'pipe\', \'pipe\'] }), cwd, host);', mentions: 4, reason: 'Start the selected reviewed tool or configured shell with its inherited environment.', line: 1805, programs: ['gh', 'git', 'claude', 'codex', '/bin/sh', 'launchctl'] },
  { file: 'src/substrate/process.mjs', text: '    throw spawnFailure(command, error, cwd, host);', mentions: 1, reason: 'Classify a native start failure without inventing a process outcome.', line: 1809 },
  { file: 'src/substrate/process.mjs', text: '  const call = { emitter, host, ps, lsof, readTimeout, kill, onExit, trace, directory: real, scratch: scratchReal, child, events: [], contained: false };', mentions: 3, reason: 'Retain the dispatch\'s local census programs with its containment state.', line: 1819 },
  { file: 'src/substrate/process.mjs', text: '    if (onGroup) onGroup(child.pid, startOf(ps, child.pid, readTimeout, host));', mentions: 2, reason: 'Read the spawned leader\'s start identity through the selected process-table program.', line: 1829, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '    const kills = [...(await contain(child.pid, call, \'survivor.killed\')), ...(await censused(call))];', mentions: 2, reason: 'Contain and census a child whose group-record callback refused it.', line: 1834, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  if (expired) events.push(...(await contain(child.pid, call, \'timeout.killed\')));', mentions: 1, reason: 'Contain the spawned child\'s group after its real deadline expires.', line: 1848, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  events.push(...(await contain(child.pid, call, \'survivor.killed\')));', mentions: 1, reason: 'Contain the spawned child\'s survivors before returning its result.', line: 1857, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  events.push(...(await censused(call)));', mentions: 1, reason: 'Census the finished dispatch\'s directories before returning its result.', line: 1858, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  if (unrecorded.length > 0) throw refused(unrecorded, result, timedOut ? `the timeout of ${timeout} ms ended ${command}, and ` : \'\');', mentions: 1, reason: 'Report events refused while the selected command was ending.', line: 1870 },
  { file: 'src/substrate/process.mjs', text: 'export async function killRecordedGroup({ group, started, emitter, directory, identity, scratch, host = realHost, readTimeout = READ_TIMEOUT }) {', mentions: 1, reason: 'Expose cleanup of the exact group and directories previously recorded by L1.', line: 1893 },
  { file: 'src/substrate/process.mjs', text: '  const { ps, lsof, signal: kill } = host;', mentions: 3, reason: 'Take the host\'s local readers before ending a previously recorded dispatch.', line: 1895 },
  { file: 'src/substrate/process.mjs', text: '  const starts = await startsIn(ps, group, readTimeout, host);', mentions: 2, reason: 'Confirm the recorded group\'s start identities using the process-table program.', line: 1896, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '  const kills = recorded(group, started, starts) ? await contain(group, { ps, readTimeout, kill, host }, \'recorded.killed\') : [];', mentions: 3, reason: 'Contain the recorded group only after confirming its leader identity.', line: 1897, programs: ['/bin/ps', 'src/substrate/process-table.sh'] },
  { file: 'src/substrate/process.mjs', text: '    else kills.push(...(await swept(each, { ps, lsof, readTimeout, kill, host }, \'recorded.killed\')));', mentions: 4, reason: 'Sweep each recorded dispatch directory with both selected local readers.', line: 1903, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: 'function startOf(ps, pid, timeout, host = realHost) {', mentions: 2, reason: 'Receive the process-table program for the leader\'s synchronous start-time read.', line: 1970 },
  { file: 'src/substrate/process.mjs', text: '  const read = host.spawnSync(ps, [\'-p\', String(pid), \'-o\', \'lstart=\'], { env: PS_ENV, timeout, killSignal: \'SIGKILL\', encoding: \'utf8\' });', mentions: 4, reason: 'Read a local PID\'s start time with ps or the packaged Linux shim.', line: 1971, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '  const failure = read.error?.message ?? (read.stderr !== \'\' ? read.stderr.trim() : undefined) ?? (read.status !== 0 ? `${ps} ended with ${read.status ?? read.signal}` : undefined);', mentions: 2, reason: 'Describe an unreadable leader identity with its local reader\'s result.', line: 1973 },
  { file: 'src/substrate/process.mjs', text: 'async function startsIn(ps, group, timeout, host = realHost) {', mentions: 2, reason: 'Receive the process-table program for the group\'s asynchronous start-time reads.', line: 2028 },
  { file: 'src/substrate/process.mjs', text: '      rows = rowsOf(await run(ps, [\'-ww\', \'-g\', String(group), \'-o\', \'pid=,stat=,lstart=\'], remaining, timeout, host));', mentions: 2, reason: 'Read local group members and start times through the bounded process reader.', line: 2039, programs: ['/bin/ps', 'src/substrate/process-table.sh', '/usr/sbin/lsof', '/usr/bin/lsof'] },
  { file: 'src/substrate/process.mjs', text: '    if (rows.size === 0 && occupied(group, host.signal)) short = \'listed no process of the group while signal 0 still reached it\';', mentions: 1, reason: 'Check signal-zero reachability when the group census reports no members.', line: 2045 },
  { file: 'src/substrate/process.mjs', text: '    else if (!rows.has(group) && answers(group, host.signal)) short = `left out its leader, pid ${group}, while signal 0 still reached that pid`;', mentions: 1, reason: 'Check the missing leader\'s signal-zero reachability before accepting its start identity.', line: 2046 },
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
  { file: 'src/substrate/providers/claude.mjs', text: '  const [, tool, path] = match;', mentions: 1, reason: 'Separate a path permission\'s tool name from its path pattern.', line: 338 },
  { file: 'src/substrate/providers/claude.mjs', text: '  if (path.startsWith(\'/\')) return `${tool}(/${at}${path})`;', mentions: 1, reason: 'Anchor an absolute project path permission beneath the reached directory.', line: 340 },
  { file: 'src/substrate/providers/claude.mjs', text: '  return `${tool}(/${at}/${relative})`;', mentions: 1, reason: 'Anchor a relative path permission while retaining its declared tool.', line: 344 },
  { file: 'src/substrate/providers/claude.mjs', text: 'export async function invocation({ agent, tier, prompt, directory, card, reach = [], emitter, environment = process.env }) {', mentions: 2, reason: 'Receive the account environment and role inputs for a Claude invocation.', line: 370 },
  { file: 'src/substrate/providers/claude.mjs', text: '  const declares = (tool) => [tool, ...(ALIASES[tool] ?? [])].some((each) => allowed.includes(each));', mentions: 3, reason: 'Check whether the consumer declared a tool by its name or an allowed alias.', line: 389 },
  { file: 'src/substrate/providers/claude.mjs', text: '  const withheld = [...WORKTREE, ...OWNERS.filter((tool) => !declares(tool))];', mentions: 2, reason: 'Withhold owner-account tools that the consumer did not declare.', line: 390 },
  { file: 'src/substrate/providers/claude.mjs', text: '    command: \'claude\',', mentions: 1, reason: 'Select the configured Claude agent CLI as the role program.', line: 396 },
  { file: 'src/substrate/providers/claude.mjs', text: '    env: { [TMPDIR_KEY]: join(real, TMPDIR_NAME) },', mentions: 1, reason: 'Add only the workspace-derived Claude temporary-directory variable.', line: 411 },
  { file: 'src/substrate/providers/claude.mjs', text: '    folder: cliFolder(real, environment),', mentions: 1, reason: 'Locate the role\'s CLI folder using the same inherited account environment.', line: 412 },
  { file: 'src/substrate/providers/codex.mjs', text: 'import { gitEnvironment } from \'../git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for the Codex skill probe.', line: 11 },
  { file: 'src/substrate/providers/codex.mjs', text: 'import { runCommand } from \'../process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for the bounded Codex skill probe.', line: 12 },
  { file: 'src/substrate/providers/codex.mjs', text: 'async function probed({ directory, home, emitter, timeout, host }) {', mentions: 1, reason: 'Declare the bounded Codex skill-probe process wrapper.', line: 252 },
  { file: 'src/substrate/providers/codex.mjs', text: '  const { exit, timedOut, stdout, stderr } = await runCommand({ command: \'codex\', args, cwd: directory, env: { ...gitEnvironment(), CODEX_HOME: home }, timeout, emitter, host });', mentions: 4, reason: 'Run the Codex probe with the made Codex home and copied account environment.', line: 255, programs: ['codex'] },
  { file: 'src/substrate/providers/codex.mjs', text: 'const ownerHome = () => process.env.CODEX_HOME || join(homedir(), \'.codex\');', mentions: 1, reason: 'Locate the account\'s own Codex home for its existing configuration and auth link.', line: 272 },
  { file: 'src/substrate/providers/codex.mjs', text: 'export async function invocation({ agent, tier, prompt, directory, scratch, reach = [], gitDirectories, emitter, host, probeTimeout = PROBE_TIMEOUT }) {', mentions: 2, reason: 'Declare invocation preparation with its optional git-directory callback.', line: 309 },
  { file: 'src/substrate/providers/codex.mjs', text: '  const outside = await probed({ directory, home, emitter, timeout: probeTimeout, host });', mentions: 1, reason: 'Read the actual Codex skill probe before building its invocation settings.', line: 325, programs: ['codex'] },
  { file: 'src/substrate/providers/codex.mjs', text: '    command: \'codex\',', mentions: 1, reason: 'Select the configured Codex agent CLI as the role program.', line: 328 },
  { file: 'src/substrate/providers/codex.mjs', text: '    env: { CODEX_HOME: home, TMPDIR: temporary, TMPPREFIX: join(temporary, \'zsh\') },', mentions: 1, reason: 'Add only the made Codex home and scratch-derived temporary-directory variables.', line: 341 },
  { file: 'src/substrate/worktrees.mjs', text: 'import { gitEnvironment } from \'./git-environment.mjs\';', mentions: 1, reason: 'Import the safe environment copier for git workspace operations.', line: 8 },
  { file: 'src/substrate/worktrees.mjs', text: 'import { EVENT_REFUSED, NOT_STARTED, runCommand } from \'./process.mjs\';', mentions: 1, reason: 'Import the sole L0 starter for git workspace operations.', line: 9 },
  { file: 'src/substrate/worktrees.mjs', text: 'function queued(step) {', mentions: 1, reason: 'Define a local serialized workspace-operation callback.', line: 78 },
  { file: 'src/substrate/worktrees.mjs', text: '  const ran = tail.then(step);', mentions: 1, reason: 'Queue that workspace operation after the earlier operation settles.', line: 79 },
  { file: 'src/substrate/worktrees.mjs', text: 'export function workspaces({ repository, emitter, git = \'git\', timeout = GIT_TIMEOUT, rejectFailedChecks = false }) {', mentions: 1, reason: 'Declare the reviewed serialized git-workspace adapter factory.', line: 91 },
  { file: 'src/substrate/worktrees.mjs', text: '  const call = (args) => queued(async () => {', mentions: 1, reason: 'Declare the factory\'s serialized git process wrapper.', line: 93 },
  { file: 'src/substrate/worktrees.mjs', text: '      result = await runCommand({ command: git, args, cwd: repository, env: gitEnvironment(), timeout, emitter });', mentions: 4, reason: 'Run git workspace operations through L0 with a repository-safe account environment.', line: 97, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const answer = async (args) => {', mentions: 1, reason: 'Declare the checked serialized git-answer wrapper.', line: 123 },
  { file: 'src/substrate/worktrees.mjs', text: '    const result = await call(args);', mentions: 1, reason: 'Send a checked git operation through the serialized process wrapper.', line: 124, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const fetched = async (branch) => {', mentions: 1, reason: 'Declare the bounded retry wrapper for fetching a branch.', line: 139 },
  { file: 'src/substrate/worktrees.mjs', text: '      const result = await call(args);', mentions: 1, reason: 'Send a retryable git operation through the same serialized wrapper.', line: 142, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const listed = async () => {', mentions: 1, reason: 'Declare the checked git-worktree listing wrapper.', line: 178 },
  { file: 'src/substrate/worktrees.mjs', text: '    for (const record of (await answer([\'worktree\', \'list\', \'--porcelain\', \'-z\'])).split(\'\\0\\0\')) {', mentions: 1, reason: 'Read registered worktrees through the checked git wrapper.', line: 180, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const fetchMainLine = async () => {', mentions: 1, reason: 'Declare the checked main-line fetch and identity wrapper.', line: 191 },
  { file: 'src/substrate/worktrees.mjs', text: '    const printed = await answer([\'ls-remote\', \'--symref\', ORIGIN, \'HEAD\']);', mentions: 1, reason: 'Read the remote\'s symbolic HEAD through the checked git wrapper.', line: 192, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    await fetched(branch);', mentions: 1, reason: 'Fetch the branch before verifying its local head.', line: 197, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const lineHead = async (branch) => {', mentions: 1, reason: 'Declare the reviewed remote-branch head wrapper.', line: 202 },
  { file: 'src/substrate/worktrees.mjs', text: '    const result = await call([\'ls-remote\', \'--exit-code\', ORIGIN, ref]);', mentions: 1, reason: 'Read the remote reference through the reviewed git wrapper.', line: 204, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const addAt = async (path, branch, commit) => {', mentions: 1, reason: 'Declare the checked creation of a branch worktree at a supplied commit.', line: 218 },
  { file: 'src/substrate/worktrees.mjs', text: '    await answer([\'worktree\', \'prune\']);', mentions: 2, reason: 'Prune stale worktree registrations before creating a maker worktree.', line: 219, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    await answer([\'worktree\', \'add\', \'--quiet\', \'--no-track\', \'-B\', branch, path, commit]);', mentions: 1, reason: 'Create the maker branch and worktree through the checked git wrapper.', line: 220, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    fetchMainLine,', mentions: 1, reason: 'Expose the reviewed main-line fetch wrapper on the workspace adapter.', line: 224 },
  { file: 'src/substrate/worktrees.mjs', text: '    async gitDirectories(path) {', mentions: 1, reason: 'Declare the git metadata-directory query for a workspace.', line: 231 },
  { file: 'src/substrate/worktrees.mjs', text: '      const [own, common] = (await answer([\'-C\', path, \'rev-parse\', \'--path-format=absolute\', \'--git-dir\', \'--git-common-dir\'])).replace(/\\n$/, \'\').split(\'\\n\');', mentions: 1, reason: 'Read the workspace\'s own and common git directories.', line: 232, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async tip(path, branch) {', mentions: 1, reason: 'Declare the checked linked-worktree tip wrapper.', line: 246 },
  { file: 'src/substrate/worktrees.mjs', text: '      if (!(await this.isWorktree(path))) throw new Error(`${path} is not a linked worktree of this repository`);', mentions: 1, reason: 'Verify that the directory is a linked worktree before reading its head.', line: 247, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      const checkedOut = (await answer([\'-C\', path, \'symbolic-ref\', \'--quiet\', \'--short\', \'HEAD\'])).trim();', mentions: 1, reason: 'Read the linked worktree\'s checked-out branch through git.', line: 248, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      return (await answer([\'-C\', path, \'rev-parse\', \'--verify\', \'HEAD^{commit}\'])).trim();', mentions: 1, reason: 'Resolve the linked worktree\'s HEAD as a commit through git.', line: 250, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async make(path, branch) {', mentions: 1, reason: 'Declare creation of a maker worktree from the fetched main line.', line: 254 },
  { file: 'src/substrate/worktrees.mjs', text: '      const { commit } = await fetchMainLine();', mentions: 1, reason: 'Fetch the main-line commit before creating a maker workspace.', line: 255, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      await addAt(path, branch, commit);', mentions: 1, reason: 'Create the maker worktree at that fetched commit.', line: 256, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async fetchLineAt(branch, expected) {', mentions: 1, reason: 'Declare the checked branch-head comparison and fetch wrapper.', line: 260 },
  { file: 'src/substrate/worktrees.mjs', text: '      const compare = async () => {', mentions: 1, reason: 'Declare one remote-head comparison within the bounded fetch operation.', line: 261 },
  { file: 'src/substrate/worktrees.mjs', text: '        const actual = await lineHead(branch);', mentions: 1, reason: 'Read the current remote branch head for the fetch retry check.', line: 262, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      await compare();', mentions: 1, reason: 'Compare the remote head before fetching a continuing branch.', line: 265, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '        await fetched(branch);', mentions: 1, reason: 'Retry the fetch through the reviewed bounded-fetch wrapper.', line: 267, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      await compare();', mentions: 1, reason: 'Compare the remote head again after the fetch completes.', line: 272, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '        kind = (await answer([\'cat-file\', \'-t\', expected])).trim();', mentions: 1, reason: 'Ask git which object type the expected head names.', line: 275, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async makeAt(path, branch, commit) {', mentions: 1, reason: 'Declare creation of a worktree at a verified supplied commit.', line: 284 },
  { file: 'src/substrate/worktrees.mjs', text: '      await addAt(path, branch, commit);', mentions: 1, reason: 'Create the continuing worktree at its verified commit.', line: 285, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async makeDetached(path, commit) {', mentions: 1, reason: 'Declare the checked detached-worktree creation method.', line: 305 },
  { file: 'src/substrate/worktrees.mjs', text: '      await answer([\'worktree\', \'prune\']);', mentions: 2, reason: 'Prune stale registrations before creating a detached worktree.', line: 306, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      await answer([\'worktree\', \'add\', \'--quiet\', \'--detach\', path, commit]);', mentions: 1, reason: 'Create the detached worktree through the checked git wrapper.', line: 307, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async holdsAfterFetch(commit) {', mentions: 1, reason: 'Declare the wrapper that fetches and verifies a supplied commit.', line: 328 },
  { file: 'src/substrate/worktrees.mjs', text: '      const named = await call([\'rev-parse\', \'--verify\', \'--quiet\', \'--end-of-options\', commit]);', mentions: 1, reason: 'Verify the supplied commit spelling through git.', line: 329, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      const fetch = await call([\'fetch\', \'--no-write-fetch-head\', \'--end-of-options\', ORIGIN, commit]);', mentions: 1, reason: 'Fetch the verified commit through the reviewed git wrapper.', line: 332, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      const held = await call([\'cat-file\', \'-t\', \'--end-of-options\', commit]);', mentions: 1, reason: 'Ask git whether the fetched object is a commit.', line: 334, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async remove(path) {', mentions: 1, reason: 'Declare the checked git-worktree removal method.', line: 348 },
  { file: 'src/substrate/worktrees.mjs', text: '      await answer([\'worktree\', \'remove\', \'--force\', path]);', mentions: 2, reason: 'Remove the selected worktree through the checked git wrapper.', line: 349, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async isWorktree(path) {', mentions: 1, reason: 'Declare the wrapper that identifies a linked worktree\'s repository.', line: 373 },
  { file: 'src/substrate/worktrees.mjs', text: '      const own = (await answer([\'rev-parse\', \'--path-format=absolute\', \'--git-common-dir\'])).trim();', mentions: 1, reason: 'Read the repository\'s common git directory for worktree comparison.', line: 386, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '      const there = await call([\'-C\', real, \'rev-parse\', \'--path-format=absolute\', \'--show-toplevel\', \'--git-dir\', \'--git-common-dir\']);', mentions: 1, reason: 'Read the workspace\'s canonical git directory identities through git.', line: 387, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async registration(path) {', mentions: 1, reason: 'Declare lookup of the selected path\'s git-worktree registration.', line: 417 },
  { file: 'src/substrate/worktrees.mjs', text: '      const held = (await listed()).find(({ at }) => realOrLeft(at) === wanted);', mentions: 1, reason: 'Find a registered worktree using the checked git listing.', line: 419, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async listing() {', mentions: 1, reason: 'Expose the reviewed worktree listing operation.', line: 428 },
  { file: 'src/substrate/worktrees.mjs', text: '      return listed();', mentions: 1, reason: 'Return the adapter\'s checked worktree listing.', line: 429, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async registered() {', mentions: 1, reason: 'Expose the reviewed registered-worktree path operation.', line: 436 },
  { file: 'src/substrate/worktrees.mjs', text: '      return (await listed()).map(({ at }) => at);', mentions: 1, reason: 'Read registered worktree paths through the checked listing wrapper.', line: 437, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async prune() {', mentions: 1, reason: 'Declare pruning of stale git-worktree registrations.', line: 441 },
  { file: 'src/substrate/worktrees.mjs', text: '      await answer([\'worktree\', \'prune\']);', mentions: 2, reason: 'Prune the directory\'s stale registration before recovery.', line: 442, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async unlock(path) {', mentions: 1, reason: 'Declare unlocking a verified git-worktree registration.', line: 446 },
  { file: 'src/substrate/worktrees.mjs', text: '      await answer([\'worktree\', \'unlock\', path]);', mentions: 2, reason: 'Unlock the verified incomplete worktree registration before recovery.', line: 447, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async topLevel() {', mentions: 1, reason: 'Declare reading the canonical repository top-level path through git.', line: 455 },
  { file: 'src/substrate/worktrees.mjs', text: '      return realpathSync.native((await answer([\'rev-parse\', \'--path-format=absolute\', \'--show-toplevel\'])).replace(/\\n$/, \'\'));', mentions: 1, reason: 'Read and canonicalize the repository\'s top-level path through git.', line: 456, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '    async acceptsBranch(name) {', mentions: 1, reason: 'Declare the topic branch-name validation wrapper.', line: 474 },
  { file: 'src/substrate/worktrees.mjs', text: '      const result = await call([\'check-ref-format\', \'--branch\', name]);', mentions: 1, reason: 'Ask git whether a proposed topic branch name is valid.', line: 475, programs: ['git'] },
  { file: 'src/substrate/worktrees.mjs', text: '  const command = `\\`${[git, ...args].join(\' \')}\\``;', mentions: 1, reason: 'Format the selected git invocation for a failure diagnostic.', line: 511 },
  { file: 'src/substrate/worktrees.mjs', text: '  if (timedOut) return new Error(`${command} ran past its timeout of ${timeout} ms, and L0 ended it`);', mentions: 1, reason: 'Explain that the selected git invocation exceeded its bound.', line: 512 },
  { file: 'src/substrate/worktrees.mjs', text: '  return new Error(`${command} exited ${exit}: ${firstLine(stderr)}`);', mentions: 1, reason: 'Explain the selected git invocation\'s nonzero exit and first stderr line.', line: 513 },
  { file: 'src/workflow/escalation.mjs', text: 'const FIELDS = [\'category\', \'item\', \'reason\', \'dispatch\'];', mentions: 1, reason: 'Include dispatch identity in the escalation-note field schema.', line: 12 },
  { file: 'src/workflow/escalation.mjs', text: '    ...blockLines({ category: \'<recorded-decision, critical, or ambiguous>\', item: \'<the item ordinal>\', reason: \'<one line naming why>\', dispatch: DISPATCH_SLOT }),', mentions: 1, reason: 'Include the dispatch-identity slot in escalation instructions.', line: 22 },
  { file: 'src/workflow/escalation.mjs', text: '  if (!CATEGORIES.includes(fields.category) || !POSITIVE.test(fields.item) || !Number.isSafeInteger(item) || item > count || !fields.reason || !DISPATCH.test(fields.dispatch)) return null;', mentions: 1, reason: 'Reject an escalation note with an invalid dispatch identity.', line: 45 },
  { file: 'src/workflow/escalation.mjs', text: '  return { category: fields.category, item, reason: fields.reason, dispatch: fields.dispatch };', mentions: 2, reason: 'Return the parsed escalation note with its dispatch identity.', line: 46 },
  { file: 'src/workflow/escalation.mjs', text: '    if (note?.dispatch === dispatch) return note;', mentions: 1, reason: 'Accept an escalation note only for the expected dispatch identity.', line: 54 },
  { file: 'src/workflow/escalation.mjs', text: '    ...(open.length === 1 ? { pull: open[0].number, head: open[0].head } : {}),', mentions: 1, reason: 'Carry the single open pull request and head into escalation evidence.', line: 63 },
  { file: 'src/workflow/escalation.mjs', text: 'export function escalationDestination({ category, raiser, escalate, maker, judges = [], comments = [] }) {', mentions: 1, reason: 'Receive the configured judge list when routing an escalation.', line: 81 },
  { file: 'src/workflow/escalation.mjs', text: 'export function routingComment({ destination, category, item, reason, pull, head }) {', mentions: 1, reason: 'Receive pull-request identity while composing escalation routing text.', line: 89 },
  { file: 'src/workflow/escalation.mjs', text: '    ...(next.pull === undefined ? {} : { pull: next.pull, head: next.head }) };', mentions: 3, reason: 'Carry an existing pull request and head into the parsed escalation route.', line: 98 },
  { file: 'src/workflow/escalation.mjs', text: '    ...(next.pull === undefined ? [] : [`Pull request: #${next.pull}`, `Head: ${next.head}`]), \'\',', mentions: 2, reason: 'Include the selected pull-request number and head in escalation evidence text.', line: 106 },
  { file: 'src/workflow/facts.mjs', text: '  return { pull: read, diff, comments, mergeable, rules, checks };', mentions: 1, reason: 'Return the read pull-request facts with their supporting forge observations.', line: 38 },
  { file: 'src/workflow/form-check.mjs', text: '  const run = /^ {0,3}(`+|~+)[ \\t]*$/.exec(line)?.[1];', mentions: 1, reason: 'Read the marker length of a local Markdown closing fence.', line: 30 },
  { file: 'src/workflow/form-check.mjs', text: '  return run !== undefined && run[0] === marks[0] && run.length >= marks.length;', mentions: 3, reason: 'Require the closing fence to match the opening marker and minimum length.', line: 31 },
  { file: 'src/workflow/gate.mjs', text: 'export function gateAnswer({ comments, card, pull, head, digest, count, judges, checks }) {', mentions: 2, reason: 'Receive the required judge panel while computing the gate answer.', line: 28 },
  { file: 'src/workflow/gate.mjs', text: '  const refusals = conflict === undefined ? judgeRefusals({ comments, card, pull, head, digest, count, judges }) : [{ judge: \'(panel)\', reason: conflict.conflict }];', mentions: 2, reason: 'Evaluate the required judge panel where no owner conflict exists.', line: 30 },
  { file: 'src/workflow/gate.mjs', text: 'function judgeRefusals({ comments, card, pull, head, digest, count, judges }) {', mentions: 2, reason: 'Receive the required panel while checking each judge marker.', line: 38 },
  { file: 'src/workflow/gate.mjs', text: '  const { governing, markers } = readMarkers(comments, { card, pull, head, digest, count });', mentions: 1, reason: 'Read the marker set for the exact card, pull request and head.', line: 39 },
  { file: 'src/workflow/gate.mjs', text: '    if (held.marker.verdict !== \'sound\') return [{ judge, reason: `verdict ${held.marker.verdict}` }];', mentions: 2, reason: 'Refuse a merge when a governing judge verdict is not sound.', line: 56 },
  { file: 'src/workflow/judges.mjs', text: 'import { failed, kindOf, panelOf, selectedSteps, stepAnswer, tierOf } from \'./next-action.mjs\';', mentions: 1, reason: 'Import L2\'s configured-step producer into judge decision construction.', line: 14 },
  { file: 'src/workflow/judges.mjs', text: '  pull: \'the pull request\',', mentions: 1, reason: 'Name the pull-request fact used by judge policy diagnostics.', line: 19 },
  { file: 'src/workflow/judges.mjs', text: '  return JSON.stringify([\'judge\', facts.pull, facts.head, facts.revision, role, provider, tier, comment]);', mentions: 1, reason: 'Include pull identity when deduplicating a judge instruction.', line: 28 },
  { file: 'src/workflow/judges.mjs', text: '    sink.emitter({ layer: \'L2\', card: card.number, ...(dispatch === undefined ? {} : { dispatch }) }).emit(name, fields);', mentions: 1, reason: 'Scope judge-policy observations to an available dispatch identity.', line: 50 },
  { file: 'src/workflow/judges.mjs', text: 'export function judgeAnswer(card, kinds, epicLabel, { roles = {}, provisioning = {}, sink, outcomes = {}, directories: reports = {} } = {}) {', mentions: 1, reason: 'Receive the consumer\'s provisioning map when constructing a judge decision.', line: 99 },
  { file: 'src/workflow/judges.mjs', text: '  const { kind, answer } = kindOf(card, kinds, epicLabel);', mentions: 1, reason: 'Inspect kind selection\'s answer before recording judge policy.', line: 100 },
  { file: 'src/workflow/judges.mjs', text: '  const agents = declared.judges.map(judgeRole).filter((role) => role !== OWNER);', mentions: 1, reason: 'Select the configured non-owner agent judges.', line: 114 },
  { file: 'src/workflow/judges.mjs', text: '  const pull = held(card, \'pull\');', mentions: 1, reason: 'Read the required pull-request fact for judging.', line: 121 },
  { file: 'src/workflow/judges.mjs', text: '  const { governing, markers } = readMarkers(comments, { card: card.number, pull: pull.number, head: pull.head, digest, count: items.length });', mentions: 1, reason: 'Read the governing markers for the selected pull request and head.', line: 125 },
  { file: 'src/workflow/judges.mjs', text: '    record(sink, card, \'diff.refused\', { pull: pull.number, reason }, `pull request #${pull.number}\'s diff was not served`);', mentions: 1, reason: 'Record the selected pull request whose diff read was refused.', line: 131 },
  { file: 'src/workflow/judges.mjs', text: '  const facts = { card: card.number, revision: digest, pull: pull.number, base: pull.base, head: pull.head };', mentions: 1, reason: 'Carry the selected pull request\'s base and head into judge facts.', line: 136 },
  { file: 'src/workflow/judges.mjs', text: '  const steps = selectedSteps(card, declared, provisioning);', mentions: 1, reason: 'Select the judge\'s configured provisioning steps for this card.', line: 137 },
  { file: 'src/workflow/judges.mjs', text: '        || withheld(card, role, steps, outcomes[role] ?? [], provisioning, sink);', mentions: 1, reason: 'Check whether configured provisioning failures withhold a judge.', line: 148 },
  { file: 'src/workflow/judges.mjs', text: '      ...(governing.has(role) ? { comment: governing.get(role).comment } : {}), steps: steps.map((name) => stepAnswer(name, provisioning)) }));', mentions: 2, reason: 'Construct each judge\'s configured steps through the shared L2 step producer.', line: 153 },
  { file: 'src/workflow/judges.mjs', text: '  if (refusals.length > 0) return { action: \'escalate\', class: \'card-local\', category: \'ambiguous\', raiser: \'loop\', reason: refusals.join(\'\\n\'), pull: pull.number, head: pull.head, from: card.forge.stage, ...withholding };', mentions: 2, reason: 'Attribute a judge-selection refusal to the scheduling loop.', line: 155 },
  { file: 'src/workflow/judges.mjs', text: '  if (Object.values(directories).some(({ reason }) => reason?.code === EVENT_REFUSED || reason?.startCause?.kind === \'event-unrecorded\')) return { action: \'judge\', kind, judges, halt: true, ...withholding };', mentions: 1, reason: 'Return selected judges while halting on an unrecorded directory-preparation event.', line: 156 },
  { file: 'src/workflow/judges.mjs', text: '    const classified = (report) => ({ class: \'environment\', ...judgeFailure(retry, report), ...(report?.dispatch === undefined ? {} : { dispatch: report.dispatch }) });', mentions: 4, reason: 'Classify a judge execution failure as an environment failure.', line: 159 },
  { file: 'src/workflow/judges.mjs', text: '  return { action: \'judge\', kind, judges, ...withholding };', mentions: 1, reason: 'Return the selected judge panel with its verified directory context.', line: 163 },
  { file: 'src/workflow/judges.mjs', text: '    record(sink, card, \'judge.withheld\', { role, scratch: missing, reason: message, class: \'environment\' }, `judge ${role}\'s scratch directory was not made`);', mentions: 1, reason: 'Record a judge withheld because its scratch directory was not made.', line: 241 },
  { file: 'src/workflow/judges.mjs', text: '  record(sink, card, \'judge.withheld\', { role, directory: outcome.reason.path, reason: outcome.reason.message, class: \'environment\' }, `judge ${role}\'s directory was not made`);', mentions: 1, reason: 'Record a judge withheld because its checked directory was not made.', line: 248 },
  { file: 'src/workflow/judges.mjs', text: 'function withheld(card, role, steps, outcomes, provisioning, sink) {', mentions: 1, reason: 'Receive the provisioning map when deciding whether to withhold a judge.', line: 256 },
  { file: 'src/workflow/judges.mjs', text: '    const failure = failed(outcome, provisioning[name], card, name);', mentions: 1, reason: 'Classify a named judge provisioning-step outcome against its declaration.', line: 259 },
  { file: 'src/workflow/judges.mjs', text: '    if (failure === undefined || !workRequires(provisioning[name])) continue;', mentions: 1, reason: 'Continue past successful or optional judge provisioning steps.', line: 260 },
  { file: 'src/workflow/judges.mjs', text: '    record(sink, card, \'judge.withheld\', { role, step: name, ...failure, class: \'environment\' }, `judge ${role}\'s required step \\`${name}\\` failed`);', mentions: 2, reason: 'Record the required configured step whose failure withholds a judge.', line: 261 },
  { file: 'src/workflow/judges.mjs', text: '    markerInstruction({ card: facts.card, pull: pull.number, head: pull.head, digest: facts.revision, role, provider, items, evidence: digest }),', mentions: 1, reason: 'Compose marker instructions for the selected pull request and head.', line: 316 },
  { file: 'src/workflow/judges.mjs', text: '  const { kind, answer } = kindOf(card, kinds, epicLabel);', mentions: 1, reason: 'Inspect kind selection\'s answer before evaluating the owner gate.', line: 356 },
  { file: 'src/workflow/judges.mjs', text: '  const agents = declared.judges.map(judgeRole).filter((role) => role !== OWNER);', mentions: 1, reason: 'Select the non-owner judges before checking the merge gate.', line: 362 },
  { file: 'src/workflow/judges.mjs', text: '  const round = { card: card.number, pull: pull.number, head: pull.head, digest, count: items.length };', mentions: 1, reason: 'Build the judge round\'s card, pull, head and acceptance identity.', line: 372 },
  { file: 'src/workflow/judges.mjs', text: '    action: \'escalate\', category: \'critical\', raiser: \'loop\', pull: pull.number, head: pull.head,', mentions: 2, reason: 'Attribute a critical judge-gate escalation to the scheduling loop.', line: 379 },
  { file: 'src/workflow/judges.mjs', text: '    action: \'escalate\', category: \'ambiguous\', raiser: \'loop\', pull: pull.number, head: pull.head,', mentions: 2, reason: 'Attribute an ambiguous judge-gate escalation to the scheduling loop.', line: 394 },
  { file: 'src/workflow/judges.mjs', text: '  if (declared.judges.map(judgeRole).includes(OWNER)) return advanced(card, { action: \'move\', to: \'owner\' });', mentions: 1, reason: 'Move the card to Owner where the configured panel includes the owner.', line: 398 },
  { file: 'src/workflow/judges.mjs', text: '  const event = { pull: pull.number, role, head: round.head, digest: round.digest, provider: fields.provider ?? null, verdict: fields.verdict ?? null, evidence: fields.evidence ?? null, edited: governing.edited, ...unreadable };', mentions: 3, reason: 'Record a marker read under the selected pull request and round.', line: 412 },
  { file: 'src/workflow/judges.mjs', text: '  record(sink, card, \'marker.read\', event, `${role}\'s marker at head ${round.head} was read`, fields.dispatch ?? null);', mentions: 1, reason: 'Attribute a marker read to the marker\'s own dispatch identity.', line: 414 },
  { file: 'src/workflow/judges.mjs', text: '    action: \'escalate\', category: \'critical\', raiser: \'loop\', pull: pull.number, head: pull.head,', mentions: 2, reason: 'Attribute a blocked merge-gate escalation to the scheduling loop.', line: 456 },
  { file: 'src/workflow/judges.mjs', text: '  return { action: \'return\', pull: pull.number, comment };', mentions: 1, reason: 'Return the card with the selected pull request and its instruction comment.', line: 481 },
  { file: 'src/workflow/judges.mjs', text: '  const handedOf = ({ comment, marker: { role, verdict, items: ruled, toSound } }) => ({', mentions: 1, reason: 'Read the recorded judge verdict while composing continuation instructions.', line: 524 },
  { file: 'src/workflow/judges.mjs', text: '    verdict,', mentions: 1, reason: 'Retain that judge verdict in the handed-over evidence.', line: 527 },
  { file: 'src/workflow/judges.mjs', text: '  return { action: \'continue\', pull: pull.number, head: pull.head, markers: markers.map(handedOf), ...(comments === undefined ? {} : { comments }) };', mentions: 1, reason: 'Continue work on the selected pull request at its current head.', line: 531 },
  { file: 'src/workflow/judges.mjs', text: 'function markerReason({ role, verdict, toSound, items: ruled }, items) {', mentions: 1, reason: 'Receive the judge verdict while explaining its acceptance disposition.', line: 535 },
  { file: 'src/workflow/judges.mjs', text: '  const { verdict, coverage, items } = governing.marker;', mentions: 1, reason: 'Read the governing marker\'s verdict and claimed item coverage.', line: 550 },
  { file: 'src/workflow/judges.mjs', text: '  const gate = gateAnswer({ comments, ...round, judges: panel, checks });', mentions: 1, reason: 'Check the marker panel against its selected judge roles.', line: 612 },
  { file: 'src/workflow/judges.mjs', text: '    return { action: \'merge\', pull: pull.number, head: pull.head, digest: round.digest,', mentions: 1, reason: 'Admit a merge only for the selected pull request and judged head.', line: 615 },
  { file: 'src/workflow/judges.mjs', text: '      verdicts: panel.map(({ role }) => ({ role, verdict: governing.get(role).marker.verdict })) };', mentions: 2, reason: 'Retain every required judge role\'s governing verdict in the merge decision.', line: 616 },
  { file: 'src/workflow/marker.mjs', text: '  pull: { valid: POSITIVE, read: Number, required: true },', mentions: 1, reason: 'Require and parse the marker\'s positive pull-request number.', line: 52 },
  { file: 'src/workflow/marker.mjs', text: '  verdict: { valid: oneOf(VERDICTS), required: true },', mentions: 1, reason: 'Require a verdict from the closed marker-verdict set.', line: 57 },
  { file: 'src/workflow/marker.mjs', text: '  dispatch: { valid: DISPATCH },', mentions: 1, reason: 'Validate the dispatch field of a judge marker.', line: 61 },
  { file: 'src/workflow/marker.mjs', text: '    ...[\'card\', \'pull\', \'head\', \'digest\', \'role\', \'provider\', \'verdict\'].flatMap(written),', mentions: 2, reason: 'Include pull-request identity in the instructed judge marker fields.', line: 89 },
  { file: 'src/workflow/marker.mjs', text: '    ...[\'coverage\', \'coverageReason\', \'toSound\', \'dispatch\', \'evidence\'].flatMap(written),', mentions: 1, reason: 'Include dispatch identity among the instructed marker fields.', line: 91 },
  { file: 'src/workflow/marker.mjs', text: 'export const markerInstruction = ({ evidence, ...asked }) => instruction({ ...asked, dispatch: DISPATCH_SLOT, evidence });', mentions: 1, reason: 'Insert the dispatch-identity slot into marker instructions.', line: 109 },
  { file: 'src/workflow/marker.mjs', text: 'function instruction({ card, pull, head, digest, role, provider, items, dispatch, evidence }) {', mentions: 2, reason: 'Receive the dispatch identity while composing marker instructions.', line: 119 },
  { file: 'src/workflow/marker.mjs', text: '    pull,', mentions: 1, reason: 'Carry the selected pull-request identity into marker instructions.', line: 122 },
  { file: 'src/workflow/marker.mjs', text: '    verdict: `<${VERDICTS.slice(0, -1).join(\', \')} or ${VERDICTS.at(-1)}>`,', mentions: 1, reason: 'Instruct the judge to choose one of the declared verdict values.', line: 127 },
  { file: 'src/workflow/marker.mjs', text: '    dispatch,', mentions: 1, reason: 'Carry that dispatch identity in the instructed marker fields.', line: 132 },
  { file: 'src/workflow/marker.mjs', text: '  if (Object.hasOwn(fields, \'verdict\') && fields.verdict !== \'sound\' && !Object.hasOwn(fields, \'toSound\')) faults.push(`the verdict ${fields.verdict} names no toSound`);', mentions: 3, reason: 'Require a correction description with a non-sound marker verdict.', line: 197 },
  { file: 'src/workflow/marker.mjs', text: '  return { state: \'marker\', marker: ordered(marker), absent: [\'provider\', \'dispatch\', \'evidence\'].filter((key) => !Object.hasOwn(fields, key)) };', mentions: 1, reason: 'Report an absent required dispatch field while parsing a marker.', line: 201 },
  { file: 'src/workflow/marker.mjs', text: '  const keys = [\'card\', \'pull\', \'head\', \'digest\', \'role\', \'provider\', \'verdict\', \'items\', \'coverage\', \'coverageReason\', \'toSound\', \'dispatch\', \'evidence\'];', mentions: 3, reason: 'Keep dispatch identity in the accepted marker field schema.', line: 206 },
  { file: 'src/workflow/marker.mjs', text: '      const run = /^ {0,3}(`+|~+)[ \\t]*$/.exec(line)?.[1];', mentions: 1, reason: 'Read the marker length of a second local Markdown fenced block.', line: 219 },
  { file: 'src/workflow/marker.mjs', text: '      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length) fence = null;', mentions: 3, reason: 'Close that Markdown block only for a matching marker of sufficient length.', line: 220 },
  { file: 'src/workflow/marker.mjs', text: 'export function readMarkers(comments, { card, pull, head, digest, count }) {', mentions: 1, reason: 'Receive the expected pull request while reading its judge markers.', line: 248 },
  { file: 'src/workflow/marker.mjs', text: '      return String(named.card) === String(card) && String(named.pull) === String(pull);', mentions: 1, reason: 'Match markers to the expected card and pull request.', line: 256 },
  { file: 'src/workflow/next-action.mjs', text: 'export const makerAction = (answer) => [\'dispatch\', \'continue\'].includes((answer.action === \'remove\' ? answer.following : answer).action);', mentions: 2, reason: 'Recognize maker dispatch and continuation actions, including removal follow-ons.', line: 30 },
  { file: 'src/workflow/next-action.mjs', text: 'export function nextAction(given, kinds, epicLabel, { roles, topic = worktreeTopic(), provisioning, outcomes = [], sink, attempt = 1, firstFailure, workspace, maker, forge, judged, directories, continuing } = {}) {', mentions: 3, reason: 'Receive the consumer\'s provisioning map for an L2 next-action decision.', line: 98 },
  { file: 'src/workflow/next-action.mjs', text: '    && !(provisioning !== undefined && (attempt !== 1 || workspace !== undefined || outcomes.length > 0));', mentions: 1, reason: 'Avoid the early routing path once provisioning or an attempt outcome needs evaluation.', line: 105 },
  { file: 'src/workflow/next-action.mjs', text: '      ? routed({ action: \'escalate\', class: \'card-local\', category: \'ambiguous\', raiser: \'loop\', reason: ordinary.reason, line: facts.line })', mentions: 1, reason: 'Attribute an unresolved ordinary gate refusal to the scheduling loop.', line: 110 },
  { file: 'src/workflow/next-action.mjs', text: '      return { action: \'remove\', closed, following };', mentions: 1, reason: 'Select workspace removal with its recorded closure and following action.', line: 117 },
  { file: 'src/workflow/next-action.mjs', text: '    return { action: \'remove\', following };', mentions: 1, reason: 'Select workspace removal before the admitted following action.', line: 119 },
  { file: 'src/workflow/next-action.mjs', text: '  const { kind, answer } = kindOf(card, kinds, epicLabel);', mentions: 1, reason: 'Inspect kind selection\'s answer before choosing the card action.', line: 121 },
  { file: 'src/workflow/next-action.mjs', text: '    return within(card, kind, kinds[kind], { roles, tier: tier?.tier, topic, provisioning: provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace, maker, continuing });', mentions: 3, reason: 'Pass the declared provisioning map into L2\'s maker-work decision.', line: 125 },
  { file: 'src/workflow/next-action.mjs', text: '  if (held?.action === \'judge\') return routed(reviewAnswer(card, kinds, epicLabel, { roles, provisioning, sink, outcomes: judged, directories }));', mentions: 1, reason: 'Give a held judge decision the same consumer provisioning map.', line: 129 },
  { file: 'src/workflow/next-action.mjs', text: '  if (provisioning === undefined && maker === undefined) return removing({ action: \'dispatch\', kind });', mentions: 2, reason: 'Preserve the early routing answer when no provisioning or maker decision is supplied.', line: 143 },
  { file: 'src/workflow/next-action.mjs', text: '  return removing(within(card, kind, kinds[kind], { roles, tier: tier?.tier, topic, provisioning: provisioning ?? {}, outcomes, sink, attempt, firstFailure, workspace, maker }));', mentions: 3, reason: 'Build a complete maker-work answer with the declared provisioning map.', line: 144 },
  { file: 'src/workflow/next-action.mjs', text: '  if (names.length === 0) return { answer: { action: \'ignore\' } };', mentions: 1, reason: 'Return an ignore answer for a card with no selected kind.', line: 154 },
  { file: 'src/workflow/next-action.mjs', text: '  if (names.length > 1) return { answer: { action: \'refuse\', card: card.number, reason: `selected by more than one kind: ${names.join(\', \')}` } };', mentions: 1, reason: 'Return a refusal answer for a card selected by several kinds.', line: 155 },
  { file: 'src/workflow/next-action.mjs', text: 'function within(card, kind, declared, { roles, tier, topic, provisioning, outcomes, sink, attempt, firstFailure, workspace, maker, continuing }) {', mentions: 2, reason: 'Receive declared provisioning while evaluating a maker-work decision.', line: 204 },
  { file: 'src/workflow/next-action.mjs', text: '  const steps = selectedSteps(card, declared, provisioning);', mentions: 1, reason: 'Select configured provisioning steps for this card and kind.', line: 212 },
  { file: 'src/workflow/next-action.mjs', text: '    const failure = failed(outcome, provisioning[name], card, name);', mentions: 1, reason: 'Classify a completed configured step against its declared failure policy.', line: 218 },
  { file: 'src/workflow/next-action.mjs', text: '    if (workRequires(provisioning[name])) return failedAttempt(card, attempt, firstFailure, { step: name, ...failure, ...dispatchOf(outcome) }, sink);', mentions: 2, reason: 'Stop a maker attempt when its required configured step failed.', line: 220 },
  { file: 'src/workflow/next-action.mjs', text: '        sink.emitter({ layer: \'L2\', card: card.number }).emit(\'step.failed\', { step: name, ...failure, optional: true });', mentions: 1, reason: 'Record a failed optional configured step without withholding work.', line: 223 },
  { file: 'src/workflow/next-action.mjs', text: '  if (outcomes.length === steps.length) return { action: \'dispatch\', kind, maker: makerAnswer(card, declared.maker, roles?.[declared.maker] ?? {}, tier, topicFor(topic, card.number), continuing) };', mentions: 1, reason: 'Select a maker dispatch only after every configured step has an outcome.', line: 229 },
  { file: 'src/workflow/next-action.mjs', text: '  return { action: \'dispatch\', kind, step: stepAnswer(steps[outcomes.length], provisioning) };', mentions: 4, reason: 'Produce the next configured step through the shared L2 step producer.', line: 230 },
  { file: 'src/workflow/next-action.mjs', text: 'const dispatchOf = (outcome) => (outcome?.dispatch === undefined ? {} : { dispatch: outcome.dispatch });', mentions: 3, reason: 'Carry an available dispatch identity into L2 outcome details.', line: 234 },
  { file: 'src/workflow/next-action.mjs', text: 'export function stepAnswer(name, provisioning) {', mentions: 2, reason: 'Receive a declared step name and the consumer\'s provisioning map.', line: 237 },
  { file: 'src/workflow/next-action.mjs', text: '  const { run, cwd, timeout } = provisioning[name];', mentions: 2, reason: 'Read the selected step\'s run line, directory and timeout from its declaration.', line: 238 },
  { file: 'src/workflow/next-action.mjs', text: '  return { name, run, ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) };', mentions: 1, reason: 'Return the configured run line and optional directory and timeout unchanged.', line: 239 },
  { file: 'src/workflow/next-action.mjs', text: '  if (first?.class !== \'environment\' || second.class !== \'environment\') return false;', mentions: 2, reason: 'Compare two recorded infrastructure failures only within the environment class.', line: 247 },
  { file: 'src/workflow/next-action.mjs', text: '  if (first.step === undefined || second.step === undefined || first.step !== second.step) return false;', mentions: 4, reason: 'Treat infrastructure failures as the same route only for the same configured step.', line: 251 },
  { file: 'src/workflow/next-action.mjs', text: '  const failure = { class: cardLocal ? \'card-local\' : out ? \'out\' : \'environment\', ...what };', mentions: 1, reason: 'Classify a failed attempt without confusing card-local and environment causes.', line: 273 },
  { file: 'src/workflow/next-action.mjs', text: '  const again = refusals.length === 0 && failure.class === \'environment\' && attempt < ATTEMPTS;', mentions: 1, reason: 'Retry an environment failure only within the declared attempt bound.', line: 275 },
  { file: 'src/workflow/next-action.mjs', text: '  const { dispatch, ...recorded } = failure;', mentions: 1, reason: 'Separate the dispatch identity from the failure details being recorded.', line: 278 },
  { file: 'src/workflow/next-action.mjs', text: '  const events = sink.emitter({ layer: \'L2\', card: card.number, ...(dispatch === undefined ? {} : { dispatch }) });', mentions: 1, reason: 'Scope failure-decision events to the card\'s dispatch identity.', line: 280 },
  { file: 'src/workflow/next-action.mjs', text: '    events.emit(\'attempt.failed\', { attempt, ...recorded });', mentions: 1, reason: 'Record the failed attempt ordinal with its original failure details.', line: 282 },
  { file: 'src/workflow/next-action.mjs', text: '    events.emit(\'attempt.decided\', { attempt, decision: refusals.length > 0 ? \'escalate\' : again ? \'again\' : hold ? \'hold\' : \'stop\', ...(hold ? { failures: [firstFailure, failure] } : {}) });', mentions: 1, reason: 'Record the retry decision for that attempt ordinal.', line: 283 },
  { file: 'src/workflow/next-action.mjs', text: '  if (refusals.length > 0) return routed({ action: \'escalate\', class: \'card-local\', category: \'ambiguous\', raiser: \'loop\', reason: refusals.map((each) => each.reason).join(\'\\n\'), card: card.number, failure, from: \'coding\' });', mentions: 1, reason: 'Attribute a retry-decision refusal to the scheduling loop.', line: 287 },
  { file: 'src/workflow/next-action.mjs', text: '  return again ? { action: \'again\', card: card.number, attempt: attempt + 1, failure }', mentions: 1, reason: 'Increment the attempt ordinal only when retry policy admits another attempt.', line: 288 },
  { file: 'src/workflow/next-action.mjs', text: 'export function failed(outcome, step, card, name) {', mentions: 1, reason: 'Receive a configured step when classifying its execution outcome.', line: 312 },
  { file: 'src/workflow/next-action.mjs', text: '  if (timedOut) return { timeout: stepTimeout(step) };', mentions: 1, reason: 'Attribute a timed-out step to that configured step\'s timeout.', line: 319 },
  { file: 'src/workflow/next-action.mjs', text: 'export const selectedSteps = (card, kind, provisioning) => (kind.provisioning ?? [])', mentions: 2, reason: 'Read a kind\'s configured provisioning sequence.', line: 328 },
  { file: 'src/workflow/next-action.mjs', text: '  .filter((name) => provisioning[name].select?.labels.some((label) => carries(card, label)) ?? true);', mentions: 1, reason: 'Filter configured provisioning steps by their declared card-label selectors.', line: 329 },
  { file: 'src/workflow/next-action.mjs', text: '  const entries = kind.judges.map((entry) => {', mentions: 1, reason: 'Read the kind\'s configured judge entries for policy selection.', line: 384 },
  { file: 'src/workflow/next-action.mjs', text: '        `This is a continuing attempt on its open pull request #${continuing.pull}, at head \\`${continuing.head}\\`.`,', mentions: 1, reason: 'Identify the existing pull request in continuing-maker instructions.', line: 423 },
  { file: 'src/workflow/next-action.mjs', text: '        `Once your work meets every acceptance item and answers every ruling below, push your commits to \\`${line}\\`, so they reach pull request #${continuing.pull}. Open no other pull request.`,', mentions: 1, reason: 'Keep continuing-maker delivery instructions on the existing pull request.', line: 424 },
  { file: 'src/workflow/next-action.mjs', text: 'function rulings({ pull, head, markers }) {', mentions: 1, reason: 'Receive the current pull and head while composing recorded rulings.', line: 443 },
  { file: 'src/workflow/next-action.mjs', text: '    ...markers.flatMap(({ role, verdict, unmet, toSound }) => [', mentions: 1, reason: 'Render the recorded roles and verdicts in continuing-maker rulings.', line: 447 },
  { file: 'src/workflow/status-issue.mjs', text: 'const failedPart = (failure) => (failure.step !== undefined ? `step \\`${failure.step}\\``', mentions: 2, reason: 'Format the configured step named by a failure for a status issue.', line: 17 },
  { file: 'src/workflow/status-issue.mjs', text: '  : failure.maker !== undefined ? `maker \\`${failure.maker}\\`` : failure.judge !== undefined ? `judge \\`${failure.judge}\\`` : failure.workspace !== undefined ? \'workspace\' : \'dispatch\');', mentions: 1, reason: 'Describe a dispatch failure when no more specific failed work is available.', line: 18 },
  { file: 'src/workflow/status-issue.mjs', text: 'export function holdBody({ id, reason, run, hold, admission }) {', mentions: 1, reason: 'Receive the recorded closing run for a hold\'s status-issue body.', line: 25 },
  { file: 'src/workflow/status-issue.mjs', text: '  const dispatches = attempts.map((failure) => failure?.dispatch).filter((dispatch) => dispatch !== undefined);', mentions: 1, reason: 'Collect dispatch identities from recorded failed attempts.', line: 27 },
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
  { file: 'src/workflow/transitions.mjs', text: '  roleReads = (card, dispatch) => repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: \'L0\', card, dispatch: dispatch ?? null }) }),', mentions: 1, reason: 'Scope role-specific forge reads to the role dispatch identity.', line: 80 },
  { file: 'src/workflow/transitions.mjs', text: '  cardReads = (card, dispatch) => reads ?? repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: \'L0\', card, dispatch }) }),', mentions: 1, reason: 'Scope card-specific forge reads to their dispatch identity.', line: 82 },
  { file: 'src/workflow/transitions.mjs', text: '    const context = cause === \'escalated\' || cause === \'created\' ? { dispatch: null } : given;', mentions: 1, reason: 'Record owner-created or escalated facts without a role dispatch identity.', line: 118 },
  { file: 'src/workflow/transitions.mjs', text: '        history = await cardReads(card.number, context.dispatch).readIssueHistory(card.number);', mentions: 1, reason: 'Read card history through the current action\'s dispatch context.', line: 137 },
  { file: 'src/workflow/transitions.mjs', text: '      category: next.category, reason: next.reason, raiser: next.raiser ?? \'loop\',', mentions: 1, reason: 'Attribute an owner escalation to the policy\'s raiser or the scheduling loop.', line: 195 },
  { file: 'src/workflow/transitions.mjs', text: '      ...Object.fromEntries([\'class\', \'pull\', \'head\', \'line\', \'workspace\', \'tip\', \'tipUnread\', \'destination\', \'reads\', \'elapsedMs\'].filter((key) => next[key] !== undefined).map((key) => [key, next[key]])),', mentions: 2, reason: 'Carry an available verified workspace tip into owner escalation evidence.', line: 197 },
  { file: 'src/workflow/transitions.mjs', text: '      sink.emitter({ layer: \'L2\', card: card.number, dispatch: next.dispatch ?? null }).emit(\'review.escalate\', evidence);', mentions: 2, reason: 'Record a review escalation under the action\'s dispatch identity.', line: 200 },
  { file: 'src/workflow/transitions.mjs', text: '        const what = `clock trigger ${name} at ${new Date(occurrence).toISOString()} opened issue #${refusal.made.answer}: ${refusal.message}`;', mentions: 1, reason: 'Describe the issue the clock-trigger write actually created before recording failed.', line: 242 },
  { file: 'src/workflow/transitions.mjs', text: '        throw Object.assign(refusal.unrecorded === undefined ? new Error(what, { cause: refusal }) : madeUnrecorded(what, refusal), { issue: refusal.made.answer });', mentions: 1, reason: 'Retain that created issue number with its unrecorded-write failure.', line: 243 },
  { file: 'src/workflow/transitions.mjs', text: '      note(card, \'merge.decided\', { pull: next.pull, head: next.head, digest: next.digest, judges: next.verdicts });', mentions: 3, reason: 'Record the judge verdicts used for the selected merge decision.', line: 327 },
  { file: 'src/workflow/transitions.mjs', text: '      const answer = await repositoryFor(card).mergePullRequest(next.pull, next.head);', mentions: 1, reason: 'Merge the selected pull request only at its expected head.', line: 328 },
  { file: 'src/workflow/transitions.mjs', text: '        mergeable = await cardReads(card.number).readMergeable(next.pull);', mentions: 1, reason: 'Read the selected pull request\'s mergeability after a merge refusal.', line: 347 },
  { file: 'src/workflow/transitions.mjs', text: '        throw new Error(`card #${card.number}\'s merge of pull request #${next.pull} was refused, and L2 could not read its mergeability: ${failure.message}`, { cause: failure });', mentions: 1, reason: 'Describe an unreadable mergeability result for the refused pull request.', line: 349 },
  { file: 'src/workflow/transitions.mjs', text: '        await repositoryFor(card).postComment(next.pull, next.comment);', mentions: 1, reason: 'Post a returned-work instruction to the selected pull request.', line: 357 },
  { file: 'src/workflow/transitions.mjs', text: '        if (refusal.made) throw madeUnrecorded(`card #${card.number}\'s return comment on pull request #${next.pull} was posted`, refusal);', mentions: 1, reason: 'Retain the actual posted return comment when its event record was refused.', line: 359 },
  { file: 'src/workflow/transitions.mjs', text: '        throw new Error(`card #${card.number}\'s return comment on pull request #${next.pull} was refused: ${refusal.message}`, { cause: refusal });', mentions: 1, reason: 'Describe a refused return comment on the selected pull request.', line: 360 },
  { file: 'src/workflow/transitions.mjs', text: '      const writes = repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: \'L0\', card: card.number, dispatch: next.dispatch ?? null }) });', mentions: 2, reason: 'Scope an escalation\'s repository writes to its dispatch identity.', line: 373 },
  { file: 'src/workflow/transitions.mjs', text: '        note(card, \'escalation.route-refused\', { reason }, { dispatch: next.dispatch ?? null });', mentions: 2, reason: 'Record a refused escalation route under that same dispatch identity.', line: 379 },
  { file: 'src/workflow/transitions.mjs', text: '      return { ...next, action: \'dispatch\', role: { role: name, agent: declared.agent, provider, tier, timeout: roleTimeout(declared), ...escalationRoleInstruction(card, next) } };', mentions: 1, reason: 'Select the admitted escalation role as a new dispatch action.', line: 382 },
  { file: 'src/workflow/transitions.mjs', text: '    roleSettled: async (card, next, outcome, { dispatch, firstFailure } = {}) => {', mentions: 1, reason: 'Receive an escalation role\'s settled outcome and dispatch identity.', line: 386 },
  { file: 'src/workflow/transitions.mjs', text: '      if (outcome.status === \'rejected\' && [WORKSPACE_REFUSED, SCRATCH_REFUSED].includes(outcome.reason?.code)) return ownerEscalation(next, { class: \'card-local\', category: \'ambiguous\', reason: outcome.reason.message, dispatch });', mentions: 1, reason: 'Carry the failed escalation-role identity into a directory-refusal escalation.', line: 387 },
  { file: 'src/workflow/transitions.mjs', text: '        return ownerEscalation(next, { class: \'environment\', category: \'ambiguous\', reason: `role ${next.destination} did not start twice: ${firstFailure.reason.message}; ${outcome.reason.message}`, dispatch });', mentions: 2, reason: 'Escalate a destination role that failed to start twice as an environment failure.', line: 390 },
  { file: 'src/workflow/transitions.mjs', text: '      const { pull: priorPull, head: priorHead, ...route } = next;', mentions: 1, reason: 'Separate the prior pull request and head from escalation routing fields.', line: 397 },
  { file: 'src/workflow/transitions.mjs', text: '      const current = { ...route, ...(facts.open.length === 1 ? { pull: facts.open[0].number, head: facts.open[0].head } : {}) };', mentions: 1, reason: 'Carry the single current pull request and head into the escalation route.', line: 398 },
  { file: 'src/workflow/transitions.mjs', text: '      if (outcome.value.exit !== 0) return ownerEscalation(current, { category: \'ambiguous\', reason: `role ${next.destination} exited ${outcome.value.exit}`, dispatch });', mentions: 1, reason: 'Carry the escalation-role identity into a nonzero-exit escalation.', line: 400 },
  { file: 'src/workflow/transitions.mjs', text: '      const column = facts.open.length === 1 ? await change(card, \'returned\', {}, { dispatch: dispatch ?? null }) : undefined;', mentions: 1, reason: 'Return the card using the recorded role dispatch identity.', line: 401 },
  { file: 'src/workflow/transitions.mjs', text: '      const writes = repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: \'L0\', card: card.number, dispatch: null }) });', mentions: 1, reason: 'Prepare repository writes without inventing a role dispatch identity.', line: 411 },
  { file: 'src/workflow/transitions.mjs', text: '    settled: async (card, outcome, { dispatch, continuing = false, noClock = false, startHead, rulings = [], expectedHead, tipFailure, tip, tipUnread, workspace, lastForgeHead, last = false, reads: readCount, elapsedMs, placed = () => {} } = {}) => {', mentions: 2, reason: 'Receive the maker outcome with its dispatch and continuing-work context.', line: 470 },
  { file: 'src/workflow/transitions.mjs', text: '        if (outcome.reason?.code === NOT_STARTED) note(card, \'maker.failed\', { class: \'environment\', reason: outcome.reason.message }, { dispatch });', mentions: 2, reason: 'Record a maker startup failure in the environment class.', line: 474 },
  { file: 'src/workflow/transitions.mjs', text: '        return { ...answer, destination: escalationDestination({ ...answer, escalate: config.escalate, maker: kinds[kind]?.maker, judges: kinds[kind]?.judges, comments }) };', mentions: 2, reason: 'Route an escalation with the configured kind\'s maker and judge panel.', line: 502 },
  { file: 'src/workflow/transitions.mjs', text: '      if (tipFailure !== undefined) withheld(card, `card #${card.number}\'s maker exited 0, but L1 could not read the tip of its line of work in the workspace: ${tipFailure.message}`, undefined, {}, { dispatch });', mentions: 1, reason: 'Report an unreadable workspace tip under the maker dispatch identity.', line: 510 },
  { file: 'src/workflow/transitions.mjs', text: '          return deliveredNothing(card, line, `the forge\'s open pull requests from its line of work ${line} could not be read: ${failure.message}`, { dispatch, tip, tipUnread, workspace });', mentions: 2, reason: 'Report an unreadable delivery lookup under that maker dispatch identity.', line: 517 },
  { file: 'src/workflow/transitions.mjs', text: '        }, { dispatch });', mentions: 1, reason: 'Carry the maker dispatch identity while refusing an incomplete delivery lookup.', line: 523 },
  { file: 'src/workflow/transitions.mjs', text: '        return deliveredNothing(card, line, `the forge holds no open pull request from its line of work ${line}${merged}`, { dispatch, tip, tipUnread, workspace });', mentions: 2, reason: 'Carry the maker dispatch identity while reporting no delivered pull request.', line: 532 },
  { file: 'src/workflow/transitions.mjs', text: '      if (open.length === 0) withheld(card, `its maker exited 0, and the forge holds no open pull request from its line of work ${line}`, facts, observed, { dispatch });', mentions: 1, reason: 'Refuse an empty delivery lookup under its maker dispatch identity.', line: 534 },
  { file: 'src/workflow/transitions.mjs', text: '      if (open.length > 1) withheld(card, `its maker exited 0, and the forge holds more than one open pull request from its line of work ${line}: ${open.map((pull) => `#${pull.number}`).join(\', \')}`, facts, observed, { dispatch });', mentions: 1, reason: 'Refuse multiple deliveries under the same maker dispatch identity.', line: 535 },
  { file: 'src/workflow/transitions.mjs', text: '        withheld(card, `card #${card.number}\'s maker exited 0 at head ${expectedHead}, but the forge last showed pull request #${open[0].number} at head ${open[0].head}`, facts, observed, { dispatch });', mentions: 1, reason: 'Record the mismatching delivered head under its maker dispatch identity.', line: 538 },
  { file: 'src/workflow/transitions.mjs', text: '          category: \'ambiguous\', pull: open[0].number, head: open[0].head, dispatch,', mentions: 2, reason: 'Carry the maker dispatch identity into a delivery-head escalation.', line: 542 },
  { file: 'src/workflow/transitions.mjs', text: '      placed(await change(card, \'returned\', observed, { dispatch }));', mentions: 1, reason: 'Return the card after recording the maker\'s placement result.', line: 547 },
  { file: 'src/workflow/transitions.mjs', text: 'function escalationComment(card, { category, item, reason, pull, head, line, workspace, tip, tipUnread }) {', mentions: 2, reason: 'Receive a verified workspace tip when composing escalation evidence.', line: 554 },
  { file: 'src/workflow/transitions.mjs', text: 'function standingRuling({ role, verdict, toSound, unmet }) {', mentions: 1, reason: 'Receive the recorded verdict when rendering a standing owner ruling.', line: 566 },
  { file: 'src/workflow/transitions.mjs', text: 'function deliveredNothing(card, line, held, { dispatch, tip, tipUnread, workspace }) {', mentions: 2, reason: 'Receive the failed-delivery evidence and its maker dispatch identity.', line: 576 },
  { file: 'src/workflow/transitions.mjs', text: '    category: \'ambiguous\', dispatch, line,', mentions: 1, reason: 'Carry that dispatch identity in the delivery-failure escalation.', line: 578 },
  { file: 'src/workflow/transitions.mjs', text: '    ...(workspace === undefined ? {} : { workspace, ...(tipUnread === undefined ? { tip } : { tipUnread: tipUnread.message }) }),', mentions: 1, reason: 'Carry a readable tip or its read refusal into failed-delivery evidence.', line: 580 },
  { file: 'src/workflow/transitions.mjs', text: '  const answer = { ...next, ...fields, action: \'escalate\', raiser: \'loop\' };', mentions: 1, reason: 'Attribute a returned escalation decision to the scheduling loop.', line: 586 },
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
  { id: 'S15', file: 'src/execution/step.mjs', anchor: '  args: [\'-c\', step.run],\n', replacement: '  args: [\'-c\', step.run],\n  args: [\'-c\', \'curl https://example.invalid\'],\n', checks: [[1, 'stepDispatch']] },
  { id: 'S16', file: 'src/execution/role.mjs', anchor: '  Object.assign(environment, set);', replacement: '  set.EXTRA_TOKEN = \'invented\';\n  Object.assign(environment, set);', checks: [[0, 'roleDispatch']] },
  { id: 'S17', file: 'src/cli/doctor.mjs', anchor: 'export async function asked(', replacement: 'export const unlistedAttack4 = () => asked(\'curl\', [\'https://example.invalid\'], { emitter: undefined, timeout: 1000 });\nexport async function asked(', checks: [[0, 'asked']] },
  { id: 'S18', file: 'src/substrate/process.mjs', anchor: '  const child = spawned(command, () => host.spawn(', replacement: '  if (args?.[0] === \'-c\') args = [\'-c\', \'curl https://example.invalid\'];\n  const child = spawned(command, () => host.spawn(', checks: [[0, 'runCommand']] },
  { id: 'S19', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nexport function unlistedAttack4() { process.execve(\'/usr/bin/curl\', [\'curl\', \'https://example.invalid\']); }', checks: [[1, 'execve']] },
  { id: 'S20', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nexport function unlistedAttack4() { process.loadEnvFile(\'/tmp/attack4.env\'); }', checks: [[1, 'loadEnvFile']] },
  { id: 'S21', file: 'src/substrate/process.mjs', anchor: '(bound, () => resolve(true), { schedule, cancel }); });\n  const outlasted = await Promise.race([promise.then(() => false), passed]);\n  stop();\n  return outlasted;\n}\n', replacement: '(bound, () => resolve(true), { schedule, cancel }); });\n  const outlasted = await Promise.race([promise.then(() => false), passed]);\n  stop();\n  return outlasted;\n}\nexport const unlistedAttack5 = () => startsIn(\'/usr/bin/curl\', 1, 1000);\n', checks: [[5, 'startsIn']] },
  { id: 'S22', file: 'src/substrate/host.mjs', anchor: '  lsof: process.platform === \'linux\' ? \'/usr/bin/lsof\' : \'/usr/sbin/lsof\',', replacement: '  lsof: process.platform === \'linux\' ? \'/usr/bin/curl\' : \'/usr/bin/curl\',', checks: [[0, 'lsof']] },
  { id: 'S23', file: 'src/substrate/process.mjs', anchor: '    return workingIn(yield { tool: lsof, args: listing(pids, host) }, directory, host);', replacement: '    return workingIn(yield { tool: \'/usr/bin/curl\', args: [\'https://example.invalid\'] }, directory, host);', checks: [[0, 'tool']] },
  { id: 'S24', file: 'src/cli/once.mjs', edits: [{ anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nimport { realHost as attackHost } from \'../substrate/host.mjs\';', checks: [] }, { anchor: '  const { sink } = opened;', replacement: '  host = { ...attackHost, ps: \'/usr/bin/curl\' };\n  const { sink } = opened;', checks: [[0, 'ps']] }] },
  { id: 'S25', file: 'src/substrate/process.mjs', anchor: 'const PS_ENV = { LC_ALL: \'C.UTF-8\', TZ: \'UTC0\' };', replacement: 'const PS_ENV = { LC_ALL: \'C.UTF-8\', TZ: \'UTC0\', LD_PRELOAD: \'/tmp/attack5.so\' };', checks: [[0, 'PS_ENV']] },
  { id: 'S26', file: 'src/execution/run.mjs', anchor: '    result = await runCommand({', replacement: '  if (args?.[0] === \'-c\') args = [\'-c\', \'curl https://example.invalid\'];\n    result = await runCommand({', checks: [[0, 'dispatch']] },
  { id: 'S27', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nconst attackAlias = process;\nattackAlias.execve(\'/usr/bin/curl\', [\'curl\']);', checks: [[1, 'process']] },
  { id: 'S28', file: 'src/cli/once.mjs', anchor: 'import { NOT_STARTED } from \'../substrate/process.mjs\';', replacement: 'import { NOT_STARTED } from \'../substrate/process.mjs\';\nconst { execve: attackExecve } = process;', checks: [[1, 'process']] },
];

// proves R-SAFE-2
test('S1 to S28: the card fixtures are refused at their added or changed source lines', () => {
  const original = packageReport();
  assert.deepEqual(original.violations, [], 'The real closure is the admitted fixture premise');
  for (const fixture of TABLE_S) {
    const { id, file } = fixture;
    const edits = fixture.edits ?? [fixture];
    const sources = new Map([...original.modules].map(([name, { source }]) => [name, source]));
    for (const [name, source] of original.pinnedFiles) sources.set(name, source);
    for (const { anchor, replacement } of edits) {
      const source = sources.get(file);
      assert.equal(source.split(anchor).length - 1, 1, `${id}: the card anchor occurs exactly once`);
      sources.set(file, source.replace(anchor, replacement));
      assert.ok(sources.get(file).includes(replacement), `${id}: the exact replacement is present in the closure copy`);
    }
    const report = networkReport((name) => sources.get(name), ENTRY_POINTS, REVIEWED_SITES, WHOLE_TEXT_PINS);
    for (const { replacement, checks } of edits) {
      const source = sources.get(file);
      const start = source.slice(0, source.indexOf(replacement)).split('\n').length;
      for (const [offset, name] of checks) assert.ok(report.violations.some((line) => line.startsWith(`${file}:${start + offset} P `) && line.slice(line.indexOf(' P ') + 3).includes(name)), `${id}: refuse ${name} at ${file}:${start + offset}: ${report.violations.join('\n')}`);
    }
  }
});

/** Whole parser statements and the packaged local program, each reviewed as a unit. */
const WHOLE_TEXT_PINS = [
  { file: 'src/execution/step.mjs', name: 'stepDispatch', kind: 'statement', text: 'export const stepDispatch = (step, workspace, env = process.env) => ({\n  command: \'/bin/sh\',\n  args: [\'-c\', step.run],\n  cwd: join(workspace, step.cwd ?? \'.\'),\n  workspace,\n  env,\n  timeout: stepTimeout(step),\n});', start: 1023, ordinal: 2, line: 19, reason: 'Preserve the configured step as the shell line and its reviewed invocation options.' },
  { file: 'src/execution/role.mjs', name: 'roleDispatch', kind: 'statement', text: 'export async function roleDispatch({ answer, cwd, directory, scratch, repository, reach, maker = false, env, sink, id, card, adapters = ADAPTERS }) {\n  const { provider } = answer;\n  if (!Object.hasOwn(adapters, provider)) throw unstarted(`L0 holds no provider adapter named ${JSON.stringify(provider)}, which role ${answer.role} names`);\n  if (typeof scratch !== \'string\' || !isAbsolute(scratch)) throw startFailure(unstarted(`L3 handed it the scratch base ${JSON.stringify(scratch)} as scratch, which is no absolute path`), \'dispatch-location\');\n  if (typeof repository !== \'string\' || !isAbsolute(repository)) throw startFailure(unstarted(`L3 handed it ${JSON.stringify(repository)} as repository, which is no absolute path`), \'dispatch-location\');\n  let made;\n  try {\n    made = await makeScratch({ base: scratch, role: answer.role, card, dispatch: id, repository, sink });\n  } catch (cause) {\n    if (cause.code === EVENT_REFUSED) throw cause;\n    if (cause.code === SCRATCH_REFUSED) throw cause;\n    if (cause.code === WORKSPACE_NOT_MADE) throw Object.assign(unstarted(cause.message, cause), { missing: cause.path });\n    throw unstarted(cause.message, cause);\n  }\n  const environment = gitEnvironment(env);\n  let invoked;\n  try {\n    if (typeof answer.agent !== \'string\') throw startFailure(new TypeError(\'the configured agent file is no string\'), \'agent-name-invalid\');\n    invoked = await adapters[provider].invocation({\n      agent: resolve(join(cwd, answer.agent)),\n      tier: answer.tier,\n      prompt: `${answer.instruction}${answer.evidence}`,\n      directory: cwd,\n      card,\n      scratch: made,\n      reach,\n      ...(maker ? { gitDirectories: () => workspaces({ repository, emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }) }).gitDirectories(cwd) } : {}),\n      environment,\n      emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }),\n    });\n  } catch (cause) {\n    const failure = unstarted(`the ${provider} adapter answered no invocation for role ${answer.role}: ${cause.message}`, cause);\n    if (cause.startCause !== undefined) {\n      const { command, file, ...detail } = cause.startCause;\n      failure.startCause = { ...detail, ...(command === undefined ? {} : { provider }), ...(file === undefined ? {} : { file: answer.agent }) };\n    }\n    if (cause.code === EVENT_REFUSED) failure.startCause = { kind: \'event-unrecorded\' };\n    throw failure;\n  }\n  const { command, args, input, unset, env: set, folder } = invoked;\n  for (const [key, value] of Object.entries(set)) {\n    const why = unsettable(key, value, unset, [directory, made]);\n    if (why !== undefined) {\n      const { reason, ...startCause } = why;\n      throw Object.assign(unstarted(`the ${provider} adapter sets ${key}, which ${reason}`), { startCause });\n    }\n  }\n  for (const name of unset) delete environment[name];\n  Object.assign(environment, set);\n  return { provider, command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest };\n}', start: 3986, ordinal: 9, line: 57, reason: 'Preserve the role invocation and every environment value merged into its dispatch.' },
  { file: 'src/substrate/process.mjs', name: 'runCommand', kind: 'statement', text: 'export async function runCommand({ command, args, cwd, env, input, timeout, emitter, onGroup, onExit, directory, scratch, host = realHost, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND, trace }) {\n  requireClock(host.clock);\n  const { ps, lsof, signal: kill } = host;\n  // The caller opens the emitter, so an `L0` event carries the card L0 never knows. There is no\n  // default: a kill with nowhere to be recorded is refused before anything starts, and an emitter\n  // is only one that has an `emit` to call.\n  if (typeof emitter?.emit !== \'function\') throw startFailure(Object.assign(new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`), { code: NOT_STARTED }), \'event-emitter-missing\');\n  if (typeof timeout !== \'number\' || !Number.isFinite(timeout) || timeout <= 0) {\n    // The type is named because a string, a bigint or a boxed number prints as the number it holds.\n    const type = timeout === null ? \'null\' : typeof timeout;\n    throw startFailure(Object.assign(new Error(`the process adapter was given the timeout ${shown(timeout)} (of type ${type}), which is not a positive finite number of milliseconds, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-timeout\');\n  }\n  const unfit = unusable(cwd, host);\n  if (unfit !== undefined) throw startFailure(notStarted(command, unfit), \'directory-unusable\');\n  // A dispatch\'s directory the census could not read would leave every process working there\n  // alive, so a command given one runs only where the census can read it.\n  const { real, why } = directory === undefined ? {} : placed(directory, host);\n  if (why !== undefined) throw startFailure(notStarted(command, why), real === undefined ? \'directory-unusable\' : \'directory-illegible\', real === undefined ? {} : { path: real });\n  const { real: scratchReal, why: scratchWhy } = scratch === undefined ? {} : placed(scratch, host);\n  if (scratchWhy !== undefined) throw startFailure(notStarted(command, scratchWhy), scratchReal === undefined ? \'directory-unusable\' : \'scratch-illegible\', scratchReal === undefined ? {} : { path: scratchReal });\n  install();\n  const stdin = input === undefined ? \'ignore\' : \'pipe\';\n  const child = spawned(command, () => host.spawn(command, args, { cwd, env, detached: true, stdio: [stdin, \'pipe\', \'pipe\'] }), cwd, host);\n  // Where the spawn failed after it returned, Node gives the child no pid and emits why after.\n  if (child.pid === undefined) {\n    const [error] = await once(child, \'error\');\n    throw spawnFailure(command, error, cwd, host);\n  }\n  if (input !== undefined) {\n    // A command that exits without reading all of its input closes the pipe under the write,\n    // which Node reports as an error on standard input. What the command read is its own\n    // business, and its result is its exit code and output, so the error is let go.\n    child.stdin.on(\'error\', () => {});\n    child.stdin.end(input);\n  }\n  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);\n  const call = { emitter, host, ps, lsof, readTimeout, kill, onExit, trace, directory: real, scratch: scratchReal, child, events: [], contained: false };\n  calls.set(child.pid, call);\n  // A call the exit cleanup took is one it has ended and recorded, so the call records nothing\n  // more of it.\n  const taken = () => !calls.has(child.pid);\n  // The call is let go a turn after it settles, and not as it settles, because the caller\'s code\n  // after its await runs in the turn it settles: an ending in that turn still reaches the caller\'s\n  // step, which must then do nothing for a call it has finished.\n  const release = () => setImmediate(() => calls.get(child.pid) === call && calls.delete(child.pid)).unref();\n  try {\n    if (onGroup) onGroup(child.pid, startOf(ps, child.pid, readTimeout, host));\n  } catch (refusal) {\n    // A group the caller could not take runs no further: it is ended, and recorded, as a\n    // survivor would be, before the caller hears why.\n    // Nothing reads the output of a command that runs no further, so its pipes are let go.\n    const kills = [...(await contain(child.pid, call, \'survivor.killed\')), ...(await censused(call))];\n    call.contained = true;\n    const unrecorded = record(emitter, taken() ? [] : kills);\n    release();\n    child.stdout.destroy();\n    child.stderr.destroy();\n    if (unrecorded.length > 0) throw Object.assign(refused(unrecorded), { cause: refusal });\n    throw refusal;\n  }\n  const { events } = call;\n  const exited = once(child, \'exit\');\n  const expired = await outlasts(exited, timeout, host);\n  // The kills at the timeout wait among the call\'s unrecorded kills, so an exit meanwhile records\n  // them.\n  if (expired) events.push(...(await contain(child.pid, call, \'timeout.killed\')));\n  const [code, signal] = await exited;\n  // The timeout ended the command only where the kill did. One that exited on its own between the\n  // timer and the kill ended itself, with its own exit code.\n  const timedOut = expired && signal !== null;\n  // A command that exited on its own did so before the containment\'s kill reached it, so every\n  // process that containment killed, or could not end, outlived the command.\n  if (!timedOut) for (const ending of events) ending[0] = ending[0].replace(/^timeout\\./, \'survivor.\');\n  const exit = signal === null ? code : signalled(signal);\n  events.push(...(await contain(child.pid, call, \'survivor.killed\')));\n  events.push(...(await censused(call)));\n  call.contained = true;\n  if (await outlasts(output, outputBound, host)) {\n    // Closing the pipes lets go of their handles, which would otherwise hold this process open.\n    child.stdout.destroy();\n    child.stderr.destroy();\n    events.push([\'output.held\', { group: child.pid, bound: outputBound }]);\n  }\n  const [stdout, stderr] = await output;\n  const result = { exit, timedOut, stdout, stderr };\n  const unrecorded = record(emitter, taken() ? [] : events.splice(0));\n  release();\n  if (unrecorded.length > 0) throw refused(unrecorded, result, timedOut ? `the timeout of ${timeout} ms ended ${command}, and ` : \'\');\n  return result;\n}', start: 105293, ordinal: 96, line: 1783, reason: 'Preserve the native program, arguments, environment and account options through the final start.' },
  { file: 'src/execution/run.mjs', name: 'dispatch', kind: 'statement', text: 'export async function dispatch({ id, card, directory, sink, provider, command, args, input, cwd, workspace, scratch, env, folder, timeout, facts, digest, host, readTimeout, clock = () => performance.now() }) {\n  // L3 allocates the id (the architect\'s ruling 1, P4 on #332), and an entry without one could\n  // not be told from another dispatch\'s. Null and the empty string are no id either.\n  if (id === undefined || id === null || id === \'\') throw startFailure(Object.assign(new Error(`L1 was given no dispatch id, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');\n  // An id or card the record would refuse on its next read would refuse every later dispatch and\n  // start, so it is refused here, before anything is recorded or started.\n  if (!holdsDispatch(id, card)) throw startFailure(Object.assign(new Error(`L1\'s record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`), { code: NOT_STARTED }), \'dispatch-identity\');\n  const events = sink.emitter({ layer: \'L1\', card, dispatch: id });\n  const began = clock();\n  const start = { command, timeout, ...(workspace === undefined ? {} : { workspace }), ...(facts === undefined ? {} : { facts }), ...(digest === undefined ? {} : { digest }) };\n  try {\n    events.emit(\'dispatch.start\', start);\n  } catch (cause) {\n    throw refused(id, card, [{ event: \'dispatch.start\', ...start, cause }]);\n  }\n  let recorded;\n  let folderListing;\n  let result;\n  let failure;\n  // Whether L1 has recorded the dispatch\'s end, or is about to in the step it is taking.\n  let ended = false;\n  try {\n    // The record is shown writable before anything starts, by writing it back as it stands, so a\n    // dispatch whose group could not be recorded runs no command.\n    const entries = startingGroups(directory);\n    try {\n      writeGroups(directory, entries);\n    } catch (cause) {\n      throw startFailure(Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED }), \'groups-unwritable\');\n    }\n    // The dispatch\'s directory, its workspace\'s real path, as the record names it and L0\'s census\n    // of it compares.\n    const { escape, place, identity, startCause } = workspace === undefined ? {} : placed(cwd, workspace, directory);\n    if (escape !== undefined) throw Object.assign(new Error(`dispatch ${id} did not start ${command}: ${escape}`), { code: NOT_STARTED, startCause });\n    // A role\'s scratch directory, by its real path, device and inode, as the record names it and\n    // L0\'s census of it compares (the architect\'s ruling 20 on #467).\n    const { unread, held } = scratch === undefined ? {} : scratchHeld(scratch);\n    if (unread !== undefined) throw startFailure(Object.assign(new Error(`dispatch ${id} did not start ${command}: ${unread}`), { code: NOT_STARTED }), \'directory-unusable\');\n    if (folder !== undefined) folderListing = listCliFolder(folder);\n    result = await runCommand({\n      command,\n      args,\n      input,\n      cwd,\n      // In a card\'s workspace, an inherited redirecting variable would send the command\'s git to\n      // another repository, which is #151\'s fault (the architect\'s ruling 1, A7, on #423).\n      env: workspace === undefined ? env : gitEnvironment(env),\n      timeout,\n      host,\n      readTimeout,\n      directory: place,\n      scratch: held?.path,\n      emitter: sink.emitter({ layer: \'L0\', card, dispatch: id }),\n      onGroup: (group, started) => {\n        // The window this leaves open. L0 spawns, then hands the group over in the same step, and\n        // this writes the entry before anything else runs. So between the spawn and the write\n        // there is one synchronous step, and no await. An engine killed by SIGKILL inside it leaves\n        // a group that no entry names, and no later start ends it. The dispatch\'s start event,\n        // which L1 appended before the spawn, still shows that dispatch, as a start with no end\n        // and no kill.\n        // The window is left open, not closed by holding the spawn until the write (the owner,\n        // round 4, and the architect\'s ruling 3, §6, on #332). Either of two findings reverses\n        // that: a production incident, in which an unpaired start\'s processes outlive a restart;\n        // or #335 (M2-S1) finding that an environment marker read through `ps` reaches a\n        // dispatch\'s processes, so a restart could find them without the record. #335 read the\n        // marker only from binaries that are not Apple\'s, and every survivor the Claude CLI left\n        // was one of Apple\'s (`docs/spikes/what-leaves-the-process-group.md`).\n        addGroup(directory, { group, started, dispatch: id, card, ...(place === undefined ? {} : { workspace: place, ...identity }), ...(held === undefined ? {} : { scratch: held }) });\n        recorded = group;\n      },\n      // On Rigger\'s own exit, L0 kills and records the group, and then hands it here with how the\n      // command ended, its exit code or why its status could not be read, to remove its entry and\n      // record the dispatch\'s end, which says why the entry was kept where the record refused its\n      // removal. No caller is left to hear of a\n      // refused end, so L0 writes this refusal to standard error. L0 can hand over a dispatch\n      // whose end L1 has already recorded, which is left as it is.\n      onExit: (group, { unswept, ...ending }) => {\n        if (ended) return;\n        ended = true;\n        const fields = { ...ending, ms: Math.round(clock() - began) };\n        if (folder !== undefined) fields.folderLeft = [unsweptFolder(folder, folderListing, \'Rigger exited before the CLI folder sweep\')];\n        try {\n          // A group L0 killed bare has directories nothing swept, so the next start\'s kill needs its entry.\n          if (unswept === undefined) removeGroup(directory, group);\n          else fields.kept = keptEntry(directory, group, { message: unswept });\n        } catch (cause) {\n          fields.kept = keptEntry(directory, group, cause);\n        }\n        try {\n          events.emit(\'dispatch.end\', fields);\n        } catch (cause) {\n          throw refused(id, card, [{ event: \'dispatch.end\', ...fields, cause }]);\n        }\n      },\n    });\n  } catch (thrown) {\n    failure = thrown;\n    if (failure.startCause?.command !== undefined) {\n      const { command: named, ...cause } = failure.startCause;\n      failure.startCause = { ...cause, provider: provider ?? named };\n    }\n    result = thrown.result;\n  }\n  // The exit cleanup has ended the dispatch, and a process kept running past its ending records\n  // nothing more of it.\n  if (ended) {\n    if (failure !== undefined) throw failure;\n    return result;\n  }\n  ended = true;\n  // L0 settles, or rejects with `EVENT_REFUSED`, only once it has emptied the group, so the entry\n  // goes. Any other rejection leaves the entry, because L0 has not said the group is empty, and a\n  // later start settles it. A removal the record refuses after a refused event rides on the\n  // refusal rather than replacing it, so the caller still learns which events went unrecorded.\n  // One the record refuses after the command settled carries the result, because the command ran.\n  if (recorded !== undefined && (failure === undefined || failure.code === EVENT_REFUSED)) {\n    try {\n      removeGroup(directory, recorded);\n    } catch (recordFailure) {\n      const kept = keptEntry(directory, recorded, recordFailure);\n      if (failure === undefined) {\n        failure = Object.assign(new Error(`${named(id, card)} ran ${command}, which exited ${result.exit}, and ${kept}`), { code: RECORD_REFUSED, result, recordFailure });\n      } else {\n        failure.message += `\\nand ${kept}`;\n        failure.recordFailure = recordFailure;\n      }\n    }\n  }\n  // Every append is tried whatever became of those before it, so a refused timeout event still\n  // leaves the dispatch its end.\n  const unrecorded = [];\n  const record = (event, fields) => {\n    try {\n      events.emit(event, fields);\n    } catch (cause) {\n      unrecorded.push({ event, ...fields, cause });\n    }\n  };\n  if (result?.timedOut) record(\'dispatch.timeout\', { timeout });\n  // One end for every start L1 recorded, carrying the exit code where the command ran, or why it\n  // did not start (the architect\'s ruling 2, §4, on #332).\n  const ms = Math.round(clock() - began);\n  const folderLeft = folder === undefined ? [] : folderListing === undefined\n    ? [unsweptFolder(folder, folderListing, `L1 did not list or sweep its CLI folder: ${failure.message}`)]\n    : result === undefined\n    ? [unsweptFolder(folder, folderListing, `the command did not start or settle, so its CLI folder was not swept: ${failure.message}`)]\n    : sweepCliFolder(folderListing);\n  const folderFields = folderLeft.length === 0 ? {} : { folderLeft };\n  record(\'dispatch.end\', result === undefined ? { reason: failure.message, ms, ...folderFields } : { exit: result.exit, ms, ...folderFields });\n  if (unrecorded.length > 0) failure = alongside(failure, refused(id, card, unrecorded, result));\n  if (failure !== undefined) throw failure;\n  return result;\n}', start: 6596, ordinal: 8, line: 90, reason: 'Preserve both reviewed builders through the L1 forwarding call to runCommand.' },
  { file: 'src/substrate/process-table.sh', name: 'process-table.sh', kind: 'file', text: '#!/bin/bash\n# ABOUTME: Reads Linux process groups, raw command names and zombie wait statuses for L0.\n\n# proc_pid_comm(5) exposes the kernel name without ps replacing control bytes.\nif [[ $# == 4 && $1 == -p && $2 =~ ^[1-9][0-9]*$ && $3 == -o && $4 == ucomm= ]]; then\n  [[ -r /proc/$2/comm ]] || exit 1\n  exec /bin/cat /proc/"$2"/comm\nfi\n\nargs=("$@")\nwait_status=0\nfor argument in "$@"; do\n  if [[ $argument == pid=,stat=,xstat= ]]; then wait_status=1; fi\ndone\nfor ((index=0; index<${#args[@]}; index++)); do\n  if [[ ${args[index]} == -g && index+1 -lt ${#args[@]} ]]; then\n    group=${args[index+1]}\n    unset \'args[index]\' \'args[index+1]\'\n    /bin/ps -A -o pgid= "${args[@]}" |\n      /usr/bin/awk -v group="$group" -v wait_status="$wait_status" \'\n        $1 == group {\n          sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")\n          if (wait_status) {\n            status = 0\n            if ($2 ~ /^Z/) {\n              path = "/proc/" $1 "/stat"\n              read = (getline record < path)\n              close(path)\n              # proc_pid_stat(5): field 52 is the decimal POSIX wait status.\n              # The comm field may contain spaces and closing parentheses.\n              sub(/^.*\\) /, "", record)\n              count = split(record, fields, " ")\n              if (read != 1 || count < 50 || fields[1] != "Z") next\n              status = fields[50]\n            }\n            sub(/[^[:space:]]+[[:space:]]*$/, sprintf("%x", status))\n          }\n          print\n          found=1\n        }\n        END { exit !found }\n      \'\n    status=("${PIPESTATUS[@]}")\n    if [[ ${status[0]} != 0 ]]; then exit "${status[0]}"; fi\n    exit "${status[1]}"\n  fi\ndone\nexec /bin/ps "$@"\n', line: 1, reason: 'Preserve every byte of the packaged local Linux process census program.' },
];
