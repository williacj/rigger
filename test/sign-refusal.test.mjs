// ABOUTME: Controlled proof that a dispatch's process signs refuse later dispatches and stop claims.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { killRecordedGroups } from '../src/execution/run.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { trackerWorld, turn } from './process-fixtures.mjs';
import { workingProcess } from './process-fixtures.mjs';
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

/** Independently expected fields must occur together in both structured and printable sign reports. */
function assertNamedSigns(signs, output, expected, everySign = false) {
  const messages = (value) => typeof value === 'string' ? [value] : value === undefined ? []
    : [value.message, ...(value.errors ?? []).flatMap(messages), ...messages(value.cause)];
  const prefix = "signs of an earlier dispatch's process: ";
  const printed = messages(output).flatMap((message) => message.split('\n').flatMap((line) => {
    const start = line.indexOf(prefix);
    if (start < 0) return [];
    const text = line.slice(start + prefix.length);
    for (let end = 0; end < text.length; end += 1) if (text[end] === ']') {
      try { const report = JSON.parse(text.slice(0, end + 1)); if (Array.isArray(report)) return [report]; } catch { /* A bracket inside a quoted value is not the array's end. */ }
    }
    return [];
  }));
  for (const report of [...(signs === undefined ? [] : [signs]), ...printed]) for (const sign of report) {
    const keys = sign.kind === 'unended' ? ['pid', 'name', 'cmd'] : sign.kind === 'read'
      ? ['reason', ...['group', 'directory', 'dispatch'].filter((key) => Object.hasOwn(sign, key))] : ['path', 'reason'];
    assert.ok(['unended', 'read', 'record', 'write'].includes(sign.kind), 'the report lost its sign kind');
    if (sign.kind === 'read') assert.equal(keys.length, 2, 'the read sign must name exactly what could not be read');
    for (const key of keys) assert.ok(key === 'pid' || key === 'group'
      ? Number.isSafeInteger(sign[key]) && sign[key] > 1 : typeof sign[key] === 'string' && sign[key].length > 0,
    `the report lost ${sign.kind}.${key}`);
  }
  const matches = (required, sign) => Object.entries(required).every(([key, value]) => value instanceof RegExp
    ? typeof sign[key] === 'string' && value.test(sign[key]) : sign[key] === value);
  if (everySign) for (const report of [...(signs === undefined ? [] : [signs]), ...printed]) for (const sign of report) {
    assert.ok(expected.some((required) => matches(required, sign)), `the report included unexpected ${sign.kind} details: ${JSON.stringify(sign)}`);
  }
  for (const required of expected) {
    if (signs !== undefined) assert.ok(signs.some((sign) => matches(required, sign)), `structured report lost the required ${required.kind} details`);
    assert.ok(printed.some((report) => report.some((sign) => matches(required, sign))), `printable report lost the required ${required.kind} details`);
  }
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
  assert.equal(entry?.settled, true, 'whole containment did not mark the sign-bearing entry settled');
  assert.ok(entry?.unended?.some(({ pid, name, cmd }) => pid === world.escaped && name === 'controlled' && cmd === `controlled ${world.escaped}`), 'the settled dispatch lost its process sign');
  const spawn = t.mock.method(world.host, 'spawn');
  const [later] = await Promise.allSettled([world.start('d-later')]);
  assert.equal(spawn.mock.callCount(), 0, 'a later command spawned beside the sign');
  assert.equal(later.status, 'rejected', 'a later command started beside the sign');
  assert.equal(later.reason.code, 'SIGN_STOPPED', 'the rejection was not the sign refusal');
  assert.ok(later.reason.signs.some(({ kind, pid }) => kind === 'unended' && pid === world.escaped));
  assertNamedSigns(later.reason.signs, later.reason, [{ kind: 'unended', pid: world.escaped, name: 'controlled', cmd: `controlled ${world.escaped}` }]);
});

// A successful snapshot cannot authorize a kill after its pid has been given to another process.
test('a recorded pid replaced after the whole-table snapshot receives no destructive retry', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-earlier', settled: true,
    unended: [{ pid: world.escaped, started, name: 'controlled', cmd: `controlled ${world.escaped}` }] }]);
  let replaced = false;
  const read = world.host.spawnSync;
  world.host.spawnSync = (tool, args, options) => {
    const answer = read(tool, args, options);
    if (!replaced && args.at(-1) === 'pid=,stat=,lstart=') {
      assert.ok(answer.stdout.includes(`${world.escaped} S Thu Oct 29 12:00:00 2026`), 'premise: the snapshot did not name the recorded identity');
      world.table.get(world.escaped).started = 'Thu Oct 29 12:00:01 2026';
      replaced = true;
    }
    return answer;
  };
  await killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host }).catch(() => {});
  assert.equal(replaced, true, 'the pid replacement was not established after the snapshot');
  assert.equal(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), false,
    'the start killed the replacement before confirming its identity while stopped');
  assert.equal(world.table.get(world.escaped).state, 'S', 'the replacement was not left running');
});

/** kill(2)'s EPERM fault at SIGKILL alone, after ps(1)'s stopped identity read. */
function refuseRetryKill(world, pid) {
  const row = world.table.get(pid);
  row.refuses = false;
  let readWhileStopped = false;
  let attempts = 0;
  world.inject((_tool, args) => {
    if (args[0] === '-p' && args[1].split(',').includes(String(pid)) && args.at(-1) === 'pid=,lstart=' && row.state === 'T') readWhileStopped = true;
    return undefined;
  });
  const signal = world.host.signal;
  world.host.signal = (target, name) => {
    if (target !== pid || name !== 'SIGKILL') return signal(target, name);
    attempts += 1;
    // Bound the faulty retry loop by a second refusal; the test asserts its single attempt below.
    if (attempts > 1) throw new Error('controlled repeated kill refused');
    row.refuses = true;
    try { return signal(target, name); } finally { row.refuses = false; }
  };
  return { attempts: () => attempts, readWhileStopped: () => readWhileStopped };
}

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
  const retry = refuseRetryKill(world, world.escaped);
  const [restart] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.equal(restart.status, 'rejected', 'the start proceeded while the recorded process remained');
  assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), 'the next start never retried its kill');
  assert.ok(restart.reason.signs.some(({ pid }) => pid === world.escaped));
  assert.equal(retry.attempts(), 1, 'the start repeated its refused destructive signal');
  assert.equal(retry.readWhileStopped(), true, 'the retry did not read the stopped identity before its destructive signal');
  assert.equal(world.table.get(world.escaped).state, 'S', 'the refused retry left the process stopped');
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
  assertNamedSigns(events.find(({ event }) => event === 'sign.stopped').signs, result.text, [{ kind: 'record', path, reason: /Expected property name or '}' in JSON at position 1/ }]);
  assert.notEqual(result.code, 0);
});

