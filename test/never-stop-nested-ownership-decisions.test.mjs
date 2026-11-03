// ABOUTME: Exercises nested ownership capture through the complete host module's registered callbacks, with in-process process answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
import { mkdirSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, symlinkSync, chmodSync } from 'node:fs';

let evaluation = 0;

/** ChildProcess's nullable statuses and error/close streams, without a native process. */
function childAnswer(pid) {
  const child = new EventEmitter();
  Object.assign(child, { pid, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  child.stdout.setEncoding = child.stderr.setEncoding = function () { return this; };
  child.close = (status, signal = null) => {
    child.exitCode = status;
    child.signalCode = signal;
    child.emit('close', status, signal);
  };
  return child;
}

async function withOwnershipModule(t, exercise) {
  const root = join(realpathSync.native(process.env.C615_EVIDENCE_ROOT), `recorder-control-${randomUUID()}`);
  mkdirSync(root, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true }));
  const title = 'nested ownership real close: answered, live descendant';
  const entry = new URL('./never-stop.test.mjs', import.meta.url);
  entry.searchParams.set('ownership-capture', String(++evaluation));
  const key = `nestedOwnershipAnswers${evaluation}`;
  const callbacks = new Map();
  const teardowns = [];
  const diagnostics = [];
  const calls = [];
  const birth = 'Wed Oct 28 12:00:00 2026';
  const command = 'recorded controlled payload';
  let state = 'S';
  let toolPid = 5000;
  // The payload's checked IPC schema and targeted ps argv come from the original host callback.
  // Answers model its documented ChildProcess contract; they are controlled, never native evidence.
  const collaborators = {
    test(name, ...args) { callbacks.set(name, args.at(-1)); },
    spawn(program, args, options) {
      calls.push({ program, args });
      if (args[0] === '-e' && args[1].includes('recorder ready')) {
        assert.equal(program, process.execPath);
        const child = childAnswer(6001);
        options.signal.addEventListener('abort', () => queueMicrotask(() => {
          child.emit('error', Object.assign(new Error('controlled cancelled read'), { code: 'ABORT_ERR' }));
          child.close(null, 'SIGKILL');
        }), { once: true });
        queueMicrotask(() => child.stdout.emit('data', 'recorder ready\n'));
        return child;
      }
      if (args[0] === '-e') {
        assert.equal(program, process.execPath);
        const child = childAnswer(4242);
        child.send = (message) => {
          assert.equal(message, 'identified');
          queueMicrotask(() => child.close(7));
        };
        queueMicrotask(() => child.stdout.emit('data', '{"pid":4242,"descendant":4343}\n'));
        return child;
      }
      assert.deepEqual(args, ['-ww', '-p', '4343', '-o', 'lstart=,stat=,command=']);
      const child = childAnswer(++toolPid);
      const stdout = `${birth} ${state} ${command}\n`;
      queueMicrotask(() => { child.stdout.emit('data', stdout); child.close(0); });
      return child;
    },
    unexpected() { assert.fail('unexpected synchronous process start'); },
    holding(context) {
      const directory = temporaryDirectory('rigger-1194-census-fixture-', { context });
      writeFileSync(join(directory, 'hold'), '');
      return directory;
    },
  };
  const modules = {
    'node:test': `export const test = globalThis[${JSON.stringify(key)}].test;`,
    'node:child_process': `export const spawn = globalThis[${JSON.stringify(key)}].spawn; export const spawnSync = globalThis[${JSON.stringify(key)}].unexpected;`,
    'node:crypto': `export * from 'node:crypto'; import { randomUUID as uuid } from 'node:crypto'; export const randomUUID = () => globalThis[${JSON.stringify(key)}].uuid ?? uuid();`,
    './process-fixtures.mjs': `export * from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)}; import * as actual from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)}; export const holding = (...args) => globalThis[${JSON.stringify(key)}].fixtureCheck ? globalThis[${JSON.stringify(key)}].holding(...args) : actual.holding(...args); export const fixture = (...args) => globalThis[${JSON.stringify(key)}].fixtureCheck ? globalThis[${JSON.stringify(key)}].fixtureCheck(...args) : actual.fixture(...args);`,
  };
  const urls = new Map(Object.keys(modules).map((name) => [name, `nested-ownership-capture:${evaluation}/${name}`]));
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  const environment = new Map(['RIGGER_1194_CAPTURE', 'RIGGER_1194_RESULT', 'C615_EVIDENCE_ROOT', 'C615_SIGHTING_EVIDENCE_ROOT'].map((name) => [name, { present: Object.hasOwn(process.env, name), value: process.env[name] }]));
  let hooks;
  let loaded = false;
  try {
    globalThis[key] = collaborators;
    delete process.env.RIGGER_1194_CAPTURE;
    delete process.env.RIGGER_1194_RESULT;
    delete process.env.C615_SIGHTING_EVIDENCE_ROOT;
    process.env.C615_EVIDENCE_ROOT = root;
    t.mock.method(process, 'kill', (pid, signal) => {
      if (pid === 4343 && signal === 'SIGKILL') { state = 'Z'; return true; }
      assert.equal(pid, 4242);
      assert.equal(signal, 0);
      throw Object.assign(new Error('controlled reaped runner'), { code: 'ESRCH' });
    });
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === entry.href && urls.has(specifier)) return { url: urls.get(specifier), shortCircuit: true };
        return next(specifier, context);
      },
      load(url, context, next) {
        for (const [name, value] of urls) if (url === value) return { format: 'module', source: modules[name], shortCircuit: true };
        const result = next(url, context);
        if (url === entry.href) {
          assert.deepEqual(Buffer.from(result.source), readFileSync(entry), 'actual helper module bytes must remain untransformed');
          loaded = true;
        }
        return result;
      },
    });
    await import(entry.href);
    assert.equal(loaded, true);
    assert.equal(typeof callbacks.get(title), 'function', 'the original registration must be captured');
    await exercise({ root, title, callbacks, diagnostics, calls, teardowns, birth, command, fixtureCheck(value) { collaborators.fixtureCheck = value; }, setUUID(value) { collaborators.uuid = value; }, reset() { state = 'S'; calls.length = 0; teardowns.length = 0; diagnostics.length = 0; } });
  } finally {
    hooks?.deregister();
    t.mock.restoreAll();
    for (const [name, cell] of environment) {
      if (cell.present) process.env[name] = cell.value;
      else delete process.env[name];
    }
    if (previous) Object.defineProperty(globalThis, key, previous);
    else delete globalThis[key];
  }
}

