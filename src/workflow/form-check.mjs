// ABOUTME: L2's acceptance form check: whether a card's acceptance has the form a card needs
// before it is admitted, and the reason when it does not.

const HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/;
const BULLET = /^[ \t]*[-*+](?:[ \t]+(.*))?$/;
const TASK = /^\[[ xX]\](?:[ \t]|$)/;

const MISSING = 'missing acceptance';
const RESTATED = 'restated title';

/** The plain bullets under every heading named exactly `Acceptance`, up to the next heading. */
function acceptanceItems(body) {
  const items = [];
  let inside = false;
  for (const line of body.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      inside = heading[1] === 'Acceptance';
      continue;
    }
    const bullet = inside && BULLET.exec(line);
    if (bullet && !TASK.test(bullet[1] ?? '')) items.push(bullet[1] ?? '');
  }
  return items;
}

/** Text with case, punctuation and runs of whitespace taken out of the comparison. */
const normalise = (text) => text.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();

export function checkAcceptanceForm(card) {
  const items = acceptanceItems(card.body);
  if (items.length === 0) return { admitted: false, card: card.number, reason: MISSING };
  const title = normalise(card.title);
  if (items.every((item) => normalise(item) === title)) return { admitted: false, card: card.number, reason: RESTATED };
  return { admitted: true };
}
