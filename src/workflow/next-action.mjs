// ABOUTME: L2's next action for a ready card, or an unclaimed Coding or Review card no fresh
// verdict covers: ignore it, refuse it with a reason, or dispatch it under the one kind that selects it.

import { sameLabel } from '../config/validate.mjs';
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
 */
export function nextAction(card, kinds, epicLabel, { columns, fresh } = {}) {
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
  return { action: 'dispatch', kind };
}
