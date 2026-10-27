// ABOUTME: L1 makes and removes card directories, reads a maker's line tip, and lists and sweeps
// the provider's session folder after a dispatch settles.

import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import { within as underOrAt } from './run.mjs';
import { EVENT_REFUSED } from '../substrate/process.mjs';
import { ADDING, FETCH_FAILED as L0_FETCH_FAILED, LINE_DELETED as L0_LINE_DELETED, LINE_MOVED as L0_LINE_MOVED, workspaces } from '../substrate/worktrees.mjs';

/**
 * The `code` of the failure L1 rejects with when it could not make a card's workspace, so its
 * caller tells it from a command that ran, or never started, without reading the message.
 */
export const WORKSPACE_NOT_MADE = 'WORKSPACE_NOT_MADE';
export const WORKSPACE_REFUSED = 'WORKSPACE_REFUSED';
export const BRANCH_ELSEWHERE = 'BRANCH_ELSEWHERE';
export const SCRATCH_REFUSED = 'SCRATCH_REFUSED';
export const LINE_MOVED = 'LINE_MOVED';
export const LINE_DELETED = 'LINE_DELETED';
export const FETCH_FAILED = 'FETCH_FAILED';
export const BRANCH_REFUSED = 'BRANCH_REFUSED';
export const ROOT_NOT_ABSOLUTE = 'ROOT_NOT_ABSOLUTE';

/** A completed replace-rule check that refuses the path, distinct from a check that failed. */
const replacementRefused = (message, condition) => Object.assign(new Error(message), { code: 'REPLACEMENT_REFUSED', condition });

/** L1's report for a cause it met while making a card's workspace. */
function workspaceReport(cause) {
  if (cause.code === 'REPLACEMENT_REFUSED') return { code: WORKSPACE_REFUSED, requirement: 'R-WORK-13', condition: cause.condition };
  if ([BRANCH_ELSEWHERE, BRANCH_REFUSED, ROOT_NOT_ABSOLUTE].includes(cause.code)) return { code: cause.code };
  if (cause.code === L0_LINE_MOVED) return { code: LINE_MOVED };
  if (cause.code === L0_LINE_DELETED) return { code: LINE_DELETED };
  if (cause.code === L0_FETCH_FAILED) return { code: FETCH_FAILED };
  return { code: WORKSPACE_NOT_MADE };
}

/**
 * The name `topic` derives for `card`: the topic with each `{number}` replaced by the card's issue
 * number. It names both the card's workspace, directly under the root, and its branch.
 */
export const topicFor = (topic, card) => topic.replaceAll('{number}', String(card));

/**
 * The card whose name `topic` derives as `branch`, as `topicFor` derives it, or null where the
 * topic derives no card's name as that branch. An issue number has no leading zero, and every
 * `{number}` in the topic stands for the same one.
 */
export function cardOfBranch(topic, branch) {
  // The first `{number}` captures the card and each later one must repeat it. The repeat is a named
  // backreference, so a literal digit after it is never read as part of the reference's number.
  const [first, ...rest] = topic.split('{number}').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(`^${first}(?<card>[1-9][0-9]*)${rest.join('\\k<card>')}$`).exec(branch);
  return found === null ? null : Number(found.groups.card);
}

/**
 * The scratch base of card `card`, `<root>/scratch/<topic>`, under which `roleDispatch` makes each
 * role's scratch directory (the architect's ruling 19 on #467). Both makes answer it beside their
 * own paths, and neither creates it. No topic derives `scratch`, since every topic holds a digit.
 */
const scratchBase = (root, topic, card) => join(root, 'scratch', topicFor(topic, card));

/**
 * Makes card `card`'s workspace fresh from main when handed the card alone, or from its forge line
 * when handed `head` as L2 read it (`R-WORK-10`, `R-WORK-25`), and settles on its `path` and
 * `branch` (`R-WORK-3`), the card's scratch base as
 * `scratch` (`scratchBase`), and `repository` as it was handed (the architect's ruling 21 on #467).
 *
 * `root` is the absolute root the verb resolved (the architect's ruling 3, P3, on #423), `topic`
 * the rule naming the workspace and its branch, `repository` the working tree of the repository
 * Rigger works, which L0's adapter runs git in, and `sink` L5's, through which L1 records under
 * the card a workspace made, one removed, and one that could not be made (ruling 1, A8).
 *
 * Whatever is at the workspace's path, asked of what is there now through any symbolic link, is
 * replaced only where L0 finds it a linked worktree of the repository, not its main working tree,
 * with exactly the card's branch checked out, not the worktree whose top level git reports for
 * `repository`, the worktree L1 was handed, and holding inside it, by real path, no other worktree
 * git lists for the repository, the handed one included. Anything else there fails the attempt
 * naming the path, before any git call that could write, so neither it nor the branch is changed
 * (`R-WORK-13` to `R-WORK-17`; the architect's ruling 9 on #423). Before any of that, L1 asks L0 whether git
 * accepts the card's own derived name as a literal branch name. A workspace that passes is made
 * removable, as `writable` says, and removed; where nothing is at the path, a stale registration
 * there locked by `git worktree add` is unlocked, as `unlockedIfAdding` says. For a continuing
 * attempt, L1 checks that the branch is checked out nowhere else and asks L0 to verify and fetch
 * the forge head before removal. L0 then makes the workspace on the branch at main or `head`,
 * resetting the branch where it exists.
 *
 * An unanswered check or make rejects with `WORKSPACE_NOT_MADE`; an answered replace-rule refusal
 * rejects with `WORKSPACE_REFUSED`. A branch checked out elsewhere rejects with
 * `BRANCH_ELSEWHERE`; a moved or deleted forge line with `LINE_MOVED` or `LINE_DELETED`; a failed
 * forge read with `FETCH_FAILED`; and a refused branch name or nonabsolute root with
 * `BRANCH_REFUSED` or `ROOT_NOT_ABSOLUTE`. Each names its path and reason after L1 records the
 * failure. Where the sink refused any event on the way, L0's, L1's record of the
 * failure, or its record of a workspace made or removed, though the workspace was made or
 * removed, it rejects with `EVENT_REFUSED` instead, naming each such event as unrecorded: a
 * refused event is the halt, not a workspace L1 could not make, so L2 spends no attempt on it (the
 * owner's O4 on #423).
 */
