// ABOUTME: The one boundary test: holds each directory under src/ to the forge adapter's sides it
// may import, to the config keys, card facts and processes its layer may touch, and to whether it
// may hold L3's dispatching entry point.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boundaryReport, sourceTree } from './layer-boundaries.mjs';

/**
 * The smallest tree the rules read: the forge adapter's three side modules, the one module
 * holding their runners, and L3's loop, whose export is L3's dispatching entry point. Each fixture
 * adds the module it is about to it. The names in the adapter's modules are placeholders standing
 * for whatever a side exports, not the adapter's operations.
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
  'src/scheduling/loop.mjs': 'export function loop(deps) { return { pull: async () => deps }; }',
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
  // Round 4's routes: a binding in a block or a called function's scope, then a module binding.
  'step 1, a block var exported by name': "import { NAME } from 'SIDE';\n{ var held = NAME; }\nexport { held };",
  'step 1, a namespace held by a block var': "import * as ns from 'SIDE';\n{ var held = ns; }\nexport { held };",
  'step 2, a dynamic import assigned from a block': "export let held;\n{ const m = await import('SIDE'); held = m; }",
  'step 2, a dynamic import assigned from a called async function': "export let held;\nawait (async () => { const m = await import('SIDE'); held = m; })();",
  'step 3, a var in an if, re-exported under another name': "import { NAME } from 'SIDE';\nif (true) { var w = NAME; }\nexport { w as held };",
  'step 4, a block alias assigned into a module binding': "import { NAME } from 'SIDE';\nexport let held;\n{ const a = NAME; held = a; }",
  'step 4, a block alias assigned, then exported by name': "import { NAME } from 'SIDE';\nlet held;\n{ const inner = NAME; held = inner; }\nexport { held };",
  'step 4, nested blocks': "import { NAME } from 'SIDE';\nexport let held;\n{ const a = NAME; { const b = a; held = b; } }",
  'step 4, an alias a loop reads before it is given the side': "import { NAME } from 'SIDE';\nexport let held;\n{ let a; for (let i = 0; i < 2; i++) { held = a; a = NAME; } }",
  'step 5, a block alias of a property read': "import * as ns from 'SIDE';\nexport let held;\n{ const a = ns.NAME; held = a; }",
  'step 6, a block object assigned': "import { NAME } from 'SIDE';\nexport let held;\n{ const o = { NAME }; held = o; }",
  'step 6, a class declared in a called function': "import { NAME } from 'SIDE';\nexport const held = (() => { class C { static go = NAME; } return C; })();",
  'step 7, a block ?? assigned': "import { NAME } from 'SIDE';\nexport let held;\n{ const a = null ?? NAME; held = a; }",
  'step 8, a called arrow\'s parameter assigned into a module binding': "import { NAME } from 'SIDE';\nexport let held;\n((x) => { held = x; })(NAME);",
  'step 8, a parameter assigned through .call': "import { NAME } from 'SIDE';\nexport let held;\n(function (x) { held = x; }).call(null, NAME);",
  'step 8, a called function\'s local assigned': "import { NAME } from 'SIDE';\nexport let held;\n(() => { const a = NAME; held = a; })();",
  // Round 5's routes: a spread that shifts a call's arguments, and a default inside a pattern.
  'step 8, a spread shifting the side to a later parameter': "import { NAME } from 'SIDE';\nexport const held = ((a, x) => x)(...[0, NAME]);",
  'step 8, a spread through .call': "import { NAME } from 'SIDE';\nexport const held = (function (a, x) { return x; }).call(null, ...[0, NAME]);",
  'step 8, a spread inside .apply\'s list': "import { NAME } from 'SIDE';\nexport const held = (function (a, x) { return x; }).apply(null, [...[0, NAME]]);",
  'step 8, a spread of a list held in a binding': "import { NAME } from 'SIDE';\nconst list = [0, NAME];\nexport const held = ((a, x) => x)(...list);",
  'step 8, a spread assigning a parameter into a module binding': "import { NAME } from 'SIDE';\nexport let held;\n((a, x) => { held = x; })(...[0, NAME]);",
  'step 8, a spread of a dynamic import': "export const held = ((a, x) => x)(...[0, await import('SIDE')]);",
  'step 8, a spread in a block, of an alias': "import { NAME } from 'SIDE';\nexport let held;\n{ const a = NAME; held = ((z, x) => x)(...[0, a]); }",
  'step 8, a rest parameter': "import { NAME } from 'SIDE';\nexport const held = ((first, ...rest) => rest)(0, NAME);",
  'step 8, a called function\'s arguments': "import { NAME } from 'SIDE';\nexport const held = (function () { return arguments; })(0, NAME);",
  'step 4, a default in a destructured declaration': "import { NAME } from 'SIDE';\nexport const { held = NAME } = {};",
  'step 4, a default in an array pattern': "import { NAME } from 'SIDE';\nexport const [held = NAME] = [];",
  'step 4, a default in a destructuring assignment': "import { NAME } from 'SIDE';\nexport let held;\n({ x: held = NAME } = {});",
  'step 4, a default in a block\'s destructuring': "import { NAME } from 'SIDE';\nexport let held;\n{ const { a = NAME } = {}; held = a; }",
  'step 3, a destructuring default re-exported under another name': "import { NAME } from 'SIDE';\nconst { w = NAME } = {};\nexport { w as held };",
  'step 2, a dynamic import as a destructuring default': "export const { held = await import('SIDE') } = {};",
  'step 8, a default inside a destructured parameter': "import { NAME } from 'SIDE';\nexport const held = (({ x = NAME }) => x)({});",
  'step 8, a default inside an array-pattern parameter': "import { NAME } from 'SIDE';\nexport const held = (([x = NAME]) => x)([]);",
  // Their siblings: every other way a pattern or an argument list moves a value into a binding.
  'step 4, a rest element in an array pattern': "import { NAME } from 'SIDE';\nexport const [, ...held] = [0, NAME];",
  'step 4, a rest element in an object pattern': "import { NAME } from 'SIDE';\nexport const { a, ...held } = { a: 0, NAME };",
  'step 4, a logical assignment': "import { NAME } from 'SIDE';\nexport let held;\nheld ??= NAME;",
  'step 8, a spread of unknown length before the side': "import { NAME } from 'SIDE';\nconst list = [];\nexport const held = ((a, b) => b)(...list, NAME);",
  'step 8, a default reading an earlier parameter': "import { NAME } from 'SIDE';\nexport const held = ((a, b = a) => b)(NAME);",
  // Round 6's routes: .apply spread or used as a tag, and a var assigned before it is declared.
  'step 8, .apply with its whole argument list spread': "import { NAME } from 'SIDE';\nexport const held = (function (x) { return x; }).apply(...[null, [NAME]]);",
  'step 8, .apply as a template tag': "import { NAME } from 'SIDE';\nexport const held = (function (x) { return x; }).apply`${[NAME]}`;",
  'step 4, a var assigned before its declaration in a called function': "import { NAME } from 'SIDE';\nexport let held;\n(() => { a = NAME; var a; held = a; })();",
  'step 2, a dynamic import assigned to a var before its declaration': "export let held;\nawait (async () => { a = await import('SIDE'); var a; held = a; })();",
  'step 4, a var destructured into before its declaration': "import { NAME } from 'SIDE';\nexport let held;\n(() => { ({ a } = { a: NAME }); var a; held = a; })();",
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

test('rule 3: the spelled path fails through optional chaining wherever it appears', () => {
  const shapes = [
    'export const rank = (config) => { const { priority } = config?.board; return priority; };',
    'export const rank = (config) => { let priority; ({ priority } = config?.board); return priority; };',
    'export const rank = (config) => (config?.board).priority;',
    'export const rank = (config) => config?.board?.priority;',
    "export const rank = (config) => config?.['board']?.['priority'];",
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

test('a chain of aliases settles however long it is, and still holds the side at its end', () => {
  // Each alias is given the one before it only after it is read, so every pass of the reader
  // moves the side one link along; a reader that stops after a fixed number of passes reds here.
  const links = 60;
  const names = Array.from({ length: links }, (_, i) => `a${i}`);
  const steps = names.slice(1).map((name, i) => `${name} = ${names[i]};`).reverse().join(' ');
  const relay = [
    "import { write } from '../substrate/forge/item-write.mjs';",
    'export let held;',
    `{ let ${names.join(', ')}; for (let i = 0; i < ${links}; i++) { held = a${links - 1}; ${steps} a0 = write; } }`,
  ].join('\n');
  const found = messages({ 'src/workflow/relay.mjs': relay, 'src/cli/promote.mjs': "import { held } from '../workflow/relay.mjs';" });
  assert.ok(found.some((message) => message.startsWith('src/cli/promote.mjs ') && message.includes('breaks rule 5:')), found.join('\n') || '(nothing)');
  assert.ok(!found.some((message) => message.includes('unreadable')), found.join('\n'));
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

/** Asserts that `modules` breaks some rule in `file`, the file named first in the message. */
function assertRefused(modules, file, label = file) {
  const found = messages(modules);
  assert.ok(
    found.some((message) => message.startsWith(`${file} `)),
    `${label}: expected ${file} to break a rule; the report says:\n${found.join('\n') || '(nothing)'}`,
  );
}

