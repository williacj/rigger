// ABOUTME: Drives never-started reports from L0 and L1 to L2 with controlled host failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { rmSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

import { dispatch } from '../src/execution/run.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import { answer } from './judge-start-fixture.mjs';
import { refuseSpawn } from './judge-start-fixture.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 10_000: SETTLES_WITHIN } = BOUNDS;

/** Carries a controlled builtin failure into named ESM imports, restoring it at the test's end. */
function builtin(t, target, name, replacement) {
  t.mock.method(target, name, replacement);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

/** Checks the report and L2's independent row oracle, including a matching second dispatch. */
function classed(outcome, cause, row) {
  assert.equal(outcome.reason?.code, NOT_STARTED);
  assert.deepEqual(outcome.reason.startCause, cause);
  assert.equal(answer({ reviewer: outcome }).next.failure.row, row);
  const second = answer({ reviewer: outcome }, { firstFailures: { reviewer: outcome } }).next;
  assert.equal(second.action, 'hold');
  assert.doesNotMatch(JSON.stringify({ ...outcome.reason, message: outcome.reason.message }), /R-FAIL-8|\bR\d+\b/);
}

/** Runs an errno through L0's failed spawn and L1's report, under Node's independent contract. */
async function spawnClass(t, errno, cause, row) {
  const { request } = layout();
  refusingSpawn(t, errno);
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, cause, row);
}

/** Node's failed spawn contract: no pid, followed by an error event carrying the host errno. */
function refusingSpawn(t, code, before = () => {}, synchronous = false) {
  refuseSpawn(t, { code, before, synchronous });
}

/** A dispatch's directory and scratch directory, and a sink that retains every event. */
function layout({ judge = 'judge', scratchName = 'scratch' } = {}) {
  const root = temporaryDirectory('rigger-judge-start-');
  const cwd = join(root, judge, 'main');
  const scratch = join(root, scratchName);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(scratch);
  const events = [];
  const sink = { emitter: (context) => ({ emit: (event, fields) => events.push({ ...context, event, ...fields }) }) };
  return { events, request: { id: 'd-judge', card: 7, provider: 'claude', command: 'claude', args: [], cwd, workspace: join(root, judge), scratch, directory: join(root, '.rigger'), sink, env: {}, timeout: 10_000 } };
}

// The counterexample loses the host errno or confuses a missing CLI with a missing working directory.
// proves R-FAIL-8
test('a missing CLI with an existing working directory is tagged in L0, carried by L1 with the provider, and classed R2', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  refusingSpawn(t, 'ENOENT');
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  assert.equal(outcome.reason?.code, NOT_STARTED);
  assert.deepEqual(outcome.reason.startCause, { kind: 'command-missing', provider: 'claude' });
  assert.equal(answer({ reviewer: outcome }).next.failure.row, 'R2');
  assert.doesNotMatch(JSON.stringify({ ...outcome.reason, message: outcome.reason.message }), /R-FAIL-8|\bR\d+\b/);
});

// The counterexample calls every ENOENT a missing CLI, including the check-to-spawn directory race.
// proves R-FAIL-8
test('ENOENT after the working directory was removed is tagged in L0 as an unusable directory and classed R29', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  refusingSpawn(t, 'ENOENT', () => rmSync(request.cwd, { recursive: true }));
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  assert.equal(outcome.reason?.code, NOT_STARTED);
  assert.deepEqual(outcome.reason.startCause, { kind: 'directory-unusable' });
  assert.equal(answer({ reviewer: outcome }).next.failure.row, 'R29');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('EACCES from the spawn is tagged at L0, reported by L1, classed R3, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'EACCES', { kind: 'command-not-executable', provider: 'claude' }, 'R3');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('E2BIG from the spawn is tagged at L0, reported by L1, classed R4, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'E2BIG', { kind: 'command-too-long' }, 'R4');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('EAGAIN from the spawn is tagged at L0, reported by L1, classed R28, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'EAGAIN', { kind: 'process-resources' }, 'R28');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('ENOMEM from the spawn is tagged at L0, reported by L1, classed R28, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'ENOMEM', { kind: 'process-resources' }, 'R28');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('EMFILE from the spawn is tagged at L0, reported by L1, classed R36, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'EMFILE', { kind: 'file-descriptors' }, 'R36');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('ENFILE from the spawn is tagged at L0, reported by L1, classed R36, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'ENFILE', { kind: 'file-descriptors' }, 'R36');
});

