// ABOUTME: Tests the suite's two tiers, its list contract and the process bounds they enforce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
import { reaped } from './process-fixtures.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

if (process.env.RIGGER_SUITE_IMPORT_MARKER) {
  writeFileSync(process.env.RIGGER_SUITE_IMPORT_MARKER, 'loaded');
}

function runProbe(t, source, files = {}, extraEnvironment = {}) {
  const directory = temporaryDirectory('rigger-suite-probe-', { context: t });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  const file = join(directory, 'probe.test.mjs');
  writeFileSync(file, `import { test } from 'node:test';\n${source}\n`);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync('sh', ['test/suite.sh', file], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...environment, ...extraEnvironment },
  });
  return { directory, result };
}

function hostProbe(t, source, { awaiting = false, env = {} } = {}) {
  const directory = temporaryDirectory('rigger-host-probe-', { context: t });
  const file = join(directory, 'probe.test.mjs');
  writeFileSync(file, "import { test } from 'node:test';\n" + source + '\n');
  let script = readFileSync('test/suite.sh', 'utf8');
  script = script.replace(/host_tests='[\s\S]*?'/, "host_tests='\n" + file + "\n'");
  if (awaiting) script = script.replace(/awaiting_tests='[\s\S]*?'/, "awaiting_tests='\n" + file + "\n'");
  const copy = join(directory, 'suite.sh');
  writeFileSync(copy, script);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync('sh', [copy, '--host', file], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...environment, ...env },
  });
  return { directory, file, suite: copy, result };
}

function reportsPassedTest(output, title) {
  return output.split('\n').some((line) =>
    line.startsWith(`✔ ${title} (`) ||
    (/^ok [0-9]+ - /.test(line) && line.replace(/^ok [0-9]+ - /, '') === title));
}

test('pass reports accept spec and TAP while excluding a TAP skip', (t) => {
  const source = "import { spawnSync } from 'node:child_process';\ntest('selected', () => { spawnSync('git', ['--version']); });\ntest('excluded', () => { spawnSync('git', ['--version']); });";
  const { file, suite, result: spec } = hostProbe(t, source);
  assert.equal(spec.status, 0, spec.stdout + spec.stderr);
  assert.equal(reportsPassedTest(spec.stdout, 'selected'), true, spec.stdout);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const tap = spawnSync('sh', [suite, '--host', '--test-reporter=tap', '--test-name-pattern=selected', file], {
    encoding: 'utf8', env: environment, timeout: 60_000,
  });
  assert.equal(tap.status, 0, tap.stdout + tap.stderr);
  assert.equal(reportsPassedTest(tap.stdout, 'selected'), true, tap.stdout);
  assert.equal(reportsPassedTest(tap.stdout, 'excluded'), false, tap.stdout);
});

const originalHost = [
  'test/codex-judge-shell.test.mjs',
  'test/command-gate-hook.test.mjs',
  'test/demo.test.mjs',
  'test/directory-census.test.mjs',
  'test/dispatch.test.mjs',
  'test/doctor-claude-live.test.mjs',
  'test/event-sink.test.mjs',
  'test/exit-cleanup.test.mjs',
  'test/forge-runners.test.mjs',
  'test/forge-spawn.test.mjs',
  'test/guard-probe-kill.test.mjs',
  'test/init.test.mjs',
  'test/judge-head-live.test.mjs',
  'test/kill-recorded.test.mjs',
  'test/listing-stand-in.test.mjs',
  'test/maker-dispatch.test.mjs',
  'test/never-stop.test.mjs',
  'test/package.test.mjs',
  'test/process-adapter.test.mjs',
  'test/process-fixtures.test.mjs',
  'test/provider-claude-installed-live.test.mjs',
  'test/provider-claude-live.test.mjs',
  'test/provider-claude-reach-live.test.mjs',
  'test/provider-codex-live.test.mjs',
  'test/push-hook.test.mjs',
  'test/read-deadline.test.mjs',
  'test/record-commit.test.mjs',
  'test/restart-concurrency.test.mjs',
  'test/restart-kill.test.mjs',
  'test/stand-in-agent.test.mjs',
  'test/step-restart-kill.test.mjs',
  'test/suite-reaper.test.mjs',
  'test/suite-record.test.mjs',
  'test/verb-forge-kill.test.mjs',
  'test/workflow-files.test.mjs',
  'test/worktrees.test.mjs',
];
const originalConverting = [
  'test/absorption-check.test.mjs',
  'test/attempt.test.mjs',
  'test/budget-checks.test.mjs',
  'test/build-test-matrix.test.mjs',
  'test/cli.test.mjs',
  'test/command-gate.test.mjs',
  'test/doctor.test.mjs',
  'test/environment-retry.test.mjs',
  'test/facts-pull.test.mjs',
  'test/fake-gh.test.mjs',
  'test/foreground-suite-settle.test.mjs',
  'test/forge-board-sharing.test.mjs',
  'test/forge-contract.test.mjs',
  'test/forge-priority.test.mjs',
  'test/forge-read.test.mjs',
  'test/gate-check.test.mjs',
  'test/git-environment.test.mjs',
  'test/judge-directory.test.mjs',
  'test/judge-dispatch.test.mjs',
  'test/judge-head-cleanup.test.mjs',
  'test/lane.test.mjs',
  'test/loop-world.test.mjs',
  'test/loop.test.mjs',
  'test/mixed-judges.test.mjs',
  'test/once.test.mjs',
  'test/package-budget.test.mjs',
  'test/plan.test.mjs',
  'test/provider-contract.test.mjs',
  'test/pull-outcomes.test.mjs',
  'test/redo-settle.test.mjs',
  'test/report.test.mjs',
  'test/restart.test.mjs',
  'test/retry.test.mjs',
  'test/role-dispatch.test.mjs',
  'test/run.test.mjs',
  'test/scratch-teardown.test.mjs',
  'test/self-hosting-check.test.mjs',
  'test/settle.test.mjs',
  'test/setup-board.test.mjs',
  'test/spec-style-lint.test.mjs',
  'test/stand-in-warming.test.mjs',
  'test/step-run.test.mjs',
  'test/temporary-directory.test.mjs',
  'test/transitions.test.mjs',
  'test/verb-facts.test.mjs',
  'test/verbs-judges.test.mjs',
  'test/verbs-provision.test.mjs',
  'test/workspace.test.mjs',
  'test/worktree-root-inside.test.mjs',
];
const expectedLists = {
  host: [...originalHost, 'test/suite-tiers.test.mjs'].sort(),
  awaiting: originalHost,
  converting: originalConverting,
};
expectedLists.host.push('test/process-table.test.mjs');
expectedLists.host.push('test/call-events.test.mjs');
expectedLists.host.push('test/claude-folder-live.test.mjs');
expectedLists.host.push('test/test-list-growth-host.test.mjs');
expectedLists.host.push('test/build-test-matrix-host.test.mjs');
expectedLists.host.push('test/mutation-receipt.test.mjs');
expectedLists.host.push('test/proof-diff.test.mjs');
expectedLists.host.push('test/path-spelling.test.mjs');
expectedLists.host.push('test/printable-closer-verbs.test.mjs');
expectedLists.host.push('test/coordinator-launchers.test.mjs');
expectedLists.host.push('test/coordinator-suite-slot.test.mjs');
expectedLists.host.push('test/coordinator-sweep.test.mjs');
expectedLists.host.push('test/escalation-directory-host.test.mjs');
expectedLists.host.push('test/escalation-loop-host.test.mjs');
expectedLists.host.push('test/escalation-once-host.test.mjs');
expectedLists.host.push('test/launchd-host.test.mjs');
expectedLists.host.push('test/hold-close-verbs.test.mjs');
expectedLists.host.push('test/loop-host.test.mjs');
expectedLists.host.push('test/in-process-fixtures-host.test.mjs');
expectedLists.host.push('test/provider-codex-host.test.mjs');
expectedLists.host.sort();
expectedLists.awaiting.push('test/claude-folder-live.test.mjs');
expectedLists.awaiting.sort();
expectedLists.converting.push(
  'test/claude-sweep-home.test.mjs',
  'test/verdict-forge.test.mjs',
  'test/verdict-input.test.mjs',
  'test/verdict-surface.test.mjs',
  'test/verdict-terminal.test.mjs',
  'test/verdict-world.test.mjs',
  'test/verdict.test.mjs',
);
expectedLists.converting.sort();

for (const [name, expected] of Object.entries(expectedLists)) {
  test(`suite --list ${name} names the Part 2 files as repository-relative paths`, () => {
    const result = spawnSync('sh', ['test/suite.sh', '--list', name], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), expected);
  });
}

for (const name of Object.keys(expectedLists)) {
  test(`suite refuses a missing entry in its ${name} list`, (t) => {
    const directory = temporaryDirectory('rigger-suite-list-', { context: t });
    const source = readFileSync('test/suite.sh', 'utf8');
    const marker = `${name === 'converting' ? 'converting' : name}_tests='`;
    const start = source.indexOf(marker);
    const end = source.indexOf("\n'", start);
    assert.ok(start > 0 && end > start, `cannot find ${name} list`);
    const missing = `test/missing-${name}.test.mjs`;
    const list = source.slice(start, end).replace(/test\/[^\n]+\.test\.mjs/, missing);
    assert.notEqual(list, source.slice(start, end), `could not change ${name} list`);
    const copy = join(directory, 'suite.sh');
    writeFileSync(copy, source.slice(0, start) + list + source.slice(end));
    const result = spawnSync('sh', [copy, '--list', name], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'a missing list entry passed');
    assert.match(result.stderr, new RegExp(`${name} list names missing ${missing}`));
    assert.equal(result.stdout, '');
  });
}

test('npm test refuses a named host file and directs it to test:host', () => {
  const file = 'test/codex-judge-shell.test.mjs';
  const result = spawnSync('sh', ['test/suite.sh', file], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'a host file ran in the deterministic tier');
  assert.match(result.stderr, new RegExp(file));
  assert.match(result.stderr, /npm run test:host/);
});

test('npm test refuses relative and absolute names of a host file before it runs', () => {
  for (const file of ['./test/package.test.mjs', resolve('test/package.test.mjs')]) {
    const result = spawnSync('sh', ['test/suite.sh', file], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(result.status, 0, `${file} ran in the deterministic tier`);
    assert.match(result.stderr, /test\/package\.test\.mjs.*npm run test:host/);
    assert.equal(result.stdout, '', `${file} ran tests before its refusal`);
  }
});

test('host mode refuses a named file outside the host list', () => {
  const file = 'test/agent-cli-refusal.test.mjs';
  const result = spawnSync('sh', ['test/suite.sh', '--host', file], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'a deterministic file ran in the host tier');
  assert.match(result.stderr, new RegExp(file));
});

test('host mode refuses a relative name outside the host list before it runs', () => {
  const file = './test/agent-cli-refusal.test.mjs';
  const result = spawnSync('sh', ['test/suite.sh', '--host', file], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0, `${file} ran in the host tier`);
  assert.match(result.stderr, /test\/agent-cli-refusal\.test\.mjs is not on the host list/);
  assert.equal(result.stdout, '', `${file} ran tests before its refusal`);
});

test('host mode forwards node test options to a named fixture outside test', (t) => {
  const directory = temporaryDirectory('rigger-host-options-', { context: t });
  const file = join(directory, 'option.test.mjs');
  writeFileSync(file, [
    "import { test } from 'node:test';",
    "import { spawnSync } from 'node:child_process';",
    "test('selected host fixture', () => { spawnSync('git', ['--version']); });",
    "test('excluded host fixture', () => { spawnSync('git', ['--version']); });",
  ].join('\n'));
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'test:host', '--', '--test-name-pattern=selected host fixture', file], {
    encoding: 'utf8', env: environment, timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'selected host fixture'), result.stdout);
  assert.equal(reportsPassedTest(result.stdout, 'excluded host fixture'), false, result.stdout);
});

