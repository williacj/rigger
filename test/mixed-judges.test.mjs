// ABOUTME: Tests where L3's pull carries a card's judges when they are mixed, one handing back beside
// one that fails to: under the card's number, in the order L2 named them, on each claim path, for
// one card or two in one pull or two, and beside a refused slot release. One test per row of #612.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { WORKSPACE_NOT_MADE } from '../src/execution/workspace.mjs';
import { KINDS, cardIn, judgeWorld, pullFor } from './judge-world.mjs';
import { COLUMNS, makingJudgeDirectories } from './loop-world.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** The judges L2 names, in the order the kind lists them and L2 names them. */
const ROLES = ['reviewer', 'architect'];

/**
 * A judge's outcome, one value of each class the card's equivalence rule names: `H` hands back
 * (the stand-in exits 0), `Fs` fails to hand back with its start event refused, `Fl` fails to hand
 * back with L2 answering no action for it, its `ask` throwing on a directory outcome that is not
 * L1's failure to make it, and `W` is withheld by L2, L1 having failed to make its directory.
 */
const FAILS = new Set(['Fs', 'Fl']);

/** The card each claim path pulls: a Review card for its judges alone, or a Ready card whose maker opens a pull request. */
const CARD = { judges: 7, maker: 3 };

/** The world a row runs in: `path` the claim path, `values` each judge's outcome, in `ROLES` order, for card `number`. */
const cardOf = (path, number) => (path === 'judges' ? cardIn(number, COLUMNS.review) : cardIn(number, COLUMNS.ready));

/**
 * A judge world over `rows`, each `{ path, number, values }`, every card's kind naming as many judges
 * as its row has values, at `concurrency`, with `release` naming the cards whose `slot.release` the
 * sink refuses.
 */
function rowWorld(rows, { concurrency = 1, release = [] } = {}) {
  let built;
  const valueOf = (card, role) => {
    const row = rows.find((each) => each.number === card);
    return row?.values[ROLES.indexOf(role)];
  };
  const judgeDirectory = async (card, role, head) => {
    if (valueOf(card, role) === 'Fl') throw new Error(`the test fails the make of ${role}'s directory with no code of L1's`);
    if (valueOf(card, role) === 'W') throw Object.assign(new Error(`L1 could not make judge ${role}'s directory: the disk is full`), { code: WORKSPACE_NOT_MADE, path: join(built.scratch, 'judges', role) });
    return makingJudgeDirectories(join(built.scratch, 'workspaces'))(card, role, head);
  };
  // A judge's start is refused once, so a card `run` pulls again on a freed slot has that judge
  // hand back the second time, and the run drains rather than pulling the card for ever.
  const refused = new Set();
  const startRefused = (card, role) => {
    if (role === undefined || valueOf(card, role) !== 'Fs' || refused.has(`${card} ${role}`)) return false;
    refused.add(`${card} ${role}`);
    return true;
  };
  const refuse = ({ layer, card, event, fields }) => layer === 'L3'
    && ((event === 'dispatch' && startRefused(card, fields.role)) || (event === 'slot.release' && release.includes(card)));
  // Every row here has one length, so one kind serves every card.
  const kinds = { change: { ...KINDS.change, judges: ROLES.slice(0, rows[0].values.length) } };
  const pullRequests = rows.filter((row) => row.path === 'judges').map((row) => pullFor(row.number));
  built = judgeWorld({ cards: rows.map((row) => cardOf(row.path, row.number)), forge: { pullRequests }, kinds, concurrency, judgeDirectory, refuse });
  return built;
}

/** The pull's rejection, failing the test where it settled. */
const rejection = (promise) => promise.then(() => assert.fail('it settled with no failure'), (error) => error);

/** What `failure` holds as messages, every AggregateError in it opened, however deep. */
const messagesIn = (failure) => failure.errors.flatMap(function flat(error) { return error instanceof AggregateError ? error.errors.flatMap(flat) : [error.message]; });

/** Why judge `role` of card `card` failed to hand back for `value`, in the words the base's failure says it in. */
const why = (card, role, value) => (value === 'Fs'
  ? `card #${card}'s judge \`${role}\` handed back no outcome: card #${card}'s role \`${role}\` was not started, because the event sink refused to record its start: the test refuses L3's dispatch`
  : `card #${card}'s judge \`${role}\` handed back no outcome: card #${card}'s judge ${role} has a directory outcome that is not L1's failure to make it, so L2 answers no action for it: the test fails the make of ${role}'s directory with no code of L1's`);

