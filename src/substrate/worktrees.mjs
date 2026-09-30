// ABOUTME: L0's workspace adapter: makes a git worktree on a branch from the main line, removes one,
// answers whether a path is a worktree of the repository and what git lists for it, unlocks one,
// and answers whether git accepts a name as a literal branch name.
// Every git call it makes runs one at a time.

import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

/**
 * How many times L0 tries a fetch that another process's fetch beats to the remote-tracking ref,
 * before it gives up (architect ruling 7, section 5). A judgment, not a measurement. Its premise is
 * #426 (M3-S1)'s report: in every round of fetches at once, at least one succeeded, and the loser
 * failed because the winner had already moved the ref, so a second try finds nothing left to race
 * unless a third fetch starts meanwhile. Three tries allow for that third.
 */
export const FETCH_TRIES = 3;

/**
 * Git's words for a fetch another process's fetch beat to a remote-tracking ref, and the ref.
 *
 * A copy of git's answer (`D16` rule 2), tied to git by `test/worktrees.test.mjs`, which has the
 * real git print the refusal. Measured with git 2.54.0 and the `files` ref backend: a fetch that
 * lost the race exits 1 with `error: cannot lock ref 'refs/remotes/origin/main': is at <sha> but
 * expected <sha>` (#426 (M3-S1)'s report, "Failures, quoted"), and `git update-ref` moving a ref
 * from a value it does not hold prints the same clause after `fatal: update_ref failed for ref
 * '<ref>': `. Where git words it otherwise, such as under the `reftable` backend, which was not
 * measured, the race is not retried and the fetch rejects with git's own words.
 */
const RACED = /cannot lock ref '(refs\/remotes\/[^']+)': is at \S+ but expected \S+/;

/**
 * The lock reason `git worktree add` writes while it makes a worktree, and takes away once it has.
 *
 * A copy of git's answer (`D16` rule 2), tied to git by `test/worktrees.test.mjs`, which has git
 * list a worktree while `git worktree add` is making it. Measured with git 2.54.0 (Apple Git-157)
 * on 2026-09-30, by a smudge filter reading the worktree's administrative files mid-add: the file
 * `.git/worktrees/<name>/locked` held the 13 bytes `initializing\n`, under `LANG` `en_US.UTF-8` and
 * again under `de_DE.UTF-8`, and `git worktree list --porcelain` printed `locked initializing`. That
 * build printed its own messages in English under `de_DE.UTF-8` too, so whether a git that
 * translates its messages writes other words is unmeasured. Where it does, the lock reads as a
 * person's, and the attempt fails naming it rather than unlocking it.
 */
export const ADDING = 'initializing';

/** The remote whose default branch is the main line. */
const ORIGIN = 'origin';

/**
 * The tail of the one queue every git call this module makes waits in, whatever repository it is
 * on. A call waits for the one before it to settle, however it settled.
 *
 * One queue for the process, rather than one per repository, because a repository has as many
 * paths as it has working trees, and asking git which repository a path belongs to, by its common
 * directory, is itself a git call no queue would yet hold. One engine runs per repository (`D11`),
 * so the one queue holds that repository's calls alone. It reverses on a process serving several
 * repositories, whose calls would then wait on one another's.
 */
let tail = Promise.resolve();

/** Runs `step` once every call queued before it has settled, and settles as it does. */
function queued(step) {
  const ran = tail.then(step);
  tail = ran.then(() => {}, () => {});
  return ran;
}

/**
 * The adapter over the repository whose working tree is at `repository`. Every git call it makes
 * runs through L0's process adapter under `gitEnvironment()`, in `repository`, as `git`, for at
 * most `timeout` milliseconds, with its kills recorded through `emitter`.
 */
