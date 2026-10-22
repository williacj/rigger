// ABOUTME: Tests the coordinator's Codex launchers in tools/coordinator/ against stub `codex` and
// `gh`: where each clones, logs and writes, and that each hands Codex what the source copy did.

// The launchers are read from `CODEX_TOOLS_DIR` where it is set, and from tools/coordinator/
// otherwise, so a judge can point these tests at the rebuilt source copy. That directory holds the
// four launchers with both prompts beside them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOOLS, answer, assertToolingClean, codexCalls, forge, run, world } from './coordinator-fixtures.mjs';
import { cloneInto, gitIn } from './git-repository.mjs';
import { SOURCE } from './coordinator-source.mjs';

const LAUNCHERS = process.env.CODEX_TOOLS_DIR || TOOLS;
const launcher = (name) => join(LAUNCHERS, name);

/** A world with a local forge holding pull request 12, and a root and log directory outside HOME. */
function setup(prefix, options) {
  const w = world(prefix, options);
  const { bare, heads } = forge(w, [12]);
  answer(w, { prs: { 12: { head: heads[12], state: 'OPEN', branch: 'rigger-7' } }, issues: { 7: 'the card body' } });
  const root = join(w.base, 'root');
  const logs = join(w.base, 'logs');
  return { w, bare, sha: heads[12], root, logs };
}

test('codex-maker.sh clones RIGGER_REPO_URL into codex-<card> under RIGGER_WORKTREE_ROOT, and logs under its coordinator-logs where CODEX_LOG_DIR is unset', () => {
  const { w, bare, root } = setup('coord-maker-');
  const result = run(w, launcher('codex-maker.sh'), ['7', 'rigger-7'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare } });

  assert.ok(existsSync(join(root, 'coordinator-logs')), 'the log directory is RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.equal(result.status, 0, result.stderr);
  const work = join(root, 'codex-7');
  assert.equal(gitIn(work, 'remote', 'get-url', 'origin').trim(), bare);
  assert.equal(gitIn(work, 'branch', '--show-current').trim(), 'rigger-7');
  const [call] = codexCalls(w);
  assert.equal(call.cwd, work);
  assert.equal(call.tmpdir, join(root, 'codex-7-tmp'));
  assert.ok(existsSync(join(root, 'coordinator-logs', 'codex-7.jsonl')), 'the log is under RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.ok(existsSync(join(root, 'coordinator-logs', 'codex-7-prompt.md')), 'the prompt copy is under RIGGER_WORKTREE_ROOT/coordinator-logs');
  assertToolingClean();
});

test('codex-maker.sh writes its log and prompt copy in CODEX_LOG_DIR where it is set, and nothing under coordinator-logs', () => {
  const { w, bare, root, logs } = setup('coord-maker-logdir-');
  const result = run(w, launcher('codex-maker.sh'), ['7', 'rigger-7'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs } });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(logs).sort(), ['codex-7-prompt.md', 'codex-7.jsonl']);
  assert.equal(existsSync(join(root, 'coordinator-logs')), false);
  assertToolingClean();
});

test('codex-maker.sh writes a prompt naming suite-slot.sh by the absolute path of the one beside it', () => {
  const { w, bare, root, logs } = setup('coord-maker-slot-');
  run(w, launcher('codex-maker.sh'), ['7', 'rigger-7'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs } });

  const prompt = readFileSync(join(logs, 'codex-7-prompt.md'), 'utf8');
  assert.ok(prompt.includes(`\`${join(LAUNCHERS, 'suite-slot.sh')} 7-maker -- `), 'the slot line names the suite-slot.sh beside the launcher');
  assert.equal(codexCalls(w)[0].stdin, prompt);
  assertToolingClean();
});

