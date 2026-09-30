// ABOUTME: L0's workspace adapter: makes a git worktree on a branch from the main line, removes one,
// answers whether a path is a worktree of the repository, and whether git accepts a branch name.
// Every git call it makes on one repository runs one at a time.

import { realpathSync } from 'node:fs';

import { gitEnvironment } from './git-environment.mjs';
import { runCommand } from './process.mjs';

/**
 * How long L0 lets one git call run before it kills the call's group, where the caller passes no
 * other value. A judgment, not a measurement. Its premise is #426 (M3-S1)'s report, which timed a
 * worktree's making at 57 ms and its removal at 51 ms on a clone of this repository, and a fetch
 * against a held commit at 57 ms (`docs/spikes/git-operations-at-once.md`). A fetch across a
 * network and a checkout of a large repository are unmeasured, so five minutes leaves them room,
 * while a git that hangs holds an attempt back by no more than five minutes.
 */
export const GIT_TIMEOUT = 300_000;

/** The remote whose default branch is the main line. */
const ORIGIN = 'origin';

/**
 * The tail of each repository's queue, by the real path of the repository its caller names. A
 * call waits for the one before it to settle, however it settled.
 */
const queues = new Map();

/** Runs `step` once every call queued before it on `key` has settled, and settles as it does. */
function queued(key, step) {
  const ran = (queues.get(key) ?? Promise.resolve()).then(step);
  const tail = ran.then(() => {}, () => {});
  queues.set(key, tail);
  tail.then(() => queues.get(key) === tail && queues.delete(key));
  return ran;
}

/**
 * The adapter over the repository whose working tree is at `repository`. Every git call it makes
 * runs through L0's process adapter under `gitEnvironment()`, in `repository`, as `git`, for at
 * most `timeout` milliseconds, with its kills recorded through `emitter`.
 */
export function workspaces({ repository, emitter, git = 'git', timeout = GIT_TIMEOUT }) {
  const key = realpathSync(repository);

  /** Runs git with `args`, one call at a time on this repository, and hands back its result. */
  const call = (args) => queued(key, async () => {
    const { exit, timedOut, stdout, stderr } = await runCommand({ command: git, args, cwd: repository, env: gitEnvironment(), timeout, emitter });
    return { args, exit, timedOut, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
  });

  /** Runs git with `args` and hands back what it printed, rejecting where it did not exit 0. */
  const answer = async (args) => {
    const result = await call(args);
    if (result.exit !== 0) throw failed(git, result, timeout);
    return result.stdout;
  };

  /**
   * The main line: the branch `origin`'s `HEAD` names as the call begins, and the commit it holds,
   * fetched into this repository.
   *
   * Asked of `origin` rather than read off `refs/remotes/origin/HEAD`, which a clone writes once
   * and never moves, and which a repository need not hold at all.
   */
  const fetchMainLine = async () => {
    const printed = await answer(['ls-remote', '--symref', ORIGIN, 'HEAD']);
    const named = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(printed);
    const held = /^([0-9a-f]+)\tHEAD$/m.exec(printed);
    if (!named || !held) throw new Error(`\`${git} ls-remote --symref ${ORIGIN} HEAD\` named no branch for ${ORIGIN}'s HEAD, so there is no main line: ${JSON.stringify(printed)}`);
    const branch = named[1];
    await answer(['fetch', '--no-write-fetch-head', ORIGIN, `refs/heads/${branch}`]);
    return { branch, commit: held[1] };
  };

  return {
    fetchMainLine,

    /** Makes a workspace at `path` with `branch` checked out at the main line's commit. */
    async make(path, branch) {
      const { commit } = await fetchMainLine();
      // A worktree whose directory was deleted without git stays registered, and git refuses to
      // check its branch out anywhere else, with `fatal: '<branch>' is already used by worktree
      // at '<path>'`, until a prune forgets it.
      await answer(['worktree', 'prune']);
      await answer(['worktree', 'add', '--quiet', '--no-track', '-B', branch, path, commit]);
    },
  };
}

/** The failure for a git call that exited non-zero or that its timeout ended. */
function failed(git, { args, exit, timedOut, stderr }, timeout) {
  const command = `\`${[git, ...args].join(' ')}\``;
  if (timedOut) return new Error(`${command} ran past its timeout of ${timeout} ms, and L0 ended it`);
  const first = stderr.split('\n').find((line) => line.trim() !== '') ?? '';
  return new Error(`${command} exited ${exit}: ${first}`);
}
