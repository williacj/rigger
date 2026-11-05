// ABOUTME: Exercises the standalone coordinator sweep's actual entry point with in-process process and filesystem answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = '/rigger-sweep-proof/root';
const ENTRY = `${ROOT}/codex-1`;
const CONFIG = '/rigger-sweep-proof/config.mjs';
let evaluation = 0;

/** Evaluate untransformed sweep bytes; every process and filesystem effect stays in this answer ledger. */
async function sweepAnswer(processAnswer, { remoteAnswer, judge = false, list = false } = {}) {
  const ENTRY = `${ROOT}/${judge ? 'judge-11-codex-r1' : 'codex-1'}`;
  const entry = new URL('../tools/coordinator/sweep.mjs', import.meta.url);
  entry.searchParams.set('decision-proof', String(++evaluation));
  const key = `riggerSweepAnswers${evaluation}`;
  const calls = [];
  const removals = [];
  const writes = [];
  const output = { stdout: '', stderr: '' };
  const completed = (stdout = '', status = 0, stderr = '') => ({ stdout, status, stderr, signal: null });
  const unexpected = (...args) => { throw new Error(`unexpected collaborator: ${JSON.stringify(args)}`); };
  const filesystem = {
    lstatSync(path) {
      assert.equal(path, ENTRY);
      return { isSymbolicLink: () => false, isDirectory: () => true };
    },
    readdirSync(path) {
      calls.push({ reader: 'directory', path });
      if (path === ROOT) return [ENTRY.slice(ROOT.length + 1)];
      if (path === ENTRY) return [];
      return unexpected('readdirSync', path);
    },
    realpathSync: { native(path) {
      assert.ok([ROOT, ENTRY].includes(path), `unexpected realpath ${path}`);
      return path;
    } },
    readFileSync: unexpected,
    rmSync: (path) => removals.push(path),
    writeFileSync: (...args) => writes.push(args),
  };
  const collaborators = {
    filesystem,
    unexpected,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      if (command === 'gh') return completed(judge ? 'MERGED\n' : '[{"number":11,"state":"MERGED"}]\n');
      if (command === 'lsof') return processAnswer;
      if (command === 'rm') { removals.push(args.at(-1)); return completed(); }
      if (command !== 'git') return unexpected(command, args);
      assert.deepEqual(args.slice(0, 2), ['-C', ENTRY]);
      switch (args[2]) {
        case 'status': return completed();
        case 'ls-files': return completed('H README\n');
        case 'stash': return completed();
        case 'worktree': return completed(`worktree ${ENTRY}\n`);
        // Git's failed local-remote read is status 128; the independently checked oracle below owns the reason.
        case 'ls-remote': return remoteAnswer ?? completed('', 128, 'fatal: fixture forge is unavailable\n');
        case 'cat-file': return completed(`${'a'.repeat(40)} commit\n`);
        case 'rev-parse': return completed(`${'a'.repeat(40)}\n`);
        case 'rev-list': return completed();
        default: return unexpected(command, args);
      }
    },
  };
  const modules = {
    'node:child_process': `export const spawnSync = globalThis[${JSON.stringify(key)}].spawnSync;`,
    'node:fs': `const fs = globalThis[${JSON.stringify(key)}].filesystem;
      export const { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = fs;
      export const mkdtempSync = globalThis[${JSON.stringify(key)}].unexpected;`,
    'node:os': "export const tmpdir = () => '/rigger-sweep-proof/tmp';",
    config: "export default { repo: 'fixture/rigger', worktrees: { topic: 'rigger-{number}' } };",
  };
  const urls = new Map(Object.keys(modules).map((name) => [name, `rigger-sweep-proof:${evaluation}/${name}`]));
  const saved = {
    argv: process.argv, exit: process.exit, exitCode: process.exitCode,
    stdout: process.stdout.write, stderr: process.stderr.write,
    global: Object.getOwnPropertyDescriptor(globalThis, key),
    environment: new Map(['RIGGER_WORKTREE_ROOT', 'RIGGER_CONFIG', 'SWEEP_READ_TIMEOUT'].map((name) =>
      [name, { present: Object.hasOwn(process.env, name), value: process.env[name] }])),
  };
  let hooks;
  try {
    globalThis[key] = collaborators;
    process.argv = [process.execPath, entry.pathname, ...(list ? ['--list'] : [])];
    process.env.RIGGER_WORKTREE_ROOT = ROOT;
    process.env.RIGGER_CONFIG = CONFIG;
    process.env.SWEEP_READ_TIMEOUT = '1';
    process.exit = (code) => { throw new Error(`sweep attempted process.exit(${code})`); };
    process.stdout.write = (text) => { output.stdout += text; return true; };
    process.stderr.write = (text) => { output.stderr += text; return true; };
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === entry.href) {
          const name = specifier === `file://${CONFIG}` ? 'config' : specifier;
          if (urls.has(name)) return { url: urls.get(name), shortCircuit: true };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        for (const [name, value] of urls) {
          if (url === value) return { format: 'module', source: modules[name], shortCircuit: true };
        }
        const loaded = next(url, context);
        if (url === entry.href) assert.deepEqual(Buffer.from(loaded.source), readFileSync(entry), 'sweep source bytes changed while loading');
        return loaded;
      },
    });
    await import(entry.href);
    return { ...output, status: process.exitCode, calls, removals, writes };
  } finally {
    hooks?.deregister();
    process.argv = saved.argv;
    process.exit = saved.exit;
    process.exitCode = saved.exitCode;
    process.stdout.write = saved.stdout;
    process.stderr.write = saved.stderr;
    for (const [name, cell] of saved.environment) {
      if (cell.present) process.env[name] = cell.value;
      else delete process.env[name];
    }
    if (saved.global) Object.defineProperty(globalThis, key, saved.global);
    else delete globalThis[key];
  }
}

