// ABOUTME: Tests `rigger plan`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, printing the pull order and the refusals, writing nothing, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { plan as planVerb } from '../src/cli/plan.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { seedRepository } from './fake-gh.mjs';
import { markerComment } from './fake-repository.mjs';
import { repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

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
  const fake = installFakeGh(temporaryDirectory('rigger-plan-gh-'), { repo: REPO, project, board: { columns: COLUMNS, fields: FIELDS, ...board } });
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

// A Review card's judges, from the same facts call and next action `once` and `run` use (#488).

/** The head SHA and merge base of the pull request the judge tests below seed, each written by hand. */
const JUDGED_HEAD = '6'.repeat(40);
const JUDGED_BASE = '7'.repeat(40);

/**
 * Runs the real bin's `verb` in a fresh consumer repository whose config is the template's, with
 * the consumer's repository and board filled in and `roles` in place of its roles where given,
 * over a fake `gh` holding `board` and, beside it, the repository `seed`, first on PATH.
 */
function verbOver(verb, board, seed, { roles } = {}) {
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, ...(roles && { roles }) };
  const consumer = repositoryIn('rigger-plan-judges-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  const fake = installFakeGh(temporaryDirectory('rigger-plan-judges-gh-'), { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  seedRepository(fake, seed);
  const env = { ...process.env, PATH: `${dirname(fake.gh)}${delimiter}${process.env.PATH}` };
  const ran = spawnSync(process.execPath, [bin, verb], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status, fake, again: (other) => spawnSync(process.execPath, [bin, other], { cwd: consumer, encoding: 'utf8', env }) };
}

/** Card `number`'s one open pull request from its line of work, numbered `100 + number`. */
const openFor = (number) => ({ number: 100 + number, head: `rigger-${number}`, sha: JUDGED_HEAD, diff: 'diff --git a/x b/x\n', mergeBase: JUDGED_BASE });

test('given a Review card whose agent judges have no findings at its head, plan names it as a pull and names each judge it would dispatch', () => {
  const ran = verbOver('plan', { items: [card(50, 'Review')] }, { pullRequests: [openFor(50)] });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pullLines(ran.out), ['  pull    #50  change  judges reviewer'], ran.out);
});

// proves R-LOOP-13
test('given a Review card carrying two labels that select different tiers for one of its judge roles, plan names it as a refusal naming that role and both labels, as once over the same board refuses it', () => {
  const roles = { ...template.roles, reviewer: { ...template.roles.reviewer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const ran = verbOver('plan', { items: [card(51, 'Review', { labels: ['type:change', 'tier:high', 'tier:low'] })] }, { pullRequests: [openFor(51)] }, { roles });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), []);
  const line = refusalOf(ran.out, 51);
  for (const named of [/\breviewer\b/, /tier:high/, /tier:low/]) assert.match(line ?? '', named, ran.out);
  const once = ran.again('once');
  assert.equal(refusalOf(once.stdout, 51), line, `${once.stdout}${once.stderr}`);
});

