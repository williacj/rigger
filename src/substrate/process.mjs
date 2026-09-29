// ABOUTME: L0's process adapter: it runs one command in a process group of its own, ends the group at
// the command's timeout, and once the command exits, kills what is left of that group, records each
// process it killed, and stops reading output a process outside the group holds open. On a start,
// it kills a group a dead engine recorded, once it has confirmed that group is the one recorded. On
// the process's own exit it kills every group it holds.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { accessSync, constants as files, statSync } from 'node:fs';
import { constants } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { inspect } from 'node:util';

import { writeWhole } from './standard-error.mjs';

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
 *
 * A process that left the group and holds a pipe is outside containment (the owner's Q6 on #332),
 * so what it writes is not the group's, and the bound does not keep it out. What it writes before
 * the bound passes is in the result, among the group's own bytes where it wrote while the group
 * ran; what it writes after is dropped, because L0 closes the pipes then. How much lands depends on when it writes: the engineer judge on
 * #361 saw a holder printing a line every millisecond put 198 lines into standard output.
 */
export const OUTPUT_BOUND = 1_000;

/**
 * How long L0 goes on killing a group that holds nothing but zombies before it settles. A zombie
 * cannot run, but it keeps its group in being, so a process can still join the group, and L0 kills
 * any that does within the bound. A zombie whose parent never reaps it is left behind once the
 * bound passes. A judgment, not a measurement. Its premise is a measurement: over 30 calls of this
 * adapter, 10 each of the three tests in `test/process-adapter.test.mjs` whose group holds a zombie
 * that is reaped (the forkers, the process that joins after the kill, and the zombie left out of
 * the census), 12 read only zombies before the group was empty, and each was empty 2 to 5 ms
 * later, with Node 26.5.0 on macOS 27.0 on 2026-09-27. One second is 200 times that, room for a
 * loaded host, and costs a group whose zombie is never reaped one second.
 */
export const UNREAPED_BOUND = 1_000;

/**
 * The longest L0 pauses between two looks at a group it is waiting on. The pause starts at one
 * millisecond and doubles up to this, so a wait costs next to no processor time however long it
 * lasts. A judgment, not a measurement.
 */
const LONGEST_PAUSE = 50;

/**
 * How many times the processor time a kill has used, since it began, the kill lets pass before
 * its next round, where a round saw a survivor end or sent the kill: a group killed in many
 * rounds, a chain of parents and children, would otherwise be read back to back. A judgment, not
 * a measurement. Its premise is a measurement: a chain 120 deep read back to back used 13 to 15%
 * of the processor on macOS 27.0 with Node 26.5.0 on 2026-09-28, and 11 to 13% on CI's macOS
 * runners, where a fixed 5 ms pause did not hold it under a tenth. At twelve, the chain's kill,
 * measured from its first round to the call's settling, used 8.8 to 9.2%, because the settling
 * counts too. Twenty holds it near a twentieth, a margin under the tenth #358 asks for, and costs
 * a kill of many rounds twenty times its processor time, less where its deadline could not
 * afford that (`killedOf`).
 */
const ROUND_SHARE = 20;

/** The pause after `wait`, doubling it up to `LONGEST_PAUSE`. */
const longer = (wait) => Math.min(Math.max(1, 2 * wait), LONGEST_PAUSE);

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
 * Every call L0 has in flight, by its group, from the step that creates the group until a turn
 * after the call settles, with what the exit cleanup needs to end and record it: the call's `L0`
 * emitter, its `ps` and read timeout, the step its caller handed it for the exit, the command's
 * child process, which says how the command ended where Node has reaped it, the kills the call has
 * made and not yet recorded, and whether the call has emptied the group.
 */
const calls = new Map();

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

/**
 * Installs the exit cleanup, once: on `exit`, and ahead of every other listener on every signal in
 * `HANDLED`. It stays ahead: a listener put ahead of it later has it put back in front before
 * anything else runs, because a signal is only ever emitted from the event loop.
 */
function install() {
  if (installed) return;
  installed = true;
  process.on('exit', cleanup);
  for (const name of HANDLED) process.prependListener(name, onSignal);
  process.on('newListener', (name) => {
    if (HANDLED.includes(name)) queueMicrotask(() => ahead(name));
  });
}

/** Puts `onSignal` first among `name`'s listeners, where it is there at all. */
function ahead(name) {
  const listeners = process.listeners(name);
  if (!listeners.includes(onSignal) || listeners[0] === onSignal) return;
  // Node removes the last instance of a listener added twice, which is the one behind.
  process.prependListener(name, onSignal);
  process.removeListener(name, onSignal);
}

/**
 * On signal `name`, cleans up first, and then leaves the process to end as it would have with no
 * cleanup. So it takes itself off the signal before any other listener runs: they then find only
 * each other, as they would have. Where none is left, Node gives the signal its default action
 * again, and raising it ends the process by it. Where one is left, the process ends as that
 * listener has it, and a process it keeps running has the cleanup back on the signal a turn later.
 *
 * It runs ahead of every other listener, so a `once` listener that has not yet run is still
 * counted, and no listener can end the process before the cleanup has run.
 */
function onSignal(name) {
  cleanup();
  process.removeListener(name, onSignal);
  if (process.listenerCount(name) === 0) process.kill(process.pid, name);
  else setImmediate(() => process.listeners(name).includes(onSignal) || process.prependListener(name, onSignal));
}

/**
 * L0's exit cleanup, synchronous because Node runs an `exit` listener synchronously. It ends every
 * read of the process table still in flight; then, for every call in flight whose group the call
 * has not emptied, it takes the census, kills the group and confirms it; and only then records
 * each kill, the call's own unrecorded kills first, and writes to standard error every kill the
 * sink refused, since no caller is left to report it to. It then takes each caller's step for its
 * group, handing it how the command ended (`endingOf`), which is L1's removal of the group's
 * entry and its record of the dispatch's end; and last the steps handed to `atExit`. A failure in any of these is
 * written to standard error and never stops the rest, nor changes how the process ends.
 *
 * It ends only the calls in flight when it runs, and lets each go, so a process that a signal
 * listener of its caller keeps running has the groups it starts later ended at its next ending.
 * So it can run more than once, and each step handed to `atExit` must bear being taken again, as
 * the sink's end does.
 */
function cleanup() {
  for (const read of reads) read.kill('SIGKILL');
  const ended = [];
  for (const [group, call] of calls) {
    calls.delete(group);
    attempt(() => ended.push([group, call, call.contained ? {} : containNow(group, call)]));
  }
  const unrecorded = ended.flatMap(([, { emitter, events }, { kills = [] }]) => record(emitter, [...events.splice(0), ...kills]));
  if (unrecorded.length > 0) attempt(() => writeWhole(`${refused(unrecorded).message}\n`));
  for (const [group, { onExit, child }, look] of ended) attempt(() => onExit?.(group, endingOf(child, look)));
  for (const step of steps) attempt(step);
}

/**
 * How the command `child` ran ended, as the exit cleanup finds it: `{ exit }`, its exit code, or
 * `{ unread }`, why its status could not be read. Where Node has reaped the command, Node says how
 * it ended. Otherwise the command is a zombie, since Node reaps no child while the cleanup runs,
 * and `leader` is the wait status `ps` read for it as `xstat` on the kill's last look: its own
 * exit where it had exited, or the cleanup's kill. Where that read failed or did not answer, a
 * leader the census found `stopped` and alive was ended by the cleanup's kill. Otherwise `unread`
 * says why, and nothing tells the command's own exit from the kill: the command may have exited
 * before the cleanup ran, and where the census's reads failed too, even a command the cleanup
 * killed cannot be told from one that exited.
 */
function endingOf(child, { leader, unread, stopped }) {
  if (child.exitCode !== null) return { exit: child.exitCode };
  if (child.signalCode !== null) return { exit: signalled(child.signalCode) };
  if (leader === undefined && stopped) return { exit: signalled('SIGKILL') };
  if (leader === undefined) return { unread: `the exit cleanup could not read the command's status: ${unread}` };
  // `ps` prints the wait status in hexadecimal. Its low seven bits are the signal that ended the
  // process, where one did, and the byte above them its exit code (wait(2): WTERMSIG, WEXITSTATUS).
  const status = Number.parseInt(leader, 16);
  const ending = status & 0x7f;
  return { exit: ending === 0 ? (status >> 8) & 0xff : 128 + ending };
}

/**
 * The exit code of a process signal `name` ended. It has none of its own, so it takes the one a
 * shell gives it: 128 and the signal's number, which is never 0.
 */
const signalled = (name) => 128 + constants.signals[name];

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

/**
 * The largest delay, in milliseconds, one of Node's timers keeps. Node owns this fact and exports
 * no name for it. Past it, Node warns with a `TimeoutOverflowWarning` and sets the delay to 1 ms,
 * which would end at once a command given more time than that, so a longer delay is kept over
 * several timers (`whenElapsed`). This copy is tied to Node by a test that asks Node's timer
 * (`D16` rule 2).
 */
export const TIMER_MAX = 2 ** 31 - 1;

/**
 * The `code` of the failure a call rejects with when its command never started, so its caller
 * tells it from a refused event without reading the message.
 */
export const NOT_STARTED = 'NOT_STARTED';

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
const occupied = (group) => answers(-group);

/** Whether signal 0 reaches `target`, a pid or a group's id negated, `EPERM` counting as reached. */
function answers(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Kills every process left in `group` and settles once the group is empty, or once `UNREAPED_BOUND`
 * has passed with no read of its states finding a member that is not a zombie. The wait is on that
 * condition, looked at after each pause, so nothing else in Rigger stops meanwhile.
 *
 * A read that fails, or times out, finds no such member, so the call settles whatever the process
 * table does. A group whose table L0 cannot read is still sent the kill on every look until the
 * bound passes.
 *
 * The kill is sent again on every look, because a process can be in the group without having
 * received it. One forked while the kernel delivers a group kill can miss it and run on: the
 * engineer judge on #354 saw that in 9 of 12 runs of a survivor forking in a loop, macOS 27.0,
 * 2026-09-27, where the group was running at the kill. A census that stopped the group leaves
 * nothing forking, but one that failed may not have. And a process outside the group can join it
 * after the kill while a zombie keeps it in being.
 */
async function ended(group, ps, readTimeout) {
  let unreapedSince;
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) await pause(wait);
    signal(group, 'SIGKILL');
    if (!occupied(group)) return;
    if (wait === 0) continue;
    const looked = Date.now();
    if (await living(group, ps, readTimeout)) {
      unreapedSince = undefined;
    } else {
      unreapedSince ??= looked;
      if (Date.now() - unreapedSince >= UNREAPED_BOUND) return;
    }
  }
}