// A record can become unreadable after dispatch.end's final read and before take's claim.
// proves R-STATE-33, R-STATE-37
test('S13 take: a record unreadable at slot release permits no later pull or dispatch start', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  let world;
  let signAt;
  world = await signLoopWorld(t, { numbers: [10, 11], accepted: ({ event, card }) => {
    if (event === 'slot.release' && card === 10) {
      assert.ok(world.events().some(({ event, card }) => event === 'dispatch.end' && card === 10), 'the sign arose before the last dispatch ended');
      signAt = world.events().length;
      writeFileSync(join(world.state, 'groups.json'), '{');
    }
  } });
  const running = world.start();
  await until(() => world.models.length === 1 || world.completed(), t);
  assert.equal(world.models.length, 1, 'the premise maker did not start');
  world.models[0].host.spawn().stdout.write('controlled work\n');
  world.models[0].finish(3);
  await until(() => world.completed() || world.models.length > 1, t);
  assert.equal(typeof signAt, 'number', 'the record never became unreadable at slot release');
  const after = world.events().slice(signAt);
  assert.deepEqual(after.filter(({ event, layer }) => event === 'pull' && layer === 'L3'), [], 'take claimed a card after the record became unreadable');
  assert.deepEqual(after.filter(({ event }) => event === 'dispatch.start'), [], 'a dispatch started after the record became unreadable');
  await running.catch(() => {});
  const stopped = world.events().filter(({ event }) => event === 'sign.stopped');
  assert.equal(stopped.length, 1);
  const path = join(world.state, 'groups.json');
  assert.ok(stopped[0].signs.some((sign) => sign.kind === 'record' && sign.path === path && /cannot be read/.test(sign.reason)), 'the stop did not name the unreadable record');
  const messages = (error) => [error.message, ...(error.errors ?? []).flatMap(messages)];
  assert.ok(messages(world.failure()).some((message) => message.includes(path)), 'the verb did not receive the record path');
  assertNamedSigns(stopped[0].signs, world.failure(), [{ kind: 'record', path, reason: /Expected property name or '}' in JSON at position 1/ }]);
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
  assertNamedSigns(ran.reason.signs, ran.reason, [{ kind: 'record', path, reason: /Expected property name or '}' in JSON at position 1/ }]);
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
  assertNamedSigns(ran.reason.signs, ran.reason, [
    { kind: 'unended', pid: world.escaped, name: 'controlled', cmd: `controlled ${world.escaped}` },
    { kind: 'write', path: join(world.directory, 'groups.json'), reason: 'an unfinished write named processes not shown gone' },
  ]);
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
  assertNamedSigns(world.events().find(({ event }) => event === 'sign.stopped').signs, ran.reason,
    [{ kind: 'unended', pid: model.escaped, name: 'controlled', cmd: `controlled ${model.escaped}` }]);
});

/** Establishes a role continuation, with or without its predecessor's sign. */
async function roleContinuation(t, role, signed) {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { card } = await import('./verb-consumer.mjs');
  const { markerComment } = await import('./fake-repository.mjs');
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
    return world;
  }
  assert.equal(world.models.length, 1, 'a continuation command started beside the sign');
  await running.catch(() => {});
  assert.equal(world.events().filter(({ event }) => event === 'dispatch').length, 1, 'a continuation was selected beside the sign');
  assert.equal(world.events().filter(({ event }) => event === 'sign.stopped').length, 1);
  return world;
}

// proves R-STATE-30
test('R1-R4: a provisioner maker judge or escalation predecessor sign prevents its next role', { timeout: 20_000 }, async (t) => {
  for (const role of ['provisioner', 'maker', 'judge', 'escalation predecessor']) for (const signed of [false, true]) {
    await t.test(`${role} ${signed ? 'sign' : 'control'}`, (t) => roleContinuation(t, role, signed));
  }
});

// R9 distinguishes a refused next attempt from a failed attempt.
// proves R-STATE-39
test('R9: a provisioner sign spends no second attempt', { timeout: 20_000 }, async (t) => {
  const world = await roleContinuation(t, 'provisioner', true);
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 2).length, 0, 'a sign spent attempt 2');
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
    if (panel) assert.ok(world.decisions.some(({ options }) => options.judged && ['reviewer', 'architect'].every((role) => options.judged[role]?.decision !== undefined)), 'L3 discarded the completed panel decisions beside a sign');
  });
});

