// ABOUTME: Tests `rigger once` and `rigger run` making and provisioning each claimed card's
// workspace through L3's pull and no-clock drain, over a fixture repository with a local `origin` and a fake
// board, and then dispatching its maker through L1 to a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once } from '../src/cli/once.mjs';
import { run } from '../src/cli/run.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { fixture, GIT, gitUnansweredAdd, scratch, withFirstOnPath } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { createHash, randomUUID } from 'node:crypto';

/** The stand-in agent every maker in this file runs as, on the PATH each verb runs under. */
const agent = standInAgent();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The verbs under test, run in this process. */
const VERBS = { once, run };

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/**
 * How long a verb may run before the test kills it and fails, so that a verb which never settles,
 * as one that fired a pull again on each freed slot over a card that keeps failing would not,
 * fails its test rather than holding the suite. A judgment, whose premise is a measurement: the
 * slowest test in this file took 1.9 s with Node 26.5.0 on macOS 27.0 on 2026-09-30, under a
 * one-minute load near 20 on 12 CPUs.
 */
const { 60_000: { timeout: SETTLES_WITHIN } } = BOUNDS;

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card the `change` kind selects, in the template's column displayed as `column`, carrying `labels` besides. */
const card = (number, { column = template.board.columns.ready, labels = [] } = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change', ...labels], column,
});

/** One step whose `run` is `true`, which the `change` kind lists and every other kind does not. */
const ONE_STEP = { steps: { ready: { run: 'true', required: true } }, listed: ['ready'] };

/**
 * A consumer's world for the test `t`, in a scratch directory its teardown sweeps: `target`, a
 * repository with a local bare `origin` beside it, holding the template's config for the board,
 * under N `concurrency`, whose `change` kind lists `listed` of the provisioning `steps` and whose
 * other kinds list none, with `worktrees` in place of the template's where it is given; and a fake
 * `gh` holding `items`. The scratch directory is `directory` where the caller made it. `verb(name, cwd)` runs the real bin's verb from `cwd`, the target unless
 * given, with this file's stand-in agent first on PATH, the maker every claimed card runs as, and
 * the fake `gh` after it.
 */
function world(t, { items, concurrency = 3, steps = ONE_STEP.steps, listed = ONE_STEP.listed, worktrees = template.worktrees, gitDirectory, waitForClose = false }, directory = scratch(t)) {
  const kinds = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: name === 'change' ? listed : [] }]));
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency, worktrees, kinds, provisioning: steps };
  const target = withOrigin(repositoryAt(join(directory, 'target'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(directory, 'origin.git'));
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items },
  });
  const evidence = waitForClose ? join(process.env.RIGGER_1216_EVIDENCE_ROOT ?? join(process.env.RUNNER_TEMP ?? dirname(process.env.TMPDIR ?? '/tmp'), 'rigger-1216-evidence'), randomUUID()) : undefined;
  const stream = join(target, '.rigger', 'events.jsonl');
  const preload = evidence && join(evidence, 'observer.cjs');
  if (evidence) {
    mkdirSync(evidence, { recursive: true, mode: 0o700 });
    writeFileSync(join(evidence, 'world.json'), JSON.stringify({ title: t.name, target, directory, items, pid: process.pid }));
    writeFileSync(preload, `// ABOUTME: Observes this fixture's native event writes and worker results.\n(${closeWorldObserver.toString()})(${JSON.stringify(stream)}, ${JSON.stringify(evidence)}, true);\n`);
  }
  const maker = waitForClose ? afterAdmissionClose(target, evidence) : agent;
  const env = { ...process.env, PATH: [maker.dir, join(directory, 'fake'), gitDirectory, process.env.PATH].filter(Boolean).join(delimiter) };
  const verb = (name, cwd = target) => {
    const ran = spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), bin, name], { cwd, encoding: 'utf8', env, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
    if (evidence) {
      writeFileSync(join(evidence, 'verb.stdout'), ran.stdout ?? '');
      writeFileSync(join(evidence, 'verb.stderr'), ran.stderr ?? '');
      writeFileSync(join(evidence, 'verb.json'), JSON.stringify({ pid: ran.pid, status: ran.status, signal: ran.signal, error: ran.error?.stack }));
      if (existsSync(stream)) writeFileSync(join(evidence, 'events.jsonl'), readFileSync(stream));
      publishCloseEvidence(t, evidence);
      const history = readFileSync(join(evidence, 'trace.jsonl'), 'utf8').trimEnd().split('\n').map(JSON.parse);
      const recorded = readEvents(join(target, '.rigger'));
      const closed = recorded.find(({ event }) => event === 'admission.close');
      for (const number of [20, 30]) {
        const dispatched = recorded.find(({ event, card, role }) => event === 'dispatch' && card === number && role === 'engineer');
        const start = recorded.find(({ event, dispatch }) => event === 'dispatch.start' && dispatch === dispatched?.dispatch);
        const worker = history.find(({ event, cwd }) => event === 'waiter.start' && cwd === start?.workspace);
        const ended = recorded.find(({ event, dispatch }) => event === 'dispatch.end' && dispatch === start?.dispatch);
        const exited = history.find(({ event, pid }) => event === 'worker.exit' && pid === worker?.pid);
        const observed = history.find(({ event, pid }) => event === 'waiter.close' && pid === worker?.pid);
        const premise = `wait-for-close fixture premise failed for sibling #${number}; originals ${evidence}\n${ran.stderr}`;
        assert.equal(ended?.exit, 0, premise);
        assert.equal(exited?.code, 0, premise);
        assert.ok(closed && observed, premise);
        assert.deepEqual(observed.record, closed, premise);
      }
    }
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, said: `exited ${ran.status}: ${ran.stdout}${ran.stderr}` };
  };
  const events = () => readEvents(join(target, '.rigger'));
  return { directory, target, fake, verb, events, worktrees: join(directory, 'widgets-worktrees') };
}

