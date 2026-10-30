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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, consumerConfig } from './verb-consumer.mjs';
import { readEvents } from '../src/observation/sink.mjs';

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

// Host reason: the real run bin must exit with a future timer under the default clock.
test('J17: the run bin exits at drain with a report occurrence an hour away', BOUNDS[60_000], () => {
  const directory = temporaryDirectory('rigger-clock-run-host-');
  const config = { ...consumerConfig(1), clock: { poll: 1000, triggers: { hourly: {
    interval: 3_600_000, anchor: new Date(Date.now() + 3_600_000).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), {
    'rigger.config.mjs': `export default ${JSON.stringify(config)};\n`,
  }), join(directory, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-clock-run-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [] },
  });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bin = join(root, JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);
  const ran = spawnSync(process.execPath, [bin, 'run'], {
    cwd: consumer, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PATH: `${dirname(fake.gh)}:${process.env.PATH}` },
  });
  assert.equal(ran.error, undefined, ran.stderr);
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /no card was pullable/);
  assert.deepEqual(readEvents(join(consumer, '.rigger')).filter(({ trigger }) => trigger === 'clock'), []);
});