/** A failed tracked-set write stays a sign until a successful read shows its process gone. */
async function failedWriteUntilGone(t) {
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
}

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
    if (kind === 'directory') workingProcess(world, pid, place);
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
  const { recordPath } = await import('../src/execution/groups.mjs');
  const { readFileSync } = await import('node:fs');
  for (const fields of [{ unended: [{ pid: 0, started: 0 }] }, { unended: null }, { unread: {} }, { unread: [{ kind: 'other', reason: 'no such read' }] }, { settled: 'yes' },
    { unended: [{ pid: 900_000_020, started: 'not a start time' }] },
    { unended: [{ pid: 900_000_020, name: 7 }] }, { unended: [{ pid: 900_000_020, cmd: 7 }] },
    { unread: [{ kind: 'dispatch', reason: 7 }] }, { unread: [{ kind: 'group', group: 1, reason: 'bad group' }] },
    { unread: [{ kind: 'directory', directory: 'relative', reason: 'bad directory' }] },
  ]) await t.test(JSON.stringify(fields), async (t) => {
    const world = signWorld(t);
    const started = Date.UTC(2026, 9, 29, 12) / 1000;
    writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-prefix' }, { group: world.group + 100, started, dispatch: 'd-record', ...fields }]);
    const before = readFileSync(recordPath(world.directory), 'utf8');
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected', 'an unreadable sign entry was accepted');
    assert.ok(ran.reason.signs?.some(({ kind }) => kind === 'record'), ran.reason.message);
    assert.deepEqual(world.signals, [], 'a process was signalled before the whole record was readable');
    assert.equal(readFileSync(recordPath(world.directory), 'utf8'), before, 'the unreadable record was rewritten');
  });
});

/** Exercises the start's process identity boundary with a documented table answer. */
async function startAfterProcessRead(t, observation) {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  for (const row of world.table.values()) row.state = 'Z';
  world.table.get(world.escaped).state = observation === 'zombie' ? 'Z' : 'S';
  writeGroups(world.directory, [{ group: world.group, started: Date.UTC(2026, 9, 29, 12) / 1000, dispatch: 'd-ended', settled: true,
    unended: [{ pid: world.escaped, started: Date.UTC(2026, 9, 29, 12) / 1000, name: 'controlled', cmd: `controlled ${world.escaped}` }] }]);
  if (observation === 'absent') world.table.delete(world.escaped);
  if (observation === 'reused pid') world.table.get(world.escaped).started = 'Thu Oct 29 12:00:01 2026';
  const failed = ['failed read', 'unreadable start', 'stderr on success', 'unparseable row'].includes(observation);
  if (failed) world.inject((_tool, args) => args.includes('-A') && args.at(-1) === 'pid=,stat=,lstart='
    ? observation === 'failed read' ? { error: Object.assign(new Error('table unavailable'), { code: 2 }), stdout: '', stderr: 'table unavailable' }
      : observation === 'stderr on success' ? { status: 0, stdout: '', stderr: 'ps: process table incomplete' }
      : observation === 'unparseable row' ? { status: 0, stdout: `${world.escaped} unreadable\n`, stderr: '' }
      : { status: 0, stdout: `${world.escaped} S no readable start\n`, stderr: '' } : undefined);
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.deepEqual(world.signals, [], 'an unconfirmed or exited process was signalled');
  if (failed) {
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
}

// proves R-STATE-31
test('S7: an unconfirmed unended process refuses work without receiving a signal', { timeout: 10_000 }, async (t) => {
  for (const observation of ['failed read', 'unreadable start', 'stderr on success', 'unparseable row']) await t.test(observation, (t) => startAfterProcessRead(t, observation));
});

// proves R-STATE-38
test('S8: a successful gone read including an unreaped exit permits the next dispatch', { timeout: 10_000 }, async (t) => {
  for (const observation of ['zombie', 'absent', 'reused pid']) await t.test(observation, (t) => startAfterProcessRead(t, observation));
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

/** Makes a failed write before take, optionally showing its omitted process gone first. */
async function takeAfterFailedWrite(t, clear) {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
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
  else {
    assert.equal(stops.length, 1, 'the failed write did not record exactly one stop');
    assert.equal(world.models.length, 2, 'a later command started beside the failed write');
    assert.equal(world.events().filter(({ event }) => event === 'dispatch.start').length, 2, 'a later dispatch start was recorded beside the failed write');
    assert.ok(stops[0].signs.some(({ kind, path, reason }) => kind === 'write' && path === join(world.state, 'groups.json') && typeof reason === 'string'));
    const messages = (error) => [error.message, ...(error.errors ?? []).flatMap(messages)];
    for (const sign of stops[0].signs) assert.ok(messages(world.failure()).some((message) => message.includes(JSON.stringify(sign))), 'the verb did not receive the named failed write');
    assertNamedSigns(stops[0].signs, world.failure(), [{ kind: 'write', path: join(world.state, 'groups.json'), reason: /EISDIR.*groups\.json\.partial/ }]);
  }
}

// proves R-STATE-34, R-STATE-36, R-STATE-37
test('S14a: take refuses an omitted live process and waits for the running dispatch, naming the failed write', { timeout: 20_000 }, async (t) => {
  await failedWriteUntilGone(t);
  await takeAfterFailedWrite(t, false);
});

// proves R-STATE-34
test('S14b: a gone read before take permits a later dispatch after a failed write', { timeout: 20_000 }, (t) => takeAfterFailedWrite(t, true));

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
  assertNamedSigns(undefined, stderr,
    [{ kind: 'write', path: join(world.directory, 'groups.json'), reason: 'controlled record storage full' }], true);
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
  const settled = t.mock.method(world.l2, 'settled');
  let spawns = 0;
  world.host.spawn = () => { spawns += 1; throw Object.assign(new Error('controlled provider CLI missing'), { code: 'ENOENT' }); };
  await world.start().catch(() => {});
  assert.equal(signed, true, 'the second attempt never reached its recorded start');
  assert.equal(spawns, 1, 'the command spawned after the sign arose');
  assert.equal(settled.mock.calls.some(({ arguments: [, outcome] }) => outcome.reason?.code === 'SIGN_STOPPED'), false, 'L3 handed the unstarted maker outcome to L2');
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 1).length, 1, 'the first failure was not established');
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 2).length, 0, 'the refusal spent attempt two');
  const path = join(world.state, 'groups.json');
  assertNamedSigns(world.events().find(({ event }) => event === 'sign.stopped').signs, world.failure(),
    [{ kind: 'record', path, reason: /Expected property name or '}' in JSON at position 1/ }]);
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

