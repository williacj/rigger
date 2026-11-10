// ABOUTME: Tests host reporting through the workflow's actual invocation step without processes or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { ci, hostInvocationCommand, hostInvocationArgv, reportInvocation, captureHostScenario, observeHostStep, startupInspectionFixture, heldWriteDestination } from './ci-host-fixtures.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { npm11StartupInspectionFixture } from './ci-host-fixtures.mjs';

// The local reader changes only repository observations; retained npm/config facts still delegate unchanged.
function repositoryByteInspection(fixture, readRepository = readFileSync) {
  const paths = new Set(['.npmrc', 'test/suite.sh', 'test/suite-guard.cjs'].map(path => join(fixture.cwd, path)));
  const fingerprint = fixture.inspection.fingerprint;
  return { ...fixture.inspection, fingerprint: async path => paths.has(path)
    ? createHash('sha256').update(readRepository(path)).digest('hex')
    : fingerprint(path) };
}

// Break: copied repository fingerprints can qualify fixtures while actual unchanged checkout bytes are refused.
// This repository-CI diagnostic uses retained external profiles; it certifies no installed npm or Mac invocation.
test('actual repository bytes qualify supported npm startup profiles and retain the reporting parent key', async () => {
  const parent = 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26';
  const argv = ['npm', 'run', 'test:host', '--', '--test-reporter=spec', '--test-reporter=junit', '--test-reporter-destination=stdout', '--test-reporter-destination=/runner-temp/host-tests.junit.xml'];
  for (const profile of [
    { name: 'npm12', fixture: startupInspectionFixture, version: '12.2.2', prefix: '' },
    { name: 'npm11', fixture: npm11StartupInspectionFixture, version: '11.20.0', prefix: '\n> @williacj/rigger@0.1.0 test:host\n> sh test/suite.sh --host --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=/runner-temp/host-tests.junit.xml\n\n' },
  ]) {
    const stdout = profile.prefix + parent + '\nworker output\nmacos26-20261102.0473.1-ARM64-node26\n';
    const { result } = await captureHostScenario({
      stdout: new EventEmitter(), stderr: new EventEmitter(), inspection: repositoryByteInspection(profile.fixture()),
      produce: child => {
        child.emit('spawn'); child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
        child.stdout.emit('end'); child.stdout.emit('close');
        child.stderr.emit('end'); child.stderr.emit('close');
        child.emit('exit', 0, null); child.emit('close', 0, null);
      },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, Buffer.from(stdout, 'utf8'));
    assert.deepEqual(result.startup, { argv, npmVersion: profile.version, stdoutPrefix: profile.prefix, capture: { state: 'complete' } },
      'actual repository bytes must qualify the ' + profile.name + ' startup descriptor');
    const { observed } = await reportInvocation(Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
    assert.equal(observed.hostKey, parent, 'qualified ' + profile.name + ' reporting must retain the parent key');
    assert.equal(observed.stepOutcome, 'success');
  }
});


// A controlled byte view changes one repository observation; all other reads remain actual checkout bytes.
function changedRepositoryByte(original) {
  assert.ok(original.length > 0, 'the opened repository source has a byte to change');
  const changed = Buffer.from(original);
  changed[0] ^= 1;
  assert.notDeepEqual(changed, original, 'the controlled repository byte view must differ');
  return changed;
}

async function assertRepositoryObservationRefused(relative, byteView) {
  for (const profile of [
    { name: 'npm12', fixture: startupInspectionFixture, prefix: '' },
    { name: 'npm11', fixture: npm11StartupInspectionFixture, prefix: '\n> @williacj/rigger@0.1.0 test:host\n> sh test/suite.sh --host --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=/runner-temp/host-tests.junit.xml\n\n' },
  ]) {
    const fixture = profile.fixture();
    const selected = join(fixture.cwd, relative);
    const inspection = repositoryByteInspection(fixture, path => {
      const original = readFileSync(path);
      return path === selected ? byteView(original) : original;
    });
    const stdout = Buffer.from(profile.prefix + 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\nworker output\n', 'utf8');
    const stderr = Buffer.from('controlled worker stderr\n', 'utf8');
    const { result, forwardedStdout, forwardedStderr } = await captureHostScenario({
      stdout: new EventEmitter(), stderr: new EventEmitter(), inspection,
      produce: child => {
        child.emit('spawn'); child.stdout.emit('data', stdout); child.stderr.emit('data', stderr);
        child.stdout.emit('end'); child.stdout.emit('close');
        child.stderr.emit('end'); child.stderr.emit('close');
        child.emit('exit', 0, null); child.emit('close', 0, null);
      },
    });
    assert.equal(result.exitCode, 0, 'qualification refusal preserves the successful child exit');
    assert.equal(result.signal, null);
    assert.deepEqual(result.stdoutCapture, { state: 'complete' });
    assert.deepEqual(result.ioFailures, []);
    assert.deepEqual(result.stdout, stdout);
    assert.deepEqual(result.stderr, stderr);
    assert.deepEqual(Buffer.concat(forwardedStdout), stdout);
    assert.deepEqual(Buffer.concat(forwardedStderr), stderr);
    const { observed } = await reportInvocation(Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
    assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
    assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
    assert.equal(observed.stepOutcome, 'success');
    assert.equal(result.startup, undefined, relative + ' refusal must leave ' + profile.name + ' startup unavailable');
    assert.equal(observed.hostKey, undefined, relative + ' refusal must leave ' + profile.name + ' parent key unavailable');
  }
}

// Break: ignoring the repository-source inequality can qualify independently changed .npmrc bytes.
test('changed .npmrc observation refuses startup and parent key under both npm profiles', async () => {
  await assertRepositoryObservationRefused('.npmrc', changedRepositoryByte);
});

// Break: ignoring the repository-source inequality can qualify independently changed suite-script bytes.
test('changed test/suite.sh observation refuses startup and parent key under both npm profiles', async () => {
  await assertRepositoryObservationRefused('test/suite.sh', changedRepositoryByte);
});

// Break: ignoring the repository-source inequality can qualify independently changed suite-guard bytes.
test('changed test/suite-guard.cjs observation refuses startup and parent key under both npm profiles', async () => {
  await assertRepositoryObservationRefused('test/suite-guard.cjs', changedRepositoryByte);
});

// Break: a rejected repository byte read must never fall back to a copied expected fingerprint.
// ENOENT is controlled after opening the existing source; no real missing-file claim is made.
test('unreadable .npmrc observation refuses startup and parent key under both npm profiles', async () => {
  await assertRepositoryObservationRefused('.npmrc', () => {
    throw Object.assign(new Error('controlled repository read rejection'), { code: 'ENOENT' });
  });
});

// The successful command and printed key follow the retained Node26 existing-host qualification.
// The missing-file double follows fs/promises.readFile's rejected ENOENT contract.
// Break: host success must not pass when that invocation's JUnit report is absent (card #1115 AC2).
test('successful host invocation without its JUnit report fails reporting and retains the host success', async () => {
  const { observed, commands, reads, outputWrites: writes } = await reportInvocation();
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'failure', 'a successful host invocation with no JUnit report must fail reporting');
  assert.deepEqual(observed.reporting, { state: 'absent', outcome: 'failure', message: 'Host JUnit report is absent' });
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(writes, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  const step = ci.jobs.full_host.steps.find(entry => entry.id === 'host_tests');
  assert.equal(step.env.CI_HOST_REPORT_NAME, 'host-tests.junit.xml');
  assert.equal(step.run, hostInvocationCommand);
  assert.equal(Object.hasOwn(step.env, 'NODE_OPTIONS'), false);
});

// Break: a parser callback before an unclosed root cannot make the whole report usable.
// Independent oracle: the literal XML below lacks </testsuites>; card #1115 rejects the entire report.
test('successful host invocation rejects a truncated JUnit report without partial failed-test names', async () => {
  const { observed, commands, reads, outputWrites: writes } = await reportInvocation(Buffer.from('<testsuites><testcase name="reported before truncation"><failure/></testcase>', 'utf8'));
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'failure', 'a truncated JUnit document must fail reporting after preserving host success');
  assert.deepEqual(observed.reporting, { state: 'unparsable', outcome: 'failure', message: 'Host JUnit report is unparsable' });
  assert.equal(Object.hasOwn(observed.reporting, 'failedNames'), false, 'partial callbacks must not publish failure names');
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(writes, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
});

// Node26's retained real JUnit report places flat testcases directly under testsuites.
test('complete flat Node JUnit reports distinguish valid zero failures from missing reports', async () => {
  const { observed } = await reportInvocation(Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'));
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'success');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
});

// Independent decoded literals: two failed cases share a name; two failure elements in one case still name one case.
test('nested JUnit suites preserve decoded repeated failed-case names independently of host failure', async () => {
  const xml = '<testsuites><testsuite name="parent"><testsuite name="inner"><testcase name="A &amp; B &#x3C; &#39;"><failure/><error/></testcase><testcase name="A &amp; B &#x3C; &#39;"><error/></testcase><testcase name="pass"/></testsuite></testsuite></testsuites>';
  const { observed, outputWrites: writes } = await reportInvocation(Buffer.from(xml, 'utf8'), { exitCode: 1 });
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.stepOutcome, 'failure');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: ["A & B < '", "A & B < '"] });
  assert.deepEqual(writes, [['/step-output', 'host_outcome=failure\nhost_exit_code=1\n']]);
});

async function assertUnparsableReport(bytes) {
  const { observed } = await reportInvocation(bytes);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'failure', 'invalid whole-report bytes must fail reporting');
  assert.deepEqual(observed.reporting, { state: 'unparsable', outcome: 'failure', message: 'Host JUnit report is unparsable' });
}

