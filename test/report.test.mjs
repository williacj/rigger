// ABOUTME: Tests `rigger report` over real consumer event streams for L3 signals and marker
// dispatch checks, through the real bin and an isolated fake board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import config from '../rigger.config.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { repositoryIn } from './git-repository.mjs';
import { waitFor } from './loop-world.mjs';
import { factsOverNothing, oneOpenFromEveryLine } from './loop-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { positive } from './loop-world.mjs';
import { settledOf } from './loop-world.mjs';
import { standInAgent } from './stub-claude.mjs';
import { mkdirSync } from 'node:fs';
import { repositoryAt } from './git-repository.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';
import { readsWith } from './loop-world.mjs';
import { makingJudgeDirectories } from './loop-world.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The stream a consumer's state directory holds, as the sink names it. */
const streamIn = (consumer) => join(consumer, '.rigger', 'events.jsonl');

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'] } };

/** A ready issue numbered `number` that L2 would dispatch: one kind selects it and its acceptance passes. */
const readyCard = (number) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: '## Acceptance\n\n- The verb prints its help.\n', labels: ['type:change'], column: config.board.columns.ready,
});

/** When every recorded run's clock starts: minute 0. */
const START = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Records one run of L3's real loop, over the fake board holding ready cards `cards`, into the
 * state directory `directory`, through L5's real sink, with L2's real column changes. The run's N
 * is `concurrency`. Each card's maker is a stand-in agent L1 runs, first on the PATH L3 hands it,
 * which holds until the test releases it at the minute `releases` gives: each entry is a minute
 * and the cards whose makers are released at that minute, exiting zero. The run's clock reads `START`
 * plus the minute of the entry being released, so every event carries a time the test chose.
 * `entry` is the loop's entry point the run goes through: `run`, or `pull` to fire the pull
 * trigger once, which records no `run.start` and so no N.
 */
