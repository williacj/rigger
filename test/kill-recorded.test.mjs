// ABOUTME: Tests L1's kill of recorded groups: on a start, it ends each process group a dead engine
// recorded, once L0 has confirmed the group is the one recorded, and empties the record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { killRecordedGroups } from '../src/execution/run.mjs';
import { readGroups, recordPath, writeGroups } from '../src/execution/groups.mjs';
import { alive, fixture, scratch, startGroup, startOf, until, withoutLeader } from './process-fixtures.mjs';
import { finiteDirectoryReads } from './process-fixtures.mjs';
import { heldOutput } from './process-fixtures.mjs';
import { shellQuote } from './process-fixtures.mjs';
import { PS } from '../src/substrate/process.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// A bound on the test alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on it when the call settles.
const { 20_000: SETTLES_WITHIN } = BOUNDS;
const mutableFs = createRequire(import.meta.url)('node:fs');

/** The state directory a test's record and stream live in: `.rigger/` in the scratch directory. */
const stateOf = (directory) => join(directory, '.rigger');

/** Runs L1's kill of recorded groups over the state directory in `directory`. */
function killIn(directory, options = {}) {
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return killRecordedGroups({ directory: state, sink, ...options });
}

test('given no record in the state directory, the call kills nothing, reports no failure, and creates no file', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const before = readdirSync(directory);

  await killIn(directory);

  assert.deepEqual(readdirSync(directory), before);
});

/** The record's entry for the group `started`, under dispatch `d-1` and card 1412 unless `extra` says otherwise. */
const entryFor = ({ group, started }, extra = {}) => ({ group, started, dispatch: 'd-1', card: 1412, ...extra });

// proves R-STATE-10
test('given a recorded group whose leader is alive and whose start time matches the entry, the call kills every process in the group', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  writeGroups(stateOf(directory), [entryFor(started)]);

  await killIn(directory);

  assert.equal(alive(started.leader), false, 'the leader is alive');
  assert.equal(alive(started.member), false, 'the member is alive');
});

/**
 * Each kill the stream in `directory`'s state directory recorded, as the fields a reader names it
 * by. A stream never written holds none.
 */
const killsIn = (directory) => (existsSync(streamPath(stateOf(directory))) ? readEvents(stateOf(directory)) : [])
  .filter((event) => event.event === 'recorded.killed')
  .map(({ layer, dispatch, card, pid, name, cmd }) => ({ layer, dispatch, card, pid, name, cmd }));

// proves R-STATE-10, R-STATE-12
test('given a recorded group whose leader\'s start time matches, the stream records each kill by name and command line, under the entry\'s dispatch id and card', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  writeGroups(stateOf(directory), [entryFor(started, { dispatch: 'd-7f3a', card: 77 })]);

  await killIn(directory);

  // `ps` names a script `/bin/sh` runs as `bash`, which is what runs it on macOS. The kills are
  // put in the order of their names, which differ, and not of their pids: once pids wrap, the
  // member can hold a lower pid than the leader it started under.
  const under = { layer: 'L0', dispatch: 'd-7f3a', card: 77 };
  assert.deepEqual(killsIn(directory).sort((one, other) => one.name.localeCompare(other.name)), [
    { ...under, pid: started.leader, name: process.platform === 'linux' ? 'group' : 'bash', cmd: `${process.platform === 'linux' ? '/bin/bash' : '/bin/sh'} ${join(directory, 'group')}` },
    { ...under, pid: started.member, name: 'tail', cmd: `/usr/bin/tail -f ${join(directory, 'hold')}` },
  ]);
});

test('given a recorded group id whose live leader\'s start time differs from the entry\'s, the call leaves every process of that group alive', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  // The entry names a leader that started a second before this one: an earlier group given the
  // same id, as a dead engine's entry would name once its group ended and the id was given again.
  writeGroups(stateOf(directory), [entryFor(started, { started: started.started - 1 })]);

  await killIn(directory);

  assert.equal(alive(started.leader), true, 'the leader was killed');
  assert.equal(alive(started.member), true, 'the member was killed');
});

// proves R-STATE-10
test('given a recorded group whose leader is dead and every live member of which started no earlier than the entry\'s leader, the call kills every live member', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  // What a dead engine leaves when its dispatch's leader exits while it is down: the entry names
  // the leader, and the leader's child runs on in the group.
  const started = await withoutLeader(t, await startGroup(t, directory, 'group'));
  writeGroups(stateOf(directory), [entryFor(started)]);

  await killIn(directory);

  assert.equal(alive(started.member), false, 'the member is alive');
});

test('given a recorded group whose leader is dead and a live member of which started before the entry\'s leader, the call leaves every member alive', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await withoutLeader(t, await startGroup(t, directory, 'group'));
  // The entry names a leader that started a second after the member did, so the member cannot
  // descend from it.
  writeGroups(stateOf(directory), [entryFor(started, { started: startOf(started.member) + 1 })]);

  await killIn(directory);

  assert.equal(alive(started.member), true, 'the member was killed');
});

test('the wrong kill the leaderless rule admits: given a fabricated entry naming a leaderless group the test started outside Rigger, whose members started after the entry\'s start, the call kills those members', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  // Rigger never started this group: the test did, and made its leader exit. The entry stands in
  // for one a dead engine wrote for an earlier group given the same id, whose leader started a
  // minute before this group's. Every member here started after that, so the rule kills them.
  const foreign = await withoutLeader(t, await startGroup(t, directory, 'foreign'));
  writeGroups(stateOf(directory), [entryFor(foreign, { started: foreign.started - 60, dispatch: 'd-fabricated' })]);

  await killIn(directory);

  assert.equal(alive(foreign.member), false, 'the rule did not kill the member of a group Rigger did not start');
});

/** The pid of a process that has run and been reaped, so no process or group holds it now. */
async function reapedPid() {
  const ended = spawn('/usr/bin/true', [], { detached: true, stdio: 'ignore' });
  await once(ended, 'exit');
  return ended.pid;
}

/**
 * A process group whose one member is a zombie: Perl forks, the fork makes a group of its own and
 * exits, and Perl, outside that group, never reaps it. Perl writes the fork's pid unbuffered, or a
 * pipe would hold it until Perl exits. Perl carries `directory` in its command
 * line, so the teardown ends it, and the system then reaps the zombie. Settles once `ps` reads the
 * fork as a zombie leading its own group, on the group's id, or rejects once the test `t` ends
 * first.
 */
