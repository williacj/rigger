// ABOUTME: Exercises per-test base and head proof reports without changing the caller's checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forgeBody, invoke, proofRepository, source } from './proof-repository.mjs';
import { SETTLES_WITHIN } from './settles-within.mjs';
import { mutationArgs } from './proof-repository.mjs';

// A passing assertion around gh's refusal cannot hide the harness's own failed exit.
test('proof diff uses the host suite and refuses a real forge call at both refs', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { host: true, body: forgeBody });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.notEqual(exit, 0);
  for (const side of ['base', 'head']) {
    assert.deepEqual(report.runs[side].command.slice(0, 3), ['sh', 'test/suite.sh', '--host']);
    assert.equal(report.runs[side].status, 'no verdict');
    assert.match(report.runs[side].stderr, /these tests called gh.*refused/s);
  }
});

// Dependency differences are parsed facts, independent of formatting and key order.
test('reports name changed dependency declarations and ignore JSON formatting', SETTLES_WITHIN[60_000], async (t) => {
  for (const version of ['99.0.0', '8.18.0']) {
    const fixture = proofRepository(t, { headFiles: { 'package.json': JSON.stringify({ devDependencies: { acorn: version }, type: 'module' }, null, 4) + '\n' } });
    for (const script of ['proof-diff.mjs', 'mutation-receipt.mjs']) {
      const args = script === 'proof-diff.mjs' ? [fixture.file] : mutationArgs(fixture);
      const { exit, report } = await invoke(fixture, script, args);
      assert.equal(exit, 0);
      assert.deepEqual(report.dependencyChanges, version === '8.18.0' ? [] : [{ group: 'devDependencies', name: 'acorn', base: '8.18.0', head: '99.0.0' }]);
    }
  }
});

// Timeout classification belongs to its side; a base timeout cannot fail a green head.
test('B7 either side can time out and only the head timeout changes the exit', SETTLES_WITHIN[60_000], async (t) => {
  for (const [side, hangingValue] of [['base', 1], ['head', 2]]) {
    const fixture = proofRepository(t, { head: source(2), body: "import { MessageChannel } from 'node:worker_threads';\ntest('may hang', () => value === " + hangingValue + " ? new Promise(() => { new MessageChannel().port1.on('message', () => {}); }) : undefined);\n" });
    const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file, '--timeout', '2']);
    assert.equal(exit, side === 'base' ? 0 : 1);
    assert.equal(report.runs[side].status, 'no verdict');
    assert.match(report.runs[side].reason, /timeout/);
    assert.match(report.runs[side].stdout, /may hang/);
    assert.equal(report.runs[side === 'base' ? 'head' : 'base'].status, 'pass');
  }
});

// A zero process exit with a skipped head test still supplies no head verdict.
test('a skipped head test makes the proof report nonzero', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "test('may skip', { skip: value === 2 }, () => {});\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.notEqual(exit, 0);
  assert.equal(report.tests[0].head, 'no verdict');
  assert.equal(report.tests[0].status, 'no verdict at the head');
});

// Both sides need the new test helper and the checkout's actual package installation.
test('B6 a new test helper and package dependency resolve at both refs', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2),
    headFiles: { 'test/helper.mjs': "import { parse } from 'acorn';\nexport const expected = parse('const answer = 2', { ecmaVersion: 'latest' }).body[0].declarations[0].init.value;\n" },
    body: "import { expected } from './helper.mjs';\ntest('helper sees two', () => assert.equal(value, expected, 'helper expected two'));\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.tests[0].status, 'proves');
  assert.equal(report.runs.base.tests[0].details.error.cause.code, 'ERR_ASSERTION');
  assert.match(report.runs.base.tests[0].details.error.cause.message, /helper expected two/);
});

// An import the base lacks must be labelled apart from a failing named assertion.
test('B5 a base import failure is no verdict and does not change the exit', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { base: "import './head-only.mjs';\nexport const value = 1;\n", headFiles: { 'head-only.mjs': 'export const ready = true;\n' } });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.runs.base.reason, /file|resolve|module/i);
  assert.equal(report.runs.base.tests.length, 0);
  assert.equal(report.runs.head.tests[0].outcome, 'pass');
});

