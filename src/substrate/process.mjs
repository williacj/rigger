// ABOUTME: L0's process adapter: it runs one command in a process group of its own, and once the
// command exits, kills what is left of that group and records each process it killed.

import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';

/**
 * The process-table tool, by absolute path, so it is found whatever `PATH` the caller runs under:
 * the installed engine runs under one holding only node, git and `gh` (`test/package.test.mjs`).
 */
export const PS = '/bin/ps';

/**
 * How long L0 waits for one read of the process table before it gives up on the census and kills
 * the group unnamed. A judgment, not a measurement. Its premise is a measurement: 20 reads of one
 * four-process group, the census's own `ps -ww -g <group> -o pid=,ucomm=,command=` with macOS
 * 27.0's `ps` on 2026-09-27, took 1.0 to 1.6 ms each. Five seconds is over a thousand times that, room for a loaded host, while a
 * read that hangs holds a kill back by no more than five seconds.
 */
export const READ_TIMEOUT = 5_000;

/** Every chunk `stream` carries, as one buffer, once the stream has closed. */
async function drained(stream) {
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  await once(stream, 'close');
  return Buffer.concat(chunks);
}

/**
 * Whether any process is left in `group`: signal 0 reaches a group while it has a member.
 *
 * `EPERM` counts as a member left. Measured with Node 26.5.0 on macOS 27.0 on 2026-09-27, over
 * 200 groups each SIGKILLed with two members: the kernel answered `EPERM` once in every one of
 * them while its members were exiting, and `ESRCH` on a later poll.
 */
function occupied(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Kills every process left in `group` and settles once the group is empty. The wait is on that
 * condition, checked once per turn of the event loop, so nothing else in Rigger stops meanwhile.
 *
 * The kill is sent again on every turn, because a process can be in the group without having
 * received it. One forked while the kernel delivers a group kill can miss it and run on: the
 * engineer judge on #354 saw that in 9 of 12 runs of a survivor forking in a loop, macOS 27.0,
 * 2026-09-27, where the group was running at the kill. A census that stopped the group leaves
 * nothing forking, but one that failed may not have. And a process outside the group can join it
 * after the kill while a zombie keeps it in being.
 */
async function ended(group) {
  for (;;) {
    signal(group, 'SIGKILL');
    if (!occupied(group)) return;
    await turn();
  }
}

/** Sends `name` to every process in `group`, and to none where the group has emptied. */
function signal(group, name) {
  try {
    process.kill(-group, name);
  } catch (error) {
    // `EPERM` is the answer `occupied` reads as members still exiting, so a later turn retries.
    if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
  }
}

/**
 * Every live process in `group`, each with its pid, its name, which is the executable's name, and
 * its command line, given up on `timeout` milliseconds after it starts.
 *
 * The group is stopped first, and the census is the first read of the process table in which
 * every member is stopped. One `ps` run reads a process's name from the process table and its
 * arguments a moment later, so a process that execs in between is named by one image and
 * described by the other: the engineer judge on #354 measured that in 16 of 3,000 direct reads,
 * and 34 of 1,500 calls to this adapter, before the group was stopped. A stopped process cannot
 * exec, so a row read while it is stopped holds one image. A member that is not yet stopped is
 * one the signal has not reached, or a fork the signal missed, so the group is stopped again and
 * read again. A zombie cannot exec either, and is left out, because it is already dead.
 *
 * Where `ps`'s answer can differ from the process's own (`D16` rule 3), measured with `ps` from
 * adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27:
 *
 * - `ucomm` is the executable's name as the kernel holds it, cut to 16 bytes, so a cut can fall
 *   inside a character and leave bytes that are not UTF-8 (the engineer judge on #354 saw
 *   `日本語テール` recorded as `日本語テー` and U+FFFD). It is padded to 16 columns by display width,
 *   so a name of wide characters takes fewer than 16 characters. The row is split on that padding,
 *   so a name's own trailing spaces are lost, and the split holds while the state that follows
 *   starts with a capital. It names what runs, not what was asked for: a script run by `/bin/sh`
 *   is named `bash`.
 * - `stat`'s first letter is the process's state: `T` stopped, `Z` a zombie.
 * - `comm`, argv[0], would name `exec -a <anything>` as `<anything>`. It is cut to 16 (measured
 *   with an ASCII name) unless it is the last column, and `command` must be last to stay whole,
 *   so one row cannot hold both whole.
 * - `command` is the process's arguments joined by spaces, so arguments holding spaces cannot be
 *   told apart from more arguments. A process caught mid-exec, or a zombie, shows `(name)` or
 *   `<defunct>` in its place.
 * - Under no locale, `ps` writes each byte outside ASCII in `vis` form, so `ü` reads `M-CM-<`.
 *   Under `LC_ALL=C.UTF-8`, which `ps` is given here, UTF-8 text reads unchanged. So `ps` gets
 *   that locale and nothing else of the caller's environment.
 * - The engineer measured a whole-table read (`ps -A`) cutting command lines at about 1,160
 *   characters where a read of one pid returned all 10,031 (card #336, engineer's round 4 on
 *   #332). On this host and date it did not reproduce: `ps -A`, `ps -g` and `ps -p` each returned
 *   whole a command line carrying one argument of 10,031 characters, with `COLUMNS` unset, 80 or
 *   1160, and one carrying an argument of 100,000. The cause of the engineer's cut is not known,
 *   so this reads one group rather than the whole table, with `-ww`, which the manual says uses
 *   as many columns as are needed.
 * - `-g` lists the processes whose group is `group`. A process that leaves the group before the
 *   read is not listed, and one that joins it after the read is killed unnamed.
 * - `ps` exits 1, printing nothing, when no process matches.
 */
async function census(ps, group, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    signal(group, 'SIGSTOP');
    const rows = await table(ps, group, deadline - Date.now(), timeout);
    if (rows.every(({ state }) => state === 'T' || state === 'Z')) {
      return rows.filter(({ state }) => state === 'T').map(({ pid, name, cmd }) => ({ pid, name, cmd }));
    }
  }
}

