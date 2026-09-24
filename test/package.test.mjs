// ABOUTME: Tests the package contract: the Node floor and what an install below it does, that
// every script the repository defines is reachable from `npm run`, and that CI runs them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const manifest = JSON.parse(read('package.json'));
const workflow = read('.github', 'workflows', 'ci.yml');

test('the Node floor is 20 or later, and the README states the same one', () => {
  // Read out of both documents and compared, rather than each asserted against a literal 20.
  // The acceptance ties the two together, so a floor moved to 22 in both places should hold
  // this item and a floor moved in only one place should break it.
  const range = manifest.engines.node.match(/^>=\s*(\d+)/);
  assert.ok(range, `\`engines.node\` is \`${manifest.engines.node}\`, which names no floor`);
  const stated = read('README.md').match(/^- Node\.js (\d+) or later\.$/m);
  assert.ok(stated, "the README's Prerequisites state no Node version");

  const floor = Number(range[1]);
  assert.equal(floor, Number(stated[1]), 'the package and the README name different floors');
  assert.ok(floor >= 20, `the declared floor is Node ${floor}, below the 20 the card asks for`);
});

// The floor is raised above the Node running these tests rather than lowered onto an old one,
// because the machine has only the Node it has.
const unmet = `>=${Number(process.versions.node.split('.')[0]) + 1}`;

/**
 * A real `npm install` of this repository's manifest with its Node floor raised to `unmet`, in a
 * throwaway directory beside a copy of this repository's `.npmrc`, run under `env`. Returns the
 * exit status and everything the install printed on either stream.
 */
function installUnderRaisedFloor(env) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-engines-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ...manifest, engines: { ...manifest.engines, node: unmet } }, null, 2),
  );
  copyFileSync(join(root, '.npmrc'), join(dir, '.npmrc'));

  const install = spawnSync('npm install --no-audit --no-fund --loglevel=error', {
    cwd: dir,
    shell: true,
    encoding: 'utf8',
    env,
  });

  return { status: install.status, said: install.stdout + install.stderr };
}

test('an install under an older Node fails, and names that as the reason', () => {
  // What is proved is the pair: `engines` states the floor and `engine-strict` refuses below it,
  // against this repository's real manifest.
  const { status, said } = installUnderRaisedFloor(process.env);

  assert.notEqual(status, 0);
  assert.match(said, /EBADENGINE|Unsupported engine/);
  assert.match(said, new RegExp(`Required.*${unmet}`));
  assert.match(said, new RegExp(`Actual.*v${process.versions.node}`));
});

test('the refusal is printed however quiet the npm that launched the suite was told to be', () => {
  // npm exports its own config to a script's environment as `npm_config_*`, so `npm test
  // --silent` leaves `npm_config_loglevel=silent` there and a child install inheriting it
  // refuses in silence: exit 1, nothing printed, and the test above reading an empty string.
  // That is the whole of the flake this file used to have. The install names its own loglevel
  // on the command line so that nothing the environment carries can mute it, and this asks npm
  // whether that holds rather than assuming which of the two sources wins (D16).
  const { status, said } = installUnderRaisedFloor({ ...process.env, npm_config_loglevel: 'silent' });

  assert.notEqual(status, 0);
  assert.match(said, /EBADENGINE|Unsupported engine/);
});

test('every script the repository defines is reachable from npm run', () => {
  const commands = Object.values(manifest.scripts).join(' ');
  const defined = readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.mjs'));
  assert.ok(defined.length > 0);
  for (const name of defined) {
    assert.ok(commands.includes(`scripts/${name}`), `no npm script runs scripts/${name}`);
  }
});

/**
 * One top-level block of a YAML document, its own key line included and its comment lines
 * dropped. Reading the block rather than the whole file keeps an assertion about triggers from
 * being answered by the word `push` written somewhere else, and dropping comment lines keeps a
 * trigger someone commented out from still answering for itself.
 */
function topLevelBlock(yaml, key) {
  const lines = yaml.split('\n').filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  assert.notEqual(start, -1, `the workflow has no top-level \`${key}:\``);
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => /^\S/.test(line));
  return [lines[start], ...(end < 0 ? after : after.slice(0, end))].join('\n');
}

/** Every command the workflow runs, in order. A step that is commented out runs nothing. */
function runCommands(yaml) {
  return [...yaml.matchAll(/^\s*-\s*run:\s*(\S.*?)\s*$/gm)].map(([, command]) => command);
}

test('CI runs on every push and every pull request', () => {
  const triggers = topLevelBlock(workflow, 'on');
  assert.match(triggers, /\bpush\b/);
  assert.match(triggers, /\bpull_request\b/);
});

test('CI installs from the lockfile, then runs the suite and both budget checks', () => {
  const commands = runCommands(workflow);
  for (const wanted of ['npm ci', 'npm test', 'npm run budget:package', 'npm run budget:instructions']) {
    assert.ok(commands.includes(wanted), `CI never runs \`${wanted}\`; it runs: ${commands.join(', ')}`);
  }
});

test('a check that exits non-zero fails the workflow run', () => {
  // A step's non-zero exit fails the job by default, so what this looks for is the two ways
  // that default gets turned off: the key that tells Actions to carry on, and a command that
  // swallows its own status before Actions ever sees it.
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /set \+e/);
  for (const command of runCommands(workflow)) {
    assert.doesNotMatch(
      command,
      /\|\||;\s*(true|exit 0)|\btrue\s*$/,
      `\`${command}\` swallows its own exit code`,
    );
  }
});

test('the workflow says what it is', () => {
  assert.ok(workflow.startsWith('# ABOUTME:'));
});

test('the README badge points at that workflow', () => {
  const file = 'ci.yml';
  assert.match(
    read('README.md'),
    new RegExp(
      `\\[!\\[CI\\]\\(https://github\\.com/williacj/rigger/actions/workflows/${file}/badge\\.svg\\)\\]` +
      `\\(https://github\\.com/williacj/rigger/actions/workflows/${file}\\)`,
    ),
  );
});
