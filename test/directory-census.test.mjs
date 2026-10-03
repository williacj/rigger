// ABOUTME: Tests the working-directory census: once L0 has ended a dispatch's group, it ends every
// process of Rigger's own user working in the dispatch's directory, records each, and leaves alone
// every process working anywhere else, and every command that is not a dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openSink, readEvents } from '../src/observation/sink.mjs';
import { readGroups, writeGroups } from '../src/execution/groups.mjs';
import { dispatch, killRecordedGroups } from '../src/execution/run.mjs';
import { EVENT_REFUSED, NOT_STARTED, runCommand } from '../src/substrate/process.mjs';
import { TAIL, alive, assertUntouched, fixture, gone, holding, leave, leaveWorking, read, tailIn, until, warmed } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// A bound on the test alone, so that a dispatch which never settles fails here rather than
// holding the suite: nothing waits on it when the dispatch settles.
const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** A timeout no command here reaches unless its test means it to, under `SETTLES_WITHIN`. */
const UNREACHED = 15_000;

/** A command in `directory` that leaves a `tail` working in `sub/` outside its group, then exits 0. */
const leavingInSub = (directory) => fixture(directory, 'command', `${leaveWorking('sub', 'left')}\nexit 0`);

/**
 * A command in `directory` that leaves a `tail` working in `sub/` outside its group, marks `ready`,
 * and then runs until the test writes `release`, or until killed.
 */
const holdingInSub = (directory) => fixture(directory, 'command', [
  'echo $$ > "$here/command.pid"',
  leaveWorking('sub', 'left'),
  ': > "$here/ready"',
  'while [ ! -f "$here/release" ]; do :; done',
].join('\n'));

/** The state directory a test's dispatches name: `.rigger/` in the scratch directory. */
const stateOf = (directory) => join(directory, '.rigger');

/** Starts a dispatch through L1's function in the workspace `directory`, its state directory inside it. */
function dispatchIn(directory, options) {
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return dispatch({ directory: state, sink, args: [], cwd: directory, workspace: directory, env: {}, timeout: UNREACHED, ...options });
}


// proves R-STATE-17, R-STATE-7
test('given a dispatch whose command starts a process that leaves its group, working under the dispatch\'s directory, and then exits 0, that process is not alive when the dispatch settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const result = await dispatchIn(directory, { id: 'd-census', card: 1412, command: leavingInSub(directory) });

  assert.equal(result.exit, 0);
  assert.equal(alive(Number(read(directory, 'left.pid'))), false, 'the process working under the dispatch\'s directory is alive');
});

