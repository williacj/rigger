// ABOUTME: Tests of L0's push side, src/substrate/data-ref.mjs, against a real git with a local
// bare origin, ordering another writer between its calls through the spawn the side is handed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { PUSH_TIMEOUT, pushStream } from '../src/substrate/data-ref.mjs';
import { EVENT_REFUSED, NOT_STARTED } from '../src/substrate/process.mjs';
import { bareCloneInto, cloneInto, clonedFromOrigin, gitIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const DATA_REF = 'refs/rigger/events';

/** The only `git` subcommands "Pushing the stream", "The steps", gives the push side. */
const SUBCOMMANDS = ['ls-remote', 'remote', 'fetch', 'hash-object', 'mktree', 'commit-tree', 'push'];

/** Every event an emitter was handed, in order, each as its name and its fields. */
function recorder() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

/**
 * A spawn with `runCommand`'s contract, one argument object in and `{ exit, timedOut, stdout,
 * stderr }` out with both streams as buffers, that runs the real `git` it is asked for. The
 * deterministic tier admits `git` and refuses L0's process adapter, whose census starts `ps`.
 * Each call is recorded in `calls` with what it answered, and `before`, where given, runs ahead of
 * each call with the call's arguments, so a test can put another writer's push between two calls.
 */
function realGit(calls, before = () => {}) {
  return async (call) => {
    await before(call.args, calls.length);
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
 * A local bare origin, a clone of it the push side pushes from, and a second clone that reads back
 * what was pushed, under a directory of the test's own.
 */
function world(t) {
  const directory = temporaryDirectory('rigger-data-ref-', { context: t });
  const { source, origin, repository } = clonedFromOrigin(directory);
  const reader = cloneInto(origin, join(directory, 'reader'));
  return { t, directory, source, origin, repository, reader };
}

/** The tip `origin` holds at the data ref, or undefined where it holds none. */
const tipOf = (origin) => gitIn(origin, 'for-each-ref', '--format=%(objectname)', DATA_REF).trim() || undefined;

/** Installs `body` as the hook `name` in the repository whose hooks live in `hooks`. */
function hook(hooks, name, body) {
  const path = join(hooks, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The keys of an answer, sorted, so a test states exactly which fields it holds. */
const keysOf = (answer) => Object.keys(answer).sort();

/**
 * Runs one push from `repository`, the world's pushing repository unless another is named, whose
 * commit the reader fetches from `pushedTo`, origin unless another is named,
 * against a real `git`, and checks what every push must leave, whatever it answers. At once: the
 * answer's fields; the pushing repository's refs unchanged and no `FETCH_HEAD` in it; no
 * `call.end` recorded; and a pushed commit, fetched into a second repository, holding exactly
 * `events.jsonl` with the stream up to its last newline. Once the test's own assertions have run:
 * every call is one of the six subcommands, run in the repository with the environment
 * `gitEnvironment` gives plus `GIT_TERMINAL_PROMPT=0`, handed a positive timeout within
 * `PUSH_TIMEOUT` and the emitter the side was handed; `ls-remote` and `push` carry exactly their
 * pinned arguments.
 */
async function pushed(w, stream, { before, environment = process.env, repository = w.repository, pushedTo = 'origin', ...options } = {}) {
  const calls = [];
  const emitter = recorder();
  const refs = gitIn(repository, 'for-each-ref');
  const answer = await pushStream({ repository, stream, emitter, spawn: realGit(calls, before), now: STILL, environment, ...options });
  assert.equal(gitIn(repository, 'for-each-ref'), refs, 'the push changed a ref in the pushing repository');
  assert.equal(existsSync(join(repository, '.git', 'FETCH_HEAD')), false, 'the push left a FETCH_HEAD');
  assert.deepEqual(emitter.events.filter(({ event }) => event === 'call.end'), []);
  assertFields(answer, calls);
  if (answer.outcome === 'pushed') {
    const held = stream.subarray(0, stream.lastIndexOf(0x0a) + 1);
    gitIn(w.reader, 'fetch', '-q', '--no-write-fetch-head', pushedTo, answer.commit);
    const blob = gitIn(w.reader, 'rev-parse', `${answer.commit}:events.jsonl`).trim();
    assert.equal(gitIn(w.reader, 'ls-tree', answer.commit), `100644 blob ${blob}\tevents.jsonl\n`);
    assert.deepEqual(await catBlob(w.reader, blob), held);
    assert.equal(answer.bytes, held.length);
  }
  // What each call was handed is checked once the test's own assertions have run, so that a test
  // fails first on the behaviour it names.
  w.t.after(() => {
    const expectedEnv = { ...gitEnvironment(environment), GIT_TERMINAL_PROMPT: '0' };
    for (const call of calls) {
      assert.equal(call.command, 'git');
      assert.ok(SUBCOMMANDS.includes(call.args[0]), `the push side ran git ${call.args[0]}`);
      assert.equal(call.cwd, repository);
      assert.deepEqual(call.env, expectedEnv);
      assert.ok(call.timeout > 0 && call.timeout <= PUSH_TIMEOUT, `timeout ${call.timeout}`);
      assert.equal(call.emitter, emitter);
    }
    assertPinned(calls);
  });
  return { answer, calls, emitter };
}

/**
 * Checks each field of `answer` is present exactly where "The outcome"'s table says a `push.end`
 * line holds it, reading what the push's `git ls-remote` printed from `calls`: `outcome` and
 * `bytes` always; `parent` where that call exited 0 and printed the data ref, naming what it
 * printed; `commit` only where the push pushed; `reason` everywhere else.
 */
function assertFields(answer, calls) {
  assert.ok(['pushed', 'refused', 'timed-out', 'failed'].includes(answer.outcome), `outcome ${answer.outcome}`);
  assert.equal(typeof answer.bytes, 'number', 'the answer holds no bytes');
  const listed = calls.find((call) => call.args[0] === 'ls-remote')?.result;
  const line = listed?.exit === 0 && !listed.timedOut ? listed.stdout.toString().split('\n').find((entry) => entry.endsWith(`\t${DATA_REF}`)) : undefined;
  if (line === undefined) assert.ok(!('parent' in answer), `the answer names a parent, ${answer.parent}, where the ref was absent or the read failed`);
  else assert.equal(answer.parent, line.split('\t')[0]);
  if (answer.outcome === 'pushed') {
    assert.match(answer.commit, /^[0-9a-f]{40}$/);
    assert.ok(!('reason' in answer), `a pushed answer holds a reason: ${answer.reason}`);
  } else {
    assert.ok(!('commit' in answer), 'an answer that did not push names a commit');
    assert.equal(typeof answer.reason, 'string');
  }
}

/**
 * Checks the pinned arguments of one push's `calls`, each recorded with what it answered. The
 * first call is `remote get-url --push --all origin`, and `<url>` is the one line it printed.
 * Every `ls-remote` reads `<url>`; every `fetch` addresses `<url>`, names one commit by its hash
 * and writes no `FETCH_HEAD`; every `push` sends the last commit `commit-tree` built to `<url>`.
 */
function assertPinned(calls) {
  if (calls.length === 0) return;
  const REMOTE = ['remote', 'get-url', '--push', '--all', 'origin'];
  assert.deepEqual(calls[0].args, REMOTE, 'the push side\'s first call');
  const url = calls[0].result?.stdout.toString().trim() ?? '';
  for (const call of calls) {
    if (call.args[0] === 'remote') assert.deepEqual(call.args, REMOTE);
    if (call.args[0] === 'ls-remote') assert.deepEqual(call.args, ['ls-remote', url, DATA_REF, 'refs/remotes/refs/rigger/events/HEAD']);
    if (call.args[0] === 'fetch') {
      assert.deepEqual(call.args.slice(0, -1), ['fetch', '--no-write-fetch-head', '--no-tags', url]);
      assert.match(call.args.at(-1), /^[0-9a-f]{40}$/);
    }
    if (call.args[0] === 'push') {
      const built = calls.filter((c) => c.args[0] === 'commit-tree' && c.result?.exit === 0).at(-1)?.result.stdout.toString().trim();
      assert.ok(built, 'the push side ran git push with no commit built');
      assert.ok(url && !url.includes('\n'), `the push side pushed with no one URL read: ${url}`);
      assert.deepEqual(call.args, ['push', '--porcelain', '--no-signed', '--no-verify', url, `${built}:${DATA_REF}`]);
    }
  }
}

/** The bytes of the blob `blob` in the repository at `root`, exactly as stored. */
function catBlob(root, blob) {
  const { GIT_REFLOG_ACTION, ...env } = gitEnvironment();
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, 'cat-file', 'blob', blob], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`cat-file exited ${code}`))));
  });
}