for (const { action, column, ruling, expected } of [
  { action: 'move', column: 'Review', merged: true, expected: /move.*done/ },
  { action: 'continue', column: 'Review', ruling: { verdict: 'needs revision', items: ['unmet'], toSound: 'Print help.' }, expected: /continue.*#160.*6666666666666666666666666666666666666666/ },
  { action: 'return', column: 'Review', ruling: { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' }, expected: /return.*#160/ },
  { action: 'escalate', column: 'Review', ruling: { verdict: 'critical', toSound: 'Keep the user files.' }, expected: /escalate.*critical/ },
  { action: 'move from Owner', column: 'Owner', expected: /move.*review.*\(redo\)/ },
]) {
  test(`plan names a ${column} card's ${action} answer and writes nothing`, async () => {
    const number = 60;
    const pull = 160;
    const comments = ruling === undefined ? [] : [markerComment({ card: number, pull, head: JUDGED_HEAD, body: ADMITTED, ...ruling })];
    const seed = { pullRequests: [{ ...openFor(number), merged: action === 'move', comments }] };
    const ran = verbOver('plan', { items: [card(number, column)] }, seed);

    assert.equal(ran.code, 0, ran.err);
    assert.deepEqual(pulled(ran.out), [number], ran.out);
    assert.match(pullLines(ran.out)[0], expected, ran.out);
    assert.deepEqual((await ran.fake.model()).writes(), []);
    const view = spawnSync(ran.fake.gh, ['pr', 'view', String(pull), '--json', 'comments'], { encoding: 'utf8', env: gitEnvironment() });
    assert.equal(JSON.parse(view.stdout).comments.length, comments.length);
  });
}

// proves R-ESCALATE-10
test('plan names labelled active-stage cards as escalated and counts only ordinary refusals', async () => {
  const items = ['Ready', 'Coding', 'Review', 'Owner'].map((column, at) =>
    card(at + 1, column, { body: '', labels: ['type:change', at % 2 ? 'RIGGER:ESCALATED' : 'rigger:escalated'] }));
  const ran = plan({ items: [...items, card(5, 'Ready', { body: '' })] });
  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), []);
  assert.match(ran.out, /and refuses 1 card\b/);
  for (const item of items) {
    assert.match(ran.out, new RegExp(`^\\s*escalated\\s+#${item.number}\\b`, 'm'));
    assert.equal(refusalOf(ran.out, item.number), undefined, ran.out);
  }
  assert.match(refusalOf(ran.out, 5), /missing acceptance/);
  assert.deepEqual((await ran.model()).writes(), []);
});

// proves R-ESCALATE-10
test('plan reports escalated items outside active columns without reading their workflow facts', async () => {
  const items = ['Done', null, 'Backlog', 'Elsewhere'].map((column, at) =>
    card(71 + at, column, { labels: ['type:change', at % 2 ? 'RIGGER:ESCALATED' : 'rigger:escalated'] }));
  const ran = verbOver('plan', { columns: [...COLUMNS, 'Elsewhere'], items }, {});
  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), []);
  assert.doesNotMatch(ran.out, /refus/);
  for (const item of items) assert.match(ran.out, new RegExp(`^\\s*escalated\\s+#${item.number}\\b`, 'm'));
  const sent = JSON.stringify(ran.fake.sent());
  assert.doesNotMatch(sent, /rigger-(?:71|72|73|74)/, sent);
  assert.doesNotMatch(sent, /\/pulls(?:\/|\?)/, sent);
  assert.deepEqual((await ran.fake.model()).writes(), []);
});

// proves R-ESCALATE-10
test('plan keeps merged escalation actions and names forge refusals without counting them as refused', async () => {
  for (const branch of [false, true]) {
    const items = ['Ready', 'Coding', 'Review', 'Owner'].map((column, at) =>
      card(81 + at, column, { labels: ['type:change', at % 2 ? 'RIGGER:ESCALATED' : 'rigger:escalated'] }));
    const ran = verbOver('plan', { items }, {
      branches: branch ? items.map((item) => `rigger-${item.number}`) : [],
      pullRequests: items.map((item) => ({ ...openFor(item.number), merged: true })),
    });
    assert.equal(ran.code, 0, ran.err);
    assert.deepEqual(pulled(ran.out), [83, 84], ran.out);
    assert.doesNotMatch(ran.out, /refus/);
    for (const item of items) assert.match(ran.out, new RegExp(`^\\s*escalated\\s+#${item.number}\\b`, 'm'));
    for (const number of [81, 82]) assert.match(ran.out, new RegExp(`escalated #${number}.*forge holds pull request #${100 + number}, merged`));
    assert.deepEqual((await ran.fake.model()).writes(), []);
  }
});

test('plan does not report an unlabelled card waiting for its owner judge as escalated', async () => {
  const number = 191;
  const comments = ['reviewer', 'engineer', 'architect'].map((role) =>
    markerComment({ card: number, pull: 291, head: JUDGED_HEAD, body: ADMITTED, role }));
  const ran = verbOver('plan', { items: [card(number, 'Owner', { labels: ['type:spec'] })] }, {
    pullRequests: [{ ...openFor(number), comments }],
  });
  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(pulled(ran.out), [], ran.out);
  assert.doesNotMatch(ran.out, /escalat|refus/);
  assert.deepEqual((await ran.fake.model()).writes(), []);
});

