// ABOUTME: Controlled proof that a dispatch's process signs refuse later dispatches and stop claims.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { killRecordedGroups } from '../src/execution/run.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { trackerWorld, turn } from './process-fixtures.mjs';
import { manualClock } from './clock-report-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** L1's observable events and an injected L0 host using the documented ps contracts in trackerWorld. */
function signWorld(t) {
  const clock = manualClock(0);
  const world = trackerWorld(clock);
  const events = [];
  const sink = { emitter: (context) => ({ emit: (event, fields) => events.push({ ...context, event, ...fields }) }) };
  const directory = temporaryDirectory('rigger-sign-', { context: t });
  const runs = [];
  const start = (id, options = {}) => {
    const running = dispatch({ id, card: 1479, directory, sink, command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, host: world.host, clock: clock.now, ...options });
    running.catch(() => {});
    runs.push(running);
    return running;
  };
  t.after(async () => { world.inject(() => undefined); world.finish(); await Promise.allSettled(runs); for (const row of world.table.values()) row.state = 'Z'; });
  return { ...world, clock, events, sink, directory, start };
}

// S1's counterexample removes the entry when containment settles despite a refused descendant kill.
// proves R-STATE-30, R-STATE-31, R-STATE-37
test('S1: an unended dispatch process stays named and prevents the next dispatch command', { timeout: 10_000 }, async (t) => {
  const world = signWorld(t);
  world.table.get(world.escaped).refuses = true;
  const running = world.start('d-first');
  await turn(t);
  world.finish(3);
  const result = await running;
  assert.equal(result.exit, 3, 'the survivor does not change the command exit');
  const entry = readGroups(world.directory).find(({ dispatch }) => dispatch === 'd-first');
  assert.ok(entry?.unended?.some(({ pid, name, cmd }) => pid === world.escaped && name === 'controlled' && cmd === `controlled ${world.escaped}`), 'the settled dispatch lost its process sign');
  const [later] = await Promise.allSettled([world.start('d-later')]);
  assert.equal(later.status, 'rejected', 'a later command started beside the sign');
  assert.ok(later.reason.signs.some(({ kind, pid }) => kind === 'unended' && pid === world.escaped));
});

// S3's counterexample drops a settled entry after a reap whose refused kill leaves the same process alive.
// proves R-STATE-31, R-STATE-35
test('S3: a later start retries an unended process and refuses work while it remains', { timeout: 10_000 }, async (t) => {
  const world = signWorld(t);
  world.table.get(world.escaped).refuses = true;
  const running = world.start('d-first');
  await turn(t);
  world.finish(3);
  await running;
  world.signals.length = 0;
  const [restart] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(restart.status, 'rejected', 'the start proceeded while the recorded process remained');
  assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), 'the next start never retried its kill');
  assert.ok(restart.reason.signs.some(({ pid }) => pid === world.escaped));
  assert.ok(readGroups(world.directory)[0].unended.some(({ pid }) => pid === world.escaped));
});

// S21's counterexample reports a read error but never records the run's sign stop.
// proves R-STATE-33
 test('S21: a start with an unreadable record records its sign and reads no board', { timeout: 10_000 }, async (t) => {
  const { loop } = await import('../src/scheduling/loop.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const world = signWorld(t);
  const path = join(world.directory, 'groups.json');
  writeFileSync(path, '{');
  const unexpected = () => assert.fail('work was read or started beside the sign');
  const engine = loop({ config: {}, board: { readColumns: unexpected }, facts: unexpected, decide: unexpected, l2: {}, sink: world.sink,
    kill: () => killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host }), workspace: unexpected, judgeDirectory: unexpected, removeDirectories: unexpected,
    state: world.directory, environment: {}, run: 'r-sign', host: world.host, clock: world.clock });
  const [ran] = await Promise.allSettled([engine.run()]);
  assert.equal(ran.status, 'rejected');
  const stopped = world.events.filter(({ event }) => event === 'sign.stopped');
  assert.equal(stopped.length, 1, 'the run did not record exactly one sign stop');
  assert.ok(stopped[0].signs.some((sign) => sign.kind === 'record' && sign.path === path && /cannot be read/.test(sign.reason)));
  assert.ok(ran.reason.message.includes(path), 'the run did not hand its named sign to the verb');
});