/** What a row expects carried for each judge of card `card`, in the order L2 named them: its exit, why it failed, or why it was withheld. */
const expected = (card, values) => values.map((value, at) => {
  const role = ROLES[at];
  if (value === 'H') return { role, exit: 0 };
  if (value === 'W') return { role, withheld: `L1 could not make judge ${role}'s directory: the disk is full` };
  return { role, failed: why(card, role, value) };
});

/** A carried judge as a row reads it: its role, and its exit, its failure's message, or the reason its directory was not made. */
const view = (judge) => {
  if (judge.outcome !== undefined) return { role: judge.role, exit: judge.outcome.value?.exit };
  if (judge.failure !== undefined) return { role: judge.role, failed: judge.failure.message };
  return { role: judge.role, withheld: judge.withheld?.directory?.reason?.message };
};

/** The one entry `reached` holds for card `card`, failing where it holds none or more. */
const entryFor = (reached, card) => {
  const entries = (reached ?? []).filter((each) => each.card === card);
  assert.equal(entries.length, 1, `card #${card} is carried ${entries.length} times: ${JSON.stringify(reached)}`);
  return entries[0];
};

/**
 * Asserts what a mixed row's pull failure carries for card `card`, whose judges ended as `values`:
 * the card under its number with every judge in L2's order, each by role and outcome, failure or
 * withholding; and in the failure's errors the card and each judge that failed to hand back, and why.
 */
function carriesMixed(failure, reached, card, values) {
  const { judges } = entryFor(reached, card);
  assert.ok(Array.isArray(judges), `card #${card} is carried with no judges: ${JSON.stringify(reached)}`);
  assert.deepEqual(judges.map(view), expected(card, values));
  const messages = messagesIn(failure);
  for (const [at, value] of values.entries()) {
    if (FAILS.has(value)) assert.ok(messages.includes(why(card, ROLES[at], value)), JSON.stringify(messages));
  }
}

/** The maker's result for card `card` among `reached`: its exit code and its settle's status. */
const makerOf = (reached, card) => {
  const { outcome, settled } = entryFor(reached, card);
  return { exit: outcome?.value?.exit, settled: settled?.status };
};

/** The rows of #612 for one card: each claim path, each judge outcome or unordered pair of them. */
const VALUES = ['H', 'Fs', 'Fl', 'W'];
const PAIRS = VALUES.flatMap((first, at) => VALUES.slice(at).map((second) => [first, second]));
const ONE_CARD = [
  ...['judges', 'maker'].flatMap((path) => VALUES.map((value) => ({ path, values: [value] }))),
  ...['judges', 'maker'].flatMap((path) => PAIRS.map((values) => ({ path, values }))),
].map((row, at) => ({ ...row, row: at + 1, number: CARD[row.path] }));

/** How a row reads in a title: its number, its claim path, and each judge's outcome. */
const named = ({ row, path, values }) => `row ${row}: ${path === 'judges' ? 'pulled for its judges alone' : 'claimed for its maker, then its judges'}, ${values.map((value, at) => `${ROLES[at]} ${value}`).join(', ')}`;

for (const row of ONE_CARD.filter(({ values }) => values.some((value) => FAILS.has(value)))) {
  test(`${named(row)}: the pull's failure carries card #${row.number} with each judge in L2's order, by role and outcome, failure or withholding, and names each judge that failed and why`, SETTLES_WITHIN, async () => {
    const built = rowWorld([row]);

    const failure = await rejection(built.loop.pull());

    carriesMixed(failure, failure.reached, row.number, row.values);
    if (row.path === 'maker') assert.deepEqual(makerOf(failure.reached, row.number), { exit: 0, settled: 'fulfilled' });
  });
}

// The rows in which every judge hands back or is withheld and no existing judge test covers them:
// the pull's answer for the card is as at the base, the withheld judge absent from its judges.
for (const row of ONE_CARD.filter(({ path, values }) => values.includes('W') && !values.some((value) => FAILS.has(value)) && !(path === 'judges' && values.includes('H')) && !(path === 'maker' && values.length === 1))) {
  test(`${named(row)}: the pull settles, and its answer for card #${row.number} carries only the judges that handed back`, SETTLES_WITHIN, async () => {
    const built = rowWorld([row]);

    const reached = await built.loop.pull();

    const handedBack = row.values.flatMap((value, at) => (value === 'H' ? [{ role: ROLES[at], exit: 0 }] : []));
    assert.deepEqual(entryFor(reached, row.number).judges.map(view), handedBack);
    if (row.path === 'maker') assert.deepEqual(makerOf(reached, row.number), { exit: 0, settled: 'fulfilled' });
  });
}

