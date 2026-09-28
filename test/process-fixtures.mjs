// ABOUTME: Fixtures for tests that start real processes: a scratch directory torn down with every
// process naming it, shell scripts that live in it, children they leave alive or that outlive a
// timeout, and reads of what those scripts leave behind.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

/** Fails the test where the timeout ended an `outliving` command before it was ready. */
export const ready = (directory) => assert.ok(existsSync(join(directory, 'ready')), `the timeout of ${OUTLIVED} ms ended the command before it was ready`);
