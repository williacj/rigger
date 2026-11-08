// ABOUTME: The stand-in world for exit cleanup against its fixed budget: a host whose process table
// and clock a test sets, and each Table X case of #1240 as its plan and its assertions. The real
// caller in `test/exit-cleanup.test.mjs` and the in-process tests in `test/exit-budget.test.mjs` share it.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { dispatch } from '../src/execution/run.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { realHost } from '../src/substrate/host.mjs';
// Read through the namespace so that `proof:diff` gets a verdict on each test at the merge base.
import * as adapter from '../src/substrate/process.mjs';

const { EXIT_BOUND, EXIT_CARE_BOUND, READ_TIMEOUT } = adapter;

/** The group of the dispatch labelled `label`, as the world numbers them. */
export const groupOf = (label) => label * 1_000;

/** How far into its timeout a read answers at `speed`: never past it, so it always answers. */
function taken(speed, timeout) {
  const short = timeout > 1 ? timeout - 1 : timeout;
  if (speed === 'last') return short;
  if (speed === 'half') return Math.min(short, Math.ceil(timeout / 2));
  if (speed === 'tenth') return Math.min(short, Math.ceil(timeout / 10));
  return Math.min(short, speed ?? 5);
}

/**
 * The world for `plan` in `directory`, a real path, with `sink` as L5's. `plan.groups` holds one
 * item for each dispatch it starts through L1's function.
 *
 * Its host's process table is a stand-in: `table` holds each process, and its reads answer in the
 * forms `src/substrate/process.mjs` documents from `ps` and `lsof` (`census`, `listing`, `emptied`,
 * `startsIn`). Each group is its leader and a child, with a survivor working in its workspace and
 * one in its scratch directory where `survivors` is set. Each `plan.groups` item can also say:
 *
 * - `speed`: how far into its timeout each of this group's reads answers: `last`, one millisecond
 *   short of it; `half` or `tenth` of it; or a number of milliseconds. Five milliseconds if unset.
 * - `outlives`: which of `member` and `survivors` the kill does not end.
 * - `silent`: that the read just before the kill lists nothing, though signal 0 reaches the group.
 * - `hung`: that `ps` never answers once a read of this group is made: each read takes its timeout.
 * - `spent`: where the clock stands, from the cleanup's start, once the listing of this group's
 *   scratch directory, its last read where it has no survivors, has answered. Time can pass between
 *   reads, so the jump is the host's and not a read's.
 * - `emptied`: that the group is gone by the exit, its command reaped with the exit code 3.
 * - `contained`: that the call has emptied the group and is reading its output as the exit comes.
 * - `finishes`: that the dispatch runs to its end before the exit, so the cleanup does not hold it.
 */
