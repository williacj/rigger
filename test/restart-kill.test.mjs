// ABOUTME: Tests a restart after Rigger was killed outright mid-dispatch: `rigger once` and `rigger run`
// end what the dead engine's dispatches left before L3 records or reads anything, record each kill
// under its dispatch, and stop, naming why, where the record or a recorded group cannot be read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, constants as files, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { readGroups, recordPath, writeGroups } from '../src/execution/groups.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { TAIL, alive, ended, fixture, holding, leave, read, running, startGroup, turn, until, withoutLeader } from './process-fixtures.mjs';
import { leaveWorking } from './process-fixtures.mjs';
import { assertUntouched, tailIn } from './process-fixtures.mjs';
import { chmodSync, rmSync, statSync } from 'node:fs';
import { warmed } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { writeSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

// A bound on the test alone, so that a run which never settles fails here rather than holding the
// suite: nothing waits on it when the test settles.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card L2 would dispatch, in the template's column displayed as `column`. */
const card = (number, column = template.board.columns.ready) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column,
});

/**
 * A consumer's world for the test `t`, inside a scratch directory its teardown sweeps: a
 * repository holding the template's config for the board, under N 3; a fake `gh` holding `items`
 * on that board; and a `gh` in `first/` that records, on its first call alone, which of the pids
 * the fixture wrote to `command.pid` and `child.pid` are alive, then answers as the fake, or,
 * where `hangs` is set, never answers.
 *
 * `started` holds every Node process the test starts in this world, the engine and each restart.
 * Teardown hooks run in the order they are registered, and theirs is registered before the
 * sweep's, so each is dead before the sweep looks for what it spawned. A restart's command line
 * does not name the scratch directory, so the sweep alone would not end it.
 */
function consumerIn(t, items, { hangs = false } = {}) {
  const started = [];
  t.after(() => Promise.all(started.map(ended)));
  const directory = holding(t);
  const kinds = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3, kinds };
  const repository = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(directory, 'origin.git'));
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items },
  });
  mkdirSync(join(directory, 'first'));
  fixture(join(directory, 'first'), 'gh', [
    'if [ ! -f "$here/first-call" ]; then',
    `  for name in command child; do pid=$(/bin/cat '${directory}'/$name.pid 2>/dev/null) && kill -0 "$pid" 2>/dev/null && echo "$name $pid alive"; done > "$here/first-call.tmp"`,
    '  printf \'call %s\\n\' "$*" >> "$here/first-call.tmp"',
    '  /bin/mv "$here/first-call.tmp" "$here/first-call"',
    'fi',
    hangs ? 'exec /usr/bin/tail -f "$here/../hold"' : `exec '${fake.gh}' "$@"`,
  ].join('\n'));
  return { directory, repository, fake, started, state: join(repository, '.rigger') };
}

/** What the `gh` in `first/` recorded at its first call: the lines naming a live process, and the call. */
function atFirstCall(world) {
  const lines = read(join(world.directory, 'first'), 'first-call').split('\n');
  return { alive: lines.filter((line) => line.endsWith(' alive')), call: lines.find((line) => line.startsWith('call ')) };
}

/**
 * A command that writes its pid to `command.pid`, leaves a `tail` running until killed whose pid
 * it writes to `child.pid`, marks `ready`, and then waits on that child for ever, or, where
 * `exits` is set, until the test opens the FIFO `exit-now`, when it exits 0.
 */
function dispatchedCommand(directory, { exits = false } = {}) {
  if (exits) spawnSync('/usr/bin/mkfifo', [join(directory, 'exit-now')]);
  return fixture(directory, 'command', [
    'echo $$ > "$here/command.pid"',
    leave(TAIL, 'child'),
    ': > "$here/ready"',
    exits ? 'read line < "$here/exit-now"\nexit 0' : 'wait',
  ].join('\n'));
}

/**
 * Starts the engine that stands in for Rigger mid-dispatch, a Node process of its own running one
 * pull of L3's loop over `world`'s board, with the fake `gh` first on its PATH, whose dispatch
 * runs `command`, in `workspace` as the dispatch's directory where it is given, and reads the
 * process table through `ps` where it is given. Its command line names the scratch directory, so
 * the teardown ends it.
 */
