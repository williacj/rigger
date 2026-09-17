// ABOUTME: Tests the package contract: the Node floor and what an install below it does, that
// ABOUTME: every script the repository defines is reachable from `npm run`, and that CI runs them.

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

test('the package declares the Node floor the README promises', () => {
  assert.equal(manifest.engines.node, '>=20');
  assert.match(read('README.md'), /^- Node\.js 20 or later\.$/m);
});

test('an install under an older Node fails, and names that as the reason', () => {
  // The floor is raised above the Node running this test rather than lowered onto an old one,
  // because the machine has only the Node it has. What is proved is the pair: `engines` states
  // the floor and `engine-strict` refuses below it, against this repository's real manifest.
  const unmet = `>=${Number(process.versions.node.split('.')[0]) + 1}`;
  const dir = mkdtempSync(join(tmpdir(), 'rigger-engines-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ...manifest, engines: { ...manifest.engines, node: unmet } }, null, 2),
  );
  copyFileSync(join(root, '.npmrc'), join(dir, '.npmrc'));

  const install = spawnSync('npm install --no-audit --no-fund', {
    cwd: dir,
    shell: true,
    encoding: 'utf8',
  });

  assert.notEqual(install.status, 0);
  const said = install.stdout + install.stderr;
  assert.match(said, /EBADENGINE|Unsupported engine/);
  assert.match(said, new RegExp(`Required.*${unmet}`));
  assert.match(said, new RegExp(`Actual.*v${process.versions.node}`));
});

test('every script the repository defines is reachable from npm run', () => {
  const commands = Object.values(manifest.scripts).join(' ');
  const defined = readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.mjs'));
  assert.ok(defined.length > 0);
  for (const name of defined) {
    assert.ok(commands.includes(`scripts/${name}`), `no npm script runs scripts/${name}`);
  }
});

test('CI runs on every push and every pull request', () => {
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\njobs:'));
  assert.match(triggers, /^\s+push:/m);
  assert.match(triggers, /^\s+pull_request:/m);
});

test('CI runs the suite and both budget checks', () => {
  for (const command of ['npm test', 'npm run budget:package', 'npm run budget:instructions']) {
    assert.ok(workflow.includes(`run: ${command}`), `CI never runs \`${command}\``);
  }
});

test('the README badge points at that workflow', () => {
  const file = 'ci.yml';
  assert.ok(workflow.startsWith('# ABOUTME:'), 'the workflow says what it is');
  assert.match(
    read('README.md'),
    new RegExp(
      `\\[!\\[CI\\]\\(https://github\\.com/williacj/rigger/actions/workflows/${file}/badge\\.svg\\)\\]` +
      `\\(https://github\\.com/williacj/rigger/actions/workflows/${file}\\)`,
    ),
  );
});
