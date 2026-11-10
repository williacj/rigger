// ABOUTME: Proves local retention of role CLI bytes through L3, without putting them in the record or judge evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loop } from '../src/scheduling/loop.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { consumerConfig, card } from './verb-consumer.mjs';
import { handleOn } from './loop-world.mjs';
import { gitIn, repositoryAt, worktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock } from './clock-report-world.mjs';
import { postedNote } from './escalation-world.mjs';
import { spawnSync } from 'node:child_process';
import { pushAtReturn } from '../src/observation/push.mjs';
import { withOrigin } from './git-repository.mjs';

const OUT = Buffer.from([79, 85, 84, 0, 255, 13, 10]);
const ERR = Buffer.from([69, 82, 82, 254, 0, 10]);

/** Real L2/forge contracts and a ChildProcess stand-in, as documented by Node and process-host.test.mjs. */
function outputWorld(t, { stdout = OUT, stderr = ERR, exit = 0, fault, route = 'maker', provider = 'claude', timeout = false, step = false } = {}) {
  const base = temporaryDirectory('rigger-kept-output-', { context: t });
  const repository = repositoryAt(join(base, 'consumer'), { 'agent.md': '# Fixture role\n' });
  const workspace = worktreeAt(repository, join(base, 'rigger-42'), 'rigger-42');
  const state = join(repository, '.rigger');
  const clock = manualClock();
  const settings = consumerConfig(1);
  settings.board = { ...settings.board, priority: undefined };
  settings.roles = Object.fromEntries(['engineer', 'reviewer', 'pm'].map((role) => [role, { agent: 'agent.md', provider, tier: 'standard', timeout: 1000 }]));
  settings.kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: route === 'judge' ? ['reviewer'] : ['owner'] } };
  if (step) settings.kinds.change.provisioning = ['prepare'];
  const provisioning = step ? { prepare: { run: 'printf fixture-step', required: true, timeout: 1000 } } : {};
  settings.escalate = route === 'pm' ? { ambiguous: 'pm' } : {};
  const issue = card(42, settings.board.columns.ready);
  const board = createFakeBoard({ columns: Object.values(settings.board.columns), items: [issue] });
  const forge = createFakeRepository({ repo: settings.repo, issues: [{ number: 42, body: issue.body, labels: issue.labels }] });
  const real = openSink({ directory: state, run: 'r-kept-output', now: clock.now });
  const sink = { emitter: (context) => ({ emit(event, fields) {
    if (fault === 'event' && event === 'dispatch.end') throw new Error('the fixture refuses dispatch.end');
    real.emitter(context).emit(event, fields);
    if (fault === 'keep' && event === 'dispatch.start') mkdirSync(join(state, 'output', context.dispatch, 'stderr'), { recursive: true });
  } }) };
  const l2 = columnChanges({ config: settings, sink, items: board.operations, reads: forge.operations, repositoryWrites: forge, roleReads: () => forge.operations });
  l2.notice = async function* () { return {}; };
  const outcomes = [];
  const settled = l2.settled.bind(l2);
  l2.settled = (card, outcome, options) => { outcomes.push(outcome); return settled(card, outcome, options); };
  const decide = (given, outcomes, options = {}) => nextAction(given, settings.kinds, undefined, { roles: settings.roles, provisioning, outcomes, sink, ...options });
  let serial = 900000000;
  const sessions = [];
  const children = new Map();
  const target = route === 'judge' ? 'reviewer' : route === 'pm' ? 'pm' : 'engineer';
  const childFor = (out, err, code, before = () => {}, hold = false) => {
    const child = Object.assign(new EventEmitter(), { pid: ++serial, exitCode: null, signalCode: null,
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    children.set(child.pid, child);
    child.finish = (code, signal = null) => {
      child.exitCode = code;
      child.signalCode = signal;
      child.emit('exit', code, signal);
    };
    queueMicrotask(() => {
      before();
      child.stdout.end(out);
      child.stderr.end(err);
      if (!hold) child.finish(code);
    });
    return child;
  };
  // ps's documented -o columns and ChildProcess signal/exit events model one controlled group.
  const listing = (command, args) => {
    if (command !== realHost.ps) return '';
    const columns = args[args.indexOf('-o') + 1];
    if (columns === 'lstart=') return 'Thu Nov  5 12:00:00 2026\n';
    const selected = args[args.indexOf(args.includes('-g') ? '-g' : '-p') + 1]?.split(',') ?? [];
    return [...children.values()].filter((child) => selected.includes(String(child.pid)) && child.exitCode === null && child.signalCode === null)
      .map((child) => columns.split(',').map((column) => ({ 'pid=': child.pid, 'stat=': child.stopped ? 'T' : 'S',
        'lstart=': 'Thu Nov  5 12:00:00 2026', 'ucomm=': 'stand-in', 'command=': 'stand-in', 'xstat=': 0 })[column]).join(' ')).join('\n');
  };
  const host = {
    ...realHost, clock: { ...clock, pause: async () => {}, schedule(done, delay) {
      const handle = clock.schedule(done, delay);
      if (timeout && delay === 1000) queueMicrotask(() => clock.advance(clock.now() + delay));
      return handle;
    } },
    signal(pid, name) {
      const child = children.get(Math.abs(pid));
      if (!child || child.exitCode !== null || child.signalCode !== null) throw Object.assign(new Error('the completed group is absent'), { code: 'ESRCH' });
      if (name === 'SIGSTOP') child.stopped = true;
      if (name === 'SIGCONT') child.stopped = false;
      if (name === 'SIGKILL') child.finish(null, name);
    },
    // ps -p <pid> -o lstart= is L0's documented start-identity request.
    spawnSync: (command, args) => ({ status: 0, stdout: listing(command, args), stderr: '' }),
    execFile(command, args, _options, done) {
      queueMicrotask(() => done(null, listing(command, args), ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    spawn(command, args, options) {
      if (command === '/bin/sh') return childFor(OUT, ERR, 0);
      assert.equal(command, provider);
      if (fault === 'start') throw Object.assign(new Error('the fixture executable is missing'), { code: 'ENOENT' });
      const role = options.cwd === workspace ? 'engineer' : options.cwd.includes('/reviewer/') ? 'reviewer' : 'pm';
      const session = { role, command, args, input: '' };
      sessions.push(session);
      const child = childFor(stdout, stderr, role === target ? exit : 0, () => {
        if (fault === 'record') mkdirSync(join(state, 'groups.json.partial'));
        if (role === 'engineer' && route === 'judge') forge.open({ number: 77, head: 'rigger-42', sha: 'a'.repeat(40), mergeBase: 'b'.repeat(40), diff: 'diff --git a/widget b/widget\n' });
        if (role === 'engineer' && route === 'pm') {
          const started = readEvents(state).findLast((event) => event.layer === 'L3' && event.event === 'dispatch');
          forge.postIssueComment(42, postedNote(started.dispatch).body.replace('item: 2', 'item: 1'));
        }
      }, timeout && role === target);
      child.stdin.on('data', (chunk) => { session.input += chunk; });
      return child;
    },
  };
  // Scratch checks run real git; their deadlines and empty groups use the same controlled clock.
  const nativeSpawn = realHost.spawn;
  // The unedited codex debug prompt-input capture is the adapter probe's independently observed answer.
  const probe = readFileSync(new URL('./fixtures/codex-prompt-input-0.159.2.json', import.meta.url));
  const replacement = { ...host, spawn: (command, args, options) => command === 'codex'
    ? childFor(probe, Buffer.alloc(0), 0) : nativeSpawn(command, args, options) };
  const original = new Map(['clock', 'signal', 'execFile', 'spawnSync', 'spawn'].map((key) => [key, Object.getOwnPropertyDescriptor(realHost, key)]));
  for (const key of original.keys()) Object.defineProperty(realHost, key, { configurable: true, value: replacement[key] });
  t.mock.method(performance, 'now', clock.now);
  t.after(() => { for (const [key, descriptor] of original) Object.defineProperty(realHost, key, descriptor); });
  const roleDirectory = (role) => {
    const path = join(base, 'roles', role);
    const main = join(path, 'main');
    const head = join(path, 'head');
    mkdirSync(main, { recursive: true });
    mkdirSync(head);
    writeFileSync(join(main, 'agent.md'), '# Fixture role\n');
    return { path, main, head, scratch: join(base, 'scratch', 'rigger-42'), repository };
  };
  const built = loop({ config: settings, board: handleOn(board, { columns: settings.board.columns }), decide,
    facts: factsCall({ config: settings, reads: forge.operations, decide }), l2, sink,
    kill: async () => {}, workspace: async () => ({ path: workspace, branch: 'rigger-42', scratch: join(base, 'scratch', 'rigger-42'), repository }),
    judgeDirectory: async (_number, role) => roleDirectory(role), escalationDirectory: async (_number, role) => roleDirectory(role), removeDirectories: async () => {},
    state, environment: { HOME: base, CLAUDE_CONFIG_DIR: join(base, 'claude-home') }, run: 'r-kept-output', clock, host });
  return { base, state, repository, built, sessions, sink, settings, outcomes, events: () => readEvents(state) };
}

// Decoding as UTF-8 or keeping only stdout loses the independently chosen binary bytes.
// proves R-RECORD-19
test('O1: a completed maker keeps both streams byte for byte under its recorded dispatch id', async (t) => {
  const here = outputWorld(t);
  const [ended] = await here.built.pull();
  assert.equal(ended.outcome.value.exit, 0, 'the maker ran successfully');
  const start = here.events().find((event) => event.layer === 'L1' && event.event === 'dispatch.start');
  assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'the recorded dispatch has no kept stdout');
  assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stdout')), OUT);
  assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stderr')), ERR);
});

// Keeping only successful makers misses failed makers and both other role dispatch routes.
// proves R-RECORD-19
test('O1 O2: judge and escalation role endings and non-zero maker endings keep both streams', async (t) => {
  for (const [route, exit] of [['maker', 7], ['judge', 0], ['judge', 7], ['pm', 0], ['pm', 7]]) {
    await t.test(`${route} exit ${exit}`, async (t) => {
      const here = outputWorld(t, { route, exit });
      await here.built.pull();
      const role = route === 'judge' ? 'reviewer' : route === 'pm' ? 'pm' : 'engineer';
      const dispatch = here.events().find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === role).dispatch;
      assert.equal(here.events().find((event) => event.event === 'dispatch.end' && event.dispatch === dispatch).exit, exit);
      assert.ok(existsSync(join(here.state, 'output', dispatch, 'stdout')), `${role}'s output was not kept`);
      assert.deepEqual(readFileSync(join(here.state, 'output', dispatch, 'stdout')), OUT);
      assert.deepEqual(readFileSync(join(here.state, 'output', dispatch, 'stderr')), ERR);
    });
  }
});

// A provider-specific keep would discard the Codex result despite the identical L1 byte contract.
// proves R-RECORD-19
test('O5: the Codex adapter and a stand-in CLI use the same kept byte streams', async (t) => {
  const here = outputWorld(t, { provider: 'codex' });
  const [ended] = await here.built.pull();
  assert.equal(ended.outcome.status, 'fulfilled', ended.outcome.reason?.message);
  const start = here.events().find((event) => event.event === 'dispatch.start');
  assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'Codex output was not kept');
  assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stdout')), OUT);
  assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stderr')), ERR);
});

// Filtering timed-out results loses the bytes emitted before L0's injected deadline ends the CLI.
// proves R-RECORD-19
test('O3: each role keeps the bytes read before its dispatch timeout', { timeout: 10000 }, async (t) => {
  for (const route of ['maker', 'judge', 'pm']) {
    await t.test(route, async (t) => {
      const here = outputWorld(t, { route, timeout: true });
      const [ended] = await here.built.pull();
      const role = route === 'judge' ? 'reviewer' : route === 'pm' ? 'pm' : 'engineer';
      const dispatch = here.events().find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === role).dispatch;
      assert.ok(here.events().some((event) => event.event === 'dispatch.timeout' && event.dispatch === dispatch), 'the injected deadline ended the target role');
      assert.ok(existsSync(join(here.state, 'output', dispatch, 'stdout')), 'the timed-out dispatch lost its output');
      assert.deepEqual(readFileSync(join(here.state, 'output', dispatch, 'stdout')), OUT);
      assert.deepEqual(readFileSync(join(here.state, 'output', dispatch, 'stderr')), ERR);
    });
  }
});