test('codex-judge.sh clones RIGGER_REPO_URL into judge-<pr>-codex-r<round> under RIGGER_WORKTREE_ROOT, detached at the head, and logs under its coordinator-logs', () => {
  const { w, bare, sha, root } = setup('coord-judge-');
  const result = run(w, launcher('codex-judge.sh'), ['12', '7', '1'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare } });

  assert.ok(existsSync(join(root, 'coordinator-logs')), 'the log directory is RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.equal(result.status, 0, result.stderr);
  const base = join(root, 'judge-12-codex-r1');
  const work = join(base, 'repo');
  assert.equal(gitIn(work, 'remote', 'get-url', 'origin').trim(), bare);
  assert.equal(gitIn(work, 'rev-parse', 'HEAD').trim(), sha);
  const [call] = codexCalls(w);
  assert.equal(call.cwd, work);
  assert.equal(call.tmpdir, join(base, 'tmp'));
  assert.ok(existsSync(join(root, 'coordinator-logs', 'judge-12-codex-r1.jsonl')), 'the log is under RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.ok(existsSync(join(root, 'coordinator-logs', 'judge-12-codex-r1-prompt.md')), 'the prompt copy is under RIGGER_WORKTREE_ROOT/coordinator-logs');
  assertToolingClean();
});

test('codex-judge.sh in another role uses judge-<pr>-codex-<role>-r<round>, and writes its log and prompt copy in CODEX_LOG_DIR where it is set', () => {
  const { w, bare, root, logs } = setup('coord-judge-logdir-');
  const result = run(w, launcher('codex-judge.sh'), ['12', '7', '2'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs, JUDGE_ROLE: 'architect' } });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(root, 'judge-12-codex-architect-r2', 'repo', '.git')));
  assert.deepEqual(readdirSync(logs).sort(), ['judge-12-codex-architect-r2-prompt.md', 'judge-12-codex-architect-r2.jsonl']);
  assert.equal(existsSync(join(root, 'coordinator-logs')), false);
  assertToolingClean();
});

test('codex-judge.sh writes a prompt naming suite-slot.sh by the absolute path of the one beside it', () => {
  const { w, bare, root, logs } = setup('coord-judge-slot-');
  run(w, launcher('codex-judge.sh'), ['12', '7', '1'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs } });

  const prompt = readFileSync(join(logs, 'judge-12-codex-r1-prompt.md'), 'utf8');
  assert.ok(prompt.includes(`\`${join(LAUNCHERS, 'suite-slot.sh')} 12-reviewer-r1 -- `), 'the slot line names the suite-slot.sh beside the launcher');
  assertToolingClean();
});

/** A maker's clone and its tmp directory, as codex-maker.sh leaves them, and a message file. */
function resumable(w, bare, root) {
  cloneInto(bare, join(root, 'codex-7'));
  mkdirSync(join(root, 'codex-7-tmp'));
  const message = join(w.base, 'message.md');
  writeFileSync(message, 'carry on\n');
  return message;
}

test('codex-resume.sh resumes in codex-<card> under RIGGER_WORKTREE_ROOT and appends to the log under its coordinator-logs', () => {
  const { w, bare, root } = setup('coord-resume-');
  const message = resumable(w, bare, root);
  const result = run(w, launcher('codex-resume.sh'), ['7', 'thread-1', message], { env: { RIGGER_WORKTREE_ROOT: root } });

  assert.ok(existsSync(join(root, 'coordinator-logs')), 'the log directory is RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.equal(result.status, 0, result.stderr);
  const [call] = codexCalls(w);
  assert.equal(call.cwd, join(root, 'codex-7'));
  assert.equal(call.tmpdir, join(root, 'codex-7-tmp'));
  assert.equal(call.stdin, 'carry on\n');
  assert.ok(existsSync(join(root, 'coordinator-logs', 'codex-7.jsonl')), 'the log is under RIGGER_WORKTREE_ROOT/coordinator-logs');
  assertToolingClean();
});

test('codex-resume.sh appends to the log in CODEX_LOG_DIR where it is set', () => {
  const { w, bare, root, logs } = setup('coord-resume-logdir-');
  const message = resumable(w, bare, root);
  writeFileSync(join(w.stub, 'out-1'), 'resumed\n');
  mkdirSync(logs);
  writeFileSync(join(logs, 'codex-7.jsonl'), 'before\n');
  const result = run(w, launcher('codex-resume.sh'), ['7', 'thread-1', message], { env: { RIGGER_WORKTREE_ROOT: root, CODEX_LOG_DIR: logs } });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(logs, 'codex-7.jsonl'), 'utf8'), 'before\nresumed\n');
  assert.equal(existsSync(join(root, 'coordinator-logs')), false);
  assertToolingClean();
});

