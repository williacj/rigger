// ABOUTME: Proves the matrix generator's native suite-list launch, exit, signal, deadline and output limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  await until(() => existsSync(run.ready), t);
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