/**
 * The clock every real-git push reads: one that never moves, since no real-git row decides
 * anything by time, and code under a deterministic test reads only the clock the test injects.
 */
const STILL = () => 0;

const STREAM = Buffer.from('{"event":"one"}\n{"event":"two"}\n');

test('P1: with refs/rigger/events absent on origin, the push creates it with a commit that has no parent, and answers pushed with no parent', async (t) => {
  const w = world(t);
  const { answer } = await pushed(w, STREAM);
  assert.deepEqual(keysOf(answer), ['bytes', 'commit', 'outcome']);
  assert.equal(answer.outcome, 'pushed');
  assert.equal(tipOf(w.origin), answer.commit);
  assert.equal(gitIn(w.origin, 'rev-list', '--parents', '-n', '1', answer.commit).trim(), answer.commit);
});

test('P2: with origin\'s ref naming the previous stream commit, which the local store holds, the push builds its one-parent child without a fetch, and parent names that tip', async (t) => {
  const w = world(t);
  const first = (await pushed(w, STREAM)).answer.commit;
  const longer = Buffer.concat([STREAM, Buffer.from('{"event":"three"}\n')]);
  const { answer, calls } = await pushed(w, longer);
  assert.deepEqual(keysOf(answer), ['bytes', 'commit', 'outcome', 'parent']);
  assert.equal(answer.outcome, 'pushed');
  assert.equal(answer.parent, first);
  assert.equal(tipOf(w.origin), answer.commit);
  assert.equal(gitIn(w.origin, 'rev-list', '--parents', '-n', '1', answer.commit).trim(), `${answer.commit} ${first}`);
  assert.deepEqual(calls.filter((call) => call.args[0] === 'fetch'), []);
});

