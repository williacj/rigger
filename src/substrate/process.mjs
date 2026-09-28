// ABOUTME: L0's process adapter: it runs one command in a process group of its own, and once the
// command exits, kills what is left of that group, records each process it killed, and stops reading
// output a process outside the group holds open. On the process's own exit it kills every group it holds.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';

import { writeWhole } from './standard-error.mjs';

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

/**
 * The signals L0's exit cleanup handles: every signal whose default action ends a Node process and
 * that Node lets a listener handle safely (`ARCHITECTURE.md`, "Failure model"). Node and the OS
 * decide which those are, and `test/exit-cleanup.test.mjs` asks both, for every signal Node names
 * (`D16` rule 2).
 */
export const HANDLED = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTRAP', 'SIGABRT', 'SIGUSR2', 'SIGALRM', 'SIGTERM', 'SIGXCPU', 'SIGVTALRM', 'SIGSYS'];

/**
 * Every other signal Node names, by why the cleanup leaves it out. An ending by one of the first
 * three kinds is being killed outright, and a later start's kill of the recorded groups answers it.
 */
export const LEFT_OUT = {
  // No process can catch these, and Node refuses a listener for either.
  uncatchable: ['SIGKILL', 'SIGSTOP'],
  // Node's documentation: after a real one, not raised by `kill`, the process is in a state from
  // which it is not safe to call a listener.
  unsafe: ['SIGSEGV', 'SIGBUS', 'SIGFPE', 'SIGILL'],
  // V8's sampling profiler sends it to the process itself. Under `--cpu-prof`, a Node process with
  // a listener for it was ended by it, where one without a listener exited 0: 5 runs of each on
  // Node 26.5.0 and 1 on 20.20.2, macOS 27.0, 2026-09-27.
  profiler: ['SIGPROF'],
  // Node reserves it to start its inspector, and it does not end a Node process.
  inspector: ['SIGUSR1'],
  // Its default action, or Node's own disposition, does not end a Node process: it ignores the
  // signal, or stops the process.
  harmless: ['SIGPIPE', 'SIGCHLD', 'SIGCONT', 'SIGTSTP', 'SIGTTIN', 'SIGTTOU', 'SIGURG', 'SIGXFSZ', 'SIGWINCH', 'SIGIO', 'SIGINFO'],
  // `SIGABRT` under another name, which is handled.
  alias: ['SIGIOT'],
};

/**
 * Every group L0 holds, from the step that creates it until the call has emptied it, with what
 * the exit cleanup needs to end and record it: the call's `L0` emitter, its `ps` and read
 * timeout, and the step its caller handed it for the exit.
 */
const groups = new Map();

/** Every read of the process table a census has in flight, so the exit cleanup can end it. */
const reads = new Set();

/** The synchronous steps the exit cleanup takes last, once it has made its kills. */
const steps = [];

/**
 * Hands L0 a synchronous `step` its exit cleanup takes last, after it has killed every group it
 * holds, recorded each kill and taken each caller's own step. A verb hands over its sink's end
 * when it opens the sink, so the kills are among what the sink writes (ruling 3, §3, on #332).
 */
export function atExit(step) {
  steps.push(step);
}

/** Whether the exit cleanup is installed, which L0 does when it creates its first group. */
let installed = false;

/** Whether the exit cleanup has run, so it runs once, whichever ending reached it first. */
let cleaned = false;

/** Installs the exit cleanup, once: on `exit`, and on every signal in `HANDLED`. */
function install() {
  if (installed) return;
  installed = true;
  process.on('exit', cleanup);
  for (const name of HANDLED) process.on(name, onSignal);
}

/**
 * Cleans up on signal `name`, then ends the process by that signal, as it would have ended with
 * no listener. Where another listener is there for it, the process would not have ended by it,
 * so this leaves it to that listener, and cleans up at whatever exit follows.
 */
function onSignal(name) {
  if (process.listenerCount(name) > 1) return;
  cleanup();
  // With no listener left, Node gives the signal its default action again, so raising it ends
  // the process by it.
  process.removeListener(name, onSignal);
  process.kill(process.pid, name);
}

