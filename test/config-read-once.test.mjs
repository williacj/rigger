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

/** Placement paths and wrappers are literals, independent of the production copier. */
const PLACEMENTS = [
  { name: 'whole export', expression: 'container', path: 'default', wrap: (value) => value, read: (value) => value },
  { name: 'object field', expression: '{ list: container }', path: 'default.list', wrap: (value) => ({ list: value }), read: (value) => value.list },
  { name: 'list element', expression: '[container]', path: 'default[0]', wrap: (value) => [value], read: (value) => value[0] },
];
const ACCESSORS = ['getter', 'setter', 'both', 'neither'];
const FIELD_KEYS = [{ key: 'extra', part: '.extra' }, { key: '01', part: '."01"' }, { key: '4294967295', part: '."4294967295"' }];

/** Descriptor kinds and enumerability exist only for occupied fields. */
const descriptors = (enumerable) => [
  ...['primitive', 'nested', ...(!enumerable ? ['unoffered'] : [])].map((data) => ({ kind: 'data', data, enumerable })),
  ...ACCESSORS.map((kind) => ({ kind, enumerable })),
];
const FIELD_CELLS = PLACEMENTS.flatMap((placement) => [
  ...[0, 1, 2].flatMap((index) => [
    { placement, container: 'list', length: 3, key: String(index), part: `[${index}]`, selected: true, kind: 'hole', refusal: 'a hole' },
    ...[false, true].flatMap((enumerable) => descriptors(enumerable).filter((descriptor) => descriptor.data !== 'unoffered').map((descriptor) =>
      ({ placement, container: 'list', length: 3, key: String(index), part: `[${index}]`, selected: true, ...descriptor, refusal: descriptor.kind === 'data' ? undefined : 'an accessor' }))),
  ]),
  ...[0, 3].flatMap((length) => FIELD_KEYS.flatMap((field) => [false, true].flatMap((enumerable) => descriptors(enumerable).map((descriptor) =>
    ({ placement, container: 'list', length, ...field, selected: false, ...descriptor, refusal: enumerable ? 'a property that is not an index' : undefined }))))),
  ...FIELD_KEYS.slice(0, 1).flatMap((field) => [false, true].flatMap((enumerable) => descriptors(enumerable).map((descriptor) =>
    ({ placement, container: 'object', ...field, selected: enumerable, ...descriptor, refusal: enumerable && descriptor.kind !== 'data' ? 'an accessor' : undefined })))),
  ...['freeze', 'seal', 'preventExtensions'].map((integrity) =>
    ({ placement, container: 'list', length: 3, key: '0', part: '[0]', selected: true, kind: 'data', data: 'nested', enumerable: false, integrity })),
]).map((cell, index) => ({ ...cell, counter: `rigger-config-field-${index}` }));

const fieldName = (cell) => `${cell.container} ${cell.key}, ${cell.kind}${cell.data ? ` ${cell.data}` : ''}, ${cell.kind === 'hole' ? 'absent' : cell.enumerable ? 'enumerable' : 'hidden'}, ${cell.placement.name}${cell.container === 'list' ? `, length ${cell.length}` : ''}${cell.integrity ? `, ${cell.integrity}` : ''}`;
const FIELD_COPIES = new Map(FIELD_CELLS.filter((cell) => cell.refusal === undefined).map((cell) => [`E17 ${fieldName(cell)}`, cell]));

/** Source expressions are separate from the independently declared expected graphs below. */
function fieldSource(cell, counter = JSON.stringify(cell.counter)) {
  const data = cell.data === 'primitive' ? '1' : cell.data === 'unoffered' ? '() => 7' :
    cell.integrity === 'freeze' ? 'Object.freeze({ leaf: Object.freeze([1]) })' : '{ leaf: [1] }';
  const invoked = `globalThis[${counter}] += 1; throw new Error('field accessor ran');`;
  const accessor = {
    getter: `get() { ${invoked} }`, setter: `set(value) { ${invoked} }`,
    both: `get() { ${invoked} }, set(value) { ${invoked} }`, neither: 'get: undefined, set: undefined',
  };
  const property = cell.kind === 'hole' ? `delete container[${JSON.stringify(cell.key)}];` :
    `Object.defineProperty(container, ${JSON.stringify(cell.key)}, { enumerable: ${cell.enumerable}, configurable: true, ${cell.kind === 'data' ? `writable: true, value: ${data}` : accessor[cell.kind]} });`;
  return `globalThis[${counter}] = 0;\nconst container = ${cell.container === 'list' ? cell.length === 0 ? '[]' : '[1, 2, 3]' : '{ kept: { leaf: [2] } }'};\n${property}\n${cell.integrity ? `Object.${cell.integrity}(container);\n` : ''}export default ${cell.placement.expression};\n`;
}

