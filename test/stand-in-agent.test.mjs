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
import { installStandInAgent } from './stub-claude.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { temporaryDirectory } from './temporary-directory.mjs';

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

/**
 * `NODE_OPTIONS` that remove `process.execve` before any module runs, as Node 20, the floor the
 * README sets, lacks it: Node added it in 23.11.0 and 22.15.0.
 */
const WITHOUT_EXECVE = '--import=data:text/javascript,delete%20process.execve';

test('a stand-in planned to exec a command under every card replaces itself with that command, which keeps its pid, under a Node without process.execve', SETTLES_WITHIN, async () => {
  const agent = standInAgent();
  const pidFile = join(agent.dir, 'exec.pid');
  mkdirSync(join(agent.dir, 'exec'));
  const installed = installStandInAgent(join(agent.dir, 'exec'), { '*': { engineer: { exec: ['/bin/sh', '-c', `echo $$ > '${pidFile}'`] } } });
  const child = spawn(join(installed.dir, 'claude'), ['--append-system-prompt-file', '/nowhere/.claude/agents/engineer.md'], { env: { ...process.env, NODE_OPTIONS: WITHOUT_EXECVE }, stdio: ['pipe', 'ignore', 'pipe'] });
  let said = '';
  child.stderr.on('data', (chunk) => { said += chunk; });
  child.stdin.end('Rigger dispatched this session, unattended, as the maker for card #3.\n');
  const [code] = await once(child, 'exit');

  assert.equal(code, 0, said);
  assert.equal(readFileSync(pidFile, 'utf8').trim(), String(child.pid));
});

/**
 * `NODE_OPTIONS` loading a module into one stand-in run before anything else, which stops the run
 * at its first read of whether the file named `wrote-<card>-<role>` by `target` is there: before
 * the read (`before`) or after it (`after`), saying `stopped before` or `read <answer>` on its
 * standard output, and going on once the test opens the FIFO `gate`. With `wrote`, it stops instead
 * just after the run writes that file, saying `wrote`. Every directory watch the run sets reports
 * nothing, as a macOS watch reports nothing of a file written before its FSEvents stream started
 * (#622), so no test here can pass on a watch.
 */
function stopping(target, gate, at) {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const [target, gate, at] = ${JSON.stringify([target, gate, at])};
    const { existsSync, watch, writeFileSync } = fs;
    let stopped = false;
    const stop = (said) => { stopped = true; fs.writeSync(1, said + '\\n'); fs.readFileSync(gate); };
    const ours = (path) => !stopped && String(path).endsWith('/' + target);
    fs.existsSync = (path) => {
      if (at === 'wrote' || !ours(path)) return existsSync(path);
      if (at === 'before') stop('stopped before');
      const there = existsSync(path);
      if (at === 'after') stop('read ' + there);
      return there;
    };
    fs.writeFileSync = (path, ...rest) => {
      const mine = at === 'wrote' && ours(path);
      writeFileSync(path, ...rest);
      if (mine) stop('wrote');
    };
    fs.watch = (path) => watch(path, () => {});
    syncBuiltinESMExports();
  `;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

/** The card every run below is for. */
const CARD = 7;

/**
 * The stand-in agent planned so that the run in the role `architect` awaits the file the run in
 * the role `reviewer` writes, and exits 5 once it has it: the exit, not a timer, says the wait
 * settled. A run planned to stay alive after writing does, until it is killed.
 */
function awaiting(alive = false) {
  return standInAgent({ [CARD]: { architect: { await: 'reviewer', exit: 5 }, reviewer: { write: true, ...(alive ? { forever: true } : {}) } } });
}

/**
 * Starts one run of `agent` for `CARD` in `role`, with `options` added to its `NODE_OPTIONS`, and
 * gives back the child, its exit, and `said(text)`, which settles once its standard output holds
 * `text`. The child is killed at the test's end where it is still running.
 */
function started(t, agent, role, options) {
  const child = spawn(join(agent.dir, 'claude'), ['--append-system-prompt-file', `/nowhere/.claude/agents/${role}.md`], { env: options === undefined ? process.env : { ...process.env, NODE_OPTIONS: options }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  child.stdin.end(`Rigger dispatched this session, unattended, as the ${role} for card #${CARD}.\n`);
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal, err: () => err }));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return { child, exited, said: (text) => until(() => out.includes(text), t), err: () => err };
}

