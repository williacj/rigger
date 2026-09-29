// ABOUTME: Tests the source-tree guard's `git` and `doctor`'s agent CLI probe as they run through L0's
// process adapter, with stand-ins that leave a child alive or never exit: each kill ends and is
// recorded, or reported on standard error where no repository was settled, and a verb stops at a
// kill its sink refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { agentAuth, sourceTreeGuard } from '../src/cli/doctor.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { alive, childrenIn, fixture, gitHanging, gitLeavingChild, gone, holding, leave, OUTLIVED, read, ready, TAIL, until, withFirstOnPath } from './process-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger;

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A board holding the template's columns and priority field, and one ready card L2 would pull. */
const BOARD = {
  columns: Object.values(template.board.columns),
  fields: [{ name: template.board.priority.field, options: template.board.priority.options }],
  items: [{
    type: 'issue', repository: REPO, number: 10, title: 'Card 10', body: '## Acceptance\n\n- The widget turns blue when pressed.\n', labels: ['type:change'], column: template.board.columns.ready,
  }],
};

/** A consumer's repository holding `config`, the template's for that board unless given, and its state directory. */
function consumer(config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } }) {
  const where = repositoryIn('rigger-guard-kill-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  return { where, state: join(where, '.rigger') };
}

/** A fake `gh` for `BOARD` in `directory/fake`, recording every call it is sent. */
function fakeGh(directory) {
  mkdirSync(join(directory, 'fake'));
  return installFakeGh(join(directory, 'fake'), { repo: REPO, project: PROJECT, board: BOARD });
}

/** The environment the bin runs under: `directory` and its fake `gh` first on PATH, ahead of the refusing `gh`. */
const withFirst = (directory) => ({ ...gitEnvironment(), PATH: [directory, join(directory, 'fake'), process.env.PATH].join(delimiter) });

/** Runs the bin at `from` with `verb`, in `where`, with `directory` first on PATH, and what it printed. */
function runBin(verb, where, directory, from = root) {
  const ran = spawnSync(process.execPath, [join(from, bin), verb], { cwd: where, encoding: 'utf8', env: withFirst(directory) });
  assert.equal(ran.error, undefined);
  return { code: ran.status, out: ran.stdout, err: ran.stderr };
}

/** Every line of `text` that is a JSON object, parsed: the events a sink never named writes to standard error. */
const eventsIn = (text) => text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));

/** Asserts `events` hold the kill of the child the stand-in in `directory` left, by its name and command line. */
function holdsChildKill(events, directory, said) {
  const [child] = childrenIn(directory);
  const kills = events.filter((event) => event.layer === 'L0' && event.pid === child);
  assert.equal(kills.length, 1, said);
  assert.equal(kills[0].name, 'tail', said);
  assert.equal(kills[0].cmd, `/usr/bin/tail -f ${directory}/hold`, said);
}

/** An `L0` emitter that keeps every event it is given, in `events`. */
function keeping() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

// proves R-STATE-7, R-STATE-12
test('given a git stand-in for the guard that leaves a child alive, and a target the guard accepts, the child is not alive when the guard settles', async (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const target = repositoryIn('rigger-guard-kill-');
  const emitter = keeping();

  const { named, refusal } = await withFirstOnPath(directory, () => sourceTreeGuard('once', { target, emitter }));

  assert.equal(refusal, undefined, refusal?.text);
  assert.ok(named, 'the guard named no repository');
  const children = childrenIn(directory);
  assert.equal(children.length, 1, 'the stand-in left no child, so this proves nothing');
  assert.equal(await gone(children[0], 0), true, `child ${children[0]} is alive`);
  assert.deepEqual(emitter.events.filter((event) => event.pid === children[0]).map((event) => event.event), ['survivor.killed']);
});

