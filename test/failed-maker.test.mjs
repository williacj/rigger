// ABOUTME: Proves failed-maker memory through real L1/L2/L3 wiring over an in-memory forge,
// injected clock and scripted process host, without starting an agent or reading the host process table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rmdirSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { admission } from '../src/scheduling/admission.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { repositoryAt, worktreeList } from './git-repository.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { readyCard, handleOn, positive } from './loop-world.mjs';
import { postedNote } from './escalation-world.mjs';

/** Node's ChildProcess event/pipe contract and ps's documented columns, with no native process. */
function processHost(clock, processesGit, startFailure) {
  const children = new Map();
  const attempted = [];
  let serial = 900_000_000;
  let closing = false;
  const absent = () => Object.assign(new Error('scripted process absent'), { code: 'ESRCH' });
  const finish = (pid, code = 7, signal = null) => {
    const child = children.get(pid);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
    child.stdout.end();
    child.stderr.end();
  };
  const listing = (tool, args) => {
    if (tool === '/scripted/lsof') return '';
    const format = args[args.indexOf('-o') + 1];
    if (format === 'lstart=') return 'Sun Nov  1 21:00:00 2026\n';
    const target = args[args.indexOf(args.includes('-g') ? '-g' : '-p') + 1];
    const selected = [...children].filter(([pid, child]) => target.split(',').includes(String(pid)) && child.exitCode === null && child.signalCode === null);
    return selected.map(([pid, child]) => format.split(',').map((column) => ({
      'pid=': pid, 'stat=': child.stopped ? 'T' : 'S', 'ucomm=': 'scripted-agent',
      'command=': 'scripted-agent', 'lstart=': 'Sun Nov  1 21:00:00 2026',
    })[column]).join(' ')).join('\n');
  };
  return {
    children, attempted, finish,
    close() { closing = true; for (const pid of children.keys()) finish(pid); },
    open() { closing = false; },
    host: {
      ...realHost, clock: { ...clock, pause: async () => {} }, ps: '/scripted/ps', lsof: '/scripted/lsof',
      spawn(command, args, options) {
        attempted.push({ command, cwd: options.cwd });
        if (command !== 'git' && startFailure) throw Object.assign(new Error('scripted executable missing'), { code: 'ENOENT' });
        const child = new EventEmitter();
        Object.assign(child, { pid: ++serial, exitCode: null, signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), cwd: options.cwd });
        children.set(child.pid, child);
        if (command === 'git') {
          // This is git's real porcelain response, measured before the host is substituted.
          assert.deepEqual(args, ['worktree', 'list', '--porcelain', '-z']);
          queueMicrotask(() => { child.stdout.write(processesGit); finish(child.pid, 0); });
        } else if (closing) queueMicrotask(() => finish(child.pid));
        return child;
      },
      spawnSync: (tool, args) => ({ status: 0, stdout: listing(tool, args), stderr: '' }),
      execFile(tool, args, options, done) {
        queueMicrotask(() => done(null, listing(tool, args), ''));
        return { stdout: { destroy() {} }, stderr: { destroy() {} } };
      },
      killChild() { throw new Error('a scripted ps read never needs ending'); },
      signal(target, signal) {
        const child = children.get(Math.abs(target));
        if (!child || child.exitCode !== null || child.signalCode !== null) throw absent();
        if (signal === 'SIGSTOP') child.stopped = true;
        if (signal === 'SIGCONT') child.stopped = false;
        if (signal === 'SIGKILL') queueMicrotask(() => finish(child.pid, null, signal));
      },
    },
  };
}

