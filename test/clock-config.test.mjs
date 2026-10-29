// ABOUTME: Tests clock declarations and adjacent schedule occurrences against card 1077's tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import * as config from '../src/config/validate.mjs';
import rigger from '../rigger.config.mjs';
import { kindOf } from '../src/workflow/next-action.mjs';
import { checkAcceptanceForm } from '../src/workflow/form-check.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

const job = () => ({ interval: 60000, anchor: '2026-10-28T08:00Z', catchUp: 'skip', job: 'report' });
const clocked = (clock) => ({ ...rigger, clock });
const triggered = (trigger) => clocked({ poll: 1000, triggers: { daily: trigger } });
const template = () => ({ title: 'Audit', labels: ['type:change'], acceptance: '- The audit writes a result.' });
const cardTrigger = () => {
  const { job: unused, ...trigger } = job();
  return { ...trigger, card: template() };
};

/** Import the actual merge-base validator, preserving its value rendering and property reads. */
async function baseValidator() {
  // Git owns the merge base. Import its actual validator with only its relative import URLs
  // resolved, so the oracle includes the base's JSON rendering, not a reimplementation of it.
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', env: gitEnvironment() }).trim();
  const source = execFileSync('git', ['show', `${base}:src/config/validate.mjs`], { encoding: 'utf8', env: gitEnvironment() });
  const moduleURL = new URL('../src/config/validate.mjs', import.meta.url);
  const resolved = source.replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, moduleURL).href}'`);
  const original = await import(`data:text/javascript,${encodeURIComponent(resolved)}`);
  return { validate: original.validate, base };
}

/** Observe refusals without allowing validation to change the configuration it reads. */
function refusals(value) {
  const before = inspect(value, { depth: Infinity, showHidden: true });
  let answer;
  assert.doesNotThrow(() => { answer = config.validate(value); }, 'C36: validation never throws');
  assert.ok(Array.isArray(answer), 'C36: validation answers a list');
  assert.equal(inspect(value, { depth: Infinity, showHidden: true }), before, 'validation changed the config');
  // Check every template label list encountered, including malformed entries. kindOf itself
  // safely compares those entries; only malformed selectors/epic settings prevent the call.
  const { clock, ...rest } = value;
  if (config.validate(rest).length === 0 && Object.hasOwn(value, 'clock') && clock && Object.hasOwn(clock, 'triggers')) {
    for (const [name, trigger] of Object.entries(clock?.triggers ?? {})) {
      const labels = trigger && Object.hasOwn(trigger, 'card') ? trigger.card?.labels : undefined;
      if (!Array.isArray(labels)) continue;
      const copied = [];
      const length = labels.length;
      for (let index = 0; index < length; index += 1) copied[index] = labels[index];
      const selection = kindOf({ number: 1, labels: copied }, rest.kinds, rest.epicLabel);
      const found = answer.some((line) => line.includes(`clock.triggers.${name}.card.labels`)
        && (line.includes('selects no kind') || line.includes('selected by more than one kind')));
      assert.equal(found, selection.kind === undefined, `R-SCHED-41 relation for ${inspect(labels)}`);
    }
  }
  return answer;
}

/** A refusal names its exact path, and its value where the row requires one. */
function refused(value, path, entry = []) {
  const answer = refusals(value);
  const found = answer.find((line) => line.includes(`\`${path}\``));
  assert.ok(found, `${path} ${entry.join(', ')}: expected a refusal, got ${inspect(answer)}`);
  for (const text of entry) assert.ok(found.includes(text), `${found} does not name ${text}`);
  return found;
}

// A clock with no work still needs its own explicit poll; a default would hide a missing key.
// proves R-SCHED-30
test('C1-C6: clock is optional, and every declared clock requires a positive whole poll', () => {
  assert.deepEqual(refusals(rigger), []);
  assert.deepEqual(refusals(clocked({ poll: 1 })), []);
  assert.deepEqual(refusals(clocked({ poll: 1000, triggers: {} })), []);
  const inheritedTriggers = Object.assign(Object.create({ triggers: { hidden: {} } }), { poll: 1 });
  assert.deepEqual(refusals(clocked(inheritedTriggers)), [], 'C2: inherited triggers are not declared');
  for (const clock of [{ triggers: { daily: job() } }, {}]) {
    assert.match(refused(clocked(clock), 'clock.poll'), /required/);
  }
  for (const poll of [0, -1, 1.5, '1000', NaN, Infinity, 1n, Symbol('poll'), () => {}]) {
    refused(clocked({ poll }), 'clock.poll', [inspect(poll)]);
  }
});

