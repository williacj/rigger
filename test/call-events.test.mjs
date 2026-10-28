// ABOUTME: Exercises L0's forge and git call events at the process and event-sink boundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRunner, schemaWriteRunner, itemWriteRunner, repositoryWriteRunner } from '../src/substrate/forge/runners.mjs';
import { fixture, holding, withFirstOnPath } from './process-fixtures.mjs';
import { OUTLIVED } from './process-fixtures.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { leave, TAIL } from './process-fixtures.mjs';
import { workspaces } from '../src/substrate/worktrees.mjs';
import { repositoryAt } from './git-repository.mjs';
import { join } from 'node:path';
import { clonedFromOrigin, gitIn } from './git-repository.mjs';
import { gitRacing, read } from './process-fixtures.mjs';
import { dirname } from 'node:path';
import { FETCH_TRIES } from '../src/substrate/worktrees.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { existsSync } from 'node:fs';
import { asked, ghAuth } from '../src/cli/doctor.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { loadedJob } from '../src/substrate/launchd.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { until, ended, gone } from './process-fixtures.mjs';
import { spawnSync } from 'node:child_process';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { markerComment } from './fake-repository.mjs';
import rigger from '../rigger.config.mjs';

const moduleAt = (path) => JSON.stringify(new URL(path, import.meta.url).href);

/** A caller in its own process, whose output is retained and whose recorded child is ended on teardown. */
function caller(t, directory, code) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: directory, env: { ...gitEnvironment(), PATH: `${directory}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => ended(child));
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ran = new Promise((resolve) => child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return { child, ran };
}

/** Records exactly the fields L0 supplies, before any sink adds its envelope. */
function recorder() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

/** The field set and wall-time bound in ARCHITECTURE.md's "L0's call events" table. */
function callEnd(event, expected, elapsed) {
  assert.ok(event, 'the call recorded no call.end');
  const { ms, ...fields } = event;
  assert.deepEqual(fields, { event: 'call.end', ...expected });
  assert.equal(typeof ms, 'number');
  assert.ok(ms >= 0 && ms <= elapsed, `call.end.ms ${ms} is outside the measured call duration ${elapsed}`);
}

// A missing event, wrong runner side, extra envelope field or altered result breaks this boundary.
test('each forge runner records one call end with its side and returns the command result', async (t) => {
  const directory = holding(t);
  fixture(directory, 'gh', "printf 'answer\\n'; printf 'diagnostic\\n' >&2");
  const requests = [
    ['read', readRunner, ['auth', 'status']],
    ['schema-write', schemaWriteRunner, ['api', 'graphql', '-f', 'query=mutation { createLabel(input: {repositoryId: "R_1", name: "a", color: "ededed"}) { label { id } } }']],
    ['item-write', itemWriteRunner, ['api', 'graphql', '-f', 'query=mutation { addProjectV2ItemById(input: {projectId: "PVT_1", contentId: "I_1"}) { item { id } } }']],
    ['repository-write', repositoryWriteRunner, ['api', 'repos/acme/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=hello\n"quoted"']],
  ];
  for (const [side, run, args] of requests) {
    const emitter = recorder();
    const began = performance.now();
    const result = await withFirstOnPath(directory, () => run(args, { emitter }));
    const elapsed = performance.now() - began;
    assert.deepEqual(result, { status: 0, timedOut: false, timeout: 60_000, stdout: 'answer\n', stderr: 'diagnostic\n' });
    assert.equal(emitter.events.length, 1, `${side}: expected exactly one event`);
    callEnd(emitter.events[0], { system: 'forge', side, outcome: 'ok' }, elapsed);
  }
});

test('an unnamed sink flushes held forge and git call ends to stderr on normal return', async (t) => {
  const directory = holding(t);
  fixture(directory, 'gh', 'echo answer');
  const git = fixture(directory, 'git', 'echo rigger-1');
  const ran = await caller(t, directory, `
    import { openSink } from ${moduleAt('../src/observation/sink.mjs')};
    import { readRunner } from ${moduleAt('../src/substrate/forge/runners.mjs')};
    import { workspaces } from ${moduleAt('../src/substrate/worktrees.mjs')};
    const sink = openSink({ run: 'r-unnamed', now: () => 0 });
    const emitter = sink.emitter({ layer: 'L0' });
    await readRunner(['auth', 'status'], { emitter });
    await workspaces({ repository: ${JSON.stringify(directory)}, git: ${JSON.stringify(git)}, emitter }).acceptsBranch('rigger-1');
    console.log('answers kept');
    sink.end();
  `).ran;
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, 'answers kept\n');
  const events = ran.stderr.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(events.map(({ event, system, outcome }) => [event, system, outcome]), [
    ['call.end', 'forge', 'ok'], ['call.end', 'git', 'ok'],
  ]);
  assert.equal(existsSync(join(directory, '.rigger')), false);
});

test('the gate keeps its fixture ruling on stdout and flushes held forge call ends to stderr', async (t) => {
  const directory = holding(t);
  const origin = repositoryAt(join(directory, 'origin'), { 'rigger.config.mjs': `export default ${JSON.stringify(rigger)};\n` });
  gitIn(origin, 'branch', '-M', 'main');
  const body = '## Acceptance\n\n- The widget prints its help.\n';
  const head = 'c'.repeat(40);
  const fake = installFakeGh(directory, { repo: 'williacj/rigger', project: 6, origin });
  seedRepository(fake, {
    issues: [{ number: 7, title: 'Fixture card', body, labels: ['type:change', 'maker:codex'] }],
    pullRequests: [{ number: 12, head: 'rigger-7', sha: head, base: 'main', comments: ['reviewer', 'architect'].map((role) => ({
      ...markerComment({ card: 7, pull: 12, head, body, role, provider: 'codex' }), author: { login: 'judge' },
    })) }],
  });
  const ran = spawnSync(process.execPath, [new URL('../scripts/gate-check.mjs', import.meta.url).pathname, 'rule', '12'], {
    cwd: directory, encoding: 'utf8', env: { ...gitEnvironment(), PATH: `${directory}:${process.env.PATH}`, GITHUB_REPOSITORY: 'williacj/rigger' },
  });
  if (process.env.RIGGER_1047_GATE_OUTPUT) writeFileSync(process.env.RIGGER_1047_GATE_OUTPUT, JSON.stringify({ status: ran.status, stdout: ran.stdout, stderr: ran.stderr }));
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.stdout, [
    '# rigger/gate on pull request #12', '', `head: ${head}`, 'base: main',
    `config: \`rigger.config.mjs\` on the default branch, main at ${gitIn(origin, 'rev-parse', 'HEAD').trim()}`,
    'card: #7', 'judges: reviewer on codex, architect on codex', 'permission: judge write', 'admitted', '',
  ].join('\n'));
  const events = ran.stderr.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(events.length > 0, 'gate recorded no call.end');
  for (const event of events) {
    assert.equal(event.event, 'call.end');
    assert.equal(event.system, 'forge');
    assert.equal(event.side, 'read');
    assert.equal(event.outcome, 'ok');
  }
});

