// ABOUTME: Tests the forge adapter's sides sending through L0's process adapter: a `gh` stand-in
// first on PATH that leaves a child alive or never exits, what each side answers, what L0 kills
// and records, the forge timeout, and the environment the `gh` child is given.

import { seedRepository } from './fake-gh.mjs';
import { assertCommandContext, commandKills, leavingRecordedChild } from './event-context-world.mjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { openSink, readEvents } from '../src/observation/sink.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { FORGE_TIMEOUT, readRunner } from '../src/substrate/forge/runners.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { alive, fixture, holding, leave, OUTLIVED, read, TAIL } from './process-fixtures.mjs';

/** The board every read here names; the stand-in answers whatever it is asked. */
const BOARD = { repo: 'acme/widgets', project: 3, columns: { ready: 'Ready' } };

/** What `gh` prints for one page of a repository's labels holding only `bug`. */
const LABELS = JSON.stringify({ data: { repository: { labels: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: 'bug' }] } } } });

/**
 * A `gh` stand-in in `directory` that starts a `tail` it leaves alive, writing that child's pid to
 * `child-<its own pid>.pid`, then runs `rest`.
 */
const leavingChild = (directory, rest) => fixture(directory, 'gh', [leave(TAIL, 'child-$$'), rest].join('\n'));

/** The pid of every child a stand-in in `directory` left, one per call it answered. */
const childrenIn = (directory) => readdirSync(directory).filter((name) => /^child-\d+\.pid$/.test(name)).map((name) => Number(read(directory, name)));

/** Runs `act` with `directory` first on PATH, ahead of the refusing `gh` `npm test` puts there. */
async function onPath(directory, act) {
  const held = process.env.PATH;
  process.env.PATH = `${directory}${delimiter}${held}`;
  try {
    return await act();
  } finally {
    process.env.PATH = held;
  }
}

/** A sink recording into `directory`'s `state`, and the events it recorded there so far. */
function sinkIn(directory) {
  const state = join(directory, 'state');
  const sink = openSink({ directory: state, run: 'r-forge', now: Date.now });
  return { sink, events: () => (existsSync(state) ? readEvents(state) : []) };
}

test('given a gh stand-in that leaves a child alive and exits 0 with an answer, a read through the read side returns that answer, and the child is dead once it settles', async (t) => {
  const directory = holding(t);
  leavingChild(directory, `printf '%s\\n' '${LABELS}'`);
  const { sink } = sinkIn(directory);

  const labels = await onPath(directory, () => readSide(BOARD, { emitter: sink.emitter({ layer: 'L0' }) }).readLabels());

  assert.deepEqual(labels, ['bug']);
  const children = childrenIn(directory);
  assert.equal(children.length, 1, 'the stand-in was not run once');
  assert.deepEqual(children.filter(alive), [], 'a child the stand-in left is still alive');
});

test('given a gh stand-in that leaves a child alive, the event stream holds an L0 kill event naming that child\'s process name and command line', async (t) => {
  const directory = holding(t);
  leavingChild(directory, `printf '%s\\n' '${LABELS}'`);
  const { sink, events } = sinkIn(directory);

  await onPath(directory, () => readSide(BOARD, { emitter: sink.emitter({ layer: 'L0' }) }).readLabels());

  const [child] = childrenIn(directory);
  const kills = events().filter((event) => event.layer === 'L0' && event.pid === child);
  assert.equal(kills.length, 1, JSON.stringify(events()));
  assert.equal(kills[0].event, 'survivor.killed');
  assert.equal(kills[0].name, 'tail');
  assert.equal(kills[0].cmd, `/usr/bin/tail -f ${directory}/hold`);
});

/** What `gh` prints for the repository-ID read, and for a label created, in the shapes the schema-write side reads. */
const REPOSITORY = JSON.stringify({ data: { repository: { id: 'R_1' } } });
const CREATED = JSON.stringify({ data: { createLabel: { label: { id: 'LA_1' } } } });

test('given a gh stand-in that leaves a child alive, a schema write through the schema-write side settles with the child dead', async (t) => {
  const directory = holding(t);
  leavingChild(directory, `case "$*" in *createLabel*) printf '%s\\n' '${CREATED}' ;; *) printf '%s\\n' '${REPOSITORY}' ;; esac`);
  const { sink } = sinkIn(directory);

  await onPath(directory, () => schemaWriteSide(BOARD, { emitter: sink.emitter({ layer: 'L0' }) }).createLabel('type:change'));

  const children = childrenIn(directory);
  assert.equal(children.length, 2, 'the stand-in was not run for the read and the write');
  assert.deepEqual(children.filter(alive), [], 'a child the stand-in left is still alive');
});