/** The stub `codex`'s first answer: a started thread that then hit capacity. */
const AT_CAPACITY = '{"type":"thread.started","thread_id":"thread-9"}\n{"type":"error","message":"Selected model is at capacity"}\n';

/** The resumed session's answer, long enough that the capacity line falls out of the log's last five. */
const RESUMED = ['thread.started', 'turn.started', 'item.started', 'item.completed', 'turn.completed'].map((type) => `{"type":"${type}"}\n`).join('');

/** Runs codex-retry.sh over codex-maker.sh, whose first session hits capacity and whose resume ends it. */
function retryOverMaker(prefix, env, { stubSleep = true, logDir = false, homeRoot = false } = {}) {
  const s = setup(prefix, { stubSleep });
  // At the root the source hard-codes, with the clone made beforehand, the source copy reaches its
  // continue message too, so this test can be pointed at either copy.
  if (homeRoot) s.root = join(s.w.home, 'GitHub', 'rigger-worktrees');
  if (homeRoot) cloneInto(s.bare, join(s.root, 'codex-7'));
  writeFileSync(join(s.w.stub, 'out-1'), AT_CAPACITY);
  writeFileSync(join(s.w.stub, 'out-2'), RESUMED);
  if (logDir) env = { ...env, CODEX_LOG_DIR: s.logs };
  const logs = env.CODEX_LOG_DIR ?? join(s.root, 'coordinator-logs');
  const log = join(logs, 'codex-7.jsonl');
  mkdirSync(logs, { recursive: true });
  const result = run(s.w, launcher('codex-retry.sh'), [log, launcher('codex-maker.sh'), '7', 'rigger-7'], { env: { RIGGER_WORKTREE_ROOT: s.root, RIGGER_REPO_URL: s.bare, ...env } });
  return { ...s, result, log, logs };
}

const CONTINUE = 'Your last turn failed because the model was at capacity. Continue the card from where you stopped, under the same instructions.\n';

test('codex-retry.sh writes its continue message in CODEX_LOG_DIR where it is set, and resumes the maker\'s thread with it', () => {
  const { w, result, logs, root } = retryOverMaker('coord-retry-logdir-', { CODEX_RETRY_WAIT: '0' }, { logDir: true });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(logs, 'codex-7-continue.md'), 'utf8'), CONTINUE);
  const [, resumed] = codexCalls(w);
  assert.deepEqual(resumed.args.slice(0, 3), ['exec', 'resume', '--json']);
  assert.ok(resumed.args.includes('thread-9'));
  assert.equal(resumed.stdin, CONTINUE);
  assert.equal(existsSync(join(root, 'coordinator-logs')), false);
  assertToolingClean();
});

test('codex-retry.sh writes its continue message under RIGGER_WORKTREE_ROOT/coordinator-logs where CODEX_LOG_DIR is unset', () => {
  const { w, result, root } = retryOverMaker('coord-retry-', { CODEX_RETRY_WAIT: '0' }, { homeRoot: true });

  assert.ok(existsSync(join(root, 'coordinator-logs', 'codex-7-continue.md')), 'the continue message is in RIGGER_WORKTREE_ROOT/coordinator-logs');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'coordinator-logs', 'codex-7-continue.md'), 'utf8'), CONTINUE);
  assert.equal(codexCalls(w).length, 2);
  assertToolingClean();
});

