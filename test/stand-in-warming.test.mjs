// ABOUTME: Tests that each shared helper writing an executable stand-in runs it once before it
// returns (`warmed`), and that the warming run leaves no trace a test reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { stubGh } from './stub-gh.mjs';
import { standInAgent, stubClaude } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove } from './fake-gh.mjs';
import { fixture, running, scratch } from './process-fixtures.mjs';

/** The names in `dir`, sorted. */
const listing = (dir) => readdirSync(dir).sort();

test('a gh stub, once made, has recorded no call, and its directory holds only the stub and its answers', () => {
  const stub = stubGh({ stdout: 'out', stderr: 'err', status: 3 });

  assert.deepEqual(stub.calls(), []);
  assert.deepEqual(listing(stub.dir), ['gh', 'stderr', 'stdout']);
});

test('a claude stub, once made, has recorded no call, and its directory holds only the stub and its answers', () => {
  const stub = stubClaude({ stdout: 'out' });

  assert.deepEqual(stub.calls(), []);
  assert.deepEqual(listing(stub.dir), ['claude', 'stderr', 'stdout']);
});

test('the stand-in agent, once installed, has recorded no run, and its directory holds only itself and its plan', () => {
  const agent = standInAgent({ 7: { engineer: { write: true } } });

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(listing(agent.dir), ['claude', 'plan.json']);
});

test('the stand-in agent planned to exec a command under every card, once installed, has not run that command', () => {
  const marks = temporaryDirectory('rigger-warming-marks-');
  const agent = standInAgent({ '*': { engineer: { exec: ['/usr/bin/touch', join(marks, 'exec-ran')] } } });

  assert.deepEqual(listing(marks), []);
  assert.deepEqual(listing(agent.dir), ['claude', 'plan.json']);
});

test('a fake gh, once installed, has been sent no command, and its board is as the test gave it', async () => {
  const dir = temporaryDirectory('rigger-warming-fake-gh-');
  const fake = installFakeGh(dir, { repo: 'octo/repo', project: 3, board: { columns: ['Ready'] } });

  assert.deepEqual(fake.sent(), []);
  assert.deepEqual((await fake.model()).writes(), []);
  assert.deepEqual(listing(dir), ['board.json', 'gh']);
});

test('a gh wrapping a fake gh to refuse the stream after a move, once installed, has sent the fake nothing and left the stream as it was', () => {
  const fake = installFakeGh(temporaryDirectory('rigger-warming-fake-gh-'), { repo: 'octo/repo', project: 3, board: { columns: ['Ready'] } });
  const dir = temporaryDirectory('rigger-warming-wrap-');
  const stream = join(temporaryDirectory('rigger-warming-stream-'), 'events.jsonl');

  installGhRefusingStreamAfterMove(dir, fake.gh, stream);

  assert.deepEqual(fake.sent(), []);
  assert.equal(existsSync(stream), false);
  assert.deepEqual(listing(dir), ['gh']);
});

test('a fixture, once written, has not run its body, and no process runs it', (t) => {
  const directory = scratch(t);

  fixture(directory, 'command', ': > "$here/ran"\nexec /usr/bin/tail -f "$0"');

  assert.deepEqual(listing(directory), ['command']);
  assert.deepEqual(running(directory), []);
});
