// ABOUTME: Tests the stand-in agent every maker runs as under `npm test`: a run that holds is woken by
// a release sent at any moment after it says it holds, the earliest included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

import { processState, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { installStandInAgent } from './stub-claude.mjs';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { temporaryDirectory } from './temporary-directory.mjs';
import { chmodTraces } from './temporary-directory.mjs';
import { recorded, TRACE, traceTo } from './stub-claude.mjs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { LSOF, PS, READ_TIMEOUT } from '../src/substrate/process.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

/**
 * How many runs hold at once, each released in the turn its hold is seen. A judgment: the release
 * the stand-in once missed came in the moment after its hold, and the engineer's probe on #556 met
 * it in 2 of 40 runs at a load of 23, so forty at once makes that moment many times over.
 */
const RUNS = 40;

test('run observations publish a record only after its terminating newline arrives', () => {
  const agent = standInAgent();
  const log = join(agent.dir, 'runs.jsonl');
  writeFileSync(log, '{"card":1}\n{"card":');
  assert.deepEqual(agent.runs(), [{ card: 1 }]);
  appendFileSync(log, '2}\n');
  assert.deepEqual(agent.runs(), [{ card: 1 }, { card: 2 }]);
});

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
  // Read the input this test sends before exiting, so its pipe cannot close under the write.
  const installed = installStandInAgent(join(agent.dir, 'exec'), { '*': { engineer: { exec: ['/bin/sh', '-c', `/bin/cat > /dev/null; echo $$ > '${pidFile}'`] } } });
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
function stopping(target, gate, at, errorMap) {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const [target, gate, at, errorMap] = ${JSON.stringify([target, gate, at, errorMap])};
    const { existsSync, watch, writeFileSync, openSync, writeSync, lstatSync } = fs;
    let announcement;
    let originalWriteFailure;
    let absenceProbes = 0;
    let stopped = false;
    const traced = (event, said) => globalThis[Symbol.for(${JSON.stringify(TRACE.description)})]?.(event, { gate, said });
    const stop = (said) => { stopped = true; fs.writeSync(1, said + '\\n'); traced('gate read starting', said); fs.readFileSync(gate); fs.writeSync(1, 'gate returned\\n'); traced('gate read returned', said); };
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
    if (errorMap !== null) process.on('uncaughtExceptionMonitor', (failure) => {
      writeSync(1, 'original write error retained ' + (failure === originalWriteFailure) + '\\n');
      writeSync(1, 'absence probes ' + absenceProbes + '\\n');
    });
    fs.lstatSync = (path, ...rest) => {
      if (errorMap !== null && announcement !== undefined && String(path).endsWith('/' + target)) {
        absenceProbes += 1;
        if (errorMap === 'probe-error') throw Object.assign(new Error('controlled absence observation failure'), { code: 'EACCES' });
      }
      return lstatSync(path, ...rest);
    };
    fs.openSync = (path, flags, ...rest) => {
      const fd = openSync(path, flags, ...rest);
      if (at === 'announce' && String(path).endsWith('/' + target) && flags === (fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)) {
        announcement = fd;
        stop('announce opened');
        setImmediate(() => writeSync(1, 'announce turn returned\\n'));
      }
      return fd;
    };
    fs.writeSync = (fd, ...rest) => {
      if (fd !== announcement) return writeSync(fd, ...rest);
      try {
        if (errorMap === 'write-error') throw Object.assign(new Error('controlled announcement write failure'), { code: 'EIO' });
        const written = writeSync(fd, ...rest);
        writeSync(1, 'announce write returned ' + written + '\\n');
        return written;
      } catch (failure) {
        originalWriteFailure = failure;
        writeSync(1, 'announce write threw ' + failure.code + '\\n');
        throw failure;
      }
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
  traces.get(t)?.started(role, child, () => err);
  t.after(hooked(t, `the ${role}'s kill at the test's end`, () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }));
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

/** This checkout, the directory above the one this file is in. */
const CHECKOUT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The trace of each test that asks for one (`tracing`), by its context. A test not here records nothing. */
const traces = new WeakMap();

/**
 * Where a traced run keeps its trace: a new directory of its own under the directory
 * `C615_EVIDENCE_ROOT` names, which `npm test` makes outside its own `TMPDIR` and leaves once it
 * holds anything, so the trace can be read after the suite. The root is used only where it is set,
 * absolute, a directory and not a link, private to its owner, and, as it resolves, outside both this
 * checkout and the suite's `TMPDIR`; anything else, a root that cannot be resolved included, gives
 * undefined, and the run's output then carries the whole trace.
 */
function evidenceDirectory() {
  const requested = process.env.C615_EVIDENCE_ROOT;
  if (!requested || !isAbsolute(requested)) return undefined;
  try {
    const entry = lstatSync(requested);
    if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) return undefined;
    const root = realpathSync.native(requested);
    const outside = (path) => root !== path && !root.startsWith(`${path}/`);
    if (!outside(realpathSync.native(CHECKOUT)) || !outside(realpathSync.native(tmpdir()))) return undefined;
    const directory = join(root, `stand-in-trace-${randomUUID()}`);
    mkdirSync(directory, { mode: 0o700 });
    return directory;
  } catch {
    return undefined;
  }
}

/**
 * What `command` answers, run synchronously with `args`, or that it did not answer: a listing that
 * runs past `READ_TIMEOUT`, L0's bound on one read of the process table, is ended and recorded
 * unanswered, with its status and standard error. A bound, not a wait.
 */
function listing(command, args) {
  const ran = spawnSync(command, args, { encoding: 'utf8', env: process.env, timeout: READ_TIMEOUT, maxBuffer: 2 ** 28 });
  const answered = ran.error === undefined && ran.signal === null;
  return { command: [command, ...args].join(' '), answered, status: ran.status, signal: ran.signal, error: ran.error?.message ?? null, stdout: ran.stdout ?? null, stderr: ran.stderr ?? null };
}

/**
 * What a traced test holds at its bound: for the waiter and the writer, Node's reading of each
 * child and `ps`'s, with the start time `ps` gives where Node has reported an exit and `ps` still
 * lists the pid; `lsof`'s holders of the gate and of the waiter's FIFO, each with its pid, its
 * descriptor and its access mode; the test process's active resources; and every process whose
 * command line runs a file under this checkout's `test/`. Every read is synchronous.
 */
function snapshot(children, gate, fifo) {
  const roles = Object.fromEntries(['architect', 'reviewer'].map((role) => {
    const child = children.get(role)?.child;
    if (child === undefined) return [role, { node: 'not started' }];
    const node = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, spawnedAt: children.get(role).at };
    const ps = listing(PS, ['-o', 'stat=', '-p', String(child.pid)]);
    const reported = child.exitCode !== null || child.signalCode !== null;
    const listed = ps.answered && ps.stdout.trim() !== '';
    return [role, { node, ps, ...(reported && listed ? { lstart: listing(PS, ['-o', 'lstart=', '-p', String(child.pid)]) } : {}), stderr: children.get(role).err() }];
  }));
  return {
    roles,
    lsof: holders({ gate, fifo }),
    activeResources: process.getActiveResourcesInfo(),
    processes: testProcesses(),
  };
}