async function recordRun(directory, { run = 'r-237', concurrency = 3, cards, releases, entry = 'run' }) {
  let minute = 0;
  const sink = openSink({ directory, run, now: () => START + minute * 60_000 });
  const fake = createFakeBoard({ columns: Object.values(config.board.columns), items: cards.map(readyCard) });
  const settings = { ...config, concurrency };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: readsWith(oneOpenFromEveryLine) });
  const board = {
    readColumns: async () => {
      await fake.operations.readColumns();
      return { ...config.board.columns };
    },
    readPriority: () => fake.operations.readPriority(),
  };
  const agent = standInAgent(Object.fromEntries(cards.map((number) => [number, { engineer: { hold: true } }])));
  const returned = new Set();
  let stopping = false;
  // The cards whose maker stand-in has started and is unreleased, by its started marker.
  const held = () => cards.filter((number) => !returned.has(number) && agent.held(number));
  // A card whose maker the test released has nothing more for L2 to do in this run.
  const decide = (card, outcomes, attempt) => (stopping || returned.has(card.number) ? { action: 'ignore' } : nextAction(card, KINDS, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...attempt }));
  /** How many slot releases this run has recorded so far. */
  const releasesRecorded = () => (existsSync(streamPath(directory)) ? readEvents(directory) : [])
    .filter((event) => event.run === run && event.layer === 'L3' && event.event === 'slot.release').length;
  /**
   * Whether the loop has made every start it can: every returned card's slot release is recorded,
   * and under `run` its maker stand-in holds as many cards as there are slots, or every card not
   * yet returned where fewer remain, and under `pull`, which refills no slot, every card the pull
   * claimed less those returned.
   */
  const everyStartMade = () => releasesRecorded() === returned.size && held().length === (entry === 'run'
    ? Math.min(concurrency, cards.length - returned.size)
    : Math.min(concurrency, cards.length) - returned.size);
  // The scratch directories and their repository lie outside the consumer's checkout, which holds
  // the state directory, since L1 refuses a scratch directory inside any checkout.
  const outside = temporaryDirectory('rigger-report-scratch-');
  const repository = repositoryAt(join(outside, 'repository'));
  const workspace = async (card) => {
    const path = join(directory, 'workspaces', `rigger-${card}`);
    mkdirSync(path, { recursive: true });
    return { path, scratch: join(outside, 'scratch', `rigger-${card}`), repository };
  };
  const running = loop({ config: settings, board, decide, facts: factsOverNothing(settings, decide), l2, sink, kill: async () => {}, workspace, judgeDirectory: makingJudgeDirectories(temporaryDirectory('rigger-judge-directories-')), removeDirectories: async () => {}, state: directory, environment: { ...process.env, PATH: agent.first() }, run })[entry]();
  try {
    // Positive: until every start the loop can make is held.
    await positive(everyStartMade);
    for (const [at, numbers] of releases) {
      minute = at;
      for (const number of numbers) {
        assert.ok(held().includes(number), `card #${number}'s maker is not held at minute ${at}`);
        returned.add(number);
        agent.release(number);
      }
      // Positive: until every start the loop can make is held.
      await positive(everyStartMade);
    }
    await running;
    assert.deepEqual(cards.filter((number) => agent.held(number)), [], 'a maker stand-in was still held when the run ended');
  } catch (failure) {
    stopping = true;
    const settled = settledOf(running);
    const released = new Set();
    while (!settled()) {
      for (const number of cards) {
        const pid = agent.holder(number);
        if (pid !== undefined && !released.has(pid)) {
          released.add(pid);
          agent.release(number);
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await running.catch(() => {});
    throw failure;
  }
}

/**
 * Five ready cards under N 3. By hand: #1, #2 and #3 are pulled at minute 0; #1 returns at 30 and
 * #4 is pulled; #2 returns at 60 and #5 is pulled; #3 returns at 90, #4 at 120 and #5 at 150, when
 * the run drains. The span is minute 0 to minute 150, 2.5 h, over which 5 slots are released, so
 * throughput is 5 / 2.5 = 2 per hour. The pull-to-release intervals are 30, 60, 90, 90 (30 to 120)
 * and 90 (60 to 150) minutes, 360 minutes or 6 h, so utilization is 6 / (3 x 2.5) = 0.8.
 */
const FIVE_CARDS = { cards: [1, 2, 3, 4, 5], releases: [[30, [1]], [60, [2]], [90, [3]], [120, [4]], [150, [5]]] };

/** Every maker stand-in pid recorded for workspaces belonging to this run's state directory. */
function makerPidsIn(directory) {
  const workspaces = `${realpathSync.native(directory)}/workspaces/`;
  return readdirSync(tmpdir()).filter((name) => name.startsWith('rigger-stand-in-')).flatMap((name) => {
    const path = join(tmpdir(), name, 'runs.jsonl');
    try {
      return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
        .filter((run) => existsSync(run.cwd) && realpathSync.native(run.cwd).startsWith(workspaces))
        .map((run) => run.pid);
    } catch (failure) {
      if (failure.code === 'ENOENT') return [];
      throw failure;
    }
  });
}

/** A failed recordRun has ended every L3 claim and every stand-in it started. */
function assertRecordRunEnded(directory) {
  const events = readEvents(directory).filter((event) => event.run === 'r-237' && event.layer === 'L3');
  const cardsAt = (name) => events.filter((event) => event.event === name).map((event) => event.card).sort((a, b) => a - b);
  assert.ok(cardsAt('pull').length > 0, 'the loop recorded no pull');
  assert.deepEqual(cardsAt('slot.release'), cardsAt('pull'), 'an L3 pull kept its slot after recordRun rejected');
  const pids = makerPidsIn(directory);
  assert.ok(pids.length > 0, 'the stand-in recorded no maker process');
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      assert.fail(`maker stand-in ${pid} is alive after recordRun rejected`);
    } catch (failure) {
      if (failure.code !== 'ESRCH') throw failure;
    }
  }
}

/** Forces a failed wait or held check, then reads the failure and everything the loop left behind. */
async function failedRecordRun({ entry, cards, concurrency, releases, inflate = false }, expectedFailure) {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  const directory = join(consumer, '.rigger');
  const recording = recordRun(directory, { cards, concurrency, releases, entry });
  if (inflate) cards.length += 1;

  await assert.rejects(recording, expectedFailure);
  assertRecordRunEnded(directory);
}

/** The unchanged error thrown by `positive(everyStartMade)`. */
function waitFailure(failure) {
  assert.equal(failure.constructor, Error);
  assert.match(failure.message, /^the condition .* did not hold within 5000 ms$/s);
  return true;
}

