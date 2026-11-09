// ABOUTME: Checks source-binding fixture bookkeeping with owned bytes and controlled module namespaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as namespaceSentinel from 'node:path';
import { pathToFileURL } from 'node:url';
import { temporaryDirectory } from './temporary-directory.mjs';
import { bindProcessProof } from './process-proof-fixture.mjs';

const PRODUCT_PATHS = [
  'src/substrate/process.mjs',
  'src/substrate/host.mjs',
  'src/substrate/standard-error.mjs',
  'src/substrate/process-table.sh',
];
const TEST_FILE = 'test/proof-consumer.mjs';
const TEST_BYTES = Buffer.from('// ABOUTME: Supplies one owned regular test file to the source-binding fixture.\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = rows => rows.map(({ url, sha256 }) => ({ url, sha256 })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
const identity = rows => digest(JSON.stringify(ordered(rows)));
class SourceRefusal extends Error {}
const fail = reason => { throw new SourceRefusal(reason); };
const guard = (condition, reason) => { if (!condition) fail(reason); };

// The real worker awaits one-argument import(MODULE). A controlled importer returns the actual
// node:path namespace without invoking a namespace member or importing the copied product.
// Contract: https://nodejs.org/api/esm.html#import-expressions and its built-in modules section.
test('606 proof fixture: normal source capture accepts benign closure changes', async (t) => {
  const sourceBytes = PRODUCT_PATHS.map(relative => [relative, readFileSync(new URL('../' + relative, import.meta.url))]);
  const fixtures = PRODUCT_PATHS.map(edited => {
    const root = realpathSync(temporaryDirectory('606-normal-source-', { context: t }));
    for (const [relative, bytes] of [...sourceBytes, [TEST_FILE, TEST_BYTES]]) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      assert.equal(lstatSync(path).isFile(), true, 'INVALID_GUARD: fixture entry is not a regular file');
      assert.deepEqual(readFileSync(path), bytes, 'INVALID_GUARD: fixture copy changed');
    }
    return { root, edited, entry: pathToFileURL(join(root, 'src/substrate/process.mjs')).href };
  });
  const invoke = async fixture => {
    const binding = bindProcessProof(fixture.entry, { fail, guard });
    const calls = [];
    assert.ok(binding && Array.isArray(binding.closure), 'INVALID_GUARD: binding descriptor is absent');
    assert.equal(typeof binding.importProduct, 'function', 'INVALID_GUARD: import boundary is absent');
    for (const file of binding.closure) {
      assert.equal(typeof file.url, 'string', 'INVALID_GUARD: binding URL is malformed');
      assert.match(file.sha256, /^[0-9a-f]{64}$/, 'INVALID_GUARD: binding digest is malformed');
    }
    let namespace, refusal;
    try {
      namespace = await binding.importProduct(async specifier => {
        calls.push({ specifier, closure: structuredClone(binding.closure) });
        return namespaceSentinel;
      });
    } catch (error) {
      if (!(error instanceof SourceRefusal)) throw error;
      refusal = error.message;
    }
    return { binding, calls, namespace, refusal };
  };
  const controls = [];
  // All four untouched premises are established before any edited invocation.
  for (const fixture of fixtures) {
    const control = await invoke(fixture);
    const original = { edited: fixture.edited, accepted: control.refusal === undefined,
      refusal: control.refusal ?? null, importerCalls: control.calls.length,
      namespaceSame: control.namespace === namespaceSentinel, calls: control.calls,
      captured: structuredClone(control.binding.closure) };
    controls.push(original);
    process.stdout.write('606_SOURCE_CONTROL_ORIGINAL ' + JSON.stringify(original) + '\n');
    assert.equal(control.refusal, undefined, 'INVALID_GUARD: untouched H source was refused');
    assert.equal(control.namespace, namespaceSentinel, 'INVALID_GUARD: controlled namespace was not returned');
    assert.equal(control.calls.length, 1, 'INVALID_GUARD: untouched importer call count');
    assert.equal(control.calls[0].specifier, fixture.entry, 'INVALID_GUARD: untouched importer specifier');
    for (const [relative, bytes] of sourceBytes) {
      const sha256 = digest(bytes);
      const url = pathToFileURL(join(fixture.root, relative)).href;
      assert.equal(control.calls[0].closure.filter(file => file.url === url && file.sha256 === sha256).length, 1,
        'INVALID_GUARD: untouched source descriptor changed');
    }
    fixture.controlIdentity = identity(control.binding.closure);
  }
  const outcomes = [];
  for (const fixture of fixtures) {
    const target = join(fixture.root, fixture.edited);
    const comment = fixture.edited.endsWith('.sh') ? '\n# 606 benign pre-invocation fixture edit\n' : '\n// 606 benign pre-invocation fixture edit\n';
    const edited = Buffer.concat([readFileSync(target), Buffer.from(comment)]);
    writeFileSync(target, edited);
    assert.deepEqual(readFileSync(target), edited, 'INVALID_GUARD: prepared edit did not land');
    const expected = [...PRODUCT_PATHS, TEST_FILE].map(relative => ({
      url: pathToFileURL(join(fixture.root, relative)).href,
      sha256: digest(readFileSync(join(fixture.root, relative))),
    }));
    const expectedIdentity = identity(expected);
    const actual = await invoke(fixture);
    // This is an external setup guard. Wrong/unrelated refusals never reach the intended assertion.
    assert.ok(actual.refusal === undefined || actual.refusal === 'source closure fingerprint changed',
      'INVALID_GUARD: edited source failed for an unrelated reason');
    for (const file of expected) {
      assert.equal(digest(readFileSync(new URL(file.url))), file.sha256,
        'INVALID_GUARD: fixture source changed through invocation');
    }
    const captured = ordered(actual.binding.closure);
    const atImport = actual.calls.length === 1 ? ordered(actual.calls[0].closure) : null;
    outcomes.push({
      edited: fixture.edited,
      accepted: actual.refusal === undefined,
      refusal: actual.refusal ?? null,
      importerCalls: actual.calls.length,
      expectedIdentity,
      capturedIdentity: identity(captured),
      freshFromUntouched: identity(captured) !== fixture.controlIdentity,
      captureMatches: JSON.stringify(captured) === JSON.stringify(ordered(expected)),
      captureCompleteAtImport: atImport !== null && JSON.stringify(atImport) === JSON.stringify(ordered(expected)),
      specifierMatches: actual.calls.length === 1 && actual.calls[0].specifier === fixture.entry,
      namespaceSame: actual.namespace === namespaceSentinel,
    });
  }
  process.stdout.write('606_SOURCE_CAPTURE_ORIGINAL ' + JSON.stringify({ controls, outcomes }) + '\n');
  assert.deepEqual(outcomes.map(({ edited, accepted, importerCalls, captureMatches, captureCompleteAtImport,
    specifierMatches, namespaceSame, freshFromUntouched, capturedIdentity, expectedIdentity }) => ({
    edited, accepted, importerCalls, captureMatches, captureCompleteAtImport, specifierMatches, namespaceSame,
    freshFromUntouched, identityMatches: capturedIdentity === expectedIdentity,
  })), PRODUCT_PATHS.map(edited => ({ edited, accepted: true, importerCalls: 1, captureMatches: true,
    captureCompleteAtImport: true, specifierMatches: true, namespaceSame: true, freshFromUntouched: true,
    identityMatches: true })), 'normal source capture must accept valid benign edits with fresh complete identities');
});