async function zombieGroup(t, directory) {
  const parent = spawn('/usr/bin/perl', ['-e', '$| = 1; my $p = fork(); if ($p == 0) { setpgrp(0, 0); exit 0 } print "$p\\n"; <STDIN>;', directory], { env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
  let printed = '';
  parent.stdout.on('data', (chunk) => { printed += chunk; });
  await until(() => printed.endsWith('\n'), t);
  const group = Number(printed);
  await until(() => /^Z\S*\s+(\d+)$/.exec(spawnSync('/bin/ps', ['-o', 'stat=,pgid=', '-p', String(group)], { encoding: 'utf8' }).stdout.trim())?.[1] === String(group), t);
  return group;
}

test('given a recorded group that holds only an unreaped zombie, the call settles, records no kill, and clears its entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const group = await zombieGroup(t, directory);
  writeGroups(stateOf(directory), [{ group, started: startOf(group), dispatch: 'd-zombie', card: 1412 }]);

  await killIn(directory);

  assert.deepEqual(killsIn(directory), []);
  assert.deepEqual(readGroups(stateOf(directory)), []);
});

/** `ps`'s state and process group for `pid`, or nothing where no process has it. */
function psRowOf(pid) {
  const row = /^(\S+)\s+(\d+)$/.exec(spawnSync('/bin/ps', ['-o', 'stat=,pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
  return row ? { state: row[1], group: Number(row[2]) } : undefined;
}

/**
 * A process group led by a zombie, holding a live member that started before it: the case in
 * which an older process joins a later leader's group in the same session, and the leader then
 * exits unreaped. Perl, outside the group, forks the older member first, and waits until the
 * clock's second has turned, so `ps` reads the two starts apart. It then forks the leader, which
 * makes the group. The older member joins it and runs `tail` on a file nothing writes to, and the
 * leader exits once it has joined. Perl never reaps either. Every process carries `directory` in
 * its command line, so the teardown ends them. Settles once `ps` reads the leader as a zombie
 * leading the group and the older member in it, on the group's id and the member's pid, or rejects
 * once the test `t` ends first.
 */
async function zombieLedGroup(t, directory) {
  writeFileSync(join(directory, 'hold'), '');
  const program = [
    '$| = 1;',
    'pipe(my $toMember, my $fromParent) or die; pipe(my $toLeader, my $fromMember) or die;',
    'my $member = fork() // die;',
    'if ($member == 0) {',
    '  my $leader = <$toMember>; chomp $leader;',
    '  setpgrp(0, $leader) or die "join: $!";',
    '  syswrite($fromMember, "joined\\n");',
    '  exec("/usr/bin/tail", "-f", "$ARGV[0]/hold") or die;',
    '}',
    // Cross an additional clock boundary on Linux so ps distinguishes the two starts.
    `my $first = time(); 1 while time() <= $first + ${process.platform === 'linux' ? 1 : 0};`,
    'my $leader = fork() // die;',
    'if ($leader == 0) { setpgrp(0, 0); <$toLeader>; exit 0 }',
    'setpgrp($leader, $leader);',
    'syswrite($fromParent, "$leader\\n");',
    'print "$leader $member\\n";',
    '<STDIN>;',
  ].join('\n');
  const parent = spawn('/usr/bin/perl', ['-e', program, directory], { env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
  let printed = '';
  parent.stdout.on('data', (chunk) => { printed += chunk; });
  await until(() => printed.endsWith('\n'), t);
  const [group, member] = printed.trim().split(' ').map(Number);
  await until(() => psRowOf(group)?.state.startsWith('Z') && psRowOf(group)?.group === group && psRowOf(member)?.group === group && !psRowOf(member)?.state.startsWith('Z'), t);
  return { group, member };
}

test('given a recorded group whose leader is an unreaped zombie and a live member of which started before the entry\'s leader, the call leaves the member alive and records no kill', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const { group, member } = await zombieLedGroup(t, directory);
  // The entry names the zombie leader's own start, so only its being dead tells the case apart.
  writeGroups(stateOf(directory), [{ group, started: startOf(group), dispatch: 'd-zombie-led', card: 1412 }]);
  assert.ok(startOf(member) < startOf(group), 'the member did not start before the leader');

  await killIn(directory);

  // Perl never reaps the member, so a member killed stays a zombie, which signal 0 still reaches.
  assert.equal(alive(member) && !psRowOf(member).state.startsWith('Z'), true, 'the member that started before the leader was killed');
  assert.deepEqual(killsIn(directory), []);
  // A group the call leaves alone loses its entry, as #340's acceptance has it for every such group.
  assert.deepEqual(readGroups(stateOf(directory)), []);
});

test('given a recorded group with no live process, the call kills nothing and records no kill', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const bystander = await startGroup(t, directory, 'bystander');
  const group = await reapedPid();
  writeGroups(stateOf(directory), [{ group, started: bystander.started, dispatch: 'd-1', card: 1412 }]);

  await killIn(directory);

  assert.equal(alive(bystander.member), true, 'a process no entry names was killed');
  assert.deepEqual(killsIn(directory), []);
  assert.deepEqual(readGroups(stateOf(directory)), []);
});

test('after the call returns, the record holds no entry whose group it confirmed dead or left alone', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const killed = await startGroup(t, directory, 'killed');
  const leaderless = await withoutLeader(t, await startGroup(t, directory, 'leaderless'));
  const mismatched = await startGroup(t, directory, 'mismatched');
  const older = await withoutLeader(t, await startGroup(t, directory, 'older'));
  const empty = await reapedPid();
  writeGroups(stateOf(directory), [
    entryFor(killed),
    entryFor(leaderless),
    entryFor(mismatched, { started: mismatched.started - 1 }),
    entryFor(older, { started: startOf(older.member) + 1 }),
    { group: empty, started: killed.started, dispatch: 'd-empty' },
  ]);

  await killIn(directory);

  assert.equal(alive(killed.member) || alive(leaderless.member), false, 'a confirmed group is alive');
  assert.equal(alive(mismatched.member) && alive(older.member), true, 'a group left alone was killed');
  assert.deepEqual(readGroups(stateOf(directory)), []);
});

/**
 * Leaves in `directory`'s state directory what a record writer stopped before its rename leaves:
 * the partial file, torn part-way through an entry, beside the record as it was before the write.
 */
function leavePartial(directory) {
  const state = stateOf(directory);
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'groups.json.partial'), '[{"group":');
}

test('given a leftover partial record beside a record holding no entry, or beside no record, the call leaves no partial record in the state directory', SETTLES_WITHIN, async (t) => {
  for (const record of ['[]', undefined]) {
    const directory = scratch(t);
    leavePartial(directory);
    if (record !== undefined) writeFileSync(join(stateOf(directory), 'groups.json'), record);

    await killIn(directory);

    assert.deepEqual(readdirSync(stateOf(directory)).filter((file) => file.startsWith('groups.json')), record === undefined ? [] : ['groups.json'], `with the record ${record}`);
  }
});

test('given a leftover partial record beside a record holding an entry, the call kills the entry\'s group, clears its entry, and leaves no partial record', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  writeGroups(stateOf(directory), [entryFor(started)]);
  leavePartial(directory);

  await killIn(directory);

  assert.equal(alive(started.leader) || alive(started.member), false, 'a process of the recorded group is alive');
  assert.deepEqual(readGroups(stateOf(directory)), []);
  assert.deepEqual(readdirSync(stateOf(directory)).filter((file) => file.startsWith('groups.json')), ['groups.json']);
});

/**
 * The L1 events in the stream in `directory`'s state directory recording a partial record the
 * call could not remove, as the fields a reader names them by.
 */
const partialsKeptIn = (directory) => readEvents(stateOf(directory))
  .filter((event) => event.event === 'record.partial-kept')
  .map(({ layer, path, reason }) => ({ layer, path, reason: typeof reason }));

/**
 * The two partial records a start cannot remove: a file in a state directory that refuses writes,
 * and a directory where the file would be. The stream exists beforehand, so the sink appends to
 * it in either.
 */
const UNREMOVABLE = {
  'where the state directory refuses writes': (state, t) => {
    writeFileSync(join(state, 'groups.json.partial'), '[{"group":');
    chmodSync(state, 0o555);
    t.after(() => chmodSync(state, 0o755));
  },
  'where the partial record is a directory': (state) => mkdirSync(join(state, 'groups.json.partial')),
};

for (const [unremovable, leave] of Object.entries(UNREMOVABLE)) {
  test(`given a leftover partial record the call cannot remove, ${unremovable}, beside a record holding an entry, the call still kills the entry's group, and records why the partial record stayed`, SETTLES_WITHIN, async (t) => {
    const directory = scratch(t);
    const state = stateOf(directory);
    const started = await startGroup(t, directory, 'group');
    writeGroups(state, [entryFor(started)]);
    writeFileSync(streamPath(state), '');
    leave(state, t);

    await killIn(directory).catch(() => {});

    assert.equal(alive(started.leader) || alive(started.member), false, 'a process of the recorded group is alive');
    assert.deepEqual(partialsKeptIn(directory), [{ layer: 'L1', path: join(state, 'groups.json.partial'), reason: 'string' }]);
  });
}

/** Reads only the scratch-path and recorded-PID process-table answers after the target's teardown. */
function targetProcessTable(directories, identities) {
  const options = { encoding: 'utf8', timeout: 20_000, env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' } };
  const pattern = directories.map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pathsStarted = performance.now();
  const paths = spawnSync('/usr/bin/pgrep', ['-fl', pattern], options);
  const pathsElapsed = performance.now() - pathsStarted;
  const pids = [...new Set(identities.map(({ pid }) => pid))];
  const processesStarted = performance.now();
  const processes = spawnSync('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,lstart=,command='], options);
  const processesElapsed = performance.now() - processesStarted;
  const pathAnswer = { command: '/usr/bin/pgrep -fl <scratch paths>', boundMs: 20_000, elapsedMs: pathsElapsed, status: paths.status, error: paths.error?.message ?? null, errorCode: paths.error?.code ?? null, signal: paths.signal, output: paths.stdout ?? '', stderr: paths.stderr ?? '' };
  const pidAnswer = { command: '/bin/ps -p <recorded pids> -o pid=,lstart=,command=', boundMs: 20_000, elapsedMs: processesElapsed, status: processes.status, error: processes.error?.message ?? null, errorCode: processes.error?.code ?? null, signal: processes.signal, output: processes.stdout ?? '', stderr: processes.stderr ?? '' };
  return classifyProcessAnswers(pathAnswer, pidAnswer, directories, identities);
}

