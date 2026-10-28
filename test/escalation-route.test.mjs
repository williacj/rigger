// ABOUTME: Tests the escalation route: L2's one destination function, the routing comment's fixed
// first line, and the destination every escalate answer and its event and owner comment carry.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import rigger from '../rigger.config.mjs';
import { CATEGORIES, validate } from '../src/config/validate.mjs';
import { ROUTING_LINE, escalationDestination } from '../src/workflow/escalation.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const KIND = { maker: 'engineer', judges: ['reviewer', { role: 'architect', provider: 'codex' }, 'owner'] };
const routing = (body = `${ROUTING_LINE}\n\nSent to pm.`, other = {}) => ({ body, author: 'someone', permission: 'none', edited: false, ...other });
const route = (fields) => escalationDestination({ category: 'ambiguous', raiser: 'maker', escalate: { ambiguous: 'pm' }, ...KIND, comments: [], ...fields });

// proves R-ESCALATE-15
test('a loop-raised escalation goes to the owner whatever its configured destination', () => {
  for (const category of ['ambiguous', 'critical', 'recorded-decision']) {
    assert.equal(route({ category, raiser: 'loop', escalate: { [category]: 'pm' } }), 'owner', category);
    assert.equal(route({ category, raiser: 'loop', escalate: undefined, comments: undefined }), 'owner', category);
  }
});

// proves R-ESCALATE-15
test('a maker-raised ambiguity goes to a configured role neither the maker nor a judge, and to the owner where configured so', () => {
  assert.equal(route({}), 'pm');
  assert.equal(route({ escalate: { ambiguous: 'owner' } }), 'owner');
});

// proves R-ESCALATE-17
test('a maker-raised ambiguity configured to the kind\'s maker or one of its judges goes to the owner', () => {
  assert.equal(route({ escalate: { ambiguous: 'engineer' } }), 'owner', 'the maker');
  assert.equal(route({ escalate: { ambiguous: 'reviewer' } }), 'owner', 'a judge named by role');
  assert.equal(route({ escalate: { ambiguous: 'architect' } }), 'owner', 'a judge named by an entry with its role');
  assert.equal(route({ escalate: { ambiguous: 'pm' } }), 'pm', 'a role the kind names neither way');
});

// proves R-ESCALATE-22
test('a category given no destination goes to the owner, with no escalate key or with its key absent', () => {
  assert.equal(route({ escalate: undefined }), 'owner', 'no escalate key');
  assert.equal(route({ escalate: {} }), 'owner', 'escalate empty');
  assert.equal(route({ escalate: { critical: 'owner' } }), 'owner', 'escalate present, this category\'s key absent');
});

// proves R-ESCALATE-15, R-ESCALATE-14
test('a maker-raised critical or recorded-decision escalation goes to the owner, and the validator refuses a role for either', () => {
  for (const category of ['critical', 'recorded-decision']) {
    assert.equal(route({ category, escalate: { [category]: 'owner' } }), 'owner', category);
    assert.equal(route({ category, escalate: { [category]: 'pm' } }), 'owner', `${category}, unvalidated`);
    assert.ok(validate({ ...rigger, escalate: { [category]: 'pm' } }).some((refusal) => refusal.includes(`\`escalate.${category}\``)), category);
  }
});

// proves R-ESCALATE-16
test('a card whose issue carries the routing comment goes to the owner, and one whose comment a person deleted goes to the role again', () => {
  const others = [routing('A person writes.'), routing(`Quoting:\n${ROUTING_LINE}`)];
  assert.equal(route({ comments: [...others, routing()] }), 'owner', 'present');
  assert.equal(route({ comments: others }), 'pm', 'deleted by a person');
});

// proves R-ESCALATE-16
test('the routing comment is found by its fixed first line whoever wrote it, and the line elsewhere is no routing comment', () => {
  assert.ok(ROUTING_LINE.length > 0 && !ROUTING_LINE.includes('\n'), 'the fixed line is one non-empty line');
  for (const [what, comment] of [
    ['an unprivileged writer', routing(undefined, { permission: 'none' })],
    ['a writer', routing(undefined, { permission: 'write' })],
    ['an edited comment', routing(undefined, { edited: true })],
    ['the line alone', routing(ROUTING_LINE)],
    ['a CRLF comment', routing(`${ROUTING_LINE}\r\nSent to pm.`)],
  ]) assert.equal(route({ comments: [comment] }), 'owner', what);
  for (const [what, comment] of [
    ['the line second', routing(`Note.\n${ROUTING_LINE}`)],
    ['the line after a blank first line', routing(`\n${ROUTING_LINE}`)],
    ['the line indented', routing(` ${ROUTING_LINE}`)],
    ['the line with a suffix', routing(`${ROUTING_LINE} Not really.`)],
  ]) assert.equal(route({ comments: [comment] }), 'pm', what);
});

