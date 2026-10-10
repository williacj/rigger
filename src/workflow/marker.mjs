// ABOUTME: L2's verdict marker: the syntax of the block a judge's verdict comment holds, the
// instruction asking a judge for one, the parse reading one back, the acceptance and evidence
// digests a marker is bound by, and the one read of a pull request's markers.

import { createHash } from 'node:crypto';

import { acceptanceItems } from './form-check.mjs';

/**
 * The marker's syntax, held once so the instruction, the gate's run summary and the parse cannot
 * drift (`ARCHITECTURE.md`, "Markers"). A marker is one pull request comment: its first line is free
 * text, and on its second a block opens with a fence whose info string is `rigger-marker`, closing
 * on a bare fence. Inside, each line is `key: value`, one field per line in any order, and each
 * acceptance item is a line `item <n>: met` or `item <n>: unmet`, keyed by its 1-based ordinal.
 */
const OPEN = '```rigger-marker';
const CLOSE = '```';

/** The three verdicts, which Rigger fixes and no consumer adds to (`R-VERDICT-1`, `R-VERDICT-2`). */
export const VERDICTS = ['sound', 'needs revision', 'critical'];

/** An item's two rulings, and the acceptance's two coverage rulings (`R-LOOP-5`, `R-LOOP-6`). */
const RULINGS = ['met', 'unmet'];
const COVERAGES = ['covered', 'insufficient'];

/** The permissions on the repository whose holders' markers count. */
const WRITERS = ['admin', 'maintain', 'write'];

const POSITIVE = /^[1-9][0-9]*$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ROLE = /^\S+$/;
const DISPATCH = /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINE = /^.+$/;

/** A value one of `values`, as a pattern. */
const oneOf = (values) => new RegExp(`^(?:${values.join('|')})$`);

/**
 * The fields a marker holds besides its items, in the order a composed block writes them: what a
 * value must match, how the parse reads it, and whether the marker needs it. `coverageReason` is
 * needed where coverage is insufficient and `toSound` where the verdict is not sound. `dispatch`
 * and `evidence` are optional for every role, so a judge Rigger did not dispatch, and the owner,
 * can write a marker.
 */
const FIELDS = {
  card: { valid: POSITIVE, read: Number, required: true },
  pull: { valid: POSITIVE, read: Number, required: true },
  head: { valid: SHA, required: true },
  digest: { valid: DIGEST, required: true },
  role: { valid: ROLE, required: true },
  verdict: { valid: oneOf(VERDICTS), required: true },
  coverage: { valid: oneOf(COVERAGES), required: true },
  coverageReason: { valid: LINE },
  toSound: { valid: LINE },
  dispatch: { valid: DISPATCH },
  evidence: { valid: DIGEST },
};

/** A field line, `key: value`, the key a name or `item <n>`; a key with nothing after its colon has an empty value. */
const FIELD = /^(item [^:]*|[A-Za-z]+):(?: (.*))?$/;

/** A fence opening a code block, with the run of marks it must be closed by. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The SHA-256 of `text`'s UTF-8 bytes, as 64 lowercase hex characters. */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The acceptance digest of a card whose body is `body`: SHA-256 of the items `acceptanceItems`
 * reads from it, in order, each followed by one LF. An edit outside the acceptance leaves it as it
 * was, so it stales no marker (`R-LOOP-8`).
 */
export const acceptanceDigest = (body) => sha256(acceptanceItems(body).map((item) => `${item}\n`).join(''));

/** The evidence digest of `evidence`, the one L1 records at `dispatch.start` and a marker carries. */
export const evidenceDigest = (evidence) => sha256(evidence);

/** The lines of a marker block holding `fields`, written in the schema's order, with `items` as one line per ordinal. */
function blockLines({ items, ...fields }) {
  const written = (key) => (fields[key] === undefined ? [] : [`${key}: ${fields[key]}`]);
  return [
    OPEN,
    ...['card', 'pull', 'head', 'digest', 'role', 'verdict'].flatMap(written),
    ...items.map((ruling, at) => `item ${at + 1}: ${ruling}`),
    ...['coverage', 'coverageReason', 'toSound', 'dispatch', 'evidence'].flatMap(written),
    CLOSE,
  ];
}