/** Classifies only complete, interpretable answers as empty or as a named survivor. */
function classifyProcessAnswers(pathAnswer, pidAnswer, directories, identities) {
  const answers = [pathAnswer, pidAnswer];
  if (answers.some(({ errorCode, elapsedMs, boundMs }) => errorCode === 'ETIMEDOUT' || elapsedMs > boundMs)) return { outcome: 'N', pathAnswer, pidAnswer };
  const valid = (answer) => answer.error === null && answer.signal === null && answer.stderr === '' && (answer.status === 0 || (answer.status === 1 && answer.output === ''));
  if (directories.length === 0 || identities.length === 0 || answers.some((answer) => !valid(answer))) return { outcome: 'R', pathAnswer, pidAnswer };
  const pathLines = pathAnswer.output.split('\n').filter((line) => line !== '');
  const pidLines = pidAnswer.output.split('\n').filter((line) => line !== '');
  if ((pathAnswer.status === 0 && pathLines.length === 0) || (pidAnswer.status === 0 && pidLines.length === 0)) return { outcome: 'R', pathAnswer, pidAnswer };
  const matchedPaths = pathLines.map((line) => /^\s*\d+\s+(.+)$/.exec(line)?.[1]).map((command) => directories.find((directory) => command?.includes(directory)));
  if (matchedPaths.some((path) => path === undefined)) return { outcome: 'R', pathAnswer, pidAnswer };
  const sameStart = [];
  for (const line of pidLines) {
    const row = /^\s*(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
    const identity = identities.find(({ pid }) => pid === Number(row?.[1]));
    const started = row && Date.parse(`${row[2]} UTC`) / 1000;
    if (!row || !identity || !Number.isInteger(started) || row[3].trim() === '') return { outcome: 'R', pathAnswer, pidAnswer };
    if (started === identity.started) sameStart.push({ pid: identity.pid, started, command: row[3] });
  }
  return { outcome: matchedPaths.length > 0 || sameStart.length > 0 ? 'S' : 'E', pathAnswer, pidAnswer, matchedPath: matchedPaths[0] ?? null, sameStart };
}

/** Applies the target's teardown/read disposition after the process-table answers arrive. */
function targetTeardownCell(target, teardown, read) {
  const cell = `${target}-${teardown}-${read.outcome}`;
  if ((target === 'P' || target === 'A') && teardown === 'T' && read.outcome === 'E') return { cell, disposition: 'proves absence' };
  if (read.outcome === 'S') return { cell, disposition: 'fails' };
  if (read.outcome === 'R' || read.outcome === 'N') return { cell, disposition: 'return to author' };
  if (teardown === 'F' && read.outcome === 'E') return { cell, disposition: 'fails' };
  throw new Error(`unclassified teardown cell ${cell}`);
}

test('a process-table no-match status with stderr cannot prove absence', () => {
  const empty = { status: 1, output: '', stderr: '', error: null, errorCode: null, signal: null };
  const observed = classifyProcessAnswers({ ...empty, stderr: 'pgrep warning' }, empty, [join(tmpdir(), 'c595-read')], [{ pid: 417, started: 1_792_151_200 }]);
  assert.equal(observed.outcome, 'R');
});

test('process-table rows name a survivor only after complete status and start-identity checks', () => {
  const directory = join(tmpdir(), 'c595-read');
  const empty = { boundMs: 20_000, elapsedMs: 1, status: 1, output: '', stderr: '', error: null, errorCode: null, signal: null };
  const started = Date.parse('Fri Oct 16 09:00:00 2026 UTC') / 1000;
  const identities = [{ pid: 417, started }];
  const row = `417 Fri Oct 16 09:00:00 2026 /bin/tail ${directory}/hold\n`;
  assert.equal(classifyProcessAnswers(empty, { ...empty, status: 0, output: '417 unreadable\n' }, [directory], identities).outcome, 'R', 'an uninterpretable PID row proved absence');
  const byPath = classifyProcessAnswers({ ...empty, status: 0, output: `417 /bin/tail ${directory}/hold\n` }, empty, [directory], identities);
  assert.deepEqual([byPath.outcome, byPath.matchedPath], ['S', directory], 'a named scratch-path survivor was lost');
  const byIdentity = classifyProcessAnswers(empty, { ...empty, status: 0, output: row }, [directory], identities);
  assert.deepEqual([byIdentity.outcome, byIdentity.sameStart[0]?.pid], ['S', 417], 'a same-start PID survivor was lost');
  assert.equal(classifyProcessAnswers(empty, { ...empty, status: 0, output: row }, [directory], [{ pid: 417, started: started - 1 }]).outcome, 'E', 'a reused PID with another start was treated as the recorded process');
  assert.equal(classifyProcessAnswers({ ...empty, errorCode: 'ETIMEDOUT', elapsedMs: 20_000, status: null }, empty, [directory], identities).outcome, 'N', 'an unanswered read proved absence');
});

/** Controlled, status-checked answers for each post-teardown observation class. */
function controlledTableRead(kind, scratchPath) {
  const empty = { command: '/bin/ps -p <recorded pids> -o pid=,lstart=,command=', boundMs: 20_000, elapsedMs: 1, status: 1, error: null, signal: null, output: '', stderr: '' };
  const path = { ...empty, command: '/usr/bin/pgrep -fl <scratch paths>' };
  if (kind === 'E') return { outcome: 'E', pathAnswer: path, pidAnswer: empty, sameStart: [] };
  if (kind === 'S') return { outcome: 'S', pathAnswer: { ...path, status: 0, output: `417 ${scratchPath}/hold\n` }, pidAnswer: empty, sameStart: [], matchedPath: scratchPath };
  if (kind === 'R') return { outcome: 'R', pathAnswer: { ...path, status: 2, stderr: 'pgrep failed' }, pidAnswer: empty };
  return { outcome: 'N', pathAnswer: { ...path, status: null, error: 'ETIMEDOUT', elapsedMs: 20_000 }, pidAnswer: empty };
}

for (const [target, teardown, expected] of [
  ['P', 'T', ['proves absence', 'fails', 'return to author', 'return to author']],
  ['A', 'T', ['proves absence', 'fails', 'return to author', 'return to author']],
  ['P', 'F', ['fails', 'fails', 'return to author', 'return to author']],
  ['A', 'F', ['fails', 'fails', 'return to author', 'return to author']],
]) {
  for (const [index, kind] of ['E', 'S', 'R', 'N'].entries()) {
    const cell = `${target}-${teardown}-${kind}`;
    test(`${cell} classifies controlled teardown and process-table answers`, () => {
      const scratchPath = join(tmpdir(), 'c595-controlled-process-cell');
      const beforeAfter = [{ directory: scratchPath, before: true, remains: teardown === 'F' }];
      const identities = [{ role: 'leader', pid: 417, started: 1_792_151_200 }, { role: 'member', pid: 418, started: 1_792_151_200 }];
      const teardownResult = { outcome: teardown, error: teardown === 'F' ? 'scratch sweep failed' : null };
      const observed = controlledTableRead(kind, scratchPath);
      assert.equal(beforeAfter[0].before, true, `${cell}: scratch path was not present before teardown`);
      assert.equal(beforeAfter[0].remains, teardown === 'F', `${cell}: teardown outcome and after path disagree`);
      assert.deepEqual(identities.map(({ role }) => role), ['leader', 'member'], `${cell}: process identities are missing`);
      assert.equal(observed.pathAnswer.boundMs, 20_000, `${cell}: path read is unbounded`);
      assert.equal(observed.pidAnswer.boundMs, 20_000, `${cell}: PID read is unbounded`);
      if (kind === 'E') assert.deepEqual([observed.pathAnswer.status, observed.pidAnswer.status, observed.pathAnswer.output, observed.pidAnswer.output], [1, 1, '', ''], `${cell}: an unavailable read was counted as empty`);
      if (kind === 'S') assert.equal(observed.matchedPath, scratchPath, `${cell}: survivor path was not identified`);
      if (kind === 'R') assert.deepEqual([observed.pathAnswer.status, observed.pathAnswer.stderr], [2, 'pgrep failed'], `${cell}: read failure was lost`);
      if (kind === 'N') assert.deepEqual([observed.pathAnswer.status, observed.pathAnswer.error, observed.pathAnswer.elapsedMs], [null, 'ETIMEDOUT', 20_000], `${cell}: unanswered read lacks its deadline`);
      assert.deepEqual(targetTeardownCell(target, teardownResult.outcome, observed), { cell, disposition: expected[index] }, `${cell}: wrong disposition`);
      console.log(`C595_CELL ${JSON.stringify({ cell, target, teardown: teardownResult, beforeAfter, identities, read: observed, disposition: expected[index] })}`);
    });
  }
}

/** Adds finite directory reads to the realpath work inside one scratch(t) call. */
function scratchWithFiniteWork(t, reads, deadline, report) {
  const original = mutableFs.realpathSync;
  let exercised = false;
  mutableFs.realpathSync = (path, ...options) => {
    if (!exercised && typeof path === 'string' && path.startsWith(`${tmpdir()}/`)) {
      exercised = true;
      finiteDirectoryReads(path, reads, deadline, report, 'scratch.work');
    }
    return original(path, ...options);
  };
  syncBuiltinESMExports();
  try {
    const directory = scratch(t);
    assert.equal(exercised, true, 'finite work did not run inside scratch(t)');
    return directory;
  } finally {
    mutableFs.realpathSync = original;
    syncBuiltinESMExports();
  }
}

/** The C1 pre-write position with one shared test deadline and no record yet. */
function c0(t) {
  const began = performance.now();
  const content = '[{"group": 4242, "sta';
  const beforeScratchElapsed = performance.now() - began;
  const beforeScratch = 20_000 - beforeScratchElapsed;
  const scratchEntered = performance.now();
  const directory = scratch(t);
  const scratchDuration = performance.now() - scratchEntered;
  const beforeStartElapsed = performance.now() - began;
  const beforeStart = 20_000 - beforeStartElapsed;
  assert.ok(beforeScratch > 0 && beforeStart > 0 && beforeStart <= beforeScratch, 'P1-C0(1): scratch exhausted the shared deadline');
  assert.ok(directory.startsWith(`${tmpdir()}/`) && existsSync(directory), 'P1-C0(1): scratch did not return a usable TMPDIR directory');
  console.log(`C595_CELL ${JSON.stringify({ cell: 'P1-C0(1)', position: 1, content, readinessOnly: true, completedPrefix: [], directory, beforeScratchElapsed, beforeScratch, scratchDuration, beforeStartElapsed, beforeStart })}`);
  return { began, content, beforeScratchElapsed, beforeScratch, scratchDuration, directory, beforeStartElapsed, beforeStart };
}

test('P2-C0(8) finite filesystem work stays inside the scratch call and returns a usable directory', SETTLES_WITHIN, (t) => {
  const events = [];
  const originalRealpath = mutableFs.realpathSync;
  const directory = scratchWithFiniteWork(t, 3, Infinity, (phase, fields) => events.push({ phase, ...fields }));
  assert.ok(directory.startsWith(`${tmpdir()}/`) && existsSync(directory), 'P2 scratch did not return under TMPDIR');
  assert.equal(mutableFs.realpathSync, originalRealpath, 'P2 scratch did not restore the builtin reader');
  assert.deepEqual(events.map(({ phase }) => phase), ['scratch.work.entry', 'scratch.work.return']);
  assert.equal(events[1].reads, 3);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'P2-C0(8)-finite-work', position: 8, directory, events })}`);
});

test('FM-C0(1) finite fixture phases report warm, launcher, marker, and start-time work', SETTLES_WITHIN, async (t) => {
  const began = performance.now();
  const content = '[{"group": 4242, "sta';
  const beforeScratchElapsed = performance.now() - began;
  const beforeScratchRemaining = 20_000 - beforeScratchElapsed;
  const directory = scratch(t);
  const beforeStartElapsed = performance.now() - began;
  const beforeStartRemaining = 20_000 - beforeStartElapsed;
  const phases = [];
  const started = await startGroup(t, directory, 'group', {
    deadline: Infinity,
    work: { warm: 3, launcher: 3, marker: 3, startOf: 3 },
    noMatchPolls: 300,
    pollFailures: 1,
    observe: (phase) => phases.push(phase),
  });
  assert.equal(started.group, started.leader, 'FM fixture did not return its leader group');
  for (const phase of ['warm.work', 'launcher.work', 'marker.work', 'startOf.work']) {
    assert.deepEqual(phases.filter((event) => event.startsWith(phase)), [`${phase}.entry`, `${phase}.return`], `${phase} did not finish finite work`);
  }
  const state = stateOf(directory);
  writeGroups(state, [entryFor(started)]);
  writeFileSync(recordPath(state), content);
  await assert.rejects(killIn(directory), (failure) => failure.message.includes(recordPath(state)));
  assert.equal(alive(started.leader) && alive(started.member), true, 'FM-ready-C0(1): invalid record killed the fixture group');
  assert.ok(performance.now() - began < 20_000, 'FM-ready-C0(1): finite readiness did not fit the shared deadline');
  console.log(`C595_CELL ${JSON.stringify({ cell: 'FM-ready-C0(1)-finite-phases', position: 1, content, readinessOnly: true, completedPrefix: [], beforeScratchElapsed, beforeScratchRemaining, beforeStartElapsed, beforeStartRemaining, phases, started, directory, recordPath: recordPath(state), result: 'valid group, R-C1 reject naming path, leader/member alive' })}`);
});

test('F1-C0(1) the first ps answer names the tail and returns the detached group', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const ps = fixture(directory, 'ready-ps', 'while ! /bin/ps "$@" | /usr/bin/grep -q "^tail"; do :; done; exec /bin/ps "$@"');
  const events = [];
  const started = await startGroup(t, directory, 'group', { psCommand: ps, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  const polls = events.filter(({ phase }) => phase === 'ps.poll');
  assert.ok(beforeScratch > 0 && beforeStart > 0 && beforeStart <= beforeScratch);
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.equal(polls[0]?.outcome, 'tail', 'F1 first ps answer did not name tail');
  assert.ok(events.some(({ phase }) => phase === 'marker.read'));
  assert.ok(events.some(({ phase }) => phase === 'startOf.return'));
  assert.equal(started.group, started.leader);
  assert.notEqual(started.member, started.leader);
  assert.equal(started.started, startOf(started.leader));
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F1-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, events })}`);
});

