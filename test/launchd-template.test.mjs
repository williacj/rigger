// ABOUTME: Checks the shipped launchd job and that init leaves this host asset out of a consumer plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONFIG, TEMPLATES, plan } from '../src/cli/init.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const plist = () => readFileSync(join(TEMPLATES, 'launchd', 'com.williacj.rigger.plist'), 'utf8');

// Read the effective dictionary, ignoring XML comments and rejecting duplicate keys.
// Integer placeholders stay symbolic here; the macOS host test parses their filled values.
function parsedPlist() {
  const xml = plist().replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '');
  const tokens = (xml.match(/<[^>]+>|[^<]+/g) ?? []).map((token) => token.trim()).filter(Boolean);
  let index = 0;
  const take = (expected) => assert.equal(tokens[index++], expected, `expected plist token ${expected}`);
  const scalar = (tag) => {
    take(`<${tag}>`);
    const value = tokens[index++];
    take(`</${tag}>`);
    return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity[0] === '#') return String.fromCodePoint(Number.parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
    });
  };
  function value() {
    const tag = tokens[index++];
    if (tag === '<true/>') return true;
    if (tag === '<false/>') return false;
    if (tag === '<string>' || tag === '<integer>') {
      index -= 1;
      return scalar(tag === '<string>' ? 'string' : 'integer');
    }
    if (tag === '<array>') {
      const items = [];
      while (tokens[index] !== '</array>') items.push(value());
      take('</array>');
      return items;
    }
    assert.equal(tag, '<dict>', 'expected plist value');
    const entries = Object.create(null);
    while (tokens[index] !== '</dict>') {
      const key = scalar('key');
      assert.ok(!Object.hasOwn(entries, key), `duplicate plist key ${key}`);
      entries[key] = value();
    }
    take('</dict>');
    return entries;
  }
  take('<plist version="1.0">');
  const properties = value();
  take('</plist>');
  assert.equal(index, tokens.length, 'unexpected plist content');
  return properties;
}

test('the shipped LaunchAgent has the fixed label', () => {
  assert.equal(parsedPlist().Label, 'com.williacj.rigger');
});

test('the shipped job runs the installed Rigger executable with run', () => {
  assert.deepEqual(parsedPlist().ProgramArguments, ['__RIGGER__', 'run']);
});

test('the shipped job runs in the owner-selected repository', () => {
  assert.equal(parsedPlist().WorkingDirectory, '__REPOSITORY__');
});

test('the shipped job relaunches after the selected interval', () => {
  assert.equal(parsedPlist().StartInterval, '__START_INTERVAL__');
});

test('the shipped job starts on load', () => {
  assert.equal(parsedPlist().RunAtLoad, true);
});

test('the shipped job does not use KeepAlive', () => {
  assert.equal(Object.hasOwn(parsedPlist(), 'KeepAlive'), false);
});

test('the shipped job has an owner-selected exit timeout', () => {
  assert.equal(parsedPlist().ExitTimeOut, '__EXIT_TIMEOUT__');
});

test('the shipped job sets only PATH in its environment', () => {
  assert.deepEqual({ ...parsedPlist().EnvironmentVariables }, { PATH: '__PATH__' });
});

test('the shipped job sends standard output and error under the owner-selected home log directory', () => {
  assert.equal(parsedPlist().StandardOutPath, '__HOME__/Library/Logs/rigger/rigger.out');
  assert.equal(parsedPlist().StandardErrorPath, '__HOME__/Library/Logs/rigger/rigger.err');
});

test('the shipped template uses exactly the six documented placeholders', () => {
  const effectiveNames = [...new Set(JSON.stringify(parsedPlist()).match(/__[A-Za-z0-9_]+__/g) ?? [])].sort();
  assert.deepEqual(effectiveNames, ['__EXIT_TIMEOUT__', '__HOME__', '__PATH__', '__REPOSITORY__', '__RIGGER__', '__START_INTERVAL__']);
});

test('no shipped string value hardcodes a host path', () => {
  const effectiveValues = Object.values(parsedPlist()).flatMap((entry) => Array.isArray(entry) ? entry : typeof entry === 'object' ? Object.values(entry) : [entry]);
  assert.ok(effectiveValues.length > 0);
  for (const value of effectiveValues) if (typeof value === 'string') assert.doesNotMatch(value, /^[\/~]/);
});

test('the shipped LaunchAgent has only its specified keys and no LaunchDaemon identity keys', () => {
  assert.deepEqual(Object.keys(parsedPlist()).sort(), [
    'EnvironmentVariables', 'ExitTimeOut', 'Label', 'ProgramArguments', 'RunAtLoad',
    'StandardErrorPath', 'StandardOutPath', 'StartInterval', 'WorkingDirectory',
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
