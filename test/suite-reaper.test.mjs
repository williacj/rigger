// ABOUTME: Exercises the suite's cleanup after its shell dies while a test fixture still runs.

import { LSOF } from '../src/substrate/process.mjs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname, isAbsolute, relative, sep } from 'node:path';

import { scratch, sweep } from './process-fixtures.mjs';
import { ended } from './process-fixtures.mjs';
import { constants } from 'node:fs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { safeTargetReadRecord, targetReadRecord, traceEvidence } from './suite-reaper-probe.mjs';

const suite = resolve('test/suite.sh');
const fixtureModule = new URL('./process-fixtures.mjs', import.meta.url).href;
const agentModule = new URL('./stub-claude.mjs', import.meta.url).href;
const processModule = new URL('../src/substrate/process.mjs', import.meta.url).href;

let activeTrace;
function tracePath() {
  const temporary = process.env.TMPDIR;
  const supplied = process.env.C667_TRACE_FILE;
  if (!temporary || !supplied) throw new Error('trace requires TMPDIR and C667_TRACE_FILE');
  const root = realpathSync(temporary);
  const destination = resolve(supplied);
  const parent = realpathSync(dirname(destination));
  const distance = relative(root, parent);
  if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
    throw new Error('trace path must stay under TMPDIR');
  }
  for (let directory = parent; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) throw new Error('trace TMPDIR must not be inside a checkout');
    if (directory === dirname(directory)) break;
  }
  try {
    if (lstatSync(destination).isSymbolicLink()) throw new Error('trace path must stay under TMPDIR');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return destination;
}
function trace(event) {
  if (activeTrace) writeFileSync(tracePath(), `${JSON.stringify({ at: new Date().toISOString(), ...activeTrace, ...event })}\n`, { flag: 'a' });
}

function reaperState(run) {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,stat=,command='], { encoding: 'utf8' });
  const row = ps.stdout.split('\n').find((line) => line.includes('test/suite-reaper') && line.includes(run));
  return row?.trim() ?? null;
}

function matchingCwdRows(output, directory) {
  let pid;
  const rows = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && (line.slice(1) === directory || line.slice(1).startsWith(`${directory}/`))) rows.push(`${pid} cwd ${line.slice(1)}`);
  }
  return rows;
}

function processesIn(directory) {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,stat=,command='], { encoding: 'utf8' });
  assert.equal(ps.status, 0, ps.stderr);
  const found = new Map();
  for (const line of ps.stdout.split('\n')) {
    const row = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (row && !row[2].startsWith('Z') && row[3].includes(directory)) found.set(Number(row[1]), `${row[1]} ${row[2]} ${row[3]}`);
  }
  const lsof = spawnSync(LSOF, ['-nP', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], { env: process.env, encoding: 'utf8' });
  assert.ok(lsof.status === 0 || lsof.status === 1, lsof.stderr);
  let pid;
  for (const line of lsof.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && (line.slice(1) === directory || line.slice(1).startsWith(`${directory}/`)) && pid && !found.has(pid)) {
      found.set(pid, `${pid} cwd ${line.slice(1)}`);
    }
  }
  if (activeTrace) {
    const matchingCwds = matchingCwdRows(lsof.stdout, directory);
    trace({ event: 'process-check', directoryPresent: existsSync(activeTrace.run), ps: { status: ps.status, error: ps.error?.message ?? null, rows: ps.stdout.split('\n').filter((line) => line.includes(directory)) }, lsof: { status: lsof.status, error: lsof.error?.message ?? null, matchingCwds, otherCwdCount: lsof.stdout.split('\n').filter((line) => line.startsWith('n')).length - matchingCwds.length }, reported: [...found.values()], reaper: reaperState(activeTrace.run) });
  }
  return [...found.values()];
}

async function until(condition, within, t) {
  const deadline = Date.now() + within;
  while (!condition() && Date.now() < deadline) {
    if (t.signal.aborted) throw new Error('the test ended before its condition held');
    await new Promise((resolve) => setImmediate(resolve));
  }
  return condition();
}

async function checkEnding(t, tmp, runName, output, { processes = processesIn, exists = existsSync, now = Date.now, turn = () => new Promise((resolve) => setImmediate(resolve)) } = {}) {
  const run = join(tmp, runName);
  const deadline = now() + 10_000;
  let left;
  let removed;
  for (;;) {
    left = processes(tmp);
    removed = !exists(run);
    if (removed && activeTrace && !activeTrace.firstRemoval) {
      activeTrace.firstRemoval = new Date().toISOString();
      trace({ event: 'directory-removed', reaper: reaperState(run) });
    }
    if ((left.length === 0 && removed) || now() >= deadline) break;
    if (t.signal.aborted) throw new Error('the test ended before its condition held');
    await turn();
  }
  try {
    assert.deepEqual(left, [], `processes from ${tmp} survived: ${left.join('\n')}\n${readFileSync(output, 'utf8')}`);
    assert.equal(removed, true, `the suite left ${run}: ${readFileSync(output, 'utf8')}`);
    trace({ event: 'assertion', result: 'pass', removed, reported: left });
  } catch (error) {
    trace({ event: 'assertion', result: 'fail', removed, reported: left, message: error.message.split('\n')[0] });
    throw error;
  }
}

// Start time and command are the host's identity, not just a PID copied from a file.
function readinessProcess(pid, within = 10_000, run = spawnSync, cwdBudget) {
  if (!(within > 0) || !Number.isFinite(within)) return { live: false };
  const result = run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'stat=', '-o', 'lstart=', '-o', 'pgid=', '-o', 'command='], { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' }, encoding: 'utf8', timeout: Math.ceil(within), killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) return { live: false };
  const row = /^\s*(\S+)\s+(.{24})\s+(\d+)\s+(.*)$/.exec(result.stdout.trimEnd());
  if (!row) return { live: false };
  const observed = { live: !row[1].startsWith('Z'), signature: row.slice(2).join(' '), group: Number(row[3]), command: row[4] };
  if (cwdBudget) {
    const remaining = cwdBudget.deadline - cwdBudget.now();
    if (!(remaining > 0)) return observed;
    const cwd = run(LSOF, ['-w', '-n', '-P', '-a', '-p', String(pid), '-d', 'cwd', '-F', 'pn'], {
      env: process.env, encoding: 'utf8', timeout: Math.ceil(remaining), killSignal: 'SIGKILL',
    });
    if (!cwd.error && cwd.status === 0) observed.cwd = cwd.stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1);
  }
  return observed;
}

async function waitForReadiness(t, {
  invocation, kind, directory, read, observe = readinessProcess, failure = () => undefined,
  now = performance.now.bind(performance), turn = () => new Promise((resolve) => setImmediate(resolve)),
  deadline = now() + 10_000,
}) {
  let stage = 'missing record';
  for (;;) {
    if (t.signal.aborted) throw new Error('setup cancelled before readiness', { cause: t.signal.reason });
    const failed = failure();
    if (failed) throw new Error(`setup failed before readiness: ${failed}`);
    if (now() >= deadline) throw new Error(`setup never became ready by 10000ms: ${stage}`);
    const bytes = read();
    if (now() >= deadline) throw new Error('setup never became ready by 10000ms: publication read exceeded deadline');
    let record;
    try { record = JSON.parse(bytes); } catch { /* An incomplete publication is not readiness. */ }
    if (record && Number.isSafeInteger(record.pid) && record.pid > 0) {
      if (record.invocation !== invocation) throw new Error('setup rejected stale invocation identity');
      if (record.kind !== kind) throw new Error('setup rejected wrong fixture identity');
      const pids = kind === 'F4' ? [record.leader, record.pid] : [record.pid];
      if (pids.every((pid) => Number.isSafeInteger(pid) && pid > 0) && Array.isArray(record.processes)
          && pids.every((pid) => record.processes.some((entry) => entry.pid === pid && typeof entry.signature === 'string'))) {
        for (const pid of pids) {
          const actual = observe(pid, deadline - now(), undefined, kind === 'F5' ? { deadline, now } : undefined);
          if (now() >= deadline) throw new Error('setup never became ready by 10000ms: process observation exceeded deadline');
          if (t.signal.aborted) throw new Error('setup cancelled before readiness', { cause: t.signal.reason });
          const recorded = record.processes.find((entry) => entry.pid === pid);
          if (!actual.live) throw new Error(`setup recorded pid ${pid} is not live`);
          if (actual.signature !== recorded.signature || !actual.command?.includes(directory)) throw new Error(`setup rejected reused or foreign pid ${pid}`);
          if ((kind === 'F3' || kind === 'F5') && actual.group !== record.pid) throw new Error('setup tail does not lead its own group');
          if (kind === 'F5' && actual.cwd === undefined) throw new Error('setup could not observe tail working directory');
          if (kind === 'F5' && actual.cwd !== record.working) throw new Error('setup tail is outside its intended working directory');
          if (kind === 'F7' && (record.group !== record.pid || actual.group !== record.group)) throw new Error('setup rejected group identity');
        }
        return record;
      }
      stage = 'incomplete process identity';
    } else stage = bytes == null ? 'missing record' : 'incomplete or malformed PID';
    await turn();
  }
}

