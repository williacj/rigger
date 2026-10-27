// ABOUTME: Tests L2's card-local escalation answers and their separation from host and form failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextAction } from '../src/workflow/next-action.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';

const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect'] } };
const CARD = { number: 7, title: 'Add a verb', body: '## Acceptance\n\n- The verb prints its help.\n', labels: ['type:change'], column: 'Ready' };
const rejected = (code, message, path = '/work/rigger-7') => ({ status: 'rejected', reason: Object.assign(new Error(message), { code, path }) });

/** L2's attempt answer and the events it wrote, over a report in L1's documented vocabulary. */
function attempted(options) {
  const events = [];
  const sink = { emitter: () => ({ emit: (event, fields) => events.push({ event, ...fields }) }) };
  return { answer: nextAction(CARD, KINDS, undefined, { provisioning: {}, sink, ...options }), events };
}

// A plausible defect keeps K51's stop or retries a refusal as a host failure.
// proves R-ESCALATE-12
test('each workspace and maker scratch refusal escalates on its attempt with its exact reason', async (t) => {
  for (const [name, code, reason] of [
    ['workspace path', 'WORKSPACE_REFUSED', 'R-WORK-13 refused /work/a\nowner\'s [file]'],
    ['continuing workspace on another line', 'WORKSPACE_REFUSED', 'R-WORK-15 holds another branch'],
    ['continuing workspace detached', 'WORKSPACE_REFUSED', 'R-WORK-15 holds detached HEAD'],
    ['branch checked out elsewhere', 'BRANCH_ELSEWHERE', 'R-WORK-25 rigger-7 is checked out at /elsewhere'],
    ['maker scratch', 'SCRATCH_REFUSED', 'R-WORK-26 refused /scratch/engineer'],
  ]) await t.test(name, () => {
    const report = rejected(code, reason);
    const { answer, events } = attempted(code === 'SCRATCH_REFUSED' ? { maker: report } : { workspace: report });
    assert.equal(answer.action, 'escalate');
    assert.equal(answer.category, 'ambiguous');
    assert.equal(answer.raiser, 'loop');
    assert.equal(answer.destination, 'owner');
    assert.equal(answer.reason, reason);
    assert.equal(answer.failure.class, 'card-local');
    assert.deepEqual(events.map(({ event, decision }) => [event, decision]), [['attempt.failed', undefined], ['attempt.decided', 'escalate']]);
  });
});

const quiet = { emitter: () => ({ emit() {} }) };
const forgeCard = (stage, facts = {}) => ({ ...CARD, forge: { stage, line: 'rigger-7', branch: false, open: [], merged: [], closed: [], ...facts } });
const read = (value) => ({ status: 'fulfilled', value });
const reviewCard = () => forgeCard('review', {
  branch: true, open: [{ number: 71, head: 'a'.repeat(40), base: 'main' }],
  pull: read({ number: 71, head: 'a'.repeat(40), base: 'b'.repeat(40) }), comments: read([]), diff: read('diff --git a/x b/x\n'),
});

// The counterexample converts only closed-card removal or misses one column's forge refusal.
// proves R-ESCALATE-12
test('each qualifying forge refusal escalates at the pull naming what the forge holds', async (t) => {
  for (const [stage, facts, names] of [
    ['ready', { branch: true }, ['rigger-7']],
    ['coding', { branch: true }, ['rigger-7']],
    ['review', { branch: true }, ['rigger-7']],
    ['ready', { merged: [{ number: 71 }] }, ['#71', 'rigger-7']],
    ['coding', { merged: [{ number: 71 }] }, ['#71', 'rigger-7']],
    ['review', { open: [{ number: 71 }, { number: 72 }] }, ['#71', '#72']],
    ['owner', {}, ['no pull request', 'rigger-7']],
  ]) await t.test(`${stage}: ${JSON.stringify(facts)}`, () => {
    const answer = nextAction(forgeCard(stage, facts), KINDS, undefined, { sink: quiet });
    assert.equal(answer.action, 'escalate');
    assert.equal(answer.category, 'ambiguous');
    assert.equal(answer.raiser, 'loop');
    assert.equal(answer.line, 'rigger-7');
    for (const name of names) assert.ok(answer.reason.includes(name), answer.reason);
  });
});