/** Each way a module can reach CommonJS's `require` and call it on `SPEC`. */
const REQUIRES = {
  'require by name': "export const loaded = require('SPEC');",
  'require through a binding that holds it': "const load = require;\nexport const loaded = load('SPEC');",
  'require through a binding destructured from module': "const { require: load } = module;\nexport const loaded = load('SPEC');",
  'module.require': "export const loaded = module.require('SPEC');",
  "module['require']": "export const loaded = module['require']('SPEC');",
  'require through a key held in a binding': "const key = 'require';\nexport const loaded = module[key]('SPEC');",
};

/** The extensions a module under src/ may carry. */
const EXTENSIONS = ['cjs', 'js', 'mjs'];

test('rule 7 by require: a module outside the spawners loading child_process through require fails, as .cjs, .js and .mjs, however it reaches require', () => {
  for (const specifier of ['node:child_process', 'child_process']) {
    for (const [way, template] of Object.entries(REQUIRES)) {
      for (const extension of EXTENSIONS) {
        const file = `src/workflow/spawn.${extension}`;
        assertRefused({ [file]: template.replaceAll('SPEC', specifier) }, file, `${way}, ${specifier}, .${extension}`);
      }
    }
  }
});

test('a CommonJS module is refused whole, so a route to require that only its wrapper hands it fails too', () => {
  const routes = [
    "const load = arguments[1];\nload('node:child_process');",
    "const key = ['re', 'quire'].join('');\nmodule[key]('node:child_process');",
    "(function f() { return f.caller.arguments[1]; })()('node:child_process');",
    '',
  ];
  for (const source of routes) assertBreaks({ 'src/workflow/spawn.cjs': source }, 'src/workflow/spawn.cjs', 'the CommonJS rule');
});

test('a package.json under src/ is refused, because it can make the .js modules beside it CommonJS', () => {
  const modules = { 'src/workflow/package.json': '{ "type": "commonjs" }', 'src/workflow/spawn.js': "const load = arguments[1];\nload('node:child_process');" };
  assertBreaks(modules, 'src/workflow/package.json', 'the CommonJS rule');
});

