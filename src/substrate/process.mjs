// ABOUTME: L0's process adapter: it runs one command in a process group of its own, and once the
// command exits, kills what is left of that group, records each process it killed, and stops reading
// output a process outside the group holds open. On a start, it kills a group a dead engine
// recorded, once it has confirmed that group is the one recorded.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';

/**
 * The process-table tool, by absolute path, so it is found whatever `PATH` the caller runs under:
 * the installed engine runs under one holding only node, git and `gh` (`test/package.test.mjs`).
 */
export const PS = '/bin/ps';

/**
 * The whole environment `ps` runs under: a UTF-8 locale, so text outside ASCII reads unchanged,
 * and UTC, so a start time reads the same whatever zone the host is in. See `census`.
 */
const PS_ENV = { LC_ALL: 'C.UTF-8', TZ: 'UTC0' };

/**
 * How long L0 waits for one read of the process table before it gives up on the census and kills
 * the group unnamed. A judgment, not a measurement. Its premise is a measurement: 20 reads of one
 * four-process group, the census's own `ps -ww -g <group> -o pid=,ucomm=,command=` with macOS
 * 27.0's `ps` on 2026-09-27, took 1.0 to 1.6 ms each. Five seconds is over a thousand times that, room for a loaded host, while a
 * read that hangs holds a kill back by no more than five seconds.
 */
export const READ_TIMEOUT = 5_000;

/**
 * How long L0 reads a command's output once its group is empty before it stops, because a process
 * that left the group holds a pipe open. A judgment, not a measurement. Its premise: once the group
 * is empty, every byte the group wrote is already in the pipes, and the output is only what the
 * group wrote (the Failure model), so the bound waits for nothing of the command's own but a read
 * of what is buffered. That read is measured: with no process outside the group holding a pipe,
 * both pipes closed at most 0.129 ms after the group was empty, over 400 calls of this adapter
 * writing 300,000 bytes, half of them leaving a survivor on both pipes, with Node 26.5.0 on macOS
 * 27.0 on 2026-09-27. One second is over seven thousand times that, room for a loaded host, and
 * costs a command whose output a detached process holds one second.
 */
export const OUTPUT_BOUND = 1_000;

/**
 * The `code` of the failure a call rejects with when the sink refused an event it had to record,
 * so its caller tells it from a command that never started without reading the message.
 */
