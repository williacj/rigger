// ABOUTME: The `once` verb: fires one pull through L3's dispatching entry point, which claims one card,
// has L1 make and provision its workspace, and stops short of the maker, and says so. It reads the
// board through L0, moves the card through L2, and records through L5. `run` is the same verb with
// no claim limit, so what the two share is one function here.

import { join, resolve } from 'node:path';

import { validate } from '../config/validate.mjs';
import { killRecordedGroups } from '../execution/run.mjs';
import { workspaceHandle } from '../execution/workspace.mjs';
import { loop } from '../scheduling/loop.mjs';
import { readSide } from '../substrate/forge/read.mjs';
import { nextAction } from '../workflow/next-action.mjs';
import { columnChanges } from '../workflow/transitions.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, real, sameTree, settled } from './doctor.mjs';
import { refusalLine } from './plan.mjs';
import { STATE, recording } from './recording.mjs';

/** The topic rule where the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const TOPIC = 'rigger-{number}';

/**
 * Every failure `failure` holds, an AggregateError opened to the failures inside it, however
 * deep: L3 reports a pull's failures in one, and a card's own in another inside it.
 */
const failuresIn = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(failuresIn) : [failure]);

/**
 * The absolute worktree root for the config `config` in the repository whose top level is `top`:
 * `worktrees.root` where the config declares one, and otherwise `../<name>-worktrees`, `<name>`
 * being the part of `repo` after the slash, a relative one resolved against `top` (the
 * architect's ruling 3, P3, on #423).
 */
const worktreeRoot = (config, top) => resolve(top, config.worktrees?.root ?? `../${config.repo.split('/')[1]}-worktrees`);

/**
 * What a verb named `verb` that fires one pull through L3's dispatching entry point prints, and the
 * status it exits with. `limit` is the claim limit handed to the pull, or undefined for none, in
 * which case the pull claims until the slots are full: L3 reads N from the config it is handed.
 * The pull fires once, and nothing fires another as a slot frees, so a card whose second attempt
 * fails is not pulled a third time (the owner's O5 on #423).
 *
 * It records through the sink `recording` opens, in the repository the guard names. L3 is handed
 * L1's kill of the process groups a dead engine recorded in that repository's state directory,
 * and runs it before it records or reads anything, and the state directory, where L1 records each
 * step's group (ruling 10). L3 is handed L1's workspace handle, built over the root the verb
 * resolved, the topic, and the guard's top level as the repository, before `loop` is built (ruling
 * 5, P4; ruling 6, Q-B). `ps` and `readTimeout` stand in for L0's own process-table read and its
 * bound where a test gives them.
 */
export const claimVerb = (verb, limit, options) => recording((opened) => claiming(verb, limit, opened, options));

/** `claimVerb`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function claiming(verb, limit, opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, send, ps, readTimeout,
} = {}) {
  const { named, refusal } = await settled(verb, opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const { sink } = opened;
  const { config, problem } = await consumerConfig(named);
  if (problem) return { text: `rigger ${verb}: ${problem}`, code: 1 };
  const invalid = validate(config);
  if (invalid.length > 0) return { text: `rigger ${verb}: \`${CONFIG}\`: ${invalid.join('; ')}`, code: 1 };

  const root = worktreeRoot(config, named);
  // The guard reads the resolved root before anything is claimed, as it read the target: a
  // workspace made inside the source tree this Rigger runs from is an agent's to delete it from
  // under the run (the architect's ruling 3, P3, on #423).
  if (sameTree(root, packageRoot)) {
    return {
      text: `rigger ${verb}: the worktree root ${root} and ${real(packageRoot)}, the source tree this Rigger is running from, `
        + 'are one tree, and Rigger never makes a workspace there (`R-SAFE-5`). Declare a `worktrees.root` outside it.',
      code: 1,
    };
  }
  let workspace;
  try {
    workspace = await workspaceHandle({ root, topic: config.worktrees?.topic ?? TOPIC, repository: named, sink });
  } catch (failure) {
    return { text: `rigger ${verb}: ${failure.message}`, code: 1 };
  }

  const board = readSide({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink, send });
  // L3 answers the cards that reached the maker and nothing about the rest, so every card L2
  // refuses is seen here, through the next action this verb hands L3 (the reviewer's ruling on
  // #312). Within an attempt L2 answers from the provisioning steps as well (ruling 6, Q-A).
  const refusals = [];
  const decide = (card, outcomes, { attempt, workspace: unmade } = {}) => {
    const next = nextAction(card, config.kinds, config.epicLabel, { provisioning: config.provisioning ?? {}, outcomes, sink, attempt, workspace: unmade });
    if (next.action === 'refuse') refusals.push(next);
    return next;
  };
  const state = join(named, STATE);
  const kill = () => killRecordedGroups({ directory: state, sink, ps, readTimeout });
  const { project } = config.board;
  const stoppedAt = (reached) => reached.map(({ card, workspace: path }) => `rigger ${verb}: claimed #${card} from board ${project}; no maker runs before M4, so it stopped at its workspace, ${path}`);
  let reached;
  try {
    reached = await loop({ config, board, decide, l2, sink, kill, workspace, state }).pull(limit);
  } catch (failure) {
    // What L3 reports is said whole, one line per failure it holds, and the exit is non-zero:
    // an event the record refused names an action Rigger took and could not record, or a start
    // it did not make, and so does a start's kill that failed, naming each unrecorded kill,
    // unconfirmed group or unreadable record. A card stopped after its second attempt names each
    // attempt's failure. Each is loud by the owner's ruling (#277; `ARCHITECTURE.md`, "Failure
    // model"). The record is not used to say so, because the record is what failed. The cards the
    // same pull left at their workspaces are named first, as they would be had none failed.
    return {
      text: [...stoppedAt(failure.reached ?? []), ...failuresIn(failure).map((held) => `rigger ${verb}: ${held.message}`), ...refusals.map(refusalLine)].join('\n'),
      code: 1,
    };
  }
  const refused = refusals.map(refusalLine);
  // Nothing to pull is the one outcome this verb meets in full, so it alone exits zero (U29).
  if (reached.length === 0) return { text: [`rigger ${verb}: from board ${project}, no card was pullable`, ...refused].join('\n'), code: 0 };
  // Non-zero, because a card whose workspace is ready and whose maker never ran is short of what
  // the README promises of this verb, and a zero exit would read to whoever called it as work that
  // was done (the owner's O8 on #423).
  return { text: [...stoppedAt(reached), ...refused].join('\n'), code: 1 };
}

/**
 * What the command prints for a `once` run, and the status it exits with. The limit is this
 * verb's own literal: `once` claims one card, whatever N the config declares.
 */
export const once = (options) => claimVerb('once', 1, options);