const DISPATCH = 'd-11111111-2222-3333-4444-555555555555';
const BODY = '## Acceptance\n\n- The verb prints its help.\n';
const note = (category = 'ambiguous') => ({
  body: ['```rigger-escalation', `category: ${category}`, 'item: 1', 'reason: The needed decision is missing.', `dispatch: ${DISPATCH}`, '```', ''].join('\n'),
  author: 'maker', permission: 'write', edited: false,
});
const exited = { status: 'fulfilled', value: { exit: 4, stdout: '', stderr: '' } };

/** L2 under the live config with `escalate` as given, over a change card in Coding whose issue holds `comments`. */
async function world(escalate, comments, { readIssueComments } = {}) {
  const { escalate: _, ...live } = rigger;
  const config = escalate === undefined ? live : { ...live, escalate };
  const fake = createFakeBoard({
    columns: Object.values(config.board.columns),
    items: [{ type: 'issue', repository: config.repo, number: 12, title: 'Add a verb', body: BODY, labels: ['type:change'], column: config.board.columns.coding }],
  });
  const repository = createFakeRepository({ issues: [{ number: 12, body: BODY, comments: [] }] });
  const directory = temporaryDirectory('rigger-escalation-route-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const reads = { ...repository.operations, readIssueComments: readIssueComments ?? (async () => comments) };
  const l2 = columnChanges({ config, sink, items: fake.operations, reads, repositoryWrites: repository });
  return { card: (await fake.operations.readItems())[0], fake, l2, repository, events: () => readEvents(directory) };
}

// proves R-ESCALATE-15, R-ESCALATE-16, R-ESCALATE-17, R-ESCALATE-20, R-ESCALATE-22
test('a maker\'s escalate answer at the settle carries the destination the function answers from the card\'s issue comments and kind', async () => {
  const cases = [
    ['a role neither the maker nor a judge', { ambiguous: 'pm' }, [note()], 'pm'],
    ['that role, the routing comment present', { ambiguous: 'pm' }, [routing(), note()], 'owner'],
    ['the kind\'s maker', { ambiguous: 'engineer' }, [note()], 'owner'],
    ['one of the kind\'s judges', { ambiguous: 'architect' }, [note()], 'owner'],
    ['no escalate key', undefined, [note()], 'owner'],
    ['this category\'s key absent', { critical: 'owner' }, [note()], 'owner'],
    ['a maker\'s critical', { ambiguous: 'pm' }, [note('critical')], 'owner'],
    ['a maker\'s recorded-decision', { ambiguous: 'pm' }, [note('recorded-decision')], 'owner'],
  ];
  for (const [what, escalate, comments, destination] of cases) {
    const { card, l2 } = await world(escalate, comments);
    const answer = await l2.settled(card, exited, { dispatch: DISPATCH });
    assert.equal(answer.action, 'escalate', what);
    assert.equal(answer.raiser, 'maker', what);
    assert.equal(answer.destination, destination, what);
    assert.ok(CATEGORIES.includes(answer.category), what);
  }
});

// proves R-ESCALATE-13, R-ESCALATE-20
test('an escalation the function sends to a role posts the routing comment and leaves its column and labels alone', async () => {
  const { card, fake, l2, repository, events } = await world({ ambiguous: 'pm' }, [note()]);
  const answer = await l2.settled(card, exited, { dispatch: DISPATCH });
  assert.equal(typeof l2.routed, 'function', 'L2 must post the route before a role dispatch');
  const routed = await l2.routed(card, answer);
  const [event] = events().filter(({ event: name }) => name === 'review.escalate');
  assert.deepEqual({ category: event.category, raiser: event.raiser, destination: event.destination }, { category: 'ambiguous', raiser: 'maker', destination: 'pm' });
  assert.equal(repository.held().issues[0].comments[0].body.split('\n')[0], ROUTING_LINE);
  assert.equal(routed.role.role, 'pm');
  assert.deepEqual(fake.writes(), [], 'the card keeps its column');
  assert.deepEqual(repository.held().issues[0].labels, []);
});

// proves R-ESCALATE-20
test('an escalation the function sends to the owner records its category, raiser and destination, and its comment names no role', async () => {
  const { card, l2, repository, events } = await world({ ambiguous: 'engineer' }, [note()]);
  await l2.escalated(card, await l2.settled(card, exited, { dispatch: DISPATCH }));
  const [event] = events().filter(({ event: name }) => name === 'review.escalate');
  assert.deepEqual({ category: event.category, raiser: event.raiser, destination: event.destination }, { category: 'ambiguous', raiser: 'maker', destination: 'owner' });
  assert.doesNotMatch(repository.held().issues[0].comments[0].body, /Not sent/);
});

// proves R-ESCALATE-16
test('an unreadable issue-comment read rejects the settle naming the card and answers no destination', async () => {
  const { card, fake, l2, repository } = await world({ ambiguous: 'pm' }, [], { readIssueComments: async () => { throw new Error('timed out'); } });
  await assert.rejects(l2.settled(card, exited, { dispatch: DISPATCH }), /card #12's issue comments could not be read: timed out/);
  assert.deepEqual(fake.writes(), []);
  assert.deepEqual(repository.held().issues[0].comments, []);
});
