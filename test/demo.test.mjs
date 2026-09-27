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

/** The tape's commands in order, each with its comment and surrounding space dropped. */
const tapeCommands = () => readFileSync(join(root, 'docs', 'demo.tape'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean);

test('the tape sources the demo world unseen, then records rigger once, into the GIF under docs/', () => {
  const commands = tapeCommands();
  // The order matters: the world is built and entered before frames are captured, so the GIF
  // opens on the prompt, and what runs in view is the installed rigger the world put on PATH.
  const order = [`Type ". ${WORLD}"`, 'Show', 'Type "rigger once"'].map((command) => commands.indexOf(command));
  assert.ok(order.every((at) => at >= 0), `the tape lacks one of the commands it must carry; it holds:\n${commands.join('\n')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `the tape runs them out of order:\n${commands.join('\n')}`);
  // Settings and outputs must come first in a tape, so the first command after them is Hide.
  assert.equal(commands.find((command) => !/^(Output|Set|Require) /.test(command)), 'Hide', 'the tape captures frames before the world is built');
  assert.ok(commands.includes('Output docs/demo.gif'), 'the tape writes no GIF at docs/demo.gif');
});

test('rigger once in the demo world claims a card, says it was not worked, and exits non-zero', () => {
  const ran = inTheWorld('rigger once');

  assert.match(ran.err, /^rigger once: claimed #\d+ from board 3\b/m, ran.err);
  assert.match(ran.err, /not worked: dispatch arrives with M2 and M4/, ran.err);
  assert.notEqual(ran.code, 0, ran.out);
});