test('F3-C0(1) finite ps no-match answers give way to tail readiness', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const events = [];
  const started = await startGroup(t, directory, 'group', { noMatchPolls: 300, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  const polls = events.filter(({ phase }) => phase === 'ps.poll');
  assert.ok(beforeScratch > 0 && beforeStart > 0 && beforeStart <= beforeScratch);
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(polls.some(({ outcome }) => outcome === 'no-match'), 'F3 saw no no-match answer');
  assert.equal(polls.at(-1)?.outcome, 'tail', 'F3 never reached tail');
  assert.equal(started.group, started.leader);
  assert.notEqual(started.member, started.leader);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F3-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, events })}`);
});

test('each observed ps poll records its own entry, return, and elapsed time', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const events = [];
  await startGroup(t, directory, 'group', { pollFailures: 1, observe: (phase, fields) => events.push({ phase, ...fields }) });
  const entries = events.filter(({ phase }) => phase === 'ps.entry');
  const answers = events.filter(({ phase }) => phase === 'ps.poll');
  assert.ok(answers.length >= 2, `no completed poll sequence was observed: ${JSON.stringify(events)}`);
  assert.equal(entries.length, answers.length, 'a returned ps poll had no recorded entry');
  for (const [index, answer] of answers.entries()) {
    assert.equal(entries[index].index, answer.index, 'ps poll entry and answer indexes differ');
    assert.ok(Number.isFinite(entries[index].startedEpochMs), 'ps poll entry lacks its call timestamp');
    assert.ok(Number.isFinite(answer.returnedEpochMs), 'ps poll answer lacks its return timestamp');
    assert.ok(answer.returnedEpochMs >= entries[index].startedEpochMs, 'ps poll returned before it started');
    assert.ok(Number.isFinite(answer.durationMs) && answer.durationMs >= 0, 'ps poll lacks its call duration');
  }
});

test('F4-C0(1) a failed ps answer gives way to tail readiness before the C1 write', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const events = [];
  const started = await startGroup(t, directory, 'group', { pollFailures: 1, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  assert.ok(beforeScratch > 0 && beforeStart > 0 && beforeStart <= beforeScratch, 'C1 pre-start budgets were not retained');
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'failure'), 'F4 never observed a failed ps read');
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'tail'), 'F4 never reached tail');
  assert.equal(started.group, started.leader);
  assert.notEqual(started.member, started.leader);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F4-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, events })}`);
});

test('a controlled process-table reader is used for fixture readiness', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const ps = fixture(directory, 'controlled-ps', 'echo called > "$here/ps-called"; exec /bin/ps "$@"');
  const events = [];
  const started = await startGroup(t, directory, 'group', { psCommand: ps, observe: (phase, fields) => events.push({ phase, ...fields }) });
  assert.equal(readFileSync(join(directory, 'ps-called'), 'utf8').trim(), 'called', 'startGroup did not use the controlled ps reader');
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'tail'));
  assert.equal(started.group, started.leader);
});

test('startGroup returns the detached shell leader, tail member, process group and leader start time', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  const read = spawnSync('/bin/ps', ['-p', `${started.leader},${started.member}`, '-o', 'pid=,ucomm=,pgid=,ppid='], { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' } });
  assert.equal(read.status, 0, `fixture group process read failed: ${read.error?.message ?? read.stderr}`);
  const processes = read.stdout.trim().split('\n').map((line) => {
    const [pid, command, group, parent] = line.trim().split(/\s+/);
    return { pid: Number(pid), command, group: Number(group), parent: Number(parent) };
  });
  const leader = processes.find(({ pid }) => pid === started.leader);
  const member = processes.find(({ pid }) => pid === started.member);
  assert.equal(started.group, started.leader, 'fixture group differs from the detached leader PID');
  assert.equal(leader?.command, process.platform === 'linux' ? 'group' : 'bash', 'fixture leader is not the detached shell');
  assert.equal(leader?.group, started.group, 'fixture shell is outside its process group');
  assert.notEqual(leader?.parent, process.pid, 'fixture shell remains a direct child of the test process');
  assert.equal(member?.command, 'tail', 'fixture member is not tail');
  assert.equal(member?.group, started.group, 'fixture tail is outside the shell process group');
  assert.equal(member?.parent, started.leader, 'fixture tail is not the shell child');
  assert.equal(started.started, startOf(started.leader), 'fixture start time differs from the leader start');
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F1-C0(1)-group-identity', directory, started, processes, ps: { status: read.status, output: read.stdout } })}`);
});

test('F5-C0(1) a process-table call held at a FIFO answers after release', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const release = join(directory, 'ps-release');
  assert.equal(spawnSync('/usr/bin/mkfifo', [release]).status, 0);
  const ps = fixture(directory, 'held-ps', 'echo called > "$here/ps-called"; IFS= read -r answer < "$here/ps-release"; exec /bin/ps "$@"');
  const events = [];
  const pending = startGroup(t, directory, 'group', { psCommand: ps, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  await until(() => existsSync(join(directory, 'ps-called')), t);
  assert.equal(existsSync(join(directory, 'group.pids')), false, 'marker appeared before the held ps answer');
  const releasedAt = performance.now() - began;
  writeFileSync(release, 'go\n');
  const started = await pending;
  assert.ok(beforeScratch > 0 && beforeStart > 0, 'C1 had no pre-start budget');
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(events.some(({ phase, outcome, at }) => phase === 'ps.poll' && outcome === 'tail' && at >= releasedAt), 'the held ps did not answer after release');
  assert.equal(started.group, started.leader);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F5-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, releasedAt, events })}`);
});

test('F6-C0(1) a valid marker delayed after tail readiness appears on release', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const gate = join(directory, 'marker-release');
  assert.equal(spawnSync('/usr/bin/mkfifo', [gate]).status, 0);
  const events = [];
  const pending = startGroup(t, directory, 'group', { markerGate: gate, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  const entered = await Promise.race([
    pending.then(() => 'returned'),
    until(() => existsSync(join(directory, 'group.marker-gate')), t).then(() => 'held'),
  ]);
  assert.equal(entered, 'held', 'F6 marker gate was not entered');
  const polls = join(directory, 'group.ps-polls');
  await until(() => existsSync(polls) && readFileSync(polls, 'utf8').includes('0|tail'), t);
  assert.equal(existsSync(join(directory, 'group.pids')), false, 'F6 marker appeared before release');
  const releasedAt = performance.now() - began;
  writeFileSync(gate, 'ready\n');
  const started = await pending;
  assert.ok(beforeScratch > 0 && beforeStart > 0, 'C1 had no pre-start budget');
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(events.some(({ phase, at }) => phase === 'marker.return' && at >= releasedAt), 'F6 marker did not answer after release');
  assert.equal(started.group, started.leader);
  assert.notEqual(started.member, started.leader);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F6-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, releasedAt, events })}`);
});