// Omitting empty buffers would make a silent dispatch indistinguishable from a missing keep.
// proves R-RECORD-19
test('O4: a silent role leaves both empty stream files', async (t) => {
  const here = outputWorld(t, { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
  await here.built.pull();
  const start = here.events().find((event) => event.event === 'dispatch.start');
  for (const stream of ['stdout', 'stderr']) {
    assert.ok(existsSync(join(here.state, 'output', start.dispatch, stream)), `the empty ${stream} file is missing`);
    assert.equal(readFileSync(join(here.state, 'output', start.dispatch, stream)).length, 0);
  }
});

// Keeping every settled attempt would invent files for a CLI that never started.
// proves R-RECORD-19
test('O7: only a started agent has an output directory', async (t) => {
  await t.test('started', async (t) => {
    const here = outputWorld(t);
    await here.built.pull();
    const start = here.events().find((event) => event.event === 'dispatch.start');
    assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'the started control has no kept output');
  });
  await t.test('NOT_STARTED', async (t) => {
    const here = outputWorld(t, { fault: 'start' });
    await Promise.allSettled([here.built.pull()]);
    assert.ok(here.outcomes.length > 0, 'the attempted CLI reached L2');
    for (const outcome of here.outcomes) assert.equal(outcome.reason.code, 'NOT_STARTED');
    for (const event of here.events().filter((event) => event.layer === 'L3' && event.event === 'dispatch')) {
      assert.equal(existsSync(join(here.state, 'output', event.dispatch)), false, 'an unstarted attempt acquired kept output');
    }
  });
});

// Calling the keeper from the step route would retain non-agent provisioning output.
// proves R-RECORD-19
test('O9: provisioning output is excluded while the following agent output is kept', async (t) => {
  const here = outputWorld(t, { step: true });
  await here.built.pull();
  const steps = here.events().filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.step);
  assert.equal(steps.length, 1, 'one provisioning command ran');
  assert.equal(here.events().find((event) => event.event === 'dispatch.end' && event.dispatch === steps[0].dispatch).exit, 0);
  const maker = here.events().find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'engineer');
  assert.ok(existsSync(join(here.state, 'output', maker.dispatch, 'stdout')), 'the following agent output is missing');
  assert.equal(existsSync(join(here.state, 'output', steps[0].dispatch)), false, 'the provisioning command was kept as an agent');
});