async function runEnding(t, ending, kind, { holdPidPublication = false, gateSetup = false, signal = t.signal, onPhase = () => {} } = {}) {
  const context = { get signal() { return signal.aborted ? signal : t.signal; } };
  const directory = scratch(t);
  const invocation = randomUUID();
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const file = join(directory, 'holding.test.mjs');
  writeFileSync(file, [
    "import { test } from 'node:test';",
    "import { spawn, spawnSync } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `import { scratch, fixture, leave, leaveWorking, read, startGroup, tailIn, TAIL } from ${JSON.stringify(fixtureModule)};`,
    kind === 'F6' ? `import { installStandInAgent } from ${JSON.stringify(agentModule)};` : '',
    `import { LSOF${kind === 'F7' ? ', runCommand' : ''} } from ${JSON.stringify(processModule)};`,
    readinessProcess.toString(),
    `test('holds a ${kind} fixture', { timeout: 600_000 }, async (t) => {`,
    '  const setupDeadline = performance.now() + 10_000;',
    ...(gateSetup ? [
      `  writeFileSync(${JSON.stringify(join(directory, 'setup-entered'))}, '');`,
      `  while (!existsSync(${JSON.stringify(join(directory, 'setup-release'))})) { t.signal.throwIfAborted(); await new Promise((resolve) => setImmediate(resolve)); }`,
      '  t.signal.throwIfAborted();',
    ] : []),
    '  const directory = scratch(t);',
    ...(kind === 'F1' ? [
      "  const child = spawn(fixture(directory, 'busy', ': > \"$here/alive\"; while [ ! -f \"$here/release\" ]; do :; done'), [], { stdio: 'ignore' });",
      "  while (!existsSync(directory + '/alive')) await new Promise((resolve) => setImmediate(resolve));",
      '  const fixturePid = child.pid;',
    ] : kind === 'F2' ? [
      "  writeFileSync(directory + '/hold', '');",
      "  const parent = spawn(fixture(directory, 'parent', leave(TAIL, 'tail')), [], { stdio: 'ignore' });",
      "  await once(parent, 'exit');",
      "  const fixturePid = Number(read(directory, 'tail.pid'));",
      "  process.kill(fixturePid, 0);",
    ] : kind === 'F3' ? [
      "  writeFileSync(directory + '/hold', '');",
      "  const parent = spawn(fixture(directory, 'parent', leaveWorking('working', 'tail')), [], { stdio: 'ignore' });",
      "  await once(parent, 'exit');",
      "  const fixturePid = Number(read(directory, 'tail.pid'));",
      "  process.kill(fixturePid, 0);",
    ] : kind === 'F4' ? [
      "  const started = await startGroup(t, directory, 'leader');",
      "  const fixturePid = started.member;",
      "  process.kill(started.leader, 0);",
      "  process.kill(fixturePid, 0);",
    ] : kind === 'F5' ? [
      "  writeFileSync(directory + '/hold', '');",
      "  const fixturePid = await tailIn(t, directory, join(directory, 'working'));",
      "  process.kill(fixturePid, 0);",
    ] : kind === 'F6' ? [
      "  const agent = installStandInAgent(directory, { 1: { engineer: { hold: true } } });",
      "  writeFileSync(join(directory, 'engineer.md'), '# Engineer');",
      "  const child = spawn(join(directory, 'claude'), ['--append-system-prompt-file', join(directory, 'engineer.md')], { cwd: directory, stdio: ['pipe', 'ignore', 'ignore'] });",
      "  child.stdin.end('card #1');",
      "  while (!agent.held(1)) await new Promise((resolve) => setImmediate(resolve));",
      "  const fixturePid = child.pid;",
      "  process.kill(fixturePid, 0);",
    ] : [
      "  const command = fixture(directory, 'dispatch', ': > \"$here/alive\"; while [ ! -f \"$here/release\" ]; do :; done');",
      "  const dispatch = runCommand({ command: '/bin/sh', args: [command], cwd: directory, env: process.env, timeout: 600_000, emitter: { emit() {} }, onGroup: (pid) => writeFileSync(directory + '/group.pid', String(pid)) });",
      "  while (!existsSync(directory + '/alive') || !existsSync(directory + '/group.pid')) await new Promise((resolve) => setImmediate(resolve));",
      "  const fixturePid = Number(read(directory, 'group.pid'));",
      "  process.kill(fixturePid, 0);",
    ]),
    `  const ready = { invocation: ${JSON.stringify(invocation)}, kind: ${JSON.stringify(kind)}, pid: fixturePid, ${kind === 'F4' ? 'leader: started.leader,' : ''} ${kind === 'F7' ? 'group: fixturePid,' : ''} ${kind === 'F5' ? "working: join(directory, 'working')," : ''} processes: ${kind === 'F4' ? '[started.leader, fixturePid]' : '[fixturePid]'}.map((pid) => ({ pid, ...readinessProcess(pid, setupDeadline - performance.now()) })) };`,
    `  writeFileSync(${JSON.stringify(join(directory, 'started'))}, JSON.stringify(ready));`,
    `  while (!existsSync(${JSON.stringify(join(directory, 'ready-accepted'))})) { t.signal.throwIfAborted(); await new Promise((resolve) => setImmediate(resolve)); }`,

    ...(holdPidPublication ? [
      `  writeFileSync(${JSON.stringify(join(directory, 'file-pid'))}, '');`,
      `  while (!existsSync(${JSON.stringify(join(directory, 'publish-pid'))})) await new Promise((resolve) => setImmediate(resolve));`,
    ] : []),
    `  writeFileSync(${JSON.stringify(join(directory, 'file-pid'))}, String(process.pid));`,
    ending === 'E1' ? `  while (!existsSync(${JSON.stringify(join(directory, 'go'))})) await new Promise((resolve) => setImmediate(resolve));\n  ${kind === 'F6' ? 'agent.release(1);' : "writeFileSync(directory + '/release', '');"}\n  ${kind === 'F7' ? 'await dispatch;' : ''}` : ending === 'E2' ? `  const holdDeadline = performance.now() + 1_000;
  await t.test('holds a ready fixture', { timeout: 1_000 }, async (hold) => {
    // The deadline begins before t.test; every fixture observation shares its remaining window.
    const now = performance.now.bind(performance);
    const observeBy = holdDeadline;
    const alive = setInterval(() => { throw new Error('E2 ownership lease callback fired'); }, 2 ** 30);
    const release = () => {
      clearInterval(alive);
      hold.signal.removeEventListener('abort', release);
      t.signal.removeEventListener('abort', release);
    };
    try {
      hold.signal.addEventListener('abort', release, { once: true });
      t.signal.addEventListener('abort', release, { once: true });
      hold.signal.throwIfAborted();
      t.signal.throwIfAborted();
      const pids = ${kind === 'F4' ? '[ready.leader, ready.pid]' : '[ready.pid]'};
      for (const pid of pids) {
        hold.signal.throwIfAborted();
        const remaining = observeBy - now();
        if (!(remaining > 0)) throw new Error('E2 fixture observation exhausted its shared hold budget');
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('E2 fixture has no positive process identity');
        const recorded = ready.processes.find((entry) => entry.pid === pid);
        if (!recorded || typeof recorded.signature !== 'string' || !Number.isSafeInteger(recorded.group) || recorded.group <= 0) throw new Error('E2 fixture has incomplete recorded identity');
        const actual = readinessProcess(pid, remaining, undefined, ${kind === 'F5' ? '{ deadline: observeBy, now }' : 'undefined'});
        hold.signal.throwIfAborted();
        t.signal.throwIfAborted();
        if (now() >= observeBy) throw new Error('E2 fixture observation crossed its shared hold deadline');
        if (!actual.live || actual.signature !== recorded.signature || actual.group !== recorded.group || !actual.command?.includes(directory)) throw new Error('E2 fixture process identity changed before hold');
        ${kind === 'F3' || kind === 'F5' ? "if (actual.group !== ready.pid) throw new Error('E2 fixture tail does not lead its own group');" : ''}
        ${kind === 'F5' ? "if (actual.cwd === undefined || actual.cwd !== ready.working) throw new Error('E2 fixture tail working directory changed before hold');" : ''}
        ${kind === 'F7' ? "if (ready.group !== ready.pid || actual.group !== ready.group) throw new Error('E2 fixture group identity changed before hold');" : ''}
      }
      hold.signal.throwIfAborted();
      t.signal.throwIfAborted();
      if (now() >= observeBy) throw new Error('E2 fixture hold entry exceeded its observation deadline');
      writeFileSync(${JSON.stringify(join(directory, 'holding-entered'))}, '');
      await new Promise(() => {});
    } finally {
      release();
    }
  });` : '  await new Promise(() => {});',
    '});',
  ].join('\n'));
  const output = join(directory, 'suite-output');
  const fd = openSync(output, 'w');
  const { NODE_TEST_CONTEXT, RIGGER_REAPER_TRACE_FILE, RIGGER_REAPER_TRACE_ROOT, RIGGER_REAPER_CELL, ...env } = process.env;
  const traceFile = ending === 'E5' || ending === 'E6' ? join(tmp, 'reaper-reads.jsonl') : undefined;
  const probeCell = ending + '-' + kind;
  let tracePublished = false;
  const publishReadEvidence = () => {
    if (!traceFile || tracePublished) return;
    tracePublished = true;
    let bytes;
    try { bytes = readFileSync(traceFile, 'utf8'); } catch { /* The probe did not retain a trace. */ }
    const evidence = traceEvidence(bytes, probeCell);
    for (const record of evidence.records) console.error('RIGGER_REAPER_READ ' + JSON.stringify(record));
    console.error('RIGGER_REAPER_CASE ' + JSON.stringify({ cell: probeCell, records: evidence.records.length, evidence: evidence.incomplete ? 'incomplete' : 'complete' }));
  };
  const child = spawn('/bin/sh', [suite, '--host', ...(ending === 'E2' ? ['--test-reporter=tap'] : []), file], { cwd: resolve('.'), env: {
    ...env, TMPDIR: tmp,
    ...(traceFile ? { RIGGER_REAPER_TRACE_FILE: traceFile, RIGGER_REAPER_TRACE_ROOT: tmp, RIGGER_REAPER_CELL: probeCell } : {}),
  }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const setupDeadline = performance.now() + 10_000;
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const teardown = async () => {
    await ended(child);
    sweep(directory);
  };
  t.after(teardown);
  let phase = 'setup';
  onPhase(phase);
  try {
    let gateEntered;
    const ready = await waitForReadiness(context, {
      invocation, kind, directory, deadline: setupDeadline,
      read: () => existsSync(join(directory, 'started')) ? readFileSync(join(directory, 'started'), 'utf8') : undefined,
      failure: () => spawnError?.message ?? (child.exitCode !== null || child.signalCode !== null ? `nested suite exited (${child.exitCode ?? child.signalCode}): ${readFileSync(output, 'utf8')}` : undefined),
      turn: async () => {
        if (gateSetup && existsSync(join(directory, 'setup-entered'))) {
          gateEntered ??= performance.now();
          if (performance.now() - gateEntered >= 1_200) writeFileSync(join(directory, 'setup-release'), '');
        }
        await new Promise((resolve) => setImmediate(resolve));
      },
    });
    phase = 'hold';
    if (context.signal.aborted) throw new Error('hold cancelled after readiness', { cause: context.signal.reason });
    writeFileSync(join(directory, 'ready-accepted'), '');
    if (ending === 'E2') {
      while (!existsSync(join(directory, 'holding-entered'))) {
        if (context.signal.aborted) throw new Error('hold cancelled after readiness', { cause: context.signal.reason });
        if (performance.now() >= setupDeadline) throw new Error('setup never became ready by 10000ms: nested holding body did not enter');
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (performance.now() >= setupDeadline) throw new Error('setup never became ready by 10000ms: holding entry exceeded deadline');
    }
    onPhase(phase, { holding: join(directory, 'holding-entered') });
    if (context.signal.aborted) throw new Error('hold cancelled after readiness', { cause: context.signal.reason });

    const [runName] = readdirSync(tmp).filter((name) => name.startsWith('rigger-suite.') || name.startsWith('rigger-refusing-gh.'));
    assert.ok(runName, `the suite made no run directory under ${tmp}`);
    if (process.env.C667_TRACE_FILE && ending === 'E4' && kind === 'F5') {
      activeTrace = { eventCase: 'E4-F5', run: join(tmp, runName), fixturePid: ready.pid, evidenceRoot: process.env.C615_EVIDENCE_ROOT ? 'inherited' : 'auto-created' };
      trace({ event: 'start', reaper: reaperState(activeTrace.run) });
      t.after(() => {
        trace({ event: 'teardown', reaper: reaperState(activeTrace.run) });
        activeTrace = undefined;
      });
    }
    if (ending === 'E1') writeFileSync(join(directory, 'go'), '');
    if (ending === 'E3' || ending === 'E7') {
      const group = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'pgid='], { encoding: 'utf8' });
      assert.equal(group.status, 0, `the suite shell exited before its group could be checked: ${readFileSync(output, 'utf8')}`);
      assert.equal(Number(group.stdout.trim()), child.pid, `the nested suite is not the leader of its own group: ${group.stdout}`);
      process.kill(-child.pid, ending === 'E3' ? 'SIGINT' : 'SIGKILL');
    }
    if (ending === 'E4' || ending === 'E5') process.kill(child.pid, ending === 'E4' ? 'SIGTERM' : 'SIGKILL');
    if (ending === 'E6') {
      if (holdPidPublication) setImmediate(() => {
        if (existsSync(directory)) writeFileSync(join(directory, 'publish-pid'), '');
      });
      const pidFile = join(directory, 'file-pid');
      let filePid = 0;
      assert.equal(await until(() => {
        if (!existsSync(pidFile)) return false;
        filePid = Number(readFileSync(pidFile, 'utf8'));
        return Number.isSafeInteger(filePid) && filePid > 0;
      }, 10_000, context), true, `the test file wrote no positive pid: ${readFileSync(output, 'utf8')}`);
      assert.notEqual(filePid, process.pid, 'the nested test file named the test hosting this one');
      const target = spawnSync('/bin/ps', ['-p', String(filePid), '-o', 'command='], { encoding: 'utf8' });
      assert.ok(target.stdout.includes(file), `the recorded pid no longer names the nested test file: ${target.stdout}`);
      process.kill(filePid, 'SIGKILL');
    }
    await checkEnding(context, tmp, runName, output);
    publishReadEvidence();
    if (context.signal.aborted) throw new Error('hold cancelled after readiness', { cause: context.signal.reason });
    if (ending === 'E2') {
      const report = readFileSync(output, 'utf8');
      assert.match(report, /holds a ready fixture/);
      assert.match(report, /test timed out after 1000ms/);
      assert.doesNotMatch(report, /event loop has already resolved|started no process|hookFailed/);
      const types = [...report.matchAll(/^\s*failureType: ['"]([^'"]+)['"]/gm)].map((match) => match[1]);
      const errors = [...report.matchAll(/^\s*error: ['"]([^'"]+)['"]\s*$/gm)].map((match) => match[1]);
      assert.match(report, /^TAP version 13$/m);
      assert.deepEqual(types, ['testTimeoutFailure', 'subtestsFailed'], report);
      assert.deepEqual(errors, ['test timed out after 1000ms', '1 subtest failed'], report);
      assert.equal([...report.matchAll(/^\s*not ok /gm)].length, 2, report);
    }
  } catch (error) {
    publishReadEvidence();
    try { await teardown(); } catch (cleanup) { throw new AggregateError([error, cleanup], `${phase} failed and teardown failed`); }
    onPhase('teardown');
    if (context.signal.aborted && phase === 'hold') throw new Error('hold cancelled after readiness', { cause: error });
    throw error;
  }
}

test('E6 waits for a complete positive file pid before signaling', { timeout: 30_000 }, (t) => runEnding(t, 'E6', 'F1', { holdPidPublication: true }));

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F1 busy fixture by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F1'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F2 tail that outlived its parent by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F2'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F3 tail in its own group after its parent exits by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F3'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F4 group leader and tail by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F4'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F5 detached tail by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F5'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F6 stand-in agent by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F6'));
}