function startEngine(world, command, { ps, workspace } = {}) {
  const harness = new URL('./mid-dispatch-engine.mjs', import.meta.url).href;
  const given = { directory: world.directory, repository: world.repository, command, ps, workspace };
  const code = `const { engine } = await import(${JSON.stringify(harness)});\nawait engine(${JSON.stringify(given)});`;
  const engine = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: world.repository,
    env: { ...process.env, PATH: [join(world.directory, 'fake'), process.env.PATH].join(delimiter) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  world.started.push(engine);
  engine.said = '';
  engine.stderr.on('data', (chunk) => { engine.said += chunk; });
  return engine;
}

/**
 * Whether the command's group is recorded in `world`: the command has written its pid, and the
 * record in the state directory holds an entry naming that pid as a group.
 */
function groupRecorded(world) {
  if (!existsSync(join(world.directory, 'command.pid'))) return false;
  const group = Number(read(world.directory, 'command.pid'));
  return readGroups(world.state).some((entry) => entry.group === group);
}

/**
 * The engine killed outright mid-dispatch: started over `world` on `command`, in `workspace` where
 * it is given, reading the process table through `ps` where it is given, and sent SIGKILL once the command and its child have both
 * signalled they are running and the record names the command's group. Settles once the engine
 * has exited, on the pids of the command and its child.
 *
 * The kill waits on the record as well as on `ready`, because the two are not ordered. L1 records
 * the group in the step after L0 spawns it, once L0 has read the command's start time, while the
 * command runs on meanwhile. So on a loaded host the command can mark `ready` first, and a kill
 * made then lands in the window `dispatch` leaves open, which leaves a group no entry names and
 * no restart ends: the window the owner left open (round 4, and the architect's ruling 3, §6, on
 * #332), as the note beside the entry's write in `src/execution/run.mjs` records.
 */
async function killedMidDispatch(t, world, command, { ps, workspace } = {}) {
  const engine = startEngine(world, command, { ps, workspace });
  const exited = once(engine, 'exit');
  await awaiting(t, 'the command to mark ready and the record to name its group, or the engine to exit', until(() => (existsSync(join(world.directory, 'ready')) && groupRecorded(world)) || engine.exitCode !== null, t));
  assert.ok(existsSync(join(world.directory, 'ready')) && groupRecorded(world), `the engine ended before its dispatch ran and was recorded: ${engine.said}`);
  engine.kill('SIGKILL');
  await exited;
  return { command: Number(read(world.directory, 'command.pid')), child: Number(read(world.directory, 'child.pid')) };
}

/**
 * Starts the real bin's `verb` in `world`'s repository, with the recording `gh` first on PATH and
 * the fake after it, and registers it for the test's teardown to end. Answers the process, and
 * `ran`, which settles once it has exited on its status and what it printed.
 */
function startRestart(world, verb) {
  const path = [join(world.directory, 'first'), join(world.directory, 'fake'), process.env.PATH].join(delimiter);
  const child = spawn(process.execPath, [bin, verb], { cwd: world.repository, env: { ...process.env, PATH: path }, stdio: ['ignore', 'pipe', 'pipe'] });
  world.started.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ran = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return { child, ran };
}

/** Runs the real bin's `verb` in `world`, as `startRestart` starts it, and settles as it has ended. */
const restart = (world, verb) => startRestart(world, verb).ran;

/**
 * The dead engine's dispatch, as its start event names it, and what the restart recorded: every
 * event under a run other than the engine's, in the order recorded.
 */
function restartRecord(world) {
  const events = readEvents(world.state);
  const start = events.find((event) => event.event === 'dispatch.start');
  assert.ok(start, `the dead engine recorded no dispatch start: ${JSON.stringify(events)}`);
  return { dispatch: start.dispatch, card: start.card, restarted: events.filter((event) => event.run !== start.run) };
}

/**
 * Asserts that the restart recorded the kill of each of `pids` under the dead engine's dispatch
 * and card, and every one before the restart's first L3 event.
 */
function assertKillsFirst(world, pids) {
  const { dispatch, card, restarted } = restartRecord(world);
  const kills = restarted.filter((event) => event.event === 'recorded.killed');
  assert.deepEqual(kills.map((event) => event.pid).sort(), [...pids].sort(), JSON.stringify(restarted));
  for (const kill of kills) assert.deepEqual({ layer: kill.layer, dispatch: kill.dispatch, card: kill.card }, { layer: 'L0', dispatch, card }, JSON.stringify(kill));
  const firstL3 = restarted.findIndex((event) => event.layer === 'L3');
  assert.ok(firstL3 >= 0, `the restart recorded no L3 event: ${JSON.stringify(restarted)}`);
  assert.ok(restarted.every((event, index) => event.event !== 'recorded.killed' || index < firstL3), JSON.stringify(restarted));
}

/**
 * Asserts that the restart through `verb` dispatched no maker of its own, and printed for the card
 * it claimed exactly what `once` and `run` print in M3: its workspace, and that no maker runs
 * before M4. The world's kinds list no step, so no dispatch of the restart's arises at all.
 */
function assertNoMakerOfItsOwn(world, verb, ran) {
  const { restarted } = restartRecord(world);
  assert.deepEqual(restarted.filter((event) => event.dispatch !== undefined && event.event !== 'recorded.killed'), []);
  assert.equal(ran.stdout, '');
  const workspace = join(realpathSync(world.directory), 'widgets-worktrees', 'rigger-10');
  assert.equal(ran.stderr, `rigger ${verb}: claimed #10 from board ${PROJECT}; no maker runs before M4, so it stopped at its workspace, ${workspace}\n`);
}

/**
 * The engine killed outright after its dispatched command and child have signalled they are
 * running, and while both run, and `verb` started afterwards: asserts that neither is alive at
 * the moment the restart's first board read reaches the forge stand-in, or afterwards.
 */
async function neitherAliveAtFirstRead(t, verb) {
  const world = consumerIn(t, [card(10)]);
  const pids = await killedMidDispatch(t, world, dispatchedCommand(world.directory));
  assert.equal(alive(pids.command) && alive(pids.child), true, 'the command and its child outlived the engine');

  const ran = await restart(world, verb);

  const first = atFirstCall(world);
  assert.deepEqual(first.alive, [], ran.stderr);
  assert.match(first.call, /^call api graphql /, 'the first call is a board read');
  assert.equal(alive(pids.command) || alive(pids.child), false);
}

/**
 * The same restart through `verb`: asserts that the stream holds each kill under the killed
 * dispatch's id and card, every one before the restart's first L3 event, and that `verb`
 * dispatched no maker of its own and printed what M3's verb prints.
 */
async function killsRecordedFirst(t, verb) {
  const world = consumerIn(t, [card(10)]);
  const pids = await killedMidDispatch(t, world, dispatchedCommand(world.directory));

  const ran = await restart(world, verb);

  assertKillsFirst(world, [pids.command, pids.child]);
  assertNoMakerOfItsOwn(world, verb, ran);
}

// proves R-STATE-10
test('given the engine SIGKILLed after a dispatched command and its child have signalled they are running, and while both run, rigger once started afterwards leaves neither alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, (t) => neitherAliveAtFirstRead(t, 'once'));

// proves R-STATE-10
test('given the engine SIGKILLed after a dispatched command and its child have signalled they are running, and while both run, rigger run started afterwards leaves neither alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, (t) => neitherAliveAtFirstRead(t, 'run'));

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger once, the stream holds each kill under the killed dispatch\'s id and card, every one before the restart\'s first L3 event, and once dispatched no maker of its own, and printed what M3\'s verb prints', SETTLES_WITHIN, (t) => killsRecordedFirst(t, 'once'));

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger run, the stream holds each kill under the killed dispatch\'s id and card, every one before the restart\'s first L3 event, and run dispatched no maker of its own, and printed what M3\'s verb prints', SETTLES_WITHIN, (t) => killsRecordedFirst(t, 'run'));

// proves R-STATE-17, R-STATE-10
test('given the engine SIGKILLed while a dispatch runs with a process that left its group, working under the dispatch\'s directory, rigger once started afterwards leaves that process not alive when its first board read reaches the forge stand-in, and records its kill first', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const workspace = join(world.directory, 'work');
  mkdirSync(workspace);
  // The process that leaves the group writes its pid to `child.pid`, which the `gh` in `first/`
  // reads at its first call. The command then waits on it, which holds the command running.
  const command = fixture(world.directory, 'command', ['echo $$ > "$here/command.pid"', leaveWorking('work/sub', 'child'), ': > "$here/ready"', 'wait'].join('\n'));
  const pids = await killedMidDispatch(t, world, command, { workspace });
  assert.equal(alive(pids.child), true, 'the process that left the group did not outlive the engine, so the test proves nothing');

  const ran = await restart(world, 'once');

  const first = atFirstCall(world);
  assert.deepEqual(first.alive, [], ran.stderr);
  assert.match(first.call, /^call api graphql /, 'the first call is a board read');
  assertKillsFirst(world, [pids.command, pids.child]);
});

