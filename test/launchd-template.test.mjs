// ABOUTME: Checks the shipped launchd job and that init leaves this host asset out of a consumer plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONFIG, TEMPLATES, plan } from '../src/cli/init.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const plist = () => readFileSync(join(TEMPLATES, 'launchd', 'com.williacj.rigger.plist'), 'utf8');

test('the shipped LaunchAgent has the fixed label', () => {
  assert.match(plist(), /<key>Label<\/key>\s*<string>com\.williacj\.rigger<\/string>/);
});

test('the shipped job runs the installed Rigger executable with run', () => {
  assert.match(plist(), /<key>ProgramArguments<\/key>\s*<array>\s*<string>__RIGGER__<\/string>\s*<string>run<\/string>\s*<\/array>/);
});

test('the shipped job runs in the owner-selected repository', () => {
  assert.match(plist(), /<key>WorkingDirectory<\/key>\s*<string>__REPOSITORY__<\/string>/);
});

test('the shipped job relaunches after the selected interval', () => {
  assert.match(plist(), /<key>StartInterval<\/key>\s*<integer>__START_INTERVAL__<\/integer>/);
});

test('the shipped job starts on load', () => {
  assert.match(plist(), /<key>RunAtLoad<\/key>\s*<true\s*\/>/);
});

test('the shipped job does not use KeepAlive', () => {
  assert.doesNotMatch(plist(), /<key>KeepAlive<\/key>/);
});

test('the shipped job has an owner-selected exit timeout', () => {
  assert.match(plist(), /<key>ExitTimeOut<\/key>\s*<integer>__EXIT_TIMEOUT__<\/integer>/);
});

test('the shipped job sets only PATH in its environment', () => {
  assert.match(plist(), /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>PATH<\/key>\s*<string>__PATH__<\/string>\s*<\/dict>/);
});

test('the shipped job sends standard output and error under the owner-selected home log directory', () => {
  assert.match(plist(), /<key>StandardOutPath<\/key>\s*<string>__HOME__\/Library\/Logs\/rigger\/rigger\.out<\/string>/);
  assert.match(plist(), /<key>StandardErrorPath<\/key>\s*<string>__HOME__\/Library\/Logs\/rigger\/rigger\.err<\/string>/);
});

test('the shipped template uses exactly the six documented placeholders', () => {
  const names = [...new Set(plist().match(/__[A-Za-z0-9_]+__/g) ?? [])].sort();
  assert.deepEqual(names, ['__EXIT_TIMEOUT__', '__HOME__', '__PATH__', '__REPOSITORY__', '__RIGGER__', '__START_INTERVAL__']);
});

test('no shipped string value hardcodes a host path', () => {
  const values = [...plist().matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]);
  assert.ok(values.length > 0);
  for (const value of values) assert.doesNotMatch(value, /^[\/~]/);
});

test('the shipped LaunchAgent has only its specified keys and no LaunchDaemon identity keys', () => {
  const keys = [...plist().matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();
  assert.deepEqual(keys, [
    'EnvironmentVariables', 'ExitTimeOut', 'Label', 'PATH', 'ProgramArguments',
    'RunAtLoad', 'StandardErrorPath', 'StandardOutPath', 'StartInterval', 'WorkingDirectory',
  ].sort());
});

test('plan skips a launchd directory while preserving every forked file', () => {
  const templates = temporaryDirectory('rigger-launchd-templates-');
  copyFileSync(join(TEMPLATES, CONFIG), join(templates, CONFIG));
  const without = plan({ templates, repo: 'acme/widgets' });
  mkdirSync(join(templates, 'launchd'));
  writeFileSync(join(templates, 'launchd', 'job.plist'), '<?xml version="1.0"?>\n');
  assert.deepEqual(without.map(({ path }) => path), [CONFIG]);

  assert.deepEqual(plan({ templates, repo: 'acme/widgets' }), without);
});

test('the shipped plan equals the same templates tree without launchd', () => {
  const directory = temporaryDirectory('rigger-launchd-plan-');
  const without = join(directory, 'templates');
  cpSync(TEMPLATES, without, { recursive: true });
  rmSync(join(without, 'launchd'), { recursive: true });

  assert.deepEqual(plan({ repo: 'acme/widgets' }), plan({ templates: without, repo: 'acme/widgets' }));
});