test('recordRun run ends its loop and makers when the first positive wait fails', { timeout: 10_000 }, async () => {
  // The board and stand-ins are made for two cards; the first wait expects an impossible third.
  await failedRecordRun({ entry: 'run', cards: [1, 2], concurrency: 3, releases: [], inflate: true }, waitFailure);
});

test('recordRun pull ends its loop and makers when the first positive wait fails', { timeout: 10_000 }, async () => {
  await failedRecordRun({ entry: 'pull', cards: [1, 2], concurrency: 3, releases: [], inflate: true }, waitFailure);
});

test('recordRun run ends its loop and makers when a released card is not held', { timeout: 10_000 }, async () => {
  // Only card 1 is on the board; the release check names card 2.
  await failedRecordRun({ entry: 'run', cards: [1], concurrency: 1, releases: [[30, [2]]] }, (failure) => {
    assert.equal(failure.code, 'ERR_ASSERTION');
    assert.equal(failure.message, "card #2's maker is not held at minute 30");
    return true;
  });
});

test('recordRun pull ends its loop and makers when a released card is not held', { timeout: 10_000 }, async () => {
  await failedRecordRun({ entry: 'pull', cards: [1], concurrency: 1, releases: [[30, [2]]] }, (failure) => {
    assert.equal(failure.code, 'ERR_ASSERTION');
    assert.equal(failure.message, "card #2's maker is not held at minute 30");
    return true;
  });
});

test('recordRun run ends its loop and makers when a later positive wait fails', { timeout: 10_000 }, async () => {
  // Both makers first hold; after card 1 returns, the next wait expects two still held.
  await failedRecordRun({ entry: 'run', cards: [1, 2], concurrency: 2, releases: [[30, [1]]], inflate: true }, waitFailure);
});

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

/** Record the layer events in one run without starting an agent or reaching a forge. */
function recordEvents(consumer, run, events) {
  const sink = openSink({ directory: join(consumer, '.rigger'), run, now: () => START });
  for (const { layer, card, dispatch, event, fields } of events) {
    sink.emitter({ layer, card, dispatch }).emit(event, fields);
  }
}

/** The L2 read of one agent marker, in the shape the review loop records. */
function markerRead({ card = 660, role = 'reviewer', dispatch = 'd-missing', pull = 42, head = 'head-a', evidence = 'evidence-a', reason } = {}) {
  return { layer: 'L2', card, dispatch, event: 'marker.read', fields: {
    role, pull, head, digest: 'acceptance-a', evidence, verdict: reason ? null : 'sound', edited: false,
    ...(reason ? { reason } : {}),
  } };
}

/** One L3 role dispatch and its L1 start, with the facts a judge dispatch records. */
function judgeStart({ card = 660, role = 'reviewer', dispatch = 'd-judge', pull = 42, head = 'head-a', evidence = 'evidence-a', step } = {}) {
  return [
    { layer: 'L3', card, dispatch, event: 'dispatch', fields: step ? { step, role } : { role, tier: 'standard' } },
    { layer: 'L1', card, dispatch, event: 'dispatch.start', fields: step ? { command: 'npm' } : {
      command: 'agent', facts: { card, pull, head, revision: 'acceptance-a' }, digest: evidence,
    } },
  ];
}

/** Report an independently written marker stream and return only its named marker lines. */
function namedMarkerLines(reads, starts = [], { earlier = false } = {}) {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  if (earlier) recordEvents(consumer, 'r-dispatch', starts);
  recordEvents(consumer, 'r-read', [...(earlier ? [] : starts), ...reads]);
  const ran = report(consumer);
  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /markers no dispatch wrote/);
  return { lines: ran.out.split('\n').filter((line) => line.startsWith('  card #')), out: ran.out };
}

test('report names an agent marker whose dispatch has no recorded start', () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  recordEvents(consumer, 'r-read', [markerRead()]);

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /markers no dispatch wrote/);
  assert.match(ran.out, /card #660.*reviewer.*head-a.*d-missing/);
});

test('report names no agent marker whose card, role, pull, head and evidence join its dispatch', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge' })], judgeStart());
  assert.deepEqual(lines, []);
});

test('report names a marker whose dispatch started at another head', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge', head: 'head-b' })], judgeStart());
  assert.match(lines[0], /card #660.*reviewer.*head-b.*d-judge/);
});