test('F7-C0(1) the leader start-time read delayed after the marker answers on release', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const gate = join(directory, 'start-release');
  const events = [];
  const pending = startGroup(t, directory, 'group', { startGate: gate, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  const entered = await Promise.race([
    pending.then(() => 'returned'),
    until(() => existsSync(join(directory, 'group.start-gate')), t).then(() => 'held'),
  ]);
  assert.equal(entered, 'held', 'F7 start-time gate was not entered');
  assert.equal(existsSync(join(directory, 'group.pids')), true, 'F7 marker was not ready before the start-time read');
  const releasedAt = performance.now() - began;
  writeFileSync(gate, 'ready');
  const started = await pending;
  assert.ok(beforeScratch > 0 && beforeStart > 0, 'C1 had no pre-start budget');
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(events.some(({ phase, at }) => phase === 'startOf.return' && at >= releasedAt), 'F7 start time did not answer after release');
  assert.equal(started.started, startOf(started.leader));
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F7-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, releasedAt, events })}`);
});

test('F2-C0(1) finite launcher readiness waits for release before the first ps answer', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const gate = join(directory, 'launch-release');
  const events = [];
  const pending = startGroup(t, directory, 'group', { launchGate: gate, observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }) });
  const entered = await Promise.race([
    pending.then(() => 'returned'),
    until(() => existsSync(join(directory, 'group.launch-gate')), t).then(() => 'held'),
  ]);
  assert.equal(entered, 'held', 'F2 launcher gate was not entered');
  assert.equal(existsSync(join(directory, 'group.pids')), false, 'F2 marker existed before launch release');
  const releasedAt = performance.now() - began;
  writeFileSync(gate, 'ready');
  const started = await pending;
  assert.ok(beforeScratch > 0 && beforeStart > 0, 'C1 had no pre-start budget');
  assert.equal(existsSync(recordPath(stateOf(directory))), false, `C0(1) wrote ${content} before readiness`);
  assert.ok(events.some(({ phase, at }) => phase === 'launcher.exit' && at >= releasedAt), 'F2 launcher did not finish after release');
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'tail'));
  assert.equal(started.group, started.leader);
  console.log(`C595_CELL ${JSON.stringify({ cell: 'F2-C0(1)', content, completedPrefix: [], beforeScratch, beforeStart, releasedAt, events })}`);
});

test('FM-ready-C0(1) launch, failed ps, and delayed marker finish before C1 rejects', SETTLES_WITHIN, async (t) => {
  const { began, content, beforeScratch, directory, beforeStart } = c0(t);
  const launchGate = join(directory, 'launch-release');
  const markerGate = join(directory, 'marker-release');
  const startGate = join(directory, 'start-release');
  assert.equal(spawnSync('/usr/bin/mkfifo', [markerGate]).status, 0);
  const events = [];
  const pending = startGroup(t, directory, 'group', {
    launchGate, markerGate, startGate, pollFailures: 1, noMatchPolls: 300,
    observe: (phase, fields) => events.push({ phase, at: performance.now() - began, ...fields }),
  });
  await until(() => existsSync(join(directory, 'group.launch-gate')), t);
  writeFileSync(launchGate, 'ready');
  await until(() => existsSync(join(directory, 'group.marker-gate')), t);
  assert.equal(existsSync(join(directory, 'group.pids')), false, 'FM marker appeared before release');
  writeFileSync(markerGate, 'ready\n');
  await until(() => existsSync(join(directory, 'group.start-gate')), t);
  writeFileSync(startGate, 'ready');
  const started = await pending;
  assert.ok(beforeScratch > 0 && beforeStart > 0, 'C1 had no pre-start budget');
  assert.ok(events.some(({ phase }) => phase === 'launcher.gate.return'));
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'failure'));
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'no-match'));
  assert.ok(events.some(({ phase, outcome }) => phase === 'ps.poll' && outcome === 'tail'));
  assert.ok(events.some(({ phase }) => phase === 'marker.gate.entry'));
  assert.ok(events.some(({ phase }) => phase === 'startOf.gate.entry'));
  assert.equal(started.group, started.leader);
  const state = stateOf(directory);
  writeGroups(state, [entryFor(started)]);
  writeFileSync(recordPath(state), content);
  await assert.rejects(killIn(directory), (failure) => failure.message.includes(recordPath(state)), 'R-C1 did not reject the malformed record');
  assert.equal(alive(started.leader) && alive(started.member), true, 'FM-ready C1 killed the protected group');
  console.log(`C595_CELL ${JSON.stringify({ cell: 'FM-ready-C0(1)', recordCell: 'R-C1', content, completedPrefix: [], beforeScratch, beforeStart, events, started })}`);
});

test('given a leftover partial record the call cannot remove beside a record holding no entry, the call settles without failing, and records why the partial record stayed', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const state = stateOf(directory);
  writeGroups(state, []);
  writeFileSync(streamPath(state), '');
  UNREMOVABLE['where the partial record is a directory'](state);

  await killIn(directory);

  assert.deepEqual(partialsKeptIn(directory), [{ layer: 'L1', path: join(state, 'groups.json.partial'), reason: 'string' }]);
});

test('given a leftover partial record the call cannot remove and a sink that refuses every append, the call rejects naming the unrecorded event and the partial record', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const state = stateOf(directory);
  writeGroups(state, []);
  UNREMOVABLE['where the partial record is a directory'](state);

  const failure = await failureOf(killRecordedGroups({ directory: state, sink: refusingSink(directory) }));

  assert.ok(failure.message.includes('record.partial-kept') && failure.message.includes(join(state, 'groups.json.partial')), failure.message);
});

// proves R-STATE-11
test('given a record whose content cannot be read as entries, the call kills nothing, and fails naming the record\'s file', SETTLES_WITHIN, async (t) => {
  const targetStarted = performance.now();
  const targetDeadline = targetStarted + 20_000;
  const reached = new Map();
  const caseEvents = new Map();
  const directories = [];
  const identities = [];
  const nativeKill = process.kill;
  t.after(() => { process.kill = nativeKill; });
  let activeCase = 'target';
  let activePhase = 'setup';
  let targetOutcome = 'running';
  let abortedAt;
  let firstBoundPhase;
  let traceFinished = false;
  const forcedPolls = Number(process.env.C595_FORCE_PS_POLLS || 0);
  const scratchReads = Number(process.env.C595_P2_SCRATCH_READS || 0);
  const entryReads = Number(process.env.C595_ENTRY_READS || 0);
  const recordReads = Number(process.env.C595_RECORD_READS || 0);
  const priorPolls = Number(process.env.C595_P2_C7_POLLS || 0);
  const fmPhase = process.env.C595_FM_PHASE;
  const fmWork = Object.fromEntries(['warm', 'launcher', 'marker', 'startOf'].map((phase) => [phase, Number(process.env[`C595_FM_${phase.toUpperCase()}_READS`] || 0)]).filter(([, reads]) => reads > 0));
  const phases = ['handoff.return', 'scratch.entry', 'scratch.return', 'start.entry', 'warm.entry', 'warm.return', 'launcher.entry', 'launcher.exit', 'marker.entry', 'ps.entry', 'ps.poll', 'marker.return', 'marker.read', 'startOf.entry', 'startOf.return', 'start.return', 'record.first.entry', 'record.first.return', 'record.invalid.entry', 'record.invalid.return', 'killIn.entry', 'killIn.reject', 'guard', 'alive.leader', 'alive.member', 'complete', 'handoff.entry'];
  const trace = (caseId, phase, fields = {}) => {
    if (process.env.C595_TRACE !== '1') return;
    const elapsed = performance.now() - targetStarted;
    if (caseId.startsWith('C')) {
      if (!reached.has(caseId)) reached.set(caseId, new Set());
      reached.get(caseId).add(phase);
      if (!caseEvents.has(caseId)) caseEvents.set(caseId, []);
      caseEvents.get(caseId).push({ phase, fields });
    }
    activeCase = caseId;
    activePhase = phase;
    console.log(`C595_TRACE ${JSON.stringify({ caseId, phase, at: new Date().toISOString(), elapsed, remaining: targetDeadline - performance.now(), ...fields })}`);
  };
  const finishTrace = (reason, failedAt) => {
    if (process.env.C595_TRACE !== '1' || traceFinished) return;
    traceFinished = true;
    const [exhaustedCase, exhaustedPhase] = (failedAt ?? `${activeCase}:${activePhase}`).split(':');
    const exhausting = targetOutcome === 'aborted' || targetDeadline <= performance.now() ? `${exhaustedCase}:${exhaustedPhase}` : null;
    for (let index = 1; index <= 8; index += 1) {
      const caseId = `C${index}`;
      const seen = reached.get(caseId) ?? new Set();
      for (const phase of phases) {
        if (!seen.has(phase)) trace(caseId, 'not.reached', { unentered: phase, reason: seen.has('start.reuse') && ['warm.entry', 'warm.return', 'launcher.entry', 'launcher.exit', 'marker.entry', 'ps.entry', 'ps.poll', 'marker.return', 'marker.read', 'startOf.entry', 'startOf.return'].includes(phase) ? 'reused C1 group before fixture entry' : reason });
      }
    }
    for (const phase of Object.keys(fmWork)) {
      if (!reached.get('C8')?.has(`${phase}.work.entry`)) trace('C8', 'not.reached', { unentered: `${phase}.work`, reason });
    }
    const outcomeCell = exhausting === null ? targetOutcome === 'passed' ? 'all reached positions complete' : `${exhaustedCase}:${exhaustedPhase}:assertion-failed` : `S${exhaustedCase.slice(1)}-${['warm', 'launcher', 'ps.entry', 'ps.poll', 'marker', 'startOf'].some((phase) => exhaustedPhase.startsWith(phase)) ? 'F' : exhaustedPhase.startsWith('scratch') ? 'P' : exhaustedPhase.startsWith('record') || exhaustedPhase.startsWith('killIn') || exhaustedPhase.startsWith('guard') || exhaustedPhase.startsWith('alive') ? 'R' : 'entry'}-bound`;
    trace('target', 'finish', { outcome: targetOutcome, outcomeCell, reason, firstExhaustingPhase: exhausting });
  };
  t.after(() => {
    if (process.env.C595_TRACE !== '1') return;
    trace('target', 'teardown.entry', { directories, identities });
    t.after(() => {
      t.after(() => {
        const beforeAfter = directories.map((directory) => ({ directory, remains: existsSync(directory) }));
        const observed = targetProcessTable(directories, identities);
        const teardown = beforeAfter.some(({ remains }) => remains) ? 'F' : 'T';
        const targetResult = targetOutcome === 'passed' ? 'P' : targetOutcome === 'assertion-failed' && process.env.C595_DELIBERATE_FAIL === '1' ? 'A' : 'X';
        const ruling = targetResult === 'X' ? null : targetTeardownCell(targetResult, teardown, observed);
        trace('target', 'teardown.observed', { cell: `${targetResult}-${teardown}-${observed.outcome}`, disposition: ruling?.disposition ?? null, beforeAfter, ...observed });
        assert.equal(`${teardown}-${observed.outcome}`, 'T-E', 'target teardown left a scratch path or same-start group process');
      });
    });
  });
  t.signal.addEventListener('abort', () => {
    if (targetOutcome === 'running') {
      targetOutcome = 'aborted';
      abortedAt = `${activeCase}:${activePhase}`;
      finishTrace(`test signal aborted during ${abortedAt}`);
    }
  }, { once: true });
  trace('target', 'start', { runId: process.env.C595_RUN_ID ?? null, selectedFile: 'test/kill-recorded.test.mjs', selectedTest: 'given a record whose content cannot be read as entries, the call kills nothing, and fails naming the record\'s file', deadlineMs: 20_000, deadlineAt: new Date(Date.now() + 20_000).toISOString(), selectedCommit: process.env.C595_SELECTED_COMMIT ?? null, force: { marker: process.env.C595_FORCE_MARKER ?? null, noMatchPolls: forcedPolls, scratchReads, entryReads, recordReads, fmPhase: fmPhase ?? null, fmWork, precedingNoMatchPolls: priorPolls, affectedPhase: fmPhase ? `${fmPhase}.work` : recordReads > 0 ? 'record.invalid.work' : entryReads > 0 ? 'handoff.work' : scratchReads > 0 ? 'scratch.realpathSync' : forcedPolls > 0 ? 'ps.poll' : null, preStart: priorPolls > 0 ? 'C7 finite ps no-match then valid readiness' : 'normal scratch and warm', position: 8, positions: 'C8 only' } });
  trace('target', 'setup.entry');
  try {
  // A record torn part-way, JSON that is no list, entries missing a field or holding one of the
  // wrong type, a card that is no issue number, and a group id no dispatch's group can have: 1 is
  // launchd's.
  const contents = [
    '[{"group": 4242, "sta',
    '{"group": 4242}',
    '[{"group": "4242", "started": 0, "dispatch": "d-1"}]',
    '[{"group": 4242, "dispatch": "d-1"}]',
    '[{"group": 4242, "started": 0}]',
    '[{"group": 1, "started": 0, "dispatch": "d-1"}]',
    '[{"group": 4242, "started": 0, "dispatch": "d-1", "card": {"unexpected": true}}]',
    '[{"group": 4242, "started": 0, "dispatch": "d-1", "card": "1412"}]',
  ];
  trace('target', 'setup.return', { caseIds: contents.map((_, index) => `C${index + 1}`) });
  if (process.env.C595_FORCE_PS_POLLS && !fmPhase) trace('target', 'force.input', { marker: process.env.C595_FORCE_MARKER ?? null, position: 8, content: contents[7], completedPrefix: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], affectedPhase: 'ps.poll', noMatchPolls: Number(process.env.C595_FORCE_PS_POLLS), expectedBase: 'S8-F-bound', expectedHead: 'S8-complete' });
  if (scratchReads > 0) trace('target', 'force.input', { marker: process.env.C595_FORCE_MARKER ?? null, position: 8, content: contents[7], completedPrefix: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], precedingNoMatchPolls: priorPolls, scratchReads, affectedPhase: 'scratch.realpathSync', expectedBase: 'S8-P-bound', expectedHead: 'S8-complete' });
  if (entryReads > 0) trace('target', 'force.input', { marker: process.env.C595_FORCE_MARKER ?? null, position: 8, content: contents[7], completedPrefix: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], precedingNoMatchPolls: priorPolls, entryReads, affectedPhase: 'handoff.work', expectedBase: 'S8-entry-bound', expectedHead: 'S8-complete' });
  if (recordReads > 0) trace('target', 'force.input', { marker: process.env.C595_FORCE_MARKER ?? null, position: 8, content: contents[7], completedPrefix: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], precedingNoMatchPolls: priorPolls, recordReads, affectedPhase: 'record.invalid.work', expectedBase: 'S8-R-bound', expectedHead: 'S8-complete' });
  if (fmPhase) trace('target', 'force.input', { marker: process.env.C595_FORCE_MARKER ?? null, position: 8, content: contents[7], completedPrefix: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], precedingNoMatchPolls: priorPolls, fmPhase, fmWork, noMatchPolls: forcedPolls, affectedPhase: fmPhase === 'ps' ? 'ps.poll' : `${fmPhase}.work`, expectedBase: 'S8-F-bound', expectedHead: 'S8-complete' });
  let shared;
  let completedPrefix = [];
  for (const [index, content] of contents.entries()) {
    const caseId = `C${index + 1}`;
    if (entryReads > 0 && index === 7) {
      finiteDirectoryReads(directories.at(-1), entryReads, targetDeadline, (phase, fields) => {
        trace(caseId, phase, fields);
        if (phase === 'handoff.work.exhausted') firstBoundPhase = `${caseId}:${phase}`;
      }, 'handoff.work');
      if (firstBoundPhase) {
        trace(caseId, 'handoff.bound', { position: 8, content, completedPrefix, beforeScratchElapsed: performance.now() - targetStarted, beforeScratchRemaining: targetDeadline - performance.now(), firstBoundPhase });
        assert.fail(`${caseId} S8-entry-bound: finite handoff work consumed the shared 20,000 ms deadline before scratch(t)`);
      }
    }
    trace(caseId, 'handoff.return', { completedPrefix });
    const beforeScratchElapsed = performance.now() - targetStarted;
    const beforeScratchRemaining = targetDeadline - performance.now();
    trace(caseId, 'scratch.entry', { content, completedPrefix, beforeScratchElapsed, beforeScratchRemaining });
    const scratchEntered = performance.now();
    const directory = scratchReads > 0 && index === 7
      ? scratchWithFiniteWork(t, scratchReads, targetDeadline, (phase, fields) => {
        trace(caseId, phase, fields);
        if (phase === 'scratch.work.exhausted') firstBoundPhase = `${caseId}:${phase}`;
      })
      : scratch(t);
    directories.push(directory);
    const scratchDuration = performance.now() - scratchEntered;
    trace(caseId, 'scratch.return', { directory, scratchDuration });
    assert.ok(directory.startsWith(`${tmpdir()}/`) && existsSync(directory), `${caseId} P1-C0(${index + 1}): scratch did not return a usable directory under TMPDIR`);
    if (scratchReads > 0 && index === 7 && firstBoundPhase) {
      trace(caseId, 'P2-C0', { position: 8, directory, scratchDuration, beforeScratchElapsed, beforeScratchRemaining, beforeStartElapsed: performance.now() - targetStarted, beforeStartRemaining: targetDeadline - performance.now(), completedPrefix, firstBoundPhase });
      assert.fail(`${caseId} P2-C0(8): finite scratch(t) filesystem work consumed the shared 20,000 ms deadline before startGroup`);
    }
    trace(caseId, 'P1-C0', { position: index + 1, directory });
    const beforeStartElapsed = performance.now() - targetStarted;
    const beforeStartRemaining = targetDeadline - performance.now();
    trace(caseId, 'start.entry', { beforeStartElapsed, beforeStartRemaining, completedPrefix });
    const reused = shared !== undefined;
    if (reused) trace(caseId, 'start.reuse', { from: 'C1' });
    const started = shared ??= await startGroup(t, directory, 'group', {
      noMatchPolls: index === 6 ? priorPolls : index === 7 ? forcedPolls : 0,
      work: index === 7 ? fmWork : {},
      deadline: targetDeadline,
      observe: process.env.C595_TRACE === '1' ? (phase, fields) => {
        trace(caseId, phase, fields);
        if (phase.endsWith('.work.exhausted')) firstBoundPhase = `${caseId}:${phase}`;
      } : undefined,
    });
    trace(caseId, 'start.return', started);
    assert.equal(started.group, started.leader, `${caseId} F-C0(${index + 1}): group id is not the leader PID`);
    assert.notEqual(started.member, started.leader, `${caseId} F-C0(${index + 1}): tail and leader have the same PID`);
    const psPolls = (caseEvents.get(caseId) ?? []).filter(({ phase }) => phase === 'ps.poll').map(({ fields }) => fields);
    trace(caseId, 'F-C0', { position: index + 1, constituent: reused ? 'C1 group reuse' : 'fixture readiness', psPolls: psPolls.length, firstPoll: psPolls[0] ?? null, lastPoll: psPolls.at(-1) ?? null, started });
    if (process.env.C595_TRACE === '1' && !identities.some(({ pid }) => pid === started.leader)) {
      trace(caseId, 'memberStart.entry', { pid: started.member });
      const memberStarted = startOf(started.member);
      trace(caseId, 'memberStart.return', { pid: started.member, started: memberStarted });
      identities.push({ pid: started.leader, started: started.started }, { pid: started.member, started: memberStarted });
    }
    trace(caseId, 'identities', { identities: identities.filter(({ pid }) => pid === started.leader || pid === started.member), reusedFrom: reused ? 'C1' : null });
    // A readable entry naming the live group follows the unreadable content wherever it can, so a
    // call that read past the fault would kill it.
    const state = stateOf(directory);
    trace(caseId, 'record.first.entry');
    writeGroups(state, [entryFor(started)]);
    trace(caseId, 'record.first.return');
    trace(caseId, 'record.invalid.entry');
    if (recordReads > 0 && index === 7) {
      finiteDirectoryReads(directory, recordReads, targetDeadline, (phase, fields) => {
        trace(caseId, phase, fields);
        if (phase === 'record.invalid.work.exhausted') firstBoundPhase = `${caseId}:${phase}`;
      }, 'record.invalid.work');
      if (firstBoundPhase) {
        trace(caseId, 'record.invalid.bound', { position: 8, content, completedPrefix, beforeScratchElapsed, beforeScratchRemaining, beforeStartElapsed, beforeStartRemaining, firstBoundPhase });
        assert.fail(`${caseId} S8-R-bound: finite record work consumed the shared 20,000 ms deadline before the invalid write`);
      }
    }
    writeFileSync(recordPath(state), content.startsWith('[{') && content.endsWith(']') ? `${content.slice(0, -1)}, ${JSON.stringify(entryFor(started))}]` : content);

    trace(caseId, 'record.invalid.return');

    trace(caseId, 'killIn.entry');
    const groupSignals = [];
    if (process.env.C595_TRACE === '1') process.kill = (pid, signal) => {
      if (pid < 0) {
        groupSignals.push({ pid, signal });
        trace(caseId, 'group.signal', { pid, signal });
      }
      return nativeKill(pid, signal);
    };
    await assert.rejects(killIn(directory), (failure) => {
      assert.ok(failure.message.includes(recordPath(state)), `given ${content}, the failure does not name the record's file: ${failure.message}`);
      return true;
    }, content);

    process.kill = nativeKill;
    trace(caseId, 'killIn.reject', { pathNamed: true, groupSignals });
    trace(caseId, 'guard', { result: 'rejected before killEntries', path: recordPath(state), groupSignals });

    const leaderAlive = alive(started.leader);
    trace(caseId, 'alive.leader', { pid: started.leader, alive: leaderAlive });
    const memberAlive = alive(started.member);
    trace(caseId, 'alive.member', { pid: started.member, alive: memberAlive });
    assert.equal(alive(started.leader) && alive(started.member), true, `given ${content}, a process of the group was killed`);
    assert.deepEqual({ pathNamed: true, groupSignals, leaderAlive, memberAlive }, { pathNamed: true, groupSignals: [], leaderAlive: true, memberAlive: true }, `R-${caseId}: malformed content reached a group kill or lost a live process`);
    console.log(`C595_CELL ${JSON.stringify({ cell: `R-${caseId}`, position: index + 1, content, directory, recordPath: recordPath(state), completedPrefix, groupSignals, started, leaderAlive, memberAlive, outcome: 'rejects before killEntries naming groups.json' })}`);
    assert.ok(beforeScratchRemaining > 0 && beforeStartRemaining > 0 && performance.now() < targetDeadline, `S${index + 1}-complete: a phase crossed the shared deadline`);
    console.log(`C595_CELL ${JSON.stringify({ cell: `S${index + 1}-complete`, position: index + 1, content, completedPrefix, beforeScratchElapsed, beforeScratchRemaining, scratchDuration, beforeStartElapsed, beforeStartRemaining, directory, readiness: reused ? 'reused C1 group' : 'fixture returned leader/member/start time', writes: ['first', 'invalid'], rejection: 'read-before-kill guard', groupSignals, leaderAlive, memberAlive, elapsed: performance.now() - targetStarted })}`);
    trace(caseId, 'complete', { completedPrefix, outcomeCell: `S${index + 1}-complete`, recordCell: `R-${caseId}` });
    completedPrefix = [...completedPrefix, caseId];
    trace(caseId, 'handoff.entry', { completedPrefix });
  }
  if (process.env.C595_DELIBERATE_FAIL === '1') {
    targetOutcome = 'assertion-failed';
    trace('target', 'assertion.deliberate', { completedPrefix });
    assert.fail('C595 deliberate target assertion failure after C8');
  }
  targetOutcome = 'passed';
  trace('target', 'complete', { completedPrefix });
  finishTrace('target completed');
  } catch (failure) {
    if (targetOutcome === 'running') targetOutcome = 'assertion-failed';
    const failedAt = targetOutcome === 'aborted' ? abortedAt : firstBoundPhase ?? `${activeCase}:${activePhase}`;
    trace('target', 'failure', { message: failure.message, outcome: targetOutcome, failedAt });
    finishTrace(`target failed during ${failedAt}`, failedAt);
    throw failure;
  }
});

