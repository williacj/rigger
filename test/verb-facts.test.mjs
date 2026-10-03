// ABOUTME: Tests that `once` and `plan` build L2's facts call over the forge adapter's read side,
// run against the fake `gh` with a seeded repository: a card whose line of work or merged pull
// request the forge holds is refused, and so is a card whose labels select two tiers for its maker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import template from '../templates/rigger.config.mjs';
import { once } from '../src/cli/once.mjs';
import { plan } from '../src/cli/plan.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board that the `change` kind selects, carrying `labels` beside it. */
const card = (number, column, { body = ADMITTED, labels = [] } = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body, labels: ['type:change', ...labels], column,
});

/**
 * The consumer's config: the template's, with its repository and board filled in, kinds listing no
 * provisioning, and an `engineer` role whose `labels` select `high` for `tier:high` and `standard`
 * for `tier:low`.
 */
const config = () => ({
  ...template,
  repo: REPO,
  board: { ...template.board, project: PROJECT },
  kinds: Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }])),
  roles: { ...template.roles, engineer: { ...template.roles.engineer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } },
});

/**
 * Runs `verb`, `once` or `plan`, in a fresh consumer repository holding that config, with every
 * forge call sent to a fake `gh` holding `items` on the board and a repository seeded with `seed`.
 * Answers what the verb printed and exited with, the fake board, and the repository it held after.
 */
async function ran(verb, items, seed = {}) {
  const directory = temporaryDirectory('rigger-verb-facts-');
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config())};\n` }), join(directory, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-verb-facts-gh-'), { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } });
  seedRepository(fake, seed);
  const send = (command, args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  const result = await verb({ target: consumer, send });
  return { ...result, model: await fake.model() };
}

/** The line of `text` refusing card `number`, or undefined. */
const refusalOf = (text, number) => text.split('\n').find((line) => new RegExp(`^\\s*refuse\\s+#${number}\\b`).test(line));

/** The moves in the fake board's write record, each as the item moved and the column it entered. */
const movesIn = (model) => model.writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args);

// proves R-WORK-19
test('once builds L2\'s facts call over the read side: a Ready card whose branch the fake gh holds is refused, naming its line of work, and is never moved', async () => {
  const seed = { branches: ['rigger-10'] };

  const result = await ran(once, [card(10, 'Ready')], seed);

  const refused = refusalOf(result.text, 10);
  assert.ok(refused, result.text);
  assert.match(refused, /rigger-10/);
  assert.match(result.text, /no card was pullable/);
  assert.deepEqual(movesIn(result.model), []);
});

// proves R-WORK-19
test('plan names every card the facts call refuses, with its reason, beside the refusals it names at the base', async () => {
  const seed = { branches: ['rigger-10'], pullRequests: [{ number: 77, head: 'rigger-20', sha: 'a'.repeat(40), merged: true }] };
  const items = [card(10, 'Ready'), card(20, 'Coding'), card(30, 'Ready', { body: '## Notes\n\nNo acceptance here.\n' }), card(40, 'Ready')];

  const result = await ran(plan, items, seed);

  assert.equal(result.code, 0, result.text);
  assert.match(refusalOf(result.text, 10) ?? '', /rigger-10/, result.text);
  assert.match(refusalOf(result.text, 20) ?? '', /#77\b/, result.text);
  assert.match(refusalOf(result.text, 30) ?? '', /missing acceptance/, result.text);
  assert.equal(refusalOf(result.text, 40), undefined, result.text);
  assert.match(result.text, /^\s*pull\s+#40\b/m);
  assert.deepEqual(result.model.writes(), []);
});

// proves R-LOOP-13
test('given a card carrying two labels that select different tiers for its maker role, plan names the card, the role and both labels as a refusal, and once over the same board refuses it alike', async () => {
  const items = [card(50, 'Ready', { labels: ['tier:high', 'tier:low'] })];

  const planned = await ran(plan, items);
  const claimed = await ran(once, items);

  for (const result of [planned, claimed]) {
    const refused = refusalOf(result.text, 50);
    assert.ok(refused, result.text);
    assert.match(refused, /\bengineer\b/);
    assert.match(refused, /tier:high/);
    assert.match(refused, /tier:low/);
  }
  assert.equal(refusalOf(planned.text, 50), refusalOf(claimed.text, 50), 'plan and once refuse the card in the same words');
  assert.deepEqual(movesIn(claimed.model), []);
});
