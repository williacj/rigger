// ABOUTME: Tests `rigger run`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming through L3's claim-only call until the slots are full, dispatching nothing,
// saying so, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryIn } from './git-repository.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board that L2 would dispatch: an issue in its repository, selected by the `change` kind. */
const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** The consumer's config: the template's, with its repository, its board and N filled in. */
const config = (concurrency) => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency });

/** A consumer's repository holding that config. */
const consumerRepository = (concurrency) => repositoryIn('rigger-run-', { 'rigger.config.mjs': `export default ${JSON.stringify(config(concurrency))};\n` });

/**
 * Runs the real bin's `run` in a fresh consumer repository whose config declares `concurrency`,
 * with a fake `gh` holding `board` first on PATH, ahead of the refusing one `npm test` puts there.
 */
function run(board, { concurrency }) {
  const consumer = consumerRepository(concurrency);
  const dir = mkdtempSync(join(tmpdir(), 'rigger-run-gh-'));
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
  const ran = spawnSync(process.execPath, [bin, 'run'], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status, consumer, model: fake.model };
}

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (ran) => Object.fromEntries((await (await ran.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** Four ready cards L2 would dispatch, oldest first #10, #20, #30, #40. */
const FOUR_READY = { items: [card(30, 'Ready'), card(10, 'Ready'), card(40, 'Ready'), card(20, 'Ready')] };

test('run, given N 1 and four pullable cards, claims exactly one card, which ends in the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready', 30: 'Ready', 40: 'Ready' }, ran.err);
});

test('run, given N 1 and four pullable cards, exits non-zero naming the one card it claimed', () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /claimed #10\b/, ran.err);
  for (const other of [20, 30, 40]) assert.doesNotMatch(ran.err, new RegExp(`#${other}\\b`), ran.err);
});

test('run, given N 3 and four pullable cards, claims exactly three cards, which end in the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Ready' }, ran.err);
});

test('run, given N 3 and four pullable cards, exits non-zero naming the three cards it claimed', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.notEqual(ran.code, 0, ran.out);
  for (const claimed of [10, 20, 30]) assert.match(ran.err, new RegExp(`claimed #${claimed}\\b`), ran.err);
  assert.doesNotMatch(ran.err, /#40\b/, ran.err);
});

/** Two ready cards L2 would dispatch, oldest first #10, #20. */
const TWO_READY = { items: [card(20, 'Ready'), card(10, 'Ready')] };

test('run, given N 3 and two pullable cards, claims both', async () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding' }, ran.err);
});

test('run, given N 3 and two pullable cards, exits non-zero naming both', () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /claimed #10\b/, ran.err);
  assert.match(ran.err, /claimed #20\b/, ran.err);
});

/** No pullable card: #18 sits in Backlog and #19 in Done, so neither is offered to L2. */
const NONE_PULLABLE = { items: [card(18, 'Backlog'), card(19, 'Done')] };

test('run over a board with no pullable card claims nothing, and prints that no card was pullable', async () => {
  const ran = run(NONE_PULLABLE, { concurrency: 3 });

  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.deepEqual(await columnsOf(ran), { 18: 'Backlog', 19: 'Done' });
  assert.deepEqual((await ran.model()).writes(), []);
});

test('run over a board with no pullable card exits 0', () => {
  const ran = run(NONE_PULLABLE, { concurrency: 3 });

  assert.equal(ran.code, 0, ran.err);
});

test('run says each claimed card was not worked because dispatch arrives with M2 and M4', () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  for (const claimed of [10, 20]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`#${claimed}\\b`).test(held));
    assert.ok(line, ran.err);
    assert.match(line, /not worked/, ran.err);
    assert.match(line, /dispatch arrives with M2 and M4/, ran.err);
  }
});

/** A ready card L2 refuses: its body holds no acceptance, so the form check refuses it. */
const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

test('run, given a ready card L2 refuses, leaves it in the ready column', async () => {
  const ran = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Coding' }, ran.err);
});

// proves R-CARD-7
test('run, given a ready card L2 refuses, names the card and the reason', () => {
  const ran = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 3 });

  const line = ran.err.split('\n').find((held) => /#11\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /missing acceptance/, ran.err);
});
