// ABOUTME: Tests L2's judge answer for a Review card: which agent judges it names from the findings
// comments at the pull request's head, each judge's tier and steps, the evidence and instruction
// each is handed, and what a failed read, a refused diff or a failed required step means.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** A body whose acceptance passes the form check, with two items and a bullet outside it. */
const BODY = '## Acceptance\n\n- The verb prints its help.\n- The verb exits 0.\n\n## Notes\n\n- Not an item.\n';

/** The pull request's head and base SHAs, an earlier head, and its diff, each written by hand. */
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const EARLIER = '3333333333333333333333333333333333333333';
const DIFF = 'diff --git a/src/verb.mjs b/src/verb.mjs\n+export const verb = 1;\n';
const EDITED = '2026-10-01T10:00:00Z';

/** The kinds: `spec`, judged by three agent judges and the owner, and `decision`, by the owner alone. */
const KINDS = {
  spec: { select: { labels: ['type:spec'] }, maker: 'pm', judges: ['reviewer', 'engineer', 'architect', 'owner'], provisioning: ['npm-ci', 'vhs'] },
  decision: { select: { labels: ['type:decision'] }, maker: 'pm', judges: ['owner'] },
};

/** The roles a config declares, `reviewer` with labels selecting tiers. */
const ROLES = {
  pm: { agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high' },
  reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'standard', timeout: 600_000, labels: { 'tier:high': 'high', 'tier:low': 'standard' } },
  engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard' },
  architect: { agent: '.claude/agents/architect.md', provider: 'claude', tier: 'high', timeout: 900_000 },
};

/** The provisioning steps: one required, one an `area:demo` card selects. */
const PROVISIONING = {
  'npm-ci': { run: 'npm ci', required: true },
  vhs: { run: 'brew list vhs', select: { labels: ['area:demo'] }, timeout: 60_000 },
};

/** A read's outcome as `Promise.allSettled` records one that answered `value`. */
const read = (value) => ({ status: 'fulfilled', value });

/** A read's outcome as `Promise.allSettled` records one that rejected with `message`. */
const failedRead = (message) => ({ status: 'rejected', reason: new Error(message) });

/** A comment on the pull request, first line `first`, then `rest`. */
const comment = (first, rest = 'Sound.') => ({ body: `${first}\n\n${rest}`, createdAt: '2026-10-01T11:00:00Z' });

/**
 * A Review card numbered 7 carrying `labels` beside `type:spec`, with the facts L2's facts call
 * holds for it: one open pull request, #70, its base and head SHAs, its diff, `comments`, and the
 * acceptance's revision. `facts` replaces any of those.
 */
const card = ({ labels = [], comments = [], ...facts } = {}) => ({
  number: 7,
  title: 'Add a verb',
  body: BODY,
  labels: ['type:spec', ...labels],
  column: 'Review',
  forge: {
    stage: 'review',
    line: 'rigger-7',
    branch: true,
    open: [{ number: 70, head: HEAD, base: 'main' }],
    merged: [],
    pull: read({ number: 70, base: BASE, head: HEAD }),
    diff: read(DIFF),
    comments: read(comments),
    editedAt: read(EDITED),
    ...facts,
  },
});

/**
 * An L5 sink over a state directory of the test's own under `TMPDIR`, removed at the test's
 * teardown, and a reader of the L2 events it holds under card 7.
 */
