// ABOUTME: Tests `rigger once` and `rigger run` through the real bin on a card held for a workspace not
// made the same way twice: one closer and one event, what they print, and what a later run says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closerLine } from '../src/cli/doctor.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { moduleOver } from './admission-world.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { seedRepository } from './fake-gh.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { gitUnansweredAdd, scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';

// A bound on each run of the real bin, so one that never settles fails its test rather than the suite.
const { 60_000: { timeout: SETTLES_WITHIN } } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/**
 * A consumer for the test `t`, in a scratch directory its teardown sweeps: a repository with a
 * local bare `origin`, under the consumer's config at N 3, a fake `gh` holding `items`, and a `git`
 * that gives no answer to the first two adds of card #10's workspace, so L1 makes it on neither of
 * its two attempts. `verb(name, env)` runs the real bin's verb there, `env` added to its environment.
 */
function consumer(t, items = [card(10, 'Ready')]) {
  const directory = scratch(t);
  const target = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(consumerConfig(3))};\n` }), join(directory, 'origin.git'));
  const gh = join(directory, 'gh');
  mkdirSync(gh);
  // The repository holds the board's issues, so the newest number and an opened issue's count them.
  seedRepository(installFakeGh(gh, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } }), {});
  const git = join(directory, 'git');
  mkdirSync(git);
  gitUnansweredAdd(git, 'rigger-10', 2);
  const agent = standInAgent();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, gh, git, process.env.PATH].join(delimiter) };
  const verb = (name, added = {}) => {
    const ran = spawnSync(process.execPath, [bin, name], { cwd: target, encoding: 'utf8', env: { ...env, ...added }, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, said: `exited ${ran.status}: ${ran.stdout}${ran.stderr}` };
  };
  const state = join(realpathSync.native(target), '.rigger');
  return { state, verb, events: () => readEvents(state), closers: () => moduleOver(state).read().closers ?? [] };
}

// proves R-FAIL-8
test('rigger run, on a card whose workspace is not made the same way on both attempts, links one hold closer, records one admission.close event, and ends the card held', (t) => {
  const here = consumer(t);

  const ran = here.verb('run');

  assert.equal(here.closers().length, 1, ran.said);
  assert.equal(here.closers()[0].kind, 'hold');
  assert.equal(here.events().filter((event) => event.event === 'admission.close').length, 1, ran.said);
  assert.match(ran.err, /rigger run: card #10 was held after 2 attempts/, ran.said);
});

// proves R-FAIL-8
test('rigger run\'s output on a hold names the card, that it was held, and admission closed by closerLine\'s text for the hold\'s closer, and exits 1', (t) => {
  const here = consumer(t);

  const ran = here.verb('run');

  assert.equal(ran.code, 1, ran.said);
  const lines = ran.err.split('\n');
  assert.ok(lines.some((line) => line.startsWith('rigger run: card #10 was held after 2 attempts')), ran.said);
  const [closer] = here.closers();
  assert.ok(lines.includes(`rigger run: ${closerLine(closer)}`), ran.said);
});

// proves R-FAIL-8
test('where a hold\'s close leaves its temporary file, the close stands, and rigger run names the file as pause words it and exits 1', (t) => {
  const here = consumer(t);
  const preload = join(root, 'test', 'hold-close-leftover.mjs');

  const ran = here.verb('run', { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ') });

  assert.equal(ran.code, 1, ran.said);
  assert.equal(here.closers().length, 1, ran.said);
  const [close] = here.events().filter((event) => event.event === 'admission.close');
  assert.match(close?.leftover ?? '', /\/admission\/\.tmp-[0-9a-f]+$/, ran.said);
  assert.ok(ran.err.split('\n').includes(`rigger run: the temporary file ${close.leftover} could not be removed, and the close stands`), ran.said);
});

// proves R-FAIL-8
test('rigger run in a later invocation after a hold claims nothing, prints closerLine\'s text for the hold\'s closer, and exits 0', (t) => {
  const here = consumer(t);
  const first = here.verb('run');
  const [closer] = here.closers();
  assert.equal(closer?.kind, 'hold', first.said);
  const before = here.events().length;

  const ran = here.verb('run');

  assert.equal(ran.code, 0, ran.said);
  assert.ok(ran.out.split('\n').includes(`rigger run: ${closerLine(closer)}`), ran.said);
  assert.deepEqual(here.events().slice(before).filter((event) => event.event === 'pull'), [], ran.said);
});

/** Asserts that `verb`'s hold closer's run, in a fresh consumer for `t`, equals the run of every event the invocation recorded. */
function oneRun(t, verb) {
  const here = consumer(t);

  const ran = here.verb(verb);

  const [closer] = here.closers();
  assert.equal(closer?.kind, 'hold', ran.said);
  const runs = new Set(here.events().map((event) => event.run));
  assert.deepEqual([...runs], [closer.run], ran.said);
}

// proves R-FAIL-8
test('rigger once\'s hold closer\'s run equals the run field of every event that invocation recorded', (t) => oneRun(t, 'once'));

// proves R-FAIL-8
test('rigger run\'s hold closer\'s run equals the run field of every event that invocation recorded', (t) => oneRun(t, 'run'));

// proves R-FAIL-8
test('where a hold\'s close rejects and its closer is not saved, rigger run exits non-zero naming the failure', (t) => {
  const here = consumer(t);
  mkdirSync(join(here.state, 'admission'), { recursive: true });
  chmodSync(join(here.state, 'admission'), 0o555);
  t.after(() => chmodSync(join(here.state, 'admission'), 0o755));

  const ran = here.verb('run');

  assert.notEqual(ran.code, 0, ran.said);
  assert.notEqual(ran.code, null, ran.said);
  assert.deepEqual(here.closers(), []);
  assert.ok(ran.err.split('\n').some((line) => /^rigger run: admission cannot write .*\/admission\/\.tmp-[0-9a-f]+: EACCES$/.test(line)), ran.said);
});

/** Each board item's column by issue number, as the fake `gh`'s board holds them once every write it took is replayed. */
async function columnsOf(forge) {
  const board = createFakeBoard(forge.model);
  for (const { operation, args } of forge.writes) await board.operations[operation](...args);
  return Object.fromEntries((await board.operations.readItems()).map(({ number, column }) => [number, column]));
}

/**
 * The fake `gh`'s board, its repository, its writes and the commands it was sent, as `here`'s run
 * left them: it is installed beside the consumer whose state directory `here` names.
 */
const forgeOf = (here) => JSON.parse(readFileSync(join(dirname(dirname(here.state)), 'gh', 'board.json'), 'utf8'));

// proves R-SCHED-7, R-SCHED-20, R-SCHED-22, R-SCHED-23
test('rigger run, on a hold with no status issue open, opens Rigger closed admission carrying rigger:status, attaches its number to the closer, places it in Owner, and leaves the held card in its column', async (t) => {
  const here = consumer(t);

  const ran = here.verb('run');

  assert.equal(ran.code, 1, ran.said);
  const [closer] = here.closers();
  const number = Number(closer?.issue);
  assert.match(closer?.name ?? '', /^hold-[0-9a-f]+-issue-[0-9]+\.json$/, `${ran.said}\n${JSON.stringify(here.events().filter(({ event }) => event === 'notice.failed'))}`);
  const forge = forgeOf(here);
  const opened = forge.repository.issues.find((issue) => issue.number === number);
  assert.deepEqual({ title: opened?.title, labels: opened?.labels }, { title: 'Rigger closed admission', labels: ['rigger:status'] }, ran.said);
  const opens = forge.sent.filter((args) => args[1] === `repos/${REPO}/issues` && args[3] === 'POST');
  assert.equal(opens.length, 1, ran.said);
  const items = forge.writes.filter(({ operation }) => operation === 'addIssue');
  assert.deepEqual(items.map(({ args }) => args[0]), [number], ran.said);
  // Card #10 is the held card, claimed from Ready into Coding; the notice is issue `number`.
  const columns = await columnsOf(forge);
  assert.deepEqual({ held: columns[10], notice: columns[number] }, { held: 'Coding', notice: 'Owner' }, `${ran.said}\n${JSON.stringify(forge.writes)}`);
  assert.equal(here.closers().length, 1, ran.said);
});

/** Has the fake `gh` beside `here`'s consumer refuse every column move from now on, as a board refusing writes does. */
function refuseMoves(here) {
  const path = join(dirname(dirname(here.state)), 'gh', 'board.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...state, model: { ...state.model, refuseMoves: true } }));
}

// proves R-SCHED-20
test('rigger run under a closed admission whose hold closer names no issue runs the notice; where its step fails, it names the failed notice, keeps the closer\'s line, and exits 1', (t) => {
  const here = consumer(t);
  mkdirSync(join(here.state, 'admission'), { recursive: true });
  writeFileSync(join(here.state, 'admission', 'hold-a1.json'), JSON.stringify({ reason: 'card #4 was held', time: 5, run: 'r-earlier' }));
  refuseMoves(here);

  const ran = here.verb('run');

  assert.equal(ran.code, 1, ran.said);
  const [closer] = here.closers();
  assert.match(closer?.name ?? '', /^hold-a1-issue-[0-9]+\.json$/, ran.said);
  const lines = `${ran.out}${ran.err}`.split('\n');
  assert.ok(lines.includes(`rigger run: ${closerLine(closer)}`), ran.said);
  assert.ok(lines.some((line) => /^rigger run: the notice for hold a1 failed to move issue #[0-9]+ to Owner: /.test(line)), ran.said);
  const [failed] = here.events().filter(({ event }) => event === 'notice.failed');
  assert.deepEqual({ layer: failed?.layer, hold: failed?.hold, step: failed?.step }, { layer: 'L2', hold: 'a1', step: `move issue #${closer.issue} to Owner` }, ran.said);
});

// proves R-SCHED-20, R-SCHED-22
test('where the hold\'s own notice fails at a step, rigger run names the failed notice after the closer\'s line, and the held card stays in its column', (t) => {
  const here = consumer(t, [card(10, 'Coding')]);
  refuseMoves(here);

  const ran = here.verb('run');

  assert.equal(ran.code, 1, ran.said);
  const [closer] = here.closers();
  const lines = ran.err.split('\n');
  const at = lines.indexOf(`rigger run: ${closerLine(closer)}`);
  assert.ok(at >= 0, ran.said);
  assert.match(lines[at + 1] ?? '', new RegExp(`^rigger run: the notice for hold ${closer.id} failed to move issue #${closer.issue} to Owner: `), ran.said);
  const items = forgeOf(here).writes.filter(({ operation }) => operation === 'moveItem');
  assert.deepEqual(items, [], ran.said);
});