/** A successful maker held by the actual recorded admission.close, so no fast sibling races it. */
function afterAdmissionClose(target, evidence) {
  const stream = join(target, '.rigger', 'events.jsonl');
  const script = [
    "const fs = require('node:fs');",
    `const stream = ${JSON.stringify(stream)};`,
    `const trace = (${closeWorldObserver.toString()})(stream, ${JSON.stringify(evidence)});`,
    "const closed = () => trace.read(() => fs.readFileSync(stream, 'utf8')).split('\\n').slice(0, -1).map((line) => trace.parse(line)).some((record) => record.event === 'admission.close');",
    'function untilClosed() { if (!closed()) setImmediate(untilClosed); } untilClosed();',
  ].join('\n');
  return standInAgent({ '*': { engineer: { exec: [process.execPath, '-e', script] } } });
}

/** Bounded log records preserve every original through hosted-runner teardown without one giant line. */
function publishCloseEvidence(t, evidence) {
  for (const file of readdirSync(evidence)) {
    const bytes = readFileSync(join(evidence, file));
    t.diagnostic(JSON.stringify({ tool: '1216-evidence', evidence, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      t.diagnostic(JSON.stringify({ tool: '1216-evidence', evidence, file, offset, base64: bytes.subarray(offset, offset + 1024).toString('base64') }));
    }
  }
}

/** Observation only: one append orders records across processes; read ordinals coalesce identical snapshots. */
function closeWorldObserver(stream, evidence, engine = false) {
  const fs = require('node:fs');
  const { join } = require('node:path');
  const append = fs.appendFileSync;
  const write = fs.writeFileSync;
  let sequence = 0;
  let ordinal = 0;
  let current;
  const errorOf = (error) => ({ name: error.name, code: error.code, message: error.message, stack: error.stack });
  const record = (event, fields = {}) => append(join(evidence, 'trace.jsonl'), `${JSON.stringify({ pid: process.pid, sequence: ++sequence, at: String(process.hrtime.bigint()), event, ...fields })}\n`);
  const flush = () => {
    if (current) {
      const { text, ...outcome } = current;
      record('read.outcome', { ...outcome, bytes: Buffer.byteLength(text) });
    }
    current = undefined;
  };
  record(engine ? 'engine.start' : 'waiter.start', { cwd: process.cwd() });
  process.once('uncaughtExceptionMonitor', (error) => { flush(); record('worker.exception', { error: errorOf(error) }); });
  process.once('exit', (code) => { flush(); record(engine ? 'engine.exit' : 'worker.exit', { code }); });
  if (engine) {
    const cp = require('node:child_process');
    const spawn = cp.spawn;
    fs.appendFileSync = function(path, bytes, ...options) {
      if (path !== stream) return append.call(this, path, bytes, ...options);
      record('event.append.begin', { bytes: Buffer.from(bytes).toString('base64') });
      try {
        const returned = append.call(this, path, bytes, ...options);
        record('event.append.end', { record: JSON.parse(String(bytes)) });
        return returned;
      } catch (error) { record('event.append.error', { error: errorOf(error) }); throw error; }
    };
    const admission = join(stream.slice(0, stream.lastIndexOf('/')), 'admission');
    for (const method of ['lstatSync', 'readdirSync']) {
      const actual = fs[method];
      fs[method] = function(path, ...args) {
        if (path !== admission) return actual.call(this, path, ...args);
        try {
          const value = actual.call(this, path, ...args);
          record(`admission.${method}`, { entries: method === 'readdirSync' ? value.map((entry) => entry.name) : undefined });
          return value;
        } catch (error) { record(`admission.${method}.error`, { error: errorOf(error) }); throw error; }
      };
    }
    const descriptors = new Map();
    for (const method of ['openSync', 'readFileSync', 'closeSync']) {
      const actual = fs[method];
      fs[method] = function(path, ...args) {
        const tracked = typeof path === 'string' ? path.startsWith(`${admission}/`) : descriptors.has(path);
        const value = actual.call(this, path, ...args);
        if (tracked) {
          if (method === 'openSync') descriptors.set(value, path);
          record(`admission.${method}`, { path: descriptors.get(path) ?? path, bytes: method === 'readFileSync' ? Buffer.from(value).toString('base64') : undefined });
          if (method === 'closeSync') descriptors.delete(path);
        }
        return value;
      };
    }
    cp.spawn = function(command, args, options) {
      const child = spawn.apply(this, arguments);
      if (options?.detached) {
        record('worker.spawn', { child: child.pid, command, args, cwd: options.cwd });
        for (const channel of ['stdout', 'stderr']) child[channel]?.on('data', (bytes) => record(`worker.${channel}`, { child: child.pid, bytes: bytes.toString('base64') }));
        child.once('exit', (code, signal) => record('worker.result', { child: child.pid, code, signal }));
        child.once('error', (error) => record('worker.start.error', { child: child.pid, error: errorOf(error) }));
      }
      return child;
    };
    require('node:module').syncBuiltinESMExports();
  }
  return {
    read: (use) => {
      ordinal += 1;
      let text;
      try { text = use(); }
      catch (error) { flush(); record('read.error', { ordinal, error: errorOf(error) }); throw error; }
      if (current?.text === text) { current.last = ordinal; current.count += 1; return text; }
      flush();
      const snapshot = `${process.pid}-read-${ordinal}.jsonl`;
      write(join(evidence, snapshot), text);
      current = { text, snapshot, first: ordinal, last: ordinal, count: 1, parsed: [] };
      record('read.snapshot', { ordinal, snapshot });
      return text;
    },
    parse: (line) => {
      try {
        const parsed = JSON.parse(line);
        if (current?.count === 1) current.parsed.push(parsed);
        if (parsed.event === 'admission.close') { record('waiter.close', { ordinal, record: parsed }); flush(); }
        return parsed;
      } catch (error) { record('parse.error', { ordinal, line, error: errorOf(error) }); flush(); throw error; }
    },
  };
}

/** The directories under `path`, sorted, or none where nothing is there. */
const under = (path) => (existsSync(path) ? readdirSync(path).sort() : []);

/** Three pullable cards of kind `change`, oldest first #10, #20, #30. */
const THREE = [card(30), card(10), card(20)];

test('given three pullable cards and a change kind listing one step whose run is true, rigger once claims exactly one card and leaves exactly one workspace', async (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const columns = Object.fromEntries((await (await here.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(Object.values(columns).filter((column) => column === 'Coding').length, 1, ran.said);
  assert.deepEqual(under(here.worktrees).filter((name) => name !== 'scratch').length, 1, ran.said);
});

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (here) => Object.fromEntries((await (await here.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** The workspace the default root and topic derive for card `number` in `here`: `<top level>/../widgets-worktrees/rigger-<number>`. */
const derived = (here, number) => join(dirname(realpathSync(here.target)), 'widgets-worktrees', `rigger-${number}`);

test('given that world, the workspace lies at the path the configured topic derives for the card rigger once claimed', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  assert.match(ran.err, /claimed #10\b/, ran.said);
  assert.deepEqual(under(here.worktrees), ['rigger-10', 'scratch'], ran.said);
  assert.equal(realpathSync(join(here.worktrees, 'rigger-10')), derived(here, 10));
});

test('given that world, the event stream shows the step dispatched, exiting 0, with its dispatch.start naming that workspace', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const events = here.events();
  const dispatched = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.deepEqual(dispatched.map(({ card: number, step, role, tier }) => ({ card: number, step, role, tier })), [{ card: 10, step: 'ready', role: undefined, tier: undefined }, { card: 10, step: undefined, role: 'engineer', tier: 'standard' }], ran.said);
  const [{ dispatch: id }] = dispatched;
  const start = events.find((event) => event.event === 'dispatch.start' && event.dispatch === id);
  const end = events.find((event) => event.event === 'dispatch.end' && event.dispatch === id);
  assert.equal(start?.workspace, derived(here, 10), JSON.stringify(start));
  assert.equal(end?.exit, 0, JSON.stringify(end));
});

test('given that world, rigger once prints a line naming the card, its workspace\'s path, and its maker\'s outcome', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.said);
  assert.ok(line.includes(derived(here, 10)), line);
  assert.match(line, /; Rigger escalated it as ambiguous: card #10's maker started its work from the beginning and exited 0, and the forge holds no open pull request from its line of work rigger-10, in its workspace, /, line);
});

test('given that world, rigger once exits non-zero', (t) => {
  const ran = world(t, { items: THREE }).verb('once');

  assert.notEqual(ran.code, 0, ran.said);
});

test('given that world, the line rigger once prints for its card begins rigger once: claimed #<n> from board <p>', (t) => {
  const ran = world(t, { items: THREE }).verb('once');

  assert.match(ran.err, /^rigger once: claimed #10 from board 3\b/m, ran.said);
});

test('given that world, the card rigger once claimed is in the coding column afterwards', async (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  assert.deepEqual(await columnsOf(here), { 10: 'Coding', 20: 'Ready', 30: 'Ready' }, ran.said);
});

/** A required step that exits 3, which the `change` kind lists after `ready`, selected only for a card carrying `area:fails`. */
const FAILING = {
  steps: { ...ONE_STEP.steps, fails: { run: 'exit 3', required: true, select: { labels: ['area:fails'] } } },
  listed: ['ready', 'fails'],
};

test('given a required step that exits non-zero on both attempts, rigger once prints both attempts\' failures, each naming the step and its exit code, and exits non-zero', (t) => {
  const here = world(t, { items: [card(10, { labels: ['area:fails'] })], ...FAILING });

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /rigger once: card #10 was held after 2 attempts/);
  for (const attempt of [1, 2]) {
    const line = ran.err.split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

/** A world where git gives no answer while L1 adds card 10's workspace twice. */
function unansweredWorkspaceWorld(t, items, waitForClose = false) {
  const directory = scratch(t);
  const stand = join(directory, 'unanswered-git');
  mkdirSync(stand);
  gitUnansweredAdd(stand, 'rigger-10', 2);
  return world(t, { items, gitDirectory: stand, waitForClose }, directory);
}

test('given a workspace that cannot be made on either attempt, rigger once prints both attempts\' failures, each naming the workspace path, and exits non-zero', (t) => {
  const here = unansweredWorkspaceWorld(t, [card(10)]);
  const path = derived(here, 10);

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /rigger once: card #10 was held after 2 attempts/);
  for (const attempt of [1, 2]) {
    const line = ran.err.split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.ok(line.includes(`"workspace":${JSON.stringify(path)}`), line);
  }
});

// proves R-FAIL-8
test('rigger once names a hold and both failures when the same required step never starts twice', (t) => {
  const here = world(t, { items: [card(10)], steps: { missing: { run: 'true', cwd: 'absent', required: true } }, listed: ['missing'] });

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /rigger once: card #10 was held after 2 attempts/);
  const failures = ran.err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.equal(failures.length, 2, ran.said);
  assert.ok(failures.every((line) => /"step":"missing"/.test(line) && /"reason":/.test(line)), ran.said);
});

/** A card whose required step never starts first, then exits 3 on its second attempt. */
function mixedFailureWorld(t) {
  const directory = scratch(t);
  const marker = join(directory, 'first-attempt');
  return world(t, {
    items: [card(10)],
    steps: {
      prepare: { run: `if [ -e '${marker}' ]; then mkdir missing; else : > '${marker}'; fi`, required: true },
      failing: { run: 'exit 3', cwd: 'missing', required: true },
    },
    listed: ['prepare', 'failing'],
  }, directory);
}

// proves R-FAIL-8
test('rigger once stops a card whose required step never starts then exits non-zero', (t) => {
  const ran = mixedFailureWorld(t).verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /rigger once: card #10 was stopped after 2 attempts/);
  const failures = ran.err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.equal(failures.length, 2, ran.said);
  assert.match(failures[0], /"step":"failing".*"reason":/);
  assert.match(failures[1], /"step":"failing".*"exit":3/);
});

// proves R-FAIL-8
test('rigger run stops a card whose required step never starts then exits non-zero', (t) => {
  const ran = mixedFailureWorld(t).verb('run');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /rigger run: card #10 was stopped after 2 attempts/);
  const failures = ran.err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.equal(failures.length, 2, ran.said);
  assert.match(failures[0], /"step":"failing".*"reason":/);
  assert.match(failures[1], /"step":"failing".*"exit":3/);
});

/**
 * A world whose `change` kind lists an optional step, `breaks`, then a required one, `after`.
 * `breaks` moves the event stream aside into `saved/` and puts a directory in its place, so the
 * sink refuses L1's `dispatch.end` of that step and every append after it, and the stream as it
 * stood until then is kept. `after` would leave a file, `after-ran`, in the scratch directory.
 */
function refusingEnd(t) {
  const directory = scratch(t);
  const stream = join(directory, 'target', '.rigger', 'events.jsonl');
  mkdirSync(join(directory, 'saved'));
  const marker = join(directory, 'after-ran');
  const steps = {
    breaks: { run: `mv '${stream}' '${join(directory, 'saved', 'events.jsonl')}' && mkdir '${stream}'` },
    after: { run: `touch '${marker}'`, required: true },
  };
  const here = world(t, { items: [card(10)], steps, listed: ['breaks', 'after'] }, directory);
  return { ...here, marker, saved: () => readEvents(join(directory, 'saved')) };
}

// proves R-RECORD-9
test('given an optional step whose L1 dispatch.end the sink refuses, rigger once exits non-zero naming the unrecorded event', (t) => {
  const here = refusingEnd(t);

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /went unrecorded:\ndispatch\.end of dispatch d-\S+, card #10\b/, ran.said);
});

// proves R-RECORD-9
test('given an optional step followed by a second selected step, where the sink refuses the optional step\'s L1 dispatch.end, rigger once starts neither the second step nor a second attempt, and reaches no maker, as the event stream and the stand-in show', (t) => {
  const here = refusingEnd(t);

  const ran = here.verb('once');

  const events = here.saved();
  const starts = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.deepEqual(starts.map(({ step, attempt }) => ({ step, attempt })), [{ step: 'breaks', attempt: 1 }], ran.said);
  assert.equal(events.filter((event) => event.event === 'workspace.made').length, 1, ran.said);
  assert.equal(events.at(-1).event, 'dispatch.start', `the stream went on past the step that broke it: ${JSON.stringify(events.at(-1))}`);
  assert.equal(existsSync(here.marker), false, 'the second step ran');
  assert.deepEqual(starts.filter((event) => event.card === 10 && event.role !== undefined), [], ran.said);
  assert.deepEqual(agent.runs().filter((run) => run.cwd === derived(here, 10)), [], ran.said);
  assert.doesNotMatch(ran.err, /`after`/, ran.said);
});

test('given a card in the coding column with no pull request, as a redo, rigger once gives it a fresh workspace, which holds no file an earlier attempt left there', async (t) => {
  const here = world(t, { items: [card(10)] });
  const first = here.verb('once');
  assert.deepEqual(await columnsOf(here), { 10: 'Coding' }, first.said);
  writeFileSync(join(derived(here, 10), 'left-behind.txt'), 'an earlier attempt\'s file\n');

  const ran = here.verb('once');

  assert.match(ran.err, /^rigger once: claimed #10 from board 3\b/m, ran.said);
  assert.equal(existsSync(join(derived(here, 10), 'rigger.config.mjs')), true, ran.said);
  assert.equal(existsSync(join(derived(here, 10), 'left-behind.txt')), false, ran.said);
});

/** The topics whose name for card 1 git refuses as a branch name. */
const REFUSED_TOPICS = ['rigger-{number}.lock', 'rigger..{number}'];

/**
 * Runs `verb` over each topic in `REFUSED_TOPICS`, in a world of its own, and asserts it exits
 * non-zero naming the topic, and sends the board stand-in nothing, so it neither read nor moved.
 */
function refusesTopic(t, verb) {
  for (const topic of REFUSED_TOPICS) {
    const here = world(t, { items: [card(10)], worktrees: { topic } });

    const ran = here.verb(verb);

    assert.notEqual(ran.code, 0, ran.said);
    assert.ok(ran.err.includes(`\`${topic}\``), ran.said);
    assert.deepEqual(here.fake.sent(), [], ran.said);
  }
}

test('given a topic whose name for card 1 git refuses as a branch name, rigger once exits non-zero naming the topic, and the board stand-in records no read and no move', (t) => refusesTopic(t, 'once'));

test('given a topic whose name for card 1 git refuses as a branch name, rigger run exits non-zero naming the topic, and the board stand-in records no read and no move', (t) => refusesTopic(t, 'run'));

test('given a config declaring no worktree root, the root rigger once hands L1 is <top level>/../<name>-worktrees, <name> being repo after the slash, resolved to an absolute path', (t) => {
  const here = world(t, { items: [card(10)], worktrees: { topic: 'rigger-{number}' } });

  const ran = here.verb('once');

  // The workspace lies directly under the root L1 was handed, named by the topic.
  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.said);
  assert.ok(line.endsWith(`, ${join(dirname(realpathSync(here.target)), 'widgets-worktrees', 'rigger-10')}`), line);
});

test('given a relative worktrees.root, it resolves against the repository\'s top level, whatever directory rigger once is run from', (t) => {
  const here = world(t, { items: [card(10)], worktrees: { root: '../elsewhere', topic: 'rigger-{number}' } });
  const below = join(here.target, 'deep', 'below');
  mkdirSync(below, { recursive: true });

  const ran = here.verb('once', below);

  const expected = join(dirname(realpathSync(here.target)), 'elsewhere', 'rigger-10');
  assert.ok(ran.err.split('\n').some((held) => held.endsWith(`, ${expected}`)), ran.said);
  assert.equal(existsSync(join(expected, 'rigger.config.mjs')), true, ran.said);
});

test('given rigger once run from a subdirectory of the target, the repository L1 is handed is the target\'s top level, not the directory it was run from', (t) => {
  const here = world(t, { items: [card(10)] });
  const below = join(here.target, 'deep', 'below');
  mkdirSync(below, { recursive: true });
  // A `git` first on PATH that records the directory each call runs in, then runs the real git.
  // L0's workspace adapter runs every call in the repository it was handed.
  mkdirSync(join(here.directory, 'recording'));
  fixture(join(here.directory, 'recording'), 'git', ['printf \'%s | %s\\n\' "$(pwd -P)" "$*" >> "$here/git-calls"', `exec '${GIT}' "$@"`].join('\n'));
  const path = [join(here.directory, 'recording'), join(here.directory, 'fake'), agent.dir, process.env.PATH].join(delimiter);

  const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: below, encoding: 'utf8', env: { ...process.env, PATH: path }, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });

  const said = `exited ${ran.status}: ${ran.stdout}${ran.stderr}`;
  const calls = readFileSync(join(here.directory, 'recording', 'git-calls'), 'utf8').split('\n').filter(Boolean);
  const adds = calls.filter((call) => call.includes(' | worktree add '));
  assert.equal(adds.length, 1, `${said}\n${calls.join('\n')}`);
  assert.ok(adds[0].startsWith(`${realpathSync(here.target)} | `), adds[0]);
  assert.match(ran.stderr, /^rigger once: claimed #10 from board 3\b/m, said);
});

/**
 * `verb` run in this process over a world whose config declares a worktree root inside `package`,
 * a directory standing as the source tree this Rigger is running from. The fake `gh`, holding a
 * card the verb would claim, is first on this process's PATH for the call, so a verb that went on
 * would read the board, claim the card and make its workspace under the package. Asserts it exits
 * non-zero naming `R-SAFE-5` before it claims any card: the fake `gh` receives no call.
 */
async function refusesRootInSourceTree(t, verb) {
  const directory = scratch(t);
  const packageRoot = join(directory, 'package');
  mkdirSync(join(packageRoot, 'src'), { recursive: true });
  const here = world(t, { items: [card(10)], worktrees: { root: join(packageRoot, 'src', 'worktrees'), topic: 'rigger-{number}' } }, directory);
  const before = readdirSync(packageRoot, { recursive: true }).sort();

  const ran = await withFirstOnPath(join(directory, 'fake'), () => VERBS[verb]({ target: here.target, packageRoot }));

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/, ran.text);
  assert.deepEqual(here.fake.sent(), [], ran.text);
  return { ran, packageRoot, before };
}

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger once exits non-zero naming R-SAFE-5 before it claims any card', (t) => refusesRootInSourceTree(t, 'once'));

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger once creates nothing under the running package\'s source tree', async (t) => {
  const { ran, packageRoot, before } = await refusesRootInSourceTree(t, 'once');

  assert.deepEqual(readdirSync(packageRoot, { recursive: true }).sort(), before, ran.text);
});

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger run exits non-zero naming R-SAFE-5 before it claims any card', (t) => refusesRootInSourceTree(t, 'run'));

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger run creates nothing under the running package\'s source tree', async (t) => {
  const { ran, packageRoot, before } = await refusesRootInSourceTree(t, 'run');

  assert.deepEqual(readdirSync(packageRoot, { recursive: true }).sort(), before, ran.text);
});

/** Four pullable cards of kind `change`, oldest first #10, #20, #30, #40. */
const FOUR = [card(30), card(10), card(40), card(20)];

test('given four pullable cards, N 3, and a change kind listing one true step, rigger run drains all four into distinct real workspaces', async (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  const made = under(here.worktrees).filter((name) => name !== 'scratch').map((name) => realpathSync(join(here.worktrees, name)));
  assert.equal(new Set(made).size, 4, `${ran.said}\n${made.join('\n')}`);
  assert.deepEqual(await columnsOf(here), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Coding' }, ran.said);
});

test('given that world, the event stream shows the step dispatched for each card rigger run claimed, exiting 0, with its dispatch.start naming that card\'s own workspace', (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  const events = here.events();
  for (const number of [10, 20, 30, 40]) {
    const dispatched = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.card === number);
    assert.deepEqual(dispatched.map(({ step }) => step), ['ready', undefined], ran.said);
    const [{ dispatch: id }] = dispatched;
    const start = events.find((event) => event.event === 'dispatch.start' && event.dispatch === id);
    const end = events.find((event) => event.event === 'dispatch.end' && event.dispatch === id);
    assert.equal(start?.workspace, derived(here, number), JSON.stringify(start));
    assert.equal(end?.exit, 0, JSON.stringify(end));
  }
});

test('given that world, rigger run prints a line for each claimed card naming the card, its workspace\'s path, and its maker\'s outcome', (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  for (const number of [10, 20, 30, 40]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`^rigger run: claimed #${number} from board 3\\b`).test(held));
    assert.ok(line, ran.said);
    assert.ok(line.includes(derived(here, number)), line);
    assert.match(line, new RegExp(`; Rigger escalated it as ambiguous: card #${number}'s maker started its work from the beginning and exited 0, and the forge holds no open pull request from its line of work rigger-${number}, in its workspace, `), line);
  }
});

test('given that world, rigger run exits non-zero', (t) => {
  const ran = world(t, { items: FOUR }).verb('run');

  assert.notEqual(ran.code, 0, ran.said);
});

/** The number of times the event stream `events` records the pull trigger firing. */
const pulls = (events) => events.filter((event) => event.layer === 'L3' && event.event === 'trigger' && event.trigger === 'pull').length;

test('given four pullable cards and N 3, where one claimed card\'s required step exits non-zero on both attempts, rigger run prints both attempts\' failures for that card, each naming the step and its exit code', (t) => {
  const here = world(t, { items: [card(30), card(10, { labels: ['area:fails'] }), card(40), card(20)], ...FAILING, waitForClose: true });

  const ran = here.verb('run');

  const held = ran.err.indexOf('rigger run: card #10 was held after 2 attempts');
  assert.ok(held >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(held).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

test('in that case, freed-slot pulls read the hold closed and claim no fourth card', (t) => {
  const here = world(t, { items: [card(30), card(10, { labels: ['area:fails'] }), card(40), card(20)], ...FAILING, waitForClose: true });

  const ran = here.verb('run');

  const events = here.events();
  assert.ok(events.some((event) => event.event === 'slot.release' && event.card === 10), ran.said);
  assert.equal(pulls(events), 4, ran.said);
  assertClosedBeforeRefill(events, ran.said);
});

test('given a workspace not made on either attempt, run prints both failures and its freed-slot pulls claim no fourth card after the hold', async (t) => {
  const here = unansweredWorkspaceWorld(t, FOUR, true);
  const path = derived(here, 10);

  const ran = here.verb('run');

  const held = ran.err.indexOf('rigger run: card #10 was held after 2 attempts');
  assert.ok(held >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(held).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line?.includes(`"workspace":${JSON.stringify(path)}`), ran.said);
  }
  const events = here.events();
  assert.ok(events.some((event) => event.event === 'slot.release' && event.card === 10), ran.said);
  assert.equal(pulls(events), 4, ran.said);
  assertClosedBeforeRefill(events, ran.said);
  assert.equal((await columnsOf(here))[40], 'Ready', ran.said);
});

/** Every sibling maker releases only after the actual close, and every subsequent claim is barred. */
function assertClosedBeforeRefill(events, said) {
  const closed = events.findIndex(({ event }) => event === 'admission.close');
  assert.ok(closed >= 0, said);
  assert.deepEqual(events.slice(closed + 1).filter(({ event }) => event === 'pull'), [], said);
  for (const number of [20, 30]) assert.ok(events.findIndex(({ event, card }) => event === 'slot.release' && card === number) > closed, said);
}

/** #10, #20 and #30, oldest first, where #20 alone carries `area:fails`, so under `FAILING` its required step exits non-zero on both attempts. */
const ONE_FAILING = [card(30), card(10), card(20, { labels: ['area:fails'] })];

/** The line `text` holds beginning `rigger run: claimed #<number> from board 3`, which must be there. */
function claimedLine(text, number, said) {
  const line = text.split('\n').find((held) => new RegExp(`^rigger run: claimed #${number} from board 3\\b`).test(held));
  assert.ok(line, said);
  return line;
}

test('given a pull claiming #10, #20 and #30, where #20\'s required step exits non-zero on both attempts, rigger run prints a line for #10 naming its workspace\'s path and its maker\'s outcome', (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const line = claimedLine(ran.err, 10, ran.said);
  assert.ok(line.includes(derived(here, 10)), line);
  assert.match(line, /; Rigger escalated it as ambiguous: card #10's maker started its work from the beginning and exited 0, and the forge holds no open pull request from its line of work rigger-10, in its workspace, /, line);
});

test('given that world, rigger run prints a line for #30 naming its workspace\'s path and its maker\'s outcome', (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const line = claimedLine(ran.err, 30, ran.said);
  assert.ok(line.includes(derived(here, 30)), line);
  assert.match(line, /; Rigger escalated it as ambiguous: card #30's maker started its work from the beginning and exited 0, and the forge holds no open pull request from its line of work rigger-30, in its workspace, /, line);
});

test('given that world, rigger run prints #20\'s two attempts\' failures, each naming the step and its exit code', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  const held = ran.err.indexOf('rigger run: card #20 was held after 2 attempts');
  assert.ok(held >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(held).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

test('given that world, rigger run prints each claimed card\'s line, or its failures, once and only once', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  const lines = ran.err.split('\n');
  for (const number of [10, 30]) {
    assert.equal(lines.filter((held) => held.startsWith(`rigger run: claimed #${number} `)).length, 1, ran.said);
    assert.equal(lines.filter((held) => new RegExp(`#${number}\\b`).test(held) && !held.startsWith(`rigger run: card #${number}'s escalation `)).length, 1, ran.said);
    assert.equal(lines.filter((held) => held.startsWith(`rigger run: card #${number}'s escalation `)).length, 1, ran.said);
  }
  assert.equal(lines.filter((held) => held.startsWith('rigger run: card #20 was held')).length, 1, ran.said);
  assert.equal(lines.filter((held) => /#20\b/.test(held) && !held.startsWith('rigger run: admission is closed by hold: ')).length, 1, ran.said);
  assert.equal(lines.filter((held) => held.startsWith('rigger run: admission is closed by hold: card #20 ')).length, 1, ran.said);
  for (const attempt of [1, 2]) assert.equal(lines.filter((held) => held.startsWith(`attempt ${attempt}: `)).length, 1, ran.said);
});

test('given that world, where #20 failed while #10 and #30 reached their workspaces, rigger run exits non-zero', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  assert.notEqual(ran.code, 0, ran.said);
});

test('given that world, #10 and #30 are in the coding column after rigger run', async (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const columns = await columnsOf(here);
  assert.equal(columns[10], 'Coding', ran.said);
  assert.equal(columns[30], 'Coding', ran.said);
});

/** A scripted append boundary, using the actual native read and generated waiter, with retained originals. */
function nativeCloseWaiter(t, number, fault = 'partial') {
  const directory = scratch(t);
  const target = join(directory, 'target');
  const workspace = join(directory, 'widgets-worktrees', `rigger-${number}`);
  const evidence = join(process.env.RIGGER_1216_EVIDENCE_ROOT ?? join(dirname(process.env.TMPDIR ?? '/tmp'), 'rigger-1216-evidence'), 'controls', randomUUID());
  mkdirSync(join(target, '.rigger'), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const stream = join(target, '.rigger', 'events.jsonl');
  // These are independent fixture records, not production-derived expected values.
  const runId = '12345678-1234-4123-8123-123456789abc';
  const envelope = { ts: '2026-11-05T00:00:00.000Z', run: runId };
  const dispatch = 'd-12345678-1234-4123-8123-123456789abc';
  const before = JSON.stringify({ ...envelope, layer: 'L3', event: 'dispatch', card: number, dispatch, role: 'engineer', tier: 'standard' }) + '\n';
  const starting = JSON.stringify({ ...envelope, layer: 'L1', event: 'dispatch.start', card: number, dispatch, command: process.execPath, timeout: SETTLES_WITHIN, workspace }) + '\n';
  const partial = before + starting.slice(0, starting.indexOf('dispatch.start') + 'dispatch.st'.length);
  const complete = before + starting + JSON.stringify({ ...envelope, layer: 'L3', event: 'admission.close', kind: 'hold', id: '0123456789abcdef0123456789abcdef', name: 'hold-0123456789abcdef0123456789abcdef.json', reason: 'card #10 held after two controlled step failures' }) + '\n';
  assert.ok(complete.startsWith(partial), 'the controlled append must preserve every observed byte');
  const initial = fault === 'malformed' ? before + '{broken}\n' : partial;
  if (fault === 'read') mkdirSync(stream);
  else writeFileSync(stream, initial);
  writeFileSync(join(evidence, 'fixture.json'), JSON.stringify({ fault, stream, kind: fault === 'read' ? 'directory' : 'file' }));
  if (fault !== 'read') writeFileSync(join(evidence, 'before.jsonl'), initial);
  const maker = afterAdmissionClose(target, evidence);
  const [command, flag, body] = maker.act('*', 'engineer').exec;
  const boundary = fault === 'partial' ? [
    "const boundaryFs = require('node:fs');",
    'const actualRead = boundaryFs.readFileSync; let supplied = false;',
    `boundaryFs.readFileSync = function(path, ...args) {
      const bytes = actualRead.call(this, path, ...args);
      if (path === ${JSON.stringify(stream)} && !supplied) {
        supplied = true;
        boundaryFs.appendFileSync(path, ${JSON.stringify(complete.slice(partial.length))});
        process.stdout.write(JSON.stringify({ event: 'controlled.read-before-append-return', observed: Buffer.from(bytes).toString('base64'), committed: Buffer.from(actualRead(path)).toString('base64') }) + '\\n');
      }
      return bytes;
    };`,
  ].join('\n') : '';
  const ran = spawnSync(command, [flag, `${boundary}\n${body}`], { cwd: workspace, env: process.env, encoding: 'utf8', timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
  writeFileSync(join(evidence, 'worker.stdout'), ran.stdout ?? '');
  writeFileSync(join(evidence, 'worker.stderr'), ran.stderr ?? '');
  writeFileSync(join(evidence, 'worker.json'), JSON.stringify({ title: t.name, number, pid: ran.pid, status: ran.status, signal: ran.signal, error: ran.error?.stack }));
  if (fault !== 'read') writeFileSync(join(evidence, 'after.jsonl'), readFileSync(stream));
  const trace = readFileSync(join(evidence, 'trace.jsonl'), 'utf8').trimEnd().split('\n').map(JSON.parse);
  publishCloseEvidence(t, evidence);
  return { ran, evidence, trace, partial, complete, runId };
}

// Wiring counterpart: "unfinished records cannot fail or release either sibling before a complete close"
// in closed-before-refill.test.mjs proves the byte/barrier decision without a host.
// A real file read and actual worker exit distinguish an observation failure from a simulated exception.
test('native sibling waiters establish the close after a forced partial append observation', async (t) => {
  for (const order of [[20, 30], [30, 20]]) {
    for (const number of order) await t.test(`sibling ${number}, completion order ${order.join('/')}`, (cell) => {
      const { ran, trace, partial, complete, evidence, runId } = nativeCloseWaiter(cell, number);
      const observation = JSON.parse(ran.stdout);
      assert.equal(Buffer.from(observation.observed, 'base64').toString(), partial, 'the real read returned the controlled incomplete record');
      assert.equal(Buffer.from(observation.committed, 'base64').toString(), complete, 'the append completed before the waiter parsed its saved observation');
      assert.equal(ran.error, undefined, ran.error?.stack);
      assert.equal(ran.signal, null, 'the waiter reached an actual exit rather than its timeout');
      assert.equal(ran.status, 0, `wait-for-close premise failed; originals ${evidence}\n${ran.stderr}`);
      assert.equal(trace.filter(({ event, record }) => event === 'waiter.close' && record.run === runId).length, 1);
      assert.ok(trace.some(({ event, ordinal }) => event === 'waiter.close' && ordinal > 1), 'the incomplete first observation cannot establish the close');
      assert.ok(trace.some(({ event, code }) => event === 'worker.exit' && code === 0));
    });
  }
});

// Wiring counterparts in closed-before-refill.test.mjs: "a read failure preserves its original error
// and prior bytes without observing a close" and "a malformed complete record remains visible damage
// rather than a successful waiter". Real file errors and actual child exits are the native premises.
test('native sibling read and complete-record failures remain failed premises with their original diagnostics', async (t) => {
  for (const fault of ['read', 'malformed']) {
    for (const number of [20, 30]) await t.test(`sibling ${number}, ${fault}`, (cell) => {
      const { ran, trace, evidence } = nativeCloseWaiter(cell, number, fault);
      assert.equal(ran.error, undefined, ran.error?.stack);
      assert.equal(ran.signal, null);
      assert.equal(ran.status, 1, `a damaged waiter must remain an actual failed premise; ${evidence}`);
      assert.match(ran.stderr, fault === 'read' ? /EISDIR/ : /SyntaxError/);
      assert.ok(trace.some(({ event, error }) => event === 'worker.exception' && (fault === 'read' ? error.code === 'EISDIR' : error.name === 'SyntaxError')));
      assert.ok(trace.some(({ event, code }) => event === 'worker.exit' && code === 1));
      assert.equal(trace.some(({ event }) => event === 'waiter.close'), false);
    });
  }
});
