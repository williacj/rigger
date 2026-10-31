// ABOUTME: Tests `consumerConfig`, the config's entry point: each default export it copies into
// plain data or refuses, and that a later call for the same file in the process answers the first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { consumerConfig } from '../src/cli/doctor.mjs';
import { validate } from '../src/config/validate.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The file the entry point reads in each target. */
const CONFIG = 'rigger.config.mjs';

/** The array's placement and the independently written path to it. */
const ARRAY_NESTING = [
  { name: 'whole list', expression: 'list', path: 'default', wrap: (list) => list, read: (value) => value },
  { name: 'object field', expression: '{ list }', path: 'default.list', wrap: (list) => ({ list }), read: (value) => value.list },
  { name: 'list element', expression: '[list]', path: 'default[0]', wrap: (list) => [list], read: (value) => value[0] },
];

/** Creatable cells: an absent index has no enumerability or descriptor kind. */
const ARRAY_ENTRIES = ARRAY_NESTING.flatMap((nesting) => [
  ...[0, 1, 2].flatMap((index) => [
    { nesting, key: String(index), part: `[${index}]`, index: true, kind: 'hole', copied: false },
    ...[false, true].flatMap((enumerable) => [
      ...['primitive', 'nested'].map((value) => ({ nesting, key: String(index), part: `[${index}]`, index: true, kind: 'data', value, enumerable, copied: true })),
      { nesting, key: String(index), part: `[${index}]`, index: true, kind: 'accessor', enumerable, copied: false },
    ]),
  ]),
  ...[{ key: 'extra', part: '.extra' }, { key: '01', part: '."01"' }, { key: '4294967295', part: '."4294967295"' }].flatMap(({ key, part }) =>
    ['data', 'accessor'].flatMap((kind) => [false, true].map((enumerable) => ({ nesting, key, part, index: false, kind, value: 'nested', enumerable, copied: !enumerable })))),
]);
ARRAY_ENTRIES.push({ nesting: ARRAY_NESTING[1], key: '0', part: '[0]', index: true, kind: 'data', value: 'nested', enumerable: false, copied: true, frozen: true });

/** A stable cell label, used by both boundary assertions and the copied-row stability loops. */
const arrayEntryName = (cell) => `${cell.kind} ${cell.index ? 'index' : 'field'} ${cell.key}, ${cell.kind === 'hole' ? 'absent' : cell.enumerable ? 'enumerable' : 'non-enumerable'}, ${cell.value ?? 'no value'}, ${cell.nesting.name}${cell.frozen ? ', frozen list' : ''}`;

/** The fixture's data value, written independently from the production copy. */
const arrayEntryValue = (cell) => cell.value === 'nested' ? { leaf: [1] } : 1;

/** A module with exactly the selected array property, and a counter no getter may increment. */
function arrayEntrySource(cell, counter = JSON.stringify('rigger-config-array-reads')) {
  const property = cell.kind === 'hole' ? `delete list[${JSON.stringify(cell.key)}];` :
    `Object.defineProperty(list, ${JSON.stringify(cell.key)}, { enumerable: ${cell.enumerable}, configurable: true, ${cell.kind === 'data' ? `writable: true, value: ${JSON.stringify(arrayEntryValue(cell))}` : `get() { globalThis[${counter}] += 1; throw new Error('array getter ran'); }`} });`;
  return `globalThis[${counter}] = 0;\nconst list = [1, 2, 3];\n${property}\n${cell.frozen ? 'Object.freeze(list);\n' : ''}export default ${cell.nesting.expression};\n`;
}

/**
 * The copied rows of the card's "The entry point's cells", each a module whose default export is
 * the row's value. E1 is this repository's own config, plain data the extension points offer.
 */
