// ABOUTME: Tests L2's acceptance changes in `report`: each change and who made it, content deleted,
// growth after admission, changes during the maker's dispatch and each card's author, over streams
// the tests write in the shape ARCHITECTURE.md gives `acceptance.history` and the dispatch events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { report as derive } from '../src/observation/report.mjs';
import { report } from '../src/cli/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Second `n` of 2026-01-01 as an ISO time: every edit time and event `ts` below. */
const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

/**
 * One `acceptance.history` under `card`, with the fields "L2's acceptance, escalation and merge
 * events" gives it: `opened` as `at` and `by`, `revisions` oldest first, and `author` where given.
 */
const history = (card, revisions, { opened = at(0), by = 'owner', author, ts = at(500) } = {}) => ({
  ts, run: 'r-a', layer: 'L2', event: 'acceptance.history', card, opened: { at: opened, by }, revisions,
  ...(author === undefined ? {} : { author }),
});
/** A revision with content, at second `n`. */
const revision = (n, editor, digest, items) => ({ editedAt: at(n), editor, deleted: false, digest, items });
/** A revision a user deleted from the forge's history, at second `n`: it carries no `digest` or `items`. */
const deleted = (n, editor) => ({ editedAt: at(n), editor, deleted: true });

/** L3's `dispatch`: a role dispatch unless `fields` carries `step`; a maker dispatch where it carries `attempt`. */
const dispatch = (card, id, role, fields = {}) => ({ ts: at(1000), run: 'r-a', layer: 'L3', event: 'dispatch', card, dispatch: id, role, tier: 'standard', ...fields });
const start = (id, n) => ({ ts: at(n), run: 'r-a', layer: 'L1', event: 'dispatch.start', dispatch: id });
const end = (id, n) => ({ ts: at(n), run: 'r-a', layer: 'L1', event: 'dispatch.end', dispatch: id, exit: 0, ms: 1 });
const runStart = (n, run = 'r-b') => ({ ts: at(n), run, layer: 'L3', event: 'run.start', concurrency: 1 });
const pull = (card, n) => ({ ts: at(n), run: 'r-a', layer: 'L3', event: 'pull', card, kind: 'change', queueDepth: 0 });

/** Writes `events` in line order as a new state directory's stream, and answers the directory. */
function written(events) {
  const directory = join(temporaryDirectory('rigger-acceptance-'), '.rigger');
  mkdirSync(directory);
  writeFileSync(streamPath(directory), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  return directory;
}

/** `report`'s acceptance-change answer over `events`, which L2's answer across the stream must carry. */
function acceptance(events) {
  const { stream } = derive(written(events)).l2;
  assert.ok(Object.hasOwn(stream, 'acceptance'), `report derives no acceptance changes: ${JSON.stringify(Object.keys(stream))}`);
  return stream.acceptance;
}
/** The changes `report` derives over `events`, by card, edit time, editor, dispatches and whether the maker's. */
const changes = (events) => acceptance(events).changes;

// proves R-CARD-6
test('Table D row 1: two revisions whose digest differs are one change at the later edit time by its editor', () => {
  assert.deepEqual(changes([history(7, [revision(10, 'alice', 'd-1', 3), revision(20, 'bob', 'd-2', 3)])]),
    [{ card: 7, editedAt: at(20), editor: 'bob', dispatches: [], duringMaker: false }]);
});

// proves R-CARD-6
test('Table D row 2: one revision carried by two acceptance.history events is one change', () => {
  const revisions = [revision(10, 'alice', 'd-1', 3), revision(20, 'bob', 'd-2', 3)];
  assert.deepEqual(changes([history(7, revisions.slice(0, 1), { ts: at(15) }), history(7, revisions, { ts: at(25) }),
    history(7, [...revisions, revision(30, 'carol', 'd-2', 3)], { ts: at(35) })]),
  [{ card: 7, editedAt: at(20), editor: 'bob', dispatches: [], duringMaker: false }]);
  // Two saves within one second share an `editedAt` (W9, M8-U8 Q26 a): the key keeps the first event's revision.
  assert.deepEqual(changes([history(7, revisions, { ts: at(25) }), history(7, [revisions[0], revision(20, 'bob', 'd-3', 3)], { ts: at(35) })]),
    [{ card: 7, editedAt: at(20), editor: 'bob', dispatches: [], duringMaker: false }], 'one change per card and editedAt');
});

test('Table D row 3: two successive revisions with the same digest are no change', () => {
  assert.deepEqual(changes([history(7, [revision(10, 'alice', 'd-1', 3), revision(20, 'bob', 'd-1', 3)])]), []);
});

// proves R-CARD-6
test('Table D row 4: a deleted revision between two digests is content deleted, and the later revision a change', () => {
  const answer = acceptance([history(7, [revision(10, 'alice', 'd-1', 3), deleted(20, 'mallory'), revision(30, 'bob', 'd-2', 3)])]);
  assert.deepEqual(answer.deleted, [{ card: 7, editedAt: at(20), editor: 'mallory' }]);
  assert.deepEqual(answer.changes, [{ card: 7, editedAt: at(30), editor: 'bob', dispatches: [], duringMaker: false }]);
});

// proves R-CARD-6
test('Table D row 4b: a deleted revision with no digest before it, or none after it, is content deleted and no change', () => {
  const first = acceptance([history(7, [deleted(10, 'mallory'), revision(20, 'bob', 'd-2', 3)])]);
  assert.deepEqual(first.deleted, [{ card: 7, editedAt: at(10), editor: 'mallory' }]);
  assert.deepEqual(first.changes, []);
  const last = acceptance([history(8, [revision(10, 'alice', 'd-1', 3), deleted(20, 'mallory')])]);
  assert.deepEqual(last.deleted, [{ card: 8, editedAt: at(20), editor: 'mallory' }]);
  assert.deepEqual(last.changes, []);
});

/** A card #7 whose acceptance changed at second `n`, by `editor`. */
const changedAt = (n, editor = 'owner') => history(7, [revision(1, 'owner', 'd-1', 3), revision(n, editor, 'd-2', 3)]);

// proves R-CARD-5
test('Table D row 5: a change in one role dispatch window, either end included, is made by its editor and that dispatch', () => {
  for (const n of [100, 150, 200]) {
    assert.deepEqual(changes([dispatch(7, 'd-pm', 'pm'), start('d-pm', 100), changedAt(n), end('d-pm', 200)]),
      [{ card: 7, editedAt: at(n), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }], duringMaker: false }], `edit at ${n}`);
  }
});