for (const ending of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) {
  test(`${ending} ends an F7 L0 process group by ten seconds after the run ends`, { timeout: 30_000 }, (t) => runEnding(t, ending, 'F7'));
}

test('E5 publishes a safe structural record for completed targeted reads', { timeout: 30_000 }, async (t) => {
  const diagnostics = [];
  const previous = console.error;
  console.error = (...args) => {
    diagnostics.push(args.join(' '));
    previous(...args);
  };
  try {
    await runEnding(t, 'E5', 'F1');
  } finally {
    console.error = previous;
  }
  const records = diagnostics.filter((line) => line.startsWith('RIGGER_REAPER_READ '));
  assert.ok(records.length > 0, 'E5 produced no structural targeted-read record');
  const record = JSON.parse(records[0].slice('RIGGER_REAPER_READ '.length));
  assert.equal(record.cell, 'E5-F1');
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
  assert.equal(typeof record.readSequence, 'number');
  assert.equal(typeof record.parserClass, 'string');
  if (record.parserClass === 'absent') assert.equal(record.signalZero, 'ESRCH');
});

test('targeted read projection retains framing but hides command text and paths', () => {
  const stdout = '123 Z Mon Oct 28 10:00:00 2026 SECRET_WALRUS=/private/branch\nnext\r\n';
  const record = targetReadRecord({
    cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'malformed',
    result: { status: 0, signal: null, error: null, stdout, stderr: '' },
  });
  assert.equal(record.stdoutUnits, stdout.length);
  assert.equal(record.stderrUnits, 0);
  assert.equal(record.rowCount, 2);
  assert.equal(record.separatorCount, 2);
  assert.deepEqual(record.separators, [
    { at: stdout.indexOf('\n'), kind: 'lf' },
    { at: stdout.lastIndexOf('\r\n'), kind: 'crlf' },
  ]);
  assert.doesNotMatch(JSON.stringify(record), /SECRET_WALRUS|\/private\/branch/);
  assert.match(record.skeleton, /^[Aad0. |]*$/);
});

test('targeted read projection caps its public shape for large tool answers', () => {
  const stdout = 'X'.repeat(300) + '\n'.repeat(80);
  const record = targetReadRecord({
    cell: 'E6-F7', pid: 123, readSequence: 2, parserClass: 'framing',
    result: { status: 0, signal: null, error: null, stdout, stderr: '' },
  });
  assert.equal(record.stdoutUnits, 380);
  assert.equal(record.skeleton.length, 256);
  assert.equal(record.skeletonTruncated, true);
  assert.equal(record.separatorCount, 80);
  assert.equal(record.separators.length, 64);
  assert.equal(record.separatorsTruncated, true);
  assert.equal(record.rowCount, 80);
  assert.doesNotMatch(JSON.stringify(record), /X{10}/);
});

test('unsafe or incomplete targeted-read records cannot become complete public evidence', () => {
  const record = targetReadRecord({
    cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
    result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
  });
  assert.throws(() => safeTargetReadRecord({ ...record, pid: null }), /trace record is incomplete/);
  assert.throws(() => safeTargetReadRecord({ ...record, skeleton: 'SECRET_WALRUS' }), /trace record is incomplete/);
  assert.throws(() => safeTargetReadRecord({ ...record, separators: [{ at: 0, kind: 'private' }] }), /trace record is incomplete/);
  assert.equal(JSON.stringify(safeTargetReadRecord({ ...record, command: '/private/secret' })).includes('/private/secret'), false);
});

test('missing or truncated reaper trace remains incomplete evidence', () => {
  const record = targetReadRecord({
    cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
    result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
  });
  const line = JSON.stringify(record) + '\n';
  assert.deepEqual(traceEvidence(line, 'E5-F1'), { records: [record], incomplete: false });
  assert.deepEqual(traceEvidence(undefined, 'E5-F1'), { records: [], incomplete: true });
  assert.deepEqual(traceEvidence(line.slice(0, -1), 'E5-F1'), { records: [], incomplete: true });
  assert.deepEqual(traceEvidence(JSON.stringify({ ...record, skeleton: 'SECRET_WALRUS' }) + '\n', 'E5-F1'), { records: [], incomplete: true });
});

test('targeted read outcomes and trace failures retain the confirmed-ending decision', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('let targetReadSequence = 0;');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start, 'the targeted read function is present');
  const targetFunction = source.slice(start, end);
  const root = temporaryDirectory('rigger-reaper-probe-', { context: t });
  const row = '123 S Mon Oct 28 10:00:00 2026 command\n';
  const zombie = '123 Z Mon Oct 28 10:00:00 2026 command\n';
  const answer = (changes = {}) => ({ status: 0, signal: null, error: null, stdout: row, stderr: '', ...changes });
  const cases = [
    ['live row', answer(), 'reached', 'live', 'return'],
    ['zombie row', answer({ stdout: zombie }), 'reached', 'zombie', 'return'],
    ['status 0 absent', answer({ stdout: '' }), 'ESRCH', 'absent', 'return'],
    ['status 0 reached', answer({ stdout: '' }), 'reached', 'omitted', 'throw'],
    ['status 0 forbidden', answer({ stdout: '' }), 'EPERM', 'absence-unconfirmed', 'throw'],
    ['status 1 absent', answer({ status: 1, stdout: '' }), 'ESRCH', 'absent', 'return'],
    ['status 1 reached', answer({ status: 1, stdout: '' }), 'reached', 'omitted', 'throw'],
    ['status 1 forbidden', answer({ status: 1, stdout: '' }), 'EPERM', 'absence-unconfirmed', 'throw'],
    ['status 1 nonempty', answer({ status: 1 }), 'reached', 'read-failed', 'throw'],
    ['multiple rows', answer({ stdout: row + row }), 'reached', 'framing', 'throw'],
    ['malformed row', answer({ stdout: 'wrong row\n' }), 'reached', 'malformed', 'throw'],
    ['spawn error', answer({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }), 'reached', 'read-failed', 'throw'],
    ['signal', answer({ signal: 'SIGKILL' }), 'reached', 'read-failed', 'throw'],
    ['nonempty stderr', answer({ stderr: 'tool failed' }), 'reached', 'read-failed', 'throw'],
  ];
  const run = (result, signalZero, traceFile, traceRoot) => {
    const mockedProcess = {
      env: traceFile ? { RIGGER_REAPER_TRACE_FILE: traceFile, RIGGER_REAPER_TRACE_ROOT: traceRoot, RIGGER_REAPER_CELL: 'E5-F1' } : {},
      getuid: process.getuid.bind(process),
      kill: () => {
        if (signalZero === 'reached') return;
        throw Object.assign(new Error(signalZero), { code: signalZero });
      },
    };
    const context = {
      spawnSync: () => result, process: mockedProcess, targetReadRecord,
      realpathSync, dirname, isAbsolute, relative, sep, statSync, existsSync, join,
      lstatSync, openSync, resolve, files: constants, writeSync, closeSync,
    };
    try {
      return { kind: 'return', value: JSON.stringify(runInNewContext(targetFunction + '\ntargetState(123)', context)) };
    } catch (error) {
      return { kind: 'throw', value: error.message };
    }
  };
  for (const [name, result, signalZero, parserClass, kind] of cases) {
    const destination = join(root, randomUUID() + '.jsonl');
    const untraced = run(result, signalZero);
    const traced = run(result, signalZero, destination, root);
    assert.deepEqual(traced, untraced, name + ' changed the reaper decision');
    assert.equal(traced.kind, kind, name);
    const records = readFileSync(destination, 'utf8').trimEnd().split('\n');
    assert.equal(records.length, 1, name);
    const record = JSON.parse(records[0]);
    assert.equal(record.parserClass, parserClass, name);
    assert.equal(record.signalZero, result.stdout === '' ? signalZero : 'not-checked', name);
    assert.equal(record.cell, 'E5-F1', name);
  }
  const outside = join(dirname(root), randomUUID() + '.jsonl');
  const checkout = join(resolve('.'), randomUUID() + '.jsonl');
  const link = join(root, 'link.jsonl');
  const linkTarget = join(root, 'link-target');
  writeFileSync(linkTarget, 'untouched');
  symlinkSync(linkTarget, link);
  const unwritable = join(root, 'unwritable.jsonl');
  writeFileSync(unwritable, 'untouched');
  chmodSync(unwritable, 0o400);
  t.after(() => chmodSync(unwritable, 0o600));
  for (const [name, destination, traceRoot] of [
    ['outside TMPDIR', outside, root],
    ['checkout TMPDIR', checkout, resolve('.')],
    ['symlink', link, root],
    ['unwritable', unwritable, root],
    ['missing root', join(root, 'missing-root.jsonl'), undefined],
  ]) {
    assert.deepEqual(run(answer(), 'reached', destination, traceRoot), run(answer(), 'reached'), name);
    if (name === 'unwritable') assert.equal(readFileSync(unwritable, 'utf8'), 'untouched');
    else if (name === 'symlink') assert.equal(readFileSync(linkTarget, 'utf8'), 'untouched');
    else assert.equal(existsSync(destination), false, name + ' wrote outside its permitted trace');
  }
});