test('codex-retry.sh waits CODEX_RETRY_WAIT seconds between attempts, and 300 where it is unset', () => {
  const zero = retryOverMaker('coord-retry-wait-', { CODEX_RETRY_WAIT: '0' });
  const unset = retryOverMaker('coord-retry-wait-default-', {});

  assert.equal(readFileSync(join(zero.w.stub, 'sleeps'), 'utf8'), '0\n');
  assert.equal(readFileSync(join(unset.w.stub, 'sleeps'), 'utf8'), '300\n');
  assertToolingClean();
});

test('codex-retry.sh with a wait of 0 and the real sleep runs both attempts and ends', () => {
  const { w, result } = retryOverMaker('coord-retry-real-wait-', { CODEX_RETRY_WAIT: '0' }, { stubSleep: false });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(codexCalls(w).length, 2);
  assertToolingClean();
});

test('codex-retry.sh writes its .pid file beside the <log> argument it is handed', () => {
  const { w, root } = setup('coord-retry-pid-');
  const elsewhere = join(w.base, 'elsewhere');
  mkdirSync(elsewhere);
  const log = join(elsewhere, 'run.jsonl');
  const result = run(w, launcher('codex-retry.sh'), [log, '/usr/bin/true'], { env: { RIGGER_WORKTREE_ROOT: root } });

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(`${log}.pid`, 'utf8'), /^[0-9]+\n$/);
  assertToolingClean();
});

test('no launcher creates anything under an empty HOME when the configuration names directories outside it', () => {
  const { w, bare, root, logs } = setup('coord-home-', { stubSleep: true });
  const env = { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs };
  writeFileSync(join(w.stub, 'out-2'), AT_CAPACITY);
  writeFileSync(join(w.stub, 'out-3'), RESUMED);
  const runs = [
    run(w, launcher('codex-maker.sh'), ['7', 'rigger-7'], { env }),
    run(w, launcher('codex-retry.sh'), [join(logs, 'codex-7.jsonl'), launcher('codex-maker.sh'), '7', 'rigger-7'], { env }),
    run(w, launcher('codex-judge.sh'), ['12', '7', '1'], { env }),
  ];
  const message = join(w.base, 'message.md');
  writeFileSync(message, 'carry on\n');
  runs.push(run(w, launcher('codex-resume.sh'), ['7', 'thread-1', message], { env }));

  for (const result of runs) assert.equal(result.status, 0, result.stderr);
  assert.equal(codexCalls(w).length, 5, 'maker, retry\'s maker and its resume, judge, resume');
  assert.deepEqual(readdirSync(w.home), []);
  assertToolingClean();
});

/** The launchers and prompts of one copy, laid out as tools/coordinator/ lays them out. */
const PROMPTS = ['codex-maker-prompt.md', 'codex-judge-prompt.md'];
const NAMES = ['codex-maker.sh', 'codex-judge.sh', 'codex-resume.sh', 'codex-retry.sh'];

function movedCopy(dir) {
  mkdirSync(dir);
  for (const name of [...NAMES, ...PROMPTS, 'suite-slot.sh']) copyFileSync(join(LAUNCHERS, name), join(dir, name));
  for (const name of NAMES) chmodSync(join(dir, name), 0o755);
}

/**
 * The rebuilt source copy, each launcher checked against the manifest's sha256 first. The source
 * prompts name a path in the coordinator's home, so the moved prompts stand beside them; the
 * comparison sets aside the two lines in which the prompts differ, the header and the slot line.
 */
function sourceCopy(dir) {
  mkdirSync(dir);
  for (const name of NAMES) {
    const { text, sha256 } = SOURCE[name];
    assert.equal(createHash('sha256').update(text).digest('hex'), sha256, `${name} is the manifest's`);
    writeFileSync(join(dir, name), text, { mode: 0o755 });
  }
  for (const name of PROMPTS) copyFileSync(join(LAUNCHERS, name), join(dir, name));
}