// proves R-CARD-5
test('Table D row 5b: a role dispatch under another card is among who made a change in its window', () => {
  assert.deepEqual(changes([dispatch(99, 'd-pm', 'pm'), start('d-pm', 100), changedAt(150), end('d-pm', 200)]),
    [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }], duringMaker: false }]);
});

// proves R-CARD-5
test('Table D row 6: a change in no role dispatch window is made by its editor alone', () => {
  for (const n of [99, 201]) {
    assert.deepEqual(changes([dispatch(7, 'd-pm', 'pm'), start('d-pm', 100), end('d-pm', 200), changedAt(n)]),
      [{ card: 7, editedAt: at(n), editor: 'owner', dispatches: [], duringMaker: false }], `edit at ${n}`);
  }
});

// proves R-CARD-5
test('Table D row 7: a change in two overlapping role dispatch windows is made by its editor and both dispatches', () => {
  assert.deepEqual(changes([dispatch(7, 'd-pm', 'pm'), dispatch(8, 'd-rev', 'reviewer'), start('d-pm', 100), start('d-rev', 140),
    changedAt(150), end('d-pm', 200), end('d-rev', 300)]),
  [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }, { dispatch: 'd-rev', role: 'reviewer' }], duringMaker: false }]);
});

// proves R-CARD-5
test('Table D row 8: an L3 dispatch carrying step is not among who made a change in its window', () => {
  assert.deepEqual(changes([dispatch(7, 'd-step', 'reviewer', { step: 'install' }), start('d-step', 100), changedAt(150), end('d-step', 200)]),
    [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [], duringMaker: false }]);
});

/** A role dispatch started at second 100 with no `dispatch.end`, and the change at second `n`. */
const unended = (n, ...after) => [dispatch(7, 'd-pm', 'pm'), start('d-pm', 100), ...after, changedAt(n)];

// proves R-CARD-5
test('Table D row 9: a dispatch with no end is among who made a change before the next run.start', () => {
  assert.deepEqual(changes([...unended(150), runStart(200)]),
    [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }], duringMaker: false }]);
});

// proves R-CARD-5
test('Table D row 10: a dispatch with no end is not among who made a change after the next run.start', () => {
  assert.deepEqual(changes(unended(250, runStart(200))),
    [{ card: 7, editedAt: at(250), editor: 'owner', dispatches: [], duringMaker: false }]);
  assert.deepEqual(changes([runStart(50, 'r-a'), ...unended(250)]),
    [{ card: 7, editedAt: at(250), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }], duringMaker: false }],
    'only a run.start after the dispatch.start ends its window');
});