test('the ending check waits for a transient reaper after removal', async (t) => {
  const directory = scratch(t);
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const output = join(directory, 'output');
  writeFileSync(output, 'nested suite output');
  const seen = [];
  await checkEnding(t, tmp, 'run', output, {
    processes: () => {
      const rows = seen.length === 0 ? ['123 R node test/suite-reaper'] : [];
      seen.push(rows);
      return rows;
    },
    now: () => 0,
    turn: async () => {},
  });
  assert.deepEqual(seen, [['123 R node test/suite-reaper'], []]);
});

test('the final poll selects the process or directory assertion for every reported set', async (t) => {
  const directory = scratch(t);
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const output = join(directory, 'output');
  writeFileSync(output, 'nested suite output');
  const reaper = '101 R node test/suite-reaper';
  const runner = '102 S node --require run/runner.cjs --test';
  const fixture = '103 S fixture';
  const cases = [
    ['P0', [], [], []],
    ['P1', [reaper], [], []],
    ['P2', [reaper], [reaper], [reaper]],
    ['P3', [runner], [], []],
    ['P4', [runner, fixture], [runner], [runner]],
    ['P5', [reaper, runner], [], []],
    ['P6', [reaper, runner, fixture], [runner], [runner]],
    ['P7', [reaper, runner], [reaper], [reaper]],
    ['P8', [reaper, runner, fixture], [reaper, runner], [reaper, runner]],
  ];
  for (const [cell, first, final, survivors] of cases) {
    for (const directoryPresent of [false, true]) {
      let clock = 0;
      let poll = 0;
      const observations = [];
      const attempt = checkEnding(t, tmp, 'run', output, {
        processes: () => {
          const rows = poll === 0 ? first : final;
          observations.push(rows);
          poll += 1;
          return rows;
        },
        exists: () => directoryPresent,
        now: () => clock,
        turn: async () => { clock = 10_000; },
      });
      if (survivors.length > 0 || directoryPresent) {
        await assert.rejects(attempt, (error) => {
          assert.match(error.message, survivors.length > 0 ? /processes from .* survived/ : /the suite left .*run/);
          for (const member of survivors) assert.ok(error.message.includes(member), `${cell} omitted ${member}`);
          for (const member of first.filter((row) => !survivors.includes(row))) assert.ok(!error.message.includes(member), `${cell} named cleared ${member}`);
          assert.ok(error.message.includes('nested suite output'));
          return true;
        }, `${cell} with directory ${directoryPresent}`);
      } else {
        await attempt;
      }
      assert.deepEqual(observations, first.length === 0 && !directoryPresent ? [first] : [first, final], `${cell} with directory ${directoryPresent}`);
    }
  }
});

async function heldMember(t, tmp, source) {
  const command = source === 'reaper' ? `test/suite-reaper ${tmp}` : source === 'ps' ? `fixture ${tmp}` : 'fixture with cwd only';
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()', command], { cwd: source === 'lsof' ? tmp : resolve('.'), stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => ended(child));
  assert.equal(await until(() => processesIn(tmp).some((row) => row.startsWith(`${child.pid} `)), 10_000, t), true, `${source} member never appeared`);
  const ps = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' });
  assert.equal(ps.status, 0);
  assert.equal(ps.stdout.includes(tmp), source !== 'lsof', `${source} ps source`);
  if (source === 'lsof') {
    const lsof = spawnSync(LSOF, ['-nP', '-a', '-p', String(child.pid), '-d', 'cwd', '-Fn'], { env: process.env, encoding: 'utf8' });
    assert.equal(lsof.status, 0);
    assert.ok(lsof.stdout.includes(`n${tmp}`), `${source} cwd source: ${lsof.stdout}`);
  }
  return child;
}

test('a reported reaper, ps fixture, or lsof-only fixture survives the bound with the process message', async (t) => {
  for (const source of ['reaper', 'ps', 'lsof']) {
    for (const directoryPresent of [false, true]) {
      await t.test(`${source} D${directoryPresent ? 1 : 0}`, async (s) => {
        const directory = scratch(s);
        const tmp = join(directory, 'tmp');
        mkdirSync(tmp);
        if (directoryPresent) mkdirSync(join(tmp, 'run'));
        const output = join(directory, 'output');
        writeFileSync(output, 'nested suite output');
        const child = await heldMember(s, tmp, source);
        let clock = 0;
        await assert.rejects(checkEnding(s, tmp, 'run', output, {
          now: () => clock,
          turn: async () => { clock = 10_000; },
        }), (error) => {
          assert.match(error.message, /processes from .* survived/);
          assert.ok(error.message.includes(String(child.pid)), `${source} PID missing`);
          assert.ok(error.message.includes('nested suite output'));
          return true;
        });
      });
    }
  }
});

test('a reaper seen through ps clears on the next answered poll', async (t) => {
  const directory = scratch(t);
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const output = join(directory, 'output');
  writeFileSync(output, 'nested suite output');
  const child = await heldMember(t, tmp, 'reaper');
  const observations = [];
  await checkEnding(t, tmp, 'run', output, {
    processes: (path) => {
      const rows = processesIn(path);
      observations.push(rows);
      return rows;
    },
    turn: async () => { await ended(child); },
  });
  assert.ok(observations[0].some((row) => row.startsWith(`${child.pid} `)));
  assert.deepEqual(observations.at(-1), []);
});

test('trace refuses supplied paths outside TMPDIR', (t) => {
  const directory = scratch(t);
  const destination = join(directory, 'trace.jsonl');
  symlinkSync('/dev/null', destination);
  const previousFile = process.env.C667_TRACE_FILE;
  const previousTrace = activeTrace;
  process.env.C667_TRACE_FILE = destination;
  activeTrace = { eventCase: 'trace-path' };
  t.after(() => {
    activeTrace = previousTrace;
    if (previousFile === undefined) delete process.env.C667_TRACE_FILE;
    else process.env.C667_TRACE_FILE = previousFile;
  });
  assert.throws(() => trace({ event: 'probe' }), /TMPDIR/);
  const checkoutPath = resolve('c667-trace-must-not-write.jsonl');
  process.env.C667_TRACE_FILE = checkoutPath;
  assert.throws(() => trace({ event: 'probe' }), /TMPDIR/);
  assert.equal(existsSync(checkoutPath), false);
  const safePath = join(directory, 'safe-trace.jsonl');
  process.env.C667_TRACE_FILE = safePath;
  trace({ event: 'probe' });
  assert.match(readFileSync(safePath, 'utf8'), /"event":"probe"/);
});

test('trace refuses TMPDIR inside a pre-existing checkout', (t) => {
  const directory = scratch(t);
  const checkout = join(directory, 'checkout');
  mkdirSync(checkout);
  mkdirSync(join(checkout, '.git'));
  const previousFile = process.env.C667_TRACE_FILE;
  const previousTmp = process.env.TMPDIR;
  const previousTrace = activeTrace;
  process.env.TMPDIR = checkout;
  process.env.C667_TRACE_FILE = join(checkout, 'trace.jsonl');
  activeTrace = { eventCase: 'trace-path' };
  t.after(() => {
    activeTrace = previousTrace;
    if (previousFile === undefined) delete process.env.C667_TRACE_FILE;
    else process.env.C667_TRACE_FILE = previousFile;
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
  });
  assert.throws(() => trace({ event: 'probe' }), /TMPDIR/);
});

test('E2 holds its real one-second timer until delayed setup is ready', { timeout: 30_000 }, (t) => runEnding(t, 'E2', 'F1', { gateSetup: true }));

test('readiness accepts an independently live fixture identity', async (t) => {
  const record = { invocation: 'one', kind: 'F1', pid: 123, processes: [{ pid: 123, signature: 'Thu Oct 22 10:00:00 2026 123 /fixture/busy' }] };
  const ready = await waitForReadiness(t, {
    invocation: 'one', kind: 'F1', directory: '/fixture',
    read: () => JSON.stringify(record),
    observe: () => ({ live: true, signature: 'Thu Oct 22 10:00:00 2026 123 /fixture/busy', group: 123, command: '/bin/bash /fixture/busy' }),
  });
  assert.equal(ready.pid, 123);
});

// Host observations below use literal identities; they never derive an expected answer with the waiter.
for (const [label, bytes] of [
  ['missing', undefined],
  ['incomplete', '{"pid":'],
  ['malformed', '{"pid":"123tail"}'],
  ['nonpositive', '{"pid":0}'],
]) {
  test(`readiness rejects ${label} PID at the setup boundary`, async (t) => {
    let clock = 0;
    await assert.rejects(waitForReadiness(t, {
      invocation: 'one', kind: 'F1', directory: '/fixture', read: () => bytes,
      observe: () => { assert.fail('an invalid PID must never reach the host observer'); },
      now: () => clock, turn: async () => { clock = 10_000; },
    }), /setup never became ready by 10000ms/);
  });
}