// Characterization: counters are not failed cases and cannot invent failed-test names.
test('valid zero-failure reports ignore failure counters without inventing test names', async () => {
  const { observed } = await reportInvocation(Buffer.from('<testsuites tests="2" failures="9"><testcase name="pass"/></testsuites>', 'utf8'), { exitCode: 1 });
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.stepOutcome, 'failure');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
});

test('invalid UTF8 rejects the report before XML callbacks can publish names', async () => {
  await assertUnparsableReport(Buffer.concat([Buffer.from('<testsuites/>', 'utf8'), Buffer.from([0xff])]));
});

test('trailing non-XML bytes reject an earlier complete failed testcase', async () => {
  await assertUnparsableReport(Buffer.from('<testsuites><testcase name="tentative"><failure/></testcase></testsuites>not XML', 'utf8'));
});

test('mismatched XML rejects an earlier complete failed testcase', async () => {
  await assertUnparsableReport(Buffer.from('<testsuites><testcase name="tentative"><failure/></testcase></testsuite>', 'utf8'));
});

test('well-formed XML with a non-JUnit root is an unusable report', async () => {
  await assertUnparsableReport(Buffer.from('<not-junit><testcase name="tentative"><failure/></testcase></not-junit>', 'utf8'));
});

test('JUnit reports reject a DOCTYPE even without an entity reference', async () => {
  await assertUnparsableReport(Buffer.from('<!DOCTYPE testsuites [<!ENTITY forbidden "value">]><testsuites/>', 'utf8'));
});

test('JUnit suite and case structure rejects misplaced child elements', async () => {
  for (const xml of [
    '<testsuites><failure/></testsuites>',
    '<testsuites><testsuite><failure/></testsuite></testsuites>',
    '<testsuites><testcase name="outer"><testcase name="inner"><failure/></testcase></testcase></testsuites>',
    '<testsuites><testcase name="outer"><testsuite/></testcase></testsuites>',
    '<testsuites><unknown><testcase name="hidden"><failure/></testcase></unknown></testsuites>',
  ]) await assertUnparsableReport(Buffer.from(xml, 'utf8'));
});

test('JUnit testcases without a name are unusable rather than guessed failures', async () => {
  await assertUnparsableReport(Buffer.from('<testsuites><testcase><failure/></testcase></testsuites>', 'utf8'));
});

test('JUnit containers reject non-whitespace text and CDATA outside case result elements', async () => {
  for (const xml of [
    '<testsuites>not JUnit<testcase name="pass"/></testsuites>',
    '<testsuites><testsuite>not JUnit</testsuite></testsuites>',
    '<testsuites><testcase name="pass">not JUnit</testcase></testsuites>',
    '<testsuites><![CDATA[not JUnit]]><testcase name="pass"/></testsuites>',
  ]) await assertUnparsableReport(Buffer.from(xml, 'utf8'));
});

// Characterization of complete direct cases: result text is data; a skipped case is not a failed case.
test('complete flat cases accept result text and whitespace while excluding skipped cases', async () => {
  const xml = '<testsuites>\n  <testcase name="flat"><failure><![CDATA[trace with <markup> & symbols]]></failure></testcase>\n  <testcase name="skipped"><skipped>reason</skipped></testcase>\n</testsuites>';
  const { observed } = await reportInvocation(Buffer.from(xml, 'utf8'), { exitCode: 1 });
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.stepOutcome, 'failure');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: ['flat'] });
});

// Independent literal oracle: both decoded failed cases must appear in the summary, including the repeated name.
test('failed host invocation summarizes every decoded repeated failed-case name', async () => {
  const xml = '<testsuites><testcase name="A &amp; B"><failure/></testcase><testcase name="A &amp; B"><error/></testcase></testsuites>';
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(Buffer.from(xml, 'utf8'), { exitCode: 1 });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.stepOutcome, 'failure');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: ['A & B', 'A & B'] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=failure\nhost_exit_code=1\n']]);
  const expected = '## Failed host tests\n\n```json\n[\n  "A & B",\n  "A & B"\n]\n```\n';
  assert.deepEqual(summaryWrites, [['/step-summary', expected]], 'the job summary must contain every decoded failed-case name including repeats');
});

// Each independent literal row states one AC4 or AC14 outcome; the shared body observes the actual inline invocation.
const fallbackSummaryCases = [
  {
    name: 'failed host invocation reports an absent JUnit report and unavailable test names',
    report: undefined,
    reporting: { state: 'absent', outcome: 'failure', message: 'Host JUnit report is absent' },
    summary: '## Host test report\n\nJUnit report is absent; failed-test names are unavailable.\n',
  },
  {
    name: 'failed host invocation reports an unparsable JUnit report and unavailable test names',
    report: '<testsuites><testcase name="tentative"><failure/></testcase>',
    reporting: { state: 'unparsable', outcome: 'failure', message: 'Host JUnit report is unparsable' },
    summary: '## Host test report\n\nJUnit report is unparsable; failed-test names are unavailable.\n',
  },
  {
    name: 'failed host invocation reports valid JUnit without a reported test failure',
    report: '<testsuites><testcase name="pass"/></testsuites>',
    reporting: { state: 'valid', outcome: 'success', failedNames: [] },
    summary: '## Host test report\n\nHost step failed without a reported test failure.\n',
  },
];
for (const entry of fallbackSummaryCases) {
  test(entry.name, async () => {
    const report = entry.report === undefined ? undefined : Buffer.from(entry.report, 'utf8');
    const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(report, { exitCode: 1 });
    assert.deepEqual(commands, [hostInvocationCommand]);
    assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
    assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
    assert.equal(observed.stepOutcome, 'failure');
    assert.deepEqual(observed.reporting, entry.reporting);
    assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=failure\nhost_exit_code=1\n']]);
    assert.deepEqual(summaryWrites, [['/step-summary', entry.summary]], 'the failed-host summary must state the report outcome when no failed-case names are available');
  });
}

// Break: later worker lookalikes must neither replace nor invalidate the qualified parent key.
// The trusted descriptor describes complete original stdout. Its empty npm12 prefix is observed
// with a file operand; the unchanged no-operand startup follows the separately retained source audit.
test('qualified npm12 startup preserves the parent key despite later worker lookalikes', async () => {
  const stdout = 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\nworker output\nlinux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\nmacos26-20261026.0455.2-ARM64-node26\n';
  const startup = { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } };
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { stdout, startup });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'success');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26', 'the qualified complete startup must retain its exact parent key');
});

// Break: a plausible startup record cannot establish key availability after known capture loss.
// The trusted collector maps missing EOF or known dropped bytes to truncation, and stream errors
// to read-error; complete collection requires EOF and close without either failure.
test('known incomplete stdout captures cannot publish a plausible parent key', async () => {
  const keys = [];
  for (const capture of [
    { state: 'incomplete', reason: 'truncated' },
    { state: 'incomplete', reason: 'read-error' },
  ]) {
    const startup = { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture };
    const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
      Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'),
      { stdout: 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', startup });
    assert.deepEqual(commands, [hostInvocationCommand]);
    assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
    assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
    assert.equal(observed.stepOutcome, 'success');
    assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
    assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
    assert.deepEqual(summaryWrites, []);
    keys.push(observed.hostKey);
  }
  assert.deepEqual(keys, [undefined, undefined], 'known incomplete captures must leave the parent key unavailable');
});

// Break: independently decoding data chunks loses a multibyte character split by Readable chunking.
// Child/Readable doubles follow the frozen Node data/end/close contract; they make no real-host claim.
test('actual host collector preserves split multibyte stdout bytes and separate stderr', async () => {
  const { result, commands, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    produce: child => {
      child.emit('spawn');
      child.stdout.emit('data', Buffer.from([0x41, 0xe2]));
      child.stderr.emit('data', Buffer.from('separate stderr\n', 'utf8'));
      child.stdout.emit('data', Buffer.from([0x82, 0xac, 0x42, 0x0a]));
      child.stdout.emit('end'); child.stdout.emit('close');
      child.stderr.emit('end'); child.stderr.emit('close');
      child.emit('exit', 0, null); child.emit('close', 0, null);
    },
  });
  assert.deepEqual(commands, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(forwardedStdout, [Buffer.from('41e2', 'hex'), Buffer.from('82ac420a', 'hex')]);
  assert.deepEqual(forwardedStderr, [Buffer.from('7365706172617465207374646572720a', 'hex')]);
  assert.deepEqual(result.stdout, Buffer.from('41e282ac420a', 'hex'), 'the collector must retain split UTF8 stdout as original bytes');
  assert.deepEqual(result.stderr, Buffer.from('7365706172617465207374646572720a', 'hex'));
});

// Break: child close with exit0 does not establish consumed stdout EOF.
// PassThrough.destroy() provides a real documented close-without-end stream path;
// child close is emitted only after both actual stream close events, preserving chronology.
test('actual host collector distinguishes consumed stdout EOF from close without EOF', async () => {
  const statuses = [];
  for (const completion of ['end', 'destroy']) {
    const stdout = new PassThrough(), stderr = new PassThrough();
    let stdoutEnded = false, stderrEnded = false;
    stdout.on('end', () => { stdoutEnded = true; });
    stderr.on('end', () => { stderrEnded = true; });
    const { result, child, commands, forwardedStdout, forwardedStderr } = await captureHostScenario({
      stdout, stderr,
      produce: child => {
        const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
        child.emit('spawn');
        child.stdout.write(Buffer.from('same stdout\n', 'utf8'));
        child.stderr.end(Buffer.from('same stderr\n', 'utf8'));
        if (completion === 'end') child.stdout.end();
        else child.stdout.destroy();
        closed.then(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
      },
    });
    assert.deepEqual(commands, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
    assert.equal(stdoutEnded, completion === 'end');
    assert.equal(stderrEnded, true);
    assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, Buffer.from('73616d65207374646f75740a', 'hex'));
    assert.deepEqual(result.stderr, Buffer.from('73616d65207374646572720a', 'hex'));
    assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('73616d65207374646f75740a', 'hex'));
    assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('73616d65207374646572720a', 'hex'));
    statuses.push(result.stdoutCapture);
  }
  assert.deepEqual(statuses, [{ state: 'complete' }, { state: 'incomplete', reason: 'truncated' }],
    'stdout capture status must distinguish consumed EOF from close without EOF');
});

