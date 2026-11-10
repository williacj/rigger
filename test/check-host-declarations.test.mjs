// ABOUTME: Tests the test scanner and the added-timer mode of the host-declarations check over
// supplied sources, records and event facts, with no process started and no repository read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runnerRoutes, testsIn } from '../scripts/build-test-matrix.mjs';
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

test('the scanner counts calls in top-level blocks, and lists a call inside a function body as unidentified', () => {
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
  assert.deepEqual(found.unidentified.map(({ line }) => line), [6, 10]);
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

test('the scanner lists an optional member, read or called, and a chain past a registering member as unidentified', () => {
  const source = [
    "import { test } from 'node:test';",
    'const present = test?.skip;',
    "test.skip.call(null, 'chained past the member');",
    "test?.skip('optional member call');",
  ].join('\n');
  const found = testsIn(source, 'test/f.test.mjs');
  assert.deepEqual(found.tests, []);
  // Reading `test?.skip` without calling it is still a reference the scan cannot name, so it is listed.
  assert.deepEqual(found.unidentified.map(({ line }) => line), [2, 3, 4]);
});

// The matrix's expected titles are what node:test registers from each source; the host file
// test/check-host-declarations-host.test.mjs runs every case under the runner to hold them to it.
function misread(group) {
  return cases().filter((entry) => entry.group === group).flatMap(({ name, source, registers, identified, references = 0 }) => {
    const found = testsIn(source, 'test/forms.test.mjs');
    const read = { tests: found.tests.map(({ title }) => title), unidentified: found.unidentified.length };
    const expected = identified ? { tests: registers, unidentified: references } : { tests: [], unidentified: registers.length + references };
    return JSON.stringify(read) === JSON.stringify(expected) ? [] : [`${name}: ${JSON.stringify(read)}`];
  });
}

test('the scanner finds every runner call form in every statement, block and expression the module reaches while it loads', () => {
  assert.deepEqual(misread('reached'), []);
});

test('the scanner names no test in any function body, a concise arrow body included, and lists each runner reference there as unidentified', () => {
  assert.deepEqual(misread('deferred'), []);
});

// The scan reads no scopes, so a call a block-local binding may hide is still listed: a false
// refusal fails closed, where a silent miss would not.
function silent(group) {
  return cases().filter((entry) => entry.group === group).flatMap(({ name, source, registers }) => {
    const found = testsIn(source, 'test/forms.test.mjs');
    const named = found.tests.map(({ title }) => title);
    const unnamed = registers.filter((title) => !named.includes(title));
    return unnamed.length <= found.unidentified.length && (registers.length > 0 || named.length + found.unidentified.length > 0)
      ? [] : [`${name}: ${JSON.stringify({ tests: named, unidentified: found.unidentified.map(({ key }) => key) })}`];
  });
}

test('the scanner fails closed where a block-scoped binding may hide the runner name, listing the call rather than staying silent', () => {
  assert.deepEqual(silent('shadowed'), []);
});

test('the scanner leaves no test silent in any module of the round-2 attack, escapes, imports and class fields included', () => {
  assert.deepEqual(silent('covered'), []);
});

test('the scanner lists no import specifier, a string import name included', () => {
  const source = "import { 'test' as check, \\u0069t } from 'node:test';\ncheck('named', () => {});\nit('escaped', () => {});\n";
  assert.deepEqual(testsIn(source, 'test/h.test.mjs'), { tests: [{ title: 'named', line: 2 }, { title: 'escaped', line: 3 }], unidentified: [] });
});

test('the scanner still finds a test beside bindings that leave the runner name alone', () => {
  assert.deepEqual(misread('unshadowed'), []);
});

test('the scanner lists every reached reference to the runner that is no known call form as unidentified, naming its line', () => {
  const source = [
    "import { test } from 'node:test';", // 1
    'const alias = test;', // 2
    'export { test as runner };', // 3
    "const holder = { test };", // 4
    'void typeof test;', // 5
    "const keyed = { test: 1 }; keyed.test('a property, not the runner');", // 6
    "new test('constructed');", // 7
  ].join('\n');
  const found = testsIn(source, 'test/g.test.mjs');
  assert.deepEqual(found.tests, []);
  assert.deepEqual(found.unidentified.map(({ line }) => line), [2, 3, 4, 5, 7]);
});

test('T6: an added comma-expression call to the runner is refused naming its line, and its arm cannot pass unchecked', () => {
  const added = "(0, test)('arms', () => { clearTimeout(setTimeout(() => {}, 5)); });\n";
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}test('older', () => {});\n${added}` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'arms')] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [`${CONVERTING} line 3: added unidentified runner reference: (0, test)('arms', () => { clearTimeout(setTimeout(() => {}, 5)); });`]);
});

test('T6: an added call in an arrow parameter default is an unidentified runner reference, refused naming its line', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}test('older', () => {});\nconst later = (value = test('older', () => {})) => {};\n` },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'older')] },
  });
  assert.deepEqual(result, { ok: false, errors: [`${CONVERTING} line 3: added unidentified runner reference: const later = (value = test('older', () => {})) => {};`] });
});