// The strict reader is a purpose-specific parsed-Git-facts collaborator. This diagnostic
// supplies controlled facts; only the final real-Git boundary may claim repository identity.
test('606 proof fixture: strict source mismatch refuses before import', async (t) => {
  const root = realpathSync(temporaryDirectory('606-strict-source-', { context: t }));
  const sourceBytes = PRODUCT_PATHS.map(relative => [relative, readFileSync(new URL('../' + relative, import.meta.url))]);
  for (const [relative, bytes] of [...sourceBytes, [TEST_FILE, TEST_BYTES]]) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    assert.equal(lstatSync(path).isFile(), true, 'INVALID_GUARD: strict fixture is not regular');
    assert.deepEqual(readFileSync(path), bytes, 'INVALID_GUARD: strict fixture bytes changed');
  }
  const entry = pathToFileURL(join(root, 'src/substrate/process.mjs')).href;
  const src = sourceBytes.map(([path, bytes]) => ({ path, sha256: digest(bytes) }));
  const tests = [{ path: TEST_FILE, sha256: digest(TEST_BYTES) }];
  const runtime = { path: process.execPath, version: process.version, platform: process.platform,
    arch: process.arch, binarySha256: digest(readFileSync(process.execPath)) };
  // These opaque refs belong only to the controlled producer, not to the real repository.
  const base = '1'.repeat(40), head = '2'.repeat(40);
  const manifest = { base, head, runtime, inputSha256: digest(TEST_BYTES),
    srcByRef: { [base]: structuredClone(src), [head]: structuredClone(src) }, tests };
  const facts = { head, src: structuredClone(src), tests: structuredClone(tests) };
  const mismatch = structuredClone(manifest);
  mismatch.srcByRef[head].find(file => file.path === 'src/substrate/process.mjs').sha256 = '0'.repeat(64);
  const expectedMismatch = structuredClone(manifest);
  expectedMismatch.srcByRef[head][0].sha256 = '0'.repeat(64);
  assert.deepEqual(mismatch, expectedMismatch, 'INVALID_GUARD: more than the process digest changed');
  assert.notEqual(src[0].sha256, '0'.repeat(64), 'INVALID_GUARD: mismatch digest equals real source');
  assert.match(base, /^[0-9a-f]{40}$/); assert.match(head, /^[0-9a-f]{40}$/);
  assert.notEqual(base, head, 'INVALID_GUARD: controlled trial refs coincide');
  for (const file of [...src, ...tests]) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(digest(readFileSync(join(root, file.path))), file.sha256,
      'INVALID_GUARD: strict pre-invocation source differs');
  }
  const invoke = async requested => {
    let factsCalls = 0, importerCalls = 0, namespace, refusal, binding;
    const readGitFacts = observedRoot => {
      assert.equal(observedRoot, root, 'INVALID_GUARD: Git reader root differs');
      factsCalls++;
      return structuredClone(facts);
    };
    try {
      binding = bindProcessProof(entry, { fail, guard, strict: {
        manifest: requested, runtime, inputSha256: digest(TEST_BYTES), readGitFacts,
      } });
      assert.ok(binding && Array.isArray(binding.closure), 'INVALID_GUARD: strict binding missing');
      assert.equal(typeof binding.importProduct, 'function', 'INVALID_GUARD: strict importer missing');
      namespace = await binding.importProduct(async specifier => {
        assert.equal(specifier, entry, 'INVALID_GUARD: strict import specifier differs');
        importerCalls++;
        return namespaceSentinel;
      });
    } catch (error) {
      if (!(error instanceof SourceRefusal)) throw error;
      refusal = error.message;
    }
    return { refusal: refusal ?? null, factsCalls, importerCalls,
      namespaceSame: namespace === namespaceSentinel, captured: binding?.closure ?? null };
  };
  const control = await invoke(manifest);
  process.stdout.write('606_STRICT_CONTROL_ORIGINAL ' + JSON.stringify({ manifest, facts, control }) + '\n');
  assert.equal(control.refusal, null, 'INVALID_GUARD: matching strict control refused');
  assert.equal(control.importerCalls, 1, 'INVALID_GUARD: matching strict importer count');
  assert.equal(control.namespaceSame, true, 'INVALID_GUARD: matching strict namespace differs');
  const outcome = await invoke(mismatch);
  assert.ok(outcome.refusal === null || outcome.refusal === 'strict process source fingerprint changed',
    'INVALID_GUARD: unrelated strict refusal');
  for (const file of [...src, ...tests]) assert.equal(digest(readFileSync(join(root, file.path))), file.sha256,
    'INVALID_GUARD: strict source changed through invocation');
  process.stdout.write('606_STRICT_MISMATCH_ORIGINAL ' + JSON.stringify({ manifest: mismatch, facts, outcome,
    productFunctionsCalled: 0 }) + '\n');
  assert.deepEqual({ refusal: outcome.refusal, importerCalls: outcome.importerCalls },
    { refusal: 'strict process source fingerprint changed', importerCalls: 0 },
    'strict mismatched process digest must refuse before import');
});

