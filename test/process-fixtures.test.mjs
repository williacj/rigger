// ABOUTME: Tests the process fixtures' own bounds: a condition wait whose test has ended, failed or
// timed out, no longer holds the test file's process open, and the teardown that kills a scratch
// directory's processes ends, naming any it could not kill.
// It also qualifies native process-table outcomes and a warm runner under a path containing a space.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync, accessSync, constants } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ownedChild, scratch, sweep } from './process-fixtures.mjs';
import { literally, running } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { fixture } from './process-fixtures.mjs';
import { onPath } from './on-path.mjs';

test('process fixtures execute the Bash file substitutions used by census controls', (t) => {
  const directory = scratch(t);
  writeFileSync(join(directory, 'answer'), 'tail');
  const path = fixture(directory, 'read-answer', 'answer=$(< "$here/answer"); printf "%s" "$answer"');
  const result = spawnSync(path, [], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'tail');
});


test('a process search excludes the caller whose command line contains the search text', () => {
  const code = `import { running } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)}; console.log(JSON.stringify({ pid: process.pid, found: running(process.argv[1]) }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, 'rigger-process-search-observer'], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  const { pid, found } = JSON.parse(result.stdout);
  assert.equal(found.includes(String(pid)), false, 'the process observer counted itself as a fixture');
});

test('warm runner resolves its module path when the checkout path contains a space', async (t) => {
  const directory = temporaryDirectory('rigger fixture space ', { context: t });
  for (const name of ['process-fixtures.mjs', 'temporary-directory.mjs', 'on-path.mjs']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(directory, name));
  }
  const fixtures = await import(pathToFileURL(join(directory, 'process-fixtures.mjs')).href);
  fixtures.beginFixtureWarmBatch(directory);
  fixtures.fixture(directory, 'warm-control', 'exit 0');
  assert.doesNotThrow(() => fixtures.finishFixtureWarmBatch(directory));
});

/**
 * How long a test file of two tests, each ending while its wait is unmet, is given to exit. A
 * judgment: its premise is that such a file, run alone under `node --test`, exits in well under a
 * second, and a wait that holds it open holds it for ever, so any bound past the first tells the
 * two apart.
 */
const EXITS_WITHIN = 10_000;

/**
 * A test file in `directory` of two tests, each ending while `until` waits on a condition that
 * never holds: one fails, as a verb that ends before its forge read fails, and one reaches its
 * timeout. The file's path names the directory, so the teardown ends any process running it.
 */
function waitingTests(directory) {
  const path = join(directory, 'waiting.test.mjs');
  writeFileSync(path, [
    "import { test } from 'node:test';",
    `import { until } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};`,
    "test('fails while its wait is unmet', async (t) => {",
    "  await Promise.race([until(() => false, t), Promise.reject(new Error('the command ended first'))]);",
    '});',
    "test('times out while its wait is unmet', { timeout: 100 }, async (t) => {",
    '  await until(() => false, t);',
    '});',
  ].join('\n'));
  return path;
}

test('given a test file whose tests end, one failing and one timed out, while each waits on a condition that never holds, the file\'s process exits reporting both failed', (t) => {
  const directory = scratch(t);
  const file = waitingTests(directory);

  // Without the runner's own mark, which would have the file report to this runner, not print.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env, timeout: EXITS_WITHIN });

  // `spawnSync` sets `ETIMEDOUT` where the bound ended the file, which Node's runner may meet by
  // exiting with a code of its own rather than by the signal.
  assert.equal(ran.error?.code, undefined, `the test file had not exited after ${EXITS_WITHIN} ms: ${ran.stdout}`);
  assert.equal(ran.status, 1, ran.stdout);
  assert.equal(ran.stdout.match(/^not ok \d+ - /gm)?.length, 2, ran.stdout);
});

test('given a process the teardown\'s pkill cannot kill, which pgrep lists however often it is killed, the teardown ends and fails naming it', (t) => {
  // Nothing runs naming a fresh scratch directory, so the teardown's own pkill kills nothing here.
  const directory = scratch(t);
  let asked = 0;
  const unkillable = () => {
    asked += 1;
    if (asked > 1_000) throw new Error(`the teardown asked for the processes left ${asked} times, and would never have ended`);
    return ['4242'];
  };

  assert.throws(() => sweep(directory, unkillable), (error) => {
    assert.match(error.message, /\b4242\b/);
    assert.ok(error.message.includes(directory), error.message);
    return true;
  });
});




test('PATH resolver skips an executable directory named like the command', (t) => {
  const directory = temporaryDirectory('rigger git path ', { context: t });
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  mkdirSync(first);
  mkdirSync(second);
  mkdirSync(join(first, 'git'));
  const executable = join(second, 'git');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(onPath('git', [first, second].join(delimiter)), executable);
});

function importGitOnPath(path, cwd) {
  const source = `import { GIT } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)}; console.log(GIT);`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd, env: { ...process.env, PATH: path }, encoding: 'utf8',
  });
}

test('fixture Git lookup treats an empty PATH entry as the current directory', (t) => {
  const directory = temporaryDirectory('rigger git cwd ', { context: t });
  const executable = join(directory, 'git');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const imported = importGitOnPath('', directory);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), executable);
});

test('fixture Git lookup selects the first executable file and skips a preceding directory', (t) => {
  const directory = temporaryDirectory('rigger git order ', { context: t });
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const firstGit = join(first, 'git');
  const secondGit = join(second, 'git');
  writeFileSync(firstGit, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(secondGit, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const order = [first, second].join(delimiter);
  const imported = importGitOnPath(order, directory);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), firstGit);

  const before = join(directory, 'before');
  mkdirSync(before);
  mkdirSync(join(before, 'git'));
  const skipped = importGitOnPath([before, first].join(delimiter), directory);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout.trim(), firstGit);
});

test('fixture Git lookup skips a regular file without execute permission', (t) => {
  const directory = temporaryDirectory('rigger git mode ', { context: t });
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const noExec = join(first, 'git');
  const executable = join(second, 'git');
  writeFileSync(noExec, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    accessSync(noExec, constants.X_OK);
    t.skip('this host does not distinguish X_OK on a non-executable regular file');
    return;
  } catch {
    // This host distinguishes the two files, so the selection is observable.
  }
  const imported = importGitOnPath([first, second].join(delimiter), directory);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), executable);
});

test('fixture Git lookup names PATH when no executable Git exists', (t) => {
  const directory = temporaryDirectory('rigger no git ', { context: t });
  const imported = importGitOnPath(directory, directory);
  assert.notEqual(imported.status, 0);
  assert.match(imported.stderr, /git is not executable on PATH/);
});

test('importing process fixtures starts no child process', (t) => {
  const directory = temporaryDirectory('rigger git import ', { context: t });
  const executable = join(directory, 'git');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const source = [
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) childProcess[name] = () => { throw new Error(`import spawned via ${name}`); };",
    'syncBuiltinESMExports();',
    `await import(${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)});`,
    "console.log('imported');",
  ].join('\n');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: directory, env: { ...process.env, PATH: directory }, encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), 'imported');
});

test('Git stand-in hands a spaced selected path to the exact executable', (t) => {
  const directory = temporaryDirectory('rigger git handoff ', { context: t });
  const selected = join(directory, 'real git with spaces');
  mkdirSync(selected);
  const executable = join(selected, 'git');
  writeFileSync(executable, '#!/bin/sh\nprintf "selected:%s\\n" "$1"\nexit 23\n', { mode: 0o755 });
  const source = [
    `import { GIT, gitRecording } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};`,
    "import { spawnSync } from 'node:child_process';",
    `const standIn = gitRecording(${JSON.stringify(directory)});`,
    "const ran = spawnSync(standIn, ['probe'], { encoding: 'utf8', env: process.env });",
    "console.log(JSON.stringify({ selected: GIT, status: ran.status, stdout: ran.stdout }));",
  ].join('\n');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: directory, env: { ...process.env, PATH: selected }, encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(JSON.parse(imported.stdout.trim()), {
    selected: executable,
    status: 23,
    stdout: 'selected:probe\n',
  });
});

test('PATH resolver preserves skip-directory selection for existing callers', (t) => {
  const directory = temporaryDirectory('rigger git skipping ', { context: t });
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const firstGit = join(first, 'git');
  const secondGit = join(second, 'git');
  writeFileSync(firstGit, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(secondGit, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(onPath('git', [first, second].join(delimiter), first), secondGit);
});

// Host reason: OS behaviour; the PS result for a reaped owned child depends on no Rigger decision.
test('PS no-match result is qualified against an independently reaped owned child', (t) => {
  const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  const state = spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'stat='], { encoding: 'utf8' });
  t.diagnostic(JSON.stringify({ producer: '/bin/ps -p PID -o stat=', ownedPid: child.pid, ...state, error: state.error ? { ...state.error, message: state.error.message } : null }));
  assert.equal(state.error, undefined);
  assert.equal(state.signal, null);
  assert.equal(state.status, 1, 'PS no-match convention changed for an independently reaped child');
  assert.equal(state.stdout, '');
  assert.equal(state.stderr, '');
});

// Host reason: OS behaviour.
// Ordinary decision counterpart: test/fixture-lifetime.test.mjs :: pgrep observation preserves valid PID strings and only qualified no-match is empty.
test('pgrep match and no-match results are qualified against an owned live then closed child', async (t) => {
  const directory = scratch(t);
  const hold = join(directory, 'hold');
  writeFileSync(hold, '');
  const child = spawn('/usr/bin/tail', ['-f', hold], { stdio: 'ignore' });
  const closed = once(child, 'close');
  closed.catch(() => {});
  try {
    await once(child, 'spawn');
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
    const args = [...(process.platform === 'linux' ? ['-A'] : []), '-f', literally(directory)];
    const matched = spawnSync('/usr/bin/pgrep', args, { encoding: 'utf8' });
    t.diagnostic(JSON.stringify({ producer: '/usr/bin/pgrep', args, ownedPid: child.pid, ...matched, error: matched.error ? { ...matched.error, message: matched.error.message } : null }));
    assert.equal(matched.error, undefined);
    assert.equal(matched.signal, null);
    assert.equal(matched.status, 0);
    assert.equal(matched.stderr, '');
    assert.equal(matched.stdout, String(child.pid) + '\n');
    assert.deepEqual(running(directory), [String(child.pid)]);
    child.kill('SIGKILL');
    await closed;
    const absent = spawnSync('/usr/bin/pgrep', args, { encoding: 'utf8' });
    t.diagnostic(JSON.stringify({ producer: '/usr/bin/pgrep', args, ownedPid: child.pid, ...absent, error: absent.error ? { ...absent.error, message: absent.error.message } : null }));
    assert.equal(absent.error, undefined);
    assert.equal(absent.signal, null);
    assert.equal(absent.status, 1);
    assert.equal(absent.stdout, '');
    assert.equal(absent.stderr, '');
    assert.deepEqual(running(directory), []);
  } finally {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) child.kill('SIGKILL');
    await closed;
  }
});

// Host reason: OS behaviour.
// Ordinary decision counterpart: test/fixture-lifetime.test.mjs :: failed spawn retains its error and observes close without kill or an exit wait.
test('owned failed-spawn teardown observes native close and preserves a late-consumed error', async (t) => {
  const directory = scratch(t);
  const child = spawn(join(directory, 'missing-cli'), [], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const trace = [];
  let spawnFailure;
  let exits = 0;
  let kills = 0;
  const originalKill = child.kill;
  child.kill = function (...args) { kills += 1; return originalKill.apply(this, args); };
  child.once('error', (error) => { spawnFailure = error; trace.push('error'); });
  child.once('exit', () => { exits += 1; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => { trace.push('close'); resolve([code, signal]); }));
  const hooks = [];
  let ownerCalls = 0;
  const result = ownedChild({ after: (hook) => hooks.push(hook) }, child, () => { ownerCalls += 1; });
  const cleanup = hooks[0]();
  cleanup.catch(() => {});
  const unhandled = [];
  const rejected = (error) => unhandled.push(error);
  process.on('unhandledRejection', rejected);
  try {
    const ending = await closed;
    // Let Node finish its rejection-observation turn before consuming the retained result.
    await new Promise(setImmediate);
    assert.deepEqual(unhandled, []);
    assert.equal(spawnFailure?.code, 'ENOENT');
    assert.equal(child.pid, undefined);
    assert.equal(exits, 0);
    assert.equal(kills, 0);
    assert.equal(ownerCalls, 1);
    assert.deepEqual(trace, ['error', 'close']);
    await assert.rejects(result, (error) => error === spawnFailure);
    await assert.rejects(cleanup, (error) => error === spawnFailure);
    t.diagnostic(JSON.stringify({ attempted: child.spawnfile, pid: child.pid ?? null, error: { message: spawnFailure.message, code: spawnFailure.code }, close: ending, exits, kills, ownerCalls, unhandled: unhandled.length }));
  } finally {
    process.removeListener('unhandledRejection', rejected);
    await closed;
    await result.catch(() => {});
    await cleanup.catch(() => {});
  }
});

// Host reason: real deadline; the existing EXITS_WITHIN bounds the abnormal fixture runner.
// Ordinary decision counterpart: test/fixture-lifetime.test.mjs :: owned teardown stays pending through exit and owner cleanup until recorded close.
test('abnormal caller teardown observes native close and final stand-in cleanup before deferred removal', (t) => {
  const directory = temporaryDirectory('rigger-owned-lifetime-', { context: t });
  const report = join(directory, 'report.json');
  writeFileSync(join(directory, 'owned-cli.mjs'), [
    '// ABOUTME: A live owned CLI that launches fixture work only when teardown releases its input gate.',
    "import { spawn } from 'node:child_process';",
    "import { closeSync, openSync, renameSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const owner = process.env.OWNER_DIRECTORY;',
    'const control = process.env.PROOF_DIRECTORY;',
    "const publishPid = (name, pid, hold = false) => {",
    "  const pending = join(control, name + '.pending');",
    "  const fd = openSync(pending, 'w');",
    "  const complete = () => {",
    "    try { writeFileSync(fd, String(pid)); } finally { closeSync(fd); }",
    "    renameSync(pending, join(control, name));",
    "    if (hold) writeFileSync(join(control, 'late-written'), '');",
    "  };",
    "  if (hold) {",
    "    process.stderr.write(JSON.stringify({ event: 'publication-opened', name, pid }) + '\\n');",
    "    process.stdin.once('data', complete);",
    "    writeFileSync(join(control, 'late-file-open'), '');",
    "  } else complete();",
    "};",
    'process.stdin.resume();',
    "process.stdin.once('data', () => {",
    "  const child = spawn('/usr/bin/tail', ['-f', join(owner, 'hold')], { stdio: 'ignore', detached: true });",
    "  child.once('spawn', () => publishPid('late-pid', child.pid, true));",
    "  child.once('error', (error) => { process.stderr.write(error.stack); process.exitCode = 1; });",
    '});',
    "publishPid('cli-ready', process.pid);",
  ].join('\n'));
  const file = join(directory, 'abnormal.test.mjs');
  writeFileSync(file, [
    '// ABOUTME: An abnormal real test caller whose registered teardown must observe owner cleanup and close.',
    "import { test, after } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { spawn } from 'node:child_process';",
    "import { once } from 'node:events';",
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'import { ended, ownedChild, running, sweep, until } from ' + JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href) + ';',
    'import { standInAgent } from ' + JSON.stringify(new URL('./stub-claude.mjs', import.meta.url).href) + ';',
    'const control = process.env.PROOF_DIRECTORY;',
    "const trace = [];",

    "const record = (entry) => { trace.push(entry); appendFileSync(join(control, 'trace.jsonl'), JSON.stringify(entry) + '\\n'); };",
    'let agent, earlyPid, cliPid, latePid;',
    "let cliOut = '', cliErr = '';",
    "test('abnormal fixture caller', { timeout: " + EXITS_WITHIN + " }, async (t) => {",
    '  agent = standInAgent();',
    "  writeFileSync(join(agent.dir, 'hold'), '');",
    "  const early = spawn('/usr/bin/tail', ['-f', join(agent.dir, 'hold')], { stdio: 'ignore' });",
    '  earlyPid = early.pid;',
    "  record({ event: 'early-registered', pid: earlyPid });",
    "  const earlyClosed = once(early, 'close');",
    '  earlyClosed.catch(() => {});',
    "  t.after(async () => {",
    "    let phase = 'early-close';",
    "    let failed = false;",
    "    record({ event: 'intermediate-hook-entry' });",
    "    try {",
    "    record({ event: 'early-close-before' });",
    '    await earlyClosed;',
    "    record({ event: 'early-close-after' });",
    "    record({ event: 'early-owner-cleanup', remaining: running(agent.dir) });",
    '    assert.deepEqual(running(agent.dir), []);',
    "    phase = 'launch';",
    "    record({ event: 'launch-before' });",
    "    child.stdin.write('launch');",
    "    record({ event: 'launch-after' });",
    "    await until(() => existsSync(join(control, 'late-file-open')), t);",
    "    phase = 'publication-check';",
    "    record({ event: 'publication-held', visible: existsSync(join(control, 'late-pid')) });",
    "    assert.equal(existsSync(join(control, 'late-pid')), false, 'late PID became visible before complete publication');",
    "    child.stdin.write('publish');",
    "    record({ event: 'publication-release' });",
    "    await until(() => existsSync(join(control, 'late-written')), t);",
    "    record({ event: 'publication-complete', raw: readFileSync(join(control, 'late-pid'), 'utf8') });",
    "    phase = 'late-pid-read';",
    "    record({ event: 'late-read-before', raw: existsSync(join(control, 'late-pid')) ? readFileSync(join(control, 'late-pid'), 'utf8') : null });",
    "    await until(() => existsSync(join(control, 'late-pid')), t);",
    "    latePid = Number(readFileSync(join(control, 'late-pid'), 'utf8'));",
    "    record({ event: 'late-read-after', parsed: latePid });",
    '    assert.ok(Number.isSafeInteger(latePid) && latePid > 0);',
    '    assert.ok(running(agent.dir).includes(String(latePid)));',
    "    record({ event: 'late-fixture', pid: latePid });",
    "    record({ event: 'intermediate-hook-complete' });",
    "    } catch (error) {",
    "      record({ event: 'intermediate-hook-error', phase, message: error.message, code: error.code, actual: error.actual, expected: error.expected });",
    "      failed = true;",
    "      throw error;",
    "    } finally {",
    "      if (failed) {",
    "        record({ event: 'fallback-cleanup-entry' });",
    "        try {",
    "          if (existsSync(join(control, 'late-file-open')) && !existsSync(join(control, 'late-written'))) {",
    "          child.stdin.write('publish');",
    "          record({ event: 'publication-release' });",
    "          await until(() => existsSync(join(control, 'late-written')), t);",
    "          record({ event: 'publication-complete', raw: readFileSync(join(control, 'late-pid'), 'utf8') });",
    "          }",
    "        } finally {",
    "          await ended(child);",
    "          await cliClosed;",
    "          record({ event: 'fallback-cli-closed', pid: child.pid });",
    "          sweep(agent.dir);",
    "          await earlyClosed;",
    "          record({ event: 'fallback-cleanup-complete', remaining: running(agent.dir) });",
    "        }",
    "      }",
    "    }",
    '  });',
    "  const child = spawn(process.execPath, [join(control, 'owned-cli.mjs')], { env: { ...process.env, OWNER_DIRECTORY: agent.dir }, stdio: ['pipe', 'pipe', 'pipe'] });",
    "  cliPid = child.pid;",
    "  record({ event: 'cli-registered', pid: cliPid });",
    "  const cliClosed = once(child, 'close');",
    "  cliClosed.catch(() => {});",
    "  const lifecycle = { after: (hook) => t.after(async () => { record({ event: 'registered-owned-hook-entry' }); try { await hook(); } catch (error) { record({ event: 'registered-owned-hook-error', message: error.message, code: error.code }); throw error; } finally { record({ event: 'registered-owned-hook-exit' }); } }) };",
    "  child.once('exit', (code, signal) => record({ event: 'exit', pid: child.pid, code, signal }));",
    "  child.once('close', (code, signal) => record({ event: 'close', pid: child.pid, code, signal }));",
    "  ownedChild(lifecycle, child, () => { record({ event: 'final-owner' }); sweep(agent.dir); record({ event: 'final-owner-done' }); });",
    "  child.stdout.on('data', (chunk) => { cliOut += chunk; });",
    "  child.stderr.on('data', (chunk) => { cliErr += chunk; });",
    '  t.after(() => {',
    "    assert.ok(trace.some(({ event }) => event === 'exit'));",
    "    assert.ok(trace.some(({ event }) => event === 'close'));",
    '    assert.deepEqual(running(agent.dir), []);',
    '    assert.equal(existsSync(agent.dir), true);',
    "    record({ event: 'cleanup-complete' });",
    '  });',
    "  writeFileSync(join(control, 'owner.json'), JSON.stringify({ agentDir: agent.dir, cliPid, earlyPid }));",
    "  await once(early, 'spawn');",
    "  await until(() => existsSync(join(control, 'cli-ready')), t);",
    "  assert.equal(Number(readFileSync(join(control, 'cli-ready'), 'utf8')), cliPid);",
    '  assert.ok(running(agent.dir).includes(String(earlyPid)));',
    '  assert.equal(running(agent.dir).includes(String(cliPid)), false);',
    "  throw new Error('abnormal caller ended');",
    '});',
    "after(() => { record({ event: 'report-before' }); record({ event: 'removed', absent: agent !== undefined && !existsSync(agent.dir) }); writeFileSync(join(control, 'report.json'), JSON.stringify({ agentDir: agent?.dir, cliPid, earlyPid, latePid, cliOut, cliErr, trace })); record({ event: 'report-complete' }); });",
  ].join('\n'));
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  try {
    const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env: { ...env, PROOF_DIRECTORY: directory }, timeout: EXITS_WITHIN });
    t.diagnostic(JSON.stringify({ runnerPid: ran.pid, status: ran.status, signal: ran.signal, error: ran.error ? { ...ran.error, message: ran.error.message } : null, stdout: ran.stdout, stderr: ran.stderr }));
    for (const artifact of ['report.json', 'trace.jsonl', 'owner.json']) {
      const path = join(directory, artifact);
      t.diagnostic(JSON.stringify({ artifact, available: existsSync(path), content: existsSync(path) ? readFileSync(path, 'utf8') : null }));
    }
    assert.equal(ran.error, undefined);
    assert.equal(ran.signal, null);
    assert.equal(ran.status, 1, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /abnormal caller ended/);
    const proof = JSON.parse(readFileSync(report, 'utf8'));
    t.diagnostic(JSON.stringify(proof));
    assert.deepEqual(proof.trace.filter(({ event }) => event.endsWith('hook-error')), [], 'unexpected fixture teardown hook failure');
    for (const pid of [proof.earlyPid, proof.cliPid, proof.latePid]) assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const at = (name) => proof.trace.findIndex(({ event }) => event === name);
    for (const event of ['early-owner-cleanup', 'late-fixture', 'exit', 'close', 'final-owner', 'final-owner-done', 'cleanup-complete', 'removed']) assert.ok(at(event) >= 0, event);
    assert.ok(at('early-owner-cleanup') < at('late-fixture'));
    assert.ok(at('late-fixture') < at('exit'));
    assert.ok(at('exit') < at('final-owner'));
    assert.ok(at('final-owner') < at('final-owner-done'));
    assert.ok(at('final-owner-done') < at('cleanup-complete'));
    assert.ok(at('close') < at('cleanup-complete'));
    assert.ok(at('cleanup-complete') < at('removed'));
    assert.deepEqual(proof.trace[at('early-owner-cleanup')].remaining, []);
    assert.equal(proof.trace[at('removed')].absent, true);
  } finally {
    sweep(directory);
    const owner = join(directory, 'owner.json');
    if (existsSync(owner)) sweep(JSON.parse(readFileSync(owner, 'utf8')).agentDir);
  }
});
