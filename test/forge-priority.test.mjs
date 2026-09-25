// ABOUTME: Tests L0's priority read through the fake `gh` and on into L3's pull order: the hand-off
// the real adapter gives for a board and its declaration, and the order L3 pulls from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installFakeGh } from './fake-gh.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { pullOrder } from '../src/scheduling/pull-order.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';

/** Where the fake `gh` says its board lives: this repository's board, as its config names it. */
const WHERE = { repo: 'williacj/rigger', project: 6 };

/** The columns this repository's config declares, by key. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** The priority this repository's config declares, highest rank first. */
const PRIORITY = { field: 'Priority', options: ['High', 'Normal', 'Low'] };

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/**
 * A fake `gh` holding a board whose Priority field lists its options Low, High, Normal, and
 * `items`, and the send that runs it as the read runner's spawn runs `gh`.
 */
function fakeForge(items) {
  const fake = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-fake-gh-')), {
    ...WHERE,
    board: { columns: ['Backlog', ...Object.values(COLUMNS)], fields: [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }], items },
  });
  const send = (command, args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  return { fake, send };
}

/** A Ready issue numbered `number` that L2 would dispatch, holding `priority` where it is given. */
const card = (number, priority) => ({
  type: 'issue',
  repository: 'williacj/rigger',
  number,
  title: 'Add a verb',
  body: '## Acceptance\n\n- The verb prints its help.\n',
  labels: ['type:change'],
  column: 'Ready',
  ...(priority ? { fieldValues: { Priority: priority } } : {}),
});

/** The card numbers L3 pulls from L0's hand-off `handed`, first pulled first. */
const pulled = (handed) => pullOrder({ ...handed, columns: COLUMNS }, (held) => nextAction(held, KINDS)).pulls.map((pull) => pull.card);

// proves R-SCHED-1
test("through the fake gh, L0's priority read hands L3 what the fake board hands, and L3 pulls in the declared order", async () => {
  // Listed on the board lowest first, and in an option order that is not the declared one.
  const { fake, send } = fakeForge([card(31, 'Low'), card(32), card(33, 'Normal'), card(34, 'High'), card(35, 'Urgent')]);

  const handed = await readSide({ ...WHERE, columns: COLUMNS, priority: PRIORITY }, { send }).readPriority();

  const modelled = await (await fake.model()).operations.readPriority(PRIORITY);
  const byCard = (read) => read.items.map((held) => [held.number, held.priority]);
  assert.deepEqual(byCard(handed), byCard(modelled));
  assert.deepEqual([handed.declared, handed.options], [modelled.declared, modelled.options]);
  assert.deepEqual(handed.options, ['Low', 'High', 'Normal']);
  // High, Normal, Low, then the card with no value and the one valued Urgent, oldest first.
  assert.deepEqual(pulled(handed), [34, 33, 31, 32, 35]);
});

test("through the fake gh, with no priority declared, L0's hand-off has L3 pull oldest first though the cards hold values", async () => {
  const { send } = fakeForge([card(43, 'High'), card(41, 'Low'), card(42)]);

  const handed = await readSide({ ...WHERE, columns: COLUMNS }, { send }).readPriority();

  assert.deepEqual([handed.declared, handed.options], [null, null]);
  assert.deepEqual(handed.items.map((held) => [held.number, held.priority]), [[43, null], [41, null], [42, null]]);
  assert.deepEqual(pulled(handed), [41, 42, 43]);
});

test('through the fake gh, a declared priority field the board does not hold fails the read, naming the field', async () => {
  const { send } = fakeForge([card(51, 'High')]);
  const board = { ...WHERE, columns: COLUMNS, priority: { field: 'Urgency', options: ['High'] } };

  await assert.rejects(readSide(board, { send }).readPriority(), /^Error: readPriority on board 6 failed: the board has no field named Urgency$/);
});