test('plan preserves its named board-read failure for a labelled card', () => {
  const ran = plan({ items: [card(192, 'Ready', { labels: ['type:change', 'rigger:escalated'] })] }, { project: PROJECT + 1 });
  assert.notEqual(ran.code, 0);
  assert.match(ran.err, /board 3 could not be read/);
  assert.doesNotMatch(ran.out, /escalated #192/);
});

test('plan names a labelled card when its workflow facts cannot be read', async () => {
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };
  const consumer = repositoryIn('rigger-plan-escalated-read-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  const fake = installFakeGh(temporaryDirectory('rigger-plan-escalated-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS,
      items: [card(193, 'Ready', { labels: ['type:change', 'rigger:escalated'] })] },
  });
  const observed = [];
  const send = (file, args) => {
    assert.equal(file, 'gh');
    observed.push(args);
    if (args[1] === 'graphql' && args[3].includes('pullRequests(')) {
      return { status: 1, stdout: '', stderr: 'workflow facts refused: HTTP 503' };
    }
    return spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  };

  const ran = await planVerb({ target: consumer, packageRoot: root, send });

  assert.equal(ran.code, 1, ran.text);
  assert.match(ran.text, /L2 could not read what the forge holds for card #193/);
  assert.match(ran.text, /workflow facts refused: HTTP 503/);
  assert.doesNotMatch(ran.text, /escalated #193/);
  assert.equal(observed.filter((args) => args[1] === 'graphql' && args[3].includes('pullRequests(')).length, 1);
  assert.deepEqual((await fake.model()).writes(), []);
});


import { mkdirSync, readdirSync } from 'node:fs';

// proves R-WORK-36
test('plan describes closed removal followed by redo escalation or refusal and changes neither directories nor forge facts', async () => {
  const directory = temporaryDirectory('rigger-plan-closed-directories-');
  const settings = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, worktrees: { ...template.worktrees, root: directory } };
  const consumer = repositoryIn('rigger-plan-closed-consumer-', { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  const items = [card(91, 'Review'), card(92, 'Owner'), card(93, 'Review', { body: 'No acceptance.' }), card(94, 'Owner', { labels: ['type:change', 'rigger:escalated'] })];
  for (const item of items) {
    mkdirSync(join(directory, `rigger-${item.number}`));
    writeFileSync(join(directory, `rigger-${item.number}`, 'kept'), `keep ${item.number}`);
  }
  const fake = installFakeGh(temporaryDirectory('rigger-plan-closed-gh-'), { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } });
  seedRepository(fake, { pullRequests: items.map(({ number }) => ({ number: 1000 + number, head: `rigger-${number}`, sha: String(number).padStart(40, 'a'), closed: true })) });
  const held = () => { const { sent, ...facts } = JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8')); return facts; };
  const before = held();
  const files = readdirSync(directory);
  const ran = spawnSync(process.execPath, [bin, 'plan'], { cwd: consumer, encoding: 'utf8', env: { ...gitEnvironment(), PATH: `${dirname(fake.gh)}${delimiter}${process.env.PATH}` } });
  assert.equal(ran.error, undefined);
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(pulled(ran.stdout), [91, 92, 93]);
  assert.match(pullLines(ran.stdout)[0], /remove directories, then change.*\(redo\)/);
  assert.match(pullLines(ran.stdout)[1], /remove directories, then escalate ambiguous.*\(redo\)/);
  assert.match(pullLines(ran.stdout)[2], /remove directories, then refuse: missing acceptance.*\(redo\)/);
  assert.match(ran.stdout, /escalated #94/);
  assert.doesNotMatch(ran.stdout, /undefined/);
  assert.deepEqual(held(), before, 'all issue, pull and board facts remain unchanged');
  assert.deepEqual((await fake.model()).writes(), []);
  assert.deepEqual(readdirSync(directory), files);
  for (const item of items) assert.equal(readFileSync(join(directory, `rigger-${item.number}`, 'kept'), 'utf8'), `keep ${item.number}`);
});

// What `plan` shows while admission is closed or cannot be read (#962): no pull, and why.

import { existsSync, realpathSync } from 'node:fs';
import { admissionOf, closerText, picture, seed, TIME } from './admission-world.mjs';
import { readEvents } from '../src/observation/sink.mjs';

/** A closer's words, written out by hand as `once` printed them at #944's head. */
const OWNER_WORDS = `admission is closed by owner: owner pause; time ${TIME}`;
const HOLD_WORDS = `admission is closed by hold: environment hold; time ${TIME}`;

/** The consumer's config, as `plan` above writes it. */
const CONSUMER = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };

/**
 * A consumer repository holding `source` as its config, beside a fake `gh` holding `board` and the
 * repository `held`, and `plan` run in process over it, its forge reads sent through `send` where
 * given and to the fake `gh` otherwise.
 */
function admissionWorld(board, { held, source = `export default ${JSON.stringify(CONSUMER)};\n` } = {}) {
  const consumer = repositoryIn('rigger-plan-admission-', { 'rigger.config.mjs': source });
  const fake = installFakeGh(temporaryDirectory('rigger-plan-admission-gh-'), { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  if (held) seedRepository(fake, held);
  const through = (file, args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });
  const state = join(consumer, '.rigger');
  return {
    consumer, fake, state,
    unread: admissionOf(join(realpathSync(consumer), '.rigger')),
    run: (send = through) => planVerb({ target: consumer, packageRoot: root, send }),
    through,
  };
}

/** A board where the next run would pull a Ready card and move a Review card whose pull request merged. */
const PULLING = { items: [card(31, 'Ready'), card(32, 'Review')] };
const PULLING_HELD = { pullRequests: [{ ...openFor(32), merged: true }] };

/** A board holding a pull, a card L2 refuses, and an escalated card. */
const MIXED = { items: [card(41, 'Ready'), card(42, 'Ready', { body: '' }), card(43, 'Ready', { labels: ['type:change', 'rigger:escalated'] })] };

/** The lines a plan names a refused or escalated card on. */
const reportedLines = (text) => text.split('\n').filter((line) => /^\s*(?:refuse|escalated)\s+#\d+/.test(line));

// proves R-SCHED-18
test('plan shows the ordinary pull order where the admission directory is absent, empty, or holds only names starting with a dot', async () => {
  for (const prepare of [() => {}, (state) => mkdirSync(admissionOf(state), { recursive: true }), (state) => seed(state, '.tmp-a1', 'half')]) {
    const world = admissionWorld(PULLING, { held: PULLING_HELD });
    const absent = await world.run();
    prepare(world.state);
    const ran = await world.run();
    assert.equal(ran.code, 0, ran.text);
    assert.deepEqual(pulled(ran.text), [32, 31], ran.text);
    assert.equal(ran.text, absent.text);
  }
});

// proves R-SCHED-18
test('plan under one owner closer, one hold closer of each name form, or both, shows no pull line of any action, names each closer in once\'s words, and exits 0', async () => {
  const cases = [
    [(state) => seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })), [OWNER_WORDS]],
    ...['hold-b2.json', 'hold-b2-after-3.json', 'hold-b2-issue-41.json'].map((name) => [(state) => seed(state, name, closerText({ reason: 'environment hold' })), [HOLD_WORDS]]),
    [(state) => { seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })); seed(state, 'hold-b2.json', closerText({ reason: 'environment hold' })); }, [OWNER_WORDS, HOLD_WORDS]],
  ];
  for (const [prepare, words] of cases) {
    const world = admissionWorld(PULLING, { held: PULLING_HELD });
    const open = await world.run();
    assert.deepEqual(pulled(open.text), [32, 31], open.text);
    prepare(world.state);
    const ran = await world.run();
    assert.equal(ran.code, 0, ran.text);
    assert.deepEqual(pullLines(ran.text), [], ran.text);
    assert.doesNotMatch(ran.text, /^\s*pull\b/m, ran.text);
    assert.match(ran.text, /nothing would be pulled/, ran.text);
    for (const said of words) assert.ok(ran.text.split('\n').includes(`rigger plan: ${said}`), ran.text);
    assert.deepEqual((await world.fake.model()).writes(), []);
  }
});

