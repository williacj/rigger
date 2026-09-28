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
 * The group is stopped first, because a stopped process cannot exec. One `ps` run reads a
 * process's name from the process table and its arguments a moment later, so a process that
 * execs in between is named by one image and described by the other: the engineer judge on #354
 * measured that in 16 of 3,000 direct reads, and 34 of 1,500 calls to this adapter, before the
 * group was stopped. So the census reads the states, then the names, then the command lines,
 * then the states again, each in a `ps` run of its own. It keeps them only when both state reads
 * find every member stopped, or a zombie, and all four reads find the same processes. Otherwise
 * it stops the group again and reads again: a member not yet stopped is one the signal has not
 * reached, one caught mid-exec (state `?`), or a fork the signal missed. A zombie cannot exec
 * either, and is left out, because it is already dead.
 *
 * Each read holds the pid and one column, so no field of varying width comes before the one
 * split it takes. `ps` pads a column by display width, and a name of wide characters is padded to
 * fewer characters than a narrow one, so splitting after it misread the row (the engineer judge
 * on #354, with `日本語日本` run as `exec -a Tx`).
 *
 * Where `ps`'s answer can differ from the process's own (`D16` rule 3), measured with `ps` from
 * adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27:
 *
 * - `ucomm` is the executable's name as the kernel holds it, cut to 16 bytes, so a cut can fall
 *   inside a character and leave bytes that are not UTF-8 (the engineer judge on #354 saw
 *   `日本語テール` recorded as `日本語テー` and U+FFFD). It is padded with spaces, so a name's own
 *   trailing spaces are lost. It names what runs, not what was asked for: a script run by
 *   `/bin/sh` is named `bash`.
 * - `stat`'s first character is the process's state: `T` stopped, `Z` a zombie, `?` caught
 *   mid-exec.
 * - `comm`, argv[0], would name `exec -a <anything>` as `<anything>`, and the command line
 *   already begins with argv[0], so the name is the executable's.
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
  const read = (column) => table(ps, group, column, deadline - Date.now(), timeout);
  for (;;) {
    signal(group, 'SIGSTOP');
    const before = await read('stat');
    if (!stopped(before)) continue;
    const names = await read('ucomm');
    const commands = await read('command');
    const after = await read('stat');
    if (!stopped(after) || ![before, names, commands].every((each) => samePids(each, after))) continue;
    return [...after]
      .filter(([, state]) => state.startsWith('T'))
      .map(([pid]) => ({ pid, name: names.get(pid).trimEnd(), cmd: commands.get(pid) }));
  }
}

/** Whether every process a read of states holds is stopped, or is a zombie. */
const stopped = (states) => [...states.values()].every((state) => state.startsWith('T') || state.startsWith('Z'));

/** Whether two reads hold the same processes. */
const samePids = (one, other) => one.size === other.size && [...one.keys()].every((pid) => other.has(pid));

/**
 * One column of every process in `group`, by pid, read with `ps` at the path `ps` names and given
 * up on after `remaining` milliseconds of the census's `timeout`.
 */
function table(ps, group, column, remaining, timeout) {
  return new Promise((resolve, reject) => {
    if (remaining <= 0) return reject(new Error(`the census found the group not all stopped within ${timeout} ms`));
    const args = ['-ww', '-g', String(group), '-o', `pid=,${column}=`];
    execFile(ps, args, { env: { LC_ALL: 'C.UTF-8' }, timeout: remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' }, (error, stdout) => {
      if (error?.killed) return reject(new Error(`the process-table read timed out after ${timeout} ms`));
      if (error && !(error.code === 1 && stdout === '')) return reject(error);
      const rows = new Map();
      for (const line of stdout.split('\n').filter(Boolean)) {
        // The pid is right-aligned and followed by one space, so the rest of the line is the column.
        const row = /^\s*(\d+) (.*)$/.exec(line);
        // A row this cannot read is a process it cannot name, so the census fails rather than
        // leave that process out of it.
        if (!row) return reject(new Error(`the process table held a row the census cannot read: ${JSON.stringify(line)}`));
        rows.set(Number(row[1]), row[2]);
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