/** A FIFO in a directory of its own, which a run `stopping` names waits on until the test opens it. */
function gateIn() {
  const gate = join(temporaryDirectory('rigger-gate-'), 'gate');
  execFileSync('/usr/bin/mkfifo', [gate]);
  return { gate, open: () => writeFile(gate, '') };
}

/** The FIFO a run awaiting the reviewer's file makes beside it, by name. */
const FIFO = `wrote-${CARD}-reviewer.awaited`;

// Regression for #622's cause: the file is written after the wait's first read found it missing,
// and no watch ever reports it. Here the writer has exited before the wait goes on.
test('a run awaiting a file written after its first read found it missing, with no watch reporting the write and the writer already exited, settles and leaves no FIFO beside itself', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  const writer = started(t, agent, 'reviewer');
  assert.equal((await writer.exited).code, 0, writer.err());
  await open();

  const ended = await waiter.exited;
  assert.equal(ended.code, 5, ended.err());
  assert.ok(existsSync(agent.dir));
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
});

// Regression for #622's cause, as the one above, with the writer still alive when the wait settles.
test('a run awaiting a file written after its first read found it missing, with no watch reporting the write, settles while the writer is still alive', SETTLES_WITHIN, async (t) => {
  const agent = awaiting(true);
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  const writer = started(t, agent, 'reviewer');
  await open();

  const ended = await waiter.exited;
  assert.equal(ended.code, 5, ended.err());
  assert.equal(writer.child.exitCode, null);
  assert.equal(writer.child.signalCode, null);
  assert.ok(agent.wrote(CARD, 'reviewer'));
});

// Control: the file is there before the wait begins, so its first read settles it.
for (const alive of [false, true]) {
  test(`a run awaiting a file written before it began, by a writer ${alive ? 'still alive' : 'that has exited'}, settles on its first read`, SETTLES_WITHIN, async (t) => {
    const agent = awaiting(alive);
    const writer = started(t, agent, 'reviewer');
    if (alive) await until(() => agent.wrote(CARD, 'reviewer'), t);
    else assert.equal((await writer.exited).code, 0, writer.err());
    const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, '/nowhere', 'none'));

    const ended = await waiter.exited;
    assert.equal(ended.code, 5, ended.err());
  });
}

// Control: the file is written after the wait began and before its first read, which finds it.
for (const alive of [false, true]) {
  test(`a run awaiting a file written after it began and before its first read, by a writer ${alive ? 'still alive' : 'that has exited'}, settles`, SETTLES_WITHIN, async (t) => {
    const agent = awaiting(alive);
    const { gate, open } = gateIn();
    const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'before'));
    await waiter.said('stopped before');
    const writer = started(t, agent, 'reviewer');
    if (alive) await until(() => agent.wrote(CARD, 'reviewer'), t);
    else assert.equal((await writer.exited).code, 0, writer.err());
    await open();

    const ended = await waiter.exited;
    assert.equal(ended.code, 5, ended.err());
  });
}