function isolatedHostTree(t) {
  const directory = temporaryDirectory('rigger-host-default-', { context: t });
  const tests = join(directory, 'test');
  mkdirSync(tests);
  for (const name of ['suite-guard.cjs', 'suite-path.cjs', 'suite-reaper']) {
    symlinkSync(resolve('test', name), join(tests, name));
  }
  const host = 'test/host.test.mjs';
  const marker = join(directory, 'non-host-ran');
  writeFileSync(join(directory, host), "import { test } from 'node:test';\ntest('selected host fixture', () => {});\n");
  writeFileSync(join(tests, 'other.test.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const source = readFileSync('test/suite.sh', 'utf8')
    .replace(/host_tests='[\s\S]*?'/, `host_tests='\n${host}\n'`)
    .replace(/awaiting_tests='[\s\S]*?'/, `awaiting_tests='\n${host}\n'`)
    .replace(/converting_tests='[\s\S]*?'/, "converting_tests='' ");
  const suite = join(tests, 'suite.sh');
  writeFileSync(suite, source);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  return { directory, marker, environment };
}

test('host mode with only reporter or pattern options runs only its host list', (t) => {
  const { directory, marker, environment } = isolatedHostTree(t);
  for (const option of ['--test-reporter=tap', '--test-name-pattern=selected host fixture']) {
    const result = spawnSync('sh', ['test/suite.sh', '--host', option], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(reportsPassedTest(result.stdout, 'selected host fixture'), result.stdout);
    assert.equal(existsSync(marker), false, `${option} ran a non-host file`);
    assert.doesNotMatch(result.stdout, /test\/other\.test\.mjs/, `${option} reported an unlisted file`);
  }
});

test('host mode with a separate import or coverage value runs no unlisted test', (t) => {
  const { directory, marker, environment } = isolatedHostTree(t);
  writeFileSync(join(directory, 'setup.mjs'), '');
  const cases = [
    ['--import', './setup.mjs'],
    ['--test-name-pattern', 'selected.*fixture'],
    ['--test-name-pattern=selected host fixture', '--import', './setup.mjs'],
  ];
  if (process.allowedNodeEnvironmentFlags.has('--test-coverage-include')) {
    cases.push(['--test-coverage-include', 'test/host.test.mjs']);
  }
  for (const options of cases) {
    const result = spawnSync('sh', ['test/suite.sh', '--host', ...options], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(reportsPassedTest(result.stdout, 'selected host fixture'), result.stdout);
    assert.equal(existsSync(marker), false, `${options[0]} ran an unlisted test`);
    assert.doesNotMatch(result.stdout, /test\/other\.test\.mjs/, `${options[0]} reported an unlisted file`);
  }
});

test('host worker excludes an unlisted test when Node discovers files itself', (t) => {
  const { directory, marker, environment } = isolatedHostTree(t);
  const runner = join(directory, 'worker-runner.cjs');
  writeFileSync(runner, `if (process.env.NODE_TEST_CONTEXT === 'child-v8') process.env.RIGGER_SUITE_MODE = 'host';\nrequire(${JSON.stringify(resolve('test/suite-guard.cjs'))});\n`);
  const result = spawnSync(process.execPath, ['--require', runner, '--test'], {
    cwd: directory, encoding: 'utf8', timeout: 60_000,
    env: { ...environment, RIGGER_SUITE_HOST_FILES: 'test/host.test.mjs', RIGGER_SUITE_AWAITING_FILES: 'test/host.test.mjs' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'selected host fixture'), result.stdout);
  assert.equal(existsSync(marker), false, 'an unlisted test loaded in a host worker');
});

test('deterministic mode refuses a glob naming a host file before running it', () => {
  for (const pattern of ['test/package.test.m?s', 'test/package.test.m[j]s']) {
    const result = spawnSync('sh', ['test/suite.sh', pattern], { encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(result.status, 0, `${pattern} passed a host file`);
    assert.match(result.stderr, /test\/package\.test\.mjs.*npm run test:host/);
    assert.equal(result.stdout, '', `${pattern} ran the host file before refusal`);
  }
});

test('deterministic mode refuses a glob that includes host and deterministic files', () => {
  const result = spawnSync('sh', ['test/suite.sh', 'test/forge-*.test.mjs'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0, 'the forge glob crossed tiers');
  assert.match(result.stderr, /test\/forge-(runners|spawn)\.test\.mjs.*npm run test:host/);
  assert.equal(result.stdout, '', 'a forge test ran before refusal');
});

test('host mode refuses a glob naming an unlisted test before running it', () => {
  const result = spawnSync('sh', ['test/suite.sh', '--host', 'test/agent-cli-refusal.test.m?s'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0, 'the unlisted test passed through a glob');
  assert.match(result.stderr, /test\/agent-cli-refusal\.test\.mjs is not on the host list/);
  assert.equal(result.stdout, '', 'a test ran before the glob refusal');
});

test('deterministic mode refuses a brace operand naming a host file before running it', () => {
  const argument = 'test/{package,agent-cli-refusal}.test.mjs';
  const result = spawnSync('sh', ['test/suite.sh', argument], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0, `${argument} passed a host file`);
  assert.ok(result.stderr.includes(argument), `refusal did not name ${argument}: ${result.stderr}`);
  assert.match(result.stderr, /literal existing file path.*npm run test:host/);
  assert.doesNotMatch(result.stdout, /^(?:✔|ok \d+ - |ℹ tests|# tests)/m, 'a test ran before the refusal');
});

for (const [title, command, args, argument, rule] of [
  ['deterministic mode refuses a brace extension naming a host file', 'sh', ['test/suite.sh', 'test/package.test.{mjs,x}'], 'test/package.test.{mjs,x}', 'npm run test:host'],
  ['deterministic mode refuses a plus extglob naming a host file', 'sh', ['test/suite.sh', 'test/+(package).test.mjs'], 'test/+(package).test.mjs', 'npm run test:host'],
  ['npm test refuses an at extglob naming a host file', process.execPath, [process.env.npm_execpath, 'test', '--', 'test/@(package).test.mjs'], 'test/@(package).test.mjs', 'npm run test:host'],
  ['host mode refuses a brace extension naming an unlisted file', 'sh', ['test/suite.sh', '--host', 'test/agent-cli-refusal.test.{mjs,x}'], 'test/agent-cli-refusal.test.{mjs,x}', 'host list'],
  ['npm run test:host refuses an at extglob naming an unlisted file', process.execPath, [process.env.npm_execpath, 'run', 'test:host', '--', 'test/agent-cli-refusal.test.@(mjs)'], 'test/agent-cli-refusal.test.@(mjs)', 'host list'],
]) {
  test(title, () => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, env: process.env });
    assert.notEqual(result.status, 0, `${argument} passed without running the file`);
    assert.ok(result.stderr.includes(argument), `refusal did not name ${argument}: ${result.stderr}`);
    assert.match(result.stderr, /literal existing file path/);
    assert.ok(result.stderr.includes(rule), `refusal did not name ${rule}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /^(?:✔|ok \d+ - |ℹ tests|# tests)/m, `${argument} ran a test before refusal`);
  });
}

test('host mode refuses a case-varied name for an unlisted test', () => {
  const result = spawnSync('sh', ['test/suite.sh', '--host', 'TEST/agent-cli-refusal.test.mjs'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(result.status, 0, 'the case-varied unlisted test ran');
  if (existsSync('TEST/agent-cli-refusal.test.mjs')) {
    assert.equal(realpathSync.native('TEST/agent-cli-refusal.test.mjs'), realpathSync.native('test/agent-cli-refusal.test.mjs'), 'the case-varied fixture must resolve to the intended test');
    assert.match(result.stderr, /test\/agent-cli-refusal\.test\.mjs is not on the host list/);
  } else {
    assert.equal(result.stderr, 'test:host: TEST/agent-cli-refusal.test.mjs is not a literal existing file path; named test files must be on the host list\n');
  }
  assert.equal(result.stdout, '', 'a test ran before the case-varied refusal');
});

test('the deterministic runner exits a host file before its test loads', (t) => {
  const directory = temporaryDirectory('rigger-suite-skip-', { context: t });
  const marker = join(directory, 'loaded');
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync('sh', ['test/suite.sh', '--test-name-pattern=only-this-probe'], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...environment, RIGGER_SUITE_IMPORT_MARKER: marker },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), false, 'a host file loaded in the deterministic tier');
});

test('process fixtures load without starting a process and resolve the same git', (t) => {
  const which = spawnSync('/usr/bin/which', ['git'], { encoding: 'utf8', env: process.env });
  assert.equal(which.status, 0, which.stderr);
  const source = `import assert from 'node:assert/strict';
import { GIT } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};
test('resolves git without starting a process at load', () => {
  assert.equal(GIT, ${JSON.stringify(which.stdout.trim())});
});`;
  const { result } = runProbe(t, source);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(reportsPassedTest(result.stdout, 'resolves git without starting a process at load'), true, result.stdout);
});

for (const api of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
  test(`deterministic guard refuses ${api} and leaves no process marker`, (t) => {
    const markerName = 'started';
    const command = `printf started > "$MARKER"`;
    const common = `import { ${api} } from 'node:child_process';\n`;
    const body = api === 'spawn'
      ? `const child = spawn('/bin/sh', ['-c', ${JSON.stringify(command)}], { env: { ...process.env, MARKER: new URL('./${markerName}', import.meta.url).pathname } }); await new Promise((resolve) => child.on('exit', resolve));`
      : api === 'spawnSync'
        ? `spawnSync('/bin/sh', ['-c', ${JSON.stringify(command)}], { env: { ...process.env, MARKER: new URL('./${markerName}', import.meta.url).pathname } });`
        : api === 'execFile'
          ? `await new Promise((resolve, reject) => execFile('/bin/sh', ['-c', ${JSON.stringify(command)}], { env: { ...process.env, MARKER: new URL('./${markerName}', import.meta.url).pathname } }, (error) => error ? reject(error) : resolve()));`
          : api === 'execFileSync'
            ? `execFileSync('/bin/sh', ['-c', ${JSON.stringify(command)}], { env: { ...process.env, MARKER: new URL('./${markerName}', import.meta.url).pathname } });`
            : `const child = fork(new URL('./child.cjs', import.meta.url).pathname, [new URL('./${markerName}', import.meta.url).pathname]); await new Promise((resolve) => child.on('exit', resolve));`;
    const files = api === 'fork' ? { 'child.cjs': "require('node:fs').writeFileSync(process.argv[2], 'started');\n" } : {};
    const { directory, result } = runProbe(t, `${common}test('attempts ${api}', async () => { ${body} });`, files);
    assert.notEqual(result.status, 0, `${api} ran in the deterministic tier:\n${result.stdout}`);
    assert.match(result.stdout + result.stderr, new RegExp(`attempts ${api}`));
    assert.equal(existsSync(join(directory, markerName)), false, `${api} started its command`);
  });
}

for (const [variable, value] of [['GIT_TEMPLATE_DIR', 'template'], ['GIT_CONFIG_COUNT', '0'], ['GIT_UNLISTED_PROBE', 'present']]) {
  test(`admitted git strips ${variable}; its unguarded control runs the same alias`, (t) => {
    const directory = temporaryDirectory('rigger-git-env-', { context: t });
    const marker = join(directory, 'marker');
    const supplied = value === 'template' ? join(directory, value) : value;
    if (value === 'template') mkdirSync(supplied);
    const alias = '!if [ -n "${' + variable + '+x}" ]; then printf marked > "$MARKER"; fi';
    const args = ['-c', `alias.tierprobe=${alias}`, 'tierprobe'];
    const env = { ...gitEnvironment(), MARKER: marker, [variable]: supplied };
    const control = spawnSync('git', ['-c', `alias.tierprobe=${alias}`, 'tierprobe'], { env, encoding: 'utf8' });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control never observed the variable');
    rmSync(marker);
    const source = `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('runs isolated git', () => {
  const result = spawnSync('git', ${JSON.stringify(args)}, { env: { ...process.env, MARKER: ${JSON.stringify(marker)}, ${variable}: ${JSON.stringify(supplied)} }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});`;
    const { result } = runProbe(t, source);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(marker), false, `${variable} reached git`);
  });
}

test('admitted git strips GIT_TEMPLATE_DIR before a template hook can run', (t) => {
  const directory = temporaryDirectory('rigger-git-template-', { context: t });
  const template = join(directory, 'template');
  const hooks = join(template, 'hooks');
  const marker = join(directory, 'marker');
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nprintf marked > "$MARKER"\n');
  chmodSync(hook, 0o755);
  const beforeTemplate = process.env.GIT_TEMPLATE_DIR;
  const beforeMarker = process.env.MARKER;
  try {
    process.env.GIT_TEMPLATE_DIR = template;
    process.env.MARKER = marker;
    const control = repositoryAt(join(directory, 'control'));
    gitIn(control, 'commit', '--allow-empty', '-m', 'control');
  } finally {
    if (beforeTemplate === undefined) delete process.env.GIT_TEMPLATE_DIR;
    else process.env.GIT_TEMPLATE_DIR = beforeTemplate;
    if (beforeMarker === undefined) delete process.env.MARKER;
    else process.env.MARKER = beforeMarker;
  }
  assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control template hook did not run');
  rmSync(marker);
  const fixture = new URL('./git-repository.mjs', import.meta.url).href;
  const source = `import { repositoryAt, gitIn } from ${JSON.stringify(fixture)};
test('commits without the template hook', () => {
  process.env.GIT_TEMPLATE_DIR = ${JSON.stringify(template)};
  process.env.MARKER = ${JSON.stringify(marker)};
  const repo = repositoryAt(${JSON.stringify(join(directory, 'guarded'))});
  gitIn(repo, 'commit', '--allow-empty', '-m', 'guarded');
});`;
  const { result } = runProbe(t, source);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(marker), false, 'the template hook ran under the guard');
});

test('admitted git strips GIT_CONFIG_COUNT and its keys before a configured helper can run', (t) => {
  const directory = temporaryDirectory('rigger-git-count-', { context: t });
  const marker = join(directory, 'marker');
  const helper = join(directory, 'helper.sh');
  writeFileSync(helper, '#!/bin/sh\nprintf marked > "$MARKER"\n');
  chmodSync(helper, 0o755);
  const env = { ...gitEnvironment(), MARKER: marker, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '!' + helper };
  const input = 'protocol=https\nhost=example.invalid\n\n';
  const control = spawnSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], { env, input, encoding: 'utf8' });
  assert.equal(control.error, undefined, control.error?.message);
  assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the configured helper did not run');
  rmSync(marker);
  const source = `import { spawnSync } from 'node:child_process';
test('fills without the configured helper', () => {
  const result = spawnSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], { env: { ...process.env, MARKER: ${JSON.stringify(marker)}, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: ${JSON.stringify('!' + helper)} }, input: ${JSON.stringify(input)}, encoding: 'utf8' });
  if (result.error) throw result.error;
});`;
  const { result } = runProbe(t, source);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(marker), false, 'the configured helper ran under the guard');
});

test('deterministic git clone finds upload-pack when the caller starts from git-core', (t) => {
  const execPath = spawnSync('/usr/bin/git', ['--exec-path'], { env: gitEnvironment(), encoding: 'utf8' });
  assert.equal(execPath.status, 0, execPath.stderr);
  const fixture = new URL('./git-repository.mjs', import.meta.url).href;
  const source = `import { clonedFromOrigin } from ${JSON.stringify(fixture)};
test('clones through guarded git', () => { clonedFromOrigin(new URL('./case', import.meta.url).pathname); });`;
  const { result } = runProbe(t, source, {}, { PATH: `${execPath.stdout.trim()}:${process.env.PATH}` });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'clones through guarded git'), result.stdout);
});

for (const scope of ['global', 'system']) {
  test(`admitted git ignores ${scope} aliases; its unguarded control runs the alias`, (t) => {
    const directory = temporaryDirectory('rigger-git-config-', { context: t });
    const marker = join(directory, 'marker');
    const config = join(directory, 'config');
    writeFileSync(config, '[alias]\n  tierprobe = !printf marked > "$MARKER"\n');
    const env = { ...gitEnvironment(), MARKER: marker, GIT_CONFIG_GLOBAL: scope === 'global' ? config : '/dev/null', GIT_CONFIG_SYSTEM: scope === 'system' ? config : '/dev/null', GIT_CONFIG_NOSYSTEM: '0' };
    const control = spawnSync('git', ['tierprobe'], { env, encoding: 'utf8' });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control did not run the alias');
    rmSync(marker);
    const source = `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('checks isolated ${scope} alias', () => {
  const result = spawnSync('git', ['tierprobe'], { env: { ...process.env, MARKER: ${JSON.stringify(marker)}, GIT_CONFIG_GLOBAL: ${JSON.stringify(env.GIT_CONFIG_GLOBAL)}, GIT_CONFIG_SYSTEM: ${JSON.stringify(env.GIT_CONFIG_SYSTEM)}, GIT_CONFIG_NOSYSTEM: '0' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the alias from ${scope} configuration ran');
});`;
    const { result } = runProbe(t, source);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(marker), false, `${scope} alias wrote its marker`);
  });
}

test('admitted git ignores an alias in HOME gitconfig without a GIT_CONFIG override', (t) => {
  const directory = temporaryDirectory('rigger-git-home-', { context: t });
  const marker = join(directory, 'marker');
  writeFileSync(join(directory, '.gitconfig'), '[alias]\n  tierprobe = !printf marked > "$MARKER"\n');
  const { GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_CONFIG_NOSYSTEM, ...base } = gitEnvironment();
  const env = { ...base, HOME: directory, MARKER: marker };
  const control = spawnSync('git', ['tierprobe'], { env, encoding: 'utf8' });
  assert.equal(control.status, 0, control.stderr);
  assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control did not read HOME gitconfig');
  rmSync(marker);
  const source = `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('ignores HOME gitconfig', () => {
    const result = spawnSync('git', ['tierprobe'], { env: { ...process.env, HOME: ${JSON.stringify(directory)}, MARKER: ${JSON.stringify(marker)} }, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'the HOME alias ran');
  });`;
  const { result } = runProbe(t, source);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(marker), false, 'HOME gitconfig alias wrote its marker');
});

for (const scope of ['global', 'system']) {
  test('admitted git ignores ' + scope + ' filters; its unguarded control runs the filter', (t) => {
    const directory = temporaryDirectory('rigger-git-filter-', { context: t });
    const repo = join(directory, 'repo');
    const marker = join(directory, 'marker');
    const config = join(directory, 'config');
    const filter = join(directory, 'filter.sh');
    repositoryAt(repo);
    writeFileSync(join(repo, '.gitattributes'), 'control filter=tier\nguarded filter=tier\n');
    writeFileSync(join(repo, 'control'), 'control\n');
    writeFileSync(join(repo, 'guarded'), 'guarded\n');
    writeFileSync(filter, '#!/bin/sh\nprintf marked > "$MARKER"\n/bin/cat\n');
    chmodSync(filter, 0o755);
    gitIn(repo, 'config', '--file', config, 'filter.tier.clean', filter);
    const env = { ...gitEnvironment(), MARKER: marker, GIT_CONFIG_GLOBAL: scope === 'global' ? config : '/dev/null', GIT_CONFIG_SYSTEM: scope === 'system' ? config : '/dev/null', GIT_CONFIG_NOSYSTEM: '0' };
    const control = spawnSync('git', ['-C', repo, 'add', 'control'], { env, encoding: 'utf8' });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control did not run the filter');
    rmSync(marker);
    const source = [
      "import assert from 'node:assert/strict';",
      "import { spawnSync } from 'node:child_process';",
      "test('adds with an isolated filter', () => {",
      "  const result = spawnSync('git', " + JSON.stringify(['-C', repo, 'add', 'guarded']) + ", { env: { ...process.env, MARKER: " + JSON.stringify(marker) + ", GIT_CONFIG_GLOBAL: " + JSON.stringify(env.GIT_CONFIG_GLOBAL) + ", GIT_CONFIG_SYSTEM: " + JSON.stringify(env.GIT_CONFIG_SYSTEM) + ", GIT_CONFIG_NOSYSTEM: '0' }, encoding: 'utf8' });",
      "  assert.equal(result.status, 0, result.stderr);",
      "});",
    ].join('\n');
    const { result } = runProbe(t, source);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(marker), false, scope + ' filter wrote its marker');
  });
}

for (const scope of ['global', 'system']) {
  test('admitted git ignores ' + scope + ' credential helpers; its unguarded control runs the helper', (t) => {
    const directory = temporaryDirectory('rigger-git-helper-', { context: t });
    const marker = join(directory, 'marker');
    const config = join(directory, 'config');
    const helper = join(directory, 'helper.sh');
    writeFileSync(helper, '#!/bin/sh\nprintf marked > "$MARKER"\n');
    chmodSync(helper, 0o755);
    gitIn(directory, 'config', '--file', config, 'credential.helper', '!' + helper);
    const args = ['-c', 'credential.interactive=never', 'credential', 'fill'];
    const input = 'protocol=https\nhost=example.invalid\n\n';
    const env = { ...gitEnvironment(), MARKER: marker, GIT_CONFIG_GLOBAL: scope === 'global' ? config : '/dev/null', GIT_CONFIG_SYSTEM: scope === 'system' ? config : '/dev/null', GIT_CONFIG_NOSYSTEM: '0' };
    const control = spawnSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], { env, input, encoding: 'utf8' });
    assert.equal(control.error, undefined, control.error?.message);
    assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control did not run the helper');
    rmSync(marker);
    const source = [
      "import assert from 'node:assert/strict';",
      "import { spawnSync } from 'node:child_process';",
      "test('fills without a host helper', () => {",
      "  const result = spawnSync('git', " + JSON.stringify(args) + ", { env: { ...process.env, MARKER: " + JSON.stringify(marker) + ", GIT_CONFIG_GLOBAL: " + JSON.stringify(env.GIT_CONFIG_GLOBAL) + ", GIT_CONFIG_SYSTEM: " + JSON.stringify(env.GIT_CONFIG_SYSTEM) + ", GIT_CONFIG_NOSYSTEM: '0' }, input: " + JSON.stringify(input) + ", encoding: 'utf8' });",
      "  assert.equal(result.error, undefined, result.error?.message);",
      "});",
    ].join('\n');
    const { result } = runProbe(t, source);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(marker), false, scope + ' helper wrote its marker');
  });
}

test('a git pre-commit hook cannot start npm by name under the deterministic guard', (t) => {
  const directory = temporaryDirectory('rigger-git-hook-', { context: t });
  const repository = join(directory, 'repo');
  const hooks = join(directory, 'hooks');
  const bin = join(directory, 'bin');
  const marker = join(directory, 'marker');
  repositoryAt(repository);
  mkdirSync(hooks);
  mkdirSync(bin);
  const hook = join(hooks, 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nnpm\n');
  chmodSync(hook, 0o755);
  const stub = join(bin, 'npm');
  writeFileSync(stub, '#!/bin/sh\nprintf marked > "$MARKER"\n');
  chmodSync(stub, 0o755);
  const args = ['-C', repository, '-c', `core.hooksPath=${hooks}`, 'commit', '--allow-empty', '-m', 'control'];
  const control = spawnSync('git', ['-C', repository, '-c', `core.hooksPath=${hooks}`, 'commit', '--allow-empty', '-m', 'control'], { encoding: 'utf8', env: { ...gitEnvironment(), PATH: `${bin}:${process.env.PATH}`, MARKER: marker } });
  assert.equal(control.status, 0, control.stderr);
  assert.equal(readFileSync(marker, 'utf8'), 'marked', 'the control did not run npm');
  rmSync(marker);
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const source = `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('runs pre-commit hook', () => {
    const result = spawnSync('git', ${JSON.stringify([...args.slice(0, -1), 'guarded'])}, { env: { ...process.env, PATH: ${JSON.stringify(`${bin}:${process.env.PATH}`)}, MARKER: ${JSON.stringify(marker)} }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });`;
  const { result } = runProbe(t, source);
  assert.notEqual(result.status, 0, 'a hook starting npm by name passed');
  assert.match(result.stdout + result.stderr, /runs pre-commit hook/);
  assert.equal(existsSync(marker), false, 'the refused hook ran npm');
  const after = gitIn(repository, 'rev-parse', 'HEAD').trim();
  assert.equal(after, head, 'the refused commit changed the repository');
});

for (const [api, option] of [
  ['spawn', 'timeout'], ['spawn', 'killSignal'], ['spawn', 'signal'],
  ['execFile', 'timeout'], ['execFile', 'killSignal'], ['execFile', 'signal'],
  ['spawnSync', 'timeout'], ['spawnSync', 'killSignal'],
  ['execFileSync', 'timeout'], ['execFileSync', 'killSignal'],
]) {
  test(`deterministic guard refuses ${api} with ${option}`, (t) => {
    const value = option === 'signal' ? 'new AbortController().signal' : option === 'timeout' ? '5_000' : "'SIGKILL'";
    const options = `{ ${option}: ${value} }`;
    const call = api === 'spawnSync'
      ? `const result = spawnSync('git', ['--version'], ${options}); assert.equal(result.status, 0);`
      : api === 'execFileSync'
        ? `execFileSync('git', ['--version'], ${options});`
        : api === 'execFile'
          ? `await new Promise((resolve, reject) => execFile('git', ['--version'], ${options}, (error) => error ? reject(error) : resolve()));`
          : `const child = spawn('git', ['--version'], ${options}); const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); assert.equal(code, 0);`;
    const source = `import assert from 'node:assert/strict';\nimport { ${api} } from 'node:child_process';\ntest('uses ${api} ${option}', async () => { ${call} });`;
    const { result } = runProbe(t, source);
    assert.notEqual(result.status, 0, `${api} ${option} passed`);
    assert.match(result.stdout + result.stderr, new RegExp(`uses ${api} ${option}`));
  });
}

test('deterministic guard refuses ChildProcess.kill even for admitted git', (t) => {
  const source = `import { spawn } from 'node:child_process';
test('signals an admitted git child', async () => {
  const child = spawn('git', ['hash-object', '--stdin']);
  let refusal;
  try { child.kill(0); } catch (error) { refusal = error; }
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
  if (refusal) throw refusal;
});`;
  const { result } = runProbe(t, source);
  assert.notEqual(result.status, 0, 'ChildProcess.kill passed');
  assert.match(result.stdout + result.stderr, /signals an admitted git child/);
});

for (const [form, binding] of [
  ['child_process ESM', "import { spawnSync } from 'child_process';"],
  ['createRequire', "import { createRequire } from 'node:module'; const { spawnSync } = createRequire(import.meta.url)('node:child_process');"],
  ['dynamic import', "const { spawnSync } = await import('node:child_process');"],
]) {
  test('deterministic guard reaches ' + form + ' imports', (t) => {
    const source = [binding, "test('tries binding', () => { spawnSync('/bin/sh', ['-c', 'printf started > \"$MARKER\"'], { env: { ...process.env, MARKER: new URL('./started', import.meta.url).pathname } }); });"].join('\n');
    const { directory, result } = runProbe(t, source);
    assert.notEqual(result.status, 0, form + ' bypassed the guard');
    assert.match(result.stdout + result.stderr, /\/bin\/sh/);
    assert.equal(existsSync(join(directory, 'started')), false, form + ' started its command');
  });
}

for (const [when, registration] of [
  ['file load', "attempt(); test('file body', () => {});"],
  ['before hook', "before(attempt); test('file body', () => {});"],
  ['after hook', "after(attempt); test('file body', () => {});"],
  ['t.after teardown', "test('file body', (t) => { t.after(attempt); });"],
  ['timer after a test', "test('file body', () => { setImmediate(attempt); });"],
  ['between tests', "test('first', () => {}); setImmediate(attempt); test('second', () => {});"],
  ['exit handler', "process.on('exit', attempt); test('file body', () => {});"],
]) {
  test('deterministic guard catches a process start at ' + when, (t) => {
    const source = [
      "import { before, after } from 'node:test';",
      "import { spawnSync } from 'node:child_process';",
      "const attempt = () => spawnSync('/bin/sh', ['-c', 'printf started > \"$MARKER\"'], { env: { ...process.env, MARKER: new URL('./started', import.meta.url).pathname } });",
      registration,
    ].join('\n');
    const { directory, result } = runProbe(t, source);
    assert.notEqual(result.status, 0, 'a process started at ' + when);
    assert.match(result.stdout + result.stderr, /\/bin\/sh/);
    assert.equal(existsSync(join(directory, 'started')), false, when + ' started its command');
  });
}

test('host runner fails a test that starts no process', (t) => {
  const { result } = hostProbe(t, "test('empty host test', () => {});");
  assert.notEqual(result.status, 0, 'an empty host test passed');
  assert.match(result.stdout + result.stderr, /empty host test/);
  assert.match(result.stdout + result.stderr, /started no process/);
});

test('host runner counts process starts per test', (t) => {
  const source = "import { spawnSync } from 'node:child_process';\ntest('starts git', () => { spawnSync('git', ['--version']); });\ntest('starts nothing', () => {});";
  const { result } = hostProbe(t, source);
  assert.notEqual(result.status, 0, 'a later empty host test borrowed the first test\'s start');
  assert.match(result.stdout + result.stderr, /starts nothing/);
  assert.match(result.stdout + result.stderr, /started no process/);
});

test('awaiting-split host files may hold a test that starts no process', (t) => {
  const { result } = hostProbe(t, "test('awaiting split', () => {});", { awaiting: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'awaiting split'), result.stdout);
});

test('host runner prints the local host key first', (t) => {
  const source = "import { spawnSync } from 'node:child_process';\ntest('starts git', () => { spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source, { env: { GITHUB_ACTIONS: '' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const version = process.platform === 'darwin'
    ? spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim()
    : spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout.trim();
  const arch = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim();
  const expected = process.platform === 'darwin'
    ? 'macos-' + version + '-' + arch + '-node' + process.versions.node.split('.')[0]
    : 'linux-' + version + '-' + arch + '-node' + process.versions.node.split('.')[0];
  assert.equal(result.stdout.split('\n')[0], expected);
});


test('host mode refuses an existing case-varied alias for an unlisted test', (t) => {
  const directory = temporaryDirectory('rigger-case-alias-', { context: t });
  const tests = join(directory, 'test');
  mkdirSync(tests);
  for (const name of readdirSync('test')) {
    const original = resolve('test', name);
    if (name === 'agent-cli-refusal.test.mjs') writeFileSync(join(tests, name), readFileSync(original));
    else symlinkSync(original, join(tests, name));
  }
  if (!existsSync(join(directory, 'TEST'))) symlinkSync(tests, join(directory, 'TEST'));
  const result = spawnSync('sh', [resolve('test/suite.sh'), '--host', 'TEST/agent-cli-refusal.test.mjs'], {
    cwd: directory, encoding: 'utf8', timeout: 60_000,
  });
  const canonical = relative(directory, realpathSync.native(join(directory, 'TEST/agent-cli-refusal.test.mjs')));
  assert.notEqual(result.status, 0, 'the existing case-varied unlisted alias ran');
  assert.ok(result.stderr.includes(canonical + ' is not on the host list'), result.stderr);
  assert.equal(result.stdout, '', 'a test ran before the existing-alias refusal');
});

for (const [system, version, expected] of [
  ['Linux', 'kernel-probe', 'linux-kernel-probe-probe-arch-node'],
  ['Darwin', 'product-probe', 'macos-product-probe-probe-arch-node'],
]) {
  test('local host key asks the ' + system + ' version authority', (t) => {
    const tools = temporaryDirectory('rigger-host-identity-', { context: t });
    writeFileSync(join(tools, 'uname'), [
      '#!/bin/sh',
      '# ABOUTME: Answers the controlled host identity commands for a suite test.',
      'case "$1" in',
      "-s) printf '%s\\n' '" + system + "' ;;",
      "-r) printf '%s\\n' '" + version + "' ;;",
      "-m) printf '%s\\n' 'probe-arch' ;;",
      '*) exit 2 ;;',
      'esac',
    ].join('\n') + '\n');
    writeFileSync(join(tools, 'sw_vers'), [
      '#!/bin/sh',
      '# ABOUTME: Records a controlled macOS product-version lookup.',
      ': > "$0.called"',
      "printf '%s\\n' '" + version + "'",
    ].join('\n') + '\n');
    chmodSync(join(tools, 'uname'), 0o755);
    chmodSync(join(tools, 'sw_vers'), 0o755);
    const source = "import { spawnSync } from 'node:child_process';\ntest('starts git', () => { spawnSync('git', ['--version']); });";
    const { result } = hostProbe(t, source, { env: { GITHUB_ACTIONS: '', PATH: tools + ':' + process.env.PATH } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.split('\n')[0], expected + process.versions.node.split('.')[0]);
    assert.equal(existsSync(join(tools, 'sw_vers.called')), system === 'Darwin', 'the wrong version authority was consulted');
  });
}

test('host runner prints the CI image key first when GITHUB_ACTIONS is true', (t) => {
  const source = "import { spawnSync } from 'node:child_process';\ntest('starts git', () => { spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source, { env: { GITHUB_ACTIONS: 'true', ImageOS: 'macos-probe', ImageVersion: '42', RUNNER_ARCH: 'ARM64' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.split('\n')[0], 'macos-probe-42-ARM64-node' + process.versions.node.split('.')[0]);
});

for (const [name, imageOS, imageVersion] of [
  ['both image variables absent', undefined, undefined],
  ['ImageOS set and ImageVersion absent', 'macos-probe', undefined],
  ['ImageOS absent and ImageVersion set', undefined, '42'],
  ['ImageOS empty and ImageVersion set', '', '42'],
  ['ImageOS set and ImageVersion empty', 'macos-probe', ''],
]) {
  test(`host runner uses the local key in CI with ${name}`, (t) => {
    const checks = [['ImageOS', imageOS], ['ImageVersion', imageVersion]].map(([variable, value]) =>
      value === undefined
        ? `assert.equal(Object.hasOwn(process.env, '${variable}'), false);`
        : `assert.equal(process.env.${variable}, ${JSON.stringify(value)});`).join(' ');
    const source = `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('starts git', () => { ${checks} spawnSync('git', ['--version']); });`;
    const env = { ImageOS: imageOS, ImageVersion: imageVersion };
    const { result: local } = hostProbe(t, source, { env: { ...env, GITHUB_ACTIONS: '' } });
    assert.equal(local.status, 0, local.stdout + local.stderr);
    const { result: ci } = hostProbe(t, source, { env: { ...env, GITHUB_ACTIONS: 'true' } });
    assert.equal(ci.status, 0, ci.stdout + ci.stderr);
    assert.equal(ci.stdout.split('\n')[0], local.stdout.split('\n')[0]);
  });
}

test('host tests receive both refusing CLI directories on PATH', (t) => {
  const source = "import assert from 'node:assert/strict';\nimport { existsSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { spawnSync } from 'node:child_process';\ntest('sees refusing directories', () => { assert.ok(existsSync(join(process.env.RIGGER_REFUSING_GH_DIR, 'gh'))); assert.ok(existsSync(join(process.env.RIGGER_REFUSING_AGENT_DIR, 'claude'))); assert.ok(existsSync(join(process.env.RIGGER_REFUSING_AGENT_DIR, 'codex'))); assert.ok(process.env.PATH.split(':').includes(process.env.RIGGER_REFUSING_GH_DIR)); assert.ok(process.env.PATH.split(':').includes(process.env.RIGGER_REFUSING_AGENT_DIR)); spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'sees refusing directories'), result.stdout);
});

for (const cli of ['gh', 'claude', 'codex']) {
  test('host runner refuses a ' + cli + ' call by name', (t) => {
    const source = "import { spawnSync } from 'node:child_process';\ntest('calls " + cli + "', () => { spawnSync('" + cli + "', ['--version']); });";
    const { result } = hostProbe(t, source);
    assert.notEqual(result.status, 0, cli + ' call passed');
    assert.match(result.stdout + result.stderr, new RegExp(cli + ' --version'));
  });
}

test('host runner removes its per-run TMPDIR after a test', (t) => {
  const directory = temporaryDirectory('rigger-host-tmp-', { context: t });
  const marker = join(directory, 'tmpdir');
  const source = "import { writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\ntest('records TMPDIR', () => { writeFileSync(process.env.MARKER, process.env.TMPDIR); spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source, { env: { MARKER: marker } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const run = readFileSync(marker, 'utf8');
  assert.equal(existsSync(run), false, 'the host run left its TMPDIR');
});

test('host runner refuses a TMPDIR containing a colon before loading a fixture', (t) => {
  const directory = temporaryDirectory('rigger-host-colon-', { context: t });
  const colon = join(directory, 'with:colon');
  mkdirSync(colon);
  const marker = join(directory, 'loaded');
  const source = "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.MARKER, 'loaded');\ntest('would run', () => {});";
  const { result } = hostProbe(t, source, { env: { TMPDIR: colon, MARKER: marker } });
  assert.notEqual(result.status, 0, 'a colon in TMPDIR passed');
  assert.match(result.stdout + result.stderr, /holds a ':'/);
  assert.equal(existsSync(marker), false, 'the host fixture loaded');
});

test('host runner propagates a failing host test', (t) => {
  const source = "import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\ntest('deliberately fails', () => { spawnSync('git', ['--version']); assert.fail('deliberate host failure'); });";
  const { result } = hostProbe(t, source);
  assert.notEqual(result.status, 0, 'a failing host test passed');
  assert.match(result.stdout + result.stderr, /deliberate host failure/);
});

test('host runner reaps a process left behind by a test', (t) => {
  const directory = temporaryDirectory('rigger-host-reaper-', { context: t });
  const marker = join(directory, 'pid');
  const source = [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "test('leaves a tail in TMPDIR', () => {",
    "  const hold = join(process.env.TMPDIR, 'hold');",
    "  writeFileSync(hold, '');",
    "  const child = spawn('/usr/bin/tail', ['-f', hold], { cwd: process.env.TMPDIR, stdio: 'ignore' });",
    "  writeFileSync(process.env.MARKER, String(child.pid));",
    "  child.unref();",
    "});",
  ].join('\n');
  const { result } = hostProbe(t, source, { env: { MARKER: marker } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const pid = Number(readFileSync(marker, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'the fixture did not record its pid');
  const state = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  t.diagnostic(JSON.stringify({ producer: '/bin/ps -p PID -o stat=', recordedPid: pid, ...state, error: state.error ? { ...state.error, message: state.error.message } : null }));
  assert.ok(reaped(state), 'the suite left the recorded process alive: ' + state.stdout);
});

test('host runner runs two listed files with no overlap', (t) => {
  const directory = temporaryDirectory('rigger-host-serial-', { context: t });
  const files = ['a', 'b'].map((name) => {
    const file = join(directory, name + '.test.mjs');
    const source = [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { spawnSync } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "test('records its interval', () => {",
      "  writeFileSync(" + JSON.stringify(join(directory, name + '-start')) + ", String(process.hrtime.bigint()));",
      "  const result = spawnSync('git', ['hash-object', '--stdin'], { input: Buffer.alloc(10_000_000) });",
      "  assert.equal(result.status, 0);",
      "  writeFileSync(" + JSON.stringify(join(directory, name + '-end')) + ", String(process.hrtime.bigint()));",
      "});",
    ].join('\n');
    writeFileSync(file, source);
    return file;
  });
  let script = readFileSync('test/suite.sh', 'utf8');
  script = script.replace(/host_tests='[\s\S]*?'/, "host_tests='\n" + files.join('\n') + "\n'");
  const copy = join(directory, 'suite.sh');
  writeFileSync(copy, script);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync('sh', [copy, '--host'], { encoding: 'utf8', env: environment, timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(reportsPassedTest(result.stdout, 'records its interval'), result.stdout);
  const times = Object.fromEntries(['a', 'b'].map((name) => [name, {
    start: BigInt(readFileSync(join(directory, name + '-start'), 'utf8')),
    end: BigInt(readFileSync(join(directory, name + '-end'), 'utf8')),
  }]));
  assert.ok(times.a.end <= times.b.start || times.b.end <= times.a.start, 'the host files overlapped');
});

for (const api of ['exec', 'execSync']) {
  test(`deterministic guard refuses the ${api} shell and leaves no marker`, (t) => {
    const source = `import { ${api} } from 'node:child_process';
test('attempts ${api}', async () => {
  const marker = new URL('./started', import.meta.url).pathname;
  const command = 'printf started > ' + JSON.stringify(marker);
  ${api === 'exec' ? `await new Promise((resolve, reject) => exec(command, (error) => error ? reject(error) : resolve()));` : `execSync(command);`}
});`;
    const { directory, result } = runProbe(t, source);
    assert.notEqual(result.status, 0, `${api} ran a shell:\n${result.stdout}`);
    assert.match(result.stdout + result.stderr, new RegExp(`attempts ${api}`));
    assert.equal(existsSync(join(directory, 'started')), false, `${api} ran its shell`);
  });
}

test('deterministic guard refuses spawn shell mode before its extra command runs', (t) => {
  const source = `import { spawnSync } from 'node:child_process';
test('tries a shell under git', () => {
  spawnSync('git', ['--version; /bin/sh -c "printf started > $MARKER"'], { shell: true, env: { ...process.env, MARKER: new URL('./started', import.meta.url).pathname } });
});`;
  const { directory, result } = runProbe(t, source);
  assert.notEqual(result.status, 0, 'spawn shell mode passed');
  assert.match(result.stdout + result.stderr, /shell/);
  assert.equal(existsSync(join(directory, 'started')), false, 'spawn shell mode ran its extra command');
});

for (const [target, expression] of [['zero', '0'], ['negative own pid', '-process.pid'], ['foreign positive pid', 'process.pid + 1_000_000']]) {
  test(`deterministic guard refuses process.kill to ${target}`, (t) => {
    const source = `test('signals ${target}', () => {
  try { process.kill(${expression}, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; }
});`;
    const { result } = runProbe(t, source);
    assert.notEqual(result.status, 0, `process.kill(${expression}, 0) passed`);
    assert.match(result.stdout + result.stderr, new RegExp(`signals ${target}`));
  });
}

test('deterministic guard admits signal 0 to its own positive pid', (t) => {
  const { result } = runProbe(t, `test('signals itself', () => { process.kill(process.pid, 0); });`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const api of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
  for (const command of ['git', 'tar', '/usr/bin/git', '/usr/bin/tar']) {
    test(`deterministic guard admits ${command} through ${api} with an isolated PATH`, (t) => {
      const options = `{ env: { PATH: '/path-with-no-programs', GIT_CONFIG_GLOBAL: '/missing-config' }${api === 'fork' ? `, execPath: ${JSON.stringify(command)}, silent: true` : ''} }`;
      const call = api === 'spawnSync'
        ? `const result = spawnSync(${JSON.stringify(command)}, ['--version'], ${options}); assert.equal(result.status, 0, result.error?.message ?? String(result.status));`
        : api === 'execFileSync'
          ? `execFileSync(${JSON.stringify(command)}, ['--version'], ${options});`
          : api === 'execFile'
            ? `await new Promise((resolve, reject) => execFile(${JSON.stringify(command)}, ['--version'], ${options}, (error) => error ? reject(error) : resolve()));`
            : `const child = ${api}(${api === 'fork' ? "'--version', []" : `${JSON.stringify(command)}, ['--version']`}, ${options}); const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); assert.equal(code, 0);`;
      const source = `import assert from 'node:assert/strict';\nimport { ${api} } from 'node:child_process';\ntest('runs admitted ${api}', async () => { ${call} });`;
      const { result } = runProbe(t, source);
      assert.equal(result.status, 0, `${command} through ${api} failed:\n${result.stdout}\n${result.stderr}`);
    });
  }
}


test('the local host tier reports the actual platform release architecture and Node major', (t) => {
  const source = "import { spawnSync } from 'node:child_process';\ntest('host identity body', () => { spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source, { env: { GITHUB_ACTIONS: '' } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const queried = (answer) => {
    assert.equal(answer.status, 0, answer.stderr);
    assert.ok(answer.stdout.trim());
    return answer.stdout.trim();
  };
  const release = queried(process.platform === 'darwin'
    ? spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' })
    : spawnSync('uname', ['-r'], { encoding: 'utf8' }));
  const platform = process.platform === 'darwin' ? 'macos' : 'linux';
  const architecture = queried(spawnSync('uname', ['-m'], { encoding: 'utf8' }));
  assert.equal(result.stdout.split('\n')[0], `${platform}-${release}-${architecture}-node${process.versions.node.split('.')[0]}`);
  assert.ok(reportsPassedTest(result.stdout, 'host identity body'), result.stdout);
});


/** Controlled executable metadata models; these runs are fixture evidence, not Mac host results. */
function metadataProbe(t, { platform = 'Linux', read, failure, poisonMac = false, ci = false } = {}) {
  const directory = temporaryDirectory('rigger-host-metadata-', { context: t });
  const tools = join(directory, 'tools');
  mkdirSync(tools);
  const trace = join(directory, 'metadata-calls');
  const marker = join(directory, 'test-body');
  const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
  for (const name of ['node', 'sh', 'git', 'mktemp', 'mkdir', 'chmod', 'rm', 'mkfifo', 'cat', 'ln', 'rmdir']) {
    const lookup = name === 'node' ? { status: 0, stdout: process.execPath } : spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' });
    assert.equal(lookup.status, 0, `fixture tool ${name}: ${lookup.stderr}`);
    symlinkSync(lookup.stdout.trim(), join(tools, name));
  }
  const answer = (selected, value) => selected === read && failure === 'nonzero'
    ? "printf '%s\\n' 'fixture metadata read failed' >&2; exit 37"
    : selected === read && failure === 'empty' ? 'exit 0' : `printf '%s\\n' ${quote(value)}`;
  const removeAfterOs = failure === 'missing' && ((platform === 'Linux' && read === 'release') || (platform === 'Darwin' && read === 'architecture'));
  const removeAfterRelease = failure === 'missing' && platform === 'Linux' && read === 'architecture';
  const uname = `#!/bin/sh
# ABOUTME: Models selected OS metadata reads and records which were requested.
printf 'uname %s\\n' "$*" >> ${quote(trace)}
case "$1" in
  -s) printf '%s\\n' ${quote(platform)}; ${removeAfterOs ? 'rm -f "$0";' : ''} exit 0 ;;
  -r) ${answer('release', 'fixture-kernel')}; ${removeAfterRelease ? 'rm -f "$0";' : ''} exit 0 ;;
  -m) ${answer('architecture', 'fixture-machine')}; exit 0 ;;
  *) exit 41 ;;
esac
`;
  writeFileSync(join(tools, 'uname'), uname);
  chmodSync(join(tools, 'uname'), 0o755);
  if (!(platform === 'Darwin' && read === 'version' && failure === 'missing') && (platform === 'Darwin' || poisonMac)) {
    writeFileSync(join(tools, 'sw_vers'), `#!/bin/sh\n# ABOUTME: Models Mac metadata or refuses an inactive Linux metadata read.\nprintf 'sw_vers %s\\n' "$*" >> ${quote(trace)}\n${poisonMac ? 'exit 39' : answer('version', 'fixture-product')}\n`);
    chmodSync(join(tools, 'sw_vers'), 0o755);
  }
  const source = "import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\ntest('metadata test body', () => { writeFileSync(process.env.HOST_METADATA_BODY, 'ran'); spawnSync('git', ['--version']); });";
  const { result } = hostProbe(t, source, { env: {
    PATH: tools, HOST_METADATA_BODY: marker, GITHUB_ACTIONS: ci ? 'true' : '',
    ...(ci ? { ImageOS: 'fixture-ci', ImageVersion: 'fixture-image', RUNNER_ARCH: 'fixture-architecture' } : {}),
  } });
  return { result, marker, calls: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [] };
}

test('selected local metadata failures refuse before a test body and name every failed read', (t) => {
  for (const platform of ['Darwin', 'Linux']) {
    for (const read of [platform === 'Darwin' ? 'version' : 'release', 'architecture']) {
      for (const failure of ['missing', 'nonzero', 'empty']) {
        const label = `${platform}/${read}/${failure}`;
        const { result, marker } = metadataProbe(t, { platform, read, failure });
        assert.equal(result.error, undefined, label);
        assert.notEqual(result.status, 0, `${label}: ${result.stdout + result.stderr}`);
        const command = read === 'version' ? 'sw_vers -productVersion' : read === 'release' ? 'uname -r' : 'uname -m';
        assert.ok(result.stderr.includes(command), `${label}: ${result.stderr}`);
        assert.equal(existsSync(marker), false, `${label}: a test body started after invalid metadata`);
        assert.equal(result.stdout, '', `${label}: no fabricated host key`);
      }
    }
  }
});


test('declared metadata fixtures retain exact Mac and Linux keys and Linux never calls an absent or refusing Mac tool', (t) => {
  for (const [platform, poisonMac] of [['Darwin', false], ['Linux', false], ['Linux', true]]) {
    const { result, marker, calls } = metadataProbe(t, { platform, poisonMac });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const expected = platform === 'Darwin' ? 'macos-fixture-product-fixture-machine' : 'linux-fixture-kernel-fixture-machine';
    assert.equal(result.stdout.split('\n')[0], expected + '-node' + process.versions.node.split('.')[0]);
    assert.deepEqual(calls, platform === 'Darwin'
      ? ['uname -s', 'sw_vers -productVersion', 'uname -m']
      : ['uname -s', 'uname -r', 'uname -m']);
    assert.equal(readFileSync(marker, 'utf8'), 'ran');
    assert.ok(reportsPassedTest(result.stdout, 'metadata test body'), result.stdout);
  }
});

test('CI metadata takes precedence without consulting local OS or Mac metadata tools', (t) => {
  const { result, marker, calls } = metadataProbe(t, { platform: 'Unsupported', poisonMac: true, ci: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.split('\n')[0], 'fixture-ci-fixture-image-fixture-architecture-node' + process.versions.node.split('.')[0]);
  assert.deepEqual(calls, []);
  assert.equal(readFileSync(marker, 'utf8'), 'ran');
});

test('an unsupported local OS is named and refused before any host test body', (t) => {
  const { result, marker, calls } = metadataProbe(t, { platform: 'Unsupported', poisonMac: true });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported local host Unsupported/);
  assert.equal(result.stdout, '');
  assert.deepEqual(calls, ['uname -s']);
  assert.equal(existsSync(marker), false);
});

for (const state of ['alias', 'absent']) {
  test(`host path refusal names an isolated ${state} operand before loading its test body`, (t) => {
    const { directory, marker, environment } = isolatedHostTree(t);
    const alias = join(directory, 'TEST');
    if (state === 'alias' && !existsSync(alias)) symlinkSync('test', alias, 'dir');
    const operand = state === 'alias' ? 'TEST/other.test.mjs' : 'TEST/missing.test.mjs';
    if (state === 'alias') {
      assert.equal(realpathSync.native(join(directory, operand)), realpathSync.native(join(directory, 'test/other.test.mjs')));
    } else {
      assert.equal(existsSync(join(directory, operand)), false, 'the absent fixture operand exists');
    }
    const result = spawnSync('sh', ['test/suite.sh', '--host', operand], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 60_000,
    });
    assert.notEqual(result.status, 0, `${state} operand was admitted`);
    assert.equal(result.stdout, '', `${state} operand ran before its refusal`);
    assert.equal(existsSync(marker), false, `${state} operand loaded a test body`);
    assert.equal(result.stderr, state === 'alias'
      ? 'test:host: test/other.test.mjs is not on the host list\n'
      : 'test:host: TEST/missing.test.mjs is not a literal existing file path; named test files must be on the host list\n');
  });
}

function timerProbe(t, source, files = {}, { tier = 'bounded', record = false, preload, reporter } = {}) {
  const { directory, environment } = isolatedHostTree(t);
  const file = tier === 'host' ? 'test/host.test.mjs' : 'test/other.test.mjs';
  const recordDirectory = temporaryDirectory('rigger-timer-record-', { context: t });
  delete environment.RIGGER_SUITE_TIMER_RECORD;
  if (preload) environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ''} --require=${JSON.stringify(join(directory, preload))}`;
  if (record) environment.RIGGER_SUITE_TIMER_RECORD = recordDirectory;
  if (tier === 'converting') {
    const suite = join(directory, 'test/suite.sh');
    const script = readFileSync(suite, 'utf8');
    assert.equal([...script.matchAll(/converting_tests='[\s\S]*?'/g)].length, 1);
    writeFileSync(suite, script.replace(/converting_tests='[\s\S]*?'/, `converting_tests='\n${file}\n'`));
  }
  for (const [name, content] of Object.entries(files)) {
    const destination = join(directory, name);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    writeFileSync(destination, content);
  }
  const nativeEffects = join(directory, 'native-timer-effects.jsonl');
  const positionEvents = join(directory, 'timer-position-events.jsonl');
  writeFileSync(nativeEffects, '');
  writeFileSync(positionEvents, '');
  writeFileSync(join(directory, 'native-timer-audit.mjs'), `// ABOUTME: Observes native Timeout creation and dispatch within an explicitly scoped API attempt.
import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
const scope = new AsyncLocalStorage();
const timers = new Set();
const record = event => appendFileSync(${JSON.stringify(nativeEffects)}, JSON.stringify(event) + '\\n');
createHook({
  init(id, type) {
    if (type === 'Timeout' && scope.getStore() === true) {
      timers.add(id);
      record({ event: 'native-timer-created', id });
    }
  },
  before(id) {
    if (timers.has(id)) record({ event: 'native-timer-callback', id });
  },
}).enable();
export const observeArm = action => scope.run(true, action);
export const timerCallback = () => record({ event: 'callback-effect' });
export const note = event => appendFileSync(${JSON.stringify(positionEvents)}, JSON.stringify(event) + '\\n');
`);
  writeFileSync(join(directory, file), "// ABOUTME: Exercises the suite's timer contract in its own worker.\nimport { test } from 'node:test';\nimport { observeArm, timerCallback, note } from '../native-timer-audit.mjs';\nconsole.log('timer-worker ' + process.pid);\n" + source + '\n');
  const result = spawnSync('sh', ['test/suite.sh', ...(tier === 'host' ? ['--host'] : []), ...(reporter ? [`--test-reporter=${reporter}`] : []), file], {
    cwd: directory, env: environment, encoding: 'utf8', timeout: 60_000,
  });
  return { directory, file, recordDirectory, nativeEffects, positionEvents, result };
}

function assertNoNativeTimers({ nativeEffects }) {
  assert.equal(readFileSync(nativeEffects, 'utf8'), '', 'a refused API created a native timer or dispatched its callback');
}

function assertTimerRefused(probe, title, api) {
  const { file, result } = probe;
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.notEqual(result.status, 0, output);
  assert.ok(output.includes(`deterministic tier: ${file}`), output);
  assert.ok(output.includes(`cannot arm ${api}`), output);
  if (title !== null) {
    assert.ok(output.includes(`✖ ${title} (`) || output.includes(`not ok 1 - ${title}`), output);
  }
  assertNoNativeTimers(probe);
  return output;
}

// A positive timer that is cleared immediately still breaks the deterministic bound.
test('timer bound T1 refuses a positive global setTimeout', (t) => {
  const title = 'arms a positive global timeout';
  const probe = timerProbe(t, `test('${title}', () => observeArm(() => { clearTimeout(setTimeout(timerCallback, 5)); }));`);
  assertTimerRefused(probe, title, 'setTimeout');
});

// Catching the timer's exception in src/ must not turn the violating test green.
test('timer bound T9a refuses a timer whose error the source catches', (t) => {
  const title = 'source returns after catching the timer error';
  const probe = timerProbe(t, `
import assert from 'node:assert/strict';
import { arm } from '../src/clocked.mjs';
test('${title}', () => {
  assert.equal(observeArm(arm), 'returned normally');
  console.log('source returned normally');
});`, {
    'src/clocked.mjs': "// ABOUTME: Catches a real timer's error and returns normally.\nimport { timerCallback } from '../native-timer-audit.mjs';\nexport function arm() { try { clearTimeout(setTimeout(timerCallback, 5)); } catch {} return 'returned normally'; }\n",
  });
  const output = probe.result.stdout + probe.result.stderr;
  assert.match(output, /source returned normally/);
  assertTimerRefused(probe, title, 'setTimeout');
});

// Each API must reach the bound even when it has its own built-in module binding.
for (const [row, api, imports, arm] of [
  ['T2', 'setInterval', '', 'clearInterval(setInterval(timerCallback, 5));'],
  ['T3', 'node:timers.setTimeout', "import { setTimeout as arm } from 'node:timers';", 'clearTimeout(arm(timerCallback, 5));'],
  ['T4', 'node:timers.setInterval', "import { setInterval as arm } from 'node:timers';", 'clearInterval(arm(timerCallback, 5));'],
  ['T5', 'node:timers/promises.setTimeout', "import { setTimeout as arm } from 'node:timers/promises';", 'await arm(5);'],
  ['T5a', 'scheduler.wait', "import { scheduler } from 'node:timers/promises';", 'await scheduler.wait(5);'],
  ['T6', 'node:timers/promises.setInterval', "import { setInterval as arm } from 'node:timers/promises';", 'for await (const value of arm(5)) { break; }'],
  ['T7', 'AbortSignal.timeout', '', 'AbortSignal.timeout(5);'],
  ['T14a', 'node:timers/promises.setTimeout', "import { setTimeout as arm } from 'node:timers/promises';", "t.mock.timers.enable({ apis: ['setTimeout'] }); await arm(5);"],
]) {
  test(`timer bound ${row} refuses ${api}`, (t) => {
    const title = `arms ${api}`;
    const probe = timerProbe(t, `${imports}\ntest(${JSON.stringify(title)}, async (t) => observeArm(async () => { ${arm} }));`);
    assertTimerRefused(probe, title, api);
  });
}

test('timer bound T8 refuses an arm while its file loads', (t) => {
  const probe = timerProbe(t, "observeArm(() => setTimeout(timerCallback, 5));\ntest('load completed', () => console.log('body reached'));\n");
  const output = assertTimerRefused(probe, null, 'setTimeout');
  assert.doesNotMatch(output, /body reached/);
});

test('timer bound T9 refuses an arm from a src module', (t) => {
  const title = 'calls the src timer';
  const probe = timerProbe(t, `import { arm } from '../src/clocked.mjs';\ntest('${title}', () => observeArm(arm));`, {
    'src/clocked.mjs': "// ABOUTME: Arms a real callback timer for the deterministic-worker probe.\nimport { timerCallback } from '../native-timer-audit.mjs';\nexport function arm() { clearTimeout(setTimeout(timerCallback, 5)); }\n",
  });
  assertTimerRefused(probe, title, 'setTimeout');
});

function assertTimerPassed({ result }, title) {
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 0, output);
  assert.ok(reportsPassedTest(result.stdout, title), output);
}

const timerTimeoutOptions = new URL('./settles-within.mjs', import.meta.url).href;
for (const [row, title, source] of [
  ['T11', 'zero omitted negative and nonnumeric delays pass', `test('allowed timer', () => {
    for (const delay of [0, -1, NaN, 'not a number']) clearTimeout(setTimeout(() => {}, delay));
    clearTimeout(setTimeout(() => {}));
  });`],
  ['T12', 'immediates microtasks and next ticks pass', `test('allowed timer', async () => {
    await Promise.all([
      new Promise(resolve => setImmediate(resolve)),
      new Promise(resolve => queueMicrotask(resolve)),
      new Promise(resolve => process.nextTick(resolve)),
    ]);
  });`],
  ['T13', 'the shared node test timeout passes', `import { SETTLES_WITHIN } from ${JSON.stringify(timerTimeoutOptions)};
    test('allowed timer', SETTLES_WITHIN[10_000], () => {});`],
  ['T14', 'a callback answered by the node timer mock passes', `import assert from 'node:assert/strict';
    test('allowed timer', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let fired = false;
      setTimeout(() => { fired = true; }, 5);
      t.mock.timers.tick(5);
      assert.equal(fired, true);
    });`],
]) {
  test(`timer bound ${row} ${title}`, (t) => {
    assertTimerPassed(timerProbe(t, source), 'allowed timer');
  });
}

function timerRecords({ recordDirectory, result }) {
  const names = readdirSync(recordDirectory);
  const worker = /timer-worker (\d+)/.exec(result.stdout);
  assert.ok(worker, result.stdout + result.stderr);
  if (names.length) assert.deepEqual(names, [`${worker[1]}.jsonl`]);
  return names.flatMap(name => readFileSync(join(recordDirectory, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
}

// A ran line distinguishes a timer-free worker from a worker that was never run.
test('timer record R0 marks a conversion file that arms nothing', (t) => {
  const probe = timerProbe(t, "test('no timer', () => {});", {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'no timer');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R0', records }));
  assert.deepEqual(records, [{ file: probe.file, test: null, api: null, delay: null }]);
});

// JSON must preserve the title's bytes and the delay must be the number, not its source text.
test('timer record R1 appends a numeric arm under its top-level title', (t) => {
  const title = 'timer "quoted"\ncontinued';
  const probe = timerProbe(t, `test(${JSON.stringify(title)}, () => {
    clearTimeout(setTimeout(() => {}, '5'));
    console.log('arm body completed');
  });`, {}, { tier: 'converting', record: true });
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.equal(probe.result.status, 0, output);
  assert.match(output, /arm body completed/);
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R1', records }));
  assert.deepEqual(records, [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: title, api: 'setTimeout', delay: 5 },
  ]);
});

// Work A started retains A's ownership after A returns and B releases its continuation.
test('timer record R2 keeps a late promise arm under the test that started it', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let continuation;
    test('owner A', () => {
      continuation = gate.then(() => {
        clearTimeout(setTimeout(() => {}, 5));
        return 'late arm completed';
      });
    });
    test('running B', async () => {
      release();
      assert.equal(await continuation, 'late arm completed');
    });`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'owner A');
  assertTimerPassed(probe, 'running B');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R2', records }));
  assert.deepEqual(records, [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: 'owner A', api: 'setTimeout', delay: 5 },
  ]);
});

test('timer record R3 attributes subtests and describe children to their top-level call', (t) => {
  const probe = timerProbe(t, `import { describe, it } from 'node:test';
    test('outer test', async (t) => {
      await t.test('nested test', () => { clearTimeout(setTimeout(() => {}, 5)); });
    });
    describe('outer suite', () => {
      it('suite child', () => { clearTimeout(setTimeout(() => {}, 5)); });
    });`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'outer test');
  assertTimerPassed(probe, 'outer suite');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R3', records }));
  assert.deepEqual(records, [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: 'outer test', api: 'setTimeout', delay: 5 },
    { file: probe.file, test: 'outer suite', api: 'setTimeout', delay: 5 },
  ]);
});

test('timer record R4 attributes a load-time arm to no test', (t) => {
  const probe = timerProbe(t, "clearTimeout(setTimeout(() => {}, 5));\ntest('load completed', () => {});", {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'load completed');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R4', records }));
  assert.deepEqual(records, [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: null, api: 'setTimeout', delay: 5 },
  ]);
});

test('timer record R5 and bound T15 permit an unrecorded conversion timer when unset', (t) => {
  const probe = timerProbe(t, "test('unrecorded arm', () => { clearTimeout(setTimeout(() => {}, 5)); });", {}, { tier: 'converting' });
  assertTimerPassed(probe, 'unrecorded arm');
  assert.deepEqual(readdirSync(probe.recordDirectory), []);
});

test('timer record R7 excludes the node timeout option and mocked callback timers', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    import { SETTLES_WITHIN } from ${JSON.stringify(timerTimeoutOptions)};
    test('excluded timers', SETTLES_WITHIN[10_000], (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let fired = false;
      setTimeout(() => { fired = true; }, 5);
      t.mock.timers.tick(5);
      assert.equal(fired, true);
    });`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'excluded timers');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R7', records }));
  assert.deepEqual(records, [{ file: probe.file, test: null, api: null, delay: null }]);
});

test('timer record R8 records no arm for zero and omitted delays', (t) => {
  const probe = timerProbe(t, `test('zero timers', () => {
    clearTimeout(setTimeout(() => {}, 0));
    clearTimeout(setTimeout(() => {}));
  });`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'zero timers');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R8', records }));
  assert.deepEqual(records, [{ file: probe.file, test: null, api: null, delay: null }]);
});

test('timer bound T16 permits a host worker timer through the host runner', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    import { spawnSync } from 'node:child_process';
    test('host timer', () => {
      clearTimeout(setTimeout(() => {}, 5));
      assert.equal(spawnSync('git', ['--version']).status, 0);
    });`, {}, { tier: 'host' });
  assertTimerPassed(probe, 'host timer');
});

// A nested runner must not inherit the outer worker's recording destination.
test('timer record R6 removes the record variable before a nested node test run', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    import { spawnSync } from 'node:child_process';
    test('nested run', () => {
      const { NODE_TEST_CONTEXT, ...env } = process.env;
      const result = spawnSync(process.execPath, ['--test', 'test/nested.test.mjs'], {
        env, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.error, undefined, result.stdout + result.stderr);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });`, {
    'test/nested.test.mjs': "// ABOUTME: Observes the nested runner's environment.\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('record variable is absent', () => assert.equal(Object.hasOwn(process.env, 'RIGGER_SUITE_TIMER_RECORD'), false));\n",
  }, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'nested run');
  const records = timerRecords(probe);
  t.diagnostic(JSON.stringify({ row: 'R6', records }));
  assert.deepEqual(records, [{ file: probe.file, test: null, api: null, delay: null }]);
});

// Constructing an async iterator does not execute the native interval's generator body.
test('timer bound and record observe a promise interval only when iteration starts', (t) => {
  for (const tier of ['bounded', 'converting']) {
    const probe = timerProbe(t, `import assert from 'node:assert/strict';
      import { setInterval } from 'node:timers/promises';
      test('unused interval', async () => {
        const interval = setInterval(5);
        assert.deepEqual(await interval.return(), { value: undefined, done: true });
      });`, {}, { tier, record: tier === 'converting' });
    assertTimerPassed(probe, 'unused interval');
    if (tier === 'converting') {
      assert.deepEqual(timerRecords(probe), [{ file: probe.file, test: null, api: null, delay: null }]);
    }
  }
});

// A caught refusal belongs to its own test, even while another subtest finishes first.
test('timer bound keeps a caught refusal with its concurrent test', (t) => {
  const probe = timerProbe(t, `test('parallel timers', { concurrency: true }, async (t) => {
    let armed, release;
    const ready = new Promise(resolve => { armed = resolve; });
    const finish = new Promise(resolve => { release = resolve; });
    await Promise.all([
      t.test('violating child', async () => {
        try { observeArm(() => clearTimeout(setTimeout(timerCallback, 5))); } catch {}
        armed();
        await finish;
      }),
      t.test('clean child', async (child) => {
        await ready;
        child.after(release);
      }),
    ]);
  });`);
  const output = probe.result.stdout + probe.result.stderr;
  assertNoNativeTimers(probe);
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.match(output, /^\s+✖ violating child \(/m);
  assert.match(output, /^\s+✔ clean child \(/m);
});

test('timer bound refuses a caught source arm after root teardown', (t) => {
  const title = 'starts the late source call';
  const probe = timerProbe(t, `import { after } from 'node:test';
    import { arm } from '../src/clocked.mjs';
    after(() => console.log('fixture root teardown completed'));
    test(${JSON.stringify(title)}, () => {
      setImmediate(() => {
        observeArm(arm);
        console.log('late source returned normally');
      });
    });`, {
    'src/clocked.mjs': "// ABOUTME: Swallows a timer refusal and returns to a delayed caller.\nimport { timerCallback } from '../native-timer-audit.mjs';\nexport function arm() { try { clearTimeout(setTimeout(timerCallback, 5)); } catch {} }\n",
  });
  assertNoNativeTimers(probe);
  const { stdout, stderr, status, error } = probe.result;
  assert.equal(error, undefined, stdout + stderr);
  assert.match(stdout, /fixture root teardown completed[\s\S]*late source returned normally/);
  assert.notEqual(status, 0, stdout + stderr);
  assert.ok((stdout + stderr).includes(`deterministic tier: ${probe.file}: ${title} cannot arm setTimeout`), stdout + stderr);
});

test('timer bound retains failure through an exit callback resetting status', (t) => {
  const probe = timerProbe(t, `process.once('exit', () => {
    try { observeArm(() => clearTimeout(setTimeout(timerCallback, 5))); } catch {}
    process.exitCode = 0;
    note('exit callback returned normally');
  });
  test('registers the exit callback', () => {});`);
  assertNoNativeTimers(probe);
  assert.match(readFileSync(probe.positionEvents, 'utf8'), /exit callback returned normally/);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.ok(output.includes(`deterministic tier: ${probe.file}: <module> cannot arm setTimeout`), output);
});

test('timer bound retains failure when an exit throw is globally captured', (t) => {
  const probe = timerProbe(t, `process.setUncaughtExceptionCaptureCallback(() => {
    note('globally handled'); process.exitCode = 0;
  });
  process.once('exit', () => observeArm(() => clearTimeout(setTimeout(timerCallback, 5))));
  test('registers the exit throw', () => {});`);
  assertNoNativeTimers(probe);
  assert.match(readFileSync(probe.positionEvents, 'utf8'), /globally handled/);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.ok(output.includes(`deterministic tier: ${probe.file}: <module> cannot arm setTimeout`), output);
});

const refusalApis = [
  ['T1', 'setTimeout', '', 'setTimeout(callback, 5)', 'timeout'],
  ['T2', 'setInterval', '', 'setInterval(callback, 5)', 'interval'],
  ['T3', 'node:timers.setTimeout', "import { setTimeout as timer } from 'node:timers';", 'timer(callback, 5)', 'timeout'],
  ['T4', 'node:timers.setInterval', "import { setInterval as timer } from 'node:timers';", 'timer(callback, 5)', 'interval'],
  ['T5', 'node:timers/promises.setTimeout', "import { setTimeout as timer } from 'node:timers/promises';", 'timer(5)', 'promise'],
  ['T5a', 'scheduler.wait', "import { scheduler } from 'node:timers/promises';", 'scheduler.wait(5)', 'promise'],
  ['T6', 'node:timers/promises.setInterval', "import { setInterval as timer } from 'node:timers/promises';", 'timer(5)', 'iterator'],
  ['T7', 'AbortSignal.timeout', '', 'AbortSignal.timeout(5)', 'signal'],
  ['T14a', 'node:timers/promises.setTimeout', "import { setTimeout as timer } from 'node:timers/promises';\nimport { mock } from 'node:test';\nmock.timers.enable({ apis: ['setTimeout'] });", 'timer(5)', 'promise'],
];

const refusalModes = ['catch', 'finally', 'finally-break', 'finally-continue',
  'promise-catch', 'promise-then', 'all-settled', 'any', 'generator-return'];

function refusalSource([, , imports, expression, kind]) {
  const finish = kind === 'timeout' ? 'clearTimeout(armed);'
    : kind === 'interval' ? 'clearInterval(armed);'
    : kind === 'iterator' ? 'return armed.next().finally(() => armed.return());'
    : 'return armed;';
  return `// ABOUTME: Attempts the selected real timer and swallows its error through ordinary JavaScript completion paths.
${imports}
import { observeArm, timerCallback, note } from '../native-timer-audit.mjs';
export const rawArm = (callback = timerCallback) => ${expression};
export function attempt(mode) {
  note('attempt:' + mode);
  return observeArm(() => { const armed = rawArm(); ${finish} });
}
export async function silence(mode) {
  if (mode === 'finally') {
    try { await attempt(mode); } finally { return 'returned normally'; }
  }
  if (mode === 'catch') {
    try { await attempt(mode); } catch {}
  } else if (mode === 'finally-break') {
    for (;;) { try { await attempt(mode); } finally { break; } }
  } else if (mode === 'finally-continue') {
    for (let index = 0; index < 1; index++) { try { await attempt(mode); } finally { continue; } }
  } else if (mode === 'generator-return') {
    async function* values() { try { await attempt(mode); } finally { yield 'suspended'; } }
    const iterator = values(); await iterator.next(); await iterator.return();
  } else {
    const pending = new Promise(resolve => resolve(attempt(mode)));
    if (mode === 'promise-catch') await pending.catch(() => {});
    else if (mode === 'all-settled') await Promise.allSettled([pending]);
    else if (mode === 'any') await Promise.any([pending, Promise.resolve('fallback')]);
    else await pending.then(undefined, () => {});
  }
  return 'returned normally';
}
`;
}

const refusalPositions = [
  ['module', "void run(); test(title, () => {});"],
  ['module-await', "await run(); test(title, () => {});"],
  ['suite-declaration', "describe('declaring suite', () => { void run(); test(title, () => {}); });"],
  ['before', "before(run); test(title, () => {});"],
  ['before-each', "beforeEach(run); test(title, () => {});"],
  ['body', 'test(title, run);'],
  ['nested-body', "test(title, async t => { await t.test('nested attempt', run); });"],
  ['concurrent-body', `test(title, { concurrency: true }, async t => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    await Promise.all([t.test('violating child', async () => { await run(); release(); }),
      t.test('clean child', async () => { await gate; note('clean-child-returned'); })]);
  });`],
  ['context-before', "test(title, async t => { t.before(run); await t.test('child', () => {}); });"],
  ['context-before-each', "test(title, async t => { t.beforeEach(run); await t.test('child', () => {}); });"],
  ['context-after-each', "test(title, async t => { t.afterEach(run); await t.test('child', () => {}); });"],
  ['context-after', 'test(title, t => { t.after(run); });'],
  ['after-each', 'afterEach(run); test(title, () => {});'],
  ['after', 'after(run); test(title, () => {});'],
  ['during-other-test', `let release, continuation; const gate = new Promise(resolve => { release = resolve; });
    test(title, t => { t.after(() => note('origin-after')); continuation = gate.then(run); });
    test('other running test', async () => { note('other-running'); release(); await continuation; });`],
  ['next-tick', 'test(title, () => { process.nextTick(run); });'],
  ['microtask', 'test(title, () => { queueMicrotask(run); });'],
  ['after-root', 'test(title, () => { setImmediate(run); });'],
  ['after-root-promise', 'test(title, () => { setImmediate(() => Promise.resolve().then(run)); });'],
  ['after-root-explicit-exit', 'test(title, () => { setImmediate(async () => { await run(); process.exit(0); }); });'],
  ['before-exit', "process.once('beforeExit', run); test(title, () => {});"],
  ['exit', "process.once('exit', run); test(title, () => {});"],
];

// Each cell checks the completion paths independently through its attempt/return ledger.
for (const [position, schedule] of refusalPositions) {
  for (const api of refusalApis) {
    test(`timer refusal matrix ${position} ${api[0]}`, (t) => {
      const title = `origin ${position} ${api[0]}`;
      const source = `import assert from 'node:assert/strict';
        import { before, beforeEach, afterEach, after, describe } from 'node:test';
        import { silence } from '../src/clocked.mjs';
        const title = ${JSON.stringify(title)};
        const modes = ${JSON.stringify(refusalModes)};
        after(() => note('root-after'));
        const run = async () => {
          note('position');
          await Promise.all(modes.map(async mode => {
            assert.equal(await silence(mode), 'returned normally');
            process.exitCode = 0;
            note('returned:' + mode);
          }));
        };
        ${schedule}`;
      const probe = timerProbe(t, source, { 'src/clocked.mjs': refusalSource(api) });
      assertNoNativeTimers(probe);
      const events = readFileSync(probe.positionEvents, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const output = probe.result.stdout + probe.result.stderr;
      for (const mode of refusalModes) {
        assert.equal(events.filter(event => event === `attempt:${mode}`).length, 1, JSON.stringify(events));
        assert.equal(events.filter(event => event === `returned:${mode}`).length, 1, JSON.stringify(events));
      }
      if (['after-root', 'after-root-promise', 'after-root-explicit-exit', 'before-exit', 'exit'].includes(position)) {
        assert.ok(events.indexOf('root-after') < events.indexOf('position'), JSON.stringify(events));
      }
      if (position === 'during-other-test') {
        assert.ok(events.indexOf('origin-after') < events.indexOf('other-running'), JSON.stringify(events));
        assert.ok(events.indexOf('other-running') < events.indexOf('position'), JSON.stringify(events));
      }
      assert.equal(probe.result.error, undefined, output);
      assert.notEqual(probe.result.status, 0, output);
      assert.ok(output.includes(`deterministic tier: ${probe.file}:`), output);
      assert.ok(output.includes(`cannot arm ${api[1]} with delay 5`), output);
      if (['body', 'after-root', 'after-root-promise', 'after-root-explicit-exit', 'during-other-test'].includes(position)) {
        assert.ok(output.includes(`: ${title} cannot arm ${api[1]}`), output);
      }
    });
  }
}

for (const handling of ['uncaught-listener', 'uncaught-capture', 'domain', 'unhandled-rejection']) {
  for (const api of refusalApis) {
    test(`timer refusal global ${handling} ${api[0]}`, (t) => {
      const setup = handling === 'uncaught-capture'
        ? 'process.setUncaughtExceptionCaptureCallback(handled);'
        : handling === 'domain' ? "const { create } = await import('node:domain'); const domain = create(); domain.on('error', handled);"
          : `process.on('${handling === 'unhandled-rejection' ? 'unhandledRejection' : 'uncaughtException'}', handled);`;
      const dispatch = handling === 'unhandled-rejection'
        ? "void Promise.resolve().then(() => attempt('global'));"
        : "const pending = attempt('global'); if (pending?.then) pending.catch(error => setImmediate(() => { throw error; }));";
      const probe = timerProbe(t, `import { after } from 'node:test';
        import { attempt } from '../src/clocked.mjs';
        const handled = () => { note('handled'); process.exitCode = 0; };
        ${setup}
        after(() => note('root-after'));
        test('starts the globally handled source call', () => {
          ${handling === 'domain' ? 'domain.run(() => {' : ''}
          setImmediate(() => { note('position'); ${dispatch} });
          ${handling === 'domain' ? '});' : ''}
        });`, { 'src/clocked.mjs': refusalSource(api) });
      assertNoNativeTimers(probe);
      const events = readFileSync(probe.positionEvents, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(events.indexOf('root-after') < events.indexOf('position'), JSON.stringify(events));
      assert.equal(events.filter(event => event === 'attempt:global').length, 1, JSON.stringify(events));
      assert.equal(events.filter(event => event === 'handled').length, 1, JSON.stringify(events));
      const output = probe.result.stdout + probe.result.stderr;
      assert.equal(probe.result.error, undefined, output);
      assert.notEqual(probe.result.status, 0, output);
      assert.ok(output.includes(`deterministic tier: ${probe.file}: starts the globally handled source call cannot arm ${api[1]}`), output);
    });
  }
}

// The observer must see real native resources and dispatch for every refused API binding.
for (const api of refusalApis) {
  test(`timer native audit calibration ${api[0]}`, (t) => {
    const kind = api[4];
    const action = kind === 'timeout' || kind === 'interval'
      ? `await new Promise(resolve => { const handle = rawArm(() => { timerCallback(); ${kind === 'interval' ? 'clearInterval(handle);' : ''} resolve(); }); });`
      : kind === 'iterator' ? 'for await (const value of rawArm()) break;'
      : kind === 'signal' ? `await new Promise(resolve => { const signal = rawArm(); signal.addEventListener('abort', resolve);
          const keepAlive = () => { if (!signal.aborted) setImmediate(keepAlive); }; keepAlive(); });`
      : 'await rawArm();';
    const probe = timerProbe(t, `import { rawArm } from '../src/clocked.mjs';
      test('native calibration', async () => observeArm(async () => { ${action} }));`,
    { 'src/clocked.mjs': refusalSource(api) }, { tier: 'converting' });
    assertTimerPassed(probe, 'native calibration');
    const events = readFileSync(probe.nativeEffects, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.event === 'native-timer-created').length, 1, JSON.stringify(events));
    assert.equal(events.filter(event => event.event === 'native-timer-callback').length, 1, JSON.stringify(events));
    if (kind === 'timeout' || kind === 'interval') {
      assert.equal(events.filter(event => event.event === 'callback-effect').length, 1, JSON.stringify(events));
    }
  });
}

function printedTimerRefusals({ result }) {
  return result.stderr.split('\n').filter(line => line.startsWith('{"file":')).map(line => JSON.parse(line));
}

// The supervisor must retain the refusal after every way its worker can end.
const refusalEnds = [
  ['normal-return', "await attempt('end');"],
  ['caught', 'await caught();'],
  ['caught-exit', "await caught(); note('terminating'); process.exit(0);"],
  ['exit-caught', "process.once('exit', AsyncResource.bind(async () => { note('exit-entered'); await caught(); note('terminating'); process.exit(0); }));"],
  ['exit-continuation', "process.once('exit', AsyncResource.bind(() => { note('exit-entered'); caught().then(() => { note('terminating'); process.exit(0); }); }));"],
  ['really-exit', "await caught(); note('terminating'); process.reallyExit(0);"],
  ['sigkill', "await caught(); note('terminating'); process.kill(process.pid, 'SIGKILL');"],
  ['exit-sync', `process.once('exit', AsyncResource.bind(() => {
    note('exit-entered');
    try { const pending = attempt('end'); pending?.catch(() => {}); } catch {}
    note('terminating'); process.exit(0);
  }));`],
];

for (const [ending, action] of refusalEnds) {
  for (const api of refusalApis) {
    test(`timer refusal supervisor ${ending} ${api[0]}`, (t) => {
      const title = `origin ${ending} ${api[0]}`;
      const inExit = ending.startsWith('exit-');
      const probe = timerProbe(t, `import assert from 'node:assert/strict';
        import { after } from 'node:test';
        import { AsyncResource } from 'node:async_hooks';
        import { attempt, silence } from '../src/clocked.mjs';
        after(() => note('root-after'));
        const caught = async () => {
          assert.equal(await silence('catch'), 'returned normally');
          note('source-returned');
        };
        test(${JSON.stringify(title)}, async () => { ${action} });`,
      { 'src/clocked.mjs': refusalSource(api) });
      assertNoNativeTimers(probe);
      const events = readFileSync(probe.positionEvents, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.filter(event => event.startsWith('attempt:')).length, 1, JSON.stringify(events));
      if (inExit) assert.ok(events.indexOf('root-after') < events.indexOf('exit-entered'), JSON.stringify(events));
      if (!['normal-return', 'exit-sync'].includes(ending)) assert.equal(events.filter(event => event === 'source-returned').length, 1, JSON.stringify(events));
      if (!['normal-return', 'caught'].includes(ending)) assert.ok(events.includes('terminating'), JSON.stringify(events));
      assert.equal(probe.result.error, undefined, probe.result.stdout + probe.result.stderr);
      assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: api[1], delay: 5 }, { file: probe.file, test: title, api: api[1], delay: 5 }],
        'the supervisor must print the refusal recorded before the worker ended');
      assert.ok((probe.result.stdout + probe.result.stderr).includes(`: ${title} cannot arm ${api[1]} with delay 5`), probe.result.stdout + probe.result.stderr);
      assert.notEqual(probe.result.status, 0, 'a recorded timer refusal must fail the suite regardless of worker termination');
    });
  }
}

for (const [binding, imports, expression] of [
  ['global', '', 'globalThis.setTimeout'],
  ['timers', "import { setTimeout } from 'node:timers';", 'setTimeout'],
]) {
  for (const mode of ['zero', 'positive', 'conversion']) {
    test(`timer promisify ${mode} ${binding}`, (t) => {
      const title = `promisify ${mode} ${binding} preserves its contract`;
      const delay = mode === 'zero' ? 0 : 5;
      const probe = timerProbe(t, `import assert from 'node:assert/strict';
        import { promisify } from 'node:util';
        ${imports}
        test(${JSON.stringify(title)}, async () => {
          const value = await observeArm(() => promisify(${expression})(${delay}, 'completed'));
          assert.equal(value, 'completed');
          note('value:completed');
        });`, {}, { tier: mode === 'conversion' ? 'converting' : 'bounded', record: mode === 'conversion' });
      if (mode === 'positive') {
        assertNoNativeTimers(probe);
        assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'node:timers/promises.setTimeout', delay: 5 }, { file: probe.file, test: title, api: 'node:timers/promises.setTimeout', delay: 5 }]);
        assert.ok((probe.result.stdout + probe.result.stderr).includes(`: ${title} cannot arm node:timers/promises.setTimeout`), probe.result.stdout + probe.result.stderr);
        assert.notEqual(probe.result.status, 0, probe.result.stdout + probe.result.stderr);
      } else {
        assertTimerPassed(probe, title);
        assert.deepEqual(readFileSync(probe.positionEvents, 'utf8').trim().split('\n').map(line => JSON.parse(line)), ['value:completed']);
        if (mode === 'conversion') {
          const records = timerRecords(probe);
          t.diagnostic(JSON.stringify({ binding, records }));
          assert.deepEqual(records, [
            { file: probe.file, test: null, api: null, delay: null },
            { file: probe.file, test: title, api: 'node:timers/promises.setTimeout', delay: 5 },
          ]);
        }
      }
    });
  }
}

// Node's own promisify operation can have cached a self-reference before this preload runs.
test('timer promisify seeded promise custom remains bounded', (t) => {
  const title = 'a previously promisified promise binding still refuses a positive delay';
  const probe = timerProbe(t, `import { promisify } from 'node:util';
    import { setTimeout } from 'node:timers/promises';
    test(${JSON.stringify(title)}, async () => {
      await observeArm(() => promisify(setTimeout)(5));
    });`, {
    'seed-promisify.cjs': "// ABOUTME: Exercises Node's ordinary promisify cache before the suite guard installs.\nif (process.env.NODE_TEST_CONTEXT === 'child-v8') require('node:util').promisify(require('node:timers').setTimeout);\n",
  }, { preload: 'seed-promisify.cjs' });
  assertNoNativeTimers(probe);
  assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'node:timers/promises.setTimeout', delay: 5 }, { file: probe.file, test: title, api: 'node:timers/promises.setTimeout', delay: 5 }]);
  assert.ok((probe.result.stdout + probe.result.stderr).includes(`: ${title} cannot arm node:timers/promises.setTimeout`), probe.result.stdout + probe.result.stderr);
  assert.notEqual(probe.result.status, 0, probe.result.stdout + probe.result.stderr);
});

test('timer refusal supervisor records a numeric delay and names an escaped title', (t) => {
  const title = 'outside "worker"\nreturned';
  const probe = timerProbe(t, `test(${JSON.stringify(title)}, () => {
    try { observeArm(() => clearTimeout(setTimeout(timerCallback, '5'))); } catch {}
  });`);
  assertNoNativeTimers(probe);
  assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'setTimeout', delay: 5 }, { file: probe.file, test: title, api: 'setTimeout', delay: 5 }]);
  assert.ok((probe.result.stdout + probe.result.stderr).includes(`: ${title} cannot arm setTimeout with delay 5`), probe.result.stdout + probe.result.stderr);
  assert.notEqual(probe.result.status, 0, probe.result.stdout + probe.result.stderr);
});

test('timer refusal destination is removed before the module evaluates', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    assert.equal(Object.hasOwn(process.env, 'RIGGER_SUITE_TIMER_REFUSALS'), false);
    test('private refusal destination', () => {});`);
  assertTimerPassed(probe, 'private refusal destination');
});