const COPIED = {
  E1: readFileSync(join(ROOT, CONFIG), 'utf8'),
  'E1a frozen': "export default Object.freeze({ repo: 'a/b', board: Object.freeze({ project: 1 }), list: Object.freeze([1, 2]) });\n",
  'E1a sealed': "export default Object.seal({ repo: 'a/b', board: Object.seal({ project: 1 }), list: Object.seal([1, 2]) });\n",
  'E1a non-extensible': "export default Object.preventExtensions({ repo: 'a/b', board: Object.preventExtensions({ project: 1 }) });\n",
  E2: "const bare = Object.create(null);\nbare.project = 1;\nexport default { repo: 'a/b', board: bare, written: { __proto__: null, a: [null] } };\n",
  'E3 list': "export default [1, 'two', null, true, { three: 3 }];\n",
  E4: "const shared = { labels: ['x'] };\nexport default { one: shared, two: shared, list: [shared, shared] };\n",
  E5: "export default { ['__proto__']: { polluted: true }, repo: 'a/b' };\n",
  E17: [
    "globalThis['rigger-config-read-hidden'] = 0;",
    "const object = { repo: 'a/b' };",
    "Object.defineProperty(object, 'quiet', { value: 1, enumerable: false });",
    "Object.defineProperty(object, 'hidden', { get() { globalThis['rigger-config-read-hidden'] += 1; return 2; }, enumerable: false });",
    "const list = [1, 2];",
    "Object.defineProperty(list, 'quiet', { value: 3, enumerable: false });",
    "Object.defineProperty(list, 'hidden', { get() { globalThis['rigger-config-read-hidden'] += 1; return 4; }, enumerable: false });",
    'export default { object, list };',
  ].join('\n'),
  ...Object.fromEntries(ARRAY_ENTRIES.filter((cell) => cell.index && cell.kind === 'data' && !cell.enumerable)
    .map((cell) => [`E17 ${arrayEntryName(cell)}`, arrayEntrySource(cell)])),
  // 101 objects and lists, alternating, the outermost the default export and the innermost 100
  // levels below it, holding a string one level further down.
  E24: "let value = 'deepest';\nfor (let level = 100; level >= 0; level -= 1) value = level % 2 ? [value] : { a: value };\nexport default value;\n",
};

/** The whole-export primitives of row E3, each copied as it is. */
const PRIMITIVES = { null: 'null', boolean: 'true', number: '3.5', string: "'a string'" };

/** Every copied row, the whole-export primitives of E3 among them. */
const EVERY = { ...COPIED, ...Object.fromEntries(Object.entries(PRIMITIVES).map(([name, value]) => [`E3 ${name}`, `export default ${value};\n`])) };

/** What each row asks of its copy beyond equality, where it asks more. */
const FURTHER = {
  E5: (config, said) => {
    assert.ok(Object.hasOwn(config, '__proto__'), `${said}: the copy lost its own \`__proto__\``);
    assert.equal(Object.getPrototypeOf(config), Object.prototype, said);
  },
  E24: (config, said) => {
    let levels = 0;
    for (let part = config; typeof part === 'object'; part = Array.isArray(part) ? part[0] : part.a) levels += 1;
    assert.equal(levels, 101, `${said}: the copy does not hold objects and lists from level 0 to level 100`);
  },
  E17: (config, said) => {
    assert.deepEqual(Object.getOwnPropertyNames(config.object), ['repo'], said);
    assert.deepEqual(Object.getOwnPropertyNames(config.list), ['0', '1', 'length'], said);
    assert.equal(globalThis['rigger-config-read-hidden'], 0, `${said}: a non-enumerable accessor ran`);
  },
};

/** A target holding `source` as its config, with each of `others` beside it, by file name. */
function target(t, source, others = {}) {
  const directory = temporaryDirectory('rigger-config-read-', { context: t });
  writeFileSync(join(directory, CONFIG), source);
  for (const [name, text] of Object.entries(others)) writeFileSync(join(directory, name), text);
  return directory;
}

/** The default export of the module at `path`, as the test reads it itself. */
const exported = async (path) => (await import(pathToFileURL(path))).default;

/**
 * Asserts `answer` is `{ config }` with `config` equal to `value` and no object of it the same
 * object as `value`'s at the same place.
 */
function assertCopied(answer, value, said) {
  assert.deepEqual(Object.keys(answer), ['config'], said);
  assert.deepStrictEqual(answer.config, value, said);
  const walk = (copy, original, at) => {
    if (typeof original !== 'object' || original === null) return;
    assert.notEqual(copy, original, `${said}: ${at} is the export's own object`);
    const keys = Array.isArray(original) ? Array.from({ length: original.length }, (_, index) => String(index)) : Object.keys(original);
    for (const key of keys) walk(copy[key], original[key], `${at}.${key}`);
  };
  walk(answer.config, value, 'default');
  FURTHER[said]?.(answer.config, said);
}

/**
 * Changes the object or list `given` to hold what the extension points never offer: each of its
 * keys a function, a Symbol added, and on a list a BigInt pushed. A change that throws, as one to a
 * frozen object does, is let throw.
 */