export async function makeWorkspace({ root, topic, card, head, repository, sink, timeout }) {
  const events = sink.emitter({ layer: 'L1', card });
  const branch = topicFor(topic, card);
  const path = join(root, branch);
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }), timeout, rejectFailedChecks: true });
  /** Runs `work`, rejecting as a workspace L1 could not make where it rejects. */
  const step = async (work) => {
    try {
      return await work();
    } catch (cause) {
      throw notMade(events, `card #${card}'s workspace`, { path }, cause, workspaceReport(cause));
    }
  };
  const removed = await step(async () => {
    if (!isAbsolute(root)) throw Object.assign(new Error(`the root ${root} is not an absolute path, and L1 is handed the root the verb resolved`), { code: ROOT_NOT_ABSOLUTE });
    const { accepted, why } = await adapter.acceptsBranch(branch);
    if (!accepted) throw Object.assign(new Error(`card #${card}'s topic \`${topic}\` derives ${branch}, which git refuses as a branch name: ${why}`), { code: BRANCH_REFUSED });
    if (head !== undefined) {
      const elsewhere = (await adapter.listing()).find((each) => each.branch === branch && nearestReal(each.at) !== nearestReal(path));
      if (elsewhere !== undefined) throw Object.assign(new Error(`${branch} is checked out at ${elsewhere.at}, not ${path}; R-WORK-25 refuses another worktree`), { code: BRANCH_ELSEWHERE });
    }
    return cleared({ adapter, card, branch, path, repository }, head === undefined ? undefined : () => adapter.fetchLineAt(branch, head));
  });
  if (removed !== undefined) recorded(events, card, 'workspace.removed', { path: removed });
  await step(() => head === undefined ? adapter.make(path, branch) : adapter.makeAt(path, branch, head));
  recorded(events, card, 'workspace.made', { path, branch });
  return { path, branch, scratch: scratchBase(root, topic, card), repository };
}

/** Reads the line tip the maker left in its linked workspace, through L0's queued git adapter. */
async function readWorkspaceTip({ card, path, branch, repository, sink }) {
  try {
    return await workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) }).tip(path, branch);
  } catch (cause) {
    if (cause.code === EVENT_REFUSED) throw cause;
    throw new Error(`card #${card}'s line of work has no readable tip in workspace ${path}: ${cause.message}`, { cause });
  }
}

/**
 * Makes the directory judge `role` of card `card` runs in, `<root>/judges/<topic>/<role>`, and
 * settles on its `path`, the card's scratch base as `scratch` (`scratchBase`), `repository` as it
 * was handed (ruling 21), and the paths of the two worktrees it holds, each at a detached commit:
 * `main` at the commit the main line held on `origin` as L1 made it, and `head` at `head`, the
 * pull request's head commit L1 was handed, fetched from `origin` (the owner's O3; ruling 1 Q3).
 *
 * L1 records under the card a `workspace.made` carrying `role`, the path and both commits, and a
 * `workspace.failed` carrying `role`, the path and why (ruling 2 P5). An answered replace-rule
 * refusal rejects with `WORKSPACE_REFUSED`; an unanswered check or failed make rejects with
 * `WORKSPACE_NOT_MADE`, naming the path and why. A refused event rejects with `EVENT_REFUSED`,
 * as `makeWorkspace` does.
 */
export async function makeJudgeDirectory({ root, topic, card, role, head, repository, sink }) {
  const events = sink.emitter({ layer: 'L1', card });
  const path = join(root, 'judges', topicFor(topic, card), role);
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) });
  const trees = { main: join(path, 'main'), head: join(path, 'head') };
  /** Runs `work`, rejecting as a judge's directory L1 could not make where it rejects. */
  const step = async (work) => {
    try {
      return await work();
    } catch (cause) {
      throw notMade(events, `judge ${role}'s directory for card #${card}`, { role, path }, cause,
        { code: cause.code === 'REPLACEMENT_REFUSED' ? WORKSPACE_REFUSED : WORKSPACE_NOT_MADE });
    }
  };
  const found = await step(() => judgeChecked({ adapter, path, repository }));
  const main = await step(async () => {
    const { commit } = await adapter.fetchMainLine();
    const { held, why } = await adapter.holdsAfterFetch(head);
    if (!held) throw new Error(`the repository does not hold the head commit ${head} after fetching it: ${why}`);
    return commit;
  });
  await step(() => judgeCleared(adapter, found));
  if (found.present) recorded(events, card, 'workspace.removed', { role, path });
  await step(async () => {
    await adapter.makeDetached(trees.main, main);
    await adapter.makeDetached(trees.head, head);
  });
  recorded(events, card, 'workspace.made', { role, path, main, head });
  return { path, ...trees, scratch: scratchBase(root, topic, card), repository };
}