// proves R-STATE-12
test('given a git stand-in for the guard that leaves a child alive, and a target the guard accepts, the L0 kill event is in the target\'s stream ahead of every event rigger once emitted after the guard', async (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  fakeGh(directory);
  const { where, state } = consumer();

  const ran = runBin('once', where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  const events = readEvents(state);
  holdsChildKill(events, directory, said);
  const [child] = childrenIn(directory);
  const at = events.findIndex((event) => event.pid === child);
  assert.ok(events.length > 1, `once recorded nothing after the guard, so this proves nothing: ${said}`);
  assert.deepEqual(events.slice(0, at), [], said);
});

/**
 * A git repository holding a copy of this package's source, committed, from which its own bin runs
 * with that copy as the source tree it is running from (`R-SAFE-5`).
 */
function sourceTreeCopy() {
  const tree = repositoryIn('rigger-source-copy-');
  for (const path of ['src', 'templates', 'package.json']) cpSync(join(root, path), join(tree, path), { recursive: true });
  gitIn(tree, 'add', '-A');
  gitIn(tree, 'commit', '-qm', 'the source tree');
  return tree;
}

// proves R-STATE-13, R-SAFE-5
test('given a git stand-in for the guard that leaves a child alive, and a target that is Rigger\'s own source tree, the kill is reported on standard error, naming the process name and command line, and the target\'s git status is unchanged', (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const tree = sourceTreeCopy();
  const before = gitIn(tree, 'status', '--porcelain', '--ignored');

  const ran = runBin('once', tree, directory, tree);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.match(ran.err, /source tree/, said);
  holdsChildKill(eventsIn(ran.err), directory, said);
  assert.equal(gitIn(tree, 'status', '--porcelain', '--ignored'), before);
});

// proves R-STATE-13, R-SAFE-5
test('given a git stand-in for the guard that leaves a child alive, and a target that is no repository, the kill is reported on standard error, and nothing is written under the target', (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const target = join(directory, 'no-repository');
  mkdirSync(target);

  const ran = runBin('once', target, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.match(ran.err, /git names no repository/, said);
  holdsChildKill(eventsIn(ran.err), directory, said);
  assert.deepEqual(readdirSync(target), []);
});

// proves R-STATE-12
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a config that fails validation, the L0 kill event is in the target\'s stream', (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  fakeGh(directory);
  const { where, state } = consumer({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, kinds: 'none' });

  const ran = runBin('once', where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.match(ran.err, /rigger\.config\.mjs/, `the config was not refused, so this proves nothing: ${said}`);
  holdsChildKill(readEvents(state), directory, said);
});

/** The name and command line `ps` reads for `pid`, as L0's census reads them. */
function described(pid) {
  const column = (name) => execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', `${name}=`], { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8' } });
  return { name: column('ucomm').replace(/ *\n$/, ''), cmd: column('command').replace(/\n$/, '') };
}

// proves R-STATE-9, R-STATE-13
test('given rigger once receiving SIGTERM while the guard\'s git stand-in, which has started a child, is still running, neither is alive afterwards, each kill is on standard error naming its process name and command line, and once ends reporting SIGTERM', { timeout: 30_000 }, async (t) => {
  const directory = holding(t);
  gitHanging(directory);
  const { where } = consumer();
  const running = spawn(process.execPath, [join(root, bin), 'once'], { cwd: where, env: withFirst(directory), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => running.kill('SIGKILL'));
  let [out, err] = ['', ''];
  running.stdout.on('data', (chunk) => (out += chunk));
  running.stderr.on('data', (chunk) => (err += chunk));
  const ended = new Promise((resolve) => running.on('exit', (code, signal) => resolve({ code, signal })));

  await Promise.race([until(() => existsSync(join(directory, 'ready')), t), ended]);
  assert.ok(existsSync(join(directory, 'ready')), `once ended before its guard's git began: ${out}${err}`);
  const standIn = Number(read(directory, 'git.pid'));
  const [child] = childrenIn(directory);
  const expected = [standIn, child].map((pid) => ({ pid, ...described(pid) }));
  running.kill('SIGTERM');
  const { code, signal } = await ended;

  const said = `exited ${code}: ${out}${err}`;
  assert.equal(signal, 'SIGTERM', said);
  for (const pid of [standIn, child]) assert.equal(await gone(pid), true, `${pid} is alive`);
  const kills = eventsIn(err).filter((event) => event.layer === 'L0');
  for (const { pid, name, cmd } of expected) {
    const of = kills.filter((event) => event.pid === pid);
    assert.equal(of.length, 1, said);
    assert.deepEqual({ name: of[0].name, cmd: of[0].cmd }, { name, cmd }, said);
  }
  assert.equal(existsSync(join(where, '.rigger')), false, said);
});

// proves R-STATE-8
test('given a git stand-in for the guard that never exits, the verb\'s guard settles, reports that the timeout ended it, and leaves no process of its group alive', async (t) => {
  const directory = holding(t);
  gitHanging(directory);
  const target = repositoryIn('rigger-guard-timeout-');
  const emitter = keeping();

  const { refusal } = await withFirstOnPath(directory, () => sourceTreeGuard('once', { target, emitter, timeout: OUTLIVED }));

  ready(directory);
  assert.match(refusal?.text ?? '', new RegExp(`timeout of ${OUTLIVED} ms ended \`git `), refusal?.text);
  const group = Number(read(directory, 'git.pid'));
  assert.equal(alive(-group), false, `a process of group ${group} is alive`);
  assert.ok(emitter.events.some((event) => event.event === 'timeout.killed'), JSON.stringify(emitter.events));
});

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, rigger once exits non-zero naming the unrecorded kill, and the forge stand-in receives no call', (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const fake = fakeGh(directory);
  const { where, state } = consumer();
  // The stream is a directory, which no append can open.
  mkdirSync(join(state, 'events.jsonl'), { recursive: true });

  const ran = runBin('once', where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.notEqual(ran.code, 0, said);
  assert.match(ran.err, /went unrecorded/, said);
  holdsChildKill(eventsIn(ran.err), directory, said);
  assert.deepEqual(fake.sent(), []);
});