function spoil(given) {
  const change = (act) => {
    try { act(); } catch { /* A change that throws meets R2 as well. */ }
  };
  for (const key of Object.keys(given)) change(() => { given[key] = () => 'not plain data'; });
  change(() => { given.added = Symbol('not plain data'); });
  if (Array.isArray(given)) change(() => given.push(10n));
}

/** The copied rows answered as an object or a list, rather than as one of E3's primitives. */
const OBJECTS = Object.fromEntries(Object.entries(EVERY).filter(([name]) => !Object.hasOwn(PRIMITIVES, name.slice(3))));

/** A config that hands on `row.mjs`'s default export, and lets the test change it through `key`. */
const changing = (key) => `import row from './row.mjs';\nlet value = row;\nexport { value as default };\nglobalThis[${JSON.stringify(key)}] = (next) => { value = next; };\n`;

let counters = 0;
/** A fresh key on `globalThis` for one module to keep its state under. */
const counter = (t) => {
  const key = `rigger-config-read-${counters += 1}`;
  t.after(() => delete globalThis[key]);
  return key;
};

// proves R-SCHED-10
test('R1: once a config file has answered, its module changing its default export to a function changes no later answer, for each copied row', async (t) => {
  for (const [row, source] of Object.entries(EVERY)) {
    const key = counter(t);
    const directory = target(t, changing(key), { 'row.mjs': source });
    const value = await exported(join(directory, 'row.mjs'));
    const first = await consumerConfig(directory);
    assertCopied(first, value, row);
    globalThis[key](() => 'not plain data');
    assert.equal(typeof (await exported(join(directory, CONFIG))), 'function', `${row}: the module's export did not change, so this proves nothing`);
    assert.deepStrictEqual(await consumerConfig(directory), first, row);
  }
});

// proves R-SCHED-10
test('R2: a caller changing the object or list it was answered changes no later answer, for each copied row answered as one', async (t) => {
  for (const [row, source] of Object.entries(OBJECTS)) {
    const directory = target(t, source);
    const value = await exported(join(directory, CONFIG));
    const first = await consumerConfig(directory);
    assertCopied(first, value, row);
    spoil(first.config);
    assert.notDeepStrictEqual(first.config, value, `${row}: the caller's change did not land, so this proves nothing`);
    assertCopied(await consumerConfig(directory), value, row);
  }
});

// proves R-SCHED-10
test('R3: the test changing the module\'s live export through its own reference, a later call through a symbolic link to the directory answers the first answer, for each copied row whose export can change', async (t) => {
  for (const [row, source] of Object.entries(OBJECTS).filter(([name]) => name !== 'E1a frozen')) {
    const directory = target(t, source);
    const link = join(temporaryDirectory('rigger-config-link-', { context: t }), 'linked');
    symlinkSync(directory, link);
    const value = await exported(join(directory, CONFIG));
    const before = Object.entries(value);
    const first = await consumerConfig(directory);
    assertCopied(first, value, row);
    spoil(value);
    assert.notDeepStrictEqual(Object.entries(await exported(join(link, CONFIG))), before, `${row}: the export read through the link is unchanged, so this proves nothing`);
    assert.deepStrictEqual(await consumerConfig(link), first, row);
  }
});

/** The characters `printable` in `src/cli/doctor.mjs` writes as escapes. */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Asserts each of `cases`, a config source and the path the card's notation gives its one refused
 * part, is answered `{ problem }` on its first read: one printable line naming that path.
 */
async function assertRefused(t, cases) {
  for (const [source, path] of cases) {
    const answer = await consumerConfig(target(t, source));
    const said = `${source.trim()}: ${JSON.stringify(answer)}`;
    assert.deepEqual(Object.keys(answer), ['problem'], said);
    assert.equal(typeof answer.problem, 'string', said);
    assert.doesNotMatch(answer.problem, UNPRINTABLE, said);
    assert.ok(answer.problem.includes(`\`${path}\``), `${said}: names no \`${path}\``);
  }
}

