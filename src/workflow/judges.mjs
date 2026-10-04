// ABOUTME: L2's judge answer for a Review card: the agent judges with no findings at its pull
// request's head, each with its steps and the evidence they all share, and the findings format a
// judge writes its findings in and L2 reads them back by.

import { OWNER, roleTimeout, workRequires } from '../config/validate.mjs';
import { WORKSPACE_NOT_MADE } from '../execution/workspace.mjs';
import { acceptanceItems, checkAcceptanceForm } from './form-check.mjs';
import { failed, kindOf, selectedSteps, stepAnswer, tierOf } from './next-action.mjs';

/**
 * The findings format: the first line of the one pull request comment a judge writes its findings
 * in, naming the head SHA it ruled on and its role. The instruction L2 composes fills it in, and
 * L2 reads comments back by it, so the two cannot drift. It is an interim contract between L2 and a
 * role, which M5's markers replace (the architect's ruling 2, AQ2, on #467).
 */
const FINDINGS = 'Findings at {head} by {role}';

/** The findings format's first line for `role`'s findings at `head`. */
const findingsLine = (head, role) => FINDINGS.replace('{head}', head).replace('{role}', role);

/** `text` with every character a regular expression gives a meaning escaped. */
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A first line in the findings format, capturing the head SHA and the role it names. */
const FINDINGS_READ = new RegExp(`^${escaped(FINDINGS).replace(escaped('{head}'), '([0-9a-f]{40})').replace(escaped('{role}'), '(\\S+)')}$`);

/** The head and role a comment's `body` names on its first line in the findings format, or nothing. */
function findingsOf(body) {
  const match = String(body).split(/\r?\n/, 1)[0].trimEnd().match(FINDINGS_READ);
  return match === null ? undefined : { head: match[1], role: match[2] };
}

/** What each read of a Review card's facts the judge answer uses reads, as its failure names it. */
const READS = {
  pull: 'the pull request',
  comments: 'the pull request\'s comments',
  editedAt: 'the acceptance\'s revision, the issue body\'s last edit',
};

/**
 * What the read named `read` answered for `card`, from its `forge` facts, each a read's outcome as
 * `Promise.allSettled` records it. A read that failed has L2 name no judge: it answers no action,
 * naming the card, the read and why it failed (reviewer 12 on #467).
 */
function held(card, read) {
  const outcome = card.forge?.[read];
  if (outcome?.status === 'fulfilled') return outcome.value;
  const why = outcome?.status === 'rejected' ? outcome.reason?.message : `no outcome: ${JSON.stringify(outcome)}`;
  throw new Error(`card #${card.number}'s read of ${READS[read]} failed, so L2 names no judge for it: ${why}`, { cause: outcome?.reason });
}

/**
 * Records the L2 event `name` with `fields` under `card` through `sink`. A sink that refuses it has
 * L2 answer no action, naming the card, `what` it was recording and the refusal.
 */
function record(sink, card, name, fields, what) {
  try {
    sink.emitter({ layer: 'L2', card: card.number }).emit(name, fields);
  } catch (refusal) {
    throw new Error(`card #${card.number}'s ${what}, and the event sink refused to record it, so L2 answers no action: ${refusal.message}`, { cause: refusal });
  }
}

