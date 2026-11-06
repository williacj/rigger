// ABOUTME: Proves real host forwarding through L3 and L1 during a completed maker dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { constants } from 'node:os';
import { loadavg } from 'node:os';
import { join } from 'node:path';

import { realHost } from '../src/substrate/host.mjs';
import { fixture, shellQuote } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { drive, waitFor, world } from './loop-world.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, consumerConfig } from './verb-consumer.mjs';

// Host reason: wiring.
// Rigger decision: none; L3 forwards the host unconditionally, and maker success establishes the premise.
test('L3 hands the supplied host to a completed maker dispatch for its start-identity read', BOUNDS[60_000], async () => {
  const directory = temporaryDirectory('rigger-loop-host-');
  const ps = fixture(directory, 'ps', [
    'printf "%s\n" "$*" >> "$here/reads"',
    `exec ${shellQuote(realHost.ps)} "$@"`,
  ].join('\n'));
  const warmed = spawnSync(ps, [], { env: { ...process.env, RIGGER_FIXTURE_WARMING: '1' } });
  assert.equal(warmed.status, 0, 'the process-table fixture is ready before dispatch');
  assert.equal(fs.existsSync(join(directory, 'reads')), false, 'warming records no process-table call');
  const built = world({ cards: [1], concurrency: 1, makerHold: false, host: { ...realHost, ps } });

  await drive(built);

  const completed = built.events().filter((event) => event.layer === 'L1' && event.event === 'dispatch.end' && event.card === 1);
  assert.equal(completed.length, 1, 'one ready-card maker dispatch completed');
  assert.equal(completed[0].exit, 0, 'the maker dispatch completed successfully before the forwarding oracle');
  const calls = fs.existsSync(join(directory, 'reads')) ? fs.readFileSync(join(directory, 'reads'), 'utf8').trim().split('\n') : [];
  // L0 documents its start-identity request as -p <pid> -o lstart=; this literal is independent of its helpers.
  assert.ok(calls.some((call) => /^-p [1-9][0-9]* -o lstart=$/.test(call)), 'missing L3-to-L1 host forwarding: the ready wrapper saw no start-identity request during the completed maker dispatch');
});