/**
 * Why `group` may still hold a member that is not a zombie, or nothing where it holds none: signal 0
 * reaches it, and a read of its states finds such a member, or fails. A read that lists no process
 * while signal 0 still reaches the group is taken again, because a member that is exiting still
 * answers signal 0 (`occupied`) and may not be listed, until the group no longer answers or
 * `timeout` has passed, which counts as holding one. Each read has `timeout` of its own, so one
 * begun near that bound fails only where the read itself does. Only a read that found such a
 * member says it saw one.
 *
 * One case is left unrecorded, and nothing but the process table can close it (`D16` rule 3): a
 * table that leaves a live member of the group out of every read, of the census, the kill and this
 * one alike, while listing the group's zombies. Signal 0 reaches a zombie, and a group holding only
 * a zombie, as it reaches a live process: measured with Node 26.5.0 on macOS 27.0 on 2026-09-27,
 * `process.kill(pid, 0)` succeeded on a zombie, and a group left holding only a zombie its parent
 * outside the group never reaps kept answering signal 0 (`UNREAPED_BOUND`). So only the table
 * tells a zombie from a live process, and such a table reads exactly as a group holding only
 * zombies does. Recording the group's kill whenever signal 0 reaches the group would record the
 * kill of every group left holding only zombies, which L0 did not end, so the group's kill then
 * ends that hidden member unrecorded.
 */
