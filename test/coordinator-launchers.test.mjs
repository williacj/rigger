// ABOUTME: Tests the coordinator's Codex launchers in tools/coordinator/ against stub `codex` and
// `gh`: where each clones, logs and writes, and that each hands Codex what the source copy did.
// It also starts the `gh` function, as a Claude Code and a Codex session would, with a stand-in `gh`.

// The launchers are read from `CODEX_TOOLS_DIR` where it is set, and from tools/coordinator/
// otherwise, so a judge can point these tests at the rebuilt source copy. That directory holds the
// four launchers with both prompts beside them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { TOOLS, answer, assertToolingClean, codexCalls, forge, postWorld, run, world } from './coordinator-fixtures.mjs';
import { cloneInto, gitIn } from './git-repository.mjs';
import { SOURCE, sourceText } from './coordinator-source.mjs';
import { parseMarker } from '../src/workflow/marker.mjs';

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

/**
 * The fenced code blocks of `lines` that no other block encloses, by CommonMark's fenced code
 * rules: a fence opens on three or more backticks or tildes indented at most three spaces, a
 * backtick fence's info string holding no backtick; it closes on a run of its own character at
 * least as long, indented at most three spaces, with nothing after it but spaces or tabs; every
 * line inside an open fence is content, and a fence never closed runs to the end. Each block names
 * the line it opens on (`at`), the line it closes on (`end`, or `lines.length` where it never
 * closes), its run (`mark`) and its info string (`info`). Each line is read as the gate reads a fence
 * line, after trimEnd() (src/workflow/marker.mjs, `parseMarker`), so trailing whitespace of any
 * kind, a carriage return included, never decides whether a line opens or closes a fence.
 */