// An unwritable record must end the worker before any catch or exit override can run.
const refusalWriteFailure = `// ABOUTME: Supplies an observed EIO for the supervisor refusal file alone.
if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  const fs = require('node:fs');
  const destination = process.env.RIGGER_SUITE_TIMER_REFUSALS;
  const append = fs.appendFileSync;
  fs.appendFileSync = function failingRefusalWrite(file, ...args) {
    if (file === destination) throw Object.assign(new Error('refusal-write-control'), { code: 'EIO' });
    return Reflect.apply(append, this, [file, ...args]);
  };
}
`;
for (const [ending, next] of [
  ['caught-return', "note('returned');"],
  ['caught-exit', "note('terminating'); process.exit(0);"],
  ['caught-really-exit', "note('terminating'); process.reallyExit(0);"],
  ['replaced-kill', "note('returned');"],
]) {
  for (const api of refusalApis) {
    test(`timer refusal EIO ${ending} ${api[0]}`, (t) => {
      const title = `unwritable refusal ${ending} ${api[0]}`;
      const probe = timerProbe(t, `import { attempt } from '../src/clocked.mjs';
        test(${JSON.stringify(title)}, async () => {
          ${ending === 'replaced-kill' ? "process.kill = () => note('replacement-kill');" : ''}
          try { await attempt('EIO'); } catch { note('caught'); }
          note('after-arm');
          ${next}
        });`, {
        'src/clocked.mjs': refusalSource(api),
        'refusal-write-failure.cjs': refusalWriteFailure,
      }, { preload: 'refusal-write-failure.cjs', reporter: 'tap' });
      assertNoNativeTimers(probe);
      const events = readFileSync(probe.positionEvents, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(events, ['attempt:EIO'], 'an unwritable refusal must not return or throw to its caller');
      assert.equal(probe.result.error, undefined, probe.result.stdout + probe.result.stderr);
      assert.notEqual(probe.result.status, 0, 'an unwritable refusal must fail the suite');
      // The spec reporter drops the worker's signal; TAP keeps it, and a plain exit shows none.
      assert.match(probe.result.stdout, /^\s*signal: 'SIGKILL'$/m, 'an unwritable refusal must end its worker by SIGKILL');
      const output = probe.result.stdout + probe.result.stderr;
      const unnamed = output.indexOf(`deterministic tier: ${probe.file}: cannot arm ${api[1]} with delay 5`);
      const named = output.indexOf(`deterministic tier: ${probe.file}: ${title} cannot arm ${api[1]} with delay 5`);
      assert.ok(unnamed !== -1 && named > unnamed, `the unnamed diagnostic, then the named one, must reach the output\n${output}`);
      assert.deepEqual(printedTimerRefusals(probe), []);
    });
  }
}

// Naming an unwritable refusal reads only own data properties, so no code a test supplies runs.
const forgedResource = (members, own) => `import { AsyncResource } from 'node:async_hooks';
  class Forged extends AsyncResource { getCtx() { return null; } ${members} }
  const resource = new Forged('Test');
  ${own}
  test('arms inside a forged resource', () => {
    resource.runInAsyncScope(() => observeArm(() => clearTimeout(setTimeout(timerCallback, 5))));
  });`;
const unwritableDiagnostics = (probe) => [...new Set((probe.result.stdout + probe.result.stderr)
  .match(/deterministic tier: [^\n]*cannot arm [^\n]*/g) ?? [])];
for (const [title, members, own] of [
  ['never runs a forged name getter', 'get name() { process.exit(0); }', 'resource.parent = {};'],
  ['never runs a forged parent getter', 'get parent() { process.exit(0); }', "resource.name = 'forged name';"],
]) {
  test(`timer refusal EIO ${title}`, (t) => {
    const probe = timerProbe(t, forgedResource(members, own), { 'refusal-write-failure.cjs': refusalWriteFailure },
      { preload: 'refusal-write-failure.cjs', reporter: 'tap' });
    assertNoNativeTimers(probe);
    assert.equal(probe.result.error, undefined, probe.result.stdout + probe.result.stderr);
    assert.notEqual(probe.result.status, 0, 'a forged accessor must not exit before the worker ends');
    assert.match(probe.result.stdout, /^\s*signal: 'SIGKILL'$/m, probe.result.stdout);
    assert.deepEqual(unwritableDiagnostics(probe), [`deterministic tier: ${probe.file}: cannot arm setTimeout with delay 5`]);
  });
}

test('timer refusal EIO names a forged data name', (t) => {
  const probe = timerProbe(t, forgedResource('', "resource.parent = {};\n  resource.name = 'forged name';"),
    { 'refusal-write-failure.cjs': refusalWriteFailure }, { preload: 'refusal-write-failure.cjs', reporter: 'tap' });
  assertNoNativeTimers(probe);
  assert.notEqual(probe.result.status, 0, probe.result.stdout + probe.result.stderr);
  assert.deepEqual(unwritableDiagnostics(probe), [
    `deterministic tier: ${probe.file}: cannot arm setTimeout with delay 5`,
    `deterministic tier: ${probe.file}: forged name cannot arm setTimeout with delay 5`,
  ]);
});

// Caller text is the test's own to choose, so it can never earn an exemption.
const callerDisguises = [
  ['T17', 'R9', 'a method named for the Node test runner', `const helper = { 'node:internal/test_runner/probe'() { clearTimeout(setTimeout(timerCallback, 5)); } };
    helper['node:internal/test_runner/probe']();`],
  ['T18', 'R10', 'a direct eval with a Node test runner source URL', `eval("clearTimeout(setTimeout(timerCallback, 5));\\n//# sourceURL=node:internal/test_runner/probe");`],
];
for (const [row, , title, body] of callerDisguises) {
  test(`timer bound ${row} refuses ${title}`, (t) => {
    const probe = timerProbe(t, `test(${JSON.stringify(title)}, () => observeArm(() => { ${body} }));`);
    assertTimerRefused(probe, title, 'setTimeout');
  });
}
for (const [, row, title, body] of callerDisguises) {
  test(`timer record ${row} records ${title}`, (t) => {
    const probe = timerProbe(t, `test(${JSON.stringify(title)}, () => observeArm(() => { ${body} }));`, {}, { tier: 'converting', record: true });
    assertTimerPassed(probe, title);
    const records = timerRecords(probe);
    t.diagnostic(JSON.stringify({ row, records }));
    assert.deepEqual(records, [
      { file: probe.file, test: null, api: null, delay: null },
      { file: probe.file, test: title, api: 'setTimeout', delay: 5 },
    ]);
  });
}

test('timer bound T19 converts an object delay once', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    test('allowed timer', () => {
      let conversions = 0;
      const delay = { valueOf() { conversions += 1; return 0; } };
      clearTimeout(setTimeout(() => {}, delay));
      assert.equal(conversions, 1, 'the delay was converted more than once');
    });`);
  assertTimerPassed(probe, 'allowed timer');
});

test('timer bound T20 arms the delay it checked', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    test('allowed timer', () => {
      let conversions = 0;
      const delay = { valueOf() { conversions += 1; return conversions === 1 ? 0 : 5; } };
      const timer = setTimeout(() => {}, delay);
      const armed = timer._idleTimeout;
      clearTimeout(timer);
      // Node arms a zero delay as one millisecond.
      assert.equal(armed, 1, 'the timer armed a delay other than the one the guard checked');
    });`);
  assertTimerPassed(probe, 'allowed timer');
});

