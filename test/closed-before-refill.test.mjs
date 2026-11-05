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
  step(script);
  return { records, files, pending, listeners, readCount: () => read };
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