test('P3: with origin\'s ref naming a commit the local store lacks, the push fetches that commit alone, writing no ref, and answers pushed with parent naming it', async (t) => {
  const w = world(t);
  const elsewhere = cloneInto(w.origin, join(w.directory, 'elsewhere'));
  const tip = (await pushed(w, STREAM, { repository: elsewhere })).answer.commit;
  const { answer, calls } = await pushed(w, STREAM);
  assert.deepEqual(keysOf(answer), ['bytes', 'commit', 'outcome', 'parent']);
  assert.equal(answer.outcome, 'pushed');
  assert.equal(answer.parent, tip);
  assert.equal(tipOf(w.origin), answer.commit);
  assert.deepEqual(calls.filter((call) => call.args[0] === 'fetch').map((call) => call.args), [['fetch', '--no-write-fetch-head', '--no-tags', w.origin, tip]]);
});

test('P4: where origin\'s pre-receive hook declines the update, the push answers refused with the text git push printed, the hook\'s message included, and origin\'s ref is unchanged', async (t) => {
  const w = world(t);
  const first = (await pushed(w, STREAM)).answer.commit;
  hook(join(w.origin, 'hooks'), 'pre-receive', 'echo "the data ref is closed for this test" >&2\nexit 1');
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM]));
  assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'parent', 'reason']);
  assert.equal(answer.outcome, 'refused');
  assert.equal(answer.parent, first);
  assert.match(answer.reason, /the data ref is closed for this test/);
  assert.match(answer.reason, /\[remote rejected\] \(pre-receive hook declined\)/);
  assert.equal(tipOf(w.origin), first);
});

test('P5: handed bytes ending in a partial line, the commit holds them up to and including the last newline, and bytes is that length', async (t) => {
  const w = world(t);
  const { answer } = await pushed(w, Buffer.concat([STREAM, Buffer.from('{"event":"thr')]));
  assert.equal(answer.outcome, 'pushed');
  assert.equal(answer.bytes, STREAM.length);
  assert.deepEqual(await catBlob(w.origin, gitIn(w.origin, 'rev-parse', `${answer.commit}:events.jsonl`).trim()), STREAM);
});

test('P6: where the first reads fail, git remote get-url with no origin or git ls-remote with an origin that cannot be reached, the push answers failed with the text git printed, runs no later step and holds no parent', async (t) => {
  for (const [what, arrange, ran] of [
    ['no origin', (w) => gitIn(w.repository, 'remote', 'remove', 'origin'), ['remote']],
    ['an unreachable origin', (w) => gitIn(w.repository, 'remote', 'set-url', 'origin', join(w.directory, 'nowhere.git')), ['remote', 'ls-remote']],
  ]) {
    const w = world(t);
    arrange(w);
    const { answer, calls } = await pushed(w, STREAM);
    assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'reason'], what);
    assert.equal(answer.outcome, 'failed', what);
    const failing = calls.at(-1).result;
    assert.equal(answer.reason, `${failing.stderr}${failing.stdout}`.trim(), what);
    assert.notEqual(answer.reason, '', what);
    assert.deepEqual(calls.map((call) => call.args[0]), ran, what);
  }
});

/**
 * Runs a push against an origin that also holds `other`, a ref `refs/rigger/events` resolves to
 * under git's ref-matching rules, with the data ref absent and with it present, and checks the
 * push answers failed naming `other`, writes no object and pushes nothing, and leaves every ref on
 * origin as it was.
 */
async function guarded(t, other) {
  for (const present of [false, true]) {
    const w = world(t);
    const first = present ? (await pushed(w, STREAM)).answer.commit : undefined;
    gitIn(w.origin, 'update-ref', other, gitIn(w.origin, 'rev-parse', 'refs/heads/main').trim());
    const refs = gitIn(w.origin, 'for-each-ref');
    const { answer, calls } = await pushed(w, Buffer.concat([STREAM, STREAM]));
    const what = `${other}, with the data ref ${present ? 'present' : 'absent'}`;
    assert.deepEqual(keysOf(answer), present ? ['bytes', 'outcome', 'parent', 'reason'] : ['bytes', 'outcome', 'reason'], what);
    assert.equal(answer.outcome, 'failed', what);
    if (present) assert.equal(answer.parent, first, what);
    assert.ok(answer.reason.includes(other), `${what}: ${answer.reason}`);
    assert.deepEqual(calls.filter((call) => ['hash-object', 'push'].includes(call.args[0])), [], what);
    assert.equal(gitIn(w.origin, 'for-each-ref'), refs, what);
  }
}

test('P7: where origin holds a branch or a tag that refs/rigger/events resolves to, with the data ref absent and present, the push answers failed naming it, writes nothing, and leaves origin\'s refs unchanged', async (t) => {
  await guarded(t, 'refs/heads/refs/rigger/events');
  await guarded(t, 'refs/tags/refs/rigger/events');
});

test('P16: where origin holds refs/remotes/refs/rigger/events/HEAD, with the data ref absent and present, the push answers failed naming it, writes nothing, and leaves origin\'s refs unchanged', async (t) => {
  await guarded(t, 'refs/remotes/refs/rigger/events/HEAD');
});

