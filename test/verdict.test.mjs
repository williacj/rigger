// ABOUTME: Tests the `verdict` verb run as its own process at a pseudo-terminal against the fake
// forge: the comment it posts once the owner confirms, the marker that comment holds, what it
// shows before it asks, and what each answer to its question does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acceptanceDigest, composeMarker, parseMarker } from '../src/workflow/marker.mjs';
import { gateAnswer } from '../src/workflow/gate.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { ASKED, BODY, CARD, HEAD, ITEMS, PULL, REPO, assertRefused, assertWrites, atTerminal, cardIssue, world } from './verdict-world.mjs';

/** Long enough for a run at a terminal under a loaded host; a hung run fails rather than hangs. */
const BOUND = { timeout: 120_000 };

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gate-check.mjs');

/** The comment the verb last posted on the pull request, as the fake holds it. */
const lastPosted = (where) => where.comments().at(-1);

// proves R-VERDICT-8, R-VERDICT-12
test('the owner running `rigger verdict <pr> sound` at a terminal and answering y leaves exactly one new comment on that pull request', BOUND, async () => {
  const where = world();
  const before = where.comments();

  const ran = await atTerminal(where, [String(PULL), 'sound']);

  assert.equal(ran.status, 0, ran.shown);
  assert.equal(where.comments().length, before.length + 1, ran.shown);
  assert.deepEqual(where.comments().slice(0, before.length), before);
  assertWrites(where, 1);
});

/**
 * Table E: what the owner gives after `<pr>`, and the marker posted, each field written out by
 * hand from the card's row rather than derived from the verb.
 */
const TABLE_E = [
  { given: ['sound'], verdict: 'sound', items: ['met', 'met', 'met', 'met'], coverage: 'covered' },
  { given: ['sound', '--insufficient', 'r'], verdict: 'sound', items: ['met', 'met', 'met', 'met'], coverage: 'insufficient', coverageReason: 'r' },
  { given: ['needs-revision', '--to-sound', 't'], verdict: 'needs revision', items: ['met', 'met', 'met', 'met'], coverage: 'covered', toSound: 't' },
  { given: ['needs-revision', '--to-sound', 't', '--unmet', '2,4'], verdict: 'needs revision', items: ['met', 'unmet', 'met', 'unmet'], coverage: 'covered', toSound: 't' },
  { given: ['critical', '--to-sound', 't'], verdict: 'critical', items: ['met', 'met', 'met', 'met'], coverage: 'covered', toSound: 't' },
  { given: ['critical', '--to-sound', 't', '--unmet', '1', '--insufficient', 'r'], verdict: 'critical', items: ['unmet', 'met', 'met', 'met'], coverage: 'insufficient', coverageReason: 'r', toSound: 't' },
];

for (const row of TABLE_E) {
  test(`table E: \`${row.given.join(' ')}\` posts an owner's marker with that row's verdict, item rulings, coverage, coverage reason and toSound line`, BOUND, async () => {
    const where = world();

    const ran = await atTerminal(where, [String(PULL), ...row.given]);

    assert.equal(ran.status, 0, ran.shown);
    const parsed = parseMarker(lastPosted(where).body, ITEMS.length);
    assert.equal(parsed.state, 'marker', parsed.reason);
    const { role, verdict, items, coverage, coverageReason, toSound } = parsed.marker;
    assert.deepEqual({ role, verdict, items, coverage, coverageReason, toSound }, { role: 'owner', verdict: row.verdict, items: row.items, coverage: row.coverage, coverageReason: row.coverageReason, toSound: row.toSound });
    assertWrites(where, 1);
  });
}

/** The fields of the block the gate check prints under `heading`, and the number of its item lines. */
function printedBlock(output, heading) {
  const lines = output.split('\n');
  const from = lines.indexOf(heading);
  assert.notEqual(from, -1, `the gate check printed no ${heading}:\n${output}`);
  const opened = lines.indexOf('```rigger-marker', from);
  const block = lines.slice(opened + 1, lines.indexOf('```', opened + 1));
  const field = (key) => block.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
  return { card: Number(field('card')), pull: Number(field('pull')), head: field('head'), digest: field('digest'), count: block.filter((line) => /^item \d+: /.test(line)).length };
}

// proves R-VERDICT-8
test('for a card whose kind names owner, the posted marker\'s card, pull, head, digest and item count equal the block `gate-check.mjs rule <pr>` prints for the owner', BOUND, async () => {
  const where = world({ issues: [cardIssue({ labels: ['type:spec'] })] });
  const gate = spawnSync(process.execPath, [SCRIPT, 'rule', String(PULL)], { encoding: 'utf8', env: { ...where.env, GITHUB_REPOSITORY: REPO } });
  const asked = printedBlock(gate.stdout, '## The marker owner must post');

  const ran = await atTerminal(where, [String(PULL), 'sound']);

  assert.equal(ran.status, 0, ran.shown);
  const { marker } = parseMarker(lastPosted(where).body, ITEMS.length);
  assert.deepEqual({ card: marker.card, pull: marker.pull, head: marker.head, digest: marker.digest, count: marker.items.length }, asked);
  // The block the gate printed is this card's, so the comparison is not of two empty answers.
  assert.deepEqual(asked, { card: CARD, pull: PULL, head: HEAD, digest: asked.digest, count: ITEMS.length });
});

