// ABOUTME: Tests how L2 settles a dispatch that exited zero, driven through L3's loop over the fake
// board: a redo pulled from review is left there with no write and no transition, a redo pulled
// from coding moves once to review, and a claimed ready card moves twice, each move with its event.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLUMNS, boardOf, cardIn, columnsOf, quiesce, world } from './loop-world.mjs';

/**
 * The most rounds a run is driven before the test gives up on it. Each round lets every queued
 * step run and then releases every held dispatch; a run over these boards needs one round per
 * dispatch and one to end, so a run still going after this many never would.
 */
const ROUNDS = 10;

/**
 * Runs `built`'s loop to its end, releasing every held dispatch once the loop has made every start
 * it can, for at most `ROUNDS` rounds. A run that has not ended by then, or that has started more
 * dispatches than `most`, fails the test naming what it did, so every mutant reaches a verdict.
 */
async function bounded(built, most) {
  let ended = false;
  const run = built.loop.run().finally(() => {
    ended = true;
  });
  run.catch(() => {});
  for (let round = 0; round < ROUNDS && !ended; round += 1) {
    await quiesce();
    assert.ok(built.dispatches.started.length <= most, `the run started ${built.dispatches.started.length} dispatches: ${built.dispatches.started}`);
    built.dispatches.releaseAll();
  }
  assert.ok(ended, `the run had not ended after ${ROUNDS} rounds, having started dispatches ${built.dispatches.started}`);
  await run;
  return built;
}

/** A run of the loop over a fake board holding `cards`, each dispatched once and exiting zero. */
const exitingZero = (cards) => bounded(world({ fake: boardOf(cards), concurrency: cards.length }), cards.length);

/** A card in the review column that L2 would dispatch, which L3 pulls as a redo. */
const IN_REVIEW = cardIn(6, COLUMNS.review);

/** A card in the coding column that L2 would dispatch, which L3 pulls as a redo. */
const IN_CODING = cardIn(5, COLUMNS.coding);

/** A card in the ready column that L2 would dispatch, which L3 claims. */
const IN_READY = cardIn(1, COLUMNS.ready);

/** Column key by display name, read off this repository's config. */
const KEY_OF = { Ready: 'ready', Coding: 'coding', Review: 'review', Owner: 'owner', Done: 'done' };

/** Each card's number on `built`'s fake board, by the id of its item, which is what a write names. */
const numbersOf = async (built) => new Map((await built.fake.operations.readItems()).map((item) => [item.id, item.number]));

/** The fake board's writes to card `number`'s item, each as its operation and the column key it names. */
const writesTo = async (built, number) => {
  const numbers = await numbersOf(built);
  return built.fake.writes()
    .filter(({ args: [id] }) => numbers.get(id) === number)
    .map(({ operation, args: [, column] }) => [operation, KEY_OF[column]]);
};

/** The stream's L2 transition events for card `number`, each as the column keys it names and its cause. */
const transitionsOf = (built, number) =>
  built.events()
    .filter((event) => event.layer === 'L2' && event.event === 'transition' && event.card === number)
    .map(({ from, to, cause }) => ({ from, to, cause }));

// proves R-WORK-5
test('given a card in review that L3 pulls as a redo and whose dispatch exits zero, the write record holds no write for it once L2 has settled the outcome', async () => {
  const built = await exitingZero([IN_REVIEW]);

  assert.deepEqual(built.dispatches.started, [6]);
  assert.deepEqual(await writesTo(built, 6), []);
});

// proves R-WORK-5
test('given a card in review that L3 pulls as a redo and whose dispatch exits zero, the event stream holds no L2 transition event for it', async () => {
  const built = await exitingZero([IN_REVIEW]);

  assert.deepEqual(built.dispatches.started, [6]);
  assert.deepEqual(transitionsOf(built, 6), []);
});

// proves R-WORK-5
test('given a card in review that L3 pulls as a redo and whose dispatch exits zero, a read of the board after the outcome is settled shows it in review', async () => {
  const built = await exitingZero([IN_REVIEW]);

  assert.deepEqual(built.dispatches.started, [6]);
  assert.deepEqual(await columnsOf(built.fake), { 6: COLUMNS.review });
});

// proves R-WORK-5
test('given a card in coding that L3 pulls as a redo and whose dispatch exits zero, the write record holds exactly one write for it, a move to review', async () => {
  const built = await exitingZero([IN_CODING]);

  assert.deepEqual(built.dispatches.started, [5]);
  assert.deepEqual(await writesTo(built, 5), [['moveItem', 'review']]);
});

// proves R-WORK-5
test('given a card in coding that L3 pulls as a redo and whose dispatch exits zero, the event stream holds exactly one L2 transition event for it, from coding to review, cause returned', async () => {
  const built = await exitingZero([IN_CODING]);

  assert.deepEqual(built.dispatches.started, [5]);
  assert.deepEqual(transitionsOf(built, 5), [{ from: 'coding', to: 'review', cause: 'returned' }]);
});

// proves R-WORK-5
test('given a card in ready that L3 claims and whose dispatch exits zero, the write record holds exactly two moves for it, to coding and then to review', async () => {
  const built = await exitingZero([IN_READY]);

  assert.deepEqual(built.dispatches.started, [1]);
  assert.deepEqual(await writesTo(built, 1), [['moveItem', 'coding'], ['moveItem', 'review']]);
});

// proves R-WORK-5
test('given a card in ready that L3 claims and whose dispatch exits zero, the event stream holds exactly two L2 transition events for it, ready to coding and then coding to review', async () => {
  const built = await exitingZero([IN_READY]);

  assert.deepEqual(built.dispatches.started, [1]);
  assert.deepEqual(transitionsOf(built, 1).map(({ from, to }) => [from, to]), [['ready', 'coding'], ['coding', 'review']]);
});

// proves R-WORK-5
test('in one run over a redo in review, a redo in coding and a claimed ready card, every L2 transition event matches a move in the write record for the same card and columns', async () => {
  const cards = [IN_REVIEW, IN_CODING, IN_READY];
  const built = await exitingZero(cards);
  assert.deepEqual([...built.dispatches.started].sort(), [1, 5, 6]);

  // Replay the write record from each card's starting column, so each move names the column it left.
  const numbers = await numbersOf(built);
  const at = new Map(cards.map((card) => [card.number, KEY_OF[card.column]]));
  const moves = built.fake.writes().map(({ operation, args: [id, column] }) => {
    assert.equal(operation, 'moveItem');
    const card = numbers.get(id);
    const from = at.get(card);
    at.set(card, KEY_OF[column]);
    return JSON.stringify({ card, from, to: KEY_OF[column] });
  });
  const transitions = built.events()
    .filter((event) => event.layer === 'L2' && event.event === 'transition')
    .map(({ card, from, to }) => JSON.stringify({ card, from, to }));

  assert.equal(transitions.length, 3, `three transitions, two for the ready card and one for the coding redo: ${transitions}`);
  for (const transition of transitions) assert.ok(moves.includes(transition), `${transition} has no matching move in ${moves}`);
});