test('timer bound T21 refuses a scheduler wait taken from its prototype', (t) => {
  const title = 'arms the prototype wait';
  const probe = timerProbe(t, `import { scheduler } from 'node:timers/promises';
    test(${JSON.stringify(title)}, async () => {
      const wait = Object.getPrototypeOf(scheduler).wait;
      await observeArm(() => wait.call(scheduler, 5));
    });`);
  assertTimerRefused(probe, title, 'scheduler.wait');
});

// Every documented way to reach a guarded function after the guard installs meets the same bound.
for (const [route, api, imports, arm] of [
  ['destructured', 'node:timers.setTimeout', "import timers from 'node:timers';", 'const { setTimeout: later } = timers; clearTimeout(later(timerCallback, 5));'],
  ['call', 'setTimeout', '', 'clearTimeout(setTimeout.call(globalThis, timerCallback, 5));'],
  ['apply', 'setTimeout', '', 'clearTimeout(setTimeout.apply(globalThis, [timerCallback, 5]));'],
  ['bind', 'setTimeout', '', 'clearTimeout(setTimeout.bind(globalThis)(timerCallback, 5));'],
  ['util.promisify', 'node:timers/promises.setTimeout', "import { promisify } from 'node:util';", 'await promisify(setTimeout)(5);'],
  ['timers.promises', 'node:timers/promises.setTimeout', "import timers from 'node:timers';", 'await timers.promises.setTimeout(5);'],
  ['ESM default import', 'node:timers.setInterval', "import timers from 'node:timers';", 'clearInterval(timers.setInterval(timerCallback, 5));'],
  ['createRequire', 'node:timers.setTimeout', "import { createRequire } from 'node:module';", "clearTimeout(createRequire(import.meta.url)('node:timers').setTimeout(timerCallback, 5));"],
  ['getBuiltinModule', 'node:timers.setTimeout', '', "clearTimeout(process.getBuiltinModule('node:timers').setTimeout(timerCallback, 5));"],
  ['getBuiltinModule scheduler', 'scheduler.wait', '', "await process.getBuiltinModule('node:timers/promises').scheduler.wait(5);"],
  ['async iterator', 'node:timers/promises.setInterval', "import { setInterval as every } from 'node:timers/promises';", 'await every(5)[Symbol.asyncIterator]().next();'],
  ['AbortSignal call', 'AbortSignal.timeout', '', 'AbortSignal.timeout.call(AbortSignal, 5);'],
]) {
  test(`timer route ${route} refuses ${api}`, (t) => {
    const title = `reaches ${api} by ${route}`;
    const probe = timerProbe(t, `${imports}\ntest(${JSON.stringify(title)}, async () => observeArm(async () => { ${arm} }));`);
    assertTimerRefused(probe, title, api);
  });
}

