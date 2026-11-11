// ABOUTME: Tests the added-timer mode of the host-declarations check over supplied runner events,
// lister answers, records and event facts, with no process started and no repository read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import lister, { addedTimers, checkAddedTimers, listing, parseRecord, readRecord } from '../.github/scripts/check-host-declarations.mjs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// Events below are the shapes node:test v26.13.0 reports, read off runs of `node --test` with a
// reporter printing each event's type and data: a top-level test is a test:pass or test:fail at
// nesting 0, whatever file it reports (a helper's, or the mock's own). A file that loads and
// registers a test reports its own summary, with its file; a file that throws while loading, or
// registers no test, reports none, and is reported instead as one test named by its path. The
// last summary has no file and holds the run's duration.
async function* events(list) { yield* list; }
async function reported(list) {
  const lines = [];
  for await (const chunk of lister(events(list))) lines.push(chunk);
  return lines.join('');
}

test('the lister reports each top-level test by title from whatever file names it, the file\'s own summary, and the run\'s duration', async () => {
  const file = '/repository/test/converting.test.mjs';
  const output = await reported([
    { type: 'test:dequeue', data: { nesting: 0, name: 'test/converting.test.mjs', file } },
    { type: 'test:pass', data: { nesting: 0, name: 'via helper', file: '/repository/test/helper.mjs', details: { duration_ms: 1 } } },
    { type: 'test:pass', data: { nesting: 1, name: 'nested', file, details: { duration_ms: 1 } } },
    { type: 'test:pass', data: { nesting: 0, name: 'outer', file, details: { duration_ms: 2 } } },
    { type: 'test:fail', data: { nesting: 0, name: 'via mock', file: 'node:internal/test_runner/mock/mock', details: { duration_ms: 1 } } },
    { type: 'test:pass', data: { nesting: 0, name: 'outer', file, skip: true, details: { duration_ms: 0 } } },
    { type: 'test:summary', data: { file, duration_ms: 5, counts: {} } },
    { type: 'test:summary', data: { duration_ms: 93.5, counts: {} } },
  ]);
  assert.equal(output, [
    { title: 'via helper' }, { title: 'outer' }, { title: 'via mock' }, { title: 'outer' }, { loaded: true }, { duration_ms: 93.5 },
  ].map((line) => JSON.stringify(line) + '\n').join(''));
});

const lines = (...entries) => entries.map((entry) => JSON.stringify(entry) + '\n').join('');

test('a listing counts each title the lister reported, so a title registered twice counts twice', () => {
  assert.deepEqual(listing(lines({ title: 'a' }, { title: 'b' }, { title: 'a' }, { loaded: true }, { duration_ms: 12.5 })),
    { counts: new Map([['a', 2], ['b', 1]]), duration_ms: 12.5 });
});

test('a listing with no summary of the file\'s own run is a file that fails to load or registers no test', () => {
  // node:test reports such a file as one top-level test named by its path, and no file summary.
  assert.deepEqual(listing(lines({ title: 'test/converting.test.mjs' }, { duration_ms: 80 })),
    { error: 'fails to load the file or registers no test' });
  assert.deepEqual(listing(lines({ duration_ms: 80 })), { error: 'fails to load the file or registers no test' });
});

test('a listing with no summary line is a run that ended before the runner finished', () => {
  assert.deepEqual(listing(lines({ title: 'a' }, { loaded: true })), { error: 'ended before the runner reported its summary' });
});

// The rows of #1138's "The added-timer cells". Each file is its source at a commit, which marks
// whether the change modifies it, and what a lister run of it reports there: the titles of the
// top-level tests it registers, or the reason it gives none. The record is the lines #1137's guard
// writes: a ran line with a null `api`, and an arm line naming the file, the top-level test's
// title, the API and the delay.
const BASE = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);
const BASE_DIR = '/base-worktree';
const HEAD_DIR = '/head-checkout';
const CONVERTING = 'test/converting.test.mjs';
const OTHER = 'test/other-converting.test.mjs';
const BOUNDED = 'test/bounded.test.mjs';
const ran = (file) => ({ file, test: null, api: null, delay: null });
const arm = (file, title, api = 'setTimeout', delay = 5) => ({ file, test: title, api, delay });
const at = (source, run, duration = 1) => ({ source, run, duration });
const BOUND = 1000;

