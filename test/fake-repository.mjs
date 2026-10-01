// ABOUTME: The fake repository the fake forge holds beside the fake board: its branches, the pull
// requests from them with their head SHAs, diffs and comments, and when an issue's body was last
// edited. Test-only, never imported from src/.

import { gitIn } from './git-repository.mjs';

/**
 * Everything the fake holds of one pull request. `head` is the branch it is from and `sha` that
 * branch's head commit, which every pull request is given. `base` is the branch it is into, `main`
 * where none is given, and `merged` whether it was merged, where it is open otherwise. `diff` is
 * the text the forge serves as its diff, empty where none is given; `declined` is the reason the
 * forge gives where it declines to serve one. `mergeBase` is the commit the forge compares its head
 * with, where none is given one the forge cannot answer. `comments` are `{ body, createdAt }`, oldest
 * first. `from` names another repository a fork's pull request is from, and is null for this
 * repository's own. `title` and `body` are what it was opened with.
 */
const PULL_FACTS = ['number', 'head', 'sha', 'base', 'merged', 'diff', 'declined', 'mergeBase', 'comments', 'from', 'title', 'body'];

/** A pull request as the fake holds it, with every fact it was not given at its default. */
function heldPull(pull) {
  const unmodelled = Object.keys(pull).filter((fact) => !PULL_FACTS.includes(fact));
  if (unmodelled.length > 0) throw new Error(`the fake repository does not hold a pull request's ${unmodelled.join(', ')}`);
  for (const fact of ['number', 'head', 'sha']) {
    if (pull[fact] === undefined) throw new Error(`the fake repository holds every pull request with its ${fact}, and was given one without`);
  }
  return { base: 'main', merged: false, diff: '', declined: null, mergeBase: null, comments: [], from: null, title: '', body: '', ...pull };
}

/**
 * A repository holding `branches`, by name, `pullRequests` as `PULL_FACTS` describes each, and
 * `edited`, the time each issue's body was last edited, keyed by issue number. By default it holds
 * no branch, no pull request and no edit, which is what the forge holds for a card nobody worked.
 *
 * Its `operations` are the forge adapter's repository reads, and nothing else is. `open` and
 * `comment` are what an agent does on the forge, and `pull` and `held` the fake gh's own controls.
 */
export function createFakeRepository({ branches = [], pullRequests = [], edited = {} } = {}) {
  const held = structuredClone({ branches, pullRequests: pullRequests.map(heldPull), edited });
  const pull = (number) => held.pullRequests.find((candidate) => candidate.number === number) ?? null;
  const known = (operation, number) => {
    const found = pull(number);
    if (!found) throw new Error(`the fake repository holds no pull request #${number}, so ${operation} has nothing to read`);
    return found;
  };
  const asAnswered = ({ number, sha, base }) => ({ number, head: sha, base });
  const operations = {
    readPullRequests: async (branch) => {
      const from = held.pullRequests.filter((candidate) => candidate.head === branch && candidate.from === null);
      return { open: from.filter((candidate) => !candidate.merged).map(asAnswered), merged: from.filter((candidate) => candidate.merged).map(asAnswered) };
    },
    readBranches: async (names) => Object.fromEntries(names.map((name) => [name, held.branches.includes(name)])),
    readEditedAt: async (number) => held.edited[number] ?? null,
    readDiff: async (number) => {
      const { declined, diff } = known('readDiff', number);
      if (declined) throw new Error(`the forge declines to serve pull request #${number}'s diff: ${declined}`);
      return diff;
    },
    readMergeBase: async (number) => {
      const { base, sha, mergeBase } = known('readMergeBase', number);
      if (mergeBase === null) throw new Error(`the fake repository holds no merge base for pull request #${number}`);
      return { base, head: sha, mergeBase };
    },
    readComments: async (number) => structuredClone(known('readComments', number).comments),
  };
  return {
    operations,
    /** Opens a pull request, `PULL_FACTS` as each is given, and holds its branch. */
    open: (opened) => {
      held.pullRequests.push(heldPull(opened));
      if (!held.branches.includes(opened.head)) held.branches.push(opened.head);
    },
    /** Adds the comment `body`, made at `createdAt`, to pull request `number`. */
    comment: (number, body, createdAt) => known('comment', number).comments.push({ body, createdAt }),
    /** Pull request `number` as the fake holds it, or null where it holds none. */
    pull: (number) => structuredClone(pull(number)),
    /** Everything the repository holds, in the form it was built from. */
    held: () => structuredClone(held),
  };
}

/** What the git run `read` printed, or null where git refused it. */
function orNull(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

/** The branches the bare repository at `origin` holds, by name, read as the fixture reads git. */
export const branchesIn = (origin) => (orNull(() => gitIn(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/')) ?? '').split('\n').filter(Boolean);

/** The head commit of `branch` in the repository at `origin`, or null where it holds no such branch. */
export const headIn = (origin, branch) => orNull(() => gitIn(origin, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`))?.trim() || null;

/**
 * What the forge computes for a pull request from `sha` into `base` in the repository at
 * `origin`: the merge base of the two, and the diff of `sha` against it, as `git diff` prints it.
 */
export function comparedIn(origin, base, sha) {
  const mergeBase = orNull(() => gitIn(origin, 'merge-base', `refs/heads/${base}`, sha))?.trim() || null;
  return { mergeBase, diff: mergeBase ? orNull(() => gitIn(origin, 'diff', mergeBase, sha)) ?? '' : '' };
}

/** The branch the repository at the working directory `cwd` has checked out, or null where none is. */
export const checkedOut = (cwd) => orNull(() => gitIn(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'))?.trim() || null;
