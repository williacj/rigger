// ABOUTME: Parses recorded node:test event streams from two Node versions, through the receipt's
// exported parse, into named tests and file verdicts, and reads the receipt's status from each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failures, noVerdict, parseEvents } from '../scripts/mutation-receipt.mjs';

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
