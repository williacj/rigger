// ABOUTME: Tests absorption-check as a command: which argument vectors make it do work, what a
// ABOUTME: refused one costs and says, and that the report a working one prints has not moved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'absorption-check.mjs');

/**
 * Run the script as a caller runs it, for the exit code and the two streams.
 *
 * What the acceptance names is the command's exit code, and nothing short of running the
 * command observes that: the defect this file exists over is a module that fell off its own
 * end, which no exported function can be asked about.
 */
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a bare invocation is refused rather than exiting 0 having compared nothing', () => {
  // The defect. A caller reads exit 0 as the check having passed, and it never ran.
  const { status } = run();

  assert.notEqual(status, 0);
});

test('a single document path is refused, because one document compares against nothing', () => {
  const { status } = run('ARCHITECTURE.md');

  assert.notEqual(status, 0);
});

test('--self-test carrying a further argument is refused rather than silently ignoring it', () => {
  // Two forms are accepted and this is neither. A caller who passed a document path alongside
  // --self-test asked for something the script does not do, and watched it self-test instead.
  //
  // Two arguments is also the shape of the two-document form, so this vector is the one that
  // tells whether the arity check alone is enough. An option is not a document path: read as
  // one, it is refused for the wrong reason, as a file nothing answers to, and the caller is
  // told nothing about what the script accepts.
  const { status, stderr } = run('--self-test', 'ARCHITECTURE.md');

  assert.notEqual(status, 0);
  assert.match(stderr, /no such invocation/);
  assert.match(stderr, /<source\.md> <destination\.md>/);
});

test('three document paths are refused rather than comparing the first two', () => {
  // A throw out of the two-document form also exits non-zero, so a bare exit code cannot tell a
  // refusal from an accident. The refusal is what is asserted here.
  const { status, stderr } = run('ARCHITECTURE.md', 'docs/spec/requirements.md', 'README.md');

  assert.notEqual(status, 0);
  assert.match(stderr, /no such invocation/);
});

// Every shape of argument vector that is neither accepted form: too few, too many, an
// unrecognised option, an option where a path belongs, and an option twice over.
const REFUSED = [
  [],
  ['ARCHITECTURE.md'],
  ['--bogus'],
  ['--self-test', 'ARCHITECTURE.md'],
  ['--bogus', '--bogus'],
  ['ARCHITECTURE.md', 'docs/spec/requirements.md', 'README.md'],
];

test('every refused vector names both accepted forms on stderr, and says nothing on stdout', () => {
  // Derived from the acceptance rather than from the script: the two forms are `--self-test`
  // and a pair of document paths, and a caller has to be able to read both off the refusal
  // whichever way the vector was wrong.
  for (const vector of REFUSED) {
    const { status, stdout, stderr } = run(...vector);
    const named = `[${vector.join(' ')}]`;

    assert.notEqual(status, 0, `${named} exited 0`);
    assert.match(stderr, /no such invocation/, `${named} was refused for some other reason`);
    assert.match(stderr, /--self-test/, `${named} left the self-test form unnamed`);
    assert.match(stderr, /<source\.md> <destination\.md>/, `${named} left the two-document form unnamed`);
    assert.equal(stdout, '', `${named} printed on stdout, where a report would sit`);
  }
});

/** A pair of documents on disk: a source to read clauses out of, and a destination table. */
function documents(source, destination) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-absorption-'));
  writeFileSync(join(dir, 'source.md'), source);
  writeFileSync(join(dir, 'destination.md'), destination);
  return dir;
}

/** The heading the two-document form reads its source clauses out of. */
const HEADING = '## Invariants that hold across every layer';

test('the two-document form names the file and the heading when the source section is absent', () => {
  // ARCHITECTURE.md lost this section in 755c809, so this is the state that document is really in.
  // A caller needs to read which file was short of which heading off the failure.
  const dir = documents('# Architecture\n\n## Something else\n\n- A clause.\n', '| R-CARD-1 | A card states its acceptance. |\n');

  const { status, stderr } = run(join(dir, 'source.md'), join(dir, 'destination.md'));

  assert.notEqual(status, 0);
  assert.match(stderr, /source\.md/);
  assert.ok(stderr.includes(HEADING), `the heading it looked for is unnamed: ${stderr}`);
});

