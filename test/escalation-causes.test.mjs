// ABOUTME: Tests the failure class recorded for each L2 escalation site over an in-memory forge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { failedAttempt, nextAction } from '../src/workflow/next-action.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock } from './clock-report-world.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { handleOn } from './loop-world.mjs';
import { report } from '../src/observation/report.mjs';

const BODY = '## Acceptance\n\n- The verb prints its help.\n';
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The fake board/repository supply their public contracts; only the real sink records events. */
async function world(t, { stage = 'coding', pullRequests = [], branches = [], comments = [] } = {}) {
  const clock = manualClock();
  const directory = temporaryDirectory('rigger-escalation-causes-', { context: t });
  const settings = { ...config, kinds: KINDS };
  const fake = createFakeBoard({ columns: Object.values(settings.board.columns), items: [{
    type: 'issue', repository: settings.repo, number: 12, title: 'Add a verb', body: BODY,
    labels: ['type:change'], column: settings.board.columns[stage],
  }] });
  const repository = createFakeRepository({ repo: settings.repo, branches, pullRequests, issues: [{ number: 12, body: BODY, comments }] });
  const sink = openSink({ directory, run: 'r-causes', now: clock.now });
  t.after(() => sink.end());
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: repository.operations, repositoryWrites: repository });
  return { clock, directory, settings, fake, repository, sink, l2, card: (await fake.operations.readItems())[0],
    events: () => existsSync(streamPath(directory)) ? readEvents(directory) : [] };
}

/** Exactly one escalation at the sink boundary, shared by the site assertions. */
function recordedEscalation(here) {
  const entries = here.events().filter(({ event }) => event === 'review.escalate');
  assert.equal(entries.length, 1);
  return entries[0];
}

// The counterexample records the last attempt's environment class for a mixed refusal pair.
test('S1: single refusals and mixed attempt pairs record card-local escalation events', async (t) => {
  // failedAttempt consumes L1's documented workspace report, not a parsed error message.
  const local = { class: 'card-local', code: 'WORKSPACE_REFUSED', workspace: '/refused/workspace', reason: 'owner files remain here' };
  const host = { class: 'environment', workspace: '/refused/workspace', reason: 'workspace read failed' };
  for (const [name, attempt, first, last] of [
    ['single refusal', 1, undefined, local],
    ['host then refusal', 2, host, local],
    ['refusal then host', 2, local, host],
  ]) {
    const here = await world(t);
    const { class: ignored, ...report } = last;
    const answer = failedAttempt(here.card, attempt, first, report, here.sink);
    assert.equal(answer.action, 'escalate');
    await here.l2.escalated(here.card, answer);
    assert.equal(recordedEscalation(here).class, 'card-local', name);
  }
});

// Omitting either directory refusal's class makes infrastructure failures look like decisions.
test('S2: judge workspace and scratch refusals record card-local escalations', async (t) => {
  for (const code of ['WORKSPACE_REFUSED', 'SCRATCH_REFUSED']) {
    const here = await world(t, { stage: 'review', pullRequests: [{
      number: 70, head: 'rigger-12', sha: 'a'.repeat(40), mergeBase: 'b'.repeat(40),
    }] });
    const read = await factsCall({ config: here.settings, reads: here.repository.operations, decide: (card) => card })([here.card]);
    const answer = judgeAnswer(read(here.card), KINDS, here.settings.epicLabel, {
      roles: here.settings.roles, sink: here.sink,
      directories: { reviewer: { status: 'rejected', reason: Object.assign(new Error(code), { code }) } },
    });
    assert.equal(answer.action, 'escalate', code);
    await here.l2.escalated(here.card, answer);
    assert.equal(recordedEscalation(here).class, 'card-local', code);
  }
});

