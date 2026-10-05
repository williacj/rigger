// ABOUTME: Exercises the suite's cleanup after its shell dies while a test fixture still runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { scratch, sweep } from './process-fixtures.mjs';

const suite = resolve('test/suite.sh');
const fixtureModule = new URL('./process-fixtures.mjs', import.meta.url).href;
const agentModule = new URL('./stub-claude.mjs', import.meta.url).href;
const processModule = new URL('../src/substrate/process.mjs', import.meta.url).href;

function processesIn(directory) {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,stat=,command='], { encoding: 'utf8' });
  assert.equal(ps.status, 0, ps.stderr);
  const found = new Map();
  for (const line of ps.stdout.split('\n')) {
    const row = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (row && !row[2].startsWith('Z') && row[3].includes(directory)) found.set(Number(row[1]), `${row[1]} ${row[2]} ${row[3]}`);
  }
  const lsof = spawnSync('/usr/sbin/lsof', ['-nP', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], { encoding: 'utf8' });
  assert.ok(lsof.status === 0 || lsof.status === 1, lsof.stderr);
  let pid;
  for (const line of lsof.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && (line.slice(1) === directory || line.slice(1).startsWith(`${directory}/`)) && pid && !found.has(pid)) {
      found.set(pid, `${pid} cwd ${line.slice(1)}`);
    }
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

async function runEnding(t, ending, kind, { holdPidPublication = false } = {}) {
  const directory = scratch(t);
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const file = join(directory, 'holding.test.mjs');
  writeFileSync(file, [
    "import { test } from 'node:test';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `import { scratch, fixture, leave, leaveWorking, read, startGroup, tailIn, TAIL } from ${JSON.stringify(fixtureModule)};`,
    kind === 'F6' ? `import { installStandInAgent } from ${JSON.stringify(agentModule)};` : '',
    kind === 'F7' ? `import { runCommand } from ${JSON.stringify(processModule)};` : '',
    `test('holds a ${kind} fixture', { timeout: ${ending === 'E2' ? '1_000' : '600_000'} }, async (t) => {`,
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
    `  writeFileSync(${JSON.stringify(join(directory, 'started'))}, String(fixturePid));`,
    ...(holdPidPublication ? [
      `  writeFileSync(${JSON.stringify(join(directory, 'file-pid'))}, '');`,
      `  while (!existsSync(${JSON.stringify(join(directory, 'publish-pid'))})) await new Promise((resolve) => setImmediate(resolve));`,
    ] : []),
    `  writeFileSync(${JSON.stringify(join(directory, 'file-pid'))}, String(process.pid));`,
    ending === 'E1' ? `  while (!existsSync(${JSON.stringify(join(directory, 'go'))})) await new Promise((resolve) => setImmediate(resolve));\n  ${kind === 'F6' ? 'agent.release(1);' : "writeFileSync(directory + '/release', '');"}\n  ${kind === 'F7' ? 'await dispatch;' : ''}` : '  await new Promise(() => {});',
    '});',
  ].join('\n'));
  const output = join(directory, 'suite-output');
  const fd = openSync(output, 'w');
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const child = spawn('/bin/sh', [suite, file], { cwd: resolve('.'), env: { ...env, TMPDIR: tmp }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    sweep(directory);
  });
  assert.equal(await until(() => existsSync(join(directory, 'started')), 10_000, t), true, `the fixture never started:\n${readFileSync(output, 'utf8')}`);
  const [runName] = readdirSync(tmp).filter((name) => name.startsWith('rigger-suite.') || name.startsWith('rigger-refusing-gh.'));
  assert.ok(runName, `the suite made no run directory under ${tmp}`);
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
    }, 10_000, t), true, `the test file wrote no positive pid: ${readFileSync(output, 'utf8')}`);
    assert.notEqual(filePid, process.pid, 'the nested test file named the test hosting this one');
    const target = spawnSync('/bin/ps', ['-p', String(filePid), '-o', 'command='], { encoding: 'utf8' });
    assert.ok(target.stdout.includes(file), `the recorded pid no longer names the nested test file: ${target.stdout}`);
    process.kill(filePid, 'SIGKILL');
  }
  const removed = await until(() => !existsSync(join(tmp, runName)), 10_000, t);
  const left = processesIn(tmp);
  assert.deepEqual(left, [], `processes from ${tmp} survived: ${left.join('\n')}\n${readFileSync(output, 'utf8')}`);
  assert.equal(removed, true, `the suite left ${join(tmp, runName)}: ${readFileSync(output, 'utf8')}`);
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