/**
 * Makes role `role`'s scratch directory of card `card`, `<base>/<role>`, fresh, and settles on its
 * path (the architect's ruling 19 on #467). `base` is the card's scratch base, which L1's makes
 * answer (`scratchBase`), and which this makes where it does not exist yet.
 *
 * A directory already there is removed first, without following any symbolic link inside it, once
 * `scratchReplaceable` has passed what is there. L1
 * records under the card a `workspace.removed` and a `workspace.made`, each carrying `role` and
 * the path, and a `workspace.failed` carrying them and why. An answered replace-rule refusal
 * rejects with `SCRATCH_REFUSED`; an unanswered check or make rejects with `WORKSPACE_NOT_MADE`.
 * Each names the path and why. A refused sink event rejects with `EVENT_REFUSED`, as in
 * `makeWorkspace`.
 */
export async function makeScratch({ base, role, card, repository, sink }) {
  const events = sink.emitter({ layer: 'L1', card });
  const path = join(base, role);
  const step = async (work) => {
    try {
      return await work();
    } catch (cause) {
      const report = cause.code === 'REPLACEMENT_REFUSED'
        ? { code: SCRATCH_REFUSED, requirement: 'R-WORK-26', condition: cause.condition }
        : { code: WORKSPACE_NOT_MADE };
      throw notMade(events, `role ${role}'s scratch directory for card #${card}`, { role, path }, cause, report);
    }
  };
  const there = await step(() => scratchReplaceable({ base, path, repository, adapter: workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) }) }));
  if (there) {
    await step(async () => {
      writable(path);
      rmSync(path, { recursive: true });
    });
    recorded(events, card, 'workspace.removed', { role, path });
  }
  await step(() => mkdirSync(path, { recursive: true }));
  recorded(events, card, 'workspace.made', { role, path });
  return path;
}

/** The complete scratch replace rule, shared by making a role directory and removing a merged card's. */
async function scratchReplaceable({ base, path, repository, adapter }) {
  noCheckoutAbove(base, path);
  const there = scratchChecked(base, path);
  await unregistered({ path, there, repository, adapter });
  if (there) {
    const checkout = checkoutIn(path);
    if (checkout !== undefined) throw replacementRefused(`${path} holds ${checkout}, a git checkout, which may be a worktree of another repository, so L1 leaves it as it is`, 'R-WORK-28');
  }
  return there;
}

/**
 * Fails naming `path` and a `.git` where one is, of any kind and unfollowed, at any ancestor of
 * `path` from its parent, the scratch base `base`, up to the file system's root, as written and as
 * the real path of the nearest existing one reads: then `path` lies in a checkout, of this
 * repository or another, and L1 makes and removes nothing there, since the scratch directory lies
 * outside every worktree. The real path's ancestors are walked too, so a root reached through a
 * symbolic link into a checkout is found. An ancestor where L1 cannot read whether a `.git` is
 * there fails too, as does a real path L1 cannot resolve for any reason but absence, since L1
 * cannot tell. So an operator whose home directory is a checkout is refused, naming that `.git`.
 */
function noCheckoutAbove(base, path) {
  noCheckoutFrom(base, path);
  let real;
  try {
    real = nearestReal(base);
  } catch (error) {
    throw new Error(`${path} lies under ${base}, whose real path L1 cannot resolve, so it cannot tell ${path} lies in no checkout: ${error.message}`, { cause: error });
  }
  if (real !== base) noCheckoutFrom(real, path);
}

/** `noCheckoutAbove`'s walk from `start` up to the file system's root, for `path`. */
function noCheckoutFrom(start, path) {
  for (let ancestor = start; ; ancestor = dirname(ancestor)) {
    const git = join(ancestor, '.git');
    let found = true;
    try {
      lstatSync(git);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`${path} lies under ${ancestor}, where L1 cannot read whether ${git} is there, so it cannot tell ${path} lies in no checkout: ${error.message}`, { cause: error });
      found = false;
    }
    if (found) throw replacementRefused(`${path} lies under ${ancestor}${realNamed(ancestor)}, which holds ${git}, so it lies in a git checkout, and L1 makes and removes nothing there`, 'R-WORK-28');
    if (dirname(ancestor) === ancestor) return;
  }
}

/** `path`'s real path as a failure adds it, where it differs from `path` and can be read. */
function realNamed(path) {
  try {
    const real = realpathSync.native(path);
    return real === path ? '' : ` (${real})`;
  } catch {
    return '';
  }
}