// A sink field containing CLI output would leak it into both the local and pushed record.
// proves R-RECORD-19
test('kept marker bytes never enter the event record or the record pushed to origin', async (t) => {
  const marker = 'HERON-1380-private-output';
  const here = outputWorld(t, { stdout: Buffer.from(`${marker}\n`), stderr: Buffer.from(`stderr-${marker}\n`) });
  const origin = join(here.base, 'origin.git');
  withOrigin(here.repository, origin);
  await here.built.pull();
  const start = here.events().find((event) => event.event === 'dispatch.start');
  assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'the marker was not kept locally');
  assert.match(readFileSync(join(here.state, 'output', start.dispatch, 'stdout'), 'utf8'), /HERON-1380-private-output/);
  const local = readFileSync(join(here.state, 'events.jsonl'));
  assert.equal(local.includes(marker), false, 'CLI bytes leaked into the local record');
  const push = pushAtReturn({ now: () => 0, spawn: async ({ command, args, cwd, env, input }) => {
    assert.equal(command, 'git');
    const result = spawnSync(command, args, { cwd, env, input });
    if (result.error) throw result.error;
    return { exit: result.status, timedOut: false, stdout: result.stdout, stderr: result.stderr };
  } });
  await push({ sink: here.sink, run: 'r-kept-output', config: { telemetry: { push: true } }, repository: here.repository, directory: here.state, answer: { code: 0, text: '' } });
  const copied = gitIn(origin, 'cat-file', 'blob', 'refs/rigger/events:events.jsonl');
  assert.equal(copied, local.toString('utf8'), 'the real pushed copy is the original event stream');
  assert.equal(copied.includes(marker), false, 'CLI bytes leaked into the pushed record');
  assert.equal(gitIn(origin, 'ls-tree', '-r', '--name-only', 'refs/rigger/events').trim(), 'events.jsonl');
});

