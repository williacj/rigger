// ABOUTME: Tests the verbs that build a forge side as the real bin runs them, with a `gh` stand-in
// that leaves a child alive or never exits: each kill ends and is recorded, a kill the sink refuses
// stops the verb before its next forge call, SIGTERM mid-read, even inside L0's spawn, ends the verb
// by that signal, and a test's teardown ends its verb before it sweeps the verb's fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryIn } from './git-repository.mjs';
import { childrenIn, fixture, gone, holding, leave, running as naming, sweep, TAIL, until } from './process-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A board holding the template's columns and priority field, so every verb reads it whole. */
const BOARD = {
  columns: Object.values(template.board.columns),
  fields: [{ name: template.board.priority.field, options: template.board.priority.options }],
};

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A ready card L2 would dispatch: an issue in the repository, selected by the `change` kind. */
const card = (number) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column: template.board.columns.ready,
});

/** A consumer's repository holding the template's config for that board, and its event stream's path. */
function consumer() {
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };
  const where = repositoryIn('rigger-verb-kill-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  return { where, stream: join(where, '.rigger', 'events.jsonl') };
}

/** Where a script can name `path` inside single quotes, which is everywhere a temporary directory is. */
function quoted(path) {
  if (path.includes("'")) throw new Error(`${path} holds a quote a script cannot carry`);
  return `'${path}'`;
}

/**
 * A `gh` stand-in in `directory` answering as the fake `gh` does for `board`, which leaves a child
 * alive on every call whose arguments match the shell pattern `on`, after running `then`. Each
 * child's pid is written to `child-<the stand-in's pid>.pid`.
 */
function fakeLeavingChild(directory, board, { on = '*', then = ':' } = {}) {
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), { repo: REPO, project: PROJECT, board });
  fixture(directory, 'gh', [
    '"$here/fake/gh" "$@"',
    'status=$?',
    `case "$*" in ${on})`,
    then,
    leave(TAIL, 'child-$$'),
    ';;',
    'esac',
    'exit $status',
  ].join('\n'));
  return fake;
}

/**
 * Settles once `child` has exited, killing it first where it has not: a process that has exited
 * spawns nothing more.
 */
function ended(child) {
  if (child.exitCode !== null || child.signalCode !== null) return undefined;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  return exited;
}

/** The environment the bin runs under: `directory` first on PATH, ahead of the refusing `gh`. */
const withFirst = (directory) => ({ ...gitEnvironment(), PATH: `${directory}${delimiter}${process.env.PATH}` });

/** Runs the real bin's `verb` from `where` with `directory` first on PATH, and what it printed. */
function runBin(verb, where, directory) {
  const ran = spawnSync(process.execPath, [bin, verb], { cwd: where, encoding: 'utf8', env: withFirst(directory) });
  assert.equal(ran.error, undefined);
  return { code: ran.status, out: ran.stdout, err: ran.stderr };
}