// Even identical titles need distinct outcomes when only one assertion distinguishes the base.
test('B4 a mixed file reports each test separately including repeated titles', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "test('same title', () => assert.equal(value, 2));\ntest('same title', () => assert.equal(6 * 7, 42));\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.deepEqual(report.tests.map(({ name, base, head, status }) => ({ name, base, head, status })), [
    { name: 'same title', base: 'fail', head: 'pass', status: 'proves' },
    { name: 'same title', base: 'pass', head: 'pass', status: 'passes at the base: proves nothing new' },
  ]);
});

// Any head failure determines the exit, regardless of whether the base also failed.
test('B3 a test failing at the head is nonzero for either base outcome', SETTLES_WITHIN[60_000], async (t) => {
  for (const base of [source(1), source(2)]) {
    const fixture = proofRepository(t, { base, head: source(2) });
    const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
    assert.notEqual(exit, 0);
    assert.equal(report.tests[0].head, 'fail');
    assert.equal(report.tests[0].status, 'fails at the head');
  }
});

// A head pass alone does not prove that the test distinguishes the base's behaviour.
test('B2 a test passing at both refs proves nothing new', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t);
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.tests[0].base, 'pass');
  assert.equal(report.tests[0].head, 'pass');
  assert.equal(report.tests[0].status, 'passes at the base: proves nothing new');
});

// The head's new test must execute against both source trees, rather than vanish at the base.
test('B1 a base assertion failure and head pass proves the named test', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "test('value becomes two', () => assert.equal(value, 2, 'must be two'));\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.head, fixture.headSha);
  assert.equal(report.base, fixture.baseSha);
  assert.equal(report.tests[0].name, 'value becomes two');
  assert.equal(report.tests[0].base, 'fail');
  assert.equal(report.tests[0].head, 'pass');
  assert.equal(report.tests[0].status, 'proves');
  assert.match(report.runs.base.tests[0].details.error.cause.message, /must be two/);
});

test('proof usage names its timeout default', () => {
  const script = fileURLToPath(new URL('../scripts/proof-diff.mjs', import.meta.url));
  const ran = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /--timeout <seconds>.*default: 60/);
});

// A dynamic import failure is a named runner failure before the assertion can inspect its value.
test('B5 a named module-not-found failure is not base proof', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, {
    base: "export const value = 1;\nexport const load = () => import('./missing.mjs');\n",
    head: "export const value = 2;\nexport const load = async () => ({ answer: 2 });\n",
    body: "import { load } from '../subject.mjs';\ntest('loads answer', async () => assert.equal((await load()).answer, 2));\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests[0].details.error.cause.code, 'ERR_MODULE_NOT_FOUND');
  assert.equal(report.runs.head.tests[0].outcome, 'pass');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.equal(report.tests[0].base, 'no verdict');
  assert.match(report.tests[0].baseReason, /ERR_MODULE_NOT_FOUND.*missing\.mjs/s);
});

// Even an AssertionError in before() belongs to setup, not the constant test assertion.
test('B5 a failed setup hook cannot prove its unrun assertion', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2),
    body: "import { before } from 'node:test';\nbefore(() => { if (value === 1) assert.fail('base setup never completed'); });\ntest('requires ready setup', () => assert.equal(6 * 7, 42, 'constant assertion reached'));\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests[0].details.error.failureType, 'hookFailed');
  assert.equal(report.runs.base.tests[0].details.error.cause.code, 'ERR_ASSERTION');
  assert.equal(report.tests[0].head, 'pass');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /hookFailed.*base setup never completed/s);
});

// The base no-verdict row's catch-all refuses unfamiliar errors, not only known import codes.
test('B5 an unclassified named base error never becomes proof', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2),
    body: "test('needs a prerequisite', () => { if (value === 1) throw Object.assign(new Error('unclassified prerequisite unavailable'), { code: 'ERR_UNCLASSIFIED_PREREQUISITE' }); assert.equal(6 * 7, 42); });\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests[0].details.error.failureType, 'testCodeFailure');
  assert.equal(report.runs.base.tests[0].details.error.cause.code, 'ERR_UNCLASSIFIED_PREREQUISITE');
  assert.equal(report.tests[0].head, 'pass');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /testCodeFailure.*Error.*ERR_UNCLASSIFIED_PREREQUISITE.*unclassified prerequisite unavailable/s);
});