// proves R-SCHED-10
test('array entries: own index occupancy is independent of enumerability, with data, accessors, extra fields and nesting', async (t) => {
  for (const cell of ARRAY_ENTRIES) {
    const key = counter(t);
    const source = arrayEntrySource(cell, JSON.stringify(key));
    const directory = target(t, source);
    const value = await exported(join(directory, CONFIG));
    const list = cell.nesting.read(value);
    const descriptor = Object.getOwnPropertyDescriptor(list, cell.key);
    const said = arrayEntryName(cell);
    assert.equal(list.length, 3, `${said}: the fixture's length`);
    if (cell.frozen) assert.ok(Object.isFrozen(list), `${said}: frozen fixture premise`);
    assert.equal(Object.hasOwn(list, cell.key), cell.kind !== 'hole', `${said}: own occupancy premise`);
    if (cell.kind === 'hole') assert.equal(descriptor, undefined, said);
    else {
      assert.equal(descriptor.enumerable, cell.enumerable, `${said}: enumerability premise`);
      assert.equal(Object.hasOwn(descriptor, 'value'), cell.kind === 'data', `${said}: descriptor kind premise`);
      assert.equal(Object.keys(list).includes(cell.key), cell.enumerable, `${said}: enumerable-key premise`);
      if (cell.kind === 'data') assert.deepStrictEqual(descriptor.value, arrayEntryValue(cell), said);
    }
    const answer = await consumerConfig(directory);
    if (cell.copied) {
      const expected = [1, 2, 3];
      if (cell.index) expected[Number(cell.key)] = arrayEntryValue(cell);
      assert.deepEqual(Object.keys(answer), ['config'], `${said}: copied, not refused`);
      assert.deepStrictEqual(answer.config, cell.nesting.wrap(expected), said);
      assertCopied(answer, value, said);
      const copiedList = cell.nesting.read(answer.config);
      assert.deepEqual(Object.getOwnPropertyNames(copiedList), ['0', '1', '2', 'length'], said);
      for (const index of ['0', '1', '2']) {
        const copiedDescriptor = Object.getOwnPropertyDescriptor(copiedList, index);
        assert.equal(copiedDescriptor.enumerable, true, `${said}: copied index ${index} is enumerable`);
        assert.ok(Object.hasOwn(copiedDescriptor, 'value'), `${said}: copied index ${index} holds data`);
      }
    } else {
      assert.deepEqual(Object.keys(answer), ['problem'], `${said}: refused, not copied`);
      assert.equal(typeof answer.problem, 'string', said);
      assert.doesNotMatch(answer.problem, UNPRINTABLE, said);
      assert.ok(answer.problem.includes(`\`${cell.nesting.path}${cell.part}\``), `${said}: ${answer.problem}`);
    }
    assert.equal(globalThis[key], 0, `${said}: no getter ran`);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(list, cell.key), descriptor, `${said}: the source descriptor stays unchanged`);
  }
});

/** A key on `globalThis` a config's source can name, removed when `t` ends. */
const named = (t) => JSON.stringify(counter(t));

// proves R-SCHED-10
test('E6: an enumerable accessor, as the whole export or nested, is refused, naming its path', async (t) => {
  await assertRefused(t, [
    ["export default { get repo() { return 'a/b'; } };\n", 'default.repo'],
    ['export default { board: { get project() { return 1; } } };\n', 'default.board.project'],
    ['export default { board: { set project(value) {} } };\n', 'default.board.project'],
    ["const list = [1];\nObject.defineProperty(list, '0', { get() { return 1; }, enumerable: true });\nexport default { list };\n", 'default.list[0]'],
  ]);
});

// proves R-SCHED-10
test('E7: an accessor answering differently on each read is refused, and runs at most once', async (t) => {
  const key = named(t);
  await assertRefused(t, [[`export default { board: { get project() { globalThis[${key}] = (globalThis[${key}] ?? 0) + 1; return globalThis[${key}]; } } };\n`, 'default.board.project']]);
  assert.ok((globalThis[JSON.parse(key)] ?? 0) <= 1, `the accessor ran ${globalThis[JSON.parse(key)]} times`);
});

// proves R-SCHED-10
test('E8: a Proxy whose traps answer as a plain object would, as the whole export or nested, is refused', async (t) => {
  await assertRefused(t, [
    ["export default new Proxy({ repo: 'a/b' }, {});\n", 'default'],
    ['export default { board: new Proxy({ project: 1 }, {}) };\n', 'default.board'],
    ['export default { list: new Proxy([1, 2], {}) };\n', 'default.list'],
  ]);
});

/** Every trap a Proxy handler can hold, from ECMA-262's table of them. */
const TRAPS = ['getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions', 'getOwnPropertyDescriptor', 'defineProperty', 'has', 'get', 'set', 'deleteProperty', 'ownKeys', 'apply', 'construct'];