// The shared refusal must render JavaScript values that JSON cannot serialize, at every shape site.
test('C30 C37 C41: unserializable nonobjects earn one refusal and every answered base probe retains its exact rendering', async (t) => {
  const cycle = [];
  cycle.push(cycle);
  const trigger = cardTrigger();
  const sites = [
    ['clock', (value) => clocked(value)],
    ['clock.triggers', (value) => clocked({ poll: 1000, triggers: value })],
    ['clock.triggers.daily', (value) => triggered(value)],
    ['clock.triggers.daily.card', (value) => triggered({ ...trigger, card: value })],
    ['roles', (value) => ({ ...rigger, roles: value })],
    ['board', (value) => ({ ...rigger, board: value })],
    ['kinds', (value) => ({ ...rigger, kinds: value })],
    ['kinds.change', (value) => ({ ...rigger, kinds: { ...rigger.kinds, change: value } })],
    ['provisioning', (value) => ({ ...rigger, provisioning: value })],
  ];
  for (const [path, valueAt] of sites) {
    for (const value of [1n, [1n], cycle]) {
      const answer = refusals(valueAt(value));
      assert.equal(answer.length, 1, `${path}: ${inspect(value)} earns one refusal`);
      assert.ok(answer[0].includes(`\`${path}\``) && answer[0].includes('holds no declarations'), inspect(answer));
    }
  }
  const original = await baseValidator();
  const base = original.base;
  const paths = [];
  const visit = (value, parts = []) => {
    paths.push(parts);
    if (value && typeof value === 'object') {
      for (const [key, held] of Object.entries(value)) visit(held, [...parts, key]);
    }
  };
  visit(rigger);
  const cyclic = {};
  cyclic.self = cyclic;
  let answered = 0;
  const sharedSites = new Set();
  for (const parts of paths) {
    for (const value of [null, undefined, 'npm ci', 3, NaN, Infinity, 1n, Symbol('probe'), () => {}, [1n], cycle, cyclic]) {
      let probe = structuredClone(rigger);
      if (parts.length === 0) probe = value;
      else {
        const holder = parts.slice(0, -1).reduce((at, key) => at[key], probe);
        holder[parts.at(-1)] = value;
      }
      let expected;
      try { expected = original.validate(probe); }
      catch (error) {
        if (error.stack.includes('at holdsNothing ')) {
          let answer;
          assert.doesNotThrow(() => { answer = config.validate(probe); }, `C37: ${parts.join('.')}`);
          assert.equal(answer.length, 1, inspect(answer));
          const path = parts.join('.') || 'the config';
          assert.ok(answer[0].includes(`\`${path}\``) && answer[0].includes('holds no declarations'), inspect(answer));
          sharedSites.add(path);
        }
        continue; // C40 remains outside the card.
      }
      assert.deepEqual(config.validate(probe), expected, `${parts.join('.')}: ${inspect(value)}`);
      answered += 1;
    }
  }
  assert.ok(answered > 0, 'the base answered no parity probe');
  assert.ok(sharedSites.size > 0, 'no shared-formatter throw was probed at the base');
  t.diagnostic(JSON.stringify({ base, paths: paths.length, answered, sharedSites: [...sharedSites] }));
  // C41 explicitly keeps the base's consumer rendering hooks in the shared shape refusal.
  const rendered = (read) => {
    const calls = [];
    const roles = [];
    Object.defineProperties(roles, {
      toJSON: { value() { calls.push('toJSON'); return undefined; } },
      toString: { value() { calls.push('toString'); return 'consumer rendering'; } },
    });
    return { answer: read({ ...rigger, roles }), calls };
  };
  const expectedRendering = { answer: ['`roles` holds no declarations, and Rigger reads consumer rendering as none'], calls: ['toJSON', 'toString'] };
  assert.deepEqual(rendered(original.validate), expectedRendering, 'C41: the base invokes the rendering hooks');
  assert.deepEqual(rendered(config.validate), expectedRendering, 'C41: retain the base rendering hooks');
  const inherited = Object.assign(Object.create({ clock: { poll: 0 } }), structuredClone(rigger));
  assert.deepEqual(config.validate(inherited), original.validate(inherited), 'C41: an inherited clock is no declaration');
});

