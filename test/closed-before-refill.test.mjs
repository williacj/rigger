// ABOUTME: Controlled diagnostics for the native wait-for-close fixture's observer and read boundary.
// These assert harness evidence, which R-SCHED-3 and R-FAIL-8 do not specify; they add no product claim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('./verbs-provision.test.mjs', import.meta.url), 'utf8');
const functions = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter((node) => node.type === 'FunctionDeclaration' && ['afterAdmissionClose', 'closeWorldObserver'].includes(node.id.name))
  .map((node) => source.slice(node.start, node.end)).join('\n');

/** Execute the actual generated waiter over specified reads; no process or positive timer is started. */
function waiter(reads, card = 20) {
  const records = [];
  const files = new Map();
  const pending = [];
  const listeners = new Map();
  let read = 0;
  const fs = {
    readFileSync: () => {
      const value = reads[Math.min(read++, reads.length - 1)];
      if (value instanceof Error) throw value;
      return value;
    },
    writeFileSync: (path, bytes) => files.set(path, Buffer.from(bytes)),
    appendFileSync: (path, bytes) => records.push(JSON.parse(String(bytes))),
    mkdirSync: () => {},
  };
  const process = {
    execPath: '/controlled/node', pid: card, argv: [], cwd: () => `/world/widgets-worktrees/rigger-${card}`,
    hrtime: { bigint: () => BigInt(read) },
    once: (event, use) => listeners.set(event, use),
  };
  const context = { join, process, Buffer, standInAgent: (plan) => plan, require: (name) => {
    if (name === 'node:fs') return fs;
    if (name === 'node:path') return { join };
    throw new Error(`unexpected dependency ${name}`);
  } };
  const script = runInNewContext(`${functions}\nafterAdmissionClose('/world/target', '/evidence')`, context)['*'].engineer.exec[2];
  const step = (body) => runInNewContext(body, { ...context, setImmediate: (use) => pending.push(use) });
  let error;
  try { step(script); } catch (caught) { error = caught; }
  return { records, files, pending, listeners, error, readCount: () => read,
    advance: () => { try { pending.shift()?.(); } catch (caught) { return caught; } },
    original: () => ({ records, files: Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString('base64')])) }),
  };
}

test('the close waiter retains reads and its actual close on a passing invocation', () => {
  const close = '{"run":"run-1","event":"admission.close","card":10}\n';
  const here = waiter([close]);
  here.listeners.get('exit')?.(0);

  assert.equal(here.pending.length, 0, 'the complete close releases the waiter');
  assert.ok(here.records.some(({ event, record }) => event === 'waiter.close' && record.run === 'run-1'), 'the actual close observation is retained on success');
  assert.ok([...here.files.values()].some((bytes) => bytes.equals(Buffer.from(close))), 'the changed read bytes survive the invocation');
  assert.ok(here.records.some(({ event, code }) => event === 'worker.exit' && code === 0), 'the actual successful worker exit is retained');
});

const before = '{"run":"run-1","event":"dispatch.start","card":20}\n';
const close = '{"run":"run-1","event":"admission.close","card":10}\n';

test('complete records without a close keep the waiter alive and coalesce identical observations', (t) => {
  const here = waiter([before, before, before + close]);
  assert.equal(here.error, undefined);
  assert.equal(here.pending.length, 1, 'the fixture barrier remains held');
  assert.equal(here.records.some(({ event }) => event === 'waiter.close' || event === 'worker.exit'), false);
  assert.equal(here.advance(), undefined);
  assert.equal(here.readCount(), 2);
  assert.equal(here.pending.length, 1, 'an identical no-close read cannot release the barrier');
  assert.equal(here.advance(), undefined);
  assert.equal(here.pending.length, 0);
  here.listeners.get('exit')(0);
  const first = here.records.find(({ event }) => event === 'read.outcome');
  assert.deepEqual([first.first, first.last, first.count], [1, 2, 2]);
  t.diagnostic(JSON.stringify(here.original()));
});