/** Each entry admission's module cannot read, with the cause it names, seeded by hand. */
const UNREADABLE = [
  { name: 'stray.json', cause: 'no closer form', make: (state) => seed(state, 'stray.json', closerText()) },
  { name: 'owner-c3.json', cause: 'no reason, time or run', make: (state) => seed(state, 'owner-c3.json', JSON.stringify({ reason: 'r', run: 'x' })) },
  { name: 'owner-d4.json', cause: 'not a regular file', make: (state) => mkdirSync(join(admissionOf(state), 'owner-d4.json'), { recursive: true }) },
];

// proves R-SCHED-18
test('plan under an unreadable admission shows no pull line, names each path and cause, and exits non-zero', async () => {
  const cases = [
    ...UNREADABLE.map(({ name, cause, make }) => [make, (dir) => [`${join(dir, name)} (${cause})`]]),
    [(state) => { seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })); seed(state, 'stray.json', closerText()); }, (dir) => [`${join(dir, 'stray.json')} (no closer form)`]],
    [(state) => { mkdirSync(state, { recursive: true }); writeFileSync(admissionOf(state), 'a file'); }, (dir) => [`${dir} (not a directory)`]],
  ];
  for (const [prepare, named] of cases) {
    const world = admissionWorld(PULLING, { held: PULLING_HELD });
    prepare(world.state);
    const ran = await world.run();
    assert.notEqual(ran.code, 0, ran.text);
    assert.deepEqual(pullLines(ran.text), [], ran.text);
    assert.doesNotMatch(ran.text, /^\s*pull\b/m, ran.text);
    assert.match(ran.text, /admission cannot be read/, ran.text);
    for (const said of named(world.unread)) assert.ok(ran.text.includes(said), `${said} is not in:\n${ran.text}`);
  }
});