// Each shape must be read as declarations, including scalar values a JavaScript config can hold.
test('C7 C15 C28 C29: clock shapes require their keys and refuse unoffered keys and nonobjects', () => {
  const trigger = cardTrigger();
  const { card } = trigger;
  for (const key of ['interval', 'anchor', 'catchUp']) {
    const missing = { ...trigger };
    delete missing[key];
    assert.match(refused(triggered(missing), `clock.triggers.daily.${key}`), /required/);
  }
  for (const key of ['title', 'labels', 'acceptance']) {
    const missing = { ...card };
    delete missing[key];
    assert.match(refused(triggered({ ...trigger, card: missing }), `clock.triggers.daily.card.${key}`), /required/);
  }
  const sites = [
    ['clock', (value) => clocked(value)],
    ['clock.triggers', (value) => clocked({ poll: 1000, triggers: value })],
    ['clock.triggers.daily', (value) => triggered(value)],
    ['clock.triggers.daily.card', (value) => triggered({ ...trigger, card: value })],
  ];
  for (const [path, valueAt] of sites) {
    for (const value of [null, undefined, 'npm ci', ['npm ci'], 3, true, 1n]) {
      const answer = refusals(valueAt(value));
      assert.equal(answer.length, 1, `${path}: ${inspect(value)} earns one shape refusal`);
      assert.ok(answer[0].includes(`\`${path}\``) && answer[0].includes('holds no declarations'), inspect(answer));
    }
  }
  for (const [path, valueAt, value] of [
    ['clock.extra', clocked, { poll: 1000, extra: true }],
    ['clock.triggers.daily.author', triggered, { ...job(), author: 'owner' }],
    ['clock.triggers.daily.author', triggered, { ...trigger, author: 'owner' }],
    ['clock.triggers.daily.card.extra', triggered, { ...trigger, card: { ...card, extra: true } }],
  ]) refused(valueAt(value), path);
});

// Declaring both work keys or neither gives the engine no single action to fire.
test('C12 C13 C32: a trigger declares exactly one of card and job', () => {
  assert.deepEqual(refusals(triggered(job())), []);
  assert.deepEqual(refusals(triggered(cardTrigger())), []);
  const neither = job();
  delete neither.job;
  refused(triggered(neither), 'clock.triggers.daily');
  refused(triggered({ ...job(), card: template() }), 'clock.triggers.daily');
  assert.deepEqual(refusals(clocked({ poll: 1000, triggers: {
    report: job(), audit: cardTrigger(), authored: { ...cardTrigger(), card: { ...template(), author: 'engineer' } },
  } })), []);
  const inheritedCard = Object.assign(Object.create({ card: { ...template(), title: '', labels: ['type:change', 'area:inherited'] } }), job());
  assert.deepEqual(refusals(triggered(inheritedCard)), [], 'a job declares no inherited card');
  assert.deepEqual(config.declaredLabels(triggered(inheritedCard)), config.declaredLabels(rigger), 'an inherited card declares no labels');
});

test('C11 C31: catchUp accepts fire or skip and refuses every other policy by path and value', () => {
  for (const catchUp of ['fire', 'skip']) assert.deepEqual(refusals(triggered({ ...job(), catchUp })), []);
  for (const catchUp of ['later', 'Fire', '', null, 3, 1n, Symbol('policy'), () => {}]) {
    refused(triggered({ ...job(), catchUp }), 'clock.triggers.daily.catchUp', [inspect(catchUp)]);
  }
});

test('C14 C31: report is the only offered clock job', () => {
  assert.deepEqual(refusals(triggered(job())), []);
  for (const work of ['build', 'Report', '', null, 3, 1n, Symbol('work'), () => {}]) {
    refused(triggered({ ...job(), job: work }), 'clock.triggers.daily.job', [inspect(work)]);
  }
});

test('C8 C31: interval is a positive whole number of milliseconds, parsed by the exported schedule function', () => {
  for (const interval of [0, -1, 1.5, '60000', NaN, Infinity, 1n, Symbol('interval'), () => {}]) {
    refused(triggered({ ...job(), interval }), 'clock.triggers.daily.interval', [inspect(interval)]);
  }
  assert.equal(typeof config.schedule, 'function', 'one exported schedule parser serves validation and L3');
  assert.ok(config.schedule({ ...job(), interval: 0 }, 0).refusals.some(({ key }) => key === 'interval'));
  for (const interval of [1, 60000]) assert.deepEqual(refusals(triggered({ ...job(), interval })), []);
});

