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

// Sources whose only call to the runner the runner never executes, each one valid JavaScript, and
// each carrying a declaration above that call. The name of the shape says what hides the call; the
// test named `a test nobody runs` is the claim no matrix may ever make. `node --test` is the
// authority on the second half of that, and the relation test at the foot of this file asks it.
const NEVER_RUN = {
  'a block comment a regular expression opened': lines(
    "const quoted = /['\"]/; /* these tests are disabled for now",
    '// proves R-ONE-1',
    "test('a test nobody runs', () => {});",
    '*/',
    '',
  ),
  'a fixture that spans lines': lines(
    'const fixture = `',
    '// proves R-ONE-1',
    "test('a test nobody runs', () => {});",
    '`;',
    '',
  ),
  'a fixture that spans lines, opened under a backtick inside a string': lines(
    'const tick = "`";',
    'const fixture = `',
    '// proves R-ONE-1',
    "test('a test nobody runs', () => {});",
    '`;',
    '',
  ),
  'a fixture in a string continued onto the next line': lines(
    "const fixture = '\\",
    '// proves R-ONE-1\\',
    'test("a test nobody runs", () => {}) \\',
    "';",
    '',
  ),
  'a call commented out with two slashes': lines(
    '// proves R-ONE-1',
    "// test('a test nobody runs', () => {});",
    '',
  ),
  'a call commented out in a block': lines(
    '/*',
    '// proves R-ONE-1',
    "test('a test nobody runs', () => {});",
    '*/',
    '',
  ),
  'a call inside a function nobody calls': lines(
    'function disabled() {',
    '  // proves R-ONE-1',
    "  test('a test nobody runs', () => {});",
    '}',
    '',
  ),
  'a call behind a branch that is never taken': lines(
    'if (Number(0)) {',
    '  // proves R-ONE-1',
    "  test('a test nobody runs', () => {});",
    '}',
    '',
  ),
};

// The other direction: sources whose declaration does speak for a test the runner runs, each with
// the titles the scan has to report from it. The titles are read off the source by hand, never
// taken from what the scan returns, and each is distinct so that the runner's answer for one shape
// cannot stand in for another's. Every shape here is one that defeated a scan reading lines: a
// backtick or a comment marker it counted where the language does not.
const ALSO_RUN = {
  'a declaration above a plain call': {
    source: lines('// proves R-ONE-1', "test('a plain call', () => {});", ''),
    claims: ['a plain call'],
  },
  'a backtick inside a line comment above it': {
    source: lines('// the ` character', '// proves R-ONE-1', "test('a call under a comment', () => {});", ''),
    claims: ['a call under a comment'],
  },
  'a backtick inside a regular expression above it': {
    source: lines('const tick = /`/;', '// proves R-ONE-1', "test('a call under a backtick', () => {});", ''),
    claims: ['a call under a backtick'],
  },
  'a block-comment opener inside a regular expression above it': {
    source: lines('const marker = /[/*]/;', '// proves R-ONE-1', "test('a call under a marker', () => {});", ''),
    claims: ['a call under a marker'],
  },
  'a fixture in a single-line string above it': {
    source: lines(
      "const fixture = '// proves R-ONE-1\\ntest(\"nothing\", () => {});';",
      '// proves R-ONE-1',
      "test('a call under a fixture', () => {});",
      '',
    ),
    claims: ['a call under a fixture'],
  },
  'a declaration a line separator divides from its call': {
    // U+2028 ends a line for JavaScript, so the comment ends there and the call is the next line.
    // A scan that split on `\n` alone read both as one line and dropped the claim without a word.
    source: `// proves R-ONE-1 test('a call after a line separator', () => {});\n`,
    claims: ['a call after a line separator'],
  },
  'a declaration above an awaited call': {
    source: lines('// proves R-ONE-1', "await test('an awaited call', () => {});", ''),
    claims: ['an awaited call'],
  },
  'two declarations, and a division between them': {
    source: lines(
      '// proves R-ONE-1',
      "test('a call before a division', () => {});",
      'const half = (1 + 3) / 2;',
      '// proves R-ONE-1',
      "test('a call after a division', () => {});",
      'export { half };',
      '',
    ),
    claims: ['a call before a division', 'a call after a division'],
  },
};

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