/**
 * Restarts `world` through `rigger once`, and asserts that the start skipped the sweep of `path`,
 * recording why under the dead dispatch with a reason matching `reason`, that it reached its first
 * board read, and that it left `pid`, a process working at `path`, where there is one, alive and
 * running. Answers the restart's events.
 */
async function sweepSkipped(world, path, reason, pid) {
  const ran = await restart(world, 'once');

  assert.match(atFirstCall(world).call, /^call api graphql /, `the start did not reach its first board read: ${ran.stderr}`);
  // A dispatch the dead engine started has its start in the stream; an entry the test wrote is
  // dispatch `d-dead` of card 10 (`entryFor`), and the stream holds nothing before the restart.
  const events = readEvents(world.state);
  const start = events.find((event) => event.event === 'dispatch.start');
  const { dispatch, card } = start ?? { dispatch: 'd-dead', card: 10 };
  const restarted = events.filter((event) => event.run !== start?.run);
  const skipped = restarted.filter((event) => event.event === 'directory.skipped');
  assert.deepEqual(skipped.map((event) => ({ layer: event.layer, dispatch: event.dispatch, card: event.card, directory: event.directory })), [{ layer: 'L0', dispatch, card, directory: path }], JSON.stringify(restarted));
  assert.match(skipped[0].reason, reason);
  if (pid !== undefined) assertUntouched(pid, `the process working at ${path}`);
  return restarted;
}