/** A comment whose first line is `heading` and whose marker block holds `marker`, each of its fields as the parse answers them. */
export const composeMarker = (marker, heading) => [heading, ...blockLines(marker), ''].join('\n');

/** The slot in a judge's instruction that L3's dispatch id fills (`dispatched`). */
const DISPATCH_SLOT = '<the dispatch id>';

/**
 * The part of a judge's instruction that asks for its marker: one comment on pull request `pull`,
 * whose block carries `card`, `pull`, `head`, the acceptance `digest`, `role` and the `evidence`
 * digest as given, the dispatch id L3 fills in at dispatch, and a ruling on each of `items`, the
 * acceptance items, listed by ordinal.
 */
export function markerInstruction({ card, pull, head, digest, role, items, evidence }) {
  const template = blockLines({
    card,
    pull,
    head,
    digest,
    role,
    verdict: `<${VERDICTS.slice(0, -1).join(', ')} or ${VERDICTS.at(-1)}>`,
    items: items.map(() => `<${RULINGS.join(' or ')}>`),
    coverage: `<${COVERAGES.join(' or ')}: whether the acceptance covered what the card asked>`,
    coverageReason: '<one line: why the acceptance does not cover what the card asked, written only where coverage is insufficient>',
    toSound: '<one line: what would make the work sound, written only where the verdict is not sound>',
    dispatch: DISPATCH_SLOT,
    evidence,
  });
  return [
    `Rule on every acceptance item below, by its number, as met or unmet, then write your verdict as one comment on pull request #${pull}.`,
    'Its first line is yours, for the person reading the pull request. Its second line opens this block, which you fill in and write exactly once, under no other fence, leaving out the two optional lines where they do not apply:',
    '',
    ...template,
    '',
    'The acceptance items, by number:',
    ...items.map((item, at) => `${at + 1}. ${item}`),
  ].join('\n');
}

/** L2's role answer `answer` for a judge, with dispatch id `id`, which L3 minted, written into its instruction's marker block. */
export const dispatched = (answer, id) => ({ ...answer, instruction: answer.instruction.replace(`dispatch: ${DISPATCH_SLOT}`, `dispatch: ${id}`) });

/**
 * The marker `body`, a comment's text, holds, read against an acceptance of `count` items. LF and
 * CRLF read alike. It answers one of:
 * - `{ state: 'none' }`, where no marker block opens on the comment's second line;
 * - `{ state: 'unreadable', reason, fields }`, naming why, with `fields` the values the block gave
 *   each field it names, as written, a block never closed read to the comment's end;
 * - `{ state: 'marker', marker, absent }`, `marker` holding each field the block gives, `card` and
 *   `pull` as numbers and `items` as each ordinal's ruling in order, and `absent` naming
 *   `dispatch` and `evidence` where the block leaves them out.
 */