/**
 * A stand-in for `ps` in `directory` that never answers: it follows a file nothing writes to. Its
 * path, and so the directory, is in its command line, so the teardown ends any left running.
 */
const silentPs = (directory) => fixture(directory, 'ps', 'exec /usr/bin/tail -f "$here/hold"');

// proves R-STATE-11
test('given a recorded group whose start-time read never answers, the call kills no process of that group, fails naming its entry, and the record still holds that entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  const entry = entryFor(started, { dispatch: 'd-unanswered', card: 31 });
  writeGroups(stateOf(directory), [entry]);

  await assert.rejects(killIn(directory, { ps: silentPs(directory), readTimeout: 300 }), (failure) => {
    for (const named of [`group ${started.group}`, 'd-unanswered', '#31']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
    return true;
  });

  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

// proves R-STATE-11
test('a start-time read that exits 0 but leaves output open past its deadline does not authorize a recorded kill', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  writeFileSync(join(directory, 'hold'), '');
  const started = await startGroup(t, directory, 'group');
  const entry = entryFor(started);
  writeGroups(stateOf(directory), [entry]);
  const readTimeout = 300;
  const cut = heldOutput(t, directory, '');
  const ps = fixture(directory, 'ps', [
    'if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    'fi',
    `exec ${shellQuote(PS)} "$@"`,
  ].join('\n'));

  const failed = killIn(directory, { ps, readTimeout }).then(() => undefined, (error) => error);
  await cut.started();
  const error = await failed;

  assert.ok(error, 'the recorded kill was accepted');
  assert.match(error.message, /process-table read timed out after 300 ms/);
  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the recorded group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

/**
 * Stand-ins for `ps`, by how the start-time read fails, each the body of a script whose arguments
 * are the read's: the group's id is the third. Beside each, what the failure says of that read,
 * which a read that never answered does not say. The first is how `ps` reports that no process
 * matched, whatever it is asked. The partial table is the leader's row alone, as `startGroup`
 * wrote its pid to `$here/group.pids`, with a start no read here gets as far as parsing. Each is
 * `warmed`, because the start-time read is its first exec, which must reach its body within
 * `readTimeout`.
 */
const FAILING_READS = {
  'exits 1 and prints nothing': ['exit 1', /listed no process of the group/],
  'exits 2 and prints nothing': ['exit 2', /ended with 2\b/],
  'prints part of the table and exits 1': ['read leader member < "$here/group.pids"; echo "$leader S   Mon Sep 28 12:00:00 2026"; exit 1', /ended with 1\b/],
  'prints a start time that cannot be parsed': ['echo "$3 Ss  the day before yesterday"', /a start time L0 cannot read: "the day before yesterday"/],
};

for (const [how, [body, cause]] of Object.entries(FAILING_READS)) {
  test(`given a recorded group with a live member whose start-time read ${how}, the call kills no process of that group, fails naming its entry, and the record still holds that entry`, SETTLES_WITHIN, async (t) => {
    const directory = scratch(t);
    const started = await startGroup(t, directory, 'group');
    const entry = entryFor(started, { dispatch: 'd-unread', card: 32 });
    writeGroups(stateOf(directory), [entry]);

    await assert.rejects(killIn(directory, { ps: fixture(directory, 'ps', body), readTimeout: 300 }), (failure) => {
      for (const named of [`group ${started.group}`, 'd-unread', '#32']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
      assert.match(failure.message, cause, `the failure does not say why the read failed: ${failure.message}`);
      return true;
    });

    assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
    assert.deepEqual(readGroups(stateOf(directory)), [entry]);
  });
}

/**
 * A stand-in for `ps` in `directory` whose start-time read lists every member of the group, its
 * leader and member as `startGroup` wrote them to `$here/group.pids`, each with the start `lstart`,
 * running no `ps` for it, and which passes every other read through to
 * `ps`, so a group the start-time read admitted would be killed. `lstart` is shell text inside
 * double quotes, so a command substitution in it runs under the read's environment. It is
 * `warmed`, because the start-time read is its first exec, which must reach its body within
 * `readTimeout`.
 */
const startsAs = (directory, lstart) => fixture(directory, 'ps', [
  'case "$*" in',
  `  *lstart*) read leader member < "$here/group.pids"; printf "%s S %s\\n" "$leader" "${lstart}" "$member" "${lstart}" ;;`,
  `  *) exec ${shellQuote(PS)} "$@" ;;`,
  'esac',
].join('\n'));

/**
 * The second each malformed start below names, were it taken for a real start: 2026-09-28
 * 12:00:00 UTC, a Monday, 1790596800 seconds since the epoch, by
 * `date -u -j -f "%Y-%m-%d %H:%M:%S" "2026-09-28 12:00:00" +%s`.
 */
const CARRIED_INTO = 1790596800;

/**
 * Asserts that, given a live group whose entry records `CARRIED_INTO` and whose start-time read
 * lists every member as starting at `malformed`, L1's kill of recorded groups kills no process of
 * that group, fails naming its entry, and keeps that entry. A read that took the start for that
 * second would find the leader's start the one recorded, and kill the group.
 */
async function refusesStart(t, malformed) {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  const entry = entryFor(started, { started: CARRIED_INTO, dispatch: 'd-impossible', card: 35 });
  writeGroups(stateOf(directory), [entry]);

  await assert.rejects(killIn(directory, { ps: startsAs(directory, malformed), readTimeout: 300 }), (failure) => {
    for (const named of [`group ${started.group}`, 'd-impossible', '#35']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
    return true;
  });

  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
}

/** Start times no calendar holds, each of which a day, hour, minute or second carried into the next would make `CARRIED_INTO`. */
const IMPOSSIBLE_STARTS = ['Mon Aug 59 12:00:00 2026', 'Sun Sep 27 36:00:00 2026', 'Mon Sep 28 11:60:00 2026', 'Mon Sep 28 11:59:60 2026'];

for (const impossible of IMPOSSIBLE_STARTS) {
  test(`given a recorded group whose start-time read lists every member with the start ${impossible}, which no calendar holds, the call kills no process of that group, fails naming its entry, and the record still holds that entry`, SETTLES_WITHIN, (t) => refusesStart(t, impossible));
}

/**
 * Starts that hold `CARRIED_INTO`'s fields but are not how `ps` prints it, `Mon Sep 28 12:00:00
 * 2026`: one names the wrong weekday, and one pads a two-digit day as `ps` pads only a day of
 * one digit.
 */
const MISPRINTED_STARTS = { 'the wrong weekday': 'Tue Sep 28 12:00:00 2026', 'a two-digit day padded': 'Mon Sep  28 12:00:00 2026' };

for (const [how, misprinted] of Object.entries(MISPRINTED_STARTS)) {
  test(`given a recorded group whose start-time read lists every member with the entry's start printed with ${how}, the call kills no process of that group, fails naming its entry, and the record still holds that entry`, SETTLES_WITHIN, (t) => refusesStart(t, misprinted));
}

test('given a recorded group whose leader\'s start falls on a one-digit day, and whose start-time read prints it as the C library\'s %c does, the call kills every process in the group and clears its entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  // 2026-09-01 00:00:00 UTC, by `date -u -j -f "%Y-%m-%d %H:%M:%S" "2026-09-01 00:00:00" +%s`.
  // `ps` prints a start with the C library's `%c`, padded to its column (adv_cmds's `lstarted`),
  // and `date` formats `%c` with the same library, under the read's zone and locale.
  const entry = entryFor(started, { started: 1788220800 });
  writeGroups(stateOf(directory), [entry]);

  await killIn(directory, { ps: startsAs(directory, process.platform === 'linux' ? '$(/bin/date -d @1788220800 +%c)    ' : '$(/bin/date -r 1788220800 +%c)    ') });

  assert.equal(alive(started.leader) || alive(started.member), false, 'a process of the group is alive');
  assert.deepEqual(readGroups(stateOf(directory)), []);
});

test('given a recorded group whose leader is dead and whose live member\'s start-time read exits 1 and prints nothing, the call kills no process of that group, fails naming its entry, and the record still holds that entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await withoutLeader(t, await startGroup(t, directory, 'group'));
  const entry = entryFor(started, { dispatch: 'd-unread-leaderless', card: 34 });
  writeGroups(stateOf(directory), [entry]);

  await assert.rejects(killIn(directory, { ps: fixture(directory, 'ps', 'exit 1'), readTimeout: 300 }), (failure) => {
    for (const named of [`group ${started.group}`, 'd-unread-leaderless', '#34']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
    assert.match(failure.message, /listed no process of the group/, `the failure does not say why the read failed: ${failure.message}`);
    return true;
  });

  assert.equal(alive(started.member), true, 'the member was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

/**
 * A stand-in's body that prints the file `table` beside it as its start-time read, and exits 0.
 * It runs builtins of the shell alone, so a read of it never waits on the real `ps`. That read's
 * time grows with the host's process table and load. Run inside a test's 300 ms read bound, it
 * could outlast the bound before answering, and the failure then says only that the read timed
 * out.
 */
const PRINTS_TABLE = 'while IFS= read -r row; do printf "%s\\n" "$row"; done < "$here/table"; exit 0';

/**
 * Writes `table` in `directory` for `PRINTS_TABLE`: `group`'s rows, read as L0 reads its start
 * times, less its leader's row. Its pid is the group's id.
 */
function writeTableLess(directory, group) {
  const read = spawnSync(PS, ['-ww', '-g', String(group), '-o', 'pid=,stat=,lstart='], { env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' }, encoding: 'utf8' });
  assert.equal(read.status, 0, `reading group ${group}'s table failed: ${read.error?.message ?? read.stderr}`);
  const rows = read.stdout.split('\n').filter((row) => row !== '' && !new RegExp(`^ *${group} `).test(row));
  assert.notEqual(rows.length, 0, `group ${group}'s table held no row but its leader's: ${read.stdout}`);
  writeFileSync(join(directory, 'table'), rows.map((row) => `${row}\n`).join(''));
}

test('given a live group that is not the recorded one, whose start-time read prints the table less its live leader\'s row and exits 0, the call kills no process of that group, fails naming its entry, and the record still holds that entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  // The entry names a leader that started five seconds before this group's, so this group is not
  // the one recorded, and only its leader's start shows that. The table is read before the call,
  // so the call's reads answer without waiting on the real `ps`.
  const entry = entryFor(started, { started: started.started - 5, dispatch: 'd-leaderless', card: 33 });
  writeGroups(stateOf(directory), [entry]);
  writeTableLess(directory, started.group);
  const ps = fixture(directory, 'ps', PRINTS_TABLE);

  await assert.rejects(killIn(directory, { ps, readTimeout: 300 }), (failure) => {
    for (const named of [`group ${started.group}`, 'd-leaderless', '#33']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
    assert.match(failure.message, new RegExp(`left out its leader, pid ${started.group},`), `the failure does not say why the read failed: ${failure.message}`);
    return true;
  });

  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

// proves R-STATE-11
test('a leaderless start-time table whose output closes after its deadline fails as a timeout', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  writeFileSync(join(directory, 'hold'), '');
  const started = await startGroup(t, directory, 'group');
  const entry = entryFor(started, { started: started.started - 5, dispatch: 'd-leaderless', card: 33 });
  writeGroups(stateOf(directory), [entry]);
  writeTableLess(directory, started.group);
  const cut = heldOutput(t, directory, 'while IFS= read -r row; do printf "%s\\n" "$row"; done < "$here/table"');
  const ps = fixture(directory, 'ps', cut.body);

  const failed = killIn(directory, { ps, readTimeout: 300 }).then(() => undefined, (error) => error);
  await cut.started();
  const error = await failed;

  assert.ok(error, 'the cut table authorized the recorded kill');
  assert.match(error.message, /process-table read timed out after 300 ms/);
  assert.doesNotMatch(error.message, /left out its leader/);
  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the recorded group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

/**
 * Stand-ins for `ps` whose first start-time read answers short, by how it does, and whose every
 * later read never answers, so the reads' deadline passes while one is running. Beside each, what
 * the failure says of the read that answered, which a read that never answered does not say. The
 * warming run exits before the body, so the read that answers is the first the call makes.
 */
const ANSWERED_SHORT = {
  'lists no process of the group': ['exit 1', () => /listed no process of the group/],
  'leaves out its live leader': [PRINTS_TABLE, (group) => new RegExp(`left out its leader, pid ${group},`)],
};

for (const [how, [body, cause]] of Object.entries(ANSWERED_SHORT)) {
  test(`given a recorded group whose first start-time read ${how} and whose next never answers, the call kills no process of that group, fails saying what the read that answered left out, and the record still holds that entry`, SETTLES_WITHIN, async (t) => {
    const directory = scratch(t);
    const started = await startGroup(t, directory, 'group');
    const entry = entryFor(started, { dispatch: 'd-short', card: 36 });
    writeGroups(stateOf(directory), [entry]);
    writeTableLess(directory, started.group);
    const ps = fixture(directory, 'ps', ['/bin/mkdir "$here/answered" 2>/dev/null || exec /usr/bin/tail -f "$here/hold"', body].join('\n'));

    await assert.rejects(killIn(directory, { ps, readTimeout: 300 }), (failure) => {
      for (const named of [`group ${started.group}`, 'd-short', '#36']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
      assert.match(failure.message, cause(started.group), `the failure does not say what the read that answered left out: ${failure.message}`);
      return true;
    });

    assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
    assert.deepEqual(readGroups(stateOf(directory)), [entry]);
  });
}

test('given a recorded group and no time to read its start times, the call reads nothing, kills no process of that group, fails saying the reads ran out of time, and the record still holds that entry', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  const entry = entryFor(started, { dispatch: 'd-no-time', card: 37 });
  writeGroups(stateOf(directory), [entry]);
  // A read of `ps` that ran would mark `read`, and answer as `ps` does.
  const ps = fixture(directory, 'ps', `: > "$here/read"\nexec ${shellQuote(PS)} "$@"`);

  await assert.rejects(killIn(directory, { ps, readTimeout: 0 }), (failure) => {
    for (const named of [`group ${started.group}`, 'd-no-time', '#37']) assert.ok(failure.message.includes(named), `the failure does not name ${named}: ${failure.message}`);
    assert.match(failure.message, /the reads of the process table did not finish within 0 ms/, `the failure does not say the reads ran out of time: ${failure.message}`);
    return true;
  });

  assert.equal(existsSync(join(directory, 'read')), false, 'a read of the process table ran');
  assert.equal(alive(started.leader) && alive(started.member), true, 'a process of the group was killed');
  assert.deepEqual(readGroups(stateOf(directory)), [entry]);
});

/** A sink whose stream lies under a regular file in `directory`, so it refuses every append. */
function refusingSink(directory) {
  writeFileSync(join(directory, 'blocked'), '');
  return openSink({ directory: join(directory, 'blocked', 'state'), run: 'r-test', now: () => 0 });
}

/** What `call` rejects with; it fails the test where the call settles. */
const failureOf = (call) => call.then(() => assert.fail('the call settled without rejecting'), (error) => error);

/**
 * Asserts that `failure` names, each on a line of its own, the kill of every process of each
 * group `named` holds, by its pid, under that group's dispatch id and card.
 */
function assertNamesKills(failure, named) {
  const lines = failure.message.split('\n');
  for (const [started, dispatch, card] of named) {
    for (const pid of [started.leader, started.member]) {
      assert.ok(lines.some((line) => line.includes(`"pid":${pid}`) && line.includes(dispatch) && line.includes(`#${card}`)), `the failure does not name the kill of ${pid} under ${dispatch} and #${card}: ${failure.message}`);
    }
  }
}

/** Two groups started outside Rigger in `directory`, both recorded in its state directory. */
async function twoRecorded(t, directory) {
  const one = await startGroup(t, directory, 'one');
  const other = await startGroup(t, directory, 'other');
  writeGroups(stateOf(directory), [entryFor(one, { dispatch: 'd-one', card: 11 }), entryFor(other, { dispatch: 'd-other', card: 22 })]);
  return { pids: [one.leader, one.member, other.leader, other.member], named: [[one, 'd-one', 11], [other, 'd-other', 22]] };
}

test('given a sink that refuses every append and two recorded groups, every process of both is dead, the record holds neither entry, and the call rejects naming every unrecorded kill with its dispatch id and card', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const { pids, named } = await twoRecorded(t, directory);

  // The record, in the state directory, still takes writes.
  const failure = await failureOf(killRecordedGroups({ directory: stateOf(directory), sink: refusingSink(directory) }));

  for (const pid of pids) assert.equal(alive(pid), false, `process ${pid} is alive`);
  assert.deepEqual(readGroups(stateOf(directory)), []);
  assertNamesKills(failure, named);
});

test('given a sink that refuses every append and a record that refuses its rewrite, the call still rejects naming every unrecorded kill, with the record\'s failure on it', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const { pids, named } = await twoRecorded(t, directory);
  const state = stateOf(directory);
  // The state directory refuses new entries, so the record can be read but not rewritten.
  chmodSync(state, 0o555);
  t.after(() => chmodSync(state, 0o755));

  const failure = await failureOf(killRecordedGroups({ directory: state, sink: refusingSink(directory) }));

  for (const pid of pids) assert.equal(alive(pid), false, `process ${pid} is alive`);
  assertNamesKills(failure, named);
  assert.equal(failure.recordFailure?.code, 'EACCES', 'the rewrite\'s failure is not carried on the failure');
  assert.ok(failure.message.includes(state), `the failure does not say the record in ${state} was not rewritten: ${failure.message}`);
});
