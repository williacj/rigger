// ABOUTME: L2's next action for a ready card: ignore it, refuse it with a reason, or dispatch it
// under the one kind of work that selects it.

import { checkAcceptanceForm } from './form-check.mjs';

/**
 * The names of the kinds that select a card, in the config's order: each kind any one of whose
 * `select.labels` the card carries (the owner's 1-A ruling). A kind whose labels are not a list of
 * one or more label names is refused by the config validator, so every kind read here holds one.
 */
const selecting = (card, kinds) =>
  Object.entries(kinds)
    .filter(([, kind]) => kind.select.labels.some((label) => card.labels.includes(label)))
    .map(([name]) => name);

/**
 * The next action for a ready card, which is `{ number, title, body, labels }` as the forge holds
 * it, under a config's `kinds`. A card no kind selects is `{ action: 'ignore' }`, and never a
 * refusal (`R-SCHED-11`). A card more than one kind selects is refused naming every one of them,
 * in the config's order (the owner's U15 ruling). A card the form check refuses is refused with
 * the form check's reason. Otherwise it is `{ action: 'dispatch', kind }`. A refusal is
 * `{ action: 'refuse', card, reason }`, naming the card's number.
 */
export function nextAction(card, kinds) {
  const names = selecting(card, kinds);
  if (names.length === 0) return { action: 'ignore' };
  if (names.length > 1) {
    return { action: 'refuse', card: card.number, reason: `selected by more than one kind: ${names.join(', ')}` };
  }
  const [kind] = names;
  const form = checkAcceptanceForm(card);
  if (!form.admitted) return { action: 'refuse', card: form.card, reason: form.reason };
  return { action: 'dispatch', kind };
}
