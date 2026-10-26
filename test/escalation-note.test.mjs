// ABOUTME: Tests a maker's escalation note at L2's settle boundary against issue comments and
// the maker dispatch that wrote it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { dispatchedEscalation, parseEscalationNote } from '../src/workflow/escalation.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const DISPATCH = 'd-11111111-2222-3333-4444-555555555555';
const BODY = '## Acceptance\n\n- The verb prints its help.\n';
const NOTE = [
  'I cannot meet acceptance item 1.',
  '```rigger-escalation',
  'category: ambiguous',
  'item: 1',
  'reason: The needed decision is missing.',
  `dispatch: ${DISPATCH}`,
  '```',
  '',
].join('\n');

/** L2 over a card in Coding and a forge holding its issue comments. */
async function world(comments, { pullRequests = [], readIssueComments, readPullRequests } = {}) {
  const fake = createFakeBoard({
    columns: Object.values(config.board.columns),
    items: [{ type: 'issue', repository: config.repo, number: 12, title: 'Add a verb', body: BODY, column: config.board.columns.coding }],
  });
  const repository = createFakeRepository({ issues: [{ number: 12, body: BODY, comments }], pullRequests });
  const sink = openSink({ directory: temporaryDirectory('rigger-escalation-note-'), run: 'r-test', now: () => 0 });
  const reads = {
    ...repository.operations,
    readIssueComments: readIssueComments ?? (async () => comments),
    ...(readPullRequests === undefined ? {} : { readPullRequests }),
  };
  const l2 = columnChanges({ config, sink, items: fake.operations, reads });
  return { card: (await fake.operations.readItems())[0], fake, l2, repository };
}

const posted = (body = NOTE, other = {}) => ({ body, author: 'maker', permission: 'write', edited: false, ...other });
const outcome = (exit = 4) => ({ status: 'fulfilled', value: { exit, stdout: '', stderr: '' } });

// proves R-LOOP-2
test('L2 settles a maker note under its dispatch id as an escalation even when the maker exits nonzero', async () => {
  const { card, fake, l2 } = await world([{ body: NOTE, author: 'maker', permission: 'write', edited: false }]);

  const answer = await l2.settled(card, { status: 'fulfilled', value: { exit: 4, stdout: '', stderr: '' } }, { dispatch: DISPATCH });

  assert.deepEqual(answer, {
    action: 'escalate', raiser: 'maker', category: 'ambiguous', item: 1,
    reason: 'The needed decision is missing.', dispatch: DISPATCH, line: 'rigger-12',
  });
  assert.deepEqual(fake.writes(), [], 'the settle leaves the card in Coding for L3 to escalate');
});

// proves R-LOOP-2
test('no issue note leaves a nonzero maker outcome in Coding', async () => {
  const { card, fake, l2 } = await world([]);
  assert.equal(await l2.settled(card, outcome(), { dispatch: DISPATCH }), undefined);
  assert.deepEqual(fake.writes(), []);
});

// proves R-LOOP-2
test('a matching issue note escalates when the maker exits zero', async () => {
  const { card, l2 } = await world([posted()]);
  assert.equal((await l2.settled(card, outcome(0), { dispatch: DISPATCH })).action, 'escalate');
});

// proves R-LOOP-2, R-ESCALATE-4
test('a matching note includes the one open pull request and its head', async () => {
  const head = 'a'.repeat(40);
  const { card, l2 } = await world([posted()], { pullRequests: [{ number: 77, head: 'rigger-12', sha: head }] });
  const answer = await l2.settled(card, outcome(), { dispatch: DISPATCH });
  assert.equal(answer.pull, 77);
  assert.equal(answer.head, head);
  assert.equal(answer.raiser, 'maker');
});

