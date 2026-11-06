// ABOUTME: Exercises package-commit recording through its actual entry point with in-process Git, npm and filesystem answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const MANIFEST = '{"name":"record-contract-fixture","version":"1.0.0","files":["src/"]}\n';
// npm12's observed one-package map envelope; only fields used by this record path are projected.
// The package's prepack script is outside files[], so its repair does not alter the packed inventory.
const KEYED_LISTING = '{"record-contract-fixture":{"filename":"record-contract-fixture-1.0.0.tgz","size":1700,"files":[{"path":"package.json"},{"path":"src/module.mjs"},{"path":"src/substrate/git-environment.mjs"}]}}\n';
const HELD = 'package.json\0scripts/record-commit.mjs\0src/module.mjs\0src/substrate/git-environment.mjs\0';
const EXPECTED_RECORD = '{"commit":"0123456789abcdef0123456789abcdef01234567"}\n';
let evaluation = 0;

/** Run untransformed record entry bytes; none of these tool/filesystem answers starts a child or writes a real file. */
async function recordAnswer(listing) {
  const entry = new URL('../scripts/record-commit.mjs', import.meta.url);
  entry.searchParams.set('record-contract', String(++evaluation));
  const root = dirname(dirname(fileURLToPath(entry)));
  const record = join(root, 'src/package-commit.json');
  const temporary = `${record}.${process.pid}`;
  const key = `__riggerRecordContract${evaluation}`;
  const calls = [];
  const writes = [];
  const renames = [];
  const removals = [];
  const files = new Map();
  const unexpected = [];
  const output = { stdout: '', stderr: '' };
  const replies = [
    ['git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], `${HEAD}\n`],
    ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], listing],
    ['git', ['ls-tree', '-r', '-z', '--name-only', HEAD], HELD],
    ['git', ['diff', '--quiet', HEAD, '--', 'package.json', 'src/module.mjs', 'src/substrate/git-environment.mjs'], ''],
  ];
  const failedPremise = (reason) => { unexpected.push(reason); throw new Error(reason); };
  const collaborators = {
    execFileSync(command, args, options) {
      const expected = replies[calls.length];
      if (!expected || command !== expected[0] || JSON.stringify(args) !== JSON.stringify(expected[1])) return failedPremise('unprovided tool request');
      if (options.cwd !== root || options.encoding !== 'utf8' || JSON.stringify(options.stdio) !== '["ignore","pipe","pipe"]') return failedPremise('tool options differ from the documented text-answer boundary');
      calls.push([command, args]);
      return expected[2];
    },
    readFileSync(path, encoding) {
      if (path !== join(root, 'package.json') || encoding !== 'utf8') return failedPremise('unprovided filesystem read');
      return MANIFEST;
    },
    writeFileSync(path, text) { writes.push([path, text]); files.set(path, text); },
    renameSync(from, to) {
      if (!files.has(from)) return failedPremise('rename source was not written');
      renames.push([from, to]); files.set(to, files.get(from)); files.delete(from);
    },
    rmSync(path, options) { removals.push([path, options]); files.delete(path); },
  };
  const mockModules = new Map([
    ['node:child_process', `export const { execFileSync } = globalThis[${JSON.stringify(key)}];`],
    ['node:fs', `export const { readFileSync, writeFileSync, renameSync, rmSync } = globalThis[${JSON.stringify(key)}];`],
  ]);
  const stdout = process.stdout;
  const stderr = process.stderr;
  const saved = {
    global: Object.getOwnPropertyDescriptor(globalThis, key),
    stdout: Object.getOwnPropertyDescriptor(stdout, 'write'),
    stderr: Object.getOwnPropertyDescriptor(stderr, 'write'),
  };
  let hook;
  let error;
  let actualSourceLoaded = false;
  try {
    globalThis[key] = collaborators;
    Object.defineProperty(stdout, 'write', { configurable: true, writable: true, value: (text) => { output.stdout += text; return true; } });
    Object.defineProperty(stderr, 'write', { configurable: true, writable: true, value: (text) => { output.stderr += text; return true; } });
    hook = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === entry.href && mockModules.has(specifier)) return {
          url: `data:text/javascript,${encodeURIComponent(mockModules.get(specifier))}#${evaluation}`, shortCircuit: true,
        };
        return next(specifier, context);
      },
      load(url, context, next) {
        const loaded = next(url, context);
        if (url === entry.href) {
          assert.deepEqual(Buffer.from(loaded.source), readFileSync(entry), 'fixture premise: entry bytes changed while loading');
          actualSourceLoaded = true;
        }
        return loaded;
      },
    });
    try { await import(entry.href); } catch (caught) { error = caught; }
  } finally {
    hook?.deregister();
    if (saved.global) Object.defineProperty(globalThis, key, saved.global); else delete globalThis[key];
    if (saved.stdout) Object.defineProperty(stdout, 'write', saved.stdout); else delete stdout.write;
    if (saved.stderr) Object.defineProperty(stderr, 'write', saved.stderr); else delete stderr.write;
  }
  return { actualSourceLoaded, calls, error, files, output, record, temporary, unexpected, writes, renames, removals };
}