/**
 * Checks what is at a role's scratch directory, `path`, under the scratch base `base`, changing
 * nothing, and hands back whether a directory is there to replace. The worktree root's `scratch`
 * and the base must each be a directory, not a symbolic link, where they exist, so nothing L1
 * removes or makes lies elsewhere. At `path` must be nothing, or a directory, not a symbolic link,
 * whose real path resolves. Anything else fails naming the path, as does a path L1 cannot read,
 * since L1 cannot tell what is there. `scratchReplaceable` then asks git (`unregistered`) and walks the
 * directory (`checkoutIn`) before it removes anything.
 */
function scratchChecked(base, path) {
  for (const each of [dirname(base), base]) {
    const there = lstatOrAbsent(each);
    if (there === undefined) return false;
    if (!there.isDirectory()) throw notDirectory(each, there);
  }
  const there = lstatOrAbsent(path);
  if (there === undefined) return false;
  if (!there.isDirectory()) throw notDirectory(path, there);
  try {
    realpathSync.native(path);
  } catch (error) {
    throw new Error(`${path} cannot be resolved: ${error.message}`, { cause: error });
  }
  return true;
}

/**
 * Fails naming `path` and the worktree where git, asked through L0's workspace adapter `adapter`
 * over `repository`, lists a worktree, the main working tree included, that `path` is or lies in,
 * by the real path of `path` or, where it is not there yet, of its nearest existing parent; or,
 * where a directory is `there`, a worktree that lies in it (the architect's ruling 21 on #467). So
 * L1 makes and removes nothing in a worktree, and removes none. Registration is git's fact (`D16`
 * rule 1), so a worktree whose `.git` was moved aside is still found. A registration whose
 * directory is gone lies nowhere; one L1 cannot resolve for any other reason fails, since L1 cannot
 * tell where it lies.
 *
 * Where it can be wrong (`D16` rule 3): this git lists only this repository's worktrees, and
 * `checkoutIn`, the second check, finds another repository's only by its `.git`. So a worktree of
 * another repository whose `.git` was moved aside is found by neither, and is removed.
 */
async function unregistered({ path, there, repository, adapter }) {
  const real = nearestReal(path);
  for (const listed of await adapter.registered()) {
    let tree;
    try {
      tree = realpathSync.native(listed);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`${path} may lie in or hold the worktree git lists at ${listed}, which L1 could not resolve, so L1 leaves it as it is: ${error.message}`, { cause: error });
    }
    if (underOrAt(real, tree)) throw replacementRefused(`${path} lies in ${listed}, a worktree git registers for the repository at ${repository}, so L1 makes and removes nothing there`, 'R-WORK-29');
    if (there && underOrAt(tree, real)) throw replacementRefused(`${path} holds ${listed}, a worktree git registers for the repository at ${repository}, so L1 leaves it as it is`, 'R-WORK-29');
  }
}

/**
 * The real path of `path`, or, where nothing is there, its nearest existing parent's joined to
 * the rest of it. Any failure but absence throws, so L1 cannot take an unreadable path for absent.
 */
function nearestReal(path) {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(nearestReal(dirname(path)), basename(path));
  }
}

/** The failure for `path`, which `lstat` read as `there`, no directory: a symbolic link, which is never followed, or anything else. */
const notDirectory = (path, there) => replacementRefused(`${path} is ${there.isSymbolicLink() ? 'a symbolic link' : 'not a directory'}, so L1 leaves it as it is`, 'R-WORK-27');

/** What `lstat` reads at `path`, or nothing where nothing is there; anything else unreadable throws naming it. */
function lstatOrAbsent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`${path} cannot be read: ${error.message}`, { cause: error });
  }
}

/** The directory identity used to refuse a sweep if its path now names another directory. */
function folderIdentity(path) {
  const real = realpathSync.native(path);
  const held = statSync(real, { bigint: true });
  if (!held.isDirectory()) throw new Error(`${path} is not a directory`);
  return { real, device: String(held.dev), inode: String(held.ino) };
}

/** Paths already under a folder, read without following any link. */
function pathsInFolder(path, found = new Set(), prefix = '') {
  for (const name of readdirSync(path).sort()) {
    const relativePath = prefix === '' ? name : join(prefix, name);
    const at = join(path, name);
    const held = lstatOrAbsent(at);
    if (held === undefined) throw new Error(`${at} disappeared while its folder was listed`);
    found.add(relativePath);
    if (held.isDirectory()) pathsInFolder(at, found, relativePath);
  }
  return found;
}

/** Lists a CLI folder before its command starts, or names why no later removal is safe. */
export function listCliFolder({ home, name }) {
  if (typeof home !== 'string' || !isAbsolute(home)) return { reason: 'the session has no absolute configuration home' };
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes(sep)) {
    return { reason: `the adapter named no single folder segment: ${JSON.stringify(name)}` };
  }
  const path = join(home, 'projects', name);
  try {
    const held = lstatOrAbsent(path);
    if (held !== undefined) {
      if (!held.isDirectory()) return { path, reason: 'the folder is not a directory, so no listing followed it' };
      const root = folderIdentity(path);
      return { path, root, before: pathsInFolder(path) };
    }
    return { path, parent: folderIdentity(dirname(path)), before: new Set() };
  } catch (error) {
    return { path, reason: `the folder or its parent could not be read before the session: ${error.message}` };
  }
}