import { CENSUS_CASES, driveCensus } from './process-proof-fixture.mjs';
import { isDeepStrictEqual } from 'node:util';

// Both consumers call the same existing driver. The controlled generator implements only
// its documented next/throw and yield/reply protocol; it invokes no product function.
test('606 proof fixture: malformed C1 original precedes its assertion', () => {
  const malformed = CENSUS_CASES.find(row => row.id === 'REPAIR-CENSUS-MALFORMED-C1-NO-PARTIAL-RETURN');
  const supporting = CENSUS_CASES.find(row => row.id === 'REPAIR-CENSUS-NONBUDGET-REFUSAL-NO-PARTIAL-RETURN');
  const expectedMessage = 'the process table held a row the census cannot read: "bad row"';
  assert.equal(malformed.yields.length, 7, 'INVALID_GUARD: malformed protocol length differs');
  assert.equal(malformed.yields.at(-1).site, 'C1#2', 'INVALID_GUARD: malformed site differs');
  assert.deepEqual(Buffer.from(malformed.yields.at(-1).reply), Buffer.from('41001 S\n41002 ?\nbad row\n'),
    'INVALID_GUARD: malformed reply bytes differ');
  assert.equal(malformed.expectedThrow, expectedMessage, 'INVALID_GUARD: authored error grammar differs');
  assert.equal(malformed.expectedNoReturn, true, 'INVALID_GUARD: malformed no-return premise differs');
  assert.equal(malformed.clock.afterSecondC1Reply, 5000, 'INVALID_GUARD: authored clock step differs');
  assert.equal(supporting.expectedError.throwCode, 'EACCES', 'INVALID_GUARD: supporting error differs');
  assert.equal(supporting.expectedError.throwMessage, '606 authored EACCES at C2#2',
    'INVALID_GUARD: supporting error text differs');
  const makeProducer = (row, produced) => function* (group, kill, deadlineMs, now, trace) {
    assert.equal(group, 41001, 'INVALID_GUARD: generator group differs');
    assert.equal(deadlineMs, 5000, 'INVALID_GUARD: generator deadline differs');
    assert.equal(typeof kill, 'function'); assert.equal(typeof now, 'function'); assert.equal(typeof trace, 'function');
    for (const step of row.yields) {
      produced.yields.push(structuredClone(step.yielded));
      let reply;
      try { reply = yield step.yielded; }
      catch (error) {
        assert.ok(step.error, 'INVALID_GUARD: unexpected generator throw');
        assert.equal(error.message, '606 authored EACCES at C2#2', 'INVALID_GUARD: injected error message differs');
        assert.equal(error.code, 'EACCES', 'INVALID_GUARD: injected error code differs');
        produced.thrown.push({ name: error.name, message: error.message, code: error.code });
        throw error;
      }
      assert.deepEqual(reply, step.reply, 'INVALID_GUARD: generator received a different reply');
      produced.replies.push(structuredClone(reply));
      if (row === malformed && step === row.yields.at(-1)) {
        const error = new Error(expectedMessage);
        produced.thrown.push({ name: error.name, message: error.message, code: error.code });
        throw error;
      }
    }
    assert.fail('INVALID_GUARD: controlled refusal generator unexpectedly returned');
  };
  const run = row => {
    const order = [], records = [], produced = { yields: [], replies: [], thrown: [] };
    const writeOriginal = line => {
      assert.equal(typeof line, 'string', 'INVALID_GUARD: original is not text');
      assert.ok(line.startsWith('606_CENSUS_ORIGINAL ') && line.endsWith('\n') &&
        !line.slice(0, -1).includes('\n'), 'INVALID_GUARD: original framing differs');
      const value = JSON.parse(line.slice('606_CENSUS_ORIGINAL '.length, -1));
      records.push({ line, value }); order.push('original');
      return true;
    };
    const assertExpectedThrow = (callback, expected) => {
      assert.deepEqual(expected, { message: expectedMessage }, 'INVALID_GUARD: equivalent assertion expectation differs');
      order.push('assert.enter');
      // Delegate the unchanged Node assertion, without catching or relabelling its result.
      const result = assert.throws(callback, expected);
      order.push('assert.complete');
      return result;
    };
    const result = driveCensus(row, makeProducer(row, produced), { writeOriginal, assertExpectedThrow });
    return { order, records, produced, result };
  };
  const control = run(supporting);
  process.stdout.write('606_C1_SINK_CONTROL_ORIGINAL ' + JSON.stringify(control) + '\n');
  assert.equal(control.records.length, 1, 'INVALID_GUARD: existing supporting original sink did not run');
  assert.equal(control.records[0].value.id, supporting.id, 'INVALID_GUARD: supporting record id differs');
  assert.deepEqual(control.records[0].value.actual, { threw: { name: 'Error',
    message: '606 authored EACCES at C2#2', code: 'EACCES' } }, 'INVALID_GUARD: supporting throw differs');
  assert.deepEqual(control.records[0].value.counters, { steps: 8, clockCalls: 0, signalCalls: 0 },
    'INVALID_GUARD: supporting counters differ');
  const actual = run(malformed);
  assert.deepEqual(actual.result, { threw: true }, 'INVALID_GUARD: existing malformed assertion result differs');
  assert.deepEqual(actual.produced.thrown, [{ name: 'Error', message: expectedMessage, code: undefined }],
    'INVALID_GUARD: controlled malformed throw differs');
  assert.equal(actual.produced.yields.length, 7, 'INVALID_GUARD: not every authored yield reached the producer');
  assert.equal(actual.produced.replies.length, 7, 'INVALID_GUARD: not every authored reply reached the producer');
  assert.equal(actual.order.filter(event => event === 'assert.enter').length, 1,
    'INVALID_GUARD: expected-error assertion did not enter exactly once');
  assert.equal(actual.order.filter(event => event === 'assert.complete').length, 1,
    'INVALID_GUARD: expected-error assertion did not complete exactly once');
  const expectedObserved = [];
  const expectedMark = (event, fields) => expectedObserved.push({ ordinal: expectedObserved.length + 1, event, ...fields });
  malformed.yields.forEach((step, index) => {
    expectedMark('yield', { step: index + 1, site: step.site, actual: step.yielded, expected: step.yielded, done: false });
    if (step.site === 'C1#2') expectedMark('clock.advance', { afterSite: 'C1#2', value: 5000 });
    expectedMark('reply', { step: index + 1, site: step.site, reply: step.reply });
  });
  const expectedError = { name: 'Error', message: expectedMessage, code: { $606: 'undefined' } };
  expectedMark('throw', { error: expectedError });
  const expectedOriginal = { id: malformed.id, authored: { yields: malformed.yields, clock: malformed.clock,
    expectedThrow: expectedMessage, expectedNoReturn: true }, observed: expectedObserved,
    actual: { threw: expectedError }, counters: { steps: 7, clockCalls: 0, signalCalls: 0 } };
  const assessment = { originalCount: actual.records.length,
    originalComplete: actual.records.length === 1 && isDeepStrictEqual(actual.records[0].value, expectedOriginal),
    originalBeforeAssertion: actual.order.indexOf('original') !== -1 &&
      actual.order.indexOf('original') < actual.order.indexOf('assert.enter') };
  process.stdout.write('606_C1_EMISSION_ORIGINAL ' + JSON.stringify({ actual, expectedOriginal, assessment,
    productFunctionsCalled: 0 }) + '\n');
  assert.deepEqual(assessment, { originalCount: 1, originalComplete: true, originalBeforeAssertion: true },
    'malformed C1 must emit exactly one complete original before its expected-error assertion');
});

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';

