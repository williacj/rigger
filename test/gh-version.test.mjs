// ABOUTME: Tests the decision `doctor`'s gh version line makes from what `gh --version` answers:
// the forge adapter's read of gh's first line, and its comparison with the minimum Rigger requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { ghVersion } from '../src/cli/doctor.mjs';
import { GH_MINIMUM, readGhVersion } from '../src/substrate/forge/read.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { manualClock } from './clock-report-world.mjs';

/**
 * A stand-in for the read runner's spawn, answering `answer` and recording what it was sent.
 *
 * The shape of each answer is gh's own, measured on 2026-11-21 with gh 2.103.3 on macOS: `gh
 * --version` exits 0 and prints `gh version 2.103.3 (2026-10-26)` and then the release's URL on a
 * line of its own. The other versions below are that line with its numbers changed, which is what
 * the card's version boundary table asks about.
 */
function answering(answer) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 0, stderr: '', timedOut: false, ...answer };
  };
  send.sent = sent;
  return send;
}

/** What gh prints for the release `version`, as gh 2.103.3 printed its own. */
const printed = (version) => `gh version ${version} (2026-10-26)\nhttps://github.com/cli/cli/releases/tag/v${version}\n`;

/**
 * Rows V4 to V12 of the card's version boundary table, each with the verdict the card gives it:
 * `true` reaches the minimum, `false` falls below it, and `null` names no release to compare.
 * Written out by hand from the card, never from the comparison under test.
 */
const ROWS = [
  ['V4 a development build', { stdout: 'gh version DEV\n' }, null],
  ['V4 an empty output', { stdout: '' }, null],
  ['V4 a sign-in message', { stdout: 'To get started with GitHub CLI, please run:  gh auth login\n' }, null],
  ['V5 the minimum itself', { stdout: printed('2.97.0') }, true],
  ['V6 below by its minor', { stdout: printed('2.96.0') }, false],
  ['V6 below by its minor, at a high patch', { stdout: printed('2.96.9') }, false],
  ['V7 below by a minor with fewer digits', { stdout: printed('2.9.0') }, false],
  ['V7 below by its major', { stdout: printed('1.99.0') }, false],
  ['V8 above by its patch', { stdout: printed('2.97.1') }, true],
  ['V9 above by a minor with more digits', { stdout: printed('2.103.3') }, true],
  ['V10 above by its major', { stdout: printed('3.0.0') }, true],
  ['V11 a pre-release of the minimum', { stdout: 'gh version 2.97.0-rc.1\n' }, null],
  ['V11 a pre-release of a later release', { stdout: 'gh version 2.98.0-rc.1\n' }, null],
  ['V12 an update notice on standard error', { stdout: printed('2.97.1'), stderr: '\nA new release of gh is available: 2.97.1 → 2.103.3\n' }, true],
];

test('the gh version line reaches the minimum exactly where the version gh reports does, compared by number and never as text', async () => {
  // This test owns how gh's answer is parsed and compared. The defects it catches: the version
  // compared as text, which puts 2.103.3 below 2.97.0 (V9); a pre-release or a development
  // build read as a release (V4, V11); the first line read from standard error, where an update
  // notice can sit (V12); the minimum itself refused (V5); and a comparison against any minimum
  // but the one the forge adapter exports.
  assert.equal(GH_MINIMUM, '2.97.0', 'the card states the minimum as 2.97.0');
  for (const [row, answer, verdict] of ROWS) {
    const send = answering(answer);
    const line = await ghVersion({ ask: send });
    assert.equal(line.name, 'gh version', row);
    assert.equal(line.ok, verdict, `${row}: ${line.detail}`);
    assert.deepEqual(send.sent, [['gh', '--version']], row);
  }
});

/**
 * Runs `use` while L0's real host starts a scripted `gh` answering `stdout` and exiting 0, whose
 * group is gone once it exits, and puts the host back after. The child follows Node's documented
 * `ChildProcess` events and streams (`EventEmitter`, `PassThrough`), as `test/process-host.test.mjs`
 * scripts one. One manual clock is L0's host clock and `performance.now`, which the forge runner
 * times its call by, mocked through `t` as `test/kept-output.test.mjs` does, so no timer runs, no
 * real clock is read, and no process starts.
 */
async function withScriptedGh(t, stdout, use) {
  const started = [];
  const clock = manualClock();
  t.mock.method(performance, 'now', clock.now);
  const held = Object.fromEntries(['spawn', 'signal', 'clock'].map((name) => [name, Object.getOwnPropertyDescriptor(realHost, name)]));
  Object.defineProperty(realHost, 'clock', { value: { ...clock, pause: async () => {} }, configurable: true, enumerable: true, writable: true });
  Object.defineProperty(realHost, 'signal', { value: () => { throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' }); }, configurable: true, enumerable: true, writable: true });
  Object.defineProperty(realHost, 'spawn', {
    configurable: true,
    enumerable: true,
    get: () => (command, args) => {
      started.push([command, ...args]);
      const child = new EventEmitter();
      Object.assign(child, { pid: 999999999, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.stdout.end(stdout);
        child.stderr.end();
      });
      return child;
    },
  });
  try {
    return { result: await use(), started };
  } finally {
    for (const [name, descriptor] of Object.entries(held)) Object.defineProperty(realHost, name, descriptor);
  }
}

test('the version read records one forge read call.end, ok, for the gh it started through L0', async (t) => {
  // This test owns what the version read records. The read runner's spawn is where a forge
  // call's call.end is chosen and recorded (`ARCHITECTURE.md`, "L0's call events"); the defects
  // this catches are that record dropped, or carried on another side or with another outcome,
  // leaving the event stream without the call `doctor` made as it was made. The read runs as `doctor` runs it, with no
  // stand-in for the runner's spawn; L0's host is what is scripted.
  const events = [];
  const emitter = { emit: (event, fields) => { events.push({ event, ...fields }); } };

  const { result: read, started } = await withScriptedGh(t, printed('2.103.3'), () => readGhVersion({ emitter }));

  assert.equal(read.version, '2.103.3');
  assert.deepEqual(started, [['gh', '--version']]);
  const ends = events.filter(({ event }) => event === 'call.end').map(({ system, side, outcome }) => ({ system, side, outcome }));
  assert.deepEqual(ends, [{ system: 'forge', side: 'read', outcome: 'ok' }]);
});