// proves R-STATE-17, R-STATE-12
test('given a dispatch whose command starts a process that leaves its group, working under the dispatch\'s directory, and then exits 0, the stream records that process\'s kill under the dispatch\'s id and card, naming its process name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  await dispatchIn(directory, { id: 'd-census', card: 1412, command: leavingInSub(directory) });

  const left = Number(read(directory, 'left.pid'));
  // The name is the executable the fixture ran, and the command line the arguments it gave, each
  // read off the fixture rather than asked of `ps`.
  const kills = readEvents(stateOf(directory)).filter((event) => event.layer === 'L0' && event.pid === left);
  assert.deepEqual(kills.map(({ event, name, cmd, dispatch: id, card }) => ({ event, name, cmd, id, card })), [
    { event: 'survivor.killed', name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold`, id: 'd-census', card: 1412 },
  ]);
});

// proves R-STATE-17, R-STATE-8
test('given a dispatch that outlives its timeout and has started a process that leaves its group, working under the dispatch\'s directory, that process is not alive when the dispatch settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // Warmed, so the first exec's hold does not spend the time the command has to be ready.
  const command = warmed(holdingInSub(directory));

  const result = await dispatchIn(directory, { id: 'd-census', card: 1412, command, timeout: 3_000 });

  assert.ok(existsSync(join(directory, 'ready')), 'the timeout ended the command before it had left its process, so the test proves nothing');
  assert.equal(result.timedOut, true);
  assert.equal(alive(Number(read(directory, 'left.pid'))), false, 'the process working under the dispatch\'s directory is alive');
});

// proves R-STATE-17
test('while a dispatch runs, its record entry carries the dispatch\'s directory', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const settled = dispatchIn(directory, { id: 'd-census', card: 1412, command: holdingInSub(directory) });
  await until(() => existsSync(join(directory, 'ready')), t);

  const group = Number(read(directory, 'command.pid'));
  const entries = readGroups(stateOf(directory)).filter((entry) => entry.group === group);
  writeFileSync(join(directory, 'release'), '');
  await settled;

  assert.deepEqual(entries.map((entry) => entry.workspace), [realpathSync.native(directory)]);
});

// proves R-STATE-17
test('given a process outside every group Rigger created, working in a sibling of the dispatch\'s directory whose name begins with that directory\'s name, the census leaves it alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const workspace = join(directory, 'work');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'hold'), '');
  const sibling = await tailIn(t, directory, join(directory, 'work-sibling'));

  await dispatchIn(workspace, { id: 'd-census', card: 1412, command: leavingInSub(workspace) });

  assert.equal(alive(Number(read(workspace, 'left.pid'))), false, 'the census did not end the process in the dispatch\'s directory, so the test proves nothing');
  assertUntouched(sibling, 'the process working in the sibling directory');
});

// proves R-STATE-17
test('given a dispatch\'s directory named through a symbolic link, a process working under the directory the link resolves to is ended', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  mkdirSync(join(directory, 'real'));
  symlinkSync(join(directory, 'real'), join(directory, 'link'));
  const under = await tailIn(t, directory, join(directory, 'real', 'sub'));

  const result = await dispatchIn(join(directory, 'link'), { id: 'd-census', card: 1412, command: '/usr/bin/true' });

  assert.equal(result.exit, 0);
  assert.equal(alive(under), false, 'the process working under the directory the link resolves to is alive');
});

// proves R-STATE-17
test('given a command run through L0\'s adapter that is not a dispatch, a process outside its group working under the command\'s working directory is left alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const events = [];

  const result = await runCommand({ command: leavingInSub(directory), args: [], cwd: directory, env: {}, timeout: UNREACHED, emitter: { emit: (event, fields) => events.push({ event, ...fields }) } });

  assert.equal(result.exit, 0);
  assertUntouched(Number(read(directory, 'left.pid')), 'the process working under the command\'s working directory');
});

// proves R-STATE-17
test('given two dispatches running at once, each in its own directory, ending one leaves alive every process under the other\'s directory', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const [first, second] = ['first', 'second'].map((name) => {
    const workspace = join(directory, name);
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'hold'), '');
    const command = holdingInSub(workspace);
    const settled = dispatch({ id: `d-${name}`, card: 1412, directory: state, sink, command, args: [], cwd: workspace, workspace, env: {}, timeout: UNREACHED });
    return { workspace, settled };
  });
  await until(() => existsSync(join(first.workspace, 'ready')) && existsSync(join(second.workspace, 'ready')), t);

  writeFileSync(join(first.workspace, 'release'), '');
  await first.settled;

  assert.equal(alive(Number(read(first.workspace, 'left.pid'))), false, 'the census did not end the process under the first directory, so the test proves nothing');
  assertUntouched(Number(read(second.workspace, 'left.pid')), 'the process under the second dispatch\'s directory');
  assertUntouched(Number(read(second.workspace, 'command.pid')), 'the second dispatch\'s command');
  writeFileSync(join(second.workspace, 'release'), '');
  await second.settled;
});

/**
 * Starts a dispatch holding the scratch directory, then a second dispatch in `held` of it, and
 * asserts that the second starts no process, fails naming its directory, and changes nothing.
 */
async function refusedWhileHeld(t, held) {
  const directory = holding(t);
  const running = dispatchIn(directory, { id: 'd-first', card: 1412, command: holdingInSub(directory) });
  await until(() => existsSync(join(directory, 'ready')), t);
  const workspace = held(directory);
  const before = readGroups(stateOf(directory));
  const marker = fixture(directory, 'second', ': > "$here/second-ran"');

  const refused = await dispatchIn(directory, { id: 'd-second', card: 1413, command: marker, cwd: workspace, workspace }).then(() => undefined, (error) => error);

  assert.ok(refused, 'the second dispatch settled');
  assert.equal(refused.code, NOT_STARTED, refused.message);
  assert.ok(refused.message.includes(`its directory ${realpathSync.native(workspace)} is held by dispatch d-first`), refused.message);
  assert.equal(existsSync(join(directory, 'second-ran')), false, 'the second dispatch\'s command ran');
  assert.deepEqual(readGroups(stateOf(directory)), before, 'the record changed');
  assertUntouched(Number(read(directory, 'command.pid')), 'the first dispatch\'s command');
  assertUntouched(Number(read(directory, 'left.pid')), 'the process under the first dispatch\'s directory');
  writeFileSync(join(directory, 'release'), '');
  await running;
}

// proves R-STATE-17
test('given a second dispatch started while a running dispatch holds the same directory, the second starts no process, fails naming the directory, and changes nothing', SETTLES_WITHIN, (t) => refusedWhileHeld(t, (directory) => directory));

// proves R-STATE-17
test('given a second dispatch started in a directory under one a running dispatch holds, the second starts no process, fails naming the directory, and changes nothing', SETTLES_WITHIN, (t) => refusedWhileHeld(t, (directory) => join(directory, 'sub')));

// proves R-STATE-17
test('given a census read that never answers, the dispatch\'s call still settles, no process of its group is alive when it does, and the stream records that the directory\'s census could not be read, naming the directory', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  writeFileSync(join(directory, 'lsof-hold'), '');
  const lsof = warmed(fixture(directory, 'lsof', ': > "$here/lsof-asked"\nexec /usr/bin/tail -f "$here/lsof-hold"'));
  const command = fixture(directory, 'command', `${leave(TAIL, 'child')}\nexit 0`);

  const result = await dispatchIn(directory, { id: 'd-census', card: 1412, command, lsof, readTimeout: 2_000 });

  assert.equal(result.exit, 0);
  assert.ok(existsSync(join(directory, 'lsof-asked')), 'the census never asked the stand-in, so the test proves nothing');
  assert.equal(alive(Number(read(directory, 'child.pid'))), false, 'a process of the dispatch\'s group is alive');
  const unread = readEvents(stateOf(directory)).filter((event) => event.event === 'directory.unread');
  assert.deepEqual(unread.map(({ layer, dispatch: id, card, directory: named }) => ({ layer, id, card, named })), [
    { layer: 'L0', id: 'd-census', card: 1412, named: realpathSync.native(directory) },
  ]);
});

// proves R-STATE-17, R-STATE-12
test('given a sink that refuses every append, every process the census found is not alive after the call, and the call rejects naming each unrecorded kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const refusing = { emit: () => { throw new Error('the test\'s sink refuses every append'); } };

  const refused = await runCommand({ command: leavingInSub(directory), args: [], cwd: directory, directory, env: {}, timeout: UNREACHED, emitter: refusing }).then(() => undefined, (error) => error);

  const left = Number(read(directory, 'left.pid'));
  assert.equal(alive(left), false, 'the process the census found is alive');
  assert.ok(refused, 'the call resolved');
  assert.equal(refused.code, EVENT_REFUSED, refused.message);
  assert.match(refused.message, new RegExp(`survivor\\.killed \\{"pid":${left},"name":"tail"`));
});

// proves R-STATE-17
test('given a census tool that lists every process as another user\'s, the census leaves alive a process working under the dispatch\'s directory', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `lsof` itself, asked as the census asks it, with every user id it prints made root's.
  const lsof = warmed(fixture(directory, 'lsof', ': > "$here/lsof-asked"\n/usr/sbin/lsof "$@" | /usr/bin/sed \'s/^u[0-9]*$/u0/\''));

  await dispatchIn(directory, { id: 'd-census', card: 1412, command: leavingInSub(directory), lsof });

  assert.ok(existsSync(join(directory, 'lsof-asked')), 'the census never asked the stand-in, so the test proves nothing');
  assertUntouched(Number(read(directory, 'left.pid')), 'the process listed as another user\'s');
});

// proves R-STATE-17
test('given a dispatch\'s directory whose real path holds a character the census cannot read back, the command never starts, and the call fails naming the directory', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const unreadable = join(directory, 'caret^A');
  mkdirSync(unreadable);
  const marker = fixture(directory, 'command', ': > "$here/ran"');

  const refused = await runCommand({ command: marker, args: [], cwd: unreadable, directory: unreadable, env: {}, timeout: UNREACHED, emitter: { emit() {} } }).then(() => undefined, (error) => error);

  assert.ok(refused, 'the call resolved');
  assert.equal(refused.code, NOT_STARTED, refused.message);
  assert.ok(refused.message.includes(unreadable), refused.message);
  assert.equal(existsSync(join(directory, 'ran')), false, 'the command ran');
});

/** The URL of the module at `path`, relative to this file, as a string literal. */
const moduleAt = (path) => JSON.stringify(new URL(path, import.meta.url).href);

/**
 * A caller of its own: a Node process that dispatches `command` through L1's function in the
 * workspace given as its first argument, reading working directories through the `lsof` given as
 * its third where there is one, with its state directory inside it, ends its sink at its exit, and
 * then waits until it is signalled.
 */
const CALLER = [
  `import { openSink } from ${moduleAt('../src/observation/sink.mjs')};`,
  `import { dispatch } from ${moduleAt('../src/execution/run.mjs')};`,
  `import { atExit } from ${moduleAt('../src/substrate/process.mjs')};`,
  "import { join } from 'node:path';",
  'const [directory, command, lsof] = process.argv.slice(2);',
  "const state = join(directory, '.rigger');",
  "const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });",
  'atExit(sink.end);',
  "dispatch({ id: 'd-term', card: 7, directory: state, sink, command, args: [], cwd: directory, workspace: directory, env: {}, timeout: 600_000, lsof: lsof || undefined }).catch(() => {});",
  'setInterval(() => {}, 1_000);',
].join('\n');

/**
 * Starts `CALLER` in `directory` on `command`, through `lsof` where it is given, waits until the
 * command marks `ready`, sends the caller SIGTERM, and settles once it has ended, on the signal that
 * ended it and what it wrote to standard error. Its command line names the scratch directory, so
 * the teardown ends it whatever the test did.
 */
async function terminated(t, directory, command, lsof = '') {
  writeFileSync(join(directory, 'caller.mjs'), CALLER);
  const caller = spawn(process.execPath, [join(directory, 'caller.mjs'), directory, command, lsof], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => caller.kill('SIGKILL'));
  let said = '';
  caller.stderr.on('data', (chunk) => { said += chunk; });
  const exited = once(caller, 'exit');
  await until(() => existsSync(join(directory, 'ready')) || caller.exitCode !== null, t);
  assert.ok(existsSync(join(directory, 'ready')), `the caller ended before its dispatch was up: ${said}`);
  caller.kill('SIGTERM');
  const [, signal] = await exited;
  return { signal, said };
}

// proves R-STATE-17, R-STATE-9
test('given a dispatch running with a process that left its group, working under the dispatch\'s directory, when the calling process receives SIGTERM, that process is not alive afterwards', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { signal, said } = await terminated(t, directory, holdingInSub(directory));

  assert.equal(signal, 'SIGTERM', said);
  const left = Number(read(directory, 'left.pid'));
  // The system reaps it once its kill lands, since its parent has exited, so the wait is on that.
  assert.equal(await gone(left), true, 'the process working under the dispatch\'s directory is alive');
  const kills = readEvents(stateOf(directory)).filter((event) => event.event === 'survivor.killed' && event.pid === left);
  assert.equal(kills.length, 1, `the cleanup did not record the process's kill: ${said}`);
});

/**
 * The program of a process P that leaves the command's group and works in `$here/sub`, writes its
 * pid to `p.pid`, and waits until the census has listed it, which the stand-in `listingOnce` marks
 * as `go`. It then forks Q, which works in `sub/` too, writes its pid to `q.pid` and runs `tail`
 * until killed, and exits once Q has written it. So Q is in no list the census made before P exited.
 */
const HOPPER = [
  'my $h = $ARGV[0]; setpgrp(0, 0) or die "leave: $!"; chdir "$h/sub" or die "chdir: $!";',
  'open(my $p, ">", "$h/p.pid.tmp") or die; print $p $$; close $p; rename "$h/p.pid.tmp", "$h/p.pid" or die;',
  '1 until -e "$h/go";',
  'my $q = fork // die "fork: $!";',
  'if (!$q) { open(my $f, ">", "$h/q.pid.tmp") or die; print $f $$; close $f; rename "$h/q.pid.tmp", "$h/q.pid" or die; exec "/usr/bin/tail", "-f", "$h/hold"; }',
  '1 until -e "$h/q.pid"; exit 0;',
].join(' ');

/** The lines of a fixture that start P (`HOPPER`) in the background, and wait until it is working in `sub/`. */
const hopping = ['/bin/mkdir -p "$here/sub"', `/usr/bin/perl -e '${HOPPER}' "$here" &`, 'while [ ! -f "$here/p.pid" ]; do :; done'].join('\n');

/**
 * A stand-in for `lsof` in `directory` whose first answer is the real `lsof`'s, kept in
 * `first-listing`, and given back only once P, which that answer lists, has exited and been reaped,
 * having forked Q. Every later call is the real `lsof`. It is warmed, so its first exec is not held
 * past a read's timeout.
 */
const listingOnce = (directory) => warmed(fixture(directory, 'lsof', [
  'if [ ! -f "$here/listed" ]; then',
  '  /usr/sbin/lsof "$@" > "$here/first-listing"; status=$?',
  '  : > "$here/listed"; : > "$here/go"',
  '  p=$(/bin/cat "$here/p.pid")',
  '  while kill -0 "$p" 2>/dev/null; do :; done',
  '  /bin/cat "$here/first-listing"; exit $status',
  'fi',
  'exec /usr/sbin/lsof "$@"',
].join('\n')));

/**
 * Asserts that the census's first list in `directory` named P and not Q, so Q was forked after it,
 * and that Q has gone, its kill recorded as `killed` in the stream in `state`.
 */
async function assertSuccessorEnded(directory, state, killed) {
  const [p, q] = ['p', 'q'].map((name) => Number(read(directory, `${name}.pid`)));
  const first = read(directory, 'first-listing').split('\n');
  assert.ok(first.includes(`p${p}`) && !first.includes(`p${q}`), `the census's first list did not name P alone, so the test proves nothing: ${first.join(' ')}`);
  assert.equal(await gone(q), true, 'the process P forked in the directory after the census listed P is alive');
  assert.deepEqual(readEvents(state).filter((event) => event.pid === q).map(({ event, name }) => ({ event, name })), [{ event: killed, name: 'tail' }]);
}

// proves R-STATE-17, R-STATE-7
test('given a dispatch exiting 0 whose process outside its group, once the census has listed it, forks a successor in the dispatch\'s directory and exits before the census stops it, the successor is not alive when the dispatch settles, and its kill is recorded', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `${hopping}\nexit 0`);

  await dispatchIn(directory, { id: 'd-census', card: 1412, command, lsof: listingOnce(directory) });

  await assertSuccessorEnded(directory, stateOf(directory), 'survivor.killed');
});

// proves R-STATE-17, R-STATE-8
test('given a dispatch outliving its timeout whose process outside its group, once the census has listed it, forks a successor in the dispatch\'s directory and exits before the census stops it, the successor is not alive when the dispatch settles, and its kill is recorded', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = warmed(fixture(directory, 'command', `${hopping}\n: > "$here/ready"\nexec /usr/bin/tail -f "$here/hold"`));

  const result = await dispatchIn(directory, { id: 'd-census', card: 1412, command, lsof: listingOnce(directory), timeout: 3_000 });

  assert.ok(existsSync(join(directory, 'ready')), 'the timeout ended the command before it had started P, so the test proves nothing');
  assert.equal(result.timedOut, true);
  await assertSuccessorEnded(directory, stateOf(directory), 'survivor.killed');
});

