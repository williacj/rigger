// ABOUTME: Exercises guarded mutation receipts against disposable Git repositories and the real suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { forgeBody, invoke, mutationArgs, proofRepository } from './proof-repository.mjs';
import { SETTLES_WITHIN } from './settles-within.mjs';
import { gitIn, worktreeList, unlockWorktreeAt, removeWorktreeAt } from './git-repository.mjs';
import { existsSync, readFileSync, realpathSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { noVerdict, parseEvents, runTests } from '../scripts/mutation-receipt.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { until, shellQuote } from './process-fixtures.mjs';

const script = fileURLToPath(new URL('../scripts/mutation-receipt.mjs', import.meta.url));

// The inner harness must install its own refusal, not borrow the outer suite's PATH.
test('mutation receipt uses the host suite and refuses a real forge call', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { host: true, body: forgeBody });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.mutated, false);
  assert.equal(report.status, 'no verdict');
  assert.deepEqual(report.unmutated.command.slice(0, 3), ['sh', 'test/suite.sh', '--host']);
  assert.match(report.unmutated.stderr, /these tests called gh.*refused/s);
  assert.match(report.unmutated.stdout, /forge refused/);
});

// Literal replacement must preserve newlines, quotes and replacement-language metacharacters.
test('all matching anchors are replaced literally including newline and dollar characters', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 1;\n// marker $&\n// marker $&\n' });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', ['--source', 'subject.mjs', '--anchor', 'marker $&\n', '--count', '2', '--replacement', 'changed "$&"\n', '--test', fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.anchor.found, 2);
  assert.equal(report.readBack, 'export const value = 1;\n// changed "$&"\n// changed "$&"\n');
  assert.equal(report.status, 'survived');
});

// Git's required smudge filter supplies an actual checkout failure, not a mock error string.
test('A10 a worktree checkout failure names its cause and leaves nothing behind', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { headFiles: { '.gitattributes': 'subject.mjs filter=receipt\n' } });
  gitIn(fixture.root, 'config', 'filter.receipt.smudge', 'false');
  gitIn(fixture.root, 'config', 'filter.receipt.required', 'true');
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.mutated, false);
  assert.match(report.reason, /filter.*receipt|smudge/i);
  assert.equal(report.head, fixture.headSha);
  assert.equal(report.base, fixture.baseSha);
});

// A mutant deadline must be named separately from a reduced test count.
test('A9 a mutant run past its timeout has no verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "import { MessageChannel } from 'node:worker_threads';\ntest('may hang', () => value === 2 ? new Promise(() => { new MessageChannel().port1.on('message', () => {}); }) : undefined);\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture, ['--timeout', '2']));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.unmutated.exit, 0);
  assert.equal(report.mutated, true);
  assert.match(report.reason, /timeout/);
});

// An aborted runner signal cancels the test without an assertion verdict.
test('A8 a cancelled mutant test gives no verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('may cancel', { signal: value === 2 ? AbortSignal.abort(new Error('cancelled fixture')) : undefined }, () => {});\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.match(report.reason, /cancel/);
});

// A skipped named test supplies no assertion verdict.
test('A8 a skipped mutant test gives no verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('may skip', { skip: value === 2 }, () => {});\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.match(report.reason, /skip/);
});

// A loading failure can preserve the count while replacing the named assertion with a file.
test('A7 a file failure without an assertion is no verdict even with equal counts', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t);
  const args = mutationArgs(fixture);
  args[args.indexOf('--replacement') + 1] = "value = (() => { throw new Error('import broke'); })()";
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', args);
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.unmutated.count, report.mutant.count);
  assert.match(report.reason, /file/);
});

// Losing a registered test must not turn the remainder's pass into survival.
test('A7 fewer mutant tests gives no verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('always registered', () => {});\nif (value === 1) test('disappears', () => {});\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.unmutated.count, 2);
  assert.equal(report.mutant.count, 1);
  assert.match(report.reason, /fewer/);
});

// A pre-existing red is not evidence about a later mutation.
test('A6 a failing unmutated test prevents mutation', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('already red', () => assert.fail('control failure'));\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.mutated, false);
  assert.match(report.reason, /unmutated/);
});

// Zero selected tests cannot demonstrate either survival or a discriminating failure.
test('A5 a pattern matching no test has no verdict and never mutates', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t);
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture, ['--test-name-pattern', '^absent$']));
  assert.notEqual(exit, 0);
  assert.equal(report.status, 'no verdict');
  assert.equal(report.mutated, false);
  assert.equal(report.mutant, undefined);
  assert.match(report.reason, /no.*test/i);
});

// Neither an absent nor an unexpectedly duplicated anchor may reach the mutation run.
test('A4 a mismatched anchor count did not apply and changes nothing', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t);
  for (const extra of [['--count', '2'], ['--anchor', 'absent anchor']]) {
    const args = mutationArgs(fixture);
    args[args.indexOf(extra[0]) + 1] = extra[1];
    const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', args);
    assert.notEqual(exit, 0);
    assert.equal(report.status, 'did not apply');
    assert.equal(report.mutated, false);
    assert.equal(report.mutant, undefined);
  }
});

// Changing an unobserved value is a surviving mutation, never a killed one.
test('A3 a mutation all named tests pass is reported as survived', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('constant assertion', () => assert.equal(3 * 7, 21));\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(exit, 0);
  assert.equal(report.status, 'survived');
  assert.deepEqual(report.failures, []);
  for (const [phase, exit] of [['unmutated', 0], ['mutant', 0], ['restored', 0]]) {
    const selected = report[phase];
    assert.equal(selected.exit, exit, `${phase}: retain the actual selected exit`);
    assert.equal(selected.timedOut, false, `${phase}: retain the actual timeout answer`);
    assert.ok(Number.isSafeInteger(selected.process?.group) && selected.process.group > 0, `${phase}: retain the selected group leader`);
    assert.ok(Number.isFinite(selected.process.started), `${phase}: retain the OS start answer`);
  }
});

// A thrown application error is evidence, but must never be labelled an assertion.
test('A2 a named non-assertion error keeps its class and message', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('throws type error', () => { if (value === 2) throw new TypeError('semantic failure'); });\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(exit, 0);
  assert.equal(report.failures[0].name, 'throws type error');
  assert.equal(report.failures[0].error.name, 'TypeError');
  assert.equal(report.failures[0].error.message, 'semantic failure');
  assert.equal(report.failures[0].kind, 'not an assertion');
});

// A caller must be able to discover the deadline before starting a proof.
test('mutation usage names its timeout default', () => {
  const ran = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /--timeout <seconds>.*default: 60/);
});

// A literal source mutation must be witnessed by the named assertion, with both runs counted.
test('A1 a matching anchor produces a named assertion receipt', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t);
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(exit, 0);
  assert.equal(report.status, 'killed');
  assert.equal(report.anchor.found, 1);
  assert.equal(report.readBack, 'export const value = 2;\n');
  assert.match(report.diff, /\+export const value = 2;/);
  assert.equal(report.unmutated.count, 1);
  assert.equal(report.mutant.count, 1);
  assert.equal(report.failures[0].name, 'value stays one');
  assert.match(report.failures[0].error.message, /value must stay one/);
  assert.equal(report.failures[0].error.name, 'AssertionError');
  for (const [phase, exit] of [['unmutated', 0], ['mutant', 1], ['restored', 0]]) {
    const selected = report[phase];
    assert.equal(selected.exit, exit, `${phase}: retain the actual selected exit`);
    assert.equal(selected.timedOut, false, `${phase}: retain the actual timeout answer`);
    assert.ok(Number.isSafeInteger(selected.process?.group) && selected.process.group > 0, `${phase}: retain the selected group leader`);
    assert.ok(Number.isFinite(selected.process.started), `${phase}: retain the OS start answer`);
  }
});

