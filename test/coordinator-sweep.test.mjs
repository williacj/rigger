// ABOUTME: Tests tools/coordinator/sweep.mjs, which removes a judge's or maker's directory under the
// worktree root once its pull requests have ended, against stub `gh`, `codex` and `lsof` and local git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOOLS, answer, assertToolingClean, forge, ghCalls, run, tree, world } from './coordinator-fixtures.mjs';
import { cloneInto, detachedWorktreeAt, gitIn, worktreeAt } from './git-repository.mjs';

// The sweep is read from `CODEX_TOOLS_DIR` where it is set, as the launchers' tests read theirs.
const SWEEP = join(process.env.CODEX_TOOLS_DIR || TOOLS, 'sweep.mjs');

/** A sweep test's world: a root, a fixture config naming the repository and topic rule, and a local forge. */
function setup(prefix, { topic = 'rigger-{number}' } = {}) {
  const w = world(prefix);
  const root = join(w.base, 'root');
  mkdirSync(root);
  const config = join(w.base, 'rigger.config.mjs');
  writeFileSync(config, `export default { repo: 'williacj/rigger', worktrees: { topic: '${topic}' } };\n`);
  const { bare } = forge(w);
  return { w, root, config, bare, prs: {} };
}

/** Records pull request `n`'s state and head branch for the stub `gh`. */
function pull(s, n, state, branch = `other-${n}`) {
  s.prs[n] = { state, branch, head: '0'.repeat(40) };
  answer(s.w, { prs: s.prs, ...s.extra });
}

/** Runs the sweep, returning its status and what it printed on each stream, one line each. */
function sweep(s, args = [], env = {}) {
  const result = run(s.w, process.execPath, [SWEEP, ...args], { env: { RIGGER_WORKTREE_ROOT: s.root, RIGGER_CONFIG: s.config, ...env } });
  const lines = (text) => text.split('\n').filter(Boolean);
  return { status: result.status, out: lines(result.stdout), err: lines(result.stderr), stderr: result.stderr };
}

/** A judge's entry holding a clone of the forge in its `repo`. */
function judge(s, name) {
  const dir = join(s.root, name);
  mkdirSync(dir);
  cloneInto(s.bare, join(dir, 'repo'));
  return dir;
}

/** A maker's clone, `codex-<card>`, on its card's branch, pushed so the forge holds every commit. */
function maker(s, card, branch = `rigger-${card}`) {
  const dir = join(s.root, `codex-${card}`);
  cloneInto(s.bare, dir);
  gitIn(dir, 'checkout', '-q', '-b', branch);
  commit(s, dir, `work-${card}`);
  gitIn(dir, 'push', '-q', 'origin', branch);
  return dir;
}

function commit(s, dir, name) {
  writeFileSync(join(dir, name), `${name}\n`);
  gitIn(dir, 'add', name);
  gitIn(dir, 'commit', '-q', '-m', name);
}

/** The line the sweep named `path` with on standard error, or undefined. */
const named = (r, path) => r.err.find((line) => line.includes(path));

/** A process whose working directory is `cwd`, holding `open` open where given, ready when this returns. */
function holder(t, s, cwd, open) {
  const ready = join(s.w.base, `ready-${readdirSync(s.w.base).length}`);
  const opener = open ? `exec 3<"$2"; ` : '';
  const started = spawnSync('/bin/sh', ['-c', `mkfifo "$1"; ( ${opener}echo ready > "$1"; exec tail -f /dev/null ) </dev/null >/dev/null 2>&1 & pid=$!; read x < "$1"; echo $pid`, 'sh', ready, open ?? ''], { cwd, encoding: 'utf8', env: s.w.env });
  const pid = Number(started.stdout.trim());
  assert.ok(pid > 0, started.stderr);
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already ended */ } });
  return pid;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A stub `lsof` with the given body, in a directory put first on PATH. */
function lsofStub(s, body) {
  const dir = join(s.w.base, 'lsof-stub');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lsof'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { PATH: `${dir}:${s.w.env.PATH}` };
}

