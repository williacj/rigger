// ABOUTME: L2's review loop for a card with one open pull request: its answer from the verdict
// markers at the pull request's head and acceptance digest, its rounds, the forge's mergeability
// and the gate rule; and its judge answer, naming the agent judges owed a marker, each with its
// steps, the evidence they all share, and the instruction asking each for its marker.

import { OWNER, judgeRole, roleTimeout, workRequires } from '../config/validate.mjs';
import { WORKSPACE_NOT_MADE } from '../execution/workspace.mjs';
import { acceptanceItems, checkAcceptanceForm } from './form-check.mjs';
import { GATE_CONTEXT, gateAnswer } from './gate.mjs';
import { acceptanceDigest, evidenceDigest, markerInstruction, readMarkers } from './marker.mjs';
import { failed, kindOf, panelOf, selectedSteps, stepAnswer, tierOf } from './next-action.mjs';

/** What each read of a Review card's facts the judge answer uses reads, as its failure names it. */
const READS = {
  pull: 'the pull request',
  comments: 'the pull request\'s comments',
  mergeable: 'the pull request\'s mergeability',
  rules: 'the base branch\'s effective rules',
  checks: 'the pull request\'s check states',
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
 * Records the L2 event `name` with `fields` under `card`, and under `dispatch` where one is given,
 * through `sink`. A sink that refuses it has L2 answer no action, naming the card, `what` it was
 * recording and the refusal.
 */
function record(sink, card, name, fields, what, dispatch) {
  try {
    sink.emitter({ layer: 'L2', card: card.number, ...(dispatch === undefined ? {} : { dispatch }) }).emit(name, fields);
  } catch (refusal) {
    throw new Error(`card #${card.number}'s ${what}, and the event sink refused to record it, so L2 answers no action: ${refusal.message}`, { cause: refusal });
  }
}

/**
 * L2's judge answer for `card`, a Review card with one open pull request from its line of work,
 * under a config's `kinds` and `epicLabel`, `roles` and `provisioning`, from the `forge` facts L2's
 * facts call holds for it: `pull`, the pull request's `{ number, base, head }`, `base` and `head`
 * its SHAs; `diff`; and `comments`, each in the shape the forge's read answers, `{ body, createdAt,
 * id, author, permission, edited }`. Each is a read's outcome as `Promise.allSettled` records it.
 *
 * A card no kind selects, or more than one does, is answered as `nextAction` answers it. A card
 * whose labels select two tiers for one of its agent judges (`R-LOOP-13`), or two providers for
 * its maker or one of its judges (`R-LOOP-16`), is refused naming the role and each label, and one
 * whose acceptance the form check refuses is refused with its reason, the one refusal naming each
 * that applies. A failed read of the pull request or its comments
 * answers no action, naming the card and the read.
 *
 * It names every agent judge of the card's kind, in the kind's order, that is owed a marker: one
 * whose governing marker at the pull request's head and the card's acceptance digest, as
 * `readMarkers` reads it, is absent, unreadable or edited (the architect's ruling R2 on #642), or
 * names no provider or another than the one the panel function requires of it (`D24` rule 2). The
 * owner is never named (`R-LOOP-11`), and a marker naming a role the kind does not name as a judge
 * counts for none. With none to name it is `{ action:
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
 * naming the role, the step and the failure, classed as the environment's. The answer also names
 * each withheld role so L3 can leave the card out of later pulls in this invocation. Nothing retries it
 * within the claim: the next invocation names it again, since it still has no marker at the head
 * (the architect's ruling 2, P3). L2 keeps no memory, so it records the failure each time it is
 * handed it, and L3 hands a judge's outcomes to it once.
 */
export function judgeAnswer(card, kinds, epicLabel, { roles = {}, provisioning = {}, sink, outcomes = {}, directories = {} } = {}) {
  const { kind, answer } = kindOf(card, kinds, epicLabel);
  if (answer !== undefined) return answer;
  const declared = kinds[kind];
  const agents = declared.judges.map(judgeRole).filter((role) => role !== OWNER);
  if (agents.length === 0) return { action: 'ignore' };
  const tiers = new Map(agents.map((role) => [role, tierOf(card, role, roles[role] ?? {}, 'judge')]));
  const panel = panelOf(card, declared, roles);
  const form = checkAcceptanceForm(card);
  const reasons = [...[...tiers.values()].map((tier) => tier.conflict), panel[0]?.conflict, form.admitted ? undefined : form.reason].filter((reason) => reason !== undefined);
  if (reasons.length > 0) return { action: 'refuse', card: card.number, reason: reasons.join('; and ') };
  const pull = held(card, 'pull');
  const comments = held(card, 'comments');
  const items = acceptanceItems(card.body);
  const digest = acceptanceDigest(card.body);
  const { governing, markers } = readMarkers(comments, { card: card.number, pull: pull.number, head: pull.head, digest, count: items.length });
  const required = requiredOf(panel);
  const owed = agents.filter((role) => stateOf(governing.get(role), required.get(role)) === 'owed');
  if (owed.length === 0) return { action: 'ignore' };
  if (card.forge.diff?.status !== 'fulfilled') {
    const reason = card.forge.diff?.reason?.message ?? `no outcome: ${JSON.stringify(card.forge.diff)}`;
    record(sink, card, 'diff.refused', { pull: pull.number, reason }, `pull request #${pull.number}'s diff was not served`);
    return { action: 'ignore' };
  }
  const earlier = markers.filter((marker) => agents.includes(marker.role) && marker.head !== pull.head).at(-1)?.head;
  const evidence = evidenceOf(card, pull, digest, card.forge.diff.value, earlier);
  const facts = { card: card.number, revision: digest, pull: pull.number, base: pull.base, head: pull.head };
  const steps = selectedSteps(card, declared, provisioning);
  const withheldRoles = [];
  const judges = owed
    .filter((role) => {
      const missing = (directories[role] !== undefined && unmade(card, role, directories[role], sink))
        || withheld(card, role, steps, outcomes[role] ?? [], provisioning, sink);
      if (missing) withheldRoles.push(role);
      return !missing;
    })
    .map((role) => ({ ...judgeOf(role, roles[role] ?? {}, tiers.get(role).tier, required.get(role), pull, evidence, facts, items), steps: steps.map((name) => stepAnswer(name, provisioning)) }));
  return { action: 'judge', kind, judges, ...(withheldRoles.length > 0 ? { withheld: withheldRoles } : {}) };
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
 * card's number and title, its acceptance as `R-CARD-12` reads it and that acceptance's `digest`,
 * which the marker carries, the pull request's number and its base and head SHAs, the `earlier`
 * head the newest marker at another head named where there is one, and the `diff` (`R-EVIDENCE-1`,
 * `R-EVIDENCE-3`). It carries no comment's text and nothing of the maker's session (`R-EVIDENCE-4`).
 */
function evidenceOf(card, pull, digest, diff, earlier) {
  return [
    `Card #${card.number}: ${card.title}`,
    '',
    `Acceptance, whose digest your marker carries, ${digest}:`,
    ...acceptanceItems(card.body).map((item) => `- ${item}`),
    '',
    `Pull request #${pull.number}, from base ${pull.base} to head ${pull.head}.`,
    ...(earlier === undefined ? [] : [`Earlier head, which the previous marker named: ${earlier}`]),
    '',
    'Diff:',
    diff,
  ].join('\n');
}

/**
 * The provider the panel function `panel` requires of each agent judge, by role. A panel holding a
 * conflict requires none, and its card is refused before any judge is read.
 */
const requiredOf = (panel) => new Map(panel.filter((entry) => entry.provider !== undefined).map(({ role, provider }) => [role, provider]));

/**
 * L2's answer for judge `role`, declared as `declared`, running at `tier` on `provider`, the one the
 * panel function requires of it, on `pull`: its name and agent file as declared, its provider, its
 * time as `roleTimeout` answers it, `evidence` and `facts` as
 * given, `digest`, the evidence digest L1 records at `dispatch.start`, and the instruction Rigger's
 * contract with every judge composes, which asks for a marker ruling on each of `items` and
 * carrying its provider and the evidence digest, and holds the slot L3 fills with the dispatch id (`dispatched`). No
 * directory is a field of it: L1 makes the judge's directory once L2 has answered (the architect's
 * ruling 3, P8).
 */
function judgeOf(role, declared, tier, provider, pull, evidence, facts, items) {
  const digest = evidenceDigest(evidence);
  const instruction = [
    `Rigger dispatched this session, unattended, as the judge \`${role}\` of pull request #${pull.number}, at head \`${pull.head}\`.`,
    'What follows is a floor, never a limit: you may read beyond what you were given.',
    'The pull request\'s head, with the card\'s provisioning steps run in it, is in the `head` directory beside your working directory. Build and test in the `head` directory, and never edit it.',
    `Before ruling, run \`git diff ${pull.base} ${pull.head}\` in your working directory as its own tool call, even when the evidence below includes the diff.`,
    'Run any command in `head` as one line: `cd ../head && <command>`.',
    'Never run git in `head`; run git commands in your working directory.',
    'Your working directory is not provisioned; never build or test there. Read a command\'s exit status from the tool\'s result.',
    'Use a separate tool call for each command, with no extra shell operations, pipes, groups, variables, or status probes such as `$?`, `${...}` or `$(...)`. Keep the `cd ../head && <command>` line by itself.',
    markerInstruction({ card: facts.card, pull: pull.number, head: pull.head, digest: facts.revision, role, provider, items, evidence: digest }),
    '',
    '',
  ].join('\n');
  return { role, agent: declared.agent, provider, tier, timeout: roleTimeout(declared), instruction, evidence, digest, facts };
}

/**
 * L2's review loop: its answer for `card`, a Review, Owner or Coding card whose one open pull
 * request L2's facts call read, under a config's `kinds` and `epicLabel`, from the markers at that
 * pull request's head and the card's acceptance digest, as `readMarkers` governs them. `options` are
 * `judgeAnswer`'s, and its `sink` records one `marker.read` event per governing marker read, as
 * `markerRead` says: every agent judge's, and in Owner the owner's too. In Review the owner's marker
 * is never read.
 *
 * First, in every column, a card whose labels select two providers for its maker or one of its
 * judges is refused, naming the role and each label, as the panel function answers it (`R-LOOP-16`).
 * A Coding card is answered as `codingAnswer` says, and an Owner card whose agent judges are all
 * sound as `ownerAnswer` says. Otherwise L2 takes the first rule that applies (architect review B's
 * R3 on #642):
 * 1. a governing critical marker escalates the card as `critical`, spending no round (`R-ESCALATE-6`);
 * 2. an Owner card any of whose agent markers no longer governs, or is not sound, moves to Review;
 * 3. agent judges owed a marker, absent, unreadable, edited or on another provider than the one
 *    the panel function requires, are dispatched, and only they, as
 *    `judgeAnswer` answers them, spending no round (the architect's r2 ruling 7);
 * 4. coverage ruled insufficient returns the acceptance to its author, as `returned` says (`R-LOOP-6`);
 * 5. needs revision, or sound with an item unmet, is a continuing attempt, as `continued` says,
 *    unless the kind's rounds, three where it declares none, are spent: then the card escalates as
 *    `ambiguous` (`R-LOOP-9`), its rounds counted as `roundsOf` counts them;
 * 6. every agent judge sound under a kind naming the owner moves the card to Owner, and nothing is
 *    dispatched for the owner (`R-LOOP-11`);
 * 7. every judge sound goes to the merge decision, as `mergeAnswer` says.
 *
 * Each answer is one of `{ action: 'judge', kind, judges }`, `{ action: 'refuse', card, reason }`,
 * `{ action: 'move', to }`, `{ action: 'continue', pull, head, markers }`, `{ action: 'return',
 * pull, comment }`, `{ action: 'escalate', category }`, `{ action: 'merge', pull, head }` and
 * `{ action: 'ignore', reason }`, which L3 carries out.
 */
export function reviewAnswer(card, kinds, epicLabel, options = {}) {
  const { kind, answer } = kindOf(card, kinds, epicLabel);
  if (answer !== undefined) return answer;
  const declared = kinds[kind];
  const panel = panelOf(card, declared, options.roles);
  if (panel[0]?.conflict !== undefined) return { action: 'refuse', card: card.number, reason: panel[0].conflict };
  const required = requiredOf(panel);
  const agents = declared.judges.map(judgeRole).filter((role) => role !== OWNER);
  // In Review the owner's marker is never read, so a kind naming the owner alone reads no marker,
  // and moves to Owner once the forge facts every advance rests on are served.
  if (agents.length === 0 && card.forge.stage === 'review') return advanced(card, { action: 'move', to: 'owner' });
  // The pull request's number and head as L2's facts call read them from its line of work: only
  // a judge's evidence needs the merge base, which `judgeAnswer` reads.
  const [pull] = card.forge.open;
  const comments = held(card, 'comments');
  const items = acceptanceItems(card.body);
  const digest = acceptanceDigest(card.body);
  const round = { card: card.number, pull: pull.number, head: pull.head, digest, count: items.length };
  const { governing } = readMarkers(comments, round);
  const read = card.forge.stage === 'owner' ? [...agents, OWNER] : agents;
  for (const role of read.filter((each) => governing.has(each))) markerRead(options.sink, card, pull, round, role, governing.get(role));
  const states = agents.map((role) => stateOf(governing.get(role), required.get(role)));
  if (card.forge.stage === 'coding') return codingAnswer(card, pull, states, agents.map((role) => governing.get(role)), items);
  if (states.includes('critical')) return { action: 'escalate', category: 'critical' };
  if (card.forge.stage === 'owner') {
    if (!states.every((state) => state === 'sound')) return { action: 'move', to: 'review' };
    return ownerAnswer(card, panel, pull, comments, round, governing.get(OWNER), items);
  }
  if (states.includes('owed')) return judgeAnswer(card, kinds, epicLabel, options);
  const insufficient = agents.find((role, at) => states[at] === 'insufficient');
  if (insufficient !== undefined) return returned(card, pull, comments, governing.get(insufficient).marker);
  const revising = agents.filter((role, at) => states[at] === 'revision');
  if (revising.length > 0 && roundsOf(comments, round, required) >= (declared.rounds ?? ROUNDS)) return { action: 'escalate', category: 'ambiguous' };
  if (revising.length > 0) return continued(pull, revising.map((role) => governing.get(role).marker), items);
  if (declared.judges.map(judgeRole).includes(OWNER)) return advanced(card, { action: 'move', to: 'owner' });
  return mergeAnswer(card, panel, pull, comments, round);
}

/**
 * Records, through `sink`, the L2 `marker.read` event for `role`'s marker `governing`, governing at
 * `round` on `card`'s pull request `pull`: its role, head, digest, provider, verdict, dispatch id
 * and evidence digest, a field it lacks as null (`R-VERDICT-7`), and whether its comment was edited. An unreadable
 * marker is recorded with verdict null and its parse reason. The dispatch id is the event's own
 * `dispatch`, which the sink stamps.
 */
function markerRead(sink, card, pull, round, role, governing) {
  const fields = governing.marker ?? {};
  const unreadable = governing.state === 'marker' ? {} : { reason: governing.reason };
  const event = { pull: pull.number, role, head: round.head, digest: round.digest, provider: fields.provider ?? null, verdict: fields.verdict ?? null, evidence: fields.evidence ?? null, edited: governing.edited, ...unreadable };
  // The sink stamps the dispatch id, as the dispatch the marker arose under.
  record(sink, card, 'marker.read', event, `${role}'s marker at head ${round.head} was read`, fields.dispatch ?? null);
}

/**
 * L2's answer for `card` in the Coding column with one open pull request, from `states`, its agent
 * judges' states, and `governing`, their governing markers: a continuing attempt where one needs
 * revision, or where every one is sound and the forge reads the pull request as conflicting
 * (`R-CONFLICT-1`); `ignore` where every one is sound and the forge cannot yet say whether it
 * conflicts; and otherwise refused as at the base, since its work would start again from the
 * beginning over what was pushed (`R-WORK-19`).
 */
function codingAnswer(card, pull, states, governing, items) {
  const revising = governing.filter((held, at) => states[at] === 'revision');
  if (revising.length > 0) return continued(pull, revising.map((held) => held.marker), items);
  if (states.every((state) => state === 'sound')) {
    const mergeable = held(card, 'mergeable');
    if (mergeable === 'conflicting') return continued(pull, [], items);
    if (mergeable === 'unknown') return { action: 'ignore', reason: `the forge reads pull request #${pull.number}'s mergeability as unknown` };
  }
  return { action: 'refuse', card: card.number, reason: `the forge holds its line of work, ${card.forge.line}, so its work would not start from the beginning` };
}

/**
 * L2's answer for `card` in the Owner column, every agent judge sound, from `owner`, the owner's
 * governing marker at the head and digest: with none, the card stays in Owner and nothing is
 * dispatched, since the owner is never dispatched (`R-LOOP-11`); an unreadable or edited one, or
 * one naming a provider, which the owner's never does (`D24` rule 2), is named and left for the
 * owner; otherwise the marker is answered as an agent judge's would be, with no bound on rounds,
 * and a sound one goes to the merge decision under `panel`, the panel function's entries.
 */
function ownerAnswer(card, panel, pull, comments, round, owner, items) {
  const at = `at head ${pull.head}, acceptance digest ${round.digest}`;
  if (owner === undefined) return { action: 'ignore', reason: `every agent judge is sound, and the owner has written no marker ${at}` };
  if (owner.state === 'marker' && !owner.edited && owner.marker.provider !== undefined) {
    return { action: 'ignore', reason: `the owner's marker ${at} names a provider, ${owner.marker.provider}, and the owner's names none` };
  }
  const state = stateOf(owner);
  if (state === 'owed') {
    const why = owner.state === 'marker' ? 'edited' : `unreadable: ${owner.reason}`;
    return { action: 'ignore', reason: `the owner's marker ${at} is ${why}` };
  }
  if (state === 'critical') return { action: 'escalate', category: 'critical' };
  if (state === 'insufficient') return returned(card, pull, comments, owner.marker);
  if (state === 'revision') return continued(pull, [owner.marker], items);
  return mergeAnswer(card, panel, pull, comments, round);
}

/**
 * The permissions on the repository whose holders' comments can be the engine's earlier return:
 * the engine posts with write access, as a judge's marker counts only from an account holding one
 * of these (`readMarkers`).
 */
const RETURNERS = ['admin', 'maintain', 'write'];

/**
 * L2's answer returning `card`'s acceptance to its author for `marker`, which rules its coverage
 * insufficient: one comment on `pull`, the card's open pull request, quoting the marker's role and
 * its `coverageReason` (`R-LOOP-6`). Its first line names the marker's role, head and digest, so
 * the comment is the one return for that marker: where `comments` already hold it, written by an
 * account with write access and its text the same but for line endings and trailing whitespace,
 * L2 answers `ignore` and no second comment. A copy by any other account, or another comment
 * opening on that line, is no return and stops none. Its second line opens no marker block, so it
 * parses as no marker and never governs.
 */
function returned(card, pull, comments, { role, head, digest, coverageReason }) {
  const first = `Rigger returns card #${card.number}'s acceptance to its author: the judge ${role} ruled its coverage insufficient at head ${head}, acceptance digest ${digest}.`;
  const comment = [first, '', `${role}'s reason: ${coverageReason}`, '', 'The acceptance returns to its author, who revises it. No judge rewrites it.', ''].join('\n');
  const same = (body) => String(body).replace(/\r\n/g, '\n').trimEnd() === comment.trimEnd();
  if (comments.some((each) => each.author !== null && RETURNERS.includes(each.permission) && same(each.body))) {
    return { action: 'ignore', reason: `pull request #${pull.number} already holds the comment returning the acceptance for ${role}'s marker at head ${head}, acceptance digest ${digest}` };
  }
  return { action: 'return', pull: pull.number, comment };
}

/** The rounds a kind gets where it declares none (`R-LOOP-9`). */
const ROUNDS = 3;

/** The lines of a comment's text that look like a marker's item line, `item <n>: …`, inside its block or not. */
const ITEM_LINE = /^item \d+:/gm;

/**
 * The readable markers `comment` holds for `round`, read against the item count its own block
 * rules on, whatever acceptance it ruled against. A block parses against exactly the count of the
 * items it rules on, so it is read against each count up to the item-like lines the comment holds,
 * prose after the block included, and the count it parses against is its own.
 */
function readableAtAnyCount(comment, round) {
  for (let count = (String(comment.body).match(ITEM_LINE) ?? []).length; count >= 0; count -= 1) {
    const { markers } = readMarkers([comment], { ...round, count });
    if (markers.length > 0) return markers;
  }
  return [];
}

/**
 * The rounds a card's pull request has spent, from its `comments` read for `round`: the distinct
 * (head, digest) pairs at which a readable, unedited marker of one of the agent judges in
 * `required` stands, on the provider `required` names for it (`D24`), a pair at a
 * head the pull request no longer holds included (the architect's r2 ruling 7 on #642). A marker
 * from an earlier acceptance ruled on that acceptance's items, however many it held, so each is
 * read as `readableAtAnyCount` reads it: a marker valid against its own acceptance spends its round
 * after an item is added or removed, and whatever prose its comment holds.
 */
function roundsOf(comments, round, required) {
  const pairs = comments.filter((comment) => !comment.edited).flatMap((comment) => readableAtAnyCount(comment, round));
  return new Set(pairs.filter((marker) => required.has(marker.role) && marker.provider === required.get(marker.role)).map((marker) => `${marker.head} ${marker.digest}`)).size;
}

/**
 * L2's continuing attempt on `pull`, the card's open pull request, at the head L2 read: the maker
 * is handed each of `markers`, the governing markers that are not sound, as its role, its verdict,
 * each unmet item by its ordinal and its text among `items`, and its `toSound` where it gives one.
 */
function continued(pull, markers, items) {
  const handedOf = ({ role, verdict, items: ruled, toSound }) => ({
    role,
    verdict,
    unmet: ruled.flatMap((ruling, at) => (ruling === 'unmet' ? [{ item: at + 1, text: items[at] }] : [])),
    ...(toSound === undefined ? {} : { toSound }),
  });
  return { action: 'continue', pull: pull.number, head: pull.head, markers: markers.map(handedOf) };
}

/**
 * What a judge's governing marker `governing`, as `readMarkers` answers it, rules: `owed` where it
 * is absent, unreadable or edited, or, for an agent judge required to run on `provider`, where it
 * names no provider or another (`D24` rule 2); `critical`; `insufficient`, coverage ruled
 * insufficient; `revision`, needs revision or sound with an item unmet; or `sound`. The owner is
 * handed no provider, and `ownerAnswer` reads the owner's own.
 */
function stateOf(governing, provider) {
  if (governing?.state !== 'marker' || governing.edited) return 'owed';
  if (provider !== undefined && governing.marker.provider !== provider) return 'owed';
  const { verdict, coverage, items } = governing.marker;
  if (verdict === 'critical') return 'critical';
  if (coverage === 'insufficient') return 'insufficient';
  if (verdict !== 'sound' || items.includes('unmet')) return 'revision';
  return 'sound';
}

/**
 * The forge facts every advance of a Review or Owner card rests on, `card`'s mergeability, its base
 * branch's effective rules and its check states, each held, so a failed read of any one answers no
 * action naming it, whatever the others answered (the answers table's failed-read row).
 */
function forgeFacts(card) {
  return { mergeable: held(card, 'mergeable'), rules: held(card, 'rules'), states: held(card, 'checks') };
}

/** `answer`, L2's advance of `card`, once every read `forgeFacts` holds was served. */
function advanced(card, answer) {
  forgeFacts(card);
  return answer;
}

/**
 * L2's merge decision for `card` once every one of `panel`, the panel function's entries, is sound
 * at `pull`'s head. Where the
 * forge reads the pull request as conflicting, the card's maker continues on it (`R-CONFLICT-1`);
 * where its mergeability is unknown, L2 answers `ignore`, naming it (the architect's r2 ruling 5).
 * Otherwise the gate rule is handed the checks the base branch's effective rules require, less the
 * gate's own context, each in the state the facts hold, `absent` where they hold none (`ARCHITECTURE.md`,
 * "The engine's merge decision"): it answers `merge` where the gate admits, and `ignore` naming each
 * refusal where it does not. L2 judges no status's creator; the forge enforces the pin at the merge.
 * A failed read of the mergeability, the rules or the check states answers no action, naming it,
 * whatever the other reads answered.
 */
function mergeAnswer(card, panel, pull, comments, round) {
  const { mergeable, rules, states } = forgeFacts(card);
  if (mergeable === 'conflicting') return continued(pull, [], []);
  if (mergeable !== 'mergeable') return { action: 'ignore', reason: `the forge reads pull request #${pull.number}'s mergeability as ${mergeable}` };
  const required = new Set(rules.map((rule) => rule.context).filter((context) => context !== GATE_CONTEXT));
  const checks = Object.fromEntries([...required].map((context) => [context, states[context] ?? { state: 'absent', creator: null }]));
  const gate = gateAnswer({ comments, ...round, judges: panel, checks });
  if (gate.admit) return { action: 'merge', pull: pull.number, head: pull.head };
  return { action: 'ignore', reason: gate.refusals.map((refusal) => `${refusal.judge ?? refusal.check}: ${refusal.reason}`).join('; ') };
}