test('C9 C10 C31: anchors carry a bounded offset and name an existing Gregorian date and time', () => {
  for (const anchor of [
    '2026-10-28T08:00Z', '2026-10-28T09:00:00+01:00', '2026-10-28T07:00:59-01:00',
    '2026-10-28T23:59+23:59', '2026-10-28T08:00:00.1Z', '2026-10-28T08:00:00.12Z',
    '2026-10-28T08:00:00.123Z', '2028-02-29T00:00Z', '0050-01-01T00:00Z', '0000-02-29T00:00Z',
  ]) assert.deepEqual(refusals(triggered({ ...job(), anchor })), [], anchor);
  for (const anchor of [
    null, 3, 1n, Symbol('anchor'), () => {}, '2026-10-28T08:00', '2026-10-28',
    '2026-10-28 08:00Z', '2026-10-28t08:00Z', '2026-10-28T08:00z',
    '2026-10-28T08:00:00.1234Z', '2026-10-28T08:00.1Z', '2026-10-28T08:00-00:00',
    '2026-10-28T08:00+24:00', '2026-10-28T08:00+05:60', '2026-10-28T08:00:60Z',
    '2026-02-29T00:00Z', '2026-02-30T00:00Z', '2026-10-28T24:00Z', '2026-10-28T08:60Z',
    '2026-00-01T00:00Z', '2026-13-01T00:00Z', '2026-04-31T00:00Z', '1900-02-29T00:00Z',
    '2026-01-00T00:00Z', '+010000-01-01T00:00Z', '2026-10-28T08:00Z\n',
  ]) {
    const trigger = { ...job(), anchor };
    refused(triggered(trigger), 'clock.triggers.daily.anchor', [inspect(anchor)]);
    assert.ok(config.schedule(trigger, 0).refusals.some(({ key }) => key === 'anchor'), inspect(anchor));
  }
});

// Expected occurrences come from the anchor's literal instant and worked additions of the interval.
test('S1-S7 S9 S10: schedule answers the adjacent occurrences without drift or a time-range overflow', () => {
  assert.equal(typeof config.schedule, 'function', 'the schedule function is exported');
  const anchor = Date.parse('2026-10-28T08:00Z');
  const interval = 60000;
  for (const [instant, newest, next] of [
    [anchor - 1, null, anchor],
    [anchor, anchor, anchor + interval],
    [anchor + 90000, anchor + interval, anchor + 2 * interval],
    [anchor + 2 * interval, anchor + 2 * interval, anchor + 3 * interval],
  ]) {
    const answer = config.schedule(job(), instant);
    assert.deepEqual(answer, { refusals: [], newest, next });
    for (const spelling of ['2026-10-28T09:00:00+01:00', '2026-10-28T07:00:00-01:00']) {
      assert.deepEqual(config.schedule({ ...job(), anchor: spelling }, instant), answer, spelling);
    }
  }
  const fraction = Date.parse('2026-10-28T08:00:00.123Z');
  const fine = { ...job(), anchor: '2026-10-28T08:00:00.123Z', interval: 1 };
  assert.deepEqual(config.schedule(fine, fraction + 1000000000000), {
    refusals: [], newest: fraction + 1000000000000, next: fraction + 1000000000001,
  });
  const maximum = 8640000000000000;
  assert.deepEqual(config.schedule(fine, maximum), { refusals: [], newest: maximum, next: null });
  const ancient = { ...job(), anchor: '0050-01-01T00:00Z', interval: 86400000 };
  const instant = Date.parse(ancient.anchor);
  const answer = config.schedule(ancient, instant);
  assert.deepEqual(answer, { refusals: [], newest: instant, next: instant + 86400000 });
  const date = new Date(answer.newest);
  assert.equal(date.getUTCFullYear(), 50);
  assert.equal(date.getUTCMonth(), 0);
  assert.equal(date.getUTCDate(), 1);
  // S10: a millisecond anchor with a non-unit interval, and the earliest supported instant.
  assert.deepEqual(config.schedule({ ...fine, interval: 7 }, fraction + 20), {
    refusals: [], newest: fraction + 14, next: fraction + 21,
  });
  assert.deepEqual(config.schedule(job(), -maximum), { refusals: [], newest: null, next: anchor });
});

