// ABOUTME: Fixtures for tests that start real processes: a scratch directory torn down with every
// process naming it, shell scripts that live in it, `git` stand-ins put first on PATH, children
// they leave alive or that outlive a timeout, process groups as a dead engine leaves them, reads
// of what those scripts leave behind and of a process's start time, a standard error nothing
// drains, and a wait on a condition that ends with its test.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync as rawSpawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, constants as files, existsSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';

/** Observe the raw synchronous command result before a fixture caller interprets it. */
const spawnSync = (...input) => {
  if (process.env.RIGGER_779_TRACE !== '1') return rawSpawnSync(...input);
  const [command, args] = input;
  const started = Date.now();
  process.stderr.write(`${JSON.stringify({ at: started, event: 'sync-command.entry', command, args })}\n`);
  try {
    const result = rawSpawnSync(...input);
    process.stderr.write(`${JSON.stringify({ at: Date.now(), started, event: 'sync-command.returned', command, args, status: result.status, signal: result.signal, stdout: result.stdout ?? null, stderr: result.stderr ?? null, error: result.error ? { message: result.error.message, code: result.error.code ?? null } : null })}\n`);
    return result;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ at: Date.now(), started, event: 'sync-command.threw', command, args, error: { message: error.message, code: error.code ?? null } })}\n`);
    throw error;
  }
};

const fixtureWarmBatches = new Map();

/** Warm every fixture written in a batch, with several first executions in flight together. */
export function beginFixtureWarmBatch(directory) {
  assert.equal(fixtureWarmBatches.has(directory), false, `fixture warming already begun for ${directory}`);
  fixtureWarmBatches.set(directory, []);
}

export function finishFixtureWarmBatch(directory) {
  const paths = fixtureWarmBatches.get(directory);
  assert.ok(paths, `fixture warming was not begun for ${directory}`);
  fixtureWarmBatches.delete(directory);
  const run = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--warm-fixtures', ...paths], {
    encoding: 'utf8',
    env: process.env,
  });
  if (process.env.RIGGER_779_TRACE === '1' && run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, `warming fixtures in ${directory} failed: ${run.error?.message ?? run.stderr}`);
}

/**
 * A scratch directory for one test, torn down with every process that names it, and then removed.
 *
 * Every fixture process a test starts carries the directory's path in its command line, so the
 * teardown finds each one by it, as `find` lists them, whether the test passed or failed, and
 * whatever the code under test did. It removes the directory last of the test's teardown, and only
 * once `sweep` has found none left; where one is, it fails naming it and leaves the directory.
 */
export function scratch(t, find = running) {
  const directory = realpathSync(temporaryDirectory('rigger-process-', { context: t, beforeRemoval: () => sweep(directory, find) }));
  return directory;
}

/**
 * The most rounds of `pkill` a teardown makes. A judgment, whose premise is a measurement: over
 * three runs of `npm test` with Node 26.5.0 on macOS 27.0 on 2026-09-28, the 795 teardowns took
 * at most 2 rounds each. A process `find` still lists after this many is one `pkill` cannot kill.
 */
const SWEEPS = 10;
export { SWEEPS };

/**
 * Kills every process whose command line holds `text`, as `find` lists them, round after round
 * until none is left, because a fixture that forks can start one while `pkill` is at work. After
 * `SWEEPS` rounds it stops, and throws naming every process still left.
 */
export function sweep(text, find = running) {
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'sweep.start', text })}\n`);
  for (let round = 0; round < SWEEPS; round += 1) {
    if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'sweep.round', text, round })}\n`);
    if (find(text).length === 0) return;
    spawnSync('/usr/bin/pkill', ['-KILL', '-f', literally(text)]);
  }
  const left = find(text);
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'sweep.final-read', text, left })}\n`);
  if (left.length > 0) throw new Error(`${SWEEPS} rounds of pkill -KILL left these processes naming ${text} alive: ${left.join(', ')}`);
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
export { literally };