// proves R-STATE-17, R-STATE-9
test('given a dispatch whose process outside its group, once the exit cleanup\'s census has listed it, forks a successor in the dispatch\'s directory and exits before the census stops it, the successor is not alive after the caller receives SIGTERM, and its kill is recorded', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `${hopping}\n: > "$here/ready"\nexec /usr/bin/tail -f "$here/hold"`);

  const { signal, said } = await terminated(t, directory, command, listingOnce(directory));

  assert.equal(signal, 'SIGTERM', said);
  await assertSuccessorEnded(directory, stateOf(directory), 'survivor.killed');
});

// proves R-STATE-17, R-STATE-10
test('given a recorded dispatch whose process, once a start\'s census has listed it, forks a successor in the dispatch\'s directory and exits before the census stops it, the start leaves the successor not alive, and records its kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const state = stateOf(directory);
  // A group no process holds any longer, as a dead engine's emptied group is left.
  const leader = spawnSync('/usr/bin/true');
  const { dev, ino } = statSync(realpathSync.native(directory), { bigint: true });
  writeGroups(state, [{ group: leader.pid, started: 0, dispatch: 'd-dead', card: 1412, workspace: realpathSync.native(directory), device: String(dev), inode: String(ino) }]);
  spawnSync('/bin/sh', [fixture(directory, 'hop', `${hopping}\nexit 0`)], { stdio: 'ignore' });
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });

  await killRecordedGroups({ directory: state, sink, lsof: listingOnce(directory) });

  await assertSuccessorEnded(directory, state, 'recorded.killed');
});