// A closed pull still held by the forge must be classed after its guarded directory removal.
test('S3: forge refusal on the closed-work removal path records a card-local escalation', async (t) => {
  const here = await world(t, { stage: 'review', branches: ['rigger-12'], pullRequests: [{
    number: 70, head: 'rigger-12', sha: 'a'.repeat(40), closed: true,
  }] });
  const removed = [];
  const decide = (card, outcomes, options) => nextAction(card, KINDS, here.settings.epicLabel, {
    columns: here.settings.board.columns, roles: here.settings.roles, provisioning: {}, sink: here.sink, outcomes, ...options,
  });
  const facts = factsCall({ config: here.settings, reads: here.repository.operations, decide });
  assert.equal((await facts([here.card]))(here.card).action, 'remove', 'the fixture must reach the removal path');
  await loop({ config: here.settings, board: { ...handleOn(here.fake), readItems: here.fake.operations.readItems },
    decide, facts, l2: here.l2, sink: here.sink, kill: async () => {},
    workspace: async () => assert.fail('no maker starts'), judgeDirectory: async () => assert.fail('no judge starts'),
    removeDirectories: async (card) => { removed.push(card); }, state: here.directory, environment: {}, run: 'r-causes',
    clock: { ...here.clock, pause: async (delay) => here.clock.advance(here.clock.now() + delay) },
  }).pull();
  assert.deepEqual(removed, [12], 'cleanup must precede the following escalation');
  assert.equal(here.events().filter(({ event }) => event === 'dispatch').length, 0);
  const recorded = recordedEscalation(here);
  assert.match(recorded.reason, /forge holds its line of work/);
  assert.equal(recorded.class, 'card-local');
});

// The second non-start belongs to the environment, even when the two start causes differ.
test('S4: the escalation role second non-start records an environment escalation', async (t) => {
  const here = await world(t);
  const next = { action: 'escalate', category: 'ambiguous', raiser: 'maker', destination: 'pm', line: 'rigger-12', reason: 'a decision is needed' };
  const failure = (reason) => ({ status: 'rejected', reason: Object.assign(new Error(reason), { code: 'NOT_STARTED' }) });
  const first = failure('provider unavailable');
  assert.deepEqual(await here.l2.roleSettled(here.card, next, first), { action: 'again' });
  assert.deepEqual(here.events(), [], 'the first failure must not escalate');
  const answer = await here.l2.roleSettled(here.card, next, failure('launch refused'), { firstFailure: first });
  await here.l2.escalated(here.card, answer);
  assert.equal(recordedEscalation(here).class, 'environment');
});

// Both refusal codes must retain the card-local class on the escalation role's owner path.
test('S5: escalation-role workspace and scratch refusals record card-local escalations', async (t) => {
  for (const code of ['WORKSPACE_REFUSED', 'SCRATCH_REFUSED']) {
    const here = await world(t);
    const next = { action: 'escalate', category: 'ambiguous', raiser: 'maker', destination: 'pm', line: 'rigger-12', reason: 'a decision is needed' };
    const answer = await here.l2.roleSettled(here.card, next, {
      status: 'rejected', reason: Object.assign(new Error(code), { code }),
    });
    await here.l2.escalated(here.card, answer);
    assert.equal(recordedEscalation(here).class, 'card-local', code);
  }
});

// Human decisions must not acquire a class from their reason or inflate infrastructure counts.
test('S6: critical verdicts and maker notes remain unclassified in events and cause reports', async (t) => {
  const dispatch = 'd-11111111-2222-3333-4444-555555555555';
  const reason = 'Decide whether environment or card-local is the right wording.';
  for (const site of ['critical verdict', 'maker note']) {
    const critical = site === 'critical verdict';
    const here = await world(t, critical ? { stage: 'review', pullRequests: [{
      number: 70, head: 'rigger-12', sha: 'a'.repeat(40), mergeBase: 'b'.repeat(40),
      comments: [markerComment({ card: 12, pull: 70, head: 'a'.repeat(40), body: BODY,
        verdict: 'critical', items: ['unmet'], toSound: reason })],
    }] } : { comments: [{ body: ['```rigger-escalation', 'category: ambiguous', 'item: 1',
      `reason: ${reason}`, `dispatch: ${dispatch}`, '```'].join('\n') }] });
    const answer = critical
      ? (await factsCall({ config: here.settings, reads: here.repository.operations,
        decide: (card) => nextAction(card, KINDS, here.settings.epicLabel, { roles: here.settings.roles, sink: here.sink }),
      })([here.card]))(here.card)
      : await here.l2.settled(here.card, { status: 'fulfilled', value: { exit: 4 } }, { dispatch });
    assert.equal(answer.action, 'escalate', site);
    assert.equal(answer.raiser, critical ? 'loop' : 'maker', site);
    await here.l2.escalated(here.card, answer);
    assert.equal(Object.hasOwn(recordedEscalation(here), 'class'), false, site);
    const causes = report(here.directory).l2.escalationCauses;
    assert.ok(causes, 'report must expose cause counts for unclassified decision escalations');
    assert.deepEqual(causes.stream, { classes: [{ class: null, count: 1 }], infrastructure: 0 }, site);
  }
});
