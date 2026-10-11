// ABOUTME: The fake repository the fake forge holds beside the fake board: its branches, and the pull
// requests from them with their head SHAs, diffs and comments. Test-only, never imported from src/.

import { gitIn } from './git-repository.mjs';
import { acceptanceDigest, composeMarker } from '../src/workflow/marker.mjs';

/** A marker comment at a card's acceptance and pull-request head, with the requested ruling. */
export function markerComment({ card, pull, head, body, role = 'reviewer', provider = role === 'owner' ? undefined : 'claude', createdAt = '2026-10-01T11:00:00Z', ...ruling }) {
  return {
    body: composeMarker({ card, pull, head, digest: acceptanceDigest(body), role, provider, verdict: 'sound', items: ['met'], coverage: 'covered', ...ruling }, `Ruled, by ${role}`),
    createdAt,
  };
}

/**
 * Everything the fake holds of one pull request. `head` is the branch it is from and `sha` that
 * branch's head commit, which every pull request is given. `base` is the branch it is into, `main`
 * where none is given, and `merged` whether it was merged, where it is open otherwise. `diff` is
 * the text the forge serves as its diff, empty where none is given; `declined` is the reason the
 * forge gives where it declines to serve one. `mergeBase` is the commit the forge compares its head
 * with, where none is given one the forge cannot answer. `comments` carry body, creation time,
 * identity, author and edit fields, oldest first. `from` names another repository a fork's pull
 * request is from, and is null for this
 * repository's own. `title` and `body` are what it was opened with. `mergeable` is the forge's
 * mergeability answer, `unknown` where none is given, and `checks` each context's check state at
 * its head, by context, a required context it does not name being `absent`.
 */
const PULL_FACTS = ['number', 'head', 'sha', 'base', 'merged', 'diff', 'declined', 'mergeBase', 'comments', 'from', 'title', 'body', 'mergeable', 'checks'];

/** The SHA the fake's merge answers as the merge commit. */
const MERGE_SHA = 'e'.repeat(40);

/** The fields a comment read selects, filled as the fake forge gives an agent's comment. */
export function commentOf(comment, number, index) {
  return {
    body: comment.body,
    createdAt: comment.createdAt,
    id: comment.id ?? `IC_${number}_${index + 1}`,
    author: comment.author === undefined ? { login: 'rigger-fake' } : comment.author,
    lastEditedAt: comment.lastEditedAt ?? null,
    includesCreatedEdit: comment.includesCreatedEdit ?? false,
  };
}

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
 * A repository holding `branches`, by name, and `pullRequests` as `PULL_FACTS` describes each. By
 * default it holds no branch and no pull request, which is what the forge holds for a card nobody
 * worked. `rules` are the effective rules every base branch's required checks come from, as
 * `readEffectiveRules` answers them, none where none are given.
 *
 * Its `operations` are the forge adapter's repository reads, and nothing else is. `open` and
 * `comment` are what an agent does on the forge, `postComment` the repository-write side's comment
 * L2 makes, and `pull` and `held` the fake gh's own controls.
 */