// proves R-CARD-5
test('Table D row 11: a dispatch with no end and no later run.start is among who made a change to the stream\'s end', () => {
  assert.deepEqual(changes(unended(9000)),
    [{ card: 7, editedAt: at(9000), editor: 'owner', dispatches: [{ dispatch: 'd-pm', role: 'pm' }], duringMaker: false }]);
});

/** The acceptance growth `report` derives over `events`. */
const grew = (events) => acceptance(events).grew;

// proves R-CARD-11
test('Table D row 12: a revision after the first pull holding more items than the one current at it grew the acceptance', () => {
  const answer = acceptance([pull(7, 50), history(7, [revision(10, 'owner', 'd-1', 3), revision(40, 'owner', 'd-2', 4), revision(60, 'owner', 'd-3', 5)]),
    pull(7, 70)]);
  assert.deepEqual(answer.grew, [{ card: 7, editedAt: at(60), items: 5, admitted: 4 }]);
  assert.deepEqual(answer.changes.map(({ editedAt }) => editedAt), [at(40), at(60)]);
  assert.deepEqual(grew([pull(7, 60), history(7, [revision(10, 'owner', 'd-1', 3), revision(60, 'owner', 'd-2', 5)])]), [],
    'a revision at the pull\'s ts is current at it');
});

// proves R-CARD-11
test('Table D row 12b: growth compares with the nearest revision carrying items at or before the pull, past a deleted one', () => {
  assert.deepEqual(grew([history(7, [revision(10, 'owner', 'd-1', 3), deleted(40, 'mallory'), revision(60, 'owner', 'd-2', 4)]), pull(7, 50)]),
    [{ card: 7, editedAt: at(60), items: 4, admitted: 3 }]);
});

// proves R-CARD-11
test('Table D row 13: a revision after the first pull with the same items and another digest is a change and no growth', () => {
  const answer = acceptance([pull(7, 50), history(7, [revision(10, 'owner', 'd-1', 3), revision(60, 'owner', 'd-2', 3)])]);
  assert.deepEqual(answer.changes.map(({ editedAt }) => editedAt), [at(60)]);
  assert.deepEqual(answer.grew, []);
});

// proves R-CARD-11
test('Table D row 14: a revision before the first pull holding more items is a change and no growth', () => {
  const answer = acceptance([history(7, [revision(10, 'owner', 'd-1', 3), revision(40, 'owner', 'd-2', 5)]), pull(7, 50)]);
  assert.deepEqual(answer.changes.map(({ editedAt }) => editedAt), [at(40)]);
  assert.deepEqual(answer.grew, []);
  assert.deepEqual(grew([history(7, [revision(10, 'owner', 'd-1', 3), revision(40, 'owner', 'd-2', 5)])]), [], 'a card never pulled never grew after admission');
});