/**
 * Each process holding each FIFO in `paths`, by name, with its pid, its descriptor and its access
 * mode, from one listing of every file this user's processes hold. `lsof` given a FIFO's path lists
 * nothing on macOS, though it names the FIFO in a listing by process, so the listing is the user's.
 */
function holders(paths) {
  const table = listing(LSOF, ['-nP', '-F', 'pfan', '-u', String(process.getuid())]);
  const held = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, { path, holders: [] }]));
  let pid;
  let file = {};
  for (const field of table.answered ? table.stdout.split('\n') : []) {
    if (field.startsWith('p')) pid = Number(field.slice(1));
    if (field.startsWith('f')) file = { pid, fd: field.slice(1) };
    if (field.startsWith('a')) file.access = field.slice(1);
    if (field.startsWith('n')) for (const entry of Object.values(held)) if (field.slice(1) === entry.path) entry.holders.push(file);
  }
  return { listing: { ...table, stdout: undefined }, ...held };
}

/**
 * Every process whose command line runs a file under this checkout's `test/`, from one listing of
 * the process table: a word naming such a file by its absolute path, or by a path relative to a
 * working directory that `lsof` reports is this checkout, as `node --test` names its files.
 */
function testProcesses() {
  const checkout = realpathSync.native(CHECKOUT);
  const table = listing(PS, ['-axww', '-o', 'pid=,ppid=,stat=,command=']);
  if (!table.answered) return { table };
  const rows = table.stdout.split('\n').filter(Boolean).map((line) => ({ line, pid: line.trim().split(/\s+/)[0], words: line.trim().split(/\s+/).slice(3) }));
  const absolute = rows.filter(({ words }) => words.some((word) => word.startsWith(`${checkout}/test/`) || word.startsWith(`${CHECKOUT}/test/`)));
  const relative = rows.filter((row) => !absolute.includes(row) && row.words.some((word) => /^(\.\/)?test\//.test(word)));
  const cwd = relative.length === 0 ? undefined : listing(LSOF, ['-a', '-d', 'cwd', '-nP', '-F', 'pn', '-p', relative.map(({ pid }) => pid).join(',')]);
  const inCheckout = new Set();
  let pid;
  for (const field of cwd?.stdout?.split('\n') ?? []) {
    if (field.startsWith('p')) pid = field.slice(1);
    if (field.startsWith('n') && field.slice(1) === checkout) inCheckout.add(pid);
  }
  return { table: { ...table, stdout: undefined }, cwd: cwd && { ...cwd, stdout: undefined, fields: cwd.stdout }, listed: [...absolute, ...relative.filter((row) => inCheckout.has(row.pid))].map(({ line }) => line) };
}

/**
 * Traces the test `t`, whose stand-in is `agent` and whose gate is the FIFO `gate`: it plans a
 * `trace` into the act of the waiter (`architect`) and the writer (`reviewer`), so only their runs
 * record, and records in the test process each child it starts, each step it wraps (`traced`), each
 * hook it wraps (`hooked`), the abort of `t.signal`, and, where that abort comes while the body is
 * still running, which is at its bound, a snapshot taken there, before any teardown signals. Once
 * the test's own teardown has run, the output names where the trace is, and carries it whole where
 * the run was held at its bound or no evidence root could hold it. The trace adds no assertion.
 */
function tracing(t, agent, gate) {
  const kept = evidenceDirectory();
  const children = new Map();
  let closed = false;
  let teardown = false;
  let held = false;
  // Runs after the test's own teardown, by which the stand-in directory's sweep and `started`'s
  // hooks have killed every child still running, so each child's `close` comes: it waits on those
  // events, so the trace holds each child's exit and its whole standard error before it closes.
  const emit = async () => {
    await Promise.all([...children.values()].map(({ ended }) => ended));
    chmodTraces.delete(agent.dir);
    for (const [role, { child, err }] of children) record('final reading', { role, child: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, stderr: err() });
    closed = true;
    t.diagnostic(`stand-in trace: ${directory}${kept === undefined ? ', which is removed with the test, so its events follow' : ''}`);
    if (!held && kept !== undefined) return;
    const events = readdirSync(directory).filter((name) => name.endsWith('.jsonl')).flatMap((name) => readFileSync(join(directory, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    for (const event of events.sort((one, other) => one.at - other.at)) t.diagnostic(`stand-in trace event: ${JSON.stringify(event)}`);
  };
  // Registered before any directory of the trace's own, so the output is written after the stand-in
  // directory's last `beforeRemoval` and before the trace's own directory, where it is one, is gone.
  t.after(() => { teardown = true; t.after(emit); });
  const directory = kept ?? temporaryDirectory('rigger-stand-in-trace-');
  const write = traceTo(directory, 'test');
  const record = (event, fields) => { if (!closed) write(event, fields); };
  record('trace begins', { title: t.name, kept: kept !== undefined });
  t.signal.addEventListener('abort', () => {
    record('t.signal abort', { reason: String(t.signal.reason), teardown });
    if (teardown) return;
    held = true;
    record('snapshot', snapshot(children, gate, join(agent.dir, FIFO)));
  }, { once: true });
  for (const role of ['architect', 'reviewer']) agent.plan(CARD, role, { ...agent.act(CARD, role), trace: directory });
  chmodTraces.set(agent.dir, (call) => recorded(record, 'the removal\'s chmod of the stand-in\'s directory', call, { path: agent.dir }));
  traces.set(t, {
    record,
    started: (role, child, err) => {
      record('spawn', { role, child: child.pid });
      child.once('exit', (code, signal) => record('exit', { role, child: child.pid, code, signal }));
      const ended = new Promise((resolve) => child.once('close', () => { record('close', { role, child: child.pid, stderr: err() }); resolve(); }));
      children.set(role, { child, err, at: Date.now(), ended });
    },
  });
}

/** What `call` gives back, recorded as a step where `t` is traced. */
const traced = (t, label, call) => recorded(traces.get(t)?.record, label, call);

/** `hook`, recorded as it starts and returns where `t` is traced when it runs. */
const hooked = (t, label, hook) => (...args) => recorded(traces.get(t)?.record, label, () => hook(...args), { hook: true });

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
  tracing(t, agent, gate);
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await traced(t, 'the waiter says read false', () => waiter.said('read false'));
  const writer = started(t, agent, 'reviewer');
  await traced(t, 'the writer writes its file', () => until(() => agent.wrote(CARD, 'reviewer'), t));
  await traced(t, 'the gate\'s open', () => open());

  const ended = await traced(t, 'the waiter\'s exit', () => waiter.exited);
  assert.equal(ended.code, 5, ended.err());
  assert.equal(writer.child.exitCode, null, writer.err());
  assert.equal(writer.child.signalCode, null, writer.err());
  assert.match(processState(writer.child.pid), /^(?![ZX])\S/, 'the writer is a live process when the waiter settles');
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
    tracing(t, agent, gate);
    const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'before'));
    await waiter.said('stopped before');
    const writer = started(t, agent, 'reviewer');
    if (alive) await until(() => agent.wrote(CARD, 'reviewer'), t);
    else assert.equal((await writer.exited).code, 0, writer.err());
    await open();

    const ended = await waiter.exited;
    assert.equal(ended.code, 5, ended.err());
    if (alive) {
      assert.equal(writer.child.exitCode, null, writer.err());
      assert.equal(writer.child.signalCode, null, writer.err());
      assert.match(processState(writer.child.pid), /^(?![ZX])\S/, 'the writer is a live process when the waiter settles');
    }
  });
}