// Break: a known stdout read error must not be reported merely as missing EOF or complete capture.
// Independent observers consume the real stream error and close; child close remains last.
test('actual host collector retains partial bytes and direct outcome after a stdout read error', async () => {
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled stdout read failure'), errors = [];
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  stdout.on('error', error => { errors.push(error); });
  stdout.on('end', () => { stdoutEnded = true; });
  stderr.on('end', () => { stderrEnded = true; });
  const { result, child, commands, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout, stderr,
    produce: child => {
      const stdoutClosed = new Promise(resolve => child.stdout.once('close', resolve));
      const stderrClosed = once(child.stderr, 'close');
      child.once('close', () => { childClosed = true; });
      child.emit('spawn');
      child.stdout.write(Buffer.from('partial stdout\n', 'utf8'));
      child.stderr.end(Buffer.from('complete stderr\n', 'utf8'));
      child.stdout.destroy(failure);
      Promise.all([stdoutClosed, stderrClosed]).then(() => {
        child.emit('exit', 0, null); child.emit('close', 0, null);
      });
    },
  });
  assert.deepEqual(commands, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.deepEqual(errors, [failure]);
  assert.equal(stdout.errored, failure);
  assert.equal(stdoutEnded, false); assert.equal(stderrEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(childClosed, true, 'collection must settle after child close');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.from('7061727469616c207374646f75740a', 'hex'));
  assert.deepEqual(result.stderr, Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('7061727469616c207374646f75740a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(result.stdoutCapture, { state: 'incomplete', reason: 'read-error' },
    'a stdout read error must remain distinct from truncated or complete capture');
});

// Break: the consumer must fatal-decode actual collector Buffers before choosing the startup key.
// Both complete producer observations are retained even when the consumer has a handoff error.
test('complete collector Buffers require fatal UTF8 before parent key selection', async () => {
  const observations = [], errors = [];
  for (const bytes of [
    Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\nworker \u20ac\n', 'utf8'),
    Buffer.concat([Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'), Buffer.from([0xff])]),
  ]) {
    const { result, forwardedStdout, forwardedStderr } = await captureHostScenario({
      stdout: new PassThrough(), stderr: new PassThrough(),
      produce: child => {
        const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
        child.emit('spawn'); child.stdout.end(bytes); child.stderr.end(Buffer.from('separate stderr\n', 'utf8'));
        closed.then(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.isBuffer(result.stdout), true);
    assert.deepEqual(result.stdout, bytes);
    assert.deepEqual(result.stdoutCapture, { state: 'complete' });
    assert.deepEqual(Buffer.concat(forwardedStdout), bytes);
    assert.deepEqual(result.stderr, Buffer.from('7365706172617465207374646572720a', 'hex'));
    assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('7365706172617465207374646572720a', 'hex'));
    const commands = [], reads = [], writes = [];
    let observed;
    try {
      observed = await observeHostStep({
        startup: { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: result.stdoutCapture },
        runnerEnvironment: { RUNNER_TEMP: '/runner-temp', GITHUB_OUTPUT: '/step-output', GITHUB_STEP_SUMMARY: '/step-summary' },
        execute: async command => { commands.push(command.run); return result; },
        read: async path => {
          assert.equal(path, '/runner-temp/host-tests.junit.xml'); reads.push(path);
          return Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8');
        },
        append: async (path, data) => { writes.push([path, data]); },
      });
    } catch (error) { errors.push({ name: error.name, message: error.message }); }
    assert.deepEqual(commands, [hostInvocationCommand]);
    assert.deepEqual(writes, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
    assert.deepEqual(result.stdout, bytes, 'consumer must preserve the original captured Buffer');
    observations.push({ observed, reads });
  }
  assert.equal(observations.length, 2);
  assert.deepEqual(errors, [], 'complete Buffer handoff must not fail before fatal UTF8 key qualification');
  assert.deepEqual(observations.map(entry => entry.observed.hostKey), ['linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26', undefined]);
  for (const { observed, reads } of observations) {
    assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
    assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
    assert.equal(observed.stepOutcome, 'success');
    assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  }
});

// Break: complete capture is not sufficient when the parent startup record is empty or lacks LF.
// These admitted malformed-startup cases contain no invented worker output or post-startup report.
test('empty or unterminated startup records leave the parent key unavailable', async () => {
  const keys = [];
  for (const stdout of [Buffer.alloc(0), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26', 'utf8')]) {
    const startup = { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } };
    const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(undefined, { exitCode: 1, stdout, startup });
    assert.deepEqual(commands, [hostInvocationCommand]);
    assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
    assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
    assert.equal(observed.stepOutcome, 'failure');
    assert.deepEqual(observed.reporting, { state: 'absent', outcome: 'failure', message: 'Host JUnit report is absent' });
    assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=failure\nhost_exit_code=1\n']]);
    assert.deepEqual(summaryWrites, [['/step-summary', '## Host test report\n\nJUnit report is absent; failed-test names are unavailable.\n']]);
    keys.push(observed.hostKey);
  }
  assert.deepEqual(keys, [undefined, undefined], 'a parent key requires a nonempty LF-terminated startup record');
});

// Break: the real inspector/collector descriptor must reach invokeHost without a caller startup override.
// Filesystem/hash doubles describe the retained npm12/source profile, not a qualification decision.
test('runtime source qualification supplies the collector startup to invokeHost by default', async () => {
  const { inspection, cwd, scriptPath, npmRoot, fingerprints, absent, readPaths, fingerprintPaths, realPaths, executablePaths } = startupInspectionFixture();
  const { result, commands: spawned, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout: new PassThrough(), stderr: new PassThrough(), inspection,
    produce: child => {
      const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
      child.emit('spawn');
      child.stdout.end(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.end(Buffer.from('separate stderr\n', 'utf8'));
      closed.then(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
    },
  });
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), result.stdout);
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('7365706172617465207374646572720a', 'hex'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'success');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26',
    'the runtime-qualified collector startup must reach invokeHost without a caller override');
  assert.deepEqual(result.startup, { argv: hostInvocationArgv, npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } });
  assert.deepEqual([...new Set(readPaths)].sort(), [scriptPath, join(cwd, 'package.json'), join(npmRoot, 'package.json'), ...absent].sort());
  assert.deepEqual([...new Set(fingerprintPaths)].sort(), [...fingerprints.keys()].sort());
  assert.deepEqual(executablePaths, ['/selected/bin/npm', '/selected/bin/node']);
  assert.equal(realPaths.includes('/selected/bin/npm'), true); assert.equal(realPaths.includes('/selected/bin/node'), true);
});

// Break: npm's node-options config can replace lifecycle NODE_OPTIONS outside the qualified route.
// Equal reporter options preserve possible producer/report behavior while testing the explicit override refusal.
test('npm node options override leaves the startup route unqualified', async () => {
  const { inspection } = startupInspectionFixture();
  inspection.env.npm_config_node_options = '--test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=/runner-temp/host-tests.junit.xml';
  const { result, commands: spawned, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout: new EventEmitter(), stderr: new EventEmitter(), inspection,
    produce: child => {
      child.emit('spawn');
      child.stdout.emit('data', Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.emit('data', Buffer.from('separate stderr\n', 'utf8'));
      child.stdout.emit('end'); child.stdout.emit('close');
      child.stderr.emit('end'); child.stderr.emit('close');
      child.emit('exit', 0, null); child.emit('close', 0, null);
    },
  });
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), result.stdout);
  assert.deepEqual(result.stderr, Buffer.from('7365706172617465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStderr), result.stderr);
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.equal(observed.stepOutcome, 'success');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, undefined, 'npm_config_node_options must leave the startup route unqualified');
  assert.equal(Object.hasOwn(result, 'startup'), false, 'unqualified collection must not derive a startup descriptor');
});

// Break: lost stderr capture must fail the invocation without changing stdout key or report truth.
// Independent real-stream error/close observers make this an I/O outcome test, not an uncaught fixture error.
test('stderr read failure fails the invocation without changing host report or qualified key', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled stderr read failure'), errors = [];
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  stderr.on('error', error => { errors.push(error); });
  stdout.on('end', () => { stdoutEnded = true; });
  stderr.on('end', () => { stderrEnded = true; });
  const { result, child, commands: spawned, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout, stderr, inspection,
    produce: child => {
      const stdoutClosed = once(child.stdout, 'close');
      const stderrClosed = new Promise(resolve => child.stderr.once('close', resolve));
      child.once('close', () => { childClosed = true; });
      child.emit('spawn');
      child.stdout.end(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.write(Buffer.from('partial stderr\n', 'utf8'));
      child.stderr.destroy(failure);
      Promise.all([stdoutClosed, stderrClosed]).then(() => {
        child.emit('exit', 0, null); child.emit('close', 0, null);
      });
    },
  });
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.deepEqual(errors, [failure]); assert.equal(stderr.errored, failure);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, false);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(childClosed, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('7061727469616c207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('7061727469616c207374646572720a', 'hex'));
  assert.deepEqual(result.startup, { argv: hostInvocationArgv, npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } });
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure', 'a stderr read failure must fail the invocation while preserving host and report outcomes');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stderr', operation: 'read' }]);
  assert.equal(observed.message, 'Host stderr read failed');
});