// proves R-STATE-17, R-STATE-10
test('given the engine SIGKILLed while a dispatch runs, and its directory then removed and made again at the same path, holding a process outside every group Rigger created, rigger once leaves that process alive and records that it skipped the sweep, naming the path and why', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const workspace = join(world.directory, 'work');
  mkdirSync(workspace);
  const command = fixture(world.directory, 'command', ['echo $$ > "$here/command.pid"', leaveWorking('work/sub', 'child'), ': > "$here/ready"', 'wait'].join('\n'));
  await killedMidDispatch(t, world, command, { workspace });
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace);
  const fresh = await tailIn(t, world.directory, workspace);

  await sweepSkipped(world, workspace, /is not the directory recorded/, fresh);
});

/**
 * A group a dead engine left, as `startGroup` starts it in `world`, and its entry in the record,
 * naming `workspace` as the dispatch's directory, with `extra`. Asserts, once the test has run
 * the restart, that the start killed the group and recorded each kill.
 */
async function deadDispatchIn(t, world, workspace, extra = {}) {
  const started = await startGroup(t, world.directory, 'group');
  writeGroups(world.state, [entryFor(started, { workspace, ...extra })]);
  return (restarted) => {
    assert.equal(alive(started.leader) || alive(started.member), false, 'a process of the recorded group is alive');
    const kills = restarted.filter((event) => event.event === 'recorded.killed').map((event) => event.pid);
    assert.deepEqual(kills.sort(), [started.leader, started.member].sort(), JSON.stringify(restarted));
  };
}

// proves R-STATE-17, R-STATE-10
test('given a record entry whose directory carries no device and inode, rigger once sweeps nothing there, records why naming the path, kills the entry\'s group, and reaches its first board read', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const workspace = join(world.directory, 'plain');
  const there = await tailIn(t, world.directory, workspace);
  const killedGroup = await deadDispatchIn(t, world, workspace);

  killedGroup(await sweepSkipped(world, workspace, /carries no device and inode/, there));
});

// proves R-STATE-17, R-STATE-10
test('given a record entry whose directory\'s path no longer exists, rigger once sweeps nothing there, records why naming the path, kills the entry\'s group, and reaches its first board read', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const workspace = join(world.directory, 'gone');
  const killedGroup = await deadDispatchIn(t, world, workspace, { device: '1', inode: '1' });

  killedGroup(await sweepSkipped(world, workspace, /ENOENT/));
});

// proves R-STATE-17, R-STATE-10
test('given a record entry whose directory\'s device and inode cannot be read at its path, rigger once sweeps nothing there, records why naming the path, kills the entry\'s group, and reaches its first board read', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const locked = join(world.directory, 'locked');
  const workspace = join(locked, 'work');
  const there = await tailIn(t, world.directory, workspace);
  const { dev, ino } = statSync(workspace, { bigint: true });
  const killedGroup = await deadDispatchIn(t, world, workspace, { device: String(dev), inode: String(ino) });
  // A directory no one may search, so `stat` of a path under it fails.
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o755));

  killedGroup(await sweepSkipped(world, workspace, /EACCES/, there));
});

