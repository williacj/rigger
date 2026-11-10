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
import { mkdirSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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

// R-WORK-4 through the shipped LaunchAgent (#1341). These tests load a real job into the owner's
// gui/<uid> domain, so they run only where RIGGER_LIVE_LAUNCHD is set (M8-K9 on #1293). They call
// /bin/launchctl by its absolute path, because the suite's stand-in refuses every mutation, and only
// with labels of the form com.williacj.rigger.test-<pid>-<n> (M8-U6 Q22, M8-U7 Q25 a on #1293).
const LIVE_LAUNCHD = process.env.RIGGER_LIVE_LAUNCHD === '1';
const launchdSkip = LIVE_LAUNCHD ? false : 'loads a real launchd job into gui/<uid>; set RIGGER_LIVE_LAUNCHD=1 to run it';
const LAUNCHCTL = '/bin/launchctl';
const PLACEHOLDERS = ['__RIGGER__', '__REPOSITORY__', '__START_INTERVAL__', '__EXIT_TIMEOUT__', '__PATH__', '__HOME__'];
// Short enough that three periods fit in a test, long enough that a start is never mistaken for a firing.
const START_INTERVAL = 5;
// launchd.plist(5): "by default, jobs will not be spawned more than once every 10 seconds".
const THROTTLE_INTERVAL = 10;
const EXIT_TIMEOUT = 5;
const POLL = 100;
const domain = `gui/${process.getuid()}`;
const TEST_LABEL = new RegExp(`^com\\.williacj\\.rigger\\.test-${process.pid}-[1-9][0-9]*$`);
let lastLabel = 0;

/** The next test label; refuses, before any launchctl call, a label of any other form. */
function testLabel(label = `com.williacj.rigger.test-${process.pid}-${++lastLabel}`) {
  if (!TEST_LABEL.test(label)) throw new Error(`refused to load ${label}: not com.williacj.rigger.test-${process.pid}-<n>`);
  return label;
}

function launchctl(...args) {
  return spawnSync(LAUNCHCTL, args, { encoding: 'utf8', env: gitEnvironment() });
}

/** Polls `condition` every POLL ms until it answers truthy or `deadline` (epoch ms) passes. */
async function until(condition, deadline) {
  for (;;) {
    const answer = condition();
    if (answer || Date.now() >= deadline) return answer;
    await new Promise((resolve) => setTimeout(resolve, POLL));
  }
}

/** Boots out each loaded test label whose pid names no running process, and names each one. */
function sweepStaleLabels(t) {
  const listed = launchctl('list');
  assert.equal(listed.status, 0, listed.stderr);
  const stale = [];
  for (const line of listed.stdout.split('\n')) {
    const match = /\t(com\.williacj\.rigger\.test-([0-9]+)-[1-9][0-9]*)$/.exec(line);
    if (!match || running(Number(match[2]))) continue;
    const out = launchctl('bootout', `${domain}/${match[1]}`);
    t.diagnostic(`stale test label ${match[1]} booted out: exit ${out.status} ${out.stderr.trim()}`);
    stale.push(match[1]);
  }
  if (stale.length === 0) t.diagnostic('stale test labels: none');
  return stale;
}

function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

/** The plist text with each placeholder filled, and Label set. */
function render(template, label, fills) {
  let text = template.replace('<string>com.williacj.rigger</string>', `<string>${label}</string>`);
  for (const name of PLACEHOLDERS) text = text.replaceAll(name, String(fills[name]));
  return text;
}

/** What /usr/bin/plutil reads from `path`, as JSON. */
function plutilRead(path) {
  const read = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(read.status, 0, read.stderr);
  return JSON.parse(read.stdout);
}

/**
 * A world under the test's temporary directory: a stand-in Rigger that records each start and
 * exit in one record and holds until released, a repository, a home holding the log directory,
 * and the shipped template's plist rendered for each label asked for.
 */
function launchdWorld(t) {
  const root = realpathSync(temporaryDirectory('1341-launchd-'));
  const home = join(root, 'home');
  const repository = join(root, 'repository');
  const record = join(root, 'record.jsonl');
  const fifo = join(root, 'hold');
  const rigger = join(root, 'rigger');
  mkdirSync(join(home, 'Library', 'Logs', 'rigger'), { recursive: true });
  mkdirSync(repository);
  writeFileSync(record, '');
  const made = spawnSync('/usr/bin/mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  // The stand-in records its start, blocks opening the hold until the test opens it to write,
  // reads the release, records its exit and exits 0.
  writeFileSync(rigger, `#!${process.execPath}
// ABOUTME: Stand-in Rigger for the launchd host test: records each start and exit, holds until released.
const fs = require('node:fs');
const note = (event) => fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ event, pid: process.pid, at: Date.now(), args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
note('start');
const hold = fs.openSync(${JSON.stringify(fifo)}, 'r');
fs.readSync(hold, Buffer.alloc(64));
note('exit');
`);
  chmodSync(rigger, 0o755);
  const fills = {
    __RIGGER__: rigger, __REPOSITORY__: repository, __START_INTERVAL__: START_INTERVAL,
    __EXIT_TIMEOUT__: EXIT_TIMEOUT, __PATH__: '/usr/bin:/bin', __HOME__: home,
  };
  const template = readFileSync(fileURLToPath(new URL('../templates/launchd/com.williacj.rigger.plist', import.meta.url)), 'utf8');
  const loaded = [];
  const world = {
    root, record, fills, loaded,
    /** Renders the plist for `label`, checks it against the shipped template, and returns its path. */
    plist(label) {
      testLabel(label);
      const path = join(root, `${label}.plist`);
      writeFileSync(path, render(template, label, fills));
      assertRenderedFromTemplate(template, path, label, fills, root);
      return path;
    },
    bootstrap(label) {
      const path = world.plist(label);
      if (!loaded.includes(label)) loaded.push(label);
      t.diagnostic(`bootstrap ${domain} ${path}`);
      return launchctl('bootstrap', domain, path);
    },
    entries() {
      return readFileSync(record, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    starts() { return world.entries().filter((entry) => entry.event === 'start'); },
    exits() { return world.entries().filter((entry) => entry.event === 'exit'); },
    /** Opens the hold to write, which lets a held instance read its release and exit. */
    async release() {
      const hold = await open(fifo, 'w');
      try { await hold.write('release\n'); } finally { await hold.close(); }
    },
    /** Boots out every label this world loaded and waits until launchd no longer knows each one. */
    async bootout() {
      for (const label of loaded) {
        const out = launchctl('bootout', `${domain}/${label}`);
        t.diagnostic(`bootout ${domain}/${label}: exit ${out.status} ${out.stderr.trim()}`);
        const gone = await until(() => launchctl('print', `${domain}/${label}`).status !== 0, Date.now() + (EXIT_TIMEOUT + 10) * 1000);
        assert.ok(gone, `${label} is still loaded after bootout`);
        t.diagnostic(`print ${domain}/${label}: not loaded`);
      }
    },
  };
  t.diagnostic(`record ${record}`);
  return world;
}

/** The rendered plist differs from the shipped template's keys and values only in Label and the placeholders' values. */
function assertRenderedFromTemplate(template, path, label, fills, root) {
  const rendered = plutilRead(path);
  // The template's integer placeholders are not integers, so plutil reads them as strings here.
  const symbolic = join(root, 'template-symbolic.plist');
  writeFileSync(symbolic, template.replace(/<integer>(__[A-Z_]+__)<\/integer>/g, '<string>$1</string>'));
  const shipped = plutilRead(symbolic);
  const used = new Set();
  const compare = (want, got, at) => {
    if (at === 'Label') return assert.equal(got, label);
    if (typeof want === 'string' && /__[A-Z_]+__/.test(want)) {
      let filled = want;
      for (const name of PLACEHOLDERS) if (filled.includes(name)) { used.add(name); filled = filled.replaceAll(name, String(fills[name])); }
      return assert.equal(String(got), filled, `${at} fills its placeholders`);
    }
    if (want !== null && typeof want === 'object') {
      assert.equal(Array.isArray(got), Array.isArray(want), `${at} keeps its type`);
      assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), `${at} keeps the template's keys`);
      for (const key of Object.keys(want)) compare(want[key], got[key], at ? `${at}.${key}` : key);
      return undefined;
    }
    return assert.deepEqual(got, want, `${at} keeps the template's value`);
  };
  compare(shipped, rendered, '');
  assert.equal(typeof rendered.StartInterval, 'number', 'StartInterval is an integer once filled');
  assert.equal(typeof rendered.ExitTimeOut, 'number', 'ExitTimeOut is an integer once filled');
  assert.deepEqual([...used].sort(), [...PLACEHOLDERS].sort(), 'the rendered plist fills all six placeholders');
  for (const name of ['__HOME__', '__REPOSITORY__', '__RIGGER__']) {
    assert.ok(String(fills[name]).startsWith(`${root}/`), `${name} is under the test's temporary directory`);
  }
}

/** Refuses foreign labels, sweeps stale ones, loads `labels`, and waits for the start RunAtLoad causes. */
async function loadAndObserveFirstStart(t, world, labels) {
  for (const label of ['com.williacj.rigger', `com.williacj.rigger.test-${process.pid}`, `com.williacj.rigger.test-${process.pid}-0`,
    `com.williacj.rigger.test-${process.pid + 1}-1`, `com.williacj.rigger.test-${process.pid}-1.extra`]) {
    assert.throws(() => world.bootstrap(label), /refused to load/, label);
  }
  sweepStaleLabels(t);
  for (const label of labels) {
    const loaded = world.bootstrap(label);
    assert.equal(loaded.status, 0, `bootstrap ${label}: ${loaded.stderr}`);
  }
  // RunAtLoad starts the job on load; ten seconds is launchd's default ThrottleInterval.
  const first = await until(() => world.starts()[0], Date.now() + THROTTLE_INTERVAL * 1000);
  assert.ok(first, 'RunAtLoad started no instance within 10 s of the load');
  t.diagnostic(`first start pid ${first.pid} at ${first.at}`);
  return first;
}

/** Holds the first instance across three StartInterval periods, stopping early on a second start. */
async function holdThreePeriods(t, world, first) {
  const held = first.at + (3 * START_INTERVAL + 1) * 1000;
  await until(() => world.starts().length > 1 || Date.now() >= held, held + 1000);
  t.diagnostic(`held ${Date.now() - first.at} ms across StartInterval ${START_INTERVAL} s; starts ${JSON.stringify(world.starts())}`);
}

/** Releases the held instance, waits for its exit, then for the next start. */
async function releaseAndObserveSecondStart(t, world) {
  await world.release();
  const exited = await until(() => world.exits()[0], Date.now() + 10_000);
  assert.ok(exited, 'the released instance recorded no exit');
  const bound = (START_INTERVAL + THROTTLE_INTERVAL) * 1000;
  // Five seconds past the bound, so a late start is reported by the assertion rather than missed.
  const second = await until(() => world.starts()[1], exited.at + bound + 5000);
  t.diagnostic(`exit pid ${exited.pid} at ${exited.at}; second start ${JSON.stringify(second)}; delay ${second ? second.at - exited.at : 'none'} ms`);
  assert.ok(second, 'no second start followed the exit');
  return { exited, second, bound };
}

// Host reason: a real deadline; launchd's StartInterval firings arrive on the real clock, and the
// test holds its instance across three of them.
// Ordinary decision counterpart: test/launchd-template.test.mjs :: the shipped job relaunches after the selected interval
// proves R-WORK-4
test('L1 launchd starts the shipped job once while its instance runs across three StartInterval periods', { skip: launchdSkip, timeout: 120_000 }, async (t) => {
  const world = launchdWorld(t);
  try {
    const first = await loadAndObserveFirstStart(t, world, [testLabel()] /* L1 labels */);
    await holdThreePeriods(t, world, first);
    assert.ok(Date.now() - first.at >= 3 * START_INTERVAL * 1000, 'the instance was held across three periods');
    assert.equal(world.starts().length, 1, 'exactly one start while the first instance runs');
  } finally {
    await world.bootout();
  }
});

// Host reason: a real deadline; the second start must come within StartInterval plus launchd's
// ThrottleInterval of the first instance's exit, on the real clock.
// Ordinary decision counterpart: test/launchd-template.test.mjs :: the shipped job relaunches after the selected interval
// proves R-WORK-4
test('L2 launchd starts the shipped job again no earlier than its released instance exits', { skip: launchdSkip, timeout: 120_000 }, async (t) => {
  const world = launchdWorld(t);
  try {
    const first = await loadAndObserveFirstStart(t, world, [testLabel()] /* L2 order labels */);
    await holdThreePeriods(t, world, first);
    const { exited, second, bound } = await releaseAndObserveSecondStart(t, world);
    assert.ok(second.at >= exited.at, `the second start (${second.at}) is no earlier than the first instance's exit (${exited.at})`);
  } finally {
    await world.bootout();
  }
});

// Host reason: a real deadline; the second start is measured against StartInterval plus launchd's
// ThrottleInterval on the real clock.
// Ordinary decision counterpart: test/launchd-template.test.mjs :: the shipped job relaunches after the selected interval
test('L2 launchd starts the shipped job again within StartInterval plus 10 s of its instance\'s exit', { skip: launchdSkip, timeout: 120_000 }, async (t) => {
  const world = launchdWorld(t);
  try {
    const first = await loadAndObserveFirstStart(t, world, [testLabel()] /* L2 bound labels */);
    await holdThreePeriods(t, world, first);
    const { exited, second, bound } = await releaseAndObserveSecondStart(t, world);
    assert.ok(second.at - exited.at <= bound, `the second start came ${second.at - exited.at} ms after the exit, within ${bound} ms`);
  } finally {
    await world.bootout();
  }
});

// Host reason: a real deadline; the test waits for the start RunAtLoad causes on the real clock.
// Ordinary decision counterpart: test/launchd-template.test.mjs :: the shipped LaunchAgent has the fixed label
// proves R-WORK-4
test('L3 a second bootstrap of the loaded shipped job is refused', { skip: launchdSkip, timeout: 120_000 }, async (t) => {
  const world = launchdWorld(t);
  try {
    const label = testLabel();
    await loadAndObserveFirstStart(t, world, [label]);
    const again = world.bootstrap(label); // L3 refused bootstrap
    t.diagnostic(`second bootstrap of ${label}: exit ${again.status} ${again.stderr.trim()}`);
    assert.notEqual(again.status, 0, 'a second bootstrap of the loaded label exits non-zero');
  } finally {
    await world.bootout();
  }
});

// Host reason: a real deadline; the test waits, on the real clock, for any start the second
// bootstrap might cause.
// Ordinary decision counterpart: test/launchd-template.test.mjs :: the shipped LaunchAgent has the fixed label
test('L3 after a refused second bootstrap the shipped job still has one running instance', { skip: launchdSkip, timeout: 120_000 }, async (t) => {
  const world = launchdWorld(t);
  try {
    const label = testLabel();
    const first = await loadAndObserveFirstStart(t, world, [label]);
    const again = world.bootstrap(label); // L3 one instance bootstrap
    t.diagnostic(`second bootstrap of ${label}: exit ${again.status} ${again.stderr.trim()}`);
    // A start the bootstrap caused would be recorded within launchd's ten-second ThrottleInterval.
    await until(() => world.starts().length > 1, Date.now() + THROTTLE_INTERVAL * 1000);
    t.diagnostic(`record after the second bootstrap: ${JSON.stringify(world.entries())}`);
    assert.equal(world.starts().length, 1, 'one start after the refused bootstrap');
    assert.equal(world.exits().length, 0, 'the first instance has not exited');
    assert.ok(running(first.pid), `the first instance, pid ${first.pid}, is still running`);
  } finally {
    await world.bootout();
  }
});