// proves R-STATE-17
test('given a process outside every group Rigger created whose working directory is the dispatch\'s directory itself, it is not alive when the dispatch settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const at = await tailIn(t, directory, directory);

  await dispatchIn(directory, { id: 'd-census', card: 1412, command: '/usr/bin/true' });

  assert.equal(alive(at), false, 'the process working in the dispatch\'s directory itself is alive');
});

// proves R-STATE-17
test('given a census whose read fails after it has stopped a process it listed in the dispatch\'s directory, the call settles leaving no process stopped, and records that the census could not be read', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const under = await tailIn(t, directory, join(directory, 'sub'));
  writeFileSync(join(directory, 'lsof-hold'), '');
  // The first list is the real `lsof`'s, and every later read never answers.
  const lsof = warmed(fixture(directory, 'lsof', 'if [ -f "$here/listed" ]; then exec /usr/bin/tail -f "$here/lsof-hold"; fi\n: > "$here/listed"\nexec /usr/sbin/lsof "$@"'));

  await dispatchIn(directory, { id: 'd-census', card: 1412, command: '/usr/bin/true', lsof, readTimeout: 2_000 });

  assert.ok(existsSync(join(directory, 'listed')), 'the census never listed the directory, so the test proves nothing');
  assertUntouched(under, 'the process the census listed before its read failed');
  assert.equal(readEvents(stateOf(directory)).filter((event) => event.event === 'directory.unread').length, 1);
});