/** No expected value is obtained by traversing a source export or reading its accessor. */
function fieldExpected(cell) {
  const container = cell.container === 'list' ? cell.length === 0 ? [] : [1, 2, 3] : { kept: { leaf: [2] } };
  if (cell.selected) container[cell.key] = cell.data === 'nested' ? { leaf: [1] } : 1;
  return cell.placement.wrap(container);
}

/** Establish occupancy, kind, enumerability, length and placement using descriptors only. */
function fieldPremise(value, cell, said) {
  if (cell.placement.name === 'object field') {
    assert.equal(Object.getPrototypeOf(value), Object.prototype, said);
    assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, 'list'), 'value'), said);
  }
  if (cell.placement.name === 'list element') {
    assert.ok(Array.isArray(value), said);
    assert.equal(value.length, 1, said);
    assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, '0'), 'value'), said);
  }
  const container = cell.placement.read(value);
  assert.equal(Array.isArray(container), cell.container === 'list', said);
  if (cell.container === 'list') assert.equal(Object.getOwnPropertyDescriptor(container, 'length').value, cell.length, said);
  const descriptor = Object.getOwnPropertyDescriptor(container, cell.key);
  assert.equal(Object.hasOwn(container, cell.key), cell.kind !== 'hole', `${said}: occupancy premise`);
  if (cell.kind === 'hole') assert.equal(descriptor, undefined, said);
  else {
    assert.equal(descriptor.enumerable, cell.enumerable, `${said}: enumerability premise`);
    assert.equal(Object.hasOwn(descriptor, 'value'), cell.kind === 'data', `${said}: descriptor kind premise`);
    if (cell.kind !== 'data') {
      assert.equal(typeof descriptor.get, ['getter', 'both'].includes(cell.kind) ? 'function' : 'undefined', said);
      assert.equal(typeof descriptor.set, ['setter', 'both'].includes(cell.kind) ? 'function' : 'undefined', said);
    } else if (cell.data === 'unoffered') assert.equal(typeof descriptor.value, 'function', said);
    else assert.deepStrictEqual(descriptor.value, cell.data === 'nested' ? { leaf: [1] } : 1, said);
  }
  if (cell.integrity) assert.ok(({ freeze: Object.isFrozen, seal: Object.isSealed, preventExtensions: (value) => !Object.isExtensible(value) })[cell.integrity](container), said);
  assert.equal(globalThis[cell.counter], 0, `${said}: premise invoked no accessor`);
  const snapshots = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    const descriptors = Object.getOwnPropertyDescriptors(node);
    snapshots.push([node, descriptors]);
    const keys = Array.isArray(node) ? Array.from({ length: descriptors.length.value }, (_, index) => String(index)) : Object.keys(node);
    for (const key of keys) if (Object.hasOwn(descriptors[key] ?? {}, 'value')) walk(descriptors[key].value);
  };
  walk(value);
  return snapshots;
}

/** Check normalized descriptors recursively against an independent plain-data graph. */
function fieldCopy(config, cell, said) {
  const expected = fieldExpected(cell);
  assert.deepStrictEqual(config, expected, `${said}: independent graph`);
  const walk = (copy, graph) => {
    if (graph === null || typeof graph !== 'object') return;
    assert.deepEqual(Object.getOwnPropertyNames(copy), Object.getOwnPropertyNames(graph), `${said}: no omitted or hidden field survives`);
    assert.deepEqual(Object.getOwnPropertySymbols(copy), [], said);
    if (Array.isArray(graph)) assert.equal(copy.length, graph.length, said);
    for (const key of Object.keys(graph)) {
      const descriptor = Object.getOwnPropertyDescriptor(copy, key);
      assert.ok(Object.hasOwn(descriptor, 'value'), `${said}: ${key} holds data`);
      assert.equal(descriptor.enumerable, true, `${said}: ${key} is enumerable`);
      walk(descriptor.value, graph[key]);
    }
  };
  walk(config, expected);
  assert.equal(globalThis[cell.counter], 0, `${said}: no getter or setter ran`);
}

