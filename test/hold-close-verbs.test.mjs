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
import { closerText, seed as seedCloser } from './admission-world.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { seedRepository } from './fake-gh.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { gitUnansweredAdd, scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';
import { judgeVerbWorld } from './judge-start-verb.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';

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

// The counterexample drops either attempt's dispatch id, or the judge's name, from the opened body.
// proves R-SCHED-20
test('rigger run, on a judge pair held after two compound-rule failures, opens one status issue whose body names each dispatch id L3 recorded for the judge and the judge as judge `reviewer`', (t) => {
  const ran = judgeVerbWorld(t);
  const said = `${ran.out}${ran.err}`;
  assert.equal(ran.code, 1, said);
  const ids = ran.events.filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer').map(({ dispatch }) => dispatch);
  assert.equal(ids.length, 2, said);
  const forge = JSON.parse(readFileSync(join(dirname(dirname(ran.state)), 'gh', 'board.json'), 'utf8'));
  const notices = (forge.repository?.issues ?? []).filter(({ labels }) => labels.includes('rigger:status'));
  assert.equal(notices.length, 1, JSON.stringify(ran.events.filter(({ event }) => event === 'notice.failed')));
  for (const id of ids) assert.ok(notices[0].body.includes(id), `the body omits the recorded judge dispatch ${id}; recorded: ${ids.join(', ')}:\n${notices[0].body}`);
  assert.ok(notices[0].body.includes('Attempt 1: environment, judge `reviewer`') && notices[0].body.includes('Attempt 2: environment, judge `reviewer`'), notices[0].body);
});

/**
 * A consumer for the test `t` whose admission holds `closers`, each a closer's file name, beside a
 * fake `gh` whose board holds no card and whose repository holds `issues`. `verb(name)` runs the
 * real bin's verb there; `gh(...args)` runs the fake `gh` as a person on the forge would; and
 * `reads` are the repository reads, through the fake `gh`, of what it then holds. Where
 * `refuseState` is given, the `gh` the verb finds refuses every read of one issue's state, saying
 * what gh says of a server error, or the `printf` format `refuseState` names, and answers every
 * other request as the fake does.
 */
function statusConsumer(t, { closers, issues, refuseState = false }) {
  const directory = scratch(t);
  const target = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(consumerConfig(3))};\n` }), join(directory, 'origin.git'));
  const dir = join(directory, 'gh');
  mkdirSync(dir);
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [] } });
  seedRepository(fake, { issues });
  const ahead = join(directory, 'refusing');
  if (refuseState) {
    mkdirSync(ahead);
    const said = refuseState === true ? "'%s\\n' 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)'" : `'${refuseState}\\n'`;
    writeFileSync(join(ahead, 'gh'), `#!/bin/sh\ncase "$*" in *'{ state repository { nameWithOwner } }'*) printf ${said} >&2; exit 1;; esac\nexec ${JSON.stringify(fake.gh)} "$@"\n`);
    chmodSync(join(ahead, 'gh'), 0o755);
  }
  const state = join(realpathSync.native(target), '.rigger');
  for (const name of closers) seedCloser(state, name, closerText({ reason: `reason of ${name}` }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [...(refuseState ? [ahead] : []), dir, process.env.PATH].join(delimiter) };
  const verb = (name) => {
    const ran = spawnSync(process.execPath, [bin, name], { cwd: target, encoding: 'utf8', env, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, said: `exited ${ran.status}: ${ran.stdout}${ran.stderr}` };
  };
  const gh = (...args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  const reads = repositoryReads({ repo: REPO, project: PROJECT }, { send: (command, args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() }) });
  return { state, target, fake, verb, gh, reads, events: () => readEvents(state), closers: () => moduleOver(state).read().closers ?? [] };
}

/** A status issue the fake holds: carrying the label, its body naming hold `id`, as Rigger opens one. */
const statusIssue = (number, id) => ({ number, title: 'Rigger closed admission', body: `Why.\n\nHold: \`${id}\`\n`, labels: ['rigger:status'] });

// proves R-SCHED-4, R-SCHED-23
test('rigger run, once the status issue a hold\'s closer names is closed by a person, removes that closer, records the issue\'s close as what reopened admission, and claims again', (t) => {
  const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')] });
  const closed = here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed');
  assert.equal(closed.status, 0, closed.stderr);

  const ran = here.verb('run');

  assert.equal(ran.code, 0, ran.said);
  assert.deepEqual(here.closers(), [], ran.said);
  const opened = here.events().filter(({ event }) => event === 'admission.open');
  assert.deepEqual(opened.map(({ layer, name, by, issue }) => ({ layer, name, by, issue })), [{ layer: 'L3', name: 'hold-a1-issue-7.json', by: 'issue', issue: 7 }], ran.said);
  // Admission opened, so the same trigger read the board and found nothing to pull.
  assert.match(ran.out, /no card was pullable/, ran.said);
});

// proves R-SCHED-24
test('rigger resume over hold closers naming issues, beside another open issue carrying the label, removes every closer, then removes the label from each issue before closing it, and exits 0', async (t) => {
  const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json', 'owner-o4.json'], issues: [statusIssue(7, 'a1'), { number: 9, title: 'Copied', body: '', labels: ['rigger:status', 'type:change'] }] });

  const ran = here.verb('resume');

  assert.equal(ran.code, 0, ran.said);
  assert.deepEqual(here.closers(), [], ran.said);
  for (const number of [7, 9]) {
    const issue = await here.reads.readIssue(number);
    assert.equal(issue.state, 'closed', `#${number}: ${ran.said}`);
    assert.ok(!issue.labels.includes('rigger:status'), `#${number}`);
    assert.match(ran.out, new RegExp(`^rigger resume: closed the status issue #${number}$`, 'm'), ran.said);
    const changes = (await here.reads.readIssueTimeline(number)).filter(({ kind, label }) => kind === 'closed' || label === 'rigger:status');
    assert.deepEqual(changes.map(({ kind }) => kind), ['labeled', 'unlabeled', 'closed'], `#${number}`);
  }
});

// proves R-SCHED-23
test('rigger once and rigger run, where the state of the issue a hold\'s closer names cannot be read, claim nothing, name the issue in their output and the event, and exit non-zero', (t) => {
  for (const name of ['once', 'run']) {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')], refuseState: true });

    const ran = here.verb(name);

    assert.equal(ran.code, 1, `${name}: ${ran.said}`);
    assert.match(ran.err, new RegExp(`^rigger ${name}: the notice for hold a1 failed to read issue #7's state: .*HTTP 502`, 'm'), `${name}: ${ran.said}`);
    assert.deepEqual(here.closers().map(({ name: closer }) => closer), ['hold-a1-issue-7.json'], name);
    const failed = here.events().filter(({ event }) => event === 'notice.failed');
    assert.deepEqual(failed.map(({ layer, hold, issue }) => ({ layer, hold, issue })), [{ layer: 'L3', hold: 'a1', issue: 7 }], name);
    assert.deepEqual(here.events().filter(({ event }) => event === 'pull'), [], name);
  }
});

/**
 * Config failures after `resume` removes its closers: import failures, a BigInt or enumerable
 * accessor the entry point refuses, and plain data the validator refuses.
 */
const FAILING_CONFIGS = {
  'its evaluation throws': [`throw new Error('the config threw as it was evaluated');\n`, /could not be read: .*the config threw as it was evaluated/],
  'it does not parse': ['export default {;\n', /could not be read: /],
  // A BigInt default is refused at the config entry point.
  'it is a BigInt': ['export default 1n;\n', /holds a bigint at `default`/],
  'it holds a repo getter': ["export default Object.defineProperty({}, 'repo', { enumerable: true, get() { throw new Error('the repo getter threw'); } });\n", /holds an accessor at `default\.repo`/],
  'it does not validate': ['export default { repo: 7 };\n', /`rigger\.config\.mjs`: /],
  'it holds a board getter': [[
    `import settings from ${JSON.stringify(new URL('../templates/rigger.config.mjs', import.meta.url).href)};`,
    `const config = { ...settings, repo: ${JSON.stringify(REPO)}, board: undefined };`,
    `const board = { ...settings.board, project: ${PROJECT} };`,
    "Object.defineProperty(config, 'board', { enumerable: true, get() { if (new Error().stack.includes('/src/workflow/transitions.mjs')) throw new Error('the board could not be handed to L2'); return board; } });",
    'export default config;',
  ].join('\n'), /holds an accessor at `default\.board`/],
  ...unprintable(),
};

/**
 * Configs holding repo and board getters whose bodies would throw values no template can print.
 * The entry point refuses each accessor by its path, without running its body. A Symbol thrown
 * during module evaluation remains the import-failure control.
 */
function unprintable() {
  const trap = "new Proxy({}, Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'defineProperty', 'deleteProperty', 'apply', 'construct', 'isExtensible', 'preventExtensions', 'setPrototypeOf'].map((name) => [name, () => { throw new Error('the proxy refused ' + name); }])))";
  const values = {
    'a Symbol': "Symbol('it threw a Symbol')",
    null: 'null',
    undefined: 'undefined',
    'a null-prototype object': 'Object.create(null)',
    'an Error whose message getter throws': "Object.create(Error.prototype, { message: { get() { throw new Error('no message'); } } })",
    'an object whose conversions throw': "({ toString() { throw new Error('no string'); }, [Symbol.toPrimitive]() { throw new Error('no primitive'); } })",
    'a Proxy throwing on every trap': trap,
  };
  const settings = `import settings from ${JSON.stringify(new URL('../templates/rigger.config.mjs', import.meta.url).href)};`;
  const rows = {};
  for (const [what, value] of Object.entries(values)) {
    rows[`a repo getter holding ${what}`] = [`export default Object.defineProperty({}, 'repo', { enumerable: true, get() { throw ${value}; } });\n`, /holds an accessor at `default\.repo`/];
    rows[`a board getter holding ${what}`] = [[
      settings,
      `const config = { ...settings, repo: ${JSON.stringify(REPO)}, board: undefined };`,
      `const board = { ...settings.board, project: ${PROJECT} };`,
      `Object.defineProperty(config, 'board', { enumerable: true, get() { if (new Error().stack.includes('/src/workflow/transitions.mjs')) throw ${value}; return board; } });`,
      'export default config;',
    ].join('\n'), /holds an accessor at `default\.board`/];
  }
  rows['its evaluation throws a Symbol'] = ["throw Symbol('evaluation failed');\n", /could not be read: /];
  return rows;
}

// proves R-SCHED-23
test('rigger resume, wherever the config fails after the closers are removed and before L2 is reached, exits non-zero naming each closer removed, that no status issue was closed, and why, and makes no forge write', async (t) => {
  for (const [what, [text, why]] of Object.entries(FAILING_CONFIGS)) {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json', 'owner-o4.json'], issues: [statusIssue(7, 'a1')] });
    writeFileSync(join(here.target, 'rigger.config.mjs'), text);

    const ran = here.verb('resume');

    assert.equal(ran.code, 1, `${what}: ${ran.said}`);
    assert.deepEqual(here.closers(), [], `${what}: both closers were removed`);
    assert.match(ran.err, /^rigger resume: removed the hold closer .*hold-a1-issue-7\.json/m, `${what}: ${ran.said}`);
    assert.match(ran.err, /^rigger resume: removed the owner closer .*owner-o4\.json/m, `${what}: ${ran.said}`);
    assert.match(ran.err, new RegExp(`^rigger resume: no status issue was closed, because .*${why.source}`, 'm'), `${what}: ${ran.said}`);
    assert.doesNotMatch(ran.said, /\n\s+at /, `${what}: a stack trace reached the output`);
    const issue = await here.reads.readIssue(7);
    assert.deepEqual([issue.state, issue.labels], ['open', ['rigger:status']], what);
    assert.deepEqual(here.fake.sent().filter((args) => ['DELETE', 'PATCH', 'POST'].includes(args[3])), [], `${what}: a forge write was made`);
  }
});

// proves R-SCHED-23
test('rigger once, after a made closer opening whose admission.open record was refused, reports a plain board Error and exits non-zero', async (t) => {
  // The architect's round-7 B2 probe on #1079, through the real `once` in process, for each Error
  // whose message no template can print, and a plain one as the control.
  const errors = {
    'a plain Error': () => new Error('the board read failed plainly'),
  };
  for (const [what, hostile] of Object.entries(errors)) {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')] });
    assert.equal(here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
    const stream = join(here.state, 'events.jsonl');
    let refusing = false;
    const send = (command, args) => {
      const query = args[3] ?? '';
      if (query.includes('fields(')) throw hostile();
      const said = spawnSync(here.fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
      if (query.includes('{ state repository { nameWithOwner } }')) {
        // The sink refuses every append from here: the opening's record among them.
        writeFileSync(stream, '', { flag: 'a' });
        chmodSync(stream, 0o444);
        refusing = true;
      }
      return { status: said.status, stdout: said.stdout, stderr: said.stderr, timedOut: false };
    };
    t.after(() => { if (refusing) chmodSync(stream, 0o644); });

    const answered = await onceVerb({ target: here.target, send }).then((answer) => ({ answer }), (thrown) => ({ thrown }));

    assert.equal(answered.thrown, undefined, `${what}: once threw while reporting`);
    assert.deepEqual(here.closers(), [], `${what}: the closer was removed`);
    assert.equal(answered.answer.code, 1, `${what}: ${answered.answer.text}`);
    assert.match(answered.answer.text, /admission changed at hold-a1-issue-7\.json, and the sink refused its admission\.open event/, `${what}: ${answered.answer.text}`);
  }
});

// The judges' round-8 probes on #1079: what `once` is handed after a made opening is read all the
// way through, its nested entries and its containers' methods among it, without running a thrower's code.

// proves R-SCHED-10
test('rigger once refuses a config board accessor before closer work, whose body holds an AggregateError with a changing errors entry', async (t) => {
  const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')] });
  assert.equal(here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
  writeFileSync(join(here.target, 'rigger.config.mjs'), [
    `const config = ${JSON.stringify(consumerConfig(3))};`,
    'const board = config.board;',
    "Object.defineProperty(config, 'board', { get() {",
    "  if (new Error().stack.includes('/src/workflow/facts.mjs')) {",
    '    let reads = 0;',
    "    const errors = Object.defineProperty([], '0', { enumerable: true, configurable: true, get() { reads += 1; return reads === 1 ? new Error('HTTP 502') : undefined; } });",
    "    const failure = new AggregateError([], 'facts could not be read'); failure.errors = errors; throw failure;",
    '  }',
    '  return board;',
    '} });',
    'export default config;',
  ].join('\n'));
  const send = (command, args) => {
    const done = spawnSync(here.fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
    return { status: done.status, stdout: done.stdout, stderr: done.stderr, timedOut: false };
  };

  const outcome = await onceVerb({ target: here.target, send }).then((answer) => ({ answer }), (thrown) => ({ thrown }));

  assert.deepEqual(here.closers().map(({ name }) => name), ['hold-a1-issue-7.json'], 'the hold closer remains');
  assert.throws(here.events, { code: 'ENOENT' }, 'no admission.open event or other event was written');
  assert.equal(outcome.thrown, undefined, 'once must return its failure report without itself throwing');
  assert.equal(outcome.answer.code, 1);
  assert.match(outcome.answer.text, /holds an accessor at `default\.board`/);
});

// proves R-SCHED-23
test('rigger once, over an admission directory of 101 malformed entries, names every one of them and exits non-zero', async (t) => {
  // The reviewer's round-9 probe on #1079, through the real `once`.
  const here = statusConsumer(t, { closers: [], issues: [] });
  const names = Array.from({ length: 101 }, (_, at) => `bad-${String(at).padStart(3, '0')}.json`);
  for (const name of names) seedCloser(here.state, name, 'not json');
  const send = (command, args) => {
    const done = spawnSync(here.fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
    return { status: done.status, stdout: done.stdout, stderr: done.stderr, timedOut: false };
  };

  const answered = await onceVerb({ target: here.target, send });

  assert.equal(answered.code, 1, answered.text);
  for (const name of names) assert.ok(answered.text.includes(name), `${name} is not named`);
});

// Config refusal at default.board precedes closer work for each shared Error body.
for (const [what, thrown] of [
  ['the cause and the sole errors entry', 'new AggregateError([leaf], \'facts could not be read\', { cause: leaf })'],
  ['a sibling and a sibling\'s cause', 'new AggregateError([new Error(\'wrapper\', { cause: leaf }), leaf], \'facts could not be read\')'],
]) {
  test(`rigger once refuses a config board accessor before closer work, whose body holds one changing Error as ${what}`, async (t) => {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')] });
    assert.equal(here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
    writeFileSync(join(here.target, 'rigger.config.mjs'), [
      `const config = ${JSON.stringify(consumerConfig(3))};`,
      'const board = config.board;',
      "Object.defineProperty(config, 'board', { get() {",
      "  if (new Error().stack.includes('/src/workflow/facts.mjs')) {",
      '    let reads = 0;',
      "    const leaf = Object.defineProperty(new Error('initial'), 'message', { configurable: true, get() { return ++reads === 1 ? 'HTTP 502' : 'original failure lost on reread'; } });",
      `    throw ${thrown};`,
      '  }',
      '  return board;',
      '} });',
      'export default config;',
    ].join('\n'));
    const send = (command, args) => {
      const done = spawnSync(here.fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
      return { status: done.status, stdout: done.stdout, stderr: done.stderr, timedOut: false };
    };

    const outcome = await onceVerb({ target: here.target, send }).then((answer) => ({ answer }), (thrown) => ({ thrown }));

    assert.deepEqual(here.closers().map(({ name }) => name), ['hold-a1-issue-7.json'], 'the hold closer remains');
    assert.throws(here.events, { code: 'ENOENT' }, 'no admission.open event or other event was written');
    assert.equal(outcome.thrown, undefined, 'once must return its failure report without itself throwing');
    assert.equal(outcome.answer.code, 1);
    assert.match(outcome.answer.text, /holds an accessor at `default\.board`/);
    assert.doesNotMatch(outcome.answer.text, /lost on reread/);
  });
}

// proves R-SCHED-23
test('rigger run over a status issue whose close lies past the first page of its timeline, after 100 comments, removes the closer, and the fake serves every entry', async (t) => {
  // The architect's round-10 probe on #1079: the fake forge serves every page it says it has.
  const issue = { ...statusIssue(7, 'a1'), comments: Array.from({ length: 100 }, (_, at) => ({ body: `Earlier notice ${at}`, createdAt: '2026-10-01T00:00:00Z' })) };
  const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [issue] });
  assert.equal(here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
  const timeline = await here.reads.readIssueTimeline(7);
  assert.equal(timeline.filter(({ kind }) => kind === 'comment').length, 100);
  assert.equal(timeline.at(-1).kind, 'closed');

  const ran = here.verb('run');

  assert.equal(ran.code, 0, ran.said);
  assert.deepEqual(here.closers(), [], ran.said);
});

// Each verb refuses the config at default.board before closer work, for each conversion body.
for (const [verb, what, thrown] of [
  ['once', 'the aggregate\'s message and its errors entry', "Object.defineProperty(new AggregateError([leaf], 'outer'), 'message', { value: leaf })"],
  ['run', 'the aggregate\'s message and its errors entry', "Object.defineProperty(new AggregateError([leaf], 'outer'), 'message', { value: leaf })"],
  ['once', 'the length of two lists', "(() => { const list = () => new Proxy([], { get(target, key) { return key === 'length' ? leaf : Reflect.get(target, key); } }); const failure = new AggregateError([], 'facts failed'); failure.unreadable = list(); failure.errors = list(); return failure; })()"],
]) {
  test(`rigger ${verb} refuses a config board accessor before closer work, whose body reaches one changing Error as ${what}`, async (t) => {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')] });
    assert.equal(here.gh('api', `repos/${REPO}/issues/7`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
    writeFileSync(join(here.target, 'rigger.config.mjs'), [
      `const config = ${JSON.stringify(consumerConfig(3))};`,
      'const board = config.board;',
      'let thrown;',
      "Object.defineProperty(config, 'board', { get() {",
      "  if (new Error().stack.includes('/src/workflow/facts.mjs')) {",
      '    let reads = 0;',
      "    const leaf = Object.defineProperty(new Error('initial'), 'message', { get() { return ++reads === 1 ? 'HTTP 502 first reason' : 'original failure lost on reread'; } });",
      `    throw ${thrown};`,
      '  }',
      '  return board;',
      '} });',
      'export default config;',
    ].join('\n'));

    const said = verb === 'once'
      ? await onceVerb({ target: here.target, send: (command, args) => {
        const done = spawnSync(here.fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
        return { status: done.status, stdout: done.stdout, stderr: done.stderr, timedOut: false };
      } }).then(({ code, text }) => ({ code, said: text }))
      : here.verb('run');

    assert.deepEqual(here.closers().map(({ name }) => name), ['hold-a1-issue-7.json'], 'the hold closer remains');
    assert.throws(here.events, { code: 'ENOENT' }, 'no admission.open event or other event was written');
    assert.notEqual(said.code, 0);
    assert.match(said.said, /holds an accessor at `default\.board`/);
    assert.doesNotMatch(said.said, /lost on reread/);
  });
}

// proves R-SCHED-23
test('rigger once and rigger run print a state read refused with terminal controls in what gh said with each control written as its escape', (t) => {
  // Round 12 on #1079 (U109 rule 4): the verb that prints outside text makes it printable.
  for (const name of ['once', 'run']) {
    const here = statusConsumer(t, { closers: ['hold-a1-issue-7.json'], issues: [statusIssue(7, 'a1')], refuseState: 'gh: HTTP 502\\033[31m forged terminal text\\302\\2332J' });

    const ran = here.verb(name);

    assert.equal(ran.code, 1, `${name}: ${ran.said}`);
    assert.match(ran.err, new RegExp(`^rigger ${name}: the notice for hold a1 failed to read issue #7's state: .*HTTP 502`, 'm'), `${name}: ${ran.said}`);
    assert.doesNotMatch(ran.err.replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f]/, `${name}: ${ran.said}`);
    assert.ok(ran.err.includes('\\u001b[31m forged terminal text\\u009b2J'), `${name}: ${ran.said}`);
  }
});

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { loop as relayLoop } from '../src/scheduling/loop.mjs';
import { openSink as relayOpenSink } from '../src/observation/sink.mjs';
import { readSide as relayReadSide } from '../src/substrate/forge/read.mjs';
import { itemWriteSide as relayItemWrites } from '../src/substrate/forge/item-write.mjs';
import { repositoryWriteSide as relayRepositoryWrites } from '../src/substrate/forge/repository-write.mjs';
import { columnChanges as relayChanges } from '../src/workflow/transitions.mjs';
import { factsCall as relayFacts } from '../src/workflow/facts.mjs';
import { nextAction as relayDecision } from '../src/workflow/next-action.mjs';
import { noticeLine as relayNoticeLine } from '../src/cli/once.mjs';
import { withObservedAdmission } from './loop-admission-observer.mjs';

/** Real default forge writers and native fake gh; capture wrappers preserve all producer values. */
function relayNativeWorld(t, { issues = [], failRead } = {}) {
  const directory = temporaryDirectory('rigger-relay-native-');
  const dir = join(directory, 'gh');
  mkdirSync(dir);
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [] } });
  seedRepository(fake, { issues });
  const beforePath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${beforePath}`;
  t.after(() => { process.env.PATH = beforePath; });
  const state = join(directory, 'state');
  const settings = consumerConfig(2);
  const sink = relayOpenSink({ directory: state, run: 'r-relay-native', now: () => 1 });
  let active;
  const failures = [];
  const send = (_command, args) => {
    if (failRead !== undefined && active === failRead) return { status: 1, stdout: '', stderr: `gh: HTTP 502 raw ${active} refusal`, timedOut: false };
    const result = spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, timedOut: false };
  };
  const watched = (name, operation) => async (...args) => {
    active = name;
    try { return await operation(...args); }
    catch (reason) { failures.push({ name, reason }); throw reason; }
    finally { active = undefined; }
  };
  const given = { ...settings.board, repo: settings.repo };
  const board = Object.fromEntries(Object.entries(relayReadSide(given, { send })).map(([name, operation]) => [name, watched(name, operation)]));
  const emitter = sink.emitter({ layer: 'L0' });
  const reads = repositoryReads(given, { emitter });
  const changes = relayChanges({ config: settings, sink, reads, board, items: relayItemWrites(given), repositoryWrites: relayRepositoryWrites({ repo: settings.repo }, { emitter }) });
  const noticed = [];
  const l2 = { ...changes, notice: (input) => {
    const actual = changes.notice(input);
    const call = { input, handed: [] };
    noticed.push(call);
    return {
      async next(outcome) { if (outcome !== undefined) call.handed.push(outcome); const step = await actual.next(outcome); if (step.done) call.answer = step.value; return step; },
      return: (...args) => actual.return(...args),
      [Symbol.asyncIterator]() { return this; },
    };
  } };
  const decide = (card, outcomes, options = {}) => relayDecision(card, settings.kinds, undefined, { columns: settings.board.columns, roles: settings.roles, provisioning: settings.provisioning, outcomes, sink, ...options });
  const options = { config: settings, board, l2, decide, facts: relayFacts({ config: settings, reads, decide }), sink, state, run: 'r-relay-native', environment: {},
    kill: async () => {}, workspace: async () => { throw new Error('the closed fixture makes no maker workspace'); }, judgeDirectory: async () => { throw new Error('the closed fixture makes no judge directory'); }, removeDirectories: async () => {}, clock: { now: () => 1, pause: async () => {} } };
  const originalAppend = fs.appendFileSync;
  let refuses = () => false;
  const refused = [];
  fs.appendFileSync = (path, bytes, ...rest) => {
    let record;
    try { record = JSON.parse(String(bytes)); } catch {}
    if (record && String(path).startsWith(state) && refuses(record)) {
      const error = Object.assign(new Error(`EIO while recording ${record.event}`), { code: 'EIO' });
      refused.push({ record, error });
      throw error;
    }
    return originalAppend(path, bytes, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => { fs.appendFileSync = originalAppend; syncBuiltinESMExports(); });
  return { state, dir, fake, noticed, failures, refused, options,
    build: (make = relayLoop) => make(options),
    seed: (name) => seedCloser(state, name),
    names: () => moduleOver(state).read().closers?.map(({ name }) => name).sort() ?? [],
    refuse: (predicate) => { refuses = predicate; },
    model: () => JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8')),
    gh: (...args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() }),
  };
}

/** Finds L3's own notice carrier without rebuilding the producer fields it contains. */
const relayNoticeIn = (failure) => failure?.notice ?? (failure?.errors ?? []).map(relayNoticeIn).find(Boolean);
const relayMessages = (failure) => failure === undefined ? [] : [failure.message, ...(failure.errors ?? []).flatMap(relayMessages), ...(failure.cause === undefined ? [] : relayMessages(failure.cause))];

// Boundary rule 4 diagnostics: original M/U identity is separate from R-RECORD-9 event
// reporting and R-SCHED-23 reopening; each actual action and report is also checked below.
for (const write of ['postIssueComment', 'addIssue', 'moveItem']) for (const carrier of ['closed-pull', 'run', 'resume', 'later-read']) {
  // Host reason: wiring.
  // Rigger decision: test/hold-notice-loop.test.mjs — controlled notice carriers retain made actions and refused events.
  test(`P8/P9 actual ${write} made M/U identity through ${carrier}`, async (t) => withObservedAdmission(async (make, captures) => {
    const number = carrier === 'later-read' ? 14 : 12;
    const world = relayNativeWorld(t, { issues: carrier === 'later-read' ? [statusIssue(12, 'a1'), statusIssue(14, 'z9')] : [statusIssue(12, 'z9')], failRead: carrier === 'later-read' ? 'readColumns' : undefined });
    world.seed('hold-a1-issue-12.json');
    if (carrier === 'later-read') {
      assert.equal(world.gh('api', `repos/${REPO}/issues/12`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
      world.seed('hold-b2-issue-14.json');
    }
    const matches = (args) => write === 'postIssueComment' ? args[1] === `repos/${REPO}/issues/${number}/comments` : String(args[3]).includes(write === 'addIssue' ? 'addProjectV2ItemById' : 'updateProjectV2ItemFieldValue');
    const madeAt = [];
    let resumed;
    world.refuse((record) => {
      if (carrier === 'later-read' && record.event === 'admission.open') return true;
      if (record.event !== 'call.end' || !matches(world.fake.sent().at(-1) ?? [])) return false;
      madeAt.push(world.model());
      if (carrier === 'resume') resumed = moduleOver(world.state).resume();
      return true;
    });
    const built = world.build(make);
    const result = await (carrier === 'run' ? built.run() : built.pull()).then((value) => ({ value }), (failure) => ({ failure }));
    if (resumed) await resumed;
    assert.equal(madeAt.length, 1, 'P8 exactly one actual successful write record refused');
    assert.equal(madeAt[0].repository.issues.find((issue) => issue.number === number).comments.length, 1, 'P8 actual comment write independently recorded');
    const actual = world.noticed.find(({ answer }) => answer?.failed?.made)?.answer.failed;
    const notice = carrier === 'closed-pull' ? result.value.notices[0] : relayNoticeIn(result.failure);
    assert.ok(actual?.made, 'P8 actual producer M reached');
    assert.ok(notice, 'P9 actual notice carrier retained');
    assert.strictEqual(notice.made, actual.made, 'P8/P9 actual M reference at notice carrier');
    assert.strictEqual(notice.unrecorded, actual.unrecorded, 'P8/P9 actual U reference at notice carrier');
    assert.deepEqual(notice.unrecorded.map(({ event }) => event), ['call.end'], 'P8/P9 every dense event in order, including last');
    for (let at = 0; at < actual.unrecorded.length; at += 1) assert.strictEqual(notice.unrecorded[at], actual.unrecorded[at]);
    assert.equal(world.names().length, carrier === 'resume' ? 0 : 1);
    assert.ok(madeAt[0].sent.some(matches));
    const items = await (await world.fake.model()).operations.readItems();
    if (write === 'addIssue') assert.ok(items.some((item) => item.number === number), 'P8 actual board add retained');
    if (write === 'moveItem') assert.equal(items.find((item) => item.number === number).column, 'Owner');
    if (carrier !== 'closed-pull') assert.match(relayMessages(result.failure).join('; '), /call\.end/);
    if (carrier === 'later-read') {
      assert.ok(result.failure.errors.includes(captures.get(world.state).calls.find(({ method }) => method === 'open').reason), 'P9 original earlier A retained');
      assert.ok(result.failure.errors.includes(world.failures.find(({ name }) => name === 'readColumns').reason), 'P9 original later E retained');
    }
    if (carrier === 'closed-pull' && write === 'postIssueComment') {
      assert.equal(result.value.admission.state, 'closed');
      assert.equal(result.value.notices.length, 1);
      assert.deepEqual(world.names(), ['hold-a1-issue-12.json']);
      assert.equal(notice.step, 'comment on issue #12');
      assert.equal(typeof notice.cause, 'string');
      assert.match(notice.cause, /call\.end/);
      let line;
      assert.doesNotThrow(() => { line = relayNoticeLine('once', notice.id, notice); });
      assert.match(line, /made its step to comment on issue #12.*call\.end/);
    }
  }));
}

/** Actual default-runner comments for each of one or two initially issue-less closers. */
async function relayIssuelessComments(t, ids) {
  const world = relayNativeWorld(t, { issues: [statusIssue(12, 'z9')] });
  for (const id of ids) world.seed(`hold-${id}.json`);
  const madeAt = [];
  world.refuse((record) => {
    if (record.event !== 'call.end' || world.fake.sent().at(-1)?.[1] !== `repos/${REPO}/issues/12/comments`) return false;
    madeAt.push(world.model());
    return true;
  });
  const pulled = await world.build().pull();
  assert.equal(pulled.admission.state, 'closed');
  assert.equal(pulled.notices.length, ids.length, 'C-N5-TWO exact notice cardinality');
  assert.deepEqual(pulled.notices.map(({ id }) => id).sort(), [...ids].sort());
  assert.equal(madeAt.length, ids.length, 'each actual comment call.end refused');
  const comments = world.model().repository.issues.find(({ number }) => number === 12).comments;
  assert.equal(comments.length, ids.length, 'each actual default-runner comment independently recorded');
  for (const notice of pulled.notices) {
    const actual = world.noticed.find(({ input }) => input.closer.id === notice.id).answer.failed;
    assert.strictEqual(notice.made, actual.made, 'issue-less original actual M');
    assert.strictEqual(notice.unrecorded, actual.unrecorded, 'issue-less original actual U');
    assert.deepEqual(notice.unrecorded.map(({ event }) => event), ['call.end']);
    for (let at = 0; at < actual.unrecorded.length; at += 1) assert.strictEqual(notice.unrecorded[at], actual.unrecorded[at]);
    assert.equal(comments.filter(({ body }) => body.includes(`Hold: \`${notice.id}\``)).length, 1, 'each hold has its own actual comment');
    let line;
    assert.doesNotThrow(() => { line = relayNoticeLine('once', notice.id, notice); });
    assert.match(line, /made its step to comment on issue #12.*call\.end/);
  }
  assert.deepEqual(world.names(), ids.map((id) => `hold-${id}-issue-12.json`).sort());
}

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled notice carriers retain made actions and refused events.
test('an issue-less closer reports an actual made comment and its refused call.end', async (t) => relayIssuelessComments(t, ['c3']));

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled notice carriers retain made actions and refused events.
test('two issue-less closers retain each actual made-comment failure in one pull', async (t) => relayIssuelessComments(t, ['c3', 'c4']));

/** A native gh refusal enabled only after the actual opening boundary, with an ordered file witness. */
async function relayOnceAfterOpening(t, refused) {
  const here = statusConsumer(t, { closers: ['hold-a1-issue-12.json'], issues: [statusIssue(12, 'a1')] });
  assert.equal(here.gh('api', `repos/${REPO}/issues/12`, '-X', 'PATCH', '-f', 'state=closed').status, 0);
  const ahead = join(dirname(here.state), 'relay-gh');
  mkdirSync(ahead);
  const enabled = join(ahead, 'opening-observed');
  const order = join(ahead, 'order');
  const sentinel = refused ? 'raw readColumns refusal' : 'accepted-open readColumns refusal';
  const program = join(ahead, 'gh');
  writeFileSync(program, `#!${process.execPath}
if (process.env.RIGGER_FIXTURE_WARMING) process.exit(0);
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (fs.existsSync(${JSON.stringify(enabled)}) && String(args[3]).includes('fields(')) {
  fs.appendFileSync(${JSON.stringify(order)}, 'failed-readColumns\\n');
  process.stderr.write(${JSON.stringify(`gh: HTTP 502 ${sentinel}\n`)});
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(here.fake.gh)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  chmodSync(program, 0o755);
  assert.equal(spawnSync(program, [], { env: { RIGGER_FIXTURE_WARMING: '1' } }).status, 0);
  const oldPath = process.env.PATH;
  process.env.PATH = `${ahead}${delimiter}${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  const original = fs.appendFileSync;
  let projection;
  fs.appendFileSync = (path, bytes, ...rest) => {
    let record;
    try { record = JSON.parse(String(bytes)); } catch {}
    if (!String(path).startsWith(here.state) || record?.event !== 'admission.open') return original(path, bytes, ...rest);
    if (refused) {
      original(order, 'refused-opening\n');
      writeFileSync(enabled, 'opening removed');
      throw Object.assign(new Error('EIO actual admission.open append'), { code: 'EIO' });
    }
    const value = original(path, bytes, ...rest);
    projection = here.events().filter(({ event }) => event === 'admission.open').map(({ layer, kind, id, name, by, issue }) => ({ layer, kind, id, name, by, issue }));
    original(order, 'accepted-opening\n');
    writeFileSync(enabled, 'accepted append observed');
    return value;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.appendFileSync = original; syncBuiltinESMExports(); });
  const answered = await onceVerb({ target: here.target }).then((answer) => ({ answer }), (failure) => ({ failure }));
  assert.equal(answered.failure, undefined, 'ONCE returns its report without throwing');
  assert.equal(answered.answer.code, 1, 'ONCE status is exactly one');
  assert.match(answered.answer.text, new RegExp(`rigger once:.*readColumns.*HTTP 502 ${sentinel}`));
  assert.deepEqual(here.closers(), [], 'ONCE actual closer removed');
  assert.deepEqual(readFileSync(order, 'utf8').trim().split('\n'), [refused ? 'refused-opening' : 'accepted-opening', 'failed-readColumns'], 'ONCE opening boundary precedes failed actual reader');
  if (refused) assert.match(answered.answer.text, /admission changed at hold-a1-issue-12\.json.*admission\.open/);
  else {
    const expected = [{ layer: 'L3', kind: 'hold', id: 'a1', name: 'hold-a1-issue-12.json', by: 'issue', issue: 12 }];
    assert.deepEqual(projection, expected, 'ONCE exact opening event observed before enabling the refusal');
    assert.deepEqual(here.events().filter(({ event }) => event === 'admission.open').map(({ layer, kind, id, name, by, issue }) => ({ layer, kind, id, name, by, issue })), expected);
  }
}

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled notice carriers retain made actions and refused events.
test('once reports an actual later readColumns failure after an accepted admission.open record', async (t) => relayOnceAfterOpening(t, false));

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled notice carriers retain made actions and refused events.
test('once reports an actual later readColumns failure beside a refused admission.open record', async (t) => relayOnceAfterOpening(t, true));
