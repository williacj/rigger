// ABOUTME: Reads the actual CI host step and observes its default or declared inline shell through injected runner primitives.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { parseWorkflow } from './ci-policy-fixtures.mjs';

export const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));

async function loadHostModule(source) {
  assert.equal(process.env.CI_HOST_ACTION, undefined, 'fixture imports must not run the CLI action');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

/** Actions' command exit is the default shell outcome; a custom shell executes its actual inline module. */
export async function observeHostStep({ execute, read, append, runnerEnvironment, startup, publish = false, save }) {
  const step = ci.jobs.full_host.steps.find(entry => entry.run === 'npm run test:host');
  assert.ok(step, 'actual full_host host invocation must remain present');
  const env = { ...(ci.env ?? {}), ...(ci.jobs.full_host.env ?? {}), ...(step.env ?? {}), ...runnerEnvironment };
  const command = { run: step.run, env };
  if (step.shell === undefined) {
    const child = await execute(command);
    return { host: { started: true, exitCode: child.exitCode, outcome: child.exitCode === 0 ? 'success' : 'failure' },
      stepOutcome: child.exitCode === 0 ? 'success' : 'failure' };
  }
  assert.equal(step.shell, "node --input-type=module -e \"await import('data:text/javascript;base64,' + Buffer.from(process.env.CI_HOST).toString('base64'))\" {0}", 'unknown host shell is setup failure');
  assert.equal(typeof env.CI_HOST, 'string', 'declared host module is setup, never the red assertion');
  const actual = await loadHostModule(env.CI_HOST);
  assert.equal(typeof actual.invokeHost, 'function', 'missing callable is setup failure, never claimed red');
  return (publish && actual.runHost ? actual.runHost : actual.invokeHost)({ execute: () => execute(command), read, append, env, startup, save });
}

/** The qualified command/stdout contract and async file outcomes are injected without interpreting report bytes. */
export async function reportInvocation(report, { exitCode = 0, stdout = 'linux-6.18.54.1-microsoft-standard-WSL2-x86_64-node26\n', startup, child, publish = false, envOverrides = {} } = {}) {
  const commands = [], reads = [], writes = [], originals = [];
  const observed = await observeHostStep({
    startup, publish, save: async (path, bytes) => { originals.push([path, Buffer.from(bytes)]); },
    runnerEnvironment: { RUNNER_TEMP: '/runner-temp', GITHUB_OUTPUT: '/step-output', GITHUB_STEP_SUMMARY: '/step-summary', ...envOverrides },
    execute: async command => {
      commands.push(command.run);
      return child ?? { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
    },
    read: async path => {
      assert.equal(path, '/runner-temp/host-tests.junit.xml', 'read the configured invocation report');
      reads.push(path);
      if (report === undefined) throw Object.assign(new Error('controlled missing report'), { code: 'ENOENT' });
      return report;
    },
    append: async (path, bytes) => {
      assert.ok(path === '/step-output' || path === '/step-summary', 'write only the runner output or summary channel');
      writes.push([path, bytes]);
    },
  });
  return { observed, commands, reads, writes, originals, outputWrites: writes.filter(([path]) => path === '/step-output'), summaryWrites: writes.filter(([path]) => path === '/step-summary') };
}

/** The actual collector accepts only the documented child and output-sink collaborator contracts. */
export async function observeHostCapture(collaborators) {
  const actual = await loadHostModule(ci.env.CI_HOST);
  assert.equal(typeof actual.executeScript, 'function', 'missing collector export is setup failure');
  return actual.executeScript(collaborators);
}

/** Holds a genuine Writable callback and records its native writes; each test owns completion and lifecycle. */
export function heldWriteDestination({ highWaterMark, autoDestroy, emitClose }) {
  const received = [], writeCalls = [], writeReturns = [];
  let writeCallback, forwarded;
  const firstForward = new Promise(resolve => { forwarded = resolve; });
  const sink = new Writable({ highWaterMark, autoDestroy, emitClose,
    write(bytes, encoding, callback) { received.push(Buffer.from(bytes)); writeCallback = callback; },
  });
  const actualWrite = sink.write;
  sink.write = function (...args) {
    writeCalls.push(Buffer.from(args[0]));
    const accepted = Reflect.apply(actualWrite, this, args);
    writeReturns.push(accepted); forwarded(accepted); return accepted;
  };
  return { sink, received, writeCalls, writeReturns, firstForward,
    get callback() { return writeCallback; },
    takeCallback() { const callback = writeCallback; writeCallback = undefined; return callback; },
  };
}

/** Drives the actual collector with documented child/stream events and records its unchanged byte forwarding. */
export async function captureHostScenario({ stdout, stderr, produce, inspection, stdoutSink, stderrSink, onStart, childPid }) {
  const child = new EventEmitter();
  child.stdout = stdout; child.stderr = stderr;
  if (childPid !== undefined) child.pid = childPid;
  const commands = [], forwardedStdout = [], forwardedStderr = [], ownedSinks = [];
  const recordingSink = received => {
    const sink = new Writable({
      write(bytes, encoding, callback) { received.push(Buffer.from(bytes)); callback(); },
    });
    ownedSinks.push(sink); return sink;
  };
  let result;
  try {
    result = await observeHostCapture({
    inspection, onStart,
    spawnChild: (command, args, options) => {
      commands.push([command, args, options]);
      queueMicrotask(() => produce(child));
      return child;
    },
    stdoutSink: stdoutSink ?? recordingSink(forwardedStdout),
    stderrSink: stderrSink ?? recordingSink(forwardedStderr),
    });
  } finally {
    await Promise.all(ownedSinks.map(sink => new Promise(resolve => {
      sink.once('close', resolve); sink.end();
    })));
  }
  return { result, child, commands, forwardedStdout, forwardedStderr };
}

/** Supplies the independently retained current npm/source/config facts without making the qualification decision. */
export function startupInspectionFixture() {
  const cwd = process.cwd(), scriptPath = process.argv[1], execPath = process.execPath;
  const prefix = dirname(dirname(execPath)), npmRoot = join(prefix, 'lib/node_modules/npm');
  const npmCli = join(npmRoot, 'bin/npm-cli.js');
  const fingerprints = new Map([
    [join(cwd, '.npmrc'), '2ab58d679ddb6c245446999a2ea5fb54783b9aa26c94ce663cb7db0be0a8f7f8'],
    [join(cwd, 'test/suite.sh'), '51d1656050740bf7130c8ab8352cb027aa2831887ec7d09b168dcd4c87d21f46'],
    [join(cwd, 'test/suite-guard.cjs'), 'cd0fea139d9547bcb613dab0f8b6c87ec12f182b36409ae971083a7132761c31'],
    [join(npmRoot, 'bin/npm-cli.js'), '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7'],
    [join(npmRoot, 'lib/commands/run.js'), 'b7acdea61c0886f048d2b8c5ecbce1599416eec6ba5553ee21d77687f50ccf8c'],
    [join(npmRoot, 'node_modules/@npmcli/run-script/lib/run-script-pkg.js'), '1142ab865b1180409f0f3a93eb3bc01f9ca36fa9ead1c938b254eb6923de7886'],
    [join(npmRoot, 'lib/utils/display.js'), 'c6268a43166143f3a833b95be55080dfa44e370ae7bab39dbf943816d3a11450'],
    [join(npmRoot, 'node_modules/@npmcli/run-script/lib/make-spawn-args.js'), '51ef6919950dc6e87dfa1b0824fe2f1dcd423f2e3a5b2632b8a076120b8bd7b4'],
    [join(npmRoot, 'node_modules/@npmcli/config/lib/index.js'), '14e19ddd8378da6554aa6c84e420e14547db217f4d9759b4149b77f5dafa778a'],
    [join(npmRoot, 'node_modules/@npmcli/config/lib/definitions/definitions.js'), 'b352635a4b9ac0575a76e66dae679b16c67762030b1847564ea4b59e572f8372'],
  ]);
  const readPaths = [], fingerprintPaths = [], realPaths = [], executablePaths = [];
  const absent = new Set([join(npmRoot, 'npmrc'), '/selected/home/.npmrc', join(prefix, 'etc/npmrc')]);
  const inspection = {
    cwd, scriptPath, execPath,
    env: { PATH: '/selected/bin:/usr/bin:/bin', HOME: '/selected/home', RUNNER_TEMP: '/runner-temp', CI_HOST_REPORT_NAME: 'host-tests.junit.xml',
      NODE_OPTIONS: '--test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=/runner-temp/host-tests.junit.xml' },
    read: async path => {
      readPaths.push(path);
      if (path === scriptPath) return Buffer.from('npm run test:host', 'utf8');
      if (path === join(cwd, 'package.json')) return readFileSync(new URL('../package.json', import.meta.url));
      if (path === join(npmRoot, 'package.json')) return Buffer.from('{"name":"npm","version":"12.2.2","bin":{"npm":"bin/npm-cli.js","npx":"bin/npx-cli.js"}}', 'utf8');
      if (absent.has(path)) throw Object.assign(new Error('controlled absent npm config'), { code: 'ENOENT' });
      assert.fail('unexpected inspector read: ' + path);
    },
    realpath: async path => {
      realPaths.push(path);
      if (path === '/selected/bin/npm') return npmCli;
      if (path === '/selected/bin/node' || path === execPath) return execPath;
      assert.fail('unexpected inspector realpath: ' + path);
    },
    access: async (path, mode) => {
      executablePaths.push(path); assert.equal(mode, 1, 'PATH selection uses filesystem X_OK');
      if (path === '/selected/bin/npm' || path === '/selected/bin/node') return;
      throw Object.assign(new Error('controlled absent executable'), { code: 'ENOENT' });
    },
    fingerprint: async path => {
      fingerprintPaths.push(path); assert.equal(fingerprints.has(path), true, 'fingerprint only an inspected source');
      return fingerprints.get(path);
    },
  };
  return { inspection, cwd, scriptPath, npmRoot, fingerprints, absent, readPaths, fingerprintPaths, realPaths, executablePaths };
}

/** Invoke the actual declared writer; an absent job has no issue-writing behavior. */
export async function observeHostRecord(input, request) {
  const job = ci.jobs['host-record'];
  if (!job) return { state: 'unavailable' };
  const module = await loadHostModule(ci.env.CI_RECORD);
  assert.equal(typeof module.recordHostFailure, 'function', 'declared writer must be callable');
  return module.recordHostFailure({ input, request });
}

/** Literal scheduled source/host identity; fields come from the card's transport contract. */
export function hostRecordInput() {
  return {
    event: 'schedule', ref: 'refs/heads/main', repository: 'williacj/rigger',
    runId: 123, runAttempt: 1, job: 'nightly',
    host_outcome: 'failure', host_exit_code: '1', host_invoked: 'true',
    host_key: '"t4-fixture-macos-arm64-node26"', report_state: 'valid', names_state: 'available',
    failed_names: '["A & B","line\\nvalue","A & B"]',
    source: '{"event":"schedule","ref":"refs/heads/main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tree":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","parents":["cccccccccccccccccccccccccccccccccccccccc"],"head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","base":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","baseRef":"main"}',
    invocation: '{"repository":"williacj/rigger","runId":123,"runAttempt":1,"job":"nightly"}',
    eligible: 'true',
  };
}

/** The writer's real HTTP boundary, with documented fetch collaborators supplied by the test. */
export async function observeIssueTransport(path, options) {
  const module = await loadHostModule(ci.env.CI_RECORD);
  if (!module.issueRequest) return { state: 'unavailable' };
  return module.issueRequest(path, options);
}

/** Literal current-qualified startup and already-verified source transport; no route/key algorithm is copied. */
export function publicationInvocation(report, options = {}) {
  const input = hostRecordInput();
  return reportInvocation(report, {
    stdout: 't4-fixture-macos-arm64-node26\n',
    startup: { argv: ['npm', 'run', 'test:host'], npmVersion: '12.2.2', stdoutPrefix: '', capture: { state: 'complete' } },
    ...options, publish: true,
    envOverrides: {
      GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'williacj/rigger',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'nightly',
      CI_HOST_SOURCE: input.source, CI_HOST_ELIGIBLE: 'true', ...(options.envOverrides ?? {}),
    },
  });
}

/** Executes the actual existing policy module's worker-result transport formatter. */
export async function observeWorkerTransport(result, worker) {
  const module = await loadHostModule(ci.env.CI_POLICY);
  return module.workerHostOutputs(result, worker);
}

/** The Issues-only entrypoint consumes outputs with current workflow context, never another source verifier. */
export async function observeRuntimeRecordInput(env) {
  const module = await loadHostModule(ci.env.CI_RECORD);
  return module.runtimeRecordInput(env);
}

/** One open Issues store, following the documented raw-body, list, create and comment response contracts. */
export function hostIssueStore(initialIssue) {
  const root = '/repos/williacj/rigger';
  const store = { issue: initialIssue, comments: [], requests: [] };
  store.request = async (path, options = {}) => {
    store.requests.push([path, options]);
    if (!options.method) {
      if (path === root + '/issues?state=open&labels=host-tier&per_page=100') return { status: 200, body: store.issue ? [store.issue] : [], link: null };
      assert.ok(store.issue, 'read fixture requires an existing issue');
      if (path === root + '/issues/71/comments?per_page=100') return { status: 200, body: store.comments, link: null };
      assert.equal(path, root + '/issues/71'); return { status: 200, body: store.issue };
    }
    assert.equal(options.method, 'POST');
    if (path === root + '/issues') {
      assert.equal(store.issue, undefined, 'fixture refuses a duplicate creation');
      store.issue = { number: 71, title: options.body.title, labels: options.body.labels.map(name => ({ name })), state: 'open', body: options.body.body, comments: 0 };
      return { status: 201, body: { number: 71, html_url: 'https://github.com/williacj/rigger/issues/71' } };
    }
    assert.equal(path, root + '/issues/71/comments'); assert.ok(store.issue);
    const comment = { id: 901 + store.comments.length, body: options.body.body, html_url: 'https://github.com/williacj/rigger/issues/71#issuecomment-' + (901 + store.comments.length) };
    store.comments.push(comment); store.issue.comments = store.comments.length;
    return { status: 201, body: comment };
  };
  return store;
}