function tally(titles) {
  const result = new Map();
  for (const title of titles) result.set(title, (result.get(title) ?? 0) + 1);
  return result;
}

/** History and lister facts for a base and a head, recording each worktree and lister call. */
function runFacts({ base = {}, head = {}, converting = [CONVERTING, OTHER] }) {
  const trees = { [BASE]: { [OTHER]: at('other', ['other older']), ...base }, [HEAD]: { [OTHER]: at('other', ['other older']), ...head } };
  const runs = { [BASE_DIR]: trees[BASE], [HEAD_DIR]: trees[HEAD] };
  const calls = [];
  const facts = {
    root: HEAD_DIR,
    readLists: (sha) => { assert.equal(sha, HEAD); return { converting, awaiting: [] }; },
    show: (sha, path) => { assert.ok(trees[sha], `no tree ${sha}`); return trees[sha][path]?.source ?? null; },
    atBase: (sha, use) => {
      calls.push(['worktree', sha]);
      try { return use(BASE_DIR); } finally { calls.push(['removed', sha]); }
    },
    // A run given a bound, as gitFacts' lister is, stops at it: a run longer than the bound gives
    // the lister's bound error, and a run given none runs to its end.
    bound: BOUND,
    list: (dir, file, bound) => {
      calls.push(['list', dir, file]);
      const { run, duration } = runs[dir][file];
      if (bound !== undefined && duration > bound) return { error: `ran past its bound of ${bound} ms` };
      return Array.isArray(run) ? { counts: tally(run), duration_ms: duration } : run;
    },
  };
  return { facts, calls };
}

function recordOf({ ran: files = [], arms = [] }) {
  return parseRecord([...files.map(ran), ...arms].map((line) => JSON.stringify(line)).join('\n'));
}

function rowOutcome({ record = {}, ...trees }) {
  const { facts } = runFacts(trees);
  return addedTimers({ base: BASE, head: HEAD, facts, record: recordOf(record) });
}

test('T1: a test added to a conversion-list file whose title the record arms under is refused naming both', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) },
    head: { [CONVERTING]: at('v2', ['older', 'added']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'added', 'node:timers.setInterval', 7)] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "added" armed node:timers.setInterval with delay 7`] });
});

test('T2: no added test passes although an older test arms a timer', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'older')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T3: a renamed older test is added under its new title and refused naming it', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['old name']) }, head: { [CONVERTING]: at('v2', ['new name']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'new name')] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "new name" armed setTimeout with delay 5`] });
});

test('T4: a timer-arming test moved from a bounded file into a conversion-list file is refused', () => {
  const result = rowOutcome({
    base: { [BOUNDED]: at('b1', ['moved']), [CONVERTING]: at('v1', ['older']) },
    head: { [BOUNDED]: at('b2', []), [CONVERTING]: at('v2', ['older', 'moved']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'moved')] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "moved" armed setTimeout with delay 5`] });
});

test('T5: a second test sharing an older title is added, and an arm under that title from either is refused', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['shared']) }, head: { [CONVERTING]: at('v2', ['shared', 'shared']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'shared')] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "shared" armed setTimeout with delay 5`] });
});