// Harness diagnostic admitted by #1187 T: standalone cleanup, not engine-worktree cleanup requirements.
test('quiet process answers reach the initial unreadable forge refs reason', async () => {
  for (const status of [0, 1]) {
    const answer = await sweepAnswer({ status, signal: null, stdout: '', stderr: '' });
    assert.equal(answer.status, 1);
    assert.equal(answer.stdout, '');
    assert.equal(answer.stderr, `sweep: kept ${ENTRY}: cannot read the forge's refs: fatal: fixture forge is unavailable\n`);
    assert.deepEqual(answer.removals, []);
    assert.deepEqual(answer.writes, []);
    assert.ok(answer.calls.some((call) => call.command === 'git' && call.args[2] === 'ls-remote'));
  }
});

test('uncertain process answers keep the entry without consulting later readers', async () => {
  // #1187's finite map supplies the expected reasons; Error codes use spawnSync's documented error contract.
  const cases = [
    ['missing command', { error: Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' }) }, 'lsof not found on PATH'],
    ['spawn error', { error: Object.assign(new Error('spawn lsof EACCES'), { code: 'EACCES' }) }, 'spawn lsof EACCES'],
    ['unanswered spawn', { error: Object.assign(new Error('spawn lsof ETIMEDOUT'), { code: 'ETIMEDOUT' }) }, 'lsof did not answer'],
    ['stderr without PID', { status: 1, stderr: 'lsof: WARNING: cannot stat fixture\n' }, 'lsof wrote lsof: WARNING: cannot stat fixture'],
    ['signal without PID', { status: null, signal: 'SIGTERM' }, 'lsof exited null'],
    ['null status without PID', { status: null }, 'lsof exited null'],
    ['unexpected status without PID', { status: 2 }, 'lsof exited 2'],
  ];
  for (const [cell, raw, reason] of cases) {
    const answer = await sweepAnswer({ stdout: '', stderr: '', signal: null, ...raw });
    assert.equal(answer.status, 1, cell);
    assert.equal(answer.stdout, '', cell);
    assert.equal(answer.stderr, `sweep: kept ${ENTRY}: cannot check for processes: ${reason}\n`, cell);
    assert.deepEqual(answer.calls.filter((call) => call.command === 'git' || call.path === ENTRY), [], `${cell}: later readers ran`);
    assert.deepEqual(answer.removals, [], cell);
    assert.deepEqual(answer.writes, [], cell);
  }
});

test('completed holder answers win over status and stderr before later readers', async () => {
  for (const [status, stderr] of [[0, ''], [1, ''], [1, 'lsof: warning\n'], [2, 'lsof: warning\n']]) {
    for (const [stdout, pids] of [['p514\np514\np909\n', '514, pid 909'], ['p909\np514\np909\n', '909, pid 514']]) {
      const answer = await sweepAnswer({ status, signal: null, stdout, stderr });
      assert.equal(answer.status, 1);
      assert.equal(answer.stdout, '');
      assert.equal(answer.stderr, `sweep: kept ${ENTRY}: in use by pid ${pids}\n`, `completed PID precedence at status ${status}`);
      assert.deepEqual(answer.calls.filter((call) => call.command === 'git' || call.path === ENTRY), [], 'a holder consulted foreign-worktree or local-work/refs readers');
      assert.deepEqual(answer.removals, []);
      assert.deepEqual(answer.writes, []);
    }
  }
});

test('initial forge refs answers preserve the timeout reason and normal removal eligibility', async () => {
  const timeout = await sweepAnswer({ status: 1, signal: null, stdout: '', stderr: '' }, {
    remoteAnswer: { error: Object.assign(new Error('spawn git ETIMEDOUT'), { code: 'ETIMEDOUT' }) },
  });
  assert.equal(timeout.status, 1);
  assert.equal(timeout.stdout, '');
  assert.equal(timeout.stderr, `sweep: kept ${ENTRY}: the read of the forge's refs did not answer within 1 s\n`);
  assert.deepEqual(timeout.removals, []);
  assert.deepEqual(timeout.writes, []);

  // Literal ls-remote and cat-file shapes describe one advertised commit already held locally, with no unheld commit.
  const eligible = await sweepAnswer({ status: 0, signal: null, stdout: '', stderr: '' }, {
    remoteAnswer: { status: 0, signal: null, stdout: `${'a'.repeat(40)}\trefs/heads/main\n`, stderr: '' },
  });
  assert.equal(eligible.status, 0);
  assert.equal(eligible.stdout, `${ENTRY}\n`);
  assert.equal(eligible.stderr, '');
  assert.deepEqual(eligible.removals, [ENTRY]);
  assert.deepEqual(eligible.writes, []);
});

test('entry evaluations restore process state after assertion and import rejection', async () => {
  const environment = () => Object.fromEntries(['RIGGER_WORKTREE_ROOT', 'RIGGER_CONFIG', 'SWEEP_READ_TIMEOUT']
    .map((name) => [name, { present: Object.hasOwn(process.env, name), value: process.env[name] }]));
  const globals = () => Object.keys(globalThis).filter((name) => name.startsWith('riggerSweepAnswers')).sort();
  const before = { argv: process.argv, exit: process.exit, exitCode: process.exitCode,
    stdout: process.stdout.write, stderr: process.stderr.write, environment: environment(), globals: globals() };
  const restored = () => {
    assert.equal(process.argv, before.argv);
    assert.equal(process.exit, before.exit);
    assert.equal(process.exitCode, before.exitCode);
    assert.equal(process.stdout.write, before.stdout);
    assert.equal(process.stderr.write, before.stderr);
    assert.deepEqual(environment(), before.environment);
    assert.deepEqual(globals(), before.globals);
  };
  // Deliberately broken collaborators test the evaluation harness's cleanup, not a native spawn-result contract.
  for (const fail of [() => assert.fail('controlled collaborator assertion'), () => { throw new Error('controlled import rejection'); }]) {
    await assert.rejects(sweepAnswer({ get error() { fail(); } }), /controlled/);
    restored();
  }
  const next = await sweepAnswer({ status: 1, signal: null, stdout: '', stderr: '' });
  assert.equal(next.status, 1);
  assert.equal(next.stderr, `sweep: kept ${ENTRY}: cannot read the forge's refs: fatal: fixture forge is unavailable\n`);
  restored();
});


test('quiet process answers leave a merged judge eligible for listing', async () => {
  for (const status of [0, 1]) {
    const answer = await sweepAnswer({ status, signal: null, stdout: '', stderr: '' }, { judge: true, list: true });
    assert.equal(answer.status, 0);
    assert.equal(answer.stdout, `${ROOT}/judge-11-codex-r1\n`);
    assert.equal(answer.stderr, '');
    assert.deepEqual(answer.removals, []);
    assert.deepEqual(answer.writes, []);
    assert.deepEqual(answer.calls.filter((call) => call.command === 'git'), []);
  }
});

/** Observe the actual setup once per registration, stopping before forge/entry/clone side effects. */
async function actualSetupTrace() {
  const entry = new URL('./coordinator-sweep.test.mjs', import.meta.url);
  entry.searchParams.set('setup-proof', String(++evaluation));
  const key = `riggerSetupAnswers${evaluation}`;
  const registrations = [];
  const observations = [];
  const output = { stdout: '', stderr: '' };
  const stop = Object.freeze({ boundary: 'existing forge(w)' });
  let current;
  const unexpected = (...args) => { throw new Error(`unexpected setup collaborator: ${JSON.stringify(args)}`); };
  const directories = new Set();
  const filesystem = Object.fromEntries(['chmodSync', 'closeSync', 'existsSync', 'lstatSync', 'openSync',
    'readdirSync', 'readFileSync', 'realpathSync', 'symlinkSync'].map((name) => [name, (...args) => unexpected(name, ...args)]));
  filesystem.mkdirSync = (path) => {
    assert.ok(directories.has(dirname(path)), 'actual setup must create the parent before its child');
    assert.ok(!directories.has(path), 'actual setup must create a fresh directory');
    directories.add(path);
    current.events.push({ kind: 'mkdir', path });
  };
  filesystem.writeFileSync = (path, text) => {
    assert.ok(directories.has(dirname(path)));
    current.events.push({ kind: 'write', path, text });
  };
  const fixtures = {
    TOOLS: '/rigger-setup-proof/tools',
    answer: unexpected, assertToolingClean: unexpected, ghCalls: unexpected, run: unexpected, tree: unexpected,
    world(prefix) {
      assert.equal(current.world, undefined, 'each callback stops at its first setup boundary');
      const base = `/rigger-setup-proof/world-${observations.length}`;
      directories.add(base);
      current.world = base;
      current.events.push({ kind: 'world', prefix, path: base });
      return { base, env: {} };
    },
    forge(w) {
      assert.equal(w.base, current.world);
      current.events.push({ kind: 'forge', path: w.base });
      current.stoppedAtForge = true;
      throw stop;
    },
  };
  const collaborators = { filesystem, fixtures, unexpected,
    register(title, ...args) { registrations.push({ title, callback: args.at(-1) }); } };
  const modules = {
    'node:test': `export const test = globalThis[${JSON.stringify(key)}].register;`,
    'node:child_process': `export const spawnSync = globalThis[${JSON.stringify(key)}].unexpected;`,
    'node:fs': `export const { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync,
      readFileSync, realpathSync, symlinkSync, writeFileSync } = globalThis[${JSON.stringify(key)}].filesystem;`,
    './coordinator-fixtures.mjs': `export const { TOOLS, answer, assertToolingClean, forge, ghCalls, run, tree, world } = globalThis[${JSON.stringify(key)}].fixtures;`,
    './git-repository.mjs': `const unexpected = globalThis[${JSON.stringify(key)}].unexpected;
      export const cloneInto = unexpected, detachedWorktreeAt = unexpected, gitIn = unexpected, worktreeAt = unexpected;`,
  };
  const urls = new Map(Object.keys(modules).map((name) => [name, `rigger-setup-proof:${evaluation}/${name}`]));
  const saved = { argv: process.argv, exit: process.exit, exitCode: process.exitCode, kill: process.kill,
    stdout: process.stdout.write, stderr: process.stderr.write, environment: { ...process.env },
    global: Object.getOwnPropertyDescriptor(globalThis, key) };
  let hooks;
  try {
    globalThis[key] = collaborators;
    process.argv = [process.execPath, entry.pathname];
    process.exit = (...args) => unexpected('process.exit', ...args);
    process.kill = (...args) => unexpected('process.kill', ...args);
    process.stdout.write = (text) => { output.stdout += text; return true; };
    process.stderr.write = (text) => { output.stderr += text; return true; };
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === entry.href && urls.has(specifier)) return { url: urls.get(specifier), shortCircuit: true };
        return next(specifier, context);
      },
      load(url, context, next) {
        for (const [name, value] of urls) {
          if (url === value) return { format: 'module', source: modules[name], shortCircuit: true };
        }
        const loaded = next(url, context);
        if (url === entry.href) assert.deepEqual(Buffer.from(loaded.source), readFileSync(entry), 'host source must load byte-exact without transformation');
        return loaded;
      },
    });
    await import(entry.href);
    for (const { title, callback } of registrations) {
      assert.equal(typeof callback, 'function');
      current = { title, events: [] };
      observations.push(current);
      try {
        await callback({ after: unexpected });
        assert.fail('host callback completed without the identified forge boundary');
      } catch (error) {
        if (error !== stop) throw error;
      }
    }
    return { source: entry.href, registrations: registrations.map(({ title }) => title), observations, output,
      scope: 'one first-forge setup trace per registration; invocation multiplicity and root-derived entries require source mapping' };
  } finally {
    hooks?.deregister();
    process.argv = saved.argv;
    process.exit = saved.exit;
    process.exitCode = saved.exitCode;
    process.kill = saved.kill;
    process.stdout.write = saved.stdout;
    process.stderr.write = saved.stderr;
    for (const name of Object.keys(process.env)) if (!Object.hasOwn(saved.environment, name)) delete process.env[name];
    for (const [name, value] of Object.entries(saved.environment)) process.env[name] = value;
    if (saved.global) Object.defineProperty(globalThis, key, saved.global);
    else delete globalThis[key];
  }
}

test('actual setup places every fixture root under the U145 ancestor', async () => {
  const trace = await actualSetupTrace();
  process.stdout.write('SWEEP_SETUP_TRACE ' + JSON.stringify(trace) + '\n');
  assert.ok(trace.registrations.length >= 30, 'all original registrations are captured');
  assert.equal(trace.observations.length, trace.registrations.length);
  for (const observed of trace.observations) {
    assert.equal(observed.stoppedAtForge, true, 'the identified sentinel is handled before checking placement');
    // U145 independently specifies the one ancestor and its root child, before forge/clone creation.
    const directories = observed.events.filter(({ kind }) => kind === 'mkdir').map(({ path }) => path);
    assert.deepEqual(directories, [join(observed.world, 'fixtures.noindex'), join(observed.world, 'fixtures.noindex', 'root')],
      'actual setup places every fixture root under the U145 ancestor');
    assert.equal(observed.events.at(-1).kind, 'forge', 'creation precedes the existing forge boundary');
  }
});
