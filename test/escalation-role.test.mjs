// ABOUTME: Tests L2's escalation route, role instructions and settlement without a live provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTING_LINE, dispatchedEscalation } from '../src/workflow/escalation.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { BODY, DISPATCH, HEAD, REASON, escalationWorld, postedNote } from './escalation-world.mjs';

// The counterexample is a routing post that loses the maker's reason or the open work identifiers.
// proves R-ESCALATE-23
test('routing posts the fixed first line and every selected field below it with literal special characters', async () => {
  const here = await escalationWorld({ pull: true });
  await here.l2.routed(here.card, here.next);
  const [first, ...below] = here.repository.held().issues[0].comments[0].body.split('\n');
  assert.equal(first, ROUTING_LINE);
  const text = below.join('\n');
  for (const field of ['Role: pm', 'Category: ambiguous', 'Acceptance item: 2', REASON, 'Pull request: #77', `Head: ${HEAD}`]) {
    assert.ok(text.includes(field), `routing comment lost ${field}`);
  }
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// The counterexample is reusing a judge instruction, leaking a verdict or leaving the maker's dispatch id.
// proves R-ESCALATE-18
test('the role instruction carries the card acceptance note and open work but no judge verdict and stamps its own note form', async () => {
  const here = await escalationWorld({ pull: true });
  const answer = (await here.l2.routed(here.card, here.next)).role;
  const roleDispatch = 'd-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(typeof answer.instruction, 'string', 'the role needs its own instruction');
  const stamped = dispatchedEscalation(answer, roleDispatch);
  for (const text of ['card #12', 'Choose a widget colour', 'The widget prints "ready".', 'A second press stops it.', REASON, '#77', HEAD]) {
    assert.ok(stamped.instruction.includes(text), `role instruction lost ${text}`);
  }
  assert.match(stamped.instruction, /only the card's author changes an acceptance/i);
  assert.match(stamped.instruction, new RegExp('```rigger-escalation\\ncategory:.*\\nitem:.*\\nreason:.*\\ndispatch: ' + roleDispatch + '\\n```'));
  assert.doesNotMatch(stamped.instruction, /<the dispatch id>|PRIVATE JUDGE VERDICT|rigger-verdict|verdict:|coverage:/);
  assert.doesNotMatch(JSON.stringify(answer.facts), /PRIVATE JUDGE VERDICT|comments|verdict|marker/);
  assert.deepEqual(answer.facts.acceptance, ['The widget prints "ready".', 'A second press stops it.']);
  assert.equal(answer.facts.reason, REASON);
  assert.equal(answer.facts.card, 12);
});

// The counterexample is dispatching the destination at its defaults despite selecting labels.
test('the escalation role uses providerOf and tierOf label selections and its configured timeout', async () => {
  const here = await escalationWorld({ labels: ['route:codex', 'route:high'], roles: {
    pm: { agent: '.claude/agents/pm.md', provider: 'claude', tier: 'standard', timeout: 12345,
      providerLabels: { 'route:codex': 'codex' }, labels: { 'route:high': 'high' } },
  } });
  const answer = (await here.l2.routed(here.card, here.next)).role;
  assert.deepEqual({ agent: answer.agent, provider: answer.provider, tier: answer.tier, timeout: answer.timeout },
    { agent: '.claude/agents/pm.md', provider: 'codex', tier: 'high', timeout: 12345 });
});

// A provider conflict must be found before the routing post, so no false already-routed fact appears.
test('two providers for the destination go to the owner naming both labels without a routing post', async () => {
  const here = await escalationWorld({ labels: ['route:a', 'route:b'], roles: { pm: {
    agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high', providerLabels: { 'route:a': 'claude', 'route:b': 'codex' },
  } } });
  const next = await here.l2.routed(here.card, here.next);
  assert.deepEqual([next.action, next.destination, next.category, next.raiser], ['escalate', 'owner', 'ambiguous', 'loop']);
  assert.match(next.reason, /providers.*pm.*route:a.*route:b/);
  assert.deepEqual(here.repository.held().issues[0].comments, []);
  assert.deepEqual(here.events(), []);
});

// A tier conflict needs the same pre-post refusal as a provider conflict.
test('two tiers for the destination go to the owner naming both labels without a routing post', async () => {
  const here = await escalationWorld({ labels: ['route:a', 'route:b'], roles: { pm: {
    agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high', labels: { 'route:a': 'standard', 'route:b': 'high' },
  } } });
  const next = await here.l2.routed(here.card, here.next);
  assert.deepEqual([next.action, next.destination, next.category, next.raiser], ['escalate', 'owner', 'ambiguous', 'loop']);
  assert.match(next.reason, /tiers.*pm.*route:a.*route:b/);
  assert.deepEqual(here.repository.held().issues[0].comments, []);
  assert.deepEqual(here.events(), []);
});

// The counterexample is losing the refused write behind a generic role-dispatch error.
test('a refused routing write names that write in the failure and its event with no board or issue changes', async () => {
  const here = await escalationWorld({ refuse: 'forge denied routing' });
  await assert.rejects(here.l2.routed(here.card, here.next), /routing comment.*refused.*forge denied routing/);
  const failed = here.events().find((event) => event.event === 'escalation.route-refused');
  assert.match(failed.reason, /routing comment.*forge denied routing/);
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held().issues[0].comments, []);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// Exiting zero without a note must move a card with an open PR to Review.
test('a role exiting zero without a note moves its open pull to Review', async () => {
  const here = await escalationWorld({ pull: true });
  assert.equal(typeof here.l2.roleSettled, 'function', 'L2 must settle the escalation role');
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: DISPATCH });
  assert.equal(next.action, 'handled');
  assert.deepEqual(here.fake.writes(), [{ operation: 'moveItem', args: [here.card.id, here.settings.board.columns.review] }]);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// A non-zero exit with an open PR must not be mistaken for a handled escalation.
// proves R-ESCALATE-21, R-ESCALATE-25
test('a role exiting non-zero goes to the owner as a loop ambiguity without moving to Review', async () => {
  const here = await escalationWorld({ pull: true });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 7 } }, { dispatch: DISPATCH });
  assert.deepEqual([next.action, next.category, next.raiser, next.destination], ['escalate', 'ambiguous', 'loop', 'owner']);
  assert.match(next.reason, /pm.*exited 7/);
  assert.deepEqual(here.fake.writes(), []);
});

// A note under the role dispatch takes precedence over zero exit and preserves its category.
// proves R-ESCALATE-21, R-ESCALATE-24
test('a critical note under the role dispatch goes to the owner retaining its category and ordinal', async () => {
  const here = await escalationWorld({ pull: true, comments: [postedNote(DISPATCH, 'critical')] });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: DISPATCH });
  assert.deepEqual([next.action, next.category, next.item, next.reason, next.raiser, next.destination], ['escalate', 'critical', 2, REASON, 'loop', 'owner']);
  assert.deepEqual(here.fake.writes(), []);
});