test('a declaration inside a block comment a regular expression opened claims nothing', () => {
  // The repro on card #85. A quote inside a regular expression is text, so the scan that read
  // quoted runs by hand stopped at it and never saw the `/*` after it: the block comment was
  // never opened, and a test nobody runs was written into the matrix as evidence.
  const source = lines(
    "const quoted = /['\"]/; /* these tests are disabled for now",
    '// proves R-ONE-1',
    "test('a test nobody runs', () => {});",
    '*/',
  );

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), []);
});

test('a declaration inside a fixture that spans lines claims nothing, and costs nothing either', () => {
  // A template literal is one token whatever it holds, so a declaration inside one is the text of
  // a fixture and never a claim. It used to be refused instead, because a scan reading lines could
  // not tell the two apart: the refusal was the price of that, and reading syntax does not pay it.
  const source = lines(
    'const fixture = `',
    '// proves R-ONE-1',
    "test('a fixture that proves nothing', () => {});",
    '`;',
    "test('the only real test in this file', () => {});",
  );

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), []);
});

test('a declaration above a test that is commented out is refused, because that is no test', () => {
  const source = lines(
    '// proves R-ONE-1',
    "// test('a test someone commented out', () => {});",
  );

  assert.throws(() => declarationsIn(source, 'test/first.test.mjs'), /stands above no test/);
});

test('a comment opener inside a string opens no comment, so what follows is still read', () => {
  // `test/package-budget.test.mjs` holds this shape — a fixture in a single-line string carrying
  // a comment opener — and a scan reading that as a comment dropped every declaration after it
  // without a word. A dropped claim reads exactly like a requirement no test claims, in the one
  // document whose job is to tell those two apart.
  const source = lines(
    'const source = [\'const s = "/*";\', \'const a = 1;\'].join(String.fromCharCode(10));',
    '// proves R-ONE-1',
    "test('the first thing holds', () => {});",
  );

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), [
    { ids: ['R-ONE-1'], title: 'the first thing holds' },
  ]);
});

test('a block comment the scan never sees close is refused, not swallowed', () => {
  // Source that parses cannot leave a block comment open, so the scan has misread something.
  // What that costs is this refusal, never the rest of a file going quietly unread.
  const source = lines(
    '/* a comment that never closes',
    '// proves R-ONE-1',
    "test('the first thing holds', () => {});",
  );

  assert.throws(() => declarationsIn(source, 'test/first.test.mjs'), (error) => {
    assert.match(error.message, /test\/first\.test\.mjs/);
    assert.match(error.message, /never closes/);
    return true;
  });
});

test('a test commented out in a block claims nothing, declaration and all', () => {
  // The same shape as a call commented out with two slashes, and it has to end the same way.
  // Here the declaration is commented out with it, so there is nothing to refuse: what the file
  // says is that neither line is live.
  const source = lines(
    '/*',
    '// proves R-ONE-1',
    "test('a test someone commented out', () => {});",
    '*/',
    "test('the only real test in this file', () => {});",
  );

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), []);
});

test('a declaration above a string holding a call is refused, because that is no test', () => {
  // A claim names a line that begins with a call to the runner. A line that merely carries the
  // text of one, the way a fixture does, is not a test and cannot be named as one.
  const source = lines(
    '// proves R-ONE-1',
    'const source = "test(\'a fixture that proves nothing\', () => {});";',
  );

  assert.throws(() => declarationsIn(source, 'test/first.test.mjs'), /stands above no test/);
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

test('a declaration is read out of every file the test runner runs, wherever it sits', () => {
  // `npm test` is `node --test`, which runs a name it recognises wherever that file sits and
  // every JavaScript file under a directory named `test`. A scan reading less than the runner
  // runs drops a claim a real test made, and lets a claim that cannot be true through with it.
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite'], ['R-ONE-2', 'the gate']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'src/beside-the-code.test.mjs': proving('// proves R-ONE-1', 'the first thing holds'),
    'test/helpers.mjs': proving('// proves R-ONE-2', 'the second thing holds'),
  });

  const report = check(dir);

  assert.equal(
    rowFor(report.document, 'R-ONE-1'),
    '| R-ONE-1 | `src/beside-the-code.test.mjs` the first thing holds |',
  );
  assert.equal(
    rowFor(report.document, 'R-ONE-2'),
    '| R-ONE-2 | `test/helpers.mjs` the second thing holds |',
  );
  assert.equal(report.untested, 0);
});