const ignored = [
  ['another dispatch id', posted(NOTE.replace(DISPATCH, 'd-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))],
  ['an account without write access', posted(NOTE, { permission: 'read' })],
  ['an edited note', posted(NOTE, { edited: true })],
  ['a malformed fenced block', posted(NOTE.replace('item: 1', 'item: one'))],
  ['an ordinal of zero', posted(NOTE.replace('item: 1', 'item: 0'))],
  ['an ordinal beyond the acceptance', posted(NOTE.replace('item: 1', 'item: 2'))],
];
for (const [why, comment] of ignored) {
  test(`L2 ignores ${why} and answers the maker outcome`, async () => {
    const { card, fake, l2 } = await world([comment]);
    assert.equal(await l2.settled(card, outcome(), { dispatch: DISPATCH }), undefined);
    assert.deepEqual(fake.writes(), []);
  });
}

// proves R-LOOP-2
test('a note on the pull request is not read as an issue note', async () => {
  const { card, l2 } = await world([], { pullRequests: [{ number: 77, head: 'rigger-12', sha: 'a'.repeat(40), comments: [posted()] }] });
  assert.equal(await l2.settled(card, outcome(), { dispatch: DISPATCH }), undefined);
});

// proves R-LOOP-2
test('the first of two matching notes counts', async () => {
  const later = NOTE.replace('category: ambiguous', 'category: critical').replace('The needed decision is missing.', 'The work is unsafe.');
  const { card, l2 } = await world([posted(), posted(later)]);
  assert.equal((await l2.settled(card, outcome(), { dispatch: DISPATCH })).category, 'ambiguous');
});

// proves R-LOOP-2
test('an edited earlier note leaves the later unedited note to count', async () => {
  const later = NOTE.replace('category: ambiguous', 'category: critical').replace('The needed decision is missing.', 'The work is unsafe.');
  const { card, l2 } = await world([posted(NOTE, { edited: true }), posted(later)]);
  const answer = await l2.settled(card, outcome(), { dispatch: DISPATCH });
  assert.equal(answer.category, 'critical');
  assert.equal(answer.reason, 'The work is unsafe.');
});

for (const code of ['EVENT_REFUSED', 'RECORD_REFUSED']) {
  test(`a ${code} maker result reads no note and moves nothing`, async () => {
    const { card, fake, l2 } = await world([posted()], { readIssueComments: async () => { throw new Error('the read should not run'); } });
    assert.equal(await l2.settled(card, { status: 'rejected', reason: Object.assign(new Error('record refused'), { code }) }, { dispatch: DISPATCH }), undefined);
    assert.deepEqual(fake.writes(), []);
  });
}

// proves R-LOOP-2
test('a continuing maker note escalates at the first settle read despite a stale forge head', async () => {
  let reads = 0;
  const { card, l2 } = await world([posted()], { readIssueComments: async () => { reads += 1; return [posted()]; },
    pullRequests: [{ number: 77, head: 'rigger-12', sha: 'a'.repeat(40) }],
  });
  const answer = await l2.settled(card, outcome(0), { dispatch: DISPATCH, expectedHead: 'b'.repeat(40) });
  assert.equal(answer.action, 'escalate');
  assert.equal(reads, 1);
  assert.equal(answer.waiting, undefined);
});

// proves R-LOOP-2
test('a pull-request read failure after a note names the card and read and takes no action', async () => {
  const { card, fake, l2 } = await world([posted()], { readPullRequests: async () => { throw new Error('timed out'); } });
  await assert.rejects(l2.settled(card, outcome(), { dispatch: DISPATCH }), /card #12's pull requests could not be read for its escalation: .*timed out/);
  assert.deepEqual(fake.writes(), []);
});

for (const category of ['recorded-decision', 'critical', 'ambiguous']) {
  test(`a ${category} issue note answers that category`, async () => {
    const { card, l2 } = await world([posted(NOTE.replace('category: ambiguous', `category: ${category}`))]);
    assert.equal((await l2.settled(card, outcome(), { dispatch: DISPATCH })).category, category);
  });
}

// proves R-LOOP-2
test('an issue-comments read failure names the card and read and takes no action', async () => {
  const { card, fake, l2 } = await world([], { readIssueComments: async () => { throw new Error('timed out'); } });
  await assert.rejects(l2.settled(card, outcome(), { dispatch: DISPATCH }), /card #12's issue comments could not be read: timed out/);
  assert.deepEqual(fake.writes(), []);
});

/** L2's maker instruction for a provider selecting one acceptance item. */
function instructionFor(provider) {
  const card = { number: 12, title: 'Add a verb', body: BODY, labels: ['type:change'] };
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  const roles = { engineer: { agent: '.claude/agents/engineer.md', provider, tier: 'standard' }, reviewer: { agent: '.claude/agents/reviewer.md', provider, tier: 'high' } };
  return nextAction(card, kinds, undefined, { roles, provisioning: {}, outcomes: [] }).maker.instruction;
}

// proves R-LOOP-2
test('Claude maker instruction gives the one-note block, ordinal rule, dispatch slot and stop rule', () => {
  const instruction = instructionFor('claude');

  assert.match(instruction, /comment on card #12's issue/i);
  assert.match(instruction, /```rigger-escalation\ncategory:.*\nitem:.*\nreason:.*\ndispatch: <the dispatch id>\n```/);
  assert.match(instruction, /count.*from 1.*acceptance items/i);
  assert.match(instruction, /write.*once.*never edit.*end/i);
  assert.doesNotMatch(instruction, /exit non-zero, naming why/);
});

// proves R-LOOP-2
test('Codex maker instruction gives the same one-note route as Claude', () => {
  const instruction = instructionFor('codex');
  assert.equal(instruction, instructionFor('claude'));
  assert.match(instruction, /comment on card #12's issue with this block/);
  assert.match(instruction, /```rigger-escalation\ncategory:.*\nitem:.*\nreason:.*\ndispatch: <the dispatch id>\n```/);
});

// proves R-LOOP-2
test('both provider instructions carry the maker dispatch id when L3 stamps them', () => {
  for (const provider of ['claude', 'codex']) {
    const stamped = dispatchedEscalation({ instruction: instructionFor(provider) }, DISPATCH).instruction;
    assert.match(stamped, new RegExp(`dispatch: ${DISPATCH}`));
    assert.doesNotMatch(stamped, /<the dispatch id>/);
  }
});

// proves R-LOOP-2
test('a note in the instruction schema alone parses and reaches L2 under its maker dispatch', async () => {
  const instruction = instructionFor('claude');
  const block = instruction.match(/```rigger-escalation\n[\s\S]*?\n```/)[0]
    .replace('category: <recorded-decision, critical, or ambiguous>', 'category: critical')
    .replace('item: <the item ordinal>', 'item: 1')
    .replace('reason: <one line naming why>', 'reason: A required condition failed.')
    .replace('dispatch: <the dispatch id>', `dispatch: ${DISPATCH}`);
  assert.deepEqual(parseEscalationNote(block, 1), {
    category: 'critical', item: 1, reason: 'A required condition failed.', dispatch: DISPATCH,
  });
  const { card, l2 } = await world([posted(block)]);
  assert.deepEqual(await l2.settled(card, outcome(), { dispatch: DISPATCH }), {
    action: 'escalate', raiser: 'maker', category: 'critical', item: 1,
    reason: 'A required condition failed.', dispatch: DISPATCH, line: 'rigger-12',
  });
});