// A real pending test, with an active port rather than a sleep, exercises the run's deadline.
test('A9 an unmutated run past its timeout has no verdict and changes nothing', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "import { MessageChannel } from 'node:worker_threads';\ntest('pending deadline', () => new Promise(() => { new MessageChannel().port1.on('message', () => {}); }));\n" });
  const { exit, report } = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture, ['--timeout', '1']));
  assert.notEqual(exit, 0);
  assert.equal(report?.status, 'no verdict');
  assert.match(report.reason, /timeout/);
  assert.equal(report.mutated, false);
  assert.equal(report.head, fixture.headSha);
  assert.equal(report.base, fixture.baseSha);
  assert.match(report.check4, /maker.*state/);
});

// Assertion-looking fields must not substitute for the original worker's runtime class check.
test('R3 forged assertion fields remain ordinary errors in both tools', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('copied assertion fields', () => { if (value === 2) { const error = Object.assign(new Error('ordinary application error'), { name: 'AssertionError', code: 'ERR_ASSERTION', actual: 1, expected: 2 }); assert.equal(error instanceof assert.AssertionError, false); throw error; } });\ntest('genuine assertion', () => assert.equal(value, 1, 'real assertion'));\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.report.unmutated.count, 2);
  assert.equal(receipt.report.mutant.count, 2);
  assert.deepEqual(receipt.report.failures.map(({ kind }) => kind), ['not an assertion', 'assertion']);
  assert.equal(receipt.report.failures[0].error.message, 'ordinary application error');
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.deepEqual(proof.report.tests.map(({ status }) => status), ['no verdict at the base', 'proves']);
});

// Node retains an empty todo reason as an empty string, which still withdraws the verdict.
test('R3 todo with an empty reason supplies no verdict in either tool', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('empty todo', (context) => { if (value === 2) context.todo(''); assert.equal(value, 1); });\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.report.mutant.tests[0].todo, '');
  assert.notEqual(receipt.exit, 0);
  assert.equal(receipt.report.status, 'no verdict');
  assert.match(receipt.report.reason, /todo/);
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /todo/);
});

// Calling skip with an empty reason still marks the result as skipped in Node's event stream.
test('R3 skip with an empty reason supplies no verdict in either tool', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('empty skip', (context) => { if (value === 2) context.skip(''); assert.equal(value, 1); });\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.report.mutant.tests[0].skip, '');
  assert.notEqual(receipt.exit, 0);
  assert.equal(receipt.report.status, 'no verdict');
  assert.match(receipt.report.reason, /skip/);
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /skip/);
});

// A failed hook can carry a genuine AssertionError while preventing the test body from running.
test('R3 a hook assertion is an unavailable test rather than a mutation kill', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "import { before } from 'node:test';\nbefore(() => { if (value === 2) assert.fail('setup assertion blocked body'); });\ntest('constant after hook', () => assert.equal(6 * 7, 42));\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.report.mutant.tests[0].details.error.failureType, 'hookFailed');
  assert.notEqual(receipt.exit, 0);
  assert.equal(receipt.report.status, 'no verdict');
  assert.match(receipt.report.reason, /hookFailed.*setup assertion blocked body/s);
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /hookFailed.*setup assertion blocked body/s);
});

// A null throw has no Error fields, but must retain its type without borrowing the wrapper's class.
test('R3 a non-Error null throw stays diagnostic and cannot prove', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('throws null', () => { if (value === 2) throw null; assert.equal(6 * 7, 42); });\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.report.failures[0].kind, 'not an assertion');
  assert.equal(receipt.report.failures[0].error.name, 'object');
  assert.equal(receipt.report.failures[0].error.message, 'null');
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /object.*null/);
});

// A named test may start yet fail to load its prerequisite before its constant assertion.
test('R3 a named load failure is diagnostic without assertion credit', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('loads prerequisite', async () => { if (value === 2) await import('../unavailable.mjs'); assert.equal(6 * 7, 42); });\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.report.failures[0].error.code, 'ERR_MODULE_NOT_FOUND');
  assert.equal(receipt.report.failures[0].kind, 'not an assertion');
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /ERR_MODULE_NOT_FOUND.*unavailable\.mjs/s);
});

// A runner deadline ends the test before an assertion; after() closes the real active port.
test('R3 a runner timeout is unavailable rather than assertion evidence', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "import { MessageChannel } from 'node:worker_threads';\ntest('runner deadline', { timeout: 100 }, (context) => { if (value !== 2) return; const channel = new MessageChannel(); channel.port1.on('message', () => {}); context.after(() => { channel.port1.close(); channel.port2.close(); }); return new Promise(() => {}); });\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture, ['--timeout', '2']));
  assert.equal(receipt.report.mutant.tests[0].details.error.failureType, 'testTimeoutFailure');
  assert.notEqual(receipt.exit, 0);
  assert.equal(receipt.report.status, 'no verdict');
  assert.match(receipt.report.reason, /cancel/);
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file, '--timeout', '2']);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /cancel/);
});

// Even an AssertionError used as the abort reason belongs to cancellation, not to the body.
test('R3 a cancelled test with an assertion cause supplies no verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('cancelled before body', { signal: value === 2 ? AbortSignal.abort(new assert.AssertionError({ message: 'assertion-shaped abort' })) : undefined }, () => assert.equal(6 * 7, 42));\n",
  });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.report.mutant.tests[0].details.error.failureType, 'testAborted');
  assert.notEqual(receipt.exit, 0);
  assert.equal(receipt.report.status, 'no verdict');
  assert.match(receipt.report.reason, /cancel/);
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests[0].status, 'no verdict at the base');
  assert.match(proof.report.tests[0].baseReason, /cancel/);
});

// The closed defaults cover unfamiliar thrown values and runner failures, not only named examples.
test('R3 closing catch-all refuses unknown values and non-test runner failures', SETTLES_WITHIN[60_000], async (t) => {
  const body = "const cycle = {}; cycle.self = cycle;\nconst thrown = [undefined, false, 0, 1n, 'unknown text', Symbol('unknown symbol'), { name: 'AssertionError', code: 'ERR_ASSERTION', actual: 1, expected: 2, assertion: true }, cycle];\nfor (const [index, error] of thrown.entries()) test('unknown value ' + index, () => { if (value === 2) throw error; assert.equal(6 * 7, 42); });\n";
  const fixture = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n', body });
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.report.failures.length, 8);
  assert.ok(receipt.report.failures.every(({ kind, error }) => kind === 'not an assertion' && typeof error.message === 'string'));
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.tests.length, 8);
  assert.ok(proof.report.tests.every(({ status, baseReason }) => status === 'no verdict at the base' && /testCodeFailure/.test(baseReason)));
  const unexpected = proofRepository(t, { base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    body: "test('unexpected runner outcome', { expectFailure: value === 2 }, () => {});\n",
  });
  const runner = await invoke(unexpected, 'mutation-receipt.mjs', mutationArgs(unexpected));
  assert.equal(runner.report.mutant.tests[0].details.error.failureType, 'expectedFailure');
  assert.notEqual(runner.exit, 0);
  assert.equal(runner.report.status, 'no verdict');
  assert.match(runner.report.reason, /non-test failure expectedFailure/);
  const runnerProof = await invoke(unexpected, 'proof-diff.mjs', [unexpected.file]);
  assert.equal(runnerProof.exit, 0);
  assert.equal(runnerProof.report.tests[0].status, 'no verdict at the base');
  assert.match(runnerProof.report.tests[0].baseReason, /expectedFailure/);
});

// The receipt's own run and the recorded-stream tests must share one parse, or a fixture proves a copy.
test('runTests books its run through the exported parse the recorded streams are parsed by', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { body: "test('named before a late throw', () => assert.equal(6 * 7, 42));\nsetImmediate(() => { throw new Error('thrown after the tests'); });\n" });
  const tree = realpathSync.native(fixture.root);
  const ran = await runTests(tree, fixture.tmp, fixture.file);
  const stream = ran.stdout.split('\n').filter((line) => line.startsWith('@@proof ')).map((line) => JSON.parse(line.slice(8)));
  assert.deepEqual(ran.tests.map(({ name, outcome }) => [name, outcome]), [['named before a late throw', 'pass']]);
  assert.deepEqual(ran.fileVerdicts.map(({ name, outcome }) => [name, outcome]), [[fixture.file, 'fail']]);
  const { count, tests, fileVerdicts } = ran;
  assert.deepEqual({ count, tests, fileVerdicts }, parseEvents(stream, tree, fixture.file));
});

