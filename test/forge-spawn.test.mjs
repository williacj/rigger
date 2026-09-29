// ABOUTME: Tests the forge adapter's sides sending through L0's process adapter: a `gh` stand-in
// first on PATH that leaves a child alive or never exits, what each side answers, what L0 kills
// and records, the forge timeout, and the environment the `gh` child is given.

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
import { alive, fixture, holding, leave, OUTLIVED, read, TAIL, warmed } from './process-fixtures.mjs';

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
const neverExiting = (directory) => warmed(leavingChild(directory, ['echo $$ > "$here/gh.pid"', 'wait'].join('\n')));

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
