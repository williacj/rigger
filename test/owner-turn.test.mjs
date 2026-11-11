// ABOUTME: Proves owner-last routing and report counts through L2/L3 over one fake forge and stream,
// contrasting sound agent verdicts with a judge's critical verdict on the same fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loop } from '../src/scheduling/loop.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { report } from '../src/observation/report.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { handleOn } from './loop-world.mjs';
import { manualClock } from './clock-report-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { FIELDS, card, consumerConfig } from './verb-consumer.mjs';

const HEAD = '6'.repeat(40);
const RUN = 'r-owner-turn';
const OWNER_COLUMN = 'Owner verdict';

/** Public fake forge contracts provide the inputs; real workflow events provide report's input. */
async function ownerTurn(t, clock) {
  const settings = consumerConfig(1);
  settings.board = { ...settings.board, columns: { ...settings.board.columns, owner: OWNER_COLUMN } };
  settings.kinds = { change: { ...settings.kinds.change, judges: ['reviewer', 'architect', 'owner'] } };
  const cards = [card(31, 'Review'), card(32, 'Backlog')];
  const fake = createFakeBoard({ columns: Object.values(settings.board.columns), fields: FIELDS, items: cards });
  const repository = createFakeRepository({ repo: settings.repo, issues: fake.issues(), pullRequests: cards.map((item) => ({
    number: 1000 + item.number, head: `rigger-${item.number}`, sha: HEAD, mergeBase: '7'.repeat(40), diff: '',
    comments: ['reviewer', 'architect'].map((role) => markerComment({ card: item.number, pull: 1000 + item.number, head: HEAD,
      body: item.body, role, ...(item.number === 32 && role === 'reviewer' ? { verdict: 'critical', items: ['unmet'], toSound: 'Keep the user files.' } : {}) })),
  })) });
  const directory = temporaryDirectory('rigger-owner-turn-', { context: t });
  const sink = openSink({ directory, run: RUN, now: clock.now });
  const reads = repository.operations;
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads, repositoryWrites: repository });
  const decide = (item, outcomes, options = {}) => nextAction(item, settings.kinds, settings.epicLabel,
    { roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
  const unexpected = async () => { throw new Error('a completed panel or critical verdict needs no execution directory'); };
  const engine = loop({ config: settings, board: handleOn(fake, { columns: settings.board.columns, priority: settings.board.priority }),
    facts: factsCall({ config: settings, reads, decide }), decide, l2, sink, clock, state: directory, run: RUN, kill: async () => {},
    workspace: unexpected, judgeDirectory: unexpected, removeDirectories: unexpected, environment: {},
  });
  await engine.pull(1);
  const beforeCritical = report(directory).l2.runs.find(({ run }) => run === RUN).escalations;
  const ownerColumn = (await fake.operations.readItems()).find(({ number }) => number === 31).column;
  // The fixture, acting as the board's owner, makes the critical control eligible after the ordinary turn.
  await fake.operations.moveItem('item-2', 'Review');
  await engine.pull(1);
  return { ownerColumn, beforeCritical, afterCritical: report(directory).l2.runs.find(({ run }) => run === RUN).escalations,
    events: readEvents(directory) };
}

// proves R-ESCALATE-5
test('owner-turn: E1 sound agent judges at the head send the card to the configured owner column', async (t) => {
  const ran = await ownerTurn(t, manualClock());
  assert.deepEqual([...new Set(ran.events.filter((event) => event.card === 31 && event.event === 'marker.read' && event.head === HEAD && event.verdict === 'sound').map(({ role }) => role))].sort(), ['architect', 'reviewer']);
  assert.equal(ran.ownerColumn, OWNER_COLUMN);
});

// proves R-ESCALATE-5
test('owner-turn: E2 the ordinary owner turn records no review escalation for the card', async (t) => {
  const ran = await ownerTurn(t, manualClock());
  assert.ok(ran.events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === 31), 'the ordinary card was actually claimed');
  assert.deepEqual(ran.events.filter((event) => event.event === 'review.escalate' && event.card === 31), []);
});

// proves R-ESCALATE-5
test('owner-turn: E3 report excludes the ordinary owner turn from its run escalation count', async (t) => {
  const ran = await ownerTurn(t, manualClock());
  assert.deepEqual(ran.beforeCritical, { escalated: 0, pulled: 1, entries: [] });
  assert.equal(ran.afterCritical.escalated, 1);
  assert.deepEqual(ran.afterCritical.entries.map(({ card }) => card), [32]);
});

// proves R-ESCALATE-5
test('owner-turn: E4 report includes a critical judge verdict beside the ordinary owner turn', async (t) => {
  const ran = await ownerTurn(t, manualClock());
  assert.deepEqual(ran.events.filter((event) => event.event === 'review.escalate').map(({ card, category, raiser }) => ({ card, category, raiser })),
    [{ card: 32, category: 'critical', raiser: 'loop' }]);
  assert.equal(ran.beforeCritical.escalated, 0);
  assert.equal(ran.afterCritical.escalated, 1);
  assert.equal(ran.afterCritical.pulled, 2);
  assert.deepEqual(ran.afterCritical.entries.map(({ card, category }) => ({ card, category })), [{ card: 32, category: 'critical' }]);
});
