// ABOUTME: Exercises the suite's cleanup after its shell dies while a test fixture still runs.

import { LSOF } from '../src/substrate/process.mjs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname, isAbsolute, relative, sep } from 'node:path';

import { scratch, sweep } from './process-fixtures.mjs';
import { ended } from './process-fixtures.mjs';

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
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const child = spawn('/bin/sh', [suite, '--host', ...(ending === 'E2' ? ['--test-reporter=tap'] : []), file], { cwd: resolve('.'), env: { ...env, TMPDIR: tmp }, detached: true, stdio: ['ignore', fd, fd] });
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
