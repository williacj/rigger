// ABOUTME: Tests the test-matrix generator: how it reads the requirement register, how it reads
// ABOUTME: the declarations in the tests, what it renders, and what it refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, declarationsIn, register, render } from '../scripts/build-test-matrix.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run the generator as CI runs it, against a fixture repository rather than this one. What the
 * acceptance names is an exit code and what the run prints, and nothing short of the command
 * observes either.
 */
const run = (dir, ...args) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'build-test-matrix.mjs'), ...args, dir], {
    encoding: 'utf8',
  });

const lines = (...rows) => rows.join('\n');

/** A fixture repository holding the files a run reads, and nothing else. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-matrix-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** A register of requirements, written the way `docs/spec/requirements.md` writes one. */
const registerOf = (...rows) => lines(
  'ABOUTME: a fixture register.',
  '',
  '## R-ONE — a group',
  '',
  '| id | requirement | made true by | checked by | from |',
  '|---|---|---|---|---|',
  ...rows.map(([id, checkedBy]) => `| ${id} | a thing | the engine | ${checkedBy} | |`),
  '',
);

/** A register of withdrawn requirements, written the way `requirements-retired.md` writes one. */
const retiredOf = (...ids) => lines(
  'ABOUTME: a fixture register of withdrawn requirements.',
  '',
  '| id | requirement | from | withdrawn | replaced by |',
  '|---|---|---|---|---|',
  ...ids.map((id) => `| ${id} | a thing | | 2026-01-01 | |`),
  '',
);

/** A test file carrying one declaration and the test it speaks for. */
const proving = (declaration, title) => `${declaration}\ntest('${title}', () => {});\n`;

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

test('a run reads the register and the tests off disk, and counts what no test claims', () => {
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite'], ['R-ONE-2', 'the gate']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'test/first.test.mjs': proving('// proves R-ONE-1', 'the first thing holds'),
  });

  const report = check(dir);

  assert.equal(
    rowFor(report.document, 'R-ONE-1'),
    '| R-ONE-1 | `test/first.test.mjs` the first thing holds |',
  );
  assert.equal(rowFor(report.document, 'R-ONE-2'), '| R-ONE-2 | **gap** |');
  assert.equal(report.total, 2);
  assert.equal(report.untested, 1);
});

test('a test declaring a requirement that does not exist is refused, naming the id', () => {
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'test/first.test.mjs': proving('// proves R-ONE-2', 'the first thing holds'),
  });

  assert.throws(() => check(dir), (error) => {
    assert.match(error.message, /R-ONE-2/);
    assert.match(error.message, /test\/first\.test\.mjs/);
    return true;
  });
});

test('a test declaring a withdrawn requirement is refused, and told that it is withdrawn', () => {
  // The retired register keeps a withdrawn id allocated, so the id resolves. What it no longer
  // does is bind, and a test claiming to prove it claims something the register does not say.
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf('R-ONE-2'),
    'test/first.test.mjs': proving('// proves R-ONE-2', 'the first thing holds'),
  });

  assert.throws(() => check(dir), (error) => {
    assert.match(error.message, /R-ONE-2/);
    assert.match(error.message, /withdrawn/);
    return true;
  });
});

/** A fixture repository with two requirements, one of them proved by a test. */
const repository = () => fixture({
  'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite'], ['R-ONE-2', 'the gate']),
  'docs/spec/requirements-retired.md': retiredOf(),
  'test/first.test.mjs': proving('// proves R-ONE-1', 'the first thing holds'),
});

test('a written matrix regenerates byte for byte, and the check admits it', () => {
  const dir = repository();
  const matrix = join(dir, 'docs', 'derived', 'test-matrix.md');

  const written = run(dir, '--write');
  assert.equal(written.status, 0, written.stderr);
  const first = readFileSync(matrix);

  // Nothing in the document may come from the clock or from the order a directory happened to
  // be read in: a second run over an unchanged repository has nothing new to say.
  assert.equal(run(dir, '--write').status, 0);
  assert.deepEqual(readFileSync(matrix), first);
  assert.equal(run(dir).status, 0, 'the check refuses the matrix its own write produced');
});

test('a matrix edited by hand fails the check, naming the file', () => {
  const dir = repository();
  run(dir, '--write');
  appendFileSync(join(dir, 'docs', 'derived', 'test-matrix.md'), '| R-ONE-2 | by hand |\n');

  const edited = run(dir);

  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /docs\/derived\/test-matrix\.md/);
});

test('a matrix that no longer matches the tests fails the check', () => {
  const dir = repository();
  run(dir, '--write');
  writeFileSync(join(dir, 'test', 'second.test.mjs'), proving('// proves R-ONE-2', 'the second thing holds'));

  const stale = run(dir);

  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /docs\/derived\/test-matrix\.md/);
});

test('a file under docs/derived that no tool writes fails the check, naming it', () => {
  // D8 rule 1: everything under that directory is generated. A hand-written file there is the
  // edit rule 2 refuses, whether it arrived by editing the matrix or by adding a second file.
  const dir = repository();
  run(dir, '--write');
  writeFileSync(join(dir, 'docs', 'derived', 'notes.md'), 'typed by hand\n');

  const strayed = run(dir);

  assert.equal(strayed.status, 1);
  assert.match(strayed.stderr, /notes\.md/);
});

test('a run refuses to write a matrix over a claim that cannot be true', () => {
  // The exit code is what fails the build, and a matrix written from a claim the register does
  // not recognise would record that claim as evidence.
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'test/first.test.mjs': proving('// proves R-ONE-2', 'the first thing holds'),
  });

  const { status, stdout, stderr } = run(dir, '--write');

  assert.notEqual(status, 0, 'the run carried on over a requirement that does not exist');
  assert.match(stdout + stderr, /R-ONE-2/);
  assert.throws(() => readFileSync(join(dir, 'docs', 'derived', 'test-matrix.md')));
});

test('the committed matrix holds the ids the register holds, in the order it holds them', () => {
  // The ids are taken off the register's text rather than through the reader the generator uses,
  // so a reader that quietly dropped a group — a table it failed to recognise, say — would not
  // be agreeing with itself here.
  const ids = (text) => [...text.matchAll(/^\| (R-[A-Z]+-\d+) \|/gm)].map(([, id]) => id);
  const registered = ids(readFileSync(join(root, 'docs', 'spec', 'requirements.md'), 'utf8'));
  const matrix = readFileSync(join(root, 'docs', 'derived', 'test-matrix.md'), 'utf8');

  assert.ok(registered.length > 0, 'the register states no requirements to match against');
  assert.deepEqual(ids(matrix), registered);
});

test('this repository holds a matrix that is current, and nothing else under docs/derived', () => {
  // Every run above reads a fixture. This one reads the register this repository authors, the
  // tests it actually has — this file among them — and the matrix committed beside them, so a
  // declaration added without regenerating is caught here rather than only in CI.
  const report = check(root);

  assert.equal(report.stale, false, 'the committed matrix is not what the tests say: run `npm run matrix`');
  assert.deepEqual(report.strays, []);
});

test('every run prints how many requirements no test claims', () => {
  const dir = repository();

  for (const args of [['--write'], []]) {
    const printed = run(dir, ...args);
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /1 of 2 requirements have no test/);
  }
});