/** Removes entries absent from the listing, children first, without following any link. */
function removeAdded(path, relativePath, before, removeRoot, left) {
  let held;
  try {
    held = lstatOrAbsent(path);
    if (held === undefined) return;
    if (held.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        removeAdded(join(path, name), relativePath === '' ? name : join(relativePath, name), before, removeRoot, left);
      }
    }
    if (relativePath === '' ? removeRoot : !before.has(relativePath)) {
      if (held.isDirectory()) rmdirSync(path);
      else unlinkSync(path);
    }
  } catch (error) {
    left.push({ path, reason: `the added path could not be removed: ${error.message}` });
  }
}

/** Removes only new entries while the listed directory identity still holds. */
export function sweepCliFolder(listing) {
  if (listing.reason !== undefined) return [{ path: listing.path, reason: listing.reason }];
  const { path, parent, root, before } = listing;
  try {
    if (root !== undefined && lstatOrAbsent(path) === undefined) return [];
    const anchor = root === undefined ? dirname(path) : path;
    if (root === undefined && lstatOrAbsent(anchor) === undefined) return [];
    const expected = root ?? parent;
    const now = folderIdentity(anchor);
    if (now.real !== expected.real || now.device !== expected.device || now.inode !== expected.inode) {
      return [{ path, reason: 'the folder anchor is no longer the directory listed before the session' }];
    }
    const held = lstatOrAbsent(path);
    if (held === undefined) return [];
    if (!held.isDirectory()) return [{ path, reason: 'the new folder is not a directory, so no removal followed it' }];
    const left = [];
    removeAdded(path, '', before, root === undefined, left);
    return left;
  } catch (error) {
    return [{ path, reason: `the folder could not be removed: ${error.message}` }];
  }
}

/**
 * The first `.git` under the directory `path`, at any depth, or nothing where it holds none, read
 * in name order. No symbolic link is followed. A directory that cannot be read throws naming it,
 * since L1 cannot tell it holds no checkout, and nothing is changed to read it.
 */
