// ABOUTME: The one boundary test: holds each directory under src/ to the forge adapter's sides it
// may import, and to the config keys, card facts and processes its layer may touch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boundaryReport, sourceTree } from './layer-boundaries.mjs';

/**
 * The smallest tree the rules read: the forge adapter's three side modules and the one module
 * holding their runners. Each fixture adds the module it is about to it. The names in it are
 * placeholders standing for whatever a side exports, not the adapter's operations.
 */
const ADAPTER = {
  'src/substrate/forge/runners.mjs': [
    'export const request = (document) => [document];',
    'export function readRunner(args) { return args; }',
    'export function schemaWriteRunner(args) { return readRunner(args); }',
    'export function itemWriteRunner(args) { return readRunner(args); }',
  ].join('\n'),
  'src/substrate/forge/read.mjs': "import { readRunner } from './runners.mjs';\nexport function look() { return readRunner([]); }",
  'src/substrate/forge/schema-write.mjs': "import { schemaWriteRunner } from './runners.mjs';\nexport function shape() { return schemaWriteRunner([]); }",
  'src/substrate/forge/item-write.mjs': "import { itemWriteRunner } from './runners.mjs';\nexport function write() { return itemWriteRunner([]); }",
};

/** The report on the adapter plus `modules`, a map of path to source. */
const reportOn = (modules) => boundaryReport(new Map(Object.entries({ ...ADAPTER, ...modules })));

/** The violations' messages, one string each, so an assertion failure shows them whole. */
const messages = (modules) => reportOn(modules).violations.map((violation) => violation.message);

/** Asserts that `modules` breaks `rule` in `file`, and that the message names both. */
function assertBreaks(modules, file, rule) {
  const found = messages(modules);
  assert.ok(
    found.some((message) => message.startsWith(`${file} `) && message.includes(`breaks ${rule}:`)),
    `expected ${file} to break ${rule}; the report says:\n${found.join('\n') || '(nothing)'}`,
  );
}

test('the source tree at this head breaks no rule, and exempts only doctor\'s load of the consumer\'s config', () => {
  const report = boundaryReport(sourceTree());

  assert.deepEqual(report.violations.map((violation) => violation.message), []);
  assert.deepEqual(report.exempt.map((exemption) => exemption.file), ['src/cli/doctor.mjs']);
});

test('the fixture adapter alone breaks no rule, so every failure below is the module it adds', () => {
  assert.deepEqual(messages({}), []);
});

test('rule 1: a module under src/scheduling/ importing the item-write or the schema-write side fails', () => {
  assertBreaks({ 'src/scheduling/pull.mjs': "import { write } from '../substrate/forge/item-write.mjs';" }, 'src/scheduling/pull.mjs', 'rule 1');
  assertBreaks({ 'src/scheduling/pull.mjs': "import { shape } from '../substrate/forge/schema-write.mjs';" }, 'src/scheduling/pull.mjs', 'rule 1');
});

test('rule 1: a runner is its side, so src/scheduling/ importing a write runner from the runners module fails', () => {
  assertBreaks({ 'src/scheduling/pull.mjs': "import { itemWriteRunner } from '../substrate/forge/runners.mjs';" }, 'src/scheduling/pull.mjs', 'rule 1');
  assertBreaks({ 'src/scheduling/pull.mjs': "import { schemaWriteRunner } from '../substrate/forge/runners.mjs';" }, 'src/scheduling/pull.mjs', 'rule 1');
});

test('any directory may import the read side and the runners module\'s shared helpers', () => {
  const modules = {};
  for (const directory of ['scheduling', 'workflow', 'cli', 'observation']) {
    modules[`src/${directory}/reads.mjs`] = [
      "import { look } from '../substrate/forge/read.mjs';",
      "import { readRunner, request } from '../substrate/forge/runners.mjs';",
    ].join('\n');
  }
  assert.deepEqual(messages(modules), []);
});