test('an unidentified runner reference is keyed by its whole line, so an edit elsewhere keeps the key and an edit on that line changes it', () => {
  const at = (title, body) => testsIn(`import { test } from 'node:test';\nconst cases = [];\nfor (const c of cases) test(c.${title}, () => {\n  ${body}\n});\n`, 'test/e.test.mjs');
  assert.equal(at('name', 'one();').unidentified[0].key, 'for (const c of cases) test(c.name, () => {');
  assert.equal(at('name', 'two();').unidentified[0].key, at('name', 'one();').unidentified[0].key);
  assert.notEqual(at('title', 'one();').unidentified[0].key, at('name', 'one();').unidentified[0].key);
});

// Every route below reaches node:test other than by a static import declaration, or may, because
// its target is not one string literal naming another module. Each is listed by line.
test('the scanner lists every route to node:test other than a static import, and none in strings, comments or to another module', () => {
  const source = [
    "import { test } from 'node:test';", // 1
    "const { test: dynamic } = await import('node:test');", // 2
    'const named = "node:test"; const unread = await import(named);', // 3
    "import { createRequire } from 'node:module';", // 4
    "const required = createRequire(import.meta.url)('node:test');", // 5
    "const builtin = process.getBuiltinModule('node:test');", // 6
    "eval(\"test('x', () => {})\");", // 7
    "export { test as again } from 'node:test';", // 8
    "const require = createRequire(import.meta.url); require('node:test');", // 9
    "const text = \"await import('node:test')\"; // require('node:test')", // 10
    "const other = await import('./other.mjs'); const fs = process.getBuiltinModule('node:fs');", // 11
  ].join('\n');
  assert.deepEqual(runnerRoutes(source, 'test/r.test.mjs').map(({ line }) => line), [2, 3, 5, 6, 7, 8, 9]);
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

test('T6: an added unidentified runner reference is refused naming its line', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}const name = 'x';\n` },
    head: { [CONVERTING]: `${header}const name = 'x';\ntest(name, () => {});\n` },
    record: { ran: [CONVERTING], arms: [] },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [`${CONVERTING} line 3: added unidentified runner reference: test(name, () => {});`]);
});

test('T6: an unchanged unidentified call whose loop gains a case is not added', () => {
  const loop = (cases) => `${header}const cases = ${JSON.stringify(cases)};\nfor (const c of cases) test(c, () => {});\n`;
  const result = rowOutcome({
    base: { [CONVERTING]: loop(['one']) }, head: { [CONVERTING]: loop(['one', 'two']) },
    record: { ran: [CONVERTING], arms: [arm(CONVERTING, 'two')] },
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('T6: an added test registered in a forEach callback is refused naming its line, though a function body holds it', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}test('older', () => {});\n['a', 'b'].forEach((name) => test(name, () => {}));\n` },
    record: { ran: [CONVERTING], arms: [] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING} line 3: added unidentified runner reference: ['a', 'b'].forEach((name) => test(name, () => {}));`]);
});

test('T6: an added call through a binding a dynamic import made is refused, though the import line is older', () => {
  const route = "const { test: later } = await import('node:test');\n";
  const result = rowOutcome({
    base: { [CONVERTING]: header + route },
    head: { [CONVERTING]: `${header}${route}later('through the route', () => {});\n` },
    record: { ran: [CONVERTING], arms: [] },
  });
  assert.deepEqual(result.errors, [`${CONVERTING} line 3: added unidentified runner reference: later('through the route', () => {});`]);
});

test('T14: an added line reaching node:test by a dynamic import is refused naming the file and the line', () => {
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}test('older', () => {});\nconst runner = await import('node:test');\n` },
    record: { ran: [CONVERTING], arms: [] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes(`${CONVERTING} line 3: added route to node:test other than a static import: const runner = await import('node:test');`), JSON.stringify(result.errors));
});

