// ABOUTME: The `once` verb: fires one pull through L3's dispatching entry point, which claims one card,
// has L1 make and provision its workspace and dispatches its maker, and says what the maker did. It reads the
// board through L0, moves the card through L2, and records through L5. `run` is the same verb with
// no claim limit, so what the two share is one function here.

import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { validate, worktreeTopic } from '../config/validate.mjs';
import { killRecordedGroups } from '../execution/run.mjs';
import { judgeDirectoryHandle, workspaceHandle } from '../execution/workspace.mjs';
import { loop } from '../scheduling/loop.mjs';
import { readSide, repositoryReads } from '../substrate/forge/read.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { factsCall } from '../workflow/facts.mjs';
import { nextAction } from '../workflow/next-action.mjs';
import { REVIEW_WITHHELD, columnChanges } from '../workflow/transitions.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, gitAnswer, real, sameTree, settled, within } from './doctor.mjs';
import { refusalLine } from './plan.mjs';
import { STATE, recording } from './recording.mjs';

/**
 * Every failure `failure` holds, an AggregateError opened to the failures inside it, however
 * deep: L3 reports a pull's failures in one, and a card's own in another inside it.
 */
const failuresIn = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(failuresIn) : [failure]);

/**
 * What a card's maker did, as the pull answered it for a card that reached its maker: `outcome`,
 * L1's, and `settled`, L2's settle of it, each as `Promise.allSettled` records it. Answers `said`,
 * the outcome as the card's line reads it, `review`, whether L2 moved the card to review, and
 * `failure`, L2's own failure where it was neither a move nor a card left in coding for what the
 * forge holds, such as an event the record refused, which is said whole on a line of its own.
 */
