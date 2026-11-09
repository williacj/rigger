// ABOUTME: Exercises escalation roles through real L1 dispatches under L3's one card claim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loop } from '../src/scheduling/loop.mjs';
import { admission } from '../src/scheduling/admission.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { ROUTING_LINE } from '../src/workflow/escalation.mjs';
import { makingWorkspaces, makingJudgeDirectories, handleOn } from './loop-world.mjs';
import { standInAgent } from './stub-claude.mjs';
import { escalationWorld, postedNote, HEAD } from './escalation-world.mjs';

/**
 * Actual provider and L1 dispatch, with the existing plain-directory make doubles. The sink
 * observes each completed stand-in and posts its note through the fake forge's documented
 * write contract. Production settlement still reads that note through repository operations.
 */
async function world(options = {}) {
  const here = await escalationWorld(options);
  const agent = standInAgent({ 12: { engineer: { exit: 7 }, pm: { exit: options.exit ?? 0 } } });
  const roles = new Map();
  const order = [];
  const sink = { emitter: (context) => {
    const inner = here.sink.emitter(context);
    return { emit: (event, fields) => {
      if (context.layer === 'L3' && event === 'dispatch' && fields.role) roles.set(context.dispatch, fields.role);
      if (context.layer === 'L1' && event === 'dispatch.end' && roles.get(context.dispatch) === 'pm' && options.refuseEnd) throw new Error('the role dispatch.end was refused');
      inner.emit(event, fields);
      order.push({ layer: context.layer, event, dispatch: context.dispatch, ...fields });
      if (context.layer === 'L1' && event === 'dispatch.end' && roles.get(context.dispatch) === 'pm' && options.note) {
        here.repository.postIssueComment(12, postedNote(context.dispatch, options.note).body);
      }
      if (context.layer === 'L1' && event === 'dispatch.end' && roles.get(context.dispatch) === 'engineer') {
        if (options.openPull) here.repository.open({ number: 77, head: 'rigger-12', sha: HEAD, comments: [{ body: 'PRIVATE JUDGE VERDICT' }] });
        options.afterMaker?.(here);
        here.repository.postIssueComment(12, postedNote(context.dispatch).body);
      }
    } };
  } };
  const writes = { ...here.repository, postIssueComment: async (number, body) => {
    if (body.startsWith(ROUTING_LINE) && options.refuseRoute) throw new Error('forge denied routing');
    return here.repository.postIssueComment(number, body);
  } };
  const l2 = columnChanges({ config: here.settings, sink, items: here.fake.operations, reads: here.repository.operations, repositoryWrites: writes,
    roleReads: () => here.repository.operations });
  const workspaces = makingWorkspaces(join(here.directory, 'worktrees'));
  const directories = makingJudgeDirectories(join(here.directory, 'escalation-makes'));
  const escalationDirectory = async (...args) => {
    assert.equal(here.repository.held().issues[0].comments.at(-1).body.split('\n')[0], ROUTING_LINE, 'routing post must precede directory creation');
    order.push({ event: 'escalation.make' });
    const count = order.filter((event) => event.event === 'escalation.make').length;
    if (options.directoryFailures?.[count - 1]) throw options.directoryFailures[count - 1];
    const made = await directories(...args);
    options.beforeDispatch?.(made, count, here);
    return made;
  };
  const decide = (card, outcomes, extra) => nextAction(card, here.settings.kinds, undefined, { roles: here.settings.roles, provisioning: {}, sink, outcomes, ...extra });
  const handed = { config: here.settings, board: handleOn(here.fake, { columns: here.settings.board.columns, beforeRead: options.beforeRead }), decide,
    facts: factsCall({ config: here.settings, reads: here.repository.operations, decide }), l2, sink,
    kill: async () => {}, workspace: workspaces, judgeDirectory: async () => { assert.fail('judges must not run in the escalation role slot'); },
    escalationDirectory, removeDirectories: async () => {}, state: here.directory,
    environment: { ...process.env, PATH: agent.first() },
    run: 'r-test',
  };
  return { ...here, l2, handed, agent, order, directories, workspaces, run: () => loop(handed).pull(1), runAll: () => loop(handed).run() };
}