/** A refused containment observation or stop event never permits another command or claim. */
async function refusedSignRecord(t, refusal) {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
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
  const reports = (error) => [...(error.signs ?? []), ...(error.errors ?? []).flatMap(reports)];
  assertNamedSigns(reports(world.failure()), world.failure(), [{ kind: 'unended', pid: model.escaped, name: 'controlled', cmd: `controlled ${model.escaped}` }]);
}

// proves R-STATE-31
test('S2: a refused unended record still retains the process sign and ends the run', { timeout: 20_000 }, (t) => refusedSignRecord(t, 'survivor.unended'));

// proves R-STATE-37
test('S22: a refused sign.stopped still ends the run with a named refusal', { timeout: 20_000 }, (t) => refusedSignRecord(t, 'sign.stopped'));

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
    assertNamedSigns(stopped.signs, world.failure(), [{ kind: 'read',
      ...(scope === 'group' ? { group: world.models[0].group } : scope === 'directory' ? { directory: world.models[0].options.cwd } : { dispatch: world.models[0].dispatch.dispatch }),
      reason: new RegExp(`controlled ${scope} census unreadable`),
    }]);
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
    let group;
    const pid = 900_090_009;
    const name = 'worker "quoted"';
    const cmd = 'controlled worker\nwith newline';
    const reason = 'earlier census "quoted"\nfailed';
    world = optionalWorld(t, 'minimal', { settings: { ...minimalConfig(), concurrency: 1 }, items: [card(10, 'Ready'), card(11, 'Ready')], beforeAgent: async () => {
      await turn(t);
      const state = join(world.consumer, '.rigger');
      const entries = readGroups(state);
      group = entries[0].group;
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
    const state = join(world.consumer, '.rigger');
    const expected = ['unended', 'refused stop'].includes(kind) ? [{ kind: 'unended', pid, name, cmd }]
      : kind === 'read' ? [{ kind: 'read', group, reason }]
      : kind === 'unfinished write' ? [
        { kind: 'unended', pid, name, cmd },
        { kind: 'write', path: join(state, 'groups.json'), reason: 'an unfinished write named processes not shown gone' },
      ] : kind === 'write' ? [{ kind: 'write', path: join(state, 'groups.json'), reason: /EISDIR.*groups\.json\.partial/ }]
      : [{ kind: 'record', path: join(state, kind === 'unread unfinished write' ? 'groups.json.partial' : 'groups.json'), reason: /Expected property name or '}' in JSON at position 1/ }];
    assertNamedSigns(kind === 'refused stop' ? undefined : stopped[0].signs, result.text, expected);
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
    const retry = row === 'S3' ? refuseRetryKill(world, pid) : undefined;
    const result = await world.startVerb();
    assert.equal(result.code, 1, result.text);
    assert.equal(world.models.length, 0, 'the refused start ran a command');
    const stops = world.events().filter(({ event }) => event === 'sign.stopped');
    assert.equal(stops.length, 1, result.text);
    for (const sign of stops[0].signs) assert.ok(result.text.includes(JSON.stringify(sign)), `the verb did not name ${JSON.stringify(sign)}: ${result.text}`);
    const expected = ['S3', 'S7'].includes(row) ? [{ kind: 'unended', pid, name: 'controlled', cmd: `controlled ${pid}` }]
      : row === 'S15' ? [
        { kind: 'unended', pid, name: 'controlled', cmd: `controlled ${pid}` },
        { kind: 'write', path: join(world.state, 'groups.json'), reason: 'an unfinished write named processes not shown gone' },
      ] : ['S12', 'S19'].includes(row) ? [{ kind: 'read', group: entry.group, reason: 'earlier group census failed' }]
      : [{ kind: 'record', path: join(world.state, row === 'S16' ? 'groups.json.partial' : 'groups.json'), reason: /Expected property name or '}' in JSON at position 1/ }];
    assertNamedSigns(stops[0].signs, result.text, expected);
    if (row === 'S3' || row === 'S19') assert.ok(world.signals.some(({ name }) => name === 'SIGKILL'), 'the start never retried its kill');
    if (row === 'S7') assert.deepEqual(world.signals, [], 'an unconfirmed identity was signalled');
    if (retry) {
      assert.equal(retry.attempts(), 1, 'the refused start repeated its destructive signal');
      assert.equal(retry.readWhileStopped(), true, 'the refused start did not read the stopped identity before its destructive signal');
    }
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
      assertNamedSigns(undefined, result.text, [{ kind: 'unended', pid: first.escaped, name: 'controlled', cmd: `controlled ${first.escaped}` }]);
    } else {
      assert.equal(stops.length, 1, result.text);
      assert.ok(stops[0].signs.length > 0);
      for (const sign of stops[0].signs) assert.ok(result.text.includes(JSON.stringify(sign)), `the verb lost a named sign: ${result.text}`);
      const scope = row.split(' ')[1];
      const expected = row.startsWith('S9') ? [{ kind: 'read',
        ...(scope === 'group' ? { group: first.group } : scope === 'directory' ? { directory: first.options.cwd } : { dispatch: first.dispatch.dispatch }),
        reason: new RegExp(`controlled ${scope} census failed`),
      }] : row === 'S14a' ? [{ kind: 'write', path: join(world.state, 'groups.json'), reason: /EISDIR.*groups\.json\.partial/ }]
        : [{ kind: 'unended', pid: first.escaped, name: 'controlled', cmd: `controlled ${first.escaped}` }];
      assertNamedSigns(stops[0].signs, result.text, expected);
    }
  });
});

// A successful snapshot does not authorize a destructive signal after reuse during SIGSTOP.
test('a recorded pid replaced while stopped receives no destructive retry', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-earlier', settled: true,
    unended: [{ pid: world.escaped, started, name: 'controlled', cmd: `controlled ${world.escaped}` }] }]);
  const signal = world.host.signal;
  let replaced = false;
  world.host.signal = (target, name) => {
    const answer = signal(target, name);
    if (target === world.escaped && name === 'SIGSTOP') {
      assert.equal(world.table.get(target).state, 'T', 'premise: the original identity was not stopped');
      world.table.get(target).started = 'Thu Oct 29 12:00:01 2026';
      replaced = true;
    }
    return answer;
  };
  await killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host }).catch(() => {});
  assert.equal(replaced, true, 'the pid was not replaced during the stop');
  assert.equal(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), false, 'SIGKILL sent to the replacement');
  assert.equal(world.table.get(world.escaped).state, 'S', 'the replacement was left stopped');
});


