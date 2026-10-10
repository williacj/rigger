// ABOUTME: Tests L2's answer for a card's maker: the role answer with its declaration, the tier the
// card's labels select or the refusal of two that disagree, and the prompt Rigger's contract with
// every maker composes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextAction } from '../src/workflow/next-action.mjs';

/** A body whose acceptance passes the form check under the title `Add a verb`, with two items. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n- The verb exits 0.\n\n## Notes\n\n- Not an item.\n';

/** A ready card titled `Add a verb`, numbered `number`, carrying `labels` beside `type:change`. */
const card = (number, labels = []) => ({ number, title: 'Add a verb', body: PASSING, labels: ['type:change', ...labels] });

/** One kind, `change`, whose maker is `engineer`, listing no provisioning. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The roles a config declares: `engineer` with `labels` mapping three labels to tiers, and a judge. */
const ROLES = {
  engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard', timeout: 3_600_000, labels: { 'tier:high': 'high', 'tier:big': 'high', 'tier:low': 'standard' } },
  reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'high' },
};

/** L2's answer for `given` once every step has an outcome, none failed, under `roles`. */
const makerOf = (given, roles = ROLES) => nextAction(given, KINDS, undefined, { roles, provisioning: {}, outcomes: [] });

test('given a card whose steps all have outcomes and none required failed, L2 answers the kind\'s maker as a role answer with the role\'s agent file, provider and timeout as the config declares them', () => {
  const next = makerOf(card(7));

  assert.equal(next.action, 'dispatch');
  assert.equal(next.kind, 'change');
  assert.deepEqual(Object.keys(next.maker).sort(), ['agent', 'digest', 'evidence', 'instruction', 'provider', 'role', 'tier', 'timeout']);
  const { role, agent, provider, timeout } = next.maker;
  assert.deepEqual({ role, agent, provider, timeout }, { role: 'engineer', agent: '.claude/agents/engineer.md', provider: 'claude', timeout: 3_600_000 });
});

// proves R-LOOP-12
test('given a card carrying no label the maker role\'s labels names, the tier in L2\'s answer is the role\'s tier', () => {
  assert.equal(makerOf(card(8, ['area:demo'])).maker.tier, 'standard');
  assert.equal(makerOf(card(8), { ...ROLES, engineer: { ...ROLES.engineer, tier: 'high' } }).maker.tier, 'high');
});

// proves R-LOOP-12
test('given a card carrying one label the maker role\'s labels maps to high, the tier in L2\'s answer is high', () => {
  assert.equal(makerOf(card(9, ['tier:high'])).maker.tier, 'high');
});

// proves R-LOOP-12
test('given a card carrying a label the maker role\'s labels names in another letter case, the tier in L2\'s answer is the one it maps to', () => {
  assert.equal(makerOf(card(10, ['Tier:High'])).maker.tier, 'high');
});

// proves R-LOOP-13
test('given a card carrying two labels the maker role\'s labels maps to two different tiers, L2 refuses the card, naming the role and both labels', () => {
  for (const options of [{ roles: ROLES }, { roles: ROLES, provisioning: {}, outcomes: [] }]) {
    const next = nextAction(card(11, ['tier:low', 'tier:high']), KINDS, undefined, options);

    assert.equal(next.action, 'refuse', JSON.stringify(next));
    assert.equal(next.card, 11);
    assert.match(next.reason, /\bengineer\b/);
    assert.match(next.reason, /tier:low/);
    assert.match(next.reason, /tier:high/);
  }
});

// proves R-LOOP-12, R-LOOP-13
test('given a card carrying two labels the maker role\'s labels maps to the same tier, L2 answers that tier and refuses nothing', () => {
  const next = makerOf(card(12, ['tier:high', 'tier:big']));

  assert.equal(next.action, 'dispatch', JSON.stringify(next));
  assert.equal(next.maker.tier, 'high');
});

/** The prompt L2's maker answer for `given` composes, under the topic rule `topic`: its instruction, then its evidence. */
const promptOf = (given, topic) => {
  const { maker } = nextAction(given, KINDS, undefined, { roles: ROLES, provisioning: {}, outcomes: [], ...(topic === undefined ? {} : { topic }) });
  return `${maker.instruction}${maker.evidence}`;
};

test('L2\'s maker answer carries a prompt naming the card\'s number, its title, each acceptance item as R-CARD-12 reads it, and the line of work the topic rule derives', () => {
  const prompt = promptOf(card(42), 'work-{number}');

  assert.match(prompt, /#42\b/);
  assert.ok(prompt.includes('Add a verb'), prompt);
  assert.ok(prompt.includes('The verb prints its help.'), prompt);
  assert.ok(prompt.includes('The verb exits 0.'), prompt);
  assert.ok(!prompt.includes('Not an item.'), `a bullet outside the acceptance section is no acceptance item: ${prompt}`);
  assert.ok(prompt.includes('work-42'), prompt);
});

test('with no topic rule given, L2\'s maker prompt names the line of work the default rule derives, rigger-{number}', () => {
  assert.ok(promptOf(card(43)).includes('rigger-43'));
});

test('L2\'s maker answer\'s evidence holds the card\'s number, title and acceptance, and its instruction the rest', () => {
  const { maker } = nextAction(card(44), KINDS, undefined, { roles: ROLES, provisioning: {}, outcomes: [] });

  assert.ok(maker.evidence.includes('#44') && maker.evidence.includes('Add a verb') && maker.evidence.includes('The verb prints its help.'), maker.evidence);
  assert.ok(!maker.evidence.includes('rigger-44'), `the line of work is the instruction's, not the evidence's: ${maker.evidence}`);
  assert.ok(maker.instruction.includes('rigger-44'), maker.instruction);
});

test('L2\'s maker prompt tells the maker to open a pull request from its line of work once its work meets the acceptance', () => {
  assert.match(promptOf(card(45)), /once [^.]*meets[^.]*acceptance[^.]*open a pull request from `rigger-45`|open a pull request from `rigger-45`[^.]*once [^.]*meets[^.]*acceptance/i);
});

test('L2\'s maker prompt says that Rigger dispatched the session', () => {
  assert.match(promptOf(card(46)), /Rigger dispatched this session/);
});

test('L2\'s maker prompt tells the maker never to switch its workspace off its line of work, detach HEAD, or add a worktree inside its workspace', () => {
  const prompt = promptOf(card(47));

  assert.match(prompt, /never switch (the|this|your) workspace off `rigger-47`/i);
  assert.match(prompt, /never detach `HEAD`/i);
  assert.match(prompt, /never add a worktree inside (the|this|your) workspace/i);
});

test('L2\'s maker prompt tells the maker to exit non-zero, naming why, where it cannot finish the work', () => {
  assert.match(promptOf(card(48)), /where you cannot finish the work, exit non-zero, naming why/i);
});

// proves R-LOOP-13
test('given a card carrying two labels selecting different tiers for its maker role, whose acceptance the form check refuses, L2\'s one refusal names the role, both labels and the form check\'s reason', () => {
  const unformed = { ...card(13, ['tier:low', 'tier:high']), body: '## Notes\n\nNo acceptance here.\n' };

  const next = nextAction(unformed, KINDS, undefined, { roles: ROLES });

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 13);
  for (const named of [/\bengineer\b/, /tier:low/, /tier:high/, /missing acceptance/]) assert.match(next.reason, named);
});