test('exit cleanup omits an ending call but records failed after sink end when a listener continues', { timeout: 30_000 }, async (t) => {
  for (const system of ['forge', 'git']) for (const named of [false, true]) for (const keep of [false, true]) {
    const directory = holding(t);
    const command = fixture(directory, system === 'forge' ? 'gh' : 'git', 'echo $$ > "$here/leader"; : > "$here/ready"; exec /usr/bin/tail -f "$here/hold"');
    const code = `
      import assert from 'node:assert/strict';
      import { existsSync, writeFileSync } from 'node:fs';
      import { openSink } from ${moduleAt('../src/observation/sink.mjs')};
      import { atExit } from ${moduleAt('../src/substrate/process.mjs')};
      import { readRunner } from ${moduleAt('../src/substrate/forge/runners.mjs')};
      import { workspaces } from ${moduleAt('../src/substrate/worktrees.mjs')};
      const sink = openSink({ ${named ? `directory: ${JSON.stringify(join(directory, 'state'))},` : ''} run: 'r-cleanup', now: () => 0 });
      atExit(() => { sink.end(); writeFileSync(${JSON.stringify(join(directory, 'sink-ended'))}, 'ended'); });
      ${keep ? "process.on('SIGTERM', () => {});" : ''}
      const inner = sink.emitter({ layer: 'L0' });
      const emitter = { emit: (event, fields) => {
        if (event === 'call.end') assert.ok(existsSync(${JSON.stringify(join(directory, 'sink-ended'))}), 'call.end precedes sink end');
        inner.emit(event, fields);
      } };
      const result = await ${system === 'forge' ? "readRunner(['auth', 'status'], { emitter })" : `workspaces({ repository: ${JSON.stringify(directory)}, git: ${JSON.stringify(command)}, emitter }).acceptsBranch('rigger-1')`};
      console.log(JSON.stringify(result));
      process.exit(0);
    `;
    const began = performance.now();
    const running = caller(t, directory, code);
    let closed = false;
    running.ran.then(() => { closed = true; });
    await until(() => closed || existsSync(join(directory, 'ready')), t);
    assert.equal(closed, false, 'caller ended before its command was ready');
    running.child.kill('SIGTERM');
    const ran = await running.ran;
    assert.equal(ran.signal, keep ? null : 'SIGTERM', ran.stderr);
    if (keep) assert.equal(ran.status, 0, ran.stderr);
    assert.equal(await gone(Number(read(directory, 'leader'))), true);
    assert.equal(existsSync(join(directory, 'sink-ended')), true);
    const stream = named ? readEvents(join(directory, 'state')) : ran.stderr.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
    const ends = stream.filter(({ event }) => event === 'call.end');
    assert.equal(ends.length, Number(keep), JSON.stringify(ran));
    if (keep) {
      const { ts, run, layer, ...event } = ends[0];
      callEnd(event, { system, ...(system === 'forge' ? { side: 'read' } : { operation: 'check-ref-format' }), outcome: 'failed' }, performance.now() - began);
      const result = JSON.parse(ran.stdout);
      if (system === 'forge') { assert.notEqual(result.status, 0); assert.equal(result.timedOut, false); }
      else assert.equal(result.accepted, false);
    }
  }
});