const restorationWitness = "// ABOUTME: Observes fixture source bytes and ordered selected executions outside disposable roots.\nimport { appendFileSync, readFileSync, realpathSync } from 'node:fs';\nimport { execFileSync } from 'node:child_process';\nimport { fileURLToPath } from 'node:url';\nimport { dirname } from 'node:path';\nimport { gitEnvironment } from '../src/substrate/git-environment.mjs';\nexport const sourcePath = realpathSync(fileURLToPath(new URL('../subject.mjs', import.meta.url)));\nexport const tree = dirname(sourcePath);\nconst journal = process.env.RIGGER_1141_JOURNAL;\nexport function observe(extra = {}) {\n  const prior = readFileSync(journal, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);\n  const phase = prior.filter((record) => record.kind === 'selected').length + 1;\n  const bytes = readFileSync(sourcePath);\n  const status = execFileSync('git', ['-C', tree, 'status', '--porcelain', '--', 'subject.mjs'], { encoding: 'utf8', env: gitEnvironment() });\n  appendFileSync(journal, JSON.stringify({ kind: 'selected', phase, tree, sourcePath, bytes: bytes.toString('base64'), status, ...extra }) + '\\n');\n  return phase;\n}\nexport function record(extra) {\n  appendFileSync(journal, JSON.stringify(extra) + '\\n');\n}\n";

// D29 reason: wiring. Ordinary counterpart: TQ restored lifecycle requires matching original bytes.
// The selected processes observe literal source bytes before the disposable tree is removed.
test('TQ restoration source bytes follow original mutant original', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, {
    body: "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n",
    headFiles: { 'test/1141-witness.mjs': restorationWitness },
  });
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT;
  const journal = join(evidence ?? fixture.directory, 'selected.jsonl');
  assert.equal(existsSync(journal), false, 'the independent journal must start absent');
  writeFileSync(journal, '');
  const ran = await invoke(fixture, 'mutation-receipt.mjs',
    mutationArgs(fixture, ['--test-name-pattern', '^1141 selected witness$']), { RIGGER_1141_JOURNAL: journal });
  if (evidence) {
    writeFileSync(join(evidence, 'inner.stdout'), ran.stdout);
    writeFileSync(join(evidence, 'inner.stderr'), ran.stderr);
    writeFileSync(join(evidence, 'inner-result.json'), JSON.stringify({ exit: ran.exit, timedOut: ran.timedOut, report: ran.report }, null, 2) + '\n');
  }
  const { report } = ran;
  const identity = [fixture.file, [['1141 selected witness', fixture.file, 5, 1]]];
  assert.equal(report.unmutated.exit, 0, 'the named control must be green');
  assert.deepEqual(report.unmutated.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
    [{ name: '1141 selected witness', outcome: 'pass', identity }]);
  assert.equal(report.unmutated.tests[0].skip, undefined);
  assert.equal(report.unmutated.tests[0].todo, undefined);
  assert.deepEqual(report.unmutated.fileVerdicts, []);
  assert.notEqual(report.mutant.exit, 0, 'the mutant must reach its named semantic assertion');
  assert.deepEqual(report.mutant.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
    [{ name: '1141 selected witness', outcome: 'fail', identity }]);
  assert.equal(report.mutant.tests[0].details.assertion, true);
  assert.deepEqual(report.mutant.fileVerdicts, []);
  assert.equal(report.failures[0].kind, 'assertion');
  assert.match(report.failures[0].error.message, /1141 literal value must remain one/);
  const records = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  t.diagnostic(`ordered independent source observations: ${JSON.stringify(records)}`);
  const original = Buffer.from('export const value = 1;\n').toString('base64');
  const mutant = Buffer.from('export const value = 2;\n').toString('base64');
  assert.deepEqual(records.slice(0, 2).map(({ bytes }) => bytes), [original, mutant], 'the real source must first be original then mutant');
  assert.equal(records[0].status, '');
  assert.equal(records[1].status, ' M subject.mjs\n');
  assert.ok(records[0].tree.startsWith(`${realpathSync(fixture.tmp)}/rigger-proof-`));
  assert.deepEqual([...new Set(records.map(({ tree }) => tree))], [records[0].tree]);
  assert.deepEqual([...new Set(records.map(({ sourcePath }) => sourcePath))], [join(records[0].tree, 'subject.mjs')]);
  assert.deepEqual(records.map(({ bytes }) => bytes), [original, mutant, original], 'the same source must be observed original mutant original before cleanup');
  assert.deepEqual(records.map(({ kind, phase }) => ({ kind, phase })),
    [{ kind: 'selected', phase: 1 }, { kind: 'selected', phase: 2 }, { kind: 'selected', phase: 3 }]);
  assert.equal(records[2].status, '');
  assert.equal(report.restored.exit, 0);
  assert.deepEqual(report.restored.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
    [{ name: '1141 selected witness', outcome: 'pass', identity }]);
  assert.deepEqual(report.restored.fileVerdicts, []);
  assert.equal(report.restored.tests[0].skip, undefined);
  assert.equal(report.restored.tests[0].todo, undefined);
  assert.equal(ran.exit, 0);
  assert.equal(report.status, 'killed');
});

// D29 reason: wiring. Ordinary counterpart: TQ restored lifecycle refuses a restoration error.
// The selected mutant creates the recorded real directory that refuses the actual restoration write.
test('TQ restoration guard failure invalidates killed verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, {
    body: "import { mkdirSync, rmSync, statSync } from 'node:fs';\nimport { observe, record, sourcePath } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  if (value === 2) {\n    rmSync(sourcePath);\n    mkdirSync(sourcePath);\n    record({ kind: 'blocked-source', sourcePath, directory: statSync(sourcePath).isDirectory() });\n  }\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n",
    headFiles: { 'test/1141-witness.mjs': restorationWitness },
  });
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT;
  const journal = join(evidence ?? fixture.directory, 'F4-selected.jsonl');
  assert.equal(existsSync(journal), false, 'the real refusal journal must start absent');
  writeFileSync(journal, '');
  const ran = await invoke(fixture, 'mutation-receipt.mjs',
    mutationArgs(fixture, ['--test-name-pattern', '^1141 selected witness$']), { RIGGER_1141_JOURNAL: journal });
  if (evidence) {
    writeFileSync(join(evidence, 'inner.stdout'), ran.stdout);
    writeFileSync(join(evidence, 'inner.stderr'), ran.stderr);
    writeFileSync(join(evidence, 'inner-result.json'), JSON.stringify({ exit: ran.exit, timedOut: ran.timedOut, report: ran.report }, null, 2) + '\n');
  }
  const { report } = ran;
  const identity = [fixture.file, [['1141 selected witness', fixture.file, 6, 1]]];
  assert.equal(report.unmutated.exit, 0);
  assert.deepEqual(report.unmutated.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
    [{ name: '1141 selected witness', outcome: 'pass', identity }]);
  assert.deepEqual(report.unmutated.fileVerdicts, []);
  assert.notEqual(report.mutant.exit, 0);
  assert.deepEqual(report.mutant.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
    [{ name: '1141 selected witness', outcome: 'fail', identity }]);
  assert.equal(report.mutant.tests[0].details.assertion, true);
  assert.deepEqual(report.mutant.fileVerdicts, []);
  assert.equal(report.failures[0].kind, 'assertion');
  assert.match(report.failures[0].error.message, /1141 literal value must remain one/);
  const records = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  t.diagnostic(`ordered real restoration-refusal observations: ${JSON.stringify(records)}`);
  assert.deepEqual(records.slice(0, 2).map(({ kind, phase, bytes }) => ({ kind, phase, bytes })), [
    { kind: 'selected', phase: 1, bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK' },
    { kind: 'selected', phase: 2, bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK' },
  ]);
  assert.equal(records.length, 3);
  assert.equal(records[0].status, '');
  assert.equal(records[1].status, ' M subject.mjs\n');
  assert.equal(records[0].tree, records[1].tree);
  assert.equal(records[0].sourcePath, join(records[0].tree, 'subject.mjs'));
  assert.equal(records[1].sourcePath, records[0].sourcePath);
  assert.deepEqual(records[2], { kind: 'blocked-source', sourcePath: records[0].sourcePath, directory: true });
  assert.ok(records[0].tree.startsWith(`${realpathSync(fixture.tmp)}/rigger-proof-`));
  assert.match(report.reason, /EISDIR/);
  assert.ok(report.reason.includes(records[0].sourcePath), 'the actual filesystem refusal must name that recorded source');
  assert.equal(report.mutated, true);
  assert.equal(Object.hasOwn(report, 'restored'), false, 'no restored execution occurred after the real write refusal');
  assert.equal(report.status, 'no verdict');
  assert.notEqual(ran.exit, 0);
});

