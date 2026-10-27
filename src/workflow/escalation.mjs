// ABOUTME: The maker escalation note's syntax, its selection from issue comments, the escalation
// answer L2 gives for the selected note, and L2's one function answering each escalation's
// destination, the routing post and the escalation role's instruction.

import { CATEGORIES, OWNER, judgeRole } from '../config/validate.mjs';

import { acceptanceItems } from './form-check.mjs';
import { evidenceDigest } from './marker.mjs';

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

/** Puts L3's maker or escalation-role dispatch id in the answer the provider sees. */
export function dispatchedEscalation(answer, dispatch) {
  return { ...answer, instruction: answer.instruction.replace(`dispatch: ${DISPATCH_SLOT}`, `dispatch: ${dispatch}`) };
}

/** A note under one fence, with the fields the maker's instruction names. */
export function parseEscalationNote(body, count) {
  const lines = String(body).split(/\r?\n/);
  const start = lines[0] === '```rigger-escalation' ? 0 : 1;
  if (lines[start] !== '```rigger-escalation' || lines[start + 5] !== '```' || lines.slice(start + 6).some((line) => line !== '')) return null;
  const fields = {};
  for (const [at, key] of FIELDS.entries()) {
    const line = lines[start + at + 1];
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

/** The routing comment's first line, by which L2 finds the comment on a card's issue, whoever wrote it. */
export const ROUTING_LINE = 'Rigger sends this card\'s ambiguous escalation to a role.';

/** Whether a comment in `comments`, the card's issue comments, opens with the routing comment's line. */
const routed = (comments) => comments.some((comment) => String(comment.body).split(/\r?\n/)[0] === ROUTING_LINE);

/**
 * The one destination of an escalation (`ARCHITECTURE.md`, "Escalation"): the owner, or the role
 * `escalate`, the configuration's destinations, names for its category. Only a maker's ambiguity
 * goes to a role (`R-ESCALATE-15`), and a category given none goes to the owner (`R-ESCALATE-22`).
 * It goes to the owner where `maker`, the card's kind's maker, or one of `judges`, its kind's
 * judges, is that role (`R-ESCALATE-17`), and where `comments`, the card's issue comments, carry
 * the routing comment (`R-ESCALATE-16`). A loop-raised escalation reads no comment.
 */
export function escalationDestination({ category, raiser, escalate, maker, judges = [], comments = [] }) {
  if (raiser !== 'maker' || category !== 'ambiguous') return OWNER;
  const configured = escalate !== undefined && Object.hasOwn(escalate, category) ? escalate[category] : OWNER;
  if (configured === OWNER || configured === maker || judges.map(judgeRole).includes(configured)) return OWNER;
  return routed(comments) ? OWNER : configured;
}

/** The routing post's data, below its fixed first line. */
export function routingComment({ destination, category, item, reason, pull, head }) {
  return [ROUTING_LINE, '', `Role: ${destination}`, `Category: ${category}`, `Acceptance item: ${item}`, reason,
    ...(pull === undefined ? [] : [`Pull request: #${pull}`, `Head: ${head}`]), ''].join('\n');
}

/** The role receives the acceptance and maker's reason, with no judge evidence. */
export function escalationRoleInstruction(card, next) {
  const acceptance = acceptanceItems(card.body ?? '');
  const facts = { card: card.number, title: card.title, acceptance, category: next.category, item: next.item, reason: next.reason,
    ...(next.pull === undefined ? {} : { pull: next.pull, head: next.head }) };
  const instruction = [
    `Rigger dispatched this session to handle an escalation for card #${card.number}.`,
    "Only the card's author changes an acceptance.",
    escalationInstruction(card), '',
    `Card #${card.number}: ${card.title}`,
    'Acceptance:', ...acceptance.map((item) => `- ${item}`), '',
    `Maker's ${next.category} note, acceptance item ${next.item}:`, next.reason,
    ...(next.pull === undefined ? [] : [`Pull request: #${next.pull}`, `Head: ${next.head}`]), '',
  ].join('\n');
  const evidence = '';
  return { instruction, evidence, digest: evidenceDigest(evidence), facts };
}
