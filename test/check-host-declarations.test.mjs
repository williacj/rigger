// ABOUTME: Tests the test scanner and the added-timer mode of the host-declarations check over
// supplied sources, records and event facts, with no process started and no repository read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { testsIn } from '../scripts/build-test-matrix.mjs';
import { addedTimers, checkAddedTimers, parseRecord, readRecord } from '../.github/scripts/check-host-declarations.mjs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';
import { cases } from './runner-call-forms.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// Each expected value below is read off the fixture source by hand: the title a quoted run holds,
// and the 1-based line its call starts on.
test('the scanner lists each top-level test, suite and member call by title, declared or not', () => {
  const source = [
    "import { test, it as check, describe, suite, before, mock } from 'node:test';", // 1
    "test('plain', () => {});", // 2
    '// proves R-EXAMPLE-1', // 3
    "test('declared', () => {});", // 4
    "check('aliased it', () => {});", // 5
    "describe('a suite', () => { test('nested', () => {}); });", // 6
    "suite.skip('skipped suite', () => {});", // 7
    "test.only('only', () => {});", // 8
    "await test.todo(`todo`);", // 9
    "before(() => {});", // 10
    "mock.method(globalThis, 'fetch');", // 11
    "test('plain', () => {});", // 12
  ].join('\n');
  assert.deepEqual(testsIn(source, 'test/a.test.mjs'), {
    tests: [
      { title: 'plain', line: 2 }, { title: 'declared', line: 4 }, { title: 'aliased it', line: 5 },
      { title: 'a suite', line: 6 }, { title: 'skipped suite', line: 7 }, { title: 'only', line: 8 },
      { title: 'todo', line: 9 }, { title: 'plain', line: 12 },
    ],
    unidentified: [],
  });
});

test('the scanner reads a default import as test and ignores names bound elsewhere', () => {
  const source = [
    "import run from 'node:test';",
    "import { test } from './not-the-runner.mjs';",
    "run('default import', () => {});",
    "test('another module', () => {});",
    "other('unbound', () => {});",
    "thing.run('a member of something else');",
  ].join('\n');
  assert.deepEqual(testsIn(source, 'test/b.test.mjs'), {
    tests: [{ title: 'default import', line: 3 }],
    unidentified: [],
  });
});

test('the scanner counts calls in top-level blocks and none inside a function body', () => {
  const source = [
    "import { test } from 'node:test';",
    'if (process.env.X) {',
    "  test('in an if block', () => {});",
    '}',
    'function later() {',
    "  test('in a function body', () => {});",
    '}',
    'const cases = [];',
    'for (const name of cases) {',
    '  test(name, () => {});',
    '}',
  ].join('\n');
  const found = testsIn(source, 'test/c.test.mjs');
  assert.deepEqual(found.tests, [{ title: 'in an if block', line: 3 }]);
  assert.deepEqual(found.unidentified.map(({ line }) => line), [10]);
});