test('rule 5: the C1 shape, a module under src/cli/ importing the item-write side to set a card\'s Status, fails', () => {
  const verb = [
    "import { write } from '../substrate/forge/item-write.mjs';",
    "export const promote = (card) => write(card, 'Status', 'Done');",
  ].join('\n');
  assertBreaks({ 'src/cli/promote.mjs': verb }, 'src/cli/promote.mjs', 'rule 5');
});

test('rule 5: an import of the item-write side from anywhere but src/workflow/ fails, and one from src/workflow/ does not', () => {
  assertBreaks({ 'src/observation/peek.mjs': "import { write } from '../substrate/forge/item-write.mjs';" }, 'src/observation/peek.mjs', 'rule 5');
  assertBreaks({ 'src/substrate/forge/read.mjs': "import { itemWriteRunner } from './runners.mjs';" }, 'src/substrate/forge/read.mjs', 'rule 5');
  assert.deepEqual(messages({ 'src/workflow/move.mjs': "import { write } from '../substrate/forge/item-write.mjs';" }), []);
});

test('rule 6: an import of the schema-write side from anywhere but src/cli/ fails, and one from src/cli/ does not', () => {
  assertBreaks({ 'src/workflow/shape.mjs': "import { shape } from '../substrate/forge/schema-write.mjs';" }, 'src/workflow/shape.mjs', 'rule 6');
  assert.deepEqual(messages({ 'src/cli/setup.mjs': "import { shape } from '../substrate/forge/schema-write.mjs';" }), []);
});

test('a namespace import binds every export, so importing the item-write side as a namespace from src/cli/ fails', () => {
  assertBreaks({ 'src/cli/all.mjs': "import * as side from '../substrate/forge/item-write.mjs';" }, 'src/cli/all.mjs', 'rule 5');
  assertBreaks({ 'src/cli/all.mjs': "import * as runners from '../substrate/forge/runners.mjs';" }, 'src/cli/all.mjs', 'rule 5');
});

test('a wrapper the runners module adds around a write runner is on that runner\'s side', () => {
  const modules = {
    'src/substrate/forge/runners.mjs': [
      ADAPTER['src/substrate/forge/runners.mjs'],
      'export function relay(args) { return itemWriteRunner(args); }',
      'export const alias = schemaWriteRunner;',
      'const { unpacked } = { unpacked: itemWriteRunner };',
      'export { unpacked };',
      'export const arrow = (args) => itemWriteRunner(args);',
    ].join('\n'),
    'src/cli/relay.mjs': "import { relay } from '../substrate/forge/runners.mjs';",
    'src/workflow/alias.mjs': "import { alias } from '../substrate/forge/runners.mjs';",
    'src/cli/unpacked.mjs': "import { unpacked } from '../substrate/forge/runners.mjs';",
    'src/cli/arrow.mjs': "import { arrow } from '../substrate/forge/runners.mjs';",
  };
  assertBreaks(modules, 'src/cli/relay.mjs', 'rule 5');
  assertBreaks(modules, 'src/workflow/alias.mjs', 'rule 6');
  assertBreaks(modules, 'src/cli/unpacked.mjs', 'rule 5');
  assertBreaks(modules, 'src/cli/arrow.mjs', 'rule 5');
});

test('the re-export route: src/workflow/ re-exporting an item-write binding fails, and so does src/cli/ importing it from there', () => {
  const modules = {
    'src/workflow/relay.mjs': "export { write } from '../substrate/forge/item-write.mjs';",
    'src/cli/promote.mjs': "import { write } from '../workflow/relay.mjs';",
  };
  assertBreaks(modules, 'src/workflow/relay.mjs', 'the re-export rule');
  assertBreaks(modules, 'src/cli/promote.mjs', 'rule 5');
});