// The counterexample drops the host cause before workflow can count the judge's pair.
// proves R-FAIL-8
test('EUNRECOGNIZED from the spawn is tagged at L0, reported by L1, classed R37, and holds a matching second dispatch', SETTLES_WITHIN, async (t) => {
  await spawnClass(t, 'EUNRECOGNIZED', { kind: 'host-error' }, 'R37');
});

// The counterexample loses the cause when Node throws before returning a child process.
// proves R-FAIL-8
test('a synchronous spawn rejection for an unpassable character is tagged at L0 and classed R5', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  refusingSpawn(t, 'ERR_INVALID_ARG_VALUE', () => {}, true);
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  assert.deepEqual(outcome.reason?.startCause, { kind: 'command-character' });
  assert.equal(answer({ reviewer: outcome }).next.failure.row, 'R5');
});

// The counterexample carries only a human-readable census refusal, losing the path identity.
// proves R-FAIL-8
test('a judge directory the census cannot read back is tagged at L0 by its real path and classed R14', SETTLES_WITHIN, async () => {
  const { request } = layout({ judge: 'judge^' });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'directory-illegible', path: request.workspace }, 'R14');
});

// The counterexample counts two illegible scratch paths as one host way.
// proves R-FAIL-8
test('a scratch directory the census cannot read back is tagged at L0 by its real path and classed R15', SETTLES_WITHIN, async () => {
  const { request } = layout({ scratchName: 'scratch^' });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'scratch-illegible', path: request.scratch }, 'R15');
});

// The counterexample wraps only the first read and lets a changed record's second read escape unclassified.
// proves R-FAIL-8
test('a groups record changed and unreadable on the second dispatch read is reported by L1 as never started and classed R32', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    if (path === join(request.directory, 'groups.json') && ++reads === 2) throw Object.assign(new Error('EIO reading changed groups'), { code: 'EIO' });
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  assert.equal(reads, 2, 'the initial read succeeded and the changed record was read again');
  assert.equal(outcome.reason?.code, NOT_STARTED);
  assert.deepEqual(outcome.reason.startCause, { kind: 'groups-unreadable' });
  assert.equal(answer({ reviewer: outcome }).next.failure.row, 'R32');
});

// The counterexample books a record read refusal as a write refusal, because it reads inside writeGroups' arguments.
// proves R-FAIL-8
test('an unreadable initial groups record is tagged at L1 as a read failure and classed R32', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  const original = fs.readFileSync;
  builtin(t, fs, 'readFileSync', (path, ...args) => {
    if (path === join(request.directory, 'groups.json')) throw Object.assign(new Error('EACCES reading groups'), { code: 'EACCES' });
    return original(path, ...args);
  });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  assert.deepEqual(outcome.reason?.startCause, { kind: 'groups-unreadable' });
  assert.equal(answer({ reviewer: outcome }).next.failure.row, 'R32');
});

// The counterexample lets an untagged validation refusal escape the host classification.
// proves R-FAIL-8
test('L1 reports no dispatch id as never started with its source cause and L2 classes R22', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  request.id = undefined;
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'dispatch-identity' }, 'R22');
});

// The counterexample lets an untagged validation refusal escape the host classification.
// proves R-FAIL-8
test('L1 reports a card the groups record cannot hold as never started with its source cause and L2 classes R22', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  request.card = '7';
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'dispatch-identity' }, 'R22');
});

// The counterexample lets an untagged validation refusal escape the host classification.
// proves R-FAIL-8
test('L1 reports a nonpositive timeout as never started with its source cause and L2 classes R23', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  request.timeout = 0;
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'dispatch-timeout' }, 'R23');
});

// The counterexample lets an untagged validation refusal escape the host classification.
// proves R-FAIL-8
test('L1 reports no event emitter as never started with its source cause and L2 classes R24', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  request.sink = { emitter: ({ layer }) => layer === 'L0' ? {} : { emit() {} } };
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'event-emitter-missing' }, 'R24');
});

// The counterexample lets an untagged validation refusal escape the host classification.
// proves R-FAIL-8
test('L1 reports a groups record whose directory cannot be made as never started with its source cause and L2 classes R25', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  const original = fs.mkdirSync;
  builtin(t, fs, 'mkdirSync', (path, ...args) => {
    if (path === request.directory) throw Object.assign(new Error('ENOSPC making groups directory'), { code: 'ENOSPC' });
    return original(path, ...args);
  });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'groups-unwritable' }, 'R25');
});

// The counterexample merges a replaced working directory with a missing one.
// proves R-FAIL-8
test('a working directory outside the judge directory is tagged at L1 and classed R30', SETTLES_WITHIN, async () => {
  const { request } = layout();
  request.cwd = request.scratch;
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'working-directory-outside' }, 'R30');
});

