// ABOUTME: Tests that `once` and `plan` build L2's facts call over the forge adapter's read side,
// run against the fake `gh` with a seeded repository: a card whose line of work or merged pull
// request the forge holds escalates; labels selecting two maker tiers remain an ordinary refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { withFirstOnPath } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { gitIn } from './git-repository.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

import template from '../templates/rigger.config.mjs';
import { once } from '../src/cli/once.mjs';
import { plan } from '../src/cli/plan.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { closerText, seed } from './admission-world.mjs';

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
async function ran(verb, items, seed = {}, { settings = config(), prepare = () => {}, refuse } = {}) {
  const directory = temporaryDirectory('rigger-verb-facts-');
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` }), join(directory, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-verb-facts-gh-'), { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } });
  seedRepository(fake, seed);
  prepare({ consumer, fake });
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    // The executable fake's optionId maps COLUMNS[4], Owner, to option-4.
    const move = args.some((arg) => arg.includes('singleSelectOptionId: "option-4"'));
    const path = args[1];
    const refused = refuse === 'move' ? move : refuse === 'comment' ? path === `repos/${REPO}/issues/${items[0].number}/comments` && args.includes('POST')
      : refuse === 'label' && path === `repos/${REPO}/issues/${items[0].number}/labels` && args.includes('POST');
    if (refused) return { status: 1, stdout: '', stderr: `the forge refused ${refuse}` };
    return spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  };
  const result = await withFirstOnPath(dirname(fake.gh), () => verb({ target: consumer, send }));
  const repository = JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8')).repository;
  return { ...result, model: await fake.model(), repository, sent, consumer };
}

/** The line of `text` refusing card `number`, or undefined. */
const refusalOf = (text, number) => text.split('\n').find((line) => new RegExp(`^\\s*refuse\\s+#${number}\\b`).test(line));

/** The moves in the fake board's write record, each as the item moved and the column it entered. */
const movesIn = (model) => model.writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args);