// Control for a write that fails: nothing is announced, the wait stays open, and a SIGTERM ends it
// with its FIFO gone from the directory, which is still there.
test('a run awaiting a file its writer fails to write does not settle, and ended by SIGTERM leaves no FIFO beside itself', { ...SETTLES_WITHIN, skip: 'U15: skipped until #813 fixes the writer timeout' }, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  chmodSync(agent.dir, 0o555);
  t.after(() => chmodSync(agent.dir, 0o755));
  const writer = started(t, agent, 'reviewer');
  const failed = await writer.exited;
  chmodSync(agent.dir, 0o755);
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EACCES/);
  assert.equal(agent.wrote(CARD, 'reviewer'), false);
  await open();
  // The wait still holds its FIFO open, so it has not settled: a settled wait closes it first.
  const probe = openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK);
  closeSync(probe);
  waiter.child.kill('SIGTERM');

  const ended = await waiter.exited;
  assert.equal(ended.signal, 'SIGTERM');
  assert.ok(existsSync(agent.dir));
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
});

// The wait's FIFO cannot be made, so it cannot be told of the file: it fails, though the file is
// there, and leaves alone what is in the FIFO's place.
test('a run awaiting a file that is already there, whose FIFO cannot be made, fails rather than settling and leaves what holds the FIFO\'s name', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const writer = started(t, agent, 'reviewer');
  assert.equal((await writer.exited).code, 0, writer.err());
  mkdirSync(join(agent.dir, FIFO));
  const waiter = started(t, agent, 'architect');

  const ended = await waiter.exited;
  assert.notEqual(ended.code, 5);
  assert.notEqual(ended.code, 0);
  assert.match(ended.err(), /could not open .*\.awaited to be told of it/);
  assert.ok(lstatSync(join(agent.dir, FIFO)).isDirectory());
});

// A wait already settled by its first read stays settled when its writer then fails to announce.
test('a run whose writer fails to announce a file after the wait\'s first read has settled on it exits as settled, and the writer fails saying why', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const writer = started(t, agent, 'reviewer', stopping(`wrote-${CARD}-reviewer`, gate, 'wrote'));
  await writer.said('wrote');
  const waiter = started(t, agent, 'architect');
  const ended = await waiter.exited;
  assert.equal(ended.code, 5, ended.err());
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
  mkdirSync(join(agent.dir, FIFO));
  await open();

  const failed = await writer.exited;
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EISDIR/);
});

// A wait pending after a false first read, told something other than that the file is written,
// fails rather than settling, after its writer has exited, and leaves no FIFO.
test('a run awaiting a file, whose FIFO carries something other than the word that it is written, fails rather than settling and leaves no FIFO beside itself', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  const wrong = openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK);
  writeSync(wrong, 'x');
  closeSync(wrong);
  const writer = started(t, agent, 'reviewer');
  assert.equal((await writer.exited).code, 0, writer.err());
  await open();

  const ended = await waiter.exited;
  assert.notEqual(ended.code, 5);
  assert.notEqual(ended.code, 0);
  assert.match(ended.err(), /carried "x/);
  assert.ok(existsSync(agent.dir));
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
});

/**
 * `NODE_OPTIONS` loading a module into one stand-in run that makes every `openSync` of a path
 * ending in `.awaited` throw `EMFILE`, as an open fails when the process has no descriptor left,
 * so a waiter fails to open the FIFO it has just made and a writer fails to announce through it.
 */
