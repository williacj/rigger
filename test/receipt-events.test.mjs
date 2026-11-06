// ABOUTME: Parses recorded node:test event streams from two Node versions, through the receipt's
// exported parse, into named tests and file verdicts, and reads the receipt's status from each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
import { gitIn, repositoryAt, worktreeList, removeWorktreeAt } from './git-repository.mjs';
import { failures, mutationReceiptAt, mutationVerdict, noVerdict, parseEvents, restoreSource } from '../scripts/mutation-receipt.mjs';

// Each stream is the unedited output, on the Node its name gives, of this command run at the
// worktree root, where <shape> is the name's last part and the pattern only for `pattern`:
//   RIGGER_RECEIPT_EVENTS=<shape> RIGGER_PROOF_ASSERTION_KEY=recorded sh test/suite.sh
//     --import=./scripts/mutation-receipt.mjs --test-reporter=./scripts/mutation-receipt.mjs
//     [--test-name-pattern='^absent$'] test/fixtures/receipt-events/subject.mjs
//     | sed -n 's/^@@proof //p' | jq -s .
const subject = 'test/fixtures/receipt-events/subject.mjs';

// The suite's exit status as each recording observed it, which the stream itself does not carry.
const exits = { control: 0, mutant: 1, after: 1, load: 1, skip: 0, pattern: 0 };

/** A recorded stream parsed as the receipt parses a run, against the root it was recorded at. */
function recorded(node, shape) {
  const stream = JSON.parse(readFileSync(new URL(`fixtures/receipt-events/node-${node}-${shape}.json`, import.meta.url), 'utf8'));
  const absolute = stream.find((event) => event.data.file?.endsWith(`/${subject}`)).data.file;
  const root = absolute.slice(0, -subject.length - 1);
  return { stream, root, run: { ...parseEvents(stream, root, subject), exit: exits[shape], timedOut: false } };
}

/** The receipt's status for a mutant run, as mutationReceipt reads it. */
const status = (run) => (noVerdict(run) ? 'no verdict' : failures(run).length === 0 ? 'survived' : 'killed');

const named = (run) => failures(run).map(({ name, kind, error }) => ({ name, kind, message: error.message.split('\n')[0] }));

/** Each head test's base outcome, paired by identity as proof:diff pairs them. */
function paired(node) {
  const base = recorded(node, 'mutant').run;
  const head = recorded(node, 'control').run;
  return head.tests.map((test) => {
    const matches = base.tests.filter((candidate) => JSON.stringify(candidate.identity) === JSON.stringify(test.identity));
    return { name: test.name, identity: test.identity, reasons: [test.identityReason, ...matches.map(({ identityReason }) => identityReason)],
      base: matches.map(({ outcome }) => outcome), head: test.outcome };
  });
}

// Each row of the card's tables for the two shapes Node has been measured emitting.
for (const node of ['v26.5.0', 'v26.12.1']) {
  test(`${node}: a mutant that fails named tests is killed, naming each failing test and its assertion`, () => {
    const { run } = recorded(node, 'mutant');
    assert.equal(status(run), 'killed');
    assert.deepEqual(named(run), [
      { name: 'value stays one', kind: 'assertion', message: 'value must stay one' },
      { name: 'subject.mjs', kind: 'assertion', message: 'a test titled after its file' },
      { name: 'inner', kind: 'assertion', message: 'the subtest sees one' },
      { name: 'outer', kind: 'not an assertion', message: "'1 subtest failed'" },
    ]);
  });

  test(`${node}: a mutant every named test survives is survived`, () => {
    const { run } = recorded(node, 'control');
    assert.equal(status(run), 'survived');
    assert.deepEqual(run.tests.map(({ name, outcome }) => [name, outcome]),
      [['value stays one', 'pass'], ['subject.mjs', 'pass'], ['inner', 'pass'], ['outer', 'pass'], ['constant holds', 'pass']]);
  });

  test(`${node}: the file verdict sharing testId, parentId, nesting and file with the first test is a file verdict`, () => {
    const { stream, run } = recorded(node, 'after');
    const enqueued = stream.filter((event) => event.type === 'test:enqueue' && event.data.nesting === 0).map(({ data }) => data);
    const [file, first] = enqueued;
    assert.deepEqual([file.name, first.name], [subject, 'value stays one']);
    for (const key of ['testId', 'parentId', 'nesting', 'file']) assert.equal(file[key], first[key], key);
    assert.deepEqual(run.fileVerdicts.map(({ name, outcome }) => [name, outcome]), [[subject, 'fail']]);
    assert.equal(run.tests.some(({ name }) => name === subject), false);
    assert.equal(run.tests.find(({ name }) => name === 'value stays one').outcome, 'pass');
  });

  test(`${node}: a named test titled after its file's basename is a named test`, () => {
    const { run } = recorded(node, 'control');
    assert.deepEqual(run.tests.filter(({ name }) => name === 'subject.mjs').map(({ line, column }) => [line, column]), [[12, 1]]);
    assert.deepEqual(run.fileVerdicts, []);
  });

  test(`${node}: named verdicts then a file failure thrown after the tests is no verdict, never killed`, () => {
    const { run } = recorded(node, 'after');
    assert.deepEqual(run.fileVerdicts.map(({ details }) => details.error?.failureType), ['testCodeFailure']);
    assert.equal(run.tests.length, 5);
    assert.equal(status(run), 'no verdict');
    assert.match(noVerdict(run), /file verdict/);
  });

  test(`${node}: a file that fails to load is a file verdict and no verdict`, () => {
    const { run } = recorded(node, 'load');
    assert.deepEqual(run.tests, []);
    assert.deepEqual(run.fileVerdicts.map(({ name, outcome }) => [name, outcome]), [[subject, 'fail']]);
    assert.equal(status(run), 'no verdict');
    assert.match(noVerdict(run), /file verdict/);
  });

  test(`${node}: a test red at the base and green at the head pairs by identity, per named test`, () => {
    assert.deepEqual(paired(node), [
      { name: 'value stays one', identity: [subject, [['value stays one', subject, 11, 1]]], reasons: [undefined, undefined], base: ['fail'], head: 'pass' },
      { name: 'subject.mjs', identity: [subject, [['subject.mjs', subject, 12, 1]]], reasons: [undefined, undefined], base: ['fail'], head: 'pass' },
      { name: 'inner', identity: [subject, [['outer', subject, 13, 1], ['inner', subject, 14, 11]]], reasons: [undefined, undefined], base: ['fail'], head: 'pass' },
      { name: 'outer', identity: [subject, [['outer', subject, 13, 1]]], reasons: [undefined, undefined], base: ['fail'], head: 'pass' },
      { name: 'constant holds', identity: [subject, [['constant holds', subject, 16, 1]]], reasons: [undefined, undefined], base: ['pass'], head: 'pass' },
    ]);
  });
}

test('v26.12.1: a nested subtest is a named test identified through its parent', () => {
  const { run } = recorded('v26.12.1', 'mutant');
  const inner = run.tests.find(({ name }) => name === 'inner');
  assert.deepEqual(inner.identity, [subject, [['outer', subject, 13, 1], ['inner', subject, 14, 11]]]);
  assert.equal(inner.identityReason, undefined);
  assert.deepEqual([inner.nesting, inner.outcome], [1, 'fail']);
});

