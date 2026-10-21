// ABOUTME: Checks process-group selection and zombie wait status against real OS processes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

import { PS } from '../src/substrate/process.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { until } from './process-fixtures.mjs';

const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** A direct child that creates a process group while retaining its parent's session. */
async function group(t) {
  const child = spawn('/usr/bin/perl', ['-e', '$|=1; setpgrp(0, 0); die "group: $!" if getpgrp != $$; print "$$\\n"; <>;'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill('SIGKILL');
    await closed;
  });
  const [ready] = await once(child.stdout, 'data');
  assert.equal(Number(ready.toString().trim()), child.pid);
  return child.pid;
}

// Regression for the real process-group reads used by restart cleanup.
test('the process table selects one process group without selecting its session', SETTLES_WITHIN, async (t) => {
  const selected = await group(t);
  const other = await group(t);
  const sessions = spawnSync('/bin/ps', ['-p', `${selected},${other}`, '-o', 'sess='], { encoding: 'utf8' });
  assert.equal(sessions.status, 0, sessions.stderr);
  const rows = sessions.stdout.trim().split('\n').map((row) => row.trim());
  assert.equal(rows.length, 2);
  assert.equal(rows[0], rows[1], 'the control process must share the selected group\'s session');

  const result = spawnSync(PS, ['-g', String(selected), '-o', 'pid='], { encoding: 'utf8', env: { PATH: '', LC_ALL: 'C.UTF-8' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\s+/).map(Number), [selected]);
});

// Regression for the real wait status carried into command results.
test('the process table reports an unreaped command exit as a hexadecimal wait status', SETTLES_WITHIN, async (t) => {
  const parent = spawn('/usr/bin/perl', ['-e', '$|=1; setpgrp(0, 0); my $child = fork // die $!; if (!$child) { exit 7; } print "$child\\n"; <>; waitpid($child, 0);'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const closed = once(parent, 'close');
  t.after(async () => {
    parent.stdin.end();
    await closed;
  });
  const [ready] = await once(parent.stdout, 'data');
  const child = Number(ready.toString().trim());
  await until(() => spawnSync('/bin/ps', ['-p', String(child), '-o', 'stat='], { encoding: 'utf8' }).stdout.startsWith('Z'), t);

  const result = spawnSync(PS, ['-g', String(parent.pid), '-o', 'pid=,stat=,xstat='], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const row = result.stdout.split('\n').map((line) => line.trim().split(/\s+/)).find(([pid]) => Number(pid) === child);
  assert.ok(row, 'the unreaped child was absent from its group');
  assert.equal(row[1][0], 'Z');
  assert.equal(row[2], '700', 'exit 7 must retain its POSIX wait status');
});
