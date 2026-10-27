// ABOUTME: Tests `rigger once` and `rigger run` through the real bin on a card held for a workspace not
// made the same way twice: one closer and one event, what they print, and what a later run says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closerLine } from '../src/cli/doctor.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { moduleOver } from './admission-world.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { gitUnansweredAdd, scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';
import { judgeVerbWorld } from './judge-start-verb.mjs';

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
  installFakeGh(gh, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } });
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

// The counterexample succeeds, omits either report, dispatches a third judge, or uses maker wording.
// proves R-FAIL-8
test('rigger run holds a judge pair nonzero with its card role and both reports and makes no third dispatch', (t) => {
  const ran = judgeVerbWorld(t);
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, `${said}\n${JSON.stringify(ran.events.filter(({ layer }) => layer !== 'L0'))}`);
  assert.match(said, /card #10.*judge.*reviewer.*held/);
  assert.match(said, /first:.*R10/);
  assert.match(said, /second:.*R10/);
  assert.doesNotMatch(said, /each failing before the maker/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 2, said);
  const held = ran.events.find(({ event, decision }) => event === 'attempt.decided' && decision === 'hold');
  assert.deepEqual(held.failures.map(({ judge, row }) => [judge, row]), [['reviewer', 'R10'], ['reviewer', 'R10']]);
  assert.equal(ran.events.filter(({ event }) => event === 'admission.close').length, 1);
});

// Refusing this event must retain the baseline report, never spend a host retry or close admission.
// proves R-FAIL-8
test('rigger run R38 dispatch keeps the established report without retry or hold', (t) => {
  const ran = judgeVerbWorld(t, 'dispatch');
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  assert.match(said, /card #10.*judge.*reviewer.*handed back no outcome/);
  assert.match(said, /dispatch/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 0, said);
  assert.deepEqual(ran.events.filter(({ event }) => event === 'attempt.decided' || event === 'admission.close'), []);
  assert.doesNotMatch(said, /R19|was held|first:/);
});

// Refusing this event must retain the baseline report, never spend a host retry or close admission.
// proves R-FAIL-8
test('rigger run R38 scratch keeps the established report without retry or hold', (t) => {
  const ran = judgeVerbWorld(t, 'scratch');
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  assert.match(said, /card #10.*judge.*reviewer.*was dispatched, and its dispatch failed/);
  assert.match(said, /workspace.made/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 1, said);
  assert.deepEqual(ran.events.filter(({ event }) => event === 'attempt.decided' || event === 'admission.close'), []);
  assert.doesNotMatch(said, /R19|was held|first:/);
});

// Refusing this event must retain the baseline report, never spend a host retry or close admission.
// proves R-FAIL-8
test('rigger run R38 start keeps the established report without retry or hold', (t) => {
  const ran = judgeVerbWorld(t, 'start');
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  assert.match(said, /card #10.*judge.*reviewer.*was dispatched, and its dispatch failed/);
  assert.match(said, /dispatch.start/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 1, said);
  assert.deepEqual(ran.events.filter(({ event }) => event === 'attempt.decided' || event === 'admission.close'), []);
  assert.doesNotMatch(said, /R19|was held|first:/);
});

// Refusing this event must retain the baseline report, never spend a host retry or close admission.
// proves R-FAIL-8
test('rigger run R38 survivor keeps the established report without retry or hold', (t) => {
  const ran = judgeVerbWorld(t, 'survivor');
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  assert.match(said, /card #10.*judge.*reviewer.*did not start: the role/);
  assert.match(said, /survivor.killed/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 1, said);
  assert.deepEqual(ran.events.filter(({ event }) => event === 'attempt.decided' || event === 'admission.close'), []);
  assert.doesNotMatch(said, /R19|was held|first:/);
});

// Refusing this event must retain the baseline report, never spend a host retry or close admission.
// proves R-FAIL-8
test('rigger run R38 timeout keeps the established report without retry or hold', (t) => {
  const ran = judgeVerbWorld(t, 'timeout');
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  assert.match(said, /card #10.*judge.*reviewer.*did not start: the role/);
  assert.match(said, /timeout.killed/);
  assert.equal(ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').length, 1, said);
  assert.deepEqual(ran.events.filter(({ event }) => event === 'attempt.decided' || event === 'admission.close'), []);
  assert.doesNotMatch(said, /R19|was held|first:/);
});