// Each API takes an object delay as Node does: the callback timers coerce it, the others reject it.
for (const [api, expression, coerces] of [
  ['setTimeout', 'clearTimeout(setTimeout(() => {}, delay))', true],
  ['setInterval', 'clearInterval(setInterval(() => {}, delay))', true],
  ['node:timers/promises.setTimeout', "await (await import('node:timers/promises')).setTimeout(delay)", false],
  ['scheduler.wait', "await (await import('node:timers/promises')).scheduler.wait(delay)", false],
  ['node:timers/promises.setInterval', "await (await import('node:timers/promises')).setInterval(delay).next()", false],
  ['AbortSignal.timeout', 'AbortSignal.timeout(delay)', false],
]) {
  test(`timer delay form object zero ${api}`, (t) => {
    const probe = timerProbe(t, `import assert from 'node:assert/strict';
      test('allowed timer', async () => {
        let conversions = 0;
        const delay = { valueOf() { conversions += 1; return 0; } };
        let code = null;
        try { ${expression}; } catch (error) { code = error.code; }
        assert.equal(code, ${coerces ? 'null' : "'ERR_INVALID_ARG_TYPE'"});
        assert.equal(conversions, 1);
      });`);
    assertTimerPassed(probe, 'allowed timer');
  });
}

// The guard wraps every timer function these lists hold; a new export would need its own wrapper.
test('timer surface is the one Node 26 exports', (t) => {
  const probe = timerProbe(t, `import assert from 'node:assert/strict';
    import timers from 'node:timers';
    import promises from 'node:timers/promises';
    test('surface', () => {
      assert.deepEqual(Object.keys(timers), ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'promises']);
      assert.deepEqual(Object.keys(promises), ['setTimeout', 'setImmediate', 'setInterval', 'scheduler']);
      assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(promises.scheduler)), ['constructor', 'yield', 'wait']);
      console.log('surface ' + process.version);
    });`);
  assertTimerPassed(probe, 'surface');
  t.diagnostic(/surface (v[0-9.]+)/.exec(probe.result.stdout)?.[1] ?? 'no version');
});