// proves R-VERDICT-8
test('the posted marker block holds no provider, dispatch or evidence line', BOUND, async () => {
  const where = world();

  await atTerminal(where, [String(PULL), 'critical', '--to-sound', 't', '--unmet', '1', '--insufficient', 'r']);

  const { body } = lastPosted(where);
  assert.equal(parseMarker(body, ITEMS.length).state, 'marker');
  assert.deepEqual(body.split('\n').filter((line) => /^(?:provider|dispatch|evidence):/.test(line)), []);
});

// proves R-VERDICT-8
test('the posted comment\'s body is what composeMarker returns for the posted marker and its first line', BOUND, async () => {
  const where = world();

  await atTerminal(where, [String(PULL), 'needs-revision', '--to-sound', 't', '--unmet', '2,4', '--insufficient', 'r']);

  const { body } = lastPosted(where);
  const { marker } = parseMarker(body, ITEMS.length);
  assert.equal(body, composeMarker(marker, body.split('\n')[0]));
});

// proves R-VERDICT-8, R-VERDICT-13
test('for a card whose kind names no owner judge, the sound verdict posted is admitted by gateAnswer with the pull request\'s comments, its round and the judges [{ role: \'owner\' }]', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [String(PULL), 'sound']);

  assert.equal(ran.status, 0, ran.shown);
  // The comments are read as the gate reads them, through L0's read side, from the fake forge.
  const send = (command, args) => spawnSync(where.gh, args, { encoding: 'utf8', env: where.env });
  const comments = await repositoryReads({ repo: REPO, project: 'none' }, { send, emitter: { emit: () => {} } }).readComments(PULL);
  const answer = gateAnswer({ comments, card: CARD, pull: PULL, head: HEAD, digest: acceptanceDigest(BODY), count: ITEMS.length, judges: [{ role: 'owner' }], checks: {} });
  assert.equal(answer.admit, true, JSON.stringify(answer.refusals));
});

// proves R-VERDICT-8
test('the posted comment\'s first line names the pull request\'s number and the verdict', BOUND, async () => {
  const where = world();

  await atTerminal(where, [String(PULL), 'needs-revision', '--to-sound', 't']);

  const [first] = lastPosted(where).body.split('\n');
  assert.match(first, new RegExp(`#${PULL}\\b`));
  assert.match(first, /needs revision/);
});

/** What the verb prints before the question, from the start of its output up to the question. */
const beforeAsking = (ran) => ran.shown.slice(0, ran.shown.indexOf(ASKED));

// proves R-VERDICT-9
test('before it asks, the verb prints the comment it would post, byte for byte the comment body the fake forge then receives', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [String(PULL), 'critical', '--to-sound', 't', '--unmet', '1', '--insufficient', 'r']);

  assert.equal(ran.status, 0, ran.shown);
  const shown = beforeAsking(ran);
  const opening = `the comment it posts on pull request #${PULL} once you confirm it:\n\n`;
  const start = shown.indexOf(opening) + opening.length;
  // A blank line parts the comment from the items listed under it.
  const end = shown.indexOf('\nThe acceptance items of card', start);
  assert.ok(start >= opening.length && end > start, shown);
  assert.equal(shown.slice(start, end), lastPosted(where).body);
});

// proves R-VERDICT-9
test('before it asks, the verb prints each acceptance item\'s number, its text as the card\'s body holds it, and its ruling', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [String(PULL), 'needs-revision', '--to-sound', 't', '--unmet', '2,4']);

  const lines = beforeAsking(ran).split('\n');
  const rulings = ['met', 'unmet', 'met', 'unmet'];
  for (const [at, item] of ITEMS.entries()) {
    assert.ok(BODY.includes(`- ${item}\n`), `the card's body holds no item ${item}`);
    assert.ok(lines.includes(`  ${at + 1}. ${rulings[at]}: ${item}`), `item ${at + 1} is not printed with its ruling:\n${lines.join('\n')}`);
  }
});

/** Table D: each answer posted, as typed at the terminal. */
for (const answer of ['y', 'Y', 'yes', 'YES', 'Yes', 'yEs']) {
  test(`table D: the answer ${JSON.stringify(answer)} posts the verdict and exits 0`, BOUND, async () => {
    const where = world();

    const ran = await atTerminal(where, [String(PULL), 'sound'], { answer });

    assert.equal(ran.status, 0, ran.shown);
    assert.equal(where.comments().length, 1);
    assertWrites(where, 1);
  });
}

/** Table D: each answer that posts nothing, `null` for end of input before an answer. */
const DECLINED = [
  ['n', /"n", not y or yes/],
  ['no', /"no", not y or yes/],
  ['NO', /"NO", not y or yes/],
  ['', /"", not y or yes/],
  ['sure', /"sure", not y or yes/],
  ['yes please', /"yes please", not y or yes/],
  [null, /standard input ended before an answer/],
];
for (const [answer, reason] of DECLINED) {
  test(`table D: ${answer === null ? 'end of input before an answer' : `the answer ${JSON.stringify(answer)}`} posts nothing and exits non-zero`, BOUND, async () => {
    const where = world();
    const before = where.comments();

    const ran = await atTerminal(where, [String(PULL), 'sound'], { answer });

    assert.ok(ran.asked, ran.shown);
    assertRefused(where, ran, before, reason);
  });
}