test('doctor forge checks record calls while guard git dispatches steps probes and launchctl do not', async (t) => {
  const directory = holding(t);
  fixture(directory, 'gh', 'echo authenticated');
  const sink = openSink({ directory: join(directory, 'state'), run: 'r-exclusions', now: () => 0 });
  const emitter = sink.emitter({ layer: 'L0' });
  const auth = await withFirstOnPath(directory, () => ghAuth({ emitter }));
  assert.equal(auth.ok, true);
  const git = fixture(directory, 'git', 'echo rigger-1');
  assert.equal((await workspaces({ repository: directory, git, emitter }).acceptsBranch('rigger-1')).accepted, true);
  assert.equal((await asked('git', ['--version'], { emitter, timeout: OUTLIVED })).status, 0);
  for (const id of ['d-role', 'd-step']) {
    assert.equal((await dispatch({ id, card: 12, command: '/usr/bin/true', args: [], cwd: directory, env: gitEnvironment(), timeout: OUTLIVED, directory: join(directory, 'state'), sink })).exit, 0);
  }
  const probe = fixture(directory, 'agent-probe', 'exit 0');
  assert.equal((await runCommand({ command: probe, args: [], cwd: directory, env: gitEnvironment(), timeout: OUTLIVED, emitter })).exit, 0);
  const launchctl = fixture(directory, 'launchctl', "printf '\\tprogram = /installed/rigger\\n\\texit timeout = 30\\n'");
  assert.deepEqual(await loadedJob('fixture', { emitter, run: (options) => runCommand({ ...options, command: launchctl }) }), { program: '/installed/rigger', exitTimeout: 30 });
  sink.end();
  const events = readEvents(join(directory, 'state'));
  assert.deepEqual(events.filter(({ event }) => event === 'call.end').map(({ system, side, operation }) => [system, side, operation]), [
    ['forge', 'read', undefined], ['git', undefined, 'check-ref-format'],
  ]);
  assert.equal(events.filter(({ event }) => event === 'dispatch.end').length, 2);
});

