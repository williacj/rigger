// ABOUTME: Proves real host forwarding through L3 and L1 during a completed maker dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';

import { realHost } from '../src/substrate/host.mjs';
import { fixture, shellQuote } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { drive, waitFor, world } from './loop-world.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, consumerConfig } from './verb-consumer.mjs';

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

// Host reason: wiring and OS behaviour; the default clock's poll timer must hold the real bin open
// past the drain, and a real SIGTERM must end it through L0's exit cleanup.
// proves R-SCHED-28
test('L17: the run bin stays up past the drain and polls while a trigger is declared, and exits 143 at SIGTERM with its hand-overs whole', BOUNDS[60_000], async () => {
  const directory = temporaryDirectory('rigger-clock-run-host-');
  const config = { ...consumerConfig(1), clock: { poll: 100, triggers: { hourly: {
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
  const child = spawn(process.execPath, [bin, 'run'], {
    cwd: consumer, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${dirname(fake.gh)}:${process.env.PATH}` },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((settle) => child.on('exit', (code, signal) => settle({ code, signal })));
  let ended;
  exited.then((exit) => { ended = exit; });
  const stream = join(consumer, '.rigger', 'events.jsonl');
  const triggers = () => (fs.existsSync(stream) ? fs.readFileSync(stream, 'utf8') : '').split('\n')
    .filter((line) => line.includes('"event":"trigger"')).map((line) => JSON.parse(line).trigger);
  // Two polls after the drain: the first pull, its drain, then two pulls more.
  await waitFor(() => ended !== undefined || triggers().filter((kind) => kind === 'pull').length >= 3, 30_000);
  assert.equal(ended, undefined, `the bin ended at the drain: ${JSON.stringify(ended)}\n${stderr}`);
  assert.deepEqual(triggers().slice(0, 3), ['pull', 'drain', 'pull'], 'the polls came after the drain');
  await waitFor(() => stdout.includes('\n'), 10_000);

  const signalled = performance.now();
  child.kill('SIGTERM');
  const exit = await exited;
  const took = performance.now() - signalled;
  // L0's exit cleanup re-raises the signal once it has cleaned up, so the process ends by SIGTERM,
  // which a shell reports as status 128 + SIGTERM's number.
  assert.deepEqual(exit, { code: null, signal: 'SIGTERM' }, stderr);
  assert.equal(128 + constants.signals[exit.signal], 143);
  assert.ok(took < 10_000, `the bin exited ${took} ms after SIGTERM, past the 10,000 ms bound`);
  assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' }, 'no process of its group survives');
  for (const line of fs.readFileSync(stream, 'utf8').split('\n').filter((each) => each !== '')) JSON.parse(line);
  assert.ok(stdout.split('\n').includes(`rigger run: from board ${PROJECT}, no card was pullable`), stdout);
});