export function budgetWorld(directory, plan, sink) {
  const state = join(directory, 'state');
  const within = (name, label) => { const path = join(directory, `${name}.${label}`); mkdirSync(path, { recursive: true }); return path; };
  const turn = () => new Promise((resolve) => { setImmediate(resolve); });

  let now = 1_000_000;
  let exiting = false;
  let began;
  let current;
  const groups = new Map((plan.groups ?? []).map((group) => [groupOf(group.label), group]));
  const table = new Map();
  const signals = [];
  const reads = [];
  const schedules = [];
  const listings = new Map();
  const children = new Map();
  const started = new Map();
  // Under a hung table a read L0 gives up on at once moves no stand-in clock, and L0 retries on the
  // clock's word, so each look at the clock costs a millisecond there, as it costs some on a real host.
  const clock = { now: () => (exiting && groups.get(current)?.hung ? ++now : now), pause: async () => {}, schedule: (done, delay) => { schedules.push(delay); return {}; }, cancel: () => {} };

  const add = (pid, group, name, cwd, outlives) => table.set(pid, { pid, group, name, cwd, outlives, state: 'S', xstat: '0' });
  for (const [group, { label, survivors, outlives = [] }] of groups) {
    add(group, group, 'stand-in', undefined, false);
    add(group + 1, group, 'stand-in', undefined, outlives.includes('member'));
    if (!survivors) continue;
    add(group + 2, 0, 'left', within('work', label), outlives.includes('survivors'));
    add(group + 3, 0, 'left', within('scratch', label), outlives.includes('survivors'));
  }

  function signal(target, name) {
    if (name !== 0) signals.push({ target, name, at: now - (began ?? now) });
    const reached = [...table.values()].filter((each) => (target < 0 ? each.group === -target : each.pid === target));
    if (reached.length === 0) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    for (const each of reached) {
      if (name === 'SIGSTOP') each.state = 'T';
      if (name === 'SIGCONT') each.state = 'S';
      if (name !== 'SIGKILL' || each.outlives) continue;
      if (each.group === 0) table.delete(each.pid);
      else Object.assign(each, { state: 'Z', xstat: '9' });
    }
  }

  /** What a read of the table prints: its last argument names the columns, as every read's does. */
  function answer(tool, args) {
    const pidsAt = args.indexOf('-p');
    const pids = pidsAt === -1 ? undefined : args[pidsAt + 1].split(',').map(Number);
    if (tool === realHost.lsof) {
      const lines = [...table.values()].filter((each) => each.cwd !== undefined && (pids === undefined || pids.includes(each.pid)))
        .flatMap((each) => [`p${each.pid}`, `u${realHost.uid()}`, `n${each.cwd}`]);
      return lines.length === 0 ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
    }
    const at = args.indexOf('-g');
    const group = at === -1 ? undefined : Number(args[at + 1]);
    const columns = args.at(-1);
    if (group !== undefined) current = group;
    if (group !== undefined && columns === 'pid=,stat=' && !args.includes('-ww') && groups.get(group)?.silent) return { status: 0, stdout: '', stderr: '' };
    const rows = [...table.values()].filter((each) => (group === undefined ? pids.includes(each.pid) : each.group === group)).map((each) => ({
      'ucomm=': each.name,
      'lstart=': 'Thu Oct 29 12:00:00 2026',
      'pid=,stat=': `${each.pid} ${each.state}`,
      'pid=,stat=,xstat=': `${each.pid} ${each.state} ${each.xstat}`,
      'pid=,stat=,lstart=': `${each.pid} ${each.state} Thu Oct 29 12:00:00 2026`,
      'pid=,command=': `${each.pid} ${each.name} --held`,
    }[columns]));
    return rows.length === 0 ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: `${rows.join('\n')}\n`, stderr: '' };
  }

  function spawnSync(tool, args, { timeout }) {
    const printed = answer(tool, args);
    if (!exiting) return printed;
    const plain = tool === realHost.lsof ? 'lsof' : 'ps';
    const { speed, hung, spent } = groups.get(current) ?? {};
    if (hung && plain === 'ps') {
      now += timeout;
      reads.push({ tool: plain, args, group: current, hung: true });
      return { status: null, signal: 'SIGKILL', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
    }
    now += taken(speed, timeout);
    reads.push({ tool: plain, args, group: current });
    if (plain === 'lsof' && spent !== undefined) {
      listings.set(current, (listings.get(current) ?? 0) + 1);
      if (listings.get(current) === 2) now = began + spent;
    }
    return printed;
  }

  function execFile(tool, args, options, done) {
    const { stdout } = answer(tool, args);
    setImmediate(() => done(null, stdout, ''));
    return {};
  }

  function spawn(command, [label]) {
    const pid = groupOf(Number(label));
    const child = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
    children.set(pid, child);
    return child;
  }

  const host = { ...realHost, clock, signal, spawn, spawnSync, execFile, killChild: () => {} };

  /** Starts the dispatch labelled `label` on `on`, by default this world's host. */
  const start = (label, { command = '/usr/bin/true', on = host } = {}) => dispatch({
    id: `d-${label}`, card: label, directory: state, sink, command, args: [String(label)], env: {}, timeout: 600_000, host: on, clock: () => 0,
    cwd: within('work', label), workspace: within('work', label), scratch: within('scratch', label),
  });

  /** Empties `group` of the table, so that signal 0 no longer reaches it. */
  const emptyOf = (group) => { for (const [pid, each] of table) if (each.group === group) table.delete(pid); };

  /** Starts every dispatch of the plan, and settles once each stands as the plan says at the exit. */
  async function settled() {
    for (const { label } of groups.values()) {
      const running = start(label);
      running.catch(() => {});
      started.set(groupOf(label), running);
    }
    while (readGroups(state).length < groups.size) await turn();
    for (const [group, { emptied, contained, finishes }] of groups) {
      if (!emptied && !contained && !finishes) continue;
      emptyOf(group);
      const child = children.get(group);
      child.exitCode = emptied ? 3 : 0;
      if (emptied) continue;
      child.emit('exit', 0, null);
      if (!finishes) continue;
      child.stdout.destroy();
      child.stderr.destroy();
      await started.get(group);
      await turn();
      await turn();
    }
    if ([...groups.values()].some(({ contained }) => contained)) while (!schedules.includes(adapter.OUTPUT_BOUND)) await turn();
  }

  return {
    host,
    start,
    settled,
    /** Marks the exit's start, from which the world counts its clock and its reads. */
    exit() { exiting = true; began = now; },
    /** What a dead process's parent does: every zombie of the world is reaped. */
    reap() { for (const [pid, { state: at }] of table) if (at === 'Z') table.delete(pid); },
    logRead: (read) => { if (exiting) reads.push(read); },
    report: () => ({ reads, signals, elapsed: now - (began ?? now), left: [...table.values()] }),
  };
}