// proves R-STATE-17
test('while a dispatch runs, its record entry carries the device and inode of its directory\'s real path', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const settled = dispatchIn(directory, { id: 'd-census', card: 1412, command: holdingInSub(directory) });
  await until(() => existsSync(join(directory, 'ready')), t);

  const group = Number(read(directory, 'command.pid'));
  const entries = readGroups(stateOf(directory)).filter((entry) => entry.group === group);
  const { dev, ino } = statSync(realpathSync.native(directory), { bigint: true });
  writeFileSync(join(directory, 'release'), '');
  await settled;

  assert.deepEqual(entries.map(({ device, inode }) => ({ device, inode })), [{ device: String(dev), inode: String(ino) }]);
});

// proves R-STATE-17, R-STATE-7
test('given a dispatch whose command removes its own directory and makes it again at the same path, leaving there a process outside its group, that process is not alive when the dispatch settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const workspace = join(directory, 'work');
  mkdirSync(workspace);
  const before = statSync(workspace, { bigint: true }).ino;
  const command = fixture(directory, 'command', ['cd /', '/bin/rm -rf "$here/work"', '/bin/mkdir "$here/work"', leaveWorking('work', 'left'), 'exit 0'].join('\n'));
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });

  const result = await dispatch({ id: 'd-census', card: 1412, directory: state, sink, command, args: [], cwd: workspace, workspace, env: {}, timeout: UNREACHED });

  assert.equal(result.exit, 0);
  assert.notEqual(statSync(workspace, { bigint: true }).ino, before, 'the command did not make its directory again, so the test proves nothing');
  assert.equal(alive(Number(read(directory, 'left.pid'))), false, 'the process working in the directory made again is alive');
});

