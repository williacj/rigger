// ABOUTME: Refuses non-string makers that convert to declared role names, preserving other maker answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { validate } from '../src/config/validate.mjs';
import rigger from '../rigger.config.mjs';

/** Validation returns refusals without throwing or changing the config it reads. */
function answer(config) {
  const before = inspect(config, { showHidden: true, depth: null });
  let refusals;
  assert.doesNotThrow(() => { refusals = validate(config); });
  assert.equal(inspect(config, { showHidden: true, depth: null }), before, 'validate changed its config');
  return refusals;
}

/** The live config with exactly one maker path replaced. */
function withMaker(kind, value) {
  const config = structuredClone(rigger);
  config.kinds[kind].maker = value;
  return config;
}

/** The head's string twin supplies every refusal except the independently rendered maker value. */
function fromTwin(config, kind, value) {
  const twin = '1112-undeclared-maker';
  assert.equal(Object.hasOwn(config.roles, twin), false);
  const original = config.kinds[kind].maker;
  config.kinds[kind].maker = twin;
  const refusals = answer(config);
  config.kinds[kind].maker = original;
  assert.ok(refusals.includes(`\`kinds.${kind}.maker\` names \`${twin}\`, which is no role the config declares`));
  return refusals.map((text) => text.replaceAll(`\`${twin}\``, `\`${inspect(value)}\``));
}

const COERCED = {
  'M1: a one-entry list': (role) => [role],
  'M2: an object with toString': (role) => ({ toString() { return role; } }),
  'M8: a nested list': (role) => [[role]],
  'M8: a boxed string': (role) => new String(role),
};

/** A property-key conversion must not turn a non-string value into a maker role name. */
function refusesCoerced(make) {
  for (const [kind, { maker }] of Object.entries(rigger.kinds)) {
    const value = make(maker);
    const config = withMaker(kind, value);
    const expected = fromTwin(withMaker(kind, value), kind, value);
    assert.deepEqual(answer(config), expected, `${inspect(value)} at kinds.${kind}.maker`);
  }
}

// proves R-SCHED-10
test('M1: a one-entry list maker earns its string twin refusals with inspect rendering', () => {
  refusesCoerced(COERCED['M1: a one-entry list']);
});

// proves R-SCHED-10
test('M2: an object maker earns its string twin refusals with inspect rendering', () => {
  refusesCoerced(COERCED['M2: an object with toString']);
});

// proves R-SCHED-10
test('M8: nested lists and boxed strings earn their string twin refusals with inspect rendering', () => {
  refusesCoerced(COERCED['M8: a nested list']);
  refusesCoerced(COERCED['M8: a boxed string']);
});

// Incomplete maps expose an unwanted read of the refused maker's coerced role.
// proves R-SCHED-10
test('M8: refused coerced makers supply no providers to incomplete judge maps', () => {
  for (const make of Object.values(COERCED)) {
    for (const provider of [{}, { codex: 'codex' }, { claude: 'codex' }]) {
      const value = make('engineer');
      const config = withMaker('change', value);
      for (const judge of config.kinds.change.judges) judge.provider = provider;
      const expected = fromTwin(config, 'change', value);
      assert.deepEqual(answer(config), expected, `maker ${inspect(value)}, map ${inspect(provider)}`);
    }
  }
});

// M3-M6 are invariant guards: their literal answers were measured at the merge base (journal).
test('M3: a string naming a declared maker role remains accepted', () => {
  for (const [kind, { maker }] of Object.entries(rigger.kinds)) {
    assert.deepEqual(answer(withMaker(kind, maker)), [], `kinds.${kind}.maker = ${maker}`);
  }
});

test('M4: strings naming no declared maker role retain their literal refusals', () => {
  for (const [value, expected] of [
    ['nobody', ['`kinds.change.maker` names `nobody`, which is no role the config declares']],
    ['unoffered\n`maker`', ['`kinds.change.maker` names `unoffered\n`maker``, which is no role the config declares']],
  ]) {
    assert.deepEqual(answer(withMaker('change', value)), expected, inspect(value));
  }
});

test('M5: non-string makers naming no declared role retain their literal refusals', () => {
  for (const [value, expected] of [
    [3, ['`kinds.change.maker` names `3`, which is no role the config declares']],
    [NaN, ['`kinds.change.maker` names `NaN`, which is no role the config declares']],
    [1n, ['`kinds.change.maker` names `1`, which is no role the config declares']],
    [{}, ['`kinds.change.maker` names `[object Object]`, which is no role the config declares']],
    [[1n], ['`kinds.change.maker` names `1`, which is no role the config declares']],
    [function nobody() {}, ['`kinds.change.maker` names `function nobody() {}`, which is no role the config declares']],
  ]) {
    assert.deepEqual(answer(withMaker('change', value)), expected, inspect(value));
  }
});

test('M6: makers whose string conversion throws retain their literal refusals', () => {
  for (const [value, expected] of [
    [Symbol('maker'), ['`kinds.change.maker` names `Symbol(maker)`, which is no role the config declares']],
    [Object.create(null), ['`kinds.change.maker` names `[Object: null prototype] {}`, which is no role the config declares']],
    [{ toString() { throw new Error('boom'); } }, ['`kinds.change.maker` names `{ toString: [Function: toString] }`, which is no role the config declares']],
  ]) {
    assert.deepEqual(answer(withMaker('change', value)), expected, inspect(value));
  }
});

test('M8: makers naming an inherited role retain its provider-map refusal', () => {
  for (const value of ['ghost', ['ghost'], { toString() { return 'ghost'; } }]) {
    const config = withMaker('change', value);
    Object.setPrototypeOf(config.roles, { ghost: { provider: 'claude' } });
    config.kinds.change.judges[0].provider = { codex: 'codex' };
    assert.deepEqual(answer(config), [
      '`kinds.change.maker` names `ghost`, which is no role the config declares',
      "`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind's maker can run on",
    ], inspect(value));
  }
});

test('M8: string maker getters retain the base provider-map answer', () => {
  const config = structuredClone(rigger);
  let reads = 0;
  Object.defineProperty(config.kinds.change, 'maker', {
    enumerable: true,
    get() { return ++reads === 3 ? '1112-absent-role' : 'engineer'; },
  });
  config.kinds.change.judges[0].provider = { claude: 'codex' };
  assert.deepEqual(answer(config), []);
});

test('M8: a coerced maker shared with a judge earns only its string twin refusals', () => {
  for (const make of Object.values(COERCED)) {
    const value = make('engineer');
    const config = withMaker('change', value);
    config.kinds.change.judges[0].role = value;
    const expected = fromTwin(config, 'change', value);
    assert.deepEqual(answer(config), expected, inspect(value));
  }
});
