// ABOUTME: Tests process-table reads whose child exits before its output closes at the read deadline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../src/substrate/process.mjs';
import { TAIL, alive, fixture, heldOutput, holding, leave, read, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** Starts a census whose first process-table read closes only after its deadline. */
function cutCensus(t) {
  const directory = holding(t);
  const readTimeout = 300;
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));
  const cut = heldOutput(t, directory, 'printf "123"');
  const ps = fixture(directory, 'ps', [
    'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac',
    'if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const events = [];
  const settled = runCommand({ command, args: [], cwd: directory, env: {}, timeout: 15_000, ps, readTimeout, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });
  return { directory, cut, settled, events };
}

// proves R-STATE-12, R-STATE-19
test('a census read cut mid-row at its deadline is recorded as timed out', SETTLES_WITHIN, async (t) => {
  const { cut, settled, events } = cutCensus(t);
  await cut.started();
  await settled;

  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the group kill was not recorded: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-19
test('a timed-out read settles while the descendant still holds its output open', SETTLES_WITHIN, async (t) => {
  const { directory, settled, events } = cutCensus(t);
  await until(() => existsSync(join(directory, 'printed')), t);
  await settled;

  const holder = Number(read(directory, 'read-holders.pids'));
  assert.equal(alive(holder), true, 'the holder closed the output before the read settled');
  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the cut read was accepted: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-19
test('run keeps before-deadline failures and a fired nonzero read distinct from a held-output exit-0 timeout', SETTLES_WITHIN, async (t) => {
  for (const [failure, body, remove] of [
    ['SIGTERM', 'kill -TERM $$', false],
    ['ENOENT', 'exec /bin/ps "$@"', true],
  ]) {
    const directory = holding(t);
    const command = fixture(directory, 'command', leave(TAIL, 'survivor'));
    const ps = fixture(directory, 'ps', `case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac\n${body}`);
    const events = [];
    await runCommand({ command, args: [], cwd: directory, env: {}, timeout: 15_000, ps, readTimeout: 300, onGroup: remove ? () => unlinkSync(ps) : undefined, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });
    const unread = events.find(({ event }) => event === 'group.killed');
    assert.ok(unread, `${failure} did not fail the census: ${JSON.stringify(events)}`);
    assert.match(unread.census, new RegExp(failure));
  }

  const nonzeroDirectory = holding(t);
  const nonzeroCommand = fixture(nonzeroDirectory, 'command', leave(TAIL, 'survivor'));
  const nonzeroCut = heldOutput(t, nonzeroDirectory, 'printf "123"', 'exit 2');
  const nonzeroPs = fixture(nonzeroDirectory, 'ps', [
    'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac',
    'if /bin/mkdir "$here/first" 2>/dev/null; then',
    nonzeroCut.body,
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const nonzeroEvents = [];
  const nonzeroSettled = runCommand({ command: nonzeroCommand, args: [], cwd: nonzeroDirectory, env: {}, timeout: 15_000, ps: nonzeroPs, readTimeout: 300, emitter: { emit: (event, fields) => nonzeroEvents.push({ event, ...fields }) } });
  await nonzeroCut.started();
  await nonzeroSettled;
  const nonzeroUnread = nonzeroEvents.find(({ event }) => event === 'group.killed');
  assert.ok(nonzeroUnread, `the nonzero read was not recorded: ${JSON.stringify(nonzeroEvents)}`);
  assert.match(nonzeroUnread.census, /process-table read timed out after 300 ms/);

  const { cut, settled, events } = cutCensus(t);
  await cut.started();
  await settled;
  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the held output was taken as a complete read: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-19
test('a read just before the group kill cut at its deadline records the kill as unread', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const readTimeout = 300;
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));
  const cut = heldOutput(t, directory, 'printf "123"');
  const ps = fixture(directory, 'ps', [
    'case "$*" in "-g "*" -o pid=,stat=")',
    '  if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    '  fi',
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const events = [];

  const settled = runCommand({ command, args: [], cwd: directory, env: {}, timeout: 15_000, ps, readTimeout, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });
  await cut.started();
  await settled;

  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the group kill was not recorded: ${JSON.stringify(events)}`);
  assert.match(unread.census, /read of the group just before its kill failed[^]*process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-19
test('a read that writes standard error before its deadline is still timed out once the deadline fires', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const readTimeout = 300;
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));
  const cut = heldOutput(t, directory, 'printf "ps: failed" >&2');
  const ps = fixture(directory, 'ps', [
    'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac',
    'if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const events = [];

  const settled = runCommand({ command, args: [], cwd: directory, env: {}, timeout: 15_000, ps, readTimeout, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });
  await cut.started();
  await settled;

  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the group kill was not recorded: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-19
test('whole rows and the whole answer are timed out when their output closes after the deadline', SETTLES_WITHIN, async (t) => {
  for (const [shape, output] of [
    ['whole rows', '/bin/ps "$@" | /usr/bin/head -n 1'],
    ['whole answer', '/bin/ps "$@"'],
  ]) {
    const directory = holding(t);
    const readTimeout = 300;
    const command = fixture(directory, 'command', [leave(TAIL, 'one'), leave(TAIL, 'two')].join('\n'));
    const cut = heldOutput(t, directory, '');
    const ps = fixture(directory, 'ps', [
      'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac',
      'if /bin/mkdir "$here/first" 2>/dev/null; then',
      output,
      cut.body,
      'fi',
      'exec /bin/ps "$@"',
    ].join('\n'));
    const events = [];

    const settled = runCommand({ command, args: [], cwd: directory, env: {}, timeout: 15_000, ps, readTimeout, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });
    await cut.started();
    await settled;

    const unread = events.find(({ event }) => event === 'group.killed');
    assert.ok(unread, `${shape} was accepted as a complete answer: ${JSON.stringify(events)}`);
    assert.match(unread.census, /process-table read timed out after 300 ms/, shape);
  }
});

// proves R-STATE-12
test('startOf refuses an exit-0 read whose output stays open past the synchronous deadline', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const readTimeout = 300;
  const cut = heldOutput(t, directory, '');
  const ps = fixture(directory, 'ps', [
    'case "$*" in *lstart=*)',
    '  echo "$2" > "$here/group.pid"',
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, [
    '// ABOUTME: Runs the synchronous start-time read in a process the test can observe.',
    `import { runCommand } from ${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)};`,
    "import { writeFileSync } from 'node:fs';",
    `try { await runCommand({ command: '/usr/bin/tail', args: ['-f', ${JSON.stringify(join(directory, 'hold'))}], cwd: ${JSON.stringify(directory)}, env: {}, timeout: 15_000, ps: ${JSON.stringify(ps)}, readTimeout: ${readTimeout}, onGroup() {}, emitter: { emit() {} } }); writeFileSync(${JSON.stringify(join(directory, 'result'))}, 'resolved'); }`,
    `catch (error) { writeFileSync(${JSON.stringify(join(directory, 'result'))}, error.message); }`,
  ].join('\n'));
  const child = spawn(process.execPath, [caller], { cwd: directory, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });

  await cut.started();
  const [status] = await once(child, 'exit');

  assert.equal(status, 0, 'the caller failed before it recorded the start-time result');
  assert.match(readFileSync(join(directory, 'result'), 'utf8'), /timed out|ETIMEDOUT/i);
  assert.equal(alive(Number(read(directory, 'group.pid'))), false, 'the command was left alive after its start-time read failed');
});