test('a judge\'s entry whose pull request merged, or closed, is removed, its path on standard output', () => {
  const s = setup('sweep-ended-');
  const merged = judge(s, 'judge-12-codex-r1');
  const closed = judge(s, 'judge-13-claude-architect-r2');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'CLOSED');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out.sort(), [merged, closed].sort());
  assert.equal(existsSync(merged), false);
  assert.equal(existsSync(closed), false);
  assertToolingClean();
});

test('a maker\'s clone whose pull requests have all ended, one closed while its card is open, is removed with its -tmp', () => {
  const s = setup('sweep-maker-ended-');
  s.extra = { issues: { 7: 'still open' } };
  const work = maker(s, 7);
  mkdirSync(`${work}-tmp`);
  pull(s, 20, 'CLOSED', 'rigger-7');
  pull(s, 21, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, [work, `${work}-tmp`]);
  assert.equal(existsSync(work), false);
  assert.equal(existsSync(`${work}-tmp`), false);
  assert.ok(ghCalls(s.w).every((call) => !call.startsWith('issue')), 'the sweep reads no card');
  assertToolingClean();
});

test('an entry with any pull request open is kept and named, and a run keeping only those exits 0', () => {
  const s = setup('sweep-open-');
  const judged = judge(s, 'judge-12-codex-architect-r1');
  const work = maker(s, 7);
  pull(s, 12, 'OPEN');
  pull(s, 20, 'MERGED', 'rigger-7');
  pull(s, 21, 'OPEN', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, judged), /kept.*open/);
  assert.match(named(r, work), /kept.*open/);
  assert.ok(existsSync(judged) && existsSync(work));
  assertToolingClean();
});

test('a maker\'s clone, and a -tmp, with no pull request at all are kept and named, and the run exits non-zero', () => {
  const s = setup('sweep-no-pr-');
  const work = maker(s, 7);
  const lone = join(s.root, 'codex-8-tmp');
  mkdirSync(lone);
  pull(s, 30, 'MERGED', 'rigger-99');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, work), /kept.*no pull request/);
  assert.match(named(r, lone), /kept.*no pull request/);
  assertToolingClean();
});

test('an entry whose pull requests cannot be read, or whose read does not answer, is kept and named with the reason', () => {
  const s = setup('sweep-read-fails-');
  const unknown = judge(s, 'judge-40-codex-r1');
  const silent = judge(s, 'judge-41-codex-r1');
  const listFails = maker(s, 7);
  s.extra = { hang: ['41'], failList: ['rigger-7'] };
  pull(s, 99, 'MERGED');
  const r = sweep(s, [], { SWEEP_READ_TIMEOUT: '1' });

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, unknown), /kept.*cannot read.*no pull requests found/);
  assert.match(named(r, silent), /kept.*did not answer/);
  assert.match(named(r, listFails), /kept.*cannot read.*Bad Gateway/);
  assertToolingClean();
});

test('an entry a process has its working directory in, or holds a file in open, is kept and named with the pid, and each process still runs after', (t) => {
  const s = setup('sweep-in-use-');
  const cwdIn = judge(s, 'judge-12-codex-r1');
  const fileIn = judge(s, 'judge-13-codex-r1');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'MERGED');
  mkdirSync(join(cwdIn, 'repo', 'deep'));
  const inside = holder(t, s, join(cwdIn, 'repo', 'deep'));
  const opener = holder(t, s, s.w.base, join(fileIn, 'repo', 'README'));
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, cwdIn), new RegExp(`kept.*in use by pid ${inside}\\b`));
  assert.match(named(r, fileIn), new RegExp(`kept.*in use by pid ${opener}\\b`));
  assert.ok(alive(inside) && alive(opener), 'the sweep ended no process');
  assertToolingClean();
});

test('an entry is kept, named with the reason, when lsof is missing from PATH, writes to standard error, or exits other than 0 or 1', () => {
  for (const [env, reason] of [
    [(s) => ({ PATH: `${s.w.bin}:/usr/bin:/bin` }), /kept.*lsof.*not found/],
    [(s) => lsofStub(s, 'echo "lsof: WARNING: can\'t stat()" >&2; exit 1'), /kept.*lsof.*WARNING/],
    [(s) => lsofStub(s, 'exit 2'), /kept.*lsof.*exited 2/],
  ]) {
    const s = setup('sweep-lsof-');
    const entry = judge(s, 'judge-12-codex-r1');
    pull(s, 12, 'MERGED');
    const r = sweep(s, [], env(s));

    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.out, []);
    assert.match(named(r, entry), reason);
    assert.ok(existsSync(entry));
  }
  assertToolingClean();
});