/**
 * L2's judge answer for `card`, a Review card with one open pull request from its line of work,
 * under a config's `kinds` and `epicLabel`, `roles` and `provisioning`, from the `forge` facts L2's
 * facts call holds for it: `pull`, the pull request's `{ number, base, head }`, `base` and `head`
 * its SHAs; `diff`; `comments`, each `{ body }`; and `editedAt`, the issue body's last edit time,
 * null for a body never edited. Each is a read's outcome as `Promise.allSettled` records it.
 *
 * A card no kind selects, or more than one does, is answered as `nextAction` answers it. A card
 * whose labels select two tiers for one of its agent judges is refused naming the role and each
 * label (`R-LOOP-13`), and one whose acceptance the form check refuses is refused with its reason,
 * the one refusal naming each that applies. A failed read of the pull request, its comments or the
 * acceptance's revision answers no action, naming the card and the read.
 *
 * It names every agent judge of the card's kind, in the kind's order, that has no comment whose
 * first line is in the findings format naming the pull request's head and that judge (the
 * architect's ruling 1, Q5 and Q9). The owner is never named (`R-LOOP-11`), and a comment naming
 * a role the kind does not name as a judge counts for none. With none to name it is `{ action:
 * 'ignore' }`. Otherwise it is `{ action: 'judge', kind, judges }`, each judge a role answer, as
 * `judgeOf` composes it, with `steps`, the card's selected steps for the judge's `head`, in the
 * order the kind lists them, as `nextAction` answers each.
 *
 * Where the forge would not serve the diff, it names no judge, since two SHAs do not tell a judge
 * what changed (Codex 5 on #467). It records a `diff.refused` event under the card through `sink`,
 * naming the pull request and the forge's reason, and answers `ignore`.
 *
 * `directories` holds, by role, the outcome of L1's make of a judge's directory where L1 could not
 * make it, which L3 hands L2 unread. A judge whose directory was not made is not named, as `unmade`
 * says (the architect's ruling 4's addendum).
 *
 * `outcomes` holds, by role, the outcomes L3 has handed L2 of a judge's steps in its `head`. A judge
 * whose required step failed is not named, and L2 records a `judge.withheld` event under the card
 * naming the role, the step and the failure, classed as the environment's. Nothing retries it
 * within the claim: the next invocation names it again, since it still has no findings at the head
 * (the architect's ruling 2, P3). L2 keeps no memory, so it records the failure each time it is
 * handed it, and L3 hands a judge's outcomes to it once.
 */
export function judgeAnswer(card, kinds, epicLabel, { roles = {}, provisioning = {}, sink, outcomes = {}, directories = {} } = {}) {
  const { kind, answer } = kindOf(card, kinds, epicLabel);
  if (answer !== undefined) return answer;
  const declared = kinds[kind];
  const agents = declared.judges.filter((role) => role !== OWNER);
  if (agents.length === 0) return { action: 'ignore' };
  const tiers = new Map(agents.map((role) => [role, tierOf(card, role, roles[role] ?? {}, 'judge')]));
  const form = checkAcceptanceForm(card);
  const reasons = [...[...tiers.values()].map((tier) => tier.conflict), form.admitted ? undefined : form.reason].filter((reason) => reason !== undefined);
  if (reasons.length > 0) return { action: 'refuse', card: card.number, reason: reasons.join('; and ') };
  const pull = held(card, 'pull');
  const comments = held(card, 'comments');
  const revision = held(card, 'editedAt');
  const findings = comments.map((comment) => findingsOf(comment.body)).filter((found) => found !== undefined && agents.includes(found.role));
  const owed = agents.filter((role) => !findings.some((found) => found.head === pull.head && found.role === role));
  if (owed.length === 0) return { action: 'ignore' };
  if (card.forge.diff?.status !== 'fulfilled') {
    const reason = card.forge.diff?.reason?.message ?? `no outcome: ${JSON.stringify(card.forge.diff)}`;
    record(sink, card, 'diff.refused', { pull: pull.number, reason }, `pull request #${pull.number}'s diff was not served`);
    return { action: 'ignore' };
  }
  const earlier = findings.filter((found) => found.head !== pull.head).at(-1)?.head;
  const evidence = evidenceOf(card, pull, revision, card.forge.diff.value, earlier);
  const facts = { card: card.number, revision, pull: pull.number, base: pull.base, head: pull.head };
  const steps = selectedSteps(card, declared, provisioning);
  const judges = owed
    .filter((role) => directories[role] === undefined || !unmade(card, role, directories[role], sink))
    .filter((role) => !withheld(card, role, steps, outcomes[role] ?? [], provisioning, sink))
    .map((role) => ({ ...judgeOf(role, roles[role] ?? {}, tiers.get(role).tier, pull, evidence, facts), steps: steps.map((name) => stepAnswer(name, provisioning)) }));
  return { action: 'judge', kind, judges };
}

