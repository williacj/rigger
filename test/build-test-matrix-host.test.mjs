// ABOUTME: Proves the matrix generator's native suite-list launch, exit, signal, deadline and output limits.
import { traceFile } from './file-trace.mjs';
traceFile('test/build-test-matrix-host.test.mjs');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import { unlinkSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { temporaryDirectory } from './temporary-directory.mjs';
import { alive, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 20_000: SETTLES_WITHIN } = BOUNDS;
const generator = fileURLToPath(new URL('../scripts/build-test-matrix.mjs', import.meta.url));
const original = Buffer.from('preserve these matrix bytes\n');

// Native cancellation can precede test hooks; explicit process exit can bypass after hooks.
// Host reason: wiring; the native npm child must end within the existing bound and exposes Node's hook lifecycle.
// Rigger decision: test/file-trace.test.mjs — the exit trace reports code duration and completed counts without changing process state or hooks.
test('native file trace keeps Node counts when hooks are bypassed', SETTLES_WITHIN, (t) => {
  for (const mode of ['aborted', 'pending', 'exit']) {
    const pending = mode === 'pending';
    const exiting = mode === 'exit';
    const root = temporaryDirectory('rigger-trace-cancel-', { context: t });
    const file = join(root, 'cancelled.test.mjs');
    const hook = join(root, 'hook.called');
    const body = join(root, 'body.called');
    const queued = join(root, 'queued.called');
    const passed = join(root, 'passed.called');
    const output = join(root, 'runner.log');
    const source = [
      '// ABOUTME: Exercises native Node cancellation and abrupt exit.',
      "import { test, beforeEach } from 'node:test';",
      "import { writeFileSync } from 'node:fs';",
      `import { traceFile } from ${JSON.stringify(new URL('./file-trace.mjs', import.meta.url).href)};`,
      `traceFile(${JSON.stringify(file)});`,
      `beforeEach((context) => writeFileSync(${JSON.stringify(hook)}, context.name));`,
      ...(exiting ? [
        'let first;',
        "beforeEach((context) => { if (context.name === 'passing') first = context; });",
        `await test('passing', () => writeFileSync(${JSON.stringify(body)}, 'called'));`,
        `writeFileSync(${JSON.stringify(passed)}, String(first.passed));`,
        "test('exit', () => process.exit(17));",
      ] : pending ? [
        'const controller = new AbortController();',
        "test('container', { concurrency: 1, signal: controller.signal }, async (t) => {",
        `  const running = t.test('pending', () => { writeFileSync(${JSON.stringify(body)}, 'called'); controller.abort(); return new Promise(() => {}); });`,
        `  const queued = t.test('queued', () => writeFileSync(${JSON.stringify(queued)}, 'called'));`,
        '  await Promise.all([running, queued]);',
        '});',
      ] : [`test('cancelled before hooks', { signal: AbortSignal.abort() }, () => writeFileSync(${JSON.stringify(body)}, 'called'));`]),
    ].join('\n') + '\n';
    writeFileSync(file, source);
    const reporter = fileURLToPath(new URL('../scripts/mutation-receipt.mjs', import.meta.url));
    const command = ['npm', 'test', '--', `--test-reporter=${reporter}`, file];
    const script = [
      'sh -c \'printf "NPM_CHILD_PID=%s\\n" "$$"; exec "$@"\' trace-npm "$@" 2>&1 | tee "$TRACE_RUN_LOG"',
      'statuses=("${PIPESTATUS[@]}")',
      'printf "NPM_CHILD_EXIT=%s\\nTEE_EXIT=%s\\n" "${statuses[0]}" "${statuses[1]}" >&2',
      'exit "${statuses[0]}"',
    ].join('\n');
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const result = spawnSync('bash', ['-o', 'pipefail', '-c', script, 'trace-child', ...command], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...env, TRACE_RUN_LOG: output }, timeout: SETTLES_WITHIN.timeout,
    });
    const bytes = existsSync(output) ? readFileSync(output) : Buffer.alloc(0);
    t.diagnostic(JSON.stringify({ nativeTraceCancellation: true, mode, command, source,
      pid: result.pid, status: result.status, signal: result.signal,
      outputBase64: bytes.toString('base64'), stderrBase64: result.stderr.toString('base64'),
      witnesses: Object.fromEntries([hook, body, queued, passed].map((path) =>
        [path, existsSync(path) ? readFileSync(path).toString('base64') : null])),
      helperSHA256: createHash('sha256').update(readFileSync(new URL('./file-trace.mjs', import.meta.url))).digest('hex') }));
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /^NPM_CHILD_EXIT=1\nTEE_EXIT=0\n$/);
    assert.deepEqual(result.stdout, bytes, 'tee retained the complete child output');
    assert.match(bytes.toString('utf8'), /^NPM_CHILD_PID=[1-9]\d*\n/, 'the child pid was recorded before npm started');
    const events = bytes.toString('utf8').split('\n').filter((line) => line.startsWith('@@proof '))
      .map((line) => JSON.parse(line.slice(8)));
    const summary = events.find((event) => event.type === 'test:summary' && event.data.file === file);
    if (!exiting) assert.equal(summary?.data.counts.cancelled, pending ? 3 : 1, 'the native runner cancelled the declared tests');
    assert.equal(existsSync(hook), pending || exiting, 'hooks only ran for tests that entered');
    if (pending || exiting) assert.equal(readFileSync(hook, 'utf8'), exiting ? 'exit' : 'pending', 'the last entered hook is known');
    assert.equal(existsSync(body), pending || exiting, 'the known running body entered');
    assert.equal(existsSync(queued), false, 'the queued body never ran');
    const lines = events.filter((event) => event.type === 'test:stdout').flatMap((event) => event.data.message.split('\n'));
    const line = lines.find((line) => line.startsWith('RIGGER_TEST_EXIT '));
    assert.ok(line, 'the native worker emitted its exit trace');
    const trace = JSON.parse(line.slice('RIGGER_TEST_EXIT '.length));
    assert.deepEqual(Object.keys(trace).sort(), ['cancelled', 'duration', 'exitCode', 'failed', 'name', 'passed', 'time']);
    if (pending) {
      const finishes = lines.filter((line) => line.startsWith('RIGGER_TEST_FINISH '))
        .map((line) => JSON.parse(line.slice('RIGGER_TEST_FINISH '.length)));
      assert.deepEqual(finishes.map(({ name, outcome }) => [name, outcome]), [['container', 'cancelled']],
        'the running top-level test finishes with its native cancellation outcome');
    }
    if (exiting) {
      assert.equal(trace.exitCode, 17, 'the trace preserves the explicit native process exit');
      assert.equal(readFileSync(passed, 'utf8'), 'true',
        'Node independently finalized the completed passing context before process exit');
      assert.deepEqual([trace.passed, trace.failed, trace.cancelled], [1, 0, 0],
        'completed counts survive an exit that bypasses the global after hook');
    } else {
      assert.deepEqual([trace.passed, trace.failed, trace.cancelled],
        [summary.data.counts.passed, summary.data.counts.failed, summary.data.counts.cancelled],
        'the trace includes cancellations that never supplied hook contexts');
    }
  }
});