// proves R-WORK-19
test('once builds L2\'s facts call over the read side: a Ready card whose branch the fake gh holds escalates naming its line of work', async () => {
  const seed = { branches: ['rigger-10'] };

  const result = await ran(once, [card(10, 'Ready')], seed);

  const refused = result.repository.issues[0].comments[0].body;
  assert.ok(refused, result.text);
  assert.match(refused, /rigger-10/);
  assert.match(result.text, /card #10 escalated ambiguous/);
  assert.deepEqual(movesIn(result.model), [['item-1', 'Owner']]);
});

// proves R-WORK-19
test('plan names converted forge refusals as escalations beside the ordinary form refusals', async () => {
  const seed = { branches: ['rigger-10'], pullRequests: [{ number: 77, head: 'rigger-20', sha: 'a'.repeat(40), merged: true }] };
  const items = [card(10, 'Ready'), card(20, 'Coding'), card(30, 'Ready', { body: '## Notes\n\nNo acceptance here.\n' }), card(40, 'Ready')];

  const result = await ran(plan, items, seed);

  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /pull\s+#10\s+escalate ambiguous/);
  assert.match(result.text, /pull\s+#20\s+escalate ambiguous/);
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

// proves R-LOOP-13, R-WORK-19
test('given a second card whose labels select two tiers for its maker role and whose line of work the fake gh holds, plan and once each name its role, both labels and its line of work', async () => {
  const items = [card(50, 'Ready', { labels: ['tier:high', 'tier:low'] }), card(60, 'Ready', { labels: ['tier:high', 'tier:low'] })];
  const seed = { branches: ['rigger-60'] };

  const planned = await ran(plan, items, seed);
  const claimed = await ran(once, items, seed);

  for (const result of [planned, claimed]) {
    const refused = refusalOf(result.text, 60);
    assert.ok(refused, result.text);
    for (const named of [/\bengineer\b/, /tier:high/, /tier:low/, /\brigger-60\b/]) assert.match(refused, named);
  }
  assert.equal(refusalOf(planned.text, 60), refusalOf(claimed.text, 60), 'plan and once refuse the card in the same words');
  assert.deepEqual(movesIn(claimed.model), []);
});


import { run } from '../src/cli/run.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// proves R-WORK-36
test('run cleans eligible closed history then reports the unchanged form refusal once and exits zero', async () => {
  const directory = temporaryDirectory('rigger-run-closed-refusal-');
  const settings = config();
  settings.worktrees = { ...settings.worktrees, root: directory };
  const scratch = join(directory, 'scratch', 'rigger-99', 'reviewer');
  const result = await ran(async (options) => {
    writeFileSync(join(options.target, 'rigger.config.mjs'), `export default ${JSON.stringify(settings)};\n`);
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, 'cleanup-witness.txt'), 'closed card scratch');
    assert.equal(existsSync(scratch), true, 'actual scratch exists before run');
    return run(options);
  }, [card(99, 'Review', { body: 'No acceptance.' })], {
    pullRequests: [{ number: 1099, head: 'rigger-99', sha: 'a'.repeat(40), closed: true }],
  });
  assert.equal(existsSync(scratch), false, 'closed cleanup removes actual scratch before reporting the run refusal');
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /rigger run: card #99 refused: .*missing acceptance/);
  assert.equal(result.text.split('\n').filter((line) => line.includes('card #99 refused:')).length, 1);
  assert.doesNotMatch(result.text, /undefined/);
  assert.deepEqual(result.model.writes(), []);
});

// The counterexample leaves one column's forge refusal in plan's refuse lines.
// proves R-ESCALATE-12
test('plan lists every converted forge cell as an ambiguous escalation and keeps ordinary conflicts refused', async () => {
  const items = [card(701, 'Ready'), card(702, 'Coding'), card(703, 'Review'), card(704, 'Ready'), card(705, 'Coding'), card(706, 'Review'), card(707, 'Owner'), card(708, 'Ready', { labels: ['tier:high', 'tier:low'] }), card(709, 'Ready', { body: 'No acceptance.' }), card(710, 'Owner'), card(711, 'Owner')];
  const seed = { branches: ['rigger-701', 'rigger-702', 'rigger-703', 'rigger-708', 'rigger-710'], pullRequests: [
    { number: 1704, head: 'rigger-704', sha: 'a'.repeat(40), merged: true },
    { number: 1705, head: 'rigger-705', sha: 'a'.repeat(40), merged: true },
    { number: 1706, head: 'rigger-706', sha: 'a'.repeat(40) },
    { number: 2706, head: 'rigger-706', sha: 'a'.repeat(40) },
    { number: 1711, head: 'rigger-711', sha: 'a'.repeat(40) },
    { number: 2711, head: 'rigger-711', sha: 'a'.repeat(40) },
  ] };
  const result = await ran(plan, items, seed);
  assert.equal(result.code, 0, result.text);
  for (const number of [701, 702, 703, 704, 705, 706, 707, 710, 711]) {
    assert.match(result.text, new RegExp(`^\\s*pull\\s+#${number}\\s+escalate ambiguous`, 'm'));
    assert.equal(refusalOf(result.text, number), undefined, result.text);
  }
  assert.match(refusalOf(result.text, 708), /tier:high.*tier:low.*rigger-708/);
  assert.match(refusalOf(result.text, 709), /missing acceptance/);
  assert.deepEqual(result.model.writes(), []);
});

const { 60_000: SETTLES_WITHIN } = BOUNDS;

// A closed admission must hide the forge card once its refusal becomes a pull action.
// proves R-ESCALATE-12
test('plan under a closed admission hides a converted forge escalation and retains ordinary refusals', async () => {
  const result = await ran(plan, [card(701, 'Ready'), card(709, 'Ready', { body: 'No acceptance.' })], {
    branches: ['rigger-701'],
  }, { prepare: ({ consumer }) => seed(join(consumer, '.rigger'), 'owner-a1.json', closerText({ reason: 'owner pause' })) });

  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /admission is closed by owner: owner pause/);
  assert.doesNotMatch(result.text, /#701\b/);
  assert.match(refusalOf(result.text, 709), /missing acceptance/);
  assert.deepEqual(result.model.writes(), []);
});

// The counterexample retries an escalation write or hides which owner write the forge refused.
// proves R-ESCALATE-12
test('run names every refused escalation write at an attempt or the judges and pulls the card once', SETTLES_WITHIN, async (t) => {
  for (const stage of ['attempt', 'judges']) for (const refuse of [undefined, 'comment', 'move', 'label']) {
    await t.test(`${stage} / ${refuse ?? 'success'}`, async () => {
      const settings = config();
      settings.kinds = { change: { ...settings.kinds.change, judges: ['reviewer', 'architect'] } };
      const agent = standInAgent({ 984: { architect: { findings: true } } });
      let path;
      const result = await withFirstOnPath(agent.dir, () => ran(run, [card(984, stage === 'attempt' ? 'Ready' : 'Review')], {}, { settings, refuse, prepare: ({ consumer, fake }) => {
        path = stage === 'attempt' ? join(dirname(consumer), 'widgets-worktrees', 'rigger-984')
          : join(dirname(consumer), 'widgets-worktrees', 'scratch', 'rigger-984', 'reviewer');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, 'preserved owner file\n');
        if (stage === 'judges') {
          gitIn(consumer, 'push', '-q', 'origin', 'HEAD:refs/heads/rigger-984');
          const head = gitIn(consumer, 'rev-parse', 'HEAD').trim();
          seedRepository(fake, { branches: ['rigger-984'], pullRequests: [{ number: 1984, head: 'rigger-984', sha: head, mergeBase: head, diff: '' }] });
        }
      } }));
      const events = readEvents(join(result.consumer, '.rigger'));
      assert.equal(events.filter(({ event }) => event === 'pull').length, 1);
      assert.equal(events.filter(({ event }) => event === 'review.escalate').length, 1);
      const issue = result.repository.issues[0];
      assert.equal(issue.comments?.length ?? 0, refuse === 'comment' ? 0 : 1);
      assert.equal(readFileSync(path, 'utf8'), 'preserved owner file\n');
      if (refuse !== undefined) {
        assert.notEqual(result.code, 0, result.text);
        assert.ok(result.text.includes(`the forge refused ${refuse}`), result.text);
        assert.ok(result.text.includes(refuse === 'move' ? 'move' : refuse === 'label' ? 'escalation label' : 'issue comment'), result.text);
        assert.ok(!issue.labels.includes('rigger:escalated'));
      } else assert.ok(issue.labels.includes('rigger:escalated'));
      if (stage === 'judges') assert.ok(result.repository.pullRequests[0].comments.some(({ body }) => body.includes('role: architect')));
    });
  }
});