// A fixture repository's commit that starts git's background maintenance puts
// `.git/objects/maintenance.lock` under the target and removes it on its own time, so a listing
// of the target taken around a run races a process that is neither the verb nor Rigger. CI's git
// 2.55.0 did exactly that at 5347dda. So the fixture turns it off, and this holds it off.
test('a commit in a repository the fixture builds starts no git maintenance in the background', () => {
  const where = repositoryIn('rigger-no-maintenance-', { 'a.txt': 'a\n' });
  writeFileSync(join(where, 'b.txt'), 'b\n');
  gitIn(where, 'add', '-A');

  const traced = spawnSync('git', ['-C', where, 'commit', '-qm', 'traced'], { encoding: 'utf8', env: { ...gitEnvironment(), GIT_TRACE: '1' } });

  assert.equal(traced.status, 0, traced.stderr);
  assert.match(traced.stderr, /trace: built-in: git commit/, 'git traced nothing, so this proves nothing');
  assert.doesNotMatch(traced.stderr, /maintenance run|\bgc --auto/, traced.stderr);
});

/** Every path under `directory`, however deep, sorted. */
const everyPath = (directory) => readdirSync(directory, { recursive: true }).map(String).sort();

/**
 * Runs `verb` with a git stand-in for the guard that leaves a child alive, a target the guard
 * accepts, and a state directory that refuses writes, and asserts it exits non-zero naming the
 * unrecorded kill, sends the forge stand-in no call, and writes no file under the target.
 */
function stopsAtRefusedGuardKill(t, verb) {
  const directory = holding(t);
  gitLeavingChild(directory);
  // An agent CLI stand-in, so a doctor that went on past the guard would ask it rather than the host's.
  claude(directory, false);
  const fake = fakeGh(directory);
  const { where, state } = consumer();
  // The stream is a directory, which no append can open.
  mkdirSync(join(state, 'events.jsonl'), { recursive: true });
  const before = everyPath(where);

  const ran = runBin(verb, where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.notEqual(ran.code, 0, said);
  assert.match(ran.err, /went unrecorded/, said);
  holdsChildKill(eventsIn(ran.err), directory, said);
  assert.deepEqual(fake.sent(), [], said);
  assert.deepEqual(everyPath(where), before, said);
}

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, once exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and once writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'once'));

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, run exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and run writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'run'));

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, plan exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and plan writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'plan'));

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, setup-board exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and setup-board writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'setup-board'));

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, report exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and report writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'report'));

// proves R-RECORD-9
test('given a git stand-in for the guard that leaves a child alive, a target the guard accepts, and a state directory that refuses writes, doctor exits non-zero naming the unrecorded kill, the forge stand-in receives no call, and doctor writes no file under the target', (t) => stopsAtRefusedGuardKill(t, 'doctor'));

/** What the agent CLI states when signed in, as Claude Code 2.1.281 printed it (`test/doctor.test.mjs`). */
const SIGNED_IN = '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}';

/**
 * A `claude` stand-in in `directory` that states it is signed in and exits 0, having left a child
 * alive where `leaving` says so.
 */
const claude = (directory, leaving) => fixture(directory, 'claude', [`printf '%s\\n' '${SIGNED_IN}'`, ...(leaving ? [leave(TAIL, 'child-$$')] : []), 'exit 0'].join('\n'));

/** The report's line for the agent CLI check. */
const agentLine = (text) => text.split('\n').filter((line) => line.includes('agent CLI authentication'));