// An application error carrying an assertion-like code is still not an assertion failure.
test('B5 an assertion code on an ordinary error is not proof', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2),
    body: "test('needs an actual assertion', () => { if (value === 1) throw Object.assign(new Error('setup copied a code'), { code: 'ERR_ASSERTION' }); assert.equal(6 * 7, 42); });\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests[0].details.error.cause.name, 'Error');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /Error ERR_ASSERTION.*setup copied a code/);
});

// Missing prerequisites and missing named results must not hide a neighboring real assertion red.
test('B5 missing base files and registrations keep independent non-proving outcomes', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), headFiles: { 'payload.txt': 'ready' },
    body: "import { readFileSync } from 'node:fs';\ntest('source assertion', () => assert.equal(value, 2));\ntest('needs payload', () => assert.equal(readFileSync(new URL('../payload.txt', import.meta.url), 'utf8'), 'ready'));\nif (value === 2) test('head registration', () => assert.equal(6 * 7, 42));\n",
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.deepEqual(report.tests.map(({ name, status }) => ({ name, status })), [
    { name: 'source assertion', status: 'proves' },
    { name: 'needs payload', status: 'no verdict at the base' },
    { name: 'head registration', status: 'no verdict at the base' },
  ]);
  assert.match(report.tests[1].baseReason, /ENOENT.*payload\.txt/s);
  assert.match(report.tests[2].baseReason, /named test did not report/);
});

// A disappearing registration cannot lend its failed assertion to a constant sibling's title.
test('R3 duplicate titles pair by source position instead of occurrence', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "if (value === 1) test('same title', () => assert.equal(value, 2, 'base-only red'));\ntest('same title', () => assert.equal(6 * 7, 42, 'constant assertion'));\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests.length, 2);
  assert.equal(report.runs.base.tests[1].outcome, 'pass');
  assert.equal(report.runs.head.tests.length, 1);
  assert.equal(report.tests[0].status, 'passes at the base: proves nothing new');
});

// Shared child call sites are distinct when their suite ancestry differs.
test('R3 nested suites distinguish shared child positions by parent path', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "import { describe } from 'node:test';\nfunction register(red) { test('same child', () => red ? assert.equal(value, 2, 'other suite red') : assert.equal(6 * 7, 42)); }\nif (value === 1) describe('base-only suite', () => register(true));\ndescribe('stable suite', () => register(false));\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests.length, 2);
  assert.equal(report.runs.base.tests[1].outcome, 'pass');
  assert.equal(report.tests[0].status, 'passes at the base: proves nothing new');
});

// A factory can register indistinguishable tests even after file, ancestry and position are known.
test('R3 colliding registration identities have an explicit non-proving outcome', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "for (const red of value === 1 ? [true, false] : [false]) test('factory title', () => red ? assert.equal(value, 2, 'ambiguous red') : assert.equal(6 * 7, 42));\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests.length, 2);
  assert.equal(report.runs.base.tests[1].outcome, 'pass');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /ambiguous.*identity/i);
});

// A unique leaf result is still ambiguous if its indistinguishable parent registrations differ.
test('R3 duplicate parent registrations cannot lend their only child a red', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "import { describe } from 'node:test';\nfor (const red of value === 1 ? [true, false] : [false]) describe('factory suite', () => { if (red || value === 2) test('only child', () => red ? assert.equal(value, 2) : assert.equal(6 * 7, 42)); });\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests.length, 1);
  assert.equal(report.runs.head.tests.length, 1);
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /ambiguous.*identity/i);
});

// Generated registrations can lack a resolvable source position; no title fallback is safe.
test('R3 missing source identity has its own non-proving outcome', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "new Function('test', 'assert', \"test('generated constant', () => assert.equal(6 * 7, 42));\")(test, assert);\n" });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.head.tests[0].outcome, 'pass');
  assert.equal(report.tests[0].status, 'no verdict at the base');
  assert.match(report.tests[0].baseReason, /unavailable.*identity/i);
});