// A first NOT_STARTED is the role's retry, with no maker retry and no owner write.
// proves R-ESCALATE-26
test('the first role dispatch that never starts answers a role-only retry', async () => {
  const here = await escalationWorld({ pull: true });
  const outcome = { status: 'rejected', reason: Object.assign(new Error('no provider adapter'), { code: 'NOT_STARTED' }) };
  const next = await here.l2.roleSettled(here.card, here.next, outcome, { dispatch: DISPATCH });
  assert.equal(next.action, 'again');
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held().issues[0].comments, []);
});

// Distinct failure causes still consume the one retry; the fifth class never holds admission.
// proves R-ESCALATE-21, R-ESCALATE-26
test('two role starts failing for different causes go to the owner without a hold', async () => {
  const here = await escalationWorld();
  const outcome = { status: 'rejected', reason: Object.assign(new Error('scratch directory not made'), { code: 'NOT_STARTED' }) };
  const firstFailure = { status: 'rejected', reason: Object.assign(new Error('no provider adapter'), { code: 'NOT_STARTED' }) };
  const next = await here.l2.roleSettled(here.card, here.next, outcome, { dispatch: DISPATCH, firstFailure });
  assert.deepEqual([next.action, next.category, next.raiser, next.destination], ['escalate', 'ambiguous', 'loop', 'owner']);
  assert.match(next.reason, /no provider adapter.*scratch directory not made/s);
  assert.deepEqual(here.fake.writes(), []);
});

// A directory the replace rule answered and refused must never consume the role retry.
// proves R-ESCALATE-12
test('an answered escalation directory refusal goes straight to the owner through the card-local path', async () => {
  const here = await escalationWorld();
  const reason = Object.assign(new Error('R-WORK-32 refuses /escalations/rigger-12/pm'), { code: 'WORKSPACE_REFUSED' });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'rejected', reason });
  assert.deepEqual([next.action, next.category, next.raiser, next.destination], ['escalate', 'ambiguous', 'loop', 'owner']);
  assert.equal(next.reason, reason.message);
  assert.deepEqual(here.fake.writes(), []);
});

// An unrecordable outcome is neither a zero exit nor an environment retry.
test('a refused role event leaves the card and forge untouched and answers no action', async () => {
  const here = await escalationWorld({ pull: true, comments: [postedNote()] });
  const reason = Object.assign(new Error('the event was refused'), { code: 'EVENT_REFUSED' });
  assert.equal(await here.l2.roleSettled(here.card, here.next, { status: 'rejected', reason }), undefined);
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// The remaining note categories share the same role-dispatch selection boundary.
// proves R-ESCALATE-24
test('an ambiguous role note goes to the owner rather than routing to another role', async () => {
  const here = await escalationWorld({ comments: [postedNote(DISPATCH, 'ambiguous')] });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: DISPATCH });
  assert.deepEqual([next.category, next.raiser, next.destination], ['ambiguous', 'loop', 'owner']);
});