// The counterexample is the interim owner path, a judge dispatch, or dispatch before the route.
// proves R-ESCALATE-13, R-ESCALATE-18, R-ESCALATE-23
test('L3 posts the route then makes both directories and dispatches the role in place of judges under one claim', { timeout: 20000 }, async () => {
  const here = await world();
  const result = await here.run();
  const dispatched = here.order.filter((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.deepEqual(dispatched.map((event) => event.role), ['engineer', 'pm']);
  const pm = dispatched[1];
  const events = here.events();
  const start = events.find((event) => event.event === 'dispatch.start' && event.dispatch === pm.dispatch);
  assert.equal(start.facts.card, 12);
  assert.deepEqual(start.facts.acceptance, ['The widget prints "ready".', 'A second press stops it.']);
  assert.equal(start.facts.reason, "Choose `blue` or \"green\"; preserve $HOME and \\.");
  assert.doesNotMatch(JSON.stringify(start.facts), /verdict|marker|comments/);
  const scratch = events.findIndex((event) => event.event === 'workspace.made' && event.role === 'pm');
  assert.ok(scratch < events.indexOf(start), 'scratch precedes the dispatch');
  assert.equal(here.workspaces.made.length, 1);
  assert.equal(here.directories.made.length, 1);
  assert.equal(events.filter((event) => event.event === 'pull').length, 1);
  assert.equal(events.filter((event) => event.event === 'slot.release').length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// Table S: one failed directory make must retry only the role, creating its directories again.
// proves R-ESCALATE-26
test('a role that never starts is retried alone under the same routing comment and claim', { timeout: 20000 }, async () => {
  const missing = Object.assign(new Error('escalation directory missing'), { code: 'NOT_STARTED', missing: '/escalations/rigger-12/pm' });
  const here = await world({ directoryFailures: [missing] });
  const result = await here.run();
  assert.equal(here.order.filter((event) => event.event === 'escalation.make').length, 2);
  assert.equal(here.workspaces.made.length, 1, 'the maker workspace must not be retried');
  assert.deepEqual(here.order.filter((event) => event.layer === 'L3' && event.event === 'dispatch').map((event) => event.role), ['engineer', 'pm']);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 1);
  assert.equal(admission({ directory: here.directory, sink: here.sink }).read().state, 'open');
});

// A refused routing write is remembered by this invocation before the slot is freed.
test('a refused routing post dispatches no role and the run never pulls that card again', { timeout: 20000 }, async () => {
  let reads = 0;
  const here = await world({ refuseRoute: true, beforeRead: () => {
    reads += 1;
    assert.ok(reads <= 2, 'the run pulled the refused routing write again');
  } });
  await assert.rejects(here.runAll());
  assert.equal(here.workspaces.made.length, 1, 'the refused card must be excluded before the freed-slot pull');
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
  assert.equal(here.directories.made.length, 0);
  assert.equal(here.events().filter((event) => event.event === 'escalation.route-refused').length, 1);
});

/** Checks the shared card-local owner path, preserving the refused directory or role failure reason. */
async function ownerAfter(options, expectedMakes, reason) {
  const here = await world(options);
  await here.run();
  assert.equal(here.order.filter((event) => event.event === 'escalation.make').length, expectedMakes);
  const owner = here.events().filter((event) => event.event === 'review.escalate' && event.raiser === 'loop');
  assert.equal(owner.length, 1);
  assert.equal(owner[0].destination, 'owner');
  assert.equal(owner[0].category, options.note ?? 'ambiguous');
  assert.match(owner[0].reason, reason);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.owner);
  assert.deepEqual(here.repository.held().issues[0].labels, ['rigger:escalated']);
  assert.equal(admission({ directory: here.directory, sink: here.sink }).read().state, 'open');
  assert.equal(here.workspaces.made.length, 1);
  return here;
}

const unstarted = (message) => Object.assign(new Error(message), { code: 'NOT_STARTED' });
const refusedDirectory = () => Object.assign(new Error('R-WORK-32 refuses /escalations/rigger-12/pm'), { code: 'WORKSPACE_REFUSED' });
const refusedScratch = (made) => {
  mkdirSync(made.scratch, { recursive: true });
  writeFileSync(join(made.scratch, 'pm'), 'a person left this file\n');
};

// proves R-ESCALATE-21, R-ESCALATE-26
test('two role starts failing for the same cause go to the owner and leave admission open', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('git gave no answer'), unstarted('git gave no answer')] }, 2, /did not start twice/);
});