// S13's counterexample notices an unreadable record only after it has claimed the next card.
// proves R-STATE-33, R-STATE-37
 test('S13: a mid-run unreadable record ends run without claiming the next card and names its path', { timeout: 20_000 }, async (t) => {
  const { optionalWorld, optionalRun } = await import('./optional-config-world.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  let path;
  const world = optionalWorld(t, 'minimal', { settings: { ...minimalConfig(), concurrency: 1 }, items: [card(10, 'Ready'), card(11, 'Ready')],
    beforeAgent: async () => { writeFileSync(path, '{'); } });
  path = join(world.consumer, '.rigger', 'groups.json');
  const answer = world.store.answer;
  world.store.answer = (...args) => {
    if (world.events().filter(({ event, layer }) => event === 'pull' && layer === 'L3').length > 1) throw new Error('fixture guard: the refused card was claimed twice');
    return answer(...args);
  };
  const result = await world.start(optionalRun);
  const events = world.events();
  assert.equal(events.filter(({ event }) => event === 'sign.stopped').length, 1, result.text);
  assert.deepEqual(events.filter(({ event, layer }) => event === 'pull' && layer === 'L3').map(({ card }) => card), [10], 'a card was claimed after the record became unreadable');
  assert.ok(result.text.includes(path));
  assert.notEqual(result.code, 0);
});

// S16's counterexample kills the recorded group and removes the unreadable unfinished write.
// proves R-STATE-34, R-STATE-37
 test('S16: an unreadable unfinished write stops a start before any kill or rewrite', { timeout: 10_000 }, async (t) => {
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const record = [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-dead' }];
  writeGroups(world.directory, record);
  const path = join(world.directory, 'groups.json.partial');
  writeFileSync(path, '{');
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(ran.status, 'rejected', 'a start ignored its unreadable unfinished write');
  assert.ok(ran.reason.signs.some((sign) => sign.kind === 'record' && sign.path === path));
  assert.deepEqual(world.signals, [], 'a start killed before it could read both files');
  assert.deepEqual(readGroups(world.directory), record, 'the record changed');
  assert.equal(readFileSync(path, 'utf8'), '{', 'the unfinished write changed');
});

// S15's counterexample reads the unfinished write but drops its extra process when reaping the record.
// proves R-STATE-34, R-STATE-37
 test('S15: a readable unfinished write retains an extra process until it is shown gone', { timeout: 10_000 }, async (t) => {
  const { writeFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  world.table.get(world.escaped).refuses = true;
  writeGroups(world.directory, []);
  const partial = [{ group: world.group, started, dispatch: 'd-dead', settled: true, unended: [{ pid: world.escaped, started, name: 'controlled', cmd: `controlled ${world.escaped}` }] }];
  const path = join(world.directory, 'groups.json.partial');
  writeFileSync(path, JSON.stringify(partial));
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(ran.status, 'rejected', 'the extra process in the unfinished write was ignored');
  assert.ok(readGroups(world.directory)[0]?.unended.some(({ pid }) => pid === world.escaped));
  assert.ok(ran.reason.signs.some(({ kind, path: named }) => kind === 'write' && named === join(world.directory, 'groups.json')));
  assert.equal(existsSync(path), false, 'the successful record rewrite did not consume the unfinished write');
});

// S12's counterexample treats settled containment as permission to forget its unread group.
// proves R-STATE-32
 test('S12: a later start retains an unread group when the next read fails again', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const entry = { group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-unread', settled: true, unread: [{ kind: 'group', group: world.group, reason: 'the census failed' }] };
  writeGroups(world.directory, [entry]);
  world.inject((_tool, args) => args.includes('-g') ? { error: Object.assign(new Error('group read refused again'), { code: 2 }), stdout: '', stderr: 'group read refused again' } : undefined);
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(ran.status, 'rejected', 'the unread group was silently discarded');
  assert.ok(ran.reason.signs.some(({ kind, group, reason }) => kind === 'read' && group === world.group && /census failed/.test(reason)));
  assert.ok(readGroups(world.directory)[0].unread.length > 0);
});

// The S1 loop counterexample preserves the entry but pulls again or dispatches judges beside it.
// proves R-STATE-30, R-STATE-31, R-STATE-37
 test('S1 run: a maker sign ends the run without pulling another card or starting its judges', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const world = await signLoopWorld(t);
  const running = world.start();
  await until(() => world.models.length === 1 || world.completed(), t);
  assert.equal(world.models.length, 1, JSON.stringify(world.events()) + (world.failure()?.errors?.map((error) => error.errors?.map((each) => each.message) ?? error.message).join('\n') ?? ''));
  const model = world.models[0];
  await turn(t);
  world.table.get(model.escaped).refuses = true;
  world.open(10);
  model.finish(0);
  await until(() => world.events().some(({ event }) => event === 'dispatch.end'), t);
  assert.equal(world.events().filter(({ event }) => event === 'dispatch').length, 1, 'a continuation was selected beside the sign');
  const [ran] = await Promise.allSettled([running]);
  assert.equal(ran.status, 'rejected');
  assert.deepEqual(world.events().filter(({ event }) => event === 'pull').map(({ card }) => card), [10]);
  assert.equal(world.models.length, 1, 'a judge or another maker command started');
  assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
});

// Each control establishes the next role that the corresponding sign must prevent.
 test('R1-R4 and R9: a provisioner maker judge or escalation predecessor sign prevents its next role', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { markerComment } = await import('./fake-repository.mjs');
  for (const role of ['provisioner', 'maker', 'judge', 'escalation predecessor']) for (const signed of [false, true]) await t.test(`${role} ${signed ? 'sign' : 'control'}`, async (t) => {
    const settings = minimalConfig();
    if (role === 'provisioner') {
      settings.provisioning = { install: { run: 'controlled install', required: true, timeout: 60_000 } };
      settings.kinds.change.provisioning = ['install'];
    }
    if (role === 'escalation predecessor') {
      settings.roles.manager = { ...settings.roles.engineer, agent: '.claude/agents/manager.md' };
      settings.escalate = { ambiguous: 'manager' };
    }
    const world = await signLoopWorld(t, { settings, numbers: role === 'judge' ? [card(10, 'Review')] : [10] });
    if (role === 'judge') {
      world.open(10);
      const owner = markerComment({ card: 10, pull: 1010, head: world.tip, body: card(10, 'Review').body, role: 'owner' });
      world.repository.comment(1010, owner.body, owner.createdAt);
    }
    const running = world.start();
    await until(() => world.models.length === 1 || world.completed(), t);
    assert.equal(world.models.length, 1, JSON.stringify(world.events()));
    await turn(t);
    const model = world.models[0];
    if (signed) world.table.get(model.escaped).refuses = true;
    if (role === 'maker') world.open(10);
    if (role === 'judge') {
      const veto = markerComment({ card: 10, pull: 1010, head: world.tip, body: card(10, 'Review').body, verdict: 'needs revision', items: ['unmet'], toSound: 'Make the accepted change.' });
      world.repository.comment(1010, veto.body, veto.createdAt);
    }
    if (role === 'escalation predecessor') await world.repository.postIssueComment(10, ['```rigger-escalation', 'category: ambiguous', 'item: 1', 'reason: A controlled decision is missing.', `dispatch: ${model.dispatch.dispatch}`, '```'].join('\n'));
    model.finish(role === 'provisioner' ? 3 : 0);
    await until(() => world.completed() || world.models.length > 1, t);
    if (!signed) {
      assert.equal(world.models.length, 2, `${role}'s control did not select its continuation: ${JSON.stringify(world.events())}`);
      const expected = { provisioner: 'install', maker: 'reviewer', judge: 'engineer', 'escalation predecessor': 'manager' }[role];
      assert.equal(world.models[1].dispatch.role ?? world.models[1].dispatch.step, expected);
      world.models[1].finish(3);
      await running.catch(() => {});
      return;
    }
    assert.equal(world.models.length, 1, 'a continuation command started beside the sign');
    await running.catch(() => {});
    assert.equal(world.events().filter(({ event }) => event === 'dispatch').length, 1, 'a continuation was selected beside the sign');
    assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 2).length, 0, 'a sign spent attempt 2');
    assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
  });
});

// R6/R7's counterexample stops a peer whose command started before the sign, or loses its own exit.
// proves R-STATE-36
 test('R6-R7: a running panel judge or another card maker finishes with its own exit beside a sign', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { card } = await import('./verb-consumer.mjs');
  for (const panel of [false, true]) await t.test(panel ? 'R6 panel' : 'R7 another card', async (t) => {
    const settings = minimalConfig();
    if (panel) {
      settings.roles.architect = { ...settings.roles.reviewer, agent: '.claude/agents/architect.md' };
      settings.kinds.change.judges = ['reviewer', 'architect'];
    }
    const world = await signLoopWorld(t, { settings, concurrency: 2, numbers: panel ? [card(10, 'Review')] : [10, 11, 12] });
    if (panel) world.open(10);
    const running = world.start();
    await until(() => world.models.length === 2 || world.completed(), t);
    assert.equal(world.models.length, 2, JSON.stringify(world.events()));
    await turn(t);
    const [first, peer] = world.models;
    world.table.get(first.escaped).refuses = true;
    first.finish(3);
    await until(() => world.events().some(({ event, dispatch }) => event === 'dispatch.end' && dispatch === first.dispatch.dispatch), t);
    assert.equal(world.completed(), false, 'run ended before its peer command');
    assert.equal(world.events().some(({ event }) => event === 'sign.stopped'), false, 'the stop was recorded before the peer ended');
    assert.equal(world.table.get(peer.escaped).state, 'S', 'the sign stopped or killed the running peer');
    peer.finish(7);
    await running.catch(() => {});
    assert.ok(world.events().some(({ event, dispatch, exit }) => event === 'dispatch.end' && dispatch === peer.dispatch.dispatch && exit === 7));
    assert.equal(world.models.length, 2, 'later work started beside the sign');
    assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
  });
});