// The outcome must carry the sign even when its own containment event was refused.
test('a rejected dispatch hands its process signs to its caller alongside the event refusal', { timeout: 10_000 }, async (t) => {
  const world = signWorld(t);
  const emitter = world.sink.emitter;
  t.mock.method(world.sink, 'emitter', (context) => ({ emit(event, fields) {
    if (event === 'survivor.unended') throw new Error('controlled containment event refused');
    return emitter(context).emit(event, fields);
  } }));
  world.table.get(world.escaped).refuses = true;
  const running = world.start('d-refused');
  await turn(t);
  world.finish(3);
  const [ran] = await Promise.allSettled([running]);
  assert.equal(ran.status, 'rejected');
  assert.equal(ran.reason.code, 'EVENT_REFUSED');
  assert.ok(ran.reason.signs?.some(({ kind, pid }) => kind === 'unended' && pid === world.escaped), 'the rejected dispatch lost its standing process sign');
  assert.ok(ran.reason.unrecorded.some(({ event }) => event === 'survivor.unended'), 'the sign replaced the original event refusal');
});

// A successful gone read clears an in-run sign without a restart or a destructive signal.
test('the claim-time read clears a recorded process sign once that identity is gone', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { signsStanding } = await import('../src/execution/run.mjs');
  const world = signWorld(t);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-earlier', settled: true,
    unended: [{ pid: world.escaped, started, name: 'controlled', cmd: `controlled ${world.escaped}` }] }]);
  assert.ok(signsStanding(world.directory, { host: world.host }).some(({ pid }) => pid === world.escaped), 'the live premise was not established');
  world.table.delete(world.escaped);
  assert.deepEqual(signsStanding(world.directory, { host: world.host }), [], 'the gone process still stopped a claim');
  assert.deepEqual(world.signals, [], 'the claim-time read sent a signal');
});

// Whole containment has finished; a later start owes only the outstanding signs.
test('a settled entry leaves its sign-free tracked processes and directories alone', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  const world = signWorld(t);
  const place = temporaryDirectory('rigger-settled-scope-', { context: t });
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  workingProcess(world, world.escaped, place);
  writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-earlier', settled: true,
    workspace: place, ...identityOf(place), tracked: [{ pid: world.group + 1, started }],
    unended: [{ pid: world.escaped + 100, started, name: 'gone', cmd: 'gone' }] }]);
  await killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host });
  assert.deepEqual(world.signals, [], 'a settled entry swept a process outside its outstanding signs');
  assert.equal(world.table.get(world.group + 1).state, 'S');
  assert.equal(world.table.get(world.escaped).state, 'S');
  assert.deepEqual(readGroups(world.directory), []);
});

// A successful census still owes its unread dispatch scope while one of its processes survives.
test('an unread dispatch stays recorded while a group or tracked process outlives its retry', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  for (const scope of ['group', 'tracked']) await t.test(scope, async (t) => {
    const world = signWorld(t);
    const started = Date.UTC(2026, 9, 29, 12) / 1000;
    const pid = scope === 'group' ? world.group + 1 : world.escaped;
    world.table.get(pid).outlives = true;
    if (scope === 'group') world.table.delete(world.escaped);
    else { world.table.delete(world.group); world.table.delete(world.group + 1); }
    writeGroups(world.directory, [{ group: world.group, started, dispatch: 'd-unread', settled: true,
      ...(scope === 'tracked' ? { tracked: [{ pid, started }] } : {}),
      unread: [{ kind: 'dispatch', reason: 'the earlier dispatch census failed' }] }]);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected');
    const held = readGroups(world.directory)[0];
    assert.ok(held?.unended?.some((each) => each.pid === pid), 'the surviving process was not retained');
    assert.ok(held.unread?.some(({ kind, reason }) => kind === 'dispatch' && reason === 'the earlier dispatch census failed'), 'the surviving process cleared its dispatch census sign');
  });
});

// Even an empty readable partial must be consumed by the start's successful rewrite.
test('a start consumes a readable empty unfinished write when the record is empty', { timeout: 10_000 }, async (t) => {
  const { writeGroups, partialPath } = await import('../src/execution/groups.mjs');
  const { writeFileSync, existsSync } = await import('node:fs');
  const world = signWorld(t);
  writeGroups(world.directory, []);
  writeFileSync(partialPath(world.directory), '[]');
  await killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host });
  assert.equal(existsSync(partialPath(world.directory)), false, 'the empty unfinished write was left unconsumed');
  assert.deepEqual(readGroups(world.directory), []);
  assert.deepEqual(world.signals, []);
});

// Both durable versions may hold a different outstanding identity in the same dispatch entry.
test('a readable unfinished write unions each recorded process and failed-read field', { timeout: 10_000 }, async (t) => {
  const { writeGroups, partialPath } = await import('../src/execution/groups.mjs');
  const { writeFileSync } = await import('node:fs');
  for (const field of ['tracked', 'unended', 'unread']) await t.test(field, async (t) => {
    const world = signWorld(t);
    const started = Date.UTC(2026, 9, 29, 12) / 1000;
    const second = world.escaped + 1;
    world.table.set(second, { ...world.table.get(world.escaped), pid: second, parent: 1, group: second, cmd: `controlled ${second}`, refuses: true });
    world.table.get(world.escaped).refuses = true;
    const entry = { group: world.group, started, dispatch: 'd-earlier', settled: field !== 'tracked' };
    const identity = (pid) => ({ pid, started, name: 'controlled', cmd: `controlled ${pid}` });
    const older = field === 'unread' ? [{ kind: 'group', group: world.group, reason: 'older group census failed' }] : [identity(world.escaped)];
    const added = field === 'unread' ? [{ kind: 'dispatch', reason: 'partial dispatch census failed' }] : [identity(second)];
    writeGroups(world.directory, [{ ...entry, [field]: older }]);
    writeFileSync(partialPath(world.directory), JSON.stringify([{ ...entry, [field]: added }]));
    if (field === 'unread') world.inject((_tool, args) => args.includes('-g') ? { error: Object.assign(new Error('controlled census refused'), { code: 2 }), stdout: '', stderr: 'controlled census refused' } : undefined);
    const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
    assert.equal(ran.status, 'rejected');
    const held = readGroups(world.directory)[0];
    if (field === 'unread') for (const wanted of older.concat(added)) assert.ok(held.unread?.some(({ kind, reason }) => kind === wanted.kind && reason === wanted.reason), `the partial lost ${wanted.kind}'s failed read`);
    else for (const pid of [world.escaped, second]) assert.ok(held.unended?.some((each) => each.pid === pid), `the partial lost process ${pid} from ${field}`);
  });
});

