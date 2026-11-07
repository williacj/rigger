// ABOUTME: Tests L5's push of the event stream at a config-reading verb's normal return, run in
// process against a real git with a local bare origin: whether a verb pushes, what `push.end`
// holds, and what a push that did not succeed leaves of the verb's answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import template from '../templates/rigger.config.mjs';
import { validate } from '../src/config/validate.mjs';
import { doctor } from '../src/cli/doctor.mjs';
import { init } from '../src/cli/init.mjs';
import { once } from '../src/cli/once.mjs';
import { pause } from '../src/cli/pause.mjs';
import { plan } from '../src/cli/plan.mjs';
import { recording } from '../src/cli/recording.mjs';
import { report } from '../src/cli/report.mjs';
import { resume } from '../src/cli/resume.mjs';
import { run as runVerb } from '../src/cli/run.mjs';
import { PUSH_DEFAULTS, pushAtReturn } from '../src/observation/push.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { DATA_REF, pushStream } from '../src/substrate/data-ref.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { EVENT_REFUSED, NOT_STARTED } from '../src/substrate/process.mjs';
import { writeWhole } from '../src/substrate/standard-error.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { assertPushEnd, held } from './push-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';

/**
 * The template's config for the consumer's board, which the validator admits, with no `telemetry`
 * key at all: the template's own `telemetry: { push: false }` is left out, so a test that gives none
 * runs with telemetry absent.
 */
const { telemetry: _templateTelemetry, ...TEMPLATE } = template;
const ADMITTED = { ...TEMPLATE, repo: REPO, board: { ...TEMPLATE.board, project: 3 } };

/**
 * The clock every push here reads unless a test names another: one that never moves, so code under
 * a deterministic test reads only a clock the test injects.
 */
const STILL = () => 0;

/**
 * A spawn with `runCommand`'s contract, one argument object in and `{ exit, timedOut, stdout,
 * stderr }` out with both streams as buffers, that runs the real `git` it is asked for, as
 * `test/data-ref.test.mjs`'s does: the deterministic tier admits `git` and refuses L0's process
 * adapter. Each call is recorded in `calls`, and `before`, where given, runs ahead of each call with
 * its arguments.
 */
