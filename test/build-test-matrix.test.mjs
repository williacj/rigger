// ABOUTME: Tests the test-matrix generator: how it reads the requirement register, how it reads
// ABOUTME: the declarations in the tests, what it renders, and what it refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declarationsIn, register, render } from '../scripts/build-test-matrix.mjs';

const lines = (...rows) => rows.join('\n');

/** The one row a rendered matrix gives a requirement, whole, so its cells can be read. */
const rowFor = (document, id) =>
  document.split('\n').find((line) => line.startsWith(`| ${id} |`));

test('the register yields one requirement per row, in document order', () => {
  const text = lines(
    '## R-ONE — a group',
    '',
    '| id | requirement | made true by | checked by | from |',
    '|---|---|---|---|---|',
    '| R-ONE-1 | the first thing | the engine | the test suite | |',
    '| R-ONE-2 | the second thing | the engine | nothing yet | D8 |',
    '',
    '## R-TWO — another group',
    '',
    '| id | requirement | made true by | checked by | from |',
    '|---|---|---|---|---|',
    '| R-TWO-1 | the third thing | the engine | the gate | |',
  );

  assert.deepEqual(
    register(text).map((row) => row.id),
    ['R-ONE-1', 'R-ONE-2', 'R-TWO-1'],
  );
});

test('a row is read by the headings the register gives its columns, not by their position', () => {
  // The register owns its columns, and `docs/spec/requirements-retired.md` already orders them
  // differently from `docs/spec/requirements.md`. A reader counting cells instead of asking the
  // heading row reads a neighbouring column the day either file gains one.
  const text = lines(
    '| requirement | id | checked by | from |',
    '|---|---|---|---|',
    '| the first thing | R-ONE-1 | nothing yet | D8 |',
  );

  assert.deepEqual(register(text), [{ id: 'R-ONE-1', checkedBy: 'nothing yet' }]);
});

test('a test declares the requirements it proves in a comment on the line above it', () => {
  const source = lines(
    "import { test } from 'node:test';",
    '',
    '// proves R-ONE-1, R-TWO-1',
    "test('the first thing holds', () => {});",
    '',
    '// proves R-ONE-2',
    "test('the second thing holds', () => {});",
  );

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), [
    { ids: ['R-ONE-1', 'R-TWO-1'], title: 'the first thing holds' },
    { ids: ['R-ONE-2'], title: 'the second thing holds' },
  ]);
});

test('a declaration standing above no test is refused, naming where it sits', () => {
  // The declaration says a test proves something. One that has drifted off its test proves
  // nothing, and attaching it to whatever came next would put a claim against the wrong test.
  const source = lines(
    '// proves R-ONE-1',
    '',
    "test('the first thing holds', () => {});",
  );

  assert.throws(() => declarationsIn(source, 'test/first.test.mjs'), (error) => {
    assert.match(error.message, /test\/first\.test\.mjs/);
    assert.match(error.message, /line 1\b/);
    assert.match(error.message, /R-ONE-1/);
    return true;
  });
});

test('a declaration quoted inside a string is no claim by the file quoting it', () => {
  // This generator is tested by handing it fixture sources, so its own test file carries the
  // text of a declaration. A scan matching anywhere on a line would read every fixture here as
  // a claim by this file, and the build would then fail on ids that only a fixture register has.
  const source = "  const fixture = '// proves R-ONE-1\\ntest(\\'first\\', () => {});\\n';";

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), []);
});

test('the matrix holds one row per requirement, naming every test that claims it', () => {
  const requirements = [
    { id: 'R-ONE-1', checkedBy: 'the test suite' },
    { id: 'R-ONE-2', checkedBy: 'the test suite' },
  ];
  const claims = [
    { file: 'test/first.test.mjs', ids: ['R-ONE-1'], title: 'the first thing holds' },
    { file: 'test/second.test.mjs', ids: ['R-ONE-1'], title: 'it holds a second way' },
    { file: 'test/second.test.mjs', ids: ['R-ONE-2'], title: 'the second thing holds' },
  ];

  const document = render(requirements, claims);

  assert.equal(
    rowFor(document, 'R-ONE-1'),
    '| R-ONE-1 | `test/first.test.mjs` the first thing holds<br>' +
    '`test/second.test.mjs` it holds a second way |',
  );
  assert.equal(
    rowFor(document, 'R-ONE-2'),
    '| R-ONE-2 | `test/second.test.mjs` the second thing holds |',
  );
});

test('a requirement no test claims shows an open gap', () => {
  const document = render([{ id: 'R-ONE-1', checkedBy: 'the test suite' }], []);

  assert.equal(rowFor(document, 'R-ONE-1'), '| R-ONE-1 | **gap** |');
});

test('a requirement the register already records as unchecked shows that in place of a gap', () => {
  const document = render(
    [
      { id: 'R-ONE-1', checkedBy: 'nothing yet' },
      { id: 'R-ONE-2', checkedBy: 'nothing could, because only the owner can see it' },
      { id: 'R-ONE-3', checkedBy: 'nothing could' },
    ],
    [],
  );

  assert.equal(rowFor(document, 'R-ONE-1'), '| R-ONE-1 | nothing yet |');
  assert.equal(rowFor(document, 'R-ONE-2'), '| R-ONE-2 | nothing could |');
  // The register's preamble reads a `nothing could` carrying no reason as `nothing yet`, because
  // the recoverable state is the safer default. The matrix shows what the register means by the
  // row rather than the words the row happens to carry.
  assert.equal(rowFor(document, 'R-ONE-3'), '| R-ONE-3 | nothing yet |');
});

test('a test claiming a requirement the register records as unchecked is named all the same', () => {
  // The marker stands in for a gap, never for evidence: what a test asserts is what the matrix
  // exists to report, and a register entry written before that test was added does not hide it.
  const document = render(
    [{ id: 'R-ONE-1', checkedBy: 'nothing yet' }],
    [{ file: 'test/first.test.mjs', ids: ['R-ONE-1'], title: 'the first thing holds' }],
  );

  assert.equal(rowFor(document, 'R-ONE-1'), '| R-ONE-1 | `test/first.test.mjs` the first thing holds |');
});
