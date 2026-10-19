// ABOUTME: Tests how `rigger verdict` is run, each in-scope row of the card's table A: the verb as
// its own process, at a pseudo-terminal or with standard input from a file, a pipe, /dev/null, or
// L0's process adapter, and only the terminal is asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { stepDispatch } from '../src/execution/step.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import { PULL, RIGGER, assertRefused, assertWrites, atTerminal, run, world } from './verdict-world.mjs';

/** Long enough for a run under a loaded host; a hung run fails rather than hangs. */
const BOUND = { timeout: 120_000 };

/** How long L0's process adapter lets the verb run: past the test's own bound, so the test decides. */
const UNREACHED = 600_000;

const pr = String(PULL);

/** What the verb names where it has no terminal to ask on. */
const NO_TERMINAL = /its standard input is no terminal, so it has no terminal to ask on/;

/** A run through L0's own process adapter, answered as `run` answers, with `call` added to its request. */
async function throughL0(where, call) {
  const result = await runCommand({ cwd: where.cwd, env: where.env, timeout: UNREACHED, emitter: { emit: () => {} }, ...call });
  return { status: result.exit, stdout: result.stdout, stderr: result.stderr };
}

// proves R-VERDICT-10
test('table A: with a terminal at its standard input, a pseudo-terminal, the verb shows the verdict and asks', BOUND, async () => {
  const where = world();

  const ran = await atTerminal(where, [pr, 'sound'], { answer: 'n' });

  assert.ok(ran.asked, ran.shown);
  assert.match(ran.shown, /```rigger-marker\n/);
  assert.match(ran.shown, /Post this comment as your verdict on pull request #12\? \[y\/N\] /);
  assertWrites(where, 0);
});

// proves R-VERDICT-10
test('table A: with standard input from a file, even one holding y, nothing is posted and it says it has no terminal to ask on', BOUND, () => {
  const where = world();
  const file = join(where.path, 'answer');
  writeFileSync(file, 'y\n');
  const before = where.comments();

  const ran = run(where, [pr, 'sound'], { stdin: { file } });

  assertRefused(where, ran, before, NO_TERMINAL);
});

// proves R-VERDICT-10
test('table A: with standard input from a pipe carrying y, nothing is posted and it says it has no terminal to ask on', BOUND, () => {
  const where = world();
  const before = where.comments();

  const ran = run(where, [pr, 'sound'], { stdin: { text: 'y\n' } });

  assertRefused(where, ran, before, NO_TERMINAL);
});

// proves R-VERDICT-10
test('table A: with standard input from /dev/null, as a scheduler gives, nothing is posted and it says it has no terminal to ask on', BOUND, () => {
  const where = world();
  const before = where.comments();

  const ran = run(where, [pr, 'sound'], { stdin: 'ignore' });

  assertRefused(where, ran, before, NO_TERMINAL);
});

// proves R-VERDICT-10, R-VERDICT-11
test('table A: started by L0\'s process adapter with no input, as a role\'s dispatch can be, nothing is posted and it says it has no terminal to ask on', BOUND, async () => {
  const where = world();
  const before = where.comments();

  const ran = await throughL0(where, { command: process.execPath, args: [RIGGER, 'verdict', pr, 'sound'] });

  assertRefused(where, ran, before, NO_TERMINAL);
});

// proves R-VERDICT-10, R-VERDICT-11
test('table A: started by L0\'s process adapter with y piped in, as a role\'s dispatch with a prompt is, nothing is posted and it says it has no terminal to ask on', BOUND, async () => {
  const where = world();
  const before = where.comments();

  const ran = await throughL0(where, { command: process.execPath, args: [RIGGER, 'verdict', pr, 'sound'], input: 'y\n' });

  assertRefused(where, ran, before, NO_TERMINAL);
});

// proves R-VERDICT-10, R-VERDICT-11
test('table A: started under /bin/sh by L0\'s process adapter, as a provisioning step is, nothing is posted and it says it has no terminal to ask on', BOUND, async () => {
  const where = world();
  const before = where.comments();
  const step = stepDispatch({ run: `'${process.execPath}' '${RIGGER}' verdict ${pr} sound` }, where.cwd, where.env);
  assert.equal(step.command, '/bin/sh');

  const ran = await throughL0(where, { command: step.command, args: step.args, cwd: step.cwd, env: step.env });

  assertRefused(where, ran, before, NO_TERMINAL);
});