/**
 * Object names for the controlled rows. Their values are arbitrary; their shape, forty hex
 * digits, is what git prints for an object.
 */
const TIP = 'a'.repeat(40);
const BLOB = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const COMMIT = 'd'.repeat(40);

/** The push URL the controlled rows' `git remote get-url` prints. */
const URL = 'https://example.invalid/consumer.git';

/**
 * What a real `git` printed for each step of a push that succeeds, as git 2.54.0 printed it
 * against a local bare origin (the maker's run, in the journal entry for this card): `ls-remote`
 * one `<object>\t<ref>` line a ref, `remote get-url --push --all` one URL a line, `hash-object`, `mktree` and `commit-tree` the object they
 * wrote, and `push --porcelain` a `To` line, one status line and `Done`.
 */
const SUCCEEDING = {
  'ls-remote': () => ({ stdout: `${TIP}\t${DATA_REF}\n` }),
  remote: () => ({ stdout: `${URL}\n` }),
  'hash-object': () => ({ stdout: `${BLOB}\n` }),
  mktree: () => ({ stdout: `${TREE}\n` }),
  'commit-tree': () => ({ stdout: `${COMMIT}\n` }),
  fetch: () => ({}),
  push: () => ({ stdout: `To origin\n \t${COMMIT}:${DATA_REF}\t${TIP.slice(0, 7)}..${COMMIT.slice(0, 7)}\nDone\n` }),
};

/**
 * A spawn with `runCommand`'s contract that runs no process. Each call answers as `steps` says for
 * its subcommand, falling back on `SUCCEEDING`; a step answers `{ exit, stdout, stderr, timedOut }`
 * with strings, or throws as the process adapter rejects. Each call is recorded with `at`, the
 * clock as it started, and costs `cost(args)` milliseconds on `clock`, spent before it answers.
 */
function scripted(calls, clock, steps = {}, cost = () => 1) {
  return async (call) => {
    calls.push({ ...call, at: clock.now });
    clock.now += cost(call.args);
    const step = steps[call.args[0]] ?? SUCCEEDING[call.args[0]];
    const { exit = 0, stdout = '', stderr = '', timedOut = false } = step(call.args);
    const result = { exit, timedOut, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
    calls.at(-1).result = result;
    return result;
  };
}

/**
 * Runs one push through a scripted spawn on an injected clock, and checks once the test's own
 * assertions have run what every push's calls must be: one of the six subcommands, in the
 * repository, with `gitEnvironment`'s environment and prompts off, a positive timeout within
 * `PUSH_TIMEOUT`, the emitter the side was handed, and `ls-remote` and `push` with their pinned
 * arguments. Hands back the answer and the calls.
 */
async function controlled(t, { steps, cost, stream = STREAM, ...options } = {}) {
  const calls = [];
  const clock = { now: 1_000 };
  const emitter = recorder();
  const answer = await pushStream({ repository: '/nowhere', stream, emitter, spawn: scripted(calls, clock, steps, cost), now: () => clock.now, ...options });
  assert.deepEqual(emitter.events.filter(({ event }) => event === 'call.end'), []);
  assertFields(answer, calls);
  t.after(() => {
    for (const call of calls) {
      assert.equal(call.command, 'git');
      assert.ok(SUBCOMMANDS.includes(call.args[0]), `the push side ran git ${call.args[0]}`);
      assert.equal(call.cwd, '/nowhere');
      assert.deepEqual(call.env, { ...gitEnvironment(options.environment ?? process.env), GIT_TERMINAL_PROMPT: '0' });
      assert.ok(call.timeout > 0 && call.timeout <= PUSH_TIMEOUT, `timeout ${call.timeout}`);
      assert.equal(call.emitter, emitter);
    }
    assertPinned(calls);
  });
  return { answer, calls, clock };
}

/**
 * A store that lacks origin's tip: `commit-tree` onto it fails as git 2.54.0 failed for an object
 * it did not hold (the maker's run, in the journal entry), and one with no parent succeeds.
 */
const LACKING = { 'commit-tree': (args) => (args.includes('-p') ? { exit: 128, stderr: `fatal: ${TIP} is not a valid object\n` } : { stdout: `${COMMIT}\n` }) };

/** The subcommands of `calls`, in order. */
const subcommandsOf = (calls) => calls.map((call) => call.args[0]);

test('P8: where the fetch of a tip the store lacks exits non-zero, the push answers failed with the text git printed, and runs no git push', async (t) => {
  const { answer, calls } = await controlled(t, { steps: { ...LACKING, fetch: () => ({ exit: 128, stderr: 'fatal: unable to reach origin\n' }) } });
  assert.deepEqual(answer, { outcome: 'failed', bytes: STREAM.length, parent: TIP, reason: 'fatal: unable to reach origin' });
  assert.equal(subcommandsOf(calls).includes('push'), false);
});

test('P9: with no committer identity, forced through the pushing repository\'s own config, git commit-tree exits non-zero and the push answers failed with the text git printed, running no git push', async (t) => {
  const w = world(t);
  gitIn(w.repository, 'config', '--unset', 'user.name');
  gitIn(w.repository, 'config', '--unset', 'user.email');
  gitIn(w.repository, 'config', 'user.useConfigOnly', 'true');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(GIT_AUTHOR_|GIT_COMMITTER_|EMAIL$)/.test(name)));
  const tree = gitIn(w.repository, 'rev-parse', 'HEAD^{tree}').trim();
  const premise = spawnSync('git', ['commit-tree', tree, '-m', 'premise'], { cwd: w.repository, env: gitEnvironment(environment), encoding: 'utf8' });
  assert.notEqual(premise.status, 0, `git commit-tree made a commit with no identity configured, so this proves nothing: ${premise.stdout}`);
  const { answer, calls } = await pushed(w, STREAM, { environment });
  assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'reason']);
  assert.equal(answer.outcome, 'failed');
  const failing = calls.find((call) => call.args[0] === 'commit-tree');
  assert.equal(answer.reason, `${failing.result.stderr}${failing.result.stdout}`.trim());
  assert.match(answer.reason, /user\.useConfigOnly|identity/i);
  assert.equal(subcommandsOf(calls).includes('push'), false);
  assert.equal(tipOf(w.origin), undefined);
});

