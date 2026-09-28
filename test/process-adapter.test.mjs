// ABOUTME: Tests L0's process adapter: a command's exit code, output, working directory and
// environment, the process group it runs in, and the survivors it kills and records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSink } from '../src/observation/sink.mjs';
import { runCommand } from '../src/substrate/process.mjs';

/**
 * A scratch directory for one test, torn down with every process that names it.
 *
 * Every fixture process in this file carries the directory's path in its command line, so the
 * teardown finds each one by it, whether the test passed or failed, and whatever the adapter did.
 */
function scratch(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rigger-process-')));
  t.after(() => {
    const pattern = directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    spawnSync('/usr/bin/pkill', ['-KILL', '-f', pattern]);
  });
  return directory;
}

/** An `L0` emitter over a sink in `directory`, and the state directory it writes to. */
function l0(directory) {
  const state = join(directory, 'state');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { state, emitter: sink.emitter({ layer: 'L0' }) };
}

/** Runs `script` under `/bin/sh` through the adapter, with an `L0` emitter over `directory`. */
function shell(directory, script, options = {}) {
  return runCommand({
    command: '/bin/sh',
    args: ['-c', script, directory],
    cwd: directory,
    env: {},
    emitter: l0(directory).emitter,
    ...options,
  });
}

test('a command that exits 0 has exit code 0 in the result', async (t) => {
  const directory = scratch(t);
  const result = await shell(directory, 'exit 0');
  assert.equal(result.exit, 0);
});

test('a command that exits 3 has exit code 3 in the result', async (t) => {
  const directory = scratch(t);
  const result = await shell(directory, 'exit 3');
  assert.equal(result.exit, 3);
});

// Node's documented default `maxBuffer` for the buffering calls of `node:child_process`, which a
// capture built on one of them would stop at.
const MAX_BUFFER = 1024 * 1024;

/** `length` bytes that step through every byte value, so they hold bytes no UTF-8 text allows. */
const bytes = (length, step) => Buffer.from(Array.from({ length }, (_, i) => (i * step) % 256));

/** A Node script, run by this Node, that writes `length` of `bytes(length, step)` to `stream`. */
function writing(directory, stream, length, step) {
  return runCommand({
    command: process.execPath,
    args: ['-e', `process.${stream}.write(Buffer.from(Array.from({ length: ${length} }, (_, i) => (i * ${step}) % 256)))`, directory],
    cwd: directory,
    env: {},
    emitter: l0(directory).emitter,
  });
}

test('the result carries, as bytes, every byte a command wrote to standard output, past maxBuffer and not UTF-8', async (t) => {
  const directory = scratch(t);
  const written = bytes(MAX_BUFFER + 4099, 7);
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(written), 'the payload is not valid UTF-8');

  const result = await writing(directory, 'stdout', written.length, 7);

  assert.ok(Buffer.isBuffer(result.stdout), 'standard output is carried as bytes');
  assert.equal(result.stdout.length, written.length);
  assert.ok(result.stdout.equals(written), 'standard output holds every byte written, unchanged');
  assert.equal(result.stderr.length, 0, 'nothing written to standard output reaches standard error');
});

test('the result carries, as bytes and apart from standard output, every byte a command wrote to standard error', async (t) => {
  const directory = scratch(t);
  const written = bytes(MAX_BUFFER + 5003, 13);

  const result = await writing(directory, 'stderr', written.length, 13);

  assert.ok(Buffer.isBuffer(result.stderr), 'standard error is carried as bytes');
  assert.ok(result.stderr.equals(written), 'standard error holds every byte written, unchanged');
  assert.equal(result.stdout.length, 0, 'nothing written to standard error reaches standard output');
});