test('lsof exiting 1 with nothing on standard error and no process listed means nothing uses the entry', () => {
  const s = setup('sweep-lsof-quiet-');
  const entry = judge(s, 'judge-12-codex-r1');
  pull(s, 12, 'MERGED');
  const r = sweep(s, [], lsofStub(s, 'exit 1'));

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, [entry]);
  assertToolingClean();
});

test('a maker\'s clone holding local-only work is kept and named: a modified file, a staged file, an untracked file, a stash entry', () => {
  const s = setup('sweep-local-work-');
  const modified = maker(s, 1);
  writeFileSync(join(modified, 'work-1'), 'changed\n');
  const staged = maker(s, 2);
  writeFileSync(join(staged, 'new'), 'new\n');
  gitIn(staged, 'add', 'new');
  const untracked = maker(s, 3);
  writeFileSync(join(untracked, 'loose'), 'loose\n');
  const stashed = maker(s, 4);
  writeFileSync(join(stashed, 'work-4'), 'stashed\n');
  gitIn(stashed, 'stash', '-q');
  const ignored = maker(s, 5);
  writeFileSync(join(ignored, '.git', 'info', 'exclude'), 'build/\n');
  mkdirSync(join(ignored, 'build'));
  writeFileSync(join(ignored, 'build', 'out'), 'out\n');
  for (const card of [1, 2, 3, 4, 5]) pull(s, 10 + card, 'MERGED', `rigger-${card}`);
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.match(named(r, modified), /kept.*uncommitted/);
  assert.match(named(r, staged), /kept.*uncommitted/);
  assert.match(named(r, untracked), /kept.*uncommitted/);
  assert.match(named(r, stashed), /kept.*stash/);
  assert.deepEqual(r.out, [ignored], 'an ignored file is no local-only work');
  assertToolingClean();
});

test('a maker\'s clone holding a commit the forge no longer holds is kept, though a remote-tracking ref from an earlier fetch still reaches it', () => {
  const s = setup('sweep-unheld-');
  const work = maker(s, 7);
  gitIn(s.bare, 'update-ref', '-d', 'refs/heads/rigger-7');
  assert.ok(gitIn(work, 'branch', '-r').includes('origin/rigger-7'), 'the stale ref is there');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, work), /kept.*commit.*forge does not hold/);
  assertToolingClean();
});

test('a maker\'s clone is removed when the forge holds its commits only through refs/pull', () => {
  const s = setup('sweep-pull-ref-');
  const work = maker(s, 7);
  const head = gitIn(work, 'rev-parse', 'HEAD').trim();
  gitIn(s.bare, 'update-ref', 'refs/pull/20/head', head);
  gitIn(s.bare, 'update-ref', '-d', 'refs/heads/rigger-7');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, [work]);
  assertToolingClean();
});

test('a maker\'s clone is kept and named with the reason when the forge\'s refs cannot be read, or the read does not answer', () => {
  const s = setup('sweep-refs-fail-');
  const missing = maker(s, 1);
  gitIn(missing, 'remote', 'set-url', 'origin', join(s.w.base, 'gone.git'));
  const silent = maker(s, 2);
  const hang = join(s.w.base, 'hang-ssh');
  writeFileSync(hang, '#!/bin/sh\nexec cat\n', { mode: 0o755 });
  gitIn(silent, 'remote', 'set-url', 'origin', 'ssh://forge.invalid/rigger.git');
  gitIn(silent, 'config', 'core.sshCommand', hang);
  pull(s, 11, 'MERGED', 'rigger-1');
  pull(s, 12, 'MERGED', 'rigger-2');
  const before = tree(s.root);
  const r = sweep(s, [], { SWEEP_READ_TIMEOUT: '1', GIT_ALLOW_PROTOCOL: 'file:ssh' });

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, missing), /kept.*cannot read the forge's refs/);
  assert.match(named(r, silent), /kept.*forge's refs.*did not answer/);
  assert.deepEqual(tree(s.root), before, 'the read wrote nothing');
  assertToolingClean();
});