function checkoutIn(path) {
  let names;
  try {
    names = readdirSync(path, { withFileTypes: true }).sort((one, other) => (one.name < other.name ? -1 : 1));
  } catch (error) {
    throw new Error(`${path} cannot be read, so L1 cannot tell it holds no git checkout, and leaves it as it is: ${error.message}`, { cause: error });
  }
  for (const entry of names) {
    const at = join(path, entry.name);
    if (entry.name === '.git') return at;
    if (entry.isDirectory()) {
      const found = checkoutIn(at);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Checks what is at a judge's directory, `path`, against `R-WORK-20` to `R-WORK-23`, making no git
 * call that writes, so a refusal changes nothing: no ref, no object, no file. It runs before any
 * fetch for that reason. It hands back the directory's real path, whether anything is there, the
 * worktrees in it, and the registrations L1 must unlock first.
 *
 * Nothing there passes. Otherwise the path must be a directory, not a symbolic link, and everything
 * in it a directory L0 finds a linked worktree of the repository, which git lists at a detached
 * commit, unlocked or locked with `ADDING`, the reason Rigger's own `git worktree add` writes while
 * it makes one (#423's ruling 9); neither the path nor anything inside it, by real path, may be the
 * worktree git reports for `repository`, the worktree L1 was handed; and git may list no other
 * worktree of the repository inside it. A registration inside it whose directory is gone passes
 * where it is unlocked, which the make's prune forgets, or detached and locked with `ADDING`, which
 * L1 unlocks; any other lock is a person's, and fails. Anything else fails naming the path, as does
 * a path whose real path or contents L1 cannot read, since L1 cannot tell what is there.
 *
 * Every path is compared by the file system's own real path, `realpath(3)`, on both sides, since
 * git keeps the spelling a worktree was added through and a volume that folds case answers to
 * either.
 */
async function judgeChecked({ adapter, path, repository }) {
  const leaves = (why, blocksDone = false) => Object.assign(replacementRefused(`${path} ${why}, so L1 leaves it as it is`), { blocksDone });
  /** `there`'s real path, or, where nothing is there, its parent's joined to its name. */
  const real = (there) => {
    try {
      return realpathSync.native(there);
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(there) === there) throw new Error(`${path} cannot be read at ${there}: ${error.message}`, { cause: error });
      return join(real(dirname(there)), basename(there));
    }
  };
  let there;
  try {
    there = lstatSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`${path} cannot be read: ${error.message}`, { cause: error });
  }
  if (there !== undefined && !there.isDirectory()) throw leaves('is not a directory');
  const own = real(path);
  let names = [];
  if (there !== undefined) {
    try {
      names = readdirSync(own);
    } catch (error) {
      throw new Error(`${path} cannot be read: ${error.message}`, { cause: error });
    }
  }
  const inside = (at) => {
    const from = relative(own, at);
    return from !== '' && !from.startsWith(`..${sep}`) && from !== '..' && !isAbsolute(from);
  };
  const handed = realpathSync.native(await adapter.topLevel());
  if (handed === own || inside(handed)) throw leaves(`holds the worktree L1 was handed as the repository, at ${repository}`);
  const listed = (await adapter.listing()).map((record) => ({ ...record, real: real(record.at) }));
  const trees = [];
  const unlocking = [];
  /** Adds `record`'s worktree to those L1 unlocks where `ADDING` locks it, failing on any other lock. */
  const lockOf = (record) => {
    if (record.locked === undefined) return;
    if (!record.detached || record.locked !== ADDING) throw leaves(`holds ${record.at}, a worktree of the repository locked with the reason ${JSON.stringify(record.locked)}`, true);
    unlocking.push(record.real);
  };
  for (const name of names) {
    const tree = join(own, name);
    if (!lstatSync(tree).isDirectory() || !(await adapter.isWorktree(tree))) throw leaves(`holds ${tree}, which is not a worktree of the repository`);
    const record = listed.find((each) => each.real === tree);
    if (record === undefined) throw leaves(`holds ${tree}, a worktree where git lists no worktree of the repository`);
    if (!record.detached) throw leaves(`holds ${tree}, a worktree of the repository on the branch ${record.branch}, not at a detached commit`);
    lockOf(record);
    trees.push(tree);
  }
  for (const record of listed.filter((each) => inside(each.real) && !trees.includes(each.real))) {
    if (present(record.real)) throw leaves(`holds another worktree of the repository, at ${record.at}`);
    lockOf(record);
  }
  return { real: own, present: there !== undefined, trees, unlocking };
}

/**
 * Clears the judge's directory `judgeChecked` passed: unlocks each registration it named, then
 * makes the directory removable, as `writable` says, and removes each worktree in it and the
 * directory itself.
 */
async function judgeCleared(adapter, { real, present: there, trees, unlocking }) {
  for (const tree of unlocking) await adapter.unlock(tree);
  if (!there) return;
  writable(real);
  for (const tree of trees) await adapter.remove(tree);
  rmdirSync(real);
}

/**
 * Clears card `card`'s workspace path, `path`, for a workspace on `branch`, under the replace rule
 * above, and hands back the real path of the workspace it removed, or nothing where none was there.
 *
 * Every path is compared by the file system's own real path, `realpath(3)`, as L0's checks compare
 * them, since the root reaches L1 in whatever case its caller spelled it and git prints paths in
 * the case the disk holds.
 */
async function cleared({ adapter, card, branch, path, repository }, beforeRemove = async () => {}) {
  if (!present(path)) {
    await beforeRemove();
    await unlockedIfAdding(adapter, path, branch);
    return undefined;
  }
  if (!(await adapter.isWorktree(path))) {
    throw replacementRefused(`${path} holds something that is not a workspace of the repository at ${repository}, so L1 leaves it as it is`, 'R-WORK-14');
  }
  const real = realpathSync.native(path);
  if (real === (await adapter.topLevel())) {
    throw replacementRefused(`${path} is the worktree L1 was handed as the repository, at ${repository}, so L1 leaves it as it is`, 'R-WORK-16');
  }
  const held = await adapter.registration(real);
  if (held?.branch !== branch) {
    const holding = held?.detached ? 'a detached HEAD' : `the branch ${held?.branch}`;
    throw replacementRefused(`${path} is a worktree of the repository holding ${holding}, not card #${card}'s branch ${branch}, so L1 leaves it as it is`, 'R-WORK-15');
  }
  const nested = (await adapter.registered()).find((listed) => within(path, real, listed));
  if (nested !== undefined) {
    throw replacementRefused(`${path} holds another worktree of the repository, at ${nested}, so L1 leaves it as it is`, 'R-WORK-17');
  }
  await beforeRemove();
  writable(real);
  await adapter.remove(real);
  // A workspace named through a symbolic link leaves the link behind, pointing at nothing.
  if (present(path)) unlinkSync(path);
  return real;
}

/**
 * Records L1's `event` of card `card`, with `fields`, through `events`, or, where the sink refuses
 * it, rejects with an `EVENT_REFUSED` failure naming the event as unrecorded, carrying it in
 * `unrecorded` as L0's and L1's other refusals do.
 */
function recorded(events, card, event, fields) {
  try {
    events.emit(event, fields);
  } catch (cause) {
    const failure = new Error(`the sink refused L1's ${event} of card #${card} ${JSON.stringify(fields)}, so it went unrecorded: ${cause.message}`, { cause });
    throw Object.assign(failure, { code: EVENT_REFUSED, unrecorded: [{ event, ...fields, cause }] });
  }
}

/**
 * Builds L1's workspace handle over `root` and `topic` for the repository at `repository`: the
 * function L3 is handed. It makes from main with the card alone, or from the card's forge line
 * when also handed the head L2 read, as `makeWorkspace` does (the architect's ruling 5, P4, on #423).
 * Its `tip` method reads the line's checked-out commit after a continuing maker exits.
 *
 * Building it asks L0 whether git accepts the name the topic derives for card 1 as a literal
 * branch name, and rejects naming the topic and why where it does not, before any directory is
 * made. That is a fast refusal of a topic bad for every card, not the guard: `@{-1}` and `@{-3}`
 * name different previous checkouts, so card 1's answer does not stand for card 3's, and every
 * attempt asks again about its own name before any git call that changes a ref or a directory
 * (ruling 6, Q-B, as the architect's ruling 9 on #423 corrects it).
 */
export async function workspaceHandle({ root, topic, repository, sink }) {
  const name = topicFor(topic, 1);
  const { accepted, why } = await workspaces({ repository, emitter: sink.emitter({ layer: 'L0' }) }).acceptsBranch(name);
  if (!accepted) throw new Error(`the worktree topic \`${topic}\` derives ${name} for card #1, which git refuses as a branch name: ${why}`);
  const handle = (card, head) => makeWorkspace({ root, topic, card, head, repository, sink });
  handle.tip = ({ card, path, branch }) => readWorkspaceTip({ card, path, branch, repository, sink });
  return handle;
}

/**
 * Builds L1's make of a judge's directory over `root` and `topic` for the repository at
 * `repository`: the function L3 is handed as `judgeDirectory`, which makes judge `role`'s directory
 * of card `card` at the head commit `head`, as `makeJudgeDirectory` does (the architect's ruling 4's
 * addendum on #467).
 */
export const judgeDirectoryHandle = ({ root, topic, repository, sink }) => (card, role, head) => makeJudgeDirectory({ root, topic, card, role, head, repository, sink });

/** Removes a card's directories under their replace rules. */
export async function removeCardDirectories({ root, topic, card, repository, sink, timeout }) {
  if (!isAbsolute(root)) throw new Error(`the root ${root} is not an absolute path`);
  const name = topicFor(topic, card);
  const events = sink.emitter({ layer: 'L1', card });
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }), timeout, rejectFailedChecks: true });
  const failures = [];
  const left = (path, reason, role) => recorded(events, card, 'workspace.left', { path, reason, ...(role === undefined ? {} : { role }) });
  const removed = (path, role) => recorded(events, card, 'workspace.removed', { path, ...(role === undefined ? {} : { role }) });
  /** Only a completed rule's refusal leaves Done unblocked; an unread check or failed removal blocks it. */
  const attempt = async (path, role, work) => {
    let begun = false;
    try {
      const gone = await work(() => { begun = true; });
      if (gone) removed(typeof gone === 'string' ? gone : path, role);
    } catch (failure) {
      if (failure.code === EVENT_REFUSED) throw failure;
      left(path, failure.message, role);
      if (begun || failure.blocksDone || failure.code !== 'REPLACEMENT_REFUSED') failures.push(failure);
    }
  };
  const workspace = join(root, name);
  await attempt(workspace, undefined, async (begin) => {
    const held = await adapter.registration(workspace);
    if (held?.locked !== undefined && held.locked !== ADDING) throw Object.assign(new Error(`${workspace} is locked with the reason ${JSON.stringify(held.locked)}`), { blocksDone: true });
    const gone = await cleared({ adapter, card, branch: name, path: workspace, repository }, async () => {
      begin();
      if (held?.locked === ADDING) await adapter.unlock(workspace);
    });
    return gone;
  });
  /** Removes each disk entry under one topic, then the topic directory once safely empty. */
  const children = async (kind, remove) => {
    const parent = join(root, kind);
    const base = join(parent, name);
    let names;
    try {
      const above = lstatOrAbsent(parent);
      if (above === undefined) return;
      if (!above.isDirectory()) throw notDirectory(parent, above);
      const there = lstatOrAbsent(base);
      if (there === undefined) return;
      if (!there.isDirectory()) throw notDirectory(base, there);
      names = readdirSync(base).sort();
    } catch (failure) {
      left(base, failure.message);
      if (failure.code !== 'REPLACEMENT_REFUSED') failures.push(failure);
      return;
    }
    for (const role of names) {
      const path = join(base, role);
      await attempt(path, role, (begin) => remove({ path, base, role, begin }));
    }
    try {
      if (readdirSync(base).length > 0) {
        left(base, `${base} is not empty`);
        return;
      }
      rmdirSync(base);
      removed(base);
    } catch (failure) {
      if (failure.code === EVENT_REFUSED) throw failure;
      left(base, failure.message);
      failures.push(failure);
    }
  };
  const removeDetached = async ({ path, begin }) => {
    const found = await judgeChecked({ adapter, path, repository });
    if (!found.present) return false;
    begin();
    await judgeCleared(adapter, found);
    return true;
  };
  await children('judges', removeDetached);
  await children('escalations', removeDetached);
  await children('scratch', async ({ path, base, begin }) => {
    const there = await scratchReplaceable({ base, path, repository, adapter });
    if (!there) return false;
    begin();
    writable(path);
    rmSync(path, { recursive: true });
    return true;
  });
  for (const kind of ['judges', 'escalations']) {
    const parentPath = join(root, kind);
    const topicPath = join(parentPath, name);
    try {
      const parent = lstatOrAbsent(parentPath);
      if (parent !== undefined && !parent.isDirectory()) continue;
      const topicDirectory = lstatOrAbsent(topicPath);
      if ((parent === undefined || parent.isDirectory()) && (topicDirectory === undefined || topicDirectory.isDirectory())) {
        const base = nearestReal(topicPath);
        for (const record of await adapter.listing()) {
          if (record.locked === undefined || lstatOrAbsent(record.at) !== undefined) continue;
          const at = nearestReal(record.at);
          if (!underOrAt(at, base) || at === base) continue;
          const role = relative(base, at).split(sep)[0];
          if (record.detached && record.locked === ADDING) {
            await adapter.unlock(record.at);
            continue;
          }
          const failure = new Error(`${record.at} is registered with a person's lock, ${JSON.stringify(record.locked)}`);
          left(record.at, failure.message, role);
          failures.push(failure);
        }
      }
    } catch (failure) {
      if (failure.code === EVENT_REFUSED) throw failure;
      left(topicPath, `git could not inspect gone ${kind} worktrees: ${failure.message}`);
      failures.push(failure);
    }
  }
  try {
    await adapter.prune();
  } catch (failure) {
    if (failure.code === EVENT_REFUSED) throw failure;
    left(workspace, `git could not prune gone worktree registrations: ${failure.message}`);
    failures.push(failure);
  }
  if (failures.length > 0) throw new AggregateError(failures, `L1 could not remove all directories of card #${card}`);
}