// Harness diagnostic admitted by #1194 A/E/T; capture is not an engine dispatch record.
// Break: omit ordinary default evidence while the original real-close assertions still pass.
test('nested ownership capture retains targeted read originals alongside unchanged decisions', { timeout: 20_000 }, async (t) => {
  await withOwnershipModule(t, async ({ root, title, callbacks, diagnostics, calls, teardowns, birth, command, setUUID, reset }) => {
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
    assert.ok(diagnostics.some((line) => line.includes('"event":"complete","outcome":7')), 'the unchanged original outcome assertions must finish');
    assert.equal(calls.length, 6, 'ordinary default enrollment must add no tool call');
    const attempts = readdirSync(root).filter((name) => name.startsWith('attempt-'));
    assert.equal(attempts.length, 1, 'ordinary invocation must create default private evidence');
    const trace = join(root, attempts[0], 'trace.jsonl');
    assert.ok(existsSync(trace), 'targeted read originals were not retained');
    const rows = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const starts = rows.filter(({ event }) => event === 'ps.start');
    assert.equal(starts.length, 5, 'each issued read must retain a write-ahead start');
    assert.deepEqual(rows.map(({ sequence }) => sequence), rows.map((_, index) => index + 1), 'capture emitter ordinals must be contiguous in append order');
    assert.deepEqual(rows.filter(({ event }) => !['attempt.start', 'runner.start', 'ps.start', 'ps.spawn', 'retention', 'attempt.finish'].includes(event)).map(({ event }) => event), [
      'runner.spawn', 'ps.returned', 'identity', 'descendant.recorded', 'runner.close',
      'ps.returned', 'identity', 'descendant.signal', 'ps.returned', 'identity',
      'ps.returned', 'identity', 'descendant.final', 'complete', 'ps.returned',
    ], 'capture event identity must survive the inner payload');
    const reads = rows.filter(({ event }) => event === 'ps.returned');
    for (const read of reads) {
      const start = starts.find(({ payload }) => payload.readId === read.payload.readId);
      assert.ok(start.sequence < read.sequence, 'the same-read start must precede its return');
      assert.deepEqual(start.payload.args, read.payload.observation.args);
    }
    assert.deepEqual(reads.map(({ payload }) => payload.observation.stdout), [
      `${birth} S ${command}\n`, `${birth} S ${command}\n`,
      `${birth} Z ${command}\n`, `${birth} Z ${command}\n`, `${birth} Z ${command}\n`,
    ]);
    assert.ok(reads.every(({ payload: { observation } }) => observation.status === 0 && observation.signal === null && observation.stderr === '' && observation.error === null));
    assert.deepEqual(reads.map(({ payload }) => payload.readId), [1, 2, 3, 4, 5]);
    assert.ok(rows.every(({ result, caseName, writer }) => result === rows[0].result && typeof result === 'string' && caseName === title && writer === process.pid), 'capture envelope identities must remain stable');
    const identities = rows.filter(({ event }) => event === 'identity');
    assert.deepEqual(identities.map(({ payload }) => [payload.readId, payload.phase]), [[1, 'recorded'], [2, 'before-signal'], [3, 'after-signal'], [4, 'final']]);
    const cleanup = identities.filter(({ payload }) => ['before-signal', 'after-signal'].includes(payload.phase));
    assert.deepEqual(cleanup.map(({ payload }) => payload.sequence), [1, 2], 'inner cleanup read sequence must remain available');
    assert.ok(cleanup.every(({ sequence, payload }) => sequence !== payload.sequence), 'inner cleanup read ordinals must remain distinct from emitter ordinals');
    for (const { payload } of identities) {
      const read = reads.find((row) => row.payload.readId === payload.readId);
      assert.equal(payload.requestedPid, Number(read.payload.observation.args[2]), 'identity must correlate with the same targeted read');
    }
    assert.deepEqual(rows.find(({ event }) => event === 'descendant.signal').payload.signal, { requestedPid: 4343, result: 'returned' });
    assert.equal(calls.length, 6, 'capture must add no tool call');
    assert.ok(diagnostics.every((line) => !line.includes(command)), 'ordinary diagnostics must not publish the controlled raw command');
    assert.equal(diagnostics.filter((line) => JSON.parse(line).event === 'never-stop.evidence').length, rows.length,
      'ordinary output must carry one safe summary per private trace record');
    assert.equal(JSON.parse(readFileSync(join(root, attempts[0], 'trace-inventory.json'), 'utf8')).availability, 'returned', 'the persistent trace inventory must classify its returned reads');
    const captured = readFileSync(trace);
    process.env.RIGGER_1194_CAPTURE = '';
    reset();
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
    assert.ok(diagnostics.some((line) => line.includes('"event":"complete","outcome":7')), 'the unchanged original outcome assertions must finish without capture');
    assert.equal(calls.length, 6, 'an empty override must retain the original tool-call count');
    assert.equal(readdirSync(root).filter((name) => name.startsWith('attempt-')).length, 2, 'an empty override must retain default enrollment');
    assert.deepEqual(readFileSync(trace), captured, 'another invocation must leave prior evidence unchanged');
    const unsafe = temporaryDirectory('rigger-1194-unsafe-', { context: t });
    process.env.RIGGER_1194_CAPTURE = join(unsafe, 'capture.jsonl');
    reset();
    await assert.rejects(callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) }),
      /never-stop evidence enrollment refused/, 'an escaping explicit destination must be refused before a child starts');
    assert.equal(calls.length, 0, 'refused enrollment must start no affected native child');
    delete process.env.RIGGER_1194_CAPTURE;
    for (const kind of ['missing', 'empty', 'absent', 'file', 'symlink', 'escaping', 'mode', 'unwritable']) {
      const selected = kind === 'escaping' ? unsafe : join(root, `refused-${kind}`);
      if (kind === 'file') writeFileSync(selected, 'untouched', { flag: 'wx', mode: 0o600 });
      if (kind === 'symlink') symlinkSync(root, selected);
      if (kind === 'mode' || kind === 'unwritable') { mkdirSync(selected, { mode: 0o700 }); chmodSync(selected, kind === 'mode' ? 0o755 : 0o500); }
      if (kind === 'missing') delete process.env.C615_EVIDENCE_ROOT;
      else process.env.C615_EVIDENCE_ROOT = kind === 'empty' ? '' : selected;
      reset();
      try {
        await assert.rejects(callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) }), /never-stop evidence enrollment refused/, `${kind}: unsafe evidence must refuse`);
        assert.equal(calls.length, 0, `${kind}: no affected child may start`);
        assert.ok(diagnostics.some((line) => JSON.parse(line).event === 'never-stop.evidence.failure'));
      } finally {
        if (kind === 'mode' || kind === 'unwritable') chmodSync(selected, 0o700);
        process.env.C615_EVIDENCE_ROOT = root;
      }
    }
    for (const previous of [attempts[0], 'attempt-11111111-1111-4111-8111-111111111111']) {
      const prior = join(root, previous);
      if (!existsSync(prior)) { mkdirSync(prior, { mode: 0o700 }); writeFileSync(join(prior, 'trace.jsonl'), '{"partial":', { flag: 'wx', mode: 0o600 }); }
      const bytes = readFileSync(join(prior, 'trace.jsonl'));
      setUUID(previous.slice('attempt-'.length));
      reset();
      await assert.rejects(callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) }), /never-stop evidence enrollment refused/, 'complete and incomplete allocation collisions must refuse');
      assert.equal(calls.length, 0);
      assert.deepEqual(readFileSync(join(prior, 'trace.jsonl')), bytes, 'collision must leave previous bytes unchanged');
      setUUID(undefined);
    }
    process.env.RIGGER_1194_CAPTURE = join(root, 'explicit.jsonl');
    process.env.RIGGER_1194_RESULT = 'result with\na quote " and $()';
    reset();
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
    assert.equal(calls.length, 6);
    const explicitRows = readFileSync(process.env.RIGGER_1194_CAPTURE, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(explicitRows.every(({ result }) => result === 'result with\na quote " and $()'), 'user supplied result text must remain parsed private data');
    assert.ok(diagnostics.every((line) => !line.includes('a quote')), 'ordinary summaries must not encode private result text');
  });
});