/** The consumer's config for L2's column changes: the board's repository, number and column names. */
const CONFIG = { repo: BOARD.repo, board: { project: BOARD.project, columns: { ready: 'Ready', coding: 'Coding', review: 'Review' } } };

/**
 * A `gh` stand-in in `directory` answering as the fake `gh` does for a board holding `items`, whose
 * every call then leaves a child alive, and the fake `gh` it answers through.
 */
function fakeLeavingChild(directory, items) {
  const fakeDirectory = join(directory, 'fake');
  mkdirSync(fakeDirectory);
  const fake = installFakeGh(fakeDirectory, { repo: BOARD.repo, project: BOARD.project, board: { columns: ['Ready', 'Coding', 'Review'], items } });
  leavingChild(directory, '"$here/fake/gh" "$@"');
  return fake;
}

/** A ready card on the fake board: an issue in its repository, which the board names `item-1`. */
const READY = { type: 'issue', repository: BOARD.repo, number: 12, title: 'Card 12', body: '', labels: [], column: 'Ready' };

test('given a gh stand-in that leaves a child alive, a column move through L2\'s column changes settles with the child dead', async (t) => {
  const directory = holding(t);
  const fake = fakeLeavingChild(directory, [READY]);
  const { sink } = sinkIn(directory);

  await onPath(directory, () => columnChanges({ config: CONFIG, sink }).claimed({ id: 'item-1', number: 12 }));

  assert.deepEqual((await fake.model()).writes().map(({ operation, args }) => [operation, ...args]), [['moveItem', 'item-1', 'Coding']]);
  const children = childrenIn(directory);
  assert.ok(children.length > 0, 'the stand-in was never run');
  assert.deepEqual(children.filter(alive), [], 'a child the stand-in left is still alive');
});

test('given a column move whose gh stand-in leaves a child alive, the L0 kill event carries the moved card\'s number', async (t) => {
  const directory = holding(t);
  fakeLeavingChild(directory, [READY]);
  const { sink, events } = sinkIn(directory);

  await onPath(directory, () => columnChanges({ config: CONFIG, sink }).claimed({ id: 'item-1', number: 12 }));

  const kills = events().filter((event) => event.layer === 'L0');
  assert.ok(kills.length > 0, JSON.stringify(events()));
  assert.deepEqual(kills.filter((event) => event.card !== 12), [], JSON.stringify(kills));
});

