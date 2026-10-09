// ABOUTME: L0's workspace adapter: makes a branch worktree from main or a verified card head, or
// a detached worktree, removes one, and answers git questions about paths, branches and commits.
// Every git call it makes runs one at a time.

import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { gitEnvironment } from './git-environment.mjs';
import { EVENT_REFUSED, runCommand } from './process.mjs';

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
   * process's fetch beat this one to the remote-tracking ref, and recording each retry. A sink that
   * refuses that record rejects the call with an `EVENT_REFUSED` failure naming it as unrecorded,
   * and the fetch is not tried again.
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
      try {
        emitter.emit('fetch.retried', { ref, tries });
      } catch (cause) {
        const failure = new Error(`the sink refused L0's fetch.retried ${JSON.stringify({ ref, tries })}, so it went unrecorded, and L0 tried the fetch no more: ${cause.message}`, { cause });
        throw Object.assign(failure, { code: EVENT_REFUSED, unrecorded: [{ event: 'fetch.retried', ref, tries, cause }] });
      }
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
  /**
   * Each worktree `git worktree list --porcelain -z` lists: its path, `at`, as git holds it, the
   * branch it has checked out, whether its `HEAD` is detached, and the reason it is locked, an
   * empty one for a lock given none, or nothing where it is not locked. Measured with git 2.54.0:
   * each worktree is a run of NUL-ended fields, `worktree <path>`, `HEAD <sha>`, then `branch
   * refs/heads/<name>` or `detached`, then `locked` or `locked <reason>` where it is locked and
   * `prunable <reason>` where its directory is gone, the run ended by a second NUL.
   */
  const listed = async () => {
    const records = [];
    for (const record of (await answer(['worktree', 'list', '--porcelain', '-z'])).split('\0\0')) {
      const fields = record.split('\0').filter((field) => field !== '');
      const at = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
      if (at === undefined) continue;
      const branch = fields.find((field) => field.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length);
      const lock = fields.find((field) => field === 'locked' || field.startsWith('locked '));
      records.push({ at, branch, detached: fields.includes('detached'), locked: lock === undefined ? undefined : lock.slice('locked '.length) });
    }
    return records;
  };

  const fetchMainLine = async () => {
    const printed = await answer(['ls-remote', '--symref', ORIGIN, 'HEAD']);
    const named = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(printed);
    const held = /^([0-9a-f]+)\tHEAD$/m.exec(printed);
    if (!named || !held) throw new Error(`\`${git} ls-remote --symref ${ORIGIN} HEAD\` named no branch for ${ORIGIN}'s HEAD, so there is no main line: ${JSON.stringify(printed)}`);
    const branch = named[1];
    await fetched(branch);
    return { branch, commit: held[1] };
  };

  /** The commit the forge holds for `branch`, or a refusal naming a deleted branch. */
  const lineHead = async (branch) => {
    const ref = `refs/heads/${branch}`;
    const result = await call(['ls-remote', '--exit-code', ORIGIN, ref]);
    if (result.exit === 2 && !result.timedOut) throw new Error(`${ORIGIN}'s ${ref} was deleted`);
    if (result.exit !== 0 || result.timedOut) throw failed(git, result, timeout);
    const line = result.stdout.split('\n').find((each) => each.endsWith(`\t${ref}`));
    if (line === undefined) throw new Error(`${ORIGIN} named no head for ${ref}: ${JSON.stringify(result.stdout)}`);
    return line.split('\t')[0];
  };

  /**
   * Adds a worktree on `branch` at `commit`, resetting a local branch left by an attempt. A
   * registration whose directory was deleted must be pruned first. `-B` resets the branch where
   * it exists, and `--no-track` leaves the repository's shared config untouched. An add that
   * fails may already have moved the branch, and is not retried (#426, M3-S1).
   */
  const addAt = async (path, branch, commit) => {
    await answer(['worktree', 'prune']);
    await answer(['worktree', 'add', '--quiet', '--no-track', '-B', branch, path, commit]);
  };

  return {
    fetchMainLine,

    /** Makes a workspace at `path` with `branch` checked out at the main line's commit. */
    async make(path, branch) {
      const { commit } = await fetchMainLine();
      await addAt(path, branch, commit);
    },

    /** Fetches the card's forge line only while its head is the one L2 read. */
    async fetchLineAt(branch, expected) {
      const compare = async () => {
        const actual = await lineHead(branch);
        if (actual !== expected) throw new Error(`${ORIGIN}'s ${branch} moved from ${expected} to ${actual}`);
      };
      await compare();
      await fetched(branch);
      await compare();
      const kind = (await answer(['cat-file', '-t', expected])).trim();
      if (kind !== 'commit') throw new Error(`${ORIGIN}'s ${branch} at ${expected} names a ${kind}, not a commit`);
    },

    /** Makes the card's worktree at the already fetched forge head. */
    async makeAt(path, branch, commit) {
      await addAt(path, branch, commit);
    },

    /**
     * Makes a worktree at `path` with its `HEAD` detached at `commit`, making no branch.
     *
     * Measured with git 2.54.0 (Apple Git-157) on 2026-10-01, where git's answer can differ from
     * what L1 expects (`D16` rule 3). `--detach` makes no branch, and neither does a commit named by
     * its object name, so `git for-each-ref refs/heads` prints the same before and after. Git makes
     * every missing directory leading to `path`. Onto a directory that is there and not empty, it
     * exits 128 with `fatal: '<path>' already exists`; with a commit the repository does not hold,
     * it exits 128 with `fatal: invalid reference: <commit>` and makes no directory, not even the
     * leading ones. It names the worktree's administrative directory after `path`'s last name,
     * adding a number where one of that name is already registered, so two judges' `main` trees
     * never share one. Like `make`, it prunes first, since a registration whose directory was
     * deleted without git refuses an add at its path, exiting 128 with `fatal: '<path>' is a missing
     * but already registered worktree`. A registration locked with `initializing`, as a killed `git
     * worktree add` leaves it, is not pruned, and the add exits 128 with `fatal: '<path>' is a
     * missing but locked worktree`.
     */
    async makeDetached(path, commit) {
      await answer(['worktree', 'prune']);
      await answer(['worktree', 'add', '--quiet', '--detach', path, commit]);
    },

    /**
     * Whether the repository holds `commit` as a commit once it has fetched it from `origin`, and
     * where it does not, why. Git decides what names a commit (`D16` rule 1): `commit` is taken
     * only where git, asked to verify it, prints it back unchanged, so it is a full object name and
     * never a branch, an abbreviation or a refspec that a fetch could write a ref from.
     *
     * Measured with git 2.54.0 on 2026-10-01: `git rev-parse --verify` prints back any full-length
     * hexadecimal name in lower case whether or not the object is there, prints a branch's commit for
     * its name, and exits 1 for an abbreviation and for `main:refs/heads/x`. A fetch of a commit the
     * repository already holds exits 0 without asking `origin`; one `origin` holds, reachable from
     * any of its branches, is fetched under protocol version 2; one it does not hold exits 128 with
     * `fatal: remote error: upload-pack: not our ref <commit>`. A fetch that fails is read through
     * the check after it, so a commit held already is held whatever the fetch answered. That check is
     * `git cat-file -t`, which prints `commit` for a commit, `tag` for an annotated tag's own object,
     * which a peeling check such as `<name>^{commit}` would take for the commit it tags, and exits
     * 128 with `fatal: git cat-file: could not get object info` for an object the repository does not
     * hold. A timeout rejects.
     */
    async holdsAfterFetch(commit) {
      const named = await call(['rev-parse', '--verify', '--quiet', '--end-of-options', commit]);
      if (named.timedOut) throw failed(git, named, timeout);
      if (named.exit !== 0 || named.stdout.trim() !== commit) return { held: false, why: `git does not read ${commit} as a full object name` };
      const fetch = await call(['fetch', '--no-write-fetch-head', '--end-of-options', ORIGIN, commit]);
      if (fetch.timedOut) throw failed(git, fetch, timeout);
      const held = await call(['cat-file', '-t', '--end-of-options', commit]);
      if (held.timedOut) throw failed(git, held, timeout);
      if (held.exit === 0 && held.stdout.trim() === 'commit') return { held: true };
      if (held.exit === 0) return { held: false, why: `${commit} names a ${held.stdout.trim()}, not a commit` };
      return { held: false, why: fetch.exit === 0 ? `the repository does not hold ${commit}` : firstLine(fetch.stderr) };
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
     * Read from `git worktree list --porcelain -z`, as `listed` says, which git lists whether or
     * not the directory is still there. The path is git's absolute one, which a registration whose
     * directory is gone keeps, so both are compared by the real path of what is left of them.
     */
    async registration(path) {
      const wanted = realOrLeft(path);
      const held = (await listed()).find(({ at }) => realOrLeft(at) === wanted);
      return held === undefined ? undefined : { branch: held.branch, detached: held.detached, locked: held.locked };
    },

    /**
     * Every worktree of the repository git lists, its main worktree included, as `listed` reads
     * them: its path `at` as git holds it, its branch, whether its `HEAD` is detached, and the
     * reason it is locked.
     */
    async listing() {
      return listed();
    },

    /**
     * The path of every worktree of the repository git lists, its main worktree included, as git
     * lists it, whether or not its directory is still there. Read as `registration` reads them.
     */
    async registered() {
      return (await listed()).map(({ at }) => at);
    },

    /** Takes away the lock on the worktree registered at `path`, whether or not its directory is there. */
    async unlock(path) {
      await answer(['worktree', 'unlock', path]);
    },

    /**
     * The real path, by `realpath(3)`, of the top of the working tree git finds for the path this
     * adapter was handed, which, for a directory below a worktree, is the worktree's, not the
     * directory's.
     */
    async topLevel() {
      return realpathSync.native((await answer(['rev-parse', '--path-format=absolute', '--show-toplevel'])).replace(/\n$/, ''));
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

/**
 * `path`'s real path, or nothing where no file is there to resolve. The real path is the file
 * system's own, `realpath(3)`, in the case the disk holds: git prints paths in that case, while
 * Node's JavaScript `realpathSync` keeps the case it was handed, so on a volume that folds case
 * two spellings of one directory would compare as two.
 */
function realOrNothing(path) {
  try {
    return realpathSync.native(path);
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
