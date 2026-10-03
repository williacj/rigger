// ABOUTME: L2's next action for a ready card, or an unclaimed Coding or Review card no fresh
// verdict covers: ignore it, refuse it with a reason, or dispatch it under the one kind that selects
// it, from what the forge holds of its line of work where L2's facts call read it. Within an attempt
// at it: the next provisioning step it selected, the maker as a role, the card attempted again, or
// the card stopped.

import { roleTimeout, sameLabel, stepTimeout, workRequires, worktreeTopic } from '../config/validate.mjs';
import { WORKSPACE_NOT_MADE, topicFor } from '../execution/workspace.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { acceptanceItems, checkAcceptanceForm } from './form-check.mjs';

/** Whether a card carries `label`, reading label names as GitHub does, whatever their letter case. */
const carries = (card, label) => card.labels.some((held) => sameLabel(held, label));

/**
 * The names of the kinds that select a card, in the config's order: each kind any one of whose
 * `select.labels` the card carries (the owner's 1-A ruling). A kind whose labels are not a list of
 * one or more label names is refused by the config validator, so every kind read here holds one.
 */
const selecting = (card, kinds) =>
  Object.entries(kinds)
    .filter(([, kind]) => kind.select.labels.some((label) => carries(card, label)))
    .map(([name]) => name);

/**
 * The next action for a card, which is `{ number, title, body, labels }` as the forge holds
 * it, under a config's `kinds` and its `epicLabel`. A card carrying the epic label is selected by
 * no kind, whatever else it carries, and an absent `epicLabel` marks no card an epic. A card no
 * kind selects is `{ action: 'ignore' }`, and never a refusal (`R-SCHED-11`). A card more than
 * one kind selects is refused naming every one of them, in the config's order (the owner's U15
 * ruling). A card the form check refuses is refused with the form check's reason. Otherwise it is
 * `{ action: 'dispatch', kind }`. A refusal is `{ action: 'refuse', card, reason }`, naming the
 * card's number.
 *
 * A card L2's facts call handed on with its `forge` facts is answered from them, as `fromTheForge`
 * says, once a kind selects it and before the form check: refused for what the forge holds of its
 * line of work, ignored, or left to be dispatched. A card handed on with none is answered as if the
 * forge held nothing L2 reads. Handed `roles`, a config's roles by name, L2 refuses a card whose
 * labels select two tiers for its kind's maker (`R-LOOP-13`), naming the role and each label.
 *
 * A card in the `coding` or `review` column of `columns`, the declared columns by key, is a redo,
 * and one `fresh(card)` answers true for is `{ action: 'ignore' }`: a fresh verdict covers it, so
 * L2 has nothing to do for it. Freshness is an injected input until M5 reads the markers (the
 * architect's ruling 1, U10), and with none injected no card is fresh. Freshness injected without
 * `columns` is refused, since no card could be told a redo.
 *
 * Handed `provisioning`, a config's provisioning steps by name, L2 answers within an attempt at the
 * card, from `outcomes`, the outcomes L3 has handed it of the attempt's steps so far, none by
 * default, as `within` says. `sink` is L5's, through which L2 records an optional step's failure,
 * and an attempt's failure with what follows it. `attempt` is the attempt's number, 1 by default,
 * which L3 hands L2 with each outcome, so L2 keeps no count of its own (the architect's ruling 1,
 * A1). `workspace` is the outcome of L1's making the attempt's workspace, where L1 could not make it.
 * Without `provisioning`, L2 answers as above, whatever `outcomes`, `sink`, `attempt` and
 * `workspace` are (the architect's ruling 6, Q-D, on #423). Its maker answer is the role
 * `makerAnswer` composes from `roles`, under `topic`, the rule naming the card's line of work, the
 * default rule where none is given.
 */
export function nextAction(card, kinds, epicLabel, { columns, fresh, roles, topic = worktreeTopic(), provisioning, outcomes = [], sink, attempt = 1, workspace } = {}) {
  if (fresh && !columns) throw new Error('freshness was injected with no declared columns to tell a redo by');
  if (fresh && [columns.coding, columns.review].includes(card.column) && fresh(card)) return { action: 'ignore' };
  const names = carries(card, epicLabel) ? [] : selecting(card, kinds);
  if (names.length === 0) return { action: 'ignore' };
  if (names.length > 1) {
    return { action: 'refuse', card: card.number, reason: `selected by more than one kind: ${names.join(', ')}` };
  }
  const [kind] = names;
  const held = card.forge === undefined ? undefined : fromTheForge(card);
  if (held !== undefined) return held;
  const form = checkAcceptanceForm(card);
  if (!form.admitted) return { action: 'refuse', card: form.card, reason: form.reason };
  const maker = kinds[kind].maker;
  const tier = roles === undefined ? undefined : tierOf(card, maker, roles[maker]);
  if (tier?.conflict) return { action: 'refuse', card: card.number, reason: tier.conflict };
  if (provisioning === undefined) return { action: 'dispatch', kind };
  return within(card, kind, kinds[kind], { roles, tier: tier?.tier, topic, provisioning, outcomes, sink, attempt, workspace });
}

