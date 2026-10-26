// ABOUTME: The maker escalation note's syntax, its selection from issue comments, and the
// escalation answer L2 gives for the selected note.

import { CATEGORIES } from '../config/validate.mjs';

const WRITERS = ['admin', 'maintain', 'write'];
const DISPATCH = /^d-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const FIELDS = ['category', 'item', 'reason', 'dispatch'];
const DISPATCH_SLOT = '<the dispatch id>';

/** The one block a maker writes, in the order the parser reads its fields. */
const blockLines = (fields) => ['```rigger-escalation', ...FIELDS.map((key) => `${key}: ${fields[key]}`), '```'];

/** The instruction's note form and its one-comment stop rule for a maker of `card`. */
export function escalationInstruction(card) {
  return [
    `Where you cannot meet an acceptance item, write one comment on card #${card.number}'s issue with this block, filling each field:`,
    ...blockLines({ category: '<recorded-decision, critical, or ambiguous>', item: '<the item ordinal>', reason: '<one line naming why>', dispatch: DISPATCH_SLOT }),
    'Count the item ordinal from 1 over the acceptance items in the evidence below, in order.',
    'Write the note once, never edit it, and end your session after posting it.',
  ].join('\n');
}

/** Puts L3's maker dispatch id in the answer the provider sees. */
export function dispatchedEscalation(answer, dispatch) {
  return { ...answer, instruction: answer.instruction.replace(`dispatch: ${DISPATCH_SLOT}`, `dispatch: ${dispatch}`) };
}

/** A note under one fence, with the fields the maker's instruction names. */
export function parseEscalationNote(body, count) {
  const lines = String(body).split(/\r?\n/);
  if (lines[1] !== '```rigger-escalation' || lines[6] !== '```' || lines.slice(7).some((line) => line !== '')) return null;
  const fields = {};
  for (const [at, key] of FIELDS.entries()) {
    const line = lines[at + 2];
    if (!line?.startsWith(`${key}: `)) return null;
    fields[key] = line.slice(key.length + 2);
  }
  const item = Number(fields.item);
  if (!CATEGORIES.includes(fields.category) || !POSITIVE.test(fields.item) || !Number.isSafeInteger(item) || item > count || !fields.reason || !DISPATCH.test(fields.dispatch)) return null;
  return { category: fields.category, item, reason: fields.reason, dispatch: fields.dispatch };
}

/** The first unedited writer's note under `dispatch`, from comments in the forge's oldest-first order. */
export function makerNote(comments, dispatch, count) {
  for (const comment of comments) {
    if (!WRITERS.includes(comment.permission) || comment.edited) continue;
    const note = parseEscalationNote(comment.body, count);
    if (note?.dispatch === dispatch) return note;
  }
  return null;
}

/** L2's escalation answer, naming one open pull request and its head where the line holds one. */
export function makerEscalation(note, { line, open }) {
  return {
    action: 'escalate', raiser: 'maker', ...note, line,
    ...(open.length === 1 ? { pull: open[0].number, head: open[0].head } : {}),
  };
}