function replyComplete(path) {
  return existsSync(path) && readFileSync(path, 'utf8') === 'survived';
}

/** A real direct shell, observed from outside the generator's synchronous process wait. */
function nativeRead(t, name, body, { missingSh = false, importOnly = false } = {}) {
  const root = temporaryDirectory('rigger-matrix-native-', { context: t });
  const pidFile = join(root, 'list.pid');
  const ready = join(root, 'list.ready');
  const probe = join(root, 'term.probe');
  const reply = join(root, 'term.reply');
  const called = join(root, 'import.called');
  const files = {
    'docs/spec/requirements.md': '| id | checked by |\n|---|---|\n| R-ONE-1 | the test suite |\n',
    'docs/spec/requirements-retired.md': '| id |\n|---|\n',
    'test/a.test.mjs': "import { test } from 'node:test';\n// proves R-ONE-1\ntest('the native host proof', () => {});\n",
    'test/suite.sh': '#!/bin/sh\n# ABOUTME: Supplies one native list-command outcome.\n'
      + '[ "$1" = --list ] && [ "$2" = host ] || exit 91\n'
      + '[ "$PWD" = "$MATRIX_CWD" ] || exit 92\n'
      + 'printf "%s\\n" "$$" > "$MATRIX_PID"\n'
      + 'trap "" TERM\n'
      + 'printf ready > "$MATRIX_READY"\n' + body + '\n',
    'docs/derived/test-matrix.md': original,
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (importOnly) writeFileSync(join(bin, 'sh'), '#!/bin/sh\nprintf called > "$MATRIX_CALLED"\nexit 93\n', { mode: 0o755 });
  const args = importOnly
    ? ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../scripts/build-test-matrix.mjs', import.meta.url).href)});`]
    : [generator, '--write', root];
  const started = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...(missingSh || importOnly ? { PATH: bin } : {}),
      MATRIX_CWD: root, MATRIX_PID: pidFile, MATRIX_READY: ready, MATRIX_PROBE: probe, MATRIX_REPLY: reply, MATRIX_CALLED: called },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.diagnostic(JSON.stringify({ nativeMatrixCase: name, generatorPID: child.pid, started }));
  let stdout = '', stderr = '', recorded = false;
  child.stdout.setEncoding('utf8').on('data', (bytes) => { stdout += bytes; });
  child.stderr.setEncoding('utf8').on('data', (bytes) => { stderr += bytes; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  const directPID = () => existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : null;
  const record = (result) => {
    if (recorded) return;
    recorded = true;
    const observation = { name, command: [process.execPath, ...args], cwd: root, node: process.version,
      platform: process.platform, generatorPID: child.pid, directPID: directPID(),
      directGone: directPID() === null || !alive(directPID()), elapsedMs: performance.now() - started,
      ...result, stdout, stderr, readiness: existsSync(ready) ? readFileSync(ready, 'utf8') : null,
      termReply: existsSync(reply) ? readFileSync(reply, 'utf8') : null,
      generatorSHA256: createHash('sha256').update(readFileSync(generator)).digest('hex'),
      inputs: Object.fromEntries(Object.keys(files).map((path) => [path, readFileSync(join(root, path)).toString('base64')])),
    };
    t.diagnostic(JSON.stringify(observation));
    if (process.env.RIGGER_MATRIX_HOST_EVIDENCE) {
      mkdirSync(process.env.RIGGER_MATRIX_HOST_EVIDENCE, { recursive: true });
      writeFileSync(join(process.env.RIGGER_MATRIX_HOST_EVIDENCE, name + '.json'), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
    }
    return observation;
  };
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const pid = directPID();
      if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
      child.kill('SIGKILL');
    }
    await closed.catch(() => {});
    record({ teardownOnly: true, status: child.exitCode, signal: child.signalCode });
  });
  return { root, ready, probe, reply, called, directPID,
    async finish() {
      const result = await Promise.race([closed, once(t.signal, 'abort').then(() => { throw new Error('native matrix witness exceeded its existing test bound'); })]);
      return record(result);
    },
  };
}

