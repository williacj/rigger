// ABOUTME: Shared Codex adapter layouts and executable or controlled stand-ins for its probe and L1 tests.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as codex from '../src/substrate/providers/codex.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { scratch } from './process-fixtures.mjs';
import { standInCodex } from './stub-claude.mjs';
import { repositoryAt } from './git-repository.mjs';
import { manualClock } from './clock-report-world.mjs';
import { logicalCodex } from './in-process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** An emitter that keeps every event it is handed. */
export function keeping() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

/** The declaration a directory holds as its `.codex/config.toml` in these tests, written by hand. */
export const DECLARATION = '# ABOUTME: a test declaration\nsandbox_mode = "workspace-write"\n';

/**
 * A consumer's directory in the test's own scratch directory, holding the declaration and an agent
 * file with frontmatter, a dispatch's scratch directory beside it, and a stand-in owner's Codex
 * home, which `CODEX_HOME` names for the test, so the owner's real one is never read.
 */
export function layout(t, makeScratch = scratch) {
  const root = makeScratch(t);
  const directory = join(root, 'repo');
  const dispatchScratch = join(root, 'scratch', 'engineer');
  const owner = join(root, 'owner-codex');
  for (const each of [join(directory, '.codex'), join(directory, '.claude', 'agents'), dispatchScratch, owner]) mkdirSync(each, { recursive: true });
  writeFileSync(join(directory, '.codex', 'config.toml'), DECLARATION);
  const agent = join(directory, '.claude', 'agents', 'engineer.md');
  writeFileSync(agent, '---\nname: engineer\n---\n# Engineer\n\nThe last sentence of the agent file.\n');
  const inherited = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  process.env.CODEX_HOME = owner;
  t.after(() => {
    process.env.PATH = inherited.PATH;
    if (inherited.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = inherited.CODEX_HOME;
  });
  return { root, directory, scratch: dispatchScratch, owner, agent };
}

/** A stand-in `codex` built from `options`, put first on the `PATH` the adapter's probe reads. */
export function onPath(options) {
  const stand = standInCodex(options);
  process.env.PATH = stand.first();
  return stand;
}

/** Every value following `flag` among `args`. */
export const following = (args, flag) => args.flatMap((arg, at) => (args[at - 1] === flag ? [arg] : []));

/** A role answer as L2 gives one, naming provider `codex`, with `fields` over it. */
export const answerOf = (fields) => ({
  role: 'engineer',
  agent: '.claude/agents/engineer.md',
  provider: 'codex',
  tier: 'standard',
  timeout: 60_000,
  instruction: 'Make the change card #1412 asks for.\n',
  evidence: 'Card #1412: the acceptance.\n',
  ...fields,
});

/**
 * A dispatch's directories in the test's own scratch directory, beside `layout`'s consumer
 * directory: the card's scratch base `scratch/rigger-1412/`, an empty git repository L1 made from,
 * and the state directory `.rigger/` with a sink open on it.
 */
export function dispatchLayout(t, makeLayout = layout) {
  const laid = makeLayout(t);
  const base = join(laid.root, 'scratch', 'rigger-1412');
  mkdirSync(base, { recursive: true });
  const repository = repositoryAt(join(laid.root, 'repository'));
  const state = join(laid.root, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { ...laid, base, repository, state, sink };
}

/** Runs a role's dispatch as L3 does: `roleDispatch`, then L1's `dispatch`, under id `d-codex` and card #1412. */
export async function throughL1({ sink, state, host, ...request }) {
  const handed = await roleDispatch({ sink, id: 'd-codex', card: 1412, ...request });
  return dispatch({ id: 'd-codex', card: 1412, directory: state, sink, ...handed, ...(host === undefined ? {} : { host, clock: host.clock.now }) });
}

/** A native start is an escaped probe, even before the deterministic tier refuses it. */
export function refuseNativeSpawns(t) {
  const original = Object.getOwnPropertyDescriptor(realHost, 'spawn');
  Object.defineProperty(realHost, 'spawn', { configurable: true, value() { throw new Error('the probe escaped the supplied host'); } });
  t.after(() => Object.defineProperty(realHost, 'spawn', original));
}

let serial = 900000000;

/**
 * ChildProcess events/streams follow process-host.test.mjs; logicalCodex shares the executable
 * stand-in's recorded answer contract. The ps columns are L0's documented census inputs.
 */
export function controlledLayout(t) {
  const laid = layout(t, () => realpathSync.native(temporaryDirectory('rigger-codex-', { context: t })));
  const clock = manualClock();
  clock.pause = (delay) => clock.advance(clock.now() + delay);
  const starts = [];
  const reads = [];
  const signals = [];
  let stand;
  let hanging = false;
  let running;
  const absent = () => { throw Object.assign(new Error('controlled process is absent'), { code: 'ESRCH' }); };
  const startTime = 'Thu Oct 29 12:00:00 2026';
  const read = (command, args) => {
    reads.push({ command, args });
    if (command === '/controlled/lsof' || !running?.alive) return { status: 1, stdout: '', stderr: '' };
    if (command !== '/controlled/ps') throw new Error(`unexpected controlled read ${command}`);
    const fields = args.at(-1);
    const columns = {
      'lstart=': startTime,
      'ucomm=': 'codex',
      'pid=,stat=': `${running.child.pid} S`,
      'pid=,stat=,lstart=': `${running.child.pid} S ${startTime}`,
      'pid=,command=': `${running.child.pid} codex ${running.args.join(' ')}`,
    };
    if (!Object.hasOwn(columns, fields)) throw new Error(`unexpected controlled ps columns ${fields}`);
    return { status: 0, stdout: `${columns[fields]}\n`, stderr: '' };
  };
  const host = {
    ...realHost, clock, ps: '/controlled/ps', lsof: '/controlled/lsof', starts, reads, signals,
    spawnSync: read,
    execFile(command, args, _options, done) {
      const answer = read(command, args);
      queueMicrotask(() => done(answer.status === 0 ? null : Object.assign(new Error('no process listed'), { code: answer.status }), answer.stdout, answer.stderr));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    signal(target, name) {
      signals.push([target, name]);
      if (!running?.alive || Math.abs(target) !== running.child.pid) return absent();
      if (name === 'SIGKILL') {
        for (const dispose of running.started?.cleanups?.() ?? []) dispose();
        running.finish(null, name);
      } else if (name !== 0) throw new Error(`unexpected controlled signal ${name}`);
      return true;
    },
    killChild(child, name) { return host.signal(child.pid, name); },
    spawn(command, args, options) {
      if (command !== 'codex' || stand === undefined) throw new Error(`unexpected controlled command ${command}`);
      const child = Object.assign(new EventEmitter(), {
        pid: ++serial, exitCode: null, signalCode: null,
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: new EventEmitter(),
      });
      starts.push({ command, args, cwd: options.cwd, pid: child.pid });
      const call = { child, args, alive: true, finish(code, signal = null) {
        if (!call.alive) return;
        call.alive = false;
        child.exitCode = code;
        child.signalCode = signal;
        child.emit('exit', code, signal);
        child.stdout.end();
        child.stderr.end();
      } };
      running = call;
      const act = async (input) => {
        call.started = stand.start({ args, cwd: options.cwd, home: options.env.CODEX_HOME, pid: child.pid, input: String(input ?? '') });
        const code = await call.started.completed;
        if (!call.alive) return;
        for (const output of call.started.output()) child.stdout.write(output);
        call.finish(code);
      };
      const failed = (failure) => { child.stderr.write(failure.stack); call.finish(1); };
      if (options.stdio[0] === 'ignore') queueMicrotask(() => { act().catch(failed); });
      else child.stdin.end = (input) => { act(input).catch(failed); };
      return child;
    },
  };
  const controlledPath = (options) => {
    stand = logicalCodex(options, { clock });
    hanging = options.hang === true;
    return { ...stand, first: (path = process.env.PATH) => path };
  };
  const adapter = { ...codex, async invocation(request) {
    const observed = stand;
    const before = observed.probes().length;
    const result = codex.invocation({ ...request, host });
    if (hanging) {
      let settled = false;
      result.then(() => { settled = true; }, () => { settled = true; });
      while (!settled && observed.probes().length === before) await new Promise((done) => setImmediate(done));
      if (!settled) await clock.advance(clock.now() + (request.probeTimeout ?? codex.PROBE_TIMEOUT) + 1);
    }
    return result;
  } };
  t.after(() => {
    if (!running?.alive) return;
    for (const dispose of running.started?.cleanups?.() ?? []) dispose();
    running.finish(null, 'SIGKILL');
  });
  return { ...laid, host, clock, codex: adapter, onPath: controlledPath };
}

/** Keep L1's permitted real git, with its default-host deadlines and signals controlled too. */
export function controlledDispatchLayout(t) {
  const laid = dispatchLayout(t, controlledLayout);
  const originals = new Map(['clock', 'signal'].map((key) => [key, Object.getOwnPropertyDescriptor(realHost, key)]));
  for (const key of originals.keys()) Object.defineProperty(realHost, key, { configurable: true, value: laid.host[key] });
  t.after(() => { for (const [key, descriptor] of originals) Object.defineProperty(realHost, key, descriptor); });
  t.mock.method(performance, 'now', laid.clock.now);
  return laid;
}
