// ABOUTME: L2's acceptance form check: whether a card's acceptance, read from the body's source
// text, has the form a card needs before it is admitted, and the reason when it does not.

/**
 * The source-level form #218 states (the owner's ruling D on the maker's escalation). The check
 * reads lines and nothing else: it renders nothing, and HTML, blockquotes, setext headings and
 * lines below a bullet are not modelled.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// The `s` flag lets `.` take a stray CR, U+2028 or U+2029, which the rule leaves inside a line.
const HEADING = /^ {0,3}(#{1,6})(?: (.*))?$/s;
const BULLET = /^ {0,3}[-*+] (.*)$/s;
const TASK = /^\[[ xX]\]/;
// Text holding nothing but HTML comments and whitespace, such as `<!-- fill in -->`.
const COMMENTS = /^(?:\s*<!--.*?-->)+\s*$/s;

/** The two reasons a card is refused, which `R-CARD-8` makes the whole of the check. */
const MISSING = 'missing acceptance';
const RESTATED = 'restated title';

/** Whether a line closes the fence its opening `marks` began: only a run at least as long. */
function closes(line, marks) {
  const run = /^ {0,3}(`+|~+)$/.exec(line)?.[1];
  return run !== undefined && run[0] === marks[0] && run.length >= marks.length;
}

/** A heading's text, with surrounding whitespace and any closing run of `#` removed. */
const headingText = (text = '') => text.trim().replace(/#+$/, '').trim();

/**
 * The text of every plain bullet in every acceptance section. A section runs from a heading whose
 * text is exactly `Acceptance` to the next heading with as many `#` or fewer. Lines inside a
 * fence are skipped, and an unclosed fence runs to the end of the body. Task-list items, bullets
 * with no text and bullets whose text is only HTML comments are no items.
 */
function acceptanceItems(body) {
  const items = [];
  let section = null;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      if (closes(line, fence)) fence = null;
      continue;
    }
    fence = FENCE.exec(line)?.[1] ?? null;
    if (fence) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (section !== null && level <= section) section = null;
      if (section === null && headingText(heading[2]) === 'Acceptance') section = level;
      continue;
    }
    const text = section !== null ? BULLET.exec(line)?.[1] : undefined;
    if (text !== undefined && text.trim() && !TASK.test(text) && !COMMENTS.test(text)) items.push(text);
  }
  return items;
}

/**
 * Text as the restated-title rule compares it (the owner's U2 ruling): letters folded to lower
 * case, every Unicode punctuation and symbol character deleted, and runs of whitespace collapsed
 * and trimmed. Deleting rather than spacing, and counting symbols, is open for the owner.
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