test('a maker\'s clone whose git worktree list names a worktree outside it is kept and named', () => {
  const s = setup('sweep-linked-');
  const work = maker(s, 7);
  worktreeAt(work, join(s.w.base, 'outside'), 'side');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, work), /kept.*worktree.*outside/);
  assertToolingClean();
});

test('a judge\'s entry is removed whatever its repo holds, and when it holds no repo', () => {
  const s = setup('sweep-judge-work-');
  const busy = judge(s, 'judge-12-codex-r1');
  writeFileSync(join(busy, 'repo', 'README'), 'mutated\n');
  writeFileSync(join(busy, 'repo', 'loose'), 'loose\n');
  commit(s, join(busy, 'repo'), 'unpushed');
  writeFileSync(join(busy, 'repo', 'unpushed'), 'stash me\n');
  gitIn(join(busy, 'repo'), 'stash', '-q');
  const bare = join(s.root, 'judge-13-claude-reviewer-r1');
  mkdirSync(bare);
  writeFileSync(join(bare, 'card.md'), 'card\n');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'CLOSED');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out.sort(), [busy, bare].sort());
  assertToolingClean();
});

test('an entry holding a worktree of another checkout, at its clone\'s place or deeper inside it, is kept and named', () => {
  const s = setup('sweep-foreign-');
  const other = join(s.w.base, 'other');
  cloneInto(s.bare, other);
  const judged = join(s.root, 'judge-12-codex-r1');
  mkdirSync(join(judged, 'repo', 'nested'), { recursive: true });
  detachedWorktreeAt(other, join(judged, 'repo', 'nested', 'tree'), 'HEAD');
  const placed = join(s.root, 'codex-7');
  worktreeAt(other, placed, 'rigger-7');
  pull(s, 12, 'MERGED');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, judged), /kept.*worktree of another checkout/);
  assert.match(named(r, placed), /kept.*worktree of another checkout/);
  assertToolingClean();
});

test('a -tmp is kept while its codex-<card> is kept, and answers by its own rows where codex-<card> is removed or absent', () => {
  const s = setup('sweep-tmp-');
  const kept = maker(s, 1);
  writeFileSync(join(kept, 'loose'), 'loose\n');
  mkdirSync(`${kept}-tmp`);
  const removed = maker(s, 2);
  mkdirSync(`${removed}-tmp`);
  const absentEnded = join(s.root, 'codex-3-tmp');
  mkdirSync(absentEnded);
  const absentOpen = join(s.root, 'codex-4-tmp');
  mkdirSync(absentOpen);
  pull(s, 11, 'MERGED', 'rigger-1');
  pull(s, 12, 'MERGED', 'rigger-2');
  pull(s, 13, 'CLOSED', 'rigger-3');
  pull(s, 14, 'OPEN', 'rigger-4');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.match(named(r, `${kept}-tmp`), /kept.*codex-1 is kept/);
  assert.match(named(r, absentOpen), /kept.*open/);
  assert.deepEqual(r.out.sort(), [removed, `${removed}-tmp`, absentEnded].sort());
  assertToolingClean();
});

test('a symbolic link or a regular file at a matching name is left, named, its target untouched, and the run exits non-zero', () => {
  const s = setup('sweep-not-dir-');
  const target = join(s.w.base, 'target');
  mkdirSync(target);
  writeFileSync(join(target, 'keep'), 'keep\n');
  const link = join(s.root, 'judge-12-codex-r1');
  symlinkSync(target, link);
  const file = join(s.root, 'codex-7');
  writeFileSync(file, 'a file\n');
  pull(s, 12, 'MERGED');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, link), /left.*symbolic link/);
  assert.match(named(r, file), /left.*not a directory/);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'keep\n');
  assertToolingClean();
});