/**
 * Whether judge `role` of `card` is withheld for its directory: whether `outcome`, of L1's make of
 * it, is L1's failure to make it, which L2 records through `sink` as a `judge.withheld` event naming
 * the role, the directory and why, classed as the environment's. Any other outcome is no such
 * failure, so L2 answers no action for it, naming the card and the role.
 */
function unmade(card, role, outcome, sink) {
  if (outcome?.status !== 'rejected' || outcome.reason?.code !== WORKSPACE_NOT_MADE) {
    const read = outcome?.status === 'rejected' ? outcome.reason?.message : JSON.stringify(outcome);
    throw new Error(`card #${card.number}'s judge ${role} has a directory outcome that is not L1's failure to make it, so L2 answers no action for it: ${read}`, { cause: outcome?.reason });
  }
  record(sink, card, 'judge.withheld', { role, directory: outcome.reason.path, reason: outcome.reason.message, class: 'environment' }, `judge ${role}'s directory was not made`);
  return true;
}

/**
 * Whether judge `role` of `card` is withheld: whether one of `outcomes`, the outcomes of its
 * `steps` so far, in order, is a required step's failure, which L2 records through `sink`.
 */
function withheld(card, role, steps, outcomes, provisioning, sink) {
  for (const [at, outcome] of outcomes.entries()) {
    const name = steps[at];
    const failure = failed(outcome, provisioning[name], card, name);
    if (failure === undefined || !workRequires(provisioning[name])) continue;
    record(sink, card, 'judge.withheld', { role, step: name, ...failure, class: 'environment' }, `judge ${role}'s required step \`${name}\` failed`);
    return true;
  }
  return false;
}

/**
 * The evidence every judge of `card` at `pull`'s head is handed, the same bytes for each: the
 * card's number and title, its acceptance as `R-CARD-12` reads it and that acceptance's
 * `revision`, the pull request's number and its base and head SHAs, the `earlier` head the newest
 * findings at another head named where there are any, and the `diff` (`R-EVIDENCE-1`,
 * `R-EVIDENCE-3`). It carries no comment's text and nothing of the maker's session (`R-EVIDENCE-4`).
 */
function evidenceOf(card, pull, revision, diff, earlier) {
  return [
    `Card #${card.number}: ${card.title}`,
    '',
    revision === null ? 'Acceptance, from an issue body never edited:' : `Acceptance, as the issue body was last edited at ${revision}:`,
    ...acceptanceItems(card.body).map((item) => `- ${item}`),
    '',
    `Pull request #${pull.number}, from base ${pull.base} to head ${pull.head}.`,
    ...(earlier === undefined ? [] : [`Earlier head, which the previous findings named: ${earlier}`]),
    '',
    'Diff:',
    diff,
  ].join('\n');
}

/**
 * L2's answer for judge `role`, declared as `declared`, running at `tier` on `pull`: its name, agent
 * file and provider as declared, its time as `roleTimeout` answers it, `evidence` and `facts` as
 * given, and the instruction Rigger's contract with every judge composes. No directory is a field
 * of it: L1 makes the judge's directory once L2 has answered (the architect's ruling 3, P8).
 */
function judgeOf(role, declared, tier, pull, evidence, facts) {
  const instruction = [
    `Rigger dispatched this session, unattended, as the judge \`${role}\` of pull request #${pull.number}, at head \`${pull.head}\`.`,
    'What follows is a floor, never a limit: you may read beyond what you were given.',
    'The pull request\'s head, with the card\'s provisioning steps run in it, is in the `head` directory beside your working directory. Build and test in the `head` directory, and never edit it.',
    `Rule on every acceptance item below, then write your findings as one comment on pull request #${pull.number}, whose first line is exactly \`${findingsLine(pull.head, role)}\`.`,
    '',
    '',
  ].join('\n');
  return { role, agent: declared.agent, provider: declared.provider, tier, timeout: roleTimeout(declared), instruction, evidence, facts };
}