test('C16 C31: a card title is one string containing nonwhitespace text', () => {
  for (const title of ['', ' \t\n', null, 3, ['Audit'], 1n, Symbol('title'), () => {}]) {
    refused(triggered({ ...cardTrigger(), card: { ...template(), title } }), 'clock.triggers.daily.card.title');
  }
  for (const title of ['Audit', ' Audit #1\nnext line ']) {
    assert.deepEqual(refusals(triggered({ ...cardTrigger(), card: { ...template(), title } })), []);
  }
});

test('C17 C31: template labels are a list whose every entry names a label', () => {
  for (const labels of [null, 'type:change', 3, 1n, Symbol('labels'), () => {}, [''], [' \t'], ['type:change', 3], [, 'type:change']]) {
    refused(triggered({ ...cardTrigger(), card: { ...template(), labels } }), 'clock.triggers.daily.card.labels');
  }
});

// Probes no selection, multiple selections, epic exclusion and GitHub's ASCII status-label folding.
// proves R-SCHED-41
test('C18-C21 C33 C34: template labels follow kindOf and exclude the status label without cascading config errors', () => {
  for (const [labels, rejected] of [
    [[], true], [['unselected'], true], [['type:epic', 'type:change'], true],
    [['type:change', 'type:spec'], true], [['TYPE:CHANGE', 'TYPE:SPEC'], true],
    [['type:change', 'rigger:status'], true], [['type:change', 'Rigger:Status'], true],
    [['TYPE:CHANGE', 'unselected', 'rigger:escalated'], false],
    [['type:change', 'area:extra\n# details'], false],
  ]) {
    const value = triggered({ ...cardTrigger(), card: { ...template(), labels } });
    const answer = refusals(value);
    const selection = kindOf({ number: 1, labels }, value.kinds, value.epicLabel);
    const selectionRefused = answer.some((line) => line.includes('selects no kind') || line.includes('selected by more than one kind'));
    assert.equal(selectionRefused, selection.kind === undefined, inspect(labels));
    assert.equal(answer.length > 0, rejected, inspect(labels));
    if (rejected) {
      assert.ok(answer.some((line) => line.includes('clock.triggers.daily') && line.includes(inspect(labels))), inspect(answer));
    }
  }
  const malformed = [
    { kinds: null }, { kinds: 'npm ci' }, { kinds: 3 },
    { kinds: { ...rigger.kinds, change: null } },
    { kinds: { ...rigger.kinds, change: { ...rigger.kinds.change, select: 3 } } },
    { kinds: { ...rigger.kinds, change: { ...rigger.kinds.change, select: { labels: 'type:change' } } } },
    { epicLabel: 3 }, { epicLabel: ['type:epic'] }, { epicLabel: 'type:change' },
  ];
  for (const change of malformed) {
    const base = { ...rigger, ...change };
    assert.deepEqual(refusals({ ...base, clock: triggered(cardTrigger()).clock }), refusals(base), inspect(change));
  }
});

test('C22 C31: template acceptance is one string', () => {
  for (const acceptance of [null, 3, ['- The audit writes a result.'], 1n, Symbol('acceptance'), () => {}]) {
    refused(triggered({ ...cardTrigger(), card: { ...template(), acceptance } }), 'clock.triggers.daily.card.acceptance');
  }
});

// A template's fragment is read under the same heading L2 will put on the opened card.
// proves R-SCHED-40
test('C23 C24: template acceptance follows the card form check under its Acceptance heading', () => {
  for (const [acceptance, admitted] of [
    ['', false], ['Only prose', false], ['- [ ] A task', false], ['- <!-- todo -->', false],
    ['```\n- A fenced item\n```', false], ['- Audit', false], ['- AUDIT!\n- Audit', false],
    ['- The audit writes a result.', true], ['- Audit\n- A second, substantive item.', true],
    ['### Details\n- The audit writes `a` result.\n\n## Other\n- Audit', true],
  ]) {
    const card = { ...template(), acceptance };
    const expected = checkAcceptanceForm({ number: 1, title: card.title, body: `## Acceptance\n\n${acceptance}` });
    assert.equal(expected.admitted, admitted, acceptance);
    const answer = refusals(triggered({ ...cardTrigger(), card }));
    assert.equal(answer.length > 0, !admitted, acceptance);
    if (!admitted) assert.ok(answer.some((line) => line.includes('clock.triggers.daily') && line.includes(expected.reason)), inspect(answer));
  }
});