// Break: a known stdout read error must fail invocation I/O as well as make the key unavailable.
// Direct host success and a separate valid report remain facts after the real error/close sequence.
test('stdout read failure fails the invocation without changing host or report outcomes', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled stdout read failure'), errors = [];
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  stdout.on('error', error => { errors.push(error); });
  stdout.on('end', () => { stdoutEnded = true; });
  stderr.on('end', () => { stderrEnded = true; });
  const { result, child, commands: spawned, forwardedStdout, forwardedStderr } = await captureHostScenario({
    stdout, stderr, inspection,
    produce: child => {
      const stdoutClosed = new Promise(resolve => child.stdout.once('close', resolve));
      const stderrClosed = once(child.stderr, 'close');
      child.once('close', () => { childClosed = true; });
      child.emit('spawn');
      child.stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.end(Buffer.from('complete stderr\n', 'utf8'));
      child.stdout.destroy(failure);
      Promise.all([stdoutClosed, stderrClosed]).then(() => {
        child.emit('exit', 0, null); child.emit('close', 0, null);
      });
    },
  });
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.deepEqual(errors, [failure]); assert.equal(stdout.errored, failure);
  assert.equal(stdoutEnded, false); assert.equal(stderrEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(childClosed, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutCapture, { state: 'incomplete', reason: 'read-error' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(result.startup, { argv: hostInvocationArgv, npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'incomplete', reason: 'read-error' } });
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]);
  assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, undefined);
  assert.equal(observed.stepOutcome, 'failure', 'a stdout read failure must fail the invocation while preserving the original host and report outcomes');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stdout', operation: 'read' }]);
  assert.equal(observed.message, 'Host stdout read failed');
});

import { Writable } from 'node:stream';

// Node's real Writable callback reports its error before automatic destruction closes the sink.
// The independent error/close observers establish that fault before the child's ordinary close.
test('stdout forwarding callback failure fails the invocation while preserving host report and key', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled stdout forwarding failure'), errors = [], received = [];
  const sink = new Writable({ autoDestroy: true, emitClose: true,
    write(bytes, encoding, callback) { received.push(Buffer.from(bytes)); queueMicrotask(() => callback(failure)); },
  });
  sink.on('error', error => { errors.push(error); });
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  let stdoutEnded = false, stderrEnded = false, childClosed = false, sinkClosedBeforeChildClose = false;
  stdout.on('end', () => { stdoutEnded = true; });
  stderr.on('end', () => { stderrEnded = true; });
  const { result, child, commands: spawned, forwardedStderr } = await captureHostScenario({
    stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const stdoutClosed = once(child.stdout, 'close'), stderrClosed = once(child.stderr, 'close');
      child.once('close', () => { childClosed = true; });
      child.emit('spawn');
      child.stdout.end(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.end(Buffer.from('complete stderr\n', 'utf8'));
      Promise.all([stdoutClosed, stderrClosed, sinkClosed]).then(() => {
        sinkClosedBeforeChildClose = sink.closed;
        child.emit('exit', 0, null); child.emit('close', 0, null);
      });
    },
  });
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.deepEqual(errors, [failure]); assert.equal(sink.errored, failure); assert.equal(sink.closed, true);
  assert.equal(sinkClosedBeforeChildClose, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true); assert.equal(childClosed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(result.startup, { argv: hostInvocationArgv, npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } });
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure', 'a stdout forwarding failure must fail the invocation while preserving host report and key');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stdout', operation: 'write' }]);
  assert.equal(observed.message, 'Host stdout write failed');
});

// A real low-watermark Writable supplies false and drain; saved Readable states precede cleanup.
test('stdout forwarding pauses on real backpressure until drain without changing host report or key', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const errors = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeReturns, firstForward } = heldWrite;
  let drained = false, pauseEventBeforeDrain = false;
  const realDrain = new Promise(resolve => sink.once('drain', () => { drained = true; resolve(); }));
  stdout.on('pause', () => { if (!drained) pauseEventBeforeDrain = true; });
  for (const stream of [stdout, stderr, sink]) stream.on('error', error => { errors.push(error); });
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  let pausedBeforeDrain, pausedAfterDrain, needDrainBefore, needDrainAfter, callbackHeld, producerFailure;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const releaseWrite = () => { const callback = heldWrite.takeCallback(); callback?.(); };
  const { result, child, commands: spawned, forwardedStderr } = await captureHostScenario({
    stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const closed = [stdout, stderr, sink].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      child.stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      child.stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          const accepted = await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function';
          needDrainBefore = sink.writableNeedDrain; pausedBeforeDrain = stdout.isPaused();
          releaseWrite();
          if (accepted === false) await realDrain;
          needDrainAfter = sink.writableNeedDrain; pausedAfterDrain = stdout.isPaused();
        } catch (error) { producerFailure = error; }
        finally {
          // Force only fixture teardown after saving both production observations, even on RED.
          releaseWrite(); stdout.resume(); stdout.end(); stderr.end(); sink.end();
          await Promise.all(closed);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.deepEqual(errors, []);
  assert.deepEqual(writeReturns, [false]); assert.equal(callbackHeld, true);
  assert.equal(needDrainBefore, true); assert.equal(drained, true); assert.equal(needDrainAfter, false);
  assert.equal(sink.closed, true); assert.equal(sink.writableFinished, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []); assert.deepEqual(observed.ioFailures, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'success');
  assert.equal(pausedBeforeDrain, true, 'stdout forwarding must pause after a real false write until the real drain');
  assert.equal(pauseEventBeforeDrain, true);
  assert.equal(pausedAfterDrain, false, 'stdout forwarding must resume after the real drain');
});