// proves R-ESCALATE-24
test('a recorded-decision role note retains its category even when the role exits non-zero', async () => {
  const here = await escalationWorld({ comments: [postedNote(DISPATCH, 'recorded-decision')] });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 8 } }, { dispatch: DISPATCH });
  assert.deepEqual([next.category, next.raiser, next.destination], ['recorded-decision', 'loop', 'owner']);
});

// A maker's old note must not make the role appear to have escalated again.
// proves R-ESCALATE-24
test('the role settle ignores the maker note under a different dispatch', async () => {
  const here = await escalationWorld({ pull: true, comments: [postedNote()] });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: 'd-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.equal(next.action, 'handled');
  assert.equal(here.fake.writes()[0].args[1], here.settings.board.columns.review);
});

// The counterexample is attempting a Review move where no PR exists.
test('a handled role with no pull and no pushed line leaves the card in Coding for a fresh maker attempt', async () => {
  const here = await escalationWorld();
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'fulfilled', value: { exit: 0 } }, { dispatch: DISPATCH });
  assert.equal(next.action, 'handled');
  assert.deepEqual(next.facts.open, []);
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// A refused scratch directory is answered, not a failed make.
// proves R-ESCALATE-12
test('a scratch refusal goes to the owner on the first try with the refusal path intact', async () => {
  const here = await escalationWorld();
  const reason = Object.assign(new Error('R-WORK-26 refuses /scratch/rigger-12/pm'), { code: 'SCRATCH_REFUSED' });
  const next = await here.l2.roleSettled(here.card, here.next, { status: 'rejected', reason });
  assert.deepEqual([next.action, next.category, next.raiser, next.destination, next.reason], ['escalate', 'ambiguous', 'loop', 'owner', reason.message]);
  assert.deepEqual(here.fake.writes(), []);
});

test('a refused role process-group record answers no action or forge changes', async () => {
  const here = await escalationWorld({ pull: true, comments: [postedNote()] });
  const before = here.repository.held();
  const reason = Object.assign(new Error('the record refused removal'), { code: 'RECORD_REFUSED' });
  assert.equal(await here.l2.roleSettled(here.card, here.next, { status: 'rejected', reason }), undefined);
  assert.deepEqual(here.fake.writes(), []);
  assert.deepEqual(here.repository.held(), before);
});

// Removing #998's interim must remove the owner-comment fallback, not merely avoid its caller.
test('owner escalation comments no longer describe a role as not dispatched', async () => {
  const here = await escalationWorld();
  await here.l2.escalated(here.card, here.next);
  assert.doesNotMatch(here.repository.held().issues[0].comments[0].body, /Not sent to the role/);
});

// User-supplied text can contain the dispatch-slot spelling and must not consume its replacement.
// proves R-ESCALATE-18
test('a title and maker reason containing the dispatch slot cannot steal the role note dispatch id', async () => {
  const here = await escalationWorld();
  here.card.title = 'Keep dispatch: <the dispatch id> literal';
  here.next.reason = 'Explain dispatch: <the dispatch id> to the author.';
  const answer = (await here.l2.routed(here.card, here.next)).role;
  const stamped = dispatchedEscalation(answer, DISPATCH).instruction;
  const block = stamped.match(/```rigger-escalation\n[\s\S]*?\n```/)[0];
  assert.ok(block.includes(`dispatch: ${DISPATCH}`), 'the role note form must carry its own dispatch id');
  assert.ok(stamped.includes(here.card.title), 'the title must stay literal');
  assert.ok(stamped.includes(here.next.reason), 'the maker reason must stay literal');
});

// A route using the shared writer would lose the card and dispatch on L0 containment events.
// proves R-RECORD-7
test('routing comment transport records its card and dispatch context', async () => {
  for (const dispatch of [DISPATCH, undefined]) {
    const here = await escalationWorld();
    const requests = [];
    // runners.mjs hands send the admitted gh arguments and caller-owned L0 emitter.
    // Stand in for process.mjs recording containment; no forge or process is invoked.
    const send = async (command, args, { emitter }) => {
      assert.equal(command, 'gh');
      requests.push(args);
      emitter.emit('survivor.killed', { group: 424242, pid: 424243, name: 'gh helper', cmd: 'gh helper' });
      return { status: 0, stdout: '{"id":1}', stderr: '' };
    };
    const l2 = columnChanges({ config: here.settings, sink: here.sink, items: here.fake.operations,
      reads: here.repository.operations, send });
    await l2.routed(here.card, { ...here.next, dispatch });
    assert.deepEqual(requests.map((args) => args.slice(0, 4)),
      [['api', 'repos/williacj/rigger/issues/12/comments', '-X', 'POST']]);
    assert.ok(requests[0].some((arg) => arg.startsWith('body=' + ROUTING_LINE)));
    const events = here.events().filter((event) => event.event === 'survivor.killed');
    assert.equal(events.length, 1, 'the production repository writer must reach the transport');
    assert.equal(events[0].card, 12, 'R-RECORD-7: the routing post containment event must name card #12');
    assert.equal(events[0].dispatch, dispatch ?? null, 'R-RECORD-7: the routing post must retain its dispatch context');
  }
});