/**
 * L0's exit cleanup, synchronous because Node runs an `exit` listener synchronously. It ends every
 * read of the process table still in flight; then, for every group it holds, it takes the census,
 * kills the group and confirms it; and only then records each kill, and writes to standard error
 * every kill the sink refused, since no caller is left to report it to. It then takes each
 * caller's step for its group, which is L1's removal of the group's entry, and last the steps
 * handed to `atExit`. A failure in any of these is written to standard error and never stops the
 * rest, nor changes how the process ends.
 */
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const read of reads) read.kill('SIGKILL');
  const ended = [];
  for (const [group, call] of groups) attempt(() => ended.push([group, call, containNow(group, call)]));
  const unrecorded = ended.flatMap(([, { emitter }, events]) => record(emitter, events));
  if (unrecorded.length > 0) attempt(() => writeWhole(`${refused(unrecorded).message}\n`));
  for (const [group, { onExit }] of ended) attempt(() => onExit?.(group));
  for (const step of steps) attempt(step);
}

/** Takes `step`, writing to standard error why it failed, where it does. */
function attempt(step) {
  try {
    step();
  } catch (failure) {
    try {
      writeWhole(`L0's exit cleanup: ${failure.stack ?? failure}\n`);
    } catch {
      // Standard error is gone, and nothing is left to tell.
    }
  }
}

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
 * its command line. It yields each read of the process table it makes, as the arguments `ps` is
 * given, and takes back what `ps` printed, so one census serves the call, which waits on each
 * read, and the exit cleanup, which can wait on none (`reading` and `readingNow`).
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
function* census(group) {
  const column = function* (name) {
    return rowsOf(yield ['-ww', '-g', String(group), '-o', `pid=,${name}=`]);
  };
  for (;;) {
    signal(group, 'SIGSTOP');
    const before = yield* column('stat');
    if (!stopped(before)) continue;
    const names = yield* namesOf([...before.keys()]);
    const commands = yield* column('command');
    const after = yield* column('stat');
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
function* namesOf(pids) {
  const names = new Map();
  for (const pid of pids) {
    const printed = yield ['-p', String(pid), '-o', 'ucomm='];
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
 * Runs each read of the process table `looks` yields in `ps`, one at a time, and hands back what
 * `looks` returns. The reads are given up on `timeout` milliseconds after the first starts.
 */
async function reading(looks, ps, timeout) {
  const deadline = Date.now() + timeout;
  let look = looks.next();
  while (!look.done) look = looks.next(await run(ps, look.value, deadline - Date.now(), timeout));
  return look.value;
}

/** `reading`, synchronously, for the exit cleanup. */
function readingNow(looks, ps, timeout) {
  const deadline = Date.now() + timeout;
  let look = looks.next();
  while (!look.done) look = looks.next(runNow(ps, look.value, deadline - Date.now(), timeout));
  return look.value;
}

/** The environment `ps` runs under: `LC_ALL=C.UTF-8` alone (see `census`). */
const READ_ENV = { LC_ALL: 'C.UTF-8' };

/** How `ps` is run besides its environment: killed outright at `remaining` milliseconds. */
const reader = (remaining) => ({ timeout: remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' });

/** The failure for a census that ran out of time between reads. */
const late = (timeout) => new Error(`the census found the group not all stopped within ${timeout} ms`);

/** The failure for a read of the process table that ran out of time. */
const timedOut = (timeout) => new Error(`the process-table read timed out after ${timeout} ms`);

/**
 * What one run of `ps`, at the path `ps` names, prints given `args`, or nothing where no process
 * matches. It is given up on after `remaining` milliseconds of the census's `timeout`.
 */
function run(ps, args, remaining, timeout) {
  return new Promise((resolve, reject) => {
    if (remaining <= 0) return reject(late(timeout));
    const read = execFile(ps, args, { env: READ_ENV, ...reader(remaining) }, (error, stdout) => {
      reads.delete(read);
      if (error?.killed) return reject(timedOut(timeout));
      if (error && !(error.code === 1 && stdout === '')) return reject(error);
      resolve(stdout);
    });
    reads.add(read);
  });
}

/**
 * `run`, synchronously, for the exit cleanup. A synchronous run returns only once every holder of
 * its pipe has closed it, and `ps` starts nothing that outlives it, so its own kill at `remaining`
 * milliseconds ends the wait.
 */
function runNow(ps, args, remaining, timeout) {
  if (remaining <= 0) throw late(timeout);
  const { error, status, signal: ending, stdout } = spawnSync(ps, args, { env: READ_ENV, ...reader(remaining) });
  if (error?.code === 'ETIMEDOUT') throw timedOut(timeout);
  if (error) throw error;
  if (status !== 0 && !(status === 1 && stdout === '')) throw new Error(`${ps} ${args.join(' ')} ended with ${status ?? ending}`);
  return stdout;
}

/**
 * Ends what is left of `group` once its command has exited, in the order that keeps each name:
 * the census, which stops the group and reads it while its processes still exist; the kill; the
 * confirmation that the group is empty; and only then the `L0` events to record, one per process
 * killed, which it hands back. A census that fails still kills the group, and hands back the kill
 * of the group with why its processes went unnamed.
 */
async function contain(group, { ps, readTimeout }) {
  if (!occupied(group)) return [];
  let survivors;
  let unnamed;
  try {
    survivors = await reading(census(group), ps, readTimeout);
  } catch (error) {
    unnamed = error.message;
  }
  await ended(group);
  return killsOf(group, survivors, unnamed);
}

/**
 * `contain`, synchronously, for the exit cleanup, with the kill confirmed by `emptied`. Where the
 * confirmation's reads fail or run out of time, the group has had the kill on every look until
 * then, and the cleanup goes on: it cannot wait longer on a process table it cannot read.
 */
function containNow(group, { ps, readTimeout }) {
  if (!occupied(group)) return [];
  let survivors;
  let unnamed;
  try {
    survivors = readingNow(census(group), ps, readTimeout);
  } catch (error) {
    unnamed = error.message;
  }
  try {
    readingNow(emptied(group), ps, readTimeout);
  } catch {
    // The kill was sent on every look, and nothing is left to wait on.
  }
  return killsOf(group, survivors, unnamed);
}

/**
 * Kills every process left in `group` until it holds nothing but zombies, for the exit cleanup.
 * Node reaps no child while synchronous code runs, so a leader killed here stays in the group as a
 * zombie until this process exits, and the group never empties while the cleanup runs. So each
 * look reads the group's states, and a group of zombies is ended: none of them can run again.
 */
function* emptied(group) {
  for (;;) {
    signal(group, 'SIGKILL');
    if (!occupied(group)) return;
    const states = rowsOf(yield ['-g', String(group), '-o', 'pid=,stat=']);
    if ([...states.values()].every((state) => state.startsWith('Z'))) return;
  }
}

/** The `L0` events for a group killed after a census found `survivors`, or failed as `unnamed`. */
function killsOf(group, survivors, unnamed) {
  if (unnamed !== undefined) return [['group.killed', { group, census: unnamed }]];
  return survivors.map((survivor) => ['survivor.killed', survivor]);
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
 *
 * L0 holds the group from the step that creates it until the call has emptied it. Where the process
 * exits meanwhile, L0's exit cleanup kills and records it, and then hands the group to `onExit`,
 * where the caller gives one: a synchronous step, which is how L1 removes a dispatch's entry.
 */
export async function runCommand({ command, args, cwd, env, emitter, onGroup, onExit, ps = PS, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND }) {
  // The caller opens the emitter, so an `L0` event carries the card L0 never knows. There is no
  // default: a kill with nowhere to be recorded is refused before anything starts, and an emitter
  // is only one that has an `emit` to call.
  if (typeof emitter?.emit !== 'function') throw new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`);
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  const empty = async () => {
    const events = await contain(child.pid, { ps, readTimeout });
    groups.delete(child.pid);
    return events;
  };
  if (child.pid !== undefined) {
    install();
    groups.set(child.pid, { emitter, ps, readTimeout, onExit });
    try {
      onGroup?.(child.pid);
    } catch (refusal) {
      // A group the caller could not take runs no further: it is ended, and recorded, as a
      // survivor would be, before the caller hears why.
      // Nothing reads the output of a command that runs no further, so its pipes are let go.
      const unrecorded = record(emitter, await empty());
      child.stdout.destroy();
      child.stderr.destroy();
      if (unrecorded.length > 0) throw Object.assign(refused(unrecorded), { cause: refusal });
      throw refusal;
    }
  }
  const [exit] = await once(child, 'exit');
  const events = await empty();
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

/** Whether `output` is still unread once `bound` milliseconds have passed. */
async function heldPast(output, bound) {
  let timer;
  const passed = new Promise((resolve) => { timer = setTimeout(resolve, bound, true); });
  const held = await Promise.race([output.then(() => false), passed]);
  clearTimeout(timer);
  return held;
}