// The guard wraps the scheduler's prototype; Node's mock for that API must still answer the call.
test('timer mock answers scheduler.wait without a refusal', (t) => {
  const probe = timerProbe(t, `import { scheduler } from 'node:timers/promises';
    test('allowed timer', async (t) => {
      t.mock.timers.enable({ apis: ['scheduler.wait'] });
      const waited = scheduler.wait(5);
      t.mock.timers.tick(5);
      await waited;
    });`);
  assertTimerPassed(probe, 'allowed timer');
});

// A root hook's server handles requests with no test's run as their async owner.
const handlerServer = `import assert from 'node:assert/strict';
    import http from 'node:http';
    import { before, after } from 'node:test';
    let server;
    // A zero interval keeps the server from arming its own connection check.
    before(async () => {
      server = http.createServer({ connectionsCheckingInterval: 0 }, (request, response) => {
        try { clearTimeout(setTimeout(() => {}, 5)); } catch {}
        response.end('armed');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    });
    after(() => new Promise(resolve => server.close(resolve)));
    const fetchArm = () => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, agent: false }, (response) => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });`;
test('timer record attributes a root server handler arm to no test', (t) => {
  const probe = timerProbe(t, `${handlerServer}
    test('requests the handler', async () => { assert.equal(await fetchArm(), 'armed'); });`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'requests the handler');
  assert.deepEqual(timerRecords(probe), [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: null, api: 'setTimeout', delay: 5 },
  ]);
});