test('P9: where git hash-object, git mktree or git commit-tree exits non-zero, the push answers failed with the text git printed, and runs no git push', async (t) => {
  for (const step of ['hash-object', 'mktree', 'commit-tree']) {
    const { answer, calls } = await controlled(t, { steps: { [step]: () => ({ exit: 128, stderr: `fatal: ${step} could not write\n` }) } });
    assert.deepEqual(answer, { outcome: 'failed', bytes: STREAM.length, parent: TIP, reason: `fatal: ${step} could not write` }, step);
    assert.deepEqual(subcommandsOf(calls).filter((name) => ['fetch', 'push'].includes(name)), [], step);
  }
});

test('P10: where git push exits non-zero and prints no rejected status for refs/rigger/events, the push answers failed, never refused', async (t) => {
  const { answer } = await controlled(t, { steps: { push: () => ({ exit: 128, stderr: 'fatal: could not read from remote repository\n' }) } });
  assert.deepEqual(answer, { outcome: 'failed', bytes: STREAM.length, parent: TIP, reason: 'fatal: could not read from remote repository' });
});

test('P11: where git never starts, as where it is not on PATH, the push answers failed with reason naming the process adapter\'s not-started failure', async (t) => {
  // The words `runCommand` rejects with where the spawn fails, as `notStarted` in process.mjs writes them.
  const why = 'the process adapter did not start git: spawn git ENOENT';
  const { answer, calls } = await controlled(t, { steps: { remote: () => { throw Object.assign(new Error(why), { code: NOT_STARTED }); } } });
  assert.deepEqual(answer, { outcome: 'failed', bytes: STREAM.length, reason: why });
  assert.deepEqual(subcommandsOf(calls), ['remote']);
});

test('P14: where the process adapter rejects a push\'s git call with EVENT_REFUSED, the push side rejects with that failure as it stands, starts no later call and records nothing', async () => {
  // The shape `runCommand` rejects with where the sink refused a kill event: `refused` in process.mjs.
  const refusal = Object.assign(new Error('the sink refused 1 L0 event(s), so they went unrecorded'), { code: EVENT_REFUSED, unrecorded: [] });
  for (const [step, ran] of [
    ['remote', ['remote']],
    ['ls-remote', ['remote', 'ls-remote']],
    ['hash-object', ['remote', 'ls-remote', 'hash-object']],
    ['push', ['remote', 'ls-remote', 'hash-object', 'mktree', 'commit-tree', 'push']],
  ]) {
    const calls = [];
    const clock = { now: 0 };
    const emitter = recorder();
    const spawn = scripted(calls, clock, { [step]: () => { throw refusal; } });
    await assert.rejects(pushStream({ repository: '/nowhere', stream: STREAM, emitter, spawn, now: () => clock.now }), (failure) => failure === refusal, step);
    assert.deepEqual(subcommandsOf(calls), ran, step);
    assert.deepEqual(emitter.events, [], step);
  }
});

test('P15: handed bytes that are empty, or that hold no newline, the push answers failed saying they hold no complete line, and runs no git call', async (t) => {
  for (const stream of [Buffer.alloc(0), Buffer.from('{"event":"one"}')]) {
    const { answer, calls } = await controlled(t, { stream });
    assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'reason']);
    assert.equal(answer.outcome, 'failed');
    assert.equal(answer.bytes, 0);
    assert.match(answer.reason, /no complete line/);
    assert.deepEqual(calls, []);
  }
});

test('P12: where the push\'s limit runs out during any of its git calls, the push answers timed-out with the reason reading 9 gives, and runs no later step', async (t) => {
  for (const step of ['remote', 'ls-remote', 'fetch', 'hash-object', 'mktree', 'commit-tree', 'push']) {
    // The process adapter's result for a call its timeout ended: a signal's exit code, and `timedOut`.
    const ended = () => ({ exit: 143, timedOut: true });
    const steps = step === 'fetch' ? { ...LACKING, fetch: ended } : { [step]: ended };
    const { answer, calls } = await controlled(t, { steps });
    const last = calls.at(-1);
    assert.equal(last.args[0], step, `the push ran past the ${step} its limit ended`);
    assert.deepEqual(answer, { outcome: 'timed-out', bytes: STREAM.length, ...(['remote', 'ls-remote'].includes(step) ? {} : { parent: TIP }), reason: `the timeout of ${last.timeout} ms ended git ${step}` }, step);
  }
});