// proves R-CARD-5
test('Table D row 15: a change in the window of the card\'s maker dispatch is flagged as made during it', () => {
  assert.deepEqual(changes([dispatch(7, 'd-make', 'engineer', { attempt: 1 }), start('d-make', 100), changedAt(150), end('d-make', 200)]),
    [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-make', role: 'engineer' }], duringMaker: true }]);
});

// proves R-CARD-5
test('Table D row 15b: a change in another card\'s maker dispatch window only is not flagged, and that dispatch made it', () => {
  assert.deepEqual(changes([dispatch(8, 'd-make', 'engineer', { attempt: 1 }), start('d-make', 100), changedAt(150), end('d-make', 200)]),
    [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-make', role: 'engineer' }], duringMaker: false }]);
});

// proves R-CARD-5
test('Table D row 16: a change in a judge dispatch window only is not flagged as made during the maker\'s dispatch', () => {
  assert.deepEqual(changes([dispatch(7, 'd-judge', 'reviewer'), start('d-judge', 100), changedAt(150), end('d-judge', 200),
    dispatch(7, 'd-make', 'engineer', { attempt: 1 }), start('d-make', 300), end('d-make', 400)]),
  [{ card: 7, editedAt: at(150), editor: 'owner', dispatches: [{ dispatch: 'd-judge', role: 'reviewer' }], duringMaker: false }]);
});

/** The authors `report` derives over `events`. */
const authors = (events) => acceptance(events).authors;

// proves R-CARD-5
test('Table D row 17: a clock-opened card whose acceptance.history carries author has that author', () => {
  assert.deepEqual(authors([dispatch(7, 'd-pm', 'pm'), start('d-pm', 0), history(7, [revision(1, 'owner', 'd-1', 3)], { author: 'architect' }), end('d-pm', 9)]),
    [{ card: 7, source: 'author', names: ['architect'] }]);
});

// proves R-CARD-5
test('Table D row 18: a card with no author opened in one role dispatch window has that dispatch\'s role as author', () => {
  assert.deepEqual(authors([dispatch(1, 'd-pm', 'pm'), start('d-pm', 0), history(7, [revision(5, 'owner', 'd-1', 3)], { opened: at(5) }), end('d-pm', 9)]),
    [{ card: 7, source: 'dispatches', names: ['pm'] }]);
});

// proves R-CARD-5
test('Table D row 18b: a card with no author opened in two role dispatch windows has both roles as author', () => {
  assert.deepEqual(authors([dispatch(1, 'd-pm', 'pm'), dispatch(2, 'd-arch', 'architect'), start('d-pm', 0), start('d-arch', 2),
    history(7, [revision(5, 'owner', 'd-1', 3)], { opened: at(5) }), end('d-pm', 9), end('d-arch', 9)]),
  [{ card: 7, source: 'dispatches', names: ['pm', 'architect'] }]);
});

// proves R-CARD-5
test('Table D row 19: a card with no author opened in no role dispatch window has the owner as author', () => {
  assert.deepEqual(authors([dispatch(1, 'd-pm', 'pm'), start('d-pm', 10), end('d-pm', 20), history(7, [revision(5, 'owner', 'd-1', 3)], { opened: at(5) })]),
    [{ card: 7, source: 'owner', names: [] }]);
});

/** A stream holding Table D rows 1, 7, 12 and 15, with deleted content and each author kind. */
const mixed = () => [
  pull(12, 50), dispatch(7, 'd-pm', 'pm'), dispatch(8, 'd-rev', 'reviewer'), dispatch(15, 'd-make', 'engineer', { attempt: 1 }),
  start('d-pm', 100), start('d-rev', 140), end('d-pm', 200), end('d-rev', 300), start('d-make', 400), end('d-make', 500),
  history(1, [revision(10, 'alice', 'd-1', 3), deleted(15, 'mallory'), revision(20, 'bob', 'd-2', 3)], { author: 'pm' }),
  history(7, [revision(1, 'owner', 'd-1', 3), revision(150, 'owner', 'd-2', 3)], { opened: at(150) }),
  history(12, [revision(10, 'owner', 'd-1', 3), revision(60, 'carol', 'd-2', 4)], { opened: at(10) }),
  history(15, [revision(1, 'owner', 'd-1', 3), revision(450, 'owner', 'd-2', 3)], { opened: at(1) }),
];

test('the derivation is the same whatever fields and events the section does not name', () => {
  const base = acceptance(mixed());
  assert.ok(base.changes.length === 4 && base.grew.length === 1 && base.deleted.length === 1, JSON.stringify(base));
  const noisy = mixed().flatMap((event, index) => [
    { ...event, run: `r-${index}`, kind: 'spike', exit: 9, ms: 7, tier: 'deep', facts: { pull: 1 }, digest: 'x', queueDepth: 4,
      ...(event.event === 'dispatch' ? { ts: at(1) } : {}), ...(event.event === 'pull' ? { dispatch: 'd-pm' } : {}),
      ...(event.event === 'dispatch.start' || event.event === 'dispatch.end' ? { card: 99, role: 'owner' } : {}) },
    { ts: at(120), run: 'r-x', layer: 'L3', event: 'slot.release', card: 7, dispatch: 'd-pm' },
    { ts: at(120), run: 'r-x', layer: 'L2', event: 'transition', card: 12, cause: 'merged' },
    { ts: at(120), run: 'r-x', layer: 'L0', event: 'call.end', system: 'forge', outcome: 'failed' },
  ]);
  assert.deepEqual(acceptance(noisy), base);
});

// proves R-CARD-5
test('the derivation spans the stream: a change in one run and the window holding it in another are derived together', () => {
  const across = [
    { ...dispatch(9, 'd-make', 'engineer', { attempt: 1 }), run: 'r-b' }, { ...start('d-make', 100), run: 'r-b' }, { ...end('d-make', 200), run: 'r-b' },
    { ...changedAt(150), run: 'r-a' }, { ...dispatch(7, 'd-own', 'engineer', { attempt: 2 }), run: 'r-c' },
    { ...start('d-own', 140), run: 'r-c' }, { ...end('d-own', 160), run: 'r-d' },
  ];
  assert.deepEqual(changes(across), [{ card: 7, editedAt: at(150), editor: 'owner',
    dispatches: [{ dispatch: 'd-make', role: 'engineer' }, { dispatch: 'd-own', role: 'engineer' }], duringMaker: true }]);
});

/** Runs the `report` verb in process over `events` written into a new consumer, and answers L2's text. */
async function printedL2(events) {
  const consumer = realpathSync.native(repositoryIn('rigger-report-acceptance-'));
  const directory = join(consumer, '.rigger');
  mkdirSync(directory);
  writeFileSync(streamPath(directory), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const ran = await report({ target: consumer, ask: (command, args) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['-C', consumer, 'rev-parse', '--show-toplevel']);
    return { status: 0, stdout: gitIn(consumer, 'rev-parse', '--show-toplevel') };
  } });
  assert.equal(ran.code, 0, ran.text);
  return ran.text.split('\nL2\n')[1].split('\nL3\n')[0];
}

/**
 * The lines of `l2` from the heading `heading` up to the next line indented as little as it, split
 * at every line terminator a reader's terminal or editor breaks at, the line and paragraph
 * separators among them.
 */
function block(l2, heading) {
  const lines = l2.split(/\r\n|[\n\r\u2028\u2029]/);
  const from = lines.indexOf(heading);
  assert.ok(from >= 0, `L2 prints ${JSON.stringify(heading)}:\n${l2}`);
  const indent = heading.length - heading.trimStart().length;
  const after = lines.slice(from + 1);
  const to = after.findIndex((line) => line.length - line.trimStart().length <= indent);
  return to < 0 ? after : after.slice(0, to);
}

// proves R-CARD-5, R-CARD-6
test('report prints each acceptance change with its card, edit time, editor and dispatches by id and role', async () => {
  const l2 = await printedL2(mixed());
  assert.deepEqual(block(l2, '    acceptance changes, each with who made it'), [
    `      card #1 at "${at(20)}": editor "bob"`,
    `      card #7 at "${at(150)}": editor "owner", dispatch "d-pm" (role "pm"), dispatch "d-rev" (role "reviewer")`,
    `      card #12 at "${at(60)}": editor "carol"`,
    `      card #15 at "${at(450)}": editor "owner", dispatch "d-make" (role "engineer")`,
  ]);
  assert.deepEqual(block(l2, '    content deleted from a card\'s history'), [`      card #1 at "${at(15)}": editor "mallory"`]);
  const injected = await printedL2([history(3, [revision(1, 'a', 'd-1', 1), revision(2, 'b\n    card #9 at x', 'd-2', 1)])]);
  assert.deepEqual(block(injected, '    acceptance changes, each with who made it'), [`      card #3 at "${at(2)}": editor "b\\n    card #9 at x"`]);
});

// proves R-CARD-11, R-CARD-5
test('report prints growth after admission and changes during the maker\'s dispatch, each naming its card', async () => {
  const l2 = await printedL2(mixed());
  assert.deepEqual(block(l2, '    acceptances that grew after admission'), [`      card #12 at "${at(60)}": 4 items, over 3 at its first pull`]);
  assert.deepEqual(block(l2, '    acceptance changes made during the card\'s maker dispatch'), [`      card #15 at "${at(450)}"`]);
  const none = await printedL2([history(3, [revision(1, 'a', 'd-1', 1)])]);
  assert.deepEqual(block(none, '    acceptances that grew after admission'), ['      none']);
  assert.deepEqual(block(none, '    acceptance changes made during the card\'s maker dispatch'), ['      none']);
  assert.deepEqual(block(none, '    acceptance changes, each with who made it'), ['      none']);
});

// proves R-CARD-5
test('report prints each card\'s author', async () => {
  const l2 = await printedL2(mixed());
  assert.deepEqual(block(l2, '    each card\'s author'), [
    '      card #1: "pm", as its acceptance.history records',
    '      card #7: roles "pm", "reviewer", whose dispatch windows hold its opening',
    '      card #12: the owner, since no role dispatch window holds its opening',
    '      card #15: the owner, since no role dispatch window holds its opening',
  ]);
});

/**
 * Stream text that would print a forged card line of its own if printed raw: a newline and a line
 * separator, each followed by a line reading as another card's. `SHOWN` is how `report` must print
 * it between its quotes: each break written as its escape, as JSON and `outsideText`
 * (`src/cli/doctor.mjs`) write them.
 */
const FORGED = 'x\n      card #999: forged\u2028      card #998: forged';
const SHOWN = 'x\\n      card #999: forged\\u2028      card #998: forged';
/** A time `Date.parse` reads as second 5, whose parenthesised comment starts a line of its own. */
const FORGED_TIME = 'Thu, 01 Jan 2026 00:00:05 GMT\n      (card #999: forged)';
const SHOWN_TIME = 'Thu, 01 Jan 2026 00:00:05 GMT\\n      (card #999: forged)';

const CHANGES = '    acceptance changes, each with who made it';
const DELETED = '    content deleted from a card\'s history';
const GREW = '    acceptances that grew after admission';
const MAKER = '    acceptance changes made during the card\'s maker dispatch';
const AUTHORS = '    each card\'s author';

test('a card id carrying line breaks prints as one acceptance change line', async () => {
  assert.deepEqual(block(await printedL2([history(FORGED, [revision(1, 'a', 'd-1', 3), revision(2, 'b', 'd-2', 3)])]), CHANGES),
    [`      card #"${SHOWN}" at "${at(2)}": editor "b"`]);
});

test('an edit time carrying line breaks prints as one acceptance change line', async () => {
  const forged = { ...revision(2, 'b', 'd-2', 3), editedAt: FORGED };
  assert.deepEqual(block(await printedL2([history(7, [revision(1, 'a', 'd-1', 3), forged])]), CHANGES),
    [`      card #7 at "${SHOWN}": editor "b"`]);
});

test('an editor carrying line breaks prints as one acceptance change line', async () => {
  assert.deepEqual(block(await printedL2([history(7, [revision(1, 'a', 'd-1', 3), revision(2, FORGED, 'd-2', 3)])]), CHANGES),
    [`      card #7 at "${at(2)}": editor "${SHOWN}"`]);
});

test('a dispatch id carrying line breaks prints as one acceptance change line', async () => {
  const l2 = await printedL2([dispatch(7, FORGED, 'pm'), start(FORGED, 0), history(7, [revision(1, 'a', 'd-1', 3), revision(2, 'b', 'd-2', 3)]), end(FORGED, 9)]);
  assert.deepEqual(block(l2, CHANGES), [`      card #7 at "${at(2)}": editor "b", dispatch "${SHOWN}" (role "pm")`]);
});

test('a role carrying line breaks prints as one acceptance change line', async () => {
  const l2 = await printedL2([dispatch(7, 'd-pm', FORGED), start('d-pm', 0), history(7, [revision(1, 'a', 'd-1', 3), revision(2, 'b', 'd-2', 3)]), end('d-pm', 9)]);
  assert.deepEqual(block(l2, CHANGES), [`      card #7 at "${at(2)}": editor "b", dispatch "d-pm" (role "${SHOWN}")`]);
});

test('a card id carrying line breaks prints as one content-deleted line', async () => {
  assert.deepEqual(block(await printedL2([history(FORGED, [deleted(2, 'm')])]), DELETED), [`      card #"${SHOWN}" at "${at(2)}": editor "m"`]);
});

test('an edit time carrying line breaks prints as one content-deleted line', async () => {
  assert.deepEqual(block(await printedL2([history(7, [{ ...deleted(2, 'm'), editedAt: FORGED }])]), DELETED), [`      card #7 at "${SHOWN}": editor "m"`]);
});

test('an editor carrying line breaks prints as one content-deleted line', async () => {
  assert.deepEqual(block(await printedL2([history(7, [deleted(2, FORGED)])]), DELETED), [`      card #7 at "${at(2)}": editor "${SHOWN}"`]);
});

test('a card id carrying line breaks prints as one growth line', async () => {
  const l2 = await printedL2([pull(FORGED, 50), history(FORGED, [revision(10, 'a', 'd-1', 3), revision(60, 'b', 'd-2', 4)])]);
  assert.deepEqual(block(l2, GREW), [`      card #"${SHOWN}" at "${at(60)}": 4 items, over 3 at its first pull`]);
});

test('an edit time carrying line breaks prints as one growth line', async () => {
  const l2 = await printedL2([pull(7, 50), history(7, [revision(10, 'a', 'd-1', 3), { ...revision(60, 'b', 'd-2', 4), editedAt: FORGED }])]);
  assert.deepEqual(block(l2, GREW), [`      card #7 at "${SHOWN}": 4 items, over 3 at its first pull`]);
});

test('an item count carrying a line break prints as one growth line', async () => {
  // Number('4\n') is 4, so the count still compares as four.
  const l2 = await printedL2([pull(7, 50), history(7, [revision(10, 'a', 'd-1', 3), revision(60, 'b', 'd-2', '4\n')])]);
  assert.deepEqual(block(l2, GREW), [`      card #7 at "${at(60)}": "4\\n" items, over 3 at its first pull`]);
});

test('an admitted item count carrying a line separator prints as one growth line', async () => {
  // Number('3\u2028') is 3, so the count still compares as three.
  const l2 = await printedL2([pull(7, 50), history(7, [revision(10, 'a', 'd-1', '3\u2028'), revision(60, 'b', 'd-2', 4)])]);
  assert.deepEqual(block(l2, GREW), [`      card #7 at "${at(60)}": 4 items, over "3\\u2028" at its first pull`]);
});

test('a card id carrying line breaks prints as one maker-dispatch line', async () => {
  const l2 = await printedL2([dispatch(FORGED, 'd-make', 'engineer', { attempt: 1 }), start('d-make', 0),
    history(FORGED, [revision(1, 'a', 'd-1', 3), revision(2, 'b', 'd-2', 3)]), end('d-make', 9)]);
  assert.deepEqual(block(l2, MAKER), [`      card #"${SHOWN}" at "${at(2)}"`]);
});

test('an edit time carrying line breaks prints as one maker-dispatch line', async () => {
  assert.equal(Date.parse(FORGED_TIME), Date.parse(at(5)), 'the forged time is second 5, in the maker\'s window');
  const l2 = await printedL2([dispatch(7, 'd-make', 'engineer', { attempt: 1 }), start('d-make', 0),
    history(7, [revision(1, 'a', 'd-1', 3), { ...revision(5, 'b', 'd-2', 3), editedAt: FORGED_TIME }]), end('d-make', 9)]);
  assert.deepEqual(block(l2, MAKER), [`      card #7 at "${SHOWN_TIME}"`]);
});

test('a card id carrying line breaks prints as one author line', async () => {
  assert.deepEqual(block(await printedL2([history(FORGED, [revision(1, 'a', 'd-1', 3)], { opened: at(1) })]), AUTHORS),
    [`      card #"${SHOWN}": the owner, since no role dispatch window holds its opening`]);
});

test('a recorded author carrying line breaks prints as one author line', async () => {
  assert.deepEqual(block(await printedL2([history(7, [revision(1, 'a', 'd-1', 3)], { author: FORGED })]), AUTHORS),
    [`      card #7: "${SHOWN}", as its acceptance.history records`]);
});

test('an authoring role carrying line breaks prints as one author line', async () => {
  const l2 = await printedL2([dispatch(1, 'd-pm', FORGED), dispatch(2, 'd-arch', 'architect'), start('d-pm', 0), start('d-arch', 0),
    history(7, [revision(1, 'a', 'd-1', 3)], { opened: at(1) }), end('d-pm', 9), end('d-arch', 9)]);
  assert.deepEqual(block(l2, AUTHORS), [`      card #7: roles "${SHOWN}", "architect", whose dispatch windows hold its opening`]);
});

/** An L3 `dispatch` recorded at second 599, before the window its L1 events open. */
const roleAt = (card, id, role) => ({ ...dispatch(card, id, role), ts: at(599) });

// The reviewer's round-2 probes on #1348, kept as they were posted.
test('one role cannot print as two candidate dispatches', async () => {
  const edit = history(77, [revision(600, 'owner', 'd-1', 3), revision(650, 'owner', 'd-2', 3)], { opened: at(550), ts: at(1000) });
  const single = [...mixed(), roleAt(77, 'd-one', 'pm), dispatch d-fake (reviewer'), start('d-one', 600), end('d-one', 700), edit];
  const pair = [...mixed(), roleAt(77, 'd-one', 'pm'), roleAt(77, 'd-fake', 'reviewer'), start('d-one', 600), start('d-fake', 600), end('d-one', 700), end('d-fake', 700), edit];
  assert.equal(changes(single).find(({ card }) => card === 77).dispatches.length, 1);
  assert.equal(changes(pair).find(({ card }) => card === 77).dispatches.length, 2);
  assert.notDeepEqual(block(await printedL2(single), CHANGES), block(await printedL2(pair), CHANGES),
    'one candidate dispatch and two candidate dispatches must remain distinguishable in the report');
});

test('one dispatch id cannot print as two candidate dispatches', async () => {
  const id = 'd-one (pm), dispatch d-fake';
  const edit = history(77, [revision(600, 'owner', 'd-1', 3), revision(650, 'owner', 'd-2', 3)], { opened: at(550), ts: at(1000) });
  const single = [...mixed(), roleAt(77, id, 'reviewer'), start(id, 600), end(id, 700), edit];
  const pair = [...mixed(), roleAt(77, 'd-one', 'pm'), roleAt(77, 'd-fake', 'reviewer'), start('d-one', 600), start('d-fake', 600), end('d-one', 700), end('d-fake', 700), edit];
  assert.deepEqual(changes(single).find(({ card }) => card === 77).dispatches, [{ dispatch: id, role: 'reviewer' }]);
  assert.equal(changes(pair).find(({ card }) => card === 77).dispatches.length, 2);
  assert.notDeepEqual(block(await printedL2(single), CHANGES), block(await printedL2(pair), CHANGES),
    'one candidate dispatch id and two candidate dispatch ids must remain distinguishable in the report');
});

test('one authoring role cannot print as two authors', async () => {
  const opened = history(77, [revision(650, 'owner', 'd-1', 3)], { opened: at(650), ts: at(1000) });
  const single = [...mixed(), roleAt(78, 'd-one', 'pm, reviewer'), start('d-one', 600), end('d-one', 700), opened];
  const pair = [...mixed(), roleAt(78, 'd-one', 'pm'), roleAt(79, 'd-two', 'reviewer'), start('d-one', 600), start('d-two', 600), end('d-one', 700), end('d-two', 700), opened];
  assert.deepEqual(authors(single).find(({ card }) => card === 77).names, ['pm, reviewer']);
  assert.deepEqual(authors(pair).find(({ card }) => card === 77).names, ['pm', 'reviewer']);
  assert.notDeepEqual(block(await printedL2(single), AUTHORS), block(await printedL2(pair), AUTHORS),
    'one authoring role and two authoring roles must remain distinguishable in the report');
});

/**
 * What the acceptance blocks' lists print between, before or after a value, or can escape one with:
 * punctuation, quotes, the escape character and line breaks. Each list's own cases add the run of
 * text that sits between two of its entries, both as these blocks print it and as it would print
 * if the field were left raw or quoted without escaping its quotes.
 */
const BOUNDARIES = [',', ', ', '/', '(', ')', '"', '\\', '\n', '\u2028'];

/**
 * Asserts that, for each of `boundaries`, a stream whose one value is `a`, the boundary and `b`
 * prints `heading`'s block otherwise than a stream holding the two values `a` and `b`, after the
 * derivation's own premise: `count` reads one value from the first and two from the second.
 */
async function oneNeverPrintsAsTwo({ boundaries, single, pair, count, heading }) {
  for (const boundary of boundaries) {
    const [one, two] = [single(boundary), pair];
    assert.deepEqual([count(one), count(two)], [1, 2], `the derivation reads one value and two (${JSON.stringify(boundary)})`);
    assert.notDeepEqual(block(await printedL2(one), heading), block(await printedL2(two), heading),
      `one value holding ${JSON.stringify(boundary)} prints as two values`);
  }
}

/** The number of candidate dispatches `report` derives for card #7's change at second 150. */
const candidates = (events) => changes(events).find(({ editedAt }) => editedAt === at(150)).dispatches.length;

test('a dispatch id holding any list boundary never prints as two candidate dispatches', async () => {
  const window = (id, role) => [dispatch(7, id, role), start(id, 100), end(id, 200)];
  await oneNeverPrintsAsTwo({
    boundaries: [...BOUNDARIES, ' (pm), dispatch ', ' (role "pm"), dispatch ', '" (role "pm"), dispatch "'],
    single: (boundary) => [...window(`d-one${boundary}d-two`, 'pm'), changedAt(150)],
    pair: [...window('d-one', 'pm'), ...window('d-two', 'pm'), changedAt(150)],
    count: candidates, heading: CHANGES,
  });
});

test('a role holding any list boundary never prints as two candidate dispatches', async () => {
  const window = (id, role) => [dispatch(7, id, role), start(id, 100), end(id, 200)];
  await oneNeverPrintsAsTwo({
    boundaries: [...BOUNDARIES, '), dispatch d-two (', '), dispatch "d-two" (role ', '"), dispatch "d-two" (role "'],
    single: (boundary) => [...window('d-one', `pm${boundary}reviewer`), changedAt(150)],
    pair: [...window('d-one', 'pm'), ...window('d-two', 'reviewer'), changedAt(150)],
    count: candidates, heading: CHANGES,
  });
});

test('an authoring role holding any list boundary never prints as two authors', async () => {
  const window = (card, id, role) => [dispatch(card, id, role), start(id, 0), end(id, 9)];
  const opened = history(7, [revision(5, 'owner', 'd-1', 3)], { opened: at(5) });
  await oneNeverPrintsAsTwo({
    boundaries: [...BOUNDARIES, ', ', '", "'],
    single: (boundary) => [...window(1, 'd-one', `pm${boundary}reviewer`), opened],
    pair: [...window(1, 'd-one', 'pm'), ...window(2, 'd-two', 'reviewer'), opened],
    count: (events) => authors(events).find(({ card }) => card === 7).names.length, heading: AUTHORS,
  });
});