function fencedBlocks(lines) {
  const blocks = [];
  let open = null;
  for (let at = 0; at < lines.length; at += 1) {
    if (open !== null) {
      const run = /^ {0,3}(`{3,}|~{3,})$/.exec(lines[at].trimEnd())?.[1];
      if (run !== undefined && run[0] === open.mark[0] && run.length >= open.mark.length) {
        open.end = at;
        open = null;
      }
      continue;
    }
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[at].trimEnd());
    if (opener === null || (opener[1][0] === '`' && opener[2].includes('`'))) continue;
    open = { at, end: lines.length, mark: opener[1], info: opener[2].trim() };
    blocks.push(open);
  }
  return blocks;
}

/** The indexes of `lines` outside every block `fencedBlocks` finds, fence lines included in their block. */
function topLevel(lines) {
  const inside = new Set();
  for (const block of fencedBlocks(lines)) for (let at = block.at; at <= Math.min(block.end, lines.length - 1); at += 1) inside.add(at);
  return lines.map((_, at) => at).filter((at) => !inside.has(at));
}

/**
 * The lines under the prompt's "## Post" heading, up to the next "## " heading, both outside every
 * fenced block. Lines split on LF or CRLF, as `parseMarker` splits a comment, so a lone CR is no
 * line break.
 */
function postSection(prompt) {
  const lines = prompt.split(/\r?\n/);
  const outside = topLevel(lines);
  const start = outside.find((at) => lines[at].trimEnd() === '## Post');
  if (start === undefined) return [];
  const end = outside.find((at) => at > start && lines[at].startsWith('## '));
  return lines.slice(start + 1, end === undefined ? lines.length : end);
}

// D29 reason: wiring; the real codex-judge.sh fills the judge prompt with sed and hands it to the
// stub codex on standard input. Deterministic counterpart: test/marker.test.mjs, "the marker table:
// a marker block not directly under the comment's first line is no marker", is the test of the
// gate's read this layout depends on.
//
// The prompt's "## Post" section carries the verdict's layout as one example, which card #1439's
// "The example verdict layout" pins as conditions E1 to E4. The test checks those and no prose.
test('codex-judge.sh hands codex a prompt placing the marker block on the verdict comment\'s second line, under the heading and before the rest of the verdict', () => {
  const { w, bare, root, logs } = setup('coord-judge-marker-');
  const result = run(w, launcher('codex-judge.sh'), ['12', '7', '1'], { env: { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare, CODEX_LOG_DIR: logs } });

  assert.equal(result.status, 0, result.stderr);
  const post = postSection(codexCalls(w)[0].stdin);
  const examples = fencedBlocks(post)
    .filter((block) => block.mark === '````' && block.end < post.length && post[block.end].trimEnd() === '````')
    .map((block) => post.slice(block.at + 1, block.end))
    .filter((inside) => inside.some((line) => line.trimEnd() === '```rigger-marker'));
  const broken = [];
  if (examples.length !== 1) broken.push(`E1: the Post section holds ${examples.length} four-backtick blocks with a \`\`\`rigger-marker line, not exactly one`);
  else {
    const [example] = examples;
    if (!(example[0].startsWith('**Codex ') && example[0].endsWith('**'))) broken.push(`E2: the example's first line is not the **Codex …** heading: ${example[0]}`);
    if (parseMarker(example.join('\n'), 1).state === 'none') broken.push('E3: the gate reads no marker block on the example\'s second line');
    const block = fencedBlocks(example).find((fenced) => fenced.mark === '```' && fenced.info === 'rigger-marker');
    if (block === undefined || block.end === example.length || !example.slice(block.end + 1).some((line) => line.trim() !== '')) broken.push('E4: no non-empty line follows the marker block\'s closing fence');
  }
  assert.deepEqual(broken, [], `the marker block's placement: the example verdict layout breaks ${broken.map((entry) => entry.slice(0, 2)).join(' and ')}`);
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
  assert.match(zero.result.stderr, /^codex-retry: at capacity, retry 1 of 6 in 0 s$/m, 'the message names the wait it takes');
  assert.match(unset.result.stderr, /^codex-retry: at capacity, retry 1 of 6 in 300 s$/m);
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

/** The flags each launcher passes so a Codex command runs in the shell that defines the `gh` function. */
const SNAPSHOT_OFF = ['--disable', 'shell_snapshot', '--disable', 'shell_snapshot_v2'];
const startFiles = (call) => [call.zdotdir, call.bashEnv];
const holdsInOrder = (args, run) => args.some((_, at) => run.every((arg, offset) => args[at + offset] === arg));

test('codex-maker.sh, codex-judge.sh and codex-resume.sh each start codex with the post check\'s start files and the shell snapshot off', () => {
  const { w, bare, root } = setup('coord-start-files-');
  const message = resumable(w, bare, root);
  const runs = [
    ['codex-maker.sh', ['7', 'rigger-7'], { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare }],
    ['codex-judge.sh', ['12', '7', '1'], { RIGGER_WORKTREE_ROOT: root, RIGGER_REPO_URL: bare }],
    ['codex-resume.sh', ['7', 'thread-1', message], { RIGGER_WORKTREE_ROOT: root }],
  ];
  for (const [name, args, env] of runs) {
    const before = codexCalls(w).length;
    const result = run(w, launcher(name), args, { env });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const call = codexCalls(w)[before];
    assert.deepEqual(startFiles(call), [join(LAUNCHERS, 'post-check'), join(LAUNCHERS, 'post-check', 'bash-env.sh')], name);
    assert.ok(holdsInOrder(call.args, SNAPSHOT_OFF), `${name} passes ${SNAPSHOT_OFF.join(' ')}: ${call.args.join(' ')}`);
  }
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
 * The rebuilt source copy, launchers and prompts, each checked against the manifest's sha256 first.
 * The comparison below sets aside only the header, the slot line and the judge prompt's lines
 * `placed` names; in the source wrapper line it rewrites caffeinate -i to caffeinate -dims,
 * keeping every other byte in the comparison.
 */
function sourceCopy(dir) {
  mkdirSync(dir);
  for (const name of [...NAMES, ...PROMPTS]) {
    const text = sourceText(name);
    assert.equal(createHash('sha256').update(text).digest('hex'), SOURCE[name].sha256, `${name} is the manifest's`);
    writeFileSync(join(dir, name), text, { mode: NAMES.includes(name) ? 0o755 : 0o644 });
  }
}

/**
 * The judge prompt with the lines card #1439 changed under its "## Post" heading set aside: from
 * "Write the verdict to" to the line that introduces the rest of the verdict, in the source copy
 * and at the head, and the source copy's closing marker paragraph. Each run becomes one token.
 */
const placed = (text) => text
  .replace(/^Write the verdict to `[\s\S]*?^(?:Below that line, give:|After the block's closing fence, give:)$/m, '<marker placement>')
  .replace(/^End the verdict with the gate's marker block for your role\..*\n\n/m, '');

/** What one copy of a launcher handed the stub codex, with that run's own paths named generically. */
/** The arguments without the flags the launchers gained for the post check, which the source copies predate. */
const withoutSnapshotFlags = (args) => args.filter((arg, at) => !(arg === '--disable' && SNAPSHOT_OFF.includes(args[at + 1]))
  && !(SNAPSHOT_OFF.includes(arg) && arg !== '--disable' && args[at - 1] === '--disable'));

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
  const kept = (stdin) => placed(stdin.split('\n').filter((line) => !line.startsWith('<!-- ABOUTME:') && !line.includes('**Load and the slot:**')).map((line) => copy === 'source' && line.includes('Wrap every suite run') ? line.replaceAll('caffeinate -i', 'caffeinate -dims') : line).join('\n')).replace(/\n*$/, '');
  return codexCalls({ stub }).map((call) => ({
    args: withoutSnapshotFlags(call.args).map(generic),
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

// The `gh` function (card #1487). Repository tooling: no requirement binds what a post may hold.
const SESSION_SHELL = join(LAUNCHERS, 'session-shell.sh');
const T2_ENV = { ZDOTDIR: join(LAUNCHERS, 'post-check'), BASH_ENV: join(LAUNCHERS, 'post-check', 'bash-env.sh') };
const BLOCKED = 'met the Zanzibar Quokka today';
const PASSING = 'a plain comment';

/** Runs a command as a Claude Code session does: the env file's text, then the command, in shell. */
function asT1(p, shell, command) {
  const script = `${readFileSync(SESSION_SHELL, 'utf8')}\neval "$POST_TEST_COMMAND"\n`;
  return spawnSync(shell, ['-c', script], {
    env: { ...p.env, CLAUDE_ENV_FILE: SESSION_SHELL, POST_TEST_COMMAND: command }, encoding: 'utf8', timeout: 60_000,
  });
}

/**
 * Runs a command as a Codex session's shell does, under flags, with T2's start files named. Its
 * standard input is /dev/null: macOS bash 3.2 on a socket, which is what node gives a child for a
 * pipe, takes itself to be run by a remote shell daemon, reads ~/.bashrc and skips BASH_ENV.
 */
function asT2(p, shell, flag, command) {
  return spawnSync(shell, [flag, command], {
    env: { ...p.env, ...T2_ENV }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60_000,
  });
}

const T1_FORMS = (text) => [
  `gh issue comment 1 --body '${text}'`,
  `printf x | gh issue comment 1 --body '${text}'`,
  `v=$(gh issue comment 1 --body '${text}'); printf '%s' "$v"`,
  `(gh issue comment 1 --body '${text}')`,
  `for n in 1; do gh issue comment "$n" --body '${text}'; done`,
  `gh issue comment 1 --body '${text}' & wait`,
  `gh issue comment 1 --body-file - <<'END'\n${text}\nEND`,
  `VAR=x gh issue comment 1 --body '${text}'`,
];

test('by T1, in zsh and bash, each form of a post holding a list entry reaches no gh, and each passing one reaches it unchanged', () => {
  for (const shell of ['zsh', 'bash']) {
    for (const [blocked, passing] of T1_FORMS(BLOCKED).map((form, at) => [form, T1_FORMS(PASSING)[at]])) {
      const p = postWorld('post-t1-');
      const refused = asT1(p, shell, blocked);
      assert.deepEqual(p.posted(), [], `${shell}: ${blocked}`);
      assert.match(refused.stderr, /refused: C5/, `${shell}: ${blocked}`);
      asT1(p, shell, passing);
      const [call] = p.posted();
      assert.ok(call, `${shell}: ${passing} reached gh`);
      const sent = call.args.includes('-') ? call.stdin : call.args.at(-1);
      assert.equal(sent.trim(), PASSING, `${shell}: ${passing}`);
      assert.deepEqual(call.args.slice(0, 3), ['issue', 'comment', '1']);
    }
  }
});

test('by T2, under zsh -c, zsh -lc, bash -c and bash -lc, a post holding a list entry reaches no gh, with a home profile that puts another gh first', () => {
  for (const [shell, flag] of [['zsh', '-c'], ['zsh', '-lc'], ['bash', '-c'], ['bash', '-lc']]) {
    const p = postWorld('post-t2-');
    const other = join(p.base, 'other');
    mkdirSync(other);
    copyFileSync(join(p.bin, 'gh'), join(other, 'gh'));
    chmodSync(join(other, 'gh'), 0o755);
    for (const profile of ['.zshenv', '.zprofile', '.zshrc', '.zlogin', '.bash_profile', '.profile', '.bashrc']) {
      writeFileSync(join(p.home, profile), `PATH="${other}:$PATH"\n`);
    }
    const refused = asT2(p, shell, flag, `gh issue comment 1 --body '${BLOCKED}'`);
    assert.deepEqual(p.posted(), [], `${shell} ${flag}`);
    assert.match(refused.stderr, /refused: C5/, `${shell} ${flag}`);
    asT2(p, shell, flag, `gh issue comment 1 --body '${PASSING}'`);
    assert.deepEqual(p.posted().map(({ args }) => args), [['issue', 'comment', '1', '--body', PASSING]], `${shell} ${flag}`);
  }
});

test('a node child and a nested shell started from a T1 or a T2 shell hold no variable naming the function\'s files, and their gh is not the function', () => {
  const probe = `node -e 'for (const k of ["CLAUDE_ENV_FILE","ZDOTDIR","BASH_ENV"]) console.log(k + "=" + (process.env[k] ?? ""))'; `
    + `zsh -c 'echo "nested=$CLAUDE_ENV_FILE$ZDOTDIR$BASH_ENV"; whence -w gh'; bash -c 'type -t gh || echo none'`;
  const p = postWorld('post-t5-');
  for (const result of [asT1(p, 'zsh', probe), asT1(p, 'bash', probe), asT2(p, 'zsh', '-c', probe), asT2(p, 'bash', '-c', probe)]) {
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.deepEqual(lines.slice(0, 4), ['CLAUDE_ENV_FILE=', 'ZDOTDIR=', 'BASH_ENV=', 'nested='], result.stdout);
    assert.equal(lines[4], `gh: command`, result.stdout);
    assert.equal(lines[5], 'file', result.stdout);
  }
});

test('a body file is sent as the bytes the check read, even where the file changes after the read, and a file written by the posting command is checked', () => {
  const p = postWorld('post-file-');
  const body = join(p.base, 'body.md');
  // The file reads once as passing text and then as a list entry: a gh that re-read it would post the entry.
  const once = `gh issue comment 1 --body-file <(printf '${PASSING}'; printf '${BLOCKED}' > '${body}') `;
  asT1(p, 'bash', `printf '%s' '${PASSING}' > '${body}' && gh issue comment 12 --body-file '${body}'`);
  asT1(p, 'bash', `printf '%s' '${BLOCKED}' > '${body}' && gh issue comment 12 --body-file '${body}'`);
  asT1(p, 'zsh', once);
  const calls = p.posted();
  assert.equal(calls.length, 2, JSON.stringify(calls));
  assert.deepEqual(calls[0].args.slice(0, 4), ['issue', 'comment', '12', '--body-file']);
  assert.deepEqual(Object.values(calls[0].files), [PASSING]);
  assert.notEqual(calls[1].args[4], body);
  assert.deepEqual(Object.values(calls[1].files), [PASSING]);
});

test('the escalation command a role is given is sent with its passing content unchanged', () => {
  const p = postWorld('post-escalation-');
  writeFileSync(join(p.base, '.rigger-escalation.md'), `${PASSING}\n`);
  const result = spawnSync('bash', ['-c', `cd '${p.base}' && ${readFileSync(SESSION_SHELL, 'utf8')}\ngh issue comment 12 --body-file .rigger-escalation.md`], {
    env: { ...p.env, CLAUDE_ENV_FILE: SESSION_SHELL }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const [call] = p.posted();
  assert.deepEqual(call.args.slice(0, 4), ['issue', 'comment', '12', '--body-file']);
  assert.deepEqual(Object.values(call.files), [`${PASSING}\n`]);
});

test('where the check fails, no gh starts', () => {
  const p = postWorld('post-fails-');
  const result = asT1(p, 'bash', `gh issue comment 1 --body-file '${join(p.base, 'no-such-file.md')}'`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refused: the post could not be checked/);
  assert.deepEqual(p.posted(), []);
});