test('missing emitters and invalid deadlines retain adapter refusals without call ends', async (t) => {
  const directory = holding(t);
  fixture(directory, 'gh', 'exit 0');
  const git = fixture(directory, 'git', 'echo rigger-1');
  const emitter = recorder();
  await withFirstOnPath(directory, async () => {
    await readRunner(['auth', 'status'], { emitter });
    await workspaces({ repository: directory, git, emitter }).acceptsBranch('rigger-1');
    assert.equal(emitter.events.length, 2, 'the positive controls must record both emitting paths');
    for (const missing of [undefined, {}]) {
      const noEmitter = (error) => error.code === NOT_STARTED && /no L0 emitter/.test(error.message);
      await assert.rejects(readRunner(['auth', 'status'], { emitter: missing }), noEmitter);
      await assert.rejects(workspaces({ repository: directory, git, emitter: missing }).acceptsBranch('rigger-1'), noEmitter);
    }
    await assert.rejects(readRunner(['auth', 'status'], { emitter, timeout: 0 }), /not a positive finite number/);
    await assert.rejects(workspaces({ repository: directory, git, emitter, timeout: 0 }).acceptsBranch('rigger-1'), /not a positive finite number/);
    assert.equal(emitter.events.length, 2, 'caller defects contribute no call.end');
  });
});

// The real sink rejects layer-supplied envelope fields and must stamp held events when emitted.
test('a held stream writes each system and outcome once when its state directory is named', async (t) => {
  const directory = holding(t);
  const state = process.env.RIGGER_1047_STREAM ?? join(directory, 'state');
  assert.equal(existsSync(state), false, 'the stream fixture must start absent');
  const sink = openSink({ run: 'r-call-events', now: () => 0 });
  const emitter = sink.emitter({ layer: 'L0', card: 12, dispatch: 'd-call' });
  const began = performance.now();
  for (const system of ['forge', 'git']) for (const outcome of ['ok', 'failed', 'timed-out']) {
    const command = fixture(directory, system === 'forge' ? 'gh' : 'git', outcome === 'timed-out'
      ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : `printf 'rigger-1\\n'; exit ${outcome === 'failed' ? 7 : 0}`);
    if (system === 'forge') {
      const result = await withFirstOnPath(directory, () => readRunner(['auth', 'status'], { emitter, timeout: OUTLIVED }));
      assert.equal(result.timedOut, outcome === 'timed-out');
    } else {
      const pending = workspaces({ repository: directory, git: command, emitter, timeout: OUTLIVED }).acceptsBranch('rigger-1');
      if (outcome === 'timed-out') await assert.rejects(pending, /timeout/);
      else assert.equal((await pending).accepted, outcome === 'ok');
    }
    assert.equal(existsSync(state), false, 'holding the event must not create the directory');
  }
  sink.name(state);
  sink.end();
  const ends = readEvents(state).filter(({ event }) => event === 'call.end');
  assert.deepEqual(ends.map(({ system, outcome }) => [system, outcome]), [
    ['forge', 'ok'], ['forge', 'failed'], ['forge', 'timed-out'],
    ['git', 'ok'], ['git', 'failed'], ['git', 'timed-out'],
  ]);
  for (const { ts, run, layer, card, dispatch, ...event } of ends) {
    assert.deepEqual({ ts, run, layer, card, dispatch }, { ts: '1970-01-01T00:00:00.000Z', run: 'r-call-events', layer: 'L0', card: 12, dispatch: 'd-call' });
    callEnd(event, { system: event.system, ...(event.system === 'forge' ? { side: 'read' } : { operation: 'check-ref-format' }), outcome: event.outcome }, performance.now() - began);
  }
});

test('a refused fetch call end stops retries before any fetch retried event', async (t) => {
  const { repository } = clonedFromOrigin(holding(t));
  const git = gitRacing(holding(t), 2);
  const emitter = recorder();
  const emit = emitter.emit;
  const attempts = [];
  emitter.emit = (event, fields) => {
    attempts.push({ event, ...fields });
    if (event === 'call.end' && fields.operation === 'fetch') throw new Error('fixture refuses fetch call end');
    emit(event, fields);
  };
  const failure = await workspaces({ repository, git, emitter }).fetchMainLine().catch((error) => error);
  assert.equal(failure.code, EVENT_REFUSED);
  assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['call.end']);
  assert.equal(failure.result.exit, 1);
  assert.equal(read(dirname(git), 'raced'), '1');
  assert.deepEqual(attempts.map(({ event, operation, outcome }) => [event, operation, outcome]), [
    ['call.end', 'ls-remote', 'ok'], ['call.end', 'fetch', 'failed'],
  ]);
  assert.equal(emitter.events.length, 1);
});