test('the scanner names the line of each top-level call whose test it cannot identify', () => {
  const lines = [
    "import { test, describe } from 'node:test';", // 1
    "import * as runner from 'node:test';", // 2
    'const title = "x";', // 3
    'test(title, () => {});', // 4
    'test(`built ${title}`, () => {});', // 5
    "test('a' + 'b', () => {});", // 6
    'test(...[title]);', // 7
    "runner.test('namespace member', () => {});", // 8
    "test?.('optional call');", // 9
    "(test)('parenthesised callee');", // 10
    "describe.each('unknown member');", // 11
    'test(() => {});', // 12
    "test('\\8 undecodable');", // 13
    "runner.before(() => {});", // 14
  ];
  const found = testsIn(lines.join('\n'), 'test/d.test.mjs');
  assert.deepEqual(found.tests, []);
  assert.deepEqual(found.unidentified.map(({ line }) => line), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  for (const call of found.unidentified) {
    assert.equal(typeof call.key, 'string');
    assert.ok(call.key.length > 0);
  }
});

test('the scanner reads an optional member as no call and a chain past a registering member as unidentified', () => {
  const source = [
    "import { test } from 'node:test';",
    'const present = test?.skip;',
    "test.skip.call(null, 'chained past the member');",
    "test?.skip('optional member call');",
  ].join('\n');
  const found = testsIn(source, 'test/f.test.mjs');
  assert.deepEqual(found.tests, []);
  assert.deepEqual(found.unidentified.map(({ line }) => line), [3, 4]);
});

// The matrix's expected titles are what node:test registers from each source; the host file
// test/check-host-declarations-host.test.mjs runs every case under the runner to hold them to it.
function misread(group) {
  return cases().filter((entry) => entry.group === group).flatMap(({ name, source, registers }) => {
    const found = testsIn(source, 'test/forms.test.mjs');
    const read = { tests: found.tests.map(({ title }) => title), unidentified: found.unidentified.length };
    return JSON.stringify(read) === JSON.stringify({ tests: registers, unidentified: 0 }) ? [] : [`${name}: ${JSON.stringify(read)}`];
  });
}

test('the scanner finds every runner call form in every statement, block and expression the module reaches while it loads', () => {
  assert.deepEqual(misread('reached'), []);
});

test('the scanner finds no test in any function body, a concise arrow body included', () => {
  assert.deepEqual(misread('deferred'), []);
});

test('the scanner finds no test where a block-scoped binding hides the runner name', () => {
  assert.deepEqual(misread('shadowed'), []);
});

test('the scanner still finds a test beside bindings that leave the runner name alone', () => {
  assert.deepEqual(misread('unshadowed'), []);
});

test('an unidentified call keeps its key when only its body changes, and changes it with its name', () => {
  const at = (body) => testsIn(`import { test } from 'node:test';\nconst cases = [];\nfor (const c of cases) test(c.name, () => { ${body} });\n`, 'test/e.test.mjs');
  assert.equal(at('one();').unidentified[0].key, at('two();').unidentified[0].key);
  const renamed = testsIn("import { test } from 'node:test';\nconst cases = [];\nfor (const c of cases) test(c.title, () => {});\n", 'test/e.test.mjs');
  assert.notEqual(renamed.unidentified[0].key, at('one();').unidentified[0].key);
});

// The rows below are card #1138's "The added-timer cells". Each change is two in-memory trees,
// base and head, and the record is the lines #1137's guard writes: a ran line with a null `api`
// and an arm line naming the file, the top-level test's title, the API and the delay.
const BASE = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);
const CONVERTING = 'test/converting.test.mjs';
const OTHER = 'test/other-converting.test.mjs';
const BOUNDED = 'test/bounded.test.mjs';
const header = "import { test } from 'node:test';\n";
const ran = (file) => ({ file, test: null, api: null, delay: null });
const arm = (file, title, api = 'setTimeout', delay = 5) => ({ file, test: title, api, delay });

function treeFacts(trees, converting = [CONVERTING, OTHER]) {
  return {
    readLists: (sha) => { assert.equal(sha, HEAD); return { converting, awaiting: [] }; },
    show: (sha, path) => trees[sha]?.[path] ?? null,
  };
}

function rowOutcome({ base = {}, head = {}, record = { ran: [], arms: [] }, converting }) {
  const trees = { [BASE]: { [OTHER]: header, ...base }, [HEAD]: { [OTHER]: header, ...head } };
  return addedTimers({ base: BASE, head: HEAD, facts: treeFacts(trees, converting), record: recordOf(record) });
}

function recordOf({ ran: files = [], arms = [] }) {
  return parseRecord([...files.map(ran), ...arms].map((line) => JSON.stringify(line)).join('\n'));
}

test('T1: a test added to a conversion-list file whose title the record arms under is refused naming both', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}test('older', () => {});\ntest('added', () => {});\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'added', 'node:timers.setInterval', 7)] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [`${CONVERTING}: added test "added" armed node:timers.setInterval with delay 7`]);
});

test('T1: an added title is matched to the record as the string the runner registers, not as its source text', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: header },
    head: { [CONVERTING]: `${header}test('caf\\u00e9 // not a comment', () => {});\n// test('commented out', () => {});\nconst text = "test('in a string', () => {})";\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'café // not a comment'), arm(CONVERTING, 'commented out'), arm(CONVERTING, 'in a string')] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING}: added test "café // not a comment" armed setTimeout with delay 5`]);
});

test('T2: no added test passes although an older test arms a timer', () => {
  const source = `${header}test('older', () => {});\n`;
  const result = rowOutcome({
    base: { [CONVERTING]: source }, head: { [CONVERTING]: `${source}// a comment\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'older')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T3: a renamed older test is added under its new title and refused naming it', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('old name', () => {});\n` },
    head: { [CONVERTING]: `${header}test('new name', () => {});\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'new name')] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING}: added test "new name" armed setTimeout with delay 5`]);
});

test('T4: a timer-arming test moved from a bounded file into a conversion-list file is refused', () => {
  const moved = "test('moved', () => { clearTimeout(setTimeout(() => {}, 5)); });\n";
  const result = rowOutcome({
    base: { [BOUNDED]: header + moved, [CONVERTING]: header },
    head: { [BOUNDED]: header, [CONVERTING]: header + moved },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'moved')] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING}: added test "moved" armed setTimeout with delay 5`]);
});

test('T5: a second test sharing an older title is added, and an arm under that title from either is refused', () => {
  const older = "test('shared', () => {});\n";
  const result = rowOutcome({
    base: { [CONVERTING]: header + older },
    head: { [CONVERTING]: header + older + older },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'shared')] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING}: added test "shared" armed setTimeout with delay 5`]);
});