const PROCESS_PATH = 'src/substrate/process.mjs';
// Names an owned directory outside the checkout and TMPDIR for a recorded run. Unset, the test owns
// a temporary one. The native reader appends each Git child, as it spawns and as it closes, to
// native-children.jsonl in the directory this variable names during the test.
const NATIVE_RECEIPT_ROOT = 'RIGGER_606_NATIVE_RECEIPT_ROOT';
// Every size, SHA-256 and Git id below was derived from the literal bytes with sha256sum, sha1sum
// and `git hash-object`, never from the reader under test. Commit ids carry a clock, so the
// fixture reads them; tree ids carry only these bytes, so they stay literal.
const nativeFile = (path, bytes, size, sha256, blob) => ({ path, bytes, size, sha256, blob });
const OPAQUE = nativeFile('src/substrate/opaque.bin', Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x00, 0xc3, 0x28]), 8,
  'abb5e3d6ce7a4942ee6ff56c42c82676713b64375bc9e721cde022ae3969be6d', 'bf4f993732f79751e05a52746326aeefa9d81930');
const BASE_PROCESS = nativeFile(PROCESS_PATH,
  Buffer.from("// ABOUTME: Base process bytes for the owned native-Git fixture.\nexport const side = 'base';\n"), 93,
  '1d959de728c5867d6770fb00be04f09c6fceb5fb5f6f87f2aaff79b7d8d020b6', '41d5bd7749cf8f1fd8387d4c59c57622969b674f');
