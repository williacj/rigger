// ABOUTME: Tests `rigger plan`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, printing the pull order and the refusals, writing nothing, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { plan as planVerb } from '../src/cli/plan.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
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

/** A card on the consumer's board: an issue in its repository, selected by the `change` kind. */
const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/**
 * Runs the real bin's `plan` in a fresh consumer repository whose config is the template's with
 * the consumer's repository and board filled in, with a fake `gh` holding `board` first on PATH,
 * ahead of the refusing one `npm test` puts there. `project` is the board the fake `gh` holds, so
 * a config naming another is a board it cannot read.
 */
function plan(board, { project = PROJECT } = {}) {
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };
  const consumer = repositoryIn('rigger-plan-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  const fake = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-plan-gh-')), { repo: REPO, project, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const env = { ...process.env, PATH: `${dirname(fake.gh)}${delimiter}${process.env.PATH}` };
  const ran = spawnSync(process.execPath, [bin, 'plan'], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status, model: fake.model };
}

/** The lines of a plan naming a card it would pull, in the order printed. */
const pullLines = (text) => text.split('\n').filter((line) => /^\s*pull\s+#\d+/.test(line));

/** The numbers of the cards a plan would pull, in the order printed. */
const pulled = (text) => pullLines(text).map((line) => Number(line.match(/#(\d+)/)[1]));

/** The line of a plan refusing card `number`, or undefined. */
const refusalOf = (text, number) => text.split('\n').find((line) => new RegExp(`^\\s*refuse\\s+#${number}\\b`).test(line));

test('plan prints the pull order one card per line, highest declared priority first, then oldest', () => {
  // The config's declared order is High, Normal, Low, which is not the board field's own order,
  // and a card holding no value ranks below every option. So by hand: #20 (High), #30 (Normal),
  // #10 (Low), #40 (none). #5 sits in Backlog and is never offered.
  const ran = plan({
    items: [
      card(30, 'Ready', { fieldValues: { Priority: 'Normal' } }),
      card(10, 'Ready', { fieldValues: { Priority: 'Low' } }),
      card(5, 'Backlog', { fieldValues: { Priority: 'High' } }),
      card(20, 'Ready', { fieldValues: { Priority: 'High' } }),
      card(40, 'Ready'),
    ],
  });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), [20, 30, 10, 40], ran.out);
});

// proves R-CARD-7
test('plan prints a card with no acceptance with missing acceptance as the reason, and does not pull it', () => {
  const ran = plan({ items: [card(11, 'Ready', { body: 'Why this matters, and nothing more.' }), card(12, 'Ready')] });

  assert.equal(ran.code, 0, ran.err);
  assert.match(refusalOf(ran.out, 11) ?? '', /missing acceptance/, ran.out);
  assert.deepEqual(pulled(ran.out), [12], ran.out);
});

// proves R-CARD-8
test('plan prints a card whose acceptance only restates its title with a restated title as the reason', () => {
  const ran = plan({ items: [card(13, 'Ready', { title: 'Paint the widget', body: '## Acceptance\n\n- Paint the widget.\n' })] });

  assert.equal(ran.code, 0, ran.err);
  assert.match(refusalOf(ran.out, 13) ?? '', /restated title/, ran.out);
  assert.deepEqual(pulled(ran.out), [], ran.out);
});

test('plan lists redos ahead of Ready cards, each marked as a redo', () => {
  // #50 is a Ready card holding the top priority; #60 and #70 sit in Coding and Review, where a
  // card is a redo, and hold none. Redos come first whatever their rank, so: #60, #70, #50.
  const ran = plan({
    items: [
      card(50, 'Ready', { fieldValues: { Priority: 'High' } }),
      card(70, 'Review'),
      card(60, 'Coding'),
    ],
  });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), [60, 70, 50], ran.out);
  const lines = pullLines(ran.out);
  assert.match(lines[0], /redo/, ran.out);
  assert.match(lines[1], /redo/, ran.out);
  assert.doesNotMatch(lines[2], /redo/, ran.out);
});

test('plan prints a ready card two kinds select with its number and both kinds', () => {
  const ran = plan({ items: [card(14, 'Ready', { labels: ['type:change', 'type:spec'] })] });

  assert.equal(ran.code, 0, ran.err);
  const line = refusalOf(ran.out, 14) ?? '';
  assert.match(line, /\bchange\b/, ran.out);
  assert.match(line, /\bspec\b/, ran.out);
  assert.deepEqual(pulled(ran.out), [], ran.out);
});

test('plan leaves the fake board\'s write record empty', async () => {
  // A board holding a pull, a redo and a refusal, so a plan that moved any card it named would
  // leave a write behind.
  const ran = plan({ items: [card(15, 'Ready'), card(16, 'Coding'), card(17, 'Ready', { body: '' })] });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), [16, 15], ran.out);
  assert.deepEqual((await ran.model()).writes(), []);
});

test('plan prints that nothing would be pulled, given an empty Ready column and no redo', () => {
  const ran = plan({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /nothing would be pulled/, ran.out);
  assert.deepEqual(pulled(ran.out), [], ran.out);
});

test('plan exits non-zero naming the board number when the board cannot be read', () => {
  // The fake `gh` holds board 4 of the consumer's owner and the config names board 3, so gh
  // answers that it can find no such board, as the real one does.
  const ran = plan({ items: [card(21, 'Ready')] }, { project: 4 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, new RegExp(`\\bboard ${PROJECT}\\b`), ran.err);
});

// proves R-SAFE-5
test('plan run against the source tree it is running from exits non-zero, names R-SAFE-5, and reads no board', async () => {
  // Git alone may be asked, because naming the tree is the refusal's own work. Every forge read
  // goes through `send`, which records rather than answers, so a board read shows as a call.
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    throw new Error(`plan ran \`${command}\` before refusing`);
  };
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args].join(' '));
    return { status: 1, stdout: '', stderr: 'no board here' };
  };

  const ran = await planVerb({ target: root, packageRoot: root, ask: asked, send });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/);
  assert.deepEqual(sent, []);
});