/** Whether any process is left in the group `group`: signal 0 reaches a group while it has one. */
function groupAlive(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * A `gh` stand-in in `directory` that never exits: it leaves a child alive, writes its own pid,
 * which is its group's id, to `gh.pid`, and waits on the child, which runs until killed. It is
 * `warmed`, because it must be ready within `OUTLIVED` of its spawn.
 */
const neverExiting = (directory) => leavingChild(directory, ['echo $$ > "$here/gh.pid"', 'wait'].join('\n'));

test('given a gh stand-in that never exits, a read through the read side settles, reports that the timeout ended it, and leaves no process of its group alive', async (t) => {
  const directory = holding(t);
  neverExiting(directory);
  const { sink } = sinkIn(directory);

  await assert.rejects(
    onPath(directory, () => readSide(BOARD, { emitter: sink.emitter({ layer: 'L0' }), timeout: OUTLIVED }).readLabels()),
    new RegExp(`^Error: readLabels on board 3 failed: gh ran past its timeout of ${OUTLIVED} ms, and L0 ended it$`),
  );

  assert.ok(existsSync(join(directory, 'gh.pid')), `the timeout of ${OUTLIVED} ms ended the stand-in before it was ready`);
  assert.equal(groupAlive(Number(read(directory, 'gh.pid'))), false, 'a process of the stand-in\'s group is alive');
});

test('given a gh stand-in that never exits, the stream holds an L0 kill event for each process the timeout ended', async (t) => {
  const directory = holding(t);
  neverExiting(directory);
  const { sink, events } = sinkIn(directory);

  await assert.rejects(onPath(directory, () => readSide(BOARD, { emitter: sink.emitter({ layer: 'L0' }), timeout: OUTLIVED }).readLabels()));

  assert.ok(existsSync(join(directory, 'gh.pid')), `the timeout of ${OUTLIVED} ms ended the stand-in before it was ready`);
  const ended = [Number(read(directory, 'gh.pid')), ...childrenIn(directory)].sort();
  const killed = events().filter((event) => event.layer === 'L0' && event.event === 'timeout.killed').map((event) => event.pid).sort();
  assert.deepEqual(killed, ended, JSON.stringify(events()));
});

test('every forge call passes L0\'s forge timeout, unless its caller passes another value', async () => {
  // Each side's request and each runner's own read, as a caller with no timeout makes them and as
  // one passing 7 ms makes them. The defect this catches is a runner or side that drops the value
  // its caller passed, or passes none, which the adapter refuses.
  const calls = (timeout) => {
    const handed = [];
    const send = (command, args, { timeout: given }) => {
      handed.push(given);
      const document = args[3] ?? '';
      if (document.includes('repository(')) return { status: 0, stdout: REPOSITORY, stderr: '' };
      return { status: 0, stdout: CREATED, stderr: '' };
    };
    return { handed, run: () => schemaWriteSide(BOARD, { send, timeout }).createLabel('type:change') };
  };
  const unset = calls(undefined);
  const given = calls(7);

  await unset.run();
  await given.run();

  assert.deepEqual(unset.handed, [FORGE_TIMEOUT, FORGE_TIMEOUT]);
  assert.deepEqual(given.handed, [7, 7]);
  const reads = [];
  await readRunner(['auth', 'status'], { send: (command, args, { timeout }) => reads.push(timeout) });
  assert.deepEqual(reads, [FORGE_TIMEOUT]);
});

test('a gh child the read runner starts, from an engine whose environment sets GIT_DIR, does not have GIT_DIR in its environment', async (t) => {
  const directory = holding(t);
  fixture(directory, 'gh', '/usr/bin/env > "$here/environment"');
  const held = process.env.GIT_DIR;
  process.env.GIT_DIR = join(directory, 'elsewhere.git');
  try {
    await onPath(directory, () => readRunner(['auth', 'status'], { emitter: sinkIn(directory).sink.emitter({ layer: 'L0' }) }));
  } finally {
    if (held === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = held;
  }

  const environment = read(directory, 'environment').split('\n');
  assert.ok(environment.some((line) => line.startsWith('PATH=')), 'the stand-in wrote no environment, so this proves nothing');
  assert.deepEqual(environment.filter((line) => line.startsWith('GIT_DIR=')), []);
});


const MAKER_DISPATCH = 'd-11111111-2222-3333-4444-555555555555';
const MAKER_BODY = '## Acceptance\n\n- The widget turns blue when pressed.\n';
const MAKER_HEAD = 'b'.repeat(40);

/** Production forge sides over the established fake-gh protocol, with one recorded child per call. */
function makerForge(t, { comments = [], pulls = [{ number: 77, head: 'rigger-12', sha: MAKER_HEAD,
  mergeBase: 'a'.repeat(40), diff: 'diff --git a/widget b/widget\n', mergeable: 'mergeable',
  comments: [{ body: 'A human note.', createdAt: '2026-10-01T10:00:00Z' }] }] } = {}) {
  const directory = holding(t);
  const fake = fakeLeavingChild(directory, [{ ...READY, body: MAKER_BODY, column: 'Coding' }]);
  seedRepository(fake, { issues: [{ number: 12, body: MAKER_BODY, comments }], pullRequests: pulls });
  leavingRecordedChild(directory, 'gh', '"$here/fake/gh" "$@"');
  const { sink, events } = sinkIn(directory);
  const l2 = columnChanges({ config: CONFIG, sink });
  const card = { ...READY, body: MAKER_BODY, column: 'Coding', id: 'item-1' };
  return { directory, fake, sink, events, card, l2,
    run: (work) => onPath(directory, work),
    rows: () => commandKills(directory, events(), 'gh') };
}

// Every read is forced to emit, including the second requests inside compound repository reads.
// proves R-RECORD-7
test('maker settle production reads and board move events name their card and dispatch', { timeout: 20000 }, async (t) => {
  const here = makerForge(t);
  const facts = await here.run(() => here.l2.settled(here.card, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: MAKER_DISPATCH }));
  assert.equal(facts.open[0].number, 77);
  const rows = here.rows();
  const requests = [
    ['issue comments', (s) => s.includes('issue(number: 12)')],
    ['pull requests', (s) => s.includes('pullRequests(headRefName: "rigger-12"')],
    ['merge base head', (s) => s.includes('baseRefName headRefOid')],
    ['merge base compare', (s) => s.includes('/compare/main...')],
    ['diff', (s) => s.includes('Accept: application/vnd.github.diff')],
    ['PR comments', (s) => s.includes('pullRequest(number: 77) { comments')],
    ['comment permission', (s) => s.includes('/collaborators/')],
    ['mergeability', (s) => s.includes('{ mergeable }')],
    ['effective rules', (s) => s.includes('/rules/branches/main')],
    ['classic protection', (s) => s.includes('/branches/main/protection')],
    ['check runs', (s) => s.includes('/check-runs?')],
    ['commit statuses', (s) => s.includes('/statuses?')],
    ['board read', (s) => s.includes('repositoryOwner')],
    ['field read', (s) => s.includes('target: node')],
    ['item write', (s) => s.includes('updateProjectV2ItemFieldValue')],
  ];
  for (const [what, matches] of requests) assertCommandContext(rows, matches, 12, MAKER_DISPATCH, what);
  for (const { event } of rows) {
    assert.equal(event.card, 12);
    assert.equal(event.dispatch, MAKER_DISPATCH);
  }
  const transition = here.events().find((event) => event.event === 'transition');
  assert.equal(transition.cause, 'returned');
  assert.equal(transition.card, 12);
  assert.equal(transition.dispatch, MAKER_DISPATCH);
});

// A merge's preflight GET is part of the card's write, as is the actual merge request.
// proves R-RECORD-7
test('merge preflight and write survivor events name the card without a dispatch', { timeout: 20000 }, async (t) => {
  const here = makerForge(t);
  const result = await here.run(() => here.l2.merge(here.card, { pull: 77, head: MAKER_HEAD }));
  assert.equal(result.outcome, 'merged');
  const rows = here.rows();
  assertCommandContext(rows, (s) => s.includes('/pulls/77 -X GET'), 12, undefined, 'merge preflight');
  assertCommandContext(rows, (s) => s.includes('/pulls/77/merge -X PUT'), 12, undefined, 'merge write');
});

// A refused merge still reads one known card's mergeability, without a dispatch.
// proves R-RECORD-7
test('refused merge mergeability survivor events name the card without a dispatch', { timeout: 20000 }, async (t) => {
  const here = makerForge(t);
  await assert.doesNotReject(here.run(() => here.l2.mergeEnded(here.card, { pull: 77, head: MAKER_HEAD }, { outcome: 'refused', reason: 'pending' })));
  assertCommandContext(here.rows(), (s) => s.includes('{ mergeable }'), 12, undefined, 'refused merge mergeability');
  assert.deepEqual((await here.fake.model()).writes(), [], 'a refusal must leave the board unchanged');
});

// Both the PR-confirmation read and return POST must use the known card's writer.
// proves R-RECORD-7
test('return confirmation and comment survivor events name the card without a dispatch', { timeout: 20000 }, async (t) => {
  const here = makerForge(t);
  const comment = 'Return acceptance: newline\nquote " and $HOME stay literal.';
  await here.run(() => here.l2.returned(here.card, { pull: 77, comment }));
  const rows = here.rows();
  assertCommandContext(rows, (s) => s.includes('/pulls/77 -X GET'), 12, undefined, 'return confirmation');
  assertCommandContext(rows, (s) => s.includes('/issues/77/comments -X POST'), 12, undefined, 'return comment');
  const state = JSON.parse(readFileSync(join(here.directory, 'fake', 'board.json'), 'utf8'));
  assert.equal(state.repository.pullRequests[0].comments.at(-1).body, comment);
});


// The escalation-note path uses the same scoped reader before returning the escalation answer.
// proves R-RECORD-7
test('maker escalation-note settlement reads retain card and maker dispatch', { timeout: 20000 }, async (t) => {
  const body = ['```rigger-escalation', 'category: ambiguous', 'item: 1', 'reason: Choose the widget colour.',
    `dispatch: ${MAKER_DISPATCH}`, '```'].join('\n');
  const here = makerForge(t, { comments: [{ body, createdAt: '2026-10-01T10:00:00Z' }] });
  const answer = await here.run(() => here.l2.settled(here.card, { status: 'fulfilled', value: { exit: 7 } }, { dispatch: MAKER_DISPATCH }));
  assert.equal(answer.action, 'escalate');
  assert.equal(answer.dispatch, MAKER_DISPATCH);
  const rows = here.rows();
  assertCommandContext(rows, (s) => s.includes('issue(number: 12)'), 12, MAKER_DISPATCH, 'escalation comments');
  assertCommandContext(rows, (s) => s.includes('pullRequests(headRefName: "rigger-12"'), 12, MAKER_DISPATCH, 'escalation pull requests');
  assertCommandContext(rows, (s) => s.includes('/compare/'), 12, MAKER_DISPATCH, 'escalation merge base');
  for (const { event } of rows) {
    assert.equal(event.card, 12);
    assert.equal(event.dispatch, MAKER_DISPATCH);
  }
  assert.deepEqual((await here.fake.model()).writes(), []);
});

// Optional dispatch preserves absence throughout the successful settlement, including L0 and L2.
// proves R-RECORD-7
test('maker settlement without dispatch omits its key on reads move and transition', { timeout: 20000 }, async (t) => {
  const here = makerForge(t);
  const facts = await here.run(() => here.l2.settled(here.card, { status: 'fulfilled', value: { exit: 0 } }));
  assert.equal(facts.open[0].number, 77);
  const rows = here.rows();
  assertCommandContext(rows, () => true, 12, undefined, 'settlement without dispatch');
  const events = here.events();
  assert.ok(events.some((event) => event.event === 'transition'));
  for (const event of events) {
    assert.equal(event.card, 12);
    assert.equal(Object.hasOwn(event, 'dispatch'), false);
  }
});
