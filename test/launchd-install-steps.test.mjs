// ABOUTME: Binds the README's launchd installation steps to the shipped LaunchAgent template:
// its placeholders, its label, its path in the package and its log paths. Reads only those two files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(root, 'templates', 'launchd', 'com.williacj.rigger.plist');
const HEADING = '### Installing the launchd job';

const readme = () => readFileSync(join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
/** The shipped template with its XML comments dropped, so its header names nothing. */
const template = () => readFileSync(TEMPLATE, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** The lines of the README's `## Install and usage` section, its own heading dropped. */
function installAndUsage() {
  const lines = readme().split('\n');
  const start = lines.indexOf('## Install and usage');
  assert.notEqual(start, -1, 'the README has no `## Install and usage` section');
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => line.startsWith('## '));
  return end < 0 ? after : after.slice(0, end);
}

/** The installation steps: everything under their `### ` heading, up to the next heading. */
function steps() {
  const lines = installAndUsage();
  const start = lines.indexOf(HEADING);
  assert.notEqual(start, -1, `"Install and usage" has no \`${HEADING}\` heading`);
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => /^#{1,3} /.test(line));
  return (end < 0 ? after : after.slice(0, end)).join('\n');
}

const unique = (values) => [...new Set(values)].sort();
const placeholders = (text) => unique(text.match(/__[A-Z][A-Z0-9_]*__/g) ?? []);
const templateString = (key) => {
  const found = template().match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  assert.ok(found, `the template has no string ${key}`);
  return found[1];
};

test('the installation steps sit under one heading in "Install and usage", after its verb block', () => {
  const lines = installAndUsage();
  const headings = lines.filter((line) => line === HEADING);
  assert.equal(headings.length, 1, `"Install and usage" holds ${headings.length} \`${HEADING}\` headings`);
  const fences = lines.flatMap((line, index) => (line.startsWith('```') ? [index] : []));
  assert.ok(fences.length >= 2, 'the section holds no verb block');
  assert.ok(fences[1] < lines.indexOf(HEADING), 'the steps sit above the verb block');
  assert.notEqual(steps().trim(), '', 'the steps are empty');
});

test('the placeholders the steps name are exactly those the shipped template holds', () => {
  const inTemplate = placeholders(template());
  assert.ok(inTemplate.length > 0, 'the template holds no placeholder');
  assert.deepEqual(placeholders(steps()), inTemplate);
});

test('every launchctl command in the steps targets the gui domain and the fixed label', () => {
  const commands = steps().match(/launchctl [^\n`]+/g) ?? [];
  assert.ok(commands.length > 0, 'the steps hold no launchctl command');
  for (const command of commands) {
    const [, verb, target, rest] = command.trim().match(/^launchctl (\S+) (\S+)\s*(.*)$/) ?? [];
    if (verb === 'bootstrap') {
      assert.equal(target, 'gui/<uid>', `the domain in \`${command}\``);
      assert.match(rest, /LaunchAgents\/com\.williacj\.rigger\.plist$/, `the plist in \`${command}\``);
    } else {
      assert.equal(target, 'gui/<uid>/com.williacj.rigger', `the service target in \`${command}\``);
    }
  }
});

test('every plist path in the steps ends in the LaunchAgents copy of the fixed label', () => {
  const paths = steps().match(/[^\s`(]*\.plist\b/g) ?? [];
  const installed = paths.filter((path) => path.includes('LaunchAgents'));
  assert.ok(installed.length > 0, 'the steps name no plist under LaunchAgents');
  for (const path of installed) assert.match(path, /LaunchAgents\/com\.williacj\.rigger\.plist$/);
});

test('each label the steps name equals the shipped template\'s Label', () => {
  const text = steps();
  const named = [
    ...[...text.matchAll(/gui\/<uid>\/([^\s`]+)/g)].map((found) => found[1]),
    ...[...text.matchAll(/\b(?:com|org|net|io)\.[\w-]+(?:\.[\w-]+)+/g)].map((found) => found[0].replace(/\.plist$/, '')),
  ];
  assert.ok(named.length > 0, 'the steps name no label');
  for (const label of named) assert.equal(label, templateString('Label'));
});

test('the template path the steps name is the shipped template in the package', () => {
  const named = unique(steps().match(/\btemplates\/launchd\/[^\s`]+/g) ?? []);
  assert.deepEqual(named, ['templates/launchd/com.williacj.rigger.plist']);
  const path = join(root, named[0]);
  assert.ok(existsSync(path), `the package holds no ${named[0]}`);
  assert.equal(realpathSync.native(path), realpathSync.native(TEMPLATE));
});

test('the log paths the steps give are the template\'s, with __HOME__ written as the home', () => {
  const given = unique((steps().match(/~\/Library\/Logs\/[^\s`]+/g) ?? []).map((path) => path.replace(/^~/, '__HOME__')));
  assert.deepEqual(given, unique([templateString('StandardOutPath'), templateString('StandardErrorPath')]));
});

test('the steps install by booting the label out and then bootstrapping the plist', () => {
  const commands = (steps().match(/launchctl (?:bootout|bootstrap) [^\n`]+/g) ?? []).map((command) => command.split(' ')[1]);
  const install = commands.indexOf('bootout');
  assert.notEqual(install, -1, 'the steps hold no bootout');
  assert.equal(commands[install + 1], 'bootstrap', 'the bootout is not followed by a bootstrap');
  assert.match(steps(), /`<uid>` is what `id -u` prints/);
});

test('the README states nothing of a launchd check by doctor', () => {
  assert.doesNotMatch(steps(), /doctor/);
  for (const paragraph of readme().split(/\n\s*\n/)) {
    if (/doctor/.test(paragraph)) assert.doesNotMatch(paragraph, /launchd|LaunchAgent|launchctl/, paragraph);
  }
});

test('the steps unload the label rather than claim to stop its process', () => {
  const text = steps();
  assert.doesNotMatch(text, /\bstop/i, 'the steps claim a bootout stops the job');
  assert.doesNotMatch(text, /until (?:your|the) next login/i, 'the steps claim what the next login does');
  const forGood = text.replace(/\s+/g, ' ').match(/unload it for good.*?\.(?: |$)/i);
  assert.ok(forGood, 'the steps say nothing of unloading the label for good');
  assert.match(forGood[0], /`bootout`, then remove `~\/Library\/LaunchAgents\/com\.williacj\.rigger\.plist`/);
});