test('a declaration in a package the runner never runs is left where it lies', () => {
  // `node --test` does not descend into `node_modules`, and CI has one. A claim found there
  // would be a claim about somebody else's tests, and a bogus id there would red this build.
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'node_modules/somebody-else/first.test.mjs': proving('// proves R-OTHER-9', 'their test'),
  });

  const report = check(dir);

  assert.equal(report.untested, 1);
  assert.equal(rowFor(report.document, 'R-ONE-1'), '| R-ONE-1 | **gap** |');
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

test('a claim that cannot be true is refused in a file that carries a comment opener too', () => {
  // The shape reported on this repository's own `test/package-budget.test.mjs`: a bogus id in a
  // file whose fixtures quote a comment opener. The scan lost the declaration, so the run wrote
  // a matrix and exited 0 over a claim that could not be true.
  const dir = fixture({
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf(),
    'test/first.test.mjs': lines(
      'const source = [\'const s = "/*";\', \'const a = 1;\'].join(String.fromCharCode(10));',
      '// proves R-NOPE-9',
      "test('a test naming a requirement that does not exist', () => {});",
      '',
    ),
  });

  const { status, stdout, stderr } = run(dir, '--write');

  assert.notEqual(status, 0, 'the run carried on over a requirement that does not exist');
  assert.match(stdout + stderr, /R-NOPE-9/);
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

test('no run writes a matrix naming a test the runner never runs', () => {
  // The whole bar, at the command that writes the document. Each source below is valid JavaScript
  // whose only call to the runner the runner never executes, and the shapes are unrelated to one
  // another on purpose: a scan closing them one at a time is the cost this card was filed over.
  // What the run does with a shape is its own business — a refusal, or a document with a gap in
  // it — so long as no document names the test.
  for (const [shape, source] of Object.entries(NEVER_RUN)) {
    const dir = fixture({
      'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
      'docs/spec/requirements-retired.md': retiredOf(),
      'test/first.test.mjs': source,
    });

    const { status, stdout, stderr } = run(dir, '--write');
    let matrix = '';
    try {
      matrix = readFileSync(join(dir, 'docs', 'derived', 'test-matrix.md'), 'utf8');
    } catch { /* a run that refused wrote none, which names nothing */ }

    assert.doesNotMatch(matrix, /a test nobody runs/, `${shape} was written into the matrix`);
    if (status !== 0) {
      assert.match(stdout + stderr, /test\/first\.test\.mjs/, `${shape} was refused without naming the file`);
    }
  }
});

test('CI runs the check, which is what turns its exit code into a failed build', () => {
  // Every refusal above is an exit code. An exit code fails the build only where something runs
  // the command, so the step in the workflow is the link between the two, and it is load-bearing
  // for every one of them.
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /^\s*- run: npm run matrix:check$/m);
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

/**
 * Every shape in one repository, each source its own test file, so one runner run answers for all
 * of them. The declaration in each names `R-ONE-1`, which the fixture register holds.
 */
function everyShape(sources) {
  const files = {
    'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite']),
    'docs/spec/requirements-retired.md': retiredOf(),
  };
  const paths = sources.map((source, at) => {
    files[`test/shape-${at}.test.mjs`] = `import { test } from 'node:test';\n${source}`;
    return `test/shape-${at}.test.mjs`;
  });
  return { dir: fixture(files), paths };
}

/**
 * Every test name `node --test` reports running in a repository, and how many of its runs failed.
 *
 * This is the authority (`D16` rule 1): `npm test` is `node --test`, so whether a title names a
 * test at all is that command's answer and not a shape a script recognised. The failure count is
 * the guard on the fixtures — a source that does not parse, or one whose import is wrong, runs no
 * test for a reason that has nothing to do with what is being measured, and it would read as a
 * test the runner declines.
 */
function executed(dir) {
  // `NODE_TEST_CONTEXT` marks a process as already inside a test run, and a child that inherits
  // it refuses to look for files at all. This run has to be the outer one.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
  return {
    names: [...ran.stdout.matchAll(/^\s*# Subtest: (.+)$/gm)].map(([, name]) => name.trim()),
    failed: Number(/^# fail (\d+)$/m.exec(ran.stdout)?.[1] ?? -1),
    said: ran.stdout + ran.stderr,
  };
}

test('every declaration the scan reports names a test the runner really runs', (t) => {
  // The whole bar of card #85, tied to the only thing that can settle it. Each source goes to the
  // real runner and to the scan, and the assertion is the relation between the two answers rather
  // than either one written down: a title the scan reports has to be a title the runner reported
  // running. Nothing here pins what the runner does, so the day it changes what it executes this
  // fails rather than agreeing for ever with a list typed beside it.
  const shapes = [
    ...Object.entries(NEVER_RUN).map(([shape, source]) => [shape, source, []]),
    ...Object.entries(ALSO_RUN).map(([shape, { source, claims }]) => [shape, source, claims]),
  ];
  const { dir, paths } = everyShape(shapes.map(([, source]) => source));
  const runner = executed(dir);

  assert.equal(runner.failed, 0, `a fixture broke rather than being declined:\n${runner.said}`);
  assert.ok(runner.names.length > 0, `the runner ran nothing:\n${runner.said}`);
  t.diagnostic(`node ${process.version} ran: ${runner.names.join(' | ')}`);

  for (const [at, [shape, source, claims]] of shapes.entries()) {
    let reported;
    try {
      reported = declarationsIn(source, paths[at]).map((claim) => claim.title);
    } catch (refusal) {
      // A refusal claims nothing, which is the safe side of the bar. That it names where it sits
      // is asserted below, by the test that owns that half.
      assert.deepEqual(claims, [], `${shape} was refused: ${refusal.message}`);
      continue;
    }
    assert.deepEqual(reported, claims, `${shape} was not read as its source says`);
    for (const title of reported) {
      assert.ok(
        runner.names.includes(title),
        `${shape}: the scan claims \`${title}\`, which the runner never ran. It ran: ${runner.names.join(' | ')}`,
      );
    }
  }
});

test('the runner runs no test that any shape above only pretends to declare', () => {
  // The other half of the relation, and the one that catches a scan agreeing with itself. Every
  // source in `NEVER_RUN` names its dead test the same, so this asks the runner whether it ran a
  // test by that name anywhere in a repository made of nothing but those files. A shape that
  // turned out to be live — a fixture that does run, so no evidence of anything — reds here.
  const { dir } = everyShape(Object.values(NEVER_RUN));
  const runner = executed(dir);

  assert.equal(runner.failed, 0, `a fixture broke rather than being declined:\n${runner.said}`);
  assert.ok(
    !runner.names.includes('a test nobody runs'),
    `a source in NEVER_RUN declares a test the runner does run:\n${runner.said}`,
  );
});

test('a line the scan cannot classify is refused, naming the file and the line', () => {
  // `R-CARD` aside, this is the honest half of reading source as syntax: where the language leaves
  // a character ambiguous, or where the source says nothing about whether the runner reaches a
  // call, the scan says so and names where. A refusal costs a run; a guess costs a claim in a
  // document nobody reads back.
  // Each shape names the line it is refused at and the reason the refusal has to give. The reason
  // is here because a refusal is only useful if it says what could not be classified: a scan that
  // threw for some other reason at the same line would satisfy the line alone, and did.
  const refused = {
    'a slash after a closing brace, which is a division or a regular expression': {
      source: lines(
        'const object = { a: 1 };',
        'const ratio = { b: 2 }/2;',
        '// proves R-ONE-1',
        "test('a real test', () => {});",
        'export { object, ratio };',
        '',
      ),
      line: 2,
      reason: /division/,
    },
    'a declaration above a call the file nests': {
      source: lines(
        'function disabled() {',
        '  // proves R-ONE-1',
        "  test('a test nobody runs', () => {});",
        '}',
        '',
      ),
      line: 2,
      reason: /top level/,
    },
    'a block comment that never closes': {
      source: lines('/* a comment that never closes', '// proves R-ONE-1', "test('a real test', () => {});", ''),
      line: 1,
      reason: /never closes/,
    },
  };

  for (const [shape, { source, line, reason }] of Object.entries(refused)) {
    assert.throws(() => declarationsIn(source, 'test/first.test.mjs'), (error) => {
      assert.match(error.message, /test\/first\.test\.mjs/, shape);
      assert.match(error.message, new RegExp(`line ${line}\\b`), shape);
      assert.match(error.message, reason, shape);
      return true;
    }, `${shape} was not refused`);
  }
});

test('a declaration with code before it on the line is a note, and claims nothing', () => {
  // A declaration is a line comment of its own. One trailing a statement is a note about that
  // statement, and reading it as a claim would have any comment on any line speak for whatever
  // the next line happened to hold.
  const source = lines('const a = 1; // proves R-ONE-1', "test('a real test', () => {});", 'export { a };');

  assert.deepEqual(declarationsIn(source, 'test/first.test.mjs'), []);
});