test('a refused fetch retry event retains the failed call end and stops further tries', async (t) => {
  const { repository } = clonedFromOrigin(holding(t));
  const git = gitRacing(holding(t), 2);
  const emitter = recorder();
  const emit = emitter.emit;
  emitter.emit = (event, fields) => {
    if (event === 'fetch.retried') throw new Error('fixture refuses retry');
    emit(event, fields);
  };
  const failure = await workspaces({ repository, git, emitter }).fetchMainLine().catch((error) => error);
  assert.equal(failure.code, EVENT_REFUSED);
  assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['fetch.retried']);
  assert.equal(read(dirname(git), 'raced'), '1');
  assert.deepEqual(emitter.events.map(({ event, operation, outcome }) => [event, operation, outcome]), [
    ['call.end', 'ls-remote', 'ok'], ['call.end', 'fetch', 'failed'],
  ]);
});

test('the final lost fetch try records failed and rejects without a further retry event', async (t) => {
  const { repository } = clonedFromOrigin(holding(t));
  const git = gitRacing(holding(t), FETCH_TRIES + 1);
  const emitter = recorder();
  await assert.rejects(workspaces({ repository, git, emitter }).fetchMainLine(), new RegExp(`refs/remotes/origin/main.*all ${FETCH_TRIES} tries`));
  assert.equal(Number(read(dirname(git), 'raced')), FETCH_TRIES);
  assert.deepEqual(emitter.events.map(({ event, operation, outcome, tries }) =>
    event === 'call.end' ? [event, operation, outcome] : [event, tries]), [
    ['call.end', 'ls-remote', 'ok'], ['call.end', 'fetch', 'failed'], ['fetch.retried', 1],
    ['call.end', 'fetch', 'failed'], ['fetch.retried', 2], ['call.end', 'fetch', 'failed'],
  ]);
});

// Each try is a call, and its end must be recorded before the decision to retry it.
test('a raced fetch records its failed call before fetch retried and the successful next try once', async (t) => {
  const { repository } = clonedFromOrigin(holding(t));
  const git = gitRacing(holding(t), 1);
  const emitter = recorder();
  const began = performance.now();
  const result = await workspaces({ repository, git, emitter }).fetchMainLine();
  assert.deepEqual(result, { branch: 'main', commit: gitIn(repository, 'rev-parse', 'HEAD').trim() });
  assert.equal(read(dirname(git), 'raced'), '1');
  assert.deepEqual(emitter.events.map(({ event, operation, outcome, ref, tries }) =>
    event === 'call.end' ? [event, operation, outcome] : [event, ref, tries]), [
    ['call.end', 'ls-remote', 'ok'], ['call.end', 'fetch', 'failed'],
    ['fetch.retried', 'refs/remotes/origin/main', 1], ['call.end', 'fetch', 'ok'],
  ]);
  for (const event of emitter.events.filter(({ event }) => event === 'call.end')) {
    callEnd(event, { system: 'git', operation: event.operation, outcome: event.operation === 'fetch' && event.outcome === 'failed' ? 'failed' : 'ok' }, performance.now() - began);
  }
});

test('a refused git kill still records its call end and retains every refused event', async (t) => {
  for (const timed of [false, true]) for (const refuseEnd of [false, true]) {
    const repository = holding(t);
    const git = fixture(repository, 'git', timed ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : `${leave(TAIL, 'child-$$')}\nprintf 'answer\\n'`);
    const attempted = [];
    const accepted = [];
    const emitter = { emit: (event, fields) => {
      attempted.push({ event, ...fields });
      if (event !== 'call.end' || refuseEnd) throw new Error(`fixture refuses ${event}`);
      accepted.push({ event, ...fields });
    } };
    const began = performance.now();
    const failure = await workspaces({ repository, git, emitter, timeout: OUTLIVED }).acceptsBranch('rigger-1').catch((error) => error);
    assert.equal(failure.code, EVENT_REFUSED);
    assert.ok(failure.unrecorded.some(({ event }) => event === (timed ? 'timeout.killed' : 'survivor.killed')));
    assert.equal(failure.result.timedOut, timed);
    assert.equal(failure.result.stdout.toString(), timed ? 'ready\n' : 'answer\n');
    assert.equal(failure.unrecorded.filter(({ event }) => event === 'call.end').length, Number(refuseEnd));
    assert.equal(accepted.length, Number(!refuseEnd));
    assert.equal(attempted.filter(({ event }) => event === 'call.end').length, 1);
    callEnd(attempted.at(-1), { system: 'git', operation: 'check-ref-format', outcome: timed ? 'timed-out' : 'ok' }, performance.now() - began);
    if (refuseEnd) assert.match(failure.message, /call\.end/);
  }
});

