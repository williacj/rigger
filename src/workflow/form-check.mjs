// ABOUTME: L2's acceptance form check: whether a card's acceptance has the form a card needs
// before it is admitted, and the reason when it does not.

const HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const BULLET = /^[ \t]*[-*+](?:[ \t]+(.*))?$/;
const ORDERED = /^[ \t]*\d{1,9}[.)](?:[ \t]|$)/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK = /^\[[ xX]\](?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const COMMENT = /<!--[\s\S]*?-->/g;

/** The two reasons a card is refused, which `R-CARD-8` makes the whole of the check. */
const MISSING = 'missing acceptance';
const RESTATED = 'restated title';

/**
 * The plain bullets under every heading named exactly `Acceptance`, up to the next heading, each
 * with the lines it wraps onto (the owner's U1 ruling). A task-list item and a numbered item are
 * not plain bullets, so each ends the item above it and starts none. An HTML comment and a fenced
 * code block are not Markdown the card shows, so neither holds a heading or an item.
 */
function acceptanceItems(body) {
  const items = [];
  let inside = false;
  let item = null;
  let fence = null;
  for (const line of body.replace(COMMENT, '').split(/\r?\n/)) {
    const marks = FENCE.exec(line)?.[1];
    if (fence || marks) {
      if (!fence) fence = marks;
      else if (marks && marks[0] === fence[0] && marks.length >= fence.length && !line.trim().slice(marks.length)) fence = null;
      item = null;
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = !BREAK.test(line) && BULLET.exec(line);
    if (heading) inside = heading[1] === 'Acceptance';
    if (heading || bullet || ORDERED.test(line) || !line.trim()) item = null;
    if (inside && bullet && !TASK.test(bullet[1] ?? '')) items.push((item = [bullet[1] ?? '']));
    else if (item) item.push(line);
  }
  return items.map((lines) => lines.join(' '));
}

/**
 * Text as the restated-title rule compares it (the owner's U2 ruling): case, punctuation and runs
 * of whitespace are taken out. Punctuation here is every Unicode punctuation and symbol character,
 * so Markdown's backticks and emphasis marks are taken out with it. The list marker never reaches
 * this, because an item is read without it.
 */
const normalise = (text) => text.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Whether a card's acceptance passes the form check. A card is `{ number, title, body }` as the
 * forge holds it. The result is `{ admitted: true }`, or `{ admitted: false, card, reason }` naming
 * the card's number and one of the two reasons.
 */
export function checkAcceptanceForm(card) {
  const items = acceptanceItems(card.body);
  if (items.length === 0) return { admitted: false, card: card.number, reason: MISSING };
  const title = normalise(card.title);
  if (items.every((item) => normalise(item) === title)) return { admitted: false, card: card.number, reason: RESTATED };
  return { admitted: true };
}
