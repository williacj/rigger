// ABOUTME: Tests that `rigger run`, installed from a tarball, holds its concurrency across a restart
// after it was killed outright while makers that never exit ran, each leaving a grandchild outside
// its group: the restart ends all of them before it reads the board, and the default N is three.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { installFromTarball } from './installed-rigger.mjs';
import { ended, fixture, holding, processState, read, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// A bound on each test alone, so that a run which never reaches the state a test waits for fails
// here rather than holding the suite.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * This checkout packed and installed once for the file, outside the checkout (`R-SAFE-5`), in a
 * directory made at the file's top level, so it is removed once all of the file's tests have ended.
 */
const installed = installFromTarball(root, temporaryDirectory('rigger-restart-concurrency-installed-'));

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A ready card the template's `change` kind selects, with an acceptance the form check admits. */
const card = (number) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, labels: ['type:change'], column: template.board.columns.ready,
  body: '## Acceptance\n\n- The widget turns blue when pressed.\n',
});

/** Four pullable cards. */
const CARDS = [10, 20, 30, 40];

/** The template's kinds with no provisioning step, so each card's one dispatch before its judges is its maker. */
const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config, declaring `concurrency` where it is given and no `concurrency` at all where it is not. */
function settings(concurrency) {
  const { concurrency: declared, ...rest } = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, kinds: KINDS };
  return concurrency === undefined ? rest : { ...rest, concurrency };
}

/** Writes the consumer's config in `repository`, declaring `concurrency` as `settings` does. */
const configure = (repository, concurrency) => writeFileSync(join(repository, 'rigger.config.mjs'), `export default ${JSON.stringify(settings(concurrency))};\n`);

/**
 * Whether `pid` is alive: in the process table and not a zombie, as `ps` reads its state. A zombie's
 * state starts with `Z`, and a pid the table no longer holds reads as nothing.
 */
function living(pid) {
  const state = processState(pid);
  return state !== '' && !state.startsWith('Z');
}

/**
 * The process group `ps` reads for `pid`, as a number, or undefined where the table holds no such
 * process.
 */
function groupOf(pid) {
  const printed = spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return printed === '' ? undefined : Number(printed);
}

/**
 * The real path of the working directory `lsof` reads for each process of this user, by pid, for
 * a census by working directory.
 */
function workingDirectories() {
  const printed = spawnSync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], { encoding: 'utf8' }).stdout;
  const directories = new Map();
  let pid;
  for (const line of printed.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n')) directories.set(pid, line.slice(1));
  }
  return directories;
}

/**
 * A consumer's world for the test `t`: a repository holding the consumer's config under
 * `concurrency`, its main line on `main`, with a local bare `origin`; a fake `gh` holding the four
 * cards over that `origin`; a stand-in agent acting as `plan` says; and a `gh` in `first/` that,
 * on its first call alone, records the state `ps` reads for each pid listed in `watched`, then
 * answers as the fake.
 *
 * `started` holds every engine the test starts, and `recorded` every pid the test learns, each
 * under what it is. The world's teardown ends each engine, and the sweeps of the scratch directory
 * and of the stand-in's directory end every process naming either. Its last hook, registered after
 * theirs, asserts that no recorded pid is alive, and that no process works under either directory,
 * as `ps` and `lsof` read them.
 */