// The partial records whole containment settled after the durable entry was written.
test('an unfinished write keeps its later settlement instead of sweeping a finished directory again', { timeout: 10_000 }, async (t) => {
  const { writeGroups, partialPath } = await import('../src/execution/groups.mjs');
  const { identityOf } = await import('../src/substrate/process.mjs');
  const { writeFileSync } = await import('node:fs');
  const world = signWorld(t);
  const place = temporaryDirectory('rigger-partial-settled-', { context: t });
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  world.table.get(world.group).started = 'Thu Oct 29 12:00:01 2026';
  workingProcess(world, world.escaped, place);
  const entry = { group: world.group, started, dispatch: 'd-earlier', workspace: place, ...identityOf(place) };
  writeGroups(world.directory, [{ ...entry, settled: false }]);
  writeFileSync(partialPath(world.directory), JSON.stringify([{ ...entry, settled: true,
    unended: [{ pid: world.escaped + 100, started, name: 'gone', cmd: 'gone' }] }]));
  await killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host });
  assert.deepEqual(world.signals, [], 'the older entry replaced the partial settlement and swept a later occupant');
  assert.equal(world.table.get(world.escaped).state, 'S');
  assert.deepEqual(readGroups(world.directory), []);
});

/** Installs L0's normal-exit handler and lets its completed dispatch go before the exit-only premise. */
async function exitSignWorld(t) {
  const world = signWorld(t);
  const running = world.start('d-prime-exit');
  await turn(t);
  world.finish();
  await running;
  await turn(t);
  world.signals.length = 0;
  return world;
}

// A failed initial entry write must preserve its leader even when no durable dispatch entry exists.
test('normal exit saves the omitted group leader under an entry absent from the record', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const world = await exitSignWorld(t);
  const later = trackerWorld(world.clock, world.group + 100, world.table);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  const partial = join(world.directory, 'groups.json.partial');
  mkdirSync(partial);
  assert.throws(() => writeGroups(world.directory, [{ group: later.group, started, dispatch: 'd-omitted' }], { host: world.host }));
  rmSync(partial, { recursive: true });
  assert.deepEqual(readGroups(world.directory), [], 'the failed write unexpectedly reached the record');
  process.listeners('exit').find(({ name }) => name === 'cleanup')();
  const entry = readGroups(world.directory).find(({ dispatch }) => dispatch === 'd-omitted');
  assert.ok(entry?.unended?.some(({ pid, started: actual, name, cmd }) => pid === later.group && actual === started && name === 'controlled' && cmd === `controlled ${later.group}`), 'exit lost the omitted leader or its absent dispatch entry');
  assert.equal(entry.settled, undefined, 'the exit-only write invented completed containment');
  assert.deepEqual(world.signals, [], 'exit sign persistence signalled an unregistered group');
});