export function createFakeRepository({ branches = [], pullRequests = [], rules, origin } = {}) {
  const held = structuredClone({ branches, pullRequests: pullRequests.map(heldPull) });
  const current = (candidate) => {
    if (candidate === undefined) return null;
    if (origin !== undefined && !candidate.merged) candidate.sha = headIn(origin, candidate.head) ?? candidate.sha;
    return candidate;
  };
  const pull = (number) => current(held.pullRequests.find((candidate) => candidate.number === number));
  const known = (operation, number) => {
    const found = pull(number);
    if (!found) throw new Error(`the fake repository holds no pull request #${number}, so ${operation} has nothing to read`);
    return found;
  };
  const asAnswered = (candidate) => {
    const { number, sha, base } = current(candidate);
    return { number, head: sha, base };
  };
  const operations = {
    readPullRequests: async (branch) => {
      const from = held.pullRequests.filter((candidate) => candidate.head === branch && candidate.from === null);
      return { open: from.filter((candidate) => !candidate.merged).map(asAnswered), merged: from.filter((candidate) => candidate.merged).map(asAnswered) };
    },
    readBranches: async (names) => Object.fromEntries(names.map((name) => [name, held.branches.includes(name)])),
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
    readMergeable: async (number) => known('readMergeable', number).mergeable ?? 'unknown',
    readCheckStates: async (sha, required) => {
      const checks = held.pullRequests.find((candidate) => current(candidate).sha === sha)?.checks ?? {};
      return Object.fromEntries(required.map(({ context }) => [context, checks[context] ?? { state: 'absent', creator: null }]));
    },
    readEffectiveRules: async () => structuredClone(rules ?? []),
    readComments: async (number) => structuredClone(known('readComments', number).comments.map((comment, index) => {
      const node = commentOf(comment, number, index);
      return { body: node.body, createdAt: node.createdAt, id: node.id, author: node.author?.login ?? null, permission: 'write', edited: node.lastEditedAt !== null || node.includesCreatedEdit };
    })),
  };
  /**
   * The forge adapter's comment write, beside the reads and never among them: posts `body` on pull
   * request `number` as the engine's account, which holds write access, at the next minute after
   * its newest comment, and answers the comment as the forge does, with its id.
   */
  const postComment = async (number, body) => {
    const { comments } = known('postComment', number);
    const newest = comments.at(-1)?.createdAt;
    const createdAt = new Date((newest === undefined ? Date.parse('2026-10-01T12:00:00Z') : Date.parse(newest)) + 60_000).toISOString().replace('.000Z', 'Z');
    const id = `IC_${number}_${comments.length + 1}`;
    comments.push({ body, createdAt, id, author: { login: 'rigger-engine' } });
    return { id, body };
  };
  // Every merge call L2 made, in order, and the answers a test scripted for the next ones.
  const merges = [];
  const scripted = [];
  /**
   * The forge's own merge of pull request `number` at `expectedHead`, answered as M5-04's
   * `mergePullRequest` maps the forge's answers: refused `head moved` where its head is not
   * `expectedHead`, `already merged` where it is merged, refused `unknown` or `conflict` where its
   * mergeability is unknown or conflicting, and otherwise merged, which the fake then holds.
   */
  const forgeMerge = async (number, expectedHead) => {
    const held = known('mergePullRequest', number);
    if (held.sha !== expectedHead) return { outcome: 'refused', reason: 'head moved' };
    if (held.merged) return { outcome: 'already merged', sha: MERGE_SHA };
    if ((held.mergeable ?? 'unknown') === 'unknown') return { outcome: 'refused', reason: 'unknown' };
    if (held.mergeable === 'conflicting') return { outcome: 'refused', reason: 'conflict' };
    held.merged = true;
    return { outcome: 'merged', sha: MERGE_SHA };
  };
  /**
   * The forge adapter's merge, beside the reads and never among them: records the call, then
   * answers as the next scripted answer says, or as `forgeMerge` does where none is scripted. A
   * scripted answer is a function handed `{ number, head, merge }`, `merge` being `forgeMerge` for
   * this call, so a script can hold, throw, merge and then throw, or answer a refusal of its own.
   */
  const mergePullRequest = async (number, expectedHead) => {
    merges.push({ number, head: expectedHead });
    const script = scripted.shift();
    const merge = () => forgeMerge(number, expectedHead);
    return script === undefined ? merge() : script({ number, head: expectedHead, merge });
  };
  return {
    operations,
    postComment,
    mergePullRequest,
    /** Has the next merge call answer as `script` says, as `mergePullRequest` describes. */
    answerMerge: (script) => scripted.push(script),
    /** Every merge call made so far, each `{ number, head }`, in order. */
    merges: () => structuredClone(merges),
    /** Sets what the forge holds of pull request `number`, as `PULL_FACTS` names each of `facts`. */
    update: (number, facts) => {
      const held = known('update', number);
      Object.assign(held, heldPull({ ...held, ...facts }));
    },
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
    held: () => structuredClone({ ...held, pullRequests: held.pullRequests.map(current) }),
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