// proves R-SCHED-10
test('E9: a Proxy whose traps throw is refused, and each trap runs at most once', async (t) => {
  const key = named(t);
  const handler = `globalThis[${key}] = {};\nconst handler = Object.fromEntries(${JSON.stringify(TRAPS)}.map((trap) => [trap, () => { globalThis[${key}][trap] = (globalThis[${key}][trap] ?? 0) + 1; throw new Error(trap); }]));\n`;
  await assertRefused(t, [
    [`${handler}export default new Proxy({}, handler);\n`, 'default'],
    [`${handler}export default { board: new Proxy({}, handler) };\n`, 'default.board'],
  ]);
  for (const [trap, runs] of Object.entries(globalThis[JSON.parse(key)])) assert.ok(runs <= 1, `${trap} ran ${runs} times`);
});

/** The objects of row E10, each with a prototype neither `Object.prototype` nor `null`. */
const FOREIGN = ['new (class Card {})()', 'new Date(0)', 'new Map()', '/x/', 'Promise.resolve(1)', '{ __proto__: { inherited: 1 } }'];

// proves R-SCHED-10
test('E10: an object whose prototype is neither Object.prototype nor null, as the whole export or nested, is refused', async (t) => {
  await assertRefused(t, FOREIGN.flatMap((value) => [
    [`export default ${value};\n`, 'default'],
    [`export default { value: ${value} };\n`, 'default.value'],
  ]));
});

// proves R-SCHED-10
test('E11: a subclass of Array, or a list or plain object made in another realm, is refused', async (t) => {
  await assertRefused(t, [
    ['class List extends Array {}\nexport default List.from([1]);\n', 'default'],
    ['class List extends Array {}\nexport default { list: List.from([1]) };\n', 'default.list'],
    ["import { runInNewContext } from 'node:vm';\nexport default runInNewContext('[1]');\n", 'default'],
    ["import { runInNewContext } from 'node:vm';\nexport default { list: runInNewContext('[1]') };\n", 'default.list'],
    ["import { runInNewContext } from 'node:vm';\nexport default runInNewContext('({ project: 1 })');\n", 'default'],
    ["import { runInNewContext } from 'node:vm';\nexport default { board: runInNewContext('({ project: 1 })') };\n", 'default.board'],
  ]);
});

// proves R-SCHED-10
test('E12: a function, as the whole export or nested, is refused', async (t) => {
  await assertRefused(t, [
    ['export default function config() {}\n', 'default'],
    ['export default { make() {} };\n', 'default.make'],
    ['export default { list: [() => 1] };\n', 'default.list[0]'],
  ]);
});

// proves R-SCHED-10
test('E13: a Symbol as a value, or an own Symbol key, as the whole export or nested, is refused', async (t) => {
  await assertRefused(t, [
    ["export default Symbol('x');\n", 'default'],
    ["export default { board: { name: Symbol('x') } };\n", 'default.board.name'],
    ["export default { [Symbol('k')]: 1 };\n", 'default'],
    ["export default { board: { [Symbol('k')]: 1 } };\n", 'default.board'],
  ]);
});

// proves R-SCHED-10
test('E14: a BigInt, NaN or an infinite number, as the whole export or nested, is refused', async (t) => {
  await assertRefused(t, ['10n', 'NaN', 'Infinity', '-Infinity'].flatMap((value) => [
    [`export default ${value};\n`, 'default'],
    [`export default { concurrency: ${value} };\n`, 'default.concurrency'],
  ]));
});

// proves R-SCHED-10
test('E15: undefined nested as a value is refused, as for kinds.change.rounds, which the validator admitted before', async (t) => {
  await assertRefused(t, [
    ["export default { kinds: { change: { maker: 'engineer', rounds: undefined } } };\n", 'default.kinds.change.rounds'],
    ['export default { list: [1, undefined] };\n', 'default.list[1]'],
  ]);
});

// proves R-SCHED-10
test('E16: a list with a hole, or with an own enumerable property that is not an index, is refused', async (t) => {
  await assertRefused(t, [
    ['export default { list: [1, , 3] };\n', 'default.list[1]'],
    ['export default { list: [1, 2, ,] };\n', 'default.list[2]'],
    ['const list = [1, 2];\nlist.extra = 3;\nexport default { list };\n', 'default.list.extra'],
  ]);
});