test('timer bound refuses a root server handler arm naming no test', (t) => {
  const probe = timerProbe(t, `${handlerServer}
    test('requests the handler', async () => { assert.equal(await fetchArm(), 'armed'); });`);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.ok(output.includes(`deterministic tier: ${probe.file}: <module> cannot arm setTimeout with delay 5`), output);
});

// A snapshot keeps the context it was taken in, so its arm stays with the test that took it.
test('timer record keeps a snapshot arm with the test that took the snapshot', (t) => {
  const probe = timerProbe(t, `import { AsyncLocalStorage } from 'node:async_hooks';
    let snapshot;
    test('takes the snapshot', () => { snapshot = AsyncLocalStorage.snapshot(); });
    test('runs the snapshot', () => snapshot(() => clearTimeout(setTimeout(() => {}, 5))));`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'runs the snapshot');
  assert.deepEqual(timerRecords(probe), [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: 'takes the snapshot', api: 'setTimeout', delay: 5 },
  ]);
});

// Module code still running after a top-level await belongs to no test, even while one runs.
test('timer record keeps a load-time arm after a top-level await with no test', (t) => {
  const probe = timerProbe(t, `let release;
    const gate = new Promise(resolve => { release = resolve; });
    test('runs while the file loads', async () => { release(); await new Promise(resolve => setImmediate(resolve)); });
    await gate;
    clearTimeout(setTimeout(() => {}, 5));`, {}, { tier: 'converting', record: true });
  assertTimerPassed(probe, 'runs while the file loads');
  assert.deepEqual(timerRecords(probe), [
    { file: probe.file, test: null, api: null, delay: null },
    { file: probe.file, test: null, api: 'setTimeout', delay: 5 },
  ]);
});