/**
 * Takes away the lock on a registration at `path`, whose directory is gone, where git lists it on
 * exactly `branch` and locked with `ADDING`, the reason `git worktree add` writes while it makes a
 * worktree: what an engine killed during that command leaves, which fails every later attempt
 * until unlocked (the architect's ruling 9 on #423, observation 6). L0's make then prunes it.
 * Locked on another branch, or with another reason, a person's lock, it fails the attempt naming
 * the path and the reason, and changes nothing.
 */
async function unlockedIfAdding(adapter, path, branch) {
  const held = await adapter.registration(path);
  if (held?.locked === undefined) return;
  if (held.branch !== branch || held.locked !== ADDING) {
    const on = held.detached ? 'a detached HEAD' : `the branch ${held.branch}`;
    throw new Error(`${path} is registered as a worktree whose directory is gone, on ${on}, locked with the reason ${JSON.stringify(held.locked)}, so L1 leaves its lock in place`);
  }
  await adapter.unlock(path);
}

/**
 * Makes `path` and every directory under it owner-readable, -writable and -searchable, `u+rwx`,
 * each before descending into it, so that `git worktree remove --force` can delete what an attempt
 * left. Removing an entry needs write and search permission on its parent directory, not on the
 * entry, so no file's mode is changed, and a hard link to a file outside the workspace keeps its
 * mode. A symbolic link is not followed. Git otherwise drops the registration and then fails to
 * delete the directory, exiting 255 with `failed to delete '<path>': Permission denied` (measured
 * with git 2.54.0, j448-10), and every later attempt refuses the plain directory left behind.
 * Called only once the card's own workspace has passed the replace rule.
 */