async function outlived(group, ps, timeout) {
  const deadline = Date.now() + timeout;
  const unseen = ', so the kill of the group may have ended a process the census and the kill had not named';
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) await pause(wait);
    if (!occupied(group)) return undefined;
    if (Date.now() >= deadline) return `the reads of the group before its kill listed no process for ${timeout} ms while signal 0 still reached it${unseen}`;
    let states;
    try {
      states = [...(await statesOf(group, ps, timeout)).values()];
    } catch (error) {
      return `the read of the group before its kill failed while signal 0 still reached it${unseen}: ${error.message}`;
    }
    if (states.length === 0) continue;
    if (states.some((state) => !state.startsWith('Z'))) return 'the group still held a live process the census and the kill had not named, which the kill of the group ended';
    return undefined;
  }
}

/** Whether a read of `group`'s states finds a member that is not a zombie. One that fails does not. */
async function living(group, ps, timeout) {
  try {
    return [...(await statesOf(group, ps, timeout)).values()].some((state) => !state.startsWith('Z'));
  } catch {
    return false;
  }
}

/** Each process in `group` and its state, by pid, read in one `ps` run given up on after `timeout` ms. */
const statesOf = async (group, ps, timeout) => rowsOf(await run(ps, ['-g', String(group), '-o', 'pid=,stat='], timeout, timeout));

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
 * given, and takes back what `ps` printed, and each pause before it tries again, as milliseconds.
 * So one census serves the call, which waits on each read and each pause, and the exit cleanup,
 * which can wait on none, and tries again at once (`reading` and `readingNow`).
 *
 * The group is stopped first, because a stopped process cannot exec. One `ps` run reads a
 * process's name from the process table and its arguments a moment later, so a process that
 * execs in between is named by one image and described by the other: the engineer judge on #354
 * measured that in 16 of 3,000 direct reads, and 34 of 1,500 calls to this adapter, before the
 * group was stopped. So the census reads the states, then the names, then the command lines,
 * then the states again, each in a `ps` run of its own. It keeps them only when both state reads
 * find every member stopped, or a zombie, and all four reads find the same processes. Otherwise it pauses, then stops the group again and reads again:
 * a member not yet stopped is one the signal has not reached, one caught mid-exec (state `?`), or
 * a fork the signal missed. A zombie cannot exec either, and is left out, because it is already
 * dead.
 *
 * Reads that agree on no process at all are kept only where signal 0 no longer reaches the group,
 * because a read that failed can list nothing, even one that exits 1 and prints nothing (`run`).
 * While the group still answers, the census reads again, and where `timeout` passes first it fails
 * saying so, and the group is killed unnamed.
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
 * - `ucomm` is the executable's name as the kernel holds it, cut to 16 bytes, so a name longer
 *   than that is recorded as its first 16 bytes, less any spaces they end in: `abcdefghijklmnopq`
 *   is recorded as `abcdefghijklmnop`, and `abcdefghijklmno xyz` as `abcdefghijklmno`. A cut can fall inside a character and leave bytes that are not UTF-8 (the
 *   engineer judge on #354 saw `日本語テール` recorded as `日本語テー` and U+FFFD).
 * - `ucomm` is padded with spaces to 16 columns, even as the last column, so a name's own trailing
 *   spaces cannot be recovered, and are not recorded. `sp` and `sp` with a space print the same
 *   17 bytes, and so do `abcdefghijklmno`, the same with a space, and the same with a space and
 *   `x`, under every `ucomm` form and locale tried. Other trailing whitespace is the name's own:
 *   a trailing newline or tab is recorded.
 * - `ucomm` prints control characters raw, a newline included, so a name `x`, newline,
 *   `<pid> evil` read in the group's table named that other pid's process `evil` (the engineer
 *   judge on #354). It names what runs, not what was asked for: a script run by `/bin/sh` is
 *   named `bash`.
 * - `-c` makes `command` argv[0]'s last part, not the executable's name: `exec -a Tx` shows `Tx`.
 * - `stat`'s first character is the process's state: `T` stopped, `Z` a zombie, `?` caught
 *   mid-exec.
 * - `xstat` is a zombie's wait status in hexadecimal: `0` for a process that exited 0, `300` for
 *   one that exited 3, `9` for one `SIGKILL` ended and `f` for one `SIGTERM` ended. It is there to
 *   read only while the zombie's parent has not reaped it.
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
 *   read is not listed, and one that joins it after the read is recorded only as the kill of the
 *   group, where a later read finds it (`killedOf`, `contain`).
 * - `ps` exits 1, printing nothing, when no process matches, and writes to standard error when a
 *   read fails (`run`).
 */
function* census(group) {
  // Whether the census's last reads that agreed named no process while the group still had one.
  let unseen = false;
  const read = function* (args) {
    try {
      return yield args;
    } catch (error) {
      throw unseen ? new Error(`the census's reads named no process of the group while it still had one: ${error.message}`) : error;
    }
  };
  const column = function* (name) {
    return rowsOf(yield* read(['-ww', '-g', String(group), '-o', `pid=,${name}=`]));
  };
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) yield wait;
    signal(group, 'SIGSTOP');
    const before = yield* column('stat');
    if (!stopped(before)) continue;
    const names = yield* namesOf([...before.keys()], read);
    const commands = yield* column('command');
    const after = yield* column('stat');
    if (!stopped(after) || ![before, names, commands].every((each) => samePids(each, after))) continue;
    unseen = after.size === 0 && occupied(group);
    if (unseen) continue;
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
 *
 * So the census grows with the group. Measured with `/bin/ps` from adv_cmds-240 and Node 26.5.0
 * on macOS 27.0 (26A428) on 2026-09-27, on 12 cores: 300 such reads, one per `tail` in one group,
 * took 1.09 to 1.23 ms each over three runs at a load average of about 23, and 2.13 to 3.29 ms
 * each over three more at about 9. One read of that group's command lines took 9 to 15 ms. At
 * 3.29 ms a survivor, the names alone reach `READ_TIMEOUT` at about 1,500 survivors, and fewer
 * once the group's other reads are counted. Such a group is killed unnamed.
 */
function* namesOf(pids, read) {
  const names = new Map();
  for (const pid of pids) {
    const printed = yield* read(['-p', String(pid), '-o', 'ucomm=']);
    // `ps` ends the name with its padding, spaces alone, and a newline, which are not the name's own.
    if (printed !== '') names.set(pid, printed.replace(/ *\n$/, ''));
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
 * Runs each read of the process table `looks` yields in `ps`, one at a time, and waits out each
 * pause it yields, and hands back what `looks` returns. The reads are given up on `timeout`
 * milliseconds after the first starts.
 */
async function reading(looks, ps, timeout) {
  const deadline = Date.now() + timeout;
  let look = looks.next();
  while (!look.done) {
    if (typeof look.value === 'number') {
      await pause(look.value);
      look = looks.next();
    } else {
      let printed;
      try {
        printed = await run(ps, look.value, deadline - Date.now(), timeout);
      } catch (error) {
        look = looks.throw(error);
        continue;
      }
      look = looks.next(printed);
    }
  }
  return look.value;
}

/** `reading`, synchronously, for the exit cleanup, which passes over each pause. */
function readingNow(looks, ps, timeout) {
  const deadline = Date.now() + timeout;
  let look = looks.next();
  while (!look.done) {
    if (typeof look.value === 'number') {
      look = looks.next();
      continue;
    }
    let printed;
    try {
      printed = runNow(ps, look.value, deadline - Date.now(), timeout);
    } catch (error) {
      look = looks.throw(error);
      continue;
    }
    look = looks.next(printed);
  }
  return look.value;
}

/** How `ps` is run besides its environment: killed outright at `remaining` milliseconds. */
const reader = (remaining) => ({ timeout: remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8' });

/** The failure for a census that ran out of time between reads. */
const late = (timeout) => new Error(`the census found the group not all stopped within ${timeout} ms`);

/** The failure for a read of the process table that wrote `stderr`, which `ps` does only on a failure (`run`). */
const failed = (stderr) => new Error(`the process-table read failed: ${stderr.trim()}`);

/** The failure for a read of the process table that ran out of time. */
const timedOut = (timeout) => new Error(`the process-table read timed out after ${timeout} ms`);

/**
 * What one run of `ps`, at the path `ps` names, prints given `args`, or nothing where no process
 * matches. It is given up on after `remaining` milliseconds of the census's `timeout`. A run that
 * writes anything to standard error has failed, whatever its exit code.
 *
 * How `ps` reports that no process matched, against a read that failed (`D16` rule 3), measured
 * with `ps` from adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-28: each of the adapter's five
 * forms of read, given a group or pid that holds no process, exits 1 and writes nothing to either
 * stream. Given a group `x`, a group `999999` or an unknown keyword, it exits 1 and writes why to
 * standard error. The source of adv_cmds-237, the latest Apple publishes, agrees: `ps` exits 1
 * with nothing written only once it kept no process, and every failure it reports is written to
 * standard error, one of them, a failed read of the kernel's table, with exit 0 and nothing on
 * standard output. So exit 1 with nothing on either stream is the one answer that shows no process
 * matched.
 *
 * What `ps` cannot show is that the kernel handed it every process there is, so neither the census
 * nor the kill takes a process as gone because a read left it out (`census`, `killedOf`).
 */
function run(ps, args, remaining, timeout) {
  return new Promise((resolve, reject) => {
    if (remaining <= 0) return reject(late(timeout));
    const read = execFile(ps, args, { env: PS_ENV, ...reader(remaining) }, (error, stdout, stderr) => {
      reads.delete(read);
      if (error?.killed) return reject(timedOut(timeout));
      if (stderr !== '') return reject(failed(stderr));
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
  const { error, status, signal: ending, stdout, stderr } = spawnSync(ps, args, { env: PS_ENV, ...reader(remaining) });
  if (error?.code === 'ETIMEDOUT') throw timedOut(timeout);
  if (error) throw error;
  if (stderr !== '') throw failed(stderr);
  if (status !== 0 && !(status === 1 && stdout === '')) throw new Error(`${ps} ${args.join(' ')} ended with ${status ?? ending}`);
  return stdout;
}

/**
 * Ends what is left of `group`, once its command has exited or at its timeout, in the order that
 * keeps each name: the census, which stops the group and reads it while its processes still
 * exist; the kill, which reads how each survivor ended; the confirmation that the group is empty;
 * and only then the `L0` events to record, one `killed` event per process the kill ended, which it
 * hands back. A census or a kill whose read fails still kills the group, and hands back the kill
 * of the group with why its processes went unnamed.
 *
 * A kill whose reads all left out a live member ends without having named it, and the group's
 * kill then ends it. So before that kill the group is read once more, and where it still holds a
 * member that is not a zombie, or signal 0 reaches it and the read fails or lists nothing until
 * `readTimeout`, the kill of the group is handed back beside the processes the kill named, saying
 * which (`outlived`). A process that joins the group after that read is ended by the group's kill
 * unrecorded, and so is one the table hides from every read while listing the group's zombies
 * (`outlived` says why no read can find it).
 */
async function contain(group, { ps, readTimeout }, killed) {
  if (!occupied(group)) return [];
  let dead;
  let unnamed;
  try {
    const survivors = await reading(census(group), ps, readTimeout);
    dead = await killedOf(survivors, group, ps, readTimeout).catch((error) => {
      throw new Error(`the kill could not read how every survivor ended: ${error.message}`);
    });
  } catch (error) {
    unnamed = error.message;
  }
  const left = unnamed === undefined ? await outlived(group, ps, readTimeout) : undefined;
  await ended(group, ps, readTimeout);
  if (unnamed !== undefined) return [['group.killed', { group, census: unnamed }]];
  const named = dead.map((survivor) => [killed, survivor]);
  if (left === undefined) return named;
  return [...named, ['group.killed', { group, census: left }]];
}

/**
 * `contain`, synchronously, for the exit cleanup, with the kill confirmed by `emptied`. Where the
 * confirmation's reads fail or run out of time, the group has had the kill on every look until
 * then, and the cleanup goes on: it cannot wait longer on a process table it cannot read.
 */
function containNow(group, { ps, readTimeout }) {
  if (!occupied(group)) return { kills: [] };
  let survivors;
  let unnamed;
  try {
    survivors = readingNow(census(group), ps, readTimeout);
  } catch (error) {
    unnamed = error.message;
  }
  let leader;
  let unread;
  try {
    leader = readingNow(emptied(group), ps, readTimeout);
    if (leader === undefined) unread = 'the process table did not list it';
  } catch (error) {
    // The kill was sent on every look, and nothing is left to wait on.
    unread = error.message;
  }
  // A leader the census named was stopped and alive, and a stopped process cannot exit on its own,
  // so the cleanup's kill is what ended it, whatever the last read could tell.
  const stopped = survivors?.some(({ pid }) => pid === group) ?? false;
  return { kills: killsOf(group, survivors, unnamed, 'survivor.killed'), leader, unread, stopped };
}

/**
 * Kills every process left in `group` until it holds nothing but zombies, for the exit cleanup,
 * and hands back the wait status `ps` reads for the group's leader, where it is still there.
 * Node reaps no child while synchronous code runs, so a leader killed here stays in the group as a
 * zombie until this process exits, and the group never empties while the cleanup runs. So each
 * look reads the group's states, and a group of zombies is ended: none of them can run again.
 */
function* emptied(group) {
  for (;;) {
    signal(group, 'SIGKILL');
    if (!occupied(group)) return undefined;
    const states = rowsOf(yield ['-g', String(group), '-o', 'pid=,stat=,xstat=']);
    if ([...states.values()].every((state) => state.startsWith('Z'))) return states.get(group)?.split(/\s+/)[1];
  }
}

/**
 * The `L0` events for a group killed after a census found `survivors`, each a `killed` event, or
 * failed as `unnamed`.
 */
function killsOf(group, survivors, unnamed, killed) {
  if (unnamed !== undefined) return [['group.killed', { group, census: unnamed }]];
  return survivors.map((survivor) => [killed, survivor]);
}

/**
 * Kills the stopped `group`'s live members, those with no live child first, and hands back each
 * of `survivors` that L0's kill ended, given up on `timeout` milliseconds after it starts.
 *
 * A survivor can exit on its own after any read of the table and before L0's kill lands, and its
 * parent, stopped, leaves it a zombie, which signal 0 still reaches. Its exit status tells the two
 * apart: `xstat` reads `9` for a process `SIGKILL` ended. So each round reads the group, sorts out
 * each survivor sent the kill since the round before, by that status, and sends the kill to each
 * live member none of whose children is live. Its parent is then alive, and stopped, until a later
 * round, so it stays a zombie until a read sees how it ended. A survivor that is gone, or a zombie,
 * before L0 sent it the kill exited on its own, and so does one the kill found gone (`ESRCH`),
 * reaped at once by a parent the group does not hold. One gone after the kill reached it is
 * counted as killed, because such a parent may reap it at once.
 *
 * So one window is left open, and the process table cannot close it (`D16` rule 3, measured with
 * `ps` from adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-27): a survivor that exits on its own
 * as L0's kill reaches it, and whose parent outside the group reaps it before the next read, is
 * counted as killed. How a process ended is in the table only as its zombie's `xstat`, which `ps`
 * shows until the parent reaps it and never after. A parent the group does not hold is not
 * stopped, so it can reap before any read, and the table then holds nothing to tell that exit
 * from L0's kill. A read that fails, or a group still not ended at `timeout`, fails the whole,
 * and the group is killed unnamed.
 *
 * A survivor a read leaves out is gone only where signal 0 no longer reaches it. A read that failed
 * can leave out a live one, even one that exits 1 and prints nothing, which `ps` reports only when
 * the kernel handed it no process (`run`). So such a survivor stays to be read again, and a table
 * that goes on leaving it out holds the kill to `timeout`, where the group is killed unnamed. So
 * does a survivor's pid the system has handed on to another process meanwhile.
 *
 * The census's reads can fail the other way, agreeing on only some of the group's live members.
 * So each live member a read of the kill finds must be one the census named, and the kill fails
 * where it finds another, so the group is killed unnamed rather than that process ended
 * unrecorded. The kill reads the table at least once, even where the census named no one.
 *
 * After a round that sees a survivor end, or sends the kill, the next begins once `ROUND_SHARE`
 * times the processor time the kill has used has passed since it began, and after one that sees
 * nothing move, it pauses as a wait does, so a group killed in many rounds is not read back to
 * back. That pacing is what holds the kill's processor time under a tenth of its wall-clock time,
 * and it holds only while the deadline leaves room.
 *
 * Room is the time left before the deadline after holding back, for each round still to come,
 * three times what a round has cost on average so far. The rounds still to come are taken as one
 * more than the depth of the live tree. Each pause is capped at its share of that room, so the pace
 * tightens as the deadline nears. Where no room is left the cap is zero, and the rounds run back to
 * back, over the tenth. Close to the deadline, naming the group's processes takes precedence over
 * that bound, so a kill that reading alone could finish in time is not pushed past the deadline and
 * killed unnamed.
 */
async function killedOf(survivors, group, ps, timeout) {
  const deadline = Date.now() + timeout;
  const pending = new Map(survivors.map((survivor) => [survivor.pid, survivor]));
  const named = new Set(pending.keys());
  const sent = new Set();
  const killed = [];
  const [began, used] = [performance.now(), process.cpuUsage()];
  let [rounds, paused] = [0, 0];
  for (let wait = 0; rounds === 0 || pending.size > 0; ) {
    if (wait > 0) await pause(wait);
    paused += wait;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`not every survivor had ended within ${timeout} ms`);
    const table = tableOf(await run(ps, ['-g', String(group), '-o', 'pid=,ppid=,stat=,xstat='], remaining, timeout));
    let moved = false;
    for (const [pid, survivor] of pending) {
      const row = table.get(pid);
      if (row !== undefined && !row.state.startsWith('Z')) continue;
      if (row === undefined && !sent.has(pid) && answers(pid)) continue;
      if (sent.has(pid) && (row === undefined || row.status === '9')) killed.push(survivor);
      pending.delete(pid);
      moved = true;
    }
    const living = [...table].filter(([, row]) => !row.state.startsWith('Z'));
    const unnamed = living.find(([pid]) => !named.has(pid));
    if (unnamed) throw new Error(`the kill found process ${unnamed[0]} in the group, which the census did not name`);
    const parents = new Set(living.map(([, row]) => row.parent));
    for (const [pid] of living) {
      if (parents.has(pid) || sent.has(pid) || !end(pid)) continue;
      sent.add(pid);
      moved = true;
    }
    rounds += 1;
    const { user, system } = process.cpuUsage(used);
    const elapsed = performance.now() - began;
    const paced = moved ? (ROUND_SHARE * (user + system)) / 1000 - elapsed : longer(wait);
    const left = depthOf(living) + 1;
    const spare = deadline - Date.now() - 3 * left * ((elapsed - paused) / rounds);
    wait = Math.max(0, Math.min(paced, spare / left));
  }
  return killed;
}

/** The length of the longest line of parent and child among the `living` rows of a table. */
function depthOf(living) {
  const parents = new Map(living.map(([pid, row]) => [pid, row.parent]));
  const depths = new Map();
  const depth = (pid) => {
    if (!parents.has(pid)) return 0;
    if (!depths.has(pid)) depths.set(pid, 1 + depth(parents.get(pid)));
    return depths.get(pid);
  };
  return [...parents.keys()].reduce((deepest, pid) => Math.max(deepest, depth(pid)), 0);
}

/** Each row of a read of `pid=,ppid=,stat=,xstat=`, by pid. */
function tableOf(printed) {
  const rows = new Map();
  for (const line of printed.split('\n').filter(Boolean)) {
    const row = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (!row) throw new Error(`the process table held a row the kill cannot read: ${JSON.stringify(line)}`);
    rows.set(Number(row[1]), { parent: Number(row[2]), state: row[3], status: row[4] });
  }
  return rows;
}

/** Sends `SIGKILL` to the process `pid`, and whether it was there to send to. */
function end(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return false;
  }
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

/**
 * The failure for a call whose `unrecorded` events the sink refused, carrying its `result`, its
 * message opening with `ending` where that says how the command ended.
 */
function refused(unrecorded, result, ending = '') {
  const lines = unrecorded.map(({ event, cause, ...fields }) => `${event} ${JSON.stringify(fields)}: ${cause.message}`);
  const error = new Error(`${ending}the sink refused ${unrecorded.length} L0 event(s), so they went unrecorded:\n${lines.join('\n')}`);
  return Object.assign(error, { code: EVENT_REFUSED, unrecorded, result });
}

/**
 * Runs `command` with `args` in `cwd` under exactly `env`, in a process group of its own, for at
 * most `timeout` milliseconds, and settles on its exit code, whether the timeout ended it, and the
 * bytes it wrote to standard output and standard error.
 *
 * The order is fixed: the command exits, or at its timeout L0 kills its whole group, the command
 * with it, and confirms the group is empty; L0 kills what is left of its group and confirms it is
 * empty; L0 reads both pipes until they close, or until `outputBound` milliseconds have passed,
 * where a process outside the group holds one open; L0 records each kill, and any such hold; the
 * call settles. So the output is everything the group wrote until that kill, and neither a
 * survivor nor a process that left the group holds the call open.
 *
 * A command the timeout or any signal ended has a non-zero exit code, so it never reads as
 * returned. A command that never started has no result: the call rejects with a `NOT_STARTED`
 * failure naming what failed.
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
 * L0 holds the call from the step that creates the group until a turn after the call settles. Where
 * the process exits meanwhile, L0's exit cleanup kills the group where the call has not emptied
 * it, records every kill, and then hands the group and how the command ended to `onExit`, where
 * the caller gives one: `{ exit }`, its exit code, or `{ unread }`, why it could not be read.
 * `onExit` is a synchronous step, which is how L1 removes a dispatch's entry and records its end.
 * The step can come after the call has settled, in the turn it settled, and must then do
 * nothing for a call its caller has finished. A process kept running past its ending still has the
 * call settle, on the command's result.
 */
export async function runCommand({ command, args, cwd, env, timeout, emitter, onGroup, onExit, ps = PS, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND }) {
  // The caller opens the emitter, so an `L0` event carries the card L0 never knows. There is no
  // default: a kill with nowhere to be recorded is refused before anything starts, and an emitter
  // is only one that has an `emit` to call.
  if (typeof emitter?.emit !== 'function') throw new Error(`the process adapter was given no L0 emitter, so it did not start ${command}`);
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    // The type is named because a string, a bigint or a boxed number prints as the number it holds.
    const type = timeout === null ? 'null' : typeof timeout;
    throw new Error(`the process adapter was given the timeout ${shown(timeout)} (of type ${type}), which is not a positive finite number of milliseconds, so it did not start ${command}`);
  }
  const unfit = unusable(cwd);
  if (unfit !== undefined) throw notStarted(command, unfit);
  const child = spawned(command, () => spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  // Where the spawn failed after it returned, Node gives the child no pid and emits why after.
  if (child.pid === undefined) throw notStarted(command, (await once(child, 'error'))[0].message);
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  install();
  const call = { emitter, ps, readTimeout, onExit, child, events: [], contained: false };
  calls.set(child.pid, call);
  // A call the exit cleanup took is one it has ended and recorded, so the call records nothing
  // more of it.
  const taken = () => !calls.has(child.pid);
  // The call is let go a turn after it settles, and not as it settles, because the caller's code
  // after its await runs in the turn it settles: an ending in that turn still reaches the caller's
  // step, which must then do nothing for a call it has finished.
  const release = () => setImmediate(() => calls.get(child.pid) === call && calls.delete(child.pid)).unref();
  try {
    if (onGroup) onGroup(child.pid, startOf(ps, child.pid, readTimeout));
  } catch (refusal) {
    // A group the caller could not take runs no further: it is ended, and recorded, as a
    // survivor would be, before the caller hears why.
    // Nothing reads the output of a command that runs no further, so its pipes are let go.
    const kills = await contain(child.pid, { ps, readTimeout }, 'survivor.killed');
    call.contained = true;
    const unrecorded = record(emitter, taken() ? [] : kills);
    release();
    child.stdout.destroy();
    child.stderr.destroy();
    if (unrecorded.length > 0) throw Object.assign(refused(unrecorded), { cause: refusal });
    throw refusal;
  }
  const { events } = call;
  const exited = once(child, 'exit');
  const expired = await outlasts(exited, timeout);
  // The kills at the timeout wait among the call's unrecorded kills, so an exit meanwhile records
  // them.
  if (expired) events.push(...(await contain(child.pid, { ps, readTimeout }, 'timeout.killed')));
  const [code, signal] = await exited;
  // The timeout ended the command only where the kill did. One that exited on its own between the
  // timer and the kill ended itself, with its own exit code.
  const timedOut = expired && signal !== null;
  // A command that exited on its own did so before the containment stopped its group, because a
  // stopped process cannot exit, so every process that containment killed outlived the command.
  if (!timedOut) for (const kill of events) if (kill[0] === 'timeout.killed') kill[0] = 'survivor.killed';
  const exit = signal === null ? code : signalled(signal);
  events.push(...(await contain(child.pid, { ps, readTimeout }, 'survivor.killed')));
  call.contained = true;
  if (await outlasts(output, outputBound)) {
    // Closing the pipes lets go of their handles, which would otherwise hold this process open.
    child.stdout.destroy();
    child.stderr.destroy();
    events.push(['output.held', { group: child.pid, bound: outputBound }]);
  }
  const [stdout, stderr] = await output;
  const result = { exit, timedOut, stdout, stderr };
  const unrecorded = record(emitter, taken() ? [] : events.splice(0));
  release();
  if (unrecorded.length > 0) throw refused(unrecorded, result, timedOut ? `the timeout of ${timeout} ms ended ${command}, and ` : '');
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
 * leader's start is the one recorded. A leader that is a zombie is dead, and `starts` holds none.
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
 * So a read that stalls blocks the event loop, and everything else in the process, for up to
 * `timeout`, which is `READ_TIMEOUT` unless the caller gives another. The engineer judge on #365
 * measured it (N2): with a `ps` that never answered and a timeout of 2,000 ms, a 20 ms timer fired
 * 1,985 ms late, and the call rejected with the group killed.
 *
 * The read is synchronous all the same, because L1 writes a dispatch's entry, its leader's start
 * time included, in the step that creates the group, before the call yields (the architect's
 * ruling 1, P2, on #332). A read that waited on the event loop would yield first.
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
  const read = spawnSync(ps, ['-p', String(pid), '-o', 'lstart='], { env: PS_ENV, timeout, killSignal: 'SIGKILL', encoding: 'utf8' });
  // A read that wrote to standard error has failed whatever its exit code, as `run` holds.
  const failure = read.error?.message ?? (read.stderr !== '' ? read.stderr.trim() : undefined) ?? (read.status !== 0 ? `${ps} ended with ${read.status ?? read.signal}` : undefined);
  if (failure !== undefined) throw new Error(`L0 could not read when the leader of group ${pid} started, so it ended the group: ${failure}`);
  return secondsOf(read.stdout.replace(/\n$/, ''));
}

/**
 * The start time of each live process in `group`, by its pid, read as `startOf` reads one. A
 * zombie is left out: it has exited, though `ps` still lists it, with its start time, until its
 * parent reaps it. So a leader that has exited reads as dead whether or not it has been reaped.
 */
async function startsIn(ps, group, timeout) {
  const rows = rowsOf(await run(ps, ['-ww', '-g', String(group), '-o', 'pid=,stat=,lstart='], timeout, timeout));
  const live = [...rows].map(([pid, row]) => [pid, /^(\S+)\s+(.*)$/.exec(row)]).filter(([, row]) => !row?.[1].startsWith('Z'));
  return new Map(live.map(([pid, row]) => [pid, secondsOf(row?.[2] ?? '')]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A start time as `ps` prints it under `PS_ENV`, such as `Mon Sep 28 03:50:08 2026`, in whole seconds since the epoch. */
function secondsOf(printed) {
  const at = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4}) *$/.exec(printed);
  const month = MONTHS.indexOf(at?.[1]);
  if (month < 0) throw new Error(`the process table held a start time L0 cannot read: ${JSON.stringify(printed)}`);
  return Date.UTC(Number(at[6]), month, Number(at[2]), Number(at[3]), Number(at[4]), Number(at[5])) / 1000;
}

/**
 * The child `spawning` makes to run `command`. Where the spawn throws, which Node does for some
 * of the causes of a command that never starts, a `NOT_STARTED` failure naming the command and why.
 */
function spawned(command, spawning) {
  try {
    return spawning();
  } catch (error) {
    throw notStarted(command, error.message);
  }
}

/**
 * Why `cwd` cannot be a command's working directory, or nothing where it can. The file system
 * decides, and is asked before the spawn because Node reports a missing `cwd` as
 * `spawn <command> ENOENT`, naming the command and not the directory.
 *
 * Where this answer can differ from what the spawn would have found, measured with Node 26.5.0
 * on macOS 27.0 (26A428) on 2026-09-27, spawning `/bin/pwd` detached with both outputs piped:
 *
 * - The check and the spawn read the directory at two moments, so one removed or replaced between
 *   them passes the check and fails the spawn. That spawn then reports what Node reports, which
 *   for a missing directory is `spawn /bin/pwd ENOENT`, naming the command alone. The call still
 *   rejects as a failure to start.
 * - Every `cwd` the spawn reads as unset, the check refuses, while the spawn runs the command in
 *   the caller's own working directory. This covers the whole class the spawn so reads, as far as
 *   it was measured: `undefined` and `null` (`ERR_INVALID_ARG_TYPE` from the check), and `''` and
 *   an empty `Buffer` (`ENOENT`). For each, `/bin/pwd` exited 0 and printed the caller's
 *   directory. Of the other values tried, `false`, `0`, `NaN`, `[]` and `{}` made the spawn
 *   throw `ERR_INVALID_ARG_TYPE` too, and `' '` failed it with `ENOENT`, so for those the two
 *   agree.
 * - Elsewhere the two agreed: a missing directory and a dangling link (`ENOENT` from both), a file
 *   (not a directory here, `ENOTDIR` from the spawn), a link loop (`ELOOP` from both), a
 *   directory of mode 000 or 444 (`EACCES` from both), and one of mode 111, which both accept.
 */
function unusable(cwd) {
  try {
    if (!statSync(cwd).isDirectory()) return `its working directory ${cwd} is not a directory`;
    accessSync(cwd, files.X_OK);
    return undefined;
  } catch (error) {
    return `its working directory ${cwd} cannot be used: ${error.message}`;
  }
}

/**
 * `value` as text for a refusal, never blank, which no value can make throw. It is the first of
 * these that prints something: its own conversion; Node's `inspect`; and `inspect` ignoring the
 * value's own hook for it, which prints what an object holds. A conversion can throw, as a
 * Symbol's does in a template literal and a null-prototype object's does anywhere, or print
 * nothing, as `[]` and `''` do, and a value's own hook can do either. Where every one fails, the
 * refusal says so; no value tried reached that.
 */
function shown(value) {
  const ways = [() => String(value), () => inspect(value, { breakLength: Infinity }), () => inspect(value, { breakLength: Infinity, customInspect: false })];
  for (const way of ways) {
    try {
      const text = way();
      if (text.trim() !== '') return text;
    } catch {
      // The next way is tried.
    }
  }
  return 'that cannot be printed';
}

/** The failure for a call whose `command` never started, saying `why`. */
const notStarted = (command, why) => Object.assign(new Error(`the process adapter did not start ${command}: ${why}`), { code: NOT_STARTED });

/**
 * Calls `done` once `delay` milliseconds have passed, and hands back what cancels that. A delay
 * past `TIMER_MAX` is kept over a chain of timers, each of at most `TIMER_MAX`, adding up to it.
 * `schedule` and `cancel` are Node's timers unless a test gives its own.
 *
 * No timer holds the process open, so one left armed never keeps the caller from exiting. What the
 * delay races holds the process open itself where it must: a running command's child handle, and
 * the pipes it writes to.
 */
export function whenElapsed(delay, done, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer;
  const arm = (left) => {
    const step = Math.min(left, TIMER_MAX);
    timer = schedule(() => (left > step ? arm(left - step) : done()), step);
    timer.unref?.();
  };
  arm(delay);
  return () => cancel(timer);
}

/** Whether `promise` is still unsettled once `bound` milliseconds have passed. */
async function outlasts(promise, bound) {
  let stop;
  const passed = new Promise((resolve) => { stop = whenElapsed(bound, () => resolve(true)); });
  const outlasted = await Promise.race([promise.then(() => false), passed]);
  stop();
  return outlasted;
}