/** Each stability loop checks the field premise before the entry-point call. */
function copiedPremise(t, value, row) {
  const cell = FIELD_COPIES.get(row);
  if (cell) {
    fieldPremise(value, cell, row);
    t.after(() => delete globalThis[cell.counter]);
  }
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
  ...Object.fromEntries([...FIELD_COPIES].map(([row, cell]) => [row, fieldSource(cell)])),
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
  ...Object.fromEntries([...FIELD_COPIES].map(([row, cell]) => [row, (config, said) => fieldCopy(config, cell, said)])),
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
  const keys = Array.isArray(given) ? Array.from({ length: given.length }, (_, index) => String(index)) : Object.keys(given);
  for (const key of keys) {
    const child = Object.getOwnPropertyDescriptor(given, key)?.value;
    if (child !== null && typeof child === 'object') spoil(child);
    change(() => { given[key] = () => 'not plain data'; });
  }
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
    copiedPremise(t, value, row);
    const first = await consumerConfig(directory);
    assertCopied(first, value, row);
    globalThis[key](() => 'not plain data');
    assert.equal(typeof (await exported(join(directory, CONFIG))), 'function', `${row}: the module's export did not change, so this proves nothing`);
    const later = await consumerConfig(directory);
    assert.deepStrictEqual(later, first, row);
    assertCopied(later, value, row);
  }
});

// proves R-SCHED-10
test('R2: a caller changing the object or list it was answered changes no later answer, for each copied row answered as one', async (t) => {
  for (const [row, source] of Object.entries(OBJECTS)) {
    const directory = target(t, source);
    const value = await exported(join(directory, CONFIG));
    copiedPremise(t, value, row);
    const first = await consumerConfig(directory);
    assertCopied(first, value, row);
    spoil(first.config);
    assert.notDeepStrictEqual(first.config, value, `${row}: the caller's change did not land, so this proves nothing`);
    assertCopied(await consumerConfig(directory), value, row);
  }
});

// proves R-SCHED-10
test('R3: the test changing the module\'s live export through its own reference, a later call through a symbolic link to the directory answers the first answer, for each copied row whose export can change', async (t) => {
  for (const [row, source] of Object.entries(OBJECTS).filter(([name]) => name !== 'E1a frozen' && !(FIELD_COPIES.get(name)?.integrity === 'freeze' && FIELD_COPIES.get(name).placement.name === 'whole export'))) {
    const directory = target(t, source);
    const link = join(temporaryDirectory('rigger-config-link-', { context: t }), 'linked');
    symlinkSync(directory, link);
    const value = await exported(join(directory, CONFIG));
    copiedPremise(t, value, row);
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
test('field cells: descriptor kinds and enumerability select plain array data and object fields without invoking accessors', async (t) => {
  for (const cell of FIELD_CELLS) {
    t.after(() => delete globalThis[cell.counter]);
    const directory = target(t, fieldSource(cell));
    const value = await exported(join(directory, CONFIG));
    const said = fieldName(cell);
    const descriptors = fieldPremise(value, cell, said);
    const answer = await consumerConfig(directory);
    if (cell.refusal === undefined) {
      assertCopied(answer, value, said);
      fieldCopy(answer.config, cell, said);
    } else {
      assert.deepEqual(Object.keys(answer), ['problem'], `${said}: refused without a partial config`);
      assert.equal(typeof answer.problem, 'string', said);
      assert.doesNotMatch(answer.problem, UNPRINTABLE, said);
      assert.ok(answer.problem.includes(`holds ${cell.refusal} at \`${cell.placement.path}${cell.part}\``), `${said}: ${answer.problem}`);
    }
    assert.equal(globalThis[cell.counter], 0, `${said}: no getter or setter ran`);
    for (const [node, before] of descriptors) {
      const after = Object.getOwnPropertyDescriptors(node);
      assert.deepStrictEqual(after, before, `${said}: source descriptors unchanged`);
      for (const key of Object.keys(before)) if (Object.hasOwn(before[key], 'value')) assert.equal(after[key].value, before[key].value, `${said}: source data identity unchanged`);
    }
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
