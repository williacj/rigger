// ABOUTME: Tests the suite's two tiers, its list contract and the process bounds they enforce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
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
  'test/provider-codex.test.mjs',
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
expectedLists.host.push('test/claude-folder-live.test.mjs');
expectedLists.host.push('test/test-list-growth-host.test.mjs');
expectedLists.host.push('test/coordinator-launchers.test.mjs');
expectedLists.host.push('test/coordinator-suite-slot.test.mjs');
expectedLists.host.push('test/coordinator-sweep.test.mjs');
expectedLists.host.push('test/launchd-host.test.mjs');
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
  assert.ok(state.status !== 0 || state.stdout.trim().startsWith('Z'), 'the suite left the recorded process alive: ' + state.stdout);
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
