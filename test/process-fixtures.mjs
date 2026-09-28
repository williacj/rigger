// ABOUTME: Fixtures for tests that start real processes: a scratch directory torn down with every
// process naming it, shell scripts that live in it, children they leave alive or that outlive a
// timeout, reads of what those scripts leave behind and of a process's start time, a standard error
// nothing drains, and a wait on a condition.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, constants as files, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A scratch directory for one test, torn down with every process that names it.
 *
 * Every fixture process a test starts carries the directory's path in its command line, so the
 * teardown finds each one by it, whether the test passed or failed, and whatever the code under
 * test did.
 */
export function scratch(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rigger-process-')));
  // Until none is left, because a fixture that forks can start one while `pkill` is at work.
  t.after(() => {
    while (running(directory).length > 0) spawnSync('/usr/bin/pkill', ['-KILL', '-f', literally(directory)]);
  });
  return directory;
}

/**
 * Both ends of a FIFO in `directory`, for a standard error whose reader stays open and drains only
 * when the test reads `reader`, which is non-blocking. A child is handed `writer`. Both ends close
 * at the test's teardown, whether it passed or failed.
 */
export function undrained(t, directory) {
  const path = join(directory, 'undrained');
  execFileSync('/usr/bin/mkfifo', [path]);
  // The read end is opened first, and without blocking, so the write end's open finds a reader.
  const reader = openSync(path, files.O_RDONLY | files.O_NONBLOCK);
  const writer = openSync(path, files.O_WRONLY);
  t.after(() => {
    closeSync(writer);
    closeSync(reader);
  });
  return { reader, writer };
}

/** `text` as a pattern `pgrep` and `pkill` match only as written. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pid of every process whose command line holds `text`. */
export const running = (text) => spawnSync('/usr/bin/pgrep', ['-f', literally(text)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/**
 * A shell script named `name` in `directory`, executable, whose body reads that directory as
 * `$here`. Its path, and so the directory, is in the command line of the shell running it.
 */
export function fixture(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\nhere=\${0%/*}\n${body}\n`, { mode: 0o755 });
  return path;
}

/** What a fixture wrote to `name` in `directory`, trimmed. */
export const read = (directory, name) => readFileSync(join(directory, name), 'utf8').trim();

/**
 * The start time `ps` reads for `pid`, in whole seconds since the epoch. `ps` is given UTC, and
 * the text it prints is parsed by `Date.parse` as a date in UTC, so no local zone enters it.
 */
export function startOf(pid) {
  const printed = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' }, encoding: 'utf8' });
  const seconds = Date.parse(`${printed.trim()} UTC`) / 1000;
  if (!Number.isInteger(seconds)) throw new Error(`ps printed a start time this cannot read: ${JSON.stringify(printed)}`);
  return seconds;
}

/**
 * One turn of the event loop, for a wait inside the test `t`. It throws once `t` has ended, passed,
 * failed or timed out, so a wait whose condition never holds ends with its test rather than
 * holding the test file's process open.
 */
export async function turn({ signal }) {
  if (signal.aborted) throw new Error('the test ended before the condition this wait was on held', { cause: signal.reason });
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Settles once `condition` holds, checked once per turn of the event loop, and rejects once the
 * test `t` has ended without it. `t` is read before `condition` is, so a call that names no test
 * fails even where the condition already holds.
 */
export async function until(condition, { signal }) {
  while (!condition()) await turn({ signal });
}

/** Whether a process `pid` names is alive: signal 0 reaches it. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/** `length` bytes that step through every byte value, so they hold bytes no UTF-8 text allows. */
export const bytes = (length, step) => Buffer.from(Array.from({ length }, (_, i) => (i * step) % 256));

/**
 * The lines of a fixture that start `program` in the background, holding the command's standard
 * output and standard error, and write its pid to `$here/<name>.pid`. `program` runs until it is
 * killed, and names the scratch directory in its command line.
 *
 * The lines then wait until the background process runs the executable `image`, as `ps` reads
 * it, or has ended. Until then it can still be the shell that forked it, and a census taken then
 * names the shell.
 */
export const leave = (program, name, image = 'tail') => [
  `${program} &`,
  `echo $! > "$here/${name}.pid"`,
  `while kill -0 $! 2>/dev/null && ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -qx '${image} *'; do :; done`,
].join('\n');

/** A survivor that runs until killed: `tail` following a file nothing writes to. */
export const TAIL = '/usr/bin/tail -f "$here/hold"';

/** A scratch directory holding the file `TAIL` follows. */
export function holding(t) {
  const directory = scratch(t);
  writeFileSync(join(directory, 'hold'), '');
  return directory;
}

/**
 * The timeout each test of a command outliving it passes. A judgment: it is the time the fixture
 * has to be ready before the timeout ends it, and `ready` fails the test where it was not. Its
 * premise is a measurement: over 40 calls of this adapter each, with Node 26.5.0 on macOS 27.0 on
 * 2026-09-27 and nothing else running, the fixture writing 300,001 bytes was ready 6.7 to 10.5 ms
 * after the call, and the one whose child writes to both streams 10.8 to 13.8 ms after it. The
 * second fixture took 51 to 1,481 ms while it exec'd its child's freshly written script, so it
 * runs that script under `/bin/sh` by name.
 */
export const OUTLIVED = 1_000;

/**
 * A command that runs `body`, which starts at least one child, then writes its pid to
 * `$here/command.pid`, marks `$here/ready`, and waits on its children, which run until killed. It
 * is run by `/bin/bash` by name, so the process the adapter starts is `bash` from its first line.
 */
export function outliving(directory, body) {
  const script = fixture(directory, 'command', [body, 'echo $$ > "$here/command.pid"', ': > "$here/ready"', 'wait'].join('\n'));
  return { command: '/bin/bash', args: [script], timeout: OUTLIVED };
}

/**
 * An `L0` emitter for a call whose command leaves nothing behind, as the fake `gh` leaves nothing.
 * It refuses every event, so a kill L0 makes anyway rejects the call as an unrecorded kill, naming
 * the process, and the test fails on it rather than passing over it.
 */
export const UNKILLED = {
  emit(event, fields) {
    throw new Error(`this test's command leaves no process behind, and L0 recorded ${event} ${JSON.stringify(fields)}`);
  },
};

/** Fails the test where the timeout ended an `outliving` command before it was ready. */
export const ready = (directory) => assert.ok(existsSync(join(directory, 'ready')), `the timeout of ${OUTLIVED} ms ended the command before it was ready`);
