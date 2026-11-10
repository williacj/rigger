// ABOUTME: Tests L2's merge decision event at the real lane boundary over the fake forge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock } from './clock-report-world.mjs';
import { handleOn } from './loop-world.mjs';

const BODY = '## Acceptance\n\n- The verb prints its help.\n';
const HEAD = 'a'.repeat(40);
// shasum -a 256 over the single acceptance item followed by LF, independently of marker helpers.
const DIGEST = 'e8328625667a5f466d3cae9f480e1f4b22b17b98d8d0736d99ad445226be38e5';
const AGENTS = ['reviewer', 'architect'];

/** Uses fake forge read/write contracts and the real L2, sink and lane; no agent is dispatched. */
function world(t, { owner = false, refuseDecision } = {}) {
  const clock = manualClock();
  const directory = temporaryDirectory('rigger-merge-decided-', { context: t });
  const judges = owner ? [...AGENTS, 'owner'] : AGENTS;
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges } };
  const settings = { ...config, kinds };
  const fake = createFakeBoard({ columns: Object.values(settings.board.columns), items: [{
    type: 'issue', repository: settings.repo, number: 12, title: 'Add a verb', body: BODY,
    labels: ['type:change'], column: settings.board.columns[owner ? 'owner' : 'review'],
  }] });
  const repository = createFakeRepository({ repo: settings.repo, pullRequests: [{
    number: 70, head: 'rigger-12', sha: HEAD, mergeBase: 'b'.repeat(40), mergeable: 'mergeable',
    comments: judges.map((role) => markerComment({ card: 12, pull: 70, head: HEAD, body: BODY, role })),
  }] });
  const actual = openSink({ directory, run: 'r-merge', now: clock.now });
  t.after(() => actual.end());
  const sink = { ...actual, emitter: (context) => {
    const emitter = actual.emitter(context);
    return { emit: (event, fields) => {
      if (context.layer === 'L2' && event === 'merge.decided' && refuseDecision) throw refuseDecision;
      return emitter.emit(event, fields);
    } };
  } };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: repository.operations, repositoryWrites: repository });
  const decide = (card, outcomes, options) => nextAction(card, kinds, settings.epicLabel, {
    roles: settings.roles, columns: settings.board.columns, provisioning: {}, outcomes, sink, ...options,
  });
  const events = () => existsSync(streamPath(directory)) ? readEvents(directory) : [];
  const run = () => loop({ config: settings, sink, board: { ...handleOn(fake), readItems: fake.operations.readItems },
    l2, decide, facts: factsCall({ config: settings, reads: repository.operations, decide }),
    kill: async () => {}, workspace: async () => assert.fail('no maker starts'),
    judgeDirectory: async () => assert.fail('the sound panel starts no judge'), removeDirectories: async () => {},
    state: directory, environment: {}, run: 'r-merge', clock: { ...clock, pause: async (delay) => clock.advance(clock.now() + delay) },
  }).pull();
  return { repository, fake, events, run };
}

// Missing, post-call or incomplete decisions cannot establish fresh-verdict proof for the merge.
test('an admitted lane merge records its required governing verdicts and digest before the forge call', async (t) => {
  const here = world(t);
  let before;
  here.repository.answerMerge(({ merge }) => { before = here.events(); return merge(); });
  await here.run();
  assert.deepEqual(here.repository.merges(), [{ number: 70, head: HEAD }]);
  const decisions = before.filter(({ event }) => event === 'merge.decided');
  assert.equal(decisions.length, 1, 'exactly one merge decision must precede the forge call');
  const { ts, run, dispatch, ...decision } = decisions[0];
  assert.deepEqual(decision, { layer: 'L2', card: 12, event: 'merge.decided', pull: 70, head: HEAD, digest: DIGEST,
    judges: [{ role: 'reviewer', verdict: 'sound' }, { role: 'architect', verdict: 'sound' }] });
  assert.equal(here.events().filter(({ event }) => event === 'merge.decided').length, 1);
});

// An owner-last panel must be recorded in full, rather than narrowed to the agent judges.
test('an owner-admitted lane merge includes the governing owner verdict', async (t) => {
  const here = world(t, { owner: true });
  let before;
  here.repository.answerMerge(({ merge }) => { before = here.events(); return merge(); });
  await here.run();
  const decisions = before.filter(({ event }) => event === 'merge.decided');
  assert.equal(decisions.length, 1, 'the owner merge must have its decision before the call');
  assert.deepEqual(decisions[0].judges, [{ role: 'reviewer', verdict: 'sound' },
    { role: 'architect', verdict: 'sound' }, { role: 'owner', verdict: 'sound' }]);
});

/** A caller's refusal retains the original sink error, possibly within lane/loop aggregates. */
const carries = (failure, original) => failure === original || (failure?.cause && carries(failure.cause, original))
  || (failure?.errors ?? []).some((error) => carries(error, original));

// Continuing after a refused decision would produce a merge with no recoverable proof.
test('a refused merge decision makes no forge call and reaches the lane caller', async (t) => {
  const refusal = new Error('EIO: merge.decided append refused');
  const here = world(t, { refuseDecision: refusal });
  let failure;
  try { await here.run(); } catch (error) { failure = error; }
  assert.ok(failure, 'the caller must receive the refused decision');
  assert.equal(Boolean(carries(failure, refusal)), true, 'the caller must retain the sink refusal');
  assert.deepEqual(here.repository.merges(), []);
  assert.equal((await here.fake.operations.readItems())[0].column, config.board.columns.review);
});

// Reusing the first decision for a second merge call hides which re-read admitted that call.
test('unknown mergeability followed by success records one decision before each forge call', async (t) => {
  const here = world(t);
  const before = [];
  here.repository.answerMerge(() => { before.push(here.events().filter(({ event }) => event === 'merge.decided'));
    return { outcome: 'refused', reason: 'unknown' }; });
  here.repository.answerMerge(({ merge }) => { before.push(here.events().filter(({ event }) => event === 'merge.decided')); return merge(); });
  await here.run();
  assert.equal(here.repository.merges().length, 2, 'the lane must retry its unknown-mergeability call');
  assert.deepEqual(before.map((events) => events.length), [1, 2], 'each call needs its own prior decision');
  assert.equal(here.events().filter(({ event }) => event === 'merge.decided').length, 2);
  assert.equal(here.events().find(({ event }) => event === 'merge.end').outcome, 'merged');
});