// proves R-ESCALATE-21, R-ESCALATE-26
test('two role starts failing for different causes still go to the owner and never hold', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('git gave no answer'), unstarted('filesystem deadline')] }, 2, /git gave no answer.*filesystem deadline/);
});

// proves R-ESCALATE-12
test('a refused escalation directory goes through the existing card-local escalation without retry', { timeout: 20000 }, async () => {
  const here = await ownerAfter({ directoryFailures: [refusedDirectory()] }, 1, /R-WORK-32.*escalations/);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
});

// proves R-ESCALATE-12
test('a refused scratch directory goes through the existing card-local escalation without retry', { timeout: 20000 }, async () => {
  const here = await ownerAfter({ beforeDispatch: refusedScratch }, 1, /pm.*scratch.*rigger-12/);
  const path = join(here.directories.made[0].path, '..', '..', '..', 'scratch', 'rigger-12', 'pm');
  assert.equal(readFileSync(path, 'utf8'), 'a person left this file\n');
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
});

// proves R-ESCALATE-12, R-ESCALATE-26
test('the retry meeting an escalation directory refusal goes to the owner with no third make', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('git deadline'), refusedDirectory()] }, 2, /R-WORK-32/);
});

// proves R-ESCALATE-12, R-ESCALATE-26
test('the retry meeting a scratch refusal goes to the owner with no third make', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('git deadline')], beforeDispatch: refusedScratch }, 2, /scratch/);
});

// proves R-ESCALATE-21, R-ESCALATE-25
test('a role that starts and exits non-zero goes to the owner', { timeout: 20000 }, async () => {
  await ownerAfter({ exit: 7 }, 1, /pm.*exited 7/);
});

// proves R-ESCALATE-21, R-ESCALATE-25, R-ESCALATE-26
test('a retry that starts and exits non-zero goes to the owner', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('directory missing')], exit: 7 }, 2, /pm.*exited 7/);
});

// proves R-ESCALATE-21, R-ESCALATE-24
test('an ambiguous role note reaches the owner under the role dispatch id', { timeout: 20000 }, async () => {
  await ownerAfter({ note: 'ambiguous' }, 1, /Choose/);
});

// proves R-ESCALATE-21, R-ESCALATE-24
test('a critical role note reaches the owner under the role dispatch id', { timeout: 20000 }, async () => {
  await ownerAfter({ note: 'critical' }, 1, /Choose/);
});

// proves R-ESCALATE-21, R-ESCALATE-24
test('a recorded-decision role note reaches the owner under the role dispatch id', { timeout: 20000 }, async () => {
  await ownerAfter({ note: 'recorded-decision' }, 1, /Choose/);
});

// proves R-ESCALATE-21, R-ESCALATE-24, R-ESCALATE-26
test('a retry that starts and writes its own note goes to the owner', { timeout: 20000 }, async () => {
  await ownerAfter({ directoryFailures: [unstarted('directory missing')], note: 'critical' }, 2, /Choose/);
});

// proves R-ESCALATE-26
test('a provider with no adapter counts as two role starts and never as two maker attempts', { timeout: 20000 }, async () => {
  const here = await ownerAfter({ roles: { pm: { agent: '.claude/agents/pm.md', provider: 'missing', tier: 'high' } } }, 2, /no provider adapter/);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
});

// proves R-ESCALATE-26
test('an invocation rejection counts as two role starts and never closes admission', { timeout: 20000 }, async () => {
  await ownerAfter({ roles: { pm: { agent: '.claude/agents/pm.md', provider: 'claude', tier: 'unsupported' } } }, 2, /no invocation.*tier/);
});

// The routing post survives a dead invocation even though no role dispatch reached the record.
// proves R-ESCALATE-16
test('a second invocation after the routing post starts the maker fresh and sends its next note to the owner', { timeout: 20000 }, async () => {
  const here = await world();
  await here.l2.routed(here.card, here.next);
  assert.equal(here.events().filter((event) => event.event === 'dispatch').length, 0, 'the first invocation ended before dispatch');
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
  await here.run();
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
  assert.equal(here.workspaces.made.length, 1);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.owner);
});