test('a root named through a symbolic link is swept as its real path', (t) => {
  const s = setup('sweep-root-link-');
  const ended = judge(s, 'judge-12-codex-r1');
  const used = judge(s, 'judge-13-codex-r1');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'MERGED');
  const pid = holder(t, s, join(used, 'repo'));
  const alias = join(s.w.base, 'alias');
  symlinkSync(s.root, alias);
  const r = sweep(s, [], { RIGGER_WORKTREE_ROOT: alias });

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, [ended]);
  assert.match(named(r, used), new RegExp(`kept.*pid ${pid}\\b`));
  assertToolingClean();
});

test('a maker\'s clone holding an untracked file is kept though its git config hides untracked files from status', () => {
  const s = setup('sweep-untracked-hidden-');
  const work = maker(s, 7);
  gitIn(work, 'config', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(work, 'local-only'), 'only here\n');
  assert.equal(gitIn(work, 'status', '--porcelain'), '', 'the clone\'s own status hides the file');
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, work), /kept.*uncommitted/);
  assertToolingClean();
});

test('a maker\'s entry whose pull request list fills the read\'s limit is kept, since an open one may lie past it', () => {
  const s = setup('sweep-list-limit-');
  const tmp = join(s.root, 'codex-7-tmp');
  mkdirSync(tmp);
  // The open pull request is the oldest, so gh, which lists newest first, cuts it at the limit.
  s.prs[1] = { state: 'OPEN', branch: 'rigger-7', head: '0'.repeat(40) };
  for (let n = 2; n <= 1001; n += 1) s.prs[n] = { state: 'CLOSED', branch: 'rigger-7', head: '0'.repeat(40) };
  answer(s.w, { prs: s.prs });
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, tmp), /kept.*1000 or more pull requests/);
  assertToolingClean();
});

test('a maker\'s clone whose tracked edit is hidden by assume-unchanged or skip-worktree is kept and named', () => {
  const s = setup('sweep-hidden-edit-');
  const assumed = maker(s, 1);
  gitIn(assumed, 'update-index', '--assume-unchanged', 'README');
  writeFileSync(join(assumed, 'README'), 'edited where status cannot see\n');
  const skipped = maker(s, 2);
  gitIn(skipped, 'update-index', '--skip-worktree', 'README');
  writeFileSync(join(skipped, 'README'), 'edited where status cannot see\n');
  for (const work of [assumed, skipped]) assert.equal(gitIn(work, 'status', '--porcelain', '--untracked-files=all'), '', 'status hides the edit');
  pull(s, 11, 'MERGED', 'rigger-1');
  pull(s, 12, 'MERGED', 'rigger-2');
  const r = sweep(s);

  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, assumed), /kept.*assume-unchanged or skip-worktree/);
  assert.match(named(r, skipped), /kept.*assume-unchanged or skip-worktree/);
  assertToolingClean();
});

test('a maker\'s clone whose branch the forge has moved past, without the clone fetching it, is removed, and listing it writes nothing', () => {
  const s = setup('sweep-forge-ahead-');
  const work = maker(s, 7);
  const other = cloneInto(s.bare, join(s.w.base, 'other'));
  gitIn(other, 'checkout', '-q', 'rigger-7');
  commit(s, other, 'later');
  gitIn(other, 'push', '-q', 'origin', 'rigger-7');
  const ahead = gitIn(other, 'rev-parse', 'HEAD').trim();
  assert.throws(() => gitIn(work, 'cat-file', '-e', ahead), 'the clone never fetched the forge\'s tip');
  pull(s, 20, 'CLOSED', 'rigger-7');
  const before = tree(s.root);
  const listed = sweep(s, ['--list']);

  assert.deepEqual(tree(s.root), before, 'the read wrote nothing into the clone or the root');
  assert.deepEqual(listed.out, [work], listed.stderr);
  const r = sweep(s);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, [work]);
  assertToolingClean();
});