const endsOf = (events, id) => events.filter(({ event, dispatch: of }) => event === 'dispatch.end' && of === id);

/** Row X5: the sink took one `dispatch.end` for each of `labels`. */
export function assertAllEnded({ events, stderr }, labels) {
  for (const label of labels) assert.equal(endsOf(events, `d-${label}`).length, 1, `dispatch d-${label} has no one end: ${stderr}`);
}

/** Dispatch `label` had the bare kill: one group SIGKILL, one record of it, no read, no sweep, its entry kept. */
function assertBare({ events, record, signals, reads, left }, label) {
  const group = groupOf(label);
  const d = `d-${label}`;
  assert.deepEqual(signals.filter(({ target }) => Math.abs(target) >= group && Math.abs(target) < group + 1_000).map(({ target, name }) => [target, name]), [[-group, 'SIGKILL']], `${d} was not sent the one bare kill`);
  assert.deepEqual(reads.filter((each) => each.group === group), [], `${d}'s group was read`);
  const kills = events.filter(({ dispatch: id, event }) => id === d && event !== 'dispatch.start' && event !== 'dispatch.end');
  assert.deepEqual(kills.map(({ event, group: killed }) => [event, killed]), [['group.killed', group]], `${d}'s only kill record is not the group's`);
  assert.match(kills[0].census, /15000 ms/);
  const [end] = endsOf(events, d);
  assert.match(end.unread, /15000 ms/, JSON.stringify(end));
  assert.doesNotMatch(end.unread, /undefined/);
  assert.match(end.kept, new RegExp(`kept the entry for group ${group}`), JSON.stringify(end));
  assert.equal(record.filter(({ dispatch: id }) => id === d).length, 1, `${d}'s entry was not kept`);
  assert.equal(left.filter(({ pid }) => pid === group + 2 || pid === group + 3).length, 2, `${d}'s directories were swept`);
}

/** Dispatch `label` had its census and sweep: no group kill recorded for the budget, and its entry gone. */
function assertCareful({ events, record }, label) {
  const d = `d-${label}`;
  assert.deepEqual(events.filter(({ dispatch: id, census }) => id === d && /15000 ms/.test(census ?? '')), [], `${d} had the bare kill`);
  assert.equal(endsOf(events, d)[0].kept, undefined);
  assert.deepEqual(record.filter(({ dispatch: id }) => id === d), [], `${d}'s entry was kept`);
}