test('a push handed no limit hands each later git call a timeout no greater than PUSH_TIMEOUT less the time its earlier calls took', async (t) => {
  const { answer, calls } = await controlled(t, { cost: () => 4_000 });
  assert.equal(answer.outcome, 'pushed');
  assert.equal(calls.length, 6);
  for (const call of calls) {
    const spent = call.at - 1_000;
    assert.ok(call.timeout <= PUSH_TIMEOUT - spent, `git ${call.args[0]} after ${spent} ms was handed ${call.timeout} ms`);
  }
});

test('PUSH_TIMEOUT is 30000 milliseconds', () => {
  assert.equal(PUSH_TIMEOUT, 30_000);
});

test('P13: where the injected clock shows the limit spent when a git call is about to start, the push answers timed-out with the reason reading 9 gives, and starts neither that call nor any later one', async (t) => {
  for (const [limit, spentBy, next, ran] of [
    [undefined, 'remote', 'ls-remote', ['remote']],
    [5_000, 'mktree', 'commit-tree', ['remote', 'ls-remote', 'hash-object', 'mktree']],
  ]) {
    const { answer, calls } = await controlled(t, { ...(limit === undefined ? {} : { limit }), cost: (args) => (args[0] === spentBy ? 30_000 : 1) });
    assert.deepEqual(answer, { outcome: 'timed-out', bytes: STREAM.length, ...(ran.includes('ls-remote') ? { parent: TIP } : {}), reason: `the push's limit of ${limit ?? 30_000} ms was spent before git ${next} started` });
    assert.deepEqual(subcommandsOf(calls), ran);
  }
});

test('P17: with commit and push signing turned on in the pushing repository\'s own config, and gpg.program a stub that records each call and fails, the push answers pushed, its commit carries no signature, and the stub records no call', async (t) => {
  const w = world(t);
  const calls = join(w.directory, 'gpg-calls');
  const stub = hook(w.directory, 'gpg-stub', `echo "$@" >> '${calls}'\nexit 1`);
  gitIn(w.repository, 'config', 'commit.gpgSign', 'true');
  gitIn(w.repository, 'config', 'push.gpgSign', 'true');
  gitIn(w.repository, 'config', 'gpg.program', stub);
  // The premise: the configuration is live, so a commit asked to sign reaches the stub.
  const tree = gitIn(w.repository, 'rev-parse', 'HEAD^{tree}').trim();
  const signed = spawnSync('git', ['commit-tree', '-S', tree, '-m', 'premise'], { cwd: w.repository, env: gitEnvironment(), encoding: 'utf8' });
  assert.notEqual(signed.status, 0, 'a commit asked to sign did not fail, so the stub is not the signer');
  assert.equal(existsSync(calls), true, 'the stub recorded no call for a commit asked to sign, so this proves nothing');
  rmSync(calls);
  const { answer } = await pushed(w, STREAM);
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.doesNotMatch(gitIn(w.origin, 'cat-file', 'commit', answer.commit), /^gpgsig/m);
  assert.equal(existsSync(calls), false, 'the push ran gpg');
});

test('P18: with a pre-push hook in the pushing repository\'s core.hooksPath that records its run and exits 1, the push answers pushed and the hook records no run', async (t) => {
  const w = world(t);
  const hooks = join(w.directory, 'hooks');
  mkdirSync(hooks);
  const ran = join(w.directory, 'pre-push-ran');
  hook(hooks, 'pre-push', `echo ran >> '${ran}'\nexit 1`);
  gitIn(w.repository, 'config', 'core.hooksPath', hooks);
  const { answer } = await pushed(w, STREAM);
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(tipOf(w.origin), answer.commit);
  assert.equal(existsSync(ran), false, 'the pre-push hook ran');
});

/**
 * Another writer's push to the data ref, from the repository at `from`: a commit onto origin's tip,
 * where it has one, fetched first, holding `from`'s own tree. Hands back the commit.
 */
function otherWrite(w, from) {
  const tip = tipOf(w.origin);
  if (tip !== undefined) gitIn(from, 'fetch', '-q', '--no-write-fetch-head', 'origin', tip);
  const commit = gitIn(from, 'commit-tree', 'HEAD^{tree}', ...(tip === undefined ? [] : ['-p', tip]), '-m', 'another writer').trim();
  gitIn(from, 'push', '-q', 'origin', `${commit}:${DATA_REF}`);
  return commit;
}

/** A spawn that runs `inner`, but ends the push, as a refused event would, where `ends(args, result)` says. */
function endingAt(inner, ends) {
  return async (call) => {
    if (ends(call.args, undefined)) throw Object.assign(new Error('the push side ended here'), { code: EVENT_REFUSED });
    const result = await inner(call);
    if (ends(call.args, result)) throw Object.assign(new Error('the push side ended here'), { code: EVENT_REFUSED });
    return result;
  };
}