// S14a's counterexample loses a failed tracked-set rewrite while its newly observed process is alive.
// proves R-STATE-34
 test('S14a: a failed record write is a sign before the dispatch ends and clears only after a successful gone read', { timeout: 10_000 }, async (t) => {
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { signsStanding } = await import('../src/execution/run.mjs');
  const world = signWorld(t);
  const row = world.table.get(world.escaped);
  world.table.delete(world.escaped);
  const running = world.start('d-tracking');
  await turn(t);
  const partial = join(world.directory, 'groups.json.partial');
  mkdirSync(partial);
  t.after(() => rmSync(partial, { recursive: true, force: true }));
  world.table.set(world.escaped, row);
  await world.clock.advance(1000);
  await turn(t);
  assert.equal(readGroups(world.directory)[0].tracked, undefined, 'the record write did not fail');
  const signs = signsStanding(world.directory, { host: world.host });
  assert.ok(signs.some(({ kind, path, reason }) => kind === 'write' && path === join(world.directory, 'groups.json') && typeof reason === 'string'), 'the failed write was forgotten while its process remained');
  world.table.delete(world.escaped);
  assert.deepEqual(signsStanding(world.directory, { host: world.host }), [], 'a successful read showing the process gone did not clear the failed write');
  rmSync(partial, { recursive: true });
  world.finish();
  await running;
});

// S14c's counterexample loses a tracked process from both the record and memory at a budget-limited exit.
// proves R-STATE-34
 test('S14c: a normal exit past its cleanup budget persists the process a failed write left out', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const world = await signLoopWorld(t, { concurrency: 2 });
  const running = world.start();
  await until(() => world.models.length === 2 || world.completed(), t);
  assert.equal(world.models.length, 2, JSON.stringify(world.events()));
  await turn(t);
  const [first, second] = world.models;
  const omitted = second.escaped + 1;
  world.table.set(omitted, { ...world.table.get(second.escaped), pid: omitted, parent: second.escaped, group: omitted, cmd: `controlled ${omitted}` });
  const partial = join(world.state, 'groups.json.partial');
  mkdirSync(partial);
  await world.clock.advance(1000);
  await turn(t);
  assert.equal(readGroups(world.state).find(({ group }) => group === second.group).tracked?.some(({ pid }) => pid === omitted) ?? false, false, 'the write did not fail');
  rmSync(partial, { recursive: true });
  let spent = false;
  world.inject((_tool, args) => {
    if (!spent && args.includes('-g') && args.includes(String(first.group))) { spent = true; world.clock.advance(20_000); }
    return undefined;
  });
  const cleanup = process.listeners('exit').find(({ name }) => name === 'cleanup');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  const entry = readGroups(world.state).find(({ group }) => group === second.group);
  assert.ok(entry?.unended?.some(({ pid }) => pid === omitted), 'the exit lost the process omitted by the failed write');
  assert.ok(entry.unended.some(({ pid, name, cmd }) => pid === omitted && name === 'controlled' && cmd === `controlled ${omitted}`), 'the exit did not name the omitted process');
  assert.equal(entry.settled, undefined, 'an entry kept past the exit budget was marked settled');
  assert.equal(world.table.get(omitted).state, 'S', 'the omitted process did not outlive exit cleanup');
  world.inject(() => undefined);
  world.table.delete(omitted);
  for (const model of world.models) model.finish(3);
  await running.catch(() => {});
  const next = trackerWorld(world.clock, second.group + 100, world.table);
  const [restart] = await Promise.allSettled([(async () => {
    await killRecordedGroups({ directory: world.state, sink: world.sink, host: world.host });
    const starting = dispatch({ id: 'd-after-budget', card: second.dispatch.card, directory: world.state, sink: world.sink,
      command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, host: next.host, clock: world.clock.now });
    starting.catch(() => {});
    await turn(t);
    next.finish();
    await starting;
  })()]);
  assert.ok(world.events().some(({ event, dispatch, card }) => event === 'dispatch.start' && dispatch === 'd-after-budget' && card === second.dispatch.card), 'the next start did not record dispatch.start for the pulled card after the omitted process exited');
  assert.equal(restart.status, 'fulfilled', 'the next start did not finish its dispatch');
  assert.deepEqual(readGroups(world.state), [], 'the next start did not clear signs shown gone');
});

// R11's write-sign counterexample checks the record but overlooks a process left out in L1's memory.
// proves R-STATE-36
 test('R11 write: the final dispatch check refuses a failed write after recording the dispatch start', { timeout: 10_000 }, async (t) => {
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const world = signWorld(t);
  const row = world.table.get(world.escaped);
  world.table.delete(world.escaped);
  const first = world.start('d-first');
  await turn(t);
  const partial = join(world.directory, 'groups.json.partial');
  mkdirSync(partial);
  world.table.set(world.escaped, row);
  await world.clock.advance(1000);
  await turn(t);
  rmSync(partial, { recursive: true });
  let spawned = false;
  world.host.spawn = () => { spawned = true; throw Object.assign(new Error('controlled spawn refused'), { code: 'EAGAIN' }); };
  const [later] = await Promise.allSettled([world.start('d-claimed')]);
  world.finish();
  await first;
  assert.equal(spawned, false, 'a claimed dispatch spawned beside the failed write');
  assert.ok(world.events.some(({ event, dispatch }) => event === 'dispatch.start' && dispatch === 'd-claimed'), 'the claimed dispatch did not reach its final check after its recorded start');
  assert.ok(later.reason.signs.some(({ kind }) => kind === 'write'));
});

// S12's directory/dispatch cases must actually reread a settled entry's outstanding census.
// proves R-STATE-32
 test('S12 directory and dispatch: settled entries keep a failed later directory census as a sign', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  for (const kind of ['directory', 'dispatch']) await t.test(kind, async (t) => {
    const world = signWorld(t);
    writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-unread', settled: true,
      workspace: world.directory, ...identityOf(world.directory), unread: [{ kind, ...(kind === 'directory' ? { directory: world.directory } : {}), reason: 'earlier read failed' }] }]);
    world.inject((tool) => tool === world.host.lsof ? { error: Object.assign(new Error('directory read refused again'), { code: 2 }), stdout: '', stderr: 'directory read refused again' } : undefined);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected', 'the unread directory or dispatch was silently discarded');
    assert.ok(ran.reason.signs.some(({ kind, directory, reason }) => kind === 'read' && directory === world.directory && /directory read refused/.test(reason)));
  });
});

// S19's counterexample turns a successful census with a surviving process into a cleared read sign.
// proves R-STATE-32, R-STATE-35
 test('S19: a start kills processes found under an unread group or directory and retains that read until none remain', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  const { mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const kind of ['group', 'directory']) await t.test(kind, async (t) => {
    const world = signWorld(t);
    const place = join(world.directory, 'workspace');
    mkdirSync(place);
    const pid = kind === 'group' ? world.group + 1 : world.escaped;
    world.table.get(pid).outlives = true;
    // lsof's documented -F pun contract, also consumed by trackerWorld's empty listing.
    if (kind === 'directory') world.inject((tool, args) => {
      if (tool !== world.host.lsof) return undefined;
      const at = args.indexOf('-p');
      const selected = at < 0 || args[at + 1].split(',').includes(String(pid));
      return { status: selected ? 0 : 1, stdout: selected ? `p${pid}\nu${world.host.uid()}\nn${place}\n` : '', stderr: '' };
    });
    writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-unread', settled: true,
      workspace: place, ...identityOf(place), unread: [{ kind, ...(kind === 'group' ? { group: world.group } : { directory: place }), reason: 'earlier census failed' }] }]);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected');
    assert.ok(world.signals.some(({ target, name }) => name === 'SIGKILL' && target === (kind === 'group' ? -world.group : pid)), 'the start did not retry its kill');
    assert.ok(readGroups(world.directory)[0].unread.some((sign) => sign.kind === kind), 'a census that still found a live process cleared its read sign');
  });
});