function realGit(calls, before = () => {}) {
  return async (call) => {
    await before(call.args);
    const child = spawn(call.command, call.args, { cwd: call.cwd, env: call.env, stdio: [call.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (call.input !== undefined) child.stdin.end(call.input);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const exit = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    const result = { exit, timedOut: false, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
    calls.push({ ...call, result });
    return result;
  };
}

/**
 * The guard's `git`, standing in for `doctor.mjs`'s `asked`: it runs the real `git` and answers as
 * `asked` does. Where `mark` holds, it also hands the `L0` emitter it is given one stand-in event,
 * as L0 records a kill there, so the stream holds a line of the run's own; `asked` itself records
 * no `call.end` ("L0's call events").
 */
const asking = ({ mark = true } = {}) => async (command, args, { emitter }) => {
  const said = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  if (mark) emitter.emit('stand-in.asked', { args });
  return { status: said.status, timedOut: false, stdout: said.stdout, stderr: said.stderr };
};

/** A forge that fails every call, standing in for the `gh` the forge adapter sends through. */
const failingForge = async () => ({ status: 1, stdout: '', stderr: 'no forge stands here' });

/**
 * A consumer's repository holding `config` as its `rigger.config.mjs`, with a local bare `origin`
 * beside it and a worktree root inside its tree, under a directory of the test's own. `source`,
 * where given, is the config file's text instead. `once` and `run` refuse that worktree root, which
 * is the normal return they reach in process: the workspace adapter they build next spawns through
 * L0's process adapter, which the deterministic tier refuses.
 */
function world(t, config = ADMITTED, { source } = {}) {
  const directory = temporaryDirectory('rigger-telemetry-push-', { context: t });
  const repository = join(directory, 'consumer');
  const root = join(repository, 'worktrees');
  const text = source ?? `export default ${JSON.stringify({ ...config, worktrees: { ...config.worktrees, root } })};\n`;
  repositoryAt(repository, { 'rigger.config.mjs': text, 'worktrees/.keep': '' });
  const origin = join(directory, 'origin.git');
  withOrigin(repository, origin);
  return { directory, repository, origin, state: join(repository, '.rigger') };
}

/**
 * A config whose default export, `telemetry.push` false, is a live binding the test switches
 * through `globalThis[key]` to one with `telemetry.push` true: plain data either way, and no
 * accessor. `consumerConfig` reads a file once per process, so a run reads the switched value
 * only where it is the first read of that file by its instance of `doctor.mjs`.
 */
function switchable(key) {
  const config = { ...ADMITTED };
  return `const config = { ...${JSON.stringify(config)}, worktrees: { root: new URL('./worktrees', import.meta.url).pathname } };\nlet value = { ...config, telemetry: { push: false } };\nexport { value as default };\nglobalThis[${JSON.stringify(key)}] = () => { value = { ...config, telemetry: { push: true } }; };\n`;
}

/**
 * `doctor` from a second instance of `src/cli/doctor.mjs`, standing in for a run in another
 * process: it holds its own reads of each config file, apart from the instance the verbs import.
 */
const { doctor: doctorElsewhere } = await import('../src/cli/doctor.mjs?elsewhere');

/** The verbs `offThenOn` runs with the push off, each from the instance `doctorElsewhere` is. */
const ELSEWHERE = {
  doctor: (w, push, ask = asking()) => answerOf('doctor', doctorElsewhere({ target: w.repository, ask, checks: [], push })),
};

/**
 * The verb's answer, failing on an assertion where it ends by a throw instead: no push, and no push
 * that did not succeed, may end a verb that way.
 */
const answerOf = (verb, running) => running.then((answer) => answer, (thrown) => assert.fail(`${verb} threw: ${thrown?.message ?? thrown}`));

/** The config-reading verbs that run in process, each run in `w` with `push` and the guard's `ask`. */
const IN_PROCESS = {
  doctor: (w, push, ask = asking()) => answerOf('doctor', doctor({ target: w.repository, ask, checks: [], push })),
  plan: (w, push, ask = asking()) => answerOf('plan', plan({ target: w.repository, ask, send: failingForge, push })),
  once: (w, push, ask = asking()) => answerOf('once', once({ target: w.repository, ask, send: failingForge, push })),
  run: (w, push, ask = asking()) => answerOf('run', runVerb({ target: w.repository, ask, send: failingForge, push })),
};

/** The verbs that read no config, each run in `w` with `push`. */
const NO_CONFIG = {
  init: (w, push) => answerOf('init', init({ target: w.repository, ask: asking(), push })),
  report: (w, push) => answerOf('report', report({ target: w.repository, ask: asking(), push })),
  pause: (w, push) => answerOf('pause', pause({ target: w.repository, ask: asking(), push })),
  resume: (w, push) => answerOf('resume', resume({ target: w.repository, ask: asking(), push })),
};

/**
 * L5's push as `src/cli/verbs.mjs` builds it, over the real push side with a real-git spawn, and a
 * writer standing in for `writeWhole`. Each push the side settles is kept in `pushes`, with what it
 * was handed and what it answered, each `git` call in `calls`, and each line written in `lines`.
 * `side` stands in for the push side itself where given.
 */
function pushing({ side, before, now = STILL } = {}) {
  const pushes = [];
  const calls = [];
  const lines = [];
  const real = side ?? pushStream;
  const watched = async (given) => {
    const entry = { given, stream: Buffer.from(given.stream) };
    pushes.push(entry);
    entry.answered = await real(given);
    return entry.answered;
  };
  const push = pushAtReturn({ side: watched, spawn: realGit(calls, before), write: (line) => lines.push(line), now });
  return { push, pushes, calls, lines };
}

/** Every event of `w`'s stream, or none where it has no stream. */
const eventsOf = (w) => (existsSync(join(w.state, 'events.jsonl')) ? readEvents(w.state) : []);

/** The `push.end` events of `w`'s stream. */
const pushEnds = (w) => eventsOf(w).filter(({ event }) => event === 'push.end');

/** The commit origin's data ref names, or undefined where it names none. */
const tipOf = (w) => gitIn(w.origin, 'for-each-ref', '--format=%(objectname)', DATA_REF).trim() || undefined;

/** The bytes of `events.jsonl` in origin's commit `commit`. */
const pushedStream = (w, commit) => Buffer.from(gitIn(w.origin, 'cat-file', 'blob', `${commit}:events.jsonl`));

/**
 * Asserts the push side was never reached: `watch` saw no push and no `git` call, no `git` call
 * named the data ref or the push's own remote, origin holds no data ref, and `w`'s stream holds no
 * `push.end`.
 */
function assertNoPush(w, watch, said) {
  assert.equal(watch.pushes.length, 0, `${said}: the push side was reached`);
  assert.deepEqual(watch.calls.filter(({ args }) => args.some((arg) => arg.includes(DATA_REF) || arg.includes('rigger-data-push'))), [], said);
  assert.equal(watch.calls.length, 0, said);
  assert.equal(tipOf(w), undefined, `${said}: origin holds the data ref`);
  assert.deepEqual(pushEnds(w), [], said);
}

/** Asserts no run in `w`'s stream recorded more than one `push.end`. */
function assertOnePerRun(w) {
  const counts = new Map();
  for (const { run } of pushEnds(w)) counts.set(run, (counts.get(run) ?? 0) + 1);
  for (const [run, count] of counts) assert.ok(count <= 1, `run ${run} recorded ${count} push.end events`);
}

/** Asserts `line` is reading 3's one line, naming `answered`'s outcome and reason. */
function assertFailureLine(lines, answered) {
  assert.equal(lines.length, 1, lines.join(''));
  assert.ok(lines[0].endsWith('\n') && lines[0].indexOf('\n') === lines[0].length - 1, `not one line: ${JSON.stringify(lines[0])}`);
  assert.ok(lines[0].includes(answered.outcome), lines[0]);
  assert.ok(lines[0].includes(answered.reason.split('\n').filter(Boolean)[0]), lines[0]);
}

/**
 * Runs `verb` in `w` twice over its switchable config, with `watch`: with the push off, as another
 * process would, and then, the config switched, with it on. Answers both answers and the one push
 * the second run made.
 */
async function offThenOn(w, key, verb, watch) {
  const off = await ELSEWHERE[verb](w, watch.push);
  assert.equal(watch.pushes.length, 0, 'the run with the push off pushed');
  globalThis[key]();
  const on = await IN_PROCESS[verb](w, watch.push);
  return { off, on };
}

/**
 * `doctor`'s answer in `w` with the push off, as another process would run it, which every later
 * answer there is held to; the config is then switched, so each later run has the push on.
 */
async function offAnswer(w, key, watch) {
  const off = await ELSEWHERE.doctor(w, watch.push);
  globalThis[key]();
  return off;
}

let switches = 0;
/** A world whose config switches the push off and on, and the key that switches it. */
function switching(t) {
  const key = `rigger-telemetry-push-${switches += 1}`;
  t.after(() => delete globalThis[key]);
  return { key, w: world(t, ADMITTED, { source: switchable(key) }) };
}

// proves R-SAFE-3
test('C1, C2, C3: each config-reading verb run in process, its config admitted with telemetry absent, telemetry.push absent, false, \'true\', 1 or {}, reaches no push side', async (t) => {
  const telemetries = [undefined, {}, { push: false }, { push: 'true' }, { push: 1 }, { push: {} }];
  for (const verb of Object.keys(IN_PROCESS)) {
    for (const telemetry of telemetries) {
      const config = telemetry === undefined ? ADMITTED : { ...ADMITTED, telemetry };
      const w = world(t, config);
      const watch = pushing();
      const answer = await IN_PROCESS[verb](w, watch.push);
      const said = `${verb}, telemetry ${JSON.stringify(telemetry)}: ${answer.text}`;
      assert.equal(Object.hasOwn(config, 'telemetry'), telemetry !== undefined, said);
      assert.ok(eventsOf(w).length > 0, `${said}: the verb named no state directory, so this proves nothing`);
      assertNoPush(w, watch, said);
    }
  }
});

// proves R-SAFE-3
test('C4: init, report, pause and resume, each handed L5\'s push in a repository whose config holds telemetry.push true, reach no push side', async (t) => {
  for (const verb of Object.keys(NO_CONFIG)) {
    const w = world(t, { ...ADMITTED, telemetry: { push: true } });
    const watch = pushing();
    const answer = await NO_CONFIG[verb](w, watch.push);
    assertNoPush(w, watch, `${verb}: ${answer.text}`);
  }
});

// proves R-SAFE-3
test('C5: each config-reading verb run in process, its config refused by the validator and holding telemetry.push true, reaches no push side', async (t) => {
  const { board, ...unboarded } = ADMITTED;
  // Two refusals: a config missing its board, and one whose telemetry declares a key Rigger offers not.
  for (const refused of [{ ...unboarded, telemetry: { push: true } }, { ...ADMITTED, telemetry: { push: true, extra: true } }]) {
    assert.notDeepEqual(validate(refused), [], 'the validator admits the config, so this proves nothing');
    for (const verb of Object.keys(IN_PROCESS)) {
      const w = world(t, refused);
      const watch = pushing();
      const answer = await IN_PROCESS[verb](w, watch.push);
      assert.ok(eventsOf(w).length > 0, `${verb}: the verb named no state directory, so this proves nothing`);
      assertNoPush(w, watch, `${verb}: ${answer.text}`);
    }
  }
});

// proves R-RECORD-13
test('C6: each config-reading verb run in process, telemetry.push true, pushes once at its return the stream as it stood, then records one push.end', async (t) => {
  for (const verb of Object.keys(IN_PROCESS)) {
    const w = world(t, { ...ADMITTED, telemetry: { push: true } });
    const watch = pushing();
    const answer = await IN_PROCESS[verb](w, watch.push);
    const said = `${verb}: ${answer.text}`;
    assert.equal(watch.pushes.length, 1, said);
    assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
    const [{ given, stream, answered }] = watch.pushes;
    assert.equal(given.repository, w.repository, said);
    const lines = readFileSync(join(w.state, 'events.jsonl'));
    // The stream as the push read it is the stream now, but for the push.end recorded after it.
    assert.deepEqual(stream, lines.subarray(0, lines.lastIndexOf(0x0a, lines.length - 2) + 1), said);
    assert.equal(answered.outcome, 'pushed', `${said}: ${answered.reason}`);
    assert.deepEqual(pushedStream(w, answered.commit), held(stream), said);
    const ends = pushEnds(w);
    assert.equal(ends.length, 1, said);
    assert.equal(eventsOf(w).at(-1).event, 'push.end', `${said}: push.end is not the run's last event`);
    assert.equal(ends[0].run, eventsOf(w)[0].run, said);
    assertPushEnd(ends[0], answered);
    assertOnePerRun(w);
  }
});

// proves R-SAFE-3
test('C7: each config-reading verb run in process, telemetry.push true, whose guard refuses its target, names no state directory and reaches no push side', async (t) => {
  for (const verb of Object.keys(IN_PROCESS)) {
    const w = world(t, { ...ADMITTED, telemetry: { push: true } });
    const watch = pushing();
    // A guard whose git names no repository, so the guard refuses the target.
    const refusing = async () => ({ status: 128, timedOut: false, stdout: '', stderr: 'fatal: not a git repository' });
    const answer = await IN_PROCESS[verb](w, watch.push, refusing);
    assert.equal(answer.code, 1, `${verb}: ${answer.text}`);
    assert.match(answer.text, /git names no repository/, `${verb}: ${answer.text}`);
    assert.equal(existsSync(w.state), false, `${verb}: a state directory was named`);
    assertNoPush(w, watch, `${verb}: ${answer.text}`);
  }
});

// proves R-SAFE-3
test('C8: a real doctor run, telemetry.push true, whose run writes no line to a stream earlier runs wrote, reaches no push side', async (t) => {
  const w = world(t, { ...ADMITTED, telemetry: { push: true } });
  mkdirSync(w.state);
  const earlier = `${JSON.stringify({ ts: '2026-10-29T00:00:00.000Z', run: 'an-earlier-run', layer: 'L0', event: 'stand-in.asked', dispatch: null })}\n`;
  writeFileSync(join(w.state, 'events.jsonl'), earlier);
  const watch = pushing();
  const answer = await IN_PROCESS.doctor(w, watch.push, asking({ mark: false }));
  assert.equal(answer.code, 0, answer.text);
  assertNoPush(w, watch, answer.text);
  assert.equal(readFileSync(join(w.state, 'events.jsonl'), 'utf8'), earlier, 'the run wrote a line, so this proves nothing');
});

// proves R-SAFE-3
test('C10: a verb whose work never returns, ended as a signal or L0\'s exit cleanup ends it, makes no push', async (t) => {
  for (const ending of ['SIGHUP', 'exit cleanup']) {
    const w = world(t, { ...ADMITTED, telemetry: { push: true } });
    const watch = pushing();
    let reached;
    const reaching = new Promise((resolve) => { reached = resolve; });
    // A check that never settles, as a verb the process ends under: it hands back the sink, whose
    // end is the last step L0's exit cleanup takes.
    const hanging = ({ sink }) => {
      reached(sink);
      return new Promise(() => {});
    };
    const running = doctor({ target: w.repository, ask: asking(), checks: [hanging], push: watch.push });
    const sink = await reaching;
    if (ending === 'SIGHUP') {
      const kept = () => {};
      process.on('SIGHUP', kept);
      t.after(() => process.off('SIGHUP', kept));
      const delivered = new Promise((resolve) => process.once('SIGHUP', resolve));
      process.kill(process.pid, 'SIGHUP');
      await delivered;
    }
    sink.end();
    assert.equal(await Promise.race([running.then(() => 'returned'), Promise.resolve('still running')]), 'still running');
    assertNoPush(w, watch, ending);
  }
});

// proves R-SAFE-3
test('recording handed no push, as the gate script calls it, with a config holding telemetry.push true named, reaches no push side', async (t) => {
  const w = world(t, { ...ADMITTED, telemetry: { push: true } });
  const answer = await recording(({ sink, name, admitted }) => {
    name(w.repository);
    admitted({ ...ADMITTED, telemetry: { push: true } });
    sink.emitter({ layer: 'L0' }).emit('stand-in.asked', {});
    return { text: 'done', code: 0 };
  });
  assert.deepEqual(answer, { text: 'done', code: 0 });
  assert.deepEqual(pushEnds(w), []);
  assert.equal(tipOf(w), undefined, 'origin holds the data ref');
  assert.equal(eventsOf(w).length, 1);
});

test('the push module\'s writer, where its caller injects none, is writeWhole from standard-error.mjs', () => {
  assert.equal(PUSH_DEFAULTS.write, writeWhole);
  assert.equal(PUSH_DEFAULTS.side, pushStream);
});

// proves R-RECORD-13
test('O1, O2: a doctor push that succeeds onto an absent data ref pushes the stream as it stood at the push\'s start in a commit with no parent, and leaves the answer as with the push off and writes nothing', async (t) => {
  const { key, w } = switching(t);
  // L5's clock reads 1,000 at the push's start and 1,250 from then on, so `ms` is 250.
  let reads = 0;
  const watch = pushing({ now: () => (reads++ === 0 ? 1_000 : 1_250) });
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.deepEqual(on, off);
  assert.deepEqual(watch.lines, []);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  const [{ stream, answered }] = watch.pushes;
  assert.equal(answered.outcome, 'pushed', answered.reason);
  assert.equal(tipOf(w), answered.commit);
  assert.deepEqual(pushedStream(w, answered.commit), held(stream));
  assert.equal(gitIn(w.origin, 'rev-list', '--parents', '-n', '1', answered.commit).trim(), answered.commit, 'the first push\'s commit has a parent');
  const [end] = pushEnds(w);
  assertPushEnd(end, answered);
  assert.equal(Object.hasOwn(end, 'parent'), false);
  assert.equal(end.ms, 250);
  assertOnePerRun(w);
});

// proves R-RECORD-14, R-RECORD-15, R-RECORD-18
test('O3: a doctor push origin\'s pre-receive hook refuses records push.end refused with the push side\'s reason, writes one line naming it, and leaves the answer as with the push off', async (t) => {
  const { key, w } = switching(t);
  const hook = join(w.origin, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "the data ref is closed here" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  const watch = pushing();
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.deepEqual(on, off);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  const [{ answered }] = watch.pushes;
  assert.equal(answered.outcome, 'refused', answered.reason);
  assert.match(answered.reason, /the data ref is closed here/);
  assertPushEnd(pushEnds(w)[0], answered);
  assertFailureLine(watch.lines, answered);
  assert.equal(tipOf(w), undefined);
  assertOnePerRun(w);
});

// proves R-RECORD-17, R-RECORD-15, R-RECORD-18
test('O4: a doctor push whose earlier git calls spend its whole limit hands each call what is left of it, records push.end timed-out, writes one line naming it, and leaves the answer as with the push off', async (t) => {
  const { key, w } = switching(t);
  // One clock for L5 and the push side. Each git call takes 5,000 ms on it, so the push's six calls
  // before `git push` spend its whole 30,000 ms, and `git push` is never started.
  let clock = 0;
  const calls = [];
  const real = realGit(calls);
  const handed = [];
  const timed = async (call) => {
    handed.push({ subcommand: call.args[0] === '-c' ? call.args[2] : call.args[0], timeout: call.timeout });
    const result = await real(call);
    clock += 5_000;
    return result;
  };
  const watch = pushing({ side: (given) => pushStream({ ...given, spawn: timed }), now: () => clock });
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.deepEqual(on, off);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  const [{ answered }] = watch.pushes;
  // Each call is handed `PUSH_TIMEOUT` less what the calls before it took, worked out by hand.
  assert.deepEqual(handed, [
    { subcommand: 'remote', timeout: 30_000 },
    { subcommand: 'remote', timeout: 25_000 },
    { subcommand: 'ls-remote', timeout: 20_000 },
    { subcommand: 'hash-object', timeout: 15_000 },
    { subcommand: 'mktree', timeout: 10_000 },
    { subcommand: 'commit-tree', timeout: 5_000 },
  ]);
  assert.equal(answered.outcome, 'timed-out', answered.reason);
  assert.match(answered.reason, /limit of 30000 ms was spent before git push started/);
  assert.equal(tipOf(w), undefined, 'origin holds the data ref');
  const [end] = pushEnds(w);
  assertPushEnd(end, answered);
  assert.equal(end.ms, 30_000);
  assertFailureLine(watch.lines, answered);
  assertOnePerRun(w);
});

// proves R-RECORD-14, R-RECORD-15, R-RECORD-18
test('O5: a doctor push whose git never starts, or whose repository has no origin, records push.end failed, writes one line naming it, and leaves the answer as with the push off', async (t) => {
  for (const host of ['git never starts', 'no origin']) {
    const { key, w } = switching(t);
    let side;
    if (host === 'git never starts') {
      // The process adapter's failure for a command that never started, as `runCommand` rejects.
      const never = async () => { throw Object.assign(new Error('spawn git ENOENT'), { code: NOT_STARTED }); };
      side = (given) => pushStream({ ...given, spawn: never });
    } else gitIn(w.repository, 'remote', 'remove', 'origin');
    const watch = pushing({ side });
    const { off, on } = await offThenOn(w, key, 'doctor', watch);
    assert.deepEqual(on, off, host);
    assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
    const [{ answered }] = watch.pushes;
    assert.equal(answered.outcome, 'failed', `${host}: ${answered.reason}`);
    assertPushEnd(pushEnds(w)[0], answered);
    assertFailureLine(watch.lines, answered);
    assertOnePerRun(w);
  }
});

// proves R-RECORD-16
test('O6: after two doctor pushes origin refused, a doctor push that succeeds copies every event the stream held at its start, each earlier push.end included', async (t) => {
  const { key, w } = switching(t);
  const hook = join(w.origin, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  const watch = pushing();
  const off = await offAnswer(w, key, watch);
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.deepEqual(watch.pushes.map(({ answered }) => answered.outcome), ['refused', 'refused']);
  assert.equal(watch.lines.length, 2, watch.lines.join(''));
  for (const [index, line] of watch.lines.entries()) assertFailureLine([line], watch.pushes[index].answered);
  writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.equal(watch.lines.length, 2, 'the push that succeeded wrote a line');
  const last = watch.pushes.at(-1);
  assert.equal(last.answered.outcome, 'pushed', last.answered.reason);
  const copied = pushedStream(w, last.answered.commit).toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(copied.filter(({ event }) => event === 'push.end').length, 2);
  assert.deepEqual(copied, eventsOf(w).slice(0, -1));
  for (const [index, end] of pushEnds(w).entries()) assertPushEnd(end, watch.pushes[index].answered);
  assertOnePerRun(w);
});

// proves R-RECORD-13
test('O7: an event appended while a doctor push is in flight is not in that push\'s copy, and the next push\'s copy holds it', async (t) => {
  const { key, w } = switching(t);
  const late = `${JSON.stringify({ ts: '2026-10-29T00:00:00.000Z', run: 'another-writer', layer: 'L0', event: 'stand-in.late', dispatch: null })}\n`;
  let appended = false;
  const watch = pushing({
    before: (args) => {
      if (!appended && args.includes('hash-object')) {
        appended = true;
        appendFileSync(join(w.state, 'events.jsonl'), late);
      }
    },
  });
  const off = await offAnswer(w, key, watch);
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  const first = watch.pushes[0].answered;
  assert.equal(first.outcome, 'pushed', first.reason);
  assert.equal(pushedStream(w, first.commit).toString('utf8').includes('stand-in.late'), false);
  assert.ok(readFileSync(join(w.state, 'events.jsonl'), 'utf8').includes('stand-in.late'), 'the late event was never appended');
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.deepEqual(watch.lines, []);
  const second = watch.pushes[1].answered;
  assert.equal(second.outcome, 'pushed', second.reason);
  assert.ok(pushedStream(w, second.commit).toString('utf8').includes(late));
  for (const [index, end] of pushEnds(w).entries()) assertPushEnd(end, watch.pushes[index].answered);
  assertOnePerRun(w);
});

// proves R-RECORD-13
test('O8: where origin holds a commit a push sent whose verb was killed before push.end, the next doctor push builds on it and copies every event', async (t) => {
  const { key, w } = switching(t);
  // The killed verb's push: its commit reached origin, and no push.end was recorded.
  const off = await offAnswer(w, key, pushing());
  const killed = await pushStream({ repository: w.repository, stream: readFileSync(join(w.state, 'events.jsonl')), emitter: { emit: () => {} }, spawn: realGit([]), now: STILL });
  assert.equal(killed.outcome, 'pushed', killed.reason);
  assert.deepEqual(pushEnds(w), []);
  const watch = pushing();
  assert.deepEqual(await IN_PROCESS.doctor(w, watch.push), off);
  assert.deepEqual(watch.lines, []);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  const [{ answered, stream }] = watch.pushes;
  assert.equal(answered.outcome, 'pushed', answered.reason);
  assert.equal(answered.parent, killed.commit);
  assert.deepEqual(pushedStream(w, answered.commit), held(stream));
  const [end] = pushEnds(w);
  assertPushEnd(end, answered);
  assert.equal(end.parent, killed.commit);
  assertOnePerRun(w);
});

test('O9: where the push side rejects with EVENT_REFUSED, doctor exits 1 with its own text then one line naming the unrecorded event and the sink\'s error, and no line is written', async (t) => {
  const { key, w } = switching(t);
  const refusal = Object.assign(new Error('the sink refused 1 L0 event(s), so they went unrecorded:\nsurvivor.killed {"pid":7}: EACCES: permission denied'), { code: EVENT_REFUSED });
  const watch = pushing({ side: async () => { throw refusal; } });
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.equal(on.code, 1);
  assert.ok(on.text.startsWith(`${off.text}\n`), on.text);
  const added = on.text.slice(off.text.length + 1);
  assert.equal(added.includes('\n'), false, `not one line: ${added}`);
  assert.match(added, /survivor\.killed/);
  assert.match(added, /EACCES: permission denied/);
  assert.match(added, /went unrecorded/);
  assert.deepEqual(watch.lines, []);
  assert.deepEqual(pushEnds(w), []);
});

test('O10: where the sink refuses push.end, doctor exits 1 with its own text then one line naming the unrecorded push.end and the sink\'s error, and no line is written', async (t) => {
  const { key, w } = switching(t);
  const stream = join(w.state, 'events.jsonl');
  // The push settles, and then the stream refuses every append: its path is now a directory.
  const side = async (given) => {
    const answered = await pushStream({ ...given, spawn: realGit([]) });
    renameSync(stream, `${stream}.kept`);
    mkdirSync(stream);
    return answered;
  };
  const watch = pushing({ side });
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  assert.equal(watch.pushes[0].answered.outcome, 'pushed', watch.pushes[0].answered.reason);
  assert.equal(on.code, 1);
  assert.ok(on.text.startsWith(`${off.text}\n`), on.text);
  const added = on.text.slice(off.text.length + 1);
  assert.equal(added.includes('\n'), false, `not one line: ${added}`);
  assert.match(added, /push\.end/);
  assert.match(added, /went unrecorded/);
  assert.match(added, /EISDIR/);
  assert.deepEqual(watch.lines, []);
});

test('C12: a doctor run, telemetry.push true, whose stream exists but cannot be read, makes no push and answers as with the push off', async (t) => {
  const { key, w } = switching(t);
  // The stream takes appends and refuses reads: the sink appends, and L5 cannot read it back.
  mkdirSync(w.state);
  const stream = join(w.state, 'events.jsonl');
  writeFileSync(stream, '');
  chmodSync(stream, 0o200);
  t.after(() => chmodSync(stream, 0o600));
  const watch = pushing();
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.deepEqual(on, off);
  assert.deepEqual(watch.lines, []);
  chmodSync(stream, 0o600);
  assert.ok(eventsOf(w).length > 0, 'the run appended nothing, so this proves nothing');
  assertNoPush(w, watch, on.text);
});

// proves R-RECORD-14, R-RECORD-15, R-RECORD-18
test('O12: a doctor push whose push side rejects with a failure other than EVENT_REFUSED records push.end failed naming it, writes one line naming it, and answers as with the push off', async (t) => {
  const { key, w } = switching(t);
  const watch = pushing({ side: async () => { throw new Error('the push side broke here'); } });
  const { off, on } = await offThenOn(w, key, 'doctor', watch);
  assert.deepEqual(on, off);
  const ends = pushEnds(w);
  assert.equal(ends.length, 1, 'no push.end, or more than one, was recorded');
  const answered = { outcome: 'failed', reason: 'the push side broke here' };
  assertPushEnd(ends[0], answered);
  assertFailureLine(watch.lines, answered);
  assertOnePerRun(w);
});

test('O12: a doctor run, telemetry.push true, that stops on a kill event its sink refused still returns normally and pushes once', async (t) => {
  const w = world(t, { ...ADMITTED, telemetry: { push: true } });
  // A check whose forge call's kill the sink refused, as L0 rejects one: doctor stops before its next check.
  const refusing = ({ emitter }) => {
    emitter.emit('stand-in.check', {});
    throw Object.assign(new Error('the sink refused 1 L0 event(s), so they went unrecorded'), { code: EVENT_REFUSED });
  };
  const watch = pushing();
  const answer = await answerOf('doctor', doctor({ target: w.repository, ask: asking(), checks: [refusing], push: watch.push }));
  assert.equal(answer.code, 1, answer.text);
  assert.match(answer.text, /^rigger doctor: the sink refused 1 L0 event/);
  assert.equal(watch.pushes.length, 1, 'the verb made no push, or more than one');
  assert.equal(watch.pushes[0].answered.outcome, 'pushed', watch.pushes[0].answered.reason);
  const ends = pushEnds(w);
  assert.equal(ends.length, 1, 'no push.end, or more than one, was recorded');
  assertPushEnd(ends[0], watch.pushes[0].answered);
  assert.deepEqual(watch.lines, []);
});