// The failed real write closes without drain; the buffered key tail must still be captured.
test('stdout capture resumes after a backpressured destination fails without writing to it again', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled backpressured stdout write failure');
  const errors = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeCalls, writeReturns, firstForward } = heldWrite;
  const observeError = error => { errors.push(error); };
  let drains = 0;
  const observeDrain = () => { drains += 1; };
  sink.on('error', observeError); sink.on('drain', observeDrain);
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  let callbackHeld, needDrainBefore, pausedBeforeError, tailBufferedBeforeError, pausedAfterTerminal, producerFailure;
  let externalDrainListenerRetained;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const failWrite = () => { const callback = heldWrite.takeCallback(); callback?.(failure); };
  const forceFlow = () => { queueMicrotask(() => stdout.resume()); };
  const { result, child, commands: spawned, forwardedStderr } = await captureHostScenario({
    stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const closed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      child.stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8'));
      child.stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function';
          needDrainBefore = sink.writableNeedDrain; pausedBeforeError = stdout.isPaused();
          child.stdout.write(Buffer.from('WSL2-x86_64-node26\n', 'utf8'));
          tailBufferedBeforeError = stdout.readableLength;
          failWrite(); await sinkClosed;
          pausedAfterTerminal = stdout.isPaused();
          externalDrainListenerRetained = sink.listeners('drain').includes(observeDrain);
        } catch (error) { producerFailure = error; }
        finally {
          // Saved production state precedes this owned teardown, including any repeated bad pause.
          failWrite(); stdout.on('pause', forceFlow); stdout.resume(); stdout.end(); stderr.end();
          if (!sink.closed) sink.end();
          await Promise.all([...closed, sinkClosed]);
          stdout.removeListener('pause', forceFlow); sink.removeListener('drain', observeDrain);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.equal(writeReturns[0], false);
  assert.equal(callbackHeld, true); assert.equal(needDrainBefore, true); assert.equal(pausedBeforeError, true);
  assert.equal(tailBufferedBeforeError, 19); assert.equal(drains, 0);
  assert.equal(errors[0], failure); assert.equal(sink.errored, failure); assert.equal(sink.closed, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.deepEqual(spawned, [['bash', ['-e', process.argv[1]], { stdio: ['inherit', 'pipe', 'pipe'] }]]);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('636f6d706c657465207374646572720a', 'hex'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []); assert.deepEqual(observed.ioFailures, [{ stream: 'stdout', operation: 'write' }]);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure'); assert.equal(observed.message, 'Host stdout write failed');
  assert.equal(pausedAfterTerminal, false, 'stdout capture must resume after a backpressured destination error and close');
  assert.deepEqual(writeCalls, [Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8')]);
  assert.deepEqual(writeReturns, [false]); assert.deepEqual(errors, [failure]);
  assert.equal(externalDrainListenerRetained, true); assert.ok(sink.listeners('error').includes(observeError));
  assert.equal(sink.listenerCount('drain'), 0);
});

// A real destroy without an error can close the destination before its pending write drains.
test('stdout capture resumes after a backpressured destination closes without an error', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const errors = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeCalls, writeReturns, firstForward } = heldWrite;
  let drains = 0, closes = 0;
  const observeDrain = () => { drains += 1; }, observeError = error => { errors.push(error); };
  sink.on('drain', observeDrain); sink.on('error', observeError);
  const sinkClosed = new Promise(resolve => sink.once('close', () => { closes += 1; resolve(); }));
  let callbackHeld, needDrainBefore, pausedBeforeClose, tailBuffered, pausedAfterClose, producerFailure;
  let externalDrainRetained, stdoutEnded = false, stderrEnded = false, childClosed = false;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const releaseWrite = () => { const callback = heldWrite.takeCallback(); callback?.(); };
  const forceFlow = () => { queueMicrotask(() => stdout.resume()); };
  const { result, child, forwardedStderr } = await captureHostScenario({ stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function'; needDrainBefore = sink.writableNeedDrain;
          pausedBeforeClose = stdout.isPaused();
          stdout.write(Buffer.from('WSL2-x86_64-node26\n', 'utf8')); tailBuffered = stdout.readableLength;
          sink.destroy(); await sinkClosed;
          pausedAfterClose = stdout.isPaused();
          externalDrainRetained = sink.listeners('drain').includes(observeDrain);
        } catch (error) { producerFailure = error; }
        finally {
          // Preserve the close observation before forcing only owned teardown, including a repeated bad pause.
          releaseWrite(); stdout.on('pause', forceFlow); stdout.resume(); stdout.end(); stderr.end();
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...channelsClosed, sinkClosed]);
          stdout.removeListener('pause', forceFlow); sink.removeListener('drain', observeDrain);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.equal(writeReturns[0], false);
  assert.equal(callbackHeld, true); assert.equal(needDrainBefore, true); assert.equal(pausedBeforeClose, true);
  assert.equal(tailBuffered, 19); assert.equal(drains, 0); assert.equal(closes, 1);
  assert.deepEqual(errors, []); assert.equal(sink.errored, null);
  assert.equal(sink.destroyed, true); assert.equal(sink.closed, true); assert.equal(sink.writableFinished, false);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(pausedAfterClose, false, 'stdout capture must resume after a backpressured destination closes without error');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stdout', operation: 'write' }]);
  assert.equal(observed.stepOutcome, 'failure'); assert.equal(observed.message, 'Host stdout write failed');
  assert.deepEqual(writeCalls, [Buffer.from('linux-6.18.54.1-microsoft-standard-', 'utf8')]);
  assert.deepEqual(writeReturns, [false]); assert.equal(externalDrainRetained, true);
  assert.ok(sink.listeners('error').includes(observeError)); assert.equal(sink.listenerCount('drain'), 0);
});

// Accepting a write is not completion; its real callback can fail after the child has closed.
test('pending stdout write failure after child close fails invocation while retaining host and report', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled pending stdout write failure');
  const errors = [], childOutcomes = [];
  let producerFinished;
  const producerDone = new Promise(resolve => { producerFinished = resolve; });
  const heldWrite = heldWriteDestination({ highWaterMark: 1024, autoDestroy: true, emitClose: true });
  const { sink, received, writeReturns, firstForward } = heldWrite;
  const observeError = error => { errors.push(error); };
  sink.on('error', observeError);
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  let childClosed = false, callbackHeldBeforeClose, pendingBytesBeforeClose, needDrainBeforeClose;
  let callbackReleasedAfterChildClose, producerFailure;
  const failWrite = () => {
    const callback = heldWrite.takeCallback();
    if (callback) { callbackReleasedAfterChildClose = childClosed; callback(failure); }
  };
  const { result, child, forwardedStderr } = await captureHostScenario({ stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('exit', (code, signal) => { childOutcomes.push(['exit', code, signal]); });
      child.once('close', (code, signal) => { childClosed = true; childOutcomes.push(['close', code, signal]); });
      child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeldBeforeClose = typeof heldWrite.callback === 'function';
          pendingBytesBeforeClose = sink.writableLength; needDrainBeforeClose = sink.writableNeedDrain;
          stdout.end(); stderr.end(); await Promise.all(channelsClosed);
          child.emit('exit', 0, null); child.emit('close', 0, null);
          // Release from the producer's child-close condition, independently of collector resolution.
          failWrite(); await sinkClosed;
        } catch (error) { producerFailure = error; }
        finally {
          failWrite(); stdout.resume();
          if (!stdout.writableEnded) stdout.end();
          if (!stderr.writableEnded) stderr.end();
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...channelsClosed, sinkClosed]);
          if (!childClosed) { child.emit('exit', 0, null); child.emit('close', 0, null); }
          producerFinished();
        }
      })();
    },
  });
  await producerDone;
  assert.equal(producerFailure, undefined); assert.deepEqual(writeReturns, [true]);
  assert.equal(callbackHeldBeforeClose, true); assert.equal(pendingBytesBeforeClose, 54);
  assert.equal(needDrainBeforeClose, false); assert.equal(callbackReleasedAfterChildClose, true);
  assert.deepEqual(errors, [failure]); assert.equal(sink.errored, failure); assert.equal(sink.closed, true);
  assert.deepEqual(childOutcomes, [['exit', 0, null], ['close', 0, null]]);
  assert.equal(child.stdout.readableEnded, true); assert.equal(child.stderr.readableEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure', 'a pending stdout write error after child close must fail invocation');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stdout', operation: 'write' }]);
  assert.equal(observed.message, 'Host stdout write failed');
  assert.ok(sink.listeners('error').includes(observeError));
});

// Characterization: a successful accepted write stays successful, and the destination remains caller-owned.
test('successful pending stdout callback after child close preserves invocation success and destination ownership', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const errors = [], destinationCalls = [], childOutcomes = [];
  let producerFinished;
  const producerDone = new Promise(resolve => { producerFinished = resolve; });
  const heldWrite = heldWriteDestination({ highWaterMark: 1024, autoDestroy: false, emitClose: true });
  const { sink, received, writeReturns, firstForward } = heldWrite;
  for (const operation of ['end', 'destroy']) {
    const actual = sink[operation];
    sink[operation] = function (...args) { destinationCalls.push(operation); return Reflect.apply(actual, this, args); };
  }
  const observeError = error => { errors.push(error); };
  sink.on('error', observeError);
  let finishOrClose;
  const sinkTerminal = new Promise(resolve => { finishOrClose = resolve; });
  sink.once('finish', finishOrClose); sink.once('close', finishOrClose);
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  let childClosed = false, callbackHeld, pendingBytes, needDrain, releasedAfterChildClose, producerFailure;
  let endedBeforeOwnCleanup, destroyedBeforeOwnCleanup, destroyedBeforeOwnDestroy;
  const completeWrite = () => {
    const callback = heldWrite.takeCallback();
    if (callback) { releasedAfterChildClose = childClosed; callback(); }
  };
  const { result, child, forwardedStderr } = await captureHostScenario({ stdout, stderr, inspection, stdoutSink: sink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('exit', (code, signal) => { childOutcomes.push(['exit', code, signal]); });
      child.once('close', (code, signal) => { childClosed = true; childOutcomes.push(['close', code, signal]); });
      child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function'; pendingBytes = sink.writableLength;
          needDrain = sink.writableNeedDrain;
          stdout.end(); stderr.end(); await Promise.all(channelsClosed);
          child.emit('exit', 0, null); child.emit('close', 0, null);
          completeWrite();
          endedBeforeOwnCleanup = sink.writableEnded; destroyedBeforeOwnCleanup = sink.destroyed;
        } catch (error) { producerFailure = error; }
        finally {
          // Caller cleanup never waits for collector resolution, including an incorrect finish wait.
          completeWrite(); stdout.resume();
          if (!stdout.writableEnded) stdout.end();
          if (!stderr.writableEnded) stderr.end();
          sink.end(); await sinkTerminal;
          destroyedBeforeOwnDestroy = sink.destroyed;
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...channelsClosed, sinkClosed]);
          sink.removeListener('finish', finishOrClose); sink.removeListener('close', finishOrClose);
          if (!childClosed) { child.emit('exit', 0, null); child.emit('close', 0, null); }
          producerFinished();
        }
      })();
    },
  });
  await producerDone;
  assert.equal(producerFailure, undefined); assert.deepEqual(writeReturns, [true]);
  assert.equal(callbackHeld, true); assert.equal(pendingBytes, 54); assert.equal(needDrain, false);
  assert.equal(releasedAfterChildClose, true); assert.deepEqual(errors, []); assert.equal(sink.errored, null);
  assert.equal(sink.writableFinished, true); assert.equal(sink.closed, true);
  assert.deepEqual(childOutcomes, [['exit', 0, null], ['close', 0, null]]);
  assert.equal(child.stdout.readableEnded, true); assert.equal(child.stderr.readableEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStderr), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.deepEqual(observed.ioFailures, [], 'a successful pending stdout callback must not invent an IO failure');
  assert.equal(observed.stepOutcome, 'success'); assert.equal(observed.message, undefined);
  assert.equal(endedBeforeOwnCleanup, false); assert.equal(destroyedBeforeOwnCleanup, false);
  assert.equal(destroyedBeforeOwnDestroy, false); assert.deepEqual(destinationCalls, ['end', 'destroy']);
  assert.ok(sink.listeners('error').includes(observeError));
});

