#!/usr/bin/env node
// ABOUTME: Removes a judge's or maker's directory under the worktree root once every pull request it
// serves has ended, no process uses it, and, for a maker's clone, no work lives only in it.
//
// Usage: node tools/coordinator/sweep.mjs [--list]
// Run it from the main checkout, by hand, while no maker or judge the coordinator dispatched runs.
// --list prints what a real run would remove, and removes nothing.
//
// RIGGER_WORKTREE_ROOT (default $HOME/GitHub/rigger-worktrees) is the root whose own entries it
// reads. RIGGER_CONFIG (default the rigger.config.mjs of the checkout holding this file) names the
// config it reads `repo` and `worktrees.topic` from. SWEEP_READ_TIMEOUT (default 60) is how many
// seconds a read of the forge may take before it counts as unanswered.
//
// It reads only entries whose whole name matches one of these, where <pr>, <card> and <round> are
// runs of decimal digits and <role> is architect, engineer, pm, reviewer or spike-engineer:
//   judge-<pr>-codex-r<round>, judge-<pr>-codex-<role>-r<round>, judge-<pr>-claude-<role>-r<round>:
//     a judge's, serving pull request <pr>, its clone in repo;
//   codex-<card>: a maker's clone, serving every pull request whose head branch is the topic
//     rule's branch for <card>; codex-<card>-tmp: that clone's temporary directory.
//
// Standard output carries each path it removes, printed before the removal starts. Standard error
// names each entry it keeps, leaves or fails to remove, with the reason. It finds `gh`, `git` and
// `lsof` and `rm` on PATH, and ends no process but a read of the forge it started that did not answer.
//
// Exit status: 0 when nothing failed and every entry kept was kept only for an open pull request;
// 1 when an entry was kept or left for any other reason; 3 when a removal failed; 2 when it could
// not run at all.

import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROLES = '(?:architect|engineer|pm|reviewer|spike-engineer)';
const PATTERNS = [
  { kind: 'judge', match: new RegExp(`^judge-([0-9]+)-codex-r[0-9]+$`) },
  { kind: 'judge', match: new RegExp(`^judge-([0-9]+)-codex-${ROLES}-r[0-9]+$`) },
  { kind: 'judge', match: new RegExp(`^judge-([0-9]+)-claude-${ROLES}-r[0-9]+$`) },
  { kind: 'maker', match: /^codex-([0-9]+)$/ },
  { kind: 'tmp', match: /^codex-([0-9]+)-tmp$/ },
];

/** The most pull requests one read lists; a list this long may have left an open one out. */
const LIMIT = 1000;

const KEPT_OPEN = 'open';
const KEPT = 'kept';
const FAILED = 'failed';

function fail(message) {
  process.stderr.write(`sweep: ${message}\n`);
  process.exit(2);
}

/** Runs a command, returning its status, output, and whether it failed to start or to answer. */
function call(command, args, { cwd, timeout } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 256 * 1024 * 1024 });
  if (result.error?.code === 'ETIMEDOUT') return { silent: true };
  if (result.error) return { missing: result.error.code === 'ENOENT', error: result.error.message };
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.trim() };
}

