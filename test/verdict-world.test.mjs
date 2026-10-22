// ABOUTME: Regressions for the verdict fixture's isolated tool environment and real terminal boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { delimiter, join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';
import { atTerminal, realGhOn, world } from './verdict-world.mjs';

const WORLD = new URL('./verdict-world.mjs', import.meta.url).href;

/** A harmless executable whose invocation would leave evidence beside it. */
function sentinel(directory) {
  const gh = join(directory, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf called > "$0.called"\nexit 99\n');
  chmodSync(gh, 0o755);
  return gh;
}

for (const hasGh of [true, false]) {
  test(`world isolates its tools when Node's original directory ${hasGh ? 'holds' : 'does not hold'} gh`, { timeout: 120_000 }, (t) => {
    const directory = temporaryDirectory('rigger-verdict-node-bin-', { context: t });
    const node = join(directory, 'node');
    symlinkSync(process.execPath, node);
    symlinkSync('/usr/bin/git', join(directory, 'git'));
    const gh = hasGh ? sentinel(directory) : join(directory, 'gh');
    // Change only this child's executable spelling. Its executable is still the real Node,
    // reached through the controlled layout; no host bin directory is changed.
    const script = `
      import assert from 'node:assert/strict';
      process.execPath = process.argv[1];
      const { world, realGhOn } = await import(${JSON.stringify(WORLD)});
      const where = world();
      assert.deepEqual(realGhOn(where), []);
      assert.ok(!where.env.PATH.split(':').includes(process.argv[2]));
      console.log('world isolated');
    `;

    const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script, node, directory], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env, PATH: directory },
    });

    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /world isolated/);
    assert.equal(existsSync(`${gh}.called`), false, 'the non-relay gh was executed');
  });
}

for (const position of ['before', 'after']) {
  test(`realGhOn detects a non-relay gh ${position} the relay on the actual PATH without executing it`, (t) => {
    const where = world();
    assert.deepEqual(realGhOn(where), []);
    const directory = temporaryDirectory('rigger-verdict-injected-bin-', { context: t });
    const gh = sentinel(directory);
    where.env.PATH = position === 'before' ? `${directory}${delimiter}${where.env.PATH}` : `${where.env.PATH}${delimiter}${directory}`;

    assert.deepEqual(realGhOn(where), [directory]);
    assert.equal(existsSync(`${gh}.called`), false, 'detection executed the non-relay gh');
  });
}

/** Observe the real utility's rejection without leaving its input relay waiting on a failed launch. */
async function observedTerminal(t, where, command) {
  const original = childProcess.spawn;
  let stderr = '';
  childProcess.spawn = (...given) => {
    const child = original(...given);
    writeFileSync(join(where.path, 'terminal-child.pid'), `${child.pid}\n`);
    t.diagnostic(`terminal child pid ${child.pid}`);
    t.after(() => {
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.includes('script: unexpected number of arguments')) child.stdin.end();
    });
    return child;
  };
  syncBuiltinESMExports();
  try {
    return { ...await atTerminal(where, [], { command }), stderr };
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
}

for (const status of [0, 23]) {
  test(`atTerminal preserves argument bytes and child exit status ${status}`, { timeout: 120_000 }, async (t) => {
    const where = world();
    const args = ['plain', 'two words', "apostrophe's", 'double"quote', '', '$(printf WRONG)', '$HOME;*', 'first\nsecond'];
    const script = 'console.log("argv=" + JSON.stringify(process.argv.slice(2))); process.exit(Number(process.argv[1]));';

    const ran = await observedTerminal(t, where, [process.execPath, '-e', script, String(status), ...args]);

    assert.equal(ran.status, status, ran.shown + ran.stderr);
    assert.ok(ran.shown.includes(`argv=${JSON.stringify(args)}\n`), ran.shown);
    assert.equal(ran.asked, false, 'a command that asked no verdict question received an answer');
  });
}
