// ABOUTME: Fixtures for tests that start real processes: a scratch directory torn down with every
// process naming it, shell scripts that live in it, `git` stand-ins put first on PATH, children
// they leave alive or that outlive a timeout, process groups as a dead engine leaves them, reads
// of what those scripts leave behind and of a process's start time, a standard error nothing
// drains, and a wait on a condition that ends with its test.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, constants as files, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
  t.after(() => sweep(directory));
  return directory;
}

/**
 * The most rounds of `pkill` a teardown makes. A judgment, whose premise is a measurement: over
 * three runs of `npm test` with Node 26.5.0 on macOS 27.0 on 2026-09-28, the 795 teardowns took
 * at most 2 rounds each. A process `find` still lists after this many is one `pkill` cannot kill.
 */
const SWEEPS = 10;

/**
 * Kills every process whose command line holds `text`, as `find` lists them, round after round
 * until none is left, because a fixture that forks can start one while `pkill` is at work. After
 * `SWEEPS` rounds it stops, and throws naming every process still left.
 */
export function sweep(text, find = running) {
  for (let round = 0; round < SWEEPS; round += 1) {
    if (find(text).length === 0) return;
    spawnSync('/usr/bin/pkill', ['-KILL', '-f', literally(text)]);
  }
  const left = find(text);
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

/** The pid of every process whose command line holds `text`. */
export const running = (text) => spawnSync('/usr/bin/pgrep', ['-f', literally(text)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/**
 * A shell script named `name` in `directory`, executable, whose body reads that directory as
 * `$here`. Its path, and so the directory, is in the command line of the shell running it. Run
 * with `RIGGER_FIXTURE_WARMING` set, it exits 0 before its body (`warmed`).
 */
export function fixture(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\nhere=\${0%/*}\n[ -n "$RIGGER_FIXTURE_WARMING" ] && exit 0\n${body}\n`, { mode: 0o755 });
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
 */
export function warmed(path) {
  const run = spawnSync(path, [], { env: { RIGGER_FIXTURE_WARMING: '1' }, encoding: 'utf8' });
  assert.equal(run.status, 0, `warming ${path} failed: ${run.error?.message ?? run.stderr}`);
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
export const gitHanging = (directory) => warmed(fixture(directory, 'git', [leave(TAIL, 'child-$$'), 'echo $$ > "$here/git.pid"', ': > "$here/ready"', 'wait'].join('\n')));

/**
 * A `git` stand-in in `directory` that records each call it is sent in `git-calls` and hands it on
 * to the real git, so a test reads whether the code under it asked git anything at all.
 */
export const gitRecording = (directory) => fixture(directory, 'git', ['printf \'%s\\n\' "$*" >> "$here/git-calls"', `exec '${GIT}' "$@"`].join('\n'));

/** Every call the recording stand-in in `directory` was sent, one line each. */
export const gitCalls = (directory) => (existsSync(join(directory, 'git-calls')) ? read(directory, 'git-calls').split('\n') : []);

/**
 * Starts, outside Rigger, a process group named `name` in `directory`, as a dead engine leaves
 * one: its leader is no child of this process, so the system reaps it once it dies, as it does a
 * group whose engine was killed. The leader is a shell, which starts a `tail` that runs until
 * killed. Settles once the `tail` runs, on the group's id, which is its leader's pid, the
 * leader's start time, and the member's pid, or rejects once the test `t` ends first.
 */
export async function startGroup(t, directory, name) {
  if (!existsSync(join(directory, 'hold'))) writeFileSync(join(directory, 'hold'), '');
  const script = fixture(directory, name, [
    '/usr/bin/tail -f "$here/hold" &',
    'while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done',
    'echo $$ $! > "$0.tmp" && /bin/mv "$0.tmp" "$0.pids"',
    'wait',
  ].join('\n'));
  // Perl forks, and the fork makes a group of its own and runs the script as its leader, while
  // the process this spawned exits.
  const launcher = spawn('/usr/bin/perl', ['-e', 'exit if fork; setpgrp(0, 0); exec @ARGV or die', script], { stdio: 'ignore' });
  await once(launcher, 'exit');
  await until(() => existsSync(`${script}.pids`), t);
  const [leader, member] = readFileSync(`${script}.pids`, 'utf8').trim().split(' ').map(Number);
  return { group: leader, leader, started: startOf(leader), member };
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
 * A `git` stand-in in `directory` that fails the first fetch it is sent with the words git prints
 * for a fetch another process's fetch beat to `refs/remotes/origin/main`, and hands every other
 * call, and every later fetch, on to the real git. The words are the ones #426 (M3-S1)'s report
 * quotes; `test/worktrees.test.mjs` ties L0's reading of them to the real git.
 */
export const gitRacingOnce = (directory) => fixture(directory, 'git', [
  'if [ "$1" = fetch ] && [ ! -e "$here/raced" ]; then',
  '  : > "$here/raced"',
  `  echo "error: cannot lock ref 'refs/remotes/origin/main': is at ${'1'.repeat(40)} but expected ${'2'.repeat(40)}" >&2`,
  '  exit 1',
  'fi',
  `exec '${GIT}' "$@"`,
].join('\n'));