const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Each Table X case: what `run`, which takes a plan and hands back what it left, must show. */
export const BUDGET = {
  noGroup(ran) {
    assert.deepEqual(ran.reads, []);
    assert.deepEqual(ran.signals, []);
    assertAllEnded(ran, [1]);
    assert.equal(endsOf(ran.events, 'd-1')[0].exit, 0);
    assert.deepEqual(ran.record, []);
  },
  nineOrdinary(run) {
    const ran = run({ groups: NINE.map((label) => ({ label, survivors: true })) });
    assert.ok(ran.elapsed < EXIT_CARE_BOUND, `the nine took ${ran.elapsed} ms`);
    assertAllEnded(ran, NINE);
    for (const label of NINE) {
      assertCareful(ran, label);
      const survivors = ran.events.filter(({ dispatch: id, event }) => id === `d-${label}` && event === 'survivor.killed');
      assert.deepEqual(survivors.map(({ pid }) => pid).sort(), [groupOf(label), groupOf(label) + 1, groupOf(label) + 2, groupOf(label) + 3], `d-${label}'s census and sweep`);
      assert.equal(endsOf(ran.events, `d-${label}`)[0].exit, 137);
    }
    assert.deepEqual(ran.left.filter(({ state }) => state !== 'Z'), []);
  },
  stuckGroup(run) {
    const ran = run({ groups: [{ label: 1, speed: 500, survivors: true, outlives: ['member', 'survivors'] }, { label: 2, survivors: true }, { label: 3, survivors: true }] });
    assert.ok(ran.elapsed >= EXIT_CARE_BOUND, `the stuck group took ${ran.elapsed} ms, so it spent no budget`);
    assertAllEnded(ran, [1, 2, 3]);
    assertCareful(ran, 1);
    const unended = ran.events.filter(({ dispatch: id, event }) => id === 'd-1' && event === 'survivor.unended').map(({ pid }) => pid).sort();
    assert.deepEqual(unended, [1_001, 1_002, 1_003], 'the stuck group did not finish its census and both sweeps');
    assertBare(ran, 2);
    assertBare(ran, 3);
  },
  hungOnce(run) {
    const labels = [1, 2, 3];
    const ran = run({ groups: labels.map((label) => ({ label, hung: true })) });
    assert.equal(ran.reads.filter(({ hung }) => hung).length, 1, JSON.stringify(ran.reads));
    assert.ok(ran.elapsed < EXIT_CARE_BOUND && ran.elapsed >= READ_TIMEOUT, `the hung table cost ${ran.elapsed} ms`);
    assertAllEnded(ran, labels);
    for (const label of labels) {
      assertCareful(ran, label);
      assert.deepEqual(ran.signals.filter(({ target, name }) => target === -groupOf(label) && name === 'SIGKILL').length > 0, true, `d-${label} was not killed`);
      const recorded = ran.events.filter(({ dispatch: id, event, group }) => id === `d-${label}` && event === 'group.killed' && group === groupOf(label));
      assert.equal(recorded.length, 1, `d-${label}'s group is not recorded in place of what it could not read`);
    }
  },
  hungPastBudget(run) {
    const ran = run({ groups: [{ label: 1, spent: EXIT_CARE_BOUND - 1 }, { label: 2, hung: true }, { label: 3, survivors: true }] });
    assert.equal(ran.reads.filter(({ hung }) => hung).length, 1, JSON.stringify(ran.reads));
    assertAllEnded(ran, [1, 2, 3]);
    assertCareful(ran, 1);
    assertCareful(ran, 2);
    assertBare(ran, 3);
  },
  exactBound(run) {
    assertCareful(run({ groups: [{ label: 1, spent: EXIT_CARE_BOUND - 1 }, { label: 2 }] }), 2);
    assertBare(run({ groups: [{ label: 1, spent: EXIT_CARE_BOUND }, { label: 2, survivors: true }] }), 2);
  },
  alreadyEmpty(run) {
    const ran = run({ groups: [{ label: 1, spent: EXIT_CARE_BOUND }, { label: 2, emptied: true }] });
    assert.deepEqual(ran.signals.filter(({ target }) => target === -groupOf(2)), []);
    assert.deepEqual(ran.events.filter(({ event }) => event === 'group.killed'), []);
    const [end] = endsOf(ran.events, 'd-2');
    assert.equal(end.exit, 3);
    assert.match(end.kept, /kept the entry for group 2000/);
    assert.equal(ran.record.filter(({ dispatch: id }) => id === 'd-2').length, 1);
  },
  alreadySwept(run) {
    const ran = run({ groups: [{ label: 1, spent: EXIT_CARE_BOUND }, { label: 2, contained: true }, { label: 3, survivors: true }] });
    assertAllEnded(ran, [1, 2, 3]);
    assert.deepEqual(ran.signals.filter(({ target }) => target === -groupOf(2)), []);
    assertCareful(ran, 2);
    assert.equal(endsOf(ran.events, 'd-2')[0].exit, 0);
    assertBare(ran, 3);
  },
  lastMoment(run, diagnostic) {
    const longest = [];
    for (const speed of ['last', 'half', 'tenth']) {
      for (const outlives of [['member'], ['member', 'survivors']]) {
        for (const silent of [false, true]) {
          const ran = run({ groups: [{ label: 1, speed, outlives, silent, survivors: true }] });
          const shown = JSON.stringify({ speed, outlives, silent, elapsed: ran.elapsed });
          diagnostic(shown);
          assert.ok(ran.elapsed <= EXIT_BOUND - EXIT_CARE_BOUND, shown);
          assertAllEnded(ran, [1]);
          assertCareful(ran, 1);
          assert.ok(ran.events.some(({ event, pid }) => event === 'survivor.unended' && pid === 1_001), `the member the kill does not end is not recorded as not ended: ${shown}`);
          longest.push(ran.elapsed);
        }
      }
    }
    // The premise: these reads did spend the deadlines, so the bound above was tested.
    assert.ok(Math.max(...longest) > EXIT_CARE_BOUND + READ_TIMEOUT, `the longest took ${Math.max(...longest)} ms`);
  },
};