test('T7: a test added to a conversion-list file the record does not show ran is refused naming the file', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older', 'added']) },
    record: { ran: [OTHER] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: tests were added and the timer record shows no run of the file`] });
});

test('T8: no added test and no record directory passes, with no base worktree made', () => {
  const { facts, calls } = runFacts({ base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v1', ['older']) } });
  const record = readRecord(join(temporaryDirectory('rigger-1138-record-'), 'absent'));
  assert.deepEqual(addedTimers({ base: BASE, head: HEAD, facts, record }), { ok: true, errors: [] });
  assert.deepEqual(calls, []);
});

test('T9: an added test whose file ran and which armed nothing passes', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older', 'added']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'older')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T11: an added test passes beside an arm line from its file whose test is null', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older', 'added']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, null)] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T10: an added test passes when the arm under its title comes from another conversion-list file whose older test shares it', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']), [OTHER]: at('o1', ['shared']) },
    head: { [CONVERTING]: at('v2', ['older', 'shared']), [OTHER]: at('o2', ['shared']) },
    record: { ran: [CONVERTING, OTHER], arms: [arm(OTHER, 'shared')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T15: a changed conversion-list file whose base run fails to load or registers no test is refused naming the file', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', { error: 'fails to load the file or registers no test' }) },
    head: { [CONVERTING]: at('v2', ['older']) },
    record: { ran: [CONVERTING] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: the base run fails to load the file or registers no test`] });
});

test('T16: a title that differs between runs counts as added under each run\'s value, so only an arm under it is refused', () => {
  // The job's run registered 'run 1' and armed under it; the step's head run registered 'run 2'.
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older', 'run 2']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'run 1')] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "run 1" armed setTimeout with delay 5`] });
  const unarmed = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) }, head: { [CONVERTING]: at('v2', ['older', 'run 2']) },
    record: { ran: [CONVERTING] },
  });
  assert.deepEqual(unarmed, { ok: true, errors: [] });
});

test('T18: a base run past its bound is refused naming the file and the bound', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older'], BOUND + 1) },
    head: { [CONVERTING]: at('v2', ['older']) },
    record: { ran: [CONVERTING] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: the base run ran past its bound of 1000 ms`] });
});

test('T9: an added timer-free test whose file ran passes though its head run takes longer than the base-run bound', () => {
  // T18 bounds the base run only: a head run as slow as the job's own run of the file is no refusal.
  const result = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) },
    head: { [CONVERTING]: at('v2', ['older', 'added'], BOUND * 600) },
    record: { ran: [CONVERTING] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('base titles come from a run of each changed conversion-list file in one worktree at the base, and head titles from the head', () => {
  const { facts, calls } = runFacts({
    base: { [CONVERTING]: at('v1', ['older']), [OTHER]: at('o1', ['other older']) },
    head: { [CONVERTING]: at('v2', ['older']), [OTHER]: at('o2', ['other older']) },
  });
  assert.deepEqual(addedTimers({ base: BASE, head: HEAD, facts, record: recordOf({}) }), { ok: true, errors: [] });
  assert.deepEqual(calls, [
    ['list', HEAD_DIR, CONVERTING], ['list', HEAD_DIR, OTHER],
    ['worktree', BASE], ['list', BASE_DIR, CONVERTING], ['list', BASE_DIR, OTHER], ['removed', BASE],
  ]);
});

test('a conversion-list file new at the head has no base run, so each test it registers is added', () => {
  const { facts, calls } = runFacts({ head: { [CONVERTING]: at('v1', ['added']) } });
  const result = addedTimers({ base: BASE, head: HEAD, facts, record: recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'added')] }) });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "added" armed setTimeout with delay 5`] });
  assert.deepEqual(calls, [['list', HEAD_DIR, CONVERTING], ['worktree', BASE], ['removed', BASE]]);
});