// proves R-STATE-7, R-STATE-12
test('given a stand-in for the agent CLI that doctor probes, which leaves a child alive and exits 0, doctor prints the same line for that probe as for a stand-in that leaves no child, and the child is not alive when doctor exits', async (t) => {
  const [leaving, quiet] = [holding(t), holding(t)];
  claude(leaving, true);
  claude(quiet, false);
  for (const directory of [leaving, quiet]) fakeGh(directory);
  const { where, state } = consumer();

  const left = runBin('doctor', where, leaving);
  const alone = runBin('doctor', where, quiet);

  const said = `${left.out}${left.err}\n${alone.out}${alone.err}`;
  assert.equal(agentLine(alone.out + alone.err).length, 1, said);
  assert.match(agentLine(alone.out + alone.err)[0], /loggedIn: true/, said);
  assert.deepEqual(agentLine(left.out + left.err), agentLine(alone.out + alone.err), said);
  const children = childrenIn(leaving);
  assert.equal(children.length, 1, `the stand-in left no child, so this proves nothing: ${said}`);
  assert.equal(await gone(children[0], 0), true, `child ${children[0]} is alive`);
  holdsChildKill(readEvents(state), leaving, said);
});

// proves R-RECORD-9
test('given a sink that refuses every append, and a stand-in for the agent CLI that doctor probes which leaves a child alive, the gh stand-in receives no call after that probe, and doctor exits non-zero naming the unrecorded kill', (t) => {
  const directory = holding(t);
  claude(directory, true);
  const fake = fakeGh(directory);
  const { where, state } = consumer();
  mkdirSync(join(state, 'events.jsonl'), { recursive: true });

  const ran = runBin('doctor', where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.notEqual(ran.code, 0, said);
  assert.match(ran.err, /went unrecorded/, said);
  assert.match(ran.err, /survivor\.killed/, said);
  assert.ok(ran.err.includes(`/usr/bin/tail -f ${directory}/hold`), said);
  // `gh auth status` is the one call doctor makes before the probe.
  assert.deepEqual(fake.sent(), [['auth', 'status']], said);
});

/** A `claude` stand-in in `directory` that never answers, as `gitHanging` never does, writing its pid to `claude.pid`. */
const claudeHanging = (directory) => fixture(directory, 'claude', [leave(TAIL, 'child-$$'), 'echo $$ > "$here/claude.pid"', ': > "$here/ready"', 'wait'].join('\n'));

// proves R-STATE-8
test('given a stand-in for the agent CLI that never exits, doctor\'s probe settles, reports that the timeout ended it, and leaves no process of its group alive', async (t) => {
  const directory = holding(t);
  claudeHanging(directory);
  const emitter = keeping();

  const said = await withFirstOnPath(directory, () => agentAuth({ emitter, timeout: OUTLIVED }));

  ready(directory);
  assert.equal(said.ok, null, said.detail);
  assert.match(said.detail, new RegExp(`timeout of ${OUTLIVED} ms ended \`claude `), said.detail);
  const group = Number(read(directory, 'claude.pid'));
  assert.equal(alive(-group), false, `a process of group ${group} is alive`);
  assert.ok(emitter.events.some((event) => event.event === 'timeout.killed'), JSON.stringify(emitter.events));
});

// proves R-STATE-12
test('a doctor, plan, setup-board or report run in which no process is killed by force creates no file under the target\'s state directory', (t) => {
  for (const verb of ['doctor', 'plan', 'setup-board', 'report']) {
    const directory = holding(t);
    claude(directory, false);
    fakeGh(directory);
    const { where, state } = consumer();

    const ran = runBin(verb, where, directory);

    assert.equal(existsSync(state), false, `${verb} exited ${ran.code}: ${ran.out}${ran.err}`);
  }
});

// proves R-RECORD-9
test('given a sink that refuses every append, and a gh stand-in that leaves a child alive on doctor\'s first board read, doctor sends no further call and exits non-zero naming the unrecorded kill, never a failed board line', (t) => {
  const directory = holding(t);
  claude(directory, false);
  const fake = fakeGh(directory);
  fixture(directory, 'gh', ['"$here/fake/gh" "$@"', 'status=$?', 'if [ "$1" = api ]; then', leave(TAIL, 'child-$$'), 'fi', 'exit $status'].join('\n'));
  const { where, state } = consumer();
  mkdirSync(join(state, 'events.jsonl'), { recursive: true });

  const ran = runBin('doctor', where, directory);

  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  assert.notEqual(ran.code, 0, said);
  assert.match(ran.err, /went unrecorded/, said);
  assert.ok(ran.err.includes(`/usr/bin/tail -f ${directory}/hold`), said);
  assert.doesNotMatch(ran.out + ran.err, /checks passed/, said);
  const sent = fake.sent();
  assert.deepEqual(sent.map((args) => args[0]), ['auth', 'api'], said);
});