for (const [label, change, actual, message] of [
  ['stale invocation', { invocation: 'old' }, {}, /stale invocation/],
  ['wrong fixture', { kind: 'F2' }, {}, /wrong fixture/],
  ['absent process', {}, { live: false }, /not live/],
  ['reused PID', {}, { signature: 'Fri Oct 23 10:00:00 2026 123 /fixture/busy' }, /reused or foreign/],
]) {
  test(`readiness rejects ${label} without cleanup credit`, async (t) => {
    const record = { invocation: 'one', kind: 'F1', pid: 123, processes: [{ pid: 123, signature: 'Thu Oct 22 10:00:00 2026 123 /fixture/busy' }], ...change };
    await assert.rejects(waitForReadiness(t, {
      invocation: 'one', kind: 'F1', directory: '/fixture', read: () => JSON.stringify(record),
      observe: () => ({ live: true, signature: 'Thu Oct 22 10:00:00 2026 123 /fixture/busy', command: '/fixture/busy', ...actual }),
    }), message);
  });
}

for (const failure of ['spawn error: ENOENT', 'early exit: 1']) {
  test(`readiness reports setup ${failure}`, async (t) => {
    await assert.rejects(waitForReadiness(t, {
      invocation: 'one', kind: 'F1', directory: '/fixture', read: () => undefined,
      failure: () => failure,
    }), new RegExp(`setup failed before readiness: ${failure}`));
  });
}

for (const phase of ['setup', 'hold']) {
  test(`parent abort during ${phase} tears down its recorded suite child`, { timeout: 30_000 }, async (t) => {
    const controller = new AbortController();
    const phases = [];
    let entered;
    await assert.rejects(runEnding(t, 'E2', 'F1', {
      signal: controller.signal,
      onPhase: (current, detail) => {
        phases.push(current);
        if (phase === 'setup' && current === 'setup') controller.abort(new Error('controlled parent ending'));
        if (phase === 'hold' && current === 'hold') entered = until(() => existsSync(detail.holding), 10_000, t).then((seen) => {
          assert.equal(seen, true, 'the nested holding body must actually begin');
          phases.push('holding-entered');
          controller.abort(new Error('controlled parent ending'));
        });
      },
    }), phase === 'setup' ? /setup cancelled before readiness/ : /hold cancelled after readiness/);
    await entered;
    assert.deepEqual(phases, phase === 'setup' ? ['setup', 'teardown'] : ['setup', 'hold', 'holding-entered', 'teardown']);
  });
}

test('readiness cannot accept a publication after the setup deadline', async (t) => {
  let clock = 0;
  const record = { invocation: 'one', kind: 'F1', pid: 123, processes: [{ pid: 123, signature: 'known-start /fixture/busy' }] };
  await assert.rejects(waitForReadiness(t, {
    invocation: 'one', kind: 'F1', directory: '/fixture',
    read: () => clock === 0 ? undefined : JSON.stringify(record),
    observe: () => ({ live: true, signature: 'known-start /fixture/busy', command: '/fixture/busy' }),
    now: () => clock, turn: async () => { clock = 10_001; },
  }), /setup never became ready by 10000ms/);
});

test('readiness rejects a process observation that crosses its setup deadline', async (t) => {
  let clock = 0;
  const record = { invocation: 'one', kind: 'F1', pid: 123, processes: [{ pid: 123, signature: 'known-start /fixture/busy' }] };
  await assert.rejects(waitForReadiness(t, {
    invocation: 'one', kind: 'F1', directory: '/fixture', read: () => JSON.stringify(record),
    observe: () => {
      clock = 10_001;
      return { live: true, signature: 'known-start /fixture/busy', command: '/fixture/busy' };
    },
    now: () => clock,
  }), /setup never became ready by 10000ms/);
});

test('readiness shares its observation budget across the required leader and member', async (t) => {
  let clock = 0;
  const budgets = [];
  const record = { invocation: 'one', kind: 'F4', leader: 456, pid: 123, processes: [
    { pid: 456, signature: 'known-leader /fixture/leader' },
    { pid: 123, signature: 'known-member /fixture/member' },
  ] };
  await waitForReadiness(t, {
    invocation: 'one', kind: 'F4', directory: '/fixture', read: () => JSON.stringify(record),
    observe: (pid, remaining) => {
      budgets.push(remaining);
      clock += 2_500;
      return { live: true, signature: pid === 456 ? 'known-leader /fixture/leader' : 'known-member /fixture/member', command: '/fixture/command' };
    },
    now: () => clock,
  });
  assert.deepEqual(budgets, [10_000, 7_500]);
});

