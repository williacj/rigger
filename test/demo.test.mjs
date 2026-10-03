// ABOUTME: Tests the demo tape's world without vhs: the shell `docs/demo.tape` records is left in a
// consumer repository outside the checkout, running a `rigger` installed from the tarball, with
// the fake `gh` and the stand-in agent as the only `gh` and `claude` on PATH, and `rigger once`
// there claims the card, dispatches its maker, and exits non-zero saying it opened no pull request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

/** The file the tape sources before it records, as a path from the checkout root, which is where the tape runs. */
const WORLD = 'test/demo-world.sh';

/**
 * A bash run from the checkout root that sources the demo world as the tape does, then runs
 * `script` in the shell the world left behind. What it printed and its exit status.
 */
function inTheWorld(script) {
  const ran = spawnSync('bash', ['-c', `. ${WORLD} || exit 9\n${script}`], { cwd: root, encoding: 'utf8', env: { ...gitEnvironment(), TMPDIR: temporaryDirectory('rigger-demo-tmp-') } });
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

/**
 * Every one-line command the workflow runs, in order. A command YAML holds double-quoted, because
 * a plain scalar cannot carry what it carries, is read without the quotes; none carries an escape.
 */
const runCommands = (text = workflow) => [...text.matchAll(/^\s*-\s*run:\s*(\S.*?)\s*$/gm)]
  .map(([, command]) => command.replace(/^"(.*)"$/, '$1'));

/**
 * The screen the tape leaves at this head, written by hand from what `once` prints (the once
 * tests) and the tape's typed lines, rather than recorded: the checks below are asked about a
 * screen whose content is known, and what the tape records is the demo job's to check.
 */
const SCREEN = [
  '> rigger once',
  'rigger once: claimed #12 from board 3; its maker exited 0 and opened no pull request from rigger-12, in its workspace, /private/var/folders/rigger-demo.a1B2c3/widgets-worktrees/rigger-12',
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
  const file = join(temporaryDirectory('rigger-demo-check-'), basename(path));
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

test('a CI check fails on a screen where rigger once exited zero after printing a line that reads as a status', () => {
  // The status is what the tape's echo prints, so a line of the verb's own output reading
  // `exit 1` must not stand in for it.
  const screen = SCREEN
    .replace(/^(rigger once: .*)$/m, '$1\nexit 1')
    .replace(/^exit 1$(?![\s\S]*^exit 1$)/m, 'exit 0');
  assert.match(screen, /^exit 1\n> echo exit \$\?\nexit 0$/m, `the screen is not the one meant:\n${screen}`);
  const statuses = ciChecksOver('docs/demo.txt', screen);
  assert.notDeepEqual(statuses.filter((status) => status !== 0), [], 'every check passed with the echo reporting a zero exit');
});

test('a CI check fails on a screen missing M4\'s once line', () => {
  const statuses = ciChecksOver('docs/demo.txt', SCREEN.replace(/^rigger once: .*\n/m, ''));
  assert.notDeepEqual(statuses.filter((status) => status !== 0), [], 'every check passed with the message missing');
});

/**
 * The status the demo job's GIF steps end on, run in order in a checkout holding the committed
 * GIF, with `tape` standing in for `vhs docs/demo.tape`: a shell command writing what the tape
 * would. The first status that is not zero, or zero when every step passed.
 */
function gifStepsWhenTheTapeRuns(tape) {
  const checkout = temporaryDirectory('rigger-demo-job-');
  mkdirSync(join(checkout, 'docs'));
  writeFileSync(join(checkout, 'docs', 'demo.gif'), 'GIF89a, the recording the checkout holds');
  const job = runCommands(workflow.slice(workflow.search(/^ {2}demo:$/m)))
    .filter((command) => command.includes('docs/demo.gif') || command === 'vhs docs/demo.tape');
  assert.ok(job.includes('vhs docs/demo.tape'), `the demo job never runs the tape; its GIF steps are:\n${job.join('\n')}`);
  for (const command of job) {
    const ran = spawnSync(command === 'vhs docs/demo.tape' ? tape : command, { shell: true, cwd: checkout, encoding: 'utf8', env: gitEnvironment() });
    if (ran.status !== 0) return ran.status;
  }
  return 0;
}

test('a CI check fails when the tape writes an empty GIF, or none beside the committed one, and none fails on one holding anything', () => {
  // The GIF is committed at the path the tape writes, so a check reading that path passes on the
  // committed copy unless the job clears it before the tape runs.
  assert.notEqual(gifStepsWhenTheTapeRuns('true'), 0, 'every step passed when the tape wrote no GIF');
  assert.notEqual(gifStepsWhenTheTapeRuns(': > docs/demo.gif'), 0, 'every step passed on an empty GIF');
  assert.equal(gifStepsWhenTheTapeRuns('printf GIF89a > docs/demo.gif'), 0);
});

test('rigger once in the demo world claims a card, names its workspace, says its maker opened no pull request, and exits non-zero', () => {
  const ran = inTheWorld('rigger once');

  assert.match(ran.err, /^rigger once: claimed #\d+ from board 3\b/m, ran.err);
  assert.match(ran.err, /; its maker exited 0 and opened no pull request from rigger-12, in its workspace, \/\S*\/widgets-worktrees\/rigger-12$/m, ran.err);
  assert.notEqual(ran.code, 0, ran.out);
});