export function parseMarker(body, count) {
  const lines = String(body).split(/\r?\n/).map((line) => line.trimEnd());
  if (lines[1] !== OPEN) return { state: 'none' };
  const closed = lines.indexOf(CLOSE, 2);
  const close = closed === -1 ? lines.length : closed;
  const fields = {};
  const items = new Map();
  const faults = closed === -1 ? ['the marker block opened on line 2 is never closed'] : [];
  const second = secondBlock(lines, close + 1);
  if (second !== undefined) faults.push(`the comment holds two marker blocks, on line 2 and on line ${second + 1}`);
  for (let at = 2; at < close; at += 1) {
    const field = FIELD.exec(lines[at]);
    if (field === null) {
      faults.push(`line ${at + 1}, ${JSON.stringify(lines[at])}, is not \`key: value\``);
      continue;
    }
    const [, key, value = ''] = field;
    if (key.startsWith('item ')) {
      const ordinal = key.slice('item '.length);
      if (!POSITIVE.test(ordinal) || Number(ordinal) > count) faults.push(`${key} is outside 1 to ${count}`);
      else if (items.has(Number(ordinal))) faults.push(`${key} is given twice`);
      else if (!RULINGS.includes(value)) faults.push(`${key} is ruled ${JSON.stringify(value)}, not met or unmet`);
      else items.set(Number(ordinal), value);
    } else if (!Object.hasOwn(FIELDS, key)) faults.push(`the field ${key} is not one the schema names`);
    else if (Object.hasOwn(fields, key)) faults.push(`the field ${key} is given twice`);
    else fields[key] = value;
  }
  for (const [key, { valid, required }] of Object.entries(FIELDS)) {
    if (!Object.hasOwn(fields, key)) {
      if (required) faults.push(`the field ${key} is missing`);
    } else if (!valid.test(fields[key])) faults.push(`the field ${key} holds ${JSON.stringify(fields[key])}, which is not its form`);
  }
  for (let ordinal = 1; ordinal <= count; ordinal += 1) if (!items.has(ordinal)) faults.push(`item ${ordinal} is missing`);
  if (fields.coverage === 'insufficient' && !Object.hasOwn(fields, 'coverageReason')) faults.push('coverage is ruled insufficient with no coverageReason');
  if (Object.hasOwn(fields, 'verdict') && fields.verdict !== 'sound' && !Object.hasOwn(fields, 'toSound')) faults.push(`the verdict ${fields.verdict} names no toSound`);
  if (faults.length > 0) return { state: 'unreadable', reason: faults.join('; '), fields };
  const marker = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, (FIELDS[key].read ?? String)(value)]));
  marker.items = [...items.keys()].sort((one, other) => one - other).map((ordinal) => items.get(ordinal));
  return { state: 'marker', marker: ordered(marker), absent: ['dispatch', 'evidence'].filter((key) => !Object.hasOwn(fields, key)) };
}

/** `marker` with its fields in the schema's order, `items` after `verdict`. */
function ordered(marker) {
  const keys = ['card', 'pull', 'head', 'digest', 'role', 'verdict', 'items', 'coverage', 'coverageReason', 'toSound', 'dispatch', 'evidence'];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(marker, key)).map((key) => [key, marker[key]]));
}

/**
 * The index of the first line from `from` on that opens a second marker block, outside any other
 * fence, or nothing where none does.
 */
function secondBlock(lines, from) {
  let fence = null;
  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at];
    if (fence !== null) {
      const run = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length) fence = null;
    } else if (line === OPEN) return at;
    else fence = FENCE.exec(line)?.[1] ?? null;
  }
  return undefined;
}

/** Whether `one` was written before `other`: by `createdAt`, then, at one `createdAt`, by comment id. */
const before = (one, other) => {
  const created = Date.parse(one.createdAt) - Date.parse(other.createdAt);
  if (created !== 0) return created < 0;
  return one.id.length !== other.id.length ? one.id.length < other.id.length : one.id < other.id;
};

/**
 * The markers on `comments`, a pull request's comments in the shape the forge's read answers, `{
 * body, createdAt, id, author, permission, edited }`, read for card `card`'s pull request `pull`,
 * at head `head` and acceptance digest `digest` over `count` items. Only a comment whose author
 * holds `admin`, `maintain` or `write` on the repository counts, and a marker naming another card
 * or pull request counts as none.
 *
 * It answers `governing`, each role's governing marker, the latest by `createdAt` at `head` and
 * `digest`, and at one `createdAt` the later comment id: the parse's answer, with `edited` as its
 * comment's. An unreadable marker governs for the role, head and digest its block names. It also
 * answers `markers`, every readable marker counted, oldest first.
 */
export function readMarkers(comments, { card, pull, head, digest, count }) {
  const counted = comments
    .filter((comment) => comment.author !== null && WRITERS.includes(comment.permission))
    .map((comment) => ({ comment, parsed: parseMarker(comment.body, count) }))
    .filter(({ parsed }) => parsed.state !== 'none')
    .filter(({ parsed }) => {
      const named = parsed.marker ?? parsed.fields;
      return String(named.card) === String(card) && String(named.pull) === String(pull);
    })
    .sort((one, other) => (before(one.comment, other.comment) ? -1 : 1));
  const governing = new Map();
  for (const { comment, parsed } of counted) {
    const named = parsed.marker ?? parsed.fields;
    if (named.head === head && named.digest === digest) governing.set(named.role, { ...parsed, edited: comment.edited === true });
  }
  return { governing, markers: counted.filter(({ parsed }) => parsed.state === 'marker').map(({ parsed }) => parsed.marker) };
}