function writable(path) {
  const held = lstatSync(path);
  if (!held.isDirectory()) return;
  chmodSync(path, held.mode | 0o700);
  for (const name of readdirSync(path)) writable(join(path, name));
}

/**
 * Whether the worktree git lists at `listed` lies inside the card's workspace at `path`, whose real
 * path is `real`, compared by the file system's own real path, `realpath(3)`, whatever spelling git
 * lists it under. On a volume that folds case, Node's JavaScript `realpathSync` keeps the case it
 * was handed, so two spellings of one directory would compare as two.
 *
 * A worktree reached only through a symbolic link inside the workspace lies where the link points,
 * and a registration whose directory is gone, `ENOENT`, has no real path and lies nowhere. Any
 * other failure to resolve it, such as a directory on the way that cannot be searched, fails the
 * attempt naming the path, since L1 cannot tell that it lies outside.
 */
function within(path, real, listed) {
  let there;
  try {
    there = realpathSync.native(listed);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error(`${path} may hold the worktree git lists at ${listed}, which L1 could not resolve, so L1 leaves it as it is: ${error.message}`, { cause: error });
  }
  const from = relative(real, there);
  return from !== '' && !from.startsWith(`..${sep}`) && from !== '..' && !isAbsolute(from);
}

/** Whether anything is at `path`, a symbolic link to nothing included. */
function present(path) {
  return lstatOrAbsent(path) !== undefined;
}

/**
 * The failure for `what`, at `fields.path`, which `cause` kept L1 from making, once L1 has recorded
 * it through `events` as a `workspace.failed` carrying `fields` and why, or has added to it that the
 * sink refused the record.
 *
 * Where the sink refused an event, L0's that `cause` carries or L1's `workspace.failed`, the
 * failure has the code `EVENT_REFUSED` and carries each such event in `unrecorded`: a refused
 * event is the halt, not a workspace L1 could not make (the owner's O4 on #423).
 */
function notMade(events, what, fields, cause, report = { code: WORKSPACE_NOT_MADE }) {
  const { path } = fields;
  const requirement = report.requirement === undefined ? '' : `${report.requirement} ${report.condition}: `;
  const failure = Object.assign(new Error(`L1 could not make ${what} at ${path}: ${requirement}${cause.message}`, { cause }), { code: report.code, path });
  const unrecorded = cause.code === EVENT_REFUSED ? [...cause.unrecorded] : [];
  try {
    events.emit('workspace.failed', { ...fields, reason: cause.message });
  } catch (refusal) {
    failure.message += `\nand the sink refused L1's workspace.failed, so it went unrecorded: ${refusal.message}`;
    unrecorded.push({ event: 'workspace.failed', ...fields, reason: cause.message, cause: refusal });
  }
  if (unrecorded.length > 0) Object.assign(failure, { code: EVENT_REFUSED, unrecorded });
  return failure;
}