function sinkFor() {
  const directory = temporaryDirectory('rigger-judges-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  return { sink, events: () => (existsSync(streamPath(directory)) ? readEvents(directory) : []).filter((each) => each.layer === 'L2' && each.card === 7) };
}

/** L2's judge answer for `given`, under the kinds, roles and steps above, with `options` beside. */
const answer = (given, options = {}) => judgeAnswer(given, KINDS, undefined, { roles: ROLES, provisioning: PROVISIONING, sink: sinkFor().sink, ...options });

/** The roles a judge answer names, in order. */
const named = (next) => (next.judges ?? []).map((judge) => judge.role);

/** The judge a judge answer names as `role`. */
const judge = (next, role) => next.judges.find((each) => each.role === role);

test('given a Review card of kind spec with one open pull request and no comments, the judge answer names reviewer, engineer and architect, each as a role answer with its declaration and tier', () => {
  const next = answer(card());

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.equal(next.kind, 'spec');
  assert.deepEqual(named(next), ['reviewer', 'engineer', 'architect']);
  const declared = next.judges.map(({ role, agent, provider, tier, timeout }) => ({ role, agent, provider, tier, timeout }));
  assert.deepEqual(declared, [
    { role: 'reviewer', agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'standard', timeout: 600_000 },
    { role: 'engineer', agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard', timeout: 14_400_000 },
    { role: 'architect', agent: '.claude/agents/architect.md', provider: 'claude', tier: 'high', timeout: 900_000 },
  ]);
});

// proves R-LOOP-11
test('the judge answer for a kind naming the owner among its judges names no owner judge', () => {
  assert.ok(!named(answer(card())).includes('owner'));
});

// proves R-LOOP-11
test('given a Review card whose kind names the owner as its only judge, the judge answer is ignore', () => {
  assert.deepEqual(answer({ ...card(), labels: ['type:decision'] }), { action: 'ignore' });
});

test('given a findings comment from reviewer at the current head, the judge answer leaves reviewer out and names every other agent judge', () => {
  const next = answer(card({ comments: [comment(`Findings at ${HEAD} by reviewer`)] }));

  assert.deepEqual(named(next), ['engineer', 'architect']);
});

test('given a findings comment from every agent judge at the current head, the judge answer is ignore', () => {
  const comments = ['reviewer', 'engineer', 'architect'].map((role) => comment(`Findings at ${HEAD} by ${role}`));

  assert.deepEqual(answer(card({ comments })), { action: 'ignore' });
});

test('given a findings comment from every agent judge at an earlier head, the judge answer names every agent judge again', () => {
  const comments = ['reviewer', 'engineer', 'architect'].map((role) => comment(`Findings at ${EARLIER} by ${role}`));

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('given a comment naming the current head and a role the kind does not name as a judge, the judge answer counts it for no judge', () => {
  const comments = [comment(`Findings at ${HEAD} by pm`), comment(`Findings at ${HEAD} by owner`)];

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('a comment whose first line is not the findings line, even one naming the head and a judge elsewhere, counts for no judge', () => {
  const comments = [comment('Looks fine', `Findings at ${HEAD} by reviewer`), comment(`Findings at ${HEAD} by reviewer, mostly`)];

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('a comment written exactly as a judge\'s instruction says is read as that judge\'s findings at that head', () => {
  const { instruction } = judge(answer(card()), 'engineer');
  const [, first] = instruction.match(/first line is exactly `([^`]+)`/) ?? [];
  assert.ok(first, `the instruction names no first line: ${instruction}`);

  const next = answer(card({ comments: [{ body: `${first}\n\nThe acceptance is met.`, createdAt: '2026-10-01T12:00:00Z' }] }));

  assert.deepEqual(named(next), ['reviewer', 'architect']);
});

// proves R-LOOP-12
test('given a card carrying a label a judge role\'s labels maps to high, the judge answer names that judge at high and every other judge at its own tier', () => {
  const next = answer(card({ labels: ['tier:high'] }));

  assert.deepEqual(next.judges.map(({ role, tier }) => ({ role, tier })), [
    { role: 'reviewer', tier: 'high' },
    { role: 'engineer', tier: 'standard' },
    { role: 'architect', tier: 'high' },
  ]);
});

// proves R-LOOP-13
test('given a card carrying two labels a judge role\'s labels maps to two different tiers, L2 refuses the card, naming that role and both labels, and names no judge', () => {
  const next = answer(card({ labels: ['tier:low', 'tier:high'] }));

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 7);
  assert.equal(next.judges, undefined);
  for (const part of [/\breviewer\b/, /tier:low/, /tier:high/]) assert.match(next.reason, part);
});

test('for each judge it names, the judge answer names the card\'s selected steps for the judge\'s head, in the order the kind lists them', () => {
  const plain = answer(card());
  const demo = answer(card({ labels: ['area:demo'] }));

  for (const role of ['reviewer', 'engineer', 'architect']) {
    assert.deepEqual(judge(plain, role).steps, [{ name: 'npm-ci', run: 'npm ci' }]);
    assert.deepEqual(judge(demo, role).steps, [{ name: 'npm-ci', run: 'npm ci' }, { name: 'vhs', run: 'brew list vhs', timeout: 60_000 }]);
  }
});

/** A step's outcome as `Promise.allSettled` records L1's result for a command that exited `exit`. */
const exited = (exit) => ({ status: 'fulfilled', value: { exit, timedOut: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } });

test('given a judge\'s required step that failed, L2 answers that judge is not dispatched, and records under the card an event naming the role, the step and the failure classed as the environment\'s', () => {
  const { sink, events } = sinkFor();
  const next = answer(card(), { sink, outcomes: { reviewer: [exited(3)] } });

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.ok(!named(next).includes('reviewer'), JSON.stringify(named(next)));
  const recorded = events().map(({ event, role, step, exit, class: kind }) => ({ event, role, step, exit, class: kind }));
  assert.deepEqual(recorded, [{ event: 'judge.withheld', role: 'reviewer', step: 'npm-ci', exit: 3, class: 'environment' }]);
});

test('given a judge\'s required step that failed, L2 answers no retry of that judge and answers the other judges as before', () => {
  const before = answer(card());
  const next = answer(card(), { outcomes: { reviewer: [exited(3)] } });

  assert.deepEqual(Object.keys(next).sort(), ['action', 'judges', 'kind', 'withheld']);
  assert.deepEqual(next.judges, before.judges.filter((each) => each.role !== 'reviewer'));
});

test('given a judge whose steps all succeeded, L2 still names that judge, as it did before its steps ran', () => {
  const before = answer(card());
  const next = answer(card(), { outcomes: { reviewer: [exited(0)] } });

  assert.deepEqual(next.judges, before.judges);
});

test('L2\'s role answer for a judge names no directory: its fields are the role\'s declaration, its prompt, its facts and its steps', () => {
  assert.deepEqual(Object.keys(judge(answer(card()), 'reviewer')).sort(), ['agent', 'evidence', 'facts', 'instruction', 'provider', 'role', 'steps', 'tier', 'timeout']);
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence names the card\'s number, each acceptance item as R-CARD-12 reads it, and the acceptance\'s revision as the issue body\'s last edit time', () => {
  for (const { evidence } of answer(card()).judges) {
    assert.match(evidence, /#7\b/);
    assert.ok(evidence.includes('The verb prints its help.') && evidence.includes('The verb exits 0.'), evidence);
    assert.ok(!evidence.includes('Not an item.'), evidence);
    assert.ok(evidence.includes(EDITED), evidence);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence names the pull request\'s number, its base SHA and its head SHA', () => {
  for (const { evidence } of answer(card()).judges) {
    assert.match(evidence, /#70\b/);
    assert.ok(evidence.includes(BASE) && evidence.includes(HEAD), evidence);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence carries the pull request\'s diff as the facts hold it', () => {
  for (const { evidence } of answer(card()).judges) assert.ok(evidence.includes(DIFF), evidence);
});

test('given facts in which the forge would not serve the diff, the judge answer names no judge, and L2 records under the card an event naming the pull request and the forge\'s reason', () => {
  const { sink, events } = sinkFor();
  const next = answer(card({ diff: failedRead('HTTP 406: the diff exceeded the maximum number of lines') }), { sink });

  assert.deepEqual(next, { action: 'ignore' });
  const recorded = events().map(({ event, pull, reason }) => ({ event, pull, reason }));
  assert.equal(recorded.length, 1, JSON.stringify(recorded));
  assert.equal(recorded[0].event, 'diff.refused');
  assert.equal(recorded[0].pull, 70);
  assert.match(recorded[0].reason, /HTTP 406: the diff exceeded the maximum number of lines/);
});

test('given facts holding a failed read of the pull request, its comments or the acceptance revision, the judge answer names no judge, and its caller is told the card and the read that failed', () => {
  for (const [facts, what] of [
    [{ pull: failedRead('gh timed out') }, /pull request/],
    [{ comments: failedRead('gh timed out') }, /comments/],
    [{ editedAt: failedRead('gh timed out') }, /revision/],
  ]) {
    const given = card();
    Object.assign(given.forge, facts);
    assert.throws(() => answer(given), (error) => {
      assert.match(error.message, /#7\b/);
      assert.match(error.message, what);
      assert.match(error.message, /gh timed out/);
      return true;
    });
  }
});

// proves R-EVIDENCE-3
test('given facts where some judge has findings at an earlier head, each judge\'s evidence names that earlier head', () => {
  const next = answer(card({ comments: [comment(`Findings at ${EARLIER} by architect`)] }));

  assert.deepEqual(named(next), ['reviewer', 'engineer', 'architect']);
  for (const { evidence } of next.judges) assert.ok(evidence.includes(EARLIER), evidence);
});

test('a comment naming an earlier head and a role the kind does not name as a judge names no earlier head in any judge\'s evidence', () => {
  for (const { evidence } of answer(card({ comments: [comment(`Findings at ${EARLIER} by pm`)] })).judges) assert.ok(!evidence.includes(EARLIER), evidence);
});

test('with no findings at an earlier head, no judge\'s evidence names one', () => {
  for (const { evidence } of answer(card()).judges) assert.ok(!/earlier head/i.test(evidence), evidence);
});

test('each judge\'s instruction tells the judge to write its findings as one pull request comment whose first line names the head and its role', () => {
  for (const { role, instruction } of answer(card()).judges) {
    assert.match(instruction, /one comment on pull request #70/i);
    assert.ok(instruction.includes(`first line is exactly \`Findings at ${HEAD} by ${role}\``), instruction);
  }
});

// proves R-EVIDENCE-2
test('each judge\'s instruction tells the judge it may read beyond what it was given, and to build and test in its head directory without editing it', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.match(instruction, /may read beyond what you were given/i);
    assert.match(instruction, /build and test in the `head` directory/i);
    assert.match(instruction, /never edit it/i);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('given two judges of one card at one head, the evidence L2 attaches to each is byte-identical', () => {
  const [first, ...rest] = answer(card({ comments: [comment(`Findings at ${EARLIER} by reviewer`)] })).judges;

  assert.ok(rest.length > 0);
  for (const other of rest) assert.equal(Buffer.compare(Buffer.from(other.evidence), Buffer.from(first.evidence)), 0);
});

// proves R-EVIDENCE-4, R-LOOP-4
test('no judge\'s evidence or instruction holds any text of another judge\'s comment', () => {
  const marker = 'MARKER-FROM-AN-EARLIER-JUDGE-4f1c';
  const next = answer(card({ comments: [comment(`Findings at ${EARLIER} by reviewer`, `Needs revision. ${marker}`), comment(`Findings at ${HEAD} by architect`, marker)] }));

  assert.deepEqual(named(next), ['reviewer', 'engineer']);
  for (const { evidence, instruction } of next.judges) assert.ok(!evidence.includes(marker) && !instruction.includes(marker), `${instruction}${evidence}`);
});

// proves R-EVIDENCE-4, R-LOOP-4
test('no judge\'s evidence or instruction holds any text of the maker\'s output', () => {
  const marker = 'MARKER-FROM-THE-MAKER-9b2e';
  const given = { ...card(), output: { stdout: `I did the work. ${marker}`, stderr: marker } };

  for (const { evidence, instruction } of answer(given).judges) assert.ok(!evidence.includes(marker) && !instruction.includes(marker), `${instruction}${evidence}`);
});

test('each judge\'s role answer carries facts naming the card, the acceptance\'s revision, the pull request and its base and head SHAs, each equal to what its evidence names', () => {
  for (const { facts, evidence } of answer(card()).judges) {
    assert.deepEqual(facts, { card: 7, revision: EDITED, pull: 70, base: BASE, head: HEAD });
    for (const value of [`#${facts.card}`, facts.revision, `#${facts.pull}`, facts.base, facts.head]) assert.ok(evidence.includes(value), `${value} is not in ${evidence}`);
  }
});

test('given a body never edited, the acceptance\'s revision in each judge\'s facts is null and its evidence says the body was never edited', () => {
  for (const { facts, evidence } of answer(card({ editedAt: read(null) })).judges) {
    assert.equal(facts.revision, null);
    assert.match(evidence, /never edited/);
  }
});
