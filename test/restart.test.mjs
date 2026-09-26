// ABOUTME: Tests a restart over the fake board: a fresh engine, holding nothing from the run
// before it, reads the board on its first tick as on every tick, redoes each unclaimed Coding or
// Review card no fresh verdict covers ahead of any Ready card, and keeps no card state of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import {
  COLUMNS, cardIn, columnsOf, drive, quiesce, stoppedRun, world,
} from './loop-world.mjs';
import { readEvents } from '../src/observation/sink.mjs';

/** A new empty temporary directory, named for what it stands in for. */
const scratch = (name) => mkdtempSync(join(tmpdir(), `rigger-restart-${name}-`));

/** Fires one pull on `built`'s loop, releases whatever it dispatched, and waits for it to settle. */
async function pullOnce(built) {
  const tick = built.loop.pull();
  await quiesce();
  built.dispatches.releaseAll();
  await tick;
}

/** A board holding card 1 unclaimed in the coding column and card 2 unclaimed in the review column. */
const redoBoard = () => boardWith([cardIn(1, COLUMNS.coding), cardIn(2, COLUMNS.review)]);

/** The fake board holding `items` in this repository's columns. */
const boardWith = (items) => createFakeBoard({ columns: Object.values(COLUMNS), items });

// proves R-STATE-2
test('given an unclaimed Coding card and an unclaimed Review card, with freshness injected as "not fresh", a fresh engine dispatches both again', async () => {
  const restarted = world({ fake: redoBoard(), concurrency: 2, fresh: () => false });

  await pullOnce(restarted);

  assert.deepEqual([...restarted.dispatches.started].sort(), [1, 2]);
});

test('given an unclaimed Coding card and an unclaimed Review card, with freshness injected as "fresh", a fresh engine dispatches neither, and neither card\'s column changes', async () => {
  const fake = redoBoard();
  const restarted = world({ fake, concurrency: 2, fresh: () => true });

  await pullOnce(restarted);

  assert.deepEqual(restarted.dispatches.started, []);
  assert.deepEqual(await columnsOf(fake), { 1: COLUMNS.coding, 2: COLUMNS.review });
  assert.deepEqual(fake.writes(), []);
});

// proves R-STATE-2
test("given a run stopped while card X's dispatch is unfinished, a second engine with nothing carried from the first dispatches X again, handed only what the board holds for X", async () => {
  const fake = await stoppedRun();
  const restarted = world({ fake, concurrency: 2 });

  const run = restarted.loop.run();
  await quiesce();
  const [held] = (await fake.operations.readPriority()).items.filter((item) => item.number === 1);
  assert.equal(held.column, COLUMNS.coding, 'X was left in the coding column by the stopped run');
  const handedX = restarted.handed.filter((start) => start.card.number === 1);
  assert.equal(handedX.length, 1, JSON.stringify(restarted.handed));
  assert.deepEqual(Object.keys(handedX[0]).sort(), ['card', 'kind']);
  assert.deepEqual(handedX[0].card, held);
  restarted.dispatches.releaseAll();
  await quiesce();
  restarted.dispatches.releaseAll();
  await run;
});

// proves R-STATE-2
test("given the same stopped run, the write record shows no move of X out of the coding column between the restart and the return of X's new dispatch", async () => {
  const fake = await stoppedRun();
  const atRestart = fake.writes().length;
  const restarted = world({ fake, concurrency: 2 });

  const run = restarted.loop.run();
  await quiesce();
  assert.ok(restarted.dispatches.holding().includes(1), "X's new dispatch is held open");
  const beforeReturn = fake.writes().slice(atRestart);
  restarted.dispatches.releaseAll();
  await quiesce();
  restarted.dispatches.releaseAll();
  await run;

  assert.deepEqual(beforeReturn.filter(({ operation, args: [id] }) => operation === 'moveItem' && id === 'item-1'), []);
  assert.ok(fake.writes().slice(atRestart).some(({ args: [id, column] }) => id === 'item-1' && column === COLUMNS.review), 'X moved once its new dispatch returned');
});

// proves R-STATE-2
test('given the same stopped run, once the restarted run drains, no card that was on the board before the stop remains in the coding column', async () => {
  const fake = await stoppedRun();
  const before = Object.keys(await columnsOf(fake));
  const restarted = world({ fake, concurrency: 2 });

  await drive(restarted);

  assert.ok(restarted.l3Events().some((event) => event.trigger === 'drain'), 'the restarted run drained');
  const after = await columnsOf(fake);
  assert.deepEqual(before.filter((card) => after[card] === COLUMNS.coding), []);
});

test("the restarted engine's first tick calls the same L2 next-action function as every later tick", async () => {
  const fake = await stoppedRun();
  const restarted = world({ fake, concurrency: 1 });

  await drive(restarted);

  // Each dispatch starts from the one next action, given in the pull that started it.
  const dispatchedIn = (pull) => restarted.decisions.filter((decision) => decision.pull === pull && decision.action.action === 'dispatch').map(({ card }) => card);
  assert.deepEqual(dispatchedIn(1), [1, 2, 3], 'the first tick asked L2 of every card it could pull');
  const later = [...new Set(restarted.decisions.map(({ pull }) => pull))].filter((pull) => pull > 1);
  assert.ok(later.length > 0, 'later ticks asked L2 as well');
  assert.deepEqual(restarted.dispatches.started, [1, 2, 3]);
});