// Showing the last omitted process gone clears its write rather than inventing a new exit failure.
test('normal exit prints no failed-write sign once its omitted process is shown gone', { timeout: 10_000 }, async (t) => {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { join } = await import('node:path');
  const world = await exitSignWorld(t);
  const later = trackerWorld(world.clock, world.group + 100, world.table);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  const partial = join(world.directory, 'groups.json.partial');
  fs.mkdirSync(partial);
  assert.throws(() => writeGroups(world.directory, [{ group: later.group, started, dispatch: 'd-gone' }], { host: world.host }));
  fs.rmSync(partial, { recursive: true });
  world.table.delete(later.group);
  let stderr = '';
  const write = fs.writeSync;
  t.mock.method(fs, 'writeSync', (fd, buffer, ...args) => {
    if (fd !== 2) return write(fd, buffer, ...args);
    stderr += buffer.toString();
    return buffer.length;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  process.listeners('exit').find(({ name }) => name === 'cleanup')();
  assert.equal(stderr.includes(world.directory), false, 'exit printed a write sign after its omitted process was shown gone');
  assert.deepEqual(readGroups(world.directory), []);
  assert.equal(fs.existsSync(partial), false);
  t.mock.restoreAll();
  syncBuiltinESMExports();
});

// A required step's refused second dispatch is not an environment failure on attempt two.
test('a sign between a second provisioning start and spawn spends no failed attempt', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld } = await import('./process-fixtures.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const settings = minimalConfig();
  settings.provisioning = { install: { run: 'controlled install', required: true, timeout: 60_000 } };
  settings.kinds.change.provisioning = ['install'];
  let world;
  let signed = false;
  world = await signLoopWorld(t, { settings, numbers: [10], accepted: ({ event, dispatch }) => {
    if (event !== 'dispatch.start') return;
    const owner = world.events().find((entry) => entry.event === 'dispatch' && entry.dispatch === dispatch);
    if (owner?.attempt !== 2) return;
    signed = true;
    writeFileSync(join(world.state, 'groups.json'), '{');
  } });
  let spawns = 0;
  world.host.spawn = () => { spawns += 1; throw Object.assign(new Error('controlled command missing'), { code: 'ENOENT' }); };
  await world.start().catch(() => {});
  assert.equal(signed, true, 'the second provisioning attempt did not reach its start');
  assert.equal(spawns, 1, 'the refused step spawned its command');
  assert.equal(world.events().filter(({ event, attempt }) => event === 'attempt.failed' && attempt === 1).length, 1);
  assert.equal(world.events().some(({ event, attempt }) => event === 'attempt.failed' && attempt === 2), false, 'the unstarted provisioning step spent attempt two');
  assert.equal(world.decisions.some(({ outcomes = [] }) => outcomes.some(({ reason }) => reason?.code === 'SIGN_STOPPED')), false, 'L3 handed the refused step to workflow');
});

// A declared clock must not hold the run up after the last running dispatch ends beside a sign.
test('a sign ends a clock-kept run once its running command ends', { timeout: 20_000 }, async (t) => {
  const { signLoopWorld, until } = await import('./process-fixtures.mjs');
  const { minimalConfig } = await import('./optional-config.mjs');
  const settings = minimalConfig();
  settings.clock = { poll: 1000, triggers: { report: { interval: 1000, anchor: '1970-01-01T00:00:00.000Z', catchUp: 'skip', job: 'report' } } };
  const world = await signLoopWorld(t, { settings, numbers: [10] });
  const controller = new AbortController();
  let ended = false;
  const running = world.engine.run({ stop: controller.signal });
  running.then(() => { ended = true; }, () => { ended = true; });
  try {
    await until(() => world.models.length === 1 || ended, t);
    assert.equal(world.models.length, 1, 'the clock-kept premise command did not start');
    await turn(t);
    world.table.get(world.models[0].escaped).refuses = true;
    world.models[0].finish(3);
    await until(() => world.events().some(({ event }) => event === 'sign.stopped') || ended, t);
    await turn(t);
    assert.equal(ended, true, 'the clock kept the run alive after the sign stop');
    assert.equal(controller.signal.aborted, false, 'an external stop supplied the ending');
  } finally {
    controller.abort();
    for (const model of world.models) model.finish(3);
    await running.catch(() => {});
  }
});

// Clearing one failed write must hold even while another failure in its directory still stands.
test('normal exit does not restore a gone entry beside another failed write still standing', { timeout: 10_000 }, async (t) => {
  const { writeGroups, failedWriteSigns, partialPath } = await import('../src/execution/groups.mjs');
  const { mkdirSync, rmSync } = await import('node:fs');
  const world = await exitSignWorld(t);
  const later = trackerWorld(world.clock, world.group + 100, world.table);
  const started = Date.UTC(2026, 9, 29, 12) / 1000;
  const gone = { group: later.group + 100, started, dispatch: 'd-gone' };
  const live = { group: later.group, started, dispatch: 'd-live' };
  const partial = partialPath(world.directory);
  mkdirSync(partial);
  assert.throws(() => writeGroups(world.directory, [gone], { host: world.host }));
  assert.throws(() => writeGroups(world.directory, [live], { host: world.host }));
  rmSync(partial, { recursive: true });
  assert.deepEqual(readGroups(world.directory), [], 'premise: neither failed write reached the record');
  assert.equal(failedWriteSigns(world.directory, { host: world.host }).length, 1, 'premise: exactly the live entry must remain a write sign');
  process.listeners('exit').find(({ name }) => name === 'cleanup')();
  const entries = readGroups(world.directory);
  assert.deepEqual(entries.map(({ dispatch }) => dispatch), ['d-live'], 'an entry whose processes were shown gone was written back at exit');
  assert.ok(entries[0].unended.some(({ pid }) => pid === later.group), 'the other failed write lost its live process');
  assert.deepEqual(world.signals, [], 'exit persistence signalled an unregistered group');
});

/** The reason an earlier start wrote for the dispatch sign of #1507's row cases. */
const CENSUS_FAILED = 'the earlier dispatch census failed';
const OTHER_START = 'Thu Oct 29 12:00:01 2026';
// The failed and unreadable answers take the forms `startAfterProcessRead` injects for S7, after
// ps(1)'s contract: a failed read exits non-zero writing to standard error; an unreadable row lists
// the pid with a start time L0 cannot parse.
const FAILED = { error: Object.assign(new Error('table unavailable'), { code: 2 }), stdout: '', stderr: 'table unavailable' };
const startRead = (args) => args.includes('-p') && args.at(-1) === 'pid=,lstart=';
const wholeRead = (args) => args.includes('-A') && args.at(-1) === 'pid=,stat=,lstart=';

/**
 * #1507's row case `cell` over a settled entry for dispatch `d-reused` whose only sign is a read
 * sign of kind `dispatch`, its group gone: each tracked pid is set as `cell.pids` says, and each
 * read answered as `cell.start` and `cell.whole` say ('table' answers from the table).
 */
async function readSignOver(t, cell) {
  const { writeGroups } = await import('../src/execution/groups.mjs');
  const world = signWorld(t);
  const T = Date.UTC(2026, 9, 29, 12) / 1000;
  world.table.delete(world.group);
  world.table.delete(world.group + 1);
  world.table.delete(world.escaped);
  // A read of the whole table lists at least launchd, whatever has exited.
  world.table.set(1, { pid: 1, parent: 0, group: 1, started: 'Thu Oct 29 11:00:00 2026', state: 'Ss', name: 'launchd', cmd: '/sbin/launchd' });
  const pids = cell.pids.map((held, at) => {
    const pid = world.escaped + at;
    if (held !== 'absent') world.table.set(pid, { pid, parent: 1, group: pid, started: held === 'recorded' ? 'Thu Oct 29 12:00:00 2026' : OTHER_START, state: held === 'zombie' ? 'Z' : 'S', name: 'daemon', cmd: `daemon ${pid}` });
    return pid;
  });
  writeGroups(world.directory, [{ group: world.group, started: T, dispatch: 'd-reused', settled: true,
    tracked: pids.map((pid) => ({ pid, started: T })), unread: [{ kind: 'dispatch', reason: CENSUS_FAILED }] }]);
  const unreadable = (pid) => cell.unreadable?.includes(pid - world.escaped);
  const rows = (args, columns) => [...world.table.values()].filter(({ pid }) => args.includes('-A') || args[args.indexOf('-p') + 1].split(',').map(Number).includes(pid))
    .map((row) => `${row.pid} ${columns(row, unreadable(row.pid) ? 'no readable start' : row.started)}\n`).join('');
  world.inject((_tool, args) => {
    if (startRead(args)) {
      const answer = cell.start === 'failed' ? FAILED : cell.start === 'unreadable' ? { status: 0, stdout: rows(args, () => 'no readable start'), stderr: '' } : undefined;
      if (cell.exits) queueMicrotask(() => world.table.delete(world.escaped));
      return answer;
    }
    if (wholeRead(args)) return cell.whole === 'failed' ? FAILED : cell.unreadable ? { status: 0, stdout: rows(args, (row, start) => `${row.state} ${start}`), stderr: '' } : undefined;
    return undefined;
  });
  const [ran] = await Promise.allSettled([killRecordedGroups({ directory: world.directory, sink: world.sink, host: world.host })]);
  assert.deepEqual(world.signals.filter(({ target }) => pids.includes(Math.abs(target))), [], 'the start signalled a tracked pid');
  const live = pids.filter((_pid, at) => cell.pids[at] !== 'absent');
  for (const pid of live) assert.ok(world.events.some(({ event, pid: named, dispatch }) => event === 'recorded.unended' && named === pid && dispatch === 'd-reused'), `no recorded.unended named ${pid}`);
  const next = trackerWorld(world.clock, world.group + 100, world.table);
  const spawned = [];
  const fixture = { ...next.host };
  next.host.spawn = (...input) => { spawned.push(input); return fixture.spawn(...input); };
  const running = world.start('d-after', { host: next.host });
  await turn(t);
  next.finish();
  const [later] = await Promise.allSettled([running]);
  return { world, ran, later, spawned, pids };
}

// Each case's counterexample keeps the dispatch's read sign for a tracked pid a successful
// whole-table read shows is another process, gone, or a zombie, as 6bfc4311 did.
// proves R-STATE-32, R-STATE-38
test('C1 C2 C6 C9 Z1: a start goes ahead past a read sign whose tracked pids a whole-table read shows are not the processes recorded', { timeout: 20_000 }, async (t) => {
  const cases = {
    'C1 another process at the pid': { pids: ['other'] },
    'C2 failed start read': { pids: ['other'], start: 'failed' },
    'C2 unreadable start read': { pids: ['other'], start: 'unreadable' },
    'C6 several reused or absent pids': { pids: ['other', 'absent', 'other', 'other'] },
    'C9 other start, then reaped': { pids: ['other'], exits: true },
    'C9 failed start read, then reaped': { pids: ['other'], start: 'failed', exits: true },
    'C9 unreadable start read, then reaped': { pids: ['other'], start: 'unreadable', exits: true },
    'Z1 a zombie of another start': { pids: ['zombie'] },
  };
  for (const [name, cell] of Object.entries(cases)) await t.test(name, async (t) => {
    const { world, ran, later, spawned } = await readSignOver(t, cell);
    assert.equal(ran.status, 'fulfilled', `the start did not go ahead: ${ran.reason?.message}`);
    assert.deepEqual(readGroups(world.directory), [], 'the record kept an entry for d-reused');
    assert.equal(later.status, 'fulfilled', `the later dispatch was refused: ${later.reason?.code} ${later.reason?.message}`);
    assert.equal(spawned.length, 1, 'the later dispatch started no command');
  });
});

// Each case's counterexample clears the dispatch's read sign once a start-time read cannot match a
// tracked pid, though no successful whole-table read shows that pid is another process.
// proves R-STATE-32
test('C3 C4 C7 C8 C10: a start keeps a read sign while no whole-table read shows a tracked pid it could not match is another process', { timeout: 20_000 }, async (t) => {
  const cases = {
    'C3 other start, unreadable whole-table start': { pids: ['other'], unreadable: [0] },
    'C3 failed start read, unreadable whole-table start': { pids: ['other'], start: 'failed', unreadable: [0] },
    'C3 unreadable starts in both reads': { pids: ['other'], start: 'unreadable', unreadable: [0] },
    'C4 failed start read, failed whole table': { pids: ['other'], start: 'failed', whole: 'failed' },
    'C4 unreadable start read, failed whole table': { pids: ['other'], start: 'unreadable', whole: 'failed' },
    'C7 one pid reused, one unreadable in the whole table': { pids: ['other', 'other'], unreadable: [1] },
    'C8 other start, failed whole table': { pids: ['other'], whole: 'failed' },
    'C10 failed start read, recorded start in the whole table': { pids: ['recorded'], start: 'failed' },
    'C10 unreadable start read, recorded start in the whole table': { pids: ['recorded'], start: 'unreadable' },
  };
  for (const [name, cell] of Object.entries(cases)) await t.test(name, async (t) => {
    const { world, ran, later, spawned } = await readSignOver(t, cell);
    assert.equal(ran.status, 'rejected', 'the start went ahead');
    assert.ok(ran.reason.signs?.some((sign) => sign.kind === 'read' && sign.dispatch === 'd-reused' && sign.reason === CENSUS_FAILED), `the start's signs lost the dispatch's read sign: ${JSON.stringify(ran.reason.signs)}`);
    const held = readGroups(world.directory).find(({ dispatch }) => dispatch === 'd-reused');
    assert.ok(held?.unread?.some(({ kind, reason }) => kind === 'dispatch' && reason === CENSUS_FAILED), 'the record lost the dispatch read sign');
    assert.equal(later.status, 'rejected', 'the later dispatch was not refused');
    assert.equal(later.reason.code, 'SIGN_STOPPED');
    assert.equal(spawned.length, 0, 'the later dispatch started a command');
  });
});
