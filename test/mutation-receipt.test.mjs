// ABOUTME: Exercises guarded mutation receipts against disposable Git repositories and the real suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forgeBody, invoke, mutationArgs, proofRepository } from './proof-repository.mjs';
import { SETTLES_WITHIN } from './settles-within.mjs';
import { gitIn } from './git-repository.mjs';

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