// D29 reason: wiring. Ordinary counterpart: TQ restored lifecycle preserves initiating no verdict.
// The real selected mutant withdraws its verdict while the same source still owes restoration.
test('TQ unavailable mutant still restores its source', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, {
    body: "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', (context) => {\n  observe();\n  if (value === 2) context.skip('1141 mutant unavailable');\n  assert.equal(21, 21);\n});\n",
    headFiles: { 'test/1141-witness.mjs': restorationWitness },
  });
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT;
  const journal = join(evidence ?? fixture.directory, 'S3-selected.jsonl');
  assert.equal(existsSync(journal), false, 'the independent S3 journal must start absent');
  writeFileSync(journal, '');
  const ran = await invoke(fixture, 'mutation-receipt.mjs',
    mutationArgs(fixture, ['--test-name-pattern', '^1141 selected witness$']), { RIGGER_1141_JOURNAL: journal });
  if (evidence) {
    writeFileSync(join(evidence, 'inner.stdout'), ran.stdout);
    writeFileSync(join(evidence, 'inner.stderr'), ran.stderr);
    writeFileSync(join(evidence, 'inner-result.json'), JSON.stringify({ exit: ran.exit, timedOut: ran.timedOut, report: ran.report }, null, 2) + '\n');
  }
  const records = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  t.diagnostic(`ordered real unavailable-mutant observations: ${JSON.stringify(records)}`);
  assert.deepEqual(records.map(({ kind, phase, bytes, status }) => ({ kind, phase, bytes, status })), [
    { kind: 'selected', phase: 1, bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
    { kind: 'selected', phase: 2, bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', status: ' M subject.mjs\n' },
    { kind: 'selected', phase: 3, bytes: 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', status: '' },
  ]);
  assert.ok(records[0].tree.startsWith(`${realpathSync(fixture.tmp)}/rigger-proof-`));
  assert.deepEqual([...new Set(records.map(({ tree }) => tree))], [records[0].tree]);
  assert.deepEqual([...new Set(records.map(({ sourcePath }) => sourcePath))], [join(records[0].tree, 'subject.mjs')]);
  assert.equal(existsSync(records[0].sourcePath), false, 'the observed source must be removed only after its restored observation');
  const { report } = ran;
  const identity = [fixture.file, [['1141 selected witness', fixture.file, 5, 1]]];
  assert.equal(ran.timedOut, false);
  assert.equal(report.mutated, true);
  assert.equal(report.status, 'no verdict');
  assert.equal(ran.exit, 1);
  assert.equal(report.reason, 'mutant: skipped or todo named test');
  assert.deepEqual([report.unmutated.exit, report.mutant.exit, report.restored.exit], [0, 0, 0]);
  for (const phase of ['unmutated', 'mutant', 'restored']) {
    const run = report[phase];
    assert.deepEqual(run.command.slice(0, 2), ['sh', 'test/suite.sh']);
    assert.ok(run.command.includes('--test-name-pattern=^1141 selected witness$'));
    assert.equal(run.command.at(-1), fixture.file);
    assert.equal(run.timedOut, false);
    assert.equal(typeof run.stdout, 'string');
    assert.ok(run.stdout.includes('@@proof '), 'each actual child stdout must retain reporter evidence');
    assert.equal(typeof run.stderr, 'string');
    assert.deepEqual(run.fileVerdicts, []);
    assert.deepEqual(run.tests.map(({ name, outcome, identity }) => ({ name, outcome, identity })),
      [{ name: '1141 selected witness', outcome: 'pass', identity }]);
    assert.equal(run.tests[0].todo, undefined);
  }
  assert.equal(report.unmutated.tests[0].skip, undefined);
  assert.equal(report.mutant.tests[0].skip, '1141 mutant unavailable');
  assert.equal(report.restored.tests[0].skip, undefined);
});

function restorationFixture(t, body) {
  return proofRepository(t, { body, headFiles: { 'test/1141-witness.mjs': restorationWitness } });
}

async function restorationRun(fixture, label, env = {}, cleanupRefusal) {
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT;
  const journal = join(evidence ?? fixture.directory, `${label}-selected.jsonl`);
  assert.equal(existsSync(journal), false, 'each ordered witness starts absent');
  writeFileSync(journal, '');
  const ran = await invoke(fixture, 'mutation-receipt.mjs',
    mutationArgs(fixture, ['--test-name-pattern', '^1141 selected witness$']),
    { ...env, RIGGER_1141_JOURNAL: journal },
    { cleanupRefusal: cleanupRefusal ? (result) => cleanupRefusal(result, journal) : undefined });
  if (evidence) {
    writeFileSync(join(evidence, `${label}-inner.stdout`), ran.stdout);
    writeFileSync(join(evidence, `${label}-inner.stderr`), ran.stderr);
    writeFileSync(join(evidence, `${label}-inner-result.json`), JSON.stringify({ exit: ran.exit, timedOut: ran.timedOut, report: ran.report }, null, 2) + '\n');
  }
  const records = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  const selected = records.filter(({ kind }) => kind === 'selected');
  fixture.t.diagnostic(`${label} independent restoration evidence: ${JSON.stringify({ records, report: ran.report, exit: ran.exit })}`);
  assert.equal(ran.timedOut, false);
  assert.equal(ran.report.unmutated.exit, 0);
  assert.ok(selected[0].tree.startsWith(`${realpathSync(fixture.tmp)}/rigger-proof-`));
  assert.deepEqual([...new Set(selected.map(({ tree }) => tree))], [selected[0].tree]);
  assert.deepEqual([...new Set(selected.map(({ sourcePath }) => sourcePath))], [join(selected[0].tree, 'subject.mjs')]);
  return { ran, records, selected };
}

function assertThreeSelectedGreenRestoration(fixture, ran, selected) {
  assert.deepEqual(selected.map(({ bytes, status }) => [bytes, status]), [
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', ' M subject.mjs\n'],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''],
  ]);
  assert.ok(ran.report.restored, 'the same tree must have an actual third selected run');
  assert.equal(ran.report.restored.exit, 0);
  for (const phase of ['unmutated', 'restored']) {
    const run = ran.report[phase];
    assert.deepEqual(run.tests.map(({ name, outcome, identity, skip, todo }) => ({ name, outcome, identity, skip, todo })), [{
      name: '1141 selected witness', outcome: 'pass',
      identity: [fixture.file, [['1141 selected witness', fixture.file, 5, 1]]], skip: undefined, todo: undefined,
    }]);
    assert.deepEqual(run.fileVerdicts, []);
    assert.ok(run.stdout.includes('@@proof '));
    assert.equal(run.command.at(-1), fixture.file);
  }
  assert.equal(ran.report.restoration.preimageHash, '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29');
  assert.equal(ran.report.restoration.beforeRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.afterRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.status, '');
}

// D29 reason: wiring. Ordinary counterpart: TQ restored lifecycle applies guards to survived verdicts.
test('TQ surviving mutation restores the same source', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = restorationFixture(t, "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  assert.equal(21, 21, '1141 surviving constant');\n});\n");
  const { ran, selected } = await restorationRun(fixture, 'S2');
  assertThreeSelectedGreenRestoration(fixture, ran, selected);
  assert.equal(ran.exit, 0); assert.equal(ran.report.status, 'survived');
  assert.equal(ran.report.mutant.exit, 0);
  assert.equal(ran.report.mutant.tests[0].outcome, 'pass');
  assert.deepEqual(ran.report.failures, []);
});