test('a refused git call end names the event and carries the raw process result or startup cause', async (t) => {
  for (const mode of ['ok', 'failed', 'timed-out', 'not-started']) {
    const repository = holding(t);
    const present = fixture(repository, 'git', mode === 'timed-out'
      ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : `printf 'answer\\n'; printf 'diagnostic\\n' >&2; exit ${mode === 'failed' ? 7 : 0}`);
    const git = mode === 'not-started' ? join(repository, 'absent-git') : present;
    const refusal = new Error('fixture: append refused');
    const attempted = [];
    const emitter = { emit: (event, fields) => {
      if (event === 'call.end') { attempted.push({ event, ...fields }); throw refusal; }
    } };
    const began = performance.now();
    const failure = await workspaces({ repository, git, emitter, timeout: OUTLIVED }).acceptsBranch('rigger-1').catch((error) => error);
    assert.equal(failure.code, EVENT_REFUSED, `${mode}: ${failure.stack}`);
    assert.match(failure.message, /call\.end/);
    assert.match(failure.message, /went unrecorded/);
    assert.equal(failure.unrecorded.length, 1);
    assert.equal(failure.unrecorded[0].cause, refusal);
    assert.equal(attempted.length, 1);
    callEnd(attempted[0], { system: 'git', operation: 'check-ref-format', outcome: mode === 'not-started' ? 'failed' : mode }, performance.now() - began);
    if (mode === 'not-started') {
      assert.equal(failure.cause.code, NOT_STARTED);
      assert.equal(failure.result, undefined);
    } else {
      assert.deepEqual(Object.keys(failure.result).sort(), ['exit', 'stderr', 'stdout', 'timedOut']);
      assert.ok(Buffer.isBuffer(failure.result.stdout));
      assert.ok(Buffer.isBuffer(failure.result.stderr));
      assert.equal(failure.result.timedOut, mode === 'timed-out');
      assert.equal(failure.result.stdout.toString(), mode === 'timed-out' ? 'ready\n' : 'answer\n');
      if (mode !== 'timed-out') assert.equal(failure.result.exit, mode === 'failed' ? 7 : 0);
    }
  }
});

test('a git command that never starts records failed and retains NOT_STARTED', async (t) => {
  const repository = holding(t);
  const emitter = recorder();
  const began = performance.now();
  await assert.rejects(workspaces({ repository, emitter, git: join(repository, 'absent-git') }).acceptsBranch('rigger-1'), { code: NOT_STARTED });
  assert.equal(emitter.events.length, 1);
  callEnd(emitter.events[0], { system: 'git', operation: 'check-ref-format', outcome: 'failed' }, performance.now() - began);
});

// A git exit used as an answer still counts as failed; timeout is a distinct outcome.
test('git calls distinguish a failed answer from a timeout and preserve the caller outcome', async (t) => {
  for (const timed of [false, true]) {
    const repository = holding(t);
    const git = fixture(repository, 'git', timed ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : "printf 'diagnostic\\n' >&2; exit 7");
    const emitter = recorder();
    const began = performance.now();
    const result = workspaces({ repository, git, emitter, timeout: OUTLIVED }).acceptsBranch('rigger-1');
    if (timed) await assert.rejects(result, /timeout of 1000 ms/);
    else assert.deepEqual(await result, { accepted: false, why: 'diagnostic' });
    const ends = emitter.events.filter(({ event }) => event === 'call.end');
    assert.equal(ends.length, 1);
    callEnd(ends[0], { system: 'git', operation: 'check-ref-format', outcome: timed ? 'timed-out' : 'failed' }, performance.now() - began);
  }
});