test('a missing source section prints no stack trace', () => {
  // `AGENTS.md`, "When you write code", asks for a clear failure. A trace into node:internal is
  // not one, and it is what the module did before: the throw reached the top level unhandled.
  const dir = documents('# Architecture\n\n## Something else\n\n- A clause.\n', '| R-CARD-1 | A card states its acceptance. |\n');

  const { stderr } = run(join(dir, 'source.md'), join(dir, 'destination.md'));

  assert.doesNotMatch(stderr, /^\s+at /m, `a stack frame reached stderr: ${stderr}`);
  assert.doesNotMatch(stderr, /node:internal/);
});

// The two invocations that did work on 65a7de7, and the bytes that script printed for each.
// Recorded from that script rather than from this one, so the expectation is a different
// program's answer: `git show 65a7de7:scripts/absorption-check.mjs` run against the fixtures
// below. This card changes which invocations are accepted, never what a comparison reports.
const SELF_TEST_OUTPUT = [
  'PASS  widened verb: escalates -> reaches',
  '      added: reach, reach',
  'PASS  widened object: verdict -> findings or verdict',
  '      added: another, finding, maker, session',
  '',
].join('\n');

const SOURCE = `# Architecture

${HEADING}

- Nothing escalates to the owner outside the configured escalation set.
- A gate admits nothing on evidence that is missing or stale.

## Something after
`;

const DESTINATION = `| id | requirement |
|---|---|
| R-ESC-1 | Nothing reaches the owner outside the configured escalation set. |
| R-GATE-2 | The gate fails closed. Evidence that is missing, unreadable or stale refuses the attempt. |
`;

const REPORT_OUTPUT = [
  '2 source clauses, 2 destination rows',
  '',
  'SOURCE  Nothing escalates to the owner outside the configured escalation set.',
  '  became  R-ESC-1 (0.86)',
  '  WIDER?  added scope words: reach',
  '  NARROWER?  dropped scope words: escalate',
  '  DROPPED: escalate',
  '',
  'SOURCE  A gate admits nothing on evidence that is missing or stale.',
  '  became  R-GATE-2 (0.67)',
  '  NARROWER?  dropped scope words: admit, nothing',
  '  DROPPED: admit, nothing',
  '',
  '0 clause(s) matched nothing.',
  '',
].join('\n');

const ORPHAN_SOURCE = `# Architecture

${HEADING}

- Sole custody of a kitchen appliance belongs to whoever bought the toaster.

## Something after
`;

const ORPHAN_OUTPUT = [
  '1 source clauses, 2 destination rows',
  '',
  'NOT ABSORBED  Sole custody of a kitchen appliance belongs to whoever bought the toaster.',
  '',
  '1 clause(s) matched nothing.',
  '',
].join('\n');

test('--self-test exits 0 and prints the bytes it printed on 65a7de7', () => {
  const { status, stdout } = run('--self-test');

  assert.equal(status, 0);
  assert.equal(stdout, SELF_TEST_OUTPUT);
});

test('--self-test prints one result line per case', () => {
  // Two cases are written into the script, and a result line is what a reader counts. A case
  // that stopped running would leave the count short while every line printed still read PASS.
  const { stdout } = run('--self-test');

  assert.equal(stdout.split('\n').filter((line) => /^(PASS|FAIL)\b/.test(line)).length, 2);
});

test('the report a working two-document invocation prints is the report 65a7de7 printed', () => {
  const dir = documents(SOURCE, DESTINATION);

  const { status, stdout } = run(join(dir, 'source.md'), join(dir, 'destination.md'));

  assert.equal(stdout, REPORT_OUTPUT);
  assert.equal(status, 0);
});

test('a clause absorbed by nothing still reports as it did on 65a7de7, and still exits 1', () => {
  // The one finding the check reports as a failure. Its exit code is the reason a caller runs it.
  const dir = documents(ORPHAN_SOURCE, DESTINATION);

  const { status, stdout } = run(join(dir, 'source.md'), join(dir, 'destination.md'));

  assert.equal(stdout, ORPHAN_OUTPUT);
  assert.equal(status, 1);
});

test('the file states its accepted invocations in the comment block, above its first export', () => {
  // So a caller learns what to pass by opening the file at the top, rather than reading to the
  // bottom for the dispatch. The preamble ends where the API begins, which is the first export.
  const source = readFileSync(script, 'utf8');
  const preamble = source.slice(0, source.indexOf('\nexport '));

  assert.ok(preamble.includes('--self-test'), 'the self-test form is not stated in the preamble');
  assert.ok(preamble.includes('<source.md> <destination.md>'), 'the two-document form is not stated in the preamble');
});
