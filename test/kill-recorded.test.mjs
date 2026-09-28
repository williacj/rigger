// ABOUTME: Tests L1's kill of recorded groups: on a start, it ends each process group a dead engine
// recorded, once L0 has confirmed the group is the one recorded, and empties the record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { killRecordedGroups } from '../src/execution/run.mjs';
import { readGroups, recordPath, writeGroups } from '../src/execution/groups.mjs';
import { alive, fixture, scratch, startOf, until } from './process-fixtures.mjs';

// A bound on the test alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on it when the call settles.
const SETTLES_WITHIN = { timeout: 20_000 };

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

/**
 * Starts, outside Rigger, a process group named `name` in `directory`, as a dead engine leaves
 * one: its leader is no child of this process, so the system reaps it once it dies, as it does a
 * group whose engine was killed. The leader is a shell, which starts a `tail` that runs until
 * killed. Settles once the `tail` runs, on the group's id, which is its leader's pid, the
 * leader's start time, and the member's pid, or rejects once the test `t` ends first.
 */
async function startGroup(t, directory, name) {
  if (!existsSync(join(directory, 'hold'))) writeFileSync(join(directory, 'hold'), '');
  const script = fixture(directory, name, [
    '/usr/bin/tail -f "$here/hold" &',
    'while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done',
    'echo $$ $! > "$0.tmp" && /bin/mv "$0.tmp" "$0.pids"',
    'wait',
  ].join('\n'));
  // Perl forks, and the fork makes a group of its own and runs the script as its leader, while
  // the process this spawned exits.
  const launcher = spawn('/usr/bin/perl', ['-e', 'exit if fork; setpgrp(0, 0); exec @ARGV or die', script], { stdio: 'ignore' });
  await once(launcher, 'exit');
  await until(() => existsSync(`${script}.pids`), t);
  const [leader, member] = readFileSync(`${script}.pids`, 'utf8').trim().split(' ').map(Number);
  return { group: leader, leader, started: startOf(leader), member };
}

/**
 * Ends `started`'s leader alone, and settles once it is gone, leaving its member in the group, or
 * rejects once the test `t` ends first.
 */
async function withoutLeader(t, started) {
  process.kill(started.leader, 'SIGKILL');
  await until(() => !alive(started.leader), t);
  return started;
}

/** The record's entry for the group `started`, under dispatch `d-1` and card 1412 unless `extra` says otherwise. */
const entryFor = ({ group, started }, extra = {}) => ({ group, started, dispatch: 'd-1', card: 1412, ...extra });

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

test('given a recorded group whose leader\'s start time matches, the stream records each kill by name and command line, under the entry\'s dispatch id and card', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const started = await startGroup(t, directory, 'group');
  writeGroups(stateOf(directory), [entryFor(started, { dispatch: 'd-7f3a', card: 77 })]);

  await killIn(directory);

  // `ps` names a script `/bin/sh` runs as `bash`, which is what runs it on macOS.
  const under = { layer: 'L0', dispatch: 'd-7f3a', card: 77 };
  assert.deepEqual(killsIn(directory).sort((one, other) => one.pid - other.pid), [
    { ...under, pid: started.leader, name: 'bash', cmd: `/bin/sh ${join(directory, 'group')}` },
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
    'my $first = time(); 1 while time() <= $first;',
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

test('given a record whose content cannot be read as entries, the call kills nothing, and fails naming the record\'s file', SETTLES_WITHIN, async (t) => {
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
  for (const content of contents) {
    const directory = scratch(t);
    const started = await startGroup(t, directory, 'group');
    // A readable entry naming the live group follows the unreadable content wherever it can, so a
    // call that read past the fault would kill it.
    const state = stateOf(directory);
    writeGroups(state, [entryFor(started)]);
    writeFileSync(recordPath(state), content.startsWith('[{') && content.endsWith(']') ? `${content.slice(0, -1)}, ${JSON.stringify(entryFor(started))}]` : content);

    await assert.rejects(killIn(directory), (failure) => {
      assert.ok(failure.message.includes(recordPath(state)), `given ${content}, the failure does not name the record's file: ${failure.message}`);
      return true;
    }, content);

    assert.equal(alive(started.leader) && alive(started.member), true, `given ${content}, a process of the group was killed`);
  }
});

/**
 * A stand-in for `ps` in `directory` that never answers: it follows a file nothing writes to. Its
 * path, and so the directory, is in its command line, so the teardown ends any left running.
 */
const silentPs = (directory) => fixture(directory, 'ps', 'exec /usr/bin/tail -f "$here/hold"');

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
