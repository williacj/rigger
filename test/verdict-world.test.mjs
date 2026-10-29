// ABOUTME: Regressions for the verdict fixture's isolated tool environment and real terminal boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { delimiter, join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';
import { atTerminal, realGhOn, world } from './verdict-world.mjs';
import { mkdirSync } from 'node:fs';
import { configWith, moduleOf, PULL } from './verdict-world.mjs';
import { gitIn, withOrigin } from './git-repository.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { assertPushEnd, held, pushTraced } from './push-fixtures.mjs';

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

/**
 * Runs `rigger verdict <PULL> sound` at the pseudo-terminal, answering yes, through
 * `src/cli/verbs.mjs` and so with L5's push as it ships, in a world whose consumer config is this
 * repository's with `telemetry` as given (left out where undefined), the consumer repository given
 * a local bare `origin`. Every git call is traced. `repository: false` runs it in a directory git
 * names no repository for. Answers what the terminal showed and the exit status, the stream's
 * events, origin's data ref and the traced lines naming the push.
 */
async function verdictPushing(telemetry, { repository = true } = {}) {
  const { telemetry: _own, ...config } = configWith();
  const where = world({ consumer: moduleOf(telemetry === undefined ? config : { ...config, telemetry }) });
  const directory = temporaryDirectory('rigger-verdict-push-');
  const origin = join(directory, 'origin.git');
  const trace = join(directory, 'git-trace');
  if (repository) {
    withOrigin(where.cwd, origin);
  } else {
    where.cwd = join(directory, 'consumer');
    mkdirSync(where.cwd);
    writeFileSync(join(where.cwd, 'rigger.config.mjs'), moduleOf({ ...config, telemetry }));
  }
  where.env.GIT_TRACE = trace;
  const ran = await atTerminal(where, [String(PULL), 'sound']);
  const state = join(where.cwd, '.rigger');
  const events = existsSync(join(state, 'events.jsonl')) ? readEvents(state) : [];
  const tip = repository ? gitIn(origin, 'for-each-ref', '--format=%(objectname)', 'refs/rigger/events').trim() || undefined : undefined;
  return { ran, events, tip, origin, state, traced: pushTraced(trace) };
}

// proves R-SAFE-3
test('C1, C2, C3: verdict run as the command at a terminal, its config admitted with telemetry absent, telemetry.push absent, false, \'true\', 1 or {}, reaches no push side', { timeout: 600_000 }, async () => {
  for (const telemetry of [undefined, {}, { push: false }, { push: 'true' }, { push: 1 }, { push: {} }]) {
    const { ran, events, tip, traced } = await verdictPushing(telemetry);
    const said = `telemetry ${JSON.stringify(telemetry)}: exited ${ran.status}: ${ran.shown}`;
    assert.equal(ran.status, 0, said);
    assert.ok(events.length > 0, `${said}: verdict recorded nothing, so this proves nothing`);
    assert.deepEqual(events.filter(({ event }) => event === 'push.end'), [], said);
    assert.equal(tip, undefined, said);
    assert.deepEqual(traced, [], said);
  }
});

// proves R-RECORD-13
test('C6: verdict run as the command at a terminal, telemetry.push true, pushes the stream to origin\'s data ref once at its return, then records one push.end', { timeout: 120_000 }, async () => {
  const { ran, events, tip, origin, traced } = await verdictPushing({ push: true });
  const said = `exited ${ran.status}: ${ran.shown}`;
  assert.equal(ran.status, 0, said);
  assert.equal(ran.shown.includes('rigger: the push'), false, said);
  assert.ok(tip, `${said}: origin holds no data ref`);
  assert.ok(traced.length > 0, said);
  const ends = events.filter(({ event }) => event === 'push.end');
  assert.equal(ends.length, 1, said);
  assert.equal(events.at(-1).event, 'push.end', said);
  const pushed = Buffer.from(gitIn(origin, 'cat-file', 'blob', `${tip}:events.jsonl`));
  const before = Buffer.from(events.slice(0, -1).map((event) => `${JSON.stringify(event)}\n`).join(''));
  assert.deepEqual(pushed, held(before), said);
  assertPushEnd(ends[0], { outcome: 'pushed', bytes: pushed.length, commit: tip });
});

// proves R-SAFE-3
test('C7: verdict run as the command at a terminal in a directory git names no repository for, telemetry.push true, names no state directory and reaches no push side', { timeout: 120_000 }, async () => {
  const { ran, state, traced } = await verdictPushing({ push: true }, { repository: false });
  const said = `exited ${ran.status}: ${ran.shown}`;
  assert.equal(ran.status, 1, said);
  assert.match(ran.shown, /git names no repository/, said);
  assert.equal(existsSync(state), false, said);
  assert.deepEqual(traced, [], said);
});

// proves R-SAFE-3
test('C5: verdict run as the command at a terminal, its config refused by the validator and holding telemetry.push true, reaches no push side', { timeout: 120_000 }, async () => {
  const { ran, events, tip, traced } = await verdictPushing({ push: true, extra: true });
  const said = `exited ${ran.status}: ${ran.shown}`;
  assert.equal(ran.status, 1, said);
  assert.match(ran.shown, /is refused: `telemetry\.extra`/, said);
  assert.deepEqual(events.filter(({ event }) => event === 'push.end'), [], said);
  assert.equal(tip, undefined, said);
  assert.deepEqual(traced, [], said);
});