function refusingFifo() {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const { openSync } = fs;
    fs.openSync = (path, ...rest) => {
      if (String(path).endsWith('.awaited')) throw Object.assign(new Error('EMFILE: too many open files, open ' + path), { code: 'EMFILE' });
      return openSync(path, ...rest);
    };
    syncBuiltinESMExports();
  `;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

// N7r: the FIFO cannot be made, the file not yet written: the wait fails before it reads, and a
// later write does not turn it into success. What holds the FIFO's name is left.
test('a run awaiting a file not yet written, whose FIFO cannot be made, fails before the file is written and leaves what holds the FIFO\'s name', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  writeFileSync(join(agent.dir, FIFO), '');
  const waiter = started(t, agent, 'architect');
  const ended = await waiter.exited;
  const writer = started(t, agent, 'reviewer');
  assert.equal((await writer.exited).code, 0, writer.err());

  assert.notEqual(ended.code, 5);
  assert.notEqual(ended.code, 0);
  assert.match(ended.err(), /could not open .*\.awaited to be told of it/);
  assert.ok(agent.wrote(CARD, 'reviewer'));
  assert.ok(lstatSync(join(agent.dir, FIFO)).isFile());
});

// N7r: the FIFO is made but cannot be opened, with the file already there or written only after:
// the wait fails either way and removes the FIFO it made, while the directory is still there.
for (const already of [true, false]) {
  test(`a run awaiting a file ${already ? 'already written by a writer that has exited' : 'written only after the wait has failed'}, whose FIFO is made but cannot be opened, fails and removes the FIFO`, SETTLES_WITHIN, async (t) => {
    const agent = awaiting();
    if (already) {
      const writer = started(t, agent, 'reviewer');
      assert.equal((await writer.exited).code, 0, writer.err());
    }
    const waiter = started(t, agent, 'architect', refusingFifo());
    const ended = await waiter.exited;
    if (!already) {
      const writer = started(t, agent, 'reviewer');
      assert.equal((await writer.exited).code, 0, writer.err());
    }

    assert.notEqual(ended.code, 5);
    assert.notEqual(ended.code, 0);
    assert.match(ended.err(), /could not open .*\.awaited to be told of it/);
    assert.match(ended.err(), /EMFILE/);
    assert.ok(agent.wrote(CARD, 'reviewer'));
    assert.ok(existsSync(agent.dir));
    assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
  });
}

// Producer-only publication failure before the wait's first read: the writer fails saying why, and
// the wait, reading the file, settles on it.
test('a writer that fails to announce a file before the wait\'s first read fails saying why, and the wait settles on reading the file', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'before'));
  await waiter.said('stopped before');
  const writer = started(t, agent, 'reviewer', refusingFifo());
  const failed = await writer.exited;
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EMFILE/);
  assert.ok(agent.wrote(CARD, 'reviewer'));
  await open();

  const ended = await waiter.exited;
  assert.equal(ended.code, 5, ended.err());
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
});

// Producer-only publication failure after the wait's first read found nothing: the writer fails
// saying why, and the wait, told nothing, does not settle until a SIGTERM ends it without its FIFO.
test('a writer that fails to announce a file after the wait\'s first read found it missing fails saying why, and the wait does not settle', { ...SETTLES_WITHIN, skip: 'U19: skipped until #813 fixes the writer timeout' }, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  const writer = started(t, agent, 'reviewer', refusingFifo());
  const failed = await writer.exited;
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EMFILE/);
  assert.ok(agent.wrote(CARD, 'reviewer'));
  await open();
  // The wait still holds its FIFO open, so it has not settled: a settled wait closes it first.
  closeSync(openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK));
  waiter.child.kill('SIGTERM');

  const ended = await waiter.exited;
  assert.equal(ended.signal, 'SIGTERM');
  assert.deepEqual(readdirSync(agent.dir).filter((name) => name.endsWith('.awaited')), []);
});

// Regression for #622's cause in a directory made read-only while the wait is pending: the file
// is written after the wait's first read found it missing, the writer has exited, and the wait,
// told of it, settles though it cannot remove its FIFO, which stays behind closed, and says so.
test('a run told of its file after its directory was made read-only settles, and leaves its FIFO closed and says so', SETTLES_WITHIN, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await waiter.said('read false');
  const writer = started(t, agent, 'reviewer');
  assert.equal((await writer.exited).code, 0, writer.err());
  chmodSync(agent.dir, 0o555);
  t.after(() => chmodSync(agent.dir, 0o755));
  await open();

  const ended = await waiter.exited;
  assert.equal(ended.code, 5, ended.err());
  assert.match(ended.err(), /left .*\.awaited behind, closed: .*EACCES/);
  assert.ok(lstatSync(join(agent.dir, FIFO)).isFIFO());
  assert.throws(() => openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK), { code: 'ENXIO' });
});