// S21's field counterexample acts on a valid prefix before discovering an unreadable sign entry.
// proves R-STATE-33
 test('S21 fields: an unreadable sign shape refuses the whole record before any signal', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  for (const fields of [{ unended: [{ pid: 0, started: 0 }] }, { unended: null }, { unread: {} }, { unread: [{ kind: 'other', reason: 'no such read' }] }, { settled: 'yes' }]) await t.test(JSON.stringify(fields), async (t) => {
    const world = signWorld(t);
    writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-record', ...fields }]);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected', 'an unreadable sign entry was accepted');
    assert.ok(ran.reason.signs?.some(({ kind }) => kind === 'record'), ran.reason.message);
    assert.deepEqual(world.signals, [], 'a process was signalled before the whole record was readable');
  });
});

// S7 must not signal an identity an unreadable table cannot confirm; S8 must admit an unreaped exit.
 test('S7-S8: only a successful table read shows a process gone, and a zombie is gone', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  for (const observation of ['failed read', 'unreadable start', 'zombie', 'absent', 'reused pid']) await t.test(observation, async (t) => {
    const world = signWorld(t);
    for (const row of world.table.values()) row.state = 'Z';
    world.table.get(world.escaped).state = observation === 'zombie' ? 'Z' : 'S';
    writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-ended', settled: true,
      unended: [{ pid: world.escaped, started: Date.UTC(2026, 9, 29, 12) / 1000, name: 'controlled', cmd: `controlled ${world.escaped}` }] }]);
    if (observation === 'absent') world.table.delete(world.escaped);
    if (observation === 'reused pid') world.table.get(world.escaped).started = 'Thu Oct 29 12:00:01 2026';
    if (['failed read', 'unreadable start'].includes(observation)) world.inject((_tool, args) => args.includes('-A') && args.at(-1) === 'pid=,stat=,lstart='
      ? observation === 'failed read' ? { error: Object.assign(new Error('table unavailable'), { code: 2 }), stdout: '', stderr: 'table unavailable' }
        : { status: 0, stdout: `${world.escaped} S no readable start\n`, stderr: '' } : undefined);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.deepEqual(world.signals, [], 'an unconfirmed or exited process was signalled');
    if (['failed read', 'unreadable start'].includes(observation)) {
      assert.equal(ran.status, 'rejected');
      assert.ok(ran.reason.signs.some(({ pid }) => pid === world.escaped));
    } else {
      assert.equal(ran.status, 'fulfilled');
      const next = trackerWorld(world.clock, world.group + 100, world.table);
      const running = world.start('d-after-zombie', { host: next.host });
      await turn(t);
      next.finish();
      await running;
      assert.ok(world.events.some(({ event, dispatch }) => event === 'dispatch.start' && dispatch === 'd-after-zombie'));
    }
  });
});

// A failed identity read proves neither a directory gone nor a replacement at its path.
// proves R-STATE-32
 test('S12 identity: an unread directory stays a sign when its identity cannot be read', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  const world = signWorld(t);
  writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-unread', settled: true,
    workspace: world.directory, ...identityOf(world.directory), unread: [{ kind: 'directory', directory: world.directory, reason: 'earlier census failed' }] }]);
  world.host.stat = () => { throw Object.assign(new Error('identity read refused'), { code: 'EACCES' }); };
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(ran.status, 'rejected', 'an unreadable identity cleared its directory sign');
  assert.ok(ran.reason.signs.some(({ kind, directory }) => kind === 'read' && directory === world.directory));
});

// R5's counterexample waits on a new board read after the sign, delaying the run's end indefinitely.
// proves R-STATE-36
 test('R5: a known sign ends the run without another board read or claim', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  let signed = false;
  const world = await signLoopWorld(t, { observe: ({ event }) => { if (event === 'survivor.unended') signed = true; } });
  const read = world.fake.operations.readColumns;
  let readAfterSign = false;
  world.fake.operations.readColumns = (...args) => {
    if (signed) { readAfterSign = true; throw new Error('controlled board read after the sign'); }
    return read(...args);
  };
  const running = world.start();
  await until(() => world.models.length === 1 || world.completed(), t);
  assert.equal(world.models.length, 1, JSON.stringify(world.events()));
  await turn(t);
  world.table.get(world.models[0].escaped).refuses = true;
  world.models[0].finish(3);
  await running.catch(() => {});
  assert.equal(readAfterSign, false, 'the run read the board after its last command ended beside a known sign');
  assert.deepEqual(world.events().filter(({ event }) => event === 'pull').map(({ card }) => card), [10]);
  assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
});

// S14a must refuse another claim while the omitted process runs; S14b must allow it once gone before take.
// proves R-STATE-34
 test('S14a-S14b: take weighs a failed write before claiming while another dispatch is still running', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const clear of [false, true]) await t.test(clear ? 'S14b gone before take' : 'S14a still alive at take', async (t) => {
    const world = await signLoopWorld(t, { concurrency: 2, numbers: [10, 11, 12] });
    const running = world.start();
    await until(() => world.models.length === 2 || world.completed(), t);
    assert.equal(world.models.length, 2, JSON.stringify(world.events()));
    await turn(t);
    const [first, second] = world.models;
    const omitted = first.escaped + 1;
    const partial = join(world.state, 'groups.json.partial');
    mkdirSync(partial);
    world.table.set(omitted, { ...world.table.get(first.escaped), pid: omitted, parent: first.escaped, group: omitted, cmd: `controlled ${omitted}` });
    await world.clock.advance(1000);
    await turn(t);
    assert.equal(readGroups(world.state).find(({ group }) => group === first.group).tracked?.some(({ pid }) => pid === omitted) ?? false, false);
    rmSync(partial, { recursive: true });
    if (clear) world.table.delete(omitted);
    second.host.spawn().stdout.write('controlled work\n');
    second.finish(7);
    await until(() => world.events().some(({ event, card }) => event === 'slot.release' && card === second.dispatch.card), t);
    await turn(t);
    if (clear) {
      first.host.spawn().stdout.write('controlled work\n');
      first.finish(3);
      await until(() => world.models.length === 3 || world.completed(), t);
      assert.equal(world.models.length, 3, 'a read showing the omitted process gone still stopped later work');
      assert.ok(world.events().some(({ event, dispatch }) => event === 'dispatch.start' && dispatch === world.models[2].dispatch.dispatch), 'the later dispatch start was not recorded');
      world.models[2].host.spawn().stdout.write('controlled work\n');
      world.models[2].finish(3);
    } else {
      assert.deepEqual(world.events().filter(({ event }) => event === 'pull').map(({ card }) => card), [10, 11], 'take claimed beside an omitted live process');
      assert.equal(world.completed(), false, 'the run ended while its first dispatch ran');
    }
    if (!clear) {
      first.host.spawn().stdout.write('controlled work\n');
      first.finish(3);
    }
    await running.catch(() => {});
    const stops = world.events().filter(({ event }) => event === 'sign.stopped');
    if (clear) assert.deepEqual(stops, []);
    else assert.ok(stops[0]?.signs.some(({ kind, path, reason }) => kind === 'write' && path === join(world.state, 'groups.json') && typeof reason === 'string'));
  });
});