/**
 * Settles as `wait` does. Where the test `t` ends first, as its timeout ends it, the runner's report
 * of the test names `what`, the condition `wait` was on, so the wait that never settled is named
 * beside the timeout.
 */
async function awaiting(t, what, wait) {
  const named = () => t.diagnostic(`the test ended while it waited for ${what}`);
  t.signal.addEventListener('abort', named, { once: true });
  try {
    return await wait;
  } finally {
    t.signal.removeEventListener('abort', named);
  }
}

/**
 * Writes a line to the FIFO `name` in `directory`, which lets its reader go on, and settles once the
 * reader has closed it. The open fails until the reader is there, so it is retried each turn until
 * the test `t` ends.
 *
 * One open and close is not enough. Under load, a writer that opens and closes while the reader's
 * own open is under way can leave the reader blocked in its read for ever, with the FIFO open as
 * its standard input and no writer left. Measured with Node 26.5.0 on macOS 27.0 on 2026-10-01: of
 * 5,800 shell readers released so, 5 stayed blocked, every one at a one-minute load of 40 or more
 * (#515's journal entry). So each turn that finds a reader writes it a line, which its read returns
 * however the close went, and the wait ends only once an open finds no reader left: the reader has
 * read and gone on.
 */
async function opened(t, directory, name) {
  let reached = false;
  await awaiting(t, `the reader of the FIFO ${name} to read a line and close it`, until(() => {
    let writer;
    try {
      writer = openSync(join(directory, name), files.O_WRONLY | files.O_NONBLOCK);
    } catch (error) {
      if (error.code === 'ENXIO') return reached;
      throw error;
    }
    reached = true;
    try {
      writeSync(writer, '\n');
    } catch (error) {
      // The reader closed between the open and the write: it has read and gone on.
      if (error.code !== 'EPIPE') throw error;
    } finally {
      closeSync(writer);
    }
    return false;
  }, t));
}

/**
 * Opens the FIFO `name` in `directory` for writing, and answers the descriptor, once its reader is
 * there: the open fails until it is, so it is tried each turn until the test `t` ends.
 */
async function writerOn(t, directory, name) {
  let writer;
  await until(() => {
    try {
      writer = openSync(join(directory, name), files.O_WRONLY | files.O_NONBLOCK);
      return true;
    } catch (error) {
      if (error.code === 'ENXIO') return false;
      throw error;
    }
  }, t);
  return writer;
}

test('given a reader of a FIFO left blocked in its read while a writer it still counts holds the FIFO open, as a writer\'s close it missed leaves it, `opened` lets the reader go on', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  spawnSync('/usr/bin/mkfifo', [join(directory, 'go')]);
  const reader = spawn('/bin/sh', [fixture(directory, 'reader', 'read line < "$here/go"\nexit 0')], { stdio: 'ignore' });
  const exited = once(reader, 'exit');
  const held = await writerOn(t, directory, 'go');
  t.after(() => closeSync(held));

  await opened(t, directory, 'go');

  await awaiting(t, 'the reader to exit', exited);
});

/**
 * The engine killed outright while its command and child run, then the command exiting on its own
 * while its child stays alive. Settles once the command is gone, on both pids. `ps` is handed to
 * the engine (`killedMidDispatch`).
 */
async function leaderGoneAfterDeath(t, world, { ps } = {}) {
  const pids = await killedMidDispatch(t, world, dispatchedCommand(world.directory, { exits: true }), { ps });
  // The command waits in its open of the FIFO for a writer.
  await opened(t, world.directory, 'exit-now');
  await awaiting(t, 'the command to exit', until(() => !alive(pids.command), t));
  assert.equal(alive(pids.child), true, 'the child outlived its command');
  return pids;
}

// proves R-STATE-10
test('given the engine SIGKILLed while a dispatched command and its child run, and the command then exiting on its own while the child stays alive, rigger once started afterwards leaves the child not alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const pids = await leaderGoneAfterDeath(t, world);

  const ran = await awaiting(t, '`rigger once` to exit and close its output', restart(world, 'once'));

  assert.deepEqual(atFirstCall(world).alive, [], ran.stderr);
  assert.equal(alive(pids.child), false);
});

