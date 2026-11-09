// ABOUTME: Runs optional-config consumers over real git, the existing fake forge and logical agents.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { realHost } from '../src/substrate/host.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { pushAtReturn } from '../src/observation/push.mjs';
import { validate } from '../src/config/validate.mjs';
import { once } from '../src/cli/once.mjs';
import { run } from '../src/cli/run.mjs';
import { manualClock } from './clock-report-world.mjs';
import { forgeStore, logicalAgent } from './in-process-fixtures.mjs';
import { seedRepositoryAt } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card } from './verb-consumer.mjs';
import { absentConfig, minimalConfig } from './optional-config.mjs';

/** A condition wait uses event-loop turns, never elapsed time or a positive timer. */
export async function optionalUntil(condition) {
  while (!condition()) await new Promise((done) => setImmediate(done));
}

const gone = () => { throw Object.assign(new Error('controlled group is absent'), { code: 'ESRCH' }); };

/**
 * Fake agent effects reuse the same logicalAgent contract as the executable stand-in.
 * EventEmitter/PassThrough supply ChildProcess's contract (process-host.test.mjs).
 * The host's absence answers model clock-firing-world.mjs; they claim no OS proof.
 */
export function optionalWorld(t, key, {
  settings = key === 'minimal' ? minimalConfig() : absentConfig(key),
  items = [card(10, 'Ready', { labels: ['type:change', 'area:probe'] })],
  plan = Object.fromEntries(items.map(({ number }) => [number, { engineer: { pr: true }, reviewer: { findings: true } }])),
  stepExit = 0, beforeAgent = async () => {}, clock = manualClock(),
} = {}) {
  assert.deepEqual(validate(settings), [], key + ': the verb receives an admitted config');
  const directory = realpathSync.native(temporaryDirectory('rigger-optional-config-'));
  const consumer = repositoryAt(join(directory, 'consumer'), {
    'rigger.config.mjs': 'export default ' + JSON.stringify(settings) + ';\n',
    '.gitignore': '.rigger/\n',
    '.claude/agents/engineer.md': '# Engineer\nMake the widget blue.\n',
    '.claude/agents/reviewer.md': '# Reviewer\nCheck the widget.\n',
    'build/.keep': '',
  });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const statePath = join(directory, 'board.json');
  // installFakeGh's explicit disk-state contract, without installing an executable gh.
  writeFileSync(statePath, JSON.stringify({
    repo: REPO, owner: 'acme', project: PROJECT, origin,
    model: { columns: COLUMNS, fields: FIELDS, items }, writes: [], sent: [],
  }));
  seedRepositoryAt(statePath, {});
  const store = forgeStore(statePath);
  const now = () => new Date(clock.now()).toISOString();
  const agent = logicalAgent(plan, { store, now });
  const starts = [];
  const fixtureErrors = [];
  const pushes = [];
  const written = [];
  const environment = join(directory, 'cli');
  mkdirSync(join(environment, 'projects'), { recursive: true });
  let serial = 0;
  let running;
  let settled = false;
  let answer;
  let failure;
  const controller = new AbortController();
  const host = {
    ...realHost, ps: '/controlled/ps', lsof: '/controlled/lsof',
    clock: { ...clock, pause: async () => {} },
    signal: gone,
    spawnSync: () => ({ status: 0, stdout: 'Thu Oct 29 12:00:00 2026\n', stderr: '' }),
    execFile: (_command, _args, _options, done) => {
      queueMicrotask(() => done(Object.assign(new Error('no process listed'), { code: 1 }), '', ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    spawn(command, args, options) {
      assert.ok(command === 'claude' || command === '/bin/sh', 'unexpected controlled command ' + command);
      const child = Object.assign(new EventEmitter(), {
        pid: 900000000 + ++serial, exitCode: null, signalCode: null,
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: new EventEmitter(),
      });
      const request = { executable: command, command, args, cwd: options.cwd, env: options.env, pid: child.pid };
      const observed = { command, args, cwd: options.cwd, pid: child.pid };
      starts.push(observed);
      const finish = (code) => {
        child.exitCode = code;
        child.emit('exit', code, null);
        child.stdout.end();
        child.stderr.end();
      };
      const act = async (input) => {
        if (command === '/bin/sh') return finish(stepExit);
        request.input = String(input);
        observed.input = request.input;
        await beforeAgent(request, store, now);
        const started = agent.start(request);
        await started.completed;
        for (const output of started.output()) child.stdout.write(output);
        finish(started.exits().at(-1));
      };
      const failed = (error) => {
        fixtureErrors.push(error.message);
        child.stderr.write(error.stack + '\n');
        finish(1);
      };
      if (command === '/bin/sh') queueMicrotask(() => { act().catch(failed); });
      else child.stdin.end = (input) => { act(input).catch(failed); };
      return child;
    },
  };
  const events = () => existsSync(join(consumer, '.rigger', 'events.jsonl')) ? readEvents(join(consumer, '.rigger')) : [];
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const workspaceRoot = resolve(consumer, settings.worktrees?.root ?? '../widgets-worktrees');
  const topic = (number) => (settings.worktrees?.topic ?? 'rigger-{number}').replace('{number}', String(number));
  const ask = (command, args) => {
    assert.equal(command, 'git');
    return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  };
  const push = pushAtReturn({
    now: clock.now, write: (text) => written.push(text),
    side: async (given) => {
      pushes.push(given);
      return { outcome: 'pushed', bytes: given.stream.length, commit: 'f'.repeat(40) };
    },
  });
  const start = (verb = once, { stopAtDrain = false } = {}) => {
    // The verbs use L0's default host for dispatch. Retain real git while substituting
    // the same descriptor seam failed-maker.test.mjs and maker-git.test.mjs exercise.
    const nativeSpawn = realHost.spawn;
    const replacement = { ...host, spawn: (command, args, options) => command === 'git'
      ? nativeSpawn(command, args, options) : host.spawn(command, args, options) };
    const originals = new Map(['spawn', 'spawnSync', 'execFile', 'signal', 'killChild', 'clock']
      .map((key) => [key, Object.getOwnPropertyDescriptor(realHost, key)]));
    const originalEnvironment = process.env.CLAUDE_CONFIG_DIR;
    const date = t.mock.method(Date, 'now', clock.now);
    const duration = t.mock.method(performance, 'now', clock.now);
    for (const key of originals.keys()) Object.defineProperty(realHost, key, { configurable: true, value: replacement[key] });
    process.env.CLAUDE_CONFIG_DIR = environment;
    running = verb({
      target: consumer, ask,
      send: (command, args) => {
        assert.equal(command, 'gh');
        return store.answer(args, { now, cwd: consumer });
      },
      clock: host.clock, host, stop: controller.signal, push,
      write: (text) => {
        written.push(text);
        if (stopAtDrain && events().some(({ event, trigger }) => event === 'trigger' && trigger === 'drain')) controller.abort();
      },
    }).finally(() => {
      date.mock.restore();
      duration.mock.restore();
      for (const [key, descriptor] of originals) Object.defineProperty(realHost, key, descriptor);
      if (originalEnvironment === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = originalEnvironment;
    });
    running.then((result) => { settled = true; answer = result; }, (error) => { settled = true; failure = error; });
    return running;
  };
  t.after(async () => { controller.abort(); if (running) await running.catch(() => {}); });
  return {
    settings, directory, consumer, origin, statePath, store, agent, starts, fixtureErrors,
    clock, controller, events, state, pushes, written, workspaceRoot, topic,
    start, settled: () => settled, answer: () => answer, failure: () => failure,
    stop: async () => { controller.abort(); return running; },
  };
}

/** The shared successful boundary; individual tests supply their independent outcome oracles. */
export async function optionalOnce(t, key, options) {
  const world = optionalWorld(t, key, options);
  const answer = await world.start();
  assert.deepEqual(world.fixtureErrors, [], 'the logical collaborator completed its documented effects');
  assert.equal(answer.code, 0, answer.text);
  return world;
}

export const optionalRun = run;

/** Pairs dispatch ids rather than assuming that the stream's L1 entries name a role. */
export function optionalDispatches(world, predicate) {
  const events = world.events();
  return events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && predicate(event))
    .map((event) => ({ ...event, start: events.find((held) => held.layer === 'L1' && held.event === 'dispatch.start' && held.dispatch === event.dispatch) }));
}