const HEAD_PROCESS = nativeFile(PROCESS_PATH,
  Buffer.from("// ABOUTME: Head process bytes for the owned native-Git fixture.\nexport const side = 'head';\n"), 93,
  'd2c9ee2a33fbef7af57abc2b29dc4a2c2e50c46a70120189b66eb9ec22ecfa4c', 'edfb0c0e867e91087beeb54e978e5d1109fc0c86');
const SPACED = nativeFile('src/substrate/space name.mjs',
  Buffer.from('// ABOUTME: Carries a space in its path through the native-Git fixture.\nexport const spaced = true;\n'), 100,
  '89125c2612bcf3895cef321c4635efbc843e1399cdb7bac77f8691725ff54757', 'b0ee60772cda1cb239a82604fe3e70947fd117d9');
const UNCHANGED = nativeFile('src/substrate/unchanged.mjs',
  Buffer.from('// ABOUTME: Stays identical across both native-Git fixture commits.\nexport const unchanged = true;\n'), 99,
  'f0593b4618f624e6f2484d50bcd10a9521d1b770acfa1098731f71b81379a973', '00376dd9485d0c20653900eb11ddfd4935d54e7d');
const NATIVE_TEST = nativeFile(TEST_FILE, TEST_BYTES, 80,
  '2c777556df4a0905b1729eac84a7f60cd38b933e89300510bd4eed22756d8ae0', 'f75885f7d6b65e6cebc5f4d2d9e24da5275355bf');