/** What one copy of a launcher handed the stub codex, with that run's own paths named generically. */
function invocation(w, copy, launch) {
  const home = join(w.base, `home-${copy}`);
  const stub = join(w.base, `stub-${copy}`);
  const tools = join(w.base, copy);
  mkdirSync(home);
  mkdirSync(stub);
  (copy === 'moved' ? movedCopy : sourceCopy)(tools);
  writeFileSync(join(stub, 'out-1'), AT_CAPACITY);
  writeFileSync(join(stub, 'out-2'), RESUMED);
  const root = join(home, 'GitHub', 'rigger-worktrees');
  launch.prepare(root);
  const env = {
    HOME: home,
    CODEX_STUB_DIR: stub,
    RIGGER_WORKTREE_ROOT: root,
    RIGGER_REPO_URL: 'https://github.com/williacj/rigger.git',
    CODEX_LOG_DIR: launch.logs(root, tools),
    CODEX_RETRY_WAIT: '300',
  };
  mkdirSync(env.CODEX_LOG_DIR, { recursive: true });
  const result = run(w, join(tools, launch.name), launch.args(env.CODEX_LOG_DIR, tools), { env });
  assert.equal(result.status, 0, `${copy} ${launch.name}: ${result.stderr}`);
  const generic = (text) => text.replaceAll(tools, '<TOOLS>').replaceAll(home, '<HOME>');
  const kept = (stdin) => stdin.split('\n').filter((line) => !line.startsWith('<!-- ABOUTME:') && !line.includes('**Load and the slot:**')).join('\n').replace(/\n*$/, '');
  return codexCalls({ stub }).map((call) => ({
    args: call.args.map(generic),
    cwd: generic(call.cwd),
    tmpdir: generic(call.tmpdir),
    stdin: generic(kept(call.stdin)),
  }));
}

test('each launcher hands the stub codex the invocation its rebuilt source copy hands it, with each variable at the directory the source hard-codes', () => {
  // Each clone exists before the run, so neither copy clones from the forge's URL.
  const maker = (bare) => (root) => cloneInto(bare, join(root, 'codex-7'));
  const coordinatorLogs = (root) => join(root, 'coordinator-tools', 'logs');
  const besideTools = (root, tools) => join(tools, 'logs');
  const launches = [
    { name: 'codex-maker.sh', prepare: maker, logs: coordinatorLogs, args: () => ['7', 'rigger-7'] },
    { name: 'codex-judge.sh', prepare: (bare) => (root) => cloneInto(bare, join(root, 'judge-12-codex-r1', 'repo')), logs: besideTools, args: () => ['12', '7', '1'] },
    {
      name: 'codex-resume.sh',
      prepare: (bare) => (root) => { maker(bare)(root); mkdirSync(join(root, 'codex-7-tmp')); },
      logs: coordinatorLogs,
      args: (logs, tools) => ['7', 'thread-1', join(tools, '..', 'message.md')],
    },
    { name: 'codex-retry.sh', prepare: maker, logs: besideTools, args: (logs, tools) => [join(logs, 'codex-7.jsonl'), join(tools, 'codex-maker.sh'), '7', 'rigger-7'] },
  ];

  for (const launch of launches) {
    const w = world('coord-differential-', { stubSleep: true });
    const { bare, heads } = forge(w, [12]);
    answer(w, { prs: { 12: { head: heads[12], state: 'OPEN', branch: 'rigger-7' } }, issues: { 7: 'the card body' } });
    writeFileSync(join(w.base, 'message.md'), 'carry on\n');
    const prepare = (root) => { mkdirSync(root, { recursive: true }); launch.prepare(bare)(root); };
    const moved = invocation(w, 'moved', { ...launch, prepare });
    const source = invocation(w, 'source', { ...launch, prepare });
    assert.ok(moved.length > 0, `${launch.name} reached codex`);
    assert.deepEqual(moved, source, launch.name);
  }
  assertToolingClean();
});
