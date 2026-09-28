// ABOUTME: Tests L0's process adapter: a command's exit code, output, working directory and
// environment, the process group it runs in, and the survivors it kills and records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

/**
 * A shell script named `name` in `directory`, executable, whose body reads that directory as
 * `$here`. Its path, and so the directory, is in the command line of the shell running it.
 */
function fixture(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\nhere=\${0%/*}\n${body}\n`, { mode: 0o755 });
  return path;
}

/**
 * Runs `script` under `/bin/sh` through the adapter, with an `L0` emitter over `directory`. The
 * script reads the directory as `$0`, which also puts it in the command line the teardown finds.
 */
function shell(directory, script, options = {}) {
  return adapt(directory, { command: '/bin/sh', args: ['-c', script, directory], ...options });
}

/** Runs a command through the adapter in `directory`, under an empty env and an `L0` emitter over it. */
function adapt(directory, options) {
  return runCommand({ args: [], cwd: directory, env: {}, emitter: l0(directory).emitter, ...options });
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
  return adapt(directory, {
    command: process.execPath,
    args: ['-e', `process.${stream}.write(Buffer.from(Array.from({ length: ${length} }, (_, i) => (i * ${step}) % 256)))`, directory],
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

test('a command that prints its working directory prints the cwd the adapter was given', async (t) => {
  const directory = scratch(t);
  const given = join(directory, 'elsewhere');
  mkdirSync(given);

  const result = await shell(directory, '/bin/pwd', { cwd: given });

  assert.equal(result.stdout.toString(), `${given}\n`);
});

test('a variable in the caller\'s own environment and absent from the env given is absent from the command\'s', async (t) => {
  const directory = scratch(t);
  process.env.RIGGER_CALLER_ONLY = 'the caller holds this';
  t.after(() => delete process.env.RIGGER_CALLER_ONLY);

  const result = await shell(directory, '/usr/bin/env', { env: { RIGGER_GIVEN: 'given' } });

  const names = result.stdout.toString().split('\n').map((line) => line.split('=')[0]);
  assert.ok(names.includes('RIGGER_GIVEN'), 'the command ran under the env given');
  assert.ok(!names.includes('RIGGER_CALLER_ONLY'), 'the caller\'s own variable reached the command');
});

test('a variable the env given sets has exactly the value given in the command\'s environment', async (t) => {
  const directory = scratch(t);
  const value = ' two  spaces, a = sign,\na newline and ü ';

  const result = await shell(directory, 'printf %s "$RIGGER_GIVEN"', { env: { RIGGER_GIVEN: value } });

  assert.equal(result.stdout.toString(), value);
});

/** The process group id `ps` reads for `pid`. */
const groupOf = (pid) => spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();

/**
 * A line of a fixture that writes, as `ps` reads it, the process group of the shell running it to
 * `$here/<file>`, renamed into place so a reader never sees half of it.
 */
const reportGroup = (file) => `/bin/ps -o pgid= -p $$ > "$here/${file}.tmp" && /bin/mv "$here/${file}.tmp" "$here/${file}"`;

/** What a fixture wrote to `name` in `directory`, trimmed. */
const read = (directory, name) => readFileSync(join(directory, name), 'utf8').trim();

test('every process a command starts that stays in its group reports one process group id, not the caller\'s', async (t) => {
  const directory = scratch(t);
  fixture(directory, 'grandchild', reportGroup('grandchild'));
  fixture(directory, 'child', `${reportGroup('child')}\n"$here/grandchild"`);
  const command = fixture(directory, 'command', `${reportGroup('command')}\n"$here/child"`);

  const result = await adapt(directory, { command });

  assert.equal(result.stderr.toString(), '');
  assert.match(read(directory, 'command'), /^\d+$/);
  assert.equal(read(directory, 'child'), read(directory, 'command'), 'the command\'s child reports the command\'s group');
  assert.equal(read(directory, 'grandchild'), read(directory, 'command'), 'the command\'s grandchild reports the command\'s group');
  assert.notEqual(read(directory, 'command'), groupOf(process.pid), 'the command runs in the caller\'s own group');
});

test('two commands running at once through the adapter report different process group ids', async (t) => {
  const directory = scratch(t);
  // Each writes its own group, then waits until the other has written, so both are alive at once.
  const meet = fixture(directory, 'meet', `${reportGroup('$1')}\nwhile [ ! -f "$here/$2" ]; do :; done`);

  await Promise.all([adapt(directory, { command: meet, args: ['one', 'two'] }), adapt(directory, { command: meet, args: ['two', 'one'] })]);

  assert.match(read(directory, 'one'), /^\d+$/);
  assert.match(read(directory, 'two'), /^\d+$/);
  assert.notEqual(read(directory, 'one'), read(directory, 'two'));
});