test('the re-export rule follows every way a module can hand on a binding it imported', () => {
  const shapes = {
    'a local export of the import': "import { write } from '../substrate/forge/item-write.mjs';\nexport { write as move };",
    'an alias bound to the import': "import { write } from '../substrate/forge/item-write.mjs';\nexport const move = write;",
    'a default export of the import': "import { write } from '../substrate/forge/item-write.mjs';\nexport default write;",
    'a star export of the side': "export * from '../substrate/forge/item-write.mjs';",
    'a namespace export of the side': "export * as side from '../substrate/forge/item-write.mjs';",
  };
  for (const [shape, source] of Object.entries(shapes)) {
    const found = messages({ 'src/workflow/relay.mjs': source });
    assert.ok(found.some((message) => message.includes('breaks the re-export rule:')), `${shape}: ${found.join('\n') || '(nothing)'}`);
  }
});

test('src/cli/ re-exporting a schema-write binding fails', () => {
  assertBreaks({ 'src/cli/relay.mjs': "export { shape } from '../substrate/forge/schema-write.mjs';" }, 'src/cli/relay.mjs', 'the re-export rule');
});

test('the ruled call paths pass: L3 importing an L2 function that writes, and the CLI importing L3\'s claim-only call', () => {
  const modules = {
    'src/workflow/transitions.mjs': [
      "import { write } from '../substrate/forge/item-write.mjs';",
      'export async function claim(card) { return write(card); }',
    ].join('\n'),
    'src/scheduling/claims.mjs': [
      "import { claim } from '../workflow/transitions.mjs';",
      'export async function claimOnly(cards, limit) { return Promise.all(cards.slice(0, limit).map(claim)); }',
    ].join('\n'),
    'src/cli/once.mjs': "import { claimOnly } from '../scheduling/claims.mjs';\nexport const once = (cards) => claimOnly(cards, 1);",
  };
  assert.deepEqual(messages(modules), []);
});

test('rule 2: a module under src/scheduling/ naming kinds, a card\'s labels or a card\'s body fails, and a comment does not', () => {
  assertBreaks({ 'src/scheduling/pull.mjs': 'export const pull = (config) => config.kinds;' }, 'src/scheduling/pull.mjs', 'rule 2');
  assertBreaks({ 'src/scheduling/pull.mjs': 'export const pull = (card) => card.labels;' }, 'src/scheduling/pull.mjs', 'rule 2');
  assertBreaks({ 'src/scheduling/pull.mjs': "export const pull = (card) => card['body'];" }, 'src/scheduling/pull.mjs', 'rule 2');
  assertBreaks({ 'src/scheduling/pull.mjs': 'export const pull = ({ body }) => body;' }, 'src/scheduling/pull.mjs', 'rule 2');
  assert.deepEqual(messages({ 'src/scheduling/pull.mjs': '// The pull never reads kinds, labels or a body.\nexport const pull = (card) => card.number;' }), []);
});

