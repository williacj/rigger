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
 * The kill is sent again on every turn. A process forked while the kernel delivers a group kill
 * can join the group without receiving it, and then runs on: the engineer judge on #354 saw that
 * in 9 of 12 runs of a survivor forking in a loop, macOS 27.0, 2026-09-27.
 */
async function ended(group) {
  for (;;) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch (error) {
      // `EPERM` is the answer `occupied` reads as members still exiting, so the next turn retries.
      if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
    }
    if (!occupied(group)) return;
    await turn();
  }
}

/**
 * Every process in `group`: its pid, its name, which is the executable's name, and its command
 * line. Both come from one row of one `ps` run, read with `ps` at the path `ps` names and given
 * up on after `timeout` milliseconds, so a process that re-executes during the census is not
 * named by one image and described by another.
 *
 * Where `ps`'s answer can differ from the process's own (`D16` rule 3), measured with `ps` from
 * adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27:
 *
 * - `ucomm` is the executable's name as the kernel holds it, cut to 16 characters, and padded to
 *   16 columns by display width, so a name of wide characters takes fewer than 16. The row is
 *   split on the padding, which holds while the command line does not start with a space. It
 *   names what runs, not what was asked for: a script run by `/bin/sh` is named `bash`.
 * - `comm`, argv[0], would name `exec -a <anything>` as `<anything>`. It is cut to 16 characters
 *   unless it is the last column, and `command` must be last to stay whole, so one row cannot
 *   hold both whole. Two runs could, and a process re-executing between them was then named by
 *   one image and described by the other (the engineer judge on #354, 2 events in 100 runs).
 * - `command` is the process's arguments joined by spaces, so arguments holding spaces cannot be
 *   told apart from more arguments. A process caught mid-exec can show `(name)` in its place, as
 *   the engineer judge on #354 saw `comm` do.
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
function census(ps, group, timeout) {
  return new Promise((resolve, reject) => {
    const args = ['-ww', '-g', String(group), '-o', 'pid=,ucomm=,command='];
    execFile(ps, args, { env: { LC_ALL: 'C.UTF-8' }, timeout, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' }, (error, stdout) => {
      if (error?.killed) return reject(new Error(`the process-table read timed out after ${timeout} ms`));
      if (error && !(error.code === 1 && stdout === '')) return reject(error);
      const survivors = [];
      for (const line of stdout.split('\n')) {
        const row = /^\s*(\d+) (.{1,16}) +(\S.*)$/.exec(line);
        if (row) survivors.push({ pid: Number(row[1]), name: row[2].trimEnd(), cmd: row[3] });
      }
      resolve(survivors);
    });
  });
}

/**
 * Ends what is left of `group` once its command has exited, in the order that keeps each name:
 * the census, while the processes still exist; the kill; the confirmation that the group is
 * empty; and only then one `L0` event per process killed. A census that fails still kills the
 * group, and records the kill of the group with why its processes went unnamed.
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
  // default: a kill with nowhere to be recorded is refused before anything starts.
  if (emitter === undefined) throw new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  const [exit] = await once(child, 'exit');
  await contain(child.pid, { emitter, ps, readTimeout });
  const [stdout, stderr] = await output;
  return { exit, stdout, stderr };
}
