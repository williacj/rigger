// ABOUTME: Tests a restart after Rigger was killed outright mid-dispatch: `rigger once` and `rigger run`
// end what the dead engine's dispatches left before L3 records or reads anything, record each kill
// under its dispatch, and stop, naming why, where the record or a recorded group cannot be read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, constants as files, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { readGroups, recordPath, writeGroups } from '../src/execution/groups.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt } from './git-repository.mjs';
import { TAIL, alive, ended, fixture, holding, leave, read, running, startGroup, until, withoutLeader } from './process-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

// A bound on the test alone, so that a run which never settles fails here rather than holding the
// suite: nothing waits on it when the test settles.
const SETTLES_WITHIN = { timeout: 60_000 };

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
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3 };
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
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
 * runs `command`. Its command line names the scratch directory, so the teardown ends it.
 */
function startEngine(world, command) {
  const harness = new URL('./mid-dispatch-engine.mjs', import.meta.url).href;
  const given = { directory: world.directory, repository: world.repository, command };
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
 * The engine killed outright mid-dispatch: started over `world` on `command`, and sent SIGKILL
 * once the command and its child have both signalled they are running. Settles once the engine
 * has exited, on the pids of the command and its child.
 */
async function killedMidDispatch(t, world, command) {
  const engine = startEngine(world, command);
  const exited = once(engine, 'exit');
  await until(() => existsSync(join(world.directory, 'ready')) || engine.exitCode !== null, t);
  assert.ok(existsSync(join(world.directory, 'ready')), `the engine ended before its dispatch ran: ${engine.said}`);
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
 * Asserts that the restart through `verb` started no dispatch of its own, and printed for the card
 * it claimed exactly what `once` and `run` print at the base: they dispatch nothing before M4.
 */
function assertNoDispatchOfItsOwn(world, verb, ran) {
  const { restarted } = restartRecord(world);
  assert.deepEqual(restarted.filter((event) => event.layer === 'L1' || (event.dispatch !== undefined && event.event !== 'recorded.killed')), []);
  assert.equal(ran.stdout, '');
  assert.equal(ran.stderr, `rigger ${verb}: claimed #10 from board ${PROJECT}, and it was not worked: dispatch arrives with M2 and M4\n`);
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
 * dispatch's id and card, every one before the restart's first L3 event, and that `verb` started
 * no dispatch of its own and printed what the base prints.
 */
async function killsRecordedFirst(t, verb) {
  const world = consumerIn(t, [card(10)]);
  const pids = await killedMidDispatch(t, world, dispatchedCommand(world.directory));

  const ran = await restart(world, verb);

  assertKillsFirst(world, [pids.command, pids.child]);
  assertNoDispatchOfItsOwn(world, verb, ran);
}

// proves R-STATE-10
test('given the engine SIGKILLed after a dispatched command and its child have signalled they are running, and while both run, rigger once started afterwards leaves neither alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, (t) => neitherAliveAtFirstRead(t, 'once'));

// proves R-STATE-10
test('given the engine SIGKILLed after a dispatched command and its child have signalled they are running, and while both run, rigger run started afterwards leaves neither alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, (t) => neitherAliveAtFirstRead(t, 'run'));

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger once, the stream holds each kill under the killed dispatch\'s id and card, every one before the restart\'s first L3 event, and once started no dispatch of its own and printed what the base prints', SETTLES_WITHIN, (t) => killsRecordedFirst(t, 'once'));

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger run, the stream holds each kill under the killed dispatch\'s id and card, every one before the restart\'s first L3 event, and run started no dispatch of its own and printed what the base prints', SETTLES_WITHIN, (t) => killsRecordedFirst(t, 'run'));

/**
 * The engine killed outright while its command and child run, then the command exiting on its own
 * while its child stays alive. Settles once the command is gone, on both pids.
 */
async function leaderGoneAfterDeath(t, world) {
  const pids = await killedMidDispatch(t, world, dispatchedCommand(world.directory, { exits: true }));
  // The command waits in its open of the FIFO for a writer. Opening it without blocking fails
  // until that reader is there, so the open is retried each turn.
  let writer;
  await until(() => {
    try {
      writer = openSync(join(world.directory, 'exit-now'), files.O_WRONLY | files.O_NONBLOCK);
      return true;
    } catch (error) {
      if (error.code === 'ENXIO') return false;
      throw error;
    }
  }, t);
  closeSync(writer);
  await until(() => !alive(pids.command), t);
  assert.equal(alive(pids.child), true, 'the child outlived its command');
  return pids;
}

// proves R-STATE-10
test('given the engine SIGKILLed while a dispatched command and its child run, and the command then exiting on its own while the child stays alive, rigger once started afterwards leaves the child not alive when its first board read reaches the forge stand-in', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const pids = await leaderGoneAfterDeath(t, world);

  const ran = await restart(world, 'once');

  assert.deepEqual(atFirstCall(world).alive, [], ran.stderr);
  assert.equal(alive(pids.child), false);
});

// proves R-STATE-10, R-STATE-12
test('after that restart through rigger once, the stream holds the child\'s kill under the killed dispatch\'s id and card, before the restart\'s first L3 event, and once started no dispatch of its own and printed what the base prints', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t, [card(10)]);
  const pids = await leaderGoneAfterDeath(t, world);

  const ran = await restart(world, 'once');

  assertKillsFirst(world, [pids.child]);
  assertNoDispatchOfItsOwn(world, 'once', ran);
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
