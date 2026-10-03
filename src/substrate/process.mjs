// ABOUTME: L0's process adapter: it runs one command in a process group of its own, ends the group at
// the command's timeout, and once the command exits, kills what is left of that group and, for a
// dispatch, every process of its user working in the dispatch's directory, records each process it
// killed, and stops reading output a process outside the group holds open. On a start, it kills a
// group a dead engine recorded, once it has confirmed that group is the one recorded, and what works
// in its dispatch's directory. On the process's own exit it kills every group it holds.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { accessSync, constants as files, realpathSync, statSync } from 'node:fs';
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
 * How long after its first kill of a group L0 goes on killing a member that is still alive, and how
 * long after its kill of a process working in a dispatch's directory it waits for that process to
 * end, before it records the process as one it could not end and settles (`R-STATE-19`). A member
 * L0 may not signal is recorded once two looks in a row find it so (`unended`). The exit cleanup
 * waits on its own bound, the read timeout, in its place. A judgment, not a measurement, set by the
 * architect (ruling 15). Its premise is that it stays at least ten times above the kill loop's
 * worst case, measured from its first kill of the group to its last, with Node 26.5.0 on macOS 27.0
 * (#539):
 *
 * - worst 94.6 ms, in 6 rounds, over 10 runs of the 250-deep chain test in
 *   `test/process-adapter.test.mjs` at `7a67ffd`, each started at a one-minute load of 24 or less,
 *   on 2026-10-03;
 * - one round in each of the 12 calls whose group was still occupied at the kill, over 22 runs of
 *   300 `git fetch`es each through this adapter at `1bbd7ec`, started at loads of 60.97 to 125.82,
 *   on 2026-10-02.
 *
 * Ten seconds is over 100 times the worst of those. How long the loop takes against a group that
 * forks rapidly without bound was not measured (`ended`).
 */
export const KILL_BOUND = 10_000;

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

/**
 * Each `ps` a read of which the exit cleanup gave up on as it ran, by the timeout it waited out.
 * The cleanup reads it no more, so a process table that never answers holds the process's ending
 * back by one read timeout, and not by one for each read of each group it holds (`runNow`).
 */
const unanswered = new Map();

/**
 * When the exit cleanup's reads of the process table began to fail, where the last one failed: the
 * start of the first read of the run that failed. So it waits out `UNREAPED_BOUND` on a table it
 * cannot read once, whatever the groups it holds, and a read that hung for that long uses it up
 * (`emptied`, `runNow`).
 */
let unreadSince;

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

/**
 * Whether the exit cleanup is installed, which L0 does before it creates its first group. Before,
 * because a signal with no listener ends the process by the signal's default action at once, so
 * one that landed between the spawn and the install would leave the new group running, unkilled
 * and unrecorded.
 */
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
 * has not emptied, it ends the group as the call would have, and confirms it (`containNow`); and
 * only then records
 * each kill, the call's own unrecorded kills first, and writes to standard error every kill the
 * sink refused, since no caller is left to report it to. It then takes each caller's step for its
 * group, handing it how the command ended (`endingOf`), which is L1's removal of the group's
 * entry and its record of the dispatch's end; and last the steps handed to `atExit`. A failure in any of these is
 * written to standard error and never stops the rest, nor changes how the process ends.
 *
 * It ends only the calls in flight when it runs, and lets each go, so a process that a signal
 * listener of its caller keeps running has the groups it starts later ended at its next ending.
 * So it can run more than once, and each step handed to `atExit` must bear being taken again, as
 * the sink's end does. Each time it runs, it reads again a process table it gave up on before
 * (`unanswered`).
 */
function cleanup() {
  for (const read of reads) read.kill('SIGKILL');
  unanswered.clear();
  unreadSince = undefined;
  const ended = [];
  for (const [group, call] of calls) {
    calls.delete(group);
    attempt(() => ended.push([group, call, call.contained ? {} : endedNow(group, call)]));
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
 * leader the read just before the kill found `alive` was ended by the cleanup's kill, unless it
 * exited on its own between that read and the kill (`contain`). Otherwise `unread`
 * says why, and nothing tells the command's own exit from the kill: the command may have exited
 * before the cleanup ran, and where the census's reads failed too, even a command the cleanup
 * killed cannot be told from one that exited.
 */
function endingOf(child, { leader, unread, alive }) {
  if (child.exitCode !== null) return { exit: child.exitCode };
  if (child.signalCode !== null) return { exit: signalled(child.signalCode) };
  if (leader === undefined && alive) return { exit: signalled('SIGKILL') };
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
const occupied = (group, kill = SIGNAL) => answers(-group, kill);

/**
 * L0's signal call, `process.kill`, which a caller can stand in for, as it can for `ps`: it takes a
 * pid, or a group's id negated, and a signal, and throws as `process.kill` throws.
 */
const SIGNAL = (target, name) => process.kill(target, name);

/** Whether signal 0 reaches `target`, a pid or a group's id negated, through `kill`, `EPERM` counting as reached. */
function answers(target, kill = SIGNAL) {
  try {
    kill(target, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Kills every process left in `group` through `kill`, and settles once the group is empty, or once
 * `UNREAPED_BOUND` has passed with no read of its states finding a member that is not a zombie, and
 * hands back as `stuck` each member L0 could not end, by pid, with why: `EPERM` where L0 may not
 * signal it, or that it was still alive `bound` milliseconds after the first kill; and as `joined`
 * whether a read after the kill listed a process, alive or a zombie, that `listed`, every process
 * the read just before the kill listed, did not hold; and as `unread` why a read after the kill
 * failed, where one did, since the kill of the group may then have ended a process no read listed. A look that finds every member
 * still alive answering `EPERM` to signal 0, asked of each by its pid, settles at once, because no
 * kill can reach any of them. The wait is on those conditions, looked at after each pause, so
 * nothing else in Rigger stops meanwhile, and it takes no cap on its rounds: a cap that stopped
 * killing while a member lived would leave it alive (ruling 14).
 *
 * A read that fails, or times out, finds no such member, so the call settles whatever the process
 * table does. A group whose table L0 cannot read is still sent the kill on every look until
 * `UNREAPED_BOUND` passes.
 *
 * The kill is sent again on every look, because a process can be in the group without having
 * received it. One forked while the kernel delivers a group kill can miss it and run on: the
 * engineer judge on #354 saw that in 9 of 12 runs of a survivor forking in a loop, macOS 27.0,
 * 2026-09-27, where the group was running at the kill. And a process outside the group can join it
 * after the kill while a zombie keeps it in being.
 *
 * Where the loop's end can be wrong (`D16` rule 3): how long it takes to end a group that forks
 * rapidly without bound, such as a fan-out of hundreds of children, was not measured (the owner's
 * O66 on #539), and that case is a known gap. `bound` is what ends the wait there, with each member
 * still alive recorded as not ended.
 */
async function ended(group, { ps, readTimeout, kill }, bound, listed) {
  const since = Date.now();
  const refused = new Set();
  let unreapedSince;
  let joined = false;
  // Why a read after the kill failed, where one did.
  let unread;
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) await pause(wait);
    signal(group, 'SIGKILL', kill);
    if (!occupied(group, kill)) return { stuck: [], joined, unread };
    if (wait === 0) continue;
    const looked = Date.now();
    let rows;
    try {
      rows = rowsOf(await run(ps, ['-g', String(group), '-o', 'pid=,stat='], readTimeout, readTimeout));
    } catch (error) {
      unread ??= error.message;
      rows = new Map();
    }
    if (listed !== undefined && [...rows.keys()].some((pid) => !listed.has(pid))) joined = true;
    const living = [...rows].filter(([, state]) => live(state)).map(([pid]) => pid);
    if (living.length > 0) {
      unreapedSince = undefined;
      const stuck = unended(living, kill, Date.now() - since >= bound, bound, refused);
      if (stuck !== undefined) return { stuck, joined, unread };
    } else {
      unreapedSince ??= looked;
      if (Date.now() - unreapedSince >= UNREAPED_BOUND) return { stuck: [], joined, unread };
    }
  }
}

/**
 * Each of `live`, the members a look found alive, by pid and why L0 could not end it, where L0 is
 * done waiting on them: where every one answers `EPERM` to signal 0 through `kill` on this look and
 * on the look before it, which `refused` holds and this updates, or where `late` says `bound` has
 * passed. Nothing where it waits on.
 *
 * One answer of `EPERM` is not enough (`D16` rule 3). The kernel answers signal 0 to a group with
 * `EPERM` while its members are exiting (`occupied`), and a member being killed can answer so for
 * a moment too: taking one such answer for good had the exit cleanup record a killed command as
 * having exited 0, in macOS CI's Node 20 job on #553, which the suite's stand-in forces. Not seen on
 * this host: 1,000 groups of two killed at once, each pid asked signal 0 at once, answered `EPERM`
 * none of the times, with Node 26.5.0 on macOS 27.0 on 2026-10-03. So a member counts as one L0 may not signal only once two looks in a row have found it so, with
 * L0's kill sent between them. A process that answers `EPERM` for a moment on each of two looks in
 * a row is taken as refused all the same.
 */
function unended(live, kill, late, bound, refused) {
  const now = new Set(live.filter((pid) => forbidden(pid, kill)));
  const lasting = live.every((pid) => now.has(pid) && refused.has(pid));
  refused.clear();
  for (const pid of now) refused.add(pid);
  if (!lasting && !late) return undefined;
  return live.map((pid) => ({ pid, reason: now.has(pid) ? 'EPERM' : `still alive ${bound} ms after L0's first kill` }));
}

/** Whether signal 0 sent through `kill` to `pid` answers `EPERM`: L0 may not signal it. */
function forbidden(pid, kill) {
  try {
    kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * The live members of `group` L0's read of states finds just before its kill, against `members`,
 * those the census named: `named`, each of `members` still alive, and `left`, why the kill of the
 * group is recorded beside them, where that read found a live member the census had not named and
 * could not read its name and command line (`namedNow`), and `listed`, every process it listed,
 * alive or a zombie. A
 * member the census named that the read finds a zombie, or leaves out once signal 0 no longer
 * reaches it, has exited on its own, and is not recorded as killed (`there`). It yields each read and each pause, as `census` does, so the call and the
 * exit cleanup both take it.
 *
 * A read that lists no process while signal 0 still reaches the group is taken again, because a
 * member that is exiting still answers signal 0 (`occupied`) and may not be listed, until the group
 * no longer answers or `deadline`, `timeout` after it began, has passed. Then, or where the read
 * fails, the census's members are read by pid in its place, so one that exited on its own is still
 * told apart, and the kill of the group is recorded beside them with why, since a member the census
 * had not named may have been ended. Where that read fails too, it throws, and the group's kill is
 * recorded alone, with why its processes went unnamed.
 *
 * So one class of read is left unrecorded, and nothing but the process table can close it (`D16`
 * rule 3): a read that exits 0, lists at least one row, and consistently leaves out a live member of
 * the group other than the leader, of the census and this one alike. Such a read is taken as
 * complete, so the group's kill ends that hidden member unrecorded. Two instances: a read that
 * lists only the group's zombies while its leader is dead, and one that lists only a member started
 * after the leader while the leader has been reaped.
 *
 * The leader is left out of the class because the census asks signal 0 of the leader's pid, which
 * is the group's id, and reads again while a read leaves out a leader that still answers
 * (`census`). The start-time read catches a hidden live leader the same way, and the note beside it
 * (`startsIn`) records this same class.
 *
 * No read of the table can find another member it consistently hides, because the table is the
 * only thing that says which pids the group holds. The leader alone is known without it, since its
 * pid is the group's id. Signal 0 to the group says only that some process is in it, live or a
 * zombie, not which: measured with Node 26.5.0 on macOS 27.0 on 2026-09-27,
 * `process.kill(pid, 0)` succeeded on a zombie, and a group left holding only a zombie its parent
 * outside the group never reaps kept answering signal 0 (`UNREAPED_BOUND`). So a read hiding a live
 * member while listing zombies is exactly what the table gives for a group holding only zombies,
 * and one hiding it while listing a later member is exactly what it gives for that member alone.
 * Recording the group's kill whenever signal 0 reaches the group would record the kill of every
 * group left holding only zombies, which L0 did not end.
 */
function* beforeKill(group, members, kill, timeout, deadline) {
  let why;
  for (let wait = 0; why === undefined; wait = longer(wait)) {
    if (wait > 0) yield wait;
    if (!occupied(group, kill)) return { named: [] };
    if (Date.now() >= deadline) {
      why = `the reads of the group just before its kill listed no process for ${timeout} ms while signal 0 still reached it`;
      continue;
    }
    let states;
    try {
      states = rowsOf(yield ['-g', String(group), '-o', 'pid=,stat=']);
    } catch (error) {
      why = `the read of the group just before its kill failed while signal 0 still reached it: ${error.message}`;
      continue;
    }
    if (states.size === 0) continue;
    const named = members.filter(({ pid }) => there(states, pid, kill));
    const listed = new Set(states.keys());
    const extra = [...states].filter(([pid, state]) => live(state) && !members.some((member) => member.pid === pid)).map(([pid]) => pid);
    if (extra.length === 0) return { named, listed };
    // A live member the census did not name is named here, before the kill, as the census names one.
    const late = yield* namedNow(extra);
    const left = late.length < extra.length ? 'the group still held a live process the census and the kill had not named, which the kill of the group ended' : undefined;
    return { named: [...named, ...late], left, listed };
  }
  const left = `${why}, so the kill of the group may have ended a process the census had not named`;
  if (members.length === 0) return { named: [], left };
  try {
    const states = rowsOf(yield ['-p', members.map(({ pid }) => pid).join(','), '-o', 'pid=,stat=']);
    return { named: members.filter(({ pid }) => there(states, pid, kill)), left };
  } catch (error) {
    throw new Error(`${why}, and the read of the census's processes by pid failed too: ${error.message}`);
  }
}

/**
 * Each of `pids` by pid, name and command line, read as the census reads them, leaving out one a
 * read misses, or none where a read fails. It yields each read as `census` does.
 */
function* namedNow(pids) {
  try {
    const names = yield* namesOf(pids, function* (args) { return yield args; });
    const commands = rowsOf(yield ['-ww', '-p', pids.join(','), '-o', 'pid=,command=']);
    return pids.filter((pid) => names.has(pid) && commands.has(pid)).map((pid) => ({ pid, name: names.get(pid), cmd: commands.get(pid) }));
  } catch {
    return [];
  }
}

/** Whether a process's `state`, as a read of states holds it, is a live one's: not a zombie's. */
const live = (state) => !state.startsWith('Z');

/**
 * Whether `pid` is alive by `states`, a read of states by pid: listed as live, or left out while
 * signal 0 through `kill` still reaches it. A read can leave out a live process, even one that exits
 * 1 and prints nothing (`run`), so a process a read leaves out is gone only where signal 0 no longer
 * reaches it, and one whose pid the system has handed on meanwhile is taken as alive.
 */
const there = (states, pid, kill) => (states.has(pid) ? live(states.get(pid)) : answers(pid, kill));

/** Sends `name` through `kill` to every process in `group`, and to none where the group has emptied. */
function signal(group, name, kill = SIGNAL) {
  try {
    kill(-group, name);
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
 * L0 never stops the group to read it (the owner's O62 on #539): a group held stopped while a
 * child of it calls `setsid` leaves that child stopped outside the group for good, as #528's probe
 * found with `git maintenance --detach`. So a process can exec between the reads. One `ps` run
 * reads a process's name from the process table and its arguments a moment later, so a process
 * that execs in between is named by one image and described by the other: the engineer judge on
 * #354 measured that in 16 of 3,000 direct reads. So each round reads the states, the command
 * lines, then each name in a `ps` run of its own, then the command lines and the states again. It
 * keeps a round only where both state reads find the same processes, none caught mid-exec (state
 * `?`), and each live one's two command lines agree, with its name read between them. Otherwise it
 * pauses and reads again. A zombie is left out, because it is already dead. Where `deadline` passes
 * first, it keeps what the last round held, each live process the last state read found, by the
 * name and the command line read in that round, and leaves out one a read in that round missed.
 *
 * So a name and a command line can come from two images (`D16` rule 3): a process that went on
 * exec'ing past `deadline`, or that exec'd between the two command-line reads into one with the same
 * arguments, is recorded by the name of one image and the command line of another. Measured with
 * Node 26.5.0 on macOS 27.0 on 2026-10-02, against the suite's survivor that re-executes inside the
 * first read of command lines: over 10 runs, the census recorded the image it became, by its name
 * and command line alike, since its name is read after that read.
 *
 * Reads that agree on no process at all are kept only where signal 0 no longer reaches the group,
 * because a read that failed can list nothing, even one that exits 1 and prints nothing (`run`).
 * While the group still answers, the census reads again, and where `timeout` passes first it fails
 * saying so, and the group is killed unnamed.
 *
 * Reads that agree and leave out the group's leader are kept only where signal 0 no longer reaches
 * the leader's pid, which is the group's id, as the start-time read holds (`startsIn`). A leader
 * that has exited and not been reaped is listed as a zombie, so a leader left out while its pid
 * still answers was left out by a read that failed. The census then reads again the same way, and
 * where `timeout` passes first the group is killed unnamed, so a live leader every read hides is
 * recorded as the kill of the group, not ended unrecorded.
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
 *   group, where the read before the kill finds it (`beforeKill`, `contain`).
 * - `ps` exits 1, printing nothing, when no process matches, and writes to standard error when a
 *   read fails (`run`).
 */
function* census(group, kill, deadline) {
  // Why the census's last reads that agreed were not kept: they left out what signal 0 reached.
  let unseen;
  // What the last round held, kept where `deadline` passes before a round agrees.
  let last;
  const read = function* (args) {
    try {
      return yield args;
    } catch (error) {
      throw unseen ? new Error(`the census's reads ${unseen}: ${error.message}`) : error;
    }
  };
  const column = function* (name) {
    return rowsOf(yield* read(['-ww', '-g', String(group), '-o', `pid=,${name}=`]));
  };
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) yield wait;
    if (last !== undefined && Date.now() >= deadline) return last;
    let round;
    try {
      const before = yield* column('stat');
      const lines = yield* column('command');
      const names = yield* namesOf([...before].filter(([, state]) => live(state)).map(([pid]) => pid), read);
      const commands = yield* column('command');
      const after = yield* column('stat');
      round = { before, lines, names, commands, after };
    } catch (error) {
      // A read given up on at `deadline` leaves the last round to keep, where there is one.
      if (last !== undefined && (error.code === 'ETIMEDOUT' || error.code === LATE)) return last;
      throw error;
    }
    const { before, lines, names, commands, after } = round;
    unseen = after.size === 0 && occupied(group, kill) ? 'named no process of the group while it still had one'
      : !after.has(group) && answers(group, kill) ? `left out the group's leader, ${group}, while signal 0 still reached its pid`
      : undefined;
    if (unseen) continue;
    const living = [...after].filter(([, state]) => live(state)).map(([pid]) => pid);
    last = living.filter((pid) => names.has(pid) && commands.has(pid)).map((pid) => ({ pid, name: names.get(pid), cmd: commands.get(pid) }));
    const settled = [before, after].every((states) => [...states.values()].every((state) => !state.startsWith('?')));
    if (settled && samePids(before, after) && living.every((pid) => names.has(pid) && commands.has(pid) && lines.get(pid) === commands.get(pid))) return last;
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
 * pause it yields, and hands back what `looks` returns. The reads are given up at `deadline`,
 * which is `timeout` milliseconds after the first starts where the caller gives none.
 */
async function reading(looks, ps, timeout, deadline = Date.now() + timeout) {
  let look = looks.next();
  while (!look.done) {
    if (typeof look.value === 'number') {
      await pause(look.value);
      look = looks.next();
    } else {
      let printed;
      try {
        printed = await run(...toolOf(look.value, ps), deadline - Date.now(), timeout);
      } catch (error) {
        look = looks.throw(error);
        continue;
      }
      look = looks.next(printed);
    }
  }
  return look.value;
}

/** The tool a read `looks` yields runs in, and its arguments: `ps` for a list of them, or the `tool` it names. */
const toolOf = (read, ps) => (Array.isArray(read) ? [ps, read] : [read.tool, read.args]);

/** `reading`, synchronously, for the exit cleanup, which passes over each pause. */
function readingNow(looks, ps, timeout, deadline = Date.now() + timeout) {
  let look = looks.next();
  while (!look.done) {
    if (typeof look.value === 'number') {
      look = looks.next();
      continue;
    }
    let printed;
    try {
      printed = runNow(...toolOf(look.value, ps), deadline - Date.now(), timeout);
    } catch (error) {
      look = looks.throw(error);
      continue;
    }
    look = looks.next(printed);
  }
  return look.value;
}

/**
 * How `ps` and `lsof` are run besides their environment: killed outright at `remaining`
 * milliseconds, or at `TIMER_MAX` where that is less, since Node runs a longer timeout out at once,
 * and working in `/`, so the census of working directories never lists a read of its own, nor one of
 * another call's, as working in a dispatch's directory.
 */
const reader = (remaining) => ({ timeout: Math.min(remaining, TIMER_MAX), killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8', cwd: '/' });

/** The `code` of the failure for reads of the process table that ran out of time between reads. */
const LATE = 'LATE';

/** The failure for reads of the process table that ran out of time between reads. */
const late = (timeout) => Object.assign(new Error(`the reads of the process table did not finish within ${timeout} ms`), { code: LATE });

/** The failure for a read of the process table that wrote `stderr`, which `ps` does only on a failure (`run`). */
const failed = (stderr) => new Error(`the process-table read failed: ${stderr.trim()}`);

/** The failure for a read of the process table that ran out of time, with Node's code for one. */
const timedOut = (timeout) => Object.assign(new Error(`the process-table read timed out after ${timeout} ms`), { code: 'ETIMEDOUT' });

/** The failure for a run of `tool` given `args` that ended with `status`, an exit code or a signal, other than as `ps` ends when no process matched (`run`). */
const exited = (tool, args, status) => new Error(`${tool} ${args.join(' ')} ended with ${status}`);

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
 * nor the kill takes a process as gone because a read left it out (`census`, `beforeKill`), and the
 * start-time read takes neither an empty read nor a missing leader as the group's (`startsIn`).
 */
function run(ps, args, remaining, timeout) {
  return new Promise((resolve, reject) => {
    if (remaining <= 0) return reject(late(timeout));
    const read = execFile(ps, args, { env: PS_ENV, ...reader(remaining) }, (error, stdout, stderr) => {
      reads.delete(read);
      if (error?.killed) return reject(timedOut(timeout));
      if (stderr !== '') return reject(failed(stderr));
      if (error && !(error.code === 1 && stdout === '')) return reject(typeof error.code === 'number' || error.signal ? exited(ps, args, error.code ?? error.signal) : error);
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
  const began = Date.now();
  try {
    const printed = runOnce(ps, args, remaining, timeout);
    unreadSince = undefined;
    return printed;
  } catch (error) {
    unreadSince ??= began;
    throw error;
  }
}

/** `runNow`'s one run, each failure as it arose. */
function runOnce(ps, args, remaining, timeout) {
  if (remaining <= 0) throw late(timeout);
  if (unanswered.has(ps)) throw new Error(`${timedOut(unanswered.get(ps)).message} earlier in the exit cleanup, which does not wait on it again`);
  const { error, status, signal: ending, stdout, stderr } = spawnSync(ps, args, { env: PS_ENV, ...reader(remaining) });
  if (error?.code === 'ETIMEDOUT') {
    unanswered.set(ps, timeout);
    throw timedOut(timeout);
  }
  if (error) throw error;
  if (stderr !== '') throw failed(stderr);
  if (status !== 0 && !(status === 1 && stdout === '')) throw exited(ps, args, status ?? ending);
  return stdout;
}

/**
 * Ends what is left of `group`, once its command has exited or at its timeout, and hands back the
 * `L0` events to record, without ever stopping the group (`census`). In order:
 *
 * 1. the census reads which processes the group holds, by name and command line;
 * 2. a read of states just before the kill finds which of them are still alive (`beforeKill`);
 * 3. L0 kills the group whole, through `kill`;
 * 4. L0 kills it and reads it again until no member is left alive (`ended`);
 * 5. and only then it hands back a `killed` event for each member the read before the kill found
 *    alive, and the kill of the group beside them where that read found a live member the census
 *    had not named. Each member still alive at `KILL_BOUND`, or that L0 may not signal, is handed
 *    back as a process it could not end, with why, in place of a kill.
 *
 * A census or a read before the kill that fails still has the group killed, and hands back the
 * kill of the group with why its processes went unnamed.
 *
 * Where this can be wrong (`D16` rule 3):
 *
 * - A member that exits on its own between the read before the kill and the kill is recorded as
 *   killed: nothing after the kill tells its own exit from the kill. Measured with Node 26.5.0 on
 *   macOS 27.0 on 2026-10-02, against the suite's quitter that exits inside that read: it was
 *   recorded as killed in each of 10 runs.
 * - A name and a command line can come from two images (`census`).
 * - A process that joins the group after the read before the kill is recorded as the kill of the
 *   group where a read after the kill lists it, alive or a zombie (`ended`), though a zombie may
 *   have exited on its own. Where a read after the kill fails, the kill of the group is recorded in
 *   place of what it could not list (`R-STATE-19`). Only one the kill ends and a parent outside the
 *   group reaps before any such read is ended unrecorded. No read can tell that joiner from a group holding only zombies:
 *   signal 0 reaches both, and once its parent has reaped it, the table holds only the zombies both
 *   leave behind. Recording the kill of the group whenever that could have happened would record it
 *   for every group left holding only zombies.
 */
async function contain(group, { ps, readTimeout, kill = SIGNAL }, killed) {
  if (!occupied(group, kill)) return [];
  // Each step ends `readTimeout` after it begins, and its reads are given up `spare` after that.
  const within = (step, spare = 0) => {
    const deadline = Date.now() + readTimeout;
    return reading(step(deadline), ps, readTimeout, deadline + spare);
  };
  let named;
  let left;
  let listed;
  let unnamed;
  try {
    const members = await within((deadline) => census(group, kill, deadline));
    ({ named, left, listed } = await within((deadline) => beforeKill(group, members, kill, readTimeout, deadline), readTimeout));
  } catch (error) {
    unnamed = error.message;
  }
  const { stuck, joined, unread } = await ended(group, { ps, readTimeout, kill }, KILL_BOUND, listed);
  if (joined && unnamed === undefined) left ??= 'a read after the kill found a process in the group, alive or exited, that the read just before the kill had not listed: the kill of the group was sent while it may have been a member, though it may have exited on its own';
  if (unread !== undefined && unnamed === undefined) left ??= `the reads of the group after its kill failed, so the kill of the group may have ended a process no read before it had listed: ${unread}`;
  const unended = await reading(described(stuck, named), ps, readTimeout).catch(() => stuck);
  return killsOf(group, { named, unnamed, left, unended }, killed);
}

/**
 * `contain`, synchronously, for the exit cleanup, with the kill confirmed by `emptied`. Its census,
 * its read before the kill and its record are `contain`'s own, and it waits on no bound longer than
 * its own, `readTimeout`: a member still alive that long after its first kill is handed back as a
 * process it could not end, in place of a kill at `KILL_BOUND`. Unlike `contain`, it also records
 * the kill of the group where a process joined the group after the read before the kill and the
 * confirmation read it live, which it reads before its first kill (`emptied`).
 *
 * A joiner one confirmation read finds alive, and that exits on its own and is reaped before L0's
 * next kill reaches the group, is recorded in the kill of the group. No read can tell its own exit
 * from L0's kill once it has been reaped (`D16` rule 3): the table shows how a process ended only as
 * its zombie's `xstat`, which `ps` shows until the parent reaps it and never after, and a joiner's
 * parent outside the group can reap it before any read.
 *
 * One window is also excluded, as in `contain`: a process that joins the group after L0's last read
 * of it, is ended by L0's next kill, and is reaped by a parent outside the group before any read
 * lists it, is ended unrecorded. A read after a kill that fails has the kill of the group recorded
 * in place of what it could not list (`emptied`).
 *
 * Where the confirmation's reads fail or run out of time, the group has the kill on every look until
 * `UNREAPED_BOUND` has passed, and the cleanup goes on: it cannot wait longer on a process table it
 * cannot read.
 */
function containNow(group, { ps, readTimeout, kill = SIGNAL }) {
  if (!occupied(group, kill)) return { kills: [] };
  // Each step ends `readTimeout` after it begins, and its reads are given up `spare` after that.
  const within = (step, spare = 0) => {
    const deadline = Date.now() + readTimeout;
    return readingNow(step(deadline), ps, readTimeout, deadline + spare);
  };
  let named;
  let left;
  let listed;
  let unnamed;
  try {
    const members = within((deadline) => census(group, kill, deadline));
    ({ named, left, listed } = within((deadline) => beforeKill(group, members, kill, readTimeout, deadline), readTimeout));
  } catch (error) {
    unnamed = error.message;
  }
  // Where the group is already recorded as killed whole, the confirmation kills before it reads.
  const seen = { live: false, first: unnamed === undefined && left === undefined, listed: listed ?? new Set((named ?? []).map(({ pid }) => pid)) };
  let leader;
  let unread;
  let stuck = [];
  try {
    ({ leader, stuck } = readingNow(emptied(group, seen, kill, readTimeout), ps, readTimeout));
    if (leader === undefined && stuck.length === 0) unread = 'the process table did not list it';
  } catch (error) {
    // The kill was sent on every look but one whose read failed before the first kill, so that
    // kill is sent now.
    if (!seen.sent) signal(group, 'SIGKILL', kill);
    unread = error.message;
    // No read after the kill showed the members ended, so each the read before it found alive that
    // signal 0 still reaches is not shown to have ended, but the leader, whose zombie Node reaps only
    // once this process exits (`D16` rule 3: another member's zombie, not yet reaped, is counted too).
    stuck = (named ?? []).filter(({ pid }) => pid !== group && answers(pid, kill)).map(({ pid }) => ({ pid, reason: `not shown to have ended: the process table could not be read within the exit cleanup's read bound of ${readTimeout} ms` }));
  }
  // Every member the census named was read alive or gone just before the kill, so a live one the
  // confirmation finds that no read before it named joined the group after that read.
  if (unnamed === undefined && seen.unread !== undefined) left ??= `the reads of the group after its kill failed, so the kill of the group may have ended a process no read before it had listed: ${seen.unread}`;
  if (unnamed === undefined && seen.live) left ??= 'a read after the kill found a process in the group, alive or exited, that the read just before the kill had not listed: the kill of the group was sent while it may have been a member, though it may have exited on its own';
  // A member the census named is recorded by its name and command line, and one it did not by its
  // pid alone: the cleanup reads nothing past its own bound.
  const known = new Map((named ?? []).map((member) => [member.pid, member]));
  const unended = stuck.map(({ pid, reason }) => ({ ...known.get(pid), pid, reason }));
  // A leader the read before the kill found alive was ended by the cleanup's kill, where no later
  // read could tell, unless it exited on its own between that read and the kill (`contain`), or the
  // kill could not end it, which the cleanup hands the caller's step as why its ending is unread.
  const leaderUnended = stuck.find(({ pid }) => pid === group);
  if (leaderUnended !== undefined) unread = `the exit cleanup could not end the command: ${leaderUnended.reason}`;
  const alive = leaderUnended === undefined && (named?.some(({ pid }) => pid === group) ?? false);
  return { kills: killsOf(group, { named, unnamed, left, unended }, 'survivor.killed'), leader, unread, alive };
}

/**
 * Kills every process left in `group` through `kill` until it holds nothing but zombies, for the
 * exit cleanup, and hands back the wait status `ps` reads for the group's leader as `leader`, where
 * it is still there, and as `stuck` each member L0 could not end (`ended` says which). Node reaps no
 * child while synchronous code runs, so a leader killed here stays in the group as a zombie until
 * this process exits, and the group never empties while the cleanup runs. So each look reads the
 * group's states, and a group of zombies is ended: none of them can run again.
 *
 * Its reads end at the cleanup's own bound, `bound`, the read timeout from the start of its first
 * read, as every step of the cleanup's do. A member the last read after a kill found alive, when the
 * next read can no longer be made, is one L0 could not end, and so is each still alive where every
 * one answers `EPERM`. A read that fails is taken again, with the kill sent on every look, until
 * `UNREAPED_BOUND` has passed since the cleanup's reads began to fail, or the bound has, and then
 * its failure is thrown. That clock is the cleanup's, not the group's (`unreadSince`), so a process
 * table that cannot be read holds the process's ending back once, and not once for each group.
 *
 * Where `seen.first` is set, it reads the group once before its first kill, so a process that
 * joined the group after the reads before it is read live before the kill ends it. It sets
 * `seen.sent` once it has sent a kill. Where a look lists a process, alive or a zombie, that is not
 * among `seen.listed`, every process the read before the kill listed, it sets `seen.live`, even
 * where a later read fails, because the kill of the group may then have ended a process that no
 * read before it had named. Where a read after a kill fails, it keeps why in `seen.unread`, since the
 * kill of the group may then have ended a process no read listed.
 */
function* emptied(group, seen, kill, bound) {
  // What the last read after a kill found: the leader's wait status, and each member alive.
  let last;
  const refused = new Set();
  for (let sent = !seen.first; ; sent = true) {
    if (sent) {
      signal(group, 'SIGKILL', kill);
      seen.sent = true;
    }
    if (!occupied(group, kill)) return { stuck: [] };
    let states;
    try {
      states = rowsOf(yield ['-g', String(group), '-o', 'pid=,stat=,xstat=']);
    } catch (error) {
      if (sent) seen.unread ??= error.message;
      // A read the bound cut short leaves each member the last read found alive not ended.
      if (last !== undefined && (error.code === LATE || error.code === 'ETIMEDOUT')) return { leader: last.leader, stuck: last.living.map((pid) => ({ pid, reason: `still alive when the exit cleanup's read bound of ${bound} ms ran out` })) };
      if (error.code === LATE || unreadSince === undefined || Date.now() - unreadSince >= UNREAPED_BOUND) throw error;
      continue;
    }
    const living = [...states].filter(([, state]) => live(state)).map(([pid]) => pid);
    if ([...states.keys()].some((pid) => !seen.listed.has(pid))) seen.live = true;
    // A wait status is the leader's own only once it has exited: a live process's reads 0.
    const leader = living.includes(group) ? undefined : states.get(group)?.split(/\s+/)[1];
    if (living.length === 0 && sent) return { leader, stuck: [] };
    if (!sent) continue;
    last = { leader, living };
    const stuck = unended(living, kill, false, bound, refused);
    if (stuck !== undefined) return { leader, stuck };
  }
}

/**
 * Each of `stuck`, the processes L0 could not end, by pid and why, with its name and command line:
 * as `named` holds them where the census named it, and otherwise read as the census reads them,
 * while the process is still alive. It yields each read as `census` does.
 */
function* described(stuck, named = []) {
  const known = new Map(named.map((member) => [member.pid, member]));
  const unknown = stuck.filter(({ pid }) => !known.has(pid)).map(({ pid }) => pid);
  const names = unknown.length === 0 ? new Map() : yield* namesOf(unknown, function* (args) { return yield args; });
  const commands = unknown.length === 0 ? new Map() : rowsOf(yield ['-ww', '-p', unknown.join(','), '-o', 'pid=,command=']);
  return stuck.map(({ pid, reason }) => ({ pid, name: known.get(pid)?.name ?? names.get(pid), cmd: known.get(pid)?.cmd ?? commands.get(pid), reason }));
}

/**
 * The `L0` events for `group`'s kill: a `killed` event for each of `named`, the members the read
 * before the kill found alive, and the kill of the group whole beside them where that read found it
 * could have ended a process unnamed, `left`; or only the kill of the group whole, where the census
 * or that read failed as `unnamed`. Each of `unended`, the members L0 could not end, is handed back
 * as such, with why, and not as killed.
 */
function killsOf(group, { named, unnamed, left, unended }, killed) {
  const notEnded = unended.map((member) => [killed.replace(/\.killed$/, '.unended'), member]);
  if (unnamed !== undefined) return [['group.killed', { group, census: unnamed }], ...notEnded];
  const stuck = new Set(unended.map(({ pid }) => pid));
  const ends = named.filter(({ pid }) => !stuck.has(pid)).map((member) => [killed, member]);
  return [...ends, ...(left === undefined ? [] : [['group.killed', { group, census: left }]]), ...notEnded];
}

/**
 * The identity of the directory at `path`, by which a later start tells it from another made at the
 * same path since: its device and inode, as decimal strings, read by `stat` through any link.
 *
 * Where it can fail to tell them apart (`D16` rule 3): a directory made at a path after another
 * there was removed could take the same device and inode. Measured on this host's APFS volume
 * (`/System/Volumes/Data`, macOS 27.0, 26A428) on 2026-10-01: of 200 directories each removed and
 * made again at once at the same path, none took the inode it had (`316037766` became
 * `316037792` on the last), on the same device. That APFS gives inodes out from a counter that
 * only grows is the architect's judgment (ruling 7), not a measurement.
 */
export function identityOf(path) {
  const { dev, ino } = statSync(path, { bigint: true });
  return { device: String(dev), inode: String(ino) };
}

/**
 * Why the directory at `directory` may not be the one recorded with `identity`, or nothing where it
 * is: the record carries no identity for it, its identity cannot be read at the path, as where it
 * no longer exists, or the path now names another directory.
 */
function unconfirmed(directory, identity) {
  if (identity?.device === undefined || identity?.inode === undefined) return 'the record carries no device and inode for it, so the start cannot tell it is the directory recorded';
  let now;
  try {
    now = identityOf(directory);
  } catch (error) {
    return `its device and inode cannot be read: ${error.message}`;
  }
  if (now.device === identity.device && now.inode === identity.inode) return undefined;
  return `it is not the directory recorded: it is device ${now.device}, inode ${now.inode}, where the record names device ${identity.device}, inode ${identity.inode}`;
}

/**
 * The census of working directories' tool, by absolute path, for the same reason as `PS`. It runs
 * under `PS_ENV` too, whose UTF-8 locale it needs to print `ü` as itself (`listing`).
 */
export const LSOF = '/usr/sbin/lsof';

/**
 * The real path of `directory`, which the census of working directories compares with, or why it
 * cannot be one. A path that cannot be resolved is refused, never taken as holding no process, and
 * so is one `illegible` refuses.
 */
function placed(directory) {
  let real;
  try {
    real = realpathSync.native(directory);
  } catch (error) {
    return { why: `its directory ${directory} cannot be resolved: ${error.message}` };
  }
  return { real, why: illegible(real) };
}

/**
 * Why the census cannot compare with `real`, or nothing where it can: it holds a character `lsof`
 * does not print as itself, or `\` or `^`, which begin what it prints in a character's place. Of
 * such a path, what `lsof` prints is not the path, and a path it prints could be another
 * directory's (`listing`). Only printable ASCII is known to print as itself. The root is refused
 * too, since every process works under it.
 */
const illegible = (real) => (/^\/[\x20-\x5b\x5d\x5f-\x7e]+$/.test(real) ? undefined
  : `the directory ${JSON.stringify(real)} is not an absolute path below the root, of printable ASCII without \\ or ^, which alone the census of working directories can read back`);

/**
 * What `lsof` is given to list the working directory of each process of Rigger's own user, or of
 * `pids` among them: `-a` lists a process only where it is the user's, by `-u` and its real user
 * id, and the file is its working directory, and `-F pun` prints each as lines of a field each.
 *
 * Where `lsof`'s answer can differ from a process's true working directory (`D16` rule 3), measured
 * with `lsof` 4.91 on macOS 27.0 (26A428) on 2026-10-01:
 *
 * - It prints the path the kernel names the directory by now: one renamed after a process began
 *   working in it printed its new name. One removed after printed the path it had, with nothing to
 *   mark it removed. One a process entered through a symbolic link printed the link's target, so
 *   the census compares with the real path (`placed`).
 * - It prints a character it holds unprintable in its place: a newline as `\n`, a tab as `\t`, a
 *   backslash as `\\`, U+0001 as `^A`, which a path holding `^A` prints too, and U+007F and
 *   U+200B as `\x` and the hexadecimal of each byte. It printed `ü` as itself under this locale.
 *   So a path is compared only where it holds printable ASCII but `\` and `^` (`placed`), and then
 *   a path printed under it is one lying under it.
 * - It exits 1, printing nothing on either stream, where no process matched, as `ps` does (`run`),
 *   and it lists itself, working where it was started, which is `/` (`reader`).
 *
 * One call listing every process of the user took 164 to 186 ms over 20 calls, with Node 26.5.0,
 * at a load average of about 11.5 on 12 cores, with 658 processes of the user's.
 */
const listing = (pids) => ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), ...(pids ? ['-p', pids.join(',')] : []), '-F', 'pun'];

/**
 * The pid of each process `lsof`'s `printed` lists working in `directory`, a real path: its
 * working directory is that directory or lies under it. A process of another user is left out
 * whatever `lsof` was asked, and so is this one. A line it cannot read fails the census.
 */
function workingIn(printed, directory) {
  const pids = [];
  let listed;
  for (const line of printed.split('\n').filter(Boolean)) {
    const [, field, value] = /^([pufn])(.*)$/.exec(line) ?? [];
    if (field === undefined || ((field === 'p' || field === 'u') && !/^\d+$/.test(value)) || (field !== 'p' && listed === undefined)) {
      throw new Error(`the census of working directories held a line it cannot read: ${JSON.stringify(line)}`);
    }
    if (field === 'p') listed = { pid: Number(value) };
    if (field === 'u') listed.uid = Number(value);
    const there = value === directory || value.startsWith(`${directory}/`);
    if (field === 'n' && there && listed.uid === process.getuid() && listed.pid !== process.pid) pids.push(listed.pid);
  }
  return pids;
}

/** Sends `SIGSTOP` through `kill` to the process `pid`: `sent`, or `ESRCH` where it has gone, or `EPERM` where Rigger may not signal it. */
function halt(pid, kill) {
  try {
    kill(pid, 'SIGSTOP');
    return 'sent';
  } catch (error) {
    if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
    return error.code;
  }
}

/** Sends `name` through `kill` to the process `pid`, and whether it reached it. */
function sent(pid, name, kill) {
  try {
    kill(pid, name);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
    return false;
  }
}

/**
 * What `sweeping` `found`, once each process it killed has ended: each still alive `bound`
 * milliseconds after its kill is taken out of the kills and the unnamed, resumed, since the census
 * stopped it, and handed back in `unended` with why, as is each process Rigger may not signal,
 * which `found` holds as `refused`, with its name and command line where they can be read. It yields
 * each read and each pause, as `census` does.
 *
 * The census lists only processes whose real uid is Rigger's, and macOS lets a process signal
 * those, so a process it may not signal is not one this host has shown it (`D16` rule 3): the
 * branch is proven through a stand-in for the signal call alone (#545's engineer judge, N2).
 */
function* settled(found, kill, bound) {
  const why = new Map(yield* reaped([...found.kills.map(({ pid }) => pid), ...(found.unnamed ?? [])], kill, bound));
  const stuck = new Set(why.keys());
  for (const pid of stuck) sent(pid, 'SIGCONT', kill);
  let refused = (found.refused ?? []).map((pid) => ({ pid, reason: 'EPERM' }));
  try {
    refused = yield* described(refused);
  } catch {
    // The process table cannot be read, so each is recorded by its pid and why alone.
  }
  return {
    ...found,
    kills: found.kills.filter(({ pid }) => !stuck.has(pid)),
    unnamed: (found.unnamed ?? []).filter((pid) => !stuck.has(pid)),
    unended: [...found.kills.filter(({ pid }) => stuck.has(pid)).map((each) => ({ ...each, reason: why.get(each.pid) })), ...(found.unnamed ?? []).filter((pid) => stuck.has(pid)).map((pid) => ({ pid, reason: why.get(pid) })), ...refused],
  };
}

/**
 * Each of `pids`, each one the census killed through `kill`, that L0 cannot show has ended, as a
 * pair of its pid and why, or none: it settles once none answers signal 0, or a read of their states
 * finds only zombies, yielding each pause. A killed process answers until its parent reaps it, and
 * the census kills a process whatever its parent, so a zombie whose parent never reaps it is taken
 * as ended. One a read finds alive `bound` milliseconds after it began is still alive at the bound.
 * Where the reads fail, it settles once `UNREAPED_BOUND` has passed, and each that still answers
 * signal 0 is one the table could not show has ended: the census stopped it, so `settled` resumes it
 * rather than leave it stopped (`R-STATE-18`), though a zombie answers signal 0 too (`D16` rule 3).
 */
function* reaped(pids, kill, bound) {
  const since = Date.now();
  let last;
  for (let wait = 1; ; wait = longer(wait)) {
    const left = pids.filter((pid) => answers(pid, kill));
    if (left.length === 0) return [];
    let living;
    try {
      living = [...rowsOf(yield ['-p', left.join(','), '-o', 'pid=,stat='])].filter(([, state]) => live(state)).map(([pid]) => pid);
      last = living;
    } catch (error) {
      // Past the reads' deadline no read can be made: what the last read found alive is not ended,
      // and the rest the table could not show had ended.
      if (error.code === LATE) return (last ?? left).map((pid) => [pid, last ? `still alive when L0's read bound ran out after its kill` : 'not shown to have ended: the process table could not be read']);
      living = undefined;
    }
    if (living?.length === 0) return [];
    if (living !== undefined && Date.now() - since >= bound) return living.map((pid) => [pid, `still alive ${bound} ms after L0's kill`]);
    if (living === undefined && Date.now() - since >= UNREAPED_BOUND) return left.map((pid) => [pid, `not shown to have ended ${UNREAPED_BOUND} ms after L0's kill: the process table could not be read`]);
    yield wait;
  }
}

/**
 * Kills every process of Rigger's own user working in `directory`, a real path `illegible` admits,
 * read through `lsof` at the path `lsof` names, signalling each through `kill`, and hands back the
 * `kills`, each by its pid, name and command line, read as the group's census reads them. Where the
 * census could not be read, it hands back why as `unread`, and as `unnamed` the pid of each process
 * it had found working there and stopped, which it then killed unnamed. It yields each read and each
 * pause, as `census` does, so the call and the exit cleanup both take it. Each process Rigger may not
 * signal is handed back as `refused`, by pid, for `settled` to record as one it could not end.
 *
 * Each round lists the directory's processes and stops them, because a stopped process can neither
 * exec, nor fork, nor leave the directory. It lists them again, stopped, and resumes any no longer
 * working there: a pid handed on to another process between the list and the stop. It reads the
 * rest's names and command lines, then their states again, keeping them only where each is still
 * stopped, and kills them. It ends only at a list holding no process but those Rigger may not
 * signal. It stops processes one pid at a time, never a group, so a process it stopped that then
 * leaves its group is still killed or resumed by its pid (ruling 14). A listed process that has
 * gone before the stop is listed again, so one it forked between the list and the stop is killed in
 * a later round. One it has sent the kill and lists again is still ending, or outlives the kill,
 * and is neither stopped nor killed again. A directory whose processes go on forking
 * successors faster than a round ends holds the census until its read timeout, and is then recorded
 * as unread.
 *
 * It resumes a process it stopped only where a later list no longer finds it working there, or where
 * the census gives up before it has listed that process again: a failed read leaves nothing it
 * stopped stopped. A process it has listed again, stopped, it kills, by name or, where a later read
 * fails, unnamed.
 *
 * Where the exit cleanup's census runs while the call's is reading, it kills what the call's had
 * stopped in the directory. A process the call's had stopped and not yet listed again, which can
 * only be a pid handed on to a process outside it between a list and the stop, stays stopped.
 */
function* sweeping(directory, lsof, kill) {
  const kills = [];
  // Stopped and not yet listed again; and listed again, stopped, and not yet killed.
  const held = new Set();
  const ours = new Set();
  // Sent the kill, and listed again only while it is still ending, or where it outlives the kill,
  // which `settled` waits on: it is not stopped or killed again.
  const killed = new Set();
  const list = function* (pids) {
    return workingIn(yield { tool: lsof, args: listing(pids) }, directory);
  };
  const resume = (pids) => {
    for (const pid of pids) {
      held.delete(pid);
      sent(pid, 'SIGCONT', kill);
    }
  };
  try {
    for (let wait = 0; ; wait = longer(wait)) {
      if (wait > 0) yield wait;
      const found = yield* list();
      resume([...held].filter((pid) => !found.includes(pid)));
      // A process the stop could not reach either has gone, and is listed again, since it may have
      // forked first, or is one Rigger may not signal, as a set-user-id program's is, and so not
      // this user's to end. So the census ends at a list holding only processes of the second kind.
      const forbidden = new Set();
      for (const pid of found) {
        if (ours.has(pid) || killed.has(pid)) continue;
        const stop = halt(pid, kill);
        if (stop === 'sent') held.add(pid);
        if (stop === 'EPERM') forbidden.add(pid);
      }
      const pids = [...held, ...ours];
      if (pids.length === 0 && found.every((pid) => forbidden.has(pid) || killed.has(pid))) return { kills, refused: [...forbidden] };
      if (pids.length === 0) continue;
      const before = rowsOf(yield ['-p', pids.join(','), '-o', 'pid=,stat=']);
      for (const pid of ours) if (!before.get(pid)?.startsWith('T')) ours.delete(pid);
      if (!stopped(before)) continue;
      const there = yield* list(pids);
      resume([...held].filter((pid) => !there.includes(pid)));
      for (const pid of held) ours.add(pid);
      held.clear();
      const names = yield* namesOf([...before.keys()], function* (args) { return yield args; });
      const commands = rowsOf(yield ['-ww', '-p', pids.join(','), '-o', 'pid=,command=']);
      const after = rowsOf(yield ['-p', pids.join(','), '-o', 'pid=,stat=']);
      if (!stopped(after) || ![before, names, commands].every((each) => samePids(each, after))) continue;
      for (const [pid, state] of after) {
        if (!ours.has(pid) || !state.startsWith('T')) continue;
        ours.delete(pid);
        if (!sent(pid, 'SIGKILL', kill)) continue;
        killed.add(pid);
        kills.push({ pid, name: names.get(pid), cmd: commands.get(pid) });
      }
    }
  } catch (error) {
    return { kills, unread: error.message, unnamed: [...ours].filter((pid) => sent(pid, 'SIGKILL', kill)) };
  } finally {
    resume([...held]);
  }
}

/**
 * The `L0` events for the census of `directory`, a real path, read through the call's `ps`, `lsof`
 * and read timeout,
 * with `killed` naming each kill as a survivor's: each kill by name, and where the census could not
 * be read, a `directory.unread` event naming the directory and why, and each process it then
 * killed unnamed. Of a directory `illegible` refuses, that event says why, and nothing is killed.
 */
async function swept(directory, { ps, lsof, readTimeout, kill = SIGNAL }, killed) {
  const why = illegible(directory);
  if (why !== undefined) return sweptEvents(directory, { kills: [], unread: why, unnamed: [], unended: [] }, killed);
  const found = await reading(sweeping(directory, lsof, kill), ps, readTimeout);
  return sweptEvents(directory, await reading(settled(found, kill, KILL_BOUND), ps, readTimeout, Date.now() + KILL_BOUND + readTimeout), killed);
}

/**
 * `swept`, synchronously, for the exit cleanup, which waits on no bound longer than its own: the
 * census lists, kills and waits within one read timeout, as every step of the cleanup's does.
 */
function sweptNow(directory, { ps, lsof, readTimeout, kill = SIGNAL }, killed) {
  const why = illegible(directory);
  if (why !== undefined) return sweptEvents(directory, { kills: [], unread: why, unnamed: [], unended: [] }, killed);
  return sweptEvents(directory, readingNow(sweptWithin(directory, lsof, kill, readTimeout), ps, readTimeout), killed);
}

/** `sweeping` and then `settled`, as one step, so the exit cleanup's census reads within one bound, `bound`. */
function* sweptWithin(directory, lsof, kill, bound) {
  return yield* settled(yield* sweeping(directory, lsof, kill), kill, bound);
}

/** The events `swept` hands back, from what `sweeping` found in `directory`: each process it could not end among them, as such. */
const sweptEvents = (directory, { kills, unread, unnamed, unended }, killed) => [
  ...kills.map((kill) => [killed, { ...kill, directory }]),
  ...(unread === undefined ? [] : [['directory.unread', { directory, census: unread, ...(unnamed.length > 0 ? { killed: unnamed } : {}) }]]),
  ...unended.map((each) => [killed.replace(/\.killed$/, '.unended'), { ...each, directory }]),
];

/** The directories `call` sweeps: the dispatch's directory and its scratch directory, each where it holds one. */
const sweptBy = (call) => [call.directory, call.scratch].filter((directory) => directory !== undefined);

/**
 * The `L0` events for the census of each directory `call` sweeps, once its group is empty, each
 * kill named as a survivor's; none where the call is not a dispatch's.
 */
async function censused(call) {
  const events = [];
  for (const directory of sweptBy(call)) events.push(...(await swept(directory, call, 'survivor.killed')));
  return events;
}

/**
 * `containNow` for the exit cleanup, followed by the census of each directory `call` sweeps, whose
 * kills are recorded after the group's.
 */
function endedNow(group, call) {
  const look = containNow(group, call);
  for (const directory of sweptBy(call)) look.kills = [...look.kills, ...sweptNow(directory, call, 'survivor.killed')];
  return look;
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
 * `input`, where the caller gives it, is written to the command's standard input, which is then
 * closed. A command given none reads end of file at once.
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
 * `directory`, where the caller gives one, is the directory of the dispatch the command is, and the
 * call is then a dispatch's (`ARCHITECTURE.md`, "Failure model"). Once L0 has emptied the group,
 * it kills every process of Rigger's own user working in that directory, by its real path, and
 * records each as a survivor (`swept`). A directory that cannot be resolved, or whose real path the
 * census cannot read back (`illegible`), starts nothing, as a command that never started. `scratch`,
 * where the caller gives one, is the dispatch's scratch directory, which the census sweeps after
 * the dispatch's directory, on the same terms (the architect's ruling 20 on #467). `lsof`
 * stands in for `LSOF` where the caller gives one. A call given no directory has its group as its
 * whole containment.
 *
 * `kill` stands in for L0's signal call, `process.kill`, where the caller gives one, for every
 * signal L0's containment sends, as `ps` stands in for `PS`. A process L0 may not signal, or that
 * outlives its kill for `KILL_BOUND`, is recorded as one it could not end, with why, and the call
 * settles (`R-STATE-19`).
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
export async function runCommand({ command, args, cwd, env, input, timeout, emitter, onGroup, onExit, directory, scratch, ps = PS, lsof = LSOF, readTimeout = READ_TIMEOUT, outputBound = OUTPUT_BOUND, kill = SIGNAL }) {
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
  // A dispatch's directory the census could not read would leave every process working there
  // alive, so a command given one runs only where the census can read it.
  const { real, why } = directory === undefined ? {} : placed(directory);
  if (why !== undefined) throw notStarted(command, why);
  const { real: scratchReal, why: scratchWhy } = scratch === undefined ? {} : placed(scratch);
  if (scratchWhy !== undefined) throw notStarted(command, scratchWhy);
  install();
  const stdin = input === undefined ? 'ignore' : 'pipe';
  const child = spawned(command, () => spawn(command, args, { cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] }));
  // Where the spawn failed after it returned, Node gives the child no pid and emits why after.
  if (child.pid === undefined) throw notStarted(command, (await once(child, 'error'))[0].message);
  if (input !== undefined) {
    // A command that exits without reading all of its input closes the pipe under the write,
    // which Node reports as an error on standard input. What the command read is its own
    // business, and its result is its exit code and output, so the error is let go.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  }
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  const call = { emitter, ps, lsof, readTimeout, kill, onExit, directory: real, scratch: scratchReal, child, events: [], contained: false };
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
    const kills = [...(await contain(child.pid, call, 'survivor.killed')), ...(await censused(call))];
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
  if (expired) events.push(...(await contain(child.pid, call, 'timeout.killed')));
  const [code, signal] = await exited;
  // The timeout ended the command only where the kill did. One that exited on its own between the
  // timer and the kill ended itself, with its own exit code.
  const timedOut = expired && signal !== null;
  // A command that exited on its own did so before the containment's kill reached it, so every
  // process that containment killed, or could not end, outlived the command.
  if (!timedOut) for (const ending of events) ending[0] = ending[0].replace(/^timeout\./, 'survivor.');
  const exit = signal === null ? code : signalled(signal);
  events.push(...(await contain(child.pid, call, 'survivor.killed')));
  events.push(...(await censused(call)));
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
 * `recorded.killed` through `emitter`, and each it could not end as `recorded.unended`, signalling
 * through `kill` where the caller gives one. Where the sink refused any of those, it rejects with an
 * `EVENT_REFUSED` failure, once the group is empty. Where the start times cannot be read, it
 * rejects having killed nothing.
 *
 * Where L1 recorded the dispatch's `directory`, a real path, the census of that directory follows,
 * whether or not the group was the one recorded: the directory was made for that dispatch alone,
 * and the dead engine's dispatch can have left a process working there whatever became of its
 * group. It follows only where the directory at that path is still the one L1 recorded, by the
 * `identity` it recorded (`unconfirmed`). Where it is not, or that cannot be told, it sweeps nothing
 * there and records a `directory.skipped` event naming the path and why, and the group's kill
 * stands as it is (the architect's ruling 7 on #467). Where L1 recorded the dispatch's `scratch`
 * directory, as its `path`, `device` and `inode`, its census follows on the same terms (ruling 20).
 */
export async function killRecordedGroup({ group, started, emitter, directory, identity, scratch, ps = PS, lsof = LSOF, readTimeout = READ_TIMEOUT, kill = SIGNAL }) {
  const starts = await startsIn(ps, group, readTimeout);
  const kills = recorded(group, started, starts) ? await contain(group, { ps, readTimeout, kill }, 'recorded.killed') : [];
  const recordedDirectories = [[directory, identity], ...(scratch === undefined ? [] : [[scratch.path, scratch]])];
  for (const [each, held] of recordedDirectories) {
    if (each === undefined) continue;
    const replaced = unconfirmed(each, held);
    if (replaced !== undefined) kills.push(['directory.skipped', { directory: each, reason: replaced }]);
    else kills.push(...(await swept(each, { ps, lsof, readTimeout, kill }, 'recorded.killed')));
  }
  const unrecorded = record(emitter, kills);
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
 *
 * A read that lists no process is kept only where signal 0 no longer reaches the group, because a
 * read that failed can list nothing, even one that exits 1 and prints nothing (`run`), and the
 * leaderless rule would take that empty table as a group to kill (`recorded`). A read that leaves
 * out the leader is kept only where signal 0 no longer reaches the leader's pid, which is the
 * group's id: a leader that has exited and not been reaped is listed as a zombie, so a leader left
 * out while its pid still answers was left out by a read that failed, and the leaderless rule
 * would otherwise judge the group without the one start that can show it is not the one
 * recorded. While either holds, it reads again, since a process that is exiting answers signal 0
 * and may not be listed (`occupied`), and where `timeout` passes first it fails, so nothing in the
 * group is killed. That failure says what the last read that answered left out, even where the
 * read after it was still running when `timeout` passed, so a read that answered short is never
 * reported as one that only timed out. Where `timeout` passes before any read has answered, it
 * fails saying the reads did not finish. A leader that has left the group for another holds the read to `timeout` the
 * same way, which kills nothing.
 *
 * So one class of read is left, and nothing but the process table can close it (`D16` rule 3), the
 * same class as on the kill (`beforeKill`): a read that exits 0, lists at least one row, and
 * consistently leaves out a live member other than the leader. Such a read is taken as complete.
 * Where the leader is dead, the leaderless rule then judges the group without that member's start,
 * so the hidden member is killed even where it started before the recorded leader. Two instances:
 * a read that lists only the group's zombies, its dead leader among them, and one that lists only
 * a member started after the recorded leader while the leader has been reaped.
 *
 * A read that lists no row is outside that class. This read takes an empty table again while
 * signal 0 still reaches the group, and where it stays empty until `timeout` it fails, so nothing
 * in the group is killed.
 *
 * No read of the table can find a member it consistently hides, because the table is the only
 * thing that says which pids the group holds. The leader alone is known without it, since its pid
 * is the group's id, and that is why a missing leader can be checked. Signal 0 to the group says
 * only that some process is in it, live or a zombie, not which: it reaches a zombie, and a group
 * holding only zombies, as it reaches a live process (`beforeKill`). So a read hiding a live member
 * while listing zombies is exactly what the table gives for a group holding only zombies, and one
 * hiding it while listing a later member is exactly what it gives for that member alone. Refusing
 * every read that could be one of these would keep for ever the entry of every leaderless group a
 * dead engine left, whether it holds zombies alone or live members of its own.
 *
 * How `ps` reports a group with no process in it, against a read that failed (`D16` rule 3),
 * measured with `/bin/ps` from adv_cmds-240 on macOS 27.0 (26A428) on 2026-09-28, 20 times each,
 * with this read's arguments and `PS_ENV`: a group whose one process had exited and been reaped
 * exited 1 and wrote nothing to either stream; a group `x` exited 1 and wrote `ps: Invalid process
 * group: x` to standard error; a live group exited 0 and printed its row. So a read that failed
 * and wrote nothing, as the stand-in for `ps` in `test/kill-recorded.test.mjs` does, gives the
 * same answer as an empty group, and only signal 0 tells the two apart.
 */
async function startsIn(ps, group, timeout) {
  const deadline = Date.now() + timeout;
  // What the last read that answered left out, while signal 0 still reached it.
  let short;
  const failure = () => new Error(`the reads of the group's start times ${short}, for ${timeout} ms`);
  for (let wait = 0; ; wait = longer(wait)) {
    if (wait > 0) await pause(wait);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw short === undefined ? late(timeout) : failure();
    let rows;
    try {
      rows = rowsOf(await run(ps, ['-ww', '-g', String(group), '-o', 'pid=,stat=,lstart='], remaining, timeout));
    } catch (error) {
      // A read given up at the deadline, after reads that answered short, ends the reads for why they did.
      if (short === undefined || error.code !== 'ETIMEDOUT') throw error;
      throw new Error(`${failure().message}, and the read running at that point was given up: ${error.message}`);
    }
    if (rows.size === 0 && occupied(group)) short = 'listed no process of the group while signal 0 still reached it';
    else if (!rows.has(group) && answers(group)) short = `left out its leader, pid ${group}, while signal 0 still reached that pid`;
    else short = undefined;
    if (short !== undefined) continue;
    const live = [...rows].map(([pid, row]) => [pid, /^(\S+)\s+(.*)$/.exec(row)]).filter(([, row]) => !row?.[1].startsWith('Z'));
    return new Map(live.map(([pid, row]) => [pid, secondsOf(row?.[2] ?? '')]));
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A start time as `ps` prints it under `PS_ENV`, such as `Mon Sep 28 03:50:08 2026`, in whole
 * seconds since the epoch. Only a start that the second it names prints back as, byte for byte,
 * is read, so a malformed one of any kind is refused: a wrong weekday, a day, hour, minute or
 * second past its range, which `Date.UTC` would carry into the next, or padding `ps` never
 * prints. Each could otherwise name a recorded start.
 *
 * How `ps` prints it, from the source of adv_cmds's `ps/print.c` (`lstarted`), on 2026-09-28:
 * the C library's `%c`, left-justified in its column with spaces. Under `PS_ENV`'s locale `%c` is
 * `%a %b %e %T %Y`, measured with `/bin/ps` from adv_cmds-240 and `/bin/date +%c` on macOS 27.0
 * (26A428) on 2026-09-28: `ps` printed `Mon Sep 28 23:47:11 2026` and four spaces, and `date`
 * printed `Tue Sep  1 00:00:00 2026` for a one-digit day, padded with a space. So the column's
 * trailing spaces are its padding, and are not the time's own.
 */
function secondsOf(printed) {
  const text = printed.replace(/ +$/, '');
  const at = /^\S+ (\S+) +(\d+) (\d+):(\d+):(\d+) (\d+)$/.exec(text);
  const seconds = at ? Date.UTC(Number(at[6]), MONTHS.indexOf(at[1]), Number(at[2]), Number(at[3]), Number(at[4]), Number(at[5])) / 1000 : NaN;
  if (Number.isNaN(seconds) || lstartOf(seconds) !== text) throw new Error(`the process table held a start time L0 cannot read: ${JSON.stringify(printed)}`);
  return seconds;
}

/** The second `seconds` as `ps` prints a start under `PS_ENV`, less its column's padding: `%a %b %e %T %Y` in UTC. */
function lstartOf(seconds) {
  const time = new Date(seconds * 1000);
  const two = (field) => String(field).padStart(2, '0');
  const clock = [time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds()].map(two).join(':');
  return `${WEEKDAYS[time.getUTCDay()]} ${MONTHS[time.getUTCMonth()]} ${String(time.getUTCDate()).padStart(2, ' ')} ${clock} ${time.getUTCFullYear()}`;
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