/**
 * A stand-in for `ps` in `directory` whose reads of a start time, which L0 makes of a command it
 * has just spawned before L1 records its group, mark `reading` and wait until the test opens the
 * FIFO `release`. Every other read is `ps`'s own. It is `warmed`, because the start-time read is
 * its first exec, which must reach its body within the engine's read timeout.
 */
function heldStartRead(directory) {
  spawnSync('/usr/bin/mkfifo', [join(directory, 'release')]);
  return warmed(fixture(directory, 'ps', [
    'case "$*" in *lstart=*)',
    '  : > "$here/reading"',
    '  read line < "$here/release" ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
}

// proves R-STATE-10
test('given the engine\'s record of its dispatch\'s group held back until after the command has marked ready, then the engine SIGKILLed while the command and its child run, and the command exiting on its own while the child stays alive, rigger once started afterwards leaves the child not alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const gone = leaderGoneAfterDeath(t, world, { ps: heldStartRead(world.directory) });
  // The engine's read of the command's start, which it takes before it records the group, is held
  // until the command has marked ready and a turn has passed: the turn in which a kill made on
  // `ready` alone would already have been sent.
  await until(() => existsSync(join(world.directory, 'ready')) && existsSync(join(world.directory, 'reading')), t);
  await turn(t);
  await opened(t, world.directory, 'release');
  const pids = await gone;

  const ran = await restart(world, 'once');

  assert.deepEqual(atFirstCall(world).alive, [], ran.stderr);
  assert.equal(alive(pids.child), false);
});

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger once, the stream holds the child\'s kill under the killed dispatch\'s id and card, before the restart\'s first L3 event, and once dispatched no maker of its own, and printed what M3\'s verb prints', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const pids = await leaderGoneAfterDeath(t, world);

  const ran = await restart(world, 'once');

  assertKillsFirst(world, [pids.child]);
  assertNoMakerOfItsOwn(world, 'once', ran);
});

test('the engine standing in for Rigger mid-dispatch allocates each dispatch an id that no other dispatch in the same state directory holds, across runs', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10), card(20)]);
  const command = fixture(world.directory, 'command', 'exit 0');

  // Two runs over one state directory: the first dispatches both ready cards, and the second
  // redoes both, since no verdict covers either.
  for (let run = 0; run < 2; run += 1) {
    const engine = startEngine(world, command);
    const [code] = await once(engine, 'exit');
    assert.equal(code, 0, engine.said);
  }

  const starts = readEvents(world.state).filter((event) => event.event === 'dispatch.start');
  assert.equal(new Set(starts.map((event) => event.run)).size, 2, 'the dispatches span two runs');
  assert.equal(starts.length, 4, JSON.stringify(starts));
  assert.equal(new Set(starts.map((event) => event.dispatch)).size, 4, JSON.stringify(starts));
});

// A record, or a recorded group, the restart cannot read.

/** The entry the record holds for the group `started`, under dispatch `d-dead` and card 10 unless `extra` says otherwise. */
const entryFor = ({ group, started }, extra = {}) => ({ group, started, dispatch: 'd-dead', card: 10, ...extra });

/** `once` run in-process in `world`'s repository, handed `ps` and a bound on its reads, with a forge stand-in that records every call and answers none. */
async function onceWithPs(world, ps) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args].join(' '));
    return { status: 1, stdout: '', stderr: 'this forge stand-in answers nothing' };
  };
  const ran = await onceVerb({ target: world.repository, send, ps, readTimeout: 300 });
  return { ...ran, sent };
}

test('given a sink that refuses the start\'s kill events, rigger once exits non-zero naming each unrecorded kill, and the forge stand-in receives no call', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await startGroup(t, world.directory, 'group');
  writeGroups(world.state, [entryFor(started)]);
  // A directory where the stream's file goes refuses every append.
  mkdirSync(join(world.state, 'events.jsonl'));

  const ran = await restart(world, 'once');

  assert.notEqual(ran.status, 0, ran.stdout);
  for (const pid of [started.leader, started.member]) assert.match(ran.stderr, new RegExp(`d-dead, card #10: recorded\\.killed \\{"pid":${pid},`), ran.stderr);
  assert.deepEqual(world.fake.sent(), []);
});