function worldIn(t, concurrency, plan) {
  const started = [];
  t.after(() => Promise.all(started.map(ended)));
  const directory = holding(t);
  const agent = standInAgent(plan);
  const recorded = new Map();
  t.after(() => {
    const left = [...recorded].filter(([pid]) => living(pid)).map(([pid, what]) => `${what} ${pid} (${processState(pid)})`);
    assert.deepEqual(left, [], 'a process the test recorded is alive after its teardown');
    const under = [directory, realpathSync(agent.dir)];
    const working = [...workingDirectories()].filter(([, cwd]) => under.some((each) => cwd === each || cwd.startsWith(`${each}/`)));
    assert.deepEqual(working, [], 'a process works under the test\'s directories after its teardown');
  });
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings(concurrency))};\n` });
  gitIn(repository, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(repository, origin);
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, origin,
    board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items: CARDS.map(card) },
  });
  mkdirSync(join(directory, 'first'));
  writeFileSync(join(directory, 'watched'), '');
  fixture(join(directory, 'first'), 'gh', [
    'if [ ! -f "$here/first-call" ]; then',
    '  while read -r name pid; do printf \'%s %s %s\\n\' "$name" "$pid" "$(/bin/ps -o stat= -p "$pid")"; done < "$here/../watched" > "$here/first-call.tmp"',
    '  printf \'call %s\\n\' "$*" >> "$here/first-call.tmp"',
    '  /bin/mv "$here/first-call.tmp" "$here/first-call"',
    'fi',
    `exec '${fake.gh}' "$@"`,
  ].join('\n'));
  return { directory, repository, fake, agent, started, recorded, state: join(repository, '.rigger') };
}

/**
 * Starts the installed `rigger run` in `world`'s repository, with the fake `gh` and the stand-in
 * agent on its path ahead of node and git alone, and with the recording `gh` in `first/` ahead of
 * them all where `first` is set. Registers it for the world's teardown and records its pid.
 */
function startRun(world, { first = false } = {}) {
  const path = [...(first ? [join(world.directory, 'first')] : []), join(world.directory, 'fake'), world.agent.dir, installed.path].join(delimiter);
  const engine = spawn(installed.rigger, ['run'], { cwd: world.repository, env: { ...process.env, PATH: path }, stdio: ['ignore', 'ignore', 'pipe'] });
  world.started.push(engine);
  world.recorded.set(engine.pid, 'the engine');
  engine.said = '';
  engine.stderr.on('data', (chunk) => { engine.said += chunk; });
  return engine;
}

/**
 * The stand-in runs in the maker's role started after the first `from`, each with its card and pid,
 * and the pid each holds under, where it holds now.
 */
const makersAfter = (world, from = 0) => world.agent.runs().filter((run) => run.role === 'engineer').slice(from);

/** Whether the dispatch record in `world`'s state directory names `pid` as a group. */
const groupRecorded = (world, pid) => readGroups(world.state).some((entry) => entry.group === pid);

/**
 * Whether the maker `run` is held: its stand-in has said it holds, under its own pid, is alive as
 * the process table reads it, and the dispatch record names its group.
 */
const held = (world, run) => world.agent.holder(run.card) === run.pid && living(run.pid) && groupRecorded(world, run.pid);

/**
 * Sends `engine` SIGKILL once `ready` holds, checked on each turn, and settles once it has exited.
 * Fails naming what the engine said where it exited before `ready` held.
 */
async function killedOnce(t, engine, ready, what) {
  const exited = once(engine, 'exit');
  await until(() => ready() || engine.exitCode !== null, t);
  assert.equal(engine.exitCode, null, `the engine exited before ${what}: ${engine.said}`);
  engine.kill('SIGKILL');
  await exited;
}

/**
 * The events of the `index`th run to record in `world`'s stream, counting from 0 by the order each
 * run's first event was recorded, in the order recorded.
 */
function runRecord(world, index) {
  const events = readEvents(world.state);
  const runs = [...new Set(events.map((event) => event.run))];
  assert.ok(runs[index], `the stream holds no run at ${index}: ${JSON.stringify(events)}`);
  return events.filter((event) => event.run === runs[index]);
}

/** The L3 `pull` events among `events`. */
const pullsIn = (events) => events.filter((event) => event.layer === 'L3' && event.event === 'pull');

/**
 * The most L1 dispatch intervals open at once among `events`: each `dispatch.start` opens its
 * dispatch's interval and its `dispatch.end` closes it, in the order recorded, and an interval with
 * no end stays open to the record's end.
 */
function mostOverlapping(events) {
  const open = new Set();
  let most = 0;
  for (const event of events.filter((each) => each.layer === 'L1')) {
    if (event.event === 'dispatch.start') open.add(event.dispatch);
    if (event.event === 'dispatch.end') open.delete(event.dispatch);
    most = Math.max(most, open.size);
  }
  return most;
}

/** Each card's plan: a grandchild left in the workspace's root for 10 and 30, in a subdirectory for 20 and 40, and a hold. */
const ORPHANING = { 10: { engineer: { orphanIn: '.', hold: true } }, 20: { engineer: { orphanIn: 'sub/deeper', hold: true } }, 30: { engineer: { orphanIn: '.', hold: true } }, 40: { engineer: { orphanIn: 'sub/deeper', hold: true } } };

/** Where `card`'s workspace lies for `world`, as the default root and the template's topic name it. */
const workspaceOf = (world, number) => join(realpathSync(world.directory), 'widgets-worktrees', `rigger-${number}`);

/**
 * The run under N 2 over `world`, killed outright once both makers' stand-ins hold and both
 * grandchildren are alive, each intermediate having exited. Settles on each maker, with its card,
 * its stand-in's pid, its intermediate's and its grandchild's.
 */
async function killedAtTwo(t, world) {
  const engine = startRun(world);
  const makers = () => makersAfter(world).map((run) => ({ card: run.card, standIn: run.pid, intermediate: world.agent.intermediate(run.card), grandchild: world.agent.orphan(run.card), run }));
  const settledAtTwo = () => {
    const now = makers();
    for (const maker of now) for (const role of ['standIn', 'intermediate', 'grandchild']) if (maker[role] !== undefined) world.recorded.set(maker[role], `card #${maker.card}'s ${role}`);
    return now.length === 2 && now.every((maker) => held(world, maker.run) && maker.grandchild !== undefined && living(maker.grandchild) && maker.intermediate !== undefined && !living(maker.intermediate));
  };
  await killedOnce(t, engine, settledAtTwo, 'both stand-ins held with their grandchildren alive and their intermediates exited');
  return makers();
}