test('a head run that gives no titles is refused naming the file, and a listed file absent at the head is refused', () => {
  const failed = rowOutcome({
    base: { [CONVERTING]: at('v1', ['older']) },
    head: { [CONVERTING]: at('v2', { error: 'fails to load the file or registers no test' }) },
  });
  assert.deepEqual(failed, { ok: false, errors: [`${CONVERTING}: the head run fails to load the file or registers no test`] });
  const { facts } = runFacts({ base: { [CONVERTING]: at('v1', ['older']) } });
  assert.deepEqual(addedTimers({ base: BASE, head: HEAD, facts, record: recordOf({}) }),
    { ok: false, errors: [`${CONVERTING}: on the conversion list at ${HEAD} and not in that tree`] });
});

test('T12: tests main gained above a lagging event base are the base\'s, not added, and only the pull request\'s own count', () => {
  // The event's base predates main's newer tests. The merge head's first parent is main's tip,
  // which holds them, so the pull request is compared with that tip and only its own test is added.
  const MAIN = '9'.repeat(40);
  const { facts, calls } = runFacts({
    base: { [CONVERTING]: at('main', ['main arms', 'main clean']) },
    head: { [CONVERTING]: at('pull request', ['main arms', 'main clean', 'pull request arms']) },
  });
  const show = facts.show;
  Object.assign(facts, {
    show: (sha, path) => show(sha === MAIN ? BASE : sha, path),
    present: () => true,
    firstParent: (sha) => { assert.equal(sha, HEAD); return MAIN; },
    mergeBase: (head, base) => { assert.deepEqual([head, base], [HEAD, MAIN]); return MAIN; },
  });
  const context = { eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: HEAD, event: { pull_request: { base: { sha: BASE } } } };
  const record = recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'main arms'), arm(CONVERTING, 'pull request arms')] });
  assert.deepEqual(checkAddedTimers(context, facts, record),
    { ok: false, errors: [`${CONVERTING}: added test "pull request arms" armed setTimeout with delay 5`] });
  assert.deepEqual(calls.filter(([kind]) => kind === 'worktree'), [['worktree', MAIN]]);
});

test('T13: a push to main whose landing added a timer-arming conversion-list test is refused against before', () => {
  const { facts, calls } = runFacts({
    base: { [CONVERTING]: at('before', ['older']) },
    head: { [CONVERTING]: at('landed', ['older', 'landed']) },
  });
  Object.assign(facts, {
    present: () => true,
    firstParent: () => assert.fail('a push with a before reads no first parent'),
    mergeBase: (head, base) => { assert.deepEqual([head, base], [HEAD, BASE]); return BASE; },
  });
  const context = { eventName: 'push', ref: 'refs/heads/main', sha: HEAD, event: { before: BASE, repository: { default_branch: 'main' } } };
  const record = recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'older'), arm(CONVERTING, 'landed')] });
  assert.deepEqual(checkAddedTimers(context, facts, record),
    { ok: false, errors: [`${CONVERTING}: added test "landed" armed setTimeout with delay 5`] });
  assert.deepEqual(calls.filter(([kind]) => kind === 'worktree'), [['worktree', BASE]]);
});

// GitHub event fields below are literal examples of #823's event table, as test/test-list-growth.test.mjs uses them.
const BEFORE = 'c'.repeat(40);
const PARENT = 'd'.repeat(40);
const ANCESTOR = 'e'.repeat(40);
const MERGED = 'f'.repeat(40);
const EVENTS = [
  ['default-branch push', 'push', 'refs/heads/main', { before: BEFORE }, BEFORE],
  ['default-branch zero-before push', 'push', 'refs/heads/main', { before: '0'.repeat(40) }, PARENT],
  ['other-branch push', 'push', 'refs/heads/topic', { before: BEFORE }, BEFORE],
  ['other-branch zero-before push', 'push', 'refs/heads/topic', { before: '0'.repeat(40) }, ANCESTOR],
  ['pull request', 'pull_request', 'refs/pull/7/merge', { pull_request: { base: { sha: BEFORE } } }, PARENT],
  ['merge group', 'merge_group', 'refs/heads/gh-readonly-queue/main/batch', { merge_group: { base_sha: BEFORE } }, BEFORE],
  ['main schedule', 'schedule', 'refs/heads/main', {}, PARENT],
  ['main workflow dispatch', 'workflow_dispatch', 'refs/heads/main', {}, PARENT],
];