test('the source tree carries a package.json under src/, so the whole-tree run meets it', () => {
  const root = mkdtempSync(join(tmpdir(), 'layer-boundaries-'));
  try {
    const files = { ...ADAPTER, 'src/workflow/package.json': '{ "type": "commonjs" }', 'src/workflow/move.js': 'export const move = 1;' };
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    const found = boundaryReport(sourceTree(root)).violations.map((violation) => violation.message);
    assert.ok(found.some((message) => message.startsWith('src/workflow/package.json ') && message.includes('breaks the CommonJS rule:')), found.join('\n') || '(nothing)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('importing node:module fails, because its loaders reach require by routes this test cannot follow', () => {
  for (const source of ["import { Module } from 'node:module';", "import * as loaders from 'module';", "export { Module } from 'node:module';", "export * from 'node:module';"]) {
    assertBreaks({ 'src/workflow/load.mjs': source }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  }
});

test('process.mainModule fails, because it holds a CommonJS module whose require a run-time key could reach', () => {
  for (const source of ['export const main = process.mainModule;', "export const main = process['mainModule'];", 'const { mainModule } = process;\nexport const load = (key) => mainModule[key];']) {
    assertBreaks({ 'src/workflow/load.mjs': source }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  }
});

test('a loader named by a string fails as one named by a name does', () => {
  for (const source of ["export const load = process['getBuiltinModule'];", "export const load = Reflect.get(module, 'require');", "export const load = module['create' + 'Require'];"]) {
    assertBreaks({ 'src/workflow/load.mjs': source }, 'src/workflow/load.mjs', 'the dynamic-import rule');
  }
});

/**
 * What a barred directory may load through require, per side: the side's module, the runners
 * module, and a module exporting a binding that holds the side, with the relay that exports it.
 */
const REQUIRED_SIDES = [
  {
    side: 'item-write',
    importers: ['src/cli/promote', 'src/scheduling/pull'],
    relay: { 'src/workflow/relay.mjs': "import { write } from '../substrate/forge/item-write.mjs';\nexport const held = write;" },
    targets: ['../substrate/forge/item-write.mjs', '../substrate/forge/runners.mjs', '../workflow/relay.mjs'],
  },
  {
    side: 'schema-write',
    importers: ['src/workflow/shape', 'src/scheduling/pull'],
    relay: { 'src/cli/relay.mjs': "import { shape } from '../substrate/forge/schema-write.mjs';\nexport const held = shape;" },
    targets: ['../substrate/forge/schema-write.mjs', '../substrate/forge/runners.mjs', '../cli/relay.mjs'],
  },
];

test('Hand-ons step 1 by require: a barred directory loading a write side through require fails, on both sides, however it reaches require', () => {
  for (const { side, importers, relay, targets } of REQUIRED_SIDES) {
    for (const importer of importers) {
      for (const target of targets) {
        for (const [way, template] of Object.entries(REQUIRES)) {
          for (const extension of EXTENSIONS) {
            const file = `${importer}.${extension}`;
            assertRefused({ ...relay, [file]: template.replaceAll('SPEC', target) }, file, `${side}: ${way} of ${target}, .${extension}`);
          }
        }
      }
    }
  }
});

test('require of what the test cannot read fails, naming the file', () => {
  const calls = ['require(name)', "require('./missing.mjs')", "require('some-package')", 'require(`../${name}.mjs`)', 'module.require(name)'];
  for (const call of calls) {
    for (const extension of EXTENSIONS) {
      const file = `src/workflow/load.${extension}`;
      assertRefused({ [file]: `export const load = (name) => ${call};` }, file, `${call}, .${extension}`);
    }
  }
});

/**
 * A hand-on through a catch clause's parameter whose destructuring default holds the side, handed
 * on by each Hand-ons step. `SIDE`, `NAME` and `RUNNER` are as in `STEPS`.
 */
const CATCHES = {
  'step 4, a catch default assigned into a module binding': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = a; }",
  'step 4, a catch default in an array pattern': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw []; } catch ([a = NAME]) { held = a; }",
  'step 4, a catch default nested in an object pattern': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw { x: {} }; } catch ({ x: { a = NAME } }) { held = a; }",
  'step 4, a catch default in an array in an object': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw { x: [] }; } catch ({ x: [a = NAME] }) { held = a; }",
  'step 4, a catch default on a nested pattern': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ x: { a } = { a: NAME } }) { held = a; }",
  'step 4, a catch default reading an earlier default': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME, b = a }) { held = b; }",
  'step 4, a catch default under a rest element': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw []; } catch ([, ...[a = NAME]]) { held = a; }",
  'step 4, a catch default held by a var in the catch': "import { NAME } from 'SIDE';\ntry { throw {}; } catch ({ a = NAME }) { var v = a; }\nexport { v as held };",
  'step 4, a catch default in a block': "import { NAME } from 'SIDE';\nexport let held;\n{ try { throw {}; } catch ({ a = NAME }) { const b = a; held = b; } }",
  'step 4, a catch default in a called function': "import { NAME } from 'SIDE';\nexport let held;\n(() => { try { throw {}; } catch ({ a = NAME }) { held = a; } })();",
  'step 4, a catch default beside a finally': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = a; } finally { }",
  'step 1, a namespace as a catch default': "import * as ns from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = ns }) { held = a; }",
  'step 1, the runner as a catch default': "import { RUNNER } from '../substrate/forge/runners.mjs';\nexport let held;\ntry { throw {}; } catch ({ a = RUNNER }) { held = a; }",
  'step 2, a dynamic import as a catch default': "export let held;\ntry { throw {}; } catch ({ a = await import('SIDE') }) { held = a; }",
  'step 5, a property read from a catch default': "import * as ns from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = ns }) { held = a.NAME; }",
  'step 6, a catch default held in an object': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = { a }; }",
  'step 6, a catch default held in an array': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = [a]; }",
  'step 7, a catch default through ??': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = null ?? a; }",
  'step 7, a catch default whose value is a ?? of the side': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = null ?? NAME }) { held = a; }",
  'step 8, a catch default passed to a called arrow': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = NAME }) { held = ((x) => x)(a); }",
  'step 8, a called arrow as a catch default': "import { NAME } from 'SIDE';\nexport let held;\ntry { throw {}; } catch ({ a = (() => NAME)() }) { held = a; }",
};

