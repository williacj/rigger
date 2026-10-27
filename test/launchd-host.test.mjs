// ABOUTME: Exercises the suite's launchctl stand-in and launchd's process-adapter wiring without the host job.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { onPath } from './on-path.mjs';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { loadedJob } from '../src/substrate/launchd.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

test('the suite launchctl stand-in answers print with 113 and refuses every other operation', () => {
  const executable = join(process.env.RIGGER_REFUSING_GH_DIR, 'launchctl');
  // An absolute stand-in path passed to sh cannot fall through to the host launchctl when absent.
  const printed = spawnSync('/bin/sh', [executable, 'print', 'gui/501/com.williacj.rigger'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(printed.status, 113, printed.stderr);
  assert.equal(onPath('launchctl', process.env.PATH), executable);
  for (const operation of ['bootstrap', 'bootout', 'kickstart', '']) {
    const refused = spawnSync(executable, [operation], { encoding: 'utf8', env: gitEnvironment() });
    assert.equal(refused.status, 1, operation);
    assert.match(refused.stderr, /refused under npm test/);
  }
});

test('L0 reaches only a controlled launchctl through its default process adapter', async () => {
  const directory = temporaryDirectory('997-launchctl-');
  const executable = join(directory, 'launchctl');
  const program = join(directory, 'missing-program');
  // print's field spelling is recorded in the S1 report's Q-d2 and S2 report's Q-n1.
  writeFileSync(executable, '#!/bin/sh\n# ABOUTME: Reports a controlled loaded job and records its invocation.\nprintf "%s\\n" "$*" > "$0.calls"\nprintf "gui/501/com.williacj.rigger = {\\n\\tprogram = %s\\n\\texit timeout = 180\\n}\\n" "$LAUNCHD_TEST_PROGRAM"\n');
  chmodSync(executable, 0o755);
  const previous = { PATH: process.env.PATH, LAUNCHD_TEST_PROGRAM: process.env.LAUNCHD_TEST_PROGRAM };
  process.env.PATH = directory;
  process.env.LAUNCHD_TEST_PROGRAM = program;
  try {
    let job;
    await assert.doesNotReject(async () => {
      job = await loadedJob('com.williacj.rigger', { emitter: { emit() { assert.fail('the controlled job leaves no process to kill'); } } });
    }, 'the default process adapter reads the controlled job');
    assert.deepEqual(job, { program, exitTimeout: 180 });
    assert.equal(readFileSync(`${executable}.calls`, 'utf8'), `print gui/${process.getuid()}/com.williacj.rigger\n`);
    const source = readFileSync(new URL('../src/substrate/launchd.mjs', import.meta.url), 'utf8');
    assert.match(source, /import \{[^}]*runCommand[^}]*\} from '\.\/process\.mjs'/);
    assert.doesNotMatch(source, /child_process/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