// The counterexample gives another dispatch's occupied directory no machine-readable cause.
// proves R-FAIL-8
test('another dispatch holding the judge directory is tagged at L1 and classed R31', SETTLES_WITHIN, async () => {
  const { request } = layout();
  mkdirSync(request.directory);
  fs.writeFileSync(join(request.directory, 'groups.json'), JSON.stringify([{ group: 42001, started: 0, dispatch: 'd-other', workspace: request.workspace }]));
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'directory-occupied' }, 'R31');
});

// The counterexample leaves this directory source without a classified report.
// proves R-FAIL-8
test('source cause R29 l1-scratch names an unusable directory before any spawn', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  rmSync(request.scratch, { recursive: true });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample leaves this directory source without a classified report.
// proves R-FAIL-8
test('source cause R29 l1-identity names an unusable directory before any spawn', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  const original = fs.statSync; builtin(t, fs, 'statSync', (path, ...args) => { if (path === request.workspace) throw Object.assign(new Error('EIO reading directory identity'), { code: 'EIO' }); return original(path, ...args); });
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample leaves this directory source without a classified report.
// proves R-FAIL-8
test('source cause R29 l0-cwd names an unusable directory before any spawn', SETTLES_WITHIN, async (t) => {
  const { request } = layout();
  request.workspace = undefined; request.cwd = join(request.cwd, 'missing');
  const [outcome] = await Promise.allSettled([dispatch(request)]);
  classed(outcome, { kind: 'directory-unusable' }, 'R29');
});

// Both reads must reject the whole record for every invalid shape; a later read is not a write failure.
// proves R-FAIL-8
test('source inventory covers each invalid groups record at both dispatch reads', SETTLES_WITHIN, async (t) => {
  for (const read of [1, 2]) for (const [shape, value] of [['JSON', '{'], ['list', '{}'], ['entry', '[{"group":1}]']]) await t.test(`${read} / ${shape}`, async (t) => {
    const { request } = layout();
    let reads = 0;
    const original = fs.readFileSync;
    builtin(t, fs, 'readFileSync', (path, ...args) => path === join(request.directory, 'groups.json') && ++reads === read ? value : original(path, ...args));
    const [outcome] = await Promise.allSettled([dispatch(request)]);
    classed(outcome, { kind: 'groups-unreadable' }, 'R32');
    assert.equal(reads, read);
  });
});

// The partial-file write and the atomic rename can fail independently of making their directory.
// proves R-FAIL-8
test('source inventory covers each groups record write stage', SETTLES_WITHIN, async (t) => {
  for (const stage of ['writeFileSync', 'renameSync']) await t.test(stage, async (t) => {
    const { request } = layout();
    const original = fs[stage];
    builtin(t, fs, stage, (path, ...args) => {
      if (path === join(request.directory, 'groups.json.partial')) throw Object.assign(new Error(`EIO ${stage}`), { code: 'EIO' });
      return original(path, ...args);
    });
    const [outcome] = await Promise.allSettled([dispatch(request)]);
    classed(outcome, { kind: 'groups-unwritable' }, 'R25');
  });
});

// L0 must tag both unresolved census paths, separately from an unusable working directory.
// proves R-FAIL-8
test('source inventory covers unresolved L0 census directory and scratch paths', SETTLES_WITHIN, async (t) => {
  for (const field of ['directory', 'scratch']) await t.test(field, async () => {
    const { request } = layout();
    const [outcome] = await Promise.allSettled([runCommand({ ...request, directory: request.workspace, [field]: join(request.cwd, 'absent'), emitter: { emit() {} } })]);
    assert.equal(outcome.reason?.code, NOT_STARTED);
    assert.deepEqual(outcome.reason.startCause, { kind: 'directory-unusable' });
    const carried = { status: 'rejected', reason: outcome.reason };
    assert.equal(answer({ reviewer: carried }).next.failure.row, 'R29');
  });
});

// Each side of L1's containment check can disappear before the directory identity is read.
// proves R-FAIL-8
test('source inventory covers unreadable main and judge directory at the L1 containment check', SETTLES_WITHIN, async (t) => {
  for (const field of ['cwd', 'workspace']) await t.test(field, async () => {
    const { request } = layout();
    rmSync(request[field], { recursive: true });
    const [outcome] = await Promise.allSettled([dispatch(request)]);
    classed(outcome, { kind: 'directory-unusable' }, 'R29');
  });
});
