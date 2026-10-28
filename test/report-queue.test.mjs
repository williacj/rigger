// ABOUTME: Tests the queue carried in `rigger report`'s L3 section: one line per L3 `pull` of each
// run, naming its card and `queueDepth`, over streams the tests write, through the verb in process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { report } from '../src/cli/report.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { repositoryIn } from './git-repository.mjs';

/** When every written run's clock starts: minute 0. */
const START = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Asks git as the guard's own `asked` does, answering its status and output, but without a process
 * group of its own, which the deterministic tier refuses to signal (`test/suite-guard.cjs`).
 */
const ask = (command, args) => {
  const ran = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  return { status: ran.status, timedOut: false, stdout: ran.stdout, stderr: ran.stderr };
};

/**
 * Writes `runs` into a new consumer's state directory through L5's real sink, then runs `report`
 * over that consumer in process and answers what it printed. Each run is a run id and its events
 * in order, each `[minute, layer, card, name, fields]`, recorded at `START` plus that minute.
 */
async function reported(runs) {
  const consumer = realpathSync(repositoryIn('rigger-report-queue-'));
  for (const [run, events] of runs) {
    let minute = 0;
    const sink = openSink({ directory: join(consumer, '.rigger'), run, now: () => START + minute * 60_000 });
    for (const [at, layer, card, name, fields] of events) {
      minute = at;
      sink.emitter({ layer, card }).emit(name, fields);
    }
    sink.end();
  }
  const ran = await report({ target: consumer, ask });
  assert.equal(ran.code, 0, ran.text);
  return ran.text;
}