// Two helpers can register the same title at exactly the same line and column.
test('R3 identical positions in different files retain separate identities', SETTLES_WITHIN[60_000], async (t) => {
  const helper = (active, assertion) => "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../subject.mjs';\nconst active = " + active + ";\nif (active) test('helper title', () => " + assertion + ");\n";
  const fixture = proofRepository(t, { head: source(2), body: "import './base-registration.mjs';\nimport './constant-registration.mjs';\n",
    headFiles: { 'test/base-registration.mjs': helper('value === 1', 'assert.equal(value, 2)'), 'test/constant-registration.mjs': helper('true', 'assert.equal(6 * 7, 42)') },
  });
  const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(exit, 0);
  assert.equal(report.runs.base.tests.length, 2);
  assert.equal(report.runs.head.tests.length, 1);
  assert.equal(report.tests[0].status, 'passes at the base: proves nothing new');
});

// Both a parent's full name and its position distinguish otherwise identical child registrations.
test('R3 suite names and positions both participate in child identity', SETTLES_WITHIN[60_000], async (t) => {
  for (const body of [
    "import { describe } from 'node:test';\nfor (const [title, red] of value === 1 ? [['other suite', true], ['stable suite', false]] : [['stable suite', false]]) describe(title, () => { test('same child', () => red ? assert.equal(value, 2) : assert.equal(6 * 7, 42)); });\n",
    "import { describe } from 'node:test';\nfunction register(red) { test('same child', () => red ? assert.equal(value, 2) : assert.equal(6 * 7, 42)); }\nif (value === 1) describe('same suite', () => register(true));\ndescribe('same suite', () => register(false));\n",
  ]) {
    const fixture = proofRepository(t, { head: source(2), body });
    const { exit, report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
    assert.equal(exit, 0);
    assert.equal(report.runs.base.tests.length, 2);
    assert.equal(report.runs.head.tests.length, 1);
    assert.equal(report.tests[0].status, 'passes at the base: proves nothing new');
  }
});

// A container's aggregate failure is diagnostic; its completed child assertion remains its own proof.
test('R3 a nested test assertion retains proof beside its aggregate parent failure', SETTLES_WITHIN[60_000], async (t) => {
  const fixture = proofRepository(t, { head: source(2), body: "test('container', async (context) => { await context.test('leaf assertion', () => assert.equal(value, 2, 'leaf observed source')); });\n" });
  const proof = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
  assert.equal(proof.exit, 0);
  assert.equal(proof.report.runs.base.tests.find(({ name }) => name === 'container').details.error.failureType, 'subtestsFailed');
  assert.equal(proof.report.tests.find(({ name }) => name === 'leaf assertion').status, 'proves');
  assert.equal(proof.report.tests.find(({ name }) => name === 'container').status, 'no verdict at the base');
  const args = mutationArgs(fixture);
  args[args.indexOf('--anchor') + 1] = 'value = 2';
  args[args.indexOf('--replacement') + 1] = 'value = 1';
  const receipt = await invoke(fixture, 'mutation-receipt.mjs', args);
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.report.unmutated.count, 2);
  assert.equal(receipt.report.mutant.count, 2);
  assert.equal(receipt.report.failures.find(({ name }) => name === 'leaf assertion').kind, 'assertion');
  assert.equal(receipt.report.failures.find(({ name }) => name === 'container').kind, 'not an assertion');
});

// A file's own verdict, at either side, withholds that side's verdict and is never reported as a test.
test('a file verdict at either side is no verdict, is named as a file verdict and has no entry in tests', SETTLES_WITHIN[60_000], async (t) => {
  const body = "test('constant named test', () => assert.equal(6 * 7, 42));\n";
  for (const [side, fileFailure] of [['base', "if (value === 1) throw new Error('the base fails to load');\n"], ['head', "if (value === 2) setImmediate(() => { throw new Error('thrown after the head tests'); });\n"]]) {
    const fixture = proofRepository(t, { head: source(2), body: fileFailure + body });
    const { report } = await invoke(fixture, 'proof-diff.mjs', [fixture.file]);
    assert.equal(report.runs[side].status, 'no verdict', side);
    assert.match(report.runs[side].reason, /file verdict/, side);
    assert.deepEqual(report.runs[side].fileVerdicts.map(({ name, outcome }) => [name, outcome]), [[fixture.file, 'fail']], side);
    assert.deepEqual(report.tests.map(({ name }) => name), ['constant named test'], side);
    if (side === 'base') assert.match(report.tests[0].baseReason, /file verdict/);
    else assert.equal(report.tests[0].status, 'no verdict at the head');
  }
});