// No forge work remains, so a handled role does not prevent the next maker start from main.
// proves R-ESCALATE-16
test('a handled role with no pull leaves the next invocation to start its maker from the beginning', { timeout: 20000 }, async () => {
  const here = await world();
  await here.run();
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding);
  await here.run();
  assert.equal(here.workspaces.made.length, 2);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm', 'engineer']);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.owner);
});

// Table S's handled end must also reread the PR the maker delivered before its note.
// proves R-ESCALATE-18, R-ESCALATE-26
test('a retried role handles its open pull and records only card acceptance reason and work identifiers', { timeout: 20000 }, async () => {
  const here = await world({ openPull: true, directoryFailures: [unstarted('directory missing')] });
  await here.run();
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.review);
  const start = here.events().find((event) => event.event === 'dispatch.start' && event.facts?.pull === 77);
  assert.ok(start, 'the role dispatch must identify its open work');
  assert.equal(start.digest, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Telemetry: the role start must record the SHA-256 of its empty evidence');
  assert.equal(start.facts.head, HEAD);
  assert.deepEqual(start.facts.acceptance, ['The widget prints "ready".', 'A second press stops it.']);
  assert.doesNotMatch(JSON.stringify(start.facts), /PRIVATE JUDGE VERDICT|verdict|marker|comments/);
  const role = here.agent.runs().find((run) => run.role === 'pm');
  assert.match(role.input, new RegExp('dispatch: ' + start.dispatch));
  assert.doesNotMatch(role.input, /PRIVATE JUDGE VERDICT|rigger-marker/);
  assert.equal(here.order.filter((event) => event.event === 'escalation.make').length, 2);
});

// Conflicts are L2's decision before the post; L3 must carry them through the owner path.
test('a destination provider conflict goes to the owner without posting a route or dispatching a role', { timeout: 20000 }, async () => {
  const here = await ownerAfter({ labels: ['route:a', 'route:b'], roles: { pm: {
    agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high', providerLabels: { 'route:a': 'claude', 'route:b': 'codex' },
  } } }, 0, /providers.*pm.*route:a.*route:b/);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 0);
});

test('a destination tier conflict goes to the owner without posting a route or dispatching a role', { timeout: 20000 }, async () => {
  const here = await ownerAfter({ labels: ['route:a', 'route:b'], roles: { pm: {
    agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high', labels: { 'route:a': 'standard', 'route:b': 'high' },
  } } }, 0, /tiers.*pm.*route:a.*route:b/);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 0);
});

