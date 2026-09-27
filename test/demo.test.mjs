// ABOUTME: Tests the demo tape's world without vhs: the shell `docs/demo.tape` records is left in a
// consumer repository outside the checkout, running a `rigger` installed from the tarball, with
// the fake `gh` as the only `gh` on PATH, and `rigger once` there claims the card and exits
// non-zero saying it was not worked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
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

const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

/** Every one-line command the workflow runs, in order. */
const runCommands = () => [...workflow.matchAll(/^\s*-\s*run:\s*(\S.*?)\s*$/gm)].map(([, command]) => command);

/**
 * The screen the tape leaves at this head, written by hand from what `once` prints (the once
 * tests) and the tape's typed lines, rather than recorded: the checks below are asked about a
 * screen whose content is known, and what the tape records is the demo job's to check.
 */
const SCREEN = [
  '> rigger once',
  'rigger once: claimed #12 from board 3, and it was not worked: dispatch arrives with M2 and M4',
  '> echo exit $?',
  'exit 1',
  '> ',
  '',
].join('\n');

/**
 * The exit status of each command CI runs over a file at `path`, run over `content` instead: the
 * commands naming that path, with a file holding `content` in its place.
 */
function ciChecksOver(path, content) {
  const file = join(mkdtempSync(join(tmpdir(), 'rigger-demo-check-')), basename(path));
  writeFileSync(file, content);
  const checks = runCommands().filter((command) => command.includes(path));
  assert.ok(checks.length > 0, `CI runs no command over ${path}; it runs:\n${runCommands().join('\n')}`);
  return checks.map((command) => spawnSync(command.replaceAll(path, file), { shell: true, encoding: 'utf8', env: gitEnvironment() }).status);
}

test('CI runs the tape, and its checks pass on the screen the tape leaves at this head', () => {
  assert.ok(runCommands().includes('vhs docs/demo.tape'), `CI never runs the tape; it runs:\n${runCommands().join('\n')}`);
  assert.deepEqual(ciChecksOver('docs/demo.txt', SCREEN).filter((status) => status !== 0), []);
});

test('a CI check fails on a screen where rigger once exited zero', () => {
  const statuses = ciChecksOver('docs/demo.txt', SCREEN.replace('exit 1', 'exit 0'));
  assert.notDeepEqual(statuses.filter((status) => status !== 0), [], 'every check passed on a zero exit');
});

test('a CI check fails on a screen missing the claimed-but-not-worked message', () => {
  const statuses = ciChecksOver('docs/demo.txt', SCREEN.replace(/^rigger once: .*\n/m, ''));
  assert.notDeepEqual(statuses.filter((status) => status !== 0), [], 'every check passed with the message missing');
});

test('a CI check fails on an empty GIF, and none does on one holding anything', () => {
  assert.notDeepEqual(ciChecksOver('docs/demo.gif', '').filter((status) => status !== 0), [], 'every check passed on an empty GIF');
  assert.deepEqual(ciChecksOver('docs/demo.gif', 'GIF89a').filter((status) => status !== 0), []);
});

test('rigger once in the demo world claims a card, says it was not worked, and exits non-zero', () => {
  const ran = inTheWorld('rigger once');

  assert.match(ran.err, /^rigger once: claimed #\d+ from board 3\b/m, ran.err);
  assert.match(ran.err, /not worked: dispatch arrives with M2 and M4/, ran.err);
  assert.notEqual(ran.code, 0, ran.out);
});