// The waiter may find the file after announcement opens its FIFO but before the actual write.
for (const errorMap of [undefined, 'probe-error', 'write-error']) {
  test(errorMap === undefined
    ? 'a writer stays alive when its waiter settles between notification open and write'
    : errorMap === 'probe-error'
      ? 'a writer preserves its original notification error when the absence observation fails'
      : 'a writer preserves a non-pipe notification error without probing FIFO absence', SETTLES_WITHIN, async (t) => {
    const agent = awaiting(true);
    const waiterGate = gateIn();
    const writerGate = gateIn();
    tracing(t, agent, waiterGate.gate);
    const waiter = started(t, agent, 'architect', stopping('wrote-' + CARD + '-reviewer', waiterGate.gate, 'before'));
    await waiter.said('stopped before');
    const writer = started(t, agent, 'reviewer', stopping(FIFO, writerGate.gate, 'announce', errorMap));
    await writer.said('announce opened');
    assert.ok(agent.wrote(CARD, 'reviewer'));
    await waiterGate.open();
    const ended = await waiter.exited;
    assert.equal(ended.code, 5, ended.err());
    assert.equal(existsSync(join(agent.dir, FIFO)), false, 'the settled waiter removed its owned FIFO');
    await writerGate.open();
    const expectedError = errorMap === 'write-error' ? 'EIO' : 'EPIPE';
    await writer.said('announce write threw ' + expectedError);
    const outcome = await Promise.race([
      writer.exited,
      writer.said('announce turn returned').then(() => undefined),
    ]);
    if (errorMap !== undefined) {
      assert.notEqual(outcome, undefined, 'an unknown FIFO state must not suppress the notification failure');
      assert.equal(outcome.code, 1, outcome.err());
      await writer.said('original write error retained true');
      await writer.said('absence probes ' + (errorMap === 'write-error' ? 0 : 1));
      assert.match(outcome.err(), errorMap === 'write-error' ? /code: 'EIO'/ : /code: 'EPIPE'/);
      assert.doesNotMatch(outcome.err(), /code: 'EACCES'/);
      return;
    }
    if (outcome !== undefined) assert.equal(outcome.code, null, outcome.err());
    assert.equal(writer.child.exitCode, null, writer.err());
    assert.equal(writer.child.signalCode, null, writer.err());
    assert.match(processState(writer.child.pid), /^(?![ZX])\S/, 'the writer remains live after its waiter closed the FIFO');
  });
}