test('a read failure preserves its original error and prior bytes without observing a close', (t) => {
  const failure = Object.assign(new Error('controlled read refused'), { code: 'EIO' });
  const here = waiter([before, failure]);
  assert.equal(here.advance(), failure, 'read damage reaches the caller as the original failure');
  assert.equal(here.pending.length, 0);
  assert.ok(here.records.some(({ event, error }) => event === 'read.error' && error.code === 'EIO' && error.message === failure.message));
  assert.ok([...here.files.values()].some((bytes) => bytes.equals(Buffer.from(before))));
  assert.equal(here.records.some(({ event }) => event === 'waiter.close'), false);
  t.diagnostic(JSON.stringify(here.original()));
});

test('a malformed complete record remains visible damage rather than a successful waiter', (t) => {
  const bytes = before + '{broken}\n';
  const here = waiter([bytes]);
  assert.equal(here.error?.name, 'SyntaxError');
  assert.ok(here.records.some(({ event, line }) => event === 'parse.error' && line === '{broken}'));
  assert.ok([...here.files.values()].some((snapshot) => snapshot.equals(Buffer.from(bytes))));
  assert.equal(here.records.some(({ event }) => event === 'waiter.close'), false);
  t.diagnostic(JSON.stringify(here.original()));
});

test('both sibling waiters observe the actual close before completing in either order', (t) => {
  for (const order of [[20, 30], [30, 20]]) {
    const siblings = new Map(order.map((number) => [number, waiter([before, before + close], number)]));
    const completed = [];
    for (const here of siblings.values()) {
      assert.equal(here.pending.length, 1);
      assert.equal(here.records.some(({ event }) => event === 'waiter.close'), false);
    }
    for (const number of order) {
      const here = siblings.get(number);
      assert.equal(here.advance(), undefined);
      assert.equal(here.pending.length, 0);
      assert.ok(here.records.some(({ event, record }) => event === 'waiter.close' && record.run === 'run-1'));
      here.listeners.get('exit')(0);
      completed.push(number);
      t.diagnostic(JSON.stringify(here.original()));
    }
    assert.deepEqual(completed, order);
  }
});

test('a complete malformed record after a close still fails the waiter premise', (t) => {
  const here = waiter([before + close + '{broken}\n']);
  assert.equal(here.error?.name, 'SyntaxError', 'observing a close cannot hide a malformed complete record in the same read');
  assert.ok(here.records.some(({ event, line }) => event === 'parse.error' && line === '{broken}'));
  t.diagnostic(JSON.stringify(here.original()));
});

// A plausible break parses an unfinished tail or accepts a balanced close before its terminating newline.
test('unfinished records cannot fail or release either sibling before a complete close', (t) => {
  const tail = '{"run":"run-1","event":"dispatch.st';
  const completed = '{"run":"run-1","event":"dispatch.start"}\n';
  for (const [observed, finished] of [[before + tail, before + completed + close], [before + close.slice(0, -1), before + close]]) {
    assert.ok(finished.startsWith(observed), 'each controlled stream only grows');
    for (const order of [[20, 30], [30, 20]]) {
      const siblings = new Map(order.map((number) => [number, waiter([observed, finished], number)]));
      for (const here of siblings.values()) {
        t.diagnostic(JSON.stringify(here.original()));
        assert.equal(here.error, undefined, 'an unfinished record is not a malformed complete record');
        assert.equal(here.pending.length, 1, 'an unfinished close cannot release the barrier');
        assert.equal(here.records.some(({ event }) => event === 'waiter.close'), false);
      }
      const completedOrder = [];
      for (const number of order) {
        const here = siblings.get(number);
        assert.equal(here.advance(), undefined);
        assert.equal(here.pending.length, 0);
        assert.ok(here.records.some(({ event, ordinal }) => event === 'waiter.close' && ordinal === 2));
        assert.ok([...here.files.values()].some((bytes) => bytes.equals(Buffer.from(observed))), 'the complete unfinished observation survives');
        completedOrder.push(number);
        t.diagnostic(JSON.stringify(here.original()));
      }
      assert.deepEqual(completedOrder, order);
    }
  }
});
