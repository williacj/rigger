// ABOUTME: Checks the host fixture test's entry-child start record: only allowlisted environment
// names reach it, while the spawned child still receives the caller's whole environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { RECORDED_NAMES, entryChild } from './entry-child.mjs';

/**
 * A stand-in for `child_process.spawn` that records its call and answers with a child that exits
 * 0 once its input ends. Its shape follows Node's documented ChildProcess contract
 * (https://nodejs.org/api/child_process.html#class-childprocess): `pid`, readable `stdout` and
 * `stderr`, writable `stdin`, and a `close` event carrying `(code, signal)` after the stdio
 * streams have ended.
 */
function standInSpawn() {
  const calls = [];
  const start = (command, argv, options) => {
    calls.push({ command, argv, options });
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.stdin.once('finish', () => {
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', 0, null));
    });
    return child;
  };
  return { start, calls };
}

/** Runs entryChild over the stand-in and returns the start diagnostic's text and the spawn calls. */
async function recordedStart(environment) {
  const diagnostics = [];
  const spawned = standInSpawn();
  await entryChild({ diagnostic: (message) => diagnostics.push(message) },
    '/fixture/bin/tool', ['plan', '--flag'], '/fixture/consumer', environment, '', spawned.start);
  const starts = diagnostics.filter((message) => message.startsWith('entry-child-start '));
  assert.equal(starts.length, 1, 'entryChild emits exactly one start diagnostic');
  return { text: starts[0], calls: spawned.calls };
}

/** Whether any object in a parsed record holds `name` with `value`, wherever the record nests it. */
const holds = (node, name, value) => node !== null && typeof node === 'object'
  && (node[name] === value || Object.values(node).some((child) => holds(child, name, value)));

test('the entry-child start record omits an environment name outside the allowlist and its value', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin:/fixture/tools', RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' });
  assert.equal(text.includes('RIGGER_ENTRY_OUTSIDE'), false, `the outside name reached the start record: ${text}`);
  assert.equal(text.includes('outside-value-5d1c'), false, `the outside value reached the start record: ${text}`);
});

test('the entry-child start record keeps PATH with the value the caller passed', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/gh-dir:/fixture/installed', RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' });
  const record = JSON.parse(text.slice('entry-child-start '.length));
  assert.ok(holds(record, 'PATH', '/fixture/gh-dir:/fixture/installed'), `the start record lost PATH or its value: ${text}`);
});

test('the entry-child start record still names the child pid, command, argv and cwd', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin' });
  const record = JSON.parse(text.slice('entry-child-start '.length));
  assert.deepEqual({ pid: record.pid, command: record.command, argv: record.argv, cwd: record.cwd },
    { pid: 4242, command: '/fixture/bin/tool', argv: ['plan', '--flag'], cwd: '/fixture/consumer' });
});

test('entryChild hands spawn the caller\'s whole environment, outside names included', async () => {
  const environment = { PATH: '/fixture/bin', HOME: '/fixture/home', RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' };
  const { calls } = await recordedStart(environment);
  assert.equal(calls.length, 1, 'entryChild starts exactly one child');
  assert.deepEqual({ ...calls[0].options.env }, { PATH: '/fixture/bin', HOME: '/fixture/home', RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' });
});

test('the recorded-name allowlist holds PATH and only names the host fixture callers set for a reason', () => {
  const permitted = new Set(['PATH', 'HOME', 'LANG', 'CODEX_HOME', 'RIGGER_STAND_IN_VALUE']);
  assert.ok(RECORDED_NAMES.includes('PATH'), 'the allowlist holds PATH');
  for (const name of RECORDED_NAMES) assert.ok(permitted.has(name), `the allowlist holds ${name}, outside the permitted set`);
});