/** The L3 section's lines, from below its heading up to the next unindented line. */
function l3Section(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('L3');
  assert.notEqual(start, -1, `no L3 section in:\n${text}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith(' '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The lines of run `run`'s block in the L3 section, below its heading, as printed. */
function block(text, run) {
  const lines = l3Section(text);
  const start = lines.findIndex((line) => line.startsWith(`  run ${run}: `));
  assert.notEqual(start, -1, `no L3 block for run ${run} in:\n${text}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith('    '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The line the card's output text gives a pull of card `card` that left `depth` cards unclaimed. */
const queueLine = (card, depth) => `    queue carried at the pull of card #${card}: ${depth}`;

/** The one line a run with no L3 `pull` shows for the queue carried. */
const NO_PULL = '    the run recorded no pull, so L3 has no queue carried for it';

/** An L3 `pull` under `card`, at `minute`, carrying `queueDepth` as L3's loop records it. */
const pull = (minute, card, queueDepth, inFlight = 1) => [minute, 'L3', card, 'pull', { kind: 'change', queueDepth, inFlight }];

/** An L3 `slot.release` under `card` at `minute`. */
const release = (minute, card) => [minute, 'L3', card, 'slot.release', {}];

/** An L3 `run.start` at `minute` recording N `concurrency`. */
const runStart = (minute, concurrency) => [minute, 'L3', undefined, 'run.start', { concurrency }];

/**
 * A run under N 2 over 60 minutes. By hand: #7 is pulled at 0 leaving 2 unclaimed, #8 at 0
 * leaving 1, #7 is released at 30 and #9 pulled leaving 0, and #8 and #9 are released at 60.
 */
const THREE_PULLS = [runStart(0, 2), pull(0, 7, 2), pull(0, 8, 1, 2), release(30, 7), pull(30, 9, 0, 2), release(60, 8), release(60, 9)];

test('report lists each L3 pull of a run, in line order, naming its card and queueDepth, after its throughput and utilization lines', async () => {
  const lines = block(await reported([['r-a', THREE_PULLS]]), 'r-a');
  assert.match(lines[0], /^    L3 throughput: /, lines.join('\n'));
  assert.match(lines[1], /^    L3 utilization: /, lines.join('\n'));
  assert.deepEqual(lines.slice(2), [queueLine(7, 2), queueLine(8, 1), queueLine(9, 0)]);
});

test('report shows 0 for each pull of a run whose pulls carry queueDepth 0', async () => {
  const lines = block(await reported([['r-a', [runStart(0, 1), pull(0, 4, 0), release(20, 4), pull(20, 5, 0), release(40, 5)]]]), 'r-a');
  assert.deepEqual(lines.slice(2), [queueLine(4, 0), queueLine(5, 0)]);
});

test('report shows one line saying a run with no L3 pull recorded none', async () => {
  const lines = block(await reported([['r-a', [runStart(0, 2), [30, 'L1', 7, 'dispatch.end', { exit: 0, ms: 10 }]]]]), 'r-a');
  assert.match(lines[0], /^    L3 throughput: /, lines.join('\n'));
  assert.match(lines[1], /^    L3 utilization: /, lines.join('\n'));
  assert.deepEqual(lines.slice(2), [NO_PULL]);
});

test('report lists the pulls of a run whose span is zero after the line saying the span is zero', async () => {
  const lines = block(await reported([['r-a', [runStart(0, 2), pull(0, 1, 1), pull(0, 2, 0, 2), release(0, 1), release(0, 2)]]]), 'r-a');
  assert.deepEqual(lines, ['    the span is zero, so L3 has no throughput and no utilization for this run', queueLine(1, 1), queueLine(2, 0)]);
});

test('report lists the pulls of a run that recorded no N after the line saying it has no utilization', async () => {
  const lines = block(await reported([['r-a', [pull(0, 1, 1), pull(0, 2, 0, 2), release(30, 1), release(60, 2)]]]), 'r-a');
  assert.match(lines[0], /^    L3 throughput: /, lines.join('\n'));
  assert.deepEqual(lines.slice(1), ['    the run recorded no N, so L3 has no utilization for it', queueLine(1, 1), queueLine(2, 0)]);
});

test('report lists the pull of a merge claim like any pull', async () => {
  // #8's pull is a merge claim: an L3 merge.start follows under #8 before its next pull.
  const lines = block(await reported([['r-a', [runStart(0, 1), pull(0, 7, 1), pull(0, 8, 0, 1), [5, 'L3', 8, 'merge.start', {}], release(30, 7)]]]), 'r-a');
  assert.deepEqual(lines.slice(2), [queueLine(7, 1), queueLine(8, 0)]);
});

test('report lists each run\'s queue lines from its own pulls only, and prints no queue figure across the stream', async () => {
  const text = await reported([
    ['r-a', THREE_PULLS],
    ['r-b', [runStart(0, 1), pull(0, 11, 4), release(10, 11), pull(10, 12, 3), release(20, 12)]],
    ['r-c', [runStart(0, 1), [15, 'L1', 7, 'dispatch.end', { exit: 0, ms: 10 }]]],
  ]);
  assert.deepEqual(block(text, 'r-a').slice(2), [queueLine(7, 2), queueLine(8, 1), queueLine(9, 0)]);
  assert.deepEqual(block(text, 'r-b').slice(2), [queueLine(11, 4), queueLine(12, 3)]);
  assert.deepEqual(block(text, 'r-c').slice(2), [NO_PULL]);
  const section = l3Section(text);
  assert.ok(!section.includes('  across the stream'), section.join('\n'));
  // Every queue line in the section is one of a run's, so none is a figure across the stream.
  const runLines = ['r-a', 'r-b', 'r-c'].flatMap((run) => block(text, run));
  assert.deepEqual(section.filter((line) => /queue/.test(line)), runLines.filter((line) => /queue/.test(line)));
  assert.equal(section.filter((line) => /queue/.test(line)).length, 6, section.join('\n'));
});

test('report does not read a pull recorded by a layer other than L3', async () => {
  const text = await reported([
    ['r-a', [runStart(0, 1), [0, 'L2', 7, 'pull', { kind: 'change', queueDepth: 5, inFlight: 1 }], [30, 'L1', 7, 'dispatch.end', { exit: 0, ms: 10 }]]],
    ['r-b', [runStart(0, 1), pull(0, 8, 1), [0, 'L1', 8, 'pull', { queueDepth: 9 }], release(30, 8)]],
  ]);
  assert.deepEqual(block(text, 'r-a').slice(2), [NO_PULL]);
  assert.deepEqual(block(text, 'r-b').slice(2), [queueLine(8, 1)]);
});

test('report\'s queue lines do not change for an event of another name, L3\'s pull trigger among them, or a field the signal does not read', async () => {
  const base = [runStart(0, 2), pull(0, 7, 2), pull(0, 8, 1, 2), release(30, 7), pull(30, 9, 0, 2), release(60, 8), release(60, 9)];
  const noise = [
    [0, 'L3', undefined, 'trigger', { trigger: 'pull' }],
    [10, 'L3', 7, 'dispatch', { role: 'engineer', tier: 'standard', queueDepth: 6 }],
    [20, 'L2', 8, 'maker.failed', { class: 'environment', reason: 'spawn ENOENT', queueDepth: 7 }],
    [40, 'L3', undefined, 'trigger', { trigger: 'drain' }],
  ];
  // The same pulls with fields the signal does not read added to them.
  const fielded = base.map(([minute, layer, card, name, fields]) => [minute, layer, card, name, name === 'pull' ? { ...fields, kept: 'x', depth: 99 } : fields]);
  const expected = [queueLine(7, 2), queueLine(8, 1), queueLine(9, 0)];
  const queue = async (events) => block(await reported([['r-a', events]]), 'r-a').filter((line) => line.startsWith('    queue carried'));
  assert.deepEqual(await queue(base), expected);
  assert.deepEqual(await queue([...noise.slice(0, 1), ...base.slice(0, 3), ...noise.slice(1), ...base.slice(3)]), expected);
  assert.deepEqual(await queue(fielded), expected);
});