// proves R-SCHED-18
test('plan under a closed or unreadable admission still reports each card it refuses and each escalated card, as under an open one', async () => {
  for (const prepare of [(state) => seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })), (state) => seed(state, 'stray.json', closerText())]) {
    const world = admissionWorld(MIXED);
    const open = await world.run();
    assert.deepEqual(pulled(open.text), [41], open.text);
    assert.equal(reportedLines(open.text).length, 2, open.text);
    prepare(world.state);
    const ran = await world.run();
    assert.deepEqual(pullLines(ran.text), [], ran.text);
    assert.deepEqual(reportedLines(ran.text), reportedLines(open.text), ran.text);
    assert.match(ran.text, /and refuses 1 card\b/, ran.text);
  }
});

// proves R-SCHED-18
test('plan names the config problem beside the closers where the config cannot be read or is refused, and exits non-zero', async () => {
  const refused = { ...CONSUMER };
  delete refused.repo;
  for (const [source, problem] of [['export default {\n', /could not be read/], [`export default ${JSON.stringify(refused)};\n`, /rigger\.config\.mjs/]]) {
    const world = admissionWorld(PULLING, { source });
    seed(world.state, 'owner-a1.json', closerText({ reason: 'owner pause' }));
    const ran = await world.run();
    assert.notEqual(ran.code, 0, ran.text);
    assert.match(ran.text, problem, ran.text);
    assert.ok(ran.text.split('\n').includes(`rigger plan: ${OWNER_WORDS}`), ran.text);
    assert.deepEqual(pullLines(ran.text), [], ran.text);
  }
});

/** A send failing every forge read, as a forge outage does. */
const OUTAGE = () => ({ status: 1, stdout: '', stderr: 'HTTP 502: forge unavailable' });

/** A send through the fake `gh` failing only the facts call's pull-request reads. */
const factsDown = (world) => (file, args) => (args[1] === 'graphql' && args[3].includes('pullRequests(')
  ? { status: 1, stdout: '', stderr: 'workflow facts refused: HTTP 503' }
  : world.through(file, args));

// proves R-SCHED-18
test('plan names the board or facts read failure beside the closers, or beside each unreadable path, and exits non-zero', async () => {
  for (const [prepare, said] of [
    [(state) => seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })), () => `rigger plan: ${OWNER_WORDS}`],
    [(state) => seed(state, 'stray.json', closerText()), (world) => `${join(world.unread, 'stray.json')} (no closer form)`],
  ]) {
    for (const [send, failure] of [[() => OUTAGE, /board 3 could not be read.*HTTP 502/], [factsDown, /workflow facts refused: HTTP 503/]]) {
      const world = admissionWorld(PULLING, { held: PULLING_HELD });
      prepare(world.state);
      const ran = await world.run(send(world));
      assert.notEqual(ran.code, 0, ran.text);
      assert.match(ran.text, failure, ran.text);
      assert.ok(ran.text.includes(said(world)), ran.text);
      assert.deepEqual(pullLines(ran.text), [], ran.text);
    }
  }
});

// proves R-SCHED-18
test('plan creates no admission directory where none existed, changes nothing under one that exists, and records no admission event', async () => {
  const world = admissionWorld(PULLING, { held: PULLING_HELD });
  await world.run();
  assert.equal(existsSync(admissionOf(world.state)), false);
  for (const prepare of [(state) => seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })), (state) => seed(state, 'stray.json', closerText())]) {
    const each = admissionWorld(PULLING, { held: PULLING_HELD });
    prepare(each.state);
    const before = picture(admissionOf(each.state));
    await each.run();
    assert.deepEqual(picture(admissionOf(each.state)), before);
    const events = existsSync(join(each.state, 'events.jsonl')) ? readEvents(each.state) : [];
    assert.deepEqual(events.filter(({ event }) => event.startsWith('admission.')), [], JSON.stringify(events));
  }
});