test('rule 3: a module under src/scheduling/ reading board.priority from the config fails, in each shape', () => {
  const shapes = [
    'export const rank = (config) => config.board.priority;',
    'export const rank = (config) => config.board?.priority;',
    "export const rank = (config) => config['board']['priority'];",
    'export const rank = (config) => { const { priority } = config.board; return priority; };',
    'export const rank = ({ board: { priority } }) => priority;',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3 leaves a priority L0 handed over alone: an item\'s own priority is not the config\'s', () => {
  assert.deepEqual(messages({ 'src/scheduling/rank.mjs': 'export const rank = (item) => item.priority;' }), []);
});

test('rule 4: a module under src/cli/ naming concurrency fails, and passing the config on does not', () => {
  assertBreaks({ 'src/cli/run.mjs': 'export const run = (config) => config.concurrency;' }, 'src/cli/run.mjs', 'rule 4');
  assertBreaks({ 'src/cli/run.mjs': "export const run = (config) => config['concurrency'];" }, 'src/cli/run.mjs', 'rule 4');
  assert.deepEqual(messages({ 'src/cli/run.mjs': 'export const run = (config, start) => start(config);' }), []);
});

test('rule 7: node:child_process is imported only by the runners module, doctor.mjs and init.mjs', () => {
  assertBreaks({ 'src/workflow/spawn.mjs': 'import { spawnSync } from "node:child_process";' }, 'src/workflow/spawn.mjs', 'rule 7');
  assertBreaks({ 'src/cli/spawn.mjs': "import { spawnSync } from 'child_process';" }, 'src/cli/spawn.mjs', 'rule 7');
  assertBreaks({ 'src/cli/spawn.mjs': 'export { spawnSync } from "node:child_process";' }, 'src/cli/spawn.mjs', 'rule 7');
  const allowed = 'import { spawnSync } from "node:child_process";';
  assert.deepEqual(messages({
    'src/cli/doctor.mjs': allowed,
    'src/cli/init.mjs': allowed,
    'src/substrate/forge/runners.mjs': `${allowed}\n${ADAPTER['src/substrate/forge/runners.mjs']}`,
  }), []);
});

test('rule 7: a gh string literal outside the runners module fails in any quotes, and one in a comment does not', () => {
  for (const literal of ["'gh'", '"gh"', '`gh`', "'\\x67h'"]) {
    assertBreaks({ 'src/cli/doctor.mjs': `export const forge = ${literal};` }, 'src/cli/doctor.mjs', 'rule 7');
  }
  assert.deepEqual(messages({ 'src/cli/doctor.mjs': "// spawns 'gh' only through the read runner\nexport const said = '`gh auth status` exited 0';" }), []);
  assert.deepEqual(messages({ 'src/substrate/forge/runners.mjs': `${ADAPTER['src/substrate/forge/runners.mjs']}\nconst FORGE = 'gh';` }), []);
});

test('a dynamic import() the test cannot resolve to a file under src/ fails, naming the file', () => {
  assertBreaks({ 'src/workflow/load.mjs': 'export const load = (name) => import(name);' }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  assertBreaks({ 'src/workflow/load.mjs': "export const load = () => import('node:child_process');" }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  assertBreaks({ 'src/workflow/load.mjs': "export const load = () => import('./missing.mjs');" }, 'src/workflow/load.mjs', 'the dynamic-import rule');
});

test('a dynamic import() of a module under src/ binds its every export, so the rules read it', () => {
  assertBreaks({ 'src/cli/late.mjs': "export const late = () => import('../substrate/forge/item-write.mjs');" }, 'src/cli/late.mjs', 'rule 5');
});

test('the config-load exception is doctor.mjs\'s alone: the same load anywhere else fails', () => {
  const load = 'export const read = async (path) => (await import(pathToFileURL(path))).default;';
  const exempt = reportOn({ 'src/cli/doctor.mjs': load });
  assert.deepEqual(exempt.violations, []);
  assert.deepEqual(exempt.exempt.map((exemption) => exemption.file), ['src/cli/doctor.mjs']);
  assertBreaks({ 'src/cli/init.mjs': load }, 'src/cli/init.mjs', 'the dynamic-import rule');
});

test('a static import the test cannot resolve fails closed, naming the file', () => {
  assertBreaks({ 'src/cli/lost.mjs': "import { x } from './missing.mjs';" }, 'src/cli/lost.mjs', 'the unresolved-import rule');
  assertBreaks({ 'src/cli/lost.mjs': "import { x } from 'some-package';" }, 'src/cli/lost.mjs', 'the unresolved-import rule');
  assertBreaks({ 'src/cli/lost.mjs': "import { nothing } from '../substrate/forge/read.mjs';" }, 'src/cli/lost.mjs', 'the unresolved-import rule');
});

test('a module leaving its semicolons to the parser is read the same', () => {
  const source = "import { write } from '../substrate/forge/item-write.mjs'\nexport const promote = (card) => write(card)";
  assertBreaks({ 'src/cli/promote.mjs': source }, 'src/cli/promote.mjs', 'rule 5');
  const runners = `${ADAPTER['src/substrate/forge/runners.mjs']}\nconst limit = 1\nexport function relay(args) { return itemWriteRunner(args) }`;
  assertBreaks({ 'src/substrate/forge/runners.mjs': runners, 'src/cli/relay.mjs': "import { relay } from '../substrate/forge/runners.mjs'" }, 'src/cli/relay.mjs', 'rule 5');
});

/**
 * Every way a module can hand on a binding it imported as a value of its own, with and without
 * semicolons. `SIDE` stands for the side module's path and `NAME` for its export.
 */
const HAND_ONS = {
  'a default export, with no semicolon': "import { NAME } from 'SIDE'\nexport default NAME",
  'a default export, with a semicolon': "import { NAME } from 'SIDE';\nexport default NAME;",
  'a parenthesised default export': "import { NAME } from 'SIDE';\nexport default (NAME);",
  'an exported alias, with no semicolon': "import { NAME } from 'SIDE'\nexport const writes = NAME",
  'an exported alias, with a semicolon': "import { NAME } from 'SIDE';\nexport const writes = NAME;",
  'an alias exported by name': "import { NAME } from 'SIDE'\nconst writes = NAME\nexport { writes }",
  'a binding assigned after its declaration': "import { NAME } from 'SIDE';\nexport let writes; writes = NAME;",
  'a binding assigned on its own line': "import { NAME } from 'SIDE'\nexport let writes\nwrites = NAME",
  'an object holding the import': "import { NAME } from 'SIDE';\nexport const writes = { NAME };",
  'an object keyed to the import': "import { NAME } from 'SIDE';\nexport const writes = { go: NAME };",
  'a conditional choosing the import': "import { NAME } from 'SIDE';\nexport const writes = true ? NAME : null;",
  // Round 2's counterexamples: a line the parser ends where a line reader joined it to the next.
  'an alias after a line ending in Array.from': "import { NAME } from 'SIDE'\nconst toList = Array.from\nexport const writes = NAME",
  'a default export after a line ending in fs.default': "import * as fs from 'node:fs'\nimport { NAME } from 'SIDE'\nconst mod = fs.default\nexport default NAME",
  'an alias after a line ending in Array.of': "import { NAME } from 'SIDE'\nconst make = Array.of\nexport const writes = NAME",
  'an alias after a line ending in a getter named get': "import { NAME } from 'SIDE'\nconst read = Reflect.get\nexport const writes = NAME",
  'an alias after a line ending in a property named set': "import { NAME } from 'SIDE'\nconst held = new Map().set\nexport const writes = NAME",
  'an alias after a postfix increment': "import { NAME } from 'SIDE'\nlet n = 0\nn++\nexport const writes = NAME",
  'an alias after a postfix decrement': "import { NAME } from 'SIDE'\nlet n = 0\nn--\nexport const writes = NAME",
  'a value an immediately invoked arrow returns': "import { NAME } from 'SIDE';\nexport const writes = (() => NAME)();",
  'a value an immediately invoked function returns': "import { NAME } from 'SIDE';\nexport const writes = (function () { return NAME; })();",
  'a binding assigned inside a top-level if': "import { NAME } from 'SIDE';\nlet writes;\nif (true) writes = NAME;\nexport { writes };",
  'a binding filled by Object.assign': "import { NAME } from 'SIDE';\nexport const writes = {};\nObject.assign(writes, { NAME });",
  'a destructured export of the import': "import { NAME } from 'SIDE';\nexport const { writes } = { writes: NAME };",
  'a second declarator of one declaration': "import { NAME } from 'SIDE';\nexport const count = 1, writes = NAME;",
};

/**
 * The findings each hand-on in `HAND_ONS` misses: `relay` hands on `name` from `side`, and each of
 * `importers` is a module barred from that side, importing `relay` whole, with the rule barring it.
 */
function missedHandOns(side, name, relay, importers, shapes = HAND_ONS, extra = {}) {
  const missed = [];
  const runner = `${side.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())}Runner`;
  for (const [shape, template] of Object.entries(shapes)) {
    const modules = { ...extra, [relay]: template.replaceAll('SIDE', `../substrate/forge/${side}.mjs`).replaceAll('NAME', name).replaceAll('RUNNER', runner) };
    for (const [file] of importers) modules[file] = `import * as all from '../${relay.slice('src/'.length)}';`;
    const found = messages(modules);
    const says = (file, rule) => found.some((message) => message.startsWith(`${file} `) && message.includes(`breaks ${rule}:`));
    for (const [file, rule] of [[relay, 'the re-export rule'], ...importers]) {
      if (!says(file, rule)) missed.push(`${shape}: ${file} did not break ${rule}`);
    }
  }
  return missed;
}

test('a hand-on of an item-write binding is the item-write side\'s, in every shape, so importing it from a barred directory fails', () => {
  const importers = [['src/cli/promote.mjs', 'rule 5'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('item-write', 'write', 'src/workflow/relay.mjs', importers);
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('a hand-on of a schema-write binding is the schema-write side\'s, in every shape, so importing it from a barred directory fails', () => {
  const importers = [['src/workflow/shape.mjs', 'rule 6'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('schema-write', 'shape', 'src/cli/relay.mjs', importers);
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

/**
 * A hand-on through each of the eight steps of the card's "Hand-ons: what holds a side" item,
 * each named for its step. `SIDE` is the side module's path, `NAME` its export and `RUNNER` its
 * runner; every shape exports a binding holding the side.
 */
const STEPS = {
  'step 1, an import by name': "import { NAME } from 'SIDE';\nexport { NAME as held };",
  'step 1, an import as a namespace': "import * as ns from 'SIDE';\nexport const held = ns;",
  'step 1, an import as a default': "import held from '../substrate/forge/index-default.mjs';\nexport { held };",
  'step 1, an import of the runner': "import { RUNNER } from '../substrate/forge/runners.mjs';\nexport { RUNNER as held };",
  'step 2, a dynamic import awaited and bound (D1)': "export const side = await import('SIDE');",
  'step 2, a dynamic import bound and not awaited': "export const side = import('SIDE');",
  'step 2, a dynamic import awaited and destructured (D3)': "const { NAME } = await import('SIDE');\nexport { NAME as shape };",
  'step 2, a dynamic import bound, then read': "const ns = await import('SIDE');\nexport const held = ns.NAME;",
  'step 3, a re-export under the same name': "export { NAME } from 'SIDE';",
  'step 3, a re-export under another name': "export { NAME as held } from 'SIDE';",
  'step 4, an alias by assignment': "import { NAME } from 'SIDE';\nexport let held;\nheld = NAME;",
  'step 4, an alias by destructuring': "import { NAME } from 'SIDE';\nexport const [held] = [NAME];",
  'step 4, an alias in a called function\'s scope': "import { NAME } from 'SIDE';\nexport const held = (() => { const inner = NAME; return inner; })();",
  'step 5, a property read from a namespace': "import * as ns from 'SIDE';\nexport const held = ns.NAME;",
  'step 5, a property read from an object holding it': "import { NAME } from 'SIDE';\nconst box = { NAME };\nexport const held = box.NAME;",
  'step 6, an object literal': "import { NAME } from 'SIDE';\nexport const held = { go: NAME };",
  'step 6, an array literal': "import { NAME } from 'SIDE';\nexport const held = [NAME];",
  'step 6, a spread': "import { NAME } from 'SIDE';\nconst box = { NAME };\nexport const held = { ...box };",
  'step 6, a class\'s static field': "import { NAME } from 'SIDE';\nexport class Held { static go = NAME; }",
  'step 7, a conditional': "import { NAME } from 'SIDE';\nexport const held = Math.random() > 1 ? null : NAME;",
  'step 7, &&': "import { NAME } from 'SIDE';\nexport const held = true && NAME;",
  'step 7, ||': "import { NAME } from 'SIDE';\nexport const held = false || NAME;",
  'step 7, ??': "import { NAME } from 'SIDE';\nexport const held = null ?? NAME;",
  'step 7, await': "import { NAME } from 'SIDE';\nexport const held = await NAME;",
  'step 7, the last operand of a comma': "import { NAME } from 'SIDE';\nexport const held = (0, NAME);",
  'step 8, an arrow called in parentheses': "import { NAME } from 'SIDE';\nexport const held = (() => NAME)();",
  'step 8, a function called where it is written': "import { NAME } from 'SIDE';\nexport const held = (function () { return NAME; })();",
  'step 8, the comma IIFE (0, (() => side))()': "import { NAME } from 'SIDE';\nexport const held = (0, (() => NAME))();",
  'step 8, through .call, by a parameter': "import { NAME } from 'SIDE';\nexport const held = (function (x) { return x; }).call(null, NAME);",
  'step 8, through .apply, by a parameter': "import { NAME } from 'SIDE';\nexport const held = (function (x) { return x; }).apply(null, [NAME]);",
  'step 8, as a template\'s tag, returning it': "import { NAME } from 'SIDE';\nexport const held = (() => NAME)``;",
  'step 8, as a template\'s tag, by a parameter': "import { NAME } from 'SIDE';\nexport const held = ((strings, x) => x)`${NAME}`;",
  'step 8, a parameter passed the side': "import { NAME } from 'SIDE';\nexport const held = ((x) => x)(NAME);",
  'step 8, a parameter\'s default': "import { NAME } from 'SIDE';\nexport const held = ((x = NAME) => x)();",
};

/** The default-export module step 1's default import reads, handing each side on as its default. */
const indexDefault = (side, name) => ({ 'src/substrate/forge/index-default.mjs': `import { ${name} } from './${side}.mjs';\nexport default ${name};` });

test('the proof: a hand-on through each of the eight steps holds the item-write side, and importing it from a barred directory fails', () => {
  const importers = [['src/cli/promote.mjs', 'rule 5'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('item-write', 'write', 'src/workflow/relay.mjs', importers, STEPS, indexDefault('item-write', 'write'));
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('the proof: a hand-on through each of the eight steps holds the schema-write side, and importing it from a barred directory fails', () => {
  const importers = [['src/workflow/shape.mjs', 'rule 6'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('schema-write', 'shape', 'src/cli/relay.mjs', importers, STEPS, indexDefault('schema-write', 'shape'));
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('a function that calls a side is not a hand-on of it, with or without semicolons', () => {
  const modules = {
    'src/workflow/transitions.mjs': [
      "import { write } from '../substrate/forge/item-write.mjs'",
      'export const claim = async (card) => write(card)',
      'export function settle(card) { return write(card) }',
      'export default function finish(card) { return write(card) }',
      'export const handlers = { move(card) { return write(card) } }',
    ].join('\n'),
    'src/scheduling/claims.mjs': "import * as all from '../workflow/transitions.mjs'\nimport finish from '../workflow/transitions.mjs'",
  };
  assert.deepEqual(messages(modules), []);
});

test('an assignment to a property of a runners-module binding puts that binding on the runner\'s side', () => {
  const modules = {
    'src/substrate/forge/runners.mjs': [
      ADAPTER['src/substrate/forge/runners.mjs'],
      'export const registry = {};',
      'export const request2 = (document) => [document];',
      'registry.write = itemWriteRunner;',
    ].join('\n'),
    'src/cli/registry.mjs': "import { registry, request2 } from '../substrate/forge/runners.mjs';",
  };
  const found = messages(modules);
  assert.ok(found.some((message) => message.includes('`registry`') && message.includes('breaks rule 5:')), found.join('\n') || '(nothing)');
  assert.ok(!found.some((message) => message.includes('`request2`')), found.join('\n'));
});

test('rule 3 bars no other use of the name board: L3\'s board handle passes as a parameter, a destructured key or a member', () => {
  const handles = [
    'export async function pull({ board, dispatch }) { const items = await board.items(); return dispatch(items); }',
    'export const pull = (deps) => deps.board.items();',
    'export const pull = ({ board, run }) => run(board);',
    'export const pull = (board, ranked) => board.items().filter(ranked);',
  ];
  for (const source of handles) assert.deepEqual(messages({ 'src/scheduling/pull.mjs': source }), [], source);
});

test('rule 3 leaves a read through an alias or a computed key to review, as the card\'s revised item says', () => {
  // The card's Rule 3 item, as revised by its author on 2026-09-25: a read through an alias is a
  // review finding. The computed key is the same case, a board.priority the source never spells.
  const reviewed = [
    'export const rank = (config) => { const b = config.board; return b.priority; };',
    "export const rank = (config) => { const key = 'board'; return config[key].priority; };",
  ];
  for (const source of reviewed) assert.deepEqual(messages({ 'src/scheduling/rank.mjs': source }), [], source);
});

test('rule 3: the spelled path fails whatever the object before board, and a string subscript at either step', () => {
  const shapes = [
    'export const rank = (deps) => deps.config.board.priority;',
    "export const rank = (config) => config.board['priority'];",
    'export const rank = (board) => board.priority;',
    'export const rank = (config) => { const { board: { priority: p } } = config; return p; };',
    'export const rank = (config) => { let priority; ({ priority } = config.board); return priority; };',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 7: a gh assembled from constant strings fails as the literal does', () => {
  for (const expression of ["'g' + 'h'", '`g${\'h\'}`', "`${'g'}h`"]) {
    assertBreaks({ 'src/cli/doctor.mjs': `export const forge = ${expression};` }, 'src/cli/doctor.mjs', 'rule 7');
  }
});

test('a module loading another through createRequire or getBuiltinModule fails, because what it binds is unknown', () => {
  assertBreaks({ 'src/workflow/load.mjs': "import { createRequire } from 'node:module';\nexport const load = createRequire(import.meta.url);" }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  assertBreaks({ 'src/workflow/load.mjs': "export const load = () => process.getBuiltinModule('node:child_process');" }, 'src/workflow/load.mjs', 'the dynamic-import rule');
});

test('a module that does not parse is refused, naming the file and its line, rather than read as clean', () => {
  const found = messages({ 'src/cli/odd.mjs': 'export const a = 1;\nexport const = 2;' });
  assert.ok(found.some((message) => message.startsWith('src/cli/odd.mjs line 2 breaks the unreadable-module rule:')), found.join('\n') || '(nothing)');
});

test('a second declarator in the runners module that holds a write runner is on its side', () => {
  const modules = {
    'src/substrate/forge/runners.mjs': `${ADAPTER['src/substrate/forge/runners.mjs']}\nexport const a = 1, relay = itemWriteRunner;`,
    'src/cli/relay.mjs': "import { a, relay } from '../substrate/forge/runners.mjs';",
  };
  const found = messages(modules);
  assert.ok(found.some((message) => message.includes('`relay`') && message.includes('breaks rule 5:')), found.join('\n') || '(nothing)');
  assert.ok(!found.some((message) => message.includes('`a`')), found.join('\n'));
});

test('a side with no module, or no runner, is refused rather than read as clean', () => {
  const tree = new Map(Object.entries(ADAPTER));
  tree.delete('src/substrate/forge/item-write.mjs');
  assert.throws(() => boundaryReport(tree), /item-write/);
  const renamed = new Map(Object.entries(ADAPTER));
  renamed.set('src/substrate/forge/runners.mjs', ADAPTER['src/substrate/forge/runners.mjs'].replace('itemWriteRunner(args) {', 'moveRunner(args) {'));
  assert.throws(() => boundaryReport(renamed), /itemWriteRunner/);
});