// D29 reason: wiring. Ordinary counterpart: TQ restored verdict requires a recorded restored run.
test('TQ restoration third named green is required', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = restorationFixture(t, "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n");
  const { ran, selected } = await restorationRun(fixture, 'S1-third');
  assert.equal(ran.report.mutant.tests[0].outcome, 'fail');
  assert.equal(ran.report.mutant.tests[0].details.assertion, true);
  assert.ok(ran.report.restored, 'third same-copy selected execution is mandatory');
  assertThreeSelectedGreenRestoration(fixture, ran, selected);
  assert.equal(ran.exit, 0); assert.equal(ran.report.status, 'killed');
});

// D29 reason: wiring. Ordinary counterpart: TQ restored verdict requires a successful named restored run.
test('TQ restored assertion invalidates killed verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = restorationFixture(t, "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  const phase = observe();\n  assert.notEqual(phase, 3, '1141 restored third execution is deliberately red');\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n");
  const { ran, selected } = await restorationRun(fixture, 'F7');
  assert.deepEqual(selected.map(({ bytes, status }) => [bytes, status]), [
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', ' M subject.mjs\n'],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''],
  ]);
  assert.equal(ran.report.mutant.tests[0].details.assertion, true);
  assert.equal(ran.report.restored.tests[0].details.assertion, true);
  assert.equal(ran.report.restored.tests[0].name, '1141 selected witness');
  assert.match(ran.report.restored.tests[0].details.error.cause.message, /1141 restored third execution is deliberately red/);
  assert.equal(ran.report.restored.exit, 1);
  assert.equal(ran.report.restoration.afterRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.status, '');
  assert.equal(ran.report.status, 'no verdict'); assert.equal(ran.exit, 1);
  assert.match(ran.report.reason, /restored.*failed/);
});

// D29 reason: wiring. Ordinary counterpart: TQ restored lifecycle refuses inventory remove and parent cleanup errors.
test('TQ cleanup failure invalidates killed verdict', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = restorationFixture(t, "import { execFileSync } from 'node:child_process';\nimport { observe, record, tree } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  if (value === 2) {\n    execFileSync('git', ['-C', tree, 'worktree', 'lock', '--reason', '1141 owned cleanup witness', tree]);\n    record({ kind: 'locked-tree', tree, listing: execFileSync('git', ['-C', tree, 'worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' }) });\n  }\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n");
  let captured;
  const { ran, records, selected } = await restorationRun(fixture, 'F10', {}, async (actual, journal) => {
    const report = JSON.parse(actual.stdout);
    const observations = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
    const selections = observations.filter(({ kind }) => kind === 'selected');
    assert.equal(selections.length, 3, 'restored selected observation must exist before inspecting cleanup');
    const tree = realpathSync(selections[0].tree);
    const parent = realpathSync(join(tree, '..'));
    assert.equal(tree, selections[0].tree);
    assert.equal(tree, join(parent, 'tree'));
    assert.ok(parent.startsWith(`${realpathSync(fixture.tmp)}/rigger-proof-`));
    const listing = worktreeList(fixture.root, true);
    captured = { exit: actual.exit, timedOut: actual.timedOut, status: report.status, reason: report.reason,
      tree, parent, listing, temporaryInventory: readdirSync(fixture.tmp),
      bytes: readFileSync(join(tree, 'subject.mjs')).toString('base64'),
      sourceStatus: gitIn(tree, 'status', '--porcelain', '--', 'subject.mjs') };
    t.diagnostic(`F10 actual failed receipt and residual BEFORE recovery: ${JSON.stringify(captured)}`);
    try {
      assert.equal(actual.exit, 1); assert.equal(actual.timedOut, false);
      assert.equal(report.status, 'no verdict');
      assert.match(report.reason, /locked/i);
      assert.ok(listing.includes(`worktree ${tree}\0`));
      assert.ok(listing.includes('locked 1141 owned cleanup witness\0'));
      assert.equal(captured.bytes, 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK');
      assert.equal(captured.sourceStatus, '');
      assert.equal(report.restored.exit, 0);
    } finally {
      unlockWorktreeAt(fixture.root, tree);
      removeWorktreeAt(fixture.root, tree, true);
      rmSync(parent, { recursive: true, force: true });
    }
  });
  assert.equal(captured.status, 'no verdict'); assert.equal(captured.exit, 1);
  assert.equal(ran.report.status, captured.status); assert.equal(ran.exit, captured.exit);
  assert.equal(ran.report.reason, captured.reason, 'fixture recovery cannot rewrite failed tool evidence');
  assert.equal(records.filter(({ kind }) => kind === 'locked-tree').length, 1);
  assert.deepEqual(selected.map(({ bytes, status }) => [bytes, status]), [
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK', ' M subject.mjs\n'],
    ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''],
  ]);
  assert.equal(ran.report.restored.tests[0].outcome, 'pass');
  assert.equal(ran.report.restoration.afterRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.status, '');
  assert.equal(existsSync(captured.tree), false);
  assert.equal(existsSync(captured.parent), false);
});

const restorationFaultTemplate = "// ABOUTME: Injects one bounded fixture-owned fault at an actual receipt boundary and delegates all other calls.\nimport fs from 'node:fs';\nimport cp from 'node:child_process';\nimport { syncBuiltinESMExports } from 'node:module';\nimport { resolve, join } from 'node:path';\nconst cell = 'F11b';\nconst entry = CANONICAL_ENTRY;\nconst journal = JOURNAL;\nconst original = { read: fs.readFileSync, write: fs.writeFileSync, exec: cp.execFileSync, spawn: cp.spawn };\nconst active = process.argv[1] && resolve(process.argv[1]) === entry;\nlet tree;\nlet attempted = false;\nlet used = false;\nlet launches = 0;\nconst log = (record) => original.write(journal, JSON.stringify(record) + '\\n', { flag: 'a' });\nconst target = (path) => tree && typeof path === 'string' && resolve(path) === join(tree, 'subject.mjs');\nconst fault = () => {\n  if (cell === 'F11c' || cell === 'F11d') log({ kind: 'mutant-bytes', tree, bytes: original.read(join(tree, 'subject.mjs')).toString('base64') });\n  used = true;\n  log({ kind: 'fault', cell, tree });\n  throw new Error('1141 controlled ' + cell);\n};\nif (active) {\n  cp.execFileSync = function(command, args, options) {\n    if (command === 'git' && args[0] === 'diff' && args[1] === '--' && args[2] === 'subject.mjs' && options.cwd === tree && attempted && !used && cell === 'F11c') fault();\n    const result = original.exec.apply(this, arguments);\n    if (command === 'git' && args[0] === 'worktree' && args[1] === 'add' && args[2] === '--quiet' && args[3] === '--detach') tree = args[4];\n    return result;\n  };\n  fs.writeFileSync = function(path, data, options) {\n    if (target(path) && !attempted) {\n      attempted = true;\n      if (cell === 'F11a') {\n        const prefix = Buffer.from('export const val', 'utf8');\n        original.write.call(this, path, prefix, options);\n        log({ kind: 'partial-bytes', tree, bytes: original.read(path).toString('base64') });\n        fault();\n      }\n    }\n    return original.write.apply(this, arguments);\n  };\n  fs.readFileSync = function(path, options) {\n    if (target(path) && attempted && !used && cell === 'F11b') {\n      log({ kind: 'mutant-bytes', tree, bytes: original.read(path).toString('base64') });\n      fault();\n    }\n    return original.read.apply(this, arguments);\n  };\n  cp.spawn = function(command, args, options) {\n    if (tree && command === 'sh' && args[0] === 'test/suite.sh' && options.cwd === tree) {\n      launches += 1;\n      if (launches === 2 && !used && cell === 'F11d') fault();\n    }\n    return original.spawn.apply(this, arguments);\n  };\n  syncBuiltinESMExports();\n}\n";