/**
 * One read of `group` from the process table, with `ps` at the path `ps` names, given up on after
 * `remaining` milliseconds of the census's `timeout`: each row's pid, name, state and command line.
 */
function table(ps, group, remaining, timeout) {
  return new Promise((resolve, reject) => {
    const timedOut = new Error(`the process-table read timed out after ${timeout} ms`);
    if (remaining <= 0) return reject(timedOut);
    const args = ['-ww', '-g', String(group), '-o', 'pid=,ucomm=,stat=,command='];
    execFile(ps, args, { env: { LC_ALL: 'C.UTF-8' }, timeout: remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' }, (error, stdout) => {
      if (error?.killed) return reject(timedOut);
      if (error && !(error.code === 1 && stdout === '')) return reject(error);
      const rows = [];
      for (const line of stdout.split('\n').filter(Boolean)) {
        const row = /^\s*(\d+) (.{1,16}) +([A-Z])\S* +(\S.*)$/.exec(line);
        // A row this cannot read is a process it cannot name, so the census fails rather than
        // leave that process out of it.
        if (!row) return reject(new Error(`the process table held a row the census cannot read: ${JSON.stringify(line)}`));
        rows.push({ pid: Number(row[1]), name: row[2].trimEnd(), state: row[3], cmd: row[4] });
      }
      resolve(rows);
    });
  });
}

/**
 * Ends what is left of `group` once its command has exited, in the order that keeps each name:
 * the census, which stops the group and reads it while its processes still exist; the kill; the
 * confirmation that the group is empty; and only then one `L0` event per process killed. A
 * census that fails still kills the group, and records the kill of the group with why its
 * processes went unnamed.
 */
async function contain(group, { emitter, ps, readTimeout }) {
  if (!occupied(group)) return;
  let survivors;
  let unnamed;
  try {
    survivors = await census(ps, group, readTimeout);
  } catch (error) {
    unnamed = error.message;
  }
  await ended(group);
  if (unnamed !== undefined) emitter.emit('group.killed', { group, census: unnamed });
  else for (const survivor of survivors) emitter.emit('survivor.killed', survivor);
}

/**
 * Runs `command` with `args` in `cwd` under exactly `env`, in a process group of its own, and
 * settles on its exit code and the bytes it wrote to standard output and standard error.
 *
 * The order is fixed: the command exits; L0 kills what is left of its group and confirms it is
 * empty; L0 reads both pipes until they close; the call settles. So the output is everything the
 * group wrote until that kill, and a survivor holding a pipe never holds the call open.
 */
export async function runCommand({ command, args, cwd, env, emitter, ps = PS, readTimeout = READ_TIMEOUT }) {
  // The caller opens the emitter, so an `L0` event carries the card L0 never knows. There is no
  // default: a kill with nowhere to be recorded is refused before anything starts, and an emitter
  // is only one that has an `emit` to call.
  if (typeof emitter?.emit !== 'function') throw new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  const [exit] = await once(child, 'exit');
  await contain(child.pid, { emitter, ps, readTimeout });
  const [stdout, stderr] = await output;
  return { exit, stdout, stderr };
}