/** Public fake-board/repository contracts supply L2; the process host supplies L0's answers. */
function world(t, { cards = [12], clock = manualClock(), afterMaker = () => {}, roles = {}, workspaceFailure, readFailure, startFailure, escalations = false } = {}) {
  const directory = temporaryDirectory('rigger-failed-maker-', { context: t });
  const settings = { ...config, concurrency: 1, roles: { ...config.roles, engineer: { ...config.roles.engineer, provider: 'claude', timeout: 10_000 }, ...roles },
    escalate: escalations ? { ambiguous: 'pm' } : {},
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'] } },
    clock: { poll: 100, triggers: { later: { interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' } } },
  };
  const fake = createFakeBoard({ columns: Object.values(settings.board.columns), items: cards.map((number) => readyCard(number)) });
  const repository = createFakeRepository({ repo: settings.repo, issues: cards.map((number) => ({ number, body: readyCard(number).body, labels: ['type:change'] })) });
  const repositoryPath = repositoryAt(join(directory, 'repository'));
  const processes = processHost(clock, worktreeList(repositoryPath, true), startFailure);
  const originals = new Map(['spawn', 'spawnSync', 'execFile', 'signal', 'killChild', 'clock'].map((key) => [key, Object.getOwnPropertyDescriptor(realHost, key)]));
  for (const key of originals.keys()) Object.defineProperty(realHost, key, { configurable: true, value: processes.host[key] });
  const runs = [];
  t.after(async () => {
    try {
      for (const run of runs) await run.stop().catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
    } finally { for (const [key, descriptor] of originals) Object.defineProperty(realHost, key, descriptor); }
  });
  const rolesById = new Map();
  const sink = { emitter(context) {
    const emitter = openSink({ directory, run: 'r-failed', now: clock.now }).emitter(context);
    return { emit(event, fields) {
      if (context.layer === 'L3' && event === 'dispatch') rolesById.set(context.dispatch, fields.role);
      emitter.emit(event, fields);
      if (context.layer === 'L1' && event === 'dispatch.end' && rolesById.get(context.dispatch) === 'engineer' && fields.exit !== undefined) afterMaker({ repository, fake, card: context.card, dispatch: context.dispatch });
    } };
  } };
  const events = () => existsSync(streamPath(directory)) ? readEvents(directory) : [];
  const makerStarts = (number = 12) => events().filter((event) => event.layer === 'L1' && event.event === 'dispatch.start' && event.card === number && rolesById.get(event.dispatch) === 'engineer');
  const reads = repository.operations;
  let failedRead = false;
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads, repositoryWrites: repository, roleReads: () => reads,
    cardReads: () => {
      if (!readFailure || failedRead) return reads;
      failedRead = true;
      return { ...reads, [readFailure]: async () => { throw new Error(`scripted ${readFailure} unavailable`); } };
    },
  });
  // Notice publication is outside these attempt-classification tests; the documented notice
  // generator may answer no attached issue while the hold's closer still governs admission.
  l2.notice = async function* () { return {}; };
  const settles = [];
  const settled = l2.settled;
  l2.settled = async (...args) => {
    try { const value = await settled(...args); settles.push({ card: args[0].number, value }); return value; }
    catch (error) { settles.push({ card: args[0].number, error }); throw error; }
  };
  const decide = (card, outcomes, options) => nextAction(card, settings.kinds, undefined, { roles: settings.roles, provisioning: {}, sink, outcomes, ...options });
  let workspaceCalls = 0;
  const workspace = async (number) => {
    workspaceCalls += 1;
    if (workspaceFailure) throw workspaceFailure(number);
    const path = join(directory, 'workspaces', `rigger-${number}`);
    mkdirSync(join(path, '.claude', 'agents'), { recursive: true });
    for (const role of ['engineer', 'pm']) writeFileSync(join(path, '.claude', 'agents', `${role}.md`), '# Test role\n');
    return { path, branch: `rigger-${number}`, scratch: join(directory, 'scratch', `rigger-${number}`), repository: repositoryPath };
  };
  const built = loop({ config: settings, board: handleOn(fake), decide, facts: factsCall({ config: settings, reads, decide }), l2, sink,
    kill: async () => {}, workspace, escalationDirectory: async (number, role) => {
      const path = join(directory, 'escalations', `rigger-${number}`, role);
      const main = join(path, 'main');
      mkdirSync(join(main, '.claude', 'agents'), { recursive: true });
      writeFileSync(join(main, '.claude', 'agents', `${role}.md`), '# Escalation role\n');
      return { path, main, scratch: join(directory, 'scratch', `rigger-${number}`), repository: repositoryPath };
    }, judgeDirectory: async () => { throw new Error('no agent judge is configured'); },
    removeDirectories: async () => {}, state: directory, environment: {}, run: 'r-failed', clock, host: processes.host,
  });
  const finish = (number = 12, exit = 7) => {
    const start = makerStarts(number).at(-1);
    assert.ok(start, `card #${number} has a recorded L1 start`);
    const child = [...processes.children.values()].find((child) => child.cwd === start.workspace && child.exitCode === null && child.signalCode === null);
    assert.ok(child, `card #${number} has a scripted child`);
    processes.finish(child.pid, exit);
  };
  const start = () => {
    processes.open();
    const controller = new AbortController();
    const handed = [];
    const running = built.run({ singlePull: true, handOver: (value) => handed.push(value), stop: controller.signal });
    running.catch(() => {});
    const stop = async () => {
      controller.abort();
      processes.close();
      return running;
    };
    const run = { handed, running, stop };
    runs.push(run);
    return run;
  };
  return { start, loop: built, finish, workspaceCalls: () => workspaceCalls, processes, settings, clock, directory, sink, fake, repository, l2, settles, events, makerStarts };
}

/** The observable start has reached a live scripted command, before a test releases or times it. */
const makerReady = (here) => positive(() => here.makerStarts().length > 0 && [...here.processes.children.values()].some((child) => child.cwd.includes('workspaces') && child.exitCode === null && child.signalCode === null));

// F1c: refusing the end must retain both the completed result and the refusal report.
// proves R-LOOP-18
test('F1c: a refused maker end reports its nonzero result without dispatching the maker again', async (t) => {
  for (const cell of ['end', 'timeout', 'L0', 'record', 'record-and-end']) {
    await t.test(cell, async (t) => {
      const here = world(t);
      const emitter = here.sink.emitter.bind(here.sink);
      const partial = join(here.directory, 'groups.json.partial');
      let refused = false;
      here.sink.emitter = (context) => {
        const opened = emitter(context);
        return { emit(event, fields) {
          if (cell.startsWith('record') && context.layer === 'L1' && event === 'dispatch.end') rmdirSync(partial);
          const selected = cell === 'L0' ? context.layer === 'L0' && event === 'timeout.killed'
            : context.layer === 'L1' && event === (cell === 'timeout' ? 'dispatch.timeout' : 'dispatch.end');
          if (cell !== 'record' && !refused && selected) {
            refused = true;
            throw new Error(`scripted sink unavailable at ${event}`);
          }
          opened.emit(event, fields);
        } };
      };
      const run = here.start();
      await makerReady(here);
      if (cell.startsWith('record')) mkdirSync(partial); // A directory cannot be rewritten as the record's partial file.
      if (cell === 'timeout' || cell === 'L0') await here.clock.advance(START + 10_000);
      else here.finish();
      await positive(() => here.makerStarts().length > 1 || run.handed.length > 0);
      assert.equal(here.makerStarts().length, 1, 'a refused end must not redispatch a maker that ran and left the forge empty');
      assert.equal(here.settles[0].value.action, 'set-aside');
      assert.deepEqual(here.repository.held().branches, []);
      assert.deepEqual(here.repository.held().pullRequests, []);
      const reported = run.handed.flatMap(({ settled }) => settled?.value ?? settled?.reason?.reached ?? []);
      assert.equal(reported[0].outcome.status, 'rejected', 'the refusal still reaches the caller');
      const failure = reported[0].outcome.reason;
      assert.equal(failure.code, cell === 'record' ? 'RECORD_REFUSED' : 'EVENT_REFUSED');
      assert.notEqual(failure.result.exit, 0, 'the refused recording retains the completed nonzero result');
      if (cell === 'record') assert.ok(failure.recordFailure);
      else assert.match(failure.message, /scripted sink unavailable at/);
      if (cell === 'record-and-end') assert.equal(failure.cause.code, 'RECORD_REFUSED');
      assert.equal(here.clock.now(), START + (cell === 'timeout' || cell === 'L0' ? 10_000 : 0));
      await run.stop();
    });
  }
});

// F1c's retained result must take the same note-first and forge classification as a fulfilled result.
// proves R-LOOP-18
test('F1c classification: rejected nonzero results retain escalation, forge and failed-read handling', async (t) => {
  for (const cell of ['note', 'branch', 'open', 'merged', 'closed', 'readBranches', 'readPullRequests', 'no-result', 'zero']) {
    await t.test(cell, async (t) => {
      const here = world(t);
      const dispatch = 'd-11111111-2222-3333-4444-555555555555';
      const [card] = await here.fake.operations.readItems();
      const reason = Object.assign(new Error('record refused'), { code: 'EVENT_REFUSED',
        ...(cell === 'no-result' ? {} : { result: { exit: cell === 'zero' ? 0 : 7 } }),
      });
      if (cell === 'note') {
        here.repository.postIssueComment(12, postedNote(dispatch).body.replace('item: 2', 'item: 1'));
        here.repository.operations.readBranches = async () => { throw new Error('an escalation must precede the empty-work branch read'); };
      } else if (cell === 'branch') here.repository.operations.readBranches = async () => ({ 'rigger-12': true });
      else if (['open', 'merged', 'closed'].includes(cell)) here.repository.open({ number: 77, head: 'rigger-12', sha: 'a'.repeat(40), merged: cell === 'merged', closed: cell === 'closed' });
      else if (cell.startsWith('read')) here.repository.operations[cell] = async () => { throw new Error(`scripted ${cell} unavailable`); };
      else here.repository.operations.readIssueComments = async () => { throw new Error('an unstarted or zero-result rejection must not read notes'); };
      const settling = here.l2.settled(card, { status: 'rejected', reason }, { dispatch });
      if (cell.startsWith('read')) await assert.rejects(settling, new RegExp(`card #12.*${cell === 'readBranches' ? 'branch' : 'pull requests'}.*scripted ${cell} unavailable`));
      else {
        const answer = await settling;
        if (cell === 'note') assert.equal(answer?.action, 'escalate', 'a valid note takes precedence over an empty forge');
        else assert.equal(answer, undefined, `${cell}: preserve the ordinary settle handling`);
      }
      assert.deepEqual(here.fake.writes(), [], 'classification alone must not move or escalate the card');
    });
  }
});

// F1: a release that immediately reclaims the failed card must produce a second L1 maker start.
// proves R-LOOP-18
test('F1: a clock-held run dispatches a plain failed maker exactly once across releases and polls', async (t) => {
  const here = world(t);
  const run = here.start();
  await makerReady(here);
  here.finish();
  await positive(() => run.handed.length > 0 || here.makerStarts().length > 1);
  assert.equal(here.makerStarts().length, 1, 'the release must not dispatch the failed maker again');
  assert.equal(here.settles[0].value.action, 'set-aside');
  assert.match(here.settles[0].value.reason, /card #12.*7.*forge.*rigger-12/);
  for (const at of [START + 100, START + 200]) {
    await here.clock.advance(at);
    await positive(() => here.events().filter((event) => event.trigger === 'pull').length >= (at - START) / 100 + 2);
    assert.equal(here.makerStarts().length, 1, 'an idle poll must keep the failed maker set aside');
  }
  await run.stop();
});

// F1a: losing the timeout's nonzero result would let the release start the maker again.
// proves R-LOOP-18
test('F1a: a maker ended by its role timeout is set aside for the clock-held run', async (t) => {
  const here = world(t);
  const run = here.start();
  await makerReady(here);
  await here.clock.advance(START + 10_000);
  await positive(() => run.handed.length > 0 || here.makerStarts().length > 1);
  assert.equal(here.makerStarts().length, 1, 'a timeout must not dispatch the maker again');
  assert.equal(here.events().filter((event) => event.event === 'dispatch.timeout').length, 1, 'L1 observed the role deadline');
  assert.notEqual(here.events().find((event) => event.event === 'dispatch.end' && event.card === 12).exit, 0);
  assert.equal(here.settles[0].value.action, 'set-aside');
  await run.stop();
});

// F2: excluding the card must still release its slot and claim the other Ready card immediately.
// proves R-LOOP-18
test('F2: the failed maker releases its slot to the other Ready card without a clock advance', async (t) => {
  const here = world(t, { cards: [12, 13] });
  const run = here.start();
  await makerReady(here);
  assert.equal((await here.fake.operations.readItems()).find(({ number }) => number === 13).column, 'Ready');
  here.finish();
  await positive(() => here.makerStarts(13).length === 1 || here.makerStarts().length > 1);
  assert.equal(here.makerStarts().length, 1, 'the failed card must have exactly one L1 maker start');
  assert.equal(here.makerStarts(13).length, 1, 'the release must claim the other Ready card');
  await positive(() => [...here.processes.children.values()].some((child) => child.cwd.endsWith('rigger-13') && child.exitCode === null));
  here.finish(13);
  await positive(() => run.handed.length > 0);
  assert.equal(here.clock.now(), START, 'the slot refilled without a poll or clock advance');
  assert.deepEqual(here.events().filter((event) => event.event === 'pull').map(({ card }) => card), [12, 13]);
  await run.stop();
});

// F3 is an invariant guard: the memory must be allocated per invocation, even on one loop handle.
// proves R-LOOP-18
test('F3: a second run on the same board forgets the failed-maker exclusion', async (t) => {
  const here = world(t);
  const first = here.start();
  await makerReady(here);
  here.finish();
  await positive(() => first.handed.length > 0 || here.makerStarts().length > 1);
  await first.stop();
  const before = here.makerStarts().length;
  const second = here.start();
  await positive(() => here.makerStarts().length > before || second.handed.length > 0);
  assert.equal(here.makerStarts().length, before + 1, 'the later invocation must dispatch its maker afresh');
  await second.stop();
});

// F4 is an invariant guard: pushed work keeps the release pull's ordinary forge decisions.
// proves R-WORK-19
test('F4: a failed maker with a branch or pull request keeps the merge-base release action', async (t) => {
  for (const cell of ['branch', 'open', 'open-no-branch', 'merged', 'merged-no-branch', 'closed', 'closed-no-branch']) {
    await t.test(cell, async (t) => {
      const here = world(t, { afterMaker: ({ repository }) => {
        if (cell === 'branch') repository.operations.readBranches = async (names) => Object.fromEntries(names.map((name) => [name, name === 'rigger-12']));
        else repository.open({ number: 77, head: 'rigger-12', sha: 'a'.repeat(40), merged: cell.startsWith('merged'), closed: cell.startsWith('closed') });
        if (cell.endsWith('no-branch')) repository.operations.readBranches = async (names) => Object.fromEntries(names.map((name) => [name, false]));
      } });
      const run = here.start();
      await makerReady(here);
      here.finish();
      await positive(() => run.handed.length > 0 || here.makerStarts().length > 1);
      assert.equal(here.settles[0].value, undefined, `${cell}: L2 must leave the ordinary release action intact`);
      assert.equal(here.makerStarts().length, cell === 'closed-no-branch' ? 2 : 1);
      const [card] = await here.fake.operations.readItems();
      assert.equal(card.column, (cell.startsWith('open') || cell === 'closed-no-branch') ? 'Coding' : 'Owner', `${cell}: the release pull must retain the merge-base column`);
      if ((cell.startsWith('open') || cell === 'closed-no-branch')) assert.equal(here.events().filter((event) => event.event === 'review.escalate').length, 0);
      else assert.equal(here.events().filter((event) => event.event === 'review.escalate').length, 1);
      await run.stop();
    });
  }
});

// F5 is an invariant guard: a zero exit with delivered work still reaches review and Owner.
// proves R-WORK-18
test('F5: a successful maker still moves its open pull to Review and then Owner', async (t) => {
  const here = world(t, { afterMaker: ({ repository }) => repository.open({ number: 77, head: 'rigger-12', sha: 'a'.repeat(40) }) });
  const run = here.start();
  await makerReady(here);
  here.finish(12, 0);
  await positive(() => run.handed.length > 0);
  assert.deepEqual(here.fake.writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args[1]), ['Coding', 'Review', 'Owner']);
  assert.equal(here.settles[0].value.open[0].number, 77);
  assert.equal(here.makerStarts().length, 1);
  await run.stop();
});

// F8 is an invariant guard: pull(1), the entry once uses, never arms a clock or refills a slot.
// proves R-SCHED-35
test('F8: once still makes one pull and dispatches no second card after a failed maker', async (t) => {
  const here = world(t, { cards: [12, 13] });
  const pulled = here.loop.pull(1);
  await makerReady(here);
  here.finish();
  const [result] = await pulled;
  assert.equal(result.card, 12);
  assert.equal(here.makerStarts().length, 1);
  assert.equal(here.makerStarts(13).length, 0);
  assert.equal((await here.fake.operations.readItems())[1].column, 'Ready');
  assert.equal(here.events().filter((event) => event.trigger === 'pull').length, 1);
  assert.deepEqual(here.events().filter((event) => event.event === 'trigger.armed' || event.trigger === 'clock'), []);
  assert.equal(here.clock.pending(), 0);
});

// F4b: a failed classification read must be named and must not suppress the release pull.
// proves R-LOOP-18
test('F4b: a failed branch or pull-request read rejects the settle and leaves the card retryable', async (t) => {
  for (const readFailure of ['readBranches', 'readPullRequests']) {
    await t.test(readFailure, async (t) => {
      const here = world(t, { readFailure });
      const run = here.start();
      await makerReady(here);
      here.finish();
      await positive(() => here.makerStarts().length > 1 || run.handed.length > 0);
      assert.ok(here.settles[0].error, 'the failed read must reject the settle');
      assert.match(here.settles[0].error.message, /card #12/);
      assert.match(here.settles[0].error.message, new RegExp(readFailure === 'readBranches' ? 'branch' : 'pull requests'));
      assert.match(here.settles[0].error.message, new RegExp(`scripted ${readFailure} unavailable`));
      assert.equal(here.makerStarts().length, 2, 'the release pull must read and claim the card again');
      await makerReady(here);
      here.finish();
      await positive(() => run.handed.length > 0 || here.makerStarts().length > 2);
      assert.equal(here.makerStarts().length, 2, 'after the read recovers the failed maker stays set aside');
      assert.equal(here.settles[1].value.action, 'set-aside');
      await run.stop();
    });
  }
});

// F6 is an invariant guard: neither an unmade workspace nor an unstarted command is work failure.
// proves R-FAIL-1, R-FAIL-8
test('F6: failures before the maker command retry once and hold on the same environment cause', async (t) => {
  for (const cell of ['workspace', 'command']) {
    await t.test(cell, async (t) => {
      const here = world(t, cell === 'workspace' ? { workspaceFailure: () => Object.assign(new Error('scripted workspace unreadable'), { code: 'WORKSPACE_NOT_MADE', path: '/scripted/workspace' }) } : { startFailure: true });
      const run = here.start();
      await positive(() => run.handed.length > 0);
      assert.equal(here.workspaceCalls(), 2, 'an environment failure gets exactly two attempts');
      assert.equal(admission({ directory: here.directory, sink: here.sink }).read().state, 'closed', 'the same environment cause closes admission');
      assert.equal(here.settles.some(({ value }) => value?.action === 'set-aside'), false);
      assert.equal([...here.processes.children.values()].filter(({ cwd }) => cwd.includes('workspaces')).length, 0, 'no maker command actually started');
      if (cell === 'command') assert.equal(here.events().filter((event) => event.event === 'maker.failed' && event.class === 'environment').length, 2);
      await run.stop();
    });
  }
});

// F7 is an invariant guard: the handled escalation stays under one claim and is not a plain failure.
// proves R-LOOP-18
test('F7: a role-handled maker escalation still waits for another invocation', async (t) => {
  const here = world(t, { escalations: true, afterMaker: ({ repository, card, dispatch }) => {
    repository.postIssueComment(card, postedNote(dispatch).body.replace('item: 2', 'item: 1'));
  } });
  const run = here.start();
  await makerReady(here);
  here.finish();
  await positive(() => [...here.processes.children.values()].some((child) => child.cwd.includes('escalations') && child.exitCode === null));
  const role = [...here.processes.children.values()].find((child) => child.cwd.includes('escalations') && child.exitCode === null);
  here.processes.finish(role.pid, 0);
  await positive(() => run.handed.length > 0 || here.makerStarts().length > 1);
  assert.equal(here.makerStarts().length, 1, 'a role-handled failure must not start the maker again');
  assert.equal(here.settles[0].value.action, 'escalate');
  assert.equal(here.events().filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'pm').length, 1);
  assert.equal(here.events().filter((event) => event.event === 'pull').length, 1);
  assert.equal(here.events().filter((event) => event.event === 'slot.release').length, 1);
  assert.deepEqual(here.repository.held().branches, []);
  assert.deepEqual(here.repository.held().pullRequests, []);
  assert.equal((await here.fake.operations.readItems())[0].column, 'Coding');
  await run.stop();
});