test('I1: where another writer\'s push lands before the push side\'s git ls-remote, the push answers pushed with parent naming the other writer\'s commit', async (t) => {
  const w = world(t);
  await pushed(w, STREAM);
  const elsewhere = cloneInto(w.origin, join(w.directory, 'elsewhere'));
  let other;
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM]), { before: (args) => { if (args[0] === 'ls-remote') other = otherWrite(w, elsewhere); } });
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(answer.parent, other);
  assert.equal(tipOf(w.origin), answer.commit);
});

test('I2: where another writer\'s push lands after the push side\'s git ls-remote and before its git push, the push answers refused with git\'s non-fast-forward text, and origin\'s ref names the other writer\'s commit', async (t) => {
  const w = world(t);
  const first = (await pushed(w, STREAM)).answer.commit;
  let other;
  // The other writer works in the pushing repository, so the push side holds its commit and git
  // names the rejection non-fast-forward; one whose commit it lacked would read "fetch first".
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM]), { before: (args) => { if (args[0] === 'push') other = otherWrite(w, w.repository); } });
  assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'parent', 'reason']);
  assert.equal(answer.outcome, 'refused');
  assert.equal(answer.parent, first);
  assert.match(answer.reason, /\[rejected\] \(non-fast-forward\)/);
  assert.equal(tipOf(w.origin), other);
});

test('I3: where a push\'s git push succeeded and the push side then ended before answering, a later push answers pushed with parent naming the earlier push\'s commit', async (t) => {
  const w = world(t);
  const calls = [];
  await assert.rejects(pushStream({ repository: w.repository, stream: STREAM, emitter: recorder(), spawn: endingAt(realGit(calls), (args, result) => args[0] === 'push' && result !== undefined), now: STILL }), { code: EVENT_REFUSED });
  const earlier = calls.find((call) => call.args[0] === 'push').args.at(-1).split(':')[0];
  assert.equal(tipOf(w.origin), earlier);
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM]));
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(answer.parent, earlier);
});

test('I4: where a push wrote its objects and ended before its git push, a later push answers pushed with parent naming origin\'s tip, not the commit left in the local store', async (t) => {
  const w = world(t);
  const tip = (await pushed(w, STREAM)).answer.commit;
  const calls = [];
  await assert.rejects(pushStream({ repository: w.repository, stream: Buffer.concat([STREAM, STREAM]), emitter: recorder(), spawn: endingAt(realGit(calls), (args, result) => args[0] === 'push' && result === undefined), now: STILL }), { code: EVENT_REFUSED });
  const left = calls.find((call) => call.args[0] === 'commit-tree').result.stdout.toString().trim();
  assert.equal(gitIn(w.repository, 'cat-file', '-t', left).trim(), 'commit', 'the ended push left no commit in the local store, so this proves nothing');
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM, STREAM]));
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(answer.parent, tip);
  assert.notEqual(answer.parent, left);
});

test('P30: where a lacking tip\'s fetch succeeds and the commit onto it then fails, the push answers failed in that commit-tree\'s words and runs no git push', async (t) => {
  let ontoTip = 0;
  const steps = {
    'commit-tree': (args) => {
      if (!args.includes('-p')) return { stdout: `${COMMIT}\n` };
      ontoTip += 1;
      return { exit: 128, stderr: ontoTip === 1 ? `fatal: ${TIP} is not a valid object\n` : 'fatal: cannot write commit object\n' };
    },
  };
  const { answer, calls } = await controlled(t, { steps });
  assert.deepEqual(answer, { outcome: 'failed', bytes: STREAM.length, parent: TIP, reason: 'fatal: cannot write commit object' });
  assert.deepEqual(subcommandsOf(calls), ['remote', 'ls-remote', 'hash-object', 'mktree', 'commit-tree', 'commit-tree', 'fetch', 'commit-tree']);
});

test('P19: with a fetch mapping of refs/rigger/* in the pushing repository\'s own config, the push answers pushed and writes no remote-tracking ref there', async (t) => {
  const w = world(t);
  gitIn(w.repository, 'config', '--add', 'remote.origin.fetch', '+refs/rigger/*:refs/remotes/origin/rigger/*');
  const before = gitIn(w.repository, 'for-each-ref');
  const { answer } = await pushed(w, STREAM);
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(gitIn(w.repository, 'for-each-ref', 'refs/remotes/origin/rigger/events'), '');
  assert.equal(gitIn(w.repository, 'for-each-ref'), before);
});

test('P21: with two push URLs for origin in the pushing repository\'s own config, the push answers failed naming both, and runs no git hash-object and no git push', async (t) => {
  const w = world(t);
  const first = bareCloneInto(w.origin, join(w.directory, 'first.git'));
  const second = bareCloneInto(w.origin, join(w.directory, 'second.git'));
  gitIn(w.repository, 'config', '--add', 'remote.origin.pushurl', first);
  gitIn(w.repository, 'config', '--add', 'remote.origin.pushurl', second);
  const { answer, calls } = await pushed(w, STREAM);
  assert.deepEqual(keysOf(answer), ['bytes', 'outcome', 'reason']);
  assert.equal(answer.outcome, 'failed');
  assert.ok(answer.reason.includes(first) && answer.reason.includes(second), answer.reason);
  assert.deepEqual(calls.filter((call) => ['hash-object', 'push'].includes(call.args[0])), []);
  for (const bare of [w.origin, first, second]) assert.equal(tipOf(bare), undefined);
});