test('a maker\'s clone is kept and named with the reason when the forge lists its refs but the fetch of a tip the clone lacks fails', () => {
  const s = setup('sweep-fetch-fails-');
  const work = maker(s, 7);
  const other = cloneInto(s.bare, join(s.w.base, 'other'));
  gitIn(other, 'checkout', '-q', 'rigger-7');
  commit(s, other, 'later');
  gitIn(other, 'push', '-q', 'origin', 'rigger-7');
  // An ssh stand-in that serves the forge's ref listing once, then refuses every later connection.
  const ssh = join(s.w.base, 'ssh-once');
  const count = join(s.w.base, 'ssh-count');
  writeFileSync(ssh, `#!/bin/sh\nfor a do last=$a; done\nif [ -e "${count}" ]; then echo "ssh: forge.invalid refused the connection" >&2; exit 255; fi\n: > "${count}"\nexec /bin/sh -c "$last"\n`, { mode: 0o755 });
  gitIn(work, 'remote', 'set-url', 'origin', `ssh://forge.invalid${s.bare}`);
  pull(s, 20, 'MERGED', 'rigger-7');
  const r = sweep(s, [], { GIT_ALLOW_PROTOCOL: 'file:ssh', GIT_SSH_COMMAND: ssh, GIT_SSH_VARIANT: 'simple' });

  assert.ok(existsSync(count), 'the ref listing was served');
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.out, []);
  assert.match(named(r, work), /kept.*cannot read the forge's refs.*refused the connection/);
  assertToolingClean();
});

/** A stub `rm` that records, before it removes anything, whether the sweep's standard output already names its operand. */
function watchedRemoval(s) {
  const dir = join(s.w.base, 'rm-stub');
  mkdirSync(dir);
  const printed = join(s.w.base, 'printed-first');
  writeFileSync(join(dir, 'rm'), `#!/bin/sh\nfor a do last=$a; done\nif grep -qxF -- "$last" "$SWEEP_STDOUT"; then echo "yes $last"; else echo "no $last"; fi >> "${printed}"\nexec /bin/rm "$@"\n`, { mode: 0o755 });
  return { env: { PATH: `${dir}:${s.w.env.PATH}` }, printed };
}

test('the sweep prints each path on standard output before its removal starts', () => {
  const s = setup('sweep-print-first-');
  const first = judge(s, 'judge-12-codex-r1');
  const second = judge(s, 'judge-13-codex-r1');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'MERGED');
  const { env, printed } = watchedRemoval(s);
  const stdout = join(s.w.base, 'stdout');
  const out = openSync(stdout, 'w');
  const result = spawnSync(process.execPath, [SWEEP], { env: { ...s.w.env, ...env, RIGGER_WORKTREE_ROOT: s.root, RIGGER_CONFIG: s.config, SWEEP_STDOUT: stdout }, stdio: ['ignore', out, 'pipe'], encoding: 'utf8' });
  closeSync(out);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(printed, 'utf8'), `yes ${first}\nyes ${second}\n`);
  assert.equal(existsSync(first) || existsSync(second), false);
  assertToolingClean();
});

test('a removal that fails partway is named with the reason after its path is printed, the sweep goes on, and the run exits with its own status', (t) => {
  const s = setup('sweep-remove-fails-');
  const stuck = judge(s, 'judge-12-codex-r1');
  const locked = join(stuck, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'file'), 'file\n');
  chmodSync(locked, 0o500);
  t.after(() => { if (existsSync(locked)) chmodSync(locked, 0o700); });
  const next = judge(s, 'judge-13-codex-r1');
  const open = judge(s, 'judge-14-codex-r1');
  pull(s, 12, 'MERGED');
  pull(s, 13, 'MERGED');
  pull(s, 14, 'MERGED');
  writeFileSync(join(open, 'loose'), 'loose\n');
  const r = sweep(s);

  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(r.out, [stuck, next, open], 'each path is printed, the failed one before its removal began');
  assert.match(named(r, stuck), new RegExp(`could not remove ${stuck}: rm: .*Permission denied`));
  assert.ok(existsSync(join(locked, 'file')), 'the removal failed partway');
  assert.equal(existsSync(next), false, 'the sweep went on to the next entry');
  assertToolingClean();
});

