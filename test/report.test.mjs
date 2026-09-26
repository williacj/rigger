// ABOUTME: Tests `rigger report`: the real bin run in a consumer's repository over an event stream
// L3's loop wrote in a fake-board run, printing L3's throughput and utilization and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../rigger.config.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { repositoryIn } from './git-repository.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The stream a consumer's state directory holds, as the sink names it. */
const streamIn = (consumer) => join(consumer, '.rigger', 'events.jsonl');

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** A ready issue numbered `number` that L2 would dispatch: one kind selects it and its acceptance passes. */
const readyCard = (number) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: '## Acceptance\n\n- The verb prints its help.\n', labels: ['type:change'], column: config.board.columns.ready,
});

/** Lets every step already queued run to its end: the fake board answers through promises alone. */
const quiesce = () => new Promise((resolve) => setImmediate(resolve));

/** When every recorded run's clock starts: minute 0. */
const START = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Records one run of L3's real loop, over the fake board holding ready cards `cards`, into the
 * state directory `directory`, through L5's real sink, with L2's real column changes. The run's N
 * is `concurrency`. Every dispatch is held until `releases` frees it: each entry is a minute and
 * the cards whose dispatches return at that minute, exiting zero. The run's clock reads `START`
 * plus the minute of the entry being released, so every event carries a time the test chose.
 * `entry` is the loop's entry point the run goes through: `run`, or `pull` to fire the pull
 * trigger once, which records no `run.start` and so no N.
 */
async function recordRun(directory, { run = 'r-237', concurrency = 3, cards, releases, entry = 'run' }) {
  let minute = 0;
  const sink = openSink({ directory, run, now: () => START + minute * 60_000 });
  const fake = createFakeBoard({ columns: Object.values(config.board.columns), items: cards.map(readyCard) });
  const settings = { ...config, concurrency };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations });
  const board = {
    readColumns: async () => {
      await fake.operations.readColumns();
      return { ...config.board.columns };
    },
    readPriority: () => fake.operations.readPriority(),
  };
  const held = new Map();
  const returned = new Set();
  const dispatch = ({ card }) => new Promise((resolve) => {
    held.set(card.number, () => {
      returned.add(card.number);
      resolve({ exit: 0, output: '' });
    });
  });
  // A card whose dispatch returned has nothing more for L2 to do in this run.
  const decide = (card) => (returned.has(card.number) ? { action: 'ignore' } : nextAction(card, KINDS));
  const running = loop({ config: settings, board, decide, l2, dispatch, sink })[entry]();
  await quiesce();
  for (const [at, numbers] of releases) {
    minute = at;
    for (const number of numbers) {
      assert.ok(held.has(number), `card #${number} is not being dispatched at minute ${at}`);
      held.get(number)();
      held.delete(number);
    }
    await quiesce();
  }
  await running;
  assert.equal(held.size, 0, `cards ${[...held.keys()]} were still dispatched when the run ended`);
}

/**
 * Five ready cards under N 3. By hand: #1, #2 and #3 are pulled at minute 0; #1 returns at 30 and
 * #4 is pulled; #2 returns at 60 and #5 is pulled; #3 returns at 90, #4 at 120 and #5 at 150, when
 * the run drains. The span is minute 0 to minute 150, 2.5 h, over which 5 slots are released, so
 * throughput is 5 / 2.5 = 2 per hour. The pull-to-release intervals are 30, 60, 90, 90 (30 to 120)
 * and 90 (60 to 150) minutes, 360 minutes or 6 h, so utilization is 6 / (3 x 2.5) = 0.8.
 */
const FIVE_CARDS = { cards: [1, 2, 3, 4, 5], releases: [[30, [1]], [60, [2]], [90, [3]], [120, [4]], [150, [5]]] };

/** The value a report prints for `signal`, one of L3's, as a number, or undefined where it prints none. */
const printed = (text, signal) => {
  const found = text.match(new RegExp(`L3 ${signal}: (\\d+(?:\\.\\d+)?)`));
  return found ? Number(found[1]) : undefined;
};

/** Runs the real bin's `report` with `cwd` as its working directory. */
function report(cwd) {
  const ran = spawnSync(process.execPath, [bin, 'report'], { cwd, encoding: 'utf8' });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status };
}

test('report over a state directory holding no event stream says no events are recorded, naming the path it looked at', () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /no events are recorded/, ran.out);
  assert.ok(ran.out.includes(streamIn(consumer)), ran.out);
});

// proves R-SAFE-5
test('report run against the source tree it is running from exits non-zero and names R-SAFE-5', () => {
  const ran = report(root);

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /R-SAFE-5/, ran.err);
});

test('report over a concurrency 3 fake-board run L3 recorded prints its throughput and utilization, by the definitions', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.equal(printed(ran.out, 'throughput'), 2, ran.out);
  assert.equal(printed(ran.out, 'utilization'), 0.8, ran.out);
});

test('report over a run whose first and last events share a timestamp says the span is zero and prints no signal value', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  // Every card returns at minute 0, the minute the run starts, so every event carries one time.
  await recordRun(join(consumer, '.rigger'), { cards: [1, 2], releases: [[0, [1, 2]]] });

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /the span is zero/, ran.out);
  assert.doesNotMatch(ran.out, /throughput:|utilization:/, ran.out);
});