// An initial entry write can fail after spawn; its cleanup still owes every unended process a sign.
 test('S14 initial entry: a failed post-spawn write retains its survivor and hands the started command outcome to L2', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld } = await import('./process-fixtures.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const world = await signLoopWorld(t, { numbers: [10] });
  const settling = t.mock.method(world.l2, 'settled');
  const startControlled = world.host.spawn;
  const partial = join(world.state, 'groups.json.partial');
  world.host.spawn = (...args) => {
    const child = startControlled(...args);
    world.table.get(world.models.at(-1).escaped).refuses = true;
    mkdirSync(partial);
    return child;
  };
  await world.start().catch(() => {});
  assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1, 'cleanup lost the survivor of a failed initial entry write');
  assert.equal(settling.mock.callCount(), 1, 'L3 discarded the outcome of a command that actually started');
  assert.equal(settling.mock.calls[0].arguments[1].reason.code, 'EISDIR', 'L2 did not receive the original command outcome');
  world.table.delete(world.models[0].escaped);
  rmSync(partial, { recursive: true });
});

// S20's counterexample loses a write whose every retry failed and which left no temporary file.
// proves R-STATE-37
 test('S20: normal exit names a failed write on standard error when no durable sign can be saved', { timeout: 10_000 }, async (t) => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { join } = await import('node:path');
  const world = signWorld(t);
  const row = world.table.get(world.escaped);
  world.table.delete(world.escaped);
  const running = world.start('d-write-failed');
  await turn(t);
  const partial = join(world.directory, 'groups.json.partial');
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (path, ...args) => {
    if (path === partial) throw Object.assign(new Error('controlled record storage full'), { code: 'ENOSPC' });
    return write(path, ...args);
  });
  let stderr = '';
  const writeSync = fs.writeSync;
  t.mock.method(fs, 'writeSync', (fd, buffer, ...args) => {
    if (fd !== 2) return writeSync(fd, buffer, ...args);
    stderr += buffer.toString();
    return buffer.length;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  row.refuses = true;
  world.table.set(world.escaped, row);
  await world.clock.advance(1000);
  await turn(t);
  const cleanup = process.listeners('exit').find(({ name }) => name === 'cleanup');
  cleanup();
  assert.ok(stderr.includes(join(world.directory, 'groups.json')), 'exit did not name the failed record write');
  assert.ok(stderr.includes('controlled record storage full'), 'exit lost why the write failed');
  assert.equal(fs.existsSync(partial), false, 'an unfinished write survived, so this is not S20');
  assert.equal(world.table.get(world.escaped).state, 'S', 'the process did not outlive exit cleanup');
  world.finish();
  await running;
  t.mock.restoreAll();
  syncBuiltinESMExports();
});

// S9's tracked-set census is a read of the dispatch, not an unnamed filesystem directory.
// proves R-STATE-32
 test('S9 tracked set: a failed descendant identity read leaves a readable dispatch sign', { timeout: 10_000 }, async (t) => {
  const world = signWorld(t);
  const running = world.start('d-tracked-read');
  await turn(t);
  world.inject((_tool, args) => args.at(-1) === 'pid=,lstart=' ? { error: Object.assign(new Error('tracked identity read failed'), { code: 2 }), stdout: '', stderr: 'tracked identity read failed' } : undefined);
  world.finish();
  await running;
  let entries;
  assert.doesNotThrow(() => { entries = readGroups(world.directory); }, 'the tracked-set read was recorded as a directory with no path');
  assert.ok(entries[0]?.unread?.some(({ kind, reason }) => kind === 'dispatch' && /tracked identity read failed/.test(reason)));
});

/** The real plan verb reads this loop's admission and a snapshot served by the existing fake gh. */
async function planAfter(world) {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { forgeStore } = await import('./in-process-fixtures.mjs');
  const { seedRepositoryAt } = await import('./fake-gh.mjs');
  const { plan } = await import('../src/cli/plan.mjs');
  writeFileSync(join(world.consumer, 'rigger.config.mjs'), `export default ${JSON.stringify(world.config)};\n`);
  const statePath = join(world.root, 'plan-board.json');
  const items = (await world.fake.operations.readItems()).map(({ id, ...item }) => item);
  writeFileSync(statePath, JSON.stringify({ repo: world.config.repo, owner: 'acme', project: 3,
    model: { columns: Object.values(world.config.board.columns), fields: [], items }, sent: [], writes: [] }));
  seedRepositoryAt(statePath, world.repository.held());
  const store = forgeStore(statePath);
  return plan({ target: world.consumer, ask: (command, args) => { assert.equal(command, 'git'); return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() }); },
    send: (command, args) => { assert.equal(command, 'gh'); return store.answer(args); } });
}

// R8's counterexample lets a sign between the recorded start and spawn consume attempt two and close admission.
// proves R-STATE-39
 test('R8: a sign after the second attempt start prevents spawn without failure credit or closing plan admission', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld } = await import('./process-fixtures.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  let world;
  let signed = false;
  world = await signLoopWorld(t, { accepted: ({ event, dispatch }) => {
    if (event !== 'dispatch.start') return;
    const owner = world.events().find((entry) => entry.event === 'dispatch' && entry.dispatch === dispatch);
    if (owner?.attempt !== 2) return;
    writeFileSync(join(world.state, 'groups.json'), '{');
    signed = true;
  } });
  let spawns = 0;
  world.host.spawn = () => { spawns += 1; throw Object.assign(new Error('controlled provider CLI missing'), { code: 'ENOENT' }); };
  await world.start().catch(() => {});
  assert.equal(signed, true, 'the second attempt never reached its recorded start');
  assert.equal(spawns, 1, 'the command spawned after the sign arose');
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 1).length, 1, 'the first failure was not established');
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 2).length, 0, 'the refusal spent attempt two');
  const planned = await planAfter(world);
  assert.equal(planned.code, 0, planned.text);
  assert.match(planned.text, /pull\s+#11\b/, 'plan did not read admission open for the next card');
});

// R10's counterexample hands an unstarted judge to L2, pairing it with a real failure already at the same head/digest.
// proves R-STATE-36, R-STATE-39
 test('R10: an unstarted judge adds no failed judge or attempt and cannot escalate a prior failure', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  let world;
  let armed = false;
  world = await signLoopWorld(t, { numbers: [card(10, 'Review')], accepted: ({ event }) => {
    if (armed && event === 'dispatch.start') writeFileSync(join(world.state, 'groups.json'), '{');
  } });
  world.open(10);
  const first = world.start();
  await until(() => world.models.length === 1 || world.completed(), t);
  assert.equal(world.models.length, 1, JSON.stringify(world.events()));
  world.models[0].finish(3);
  await first.catch(() => {});
  assert.equal(world.events().filter(({ event }) => event === 'judge.failed').length, 1, 'the prior failed judge was not established');
  const before = world.events().length;
  const notes = world.repository.held().issues.flatMap(({ comments = [] }) => comments).length;
  armed = true;
  const second = world.start();
  await until(() => world.completed() || world.models.length > 1, t);
  assert.equal(world.models.length, 1, 'the second judge command started');
  await second.catch(() => {});
  const after = world.events().slice(before);
  for (const name of ['judge.failed', 'review.escalate', 'attempt.failed']) assert.equal(after.some(({ event }) => event === name), false, `the unstarted judge recorded ${name}`);
  assert.equal(world.repository.held().issues.flatMap(({ comments = [] }) => comments).length, notes, 'the unstarted judge escalated on the forge');
  assert.equal(after.filter(({ event }) => event === 'sign.stopped').length, 1);
});

