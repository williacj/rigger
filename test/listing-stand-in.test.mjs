// ABOUTME: Tests the stand-in for `lsof` that names one process on cue: asked as L0's census of
// working directories asks, it prints what the real `lsof` prints of that process, and nothing once
// the process has gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listingOf } from './listing-stand-in.mjs';
import { alive, fixture, holding, tailIn, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// A bound on the test alone, so that a wait which never ends fails here rather than holding the
// suite: nothing waits on it once the process has gone.
const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** The real `lsof`, which the stand-in answers in place of. */
const LSOF = '/usr/sbin/lsof';

/** What the census asks `lsof`, of every process of this user or of `pids`, as `listing` in `src/substrate/process.mjs` asks it. */
const asked = (pids) => ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), ...(pids ? ['-p', pids.join(',')] : []), '-F', 'pun'];

/** The lines `printed` holds for the process `pid`, from its `p` line up to the next process's. */
function recordOf(printed, pid) {
  const lines = printed.split('\n').filter(Boolean);
  const from = lines.indexOf(`p${pid}`);
  if (from === -1) return [];
  const to = lines.findIndex((line, at) => at > from && line.startsWith('p'));
  return lines.slice(from, to === -1 ? undefined : to);
}

/** How `command` answers `args`: its exit status and what it printed. */
const answer = (command, args) => {
  const ran = spawnSync(command, args, { encoding: 'utf8', env: {} });
  return { status: ran.status, stdout: ran.stdout };
};

test('the listing stand-in prints of the process it names what lsof prints, asked of every process, of that one, or of it among others, and nothing of any other', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cwd = join(directory, 'work', 'sub');
  const pid = await tailIn(t, directory, cwd);
  writeFileSync(join(directory, 'outside.pid'), String(pid));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(cwd)));

  for (const pids of [undefined, [pid], [process.pid, pid]]) {
    const real = answer(LSOF, asked(pids));
    const standIn = answer(lsof, asked(pids));
    assert.equal(real.status, 0, `lsof listed nothing, asked ${asked(pids).join(' ')}`);
    assert.deepEqual({ status: standIn.status, lines: standIn.stdout.split('\n').filter(Boolean) }, { status: 0, lines: recordOf(real.stdout, pid) }, `asked ${asked(pids).join(' ')}`);
  }
  // Asked of another process alone, `lsof` lists that one, which the stand-in does not name.
  const other = answer(lsof, asked([process.pid]));
  assert.deepEqual(other, { status: 1, stdout: '' });
});

test('once the process it names has gone, the listing stand-in answers as lsof does of a pid no process holds: exit 1, printing nothing', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cwd = join(directory, 'work');
  const pid = await tailIn(t, directory, cwd);
  writeFileSync(join(directory, 'outside.pid'), String(pid));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(cwd)));
  process.kill(pid, 'SIGKILL');
  await until(() => !alive(pid), t);

  assert.deepEqual(answer(lsof, asked([pid])), answer(LSOF, asked([pid])));
  assert.deepEqual(answer(lsof, asked([pid])), { status: 1, stdout: '' });
  assert.deepEqual(recordOf(answer(lsof, asked()).stdout, pid), recordOf(answer(LSOF, asked()).stdout, pid));
});