// Two cards, each pulled for its judges alone, `Fs` as the failure: in one pull at concurrency 2,
// and in two pulls at concurrency 1, which `run` fires as the first card frees its slot.

const A = 7;
const B = 8;

test('row 29: two cards in one pull at concurrency 2, card A\'s judges all handing back beside card B\'s mixed: each card\'s judges are carried under its own number', SETTLES_WITHIN, async () => {
  const built = rowWorld([{ path: 'judges', number: A, values: ['H', 'H'] }, { path: 'judges', number: B, values: ['Fs', 'H'] }], { concurrency: 2 });

  const failure = await rejection(built.loop.pull());

  assert.deepEqual(entryFor(failure.reached, A).judges.map(view), expected(A, ['H', 'H']));
  carriesMixed(failure, failure.reached, B, ['Fs', 'H']);
  assert.equal(failure.errors.length, 1, JSON.stringify(messagesIn(failure)));
});

test('row 30: two cards in one pull at concurrency 2, both mixed: each card\'s judges are carried under its own number', SETTLES_WITHIN, async () => {
  const built = rowWorld([{ path: 'judges', number: A, values: ['Fs', 'H'] }, { path: 'judges', number: B, values: ['Fs', 'H'] }], { concurrency: 2 });

  const failure = await rejection(built.loop.pull());

  carriesMixed(failure, failure.reached, A, ['Fs', 'H']);
  carriesMixed(failure, failure.reached, B, ['Fs', 'H']);
  assert.equal(failure.errors.length, 2, JSON.stringify(messagesIn(failure)));
});

test('row 31: two cards in two pulls at concurrency 1, card A\'s judges all handing back beside card B\'s mixed: run\'s failure carries card B\'s pull\'s own failure, and each card\'s judges under its own number', SETTLES_WITHIN, async () => {
  const built = rowWorld([{ path: 'judges', number: A, values: ['H', 'H'] }, { path: 'judges', number: B, values: ['Fs', 'H'] }]);

  const failure = await rejection(built.loop.run());

  assert.equal(failure.errors.length, 1, JSON.stringify(messagesIn(failure)));
  const [pull] = failure.errors;
  assert.deepEqual((pull.reached ?? []).map((each) => each.card), [B]);
  carriesMixed(pull, pull.reached, B, ['Fs', 'H']);
  assert.deepEqual(entryFor(failure.reached, A).judges.map(view), expected(A, ['H', 'H']));
});

test('row 32: two cards in two pulls at concurrency 1, both mixed: run\'s failure carries each pull\'s own failure, each with its own card\'s judges under that card\'s number', SETTLES_WITHIN, async () => {
  const built = rowWorld([{ path: 'judges', number: A, values: ['Fs', 'H'] }, { path: 'judges', number: B, values: ['Fs', 'H'] }]);

  const failure = await rejection(built.loop.run());

  assert.equal(failure.errors.length, 2, JSON.stringify(messagesIn(failure)));
  const pulls = Object.fromEntries(failure.errors.map((pull) => [(pull.reached ?? []).map((each) => each.card).join(','), pull]));
  assert.deepEqual(Object.keys(pulls).sort(), [String(A), String(B)]);
  carriesMixed(pulls[A], pulls[A].reached, A, ['Fs', 'H']);
  carriesMixed(pulls[B], pulls[B].reached, B, ['Fs', 'H']);
});

test('row 33: one card pulled for its judges alone, one judge handing back beside one Fs, whose slot release the sink refuses: its judges are still carried under its number, beside the refused release', SETTLES_WITHIN, async () => {
  const built = rowWorld([{ path: 'judges', number: A, values: ['Fs', 'H'] }], { release: [A] });

  const failure = await rejection(built.loop.pull());

  carriesMixed(failure, failure.reached, A, ['Fs', 'H']);
  assert.ok(messagesIn(failure).includes(`card #${A}'s slot was released, and the event sink refused to record it: the test refuses L3's slot.release`), JSON.stringify(messagesIn(failure)));
});