/**
 * A dead engine's record in `directory`'s state directory naming one group no process holds any
 * longer, dispatch `d-dead` of card 1412, its directory `work/` and its scratch directory
 * `scratch/rigger-1412/engineer/`, each recorded with the device and inode it has now. Answers the
 * state directory and the two directories' real paths.
 */
function recordedWithScratch(directory) {
  const state = stateOf(directory);
  const work = join(directory, 'work');
  const role = join(directory, 'scratch', 'rigger-1412', 'engineer');
  for (const each of [work, role]) mkdirSync(each, { recursive: true });
  const held = (path) => {
    const { dev, ino } = statSync(realpathSync.native(path), { bigint: true });
    return { device: String(dev), inode: String(ino) };
  };
  const leader = spawnSync('/usr/bin/true');
  writeGroups(state, [{ group: leader.pid, started: 0, dispatch: 'd-dead', card: 1412, workspace: realpathSync.native(work), ...held(work), scratch: { path: realpathSync.native(role), ...held(role) } }]);
  return { state, work: realpathSync.native(work), role: realpathSync.native(role) };
}

// proves R-STATE-17, R-STATE-10
test('given a recorded dispatch whose scratch directory is still the one recorded, a later start ends a process working there, and records its kill under the dispatch\'s id and card', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const { state, role } = recordedWithScratch(directory);
  const left = await tailIn(t, directory, join(role, 'sub'));
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });

  await killRecordedGroups({ directory: state, sink });

  assert.equal(await gone(left), true, 'the process working in the recorded scratch directory is alive');
  const kills = readEvents(state).filter((event) => event.pid === left);
  assert.deepEqual(kills.map(({ event, dispatch: id, card, directory: swept }) => ({ event, id, card, swept })), [{ event: 'recorded.killed', id: 'd-dead', card: 1412, swept: role }]);
});