// Own role keys are exact names; inherited Object.prototype keys and coerced names are no author.
// proves R-SCHED-42
test('C25-C27 C31 C35: a template author is absent, owner, or an own role name, without cascading roles errors', () => {
  for (const author of ['owner', ...Object.keys(rigger.roles)]) {
    assert.deepEqual(refusals(triggered({ ...cardTrigger(), card: { ...template(), author } })), []);
  }
  assert.deepEqual(refusals(triggered(cardTrigger())), []);
  for (const author of ['Owner', 'toString', 'Engineer', 'missing\n`role`', '', null, 3, ['engineer'], 1n, Symbol('author'), () => {}]) {
    const text = refused(triggered({ ...cardTrigger(), card: { ...template(), author } }), 'clock.triggers.daily.card.author');
    assert.ok(text.includes(inspect(author)), text);
  }
  for (const roles of [null, undefined, 'npm ci', ['npm ci'], 3]) {
    const base = { ...rigger, roles };
    const withAuthor = triggered({ ...cardTrigger(), card: { ...template(), author: 'engineer' } });
    assert.deepEqual(refusals({ ...base, clock: withAuthor.clock }), refusals(base));
  }
});

test('template labels enter declaredLabels after provider labels and before fixed labels, first spelling once', () => {
  const first = { ...cardTrigger(), card: { ...template(), labels: ['TYPE:CHANGE', 'area:first', 'RIGGER:ESCALATED', 'maker:codex'] } };
  const second = { ...cardTrigger(), card: { ...template(), labels: ['type:change', 'AREA:FIRST', 'area:second\n# text'] } };
  const value = clocked({ poll: 1000, triggers: { first, report: job(), second } });
  assert.deepEqual(refusals(value), []);
  assert.deepEqual(config.declaredLabels(value), [
    'type:change', 'type:spec', 'type:structure', 'type:intake', 'type:spike', 'area:demo',
    'type:epic', 'maker:codex', 'area:first', 'RIGGER:ESCALATED', 'area:second\n# text', 'rigger:status',
  ]);
  const inherited = Object.assign(Object.create({ clock: value.clock }), structuredClone(rigger));
  assert.deepEqual(refusals(inherited), []);
  assert.deepEqual(config.declaredLabels(inherited), config.declaredLabels(rigger), 'inherited clock labels are not declared');
  const inheritedTriggers = Object.assign(Object.create({ triggers: value.clock.triggers }), { poll: 1 });
  assert.deepEqual(refusals(clocked(inheritedTriggers)), []);
  assert.deepEqual(config.declaredLabels(clocked(inheritedTriggers)), config.declaredLabels(rigger), 'inherited triggers declare no labels');
});

test('the published clock declares both work shapes and validates on this repository config', async () => {
  const architecture = readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  const blocks = [...architecture.matchAll(/```js\r?\n([\s\S]*?)```/g)]
    .map(([, source]) => source).filter((source) => source.includes('export default'));
  assert.equal(blocks.length, 1);
  const published = (await import(`data:text/javascript,${encodeURIComponent(blocks[0])}`)).default;
  assert.ok(Object.hasOwn(published, 'clock'), 'the published config offers clock');
  const triggers = Object.values(published.clock.triggers);
  assert.ok(triggers.some((trigger) => trigger.job === 'report'));
  assert.ok(triggers.some((trigger) => Object.hasOwn(trigger.card ?? {}, 'author')));
  assert.deepEqual(refusals(clocked(published.clock)), []);
});

// C41 preserves existing returned answers even when consumer getters change between reads.
test('C41: role and provisioning timeout getters retain the exact base answer', async (t) => {
  const original = await baseValidator();
  for (const [section, name, timeout] of [
    ['roles', 'engineer', config.roleTimeout], ['provisioning', 'npm-ci', config.stepTimeout],
  ]) {
    await t.test(`${section}.${name}.timeout`, () => {
      const make = () => {
        let reads = 0;
        return { ...rigger, [section]: { ...rigger[section], [name]: {
          ...rigger[section][name], get timeout() { return ++reads === 1 ? 1000 : 0; },
        } } };
      };
      const expected = [`\`${section}.${name}.timeout\` must be a positive whole number of milliseconds, and the config gives 0`];
      assert.deepEqual(original.validate(make()), expected, 'the base refuses the changing getter');
      const value = make();
      const actual = config.validate(value);
      assert.equal(timeout(value[section][name]), 0, 'the execution boundary sees the invalid timeout');
      assert.deepEqual(actual, expected, 'C41: preserve the base timeout refusal');
    });
  }
});

