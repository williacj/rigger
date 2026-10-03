// ABOUTME: Tests the stand-in agent every maker runs as under `npm test`: a run that holds is woken by
// a release sent at any moment after it says it holds, the earliest included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

import { until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

/**
 * How many runs hold at once, each released in the turn its hold is seen. A judgment: the release
 * the stand-in once missed came in the moment after its hold, and the engineer's probe on #556 met
 * it in 2 of 40 runs at a load of 23, so forty at once makes that moment many times over.
 */
const RUNS = 40;

/**
 * How long the runs have, once released, to wake. A judgment, a bound and never a wait: each run
 * wakes within a turn of its release, and one that has not woken in this long missed it.
 */
const WAKES_WITHIN = 30_000;

test('every run of the stand-in that holds is woken by a release sent in the turn its hold is first seen', SETTLES_WITHIN, async (t) => {
  const cards = Array.from({ length: RUNS }, (_, index) => index + 1);
  const agent = standInAgent(Object.fromEntries(cards.map((card) => [card, { engineer: { hold: true, write: true } }])));
  const runs = cards.map((card) => {
    const child = spawn(join(agent.dir, 'claude'), ['--append-system-prompt-file', '/nowhere/.claude/agents/engineer.md'], { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end(`Rigger dispatched this session, unattended, as the maker for card #${card}.\n`);
    return { card, exited: once(child, 'exit').then(() => true), child };
  });
  t.after(() => runs.forEach(({ child }) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }));

  const released = new Set();
  const exited = new Set();
  runs.forEach(({ card, exited: done }) => done.then(() => exited.add(card)));
  await until(() => {
    for (const card of cards) {
      if (!released.has(card) && agent.held(card)) {
        agent.release(card);
        released.add(card);
      }
    }
    return released.size === RUNS;
  }, t);
  const bound = AbortSignal.timeout(WAKES_WITHIN);
  await until(() => exited.size === RUNS, { signal: bound }).catch(() => {});

  assert.deepEqual(cards.filter((card) => !exited.has(card) || !agent.wrote(card)), [], 'these runs missed their release');
});