test('report computes utilization from the N the run recorded, not the concurrency the config declares', async () => {
  // The config declares N 5, and the run recorded N 3. Utilization over N 5 would be
  // 6 / (5 x 2.5) = 0.48; over the recorded N 3 it is 0.8, as FIVE_CARDS works out.
  const consumer = realpathSync(repositoryIn('rigger-report-', { 'rigger.config.mjs': `export default ${JSON.stringify({ ...config, concurrency: 5 })};\n` }));
  await recordRun(join(consumer, '.rigger'), { ...FIVE_CARDS, concurrency: 3 });

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.equal(printed(ran.out, 'utilization'), 0.8, ran.out);
});

test('report over a stream holding only L2 and L3 events prints no signal for any other layer', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  const layers = new Set(readFileSync(streamIn(consumer), 'utf8').trim().split('\n').map((line) => JSON.parse(line).layer));
  assert.deepEqual([...layers].sort(), ['L2', 'L3']);

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /\bL3\b/, ran.out);
  assert.doesNotMatch(ran.out, /\bL[0-24-9]\b/, ran.out);
});

test('report over a stream holding a line that does not parse exits non-zero, names that line, and prints no signal', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  const whole = readFileSync(streamIn(consumer), 'utf8').trim().split('\n');
  // The damage sits at line 3, with whole events either side of it.
  writeFileSync(streamIn(consumer), `${[...whole.slice(0, 2), '{"ts":"2026-01-01T00:', ...whole.slice(2)].join('\n')}\n`);

  const ran = report(consumer);

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /\bline 3\b/, ran.err);
  assert.doesNotMatch(`${ran.out}${ran.err}`, /throughput|utilization/);
});

test('report leaves the stream\'s bytes as they were', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  const before = readFileSync(streamIn(consumer));

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.ok(readFileSync(streamIn(consumer)).equals(before), 'the stream changed under report');
});

test('report over a run that recorded no N prints its throughput and says it has no utilization', async () => {
  // A pull fired alone records no run.start. Two cards returning at 30 and 60 minutes: 2 slot
  // releases over the span from minute 0 to minute 60, 1 h, so throughput is 2 per hour.
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), { cards: [1, 2], releases: [[30, [1]], [60, [2]]], entry: 'pull' });

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.equal(printed(ran.out, 'throughput'), 2, ran.out);
  assert.equal(printed(ran.out, 'utilization'), undefined, ran.out);
  assert.match(ran.out, /recorded no N/, ran.out);
});

test('report over a stream holding two runs prints each run\'s signals over that run\'s own span and N', async () => {
  // The first run is FIVE_CARDS: 2 per hour and 0.8. The second, recorded after it into the same
  // stream under N 1, pulls #1 at minute 0 and releases it at 60, a span of 1 h: 1 per hour, and
  // utilization 1 / (1 x 1) = 1. Merged into one span and one N the figures would be neither.
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  await recordRun(join(consumer, '.rigger'), { run: 'r-second', concurrency: 1, cards: [1], releases: [[60, [1]]] });

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  const [first, second] = ran.out.split(/^run /m).slice(1);
  assert.match(first, /^r-237:/, ran.out);
  assert.match(second, /^r-second:/, ran.out);
  assert.deepEqual([printed(first, 'throughput'), printed(first, 'utilization')], [2, 0.8], ran.out);
  assert.deepEqual([printed(second, 'throughput'), printed(second, 'utilization')], [1, 1], ran.out);
});

/**
 * A directory that is the whole of the path a recorded run is given. It holds a stand-in for each
 * command a verb here could start, `git` and `gh`, and each records the call before anything
 * else: `gh` then refuses it, and `git` hands it on to the git the suite's own path finds. A
 * command started by name is found here or nowhere, so the record is every command the run issued
 * by name, and one it could not find would have left the run short of the output it is held to.
 * A command started by its absolute path is out of the record's reach.
 */
function recordingPath() {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-report-path-'));
  const git = process.env.PATH.split(delimiter).map((entry) => join(entry, 'git')).find((path) => existsSync(path));
  assert.ok(git && !git.includes("'"), `the suite's path holds no git this stand-in can name: ${git}`);
  const record = 'printf \'%s\\n\' "${0##*/} $*" >> "${0%/*}/calls"';
  for (const [name, then] of [['gh', 'exit 1'], ['git', `exec '${git}' "$@"`]]) {
    writeFileSync(join(dir, name), ['#!/bin/sh', record, then, ''].join('\n'));
    chmodSync(join(dir, name), 0o755);
  }
  const calls = join(dir, 'calls');
  return { dir, calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []) };
}

test('report issues no gh command, by a record of every command it issues', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  const path = recordingPath();

  const ran = spawnSync(process.execPath, [bin, 'report'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, PATH: path.dir } });

  // The run did its whole work under the recording path, so nothing it needed was out of reach.
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(printed(ran.stdout, 'throughput'), 2, ran.stdout);
  const calls = path.calls();
  // Naming the tree it runs against is git's answer, so git is asked, and nothing else is.
  assert.ok(calls.length > 0, 'the record holds no command, so nothing shows it was being kept');
  assert.deepEqual(calls.filter((call) => !call.startsWith('git ')), [], calls.join('\n'));
});
