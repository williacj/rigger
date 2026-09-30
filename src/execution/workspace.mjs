// ABOUTME: L1's workspace making: derives a card's workspace and branch from the topic, and makes
// the workspace fresh from the main line for an attempt, through L0's workspace adapter.

import { lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

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
 * with exactly the card's branch checked out, and not the worktree whose top level git reports for
 * `repository`, the worktree L1 was handed. Anything else there fails the attempt naming the path,
 * before any git call that could write, so neither it nor the branch is changed (`R-WORK-13` to
 * `R-WORK-16`; the architect's ruling 9 on #423). L0 then makes the workspace on the branch at the
 * main line's commit as `origin` holds it, resetting the branch where it exists.
 *
 * Every failure rejects with `WORKSPACE_NOT_MADE`, naming the path and why, after L1 has
 * recorded the same. Where the sink refuses that record, the rejection says so too. A sink that
 * refuses the record of a workspace made or removed fails the attempt the same way, though the
 * workspace was made or removed; the next attempt's workspace replaces it.
 */
export async function makeWorkspace({ root, topic, card, repository, sink }) {
  const events = sink.emitter({ layer: 'L1', card });
  const branch = topicFor(topic, card);
  const path = join(root, branch);
  const adapter = workspaces({ repository, emitter: sink.emitter({ layer: 'L0', card }) });
  try {
    if (!isAbsolute(root)) throw new Error(`the root ${root} is not an absolute path, and L1 is handed the root the verb resolved`);
    const { accepted, why } = await adapter.acceptsBranch(branch);
    if (!accepted) throw new Error(`card #${card}'s topic \`${topic}\` derives ${branch}, which git refuses as a branch name: ${why}`);
    if (present(path)) {
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
      await adapter.remove(real);
      // A workspace named through a symbolic link leaves the link behind, pointing at nothing.
      if (present(path)) unlinkSync(path);
      events.emit('workspace.removed', { path: real });
    } else {
      await unlockedIfAdding(adapter, path, branch);
    }
    await adapter.make(path, branch);
    events.emit('workspace.made', { path, branch });
  } catch (cause) {
    throw notMade(events, card, path, cause);
  }
  return { path, branch };
}

/**
 * Builds L1's workspace handle over `root` and `topic` for the repository at `repository`: the
 * function L3 is handed, which makes a card's workspace as `makeWorkspace` does (the architect's
 * ruling 5, P4, on #423).
 *
 * Building it asks L0 whether git accepts the name the topic derives for card 1 as a branch, and
 * rejects naming the topic and git's first line of standard error where it does not, before any
 * directory is made (ruling 6, Q-B). A topic is a constant with digits put in place of
 * `{number}`, which neither makes nor unmakes anything git refuses in a branch name, so one card
 * answers for every card; an attempt asks again all the same.
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
 * The failure for card `card`'s workspace at `path`, which `cause` kept L1 from making, once L1
 * has recorded it through `events`, or has added to it that the sink refused the record.
 */
function notMade(events, card, path, cause) {
  const failure = Object.assign(new Error(`L1 could not make card #${card}'s workspace at ${path}: ${cause.message}`, { cause }), { code: WORKSPACE_NOT_MADE, path });
  try {
    events.emit('workspace.failed', { path, reason: cause.message });
  } catch (refusal) {
    failure.message += `\nand the sink refused L1's workspace.failed, so it went unrecorded: ${refusal.message}`;
  }
  return failure;
}