/** The path of every file under `directory`, relative to it, however deep. */
const filesUnder = (directory, root = directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(path, root) : [relative(root, path)];
});

/**
 * What `R-STATE-4` permits the state directory to hold, by file: the record, which is L5's event
 * stream. Whether admission is open and the process groups to kill are the other two, and no code
 * writes either yet, so no file stands for them.
 */
const PERMITTED = ['events.jsonl'];

// proves R-STATE-1
test('after a run, every file under the state directory is one R-STATE-4 permits, and the directory holds the run\'s event stream', async () => {
  const directory = scratch('state');
  const fake = await stoppedRun({ directory });
  const restarted = world({ fake, concurrency: 2, directory, run: 'r-restart' });

  await drive(restarted);

  const files = filesUnder(directory);
  assert.deepEqual(files.filter((file) => !PERMITTED.includes(file)), []);
  assert.ok(readEvents(directory).some((event) => event.run === 'r-restart' && event.event === 'run.start'), 'the stream holds the run');
});

// proves R-STATE-1
test('a restart after the state directory is deleted dispatches the same cards in the same order as a restart with it intact, and both dispatch at least one card', async () => {
  const restartOrder = async (deleted) => {
    const directory = scratch('state');
    const fake = await stoppedRun({ directory });
    if (deleted) rmSync(directory, { recursive: true });
    const restarted = world({ fake, concurrency: 1, directory });
    await drive(restarted);
    return restarted.dispatches.started;
  };

  const intact = await restartOrder(false);
  const deleted = await restartOrder(true);

  assert.ok(intact.length > 0 && deleted.length > 0, `intact ${intact}, deleted ${deleted}`);
  assert.deepEqual(deleted, intact);
});

// proves R-STATE-1
test('given a card left in Coding by the first run and then moved to the done column on the fake board, the restarted engine does not dispatch it', async () => {
  const fake = await stoppedRun();
  await fake.operations.moveItem('item-1', COLUMNS.done);
  const restarted = world({ fake, concurrency: 2 });

  await drive(restarted);

  assert.ok(restarted.dispatches.started.length > 0, 'the restarted engine dispatched the other cards');
  assert.ok(!restarted.dispatches.started.includes(1), `${restarted.dispatches.started}`);
});

test('a restart dispatches redos before any Ready card, even one ranked above them by priority and number', async () => {
  const fake = createFakeBoard({
    columns: Object.values(COLUMNS),
    fields: [{ name: 'Priority', options: ['High', 'Normal', 'Low'] }],
    items: [
      cardIn(1, COLUMNS.ready, { Priority: 'High' }),
      cardIn(8, COLUMNS.coding, { Priority: 'Low' }),
      cardIn(9, COLUMNS.review, { Priority: 'Low' }),
    ],
  });
  const restarted = world({ fake, concurrency: 1, priority: config.board.priority });

  await drive(restarted);

  assert.deepEqual(restarted.dispatches.started, [8, 9, 1]);
});

/**
 * One full fake-board run, a stopped first run and its restart driven until it drains, in a child
 * node process whose working directory is `repository`, with `HOME` and `TMPDIR` set to `home` and
 * `temporary` and the state directory at `.rigger/` in the repository. Answers the child's result.
 */
function fullRunIn(repository, { home, temporary }) {
  const harness = new URL('./loop-world.mjs', import.meta.url).href;
  const state = join(repository, '.rigger');
  const code = [
    `const { drive, stoppedRun, world } = await import(${JSON.stringify(harness)});`,
    `const directory = ${JSON.stringify(state)};`,
    'const fake = await stoppedRun({ directory });',
    "await drive(world({ fake, concurrency: 2, directory, run: 'r-restart' }));",
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: repository,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: temporary },
  });
}

/** A repository, empty `HOME` and `TMPDIR` directories, and one full run in them. */
function afterFullRun() {
  const repository = repositoryAt(scratch('target'), { 'README.md': 'A target repository.\n' });
  const home = scratch('home');
  const temporary = scratch('tmp');
  const before = gitIn(repository, 'status', '--porcelain', '--ignored');
  const ran = fullRunIn(repository, { home, temporary });
  assert.equal(ran.status, 0, ran.stderr);
  assert.ok(readEvents(join(repository, '.rigger')).some((event) => event.trigger === 'drain'), 'the run drained');
  return { repository, home, temporary, before };
}

// proves R-STATE-1
test('a full fake-board run with HOME and TMPDIR pointed at empty temporary directories leaves both empty afterwards', () => {
  const { home, temporary } = afterFullRun();

  assert.deepEqual(readdirSync(home), []);
  assert.deepEqual(readdirSync(temporary), []);
});

test('after the same run, git status --porcelain --ignored in the target repository shows no path outside the state directory added or changed', () => {
  const { repository, before } = afterFullRun();

  assert.equal(before, '', 'the repository was clean before the run');
  const paths = gitIn(repository, 'status', '--porcelain', '--ignored').split('\n').filter(Boolean).map((line) => line.slice(3));
  assert.ok(paths.includes('.rigger/'), `the run wrote its state directory: ${paths}`);
  assert.deepEqual(paths.filter((path) => !path.startsWith('.rigger/')), []);
});