// An unowned refusal must fail the run, not stop the file's own teardown and hang its worker.
test('timer bound fails rather than hangs on an unowned refusal in a file with a root server', (t) => {
  const probe = timerProbe(t, `${handlerServer}
    try { clearTimeout(setTimeout(() => {}, 5)); } catch {}
    test('requests the handler', async () => { assert.equal(await fetchArm(), 'armed'); });`);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, `the run did not end within its bound\n${output}`);
  assert.notEqual(probe.result.status, 0, output);
  assert.ok(output.includes(`deterministic tier: ${probe.file}: <module> cannot arm setTimeout with delay 5`), output);
});

// A resource a test merely names 'Test' is not a test: it neither earns attribution nor stops the record.
test('timer bound refuses an arm inside a forged Test resource under the real test', (t) => {
  const title = 'forges a test resource';
  const probe = timerProbe(t, `import { AsyncResource } from 'node:async_hooks';
    test(${JSON.stringify(title)}, () => {
      const forged = new AsyncResource('Test');
      forged.parent = {};
      forged.name = 'forged';
      try { forged.runInAsyncScope(() => observeArm(() => clearTimeout(setTimeout(timerCallback, 5)))); } catch {}
    });`);
  assertNoNativeTimers(probe);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'setTimeout', delay: 5 }, { file: probe.file, test: title, api: 'setTimeout', delay: 5 }]);
  assert.ok((probe.result.stdout + probe.result.stderr).includes(`: ${title} cannot arm setTimeout with delay 5`), probe.result.stdout + probe.result.stderr);
});

// Attribution that fails gives no test, and the refusal is recorded before anything can throw.
test('timer bound records a refusal with no test when attribution throws', (t) => {
  const probe = timerProbe(t, `import { AsyncResource } from 'node:async_hooks';
    class Unreadable extends AsyncResource { getCtx() { throw new Error('no context'); } }
    test('owns an unreadable resource', () => {
      const resource = new Unreadable('Test');
      resource.parent = {};
      resource.name = 'unreadable';
      try { resource.runInAsyncScope(() => observeArm(() => clearTimeout(setTimeout(timerCallback, 5)))); } catch {}
    });`);
  assertNoNativeTimers(probe);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'setTimeout', delay: 5 }]);
  assert.ok(output.includes(`deterministic tier: ${probe.file}: <module> cannot arm setTimeout with delay 5`), output);
});

// Nothing a test-reachable object does during attribution, exiting included, may stop the record.
test('timer bound keeps a refusal when attribution exits the worker', (t) => {
  const probe = timerProbe(t, `import { AsyncResource } from 'node:async_hooks';
    class Exiting extends AsyncResource { getCtx() { process.exit(0); } }
    test('arms inside an exiting resource', () => {
      const resource = new Exiting('Test');
      resource.parent = {};
      resource.name = 'exiting resource';
      resource.runInAsyncScope(() => observeArm(() => clearTimeout(setTimeout(timerCallback, 5))));
    });`);
  assertNoNativeTimers(probe);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, 'an exit during attribution must not erase the refusal');
  assert.deepEqual(printedTimerRefusals(probe), [{ file: probe.file, api: 'setTimeout', delay: 5 }]);
});

// The record names the test after attribution, so a run whose worker closed its stderr and
// exited 0 still names the test that armed the timer.
test('timer bound names the test in the record when its worker closes stderr and exits 0', (t) => {
  const title = 'real timer owner closed-exit';
  const probe = timerProbe(t, `import { closeSync } from 'node:fs';
    test(${JSON.stringify(title)}, () => {
      closeSync(2); note('stderr closed');
      try { observeArm(() => clearTimeout(setTimeout(timerCallback, 5))); }
      catch { note('refusal caught'); }
      note('exiting successfully');
      process.exit(0);
    });`);
  assertNoNativeTimers(probe);
  const output = probe.result.stdout + probe.result.stderr;
  assert.equal(probe.result.error, undefined, output);
  assert.notEqual(probe.result.status, 0, output);
  assert.ok(output.includes(title), `the failed run must name the real test that armed the timer\n${output}`);
  assert.deepEqual(printedTimerRefusals(probe), [
    { file: probe.file, api: 'setTimeout', delay: 5 },
    { file: probe.file, test: title, api: 'setTimeout', delay: 5 },
  ]);
});
