// ABOUTME: Exercises the complete suite reaper in process against isolated command and lifecycle answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { SWEEPS } from './process-fixtures.mjs';

const reaper = new URL('./suite-reaper', import.meta.url);
const pid = 4242;
const run = '/controlled-1075/run';
const raw = Buffer.concat([Buffer.from('4242 Z Thu Jan  1 00:00:00 1970 controlled-'), Buffer.from([255, 10])]);
let evaluation = 0;

// ps(1) documents these pid/stat/lstart/command columns. This scripted octet fault is
// a capture/decoding control, not evidence that native ps emits invalid UTF-8.
async function tracedEntry(check, { creationError, stdout = raw, answers, zero = 'ESRCH', enabled = true, appendFault, targetPid = pid } = {}) {
  const savedExitCode = process.exitCode;
  const keys = ['argv', 'env', 'exit', 'exitCode', 'kill', 'getuid', 'once'];
  const properties = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]));
  const consoleMethods = ['error', 'warn', 'log', 'info', 'debug'];
  const savedConsole = Object.fromEntries(consoleMethods.map((key) => [key, console[key]]));
  const savedClock = Date.now;
  const name = '__rigger1075Collaborators';
  const savedGlobal = Object.getOwnPropertyDescriptor(globalThis, name);
  const stopped = new Error('controlled nonreturning process exit');
  const exits = [];
  const exitListeners = [];
  const seen = { removed: [], diagnostics: [], stdout: [], files: [], signals: [], exit: undefined, targetReads: 0, openAttempts: 0, appendAttempts: 0 };
  let census = 0;
  let hook;
  try {
    process.argv = [process.execPath, reaper.pathname, run, '/controlled-1075/ended'];
    process.env = { ...process.env, RIGGER_1075_TRACE_DIR: '/controlled-1075/evidence', RIGGER_1075_INVOCATION_ID: 'trace-octets' };
    if (!enabled) delete process.env.RIGGER_1075_TRACE_DIR;
    process.exitCode = undefined;
    process.getuid = () => 501;
    process.kill = (target, signal) => {
      seen.signals.push([target, signal]); assert.equal(target, targetPid);
      if (signal === 0 && zero !== 'reachable') throw Object.assign(new Error(`controlled ${zero}`), { code: zero });
      return true;
    };
    process.once = function(event, listener) {
      if (event === 'exit') { exitListeners.push(listener); return process; }
      return properties.once.value.call(this, event, listener);
    };
    process.exit = (status) => { seen.exit = status; for (const listener of exitListeners) listener(status); exits.push(status); throw stopped; };
    console.error = (message) => {
      if (exits.length && String(message).includes(stopped.message)) throw stopped;
      seen.diagnostics.push(String(message));
    };
    console.warn = (message) => { seen.diagnostics.push(String(message)); };
    for (const key of ['log', 'info', 'debug']) console[key] = (message) => { seen.stdout.push(String(message)); };
    Date.now = () => { throw new Error('the reaper read an uninjected clock'); };
    globalThis[name] = {
      spawnSync(command, args, options) {
        if (command === '/bin/ps' && args[0] === '-ww') {
          assert.deepEqual(args, ['-ww', '-p', String(targetPid), '-o', 'pid=,stat=,lstart=,command=']);
          assert.equal(options.env.LC_ALL, 'C'); assert.equal(options.env.TZ, 'UTC0');
          assert.equal(options.timeout, 1000); assert.equal(options.killSignal, 'SIGKILL');
          const answer = answers?.[Math.min(seen.targetReads, answers.length - 1)]
            ?? { status: 0, signal: null, stdout, stderr: '' };
          seen.targetReads += 1;
          const transport = (value) => typeof value === 'string' || Buffer.isBuffer(value)
            ? Buffer.from(value).toString(options.encoding) : value;
          return { ...answer, stdout: transport(answer.stdout), stderr: transport(answer.stderr) };
        }
        if (command === '/bin/ps') {
          assert.deepEqual(args, ['-U', '501', '-o', 'pid=,ppid=,stat=,command=']);
          return { status: 0, stdout: census++ === 0 ? `${targetPid} 1 S fixture ${run}\n` : '', stderr: '' };
        }
        assert.equal(command, '/controlled-lsof');
        return { status: 0, stdout: '', stderr: '' };
      },
      realpathSync: Object.assign((path) => path, { native: (path) => path }),
      createReadStream() {
        seen.filesAtPipeOpen = seen.files.length;
        const stream = new EventEmitter();
        stream.resume = () => queueMicrotask(() => stream.emit('end'));
        return stream;
      },
      openSync(path, flags, mode) {
        seen.openAttempts += 1;
        assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
        // openSync reports a missing parent by throwing ENOENT, as the card's fault control requires.
        if (creationError) throw Object.assign(new Error('controlled trace creation failure'), { code: creationError });
        seen.files.push({ path, chunks: [], closed: false });
        return seen.files.length - 1;
      },
      writeSync(fd, bytes) {
        const chunk = Buffer.from(bytes);
        seen.appendAttempts += 1;
        // writeSync may throw EIO or return fewer bytes; neither is a complete append.
        if (seen.appendAttempts === 2 && appendFault === 'EIO') throw Object.assign(new Error('controlled append failure'), { code: 'EIO' });
        if (seen.appendAttempts === 2 && appendFault === 'short') {
          const partial = chunk.subarray(0, Math.floor(chunk.length / 2));
          seen.files[fd].chunks.push(partial); return partial.length;
        }
        seen.files[fd].chunks.push(chunk); return chunk.length;
      },
      closeSync(fd) { seen.files[fd].closed = true; },
      removeTemporaryDirectory(path) { seen.removed.push(path); },
    };
    const entry = `${reaper.href}?evaluation=${++evaluation}`;
    const exports = new Map([
      ['node:child_process', `export const { spawnSync } = globalThis.${name};`],
      ['node:fs', `export const { realpathSync, createReadStream, openSync, writeSync, closeSync } = globalThis.${name};`],
      ['./temporary-directory.mjs', `export const { removeTemporaryDirectory } = globalThis.${name};`],
      ['../src/substrate/process.mjs', "export const LSOF = '/controlled-lsof';"],
    ]);
    hook = registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === entry && exports.has(specifier)) return {
        url: `data:text/javascript,${encodeURIComponent(exports.get(specifier))}#${evaluation}`, shortCircuit: true,
      };
      return next(specifier, context);
    } });
    try { await import(entry); } catch (error) { if (error !== stopped) throw error; }
    if (!exits.length) { seen.exit = process.exitCode ?? 0; for (const listener of exitListeners) listener(seen.exit); }
    assert.deepEqual(seen.stdout, [], 'the standalone reaper must add no standard-output diagnostic');
    await check(seen);
    return seen;
  } finally {
    hook?.deregister();
    for (const key of keys) {
      if (properties[key]) Object.defineProperty(process, key, properties[key]);
      else delete process[key];
    }
    process.exitCode = savedExitCode;
    for (const key of consoleMethods) console[key] = savedConsole[key];
    Date.now = savedClock;
    if (savedGlobal) Object.defineProperty(globalThis, name, savedGlobal);
    else delete globalThis[name];
  }
}