test('the host readiness read bounds its ps invocation by the remaining budget', () => {
  let timeout;
  const result = readinessProcess(123, 17, (_command, _args, options) => {
    timeout = options.timeout;
    assert.equal(options.killSignal, 'SIGKILL');
    return { error: Object.assign(new Error('spawnSync /bin/ps ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
  });
  assert.equal(timeout, 17);
  assert.deepEqual(result, { live: false });
});

for (const kind of ['F3', 'F5']) {
  test(`readiness rejects an ${kind} tail that does not lead its own group`, async (t) => {
    const record = { invocation: 'one', kind, pid: 123, working: '/fixture/working',
      processes: [{ pid: 123, signature: 'known-tail /fixture/tail' }] };
    await assert.rejects(waitForReadiness(t, {
      invocation: 'one', kind, directory: '/fixture', read: () => JSON.stringify(record),
      observe: () => ({ live: true, signature: 'known-tail /fixture/tail', command: '/fixture/tail', group: 456, cwd: '/fixture/working' }),
    }), /tail does not lead its own group/);
  });
}

test('readiness rejects an F5 tail outside its intended working directory', async (t) => {
  const record = { invocation: 'one', kind: 'F5', pid: 123, working: '/fixture/working',
    processes: [{ pid: 123, signature: 'known-tail /fixture/tail' }] };
  await assert.rejects(waitForReadiness(t, {
    invocation: 'one', kind: 'F5', directory: '/fixture', read: () => JSON.stringify(record),
    observe: () => ({ live: true, signature: 'known-tail /fixture/tail', command: '/fixture/tail', group: 123, cwd: '/fixture/elsewhere' }),
  }), /tail is outside its intended working directory/);
});

test('the F5 cwd read consumes only the remaining shared observation budget', () => {
  let clock = 0;
  const timeouts = [];
  const observed = readinessProcess(123, 10_000, (command, _args, options) => {
    timeouts.push(options.timeout);
    assert.equal(options.killSignal, 'SIGKILL');
    if (command === '/bin/ps') {
      clock = 2_500;
      return { status: 0, stdout: 'S Thu Oct 22 10:00:00 2026 123 /fixture/tail\n' };
    }
    assert.equal(command, LSOF);
    return { status: 0, stdout: 'p123\nfcwd\nn/fixture/working\n' };
  }, { deadline: 10_000, now: () => clock });
  assert.equal(observed.cwd, '/fixture/working');
  assert.deepEqual(timeouts, [10_000, 7_500]);
});

test('readiness rejects an F5 cwd observation completed past the setup deadline', async (t) => {
  let clock = 0;
  const record = { invocation: 'one', kind: 'F5', pid: 123, working: '/fixture/working',
    processes: [{ pid: 123, signature: 'Thu Oct 22 10:00:00 2026 123 /fixture/tail' }] };
  await assert.rejects(waitForReadiness(t, {
    invocation: 'one', kind: 'F5', directory: '/fixture', read: () => JSON.stringify(record), now: () => clock,
    observe: (pid, remaining, _run, budget) => readinessProcess(pid, remaining, (command) => {
      if (command === '/bin/ps') return { status: 0, stdout: 'S Thu Oct 22 10:00:00 2026 123 /fixture/tail\n' };
      clock = 10_001;
      return { status: 0, stdout: 'p123\nfcwd\nn/fixture/working\n' };
    }, budget),
  }), /setup never became ready by 10000ms/);
});

function directReaperPreload() {
  const cp = require('node:child_process');
  const fs = require('node:fs');
  const { syncBuiltinESMExports } = require('node:module');
  const config = JSON.parse(fs.readFileSync(process.env.RIGGER_919_CONFIG, 'utf8'));
  if (process.argv[1] !== config.cli) throw new Error('919 preload reached a different entry point');
  const nativeSpawn = cp.spawnSync;
  const nativeKill = process.kill.bind(process);
  const same = (one, two) => JSON.stringify(one) === JSON.stringify(two);
  const pack = (r) => ({ pid: r.pid, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr,
    error: r.error ? { code: r.error.code, message: r.error.message } : null });
  let sequence = 0;
  let psReads = 0;
  let cwdReads = 0;
  let kills = 0;
  let acknowledgements = 0;
  let targetReads = 0;
  let permissionFaultSent = false;
  const record = (value) => fs.writeFileSync(config.trace, JSON.stringify({ sequence: ++sequence, cliPid: process.pid, ...value }) + '\n', { flag: 'a' });
  const fault = (stdout) => {
    if (config.mode === 'malformed') return 'not-a-process-row\n';
    if (config.mode === 'wrong-pid') return stdout.replace(/^([ \t]*)[0-9]+/, `$1${config.pid + 1}`);
    if (config.mode === 'duplicate') return stdout + stdout;
    if (config.mode === 'extra-lf') return stdout + '\n';
    if (config.mode === 'vertical') return stdout.replace(/^([ \t]*[0-9]+)[ \t]+/, '$1\v');
    if (config.mode === 'horizontal') return stdout.replace(/^([ \t]*[0-9]+)[ \t]+(\S+)[ \t]+/, '$1\t$2\t');
    if (config.mode === 'changed-start') {
      const changed = config.started === 'Thu Jan  1 00:00:00 1970' ? 'Fri Jan  2 00:00:00 1970' : 'Thu Jan  1 00:00:00 1970';
      return stdout.replace(/^([ \t]*[0-9]+[ \t]+\S+[ \t]+).{24}/, `$1${changed}`);
    }
    return stdout;
  };
  cp.spawnSync = function(command, args, options) {
    if (command === '/bin/ps' && same(args, config.discoveryPS)) {
      const stdout = psReads++ === 0 ? config.selectedPS : '';
      record({ event: 'discovery-ps', command, args, historicalLiveSelection: config.mode === 'zombie', result: { status: 0, signal: null, stdout, stderr: '' } });
      return { status: 0, signal: null, error: undefined, stdout, stderr: '' };
    }
    if (command === config.lsof && same(args, config.discoveryCwd)) {
      const stdout = cwdReads++ === 0 ? config.selectedCwd : '';
      record({ event: 'discovery-cwd', command, args, historicalLiveSelection: config.mode === 'zombie', result: { status: 0, signal: null, stdout, stderr: '' } });
      return { status: 0, signal: null, error: undefined, stdout, stderr: '' };
    }
    if (command !== '/bin/ps' || !same(args, config.targetedPS)) return nativeSpawn.apply(this, arguments);
    targetReads++;
    if (kills > 0 && (config.mode === 'absence' || config.mode === 'timeout')) {
      if (options.timeout !== 1000 || options.killSignal !== 'SIGKILL') throw new Error('targeted PS did not receive its reviewed owned-child bound');
      const deadlineNs = (process.hrtime.bigint() + BigInt(options.timeout) * 1000000n).toString();
      const control = { mode: config.mode, parent: process.pid, deadlineNs, metadata: config.timeoutMetadata, closed: config.closedMarker, pid: config.pid, args };
      const helper = nativeSpawn(process.execPath, ['--input-type=commonjs', '-e', config.psControl, JSON.stringify(control)], options);
      if (config.mode === 'timeout' || helper.error || helper.status !== 0) {
        record({ event: 'targeted', command, args, read: targetReads, afterFreshSignal: kills > 0, mode: config.mode, controlled: true, helper: pack(helper), result: pack(helper) });
        return helper;
      }
      const payload = JSON.parse(helper.stdout);
      const result = { ...payload.actual, error: payload.actual.error ? Object.assign(new Error(payload.actual.error.message), { code: payload.actual.error.code }) : undefined };
      record({ event: 'targeted', command, args, read: targetReads, afterFreshSignal: kills > 0, mode: config.mode, controlled: true, helper: pack(helper), barrier: payload.closed, result: pack(result) });
      return result;
    }
    const native = nativeSpawn.apply(this, arguments);
    let result = native;
    const controlled = kills > 0 && !['ack', 'native', 'zombie'].includes(config.mode) && !(config.mode === 'changed-start' && targetReads === 1);
    if (controlled) {
      result = { ...native, stdout: fault(native.stdout), stderr: '' };
      if (config.mode === 'spawn-error') result = { status: null, signal: null, stdout: '', stderr: '', error: Object.assign(new Error('controlled target PS spawn error'), { code: 'ENOENT' }) };
      if (config.mode === 'silent-nonzero') result = { status: 2, signal: null, stdout: '', stderr: '', error: undefined };
      if (config.mode === 'stderr') result.stderr = 'controlled target PS warning';
      if (config.mode === 'empty-live' || config.mode === 'eperm') result = { status: 1, signal: null, stdout: '', stderr: '', error: undefined };
    }
    record({ event: 'targeted', command, args, read: targetReads, afterFreshSignal: kills > 0, mode: config.mode, controlled, native: pack(native), result: pack(result) });
    return result;
  };
  process.kill = function(pid, signal) {
    if (signal === 0 && pid === config.pid) {
      if (config.mode === 'eperm' && acknowledgements > 0 && !permissionFaultSent) {
        permissionFaultSent = true;
        record({ event: 'signal-zero', pid, controlled: true, error: 'EPERM' });
        throw Object.assign(new Error('controlled owned-target signal-zero permission failure'), { code: 'EPERM' });
      }
      try {
        const answer = nativeKill(pid, signal); record({ event: 'signal-zero', pid, controlled: false, answer }); return answer;
      } catch (error) { record({ event: 'signal-zero', pid, controlled: false, error: error.code }); throw error; }
    }
    if (signal !== 'SIGKILL') return nativeKill(pid, signal);
    if (pid !== config.pid) throw new Error('919 CLI attempted an unowned SIGKILL');
    kills++;
    record({ event: 'kill-request', pid, signal, native: config.realKill });
    if (config.realKill) {
      const answer = nativeKill(pid, signal); record({ event: 'native-kill-answer', pid, answer }); return answer;
    }
    acknowledgements++;
    record({ event: 'kill-ack-without-effect', pid, signal });
    return true;
  };
  syncBuiltinESMExports();
}

async function directReaperPSControl() {
  const { existsSync, readFileSync, writeFileSync } = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const config = JSON.parse(process.argv[1]);
  const startedNs = process.hrtime.bigint().toString();
  const remaining = () => Number(BigInt(config.deadlineNs) - process.hrtime.bigint()) / 1e6;
  const pack = (result) => ({ pid: result.pid, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
    error: result.error ? { code: result.error.code, message: result.error.message } : null });
  writeFileSync(config.metadata, JSON.stringify({ pid: process.pid, parent: process.ppid, mode: config.mode, startedNs }));
  if (config.mode === 'timeout') {
    const held = setInterval(() => { throw new Error('owned PS timeout fixture callback fired'); }, 2 ** 30);
    try {
      writeFileSync(config.metadata, JSON.stringify({ pid: process.pid, parent: process.ppid, startedNs, referenced: held.hasRef() }));
      const native = spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'pid=,ppid=,stat='], { encoding: 'utf8', timeout: Math.max(1, Math.ceil(remaining())), killSignal: 'SIGKILL' });
      if (!(remaining() > 0)) throw new Error('owned target-read witness exceeded the same read window');
      writeFileSync(config.metadata, JSON.stringify({ pid: process.pid, parent: process.ppid, mode: config.mode, startedNs, actual: pack(native), referenced: held.hasRef() }));
      while (process.ppid === config.parent) await new Promise((resolve) => setImmediate(resolve));
    } finally { clearInterval(held); }
  } else {
    while (!existsSync(config.closed)) {
      if (process.ppid !== config.parent || !(remaining() > 0)) throw new Error('direct-child close/ESRCH barrier owner ended or deadline expired');
      await new Promise((resolve) => setImmediate(resolve));
    }
    const closed = JSON.parse(readFileSync(config.closed, 'utf8'));
    if (closed.pid !== config.pid || closed.absence !== 'ESRCH' || !(remaining() > 0)) throw new Error('wrong or late direct-child absence barrier');
    const native = spawnSync('/bin/ps', config.args, { encoding: 'utf8', timeout: Math.max(1, Math.ceil(remaining())), killSignal: 'SIGKILL',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' } });
    if (!(remaining() > 0)) throw new Error('native absence read exceeded the same target-read window');
    process.stdout.write(JSON.stringify({ closed, actual: pack(native) }));
  }
}

const directReaperZombieSource = [
  "use strict;",
  "use warnings;",
  "use POSIX qw(WNOHANG);",
  "use Errno qw(EINTR);",
  "$SIG{CHLD} = 'DEFAULT';",
  "my $run = <STDIN>;",
  "defined($run) or die \"missing run\";",
  "chomp($run);",
  "pipe(my $read, my $write) or die \"pipe: $!\";",
  "my $child = fork();",
  "defined($child) or die \"fork: $!\";",
  "my $reaped = 0;",
  "sub finish_child {",
  "  return if !$child || $reaped;",
  "  my $already = waitpid($child, WNOHANG);",
  "  die \"child ownership lost before cleanup\" if $already < 0;",
  "  if ($already == 0) {",
  "    kill('KILL', $child);",
  "    my $waited = waitpid($child, 0);",
  "    die \"owned child did not reap\" if $waited != $child;",
  "  }",
  "  $reaped = 1;",
  "  print \"reaped $child\\n\";",
  "}",
  "END { finish_child(); }",
  "if ($child == 0) {",
  "  close($write);",
  "  chdir($run) or die \"chdir: $!\";",
  "  my $byte;",
  "  sysread($read, $byte, 1);",
  "  exit(0);",
  "}",
  "close($read);",
  "$SIG{TERM} = sub { finish_child(); exit(0); };",
  "$| = 1;",
  "print \"holder $$ target $child\\n\";",
  "my $command;",
  "while (1) {",
  "  my $count = sysread(STDIN, $command, 1);",
  "  if (!defined($count)) { next if $! == EINTR; die \"holder read: $!\"; }",
  "  last if $count == 0;",
  "  if ($command eq 'K' && !$reaped) { my $sent = kill('KILL', $child); print \"kill $child $sent\\n\"; die \"owned kill failed\" if $sent != 1; }",
  "  if ($command eq 'R') {",
  "    my $waited = waitpid($child, 0);",
  "    die \"R did not reap owned child\" if $waited != $child;",
  "    $reaped = 1;",
  "    print \"reaped $child\\n\";",
  "    exit(0);",
  "  }",
  "}",
].join('\n');

async function directReaperSelection(t, selection) {
  const mode = selection === false ? 'ack' : selection === true ? 'native' : selection;
  const positive = ['native', 'absence', 'zombie'].includes(mode);
  let target; let holder; let cli; let targetPid;
  let targetClosed = false; let holderClosed = false; let cliClosed = false;
  let heldTargetAbsent = mode !== 'zombie'; let auxiliarySettled = !['absence', 'timeout'].includes(mode);
  const directory = realpathSync.native(temporaryDirectory('rigger-reaper-confirm-', { context: t, beforeRemoval: () => {
    if ((target && !targetClosed) || (holder && !holderClosed) || (cli && !cliClosed) || (holder && targetPid && !heldTargetAbsent) || (cli && !auxiliarySettled)) throw new Error('owned control child ending is unresolved; preserve scratch');
  } }));
  const run = join(directory, 'run'); mkdirSync(run); writeFileSync(join(run, 'hold'), '');
  const pipe = join(directory, 'ended');
  const traceFile = join(directory, 'trace.jsonl');
  const configFile = join(directory, 'control.json');
  const preloadFile = join(directory, 'control.cjs');
  const closedMarker = join(directory, 'direct-child-closed.json');
  const timeoutMetadata = join(directory, 'owned-ps.json');
  const cliFile = resolve('test/suite-reaper');
  const observations = [];
  const backgroundErrors = [];
  let targetClose; let holderClose; let cliClose;
  let targetError; let holderError; let cliError;
  let holderOutput = ''; let holderErrors = ''; let output = ''; let errors = '';
  let reader; let writer; let fifoOpen; let fifoEOF;
  let cleanupPromise; let cleanupDeadline;
  const packed = (r) => ({ pid: r.pid, status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr,
    error: r.error ? { code: r.error.code, message: r.error.message } : null });
  const nativeAbsence = (pid) => {
    const actual = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,stat=,lstart=,command='], {
      encoding: 'utf8', timeout: 1_000, killSignal: 'SIGKILL', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
    });
    assert.equal(actual.error, undefined); assert.equal(actual.signal, null); assert.equal(actual.stderr, '');
    assert.ok(actual.status === 0 || actual.status === 1); assert.equal(actual.stdout, '');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const observed = { event: 'native-absence', pid, result: packed(actual), signalZero: 'ESRCH' }; observations.push(observed); return observed;
  };
  const observed = (pid, parent) => {
    const actual = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,pgid=,stat=,lstart=,command='], {
      encoding: 'utf8', timeout: 1_000, killSignal: 'SIGKILL', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
    });
    assert.equal(actual.error, undefined); assert.equal(actual.signal, null); assert.equal(actual.status, 0, actual.stderr); assert.equal(actual.stderr, '');
    const line = actual.stdout.endsWith('\n') ? actual.stdout.slice(0, -1) : actual.stdout;
    assert.doesNotMatch(line, /[\n\r\v\f\u0085\u2028\u2029]/);
    const row = /^[ \t]*([0-9]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+(\S+)[ \t]+(.{24})(?:[ \t]+(.*))?$/.exec(line);
    assert.ok(row, actual.stdout); assert.equal(Number(row[1]), pid); assert.equal(Number(row[2]), parent);
    const witness = { pid, parent: Number(row[2]), group: Number(row[3]), state: row[4], birth: row[5], command: row[6] ?? '', raw: packed(actual) };
    observations.push({ event: 'native-state', ...witness }); return witness;
  };
  const settle = async (closed) => {
    while (!closed() && performance.now() < cleanupDeadline) await new Promise((resolve) => setImmediate(resolve));
    if (!closed()) throw new Error('owned recorded child did not close during cleanup');
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    const failures = []; cleanupDeadline = performance.now() + 10_000;
    for (const fd of [writer, reader]) if (fd !== undefined) { try { closeSync(fd); } catch (error) { failures.push(error); } }
    writer = reader = undefined;
    if (cli) {
      if (cli.exitCode === null && cli.signalCode === null) { try { cli.kill('SIGKILL'); } catch (error) { failures.push(error); } }
      try { await settle(() => cliClosed); } catch (error) { failures.push(error); }
    }
    if (target) {
      if (target.exitCode === null && target.signalCode === null) { try { target.kill('SIGKILL'); } catch (error) { failures.push(error); } }
      try { await settle(() => targetClosed); } catch (error) { failures.push(error); }
    }
    if (holder) {
      if (!holderClosed) {
        try { holder.stdin.end('KR'); } catch (error) { failures.push(error); }
        try { await settle(() => holderClosed); } catch (error) {
          failures.push(error);
          try { holder.kill('SIGTERM'); } catch (signalError) { failures.push(signalError); }
          try { await settle(() => holderClosed); } catch (closeError) { failures.push(closeError); }
        }
      }
      if (targetPid) { try { assert.ok(holderOutput.includes(`reaped ${targetPid}\n`), 'actual parent did not acknowledge its own waitpid'); nativeAbsence(targetPid); heldTargetAbsent = true; } catch (error) { failures.push(error); } }
      else if (holderClosed) heldTargetAbsent = true;
    }
    if (!holder) heldTargetAbsent = true;
    if (!cli) auxiliarySettled = true;
    if (!auxiliarySettled) {
      try {
        if (existsSync(timeoutMetadata)) {
          const auxiliary = JSON.parse(readFileSync(timeoutMetadata, 'utf8'));
          assert.ok(Number.isSafeInteger(auxiliary.pid) && auxiliary.pid > 0); assert.equal(auxiliary.parent, cli.pid);
          while (!auxiliarySettled && performance.now() < cleanupDeadline) {
            const answer = spawnSync('/bin/ps', ['-p', String(auxiliary.pid), '-o', 'pid=,stat='], { encoding: 'utf8', timeout: Math.max(1, Math.ceil(cleanupDeadline - performance.now())), killSignal: 'SIGKILL' });
            observations.push({ event: 'owned-read-child-final', pid: auxiliary.pid, result: packed(answer) });
            if (!answer.error && answer.stderr === '' && [0, 1].includes(answer.status)) {
              if (answer.stdout === '') { try { process.kill(auxiliary.pid, 0); } catch (error) { if (error.code === 'ESRCH') auxiliarySettled = true; else throw error; } }
              else if (new RegExp(`^[ \\t]*${auxiliary.pid}[ \\t]+Z[A-Za-z+<>]*[ \\t]*\\n?$`).test(answer.stdout)) auxiliarySettled = true;
            }
            if (!auxiliarySettled) await new Promise((resolve) => setImmediate(resolve));
          }
        } else if (cliClosed && cliClose?.signal === null) auxiliarySettled = true;
        if (!auxiliarySettled) throw new Error('owned target-read child ending remains unresolved');
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'direct reaper owned-child cleanup failed');
    return { cli: cliClose ?? null, target: targetClose ?? null, holder: holderClose ?? null, holderOutput, holderErrors };
  })();
  t.after(cleanup);
  let failure; let outcome; let traceRaw; let preparedZombie;
  try {
    const made = spawnSync('/usr/bin/mkfifo', [pipe], { encoding: 'utf8', timeout: 1_000 });
    assert.equal(made.status, 0, made.stderr); assert.equal(made.error, undefined);
    reader = openSync(pipe, constants.O_RDONLY | constants.O_NONBLOCK); writer = openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK);
    if (mode === 'zombie') {
      const program = join(directory, 'holder.pl'); writeFileSync(program, directReaperZombieSource);
      holder = spawn('/usr/bin/perl', [program], { stdio: ['pipe', 'pipe', 'pipe'] });
      holder.once('error', (error) => { holderError = error; }); holder.once('close', (code, signal) => { holderClosed = true; holderClose = { pid: holder.pid, code, signal }; });
      holder.stdin.on('error', (error) => { backgroundErrors.push(error); });
      holder.stdout.on('data', (chunk) => { holderOutput += chunk; }); holder.stderr.on('data', (chunk) => { holderErrors += chunk; });
      assert.ok(Number.isSafeInteger(holder.pid) && holder.pid > 0); holder.stdin.write(run + '\n');
      assert.equal(await until(() => {
        if (holderError) throw holderError;
        const row = /^holder ([0-9]+) target ([0-9]+)\n/.exec(holderOutput);
        if (!row) return false;
        assert.equal(Number(row[1]), holder.pid); targetPid = Number(row[2]); return Number.isSafeInteger(targetPid) && targetPid > 0;
      }, 10_000, t), true);
    } else {
      target = spawn('/usr/bin/tail', ['-f', join(run, 'hold')], { cwd: run, stdio: 'ignore' });
      target.once('error', (error) => { targetError = error; });
      target.once('close', (code, signal) => {
        targetClosed = true; targetClose = { pid: target.pid, code, signal };
        if (mode === 'absence') {
          try { assert.throws(() => process.kill(target.pid, 0), { code: 'ESRCH' });
            writeFileSync(closedMarker, JSON.stringify({ ...targetClose, absence: 'ESRCH' })); }
          catch (error) { backgroundErrors.push(error); }
        }
      });
      assert.ok(Number.isSafeInteger(target.pid) && target.pid > 0); targetPid = target.pid;
    }
    const expectedParent = holder?.pid ?? process.pid;
    assert.equal(await until(() => {
      if (targetError || holderError) throw targetError ?? holderError;
      const row = observed(targetPid, expectedParent);
      const cwd = spawnSync(LSOF, ['-nP', '-a', '-p', String(targetPid), '-d', 'cwd', '-Fpn'], { env: process.env, encoding: 'utf8', timeout: 1_000 });
      observations.push({ event: 'native-cwd-ready', pid: targetPid, result: packed(cwd) });
      return !row.state.startsWith('Z') && !cwd.error && cwd.status === 0 && cwd.stderr === '' && cwd.stdout.split('\n').includes(`n${run}`);
    }, 10_000, t), true);
    if (mode !== 'horizontal') {
      process.kill(targetPid, 'SIGSTOP');
      assert.equal(await until(() => observed(targetPid, expectedParent).state.startsWith('T'), 10_000, t), true);
    }
    const before = observed(targetPid, expectedParent); process.kill(targetPid, 0);
    const selected = spawnSync('/bin/ps', ['-p', String(targetPid), '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8', timeout: 1_000 });
    const cwd = spawnSync(LSOF, ['-nP', '-a', '-p', String(targetPid), '-d', 'cwd', '-Fpn'], { env: process.env, encoding: 'utf8', timeout: 1_000 });
    assert.equal(selected.status, 0); assert.equal(selected.error, undefined); assert.equal(selected.stderr, '');
    assert.equal(cwd.status, 0, cwd.stderr); assert.equal(cwd.error, undefined); assert.equal(cwd.stderr, '');
    assert.ok(cwd.stdout.split('\n').includes(`p${targetPid}`)); assert.ok(cwd.stdout.split('\n').includes(`n${run}`));
    if (mode === 'zombie') {
      holder.stdin.write('K');
      assert.equal(await until(() => {
        if (holderError || holderClosed) throw holderError ?? new Error('owned zombie parent ended during fixture setup');
        return holderOutput.includes(`kill ${targetPid} 1\n`) && observed(targetPid, holder.pid).state.startsWith('Z');
      }, 10_000, t), true);
      const zombie = observed(targetPid, holder.pid); const owner = observed(holder.pid, process.pid);
      assert.equal(zombie.birth, before.birth); assert.doesNotMatch(owner.state, /^Z/); process.kill(targetPid, 0); process.kill(holder.pid, 0);
      assert.ok(holderOutput.includes(`kill ${targetPid} 1\n`));
      preparedZombie = { zombie, owner, signalZero: true, cause: 'actual owner-native SIGKILL before CLI launch; historical discovery snapshot only' };
    }
    const control = { mode, cli: cliFile, pid: targetPid, realKill: positive, trace: traceFile, lsof: LSOF, selectedPS: selected.stdout, selectedCwd: cwd.stdout,
      started: before.birth, closedMarker, timeoutMetadata, psControl: `(${directReaperPSControl.toString()})().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });`,
      discoveryPS: ['-U', String(process.getuid()), '-o', 'pid=,ppid=,stat=,command='], discoveryCwd: ['-nP', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'],
      targetedPS: ['-ww', '-p', String(targetPid), '-o', 'pid=,stat=,lstart=,command='] };
    writeFileSync(configFile, JSON.stringify(control)); writeFileSync(preloadFile, `(${directReaperPreload.toString()})();`);
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    cli = spawn(process.execPath, ['--require', preloadFile, cliFile, run, pipe], { env: { ...env, RIGGER_919_CONFIG: configFile }, stdio: ['ignore', 'pipe', 'pipe'] });
    cli.once('error', (error) => { cliError = error; }); cli.once('close', (code, signal) => { cliClosed = true; cliClose = { pid: cli.pid, code, signal }; });
    cli.stdout.on('data', (chunk) => { output += chunk; }); cli.stderr.on('data', (chunk) => { errors += chunk; });
    assert.ok(Number.isSafeInteger(cli.pid) && cli.pid > 0);
    assert.equal(await until(() => {
      if (cliError) throw cliError;
      if (cliClosed) throw new Error(`standalone CLI closed before FIFO-reader proof: ${errors}`);
      const opened = spawnSync(LSOF, ['-nP', '-a', '-p', String(cli.pid), '-Ffn'], { env: process.env, encoding: 'utf8', timeout: 1_000 });
      observations.push({ event: 'native-fifo-open', cliPid: cli.pid, result: packed(opened) });
      if (!opened.error && opened.status === 0 && opened.stderr === '' && opened.stdout.split('\n').includes(`n${pipe}`)) { fifoOpen = packed(opened); return true; }
      return false;
    }, 10_000, t), true);
    closeSync(writer); writer = undefined; closeSync(reader); reader = undefined; fifoEOF = { writerClosed: true, readerClosed: true };
    assert.equal(await until(() => cliClosed, 10_000, t), true, 'standalone CLI did not settle after actual FIFO EOF');
    assert.equal(cliError, undefined);
    traceRaw = readFileSync(traceFile, 'utf8');
    const trace = traceRaw.trimEnd().split('\n').map((line) => JSON.parse(line));
    const requests = trace.filter(({ event }) => event === 'kill-request');
    assert.deepEqual(requests.map(({ pid, signal }) => ({ pid, signal })), [{ pid: targetPid, signal: 'SIGKILL' }], 'remembered target acquired signal authority');
    const discovery = trace.filter(({ event }) => event === 'discovery-ps');
    const needsSecondCensus = ['ack', 'horizontal', 'native', 'absence', 'zombie', 'changed-start'].includes(mode);
    assert.ok(discovery.length >= (needsSecondCensus ? 2 : 1) && discovery.length <= 11 && discovery[0].result.stdout.includes(String(targetPid)));
    if (discovery.length > 1) assert.equal(discovery[1].result.stdout, '');
    const cwdDiscovery = trace.filter(({ event }) => event === 'discovery-cwd');
    assert.equal(cwdDiscovery.length, discovery.length); assert.ok(cwdDiscovery[0].result.stdout.split('\n').includes(`n${run}`)); if (cwdDiscovery.length > 1) assert.equal(cwdDiscovery[1].result.stdout, '');
    const targeted = trace.filter(({ event }) => event === 'targeted');
    outcome = { mode, before, preparedZombie, cliPid: cli.pid, targetPid, holderPid: holder?.pid, status: cli.exitCode, output, errors, fifoOpen, fifoEOF, trace, removed: !existsSync(run) };
    if (positive) {
      assert.equal(cli.exitCode, 0, errors); assert.equal(existsSync(run), false);
      assert.equal(trace.filter(({ event }) => event === 'kill-ack-without-effect').length, 0);
      assert.equal(trace.filter(({ event }) => event === 'native-kill-answer').length, 1);
      if (mode === 'zombie') {
        const after = observed(targetPid, holder.pid); process.kill(targetPid, 0); process.kill(holder.pid, 0);
        assert.match(after.state, /^Z/); assert.equal(after.birth, before.birth); assert.equal(holderClosed, false);
        assert.equal(targeted[0].controlled, false);
        assert.ok(new RegExp(`^[ \\t]*${targetPid}[ \\t]+Z`, 'm').test(targeted[0].result.stdout), 'the first passive answer did not show the actual pre-held zombie');
        const ownerAfter = observed(holder.pid, process.pid); assert.doesNotMatch(ownerAfter.state, /^Z/); outcome.ownerAfter = ownerAfter;
        outcome.after = after; outcome.heldZombieSignalZero = true;
      } else {
        assert.equal(await until(() => targetClosed, 10_000, t), true); outcome.nativeAbsence = nativeAbsence(targetPid);
        if (mode === 'absence') {
          assert.ok(targeted.some(({ barrier, result }) => barrier?.pid === targetPid && barrier.absence === 'ESRCH' && [0, 1].includes(result.status) && result.stdout === '' && result.stderr === ''));
          assert.ok(trace.some(({ event, controlled, error }) => event === 'signal-zero' && !controlled && error === 'ESRCH'));
        }
      }
    } else {
      const after = observed(targetPid, expectedParent); process.kill(targetPid, 0);
      assert.equal(targetClosed, false); assert.deepEqual([after.parent, after.group, after.birth, after.command], [before.parent, before.group, before.birth, before.command]);
      if (mode === 'horizontal') assert.doesNotMatch(after.state, /^[ZTt]/); else assert.match(after.state, /^T/);
      assert.equal(trace.filter(({ event }) => event === 'kill-ack-without-effect').length, 1);
      assert.notEqual(cli.exitCode, 0, mode === 'ack' ? 'standalone CLI credited success while its owned stopped target remained alive' : 'standalone CLI credited success while its owned live target remained'); assert.equal(existsSync(run), true);
      assert.match(errors, new RegExp(String(targetPid))); outcome.after = after; outcome.nativeSignalZero = true;
      if (mode === 'ack' || mode === 'horizontal') { assert.match(errors, /observed targets unconfirmed/); assert.doesNotMatch(errors, /malformed|framing|changed/); }
      if (mode !== 'ack') assert.ok(targeted.some(({ controlled }) => controlled), 'declared target-read fault was not applied');
      const expected = { 'spawn-error': /error=ENOENT/, 'silent-nonzero': /status=2/, stderr: /controlled target PS warning/,
        malformed: /malformed/, 'wrong-pid': /malformed/, duplicate: /framing/, 'extra-lf': /framing/, vertical: /framing/,
        timeout: /ETIMEDOUT/, 'empty-live': /signal zero still reaches/, eperm: /EPERM/, 'changed-start': /changed its coarse start/ };
      if (expected[mode]) assert.match(errors, expected[mode]);
      if (mode === 'eperm') assert.equal(trace.filter(({ event, controlled, error }) => event === 'signal-zero' && controlled && error === 'EPERM').length, 1);
      if (mode === 'timeout') {
        const actual = JSON.parse(readFileSync(timeoutMetadata, 'utf8')); const returned = targeted.find(({ mode: answer }) => answer === 'timeout');
        assert.equal(actual.referenced, true); assert.equal(actual.parent, cli.pid); assert.equal(actual.actual.status, 0); assert.equal(actual.actual.stderr, '');
        assert.equal(actual.actual.signal, null); assert.equal(actual.actual.error, null);
        const heldRow = /^[ \t]*([0-9]+)[ \t]+([0-9]+)[ \t]+([A-Za-z][A-Za-z+<>]*)[ \t]*\n?$/.exec(actual.actual.stdout);
        assert.ok(heldRow, actual.actual.stdout); assert.equal(Number(heldRow[1]), actual.pid); assert.equal(Number(heldRow[2]), cli.pid);
        assert.doesNotMatch(heldRow[3], /^Z/);
        assert.equal(returned.result.pid, actual.pid); assert.equal(returned.result.error.code, 'ETIMEDOUT'); assert.equal(returned.result.signal, 'SIGKILL');
        outcome.ownedPS = { actual, returned, nativeAbsence: nativeAbsence(actual.pid) };
      }
    }
    assert.ok(targeted.length >= 1, 'no passive target observation followed the fresh signal loop');
    const signalAnswer = trace.find(({ event }) => event === (positive ? 'native-kill-answer' : 'kill-ack-without-effect'));
    assert.ok(signalAnswer); assert.ok(targeted.every(({ sequence, afterFreshSignal }) => afterFreshSignal && sequence > signalAnswer.sequence), 'target read preceded fresh signal completion');
    if (mode === 'changed-start') {
      assert.ok(targeted.length >= 2); const first = targeted[0];
      assert.equal(first.controlled, false); assert.equal(first.result.status, 0); assert.equal(first.result.signal, null); assert.equal(first.result.stderr, ''); assert.equal(first.result.error, null);
      const live = new RegExp(`^[ \\t]*${targetPid}[ \\t]+([A-Za-z][A-Za-z+<>]*)[ \\t]+`).exec(first.result.stdout);
      assert.ok(live, first.result.stdout); assert.doesNotMatch(live[1], /^Z/); assert.ok(first.result.stdout.includes(before.birth));
      assert.ok(targeted.slice(1).some(({ controlled }) => controlled), 'changed start was not applied after the actual post-ACK live baseline');
    }
  } catch (error) { failure = error; }
  let cleanupResult; let cleanupError;
  try { cleanupResult = await cleanup(); } catch (error) { cleanupError = error; }
  if (backgroundErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...backgroundErrors], 'original outcome and background observation errors');
  try {
    if (traceRaw === undefined && existsSync(traceFile)) traceRaw = readFileSync(traceFile, 'utf8');
    t.diagnostic(JSON.stringify({ ...(outcome ?? { mode, targetPid, cliPid: cli?.pid, output, errors }), traceRaw: traceRaw ?? null, observations, fifoOpen, fifoEOF,
    cleanup: cleanupResult ?? { failed: cleanupError?.message }, holderOutput, holderErrors,
    precision: 'lstart printed seconds are coarse; actual owned-child lifecycle and native state are the physical test premises, never new signal authority' })); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'outcome and final evidence retention failed') : error; }
  if (failure && cleanupError) throw new AggregateError([failure, cleanupError], 'direct reaper assertion and owned cleanup failed');
  if (cleanupError) throw cleanupError; if (failure) throw failure;
  return outcome;
}