function makerOutcome({ outcome, settled: settle }) {
  const failure = settle.status === 'rejected' && settle.reason?.code !== REVIEW_WITHHELD ? settle.reason : undefined;
  if (outcome.status === 'rejected') {
    const said = outcome.reason?.code === NOT_STARTED ? 'its maker did not start' : 'its maker\'s dispatch failed';
    return { said: `${said}: ${outcome.reason?.message}`, review: false, failure };
  }
  const { exit } = outcome.value;
  if (exit !== 0 || failure !== undefined) return { said: `its maker exited ${exit}`, review: false, failure };
  if (settle.status === 'fulfilled') {
    const { line, open: [pull] } = settle.value;
    return { said: `its maker exited 0 and pull request #${pull.number} is open from ${line}, so the card is in review`, review: true };
  }
  const { line, open } = settle.reason.facts;
  if (open.length === 0) return { said: `its maker exited 0 and opened no pull request from ${line}`, review: false };
  return { said: `its maker exited 0, and the forge holds more than one open pull request from ${line}: ${open.map((pull) => `#${pull.number}`).join(', ')}`, review: false };
}

/**
 * The absolute worktree root for the config `config` in the repository whose top level is `top`:
 * `worktrees.root` where the config declares one, and otherwise `../<name>-worktrees`, `<name>`
 * being the part of `repo` after the slash, a relative one resolved against `top` (the
 * architect's ruling 3, P3, on #423).
 */
const worktreeRoot = (config, top) => resolve(top, config.worktrees?.root ?? `../${config.repo.split('/')[1]}-worktrees`);

/**
 * The real path of `path`, read with `realpathSync.native`. Where `path` is absent, the real path
 * of its nearest existing parent with the rest taken as written. Any other failure throws: a link
 * whose target is not there is present rather than absent, and a path that cannot be read is
 * refused rather than guessed at, which is where this differs from `real`.
 */
function strictReal(path) {
  try {
    return realpathSync.native(path);
  } catch (failure) {
    if (failure.code !== 'ENOENT') throw failure;
    try {
      lstatSync(path);
    } catch (absent) {
      if (absent.code !== 'ENOENT' || dirname(path) === path) throw absent;
      return join(strictReal(dirname(path)), basename(path));
    }
    throw failure;
  }
}

/**
 * Why a verb named `verb` refuses the worktree root `root` for the repository whose top level is
 * `top`, or undefined where it does not: the root is that working tree, or the main working tree
 * of the repository where `top` is a linked worktree, or lies inside either, read as real paths.
 * A workspace, a judge's directory or a role's scratch directory there would sit in the tree a
 * maker stages from. A root or a tree whose real path cannot be read is refused too. Git names the
 * main working tree, through L0 with `options` (`gitAnswer`).
 */
async function rootInsideTree(verb, root, top, options) {
  const { stdout, why } = await gitAnswer(['-C', top, 'worktree', 'list', '--porcelain', '-z'], options);
  if (why !== undefined) return `rigger ${verb}: git could not name the main working tree of ${top} (${why}), so Rigger cannot tell whether the worktree root ${root} lies inside it, and refuses it.`;
  // `-z` ends each field with a NUL, so a path holding a line break is read whole.
  const main = stdout.split('\0')[0].replace(/^worktree /, '');
  let paths;
  try {
    paths = [root, top, main].map(strictReal);
  } catch (failure) {
    return `rigger ${verb}: the real path of the worktree root ${root} cannot be read (${failure.message}), so Rigger cannot tell whether it lies inside the working tree ${top}, and refuses it. Declare a \`worktrees.root\` outside it.`;
  }
  const [there, ...trees] = paths;
  const tree = trees.find((each) => within(each, there));
  if (tree === undefined) return undefined;
  return `rigger ${verb}: the worktree root ${root} lies inside the working tree ${tree}, where every workspace Rigger made would sit in the tree a maker stages from. Declare a \`worktrees.root\` outside it.`;
}

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
 * 5, P4; ruling 6, Q-B), and L1's make of a judge's directory over the same three, as
 * `judgeDirectory` (the architect's ruling 4's addendum on #467). `ps` and `readTimeout` stand in for L0's own process-table read and its
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
  const inside = await rootInsideTree(verb, root, named, { ask, emitter: sink.emitter({ layer: 'L0' }) });
  if (inside !== undefined) return { text: inside, code: 1 };
  let workspace;
  try {
    workspace = await workspaceHandle({ root, topic: worktreeTopic(config), repository: named, sink });
  } catch (failure) {
    return { text: `rigger ${verb}: ${failure.message}`, code: 1 };
  }
  const judgeDirectory = judgeDirectoryHandle({ root, topic: worktreeTopic(config), repository: named, sink });

  const forge = { ...config.board, repo: config.repo };
  const board = readSide(forge, { send, emitter: sink.emitter({ layer: 'L0' }) });
  const reads = repositoryReads(forge, { send, emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink, send, reads });
  // L3 answers the cards that reached the maker and nothing about the rest, so every card L2
  // refuses is seen here, through the next action this verb hands L3 (the reviewer's ruling on
  // #312), the refusals from what the forge holds among them. Within an attempt L2 answers from
  // the provisioning steps as well (ruling 6, Q-A), and answers the maker as a role.
  const refusals = [];
  const decide = (card, outcomes, { attempt, workspace: unmade, forge: settledFacts, judged, directories } = {}) => {
    const next = nextAction(card, config.kinds, config.epicLabel, {
      roles: config.roles, topic: worktreeTopic(config), provisioning: config.provisioning ?? {}, outcomes, sink, attempt, workspace: unmade, forge: settledFacts, judged, directories,
    });
    if (next.action === 'refuse') refusals.push(next);
    return next;
  };
  const facts = factsCall({ config, reads, decide });
  const state = join(named, STATE);
  const kill = () => killRecordedGroups({ directory: state, sink, ps, readTimeout });
  const { project } = config.board;
  // One line for each card that reached its maker, then one for each failure of L2's settle that
  // was not the card left in coding for what the forge holds.
  // A card pulled for its judges alone has no maker outcome, and #490 adds what the verb says of
  // its judges.
  const outcomes = (reached) => reached.filter((each) => each.outcome !== undefined).map((each) => ({ ...each, ...makerOutcome(each) }));
  const said = (worked) => [
    ...worked.map(({ card, workspace: path, said: what }) => `rigger ${verb}: claimed #${card} from board ${project}; ${what}, in its workspace, ${path}`),
    ...worked.filter(({ failure }) => failure !== undefined).map(({ failure }) => `rigger ${verb}: ${failure.message}`),
  ];
  let reached;
  try {
    // The verb hands L3 the process's own environment, which L3 hands every dispatch it makes
    // (the architect's ruling 2, P7, on #467), and no maker: L3 dispatches it through L1.
    reached = await loop({ config, board, decide, facts, l2, sink, kill, workspace, judgeDirectory, state, environment: process.env }).pull(limit);
  } catch (failure) {
    // What L3 reports is said whole, one line per failure it holds, and the exit is non-zero:
    // an event the record refused names an action Rigger took and could not record, or a start
    // it did not make, and so does a start's kill that failed, naming each unrecorded kill,
    // unconfirmed group or unreadable record. A card stopped after its second attempt names each
    // attempt's failure. Each is loud by the owner's ruling (#277; `ARCHITECTURE.md`, "Failure
    // model"). The record is not used to say so, because the record is what failed. The cards the
    // same pull left at their workspaces are named first, as they would be had none failed.
    return {
      text: [...said(outcomes(failure.reached ?? [])), ...failuresIn(failure).map((held) => `rigger ${verb}: ${held.message}`), ...refusals.map(refusalLine)].join('\n'),
      code: 1,
    };
  }
  const refused = refusals.map(refusalLine);
  // Nothing to pull is the one outcome this verb meets in full, so it alone exits zero (U29).
  if (reached.length === 0) return { text: [`rigger ${verb}: from board ${project}, no card was pullable`, ...refused].join('\n'), code: 0 };
  // Zero only where every card's maker delivered, its card in review; any other outcome is short
  // of what the README promises of this verb, and a zero exit would read to whoever called it as
  // work that was done (the owner's O8 on #423).
  const worked = outcomes(reached);
  return { text: [...said(worked), ...refused].join('\n'), code: worked.every(({ review, failure }) => review && failure === undefined) ? 0 : 1 };
}

/**
 * What the command prints for a `once` run, and the status it exits with. The limit is this
 * verb's own literal: `once` claims one card, whatever N the config declares.
 */
export const once = (options) => claimVerb('once', 1, options);