async function refusesNative(t, name, body, message, options) {
  const run = nativeRead(t, name, body, options);
  const result = await run.finish();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
  assert.deepEqual(readFileSync(join(run.root, 'docs/derived/test-matrix.md')), original);
  assert.equal(result.directGone, true, 'the direct list process survived generator return');
}

test('native valid suite output marks its known host claim', SETTLES_WITHIN, async (t) => {
  const run = nativeRead(t, 'valid', "printf 'test/a.test.mjs\\n'");
  const result = await run.finish();
  assert.equal(result.status, 0, result.stderr);
  const matrix = readFileSync(join(run.root, 'docs/derived/test-matrix.md'), 'utf8');
  assert.match(matrix, /`test\/a\.test\.mjs` \*\*host\*\* the native host proof/);
  assert.match(matrix, /## Requirements claimed only by host tests\n\n- R-ONE-1\n/);
  assert.equal(result.directGone, true);
});

test('native empty output refuses write without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'empty', ':', /host list output is empty/));
test('native malformed output refuses write without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'malformed', "printf 'outside.test.mjs\\n'", /malformed.*outside\.test\.mjs/));
test('native unknown file refuses write without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'unknown', "printf 'test/absent.test.mjs\\n'", /not read.*test\/absent\.test\.mjs/));
test('native nonzero exit refuses write without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'exit', 'exit 7', /host list command failed with exit 7/));
test('native signal termination refuses write without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'signal', 'trap - TERM\nkill -TERM $$', /host list command ended by SIGTERM/));
test('native missing sh refuses launch without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'launch', ':', /host list launch failed: ENOENT/, { missingSh: true }));

test('native TERM-resistant direct shell times out at the selected policy and is reaped', SETTLES_WITHIN, async (t) => {
  const run = nativeRead(t, 'timeout', 'responded=no\nwhile :; do\n  if [ "$responded" = no ] && [ -f "$MATRIX_PROBE" ]; then\n    printf survived > "$MATRIX_REPLY"\n    responded=yes\n  fi\ndone');
  await until(() => readyComplete(run.ready), t);
  assert.equal(readFileSync(run.ready, 'utf8'), 'ready');
  const pid = run.directPID();
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  t.diagnostic(JSON.stringify({ nativeMatrixCase: 'timeout', directPID: pid, ready: true }));
  process.kill(pid, 'SIGTERM');
  writeFileSync(run.probe, 'probe');
  await until(() => replyComplete(run.reply), t);
  assert.equal(readFileSync(run.reply, 'utf8'), 'survived');
  const result = await run.finish();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /host list timed out after 5000ms; signal SIGKILL/);
  assert.ok(result.elapsedMs >= 5000, 'the witness returned before the selected deadline');
  assert.ok(result.elapsedMs < SETTLES_WITHIN.timeout, 'the witness exceeded the existing test bound');
  assert.equal(result.directGone, true, 'the direct shell was not reaped');
  assert.deepEqual(readFileSync(join(run.root, 'docs/derived/test-matrix.md')), original);
});

test('native reply observation waits for the complete literal', (t) => {
  const root = temporaryDirectory('rigger-matrix-reply-', { context: t });
  const reply = join(root, 'reply');
  const replyObserved = () => replyComplete(reply);
  const publish = (value) => {
    const writer = spawnSync(process.execPath, ['-e',
      "require('node:fs').writeFileSync(process.argv[1], process.argv[2])", reply, value]);
    assert.equal(writer.status, 0, writer.stderr.toString());
  };

  assert.equal(replyObserved(), false, 'an absent reply was accepted');
  publish('');
  assert.equal(replyObserved(), false, 'an empty reply was accepted');
  publish('surv');
  assert.equal(replyObserved(), false, 'a partial reply was accepted');
  for (const value of ['s', 'su', 'sur', 'survi', 'surviv', 'survive', 'wrong', 'Survived',
    ' survived', 'survived ', 'survived\n', 'survived\r\n', 'survived!', 'not-survived', 'survived\0', '"survived"']) {
    // NUL is valid file content but cannot be passed as a process argument.
    if (value.includes('\0')) writeFileSync(reply, value);
    else publish(value);
    assert.equal(replyObserved(), false, 'a nonliteral reply was accepted: ' + JSON.stringify(value));
  }
  publish('survived');
  assert.equal(replyObserved(), true, 'the complete reply was not accepted');
});

test('native bounded overflow refuses partial output without changing matrix bytes', SETTLES_WITHIN, (t) =>
  refusesNative(t, 'overflow', "i=0\nwhile [ \"$i\" -lt 70000 ]; do\n  printf 'test/a.test.mjs\\n'\n  i=$((i + 1))\ndone", /host list exceeded the 1048576 byte output limit/));

test('importing the generator starts no suite-list process', SETTLES_WITHIN, async (t) => {
  const run = nativeRead(t, 'import', ':', { importOnly: true });
  const result = await run.finish();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(run.called), false, 'import started a suite-list command');
});

function readyComplete(path) {
  return existsSync(path) && readFileSync(path, 'utf8') === 'ready';
}

/** The shell has redirected its output but cannot publish until its stdin gate is released. */
async function heldReadiness(t) {
  const root = temporaryDirectory('rigger-matrix-ready-', { context: t });
  const ready = join(root, 'ready');
  const writer = spawn('/bin/sh', ['-c',
    '{ printf held >&2; IFS= read -r gate; printf ready; } > "$MATRIX_READY"'], {
    env: { ...process.env, MATRIX_READY: ready }, stdio: ['pipe', 'ignore', 'pipe'],
  });
  t.diagnostic(JSON.stringify({ readinessWriterPID: writer.pid }));
  const closed = new Promise((resolve, reject) => {
    writer.once('error', reject);
    writer.once('close', (status, signal) => resolve({ status, signal }));
  });
  t.after(async () => {
    if (writer.exitCode === null && writer.signalCode === null) writer.kill('SIGKILL');
    await closed;
  });
  let acknowledgement = '';
  writer.stderr.setEncoding('utf8').on('data', (bytes) => { acknowledgement += bytes; });
  await until(() => acknowledgement === 'held', t);
  assert.equal(statSync(ready).size, 0, 'the writer must be held after creating an empty file');
  return { ready, writer, closed };
}

/** A second predicate check witnesses a pending wait; an early read fails before that witness. */
function observeReadiness(path, context) {
  const checked = Promise.withResolvers();
  let checks = 0, reads = 0, ended = false;
  const reading = until(() => {
    const complete = readyComplete(path);
    if (++checks === 2) checked.resolve();
    return complete;
  }, context).then(() => {
    reads += 1;
    assert.equal(existsSync(path), true, 'a readiness assertion tried to read an absent file');
    const value = readFileSync(path, 'utf8');
    assert.equal(value, 'ready');
    return value;
  });
  reading.then(() => { ended = true; }, () => { ended = true; });
  return { reading, checked: checked.promise, reads: () => reads, ended: () => ended };
}

// Host reason: OS behaviour; the shell redirect and pipe gate depend on no decision Rigger makes.
test('native readiness wait holds at the empty file until the writer completes', SETTLES_WITHIN, async (t) => {
  for (const initial of ['', 'r', 're', 'rea', 'read']) {
    const run = await heldReadiness(t);
    writeFileSync(run.ready, initial);
    assert.equal(readFileSync(run.ready, 'utf8'), initial);
    const observation = observeReadiness(run.ready, t);
    await Promise.race([observation.checked, observation.reading]);
    assert.equal(observation.ended(), false, 'the nonliteral readiness wait ended before release');
    assert.equal(observation.reads(), 0, 'an assertion read the held readiness file');
    run.writer.stdin.end('release\n');
    assert.deepEqual(await run.closed, { status: 0, signal: null });
    assert.equal(readyComplete(run.ready), true, 'the complete readiness literal was refused');
    assert.equal(await observation.reading, 'ready');
    assert.equal(observation.reads(), 1);
  }
});

// Host reason: OS behaviour; held real writers supply nonliteral states, with no Rigger decision.
test('native readiness wait without the literal ends only at the test signal without reading', SETTLES_WITHIN, async (t) => {
  const nonliteral = [null, '', 'rea', 'r', 're', 'read', 'wrong', 'Ready', 'READY',
    ' ready', 'ready ', 'ready\n', 'ready\r\n', 'ready!', 'not-ready', 'ready\0', '"ready"'];
  for (const content of nonliteral) {
    const run = await heldReadiness(t);
    if (content === null) unlinkSync(run.ready);
    else writeFileSync(run.ready, content);
    const actual = () => existsSync(run.ready) ? readFileSync(run.ready, 'utf8') : null;
    assert.equal(actual(), content, 'the nonliteral fixture must be established before observation');
    assert.equal(alive(run.writer.pid), true, 'the writer must still be held at its gate');
    const controller = new AbortController();
    const signal = AbortSignal.any([t.signal, controller.signal]);
    const observation = observeReadiness(run.ready, { signal });
    await Promise.race([observation.checked, observation.reading]);
    assert.equal(signal.aborted, false);
    assert.equal(observation.ended(), false, 'the wait ended before the test aborted its signal');
    assert.equal(observation.reads(), 0, 'an assertion read readiness before cancellation');
    const reason = 'the readiness test cancelled its observation';
    controller.abort(reason);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(observation.ended(), true, 'the readiness wait ignored the test signal');
    await assert.rejects(observation.reading, {
      message: 'the test ended before the condition this wait was on held', cause: reason,
    });
    assert.equal(observation.reads(), 0, 'an assertion read readiness after cancellation');
    assert.equal(actual(), content, 'the writer published without gate release');
    run.writer.kill('SIGKILL');
    await run.closed;
  }
});

// Host reason: OS behaviour; a live gated writer and complete file depend on no Rigger decision.
test('native readiness already complete is observed while the writer remains held', SETTLES_WITHIN, async (t) => {
  const run = await heldReadiness(t);
  writeFileSync(run.ready, 'ready');
  assert.equal(alive(run.writer.pid), true);
  assert.equal(readFileSync(run.ready, 'utf8'), 'ready');
  assert.equal(readyComplete(run.ready), true, 'the already complete readiness literal was refused');
  const observation = observeReadiness(run.ready, t);
  assert.equal(await observation.reading, 'ready');
  assert.equal(observation.reads(), 1);
  assert.equal(alive(run.writer.pid), true, 'observation must not require writer exit');
});

/** Changing bytes at the exit boundary distinguishes an early cache from a post-exit read. */
async function exitOrderedReadiness(t, automatic) {
  const observations = [], reads = [];
  let directPID, ready;
  const originalRead = fs.readFileSync;
  const originalKill = process.kill;
  process.kill = function (pid, signal) {
    // A real SIGKILL has no exit trap: publish the fixture's final bytes immediately before it.
    if (automatic && pid === directPID && signal === 'SIGKILL') writeFileSync(ready, 'at-exit');
    return originalKill.call(this, pid, signal);
  };
  fs.readFileSync = function (path, ...args) {
    const watched = typeof path === 'string' && path.endsWith('/list.ready');
    const pidFile = watched ? join(dirname(path), 'list.pid') : null;
    const pid = watched && existsSync(pidFile) ? Number(originalRead(pidFile, 'utf8').trim()) : null;
    const directAlive = watched ? (pid === null ? null : alive(pid)) : undefined;
    const value = originalRead.call(this, path, ...args);
    if (directAlive !== undefined) reads.push({ directAlive, value });
    return value;
  };
  syncBuiltinESMExports();
  try {
    // Host reason: OS behaviour; the real shell exit and signal establish order, with no Rigger decision.
    await t.test('native readiness record fixture reaches live pre-exit bytes', SETTLES_WITHIN, async (fixture) => {
      const name = automatic ? 'automatic-readiness-record' : 'readiness-record';
      const context = {
        signal: fixture.signal,
        after: (hook) => fixture.after(hook),
        diagnostic(message) {
          fixture.diagnostic(message);
          const observation = JSON.parse(message);
          if (observation.name === name) observations.push(observation);
        },
      };
      const run = nativeRead(context, name,
        'printf before-exit > "$MATRIX_READY"\n'
        + 'printf armed > "$MATRIX_PROBE"\n'
        + 'while [ ! -f "$MATRIX_CALLED" ]; do :; done\n'
        + 'printf at-exit > "$MATRIX_READY"\n'
        + 'printf "test/a.test.mjs\\n"');
      ready = run.ready;
      await until(() => existsSync(run.probe) && readFileSync(run.probe, 'utf8') === 'armed', fixture);
      directPID = run.directPID();
      assert.ok(Number.isSafeInteger(directPID) && directPID > 0);
      assert.equal(alive(directPID), true, 'the direct shell must be alive before observation');
      assert.equal(originalRead(ready, 'utf8'), 'before-exit');
      if (!automatic) {
        const finishing = run.finish();
        writeFileSync(run.called, 'release');
        const result = await finishing;
        assert.equal(result.status, 0, result.stderr);
      }
    });
  } finally {
    process.kill = originalKill;
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
  assert.equal(observations.length, 1, 'completion must emit one readiness snapshot');
  const [observation] = observations;
  if (automatic) assert.equal(observation.teardownOnly, true);
  assert.equal(observation.directPID, directPID);
  assert.equal(observation.readiness, 'at-exit', 'readiness retained bytes from before shell exit');
  assert.ok(reads.length > 0, 'the readiness field must be read from the file');
  assert.equal(reads.every((read) => read.directAlive === false), true, 'readiness was read while the direct shell was alive');
  assert.equal(observation.directGone, true, 'readiness was recorded while the direct shell was alive');
  assert.equal(alive(directPID), false, 'completion left the direct shell alive');
}

// Host reason: wiring; the generator's real shell exit and recording depend on no Rigger decision.
test('native readiness record reads the final bytes after the direct shell ends', SETTLES_WITHIN, async (t) => {
  await exitOrderedReadiness(t, false);
});

// Host reason: OS behaviour; automatic teardown of the real shell depends on no Rigger decision.
test('native automatic teardown records readiness only after direct shell exit', SETTLES_WITHIN, async (t) => {
  await exitOrderedReadiness(t, true);
});