test('v26.12.1: a skipped named test is no verdict', () => {
  const { run } = recorded('v26.12.1', 'skip');
  assert.equal(run.tests.find(({ name }) => name === 'constant holds').skip, true);
  assert.equal(status(run), 'no verdict');
  assert.match(noVerdict(run), /skipped or todo/);
});

test('v26.12.1: a pattern matching no test leaves only the file verdict, which is no verdict', () => {
  const { run } = recorded('v26.12.1', 'pattern');
  assert.deepEqual(run.tests, []);
  assert.deepEqual(run.fileVerdicts.map(({ name, outcome }) => [name, outcome]), [[subject, 'pass']]);
  assert.equal(status(run), 'no verdict');
  assert.match(noVerdict(run), /file verdict/);
});

// A correctly delegated restoration followed by one controlled real edit must fail byte verification.
test('TQ restored lifecycle requires matching original bytes', (t) => {
  const directory = temporaryDirectory('1141-restore-bytes-', { context: t });
  const source = join(directory, 'subject.mjs');
  const originalBytes = 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK';
  const mutantBytes = 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK';
  const original = Buffer.from(originalBytes, 'base64').toString('utf8');
  writeFileSync(source, Buffer.from(mutantBytes, 'base64'));
  assert.equal(readFileSync(source).toString('base64'), mutantBytes, 'the exact owned source must begin ready');
  const realWrite = fs.writeFileSync;
  const realRead = fs.readFileSync;
  const observations = [];
  let interventions = 0;
  let returned;
  let caught;
  let completed = false;
  try {
    t.mock.method(fs, 'writeFileSync', (path, bytes, ...options) => {
      const result = realWrite(path, bytes, ...options);
      if (path === source && interventions === 0) {
        interventions += 1;
        observations.push({ kind: 'delegated-restore', bytes: realRead(source).toString('base64') });
        realWrite(source, Buffer.from('export const value = 2;\n'));
        observations.push({ kind: 'bounded-interference', bytes: realRead(source).toString('base64') });
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      returned = restoreSource(source, original);
      completed = true;
    } catch (error) {
      caught = error;
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  const actualBytes = readFileSync(source).toString('base64');
  const evidence = { source, originalBytes, mutantBytes, interventions, observations, actualBytes, completed,
    returnedType: typeof returned,
    error: caught === undefined ? null : { name: caught.name, message: caught.message, stack: caught.stack, code: caught.code },
    fsWriteRestored: fs.writeFileSync === realWrite, namedWriteRestored: writeFileSync === realWrite };
  t.diagnostic(`ordinary restoration byte observations: ${JSON.stringify(evidence)}`);
  if (process.env.RIGGER_1141_EVIDENCE_ROOT) {
    writeFileSync(join(process.env.RIGGER_1141_EVIDENCE_ROOT, 'byte-observation.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  assert.equal(interventions, 1, 'the exact source must receive one bounded interference');
  assert.deepEqual(observations, [
    { kind: 'delegated-restore', bytes: originalBytes },
    { kind: 'bounded-interference', bytes: mutantBytes },
  ], 'real reads must independently observe the delegated original write then the explicit mutant edit');
  assert.equal(actualBytes, mutantBytes, 'the refusal premise is actual mutant bytes on disk');
  assert.equal(evidence.fsWriteRestored, true);
  assert.equal(evidence.namedWriteRestored, true);
  assert.equal(caught?.message, 'restored source bytes differ from original', 'restoration must refuse the observed byte mismatch');
  assert.equal(caught.name, 'Error');
  assert.equal(completed, false);
});

// An applied semantic candidate cannot retain a verdict after the actual caught restoration reason.
test('TQ restored lifecycle refuses a restoration error', (t) => {
  const control = {
    exit: 0, timedOut: false, fileVerdicts: [], count: 1,
    tests: [{ name: '1141 selected witness', outcome: 'pass',
      identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]],
      details: { type: 'test' } }],
  };
  const killed = {
    exit: 1, timedOut: false, fileVerdicts: [], count: 1,
    tests: [{ name: '1141 selected witness', outcome: 'fail',
      identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]],
      details: { type: 'test', assertion: true,
        error: { failureType: 'testCodeFailure', cause: { name: 'AssertionError', message: '1141 literal value must remain one' } } } }],
  };
  const survived = {
    exit: 0, timedOut: false, fileVerdicts: [], count: 1,
    tests: [{ name: '1141 selected witness', outcome: 'pass',
      identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]],
      details: { type: 'test' } }],
  };
  const reports = [
    { mutated: true, status: 'no verdict', unmutated: structuredClone(control), mutant: killed, reason: '1141 restoration refused' },
    { mutated: true, status: 'no verdict', unmutated: structuredClone(control), mutant: survived, reason: '1141 restoration refused' },
  ];
  const before = structuredClone(reports);
  const actual = reports.map((report) => mutationVerdict(report));
  const evidence = { before, actual, after: reports };
  t.diagnostic(`ordinary lifecycle restoration refusal observations: ${JSON.stringify(evidence)}`);
  if (process.env.RIGGER_1141_EVIDENCE_ROOT) {
    writeFileSync(join(process.env.RIGGER_1141_EVIDENCE_ROOT, 'lifecycle-observation.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  assert.deepEqual(reports, before, 'the actual decision must preserve completed records and absent restored evidence');
  assert.deepEqual(actual, [
    { status: 'no verdict', reason: '1141 restoration refused' },
    { status: 'no verdict', reason: '1141 restoration refused' },
  ], 'a caught restoration reason must refuse both killed and survived candidates');
});

// These producer-shaped answers follow the v26.12.1 control/mutant recordings above.
// Their command/output/events are synthetic; actual source reads and Git observations are separate.
function selectedWitnessRun(mutant) {
  const detail = { type: 'test', assertion: mutant };
  if (mutant) detail.error = { failureType: 'testCodeFailure',
    cause: { name: 'AssertionError', message: '1141 literal value must remain one' } };
  return { exit: mutant ? 1 : 0, timedOut: false, count: 1, fileVerdicts: [],
    command: ['controlled-selected', 'test/cell.test.mjs'],
    stdout: 'synthetic controlled selected producer; no child stdout credit\n', stderr: '', events: [],
    tests: [{ name: '1141 selected witness', outcome: mutant ? 'fail' : 'pass',
      identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]], details: detail }] };
}

/** Builds the fixed committed source and named selection for receipt lifecycle diagnostics. */
function mutationFixture(t, selectedBody = "// ABOUTME: Selects the literal source value through one named assertion.\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../subject.mjs';\ntest('1141 selected witness', () => assert.equal(value, 1, '1141 literal value must remain one'));\n") {
  const original = 'export const value = 1;\n';
  const mutant = 'export const value = 2;\n';
  const directory = temporaryDirectory('1141-write-duty-', { context: t });
  const root = repositoryAt(join(directory, 'repository'), {
    'subject.mjs': original, 'package.json': '{"type":"module"}\n', '.gitignore': 'node_modules/\n',
    'test/cell.test.mjs': selectedBody,
  });
  fs.mkdirSync(join(root, 'node_modules'));
  const scratch = join(directory, 'scratch'); fs.mkdirSync(scratch);
  const head = gitIn(root, 'rev-parse', 'HEAD').trim();
  const context = { root, head, base: head, dependencyChanges: [] };
  const before = { source: readFileSync(join(root, 'subject.mjs'), 'utf8'),
    status: gitIn(root, 'status', '--porcelain'), worktrees: worktreeList(root) };
  return { original, mutant, directory, root, scratch, context, before, observations: [],
    options: { source: 'subject.mjs', anchor: 'value = 1', count: '1', replacement: 'value = 2',
      test: 'test/cell.test.mjs', pattern: '^1141 selected witness$', timeout: 60 } };
}

/** Runs the real receipt over this fixed fixture, observing each requested selected phase. */
async function receiptInFixture(fixture, selected) {
  const prior = process.env.TMPDIR;
  try {
    process.env.TMPDIR = fixture.scratch;
    return await mutationReceiptAt(fixture.context, fixture.options, async (tree, temporary, file, options) => {
      const sourcePath = join(tree, 'subject.mjs');
      const bytes = readFileSync(sourcePath).toString('utf8');
      fixture.observations.push({ tree, temporary, sourcePath, bytes: Buffer.from(bytes).toString('base64'),
        status: gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs') });
      return selected ? selected(tree, temporary, file, options) : selectedWitnessRun(bytes === fixture.mutant);
    });
  } finally {
    if (prior === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prior;
  }
}

/** Compares the caller and owned scratch only after actual lifecycle teardown. */
function assertMutationFixtureClean(fixture) {
  assert.equal(readFileSync(join(fixture.root, 'subject.mjs'), 'utf8'), fixture.before.source);
  assert.equal(gitIn(fixture.root, 'status', '--porcelain'), fixture.before.status);
  assert.equal(worktreeList(fixture.root), fixture.before.worktrees);
  assert.deepEqual(fs.readdirSync(fixture.scratch), []);
  for (const { sourcePath } of fixture.observations) assert.equal(fs.existsSync(sourcePath), false);
}

/** Observes the real lifecycle around one exact, optionally partial, fixture source write. */
async function observedWriteLifecycle(t, partialWrite, unavailableMutant = false) {
  const { original, mutant, root, scratch, context, before } = mutationFixture(t);
  const partial = 'export const val';
  const originalTmp = process.env.TMPDIR;
  const realWrite = fs.writeFileSync;
  const realRead = fs.readFileSync;
  const observations = [];
  let sourcePath, interventions = 0, result;
  const observe = (kind, tree, path) => observations.push({ kind, tree, sourcePath: path,
    bytes: realRead(path).toString('base64'), status: gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs') });
  try {
    process.env.TMPDIR = scratch;
    t.mock.method(fs, 'writeFileSync', (path, bytes, ...options) => {
      if (partialWrite && path === sourcePath && Buffer.from(bytes).toString('utf8') === mutant && interventions === 0) {
        interventions += 1;
        realWrite(path, partial, ...options);
        observe('partial-write', observations[0].tree, path);
        throw new Error('1141 controlled F11a');
      }
      return realWrite(path, bytes, ...options);
    });
    syncBuiltinESMExports();
    result = await mutationReceiptAt(context, {
      source: 'subject.mjs', anchor: 'value = 1', count: '1', replacement: 'value = 2',
      test: 'test/cell.test.mjs', pattern: '^1141 selected witness$', timeout: 60,
    }, async (tree, temporary, file) => {
      assert.equal(file, 'test/cell.test.mjs', 'the selected fixture entry must remain fixed');
      sourcePath ??= join(tree, 'subject.mjs');
      assert.equal(sourcePath, join(tree, 'subject.mjs'), 'all phases must observe the same source');
      const bytes = realRead(sourcePath).toString('utf8');
      observe('selected', tree, sourcePath);
      assert.ok(bytes === original || bytes === mutant, 'controlled producer requires actual O or M source bytes');
      if (unavailableMutant && bytes === mutant) {
        // Context.skip's recorded producer contract withdraws a passing named verdict.
        const skipped = selectedWitnessRun(false);
        skipped.tests[0].skip = '1141 mutant unavailable';
        return skipped;
      }
      return selectedWitnessRun(bytes === mutant);
    });
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (originalTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTmp;
  }
  return { result, interventions, observations, after: {
    source: realRead(join(root, 'subject.mjs')).toString('utf8'), status: gitIn(root, 'status', '--porcelain'),
    worktrees: worktreeList(root), scratch: fs.readdirSync(scratch),
    selectedSourceRemoved: sourcePath !== undefined && !fs.existsSync(sourcePath),
  }, before };
}

// A source write that changes a prefix and then throws still owes literal restoration.
test('TQ restoration duty precedes the write attempt', async (t) => {
  const original = Buffer.from('export const value = 1;\n').toString('base64');
  const mutant = Buffer.from('export const value = 2;\n').toString('base64');
  const partial = Buffer.from('export const val').toString('base64');
  const control = await observedWriteLifecycle(t, false);
  assert.deepEqual(control.observations.map(({ bytes }) => bytes), [original, mutant, original], 'the nonfault premise must complete literal O M O');
  assert.equal(control.result.report.status, 'killed'); assert.equal(control.result.exit, 0);
  const fault = await observedWriteLifecycle(t, true);
  t.diagnostic(`controlled partial-write lifecycle: ${JSON.stringify({ control, fault })}`);
  assert.equal(fault.interventions, 1, 'the real partial write must be reached once');
  assert.equal(fault.result.report.reason, '1141 controlled F11a', 'the initiating boundary fault must be retained');
  assert.equal(fault.result.report.status, 'no verdict'); assert.notEqual(fault.result.exit, 0);
  assert.deepEqual(fault.observations.slice(0, 2).map(({ kind, bytes }) => [kind, bytes]),
    [['selected', original], ['partial-write', partial]], 'the actual original and partial-write premise must be observed');
  assert.deepEqual(fault.observations.map(({ bytes }) => bytes), [original, partial, original],
    'restoration duty must restore the same source after a partial write before cleanup');
  assert.deepEqual(fault.observations.map(({ kind }) => kind), ['selected', 'partial-write', 'selected']);
  assert.equal(fault.observations[2].status, '', 'restored source-only status must be clean');
  assert.equal(fault.result.report.restored.exit, 0, 'the literal restored selection must be green');
  for (const observed of [control, fault]) {
    assert.equal(observed.after.source, observed.before.source, 'caller source must remain untouched');
    assert.equal(observed.after.status, observed.before.status);
    assert.equal(observed.after.worktrees, observed.before.worktrees);
    assert.deepEqual(observed.after.scratch, []);
    assert.equal(observed.after.selectedSourceRemoved, true);
  }
});

// The selected answers follow the existing recorded Node producer contract; no child-run credit.
test('TQ restored verdict requires a successful named restored run', () => {
  const restoredFailure = selectedWitnessRun(true);
  restoredFailure.tests[0].details.error.cause.message = '1141 restored named assertion failed';
  const candidates = [
    { mutant: selectedWitnessRun(true), expected: 'killed' },
    { mutant: selectedWitnessRun(false), expected: 'survived' },
  ];
  for (const { mutant, expected } of candidates) {
    const control = { mutated: true, status: 'no verdict', unmutated: selectedWitnessRun(false),
      mutant, restored: selectedWitnessRun(false) };
    assert.equal(mutationVerdict(control).status, expected, 'the completed restored-green premise must retain its candidate');
    const refused = { ...control, restored: structuredClone(restoredFailure) };
    const before = structuredClone(refused);
    const actual = mutationVerdict(refused);
    assert.equal(actual.status, 'no verdict', 'a failing restored named test must refuse the candidate verdict');
    assert.match(actual.reason, /restored.*fail/i, 'the refusal must name the restored failure');
    assert.deepEqual(refused, before, 'classification must retain the completed phase evidence');
    assert.equal(refused.restored.tests[0].details.error.cause.message, '1141 restored named assertion failed');
  }
});


// A completed candidate cannot stand in for the absent third-phase record.
test('TQ restored verdict requires a recorded restored run', () => {
  const candidates = [
    { mutant: selectedWitnessRun(true), expected: 'killed' },
    { mutant: selectedWitnessRun(false), expected: 'survived' },
  ];
  for (const { mutant, expected } of candidates) {
    const report = { mutated: true, status: 'no verdict', unmutated: selectedWitnessRun(false), mutant };
    const control = { ...report, restored: selectedWitnessRun(false) };
    assert.equal(mutationVerdict(control).status, expected, 'a recorded restored-green premise must retain its candidate');
    assert.equal(Object.hasOwn(report, 'restored'), false, 'the absent-record premise must be explicit');
    const before = structuredClone(report);
    const actual = mutationVerdict(report);
    assert.equal(actual.status, 'no verdict', 'a missing restored run must refuse the candidate verdict');
    assert.match(actual.reason, /restored.*(?:missing|absent|unavailable)/i, 'the refusal must identify the absent restored record');
    assert.deepEqual(report, before, 'classification must not invent or replace phase evidence');
    assert.equal(Object.hasOwn(report, 'restored'), false, 'no restored execution may be invented');
  }
});


// Existing JSON streams and checked exits own these producer fields; added transport metadata is synthetic.
test('TQ restored verdict honors recorded unavailable runs', () => {
  const observedRun = (shape) => ({ ...recorded('v26.12.1', shape).run,
    command: ['controlled-recorded-selected', shape], stdout: 'synthetic transport metadata; recorded JSON is the source\n',
    stderr: '', events: [] });
  const original = observedRun('control');
  assert.equal(original.tests.length, 5, 'the observed original must contain its five named records');
  assert.equal(original.fileVerdicts.length, 0);
  const rows = [
    { shape: 'skip', exit: 0, named: 5, files: 0, reason: /restored.*(?:skip|todo)/i },
    { shape: 'pattern', exit: 0, named: 0, files: 1, reason: /restored.*file verdict/i },
    { shape: 'load', exit: 1, named: 0, files: 1, reason: /restored.*file verdict/i },
    { shape: 'after', exit: 1, named: 5, files: 1, reason: /restored.*file verdict/i },
  ];
  const candidates = [{ mutant: observedRun('mutant'), expected: 'killed' },
    { mutant: observedRun('control'), expected: 'survived' }];
  for (const { mutant, expected } of candidates) {
    const control = { mutated: true, status: 'no verdict', unmutated: original, mutant,
      restored: observedRun('control') };
    assert.equal(mutationVerdict(control).status, expected, 'a recorded available restored-green run must retain its candidate');
    for (const row of rows) {
      const restored = observedRun(row.shape);
      assert.equal(restored.exit, row.exit, `${row.shape}: checked original exit must match`);
      assert.equal(restored.tests.length, row.named, `${row.shape}: named-record premise must match`);
      assert.equal(restored.fileVerdicts.length, row.files, `${row.shape}: file-verdict premise must match`);
      if (row.shape === 'skip') assert.equal(restored.tests.filter((entry) => entry.skip === true).length, 1,
        'the original stream must contain its one explicitly skipped named record');
      if (row.shape === 'after') assert.ok(restored.tests.every((entry) => entry.outcome === 'pass'),
        'the original after-failure stream must retain all five passing named records');
      const report = { ...control, restored };
      const before = structuredClone(report);
      const actual = mutationVerdict(report);
      assert.equal(actual.status, 'no verdict', `${row.shape}: unavailable restored run must refuse candidate verdict`);
      assert.match(actual.reason, row.reason, `${row.shape}: the existing unavailable cause must stay attributable`);
      assert.deepEqual(report, before, `${row.shape}: classification must preserve all original phase evidence`);
    }
  }
});

// A mutant skip cannot bypass restoration or erase the initiating unavailable reason.
test('TQ restored lifecycle preserves initiating no verdict', async (t) => {
  const actual = await observedWriteLifecycle(t, false, true);
  t.diagnostic(`controlled unavailable-mutant lifecycle: ${JSON.stringify(actual)}`);
  assert.equal(actual.interventions, 0, 'no source-write fault may supply this premise');
  assert.deepEqual(actual.observations.map(({ kind, bytes, status }) => ({ kind, bytes, status })), [
    { kind: 'selected', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
    { kind: 'selected', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', status: ' M subject.mjs\n' },
    { kind: 'selected', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
  ], 'same-source O M O and clean restored status must precede cleanup');
  assert.equal(new Set(actual.observations.map(({ sourcePath }) => sourcePath)).size, 1);
  assert.equal(new Set(actual.observations.map(({ tree }) => tree)).size, 1);
  const { report, exit } = actual.result;
  assert.equal(report.unmutated.exit, 0);
  assert.equal(report.mutated, true);
  assert.equal(report.mutant.exit, 0, 'a successful command exit cannot replace the unavailable named verdict');
  assert.equal(report.mutant.tests[0].skip, '1141 mutant unavailable');
  assert.equal(report.mutant.tests[0].outcome, 'pass');
  assert.deepEqual(report.mutant.fileVerdicts, []);
  assert.equal(report.reason, 'mutant: skipped or todo named test');
  assert.equal(report.status, 'no verdict');
  assert.equal(exit, 1, 'successful literal restoration does not change the initiating refusal');
  assert.equal(report.restored.exit, 0);
  assert.deepEqual(report.restored.tests.map(({ name, outcome, identity, skip, todo }) => ({ name, outcome, identity, skip, todo })), [{
    name: '1141 selected witness', outcome: 'pass',
    identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]], skip: undefined, todo: undefined,
  }]);
  assert.deepEqual(report.restored.fileVerdicts, []);
  assert.equal(actual.after.source, actual.before.source, 'caller bytes stay untouched');
  assert.equal(actual.after.status, actual.before.status);
  assert.equal(actual.after.worktrees, actual.before.worktrees);
  assert.deepEqual(actual.after.scratch, []);
  assert.equal(actual.after.selectedSourceRemoved, true);
});

// A refused first readback after the actual full mutant write still owes literal restoration.
test('TQ restoration duty survives readback refusal', async (t) => {
  const realWrite = fs.writeFileSync;
  const realRead = fs.readFileSync;
  const writeDescriptor = Object.getOwnPropertyDescriptor(fs, 'writeFileSync');
  const readDescriptor = Object.getOwnPropertyDescriptor(fs, 'readFileSync');
  const original = 'export const value = 1;\n';
  const mutant = 'export const value = 2;\n';
  const boundary = [];
  let sourcePath;
  let tree;
  let faultUses = 0;
  let fullWrites = 0;
  let restoreWrites = 0;
  let actual;
  let operationFailed = false;
  let operationError;
  const observe = (kind) => boundary.push({ kind, tree, sourcePath,
    bytes: realRead(sourcePath).toString('base64'),
    status: gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs') });
  try {
    Object.defineProperty(fs, 'writeFileSync', { ...writeDescriptor, value: (path, bytes, ...options) => {
      const returned = realWrite(path, bytes, ...options);
      const text = Buffer.from(bytes).toString('utf8');
      if (sourcePath === undefined && text === mutant && typeof path === 'string') {
        const scratch = fs.realpathSync.native(process.env.TMPDIR);
        if (path.startsWith(`${scratch}/rigger-proof-`) && path.endsWith('/tree/subject.mjs')) {
          assert.equal(fs.realpathSync.native(path), path, 'the fault target must be the actual canonical owned source');
          sourcePath = path;
          tree = join(path, '..');
          fullWrites += 1;
          observe('full-mutant-write');
        }
      } else if (path === sourcePath && text === original) {
        restoreWrites += 1;
        observe('literal-restore-write');
      }
      return returned;
    } });
    Object.defineProperty(fs, 'readFileSync', { ...readDescriptor, value: (path, ...options) => {
      if (path === sourcePath && fullWrites === 1 && faultUses === 0) {
        faultUses += 1;
        observe('readback-refused');
        throw new Error('1141 controlled F11b');
      }
      return realRead(path, ...options);
    } });
    syncBuiltinESMExports();
    actual = await observedWriteLifecycle(t, false);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    try {
      t.mock.reset();
      Object.defineProperties(fs, { writeFileSync: writeDescriptor, readFileSync: readDescriptor });
      syncBuiltinESMExports();
    } catch (cleanupError) {
      if (operationFailed) throw new AggregateError([operationError, cleanupError],
        'F11b fixture and fs binding cleanup both failed', { cause: operationError });
      throw cleanupError;
    }
  }
  if (operationFailed) throw operationError;
  t.diagnostic(`controlled readback-refusal lifecycle: ${JSON.stringify({ actual, boundary, fullWrites, faultUses, restoreWrites })}`);
  assert.equal(fullWrites, 1, 'the real full mutant write must complete before the fault');
  assert.equal(faultUses, 1, 'the actual first post-write source read must reach the bounded fault once');
  assert.equal(restoreWrites, 1, 'exactly one real literal restoration must follow the read refusal');
  assert.equal(actual.interventions, 0, 'F11a partial-write interference must remain disabled');
  assert.deepEqual(boundary.map(({ kind, bytes, status }) => ({ kind, bytes, status })), [
    { kind: 'full-mutant-write', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', status: ' M subject.mjs\n' },
    { kind: 'readback-refused', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', status: ' M subject.mjs\n' },
    { kind: 'literal-restore-write', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
  ]);
  assert.deepEqual(actual.observations.map(({ kind, bytes, status }) => ({ kind, bytes, status })), [
    { kind: 'selected', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
    { kind: 'selected', bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
  ], 'only initial and restored named selections may complete around the refused readback');
  assert.deepEqual([...new Set([...actual.observations, ...boundary].map(({ sourcePath }) => sourcePath))], [sourcePath]);
  assert.deepEqual([...new Set([...actual.observations, ...boundary].map(({ tree }) => tree))], [tree]);
  assert.deepEqual([actual.observations[0].bytes, boundary[0].bytes, actual.observations[1].bytes],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK']);
  const { report, exit } = actual.result;
  assert.equal(report.status, 'no verdict');
  assert.equal(exit, 1);
  assert.equal(report.reason, '1141 controlled F11b', 'successful restoration must retain the initiating readback cause');
  assert.equal(report.mutated, false, 'the current applied flag is reached after the refused readback and diff');
  assert.equal(Object.hasOwn(report, 'readBack'), false);
  assert.equal(Object.hasOwn(report, 'diff'), false);
  assert.equal(Object.hasOwn(report, 'mutant'), false, 'a mutant selection never ran');
  for (const phase of ['unmutated', 'restored']) {
    assert.equal(report[phase].exit, 0);
    assert.deepEqual(report[phase].fileVerdicts, []);
    assert.deepEqual(report[phase].tests.map(({ name, outcome, identity, skip, todo }) => ({ name, outcome, identity, skip, todo })), [{
      name: '1141 selected witness', outcome: 'pass',
      identity: ['test/cell.test.mjs', [['1141 selected witness', 'test/cell.test.mjs', 5, 1]]], skip: undefined, todo: undefined,
    }]);
  }
  assert.equal(actual.after.source, actual.before.source);
  assert.equal(actual.after.status, actual.before.status);
  assert.equal(actual.after.worktrees, actual.before.worktrees);
  assert.deepEqual(actual.after.scratch, []);
  assert.equal(actual.after.selectedSourceRemoved, true);
  assert.equal(fs.writeFileSync, realWrite);
  assert.equal(fs.readFileSync, realRead);
});

test('TQ restored lifecycle refuses mismatched bytes and hashes', async (t) => {
  const control = mutationFixture(t);
  const green = await receiptInFixture(control);
  assert.equal(green.report.status, 'killed', 'the unchanged real fixture must first establish its semantic control');
  assertMutationFixtureClean(control);
  const fault = mutationFixture(t);
  let phase = 0;
  const refused = await receiptInFixture(fault, async (tree) => {
    phase += 1;
    if (phase === 3) writeFileSync(join(tree, 'subject.mjs'), fault.mutant);
    return selectedWitnessRun(phase === 2);
  });
  t.diagnostic(`post-selected source evidence: ${JSON.stringify({ green, refused, observations: fault.observations })}`);
  assert.equal(phase, 3);
  assert.deepEqual(fault.observations.map(({ bytes }) => bytes),
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK']);
  assert.equal(refused.report.status, 'no verdict', 'a restored selection that changes the actual source must invalidate a kill');
  assert.equal(refused.exit, 1);
  assert.match(refused.report.reason, /source.*(?:changed|differ|mismatch)/i);
  assert.equal(refused.report.restored.exit, 0, 'the source guard is independent of the passing named result');
  assert.equal(green.report.restoration.preimageHash, '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29');
  assert.equal(green.report.restoration.beforeRunHash, '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29');
  assert.equal(green.report.restoration.afterRunHash, '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29');
  assert.equal(green.report.restoration.status, '');
  assert.equal(refused.report.restoration.afterRunHash, 'f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a');
  assertMutationFixtureClean(fault);
});

test('TQ restored lifecycle refuses dirty and unavailable source evidence', async (t) => {
  const dirty = mutationFixture(t);
  let phase = 0;
  let dirtyStatus;
  const refused = await receiptInFixture(dirty, async (tree) => {
    phase += 1;
    if (phase === 3) {
      gitIn(tree, 'update-index', '--chmod=+x', 'subject.mjs');
      dirtyStatus = gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs');
      assert.match(dirtyStatus, /M/);
      assert.equal(readFileSync(join(tree, 'subject.mjs'), 'utf8'), dirty.original);
    }
    return selectedWitnessRun(phase === 2);
  });
  t.diagnostic(`actual dirty source evidence: ${JSON.stringify({ refused, dirtyStatus, observations: dirty.observations })}`);
  assert.equal(phase, 3);
  assert.equal(refused.report.status, 'no verdict', 'literal bytes alone cannot establish source-only Git cleanliness');
  assert.equal(refused.exit, 1);
  assert.match(refused.report.reason, /source.*(?:status|dirty)/i);
  assert.equal(refused.report.restoration.status, dirtyStatus);
  assert.equal(refused.report.restoration.afterRunHash, '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29');
  assertMutationFixtureClean(dirty);
  for (const fault of ['status', 'hash']) {
    const fixture = mutationFixture(t);
    const execDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'execFileSync');
    const execFileSync = execDescriptor.value;
    const hashDescriptor = Object.getOwnPropertyDescriptor(crypto, 'createHash');
    let selected = 0;
    let used = 0;
    let result;
    try {
      Object.defineProperty(childProcess, 'execFileSync', { ...execDescriptor, value(command, args, options) {
        if (fault === 'status' && selected === 3 && command === 'git' && args[0] === 'status'
          && options.cwd === fixture.observations[0].tree && used === 0) {
          used += 1;
          throw new Error('1141 status unavailable');
        }
        return execFileSync(command, args, { ...options, env: options.env });
      } });
      Object.defineProperty(crypto, 'createHash', { ...hashDescriptor, value(...args) {
        if (fault === 'hash' && selected === 3 && used === 0) {
          used += 1;
          throw new Error('1141 hash unavailable');
        }
        return hashDescriptor.value(...args);
      } });
      syncBuiltinESMExports();
      result = await receiptInFixture(fixture, async () => { selected += 1; return selectedWitnessRun(selected === 2); });
    } finally {
      Object.defineProperty(childProcess, 'execFileSync', execDescriptor);
      Object.defineProperty(crypto, 'createHash', hashDescriptor);
      syncBuiltinESMExports();
    }
    t.diagnostic(`unavailable ${fault} evidence: ${JSON.stringify({ result, used, observations: fixture.observations })}`);
    assert.equal(used, 1);
    assert.equal(result.report.status, 'no verdict');
    assert.equal(result.exit, 1);
    assert.equal(result.report.reason, `1141 ${fault} unavailable`);
    assert.equal(result.report.restored.exit, 0);
    assert.deepEqual(fixture.observations.map(({ bytes }) => bytes),
      ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK']);
    assertMutationFixtureClean(fixture);
  }
});

test('TQ restoration duty survives diff refusal', async (t) => {
  const fixture = mutationFixture(t);
  const descriptor = Object.getOwnPropertyDescriptor(childProcess, 'execFileSync');
  const execFileSync = descriptor.value;
  const fault = [];
  let result;
  try {
    Object.defineProperty(childProcess, 'execFileSync', { ...descriptor, value(command, args, options) {
      if (command === 'git' && args.join('\0') === 'diff\0--\0subject.mjs'
        && options.cwd === fixture.observations[0]?.tree && fault.length === 0) {
        fault.push({ tree: options.cwd, bytes: readFileSync(join(options.cwd, 'subject.mjs')).toString('base64'),
          status: gitIn(options.cwd, 'status', '--porcelain', '--', 'subject.mjs') });
        throw new Error('1141 controlled F11c');
      }
      return execFileSync(command, args, { ...options, env: options.env });
    } });
    syncBuiltinESMExports();
    result = await receiptInFixture(fixture);
  } finally {
    Object.defineProperty(childProcess, 'execFileSync', descriptor);
    syncBuiltinESMExports();
  }
  t.diagnostic(`diff refusal observations: ${JSON.stringify({ result, fault, selected: fixture.observations })}`);
  assert.equal(fault.length, 1);
  assert.equal(fault[0].bytes, 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK');
  assert.equal(fault[0].status, ' M subject.mjs\n');
  assert.deepEqual(fixture.observations.map(({ bytes, status }) => [bytes, status]),
    [['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', '']]);
  assert.equal(result.report.reason, '1141 controlled F11c');
  assert.equal(result.report.status, 'no verdict'); assert.equal(result.exit, 1);
  assert.equal(result.report.readBack, fixture.mutant);
  assert.equal(Object.hasOwn(result.report, 'diff'), false);
  assert.equal(Object.hasOwn(result.report, 'mutant'), false);
  assert.equal(result.report.restored.exit, 0);
  assert.equal(result.report.restoration.afterRunHash, result.report.restoration.preimageHash);
  assert.equal(result.report.restoration.status, '');
  assertMutationFixtureClean(fixture);
});

test('TQ restoration duty survives mutant launch refusal', async (t) => {
  const fixture = mutationFixture(t);
  let attempts = 0;
  let completed = 0;
  const result = await receiptInFixture(fixture, async () => {
    attempts += 1;
    if (attempts === 2) throw new Error('1141 controlled F11d');
    completed += 1;
    return selectedWitnessRun(false);
  });
  t.diagnostic(`selected invocation refusal observations: ${JSON.stringify({ result, attempts, completed, selected: fixture.observations })}`);
  assert.equal(attempts, 3);
  assert.equal(completed, 2, 'attempted mutant invocation supplies no completed named verdict');
  assert.deepEqual(fixture.observations.map(({ bytes, status }) => [bytes, status]), [
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', ' M subject.mjs\n'],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''],
  ]);
  assert.equal(result.report.reason, '1141 controlled F11d');
  assert.equal(result.report.status, 'no verdict'); assert.equal(result.exit, 1);
  assert.equal(result.report.mutated, true);
  assert.equal(Object.hasOwn(result.report, 'mutant'), false);
  assert.equal(result.report.restored.exit, 0);
  assert.equal(result.report.restoration.afterRunHash, result.report.restoration.preimageHash);
  assert.equal(result.report.restoration.status, '');
  assertMutationFixtureClean(fixture);
});

test('TQ restored lifecycle requires unambiguous complete selected identities', () => {
  const { stream, root } = recorded('v26.12.1', 'control');
  const parsed = (events, exit = 0) => ({ ...parseEvents(events, root, subject), exit, timedOut: false,
    command: ['controlled-recording-variant'], stdout: events.map((event) => `@@proof ${JSON.stringify(event)}\n`).join(''),
    stderr: '', events: [] });
  const original = parsed(stream);
  const changed = structuredClone(stream).map((event) => {
    if (event.data.name === 'constant holds') event.data.name = '1141 different witness';
    return event;
  });
  const missing = stream.filter((event) => event.data.name !== 'constant holds');
  const unavailable = structuredClone(stream).map((event) => {
    if (event.data.name === 'constant holds') delete event.data.line;
    return event;
  });
  const extra = stream.filter((event) => event.data.name === 'constant holds').map((event) => {
    const value = structuredClone(event);
    value.data.testId = 114100;
    value.data.name = '1141 additional selection';
    value.data.line = 100;
    return value;
  });
  const duplicate = stream.filter((event) => event.data.name === 'constant holds').map((event) => {
    const value = structuredClone(event); value.data.testId = 114101; return value;
  });
  const rows = [
    { name: 'missing source position', unmutated: original, restored: parsed(unavailable) },
    { name: 'changed identity', unmutated: original, restored: parsed(changed) },
    { name: 'missing selected identity', unmutated: original, restored: parsed(missing) },
    { name: 'added selected identity', unmutated: original, restored: parsed([...stream, ...extra]) },
    { name: 'ambiguous duplicate identity', unmutated: original, restored: parsed([...stream, ...duplicate]) },
    { name: 'duplicate completed identity', unmutated: original, restored: parsed([...stream, ...stream.filter((event) => event.type === 'test:pass' && event.data.name === 'constant holds')]) },
    { name: 'duplicate original completed identity', unmutated: parsed([...stream, ...stream.filter((event) => event.type === 'test:pass' && event.data.name === 'constant holds')]), restored: original },
    { name: 'original identity unavailable', unmutated: parsed(unavailable), restored: original },
    { name: 'original passing outcomes with exit two', unmutated: parsed(stream, 2), restored: original },
  ];
  assert.ok(rows[0].restored.tests.some(({ identity, identityReason }) => identity === undefined && /unavailable/.test(identityReason)));
  assert.ok(rows[4].restored.tests.some(({ identityReason }) => identityReason === 'ambiguous registration identity'));
  const candidates = [{ mutant: recorded('v26.12.1', 'mutant').run, expected: 'killed' },
    { mutant: original, expected: 'survived' }];
  for (const { mutant, expected } of candidates) {
    const control = { mutated: true, status: 'no verdict', unmutated: original, mutant, restored: parsed(stream) };
    assert.equal(mutationVerdict(control).status, expected);
    const reordered = { ...control, restored: { ...control.restored, tests: [...control.restored.tests].reverse() } };
    assert.equal(mutationVerdict(reordered).status, expected, 'complete unique identities are independent of outcome-array order');
    for (const row of rows) {
      const report = { ...control, unmutated: row.unmutated, restored: row.restored };
      const before = structuredClone(report);
      const result = mutationVerdict(report);
      assert.equal(result.status, 'no verdict', `${row.name}: correspondence must be proved before a verdict`);
      assert.match(result.reason, /identit|original|unmutated/i);
      assert.deepEqual(report, before, 'classification preserves all original records');
    }
  }
});

test('TQ restored lifecycle refuses inventory remove and parent cleanup errors', async (t) => {
  for (const boundary of ['inventory', 'remove', 'parent']) {
    const fixture = mutationFixture(t);
    const execDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'execFileSync');
    const execFileSync = execDescriptor.value;
    const rmDescriptor = Object.getOwnPropertyDescriptor(fs, 'rmSync');
    let used = 0;
    let result;
    try {
      Object.defineProperty(childProcess, 'execFileSync', { ...execDescriptor, value(command, args, options) {
        const tree = fixture.observations[0]?.tree;
        if (command === 'git' && options.cwd === fixture.root && used === 0 && (
          boundary === 'inventory' && args.join('\0') === 'worktree\0list\0--porcelain\0-z'
          || boundary === 'remove' && args.join('\0') === ['worktree', 'remove', '--force', tree].join('\0'))) {
          used += 1; throw new Error(`1141 ${boundary} refused`);
        }
        return execFileSync(command, args, { ...options, env: options.env });
      } });
      Object.defineProperty(fs, 'rmSync', { ...rmDescriptor, value(path, options) {
        const tree = fixture.observations[0]?.tree;
        if (boundary === 'parent' && tree && path === join(tree, '..') && used === 0) {
          used += 1; throw new Error('1141 parent refused');
        }
        return rmDescriptor.value(path, options);
      } });
      syncBuiltinESMExports();
      result = await receiptInFixture(fixture);
    } finally {
      Object.defineProperty(childProcess, 'execFileSync', execDescriptor);
      Object.defineProperty(fs, 'rmSync', rmDescriptor);
      syncBuiltinESMExports();
    }
    const tree = fixture.observations[0].tree;
    const parent = join(tree, '..');
    assert.ok(parent.startsWith(`${fs.realpathSync.native(fixture.scratch)}/rigger-proof-`));
    const residual = { worktrees: worktreeList(fixture.root),
      parentExists: fs.existsSync(parent), sourceExists: fs.existsSync(join(tree, 'subject.mjs')) };
    t.diagnostic(`cleanup ${boundary} residual before owned recovery: ${JSON.stringify({ result, used, residual, observations: fixture.observations })}`);
    try {
      assert.equal(used, 1, 'the actual distinct cleanup boundary must be reached once');
      assert.equal(result.report.status, 'no verdict'); assert.equal(result.exit, 1);
      assert.equal(result.report.reason, `1141 ${boundary} refused`);
      assert.equal(result.report.restored.exit, 0);
      assert.equal(result.report.restoration.status, '');
      assert.equal(result.report.restoration.afterRunHash, result.report.restoration.preimageHash);
      assert.deepEqual(fixture.observations.map(({ bytes }) => bytes),
        ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK']);
      assert.equal(residual.parentExists, true);
      assert.equal(residual.worktrees.includes(`worktree ${tree}\n`), boundary !== 'parent');
      assert.equal(residual.sourceExists, boundary !== 'parent');
    } finally {
      if (residual.worktrees.includes(`worktree ${tree}\n`)) removeWorktreeAt(fixture.root, tree, true);
      fs.rmSync(parent, { recursive: true, force: true });
    }
    assertMutationFixtureClean(fixture);
  }
});

test('TQ restored lifecycle retains initiating restoration and cleanup causes', async (t) => {
  const fixture = mutationFixture(t);
  const descriptors = { read: Object.getOwnPropertyDescriptor(fs, 'readFileSync'),
    write: Object.getOwnPropertyDescriptor(fs, 'writeFileSync'), exec: Object.getOwnPropertyDescriptor(childProcess, 'execFileSync') };
  const execFileSync = descriptors.exec.value;
  const faults = [];
  let wrote = false;
  let result;
  try {
    Object.defineProperty(fs, 'writeFileSync', { ...descriptors.write, value(path, bytes, ...options) {
      const source = fixture.observations[0]?.sourcePath;
      if (path === source && wrote && Buffer.from(bytes).toString('utf8') === fixture.original) {
        faults.push('1141 restoration refused'); throw new Error('1141 restoration refused');
      }
      const value = descriptors.write.value(path, bytes, ...options);
      if (path === source && Buffer.from(bytes).toString('utf8') === fixture.mutant) wrote = true;
      return value;
    } });
    Object.defineProperty(fs, 'readFileSync', { ...descriptors.read, value(path, ...options) {
      if (path === fixture.observations[0]?.sourcePath && wrote && faults.length === 0) {
        assert.equal(descriptors.read.value(path, 'utf8'), fixture.mutant);
        faults.push('1141 initiating unavailable'); throw new Error('1141 initiating unavailable');
      }
      return descriptors.read.value(path, ...options);
    } });
    Object.defineProperty(childProcess, 'execFileSync', { ...descriptors.exec, value(command, args, options) {
      if (command === 'git' && options.cwd === fixture.root && args[0] === 'worktree' && args[1] === 'remove') {
        faults.push('1141 removal refused'); throw new Error('1141 removal refused');
      }
      return execFileSync(command, args, { ...options, env: options.env });
    } });
    syncBuiltinESMExports();
    result = await receiptInFixture(fixture);
  } finally {
    Object.defineProperties(fs, { readFileSync: descriptors.read, writeFileSync: descriptors.write });
    Object.defineProperty(childProcess, 'execFileSync', descriptors.exec);
    syncBuiltinESMExports();
  }
  const tree = fixture.observations[0].tree;
  const parent = join(tree, '..');
  const residual = { bytes: readFileSync(join(tree, 'subject.mjs'), 'utf8'),
    status: gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs'),
    worktrees: worktreeList(fixture.root) };
  t.diagnostic(`three actual causes before owned recovery: ${JSON.stringify({ result, faults, residual, observations: fixture.observations })}`);
  try {
    assert.deepEqual(faults, ['1141 initiating unavailable', '1141 restoration refused', '1141 removal refused']);
    assert.equal(residual.bytes, fixture.mutant);
    assert.equal(result.report.status, 'no verdict'); assert.equal(result.exit, 1);
    assert.match(result.report.reason, /1141 initiating unavailable/, 'later failures cannot erase the initiating boundary');
    assert.match(result.report.reason, /1141 restoration refused/);
    assert.match(result.report.reason, /1141 removal refused/);
    assert.equal(Object.hasOwn(result.report, 'mutant'), false);
    assert.equal(Object.hasOwn(result.report, 'restored'), false);
  } finally {
    assert.ok(parent.startsWith(`${fs.realpathSync.native(fixture.scratch)}/rigger-proof-`));
    removeWorktreeAt(fixture.root, tree, true);
    fs.rmSync(parent, { recursive: true, force: true });
  }
  assertMutationFixtureClean(fixture);
});

test('TQ restored source hash is checked before the restored selection', async (t) => {
  const fixture = mutationFixture(t);
  const writeDescriptor = Object.getOwnPropertyDescriptor(fs, 'writeFileSync');
  const readDescriptor = Object.getOwnPropertyDescriptor(fs, 'readFileSync');
  let mutantWritten = false;
  let restoring = false;
  let used = 0;
  let result;
  const interference = [];
  try {
    Object.defineProperty(fs, 'writeFileSync', { ...writeDescriptor, value(path, bytes, ...options) {
      const answer = writeDescriptor.value(path, bytes, ...options);
      if (path === fixture.observations[0]?.sourcePath) {
        if (Buffer.from(bytes).toString('utf8') === fixture.mutant) mutantWritten = true;
        if (mutantWritten && Buffer.from(bytes).toString('utf8') === fixture.original) restoring = true;
      }
      return answer;
    } });
    Object.defineProperty(fs, 'readFileSync', { ...readDescriptor, value(path, ...options) {
      const answer = readDescriptor.value(path, ...options);
      if (restoring && used === 0 && path === fixture.observations[0]?.sourcePath) {
        assert.equal(Buffer.from(answer).toString('utf8'), fixture.original);
        used += 1;
        writeDescriptor.value(path, fixture.mutant);
        interference.push({ sourcePath: path, bytes: readDescriptor.value(path).toString('base64') });
      }
      return answer;
    } });
    syncBuiltinESMExports();
    result = await receiptInFixture(fixture);
  } finally {
    Object.defineProperties(fs, { writeFileSync: writeDescriptor, readFileSync: readDescriptor });
    syncBuiltinESMExports();
  }
  t.diagnostic(`pre-selection hash interference: ${JSON.stringify({ result, used, interference, observations: fixture.observations })}`);
  assert.equal(used, 1);
  assert.equal(interference[0].bytes, 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK');
  assert.equal(result.report.status, 'no verdict'); assert.equal(result.exit, 1);
  assert.equal(Object.hasOwn(result.report, 'restored'), false, 'a mismatching pre-selection hash must refuse before selecting restored tests');
  assert.match(result.report.reason, /hash.*(?:differ|mismatch).*before/i);
  assert.equal(result.report.restoration.beforeRunHash, 'f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a');
  assertMutationFixtureClean(fixture);
});

test('TQ restored lifecycle refuses unavailable restored runs', () => {
  const cases = [
    { name: 'timeout', change: (run) => { run.timedOut = true; } },
    { name: 'empty todo', change: (run) => { run.tests[0].todo = ''; } },
    { name: 'aborted named test', change: (run) => { run.tests[0].outcome = 'fail'; run.exit = 1;
      run.tests[0].details.error = { failureType: 'testAborted', cause: { message: '1141 cancelled' } }; } },
    { name: 'runner refusal', change: (run) => { run.tests[0].outcome = 'fail'; run.exit = 1;
      run.tests[0].details.error = { failureType: 'hookFailed', cause: { message: '1141 runner refused' } }; } },
    { name: 'nonzero without failure', change: (run) => { run.exit = 2; } },
    { name: 'empty named verdicts', change: (run) => { run.tests = []; run.count = 0; } },
  ];
  for (const killed of [true, false]) {
    for (const row of cases) {
      const restored = selectedWitnessRun(false);
      row.change(restored);
      const report = { mutated: true, status: 'no verdict', unmutated: selectedWitnessRun(false),
        mutant: selectedWitnessRun(killed), restored };
      const before = structuredClone(report);
      const result = mutationVerdict(report);
      assert.equal(result.status, 'no verdict', row.name);
      assert.match(result.reason, /^restored:/);
      assert.deepEqual(report, before);
    }
  }
});

test('TQ restored lifecycle applies guards to survived verdicts', async (t) => {
  const fixture = mutationFixture(t, "// ABOUTME: Observes a constant named assertion while the source changes.\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../subject.mjs';\ntest('1141 selected witness', () => assert.equal(21, 21));\n");
  const result = await receiptInFixture(fixture, async () => selectedWitnessRun(false));
  t.diagnostic(`survived real-source lifecycle: ${JSON.stringify({ result, observations: fixture.observations })}`);
  assert.equal(result.report.status, 'survived'); assert.equal(result.exit, 0);
  assert.deepEqual(fixture.observations.map(({ bytes, status }) => [bytes, status]), [
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', ' M subject.mjs\n'],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''],
  ]);
  assert.equal(result.report.restored.exit, 0);
  assert.equal(result.report.restoration.afterRunHash, result.report.restoration.preimageHash);
  assert.equal(result.report.restoration.status, '');
  assertMutationFixtureClean(fixture);
});