/** The pid of every process whose command line holds `text`. */
export const running = (text) => spawnSync('/usr/bin/pgrep', ['-f', literally(text)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/**
 * The shell line a stand-in runs first, after its `#!` line, so that run with
 * `RIGGER_FIXTURE_WARMING` set it exits 0 before its body, and `warmed` leaves no trace of it.
 */
export const EXIT_IF_WARMING = '[ -n "$RIGGER_FIXTURE_WARMING" ] && exit 0';

/** Record shell readiness results without changing the generated command's normal path. */
function tracedReadiness(body, name) {
  if (process.env.RIGGER_779_MOVE_FAIL === '1') body = body.replaceAll('/bin/mv "$here/child.$1.tmp" "$here/child.$1"', '/bin/rm -f "$here/child.$1.tmp"\n/bin/mv "$here/child.$1.tmp" "$here/child.$1"');
  const observed = body.replaceAll('/bin/ps -o ucomm= -p $!', 'rigger779_capture_ps -o ucomm= -p $!');
  return [
    'if [ -f "$here/.rigger779-trace" ]; then',
    `  rigger779_script=${name}`,
    '  rigger779_label=$1; rigger779_round=0',
    '  rigger779_capture_ps() { /bin/ps "$@" | /usr/bin/tee -a "$here/ps.stdout"; rigger779_actual=${PIPESTATUS[0]}; [ -f "$here/.rigger779-ps-status-1" ] && return 1; return "$rigger779_actual"; }',
    '  rigger779_previous=',
    '  rigger779_debug() {',
    '    rigger779_status=$1; rigger779_pipeline=$2; rigger779_next=$3',
    '    if [ -n "$rigger779_previous" ]; then printf "return\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$SECONDS" "$rigger779_script" "$rigger779_previous" "$rigger779_status" "$rigger779_pipeline" "$rigger779_next" >> "$here/fixture.commands"; fi',
    '    printf "entry\\t%s\\t%s\\t%s\\n" "$SECONDS" "$rigger779_script" "$rigger779_next" >> "$here/fixture.commands"',
    '    case "$rigger779_previous" in */bin/mv*) printf "{\\"command\\":\\"/bin/mv\\",\\"status\\":%s,\\"label\\":\\"%s\\"}\\n" "$rigger779_status" "$rigger779_label" >> "$here/fixture.trace" ;; esac',
    '    case "$rigger779_pipeline" in *" "*)',
    '      set -- $rigger779_pipeline',
    '      printf "{\\"command\\":\\"/bin/ps\\",\\"status\\":%s,\\"label\\":\\"%s\\",\\"round\\":%s}\\n" "$1" "$rigger779_label" "$rigger779_round" >> "$here/fixture.trace"',
    '      printf "{\\"command\\":\\"/usr/bin/grep\\",\\"status\\":%s,\\"label\\":\\"%s\\",\\"round\\":%s}\\n" "$2" "$rigger779_label" "$rigger779_round" >> "$here/fixture.trace"',
    '      rigger779_round=$((rigger779_round + 1))',
    '    ;; esac',
    '    rigger779_previous=$rigger779_next',
    '  }',
    "  trap 'rigger779_debug \"$?\" \"${PIPESTATUS[*]}\" \"$BASH_COMMAND\"' DEBUG",
    'fi',
    observed,
  ].join('\n');
}

/** Retain each returned command in the selected confirmation scripts. */
function tracedCommands(body, name) {
  const observed = body.replaceAll('/bin/cat ', 'rigger779_cat ');
  return [
    `rigger779_script=${name}`,
    'rigger779_previous=',
    'rigger779_cat() { /bin/cat "$@" | /usr/bin/tee -a "$here/cat.stdout"; rigger779_status=${PIPESTATUS[0]}; printf "return\\t%s\\t%s\\t/bin/cat\\t%s\\n" "$SECONDS" "$rigger779_script" "$rigger779_status" >> "$here/fixture.commands"; return "$rigger779_status"; }',
    'rigger779_debug() {',
    '  rigger779_status=$1; rigger779_pipeline=$2; rigger779_next=$3',
    '  if [ -n "$rigger779_previous" ]; then printf "return\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$SECONDS" "$rigger779_script" "$rigger779_previous" "$rigger779_status" "$rigger779_pipeline" "$rigger779_next" >> "$here/fixture.commands"; fi',
    '  printf "entry\\t%s\\t%s\\t%s\\n" "$SECONDS" "$rigger779_script" "$rigger779_next" >> "$here/fixture.commands"',
    '  rigger779_previous=$rigger779_next',
    '}',
    "trap 'rigger779_debug \"$?\" \"${PIPESTATUS[*]}\" \"$BASH_COMMAND\"' DEBUG",
    observed,
  ].join('\n');
}

/**
 * A shell script named `name` in `directory`, executable, whose body reads that directory as
 * `$here`. Its path, and so the directory, is in the command line of the shell running it. Run
 * with `RIGGER_FIXTURE_WARMING` set, it exits 0 before its body (`warmed`).
 * It is run so once before this returns, so the system's hold on its first exec is paid here,
 * outside any bound of the test that runs it.
 */
export function fixture(directory, name, body) {
  const path = join(directory, name);
  if (process.env.RIGGER_779_TRACE === '1' && existsSync(join(directory, '.rigger779-trace')) && (name === 'command' || name === 'joining')) body = tracedReadiness(body, name);
  if (process.env.RIGGER_779_TRACE === '1' && existsSync(join(directory, '.rigger779-trace')) && ['ps-join', 'ps-logged-join', 'ps-never'].includes(name)) body = tracedCommands(body, name);
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.write.start', path })}\n`);
  writeFileSync(path, `#!/bin/sh\nhere=\${0%/*}\n${EXIT_IF_WARMING}\n${body}\n`, { mode: 0o755 });
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.write.returned', path })}\n`);
  const batch = fixtureWarmBatches.get(directory);
  if (batch) {
    batch.push(path);
    return path;
  }
  warmed(path);
  return path;
}

/**
 * The fixture at `path`, run once to its exit before its body, so the next run of it starts at
 * once. The system holds the first exec of a file just written until it has assessed it: measured
 * with Node 26.5.0 on macOS 27.0 (26A428) on 2026-09-29, the first exec of a fresh three-line
 * script reached its first line a median 42 ms after the spawn, and a second exec of the same file
 * 3 ms after. Beside whole suites, at a load average of about 33, 1 of 150 first execs took 1,058 ms,
 * while 150 second execs took at most 20 ms. So a fixture that must be ready within `OUTLIVED` of
 * its spawn is warmed first, and the assessment is paid outside that window.
 * The run is given `args`, for a stand-in that tells the warming run apart by its arguments.
 */
export function warmed(path, args = []) {
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.warm.start', path })}\n`);
  const run = spawnSync(path, args, { env: { RIGGER_FIXTURE_WARMING: '1' }, encoding: 'utf8' });
  if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.warm.returned', path, status: run.status })}\n`);
  assert.equal(run.status, 0, `warming ${path} failed: ${run.error?.message ?? run.stderr}`);
  return path;
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] === '--warm-fixtures') {
  const pending = process.argv.slice(3);
  const warm = async (path) => {
    if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.warm.start', path })}\n`);
    const run = spawn(path, [], { env: { RIGGER_FIXTURE_WARMING: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    run.stderr.setEncoding('utf8');
    run.stderr.on('data', (chunk) => { stderr += chunk; });
    const status = await new Promise((resolve, reject) => {
      run.once('error', reject);
      run.once('close', resolve);
    });
    if (process.env.RIGGER_779_TRACE === '1') process.stderr.write(`${JSON.stringify({ at: Date.now(), event: 'fixture.warm.returned', path, status })}\n`);
    if (status !== 0) throw new Error(`warming ${path} failed: ${stderr}`);
  };
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (pending.length > 0) await warm(pending.shift());
  }));
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

/** The pid of every child a fixture in `directory` left through `leave` as `child-<pid>`. */
export const childrenIn = (directory) => readdirSync(directory).filter((name) => /^child-\d+\.pid$/.test(name)).map((name) => Number(read(directory, name)));

/**
 * The pid of the child among those `childrenIn` reads whose pid file has the earliest birth time,
 * which is the first a fixture in `directory` left, or nothing where none did. Not the first by
 * name: pid files sort by the stand-in's pid, and neither their names nor a numeric sort survive
 * the pid counter wrapping below a pid already listed.
 */
export function firstChildIn(directory) {
  const born = (name) => statSync(join(directory, name)).birthtimeMs;
  const [first] = readdirSync(directory).filter((name) => /^child-\d+\.pid$/.test(name)).sort((one, other) => born(one) - born(other));
  return first === undefined ? undefined : Number(read(directory, first));
}

/** Whether `pid` has gone within `within` ms, looked at once per turn of the event loop. */
export async function gone(pid, within = 10_000) {
  const deadline = Date.now() + within;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  return !alive(pid);
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

/**
 * The lines of a fixture that start a `tail` working in `$here/<where>`, which they make, outside
 * the command's process group, so that it runs until killed and holds the command's output open,
 * and write its pid to `$here/<name>.pid` once it runs `tail`. It follows `$here/hold`, so it names
 * the scratch directory in its command line. On macOS no `setsid` binary exists, and perl's
 * `setpgrp(0, 0)` leaves the group.
 */
export const leaveWorking = (where, name) => [
  `/bin/mkdir -p "$here/${where}"`,
  `(cd "$here/${where}" && exec /usr/bin/perl -e 'setpgrp(0, 0) or die "leave: $!"; open(my $f, ">", "$ARGV[0]/${name}.tmp") or die; print $f $$; close $f; rename "$ARGV[0]/${name}.tmp", "$ARGV[0]/${name}.pid" or die; exec "/usr/bin/tail", "-f", "$ARGV[0]/hold"' "$here") &`,
  `while [ ! -f "$here/${name}.pid" ]; do :; done`,
  `while ! /bin/ps -o ucomm= -p "$(/bin/cat "$here/${name}.pid")" | /usr/bin/grep -qx 'tail *'; do :; done`,
].join('\n');

/** The state `ps` reads for `pid`: its first character is `T` for a stopped process. */
export const processState = (pid) => spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();

/** Asserts that `pid` is alive and running: the census neither killed it nor left it stopped. */
export function assertUntouched(pid, what) {
  assert.equal(alive(pid), true, `${what} is not alive`);
  assert.ok(!processState(pid).startsWith('T'), `${what} is stopped`);
}

/**
 * Starts a `tail`, outside every process group Rigger created, working in `cwd`, as a test's own
 * child, so it runs until killed. It follows `hold` in `directory`, which names the scratch
 * directory in its command line, so the test's teardown ends it. Settles once it runs, on its pid.
 */
export async function tailIn(t, directory, cwd) {
  mkdirSync(cwd, { recursive: true });
  const child = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { cwd, detached: true, stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await until(() => processState(child.pid) !== '' && spawnSync('/bin/ps', ['-o', 'ucomm=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout.startsWith('tail'), t);
  return child.pid;
}

/** A survivor that runs until killed: `tail` following a file nothing writes to. */
export const TAIL = '/usr/bin/tail -f "$here/hold"';

/**
 * A read that exits while a descendant keeps its output open. Its teardown ends every holder on
 * every path. `started` waits for the stand-in to have printed, without releasing the holder.
 */
export function heldOutput(t, directory, output, ending = 'exit 0') {
  const holders = () => existsSync(join(directory, 'read-holders.pids')) ? read(directory, 'read-holders.pids').split('\n').map(Number) : [];
  const release = () => {
    const live = new Set(running(join(directory, 'hold')));
    for (const holder of holders()) if (live.has(String(holder))) process.kill(holder, 'SIGKILL');
  };
  t.after(release);
  return {
    body: [`${TAIL} &`, 'echo $! >> "$here/read-holders.pids"', output, ': > "$here/printed"', ending].join('\n'),
    async started() {
      await until(() => existsSync(join(directory, 'printed')), t);
    },
  };
}

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

/** The git this host runs, by its absolute path, which a stand-in hands every call on to. */
export const GIT = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();

/**
 * A `git` stand-in in `directory` that answers as the real git does, then leaves a child alive,
 * whose pid it writes to `child-<the stand-in's pid>.pid`, and exits with git's status.
 */
export const gitLeavingChild = (directory) => fixture(directory, 'git', [`'${GIT}' "$@"`, 'status=$?', leave(TAIL, 'child-$$'), 'exit $status'].join('\n'));

/** Runs `body` with `directory` first on this process's PATH, and puts PATH back after. */
export async function withFirstOnPath(directory, body) {
  const held = process.env.PATH;
  process.env.PATH = `${directory}:${held}`;
  try {
    return await body();
  } finally {
    process.env.PATH = held;
  }
}

/**
 * A `git` stand-in in `directory` that never answers: it leaves a child alive, writes its own pid
 * to `git.pid`, marks `ready`, and waits on the child, which runs until killed. It is `warmed`,
 * because it must be ready within `OUTLIVED` of its spawn.
 */
export const gitHanging = (directory) => fixture(directory, 'git', [leave(TAIL, 'child-$$'), 'echo $$ > "$here/git.pid"', '/usr/bin/mkfifo "$here/git-hold"', ': > "$here/ready"', 'wait', 'read answer < "$here/git-hold"'].join('\n'));

/**
 * A `git` stand-in in `directory` that records each call it is sent in `git-calls` and hands it on
 * to the real git, so a test reads whether the code under it asked git anything at all.
 */
export const gitRecording = (directory) => fixture(directory, 'git', ['printf \'%s\\n\' "$*" >> "$here/git-calls"', `exec '${GIT}' "$@"`].join('\n'));

/** Every call the recording stand-in in `directory` was sent, one line each. */
export const gitCalls = (directory) => (existsSync(join(directory, 'git-calls')) ? read(directory, 'git-calls').split('\n') : []);

/** Performs a fixed amount of finite filesystem work and reports where a shared deadline falls. */
export function finiteDirectoryReads(directory, reads, deadline, report, phase) {
  assert.ok(Number.isSafeInteger(reads) && reads >= 0 && reads <= 2_000_000, 'finite directory read count is out of range');
  report(`${phase}.entry`, { path: directory, reads });
  let crossed = false;
  for (let index = 0; index < reads; index += 1) {
    readdirSync(directory);
    if (!crossed && index % 1000 === 0 && performance.now() >= deadline) {
      crossed = true;
      report(`${phase}.exhausted`, { path: directory, readIndex: index, reads });
    }
  }
  report(`${phase}.return`, { path: directory, reads, crossed });
  return crossed;
}

/**
 * Starts, outside Rigger, a process group named `name` in `directory`, as a dead engine leaves
 * one: its leader is no child of this process, so the system reaps it once it dies, as it does a
 * group whose engine was killed. The leader is a shell, which starts a `tail` that runs until
 * killed. Settles once the `tail` runs, on the group's id, which is its leader's pid, the
 * leader's start time, and the member's pid, or rejects once the test `t` ends first.
 */
export async function startGroup(t, directory, name, { observe, noMatchPolls = 0, pollFailures = 0, psCommand = '/bin/ps', markerGate, startGate, launchGate, work = {}, deadline = Infinity } = {}) {
  const report = (phase, fields = {}) => observe?.(phase, fields);
  const workAt = (phase) => {
    if (work[phase] === undefined) return;
    if (finiteDirectoryReads(directory, work[phase], deadline, report, `${phase}.work`)) {
      assert.fail(`FM-${phase}-C0(8) S8-F-bound: finite fixture work consumed the shared 20,000 ms deadline`);
    }
  };
  const quotedPs = `'${psCommand.replaceAll("'", "'\\''")}'`;
  const quotedGate = markerGate === undefined ? null : `'${markerGate.replaceAll("'", "'\\''")}'`;
  const now = '/usr/bin/perl -MTime::HiRes=time -e "print time"';
  if (!existsSync(join(directory, 'hold'))) writeFileSync(join(directory, 'hold'), '');
  const memberLine = noMatchPolls === 0
    ? '/usr/bin/tail -f "$here/hold" &'
    : `(count=0; while [ "$count" -lt ${noMatchPolls} ]; do /bin/ps -p $$ -o pid= >/dev/null; count=$((count + 1)); done; exec /usr/bin/tail -f "$here/hold") &`;
  const poll = observe === undefined
    ? ['while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done']
    : [
      ...(pollFailures === 0 ? [] : [
        `count=0; while [ "$count" -lt ${pollFailures} ]; do`,
        `  started=$(${now})`,
        '  printf "entry|%s|%s\\n" "$count" "$started" >> "$0.ps-polls"',
        '  answer=$(/bin/ps -o ucomm= -p 99999999 2>&1)',
        '  status=$?',
        `  returned=$(${now})`,
        '  printf "return|%s|%s|%s|%s\\n" "$count" "$returned" "$status" "$answer" >> "$0.ps-polls"',
        '  count=$((count + 1))',
        'done',
      ]),
      `pollIndex=${pollFailures}`,
      'while :; do',
      `  started=$(${now})`,
      '  printf "entry|%s|%s\\n" "$pollIndex" "$started" >> "$0.ps-polls"',
      `  answer=$(${quotedPs} -o ucomm= -p $! 2>&1)`,
      '  status=$?',
      `  returned=$(${now})`,
      '  printf "return|%s|%s|%s|%s\\n" "$pollIndex" "$returned" "$status" "$answer" >> "$0.ps-polls"',
      '  pollIndex=$((pollIndex + 1))',
      '  case "$answer" in tail*) [ "$status" -eq 0 ] && break ;; esac',
      'done',
    ];
  report('warm.entry');
  workAt('warm');
  const script = fixture(directory, name, [
    memberLine,
    ...poll,
    ...(quotedGate === null ? [] : ['echo waiting > "$0.marker-gate"', `IFS= read -r answer < ${quotedGate}`]),
    'echo $$ $! > "$0.tmp" && /bin/mv "$0.tmp" "$0.pids"',
    'wait',
  ].join('\n'));
  report('warm.return', { script });
  // Perl forks, and the fork makes a group of its own and runs the script as its leader, while
  // the process this spawned exits.
  report('launcher.entry');
  workAt('launcher');
  if (launchGate !== undefined) {
    writeFileSync(`${script}.launch-gate`, 'waiting');
    report('launcher.gate.entry', { path: launchGate });
    await until(() => existsSync(launchGate), t);
    report('launcher.gate.return', { path: launchGate });
  }
  const launcher = spawn('/usr/bin/perl', ['-e', 'exit if fork; setpgrp(0, 0); exec @ARGV or die', script], { stdio: 'ignore' });
  await once(launcher, 'exit');
  report('launcher.exit', { status: launcher.exitCode, signal: launcher.signalCode });
  const polls = `${script}.ps-polls`;
  let seen = 0;
  let answered = 0;
  let tailAnswered = false;
  const startedByPoll = new Map();
  let gateSeen = false;
  report('marker.entry');
  const drain = () => {
    if (observe !== undefined && existsSync(polls)) {
      const lines = readFileSync(polls, 'utf8').split('\n');
      for (const line of lines.slice(seen, -1)) {
        const [kind, indexText, timestamp, statusText, ...answerParts] = line.split('|');
        const index = Number(indexText);
        if (kind === 'entry') {
          const startedEpochMs = Number(timestamp) * 1000;
          startedByPoll.set(index, startedEpochMs);
          report('ps.entry', { index, startedEpochMs });
        } else if (kind === 'return') {
          const answer = answerParts.join('|');
          const status = Number(statusText);
          const returnedEpochMs = Number(timestamp) * 1000;
          const startedEpochMs = startedByPoll.get(index);
          report('ps.poll', { index, status, answer, startedEpochMs, returnedEpochMs, durationMs: returnedEpochMs - startedEpochMs, outcome: status !== 0 ? 'failure' : answer.trim() === 'tail' ? 'tail' : 'no-match' });
          if (status === 0 && answer.trim() === 'tail') tailAnswered = true;
          answered += 1;
        }
        seen += 1;
      }
    }
  };
  try {
    if (work.marker !== undefined) {
      await until(() => { drain(); return tailAnswered; }, t);
      workAt('marker');
    }
    await until(() => {
      drain();
      if (!gateSeen && existsSync(`${script}.marker-gate`)) {
        gateSeen = true;
        report('marker.gate.entry', { path: markerGate });
      }
      return existsSync(`${script}.pids`);
    }, t);
  } finally {
    drain();
  }
  report('marker.return', { polls: answered });
  const [leader, member] = readFileSync(`${script}.pids`, 'utf8').trim().split(' ').map(Number);
  report('marker.read', { leader, member });
  report('startOf.entry', { leader });
  workAt('startOf');
  if (startGate !== undefined) {
    writeFileSync(`${script}.start-gate`, 'waiting');
    report('startOf.gate.entry', { path: startGate });
    await until(() => existsSync(startGate), t);
    report('startOf.gate.return', { path: startGate });
  }
  const started = startOf(leader);
  report('startOf.return', { started });
  return { group: leader, leader, started, member };
}

/**
 * Ends `started`'s leader alone, and settles once it is gone, leaving its member in the group, or
 * rejects once the test `t` ends first.
 */
export async function withoutLeader(t, started) {
  process.kill(started.leader, 'SIGKILL');
  await until(() => !alive(started.leader), t);
  return started;
}

/**
 * Settles once `child` has exited, killing it first where it has not: a process that has exited
 * spawns nothing more.
 */
export function ended(child) {
  if (child.exitCode !== null || child.signalCode !== null) return undefined;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  return exited;
}

/**
 * A `git` stand-in in `directory` that fails the first `times` fetches it is sent as git fails one
 * another process's fetch beat to `refs/remotes/origin/main`, counting them in `raced` beside
 * itself, and hands every other call, and every later fetch, on to the real git. The words are
 * git's own: the stand-in asks the real git to move that ref from a value it does not hold, which
 * git refuses through the same lock check a fetch meets, and prints that refusal as a fetch prints it.
 */
export function gitRacing(directory, times = 1) {
  return fixture(directory, 'git', [
    'tries=$(/bin/cat "$here/raced" 2>/dev/null || echo 0)',
    `if [ "$1" = fetch ] && [ "$tries" -lt ${times} ]; then`,
    '  echo $((tries + 1)) > "$here/raced"',
    `  words=$('${GIT}' update-ref refs/remotes/origin/main HEAD ${'1'.repeat(40)} 2>&1)`,
    '  printf \'%s\\n\' "$words" | /usr/bin/sed \'s/.*\\(cannot lock ref\\)/error: \\1/\' >&2',
    '  exit 1',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
}