async function faultRestorationWitness(t, cell) {
  const fixture = restorationFixture(t, "import { observe } from './1141-witness.mjs';\ntest('1141 selected witness', () => {\n  observe();\n  assert.equal(value, 1, '1141 literal value must remain one');\n});\n");
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT ?? fixture.directory;
  const journal = join(evidence, `${cell}-selected.jsonl`);
  const preload = join(evidence, `${cell}-preload.mjs`);
  const entry = realpathSync(script);
  assert.equal(entry, script, 'the manifested exact entry must be canonical');
  const source = restorationFaultTemplate.replace("const cell = 'F11b';", `const cell = '${cell}';`)
    .replace('CANONICAL_ENTRY', JSON.stringify(entry)).replace('JOURNAL', JSON.stringify(journal));
  writeFileSync(preload, source);
  assert.equal(readFileSync(preload, 'utf8'), source);
  const { ran, records, selected } = await restorationRun(fixture, cell,
    { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim() });
  const faults = records.filter(({ kind }) => kind === 'fault');
  const bytes = records.filter(({ kind }) => kind === (cell === 'F11a' ? 'partial-bytes' : 'mutant-bytes'));
  assert.equal(faults.length, 1, 'the named actual operation must reach its one fault');
  assert.equal(faults[0].cell, cell);
  assert.equal(bytes.length, 1);
  assert.equal(bytes[0].bytes, cell === 'F11a' ? 'ZXhwb3J0IGNvbnN0IHZhbA==' : 'ZXhwb3J0IGNvbnN0IHZhbHVlID0gMjsK');
  assert.deepEqual(selected.map(({ bytes, status }) => [bytes, status]),
    [['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', ''], ['ZXhwb3J0IGNvbnN0IHZhbHVlID0gMTsK', '']]);
  assert.equal(faults[0].tree, selected[0].tree);
  assert.equal(ran.exit, 1); assert.equal(ran.report.status, 'no verdict');
  assert.equal(ran.report.reason, cell === 'F11d'
    ? 'the process adapter did not start sh: 1141 controlled F11d' : `1141 controlled ${cell}`);
  assert.equal(Object.hasOwn(ran.report, 'mutant'), false);
  assert.equal(ran.report.mutated, cell === 'F11d');
  if (cell === 'F11c' || cell === 'F11d') assert.equal(ran.report.readBack, 'export const value = 2;\n');
  assert.equal(ran.report.restored.exit, 0);
  assert.equal(ran.report.restored.tests[0].name, '1141 selected witness');
  assert.equal(ran.report.restored.tests[0].outcome, 'pass');
  assert.equal(ran.report.restored.tests[0].skip, undefined);
  assert.equal(ran.report.restored.tests[0].todo, undefined);
  assert.deepEqual(ran.report.restored.tests[0].identity, [fixture.file, [['1141 selected witness', fixture.file, 5, 1]]]);
  assert.ok(ran.report.restored.stdout.includes('@@proof '));
  assert.equal(ran.report.restoration.beforeRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.afterRunHash, ran.report.restoration.preimageHash);
  assert.equal(ran.report.restoration.status, '');
}

// D29 reason: wiring. Ordinary counterpart: TQ restoration duty precedes the write attempt.
test('TQ partial mutant write is restored before cleanup', SETTLES_WITHIN[60_000], async (t) => {
  await faultRestorationWitness(t, 'F11a');
});

// D29 reason: wiring. Ordinary counterpart: TQ restoration duty survives readback refusal.
test('TQ readback refusal restores before cleanup', SETTLES_WITHIN[60_000], async (t) => {
  await faultRestorationWitness(t, 'F11b');
});

// D29 reason: wiring. Ordinary counterpart: TQ restoration duty survives diff refusal.
test('TQ diff refusal restores before cleanup', SETTLES_WITHIN[60_000], async (t) => {
  await faultRestorationWitness(t, 'F11c');
});

// D29 reason: wiring. Ordinary counterpart: TQ restoration duty survives mutant launch refusal.
test('TQ mutant launch refusal restores before cleanup', SETTLES_WITHIN[60_000], async (t) => {
  await faultRestorationWitness(t, 'F11d');
});


/** Inserts literal shell text before the real suite without interpreting its dollar characters. */
function suiteWithPrelude(prelude) {
  const suite = readFileSync(new URL('suite.sh', import.meta.url), 'utf8');
  const selected = suite.replace('#!/bin/sh\n', () => '#!/bin/sh\n' + prelude);
  assert.ok(selected.startsWith('#!/bin/sh\n' + prelude), 'the fixture must contain the exact shell prelude before execution');
  return selected;
}

// D29 reason: wiring. Ordinary counterpart: TQ selected-suite evidence requires observed start and settled ending.
// The shell and the worker identify themselves independently of the receipt's recorded start.
test('TQ selected-suite start belongs to the shell leader rather than its worker', SETTLES_WITHIN[60_000], async (t) => {
  const prelude = 'if [ "${1-}" != --list ]; then\n  printf "1232-leader %s " "$$" >&2\n  LC_ALL=C TZ=UTC ps -p "$$" -o lstart= >&2\nfi\n';
  const fixture = proofRepository(t, {
    body: "test('selected leader witness', () => { console.error('1232-worker ' + process.pid); assert.equal(3 * 7, 21); });\n",
    headFiles: { 'test/suite.sh': suiteWithPrelude(prelude) },
  });
  const run = await runTests(fixture.root, fixture.tmp, fixture.file);
  assert.equal(run.exit, 0, run.stderr);
  assert.equal(run.timedOut, false);
  assert.deepEqual(run.tests.map(({ name, outcome }) => [name, outcome]), [['selected leader witness', 'pass']]);
  const leader = /^1232-leader (\d+) (.+)$/m.exec(run.stderr);
  assert.ok(leader, 'the actual selected shell must print its PID and its own ps start answer');
  const start = Date.parse(leader[2].trim() + ' UTC') / 1000;
  assert.ok(Number.isFinite(start), 'the real ps start answer must be independently readable');
  const events = run.stdout.split('\n').filter((line) => line.startsWith('@@proof ')).map((line) => JSON.parse(line.slice(8)));
  const workers = events.filter((event) => event.type === 'test:stderr').flatMap((event) => {
    const matched = /^1232-worker (\d+)\n$/.exec(event.data.message);
    return matched ? [Number(matched[1])] : [];
  });
  assert.equal(workers.length, 1, 'the actual assertion worker must identify itself once');
  assert.notEqual(workers[0], Number(leader[1]), 'the observed assertion worker is not the selected shell leader');
  assert.deepEqual(run.process, { group: Number(leader[1]), started: start },
    'the receipt must retain the actual shell/group leader and its OS start answer');
});


/** tee writes the same input bytes to the selected shell's captured stderr and its private mirror. */
function suiteWithCapture(octal) {
  return suiteWithPrelude([
    'if [ "${1-}" != --list ]; then',
    `  printf '${octal}\\n' | tee "$TMPDIR/1232-stream-bytes" >&2`,
    'fi', '',
  ].join('\n'));
}