// answer must not emit again, and -C's path must never be mistaken for the operation.
test('git answer and direct calls each record once using the subcommand after C and its path', async (t) => {
  const repository = repositoryAt(join(holding(t), 'repository'), { README: 'fixture\n' });
  const emitter = recorder();
  const adapter = workspaces({ repository, emitter });
  const began = performance.now();
  assert.equal(await adapter.topLevel(), repository);
  assert.equal(await adapter.isWorktree(repository), false);
  assert.equal(emitter.events.length, 3, 'one top-level question and two worktree questions');
  for (const event of emitter.events) callEnd(event, { system: 'git', operation: 'rev-parse', outcome: 'ok' }, performance.now() - began);
});

// The runner that actually sends a prerequisite read is read, even inside a write runner.
test('write prerequisites record read before write and refused forge requests record nothing', async (t) => {
  const directory = holding(t);
  // These are the selections heldOptions and columnsField ask GitHub to return.
  fixture(directory, 'gh', `case "$*" in
    *'field: node'*) printf '%s' '{"data":{"field":{"name":"Status","options":[]}}}' ;;
    *'project: node'*) printf '%s' '{"data":{"project":{"field":{"id":"PVTSSF_status"}},"target":{"name":"Status"}}}' ;;
    *) printf '{}' ;;
  esac`);
  const emitter = recorder();
  const began = performance.now();
  await withFirstOnPath(directory, async () => {
    await schemaWriteRunner(['api', 'graphql', '-f', 'query=mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_status", singleSelectOptions: [{name: "Owner", color: GRAY, description: ""}]}) { projectV2Field { id } } }'], { emitter });
    await itemWriteRunner(['api', 'graphql', '-f', 'query=mutation { updateProjectV2ItemFieldValue(input: {projectId: "PVT_1", itemId: "PVTI_1", fieldId: "PVTSSF_status", value: {singleSelectOptionId: "opt_review"}}) { projectV2Item { id } } }'], { emitter });
    await assert.rejects(readRunner(['issue', 'close', '12'], { emitter }), /refuses/);
  });
  assert.equal(emitter.events.length, 4, 'each pre-read and write records once; an unsent request records none');
  for (const [index, side] of ['read', 'schema-write', 'read', 'item-write'].entries()) {
    callEnd(emitter.events[index], { system: 'forge', side, outcome: 'ok' }, performance.now() - began);
  }
});

// Refusing a kill never suppresses call.end; refusing both must preserve both unrecorded events.
test('a refused forge kill still records its call end and retains every refused event', async (t) => {
  for (const timed of [false, true]) for (const refuseEnd of [false, true]) {
    const directory = holding(t);
    fixture(directory, 'gh', timed ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : `${leave(TAIL, 'child-$$')}\nprintf 'answer\\n'`);
    const accepted = [];
    const attempted = [];
    const emitter = { emit: (event, fields) => {
      attempted.push({ event, ...fields });
      if (event !== 'call.end' || refuseEnd) throw new Error(`fixture refuses ${event}`);
      accepted.push({ event, ...fields });
    } };
    const began = performance.now();
    const failure = await withFirstOnPath(directory, () => readRunner(['auth', 'status'], { emitter, timeout: OUTLIVED })).catch((error) => error);
    assert.equal(failure.code, EVENT_REFUSED);
    assert.ok(failure.unrecorded.some(({ event }) => event === (timed ? 'timeout.killed' : 'survivor.killed')));
    assert.equal(failure.result.timedOut, timed);
    assert.equal(failure.result.stdout.toString(), timed ? 'ready\n' : 'answer\n');
    assert.equal(failure.unrecorded.filter(({ event }) => event === 'call.end').length, Number(refuseEnd));
    assert.equal(accepted.length, Number(!refuseEnd));
    assert.equal(attempted.filter(({ event }) => event === 'call.end').length, 1);
    callEnd(attempted.at(-1), { system: 'forge', side: 'read', outcome: timed ? 'timed-out' : 'ok' }, performance.now() - began);
    if (refuseEnd) assert.match(failure.message, /call\.end/);
  }
});