// proves R-SCHED-10
test('E18: an object that refers to itself, directly or through another, is refused', async (t) => {
  await assertRefused(t, [
    ['const config = {};\nconfig.self = config;\nexport default config;\n', 'default.self'],
    ['const config = {};\nconfig.board = { back: config };\nexport default config;\n', 'default.board.back'],
    ['const list = [];\nlist.push(list);\nexport default { list };\n', 'default.list[0]'],
  ]);
});

// proves R-SCHED-10
test('E19: an object or a list more than 100 levels below the default export is refused, naming the first such part, one JSON.stringify overflows included', async (t) => {
  const deep = (levels, wrap) => `let value = 1;\nfor (let level = ${levels}; level >= 0; level -= 1) value = ${wrap};\nexport default value;\n`;
  // Measured on Node 26.5.0: JSON.stringify of objects with Object.prototype nested ten million
  // levels throws nothing, and of objects with a null prototype nested 100,000 levels throws a
  // RangeError, so the overflowing case is built of those; the premise below checks it each run.
  const overflowing = deep(100_000, '{ __proto__: null, a: value }');
  const value = await exported(join(target(t, overflowing), CONFIG));
  assert.throws(() => JSON.stringify(value), RangeError, 'JSON.stringify of the export threw no RangeError, so this proves nothing');
  await assertRefused(t, [
    [deep(101, '{ a: value }'), `default${'.a'.repeat(101)}`],
    [deep(101, '[value]'), `default${'[0]'.repeat(101)}`],
    [deep(100_000, '{ a: value }'), `default${'.a'.repeat(101)}`],
    [overflowing, `default${'.a'.repeat(101)}`],
  ]);
});

// proves R-SCHED-10
test('E20: a refused part under a key holding a character printable escapes is named with that character escaped', async (t) => {
  const under = (key) => `export default { ${JSON.stringify(key)}: { c: undefined } };\n`;
  await assertRefused(t, [
    [under('a\nb'), 'default."a\\nb".c'],
    [under('\u001b[2J'), 'default."\\u001b[2J".c'],
    [under('a\u007fb'), 'default."a\\u007fb".c'],
    [under('a\u0085b'), 'default."a\\u0085b".c'],
    [under('a\u2028b'), 'default."a\\u2028b".c'],
    [under('a\u2029b'), 'default."a\\u2029b".c'],
    [under('a-b'), 'default."a-b".c'],
  ]);
});

/** Asserts the validator, reading `config`, refuses it as holding no declarations. */
function assertNoDeclarations(config, said) {
  const refusals = validate(config);
  assert.equal(refusals.length, 1, `${said}: ${refusals.join('; ')}`);
  assert.match(refusals[0], /holds no declarations/, said);
}

// proves R-SCHED-10
test('E3: null, a boolean, a finite number, a string or a list as the whole export is copied, and the validator refuses it', async (t) => {
  for (const [row, source] of Object.entries(EVERY).filter(([name]) => name.startsWith('E3 '))) {
    const directory = target(t, source);
    const answer = await consumerConfig(directory);
    assertCopied(answer, await exported(join(directory, CONFIG)), row);
    assertNoDeclarations(answer.config, row);
  }
});

// proves R-SCHED-10
test('E21: no default export, or undefined as the default export, is answered as before, and the validator refuses it', async (t) => {
  for (const source of ['export const repo = \'a/b\';\n', 'export default undefined;\n']) {
    const directory = target(t, source);
    const answer = await consumerConfig(directory);
    // What `consumerConfig` answered at e20bd768 (`doctor.mjs:411`): the import's `default` as the config.
    assert.deepStrictEqual(answer, { config: await exported(join(directory, CONFIG)) }, source);
    assertNoDeclarations(answer.config, source);
  }
});

// proves R-SCHED-10
test('R4: a config file missing at the first call, then written to export a function, is answered as missing on a later call', async (t) => {
  const directory = temporaryDirectory('rigger-config-read-', { context: t });
  const first = await consumerConfig(directory);
  assert.deepEqual(Object.keys(first), ['problem'], JSON.stringify(first));
  assert.ok(first.problem.includes('is not in'), first.problem);
  writeFileSync(join(directory, CONFIG), "export default () => 'not plain data';\n");
  assert.equal(typeof (await exported(join(directory, CONFIG))), 'function', 'the written file exports no function, so this proves nothing');
  assert.deepStrictEqual(await consumerConfig(directory), first);
});
