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
 * what gh says of a server error, and answers every other request as the fake does.
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
    writeFileSync(join(ahead, 'gh'), `#!/bin/sh\ncase "$*" in *'{ state repository { nameWithOwner } }'*) printf '%s\\n' 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)' >&2; exit 1;; esac\nexec ${JSON.stringify(fake.gh)} "$@"\n`);
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
 * Each way the config can fail after `resume` has removed its closers and before it reaches L2,
 * as the text of `rigger.config.mjs`: its evaluation throws, it does not parse, it is a BigInt
 * (the architect's round-5 probe on #1079), its validation throws rather than answering it invalid,
 * it answers invalid, and building L2's entry point throws, a config that validates whose board
 * getter throws only when `transitions.mjs` reads it.
 */
const FAILING_CONFIGS = {
  'its evaluation throws': [`throw new Error('the config threw as it was evaluated');\n`, /could not be read: .*the config threw as it was evaluated/],
  'it does not parse': ['export default {;\n', /could not be read: /],
  // A BigInt default, the architect's round-5 probe, which validation now answers invalid.
  'it is a BigInt': ['export default 1n;\n', /`rigger\.config\.mjs`: .*1n/],
  'its validation throws': ["export default Object.defineProperty({}, 'repo', { enumerable: true, get() { throw new Error('the repo getter threw'); } });\n", /could not be used: the repo getter threw/],
  'it does not validate': ['export default { repo: 7 };\n', /`rigger\.config\.mjs`: /],
  'building L2 throws': [[
    `import settings from ${JSON.stringify(new URL('../templates/rigger.config.mjs', import.meta.url).href)};`,
    `const config = { ...settings, repo: ${JSON.stringify(REPO)}, board: undefined };`,
    `const board = { ...settings.board, project: ${PROJECT} };`,
    "Object.defineProperty(config, 'board', { enumerable: true, get() { if (new Error().stack.includes('/src/workflow/transitions.mjs')) throw new Error('the board could not be handed to L2'); return board; } });",
    'export default config;',
  ].join('\n'), /the board could not be handed to L2/],
};

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
