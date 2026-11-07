// ABOUTME: Runs card-shaped clock firings over one persistent record, a controllable clock and
// the in-memory forge, with real L2 decisions and transitions.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { realHost } from '../src/substrate/host.mjs';
import { acceptanceDigest, composeMarker } from '../src/workflow/marker.mjs';
import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { forge } from './notice-forge.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { seed, removeClosers } from './admission-world.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { keptUp } from './kept-up-run.mjs';
import { makingWorkspaces, makingJudgeDirectories } from './loop-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

export { START };
export const at = (instant) => new Date(instant).toISOString();
export const TEMPLATE = { title: 'Audit widgets', labels: ['type:change'], acceptance: '- The widget turns blue when pressed.\n' };
export const cardTrigger = (fields = {}) => ({ interval: 1000, anchor: at(START), catchUp: 'skip', card: TEMPLATE, ...fields });
const measuredNow = performance.now.bind(performance);

/** A condition wait bounded by the test's own clock, independent of the clock injected into Rigger. */
export async function until(condition) {
  const began = measuredNow();
  while (!condition()) {
    if (measuredNow() - began > 5000) throw new Error(`condition did not hold: ${condition}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The read-side issue shape and write-side number answers are notice-forge's documented contract. */
export function firingWorld({ clock = manualClock(), triggers = { hourly: cardTrigger() }, record, issues = [], pulls = [], items = [], permissions = {}, admitted = false, hold = [], context, afterEmit = () => {} } = {}) {
  if (context) context.mock.method(performance, 'now', clock.now);
  const directory = temporaryDirectory('rigger-clock-firing-');
  if (record !== undefined) {
    mkdirSync(dirname(streamPath(directory)), { recursive: true });
    writeFileSync(streamPath(directory), record);
  }
  if (!admitted) seed(directory, 'owner-a1.json');
  const refuse = {};
  const fake = forge({ issues, pulls, items, permissions, refuse });
  const repository = createFakeRepository();
  const reads = { ...repository.operations, ...fake.reads };
  const writes = {
    ...fake.writes,
    // openIssue's contract takes every label as a separate argument.
    openIssue: async (title, body, ...labels) => {
      const number = await fake.writes.openIssue(title, body, labels[0]);
      fake.issues.find((issue) => issue.number === number).labels = [...labels];
      return number;
    },
    mergePullRequest: repository.mergePullRequest,
    postComment: repository.postComment,
  };
  const settings = { ...config, board: { ...config.board, priority: undefined }, concurrency: 1,
    roles: Object.fromEntries(Object.entries(config.roles).map(([name, role]) => [name, { ...role, provider: 'claude' }])),
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect'] } } };
  if (triggers === null) delete settings.clock;
  else settings.clock = { poll: 1000, triggers };
  const board = {
    ...fake.board,
    readItems: async () => (await fake.board.readItems()).map((item) => ({
      ...fake.issues.find((issue) => issue.number === item.number), ...item, type: 'issue', repository: settings.repo,
    })),
    readColumns: async () => ({ ...settings.board.columns }),
    readPriority: async () => ({ items: (await board.readItems()).map((item) => ({ ...item, priority: null })), declared: null, options: null }),
  };
  const clockBoard = { ...board };
  let refusal = () => false;
  let sequence = 0;
  const scratch = temporaryDirectory('rigger-clock-dispatch-');
  mkdirSync(join(scratch, 'cli', 'projects'), { recursive: true });
  const workspace = makingWorkspaces(scratch);
  const judges = makingJudgeDirectories(scratch);
  const withAgents = (path) => {
    mkdirSync(join(path, '.claude'), { recursive: true });
    cpSync(new URL('../.claude/agents', import.meta.url), join(path, '.claude', 'agents'), { recursive: true });
  };
  const agents = [];
  const held = new Map();
  let ending = false;
  // ChildProcess's event/byte contract is the controlled command in process-host.test.mjs.
  // Agent effects model judge-world.mjs's independent fake agent: opening a PR, then posting markers.
  const host = { ...realHost, ps: '/controlled/ps', lsof: '/controlled/lsof',
    clock: { ...clock, pause: async () => {} },
    signal: () => { throw Object.assign(new Error('controlled process is gone'), { code: 'ESRCH' }); },
    spawnSync: () => ({ status: 0, stdout: 'Thu Oct 29 12:00:00 2026\n', stderr: '' }),
    execFile: (_command, _args, _options, done) => {
      queueMicrotask(() => done(Object.assign(new Error('no process listed'), { code: 1 }), '', ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    spawn: (command, args, options) => {
      if (command !== 'claude') throw new Error(`unexpected controlled command ${command}`);
      const role = basename(args[args.indexOf('--append-system-prompt-file') + 1], '.md');
      const number = Number(/\/rigger-(\d+)(?:\/|$)/.exec(options.cwd)[1]);
      agents.push({ number, role });
      const child = Object.assign(new EventEmitter(), { pid: 900000000 + agents.length, exitCode: null, signalCode: null,
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: new EventEmitter() });
      const finish = () => {
        if (role === 'engineer') {
          repository.open({ number: 1000 + number, head: `rigger-${number}`, sha: '4'.repeat(40), mergeBase: '5'.repeat(40),
            diff: 'diff --git a/src/widget.mjs b/src/widget.mjs\n+export const blue = true;\n', mergeable: 'mergeable' });
          pulls.push(1000 + number);
        } else {
          const issue = fake.issues.find((issue) => issue.number === number);
          repository.comment(1000 + number, composeMarker({ card: number, pull: 1000 + number, head: '4'.repeat(40),
            digest: acceptanceDigest(issue.body), role, provider: 'claude', verdict: 'sound', items: ['met'], coverage: 'covered' }, 'Sound'), at(clock.now()));
        }
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.stdout.end();
        child.stderr.end();
      };
      child.stdin.end = () => queueMicrotask(() => {
        if (role === 'engineer' && hold.includes(number) && !ending) held.set(number, finish);
        else finish();
      });
      return child;
    },
  };
  if (context) {
    // Scratch checks run real git through L0's default host. Git still owns its answers; its
    // deadlines and the empty group after its natural exit use the same controlled clock/host.
    const formerClock = realHost.clock;
    const formerSignal = realHost.signal;
    realHost.clock = host.clock;
    realHost.signal = host.signal;
    context.after(() => { realHost.clock = formerClock; realHost.signal = formerSignal; });
  }
  const events = () => existsSync(streamPath(directory)) ? readEvents(directory) : [];
  const build = () => {
    const run = `r-clock-${++sequence}`;
    const real = openSink({ directory, run, now: clock.now });
    const sink = { emitter: (context) => {
      const emitter = real.emitter(context);
      return { emit(event, fields = {}) {
        if (refusal({ ...context, event, ...fields })) throw new Error(`the sink refuses ${event}`);
        const answer = emitter.emit(event, fields);
        afterEmit({ ...context, event, ...fields });
        return answer;
      } };
    } };
    const decide = (card, outcomes, options = {}) => nextAction(card, settings.kinds, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
    const l2 = columnChanges({ config: settings, sink, reads, repositoryWrites: writes, items: fake.items, board: clockBoard });
    const readRecord = Object.assign(events, { stream: streamPath(directory) });
    return loop({ config: settings, board, decide, facts: factsCall({ config: settings, reads, decide }), l2, sink,
      state: directory, readRecord, run, clock, host, environment: { ...process.env, CLAUDE_CONFIG_DIR: join(scratch, 'cli') }, kill: async () => {},
      workspace: async (number) => { const made = await workspace(number); withAgents(made.path); return made; },
      workspaceTip: async () => '4'.repeat(40),
      judgeDirectory: async (...args) => { const made = await judges(...args); withAgents(made.main); return made; },
      removeDirectories: async () => {},
    });
  };
  return { clock, directory, clockBoard, fake, repository, reads, writes, settings, refuse, events, agents, held,
    accept: () => { refusal = () => false; },
    refuseEvents: (when) => { refusal = when; },
    reopen: () => removeClosers(directory),
    start: async ({ signal } = {}) => {
      const built = build();
      const running = keptUp({ loop: { run: (options) => built.run({ ...options,
        ...(signal && { stop: AbortSignal.any([options.stop, signal]) }) }) } });
      let ended = false;
      running.running.then(() => { ended = true; }, () => { ended = true; });
      const stop = running.stop;
      running.stop = () => {
        ending = true;
        const stopped = stop();
        for (const finish of held.values()) finish();
        held.clear();
        return stopped;
      };
      await until(() => ended || agents.length > 0 || running.handed.some(({ settled }) => settled !== undefined));
      return running;
    },
  };
}

export const firings = (world) => world.events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'clock');
export const outcomes = (world) => world.events().filter(({ event }) => event === 'trigger.outcome');
