// ABOUTME: Tests the demo tape's world without vhs: the shell `docs/demo.tape` records is left in a
// consumer repository outside the checkout, running a `rigger` installed from the tarball, with
// the fake `gh` as the only `gh` on PATH, and `rigger once` there claims the card and exits
// non-zero saying it was not worked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

/** The file the tape sources before it records, as a path from the checkout root, which is where the tape runs. */
const WORLD = 'test/demo-world.sh';

/**
 * A bash run from the checkout root that sources the demo world as the tape does, then runs
 * `script` in the shell the world left behind. What it printed and its exit status.
 */
function inTheWorld(script) {
  const ran = spawnSync('bash', ['-c', `. ${WORLD} || exit 9\n${script}`], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.equal(ran.error, undefined);
  assert.notEqual(ran.status, 9, `sourcing ${WORLD} failed:\n${ran.stderr}`);
  return { out: ran.stdout, err: ran.stderr, code: ran.status };
}

/** Whether `path` sits outside the checkout, however either is spelled. */
function outsideTheCheckout(path) {
  const step = relative(root, realpathSync(path));
  return step.startsWith('..') || isAbsolute(step);
}

test('the demo world leaves the shell in a repository outside the checkout, with an installed rigger and the fake gh as the only gh on PATH', () => {
  // Builtins only past the first line: the world's PATH is narrow by design, so `wc` is not there.
  const ran = inTheWorld([
    'printf "%s\\n" "$PWD" "$(git rev-parse --show-toplevel)" "$(command -v rigger)" "$(command -v gh)"',
    'type -a gh',
  ].join('\n'));
  const [cwd, toplevel, rigger, gh, ...ghs] = ran.out.split('\n').filter(Boolean);

  assert.ok(outsideTheCheckout(cwd), `the shell was left in ${cwd}, inside the checkout`);
  assert.equal(realpathSync(toplevel), realpathSync(cwd), 'the shell was left somewhere other than the root of its own repository');
  assert.ok(outsideTheCheckout(rigger), `the rigger on PATH is ${rigger}, inside the checkout`);
  assert.equal(ghs.length, 1, `PATH holds other than exactly one gh:\n${ghs.join('\n')}`);
  // The fake is what `test/fake-gh.mjs` installs: an entry that loads that module by its path.
  assert.match(readFileSync(gh, 'utf8'), /test\/fake-gh\.mjs/, `the gh on PATH, ${gh}, is not the fake`);
});