/** Pull requests by number, as a refusal names them. */
const numbered = (pulls) => pulls.map((pull) => `#${pull.number}`).join(', ');

/**
 * What L2 answers for `card` from what the forge holds of its line of work, its `forge` facts as
 * L2's facts call read them, or nothing where those facts leave the card to be dispatched.
 *
 * A merged pull request from the line of work refuses the card, whatever its column, naming the
 * pull request, and so does the line of work itself on a Ready or Coding card, naming it: its work
 * would start again from the beginning over what was pushed (`R-WORK-19`; the owner's O6 on #467).
 * A Review card with one open pull request is ignored, until L3 dispatches judges (#485), and
 * one with more is refused, naming each. A Review card whose line of work is on the forge with no
 * pull request from it is refused, naming the line of work. A Review card the forge holds nothing
 * for is done again from the beginning (`R-WORK-24`).
 */
function fromTheForge(card) {
  const { stage, line, branch, open, merged } = card.forge;
  const refuse = (reason) => ({ action: 'refuse', card: card.number, reason });
  if (merged.length > 0) return refuse(`the forge holds pull request ${numbered(merged)}, merged from its line of work ${line}`);
  if (stage === 'review') {
    if (open.length === 1) return { action: 'ignore' };
    if (open.length > 1) return refuse(`the forge holds more than one open pull request from its line of work ${line}: ${numbered(open)}`);
  }
  if (branch || open.length > 0) return refuse(`the forge holds its line of work, ${line}, so its work would not start from the beginning`);
  return undefined;
}

/**
 * What L2 answers within an attempt at `card` under the kind named `kind`, declared as `declared`, once L3 has handed it `outcomes`, the
 * outcomes of the attempt's steps so far, in order: `{ step }`, the next step it selected, with
 * its name and what L1 runs; `{ maker }`, the kind's maker as a role answer, running at `tier`,
 * once every selected step has an outcome and no required one failed; or, for a required step that failed, or a `workspace` L1
 * could not make, the card attempted again or stopped, as `failedAttempt` says.
 *
 * An optional step's failure is recorded through `sink` as an L2 `step.failed` event under the card,
 * and the attempt goes on (`R-PROV-2`). L3 asks again after each outcome, so only the newest
 * outcome's failure is recorded, and each is recorded once. A sink that refuses it has L2 answer
 * no action, naming the card, the step and the refusal.
 */
function within(card, kind, declared, { roles, tier, topic, provisioning, outcomes, sink, attempt, workspace }) {
  if (workspace !== undefined) return failedAttempt(card, attempt, unmade(workspace, card), sink);
  const steps = selectedSteps(card, declared, provisioning);
  if (outcomes.length > steps.length) {
    throw new Error(`card #${card.number} has ${outcomes.length} outcome(s) and L2 selected ${steps.length} step(s) for it, so L2 answers no action`);
  }
  for (const [at, outcome] of outcomes.entries()) {
    const name = steps[at];
    const failure = failed(outcome, provisioning[name], card, name);
    if (failure === undefined) continue;
    if (workRequires(provisioning[name])) return failedAttempt(card, attempt, { step: name, ...failure }, sink);
    if (at === outcomes.length - 1) {
      try {
        sink.emitter({ layer: 'L2', card: card.number }).emit('step.failed', { step: name, ...failure, optional: true });
      } catch (refusal) {
        throw new Error(`card #${card.number}'s optional step \`${name}\` failed, and the event sink refused to record it, so L2 answers no action: ${refusal.message}`, { cause: refusal });
      }
    }
  }
  if (outcomes.length === steps.length) return { action: 'dispatch', kind, maker: makerAnswer(card, declared.maker, roles?.[declared.maker] ?? {}, tier, topicFor(topic, card.number)) };
  const name = steps[outcomes.length];
  const { run, cwd, timeout } = provisioning[name];
  return { action: 'dispatch', kind, step: { name, run, ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) } };
}

/** How many times L2 has a card attempted before it stops it: the first attempt and one more (`R-FAIL-2`). */
const ATTEMPTS = 2;

/**
 * What L2 answers for `card`'s attempt numbered `attempt`, which failed before the maker as `what`
 * says, once it has recorded the failure and its decision through `sink`. Every such failure is
 * the environment's (`ARCHITECTURE.md`, "Failure model"). An attempt before the last is followed
 * by `{ action: 'again', card, attempt, failure }`, naming the attempt to make next; the last is
 * `{ action: 'stop', card, failure }` (the owner's O4 and O5 on #423).
 *
 * L2 records an `attempt.failed` event under the card, naming the attempt, what failed and why,
 * and the failure's class, then an `attempt.decided` event naming the attempt and whether the card
 * is attempted `again` or `stop`ped. A sink that refuses either has L2 answer no action, naming the
 * card, the attempt and the refusal: the refusal is the halt, and spends no attempt.
 */