// proves R-STATE-11
test('given a record that cannot be read, rigger once exits non-zero naming the record\'s file, and the forge stand-in receives no call', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await startGroup(t, world.directory, 'group');
  writeGroups(world.state, [entryFor(started)]);
  writeFileSync(recordPath(world.state), `${JSON.stringify([entryFor(started)]).slice(0, -3)}`);

  const ran = await restart(world, 'once');

  assert.notEqual(ran.status, 0, ran.stdout);
  assert.ok(ran.stderr.includes(recordPath(world.state)), ran.stderr);
  assert.deepEqual(world.fake.sent(), []);
  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
});

/** A stand-in for `ps` in `directory` that never answers: it follows a file nothing writes to. */
const silentPs = (directory) => fixture(directory, 'ps', 'exec /usr/bin/tail -f "$here/hold"');

/** Asserts that `text` names the entry for `started` under dispatch `d-dead` and card 10. */
function assertNamesEntry(text, started) {
  for (const named of [`group ${started.group}`, 'd-dead', '#10']) assert.ok(text.includes(named), `the failure does not name ${named}: ${text}`);
}

// proves R-STATE-11
test('given a recorded group whose start-time read never answers, rigger once exits non-zero naming that entry, and the forge stand-in receives no call', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await startGroup(t, world.directory, 'group');
  writeGroups(world.state, [entryFor(started)]);

  const ran = await onceWithPs(world, silentPs(world.directory));

  assert.notEqual(ran.code, 0, ran.text);
  assertNamesEntry(ran.text, started);
  assert.deepEqual(ran.sent, []);
  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
});

// proves R-STATE-11
test('given a recorded group with a live member whose start-time read exits 1 and prints nothing, rigger once exits non-zero naming that entry, and the forge stand-in receives no call', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await withoutLeader(t, await startGroup(t, world.directory, 'group'));
  writeGroups(world.state, [entryFor(started)]);

  const ran = await onceWithPs(world, fixture(world.directory, 'ps', 'exit 1'));

  assert.notEqual(ran.code, 0, ran.text);
  assertNamesEntry(ran.text, started);
  assert.deepEqual(ran.sent, []);
  assert.equal(alive(started.member), true, 'the member was killed');
});

// proves R-STATE-11
test('given a recorded group whose start-time read never answered on one start and answers on the next, confirming the group is the one recorded, the next rigger once ends every process in it', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await startGroup(t, world.directory, 'group');
  writeGroups(world.state, [entryFor(started)]);
  const unanswered = await onceWithPs(world, silentPs(world.directory));
  assert.notEqual(unanswered.code, 0, unanswered.text);
  assert.deepEqual(readGroups(world.state), [entryFor(started)], 'the first start kept the entry');

  const ran = await restart(world, 'once');

  assert.equal(alive(started.leader) || alive(started.member), false, ran.stderr);
  assert.deepEqual(readGroups(world.state), []);
});

test('given a recorded group id whose live leader started after the entry was written, rigger once leaves that process alive', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const started = await startGroup(t, world.directory, 'group');
  // The entry was written a minute before this leader started: an earlier group given the same id.
  writeGroups(world.state, [entryFor(started, { started: started.started - 60 })]);

  const ran = await restart(world, 'once');

  assert.match(ran.stderr, /claimed #10\b/, ran.stderr);
  assert.equal(alive(started.leader), true, 'the leader was killed');
  assert.equal(alive(started.member), true, 'the member was killed');
});

test('given a restart whose forge stand-in never answers, still running when its test ends, the teardown that test registered ends the restart and leaves no process naming its scratch directory alive', SETTLES_WITHIN, async (t) => {
  // The world's teardown hooks are collected rather than run by the runner, then run in the order
  // registered, as the runner runs them once a test has ended or timed out.
  const hooks = [];
  const world = consumerIn({ after: (hook) => hooks.push(hook) }, [card(10)], { hangs: true });
  t.after(() => Promise.all(world.started.map(ended)));
  t.after(() => running(world.directory).length > 0 && spawnSync('/usr/bin/pkill', ['-KILL', '-f', world.directory]));
  const { child, ran } = startRestart(world, 'once');
  await until(() => existsSync(join(world.directory, 'first', 'first-call')), t);
  assert.equal(child.exitCode, null, 'the restart ended before its forge stand-in was asked');

  for (const hook of hooks) await hook();

  assert.equal(child.signalCode, 'SIGKILL', 'the restart was still running once the teardown had run');
  assert.deepEqual(running(world.directory), []);
  await ran;
});