// C17 reads indexed entries, including holes, rather than an array's replaceable iterator.
test('C17 C41: template label validation reads indexed entries without changing nonclock selectors', async () => {
  const original = await baseValidator();
  for (const hidden of [3, undefined]) {
    const labels = ['type:change', hidden];
    labels[Symbol.iterator] = function* () { yield 'type:change'; };
    assert.equal(labels.length, 2);
    assert.equal(labels[1], hidden);
    assert.equal(JSON.stringify(labels), hidden === 3 ? '["type:change",3]' : '["type:change",null]');
    const value = triggered({ ...cardTrigger(), card: { ...template(), labels } });
    const answer = refusals(value);
    assert.ok(answer.includes('`clock.triggers.daily.card.labels` must be a list of label names'),
      `C17: the indexed nonstring must be refused; got ${inspect(answer)}`);
    // The same existing selector is intentionally left at its base answer under C41.
    const nonclock = { ...rigger, kinds: { ...rigger.kinds, change: { ...rigger.kinds.change, select: { labels } } } };
    assert.deepEqual(original.validate(nonclock), []);
    assert.deepEqual(config.validate(nonclock), original.validate(nonclock), 'C41: keep existing selector answers');
  }
  const labels = ['type:change', 'area:indexed'];
  labels[Symbol.iterator] = function* () { throw new Error('a template label iterator is not its entries'); };
  const value = triggered({ ...cardTrigger(), card: { ...template(), labels } });
  assert.deepEqual(refusals(value), []);
  assert.ok(config.declaredLabels(value).includes('area:indexed'), 'the inventory reads the same indexed labels');
});

// C20's indexed label must remain visible despite a consumer-defined traversal method.
test('C20: a non-enumerable own some cannot hide an indexed status label', () => {
  const labels = ['type:change', 'Rigger:Status'];
  let calls = 0;
  Object.defineProperty(labels, 'some', { value(predicate, thisArg) {
    calls += 1;
    return predicate.call(thisArg, this[0], 0, this);
  } });
  assert.equal(Object.getOwnPropertyDescriptor(labels, 'some').enumerable, false);
  assert.equal(labels.length, 2);
  assert.equal(labels[1], 'Rigger:Status');
  assert.equal(JSON.stringify(labels), '["type:change","Rigger:Status"]');
  const value = triggered({ ...cardTrigger(), card: { ...template(), labels } });
  const before = inspect(value, { depth: Infinity, showHidden: true });
  const answer = config.validate(value);
  assert.ok(answer.some((line) => line.includes('clock.triggers.daily.card.labels') && line.includes('status label')),
    `C20 must refuse the indexed status label; got ${inspect(answer)}`);
  assert.equal(calls, 0, 'the clock path must not dispatch the consumer array method');
  assert.equal(inspect(value, { depth: Infinity, showHidden: true }), before, 'validation changed the config');
  const methods = ['some', 'every', 'includes', 'map', 'filter', 'indexOf', 'join', 'forEach',
    'toString', 'valueOf', 'constructor', Symbol.iterator];
  for (const entries of [[], ['unselected'], ['type:change', 'type:spec'],
    ['type:change', 'Rigger:Status'], ['type:change', 'area:extra'], ['type:change', 3], ['']]) {
    const plain = Array.of(...entries);
    const altered = Array.of(...entries);
    for (const method of methods) Object.defineProperty(altered, method, {
      get() { throw new Error(`template labels must not read ${String(method)}`); },
    });
    const make = (labels) => triggered({ ...cardTrigger(), card: { ...template(), labels } });
    const expected = config.validate(make(plain));
    const actual = config.validate(make(altered));
    assert.deepEqual(actual, expected, `C38: indexed answers for ${inspect(entries)}`);
    const selected = kindOf({ labels: plain }, rigger.kinds, rigger.epicLabel);
    const selectionRefused = actual.some((line) => line.includes('selects no kind') || line.includes('selected by more than one kind'));
    assert.equal(selectionRefused, selected.kind === undefined, 'C38: kindOf reads the plain copy');
  }

});

