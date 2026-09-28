// ABOUTME: Tests the verbs that build a forge side as the real bin runs them, with a `gh` stand-in
// that leaves a child alive or never exits: each kill ends and is recorded, a kill the sink refuses
// stops the verb before its next forge call, and SIGTERM mid-read ends the verb by that signal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryIn } from './git-repository.mjs';
import { childrenIn, fixture, gone, holding, leave, TAIL, until } from './process-fixtures.mjs';

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

for (const verb of ['once', 'run', 'plan', 'setup-board', 'doctor']) {
  test(`given ${verb} receiving SIGTERM while a forge read's gh stand-in, which has started a child, is still running, the child is dead, its L0 kill event is in the target's stream, and ${verb} ends reporting SIGTERM`, { timeout: 30_000 }, async (t) => {
    const directory = holding(t);
    hanging(directory);
    const { where } = consumer();
    const running = spawn(process.execPath, [bin, verb], { cwd: where, env: withFirst(directory), stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => running.kill('SIGKILL'));
    let said = '';
    running.stdout.on('data', (chunk) => (said += chunk));
    running.stderr.on('data', (chunk) => (said += chunk));
    const ended = new Promise((resolve) => running.on('exit', (code, signal) => resolve({ code, signal })));

    await Promise.race([until(() => existsSync(join(directory, 'ready'))), ended]);
    assert.ok(existsSync(join(directory, 'ready')), `${verb} ended before its forge read began: ${said}`);
    running.kill('SIGTERM');
    const { code, signal } = await ended;

    assert.equal(signal, 'SIGTERM', `exited ${code}: ${said}`);
    const [child] = childrenIn(directory);
    assert.equal(await gone(child), true, `child ${child} is alive`);
    const kills = readEvents(join(where, '.rigger')).filter((event) => event.layer === 'L0' && event.pid === child);
    assert.equal(kills.length, 1, said);
    assert.equal(kills[0].name, 'tail');
    assert.equal(kills[0].cmd, `/usr/bin/tail -f ${directory}/hold`);
  });
}