// proves R-SCHED-2, R-STATE-10, R-STATE-12
test('given four pullable cards and N 2, the installed run killed outright while two makers that never exit each left a grandchild outside its group pulled two cards, and a restart under N 1 ends all four processes before its first board read, records each kill, and pulls one card', SETTLES_WITHIN, async (t) => {
  const world = worldIn(t, 2, ORPHANING);

  const makers = await killedAtTwo(t, world);

  // Items 2 to 5, read as the kill was sent: each stand-in alive in its own recorded group, its
  // grandchild alive outside that group, working in its card's workspace, and its intermediate gone.
  assert.deepEqual(makers.map((maker) => ORPHANING[maker.card].engineer.orphanIn).sort(), ['.', 'sub/deeper'], `the held cards ${makers.map((maker) => maker.card)} are not one of each`);
  const directories = workingDirectories();
  for (const maker of makers) {
    assert.notEqual(groupOf(maker.grandchild), groupOf(maker.standIn), `card #${maker.card}'s grandchild is in its stand-in's group`);
    assert.equal(directories.get(maker.grandchild), join(workspaceOf(world, maker.card), ORPHANING[maker.card].engineer.orphanIn), `card #${maker.card}'s grandchild works elsewhere`);
    assert.equal(living(maker.standIn), true, `card #${maker.card}'s stand-in did not outlive the engine`);
    assert.equal(living(maker.grandchild), true, `card #${maker.card}'s grandchild did not outlive the engine`);
  }

  // Items 7 and 8: the killed run's record is complete, since no maker exited and so no slot freed.
  const killed = runRecord(world, 0);
  const pulls = pullsIn(killed);
  assert.equal(pulls.length, 2, JSON.stringify(killed));
  for (const pull of pulls) assert.ok(pull.inFlight <= 2, JSON.stringify(pull));
  assert.equal(killed.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start').length, 2, JSON.stringify(killed));
  assert.ok(mostOverlapping(killed) <= 2, JSON.stringify(killed));

  // Item 9: the restart under N 1, against the same repository and board.
  const watched = makers.flatMap((maker) => [['stand-in', maker.standIn], ['grandchild', maker.grandchild]]);
  writeFileSync(join(world.directory, 'watched'), watched.map(([name, pid]) => `${name} ${pid}\n`).join(''));
  configure(world.repository, 1);
  for (const number of CARDS) world.agent.plan(number, 'engineer', { hold: true });
  const before = makersAfter(world).length;
  const restarted = startRun(world, { first: true });
  await killedOnce(t, restarted, () => {
    const now = makersAfter(world, before);
    for (const run of now) world.recorded.set(run.pid, `card #${run.card}'s restarted stand-in`);
    return now.length >= 1 && held(world, now[0]);
  }, 'its first maker\'s stand-in held');

  // Item 10: none of the four is alive at the restart's first board read, a zombie counting as not.
  const first = read(join(world.directory, 'first'), 'first-call').split('\n');
  assert.match(first.at(-1), /^call api graphql /, 'the first call is not a board read');
  const states = first.slice(0, -1).map((line) => line.split(' '));
  assert.deepEqual(states.map(([name, pid]) => `${name} ${pid}`), watched.map(([name, pid]) => `${name} ${pid}`));
  assert.deepEqual(states.filter(([, , state]) => state !== undefined && state !== '' && !state.startsWith('Z')), [], first.join('\n'));
  for (const [name, pid] of watched) assert.equal(living(pid), false, `the killed run's ${name} ${pid} is alive`);

  // Item 11: a kill for each of the four, under the killed dispatch's id and card.
  const restartRecord = runRecord(world, 1);
  const dispatches = new Map(killed.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start').map((event) => [event.card, event.dispatch]));
  const kills = restartRecord.filter((event) => event.event === 'recorded.killed');
  for (const maker of makers) {
    for (const pid of [maker.standIn, maker.grandchild]) {
      const kill = kills.filter((event) => event.pid === pid);
      assert.deepEqual(kill.map((event) => ({ dispatch: event.dispatch, card: event.card })), [{ dispatch: dispatches.get(maker.card), card: maker.card }], `the kill of card #${maker.card}'s ${pid}: ${JSON.stringify(kills)}`);
    }
  }

  // Item 12: the restarted run's record, complete once it was killed, holds one pull.
  const restartPulls = pullsIn(runRecord(world, 1));
  assert.deepEqual(restartPulls.map((pull) => pull.inFlight), [1], JSON.stringify(restartRecord));
});

// proves R-SCHED-2
test('given four pullable cards and a config declaring no concurrency, the installed run killed outright once three makers that never exit hold pulled three cards, each with no more than three in flight', SETTLES_WITHIN, async (t) => {
  const world = worldIn(t, undefined, Object.fromEntries(CARDS.map((number) => [number, { engineer: { hold: true } }])));
  const engine = startRun(world);

  await killedOnce(t, engine, () => {
    const now = makersAfter(world);
    for (const run of now) world.recorded.set(run.pid, `card #${run.card}'s stand-in`);
    return now.length === 3 && now.every((run) => held(world, run));
  }, 'three stand-ins held');

  const pulls = pullsIn(runRecord(world, 0));
  assert.equal(pulls.length, 3, JSON.stringify(pulls));
  for (const pull of pulls) assert.ok(pull.inFlight <= 3, JSON.stringify(pull));
});
