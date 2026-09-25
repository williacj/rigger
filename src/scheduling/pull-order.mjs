// ABOUTME: L3's pull order: redos ahead of Ready cards, each group by declared priority and then
// oldest first, with the cards L2 refuses reported beside it.

/**
 * A card's rank under the declared order, lower pulled first: its option's place in it. A card with
 * no value and a card whose value the declaration does not name share the rank below every option.
 * With no declared order, every card holds the one rank.
 */
const rankOf = (card, declared) => {
  if (!declared) return 0;
  return card.priority.declared ? declared.indexOf(card.priority.value) : declared.length;
};

/**
 * The pull order over `items`, the board's cards as L0 hands them, each carrying its `column` and
 * its `priority` as `{ value, declared }`, with `columns`, the declared columns by key, and
 * `declared`, the declared priority options highest rank first, or null where none is declared.
 * `decide` is L2's next action for a card.
 *
 * A card in the `ready` column is a Ready card. A card in the `coding` or `review` column is a
 * redo: L2 dispatches one only when no fresh verdict covers it. No card in any other column is
 * offered to L2. Returns `pulls`, each `{ card, kind, redo }`, first pulled first, and `refusals`,
 * each `{ card, reason }` as L2 gave it. A card L2 ignores is in neither.
 */
export function pullOrder({ items, columns, declared }, decide) {
  const redoColumns = [columns.coding, columns.review];
  const pulls = [];
  const refusals = [];
  for (const card of items) {
    const redo = redoColumns.includes(card.column);
    if (!redo && card.column !== columns.ready) continue;
    const next = decide(card);
    if (next.action === 'dispatch') pulls.push({ card, kind: next.kind, redo });
    if (next.action === 'refuse') refusals.push({ card: next.card, reason: next.reason });
  }
  pulls.sort((a, b) => Number(b.redo) - Number(a.redo)
    || rankOf(a.card, declared) - rankOf(b.card, declared)
    || a.card.number - b.card.number);
  return { pulls: pulls.map(({ card, kind, redo }) => ({ card: card.number, kind, redo })), refusals };
}