// A refused call.end must not erase a command result, a NOT_STARTED cause, or its own identity.
test('a refused forge call end names the event and carries the raw process result or startup cause', async (t) => {
  for (const mode of ['ok', 'failed', 'timed-out', 'not-started']) {
    const directory = holding(t);
    fixture(directory, mode === 'not-started' ? 'warming-only' : 'gh', mode === 'timed-out'
      ? 'echo ready; exec /usr/bin/tail -f "$here/hold"' : `printf 'answer\\n'; printf 'diagnostic\\n' >&2; exit ${mode === 'failed' ? 7 : 0}`);
    const refusal = new Error('fixture: append refused');
    const accepted = [];
    const emitter = { emit: (event, fields) => {
      if (event === 'call.end') throw refusal;
      accepted.push({ event, ...fields });
    } };
    const held = process.env.PATH;
    const began = performance.now();
    let failure;
    try {
      process.env.PATH = mode === 'not-started' ? directory : `${directory}:${held}`;
      failure = await readRunner(['auth', 'status'], { emitter, timeout: OUTLIVED }).catch((error) => error);
    } finally {
      process.env.PATH = held;
    }
    assert.equal(failure.code, EVENT_REFUSED, `${mode}: ${failure.stack}`);
    assert.match(failure.message, /call\.end/);
    assert.match(failure.message, /went unrecorded/);
    assert.equal(failure.unrecorded.length, 1);
    const { cause, ...event } = failure.unrecorded[0];
    assert.equal(cause, refusal);
    callEnd(event, { system: 'forge', side: 'read', outcome: mode === 'not-started' ? 'failed' : mode }, performance.now() - began);
    if (mode === 'not-started') {
      assert.equal(failure.cause.code, NOT_STARTED);
      assert.equal(failure.result, undefined);
    } else {
      assert.deepEqual(Object.keys(failure.result).sort(), ['exit', 'stderr', 'stdout', 'timedOut']);
      assert.ok(Buffer.isBuffer(failure.result.stdout));
      assert.ok(Buffer.isBuffer(failure.result.stderr));
      assert.equal(failure.result.timedOut, mode === 'timed-out');
      assert.equal(failure.result.stdout.toString(), mode === 'timed-out' ? 'ready\n' : 'answer\n');
      if (mode !== 'timed-out') assert.equal(failure.result.exit, mode === 'failed' ? 7 : 0);
    }
    assert.equal(accepted.some(({ event }) => event === 'call.end'), false);
  }
});

// A rejected spawn still contributes to the fault rate and preserves the adapter's refusal.
test('a forge command that never starts records failed and retains NOT_STARTED', async (t) => {
  const directory = holding(t);
  fixture(directory, 'warming-only', 'exit 0');
  const emitter = recorder();
  const held = process.env.PATH;
  const began = performance.now();
  try {
    process.env.PATH = directory;
    await assert.rejects(readRunner(['auth', 'status'], { emitter }), { code: NOT_STARTED });
  } finally {
    process.env.PATH = held;
  }
  assert.equal(emitter.events.length, 1);
  callEnd(emitter.events[0], { system: 'forge', side: 'read', outcome: 'failed' }, performance.now() - began);
});

// A nonzero exit is a fault even when a caller reads it as an answer; timeout wins over exit.
test('forge calls distinguish a failed exit from a timeout without changing their results', async (t) => {
  for (const [body, outcome] of [["printf 'failure\\n' >&2; exit 7", 'failed'], ['echo ready; exec /usr/bin/tail -f "$here/hold"', 'timed-out']]) {
    const directory = holding(t);
    fixture(directory, 'gh', body);
    const emitter = recorder();
    const began = performance.now();
    const result = await withFirstOnPath(directory, () => readRunner(['auth', 'status'], { emitter, timeout: OUTLIVED }));
    const elapsed = performance.now() - began;
    assert.equal(result.timedOut, outcome === 'timed-out');
    assert.equal(result.timeout, OUTLIVED);
    if (outcome === 'failed') assert.deepEqual(result, { status: 7, timedOut: false, timeout: OUTLIVED, stdout: '', stderr: 'failure\n' });
    else {
      assert.ok(Number.isInteger(result.status) && result.status !== 0);
      assert.equal(result.stdout, 'ready\n', 'the command must start before its deadline');
    }
    const ends = emitter.events.filter(({ event }) => event === 'call.end');
    assert.equal(ends.length, 1);
    callEnd(ends[0], { system: 'forge', side: 'read', outcome }, elapsed);
  }
});