// R11 has already claimed work on attempt two when a read or write sign arises before its L1 start.
// proves R-STATE-36, R-STATE-39
 test('R11: a claimed second attempt records its start after a mid-run sign and spends no failure on it', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { addTracked } = await import('../src/execution/groups.mjs');
  const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const kind of ['read', 'write']) await t.test(kind, async (t) => {
    let world;
    let secondMake = 0;
    let releasePeer;
    const peerStarted = new Promise((resolve) => { releasePeer = resolve; });
    let signAt;
    world = await signLoopWorld(t, { numbers: [10, 11], concurrency: 2,
      beforeWorkspace: (number) => number === 10 && ++secondMake === 2 ? peerStarted : undefined,
      observe: ({ event, card, attempt }) => {
        if (event !== 'dispatch' || card !== 10 || attempt !== 2) return;
        if (kind === 'read') writeFileSync(join(world.state, 'groups.json'), '{');
        else {
          const peer = world.models.find(({ dispatch }) => dispatch.card === 11);
          assert.ok(peer, 'the failed write needs a running peer');
          const pid = peer.escaped + 1;
          world.table.set(pid, { ...world.table.get(peer.escaped), pid, parent: peer.escaped, group: pid, cmd: `controlled ${pid}` });
          const partial = join(world.state, 'groups.json.partial');
          mkdirSync(partial);
          assert.throws(() => addTracked(world.state, peer.group, [{ pid, started: Date.UTC(2026, 9, 29, 12) / 1000 }], { host: world.host }));
          rmSync(partial, { recursive: true });
        }
        signAt = world.events().length;
      },
    });
    const startControlled = world.host.spawn;
    let first = true;
    world.host.spawn = (...args) => {
      const start = world.events().filter(({ event }) => event === 'dispatch.start').at(-1);
      if (start.card === 10 && first) { first = false; throw Object.assign(new Error('controlled CLI missing'), { code: 'ENOENT' }); }
      const child = startControlled(...args);
      if (start.card === 11) releasePeer();
      return child;
    };
    const running = world.start();
    await until(() => world.events().some((event) => event.event === 'dispatch.end' && world.events().some((start) => start.event === 'dispatch' && start.dispatch === event.dispatch && start.card === 10 && start.attempt === 2)) || world.completed() || world.models.some(({ dispatch }) => dispatch.card === 10), t);
    assert.equal(world.models.some(({ dispatch }) => dispatch.card === 10), false, 'the refused second attempt started its command');
    for (const model of world.models) { model.host.spawn().stdout.write('controlled work\n'); model.finish(7); }
    await running.catch(() => {});
    assert.equal(typeof signAt, 'number', 'the mid-run sign was not established');
    const start = world.events().find((event) => event.event === 'dispatch' && event.card === 10 && event.attempt === 2);
    assert.ok(world.events().findIndex((event) => event.event === 'dispatch.start' && event.dispatch === start.dispatch) > signAt, 'the claimed dispatch start was not recorded after the sign');
    assert.equal(world.events().filter(({ event, card, attempt }) => event === 'attempt.failed' && card === 10 && attempt === 1).length, 1);
    assert.equal(world.events().some(({ event, card, attempt }) => event === 'attempt.failed' && card === 10 && attempt === 2), false, 'the refused dispatch spent attempt two');
    assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
  });
});

// R12's counterexample extends the dispatch refusal to a claimed action that starts no command.
// proves R-STATE-36
test('R12: claimed board moves, escalation notes and merges reach the forge after a maker sign', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { markerComment } = await import('./fake-repository.mjs');
  for (const action of ['move', 'escalate', 'merge']) await t.test(action, async (t) => {
    const other = card(11, action === 'move' ? 'Review' : 'Owner');
    const world = await signLoopWorld(t, { numbers: [10, other], concurrency: 2 });
    world.open(11);
    if (action === 'move') world.repository.update(1011, { merged: true });
    if (action === 'escalate') world.repository.update(1011, { closed: true });
    if (action === 'merge') {
      world.repository.update(1011, { mergeable: 'mergeable' });
      for (const role of ['reviewer', 'owner']) {
        const marker = markerComment({ card: 11, pull: 1011, head: world.tip, body: other.body, role });
        world.repository.comment(1011, marker.body, marker.createdAt);
      }
    }
    const key = { move: 'moved', escalate: 'escalated', merge: 'merge' }[action];
    const call = world.l2[key];
    let reached = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    t.after(() => release());
    world.l2[key] = async (item, ...rest) => {
      if (item.number === 11) { reached = true; await gate; }
      return call(item, ...rest);
    };
    const running = world.start();
    await until(() => world.models.length === 1 && reached || world.completed(), t);
    assert.equal(reached, true, `the second card was not claimed for ${action}: ${JSON.stringify(world.events())}`);
    const maker = world.models[0];
    world.table.get(maker.escaped).refuses = true;
    maker.finish(3);
    await until(() => world.events().some(({ event }) => event === 'dispatch.end'), t);
    assert.ok(readGroups(world.state)[0].unended.length, 'the maker sign was not established');
    assert.equal(world.completed(), false, 'the claimed action was abandoned');
    release();
    await running.catch(() => {});
    if (action === 'move') assert.equal((await world.fake.operations.readItems()).find(({ number }) => number === 11).column, 'Done', 'the board never received the move');
    if (action === 'escalate') assert.ok(world.repository.held().issues.find(({ number }) => number === 11).comments?.some(({ body }) => /Rigger escalates/.test(body)) ?? false, 'the forge never received the escalation note');
    if (action === 'merge') assert.deepEqual(world.repository.merges(), [{ number: 1011, head: world.tip }], 'the forge never received the merge');
    assert.equal(world.models.length, 1, 'a later command started');
    assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
  });
});

// S2 and S22 distinguish a refused observation from permission to continue the run.
test('S2-S22: refused unended or sign.stopped records still end the run with a named refusal', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  for (const refusal of ['survivor.unended', 'sign.stopped']) await t.test(refusal, async (t) => {
    const world = await signLoopWorld(t, { numbers: [10, 11] });
    const running = world.start();
    await until(() => world.models.length === 1 || world.completed(), t);
    await turn(t);
    const model = world.models[0];
    world.table.get(model.escaped).refuses = true;
    world.refuse(refusal);
    model.finish(3);
    await until(() => world.events().some(({ event }) => event === 'dispatch.end'), t);
    assert.equal(world.events().filter(({ event }) => event === 'dispatch').length, 1, 'a continuation was selected beside the sign');
    await running.catch(() => {});
    assert.ok(world.failure(), 'the run did not fail');
    assert.ok(readGroups(world.state)[0].unended.some(({ pid }) => pid === model.escaped), 'a refused observation lost its process sign');
    assert.equal(world.models.length, 1, 'a later command started');
    assert.equal(world.events().filter(({ event }) => event === 'pull').length, 1, 'another card was claimed');
    const messages = (error) => [error.message, ...(error.errors ?? []).flatMap(messages), ...(error.cause ? messages(error.cause) : [])];
    if (refusal === 'sign.stopped') assert.match(messages(world.failure()).join('\n'), /controlled sink refuses sign\.stopped/, 'the sign.stopped refusal was not handed to the verb');
    else assert.match(messages(world.failure()).join('\n'), new RegExp(String(model.escaped)), 'the surviving process was not named');
  });
});