test('T14: an older route line in a changed file, a route named in a string and an import of another module are not refused', () => {
  const route = "const runner = await import('node:test');\n";
  const result = rowOutcome({
    base: { [CONVERTING]: `${header}${route}test('older', () => {});\n` },
    head: { [CONVERTING]: `${header}${route}test('older', () => {});\nconst text = "await import('node:test')";\nconst other = await import('./other.mjs');\n` },
    record: { ran: [CONVERTING], arms: [] },
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

test('T12: tests main gained above a lagging event base are the base\'s, not added, and only the pull request\'s own count', () => {
  // The event's base predates main's newer tests. The merge head's first parent is main's tip,
  // which holds them, so the pull request is compared with that tip and only its own test is added.
  const MAIN = '9'.repeat(40);
  const mainSource = `${header}test('main arms', () => {});\ntest('main clean', () => {});\n`;
  const facts = {
    ...treeFacts({
      [MAIN]: { [CONVERTING]: mainSource, [OTHER]: header },
      [HEAD]: { [CONVERTING]: `${mainSource}test('pull request arms', () => {});\n`, [OTHER]: header },
    }),
    present: () => true,
    firstParent: (sha) => { assert.equal(sha, HEAD); return MAIN; },
    mergeBase: (head, base) => { assert.deepEqual([head, base], [HEAD, MAIN]); return MAIN; },
  };
  const context = { eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: HEAD, event: { pull_request: { base: { sha: BASE } } } };
  const record = recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'main arms'), arm(CONVERTING, 'pull request arms')] });
  assert.deepEqual(checkAddedTimers(context, facts, record),
    { ok: false, errors: [`${CONVERTING}: added test "pull request arms" armed setTimeout with delay 5`] });
});

test('T13: a push to main whose landing added a timer-arming conversion-list test is refused against before', () => {
  const facts = {
    ...treeFacts({
      [BASE]: { [CONVERTING]: `${header}test('older', () => {});\n`, [OTHER]: header },
      [HEAD]: { [CONVERTING]: `${header}test('older', () => {});\ntest('landed', () => {});\n`, [OTHER]: header },
    }),
    present: () => true,
    firstParent: () => assert.fail('a push with a before reads no first parent'),
    mergeBase: (head, base) => { assert.deepEqual([head, base], [HEAD, BASE]); return BASE; },
  };
  const context = { eventName: 'push', ref: 'refs/heads/main', sha: HEAD, event: { before: BASE, repository: { default_branch: 'main' } } };
  const record = recordOf({ ran: [CONVERTING], arms: [arm(CONVERTING, 'older'), arm(CONVERTING, 'landed')] });
  assert.deepEqual(checkAddedTimers(context, facts, record),
    { ok: false, errors: [`${CONVERTING}: added test "landed" armed setTimeout with delay 5`] });
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