// Adding the maker's retained session to L2's judge evidence would put the marker on judge stdin.
// proves R-RECORD-19
test('a judge receives no marker from the maker output kept on the machine', async (t) => {
  const marker = 'HERON-1380-maker-session';
  const here = outputWorld(t, { route: 'judge', stdout: Buffer.from(marker) });
  await here.built.pull();
  const maker = here.events().find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'engineer');
  assert.ok(existsSync(join(here.state, 'output', maker.dispatch, 'stdout')), 'the maker marker has no retained file');
  assert.equal(readFileSync(join(here.state, 'output', maker.dispatch, 'stdout'), 'utf8'), marker);
  const judge = here.sessions.find((session) => session.role === 'reviewer');
  assert.ok(judge && judge.input.includes('rigger-marker') && judge.input.includes('card: 42'), 'a real L2 judge instruction reached the stand-in');
  assert.equal(judge.input.includes(marker), false, 'the maker session reached the judge');
});

// Writing retained output beside .rigger would add another untracked path to the consumer target.
// proves R-RECORD-19
test('a role dispatch adds no consumer git-status path outside the state directory', async (t) => {
  const here = outputWorld(t);
  const before = gitIn(here.repository, 'status', '--porcelain');
  await here.built.pull();
  const start = here.events().find((event) => event.event === 'dispatch.start');
  assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'output was not kept under the state directory');
  const outside = (status) => status.split('\n').filter(Boolean).map((line) => line.slice(3)).filter((path) => !path.startsWith('.rigger/'));
  assert.deepEqual(outside(gitIn(here.repository, 'status', '--porcelain')), outside(before));
});