// proves R-STATE-17, R-STATE-10
test('given a recorded dispatch whose scratch directory was replaced at its path, a later start sweeps nothing there, leaves a process working there alive, and records the directory skipped and why', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const { state, role } = recordedWithScratch(directory);
  rmSync(role, { recursive: true });
  mkdirSync(role);
  const left = await tailIn(t, directory, join(role, 'sub'));
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });

  await killRecordedGroups({ directory: state, sink });

  assertUntouched(left, 'the process working in the replaced scratch directory');
  const skipped = readEvents(state).filter((event) => event.event === 'directory.skipped');
  assert.deepEqual(skipped.map(({ dispatch: id, card, directory: at }) => ({ id, card, at })), [{ id: 'd-dead', card: 1412, at: role }]);
  assert.match(skipped[0].reason, /not the directory recorded/);
});

/**
 * A caller of its own, as `CALLER`, that hands L1's function a scratch directory as well: it
 * dispatches `command` in the workspace `work/` under the directory given as its first argument,
 * with `scratch/` there as the dispatch's scratch directory, and waits until it is signalled.
 */
const SCRATCH_CALLER = [
  `import { openSink } from ${moduleAt('../src/observation/sink.mjs')};`,
  `import { dispatch } from ${moduleAt('../src/execution/run.mjs')};`,
  `import { atExit } from ${moduleAt('../src/substrate/process.mjs')};`,
  "import { join } from 'node:path';",
  'const [directory, command] = process.argv.slice(2);',
  "const state = join(directory, '.rigger');",
  "const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });",
  'atExit(sink.end);',
  "dispatch({ id: 'd-term', card: 7, directory: state, sink, command, args: [], cwd: join(directory, 'work'), workspace: join(directory, 'work'), scratch: join(directory, 'scratch'), env: {}, timeout: 600_000 }).catch(() => {});",
  'setInterval(() => {}, 1_000);',
].join('\n');

// proves R-STATE-17, R-STATE-9
test('given a dispatch running with a process that left its group, working in the dispatch\'s scratch directory, when the calling process receives SIGTERM, that process is not alive afterwards, and its kill is recorded', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  for (const each of ['work', 'scratch']) mkdirSync(join(directory, each));
  const command = fixture(directory, 'command', [leaveWorking('scratch/sub', 'left'), ': > "$here/ready"', 'while :; do :; done'].join('\n'));
  writeFileSync(join(directory, 'caller.mjs'), SCRATCH_CALLER);
  const caller = spawn(process.execPath, [join(directory, 'caller.mjs'), directory, command], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => caller.kill('SIGKILL'));
  let said = '';
  caller.stderr.on('data', (chunk) => { said += chunk; });
  const exited = once(caller, 'exit');
  await until(() => existsSync(join(directory, 'ready')) || caller.exitCode !== null, t);
  assert.ok(existsSync(join(directory, 'ready')), `the caller ended before its dispatch was up: ${said}`);

  caller.kill('SIGTERM');
  const [, signal] = await exited;

  assert.equal(signal, 'SIGTERM', said);
  const left = Number(read(directory, 'left.pid'));
  assert.equal(await gone(left), true, 'the process working in the scratch directory is alive');
  const kills = readEvents(stateOf(directory)).filter((event) => event.event === 'survivor.killed' && event.pid === left);
  assert.deepEqual(kills.map(({ dispatch: id, card, directory: swept }) => ({ id, card, swept })), [{ id: 'd-term', card: 7, swept: join(directory, 'scratch') }], said);
});