/** The column each card on the fake board holds now, by number. */
const columnsOf = async (fake) => Object.fromEntries((await (await fake.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** Asserts `text` names the kill of the child a stand-in in `directory` left, as unrecorded. */
function namesUnrecordedKill(text, directory) {
  assert.match(text, /went unrecorded/, text);
  assert.match(text, /survivor\.killed/, text);
  assert.ok(text.includes(`/usr/bin/tail -f ${directory}/hold`), text);
}

// proves R-RECORD-9
test('given a sink that refuses every append and a gh stand-in for the board read that leaves a child alive, rigger once exits non-zero naming the unrecorded kill, the child dead, no call after that read, and no card out of ready', async (t) => {
  const directory = holding(t);
  const fake = fakeLeavingChild(directory, { ...BOARD, items: [card(10)] });
  const { where, stream } = consumer();
  mkdirSync(stream, { recursive: true });

  const ran = runBin('once', where, directory);

  assert.notEqual(ran.code, 0, ran.out);
  namesUnrecordedKill(ran.err, directory);
  const children = childrenIn(directory);
  assert.equal(children.length, 1, 'the stand-in did not leave one child on the board read');
  for (const child of children) assert.equal(await gone(child), true, `child ${child} is alive`);
  assert.equal(fake.sent().length, 1, JSON.stringify(fake.sent()));
  assert.deepEqual(await columnsOf(fake), { 10: 'Ready' });
});

// proves R-RECORD-9
test('given a sink that refuses the L0 kill event of the claim\'s column move, whose gh stand-in leaves a child alive, rigger once exits non-zero naming the unrecorded kill, and sends nothing after that move', async (t) => {
  // The sink takes every event until the move: the stand-in makes the stream a directory once the
  // board has taken the move, and before L0 records its kill, so that kill is the first event it
  // refuses. The claim's release after it is refused too, and is not what this test is about.
  const directory = holding(t);
  const { where, stream } = consumer();
  const fake = fakeLeavingChild(directory, { ...BOARD, items: [card(10)] }, {
    on: '*updateProjectV2ItemFieldValue*',
    then: `rm -f ${quoted(stream)}; mkdir -p ${quoted(stream)}`,
  });

  const ran = runBin('once', where, directory);

  assert.notEqual(ran.code, 0, ran.out);
  namesUnrecordedKill(ran.err, directory);
  const sent = fake.sent();
  const moves = sent.filter((args) => args.join(' ').includes('updateProjectV2ItemFieldValue'));
  assert.equal(moves.length, 1, JSON.stringify(sent));
  assert.equal(sent.at(-1), moves[0], 'the stand-in received a call after the move');
  for (const child of childrenIn(directory)) assert.equal(await gone(child), true, `child ${child} is alive`);
});

// proves R-RECORD-9
test('given a sink that refuses every append and a gh stand-in that leaves a child alive on setup-board\'s first read, setup-board sends no write and exits non-zero naming the unrecorded kill', async (t) => {
  // A board lacking a declared column, so a setup-board that went on would write.
  const directory = holding(t);
  const fake = fakeLeavingChild(directory, { ...BOARD, columns: BOARD.columns.slice(1) });
  const { where, stream } = consumer();
  mkdirSync(stream, { recursive: true });

  const ran = runBin('setup-board', where, directory);

  assert.notEqual(ran.code, 0, ran.out);
  namesUnrecordedKill(ran.err, directory);
  assert.deepEqual((await fake.model()).writes(), []);
  assert.deepEqual(fake.sent().filter((args) => args.join(' ').includes('mutation')), []);
  for (const child of childrenIn(directory)) assert.equal(await gone(child), true, `child ${child} is alive`);
});

/**
 * A `gh` stand-in in `directory` that never answers: it leaves a child alive, writes its own pid to
 * `gh.pid`, marks `ready`, and waits on the child, which runs until killed.
 */
const hanging = (directory) => fixture(directory, 'gh', [leave(TAIL, 'child-$$'), 'echo $$ > "$here/gh.pid"', ': > "$here/ready"', 'wait'].join('\n'));

/**
 * A module a verb's Node process loads first, with `--import`, that sends that process `SIGTERM`
 * from inside L0's spawn of `gh`: once the stand-in in `directory` has marked `ready`, and before
 * the spawn hands the child back to L0. It changes `node:child_process` itself, and
 * `syncBuiltinESMExports` carries the change to L0's adapter, which imports `spawn` by name.
 *
 * So the signal lands where a loaded host can put it: the stand-in's group exists and holds its
 * child, and the verb has not run a step past the spawn.
 */
function terminatingInSpawn(directory) {
  const path = join(directory, 'terminate-in-spawn.mjs');
  writeFileSync(path, [
    "import childProcess from 'node:child_process';",
    "import { existsSync } from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    `const ready = ${JSON.stringify(join(directory, 'ready'))};`,
    'const { spawn } = childProcess;',
    'childProcess.spawn = (command, ...rest) => {',
    '  const child = spawn(command, ...rest);',
    "  if (command === 'gh') {",
    '    while (!existsSync(ready));',
    "    process.kill(process.pid, 'SIGTERM');",
    '  }',
    '  return child;',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  return path;
}

/**
 * Starts the real bin's `verb` against a `gh` stand-in in a fresh scratch directory that never
 * answers, and its output so far. Where `inSpawn`, the verb sends itself `SIGTERM` from inside L0's
 * spawn (`terminatingInSpawn`).
 *
 * Teardown hooks run in the order they are registered. The verb's end is registered before
 * `holding`'s sweep, so a verb the test left running is dead before the sweep looks for its
 * fixture's processes, and cannot spawn a stand-in after it.
 */
function startedAgainstHanging(t, verb, { inSpawn = false } = {}) {
  let child;
  t.after(() => child && ended(child));
  const directory = holding(t);
  hanging(directory);
  const { where } = consumer();
  const loaded = inSpawn ? ['--import', terminatingInSpawn(directory)] : [];
  child = spawn(process.execPath, [...loaded, bin, verb], { cwd: where, env: withFirst(directory), stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (chunk) => (said += chunk));
  child.stderr.on('data', (chunk) => (said += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { directory, where, child, exited, said: () => said };
}

/**
 * Runs the real bin's `verb` against a `gh` stand-in that never answers, has it receive `SIGTERM`
 * while the stand-in runs, and asserts that the stand-in's child is dead, that its `L0` kill event
 * is in the target's stream, and that the verb ended by `SIGTERM`. The test sends the signal once
 * the stand-in is ready, or, where `inSpawn`, the verb sends it itself from inside L0's spawn.
 */
async function endsTheChildOnSigterm(t, verb, { inSpawn = false } = {}) {
  const { directory, where, child: running, exited, said } = startedAgainstHanging(t, verb, { inSpawn });

  await Promise.race([until(() => existsSync(join(directory, 'ready')), t), exited]);
  assert.ok(existsSync(join(directory, 'ready')), `${verb} ended before its forge read began: ${said()}`);
  if (!inSpawn) running.kill('SIGTERM');
  const { code, signal } = await exited;

  assert.equal(signal, 'SIGTERM', `exited ${code}: ${said()}`);
  const [child] = childrenIn(directory);
  assert.equal(await gone(child), true, `child ${child} is alive`);
  const kills = readEvents(join(where, '.rigger')).filter((event) => event.layer === 'L0' && event.pid === child);
  assert.equal(kills.length, 1, said());
  assert.equal(kills[0].name, 'tail');
  assert.equal(kills[0].cmd, `/usr/bin/tail -f ${directory}/hold`);
}

test('given a test whose verb is still running when it ends, the teardown that test registered leaves no process naming its scratch directory alive, even where the verb spawns its gh stand-in the moment any teardown hook returns', async (t) => {
  // The test's teardown hooks are collected rather than run by the runner, then run in order. After
  // each one, this waits until the verb has exited or its stand-in is ready, so a verb a hook left
  // alive spawns its stand-in before the next hook runs, on every run.
  const hooks = [];
  const { directory, child, exited } = startedAgainstHanging({ after: (hook) => hooks.push(hook) }, 'doctor');
  t.after(() => ended(child));
  t.after(() => sweep(directory));
  let over = false;
  exited.then(() => (over = true));

  for (const hook of hooks) {
    await hook();
    await until(() => over || existsSync(join(directory, 'ready')), t);
  }

  assert.deepEqual(naming(directory), [], `the teardown left processes naming ${directory} alive`);
});

for (const verb of ['once', 'run', 'plan', 'setup-board', 'doctor']) {
  test(`given ${verb} receiving SIGTERM while a forge read's gh stand-in, which has started a child, is still running, the child is dead, its L0 kill event is in the target's stream, and ${verb} ends reporting SIGTERM`, { timeout: 30_000 }, (t) => endsTheChildOnSigterm(t, verb));

  test(`given ${verb} receiving SIGTERM inside L0's spawn of a forge read's gh stand-in, once the stand-in has started a child and before the spawn returns, the child is dead, its L0 kill event is in the target's stream, and ${verb} ends reporting SIGTERM`, { timeout: 30_000 }, (t) => endsTheChildOnSigterm(t, verb, { inSpawn: true }));
}