// Packaging-infrastructure diagnostic admitted by #1223; native npm/Git/installed proof remains separate.
test('a keyed npm pack result publishes the literal clean-HEAD record without output', async () => {
  const answer = await recordAnswer(KEYED_LISTING);
  assert.equal(answer.actualSourceLoaded, true, 'fixture premise: the actual entry was not loaded');
  assert.deepEqual(answer.unexpected, [], 'fixture premise: an unprovided collaborator was requested');
  assert.deepEqual(answer.calls.slice(0, 2), [
    ['git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']],
    ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error']],
  ], 'fixture premise: successful HEAD and npm text replies were not consumed');
  const context = answer.error ? `${answer.error.name}: ${answer.error.message}` : 'entry completed';
  assert.equal(answer.files.get(answer.record), EXPECTED_RECORD, `one keyed npm package must publish the literal clean-HEAD record; ${context}`);
  assert.equal(answer.error, undefined, 'the record entry rejected a valid single-package answer');
  assert.deepEqual(answer.output, { stdout: '', stderr: '' });
  assert.deepEqual(answer.writes, [[answer.temporary, EXPECTED_RECORD]]);
  assert.deepEqual(answer.renames, [[answer.temporary, answer.record]]);
  assert.deepEqual(answer.removals, []);
  assert.equal(answer.calls.length, 4, 'the completed path did not consume the coherent clean Git answers');
});
test('the npm package result selector refuses zero or multiple package records', async () => {
  const { packResult } = await import('../scripts/lib/pack-result.mjs');
  assert.equal(typeof packResult, 'function', 'fixture premise: the actual package selector export was not loaded');
  for (const [shape, stdout] of [
    ['empty array', '[]'],
    ['multiple array', '[{"filename":"first.tgz","files":[{"path":"package.json"}]},{"filename":"second.tgz","files":[{"path":"package.json"}]}]'],
    ['empty map', '{}'],
    ['multiple map', '{"first":{"filename":"first.tgz","files":[{"path":"package.json"}]},"second":{"filename":"second.tgz","files":[{"path":"package.json"}]}}'],
  ]) {
    assert.throws(() => packResult(stdout), Error, `${shape} must be refused rather than selected`);
  }
});

// The array envelope measured with npm11; expected metadata below is authored separately.
const ARRAY_LISTING = '[{"filename":"record-contract-fixture-1.0.0.tgz","size":1700,"files":[{"path":"package.json"},{"path":"src/module.mjs"},{"path":"src/substrate/git-environment.mjs"}]}]\n';

test('an array npm pack result publishes the literal clean-HEAD record without output', async () => {
  const answer = await recordAnswer(ARRAY_LISTING);
  assert.equal(answer.actualSourceLoaded, true, 'fixture premise: the actual entry was not loaded');
  assert.deepEqual(answer.unexpected, [], 'fixture premise: an unprovided collaborator was requested');
  assert.deepEqual(answer.calls.slice(0, 2), [
    ['git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']],
    ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error']],
  ], 'fixture premise: successful HEAD and npm text replies were not consumed');
  assert.equal(answer.files.get(answer.record), EXPECTED_RECORD, 'one array npm package must publish the literal clean-HEAD record');
  assert.equal(answer.error, undefined, 'the record entry rejected a valid single-package answer');
  assert.deepEqual(answer.output, { stdout: '', stderr: '' });
  assert.deepEqual(answer.writes, [[answer.temporary, EXPECTED_RECORD]]);
  assert.deepEqual(answer.renames, [[answer.temporary, answer.record]]);
  assert.deepEqual(answer.removals, []);
  assert.equal(answer.calls.length, 4, 'the completed path did not consume the coherent clean Git answers');
});

test('both npm pack envelopes preserve the literal package metadata', async () => {
  const { packResult } = await import('../scripts/lib/pack-result.mjs');
  const expected = {
    filename: 'record-contract-fixture-1.0.0.tgz',
    size: 1700,
    files: [
      { path: 'package.json' },
      { path: 'src/module.mjs' },
      { path: 'src/substrate/git-environment.mjs' },
    ],
  };
  for (const stdout of [ARRAY_LISTING, KEYED_LISTING]) {
    assert.deepEqual(packResult(stdout), expected);
  }
});