test('P20: with origin\'s push URL set to a second bare repository in the pushing repository\'s own config, the push answers pushed to that repository, and the data ref at origin\'s URL is unchanged', async (t) => {
  const w = world(t);
  const first = (await pushed(w, STREAM)).answer.commit;
  const elsewhere = bareCloneInto(w.origin, join(w.directory, 'elsewhere.git'));
  gitIn(w.repository, 'config', 'remote.origin.pushurl', elsewhere);
  const { answer } = await pushed(w, Buffer.concat([STREAM, STREAM]), { pushedTo: elsewhere });
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(tipOf(elsewhere), answer.commit);
  assert.equal(tipOf(w.origin), first);
});

/**
 * A world whose origin has a push URL of its own: a second bare repository, cloned from origin
 * with no data ref, which `remote.origin.pushurl` names in the pushing repository's own config.
 */
function withPushUrl(w, name = 'push-url.git') {
  const target = bareCloneInto(w.origin, join(w.directory, name));
  gitIn(w.repository, 'config', 'remote.origin.pushurl', target);
  return target;
}

test('P22: where the push URL holds the branch refs/heads/refs/rigger/events and origin\'s URL holds no colliding ref, the push answers failed naming it, writes nothing, and leaves every ref at the push URL unchanged', async (t) => {
  const w = world(t);
  const target = withPushUrl(w);
  const branch = 'refs/heads/refs/rigger/events';
  gitIn(target, 'update-ref', branch, gitIn(target, 'rev-parse', 'refs/heads/main').trim());
  assert.equal(gitIn(w.origin, 'for-each-ref', branch), '', 'origin\'s URL holds the colliding branch, so this proves nothing');
  const refs = gitIn(target, 'for-each-ref');
  const { answer, calls } = await pushed(w, STREAM, { pushedTo: target });
  assert.equal(answer.outcome, 'failed', answer.reason);
  assert.ok(answer.reason.includes(branch), answer.reason);
  assert.deepEqual(calls.filter((call) => ['hash-object', 'push'].includes(call.args[0])), []);
  assert.equal(gitIn(target, 'for-each-ref'), refs);
});

test('P25: where the push URL\'s refs/rigger/events names a commit the local store lacks, the push fetches it from the push URL and answers pushed with parent naming it, leaving no new ref and no FETCH_HEAD', async (t) => {
  const w = world(t);
  const target = withPushUrl(w);
  const elsewhere = cloneInto(w.origin, join(w.directory, 'elsewhere'));
  gitIn(elsewhere, 'config', 'remote.origin.pushurl', target);
  const tip = (await pushed(w, STREAM, { repository: elsewhere, pushedTo: target })).answer.commit;
  assert.notEqual(spawnSync('git', ['cat-file', '-e', tip], { cwd: w.origin, env: gitEnvironment() }).status, 0, 'origin\'s URL holds the tip, so this proves nothing');
  assert.notEqual(spawnSync('git', ['cat-file', '-e', tip], { cwd: w.repository, env: gitEnvironment() }).status, 0, 'the local store holds the tip, so this proves nothing');
  const { answer, calls } = await pushed(w, Buffer.concat([STREAM, STREAM]), { pushedTo: target });
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(answer.parent, tip);
  assert.equal(tipOf(target), answer.commit);
  assert.deepEqual(calls.filter((call) => call.args[0] === 'fetch').map((call) => call.args), [['fetch', '--no-write-fetch-head', '--no-tags', target, tip]]);
});

test('P23: with a push URL of its own, three pushes in a row each answer pushed, each building on the tip the push before it set at the push URL, and origin\'s URL is unchanged', async (t) => {
  const w = world(t);
  const target = withPushUrl(w);
  const refs = gitIn(w.origin, 'for-each-ref');
  let previous;
  for (const copies of [1, 2, 3]) {
    const { answer } = await pushed(w, Buffer.concat(Array(copies).fill(STREAM)), { pushedTo: target });
    assert.equal(answer.outcome, 'pushed', `push ${copies}: ${answer.reason}`);
    assert.equal(answer.parent, previous, `push ${copies}`);
    assert.equal(tipOf(target), answer.commit, `push ${copies}`);
    previous = answer.commit;
  }
  assert.equal(gitIn(w.origin, 'for-each-ref'), refs);
});

test('P24: where origin\'s URL holds the branch refs/heads/refs/rigger/events and the push URL holds no colliding ref, the push answers pushed, because the fetch URL is not read, and origin\'s URL is unchanged', async (t) => {
  const w = world(t);
  const target = withPushUrl(w);
  gitIn(w.origin, 'update-ref', 'refs/heads/refs/rigger/events', gitIn(w.origin, 'rev-parse', 'refs/heads/main').trim());
  const refs = gitIn(w.origin, 'for-each-ref');
  const { answer } = await pushed(w, STREAM, { pushedTo: target });
  assert.equal(answer.outcome, 'pushed', answer.reason);
  assert.equal(tipOf(target), answer.commit);
  assert.equal(gitIn(w.origin, 'for-each-ref'), refs);
});
