// ABOUTME: Tests that L3's single pull reports every claimed card's outcome: where one card fails
// before the maker, the cards whose workspaces were made are still named, each with its maker's outcome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { COLUMNS, KINDS, boardOf, cardIn, handleOn, makingWorkspaces } from './loop-world.mjs';
import { factsOverNothing, oneOpenFromEveryLine } from './loop-world.mjs';
import { scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';

/** The stand-in agent every maker in this file runs as, first on the PATH the loop is handed. */
const agent = standInAgent();

// A bound on a test that waits on real commands, so one whose pull never settles fails here
// rather than holding the suite.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** A step `ready` that exits 0, and a step `fails` that exits 3, selected only for a card carrying `area:fails`. */
const PROVISIONING = {
  ready: { run: 'true', required: true },
  fails: { run: 'exit 3', required: true, select: { labels: ['area:fails'] } },
};

/**
 * A pull over ready cards #10, #20 and #30 at N 3, through L3's real loop, L2's real next action
 * and column changes, and L1's real dispatch, with no maker injected: each maker runs through L1 as
 * this file's stand-in agent, exiting 0, and the forge holds no pull request. #20 alone carries
 * `area:fails`, so its required step exits non-zero on both attempts, while #10's and #30's
 * workspaces, made under `workspaces` in a scratch directory, pass their one step. Answers the
 * pull's failure, the board, the workspace directory and the recorded events.
 */
async function threeCards(t) {
  const directory = scratch(t);
  const state = join(directory, 'state');
  mkdirSync(state);
  const sink = openSink({ directory: state, run: 'r-outcomes', now: Date.now });
  const failing = { ...cardIn(20, COLUMNS.ready), labels: ['type:change', 'area:fails'] };
  const fake = boardOf([30, 10, failing]);
  const kinds = { change: { ...KINDS.change, provisioning: ['ready', 'fails'] } };
  const decide = (card, outcomes, attempt) => nextAction(card, kinds, undefined, { columns: COLUMNS, roles: config.roles, provisioning: PROVISIONING, outcomes, sink, ...attempt });
  const l2 = columnChanges({ config: { ...config, concurrency: 3 }, sink, items: fake.operations, pullRequests: async () => ({ open: [], merged: [] }) });
  const workspaces = join(directory, 'workspaces');
  const built = loop({
    config: { ...config, concurrency: 3 }, board: handleOn(fake), decide, facts: factsOverNothing({ ...config, concurrency: 3 }, decide), l2, sink, kill: async () => {}, workspace: makingWorkspaces(workspaces), state,
    environment: { ...process.env, PATH: agent.first() },
  });
  const failure = await built.pull().then(() => assert.fail('the pull settled, though #20 failed'), (thrown) => thrown);
  return { failure, fake, workspaces, events: () => readEvents(state) };
}

test('given a pull claiming #10, #20 and #30, where #20\'s required step exits non-zero on both attempts, what the pull reports names #10 with its workspace\'s path and its maker\'s outcome', SETTLES_WITHIN, async (t) => {
  const { failure, workspaces } = await threeCards(t);

  assert.ok(failure.reached?.some((each) => each.card === 10 && each.workspace === join(workspaces, 'rigger-10') && each.outcome.value?.exit === 0), JSON.stringify(failure.reached));
});

test('in that pull, what the pull reports names #30 with its workspace\'s path and its maker\'s outcome', SETTLES_WITHIN, async (t) => {
  const { failure, workspaces } = await threeCards(t);

  assert.ok(failure.reached?.some((each) => each.card === 30 && each.workspace === join(workspaces, 'rigger-30') && each.outcome.value?.exit === 0), JSON.stringify(failure.reached));
});

/** Every failure `failure` holds, an AggregateError opened to the failures inside it, however deep. */
const leavesOf = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leavesOf) : [failure]);

test('in that pull, what the pull reports carries #20\'s failure, with both attempts\' failures as L2 recorded them', SETTLES_WITHIN, async (t) => {
  const { failure, events } = await threeCards(t);

  const stopped = leavesOf(failure).filter((each) => /^card #20 was stopped after 2 attempts/.test(each.message));
  assert.equal(stopped.length, 1, leavesOf(failure).map((each) => each.message).join('\n'));
  const lines = stopped[0].message.split('\n');
  const recorded = events().filter((event) => event.layer === 'L2' && event.event === 'attempt.failed' && event.card === 20);
  assert.deepEqual(recorded.map((event) => event.attempt), [1, 2], JSON.stringify(recorded));
  for (const event of recorded) {
    const line = lines.find((each) => each.startsWith(`attempt ${event.attempt}: `));
    assert.ok(line, stopped[0].message);
    const reported = JSON.parse(line.slice(`attempt ${event.attempt}: `.length));
    assert.equal(reported.step, 'fails', line);
    assert.equal(reported.exit, 3, line);
    for (const [key, value] of Object.entries(reported)) assert.deepEqual(event[key], value, `${key} in ${line} against ${JSON.stringify(event)}`);
  }
});