// D29 reason: wiring. Ordinary counterpart: TQ selected-suite UTF8 fidelity is required for proof credit.
test('TQ selected-suite capture retains actual bytes and refuses a lossy UTF8 pipe', SETTLES_WITHIN[60_000], async (t) => {
  const rows = [
    { octal: '\\101', bytes: [65, 10], text: 'A\n', sha256: '06f961b802bc46ee168555f066d28f4f0e9afdf3f88174c1ee6f9de004fc30a0', faithful: true },
    { octal: '\\357\\277\\275', bytes: [239, 191, 189, 10], text: '\ufffd\n', sha256: '8d75cfafa290dea108e554948eae67ba5c418cad73059f9452ff6fc652d5c869', faithful: true },
    { octal: '\\377', bytes: [255, 10], text: '\ufffd\n', sha256: 'e4688624e5f1ad0629505e6768e3bb36244f2f3e33e751215afa820334a76ed3', faithful: false },
  ];
  for (const row of rows) {
    const fixture = proofRepository(t, {
      body: "test('capture pipe witness', () => assert.equal(3 * 7, 21));\n",
      headFiles: { 'test/suite.sh': suiteWithCapture(row.octal) },
    });
    const run = await runTests(fixture.root, fixture.tmp, fixture.file);
    assert.equal(run.exit, 0, run.stderr);
    assert.equal(run.timedOut, false);
    assert.deepEqual(run.tests.map(({ name, outcome }) => [name, outcome]), [['capture pipe witness', 'pass']]);
    const runs = readdirSync(fixture.tmp).filter((name) => name.startsWith('run-'));
    assert.equal(runs.length, 1, 'the one selected invocation must own one scratch root');
    const mirror = readFileSync(join(fixture.tmp, runs[0], '1232-stream-bytes'));
    assert.deepEqual(mirror, Buffer.from(row.bytes), 'the actual selected shell must send the specified bytes through tee');
    assert.equal(run.stderr, row.text, 'the returned text must expose the actual UTF8 decode');
    assert.deepEqual(run.capture?.stderr, { bytes: row.bytes.length, sha256: row.sha256, faithful: row.faithful },
      'capture metadata must identify the original selected-shell bytes separately from decoded text');
    assert.equal(noVerdict(run), row.faithful ? undefined : 'selected suite UTF8 text fidelity unavailable');
    t.diagnostic(JSON.stringify({ mirrorHex: mirror.toString('hex'), capture: run.capture.stderr }));
  }
});

// D29 reason: wiring. Ordinary counterpart: TQ selected-suite UTF8 fidelity is required for proof credit.
test('TQ proof diff refuses invalid UTF8 capture at both source sides', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, {
    base: 'export const value = 2;\n', head: 'export const value = 1;\n',
    headFiles: { 'test/suite.sh': suiteWithCapture('\\377') },
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 1);
  for (const side of ['base', 'head']) {
    assert.equal(report.runs[side].status, 'no verdict');
    assert.equal(report.runs[side].reason, 'selected suite UTF8 text fidelity unavailable');
    assert.deepEqual(report.runs[side].capture.stderr, {
      bytes: 2, sha256: 'e4688624e5f1ad0629505e6768e3bb36244f2f3e33e751215afa820334a76ed3', faithful: false,
    });
  }
  assert.deepEqual(report.tests.map(({ status }) => status), ['no verdict at the head']);
});


// D29 reason: wiring. Ordinary counterpart: native exit records distinguish ordinary and signalled endings.
// D29 reason: wiring. Ordinary counterpart: native exit records refuse missing or ambiguous evidence.
// Both selected shell leaders must be observed ready and live before their owned release.
test('the selected suite retains natural 143 and SIGTERM as different native endings', SETTLES_WITHIN[60_000], async (t) => {
  assert.ok(['linux', 'darwin'].includes(process.platform), 'fixture STOP: this witness requires a supported POSIX shell');
  assert.equal(osConstants.signals.SIGTERM, 15, 'fixture STOP: the normalized-143 premise requires SIGTERM=15');
  const rows = [
    { tag: '1270-natural-ready', ending: 'exit 143', code: 143, signal: null },
    { tag: '1270-term-ready', ending: 'kill -TERM "$$"', code: null, signal: 'SIGTERM' },
  ];
  let callsPending = false;
  const control = temporaryDirectory('1270-native-barrier-', { context: t, beforeRemoval: () => {
    if (callsPending) throw new Error('fixture STOP: readiness controls remain until both selected calls settle');
  } });
  const release = join(control, 'release');
  const fixtures = rows.map((row) => proofRepository(t, {
    headFiles: { 'test/suite.sh': suiteWithPrelude([
      'if [ "${1-}" != --list ]; then',
      `  printf '${row.tag} %s\\n' "$$" >&2`,
      `  printf '${row.tag} %s\\n' "$$" > ${shellQuote(join(control, row.tag))}`,
      `  while [ ! -e ${shellQuote(release)} ]; do :; done`,
      `  ${row.ending}`,
      'fi', '',
    ].join('\n')) },
  }));
  const settled = [false, false];
  callsPending = true;
  const both = Promise.allSettled(fixtures.map((fixture, index) => runTests(fixture.root, fixture.tmp, fixture.file)
    .finally(() => { settled[index] = true; })));
  const barrierErrors = [];
  const observedPids = [];
  let outcomes;
  try {
    // The existing half-test-bound wait policy leaves headroom for release and settlement.
    const readyBy = performance.now() + SETTLES_WITHIN[60_000].timeout / 2;
    await until(() => {
      if (settled.some(Boolean)) throw new Error('fixture STOP: a selected call settled before the overlap barrier');
      if (performance.now() >= readyBy) throw new Error('fixture STOP: both selected shells did not become ready within the readiness guard');
      return rows.every((row) => {
        const path = join(control, row.tag);
        if (!existsSync(path)) return false;
        const ready = /^(1270-(?:natural|term)-ready) ([1-9]\d*)\n$/.exec(readFileSync(path, 'utf8'));
        return ready !== null && ready[1] === row.tag;
      });
    }, t);
    for (const row of rows) observedPids.push(Number(readFileSync(join(control, row.tag), 'utf8').trim().split(' ')[1]));
    assert.ok(observedPids.every(Number.isSafeInteger), 'fixture STOP: ready shell PIDs must be readable positive integers');
    assert.notEqual(observedPids[0], observedPids[1], 'fixture STOP: the two ready shells must be distinct');
    assert.equal(existsSync(release), false, 'fixture STOP: no release may precede observing both leaders');
    const ps = spawnSync('/bin/ps', ['-p', observedPids.join(','), '-o', 'pid=', '-o', 'ppid=', '-o', 'stat='], { encoding: 'utf8' });
    t.diagnostic(JSON.stringify({ kind: '1270-overlap-ps', parentPID: process.pid, observedPids,
      status: ps.status, signal: ps.signal, error: ps.error?.message, stdout: ps.stdout, stderr: ps.stderr,
      releasePresent: existsSync(release), callsSettled: [...settled] }));
    assert.equal(ps.error, undefined, 'fixture STOP: the real leader observation must start');
    assert.equal(ps.status, 0, 'fixture STOP: the real leader observation must complete');
    assert.equal(ps.signal, null, 'fixture STOP: the real leader observation must end normally');
    assert.equal(ps.stderr, '', 'fixture STOP: the real leader observation must print no error');
    const live = ps.stdout.trim().split('\n').map((line) => line.trim().split(/\s+/));
    assert.equal(live.length, 2, 'fixture STOP: one observation must name both ready leaders');
    assert.ok(live.every((fields) => fields.length === 3 && Number(fields[1]) === process.pid
      && /^[A-Za-z]/.test(fields[2]) && !/^[ZX]/.test(fields[2])), 'fixture STOP: both leaders must be live children of this actual parent');
    assert.deepEqual(live.map((fields) => Number(fields[0])).sort((a, b) => a - b), [...observedPids].sort((a, b) => a - b),
      'fixture STOP: the two live child rows must match the independently ready shell PIDs');
    assert.equal(existsSync(release), false, 'fixture STOP: release must remain absent through the positive observation');
    assert.deepEqual(settled, [false, false], 'fixture STOP: both selected calls must remain pending through the positive observation');
    t.diagnostic(JSON.stringify({ kind: '1270-overlap-observed-before-release', parentPID: process.pid,
      rows: rows.map((row, index) => ({ tag: row.tag, pid: observedPids[index] })), releasePresent: false, callsSettled: [...settled] }));
  } catch (error) {
    barrierErrors.push(error);
  } finally {
    try { writeFileSync(release, 'release\n', { flag: 'wx' }); } catch (error) { barrierErrors.push(error); }
    outcomes = await both;
    callsPending = false;
  }
  t.diagnostic(JSON.stringify({ kind: '1270-overlap-settled', parentPID: process.pid, observedPids,
    barrierErrors: barrierErrors.map((error) => ({ name: error.name, message: error.message, stack: error.stack })),
    releasePresent: existsSync(release), callsSettled: [...settled] }));
  for (const [index, outcome] of outcomes.entries()) {
    const reason = outcome.status === 'rejected' ? outcome.reason : undefined;
    t.diagnostic(JSON.stringify({ tag: rows[index].tag, outcome: outcome.status,
      ...(outcome.status === 'fulfilled' ? { run: outcome.value, hasNative: Object.hasOwn(outcome.value, 'native') } : {
        rejection: reason instanceof Error ? { name: reason.name, message: reason.message, code: reason.code, stack: reason.stack,
          cause: reason.cause instanceof Error ? { name: reason.cause.name, message: reason.cause.message, stack: reason.cause.stack } : reason.cause } : reason,
      }),
    }));
  }
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (barrierErrors.length > 0) throw new AggregateError([...barrierErrors, ...rejected.map((outcome) => outcome.reason)],
    'fixture STOP: overlap controls released and both selected calls settled before reporting the barrier failure');
  if (rejected.length > 0) throw new AggregateError(rejected.map((outcome) => outcome.reason),
    'fixture STOP: both selected-suite calls settled before propagating a refusal');
  const runs = outcomes.map((outcome) => outcome.value);
  const pids = [];
  for (const [index, run] of runs.entries()) {
    const { tag } = rows[index];
    assert.equal(run.exit, 143, `${tag}: fixture STOP unless the independently specified ending normalizes to 143`);
    assert.equal(run.timedOut, false, `${tag}: fixture STOP if the deadline supplied the ending`);
    const ready = /^(1270-(?:natural|term)-ready) ([1-9]\d*)\n$/.exec(run.stderr);
    assert.ok(ready, `${tag}: fixture STOP unless the selected shell identifies itself before ending`);
    assert.equal(ready[1], tag, `${tag}: fixture STOP on another call's readiness message`);
    const pid = Number(ready[2]);
    assert.ok(Number.isSafeInteger(pid), `${tag}: fixture STOP on an unreadable shell PID`);
    pids.push(pid);
    assert.equal(pid, observedPids[index], `${tag}: captured shell readiness must match the live leader observed before release`);
    assert.equal(run.process?.group, pid, `${tag}: fixture STOP unless the selected group is this shell`);
    assert.ok(Number.isFinite(run.process?.started), `${tag}: fixture STOP without the OS start answer`);
    assert.equal(run.stdout, '', `${tag}: fixture STOP if the prelude reached Node test selection`);
    assert.equal(run.capture?.stdout?.faithful, true, `${tag}: fixture STOP on lost stdout fidelity`);
    assert.equal(run.capture?.stdout?.bytes, 0, `${tag}: fixture STOP unless stdout is empty`);
    assert.equal(run.capture?.stderr?.faithful, true, `${tag}: fixture STOP on lost readiness fidelity`);
    assert.equal(run.capture?.stderr?.bytes, Buffer.byteLength(run.stderr, 'utf8'), `${tag}: fixture STOP on incomplete readiness capture`);
    assert.equal(run.events.some(([event]) => event === 'output.held'), false, `${tag}: fixture STOP on a held output pipe`);
    assert.equal(run.count, 0, `${tag}: this early-ending fixture earns no named-test verdict credit`);
    assert.deepEqual(run.tests, []);
    assert.deepEqual(run.fileVerdicts, []);
  }
  assert.notEqual(pids[0], pids[1], 'fixture STOP unless the two independent selected shells have distinct PIDs');
  for (const [index, run] of runs.entries()) {
    const { tag, code, signal } = rows[index];
    assert.deepEqual(run.native, { pid: pids[index], code, signal },
      `${tag}: retain the actual selected-shell native exit(code, signal) pair`);
  }
});