export const EVENT_REFUSED = 'EVENT_REFUSED';

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
 * A read of states or command lines holds the pid and that one column, so no field of varying
 * width comes before the one split it takes. `ps` pads a column by display width, and a name of
 * wide characters is padded to fewer characters than a narrow one, so splitting after it misread
 * the row (the engineer judge on #354, with `日本語日本` run as `exec -a Tx`). Each name is read in
 * a `ps` run for that pid alone, because a name can hold a newline, and in a read of the group it
 * then prints as a line of its own that reads as another process's row.
 *
 * Where `ps`'s answer can differ from the process's own (`D16` rule 3), measured with `ps` from
 * adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27:
 *
 * - `ucomm` is the executable's name as the kernel holds it, cut to 16 bytes, so a cut can fall
 *   inside a character and leave bytes that are not UTF-8 (the engineer judge on #354 saw
 *   `日本語テール` recorded as `日本語テー` and U+FFFD). It is padded with spaces, so a name's own
 *   trailing spaces are lost. It prints control characters raw, a newline included, so a name
 *   `x`, newline, `<pid> evil` read in the group's table named that other pid's process `evil`
 *   (the engineer judge on #354). It names what runs, not what was asked for: a script run by
 *   `/bin/sh` is named `bash`.
 * - `stat`'s first character is the process's state: `T` stopped, `Z` a zombie, `?` caught
 *   mid-exec.
 * - `comm` is argv[0], so `exec -a <anything>` names the process `<anything>`. It is cut to 16
 *   characters, measured with an ASCII name, unless it is the last column. The command line
 *   already begins with argv[0], so the name is the executable's.
 * - `command` writes control characters escaped, a newline as `\012` (the engineer judge on #354),
 *   so each process's command line is one line of the group's read.
 * - `command` is the process's arguments joined by spaces, so arguments holding spaces cannot be
 *   told apart from more arguments. A process caught mid-exec, or a zombie, shows `(name)` or
 *   `<defunct>` in its place.
 * - Under no locale, `ps` writes each byte outside ASCII in `vis` form, so `ü` reads `M-CM-<`.
 *   Under `LC_ALL=C.UTF-8`, which `ps` is given here, UTF-8 text reads unchanged. So `ps` gets
 *   that locale, the zone `startOf` gives it, and nothing else of the caller's environment.
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
  const read = (args) => run(ps, args, deadline - Date.now(), timeout);
  const column = async (name) => rowsOf(await read(['-ww', '-g', String(group), '-o', `pid=,${name}=`]));
  for (;;) {
    signal(group, 'SIGSTOP');
    const before = await column('stat');
    if (!stopped(before)) continue;
    const names = await namesOf([...before.keys()], read);
    const commands = await column('command');
    const after = await column('stat');
    if (!stopped(after) || ![before, names, commands].every((each) => samePids(each, after))) continue;
    return [...after]
      .filter(([, state]) => state.startsWith('T'))
      .map(([pid]) => ({ pid, name: names.get(pid), cmd: commands.get(pid) }));
  }
}

/** Whether every process a read of states holds is stopped, or is a zombie. */
const stopped = (states) => [...states.values()].every((state) => state.startsWith('T') || state.startsWith('Z'));

/** Whether two reads hold the same processes. */
const samePids = (one, other) => one.size === other.size && [...one.keys()].every((pid) => other.has(pid));

/**
 * Each of `pids`' names, read in a `ps` run of its own, so the whole of that run's output is that
 * one process's name, whatever bytes it holds. A process no longer there is left out.
 */
async function namesOf(pids, read) {
  const names = new Map();
  for (const pid of pids) {
    const printed = await read(['-p', String(pid), '-o', 'ucomm=']);
    // `ps` ends the name with its padding and a newline, which are not the name's own.
    if (printed !== '') names.set(pid, printed.replace(/\n$/, '').trimEnd());
  }
  return names;
}

/** Each line of a read of one column, by the pid it begins with. */
function rowsOf(printed) {
  const rows = new Map();
  for (const line of printed.split('\n').filter(Boolean)) {
    // The pid is right-aligned and followed by one space, so the rest of the line is the column.
    const row = /^\s*(\d+) (.*)$/.exec(line);
    // A row this cannot read is a process it cannot name, so the census fails rather than
    // leave that process out of it.
    if (!row) throw new Error(`the process table held a row the census cannot read: ${JSON.stringify(line)}`);
    rows.set(Number(row[1]), row[2]);
  }
  return rows;
}

/**
 * What one run of `ps`, at the path `ps` names, prints given `args`, or nothing where no process
 * matches. It is given up on after `remaining` milliseconds of the census's `timeout`.
 */
function run(ps, args, remaining, timeout) {
  return new Promise((resolve, reject) => {
    if (remaining <= 0) return reject(new Error(`the census found the group not all stopped within ${timeout} ms`));
    execFile(ps, args, { env: PS_ENV, timeout: remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' }, (error, stdout) => {
      if (error?.killed) return reject(new Error(`the process-table read timed out after ${timeout} ms`));
      if (error && !(error.code === 1 && stdout === '')) return reject(error);
      resolve(stdout);
    });
  });
}

/**
 * Ends what is left of `group`, in the order that keeps each name:
 * the census, which stops the group and reads it while its processes still exist; the kill; the
 * confirmation that the group is empty; and only then the `L0` events to record, one per process
 * killed, each named `killed`, which it hands back. A census that fails still kills the group, and
 * hands back the kill of the group with why its processes went unnamed.
 */
async function contain(group, { ps, readTimeout }, killed = 'survivor.killed') {
  if (!occupied(group)) return [];
  let survivors;
  let unnamed;
  try {
    survivors = await census(ps, group, readTimeout);
  } catch (error) {
    unnamed = error.message;
  }
  await ended(group);
  if (unnamed !== undefined) return [['group.killed', { group, census: unnamed }]];
  return survivors.map((survivor) => [killed, survivor]);
}

/**
 * Appends each of `events` through `emitter`, trying every one whatever became of those before
 * it, and hands back each the sink refused, with its fields and why.
 */
function record(emitter, events) {
  const unrecorded = [];
  for (const [event, fields] of events) {
    try {
      emitter.emit(event, fields);
    } catch (cause) {
      unrecorded.push({ event, ...fields, cause });
    }
  }
  return unrecorded;
}

/** The failure for a call whose `unrecorded` events the sink refused, carrying its `result`. */
function refused(unrecorded, result) {
  const lines = unrecorded.map(({ event, cause, ...fields }) => `${event} ${JSON.stringify(fields)}: ${cause.message}`);
  const error = new Error(`the sink refused ${unrecorded.length} L0 event(s), so they went unrecorded:\n${lines.join('\n')}`);
  return Object.assign(error, { code: EVENT_REFUSED, unrecorded, result });
}

/**
 * Runs `command` with `args` in `cwd` under exactly `env`, in a process group of its own, and
 * settles on its exit code and the bytes it wrote to standard output and standard error.
 *
 * The order is fixed: the command exits; L0 kills what is left of its group and confirms it is
 * empty; L0 reads both pipes until they close, or until `outputBound` milliseconds have passed,
 * where a process outside the group holds one open; L0 records each kill, and any such hold; the
 * call settles. So the output is everything the group wrote until that kill, and neither a
 * survivor nor a process that left the group holds the call open.
 *
 * A refused event never stops a kill, because every kill is done before any is recorded. Every
 * append is tried, and where the sink refused any, the call rejects with an `EVENT_REFUSED`
 * failure naming each unrecorded event and carrying the result.
 *
 * `onGroup`, where the caller gives one, is handed the group's id in the step that creates the
 * group, before the call first yields (`ARCHITECTURE.md`, "Failure model"). L1 records a
 * dispatch's group there. A command that never started has no group, and `onGroup` is not called.
 * Where `onGroup` throws, L0 ends and records the group, and the call rejects with what it threw,
 * or, where the sink refused a kill event, with the `EVENT_REFUSED` failure, caused by it.
 */
export async function runCommand({ command, args, cwd, env, emitter, onGroup, ps = PS, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND }) {
  // The caller opens the emitter, so an `L0` event carries the card L0 never knows. There is no
  // default: a kill with nowhere to be recorded is refused before anything starts, and an emitter
  // is only one that has an `emit` to call.
  if (typeof emitter?.emit !== 'function') throw new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  if (child.pid !== undefined) {
    try {
      if (onGroup) onGroup(child.pid, startOf(ps, child.pid, readTimeout));
    } catch (refusal) {
      // A group the caller could not take runs no further: it is ended, and recorded, as a
      // survivor would be, before the caller hears why.
      // Nothing reads the output of a command that runs no further, so its pipes are let go.
      const unrecorded = record(emitter, await contain(child.pid, { ps, readTimeout }));
      child.stdout.destroy();
      child.stderr.destroy();
      if (unrecorded.length > 0) throw Object.assign(refused(unrecorded), { cause: refusal });
      throw refusal;
    }
  }
  const [exit] = await once(child, 'exit');
  const events = await contain(child.pid, { ps, readTimeout });
  if (await heldPast(output, outputBound)) {
    // Closing the pipes lets go of their handles, which would otherwise hold this process open.
    child.stdout.destroy();
    child.stderr.destroy();
    events.push(['output.held', { group: child.pid, bound: outputBound }]);
  }
  const [stdout, stderr] = await output;
  const result = { exit, stdout, stderr };
  const unrecorded = record(emitter, events);
  if (unrecorded.length > 0) throw refused(unrecorded, result);
  return result;
}

/**
 * Kills the process group `group` that L1 recorded with a leader that started at `started`, once
 * it has confirmed from each live process's start time that the group is the one recorded. It
 * leaves a group it finds is not, and does nothing where the group has no live process. A kill
 * runs as `runCommand`'s does, census first, and records each process it killed as
 * `recorded.killed` through `emitter`. Where the sink refused any of those, it rejects with an
 * `EVENT_REFUSED` failure, once the group is empty. Where the start times cannot be read, it
 * rejects having killed nothing.
 */
export async function killRecordedGroup({ group, started, emitter, ps = PS, readTimeout = READ_TIMEOUT }) {
  const starts = await startsIn(ps, group, readTimeout);
  if (!recorded(group, started, starts)) return;
  const unrecorded = record(emitter, await contain(group, { ps, readTimeout }, 'recorded.killed'));
  if (unrecorded.length > 0) throw refused(unrecorded);
}

/**
 * Whether the live processes of `group`, by their `starts`, are the group recorded with a leader
 * that started at `started`. With its leader alive, the group is the one recorded where the
 * leader's start is the one recorded.
 *
 * With its leader dead, the leaderless rule decides (the owner's Q5 on #332): the group is the
 * one recorded where every live member started no earlier than the recorded leader. The rule
 * rests on two premises (the architect's ruling 1, B3, on #332):
 *
 * - a group id is not given out again while the group has a member;
 * - every member of a group Rigger created descends from the leader it recorded, so started no
 *   earlier than it.
 *
 * It admits one wrong kill. The recorded group empties, its id is given to a later group of
 * processes Rigger did not start, that group's leader dies, and its members live on until the
 * start. Each of them started after the recorded leader, so the rule kills them.
 * `test/kill-recorded.test.mjs` shows it with a fabricated entry naming a group the test started
 * outside Rigger ("the wrong kill the leaderless rule admits"). That is an inference from the two
 * premises and the rule, not a measurement: no host run waits for an id to be given again.
 */
function recorded(group, started, starts) {
  if (starts.has(group)) return starts.get(group) === started;
  return [...starts.values()].every((start) => start >= started);
}

/**
 * The start time of process `pid`, read in the step that spawned it, before the caller yields,
 * and given up on after `timeout` milliseconds. L0 reads it only for a caller that takes the
 * group, to tell the group from a later one given the same id. It blocks the event loop while
 * `ps` runs: one read took 0.95 ms at the median and 1.55 ms at most, over 200 reads in the tick
 * that spawned the process, with Node 26.5.0 on macOS 27.0 on 2026-09-27.
 *
 * Where `ps`'s start time can differ from the process's true start (`D16` rule 3), measured with
 * `ps` from adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27:
 *
 * - `lstart` is whole seconds: 100 of 100 pairs of processes Node spawned one after the other
 *   read the same `lstart`. So two processes started at one group id within one second are not
 *   told apart, and the second is taken for the first. That needs the id given out twice within
 *   one second. 2,001 processes Node spawned one after another, at 1,255 a second, were given
 *   pids rising from 52,223 to 54,266. That the kernel hands pids out rising until they wrap is
 *   an inference from that run, not a measurement; on it, an id is given again only once every
 *   other free id has been.
 * - It is the time the process was forked, which comes before it runs its command.
 * - It prints in the local zone unless `ps` is given one, and with no zone in the text, so it is
 *   given UTC (`PS_ENV`): one process read `Sun Sep 27 22:50:08 2026` under the host's zone and
 *   `Mon Sep 28 03:50:08 2026` under UTC.
 * - A zombie, a process that has exited and not been reaped, still reads its start time, in a
 *   read of its group and in a read of its pid alone. So does a leader that exited at once, read
 *   in the tick that spawned it (the engineer's round 1 on #332).
 * - It is read from the wall clock at the fork. How a change to the host's clock after the fork
 *   moves it is not measured here.
 */
function startOf(ps, pid, timeout) {
  let printed;
  try {
    printed = execFileSync(ps, ['-p', String(pid), '-o', 'lstart='], { env: PS_ENV, timeout, killSignal: 'SIGKILL', encoding: 'utf8' });
  } catch (cause) {
    throw new Error(`L0 could not read when the leader of group ${pid} started, so it ended the group: ${cause.message}`, { cause });
  }
  return secondsOf(printed.replace(/\n$/, ''));
}

/** The start time of each live process in `group`, by its pid, read as `startOf` reads one. */
async function startsIn(ps, group, timeout) {
  const rows = rowsOf(await run(ps, ['-ww', '-g', String(group), '-o', 'pid=,lstart='], timeout, timeout));
  return new Map([...rows].map(([pid, printed]) => [pid, secondsOf(printed)]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A start time as `ps` prints it under `PS_ENV`, such as `Mon Sep 28 03:50:08 2026`, in whole seconds since the epoch. */
function secondsOf(printed) {
  const at = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4}) *$/.exec(printed);
  const month = MONTHS.indexOf(at?.[1]);
  if (month < 0) throw new Error(`the process table held a start time L0 cannot read: ${JSON.stringify(printed)}`);
  return Date.UTC(Number(at[6]), month, Number(at[2]), Number(at[3]), Number(at[4]), Number(at[5])) / 1000;
}

/** Whether `output` is still unread once `bound` milliseconds have passed. */
async function heldPast(output, bound) {
  let timer;
  const passed = new Promise((resolve) => { timer = setTimeout(resolve, bound, true); });
  const held = await Promise.race([output.then(() => false), passed]);
  clearTimeout(timer);
  return held;
}