test('the exit status for a failed removal differs from the one for an entry kept for another reason', (t) => {
  const s = setup('sweep-exit-both-');
  const stuck = judge(s, 'judge-12-codex-r1');
  const locked = join(stuck, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'file'), 'file\n');
  chmodSync(locked, 0o500);
  t.after(() => { if (existsSync(locked)) chmodSync(locked, 0o700); });
  maker(s, 7);
  pull(s, 12, 'MERGED');
  const failed = sweep(s);
  chmodSync(locked, 0o700);
  const kept = sweep(s);

  assert.equal(failed.status, 3, failed.stderr);
  assert.equal(kept.status, 1, kept.stderr);
  assertToolingClean();
});

test('listing mode prints what a real run then removes, and leaves the root\'s recursive listing as it was', () => {
  const s = setup('sweep-listing-');
  judge(s, 'judge-12-codex-r1');
  judge(s, 'judge-13-codex-reviewer-r2');
  const work = maker(s, 7);
  mkdirSync(`${work}-tmp`);
  const dirty = maker(s, 8);
  writeFileSync(join(dirty, 'loose'), 'loose\n');
  mkdirSync(`${dirty}-tmp`);
  pull(s, 12, 'MERGED');
  pull(s, 13, 'OPEN');
  pull(s, 20, 'MERGED', 'rigger-7');
  pull(s, 21, 'MERGED', 'rigger-8');
  const before = tree(s.root);
  const listed = sweep(s, ['--list']);

  assert.deepEqual(tree(s.root), before);
  assert.equal(listed.status, 1, listed.stderr);
  const real = sweep(s);
  assert.deepEqual(listed.out, real.out);
  assert.equal(real.out.length, 3);
  for (const path of real.out) assert.equal(existsSync(path), false);
  assertToolingClean();
});

test('the topic rule a fixture config names finds codex-<card>\'s pull requests by the branch it derives', () => {
  const s = setup('sweep-topic-', { topic: 'card-{number}-work' });
  const work = maker(s, 7, 'card-7-work');
  pull(s, 20, 'MERGED', 'card-7-work');
  pull(s, 21, 'OPEN', 'rigger-7');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out, [work]);
  assert.ok(ghCalls(s.w).some((call) => call.includes('--head card-7-work') && call.includes('-R williacj/rigger')));
  assertToolingClean();
});

test('the sweep removes no entry whose whole name matches no pattern, nor anything below the root\'s own entries', () => {
  const s = setup('sweep-near-miss-');
  const misses = ['codex-', 'codex-abc', 'codex-12-tmp-x', 'judge-12-codex-r', 'judge-x-codex-r1', 'judge-12-claude-tester-r1',
    'rigger-12', 'judges', 'scratch', 'escalations', 'coordinator-logs', 'coordinator-tools', 'suite-slot', 'tq-tools', '12-attack',
    'judge-12-codex-r1-old', 'codex-7-tmpx', 'judge-12-claude-r1', 'judge-12-codex-reviewer-r'];
  for (const name of misses) mkdirSync(join(s.root, name));
  mkdirSync(join(s.root, 'tq-tools', 'codex-12'));
  mkdirSync(join(s.root, 'tq-tools', 'judge-12-codex-r1'));
  const hit = judge(s, 'judge-12-codex-r1');
  const hitRole = judge(s, 'judge-12-codex-spike-engineer-r3');
  const hitClaude = judge(s, 'judge-12-claude-pm-r1');
  pull(s, 12, 'MERGED');
  pull(s, 20, 'MERGED', 'rigger-12');
  const r = sweep(s);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out.sort(), [hit, hitRole, hitClaude].sort());
  for (const name of misses) assert.ok(existsSync(join(s.root, name)), name);
  assert.ok(existsSync(join(s.root, 'tq-tools', 'codex-12')) && existsSync(join(s.root, 'tq-tools', 'judge-12-codex-r1')));
  assert.ok(r.err.every((line) => !misses.some((name) => line.includes(join(s.root, name)))), 'a near miss is not named');
  assertToolingClean();
});

test('a run of the sweep creates nothing under an empty HOME when the root and config are outside it', () => {
  const s = setup('sweep-home-');
  judge(s, 'judge-12-codex-r1');
  maker(s, 7);
  pull(s, 12, 'MERGED');
  pull(s, 20, 'MERGED', 'rigger-7');
  const listed = sweep(s, ['--list']);
  const r = sweep(s);

  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(s.w.home), []);
  assertToolingClean();
});