test('opt-in reaper trace preserves targeted octets and the UTF-8 decision value', async () => {
  assert.equal(SWEEPS, 10);
  await tracedEntry((seen) => {
    assert.equal(seen.exit, 0, seen.diagnostics.join('\n'));
    assert.deepEqual(seen.removed, [run]);
    assert.deepEqual(seen.diagnostics, []);
    const records = seen.files.flatMap(({ chunks }) => Buffer.concat(chunks).toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    const reads = records.filter(({ event }) => event === 'target-read');
    assert.equal(reads.length, 1, 'the complete entry point must emit exactly one target-read record');
    const [read] = reads;
    assert.equal(read.invocationId, 'trace-octets'); assert.equal(read.run, run);
    assert.equal(read.reaperPid, process.pid); assert.equal(read.targetPid, pid);
    assert.equal(read.ordinal, 1); assert.equal(read.sweep, 0);
    assert.equal(read.command, '/bin/ps');
    assert.deepEqual(read.args, ['-ww', '-p', '4242', '-o', 'pid=,stat=,lstart=,command=']);
    assert.deepEqual(read.locale, { LC_ALL: 'C', TZ: 'UTC0' });
    assert.deepEqual(read.result.status, { type: 'number', value: 0 });
    assert.deepEqual(read.result.signal, { type: 'null', value: null });
    assert.deepEqual(read.result.error, { type: 'undefined' });
    assert.equal(read.result.stdout.base64, raw.toString('base64'));
    assert.equal(read.result.stdout.byteLength, raw.length);
    assert.deepEqual(read.result.stdout.decoded, { type: 'string', value: '4242 Z Thu Jan  1 00:00:00 1970 controlled-\uFFFD\n' });
    assert.deepEqual(read.result.stderr.decoded, { type: 'string', value: '' });
    assert.ok(records.some(({ event, readId }) => event === 'target-decision' && readId === read.readId));
    assert.ok(records.some(({ event, reads: count }) => event === 'complete' && count === 1));
    assert.ok(seen.files.every(({ closed }) => closed));
  });
});

test('trace creation ENOENT leaves a confirmed ending unchanged', async () => {
  await assert.doesNotReject(tracedEntry((seen) => {
    assert.equal(seen.exit, 0, seen.diagnostics.join('\n'));
    assert.deepEqual(seen.removed, [run]);
    assert.deepEqual(seen.diagnostics, []);
    assert.deepEqual(seen.files, []);
  }, { creationError: 'ENOENT' }), 'trace creation ENOENT must not interrupt a confirmed ending');
});

test('reaper stand-ins restore exitCode after a refused observation', async () => {
  const before = process.exitCode;
  await tracedEntry((seen) => {
    assert.equal(seen.exit, 1);
    assert.match(seen.diagnostics.join('\n'), /ending read was malformed or ambiguous/);
    assert.deepEqual(seen.removed, []);
  }, { stdout: Buffer.from('not-a-process-row\n') });
  assert.equal(process.exitCode, before, 'exitCode must be restored after a refused observation');
});

test('trace creation EACCES and failed appends leave confirmed ending unchanged', async () => {
  for (const options of [{ creationError: 'EACCES' }, { appendFault: 'EIO' }, { appendFault: 'short' }]) {
    await tracedEntry((seen) => {
      assert.equal(seen.exit, 0);
      assert.deepEqual(seen.removed, [run]);
      assert.deepEqual(seen.diagnostics, []);
      if (options.creationError) assert.deepEqual(seen.files, []);
      else {
        assert.equal(seen.appendAttempts, 2, 'a failed writer must stop appending');
        assert.equal(seen.files.length, 1);
        assert.equal(seen.files[0].closed, true);
        assert.doesNotMatch(Buffer.concat(seen.files[0].chunks).toString('utf8'), /"event":"complete"/);
      }
    }, options);
  }
});

test('unset trace performs no trace file operation and adds no diagnostic', async () => {
  await tracedEntry((seen) => {
    assert.equal(seen.exit, 0); assert.deepEqual(seen.removed, [run]);
    assert.deepEqual(seen.files, []); assert.equal(seen.openAttempts, 0); assert.equal(seen.appendAttempts, 0);
    assert.deepEqual(seen.diagnostics, []);
  }, { enabled: false, creationError: 'EACCES' });
});

test('entry stand-ins restore process console clock and builtins after assertion failure', async () => {
  const keys = ['argv', 'env', 'exit', 'exitCode', 'kill', 'getuid', 'once'];
  const before = keys.map((key) => Object.getOwnPropertyDescriptor(process, key));
  const exitCode = process.exitCode;
  const error = console.error; const clock = Date.now;
  const fs = await import('node:fs'); const realpath = fs.realpathSync;
  await assert.rejects(tracedEntry(() => assert.fail('deliberate callback assertion'), {
    stdout: Buffer.from('not-a-process-row\n'),
  }), /deliberate callback assertion/);
  assert.deepEqual(keys.map((key) => Object.getOwnPropertyDescriptor(process, key)), before);
  assert.equal(process.exitCode, exitCode); assert.equal(console.error, error); assert.equal(Date.now, clock);
  assert.equal((await import('node:fs')).realpathSync, realpath);
  assert.equal(Object.hasOwn(globalThis, '__rigger1075Collaborators'), false);
});

const start = 'Thu Jan  1 00:00:00 1970';
const changed = 'Fri Jan  2 00:00:00 1970';
const row = (state = 'S', birth = start, identity = '4242') => `${identity} ${state} ${birth} controlled-command\n`;
const reply = (stdout, changes = {}) => ({ status: 0, signal: null, stdout, stderr: '', ...changes });

// These outcomes come from #1075 r2's finite map, not from a copy of the parser.
test('targeted answers follow the finite ending-read and remembered-target maps', async (t) => {
  const cases = [
    ['E0', [reply('')], {}, 0],
    ['E1', [reply('', { status: 1 })], {}, 0],
    ...[0, 1].map((status) => [`E2-status-${status}`, [reply('', { status })], { zero: 'reachable' }, 1, /was omitted while signal zero still reaches it/]),
    ...[0, 1].flatMap((status) => ['EPERM', 'EIO'].map((zero) => [`E3-status-${status}-${zero}`, [reply('', { status })], { zero }, 1, new RegExp(`absence is unconfirmed: ${zero}`)])),
    ['V0', [reply(row('SN'))], {}, 1, /observed targets unconfirmed/, 10],
    ['V1', [reply(row('Z'))], {}, 0],
    ['I-live', [reply(row()), reply(row('S', changed))], {}, 1, /changed its coarse start identity/, 2],
    ['I-zombie', [reply(row()), reply(row('Z', changed))], {}, 1, /changed its coarse start identity/, 2],
    ['I-question-mark-zombie', [reply(row('?E')), reply(row('Z', changed))], {}, 1, /changed its coarse start identity/, 2],
    ['P-grammar', [reply('not-a-row\n')], {}, 1, /ending read was malformed or ambiguous/],
    ['P-unsafe', [reply(row('Z', start, '9007199254740992'))], { targetPid: 9007199254740992 }, 1, /ending read was malformed or ambiguous/],
    ['P-wrong', [reply(row('Z', start, '4243'))], {}, 1, /ending read was malformed or ambiguous/],
    ['F-duplicate', [reply(row() + row())], {}, 1, /ending read has invalid row framing/],
    ['F-extra-LF', [reply(row() + '\n')], {}, 1, /ending read has invalid row framing/],
    ...['\r', '\v', '\f', '\u0085', '\u2028', '\u2029'].map((separator, index) => [`F-separator-${index}`, [reply(row().replace('4242 ', `4242${separator}`))], {}, 1, /ending read has invalid row framing/]),
    ['X1', [reply('', { status: null, error: Object.assign(new Error('controlled ENOENT'), { code: 'ENOENT' }) })], {}, 1, /ending read failed:.*error=ENOENT/],
    ['X2', [reply(row(), { signal: 'SIGTERM' })], {}, 1, /ending read failed:.*signal=SIGTERM/],
    ['X3', [reply('', { status: null, signal: 'SIGKILL', error: Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' }) })], {}, 1, /ending read failed:.*error=ETIMEDOUT/],
    ['X4', [reply(row(), { stderr: 'controlled warning' })], {}, 1, /ending read failed:.*stderr="controlled warning"/],
    ['X5', [reply(null)], {}, 1, /ending read failed/],
    ['X6-status2-empty', [reply('', { status: 2 })], {}, 1, /ending read failed: status=2/],
    ['X6-null', [reply('', { status: null })], {}, 1, /ending read failed: status=null/],
    ['X6-status1-row', [reply(row(), { status: 1 })], {}, 1, /ending read failed: status=1/],
    ['remembered-live-then-zombie', [reply(row()), reply(row()), reply(row('Z'))], {}, 0, undefined, 3],
    ['remembered-live-then-absence', [reply(row()), reply('', { status: 1 })], {}, 0, undefined, 2],
  ];
  for (const [cell, answers, options, status, diagnostic, reads = 1] of cases) {
    await t.test(cell, async () => {
      await tracedEntry((seen) => {
        assert.equal(seen.exit, status, cell);
        assert.deepEqual(seen.removed, status === 0 ? [run] : [], cell);
        if (diagnostic) assert.match(seen.diagnostics.join('\n'), diagnostic, cell);
        else assert.deepEqual(seen.diagnostics, [], cell);
        assert.equal(seen.targetReads, reads, cell);
        assert.deepEqual(seen.signals.filter(([, signal]) => signal === 'SIGKILL'), [[options.targetPid ?? pid, 'SIGKILL']], 'only fresh census selection grants a signal');
      }, { ...options, answers, enabled: false });
    });
  }
});


test('writer trace begins before waiting for the suite pipe to close', async () => {
  await tracedEntry((seen) => {
    assert.equal(seen.filesAtPipeOpen, 1, 'a started writer needs a retained original before an owned abort can end it');
    const records = seen.files.flatMap(({ chunks }) => Buffer.concat(chunks).toString('utf8').trim().split('\n').map(JSON.parse));
    assert.equal(records[0].event, 'writer-start');
    const begin = records.findIndex(({ event }) => event === 'target-read-start');
    const result = records.findIndex(({ event }) => event === 'target-read');
    assert.ok(begin > 0 && result > begin, 'each targeted invocation must be registered before its result');
    assert.equal(records[begin].readId, records[result].readId);
  });
});

// Native shape source: 1075-T2-native-001 at fa623d62b0d4ac25583c0a65f889e0a231fb525f, target argument PID90400.
// Raw base64: OTA0MDAgP0UgICBNb24gTm92ICAyIDA4OjQzOjMwIDIwMjYgICAgIChub2RlKQo=
// This deterministic replay substitutes identity fields from the controlled fixture.
// It claims no native lifecycle. G3's held-zombie and live controls supply that proof.
test('native question-mark exiting state stays pending until a matching positive ending', async () => {
  await tracedEntry((seen) => {
    assert.equal(seen.exit, 0, 'a matching positive ending after the transient native state must succeed');
    assert.deepEqual(seen.removed, [run]);
    assert.deepEqual(seen.diagnostics, []); assert.equal(seen.targetReads, 2);
    const records = seen.files.flatMap(({ chunks }) => Buffer.concat(chunks).toString('utf8').trim().split('\n').map(JSON.parse));
    const decisions = records.filter(({ event }) => event === 'target-decision');
    assert.deepEqual(decisions.map(({ current, remembered }) => [current.zombie, remembered]), [[false, true], [true, false]], 'the transient observation must not itself confirm ending');
    assert.deepEqual(seen.signals.filter(([, signal]) => signal === 'SIGKILL'), [[pid, 'SIGKILL']]);
  }, { answers: [reply(row('?E')), reply(row('Z'))] });
});

test('native question-mark exiting state cannot confirm a still-live target', async () => {
  await tracedEntry((seen) => {
    assert.equal(seen.exit, 1); assert.deepEqual(seen.removed, []);
    assert.match(seen.diagnostics.join('\n'), /observed targets unconfirmed/);
    assert.equal(seen.targetReads, 10);
    assert.deepEqual(seen.signals.filter(([, signal]) => signal === 'SIGKILL'), [[pid, 'SIGKILL']]);
  }, { answers: [reply(row('?E'))] });
});


test('trace I/O fault outcomes equal the unset writer byte for byte', async () => {
  const outcome = ({ exit, removed, diagnostics, stdout }) => ({ exit, removed,
    stderr: Buffer.from(diagnostics.map((line) => `${line}\n`).join('')),
    stdout: Buffer.from(stdout.map((line) => `${line}\n`).join('')) });
  const unset = outcome(await tracedEntry(() => {}, { enabled: false }));
  assert.deepEqual(unset, { exit: 0, removed: [run], stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) });
  for (const fault of [{ creationError: 'ENOENT' }, { creationError: 'EACCES' }, { appendFault: 'EIO' }, { appendFault: 'short' }]) {
    const observed = outcome(await tracedEntry(() => {}, fault));
    assert.equal(observed.exit, unset.exit);
    assert.deepEqual(observed.stderr, unset.stderr);
    assert.deepEqual(observed.stdout, unset.stdout);
    assert.deepEqual(observed.removed, unset.removed);
  }
});

test('trace preserves null undefined and non-string result distinctions on refused reads', async () => {
  const cases = [
    [{ status: undefined, signal: undefined, stdout: undefined, stderr: undefined, error: null }, {
      status: { type: 'undefined' }, signal: { type: 'undefined' }, error: { type: 'null', value: null },
      stdout: { type: 'undefined', decoded: { type: 'undefined' } }, stderr: { type: 'undefined', decoded: { type: 'undefined' } },
    }],
    [{ status: null, signal: 'SIGTERM', stdout: null, stderr: '', error: Object.assign(new Error('scripted EIO'), { code: 'EIO' }) }, {
      status: { type: 'null', value: null }, signal: { type: 'string', value: 'SIGTERM' },
      error: { type: 'error', code: { type: 'string', value: 'EIO' }, message: { type: 'string', value: 'scripted EIO' } },
      stdout: { type: 'null', value: null, decoded: { type: 'null', value: null } },
      stderr: { type: 'string', base64: '', byteLength: 0, decoded: { type: 'string', value: '' } },
    }],
    [{ status: 1, signal: null, stdout: 42, stderr: null }, {
      status: { type: 'number', value: 1 }, signal: { type: 'null', value: null }, error: { type: 'undefined' },
      stdout: { type: 'number', value: 42, decoded: { type: 'number', value: 42 } },
      stderr: { type: 'null', value: null, decoded: { type: 'null', value: null } },
    }],
  ];
  for (const [answer, expected] of cases) {
    await tracedEntry((seen) => {
      assert.equal(seen.exit, 1); assert.deepEqual(seen.removed, []);
      assert.match(seen.diagnostics.join('\n'), /ending read failed/);
      const records = seen.files.flatMap(({ chunks }) => Buffer.concat(chunks).toString('utf8').trim().split('\n').map(JSON.parse));
      const read = records.find(({ event }) => event === 'target-read');
      assert.deepEqual(read.result, expected);
      assert.ok(records.some(({ event, readId, refused }) => event === 'target-decision' && readId === read.readId && /ending read failed/.test(refused)));
    }, { answers: [answer] });
  }
});