// Looking only at fulfilled results drops output when the sink or group record refused the end.
// proves R-RECORD-19
test('O6: a rejected dispatch carrying a result keeps both streams for event and record refusals', async (t) => {
  for (const [fault, code] of [['event', 'EVENT_REFUSED'], ['record', 'RECORD_REFUSED']]) {
    await t.test(code, async (t) => {
      const here = outputWorld(t, { fault });
      const [pulled] = await Promise.allSettled([here.built.pull()]);
      const [ended] = pulled.status === 'fulfilled' ? pulled.value : pulled.reason.reached;
      assert.equal(ended.outcome.reason.code, code, 'the fixture reached the intended refusal');
      assert.deepEqual(ended.outcome.reason.result.stdout, OUT);
      const start = here.events().find((event) => event.event === 'dispatch.start');
      assert.ok(existsSync(join(here.state, 'output', start.dispatch, 'stdout')), 'the rejected dispatch lost its stdout');
      assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stdout')), OUT);
      assert.deepEqual(readFileSync(join(here.state, 'output', start.dispatch, 'stderr')), ERR);
    });
  }
});

// An uncaught file-system error would replace the completed dispatch with a failed pull.
// proves R-RECORD-19
test('O8: a failed keep names its dispatch path and reason without changing the dispatch outcome', async (t) => {
  let working;
  await t.test('working keep', async (t) => {
    const here = outputWorld(t);
    const [ended] = await here.built.pull();
    working = ended.outcome.value;
  });
  await t.test('failed keep', async (t) => {
    const here = outputWorld(t, { fault: 'keep' });
    let ended;
    await assert.doesNotReject(async () => { [ended] = await here.built.pull(); }, 'a failed keep changed the dispatch outcome');
    assert.deepEqual(ended.outcome.value, working);
    const start = here.events().find((event) => event.event === 'dispatch.start');
    const failed = here.events().find((event) => event.event === 'output.failed');
    assert.ok(failed, 'the failed keep has no diagnostic event');
    assert.equal(failed.dispatch, start.dispatch);
    assert.equal(failed.path, join(here.state, 'output', start.dispatch, 'stderr'));
    assert.match(failed.reason, /EISDIR/);
  });
});