// Host reason: wiring and OS behaviour; the default clock's poll timer must hold the real bin open
// past the drain, and a real SIGTERM must end it through L0's exit cleanup.
// proves R-SCHED-28
test('L17: the run bin stays up past the drain and polls while a trigger is declared, and exits 143 at SIGTERM with its hand-overs whole', BOUNDS[60_000], async () => {
  const directory = temporaryDirectory('rigger-clock-run-host-');
  const config = { ...consumerConfig(1), clock: { poll: 100, triggers: { hourly: {
    interval: 3_600_000, anchor: new Date(Date.now() + 3_600_000).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), {
    'rigger.config.mjs': `export default ${JSON.stringify(config)};\n`,
  }), join(directory, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-clock-run-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [] },
  });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bin = join(root, JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);
  const child = spawn(process.execPath, [bin, 'run'], {
    cwd: consumer, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${dirname(fake.gh)}:${process.env.PATH}` },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((settle) => child.on('exit', (code, signal) => settle({ code, signal })));
  let ended;
  exited.then((exit) => { ended = exit; });
  const stream = join(consumer, '.rigger', 'events.jsonl');
  const triggers = () => (fs.existsSync(stream) ? fs.readFileSync(stream, 'utf8') : '').split('\n')
    .filter((line) => line.includes('"event":"trigger"')).map((line) => JSON.parse(line).trigger);
  // Two polls after the drain: the first pull, its drain, then two pulls more.
  await waitFor(() => ended !== undefined || triggers().filter((kind) => kind === 'pull').length >= 3, 30_000);
  assert.equal(ended, undefined, `the bin ended at the drain: ${JSON.stringify(ended)}\n${stderr}`);
  assert.deepEqual(triggers().slice(0, 3), ['pull', 'drain', 'pull'], 'the polls came after the drain');
  await waitFor(() => stdout.includes('\n'), 10_000);

  const signalled = performance.now();
  child.kill('SIGTERM');
  const exit = await exited;
  const took = performance.now() - signalled;
  // L0's exit cleanup re-raises the signal once it has cleaned up, so the process ends by SIGTERM,
  // which a shell reports as status 128 + SIGTERM's number.
  assert.deepEqual(exit, { code: null, signal: 'SIGTERM' }, stderr);
  assert.equal(128 + constants.signals[exit.signal], 143);
  assert.ok(took < 10_000, `the bin exited ${took} ms after SIGTERM, past the 10,000 ms bound`);
  assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' }, 'no process of its group survives');
  for (const line of fs.readFileSync(stream, 'utf8').split('\n').filter((each) => each !== '')) JSON.parse(line);
  assert.ok(stdout.split('\n').includes(`rigger run: from board ${PROJECT}, no card was pullable`), stdout);
});

import { run as runVerb } from '../src/cli/run.mjs';
import { pushAtReturn } from '../src/observation/push.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { gitIn } from './git-repository.mjs';
import { withFirstOnPath } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { card } from './verb-consumer.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { onClock } from './clock-report-verb-world.mjs';

/** The real claiming verb, over a local consumer, the executable forge double and a delivered card. */
function pushedRun({ side, work = true, refuseEnd = false }) {
  const directory = temporaryDirectory('rigger-drain-verb-host-');
  const clock = manualClock();
  const settings = { ...consumerConfig(1), telemetry: { push: true }, clock: { poll: 1000, triggers: { hourly: {
    interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const consumer = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const fake = installFakeGh(temporaryDirectory('rigger-drain-verb-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: work ? [card(10, 'Ready')] : [] }, origin,
  });
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const written = [];
  const returnLines = [];
  const controller = new AbortController();
  let pushes = 0;
  const push = pushAtReturn({ side: async (given) => { pushes += 1; return side(given); }, now: clock.now, write: (line) => returnLines.push(line) });
  // The sink's documented synchronous refusal contract, confined to the drain's push.end.
  const pushStep = (given) => {
    const sink = !refuseEnd || given.handOver === undefined ? given.sink : { ...given.sink, emitter: (context) => ({ emit(event, fields) {
      if (event === 'push.end') throw new Error('refused push.end');
      return given.sink.emitter(context).emit(event, fields);
    } }) };
    return push({ ...given, sink });
  };
  const running = onClock(clock, () => withFirstOnPath(dirname(fake.gh), () => withFirstOnPath(agent.dir, () => runVerb({
    target: consumer, clock, push: pushStep, write: (text) => written.push(text), stop: controller.signal,
  }))));
  running.catch(() => {});
  return { consumer, clock, written, returnLines, running, pushes: () => pushes, stop: () => { controller.abort(); return running; } };
}

// Host reason: wiring.
// Rigger decision: test/drain-push.test.mjs — D10: refused, timed-out and failed drain pushes are recorded and handed over once outside run failures
// proves R-RECORD-15, R-RECORD-18
test('D10 D11: the run verb writes a failed drain push through its writer, completes passing work, and exits zero at the test stop', BOUNDS[60_000], async (t) => {
  const w = pushedRun({ side: async () => ({ outcome: 'failed', reason: 'offline\ntry again ' }) });
  t.after(() => w.stop());
  await waitFor(() => w.written.some((text) => /so the card is in review/.test(text)), 30_000);
  assert.ok(w.written.includes('rigger: the push of the event stream to refs/rigger/events ended failed: offline; try again '), 'the verb writer receives the failed drain push line');
  assert.equal(w.pushes(), 1, 'the drain pushes before the stop');
  assert.deepEqual(w.returnLines, [], 'the return writer has not written the drain failure');
  const answer = await w.stop();
  assert.equal(answer.code, 0, answer.text);
  assert.equal(w.pushes(), 2, 'the normal return enters the same push path');
  assert.deepEqual(w.returnLines, ['rigger: the push of the event stream to refs/rigger/events ended failed: offline; try again \n']);
  assert.equal(readEvents(join(w.consumer, '.rigger')).filter(({ event }) => event === 'push.end').length, 2);
});

// Host reason: wiring.
// Rigger decision: test/drain-push.test.mjs — D13: refused push.end and refused L0 events are handed over as failures without a failed-push line
test('D13: the run verb exits nonzero naming an unrecorded drain-push event at the test stop', BOUNDS[60_000], async (t) => {
  for (const event of ['push.end', 'survivor.killed']) {
    let copies = 0;
    const w = pushedRun({ work: false, refuseEnd: event === 'push.end', side: async () => {
      if (++copies === 1 && event === 'survivor.killed') throw Object.assign(new Error('survivor.killed went unrecorded: EIO'), { code: EVENT_REFUSED });
      return { outcome: 'pushed', commit: 'a'.repeat(40) };
    } });
    t.after(() => w.stop());
    await waitFor(() => w.written.some((text) => text.includes('no card was pullable')), 30_000);
    assert.ok(w.written.some((text) => text.includes(event) && text.includes('went unrecorded')), 'the verb names what went unrecorded before its return');
    assert.equal(w.written.some((text) => text.includes('the push of the event stream')), false);
    const answer = await w.stop();
    assert.equal(answer.code, 1, answer.text);
    assert.equal(copies, 2, 'the successful return push cannot hide the earlier refused event');
    assert.deepEqual(w.returnLines, []);
  }
});

// Host reason: OS behaviour.
// Rigger decision: test/drain-push.test.mjs — a held drain push does not delay the next poll on the injected clock
// proves R-STATE-17, R-STATE-9
test('D17: SIGTERM ends the run bin and its push held by a bare origin hook, with no further push.end and whole stream lines', BOUNDS[60_000], async (t) => {
  const directory = temporaryDirectory('rigger-drain-signal-host-');
  const settings = { ...consumerConfig(1), telemetry: { push: true }, clock: { poll: 100, triggers: { hourly: {
    interval: 3_600_000, anchor: new Date(Date.now() + 3_600_000).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const origin = join(directory, 'origin.git');
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), {
    'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`,
  }), origin);
  const waiting = join(directory, 'waiting');
  // Exercise the empty file visible after opening the hook's append redirection.
  fs.writeFileSync(waiting, '');
  const published = join(directory, 'published');
  const fifo = join(directory, 'release');
  assert.equal(spawnSync('/usr/bin/mkfifo', [fifo]).status, 0);
  const hook = join(origin, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, `#!/bin/sh\nprintf '%s %s\\n' "$$" "$PPID" >> ${shellQuote(waiting)}\n: > ${shellQuote(published)}\nIFS= read -r released < ${shellQuote(fifo)}\n`);
  fs.chmodSync(hook, 0o755);
  const fake = installFakeGh(temporaryDirectory('rigger-drain-signal-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [] }, origin,
  });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bin = join(root, JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);
  const child = spawn(process.execPath, [bin, 'run'], {
    cwd: consumer, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${dirname(fake.gh)}:${process.env.PATH}` },
  });
  const pid = child.pid;
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let ended;
  let pushGroup;
  const exited = new Promise((settle) => child.once('exit', (code, signal) => { ended = { code, signal }; settle(ended); }));
  t.after(async () => {
    if (ended === undefined) process.kill(pid, 'SIGTERM');
    await exited;
    // The hook's process group was recorded while the test's own git was in flight. This also
    // contains a deliberately broken cleanup during the guarded mutation.
    if (pushGroup !== undefined) {
      try { process.kill(-pushGroup, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    child.stdout.destroy();
    child.stderr.destroy();
  });
  const state = join(consumer, '.rigger');
  const events = () => fs.existsSync(join(state, 'events.jsonl')) ? readEvents(state) : [];
  // Opening the append redirection creates waiting before printf publishes its PID line.
  await waitFor(() => ended !== undefined || fs.existsSync(published) || events().filter(({ trigger }) => trigger === 'pull').length >= 50, 30_000);
  assert.equal(ended, undefined, stderr);
  assert.ok(fs.existsSync(published), `the drain never reached the blocking receive hook\n${stderr}`);
  const readiness = fs.readFileSync(waiting, 'utf8');
  const [hookPid, receivePid] = readiness.trim().split(' ').map(Number);
  const groupRead = spawnSync('/bin/ps', ['-p', String(hookPid), '-o', 'pgid='], { encoding: 'utf8' });
  t.diagnostic(JSON.stringify({ readiness, hookPid, receivePid, groupRead: { status: groupRead.status, stdout: groupRead.stdout, stderr: groupRead.stderr }, ended, load: loadavg()[0] }));
  assert.match(readiness, /^[1-9]\d* [1-9]\d*\n$/, 'the hook publishes both PIDs as one complete line');
  assert.equal(groupRead.status, 0, 'the receive hook is in flight before the signal');
  pushGroup = Number(groupRead.stdout.trim());
  assert.ok(pushGroup > 1);
  const before = events().filter(({ event }) => event === 'push.end').length;
  process.kill(pid, 'SIGTERM');
  assert.deepEqual(await exited, { code: null, signal: 'SIGTERM' }, stderr);
  assert.equal(events().filter(({ event }) => event === 'push.end').length, before, 'exit cleanup records no push.end');
  assert.equal(fs.readFileSync(waiting, 'utf8').trim().split('\n').length, 1, 'exit cleanup starts no additional push');
  for (const group of [pid, pushGroup]) assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' }, `group ${group} survived`);
  for (const processId of [hookPid, receivePid]) assert.throws(() => process.kill(processId, 0), { code: 'ESRCH' }, `push process ${processId} survived`);
  assert.ok(events().length > 0);
  for (const line of fs.readFileSync(join(state, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)) JSON.parse(line);
});