test('a writer rejects a broken notification pipe whose FIFO is still present', SETTLES_WITHIN, async (t) => {
  const agent = awaiting(true);
  const fifo = join(agent.dir, FIFO);
  execFileSync('/usr/bin/mkfifo', [fifo]);
  let reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  t.after(() => { if (reader !== undefined) closeSync(reader); });
  const writerGate = gateIn();
  tracing(t, agent, writerGate.gate);
  const writer = started(t, agent, 'reviewer', stopping(FIFO, writerGate.gate, 'announce'));
  await writer.said('announce opened');
  closeSync(reader);
  reader = undefined;
  assert.ok(existsSync(fifo), 'closing the reader leaves the owned FIFO name present');
  await writerGate.open();
  await writer.said('announce write threw EPIPE');
  const ended = await Promise.race([
    writer.exited,
    writer.said('announce turn returned').then(() => undefined),
  ]);
  assert.notEqual(ended, undefined, 'a present FIFO must not suppress the notification failure');
  assert.equal(ended.code, 1, ended.err());
  assert.match(ended.err(), /code: 'EPIPE'/);
  assert.ok(existsSync(fifo), 'a failed announcement does not remove the FIFO');
});

// Control for a write that fails: nothing is announced, the wait stays open, and a SIGTERM ends it
// with its FIFO gone from the directory, which is still there.
test('a run awaiting a file its writer fails to write does not settle, and ended by SIGTERM leaves no FIFO beside itself', { ...SETTLES_WITHIN }, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  tracing(t, agent, gate);
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await traced(t, 'the waiter says read false', () => waiter.said('read false'));
  traced(t, 'chmod 0555 of the stand-in\'s directory', () => chmodSync(agent.dir, 0o555));
  t.after(hooked(t, 'the hook giving the stand-in\'s directory back its permission', () => traced(t, 'chmod 0755 of the stand-in\'s directory', () => chmodSync(agent.dir, 0o755))));
  const writer = started(t, agent, 'reviewer');
  const failed = await traced(t, 'the writer\'s exit', () => writer.exited);
  traced(t, 'chmod 0755 of the stand-in\'s directory', () => chmodSync(agent.dir, 0o755));
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EACCES/);
  assert.equal(agent.wrote(CARD, 'reviewer'), false);
  await traced(t, 'the gate\'s open', () => open());
  await traced(t, 'the waiter returns from its gate', () => waiter.said('gate returned'));
  // The wait still holds its FIFO open, so it has not settled: a settled wait closes it first.
  const probe = traced(t, 'the probe', () => openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK));
  closeSync(probe);
  traced(t, 'SIGTERM to the waiter', () => waiter.child.kill('SIGTERM'));

  const ended = await traced(t, 'the waiter\'s exit', () => waiter.exited);
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
  tracing(t, agent, gate);
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
test('a writer that fails to announce a file after the wait\'s first read found it missing fails saying why, and the wait does not settle', { ...SETTLES_WITHIN }, async (t) => {
  const agent = awaiting();
  const { gate, open } = gateIn();
  tracing(t, agent, gate);
  const waiter = started(t, agent, 'architect', stopping(`wrote-${CARD}-reviewer`, gate, 'after'));
  await traced(t, 'the waiter says read false', () => waiter.said('read false'));
  const writer = started(t, agent, 'reviewer', refusingFifo());
  const failed = await traced(t, 'the writer\'s exit', () => writer.exited);
  assert.notEqual(failed.code, 0);
  assert.match(failed.err(), /EMFILE/);
  assert.ok(agent.wrote(CARD, 'reviewer'));
  await traced(t, 'the gate\'s open', () => open());
  await traced(t, 'the waiter returns from its gate', () => waiter.said('gate returned'));
  // The wait still holds its FIFO open, so it has not settled: a settled wait closes it first.
  closeSync(traced(t, 'the probe', () => openSync(join(agent.dir, FIFO), constants.O_WRONLY | constants.O_NONBLOCK)));
  traced(t, 'SIGTERM to the waiter', () => waiter.child.kill('SIGTERM'));

  const ended = await traced(t, 'the waiter\'s exit', () => waiter.exited);
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