for (const [name, eventName, ref, event, resolved] of EVENTS) {
  test(`the added-timer mode compares a ${name} head with its merge base with the list-growth base`, () => {
    const merges = [];
    const reads = new Set();
    const result = checkAddedTimers({ eventName, ref, sha: HEAD, event: { repository: { default_branch: 'main' }, ...event } }, {
      present: () => true, firstParent: () => PARENT,
      mergeBase: (head, base) => {
        merges.push([head, base]);
        // The zero-before topic push resolves its own base through the default branch's ref.
        return base === 'refs/remotes/origin/main' ? ANCESTOR : MERGED;
      },
      readLists: (sha) => { assert.equal(sha, HEAD); return { converting: [CONVERTING], awaiting: [] }; },
      show: (sha, path) => { reads.add(sha); return 'unchanged'; },
    }, recordOf({}));
    assert.deepEqual(result, { ok: true, errors: [] });
    assert.deepEqual(merges.at(-1), [HEAD, resolved]);
    assert.deepEqual([...reads].sort(), [MERGED, HEAD].sort());
  });
}

test('the added-timer mode refuses an unsupported event and a head with no merge base, naming each', () => {
  const facts = { present: () => true, firstParent: () => PARENT, mergeBase: () => null, readLists: () => assert.fail('no list read'), show: () => assert.fail('no file read'), atBase: () => assert.fail('no worktree') };
  const unsupported = checkAddedTimers({ eventName: 'release', ref: 'refs/tags/v1', sha: HEAD, event: {} }, facts, recordOf({}));
  assert.deepEqual(unsupported, { ok: false, errors: ['unsupported event release at ref refs/tags/v1'] });
  const unrelated = checkAddedTimers({ eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: HEAD, event: { pull_request: { base: { sha: BEFORE } } } }, facts, recordOf({}));
  assert.deepEqual(unrelated, { ok: false, errors: [`head ${HEAD} has no merge base with ${PARENT}`] });
});

test('the record reader takes every worker file in its directory and refuses a malformed line', () => {
  const directory = temporaryDirectory('rigger-1138-record-');
  writeFileSync(join(directory, '101.jsonl'), `${JSON.stringify(ran(CONVERTING))}\n${JSON.stringify(arm(CONVERTING, 'a'))}\n`);
  writeFileSync(join(directory, '102.jsonl'), `${JSON.stringify(ran(OTHER))}\n`);
  writeFileSync(join(directory, 'ignored.txt'), 'not a record\n');
  const record = readRecord(directory);
  assert.deepEqual([...record.ran].sort(), [CONVERTING, OTHER].sort());
  assert.deepEqual(record.arms, [arm(CONVERTING, 'a')]);
  writeFileSync(join(directory, '103.jsonl'), '{"file": "test/x.test.mjs"\n');
  assert.throws(() => readRecord(directory), /103\.jsonl line 1/);
});


test('fast and nightly set the timer record on npm test and run the added-timer mode as the next step', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  for (const name of ['fast', 'nightly']) {
    const { steps } = ci.jobs[name];
    const at = steps.findIndex((step) => step.run === 'npm test');
    assert.notEqual(at, -1, `${name} runs no npm test step`);
    const record = steps[at].env?.RIGGER_SUITE_TIMER_RECORD;
    assert.match(record ?? '', /^\$\{\{ runner\.temp \}\}\/\S+$/, `${name} npm test sets no record under the runner's temporary directory`);
    assert.deepEqual(steps[at + 1], {
      run: 'node .github/scripts/check-host-declarations.mjs --added-timer',
      env: { RIGGER_SUITE_TIMER_RECORD: record },
    }, `${name} runs the added-timer mode directly after npm test`);
  }
});