// C38 reads inherited indexed elements as the forge receives them, once each.
test('C38: validation reads length and indexed label elements once', () => {
  const reads = [];
  const target = new Array(2);
  Object.defineProperty(target, '0', { get() { reads.push('0'); return 'type:change'; }, configurable: true });
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, '1', { get() { reads.push('inherited 1'); return 'Rigger:Status'; } });
  Object.setPrototypeOf(target, prototype);
  const labels = new Proxy(target, { get(value, key, receiver) {
    if (key === 'length') reads.push('length');
    return Reflect.get(value, key, receiver);
  } });
  const make = (labels) => triggered({ ...cardTrigger(), card: { ...template(), labels } });
  const expected = config.validate(make(['type:change', 'Rigger:Status']));
  assert.deepEqual(expected, ["`clock.triggers.daily.card.labels` [ 'type:change', 'Rigger:Status' ] holds the status label"]);
  const actual = config.validate(make(labels));
  assert.deepEqual(actual, expected, 'C38: an inherited label is carried to the forge');
  assert.deepEqual(reads, ['length', '0', 'inherited 1'], 'C38: capture length once and read each element once');
  assert.equal(Object.hasOwn(target, '1'), false, 'validation must not fill the input hole');
});

test('C38: label inventory uses the same plain indexed copy', () => {
  const reads = [];
  const target = new Array(3);
  Object.defineProperties(target, {
    0: { get() { reads.push('0'); return 'type:change'; } },
    1: { get() { reads.push('1'); return 'area:own'; } },
  });
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, '2', { get() { reads.push('inherited 2'); return 'area:inherited'; } });
  Object.setPrototypeOf(target, prototype);
  const labels = new Proxy(target, { get(value, key, receiver) {
    if (key === 'length') reads.push('length');
    return Reflect.get(value, key, receiver);
  } });
  const make = (labels) => triggered({ ...cardTrigger(), card: { ...template(), labels } });
  const expected = config.declaredLabels(make(['type:change', 'area:own', 'area:inherited']));
  assert.deepEqual(config.declaredLabels(make(labels)), expected, 'C38: inventory includes an inherited element');
  assert.deepEqual(reads, ['length', '0', '1', 'inherited 2'], 'C38: inventory reads each element once');
  assert.equal(Object.hasOwn(target, '2'), false, 'inventory must not fill the input hole');
  const ordinary = ['type:change', 'area:own'];
  const altered = Array.of(...ordinary);
  for (const method of ['some', 'every', 'includes', 'map', 'filter', 'join', 'forEach', 'constructor', Symbol.iterator]) {
    Object.defineProperty(altered, method, { get() { throw new Error(`inventory must not read ${String(method)}`); } });
  }
  assert.deepEqual(config.declaredLabels(make(altered)), config.declaredLabels(make(ordinary)));
});

// Inherited indexed labels are carried to the forge even when an own traversal method differs.
test('C38: inherited template labels with an own some match the forge labels', () => {
  const labels = new Array(2);
  Object.setPrototypeOf(labels, Object.assign(Object.create(Array.prototype), {
    0: 'type:change', 1: 'area:inherited',
  }));
  let calls = 0;
  Object.defineProperty(labels, 'some', { value(predicate) { calls += 1; return predicate(this[0]); } });
  assert.equal(Object.hasOwn(labels, '0'), false);
  assert.equal(Object.hasOwn(labels, '1'), false);
  assert.equal(Object.hasOwn(labels, 'some'), true);
  assert.equal(JSON.stringify(labels), '["type:change","area:inherited"]');
  const carried = JSON.parse(JSON.stringify(labels));
  assert.equal(kindOf({ labels }, rigger.kinds, rigger.epicLabel).kind, 'change', 'the engine selects the inherited label');
  assert.equal(kindOf({ labels: carried }, rigger.kinds, rigger.epicLabel).kind, 'change', 'the forge labels select the same kind');
  calls = 0;
  const make = (labels) => triggered({ ...cardTrigger(), card: { ...template(), labels } });
  assert.deepEqual(config.validate(make(labels)), [], 'C38: inherited labels carried to the forge remain accepted');
  assert.deepEqual(config.declaredLabels(make(labels)), config.declaredLabels(make(carried)), 'C38: inventory includes the inherited labels');
  assert.equal(calls, 0, 'validation and inventory ignore the consumer method');
  assert.equal(Object.hasOwn(labels, '0'), false, 'the inherited label remains inherited');
  assert.equal(Object.hasOwn(labels, '1'), false, 'inventory leaves the input unchanged');
});