test('Hand-ons step 4 by a catch parameter: a destructuring default holding the item-write side, handed on, fails at any depth', () => {
  const importers = [['src/cli/promote.mjs', 'rule 5'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('item-write', 'write', 'src/workflow/relay.mjs', importers, CATCHES);
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('Hand-ons step 4 by a catch parameter: a destructuring default holding the schema-write side, handed on, fails at any depth', () => {
  const importers = [['src/workflow/shape.mjs', 'rule 6'], ['src/scheduling/pull.mjs', 'rule 1']];
  const missed = missedHandOns('schema-write', 'shape', 'src/cli/relay.mjs', importers, CATCHES);
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('rule 3: a pattern taking priority with board as its default fails, on every kind of parameter and nested in another pattern', () => {
  const shapes = [
    // Finding 2's four shapes.
    'export const rank = (config, { priority } = config.board) => priority;',
    'export function rank(config, { priority } = config.board) { return priority; }',
    'export const rank = (config) => (item, { priority } = config.board) => priority;',
    'export const rank = (config, { priority } = config?.board) => priority;',
    // Each other kind of parameter, and each spelling of the access.
    'export const rank = function (config, { priority } = config.board) { return priority; };',
    'export const ranks = { rank(config, { priority } = config.board) { return priority; } };',
    'export class Ranks { rank(config, { priority } = config.board) { return priority; } }',
    'export class Ranks { static rank(config, { priority } = config.board) { return priority; } }',
    'export const ranks = { set rank({ priority } = config.board) { } };',
    "export const rank = (config, { priority } = config['board']) => priority;",
    "export const rank = (config, { priority } = config?.['board']) => priority;",
    'export const rank = (board, { priority } = board) => priority;',
    'export const rank = (deps, { priority: p = 0 } = deps.config.board) => p;',
    "export const rank = (config, { 'priority': p } = config.board) => p;",
    // Nested inside another pattern.
    'export const rank = (config, { inner: { priority } = config.board } = {}) => priority;',
    'export const rank = (config, [{ priority } = config.board] = []) => priority;',
    'export const rank = (config) => { const { inner: { priority } = config.board } = {}; return priority; };',
    'export const rank = (config) => { let priority; ({ inner: { priority } = config.board } = {}); return priority; };',
    'export const rank = (config) => { try { throw {}; } catch ({ inner: { priority } = config.board }) { return priority; } };',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3: a pattern taking priority whose value or default is an operand expression holding board fails', () => {
  const shapes = [
    'export const rank = (config) => { const { priority } = config.board ?? {}; return priority; };',
    'export const rank = (config) => { const { priority } = config.board || {}; return priority; };',
    'export const rank = (config, ready) => { const { priority } = ready && config.board; return priority; };',
    'export const rank = (config, ready) => { const { priority } = ready ? config.board : {}; return priority; };',
    'export const rank = (config, ready) => { const { priority } = ready ? {} : config.board; return priority; };',
    'export const rank = async (config) => { const { priority } = await config.board; return priority; };',
    'export const rank = (config) => { const { priority } = (0, config.board); return priority; };',
    'export const rank = (config) => { const { priority } = (config?.board ?? {}); return priority; };',
    "export const rank = (config) => { const { priority } = config['board'] ?? {}; return priority; };",
    'export const rank = (board) => { const { priority } = board ?? {}; return priority; };',
    'export const rank = (config, ready) => { const { priority } = (ready ? config.board : null) ?? {}; return priority; };',
    'export const rank = async (config) => { const { priority } = await (config.board ?? {}); return priority; };',
    'export const rank = (config) => { let priority; ({ priority } = config.board ?? {}); return priority; };',
    'export const rank = (config, { priority } = config.board ?? {}) => priority;',
    // A function called where it is written gives its parameters what the call passes.
    'export const rank = (config) => (({ priority }) => priority)(config.board);',
    'export const rank = (config) => (({ priority }) => priority)(config.board ?? {});',
    'export const rank = (config) => (function (a, { priority }) { return priority; })(0, config.board);',
    'export const rank = (config) => (function ({ priority }) { return priority; }).call(null, config.board ?? {});',
    'export const rank = (config) => (function ({ priority }) { return priority; }).apply(null, [config.board]);',
    'export const rank = (config) => ((strings, { priority }) => priority)`${config.board}`;',
    'export const rank = (config) => (({ priority } = {}) => priority)(config.board);',
    'export const rank = (config, list) => ((a, { priority }) => priority)(...list, config.board);',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3: priority read by a member access from an operand expression holding board fails', () => {
  const shapes = [
    'export const rank = (config) => (config.board ?? {}).priority;',
    'export const rank = (config) => (config.board || {}).priority;',
    'export const rank = (config, ready) => (ready && config.board).priority;',
    'export const rank = (config, ready) => (ready ? config.board : {}).priority;',
    'export const rank = async (config) => (await config.board).priority;',
    'export const rank = (config) => (0, config.board).priority;',
    'export const rank = (config) => (config.board ?? {})?.priority;',
    "export const rank = (config) => (config.board ?? {})['priority'];",
    'export const rank = (config) => (config?.board ?? {}).priority;',
    'export const rank = (board) => (board ?? {}).priority;',
    'export const rank = (config, ready) => ((ready ? config.board : null) ?? {}).priority;',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3: a call to a function the module defines by name gives its pattern the value, so board handed to one taking priority fails', () => {
  const definitions = {
    'a const arrow': 'const take = ({ priority }) => priority;',
    'a function declaration': 'function take({ priority }) { return priority; }',
    'a function expression': 'const take = function ({ priority }) { return priority; };',
    'a named function expression': 'const take = function taking({ priority }) { return priority; };',
    'a let assigned later': 'let take;\ntake = ({ priority }) => priority;',
    'a default in the pattern': 'const take = ({ priority } = {}) => priority;',
    'a second parameter': 'const take = (first, { priority }) => priority;',
  };
  const arguments_ = {
    'config.board': 'config.board',
    'config?.board': 'config?.board',
    "config['board']": "config['board']",
    '??': 'config.board ?? {}',
    '||': 'config.board || {}',
    '&&': 'config && config.board',
    '? :': 'config ? config.board : {}',
    'await': 'await config.board',
    'a comma': '(0, config.board)',
    'parentheses': '((config.board ?? {}))',
  };
  const calls = {
    'a call': (arg, second) => (second ? `take(0, ${arg})` : `take(${arg})`),
    '.call': (arg, second) => (second ? `take.call(null, 0, ${arg})` : `take.call(null, ${arg})`),
    '.apply': (arg, second) => (second ? `take.apply(null, [0, ${arg}])` : `take.apply(null, [${arg}])`),
    'new': (arg, second) => (second ? `new take(0, ${arg})` : `new take(${arg})`),
  };
  const missed = [];
  for (const [definition, declared] of Object.entries(definitions)) {
    const second = definition === 'a second parameter';
    for (const [given, arg] of Object.entries(arguments_)) {
      for (const [how, call] of Object.entries(calls)) {
        if (how === 'new' && declared.includes('=>')) continue;
        const source = `${declared}\nexport async function rank(config) {\n  return ${call(arg, second)};\n}`;
        const found = messages({ 'src/scheduling/rank.mjs': source });
        if (!found.some((message) => message.startsWith('src/scheduling/rank.mjs ') && message.includes('breaks rule 3:'))) missed.push(`${definition}, ${given}, ${how}`);
      }
    }
  }
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('rule 3: a method the module defines, called by name, gives its pattern the value', () => {
  const shapes = [
    'const ranks = { take({ priority }) { return priority; } };\nexport const rank = (config) => ranks.take(config.board ?? {});',
    'const ranks = { take: ({ priority }) => priority };\nexport const rank = (config) => ranks.take(config.board);',
    'class Ranks { static take({ priority }) { return priority; } }\nexport const rank = (config) => Ranks.take(config.board ?? {});',
    'export class Ranks { take({ priority }) { return priority; } rank(config) { return this.take(config.board); } }',
    'export class Ranks { take = ({ priority }) => priority; rank(config) { return this.take(config.board ?? {}); } }',
    'class Take { constructor({ priority }) { this.priority = priority; } }\nexport const rank = (config) => new Take(config.board);',
    'const Take = class { constructor({ priority }) { this.priority = priority; } };\nexport const rank = (config) => new Take(config.board ?? {});',
    // The callee reached through an operand, and the argument through a spread of a list.
    'const take = ({ priority }) => priority;\nexport const rank = (config, ready) => (ready ? take : null)(config.board);',
    'const take = ({ priority }) => priority;\nexport const rank = (config, other) => (other || take)(config.board ?? {});',
    'const take = ({ priority }) => priority;\nexport const rank = (config) => take?.(config.board);',
    'const take = (a, { priority }) => priority;\nexport const rank = (config) => take(...[0, config.board]);',
    'export const rank = (config) => ((a, { priority }) => priority)(...[0, config.board ?? {}]);',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3 bars nothing more by name: a function the module defines passes when what it is given is not board, or it takes no priority', () => {
  const handles = [
    'const take = ({ priority }) => priority;\nexport const rank = (item) => take(item ?? {});',
    'function load({ items }) { return items(); }\nexport const pull = (deps) => load(deps.board ?? {});',
    'const take = (board, { priority }) => [board.items(), priority];\nexport const rank = (deps, item) => take(deps.board, item);',
    'const take = ({ priority }) => priority;\nexport const rank = (deps) => [take(deps.item), deps.board.items()];',
    'const ranks = { take({ priority }) { return priority; } };\nexport const rank = (deps, item) => ranks.take(item, deps.board);',
  ];
  for (const source of handles) assert.deepEqual(messages({ 'src/scheduling/pull.mjs': source }), [], source);
});

test('rule 3 by name follows scope and receiver: a call reaching only another function, or a receiver the module does not define, passes', () => {
  const HELPER = 'const take = ({ priority }) => priority;\nexport const ranks = (items) => items.map(take);';
  const handles = [
    // The two judges' modules: a shadowing take, and a receiver the module does not define.
    `${HELPER}\nexport const pull = (deps) => { const take = (board) => board.items(); return take(deps.board); };`,
    `${HELPER}\nexport const pull = (deps) => deps.queue.take(deps.board);`,
    'const byItem = { load: ({ priority }) => priority };\nexport const ranks = (items) => items.map(byItem.load);\nexport const pull = (deps) => deps.store.load(deps.board);',
    'const take = ({ priority }) => priority;\nexport function pull(deps) {\n  const take = (board) => board.items();\n  return take(deps.board);\n}',
    // Every other way a name can be shadowed: a parameter, a hoisted declaration, a catch
    // parameter, a block, a var, an import, and a named function expression's own name.
    `${HELPER}\nexport const pull = (take, deps) => take(deps.board);`,
    `${HELPER}\nexport function pull(deps) { return take(deps.board); function take(board) { return board.items(); } }`,
    `${HELPER}\nexport const pull = (deps) => { try { return 0; } catch (take) { return take(deps.board); } };`,
    `${HELPER}\nexport const pull = (deps) => { { const take = (board) => board.items(); return take(deps.board); } };`,
    `${HELPER}\nexport function pull(deps) { if (deps) { var take = (board) => board.items(); } return take(deps.board); }`,
    `${HELPER}\nexport const pull = (deps) => { for (const take of deps.steps) take(deps.board); };`,
    `${HELPER}\nexport const pull = function take(deps) { return deps.board ? 0 : take({ board: deps.board }); };`,
    // A member of another object, or of another class, sharing only the key.
    `${HELPER}\nconst queue = { take: (board) => board.items() };\nexport const pull = (deps) => queue.take(deps.board);`,
    'const byItem = { take: ({ priority }) => priority };\nconst queue = { take: (board) => board.items() };\nexport const pull = (deps) => [byItem, queue.take(deps.board)];',
    'class Items { take({ priority }) { return priority; } }\nexport class Pull { take(board) { return board.items(); } run(deps) { return [Items, this.take(deps.board)]; } }',
    'class Items { static take({ priority }) { return priority; } }\nclass Queue { static take(board) { return board.items(); } }\nexport const pull = (deps) => [Items, Queue.take(deps.board)];',
    'export class Pull { static take({ priority }) { return priority; } run(deps) { return this.take(deps.board); } }',
    'export const pull = (deps) => deps.board.items().map(({ priority }) => priority);',
  ];
  for (const source of handles) assert.deepEqual(messages({ 'src/scheduling/pull.mjs': source }), [], source);
});

test('rule 3 by name reaches through scope: a call in an inner scope, before a hoisted declaration, or on this, still fails', () => {
  const shapes = [
    'const take = ({ priority }) => priority;\nexport function rank(config) {\n  return take(config.board ?? {});\n}',
    'const take = ({ priority }) => priority;\nexport function rank(config) { { if (config) { return take(config.board); } } return 0; }',
    'export function rank(config) { return take(config.board); }\nfunction take({ priority }) { return priority; }',
    'export function rank(config) { return take(config.board); function take({ priority }) { return priority; } }',
    'export function rank(config) { if (config) { var take = ({ priority }) => priority; } return take(config.board); }',
    'const take = ({ priority }) => priority;\nexport const rank = (config) => (() => () => take(config.board ?? {}))()();',
    'export class Ranks { take({ priority }) { return priority; } rank(config) { return [0].map(() => this.take(config.board)); } }',
    'export class Ranks { static take({ priority }) { return priority; } static rank(config) { return this.take(config.board); } }',
    'export const ranks = { take({ priority }) { return priority; }, rank(config) { return this.take(config.board ?? {}); } };',
    'const ranks = {};\nranks.take = ({ priority }) => priority;\nexport const rank = (config) => ranks.take(config.board);',
    'export const rank = (config) => { const take = ({ priority }) => priority; { const other = 1; return take(config.board ?? {}); } };',
  ];
  for (const source of shapes) assertBreaks({ 'src/scheduling/rank.mjs': source }, 'src/scheduling/rank.mjs', 'rule 3');
});

test('rule 3 by receiver: a method on an instance, a base class, super or a nested object the module defines still fails', () => {
  const shapes = [
    'class Items { take({ priority }) { return priority; } }\nconst items = new Items();\nexport const rank = (config) => items.take(config.board ?? {});',
    'class Items { take({ priority }) { return priority; } }\nexport const rank = (config) => new Items().take(config.board);',
    'class Ranks { take({ priority }) { return priority; } }\nexport const rank = (config) => new Ranks().take(config.board ?? {});',
    'class Ranks { take({ priority }) { return priority; } }\nexport const rank = (config) => { const ranks = new Ranks(); return ranks.take(config.board ?? {}); };',
    'class A { take({ priority }) { return priority; } }\nexport class B extends A { rank(c) { return super.take(c.board); } }',
    'class A { take({ priority }) { return priority; } }\nexport class B extends A { rank(c) { return this.take(c.board); } }',
    'class A { take({ priority }) { return priority; } }\nclass B extends A { }\nexport const rank = (c) => new B().take(c.board ?? {});',
    'class A { static take({ priority }) { return priority; } }\nclass B extends A { }\nexport const rank = (c) => B.take(c.board);',
    'class A { static take({ priority }) { return priority; } }\nexport class B extends A { static rank(c) { return super.take(c.board); } }',
    'const ranks = { inner: { take: ({ priority }) => priority } };\nexport const rank = (config) => ranks.inner.take(config.board);',
    'const ranks = { inner: { take({ priority }) { return priority; } } };\nexport const rank = (config) => ranks.inner.take(config.board ?? {});',
    'class Items { take = ({ priority }) => priority; }\nexport const rank = (config) => new Items().take(config.board);',
    'class Items { constructor() { this.take = ({ priority }) => priority; } }\nexport const rank = (config) => new Items().take(config.board);',
    // A base class's this may be a subclass the module defines, whose override then runs.
    'class A { take(b) { return b; } rank(c) { return this.take(c.board); } }\nexport class B extends A { take({ priority }) { return priority; } }',
    // A replacement the reader cannot place before the call keeps what it replaces.
    'const queue = { take: ({ priority }) => priority };\nexport const pull = (deps) => queue.take(deps.board);\nqueue.take = (board) => board.items();',
    'const queue = { take: ({ priority }) => priority };\nif (Math.random() > 1) queue.take = (board) => board.items();\nexport const pull = (deps) => queue.take(deps.board);',
    'const queue = { take: (board) => board.items() };\nqueue.take = ({ priority }) => priority;\nexport const pull = (deps) => queue.take(deps.board);',
    'let take = ({ priority }) => priority;\nexport function pull(deps) { return take(deps.board); }\ntake = (board) => board.items();',
    'let take = ({ priority }) => priority;\nfunction reset() { take = (board) => board.items(); }\nexport const pull = (deps) => [reset, take(deps.board)];',
    'let take = (board) => board.items();\nfunction later() { take = ({ priority }) => priority; }\nexport const pull = (deps) => [later, take(deps.board)];',
    'let take = ({ priority }) => priority;\ntake ??= (board) => board.items();\nexport const pull = (deps) => take(deps.board);',
    // A hoisted declaration may run before the replacement, and a function called later may
    // restore what the replacement overwrote, so neither lets the replacement drop a definition.
    'const queue = { take: ({ priority }) => priority };\nqueue.take = (board) => board.items();\nexport function pull(deps) { return queue.take(deps.board); }',
    'let take = (board) => board.items();\nfunction reset() { take = ({ priority }) => priority; }\ntake = (board) => board.items();\nexport const pull = (deps) => [reset, take(deps.board)];',
    // A write to one instance's own property leaves every other instance on the class's method.
    'class Items { take({ priority }) { return priority; } }\nconst a = new Items();\nconst b = new Items();\na.take = (board) => board.items();\nexport const rank = (config) => b.take(config.board ?? {});',
    'class Items { take({ priority }) { return priority; } }\nconst a = new Items();\na.take = (board) => board.items();\nexport const rank = (config) => new Items().take(config.board ?? {});',
    'class Items { take({ priority }) { return priority; } }\nconst a = new Items();\nconst b = new Items();\nconst either = Math.random() > 1 ? a : b;\neither.take = (board) => board.items();\nexport const rank = (config) => b.take(config.board);',
    'class Items { take({ priority }) { return priority; } }\nconst a = new Items();\nconst b = new Items();\na.take = (board) => board.items();\nexport const rank = (config, flag) => (flag ? a : b).take(config.board);',
    'class Items { take({ priority }) { return priority; } }\nclass Sub extends Items { }\nconst a = new Sub();\na.take = (board) => board.items();\nexport const rank = (config) => new Sub().take(config.board);',
    // One `new` in a loop builds an instance each time, so a write through one leaves the others.
    'class Items { take({ priority }) { return priority; } }\nlet first;\nlet last;\nfor (const n of [1, 2]) { last = new Items(); first ??= last; }\nlast.take = (board) => board.items();\nexport const rank = (config) => first.take(config.board);',
    'let first;\nlet last;\nfor (const n of [1, 2]) { last = { take: ({ priority }) => priority }; first ??= last; }\nlast.take = (board) => board.items();\nexport const rank = (config) => first.take(config.board);',
    // A subclass whose instance can reach a base method: one the module builds, or one it hands on.
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nclass B extends A { take({ priority }) { return priority; } }\nexport const pull = (deps) => new B().rank(deps);',
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nclass B extends A { take({ priority }) { return priority; } }\nexport { B };',
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nclass B extends A { take({ priority }) { return priority; } }\nexport const make = (deps) => deps.build(B);',
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nclass B extends A { take({ priority }) { return priority; } }\nclass C extends B { }\nexport default C;',
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nconst B = class extends A { take({ priority }) { return priority; } };\nexport const pull = (deps) => new B().rank(deps);',
    'class A { static take(board) { return board.items(); } static rank(c) { return this.take(c.board); } }\nclass B extends A { static take({ priority }) { return priority; } }\nexport const pull = (deps) => B.rank(deps);',
    // A class or a function exported as the default with no name of its own.
    'export default class { take({ priority }) { return priority; } rank(c) { return this.take(c.board); } }',
    'export default function ({ priority } = config.board) { return priority; }',
    // A chain of classes that extends itself, which the reader must not follow for ever.
    'class A extends B { take({ priority }) { return priority; } }\nclass B extends A { }\nexport const rank = (c) => new A().take(c.board);',
  ];
  const missed = shapes.filter((source) => !messages({ 'src/scheduling/rank.mjs': source }).some((message) => message.startsWith('src/scheduling/rank.mjs ') && message.includes('breaks rule 3:')));
  assert.deepEqual(missed, []);
});

test('rule 3 by receiver bars nothing more: a method the module replaced before the call, or an instance of another class, passes', () => {
  const handles = [
    'const queue = { take: ({ priority }) => priority };\nqueue.take = (board) => board.items();\nexport const pull = (deps) => queue.take(deps.board);',
    'let take = ({ priority }) => priority;\ntake = (board) => board.items();\nexport const pull = (deps) => take(deps.board);',
    'export const pull = (deps) => { let take = ({ priority }) => priority; take = (board) => board.items(); return take(deps.board); };',
    'export const pull = (deps) => { const queue = { take: ({ priority }) => priority }; queue.take = (board) => board.items(); return queue.take(deps.board); };',
    'const queue = { take: ({ priority }) => priority };\nif (Math.random() > 1) { queue.take = (board) => board.items(); queue.take(Math.random); }\nexport const pull = (deps) => [queue, deps.board];',
    'class Items { take({ priority }) { return priority; } }\nclass Queue { take(board) { return board.items(); } }\nexport const pull = (deps) => [Items, new Queue().take(deps.board)];',
    'class Items { take({ priority }) { return priority; } }\nclass Queue { take(board) { return board.items(); } }\nconst queue = new Queue();\nexport const pull = (deps) => [Items, queue.take(deps.board)];',
    'class A { take({ priority }) { return priority; } }\nexport class B extends A { take(board) { return board.items(); } run(deps) { return this.take(deps.board); } }',
    'class A { take({ priority }) { return priority; } }\nclass B extends A { take(board) { return board.items(); } }\nexport const pull = (deps) => new B().take(deps.board);',
    'class A { take(board) { return board.items(); } }\nexport class B extends A { take({ priority }) { return priority; } run(deps) { return super.take(deps.board); } }',
    'const ranks = { inner: { take: ({ priority }) => priority }, outer: { take: (board) => board.items() } };\nexport const pull = (deps) => ranks.outer.take(deps.board);',
    'class Items { static take({ priority }) { return priority; } }\nexport const pull = (deps) => new Items().take(deps.board);',
    'class Items { take({ priority }) { return priority; } }\nexport const pull = (deps) => Items.take(deps.board);',
    // Codex's module: a subclass nothing builds or hands on never runs the base class's method.
    'class A {\n  take(board) { return board.items(); }\n  rank(c) { return this.take(c.board); }\n}\nclass B extends A {\n  take({ priority }) { return priority; }\n}\nexport const pull = (deps) => new A().rank(deps);',
    'class A { take(board) { return board.items(); } rank(c) { return this.take(c.board); } }\nclass B extends A { take({ priority }) { return priority; } }\nclass C extends B { }\nexport const pull = (deps) => new A().rank(deps);',
    // A write to an instance replaces the method for that instance, where the reader knows which.
    'class Items { take({ priority }) { return priority; } }\nconst a = new Items();\na.take = (board) => board.items();\nexport const pull = (deps) => a.take(deps.board);',
    'class Items { take({ priority }) { return priority; } }\nexport const pull = (deps) => { const a = new Items(); a.take = (board) => board.items(); return a.take(deps.board); };',
    'export default class { take(board) { return board.items(); } run(deps) { return this.take(deps.board); } }',
    'export default function (deps) { return deps.board.items(); }',
    'class A extends B { }\nclass B extends A { }\nexport const pull = (deps) => new A().take(deps.board);',
  ];
  for (const source of handles) assert.deepEqual(messages({ 'src/scheduling/pull.mjs': source }), [], source);
});

test('a computed key that reads a loader fails, as a read anywhere else does', () => {
  assertBreaks({ 'src/workflow/rules.mjs': 'export const rules = { [require]: 1 };' }, 'src/workflow/rules.mjs', 'the dynamic-import rule');
  assertBreaks({ 'src/workflow/rules.mjs': 'export class Rules { [mainModule] = 1; }' }, 'src/workflow/rules.mjs', 'the dynamic-import rule');
});

test('a loader name that only keys an object or a class member passes, and one read as a value fails', () => {
  const keys = [
    'export const rules = { require: true };',
    "export const rules = { 'require': ['acceptance'], mainModule: 1 };",
    "export const rules = { ['require']: 1 };",
    'export const rules = { require() { return 1; } };',
    'export class Rules { require() { return 1; } static mainModule = 1; }',
  ];
  for (const source of keys) assert.deepEqual(messages({ 'src/workflow/rules.mjs': source }), [], source);
  const reads = [
    'export const rules = { require };',
    'export const rules = { load: require };',
    "export const rules = { [require('node:child_process')]: 1 };",
    'export const rules = (m) => m.require;',
    "export const rules = (m) => m['mainModule'];",
    'export const rules = ({ require: load }) => load;',
  ];
  for (const source of reads) assertBreaks({ 'src/workflow/rules.mjs': source }, 'src/workflow/rules.mjs', 'the dynamic-import rule');
});

test('rule 3 bars nothing more: the board handle as a parameter default, a destructured key, a member or an operand passes when no priority is read from it', () => {
  const handles = [
    'export const pull = (deps, board = deps.board) => board.items();',
    'export const pull = (deps, { board } = deps) => board.items();',
    'export const pull = (deps, { items } = deps.board) => items();',
    'export const pull = (deps) => { const { items } = deps.board ?? {}; return items(); };',
    'export const pull = (deps) => (deps.board ?? deps.fallback).items();',
    'export const pull = (deps) => ((b) => b.items())(deps.board);',
    'export const pull = (deps, item) => ((board, { priority }) => [board.items(), priority])(deps.board, item);',
    'export const pull = (item, fallback) => (item ?? fallback).priority;',
    'export const pull = (deps, { priority } = deps.item ?? {}) => priority;',
    'export const pull = (deps) => { try { return deps.board.items(); } catch ({ board = deps.board }) { return board; } };',
  ];
  for (const source of handles) assert.deepEqual(messages({ 'src/scheduling/pull.mjs': source }), [], source);
});

test('a side with no module, or no runner, is refused rather than read as clean', () => {
  const tree = new Map(Object.entries(ADAPTER));
  tree.delete('src/substrate/forge/item-write.mjs');
  assert.throws(() => boundaryReport(tree), /item-write/);
  const renamed = new Map(Object.entries(ADAPTER));
  renamed.set('src/substrate/forge/runners.mjs', ADAPTER['src/substrate/forge/runners.mjs'].replace('itemWriteRunner(args) {', 'moveRunner(args) {'));
  assert.throws(() => boundaryReport(renamed), /itemWriteRunner/);
});

/** Every directory under src/ at this head but src/scheduling/, each named as `src/<name>/`. */
const outsideScheduling = () => [...new Set([...sourceTree().keys()].map((path) => `src/${path.split('/')[1]}/`))]
  .filter((directory) => directory !== 'src/scheduling/');

test('rule 8: a named import of L3\'s dispatching entry point from each directory under src/ but src/scheduling/ fails', () => {
  const directories = outsideScheduling();
  assert.ok(directories.includes('src/config/') && directories.includes('src/cli/'), `the tree read no directories: ${directories.join(', ')}`);
  for (const directory of directories) {
    const file = `${directory}start.mjs`;
    assertBreaks({ [file]: "import { loop } from '../scheduling/loop.mjs';\nexport const start = (deps) => loop(deps).pull();" }, file, 'rule 8');
  }
});

test('rule 8: a namespace import, a dynamic import and a re-export relayed through src/scheduling/ each fail from src/cli/', () => {
  assertBreaks({ 'src/cli/start.mjs': "import * as l3 from '../scheduling/loop.mjs';\nexport const start = (deps) => l3.loop(deps).pull();" }, 'src/cli/start.mjs', 'rule 8');
  assertBreaks({ 'src/cli/start.mjs': "export const start = async (deps) => (await import('../scheduling/loop.mjs')).loop(deps).pull();" }, 'src/cli/start.mjs', 'rule 8');
  const relayed = {
    'src/scheduling/relay.mjs': "export { loop as run } from './loop.mjs';",
    'src/cli/start.mjs': "import { run } from '../scheduling/relay.mjs';\nexport const start = (deps) => run(deps).pull();",
  };
  assertBreaks(relayed, 'src/cli/start.mjs', 'rule 8');
});

test('rule 8: a module under src/scheduling/ calling L3\'s dispatching entry point passes', () => {
  const trigger = "import { loop } from './loop.mjs';\nexport const tick = (deps) => loop(deps).pull();";
  assert.deepEqual(messages({ 'src/scheduling/tick.mjs': trigger }), []);
});

test('rule 8: a tree with no dispatching entry point is refused rather than read as clean', () => {
  const tree = new Map(Object.entries(ADAPTER));
  tree.delete('src/scheduling/loop.mjs');
  assert.throws(() => boundaryReport(tree), /src\/scheduling\/loop\.mjs/);
  const renamed = new Map(Object.entries(ADAPTER));
  renamed.set('src/scheduling/loop.mjs', 'export function run(deps) { return deps; }');
  assert.throws(() => boundaryReport(renamed), /`loop`/);
});

test('the proof, rule 8: a hand-on of the entry point through each of the eight steps holds it, and importing it from src/cli/ fails', () => {
  // The write sides' proof shapes, with the entry point for the side. The runners module plays no
  // part in rule 8, so the shape importing a runner is not one of them.
  const missed = [];
  for (const [shape, template] of Object.entries(STEPS).filter(([, template]) => !template.includes('RUNNER'))) {
    const modules = {
      'src/scheduling/index-default.mjs': "import { loop } from './loop.mjs';\nexport default loop;",
      'src/scheduling/relay.mjs': template.replaceAll('../substrate/forge/index-default.mjs', './index-default.mjs').replaceAll('SIDE', './loop.mjs').replaceAll('NAME', 'loop'),
      'src/cli/start.mjs': "import * as all from '../scheduling/relay.mjs';",
    };
    const found = messages(modules);
    if (!found.some((message) => message.startsWith('src/cli/start.mjs ') && message.includes('breaks rule 8:'))) missed.push(`${shape}: src/cli/start.mjs did not break rule 8`);
    if (found.some((message) => message.startsWith('src/scheduling/'))) missed.push(`${shape}: a module under src/scheduling/ was reported: ${found.join('; ')}`);
  }
  assert.equal(missed.length, 0, `missed:\n${missed.join('\n')}`);
});

test('rule 8: a src/scheduling/ function that calls the entry point and returns what the call gives hands the entry point to nobody', () => {
  const modules = {
    'src/scheduling/tick.mjs': "import { loop } from './loop.mjs';\nexport const tick = (deps) => loop(deps).pull();",
    'src/cli/start.mjs': "import { tick } from '../scheduling/tick.mjs';\nexport const start = (deps) => tick(deps);",
  };
  assert.deepEqual(messages(modules), []);
});

test('rule 8: a src/scheduling/ function that only names the entry point, by a parameter of its name or by reading its name, holds nothing', () => {
  for (const tick of [
    "import { loop } from './loop.mjs';\nexport const tick = (loop) => loop;",
    "import { loop } from './loop.mjs';\nexport const tick = () => loop.name;",
  ]) {
    const modules = {
      'src/scheduling/tick.mjs': tick,
      'src/cli/start.mjs': "import { tick } from '../scheduling/tick.mjs';\nexport const start = (deps) => tick(deps);",
    };
    assert.deepEqual(messages(modules), [], tick);
  }
});