const BASE_FILES = [OPAQUE, BASE_PROCESS, SPACED, UNCHANGED];
const HEAD_FILES = [OPAQUE, HEAD_PROCESS, SPACED, UNCHANGED];
const BASE_TREE = '9234a61d1f4b007da76bc7f285812a9a0d96bbd4';
const HEAD_TREE = '89a04c22823f92616ba301a22a5b58365225ad9c';
const NATIVE_INPUT = Buffer.from('606 native Git fixture input: two commits, five files, one nonselected digest change.\n');
const NATIVE_INPUT_SHA256 = '2ff520d5ede00451e874cb500fd5dcd4468c0292371ca8ecdac41bb46fc0f334';
const FROZEN_MAP_REFUSAL = 'strict frozen source map differs from Git';
const sourceRows = files => files.map(({ path, sha256 }) => ({ path, sha256 }));
const treeListing = files => files.map(({ path, blob }) => `100644 blob ${blob}\t${path}\0`).join('');

// The controlled reader follows the strict collaborator contract the second diagnostic uses: it is
// handed the fixture root and answers { head, src, tests }, here facts qualified against real Git.
test('606 proof fixture: native Git binding checks both frozen source maps', async (t) => {
  const supplied = process.env[NATIVE_RECEIPT_ROOT];
  const checkout = realpathSync(new URL('../', import.meta.url));
  const within = (path, parent) => {
    const route = relative(parent, path);
    return route === '' || !(route === '..' || route.startsWith('../') || isAbsolute(route));
  };
  if (supplied !== undefined) {
    assert.ok(isAbsolute(supplied) && realpathSync(supplied) === supplied && lstatSync(supplied).isDirectory(),
      'INVALID_GUARD: receipt root is not an absolute real directory');
    // An official mutation run places its disposable tree directly under its enclosing root.
    for (const disposable of [dirname(checkout), realpathSync(tmpdir())]) {
      assert.equal(within(supplied, disposable), false, 'INVALID_GUARD: receipt root is disposable');
    }
  }
  const run = join(supplied ?? realpathSync(temporaryDirectory('606-native-git-', { context: t })), `run-${process.pid}`);
  const root = join(run, 'repository');
  mkdirSync(run);
  process.env[NATIVE_RECEIPT_ROOT] = run;
  t.after(() => {
    if (supplied === undefined) delete process.env[NATIVE_RECEIPT_ROOT];
    else process.env[NATIVE_RECEIPT_ROOT] = supplied;
  });

  const custody = [];
  const record = entry => {
    const event = { ordinal: custody.length + 1, callerPid: process.pid, ...entry };
    custody.push(event);
    appendFileSync(join(run, 'fixture-custody.jsonl'), JSON.stringify(event) + '\n');
    return event;
  };
  // The unchanged synchronous utilities expose no child PID, raw stderr or integer failure status.
  const completed = (utility, argv, call) => {
    record({ event: 'start', utility, root, argv });
    try {
      const answer = call();
      record({ event: 'complete', utility, root, argv, answer });
      return answer;
    } catch (error) {
      record({ event: 'threw', utility, root, argv, error: error.message });
      throw error;
    }
  };
  const git = (subcommand, ...argv) => completed('gitIn', [subcommand, ...argv], {
    'rev-parse': () => gitIn(root, 'rev-parse', ...argv),
    'ls-tree': () => gitIn(root, 'ls-tree', ...argv),
    status: () => gitIn(root, 'status', ...argv),
    add: () => gitIn(root, 'add', ...argv),
    commit: () => gitIn(root, 'commit', ...argv),
  }[subcommand]);
  const readBlob = (ref, path) => new Promise((resolve, reject) => {
    const argv = ['-C', root, 'cat-file', 'blob', `${ref}:${path}`];
    const child = spawn('git', ['-C', root, 'cat-file', 'blob', `${ref}:${path}`], { env: gitEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    record({ event: 'spawned', pid: child.pid, argv });
    const stdout = [], stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(record({ event: 'closed', pid: child.pid, argv, code, signal,
      stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') })));
  });
  const checkFiles = files => {
    for (const file of files) {
      const path = join(root, file.path);
      assert.equal(lstatSync(path).isFile(), true, 'INVALID_GUARD: native fixture entry is not regular');
      assert.deepEqual(readFileSync(path), file.bytes, 'INVALID_GUARD: native fixture bytes differ');
    }
  };

  for (const file of new Set([...BASE_FILES, ...HEAD_FILES, NATIVE_TEST])) {
    assert.deepEqual({ size: file.bytes.length, sha256: digest(file.bytes) }, { size: file.size, sha256: file.sha256 },
      'INVALID_GUARD: authored native literal differs');
    assert.ok(file.size <= 1024, 'INVALID_GUARD: native fixture file exceeds its bound');
  }
  assert.equal(digest(NATIVE_INPUT), NATIVE_INPUT_SHA256, 'INVALID_GUARD: authored input literal differs');
  const baseTree = [...BASE_FILES, NATIVE_TEST], headTree = [...HEAD_FILES, NATIVE_TEST];
  completed('repositoryAt', baseTree.map(file => file.path), () => repositoryAt(root,
    Object.fromEntries(baseTree.map(file => [file.path, file.bytes]))));
  checkFiles(baseTree);
  const base = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(root, PROCESS_PATH), HEAD_PROCESS.bytes);
  checkFiles(headTree);
  git('add', '-A');
  git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD').trim();
  assert.match(base, /^[0-9a-f]{40}$/, 'INVALID_GUARD: fixture base is not a commit id');
  assert.match(head, /^[0-9a-f]{40}$/, 'INVALID_GUARD: fixture head is not a commit id');
  assert.notEqual(base, head, 'INVALID_GUARD: fixture commits coincide');
  assert.equal(git('rev-parse', 'HEAD~1').trim(), base, 'INVALID_GUARD: fixture head does not follow base');
  assert.equal(git('rev-parse', `${base}^{tree}`).trim(), BASE_TREE, 'INVALID_GUARD: fixture base tree differs');
  assert.equal(git('rev-parse', `${head}^{tree}`).trim(), HEAD_TREE, 'INVALID_GUARD: fixture head tree differs');
  assert.equal(git('ls-tree', '-r', '-z', base), treeListing(baseTree), 'INVALID_GUARD: fixture base listing differs');
  assert.equal(git('ls-tree', '-r', '-z', head), treeListing(headTree), 'INVALID_GUARD: fixture head listing differs');
  assert.equal(git('status', '--porcelain=v1', '-z'), '', 'INVALID_GUARD: fixture worktree is not clean');
  for (const [ref, files] of [[base, baseTree], [head, headTree]]) {
    for (const file of files) {
      const read = await readBlob(ref, file.path);
      assert.ok(Number.isSafeInteger(read.pid) && read.pid > 0, 'INVALID_GUARD: binary readiness child has no PID');
      assert.deepEqual({ code: read.code, signal: read.signal, stderrBase64: read.stderrBase64 },
        { code: 0, signal: null, stderrBase64: '' }, 'INVALID_GUARD: binary readiness child failed');
      assert.deepEqual(Buffer.from(read.stdoutBase64, 'base64'), file.bytes, 'INVALID_GUARD: binary readiness bytes differ');
    }
  }
  process.stdout.write('606_NATIVE_FIXTURE_ORIGINAL ' + JSON.stringify(custody) + '\n');

  const entry = pathToFileURL(join(root, PROCESS_PATH)).href;
  const runtime = { path: process.execPath, version: process.version, platform: process.platform,
    arch: process.arch, binarySha256: digest(readFileSync(process.execPath)) };
  const manifest = { base, head, runtime, inputSha256: NATIVE_INPUT_SHA256,
    srcByRef: { [base]: sourceRows(BASE_FILES), [head]: sourceRows(HEAD_FILES) }, tests: sourceRows([NATIVE_TEST]) };
  const facts = { head, src: sourceRows(HEAD_FILES), tests: sourceRows([NATIVE_TEST]) };
  let factsCalls = 0;
  const controlImports = [];
  const controlled = bindProcessProof(entry, { fail, guard, strict: { manifest, runtime, inputSha256: NATIVE_INPUT_SHA256,
    readGitFacts: observedRoot => {
      assert.equal(observedRoot, root, 'INVALID_GUARD: controlled reader root differs');
      factsCalls++;
      return structuredClone(facts);
    } } });
  assert.equal(typeof controlled?.importProduct, 'function', 'INVALID_GUARD: controlled binding is absent');
  const controlledNamespace = await controlled.importProduct(async specifier => {
    controlImports.push(specifier);
    return namespaceSentinel;
  });
  assert.ok(factsCalls > 0, 'INVALID_GUARD: controlled reader was not consulted');
  assert.deepEqual(controlImports, [entry], 'INVALID_GUARD: controlled importer call differs');
  assert.equal(controlledNamespace, namespaceSentinel, 'INVALID_GUARD: controlled namespace differs');

  const changed = structuredClone(manifest);
  changed.srcByRef[base].find(row => row.path === PROCESS_PATH).sha256 = '0'.repeat(64);
  const expectedChanged = structuredClone(manifest);
  expectedChanged.srcByRef[base][1].sha256 = '0'.repeat(64);
  assert.deepEqual(changed, expectedChanged, 'INVALID_GUARD: more than the nonselected process digest changed');
  assert.notEqual(BASE_PROCESS.sha256, '0'.repeat(64), 'INVALID_GUARD: changed digest equals the real source');

  const nativeChildren = () => {
    const path = join(run, 'native-children.jsonl');
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  const observe = async requested => {
    const before = nativeChildren().length, imports = [];
    let accepted = false, namespace, refusal = null;
    try {
      const binding = await bindProcessProof(entry, { fail, guard, strict: {
        manifest: requested, runtime, inputSha256: NATIVE_INPUT_SHA256, readGitFacts: 'native',
      } });
      assert.equal(typeof binding?.importProduct, 'function', 'INVALID_GUARD: native binding is malformed');
      accepted = true;
      namespace = await binding.importProduct(async specifier => {
        imports.push({ specifier, childEvents: nativeChildren().length - before });
        return namespaceSentinel;
      });
    } catch (error) {
      if (!(error instanceof SourceRefusal)) throw error;
      refusal = error.message;
    }
    return { accepted, refusal, imports, namespaceSame: namespace === namespaceSentinel,
      children: nativeChildren().slice(before) };
  };
  const valid = await observe(manifest);
  const refused = await observe(changed);
  const original = '606_NATIVE_TARGET_ORIGINAL ' + JSON.stringify({ manifest, changed, valid, refused,
    productFunctionsCalled: 0 }) + '\n';
  appendFileSync(join(run, 'target-original.jsonl'), original);
  process.stdout.write(original);

  const namedRefusal = refused.refusal !== null && refused.refusal.startsWith(FROZEN_MAP_REFUSAL) &&
    refused.refusal.includes(base) && refused.refusal.includes(PROCESS_PATH);
  // A helper with no native reader answers its ordinary malformed-request refusal; any other
  // reason is unrelated to this contract and stops the run as invalid.
  assert.ok(valid.refusal === null || valid.refusal === 'strict request malformed',
    'INVALID_GUARD: unrelated refusal of the valid native request');
  assert.ok(refused.refusal === null || refused.refusal === 'strict request malformed' || namedRefusal,
    'INVALID_GUARD: unrelated refusal of the changed native request');
  checkFiles(headTree);
  assert.equal(git('rev-parse', 'HEAD').trim(), head, 'INVALID_GUARD: fixture head moved through invocation');
  assert.equal(git('status', '--porcelain=v1', '-z'), '', 'INVALID_GUARD: fixture changed through invocation');

  const blobsIn = events => [...new Set(events.filter(event => event.event === 'closed' && event.argv.includes('cat-file'))
    .map(event => digest(Buffer.from(event.stdoutBase64, 'base64'))))].sort();
  const custodyOf = events => {
    const spawned = events.filter(event => event.event === 'spawned');
    const closed = events.filter(event => event.event === 'closed');
    const pids = rows => rows.map(row => row.pid).sort((one, other) => one - other);
    return {
      everyChildClosed: spawned.length > 0 && isDeepStrictEqual(pids(spawned), pids(closed)),
      everyPidReal: spawned.every(row => Number.isSafeInteger(row.pid) && row.pid > 0 && row.pid !== process.pid),
      everyCloseClean: closed.every(row => row.code === 0 && row.signal === null),
      bothRefsRead: [base, head].every(ref => closed.some(row => row.argv.some(word => word.includes(ref)))),
    };
  };
  const expectedBlobs = [...new Set([...baseTree, ...headTree].map(file => file.sha256))].sort();
  assert.deepEqual({
    accepted: valid.accepted,
    refusal: valid.refusal,
    importerCalls: valid.imports.length,
    specifierMatches: valid.imports[0]?.specifier === entry,
    namespaceSame: valid.namespaceSame,
    blobs: blobsIn(valid.children),
    blobsBeforeImport: blobsIn(valid.children.slice(0, valid.imports[0]?.childEvents ?? 0)),
    ...custodyOf(valid.children),
  }, {
    accepted: true,
    refusal: null,
    importerCalls: 1,
    specifierMatches: true,
    namespaceSame: true,
    blobs: expectedBlobs,
    blobsBeforeImport: expectedBlobs,
    everyChildClosed: true,
    everyPidReal: true,
    everyCloseClean: true,
    bothRefsRead: true,
  }, 'native Git binding must accept the valid frozen manifest');
  assert.deepEqual({ namedRefusal, importerCalls: refused.imports.length, ...custodyOf(refused.children) },
    { namedRefusal: true, importerCalls: 0, everyChildClosed: true, everyPidReal: true, everyCloseClean: true, bothRefsRead: true },
    'native Git binding must refuse a changed nonselected source map before import');
});