test('T6: an added top-level call the scanner cannot identify is refused naming its line', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}const name = 'x';\n` },
    head: { [CONVERTING]: `${header}const name = 'x';\ntest(name, () => {});\n` },
    record: { ran: [CONVERTING], arms: [] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [`${CONVERTING} line 3: added top-level call whose test the scanner cannot identify: test(name`]);
});

test('T6: an unchanged unidentified call whose loop gains a case is not added', () => {
  const loop = (cases) => `${header}const cases = ${JSON.stringify(cases)};\nfor (const c of cases) test(c, () => {});\n`;
  const result = rowOutcome({
    base: { [CONVERTING]: loop(['one']) }, head: { [CONVERTING]: loop(['one', 'two']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'two')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T7: a test added to a conversion-list file the record does not show ran is refused naming the file', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: header }, head: { [CONVERTING]: `${header}test('added', () => {});\n` },
    record: { ran: [OTHER], arms: [] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [`${CONVERTING}: tests were added and the timer record shows no run of the file`]);
});

test('T8: no added test and no record directory passes', () => {
  const directory = join(temporaryDirectory('rigger-1138-record-'), 'absent');
  const result = addedTimers({
    base: BASE, head: HEAD, record: readRecord(directory),
    facts: treeFacts({ [BASE]: { [CONVERTING]: header, [OTHER]: header }, [HEAD]: { [CONVERTING]: header, [OTHER]: header } }),
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T9: an added test whose file ran and which armed nothing passes', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: header }, head: { [CONVERTING]: `${header}test('added', () => {});\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'older')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T11: an added test passes beside an arm line from its file whose test is null', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: header }, head: { [CONVERTING]: `${header}test('added', () => {});\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, null)] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T10: an added test passes when the arm under its title comes from another conversion-list file', () => {
  const older = "test('shared', () => {});\n";
  const result = rowOutcome({
    base: { [CONVERTING]: header, [OTHER]: header + older },
    head: { [CONVERTING]: header + older, [OTHER]: header + older },
    record: { ran: [CONVERTING, OTHER], arms: [arm(OTHER, 'shared')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T12: tests main added above a lagging event base count as added, each passing or refused as its row gives', () => {
  // The pull request's event base predates main's newer tests; the merge head carries them, and
  // the merge base of that head with the event base is the event base itself.
  const facts = {
    ...treeFacts({
      [BASE]: { [CONVERTING]: header, [OTHER]: header },
      [HEAD]: { [CONVERTING]: `${header}test('main arms', () => {});\ntest('main clean', () => {});\n`, [OTHER]: header },
    }),
    present: () => true,
    mergeBase: (head, base) => { assert.deepEqual([head, base], [HEAD, BASE]); return BASE; },
  };
  const context = { eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: HEAD, event: { pull_request: { base: { sha: BASE } } } };
  const result = checkAddedTimers(context, facts, recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'main arms')] }));
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING}: added test "main arms" armed setTimeout with delay 5`] });
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
  ['pull request', 'pull_request', 'refs/pull/7/merge', { pull_request: { base: { sha: BEFORE } } }, BEFORE],
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
      show: (sha, path) => { reads.add(sha); return header; },
    }, recordOf({}));
    assert.deepEqual(result, { ok: true, errors: [] });
    assert.deepEqual(merges.at(-1), [HEAD, resolved]);
    assert.deepEqual([...reads].sort(), [MERGED, HEAD].sort());
  });
}

test('the added-timer mode refuses an unsupported event and a head with no merge base, naming each', () => {
  const facts = { present: () => true, firstParent: () => PARENT, mergeBase: () => null, readLists: () => assert.fail('no list read'), show: () => assert.fail('no file read') };
  const unsupported = checkAddedTimers({ eventName: 'release', ref: 'refs/tags/v1', sha: HEAD, event: {} }, facts, recordOf({}));
  assert.deepEqual(unsupported, { ok: false, errors: ['unsupported event release at ref refs/tags/v1'] });
  const unrelated = checkAddedTimers({ eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: HEAD, event: { pull_request: { base: { sha: BEFORE } } } }, facts, recordOf({}));
  assert.deepEqual(unrelated, { ok: false, errors: [`head ${HEAD} has no merge base with ${BEFORE}`] });
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