// The counterexample withholds a refusal as a host failure, or drops one refused role.
// proves R-ESCALATE-12
test('L2 escalates each judge directory or scratch refusal and combines every named refusal', async (t) => {
  for (const [name, directories, reasons] of [
    ['directory', { reviewer: rejected('WORKSPACE_REFUSED', 'R-WORK-20 refused reviewer') }, ['reviewer: R-WORK-20 refused reviewer']],
    ['scratch', { reviewer: rejected('SCRATCH_REFUSED', 'R-WORK-26 refused reviewer') }, ['reviewer: R-WORK-26 refused reviewer']],
    ['both', { reviewer: rejected('WORKSPACE_REFUSED', 'first refusal'), architect: rejected('SCRATCH_REFUSED', 'second refusal') }, ['reviewer: first refusal', 'architect: second refusal']],
  ]) await t.test(name, () => {
    const answer = judgeAnswer(reviewCard(), KINDS, undefined, { sink: quiet, directories });
    assert.equal(answer.action, 'escalate');
    assert.equal(answer.category, 'ambiguous');
    assert.equal(answer.raiser, 'loop');
    assert.equal(answer.reason, reasons.join('\n'));
    assert.equal(answer.pull, 71);
    assert.equal(answer.head, 'a'.repeat(40));
  });
});

// A plausible defect lets a mixed pair stop or hold instead of reporting its refusal.
// proves R-ESCALATE-12
test('an attempt pair containing a host failure and a refusal escalates in either order', async (t) => {
  const local = { class: 'card-local', workspace: '/work/rigger-7', code: 'WORKSPACE_REFUSED', reason: 'R-WORK-13 refused the path' };
  const host = { class: 'environment', workspace: '/work/rigger-7', reason: 'EACCES reading the path' };
  for (const [firstFailure, last] of [[host, local], [local, host]]) await t.test(`${firstFailure.class} then ${last.class}`, () => {
    const workspace = rejected(last.code ?? 'WORKSPACE_NOT_MADE', last.reason);
    const { answer, events } = attempted({ attempt: 2, firstFailure, workspace });
    assert.equal(answer.action, 'escalate');
    assert.equal(answer.reason, local.reason);
    assert.equal(events.at(-1).decision, 'escalate');
  });
});

// The counterexample converts a form or provider refusal along with the forge's refusal.
// proves R-ESCALATE-12
test('forge precedence is preserved and tier provider kind and form conflicts stay ordinary refusals', async (t) => {
  const roles = { engineer: { tier: 'standard', provider: 'claude', labels: { low: 'standard', high: 'high' }, providerLabels: { claude: 'claude', codex: 'codex' } } };
  const given = forgeCard('ready', { branch: true });
  const ordinary = nextAction(given, KINDS, undefined, { roles, sink: quiet });
  const malformed = nextAction({ ...given, body: 'No acceptance.' }, KINDS, undefined, { roles, sink: quiet });
  assert.equal(malformed.action, 'escalate');
  assert.equal(malformed.reason, ordinary.reason);
  for (const [name, labels, facts, body, kinds, names] of [
    ['forge with tier conflict', ['low', 'high'], { branch: true }, CARD.body, KINDS, ['low', 'high', 'rigger-7']],
    ['forge with provider conflict', ['claude', 'codex'], { branch: true }, CARD.body, KINDS, ['claude', 'codex', 'rigger-7']],
    ['tier alone', ['low', 'high'], {}, CARD.body, KINDS, ['low', 'high']],
    ['provider alone', ['claude', 'codex'], {}, CARD.body, KINDS, ['claude', 'codex']],
    ['form alone', [], {}, 'No acceptance.', KINDS, ['missing acceptance']],
    ['kinds alone', ['type:other'], {}, CARD.body, { ...KINDS, other: { ...KINDS.change, select: { labels: ['type:other'] } } }, ['change', 'other']],
  ]) await t.test(name, () => {
    const answer = nextAction({ ...forgeCard('ready', facts), labels: [...CARD.labels, ...labels], body }, kinds, undefined, { roles, sink: quiet });
    assert.equal(answer.action, 'refuse');
    for (const text of names) assert.ok(answer.reason.includes(text), answer.reason);
  });
});

// The counterexample interprets an unanswered condition as a card-local refusal.
// proves R-ESCALATE-12
test('workspace judge directory and role scratch host errors never answer escalation', async (t) => {
  const workspace = rejected('WORKSPACE_NOT_MADE', 'EACCES reading workspace');
  assert.equal(attempted({ workspace }).answer.action, 'again');
  const maker = rejected('NOT_STARTED', 'ENOSPC making scratch');
  assert.equal(attempted({ maker }).answer.action, 'again');
  for (const [name, report, expected] of [
    ['judge directory', rejected('WORKSPACE_NOT_MADE', 'EACCES reading judge'), ['reviewer']],
    ['judge scratch', { status: 'rejected', reason: Object.assign(new Error('EACCES reading scratch'), { code: 'NOT_STARTED', missing: '/scratch/reviewer' }) }, ['reviewer']],
    ['other dispatch never started', rejected('NOT_STARTED', 'adapter rejected its invocation'), undefined],
  ]) await t.test(name, () => {
    const answer = judgeAnswer(reviewCard(), KINDS, undefined, { sink: quiet, directories: { reviewer: report } });
    assert.equal(answer.action, 'judge');
    assert.deepEqual(answer.withheld, expected);
    assert.equal(answer.judges.some(({ role }) => role === 'reviewer'), expected === undefined);
  });
});
