// ABOUTME: Fixtures for tests that start real processes: a scratch directory torn down with every
// process naming it, shell scripts that live in it, reads of what those scripts leave behind and
// of a process's start time, and a wait on a condition.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

/** Settles once `condition` holds, checked once per turn of the event loop. */
export async function until(condition) {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
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