// Break: retain raw originals but omit their new persistent trace link across cleanup.
test('never-stop recorder retains partial census originals through cleanup', { timeout: 20_000 }, async (t) => {
  await withOwnershipModule(t, async ({ callbacks, diagnostics, teardowns }) => {
    const title = 'never-stop recorder keeps cancellation evidence after fixture cleanup';
    assert.equal(typeof callbacks.get(title), 'function');
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
  });
});

// Break: enroll only nested callers, leaving census native fixture work untraced.
test('ordinary census callers enroll before native fixture work', { timeout: 20_000 }, async (t) => {
  await withOwnershipModule(t, async ({ root, callbacks, diagnostics, calls, teardowns, fixtureCheck }) => {
    for (const [title, cell] of [
      ['B1 exit: a member named by an early census read and left a zombie is recorded by name', 'B'],
      ['X0 exit: a once-shown member reaped on its own before confirmation has no kill event', 'X'],
    ]) {
      const stop = new Error('controlled fixture boundary reached; no native work');
      fixtureCheck((directory) => {
        const id = existsSync(join(directory, 'sighting-attempt')) ? readFileSync(join(directory, 'sighting-attempt'), 'utf8') : null;
        assert.ok(id && existsSync(join(root, `attempt-${id}`, 'trace.jsonl')), 'ordinary census must enroll before fixture work');
        const rows = readFileSync(join(root, `attempt-${id}`, 'trace.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        assert.ok(rows.every(({ family, caseName }) => family === 'census' && caseName === title));
        assert.equal(rows.find(({ event }) => event === 'fixture.start').payload.cell, cell);
        throw stop;
      });
      let failure;
      try { await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) }); }
      catch (error) { failure = error; }
      if (failure !== stop) throw failure ?? new Error('the controlled fixture boundary was not reached');
      assert.equal(calls.length, 0);
    }
    for (const hook of teardowns) await hook();
  });
});