// A destination callback error is separate from a read error in the child's stderr stream.
test('stderr forwarding callback failure fails invocation while preserving host report and key', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled stderr destination write failure');
  const errors = [], childOutcomes = [];
  let producerFinished;
  const producerDone = new Promise(resolve => { producerFinished = resolve; });
  const heldWrite = heldWriteDestination({ highWaterMark: 1024, autoDestroy: true, emitClose: true });
  const { sink, received, writeReturns, firstForward } = heldWrite;
  let childClosed = false, errorBeforeChildClose, callbackHeld, pendingBytes, needDrain, producerFailure;
  const observeError = error => { errors.push(error); errorBeforeChildClose = !childClosed; };
  sink.on('error', observeError);
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  const failWrite = () => { const callback = heldWrite.takeCallback(); callback?.(failure); };
  const { result, child, forwardedStdout } = await captureHostScenario({ stdout, stderr, inspection, stderrSink: sink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('exit', (code, signal) => { childOutcomes.push(['exit', code, signal]); });
      child.once('close', (code, signal) => { childClosed = true; childOutcomes.push(['close', code, signal]); });
      child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function'; pendingBytes = sink.writableLength;
          needDrain = sink.writableNeedDrain;
          failWrite(); await sinkClosed;
        } catch (error) { producerFailure = error; }
        finally {
          // This caller-owned sink and both channels settle before direct child close, even on RED.
          failWrite(); stdout.resume(); stderr.resume();
          if (!stdout.writableEnded) stdout.end();
          if (!stderr.writableEnded) stderr.end();
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...channelsClosed, sinkClosed]);
          child.emit('exit', 0, null); child.emit('close', 0, null);
          producerFinished();
        }
      })();
    },
  });
  await producerDone;
  assert.equal(producerFailure, undefined); assert.deepEqual(writeReturns, [true]);
  assert.equal(callbackHeld, true); assert.equal(pendingBytes, 16); assert.equal(needDrain, false);
  assert.deepEqual(errors, [failure]); assert.equal(errorBeforeChildClose, true);
  assert.equal(sink.errored, failure); assert.equal(sink.closed, true);
  assert.deepEqual(childOutcomes, [['exit', 0, null], ['close', 0, null]]);
  assert.equal(child.stdout.readableEnded, true); assert.equal(child.stderr.readableEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure', 'a stderr destination write error must fail invocation');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stderr', operation: 'write' }]);
  assert.equal(observed.message, 'Host stderr write failed');
  assert.ok(sink.listeners('error').includes(observeError));
});

// Child pipe closure does not complete an accepted write to its separate stderr destination.
test('pending stderr write failure after child close fails invocation while retaining host and report', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled pending stderr write failure');
  const receivedStdout = [], errors = [], childOutcomes = [];
  const stdoutSink = new Writable({ autoDestroy: true, emitClose: true,
    write(bytes, encoding, callback) { receivedStdout.push(Buffer.from(bytes)); callback(); },
  });
  stdoutSink.on('error', error => { errors.push(error); });
  const stdoutSinkClosed = new Promise(resolve => stdoutSink.once('close', resolve));
  let producerFinished;
  const producerDone = new Promise(resolve => { producerFinished = resolve; });
  const heldWrite = heldWriteDestination({ highWaterMark: 1024, autoDestroy: true, emitClose: true });
  const { sink: stderrSink, received: receivedStderr, writeReturns, firstForward } = heldWrite;
  let childClosed = false, errorAfterChildClose, callbackHeld, pendingBytes, needDrain, producerFailure;
  let stdoutSettledBeforeChildClose, callbackReleasedAfterChildClose;
  const observeError = error => { errors.push(error); errorAfterChildClose = childClosed; };
  stderrSink.on('error', observeError);
  const stderrSinkClosed = new Promise(resolve => stderrSink.once('close', resolve));
  const failWrite = () => {
    const callback = heldWrite.takeCallback();
    if (callback) { callbackReleasedAfterChildClose = childClosed; callback(failure); }
  };
  const { result, child } = await captureHostScenario({ stdout, stderr, inspection, stdoutSink, stderrSink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('exit', (code, signal) => { childOutcomes.push(['exit', code, signal]); });
      child.once('close', (code, signal) => { childClosed = true; childOutcomes.push(['close', code, signal]); });
      child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function'; pendingBytes = stderrSink.writableLength;
          needDrain = stderrSink.writableNeedDrain;
          stdout.end(); stderr.end(); await Promise.all(channelsClosed);
          // This caller-owned stdout destination completes before child close, isolating only stderr.
          stdoutSink.end(); await stdoutSinkClosed;
          stdoutSettledBeforeChildClose = stdoutSink.writableFinished && !childClosed;
          child.emit('exit', 0, null); child.emit('close', 0, null);
          failWrite(); await stderrSinkClosed;
        } catch (error) { producerFailure = error; }
        finally {
          // Callback release and all owned cleanup are independent of collector resolution.
          failWrite(); stdout.resume(); stderr.resume();
          if (!stdout.writableEnded) stdout.end();
          if (!stderr.writableEnded) stderr.end();
          if (!stdoutSink.writableEnded) stdoutSink.end();
          if (!stderrSink.destroyed) stderrSink.destroy();
          await Promise.all([...channelsClosed, stdoutSinkClosed, stderrSinkClosed]);
          if (!childClosed) { child.emit('exit', 0, null); child.emit('close', 0, null); }
          producerFinished();
        }
      })();
    },
  });
  await producerDone;
  assert.equal(producerFailure, undefined); assert.deepEqual(writeReturns, [true]);
  assert.equal(callbackHeld, true); assert.equal(pendingBytes, 16); assert.equal(needDrain, false);
  assert.equal(stdoutSettledBeforeChildClose, true); assert.equal(callbackReleasedAfterChildClose, true);
  assert.deepEqual(errors, [failure]); assert.equal(errorAfterChildClose, true);
  assert.equal(stderrSink.errored, failure); assert.equal(stderrSink.closed, true);
  assert.equal(stdoutSink.errored, null); assert.equal(stdoutSink.writableFinished, true); assert.equal(stdoutSink.closed, true);
  assert.deepEqual(childOutcomes, [['exit', 0, null], ['close', 0, null]]);
  assert.equal(child.stdout.readableEnded, true); assert.equal(child.stderr.readableEnded, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(receivedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(receivedStderr), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure', 'a pending stderr write error after child close must fail invocation');
  assert.deepEqual(observed.ioFailures, [{ stream: 'stderr', operation: 'write' }]);
  assert.equal(observed.message, 'Host stderr write failed');
  assert.ok(stderrSink.listeners('error').includes(observeError));
});