test('report names markers whose dispatch is for another card or role', () => {
  const reads = [markerRead({ dispatch: 'd-card', card: 661 }), markerRead({ dispatch: 'd-role', role: 'architect' })];
  const starts = [...judgeStart({ dispatch: 'd-card' }), ...judgeStart({ dispatch: 'd-role' })];
  const { lines } = namedMarkerLines(reads, starts);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /card #661.*reviewer.*d-card/);
  assert.match(lines[1], /card #660.*architect.*d-role/);
});

test('report names a marker whose pull differs from its dispatch start', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge', pull: 43 })], judgeStart());
  assert.equal(lines.length, 1);
});

test('report names a marker whose evidence digest differs from its dispatch start', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge', evidence: 'other-evidence' })], judgeStart());
  assert.equal(lines.length, 1);
});

test('report names an agent marker with no dispatch id', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: null })]);
  assert.match(lines[0], /dispatch null/);
});

test('report names both distinct markers that name one dispatch id', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge', head: 'head-b' }), markerRead({ dispatch: 'd-judge', head: 'head-c' })], judgeStart());
  assert.equal(lines.length, 2);
});

test('report names both distinct joining markers that share a dispatch id', () => {
  const real = markerRead({ dispatch: 'd-judge' });
  real.fields.verdict = 'needs revision';
  const forged = markerRead({ dispatch: 'd-judge' });
  const { lines } = namedMarkerLines([real, forged], judgeStart());
  assert.equal(lines.length, 2, JSON.stringify(lines));
});

test('report names one marker read on three pulls at most once', () => {
  const reads = [42, 43, 44].map((pull) => markerRead({ pull }));
  const { lines } = namedMarkerLines(reads);
  assert.equal(lines.length, 1);
});

test('report names no owner marker, even without a dispatch', () => {
  const { lines } = namedMarkerLines([markerRead({ role: 'owner' })]);
  assert.deepEqual(lines, []);
});

test('report joins a marker read in a later run to its earlier dispatch', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-judge' })], judgeStart(), { earlier: true });
  assert.deepEqual(lines, []);
});

test('report names a marker when L3 recorded a dispatch but L1 refused its start', () => {
  const [l3] = judgeStart({ dispatch: 'd-refused' });
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-refused' })], [l3]);
  assert.equal(lines.length, 1);
});

test('report names a marker using a maker dispatch id', () => {
  const starts = judgeStart({ dispatch: 'd-maker', role: 'engineer' });
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-maker' })], starts);
  assert.equal(lines.length, 1);
});

test('report names a marker using a judge provisioning step dispatch id', () => {
  const starts = judgeStart({ dispatch: 'd-step', step: 'install' });
  const { lines } = namedMarkerLines([markerRead({ dispatch: 'd-step' })], starts);
  assert.equal(lines.length, 1);
});

test('report names an unreadable agent marker with its recorded reason', () => {
  const { lines } = namedMarkerLines([markerRead({ dispatch: null, reason: 'marker could not be parsed' })]);
  assert.match(lines[0], /marker could not be parsed/);
});

test('report does not name an edited marker when its dispatch joins', () => {
  const edited = markerRead({ dispatch: 'd-judge' });
  edited.fields.edited = true;
  const { lines } = namedMarkerLines([edited], judgeStart());
  assert.deepEqual(lines, []);
});

test('report treats one joining marker read before and after an edit as one marker', () => {
  const before = markerRead({ dispatch: 'd-judge' });
  const after = markerRead({ dispatch: 'd-judge' });
  after.fields.edited = true;
  const { lines } = namedMarkerLines([before, after], judgeStart());
  assert.deepEqual(lines, []);
});

test('report states both edges below its marker heading', () => {
  const { out } = namedMarkerLines([markerRead()]);
  assert.match(out, /markers no dispatch wrote\n(?:  card[^\n]*\n)*  only markers L2 recorded in this state directory are named\n  markers of role owner are never checked/);
});

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