/** Whether `path` is `dir` or lies inside it. */
function within(dir, path) {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const real = (path) => { try { return realpathSync.native(path); } catch { return resolve(path); } };

class Sweep {
  constructor({ root, repo, topic, list, timeout }) {
    Object.assign(this, { root, repo, topic, list, timeout });
    this.reads = new Map();
    this.outcome = new Map();
    this.worst = 0;
  }

  keep(path, reason, open = false) {
    process.stderr.write(`sweep: kept ${path}: ${reason}\n`);
    this.worst = Math.max(this.worst, open ? 0 : 1);
    return open ? KEPT_OPEN : KEPT;
  }

  leave(path, reason) {
    process.stderr.write(`sweep: left ${path}: ${reason}\n`);
    this.worst = Math.max(this.worst, 1);
    return KEPT;
  }

  /** The states of the pull requests an entry serves, or { reason } when the forge's answer is wanting. */
  pulls(kind, number) {
    const key = `${kind}:${number}`;
    if (!this.reads.has(key)) this.reads.set(key, this.readPulls(kind, number));
    return this.reads.get(key);
  }

  readPulls(kind, number) {
    const args = kind === 'judge'
      ? ['pr', 'view', number, '-R', this.repo, '--json', 'state', '--jq', '.state']
      : ['pr', 'list', '-R', this.repo, '--head', this.topic.replaceAll('{number}', number), '--state', 'all', '--json', 'number,state', '--limit', String(LIMIT)];
    const r = call('gh', args, { timeout: this.timeout });
    if (r.silent) return { reason: `the read of its pull requests did not answer within ${this.timeout / 1000} s` };
    if (r.error) return { reason: `cannot read its pull requests: ${r.error}` };
    if (r.status !== 0) return { reason: `cannot read its pull requests: ${r.stderr || `gh exited ${r.status}`}` };
    if (kind === 'judge') return { states: [r.stdout.trim()] };
    try {
      const states = JSON.parse(r.stdout).map((pr) => pr.state);
      if (states.length >= LIMIT) return { reason: `it has ${LIMIT} or more pull requests, and one read lists no more than ${LIMIT}, so an open one may lie past them` };
      return { states };
    } catch {
      return { reason: `cannot read its pull requests: gh printed no list` };
    }
  }

  /** Why a process keeps `path`, or null when lsof shows none uses it. */
  inUse(path) {
    const r = call('lsof', ['-F', 'p', '+D', path]);
    if (r.missing) return 'cannot check for processes: lsof not found on PATH';
    if (r.error || r.silent) return `cannot check for processes: ${r.error ?? 'lsof did not answer'}`;
    const pids = r.stdout.split('\n').filter((line) => line.startsWith('p')).map((line) => line.slice(1));
    if (pids.length > 0) return `in use by pid ${[...new Set(pids)].join(', pid ')}`;
    if (r.stderr) return `cannot check for processes: lsof wrote ${r.stderr.split('\n')[0]}`;
    if (r.status !== 0 && r.status !== 1) return `cannot check for processes: lsof exited ${r.status}`;
    return null;
  }

  /** Why `entry` holds a worktree of another checkout, or null: a `.git` file anywhere in it naming a git dir outside it. */
  foreignWorktree(entry) {
    const walk = (dir) => {
      let found = null;
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.name === '.git' && item.isFile()) {
          const gitdir = /^gitdir: (.*)$/m.exec(readFileSync(path, 'utf8'))?.[1];
          if (gitdir && !within(entry, real(resolve(dir, gitdir)))) return `${dir} is a worktree of another checkout`;
        } else if (item.isDirectory()) {
          found = walk(path);
          if (found) return found;
        }
      }
      return found;
    };
    return walk(entry);
  }

  /** Why the maker's clone at `dir` holds local-only work, or null. */
  localWork(dir) {
    const git = (...args) => call('git', ['-C', dir, ...args]);
    const status = git('status', '--porcelain', '--untracked-files=all');
    if (status.status !== 0) return `cannot read its clone: ${status.stderr || status.error}`;
    if (status.stdout.trim()) return 'its clone holds uncommitted work';
    const stash = git('stash', 'list');
    if (stash.status !== 0) return `cannot read its stash: ${stash.stderr || stash.error}`;
    if (stash.stdout.trim()) return 'its clone holds a stash entry';
    const worktrees = git('worktree', 'list', '--porcelain');
    if (worktrees.status !== 0) return `cannot list its worktrees: ${worktrees.stderr || worktrees.error}`;
    for (const line of worktrees.stdout.split('\n')) {
      if (line.startsWith('worktree ') && !within(dir, real(line.slice('worktree '.length)))) return `its git worktree list names a worktree outside it, ${line.slice('worktree '.length)}`;
    }
    const remote = call('git', ['-C', dir, 'ls-remote', 'origin'], { timeout: this.timeout });
    if (remote.silent) return `the read of the forge's refs did not answer within ${this.timeout / 1000} s`;
    if (remote.status !== 0) return `cannot read the forge's refs: ${remote.stderr || remote.error}`;
    const advertised = [...new Set(remote.stdout.split('\n').map((line) => line.split('\t')[0]).filter(Boolean))];
    const present = spawnSync('git', ['-C', dir, 'cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: advertised.join('\n') + '\n', encoding: 'utf8' });
    const held = present.stdout.split('\n').filter((line) => line.endsWith(' commit')).map((line) => `^${line.split(' ')[0]}`);
    const heads = git('rev-parse', '--verify', '-q', 'HEAD').status === 0 ? ['HEAD'] : [];
    const unheld = spawnSync('git', ['-C', dir, 'rev-list', '--branches', '--tags', ...heads, '--stdin'], { input: held.join('\n') + '\n', encoding: 'utf8' });
    if (unheld.status !== 0) return `cannot list its commits: ${unheld.stderr.trim()}`;
    if (unheld.stdout.trim()) return `its clone holds a commit the forge does not hold, ${unheld.stdout.split('\n')[0]}`;
    return null;
  }

  /** Decides one matching entry, removing it unless listing; returns removed, KEPT_OPEN, KEPT or FAILED. */
  entry(name, kind, number) {
    const path = join(this.root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return this.leave(path, 'a symbolic link, its target untouched');
    if (!stat.isDirectory()) return this.leave(path, 'not a directory');
    if (kind === 'tmp') {
      const clone = this.outcome.get(`codex-${number}`);
      if (clone !== undefined && clone !== 'removed') return this.keep(path, `codex-${number} is kept`);
    }
    const read = this.pulls(kind === 'judge' ? 'judge' : 'maker', number);
    if (read.reason) return this.keep(path, read.reason);
    if (read.states.length === 0) return this.keep(path, 'no pull request serves it');
    if (read.states.some((state) => state === 'OPEN')) return this.keep(path, 'a pull request it serves is open', true);
    if (read.states.some((state) => state !== 'MERGED' && state !== 'CLOSED')) return this.keep(path, `a pull request it serves is ${read.states.join(', ')}`);
    const used = this.inUse(path);
    if (used) return this.keep(path, used);
    const foreign = this.foreignWorktree(path);
    if (foreign) return this.keep(path, foreign);
    if (kind === 'maker') {
      const work = this.localWork(path);
      if (work) return this.keep(path, work);
    }
    process.stdout.write(`${path}\n`);
    if (this.list) return 'removed';
    const removal = call('rm', ['-rf', '--', path]);
    if (removal.status === 0) return 'removed';
    process.stderr.write(`sweep: could not remove ${path}: ${removal.stderr?.split('\n')[0] || removal.error || `rm exited ${removal.status}`}\n`);
    this.worst = 3;
    return FAILED;
  }

  run() {
    for (const name of readdirSync(this.root).sort()) {
      const pattern = PATTERNS.find(({ match }) => match.test(name));
      if (!pattern) continue;
      const number = pattern.match.exec(name)[1];
      this.outcome.set(name, this.entry(name, pattern.kind, number));
    }
    return this.worst;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--list')) fail('usage: node tools/coordinator/sweep.mjs [--list]');
  const given = process.env.RIGGER_WORKTREE_ROOT || join(process.env.HOME, 'GitHub', 'rigger-worktrees');
  let root;
  try { root = realpathSync.native(given); } catch (error) { fail(`cannot read the root ${given}: ${error.message}`); }
  const configPath = process.env.RIGGER_CONFIG || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rigger.config.mjs');
  let config;
  try { config = (await import(pathToFileURL(resolve(configPath)).href)).default; } catch (error) { fail(`cannot read the config ${configPath}: ${error.message}`); }
  const repo = config?.repo;
  const topic = config?.worktrees?.topic;
  if (typeof repo !== 'string' || !repo) fail(`the config ${configPath} names no repo`);
  if (typeof topic !== 'string' || !topic.includes('{number}')) fail(`the config ${configPath} names no worktrees.topic holding {number}`);
  const seconds = Number(process.env.SWEEP_READ_TIMEOUT || 60);
  if (!(seconds > 0)) fail(`SWEEP_READ_TIMEOUT must be a positive number of seconds, not ${process.env.SWEEP_READ_TIMEOUT}`);
  const sweep = new Sweep({ root, repo, topic, list: args[0] === '--list', timeout: seconds * 1000 });
  process.exitCode = sweep.run();
}

await main();