function failedAttempt(card, attempt, what, sink) {
  const failure = { class: 'environment', ...what };
  const again = attempt < ATTEMPTS;
  const events = sink.emitter({ layer: 'L2', card: card.number });
  try {
    events.emit('attempt.failed', { attempt, ...failure });
    events.emit('attempt.decided', { attempt, decision: again ? 'again' : 'stop' });
  } catch (refusal) {
    throw new Error(`card #${card.number}'s attempt ${attempt} failed, and the event sink refused to record it, so L2 answers no action: ${refusal.message}`, { cause: refusal });
  }
  return again ? { action: 'again', card: card.number, attempt: attempt + 1, failure } : { action: 'stop', card: card.number, failure };
}

/**
 * How L1 failed to make `card`'s workspace, as `outcome`, its rejection, says: the path and why.
 * Any other outcome is no workspace's failure, so L2 answers no action for it, naming the card.
 */
function unmade(outcome, card) {
  if (outcome?.status !== 'rejected' || outcome.reason?.code !== WORKSPACE_NOT_MADE) {
    const read = outcome?.status === 'rejected' ? outcome.reason?.message : JSON.stringify(outcome);
    throw new Error(`card #${card.number}'s workspace has an outcome that is not L1's failure to make it, so L2 answers no action for it: ${read}`, { cause: outcome?.reason });
  }
  return { workspace: outcome.reason.path, reason: outcome.reason.message };
}

/**
 * How `step`'s `outcome` failed, or nothing where it did not: why a command that never started did
 * not, the time of one its timeout ended, or the exit code of one that exited non-zero.
 *
 * Any other outcome, such as an event the sink refused, is no step's failure. It is the halt,
 * which L3 passes on to its caller, so L2 answers no action for it and names the card and step.
 */
function failed(outcome, step, card, name) {
  if (outcome?.status === 'rejected' && outcome.reason?.code === NOT_STARTED) return { reason: outcome.reason.message };
  if (outcome?.status !== 'fulfilled' || !Number.isInteger(outcome.value?.exit)) {
    const read = outcome?.status === 'rejected' ? outcome.reason?.message : JSON.stringify(outcome);
    throw new Error(`card #${card.number}'s step \`${name}\` has an outcome that is neither L1's result nor a command that never started, so L2 answers no action for it: ${read}`, { cause: outcome?.reason });
  }
  const { exit, timedOut } = outcome.value;
  if (timedOut) return { timeout: stepTimeout(step) };
  if (exit !== 0) return { exit };
  return undefined;
}

/**
 * The names of the steps `kind` runs for `card`, in the order the kind lists them: each step the
 * kind lists that selects nothing, or one of whose `select.labels` the card carries.
 */
const selectedSteps = (card, kind, provisioning) => (kind.provisioning ?? [])
  .filter((name) => provisioning[name].select?.labels.some((label) => carries(card, label)) ?? true);

/**
 * The tier the role named `name`, declared as `role`, runs at for `card`, as `{ tier }`: the tier
 * the labels its `labels` names that the card carries select, or its own `tier` where the card
 * carries none of them (`R-LOOP-12`). Where those labels select more than one tier, it is
 * `{ conflict }`, the refusal's reason, naming the role and each such label (`R-LOOP-13`).
 */
function tierOf(card, name, role) {
  const selecting = Object.entries(role.labels ?? {}).filter(([label]) => carries(card, label));
  const tiers = [...new Set(selecting.map(([, tier]) => tier))];
  if (tiers.length > 1) {
    const named = selecting.map(([label, tier]) => `${label} (${tier})`).join(', ');
    return { conflict: `carries labels selecting different tiers for its maker role \`${name}\`: ${named}` };
  }
  return { tier: tiers[0] ?? role.tier };
}

/**
 * L2's answer for `card`'s maker, the role named `name` and declared as `role`, running at `tier`
 * on the line of work `line`: its name, agent file and provider as declared, its time as
 * `roleTimeout` answers it, and the prompt L2 composes, `instruction` and then `evidence`.
 *
 * The evidence is the card's number, title and acceptance, read as `R-CARD-12` reads it. The
 * instruction is Rigger's contract with every maker, so no role prompt spends words on it (the M4
 * decomposition's §2.5, on #467). It says Rigger dispatched
 * the session, which a role prompt can condition on. Until M6 gives a maker an escalation route, a
 * maker that cannot finish exits non-zero, naming why.
 */
function makerAnswer(card, name, role, tier, line) {
  const { agent, provider } = role;
  const instruction = [
    `Rigger dispatched this session, unattended, as the maker for card #${card.number}.`,
    `This workspace is on the card's line of work, the branch \`${line}\`.`,
    `Once your work meets every acceptance item below, open a pull request from \`${line}\`.`,
    `Never switch this workspace off \`${line}\`, never detach \`HEAD\`, and never add a worktree inside this workspace.`,
    'Where you cannot finish the work, exit non-zero, naming why.',
    '',
    '',
  ].join('\n');
  const evidence = [`Card #${card.number}: ${card.title}`, '', 'Acceptance:', ...acceptanceItems(card.body).map((item) => `- ${item}`), ''].join('\n');
  return { role: name, agent, provider, tier, timeout: roleTimeout(role), instruction, evidence };
}