test('report over a stream holding the layers a maker\'s dispatch records prints no signal for any other layer', async () => {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  await recordRun(join(consumer, '.rigger'), FIVE_CARDS);
  const layers = new Set(readFileSync(streamIn(consumer), 'utf8').trim().split('\n').map((line) => JSON.parse(line).layer));
  // L0 records only where it kills or sweeps something, which a clean exit may not need.
  assert.deepEqual([...layers].filter((layer) => layer !== 'L0').sort(), ['L1', 'L2', 'L3']);

  const ran = report(consumer);

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /\bL3\b/, ran.out);
  assert.doesNotMatch(ran.out.replace(/^  only markers L2 recorded in this state directory are named\n/m, ''), /\bL[04-9]\b/, ran.out);
  assert.match(ran.out, /^L1$/m, ran.out);
  assert.match(ran.out, /^L2$/m, ran.out);
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
  const [first, second] = ran.out.slice(ran.out.indexOf('\nL3\n')).split(/^  run /m).slice(1);
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
 * Each stand-in is run once before this returns (`warmed`), exiting before it records anything.
 */
function recordingPath() {
  const dir = temporaryDirectory('rigger-report-path-');
  const git = process.env.PATH.split(delimiter).map((entry) => join(entry, 'git')).find((path) => existsSync(path));
  assert.ok(git && !git.includes("'"), `the suite's path holds no git this stand-in can name: ${git}`);
  const record = 'printf \'%s\\n\' "${0##*/} $*" >> "${0%/*}/calls"';
  for (const [name, then] of [['gh', 'exit 1'], ['git', `exec '${git}' "$@"`]]) {
    writeFileSync(join(dir, name), ['#!/bin/sh', EXIT_IF_WARMING, record, then, ''].join('\n'));
    chmodSync(join(dir, name), 0o755);
    warmed(join(dir, name));
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

test('the recording path, once made, has recorded no command', () => {
  assert.deepEqual(recordingPath().calls(), []);
});

/** Runs the real bin's `report` over a stream holding `runs`, each a run id and the events it records, in order. */
function reported(runs) {
  const consumer = realpathSync(repositoryIn('rigger-report-'));
  for (const [run, events] of runs) recordEvents(consumer, run, events);
  const ran = report(consumer);
  assert.equal(ran.code, 0, ran.err);
  return ran.out;
}

/** The lines of `out` under the unindented heading `layer`, up to the next unindented line. */
function section(out, layer) {
  const lines = out.split('\n');
  const start = lines.indexOf(layer);
  assert.notEqual(start, -1, `no ${layer} section in:\n${out}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith(' '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The lines of a section under its heading `heading`, `run <id>` or `across the stream`, unindented. */
function under(lines, heading) {
  const start = lines.indexOf(`  ${heading}`);
  assert.notEqual(start, -1, `no heading "${heading}" in:\n${lines.join('\n')}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith('    '));
  return lines.slice(start + 1, end === -1 ? undefined : end).map((line) => line.slice(4));
}

/** The rate `name` among `lines` as [rate, numerator, denominator], or the line saying why it has none. */
function rateIn(lines, name) {
  const found = lines.filter((line) => line.startsWith(`${name}: `) || line.startsWith(`no ${name}: `));
  assert.equal(found.length, 1, `not one ${name} line in:\n${lines.join('\n')}`);
  const figures = found[0].match(new RegExp(`^${name}: (\\d+(?:\\.\\d+)?) \\(.* (\\d+), over .* (\\d+)\\)$`));
  return figures ? figures.slice(1).map(Number) : found[0];
}

/** One L1 `dispatch.end` of `dispatch`, taking `ms`, under `card` where one is given, with `fields` besides. */
const ended = (dispatch, ms, { card, ...fields } = {}) => ({ layer: 'L1', card, dispatch, event: 'dispatch.end',
  // L1 records `reason` in place of `exit` where it got no result for the command (`src/execution/run.mjs`).
  fields: 'reason' in fields ? { ms, ...fields } : { exit: 0, ms, ...fields } });

/** One L0 kill event `name` carrying `dispatch`, as L0 records a survivor or group it killed. */
const killed = (name, dispatch, card = 7) => ({ layer: 'L0', card, dispatch, event: name, fields: { pid: 4242 } });

test('report prints an L1 section, then L2, then L3, each headed by its layer, ahead of the marker check', () => {
  const out = reported([['r-a', [ended('d-1', 1000, { card: 7 })]]]);
  const headings = out.split('\n').filter((line) => /^L\d$/.test(line) || line === 'markers no dispatch wrote');
  assert.deepEqual(headings, ['L1', 'L2', 'L3', 'markers no dispatch wrote'], out);
});

test('report lists each dispatch.end of a run under that run, with its card where it carries one, and counts it across the stream', () => {
  const l1 = section(reported([['r-a', [ended('d-1', 1500, { card: 7 }), ended('d-2', 300)]]]), 'L1');
  const run = under(l1, 'run r-a');
  assert.ok(run.includes('dispatch d-1, card #7: 1500 ms'), run.join('\n'));
  assert.ok(run.includes('dispatch d-2: 300 ms'), run.join('\n'));
  assert.ok(under(l1, 'across the stream').includes('dispatch.end events: 2, each listed under its run'), l1.join('\n'));
});

/** The survivor rate L1's section prints for run `run`, and across the stream, over `runs`. */
function survivorRates(runs, run = runs[0][0]) {
  const l1 = section(reported(runs), 'L1');
  return { run: rateIn(under(l1, `run ${run}`), 'survivor rate'), stream: rateIn(under(l1, 'across the stream'), 'survivor rate') };
}

test('report counts a dispatch whose id a survivor.killed carries in the survivor rate\'s numerator', () => {
  // Two dispatches ended with a result, and L0 killed a survivor of d-1: 1 of 2, 0.5.
  const rates = survivorRates([['r-a', [ended('d-1', 100), ended('d-2', 100), killed('survivor.killed', 'd-1')]]]);
  assert.deepEqual(rates, { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report counts a dispatch whose id a group.killed carries in the survivor rate\'s numerator', () => {
  const rates = survivorRates([['r-a', [ended('d-1', 100), ended('d-2', 100), killed('group.killed', 'd-2')]]]);
  assert.deepEqual(rates, { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report lists the duration of a dispatch.end carrying reason and leaves it out of the survivor rate\'s denominator', () => {
  // d-2 got no result, so only d-1 is in the denominator, and L0 killed d-1's survivor: 1 of 1.
  const runs = [['r-a', [ended('d-1', 100), ended('d-2', 250, { reason: 'spawn ENOENT' }), killed('survivor.killed', 'd-1')]]];
  const l1 = section(reported(runs), 'L1');
  assert.ok(under(l1, 'run r-a').includes('dispatch d-2: 250 ms'), l1.join('\n'));
  assert.deepEqual(survivorRates(runs), { run: [1, 1, 1], stream: [1, 1, 1] });
});

test('report keeps a dispatch.end carrying unread in the survivor rate\'s denominator', () => {
  const runs = [['r-a', [ended('d-1', 100, { unread: 'the status could not be read' }), ended('d-2', 100), killed('survivor.killed', 'd-1')]]];
  assert.deepEqual(survivorRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report counts a dispatch both kill events carry, or one carries twice, once in the survivor rate\'s numerator', () => {
  // Four kill events name two of three dispatches: 2 of 3, where counting events would give 4.
  const runs = [['r-a', [ended('d-1', 100), ended('d-2', 100), ended('d-3', 100),
    killed('survivor.killed', 'd-1'), killed('group.killed', 'd-1'), killed('group.killed', 'd-2'), killed('group.killed', 'd-2')]]];
  assert.deepEqual(survivorRates(runs), { run: [0.6667, 2, 3], stream: [0.6667, 2, 3] });
});

test('report counts a kill event carrying a dispatch id another run recorded for the run whose dispatch.end has that id', () => {
  const runs = [
    ['r-a', [ended('d-1', 100), ended('d-2', 100)]],
    ['r-b', [killed('survivor.killed', 'd-1'), ended('d-3', 100)]],
  ];
  assert.deepEqual(survivorRates(runs, 'r-a'), { run: [0.5, 1, 2], stream: [0.3333, 1, 3] });
  assert.deepEqual(survivorRates(runs, 'r-b').run, [0, 0, 1]);
});

test('report leaves out of the survivor rate\'s numerator a dispatch whose dispatch.end carries reason and whose id a kill event carries', () => {
  const runs = [['r-a', [ended('d-1', 100, { reason: 'spawn ENOENT' }), ended('d-2', 100), killed('survivor.killed', 'd-1')]]];
  assert.deepEqual(survivorRates(runs), { run: [0, 0, 1], stream: [0, 0, 1] });
});

test('report counts nowhere a kill event whose dispatch no dispatch.end in the stream carries', () => {
  const runs = [['r-a', [ended('d-1', 100), ended('d-2', 100), killed('survivor.killed', 'd-9'), killed('group.killed', 'd-9')]]];
  assert.deepEqual(survivorRates(runs), { run: [0, 0, 2], stream: [0, 0, 2] });
});

test('report counts nowhere a kill event whose dispatch is null or absent', () => {
  const runs = [['r-a', [ended('d-1', 100), ended('d-2', 100), killed('survivor.killed', null), killed('group.killed', undefined)]]];
  assert.deepEqual(survivorRates(runs), { run: [0, 0, 2], stream: [0, 0, 2] });
});

test('report leaves out of the survivor rate\'s numerator a dispatch only a timeout.killed or recorded.killed carries', () => {
  const runs = [['r-a', [ended('d-1', 100), ended('d-2', 100), killed('timeout.killed', 'd-1'), killed('recorded.killed', 'd-2')]]];
  assert.deepEqual(survivorRates(runs), { run: [0, 0, 2], stream: [0, 0, 2] });
});

test('report lists a provisioning step\'s dispatch.end and keeps it in the survivor rate\'s denominator', () => {
  const runs = [['r-a', [
    { layer: 'L3', card: 7, dispatch: 'd-step', event: 'dispatch', fields: { step: 'install', role: 'reviewer' } },
    ended('d-step', 400, { card: 7 }), ended('d-1', 100), killed('survivor.killed', 'd-step'),
  ]]];
  const l1 = section(reported(runs), 'L1');
  assert.ok(under(l1, 'run r-a').includes('dispatch d-step, card #7: 400 ms'), l1.join('\n'));
  assert.deepEqual(survivorRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

/** One L3 event `name` under `card`, as L3 records a claim. */
const claim = (name, card) => ({ layer: 'L3', card, event: name, fields: {} });

/** One L2 event `name` under `card`, carrying `fields`. */
const l2Event = (name, card, fields) => ({ layer: 'L2', card, event: name, fields });

/** One L2 maker.failed under `card`, as L2 records a maker that never started. */
const makerFailed = (card) => l2Event('maker.failed', card, { class: 'environment', reason: 'spawn ENOENT' });

test('report prints no duration line and no survivor rate for a run with no dispatch.end', () => {
  const l1 = section(reported([['r-a', [ended('d-1', 100)]], ['r-b', [claim('pull', 7)]]]), 'L1');
  assert.deepEqual(under(l1, 'run r-b'), ['no survivor rate: no dispatch in this run ended with a result']);
});

test('report prints no survivor rate across a stream with no dispatch.end, and never a 0', () => {
  const l1 = section(reported([['r-a', [claim('pull', 7)]]]), 'L1');
  assert.equal(rateIn(under(l1, 'across the stream'), 'survivor rate'), 'no survivor rate: no dispatch in the stream ended with a result');
});

/** The host-fault rate L2's section prints for run `run`, and across the stream, over `runs`. */
function hostFaultRates(runs, run = runs[0][0]) {
  const l2 = section(reported(runs), 'L2');
  return { run: rateIn(under(l2, `run ${run}`), 'host-fault rate'), stream: rateIn(under(l2, 'across the stream'), 'host-fault rate') };
}

test('report counts a maker.failed under a card in the host-fault numerator, over the run\'s work claims', () => {
  const runs = [['r-a', [claim('pull', 7), makerFailed(7), claim('slot.release', 7), claim('pull', 8)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report counts a judge.withheld under a card in the host-fault numerator', () => {
  const runs = [['r-a', [claim('pull', 7), l2Event('judge.withheld', 7, { role: 'reviewer', reason: 'no scratch', class: 'environment' }), claim('pull', 8)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report counts an environment attempt.failed carrying no maker in the host-fault numerator', () => {
  const runs = [['r-a', [claim('pull', 7), l2Event('attempt.failed', 7, { attempt: 1, class: 'environment', reason: 'fetch failed' }), claim('pull', 8)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report does not count an environment attempt.failed carrying maker, whose maker.failed is already counted', () => {
  const runs = [['r-a', [claim('pull', 7), makerFailed(7), l2Event('attempt.failed', 7, { attempt: 1, class: 'environment', maker: 'engineer', reason: 'spawn ENOENT' }), claim('pull', 8)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report does not count a card-local or out attempt.failed as a host fault', () => {
  const runs = [['r-a', [claim('pull', 7), l2Event('attempt.failed', 7, { attempt: 1, class: 'card-local', reason: 'workspace refused' }),
    claim('pull', 8), l2Event('attempt.failed', 8, { attempt: 1, class: 'out', reason: 'line moved' }), makerFailed(8)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [0.5, 1, 2], stream: [0.5, 1, 2] });
});

test('report counts a pull with no merge.start under its card before that card\'s next pull as a work claim, and leaves out a merge claim', () => {
  // #7's first claim is a work claim: its merge.start follows #7's next pull. #8's claim and #7's
  // second are merge claims. One work claim, with one host fault: 1 of 1, where 3 pulls would give 1 of 3.
  const runs = [['r-a', [claim('pull', 7), makerFailed(7), claim('pull', 8), claim('merge.start', 8), claim('pull', 7), claim('merge.start', 7)]]];
  assert.deepEqual(hostFaultRates(runs), { run: [1, 1, 1], stream: [1, 1, 1] });
});

test('report prints no host-fault rate for a run with no work claim', () => {
  const l2 = section(reported([['r-a', [claim('pull', 7), claim('merge.start', 7)]], ['r-b', [claim('pull', 8)]]]), 'L2');
  assert.deepEqual(under(l2, 'run r-a'), ['no host-fault rate: no work claim in this run']);
  assert.deepEqual(rateIn(under(l2, 'run r-b'), 'host-fault rate'), [0, 0, 1]);
});

test('report over two runs derives each run\'s L1 and L2 figures from its own events, and the stream\'s from both', () => {
  // r-a: d-1 killed, 1 of 1; one host fault over two work claims. r-b: neither of 2 killed; one
  // host fault over one work claim. The stream: 1 of 3, and 2 host faults over 3 work claims.
  const runs = [
    ['r-a', [claim('pull', 7), makerFailed(7), claim('pull', 8), ended('d-1', 100), killed('survivor.killed', 'd-1')]],
    ['r-b', [claim('pull', 9), l2Event('judge.withheld', 9, { role: 'reviewer', reason: 'no scratch', class: 'environment' }), ended('d-2', 100), ended('d-3', 100)]],
  ];
  assert.deepEqual(survivorRates(runs, 'r-a'), { run: [1, 1, 1], stream: [0.3333, 1, 3] });
  assert.deepEqual(survivorRates(runs, 'r-b').run, [0, 0, 2]);
  assert.deepEqual(hostFaultRates(runs, 'r-a'), { run: [0.5, 1, 2], stream: [0.6667, 2, 3] });
  assert.deepEqual(hostFaultRates(runs, 'r-b').run, [1, 1, 1]);
});

test('report\'s L1 and L2 figures do not change for an event or a field that no L1 or L2 signal reads', () => {
  const base = [claim('pull', 7), makerFailed(7), claim('pull', 8), ended('d-1', 100, { card: 7 }), ended('d-2', 100), killed('survivor.killed', 'd-1')];
  const noise = [
    { layer: 'L0', card: 7, event: 'call.end', fields: { system: 'git', operation: 'fetch', ms: 12, outcome: 'failed' } },
    { layer: 'L1', card: 8, dispatch: 'd-2', event: 'dispatch.start', fields: { command: 'agent' } },
    { layer: 'L3', card: 8, dispatch: 'd-2', event: 'dispatch', fields: { role: 'engineer', tier: 'standard' } },
    l2Event('attempt.decided', 7, { attempt: 1, decision: 'again' }),
    l2Event('review.escalate', 8, { category: 'ambiguous', raiser: 'loop', reason: 'x' }),
    claim('slot.release', 8),
    { layer: 'L1', card: 8, dispatch: 'd-2', event: 'dispatch.timeout', fields: { timeout: 1000 } },
  ];
  // The same events with fields no signal reads added to them.
  const fielded = base.map((event) => ({ ...event, fields: { ...event.fields, queueDepth: 3, folderLeft: [], kept: 'x' } }));
  const sections = (events) => {
    const out = reported([['r-a', events]]);
    return [section(out, 'L1'), section(out, 'L2')];
  };
  const expected = sections(base);
  assert.deepEqual([rateIn(under(expected[0], 'run r-a'), 'survivor rate'), rateIn(under(expected[1], 'run r-a'), 'host-fault rate')], [[0.5, 1, 2], [0.5, 1, 2]]);
  assert.deepEqual(sections([...base, ...noise]), expected);
  assert.deepEqual(sections(fielded), expected);
});