// S17 separates a dispatch's signs from an unrelated L0 command's survivors.
test('S17: an unended command outside dispatch does not prevent dispatch work', { timeout: 10_000 }, async (t) => {
  const { runCommand } = await import('../src/substrate/process.mjs');
  const world = signWorld(t);
  world.table.get(world.escaped).refuses = true;
  const command = runCommand({ command: '/controlled/non-dispatch', args: [], cwd: '/', env: {}, timeout: 60_000, host: world.host, emitter: world.sink.emitter({ layer: 'L0' }) });
  await turn(t);
  world.finish(3);
  await command;
  assert.deepEqual(readGroups(world.directory), []);
  const next = trackerWorld(world.clock, world.group + 100, world.table);
  const running = world.start('d-after-unrelated', { host: next.host });
  await turn(t);
  next.finish();
  await running;
  assert.ok(world.events.some(({ event, dispatch }) => event === 'dispatch.start' && dispatch === 'd-after-unrelated'));
});

// S9 must retain each failed scope at the dispatch ending, before another card can be claimed.
// proves R-STATE-32, R-STATE-37
test('S9: failed group directory and dispatch reads stop the same run before another pull', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  for (const scope of ['group', 'directory', 'dispatch']) await t.test(scope, async (t) => {
    const world = await signLoopWorld(t);
    const running = world.start();
    await until(() => world.models.length === 1 || world.completed(), t);
    await turn(t);
    world.inject((tool, args) => (scope === 'directory' ? tool === world.host.lsof : tool === world.host.ps && args.includes(scope === 'group' ? '-g' : '-A'))
      ? { error: Object.assign(new Error(`controlled ${scope} census unreadable`), { code: 2 }), stdout: '', stderr: `controlled ${scope} census unreadable` } : undefined);
    world.models[0].finish(3);
    await until(() => world.events().some(({ event }) => event === 'dispatch.end'), t);
    assert.equal(world.events().filter(({ event }) => event === 'dispatch').length, 1, 'a continuation was selected beside the sign');
    await running.catch(() => {});
    const held = readGroups(world.state)[0];
    assert.ok(held?.unread.some(({ kind }) => kind === scope), `the ${scope} failed read was not retained`);
    assert.equal(world.events().filter(({ event }) => event === 'pull').length, 1, 'another card was claimed');
    assert.equal(world.models.length, 1, 'another command started');
    const stopped = world.events().find(({ event }) => event === 'sign.stopped');
    assert.ok(stopped?.signs.some(({ kind, reason, group, directory, dispatch }) => kind === 'read' && /census unreadable/.test(reason) && (scope === 'group' ? group === held.group : scope === 'directory' ? directory === held.workspace : dispatch === held.dispatch)), 'the event did not name the failed read');
    assert.match(world.failure().errors.flatMap((error) => [error.message, ...(error.errors ?? []).map(({ message }) => message)]).join('\n'), /census unreadable/, 'the verb did not receive why the read failed');
  });
});

// S10/S11 must distinguish a successful empty census or replaced identity from another failed read.
// proves R-STATE-32
test('S10-S11: a successful empty census or a replaced group or directory admits the next dispatch', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const observation of ['group empty', 'directory empty', 'dispatch empty', 'group replaced', 'directory gone', 'directory replaced']) await t.test(observation, async (t) => {
    const world = signWorld(t);
    const kind = observation.split(' ')[0];
    const place = join(world.directory, 'workspace');
    mkdirSync(place);
    const identity = identityOf(place);
    writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-unread', settled: true,
      workspace: place, ...identity, unread: [{ kind, ...(kind === 'group' ? { group: world.group } : kind === 'directory' ? { directory: place } : {}), reason: 'earlier census failed' }] }]);
    for (const row of world.table.values()) row.state = 'Z';
    if (observation.endsWith('empty')) world.table.clear();
    if (observation === 'group replaced') { const row = world.table.get(world.group); row.state = 'S'; row.started = 'Thu Oct 29 12:00:01 2026'; }
    if (observation === 'directory gone') rmSync(place, { recursive: true });
    if (observation === 'directory replaced') world.host.stat = () => ({ dev: BigInt(identity.device), ino: BigInt(identity.inode) + 1n });
    await assert.doesNotReject(killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host }), 'a successful empty or replaced scope read did not clear its sign');
    assert.deepEqual(world.signals, [], 'a gone or replaced scope was signalled');
    assert.deepEqual(readGroups(world.directory), [], 'a shown-gone read sign remained');
    const next = trackerWorld(world.clock, world.group + 100, world.table);
    const running = world.start('d-after-read', { host: next.host });
    await turn(t);
    next.finish();
    await running;
    assert.ok(world.events.some(({ event, dispatch }) => event === 'dispatch.start' && dispatch === 'd-after-read'));
  });
});