// D29 reason: wiring. Ordinary counterpart: native records guard all mutation phases.
// invoke.report is parsed actual tool stdout; invoke's normalized helper exit is not native-entry evidence.
test('native phase records survive mutation and proof diff serialization', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: 'export const value = 1;\n', head: 'export const value = 1;\n' });
  const mutation = await invoke(fixture, 'mutation-receipt.mjs', mutationArgs(fixture));
  assert.equal(mutation.exit, 0);
  assert.equal(mutation.timedOut, false);
  assert.ok(mutation.report, 'the actual mutation tool must serialize its receipt');
  const receipt = mutation.report;
  assert.equal(receipt.head, fixture.headSha);
  assert.equal(receipt.base, fixture.baseSha);
  assert.equal(receipt.mutated, true);
  assert.equal(receipt.status, 'killed');
  assert.equal(receipt.anchor.found, 1);
  assert.equal(receipt.readBack, 'export const value = 2;\n');
  assert.match(receipt.diff, /\+export const value = 2;/);
  assert.deepEqual(receipt.failures.map(({ name, kind }) => ({ name, kind })), [{ name: 'value stays one', kind: 'assertion' }]);
  assert.equal(receipt.failures[0].error.name, 'AssertionError');
  assert.match(receipt.failures[0].error.message, /value must stay one/);
  const originalHash = '5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29';
  assert.deepEqual([receipt.restoration.preimageHash, receipt.restoration.beforeRunHash, receipt.restoration.afterRunHash],
    [originalHash, originalHash, originalHash], 'the literal original source must be restored before and after the final selection');
  assert.equal(receipt.restoration.status, '');
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.timedOut, false);
  assert.ok(proof.report, 'the actual proof tool must serialize both source sides');
  assert.equal(proof.report.head, fixture.headSha);
  assert.equal(proof.report.base, fixture.baseSha);
  assert.deepEqual(proof.report.tests.map(({ name, base, head, status }) => ({ name, base, head, status })), [
    { name: 'value stays one', base: 'pass', head: 'pass', status: 'passes at the base: proves nothing new' },
  ], 'the independent fixed value-one source at both refs must retain its original semantic status');
  for (const side of ['base', 'head']) {
    assert.equal(proof.report.runs[side].status, 'pass');
    assert.equal(proof.report.runs[side].reason, undefined);
  }
  const selected = [
    { phase: 'unmutated', run: receipt.unmutated, code: 0, outcome: 'pass' },
    { phase: 'mutant', run: receipt.mutant, code: 1, outcome: 'fail' },
    { phase: 'restored', run: receipt.restored, code: 0, outcome: 'pass' },
    { phase: 'base', run: proof.report.runs.base, code: 0, outcome: 'pass' },
    { phase: 'head', run: proof.report.runs.head, code: 0, outcome: 'pass' },
  ];
  t.diagnostic(JSON.stringify({ actualNativeSerialization: true,
    selected: selected.map(({ phase, run }) => ({ phase, native: run.native, process: run.process, exit: run.exit, capture: run.capture })) }));
  for (const { phase, run, code, outcome } of selected) {
    assert.equal(run.exit, code, `${phase}: normalized ending remains separate`);
    assert.equal(run.timedOut, false, `${phase}: the ordinary phase must not time out`);
    assert.ok(Number.isSafeInteger(run.process?.group) && run.process.group > 0, `${phase}: actual selected group must survive serialization`);
    assert.ok(Number.isFinite(run.process.started), `${phase}: actual selected start must survive serialization`);
    assert.deepEqual(run.native, { pid: run.process.group, code, signal: null }, `${phase}: actual native ending must survive official tool JSON serialization`);
    assert.equal(run.count, 1, `${phase}: the independent named equality remains selected`);
    assert.deepEqual(run.tests.map(({ name, outcome }) => [name, outcome]), [['value stays one', outcome]]);
    assert.deepEqual(run.fileVerdicts, []);
    assert.equal(run.capture?.stdout?.faithful, true, `${phase}: named event text must remain faithful`);
    assert.equal(run.capture?.stderr?.faithful, true, `${phase}: error text must remain faithful`);
    assert.equal(noVerdict(run), undefined, `${phase}: serialized ordinary native evidence must preserve qualification`);
  }
});
