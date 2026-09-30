// ABOUTME: L2's next action for a ready card, or an unclaimed Coding or Review card no fresh
// verdict covers: ignore it, refuse it with a reason, or dispatch it under the one kind that selects it.
// Within an attempt at it: the next provisioning step it selected, the maker, or the card stopped.

import { sameLabel, stepTimeout, workRequires } from '../config/validate.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { checkAcceptanceForm } from './form-check.mjs';

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
 * A card in the `coding` or `review` column of `columns`, the declared columns by key, is a redo,
 * and one `fresh(card)` answers true for is `{ action: 'ignore' }`: a fresh verdict covers it, so
 * L2 has nothing to do for it. Freshness is an injected input until M5 reads the markers (the
 * architect's ruling 1, U10), and with none injected no card is fresh. Freshness injected without
 * `columns` is refused, since no card could be told a redo.
 *
 * Handed `provisioning`, a config's provisioning steps by name, L2 answers within an attempt at the
 * card, from `outcomes`, the outcomes L3 has handed it of the attempt's steps so far, none by
 * default, as `within` says. `sink` is L5's, through which L2 records an optional step's failure.
 * Without `provisioning`, L2 answers as above, whatever `outcomes` and `sink` are
 * (the architect's ruling 6, Q-D, on #423).
 */
export function nextAction(card, kinds, epicLabel, { columns, fresh, provisioning, outcomes = [], sink } = {}) {
  if (fresh && !columns) throw new Error('freshness was injected with no declared columns to tell a redo by');
  if (fresh && [columns.coding, columns.review].includes(card.column) && fresh(card)) return { action: 'ignore' };
  const names = carries(card, epicLabel) ? [] : selecting(card, kinds);
  if (names.length === 0) return { action: 'ignore' };
  if (names.length > 1) {
    return { action: 'refuse', card: card.number, reason: `selected by more than one kind: ${names.join(', ')}` };
  }
  const [kind] = names;
  const form = checkAcceptanceForm(card);
  if (!form.admitted) return { action: 'refuse', card: form.card, reason: form.reason };
  if (provisioning === undefined) return { action: 'dispatch', kind };
  return within(card, kind, kinds[kind], provisioning, outcomes, sink);
}

/**
 * What L2 answers within an attempt at `card` under the kind named `kind`, declared as `declared`, once L3 has handed it `outcomes`, the
 * outcomes of the attempt's steps so far, in order: `{ step }`, the next step it selected, with
 * its name and what L1 runs; `{ maker }`, the kind's maker, once every selected step has an
 * outcome and no required one failed; or `{ action: 'stop', card, failure }` for a required step
 * that failed, naming the card's number and the step, with the failure classified as the environment's (`ARCHITECTURE.md`, "Failure model").
 *
 * An optional step's failure is recorded through `sink` as an L2 `step.failed` event under the card,
 * and the attempt goes on (`R-PROV-2`). L3 asks again after each outcome, so only the newest
 * outcome's failure is recorded, and each is recorded once. A sink that refuses it has L2 answer
 * no action, naming the card, the step and the refusal.
 */
function within(card, kind, declared, provisioning, outcomes, sink) {
  const steps = selectedSteps(card, declared, provisioning);
  if (outcomes.length > steps.length) {
    throw new Error(`card #${card.number} has ${outcomes.length} outcome(s) and L2 selected ${steps.length} step(s) for it, so L2 answers no action`);
  }
  for (const [at, outcome] of outcomes.entries()) {
    const name = steps[at];
    const failure = failed(outcome, provisioning[name], card, name);
    if (failure === undefined) continue;
    if (workRequires(provisioning[name])) return { action: 'stop', card: card.number, failure: { class: 'environment', step: name, ...failure } };
    if (at === outcomes.length - 1) {
      try {
        sink.emitter({ layer: 'L2', card: card.number }).emit('step.failed', { step: name, ...failure, optional: true });
      } catch (refusal) {
        throw new Error(`card #${card.number}'s optional step \`${name}\` failed, and the event sink refused to record it, so L2 answers no action: ${refusal.message}`, { cause: refusal });
      }
    }
  }
  if (outcomes.length === steps.length) return { action: 'dispatch', kind, maker: declared.maker };
  const name = steps[outcomes.length];
  const { run, cwd, timeout } = provisioning[name];
  return { action: 'dispatch', kind, step: { name, run, ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }) } };
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