// Real destination backpressure must control the child's stderr flow independently of stdout.
test('stderr forwarding pauses on real backpressure until drain without changing host report or key', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const errors = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeReturns, firstForward } = heldWrite;
  let drained = false, pauseEventBeforeDrain = false;
  const realDrain = new Promise(resolve => sink.once('drain', () => { drained = true; resolve(); }));
  stderr.on('pause', () => { if (!drained) pauseEventBeforeDrain = true; });
  for (const stream of [stdout, stderr, sink]) stream.on('error', error => { errors.push(error); });
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  let callbackHeld, needDrainBefore, needDrainAfter, pausedBeforeDrain, pausedAfterDrain, producerFailure;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const releaseWrite = () => { const callback = heldWrite.takeCallback(); callback?.(); };
  const { result, child, forwardedStdout } = await captureHostScenario({ stdout, stderr, inspection, stderrSink: sink,
    produce: child => {
      const closed = [stdout, stderr, sink].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('complete stderr\n', 'utf8'));
      void (async () => {
        try {
          const accepted = await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function';
          needDrainBefore = sink.writableNeedDrain; pausedBeforeDrain = stderr.isPaused();
          releaseWrite();
          if (accepted === false) await realDrain;
          needDrainAfter = sink.writableNeedDrain; pausedAfterDrain = stderr.isPaused();
        } catch (error) { producerFailure = error; }
        finally {
          // Always release the real callback and source flow after saving both production snapshots.
          releaseWrite(); stdout.resume(); stderr.resume(); stdout.end(); stderr.end(); sink.end();
          await Promise.all(closed);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.deepEqual(errors, []);
  assert.deepEqual(writeReturns, [false]); assert.equal(callbackHeld, true);
  assert.equal(needDrainBefore, true); assert.equal(drained, true); assert.equal(needDrainAfter, false);
  assert.equal(sink.writableFinished, true); assert.equal(sink.closed, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('complete stderr\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('complete stderr\n', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []); assert.deepEqual(observed.ioFailures, []);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'success');
  assert.equal(pausedBeforeDrain, true, 'stderr forwarding must pause after a real false write until the real drain');
  assert.equal(pauseEventBeforeDrain, true);
  assert.equal(pausedAfterDrain, false, 'stderr forwarding must resume after the real drain');
});

// Terminal error has no healthy drain; saved state precedes the independent flow/EOF cleanup.
test('stderr capture resumes after a backpressured destination fails without writing to it again', async () => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const failure = new Error('controlled backpressured stderr write failure');
  const errors = [], sourceBytes = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeCalls, writeReturns, firstForward } = heldWrite;
  const observeError = error => { errors.push(error); };
  let drains = 0;
  const observeDrain = () => { drains += 1; };
  sink.on('error', observeError); sink.on('drain', observeDrain);
  stderr.on('data', bytes => { sourceBytes.push(Buffer.from(bytes)); });
  const sinkClosed = new Promise(resolve => sink.once('close', resolve));
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  let callbackHeld, needDrainBefore, pausedBeforeError, tailBufferedBeforeError, pausedAfterTerminal, producerFailure;
  let terminalWriteCalls, terminalDrainListeners, externalDrainRetained;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const failWrite = () => { const callback = heldWrite.takeCallback(); callback?.(failure); };
  const forceFlow = () => { queueMicrotask(() => stderr.resume()); };
  const { result, child, forwardedStdout } = await captureHostScenario({ stdout, stderr, inspection, stderrSink: sink,
    produce: child => {
      const closed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('stderr head ', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeld = typeof heldWrite.callback === 'function';
          needDrainBefore = sink.writableNeedDrain; pausedBeforeError = stderr.isPaused();
          stderr.write(Buffer.from('tail\n', 'utf8')); tailBufferedBeforeError = stderr.readableLength;
          failWrite(); await sinkClosed;
          pausedAfterTerminal = stderr.isPaused();
          terminalWriteCalls = writeCalls.map(bytes => Buffer.from(bytes));
          terminalDrainListeners = sink.listeners('drain');
          externalDrainRetained = terminalDrainListeners.includes(observeDrain);
        } catch (error) { producerFailure = error; }
        finally {
          // A repeated bad pause caused by writing the tail to a destroyed sink must not strand teardown.
          failWrite(); stderr.on('pause', forceFlow); stdout.resume(); stderr.resume(); stdout.end(); stderr.end();
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...closed, sinkClosed]);
          stderr.removeListener('pause', forceFlow); sink.removeListener('drain', observeDrain);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.equal(writeReturns[0], false);
  assert.equal(callbackHeld, true); assert.equal(needDrainBefore, true); assert.equal(pausedBeforeError, true);
  assert.equal(tailBufferedBeforeError, 5); assert.equal(drains, 0);
  assert.deepEqual(errors, [failure]); assert.equal(sink.errored, failure); assert.equal(sink.closed, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('stderr head tail\n', 'utf8'));
  assert.deepEqual(Buffer.concat(sourceBytes), Buffer.from('stderr head tail\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('stderr head ', 'utf8'));
  assert.deepEqual(terminalWriteCalls, [Buffer.from('stderr head ', 'utf8')]);
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []); assert.deepEqual(observed.ioFailures, [{ stream: 'stderr', operation: 'write' }]);
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.equal(observed.stepOutcome, 'failure'); assert.equal(observed.message, 'Host stderr write failed');
  assert.equal(pausedAfterTerminal, false, 'stderr capture must resume after a backpressured destination error and close');
  assert.deepEqual(writeCalls, [Buffer.from('stderr head ', 'utf8')]); assert.deepEqual(writeReturns, [false]);
  assert.deepEqual(terminalDrainListeners, [observeDrain]); assert.equal(externalDrainRetained, true);
  assert.ok(sink.listeners('error').includes(observeError)); assert.equal(sink.listenerCount('drain'), 0);
});

// Real Writable.destroy() closes without an error; callback observation separates later teardown writes.
test('stderr capture resumes after a backpressured destination closes without an error', async t => {
  const { inspection } = startupInspectionFixture();
  const stdout = new PassThrough(), stderr = new PassThrough();
  const errors = [], sourceBytes = [], callbackTrace = [];
  const heldWrite = heldWriteDestination({ highWaterMark: 1, autoDestroy: true, emitClose: true });
  const { sink, received, writeCalls, writeReturns, firstForward } = heldWrite;
  let cleanupStarted = false, drains = 0, closes = 0;
  // Call the real Writable unchanged and observe its genuine callbacks, including any later destroyed-tail failure.
  const recordingWrite = sink.write;
  sink.write = function (...args) {
    const callback = args.at(-1), issuedDuringCleanup = cleanupStarted;
    if (typeof callback === 'function') args[args.length - 1] = function (...values) {
      callbackTrace.push({ issuedDuringCleanup, notifiedDuringCleanup: cleanupStarted, errorCode: values[0]?.code ?? null });
      return Reflect.apply(callback, this, values);
    };
    return Reflect.apply(recordingWrite, this, args);
  };
  const observeDrain = () => { drains += 1; };
  const observeError = error => { errors.push(error); };
  sink.on('drain', observeDrain); sink.on('error', observeError);
  stderr.on('data', bytes => { sourceBytes.push(Buffer.from(bytes)); });
  const sinkClosed = new Promise(resolve => sink.once('close', () => { closes += 1; resolve(); }));
  let callbackHeldBefore, needDrainBefore, pausedBeforeClose, tailBufferedBefore, terminal, producerFailure;
  let stdoutEnded = false, stderrEnded = false, childClosed = false;
  stdout.on('end', () => { stdoutEnded = true; }); stderr.on('end', () => { stderrEnded = true; });
  const releaseWrite = () => { const callback = heldWrite.takeCallback(); callback?.(); };
  const forceFlow = () => { queueMicrotask(() => stderr.resume()); };
  const { result, child, forwardedStdout } = await captureHostScenario({ stdout, stderr, inspection, stderrSink: sink,
    produce: child => {
      const channelsClosed = [stdout, stderr].map(stream => new Promise(resolve => stream.once('close', resolve)));
      child.once('close', () => { childClosed = true; }); child.emit('spawn');
      stdout.write(Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
      stderr.write(Buffer.from('stderr head ', 'utf8'));
      void (async () => {
        try {
          await firstForward;
          callbackHeldBefore = typeof heldWrite.callback === 'function'; needDrainBefore = sink.writableNeedDrain;
          pausedBeforeClose = stderr.isPaused();
          stderr.write(Buffer.from('tail\n', 'utf8')); tailBufferedBefore = stderr.readableLength;
          sink.destroy(); await sinkClosed;
          terminal = { paused: stderr.isPaused(), errors: [...errors], errored: sink.errored,
            closed: sink.closed, destroyed: sink.destroyed, writableFinished: sink.writableFinished,
            callbackHeld: typeof heldWrite.callback === 'function', callbacks: callbackTrace.map(row => ({ ...row })),
            drains, closes, writeCalls: writeCalls.map(bytes => Buffer.from(bytes)), writeReturns: [...writeReturns],
            drainListeners: sink.listeners('drain'), externalErrorRetained: sink.listeners('error').includes(observeError) };
        } catch (error) { producerFailure = error; }
        finally {
          // The saved pure-close state precedes callback release or independent flow/EOF cleanup.
          cleanupStarted = true; releaseWrite(); stderr.on('pause', forceFlow); stdout.resume(); stderr.resume(); stdout.end(); stderr.end();
          if (!sink.destroyed) sink.destroy();
          await Promise.all([...channelsClosed, sinkClosed]);
          stderr.removeListener('pause', forceFlow); sink.removeListener('drain', observeDrain);
          child.emit('exit', 0, null); child.emit('close', 0, null);
        }
      })();
    },
  });
  assert.equal(producerFailure, undefined); assert.equal(writeReturns[0], false);
  assert.equal(callbackHeldBefore, true); assert.equal(needDrainBefore, true); assert.equal(pausedBeforeClose, true);
  assert.equal(tailBufferedBefore, 5); assert.equal(terminal.drains, 0); assert.equal(terminal.closes, 1);
  assert.deepEqual(terminal.errors, []); assert.equal(terminal.errored, null); assert.deepEqual(terminal.callbacks, []);
  assert.equal(terminal.callbackHeld, true); assert.equal(terminal.closed, true); assert.equal(terminal.destroyed, true);
  assert.equal(terminal.writableFinished, false); assert.deepEqual(terminal.writeCalls, [Buffer.from('stderr head ', 'utf8')]);
  assert.deepEqual(terminal.writeReturns, [false]); assert.ok(terminal.drainListeners.includes(observeDrain));
  assert.equal(terminal.externalErrorRetained, true);
  assert.equal(stdoutEnded, true); assert.equal(stderrEnded, true); assert.equal(childClosed, true);
  assert.equal(child.stdout.closed, true); assert.equal(child.stderr.closed, true);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.stdout, Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(Buffer.concat(forwardedStdout), Buffer.from('linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', 'utf8'));
  assert.deepEqual(result.stderr, Buffer.from('stderr head tail\n', 'utf8'));
  assert.deepEqual(Buffer.concat(sourceBytes), Buffer.from('stderr head tail\n', 'utf8'));
  assert.deepEqual(Buffer.concat(received), Buffer.from('stderr head ', 'utf8'));
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(
    Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 0, outcome: 'success' });
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [] });
  assert.deepEqual(outputWrites, [['/step-output', 'host_outcome=success\nhost_exit_code=0\n']]);
  assert.deepEqual(summaryWrites, []); assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  // Any callbacks caused by forcing a later write to the destroyed sink belong only to teardown.
  assert.ok(callbackTrace.every(row => row.notifiedDuringCleanup));
  t.diagnostic(JSON.stringify({ fixture: 'stderr-pure-close', terminal: { paused: terminal.paused,
    errorCount: terminal.errors.length, callbackCount: terminal.callbacks.length, drains: terminal.drains,
    closes: terminal.closes, writableFinished: terminal.writableFinished, writeCount: terminal.writeCalls.length },
  teardownCallbacks: callbackTrace, teardownWriteCount: writeCalls.length - terminal.writeCalls.length }));
  assert.equal(terminal.paused, false, 'stderr capture must resume after a backpressured destination closes without error');
  assert.deepEqual(writeCalls, [Buffer.from('stderr head ', 'utf8')]); assert.deepEqual(writeReturns, [false]);
  assert.deepEqual(terminal.drainListeners, [observeDrain]);
  assert.deepEqual(observed.ioFailures, [{ stream: 'stderr', operation: 'write' }]);
  assert.equal(observed.stepOutcome, 'failure'); assert.equal(observed.message, 'Host stderr write failed');
  assert.ok(sink.listeners('error').includes(observeError)); assert.equal(sink.listenerCount('drain'), 0);
});

// Break: valid JUnit names whose complete summary exceeds Actions' accepted UTF8 limit must not be published oversized.
// Independent framing is 35 ASCII prefix bytes + 350000 three-byte U+0800 characters + 8 ASCII suffix bytes.
test('valid host report refuses an oversized UTF8 summary while preserving host key and failed names', async () => {
  const failedName = '\u0800'.repeat(350_000);
  const prefix = "## Failed host tests\n\n```json\n[\n  \"", suffix = "\"\n]\n```\n";
  assert.equal(Buffer.byteLength(prefix, 'utf8'), 35); assert.equal(Buffer.byteLength(suffix, 'utf8'), 8);
  assert.equal(Buffer.byteLength(failedName, 'utf8'), 1_050_000);
  const candidateSummary = prefix + failedName + suffix;
  assert.equal(Buffer.byteLength(candidateSummary, 'utf8'), 1_050_043);
  assert.ok(1_050_043 > 1_048_576);
  const xml = '<testsuites><testcase name="' + failedName + '"><failure/></testcase></testsuites>';
  const startup = { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } };
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(Buffer.from(xml, 'utf8'), { exitCode: 1, startup });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [failedName] });
  assert.deepEqual(outputWrites, [['/step-output', "host_outcome=failure\nhost_exit_code=1\n"]]);
  const oversized = summaryWrites.filter(([, bytes]) => Buffer.byteLength(bytes, 'utf8') > 1_048_576);
  assert.equal(oversized.length, 0, 'a valid report must not publish an oversized UTF8 summary');
  assert.equal(observed.stepOutcome, 'failure');
  assert.equal(observed.message, 'Host summary exceeds 1048576 UTF-8 bytes');
});

// Characterization: accepted complete summary size includes equality; a >= guard would wrongly suppress this full payload.
// Independent framing is 35 ASCII prefix bytes + 1048533 ASCII name bytes + 8 ASCII suffix bytes.
test('failed host report publishes its complete UTF8 summary exactly at the size limit', async () => {
  const failedName = 'x'.repeat(1_048_533);
  const prefix = "## Failed host tests\n\n```json\n[\n  \"", suffix = "\"\n]\n```\n";
  assert.equal(Buffer.byteLength(prefix, 'utf8'), 35); assert.equal(Buffer.byteLength(suffix, 'utf8'), 8);
  assert.equal(Buffer.byteLength(failedName, 'utf8'), 1_048_533);
  const expectedSummary = prefix + failedName + suffix;
  assert.equal(Buffer.byteLength(expectedSummary, 'utf8'), 1_048_576);
  const xml = '<testsuites><testcase name="' + failedName + '"><failure/></testcase></testsuites>';
  const startup = { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } };
  const { observed, commands, reads, outputWrites, summaryWrites } = await reportInvocation(Buffer.from(xml, 'utf8'), { exitCode: 1, startup });
  assert.deepEqual(commands, [hostInvocationCommand]); assert.deepEqual(reads, ['/runner-temp/host-tests.junit.xml']);
  assert.deepEqual(observed.host, { started: true, exitCode: 1, outcome: 'failure' });
  assert.equal(observed.hostKey, 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26');
  assert.deepEqual(observed.reporting, { state: 'valid', outcome: 'success', failedNames: [failedName] });
  assert.deepEqual(outputWrites, [['/step-output', "host_outcome=failure\nhost_exit_code=1\n"]]);
  const complete = summaryWrites.filter(([path, bytes]) => path === '/step-summary' && bytes === expectedSummary);
  assert.equal(complete.length, 1, 'a complete UTF8 summary exactly at the limit must be published');
  assert.ok(summaryWrites.every(([, bytes]) => Buffer.byteLength(bytes, 'utf8') <= 1_048_576));
  assert.equal(observed.stepOutcome, 'failure'); assert.equal(observed.message, undefined);
});

// Character references independently specify decoded LF; XML literal attribute whitespace is not this premise.
test('decoded failed names retain embedded LF and duplicates in the complete summary', async () => {
  const xml = '<testsuites><testcase name="A &amp; B"><failure/></testcase><testcase name="line&#10;value"><failure/></testcase><testcase name="A &amp; B"><error/></testcase></testsuites>';
  const { observed, summaryWrites } = await reportInvocation(Buffer.from(xml), { exitCode: 1 });
  assert.deepEqual(observed.reporting.failedNames, ['A & B', 'line\nvalue', 'A & B']);
  assert.deepEqual(summaryWrites, [['/step-summary', '## Failed host tests\n\n```json\n[\n  "A & B",\n  "line\\nvalue",\n  "A & B"\n]\n```\n']]);
});

// Break: setup-node26 currently supplies npm11.20 on supported Mac; rejecting its source loses the parent key.
// Literal prefix: real npm11 reporter probe plus pinned run-script-pkg's no-argument banner branch.
// The prior hosted log is supporting context only; this controlled case makes no Mac proof claim.
test('qualified npm11 startup preserves the parent key despite later worker lookalikes', async () => {
  const { npm11StartupInspectionFixture } = await import('./ci-host-fixtures.mjs');
  const prefix = '\n> @williacj/rigger@0.1.0 test:host\n> sh test/suite.sh --host --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=/runner-temp/host-tests.junit.xml\n\n';
  const parent = 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26';
  for (const variant of ['qualified', 'source drift', 'prefix mismatch']) {
    const { inspection, npmRoot, fingerprints } = npm11StartupInspectionFixture();
    if (variant === 'source drift') fingerprints.set(join(npmRoot, 'lib/commands/run.js'), '0'.repeat(64));
    const stdout = (variant === 'prefix mismatch' ? 'unexpected\n' : prefix) + parent + '\nworker output\nmacos26-20261102.0473.1-ARM64-node26\n';
    const { result } = await captureHostScenario({
      stdout: new EventEmitter(), stderr: new EventEmitter(), inspection,
      produce: child => {
        child.emit('spawn'); child.stdout.emit('data', Buffer.from(stdout, 'utf8'));
        child.stdout.emit('end'); child.stdout.emit('close');
        child.stderr.emit('end'); child.stderr.emit('close');
        child.emit('exit', 0, null); child.emit('close', 0, null);
      },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, Buffer.from(stdout, 'utf8'));
    if (variant === 'qualified') assert.deepEqual(result.startup, {
      argv: hostInvocationArgv, npmVersion: '11.20.0', stdoutPrefix: prefix, capture: { state: 'complete' },
    }, 'actual npm11 source must qualify its observed banner');
    if (variant === 'source drift') assert.equal(result.startup, undefined);
    const { observed } = await reportInvocation(Buffer.from('<testsuites><testcase name="pass"/></testsuites>', 'utf8'), { child: result });
    assert.equal(observed.hostKey, variant === 'qualified' ? parent : undefined,
      'only the exact qualified npm11 prefix may expose the immediately following parent key');
  }
});

// Break: reporter NODE_OPTIONS leaks into nested Node commands that supply their own reporter.
// The independent command literal keeps both reporter pairs on the outer suite invocation.
test('host reporting keeps reporter options on the outer command only', async () => {
  let command;
  await observeHostStep({
    runnerEnvironment: { RUNNER_TEMP: '/runner-temp', GITHUB_OUTPUT: '/step-output', GITHUB_STEP_SUMMARY: '/step-summary' },
    execute: async observed => {
      command = observed;
      return { exitCode: 0, stdout: Buffer.from('linux-parent-node26\n', 'utf8'), stderr: Buffer.alloc(0) };
    },
    read: async () => Buffer.from('<testsuites/>', 'utf8'),
    append: async () => {},
  });
  assert.equal(Object.hasOwn(command.env, 'NODE_OPTIONS'), false,
    'host reporter options must not enter the inherited NODE_OPTIONS environment');
  assert.equal(command.run, 'npm run test:host -- --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination="$RUNNER_TEMP/$CI_HOST_REPORT_NAME"',
    'the outer host command must carry its exact paired reporter arguments');
});