// The verb must render L3's named report independently of a successful stop-event append.
test('S1 S9 S14a S15 S16 S21 S22 output: the real run verb names every sign kind and a refused sign.stopped', { timeout: 20_000 }, async (t) => {
  const { optionalWorld, optionalRun } = await import('./optional-config-world.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { writeGroups, addTracked } = await import('../src/execution/groups.mjs');
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { join } = await import('node:path');
  for (const kind of ['unended', 'read', 'write', 'unfinished write', 'unread unfinished write', 'record', 'refused stop']) await t.test(kind, async (t) => {
    let world;
    const pid = 900_090_009;
    const name = 'worker "quoted"';
    const cmd = 'controlled worker\nwith newline';
    const reason = 'earlier census "quoted"\nfailed';
    world = optionalWorld(t, 'minimal', { settings: { ...minimalConfig(), concurrency: 1 }, items: [card(10, 'Ready'), card(11, 'Ready')], beforeAgent: async () => {
      await turn(t);
      const state = join(world.consumer, '.rigger');
      const entries = readGroups(state);
      if (kind === 'unended' || kind === 'refused stop') writeGroups(state, entries.map((entry) => ({ ...entry, unended: [{ pid, started: 0, name, cmd }] })));
      if (kind === 'read') writeGroups(state, entries.map((entry) => ({ ...entry, unread: [{ kind: 'group', group: entry.group, reason }] })));
      if (kind === 'record') fs.writeFileSync(join(state, 'groups.json'), '{');
      if (kind === 'write') {
        const partial = join(state, 'groups.json.partial');
        fs.mkdirSync(partial);
        assert.throws(() => addTracked(state, entries[0].group, [{ pid, started: 0 }]));
        fs.rmSync(partial, { recursive: true });
      }
      if (kind === 'unfinished write') fs.writeFileSync(join(state, 'groups.json.partial'), JSON.stringify([{ ...entries[0], settled: true, unended: [{ pid, started: 0, name, cmd }] }]));
      if (kind === 'unread unfinished write') fs.writeFileSync(join(state, 'groups.json.partial'), '{');
    } });
    if (kind.includes('unfinished write')) {
      // A later start reads the partial before any command or write can consume it.
      const state = join(world.consumer, '.rigger');
      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(join(state, 'groups.json.partial'), kind === 'unfinished write' ? JSON.stringify([{ group: pid + 1, started: 0, dispatch: 'd-earlier', settled: true, unended: [{ pid, started: 0, name, cmd }] }]) : '{');
    }
    if (kind === 'refused stop') {
      const append = fs.appendFileSync;
      t.mock.method(fs, 'appendFileSync', (path, text, ...rest) => {
        if (String(text).includes('"event":"sign.stopped"')) throw new Error('controlled sign.stopped append refused');
        return append(path, text, ...rest);
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    }
    const result = await world.start(optionalRun);
    assert.equal(result.code, 1, result.text);
    assert.ok(result.text.includes('signs of an earlier dispatch'), result.text);
    const stopped = world.events().filter(({ event }) => event === 'sign.stopped');
    if (kind === 'refused stop') {
      assert.equal(stopped.length, 0);
      assert.match(result.text, /controlled sign\.stopped append refused/);
    } else {
      assert.equal(stopped.length, 1);
      const expected = kind === 'unfinished write' || kind === 'write' ? 'write' : kind === 'unread unfinished write' ? 'record' : kind;
      assert.ok(stopped[0].signs.some((sign) => sign.kind === expected), JSON.stringify(stopped[0]));
      for (const sign of stopped[0].signs) assert.ok(result.text.includes(JSON.stringify(sign)), 'output and the event did not carry the same named sign');
    }
    if (kind === 'unended') { assert.ok(result.text.includes(JSON.stringify(name))); assert.ok(result.text.includes(JSON.stringify(cmd))); }
    if (kind === 'read') assert.ok(result.text.includes(JSON.stringify(reason)));
    assert.ok(world.events().filter(({ event }) => event === 'pull').length <= 1, 'another card was claimed');
  });
});

// These start-time rows use the actual verb, its reaper and its presenter with the same controlled host.
test('S3 S7 S12 S15 S16 S19 S21 verb: every refused start records and prints its signs and exits nonzero', { timeout: 20_000 }, async (t) => {
  const { signVerbWorld } = await import('./process-fixtures.mjs');
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const row of ['S3', 'S7', 'S12', 'S15', 'S16', 'S19', 'S21']) await t.test(row, async (t) => {
    const world = await signVerbWorld(t);
    const pid = 900_010_010;
    const entry = { group: 900_010_000, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-earlier', settled: true };
    world.table.get(pid).refuses = true;
    if (['S3', 'S7', 'S15'].includes(row)) entry.unended = [{ pid, started: entry.started, name: 'controlled', cmd: `controlled ${pid}` }];
    if (['S12', 'S19'].includes(row)) entry.unread = [{ kind: 'group', group: entry.group, reason: 'earlier group census failed' }];
    writeGroups(world.state, row === 'S15' || row === 'S16' || row === 'S21' ? [] : [entry]);
    if (row === 'S15') writeFileSync(join(world.state, 'groups.json.partial'), JSON.stringify([entry]));
    if (row === 'S16') writeFileSync(join(world.state, 'groups.json.partial'), '{');
    if (row === 'S21') writeFileSync(join(world.state, 'groups.json'), '{');
    if (row === 'S7' || row === 'S12') world.inject((_tool, args) => args.includes(row === 'S7' ? '-A' : '-g') ? { error: Object.assign(new Error('controlled census failed again'), { code: 2 }), stdout: '', stderr: 'controlled census failed again' } : undefined);
    if (row === 'S19') world.table.get(entry.group + 1).outlives = true;
    const result = await world.startVerb();
    assert.equal(result.code, 1, result.text);
    assert.equal(world.models.length, 0, 'the refused start ran a command');
    const stops = world.events().filter(({ event }) => event === 'sign.stopped');
    assert.equal(stops.length, 1, result.text);
    for (const sign of stops[0].signs) assert.ok(result.text.includes(JSON.stringify(sign)), `the verb did not name ${JSON.stringify(sign)}: ${result.text}`);
    if (row === 'S3' || row === 'S19') assert.ok(world.signals.some(({ name }) => name === 'SIGKILL'), 'the start never retried its kill');
    if (row === 'S7') assert.deepEqual(world.signals, [], 'an unconfirmed identity was signalled');
  });
});

// Same-run stops must reach the public verb as well as preserving L1's record.
test('S1 S2 S9 S14a S22 verb: an ending dispatch or failed write stops actual run with named output', { timeout: 20_000 }, async (t) => {
  const { signVerbWorld, until } = await import('./process-fixtures.mjs');
  const { addTracked } = await import('../src/execution/groups.mjs');
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { join } = await import('node:path');
  for (const row of ['S1', 'S2', 'S9 group', 'S9 directory', 'S9 dispatch', 'S14a', 'S22']) await t.test(row, async (t) => {
    const world = await signVerbWorld(t, { numbers: [10, 11, 12], concurrency: row === 'S14a' ? 2 : 1 });
    if (row === 'S2' || row === 'S22') {
      const append = fs.appendFileSync;
      const event = row === 'S2' ? 'survivor.unended' : 'sign.stopped';
      t.mock.method(fs, 'appendFileSync', (path, text, ...rest) => {
        if (String(text).includes(`"event":"${event}"`)) throw new Error(`controlled ${event} append refused`);
        return append(path, text, ...rest);
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    }
    const running = world.startVerb();
    await until(() => world.models.length === (row === 'S14a' ? 2 : 1) || world.verbEnded(), t);
    assert.equal(world.models.length, row === 'S14a' ? 2 : 1, 'the premise commands did not start');
    await turn(t);
    const first = world.models[0];
    if (row.startsWith('S9')) {
      const scope = row.split(' ')[1];
      world.inject((tool, args) => (scope === 'directory' ? tool === world.host.lsof : tool === world.host.ps && args.includes(scope === 'group' ? '-g' : '-A'))
        ? { error: Object.assign(new Error(`controlled ${scope} census failed`), { code: 2 }), stdout: '', stderr: `controlled ${scope} census failed` } : undefined);
    } else if (row === 'S14a') {
      const pid = first.escaped + 1;
      world.table.set(pid, { ...world.table.get(first.escaped), pid, parent: first.escaped, group: pid });
      const partial = join(world.state, 'groups.json.partial');
      fs.mkdirSync(partial);
      assert.throws(() => addTracked(world.state, first.group, [{ pid, started: Date.UTC(2026, 9, 29, 12) / 1000 }], { host: world.host }));
      fs.rmSync(partial, { recursive: true });
      world.models[1].finish(3);
      await until(() => world.events().some(({ event, dispatch }) => event === 'dispatch.end' && dispatch === world.models[1].dispatch.dispatch), t);
      assert.equal(world.verbEnded(), false, 'the run did not wait for its running dispatch');
    } else world.table.get(first.escaped).refuses = true;
    first.finish(3);
    await until(() => world.verbEnded() || world.models.length > (row === 'S14a' ? 2 : 1), t);
    assert.equal(world.models.length, row === 'S14a' ? 2 : 1, 'a later dispatch command started');
    const result = await running;
    assert.equal(result.code, 1, result.text);
    assert.equal(world.events().filter(({ event }) => event === 'pull').length, row === 'S14a' ? 2 : 1, 'another card was claimed');
    const stops = world.events().filter(({ event }) => event === 'sign.stopped');
    if (row === 'S22') {
      assert.equal(stops.length, 0);
      assert.match(result.text, /controlled sign\.stopped append refused/);
      assert.ok(result.text.includes(String(first.escaped)));
    } else {
      assert.equal(stops.length, 1, result.text);
      assert.ok(stops[0].signs.length > 0);
      for (const sign of stops[0].signs) assert.ok(result.text.includes(JSON.stringify(sign)), `the verb lost a named sign: ${result.text}`);
    }
  });
});
