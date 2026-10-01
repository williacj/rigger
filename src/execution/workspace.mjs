// ABOUTME: L1's workspace making: derives a card's workspace and branch from the topic, and makes
// the workspace fresh from the main line for an attempt, and each judge's directory, holding `main`
// at the main line and `head` at the pull request's head, through L0's workspace adapter.

import { chmodSync, lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { EVENT_REFUSED } from '../substrate/process.mjs';
import { ADDING, workspaces } from '../substrate/worktrees.mjs';

/**
 * The `code` of the failure L1 rejects with when it could not make a card's workspace, so its
 * caller tells it from a command that ran, or never started, without reading the message.
 */
export const WORKSPACE_NOT_MADE = 'WORKSPACE_NOT_MADE';

/**
 * The name `topic` derives for `card`: the topic with each `{number}` replaced by the card's issue
 * number. It names both the card's workspace, directly under the root, and its branch.
 */
export const topicFor = (topic, card) => topic.replaceAll('{number}', String(card));

/**
 * Makes card `card`'s workspace fresh for an attempt that starts its work from the beginning, and
 * settles on its `path` and `branch` (`R-WORK-3`, `R-WORK-10`).
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
 * there locked by `git worktree add` is unlocked, as `unlockedIfAdding` says. L0 then makes the
 * workspace on the branch at the main line's commit as `origin` holds it, resetting the branch
 * where it exists.
 *
 * Every failure rejects with `WORKSPACE_NOT_MADE`, naming the path and why, after L1 has
 * recorded the same. Where the sink refused any event on the way, L0's, L1's record of the
 * failure, or its record of a workspace made or removed, though the workspace was made or
 * removed, it rejects with `EVENT_REFUSED` instead, naming each such event as unrecorded: a
 * refused event is the halt, not a workspace L1 could not make, so L2 spends no attempt on it (the
 * owner's O4 on #423).
 */
export async function makeWorkspace({ root, topic, card, repository, sink }) {
  const events = sink.emitter({ layer: 'L1', card });
  const branch = topicFor(topic, card);
  const path = join(root, branch);
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) });
  /** Runs `work`, rejecting as a workspace L1 could not make where it rejects. */
  const step = async (work) => {
    try {
      return await work();
    } catch (cause) {
      throw notMade(events, `card #${card}'s workspace`, { path }, cause);
    }
  };
  const removed = await step(async () => {
    if (!isAbsolute(root)) throw new Error(`the root ${root} is not an absolute path, and L1 is handed the root the verb resolved`);
    const { accepted, why } = await adapter.acceptsBranch(branch);
    if (!accepted) throw new Error(`card #${card}'s topic \`${topic}\` derives ${branch}, which git refuses as a branch name: ${why}`);
    return cleared({ adapter, card, branch, path, repository });
  });
  if (removed !== undefined) recorded(events, card, 'workspace.removed', { path: removed });
  await step(() => adapter.make(path, branch));
  recorded(events, card, 'workspace.made', { path, branch });
  return { path, branch };
}

/**
 * Makes the directory judge `role` of card `card` runs in, `<root>/judges/<topic>/<role>`, and
 * settles on its `path` and the paths of the two worktrees it holds, each at a detached commit:
 * `main` at the commit the main line held on `origin` as L1 made it, and `head` at `head`, the
 * pull request's head commit L1 was handed, fetched from `origin` (the owner's O3; ruling 1 Q3).
 *
 * L1 records under the card a `workspace.made` carrying `role`, the path and both commits, and a
 * `workspace.failed` carrying `role`, the path and why (ruling 2 P5). Every failure rejects with
 * `WORKSPACE_NOT_MADE`, naming the path and why, or with `EVENT_REFUSED` where the sink refused an
 * event on the way, as `makeWorkspace` does.
 */
export async function makeJudgeDirectory({ root, topic, card, role, head, repository, sink }) {
  const events = sink.emitter({ layer: 'L1', card });
  const path = join(root, 'judges', topicFor(topic, card), role);
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) });
  const trees = { main: join(path, 'main'), head: join(path, 'head') };
  let main;
  try {
    ({ commit: main } = await adapter.fetchMainLine());
    const { held, why } = await adapter.holdsAfterFetch(head);
    if (!held) throw new Error(`the repository does not hold the head commit ${head} after fetching it: ${why}`);
    await adapter.makeDetached(trees.main, main);
    await adapter.makeDetached(trees.head, head);
  } catch (cause) {
    throw notMade(events, `judge ${role}'s directory for card #${card}`, { role, path }, cause);
  }
  recorded(events, card, 'workspace.made', { role, path, main, head });
  return { path, ...trees };
}

/**
 * Clears card `card`'s workspace path, `path`, for a workspace on `branch`, under the replace rule
 * above, and hands back the real path of the workspace it removed, or nothing where none was there.
 */
async function cleared({ adapter, card, branch, path, repository }) {
  if (!present(path)) {
    await unlockedIfAdding(adapter, path, branch);
    return undefined;
  }
  if (!(await adapter.isWorktree(path))) {
    throw new Error(`${path} holds something that is not a workspace of the repository at ${repository}, so L1 leaves it as it is`);
  }
  const real = realpathSync(path);
  if (real === (await adapter.topLevel())) {
    throw new Error(`${path} is the worktree L1 was handed as the repository, at ${repository}, so L1 leaves it as it is`);
  }
  const held = await adapter.registration(real);
  if (held?.branch !== branch) {
    const holding = held?.detached ? 'a detached HEAD' : `the branch ${held?.branch}`;
    throw new Error(`${path} is a worktree of the repository holding ${holding}, not card #${card}'s branch ${branch}, so L1 leaves it as it is`);
  }
  const own = realpathSync.native(path);
  const nested = (await adapter.registered()).find((listed) => within(path, own, listed));
  if (nested !== undefined) {
    throw new Error(`${path} holds another worktree of the repository, at ${nested}, so L1 leaves it as it is`);
  }
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
 * function L3 is handed, which makes a card's workspace as `makeWorkspace` does (the architect's
 * ruling 5, P4, on #423).
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
  return (card) => makeWorkspace({ root, topic, card, repository, sink });
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
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
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
function notMade(events, what, fields, cause) {
  const { path } = fields;
  const failure = Object.assign(new Error(`L1 could not make ${what} at ${path}: ${cause.message}`, { cause }), { code: WORKSPACE_NOT_MADE, path });
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