test('R1 standalone reaper refuses success after discovery omits its still-stopped observed target', { timeout: 30_000 }, (t) => directReaperSelection(t, false));
test("R2 standalone reaper accepts confirmed native kill of its owned selected target", { timeout: 30_000 }, (t) => directReaperSelection(t, true));
test("R3 standalone reaper rejects an omitted running target with valid horizontal field padding", { timeout: 30_000 }, (t) => directReaperSelection(t, 'horizontal'));
test("R4 standalone reaper accepts an actual held zombie without waiting for its parent to reap", { timeout: 30_000 }, (t) => directReaperSelection(t, 'zombie'));
test("R5 standalone reaper requires actual direct-child close and ESRCH before clean targeted absence", { timeout: 30_000 }, (t) => directReaperSelection(t, 'absence'));
test("R6 standalone reaper rejects a controlled targeted spawn error", { timeout: 30_000 }, (t) => directReaperSelection(t, 'spawn-error'));
test("R6 standalone reaper rejects silent targeted nonzero status", { timeout: 30_000 }, (t) => directReaperSelection(t, 'silent-nonzero'));
test("R6 standalone reaper rejects stderr accompanying a successful targeted row", { timeout: 30_000 }, (t) => directReaperSelection(t, 'stderr'));
test("R6 standalone reaper rejects a malformed targeted row", { timeout: 30_000 }, (t) => directReaperSelection(t, 'malformed'));
test("R6 standalone reaper rejects a targeted row naming a different PID", { timeout: 30_000 }, (t) => directReaperSelection(t, 'wrong-pid'));
test("R6 standalone reaper rejects duplicate physical targeted rows", { timeout: 30_000 }, (t) => directReaperSelection(t, 'duplicate'));
test("R6 standalone reaper rejects an extra blank LF after a valid targeted row", { timeout: 30_000 }, (t) => directReaperSelection(t, 'extra-lf'));
test("R6 standalone reaper rejects vertical whitespace inside a targeted row", { timeout: 30_000 }, (t) => directReaperSelection(t, 'vertical'));
test("R6 standalone reaper times out and reaps its actual owned target-read stand-in", { timeout: 30_000 }, (t) => directReaperSelection(t, 'timeout'));
test("R7 standalone reaper rejects clean empty targeted output while native signal zero reaches the live target", { timeout: 30_000 }, (t) => directReaperSelection(t, 'empty-live'));
test("R7 standalone reaper treats controlled owned-target signal-zero EPERM as unknown", { timeout: 30_000 }, (t) => directReaperSelection(t, 'eperm'));
test("R8 standalone reaper rejects a controlled changed start field without remembered signal authority", { timeout: 30_000 }, (t) => directReaperSelection(t, 'changed-start'));
