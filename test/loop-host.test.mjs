// ABOUTME: Proves real host forwarding through L3 and L1 during a completed maker dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';

import { realHost } from '../src/substrate/host.mjs';
import { fixture, shellQuote } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { drive, world } from './loop-world.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// Host reason: wiring.
// Rigger decision: none; L3 forwards the host unconditionally, and maker success establishes the premise.
test('L3 hands the supplied host to a completed maker dispatch for its start-identity read', BOUNDS[60_000], async () => {
  const directory = temporaryDirectory('rigger-loop-host-');
  const ps = fixture(directory, 'ps', [
    'printf "%s\n" "$*" >> "$here/reads"',
    `exec ${shellQuote(realHost.ps)} "$@"`,
  ].join('\n'));
  const warmed = spawnSync(ps, [], { env: { ...process.env, RIGGER_FIXTURE_WARMING: '1' } });
  assert.equal(warmed.status, 0, 'the process-table fixture is ready before dispatch');
  assert.equal(fs.existsSync(join(directory, 'reads')), false, 'warming records no process-table call');
  const built = world({ cards: [1], concurrency: 1, makerHold: false, host: { ...realHost, ps } });

  await drive(built);

  const completed = built.events().filter((event) => event.layer === 'L1' && event.event === 'dispatch.end' && event.card === 1);
  assert.equal(completed.length, 1, 'one ready-card maker dispatch completed');
  assert.equal(completed[0].exit, 0, 'the maker dispatch completed successfully before the forwarding oracle');
  const calls = fs.existsSync(join(directory, 'reads')) ? fs.readFileSync(join(directory, 'reads'), 'utf8').trim().split('\n') : [];
  // L0 documents its start-identity request as -p <pid> -o lstart=; this literal is independent of its helpers.
  assert.ok(calls.some((call) => /^-p [1-9][0-9]* -o lstart=$/.test(call)), 'missing L3-to-L1 host forwarding: the ready wrapper saw no start-identity request during the completed maker dispatch');
});
