// ABOUTME: Tests what the forge holds when `rigger verdict` runs: each in-scope row of the card's
// table C, the verb run as its own process at a pseudo-terminal against the fake forge.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMarker } from '../src/workflow/marker.mjs';
import { BODY, CARD, HEAD, ITEMS, PULL, assertRefused, assertWrites, atTerminal, cardIssue, configWith, moduleOf, pullFrom, world } from './verdict-world.mjs';

/** Long enough for a run at a terminal under a loaded host; a hung run fails rather than hangs. */
const BOUND = { timeout: 120_000 };

const pr = String(PULL);

/** Each row that posts nothing before the verb asks: the world, the arguments, and what it names. */
const UNASKED = [
  ['no consumer config in the directory the verb runs in', { consumer: null }, [pr, 'sound'], /`rigger\.config\.mjs` is not in /],
  ['a consumer config there that Rigger refuses', { consumer: moduleOf({ ...configWith(), concurrency: 'many' }) }, [pr, 'sound'], /`rigger\.config\.mjs` in .* is refused: `concurrency` must be a positive whole number/],
  ['that config naming a repository other than the one the default branch\'s config names', { repo: 'someone/else', consumer: moduleOf({ ...configWith(), repo: 'someone/else' }) }, [pr, 'sound'], /names someone\/else.*names the repository williacj\/rigger/],
  ['no pull request at the number', {}, [String(PULL + 1), 'sound'], /pull request #13/],
  ['the pull request closed', { pullRequests: [pullFrom({ closed: true })] }, [pr, 'sound'], /pull request #12 is closed, not open/],
  ['the pull request merged', { pullRequests: [pullFrom({ merged: true })] }, [pr, 'sound'], /pull request #12 is merged, not open/],
  ['the pull request\'s head in another repository', { pullRequests: [pullFrom({ from: 'forker/rigger' })] }, [pr, 'sound'], /pull request #12's head is in forker\/rigger/],
  ['the branch naming no card under the default branch\'s topic rule', { pullRequests: [pullFrom({ head: 'feature-seven' })] }, [pr, 'sound'], /branch feature-seven names no card under the default branch's topic rule `rigger-\{number\}`/],
  ['the branch naming a number that is no issue', { issues: [] }, [pr, 'sound'], new RegExp(`names #${CARD}, which is no issue`)],
  ['the card\'s acceptance holding no item the form check counts', { issues: [cardIssue({ body: 'Why, and no acceptance.\n' })] }, [pr, 'sound'], /acceptance fails the form check: missing acceptance/],
  ['the default branch\'s config absent', { main: null, consumer: moduleOf(configWith()) }, [pr, 'sound'], /`rigger\.config\.mjs` is absent from the default branch/],
  ['the default branch\'s config unreadable', { main: 'export default {\n', consumer: moduleOf(configWith()) }, [pr, 'sound'], /could not be read.*on the default branch/],
  ['the default branch\'s config refused', { main: moduleOf({ ...configWith(), concurrency: 'many' }), consumer: moduleOf(configWith()) }, [pr, 'sound'], /on the default branch, main at [0-9a-f]{40}, is refused: `concurrency`/],
];

for (const [name, seed, args, reason] of UNASKED) {
  test(`table C: ${name} posts nothing and names it`, BOUND, async () => {
    const where = world(seed);
    const before = where.comments();

    const ran = await atTerminal(where, args);

    assert.equal(ran.asked, false, ran.shown);
    assertRefused(where, ran, before, reason);
  });
}

/**
 * Each read of the forge the verb makes, the words of the command that sends it, which of the
 * commands holding those words it is, whether it comes after the owner's answer, and what the
 * refusal names.
 */
const READS = [
  ['the default branch', 'defaultBranchRef', 1, false, /the read of the default branch's `rigger\.config\.mjs` failed/],
  ['the default branch\'s config at its head', 'object(oid:', 1, false, /the read of the default branch's `rigger\.config\.mjs` failed/],
  ['the pull request', 'pullRequest(number:', 1, false, /the read of pull request #12 failed/],
  ['the card\'s issue', 'issue(number:', 1, false, /the read of issue #7 failed/],
  ['the pull request, again after the answer', 'pullRequest(number:', 2, true, /the read of pull request #12 failed/],
  ['the card\'s issue, again after the answer', 'issue(number:', 2, true, /the read of issue #7 failed/],
];

for (const [name, words, nth, answered, reason] of READS) {
  test(`table C: the read of ${name} failing posts nothing and names the read`, BOUND, async () => {
    const where = world();
    where.failing(words, nth);
    const before = where.comments();

    const ran = await atTerminal(where, [pr, 'sound']);

    assert.equal(ran.asked, answered, ran.shown);
    assertRefused(where, ran, before, reason);
    assert.match(ran.shown, /the read failed, as the test asked/);
  });
}

// proves R-VERDICT-12, R-VERDICT-13
test('table C: the read confirming the pull request before the comment failing says the post failed, and creates no comment', BOUND, async () => {
  const where = world();
  where.failing(`repos/williacj/rigger/pulls/${PULL} -X GET`);
  const before = where.comments();

  const ran = await atTerminal(where, [pr, 'sound']);

  assert.notEqual(ran.status, 0, ran.shown);
  assert.match(ran.shown, /the post failed, and it is not tried again: .*did not confirm/);
  assert.deepEqual(where.comments(), before);
  assertWrites(where, 0);
});

// proves R-VERDICT-13
test('table C: the head moving between the verb showing the verdict and the owner\'s answer posts nothing and names both heads', BOUND, async () => {
  const where = world();
  const before = where.comments();
  const moved = 'd'.repeat(40);

  const ran = await atTerminal(where, [pr, 'sound'], { atPrompt: () => where.change((held) => { held.pullRequests[0].sha = moved; }) });

  assert.ok(ran.asked, ran.shown);
  assertRefused(where, ran, before, new RegExp(`head moved from ${HEAD} to ${moved}`));
});

/** The pull request closing or merging while the owner is asked, each as the fake holds it. */
const ENDED = [
  ['closed', (held) => { held.pullRequests[0].closed = true; }],
  ['merged', (held) => { held.pullRequests[0].merged = true; }],
];

for (const [state, end] of ENDED) {
  test(`table C: the pull request ${state} between the verb showing the verdict and the owner's answer posts nothing and names the state`, BOUND, async () => {
    const where = world();
    const before = where.comments();

    const ran = await atTerminal(where, [pr, 'sound'], { atPrompt: () => where.change(end) });

    assert.ok(ran.asked, ran.shown);
    assertRefused(where, ran, before, new RegExp(`pull request #${PULL} is ${state}, not open, after the verdict was shown`));
  });
}

// proves R-VERDICT-13
test('table C: a pull request closed while the owner is asked is refused before any comment is written', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [pr, 'needs-revision', '--to-sound', 't'], { atPrompt: () => where.change((held) => { held.pullRequests[0].closed = true; }) });

  assert.notEqual(ran.status, 0, ran.shown);
  assert.equal(where.comments().length, 0);
  assertWrites(where, 0);
});

// proves R-VERDICT-13
test('table C: the acceptance changing between the verb showing the verdict and the owner\'s answer posts nothing and says so', BOUND, async () => {
  const where = world();
  const before = where.comments();

  const ran = await atTerminal(where, [pr, 'sound'], { atPrompt: () => where.change((held) => { held.issues[0].body = `${BODY}- A fifth item the owner never saw ruled.\n`; }) });

  assert.ok(ran.asked, ran.shown);
  assertRefused(where, ran, before, /card #7's acceptance changed after the verdict was shown/);
});

// proves R-VERDICT-12, R-VERDICT-13
test('table C: the comment\'s post refused says the post failed, exits non-zero, and the forge\'s log holds one request creating a comment', BOUND, async () => {
  const where = world({ commentReplies: { [PULL]: { status: '403', message: 'Resource not accessible by integration' } } });
  const before = where.comments();

  const ran = await atTerminal(where, [pr, 'sound']);

  assert.notEqual(ran.status, 0, ran.shown);
  assert.match(ran.shown, /the post failed, and it is not tried again: .*Resource not accessible by integration/);
  assert.deepEqual(where.comments(), before);
  assertWrites(where, 1);
});

// proves R-VERDICT-8
test('table C: the comment\'s post succeeding prints the comment\'s URL and exits 0', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [pr, 'sound']);

  assert.equal(ran.status, 0, ran.shown);
  assert.match(ran.shown, new RegExp(`https://github\\.com/williacj/rigger/pull/${PULL}#issuecomment-1\\b`));
});

/** The cards no owner judges, or no kind selects, each by the labels it carries. */
const ANY_CARD = [
  ['the card\'s kind naming no owner judge', ['type:change']],
  ['a card no kind selects', []],
  ['a card carrying the epic label', ['type:epic', 'type:change']],
];

for (const [name, labels] of ANY_CARD) {
  test(`table C: ${name} is posted, as on any other card`, BOUND, async () => {
    const where = world({ issues: [cardIssue({ labels })] });

    const ran = await atTerminal(where, [pr, 'sound']);

    assert.equal(ran.status, 0, ran.shown);
    assert.equal(parseMarker(where.comments().at(-1).body, ITEMS.length).marker.role, 'owner');
    assertWrites(where, 1);
  });
}

// proves R-VERDICT-12, R-VERDICT-13
test('table C: an owner\'s verdict already on the pull request at the same head and acceptance has a new comment posted beside it, and its body unchanged', BOUND, async () => {
  const where = world();
  await atTerminal(where, [pr, 'sound']);
  const [earlier] = where.comments();

  const ran = await atTerminal(where, [pr, 'needs-revision', '--to-sound', 'the second look found item 2 unmet', '--unmet', '2']);

  assert.equal(ran.status, 0, ran.shown);
  const comments = where.comments();
  assert.equal(comments.length, 2);
  assert.deepEqual(comments[0], earlier);
  assert.equal(parseMarker(comments[1].body, ITEMS.length).marker.verdict, 'needs revision');
  assertWrites(where, 2);
  // Both rulings are on one round, so the second is no verdict on another head or acceptance.
  const round = ({ head, digest }) => ({ head, digest });
  assert.deepEqual(round(parseMarker(comments[1].body, ITEMS.length).marker), round(parseMarker(earlier.body, ITEMS.length).marker));
});