export function workspaces({ repository, emitter, git = 'git', timeout = GIT_TIMEOUT }) {
  /** Runs git with `args`, one call at a time, and hands back its result. */
  const call = (args) => queued(async () => {
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
   * Fetches `branch` from `origin`, trying again, up to `FETCH_TRIES` tries in all, where another
   * process's fetch beat this one to the remote-tracking ref, and recording each retry.
   *
   * Naming the branch still updates its remote-tracking ref where the remote's fetch refspec
   * covers it, measured with git 2.54.0, so an agent's own fetch in its worktree races this one on
   * that ref, which no queue here can hold. `--no-write-fetch-head` leaves `FETCH_HEAD` alone.
   */
  const fetched = async (branch) => {
    const args = ['fetch', '--no-write-fetch-head', ORIGIN, `refs/heads/${branch}`];
    for (let tries = 1; ; tries += 1) {
      const result = await call(args);
      if (result.exit === 0 && !result.timedOut) return;
      const ref = result.timedOut ? undefined : RACED.exec(result.stderr)?.[1];
      if (ref === undefined) throw failed(git, result, timeout);
      if (tries === FETCH_TRIES) {
        throw new Error(`\`${[git, ...args].join(' ')}\` lost the race for ${ref} to another process's fetch on all ${FETCH_TRIES} tries: ${firstLine(result.stderr)}`);
      }
      emitter.emit('fetch.retried', { ref, tries });
    }
  };

  /**
   * The main line: the branch `origin`'s `HEAD` names as the call begins, and the commit it holds,
   * fetched into this repository.
   *
   * Asked of `origin` rather than read off `refs/remotes/origin/HEAD`, which a clone writes once
   * and never moves, and which a repository need not hold at all.
   *
   * Measured with git 2.54.0: `git ls-remote --symref origin HEAD` prints `ref: refs/heads/<branch>`
   * and `<sha>`, each followed by a tab and `HEAD`, and where `origin`'s `HEAD` is detached it
   * prints the second line alone, which this rejects as naming no main line. The commit is the one
   * `origin` answered with, which the fetch after it brings.
   */
  const fetchMainLine = async () => {
    const printed = await answer(['ls-remote', '--symref', ORIGIN, 'HEAD']);
    const named = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(printed);
    const held = /^([0-9a-f]+)\tHEAD$/m.exec(printed);
    if (!named || !held) throw new Error(`\`${git} ls-remote --symref ${ORIGIN} HEAD\` named no branch for ${ORIGIN}'s HEAD, so there is no main line: ${JSON.stringify(printed)}`);
    const branch = named[1];
    await fetched(branch);
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
      // `-B` makes the branch where it is missing and resets it where it exists, and `--no-track`
      // writes no upstream, so the repository's shared config is not written: measured with git
      // 2.54.0, the config is byte-identical after. Git can differ from what this assumes in two
      // ways #426 (M3-S1)'s report measured: an add that fails, as onto an occupied directory, has
      // already made or moved the branch, and an add racing another process's add can fail
      // reading that worktree's administrative files, exiting 128. Neither is retried.
      await answer(['worktree', 'add', '--quiet', '--no-track', '-B', branch, path, commit]);
    },

    /**
     * Removes the workspace at `path`, its directory and its registration, whatever an attempt
     * left in it. `--force` removes a worktree holding changes or untracked files, which git
     * otherwise refuses. Git itself refuses the repository's main working tree, exiting 128 with
     * `fatal: '<path>' is a main working tree`, and forgets a registered worktree whose directory
     * is already gone, exiting 0.
     */
    async remove(path) {
      await answer(['worktree', 'remove', '--force', path]);
    },

    /**
     * Whether `path` is a linked worktree of this repository: whether git, asked in `path`, finds
     * `path` the top of a working tree whose common directory is this repository's, and whose own
     * git directory is not that common directory, which is how the main working tree answers.
     *
     * Asked of what is at the path now, never read off `git worktree list`: git keeps listing a
     * worktree whose directory was deleted, and a locked one is never marked `prunable`, so a
     * plain directory, or another repository's worktree, made at a listed path would read as one.
     *
     * Measured with git 2.54.0, `git rev-parse --path-format=absolute --show-toplevel --git-dir
     * --git-common-dir` prints the three paths a line each. In the main working tree the git
     * directory and the common directory are one; in a linked worktree the git directory is
     * `<common>/worktrees/<name>`; in a directory below either, the top level is the worktree's,
     * not the directory's; outside every repository git exits 128 with `fatal: not a git
     * repository (or any of the parent directories): .git`. Every non-zero exit there is read as
     * no, so a path git cannot answer for is never taken for a workspace; a timeout rejects. A
     * path holding a newline would split the answer, and so is read as no.
     */
    async isWorktree(path) {
      const real = realOrNothing(path);
      if (real === undefined || !statSync(real).isDirectory()) return false;
      const own = (await answer(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
      const there = await call(['-C', real, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']);
      if (there.timedOut) throw failed(git, there, timeout);
      if (there.exit !== 0) return false;
      const [top, gitDirectory, common] = there.stdout.split('\n').map(realOrNothing);
      return top === real && common === realOrNothing(own) && common !== undefined && gitDirectory !== common;
    },

    /**
     * What git lists for the worktree registered at `path`, compared by real path, or nothing
     * where it lists none: the branch it has checked out, whether its `HEAD` is detached, and the
     * reason it is locked, an empty one for a lock given none, or nothing where it is not locked.
     *
     * Read from `git worktree list --porcelain -z`, which git lists whether or not the directory
     * is still there. Measured with git 2.54.0: each worktree is a run of NUL-ended fields, `worktree
     * <path>`, `HEAD <sha>`, then `branch refs/heads/<name>` or `detached`, then `locked` or
     * `locked <reason>` where it is locked and `prunable <reason>` where its directory is gone, the
     * run ended by a second NUL. The path is git's absolute one, which a registration whose
     * directory is gone keeps, so both are compared by the real path of what is left of them.
     */
    async registration(path) {
      const listed = await answer(['worktree', 'list', '--porcelain', '-z']);
      const wanted = realOrLeft(path);
      for (const record of listed.split('\0\0')) {
        const fields = record.split('\0').filter((field) => field !== '');
        const at = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
        if (at === undefined || realOrLeft(at) !== wanted) continue;
        const branch = fields.find((field) => field.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length);
        const lock = fields.find((field) => field === 'locked' || field.startsWith('locked '));
        return { branch, detached: fields.includes('detached'), locked: lock === undefined ? undefined : lock.slice('locked '.length) };
      }
      return undefined;
    },

    /** Takes away the lock on the worktree registered at `path`, whether or not its directory is there. */
    async unlock(path) {
      await answer(['worktree', 'unlock', path]);
    },

    /**
     * The real path of the top of the working tree git finds for the path this adapter was handed,
     * which, for a directory below a worktree, is the worktree's, not the directory's.
     */
    async topLevel() {
      return realpathSync((await answer(['rev-parse', '--path-format=absolute', '--show-toplevel'])).replace(/\n$/, ''));
    },

    /**
     * Whether git accepts `name` as a literal branch name, and where it does not, why (`D16` rule
     * 1: git owns what a valid branch name is). A literal name is one git accepts and prints back
     * unchanged: this compares git's printed name with the name asked, and copies no rule of git's
     * (the architect's ruling 9 on #423).
     *
     * Measured with git 2.54.0, run in the repository: `rigger-1` exits 0 printing `rigger-1`, and
     * `rigger-1.lock` exits 128 with `fatal: 'rigger-1.lock' is not a valid branch name`. Git's
     * answer differs from the name asked where it expands previous-checkout syntax: `@{-1}`, with
     * `owner-feature` the previous checkout, exits 0 printing `owner-feature`, and `@{-3}`, with
     * fewer previous checkouts, exits 128. `@` exits 0 printing `@`, so it is a literal name there,
     * which `git worktree add -B @` makes as `refs/heads/@`. Any non-zero exit is read as a refusal,
     * so a git that fails for another reason answers no with its own words; one the timeout ended
     * rejects.
     */
    async acceptsBranch(name) {
      const result = await call(['check-ref-format', '--branch', name]);
      if (result.timedOut) throw failed(git, result, timeout);
      if (result.exit !== 0) return { accepted: false, why: firstLine(result.stderr) };
      const printed = result.stdout.replace(/\n$/, '');
      if (printed !== name) return { accepted: false, why: `git expands ${name} to ${printed}, so it is not a literal branch name` };
      return { accepted: true };
    },
  };
}

/** `path`'s real path, or nothing where no file is there to resolve. */
function realOrNothing(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * `path`'s real path, or, where nothing is there, the real path of its parent joined to its name,
 * or `path` itself where neither resolves: so a path whose directory is gone still compares by the
 * real path of what is left of it.
 */
function realOrLeft(path) {
  return realOrNothing(path) ?? (realOrNothing(dirname(path)) === undefined ? path : join(realOrNothing(dirname(path)), basename(path)));
}

/** The failure for a git call that exited non-zero or that its timeout ended. */
function failed(git, { args, exit, timedOut, stderr }, timeout) {
  const command = `\`${[git, ...args].join(' ')}\``;
  if (timedOut) return new Error(`${command} ran past its timeout of ${timeout} ms, and L0 ended it`);
  return new Error(`${command} exited ${exit}: ${firstLine(stderr)}`);
}

/** The first line of `text` holding anything but blanks. */
const firstLine = (text) => text.split('\n').find((line) => line.trim() !== '') ?? '';