// An actual refused end event must not turn the open PR into a Review move.
test('a role whose outcome rejects with EVENT_REFUSED leaves its open pull in Coding', { timeout: 20000 }, async () => {
  const here = await world({ openPull: true, refuseEnd: true });
  const [result] = await here.run();
  assert.equal(result.escalationRole.outcome.status, 'rejected');
  assert.equal(result.escalationRole.outcome.reason.code, 'EVENT_REFUSED');
  assert.equal(result.escalationRole.settled, undefined);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// A freed slot must not pull a maker whose ambiguity the role just handled in this invocation.
// proves R-LOOP-19
test('run leaves a handled card with nothing on the forge for a later maker invocation', { timeout: 20000 }, async () => {
  const here = await world();
  await here.runAll();
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm'], 'R-LOOP-19: the next maker belongs to a later invocation');
  assert.equal(here.workspaces.made.length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding);
  assert.deepEqual(here.repository.held().branches, []);
  assert.deepEqual(here.repository.held().pullRequests, []);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
  await here.runAll();
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm', 'engineer'], 'the next invocation must forget the maker exclusion');
  assert.equal(here.workspaces.made.length, 2);
  assert.equal(here.repository.held().issues[0].comments.filter((comment) => comment.body.startsWith(ROUTING_LINE)).length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.owner);
});

// A7's open-PR end must reach Review before this invocation releases the card.
test('run leaves the handled open pull in Review without dispatching judges in the freed slot', { timeout: 20000 }, async () => {
  const here = await world({ openPull: true });
  await assert.doesNotReject(here.runAll(), 'a handled role ends this invocation of the card');
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm']);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.review);
  assert.equal(here.repository.held().pullRequests[0].number, 77);
  assert.deepEqual(here.repository.held().issues[0].labels, []);
});

// The fake readBranches contract answers a pushed line only after the maker finishes.
test('run leaves a handled pushed line in Coding and only the later invocation refuses its fresh start', { timeout: 20000 }, async () => {
  const here = await world({ afterMaker: ({ repository }) => {
    repository.operations.readBranches = async (names) => Object.fromEntries(names.map((name) => [name, name === 'rigger-12']));
  } });
  await here.runAll();
  assert.deepEqual(await here.repository.operations.readBranches(['rigger-12']), { 'rigger-12': true });
  assert.deepEqual(here.repository.held().pullRequests, []);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm']);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.coding, 'pushed work must wait for a later invocation before R-WORK-19 refuses it');
  assert.deepEqual(here.repository.held().issues[0].labels, []);
  await here.runAll();
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm'], 'pushed work must refuse a fresh maker');
  assert.equal(here.workspaces.made.length, 1);
  assert.equal((await here.fake.operations.readItems())[0].column, here.settings.board.columns.owner);
  const escalation = here.events().filter((event) => event.event === 'review.escalate').at(-1);
  assert.equal(escalation.raiser, 'loop');
  assert.equal(escalation.destination, 'owner');
  assert.match(escalation.reason, /forge holds its line of work/);
});

import { judgeWorld as relayJudgeWorld, cardIn as relayJudgeCard } from './judge-world.mjs';
import { COLUMNS as relayColumns } from './loop-world.mjs';

// Architecture boundary 4 identity: R-RECORD-9 and R-SCHED-23 concern reporting/reopening,
// not original settlement facts or stdout Buffer identity.
for (const verb of ['pull', 'run']) for (const mixed of [false, true]) {
  // Host reason: wiring.
  // Rigger decision: test/hold-notice-loop.test.mjs — controlled pull and run preserve settlement and sibling carriers.
  test(`P2/P3 actual settlement F identity in ${verb}; failed sibling=${mixed}`, async (t) => {
    let refused = false;
    if (mixed) relayJudgeAppend(t, (record) => record.layer === 'L3' && record.event === 'dispatch' && record.role === 'reviewer' && record.attempt === undefined && record.card === 3 && !refused && (refused = true));
    const built = relayJudgeWorld({ cards: [relayJudgeCard(3, relayColumns.ready), ...(mixed ? [relayJudgeCard(4, relayColumns.ready)] : [])], concurrency: mixed && verb === 'run' ? 1 : 2 });
    const values = new Map(), outcomes = new Map();
    const handed = { ...built.handed, l2: { ...built.handed.l2, settled: async (...args) => {
      outcomes.set(args[0].number, args[1]);
      const value = await built.handed.l2.settled(...args);
      values.set(args[0].number, value);
      return value;
    } } };
    const answer = await loop(handed)[verb]().then((value) => ({ value }), (failure) => ({ failure }));
    const reached = mixed ? (verb === 'pull' ? answer.failure.reached : answer.failure.errors.find((failure) => failure.reached?.some(({ card }) => card === 3)).reached) : answer.value;
    const maker = reached.find((card) => card.card === 3 && card.settled !== undefined);
    assert.equal(maker.outcome.value.exit, 0, 'real stand-in maker completed');
    assert.strictEqual(maker.settled.value, values.get(3), 'P2/P3 F must remain the actual settle facts');
    assert.equal(maker.settled.value.pull.value.number, 1003);
    assert.strictEqual(maker.outcome.value.stdout, outcomes.get(3).value.stdout, 'P2 actual L1 stdout Buffer reference retained');
    if (mixed) {
      assert.equal(maker.judges.find(({ role }) => role === 'architect').outcome.value.exit, 0, 'P3 successful sibling judge retained');
      const sibling = (verb === 'pull' ? reached : answer.failure.reached).find((card) => card.card === 4 && card.settled !== undefined);
      assert.equal(sibling.outcome.value.exit, 0, 'P3 successful sibling card retained');
      assert.strictEqual(sibling.settled.value, values.get(4), 'P3 sibling original F');
    }
  });
}

import fs from 'node:fs';
import config from '../rigger.config.mjs';
import { syncBuiltinESMExports } from 'node:module';
import { makeJudgeDirectory } from '../src/execution/workspace.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { boardOf, COLUMNS as relayBoardColumns } from './loop-world.mjs';
import { KINDS as relayJudgeKinds, pullFor } from './judge-world.mjs';
import { refusingWrites } from './notice-forge.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Actual Review-role dispatches, with no fixture completion counter treating a refused start as running. */
function relayJudgeEntry() {
  const scratch = temporaryDirectory('rigger-relay-judge-');
  const directory = join(scratch, 'state');
  const agent = standInAgent();
  const fake = boardOf([relayJudgeCard(3, relayBoardColumns.review)]);
  const repository = createFakeRepository({ pullRequests: [pullFor(3)] });
  const settings = { ...config, kinds: relayJudgeKinds, concurrency: 1 };
  const sink = openSink({ directory, run: 'r-relay-judge', now: () => 1 });
  let observe = () => {};
  const decide = (card, outcomes, options = {}) => {
    observe(options);
    return nextAction(card, relayJudgeKinds, undefined, { columns: relayBoardColumns, roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
  };
  const handed = { config: settings, sink, board: handleOn(fake), decide, facts: factsCall({ config: settings, reads: repository.operations, decide }),
    l2: columnChanges({ config: settings, sink, items: fake.operations, reads: repository.operations, repositoryWrites: refusingWrites() }),
    kill: async () => {}, workspace: async () => { throw new Error('Review makes no maker workspace'); }, judgeDirectory: makingJudgeDirectories(join(scratch, 'workspaces')), removeDirectories: async () => {},
    state: directory, environment: { ...process.env, PATH: agent.first() }, run: 'r-relay-judge', clock: { now: () => 1, pause: async () => {} } };
  return { scratch, handed, events: () => readEvents(directory), agent, observe: (callback) => { observe = callback; } };
}

/** Refuses real sink append attempts while preserving unrelated filesystem writes. */
function relayJudgeAppend(t, predicate) {
  const original = fs.appendFileSync;
  const refused = [];
  fs.appendFileSync = (path, bytes, ...rest) => {
    let record;
    try { record = JSON.parse(String(bytes)); } catch {}
    if (record && predicate(record)) {
      const error = Object.assign(new Error(`EIO actual ${record.event} append`), { code: 'EIO' });
      refused.push({ record, error });
      throw error;
    }
    return original(path, bytes, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => { fs.appendFileSync = original; syncBuiltinESMExports(); });
  return refused;
}

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled judge refusals retain siblings without retry or hold.
// Boundary rule 4 infrastructure identity: R-RECORD-9 does not require the same Error;
// R-SCHED-23 concerns reopening rather than the J/noOutcome carrier.
test('P10/P11/P12 actual judge-directory failure and successful sibling', async (t) => {
  const built = relayJudgeEntry();
  let original;
  const handing = { ...built.handed, judgeDirectory: async (card, role, head) => {
    if (role !== 'reviewer') return built.handed.judgeDirectory(card, role, head);
    try { return await makeJudgeDirectory({ root: join(built.scratch, 'actual-directories'), topic: 'rigger-{number}', card, role, head, repository: join(built.scratch, 'absent-repository'), sink: built.handed.sink }); }
    catch (reason) { original = reason; throw reason; }
  } };
  relayJudgeAppend(t, (record) => record.layer === 'L1' && record.event === 'workspace.failed' && record.role === 'reviewer');
  const failure = await loop(handing).pull().then(() => assert.fail('actual judge failure was accepted'), (reason) => reason);
  const judges = failure.reached.find(({ card }) => card === 3).judges;
  assert.equal(judges.find(({ role }) => role === 'architect').outcome.value.exit, 0, 'P10 sibling judge retained');
  const reviewer = judges.find(({ role }) => role === 'reviewer');
  assert.equal(original.code, 'EVENT_REFUSED');
  assert.strictEqual(reviewer.failure.cause, original, 'P10/P12 noOutcome retains J as cause');
  assert.strictEqual(reviewer.failure.cause.unrecorded, original.unrecorded);
  assert.strictEqual(reviewer.failure.cause.unrecorded[0], original.unrecorded[0]);
  assert.strictEqual(reviewer.failure.cause.unrecorded.at(-1), original.unrecorded.at(-1));
  assert.equal(built.events().filter(({ event }) => event === 'admission.close').length, 0);
});

for (const route of ['dispatch-result', 'dispatch-start', 'L3-start']) {
  // Host reason: wiring.
  // Rigger decision: test/hold-notice-loop.test.mjs — controlled judge refusals retain siblings without retry or hold.
  test(`P10/P11/P12 actual ${route} failure and successful sibling`, async (t) => {
    const built = relayJudgeEntry();
    let actual;
    built.observe((options) => { if (options.directories?.reviewer?.status === 'rejected') actual = options.directories.reviewer.reason; });
    const originalDecide = built.handed.decide;
    const handing = { ...built.handed, decide: (card, outcomes, options = {}) => {
      const outcome = options.directories?.reviewer;
      if (outcome?.status === 'rejected' && route !== 'L3-start') actual = outcome.reason;
      return originalDecide(card, outcomes, options);
    } };
    const judgeIds = new Set();
    const refused = relayJudgeAppend(t, (record) => {
      if (record.layer === 'L3' && record.event === 'dispatch' && record.role === 'reviewer' && record.attempt === undefined) judgeIds.add(record.dispatch);
      return route === 'L3-start' ? record.layer === 'L3' && record.event === 'dispatch' && judgeIds.has(record.dispatch)
        : record.layer === 'L1' && record.event === (route === 'dispatch-start' ? 'dispatch.start' : 'dispatch.end') && judgeIds.has(record.dispatch);
    });
    const result = await loop(handing).pull().then((value) => ({ value }), (failure) => ({ failure }));
    const reached = result.failure?.reached ?? result.value;
    const judges = reached.find(({ card }) => card === 3).judges;
    assert.equal(judges.find(({ role }) => role === 'architect').outcome.value.exit, 0, 'P11/P12 actual successful sibling');
    const reviewer = judges.find(({ role }) => role === 'reviewer');
    if (route === 'L3-start') {
      assert.strictEqual(reviewer.failure.cause.cause, refused[0].error, 'P12 original actual start append cause');
      assert.match(reviewer.failure.message, /not started/);
    } else {
      assert.equal(reviewer.halt, true);
      assert.ok(actual.code === 'EVENT_REFUSED' || actual.startCause?.kind === 'event-unrecorded');
      assert.strictEqual(reviewer.outcome.reason, actual, 'P11 actual D outcome.reason identity');
    }
    assert.equal(built.events().filter(({ event }) => event === 'admission.close').length, 0, 'P11/P12 no hold');
    assert.ok(built.agent.runs().filter(({ role }) => role === 'reviewer').length <= 1, 'P11/P12 no reviewer retry');
  });
}

// Host reason: wiring.
// Rigger decision: test/hold-notice-loop.test.mjs — controlled pull and run preserve settlement and sibling carriers.
test('one fulfilled pull retains actual settlement facts for two successful cards', async () => {
  const built = relayJudgeWorld({ cards: [relayJudgeCard(3, relayColumns.ready), relayJudgeCard(4, relayColumns.ready)], concurrency: 2 });
  const values = new Map();
  const handed = { ...built.handed, l2: { ...built.handed.l2, settled: async (...args) => {
    const value = await built.handed.l2.settled(...args); values.set(args[0].number, value); return value;
  } } };
  const reached = await loop(handed).pull();
  assert.equal(reached.length, 2, 'SETTLE-TWO preserves exactly both cards');
  assert.deepEqual(reached.map(({ card }) => card).sort(), [3, 4]);
  for (const card of reached) {
    assert.equal(card.outcome.value.exit, 0);
    assert.strictEqual(card.settled.value, values.get(card.card), 'SETTLE-TWO original F');
    for (const role of ['reviewer', 'architect']) assert.equal(card.judges.find((judge) => judge.role === role).outcome.value.exit, 0, 'SETTLE-TWO actual judges completed');
  }
});
