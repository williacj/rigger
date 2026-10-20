// ABOUTME: Tests that L0 contains a group without ever stopping it, on the call's containment, a
// start's kill of a recorded group and the exit cleanup: what it records by name and as the group's
// kill, how it settles where it cannot read the table, may not signal a process, or cannot end
// one, in a group and in a dispatch's directory alike, and what the exit cleanup hands the caller's
// step where it cannot end the command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { KILL_BOUND, LSOF, PS, UNREAPED_BOUND, identityOf, killRecordedGroup, runCommand } from '../src/substrate/process.mjs';
import { TAIL, alive, fixture, holding, leave, processState, read, shellQuote, startGroup, tailIn, until } from './process-fixtures.mjs';
import { heldOutput } from './process-fixtures.mjs';
import { ended } from './process-fixtures.mjs';
import { gone } from './process-fixtures.mjs';
import { warmed } from './process-fixtures.mjs';
import { signalStandIn } from './signal-stand-in.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { listingFields, listingOf } from './listing-stand-in.mjs';
import { sightingPs } from './census-sightings.mjs';
import { prepareSighting } from './census-sightings.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { startOf } from './process-fixtures.mjs';
import { chmodSync, closeSync, cpSync, lstatSync, openSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { running } from './process-fixtures.mjs';

// Bounds on the tests alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on them when the call settles. The longer is for a call that waits out
// `KILL_BOUND`.
const { 20_000: SETTLES_WITHIN, 60_000: OUTLASTS_KILL_BOUND } = BOUNDS;

/** A timeout no command here reaches. */
const UNREACHED = 15_000;

/** The exit cleanup's own bound in these tests: the read timeout its caller gives the call. */
const CLEANUP_BOUND = 1_000;

/**
 * The exit cells whose ordinary test may take a traced real-deadline cutoff in place of its
 * answered scenario, as owner ruling O268 allows, and the state that carries that branch: forcing
 * for a controlled cell, the controlled tests that require an answered confirmation, each exit's
 * classification, and the result of each exit that took the cutoff.
 */
const CUTOFF_CELLS = ['U1', 'U2', 'C1', 'C2', 'B', 'A', 'X'];
const exitForcings = new WeakMap();
const exitAnswerRequired = new WeakSet();
const exitResults = new WeakMap();
const exitCutoffs = new Set();

/**
 * The read timeout the C615 Mac directory control's caller alone gives its call, in place of
 * `CLEANUP_BOUND`: a whole-user `lsof` listing can outlast 1,000 ms on a loaded host, which leaves
 * that control no answer to read (#757). A judgment, not a measured threshold: it is L0's own
 * `READ_TIMEOUT`, which the owner approved for this caller alone (O274 on #739).
 */
const DIRECTORY_CALLER_BOUND = 5_000;

/** The pid a fixture in `directory` wrote to `<name>.pid`, or nothing before it has. */
const pidIn = (directory, name) => (existsSync(join(directory, `${name}.pid`)) ? Number(read(directory, `${name}.pid`)) : undefined);

/** A command that leaves two `tail`s in its group, `one` and `two`, and exits 0. */
const leavingTwo = (directory) => fixture(directory, 'command', [leave(TAIL, 'one'), leave(TAIL, 'two')].join('\n'));

/**
 * A command that writes its pid, its group's id, to `$here/group.pid`, leaves two `tail`s in its
 * group, `one` and `two`, marks `$here/up`, and runs until the test writes `release`, or until killed.
 */
const holdingTwo = (directory) => fixture(directory, 'command', [
  'echo $$ > "$here/group.pid"',
  leave(TAIL, 'one'),
  leave(TAIL, 'two'),
  ': > "$here/up"',
  'while [ ! -f "$here/release" ]; do :; done',
].join('\n'));

/** A command that marks `$here/up` and runs until the test writes `release`, or until killed. */
const holdingNone = (directory) => fixture(directory, 'command', ': > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');

/** The line of a `ps` stand-in that answers a read as `ps` does, with the process `$here/two.pid` names cut out. */
const CUT_TWO = ("" + shellQuote(PS) + " \"$@\" | /usr/bin/grep -v \"^ *$(/bin/cat \"$here/two.pid\") \"");

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read of the census,
 * which begin `-ww -g`, and answers every other read as `ps` does.
 */
const cuttingTwo = (directory) => fixture(directory, 'ps', [
  'case "$*" in "-ww -g "*)',
  `  ${CUT_TWO}`,
  '  exit 0 ;;',
  'esac',
  ("exec " + shellQuote(PS) + " \"$@\""),
].join('\n'));

/** A `ps` stand-in that fails every read as `ps` fails given what it cannot read, but a read of a start time. */
const failing = (directory) => fixture(directory, 'ps', ("case \"$*\" in *lstart=*) exec " + shellQuote(PS) + " \"$@\" ;; esac\necho \"ps: failing on purpose\" >&2\nexit 2"));

/**
 * A signal call for a test in `directory`: `signalStandIn`'s, with the pid `$here/<refused>.pid`
 * names refused, the one `$here/<unkept>.pid` names unkept, and the one `$here/<flickers>.pid` names
 * flickering, each once it is there, the time of
 * its first kill of a group in `first.at`, and `killedAt(target)`, when it first sent `target` the
 * kill, or nothing where it never did.
 */
function standIn(directory, { refused, unkept, flickers, outlasts, pairs = [] } = {}) {
  const first = {};
  const kills = new Map();
  const kill = signalStandIn({ pairs, refused: () => refused && pidIn(directory, refused), unkept: () => unkept && pidIn(directory, unkept), flickers: () => flickers && pidIn(directory, flickers), outlasts: () => outlasts && pidIn(directory, outlasts) });
  return {
    pairs,
    first,
    killedAt: (target) => kills.get(target),
    kill: (target, name) => {
      if (name === 'SIGKILL' && !kills.has(target)) kills.set(target, Date.now());
      if (target < 0 && name === 'SIGKILL') first.at ??= Date.now();
      return kill(target, name);
    },
  };
}

/** When `pairs`, the signals a caller sent, as `[target, signal, time]`, first sent the kill to `target`. */
const killedIn = (pairs, target) => pairs.find(([to, name]) => to === target && name === 'SIGKILL')?.[2];

/** Runs `command` through L0's adapter in `directory`, and hands back its events and when it settled. */
async function called(directory, { command, ...options }) {
  const events = [];
  await runCommand({ command, args: [], cwd: directory, env: {}, timeout: UNREACHED, emitter: { emit: (event, fields) => events.push({ event, ...fields }) }, ...options });
  return { events, settled: Date.now() };
}

/**
 * Has L0 kill `started`, a group as a dead engine leaves it, through a start's kill of a recorded
 * group, and hands back its events and when it settled.
 */
async function startKilled(started, options) {
  const events = [];
  await killRecordedGroup({ group: started.group, started: started.started, emitter: { emit: (event, fields) => events.push({ event, ...fields }) }, ...options });
  return { events, settled: Date.now() };
}

/**
 * A Node process of its own, whose arguments are a scratch directory and a JSON object of options:
 * it starts `$here/command` through L0's adapter with the `ps` stand-in `ps` names where it names
 * one, the `lsof` stand-in `lsof` names where it names one, read timeout `readTimeout`, dispatch
 * directory `directory` where given, and `signalStandIn`'s
 * signal call refusing `refused` and leaving `unkept`, as `standIn` does. It appends each `L0`
 * event, and each signal sent, to `events` and `pairs` as lines of JSON. Where `hangAfter` names a
 * pid file, or `group` for `group.pid`'s group, it marks `hang` as it first sends that target the
 * kill, so that `hanging`'s reads hang from then on. `flickers` names a pid file whose pid
 * flickers, as `signalStandIn` has it. The step it hands the adapter for the exit writes how the
 * command ended to `ending` as JSON. It waits until the command
 * marks `up`, then exits 0 while the call is still running, so its exit cleanup ends the group.
 */
const CALLER = [
  `import { runCommand } from ${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)};`,
  `import { signalStandIn } from ${JSON.stringify(new URL('./signal-stand-in.mjs', import.meta.url).href)};`,
  `import { prepareSighting } from ${JSON.stringify(new URL('./census-sightings.mjs', import.meta.url).href)};`,
  "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
  "import { mkdirSync as sightingMkdir, writeFileSync as sightingWrite } from 'node:fs';",
  "import { createHash as sightingHash } from 'node:crypto';",
  "import child from 'node:child_process';",
  "import { syncBuiltinESMExports as syncPostKillBuiltinESMExports } from 'node:module';",
  "import { join } from 'node:path';",
  'const here = process.argv[2];',
  'const options = JSON.parse(process.argv[3]);',
  "if (process.env.C615_SIGHTING_EVIDENCE_ROOT && options.ps === 'ps-sighted') {",
  "  const reads = join(here, 'sighting-reads'); sightingMkdir(reads, { mode: 0o700 });",
  "  const attempt = readFileSync(join(here, 'sighting-attempt'), 'utf8');",
  "  const originalRead = child.spawnSync; let serial = 0;",
  "  const note = (row) => { try { appendFileSync(join(reads, 'trace.jsonl'), JSON.stringify({ attempt, ...row }) + '\\n'); } catch {} };",
  "  const encode = (value) => typeof value === 'number' && !Number.isFinite(value) ? { type: 'number', value: String(value) } : value === undefined ? { type: 'undefined' } : value;",
  "  const stream = (result, name, id) => { const present = Object.hasOwn(result, name); const value = result[name]; const type = !present ? 'absent' : value === null ? 'null' : typeof value; if (type !== 'string') return { present, type, file: null }; const file = `${id}.${name}.utf8`; const bytes = Buffer.from(value, 'utf8'); sightingWrite(join(reads, file), bytes, { flag: 'wx', mode: 0o600 }); return { present, type, file, bytes: bytes.length, sha256: sightingHash('sha256').update(bytes).digest('hex') }; };",
  "  child.spawnSync = function observedSighting(tool, argv, settings) {",
  "    if (tool !== join(here, 'ps-sighted')) return originalRead.apply(this, arguments);",
  "    const id = `r${String(++serial).padStart(6, '0')}`; const startedNs = process.hrtime.bigint().toString();",
  "    try { note({ kind: 'start', id, startedNs, tool, argv, options: Object.fromEntries(Object.entries(settings ?? {}).map(([key, value]) => [key, encode(value)])), remainingMs: settings?.timeout, callerExitMarked: existsSync(join(here, 'exiting')) }); } catch { note({ kind: 'observer-error', id, stage: 'start' }); }",
  "    let result; try { result = originalRead.apply(this, arguments); } catch (error) { note({ kind: 'threw', id, endedNs: process.hrtime.bigint().toString(), error: { name: error.name, message: error.message, code: error.code ?? null } }); throw error; }",
  "    try { note({ kind: 'end', id, endedNs: process.hrtime.bigint().toString(), status: encode(result.status), signal: encode(result.signal), error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code ?? null, errno: result.error.errno ?? null, syscall: result.error.syscall ?? null, path: result.error.path ?? null, spawnargs: result.error.spawnargs ?? null } : null, returnedStreams: result.error || result.signal ? 'partial-possible' : 'settled-return', stdout: stream(result, 'stdout', id), stderr: stream(result, 'stderr', id) }); } catch (error) { note({ kind: 'observer-error', id, stage: 'return', code: error.code ?? error.name }); }",
  "    return result;",
  "  };",
  "  syncPostKillBuiltinESMExports();",
  "}",
  "globalThis.trace = (operation, fields = {}) => { if (options.postKillTrace) appendFileSync(join(here, 'post-kill-trace'), `${JSON.stringify({ at: new Date().getTime(), operation, ...fields })}\\n`); };",
  "if (options.postKillTrace) {",
  "  const originalRead = child.spawnSync;",
  "  child.spawnSync = function observedRead(tool, argv, settings) {",
  "    const named = existsSync(join(here, 'hang')) && (tool === join(here, options.ps) || tool === join(here, options.lsof));",
  "    const which = tool === join(here, options.ps) ? 'ps' : 'lsof';",
  "    if (named) trace('read-start', { tool: which, argv, timeout: settings?.timeout });",
  "    try {",
  "      const result = originalRead.apply(this, arguments);",
  "      if (named) trace('read-end', { tool: which, argv, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.code ?? null });",
  "      return result;",
  "    } catch (error) {",
  "      if (named) trace('read-threw', { tool: which, argv, code: error.code ?? null });",
  "      throw error;",
  "    }",
  "  };",
  "  syncPostKillBuiltinESMExports();",
  "}",
  "if (options.postKillCut) { const realNow = Date.now; let held; Date.now = () => { if (!existsSync(join(here, 'hang'))) return realNow(); held ??= realNow(); const caller = new Error().stack?.split('\\n').find((line) => line.includes('at readingNow (') || line.includes('at reaped (')) ?? ''; if (caller.includes('at readingNow (') && existsSync(join(here, 'clock-cut'))) { appendFileSync(join(here, 'clock-jumps'), 'J'); return held + 20_000; } return held; }; }",
  "if (options.postKillTerminal) { const realNow = Date.now; let held; Date.now = () => { if (!existsSync(join(here, 'hang'))) return realNow(); held ??= realNow(); const caller = new Error().stack?.split('\\n').find((line) => line.includes('at readingNow (') || line.includes('at reaped (')) ?? ''; if (caller.includes('at reaped (') && existsSync(join(here, 'clock-cut'))) { appendFileSync(join(here, 'clock-terminal'), 'T'); trace('terminal-live', { logical: held + options.readTimeout }); return held + options.readTimeout; } return held; }; }",
  "if (options.postKillTrace) {",
  "  const underlyingNow = Date.now; let began; let killedAt; let held;",
  "  Date.now = () => {",
  "    const stack = new Error().stack?.split('\\n') ?? [];",
  "    const plainFailures = !options.postKillCut && !options.postKillTerminal;",
  "    if (plainFailures && existsSync(join(here, 'hang'))) held ??= underlyingNow();",
  "    const afterLaterFailure = plainFailures && held !== undefined && existsSync(join(here, 'state-count')) && Number(readFileSync(join(here, 'state-count'), 'utf8')) >= 2 && stack[2]?.includes('at readingNow (');",
  "    const now = afterLaterFailure ? held + 20_000 : held ?? underlyingNow();",
  "    if (afterLaterFailure) appendFileSync(join(here, 'clock-jumps'), 'J');",
  "    if (stack[2]?.includes('at sweptNow (') && began === undefined) { began = now; trace('census-bound', { logical: now, remaining: options.readTimeout }); }",
  "    if (stack[2]?.includes('at sweeping (') && existsSync(join(here, 'hang')) && killedAt === undefined) { killedAt = now; trace('kill-clock', { logical: now }); }",
  "    if (stack[2]?.includes('at readingNow (') && existsSync(join(here, 'hang'))) { const wait = existsSync(join(here, 'post-kill-listing')); trace('read-boundary', { logical: now, phase: wait ? 'wait' : 'census', remaining: (wait ? killedAt : began) + options.readTimeout - now }); }",
  "    return now;",
  "  };",
  "}",
  "if (options.censusElapsed) { const realNow = Date.now; Date.now = () => { const caller = new Error().stack?.split('\\n')[2] ?? ''; if (!globalThis.censusCut && caller.includes('at sweptNow (')) { globalThis.censusCut = true; appendFileSync(join(here, 'census-clock-cut'), 'C'); return realNow() - options.censusElapsed; } return realNow(); }; }",
  "const pidIn = (name) => (name && existsSync(join(here, `${name}.pid`)) ? Number(readFileSync(join(here, `${name}.pid`), 'utf8')) : undefined);",
  'const signalled = signalStandIn({ refused: () => pidIn(options.refused), unkept: () => pidIn(options.unkept), flickers: () => pidIn(options.flickers), outlasts: () => pidIn(options.outlasts) });',
  "const hangs = () => (options.hangAfter === 'group' ? -pidIn('group') : pidIn(options.hangAfter));",
  "const kill = (target, name) => { appendFileSync(join(here, 'pairs'), `${JSON.stringify([target, name, Date.now()])}\\n`); if (name === 'SIGKILL' && options.hangAfter && target === hangs()) { appendFileSync(join(here, 'hang'), ''); trace('named-kill', { target }); } if (options.postKillTrace) { try { const answer = signalled(target, name); if (name === 0) trace('signal-0', { target, answer: 'yes' }); return answer; } catch (error) { if (name === 0) trace('signal-0', { target, answer: error.code ?? error.message }); throw error; } } return signalled(target, name); };",
  "const emitter = { emit: (event, fields) => { appendFileSync(join(here, 'events'), `${JSON.stringify({ event, ...fields })}\\n`); trace('event', { event, ...fields }); } };",
  "const onExit = (group, ending) => appendFileSync(join(here, 'ending'), JSON.stringify(ending));",
  "if (options.ps === 'ps-sighted') {",
  "  const exitTrace = join(here, 'exit-trace.jsonl');",
  "  const exitPlan = existsSync(join(here, 'exit-forcing.json')) ? JSON.parse(readFileSync(join(here, 'exit-forcing.json'), 'utf8')) : { signals: [] };",
  "  let exitSeq = 0;",
  "  const exitNote = (row) => appendFileSync(exitTrace, JSON.stringify({ seq: ++exitSeq, ns: process.hrtime.bigint().toString(), ...row }) + '\\n');",
  "  const exitFrames = ['within', 'readingNow', 'runNow', 'census', 'beforeKill', 'emptied'];",
  "  const exitCounts = new Map(); let exitStep = 0; const exitClock = Date.now;",
  "  Date.now = () => {",
  "    const caller = new Error().stack?.split('\\n')[2] ?? '';",
  "    const frame = exitFrames.find((name) => caller.includes(`at ${name} (`));",
  "    if (frame === undefined) return exitClock();",
  "    if (frame === 'within') exitStep += 1;",
  "    const key = `${exitStep}:${frame}`; const nth = (exitCounts.get(key) ?? 0) + 1; exitCounts.set(key, nth);",
  "    const at = exitClock();",
  "    exitNote({ kind: 'clock', step: exitStep, frame, nth, at });",
  "    return at;",
  "  };",
  "  const exitSpawn = child.spawnSync;",
  "  child.spawnSync = function exitObservedRead(tool, argv, settings) {",
  "    if (tool !== join(here, 'ps-sighted')) return exitSpawn.apply(this, arguments);",
  "    exitNote({ kind: 'spawn', argv, timeout: settings?.timeout ?? null });",
  "    let result;",
  "    try { result = exitSpawn.apply(this, arguments); } catch (error) { exitNote({ kind: 'threw', code: error.code ?? null, message: error.message }); throw error; }",
  "    exitNote({ kind: 'returned', status: result.status, signal: result.signal, error: result.error?.code ?? null, stdout: typeof result.stdout === 'string' ? result.stdout : null, stderr: typeof result.stderr === 'string' ? result.stderr : null });",
  "    return result;",
  "  };",
  "  syncPostKillBuiltinESMExports();",
  "  const exitSignal = process.kill; const exitSignals = new Map();",
  "  process.kill = function exitObservedSignal(target, name) {",
  "    const key = `${exitStep}:${target}:${name}`; const nth = (exitSignals.get(key) ?? 0) + 1; exitSignals.set(key, nth);",
  "    const fault = exitPlan.signals.find((rule) => rule.step === exitStep && rule.name === name && rule.nth === nth && target === -Number(readFileSync(join(here, 'group.pid'), 'utf8')));",
  "    try {",
  "      if (fault) throw Object.assign(new Error(`kill ${fault.code}`), { code: fault.code, syscall: 'kill' });",
  "      const answer = exitSignal.apply(process, arguments);",
  "      exitNote({ kind: 'signal', target, name, ok: true });",
  "      return answer;",
  "    } catch (error) { exitNote({ kind: 'signal', target, name, ok: false, code: error.code ?? null, message: error.message, forced: Boolean(fault) }); throw error; }",
  "  };",
  "}",
  "runCommand({ command: join(here, 'command'), args: [], cwd: here, env: {}, timeout: 600_000, emitter, kill, onExit, readTimeout: options.readTimeout, directory: options.directory, ps: options.ps && join(here, options.ps), lsof: options.lsof && join(here, options.lsof) });",
  "while (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));",
  "prepareSighting(here);",
  "appendFileSync(join(here, 'exiting'), String(Date.now()));",
  'process.exit(0);',
].join('\n');

const sightingEvidenceRoot = () => process.env.C615_SIGHTING_EVIDENCE_ROOT ?? process.env.C615_EVIDENCE_ROOT;

const sightingAttempts = new Map();
const sightingRootFaults = new Map();

/** Forces a named validator read to fail only for one test-selected root. */
function selectedRootRead(requested, stage, read) {
  if (sightingRootFaults.get(requested) === `${stage}-error`) throw new Error(`forced ${stage} failure`);
  return read();
}

/** Retains one conditional exit-sighting attempt outside the suite scratch. */
function sightingObservation(directory, options, requested = sightingEvidenceRoot()) {
  if (!requested || options.ps !== 'ps-sighted') return null;
  const entry = selectedRootRead(requested, 'lstat', () => lstatSync(requested));
  assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), 'the sighting evidence root is unsafe');
  const root = selectedRootRead(requested, 'realpath', () => realpathSync.native(requested));
  const checkout = selectedRootRead(requested, 'checkout', () => realpathSync.native(process.cwd()));
  const scratch = selectedRootRead(requested, 'scratch', () => realpathSync.native(process.env.TMPDIR));
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && root !== scratch && !root.startsWith(`${scratch}/`) && (lstatSync(root).mode & 0o077) === 0, 'the sighting evidence root must be private and outside checkout and suite scratch');
  const id = randomUUID();
  const target = join(root, `attempt-${id}`);
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(directory, 'sighting-attempt'), id, { flag: 'wx', mode: 0o600 });
  const observation = { id, root, target, stderr: [], exit: { state: 'not-observed' }, close: { state: 'not-observed' }, finalSnapshot: false };
  sightingAttempts.set(directory, observation);
  return observation;
}

/** Inventories every regular original without following a link. */
function sightingFiles(directory) {
  const files = [];
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      const file = join(path, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'the sighting snapshot contains a link');
      if (entry.isDirectory()) visit(file, `${name}/`);
      else {
        assert.ok(entry.isFile(), 'the sighting snapshot contains a special file');
        const bytes = readFileSync(file);
        files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  };
  visit(directory);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Copies produced bytes even when the caller or an outer read is unresolved. */
function retainSighting(observation, directory, phase) {
  const output = join(observation.target, phase);
  mkdirSync(output, { mode: 0o700 });
  const report = { attempt: observation.id, phase, callerPid: observation.callerPid ?? null, exit: observation.exit, close: observation.close, finalizer: 'pending', source: [], copied: [], producedThenLost: [], expected: [], copy: 'partial', reads: 'unknown', writer: 'unknown', errors: [] };
  const stderrBytes = Buffer.concat(observation.stderr);
  report.stderr = { state: observation.close.state === 'closed' ? stderrBytes.length ? 'produced' : 'produced-empty' : 'partial-produced', bytes: stderrBytes.length, sha256: createHash('sha256').update(stderrBytes).digest('hex') };
  try { writeFileSync(join(output, 'caller.stderr'), stderrBytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { report.stderr.state = 'produced-then-lost'; report.errors.push({ stage: 'stderr', code: error.code ?? error.name }); }
  try { report.source = sightingFiles(directory); }
  catch (error) { report.errors.push({ stage: 'source-inventory', code: error.code ?? error.name }); }
  try { cpSync(directory, join(output, 'fixture'), { recursive: true, force: false, errorOnExist: true }); }
  catch (error) { report.errors.push({ stage: 'fixture-copy', code: error.code ?? error.name }); }
  try { report.copied = sightingFiles(join(output, 'fixture')); }
  catch (error) { report.errors.push({ stage: 'copy-inventory', code: error.code ?? error.name }); }
  if (!report.errors.length && JSON.stringify(report.source) === JSON.stringify(report.copied)) report.copy = 'byte-complete-at-snapshot';
  else report.copy = 'partial-or-changed';
  try {
    const trace = join(output, 'fixture', 'sighting-reads', 'trace.jsonl');
    if (existsSync(trace)) {
      const records = readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const starts = records.filter((row) => row.kind === 'start');
      const ends = records.filter((row) => row.kind === 'end' || row.kind === 'threw');
      const settled = records.every((row) => ['start', 'end', 'threw'].includes(row.kind)) && starts.length === ends.length && starts.every((start) => ends.filter((end) => end.id === start.id).length === 1);
      const streams = ends.filter((row) => row.kind === 'end').flatMap((row) => [row.stdout, row.stderr]).filter((value) => value?.type === 'string');
      const complete = streams.every((value) => {
        const found = report.copied.find((row) => row.name === `sighting-reads/${value.file}`);
        return found && found.bytes === value.bytes && found.sha256 === value.sha256;
      });
      report.reads = !starts.length ? 'no-observed-spawn-reason-unknown' : settled && complete ? 'settled-returned-originals' : 'partial-or-unresolved';
      report.writer = observation.close.state === 'closed' && starts.length > 0 && settled && complete ? 'caller-and-observed-reads-settled-other-writers-unconfirmed' : 'unknown';
    } else report.reads = 'no-observed-spawn-reason-unknown';
  } catch (error) { report.errors.push({ stage: 'read-trace', code: error.code ?? error.name }); }
  if (!report.errors.some((error) => error.stage === 'source-inventory' || error.stage === 'copy-inventory')) report.producedThenLost = report.source.filter((row) => !report.copied.some((copy) => copy.name === row.name));
  report.expected = ['sighting-attempt', 'caller.mjs', 'command', 'ps-sighted', 'sighting-reads/trace.jsonl', 'sighted-ps.log', 'sighted-live', 'pairs', 'events', 'ending', 'exiting'].map((name) => {
    const source = report.source.find((row) => row.name === name);
    const copied = report.copied.find((row) => row.name === name);
    const state = report.errors.some((error) => error.stage === 'source-inventory') ? 'unknown-source-inventory'
      : !source ? 'not-present-at-snapshot'
        : report.errors.some((error) => error.stage === 'copy-inventory') ? 'unknown-copy-inventory'
          : !copied ? 'produced-then-lost' : copied.bytes ? 'produced' : 'produced-empty';
    return { name, state };
  });
  writeFileSync(join(output, 'inventory.json'), JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

/** Admits a prepared attempt only after its retained copy and finalizer are both closed. */
function eligibleSightingAttempt(root) {
  const report = JSON.parse(readFileSync(join(root, 'settled', 'inventory.json'), 'utf8'));
  assert.equal(report.exit?.state, 'observed', 'the exit caller never settled');
  assert.equal(report.close?.state, 'closed', 'the exit caller never closed');
  assert.equal(report.copy, 'byte-complete-at-snapshot', 'the private fixture copy was incomplete');
  assert.equal(report.reads, 'settled-returned-originals', 'an observed outer read did not settle with originals');
  assert.deepEqual(report.errors, [], 'private retention reported an error');
  assert.deepEqual(report.producedThenLost, [], 'a produced original was lost');
  assert.deepEqual(report.copied, report.source, 'the private copy differed from its source inventory');
  for (const { name } of report.copied) {
    assert.ok((lstatSync(join(root, 'settled', 'fixture', name)).mode & 0o400) !== 0,
      `retained original ${name} is not owner-readable`);
  }
  assert.deepEqual(sightingFiles(join(root, 'settled', 'fixture')), report.copied,
    'a retained original is missing or differs from its frozen inventory');
  const finalizer = JSON.parse(readFileSync(join(root, 'finalizer.json'), 'utf8'));
  assert.equal(finalizer.attempt, report.attempt, 'the finalizer names another attempt');
  assert.equal(finalizer.state, 'pass', 'the fixture finalizer did not pass');
  assert.equal(finalizer.scratch, 'removed', 'fixture scratch remained at finalization');
  assert.ok(Array.isArray(finalizer.identities) && finalizer.identities.length > 0,
    'the finalizer contains no observed identities');
  for (const identity of finalizer.identities) {
    assert.ok(Number.isSafeInteger(identity.pid) && identity.pid > 0, 'the finalizer identity has no recorded PID');
    assert.equal(identity.disposition, 'absent', `identity ${identity.pid} remains live, zombie, unsafe or unconfirmed`);
  }
  return true;
}

/** Records a final returned process-table answer for each identity named by the retained fixture. */
function finalizedSightingIdentities(observation) {
  const copied = join(observation.target, 'settled', 'fixture');
  const identities = [
    { source: 'caller', pid: observation.callerPid },
    ...['group', 'one', 'two'].map((source) => ({
      source,
      pid: existsSync(join(copied, `${source}.pid`)) ? Number(readFileSync(join(copied, `${source}.pid`), 'utf8').trim()) : null,
    })),
  ];
  const originals = join(observation.target, 'finalizer-reads');
  mkdirSync(originals, { mode: 0o700 });
  return identities.map(({ source, pid }) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return { source, pid, disposition: 'unconfirmed' };
    const args = ['-p', String(pid), '-o', 'pid=,stat='];
    const answer = spawnSync(PS, args, { env: process.env, timeout: 500, maxBuffer: 1024 * 1024 });
    const stdout = answer.stdout ?? Buffer.alloc(0);
    const stderr = answer.stderr ?? Buffer.alloc(0);
    const base = `finalizer-reads/${source}`;
    writeFileSync(join(observation.target, `${base}.stdout`), stdout, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(observation.target, `${base}.stderr`), stderr, { flag: 'wx', mode: 0o600 });
    const original = `${base}.json`;
    const record = {
      tool: PS, args, status: answer.status, signal: answer.signal,
      error: answer.error ? { code: answer.error.code ?? answer.error.name, message: answer.error.message } : null,
      stdout: { file: `${base}.stdout`, bytes: stdout.length, sha256: createHash('sha256').update(stdout).digest('hex'), produced: answer.stdout !== null },
      stderr: { file: `${base}.stderr`, bytes: stderr.length, sha256: createHash('sha256').update(stderr).digest('hex'), produced: answer.stderr !== null },
    };
    writeFileSync(join(observation.target, original), JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    const disposition = !answer.error && !answer.signal && answer.status === 1 && stdout.length === 0 && stderr.length === 0
      ? 'absent' : answer.error || answer.signal ? 'unconfirmed' : /\bZ/.test(stdout.toString('utf8')) ? 'zombie' : 'live';
    return { source, pid, disposition, original };
  });
}

/** Lines of JSON a caller in `directory` appended to `name`, each parsed, or none. */
const linesOf = (directory, name) => (existsSync(join(directory, name)) ? readFileSync(join(directory, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

/**
 * Runs `CALLER` in `directory` under `options`, and settles once it has ended, on its exit status,
 * its events, the signals it sent, and when it began to exit and when it had ended.
 */
async function cleanedUp(directory, options) {
  const observation = sightingAttempts.get(directory) ?? sightingObservation(directory, options);
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, CALLER);
  const run = spawn(process.execPath, [caller, directory, JSON.stringify({ readTimeout: CLEANUP_BOUND, ...options })], { stdio: ['ignore', 'ignore', 'pipe'], ...(observation ? { env: { ...process.env, C615_SIGHTING_EVIDENCE_ROOT: observation.root } } : {}) });
  if (observation) observation.callerPid = run.pid ?? null;
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  if (observation) {
    run.stderr.on('data', (chunk) => { observation.stderr.push(Buffer.from(chunk)); });
    run.once('exit', (code, signal) => { observation.exit = { state: 'observed', code, signal }; });
    run.once('error', (error) => { observation.exit = { state: 'error', code: error.code ?? error.name }; });
    observation.closed = new Promise((resolveClose) => run.once('close', (code, signal) => { observation.close = { state: 'closed', code, signal }; resolveClose(); }));
  }
  try {
  const [status] = await once(run, 'exit');
  const ended = Date.now();
  return { status, stderr, events: linesOf(directory, 'events'), pairs: linesOf(directory, 'pairs'), exiting: Number(read(directory, 'exiting')), ended };
  } finally {
    if (observation) {
      let timer;
      await Promise.race([observation.closed, new Promise((resolveClose) => { timer = setTimeout(resolveClose, 2_000); })]);
      clearTimeout(timer);
      try { const retained = retainSighting(observation, directory, 'settled'); observation.finalSnapshot = true; observation.snapshotResult = retained.copy; observation.snapshotReport = retained; }
      catch (error) { observation.snapshotError = error.code ?? error.name; }
    }
  }
}

/** The `[target, signal]` of each pair in `pairs` that sends `SIGSTOP` to a process group. */
const groupStops = (pairs) => pairs.filter(([target, name]) => target < 0 && name === 'SIGSTOP');

/** How many of `pairs` send `SIGKILL` to the group `group`. */
const groupKills = (pairs, group) => pairs.filter(([target, name]) => target === -group && name === 'SIGKILL').length;

/** Each event's name, pid, name and command line, and reason where it has one. */
const shown = (events) => events.map(({ event, pid, name, cmd, reason }) => ({ event, pid, name, cmd, ...(reason === undefined ? {} : { reason }) }));

/** What a `tail` following `$here/hold` in `directory` is recorded as: its name and command line. */
const tailOf = (directory) => ({ name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` });

// proves R-STATE-18
test('L0 sends SIGSTOP to no process group on the call\'s containment, a start\'s kill of a recorded group, or the exit cleanup', SETTLES_WITHIN, async (t) => {
  const call = holding(t);
  const calling = standIn(call);
  let group;
  await called(call, { command: leavingTwo(call), kill: calling.kill, onGroup: (id) => { group = id; } });

  const start = holding(t);
  const started = await startGroup(t, start, 'group');
  const starting = standIn(start);
  await startKilled(started, { kill: starting.kill });

  const exit = holding(t);
  holdingTwo(exit);
  const { pairs } = await cleanedUp(exit, {});

  for (const [where, sent, killed] of [['the call', calling.pairs, group], ['a start', starting.pairs, started.group], ['the exit cleanup', pairs, pidIn(exit, 'group')]]) {
    assert.ok(groupKills(sent, killed) > 0, `${where} sent no kill to its group, so the test proves nothing`);
    assert.deepEqual(groupStops(sent), [], `${where} stopped a process group`);
  }
});

/** Each of `events` by its name and pid, and by its name and command line where it carries them, ordered by pid. */
const byPid = (events) => events.map(({ event, pid, name, cmd }) => ({ event, pid, name, cmd })).sort((one, other) => (one.pid ?? 0) - (other.pid ?? 0));

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a survivor the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await called(directory, { command: leavingTwo(directory), ps: cuttingTwo(directory) });

  assert.deepEqual(byPid(events), byPid(['one', 'two'].map((name) => ({ event: 'survivor.killed', pid: pidIn(directory, name), ...tailOf(directory) }))));
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'two.pid'), String(started.member));

  const { events } = await startKilled(started, { ps: cuttingTwo(directory) });

  assert.deepEqual(byPid(events).map(({ event, pid, name }) => ({ event, pid, named: name !== undefined })), byPid([
    { event: 'recorded.killed', pid: started.leader },
    { event: 'recorded.killed', pid: started.member },
  ]).map(({ event, pid }) => ({ event, pid, named: true })));
  assert.deepEqual(events.find(({ pid }) => pid === started.member).cmd, `/usr/bin/tail -f ${directory}/hold`);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a survivor the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  cuttingTwo(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps' });

  assert.equal(status, 0);
  const pids = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.deepEqual(byPid(events.filter(({ pid }) => pids.includes(pid))), byPid(pids.map((pid) => ({ event: 'survivor.killed', pid, ...tailOf(directory) }))));
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed'), []);
  assert.deepEqual(pids.map(alive), [false, false]);
});

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read until `$here/hang`
 * marks that L0 has sent its group the kill, and answers every read as `ps` does from then on.
 */
const hidingTwoUntilKilled = (directory) => fixture(directory, 'ps', [
  ("[ -f \"$here/hang\" ] && exec " + shellQuote(PS) + " \"$@\""),
  CUT_TWO,
  'exit 0',
].join('\n'));

/**
 * The signal call `standIn` hands back, which also marks `$here/hang` as it first sends the group
 * the kill, and passes `outlasts`'s process over for the first two kills.
 */
function markingKill(directory, signals) {
  return (target, name) => {
    if (target < 0 && name === 'SIGKILL') writeFileSync(join(directory, 'hang'), '');
    return signals.kill(target, name);
  };
}

/** A parent outside the group that reaps its joined child once a state read releases it. */
function reapingJoiner(directory) {
  const program = join(directory, 'reaping-joiner');
  writeFileSync(program, [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork() // die "fork: $!";',
    'if ($child == 0) {',
    '  setpgrp(0, $group) or die "join: $!";',
    '  open my $pid, ">", "$here/two.pid.tmp" or die; print $pid $$; close $pid;',
    '  rename "$here/two.pid.tmp", "$here/two.pid" or die;',
    '  1 until -e "$here/release-two";',
    '  exit 0;',
    '}',
    'waitpid($child, 0);',
    'open my $mark, ">", "$here/reaped-two" or die; close $mark;',
  ].join(' '));
  return program;
}

/** Starts a member whose parent can prove reaping before L0's confirming read and kill. */
function reapingCommand(directory, hold) {
  const joiner = reapingJoiner(directory);
  return fixture(directory, 'command', [
    ...(hold ? ['echo $$ > "$here/group.pid"'] : []),
    leave(TAIL, 'one'),
    '/usr/bin/perl "' + joiner + '" "$here" $$ >/dev/null 2>&1 &',
    'while [ ! -f "$here/two.pid" ]; do :; done',
    ...(hold ? [': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'] : []),
  ].join('\n'));
}

/** Runs one controlled census sighting through the call's containment and returns its trace. */
async function censusCall(t, cell, afterKill = 'omit') {
  const directory = holding(t);
  const signals = standIn(directory);
  const command = cell === 'X' ? reapingCommand(directory, false)
    : fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const { events } = await called(directory, { command, ps: sightingPs(directory, { cell, afterKill }), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  const group = signals.pairs.find(([target, name]) => target < 0 && name === 'SIGKILL')?.[0] * -1;
  const trace = read(directory, 'sighted-ps.log');
  assert.ok(existsSync(join(directory, 'sighted-first-stat')), 'the first census state read did not happen');
  if (cell !== 'X') assert.ok(existsSync(join(directory, 'sighted-live')), 'the last read before the kill did not find the member alive');
  assert.ok(groupKills(signals.pairs, group) > 0, 'no group kill was sent');
  const mark = cell === 'X' ? 'reaped-two:' + existsSync(join(directory, 'reaped-two'))
    : afterKill === 'zombie' ? 'state:' + processState(two)
      : 'live-before-kill:' + existsSync(join(directory, 'sighted-live'));
  t.diagnostic(JSON.stringify({ cell: `${cell}-call-${afterKill}`, group, members: [pidIn(directory, 'one'), two], mark, trace, kills: signals.pairs, events }));
  if (afterKill === 'omit' && cell !== 'X') assertPostKillOmission(trace, group, two, 'call');
  return { directory, events, group, two, trace };
}

/** Runs the same stand-in through synchronous exit containment. */
async function censusExit(t, cell, afterKill = 'omit') {
  const prepared = ['B', 'A', 'U2'].includes(cell);
  const selectedRoot = sightingEvidenceRoot();
  if (prepared) assert.ok(selectedRoot, 'prepared sighting needs private returned-read originals');
  const directory = holding(t);
  if (prepared) sightingObservation(directory, { ps: 'ps-sighted' }, selectedRoot);
  if (selectedRoot) {
    t.signal.addEventListener('abort', () => {
      const observation = sightingAttempts.get(directory);
      if (observation && !observation.finalSnapshot) {
        try { retainSighting(observation, directory, 'unsettled'); }
        catch (error) { observation.snapshotError = error.code ?? error.name; }
      }
    }, { once: true });
    t.after(() => {
      const unfinished = sightingAttempts.get(directory);
      if (unfinished && !unfinished.finalSnapshot) {
        try { const retained = retainSighting(unfinished, directory, 'teardown'); unfinished.finalSnapshot = true; unfinished.snapshotResult = retained.copy; unfinished.snapshotReport = retained; }
        catch (error) { unfinished.snapshotError = error.code ?? error.name; }
      }
      t.after(() => {
        const observation = sightingAttempts.get(directory);
        if (!observation) return;
        const scratch = existsSync(directory) ? 'present' : 'removed';
        const identities = finalizedSightingIdentities(observation);
        const state = scratch === 'removed' && observation.snapshotResult === 'byte-complete-at-snapshot'
          && !observation.snapshotError && identities.every(({ disposition }) => disposition === 'absent') ? 'pass' : 'fail';
        writeFileSync(join(observation.target, 'finalizer.json'), JSON.stringify({ attempt: observation.id, state, scratch,
          snapshot: observation.snapshotResult ?? 'unresolved', snapshotError: observation.snapshotError ?? null,
          identities }) + '\n', { flag: 'wx', mode: 0o600 });
        sightingAttempts.delete(directory);
      });
    });
  }
  if (cell === 'X') reapingCommand(directory, true);
  else if (afterKill === 'zombie') joinedLate(directory);
  else holdingTwo(directory);
  sightingPs(directory, { cell, afterKill, prepared });
  const forcing = exitForcings.get(t);
  if (forcing) forceExit(directory, forcing);
  const { status, stderr, events, pairs } = await cleanedUp(directory, { ps: 'ps-sighted', hangAfter: 'group' });
  if (CUTOFF_CELLS.includes(cell)) {
    const exit = exitSighting(directory, pidIn(directory, 'group'));
    exitResults.set(t, { exit, events, directory });
    t.diagnostic(JSON.stringify({ exitSighting: exitSummary(exit) }));
    if (exitAnswerRequired.has(t) || process.env.EXIT_SIGHTING_REQUIRES === 'answered') {
      assert.equal(exit.branch, 'answered', `the controlled answered exit took the ${exit.branch} branch`);
      assert.equal(exit.partialCensus, false, 'the controlled answered exit returned a partial census, which carries no cache proof');
    }
    assert.ok(exit.branch === 'answered' || exit.branch === 'cutoff', `the exit took the ${exit.branch} branch, which earns neither the answered scenario nor the cutoff: ${JSON.stringify(exitSummary(exit))}`);
    if (exit.branch === 'answered') {
      const two = pidIn(directory, 'two');
      assert.ok(exit.probes.some(({ target, argv, end, start }) => target === two && argv === `-p ${two} -o stat=` && end >= start), `no real per-pid probe of the member was recorded for the answered confirmation: ${JSON.stringify(exit.probes)}`);
    }
    if (exit.branch === 'cutoff') return exitCutoff(directory, exit, { prepared, status, stderr, events });
  }
  if (prepared) {
    const observation = sightingAttempts.get(directory);
    const retained = observation?.snapshotReport;
    assert.equal(retained?.close.state, 'closed', 'the exit caller did not close before private retention');
    assert.equal(retained.copy, 'byte-complete-at-snapshot', 'the private fixture copy was incomplete');
    assert.equal(retained.reads, 'settled-returned-originals', 'an outer read original was missing or unresolved');
    assert.deepEqual(retained.errors, [], 'private retention reported an error');
    if (!(cell === 'A' && exitResults.get(t)?.exit.partialCensus)) assertPreparedCache(join(observation.target, 'settled', 'fixture'), cell);
    else t.diagnostic(JSON.stringify({ exitSighting: 'partial census: O270 C3 window, no prepared-cache proof claimed' }));
  }
  const group = pidIn(directory, 'group');
  const two = pidIn(directory, 'two');
  const trace = read(directory, 'sighted-ps.log');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'sighted-first-stat')), 'the first census state read did not happen');
  if (prepared && !existsSync(join(directory, 'sighted-live'))) {
    const probe = join(directory, 'sighted-state-probe');
    const answer = existsSync(probe) ? readFileSync(probe, 'utf8') : '';
    const result = /^PER-PID \d+ status=(\d+) stat=([A-Za-z+<> ]*)\n$/.exec(answer);
    const state = result?.[2].trim();
    t.diagnostic(JSON.stringify({ sightingState: state === undefined ? 'unavailable'
      : state === '' ? 'empty' : state.startsWith('Z') ? 'zombie' : 'nonzombie',
      sightingStatus: result ? Number(result[1]) : null }));
  }
  if (cell !== 'X') assert.ok(existsSync(join(directory, 'sighted-live')), 'the last read before the kill did not find the member alive');
  assert.ok(groupKills(pairs, group) > 0, 'no group kill was sent');
  if (prepared) {
    const beforeRows = sightingReads(trace).filter(({ args, rows }) => args === `-g ${group} -o pid=,stat=` && rows.includes('PHASE before-kill'));
    assert.ok(beforeRows.length > 0, 'no answered before-kill outer read reached');
    const beforeReads = beforeRows.map((_, occurrence) => answeredSightingRead(directory, trace, ['-g', String(group), '-o', 'pid=,stat='], 'before-kill', occurrence));
    const postKill = sightingReads(trace).filter(({ args, rows }) => args === `-g ${group} -o pid=,stat=,xstat=` && rows.includes('PHASE after-kill'));
    assert.ok(postKill.length > 0, 'no answered post-kill outer read reached');
    const shown = new RegExp(`^\\s*${two} Z`, 'm');
    let previous = beforeReads.at(-1).end;
    let sawZombie = false;
    for (let occurrence = 0; occurrence < postKill.length; occurrence++) {
      const after = answeredSightingRead(directory, trace, ['-g', String(group), '-o', 'pid=,stat=,xstat='], 'after-kill', occurrence);
      assert.ok(BigInt(after.start.startedNs) > BigInt(previous.endedNs), 'a post-kill outer read preceded its prior answer');
      if (afterKill === 'zombie') {
        const target = new RegExp(`^\\s*${two}(?:\\s|$)`, 'm').test(after.stdout);
        if (target) assert.match(after.stdout, shown, 'an answered post-kill read showed a non-zombie member');
        sawZombie ||= target;
      } else assert.doesNotMatch(after.stdout, new RegExp(`^\\s*${two}(?:\\s|$)`, 'm'), 'an answered post-kill read named the omitted member');
      previous = after.end;
    }
    if (afterKill === 'zombie') assert.ok(sawZombie, 'no answered post-kill read showed the zombie');
  }
  const mark = cell === 'X' ? 'reaped-two:' + existsSync(join(directory, 'reaped-two'))
    : afterKill === 'zombie' ? 'state:' + processState(two)
      : 'live-before-kill:' + existsSync(join(directory, 'sighted-live'));
  t.diagnostic(JSON.stringify({ cell: `${cell}-exit-${afterKill}`, group, members: [pidIn(directory, 'one'), two], mark, trace, kills: pairs, events }));
  if (afterKill === 'omit' && cell !== 'X') assertPostKillOmission(trace, group, two, 'exit');
  return { directory, events, group, two, trace };
}

/**
 * The lines `forceExit` puts at the head of an exit cell's `ps` stand-in, below its warming exit.
 * Each pre-kill read is counted by kind, and a `force.<kind>.<n>` file in the cell's directory
 * makes the nth read of that kind hang until L0 kills it, answer with no rows, fail with standard
 * error, answer with no rows and status 1 (an empty answer `runOnce` also accepts), answer as the
 * stand-in does without the group leader, end the target and wait until it is
 * reaped or (its parent stopped) a zombie before answering, stop X0's reaping parent before the
 * X-reap read waits on it, or answer as the stand-in does and then fail or hang. Every forced read
 * is logged to `forced`.
 */
const EXIT_FORCING = [
  'case "$*" in',
  '  "-ww -g "*" -o pid=,stat=") force_kind=state ;;',
  '  "-ww -g "*" -o pid=,command=") force_kind=command ;;',
  '  "-p "*" -o ucomm=") force_kind=name ;;',
  '  "-g "*" -o pid=,stat=") force_kind=confirm ;;',
  '  "-p "*" -o pid=,stat=") force_kind=fallback ;;',
  '  *) force_kind=other ;;',
  'esac',
  'if [ -z "$EXIT_FORCE_PASS" ] && [ ! -f "$here/hang" ]; then',
  '  force_n=$(( $(/bin/cat "$here/force-count.$force_kind" 2>/dev/null || echo 0) + 1 ))',
  '  printf "%s" "$force_n" > "$here/force-count.$force_kind"',
  '  if [ -f "$here/force.$force_kind.$force_n" ]; then',
  '    force_action=$(/bin/cat "$here/force.$force_kind.$force_n")',
  '    printf "%s %s %s\\n" "$force_kind" "$force_n" "$force_action" >> "$here/forced"',
  '    case "$force_action" in',
  '      hang) exec /usr/bin/tail -f /dev/null ;;',
  '      empty) exit 0 ;;',
  '      empty-status-1) exit 1 ;;',
  '      fail) printf "forced failure\\n" >&2; exit 2 ;;',
  '      omit-leader) force_answer=$(EXIT_FORCE_PASS=1 "$0" "$@") || exit $?; printf "%s\\n" "$force_answer" | /usr/bin/awk -v pid="$(/bin/cat "$here/group.pid")" \'$1 != pid\'; exit 0 ;;',
  '      end-target-absent) force_target=$(/bin/cat "$here/two.pid"); /bin/kill -9 "$force_target" 2> /dev/null; while /bin/ps -p "$force_target" > /dev/null 2>&1; do :; done; printf "target %s absent\\n" "$force_target" >> "$here/forced"; EXIT_FORCE_PASS=1 exec "$0" "$@" ;;',
  '      end-target-zombie) force_target=$(/bin/cat "$here/two.pid"); force_parent=$(/bin/ps -o ppid= -p "$force_target" | /usr/bin/tr -d " "); /bin/kill -STOP "$force_parent"; /bin/kill -9 "$force_target" 2> /dev/null; until /bin/ps -p "$force_target" -o stat= | /usr/bin/grep -q "^Z"; do :; done; printf "target %s %s parent %s stopped\\n" "$force_target" "$(/bin/ps -p "$force_target" -o stat= | /usr/bin/tr -d " ")" "$force_parent" >> "$here/forced"; force_answer=$(EXIT_FORCE_PASS=1 "$0" "$@"); force_status=$?; /bin/kill -CONT "$force_parent"; printf "%s\\n" "$force_answer"; exit $force_status ;;',
  '      hold-reaper) force_parent=$(/bin/ps -o ppid= -p "$(/bin/cat "$here/two.pid")" | /usr/bin/tr -d " "); printf "%s" "$force_parent" > "$here/held-reaper"; /bin/kill -STOP "$force_parent"; printf "reaper %s stopped\\n" "$force_parent" >> "$here/forced"; EXIT_FORCE_PASS=1 exec "$0" "$@" ;;',
  '      answer-then-fail) EXIT_FORCE_PASS=1 "$0" "$@" > /dev/null; printf "forced failure\\n" >&2; exit 2 ;;',
  '      answer-then-hang) EXIT_FORCE_PASS=1 "$0" "$@" > /dev/null; exec /usr/bin/tail -f /dev/null ;;',
  '    esac',
  '  fi',
  'fi',
];

/**
 * Puts `forcing` in place for the exit cell in `directory`: `reads` names the stand-in reads to
 * force, as `EXIT_FORCING` does; `signals` has the `nth` signal `name` to the group in L0's `step`th
 * bounded step throw `code`; `probe` makes the confirming read's real per-pid probe `fail` with no
 * state, or `hang` until its read is ended (`sightingPs`). Each changes what L0 or the stand-in is
 * given; the exit trace records it. No forcing moves a clock.
 */
function forceExit(directory, { reads = [], signals = [], probe }) {
  const path = join(directory, 'ps-sighted');
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.splice(3, 0, ...EXIT_FORCING);
  writeFileSync(path, lines.join('\n'), { mode: 0o755 });
  warmed(path);
  for (const { kind, nth, action } of reads) writeFileSync(join(directory, `force.${kind}.${nth}`), action);
  writeFileSync(join(directory, 'exit-forcing.json'), JSON.stringify({ signals }));
  if (probe !== undefined) writeFileSync(join(directory, `probe-${probe}`), probe === 'hang' ? PROBE_HELD : '');
}

/**
 * The `probe-hang` program the stand-in runs in place of its own per-pid probe (`sightingPs`): it
 * fills a FIFO until a write would block, then starts the real `/bin/ps -p <target> -o stat=` with
 * its output into that FIFO, so the real probe runs and cannot hand its answer back. It records the
 * probe's pid and executable once the exec has happened, waits for the stand-in to be ended by L0,
 * then ends the probe, removes the FIFO and records how the probe ended. Its arguments are the target, the stand-in's pid and
 * the cell's directory. The FIFO and its record, `<directory>.probe-held`, sit beside the directory
 * rather than in it, since the program outlives the read L0 ends and the directory's retained copy.
 */
const PROBE_HELD = [
  'use strict; use Fcntl;',
  'my ($target, $standin, $here) = @ARGV;',
  'my $fifo = "$here.probe-fifo";',
  'open(my $log, ">>", "$here.probe-held") or die "log: $!"; $log->autoflush(1);',
  'system("/usr/bin/mkfifo", $fifo) == 0 or die "mkfifo: $?";',
  'open(my $hold, "+<", $fifo) or die "hold: $!";',
  'my $flags = fcntl($hold, F_GETFL, 0) or die "flags: $!";',
  'fcntl($hold, F_SETFL, $flags | O_NONBLOCK) or die "nonblock: $!";',
  'my $filled = 0;',
  'while (defined(my $wrote = syswrite($hold, "x" x 4096))) { $filled += $wrote; }',
  '$!{EAGAIN} or die "fill: $!";',
  'my $probe = fork() // die "fork: $!";',
  'if ($probe == 0) { open(STDOUT, ">", $fifo) or die "probe output: $!"; exec("/bin/ps", "-p", $target, "-o", "stat=") or die "exec: $!"; }',
  'my $comm = "";',
  'while (kill(0, $standin) && $comm !~ m{(^|/)ps$}) { $comm = `/bin/ps -o comm= -p $probe`; chomp $comm; }',
  'print $log "started $probe $comm filled=$filled\n";',
  '1 while kill(0, $standin);',
  'my $before = `/bin/ps -o stat= -p $probe`; $before =~ s/\\s+//g;',
  'kill("KILL", $probe); waitpid($probe, 0);',
  'close($hold); unlink($fifo) or die "unlink: $!";',
  'print $log "cut $probe before=$before signal=" . ($? & 127) . " exit=" . ($? >> 8) . "\n";',
].join('\n');

/** L0's words for a read it gave up on, or could not use, in an exit cleanup bounded at `CLEANUP_BOUND`. */
const EXIT_WORDS = {
  late: `the reads of the process table did not finish within ${CLEANUP_BOUND} ms`,
  timeout: `the process-table read timed out after ${CLEANUP_BOUND} ms`,
  refused: `the process-table read timed out after ${CLEANUP_BOUND} ms earlier in the exit cleanup, which does not wait on it again`,
  spent: `the reads of the group just before its kill listed no process for ${CLEANUP_BOUND} ms while signal 0 still reached it`,
  confirmFailed: 'the read of the group just before its kill failed while signal 0 still reached it: ',
  fallbackAnswered: ', so the kill of the group may have ended a process the census had not named',
  fallbackFailed: ", and the read of the census's processes by pid failed too: ",
};

/** The rows of a returned read by pid, as L0 reads them, or the failure L0 makes of one it cannot. */
function exitRows(printed) {
  const rows = new Map();
  for (const line of printed.split('\n').filter(Boolean)) {
    const row = /^\s*(\d+) (.*)$/.exec(line);
    if (!row) throw new Error(`the process table held a row the census cannot read: ${JSON.stringify(line)}`);
    rows.set(Number(row[1]), row[2]);
  }
  return rows;
}

/**
 * The exit trace's rows as an ordered timeline: each read L0 asked for, with the time it asked, and
 * what the stand-in returned where L0 started one, beside the clock calls and signals.
 */
function exitTimeline(directory) {
  const items = [];
  let asking;
  let current;
  for (const row of linesOf(directory, 'exit-trace.jsonl')) {
    if (row.kind === 'clock' && row.frame === 'readingNow') {
      if (asking) items.push({ ...asking, kind: 'reading' });
      asking = row;
      continue;
    }
    if (row.kind === 'clock' && row.frame === 'runNow' && asking) {
      current = { kind: 'request', seq: asking.seq, step: asking.step, at: asking.at, spawned: false };
      items.push(current);
      asking = undefined;
      continue;
    }
    if (asking) {
      items.push({ ...asking, kind: 'reading' });
      asking = undefined;
    }
    if (row.kind === 'spawn') Object.assign(current, { spawned: true, argv: row.argv, timeout: row.timeout });
    else if (row.kind === 'returned') Object.assign(current, { status: row.status, signal: row.signal, error: row.error, stdout: row.stdout, stderr: row.stderr });
    else if (row.kind === 'threw') Object.assign(current, { threw: row.code, message: row.message });
    else if (row.kind !== 'clock' || row.frame !== 'runNow') items.push(row);
  }
  if (asking) items.push({ ...asking, kind: 'reading' });
  return items;
}

/** What one read gave L0: an answer, or the failure L0 makes of it, with `deadline` its read deadline. */
function exitOutcome(request, deadline, tool) {
  if (!request.spawned) return deadline - request.at <= 0 ? { kind: 'late', message: EXIT_WORDS.late } : { kind: 'refused', message: EXIT_WORDS.refused };
  if (request.error === 'ETIMEDOUT') return { kind: 'timeout', message: EXIT_WORDS.timeout };
  if (request.threw !== undefined || request.error) return { kind: 'failed', message: request.message ?? String(request.error) };
  if (request.stderr) return { kind: 'failed', message: `the process-table read failed: ${request.stderr.trim()}` };
  if (request.status !== 0 && !(request.status === 1 && request.stdout === '')) return { kind: 'failed', message: `${tool} ${request.argv.join(' ')} ended with ${request.status ?? request.signal}` };
  // A name read's whole output is one process's name, which `namesOf` takes as printed.
  if (request.argv.at(-1) === 'ucomm=') return { kind: 'answered', printed: request.stdout, status: request.status };
  try { return { kind: 'answered', rows: exitRows(request.stdout), status: request.status }; }
  catch (error) { return { kind: 'failed', message: error.message }; }
}

/** Whether signal `name` to `target` reached it, from the first such record in `items`, as `answers` counts one. */
function exitAnswers(items, target) {
  const record = items.find((item) => item.kind === 'signal' && item.target === target && item.name === 0);
  if (record === undefined) return undefined;
  return record.ok || record.code === 'EPERM';
}

/**
 * Classifies the exit cleanup of the cell in `directory`, whose group is `group`, from L0's own
 * received originals in the exit trace: how the census ended (C), the `unseen` it kept (N), each
 * returned-empty confirmation (E), how the confirmation loop ended (F), its fallback (B), the kill
 * and the first read after it (K), and the complete reason L0 must give the group's kill. The
 * branch is `answered` only where a confirming read with rows reached L0; `cutoff` only where the
 * real deadline left no such answer; anything else is `diagnostic`, and a trace that cannot be
 * read in source order is `unknown`.
 */
function exitSighting(directory, group) {
  const tool = join(directory, 'ps-sighted');
  const items = exitTimeline(directory);
  const result = { group, branch: 'unknown', C: undefined, N: 'N0', n: 0, statuses: [], F: undefined, B: undefined, reason: undefined, named: [], identities: new Map(), kill: undefined, postKill: undefined, cut: undefined, why: [] };
  const fail = (why) => { result.why.push(why); return result; };
  const withins = items.filter((item) => item.kind === 'clock' && item.frame === 'within');
  if (withins.length === 0) return fail('no bounded step was traced');
  const censusDeadline = withins[0].at + CLEANUP_BOUND;
  result.censusDeadline = censusDeadline;
  const killAt = items.findIndex((item) => item.kind === 'signal' && item.target === -group && item.name === 'SIGKILL');
  const beforeKill = killAt < 0 ? items : items.slice(0, killAt);
  const confirmAt = withins.length > 1 ? items.indexOf(withins[1]) : -1;
  const censusEnd = confirmAt >= 0 ? confirmAt : (() => { const reading = beforeKill.findIndex((item, index) => index > items.indexOf(withins[0]) && item.kind === 'reading'); return reading < 0 ? beforeKill.length : reading; })();
  const censusItems = items.slice(items.indexOf(withins[0]) + 1, censusEnd);
  // Every name and command line a returned read gave L0, by pid.
  for (const item of items) {
    if (item.kind !== 'request' || !item.spawned || item.error || item.stderr || (item.status !== 0 && item.status !== 1)) continue;
    const args = item.argv.join(' ');
    const known = (pid) => result.identities.get(pid) ?? result.identities.set(pid, { names: new Set(), commands: new Set() }).get(pid);
    if (/^-p \d+ -o ucomm=$/.test(args)) {
      const name = (item.stdout ?? '').replace(/ *\n$/, '');
      if (name !== '') known(Number(item.argv[1])).names.add(name);
    } else if (args.endsWith('-o pid=,command=')) {
      let rows;
      try { rows = exitRows(item.stdout ?? ''); } catch { continue; }
      for (const [pid, cmd] of rows) known(pid).commands.add(cmd);
    }
  }
  // The census, replayed in source order over the reads it made.
  const live = (state) => !state.startsWith('Z');
  const sightings = new Map();
  let last;
  let unseen;
  let round = { position: 'before' };
  let thrown;
  let returnedBy;
  let timedOut = false;
  const censusRequests = censusItems.filter((item) => item.kind === 'request');
  result.stateReads = 0;
  // Each completed census round in order: `changed`, `settled`, or the anomalous N1/N2 it kept.
  result.rounds = [];
  for (const request of censusRequests) {
    const outcome = exitOutcome(request, censusDeadline, tool);
    request.outcome = outcome.kind;
    if (outcome.kind === 'timeout') timedOut = true;
    if (outcome.kind !== 'answered') {
      result.censusCut = { step: 'census', request: request.seq, kind: outcome.kind, at: request.at, deadline: censusDeadline, remaining: censusDeadline - request.at, timeout: request.timeout ?? null };
      result.cut = result.censusCut;
      if (last !== undefined && (outcome.kind === 'late' || outcome.kind === 'timeout')) returnedBy = outcome.kind === 'late' ? 'C3' : 'C4';
      else thrown = { kind: outcome.kind, message: unseen ? `the census's reads ${unseen}: ${outcome.message}` : outcome.message };
      break;
    }
    const { rows } = outcome;
    if (round.position === 'before' || round.position === 'after') result.stateReads += 1;
    if (round.position === 'before') round = { position: 'lines', before: rows, names: new Map(), pending: [...rows].filter(([, state]) => live(state)).map(([pid]) => pid) };
    else if (round.position === 'lines') { round.lines = rows; round.position = round.pending.length ? 'names' : 'commands'; }
    else if (round.position === 'names') {
      const pid = round.pending.shift();
      const name = request.stdout.replace(/ *\n$/, '');
      if (name !== '') round.names.set(pid, name);
      if (round.pending.length === 0) round.position = 'commands';
    } else if (round.position === 'commands') { round.commands = rows; round.position = 'after'; }
    else {
      const { before, lines, names, commands } = round;
      const after = rows;
      for (const pid of new Set([...before.keys(), ...lines.keys(), ...commands.keys(), ...after.keys()])) {
        if (!sightings.has(pid)) sightings.set(pid, undefined);
        if (names.has(pid) && commands.has(pid)) sightings.set(pid, { pid, name: names.get(pid), cmd: commands.get(pid) });
      }
      const following = censusItems.slice(censusItems.indexOf(request) + 1);
      const nextRequest = following.findIndex((item) => item.kind === 'request');
      const between = nextRequest < 0 ? following : following.slice(0, nextRequest);
      unseen = after.size === 0 && exitAnswers(between, -group) ? 'named no process of the group while it still had one'
        : !after.has(group) && exitAnswers(between, group) ? `left out the group's leader, ${group}, while signal 0 still reached its pid`
          : undefined;
      if (unseen === undefined) {
        const living = [...after].filter(([, state]) => live(state)).map(([pid]) => pid);
        last = living.filter((pid) => names.has(pid) && commands.has(pid)).map((pid) => ({ pid, name: names.get(pid), cmd: commands.get(pid) }));
        // As `census` settles a round: no unknown state, the same pids, and every live one named alike.
        const settled = [before, after].every((states) => [...states.values()].every((state) => !state.startsWith('?')))
          && before.size === after.size && [...before.keys()].every((pid) => after.has(pid))
          && living.every((pid) => names.has(pid) && commands.has(pid) && lines.get(pid) === commands.get(pid));
        result.rounds.push(settled ? 'settled' : 'changed');
      }
      result.N = unseen === undefined ? 'N0' : unseen.startsWith('named') ? 'N1' : 'N2';
      if (unseen !== undefined) result.rounds.push(result.N);
      round = { position: 'before' };
    }
  }
  if (thrown !== undefined) {
    if (confirmAt >= 0) return fail('a read the census could not keep was followed by the confirmation step');
    const cutoff = thrown.kind === 'late' || thrown.kind === 'timeout';
    result.C = cutoff ? (unseen ? 'C2u' : 'C2') : last !== undefined ? 'C5' : 'C1';
    result.reason = thrown.message;
    result.unnamed = true;
    result.branch = cutoff ? 'cutoff' : 'diagnostic';
  } else {
    if (confirmAt < 0) return fail('the census returned no traced end');
    result.C = returnedBy ?? 'C0';
    if (last === undefined) return fail('the census returned without a completed round');
    const known = [...new Map([...sightings.values()].filter(Boolean).concat(last).map((member) => [member.pid, member])).values()];
    const decision = withins[1].at + CLEANUP_BOUND;
    const readDeadline = decision + CLEANUP_BOUND;
    result.decisionDeadline = decision;
    result.readDeadline = readDeadline;
    const loop = beforeKill.slice(confirmAt + 1);
    const emptiedAt = loop.findIndex((item) => item.kind === 'reading');
    const steps = emptiedAt < 0 ? loop : loop.slice(0, emptiedAt);
    let at = 0;
    let why;
    const next = (predicate) => { while (at < steps.length && !predicate(steps[at])) at++; return steps[at++]; };
    for (;;) {
      const occupied = next((item) => (item.kind === 'signal' && item.target === -group && item.name === 0) || item.kind === 'request');
      if (occupied?.kind !== 'signal') return fail('the confirmation step made no occupancy check');
      if (!occupied.ok && occupied.code === 'ESRCH') { result.F = `F0${result.n ? 'e' : 'z'}`; break; }
      if (!occupied.ok && occupied.code !== 'EPERM') {
        result.F = `F6${result.n ? 'e' : 'z'}`;
        result.reason = occupied.message ?? `kill ${occupied.code}`;
        result.unnamed = true;
        break;
      }
      const check = next((item) => (item.kind === 'clock' && item.frame === 'beforeKill') || item.kind === 'request');
      if (check?.kind !== 'clock') return fail('the confirmation step made no deadline check');
      if (check.at >= decision) {
        result.F = `F1${result.n ? 'e' : 'z'}`;
        result.spentAt = check.at;
        result.confirmCut = { step: 'confirm', kind: 'spent', at: check.at, deadline: decision, remaining: decision - check.at, timeout: null };
        result.cut = result.confirmCut;
        why = EXIT_WORDS.spent;
        break;
      }
      const request = next((item) => item.kind === 'request');
      if (request === undefined) return fail('the confirmation step asked for no read before its deadline');
      const outcome = exitOutcome(request, readDeadline, tool);
      request.outcome = outcome.kind;
      if (outcome.kind === 'answered' && outcome.rows.size > 0) { result.F = `F3${result.n ? 'e' : 'z'}`; break; }
      if (outcome.kind === 'answered') { result.n += 1; result.statuses.push(outcome.status); continue; }
      if (outcome.kind === 'refused' && !timedOut) return fail('a confirming read was refused with no earlier timeout');
      if (outcome.kind === 'timeout') timedOut = true;
      result.confirmCut = { step: 'confirm', request: request.seq, kind: outcome.kind, at: request.at, deadline: readDeadline, remaining: readDeadline - request.at, timeout: request.timeout ?? null };
      result.cut = result.confirmCut;
      result.F = { late: `F5L${result.C === 'C4' ? '4' : result.n ? 'e' : 'z'}`, timeout: `F5T${result.n ? 'e' : 'z'}`, refused: 'F2z', failed: `F4${result.n ? 'e' : 'z'}` }[outcome.kind];
      why = EXIT_WORDS.confirmFailed + outcome.message;
      break;
    }
    if (why !== undefined) {
      if (sightings.size === 0) {
        result.B = 'B0';
        result.reason = why + EXIT_WORDS.fallbackAnswered;
      } else {
        const request = next((item) => item.kind === 'request');
        if (request === undefined) return fail('no read of the census sightings by pid followed the confirmation');
        const outcome = exitOutcome(request, readDeadline, tool);
        request.outcome = outcome.kind;
        if (outcome.kind === 'refused' && !timedOut) return fail('the read by pid was refused with no earlier timeout');
        if (outcome.kind === 'answered') {
          result.B = outcome.rows.size > 0 ? 'B1' : 'B2';
          const after = steps.slice(at);
          result.named = known.filter(({ pid }) => (outcome.rows.has(pid) ? live(outcome.rows.get(pid)) : exitAnswers(after, pid))).map(({ pid }) => pid);
          result.reason = why + EXIT_WORDS.fallbackAnswered;
        } else {
          if (outcome.kind === 'timeout') timedOut = true;
          result.B = { failed: 'B3', late: 'B4', timeout: 'B5', refused: 'B6' }[outcome.kind];
          result.reason = why + EXIT_WORDS.fallbackFailed + outcome.message;
          result.unnamed = true;
        }
      }
    }
    const cutoff = /^F(1|2|5)/.test(result.F) && (result.F !== 'F2z' || result.C === 'C4');
    result.branch = result.F.startsWith('F3') ? 'answered' : cutoff ? 'cutoff' : 'diagnostic';
  }
  const kill = killAt < 0 ? undefined : items[killAt];
  result.kill = kill === undefined ? { sent: false } : { sent: true, ok: kill.ok, code: kill.code ?? null };
  // The stand-in's own record of each real per-pid probe it ran inside a confirming read, and of
  // when each marker was written; neither is an answer L0 received.
  const probeLog = existsSync(join(directory, 'probe-log')) ? readFileSync(join(directory, 'probe-log'), 'utf8').split('\n').filter(Boolean) : [];
  result.probes = probeLog.map((line) => /^PROBE pid=(\d+) argv=(-p (\d+) -o stat=) start=(\S+) end=(\S+) status=(\d+) stat=(.*) stderr=(.*) member-before=(\S+) member-after=(\S+)$/.exec(line)).filter(Boolean)
    .map(([, standIn, argv, target, start, end, status, stat, stderr, before, after]) => ({ standIn: Number(standIn), argv, target: Number(target), start: Number(start), end: Number(end), status: Number(status), stat: stat.trim(), stderr, before, after }));
  result.markers = probeLog.map((line) => /^MARKER (\S+) (\S+)$/.exec(line)).filter(Boolean).map(([, name, at]) => ({ name, at: Number(at) }));
  result.kills = items.filter((item) => item.kind === 'signal' && item.target === -group && item.name === 'SIGKILL').map(({ ok, code }) => ({ ok, code: code ?? null }));
  // O270's ordinary-A0 window: round 1 completed, a later census read cut before it started, fewer
  // than three state reads returned, and a confirming answer with rows still reached L0.
  result.partialCensus = result.C === 'C3' && result.censusCut?.kind === 'late' && result.stateReads < 3 && /^F3/.test(result.F ?? '');
  if (kill !== undefined) {
    const readings = items.slice(0, killAt).filter((item) => item.kind === 'reading');
    const deadline = readings.length ? readings.at(-1).at + CLEANUP_BOUND : undefined;
    const first = items.slice(killAt + 1).find((item) => item.kind === 'request');
    result.postKill = first === undefined ? { kind: 'none' } : { ...exitOutcome(first, deadline ?? Infinity, tool), argv: first.argv ?? null, rows: undefined, timedOutBefore: timedOut };
    // The members L0 could not end, as `emptied` decides them from its reads of the group after the
    // kill: each member the last answered read found alive, where a later read was cut by the bound
    // (late, or timed out). An answer with none alive ends the reads; a failed one is read again.
    let living;
    result.unended = [];
    for (const request of items.slice(killAt + 1).filter((item) => item.kind === 'request' && item.argv?.join(' ') === `-g ${group} -o pid=,stat=,xstat=`)) {
      const outcome = exitOutcome(request, deadline ?? Infinity, tool);
      if (outcome.kind === 'answered') {
        living = [...outcome.rows].filter(([, state]) => live(state)).map(([pid]) => pid);
        if (living.length === 0) break;
      } else if (outcome.kind === 'late' || outcome.kind === 'timeout') {
        result.unended = living ?? [];
        break;
      }
    }
  }
  return result;
}

/** What `exitSighting` found, as one JSON-ready record for a diagnostic. */
const exitSummary = (exit) => ({ ...exit, identities: Object.fromEntries([...exit.identities].map(([pid, { names, commands }]) => [pid, { names: [...names], commands: [...commands] }])) });

/**
 * The traced real-deadline cutoff of an exit cell: the exit caller ended, its private retention is
 * whole, the census or confirmation was cut at its real bound with no confirming answer, L0 sent
 * the group's kill and it reached the group, and L0 recorded exactly one kill of the group with
 * the complete reason its branch gives, and named no process by an identity no read returned.
 */
function exitCutoff(directory, exit, { prepared, status, stderr, events }) {
  assert.equal(status, 0, stderr);
  if (prepared) {
    const retained = sightingAttempts.get(directory)?.snapshotReport;
    assert.equal(retained?.close.state, 'closed', 'the exit caller did not close before private retention');
    assert.equal(retained.copy, 'byte-complete-at-snapshot', 'the private fixture copy was incomplete');
    assert.deepEqual(retained.errors, [], 'private retention reported an error');
  }
  const observation = sightingAttempts.get(directory);
  if (observation?.snapshotReport) {
    // Every read the stand-in started has a settled original, and no other does: a read L0 cut
    // before it started, or refused, has none, and a timed-out one keeps its partial original.
    assert.equal(observation.snapshotReport.reads, 'settled-returned-originals', 'an outer read original was missing or unresolved');
    const retained = linesOf(join(observation.target, 'settled', 'fixture'), 'sighting-reads/trace.jsonl');
    const starts = retained.filter(({ kind }) => kind === 'start');
    const ends = retained.filter(({ kind }) => kind === 'end' || kind === 'threw');
    const spawned = exitTimeline(directory).filter((item) => item.kind === 'request' && item.spawned);
    assert.deepEqual(starts.map(({ argv }) => argv.join(' ')), spawned.map(({ argv }) => argv.join(' ')), 'the retained originals differ from the reads L0 started');
    assert.deepEqual(ends.map(({ id }) => id), starts.map(({ id }) => id), 'a started read has no retained end');
    assert.deepEqual(ends.map(({ error }) => error?.code === 'ETIMEDOUT'), spawned.map(({ error }) => error === 'ETIMEDOUT'), 'a timed-out read was retained as answered, or the reverse');
  }
  const { group } = exit;
  // The decisive real deadline of each bounded step that cut: the census step for C2, C2u, C3 and
  // C4, the confirmation step for F1, F2 and F5. A C4 census timeout stays asserted after its
  // refused confirmation.
  const deadlineCut = (cut, step, bound) => {
    assert.ok(cut, `the ${step} step names no read or deadline that its real bound cut`);
    assert.equal(cut.step, step);
    assert.equal(cut.deadline - cut.remaining, cut.at, `the ${step} cut's remaining time is not measured from its deadline`);
    if (cut.kind === 'timeout') assert.ok(cut.timeout > 0 && cut.timeout === cut.remaining && cut.timeout <= bound, `the timed-out ${step} read was not bounded by its real deadline: ${JSON.stringify(cut)}`);
    else if (cut.kind === 'late' || cut.kind === 'spent') assert.ok(cut.remaining <= 0, `the ${step} read cut before it started, or the spent deadline, had time left: ${JSON.stringify(cut)}`);
    else if (cut.kind === 'refused') assert.ok(cut.remaining > 0 && cut.timeout === null, `the refused ${step} read had no time left or started: ${JSON.stringify(cut)}`);
    else assert.fail(`the ${step} cut is a ${cut.kind}, not a real-deadline cut: ${JSON.stringify(cut)}`);
  };
  if (['C2', 'C2u', 'C3', 'C4'].includes(exit.C)) {
    deadlineCut(exit.censusCut, 'census', CLEANUP_BOUND);
    assert.equal(exit.censusCut.deadline, exit.censusDeadline, 'the census cut is not at the census step\'s 1,000 ms deadline');
    if (exit.C === 'C4') assert.equal(exit.censusCut.kind, 'timeout', 'a C4 return was not cut by a started census timeout');
    if (exit.C === 'C3') assert.equal(exit.censusCut.kind, 'late', 'a C3 return was not cut before its read started');
  }
  if (exit.F !== undefined) {
    deadlineCut(exit.confirmCut, 'confirm', 2 * CLEANUP_BOUND);
    if (/^F1/.test(exit.F)) assert.ok(exit.spentAt >= exit.decisionDeadline, 'the confirmation deadline was not spent');
    if (exit.F === 'F2z') assert.equal(exit.censusCut?.kind, 'timeout', 'a refused confirmation followed no census timeout');
  }
  assert.deepEqual(exit.kill, { sent: true, ok: true, code: null }, 'the group kill was not sent, or did not reach the group');
  const kills = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
  assert.equal(kills.length, 1, `the group kill was not recorded once: ${JSON.stringify(events)}`);
  assert.equal(kills[0].census, exit.reason, 'the group kill does not carry the reason its cutoff branch gives');
  // Every event, exactly, against the multiset the exit's reads support: each supported event is
  // its kind and its whole field set, each field with the values a read gave L0 for it, so an event
  // with a field added, changed or missing, or one more event of any kind, matches none.
  const unendedPids = new Set(exit.unended ?? []);
  const named = (pid) => exit.identities.get(pid) ?? { names: new Set(), commands: new Set() };
  // A member's name and command line, where a read returned one, as `described` and the census give them.
  const identified = (pid, required) => {
    const { names, commands } = named(pid);
    return { ...(required || names.size ? { name: [...names] } : {}), ...(required || commands.size ? { cmd: [...commands] } : {}) };
  };
  const supported = [
    { event: 'group.killed', group: [group], census: [exit.reason] },
    ...(exit.unnamed ? [] : exit.named.filter((pid) => !unendedPids.has(pid)).map((pid) => ({ event: 'survivor.killed', pid: [pid], ...identified(pid, true) }))),
    ...[...unendedPids].map((pid) => ({ event: 'survivor.unended', pid: [pid], ...identified(pid, false), reason: [`still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out`] })),
  ];
  const fits = (record, spec) => {
    const keys = Object.keys(record).sort();
    const wanted = Object.keys(spec).sort();
    return JSON.stringify(keys) === JSON.stringify(wanted) && record.event === spec.event && wanted.filter((key) => key !== 'event').every((key) => spec[key].includes(record[key]));
  };
  const unmatched = [...supported];
  const unsupported = events.filter((record) => {
    const at = unmatched.findIndex((spec) => fits(record, spec));
    if (at < 0) return true;
    unmatched.splice(at, 1);
    return false;
  });
  assert.deepEqual({ unsupported, unmatched }, { unsupported: [], unmatched: [] }, `the exit's events differ from those its reads support: ${JSON.stringify(events)}`);
  for (const record of events.filter(({ pid }) => pid !== undefined)) {
    if (record.name === undefined && record.cmd === undefined) continue;
    const returned = exit.identities.get(record.pid);
    assert.ok(returned?.names.has(record.name) && returned.commands.has(record.cmd), `an identity no read returned was recorded: ${JSON.stringify(record)}`);
  }
  const ended = events.filter(({ event }) => event === 'survivor.killed').map(({ pid }) => pid).sort();
  const unended = new Set(events.filter(({ event }) => event === 'survivor.unended').map(({ pid }) => pid));
  assert.deepEqual(ended, exit.unnamed ? [] : exit.named.filter((pid) => !unended.has(pid)).sort(), 'the named kills differ from what the read by pid returned');
  if (exit.postKill?.timedOutBefore) assert.notEqual(exit.postKill.kind, 'answered', 'a post-kill read answered through a ps already timed out');
  const trace = existsSync(join(directory, 'sighted-ps.log')) ? read(directory, 'sighted-ps.log') : '';
  const result = { directory, events, group, two: pidIn(directory, 'two'), trace, exit };
  exitCutoffs.add(directory);
  exitCutoffs.add(events);
  return result;
}

/** Confirms a refused prepared root leaves no fixture scratch or caller process to account for. */
async function deniedPreparedRoot(t, explicit, suite) {
  const prior = {
    explicit: process.env.C615_SIGHTING_EVIDENCE_ROOT,
    suite: process.env.C615_EVIDENCE_ROOT,
  };
  const assign = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  assert.ok(process.env.TMPDIR, 'a prepared-root refusal needs the suite scratch root');
  const priorTmpdir = process.env.TMPDIR;
  const isolated = temporaryDirectory('c615-refused-root-', { context: t });
  try {
    process.env.TMPDIR = isolated;
    const sentinel = temporaryDirectory('c615-refused-sentinel-', { context: t });
    assert.equal(resolve(sentinel, '..'), resolve(isolated), 'the refusal scratch root did not follow TMPDIR');
    const before = readdirSync(isolated).sort();
    assign('C615_SIGHTING_EVIDENCE_ROOT', explicit);
    assign('C615_EVIDENCE_ROOT', suite);
    await assert.rejects(censusExit(t, 'U2'), /prepared sighting needs private returned-read originals/);
    assert.deepEqual(readdirSync(isolated).sort(), before, 'a refused root started fixture scratch');
  } finally {
    process.env.TMPDIR = priorTmpdir;
    assign('C615_SIGHTING_EVIDENCE_ROOT', prior.explicit);
    assign('C615_EVIDENCE_ROOT', prior.suite);
  }
}

/** Retains a rejected root input and the pre-process scratch made by the exit fixture. */
async function deniedPreparedRootType(t, route, kind = 'file') {
  const prior = {
    explicit: process.env.C615_SIGHTING_EVIDENCE_ROOT,
    suite: process.env.C615_EVIDENCE_ROOT,
  };
  const root = realpathSync.native(prior.suite || prior.explicit);
  const checkout = realpathSync.native(process.cwd());
  const priorTmpdir = process.env.TMPDIR;
  const scratch = realpathSync.native(temporaryDirectory('c615-refused-type-', { context: t }));
  process.env.TMPDIR = scratch;
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && root !== scratch && !root.startsWith(`${scratch}/`) && (lstatSync(root).mode & 0o077) === 0,
    'the type refusal needs a private outer evidence root');
  const attempt = join(root, `root-type-${randomUUID()}`);
  mkdirSync(attempt, { mode: 0o700 });
  let selected = join(attempt, 'selected-file');
  if (kind === 'symlink') {
    const destination = join(attempt, 'valid-directory');
    mkdirSync(destination, { mode: 0o700 });
    symlinkSync(destination, selected);
    assert.equal(realpathSync.native(selected), destination, 'the selected link did not target the valid directory');
    assert.ok(lstatSync(selected).isSymbolicLink(), 'the selected root was not a link');
  } else if (kind === 'file') {
    writeFileSync(selected, '', { flag: 'wx', mode: 0o600 });
    assert.ok(lstatSync(selected).isFile(), 'the selected root was not a regular file');
  } else if (kind === 'checkout') {
    selected = checkout;
  } else if (kind === 'nested') {
    selected = scratch;
  } else if (kind === 'mode') {
    mkdirSync(selected, { mode: 0o700 });
    chmodSync(selected, 0o755);
    assert.equal(lstatSync(selected).mode & 0o077, 0o055, 'the selected root does not expose group/other mode bits');
  } else if (kind === 'access') {
    mkdirSync(selected, { mode: 0o700 });
    chmodSync(selected, 0o500);
    assert.equal(lstatSync(selected).mode & 0o077, 0, 'the selected root is not private');
  } else if (kind === 'absent') {
    assert.equal(existsSync(selected), false, 'the selected root unexpectedly exists');
  } else if (kind === 'lstat-error' || kind === 'realpath-error'
    || kind === 'checkout-error' || kind === 'scratch-error') {
    mkdirSync(selected, { mode: 0o700 });
    sightingRootFaults.set(selected, kind);
  } else {
    assert.fail(`unknown refused-root fixture: ${kind}`);
  }
  const before = new Set(readdirSync(scratch));
  let refusal;
  try {
    if (route === 'explicit') {
      process.env.C615_SIGHTING_EVIDENCE_ROOT = selected;
      process.env.C615_EVIDENCE_ROOT = root;
    } else {
      delete process.env.C615_SIGHTING_EVIDENCE_ROOT;
      process.env.C615_EVIDENCE_ROOT = selected;
    }
    try { await censusExit(t, 'U2'); }
    catch (error) { refusal = error; }
  } finally {
    try {
      sightingRootFaults.delete(selected);
      if (kind === 'access') chmodSync(selected, 0o700);
      const added = readdirSync(scratch).filter((name) => !before.has(name));
      writeFileSync(join(attempt, 'refusal.json'), JSON.stringify({ route, scratchEntries: added.length }) + '\n', { flag: 'wx', mode: 0o600 });
      if (added.length === 1) cpSync(join(scratch, added[0]), join(attempt, 'scratch'), { recursive: true, force: false, errorOnExist: true });
    } finally {
      if (priorTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = priorTmpdir;
      if (prior.explicit === undefined) delete process.env.C615_SIGHTING_EVIDENCE_ROOT;
      else process.env.C615_SIGHTING_EVIDENCE_ROOT = prior.explicit;
      if (prior.suite === undefined) delete process.env.C615_EVIDENCE_ROOT;
      else process.env.C615_EVIDENCE_ROOT = prior.suite;
    }
  }
  assert.deepEqual(readdirSync(join(attempt, 'scratch')).sort(), ['hold'], 'the refused root allowed a fixture process or script to start');
  assert.match(refusal?.message ?? '', kind === 'absent' ? /ENOENT/ : kind.endsWith('-error') ? /forced .* failure/ : kind === 'access' ? /EACCES/ : kind === 'mode' || kind === 'checkout' || kind === 'nested'
    ? /the sighting evidence root must be private/ : /the sighting evidence root is unsafe/, 'the selected root did not produce the required refusal');
}

/** The ordered arguments and response rows of the stand-in's complete read log. */
function sightingReads(trace) {
  return trace.split(/(?=READ )/).filter(Boolean).map((block) => {
    const [first, ...rows] = block.trimEnd().split('\n');
    return { args: first.slice(5), rows };
  });
}

/** Binds every prepared log block to one complete, ordered outer returned read. */
function completePreparedSightingReads(directory, trace) {
  const original = readFileSync(join(directory, 'sighted-ps.log'), 'utf8');
  assert.ok(trace === original || trace === original.trim(),
    'prepared sighting log differs from the consumed trace');
  assert.ok(original.endsWith('\n'), 'prepared sighting log is partial');
  const lines = original.slice(0, -1).split('\n');
  const blocks = [];
  for (let at = 0; at < lines.length;) {
    const read = lines[at++];
    assert.match(read, /^READ .+$/, 'prepared sighting READ is missing or malformed');
    const phase = lines[at++];
    assert.match(phase, /^PHASE (before-kill|after-kill)$/, 'prepared sighting PHASE is missing or malformed');
    const rows = [];
    while (at < lines.length && lines[at].startsWith('ROW ')) rows.push(lines[at++].slice(4));
    assert.ok(rows.length > 0, 'prepared sighting ROW is missing');
    const id = `r${String(blocks.length + 1).padStart(6, '0')}`;
    assert.equal(lines[at++], 'END', `prepared read ${id} END is missing or malformed`);
    blocks.push({ args: read.slice(5), phase: phase.slice(6), stdout: rows.join('\n') + '\n' });
  }
  const readRoot = join(directory, 'sighting-reads');
  const raw = readFileSync(join(readRoot, 'trace.jsonl'), 'utf8');
  assert.ok(raw.endsWith('\n'), 'prepared outer read trace is partial');
  const records = raw.slice(0, -1).split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, blocks.length * 2, 'prepared log and outer read counts differ');
  const files = new Set(['trace.jsonl']);
  const tool = join(directory, 'ps-sighted');
  blocks.forEach((block, index) => {
    const start = records[2 * index];
    const end = records[2 * index + 1];
    const id = `r${String(index + 1).padStart(6, '0')}`;
    assert.equal(start.kind, 'start', `prepared read ${id} has no start`);
    assert.equal(end.kind, 'end', `prepared read ${id} did not return`);
    assert.equal(start.id, id);
    assert.equal(end.id, id);
    assert.equal(start.tool, tool);
    assert.ok(Array.isArray(start.argv) && start.argv.every((arg) => typeof arg === 'string'));
    assert.equal(start.argv.join(' '), block.args, `prepared read ${id} argv differs from log`);
    assert.equal(start.callerExitMarked, true);
    assert.ok(BigInt(end.endedNs) >= BigInt(start.startedNs), `prepared read ${id} ended before start`);
    if (index > 0) assert.ok(BigInt(start.startedNs) >= BigInt(records[2 * index - 1].endedNs), `prepared read ${id} began before its predecessor ended`);
    assert.equal(end.status, 0, `prepared read ${id} failed`);
    assert.equal(end.error, null, `prepared read ${id} returned an error`);
    assert.equal(end.signal, null, `prepared read ${id} was interrupted`);
    assert.equal(end.returnedStreams, 'settled-return', `prepared read ${id} returned partial streams`);
    for (const stream of ['stdout', 'stderr']) {
      const value = end[stream];
      const file = `${id}.${stream}.utf8`;
      assert.equal(value?.present, true, `prepared read ${id} ${stream} was absent`);
      assert.equal(value.type, 'string', `prepared read ${id} ${stream} was not a string`);
      assert.equal(value.file, file, `prepared read ${id} ${stream} original was misnamed`);
      const bytes = readFileSync(join(readRoot, file));
      files.add(file);
      assert.equal(value.bytes, bytes.length, `prepared read ${id} ${stream} byte count changed`);
      assert.equal(value.sha256, createHash('sha256').update(bytes).digest('hex'), `prepared read ${id} ${stream} digest changed`);
      assert.deepEqual(bytes, Buffer.from(stream === 'stdout' ? block.stdout : ''),
        `prepared read ${id} ${stream} differed from the complete log answer`);
    }
  });
  assert.deepEqual(new Set(readdirSync(readRoot)), files, 'prepared outer read file inventory differs');
}

/** Requires one settled outer answer with the exact read ID, argv and returned strings. */
function answeredSightingRead(directory, trace, argv, phase, occurrence = 0) {
  completePreparedSightingReads(directory, trace);
  const records = linesOf(directory, 'sighting-reads/trace.jsonl');
  const tool = join(directory, 'ps-sighted');
  const reads = sightingReads(trace);
  const matches = reads.flatMap((row, index) => row.args === argv.join(' ') && row.rows.includes(`PHASE ${phase}`) ? [index] : []);
  assert.ok(matches.length > occurrence, `no ${phase} fixture response at occurrence ${occurrence} with exact argv`);
  const index = matches[occurrence];
  const expected = reads[index].rows.filter((row) => row.startsWith('ROW ')).map((row) => row.slice(4)).join('\n') + '\n';
  const start = records[2 * index];
  assert.equal(start.kind, 'start');
  assert.equal(start.tool, tool);
  assert.deepEqual(start.argv, argv);
  assert.equal(start.id, `r${String(index + 1).padStart(6, '0')}`);
  assert.equal(start.callerExitMarked, true, 'the sighting read began before caller exit');
  const ends = records.filter((row) => row.id === start.id && row.kind !== 'start');
  assert.equal(ends.length, 1, `outer read ${start.id} did not settle exactly once`);
  const [end] = ends;
  assert.equal(end.kind, 'end');
  assert.equal(end.status, 0);
  assert.equal(end.error, null);
  assert.equal(end.signal, null);
  assert.equal(end.returnedStreams, 'settled-return');
  assert.ok(BigInt(end.endedNs) >= BigInt(start.startedNs), 'the outer read ended before it started');
  const returned = (name) => {
    const value = end[name];
    assert.equal(value?.present, true);
    assert.equal(value.type, 'string');
    assert.ok(typeof value.file === 'string');
    const bytes = readFileSync(join(directory, 'sighting-reads', value.file));
    assert.equal(bytes.length, value.bytes, `outer read ${start.id} ${name} byte count changed`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), value.sha256, `outer read ${start.id} ${name} digest changed`);
    return bytes.toString('utf8');
  };
  const stdout = returned('stdout');
  assert.ok(stdout.length > 0, `outer read ${start.id} returned no state rows`);
  assert.equal(returned('stderr'), '', `outer read ${start.id} returned stderr`);
  assert.equal(stdout, expected, `outer read ${start.id} differs from the completed fixture response`);
  return { start, end, stdout };
}

/** Requires an answered post-kill read that omitted the target, not just a fixture label. */
function assertPostKillOmission(trace, group, two, path) {
  const args = `-g ${group} -o pid=,stat=${path === 'exit' ? ',xstat=' : ''}`;
  const after = sightingReads(trace).filter(({ args: readArgs, rows }) => readArgs === args && rows.includes('PHASE after-kill'));
  assert.ok(after.length > 0, `no post-kill response for the omitted member: ${trace}`);
  assert.ok(after.every(({ rows }) => rows.every((row) => !new RegExp(`^ROW\\s+${two}(?:\\s|$)`).test(row))), `a post-kill response listed the omitted member: ${trace}`);
}

/** Guards the first census round's distinct read positions for `cell`. */
function assertSighting(trace, two, cell) {
  const reads = sightingReads(trace);
  const states = reads.filter(({ args }) => args.startsWith('-ww -g ') && args.endsWith('pid=,stat='));
  const commands = reads.filter(({ args }) => args.startsWith('-ww -g ') && args.endsWith('pid=,command='));
  const has = ({ rows }) => rows.some((line) => new RegExp(`^ROW\\s+${two} `).test(line));
  const expected = {
    B: { states: [true, false], commands: [true, true], name: true },
    U1: { states: [true, false], commands: [true, true], name: false },
    U2: { states: [true, false], commands: [true, false], name: true },
    A: { states: [false, true, false], commands: [false, false] },
    C1: { states: [false, false], commands: [true, false] },
    C2: { states: [false, false], commands: [false, true] },
    N: { states: [false, false], commands: [false, false] },
    X: { states: [true, false, false], commands: [true, true], name: true },
  }[cell];
  assert.ok(expected, `unknown census cell ${cell}`);
  assert.deepEqual(states.slice(0, expected.states.length).map(has), expected.states, `wrong state-read positions for ${cell}: ${trace}`);
  assert.deepEqual(commands.slice(0, expected.commands.length).map(has), expected.commands, `wrong command-read positions for ${cell}: ${trace}`);
  const name = reads.find(({ args, rows }) => args === `-p ${two} -o ucomm=` && !rows.includes('PHASE after-kill'));
  if (expected.name === true) assert.ok(name?.rows.some((row) => row.startsWith('ROW ') && row !== 'ROW '), `no name read for ${cell}: ${trace}`);
  if (expected.name === false) assert.deepEqual(name?.rows, ['FAIL 1 empty'], `the name read did not omit the member: ${trace}`);
  if (expected.name === undefined) assert.equal(name, undefined, `the census named a member no before-state read showed: ${trace}`);
}

// proves R-STATE-12
test('B0 call: a member named by the first census round remains recorded after later reads omit it', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusCall(t, 'B');
  assert.ok(existsSync(join(directory, 'sighted-next-stat')), 'no later census state read omitted the member');
  assertSighting(trace, two, 'B');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('G3: an unseen group round without accepted members reaches a cut and an unnamed group result', SETTLES_WITHIN, async (t) => {
  const directory = realpathSync(temporaryDirectory('rigger-g3-', { context: t, beforeRemoval: () => {
    writeFileSync(join(directory, 'release'), '');
    const pid = pidIn(directory, 'group');
    if (pid !== undefined) assert.equal(alive(pid), false, 'the observed group leader survived finalization');
  } }));
  fixture(directory, 'command', 'echo $$ > "$here/group.pid"\n: > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');
  fixture(directory, 'ps', [
    'printf "%s\\n" "$*" >> "$here/group-reads"',
    'if [ -f "$here/hang" ]; then printf "%s\\n" "$*" >> "$here/post-kill-reads"; fi',
    'case "$*" in "-ww -g "*" -o pid=,stat=")',
    '  count=$(/bin/cat "$here/census-state-count" 2>/dev/null || printf 0)',
    '  count=$((count + 1))',
    '  printf "%s" "$count" > "$here/census-state-count"',
    '  if [ "$count" -eq 2 ]; then : > "$here/group-clock-cut"; exit 1; fi',
    '  ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  try {
    const { status, stderr, events } = await cleanedUpBy(GROUP_LATE_CALLER, directory, { ps: 'ps', hangAfter: 'group' });
    const group = pidIn(directory, 'group');
    assert.equal(status, 0, stderr);
    assert.ok(Number.isSafeInteger(group) && group > 0, 'the group leader did not record its PID');
    assert.equal(existsSync(join(directory, 'group-reads')), true, 'the process-table fixture recorded no reads');
    const state = `-ww -g ${group} -o pid=,stat=`;
    const command = `-ww -g ${group} -o pid=,command=`;
    const reads = read(directory, 'group-reads').split('\n');
    const postKillReads = read(directory, 'post-kill-reads').split('\n');
    assert.deepEqual(reads.slice(-postKillReads.length), postKillReads, 'post-kill reads were not the final group reads');
    const round = reads.slice(0, -postKillReads.length).filter((args) => args === state || args === command || args === `-p ${group} -o ucomm=`);
    const pairs = linesOf(directory, 'pairs');
    const firstKill = pairs.findIndex(([target, signal]) => target === -group && signal === 'SIGKILL');
    const afterKill = pairs.slice(firstKill + 1);
    const groupEvents = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);

    assert.deepEqual(round, [state, command, `-p ${group} -o ucomm=`, command, state], 'the unseen round did not complete C1–C5');
    assert.equal(read(directory, 'census-state-count'), '2', 'a second round read started after the rejected first round');
    assert.equal(existsSync(join(directory, 'group-clock-cut')), true, 'the empty C5 answer was not returned');
    assert.equal(existsSync(join(directory, 'group-clock-jump')), true, 'the next C1 was not cut before spawning');
    assert.ok(firstKill >= 0, 'the group kill was not reached');
    assert.ok(afterKill.some(([target, signal]) => target === -group && signal === 0), 'G3 first post-kill probe did not reach O');
    assert.ok(postKillReads.includes(`-g ${group} -o pid=,stat=,xstat=`), 'O did not reach its post-kill group read');
    assert.equal(groupEvents.length, 1, 'the rejected round was not recorded once as a group result');
    assert.match(groupEvents[0].census, /the census's reads named no process of the group while it still had one: .*did not finish within 1000 ms/);
    assert.deepEqual(events.filter(({ pid }) => pid !== undefined), [], 'an unseen member was recorded by pid or name');
  } finally {
    writeFileSync(join(directory, 'release'), '');
    const pid = pidIn(directory, 'group');
    if (pid !== undefined) assert.equal(await gone(pid), true, 'the observed group leader did not leave after release');
  }
});

// proves R-STATE-9
test('G3: a retained group round survives an unseen round and the next read cut', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*" -o pid=,stat=")',
    '  count=$(/bin/cat "$here/census-state-count" 2>/dev/null || printf 0)',
    '  count=$((count + 1))',
    '  printf "%s" "$count" > "$here/census-state-count"',
    '  case "$count" in',
    ("    1) " + shellQuote(PS) + " \"$@\" | /usr/bin/awk 'NR == 1 { $2 = \"?\" } { print }'; exit 0 ;;"),
    '    4) : > "$here/group-clock-cut"; exit 1 ;;',
    '  esac ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, stderr, events } = await cleanedUpBy(GROUP_LATE_CALLER, directory, { ps: 'ps' });
  const group = pidIn(directory, 'group');
  const one = pidIn(directory, 'one');
  const two = pidIn(directory, 'two');
  const pairs = linesOf(directory, 'pairs');

  assert.equal(status, 0, stderr);
  assert.equal(existsSync(join(directory, 'census-state-count')), true, 'the first group census read was not reached');
  assert.equal(read(directory, 'census-state-count'), '4', 'two complete group rounds were not reached');
  assert.equal(existsSync(join(directory, 'group-clock-jump')), true, 'the next group read was not cut');
  assert.ok(groupKills(pairs, group) > 0, 'the group kill was not reached');
  for (const pid of [one, two]) {
    assert.deepEqual(events.filter((event) => event.pid === pid).map(({ event, name, cmd }) => ({ event, name, cmd })), [
      { event: 'survivor.killed', ...tailOf(directory) },
    ]);
  }
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
});

// proves R-STATE-12, R-STATE-19
test('U1 call: a census name read that omits a shown member records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'U1');
  assertSighting(trace, two, 'U1');
  assert.deepEqual(recordOf(events, two), [], 'an incomplete identity was recorded as named');
  assert.match(events.find(({ event, group: id }) => event === 'group.killed' && id === group)?.census ?? '', /complete name and command line were unavailable/);
});

/** Asserts the member has no invented identity and the group has one reasoned kill record. */
function assertUnnamedSighting(events, group, two) {
  assert.deepEqual(recordOf(events, two), [], 'an incomplete identity was recorded as named');
  const found = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
  assert.equal(found.length, 1, `the group kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(found[0].census, /complete name and command line were unavailable/);
}

/** Runs and verifies a member whose census sighting supplied no complete identity. */
async function unnamedCensusCell(t, path, cell, afterKill = 'omit') {
  const { events, group, two, trace } = await (path === 'call' ? censusCall(t, cell, afterKill) : censusExit(t, cell, afterKill));
  if (exitCutoffs.has(events)) return;
  assertSighting(trace, two, cell);
  if (afterKill === 'omit') assertPostKillOmission(trace, group, two, path);
  if (afterKill === 'zombie') {
    assert.ok(processState(two).startsWith('Z'), `the member was not left a zombie: ${processState(two)}`);
    assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  }
  assertUnnamedSighting(events, group, two);
}

// proves R-STATE-12, R-STATE-19
test('U2 call: a missing second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'U2');
  assertSighting(trace, two, 'U2');
  assertUnnamedSighting(events, group, two);
});

// proves R-STATE-12, R-STATE-19
test('U1 exit: a census name read that omits a shown member records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'U1');
});

// proves R-STATE-12, R-STATE-19
test('U2 exit: a missing second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'U2');
});

test('C615 fixture-root-empty-explicit denies before preparation starts', SETTLES_WITHIN, async (t) => {
  assert.ok(process.env.C615_EVIDENCE_ROOT, 'the explicit-empty test needs a valid suite root to challenge fallback');
  await deniedPreparedRoot(t, '', process.env.C615_EVIDENCE_ROOT);
});

test('C615 fixture-root-absent-both denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRoot(t, undefined, undefined);
});

test('C615 fixture-root-empty-suite denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRoot(t, undefined, '');
});

test('C615 fixture-root-type-explicit denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit');
});

test('C615 fixture-root-type-suite denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite');
});

test('C615 fixture-root-symlink-explicit denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'symlink');
});

test('C615 fixture-root-symlink-suite denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'symlink');
});

test('C615 fixture-root-location-explicit-checkout denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'checkout');
});

test('C615 fixture-root-location-suite-checkout denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'checkout');
});

test('C615 fixture-root-location-explicit-nested denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'nested');
});

test('C615 fixture-root-location-suite-nested denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'nested');
});

test('C615 fixture-root-mode-explicit denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'mode');
});

test('C615 fixture-root-mode-suite denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'mode');
});

test('C615 fixture-root-access-explicit denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'access');
});

test('C615 fixture-root-access-suite denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'access');
});

test('C615 fixture-root-canonical-explicit-absent denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'absent');
});

test('C615 fixture-root-canonical-suite-absent denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'absent');
});

test('C615 fixture-root-canonical-explicit-lstat-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'lstat-error');
});

test('C615 fixture-root-canonical-suite-lstat-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'lstat-error');
});

test('C615 fixture-root-canonical-explicit-realpath-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'realpath-error');
});

test('C615 fixture-root-canonical-suite-realpath-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'realpath-error');
});

test('C615 fixture-root-canonical-explicit-checkout-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'checkout-error');
});

test('C615 fixture-root-canonical-suite-checkout-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'checkout-error');
});

test('C615 fixture-root-canonical-explicit-scratch-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'explicit', 'scratch-error');
});

test('C615 fixture-root-canonical-suite-scratch-error denies before preparation starts', SETTLES_WITHIN, async (t) => {
  await deniedPreparedRootType(t, 'suite', 'scratch-error');
});

/** Requires either selected root route to retain its own complete attempt without overwriting prior bytes. */
async function validPreparedRoot(t, route) {
  assert.ok(route === 'explicit' || route === 'suite', 'unknown valid-root route');
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  const selected = join(outer, `root-${route}-${randomUUID()}`);
  mkdirSync(selected, { mode: 0o700 });
  const marker = join(selected, 'preexisting');
  writeFileSync(marker, 'untouched', { flag: 'wx', mode: 0o600 });
  const prior = { explicit: process.env.C615_SIGHTING_EVIDENCE_ROOT, suite: process.env.C615_EVIDENCE_ROOT };
  try {
    if (route === 'explicit') process.env.C615_SIGHTING_EVIDENCE_ROOT = selected;
    else {
      delete process.env.C615_SIGHTING_EVIDENCE_ROOT;
      process.env.C615_EVIDENCE_ROOT = selected;
    }
    const { directory } = await censusExit(t, 'U2');
    const observation = sightingAttempts.get(directory);
    assert.equal(observation?.root, selected, 'the requested root was not selected');
    assert.equal(observation.target, join(selected, `attempt-${observation.id}`));
    assert.deepEqual(readdirSync(selected).sort(), ['preexisting', `attempt-${observation.id}`].sort(), 'the selected root reused or overwrote an attempt');
    assert.equal(readFileSync(marker, 'utf8'), 'untouched', 'the selected root overwrote its prior entry');
    assert.equal(observation.snapshotReport?.copy, 'byte-complete-at-snapshot');
  } finally {
    if (prior.explicit === undefined) delete process.env.C615_SIGHTING_EVIDENCE_ROOT;
    else process.env.C615_SIGHTING_EVIDENCE_ROOT = prior.explicit;
    if (prior.suite === undefined) delete process.env.C615_EVIDENCE_ROOT;
    else process.env.C615_EVIDENCE_ROOT = prior.suite;
  }
}

test('C615 fixture-root-explicit retains a separate private attempt', SETTLES_WITHIN, async (t) => {
  await validPreparedRoot(t, 'explicit');
});

test('C615 fixture-root-suite retains a separate private attempt', SETTLES_WITHIN, async (t) => {
  await validPreparedRoot(t, 'suite');
});

/** Checks each accepted cache byte against the complete original from its own real preparatory read. */
function assertPreparedCache(retained, cell) {
  const prepared = join(retained, 'sighting-prepared');
  const ids = ['group', 'one', 'two'].map((name) => Number(readFileSync(join(retained, `${name}.pid`), 'utf8')));
  assert.equal(new Set(ids).size, 3, 'the prepared PIDs were not distinct');
  const expectedArgv = [
    ...ids.map((pid) => ['-p', String(pid), '-o', 'lstart=']),
    ['-ww', '-g', String(ids[0]), '-o', 'pid=,stat='],
    ['-ww', '-g', String(ids[0]), '-o', 'pid=,command='],
    ...ids.map((pid) => ['-p', String(pid), '-o', 'ucomm=']),
    ...ids.map((pid) => ['-p', String(pid), '-o', 'lstart=']),
    ['-ww', '-g', String(ids[0]), '-o', 'pid=,stat='],
  ];
  const records = expectedArgv.map((argv, index) => {
    const id = String(index + 1).padStart(3, '0');
    const start = JSON.parse(readFileSync(join(prepared, `${id}.start.json`), 'utf8'));
    const end = JSON.parse(readFileSync(join(prepared, `${id}.json`), 'utf8'));
    assert.equal(start.source, ('real-' + PS), `preparation read ${id} was not the real tool`);
    assert.equal(end.source, ('real-' + PS), `preparation return ${id} was not the real tool`);
    assert.equal(start.clockSource, 'real-monotonic-clock', `preparation read ${id} used a synthetic clock`);
    assert.equal(end.clockSource, 'real-monotonic-clock', `preparation return ${id} used a synthetic clock`);
    assert.equal(start.tool, PS, `preparation read ${id} did not identify its tool`);
    assert.equal(end.tool, PS, `preparation return ${id} did not identify its tool`);
    assert.deepEqual(start.args, argv, `preparation read ${id} used different argv`);
    assert.deepEqual(end.args, argv, `preparation return ${id} used different argv`);
    assert.equal(end.status, 0, `preparation read ${id} failed`);
    assert.equal(end.error, null, `preparation read ${id} returned an error`);
    assert.equal(end.signal, null, `preparation read ${id} was interrupted`);
    assert.ok(start.timeout > 0 && start.timeout <= 500, `preparation read ${id} exceeded its 500 ms admission timeout`);
    assert.ok(BigInt(end.endedNs) >= BigInt(start.startedNs), `preparation read ${id} ended before start`);
    assert.ok(BigInt(end.endedNs) - BigInt(start.startedNs) <= BigInt(start.timeout) * 1_000_000n,
      `preparation read ${id} exceeded its actual admission deadline`);
    const returned = {};
    for (const stream of ['stdout', 'stderr']) {
      assert.equal(end.streams[stream].type, 'string', `preparation read ${id} had no returned ${stream}`);
      assert.equal(end.streams[stream].file, `${id}.${stream}.utf8`);
      returned[stream] = readFileSync(join(prepared, end.streams[stream].file), 'utf8');
    }
    assert.equal(returned.stderr, '', `preparation read ${id} returned stderr`);
    assert.ok(returned.stdout.length > 0, `preparation read ${id} returned no required answer`);
    return { start, end, ...returned };
  });
  assert.ok(BigInt(records.at(-1).end.endedNs) - BigInt(records[0].start.startedNs) <= 6_000_000_000n,
    'the prepared answer exceeded its six-second admission deadline');
  assert.equal(readFileSync(join(retained, 'sighting-cache.state'), 'utf8'), records[3].stdout);
  assert.equal(readFileSync(join(retained, 'sighting-cache.command'), 'utf8'), records[4].stdout);
  ids.forEach((pid, index) => {
    assert.equal(readFileSync(join(retained, `sighting-cache.name.${pid}`), 'utf8'), records[5 + index].stdout,
      `prepared name for ${pid} differs from its returned original`);
    assert.equal(readFileSync(join(retained, `sighting-cache.birth.${pid}`), 'utf8'), records[index].stdout.replace(/\n$/, ''),
      `prepared start text for ${pid} differs from its first return`);
    assert.equal(records[8 + index].stdout, records[index].stdout, `prepared start text for ${pid} changed`);
  });
  assert.deepEqual(new Set(readdirSync(prepared).filter((name) => name.endsWith('.start.json'))),
    new Set(expectedArgv.map((_, index) => `${String(index + 1).padStart(3, '0')}.start.json`)));
  assert.equal(readFileSync(join(retained, 'sighting-cache.ready'), 'utf8'), '');
  const minimumReads = {
    B: { state: 2, command: 2 },
    U2: { state: 2, command: 2 },
    A: { state: 3, command: 2 },
  }[cell];
  assert.ok(minimumReads, `unknown prepared cache cell ${cell}`);
  const group = ids[0];
  const target = ids[2];
  const count = { state: 0, command: 0 };
  const log = readFileSync(join(retained, 'sighted-ps.log'), 'utf8');
  assert.ok(log.endsWith('\n'), 'the consumed fixture log is partial');
  for (const block of sightingReads(log).filter(({ rows }) => rows.includes('PHASE before-kill'))) {
    let source;
    let cut = false;
    if (block.args === `-ww -g ${group} -o pid=,stat=`) {
      cut = cell === 'A' ? count.state !== 1 : count.state > 0;
      count.state++;
      source = records[3].stdout;
    } else if (block.args === `-ww -g ${group} -o pid=,command=`) {
      cut = cell === 'A' || count.state >= 2 || (cell === 'U2' && count.command > 0);
      count.command++;
      source = records[4].stdout;
    } else {
      const name = /^-p (\d+) -o ucomm=$/.exec(block.args);
      if (name) {
        const index = ids.indexOf(Number(name[1]));
        assert.ok(index >= 0, 'a prepared name read used an unknown PID');
        source = records[5 + index].stdout;
      }
    }
    if (source === undefined) continue;
    const sourceRows = source.replace(/\n+$/, '').split('\n');
    const expectedRows = cut ? sourceRows.filter((row) => !new RegExp(`^\\s*${target}(?:\\s|$)`).test(row)) : sourceRows;
    const observedRows = block.rows.filter((row) => row.startsWith('ROW ')).map((row) => row.slice(4));
    assert.deepEqual(observedRows, expectedRows,
      `consumed cached answer differed from its preparatory original: ${block.args}`);
  }
  assert.ok(count.state >= minimumReads.state, 'the prepared state cache read count changed');
  assert.ok(count.command >= minimumReads.command, 'the prepared command cache read count changed');
  return { ids, records };
}

test('C615 fixture-preparation-valid binds the private cache to actual ps returns', SETTLES_WITHIN, async (t) => {
  const { directory } = await censusExit(t, 'U2');
  if (exitCutoffs.has(directory)) return;
  const observation = sightingAttempts.get(directory);
  const retained = join(observation.target, 'settled', 'fixture');
  const { ids, records } = assertPreparedCache(retained, 'U2');
  assert.equal(ids.length, 3);
  assert.equal(records.length, 12);
});

test('C615 fixture-cache-binding rejects a consumed value different from its preparatory original', SETTLES_WITHIN, async (t) => {
  const { directory } = await censusExit(t, 'U2');
  if (exitCutoffs.has(directory)) return;
  const observation = sightingAttempts.get(directory);
  const original = join(observation.target, 'settled', 'fixture');
  const copy = join(observation.root, `cache-consumed-mismatch-${randomUUID()}`);
  cpSync(original, copy, { recursive: true, force: false, errorOnExist: true });
  const group = readFileSync(join(copy, 'group.pid'), 'utf8').trim();
  const state = readFileSync(join(copy, 'sighting-prepared', '004.stdout.utf8'), 'utf8');
  const row = state.split('\n').find((line) => new RegExp(`^\\s*${group}\\s`).test(line));
  assert.ok(row, 'the preparatory source had no group state row');
  const log = readFileSync(join(copy, 'sighted-ps.log'), 'utf8');
  const changed = log.replace(`ROW ${row}\n`, `ROW ${group} Q\n`);
  assert.notEqual(changed, log, 'the copied consumed row was not changed');
  writeFileSync(join(copy, 'sighted-ps.log'), changed);
  assert.equal(readFileSync(join(original, 'sighted-ps.log'), 'utf8'), log,
    'the mutation altered the complete private original');
  assert.throws(() => assertPreparedCache(copy, 'U2'), /consumed cached answer differed from its preparatory original/);
  const mutations = [
    { name: 'absent-state', file: 'sighting-cache.state', change: (file) => unlinkSync(file) },
    { name: 'incomplete-state', file: 'sighting-cache.state', change: (file) => {
      const value = readFileSync(file, 'utf8');
      writeFileSync(file, value.slice(0, -1));
    } },
    { name: 'mismatched-command', file: 'sighting-cache.command', change: (file) => writeFileSync(file, 'changed command\n') },
    { name: 'mismatched-name', file: `sighting-cache.name.${readFileSync(join(original, 'two.pid'), 'utf8').trim()}`,
      change: (file) => writeFileSync(file, 'different name\n') },
    { name: 'changed-preparation-original', file: 'sighting-prepared/004.stdout.utf8',
      change: (file) => writeFileSync(file, 'different preparatory return\n') },
    { name: 'absent-ready', file: 'sighting-cache.ready', change: (file) => unlinkSync(file) },
    { name: 'late-preparation-read', file: 'sighting-prepared/012.json',
      error: /preparation read 012 exceeded its actual admission deadline/,
      change: (file) => {
        const receipt = JSON.parse(readFileSync(file, 'utf8'));
        const first = JSON.parse(readFileSync(join(file, '..', '001.start.json'), 'utf8'));
        assert.equal(receipt.timeout, 500);
        const late = BigInt(receipt.startedNs) + 501_000_000n;
        assert.notEqual(receipt.endedNs, String(late), 'the late read was not forced');
        assert.ok(late - BigInt(first.startedNs) <= 6_000_000_000n, 'the control also exceeded the total deadline');
        receipt.endedNs = String(late);
        writeFileSync(file, JSON.stringify(receipt) + '\n');
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).endedNs, String(late));
      } },
  ];
  for (const mutation of mutations) {
    const candidate = join(observation.root, `cache-${mutation.name}-${randomUUID()}`);
    cpSync(original, candidate, { recursive: true, force: false, errorOnExist: true });
    mutation.change(join(candidate, mutation.file));
    assert.throws(() => assertPreparedCache(candidate, 'U2'), mutation.error,
      `${mutation.name}: a bad cache earned prepared credit`);
  }
});

/** Makes one private, labelled synthetic preparation input without starting a fixture process. */
function syntheticPreparationDirectory(name, ids = [42001, 42002, 42003]) {
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  const directory = join(outer, `preparation-${name}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'sighting-prepare'), '', { flag: 'wx', mode: 0o600 });
  ['group', 'one', 'two'].forEach((part, index) => {
    writeFileSync(join(directory, `${part}.pid`), String(ids[index]), { flag: 'wx', mode: 0o600 });
  });
  return directory;
}

test('C615 fixture-preparation-refusal denies a missing fixture state row', SETTLES_WITHIN, () => {
  const directory = syntheticPreparationDirectory('missing-row');
  const calls = [];
  const reader = (tool, argv) => {
    calls.push({ tool, argv });
    const stdout = argv.at(-1) === 'lstart=' ? 'Mon Oct 11 10:00:00 2026\n'
      : argv.at(-1) === 'pid=,stat=' ? '42001 S\n42002 S\n' : '';
    return { status: 0, signal: null, error: undefined, stdout, stderr: '' };
  };
  assert.throws(() => prepareSighting(directory, { reader }),
    /controlled group snapshot differed from its three fixture PIDs/);
  assert.equal(calls.length, 4, 'the missing-row return was not reached');
  assert.deepEqual(calls.map(({ tool }) => tool), Array(4).fill(PS));
  assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false, 'an invalid preparation became ready');
  const prepared = join(directory, 'sighting-prepared');
  for (let index = 1; index <= 4; index++) {
    const id = String(index).padStart(3, '0');
    const start = JSON.parse(readFileSync(join(prepared, `${id}.start.json`), 'utf8'));
    const end = JSON.parse(readFileSync(join(prepared, `${id}.json`), 'utf8'));
    assert.equal(start.source, 'synthetic-controlled-return');
    assert.equal(end.source, 'synthetic-controlled-return');
    assert.equal(end.streams.stdout.file, `${id}.stdout.utf8`);
    assert.equal(readFileSync(join(prepared, `${id}.stdout.utf8`), 'utf8'),
      index === 4 ? '42001 S\n42002 S\n' : 'Mon Oct 11 10:00:00 2026\n');
  }
});

test('C615 fixture-preparation-refusal denies invalid rows and start text', SETTLES_WITHIN, () => {
  const ids = [42001, 42002, 42003];
  const birth = 'Mon Oct 11 10:00:00 2026\n';
  const state = '42001 S\n42002 S\n42003 S\n';
  const command = '42001 /bin/sh\n42002 /bin/sh\n42003 /bin/sh\n';
  const answer = [birth, birth, birth, state, command, 'sh\n', 'sh\n', 'sh\n', birth, birth, birth, state];
  const argv = [
    ...ids.map((pid) => ['-p', String(pid), '-o', 'lstart=']),
    ['-ww', '-g', '42001', '-o', 'pid=,stat='],
    ['-ww', '-g', '42001', '-o', 'pid=,command='],
    ...ids.map((pid) => ['-p', String(pid), '-o', 'ucomm=']),
    ...ids.map((pid) => ['-p', String(pid), '-o', 'lstart=']),
    ['-ww', '-g', '42001', '-o', 'pid=,stat='],
  ];
  const cases = [
    { name: 'duplicate-state', index: 3, value: '42001 S\n42001 S\n42003 S\n', error: /snapshot differed/ },
    { name: 'zombie-state', index: 3, value: '42001 S\n42002 Z\n42003 S\n', error: /not live and running/ },
    { name: 'stopped-state', index: 3, value: '42001 S\n42002 T\n42003 S\n', error: /not live and running/ },
    { name: 'malformed-state', index: 3, value: '42001 S\nbad-row\n42003 S\n', error: /row is malformed/ },
    { name: 'omitted-command', index: 4, value: '42001 /bin/sh\n42002 /bin/sh\n', error: /snapshot differed/ },
    { name: 'empty-name', index: 6, value: ' \n', error: /name was empty/ },
    { name: 'empty-start', index: 0, value: '\n', error: /start value was empty/ },
    { name: 'changed-start', index: 9, value: 'Mon Oct 11 10:00:01 2026\n', error: /start value changed/ },
    { name: 'omitted-final-state', index: 11, value: '42001 S\n42002 S\n', error: /snapshot differed/ },
  ];
  for (const variant of cases) {
    const directory = syntheticPreparationDirectory(variant.name, ids);
    const expected = answer.with(variant.index, variant.value);
    let calls = 0;
    const reader = (tool, args) => {
      assert.equal(tool, PS, `${variant.name}: unexpected tool`);
      assert.deepEqual(args, argv[calls], `${variant.name}: unexpected read ${calls + 1}`);
      return { status: 0, signal: null, error: undefined, stdout: expected[calls++], stderr: '' };
    };
    assert.throws(() => prepareSighting(directory, { reader }), variant.error,
      `${variant.name}: invalid preparation was accepted`);
    assert.ok(calls > variant.index, `${variant.name}: forced return was not read`);
    assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false,
      `${variant.name}: invalid preparation became ready`);
    assert.deepEqual(readdirSync(directory).filter((name) => name.startsWith('sighting-cache.')), [],
      `${variant.name}: an invalid preparation wrote cache values`);
    const prepared = join(directory, 'sighting-prepared');
    for (let index = 0; index < calls; index++) {
      const id = String(index + 1).padStart(3, '0');
      const start = JSON.parse(readFileSync(join(prepared, `${id}.start.json`), 'utf8'));
      const end = JSON.parse(readFileSync(join(prepared, `${id}.json`), 'utf8'));
      assert.equal(start.source, 'synthetic-controlled-return');
      assert.equal(end.source, 'synthetic-controlled-return');
      assert.equal(start.tool, PS);
      assert.deepEqual(start.args, argv[index]);
      assert.deepEqual(end.args, argv[index]);
      assert.equal(readFileSync(join(prepared, `${id}.stdout.utf8`), 'utf8'), expected[index]);
      assert.equal(readFileSync(join(prepared, `${id}.stderr.utf8`), 'utf8'), '');
    }
  }
});

test('C615 fixture-read-refusal retains synthetic failed and incomplete returns', SETTLES_WITHIN, () => {
  const cases = [
    { name: 'failure', result: { status: 2, signal: null, error: undefined, stdout: 'partial\n', stderr: 'ps failed\n' }, error: /not a product-equivalent answer/ },
    { name: 'timeout', result: { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' }, stdout: 'partial\n', stderr: 'timed out\n' }, error: /not a product-equivalent answer/ },
    { name: 'missing-stdout', result: { status: 0, signal: null, error: undefined, stdout: undefined, stderr: '' }, error: /not a product-equivalent answer/ },
    { name: 'empty-stdout', result: { status: 0, signal: null, error: undefined, stdout: '', stderr: '' }, error: /contained no required row/ },
    { name: 'thrown-before-return', thrown: new Error('synthetic reader failed before return'), error: /threw before returning/ },
  ];
  for (const variant of cases) {
    const directory = syntheticPreparationDirectory(`read-${variant.name}`);
    let calls = 0;
    const reader = (tool, args) => {
      assert.equal(tool, PS);
      assert.deepEqual(args, ['-p', '42001', '-o', 'lstart=']);
      calls++;
      if (variant.thrown) throw variant.thrown;
      return variant.result;
    };
    assert.throws(() => prepareSighting(directory, { reader }), variant.error,
      `${variant.name}: rejected read was admitted`);
    assert.equal(calls, 1, `${variant.name}: unexpected follow-up read`);
    assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false,
      `${variant.name}: a failed read became ready`);
    const prepared = join(directory, 'sighting-prepared');
    const start = JSON.parse(readFileSync(join(prepared, '001.start.json'), 'utf8'));
    const end = JSON.parse(readFileSync(join(prepared, '001.json'), 'utf8'));
    assert.equal(start.source, 'synthetic-controlled-return');
    assert.equal(end.source, 'synthetic-controlled-return');
    assert.equal(start.tool, PS);
    assert.deepEqual(start.args, ['-p', '42001', '-o', 'lstart=']);
    for (const stream of ['stdout', 'stderr']) {
      const expected = variant.result?.[stream];
      const present = variant.result !== undefined && Object.hasOwn(variant.result, stream);
      assert.equal(end.streams[stream].present, present);
      assert.equal(end.streams[stream].type, !present ? 'absent' : expected === null ? 'null' : typeof expected);
      if (typeof expected === 'string') {
        assert.equal(end.streams[stream].file, `001.${stream}.utf8`);
        assert.equal(readFileSync(join(prepared, `001.${stream}.utf8`), 'utf8'), expected,
          `${variant.name}: partial returned ${stream} was lost`);
      } else assert.equal(end.streams[stream].file, null);
    }
    if (variant.thrown) assert.equal(end.error.name, 'Error');
  }
});

test('C615 fixture-read-refusal denies a synthetic deadline overrun after return', SETTLES_WITHIN, () => {
  const directory = syntheticPreparationDirectory('deadline');
  const ticks = [0n, 0n, 0n, 7_000_000_000n, 7_000_000_000n];
  const clock = () => ticks.shift() ?? 7_000_000_000n;
  let calls = 0;
  const reader = (tool, argv) => {
    assert.equal(tool, PS);
    assert.deepEqual(argv, ['-p', '42001', '-o', 'lstart=']);
    calls++;
    return { status: 0, signal: null, error: undefined,
      stdout: 'Mon Oct 11 10:00:00 2026\n', stderr: '' };
  };
  assert.throws(() => prepareSighting(directory, { reader, clock }), /exceeded its 6000 ms total bound/);
  assert.equal(calls, 1, 'the synthetic clock did not cut the first returned read');
  assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false);
  const prepared = join(directory, 'sighting-prepared');
  const start = JSON.parse(readFileSync(join(prepared, '001.start.json'), 'utf8'));
  const end = JSON.parse(readFileSync(join(prepared, '001.json'), 'utf8'));
  assert.equal(start.clockSource, 'synthetic-clock');
  assert.equal(end.clockSource, 'synthetic-clock');
  assert.equal(readFileSync(join(prepared, '001.stdout.utf8'), 'utf8'), 'Mon Oct 11 10:00:00 2026\n');
  assert.equal(readFileSync(join(prepared, '001.stderr.utf8'), 'utf8'), '');
});

test('C615 fixture-read-refusal retains a real ps omitted row after recorded fixture release', SETTLES_WITHIN, async (t) => {
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  const directory = join(outer, `preparation-real-omission-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'sighting-prepare'), '', { flag: 'wx', mode: 0o600 });
  const names = ['group', 'one', 'two'];
  const children = names.map((name) => {
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); process.stdin.resume(); process.stdin.once("end", () => process.exit(0));'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const record = { name, child, stdout: [], stderr: [], error: null };
    record.closed = new Promise((resolveClose) => child.once('close', (code, signal) => resolveClose({ code, signal })));
    child.once('error', (error) => { record.error = error.code ?? error.name; });
    child.stdout.on('data', (bytes) => record.stdout.push(Buffer.from(bytes)));
    child.stderr.on('data', (bytes) => record.stderr.push(Buffer.from(bytes)));
    writeFileSync(join(directory, `${name}.pid`), String(child.pid), { flag: 'wx', mode: 0o600 });
    return record;
  });
  let finalization;
  const finalize = () => finalization ??= (async () => {
    for (const { child } of children) if (!child.stdin.writableEnded) child.stdin.end();
    const results = await Promise.all(children.map(async ({ name, child, stdout, stderr, error, closed }) => {
      const close = await closed;
      writeFileSync(join(directory, `${name}.stdout`), Buffer.concat(stdout), { flag: 'wx', mode: 0o600 });
      writeFileSync(join(directory, `${name}.stderr`), Buffer.concat(stderr), { flag: 'wx', mode: 0o600 });
      return { name, pid: child.pid, ...close, error };
    }));
    const state = results.every(({ pid, code, signal, error }) => Number.isSafeInteger(pid) && pid > 0 && code === 0 && signal === null && !error) ? 'pass' : 'fail';
    writeFileSync(join(directory, 'finalizer.json'), JSON.stringify({ state, identities: results }) + '\n', { flag: 'wx', mode: 0o600 });
    return state;
  })();
  t.after(finalize);
  try {
    await until(() => children.every(({ stdout }) => Buffer.concat(stdout).includes(Buffer.from('ready\n'))), t);
    children[0].child.stdin.end();
    assert.deepEqual(await children[0].closed, { code: 0, signal: null }, 'the recorded group fixture did not close');
    assert.throws(() => prepareSighting(directory), /contained no required row/);
    assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false);
    const prepared = join(directory, 'sighting-prepared');
    const start = JSON.parse(readFileSync(join(prepared, '001.start.json'), 'utf8'));
    const end = JSON.parse(readFileSync(join(prepared, '001.json'), 'utf8'));
    assert.equal(start.source, ('real-' + PS));
    assert.equal(end.source, ('real-' + PS));
    assert.equal(start.tool, PS);
    assert.deepEqual(start.args, ['-p', String(children[0].child.pid), '-o', 'lstart=']);
    assert.equal(end.status, 1, 'the omitted row was not an actual no-row answer');
    assert.equal(end.error, null);
    assert.equal(end.signal, null);
    assert.equal(readFileSync(join(prepared, '001.stdout.utf8'), 'utf8'), '');
    assert.equal(readFileSync(join(prepared, '001.stderr.utf8'), 'utf8'), '');
  } finally {
    assert.equal(await finalize(), 'pass', 'a recorded fixture failed finalization');
  }
});

test('C615 fixture-outer-order rejects failed missing mismatched and reversed returned reads', SETTLES_WITHIN, async (t) => {
  const { directory, group, trace } = await censusExit(t, 'U2');
  if (exitCutoffs.has(directory)) return;
  const before = answeredSightingRead(directory, trace, ['-g', String(group), '-o', 'pid=,stat='], 'before-kill');
  const after = answeredSightingRead(directory, trace, ['-g', String(group), '-o', 'pid=,stat=,xstat='], 'after-kill');
  assert.notEqual(before.start.id, after.start.id, 'the outer answers reused one read ID');
  assert.ok(BigInt(after.start.startedNs) > BigInt(before.end.endedNs), 'the post-kill answer preceded the before-kill answer');
  const observation = sightingAttempts.get(directory);
  const original = join(observation.target, 'settled', 'fixture');
  const originalLog = readFileSync(join(original, 'sighted-ps.log'), 'utf8');
  const originalTrace = readFileSync(join(original, 'sighting-reads', 'trace.jsonl'), 'utf8');
  const cases = [
    { name: 'failure', error: /prepared read r000001 failed/, change: (rows) => { rows[1].status = 2; } },
    { name: 'timeout', error: /prepared read r000001 returned an error/, change: (rows) => {
      rows[1].error = { code: 'ETIMEDOUT' }; rows[1].signal = 'SIGTERM'; rows[1].returnedStreams = 'partial-possible';
    } },
    { name: 'no-settled-return', error: /prepared log and outer read counts differ/, change: (rows) => { rows.splice(1, 1); } },
    { name: 'wrong-argv', error: /argv differs from log/, change: (rows) => { rows[0].argv = ['-bad']; } },
    { name: 'wrong-returned-string', error: /differed from the complete log answer/, change: (rows, copy) => {
      const file = join(copy, 'sighting-reads', rows[1].stdout.file);
      const changed = 'different returned answer\n';
      writeFileSync(file, changed);
      rows[1].stdout.bytes = Buffer.byteLength(changed);
      rows[1].stdout.sha256 = createHash('sha256').update(changed).digest('hex');
    } },
    { name: 'reversed-order', error: /began before its predecessor ended/, change: (rows) => {
      rows[2].startedNs = '0';
    } },
    { name: 'lost-returned-original', error: /ENOENT/, change: (rows, copy) => {
      unlinkSync(join(copy, 'sighting-reads', rows[1].stdout.file));
    } },
  ];
  for (const variant of cases) {
    const copy = join(observation.root, `outer-${variant.name}-${randomUUID()}`);
    cpSync(original, copy, { recursive: true, force: false, errorOnExist: true });
    const rows = originalTrace.trimEnd().split('\n').map((line) => JSON.parse(line));
    for (const row of rows) if (row.kind === 'start') row.tool = join(copy, 'ps-sighted');
    variant.change(rows, copy);
    writeFileSync(join(copy, 'sighting-reads', 'trace.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    assert.throws(() => completePreparedSightingReads(copy, originalLog), variant.error,
      `${variant.name}: an ineligible outer read was accepted`);
  }
  assert.equal(readFileSync(join(original, 'sighted-ps.log'), 'utf8'), originalLog);
  assert.equal(readFileSync(join(original, 'sighting-reads', 'trace.jsonl'), 'utf8'), originalTrace,
    'an outer mutation altered the complete private original');
});

test('C615 fixture-retention denies failed copies missing bytes and unresolved finalizers', SETTLES_WITHIN, () => {
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  const retainedBytes = Buffer.from('retained original\n');
  const retainedFile = { name: 'marker', bytes: retainedBytes.length,
    sha256: createHash('sha256').update(retainedBytes).digest('hex') };
  const ready = {
    attempt: 'synthetic-retention', exit: { state: 'observed' }, close: { state: 'closed' },
    copy: 'byte-complete-at-snapshot', reads: 'settled-returned-originals',
    errors: [], producedThenLost: [], source: [retainedFile], copied: [retainedFile],
  };
  const closed = { attempt: 'synthetic-retention', state: 'pass', scratch: 'removed',
    identities: [{ pid: 42001, disposition: 'absent' }] };
  const cases = [
    { name: 'complete', inventory: ready, finalizer: closed, admitted: true },
    { name: 'failed-copy', inventory: { ...ready, copy: 'partial-or-changed' }, finalizer: closed },
    { name: 'lost-original', inventory: { ...ready, producedThenLost: [{ name: 'stdout' }] }, finalizer: closed },
    { name: 'unsettled-caller', inventory: { ...ready, close: { state: 'not-observed' } }, finalizer: closed },
    { name: 'unsettled-read', inventory: { ...ready, reads: 'partial-or-unresolved' }, finalizer: closed },
    { name: 'missing-retained-original', inventory: ready, finalizer: closed,
      change: (root) => unlinkSync(join(root, 'settled', 'fixture', 'marker')) },
    { name: 'unreadable-retained-original', inventory: ready, finalizer: closed,
      change: (root) => chmodSync(join(root, 'settled', 'fixture', 'marker'), 0),
      restore: (root) => chmodSync(join(root, 'settled', 'fixture', 'marker'), 0o600) },
    { name: 'missing-finalizer', inventory: ready },
    { name: 'failed-finalizer', inventory: ready, finalizer: { ...closed, state: 'fail' } },
    { name: 'identity-mismatch', inventory: ready, finalizer: { ...closed, attempt: 'other' } },
    ...['live', 'zombie', 'unsafe', 'unconfirmed'].map((disposition) => ({
      name: `${disposition}-identity`, inventory: ready,
      finalizer: { ...closed, identities: [{ pid: 42001, disposition }] },
    })),
  ];
  for (const variant of cases) {
    const root = join(outer, `retention-${variant.name}-${randomUUID()}`);
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(join(root, 'settled'), { mode: 0o700 });
    mkdirSync(join(root, 'settled', 'fixture'), { mode: 0o700 });
    writeFileSync(join(root, 'settled', 'fixture', 'marker'), retainedBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(root, 'settled', 'inventory.json'), JSON.stringify(variant.inventory) + '\n', { flag: 'wx', mode: 0o600 });
    if (variant.finalizer) writeFileSync(join(root, 'finalizer.json'), JSON.stringify(variant.finalizer) + '\n', { flag: 'wx', mode: 0o600 });
    try {
      variant.change?.(root);
      if (variant.name === 'unreadable-retained-original') {
        assert.equal(lstatSync(join(root, 'settled', 'fixture', 'marker')).mode & 0o400, 0,
          'the unreadable original was never forced');
      }
      if (variant.admitted) assert.equal(eligibleSightingAttempt(root), true);
      else assert.throws(() => eligibleSightingAttempt(root), undefined,
        `${variant.name}: an unresolved retained attempt earned credit`);
    } finally {
      variant.restore?.(root);
    }
  }
});

test('C615 fixture-retention reopens actual finalizer and recorded identities after teardown', SETTLES_WITHIN, async (t) => {
  const { directory } = await censusExit(t, 'U2');
  if (exitCutoffs.has(directory)) return;
  const target = sightingAttempts.get(directory)?.target;
  assert.ok(target, 'the actual prepared attempt has no private target');
  t.after(() => t.after(() => {
    assert.equal(eligibleSightingAttempt(target), true);
    const finalizer = JSON.parse(readFileSync(join(target, 'finalizer.json'), 'utf8'));
    assert.deepEqual(finalizer.identities.map(({ source }) => source).sort(), ['caller', 'group', 'one', 'two']);
    for (const identity of finalizer.identities) {
      assert.equal(identity.disposition, 'absent');
      assert.ok(identity.original, 'the identity disposition has no returned tool original');
      assert.ok(existsSync(join(target, identity.original)), 'the identity original was lost');
    }
  }));
});

test('C615 prepared sighting rejects an answered read without END', SETTLES_WITHIN, () => {
  const selected = process.env.C615_EVIDENCE_ROOT;
  assert.ok(selected, 'the negative control needs a private external evidence root');
  const root = realpathSync.native(selected);
  const checkout = realpathSync.native(process.cwd());
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && lstatSync(root).isDirectory()
    && (lstatSync(root).mode & 0o077) === 0, 'the negative-control root is unsafe');
  const directory = join(root, `sighting-block-${randomUUID()}`);
  const reads = join(directory, 'sighting-reads');
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(reads, { mode: 0o700 });
  const argv = ['-g', '42', '-o', 'pid=,stat='];
  const stdout = '42 S\n';
  const stderr = '';
  const stream = (kind, value) => {
    const file = `r000001.${kind}.utf8`;
    writeFileSync(join(reads, file), value, { flag: 'wx', mode: 0o600 });
    return { present: true, type: 'string', file, bytes: Buffer.byteLength(value),
      sha256: createHash('sha256').update(value).digest('hex') };
  };
  const records = [
    { kind: 'start', id: 'r000001', tool: join(directory, 'ps-sighted'), argv,
      startedNs: '1', callerExitMarked: true },
    { kind: 'end', id: 'r000001', endedNs: '2', status: 0, signal: null, error: null,
      returnedStreams: 'settled-return', stdout: stream('stdout', stdout), stderr: stream('stderr', stderr) },
  ];
  writeFileSync(join(reads, 'trace.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  const trace = 'READ -g 42 -o pid=,stat=\nPHASE before-kill\nROW 42 S\n';
  writeFileSync(join(directory, 'sighted-ps.log'), trace, { flag: 'wx', mode: 0o600 });
  assert.throws(() => answeredSightingRead(directory, trace, argv, 'before-kill'), /END/);
});

/** Retains a two-read prepared transcript with one synthetic failed outer return. */
function forcedPreparedLogReturn(mode, actual) {
  const selected = process.env.C615_EVIDENCE_ROOT;
  assert.ok(selected, 'the forced-return control needs a private external evidence root');
  const root = realpathSync.native(selected);
  const checkout = realpathSync.native(process.cwd());
  const scratch = realpathSync.native(process.env.TMPDIR);
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && root !== scratch
    && !root.startsWith(`${scratch}/`) && lstatSync(root).isDirectory()
    && (lstatSync(root).mode & 0o077) === 0, 'the forced-return root is unsafe');
  const directory = join(root, `sighting-log-${mode}-${randomUUID()}`);
  const reads = join(directory, 'sighting-reads');
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(reads, { mode: 0o700 });
  const first = ['-g', '42', '-o', 'pid=,stat='];
  const second = ['-ww', '-g', '42', '-o', 'pid=,stat='];
  const stream = (id, name, value) => {
    const file = `${id}.${name}.utf8`;
    writeFileSync(join(reads, file), value, { flag: 'wx', mode: 0o600 });
    return { present: true, type: 'string', file, bytes: Buffer.byteLength(value),
      sha256: createHash('sha256').update(value).digest('hex') };
  };
  const read = (index, argv, stdout, stderr, status, error, signal) => {
    const id = `r${String(index).padStart(6, '0')}`;
    return [
      { kind: 'start', id, tool: join(directory, 'ps-sighted'), argv,
        startedNs: String(index * 2 - 1), callerExitMarked: true },
      { kind: 'end', id, endedNs: String(index * 2), status, error, signal,
        returnedStreams: error || signal ? 'partial-possible' : 'settled-return',
        stdout: stream(id, 'stdout', stdout), stderr: stream(id, 'stderr', stderr) },
    ];
  };
  const returned = JSON.parse(readFileSync(join(actual.directory, 'forced-return.json'), 'utf8'));
  assert.equal(returned.readId, 'r000002');
  assert.deepEqual(returned.argv, second);
  const actualStdout = readFileSync(join(actual.directory, returned.stdout.file), 'utf8');
  const actualStderr = readFileSync(join(actual.directory, returned.stderr.file), 'utf8');
  for (const [name, value] of [['stdout', actualStdout], ['stderr', actualStderr]]) {
    assert.equal(Buffer.byteLength(value), returned[name].bytes, `the actual ${name} byte count changed`);
    assert.equal(createHash('sha256').update(value).digest('hex'), returned[name].sha256,
      `the actual ${name} digest changed`);
  }
  const records = [
    ...read(1, first, '42 S\n', '', 0, null, null),
    ...read(2, second, actualStdout, actualStderr, returned.status,
      returned.error === null ? null : { code: returned.error }, returned.signal),
  ];
  assert.equal(records[2].id, returned.readId);
  assert.deepEqual(records[2].argv, returned.argv);
  assert.equal(records[3].status, returned.status);
  assert.equal(records[3].signal, returned.signal);
  assert.equal(records[3].error?.code ?? null, returned.error);
  for (const name of ['stdout', 'stderr']) {
    assert.equal(records[3][name].bytes, returned[name].bytes);
    assert.equal(records[3][name].sha256, returned[name].sha256);
  }
  writeFileSync(join(reads, 'trace.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  const before = 'READ -g 42 -o pid=,stat=\nPHASE before-kill\nROW 42 S\nEND\n';
  const secondRows = actualStdout.trimEnd().split('\n').filter(Boolean);
  const partial = before + 'READ -ww -g 42 -o pid=,stat=\nPHASE before-kill\n'
    + (secondRows.length > 0 ? secondRows : ['42 S']).map((row) => `ROW ${row}\n`).join('');
  const complete = partial + 'END\n';
  writeFileSync(join(directory, 'sighted-ps.log'), partial, { flag: 'wx', mode: 0o600 });
  const completeDirectory = join(root, `sighting-log-complete-${mode}-${randomUUID()}`);
  const completeReads = join(completeDirectory, 'sighting-reads');
  mkdirSync(completeDirectory, { mode: 0o700 });
  mkdirSync(completeReads, { mode: 0o700 });
  for (const file of readdirSync(reads).filter((file) => file !== 'trace.jsonl')) {
    cpSync(join(reads, file), join(completeReads, file), { force: false, errorOnExist: true });
  }
  const completeRecords = records.map((record) => record.kind === 'start'
    ? { ...record, tool: join(completeDirectory, 'ps-sighted') } : record);
  writeFileSync(join(completeReads, 'trace.jsonl'), completeRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
    { flag: 'wx', mode: 0o600 });
  writeFileSync(join(completeDirectory, 'sighted-ps.log'), complete, { flag: 'wx', mode: 0o600 });
  const provenance = { readId: returned.readId, actualRoot: actual.directory.slice(root.length + 1),
    actualReturnSha256: createHash('sha256').update(readFileSync(join(actual.directory, 'forced-return.json'))).digest('hex'),
    actualTool: returned.tool, syntheticRead: 'r000001', syntheticToolPath: true,
    constructedLogRows: secondRows.length === 0, constructedEnd: true };
  for (const target of [directory, completeDirectory]) {
    writeFileSync(join(target, 'return-provenance.json'), JSON.stringify(provenance) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { directory, completeDirectory, partial, complete, returned, actualStdout, actualStderr };
}

/** Forces the actual prepared stand-in's log open to fail or time out and retains its return. */
function forcePreparedLogWrite(mode) {
  const selected = process.env.C615_EVIDENCE_ROOT;
  assert.ok(selected, 'the log-write control needs a private external evidence root');
  const root = realpathSync.native(selected);
  const checkout = realpathSync.native(process.cwd());
  const scratch = realpathSync.native(process.env.TMPDIR);
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && root !== scratch
    && !root.startsWith(`${scratch}/`) && lstatSync(root).isDirectory()
    && (lstatSync(root).mode & 0o077) === 0, 'the log-write root is unsafe');
  const directory = join(root, `sighting-log-real-${mode}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const script = sightingPs(directory, { cell: 'B', prepared: true });
  writeFileSync(join(directory, 'two.pid'), '43', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'sighting-cache.ready'), '', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'sighting-cache.state'), '42 S\n43 S\n', { flag: 'wx', mode: 0o600 });
  const log = join(directory, 'sighted-ps.log');
  const settings = { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' },
    timeout: CLEANUP_BOUND, killSignal: 'SIGKILL' };
  if (mode === 'F') mkdirSync(log, { mode: 0o700 });
  else {
    const fifo = spawnSync('/usr/bin/mkfifo', [log], settings);
    writeFileSync(join(directory, 'mkfifo.stdout.utf8'), fifo.stdout ?? '', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'mkfifo.stderr.utf8'), fifo.stderr ?? '', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'mkfifo-return.json'), JSON.stringify({ status: fifo.status,
      signal: fifo.signal, error: fifo.error?.code ?? null }) + '\n', { flag: 'wx', mode: 0o600 });
    assert.equal(fifo.status, 0, 'the timeout control could not create its named pipe');
    assert.equal(fifo.error, undefined);
    assert.ok(lstatSync(log).isFIFO());
  }
  const argv = ['-ww', '-g', '42', '-o', 'pid=,stat='];
  const answer = spawnSync(script, argv, { ...settings, env: settings.env });
  assert.equal(typeof answer.stdout, 'string', 'the forced read did not return a stdout string');
  assert.equal(typeof answer.stderr, 'string', 'the forced read did not return a stderr string');
  writeFileSync(join(directory, 'forced.stdout.utf8'), answer.stdout, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'forced.stderr.utf8'), answer.stderr, { flag: 'wx', mode: 0o600 });
  const wasFifo = mode === 'T' && lstatSync(log).isFIFO();
  const readId = 'r000002';
  const stream = (file, value) => ({ file, bytes: Buffer.byteLength(value),
    sha256: createHash('sha256').update(value).digest('hex') });
  writeFileSync(join(directory, 'forced-return.json'), JSON.stringify({ readId, tool: script, argv,
    timeout: settings.timeout, status: answer.status, signal: answer.signal,
    error: answer.error?.code ?? null, pid: answer.pid ?? null,
    stdout: stream('forced.stdout.utf8', answer.stdout), stderr: stream('forced.stderr.utf8', answer.stderr),
    log: mode === 'F' ? 'directory-not-a-byte-original' : wasFifo ? 'fifo-open-blocked-no-byte-original' : 'unknown' }) + '\n', { flag: 'wx', mode: 0o600 });
  if (mode === 'F') {
    assert.ok(lstatSync(log).isDirectory(), 'the failed log target was no longer a directory');
    assert.ok(answer.stderr.length > 0, 'the log write did not report its failure');
  } else {
    assert.ok(wasFifo, 'the timed-out log target was no longer a named pipe');
    assert.equal(answer.error?.code, 'ETIMEDOUT', 'the log open did not time out');
    unlinkSync(log); // The synchronous child has returned; the pipe held no byte original.
  }
  return { directory, readId };
}

test('C615 prepared log-write F counterexample rejects read r000002', SETTLES_WITHIN, () => {
  const actual = forcePreparedLogWrite('F');
  assert.equal(actual?.readId, 'r000002', 'the actual forced F return has no read ID');
  const { directory, completeDirectory, partial, complete, returned, actualStderr } = forcedPreparedLogReturn('F', actual);
  assert.equal(readFileSync(join(directory, 'sighting-reads/r000002.stderr.utf8'), 'utf8'), actualStderr);
  assert.ok(actualStderr.length > 0, 'the actual F return did not report its failed log write');
  assert.equal(returned.status, 0);
  assert.equal(returned.error, null);
  assert.equal(returned.signal, null);
  assert.throws(() => completePreparedSightingReads(directory, partial), /r000002 END/);
  assert.throws(() => completePreparedSightingReads(completeDirectory, complete), /r000002 stderr differed/);
});

test('C615 prepared log-write T counterexample rejects read r000002', SETTLES_WITHIN, () => {
  const actual = forcePreparedLogWrite('T');
  assert.equal(actual?.readId, 'r000002', 'the actual forced T return has no read ID');
  const { directory, completeDirectory, partial, complete, returned, actualStderr } = forcedPreparedLogReturn('T', actual);
  assert.equal(readFileSync(join(directory, 'sighting-reads/r000002.stderr.utf8'), 'utf8'), actualStderr);
  assert.equal(returned.status, null);
  assert.equal(returned.error, 'ETIMEDOUT');
  assert.equal(returned.signal, 'SIGKILL');
  assert.throws(() => completePreparedSightingReads(directory, partial), /r000002 END/);
  assert.throws(() => completePreparedSightingReads(completeDirectory, complete), /r000002 failed/);
});

// proves R-STATE-12, R-STATE-19
test('A0 call omitted: a member shown only in the after state read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'A');
});

// proves R-STATE-12, R-STATE-19
test('A0 exit omitted: a member shown only in the after state read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'A');
});

// proves R-STATE-12, R-STATE-19
test('C1 call omitted: a member shown only in the first command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C1');
});

// proves R-STATE-12, R-STATE-19
test('C1 exit omitted: a member shown only in the first command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C1');
});

// proves R-STATE-12, R-STATE-19
test('C2 call omitted: a member shown only in the second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C2');
});

// proves R-STATE-12, R-STATE-19
test('C2 exit omitted: a member shown only in the second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C2');
});

// proves R-STATE-12
test('B1 call: a member named by an early census read and left a zombie is recorded by name', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusCall(t, 'B', 'zombie');
  assertSighting(trace, two, 'B');
  assert.ok(processState(two).startsWith('Z'), `the member was not a zombie: ${processState(two)}`);
  assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12
test('B1 exit: a member named by an early census read and left a zombie is recorded by name', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusExit(t, 'B', 'zombie');
  if (exitCutoffs.has(events)) return;
  assertSighting(trace, two, 'B');
  assert.ok(processState(two).startsWith('Z'), `the member was not a zombie: ${processState(two)}`);
  assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12, R-STATE-19
test('A0 call zombie: an after-state-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'A', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('A0 exit zombie: an after-state-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'A', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C1 call zombie: a first-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C1', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C1 exit zombie: a first-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C1', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C2 call zombie: a second-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C2', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C2 exit zombie: a second-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C2', 'zombie');
});

// proves R-STATE-12
test('N0 call: a member every read omits has no pid event or group fallback', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'N');
  assertSighting(trace, two, 'N');
  assert.deepEqual(recordOf(events, two), []);
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
});

// proves R-STATE-12
test('N0 exit: a member every read including the first confirmation omits has no pid event or group fallback', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusExit(t, 'N');
  assertSighting(trace, two, 'N');
  const confirmation = sightingReads(trace).filter(({ args }) => args === '-g ' + group + ' -o pid=,stat=,xstat=');
  assert.ok(confirmation.length > 0, 'the exit confirmation made no read');
  assert.equal(confirmation.some(({ rows }) => rows.some((row) => new RegExp('^ROW\\s+' + two + ' ').test(row))), false, 'a confirmation read listed the member');
  assert.deepEqual(recordOf(events, two), []);
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
});

/** The shown member exited on its own, and the parent reaped it before confirmation and kill. */
async function reapedCensusCell(t, path) {
  const { directory, events, group, two, trace } = await (path === 'call' ? censusCall(t, 'X') : censusExit(t, 'X'));
  if (exitCutoffs.has(events)) return;
  assertSighting(trace, two, 'X');
  assert.ok(existsSync(join(directory, 'reaped-two')), 'the parent did not mark its successful waitpid');
  const reads = sightingReads(trace);
  const censusStates = reads.map(({ args }, index) => args === '-ww -g ' + group + ' -o pid=,stat=' ? index : -1).filter((index) => index >= 0);
  const after = censusStates[1];
  const confirming = reads.findIndex(({ args }) => args === '-g ' + group + ' -o pid=,stat=');
  assert.ok(after >= 0 && confirming > after, 'the confirming read did not follow the reaping state read');
  assert.deepEqual(recordOf(events, two), [], 'the member reaped before the kill was recorded as ended by it');
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
}

// proves R-STATE-12
test('X0 call: a once-shown member reaped on its own before confirmation has no kill event', SETTLES_WITHIN, async (t) => {
  await reapedCensusCell(t, 'call');
});

// proves R-STATE-12
test('X0 exit: a once-shown member reaped on its own before confirmation has no kill event', SETTLES_WITHIN, async (t) => {
  await reapedCensusCell(t, 'exit');
});

// The exit-sighting branches of owner ruling O268, each forced on its own. The words below are the
// reasons `src/substrate/process.mjs` gives, written out here so the classification is checked
// against them rather than against itself.
const TIMED_OUT = 'the process-table read timed out after 1000 ms';
const LATE_READS = 'the reads of the process table did not finish within 1000 ms';
const REFUSED = `${TIMED_OUT} earlier in the exit cleanup, which does not wait on it again`;
const FAILED_READ = 'the process-table read failed: forced failure';
const CONFIRM_FAILED = 'the read of the group just before its kill failed while signal 0 still reached it: ';
const SPENT = 'the reads of the group just before its kill listed no process for 1000 ms while signal 0 still reached it';
const BY_PID_FAILED = ", and the read of the census's processes by pid failed too: ";
const MAY_HAVE = ', so the kill of the group may have ended a process the census had not named';

/** One forced stand-in read: the `nth` read of `kind` before the kill takes `action`. */
const forced = (kind, nth, action) => ({ kind, nth, action });

/** How each named exit cell's ordinary test runs, as its own test does. */
const EXIT_RUNS = {
  U1: (t) => unnamedCensusCell(t, 'exit', 'U1'),
  U2: (t) => unnamedCensusCell(t, 'exit', 'U2'),
  C1: (t) => unnamedCensusCell(t, 'exit', 'C1'),
  C2: (t) => unnamedCensusCell(t, 'exit', 'C2'),
  A0: (t) => unnamedCensusCell(t, 'exit', 'A'),
  'A0 zombie': (t) => unnamedCensusCell(t, 'exit', 'A', 'zombie'),
  B0: async (t) => bExit(t, 'omit'),
  B1: async (t) => bExit(t, 'zombie'),
  X0: (t) => reapedCensusCell(t, 'exit'),
};

/** B0 or B1's exit as its own test runs it: a traced cutoff, or its answered named-record scenario. */
async function bExit(t, afterKill) {
  const { directory, events, two, trace } = await censusExit(t, 'B', afterKill);
  if (exitCutoffs.has(events)) return;
  assertSighting(trace, two, 'B');
  if (afterKill === 'zombie') {
    assert.ok(processState(two).startsWith('Z'), `the member was not a zombie: ${processState(two)}`);
    assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  }
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
}

/** Each named cell's exit census, on the shared helper. */
const EXIT_CELLS = { U1: ['U1'], U2: ['U2'], C1: ['C1'], C2: ['C2'], A0: ['A'], 'A0 zombie': ['A', 'zombie'], B0: ['B'], B1: ['B', 'zombie'], X0: ['X'] };

/**
 * Runs `name`'s exit with `forcing` and checks how L0 ended it against `expect`: a `cutoff` or
 * `answered` run goes through the cell's ordinary test, which must pass; a `diagnostic` run, or one
 * marked `fails`, must fail that test's answered scenario. Either way the classification and the
 * group's recorded reason must be the ones expected.
 *
 * The real 1,000 ms bound still runs under forcing, so a loaded host can end the exit before the
 * forced read or signal is reached. Such an attempt has already passed the ordinary branch checks
 * inside `censusExit`, but it is no proof of the forced class: it is skipped, with its classification
 * printed, and so is one where an unforced timing edge (a no-start `LATE` or a spent decision
 * deadline) ended the exit first. Either skip is evidence for the ledger, never a pass of the class.
 */
async function forcedExit(t, name, forcing, expect) {
  exitForcings.set(t, forcing);
  let failure;
  try { await (expect.fails ?? expect.branch === 'diagnostic' ? censusExit(t, ...EXIT_CELLS[name]) : EXIT_RUNS[name](t)); }
  catch (error) { failure = error; }
  const { exit, events, directory } = exitResults.get(t);
  const reached = forcingReached(directory, forcing);
  // A real-deadline cutoff the forcing did not ask for pre-empts any non-cutoff class: `exitCutoff`
  // has already proved its real bound, and the class's own terminal was never reached. So does a
  // census the real bound cut (C2, C2u, C3 or C4) where the class expects another census ending.
  const timingEdge = (exit.branch === 'cutoff' && expect.branch !== 'cutoff') || ['late', 'spent'].includes(exit.censusCut?.kind) || ['late', 'spent'].includes(exit.confirmCut?.kind) || (expect.C !== undefined && exit.C !== expect.C && exit.censusCut !== undefined) || (exit.B === 'B4' && expect.B !== 'B4');
  // An ordinary-path failure is never skipped: only a forced class the run did not reach is. A
  // failure the class expects is the forcing's own result once the forcing was reached.
  const expectsFailure = expect.fails ?? expect.branch === 'diagnostic';
  // The one failure the forcing specifies: the ordinary test's refusal of a diagnostic branch, or
  // the named answered-scenario assertion. Any other failure propagates before any skip.
  const specified = expect.failure ?? /the exit took the diagnostic branch/;
  if (failure && (!expectsFailure || !reached || !specified.test(failure.message))) throw failure;
  if (!reached || timingEdge) {
    t.diagnostic(JSON.stringify({ forcedClassUnproved: !reached ? 'the real bound ended the exit before the forcing was reached' : 'an unforced timing edge ended the exit', exitSighting: exitSummary(exit), failure: failure?.message ?? null }));
    t.skip(!reached ? 'forcing not reached before the real bound' : `unforced timing edge ${exit.C}/${exit.F ?? '-'}`);
    return undefined;
  }
  if (expect.fails ?? expect.branch === 'diagnostic') assert.ok(failure, 'the forced run passed the answered scenario');
  else if (failure) throw failure;
  for (const key of ['branch', 'C', 'N', 'F', 'B', 'n']) if (expect[key] !== undefined) assert.equal(exit[key], expect[key], `${key}: ${JSON.stringify(exitSummary(exit))}`);
  if (expect.rounds !== undefined) assert.deepEqual(exit.rounds, expect.rounds, `rounds: ${JSON.stringify(exitSummary(exit))}`);
  if (expect.statuses !== undefined) assert.deepEqual(exit.statuses, expect.statuses, `statuses: ${JSON.stringify(exitSummary(exit))}`);
  if (failure) t.diagnostic(JSON.stringify({ specifiedFailure: failure.message.split('\n')[0] }));
  if (expect.reason !== undefined) {
    const kills = events.filter(({ event, group }) => event === 'group.killed' && group === exit.group);
    assert.equal(kills.length, 1, `the group kill was not recorded once: ${JSON.stringify(events)}`);
    assert.equal(kills[0].census, expect.reason(exit.group));
  }
  return exit;
}

/** Whether every forced read, signal and probe in `forcing` was actually reached in `directory`'s exit. */
function forcingReached(directory, { reads = [], signals = [], probe }) {
  const forced = existsSync(join(directory, 'forced')) ? readFileSync(join(directory, 'forced'), 'utf8') : '';
  if (!reads.every(({ kind, nth, action }) => forced.includes(`${kind} ${nth} ${action}\n`))) return false;
  if (signals.length > 0 && !linesOf(directory, 'exit-trace.jsonl').some((row) => row.kind === 'signal' && row.forced)) return false;
  if (probe === 'fail' && !/^PROBE .* status=1 /m.test(existsSync(join(directory, 'probe-log')) ? readFileSync(join(directory, 'probe-log'), 'utf8') : '')) return false;
  if (probe === 'hang' && !existsSync(`${directory}.probe-held`)) return false;
  return true;
}

const censusTimeout = { branch: 'cutoff', C: 'C2', N: 'N0', reason: () => TIMED_OUT };
const n1 = `the census's reads named no process of the group while it still had one: `;
const n2 = (group) => `the census's reads left out the group's leader, ${group}, while signal 0 still reached its pid: `;
const confirmTimedOut = { branch: 'cutoff', C: 'C0', F: 'F5Tz', B: 'B4', reason: () => CONFIRM_FAILED + TIMED_OUT + BY_PID_FAILED + LATE_READS };
const refusedKill = { step: 2, name: 'SIGKILL', nth: 1, code: 'EPERM' };

/**
 * Asserts a forced K1: the first group kill was the refused one. What L0 sends after it is recorded
 * rather than presumed, since it depends on whether the same `ps` still answers.
 */
const refusedThenSent = (exit, directory, name, t) => {
  assert.deepEqual(exit.kills[0], { ok: false, code: 'EPERM' }, 'the first group kill was not the refused one');
  t?.diagnostic(JSON.stringify({ laterGroupKills: exit.kills.slice(1), postKill: exit.postKill }));
};

/** Asserts the stand-in's real per-pid probe record for a confirming read that reached it. */
const probed = (status, stat) => (exit, directory) => {
  const two = pidIn(directory, 'two');
  const probe = exit.probes.find(({ target }) => target === two);
  assert.ok(probe, `no real per-pid probe of the member was recorded: ${JSON.stringify(exit.probes)}`);
  assert.equal(probe.argv, `-p ${two} -o stat=`);
  assert.ok(probe.end >= probe.start, 'the probe ended before it started');
  if (status !== undefined) assert.equal(probe.status, status, `the probe exited ${probe.status}`);
  if (stat !== undefined) assert.equal(probe.stat, stat);
  return probe;
};

/**
 * Each named exit cell's forcing classes. Census classes apply to every cell. A cell whose census
 * settles in one round (C1, C2) never makes a third state read unless an anomalous round forces
 * one, so C4 and C5 are unreachable for it (`census:775` returns on the settled round). X0's
 * target is reaped before its confirming read (`sightingPs:44–47` waits for `reaped-two` before
 * answering the X-reap read), so a present-target A2p is unreachable for X0, and so is A2t: a real
 * `ps -p` of a reaped pid prints nothing, so no full pipe can hold it running until its read is cut.
 */
const twoRound = ['U1', 'U2', 'A0', 'A0 zombie', 'B0', 'B1', 'X0'];
// A forced empty answer has no READ block in a prepared cell's stand-in log, so its answered
// scenario's prepared-read accounting fails; the F3e class itself is still classified and checked.
const preparedCells = ['U2', 'A0', 'A0 zombie', 'B0', 'B1'];
const CELL_CASES = [
  ['E0: its first census state read timed out', () => true, { reads: [forced('state', 1, 'hang')] }, censusTimeout],
  ['E1: its first command read timed out', () => true, { reads: [forced('command', 1, 'hang')] }, censusTimeout],
  ['E2: its second census state read timed out', () => true, { reads: [forced('state', 2, 'hang')] }, censusTimeout, (exit, directory, name) => {
    if (name === 'X0') assert.equal(existsSync(join(directory, 'release-two')), false, 'the X-reap read released the member before it was cut');
  }],
  ['E2 failure: its second census state read failed', () => true, { reads: [forced('state', 2, 'fail')] }, { branch: 'diagnostic', C: 'C1', reason: () => FAILED_READ }],
  ['C1: its first census read failed', () => true, { reads: [forced('state', 1, 'fail')] }, { branch: 'diagnostic', C: 'C1', reason: () => FAILED_READ }],
  ['N1: an empty completed round then a timed-out read', () => true, { reads: [forced('state', 2, 'empty'), forced('state', 3, 'hang')] }, { branch: 'cutoff', C: 'C2u', N: 'N1', reason: () => n1 + TIMED_OUT }],
  ['N1 failure: an empty completed round then a failed read', () => true, { reads: [forced('state', 2, 'empty'), forced('state', 3, 'fail')] }, { branch: 'diagnostic', C: 'C1', N: 'N1', reason: () => n1 + FAILED_READ }],
  ['N2: a leaderless completed round then a timed-out read', () => true, { reads: [forced('state', 2, 'omit-leader'), forced('state', 3, 'hang')] }, { branch: 'cutoff', C: 'C2u', N: 'N2', reason: (group) => n2(group) + TIMED_OUT }],
  ['N2 failure: a leaderless completed round then a failed read', () => true, { reads: [forced('state', 2, 'omit-leader'), forced('state', 3, 'fail')] }, { branch: 'diagnostic', C: 'C1', N: 'N2', reason: (group) => n2(group) + FAILED_READ }],
  ['C4 F2z: its second census round timed out and the confirming read was refused', (name) => twoRound.includes(name), { reads: [forced('state', 3, 'hang')] }, { branch: 'cutoff', C: 'C4', F: 'F2z', B: 'B6', reason: () => CONFIRM_FAILED + REFUSED + BY_PID_FAILED + REFUSED }, (exit, directory, name) => {
    if (name === 'X0') assert.equal(existsSync(join(directory, 'reaped-two')), true, 'the X-reap read returned before the member was reaped');
  }],
  ['C5: a census read after a completed round failed', (name) => twoRound.includes(name), { reads: [forced('state', 3, 'fail')] }, { branch: 'diagnostic', C: 'C5', reason: () => FAILED_READ }],
  ['K1 cutoff: a refused first group kill after a census timeout fails the cutoff', () => true, { reads: [forced('state', 1, 'hang')], signals: [{ ...refusedKill, step: 1 }] }, { fails: true, failure: /did not reach the group/, branch: 'cutoff', C: 'C2', reason: () => TIMED_OUT }, refusedThenSent],
  ['F5Tz: a confirming read timed out', () => true, { reads: [forced('confirm', 1, 'hang')] }, confirmTimedOut],
  ['F5Te: an empty confirming answer then a timed-out read', () => true, { reads: [forced('confirm', 1, 'empty'), forced('confirm', 2, 'hang')] }, { ...confirmTimedOut, F: 'F5Te', n: 1, statuses: [0] }],
  ['A3 timeout: a confirming read timed out after its probe', () => true, { reads: [forced('confirm', 1, 'answer-then-hang')] }, confirmTimedOut, (exit) => assert.ok(exit.probes.length > 0, 'the confirming read was cut before its probe')],
  ['A2t: a confirming read timed out while its real probe ran', (name) => name !== 'X0', { probe: 'hang' }, confirmTimedOut, async (exit, directory, name, t) => {
    const record = `${directory}.probe-held`;
    await until(() => existsSync(record) && /^cut /m.test(readFileSync(record, 'utf8')), { signal: t.signal });
    const held = readFileSync(record, 'utf8');
    unlinkSync(record);
    t.diagnostic(JSON.stringify({ probeHeld: held }));
    const started = new RegExp('^started (\\d+) (\\S*/)?ps filled=\\d+$', 'm').exec(held);
    assert.ok(started, `the real /bin/ps probe never started: ${held}`);
    assert.match(held, new RegExp(`^cut ${started[1]} before=\\S+ signal=9 exit=0$`, 'm'), `the real probe was not still running when its read was cut: ${held}`);
    assert.deepEqual(exit.probes, [], 'a probe result reached the stand-in');
    assert.equal(existsSync(join(directory, 'sighted-live')), false, 'the live marker was written without a probe result');
  }],
  ['F4z: a failed confirming read', () => true, { reads: [forced('confirm', 1, 'fail')] }, { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B1', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }],
  ['F4e: an empty confirming answer then a failed read', () => true, { reads: [forced('confirm', 1, 'empty'), forced('confirm', 2, 'fail')] }, { branch: 'diagnostic', C: 'C0', F: 'F4e', n: 1, statuses: [0], B: 'B1', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }],
  ['A3 failure: a confirming read failed after its probe', () => true, { reads: [forced('confirm', 1, 'answer-then-fail')] }, { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B1', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }, (exit) => assert.ok(exit.probes.length > 0, 'the failed confirming read made no probe')],
  ['B2: a failed confirming read then an empty read by pid', () => true, { reads: [forced('confirm', 1, 'fail'), forced('fallback', 1, 'empty')] }, { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B2', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }],
  ['B3: a failed confirming read then a failed read by pid', () => true, { reads: [forced('confirm', 1, 'fail'), forced('fallback', 1, 'fail')] }, { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B3', reason: () => CONFIRM_FAILED + FAILED_READ + BY_PID_FAILED + FAILED_READ }],
  ['B5: a failed confirming read then a timed-out read by pid', () => true, { reads: [forced('confirm', 1, 'fail'), forced('fallback', 1, 'hang')] }, { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B5', reason: () => CONFIRM_FAILED + FAILED_READ + BY_PID_FAILED + TIMED_OUT }],
  ['F6z: an occupancy check that fails with another error', () => true, { signals: [{ step: 2, name: 0, nth: 1, code: 'EINVAL' }] }, { branch: 'diagnostic', C: 'C0', F: 'F6z', reason: () => 'kill EINVAL' }],
  ['F3e: an empty confirming answer then a live one', () => true, { reads: [forced('confirm', 1, 'empty')] }, { fails: (name) => preparedCells.includes(name), failure: /prepared|consumed cached answer|state cache read count/, branch: 'answered', C: 'C0', F: 'F3e', n: 1, statuses: [0] }, probed()],
  // The same empty-answer prefix with status 1 and no output, which `runOnce:971–980` accepts as an
  // answer: the status vector L0 kept is asserted alongside each terminal.
  ['F3e status 1: an empty status-1 confirming answer then a live one', () => true, { reads: [forced('confirm', 1, 'empty-status-1')] }, { fails: (name) => preparedCells.includes(name), failure: /prepared|consumed cached answer|state cache read count/, branch: 'answered', C: 'C0', F: 'F3e', n: 1, statuses: [1] }, probed()],
  ['F4e status 1: an empty status-1 confirming answer then a failed read', () => true, { reads: [forced('confirm', 1, 'empty-status-1'), forced('confirm', 2, 'fail')] }, { branch: 'diagnostic', C: 'C0', F: 'F4e', n: 1, statuses: [1], B: 'B1', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }],
  ['F5Te status 1: an empty status-1 confirming answer then a timed-out read', () => true, { reads: [forced('confirm', 1, 'empty-status-1'), forced('confirm', 2, 'hang')] }, { ...confirmTimedOut, F: 'F5Te', n: 1, statuses: [1] }],
  ['N1 status 1: an empty status-1 completed round then a timed-out read', () => true, { reads: [forced('state', 2, 'empty-status-1'), forced('state', 3, 'hang')] }, { branch: 'cutoff', C: 'C2u', N: 'N1', reason: () => n1 + TIMED_OUT }],
  ['A2p: a real probe that fails with no state while the member remains', (name) => name !== 'X0', { probe: 'fail' }, { fails: true, failure: /the last read before the kill did not find the member alive/, branch: 'answered', C: 'C0', F: 'F3z' }, (exit, directory) => {
    const probe = probed(1, '')(exit, directory);
    assert.equal(probe.stderr, '', 'the failed probe wrote standard error');
    assert.deepEqual([probe.before, probe.after], ['present', 'present'], 'the member was not present around its failed probe');
    assert.equal(existsSync(join(directory, 'sighted-live')), false, 'a failed probe wrote the live marker');
  }],
  // X0's member is already reaped by its confirming read, so A1 there is X0's own answered scenario.
  // A1 absent: the member is ended and reaped before its probe. A0 zombie and B1's member has a
  // parent outside the group that never reaps it (`zombieJoiner`), so absence is unreachable there.
  ['A1 absent: a member ended and reaped before the confirming probe', (name) => !['A0 zombie', 'B1'].includes(name), { reads: [forced('confirm', 1, 'end-target-absent')] },
    { fails: (name) => name !== 'X0', failure: /the exit took the diagnostic branch|the last read before the kill did not find the member alive/, C: 'C0' }, (exit, directory, name) => {
      assert.match(read(directory, 'forced'), /^target \d+ absent$/m, 'the ended member was not reaped before its probe');
      if (preparedCells.includes(name)) {
        // The prepared stand-in's real start-time read of an absent member fails, so it exits 79 with
        // no outer answer (`sightingPs:59–69`).
        assert.equal(exit.F, 'F4z', 'a prepared probe of an absent member returned an outer answer');
        assert.match(exit.reason, /ended with 79/);
        const probe = probed(1, '')(exit, directory);
        assert.equal(probe.before, 'absent');
      } else {
        assert.equal(exit.F, 'F3z', 'the probe of an absent member returned no outer answer');
        const probe = probed(1, '')(exit, directory);
        assert.equal(probe.before, 'absent');
      }
    }],
  // A1 zombie: the member is ended while its parent is stopped, so it stays a zombie through its
  // probe. X0's member is already reaped by its confirming read, so a zombie is unreachable there.
  ['A1 zombie: a member ended and left a zombie before the confirming probe', (name) => name !== 'X0', { reads: [forced('confirm', 1, 'end-target-zombie')] },
    { fails: true, failure: /the exit took the diagnostic branch|the last read before the kill did not find the member alive/, C: 'C0' }, (exit, directory, name, t) => {
      assert.match(read(directory, 'forced'), /^target \d+ Z\S* parent \d+ stopped$/m, 'the ended member was not a zombie before its probe');
      const probe = probed()(exit, directory);
      assert.match(probe.stat, /^Z/, `the probe did not read a zombie: ${probe.stat}`);
      assert.equal(existsSync(join(directory, 'sighted-live')), false, 'a zombie probe wrote the live marker');
      // A zombie still has its start time, so even a prepared stand-in answers L0 (`sightingPs:59–69`).
      assert.equal(exit.F, 'F3z', 'the probe of a zombie member returned no outer answer');
      t?.diagnostic?.(JSON.stringify({ zombieProbe: probe, F: exit.F }));
    }],
  // E3: a changed completed round, then a settled return and an answered confirmation. The two-round
  // cells reach it unforced; a one-round cell reaches it after a forced anomalous first round.
  ['E3: a changed completed round then a settled return and an answered confirmation', (name) => twoRound.includes(name), {}, { branch: 'answered', C: 'C0', F: 'F3z', rounds: ['changed', 'settled'] }, probed()],
  ['E3 anomalous: an empty completed round then a settled return and a confirmation', () => true, { reads: [forced('state', 2, 'empty')] },
    { fails: (name) => preparedCells.includes(name), failure: /prepared|consumed cached answer|state cache read count/, C: 'C0', F: 'F3z' }, (exit) => assert.equal(exit.rounds[0], 'N1', `rounds: ${exit.rounds}`)],
  // E4: a changed or anomalous completed round, a settled return, then a confirmation that fails.
  ['E4: an empty completed round, a settled return, then a failed confirming read', () => true, { reads: [forced('state', 2, 'empty'), forced('confirm', 1, 'fail')] },
    { branch: 'diagnostic', C: 'C0', F: 'F4z', B: 'B1', reason: () => CONFIRM_FAILED + FAILED_READ + MAY_HAVE }, (exit) => assert.equal(exit.rounds[0], 'N1', `rounds: ${exit.rounds}`)],
  // X0's X-reap read entering its own wait for `reaped-two` and cut there: the reaping parent is
  // stopped, so the read waits inside the fixture until L0's real census bound kills it.
  ['X-reap held: the X-reap read waits for a stopped reaper until its real bound cuts it', (name) => name === 'X0', { reads: [forced('state', 2, 'hold-reaper')] }, censusTimeout, async (exit, directory, name, t) => {
    const reaper = Number(read(directory, 'held-reaper'));
    try {
      assert.ok(existsSync(join(directory, 'release-two')), 'the X-reap read never released the member, so it never entered its wait');
      assert.equal(existsSync(join(directory, 'reaped-two')), false, 'the stopped reaper reaped the member before the cut');
      assert.equal(exit.censusCut.kind, 'timeout', 'the X-reap read was not cut by its real census bound');
    } finally {
      // Once L0's kill ends the reaper's parent, the kernel may already have ended the stopped reaper
      // as a member of an orphaned group; a reaper still there is continued.
      try { process.kill(reaper, 'SIGCONT'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const two = pidIn(directory, 'two');
    await until(() => processState(two) === '', { signal: t.signal });
  }],
];
for (const name of Object.keys(EXIT_RUNS)) {
  for (const [title, applies, forcing, expect, check] of CELL_CASES) {
    if (!applies(name)) continue;
    const cellExpect = { ...expect, fails: typeof expect.fails === 'function' ? expect.fails(name) : expect.fails };
    test(`${name} exit ${title}`, SETTLES_WITHIN, async (t) => {
      // A reaper the forcing stopped is continued in pass and fail teardown alike.
      t.after(() => {
        const held = exitResults.get(t)?.directory && join(exitResults.get(t).directory, 'held-reaper');
        if (held && existsSync(held)) try { process.kill(Number(readFileSync(held, 'utf8')), 'SIGCONT'); } catch {}
      });
      const exit = await forcedExit(t, name, forcing, cellExpect);
      if (exit && check) await check(exit, exitResults.get(t).directory, name, t);
    });
  }
  test(`${name} exit K1 answered: a refused first group kill after an answered confirmation is recorded as it happened`, SETTLES_WITHIN, async (t) => {
    exitForcings.set(t, { signals: [refusedKill] });
    let failure;
    try { await censusExit(t, ...EXIT_CELLS[name]); } catch (error) { failure = error; }
    const { exit, events, directory } = exitResults.get(t);
    const reached = forcingReached(directory, { signals: [refusedKill] });
    if (exit.branch !== 'answered' || !reached) {
      // A real-bound cutoff that still met the refused kill is the K1-cutoff class: its ordinary
      // cutoff must fail on the refused kill, and nothing else.
      if (failure && !(reached && exit.branch === 'cutoff' && /did not reach the group/.test(failure.message))) throw failure;
      if (reached && exit.branch === 'cutoff') refusedThenSent(exit, directory, name, t);
      t.diagnostic(JSON.stringify({ forcedClassUnproved: 'the real bound ended the exit before an answered confirmation', exitSighting: exitSummary(exit) }));
      t.skip(`no answered confirmation: ${exit.C}/${exit.F ?? '-'}`);
      return;
    }
    if (failure) t.diagnostic(JSON.stringify({ answeredRefusedKill: failure.message }));
    refusedThenSent(exit, directory, name, t);
    assert.ok(exit.kills.slice(1).some(({ ok }) => ok), 'no later group kill reached the group after the answered confirmation');
    // X0's reaped member leaves no group record; every other answered cell records one.
    assert.equal(events.filter(({ event, group }) => event === 'group.killed' && group === exit.group).length, name === 'X0' ? 0 : 1, JSON.stringify(events));
  });
}

test('A0 exit forced F4z propagates a failure other than the one its forcing specifies', SETTLES_WITHIN, async (t) => {
  const forcing = { reads: [forced('confirm', 1, 'fail')] };
  let thrown;
  try { await forcedExit(t, 'A0', forcing, { branch: 'diagnostic', failure: /a failure this forcing never specifies/ }); } catch (error) { thrown = error; }
  if (!forcingReached(exitResults.get(t).directory, forcing)) return;
  assert.match(thrown?.message ?? '', /the exit took the diagnostic branch/, 'forcedExit swallowed a failure its forcing did not specify');
});

test('A0 exit answered control: the after-state sighting is confirmed live before the kill', SETTLES_WITHIN, async (t) => {
  exitAnswerRequired.add(t);
  await unnamedCensusCell(t, 'exit', 'A');
});

test('X0 exit answered control: the reaping read precedes the confirming read', SETTLES_WITHIN, async (t) => {
  exitAnswerRequired.add(t);
  await reapedCensusCell(t, 'exit');
});

/** Runs this file's test `title` alone, in its own runner, with every exit required to answer. */
async function answeredRun(t, title) {
  const pattern = `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const env = { ...process.env, EXIT_SIGHTING_REQUIRES: 'answered' };
  delete env.NODE_TEST_CONTEXT;
  const run = spawn(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // A nested run its test abandons at the test's bound is ended with its group, which it leads,
  // since a run left alive holds this file's process from exiting.
  const abandoned = () => { try { process.kill(-run.pid, 'SIGKILL'); } catch {} };
  t.signal.addEventListener('abort', abandoned, { once: true });
  let output = '';
  run.stdout.on('data', (chunk) => { output += chunk; });
  run.stderr.on('data', (chunk) => { output += chunk; });
  const [code] = await once(run, 'close');
  t.signal.removeEventListener('abort', abandoned);
  t.diagnostic(output.split('\n').filter((line) => /^# (tests|pass|fail)|exitSighting/.test(line)).join('\n'));
  assert.equal(code, 0, output);
  // Node 20 counts the tests the pattern skips (CI run 38755885716); Node 26 does not. Either way exactly
  // one test passed, it is the one named, and none failed or was cancelled.
  assert.match(output, /^# pass 1$/m, output);
  assert.match(output, /^# fail 0$/m, output);
  assert.match(output, /^# cancelled 0$/m, output);
  assert.match(output, new RegExp(`^ok \\d+ - ${pattern.slice(1, -1)}$`, 'm'), output);
}

for (const title of [
  'C615 fixture-preparation-valid binds the private cache to actual ps returns',
  'C615 fixture-cache-binding rejects a consumed value different from its preparatory original',
  'C615 fixture-outer-order rejects failed missing mismatched and reversed returned reads',
  'C615 fixture-retention reopens actual finalizer and recorded identities after teardown',
]) {
  test(`${title}, answered control`, SETTLES_WITHIN, async (t) => {
    await answeredRun(t, title);
  });
}

// Each record a real U1 E0 cutoff's events could be given beside L0's own, none of which any read
// of that exit supports: the cutoff check refuses every one.
for (const [label, extra] of [
  ['an unended survivor no post-kill read returned', { event: 'survivor.unended', pid: 999999 }],
  ['a named kill of a pid no read returned', { event: 'survivor.killed', pid: 999999 }],
  ['an event the exit cleanup does not record', { event: 'directory.unread', directory: '/nowhere', census: 'invented' }],
]) {
  test(`U1 exit E0: the cutoff check refuses ${label}`, SETTLES_WITHIN, async (t) => {
    const exit = await forcedExit(t, 'U1', { reads: [forced('state', 1, 'hang')] }, censusTimeout);
    if (exit === undefined) return;
    const { events, directory } = exitResults.get(t);
    assert.throws(() => exitCutoff(directory, exit, { prepared: false, status: 0, stderr: '', events: [...events, extra] }), /the exit's events differ from those its reads support/);
  });
}

/** Every event kind L0's source records, with the `.unended` each `.killed` kind ends as. */
const L0_EVENT_KINDS = ['group.killed', 'survivor.killed', 'survivor.unended', 'timeout.killed', 'timeout.unended', 'recorded.killed', 'recorded.unended', 'directory.unread', 'directory.skipped', 'output.held'];

/** Every field an L0 event of the exit cleanup or a directory census carries, beside one no event carries. */
const L0_EVENT_FIELDS = ['group', 'census', 'pid', 'name', 'cmd', 'reason', 'directory', 'killed', 'bound', 'invented'];

/**
 * Each mechanical variant of `events`, by label: every event with each field it lacks added, each
 * field it has changed and each removed, and its kind changed; and one extra event of every kind,
 * a copy of the exit's own where it has one.
 */
function eventVariants(events) {
  const variants = [];
  const swapped = (index, record) => events.map((each, at) => (at === index ? record : each));
  events.forEach((record, index) => {
    const at = `${record.event} #${index}`;
    for (const field of L0_EVENT_FIELDS) if (!(field in record)) variants.push([`${at} gains ${field}`, swapped(index, { ...record, [field]: ['pid', 'group', 'bound'].includes(field) ? 999999 : 'ghost' })]);
    for (const field of Object.keys(record).filter((key) => key !== 'event')) {
      variants.push([`${at} with ${field} changed`, swapped(index, { ...record, [field]: typeof record[field] === 'number' ? record[field] + 1 : `${JSON.stringify(record[field])}-changed` })]);
      const { [field]: _removed, ...rest } = record;
      variants.push([`${at} without ${field}`, swapped(index, rest)]);
    }
    variants.push([`${at} as another kind`, swapped(index, { ...record, event: L0_EVENT_KINDS.find((kind) => kind !== record.event) })]);
  });
  for (const kind of L0_EVENT_KINDS) {
    const own = events.find(({ event }) => event === kind);
    variants.push([`an extra ${kind}`, [...events, own ? { ...own } : { event: kind, pid: 999999, group: 999999 }]]);
  }
  return variants;
}

// A forced E0 census timeout: a real-deadline cutoff in every cell.
const E0_FORCING = { reads: [forced('state', 1, 'hang')] };

for (const [cell, run] of [
  ['U1', (t) => forcedExit(t, 'U1', E0_FORCING, censusTimeout)],
  ['X0', (t) => forcedExit(t, 'X0', E0_FORCING, censusTimeout)],
  // As the C615 tests run it: a prepared U2 exit through `censusExit`, its returned originals retained.
  ['C615 U2', async (t) => { exitForcings.set(t, E0_FORCING); await censusExit(t, 'U2'); return exitResults.get(t).exit; }],
]) {
  test(`${cell} exit E0: the cutoff check refuses every changed, added or extra event`, SETTLES_WITHIN, async (t) => {
    const exit = await run(t);
    if (exit === undefined) return;
    if (exit.branch !== 'cutoff') return t.skip(`the exit took the ${exit.branch} branch, not a cutoff`);
    const { events, directory } = exitResults.get(t);
    const check = (list) => exitCutoff(directory, exit, { prepared: false, status: 0, stderr: '', events: list });
    check(events);
    const variants = eventVariants(events);
    const missed = [];
    for (const [label, list] of variants) {
      try { check(list); missed.push(label); }
      catch (error) { if (!(error instanceof assert.AssertionError)) throw error; }
    }
    t.diagnostic(JSON.stringify({ events, variants: variants.length, missed }));
    assert.deepEqual(missed, [], 'the cutoff check accepted these variants of the exit\'s own events');
  });
}

/**
 * This process's live descendants by pid, state and command line: every process it started, or
 * one of those started, that has not ended, a zombie excepted, and the listing's own `ps` aside.
 */
function liveDescendants() {
  const rows = spawnSync(PS, ['-axo', 'pid=,ppid=,stat=,command='], { env: process.env, encoding: 'utf8' }).stdout.split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(([, pid, ppid, stat, command]) => ({ pid: Number(pid), ppid: Number(ppid), stat, command }));
  const ours = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (!ours.has(row.pid) && ours.has(row.ppid)) { ours.add(row.pid); grew = true; }
  }
  return rows.filter(({ pid, stat, command }) => pid !== process.pid && ours.has(pid) && !stat.startsWith('Z') && !command.startsWith('/bin/ps -axo'));
}

// The tests a nested run of this file defines where `EXIT_LEAK_HARNESS` names them, so that a test
// below can abandon an answered run, or an exit caller, at its own bound and see whether the file
// it ran in still exits. `leak hold` holds until its process is killed.
if (process.env.EXIT_LEAK_HARNESS === 'answered') {
  test('leak hold', async () => {
    const hold = spawn('/usr/bin/tail', ['-f', '/dev/null'], { stdio: 'ignore' });
    await once(hold, 'exit');
  });
  test('leak abandoned answered run', { timeout: 1 }, (t) => answeredRun(t, 'leak hold'));
}
if (process.env.EXIT_LEAK_HARNESS === 'exit') {
  test('leak abandoned exit caller', { timeout: 1 }, (t) => {
    // The callers running under this run's own temporary directory as the bound ends the test.
    t.signal.addEventListener('abort', () => {
      const callers = spawnSync(PS, ['-axww', '-o', 'pid=,command='], { env: process.env, encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(process.env.TMPDIR) && line.includes('caller.mjs'));
      process.stderr.write(`leak callers at abort: ${callers.length}\n`);
    });
    return censusExit(t, 'U1');
  });
}
if (process.env.EXIT_LEAK_HARNESS === 'forced') {
  // The forced class whose run overran its bound in CI run 38947643018, run as its own test does.
  const [, , forcing, expect] = CELL_CASES.find(([title]) => title.startsWith('A3 failure:'));
  test('leak abandoned X0 exit A3 failure', { timeout: 1 }, (t) => {
    // The processes under this run's own temporary directory as the bound ends the test.
    t.signal.addEventListener('abort', () => {
      const left = spawnSync(PS, ['-axww', '-o', 'pid=,command='], { env: process.env, encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(process.env.TMPDIR));
      process.stderr.write(`leak callers at abort: ${left.filter((line) => line.includes('caller.mjs')).length}\n`);
    });
    return forcedExit(t, 'X0', forcing, { ...expect, fails: typeof expect.fails === 'function' ? expect.fails('X0') : expect.fails });
  });
  // The same run, abandoned only once its forced confirming read has been reached: the test ends
  // there with the run still pending, as a test past its bound does.
  test('leak abandoned X0 exit A3 failure after its forced read', async (t) => {
    const pending = forcedExit(t, 'X0', forcing, { ...expect, fails: typeof expect.fails === 'function' ? expect.fails('X0') : expect.fails });
    pending.catch(() => {});
    const reached = () => readdirSync(process.env.TMPDIR).some((name) => name.startsWith('rigger-process-') && existsSync(join(process.env.TMPDIR, name, 'forced')) && readFileSync(join(process.env.TMPDIR, name, 'forced'), 'utf8').includes('confirm 1 answer-then-fail'));
    await until(reached, { signal: t.signal });
    const left = spawnSync(PS, ['-axww', '-o', 'pid=,command='], { env: process.env, encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(process.env.TMPDIR));
    process.stderr.write(`leak callers at abort: ${left.filter((line) => line.includes('caller.mjs')).length}\n`);
    throw new Error('abandoned after its forced read');
  });
}

if (process.env.EXIT_LEAK_HARNESS) {
  // Run after the abandoned test's teardown: nothing it started may still be running. An abandoned
  // answered run is ended by a signal, so it is looked for again a bounded number of times; the
  // scratch sweep has already ended an exit caller before this test begins. Whatever is left is
  // killed here, so the file can still exit and report this failure.
  test('leak left nothing running', (t) => {
    let left = liveDescendants();
    for (let look = 1; left.length > 0 && look < 20; look += 1) left = liveDescendants();
    t.after(() => { for (const { pid } of left) try { process.kill(pid, 'SIGKILL'); } catch {} });
    assert.deepEqual(left, [], 'a process the abandoned test started was still running after its teardown');
  });
}

/**
 * Runs this file's test `title` in a nested `node --test` whose process group is its own, with
 * `EXIT_LEAK_HARNESS` set to `harness`, and settles on its exit status and output once it has
 * closed. The group is killed at teardown, so a run that never closes ends with the test.
 */
async function leakRun(t, harness, title) {
  const env = { ...process.env, EXIT_LEAK_HARNESS: harness, TMPDIR: realpathSync(temporaryDirectory('rigger-leak-', { context: t })) };
  delete env.NODE_TEST_CONTEXT;
  const run = spawn(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^(${title}|leak left nothing running)$`, fileURLToPath(import.meta.url)], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  t.after(() => { if (!closed) try { process.kill(-run.pid, 'SIGKILL'); } catch {} });
  let output = '';
  run.stdout.on('data', (chunk) => { output += chunk; });
  run.stderr.on('data', (chunk) => { output += chunk; });
  const [code] = await once(run, 'close');
  closed = true;
  return { code, output };
}

for (const [harness, title] of [['answered', 'leak abandoned answered run'], ['exit', 'leak abandoned exit caller'], ['forced', 'leak abandoned X0 exit A3 failure'], ['forced', 'leak abandoned X0 exit A3 failure after its forced read']]) {
  test(`a file whose test ${title.replace('leak abandoned ', 'abandons its ')} at the test's bound still exits`, SETTLES_WITHIN, async (t) => {
    const { code, output } = await leakRun(t, harness, title);
    assert.equal(code, 1, output);
    assert.match(output, new RegExp(`^not ok \\d+ - ${title}$`, 'm'), output);
    assert.match(output, title.endsWith('forced read') ? /abandoned after its forced read/ : /test timed out after 1ms/, output);
    if (harness !== 'answered') assert.match(output, /leak callers at abort: 1$/m, output);
    assert.match(output, /^ok \d+ - leak left nothing running$/m, output);
  });
}

// proves R-STATE-12
test('B0 exit: a member named by the first census round remains recorded after later reads omit it', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusExit(t, 'B');
  if (exitCutoffs.has(events)) return;
  assertSighting(trace, two, 'B');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { outlasts: 'two' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: one }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /a read after the kill found/);
  assert.deepEqual([one, two].map(alive), [false, false]);
});

// proves R-STATE-19, R-STATE-12
test('a cut name read for an unshown member after the group kill cannot name it from partial output', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cut = heldOutput(t, directory, 'printf "cut"');
  const ps = fixture(directory, 'ps', [
    `[ -f "$here/hang" ] || { ${CUT_TWO}; exit 0; }`,
    'case "$*" in *"-o ucomm=")',
    cut.body,
    '  ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { refused: 'two' });

  const settled = called(directory, { command: leavingTwo(directory), ps, readTimeout: 1_000, kill: markingKill(directory, signals) });
  await cut.started();
  const { events } = await settled;

  const two = pidIn(directory, 'two');
  assert.equal(alive(two), true, 'the group kill ended the refused member');
  assert.deepEqual(recordOf(events, two), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'EPERM' }]);
});

// proves R-STATE-12, R-STATE-19
test('a cut state read after the group kill records that the read timed out', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cut = heldOutput(t, directory, 'printf "123"');
  const ps = fixture(directory, 'ps', [
    ("[ -f \"$here/hang\" ] || exec " + shellQuote(PS) + " \"$@\""),
    'case "$*" in "-g "*" -o pid=,stat=")',
    '  if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    '  fi ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const signals = standIn(directory, { refused: 'one' });

  const settled = called(directory, { command: leavingTwo(directory), ps, readTimeout: 300, kill: markingKill(directory, signals) });
  await cut.started();
  const { events } = await settled;

  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the group kill was not recorded: ${JSON.stringify(events)}`);
  assert.match(unread.census, /reads of the group after its kill failed[^]*process-table read timed out after 300 ms/);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'two.pid'), String(started.member));
  const signals = standIn(directory, { outlasts: 'two' });

  const { events } = await startKilled(started, { ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'recorded.killed', pid: started.leader }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /a read after the kill found/);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', outlasts: 'two' });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(status, 0);
  assert.deepEqual(events.filter(({ pid }) => pid === one || pid === two).map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: one }]);
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed').length, 1);
  if (process.platform === 'linux') {
    // A killed orphan can remain a zombie until its adopting parent reaps it.
    for (const pid of [one, two]) assert.match(processState(pid), /^(?:Z|$)/, `process ${pid} still runs after cleanup`);
    await until(() => [one, two].every((pid) => !alive(pid)), t);
  }
  assert.deepEqual([one, two].map(alive), [false, false]);
});

// proves R-STATE-19, R-STATE-12
test('given a process-table tool that fails every read, the call sends the kill on more than one look, records the kill of the group naming why, and settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `one` outlives the kill, so the group is still there for the look after the first.
  const signals = standIn(directory, { unkept: 'one' });
  let group;

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failing(directory), kill: signals.kill, onGroup: (id) => { group = id; } });

  assert.ok(groupKills(signals.pairs, group) > 1, `the call sent the kill to its group ${groupKills(signals.pairs, group)} time(s)`);
  // `one` outlives the kill and holds the command's output, so the call records that hold too.
  assert.deepEqual(events.map(({ event }) => event), ['group.killed', 'output.held']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19, R-STATE-10
test('given a process-table tool that fails every read but the start times\', a start\'s kill sends the kill on more than one look, records the kill of the group naming why, and settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: failing(directory), kill: signals.kill });

  assert.ok(groupKills(signals.pairs, started.group) > 1, `the start sent the kill to the group ${groupKills(signals.pairs, started.group)} time(s)`);
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19, R-STATE-9
test('given a process-table tool that fails every read, the exit cleanup sends the kill on more than one look, records the kill of the group naming why, and the caller ends', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  failing(directory);

  const { status, events, pairs } = await cleanedUp(directory, { ps: 'ps', unkept: 'one' });

  assert.equal(status, 0);
  const group = pidIn(directory, 'group');
  assert.ok(groupKills(pairs, group) > 1, `the cleanup sent the kill to the group ${groupKills(pairs, group)} time(s)`);
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19
test('given a member L0 may not signal and another, the call ends the other, records the first as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events, settled } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(two), false, 'the member L0 may signal is alive');
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  // `one` outlives the call and holds the command's output, so the call records that hold too.
  assert.deepEqual(events.filter(({ event }) => event === 'output.held').length, 1);
  assert.deepEqual(shown(events.filter(({ event }) => event !== 'output.held')).sort((a, b) => a.pid - b.pid), [
    { event: 'survivor.unended', pid: one, ...tailOf(directory), reason: 'EPERM' },
    { event: 'survivor.killed', pid: two, ...tailOf(directory) },
  ].sort((a, b) => a.pid - b.pid));
  assert.ok(settled - signals.first.at < KILL_BOUND, `the call settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded group with a member L0 may not signal, a start ends the leader, records the member as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events, settled } = await startKilled(started, { kill: signals.kill });

  assert.equal(alive(started.leader), false, 'the leader is alive');
  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === started.member).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'recorded.unended', ...tailOf(directory), reason: 'EPERM' },
  ]);
  assert.ok(settled - signals.first.at < KILL_BOUND, `the start settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-9
test('given a member L0 may not signal, the exit cleanup ends the others, records it as a process it could not end because of EPERM, and the caller ends before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, exiting, ended } = await cleanedUp(directory, { refused: 'one' });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(status, 0);
  assert.equal(alive(two), false, 'the member L0 may signal is alive');
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: 'EPERM' },
  ]);
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});

// proves R-STATE-19
test('given a member the kill does not end, the call settles once KILL_BOUND has passed since its first kill, and records it as a process it could not end, alive at the bound', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events, settled } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.equal(alive(two), false, 'the other member is alive');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive ${KILL_BOUND} ms after L0's first kill` },
  ]);
  assert.ok(settled - signals.first.at >= KILL_BOUND, `the call settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded group with a member the kill does not end, a start settles once KILL_BOUND has passed since its first kill, and records it as a process it could not end, alive at the bound', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events, settled } = await startKilled(started, { kill: signals.kill });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === started.member).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'recorded.unended', ...tailOf(directory), reason: `still alive ${KILL_BOUND} ms after L0's first kill` },
  ]);
  assert.ok(settled - signals.first.at >= KILL_BOUND, `the start settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-9
test('given a member the kill does not end, the exit cleanup records it as a process it could not end, alive at the cleanup\'s own bound, and waits on no longer bound', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { unkept: 'one' });

  const one = pidIn(directory, 'one');
  assert.equal(status, 0);
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
  // The cleanup's confirmation reads until its own bound has passed since it began, which is after
  // the caller began to exit, and records the member only then.
  assert.ok(ended - exiting >= CLEANUP_BOUND, `the caller ended ${ended - exiting} ms after it began to exit, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  const first = killedIn(pairs, -pidIn(directory, 'group'));
  assert.ok(ended - first < KILL_BOUND, `the caller ended ${ended - first} ms after its first kill`);
});

/** A dispatch's directory in `directory`, `work`, holding a `tail` outside every group, as `outside.pid`. */
async function workedIn(t, directory) {
  const work = join(directory, 'work');
  mkdirSync(work);
  writeFileSync(join(directory, 'outside.pid'), String(await tailIn(t, directory, join(work, 'sub'))));
  return work;
}

/** Asserts the census recorded the outside process in `events` as one it could not end, for `reason`, and nowhere as killed. */
function assertUnended(directory, events, event, reason) {
  const outside = pidIn(directory, 'outside');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event: name, name: command, cmd, reason: why }) => ({ event: name, name: command, cmd, reason: why })), [
    { event, ...tailOf(directory), reason },
  ]);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
}

/** A post-kill state read that fails on standard error, then answers with a zombie row. */
function failingReaped(directory, outside, ready, earlierAnswer = false) {
  return fixture(directory, 'ps', [
    `[ -f "$here/${ready}" ] || exec ${shellQuote(PS)} "$@"`,
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    ...(earlierAnswer ? [`  if /bin/mkdir "$here/answered" 2>/dev/null; then printf "%s S\\n" "${outside}"; exit 0; fi`] : []),
    '  if /bin/mkdir "$here/failed" 2>/dev/null; then echo "ps: reaped failure" >&2; exit 2; fi',
    `  printf "%s Z\\n" "${outside}"; exit 0 ;;`,
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
}

/** Advances only the async read driver's clock after a completed state read marks `clock-cut`. */
async function cutAsyncReading(directory, action) {
  const now = Date.now;
  let jumps = 0;
  Date.now = () => {
    const caller = new Error().stack?.split('\n')[2] ?? '';
    if (existsSync(join(directory, 'clock-cut')) && caller.includes('at reading (')) {
      jumps += 1;
      return now() + KILL_BOUND + 10_000;
    }
    return now();
  };
  try {
    return { result: await action(), jumps };
  } finally {
    Date.now = now;
  }
}

// proves R-STATE-26
test('D1: an answered first directory listing omits the outside PID without inventing a result', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  writeFileSync(join(directory, 'runner.pid'), String(process.pid));
  fixture(directory, 'lsof', [
    'printf "%s\\n" "$*" >> "$here/lsof-reads"',
    'if ! (',
    listingOf('runner', realpathSync.native(process.cwd())),
    ') > "$here/first-listing-answer"; then exit 2; fi',
    'exec /bin/cat "$here/first-listing-answer"',
  ].join('\n'));

  const { status, stderr, events, pairs } = await cleanedUp(directory, { directory: work, lsof: 'lsof' });
  assert.equal(status, 0, stderr);
  assert.equal(existsSync(join(directory, 'lsof-reads')), true, 'the first directory listing was not reached');
  assert.deepEqual(read(directory, 'lsof-reads').trimEnd().split('\n'), [
    `-w -n -P -a -d cwd -u ${process.getuid()} -F pun`,
  ]);
  assert.equal(existsSync(join(directory, 'first-listing-answer')), true, 'the reached listing did not return an answer');
  const answer = read(directory, 'first-listing-answer');
  assert.match(answer, new RegExp(`^p${process.pid}$`, 'm'));
  assert.doesNotMatch(answer, new RegExp(`^p${outside}$`, 'm'));
  assert.deepEqual(events.filter(({ directory: at }) => at === work), []);
  assert.deepEqual(events.filter(({ pid }) => pid === outside), []);
  assert.equal(pairs.some(([target]) => target === outside), false);
  assert.equal(alive(outside), true, 'the omitted outside process was ended, so the test proves nothing');
});

// proves R-STATE-19
test('given a dispatch\'s directory holding a process L0 may not signal, the call\'s census records it as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { refused: 'outside' });
  const began = Date.now();

  const { events, settled } = await called(directory, { command: '/usr/bin/true', directory: work, kill: signals.kill });

  assertUnended(directory, events, 'survivor.unended', 'EPERM');
  assert.ok(settled - began < KILL_BOUND, `the call settled ${settled - began} ms after it began`);
});

// proves R-STATE-19
test('a cut name read while describing a refused directory process does not supply its name', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, 'printf "cut"');
  const ps = fixture(directory, 'ps', [
    `case "$*" in "-p ${outside} -o ucomm=")`,
    cut.body,
    '  ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const signals = standIn(directory, { refused: 'outside' });

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill: signals.kill });
  await cut.started();
  const { events } = await settled;

  assert.deepEqual(recordOf(events, outside), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'EPERM' }]);
  assert.equal(alive(outside), true, 'the refused directory process was ended');
  assert.ok(!processState(outside).startsWith('T'), 'the refused directory process was left stopped');
});

// proves R-STATE-19
test('a cut name read while describing a killed unnamed directory process does not supply its name', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, 'printf "cut"');
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    `case "$*" in "-p ${outside} -o ucomm=")`,
    '  if /bin/mkdir "$here/first" 2>/dev/null; then echo "ps: unread" >&2; exit 2; fi',
    cut.body,
    '  ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill: signals.kill });
  await cut.started();
  const { events } = await settled;

  assert.deepEqual(recordOf(events, outside), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'not shown to have ended: the process table could not be read' }]);
  assert.equal(alive(outside), true, 'the unnamed process was ended');
  assert.ok(!processState(outside).startsWith('T'), 'the unnamed process was left stopped');
});

// proves R-STATE-19
test('after an answered directory kill wait, a cut state read at its deadline keeps the earlier live answer', SETTLES_WITHIN, async (t) => {
  await failedAsyncWait(t);
  await lateAsyncWait(t);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, `printf '${outside}'`);
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    ("[ -f \"$here/outside-killed\" ] || exec " + shellQuote(PS) + " \"$@\""),
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    ("  if /bin/mkdir \"$here/answered\" 2>/dev/null; then exec " + shellQuote(PS) + " \"$@\"; fi"),
    cut.body,
    '  ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill });
  await cut.started();
  const { events } = await settled;

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-19
test('without an answered directory kill wait, a timed-out state read records that the process could not be shown ended', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    ("[ -f \"$here/outside-killed\" ] || exec " + shellQuote(PS) + " \"$@\""),
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill });

  assert.ok(existsSync(join(directory, 'timed-out')), 'no read of the killed process reached its timeout');
  assertUnended(directory, events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
});

// proves R-STATE-19
test('given a dispatch\'s directory holding a process the kill does not end, the call\'s census settles once KILL_BOUND has passed since its kill, records it as a process it could not end, alive at the bound, and leaves it running', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { unkept: 'outside' });
  const outside = pidIn(directory, 'outside');

  const { events, settled } = await called(directory, { command: '/usr/bin/true', directory: work, kill: signals.kill });

  assertUnended(directory, events, 'survivor.unended', `still alive ${KILL_BOUND} ms after L0's kill`);
  const killed = signals.killedAt(outside);
  assert.ok(killed !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  assert.ok(settled - killed >= KILL_BOUND, `the call settled ${settled - killed} ms after the census's kill of the outside process`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded dispatch\'s directory holding a process L0 may not signal, a start\'s sweep records it as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const started = await startGroup(t, directory, 'group');
  const signals = standIn(directory, { refused: 'outside' });
  const began = Date.now();

  const { events, settled } = await startKilled(started, { directory: work, identity: identityOf(work), kill: signals.kill });

  assertUnended(directory, events, 'recorded.unended', 'EPERM');
  assert.ok(settled - began < KILL_BOUND, `the start settled ${settled - began} ms after it began`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded dispatch\'s directory holding a process the kill does not end, a start\'s sweep settles once KILL_BOUND has passed, records it as a process it could not end, alive at the bound, and leaves it running', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const started = await startGroup(t, directory, 'group');
  const signals = standIn(directory, { unkept: 'outside' });

  const { events, settled } = await startKilled(started, { directory: work, identity: identityOf(work), kill: signals.kill });

  assertUnended(directory, events, 'recorded.unended', `still alive ${KILL_BOUND} ms after L0's kill`);
  const killed = signals.killedAt(pidIn(directory, 'outside'));
  assert.ok(killed !== undefined, 'the sweep never sent the outside process its kill, so the test proves nothing');
  assert.ok(settled - killed >= KILL_BOUND, `the start settled ${settled - killed} ms after the sweep's kill of the outside process`);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process L0 may not signal, the exit cleanup\'s census records it as a process it could not end because of EPERM, and the caller ends before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const { status, events, exiting, ended } = await cleanedUp(directory, { directory: work, lsof: 'lsof', refused: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', 'EPERM');
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});

// proves R-STATE-19, R-STATE-9
test('D9: a padding-only name answer leaves an EPERM directory survivor unnamed with its returned command', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'if [ "$*" = "-p $pid -o ucomm=" ]; then',
    '  : > "$here/name-read"',
    "  printf '   \\n'",
    '  exit 0',
    'fi',
    'if [ "$*" = "-ww -p $pid -o pid=,command=" ]; then : > "$here/command-read"; fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, events, pairs } = await cleanedUp(directory, { directory: work, ps: 'ps', lsof: 'lsof', refused: 'outside' });
  const outside = pidIn(directory, 'outside');
  const recorded = events.filter(({ pid }) => pid === outside);

  assert.equal(status, 0);
  assert.equal(existsSync(join(directory, 'name-read')), true, 'the padded ucomm read was not reached');
  assert.equal(existsSync(join(directory, 'command-read')), true, 'the command read was not reached');
  assert.equal(events.some(({ event }) => event === 'directory.unread'), false, 'the first listing did not answer');
  assert.ok(pairs.some(([target, signal]) => target === outside && signal === 'SIGSTOP'), 'the census never tried to stop the listed PID');
  assert.equal(pairs.some(([target, signal]) => target === outside && signal === 'SIGKILL'), false);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded.map(({ event, pid, cmd, reason }) => ({ event, pid, cmd, reason })), [
    { event: 'survivor.unended', pid: outside, cmd: tailOf(directory).cmd, reason: 'EPERM' },
  ]);
  assert.equal(recorded[0].name, undefined, 'padding from ucomm is not a process name');
});

test('D02: a failed first directory listing records the directory without naming an outside process', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', ': > "$here/first-listing-entered"\necho "lsof: forced first-listing failure" >&2\nexit 2');

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { directory: work, lsof: 'lsof', refused: 'outside' });
  const outside = pidIn(directory, 'outside');
  t.diagnostic(JSON.stringify({ outside, exiting, ended, events, pairs }));
  assert.equal(status, 0);
  assert.equal(existsSync(join(directory, 'first-listing-entered')), true);
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /lsof: forced first-listing failure/);
  assert.deepEqual(events.filter(({ pid }) => pid === outside), []);
  assert.equal(pairs.some(([target]) => target === outside), false);
  assert.equal(alive(outside), true);
});

test('D03: an expired first directory listing records the directory without naming an outside process', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', ': > "$here/first-listing-entered"\n' + listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { directory: work, lsof: 'lsof', refused: 'outside', censusElapsed: CLEANUP_BOUND + 1 });
  const outside = pidIn(directory, 'outside');
  t.diagnostic(JSON.stringify({ outside, exiting, ended, events, pairs }));
  assert.equal(status, 0);
  assert.equal(existsSync(join(directory, 'census-clock-cut')), true);
  assert.equal(existsSync(join(directory, 'first-listing-entered')), false);
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within 1000 ms/);
  assert.deepEqual(events.filter(({ pid }) => pid === outside), []);
  assert.equal(pairs.some(([target]) => target === outside), false);
  assert.equal(alive(outside), true);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process the kill does not end, the exit cleanup\'s census records it as a process it could not end, alive at the cleanup\'s own bound, and leaves it running', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { directory: work, unkept: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  const killed = killedIn(pairs, pidIn(directory, 'outside'));
  assert.ok(killed !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  // The census waits on what it killed within the cleanup's own bound from its kill, which is after
  // the caller began to exit, and records the process only once that bound has passed.
  assert.ok(ended - exiting >= CLEANUP_BOUND, `the caller ended ${ended - exiting} ms after it began to exit, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  assert.ok(ended - killed < KILL_BOUND, `the caller ended ${ended - killed} ms after the census's kill of the outside process`);
});

// proves R-STATE-19, R-STATE-9
test('after an answered read, a timed-out read of a killed directory process records what the earlier read found alive', SETTLES_WITHIN, async (t) => {
  await failedSynchronousWait(t, true);
  await lateSynchronousWait(t, true);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    ("[ -f \"$here/hang\" ] || exec " + shellQuote(PS) + " \"$@\""),
    'case "$*" in *"-o pid=,stat="*)',
    ("  if /bin/mkdir \"$here/answered\" 2>/dev/null; then exec " + shellQuote(PS) + " \"$@\"; fi"),
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill answered');
  assert.ok(existsSync(join(directory, 'timed-out')), 'no later read reached its timeout');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-19, R-STATE-9
test('an exit-cleanup read whose child exits 0 with its output open is reported by runNow as timed out', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingNone(directory);
  const cut = heldOutput(t, directory, 'printf "123"');
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*)',
    cut.body,
    '  ;;',
    ("  *) exec " + shellQuote(PS) + " \"$@\" ;;"),
    'esac',
  ].join('\n'));

  const settled = cleanedUp(directory, { ps: 'ps', readTimeout: CLEANUP_BOUND });
  await cut.started();
  const { status, events } = await settled;

  assert.equal(status, 0);
  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the cleanup took the cut table as a complete read: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 1000 ms/);
});

// proves R-STATE-19, R-STATE-9
test('without an answered read, a timed-out read of a killed directory process records that it could not be shown ended', SETTLES_WITHIN, async (t) => {
  await failedSynchronousWait(t, false);
  await lateSynchronousWait(t, false);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    ("[ -f \"$here/hang\" ] || exec " + shellQuote(PS) + " \"$@\""),
    'case "$*" in *"-o pid=,stat="*)',
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'timed-out')), 'the wait made no timed-out read');
  assertUnended(directory, events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
});

/** Shows that an async failed read after a live answer is retried and the next answer is used. */
async function failedAsyncWait(t) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };
  const ps = failingReaped(directory, outside, 'outside-killed', true);
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, kill, readTimeout: 2_000 });

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assert.ok(existsSync(join(directory, 'failed')), 'the read after the live answer did not fail on standard error');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.killed']);
  assert.equal(alive(outside), true, 'the signal stand-in ended the process before its state reads');
}

/** Shows that an async read begun past the deadline uses the prior live answer. */
async function lateAsyncWait(t) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };
  const ps = fixture(directory, 'ps', [
    ("[ -f \"$here/outside-killed\" ] || exec " + shellQuote(PS) + " \"$@\""),
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    '  if /bin/mkdir "$here/answered" 2>/dev/null; then',
    `    printf '%s S\\n' '${outside}'; : > "$here/clock-cut"; exit 0`,
    '  fi',
    '  : > "$here/unexpected-read"; exit 2 ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { result: { events }, jumps } = await cutAsyncReading(directory, () => called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, kill, readTimeout: 300 }));

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assert.ok(jumps > 0, 'the next read did not see the cut deadline');
  assert.equal(existsSync(join(directory, 'unexpected-read')), false, 'a read ran after LATE');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
}

/** Runs an exit-cleanup directory wait with a failing state read, with or without a prior answer. */
async function failedSynchronousWait(t, earlierAnswer) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  failingReaped(directory, outside, 'hang', earlierAnswer);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.equal(existsSync(join(directory, 'answered')), earlierAnswer, 'the prior-answer branch was not forced');
  assert.ok(existsSync(join(directory, 'failed')), 'the state read did not fail on standard error');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.killed']);
  assert.equal(alive(outside), true, 'the signal stand-in ended the process before its state reads');
}

/**
 * A `ps` stand-in that, until `$here/hang` exists, holds the census's read of the outside process's
 * name, `-p <pid> -o ucomm=`, marking `$here/held`, until the census's own bound gives it up, and
 * answers every other read as `ps` does. So the census's bound runs out after it has stopped the
 * process and listed it again, and before it has read its name (#579).
 */
const holdingName = (directory) => fixture(directory, 'ps', [
  'if [ ! -f "$here/hang" ] && [ "$*" = "-p $(/bin/cat "$here/outside.pid") -o ucomm=" ]; then : > "$here/held"; exec /usr/bin/tail -f "$here/hold"; fi',
  ("exec " + shellQuote(PS) + " \"$@\""),
].join('\n'));

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose bound runs out after it has stopped and listed again a process the kill does not end, and before it has read that process\'s name, the exit cleanup still records it by name and command line as alive at the cleanup\'s own bound of its kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  holdingName(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { status, events, pairs } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside' });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'held')), 'the census never read the outside process\'s name before its kill, so the test proves nothing');
  assert.ok(events.some(({ event }) => event === 'directory.unread'), 'the census\'s reads before its kill answered within its bound, so the test proves nothing');
  assert.ok(killedIn(pairs, pidIn(directory, 'outside')) !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-18, R-STATE-19
test('given a dispatch\'s directory holding a process the kill does not end, and a process table that cannot be read once the census has sent that kill, the census resumes the process and records it as a process it could not end, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { unkept: 'outside' });
  const outside = pidIn(directory, 'outside');
  // The signal call marks `killed` once the census has sent the outside process its kill, and the
  // stand-in for `ps` fails every read from then on.
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'killed'), '');
    return signals.kill(target, name);
  };
  const ps = fixture(directory, 'ps', ("[ -f \"$here/killed\" ] && { echo \"ps: failing on purpose\" >&2; exit 2; }\nexec " + shellQuote(PS) + " \"$@\""));

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, kill, ps });

  assert.ok(signals.killedAt(outside) !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === outside);
  assert.deepEqual(recorded.map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.unended', ...tailOf(directory) }]);
  assert.match(recorded[0].reason, /could not be read/);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
});

/** A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on never answers. */
const hanging = (directory) => fixture(directory, 'ps', ("[ -f \"$here/hang\" ] && exec /usr/bin/tail -f \"$here/hold\"\nexec " + shellQuote(PS) + " \"$@\""));

// proves R-STATE-19, R-STATE-9
test('given a process table that stops answering once the exit cleanup has sent its first kill of a group, the caller ends within the cleanup\'s own bound of that kill, and the group\'s members are not alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hanging(directory);

  const { status, pairs, ended } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
  // The cleanup's reads after that kill are given up at its own bound, read by read, so only the
  // time it takes to end the process lies past it.
  const first = killedIn(pairs, -pidIn(directory, 'group'));
  assert.ok(ended - first < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - first} ms after its first kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

// proves R-STATE-19, R-STATE-9
test('given a process table that stops answering once the exit cleanup\'s census has sent its kill to a process in the dispatch\'s directory that outlives it, the caller ends within the cleanup\'s own bound of that kill, and the process is recorded as one it could not end and not left stopped', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  hanging(directory);

  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const { status, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', directory: work, lsof: 'lsof', hangAfter: 'outside', unkept: 'outside' });

  const outside = pidIn(directory, 'outside');
  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the census never sent the outside process its kill, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.unended']);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
  const killed = killedIn(pairs, outside);
  assert.ok(ended - killed < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - killed} ms after the census's kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

/**
 * Has the exit cleanup end a group under `table`, a stand-in for `ps` that changes how it answers
 * once the cleanup has sent its first kill of the group, with `options` added to `CALLER`'s, and
 * asserts it records the leader not as killed but as a process it could not end, for `reason`, and
 * hands its step no exit code but an `unread` that matches `why`. It hands back the leader's pid and
 * the scratch directory.
 */
async function assertLeaderNotKilled(t, { table = hanging, options = {}, reason, why }) {
  const directory = holding(t);
  holdingTwo(directory);
  table(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', ...options });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === group);
  assert.deepEqual(recorded.map(({ event }) => event), ['survivor.unended']);
  assert.match(recorded[0].reason, reason);
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', why, JSON.stringify(ending));
  return { group, directory };
}

// proves R-STATE-19, R-STATE-9
test('given a leader L0 may not signal, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup records the leader as a process it could not end because of EPERM, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { options: { refused: 'group' }, reason: /^EPERM$/, why: /could not end the command: EPERM/ });
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
});

// proves R-STATE-19, R-STATE-9
test('given a leader the kill does not end, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup records the leader as not shown to have ended, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { options: { unkept: 'group' }, reason: /^not shown to have ended: the process table could not be read/, why: /the command was not shown to have ended: the process table could not be read/ });
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
});

/**
 * A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on
 * answers each as `ps` does where no process matches: it exits 1 and prints nothing.
 */
const emptyAfterKill = (directory) => fixture(directory, 'ps', ("[ -f \"$here/hang\" ] && exit 1\nexec " + shellQuote(PS) + " \"$@\""));

/** The leader must end within `gone`'s bound; report its last state if it does not. */
async function assertLeaderGone(group, within) {
  assert.ok(await gone(group, within), `the leader outlived the kill, so the test proves nothing: ${processState(group)}`);
}

// proves R-STATE-19, R-STATE-9
test('given a read after the exit cleanup\'s kill that exits 1 and prints nothing while the leader\'s zombie is still in the group, the cleanup records the leader as not shown to have ended, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { table: emptyAfterKill, reason: /^not shown to have ended: .*did not list its leader/, why: /the command was not shown to have ended: .*did not list its leader/ });
  await assertLeaderGone(group);
});

test('the guard waits for a leader to end after its first read', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const leader = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { detached: true, stdio: 'ignore' });
  t.after(() => ended(leader));
  assert.equal(alive(leader.pid), true);
  setImmediate(() => leader.kill('SIGKILL'));
  await assertLeaderGone(leader.pid);
});

test('the guard fails for a live leader outside every group L0 killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const leader = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { detached: true, stdio: 'ignore' });
  t.after(() => ended(leader));
  assert.equal(alive(leader.pid), true);
  await assert.rejects(assertLeaderGone(leader.pid, 100), /the leader outlived the kill, so the test proves nothing:/);
  assert.equal(alive(leader.pid), true);
});

/** Where `CALLER` defines its signal call: the line the settling variant below extends. */
const KILL_ANCHOR = 'const kill = (target, name) => { ';

/**
 * `CALLER`, but with a leader that answers signal 0 with `EPERM` on every look but one that follows a
 * kill sent to it or to its group since the look before: a process still exiting, as the kernel
 * answers for one for a moment (`unended` in `src/substrate/process.mjs`), until L0's next kill
 * reaches it. Every signal still reaches the leader as `CALLER`'s own signal call sends it. It
 * appends each look at the leader to `$here/looks`: `E` where it answered `EPERM`, `A` otherwise.
 */
const SETTLING = (() => {
  assert.equal(CALLER.split(KILL_ANCHOR).length, 2, 'CALLER no longer defines its signal call where the settling variant extends it');
  return CALLER.replace(KILL_ANCHOR, [
    'let killedSinceLook = false;',
    "const settling = (target, name) => { const leader = pidIn('group'); if (name === 'SIGKILL' && (target === leader || target === -leader)) killedSinceLook = true; if (name !== 0 || target !== leader) return; const killed = killedSinceLook; killedSinceLook = false; appendFileSync(join(here, 'looks'), killed ? 'A' : 'E'); if (!killed) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM', errno: -1, syscall: 'kill' }); };",
    `${KILL_ANCHOR}settling(target, name); `,
  ].join('\n'));
})();

/** `cleanedUp`, run with `caller`'s source in place of `CALLER`'s. */
async function cleanedUpBy(caller, directory, options) {
  const path = join(directory, 'caller.mjs');
  writeFileSync(path, caller);
  const run = spawn(process.execPath, [path, directory, JSON.stringify({ readTimeout: CLEANUP_BOUND, ...options })], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status] = await once(run, 'exit');
  return { status, stderr, events: linesOf(directory, 'events') };
}

/** A caller whose synchronous read driver sees an expired clock only after `clock-cut` is marked. */
const CLOCKED_CALLER = (() => {
  const anchor = 'const options = JSON.parse(process.argv[3]);';
  assert.equal(CALLER.split(anchor).length, 2, 'the caller options moved, so the clock forcing did not land');
  return CALLER.replace(anchor, [
    anchor,
    'const realNow = Date.now;',
    "Date.now = () => { const caller = new Error().stack?.split('\\n')[2] ?? ''; if (options.clockCut && existsSync(join(here, 'clock-cut')) && caller.includes(options.clockInEmptied ? 'at emptied (' : 'at readingNow (')) { if (options.clockAfterDeadline && !globalThis.clockDeadlineSet) { globalThis.clockDeadlineSet = true; appendFileSync(join(here, 'clock-deadline'), 'D'); return realNow(); } appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow() + options.clockCut; } return realNow(); };",
  ].join('\n'));
})();

/** A caller that records each synchronous read and signal answer in the order L0 receives them. */
const TRACED_CALLER = (() => {
  const sourceImport = CALLER.split('\n')[0];
  const emitterLine = CALLER.split('\n').find((line) => line.startsWith('const emitter = '));
  const killLine = CALLER.split('\n').find((line) => line.startsWith('const kill = '));
  const clockLine = CLOCKED_CALLER.split('\n').find((line) => line.startsWith('Date.now = () =>'));
  assert.ok(sourceImport.startsWith('import { runCommand } from '), 'the caller no longer imports L0 first');
  assert.ok(emitterLine && killLine && clockLine, 'the caller no longer exposes its events, signals and clock');
  for (const anchor of [sourceImport, emitterLine, killLine, clockLine, "existsSync(join(here, 'clock-cut')) && caller.includes", "appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow()"]) {
    assert.equal(CLOCKED_CALLER.split(anchor).length, 2, `the traced caller no longer has exactly one ${anchor} anchor`);
  }
  return CLOCKED_CALLER.replace(clockLine, clockLine.replace('if (options.clockCut &&', "if (options.clockAtReaped && existsSync(join(here, 'clock-cut'))) { trace('clock-stack', { caller }); if (caller.includes('reaped')) { trace('bound-evaluated', { branch: options.clockBranch, elapsed: options.clockCut }); return realNow() + options.clockCut; } } if (options.clockCut &&"))
    .replace("existsSync(join(here, 'clock-cut')) && caller.includes", "(existsSync(join(here, 'clock-cut')) || (options.clockAtListing && existsSync(join(here, 'post-kill-omitted')))) && caller.includes")
    .replace("appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow()", "appendFileSync(join(here, 'clock-jumps'), 'J'); trace('read-cut', { code: 'LATE' }); return realNow()")
    .replace(sourceImport, [
    "import { syncBuiltinESMExports } from 'node:module';",
    "import childProcess from 'node:child_process';",
    "import { appendFileSync as traceAppend } from 'node:fs';",
    "import { join as traceJoin } from 'node:path';",
    'const traceHere = process.argv[2];',
    'let traceSequence = 0;',
    'const actualNow = Date.now.bind(Date);',
    "const trace = (kind, fields = {}) => traceAppend(traceJoin(traceHere, 'control.trace.jsonl'), `${JSON.stringify({ sequence: ++traceSequence, at: actualNow(), kind, ...fields })}\\n`);",
    "const markers = () => { const count = traceJoin(traceHere, 'state-count'); return { stateCount: existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0, stateLive: existsSync(traceJoin(traceHere, 'state-live')), stateTimeout: existsSync(traceJoin(traceHere, 'state-timeout')), listingOmitted: existsSync(traceJoin(traceHere, 'post-kill-omitted')), listingFailed: existsSync(traceJoin(traceHere, 'post-kill-failed')), listingTimeout: existsSync(traceJoin(traceHere, 'post-kill-timeout')) }; };",
    'const originalSpawnSync = childProcess.spawnSync;',
    "childProcess.spawnSync = (tool, args, options) => { const started = Date.now(); trace('read-start', { tool, args, remaining: options?.timeout, markers: markers() }); const result = originalSpawnSync(tool, args, options); trace('read-end', { tool, args, started, status: result.status, signal: result.signal, error: result.error?.code, stdout: result.stdout, stderr: result.stderr, markers: markers() }); return result; };",
    'syncBuiltinESMExports();',
    sourceImport.replace('import { runCommand } from ', 'const { runCommand } = await import(').replace(/;$/, ');'),
  ].join('\n')).replace(killLine,
    killLine.replace('const kill = (target, name) => {', "const kill = (target, name) => { trace('signal-start', { target, name });")
      .replace('return signalled(target, name);', "try { const answer = signalled(target, name); trace('signal-answer', { target, name, answer }); if (options.clockAtKill && target === pidIn('outside') && name === 'SIGKILL') { appendFileSync(join(here, 'clock-cut'), 'K'); trace('clock-armed', { boundary: 'first-state' }); } return answer; } catch (error) { trace('signal-answer', { target, name, error: error.code }); throw error; }"))
    .replace(emitterLine, "const emitter = { emit: (event, fields) => { trace('event', { event, ...fields }); appendFileSync(join(here, 'events'), `${JSON.stringify({ event, ...fields })}\\n`); } };")
    .replace("while (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));", "process.on('exit', (status) => trace('caller-end', { status }));\nwhile (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));");
})();

/** The private returned-value observer shared by the two real-tool Mac callers. */
const MAC_RETURNED_OBSERVER = [
  "const returnedHere = traceJoin(traceHere, 'returned-tool-reads');",
  'readMkdir(returnedHere, { mode: 0o700 });',
  'let readSequence = 0;',
  'const pendingReads = new Set();',
  ("const watched = (tool) => tool === " + JSON.stringify(LSOF) + " || tool === " + JSON.stringify(PS) + ";"),
  "const recordRead = (entry) => traceAppend(traceJoin(returnedHere, 'manifest.jsonl'), JSON.stringify(entry) + '\\n', { mode: 0o600 });",
  "const beginRead = (mode, tool, args, options) => { const id = 'r' + String(++readSequence).padStart(6, '0'); const at = process.hrtime.bigint().toString(); trace('read-start', { readId: id, mode, tool, args, remaining: options?.timeout, markers: markers() }); const traceStart = traceSequence; recordRead({ kind: 'start', id, mode, tool, args, options: { timeout: options?.timeout, encoding: options?.encoding }, at, traceStart }); pendingReads.add(id); return { id, mode, tool, args, at, traceStart }; };",
  "const keepStream = (id, name, present, value) => { const type = !present ? 'absent' : value === null ? 'null' : typeof value; if (type !== 'string') return { present, type }; const file = id + '.' + name + '.utf8'; const bytes = Buffer.from(value, 'utf8'); readWrite(traceJoin(returnedHere, file), bytes, { flag: 'wx', mode: 0o600 }); return { present, type, file, bytes: bytes.length, sha256: readHash('sha256').update(bytes).digest('hex') }; };",
  "const endRead = (read, outcome) => { const stdout = keepStream(read.id, 'stdout', outcome.stdoutPresent, outcome.stdout); const stderr = keepStream(read.id, 'stderr', outcome.stderrPresent, outcome.stderr); trace('read-end', { readId: read.id, mode: read.mode, tool: read.tool, args: read.args, started: read.at, status: outcome.status, signal: outcome.signal, error: outcome.error?.code ?? null, stdout: outcome.stdout, stderr: outcome.stderr, stdoutType: stdout.type, stderrType: stderr.type, markers: markers() }); recordRead({ kind: 'end', id: read.id, mode: read.mode, tool: read.tool, args: read.args, started: read.at, ended: process.hrtime.bigint().toString(), traceStart: read.traceStart, traceEnd: traceSequence, status: outcome.status, signal: outcome.signal, error: outcome.error ?? null, stdout, stderr }); pendingReads.delete(read.id); };",
  "process.on('exit', () => { for (const id of pendingReads) recordRead({ kind: 'unresolved', id }); });",
  "childProcess.spawnSync = function(tool, args, options) { if (!watched(tool)) return originalSpawnSync.apply(this, arguments); const read = beginRead('spawnSync', tool, args, options); let result; try { result = originalSpawnSync.apply(this, arguments); } catch (error) { trace('read-threw', { readId: read.id, mode: read.mode, tool, args, code: error.code ?? null }); recordRead({ kind: 'threw', id: read.id, mode: read.mode, tool, args, started: read.at, ended: process.hrtime.bigint().toString(), traceStart: read.traceStart, traceEnd: traceSequence, error: { name: error.name, code: error.code ?? null } }); throw error; } try { endRead(read, { status: result.status, signal: result.signal, error: result.error && { name: result.error.name, code: result.error.code, signal: result.error.signal }, stdoutPresent: Object.hasOwn(result, 'stdout'), stdout: result.stdout, stderrPresent: Object.hasOwn(result, 'stderr'), stderr: result.stderr }); } catch { /* The missing end or original fails the test's closed evidence check. */ } return result; };",
  'const originalExecFile = childProcess.execFile;',
  "childProcess.execFile = function(tool, args, options, callback) { if (!watched(tool)) return originalExecFile.apply(this, arguments); const read = beginRead('execFile', tool, args, options); const forwarded = function(error, stdout, stderr) { try { endRead(read, { status: error?.code ?? 0, signal: error?.signal ?? null, error: error && { name: error.name, code: error.code, signal: error.signal }, stdoutPresent: arguments.length > 1, stdout, stderrPresent: arguments.length > 2, stderr }); } catch { /* The missing end or original fails the test's closed evidence check. */ } return callback.apply(this, arguments); }; try { return originalExecFile.call(this, tool, args, options, forwarded); } catch (error) { trace('read-threw', { readId: read.id, mode: read.mode, tool, args, code: error.code ?? null }); recordRead({ kind: 'threw', id: read.id, mode: read.mode, tool, args, started: read.at, ended: process.hrtime.bigint().toString(), traceStart: read.traceStart, traceEnd: traceSequence, error: { name: error.name, code: error.code ?? null } }); throw error; } };",
];

/** The traced caller also keeps each real tool's exact returned UTF-8 string values privately. */
const MAC_RETURNED_CALLER = (() => {
  const importAnchor = "import childProcess from 'node:child_process';";
  const readAnchor = TRACED_CALLER.split('\n').find((line) => line.startsWith('childProcess.spawnSync = (tool, args, options) =>'));
  assert.ok(readAnchor, 'the traced synchronous read hook moved');
  assert.equal(TRACED_CALLER.split(importAnchor).length, 2, 'the traced child process import moved');
  assert.equal(TRACED_CALLER.split(readAnchor).length, 2, 'the traced synchronous read hook is ambiguous');
  return TRACED_CALLER.replace(importAnchor, [
    importAnchor,
    "import { createHash as readHash } from 'node:crypto';",
    "import { mkdirSync as readMkdir, writeFileSync as readWrite } from 'node:fs';",
  ].join('\n')).replace(readAnchor, MAC_RETURNED_OBSERVER.join('\n'));
})();

/** Closes each actual real-tool call against its private returned-value originals. */
function assertReturnedToolOriginals(directory, trace) {
  const originals = join(directory, 'returned-tool-reads');
  assert.ok(existsSync(join(originals, 'manifest.jsonl')), 'the reached real lsof/ps calls have no complete private per-read returned-value originals');
  const manifest = linesOf(originals, 'manifest.jsonl');
  const starts = manifest.filter(({ kind }) => kind === 'start');
  const ends = manifest.filter(({ kind }) => kind === 'end');
  const traceStarts = trace.filter(({ kind }) => kind === 'read-start');
  const traceEnds = trace.filter(({ kind }) => kind === 'read-end');
  const actual = (row) => row.tool === LSOF || row.tool === PS;
  assert.ok(manifest.length > 0 && manifest.every(({ kind }) => kind === 'start' || kind === 'end'), 'the private read manifest has an unknown or missing operation');
  assert.ok(traceStarts.every(actual) && traceEnds.every(actual), 'the caller trace includes an unaccounted tool read');
  assert.ok(starts.length === traceStarts.length && ends.length === traceEnds.length && starts.length === ends.length, 'an actual tool read is absent or unresolved in the private manifest');
  assert.ok(!trace.some(({ kind }) => kind === 'read-threw'), 'a real tool invocation threw without a returned result');
  const expectedFiles = new Set(['manifest.jsonl']);
  const seenIds = new Set();
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const begun = traceStarts[index];
    assert.ok(start.id === `r${String(index + 1).padStart(6, '0')}` && !seenIds.has(start.id), 'read IDs are missing, duplicated or out of order');
    seenIds.add(start.id);
    assert.ok(start.traceStart === begun.sequence && start.id === begun.readId && start.mode === begun.mode && start.tool === begun.tool && JSON.stringify(start.args) === JSON.stringify(begun.args) && actual(start), 'a private read start is not the actual traced call');
    assert.ok(typeof start.at === 'string' && /^\d+$/.test(start.at) && start.options?.encoding === 'utf8', 'a real read lacks its start or UTF-8 options');
    const end = ends.find((entry) => entry.id === start.id);
    const finished = traceEnds.find((entry) => entry.readId === start.id);
    assert.ok(end && finished && ends.filter((entry) => entry.id === start.id).length === 1 && traceEnds.filter((entry) => entry.readId === start.id).length === 1, 'a real read has no unique settled return');
    assert.ok(end.traceStart === start.traceStart && end.traceEnd === finished.sequence && end.traceEnd > end.traceStart && end.mode === start.mode && end.tool === start.tool && JSON.stringify(end.args) === JSON.stringify(start.args), 'a returned read does not link to its start and trace');
    assert.ok(end.started === start.at && typeof end.ended === 'string' && /^\d+$/.test(end.ended) && BigInt(end.ended) >= BigInt(start.at), 'a returned read has no valid start/end clock');
    assert.ok(end.status === finished.status && end.signal === finished.signal && (end.error?.code ?? null) === finished.error, 'a returned read has a different status or error from the trace');
    for (const name of ['stdout', 'stderr']) {
      const value = end[name];
      assert.ok(value && value.type === finished[`${name}Type`] && typeof value.present === 'boolean', 'the returned stream type or presence is unaccounted');
      assert.ok(['string', 'null', 'undefined', 'absent'].includes(value.type) && (value.type !== 'absent' || !value.present), 'a returned stream has an unsupported type');
      if (value.type === 'string') {
        const file = `${start.id}.${name}.utf8`;
        assert.ok(value.present && value.file === file && !expectedFiles.has(file) && typeof finished[name] === 'string', 'a returned string has no unique original or trace value');
        expectedFiles.add(file);
        const bytes = readFileSync(join(originals, file));
        assert.ok(bytes.equals(Buffer.from(finished[name], 'utf8')) && value.bytes === bytes.length && value.sha256 === createHash('sha256').update(bytes).digest('hex'), 'a returned string original is incomplete or differs from the value supplied to the caller');
      } else {
        assert.ok(!Object.hasOwn(value, 'file') && !Object.hasOwn(value, 'bytes') && !Object.hasOwn(value, 'sha256'), 'an absent or non-string stream invented original bytes');
      }
    }
  }
  assert.ok(readdirSync(originals).length === expectedFiles.size && readdirSync(originals).every((name) => expectedFiles.has(name) && lstatSync(join(originals, name)).isFile()), 'the private read originals have a missing or invented file');
  return { traceEnds };
}

/** Refuses a focused Mac control before fixtures when its runner has closed admission. */
function assertFocusedAdmission() {
  const deadlineText = process.env.C615_WORK_DEADLINE_NS;
  const markerText = process.env.C615_STOP_MARKER;
  if (deadlineText === undefined && markerText === undefined) return;
  assert.ok(deadlineText !== undefined && markerText !== undefined, 'the focused admission contract is incomplete');
  assert.match(deadlineText, /^[1-9]\d*$/, 'the focused work deadline is invalid');
  assert.ok(process.env.C615_EVIDENCE_ROOT, 'the focused stop marker has no private evidence root');
  const root = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  const checkout = realpathSync.native(process.cwd());
  assert.ok(root !== checkout && !root.startsWith(`${checkout}/`) && (lstatSync(root).mode & 0o077) === 0, 'the focused admission root is not external and private');
  assert.equal(markerText, join(root, 'stop-new-work'), 'the focused stop marker escaped its private root');
  let stopped = false;
  try { lstatSync(markerText); stopped = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(!stopped && process.hrtime.bigint() < BigInt(deadlineText), 'the focused runner closed new test work before fixture start');
}

// proves R-STATE-9, R-STATE-26
test('C615 Mac directory full tool exit census', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('this real lsof/ps control requires macOS');
  assertFocusedAdmission();
  let directory;
  let evidenceRoot;
  let tail;
  let caller;
  let tailError;
  let callerError;
  let finalized = false;
  let copied = false;
  let bodyStage = 'before-fixture';
  const ended = (child) => child.exitCode !== null || child.signalCode !== null;
  const waitFor = async (condition, milliseconds) => {
    const deadline = performance.now() + milliseconds;
    while (!condition() && performance.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    return condition();
  };

  t.after(async () => {
    let failure;
    let releaseError;
    const result = { release: 'not-started', tail: 'not-started', caller: 'not-started', command: 'not-observed', snapshot: 'pending' };
    try {
      if (directory) {
        try {
          writeFileSync(join(directory, 'release'), '');
          writeFileSync(join(directory, 'begin-exit'), '');
          result.release = 'written';
        } catch (error) {
          releaseError = error;
          result.release = 'failed';
        }
      }
      if (tail && !ended(tail) && tail.pid !== undefined) tail.kill('SIGKILL');
      const tailReaped = !tail || await waitFor(() => ended(tail) || tailError !== undefined, 3_000);
      result.tail = !tail ? 'never-started' : tailReaped && !tailError && ended(tail) ? 'reaped' : 'unresolved';
      if (caller && !ended(caller)) {
        await waitFor(() => ended(caller) || callerError !== undefined, 3_000);
        if (!ended(caller) && caller.pid !== undefined) caller.kill('SIGKILL');
      }
      const callerReaped = !caller || await waitFor(() => ended(caller) || callerError !== undefined, 3_000);
      result.caller = !caller ? 'never-started' : callerReaped && !callerError && ended(caller) ? 'reaped' : 'unresolved';
      const command = directory && pidIn(directory, 'group');
      const commandEnded = !caller || (command !== undefined && await waitFor(() => {
        const read = spawnSync(PS, ['-p', String(command), '-o', 'pid=,stat='], { env: process.env, encoding: 'utf8' });
        assert.ok(!read.error && (read.status === 0 || (read.status === 1 && read.stdout === '' && read.stderr === '')), 'the command finalizer could not read the process table');
        return read.status === 1;
      }, 3_000));
      result.command = !caller ? 'never-started' : commandEnded ? 'absent' : 'unresolved';
      assert.ok(!releaseError, 'the command release could not be written');
      assert.ok(tailReaped && !tailError && (!tail || ended(tail)), 'the recorded tail handle was not reaped');
      assert.ok(callerReaped && !callerError && (!caller || ended(caller)), 'the recorded caller handle was not reaped');
      assert.ok(commandEnded, 'the caller command remained present after cooperative release');
      finalized = true;
    } catch (error) {
      failure = error;
      result.failure = error.code ?? error.name ?? 'Error';
    } finally {
      if (evidenceRoot) {
        const finalizerPath = join(evidenceRoot, 'finalizer.json');
        try {
          result.bodyStage = bodyStage;
          writeFileSync(finalizerPath, JSON.stringify(result));
          if (directory) cpSync(directory, join(evidenceRoot, 'fixture'), { recursive: true, force: false, errorOnExist: true });
          result.snapshot = finalized ? 'closed-copy' : 'partial-copy-source-retained';
          writeFileSync(finalizerPath, JSON.stringify(result));
          const expected = ['caller.stderr', 'finalizer.json', 'fixture/caller.mjs', 'fixture/command', 'fixture/control.trace.jsonl', 'fixture/events', 'fixture/pairs', 'fixture/ending', 'fixture/exiting', 'fixture/group.pid', 'fixture/up', 'fixture/tail-birth.json', 'fixture/caller-birth.json', 'fixture/begin-exit', 'fixture/release', 'fixture/returned-tool-reads/manifest.jsonl'];
          const inventory = expected.map((name) => {
            const path = join(evidenceRoot, name);
            if (!existsSync(path)) return { name, state: 'never-produced' };
            const file = lstatSync(path);
            return file.isFile() ? { name, state: file.size === 0 ? 'produced-empty' : 'produced', bytes: file.size } : { name, state: 'unexpected-type' };
          });
          const discovered = [];
          const scan = (at, prefix) => {
            for (const entry of readdirSync(at, { withFileTypes: true })) {
              const name = `${prefix}${entry.name}`;
              if (entry.isDirectory()) scan(join(at, entry.name), `${name}/`);
              else {
                const file = lstatSync(join(at, entry.name));
                discovered.push(file.isFile() ? { name, state: file.size === 0 ? 'produced-empty' : 'produced', bytes: file.size } : { name, state: 'unexpected-type' });
              }
            }
          };
          if (directory) scan(join(evidenceRoot, 'fixture'), 'fixture/');
          writeFileSync(join(evidenceRoot, 'inventory.json'), JSON.stringify({ expected: inventory, discovered, completeness: finalized ? 'closed' : 'unconfirmed-partial' }));
          copied = true;
        } catch (error) {
          result.snapshot = 'copy-or-inventory-failed-source-retained';
          try { writeFileSync(finalizerPath, JSON.stringify(result)); } catch { /* The fixture scratch remains the original. */ }
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
    if (directory) t.diagnostic('C615 directory fixture finalizer: recorded handles reaped; command absent; private originals retained');
  });

  assert.ok(process.env.TMPDIR, 'the Mac control needs an explicit external TMPDIR');
  const tempRoot = realpathSync.native(process.env.TMPDIR);
  const checkout = realpathSync.native(process.cwd());
  const outsideCheckout = (path) => path !== checkout && !path.startsWith(`${checkout}/`);
  assert.ok(outsideCheckout(resolve(process.env.TMPDIR)) && outsideCheckout(tempRoot), 'the Mac control TMPDIR is inside the checkout');
  assert.ok(process.env.C615_EVIDENCE_ROOT, 'the Mac control needs a private C615_EVIDENCE_ROOT before any fixture starts');
  const outerRoot = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  assert.ok(outsideCheckout(resolve(process.env.C615_EVIDENCE_ROOT)) && outsideCheckout(outerRoot), 'the private evidence root is inside the checkout');
  assert.equal(lstatSync(outerRoot).mode & 0o077, 0, 'the shared private evidence root is accessible to other users');
  const directoryRoot = join(outerRoot, 'directory');
  if (!existsSync(directoryRoot)) mkdirSync(directoryRoot, { mode: 0o700 });
  const child = lstatSync(directoryRoot);
  assert.ok(child.isDirectory() && !child.isSymbolicLink() && (child.mode & 0o077) === 0, 'the directory evidence child is not a private directory');
  const privateRoot = realpathSync.native(directoryRoot);
  assert.ok(privateRoot.startsWith(`${outerRoot}/`), 'the directory evidence child escaped its private outer root');
  assert.equal(readdirSync(privateRoot).length, 0, 'the directory evidence child was not empty before the attempt');
  evidenceRoot = privateRoot;
  assertFocusedAdmission();
  directory = realpathSync(temporaryDirectory('c615-mac-directory-', {
    context: t,
    beforeRemoval: () => assert.ok(finalized && copied, 'finalization or private copy is incomplete; keep the fixture scratch'),
  }));
  const work = join(directory, 'work');
  mkdirSync(work);
  writeFileSync(join(directory, 'hold'), '');
  fixture(directory, 'command', 'echo $$ > "$here/group.pid"\n: > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');

  assertFocusedAdmission();
  tail = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { cwd: work, detached: true, stdio: 'ignore' });
  bodyStage = 'tail-started';
  tail.on('error', (error) => { tailError = error; });
  assert.ok(Number.isSafeInteger(tail.pid) && tail.pid > 0, 'the direct tail fixture did not start');
  await until(() => processState(tail.pid) !== '' && spawnSync(PS, ['-o', 'ucomm=', '-p', String(tail.pid)], { env: process.env, encoding: 'utf8' }).stdout.trim() === 'tail', t);
  const tailBirth = { pid: tail.pid, started: startOf(tail.pid) };
  writeFileSync(join(directory, 'tail-birth.json'), JSON.stringify(tailBirth));

  const anchor = "appendFileSync(join(here, 'exiting'), String(Date.now()));";
  assert.equal(MAC_RETURNED_CALLER.split(anchor).length, 2, 'the caller exit anchor moved');
  const source = MAC_RETURNED_CALLER.replace(anchor, "while (!existsSync(join(here, 'begin-exit'))) await new Promise((resolve) => setImmediate(resolve));\n" + anchor);
  const callerPath = join(directory, 'caller.mjs');
  writeFileSync(callerPath, source);
  const callerStderr = openSync(join(evidenceRoot, 'caller.stderr'), 'wx', 0o600);
  try {
    assertFocusedAdmission();
    caller = spawn(process.execPath, [callerPath, directory, JSON.stringify({ readTimeout: DIRECTORY_CALLER_BOUND, directory: work })], { stdio: ['ignore', 'ignore', callerStderr] });
    bodyStage = 'caller-started';
  } finally {
    closeSync(callerStderr);
  }
  caller.on('error', (error) => { callerError = error; });
  assert.ok(Number.isSafeInteger(caller.pid) && caller.pid > 0, 'the direct caller fixture did not start');
  await until(() => existsSync(join(directory, 'up')) || callerError !== undefined || ended(caller), t);
  assert.ok(existsSync(join(directory, 'up')), 'the command did not reach the caller exit boundary');
  const command = pidIn(directory, 'group');
  assert.ok(Number.isSafeInteger(command) && command > 0, 'the caller command did not record its PID');
  const callerBirth = { pid: caller.pid, started: startOf(caller.pid), command, commandStarted: startOf(command) };
  writeFileSync(join(directory, 'caller-birth.json'), JSON.stringify(callerBirth));
  t.diagnostic(JSON.stringify({ fixture: 'C615 Mac directory', tail: tailBirth, caller: callerBirth }));
  assert.ok(!ended(tail), 'the recorded tail ended before the exit census began');
  bodyStage = 'exit-census-started';
  writeFileSync(join(directory, 'begin-exit'), '');
  await until(() => ended(caller) || callerError !== undefined, t);
  assert.ok(!callerError && caller.exitCode === 0, 'the caller did not finish exit cleanup; inspect its private output');

  const trace = linesOf(directory, 'control.trace.jsonl');
  const answers = (tool, args) => trace.filter(({ kind, tool: path, args: given, status, error }) => kind === 'read-end' && path === tool && given?.length === args.length && given.every((value, index) => value === args[index]) && status === 0 && !error);
  const listsTail = (output) => {
    const rows = output.split('\n');
    const first = rows.indexOf(`p${tailBirth.pid}`);
    const next = rows.findIndex((row, index) => index > first && row.startsWith('p'));
    const fields = rows.slice(first, next < 0 ? undefined : next);
    return first >= 0 && fields.includes(`u${process.getuid()}`) && fields.includes(`n${realpathSync.native(work)}`);
  };
  const listingArgs = ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-F', 'pun'];
  const [first] = answers(LSOF, listingArgs);
  const listed = trace.find(({ kind, tool, args: given }) => (kind === 'read-end' || kind === 'read-threw') && tool === LSOF && JSON.stringify(given) === JSON.stringify(listingArgs));
  const listedSummary = JSON.stringify(listed ? { kind: listed.kind, status: listed.status, signal: listed.signal, error: listed.error ?? listed.code ?? null, stderr: listed.stderr, stdout: typeof listed.stdout === 'string' ? `${Buffer.byteLength(listed.stdout)} bytes` : listed.stdoutType ?? null } : 'no full listing read was traced');
  assert.ok(first && listsTail(first.stdout), `the actual full lsof listing did not answer with the recorded tail cwd; the first full listing read: ${listedSummary}`);
  const [state] = answers(PS, ['-p', String(tailBirth.pid), '-o', 'pid=,stat=']);
  assert.ok(state && state.sequence > first.sequence && new RegExp(`^\\s*${tailBirth.pid}\\s+T`, 'm').test(state.stdout), 'the actual intervening ps read did not answer with the stopped tail');
  const [perPid] = answers(LSOF, [...listingArgs.slice(0, -2), '-p', String(tailBirth.pid), '-F', 'pun']);
  assert.ok(perPid && perPid.sequence > state.sequence && listsTail(perPid.stdout), 'the actual per-PID lsof read did not answer with the recorded tail cwd');
  const [name] = answers(PS, ['-p', String(tailBirth.pid), '-o', 'ucomm=']);
  const [commandRead] = answers(PS, ['-ww', '-p', String(tailBirth.pid), '-o', 'pid=,command=']);
  assert.ok(name && name.sequence > perPid.sequence && name.stdout.trim() === 'tail', 'the actual name read did not answer for the recorded tail');
  assert.ok(commandRead && commandRead.sequence > name.sequence && commandRead.stdout.includes(`/usr/bin/tail -f ${join(directory, 'hold')}`), 'the actual command read did not answer for the recorded tail');
  assert.ok(trace.some(({ kind, target, name: signal, answer }) => kind === 'signal-answer' && target === tailBirth.pid && signal === 'SIGSTOP' && answer === true), 'the tail was not stopped after the answered listing');
  assert.ok(trace.some(({ kind, target, name: signal, answer }) => kind === 'signal-answer' && target === tailBirth.pid && signal === 'SIGKILL' && answer === true), 'the tail kill was not reached');
  const allEvents = linesOf(directory, 'events');
  const events = allEvents.filter(({ pid }) => pid === tailBirth.pid);
  assert.ok(events.length === 1 && events[0].event === 'survivor.killed' && events[0].name === 'tail' && events[0].cmd === `/usr/bin/tail -f ${join(directory, 'hold')}` && events[0].reason === undefined, 'the reached directory result did not name the killed tail truthfully');
  const [groupName] = answers(PS, ['-p', String(command), '-o', 'ucomm=']);
  const groupCommands = answers(PS, ['-ww', '-g', String(command), '-o', 'pid=,command=']);
  const groupCommandRead = groupCommands.find(({ stdout }) => new RegExp(`^\\s*${command}\\s+(.+)$`, 'm').test(stdout));
  const observedCommand = groupCommandRead && new RegExp(`^\\s*${command}\\s+(.+)$`, 'm').exec(groupCommandRead.stdout)?.[1];
  const groupKill = trace.find(({ kind, target, name: signal, answer }) => kind === 'signal-answer' && target === -command && signal === 'SIGKILL' && answer === true);
  const commandEvent = allEvents.find(({ pid }) => pid === command);
  assert.ok(groupName && groupName.stdout.trim() !== '' && groupCommandRead && observedCommand && groupKill &&
    groupName.sequence < groupKill.sequence && groupCommandRead.sequence < groupKill.sequence &&
    commandEvent?.event === 'survivor.killed' &&
    commandEvent.name === groupName.stdout.trim() && commandEvent.cmd === observedCommand && commandEvent.reason === undefined,
  'the group result did not match the actual command identity reads');
  assert.equal(allEvents.length, 2, 'the answered group and directory reads did not justify another forced-end event');
  assert.deepEqual(new Set(allEvents.map(({ pid }) => pid)), new Set([command, tailBirth.pid]),
    'the group and directory results included an unobserved PID');

  bodyStage = 'per-read-original-guard';
  const { traceEnds } = assertReturnedToolOriginals(directory, trace);
  const eventTrace = trace.filter(({ kind }) => kind === 'event');
  const eventRecords = linesOf(directory, 'events');
  assert.ok(eventTrace.length === eventRecords.length && eventTrace.every((entry, index) => ['event', 'pid', 'name', 'cmd', 'reason'].every((field) => entry[field] === eventRecords[index][field])), 'the product event file does not match the ordered private trace');
  assert.ok(eventTrace.some(({ event, pid, sequence }) => event === 'survivor.killed' && pid === tailBirth.pid && sequence > commandRead.sequence), 'the returned reads do not precede the recorded product event');
  const callerEnds = trace.filter(({ kind }) => kind === 'caller-end');
  assert.ok(callerEnds.length === 1 && traceEnds.every(({ sequence }) => sequence < callerEnds[0].sequence), 'a real tool read did not close before the caller ended');
  bodyStage = 'passed';
});

/**
 * The C615 directory listing observer (#757), a module every Node process of a nested C615
 * directory run loads first, through `NODE_OPTIONS`. Each step it sees is one append to one trace
 * file, so the trace's order is the order the steps happened across the parent, the caller and the
 * hold controller. In the parent it records the tail and caller handles, each `.kill` call and its
 * answer, the release writes, the command reads and the private copy. In the caller it records each
 * real `lsof` and `ps` read, with the budget it was given, how long it took and how the control's
 * `listsTail` reads a full listing, and then reads the tail's actual working directory itself.
 *
 * `C757_MODE` forces one state the control can meet. `hold-2000` holds the first full listing's
 * real `lsof` stopped before it runs until a controller has seen it held 2,000 ms, then lets it run
 * with its own arguments; `hold-until-gone` holds it until the caller's read timeout ends it.
 * `stderr` and `codeless-error` hand the first full listing back with a line on standard error, or
 * with an error carrying no code. The rest stop the control at one setup or teardown step. Run as
 * a script with `c757-hold-controller`, it is that controller.
 */
const C757_LISTING_OBSERVER = String.raw`
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const tracePath = process.env.C757_TRACE;
const mode = process.env.C757_MODE ?? 'observe';
if (tracePath && !globalThis.c757Observer) {
  globalThis.c757Observer = true;
  const real = { ...fs };
  const realSpawn = childProcess.spawn;
  const realSpawnSync = childProcess.spawnSync;
  const targetDirectory = /\/c615-mac-directory-[^/]+$/;
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
  const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
  const inTarget = (path) => typeof path === 'string' && targetDirectory.test(parentOf(path));
  const script = process.argv[1] ?? '';
  const role = process.argv[2] === 'c757-hold-controller' ? 'controller'
    : inTarget(script) && nameOf(script) === 'caller.mjs' ? 'caller'
    : process.env.NODE_TEST_CONTEXT && process.argv.some((arg) => typeof arg === 'string' && arg.endsWith('never-stop.test.mjs')) ? 'parent' : 'other';
  let sequence = 0;
  const mark = (event, fields = {}) => real.appendFileSync(tracePath, JSON.stringify({ role, pid: process.pid, sequence: ++sequence, ns: String(process.hrtime.bigint()), mode, event, ...fields }) + '\n');
  const errorOf = (error) => (error ? { name: error.name, code: error.code ?? null, message: error.message } : null);
  const pidClass = (pid) => (pid === undefined ? 'undefined' : Number.isSafeInteger(pid) && pid > 0 ? 'positive-safe' : 'defined-invalid');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  const forced = (what) => Object.assign(new Error('c757 forced ' + what), { code: 'C757_FORCED' });
  if (role === 'controller') {
    const held = process.argv[3];
    const caller = Number(process.argv[4]);
    const turn = () => new Promise((resolve) => setImmediate(resolve));
    let heldPid;
    while (heldPid === undefined) {
      const text = real.existsSync(held + '.pid') ? real.readFileSync(held + '.pid', 'utf8').trim() : '';
      if (text !== '') heldPid = Number(text);
      else if (!alive(caller)) { mark('hold-abandoned', { why: 'the caller ended before the hold began' }); process.exit(0); }
      else await turn();
    }
    while (!realSpawnSync(${JSON.stringify(PS)}, ['-o', 'stat=', '-p', String(heldPid)], { encoding: 'utf8' }).stdout.trim().startsWith('T')) {
      if (!alive(heldPid)) { mark('hold-abandoned', { why: 'the held read ended before it stopped', heldPid }); process.exit(0); }
      await turn();
    }
    const heldAt = process.hrtime.bigint();
    const heldFor = () => Number(process.hrtime.bigint() - heldAt) / 1e6;
    mark('held', { heldPid });
    for (;;) {
      if (!alive(heldPid)) { mark('held-ended-unreleased', { heldPid, heldMs: heldFor() }); process.exit(0); }
      if (!alive(caller)) { process.kill(heldPid, 'SIGKILL'); mark('held-killed-after-caller', { heldPid, heldMs: heldFor() }); process.exit(0); }
      if (mode === 'hold-2000' && heldFor() >= 2000) { process.kill(heldPid, 'SIGCONT'); mark('released', { heldPid, heldMs: heldFor() }); process.exit(0); }
      await turn();
    }
  }
  if (role === 'parent') {
    const handles = {};
    let targetDir;
    let stoppedCommand;
    const groupOf = (directory) => { try { return Number(real.readFileSync(directory + '/group.pid', 'utf8')); } catch { return undefined; } };
    const stopNewWork = () => { real.writeFileSync(process.env.C615_STOP_MARKER, ''); mark('stop-marker-written'); };
    const watch = (who, child) => {
      handles[who] = child;
      mark('handle-returned', { who, handlePid: child.pid ?? null, pidClass: pidClass(child.pid) });
      child.once('error', (error) => mark('handle-error', { who, error: errorOf(error) }));
      child.once('exit', (code, signal) => mark('handle-exit', { who, code, signal }));
      const kill = child.kill;
      child.kill = function (signal) {
        mark('handle-kill-call', { who, signal, handlePid: child.pid ?? null, pidClass: pidClass(child.pid), ended: child.exitCode !== null || child.signalCode !== null });
        try {
          const answer = kill.apply(this, arguments);
          mark('handle-kill-answer', { who, signal, answer });
          return answer;
        } catch (error) {
          mark('handle-kill-threw', { who, signal, error: errorOf(error) });
          throw error;
        }
      };
    };
    childProcess.spawn = function (command, args, options) {
      const tail = command === '/usr/bin/tail' && typeof options?.cwd === 'string' && targetDirectory.test(parentOf(options.cwd));
      const caller = Array.isArray(args) && inTarget(args[0]) && nameOf(args[0]) === 'caller.mjs';
      if (!tail && !caller) return realSpawn.apply(this, arguments);
      const who = tail ? 'tail' : 'caller';
      targetDir = parentOf(tail ? options.cwd : args[0]);
      let program = command;
      let given = options;
      if (tail && mode === 'tail-elsewhere') {
        given = { ...options, cwd: targetDir + '/elsewhere' };
        real.mkdirSync(given.cwd);
      }
      if ((tail && mode === 'tail-unstartable') || (caller && mode === 'caller-unstartable')) program = targetDir + '/c757-absent-program';
      mark('handle-spawn-call', { who, program, cwd: given?.cwd ?? null });
      const child = realSpawn.call(this, program, args, given);
      watch(who, child);
      if (caller && (mode === 'tail-ends' || mode === 'begin-exit-fails')) {
        process.kill(handles.tail.pid, 'SIGKILL');
        mark('tail-killed-by-forcing', { tailPid: handles.tail.pid });
      }
      return child;
    };
    childProcess.spawnSync = function (tool, args) {
      const result = realSpawnSync.apply(this, arguments);
      const command = targetDir && groupOf(targetDir);
      if (tool === ${JSON.stringify(PS)} && Array.isArray(args) && args.length === 4 && args[0] === '-p' && args[2] === '-o' && args[3] === 'pid=,stat=' && command !== undefined && args[1] === String(command)) {
        mark('command-read', { command, status: result.status, error: errorOf(result.error), stdout: result.stdout, stderr: result.stderr });
        if (stoppedCommand === command) {
          process.kill(command, 'SIGCONT');
          stoppedCommand = undefined;
          mark('command-continued', { command });
        }
      }
      return result;
    };
    fs.writeFileSync = function (path, data, ...rest) {
      const name = typeof path === 'string' ? nameOf(path) : '';
      if (inTarget(path) && name === 'release' && mode === 'begin-exit-fails') {
        stoppedCommand = groupOf(parentOf(path));
        process.kill(stoppedCommand, 'SIGSTOP');
        mark('command-stopped', { command: stoppedCommand });
      }
      if (inTarget(path) && name === 'begin-exit' && mode === 'begin-exit-fails') {
        mark('write-failed-by-forcing', { name });
        throw forced('begin-exit write failure');
      }
      const result = real.writeFileSync(path, data, ...rest);
      if (inTarget(path) && ['release', 'begin-exit', 'tail-birth.json', 'caller-birth.json'].includes(name)) mark('write', { name });
      if (['finalizer.json', 'inventory.json'].includes(name) && typeof path === 'string' && nameOf(parentOf(path)) === 'directory') mark('write', { name, bytes: Buffer.byteLength(String(data)) });
      if (inTarget(path) && name === 'tail-birth.json' && mode === 'stop-at-caller') stopNewWork();
      return result;
    };
    // A tail the forcing killed is reported ended only once its handle's exit has been seen, so
    // the parent's wait on the command boundary holds until then, and its still-running guard
    // then finds the tail ended.
    fs.existsSync = function (path) {
      const result = real.existsSync(path);
      const tail = handles.tail;
      if (result && (mode === 'tail-ends' || mode === 'begin-exit-fails') && inTarget(path) && nameOf(path) === 'up' && tail && tail.exitCode === null && tail.signalCode === null) return false;
      return result;
    };
    fs.readdirSync = function (path, ...rest) {
      const result = real.readdirSync(path, ...rest);
      if (mode === 'stop-after-root' && typeof path === 'string' && nameOf(path) === 'directory' && result.length === 0 && !real.existsSync(process.env.C615_STOP_MARKER)) stopNewWork();
      return result;
    };
    fs.mkdirSync = function (path, ...rest) {
      if (mode === 'work-unmade' && inTarget(path) && nameOf(path) === 'work') {
        mark('mkdir-failed-by-forcing', { name: 'work' });
        throw forced('work directory failure');
      }
      return real.mkdirSync(path, ...rest);
    };
    fs.cpSync = function (from, to, ...rest) {
      if (typeof from !== 'string' || !targetDirectory.test(from)) return real.cpSync(from, to, ...rest);
      mark('copy-start');
      try {
        real.cpSync(from, to, ...rest);
      } catch (error) {
        mark('copy-error', { error: errorOf(error) });
        throw error;
      }
      mark('copy-returned');
    };
  }
  if (role === 'caller') {
    const directory = process.argv[2];
    const work = directory + '/work';
    let tailPid;
    try { tailPid = JSON.parse(real.readFileSync(directory + '/tail-birth.json', 'utf8')).pid; } catch { /* No tail was recorded. */ }
    let fullListings = 0;
    const listsTail = (stdout) => {
      if (typeof stdout !== 'string') return { type: stdout === null ? 'null' : typeof stdout };
      const rows = stdout.split('\n');
      const first = rows.indexOf('p' + tailPid);
      const next = rows.findIndex((row, index) => index > first && row.startsWith('p'));
      const fields = rows.slice(first, next < 0 ? undefined : next);
      const p = first >= 0;
      const u = p && fields.includes('u' + process.getuid());
      const n = p && fields.includes('n' + work);
      return { type: 'string', bytes: Buffer.byteLength(stdout), pRows: rows.filter((row) => row.startsWith('p')).length, tailFields: p ? fields : null, p, u, n, cell: !p ? 'D3' : !u ? 'D4' : !n ? 'D5' : 'D0' };
    };
    const independently = (ordinal) => {
      if (tailPid === undefined) return mark('tail-state', { ordinal, cwd: 'unproved', why: 'no tail was recorded' });
      const cwd = realSpawnSync(${JSON.stringify(LSOF)}, ['-w', '-n', '-P', '-a', '-p', String(tailPid), '-d', 'cwd', '-F', 'n'], { encoding: 'utf8', cwd: '/' });
      const state = realSpawnSync(${JSON.stringify(PS)}, ['-o', 'stat=', '-p', String(tailPid)], { encoding: 'utf8' });
      const named = cwd.status === 0 && !cwd.error ? cwd.stdout.split('\n').find((row) => row.startsWith('n'))?.slice(1) : undefined;
      mark('tail-state', { ordinal, tailPid, cwd: named === undefined ? 'unproved' : named === work ? 'work' : 'different', named: named ?? null, cwdStatus: cwd.status, state: state.status === 0 ? state.stdout.trim() : state.status === 1 ? 'absent' : 'unproved' });
    };
    const shell = (body, label, args, options) => realSpawnSync('/bin/sh', ['-c', body + ${JSON.stringify('; exec ' + shellQuote(LSOF) + ' "$@"')}, directory + '/' + label, ...args], options);
    const held = (args, options) => {
      const controller = realSpawn(process.execPath, [fileURLToPath(import.meta.url), 'c757-hold-controller', directory + '/c757-held', String(process.pid)], { cwd: '/', env: { PATH: process.env.PATH, C757_TRACE: tracePath, C757_MODE: mode }, stdio: 'ignore' });
      mark('hold-controller', { controller: controller.pid ?? null });
      return shell('echo $$ > "$0.pid"; kill -STOP $$', 'c757-held', args, options);
    };
    childProcess.spawnSync = function (tool, args, options) {
      if (tool !== ${JSON.stringify(LSOF)} && tool !== ${JSON.stringify(PS)}) return realSpawnSync.apply(this, arguments);
      const full = tool === ${JSON.stringify(LSOF)} && args.includes('-u') && !args.includes('-p');
      const ordinal = full ? ++fullListings : undefined;
      const first = ordinal === 1;
      mark('read-start', { tool, args, full, ordinal, remaining: options?.timeout ?? null });
      const begun = process.hrtime.bigint();
      let result;
      try {
        if (first && (mode === 'hold-2000' || mode === 'hold-until-gone')) result = held(args, options);
        else if (first && mode === 'stderr') result = shell("echo 'c757 forced stderr' >&2", 'c757-stderr', args, options);
        else result = realSpawnSync.apply(this, arguments);
      } catch (error) {
        mark('read-threw', { tool, args, full, ordinal, error: errorOf(error) });
        throw error;
      }
      if (first && mode === 'codeless-error') result = { ...result, error: new Error('c757 forced error with no code') };
      const ms = Number(process.hrtime.bigint() - begun) / 1e6;
      const l0 = result.error?.code === 'ETIMEDOUT' ? 'timed-out' : result.error ? 'error-rejected' : result.stderr !== '' ? 'stderr-rejected' : result.status === 0 ? 'accepted' : result.status === 1 && result.stdout === '' ? 'accepted-empty' : 'exit-rejected';
      mark('read-end', { tool, args, full, ordinal, ms, status: result.status, signal: result.signal, error: errorOf(result.error), stderr: result.stderr, stdoutBytes: typeof result.stdout === 'string' ? Buffer.byteLength(result.stdout) : null, l0, selected: result.status === 0 && !result.error?.code, parse: full ? listsTail(result.stdout) : undefined });
      if (full) independently(ordinal);
      return result;
    };
    process.on('exit', (code) => mark('caller-exit', { code }));
  }
  if (role === 'parent' || role === 'caller') {
    syncBuiltinESMExports();
    mark('observer-installed', { argv: process.argv.slice(1, 3) });
  }
}
`;

/**
 * Runs `C615 Mac directory full tool exit census` alone in a nested runner, every Node process of
 * which loads the listing observer in `mode`, and answers its exit status, its output, its ordered
 * trace, its private evidence and the fixture scratch it left. Every process the run starts names
 * the test's scratch directory, so the scratch teardown ends whichever the run's own did not.
 * `admission` gives the run a focused admission contract whose stop marker the observer writes;
 * `shared` leaves the private evidence root readable by others.
 */
async function listingRun(t, mode, { admission = false, shared = false } = {}) {
  const directory = holding(t);
  const observer = join(directory, 'observer.mjs');
  assert.ok(!/\s/.test(observer), 'NODE_OPTIONS cannot name an observer path holding whitespace');
  writeFileSync(observer, C757_LISTING_OBSERVER);
  const scratchTmp = join(directory, 'tmp');
  mkdirSync(scratchTmp);
  const evidence = join(directory, 'evidence');
  mkdirSync(evidence, { mode: 0o700 });
  if (shared) chmodSync(evidence, 0o755);
  const tracePath = join(directory, 'trace.jsonl');
  const { NODE_TEST_CONTEXT, C615_WORK_DEADLINE_NS, C615_STOP_MARKER, C615_SIGHTING_EVIDENCE_ROOT, ...inherited } = process.env;
  const focused = admission ? { C615_WORK_DEADLINE_NS: String(process.hrtime.bigint() + 600_000_000_000n), C615_STOP_MARKER: join(realpathSync.native(evidence), 'stop-new-work') } : {};
  const env = { ...inherited, ...focused, TMPDIR: scratchTmp, C615_EVIDENCE_ROOT: evidence, C757_TRACE: tracePath, C757_MODE: mode, NODE_OPTIONS: [inherited.NODE_OPTIONS, `--import=${observer}`].filter(Boolean).join(' ') };
  const run = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-name-pattern=^C615 Mac directory full tool exit census$', fileURLToPath(import.meta.url)], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  run.stdout.on('data', (chunk) => { output += chunk; });
  run.stderr.on('data', (chunk) => { output += chunk; });
  const [status] = await once(run, 'close', { signal: t.signal });
  const retained = retainNestedRun(t, { mode, admission, shared, status, output, tracePath, evidence });
  assert.deepEqual(running(directory), [], `a process the nested C615 directory run started outlived its own teardown:\n${output}`);
  const trace = readFileSync(tracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const root = join(evidence, 'directory');
  const json = (name) => (existsSync(join(root, name)) ? JSON.parse(readFileSync(join(root, name), 'utf8')) : undefined);
  const scratchLeft = readdirSync(scratchTmp).filter((name) => name.startsWith('c615-mac-directory-'));
  return { status, output, trace, evidence, root, retained, finalizer: json('finalizer.json'), inventory: json('inventory.json'), scratchLeft, events: linesOf(join(root, 'fixture'), 'events') };
}

/**
 * Keeps a nested run's complete output, its ordered observer trace and its private C615 evidence,
 * with a record of where the nested control first stopped, among the C615 directory control's
 * private originals: `C615_EVIDENCE_ROOT/directory/nested/<test>`, outside the checkout and the
 * test's scratch, so each nested invocation can be reopened after its scratch is removed (#757).
 */
function retainNestedRun(t, { mode, admission, shared, status, output, tracePath, evidence }) {
  assert.ok(process.env.C615_EVIDENCE_ROOT, 'a nested C615 directory run needs a private C615_EVIDENCE_ROOT to keep its originals in');
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  assert.equal(lstatSync(outer).mode & 0o077, 0, 'the private evidence root for nested runs is accessible to other users');
  const kept = join(outer, 'directory', 'nested', t.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80));
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  assert.equal(readdirSync(kept).length, 0, 'a nested run would overwrite another run of the same control');
  writeFileSync(join(kept, 'output.txt'), output);
  if (existsSync(tracePath)) cpSync(tracePath, join(kept, 'trace.jsonl'));
  cpSync(evidence, join(kept, 'evidence'), { recursive: true });
  const stopped = /at (?:async )?TestContext\.<anonymous> \(file:\/\/[^)]*never-stop\.test\.mjs:(\d+):\d+\)/.exec(output);
  const passed = /^✔ C615 Mac directory full tool exit census /m.test(output);
  const digest = (path) => (existsSync(path) ? { bytes: lstatSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') } : null);
  const record = { test: t.name, mode, admission, shared, status, firstStop: passed ? 'passed' : stopped ? `never-stop.test.mjs:${stopped[1]}` : 'not-reached', output: digest(join(kept, 'output.txt')), trace: digest(join(kept, 'trace.jsonl')) };
  writeFileSync(join(kept, 'record.json'), JSON.stringify(record));
  return { directory: kept, record };
}

/** The entries of a nested run's trace whose role and event are these. */
const tracedAs = ({ trace }, role, event) => trace.filter((entry) => entry.role === role && entry.event === event);

/** The caller's traced reads of the full `lsof` listing, in order. */
const fullListings = (run) => tracedAs(run, 'caller', 'read-end').filter(({ full }) => full);

/** Asserts that the nested control passed, and that its teardown found every process it started already ended and removed its scratch after the private copy. */
function assertControlPassed(run) {
  assert.equal(run.status, 0, `the nested C615 directory run failed:\n${run.output}`);
  assert.match(run.output, /✔ C615 Mac directory full tool exit census/, 'the nested run did not pass the C615 directory control');
  assert.equal(run.finalizer.bodyStage, 'passed', 'the nested control did not reach its last stage');
  assert.deepEqual({ release: run.finalizer.release, tail: run.finalizer.tail, caller: run.finalizer.caller, command: run.finalizer.command, snapshot: run.finalizer.snapshot }, { release: 'written', tail: 'reaped', caller: 'reaped', command: 'absent', snapshot: 'closed-copy' }, 'the passing control did not finalize cleanly');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-kill-call'), [], 'the passing control signalled a process its teardown should have found ended');
  assert.deepEqual(run.scratchLeft, [], 'the passing control kept its fixture scratch');
  assert.ok(tracedAs(run, 'parent', 'copy-returned').length === 1, 'the passing control did not copy its fixture privately before removing it');
}

/** Asserts that the nested control failed at the source line `line` with `message`, and nowhere else. */
function assertControlFailedAt(run, line, message) {
  assert.equal(run.status, 1, `the nested C615 directory run did not fail:\n${run.output}`);
  assert.match(run.output, /✖ C615 Mac directory full tool exit census/, 'the nested run did not fail the C615 directory control');
  assert.ok(run.output.includes(message), `the nested control did not fail with ${JSON.stringify(message)}:\n${run.output}`);
  assert.ok(run.output.includes(`never-stop.test.mjs:${line}:`), `the nested control did not fail at line ${line}:\n${run.output}`);
}

/**
 * The source line in the C615 directory control that holds `text`, which it holds exactly once, or
 * the line `offset` after it.
 */
const controlLine = (text, offset = 0) => {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const begins = lines.indexOf("test('C615 Mac directory full tool exit census', SETTLES_WITHIN, async (t) => {");
  const ends = lines.indexOf('});', begins);
  assert.ok(begins >= 0 && ends > begins, 'the C615 directory control moved');
  const found = lines.slice(begins, ends).flatMap((line, index) => (line.includes(text) ? [begins + index + 1] : []));
  assert.equal(found.length, 1, `the C615 directory control no longer holds ${JSON.stringify(text)} exactly once`);
  return found[0] + offset;
};

/** The control's lines at which the nested runs here stop it. */
const GUARD = {
  root: () => controlLine("'the shared private evidence root is accessible to other users'"),
  admittedAfterRoot: () => controlLine('  evidenceRoot = privateRoot;', 1),
  work: () => controlLine('  mkdirSync(work);'),
  tailStarted: () => controlLine("'the direct tail fixture did not start'"),
  admittedBeforeCaller: () => controlLine('    caller = spawn(process.execPath, [callerPath', -1),
  callerStarted: () => controlLine("'the direct caller fixture did not start'"),
  tailRunning: () => controlLine("'the recorded tail ended before the exit census began'"),
  listing: () => controlLine('listsTail(first.stdout), `the actual full lsof listing did not answer'),
  state: () => controlLine("'the actual intervening ps read did not answer with the stopped tail'"),
};

/** The first full listing the nested caller read, which must have been read. */
function firstListing(run) {
  const [first] = fullListings(run);
  assert.ok(first, `the nested caller never read the full lsof listing:\n${run.output}`);
  return first;
}

/** Asserts the parent's traced teardown signals, as `[who, signal, answer]` in order. */
const assertKills = (run, expected, why) => assert.deepEqual(tracedAs(run, 'parent', 'handle-kill-answer').map(({ who, signal, answer }) => [who, signal, answer]), expected, why);

/** The finalizer's record of each teardown step. */
const steps = ({ finalizer }) => ({ release: finalizer.release, tail: finalizer.tail, caller: finalizer.caller, command: finalizer.command, snapshot: finalizer.snapshot });

test('C615 directory listing D0: the unforced control passes on its first real full listing, read within its caller budget with the tail independently in work', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'observe');
  assertControlPassed(run);
  const first = firstListing(run);
  assert.ok(first.status === 0 && first.error === null && first.stderr === '' && first.l0 === 'accepted' && first.selected && first.parse.cell === 'D0', 'the first full listing was not a real, accepted, selected answer naming the tail in work');
  const { remaining } = tracedAs(run, 'caller', 'read-start').find(({ ordinal }) => ordinal === 1);
  assert.ok(first.ms < remaining, 'the first full listing did not answer within the budget it was given');
  assert.equal(tracedAs(run, 'caller', 'tail-state').find(({ ordinal }) => ordinal === 1).cwd, 'work', 'the tail was not independently in work at the first listing');
  const [read] = tracedAs(run, 'parent', 'command-read');
  assert.ok(read && read.status === 1 && read.stdout === '' && read.stderr === '', 'the teardown did not find the command absent on its first read');
});

test('C615 directory caller budget: the directory control gives its census 5,000 ms, so its first full listing has more than 1,000 ms to answer', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'observe');
  assertControlPassed(run);
  const { remaining } = tracedAs(run, 'caller', 'read-start').find(({ ordinal }) => ordinal === 1);
  assert.ok(remaining > CLEANUP_BOUND && remaining <= DIRECTORY_CALLER_BOUND, `the directory caller does not give its census the 5,000 ms read budget: ${remaining} ms remained for its first listing`);
  const [unread] = run.events.filter(({ event }) => event === 'directory.unread');
  assert.equal(unread, undefined, 'the census recorded the directory unread');
});

test('C615 directory listing hold: a real first full listing held over 1,000 ms answers within the 5,000 ms caller budget, and the control passes on that first answer', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'hold-2000');
  assertControlPassed(run);
  const [released] = tracedAs(run, 'controller', 'released');
  assert.ok(released && released.heldMs >= 2_000, 'the controller did not release the held listing after 2,000 ms');
  const first = firstListing(run);
  assert.ok(first.ms > 1_000 && first.ms < 5_000, `the held first listing did not complete between 1,000 and 5,000 ms: ${first.ms}`);
  assert.ok(first.status === 0 && first.error === null && first.l0 === 'accepted' && first.selected && first.parse.cell === 'D0', 'the held first listing was not the real answer naming the tail in work');
});

test('C615 directory listing D2: a real first full listing that outlasts the caller budget leaves no qualifying answer, and the control fails at its first-listing guard', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'hold-until-gone');
  assertControlFailedAt(run, GUARD.listing(), 'the actual full lsof listing did not answer with the recorded tail cwd');
  assert.ok(run.output.includes('ETIMEDOUT'), 'the first-listing failure does not name the timed-out read');
  const listings = fullListings(run);
  assert.equal(listings.length, 1, 'the census read the full listing again after its timeout');
  assert.ok(listings[0].error?.code === 'ETIMEDOUT' && listings[0].status === null && listings[0].l0 === 'timed-out' && !listings[0].selected, 'the first full listing did not time out unanswered');
  assert.ok(tracedAs(run, 'controller', 'held-ended-unreleased').length === 1 && tracedAs(run, 'controller', 'released').length === 0, 'the held listing was released rather than timed out');
  assert.ok(run.events.some(({ event, census }) => event === 'directory.unread' && /timed out after \d+ ms/.test(census)), 'the caller did not record the directory as unread for its timed-out listing');
  assertKills(run, [['tail', 'SIGKILL', true]], 'the teardown did not end the live tail L0 never reached');
  assert.deepEqual(steps(run), { release: 'written', tail: 'reaped', caller: 'reaped', command: 'absent', snapshot: 'closed-copy' }, 'the teardown did not end every process after the failed guard');
  assert.deepEqual(run.scratchLeft, [], 'the scratch was kept after a clean finalization');
});

test('C615 directory listing Lstderr: a real first full listing returned with standard error is refused by L0 but selected by the control, which then fails at its stopped-state guard', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'stderr');
  assertControlFailedAt(run, GUARD.state(), 'the actual intervening ps read did not answer with the stopped tail');
  const first = firstListing(run);
  assert.ok(first.status === 0 && first.error === null && first.stderr === 'c757 forced stderr\n' && first.l0 === 'stderr-rejected' && first.selected && first.parse.cell === 'D0', 'the first full listing was not a real answer with standard error that the control selects');
  assert.ok(run.events.some(({ event, census }) => event === 'directory.unread' && census.includes('c757 forced stderr')), 'L0 did not refuse the listing for its standard error');
  assertKills(run, [['tail', 'SIGKILL', true]], 'the teardown did not end the live tail L0 never stopped');
});

test('C615 directory listing LEC: a real first full listing returned with an error that has no code is refused by L0, recorded with no code, and selected by the control', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'codeless-error');
  assertControlFailedAt(run, GUARD.state(), 'the actual intervening ps read did not answer with the stopped tail');
  const first = firstListing(run);
  assert.ok(first.status === 0 && first.error?.code === null && first.l0 === 'error-rejected' && first.selected && first.parse.cell === 'D0', 'the first full listing was not a real answer carrying an error with no code');
  const manifest = linesOf(join(run.root, 'fixture', 'returned-tool-reads'), 'manifest.jsonl');
  const ended = manifest.find(({ kind, tool, args }) => kind === 'end' && tool === LSOF && args.includes('-u'));
  assert.ok(ended && ended.error?.name === 'Error' && ended.error.code === undefined && ended.status === 0 && ended.stdout.type === 'string', 'the private manifest did not keep the error object with its returned listing');
  const traced = linesOf(join(run.root, 'fixture'), 'control.trace.jsonl').find(({ kind, tool, args }) => kind === 'read-end' && tool === LSOF && args.includes('-u'));
  assert.ok(traced && traced.error === null && traced.status === 0, 'the control trace did not record the codeless error as null');
  assert.ok(run.events.some(({ event, census }) => event === 'directory.unread' && census.includes('c757 forced error with no code')), 'L0 did not refuse the listing for its error');
});

test('C615 directory listing F1: a tail independently working outside work is listed without the work path, and the control fails at its first-listing guard', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'tail-elsewhere');
  assertControlFailedAt(run, GUARD.listing(), 'the actual full lsof listing did not answer with the recorded tail cwd');
  const first = firstListing(run);
  assert.ok(first.status === 0 && first.l0 === 'accepted' && first.selected && first.parse.p && first.parse.u && !first.parse.n && first.parse.cell === 'D5', 'the first answer did not list the tail without the work path');
  const [state] = tracedAs(run, 'caller', 'tail-state');
  assert.ok(state.cwd === 'different' && state.named.endsWith('/elsewhere'), 'the tail was not independently observed outside work');
  assertKills(run, [['tail', 'SIGKILL', true]], 'the teardown did not end the tail L0 left');
});

test('C615 directory teardown T0/T6 no root: a control stopped before its private root makes no release, signal, command read, private write or scratch', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'observe', { shared: true });
  assertControlFailedAt(run, GUARD.root(), 'the shared private evidence root is accessible to other users');
  for (const event of ['handle-returned', 'handle-kill-call', 'write', 'command-read', 'copy-start']) assert.deepEqual(tracedAs(run, 'parent', event), [], `the teardown of a control with no root traced ${event}`);
  assert.deepEqual(readdirSync(run.evidence), [], 'a control stopped before its private root wrote under it');
  assert.deepEqual(run.scratchLeft, [], 'a control stopped before its fixture made scratch');
});

test('C615 directory teardown T0/T6 root with no directory: a control stopped after its private root finalizes and inventories it, with no release, signal, command read, copy or scratch', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'stop-after-root', { admission: true });
  assertControlFailedAt(run, GUARD.admittedAfterRoot(), 'the focused runner closed new test work before fixture start');
  for (const event of ['handle-returned', 'handle-kill-call', 'command-read', 'copy-start']) assert.deepEqual(tracedAs(run, 'parent', event), [], `the teardown of a control with no directory traced ${event}`);
  assert.deepEqual(tracedAs(run, 'parent', 'write').map(({ name }) => name), ['finalizer.json', 'finalizer.json', 'inventory.json'], 'the teardown did not write only its finalizer and inventory');
  assert.deepEqual(steps(run), { release: 'not-started', tail: 'never-started', caller: 'never-started', command: 'never-started', snapshot: 'closed-copy' }, 'the finalizer does not record a teardown with nothing started');
  assert.ok(run.inventory.discovered.length === 0 && run.inventory.expected.filter(({ state }) => state !== 'never-produced').map(({ name }) => name).join() === 'finalizer.json', 'the inventory names a fixture file a control with no directory never made');
  assert.deepEqual(run.scratchLeft, [], 'a control stopped before its fixture made scratch');
});

test('C615 directory teardown T6 partial setup: a control whose work directory cannot be made copies the partial fixture privately, then removes its scratch', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'work-unmade');
  assertControlFailedAt(run, GUARD.work(), 'c757 forced work directory failure');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-returned'), [], 'a control stopped in setup started a process');
  assert.deepEqual(steps(run), { release: 'written', tail: 'never-started', caller: 'never-started', command: 'never-started', snapshot: 'closed-copy' }, 'the finalizer does not record a partial setup with nothing started');
  const produced = run.inventory.expected.filter(({ state }) => state !== 'never-produced').map(({ name }) => name).sort();
  assert.deepEqual(produced, ['finalizer.json', 'fixture/begin-exit', 'fixture/release'], 'the inventory does not match the partial fixture');
  assert.deepEqual(run.inventory.discovered.map(({ name }) => name).sort(), ['fixture/begin-exit', 'fixture/release'], 'the private copy does not hold exactly the partial fixture');
  assert.ok(tracedAs(run, 'parent', 'copy-returned').length === 1, 'the partial fixture was not copied privately');
  assert.deepEqual(run.scratchLeft, [], 'the scratch was kept after a clean finalization of the partial fixture');
});

test('C615 directory teardown T2/T3/T5 live tail, no caller: a control stopped before its caller starts kills the live tail and reads no command', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'stop-at-caller', { admission: true });
  assertControlFailedAt(run, GUARD.admittedBeforeCaller(), 'the focused runner closed new test work before fixture start');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-returned').map(({ who, pidClass }) => [who, pidClass]), [['tail', 'positive-safe']], 'the control did not start exactly a tail with a valid pid');
  assertKills(run, [['tail', 'SIGKILL', true]], 'the teardown did not answer a kill of the live tail');
  assert.ok(tracedAs(run, 'parent', 'handle-exit').some(({ who, signal }) => who === 'tail' && signal === 'SIGKILL'), 'the live tail did not end by the teardown kill');
  assert.deepEqual(tracedAs(run, 'parent', 'command-read'), [], 'the teardown read a command no caller started');
  assert.deepEqual(steps(run), { release: 'written', tail: 'reaped', caller: 'never-started', command: 'never-started', snapshot: 'closed-copy' }, 'the finalizer does not record the live tail ended with no caller');
  assert.deepEqual(run.scratchLeft, [], 'the scratch was kept after a clean finalization');
});

test('C615 directory teardown T3/T5 cooperative caller: a control failing while its caller waits releases it to end on its own, and the command is gone at its first read', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'tail-ends');
  assertControlFailedAt(run, GUARD.tailRunning(), 'the recorded tail ended before the exit census began');
  assertKills(run, [], 'the teardown signalled a tail already ended or a caller that ends on its own');
  assert.ok(tracedAs(run, 'parent', 'handle-exit').some(({ who, code }) => who === 'caller' && code === 0), 'the released caller did not end on its own with status 0');
  const [read] = tracedAs(run, 'parent', 'command-read');
  assert.ok(read && read.status === 1 && read.stdout === '', 'the command was not absent at the teardown first read');
  assert.deepEqual(steps(run), { release: 'written', tail: 'reaped', caller: 'reaped', command: 'absent', snapshot: 'closed-copy' }, 'the finalizer does not record the cooperative end');
});

test('C615 directory teardown T4/T5/T6 forced caller: a caller the failed release never frees is killed, a stopped command is read present then absent, and the scratch is kept', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'begin-exit-fails');
  assertControlFailedAt(run, GUARD.tailRunning(), 'the recorded tail ended before the exit census began');
  assert.ok(tracedAs(run, 'parent', 'write-failed-by-forcing').length === 1, 'the teardown release write was not refused');
  const kills = tracedAs(run, 'parent', 'handle-kill-call');
  assert.ok(kills.length === 1 && kills[0].who === 'caller' && kills[0].signal === 'SIGKILL' && kills[0].pidClass === 'positive-safe' && kills[0].ended === false, 'the teardown did not force the live caller once');
  assertKills(run, [['caller', 'SIGKILL', true]], 'the forced caller kill was not answered');
  assert.ok(tracedAs(run, 'parent', 'handle-exit').some(({ who, signal }) => who === 'caller' && signal === 'SIGKILL'), 'the forced caller did not end by its kill');
  const reads = tracedAs(run, 'parent', 'command-read');
  const command = reads[0]?.command;
  assert.ok(reads.length >= 2 && reads[0].status === 0 && new RegExp(`^\\s*${command}\\s+T`, 'm').test(reads[0].stdout), 'the stopped command was not read present first');
  const absent = reads.findIndex(({ status }) => status === 1);
  assert.ok(absent > 0 && reads.slice(0, absent).every(({ status }) => status === 0) && reads.slice(absent).every(({ status, stdout, stderr }) => status === 1 && stdout === '' && stderr === ''), `the command was not read present, then absent once it went: ${JSON.stringify(reads.map(({ status, stdout }) => [status, stdout]))}`);
  assert.deepEqual(steps(run), { release: 'failed', tail: 'reaped', caller: 'reaped', command: 'absent', snapshot: 'partial-copy-source-retained' }, 'the finalizer does not record the failed release with every process ended');
  assert.equal(run.scratchLeft.length, 1, 'the scratch was not kept after an unconfirmed finalization');
  assert.equal(run.inventory.completeness, 'unconfirmed-partial', 'the inventory claims a closed copy');
});

test('C615 directory teardown T2 failed tail start: a tail handle with no pid is not signalled, and its error leaves the scratch kept', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'tail-unstartable');
  assertControlFailedAt(run, GUARD.tailStarted(), 'the direct tail fixture did not start');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-returned').map(({ who, pidClass }) => [who, pidClass]), [['tail', 'undefined']], 'the failed tail start did not return a handle with no pid');
  assert.ok(tracedAs(run, 'parent', 'handle-error').some(({ who, error }) => who === 'tail' && error.code === 'ENOENT'), 'the failed tail start did not record its error');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-kill-call'), [], 'the teardown signalled a tail handle with no pid');
  assert.deepEqual(steps(run), { release: 'written', tail: 'unresolved', caller: 'never-started', command: 'never-started', snapshot: 'partial-copy-source-retained' }, 'the finalizer credits a failed tail start with a clean end');
  assert.equal(run.scratchLeft.length, 1, 'the scratch was not kept after an unconfirmed finalization');
});

test('C615 directory teardown T3 failed caller start: a caller handle with no pid is not signalled, the live tail is, and the scratch is kept', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 directory control it runs requires macOS');
  const run = await listingRun(t, 'caller-unstartable');
  assertControlFailedAt(run, GUARD.callerStarted(), 'the direct caller fixture did not start');
  assert.deepEqual(tracedAs(run, 'parent', 'handle-returned').map(({ who, pidClass }) => [who, pidClass]), [['tail', 'positive-safe'], ['caller', 'undefined']], 'the failed caller start did not return a handle with no pid');
  assertKills(run, [['tail', 'SIGKILL', true]], 'the teardown signalled other than the live tail');
  assert.deepEqual(tracedAs(run, 'parent', 'command-read'), [], 'the teardown read a command no caller started');
  assert.deepEqual(steps(run), { release: 'written', tail: 'reaped', caller: 'unresolved', command: 'unresolved', snapshot: 'partial-copy-source-retained' }, 'the finalizer credits a failed caller start with a clean end');
  assert.equal(run.scratchLeft.length, 1, 'the scratch was not kept after an unconfirmed finalization');
});

// proves R-STATE-26
test('C615 Mac group full tool exit census', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('this real ps control requires macOS');
  assertFocusedAdmission();
  let directory;
  let evidenceRoot;
  let caller;
  let callerError;
  let birth;
  let finalized = false;
  let copied = false;
  let bodyStage = 'before-fixture';
  const nonce = randomUUID();
  const finished = (child) => child.exitCode !== null || child.signalCode !== null;
  const waitFor = async (condition, milliseconds) => {
    const deadline = performance.now() + milliseconds;
    while (!condition() && performance.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    return condition();
  };

  t.after(async () => {
    let failure;
    const result = { release: 'not-started', caller: 'not-started', group: 'not-observed', snapshot: 'pending', bodyStage };
    try {
      if (directory) {
        writeFileSync(join(directory, `release-${nonce}`), nonce);
        writeFileSync(join(directory, 'begin-exit'), '');
        result.release = 'written';
      }
      if (caller && !finished(caller)) {
        await waitFor(() => finished(caller) || callerError !== undefined, 3_000);
        if (!finished(caller) && caller.pid !== undefined) caller.kill('SIGKILL');
      }
      const callerReaped = !caller || await waitFor(() => finished(caller) || callerError !== undefined, 3_000);
      result.caller = !caller ? 'never-started' : callerReaped && !callerError && finished(caller) ? 'reaped' : 'unresolved';
      const recorded = birth ?? (directory && existsSync(join(directory, 'group-birth.json')) ? JSON.parse(readFileSync(join(directory, 'group-birth.json'), 'utf8')) : undefined);
      if (recorded) {
        const settled = await waitFor(() => {
          const read = spawnSync(PS, ['-ww', '-p', String(recorded.group), '-o', 'pid=,stat=,command='], { env: process.env, encoding: 'utf8' });
          assert.ok(!read.error && (read.status === 0 || (read.status === 1 && read.stdout === '' && read.stderr === '')), 'the group finalizer could not read the process table');
          if (read.status === 1) { result.group = 'absent'; return true; }
          const row = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(read.stdout.trimEnd());
          assert.ok(row && Number(row[1]) === recorded.group, 'the group finalizer could not identify the recorded PID');
          if (row[2].startsWith('Z')) { result.group = 'zombie'; return true; }
          let started;
          try { started = startOf(recorded.group); } catch { return false; }
          if (started !== recorded.started || !row[3].includes(recorded.nonce)) { result.group = 'identity-changed'; return true; }
          return false;
        }, 3_000);
        if (!settled) result.group = 'unresolved-live';
      }
      assert.ok(callerReaped && !callerError && (!caller || finished(caller)), 'the recorded caller handle was not reaped');
      assert.ok(!caller || recorded, 'the started group has no recorded birth identity');
      assert.equal(result.group, 'absent', 'the recorded group identity was not absent after cooperative release');
      finalized = true;
    } catch (error) {
      failure = error;
      result.failure = error.code ?? error.name ?? 'Error';
    } finally {
      if (evidenceRoot) {
        const finalizerPath = join(evidenceRoot, 'finalizer.json');
        try {
          result.bodyStage = bodyStage;
          writeFileSync(finalizerPath, JSON.stringify(result));
          if (directory) cpSync(directory, join(evidenceRoot, 'fixture'), { recursive: true, force: false, errorOnExist: true });
          result.snapshot = finalized ? 'closed-copy' : 'partial-copy-source-retained';
          writeFileSync(finalizerPath, JSON.stringify(result));
          const expected = ['caller.stderr', 'finalizer.json', 'fixture/caller.mjs', 'fixture/fixture.mjs', 'fixture/group-birth.json', 'fixture/fixture-identity.json', 'fixture/up', 'fixture/begin-exit', `fixture/release-${nonce}`, 'fixture/control.trace.jsonl', 'fixture/events', 'fixture/ending', 'fixture/returned-tool-reads/manifest.jsonl'];
          const inventory = expected.map((name) => {
            const path = join(evidenceRoot, name);
            if (!existsSync(path)) return { name, state: 'never-produced' };
            const file = lstatSync(path);
            return file.isFile() ? { name, state: file.size === 0 ? 'produced-empty' : 'produced', bytes: file.size } : { name, state: 'unexpected-type' };
          });
          const discovered = [];
          const scan = (at, prefix) => {
            for (const entry of readdirSync(at, { withFileTypes: true })) {
              const name = `${prefix}${entry.name}`;
              if (entry.isDirectory()) scan(join(at, entry.name), `${name}/`);
              else {
                const file = lstatSync(join(at, entry.name));
                discovered.push(file.isFile() ? { name, state: file.size === 0 ? 'produced-empty' : 'produced', bytes: file.size } : { name, state: 'unexpected-type' });
              }
            }
          };
          if (directory) scan(join(evidenceRoot, 'fixture'), 'fixture/');
          writeFileSync(join(evidenceRoot, 'inventory.json'), JSON.stringify({ expected: inventory, discovered, completeness: finalized ? 'closed' : 'unconfirmed-partial' }));
          copied = true;
        } catch (error) {
          result.snapshot = 'copy-or-inventory-failed-source-retained';
          try { writeFileSync(finalizerPath, JSON.stringify(result)); } catch { /* The scratch remains the original. */ }
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
  });

  assert.ok(process.env.TMPDIR, 'the Mac group control needs an explicit external TMPDIR');
  const checkout = realpathSync.native(process.cwd());
  const outsideCheckout = (path) => path !== checkout && !path.startsWith(`${checkout}/`);
  assert.ok(outsideCheckout(resolve(process.env.TMPDIR)) && outsideCheckout(realpathSync.native(process.env.TMPDIR)), 'the Mac group control TMPDIR is inside the checkout');
  assert.ok(process.env.C615_EVIDENCE_ROOT, 'the Mac group control needs a private C615_EVIDENCE_ROOT before any fixture starts');
  const outerRoot = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  assert.ok(outsideCheckout(resolve(process.env.C615_EVIDENCE_ROOT)) && outsideCheckout(outerRoot), 'the group evidence root is inside the checkout');
  assert.equal(lstatSync(outerRoot).mode & 0o077, 0, 'the shared private evidence root is accessible to other users');
  const groupRoot = join(outerRoot, 'group');
  if (!existsSync(groupRoot)) mkdirSync(groupRoot, { mode: 0o700 });
  const child = lstatSync(groupRoot);
  assert.ok(child.isDirectory() && !child.isSymbolicLink() && (child.mode & 0o077) === 0, 'the group evidence child is not a private directory');
  evidenceRoot = realpathSync.native(groupRoot);
  assert.ok(evidenceRoot.startsWith(`${outerRoot}/`), 'the group evidence child escaped its private outer root');
  assert.equal(readdirSync(evidenceRoot).length, 0, 'the group evidence child was not empty before the attempt');
  assertFocusedAdmission();
  directory = realpathSync(temporaryDirectory('c615-mac-group-', { context: t, beforeRemoval: () => assert.ok(finalized && copied, 'finalization or private copy is incomplete; keep the group fixture scratch') }));
  const fixturePath = join(directory, 'fixture.mjs');
  writeFileSync(fixturePath, [
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import { renameSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const here = process.argv[2];',
    'const nonce = process.argv[3];',
    "writeFileSync(join(here, 'fixture-identity.json'), JSON.stringify({ pid: process.pid, nonce }));",
    "writeFileSync(join(here, 'up.partial'), nonce);",
    "renameSync(join(here, 'up.partial'), join(here, 'up'));",
    "while (!existsSync(join(here, `release-${nonce}`))) await new Promise((resolve) => setImmediate(resolve));",
  ].join('\n'));
  const callerPath = join(directory, 'caller.mjs');
  writeFileSync(callerPath, [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import { createHash as readHash } from 'node:crypto';",
    "import { mkdirSync as readMkdir } from 'node:fs';",
    'const here = process.argv[2];',
    'const nonce = process.argv[3];',
    'const traceHere = here;',
    'const traceJoin = join;',
    'const traceAppend = appendFileSync;',
    'const readWrite = writeFileSync;',
    'let traceSequence = 0;',
    "const trace = (kind, fields = {}) => appendFileSync(join(here, 'control.trace.jsonl'), JSON.stringify({ sequence: ++traceSequence, kind, ...fields }) + '\\n');",
    'const markers = () => ({});',
    'const originalSpawnSync = childProcess.spawnSync;',
    ...MAC_RETURNED_OBSERVER,
    'syncBuiltinESMExports();',
    `const { runCommand } = await import(${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)});`,
    "const emitter = { emit: (event, fields) => { trace('event', { event, ...fields }); appendFileSync(join(here, 'events'), JSON.stringify({ event, ...fields }) + '\\n'); } };",
    "const kill = (target, name) => { trace('signal-start', { target, name }); try { const answer = process.kill(target, name); trace('signal-answer', { target, name, answer }); return answer; } catch (error) { trace('signal-answer', { target, name, error: error.code ?? null }); throw error; } };",
    "const onGroup = (group, started) => writeFileSync(join(here, 'group-birth.json'), JSON.stringify({ group, started, nonce }));",
    "const onExit = (group, ending) => writeFileSync(join(here, 'ending'), JSON.stringify({ group, ending }));",
    "void runCommand({ command: process.execPath, args: [join(here, 'fixture.mjs'), here, nonce], cwd: here, env: process.env, timeout: 600_000, readTimeout: 1_000, emitter, kill, onGroup, onExit });",
    "while (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));",
    "while (!existsSync(join(here, 'begin-exit'))) await new Promise((resolve) => setImmediate(resolve));",
    "trace('caller-end');",
    'process.exit(0);',
  ].join('\n'));
  const callerStderr = openSync(join(evidenceRoot, 'caller.stderr'), 'wx', 0o600);
  try {
    assertFocusedAdmission();
    caller = spawn(process.execPath, [callerPath, directory, nonce], { stdio: ['ignore', 'ignore', callerStderr] });
    bodyStage = 'caller-started';
  } finally {
    closeSync(callerStderr);
  }
  caller.on('error', (error) => { callerError = error; });
  assert.ok(Number.isSafeInteger(caller.pid) && caller.pid > 0, 'the direct group caller did not start');
  await until(() => (existsSync(join(directory, 'up')) && existsSync(join(directory, 'group-birth.json'))) || callerError !== undefined || finished(caller), t);
  assert.ok(!callerError && !finished(caller), 'the group caller ended before its recorded exit boundary');
  assert.equal(readFileSync(join(directory, 'up'), 'utf8'), nonce, 'the direct Node fixture did not record the expected nonce');
  birth = JSON.parse(readFileSync(join(directory, 'group-birth.json'), 'utf8'));
  const fixtureIdentity = JSON.parse(readFileSync(join(directory, 'fixture-identity.json'), 'utf8'));
  assert.ok(Number.isSafeInteger(birth.group) && birth.group > 0 && Number.isInteger(birth.started) && birth.nonce === nonce && fixtureIdentity.pid === birth.group && fixtureIdentity.nonce === nonce, 'onGroup did not bind the direct Node fixture to its birth identity');
  assert.equal(startOf(birth.group), birth.started, 'the recorded group PID no longer has its birth identity');
  bodyStage = 'exit-census-started';
  writeFileSync(join(directory, 'begin-exit'), '');
  await until(() => finished(caller) || callerError !== undefined, t);
  assert.ok(!callerError && caller.exitCode === 0, 'the group caller did not finish exit cleanup; inspect its private stderr');

  const trace = linesOf(directory, 'control.trace.jsonl');
  const reads = trace.filter(({ kind, tool, status, error }) => kind === 'read-end' && tool === PS && status === 0 && !error);
  const matching = (args) => reads.filter(({ args: given }) => given?.length === args.length && given.every((value, index) => value === args[index]));
  const group = birth.group;
  const states = ['-ww', '-g', String(group), '-o', 'pid=,stat='];
  const commands = ['-ww', '-g', String(group), '-o', 'pid=,command='];
  const names = ['-p', String(group), '-o', 'ucomm='];
  const ordered = trace.filter(({ kind }) => kind === 'read-end');
  const first = ordered.findIndex(({ tool, args }) => tool === PS && JSON.stringify(args) === JSON.stringify(states));
  const round = ordered.slice(first, first + 5);
  assert.ok(first >= 0 && round.length === 5 && [states, commands, names, commands, states].every((args, index) => round[index].tool === PS && JSON.stringify(round[index].args) === JSON.stringify(args) && round[index].status === 0 && !round[index].error), 'the actual real ps group census did not complete C1–C5');
  assert.ok(round[0].stdout.split('\n').some((line) => new RegExp(`^\\s*${group}\\s+[^Z?]`).test(line)) && round[4].stdout.split('\n').some((line) => new RegExp(`^\\s*${group}\\s+[^Z?]`).test(line)), 'the real group state reads did not show the recorded live fixture');
  assert.ok(round[1].stdout.includes(fixturePath) && round[1].stdout.includes(nonce) && round[3].stdout.includes(fixturePath) && round[3].stdout.includes(nonce), 'the actual command reads did not identify the direct Node fixture');
  const observedName = round[2].stdout.replace(/ *\n$/, '');
  assert.ok(observedName !== '' && round[1].stdout === round[3].stdout, 'the real name or command answer did not make an accepted round');
  const before = matching(['-g', String(group), '-o', 'pid=,stat=']).find(({ sequence }) => sequence > round[4].sequence);
  assert.ok(before && before.stdout.split('\n').some((line) => new RegExp(`^\\s*${group}\\s+[^Z?]`).test(line)), 'the real before-kill group read did not confirm the live fixture');
  const kill = trace.find(({ kind, target, name, answer, sequence }) => kind === 'signal-answer' && target === -group && name === 'SIGKILL' && answer === true && sequence > before.sequence);
  assert.ok(kill, 'the recorded group was not actually sent SIGKILL after the before-kill read');
  const post = matching(['-g', String(group), '-o', 'pid=,stat=,xstat=']).find(({ sequence }) => sequence > kill.sequence);
  assert.ok(post, 'the real post-kill group read was not reached and answered');
  const events = linesOf(directory, 'events');
  const named = events.find(({ event, pid }) => event === 'survivor.killed' && pid === group);
  const observedCommand = /^\s*\d+\s+(.*)$/.exec(round[3].stdout.trimEnd())?.[1];
  assert.ok(named && named.name === observedName && named.cmd === observedCommand && named.reason === undefined, 'the reached group result did not record the observed identity and disposition');
  assert.ok(!events.some(({ event }) => event === 'group.killed'), 'the answered accepted group census invented an unnamed group result');
  assert.equal(events.length, 1, 'the answered group reads did not justify another forced-end event');
  const eventTrace = trace.filter(({ kind }) => kind === 'event');
  assert.ok(eventTrace.length === events.length && eventTrace.every((entry, index) => ['event', 'pid', 'name', 'cmd', 'reason'].every((field) => entry[field] === events[index][field])), 'the group event file does not match the ordered private trace');
  const namedTrace = eventTrace.find(({ event, pid }) => event === 'survivor.killed' && pid === group);
  assert.ok(namedTrace && namedTrace.sequence > post.sequence, 'the group event did not follow the answered post-kill read');

  bodyStage = 'per-read-original-guard';
  const { traceEnds } = assertReturnedToolOriginals(directory, trace);
  assert.ok(traceEnds.every(({ sequence }) => sequence < namedTrace.sequence), 'an actual tool return did not precede the group result');
  const callerEnds = trace.filter(({ kind }) => kind === 'caller-end');
  const trigger = callerEnds.length === 1 ? callerEnds[0] : undefined;
  const exitStarts = trigger ? trace.filter(({ kind, sequence }) => kind === 'read-start' && sequence > trigger.sequence) : [];
  assert.ok(trigger && exitStarts.length > 0 && exitStarts[0].readId === round[0].readId && exitStarts.every(({ sequence }) => sequence < namedTrace.sequence) && traceEnds.filter(({ sequence }) => sequence > trigger.sequence).every(({ sequence }) => sequence < namedTrace.sequence), 'the exit census did not start at C1 after the caller-end trigger and close before the named event');
  bodyStage = 'passed';
});

/**
 * The lines of the C615 group publication observer, a module every Node process of a nested C615
 * run loads first, through `NODE_OPTIONS`. Each fixture, caller and parent step on the group
 * fixture's files is appended to one trace opened for append, so the trace's order is the order
 * those steps happened across the processes: an entry appended after one step returned, ahead of
 * one appended before another began, puts the first step before the second. In a forcing mode it
 * holds the fixture's nonce write open, empty, part-written or fully written, until the parent has
 * looked at `up` and found nothing or read it; or it completes that write with other bytes (#753).
 */
const C615_PUBLICATION_OBSERVER = [
  "import fs from 'node:fs';",
  "import childProcess from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  "const tracePath = process.env.C753_TRACE;",
  "const mode = process.env.C753_MODE ?? 'observe';",
  "if (tracePath && !globalThis.c753Observer) {",
  "  globalThis.c753Observer = true;",
  "  const real = { ...fs };",
  "  const fixtureDirectory = /\\/c615-mac-group-[^/]+$/;",
  "  const name = (path) => path.slice(path.lastIndexOf('/') + 1);",
  "  const within = (path) => typeof path === 'string' && fixtureDirectory.test(path.slice(0, path.lastIndexOf('/'))) && name(path) !== 'control.trace.jsonl';",
  "  const script = process.argv[1] ?? '';",
  "  const role = within(script) && name(script) === 'fixture.mjs' ? 'fixture' : within(script) && name(script) === 'caller.mjs' ? 'caller' : 'parent';",
  "  const shown = new Set(['up', 'group-birth.json', 'fixture-identity.json']);",
  "  let sequence = 0;",
  "  const mark = (event, fields = {}) => real.appendFileSync(tracePath, `${JSON.stringify({ role, pid: process.pid, sequence: ++sequence, ns: String(process.hrtime.bigint()), event, ...fields })}\\n`);",
  "  const held = `${tracePath}.held`;",
  "  const observed = `${tracePath}.observed`;",
  "  const holding = () => mode.startsWith('hold-') && real.existsSync(held) && !real.existsSync(observed);",
  "  const observe = (op, result) => {",
  "    mark('parent-observed-while-held', { op, result });",
  "    real.writeFileSync(observed, '');",
  "  };",
  "  const checks = new Map();",
  "  fs.existsSync = (path) => {",
  "    const result = real.existsSync(path);",
  "    if (within(path) && ['up', 'group-birth.json', 'begin-exit'].includes(name(path))) {",
  "      const key = name(path);",
  "      const prior = checks.get(key);",
  "      if (!prior || prior.result !== result) {",
  "        mark('exists', { path: key, result, priorChecks: prior?.count ?? 0 });",
  "        checks.set(key, { result, count: 1 });",
  "      } else prior.count += 1;",
  "      if (role === 'parent' && key === 'up' && !result && holding()) observe('exists', result);",
  "    }",
  "    return result;",
  "  };",
  "  fs.readFileSync = (path, ...rest) => {",
  "    if (!within(path)) return real.readFileSync(path, ...rest);",
  "    const key = name(path);",
  "    mark('read-start', { path: key });",
  "    let value;",
  "    try {",
  "      value = real.readFileSync(path, ...rest);",
  "    } catch (error) {",
  "      mark('read-error', { path: key, code: error.code ?? null });",
  "      throw error;",
  "    }",
  "    const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);",
  "    mark('read-returned', { path: key, bytes: Buffer.byteLength(text), ...(shown.has(key) ? { text } : {}) });",
  "    if (role === 'parent' && key === 'up' && holding()) observe('read', text);",
  "    return value;",
  "  };",
  "  const hold = () => {",
  "    const release = `${process.argv[2]}/release-${process.argv[3]}`;",
  "    mark('hold-start');",
  "    real.writeFileSync(held, '');",
  "    let by;",
  "    while (by === undefined) {",
  "      if (real.existsSync(observed)) by = 'parent-observation';",
  "      else if (real.existsSync(release)) by = 'release';",
  "    }",
  "    mark('hold-released', { by });",
  "  };",
  "  const publish = (path, nonce) => {",
  "    const bytes = Buffer.from(mode === 'complete-empty' ? '' : mode === 'complete-wrong' ? `wrong-${nonce}` : nonce);",
  "    const key = name(path);",
  "    mark('publish-start', { path: key });",
  "    const descriptor = real.openSync(path, 'w');",
  "    mark('publish-opened', { path: key });",
  "    if (mode === 'hold-empty') hold();",
  "    let at = 0;",
  "    const writeTo = (end) => {",
  "      while (at < end) at += real.writeSync(descriptor, bytes, at, end - at);",
  "      mark('publish-wrote', { path: key, bytes: at });",
  "    };",
  "    if (mode === 'hold-prefix') {",
  "      writeTo(8);",
  "      hold();",
  "    }",
  "    writeTo(bytes.length);",
  "    if (mode === 'hold-exact') hold();",
  "    real.closeSync(descriptor);",
  "    mark('publish-returned', { path: key, bytes: at });",
  "  };",
  "  fs.writeFileSync = (path, data, ...rest) => {",
  "    if (role === 'fixture' && typeof data === 'string' && data === process.argv[3]) return publish(path, data);",
  "    if (typeof path !== 'string' || (!within(path) && !['finalizer.json', 'inventory.json'].includes(name(path)))) return real.writeFileSync(path, data, ...rest);",
  "    const key = name(path);",
  "    mark('write-start', { path: key });",
  "    try {",
  "      real.writeFileSync(path, data, ...rest);",
  "    } catch (error) {",
  "      mark('write-error', { path: key, code: error.code ?? null });",
  "      throw error;",
  "    }",
  "    mark('write-returned', { path: key });",
  "  };",
  "  fs.renameSync = (from, to) => {",
  "    if (!within(to)) return real.renameSync(from, to);",
  "    mark('rename-start', { from: name(from), to: name(to) });",
  "    real.renameSync(from, to);",
  "    mark('rename-returned', { from: name(from), to: name(to) });",
  "  };",
  "  fs.cpSync = (from, to, ...rest) => {",
  "    if (typeof from !== 'string' || !fixtureDirectory.test(from)) return real.cpSync(from, to, ...rest);",
  "    mark('copy-start');",
  "    try {",
  "      real.cpSync(from, to, ...rest);",
  "    } catch (error) {",
  "      mark('copy-error', { code: error.code ?? null });",
  "      throw error;",
  "    }",
  "    mark('copy-returned');",
  "  };",
  "  if (role === 'parent') {",
  "    const spawn = childProcess.spawn;",
  "    childProcess.spawn = function (command, args, ...rest) {",
  "      const child = spawn.call(this, command, args, ...rest);",
  "      if (Array.isArray(args) && within(args[0]) && name(args[0]) === 'caller.mjs') {",
  "        mark('caller-spawned', { child: child.pid ?? null });",
  "        child.on('error', (error) => mark('caller-error', { code: error.code ?? null }));",
  "        child.on('exit', (code, signal) => mark('caller-exit', { code, signal }));",
  "      }",
  "      return child;",
  "    };",
  "  }",
  "  if (role === 'caller') {",
  "    const spawnSync = childProcess.spawnSync;",
  "    childProcess.spawnSync = function (command, args, ...rest) {",
  ("      if (command !== " + JSON.stringify(PS) + ") return spawnSync.call(this, command, args, ...rest);"),
  "      mark('tool-start', { tool: command, args });",
  "      const answer = spawnSync.call(this, command, args, ...rest);",
  "      mark('tool-returned', { tool: command, status: answer.status, error: answer.error?.code ?? null });",
  "      return answer;",
  "    };",
  "  }",
  "  syncBuiltinESMExports();",
  "}",
];

/**
 * Runs the C615 group test alone in a nested runner, every Node process of which loads the
 * publication observer in `mode`, and answers its exit status, its output, its ordered trace, its
 * private evidence and the nonce its fixture was given. Every process the run starts names the
 * test's scratch directory, so the scratch teardown ends whichever the run's own did not.
 */
async function publicationRun(t, mode) {
  const directory = holding(t);
  const observer = join(directory, 'observer.mjs');
  assert.ok(!/\s/.test(observer), 'NODE_OPTIONS cannot name an observer path holding whitespace');
  writeFileSync(observer, C615_PUBLICATION_OBSERVER.join('\n'));
  const scratchTmp = join(directory, 'tmp');
  mkdirSync(scratchTmp);
  const evidence = join(directory, 'evidence');
  mkdirSync(evidence, { mode: 0o700 });
  const tracePath = join(directory, 'trace.jsonl');
  const { NODE_TEST_CONTEXT, C615_WORK_DEADLINE_NS, C615_STOP_MARKER, C615_SIGHTING_EVIDENCE_ROOT, ...inherited } = process.env;
  const env = { ...inherited, TMPDIR: scratchTmp, C615_EVIDENCE_ROOT: evidence, C753_TRACE: tracePath, C753_MODE: mode, NODE_OPTIONS: [inherited.NODE_OPTIONS, `--import=${observer}`].filter(Boolean).join(' ') };
  const run = spawn(process.execPath, [`--import=${observer}`, '--test', '--test-reporter=spec', '--test-name-pattern=^C615 Mac group full tool exit census$', fileURLToPath(import.meta.url)], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  run.stdout.on('data', (chunk) => { output += chunk; });
  run.stderr.on('data', (chunk) => { output += chunk; });
  const [status] = await once(run, 'close', { signal: t.signal });
  assert.deepEqual(running(directory), [], 'a process the nested C615 run started outlived its own teardown');
  const trace = readFileSync(tracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const finalizer = JSON.parse(readFileSync(join(evidence, 'group', 'finalizer.json'), 'utf8'));
  const { nonce } = JSON.parse(readFileSync(join(evidence, 'group', 'fixture', 'fixture-identity.json'), 'utf8'));
  return { status, output, trace, finalizer, nonce };
}

/** The place in `trace` of the first entry `matches`, which fails the test where there is none. */
const placeOf = (trace, what, matches) => {
  const place = trace.findIndex(matches);
  assert.ok(place >= 0, `the publication trace never recorded ${what}`);
  return place;
};

/**
 * Asserts that the nested run's parent read `up` exactly once, only after the fixture's nonce write
 * had returned, and answers what that read returned and where it stands in the trace.
 */
function assertReadAfterReturn({ trace }) {
  const returned = placeOf(trace, 'the returned nonce write', ({ role, event }) => role === 'fixture' && event === 'publish-returned');
  const reads = trace.flatMap((entry, place) => (entry.role === 'parent' && entry.event === 'read-start' && entry.path === 'up' ? [place] : []));
  assert.equal(reads.length, 1, 'the parent did not read up exactly once');
  assert.ok(reads[0] > returned, 'the parent read up before the fixture write of its nonce returned');
  const answered = placeOf(trace, 'the parent read of up returning', ({ role, event, path }, place) => place > reads[0] && role === 'parent' && event === 'read-returned' && path === 'up');
  return { text: trace[answered].text, answered };
}

/**
 * Asserts that a held nonce write was looked at, and not read, while it was in progress: the hold
 * began after `before` was written, and the parent then found no `up` and went on waiting.
 */
function assertHeldUnread(run, before) {
  const { trace } = run;
  const opened = placeOf(trace, 'the nonce write opening its file', ({ role, event }) => role === 'fixture' && event === 'publish-opened');
  const held = placeOf(trace, 'the hold of the nonce write', ({ role, event }) => role === 'fixture' && event === 'hold-start');
  const written = trace.slice(opened, held).filter(({ role, event }) => role === 'fixture' && event === 'publish-wrote').map(({ bytes }) => bytes);
  assert.deepEqual(written, before === 0 ? [] : [before], 'the hold did not begin with the bytes this cell holds');
  const looked = placeOf(trace, 'the parent looking at up during the hold', ({ role, event }) => role === 'parent' && event === 'parent-observed-while-held');
  assert.ok(looked > held && trace[looked].op === 'exists' && trace[looked].result === false, 'the parent saw up while its nonce write was still in progress');
  const released = placeOf(trace, 'the hold released', ({ role, event }) => role === 'fixture' && event === 'hold-released');
  assert.ok(released > looked && trace[released].by === 'parent-observation', 'the hold ended before the parent had looked at up');
}

/** Asserts that the nested C615 run passed, reading its own nonce only after the write returned. */
function assertPublishedPass(run) {
  assert.equal(run.status, 0, `the nested C615 run failed:\n${run.output}`);
  assert.match(run.output, /✔ C615 Mac group full tool exit census/, 'the nested run did not pass the C615 group test');
  assert.equal(assertReadAfterReturn(run).text, run.nonce, 'the parent read other bytes than the nonce its fixture published');
  assert.equal(run.finalizer.bodyStage, 'passed', 'the nested C615 run did not reach its last stage');
}

/** Asserts that the nested C615 run failed on its nonce guard, on `bytes` its fixture's returned write published, before any group census. */
function assertNonceRefused(run, bytes) {
  assert.equal(run.status, 1, `the nested C615 run did not fail:\n${run.output}`);
  assert.match(run.output, /✖ C615 Mac group full tool exit census/, 'the nested run did not fail the C615 group test');
  assert.match(run.output, /the direct Node fixture did not record the expected nonce/, 'the nested C615 run did not fail on its nonce guard');
  const { text, answered } = assertReadAfterReturn(run);
  assert.equal(text, bytes(run.nonce), 'the parent did not read the bytes the returned write published');
  const census = run.trace.findIndex(({ role, event, args }) => role === 'caller' && event === 'tool-start' && args.includes('-g'));
  assert.ok(census === -1 || census > answered, 'a group census began before the nonce guard read up');
  assert.equal(run.finalizer.bodyStage, 'caller-started', 'the nested C615 run went past its nonce guard');
  assert.ok(run.finalizer.caller === 'reaped' && run.finalizer.group === 'absent', 'the nested C615 teardown did not end its caller and group after the failed guard');
}

test('C615 group publication N1a: up opened empty and still being written is not read as the published nonce', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  const run = await publicationRun(t, 'hold-empty');
  assertHeldUnread(run, 0);
  assertPublishedPass(run);
});

test('C615 group publication N1b: a returned write of no bytes to up fails the nonce guard before any census', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  assertNonceRefused(await publicationRun(t, 'complete-empty'), () => '');
});

test('C615 group publication N2a: up holding part of the nonce while still being written is not read as published', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  const run = await publicationRun(t, 'hold-prefix');
  assertHeldUnread(run, 8);
  assertPublishedPass(run);
});

test('C615 group publication N2b: a returned write of other bytes to up fails the nonce guard before any census', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  assertNonceRefused(await publicationRun(t, 'complete-wrong'), (nonce) => `wrong-${nonce}`);
});

test('C615 group publication N3a: up holding the whole nonce before its write returns is not read as published', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  const run = await publicationRun(t, 'hold-exact');
  assertHeldUnread(run, 36);
  assertPublishedPass(run);
});

test('C615 group publication N3b: the nonce write returned before the parent reads up, and the full census passes', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group test it runs requires macOS');
  assertPublishedPass(await publicationRun(t, 'observe'));
});

/**
 * The lines of a test file holding one test for each teardown cell #753 names: a pass and an
 * assertion failure, each with no process started, with every started process already ended, and
 * with a started process and its descendant still live. Each test makes its scratch through
 * `holding`, as `publicationRun` does, and records what was live when its teardown began.
 */
const TEARDOWN_CELLS = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { spawn } from 'node:child_process';",
  "import { appendFileSync, existsSync } from 'node:fs';",
  "import { join } from 'node:path';",
  `import { TAIL, alive, fixture, holding, leave, read, until } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};`,
  "const record = (entry) => appendFileSync(process.env.C753_CELL_LOG, JSON.stringify(entry) + '\\n');",
  "for (const result of ['pass', 'fail']) for (const state of ['none', 'ended', 'live']) test(`${result} ${state}`, async (t) => {",
  '  const cell = `${result} ${state}`;',
  '  const pids = [];',
  "  t.after(() => record({ cell, stage: 'teardown', live: pids.filter((pid) => alive(pid)) }));",
  '  const directory = holding(t);',
  "  record({ cell, stage: 'scratch', directory });",
  "  if (state !== 'none') {",
  "    const holder = spawn(fixture(directory, 'holder', [leave(TAIL, 'descendant'), ': > \"$here/left\"', 'wait'].join('\\n')), [], { stdio: 'ignore' });",
  "    await until(() => existsSync(join(directory, 'left')), t);",
  "    pids.push(holder.pid, Number(read(directory, 'descendant.pid')));",
  "    record({ cell, stage: 'started', pids });",
  "    if (state === 'ended') {",
  "      process.kill(pids[1], 'SIGKILL');",
  '      await until(() => holder.exitCode !== null && !alive(pids[1]), t);',
  '    }',
  '  }',
  "  if (result === 'fail') assert.equal(cell, 'a cell that passes', `the ${cell} cell fails here by design`);",
  '});',
];

test('C615 group publication teardown ends every process a test started, and each descendant, before its scratch is removed, after a pass and after a failure', SETTLES_WITHIN, async (t) => {
  if (process.platform !== 'darwin') return t.skip('the C615 group tests this proves run on macOS alone');
  const directory = holding(t);
  const cells = join(directory, 'cells.test.mjs');
  writeFileSync(cells, TEARDOWN_CELLS.join('\n'));
  const log = join(directory, 'cells.jsonl');
  const scratchTmp = join(directory, 'tmp');
  mkdirSync(scratchTmp);
  const { NODE_TEST_CONTEXT, ...inherited } = process.env;
  const run = spawn(process.execPath, ['--test', '--test-reporter=spec', cells], { cwd: directory, env: { ...inherited, TMPDIR: scratchTmp, C753_CELL_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  run.stdout.on('data', (chunk) => { output += chunk; });
  run.stderr.on('data', (chunk) => { output += chunk; });
  const [status] = await once(run, 'close', { signal: t.signal });
  assert.equal(status, 1, `the teardown cells did not fail only by design:\n${output}`);
  assert.match(output, /ℹ pass 3\n/, `three cells did not pass:\n${output}`);
  assert.match(output, /ℹ fail 3\n/, `three cells did not fail:\n${output}`);
  for (const cell of ['fail none', 'fail ended', 'fail live']) assert.ok(output.includes(`the ${cell} cell fails here by design`), `the ${cell} cell did not fail by design:\n${output}`);
  assert.ok(!output.includes('rounds of pkill'), `a cell's teardown left a process alive:\n${output}`);
  const entries = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  for (const result of ['pass', 'fail']) {
    for (const state of ['none', 'ended', 'live']) {
      const cell = `${result} ${state}`;
      const scratchOf = entries.find((entry) => entry.cell === cell && entry.stage === 'scratch');
      const started = entries.find((entry) => entry.cell === cell && entry.stage === 'started');
      const teardown = entries.find((entry) => entry.cell === cell && entry.stage === 'teardown');
      assert.ok(scratchOf && teardown, `the ${cell} cell did not record its scratch and teardown`);
      assert.equal(started === undefined, state === 'none', `the ${cell} cell started the wrong processes`);
      assert.deepEqual(teardown.live, state === 'live' ? started.pids : [], `the ${cell} cell's teardown did not begin with the processes this cell leaves`);
      for (const pid of started?.pids ?? []) assert.equal(alive(pid), false, `the ${cell} cell's process ${pid} outlived its teardown`);
      assert.equal(existsSync(scratchOf.directory), false, `the ${cell} cell's scratch was not removed after its teardown`);
    }
  }
  assert.deepEqual(running(scratchTmp), [], 'a process a teardown cell started outlived the cells');
});

/** Advances the group-census read driver's clock once, after its first read marked the cut. */
const GROUP_LATE_CALLER = (() => {
  const anchor = 'const options = JSON.parse(process.argv[3]);';
  assert.equal(CALLER.split(anchor).length, 2, 'the caller options moved, so the group clock forcing did not land');
  return CALLER.replace(anchor, [
    anchor,
    'const realNow = Date.now;',
    "Date.now = () => { const stack = new Error().stack ?? ''; if (existsSync(join(here, 'group-clock-cut')) && stack.split('\\n')[2]?.includes('at readingNow (') && stack.includes('at within (') && !globalThis.groupClockCut) { globalThis.groupClockCut = true; appendFileSync(join(here, 'group-clock-jump'), 'J'); return realNow() + 20_000; } return realNow(); };",
  ].join('\n'));
})();

/** Traces an accepted group round and a cut C2 read without changing the caller's tool answers. */
const GROUP_BOUND_CALLER = (() => {
  const options = 'const options = JSON.parse(process.argv[3]);';
  const trace = "if (options.postKillTrace) appendFileSync(join(here, 'post-kill-trace')";
  const observer = 'if (options.postKillTrace) {';
  const named = "const named = existsSync(join(here, 'hang')) && (tool === join(here, options.ps) || tool === join(here, options.lsof));";
  const signal = 'return signalled(target, name); };';
  for (const anchor of [options, trace, named, signal]) assert.equal(CALLER.split(anchor).length, 2, `the group trace anchor moved: ${anchor}`);
  assert.equal(CALLER.split(observer).length, 4, 'the caller no longer has separate read, clock and signal observers');
  return CALLER.replace(options, [
    options,
    'const realNow = Date.now;',
    "Date.now = () => { const stack = new Error().stack ?? ''; if (existsSync(join(here, 'group-clock-cut')) && stack.split('\\n')[2]?.includes('at readingNow (') && stack.includes('at within (') && !globalThis.groupClockCut) { globalThis.groupClockCut = true; appendFileSync(join(here, 'group-clock-jump'), 'J'); trace('clock-cut', { phase: 'C2' }); return realNow() + 20_000; } return realNow(); };",
  ].join('\n')).replace(trace, "if (options.groupBoundTrace) appendFileSync(join(here, 'group-bound.trace.jsonl')")
    .replace(observer, 'if (options.groupBoundTrace) {')
    .replace(named, "const named = (options.ps && tool === join(here, options.ps)) || (options.lsof && tool === join(here, options.lsof));")
    .replace(signal, "trace('signal-start', { target, name }); try { const answer = signalled(target, name); trace('signal-answer', { target, name, answer }); return answer; } catch (error) { trace('signal-answer', { target, name, error: error.code ?? null }); throw error; } };");
})();

// proves R-STATE-9, R-STATE-26
test('G3 C2 bound: an accepted round survives a rejected round and names the killed member', SETTLES_WITHIN, async (t) => {
  assert.ok(process.env.TMPDIR && process.env.C615_EVIDENCE_ROOT, 'the group-bound control needs external TMPDIR and private C615_EVIDENCE_ROOT');
  const checkout = realpathSync.native(process.cwd());
  const outsideCheckout = (path) => path !== checkout && !path.startsWith(`${checkout}/`);
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  assert.ok(outsideCheckout(resolve(process.env.TMPDIR)) && outsideCheckout(realpathSync.native(process.env.TMPDIR)) && outsideCheckout(resolve(process.env.C615_EVIDENCE_ROOT)) && outsideCheckout(outer), 'the group-bound control root is inside the checkout');
  assert.equal(lstatSync(outer).mode & 0o077, 0, 'the group-bound evidence root is not private');
  const privateRoot = join(outer, 'group-bound');
  if (!existsSync(privateRoot)) mkdirSync(privateRoot, { mode: 0o700 });
  assert.ok(lstatSync(privateRoot).isDirectory() && !lstatSync(privateRoot).isSymbolicLink() && (lstatSync(privateRoot).mode & 0o077) === 0 && realpathSync.native(privateRoot).startsWith(`${outer}/`), 'the group-bound child is not private');
  assert.deepEqual(readdirSync(privateRoot), [], 'the group-bound evidence child is not empty');

  let directory;
  let copied = false;
  let finalized = false;
  t.after(async () => {
    if (!directory) return;
    let finalizer = 'unobserved';
    try {
      writeFileSync(join(directory, 'release'), '');
      const group = pidIn(directory, 'group');
      finalizer = group === undefined ? 'identity-missing' : await gone(group, 3_000) ? 'absent' : 'unresolved-live';
      cpSync(directory, join(privateRoot, 'fixture'), { recursive: true, force: false, errorOnExist: true });
      copied = true;
      const expected = ['group-bound.trace.jsonl', 'caller.stderr', 'events', 'pairs', 'census-state-count', 'group-clock-cut', 'group-clock-jump'];
      writeFileSync(join(privateRoot, 'inventory.json'), JSON.stringify(expected.map((name) => {
        const path = join(privateRoot, 'fixture', name);
        return existsSync(path) ? { name, state: lstatSync(path).size === 0 ? 'produced-empty' : 'produced', bytes: lstatSync(path).size } : { name, state: 'never-produced' };
      })));
      assert.equal(finalizer, 'absent', 'the recorded group did not leave after cooperative release');
      finalized = true;
    } finally {
      writeFileSync(join(privateRoot, 'finalizer.json'), JSON.stringify({ group: finalizer, snapshot: copied ? 'copied' : 'copy-failed-source-retained' }));
    }
  });
  directory = realpathSync(temporaryDirectory('rigger-g3-c2-', { context: t, beforeRemoval: () => assert.ok(copied && finalized, 'the group-bound copy or finalizer is unresolved; keep fixture scratch') }));
  writeFileSync(join(directory, 'hold'), '');
  fixture(directory, 'command', 'echo $$ > "$here/group.pid"\n: > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*" -o pid=,stat=")',
    '  count=$(/bin/cat "$here/census-state-count" 2>/dev/null || printf 0)',
    '  count=$((count + 1))',
    '  printf "%s" "$count" > "$here/census-state-count"',
    '  case "$count" in',
    ("    1) " + shellQuote(PS) + " \"$@\" | /usr/bin/awk 'NR == 1 { $2 = \"?\" } { print }'; exit 0 ;;"),
    '    4) exit 1 ;;',
    '    5) : > "$here/group-clock-cut" ;;',
    '  esac ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, stderr, events } = await cleanedUpBy(GROUP_BOUND_CALLER, directory, { ps: 'ps', groupBoundTrace: true, hangAfter: 'group' });
  writeFileSync(join(directory, 'caller.stderr'), stderr);
  const group = pidIn(directory, 'group');
  assert.equal(status, 0, 'the group-bound caller failed; inspect its private stderr');
  assert.ok(Number.isSafeInteger(group) && group > 0, 'the group fixture did not record its leader');
  const trace = linesOf(directory, 'group-bound.trace.jsonl');
  const starts = trace.filter(({ operation, tool }) => operation === 'read-start' && tool === 'ps');
  const state = ['-ww', '-g', String(group), '-o', 'pid=,stat='];
  const command = ['-ww', '-g', String(group), '-o', 'pid=,command='];
  const name = ['-p', String(group), '-o', 'ucomm='];
  const phases = [state, command, name, command, state, state, command, name, command, state, state];
  assert.deepEqual(starts.slice(0, phases.length).map(({ argv }) => argv), phases, 'the forcing did not reach accepted C1–C5, rejected C1–C5 and the next C1');
  const ends = trace.filter(({ operation, tool }) => operation === 'read-end' && tool === 'ps');
  assert.ok(ends[0].stdout.includes('?') && ends[1].stdout === ends[3].stdout && ends[4].stdout.includes(String(group)) && ends[9].stdout === '' && ends[10].stdout.includes(String(group)), 'the first round was not accepted or the second was not rejected as unseen');
  assert.equal(read(directory, 'census-state-count'), '5', 'the read-position forcing did not stop at the third C1');
  assert.equal(read(directory, 'group-clock-jump'), 'J', 'the unchanged 1000 ms read bound was not cut before C2');
  assert.ok(trace.some(({ operation, phase }) => operation === 'clock-cut' && phase === 'C2'), 'the C2 deadline cut was not traced');
  assert.ok(!starts.slice(phases.length).some(({ argv }) => JSON.stringify(argv) === JSON.stringify(command)), 'a new C2 was spawned after its deadline');

  const before = trace.find(({ operation, argv }) => operation === 'read-end' && JSON.stringify(argv) === JSON.stringify(['-g', String(group), '-o', 'pid=,stat=']));
  assert.ok(before && before.stdout.split('\n').some((row) => new RegExp(`^\\s*${group}\\s+[^Z?]`).test(row)), 'the accepted last was lost before the live before-kill read');
  const kill = trace.find(({ operation, target, name: signal, answer }) => operation === 'signal-answer' && target === -group && signal === 'SIGKILL' && answer === true);
  assert.ok(kill && trace.indexOf(kill) > trace.indexOf(before), 'the group kill did not follow the live before-kill read');
  const probe = trace.find((entry, index) => index > trace.indexOf(kill) && entry.operation === 'signal-answer' && entry.target === -group && entry.name === 0);
  assert.ok(probe && ((probe.answer === true && probe.error === undefined) || (probe.error === 'EPERM' && probe.answer === undefined)), 'the first post-kill occupied probe did not reach O');
  assert.ok(trace.some((entry, index) => index > trace.indexOf(probe) && entry.operation === 'read-end' && JSON.stringify(entry.argv) === JSON.stringify(['-g', String(group), '-o', 'pid=,stat=,xstat='])), 'O did not reach a post-kill group answer');
  const records = events.filter(({ pid }) => pid === group);
  assert.equal(records.length, 1, 'the accepted member did not have one PID-bound result');
  assert.equal(records[0].event, 'survivor.killed', 'the group kill did not report the accepted live member');
  assert.equal(events.length, 1, 'the accepted group reads did not justify another forced-end event');
  const observedName = ends[2].stdout.replace(/ *\n$/, '');
  const observedCommand = /^\s*\d+\s+(.*)$/.exec(ends[3].stdout.trimEnd())?.[1];
  assert.ok(observedName && observedCommand && records[0].name === observedName && records[0].cmd === observedCommand && records[0].reason === undefined, 'the accepted member lost its observed name or command or gained an invented reason');
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed'), [], 'the accepted member was replaced by an unnamed group result');
  assert.ok(trace.some(({ operation, event, pid }) => operation === 'event' && event === 'survivor.killed' && pid === group), 'the product result was absent from the ordered private trace');
});

/** Forces a synchronous wait's next read to start after its deadline, with or without an answer. */
async function lateSynchronousWait(t, earlierAnswer) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', [
    ...(!earlierAnswer ? ['[ -f "$here/hang" ] && : > "$here/clock-cut"'] : []),
    listingOf('outside', realpathSync.native(join(work, 'sub'))),
  ].join('\n'));
  fixture(directory, 'ps', [
    ("[ -f \"$here/hang\" ] || exec " + shellQuote(PS) + " \"$@\""),
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    ...(earlierAnswer ? [
      '  if /bin/mkdir "$here/answered" 2>/dev/null; then',
      `    printf '%s S\\n' '${outside}'; : > "$here/clock-cut"; exit 0`,
      '  fi',
    ] : []),
    '  [ -f "$here/clock-cut" ] || { echo "ps: optional state read unavailable" >&2; exit 2; }',
    '  : > "$here/unexpected-read"; exit 2 ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));

  const { status, stderr, events } = await cleanedUpBy(CLOCKED_CALLER, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000, clockCut: 20_000 });

  assert.equal(status, 0, stderr);
  assert.equal(existsSync(join(directory, 'answered')), earlierAnswer, 'the prior-answer branch was not forced');
  assert.ok(existsSync(join(directory, 'clock-cut')), 'the read deadline was not cut');
  assert.ok(existsSync(join(directory, 'clock-jumps')), 'the synchronous read driver did not see the cut clock');
  assert.equal(existsSync(join(directory, 'unexpected-read')), false, 'a state read ran after LATE');
  assertUnended(directory, events, 'survivor.unended', earlierAnswer ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
}

/** A marked first exit-confirmation failure, with every process-table request and answer logged. */
function failingFirstConfirmation(directory, mode) {
  return fixture(directory, 'ps-first-fails', [
    'mode=' + mode,
    'args="$*"',
    'case "$args" in',
    '  "-g "*" -o pid=,stat=")',
    '    if [ "$mode" = F1 ]; then : > "$here/clock-cut"; fi ;;',
    '  "-g "*" -o pid=,stat=,xstat=")',
    '    : > "$here/first-read"',
    '    printf "READ %s\n" "$args" >> "$here/first-ps.log"',
    '    if [ "$mode" = F2 ]; then',
    '      : > "$here/clock-cut"',
    '      printf "FAIL 2 plain\n" >> "$here/first-ps.log"',
    '      echo "ps: first confirmation fails" >&2; exit 2',
    '    fi',
    '    if [ "$mode" = F3 ]; then',
    '      printf "HANG until ETIMEDOUT\n" >> "$here/first-ps.log"',
    '      exec /usr/bin/tail -f "$here/hold"',
    '    fi ;;',
    'esac',
    ("answer=$(" + shellQuote(PS) + " \"$@\")"),
    'printf "READ %s\n" "$args" >> "$here/first-ps.log"',
    'printf "%s\n" "$answer" | /usr/bin/sed "s/^/ROW /" >> "$here/first-ps.log"',
    'printf "%s\n" "$answer"',
  ].join('\n'));
}

/** Forces an F cell, then checks the failed first read, absent later read and complete event stream. */
async function firstConfirmationCell(t, mode) {
  const directory = holding(t);
  holdingTwo(directory);
  failingFirstConfirmation(directory, mode);
  const options = {
    ps: 'ps-first-fails', readTimeout: 2_000,
    ...(mode === 'F3' ? {} : { clockCut: 20_000, clockAfterDeadline: mode === 'F1', clockInEmptied: mode === 'F2' }),
  };
  const caller = mode === 'F3' ? CALLER : CLOCKED_CALLER;
  const { status, stderr, events } = await cleanedUpBy(caller, directory, options);
  const group = pidIn(directory, 'group');
  const members = [group, pidIn(directory, 'one'), pidIn(directory, 'two')];
  const pairs = linesOf(directory, 'pairs');
  const trace = read(directory, 'first-ps.log');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'clock-cut')) || mode === 'F3', 'the stand-in never armed the clock cut');
  if (mode !== 'F3') assert.ok(existsSync(join(directory, 'clock-jumps')), 'the caller clock never advanced');
  if (mode === 'F1') assert.equal(read(directory, 'clock-deadline'), 'D', 'the deadline was not established before the clock cut');
  assert.equal(existsSync(join(directory, 'first-read')), mode !== 'F1', 'the first confirmation read did not follow the forced path');
  const confirmations = trace.match(/READ -g \d+ -o pid=,stat=,xstat=/g) ?? [];
  assert.equal(confirmations.length, mode === 'F1' ? 0 : 1, 'a read followed the group kill');
  assert.ok(groupKills(pairs, group) > 0, 'the exit cleanup did not kill the group');
  t.diagnostic(JSON.stringify({ cell: mode, group, members, trace, mark: mode === 'F3' ? 'ETIMEDOUT' : read(directory, 'clock-jumps'), deadlineMark: mode === 'F1' ? read(directory, 'clock-deadline') : undefined, kills: pairs, events }));
  const groupEvents = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
  assert.equal(groupEvents.length, 1, 'the failed pre-kill read was not recorded once: ' + JSON.stringify(events));
  assert.match(groupEvents[0].census, /first read of the group before its kill failed/);
  for (const pid of members) {
    const records = events.filter((event) => event.pid === pid);
    assert.equal(records.length, 1, 'member ' + pid + ' was not recorded exactly once: ' + JSON.stringify(events));
    assert.match(records[0].event, /^survivor\.(killed|unended)$/);
    assert.ok(records[0].name && records[0].cmd, 'member ' + pid + ' was not recorded by name and command line');
  }
  assert.deepEqual(events.filter(({ pid }) => pid !== undefined && !members.includes(pid)), [], 'an unseen pid was recorded');
}

// proves R-STATE-12, R-STATE-19
test('F1: a late first confirmation read with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F1');
});

// proves R-STATE-12, R-STATE-19
test('F2: a plain first confirmation failure after the bound with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F2');
});

// proves R-STATE-12, R-STATE-19
test('F3: an unanswered first confirmation read with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F3');
});

// proves R-STATE-19, R-STATE-9
test('given a leader that answers signal 0 with EPERM until the next kill reaches it, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup does not record the leader as one it may not signal, nor as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hanging(directory);

  const { status, stderr, events } = await cleanedUpBy(SETTLING, directory, { ps: 'ps', hangAfter: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  const looks = existsSync(join(directory, 'looks')) ? read(directory, 'looks') : '';
  assert.match(looks, /E/, 'the cleanup never asked signal 0 of the leader, or it never answered EPERM, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === group);
  assert.deepEqual(recorded.map(({ event }) => event), ['survivor.unended'], JSON.stringify(recorded));
  assert.match(recorded[0].reason, /^not shown to have ended: /);
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', /the command was not shown to have ended/, JSON.stringify(ending));
});

/**
 * Stand-ins for `lsof` and `ps` that answer the census's reads of the outside process in `directory`
 * at once, so that no read it makes waits on the host. Each answer is what the real tool printed for
 * that process before the cleanup began: its listing as working in the dispatch's directory, its
 * name and its command line. Its state is read as stopped, `T`: the census reads states only of
 * processes it has stopped, and this one stays stopped until the census resumes it after its wait,
 * since its kill is not sent. `lsof` answers so until `$here/hang` exists, and from then on never
 * answers. `ps` answers the exit cleanup's reads of the command's group as well, which come before
 * the census, so that no real read of the group can run out its bound and leave the census's reads
 * refused. The group holds one process, the command, whose pid is the group's: read live, `S`, until
 * the caller has sent the group its kill, and from then on a zombie, `Z`, with `SIGKILL`'s wait
 * status, `9`, since the caller, exiting, does not reap it. Any other read fails, naming itself.
 * After the outside PID's named kill, its state stand-in reports a live answer before the next
 * directory listing and times out on the following state read. Those reads are marked separately.
 */
function answeringAtOnce(directory) {
  const pid = read(directory, 'outside.pid');
  const tool = (path, args) => spawnSync(path, args, { env: {}, encoding: 'utf8' }).stdout;
  writeFileSync(join(directory, 'listed'), tool(LSOF, ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-p', pid, '-F', 'pun']));
  writeFileSync(join(directory, 'ucomm'), tool(PS, ['-p', pid, '-o', 'ucomm=']));
  writeFileSync(join(directory, 'cmdline'), tool(PS, ['-ww', '-p', pid, '-o', 'pid=,command=']));
  fixture(directory, 'lsof', '[ -f "$here/hang" ] && { : > "$here/post-kill-listing"; exec /usr/bin/tail -f "$here/hold"; }\nexec /bin/cat "$here/listed"');
  fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'if [ -f "$here/hang" ] && [ "$*" = "-p $pid -o pid=,stat=" ]; then',
    '  [ -f "$here/post-kill-listing" ] && { : > "$here/post-kill-state-too-late"; exec /usr/bin/tail -f "$here/hold"; }',
    '  : > "$here/post-kill-live"; echo "$pid T"; exit 0',
    'fi',
    'case "$*" in',
    '  "-p $pid -o pid=,stat=") echo "$pid T"; exit 0 ;;',
    '  "-p $pid -o ucomm=") exec /bin/cat "$here/ucomm" ;;',
    '  "-ww -p $pid -o pid=,command=") exec /bin/cat "$here/cmdline" ;;',
    'esac',
    'for each; do case $last in -g|-p) group=$each ;; esac; last=$each; done',
    'state=S; status=0',
    '/usr/bin/grep -q "^\\[-$group,\\"SIGKILL\\"" "$here/pairs" 2>/dev/null && state=Z && status=9',
    'case $last in',
    '  pid=,stat=) echo "$group $state" ;;',
    '  pid=,stat=,xstat=) echo "$group $state $status" ;;',
    '  pid=,command=) echo "$group /bin/sh $here/command" ;;',
    '  ucomm=) echo sh ;;',
    '  *) echo "the ps stand-in has no answer for $*" >&2; exit 2 ;;',
    'esac',
  ].join('\n'));
}

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose listing after its kill takes the rest of its read bound, the exit cleanup still reads the process the kill does not end, and records it by name and command line as alive at the cleanup\'s own bound of that kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  answeringAtOnce(directory);
  assert.match(read(directory, 'listed'), new RegExp(`^n${realpathSync.native(work)}/sub$`, 'm'), 'lsof did not list the outside process as working in the dispatch\'s directory, so the test proves nothing');

  const { status, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', censusElapsed: 150 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the census never sent the outside process its kill, so the test proves nothing');
  assert.ok(events.some(({ event }) => event === 'directory.unread'), 'the census\'s listing after its kill answered within its read bound, so the test proves nothing');
  t.diagnostic(JSON.stringify({ postKillListing: existsSync(join(directory, 'post-kill-listing')), postKillLive: existsSync(join(directory, 'post-kill-live')), postKillStateTooLate: existsSync(join(directory, 'post-kill-state-too-late')), pairs, events, killed: killedIn(pairs, pidIn(directory, 'outside')), ended }));
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the post-kill directory listing did not consume the read bound');
  assert.ok(existsSync(join(directory, 'post-kill-live')), 'no state read showed the named outside process alive after its kill');
  assert.ok(existsSync(join(directory, 'post-kill-state-too-late')), 'the state read after the timed-out listing did not reach its synchronous timeout');
  assert.equal(read(directory, 'census-clock-cut'), 'C', 'the census read deadline was not cut before the named kill');
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /process-table read timed out/, 'the directory listing did not time out');
  // The census waits on what it killed until the cleanup's own bound has passed since that kill,
  // whatever its reads before took, and no longer.
  const killed = killedIn(pairs, pidIn(directory, 'outside'));
  assert.ok(ended - killed >= CLEANUP_BOUND, `the caller ended ${ended - killed} ms after the census's kill, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  assert.ok(ended - killed < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - killed} ms after the census's kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

/** Counts state reads under one lock and exposes only a complete published value. */
const stateCounter = [
  '  if [ -f "$here/first-inside" ]; then : > "$here/second-attempt"; fi',
  `  count=$(${process.platform === 'linux' ? '/usr/bin/flock -E 75' : '/usr/bin/lockf -k'} "$here/state-count.lock" /bin/sh -c 'count=$(/bin/cat "$1/state-count" 2>/dev/null || printf 0); count=$((count + 1)); if [ -f "$1/hold-first" ] && [ "$count" -eq 1 ]; then : > "$1/first-inside"; while [ ! -f "$1/release-first" ]; do :; done; fi; if [ -f "$1/counter-cut-request" ] && [ "$count" -eq 3 ]; then : > "$1/state-count.next"; : > "$1/counter-cut"; exec /usr/bin/tail -f "$1/hold"; fi; printf "%s\\n" "$count" > "$1/state-count.next" && /bin/mv -f "$1/state-count.next" "$1/state-count" || exit 1; printf "%s" "$count"' sh "$here") || exit 79`,
];

/** Drives one named outside PID through a chosen post-kill listing and two state-read answers. */
async function directoryReadCell(t, { listing, first, second, third, caller, clockCutAt, observe }) {
  const directory = holding(t);
  // A requested cut holds the third staged write so the final read must see the prior complete count.
  if (process.env.RIGGER_708_COUNTER_CUT === 'third') writeFileSync(join(directory, 'counter-cut-request'), '');
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  const listed = listingOf('outside', realpathSync.native(join(work, 'sub')));
  const after = {
    listed: `: > "$here/post-kill-listed"\n${listed}\nexit 0`,
    omitted: ': > "$here/post-kill-omitted"; exit 1',
    failed: ': > "$here/post-kill-failed"; echo "lsof: forced failure" >&2; exit 2',
    timeout: `${clockCutAt === 'listingTimeout' ? ': > "$here/clock-cut"; ' : ''}: > "$here/post-kill-timeout"; exec /usr/bin/tail -f "$here/hold"`,
  }[listing];
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then',
    '  : > "$here/post-kill-listing"',
    after,
    'fi',
    listed,
  ].join('\n'));
  const answer = (mode) => ({
    live: `: > "$here/state-live"; printf '%s T\\n' '${outside}'; exit 0`,
    zombie: `: > "$here/state-zombie"; printf '%s Z\\n' '${outside}'; exit 0`,
    gone: ': > "$here/state-gone"; exit 1',
    failed: ': > "$here/state-failed"; echo "ps: forced failure" >&2; exit 2',
  })[mode];
  const answerFor = (mode, cut) => {
    if (mode === 'timeout') return `${cut ? `: > "$here/clock-cut"; : > "$here/state-live"; printf '%s T\\n' '${outside}'; ` : ''}: > "$here/state-timeout"; exec /usr/bin/tail -f "$here/hold"`;
    const result = answer(mode);
    if (!cut) return result;
    assert.match(result, /exit [02]$/, `the ${mode} answer has no clock-cut boundary`);
    return result.replace(/exit ([02])$/, ': > "$here/clock-cut"; exit $1');
  };
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    ...stateCounter,
    `  if [ "$count" -eq 1 ]; then [ -f "$here/post-kill-listing" ] || : > "$here/state-before-listing"; ${answerFor(first, clockCutAt === 'first' || clockCutAt === 'firstTimeout')}; fi`,
    ...(third ? [`  if [ "$count" -eq 2 ]; then ${answerFor(second)}; fi`] : []),
    `  ${answerFor(third ?? second, clockCutAt === 'second' || clockCutAt === 'reaped' || clockCutAt === 'failed' || clockCutAt === 'thirdFailed')}`,
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const options = { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', ...(clockCutAt ? { clockCut: 20_000, clockAtListing: clockCutAt === 'listing', clockAtReaped: ['reaped', 'failed', 'thirdFailed'].includes(clockCutAt), clockBranch: clockCutAt === 'reaped' ? 'answered-live' : 'plain-failure', clockAtKill: clockCutAt === 'kill' } : {}) };
  try {
  const result = caller ? { ...await cleanedUpBy(caller, directory, options), pairs: linesOf(directory, 'pairs'), exiting: Number(read(directory, 'exiting')), ended: Date.now() } : await cleanedUp(directory, options);
  assert.equal(result.status, 0, result.stderr);
  if (process.env.RIGGER_708_COUNTER_CUT === 'third') assert.ok(existsSync(join(directory, 'counter-cut')), 'the third counter write was not interrupted');
  if (observe) {
    assert.ok(killedIn(result.pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
    return observe({ directory, outside, result, trace: linesOf(directory, 'control.trace.jsonl') });
  }
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the named kill was not followed by the chosen directory listing');
  assert.ok(existsSync(join(directory, `post-kill-${listing}`)), 'the post-kill listing did not force its chosen answer');
  assert.ok(killedIn(result.pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
  assert.ok(existsSync(join(directory, `state-${first}`)), 'the optional state read did not force its chosen answer');
  const reads = Number(read(directory, 'state-count'));
  if (first === 'zombie' || first === 'gone') {
    assert.ok(existsSync(join(directory, 'state-before-listing')), 'the ended state was not observed before the next directory listing');
    assert.equal(reads, 1, 'a process shown ended before the next listing was read again');
    assert.equal(existsSync(join(directory, `state-${second}`)), false, 'a state read followed the ended answer');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  } else if (second === 'live') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the second live answer was not reached');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } else if (second === 'failed') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the plain failed state read was not reached');
    assertUnended(directory, result.events, 'survivor.unended', first === 'live' ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
  } else {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.equal(reads, 2, 'the chosen ended-state answer was not the next read');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  }
  t.diagnostic(JSON.stringify({ cell: { listing, first, second }, pairs: result.pairs, events: result.events, stateReads: read(directory, 'state-count') }));
  return result.events;
  } finally {
    if (caller) t.diagnostic(JSON.stringify({ cell: { listing, first, second, third }, trace: linesOf(directory, 'control.trace.jsonl'), markers: { first: existsSync(join(directory, `state-${first}`)), listing: existsSync(join(directory, `post-kill-${listing}`)), reads: existsSync(join(directory, 'state-count')) ? read(directory, 'state-count') : null } }));
  }
}

/** Drives the named P1A and P3F post-kill reads with ordered boundary traces. */
async function postKillReadCell(t, { listing, first, second, postKillCut = false }) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const postKillTrace = postKillCut || (first === 'failed' && second === 'failed');
  holdingNone(directory);
  const listed = listingOf('outside', realpathSync.native(join(work, 'sub')));
  const after = {
    listed: `: > "$here/post-kill-listed"\n${listed}\nexit 0`,
    omitted: ': > "$here/post-kill-omitted"; exit 1',
    failed: ': > "$here/post-kill-failed"; echo "lsof: forced failure" >&2; exit 2',
  }[listing];
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then',
    '  : > "$here/post-kill-listing"',
    `  [ -f "$here/post-kill-trace" ] && printf '{"operation":"lsof-start","argv":"%s"}\\n' "$*" >> "$here/post-kill-trace"`,
    `  [ -f "$here/post-kill-trace" ] && printf '{"operation":"lsof-end","result":"${listing}"}\\n' >> "$here/post-kill-trace"`,
    ...(postKillCut && first === 'failed' && second === 'failed' ? ['  : > "$here/clock-cut"'] : []),
    after,
    'fi',
    listed,
  ].join('\n'));
  const answer = (mode) => ({
    live: `: > "$here/state-live"; printf '%s T\\n' '${outside}'; exit 0`,
    zombie: `: > "$here/state-zombie"; printf '%s Z\\n' '${outside}'; exit 0`,
    gone: ': > "$here/state-gone"; exit 1',
    failed: ': > "$here/state-failed"; echo "ps: forced failure" >&2; exit 2',
  })[mode];
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    ...stateCounter,
    '  [ -f "$here/post-kill-trace" ] && printf \'{"operation":"ps-start","argv":"%s","count":%s}\\n\' "$*" "$count" >> "$here/post-kill-trace"',
    `  if [ "$count" -eq 1 ]; then [ -f "$here/post-kill-listing" ] || : > "$here/state-before-listing"; [ -f "$here/post-kill-trace" ] && printf '{"operation":"ps-end","count":1,"result":"${first}"}\\n' >> "$here/post-kill-trace"; ${answer(first)}; fi`,
    `  [ -f "$here/post-kill-trace" ] && printf '{"operation":"ps-end","count":%s,"result":"${second}"}\\n' "$count" >> "$here/post-kill-trace"; ${postKillCut ? ': > "$here/clock-cut"; ' : ''}${answer(second)}`,
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const result = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', postKillCut, postKillTrace });
  if (postKillTrace) t.diagnostic(JSON.stringify({ runId: process.env.RIGGER_689_RUN_ID, trace: [...linesOf(directory, 'post-kill-trace'), { at: result.ended, operation: 'caller-end', status: result.status }], pairs: result.pairs, events: result.events, stateReads: existsSync(join(directory, 'state-count')) ? read(directory, 'state-count') : 'not reached', clockJumps: existsSync(join(directory, 'clock-jumps')), notReached: existsSync(join(directory, 'clock-jumps')) ? ['next ps: the read boundary reported LATE after the chosen later answer'] : [] }));
  assert.equal(result.status, 0, result.stderr);
  if (postKillCut) assert.ok(existsSync(join(directory, 'clock-jumps')), 'the reached live answer did not force a cut at the next read boundary');
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the named kill was not followed by the chosen directory listing');
  assert.ok(existsSync(join(directory, `post-kill-${listing}`)), 'the post-kill listing did not force its chosen answer');
  assert.ok(killedIn(result.pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
  assert.ok(existsSync(join(directory, `state-${first}`)), 'the optional state read did not force its chosen answer');
  const reads = Number(read(directory, 'state-count'));
  if (first === 'zombie' || first === 'gone') {
    assert.ok(existsSync(join(directory, 'state-before-listing')), 'the ended state was not observed before the next directory listing');
    assert.equal(reads, 1, 'a process shown ended before the next listing was read again');
    assert.equal(existsSync(join(directory, `state-${second}`)), false, 'a state read followed the ended answer');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  } else if (second === 'live') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the second live answer was not reached');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } else if (second === 'failed') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the plain failed state read was not reached');
    assertUnended(directory, result.events, 'survivor.unended', first === 'live' ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
  } else {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.equal(reads, 2, 'the chosen ended-state answer was not the next read');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  }
  t.diagnostic(JSON.stringify({ cell: { listing, first, second }, pairs: result.pairs, events: result.events, stateReads: read(directory, 'state-count') }));
  return result.events;
}

test('two concurrent state counter calls hold one lock and preserve both increments', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  writeFileSync(join(directory, 'hold-first'), '');
  const counter = fixture(directory, 'counter', [
    ...stateCounter,
  ].join('\n'));
  const first = spawn(counter, [], { stdio: 'ignore', env: {} });
  const firstExit = once(first, 'close');
  let secondExit;
  try {
    await until(() => existsSync(join(directory, 'first-inside')), t);
    const second = spawn(counter, [], { stdio: 'ignore', env: {} });
    secondExit = once(second, 'close');
    await until(() => existsSync(join(directory, 'second-attempt')), t);
    const lock = process.platform === 'linux' ? '/usr/bin/flock' : '/usr/bin/lockf';
    const flags = process.platform === 'linux' ? ['-E', '75', '-n'] : ['-s', '-t', '0', '-k'];
    const probe = spawnSync(lock, [...flags, join(directory, 'state-count.lock'), '/usr/bin/true'], { env: {} });
    assert.equal(probe.error, undefined, 'the lock probe could not run');
    assert.equal(probe.status, 75, 'the first increment did not hold the lock after the second call started');
  } finally {
    writeFileSync(join(directory, 'release-first'), '');
  }
  const exits = await Promise.all([firstExit, secondExit]);
  assert.deepEqual(exits, [[0, null], [0, null]], 'both overlapping counter calls must finish');
  assert.equal(read(directory, 'state-count'), '2', 'one overlapping state read lost its increment');
});

test('the failed-state read count still rejects a missing second state call', SETTLES_WITHIN, async (t) => {
  await assert.rejects(
    directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'failed', caller: TRACED_CALLER, clockCutAt: 'listing' }),
    /the plain failed state read was not reached/,
  );
});

test('the post-kill counter still rejects a missing second state call', SETTLES_WITHIN, async (t) => {
  await assert.rejects(
    postKillReadCell(t, { listing: 'omitted', first: 'failed', second: 'failed', postKillCut: true }),
    /the plain failed state read was not reached/,
  );
});

/** Successful live results returned by the named state stand-in, excluding timed-out partial output. */
const liveAnswersOf = (trace, directory, pid) => trace.filter(({ kind, tool, args, error, status, stdout }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${pid} -o pid=,stat=` && !error && status === 0 && stdout === `${pid} T\n`);

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, an answered listing still lists its PID and records no unread directory', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'listed', first: 'live', second: 'zombie' });
  assert.equal(events.some(({ event }) => event === 'directory.unread'), false);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, an answered listing omits its PID and records no unread directory', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'zombie' });
  assert.equal(events.some(({ event }) => event === 'directory.unread'), false);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, a plain failed listing records the unread directory before reaping', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'failed', first: 'live', second: 'zombie' });
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /lsof: forced failure/);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, a late listing records the unread directory before reaping', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', [
    '[ -f "$here/hang" ] && : > "$here/post-kill-listing"',
    listingOf('outside', realpathSync.native(join(work, 'sub'))),
  ].join('\n'));
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  : > "$here/post-kill-live"',
    '  : > "$here/clock-cut"',
    `  printf '%s T\\n' '${outside}'; exit 0`,
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const { status, stderr, events } = await cleanedUpBy(CLOCKED_CALLER, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', clockCut: 20_000 });
  const pairs = linesOf(directory, 'pairs');
  assert.equal(status, 0, stderr);
  assert.ok(killedIn(pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
  assert.ok(existsSync(join(directory, 'post-kill-live')), 'the state read did not show the named outside process alive after its kill');
  assert.equal(existsSync(join(directory, 'post-kill-listing')), false, 'the listing ran instead of receiving LATE before its read');
  assert.ok(existsSync(join(directory, 'clock-jumps')), 'the synchronous read driver did not reach LATE');
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  t.diagnostic(JSON.stringify({ cell: 'post-kill listing LATE', pairs, events }));
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a zombie answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'zombie' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a gone answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'gone' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a live answer persists until the directory read bound', SETTLES_WITHIN, async (t) => {
  await postKillReadCell(t, { listing: 'omitted', first: 'failed', second: 'live', postKillCut: true });
});

// proves R-STATE-19, R-STATE-9
test('a live answer survives a plain failure before a later no-start read cut', SETTLES_WITHIN, async (t) => {
  await plainFailureBoundaryCell(t, { retainedLive: true, terminal: 'late' });
});

// proves R-STATE-19, R-STATE-9
test('a live answer survives a plain failure before a later started read times out', SETTLES_WITHIN, async (t) => {
  await plainFailureBoundaryCell(t, { retainedLive: true, terminal: 'timeout' });
});

// proves R-STATE-19, R-STATE-9
test('plain failures without an answered state precede a distinct no-start read cut', SETTLES_WITHIN, async (t) => {
  await plainFailureBoundaryCell(t, { retainedLive: false, terminal: 'late' });
});

// proves R-STATE-19, R-STATE-9
test('plain failures without an answered state precede a distinct started read timeout', SETTLES_WITHIN, async (t) => {
  await plainFailureBoundaryCell(t, { retainedLive: false, terminal: 'timeout' });
});

/** Drives a plain failed post-kill read before a distinct cut, keeping the last returned answer. */
async function plainFailureBoundaryCell(t, { retainedLive, terminal }) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  const listed = listingOf('outside', realpathSync.native(join(work, 'sub')));
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then : > "$here/post-kill-omitted"; exit 1; fi',
    listed,
  ].join('\n'));
  const failed = 'echo "ps: forced failure" >&2; exit 2';
  const beforeTerminal = retainedLive ? 3 : 2;
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  count=$(/bin/cat "$here/state-count" 2>/dev/null || echo 0)',
    '  count=$((count + 1)); echo "$count" > "$here/state-count"',
    `  if [ "$count" -eq 1 ]; then ${failed}; fi`,
    ...(retainedLive ? [`  if [ "$count" -eq 2 ]; then printf '%s T\\n' '${outside}'; exit 0; fi`] : []),
    `  if [ "$count" -eq ${beforeTerminal} ]; then ${terminal === 'late' ? ': > "$here/clock-cut"; ' : ''}${failed}; fi`,
    '  : > "$here/state-timeout"; exec /usr/bin/tail -f "$here/hold"',
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const result = { ...await cleanedUpBy(TRACED_CALLER, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', ...(terminal === 'late' ? { clockCut: 20_000 } : {}) }), pairs: linesOf(directory, 'pairs'), ended: Date.now() };
  const trace = linesOf(directory, 'control.trace.jsonl');
  t.diagnostic(JSON.stringify({ cell: { retainedLive, terminal }, trace, events: result.events, pairs: result.pairs }));
  assert.equal(result.status, 0, result.stderr);
  const killed = trace.find(({ kind, target, name }) => kind === 'signal-start' && target === outside && name === 'SIGKILL')?.sequence;
  assert.ok(killed, 'the named outside PID was not sent its kill');
  const selected = trace.filter(({ sequence, tool, args }) => sequence > killed && tool === join(directory, 'ps') && args?.join(' ') === `-p ${outside} -o pid=,stat=`);
  const ended = selected.filter(({ kind }) => kind === 'read-end');
  const listing = trace.find(({ sequence, kind, tool, status, markers }) => sequence > killed && kind === 'read-end' && tool === join(directory, 'lsof') && status === 1 && markers?.listingOmitted);
  assert.ok(listing, 'the named directory listing did not return omission');
  assert.ok(ended[0]?.sequence < listing.sequence, 'the first failed state read did not precede the omitted listing');
  const expected = retainedLive ? [[2, '', 'ps: forced failure\n'], [0, `${outside} T\n`, ''], [2, '', 'ps: forced failure\n']] : [[2, '', 'ps: forced failure\n'], [2, '', 'ps: forced failure\n']];
  assert.deepEqual(ended.slice(0, expected.length).map(({ status, stdout, stderr }) => [status, stdout, stderr]), expected);
  assert.ok(ended[1]?.sequence > listing.sequence, 'the later read did not follow the omitted listing');
  const failure = ended.at(expected.length - 1);
  assert.ok(failure, 'the before-bound plain failure did not return');
  const started = selected.find(({ sequence, kind }) => sequence === failure.sequence - 1 && kind === 'read-start');
  assert.ok(started?.remaining > 0, 'the plain failed read did not start before the bound');
  assert.ok(trace.some(({ sequence, kind, target, name, answer }) => sequence > failure.sequence && kind === 'signal-answer' && target === outside && name === 0 && answer === true), 'the named PID did not continue answering signal 0');
  if (terminal === 'late') {
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > failure.sequence && kind === 'read-cut' && code === 'LATE'), 'a later state read was not cut before start');
    assert.equal(selected.some(({ sequence, kind }) => sequence > failure.sequence && kind === 'read-start'), false, 'a state read started after the pre-start cut');
  } else {
    const timeout = selected.find(({ sequence, kind, error }) => sequence > failure.sequence && kind === 'read-end' && error === 'ETIMEDOUT');
    assert.ok(timeout, 'the later started read did not time out');
    assert.ok(selected.some(({ sequence, kind, remaining }) => sequence > failure.sequence && sequence < timeout.sequence && kind === 'read-start' && remaining > 0), 'the timed-out read did not start inside the bound');
    assert.equal(timeout.stdout, '', 'a timed-out partial output was counted as an answer');
  }
  assert.equal(ended.filter(({ status, stdout }) => status === 0 && stdout === `${outside} T\n`).length, retainedLive ? 1 : 0, 'the plain failure replaced or fabricated a live answer');
  assertUnended(directory, result.events, 'survivor.unended', retainedLive ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
}

/** Drives an omitted post-kill listing into a chosen later-read boundary. */
async function postKillBoundaryCell(t, mode) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  const listed = listingOf('outside', realpathSync.native(join(work, 'sub')));
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then',
    '  [ -f "$here/post-kill-trace" ] && printf \'{"operation":"lsof-start","argv":"%s"}\\n\' "$*" >> "$here/post-kill-trace"',
    '  [ -f "$here/post-kill-trace" ] && printf \'{"operation":"lsof-end","result":"omitted"}\\n\' >> "$here/post-kill-trace"',
    `  : > "$here/post-kill-listing"; ${mode === 'before-later' ? ': > "$here/clock-cut"; ' : ''}exit 1`,
    'fi',
    listed,
  ].join('\n'));
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  [ -f "$here/post-kill-trace" ] && printf \'{"operation":"ps-start","argv":"%s","phase":"%s"}\\n\' "$*" "$([ -f "$here/first-state" ] && echo later || echo first)" >> "$here/post-kill-trace"',
    '  if [ ! -f "$here/first-state" ]; then',
    '    [ -f "$here/post-kill-trace" ] && printf \'{"operation":"ps-end","result":"failed"}\\n\' >> "$here/post-kill-trace"',
    '    : > "$here/first-state"; echo "ps: forced failure" >&2; exit 2',
    '  fi',
    `  : > "$here/${mode === 'before-later' ? 'unexpected-state' : 'later-state'}"`,
    ...(mode === 'timeout' ? [] : ['  [ -f "$here/post-kill-trace" ] && printf \'{"operation":"ps-end","result":"live"}\\n\' >> "$here/post-kill-trace"']),
    ...(mode === 'timeout' ? ['  : > "$here/timed-out-state"; exec /usr/bin/tail -f "$here/hold"'] : [`  ${mode === 'terminal-live' ? ': > "$here/clock-cut"; ' : ''}printf '%s T\\n' '${outside}'; exit 0`]),
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const { status, stderr, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', postKillCut: mode === 'before-later', postKillTerminal: mode === 'terminal-live' || mode === 'timeout', postKillTrace: true });
  t.diagnostic(JSON.stringify({ runId: process.env.RIGGER_689_RUN_ID, mode, trace: [...linesOf(directory, 'post-kill-trace'), { at: ended, operation: 'caller-end', status }], pairs, events, outsideState: processState(outside), outsideAnswersSignal0: alive(outside), terminalClockSeen: existsSync(join(directory, 'clock-terminal')), notReached: [!existsSync(join(directory, 'later-state')) && !existsSync(join(directory, 'unexpected-state')) ? 'later ps: deadline before read' : undefined, mode === 'timeout' ? 'later ps answer: command timed out' : undefined].filter(Boolean) }));
  assert.equal(status, 0, stderr);
  assert.ok(killedIn(pairs, outside) !== undefined, 'the named outside PID was not killed');
  assert.ok(existsSync(join(directory, 'first-state')), 'the first post-kill state read did not fail');
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the omitted listing was not read');
  if (mode === 'before-later') {
    assert.ok(existsSync(join(directory, 'clock-jumps')), 'the next read boundary did not see the spent bound');
    assert.equal(existsSync(join(directory, 'unexpected-state')), false, 'a later state read started after the bound');
  } else {
    assert.ok(existsSync(join(directory, 'later-state')), 'the later state read did not start');
  }
  if (mode === 'terminal-live') assert.ok(existsSync(join(directory, 'clock-terminal')), 'the answered live read was not evaluated at the wait bound');
  if (mode === 'timeout') assert.ok(existsSync(join(directory, 'timed-out-state')), 'the later state read did not reach its timed-out command');
  assertUnended(directory, events, 'survivor.unended', mode === 'terminal-live' ? `still alive ${CLEANUP_BOUND} ms after L0's kill` : 'not shown to have ended: the process table could not be read');
}

// proves R-STATE-19, R-STATE-9
test('after a failed post-kill state read and omitted listing, a spent bound starts no later state read', SETTLES_WITHIN, async (t) => {
  await postKillBoundaryCell(t, 'before-later');
});

// proves R-STATE-19, R-STATE-9
test('after a failed post-kill state read and omitted listing, a live answer evaluated at the bound records the answered-live reason', SETTLES_WITHIN, async (t) => {
  await postKillBoundaryCell(t, 'terminal-live');
});

// proves R-STATE-19, R-STATE-9
test('after a failed post-kill state read and omitted listing, a timed-out later read records no answered state', SETTLES_WITHIN, async (t) => {
  await postKillBoundaryCell(t, 'timeout');
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, a zombie answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'zombie' });
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, a gone answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'gone' });
});

// proves R-STATE-19, R-STATE-9
test('a live post-kill answer remains live until the directory read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER });
});

// proves R-STATE-19, R-STATE-9
test('two answered live post-kill reads remain live through a cut later read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'second', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2', 'the second live answer was not reached');
    assert.ok(existsSync(join(directory, 'clock-jumps')), 'the read driver did not cut the later read');
    assert.ok(trace.some(({ kind, code }) => kind === 'read-cut' && code === 'LATE'), 'the later read was not cut at LATE');
    const answered = liveAnswersOf(trace, directory, outside);
    assert.equal(answered.length, 2, JSON.stringify(trace));
    assert.ok(trace.some(({ kind, target, name, answer }) => kind === 'signal-answer' && target === outside && name === 0 && answer === true), 'the named PID did not continue answering signal 0');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('an answered later live read evaluated at the wait bound records live at that bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'reaped', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2);
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'answered-live'));
    assertUnended(directory, result.events, 'survivor.unended', 'still alive 1000 ms after L0\'s kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a bound spent by the omitted listing starts no later state read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'listing', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '1');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(existsSync(join(directory, 'clock-jumps')));
    assert.ok(trace.some(({ kind, code }) => kind === 'read-cut' && code === 'LATE'));
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the read');
    assert.equal(trace.filter(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`).length, 1);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a later state read timed out after the first live answer records live at the read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'timeout', caller: TRACED_CALLER, observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(trace.some(({ kind, tool, args, error }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && error === 'ETIMEDOUT'));
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a plain failed post-kill listing still permits a later live state answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'failed', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'second', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.ok(existsSync(join(directory, 'post-kill-failed')), 'the listing did not mark its plain failure');
    const listingStart = trace.find(({ kind, tool, markers }) => kind === 'read-start' && tool === join(directory, 'lsof') && markers?.stateLive && !markers?.listingFailed)?.sequence;
    const listingEnd = trace.find(({ sequence, kind, tool, status, stderr, markers }) => sequence > listingStart && kind === 'read-end' && tool === join(directory, 'lsof') && status === 2 && stderr === 'lsof: forced failure\n' && markers?.listingFailed)?.sequence;
    assert.ok(listingStart && listingEnd, 'the listing did not start, mark, then return its plain failure');
    assert.ok(trace.some(({ sequence, kind, tool, args, status, stdout }) => sequence > listingEnd && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && status === 0 && stdout === `${outside} T\n`), 'the later live state answer did not follow the failed listing');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /lsof: forced failure/);
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a cut post-kill listing has no returned omission answer or later state read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'first', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '1');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.equal(existsSync(join(directory, 'post-kill-listing')), false);
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the cut');
    assert.equal(trace.some(({ sequence, kind, tool }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'lsof')), false, 'a listing began before the cut');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a timed-out post-kill listing returns no omission answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'timeout', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'listingTimeout', observe: ({ directory, outside, result, trace }) => {
    assert.ok(existsSync(join(directory, 'post-kill-timeout')));
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'a live result reached L0 after the listing timed out');
    const listingStart = trace.find(({ kind, tool, markers }) => kind === 'read-start' && tool === join(directory, 'lsof') && markers?.stateLive && !markers?.listingTimeout)?.sequence;
    const listingEnd = trace.find(({ sequence, kind, tool, error, stdout, markers }) => sequence > listingStart && kind === 'read-end' && tool === join(directory, 'lsof') && error === 'ETIMEDOUT' && stdout === '' && markers?.listingTimeout)?.sequence;
    assert.ok(listingStart && listingEnd, 'the listing did not start, mark its timeout, then return ETIMEDOUT without an answer');
    assert.equal(existsSync(join(directory, 'post-kill-omitted')), false, 'the listing emitted an omission answer');
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > listingEnd && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false, 'a later state read started after the listing timeout');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > listingEnd && kind === 'read-cut' && code === 'LATE'), 'the later state read was not cut at the bound');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /timed out/);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a timed-out first post-kill state operation supplies no live answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'timeout', second: 'live', caller: TRACED_CALLER, clockCutAt: 'firstTimeout', observe: ({ directory, outside, result, trace }) => {
    assert.ok(existsSync(join(directory, 'state-timeout')));
    assert.ok(existsSync(join(directory, 'state-live')), 'the first state operation did not mark its live partial output');
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the first state read');
    const firstStart = trace.find(({ sequence, kind, tool, args, markers }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && !markers?.stateLive)?.sequence;
    const firstEnd = trace.find(({ sequence, kind, tool, args, error, stdout, markers }) => sequence > firstStart && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && error === 'ETIMEDOUT' && stdout === `${outside} T\n` && markers?.stateLive && markers?.stateTimeout)?.sequence;
    assert.ok(firstStart && firstEnd, 'the first state read did not start, mark and print live, then return ETIMEDOUT without an answer');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 0, 'a live result reached L0 despite the timed-out first and later reads');
    assert.equal(trace.some(({ sequence, kind, tool }) => sequence > firstEnd && kind === 'read-start' && tool === join(directory, 'lsof')), false, 'a listing started after the first state timeout');
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > firstEnd && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false, 'a later state read started after the first timeout');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > firstEnd && kind === 'read-cut' && code === 'LATE'), 'the wait did not cut a later state read');
    assert.equal(existsSync(join(directory, 'post-kill-omitted')), false, 'the listing answered despite the spent census bound');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a cut before the first post-kill state operation starts supplies no live marker', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'kill', observe: ({ directory, outside, result, trace }) => {
    assert.ok(trace.some(({ kind, boundary }) => kind === 'clock-armed' && boundary === 'first-state'));
    assert.equal(existsSync(join(directory, 'state-count')), false);
    assert.equal(existsSync(join(directory, 'state-live')), false);
    assert.equal(liveAnswersOf(trace, directory, outside).length, 0);
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed);
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false);
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('plain failed later reads evaluated at the wait bound record an unread process table', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'failed', caller: TRACED_CALLER, clockCutAt: 'failed', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'plain-failure'));
    assert.ok(trace.some(({ kind, tool, args, stderr }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && stderr?.includes('ps: forced failure')));
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a second live answer followed by plain failed reads records an unread process table at the bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', third: 'failed', caller: TRACED_CALLER, clockCutAt: 'thirdFailed', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '3');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2, 'the second live result did not reach L0');
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed);
    const stateReads = trace.filter(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`);
    assert.deepEqual(stateReads.map(({ status, stdout, stderr, error }) => [status, stdout, stderr, error ?? null]), [[0, `${outside} T\n`, '', null], [0, `${outside} T\n`, '', null], [2, '', 'ps: forced failure\n', null]]);
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'plain-failure'));
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
});

/** Drives the named PID through returned first-live, omitted-listing, and selected later reads. */
async function firstLiveReadCell(t, { steps, cutAfter, boundBranch, observe }) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then : > "$here/post-kill-listing"; : > "$here/post-kill-omitted"; exit 1; fi',
    listingOf('outside', realpathSync.native(join(work, 'sub'))),
  ].join('\n'));
  const answer = (mode, number) => {
    const marker = `: > "$here/state-${number}-${mode}"; `;
    const cut = cutAfter === number ? ': > "$here/clock-cut"; ' : '';
    if (mode === 'live') return `${marker}printf '%s T\\n' '${outside}'; ${cut}exit 0`;
    if (mode === 'failed') return `${marker}echo 'ps: forced failure' >&2; ${cut}exit 2`;
    assert.equal(mode, 'timeout');
    return `${marker}exec /usr/bin/tail -f "$here/hold"`;
  };
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  count=$(/bin/cat "$here/state-count" 2>/dev/null || echo 0)',
    '  count=$((count + 1)); echo "$count" > "$here/state-count"',
    '  case "$count" in',
    ...steps.map((mode, index) => `    ${index + 1}) ${answer(mode, index + 1)} ;;`),
    '    *) echo "unexpected named state read $count" >&2; exit 2 ;;',
    '  esac',
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const options = { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside',
    ...(cutAfter ? { clockCut: 20_000, clockAtReaped: Boolean(boundBranch), clockBranch: boundBranch } : {}) };
  try {
    const result = await cleanedUpBy(TRACED_CALLER, directory, options);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(killedIn(linesOf(directory, 'pairs'), outside) !== undefined, 'the named kill did not occur');
    const trace = linesOf(directory, 'control.trace.jsonl');
    return observe({ directory, outside, result, trace });
  } finally {
    t.diagnostic(JSON.stringify({ cell: { steps, cutAfter, boundBranch },
      trace: existsSync(join(directory, 'control.trace.jsonl')) ? linesOf(directory, 'control.trace.jsonl') : null,
      markers: { reads: existsSync(join(directory, 'state-count')) ? read(directory, 'state-count') : null,
        listing: existsSync(join(directory, 'post-kill-omitted')) } }));
  }
}

/** Verifies returned first live, answered omission, later failure and returned live in source order. */
function firstLiveFailedThenLive({ directory, outside, trace }) {
  const killed = trace.find(({ kind, target, name, answer }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL' && answer === true)?.sequence;
  assert.ok(killed, 'the named kill was not observed');
  const stateRead = ({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`;
  const reads = trace.filter(stateRead);
  assert.ok(reads.length >= 3, 'the required three returned-result operations were not reached');
  assert.deepEqual(reads.slice(0, 3).map(({ status, stdout, stderr, error, markers }) => [status, stdout, stderr, error ?? null, markers?.stateCount]), [
    [0, `${outside} T\n`, '', null, 1],
    [2, '', 'ps: forced failure\n', null, 2],
    [0, `${outside} T\n`, '', null, 3],
  ]);
  assert.ok(existsSync(join(directory, 'state-1-live')) && existsSync(join(directory, 'state-2-failed')) && existsSync(join(directory, 'state-3-live')), 'the selected state markers were not written');
  const listing = trace.find(({ sequence, kind, tool, status, stdout, stderr, markers }) => sequence > reads[0].sequence && sequence < reads[1].sequence && kind === 'read-end' && tool === join(directory, 'lsof') && status === 1 && stdout === '' && stderr === '' && markers?.listingOmitted);
  assert.ok(listing, 'the omitted listing did not return between first live and later failure');
  const starts = trace.filter(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`);
  assert.ok(starts.length >= 3 && starts.every(({ remaining }) => Number.isFinite(remaining) && remaining > 0), 'a named post-kill read did not start within its bound');
  assert.ok(trace.some(({ sequence, kind, target, name, answer }) => sequence > reads[1].sequence && sequence < reads[2].sequence && kind === 'signal-answer' && target === outside && name === 0 && answer === true), 'the named PID did not continue answering signal 0 between the failed and returned live reads');
  const terminal = trace.find(({ sequence, kind, event, pid }) => sequence > reads[2].sequence && kind === 'event' && event === 'survivor.unended' && pid === outside)?.sequence;
  assert.ok(terminal && trace.some(({ sequence, kind }) => sequence > terminal && kind === 'caller-end'), 'the terminal event and caller end were not ordered');
  return { reads, starts };
}

/** Returns each later named operation's result, keeping timeout separate from a returned answer. */
const namedOutcomes = (reads) => reads.map(({ status, stdout, stderr, error }) => [status, stdout, stderr, error ?? null]);

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing retain a later failed then live answer through a no-start cut', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live'], cutAfter: 3, observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '3');
    assert.equal(reads.length, 3);
    assert.equal(starts.length, 3, 'the cut read started');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > reads[2].sequence && kind === 'read-cut' && code === 'LATE'), 'the later read was not cut before start');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing retain a later failed then live answer through a started timeout', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live', 'timeout'], observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '4');
    assert.ok(existsSync(join(directory, 'state-4-timeout')), 'the later timeout did not mark');
    assert.deepEqual(namedOutcomes(reads.slice(3)), [[null, '', '', 'ETIMEDOUT']]);
    assert.equal(starts.length, 4);
    assert.ok(starts[3].sequence > reads[2].sequence && starts[3].sequence < reads[3].sequence, 'the timed-out read did not start after the returned live answer');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing evaluate the later failed then live sequence at the wait bound', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live'], cutAfter: 3, boundBranch: 'answered-live', observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '3');
    assert.equal(reads.length, 3);
    assert.equal(starts.length, 3);
    assert.ok(trace.some(({ sequence, kind, branch, elapsed }) => sequence > reads[2].sequence && kind === 'bound-evaluated' && branch === 'answered-live' && elapsed >= UNREAPED_BOUND), 'the returned live answer was not evaluated at the existing wait bound');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive 1000 ms after L0\'s kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing record a later failure live failure sequence at the wait bound', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live', 'failed'], cutAfter: 4, boundBranch: 'plain-failure', observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '4');
    assert.ok(existsSync(join(directory, 'state-4-failed')), 'the terminal plain failure did not mark');
    assert.deepEqual(namedOutcomes(reads.slice(3)), [[2, '', 'ps: forced failure\n', null]]);
    assert.equal(starts.length, 4);
    assert.ok(trace.some(({ sequence, kind, branch, elapsed }) => sequence > reads[3].sequence && kind === 'bound-evaluated' && branch === 'plain-failure' && elapsed >= UNREAPED_BOUND), 'the terminal failure was not evaluated at the existing wait bound');
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing retain the later live answer across another failure and a no-start cut', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live', 'failed'], cutAfter: 4, observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '4');
    assert.ok(existsSync(join(directory, 'state-4-failed')), 'the further plain failure did not mark');
    assert.deepEqual(namedOutcomes(reads.slice(3)), [[2, '', 'ps: forced failure\n', null]]);
    assert.equal(starts.length, 4, 'the cut read started');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > reads[3].sequence && kind === 'read-cut' && code === 'LATE'), 'the next read was not cut before start');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a first live answer and omitted listing retain the later live answer across another failure and a started timeout', SETTLES_WITHIN, async (t) => {
  await firstLiveReadCell(t, { steps: ['live', 'failed', 'live', 'failed', 'timeout'], observe: ({ directory, outside, result, trace }) => {
    const { reads, starts } = firstLiveFailedThenLive({ directory, outside, trace });
    assert.equal(read(directory, 'state-count'), '5');
    assert.ok(existsSync(join(directory, 'state-4-failed')) && existsSync(join(directory, 'state-5-timeout')), 'the further failure and timeout did not mark separately');
    assert.deepEqual(namedOutcomes(reads.slice(3)), [[2, '', 'ps: forced failure\n', null], [null, '', '', 'ETIMEDOUT']]);
    assert.equal(starts.length, 5);
    assert.ok(starts[4].sequence > reads[3].sequence && starts[4].sequence < reads[4].sequence, 'the timed-out read did not start after the further failure');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

/** Proves a started plain failure reaches the terminal bound after the chosen answer history. */
async function plainTerminalBoundaryCell(t, retainedLive) {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: retainedLive ? 'live' : 'failed', ...(retainedLive ? { third: 'failed' } : {}), caller: TRACED_CALLER, clockCutAt: retainedLive ? 'thirdFailed' : 'failed', observe: ({ directory, outside, result, trace }) => {
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-start' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named outside PID was not sent its kill');
    const selected = trace.filter(({ sequence, tool, args }) => sequence > killed && tool === join(directory, 'ps') && args?.join(' ') === `-p ${outside} -o pid=,stat=`);
    const ended = selected.filter(({ kind }) => kind === 'read-end');
    const expected = retainedLive ? [[2, '', 'ps: forced failure\n'], [0, `${outside} T\n`, ''], [2, '', 'ps: forced failure\n']] : [[2, '', 'ps: forced failure\n'], [2, '', 'ps: forced failure\n']];
    assert.deepEqual(ended.map(({ status, stdout, stderr }) => [status, stdout, stderr]), expected);
    const listing = trace.find(({ sequence, kind, tool, status, markers }) => sequence > ended[0].sequence && kind === 'read-end' && tool === join(directory, 'lsof') && status === 1 && markers?.listingOmitted);
    assert.ok(listing && listing.sequence < ended[1].sequence, 'the named omission did not precede the later state reads');
    const failure = ended.at(-1);
    assert.ok(selected.some(({ sequence, kind, remaining }) => sequence < failure.sequence && kind === 'read-start' && remaining > 0 && sequence === failure.sequence - 1), 'the terminal plain failure did not start within the read bound');
    assert.ok(trace.some(({ sequence, kind, branch }) => sequence > failure.sequence && kind === 'bound-evaluated' && branch === 'plain-failure'), 'the plain failure was not evaluated at the terminal bound');
    assert.equal(trace.some(({ sequence, kind }) => sequence > failure.sequence && kind === 'read-cut'), false, 'the terminal plain failure was mislabeled as a cut');
    assert.ok(trace.some(({ sequence, kind, target, name, answer }) => sequence > ended.at(-2).sequence && sequence < failure.sequence && kind === 'signal-answer' && target === outside && name === 0 && answer === true), 'the named PID did not answer signal 0 before terminal evaluation');
    assert.equal(alive(outside), true, 'the named PID ended before the terminal claim');
    assert.equal(ended.filter(({ status, stdout }) => status === 0 && stdout === `${outside} T\n`).length, retainedLive ? 1 : 0);
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
}

// proves R-STATE-19, R-STATE-9
test('a returned later live answer precedes a terminal plain state-read failure', SETTLES_WITHIN, async (t) => {
  await plainTerminalBoundaryCell(t, true);
});

// proves R-STATE-19, R-STATE-9
test('a never-answered state remains unread after a terminal plain state-read failure', SETTLES_WITHIN, async (t) => {
  await plainTerminalBoundaryCell(t, false);
});

// proves R-STATE-19, R-STATE-9
test('a zombie seen immediately after the named kill is not read again after the next listing', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'zombie', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('a PID gone immediately after the named kill is not read again after the next listing', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'gone', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, plain state-read failures retry until the read bound', SETTLES_WITHIN, async (t) => {
  await postKillReadCell(t, { listing: 'omitted', first: 'failed', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, plain state-read failures retry until the read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'failed' });
});

/** Shows a failed group census can still reach and name the outside directory process. */
async function groupReadCell(t, mode) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*" -o pid=,stat=")',
    '  if [ ! -f "$here/group-first" ]; then',
    '    : > "$here/group-first"',
    ...(mode === 'failed' ? ['    echo "ps: forced group failure" >&2; exit 2'] : ['    : > "$here/group-clock-cut"']),
    '  fi ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const caller = mode === 'late' ? GROUP_LATE_CALLER : CALLER;
  const { status, stderr, events } = await cleanedUpBy(caller, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside' });
  const pairs = linesOf(directory, 'pairs');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'group-first')), 'the group census did not reach its forced read');
  if (mode === 'late') assert.ok(existsSync(join(directory, 'group-clock-jump')), 'the group read driver did not reach LATE');
  assert.ok(killedIn(pairs, outside) !== undefined, 'the later directory sweep did not kill the named outside PID');
  assert.ok(events.some(({ pid, name, cmd }) => pid === outside && name === 'tail' && cmd === tailOf(directory).cmd), 'the later directory record did not name the outside PID');
  t.diagnostic(JSON.stringify({ cell: `group.${mode}`, pairs, events }));
  return events;
}

// proves R-STATE-19, R-STATE-9
test('a plain failed group census still reaches the named outside directory process', SETTLES_WITHIN, async (t) => {
  const events = await groupReadCell(t, 'failed');
  assert.ok(events.some(({ event, census }) => event === 'group.killed' && /ps: forced group failure/.test(census ?? '')));
});

// proves R-STATE-19, R-STATE-9
test('a late group census still reaches the named outside directory process', SETTLES_WITHIN, async (t) => {
  const events = await groupReadCell(t, 'late');
  assert.ok(events.some(({ event, census }) => event === 'group.killed' && /did not finish within/.test(census ?? '')));
});

// proves R-STATE-12, R-STATE-19
test('given a member that answers signal 0 with EPERM once, as it is being killed, the call records it as killed, not as a process it could not end', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { flickers: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.ok(signals.pairs.filter(([target, name]) => target === one && name === 0).length > 0, 'the call never asked signal 0 of the flickering member, so the test proves nothing');
  assert.deepEqual([one, two].map(alive), [false, false]);
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })).sort((a, b) => a.pid - b.pid), [
    { event: 'survivor.killed', pid: one },
    { event: 'survivor.killed', pid: two },
  ].sort((a, b) => a.pid - b.pid));
});

// proves R-STATE-9, R-STATE-15, R-STATE-19
test('given a command whose leader answers signal 0 with EPERM once, as the exit cleanup kills it, the cleanup hands its step the killed command\'s exit code and records no process it could not end', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, pairs } = await cleanedUp(directory, { flickers: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.ok(pairs.filter(([target, name]) => target === group && name === 0).length > 0, 'the cleanup never asked signal 0 of the leader, so the test proves nothing');
  assert.deepEqual(JSON.parse(read(directory, 'ending')), { exit: 128 + constants.signals.SIGKILL });
  assert.deepEqual(events.filter(({ event }) => event.endsWith('.unended')), []);
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

/**
 * Has the exit cleanup end a group whose leader is `kept`, as `CALLER` names its options, and
 * asserts the cleanup hands its step no exit code, but that it could not end the command, for
 * `why`, and records the leader as a process it could not end.
 */
async function assertLeaderUnended(t, kept, why) {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events } = await cleanedUp(directory, { [kept]: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', /could not end the command/, JSON.stringify(ending));
  assert.match(ending.unread, why, JSON.stringify(ending));
  assert.deepEqual(events.filter(({ pid }) => pid === group).map(({ event }) => event), ['survivor.unended']);
}

// proves R-STATE-9, R-STATE-19
test('given a command whose leader the kill does not end, the exit cleanup hands its step no exit code, but that it could not end the command', SETTLES_WITHIN, async (t) => {
  await assertLeaderUnended(t, 'unkept', /still alive when the exit cleanup's read bound/);
});

// proves R-STATE-9, R-STATE-19
test('given a command whose leader L0 may not signal, the exit cleanup hands its step no exit code, but that it could not end the command because of EPERM', SETTLES_WITHIN, async (t) => {
  await assertLeaderUnended(t, 'refused', /EPERM/);
});

/**
 * A perl program in `directory`, `joiner`, run with the scratch directory and a group's id: it
 * leaves its own group and forks a child that joins the group named and runs `tail`, writes that
 * child's pid to `$here/two.pid` once it has joined, and then blocks for good without ever reaping
 * it. So once the child is killed it stays a zombie in that group while the program lives. The
 * program names the scratch directory in its command line, so its test's teardown ends it.
 */
function zombieJoiner(directory) {
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'joiner'), [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork() // die "fork: $!";',
    'if ($child == 0) { setpgrp(0, $group) or die "join: $!"; exec "/usr/bin/tail", "-f", "$here/hold"; }',
    '1 until `/bin/ps -o pgid=,ucomm= -p $child` =~ /^\\s*$group\\s+tail/;',
    'open(my $f, ">", "$here/two.tmp") or die; print $f $child; close $f;',
    'rename("$here/two.tmp", "$here/two.pid") or die;',
    'select(undef, undef, undef, undef);',
  ].join('\n'));
  return join(directory, 'joiner');
}

/** Lines of a command that start `zombieJoiner`'s program for the command's own group, and wait until its child has joined. */
const joining = (directory) => [
  `/usr/bin/perl "${zombieJoiner(directory)}" "$here" $$ >/dev/null 2>&1 &`,
  'while [ ! -f "$here/two.pid" ]; do :; done',
].join('\n');

/** Asserts `events` record the kill of the group for the joiner, saying a read after the kill found it exited. */
function assertJoinerRecorded(events) {
  const kills = events.filter(({ event }) => event === 'group.killed');
  assert.equal(kills.length, 1, `the group's kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(kills[0].census, /a read after the kill found/);
}

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assert.deepEqual(events.filter(({ pid }) => pid !== undefined).map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: pidIn(directory, 'one') }]);
  assertJoinerRecorded(events);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assertJoinerRecorded(events);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assertJoinerRecorded(events);
});

/** A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on fails each as `ps` fails. */
const failingAfterKill = (directory) => fixture(directory, 'ps', ("[ -f \"$here/hang\" ] && { echo \"ps: failing on purpose\" >&2; exit 2; }\nexec " + shellQuote(PS) + " \"$@\""));

/** Asserts `events` record the kill of the group in place of what reads after the kill could not list. */
function assertUnreadAfterKill(events) {
  const kills = events.filter(({ event }) => event === 'group.killed');
  assert.equal(kills.length, 1, `the group's kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(kills[0].census, /after its kill failed/);
  assert.match(kills[0].census, /ps: failing on purpose/);
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.ok(processState(pidIn(directory, 'two')).startsWith('Z'), 'the group did not stay occupied after the kill, so no read after it was made and the test proves nothing');
  assertUnreadAfterKill(events);
});

// proves R-STATE-19, R-STATE-10
test('on a start\'s kill of a recorded group, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.ok(processState(pidIn(directory, 'two')).startsWith('Z'), 'the group did not stay occupied after the kill, so no read after it was made and the test proves nothing');
  assertUnreadAfterKill(events);
});

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  failingAfterKill(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  assert.equal(status, 0);
  assertUnreadAfterKill(events);
});

/**
 * A command that writes its pid, its group's id, to `$here/group.pid`, leaves a `tail` in its group,
 * `one`, starts `zombieJoiner`'s program for its group, whose child joins it as `two`, marks
 * `$here/up`, and runs until the test writes `release`, or until killed.
 */
const joinedLate = (directory) => fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));

/** Each event in `events` for the process `pid`, by its name, name and command line, and reason. */
const recordOf = (events, pid) => events.filter((event) => event.pid === pid).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason }));

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which outlives the kill, is recorded as a process it could not end by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  joinedLate(directory);
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', unkept: 'two' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.equal(alive(two), true, 'the kill ended the member, so the test proves nothing');
  assert.deepEqual(recordOf(events, two), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
});

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read until `$here/hang`
 * marks that L0 has sent its group the kill, and from then on fails each read of a name, as `ps`
 * fails, and answers every other read as `ps` does.
 */
const hidingTwoUnnamed = (directory) => fixture(directory, 'ps', [
  `[ -f "$here/hang" ] || { ${CUT_TWO}; exit 0; }`,
  'case "$*" in *"-o ucomm="*) echo "ps: failing on purpose" >&2; exit 2 ;; esac',
  ("exec " + shellQuote(PS) + " \"$@\""),
].join('\n'));

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which outlives the kill, and whose name no read after it can read, is recorded as a process it could not end by pid and why', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  joinedLate(directory);
  hidingTwoUnnamed(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', unkept: 'two' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.equal(alive(two), true, 'the kill ended the member, so the test proves nothing');
  assert.deepEqual(recordOf(events, two), [
    { event: 'survivor.unended', name: undefined, cmd: undefined, reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
});

/**
 * Asserts that `events` record `stuck`, a member L0 could not end under a table that fails every
 * read after the kill, by its name and command line as a process not shown to have ended, under
 * `unended`, with a reason matching `reason`, and never as killed; and that they record `ended`,
 * a member the kill did end, which is not alive, as killed, under `unended` with `.unended`
 * swapped for `.killed`, and not as a process not shown to have ended.
 */
function assertUnendedUnread(events, { stuck, ended, unended, directory, reason }) {
  assert.deepEqual(events.filter(({ pid }) => pid === stuck).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: unended, ...tailOf(directory) }], JSON.stringify(events));
  assert.match(events.find(({ pid }) => pid === stuck).reason, reason);
  assert.equal(events.filter(({ pid }) => pid === ended).length, 1, `the member the kill ended was not recorded once: ${JSON.stringify(events)}`);
  assert.equal(events.find(({ pid }) => pid === ended).event, unended.replace('.unended', '.killed'), `the member the kill ended was not recorded as killed: ${JSON.stringify(events)}`);
  assert.equal(alive(ended), false, 'the member the kill ended is alive');
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, a member the kill leaves alive is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /not shown to have ended[^]*ps: failing on purpose/ });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, a member that answers EPERM is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where every read after the kill fails, a member the kill leaves alive is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /not shown to have ended[^]*ps: failing on purpose/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where every read after the kill fails, a member that answers EPERM is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /^EPERM$/ });
});

/**
 * A `ps` stand-in that answers every read as `ps` does but the first read of the group's states
 * once `$here/hang` exists, which it fails as `ps` fails, marking `$here/failed`.
 */
const failingOnceAfterKill = (directory) => fixture(directory, 'ps', [
  'case "$*" in *stat=*)',
  '  if [ -f "$here/hang" ] && [ ! -f "$here/failed" ]; then : > "$here/failed"; echo "ps: failing once on purpose" >&2; exit 2; fi ;;',
  'esac',
  ("exec " + shellQuote(PS) + " \"$@\""),
].join('\n'));

/** Asserts that `events` record `two`, a member the kill left a zombie that later reads listed, as `killed` and as nothing else. */
function assertZombieKilled(events, directory, killed) {
  const two = pidIn(directory, 'two');
  assert.ok(existsSync(join(directory, 'failed')), 'no read after the kill failed, so the test proves nothing');
  assert.ok(processState(two).startsWith('Z'), `the member is not a zombie, so the test proves nothing: ${processState(two)}`);
  assert.deepEqual(events.filter(({ pid }) => pid === two).map(({ event }) => event), [killed], JSON.stringify(events));
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where only the first read after the kill fails, a member the kill left a zombie, which later reads list, is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: failingOnceAfterKill(directory), kill: markingKill(directory, signals) });

  assertZombieKilled(events, directory, 'survivor.killed');
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where only the first read after the kill fails, a member the kill left a zombie, which later reads list, is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: failingOnceAfterKill(directory), kill: markingKill(directory, signals) });

  assertZombieKilled(events, directory, 'recorded.killed');
});

/**
 * A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and then answers
 * each read of the group's states as `ps` does until one lists the process `$here/<name>.pid` names
 * as `shown` has it, `alive` or a `zombie` beside no live process, which it copies to
 * `$here/answered`. Every read after that one it fails as `ps` fails, marking `$here/failed`.
 */
function answeringOnceAfterKill(directory, name, shown) {
  const lists = {
    alive: '$1 == pid && $2 !~ /^Z/ { found = 1 } END { exit !found }',
    zombie: '$1 == pid && $2 ~ /^Z/ { found = 1 } $2 !~ /^Z/ { live = 1 } END { exit !(found && !live) }',
  }[shown];
  return fixture(directory, 'ps', [
    '[ -f "$here/answered" ] && { : > "$here/failed"; echo "ps: failing on purpose" >&2; exit 2; }',
    ("[ -f \"$here/hang\" ] || exec " + shellQuote(PS) + " \"$@\""),
    ("case \"$*\" in *stat=*) ;; *) exec " + shellQuote(PS) + " \"$@\" ;; esac"),
    ("rows=$(" + shellQuote(PS) + " \"$@\") || exit $?"),
    'printf "%s\\n" "$rows"',
    `printf "%s\\n" "$rows" | /usr/bin/awk -v pid="$(/bin/cat "$here/${name}.pid")" '${lists}' && printf "%s\\n" "$rows" > "$here/answered"`,
    'exit 0',
  ].join('\n'));
}

/** Asserts that the read after the kill that answered listed `pid` alive, and that a read after it failed. */
function assertShownAliveThenUnread(directory, pid) {
  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member alive, so the test proves nothing');
  assert.ok(existsSync(join(directory, 'failed')), 'no read failed after the one that listed the member alive, so the test proves nothing');
  assert.match(read(directory, 'answered'), new RegExp(`^\\s*${pid}\\s+[^Z\\s]`, 'm'));
}

/** The reason for a member the last read that answered showed alive, before later reads failed. */
const SHOWN_ALIVE = /not shown to have ended[^]*last read[^]*answered[^]*alive[^]*later reads failed[^]*ps: failing on purpose/;

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: answeringOnceAfterKill(directory, 'one', 'alive'), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, one);
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: SHOWN_ALIVE });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member that answers EPERM alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: answeringOnceAfterKill(directory, 'one', 'alive'), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, one);
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'member', 'alive'), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, started.member);
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: SHOWN_ALIVE });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member that answers EPERM alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'member', 'alive'), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, started.member);
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member a zombie and every later read fails, the member is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: answeringOnceAfterKill(directory, 'two', 'zombie'), kill: markingKill(directory, signals) });

  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member a zombie, so the test proves nothing');
  assertZombieKilled(events, directory, 'survivor.killed');
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member a zombie and every later read fails, the member is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'two', 'zombie'), kill: markingKill(directory, signals) });

  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member a zombie, so the test proves nothing');
  assertZombieKilled(events, directory, 'recorded.killed');
});

/** Holds the exit trigger until a first-listing control has recorded both fixture identities. */
const D2_CONTROL_CALLER = (() => {
  const anchor = "appendFileSync(join(here, 'exiting'), String(Date.now()));";
  assert.equal(CALLER.split(anchor).length, 2, 'the D2 caller exit anchor moved');
  return CALLER.replace(anchor, `while (!existsSync(join(here, 'begin-exit'))) await new Promise((resolve) => setImmediate(resolve));\n${anchor}`);
})();

/** Records the answered listing, state and signal order after the held exit trigger. */
const D3_CONTROL_CALLER = (() => {
  const anchor = "appendFileSync(join(here, 'exiting'), String(Date.now()));";
  assert.equal(TRACED_CALLER.split(anchor).length, 2, 'the traced caller exit anchor moved');
  return TRACED_CALLER.replace(anchor, `while (!existsSync(join(here, 'begin-exit'))) await new Promise((resolve) => setImmediate(resolve));\n${anchor}`);
})();

/**
 * Models ESRCH at the first group probe after the recorded kill, tracing every unchanged read.
 * A synchronous exit cannot reap its own leader; this control does not prove native group absence.
 */
const G6_CONTROL_CALLER = (() => {
  const anchor = "try { const answer = signalled(target, name); trace('signal-answer',";
  assert.equal(D3_CONTROL_CALLER.split(anchor).length, 2, 'the G6 signal answer anchor moved');
  return D3_CONTROL_CALLER.replace(anchor, `try { if (target === -pidIn('group') && name === 0 && existsSync(join(here, 'hang'))) { appendFileSync(join(here, 'g6-empty-probe'), 'E'); throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); } const answer = signalled(target, name); trace('signal-answer',`);
})();

/** Reads a directly owned child's settled state without sending it a signal. */
const d2HasEnded = (child) => child.exitCode !== null || child.signalCode !== null;

/** A close deadline only for teardown; a nonclosing handle leaves its scratch and evidence unresolved. */
async function d2CloseWithin(closed) {
  if (!closed) return null;
  let timer;
  const answer = await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5_000); })]);
  clearTimeout(timer);
  return answer;
}

/** The recorded command identity is gone only when its PID is absent or belongs to another birth. */
async function d2CommandGone({ pid, started }) {
  const deadline = Date.now() + 5_000;
  const present = () => {
    const state = spawnSync(PS, ['-o', 'stat=', '-p', String(pid)], { env: process.env, encoding: 'utf8' });
    if (state.error) throw state.error;
    if (state.status === 1 && !state.stdout && !state.stderr) return false;
    if (state.status !== 0 || !state.stdout.trim() || state.stderr) throw new Error('the command identity read did not answer cleanly');
    try { return startOf(pid) === started; }
    catch {
      const after = spawnSync(PS, ['-o', 'stat=', '-p', String(pid)], { env: process.env, encoding: 'utf8' });
      if (after.status === 1 && !after.stdout && !after.stderr && !after.error) return false;
      throw new Error('the command identity changed during its read');
    }
  };
  while (present() && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  return !present();
}

/** Directs a recorded child's complete output to private files from its first byte. */
function d2Spawn(command, args, options, evidence, name, ipc = false) {
  const stdout = openSync(join(evidence, `${name}.stdout`), 'wx', 0o600);
  let stderr;
  try {
    stderr = openSync(join(evidence, `${name}.stderr`), 'wx', 0o600);
    return spawn(command, args, { env: process.env, ...options, stdio: ['ignore', stdout, stderr, ...(ipc ? ['ipc'] : [])] });
  } finally {
    closeSync(stdout);
    if (stderr !== undefined) closeSync(stderr);
  }
}

/** Exercises one first-listing answer while retaining the directly owned fixture and caller originals. */
async function firstDirectoryListing(t, answer) {
  const groupEmpty = answer === 'G6';
  const groupC2Timeout = answer === 'G2C2T';
  const groupC2Failure = answer === 'G4C2F';
  const groupC1Failure = answer === 'G4C1F';
  const groupC3Failure = answer === 'G4C3F';
  const groupC2Read = groupC2Timeout || groupC2Failure || groupC3Failure;
  const d9Read = groupEmpty || answer === 'D9NO' || answer === 'D9EC' || answer === 'D9NF' || answer === 'D9NT' || answer === 'D9NU' || answer === 'D9CF' || answer === 'D9CT' || groupC1Failure || groupC2Read;
  const heldState = answer === 'SF' || answer === 'ST' || answer === 'EHSF' || answer === 'EHST';
  const coListedRefusal = answer === 'EHF' || answer === 'EHT' || answer === 'EHSF' || answer === 'EHST' || answer === 'EHPF' || answer === 'EHPT' || answer === 'EOF' || answer === 'EOT' || answer === 'EOSF' || answer === 'EOST' || answer === 'EOPF' || answer === 'EOPT';
  const heldListing = answer === 'LF' || answer === 'LT' || answer === 'EHF' || answer === 'EHT';
  const heldPerPid = answer === 'PF' || answer === 'PT' || answer === 'EHPF' || answer === 'EHPT';
  const heldOmitted = answer === 'HO';
  const heldZombie = answer === 'HZ';
  const heldRead = heldState || heldListing || heldPerPid || heldOmitted || heldZombie;
  const ownedListing = answer === 'OF' || answer === 'OT' || answer === 'EOF' || answer === 'EOT';
  const ownedState = answer === 'OSF' || answer === 'OST' || answer === 'EOSF' || answer === 'EOST';
  const ownedPerPid = answer === 'OPF' || answer === 'OPT' || answer === 'EOPF' || answer === 'EOPT';
  const ownedOmitted = answer === 'OO';
  const ownedLive = answer === 'OLS';
  const ownedZombie = answer === 'OZ';
  const ownedRead = ownedListing || ownedState || ownedPerPid || ownedOmitted || ownedLive || ownedZombie;
  assert.ok(process.env.TMPDIR && process.env.C615_EVIDENCE_ROOT, 'the first-listing control needs external TMPDIR and a private evidence root before fixtures start');
  const checkout = realpathSync.native(process.cwd());
  const scratchRoot = realpathSync.native(process.env.TMPDIR);
  const outer = realpathSync.native(process.env.C615_EVIDENCE_ROOT);
  assert.ok(scratchRoot !== checkout && !scratchRoot.startsWith(`${checkout}/`) && outer !== checkout && !outer.startsWith(`${checkout}/`), 'first-listing evidence or scratch is inside the checkout');
  assert.ok(lstatSync(process.env.TMPDIR).isDirectory() && !lstatSync(process.env.TMPDIR).isSymbolicLink(), 'first-listing TMPDIR is not a directory');
  assert.ok(lstatSync(process.env.C615_EVIDENCE_ROOT).isDirectory() && !lstatSync(process.env.C615_EVIDENCE_ROOT).isSymbolicLink() && (lstatSync(outer).mode & 0o077) === 0, 'first-listing evidence root is not private');
  const evidence = join(outer, groupEmpty ? 'g6-empty-first-probe' : answer === 'F' ? 'd2-first-failure' : answer === 'T' ? 'd2-first-timeout' : answer === 'SF' ? 'd4-state-failure' : answer === 'ST' ? 'd4-state-timeout' : answer === 'LF' ? 'd4-listing-failure' : answer === 'LT' ? 'd4-listing-timeout' : answer === 'PF' ? 'd4-per-pid-failure' : answer === 'PT' ? 'd4-per-pid-timeout' : answer === 'OF' ? 'd5-listing-failure' : answer === 'OT' ? 'd5-listing-timeout' : answer === 'OSF' ? 'd5-state-failure' : answer === 'OST' ? 'd5-state-timeout' : answer === 'OPF' ? 'd5-per-pid-failure' : answer === 'OPT' ? 'd5-per-pid-timeout' : heldOmitted ? 'd6-held-omitted' : heldZombie ? 'd6-held-zombie' : ownedOmitted ? 'd6-owned-omitted' : ownedLive ? 'd6-owned-live' : ownedZombie ? 'd6-owned-zombie' : answer === 'EHF' ? 'd8-held-listing-failure' : answer === 'EHT' ? 'd8-held-listing-timeout' : answer === 'EHSF' ? 'd8-held-state-failure' : answer === 'EHST' ? 'd8-held-state-timeout' : answer === 'EHPF' ? 'd8-held-per-pid-failure' : answer === 'EHPT' ? 'd8-held-per-pid-timeout' : answer === 'EOF' ? 'd8-owned-listing-failure' : answer === 'EOT' ? 'd8-owned-listing-timeout' : answer === 'EOSF' ? 'd8-owned-state-failure' : answer === 'EOST' ? 'd8-owned-state-timeout' : answer === 'EOPF' ? 'd8-owned-per-pid-failure' : answer === 'EOPT' ? 'd8-owned-per-pid-timeout' : answer === 'D9CT' ? 'd9-command-timeout' : answer === 'D9CF' ? 'd9-command-failure' : answer === 'G2C2T' ? 'g2-c2-timeout' : answer === 'G4C2F' ? 'g4-c2-failure' : answer === 'G4C1F' ? 'g4-c1-failure' : answer === 'G4C3F' ? 'g4-c3-failure' : answer === 'D9NU' ? 'd9-name-cached' : answer === 'D9NT' ? 'd9-name-timeout' : answer === 'D9NF' ? 'd9-name-failure' : answer === 'D9EC' ? 'd9-empty-name-command-present' : d9Read ? 'd9-name-command-omitted' : 'd3-first-answered');
  mkdirSync(evidence, { mode: 0o700 });
  const nonce = randomUUID();
  let directory;
  let outside;
  let refused;
  let caller;
  let outsideClosed;
  let refusedClosed;
  let callerClosed;
  let outsideBirth;
  let refusedBirth;
  let commandBirth;
  let outsideError;
  let refusedError;
  let callerError;
  let finalized = false;
  let copied = false;

  t.after(async () => {
    const record = { answer, outside: outsideBirth ?? null, refused: refusedBirth ?? null, command: commandBirth ?? null, outsideClose: null, refusedClose: null, callerClose: null, commandGone: null, refusedGone: null, copied: false, errors: [] };
    if (directory) {
      try {
        writeFileSync(join(directory, 'release'), '', { flag: 'w' });
        writeFileSync(join(directory, 'begin-exit'), '', { flag: 'w' });
      } catch (error) { record.errors.push({ stage: 'command-release', code: error.code ?? error.name }); }
    }
    if (outside && !d2HasEnded(outside)) {
      try { outside.send({ release: nonce }); }
      catch (error) { record.errors.push({ stage: 'fixture-release', code: error.code ?? error.name }); }
    }
    if (refused && !d2HasEnded(refused)) {
      try { refused.send({ release: nonce }); }
      catch (error) { record.errors.push({ stage: 'refused-release', code: error.code ?? error.name }); }
    }
    const [outsideResult, refusedResult, callerResult, commandResult, refusedGoneResult] = await Promise.allSettled([
      d2CloseWithin(outsideClosed), d2CloseWithin(refusedClosed), d2CloseWithin(callerClosed), commandBirth ? d2CommandGone(commandBirth) : Promise.resolve(null), refusedBirth ? d2CommandGone(refusedBirth) : Promise.resolve(null),
    ]);
    if (outsideResult.status === 'fulfilled') record.outsideClose = outsideResult.value;
    else record.errors.push({ stage: 'fixture-close', code: outsideResult.reason.code ?? outsideResult.reason.name });
    if (refusedResult.status === 'fulfilled') record.refusedClose = refusedResult.value;
    else record.errors.push({ stage: 'refused-close', code: refusedResult.reason.code ?? refusedResult.reason.name });
    if (callerResult.status === 'fulfilled') record.callerClose = callerResult.value;
    else record.errors.push({ stage: 'caller-close', code: callerResult.reason.code ?? callerResult.reason.name });
    if (commandResult.status === 'fulfilled') record.commandGone = commandResult.value;
    else record.errors.push({ stage: 'command-identity', code: commandResult.reason.code ?? commandResult.reason.name });
    if (refusedGoneResult.status === 'fulfilled') record.refusedGone = refusedGoneResult.value;
    else record.errors.push({ stage: 'refused-identity', code: refusedGoneResult.reason.code ?? refusedGoneResult.reason.name });
    if (outsideError) record.errors.push({ stage: 'fixture-handle', code: outsideError.code ?? outsideError.name });
    if (refusedError) record.errors.push({ stage: 'refused-handle', code: refusedError.code ?? refusedError.name });
    if (callerError) record.errors.push({ stage: 'caller-handle', code: callerError.code ?? callerError.name });
    let answeredKill = false;
    if (answer === 'A' && directory && outsideBirth) {
      try { answeredKill = linesOf(directory, 'control.trace.jsonl').some(({ kind, target, name, answer: result }) => kind === 'signal-answer' && target === outsideBirth.pid && name === 'SIGKILL' && result === true); }
      catch (error) { record.errors.push({ stage: 'kill-trace', code: error.code ?? error.name }); }
    }
    const outsideSettled = answer === 'A' ? answeredKill && record.outsideClose?.signal === 'SIGKILL' : record.outsideClose?.code === 0;
    finalized = (!outside || (outsideBirth && outsideSettled)) && (!refused || (refusedBirth && record.refusedClose?.code === 0 && record.refusedGone === true)) && (!caller || record.callerClose?.code === 0) && (!caller || (commandBirth && record.commandGone === true)) && record.errors.length === 0;
    let snapshotMatched = false;
    if (directory) {
      try {
        const source = sightingFiles(directory);
        cpSync(directory, join(evidence, 'fixture'), { recursive: true, force: false, errorOnExist: true });
        const retained = sightingFiles(join(evidence, 'fixture'));
        snapshotMatched = JSON.stringify(source) === JSON.stringify(retained);
        if (!snapshotMatched) record.errors.push({ stage: 'fixture-copy', code: 'BYTE_MISMATCH' });
      } catch (error) { record.errors.push({ stage: 'fixture-copy', code: error.code ?? error.name }); }
    }
    record.copied = snapshotMatched;
    writeFileSync(join(evidence, 'finalizer.json'), JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(evidence, 'inventory.json'), JSON.stringify({ files: sightingFiles(evidence), finalizer: finalized ? 'closed' : 'unresolved', fixtureCopy: snapshotMatched ? 'byte-complete' : 'partial-or-missing' }) + '\n', { flag: 'wx', mode: 0o600 });
    copied = snapshotMatched;
    assert.ok(finalized && copied, 'first-listing finalizer or private copy is unresolved; keep fixture scratch');
  });

  directory = realpathSync(temporaryDirectory('c615-first-listing-', { context: t, beforeRemoval: () => assert.ok(finalized && copied, 'first-listing scratch has unresolved identities or originals') }));
  const work = join(directory, 'work');
  const sub = join(work, 'sub');
  mkdirSync(sub, { recursive: true });
  const refusedSub = join(work, 'refused');
  const fixtureSource = `const nonce = ${JSON.stringify(nonce)}; process.on('message', (message) => { if (message?.release === nonce) process.exit(0); }); process.on('disconnect', () => process.exit(2)); process.send(nonce);`;
  outside = d2Spawn(process.execPath, ['-e', fixtureSource], { cwd: sub }, evidence, 'outside', true);
  outside.on('error', (error) => { outsideError = error; });
  outsideClosed = new Promise((resolveClose) => outside.once('close', (code, signal) => resolveClose({ code, signal })));
  assert.ok(Number.isSafeInteger(outside.pid) && outside.pid > 0, 'the directly owned nonforking fixture did not start');
  const [ready] = await once(outside, 'message');
  assert.equal(ready, nonce, 'the directly owned fixture did not establish its release channel');
  outsideBirth = { pid: outside.pid, started: startOf(outside.pid) };
  writeFileSync(join(directory, 'outside.pid'), String(outsideBirth.pid));
  writeFileSync(join(directory, 'outside-birth.json'), JSON.stringify(outsideBirth));
  if (coListedRefusal) {
    mkdirSync(refusedSub);
    refused = d2Spawn(process.execPath, ['-e', fixtureSource], { cwd: refusedSub }, evidence, 'refused', true);
    refused.on('error', (error) => { refusedError = error; });
    refusedClosed = new Promise((resolveClose) => refused.once('close', (code, signal) => resolveClose({ code, signal })));
    assert.ok(Number.isSafeInteger(refused.pid) && refused.pid > 0, 'the directly owned refused fixture did not start');
    const [refusedReady] = await once(refused, 'message');
    assert.equal(refusedReady, nonce, 'the refused fixture did not establish its release channel');
    refusedBirth = { pid: refused.pid, started: startOf(refused.pid) };
    writeFileSync(join(directory, 'refused.pid'), String(refusedBirth.pid));
    writeFileSync(join(directory, 'refused-birth.json'), JSON.stringify(refusedBirth));
  }
  fixture(directory, 'command', 'echo $$ > "$here/group.pid"\n: > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');
  const lsofBody = answer === 'F'
    ? 'printf "%s\\n" "$@" > "$here/first-listing-argv"\n: > "$here/first-listing-entered"\necho "lsof: forced first-listing failure" >&2\nexit 2'
    : ownedRead ? [
      'if [ ! -f "$here/first-listing-entered" ]; then : > "$here/first-listing-entered";',
      `  ${listingOf('outside', realpathSync.native(sub))}`,
      ...(coListedRefusal ? [`  ${listingOf('refused', realpathSync.native(refusedSub))}`] : []),
      '  exit 0',
      'fi',
      'if [ ! -f "$here/owned-per-pid-answered" ]; then',
      '  printf "%s\\n" "$@" > "$here/owned-per-pid-argv"',
      '  : > "$here/owned-per-pid-answered"',
      `  ${listingOf('outside', realpathSync.native(sub))}`,
      '  exit 0',
      'fi',
      ...(!ownedListing ? [
        'if [ ! -f "$here/owned-later-full-answered" ]; then',
        '  printf "%s\\n" "$@" > "$here/owned-later-argv"',
        '  : > "$here/owned-later-entered"',
        '  : > "$here/owned-later-full-answered"',
        ...(ownedOmitted ? [] : [`  ${listingOf('outside', realpathSync.native(sub))}`]),
        '  exit 0',
        'fi',
        ...(ownedLive || ownedZombie ? [
          ...(ownedZombie ? [
            'if [ ! -f "$here/owned-zombie-per-pid-answered" ]; then',
            '  printf "%s\\n" "$@" > "$here/owned-zombie-per-pid-argv"',
            '  : > "$here/owned-zombie-per-pid-answered"',
            '  exit 0',
            'fi',
          ] : []),
          'if [ ! -f "$here/owned-retry-full-answered" ]; then',
          '  printf "%s\\n" "$@" > "$here/owned-retry-full-argv"',
          '  : > "$here/owned-retry-full-answered"',
          `  ${listingOf('outside', realpathSync.native(sub))}`,
          '  exit 0',
          'fi',
          'if [ ! -f "$here/owned-retry-per-pid-answered" ]; then',
          '  printf "%s\\n" "$@" > "$here/owned-retry-per-pid-argv"',
          '  : > "$here/owned-retry-per-pid-answered"',
          '  exit 0',
          'fi',
          'printf "%s\\n" "$@" > "$here/owned-finished-argv"',
        ] : ownedOmitted ? [
          'if [ ! -f "$here/owned-next-per-pid-answered" ]; then',
          '  printf "%s\\n" "$@" > "$here/owned-next-per-pid-argv"',
          '  : > "$here/owned-next-per-pid-answered"',
          `  ${listingOf('outside', realpathSync.native(sub))}`,
          '  exit 0',
          'fi',
          'printf "%s\\n" "$@" > "$here/owned-after-kill-argv"',
          ': > "$here/owned-after-kill-entered"',
        ] : ownedPerPid ? [
          'printf "%s\\n" "$@" > "$here/owned-next-per-pid-argv"',
          ': > "$here/owned-next-per-pid-entered"',
          answer === 'OPF' || answer === 'EOPF' ? 'echo "lsof: forced owned-per-PID failure" >&2; exit 2' : 'exec /usr/bin/tail -f "$here/hold"',
        ] : ['echo "lsof: unexpected read after owned state" >&2; exit 3']),
      ] : [
      'printf "%s\\n" "$@" > "$here/owned-later-argv"',
      ': > "$here/owned-later-entered"',
      answer === 'OF' || answer === 'EOF' ? 'echo "lsof: forced owned-listing failure" >&2; exit 2' : 'exec /usr/bin/tail -f "$here/hold"',
      ]),
    ].join('\n')
    : heldZombie ? [
      'if [ ! -f "$here/first-listing-entered" ]; then',
      '  : > "$here/first-listing-entered"',
      `  ${listingOf('outside', realpathSync.native(sub))}`,
      '  exit 0',
      'fi',
      'if [ ! -f "$here/held-zombie-per-pid-entered" ]; then',
      '  printf "%s\\n" "$@" > "$here/held-zombie-per-pid-argv"',
      '  : > "$here/held-zombie-per-pid-entered"',
      '  exit 0',
      'fi',
      'printf "%s\\n" "$@" > "$here/held-zombie-later-argv"',
      ': > "$here/held-zombie-later-entered"',
    ].join('\n')
    : heldOmitted ? [
      'if [ -f "$here/first-listing-entered" ]; then',
      '  printf "%s\\n" "$@" > "$here/held-omitted-argv"',
      '  : > "$here/held-omitted-entered"',
      '  exit 0',
      'fi',
      ': > "$here/first-listing-entered"',
      listingOf('outside', realpathSync.native(sub)),
    ].join('\n')
    : heldListing || heldPerPid ? [
      'if [ -f "$here/first-listing-entered" ]; then',
      `  printf "%s\\n" "$@" > "$here/${heldPerPid ? 'per-pid-listing' : 'later-listing'}-argv"`,
      `  : > "$here/${heldPerPid ? 'per-pid-listing' : 'later-listing'}-entered"`,
      answer === 'LF' || answer === 'PF' || answer === 'EHF' || answer === 'EHPF' ? `  echo "lsof: forced ${heldPerPid ? 'per-PID' : 'later-listing'} failure" >&2; exit 2` : '  exec /usr/bin/tail -f "$here/hold"',
      'fi',
      ': > "$here/first-listing-entered"',
      listingOf('outside', realpathSync.native(sub)),
      ...(coListedRefusal ? [listingOf('refused', realpathSync.native(refusedSub))] : []),
    ].join('\n')
    : ': > "$here/first-listing-entered"\n' + listingOf('outside', realpathSync.native(sub)) + (coListedRefusal ? '\n' + listingOf('refused', realpathSync.native(refusedSub)) : '');
  fixture(directory, 'lsof', lsofBody);
  if (answer === 'A') fixture(directory, 'ps', ("exec " + shellQuote(PS) + " \"$@\""));
  if (answer === 'D9NT' || answer === 'D9NU' || groupC2Timeout || answer === 'D9CT') writeFileSync(join(directory, 'hold'), '');
  if (answer === 'D9NU' || groupC1Failure || groupC2Read) fixture(directory, 'ps', [
    'group=$(/bin/cat "$here/group.pid")',
    groupC1Failure ? 'if [ "$*" = "-ww -g $group -o pid=,stat=" ] && [ ! -f "$here/d9-prior-entered" ]; then' : 'if [ "$*" = "-ww -g $group -o pid=,stat=" ]; then',
    ...(groupC2Read ? [
      '  : > "$here/group-c1-answered"',
      ("  exec " + shellQuote(PS) + " \"$@\""),
    ] : groupC1Failure ? [
      '  printf "%s\\n" "$@" > "$here/d9-prior-argv"',
      '  : > "$here/d9-prior-entered"',
      '  echo "ps: forced group state failure" >&2; exit 2',
    ] : [
      '  printf "%s\\n" "$@" > "$here/d9-prior-argv"',
      '  : > "$here/d9-prior-entered"',
      '  exec /usr/bin/tail -f "$here/hold"',
    ]),
    'fi',
    ...(groupC2Read ? [
      groupC2Failure ? 'if [ "$*" = "-ww -g $group -o pid=,command=" ] && [ ! -f "$here/d9-prior-entered" ]; then' : 'if [ "$*" = "-ww -g $group -o pid=,command=" ]; then',
      groupC3Failure ? '  : > "$here/group-c2-answered"' : '  printf "%s\\n" "$@" > "$here/d9-prior-argv"',
      ...(!groupC3Failure ? ['  : > "$here/d9-prior-entered"'] : []),
      groupC3Failure ? ("  exec " + shellQuote(PS) + " \"$@\"") : groupC2Timeout ? '  exec /usr/bin/tail -f "$here/hold"' : '  echo "ps: forced group command failure" >&2; exit 2',
      'fi',
    ] : []),
    ...(groupC3Failure ? [
      'if [ "$*" = "-p $group -o ucomm=" ]; then',
      '  printf "%s\\n" "$@" > "$here/d9-prior-argv"',
      '  : > "$here/d9-prior-entered"',
      '  echo "ps: forced group name failure" >&2; exit 2',
      'fi',
    ] : []),
    groupC1Failure || groupC2Failure || groupC3Failure ? ("exec " + shellQuote(PS) + " \"$@\"") : 'echo "ps: an unexpected read spawned after the cached refusal" >&2; exit 3',
  ].join('\n'));
  else if (d9Read) fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'if [ "$*" = "-p $pid -o ucomm=" ]; then',
    '  printf "%s\\n" "$@" > "$here/d9-name-argv"',
    answer === 'D9NT' ? '  exec /usr/bin/tail -f "$here/hold"' : answer === 'D9NF' ? '  echo "ps: forced name failure" >&2; exit 2' : answer === 'D9EC' ? '  exit 0' : '  printf "returned-name\\n"; exit 0',
    'fi',
    'if [ "$*" = "-ww -p $pid -o pid=,command=" ]; then',
    '  printf "%s\\n" "$@" > "$here/d9-command-argv"',
    '  : > "$here/d9-command-entered"',
    ...(answer === 'D9EC' ? ['  printf "%s returned-command\\n" "$pid"'] : answer === 'D9CF' ? ['  echo "ps: forced command failure" >&2; exit 2'] : answer === 'D9CT' ? ['  exec /usr/bin/tail -f "$here/hold"'] : []),
    '  exit 0',
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  if (heldZombie) fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'if [ "$*" = "-p $pid -o pid=,stat=" ]; then',
    '  printf "%s\\n" "$@" > "$here/held-state-argv"',
    '  if [ ! -f "$here/held-state-entered" ]; then',
    '    /bin/ps -p "$pid" -o stat= > "$here/held-state-status"',
    '    : > "$here/held-state-entered"',
    '    printf "%s Z\\n" "$pid"; exit 0',
    '  fi',
    '  : > "$here/held-zombie-after-entered"',
    '  printf "%s S\\n" "$pid"; exit 0',
    'fi',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  else if (heldRead) {
    if (answer === 'ST' || answer === 'LT' || answer === 'PT' || answer === 'EHT' || answer === 'EHST' || answer === 'EHPT') writeFileSync(join(directory, 'hold'), '');
    fixture(directory, 'ps', [
      'pid=$(/bin/cat "$here/outside.pid")',
      'if [ "$*" = "-p $pid -o pid=,stat=" ]; then',
      '  printf "%s\\n" "$@" > "$here/held-state-argv"',
      '  /bin/ps -p "$pid" -o stat= > "$here/held-state-status"',
      '  : > "$here/held-state-entered"',
      heldListing || heldOmitted ? '  printf "%s S\\n" "$pid"; exit 0' : heldPerPid ? ("  exec " + shellQuote(PS) + " \"$@\"") : answer === 'SF' || answer === 'EHSF' ? '  echo "ps: forced held-state failure" >&2; exit 2' : '  exec /usr/bin/tail -f "$here/hold"',
      'fi',
      ("exec " + shellQuote(PS) + " \"$@\""),
    ].join('\n'));
  }
  if (ownedRead) {
    if (answer === 'OT' || answer === 'OST' || answer === 'OPT' || answer === 'EOT' || answer === 'EOST' || answer === 'EOPT') writeFileSync(join(directory, 'hold'), '');
    fixture(directory, 'ps', [
      'pid=$(/bin/cat "$here/outside.pid")',
      'if [ -f "$here/hang" ]; then',
      '  if [ "$*" = "-p $pid -o ucomm=" ]; then printf "fresh-owned-name\\n"; exit 0; fi',
      '  if [ "$*" = "-ww -p $pid -o pid=,command=" ]; then printf "%s fresh-owned-command\\n" "$pid"; exit 0; fi',
      'fi',
      'if [ -f "$here/owned-per-pid-answered" ] && [ ! -f "$here/owned-state-entered" ] && [ "$*" = "-p $pid -o pid=,stat=" ]; then',
      '  /bin/ps -p "$pid" -o stat= > "$here/owned-state-actual"',
      '  : > "$here/owned-state-entered"',
      '  printf "%s S\\n" "$pid"; exit 0',
      'fi',
      ...(!ownedListing ? [
        'if [ -f "$here/owned-later-full-answered" ] && [ ! -f "$here/owned-next-state-entered" ] && [ "$*" = "-p $pid -o pid=,stat=" ]; then',
        '  printf "%s\\n" "$@" > "$here/owned-next-state-argv"',
        '  /bin/ps -p "$pid" -o stat= > "$here/owned-next-state-actual"',
        '  : > "$here/owned-next-state-entered"',
        ownedLive || ownedZombie ? `  printf "%s ${ownedZombie ? 'Z' : 'S'}\\n" "$pid"; exit 0` : ownedState ? answer === 'OSF' || answer === 'EOSF' ? '  echo "ps: forced owned-state failure" >&2; exit 2' : '  exec /usr/bin/tail -f "$here/hold"' : ("  exec " + shellQuote(PS) + " \"$@\""),
        'fi',
      ] : []),
      ...(ownedZombie ? [
        'if [ -f "$here/owned-zombie-per-pid-answered" ] && [ ! -f "$here/owned-zombie-after-entered" ] && [ "$*" = "-p $pid -o pid=,stat=" ]; then',
        '  : > "$here/owned-zombie-after-entered"',
        '  printf "%s S\\n" "$pid"; exit 0',
        'fi',
      ] : []),
      ("exec " + shellQuote(PS) + " \"$@\""),
    ].join('\n'));
  }
  const callerPath = join(directory, 'caller.mjs');
  writeFileSync(callerPath, groupEmpty ? G6_CONTROL_CALLER : answer === 'A' || heldRead || ownedRead || d9Read ? D3_CONTROL_CALLER : D2_CONTROL_CALLER);
  const options = { readTimeout: CLEANUP_BOUND, directory: work, lsof: 'lsof', ...(answer === 'A' || heldRead || ownedRead || d9Read ? { ps: 'ps' } : { refused: 'outside' }), ...(d9Read ? { refused: 'outside' } : {}), ...(coListedRefusal ? { refused: 'refused' } : {}), ...(ownedRead ? { unkept: 'outside', hangAfter: 'outside' } : {}), ...(answer === 'T' ? { censusElapsed: CLEANUP_BOUND + 1 } : {}), ...(groupEmpty ? { directory: undefined, hangAfter: 'group' } : {}) };
  caller = d2Spawn(process.execPath, [callerPath, directory, JSON.stringify(options)], {}, evidence, 'caller');
  caller.on('error', (error) => { callerError = error; });
  callerClosed = new Promise((resolveClose) => caller.once('close', (code, signal) => resolveClose({ code, signal })));
  assert.ok(Number.isSafeInteger(caller.pid) && caller.pid > 0, 'the first-listing caller did not start');
  await until(() => existsSync(join(directory, 'up')) || d2HasEnded(caller), t);
  assert.ok(existsSync(join(directory, 'up')), 'the command did not reach the held exit boundary');
  const group = pidIn(directory, 'group');
  assert.ok(Number.isSafeInteger(group) && group > 0, 'the command group did not record its PID');
  commandBirth = { pid: group, started: startOf(group) };
  writeFileSync(join(directory, 'caller-birth.json'), JSON.stringify({ pid: caller.pid, started: startOf(caller.pid), command: commandBirth }));
  assert.ok(!d2HasEnded(outside) && startOf(outsideBirth.pid) === outsideBirth.started, 'the directly owned fixture changed identity before cleanup');
  if (coListedRefusal) assert.ok(!d2HasEnded(refused) && startOf(refusedBirth.pid) === refusedBirth.started, 'the refused fixture changed identity before cleanup');
  writeFileSync(join(directory, 'begin-exit'), '');
  await until(() => d2HasEnded(caller), t);
  assert.equal(caller.exitCode, 0, 'the first-listing caller did not complete exit cleanup; inspect retained originals');

  const events = linesOf(directory, 'events');
  const pairs = linesOf(directory, 'pairs');
  const directoryEvents = events.filter(({ directory: at }) => at === work);
  const firstArgs = ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-F', 'pun'];
  if (groupEmpty) {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const ps = join(directory, 'ps');
    const groupReads = trace.filter(({ kind, tool, args }) => kind === 'read-start' && tool === ps && ((args.includes('-g') && args.includes(String(group))) || (args[0] === '-p' && args[1] === String(group) && args.at(-1) === 'ucomm=')));
    const kill = trace.find(({ kind, target, name, answer: result }) => kind === 'signal-answer' && target === -group && name === 'SIGKILL' && result === true);
    assert.ok(kill, 'G6 never reached its first group kill');
    const probe = trace.find(({ kind, target, name, sequence }) => kind === 'signal-answer' && target === -group && name === 0 && sequence > kill.sequence);
    assert.ok(probe && probe.error === 'ESRCH' && probe.answer === undefined, 'G6 did not reach its controlled empty first probe');
    assert.equal(read(directory, 'g6-empty-probe'), 'E', 'the empty probe was not forced exactly once');
    assert.deepEqual(groupReads.filter(({ sequence }) => sequence > kill.sequence), [], 'an empty first probe started a post-kill group read');
    const state = ['-ww', '-g', String(group), '-o', 'pid=,stat='];
    const command = ['-ww', '-g', String(group), '-o', 'pid=,command='];
    const name = ['-p', String(group), '-o', 'ucomm='];
    assert.deepEqual(groupReads.map(({ args }) => args), [state, command, name, command, state, ['-g', String(group), '-o', 'pid=,stat='], ['-g', String(group), '-o', 'pid=,stat=,xstat=']], 'G6 did not reach its answered census and both pre-kill confirmations');
    const ends = trace.filter(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && sequence < kill.sequence && groupReads.some((start) => start.sequence < sequence && JSON.stringify(start.args) === JSON.stringify(args)));
    assert.equal(ends.length, groupReads.length, 'a G6 pre-kill read has no retained answer');
    assert.ok(ends.every(({ status, error, stderr }) => status === 0 && error === undefined && stderr === ''), 'a G6 pre-kill read did not answer completely');
    const shownName = ends.find(({ args }) => JSON.stringify(args) === JSON.stringify(name))?.stdout.replace(/ *\n$/, '');
    const shownCommand = ends.find(({ args }) => JSON.stringify(args) === JSON.stringify(command))?.stdout.match(new RegExp(`^\\s*${group} (.+)$`, 'm'))?.[1];
    assert.ok(shownName && shownCommand, 'G6 retained no complete returned identity');
    assert.deepEqual(events.map(({ event, pid, name: foundName, cmd, reason }) => ({ event, pid, name: foundName, cmd, reason })), [{ event: 'survivor.killed', pid: group, name: shownName, cmd: shownCommand, reason: undefined }], 'G6 invented or lost the recorded member result');
    assert.equal(trace.filter(({ kind, target, name }) => kind === 'signal-answer' && target === -group && name === 'SIGKILL').length, 1, 'G6 sent another group kill after its empty probe');
    return;
  }
  if (answer === 'D9NU' || groupC1Failure || groupC2Read) {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const ps = join(directory, 'ps');
    const lsof = join(directory, 'lsof');
    const pid = outsideBirth.pid;
    const firstGroupArgs = ['-ww', '-g', String(group), '-o', 'pid=,stat='];
    const secondGroupArgs = ['-ww', '-g', String(group), '-o', 'pid=,command='];
    const priorArgs = groupC3Failure ? ['-p', String(group), '-o', 'ucomm='] : groupC2Read ? secondGroupArgs : firstGroupArgs;
    const firstGroupStart = groupC2Read && trace.find(({ kind, tool, args }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(firstGroupArgs));
    const firstGroup = groupC2Read && trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && JSON.stringify(args) === JSON.stringify(firstGroupArgs) && sequence > firstGroupStart?.sequence);
    if (groupC2Read) assert.ok(firstGroupStart && firstGroup && firstGroup.status === 0 && firstGroup.error === undefined && firstGroup.stderr === '' && firstGroup.stdout.split('\n').some((row) => new RegExp(`^\\s*${group}\\s+`).test(row)), 'C1 did not answer with the recorded group before C2');
    const secondGroupStart = groupC3Failure && trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(secondGroupArgs) && sequence > firstGroup?.sequence);
    const secondGroup = groupC3Failure && trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && JSON.stringify(args) === JSON.stringify(secondGroupArgs) && sequence > secondGroupStart?.sequence);
    if (groupC3Failure) assert.ok(secondGroupStart && secondGroup && secondGroup.status === 0 && secondGroup.error === undefined && secondGroup.stderr === '' && secondGroup.stdout.split('\n').some((row) => new RegExp(`^\\s*${group}\\s+`).test(row)) && existsSync(join(directory, 'group-c2-answered')), 'C2 did not answer with the recorded group before C3');
    const priorStart = trace.find(({ kind, tool, args }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(priorArgs));
    const prior = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && JSON.stringify(args) === JSON.stringify(priorArgs) && sequence > priorStart?.sequence);
    assert.ok(priorStart && prior && (!groupC2Read || priorStart.sequence > (groupC3Failure ? secondGroup.sequence : firstGroup.sequence)), 'the group census did not start and close its forced read after the preceding answers');
    if (groupC1Failure) assert.ok(priorStart.remaining > 0 && prior.error === undefined && prior.status === 2 && prior.stdout === '' && prior.stderr === 'ps: forced group state failure\n', 'the C1 group state failure did not return its complete error');
    else if (groupC2Failure) assert.ok(priorStart.remaining > 0 && prior.error === undefined && prior.status === 2 && prior.stdout === '' && prior.stderr === 'ps: forced group command failure\n', 'the C2 group command failure did not return its complete error');
    else if (groupC3Failure) assert.ok(priorStart.remaining > 0 && prior.error === undefined && prior.status === 2 && prior.stdout === '' && prior.stderr === 'ps: forced group name failure\n', 'the C3 group name failure did not return its complete error');
    else assert.ok(priorStart.remaining > 0 && prior.error === 'ETIMEDOUT' && prior.status === null && prior.stdout === '' && prior.stderr === '', 'the prior group read did not time out after starting');
    assert.equal(existsSync(join(directory, 'd9-prior-entered')), true, 'the prior group ps stand-in never started');
    assert.deepEqual(readFileSync(join(directory, 'd9-prior-argv'), 'utf8').trimEnd().split('\n'), priorArgs, 'the cache-seeding group read had the wrong argv');
    const groupKill = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === -group && name === 'SIGKILL' && result === true && sequence > prior.sequence);
    const probe = trace.find(({ kind, target, name, sequence }) => kind === 'signal-answer' && target === -group && name === 0 && sequence > groupKill?.sequence);
    assert.ok(probe && ((probe.answer === false && probe.error === undefined) || (probe.answer === true && probe.error === undefined) || (probe.answer === undefined && probe.error === 'EPERM')), 'the first post-kill group probe did not report its reached E or O answer');
    if (groupC1Failure || groupC2Failure || groupC3Failure) {
      assert.equal(events.length, 2, 'the failed group read invented an extra forced-end event');
      assert.deepEqual(events.filter(({ event, group: id, pid: target, directory: at }) =>
        (event === 'group.killed' && id === group) ||
        (event === 'survivor.unended' && target === pid && at === work)), events,
      'the failed group read recorded an unobserved process');
    }
    if (groupC1Failure) {
      assert.deepEqual(trace.filter(({ kind, tool, sequence }) => kind === 'read-start' && tool === ps && sequence < groupKill.sequence).map(({ args }) => args), [firstGroupArgs], 'C2, C3, C4 or C5 spawned after the failed C1 before group kill');
      assert.deepEqual(events.filter(({ event: type, pid: target }) => type === 'survivor.killed' && target === group), [], 'the failed C1 invented a named group member');
      assert.deepEqual(events.filter(({ event: type, group: target }) => type === 'group.killed' && target === group).map(({ census }) => census), ['the process-table read failed: ps: forced group state failure'], 'the failed C1 lost its exact unnamed group reason');
      assert.ok(trace.some(({ kind, event: type, group: target, sequence }) => kind === 'event' && type === 'group.killed' && target === group && sequence > probe.sequence), 'the failed C1 group result did not follow its reached post-kill probe');
      return;
    }
    if (groupC2Failure) {
      assert.deepEqual(trace.filter(({ kind, tool, sequence }) => kind === 'read-start' && tool === ps && sequence < groupKill.sequence).map(({ args }) => args), [firstGroupArgs, priorArgs], 'C3, C4 or C5 spawned after the failed C2 before the group kill');
      assert.deepEqual(events.filter(({ event: type, pid: target }) => type === 'survivor.killed' && target === group), [], 'the failed C2 invented a named group member');
      assert.deepEqual(events.filter(({ event: type, group: target }) => type === 'group.killed' && target === group).map(({ census }) => census), ['the process-table read failed: ps: forced group command failure'], 'the failed C2 lost its exact unnamed group reason');
      assert.ok(trace.some(({ kind, event: type, group: target, sequence }) => kind === 'event' && type === 'group.killed' && target === group && sequence > probe.sequence), 'the failed C2 group result did not follow its reached post-kill probe');
      return;
    }
    if (groupC3Failure) {
      assert.deepEqual(trace.filter(({ kind, tool, sequence }) => kind === 'read-start' && tool === ps && sequence < groupKill.sequence).map(({ args }) => args), [firstGroupArgs, secondGroupArgs, priorArgs], 'C4 or C5 spawned after the failed C3 before group kill');
      assert.deepEqual(events.filter(({ event: type, pid: target }) => type === 'survivor.killed' && target === group), [], 'the failed C3 invented a named group member');
      assert.deepEqual(events.filter(({ event: type, group: target }) => type === 'group.killed' && target === group).map(({ census }) => census), ['the process-table read failed: ps: forced group name failure'], 'the failed C3 lost its exact unnamed group reason');
      assert.ok(trace.some(({ kind, event: type, group: target, sequence }) => kind === 'event' && type === 'group.killed' && target === group && sequence > probe.sequence), 'the failed C3 group result did not follow its reached post-kill probe');
      return;
    }
    const firstStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > groupKill?.sequence);
    const first = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > firstStart?.sequence);
    const refusal = trace.find(({ kind, target, name, error, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGSTOP' && error === 'EPERM' && sequence > first?.sequence);
    const event = trace.find(({ kind, event: type, pid: target, sequence }) => kind === 'event' && type === 'survivor.unended' && target === pid && sequence > refusal?.sequence);
    assert.ok(groupKill && firstStart && first && refusal && event, 'the timeout, group kill, answered directory listing, EPERM and PID result did not occur in order');
    assert.equal(first.status, 0, 'the directory listing did not answer after the group timeout');
    assert.equal(first.stdout, listingFields(pid, realpathSync.native(sub)), 'the directory listing did not return the refused fixture');
    assert.ok(first.error === undefined && first.stderr === '', 'the directory listing reported a failure instead of an answer');
    assert.ok(event.at >= firstStart.at && event.at - firstStart.at < CLEANUP_BOUND, 'the directory description could have been cut by its own deadline rather than the prior cache');
    assert.deepEqual(trace.filter(({ kind, tool }) => kind === 'read-start' && tool === ps).map(({ args }) => args), groupC2Read ? [firstGroupArgs, priorArgs] : [priorArgs], 'another ps spawned after the failed census read instead of retaining its error');
    assert.deepEqual(events.filter(({ pid: target }) => target === group), [], 'a group member with no complete census round was invented as a named result');
    assert.deepEqual(events.filter(({ event: type, directory: at }) => type === 'survivor.killed' && at === undefined), [], 'an unaccepted group member was invented as killed');
    assert.equal(existsSync(join(directory, 'd9-name-argv')), false, 'a name stand-in ran despite the cached refusal');
    assert.equal(existsSync(join(directory, 'd9-command-argv')), false, 'a command stand-in ran without a returned name');
    assert.deepEqual(events.filter(({ event: type, group: target }) => type === 'group.killed' && target === group).map(({ census }) => census), ['the process-table read timed out after 1000 ms'], 'the timed-out group census lost its reason or invented members');
    assert.deepEqual(directoryEvents.map(({ event: type, pid: target, name, cmd, reason }) => ({ event: type, pid: target, name, cmd, reason })), [
      { event: 'survivor.unended', pid, name: undefined, cmd: undefined, reason: 'EPERM' },
    ], 'the cached name refusal invented identity fields or lost the known PID and reason');
    assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP'], 'the refused PID received an invented signal');
    assert.ok(!d2HasEnded(outside) && startOf(pid) === outsideBirth.started, 'the refused fixture ended or changed identity before finalization');
    return;
  }
  if (heldRead) {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const pid = outsideBirth.pid;
    const firstListing = listingFields(pid, realpathSync.native(sub));
    const refusedListing = coListedRefusal ? listingFields(refusedBirth.pid, realpathSync.native(refusedSub)) : '';
    const firstStart = trace.find(({ kind, tool, args }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs));
    const first = trace.find(({ kind, tool, args, status, stdout, error }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && status === 0 && !error && stdout === firstListing + refusedListing);
    if (coListedRefusal) assert.ok(firstStart && first && first.sequence === firstStart.sequence + 1, 'the two-PID full listing did not start and return its exact answer in order');
    const stop = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGSTOP' && result === true && sequence > first?.sequence);
    if (coListedRefusal) {
      const forbidden = trace.find(({ kind, target, name, error, sequence }) => kind === 'signal-answer' && target === refusedBirth.pid && name === 'SIGSTOP' && error === 'EPERM' && sequence > first?.sequence);
      assert.ok(forbidden && forbidden.sequence > stop?.sequence, 'the co-listed PID did not answer EPERM after the other PID entered H');
      assert.equal(startOf(refusedBirth.pid), refusedBirth.started, 'the refused PID changed birth identity during the census');
    }
    const stateArgs = ['-p', String(pid), '-o', 'pid=,stat='];
    const stateStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'ps') && JSON.stringify(args) === JSON.stringify(stateArgs) && sequence > stop?.sequence);
    const stateEnd = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'ps') && JSON.stringify(args) === JSON.stringify(stateArgs) && sequence > stateStart?.sequence);
    assert.ok(first && stop && stateStart && stateEnd, 'the first listing, successful stop and intervening state read did not reach H in order');
    assert.equal(stateEnd.readId, stateStart.readId, 'the intervening state result did not close its started read');
    assert.equal(existsSync(join(directory, 'held-state-entered')), true, 'the chosen held-state read did not start');
    assert.deepEqual(readFileSync(join(directory, 'held-state-argv'), 'utf8').trimEnd().split('\n'), stateArgs, 'the held-state stand-in received the wrong argv');
    assert.match(readFileSync(join(directory, 'held-state-status'), 'utf8').trim(), /^T/, 'the directly owned PID was not stopped at the forced state read');
    if (heldZombie) {
      assert.equal(stateEnd.status, 0, 'the intervening zombie state did not answer');
      assert.equal(stateEnd.stdout, `${pid} Z\n`, 'the intervening state did not report the synthetic zombie row');
      assert.equal(stateEnd.stderr, '', 'the zombie state returned stderr');
      assert.equal(stateEnd.error, undefined, 'the zombie state timed out');
      const perPidArgs = [...firstArgs.slice(0, -2), '-p', String(pid), '-F', 'pun'];
      const omittedStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > stateEnd.sequence);
      const omitted = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > omittedStart?.sequence);
      assert.ok(omittedStart && omitted, 'the zombie answer did not reach the later per-PID listing');
      assert.deepEqual(readFileSync(join(directory, 'held-zombie-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the omitted listing did not target the held PID');
      assert.ok(omitted.status === 0 && omitted.stdout === '' && omitted.stderr === '' && !omitted.error, 'the per-PID omission was not an answered empty listing');
      const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > omitted.sequence);
      assert.ok(resumed, 'the answered zombie and per-PID omission did not resume H');
      const finalState = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'ps') && JSON.stringify(args) === JSON.stringify(stateArgs) && sequence > resumed.sequence);
      assert.ok(finalState && finalState.status === 0 && finalState.stdout === `${pid} S\n` && !finalState.error, 'the subsequent state did not answer live after H resumed');
      assert.equal(existsSync(join(directory, 'held-zombie-after-entered')), true, 'the later state did not reach its stand-in');
      const laterStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > finalState.sequence);
      const later = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > laterStart?.sequence);
      assert.ok(laterStart && later && later.status === 0 && later.stdout === '' && later.stderr === '' && !later.error, 'the later full listing did not answer empty after H resumed');
      assert.deepEqual(readFileSync(join(directory, 'held-zombie-later-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the later read was not full lsof');
      assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP', 'SIGCONT'], 'the zombie answer invented a named kill or repeated a signal');
      assert.deepEqual(directoryEvents, [], 'the zombie answer invented a directory or PID event');
      assert.equal(startOf(pid), outsideBirth.started, 'the resumed fixture changed birth identity');
      return;
    }
    if (heldOmitted) {
      assert.equal(stateEnd.status, 0, 'the intervening state did not answer before the omitted listing');
      assert.equal(stateEnd.stdout, `${pid} S\n`, 'the answered state did not leave H for the next listing');
      const omittedStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > stateEnd.sequence);
      const omitted = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > omittedStart?.sequence);
      assert.ok(omittedStart && omitted && omitted.readId === omittedStart.readId, 'the later full listing did not answer after H');
      assert.deepEqual(readFileSync(join(directory, 'held-omitted-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the omitted listing used the wrong argv');
      assert.equal(omitted.status, 0, 'the omitted listing failed instead of answering');
      assert.equal(omitted.stdout, '', 'the later full listing did not omit H');
      assert.equal(omitted.stderr, '', 'the omitted listing returned stderr');
      assert.equal(omitted.error, undefined, 'the omitted listing timed out');
      const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > omitted.sequence);
      assert.ok(resumed, 'the answered omission did not resume H');
      assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP', 'SIGCONT'], 'the omitted H received an invented kill');
      assert.deepEqual(directoryEvents, [], 'the omitted H invented a directory or PID event');
      assert.equal(startOf(pid), outsideBirth.started, 'the resumed fixture changed birth identity');
      return;
    }
    let failedRead = stateEnd;
    if (heldListing) {
      assert.equal(stateEnd.status, 0, 'the state answer did not let H reach the next loop');
      assert.equal(stateEnd.stdout, `${pid} S\n`, 'the state answer was not the forced non-stopped row');
      assert.equal(stateEnd.stderr, '', 'the state answer reported a failure');
      assert.equal(stateEnd.error, undefined, 'the state answer timed out');
      const laterStarts = trace.filter(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > stateEnd.sequence);
      assert.equal(laterStarts.length, 1, 'the failed second full listing did not start exactly once');
      const laterStart = laterStarts[0];
      const laterEnd = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > laterStart.sequence);
      assert.ok(laterEnd, 'the second full listing did not settle');
      assert.equal(laterEnd.readId, laterStart.readId, 'the second full-listing result did not close its started read');
      assert.equal(existsSync(join(directory, 'later-listing-entered')), true, 'the second full listing did not enter its stand-in');
      assert.deepEqual(readFileSync(join(directory, 'later-listing-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the second listing was not full lsof with exact argv');
      if (answer === 'LF' || answer === 'EHF') {
        assert.equal(laterEnd.status, 2, 'the later full-listing F did not return its plain failure');
        assert.equal(laterEnd.stdout, '', 'the later full-listing F returned an answered listing');
        assert.equal(laterEnd.stderr, 'lsof: forced later-listing failure\n', 'the later full-listing F lost its exact failure cause');
        assert.equal(laterEnd.error, undefined, 'the later full-listing F was a timeout or spawn error');
      } else {
        assert.ok(laterStart.remaining > 0, 'the later full-listing T was a pre-spawn deadline cut');
        assert.equal(laterEnd.error, 'ETIMEDOUT', 'the later full-listing T did not time out after starting');
        assert.equal(laterEnd.status, null, 'the later full-listing T returned an answered listing');
        assert.equal(laterEnd.stdout, '', 'the later full-listing T returned an answered listing');
        assert.equal(laterEnd.stderr, '', 'the later full-listing T reported a plain failure');
      }
      assert.equal(trace.some(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && args.includes('-p') && sequence > stateEnd.sequence), false, 'a per-PID listing started before the later full-listing failure');
      failedRead = laterEnd;
    } else if (heldPerPid) {
      assert.equal(startOf(pid), outsideBirth.started, 'the per-PID listing target changed birth identity');
      assert.equal(stateEnd.status, 0, 'the intervening state did not answer before the per-PID listing');
      assert.match(stateEnd.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the state answer did not show the held PID stopped');
      assert.equal(stateEnd.stderr, '', 'the intervening state returned stderr');
      assert.equal(stateEnd.error, undefined, 'the intervening state did not settle as an answer');
      const perPidArgs = [...firstArgs.slice(0, -2), '-p', String(pid), '-F', 'pun'];
      const perPidStarts = trace.filter(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > stateEnd.sequence);
      assert.equal(perPidStarts.length, 1, 'the held PID did not reach exactly one per-PID listing');
      const perPidStart = perPidStarts[0];
      const perPidEnd = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > perPidStart.sequence);
      assert.ok(perPidEnd, 'the held per-PID listing did not settle');
      assert.equal(perPidEnd.readId, perPidStart.readId, 'the per-PID result did not close its started read');
      assert.equal(existsSync(join(directory, 'per-pid-listing-entered')), true, 'the per-PID listing did not enter its stand-in');
      assert.deepEqual(readFileSync(join(directory, 'per-pid-listing-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the per-PID stand-in received the wrong target or argv');
      assert.equal(trace.some(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === join(directory, 'lsof') && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > stateEnd.sequence), false, 'a second full listing preceded the per-PID failure');
      if (answer === 'PF' || answer === 'EHPF') {
        assert.equal(perPidEnd.status, 2, 'the per-PID F did not return its plain failure');
        assert.equal(perPidEnd.stdout, '', 'the per-PID F returned an answered listing');
        assert.equal(perPidEnd.stderr, 'lsof: forced per-PID failure\n', 'the per-PID F lost its exact failure cause');
        assert.equal(perPidEnd.error, undefined, 'the per-PID F was a timeout or spawn error');
      } else {
        assert.ok(perPidStart.remaining > 0, 'the per-PID T was a pre-spawn deadline cut');
        assert.equal(perPidEnd.error, 'ETIMEDOUT', 'the per-PID T did not time out after starting');
        assert.equal(perPidEnd.status, null, 'the per-PID T returned an answered listing');
        assert.equal(perPidEnd.stdout, '', 'the per-PID T returned an answered listing');
        assert.equal(perPidEnd.stderr, '', 'the per-PID T reported a plain failure');
      }
      failedRead = perPidEnd;
    } else if (answer === 'SF' || answer === 'EHSF') {
      assert.equal(stateEnd.status, 2, 'the held-state F did not return its plain failure');
      assert.equal(stateEnd.stderr, 'ps: forced held-state failure\n', 'the held-state F lost its exact failure cause');
      assert.equal(stateEnd.error, undefined, 'the held-state F was a timeout or spawn error');
    } else {
      assert.equal(stateEnd.error, 'ETIMEDOUT', 'the held-state T did not time out after starting');
      assert.equal(stateEnd.status, null, 'the held-state T returned an answered state');
    }
    const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > failedRead.sequence);
    const unread = trace.find(({ kind, event, sequence }) => kind === 'event' && event === 'directory.unread' && sequence > resumed?.sequence);
    assert.ok(resumed && unread, 'the failed held read did not resume H before its directory.unread event');
    assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP', 'SIGCONT'], 'the held PID received an invented kill or failed resume');
    assert.deepEqual(directoryEvents.map(({ event, pid: named, killed }) => ({ event, pid: named, killed })), [{ event: 'directory.unread', pid: undefined, killed: undefined }], 'the held failure invented a named PID or kill');
    assert.equal(directoryEvents[0].census, answer === 'SF' || answer === 'EHSF' ? 'the process-table read failed: ps: forced held-state failure' : answer === 'LF' || answer === 'EHF' ? 'the process-table read failed: lsof: forced later-listing failure' : answer === 'PF' || answer === 'EHPF' ? 'the process-table read failed: lsof: forced per-PID failure' : 'the process-table read timed out after 1000 ms', 'the unread cause differs from the forced held read');
    assert.deepEqual(events.filter(({ pid: named }) => named === pid), [], 'the held PID acquired an invented named event');
    if (coListedRefusal) {
      assert.deepEqual(events.filter(({ pid: named }) => named === refusedBirth.pid), [], 'the EPERM PID acquired an invented described event before settlement');
      assert.deepEqual(pairs.filter(([target]) => target === refusedBirth.pid).map(([, signal]) => signal), ['SIGSTOP'], 'the refused PID received an invented signal after EPERM');
      assert.ok(!d2HasEnded(refused) && startOf(refusedBirth.pid) === refusedBirth.started, 'the unread result ended the EPERM fixture');
    }
    return;
  }
  if (ownedRead) {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const pid = outsideBirth.pid;
    const lsof = join(directory, 'lsof');
    const ps = join(directory, 'ps');
    const perPidArgs = [...firstArgs.slice(0, -2), '-p', String(pid), '-F', 'pun'];
    const stateArgs = ['-p', String(pid), '-o', 'pid=,stat='];
    const read = (tool, args, after = 0) => trace.find(({ kind, tool: path, args: given, sequence }) => kind === 'read-end' && path === tool && JSON.stringify(given) === JSON.stringify(args) && sequence > after);
    const first = read(lsof, firstArgs);
    const stop = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGSTOP' && result === true && sequence > first?.sequence);
    const before = read(ps, stateArgs, stop?.sequence);
    const second = read(lsof, perPidArgs, before?.sequence);
    const priorName = read(ps, ['-p', String(pid), '-o', 'ucomm='], second?.sequence);
    const priorCommand = read(ps, ['-ww', '-p', String(pid), '-o', 'pid=,command='], priorName?.sequence);
    const after = read(ps, stateArgs, priorCommand?.sequence);
    assert.ok(first && stop && before && second && priorName && priorCommand && after, 'the first round did not reach a twice-listed, stopped PID before the owned-state answer');
    const outsideListing = listingFields(pid, realpathSync.native(sub));
    const refusedListing = coListedRefusal ? listingFields(refusedBirth.pid, realpathSync.native(refusedSub)) : '';
    assert.equal(first.stdout, outsideListing + refusedListing, 'the first full listing did not name the recorded fixtures');
    if (coListedRefusal) {
      const forbidden = trace.find(({ kind, target, name, error, sequence }) => kind === 'signal-answer' && target === refusedBirth.pid && name === 'SIGSTOP' && error === 'EPERM' && sequence > stop.sequence);
      assert.ok(forbidden && forbidden.sequence < before.sequence, 'the co-listed PID did not answer EPERM before O was confirmed');
      assert.equal(startOf(refusedBirth.pid), refusedBirth.started, 'the refused PID changed birth identity during the census');
    }
    assert.match(before.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the PID was not H before its second listing');
    assert.equal(second.status, 0, 'the owned PID was not listed a second time');
    assert.equal(second.stdout, outsideListing, 'the second listing did not again name the stopped PID in its directory');
    assert.ok(priorName.status === 0 && priorName.stdout.trim() && priorCommand.status === 0 && priorCommand.stdout.includes(String(pid)), 'the owned round did not answer its name and command reads');
    assert.deepEqual(readFileSync(join(directory, 'owned-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the second listing did not target the owned PID');
    assert.match(readFileSync(join(directory, 'owned-state-actual'), 'utf8').trim(), /^T/, 'the fixture was not actually stopped at its final-state read');
    assert.equal(after.stdout, `${pid} S\n`, 'the answered final state did not retain the twice-listed PID for another round');
    assert.equal(after.status, 0, 'the final state did not answer');
    assert.equal(after.error, undefined, 'the final-state answer timed out');
    assert.equal(trace.some(({ kind, target, name, sequence }) => kind === 'signal-start' && target === pid && name === 'SIGCONT' && sequence < after.sequence), false, 'the PID left H before the owned-state answer');
    assert.equal(startOf(pid), outsideBirth.started, 'the owned PID changed birth identity before its later read');
    const laterStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > after.sequence);
    const later = read(lsof, firstArgs, laterStart?.sequence);
    assert.ok(laterStart && later, 'the owned PID did not reach a later full lsof');
    assert.equal(trace.filter(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > after.sequence).length, ownedLive || ownedZombie ? 3 : ownedOmitted ? 2 : 1, 'the owned path started an unexpected number of later full listings');
    assert.equal(existsSync(join(directory, 'owned-later-entered')), true, 'the later full lsof did not start its stand-in');
    assert.deepEqual(readFileSync(join(directory, 'owned-later-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the later read was not a full lsof');
    if (ownedLive || ownedZombie) {
      assert.ok(later.status === 0 && later.stdout === first.stdout && later.stderr === '' && !later.error, 'the later full listing did not retain the owned PID');
      const nextState = read(ps, stateArgs, later.sequence);
      assert.ok(nextState && nextState.status === 0 && nextState.stdout === `${pid} ${ownedZombie ? 'Z' : 'S'}\n` && nextState.stderr === '' && !nextState.error, 'the intervening state did not answer the chosen O row');
      assert.deepEqual(readFileSync(join(directory, 'owned-next-state-argv'), 'utf8').trimEnd().split('\n'), stateArgs, 'the answered O state targeted the wrong PID');
      assert.match(readFileSync(join(directory, 'owned-next-state-actual'), 'utf8').trim(), /^T/, 'the directly owned fixture was not stopped at the synthetic answered state');
      let retryAfter = nextState.sequence;
      if (ownedZombie) {
        const zombiePerPid = read(lsof, perPidArgs, nextState.sequence);
        const zombieName = read(ps, ['-p', String(pid), '-o', 'ucomm='], zombiePerPid?.sequence);
        const zombieCommand = read(ps, ['-ww', '-p', String(pid), '-o', 'pid=,command='], zombieName?.sequence);
        const zombieAfter = read(ps, stateArgs, zombieCommand?.sequence);
        assert.ok(zombiePerPid && zombieName && zombieCommand && zombieAfter, 'the answered Z row did not reach its later per-PID, identity and final-state reads');
        assert.deepEqual(readFileSync(join(directory, 'owned-zombie-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the zombie per-PID read targeted the wrong identity');
        assert.ok(zombiePerPid.status === 0 && zombiePerPid.stdout === '' && zombiePerPid.stderr === '' && !zombiePerPid.error, 'the zombie per-PID read did not answer an omission');
        assert.ok(zombieName.status === 0 && !zombieName.error && zombieCommand.status === 0 && !zombieCommand.error, 'the reached zombie identity reads did not answer');
        assert.ok(zombieAfter.status === 0 && zombieAfter.stdout === `${pid} S\n` && !zombieAfter.error, 'the zombie round did not answer a non-stopped final state');
        assert.equal(existsSync(join(directory, 'owned-zombie-after-entered')), true, 'the zombie final state did not reach its stand-in');
        retryAfter = zombieAfter.sequence;
      }
      const retryFull = read(lsof, firstArgs, retryAfter);
      const retryStop = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGSTOP' && result === true && sequence > retryFull?.sequence);
      const retryBefore = read(ps, stateArgs, retryStop?.sequence);
      const retryPerPid = read(lsof, perPidArgs, retryBefore?.sequence);
      const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > retryPerPid?.sequence);
      const finished = read(lsof, firstArgs, resumed?.sequence);
      assert.ok(retryFull && retryStop && retryBefore && retryPerPid && resumed && finished, 'the live O did not retry as H, omit it and resume it in order');
      assert.ok(retryFull.status === 0 && retryFull.stdout === first.stdout && !retryFull.error, 'the retry did not answer with the same recorded PID');
      assert.match(retryBefore.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the retried H was not stopped at its intervening state read');
      assert.ok(retryBefore.status === 0 && !retryBefore.error && retryPerPid.status === 0 && retryPerPid.stdout === '' && retryPerPid.stderr === '' && !retryPerPid.error, 'the retry did not answer its state and empty per-PID listing');
      assert.ok(finished.status === 0 && finished.stdout === '' && finished.stderr === '' && !finished.error, 'the final full listing did not answer empty after H resumed');
      assert.deepEqual(readFileSync(join(directory, 'owned-retry-full-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the retry was not a full listing');
      assert.deepEqual(readFileSync(join(directory, 'owned-retry-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the retry omission did not target the owned PID');
      assert.deepEqual(readFileSync(join(directory, 'owned-finished-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the final answer was not a full listing');
      assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP', 'SIGSTOP', 'SIGCONT'], 'the live answer invented a kill or failed to resume the retried H');
      assert.deepEqual(directoryEvents, [], 'the live answer invented a directory or named PID event');
      assert.equal(startOf(pid), outsideBirth.started, 'the resumed fixture changed birth identity');
      return;
    }
    if (ownedOmitted) {
      assert.equal(later.readId, laterStart.readId, 'the omitted full-listing result did not close its started read');
      assert.equal(later.status, 0, 'the later full listing did not answer');
      assert.equal(later.stdout, '', 'the later full listing did not omit O');
      assert.equal(later.stderr, '', 'the later full listing returned stderr');
      assert.equal(later.error, undefined, 'the omitted full listing timed out');
      const nextState = read(ps, stateArgs, later.sequence);
      const nextPerPid = read(lsof, perPidArgs, nextState?.sequence);
      const nextName = read(ps, ['-p', String(pid), '-o', 'ucomm='], nextPerPid?.sequence);
      const nextCommand = read(ps, ['-ww', '-p', String(pid), '-o', 'pid=,command='], nextName?.sequence);
      const finalState = read(ps, stateArgs, nextCommand?.sequence);
      assert.ok(nextState && nextPerPid && nextName && nextCommand && finalState, 'the omitted O did not reach the retry reads');
      assert.match(nextState.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the answered retry state did not retain O');
      assert.equal(nextState.status, 0, 'the retry state did not answer');
      assert.deepEqual(readFileSync(join(directory, 'owned-next-state-argv'), 'utf8').trimEnd().split('\n'), stateArgs, 'the retry state targeted the wrong PID');
      assert.equal(nextPerPid.status, 0, 'the retry per-PID listing did not answer');
      assert.equal(nextPerPid.stdout, first.stdout, 'the retry per-PID listing did not independently find O');
      assert.deepEqual(readFileSync(join(directory, 'owned-next-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the retry listing targeted the wrong PID');
      assert.ok(nextName.status === 0 && nextName.stdout.trim() && nextCommand.status === 0 && nextCommand.stdout.includes(String(pid)), 'the retry did not answer the name and command reads');
      assert.match(finalState.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the retry final state did not answer stopped');
      const kill = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGKILL' && result === true && sequence > finalState.sequence);
      const observedAfterKill = read(ps, stateArgs, kill?.sequence);
      const afterKillStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > observedAfterKill?.sequence);
      const afterKill = read(lsof, firstArgs, afterKillStart?.sequence);
      const postKill = read(ps, stateArgs, afterKill?.sequence);
      const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > postKill?.sequence);
      assert.ok(kill && observedAfterKill && afterKillStart && afterKill && postKill && resumed, 'the retained O did not kill, answer its post-kill reads and resume its surviving PID');
      assert.ok(observedAfterKill.sequence < afterKillStart.sequence && afterKill.sequence < postKill.sequence && afterKill.readId === afterKillStart.readId && afterKill.status === 0 && afterKill.stdout === '' && afterKill.stderr === '' && !afterKill.error, 'the post-kill full listing did not answer empty between the state reads');
      assert.ok(observedAfterKill.status === 0 && !observedAfterKill.error && postKill.status === 0 && !postKill.error, 'the post-kill state reads were not answered results');
      assert.equal(trace.some(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === ps && sequence > kill.sequence && (JSON.stringify(args) === JSON.stringify(['-p', String(pid), '-o', 'ucomm=']) || JSON.stringify(args) === JSON.stringify(['-ww', '-p', String(pid), '-o', 'pid=,command=']))), false, 'the named kill invented a post-kill identity read');
      assert.match(postKill.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the post-kill read did not answer alive');
      assert.equal(existsSync(join(directory, 'owned-after-kill-entered')), true, 'the sweep did not answer its later empty listing');
      assert.deepEqual(pairs.filter(([target, signal]) => target === pid && signal !== 0).map(([, signal]) => signal), ['SIGSTOP', 'SIGKILL', 'SIGCONT'], 'the retained O received an invented or repeated signal');
      assert.deepEqual(events.map(({ event, pid: named, directory: at }) => ({ event, owned: named === pid, command: named === group, directory: at === work })), [{ event: 'survivor.killed', owned: false, command: true, directory: false }, { event: 'survivor.unended', owned: true, command: false, directory: true }], 'the omission invented an unread or PID event');
      assert.deepEqual(directoryEvents.map(({ event }) => event), ['survivor.unended'], 'the directory omission invented an event');
      assert.ok(directoryEvents[0].name === nextName.stdout.trim() && nextCommand.stdout.trim().endsWith(directoryEvents[0].cmd), 'the unended result did not use the answered pre-kill identity');
      assert.match(directoryEvents[0].reason, /^still alive (?:when L0's read bound ran out after its kill|1000 ms after L0's kill)$/, 'the unended reason did not follow the post-kill read');
      return;
    }
    let failedRead;
    let unreadCause;
    if (ownedListing) {
      failedRead = later;
      unreadCause = answer === 'OF' || answer === 'EOF' ? 'the process-table read failed: lsof: forced owned-listing failure' : 'the process-table read timed out after 1000 ms';
      if (answer === 'OF' || answer === 'EOF') {
        assert.equal(later.status, 2, 'the owned later-listing F did not return its failure');
        assert.equal(later.stderr, 'lsof: forced owned-listing failure\n', 'the owned later-listing F lost its exact cause');
        assert.equal(later.error, undefined, 'the owned later-listing F timed out');
      } else {
        assert.ok(laterStart.remaining > 0, 'the owned later-listing T was a pre-spawn cut');
        assert.equal(later.error, 'ETIMEDOUT', 'the owned later-listing T did not time out after starting');
        assert.equal(later.status, null, 'the owned later-listing T returned an answer');
      }
    } else {
      assert.equal(later.status, 0, 'the later full listing did not answer before the chosen owned read');
      assert.equal(later.stdout, coListedRefusal ? outsideListing : first.stdout, 'the later full listing did not retain the owned PID');
      assert.equal(later.stderr, '', 'the later full listing returned stderr');
      assert.equal(later.error, undefined, 'the later full listing was not an answered read');
      assert.equal(existsSync(join(directory, 'owned-later-full-answered')), true, 'the later full listing did not mark its answer');
      const nextStateStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(stateArgs) && sequence > later.sequence);
      const nextState = read(ps, stateArgs, nextStateStart?.sequence);
      assert.ok(nextStateStart && nextState, 'the owned PID did not reach its next intervening state read');
      assert.equal(existsSync(join(directory, 'owned-next-state-entered')), true, 'the next state read did not enter its stand-in');
      assert.deepEqual(readFileSync(join(directory, 'owned-next-state-argv'), 'utf8').trimEnd().split('\n'), stateArgs, 'the next state read used the wrong PID or argv');
      assert.match(readFileSync(join(directory, 'owned-next-state-actual'), 'utf8').trim(), /^T/, 'the owned PID was not still stopped at the chosen state read');
      if (ownedState) {
        failedRead = nextState;
        unreadCause = answer === 'OSF' || answer === 'EOSF' ? 'the process-table read failed: ps: forced owned-state failure' : 'the process-table read timed out after 1000 ms';
        if (answer === 'OSF' || answer === 'EOSF') {
          assert.equal(nextState.status, 2, 'the owned state F did not return a plain failure');
          assert.equal(nextState.stdout, '', 'the owned state F returned an answered state');
          assert.equal(nextState.stderr, 'ps: forced owned-state failure\n', 'the owned state F lost its exact cause');
          assert.equal(nextState.error, undefined, 'the owned state F timed out');
        } else {
          assert.ok(nextStateStart.remaining > 0, 'the owned state T was a pre-spawn cut');
          assert.equal(nextState.error, 'ETIMEDOUT', 'the owned state T did not time out after starting');
          assert.equal(nextState.status, null, 'the owned state T returned an answer');
          assert.equal(nextState.stdout, '', 'the owned state T returned an answered state');
          assert.equal(nextState.stderr, '', 'the owned state T returned a plain failure');
        }
        assert.equal(trace.some(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > nextState.sequence), false, 'a per-PID listing began after the failed owned state');
      } else {
        assert.equal(nextState.status, 0, 'the intervening state did not answer before the owned per-PID read');
        assert.match(nextState.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the intervening state did not retain the stopped owned PID');
        assert.equal(nextState.stderr, '', 'the intervening state returned stderr');
        assert.equal(nextState.error, undefined, 'the intervening state timed out');
        const nextPerPidStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(perPidArgs) && sequence > nextState.sequence);
        const nextPerPid = read(lsof, perPidArgs, nextPerPidStart?.sequence);
        assert.ok(nextPerPidStart && nextPerPid, 'the owned PID did not reach its later per-PID listing');
        assert.equal(existsSync(join(directory, 'owned-next-per-pid-entered')), true, 'the later per-PID listing did not start its stand-in');
        assert.deepEqual(readFileSync(join(directory, 'owned-next-per-pid-argv'), 'utf8').trimEnd().split('\n'), perPidArgs, 'the failed per-PID read used the wrong target or argv');
        failedRead = nextPerPid;
        unreadCause = answer === 'OPF' || answer === 'EOPF' ? 'the process-table read failed: lsof: forced owned-per-PID failure' : 'the process-table read timed out after 1000 ms';
        if (answer === 'OPF' || answer === 'EOPF') {
          assert.equal(nextPerPid.status, 2, 'the owned per-PID F did not return a plain failure');
          assert.equal(nextPerPid.stdout, '', 'the owned per-PID F returned an answered listing');
          assert.equal(nextPerPid.stderr, 'lsof: forced owned-per-PID failure\n', 'the owned per-PID F lost its exact cause');
          assert.equal(nextPerPid.error, undefined, 'the owned per-PID F timed out');
        } else {
          assert.ok(nextPerPidStart.remaining > 0, 'the owned per-PID T was a pre-spawn cut');
          assert.equal(nextPerPid.error, 'ETIMEDOUT', 'the owned per-PID T did not time out after starting');
          assert.equal(nextPerPid.status, null, 'the owned per-PID T returned an answer');
          assert.equal(nextPerPid.stdout, '', 'the owned per-PID T returned an answered listing');
          assert.equal(nextPerPid.stderr, '', 'the owned per-PID T returned a plain failure');
        }
      }
    }
    assert.equal(trace.some(({ kind, target, name, sequence }) => kind === 'signal-start' && target === pid && name === 'SIGCONT' && sequence > after.sequence && sequence < failedRead.sequence), false, 'the owned PID was resumed before the failed read');
    const kill = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGKILL' && result === true && sequence > failedRead.sequence);
    const freshName = read(ps, ['-p', String(pid), '-o', 'ucomm='], kill?.sequence);
    const freshCommand = read(ps, ['-ww', '-p', String(pid), '-o', 'pid=,command='], freshName?.sequence);
    const postKill = read(ps, stateArgs, freshCommand?.sequence);
    const resumed = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGCONT' && result === true && sequence > postKill?.sequence);
    assert.ok(kill && freshName && freshCommand && postKill && resumed, 'the owned unread path did not kill, reread and resume the surviving PID in order');
    assert.ok(freshName.status === 0 && !freshName.error && freshCommand.status === 0 && !freshCommand.error && postKill.status === 0 && !postKill.error, 'the post-kill reads were not answered results');
    assert.equal(freshName.stdout, 'fresh-owned-name\n', 'the post-kill name did not come from its fresh read');
    assert.equal(freshCommand.stdout, `${pid} fresh-owned-command\n`, 'the post-kill command did not come from its fresh read');
    assert.notEqual(priorName.stdout.trim(), freshName.stdout.trim(), 'the old name was not distinguishable from the post-kill read');
    assert.match(postKill.stdout, new RegExp(`^\\s*${pid}\\s+T`, 'm'), 'the post-kill read did not find the unchanged PID alive');
    assert.deepEqual(pairs.filter(([target, signal]) => target === pid && signal !== 0).map(([, signal]) => signal), ['SIGSTOP', 'SIGKILL', 'SIGCONT'], 'the O path sent an invented or repeated signal');
    assert.deepEqual(directoryEvents.map(({ event }) => event), ['directory.unread', 'survivor.unended'], 'the O failure did not report unread and unended separately');
    assert.equal(directoryEvents[0].census, unreadCause, 'the unread cause differs from the failed O read');
    assert.equal(directoryEvents[0].killed, undefined, 'the unended PID was incorrectly recorded as killed');
    assert.deepEqual({ pid: directoryEvents[1].pid, name: directoryEvents[1].name, cmd: directoryEvents[1].cmd }, { pid, name: 'fresh-owned-name', cmd: 'fresh-owned-command' }, 'the unended result invented or reused an old name');
    assert.match(directoryEvents[1].reason, /^still alive (?:when L0's read bound ran out after its kill|1000 ms after L0's kill)$/, 'the post-kill unended reason did not follow the read');
    if (coListedRefusal) {
      assert.deepEqual(events.filter(({ pid: named }) => named === refusedBirth.pid), [], 'the EPERM PID acquired an invented described event before settlement');
      assert.deepEqual(pairs.filter(([target]) => target === refusedBirth.pid).map(([, signal]) => signal), ['SIGSTOP'], 'the refused PID received an invented signal after EPERM');
      assert.ok(!d2HasEnded(refused) && startOf(refusedBirth.pid) === refusedBirth.started, 'the unread result ended the EPERM fixture');
    }
    assert.equal(trace.some(({ kind, event, sequence }) => kind === 'event' && event === 'directory.unread' && sequence > resumed.sequence), true, 'the unread event preceded the post-kill disposition');
    return;
  }
  if (d9Read) {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const lsof = join(directory, 'lsof');
    const ps = join(directory, 'ps');
    const pid = outsideBirth.pid;
    const firstStart = trace.find(({ kind, tool, args }) => kind === 'read-start' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs));
    const first = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === lsof && JSON.stringify(args) === JSON.stringify(firstArgs) && sequence > firstStart?.sequence);
    const refusal = trace.find(({ kind, target, name, error, sequence }) => kind === 'signal-answer' && target === pid && name === 'SIGSTOP' && error === 'EPERM' && sequence > first?.sequence);
    const nameArgs = ['-p', String(pid), '-o', 'ucomm='];
    const nameStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(nameArgs) && sequence > refusal?.sequence);
    const name = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && JSON.stringify(args) === JSON.stringify(nameArgs) && sequence > nameStart?.sequence);
    const commandArgs = ['-ww', '-p', String(pid), '-o', 'pid=,command='];
    const commandStart = trace.find(({ kind, tool, args, sequence }) => kind === 'read-start' && tool === ps && JSON.stringify(args) === JSON.stringify(commandArgs) && sequence > name?.sequence);
    const command = trace.find(({ kind, tool, args, sequence }) => kind === 'read-end' && tool === ps && JSON.stringify(args) === JSON.stringify(commandArgs) && sequence > commandStart?.sequence);
    const failedName = answer === 'D9NF' || answer === 'D9NT';
    const event = trace.find(({ kind, event: type, pid: target, sequence }) => kind === 'event' && type === 'survivor.unended' && target === pid && sequence > (failedName ? name?.sequence : command?.sequence));
    assert.ok(firstStart && first && refusal && nameStart && name && event && (failedName || (commandStart && command)), 'the EPERM name-first description was not reached in order');
    assert.equal(first.readId, firstStart.readId, 'the initial full listing did not close its started read');
    assert.equal(first.status, 0, 'the initial listing did not answer');
    assert.equal(first.stdout, listingFields(pid, realpathSync.native(sub)), 'the initial listing did not return the owned fixture');
    assert.equal(name.readId, nameStart.readId, 'the name read did not close its started read');
    assert.deepEqual(readFileSync(join(directory, 'd9-name-argv'), 'utf8').trimEnd().split('\n'), nameArgs, 'the name read used the wrong argv');
    if (failedName) {
      if (answer === 'D9NF') {
        assert.equal(name.status, 2, 'the name F did not return its plain failure');
        assert.equal(name.stderr, 'ps: forced name failure\n', 'the name F lost its exact failure cause');
        assert.equal(name.error, undefined, 'the name F was a timeout or spawn error');
      } else {
        assert.ok(nameStart.remaining > 0, 'the name T was a pre-spawn deadline cut');
        assert.equal(name.status, null, 'the name T returned an answered result');
        assert.equal(name.stderr, '', 'the name T reported a plain failure');
        assert.equal(name.error, 'ETIMEDOUT', 'the started name read did not time out');
      }
      assert.equal(name.stdout, '', 'the failed name read returned an answered name');
      assert.equal(commandStart, undefined, 'a command read started after the failed name read');
      assert.equal(existsSync(join(directory, 'd9-command-argv')), false, 'a command stand-in ran after the failed name read');
      assert.deepEqual(directoryEvents.map(({ event: type, pid: target, name: shown, cmd, reason }) => ({ event: type, pid: target, name: shown, cmd, reason })), [
        { event: 'survivor.unended', pid, name: undefined, cmd: undefined, reason: 'EPERM' },
      ], 'the failed name read invented an identity or lost the known PID and reason');
      assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP'], 'the EPERM PID received an invented signal');
      assert.ok(!d2HasEnded(outside) && startOf(pid) === outsideBirth.started, 'the EPERM fixture ended or changed identity before finalization');
      return;
    }
    assert.equal(command.readId, commandStart.readId, 'the command read did not close its started read');
    assert.deepEqual(readFileSync(join(directory, 'd9-command-argv'), 'utf8').trimEnd().split('\n'), commandArgs, 'the command read used the wrong argv');
    assert.equal(name.status, 0, 'the nonempty name did not answer');
    assert.equal(name.stdout, answer === 'D9EC' ? '' : 'returned-name\n', 'the EPERM name differed from the returned text');
    assert.equal(name.stderr, '', 'the EPERM name read returned stderr');
    assert.equal(name.error, undefined, 'the EPERM name read timed out');
    if (answer === 'D9CF' || answer === 'D9CT') {
      if (answer === 'D9CF') {
        assert.equal(command.status, 2, 'the command F did not return its plain failure');
        assert.equal(command.stderr, 'ps: forced command failure\n', 'the command F lost its exact failure cause');
        assert.equal(command.error, undefined, 'the command F was a timeout or spawn error');
      } else {
        assert.ok(commandStart.remaining > 0, 'the command T was a pre-spawn deadline cut');
        assert.equal(command.status, null, 'the command T returned an answered result');
        assert.equal(command.stderr, '', 'the command T reported a plain failure');
        assert.equal(command.error, 'ETIMEDOUT', 'the started command read did not time out');
        assert.equal(existsSync(join(directory, 'd9-command-entered')), true, 'the command T did not start the stand-in');
      }
      assert.equal(command.stdout, '', 'the failed command read returned an answered command');
      assert.deepEqual(directoryEvents.map(({ event: type, pid: target, name: shown, cmd, reason }) => ({ event: type, pid: target, name: shown, cmd, reason })), [
        { event: 'survivor.unended', pid, name: undefined, cmd: undefined, reason: 'EPERM' },
      ], 'the failed command read retained a partial identity or lost the known PID and reason');
      assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP'], 'the EPERM PID received an invented signal');
      assert.ok(!d2HasEnded(outside) && startOf(pid) === outsideBirth.started, 'the EPERM fixture ended or changed identity before finalization');
      return;
    }
    assert.equal(command.status, 0, 'the omitted command read did not answer');
    assert.equal(command.stdout, answer === 'D9EC' ? `${pid} returned-command\n` : '', 'the command read differed from its returned PID row');
    assert.equal(command.stderr, '', 'the omitted command read returned stderr');
    assert.equal(command.error, undefined, 'the omitted command read timed out');
    assert.deepEqual(directoryEvents.map(({ event: type, pid: target, name: shown, cmd, reason }) => ({ event: type, pid: target, name: shown, cmd, reason })), [
      { event: 'survivor.unended', pid, name: answer === 'D9EC' ? undefined : 'returned-name', cmd: answer === 'D9EC' ? 'returned-command' : undefined, reason: 'EPERM' },
    ], 'the EPERM result invented or lost a returned identity field');
    assert.deepEqual(pairs.filter(([target]) => target === pid).map(([, signal]) => signal), ['SIGSTOP'], 'the EPERM PID received an invented signal');
    assert.ok(!d2HasEnded(outside) && startOf(pid) === outsideBirth.started, 'the EPERM fixture ended or changed identity before finalization');
    return;
  }
  if (answer === 'A') {
    const trace = linesOf(directory, 'control.trace.jsonl');
    const read = (tool, args, after = 0) => trace.find(({ kind, tool: path, args: given, sequence, status, error }) => kind === 'read-end' && path === tool && JSON.stringify(given) === JSON.stringify(args) && sequence > after && status === 0 && !error);
    const lsof = join(directory, 'lsof');
    const ps = join(directory, 'ps');
    const first = read(lsof, firstArgs);
    const expectedListing = listingFields(outsideBirth.pid, realpathSync.native(sub));
    assert.ok(first && first.stdout === expectedListing, 'the first full lsof did not answer with the directly owned PID and cwd');
    const stop = trace.find(({ kind, target, name, answer: result, sequence }) => kind === 'signal-answer' && target === outsideBirth.pid && name === 'SIGSTOP' && result === true && sequence > first.sequence);
    assert.ok(stop, 'the answered first listing did not successfully stop the recorded PID');
    const stateArgs = ['-p', String(outsideBirth.pid), '-o', 'pid=,stat='];
    const before = read(ps, stateArgs, stop.sequence);
    assert.ok(before && new RegExp(`^\\s*${outsideBirth.pid}\\s+T`, 'm').test(before.stdout), 'the first state read did not answer with the held PID');
    const second = read(lsof, [...firstArgs.slice(0, -2), '-p', String(outsideBirth.pid), '-F', 'pun'], before.sequence);
    assert.ok(second && second.stdout === expectedListing, 'the held PID was not listed again in its directory');
    const name = read(ps, ['-p', String(outsideBirth.pid), '-o', 'ucomm='], second.sequence);
    const command = read(ps, ['-ww', '-p', String(outsideBirth.pid), '-o', 'pid=,command='], name?.sequence);
    const after = read(ps, stateArgs, command?.sequence);
    const returnedCommand = command?.stdout.match(new RegExp(`^\\s*${outsideBirth.pid} (.+)$`, 'm'))?.[1];
    assert.ok(name && name.stdout.trim() && command && returnedCommand && after && new RegExp(`^\\s*${outsideBirth.pid}\\s+T`, 'm').test(after.stdout), 'the held PID had no answered name, command and final stopped state');
    const kill = trace.find(({ kind, target, name: signal, answer: result, sequence }) => kind === 'signal-answer' && target === outsideBirth.pid && signal === 'SIGKILL' && result === true && sequence > after.sequence);
    assert.ok(kill, 'the twice-listed held PID did not enter the owned kill path');
    assert.deepEqual(pairs.filter(([target]) => target === outsideBirth.pid).map(([, signal]) => signal), ['SIGSTOP', 'SIGKILL'], 'the held PID received an unproved or duplicate signal');
    assert.deepEqual(directoryEvents.map(({ event, pid, name: shownName, cmd, reason }) => ({ event, pid, name: shownName, cmd, reason })), [
      { event: 'survivor.killed', pid: outsideBirth.pid, name: name.stdout.trim(), cmd: returnedCommand, reason: undefined },
    ], 'the answered H-to-O path did not emit one truthful named kill');
    assert.ok(trace.some(({ kind, event, pid, sequence }) => kind === 'event' && event === 'survivor.killed' && pid === outsideBirth.pid && sequence > kill.sequence), 'the product event did not follow the recorded kill');
    assert.equal(existsSync(join(directory, 'census-clock-cut')), false, 'the answered H-to-O control cut the clock');
    return;
  }
  assert.deepEqual(directoryEvents.map(({ event, pid, killed }) => ({ event, pid, killed })), [
    { event: 'directory.unread', pid: undefined, killed: undefined },
  ], 'the first unread listing invented or duplicated a directory/PID result');
  const reason = answer === 'F' ? 'the process-table read failed: lsof: forced first-listing failure' : 'the reads of the process table did not finish within 1000 ms';
  assert.equal(directoryEvents[0].census, reason, 'the unread reason differs from the forced first-listing result');
  assert.deepEqual(events.filter(({ pid }) => pid === outsideBirth.pid), [], 'the N fixture acquired an invented named event');
  assert.equal(pairs.some(([target]) => target === outsideBirth.pid), false, 'the N fixture acquired an invented PID signal');
  assert.ok(!d2HasEnded(outside) && startOf(outsideBirth.pid) === outsideBirth.started, 'the first-listing result ended the outside fixture');
  if (answer === 'F') {
    assert.equal(existsSync(join(directory, 'first-listing-entered')), true, 'the first full lsof F was not reached');
    assert.deepEqual(readFileSync(join(directory, 'first-listing-argv'), 'utf8').trimEnd().split('\n'), firstArgs, 'the failed read was not the first full lsof with exact argv');
    assert.equal(existsSync(join(directory, 'census-clock-cut')), false, 'the F control cut the clock');
  } else {
    assert.equal(existsSync(join(directory, 'census-clock-cut')), true, 'the first full lsof T did not reach the bound cut');
    assert.equal(existsSync(join(directory, 'first-listing-entered')), false, 'the pre-spawn T actually started lsof');
  }
}

// proves R-STATE-9, R-STATE-26
test('C615 G6 first kill followed by an empty group probe starts no post-kill read', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'G6');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D2 first full lsof F records an unread directory without a named PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'F');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D2 first full lsof pre-spawn T records an unread directory without a named PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'T');
});

// proves R-STATE-9, R-STATE-26
test('C615 D3 answered first listing stops, confirms and kills its recorded directory PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'A');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID state F resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'SF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID state T resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'ST');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID later full lsof F resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'LF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID later full lsof T resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'LT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID per-PID lsof F resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'PF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D4 held directory PID per-PID lsof T resumes without a named kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'PT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID later full lsof F kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID later full lsof T kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID state F kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OSF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID state T kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OST');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID per-PID lsof F kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OPF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D5 owned directory PID per-PID lsof T kills unnamed and rereads unended', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OPT');
});

// proves R-STATE-9, R-STATE-26
test('C615 D6 answered later full lsof omits H and resumes it without an event', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'HO');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D6 answered later full lsof omits O but a per-PID answer retains it', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OO');
});

// proves R-STATE-9, R-STATE-26
test('C615 D6 answered zombie state and per-PID omission resume H without a named event', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'HZ');
});

// proves R-STATE-9, R-STATE-26
test('C615 D6 answered live state retries O as H without a named event', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OLS');
});

// proves R-STATE-9, R-STATE-26
test('C615 D6 answered zombie state retries O as H without a named event', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'OZ');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H later full lsof F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H later full lsof T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H intervening ps state F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHSF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H intervening ps state T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHST');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H per-PID lsof F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHPF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and H per-PID lsof T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EHPT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O later full lsof F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O later full lsof T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O intervening ps state F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOSF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O intervening ps state T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOST');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O per-PID lsof F report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOPF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D8 co-listed EPERM and O per-PID lsof T report unread without describing the refused PID', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'EOPT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM with a returned name and omitted command row keeps only the known identity', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9NO');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM with empty name and returned command row keeps only the known identity', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9EC');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM name F leaves only PID and reason without a command read', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9NF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM name T leaves only PID and reason without a command read', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9NT');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM name U after group timeout spawns no description read', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9NU');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 G2 no-last C2 started timeout records only the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'G2C2T');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 G4 no-last C2 command failure records only the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'G4C2F');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 G4 no-last C1 state failure records only the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'G4C1F');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 G4 no-last C3 first name failure records only the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'G4C3F');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM command F after returned name keeps only PID and reason', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9CF');
});

// proves R-STATE-19, R-STATE-9, R-STATE-26
test('C615 D9 EPERM command T after returned name keeps only PID and reason', SETTLES_WITHIN, async (t) => {
  await firstDirectoryListing(t, 'D9CT');
});

/** Cuts a named read after a complete unseen round, with or without an accepted earlier round. */
async function groupPhaseCut(t, phase, accepted) {
  const outer = sightingEvidenceRoot();
  assert.ok(outer, 'the G3 phase control needs a private external evidence root');
  const retained = join(outer, `g3-${accepted ? 'last' : 'no-last'}-${phase}`);
  mkdirSync(retained, { mode: 0o700 });
  let directory;
  let copied = false;
  let finalized = false;
  t.after(async () => {
    if (!directory) return;
    writeFileSync(join(directory, 'release'), '');
    const identities = ['group', 'one', 'two'].map((source) => ({ source, pid: pidIn(directory, source) }));
    const disposition = [];
    for (const identity of identities) disposition.push({ ...identity, state: identity.pid === undefined ? 'unobserved' : await gone(identity.pid, 3_000) ? 'absent' : 'unresolved' });
    cpSync(directory, join(retained, 'fixture'), { recursive: true, force: false, errorOnExist: true });
    copied = true;
    writeFileSync(join(retained, 'finalizer.json'), JSON.stringify({ identities: disposition, snapshot: 'copied' }) + '\n');
    assert.ok(disposition.every(({ state }) => state === 'absent'), 'a recorded G3 fixture identity did not finalize');
    finalized = true;
  });
  directory = realpathSync(temporaryDirectory('rigger-g3-phase-', { context: t, beforeRemoval: () => assert.ok(copied && finalized, 'retain unresolved G3 phase scratch') }));
  writeFileSync(join(directory, 'hold'), '');
  holdingTwo(directory);
  const commandPath = join(directory, 'command');
  // On release, the fixture parent ends and reaps its own recorded children.
  writeFileSync(commandPath, [
    readFileSync(commandPath, 'utf8'),
    'one=$(/bin/cat "$here/one.pid")',
    'two=$(/bin/cat "$here/two.pid")',
    'kill "$one" "$two"',
    'wait "$one" "$two"',
    '',
  ].join('\n'));
  warmed(commandPath);
  const rejectedState = accepted ? 4 : 2;
  const targetState = rejectedState + 1;
  const priorNames = accepted ? 6 : 3;
  const priorCommands = accepted ? 4 : 2;
  const mark = ': > "$here/group-clock-cut"';
  fixture(directory, 'ps', [
    'case "$*" in',
    '  "-ww -g "*" -o pid=,stat=")',
    '    count=0; [ ! -f "$here/census-state-count" ] || count=$(< "$here/census-state-count")',
    '    count=$((count + 1)); printf "%s" "$count" > "$here/census-state-count"',
    ...(accepted ? [("    if [ \"$count\" -eq 1 ]; then " + shellQuote(PS) + " \"$@\" | /usr/bin/awk 'NR == 1 { $2 = \"?\" } { print }'; exit 0; fi")] : []),
    `    if [ "$count" -eq ${rejectedState} ]; then exit 1; fi`,
    ...(phase === 'C2' ? [`    if [ "$count" -eq ${targetState} ]; then ${mark}; fi`] : []),
    '    ;;',
    '  "-ww -g "*" -o pid=,command=")',
    '    count=0; [ ! -f "$here/census-command-count" ] || count=$(< "$here/census-command-count")',
    '    count=$((count + 1)); printf "%s" "$count" > "$here/census-command-count"',
    ...(phase === 'C3-first' || phase === 'C5' ? [`    if [ "$count" -eq ${priorCommands + (phase === 'C5' ? 2 : 1)} ]; then ${mark}; fi`] : []),
    '    ;;',
    '  "-p "*" -o ucomm=")',
    '    count=0; [ ! -f "$here/census-name-count" ] || count=$(< "$here/census-name-count")',
    '    count=$((count + 1)); printf "%s" "$count" > "$here/census-name-count"',
    ...(phase === 'C3-later' || phase === 'C4' ? [`    if [ "$count" -eq ${priorNames + (phase === 'C4' ? 3 : 1)} ]; then ${mark}; fi`] : []),
    '    ;;',
    'esac',
    ("exec " + shellQuote(PS) + " \"$@\""),
  ].join('\n'));
  const anchor = "phase: 'C2'";
  assert.equal(GROUP_BOUND_CALLER.split(anchor).length, 2, 'the traced clock phase anchor moved');
  const caller = GROUP_BOUND_CALLER.replace(anchor, `phase: ${JSON.stringify(phase)}`);
  const { status, stderr, events } = await cleanedUpBy(caller, directory, { ps: 'ps', groupBoundTrace: true, hangAfter: 'group' });
  writeFileSync(join(directory, 'caller.stderr'), stderr);
  assert.equal(status, 0, 'the G3 phase caller failed; inspect retained stderr');
  const group = pidIn(directory, 'group');
  const pids = ['group', 'one', 'two'].map((name) => pidIn(directory, name)).sort((a, b) => a - b);
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0) && new Set(pids).size === 3, 'G3 phase fixture identities are incomplete');
  const trace = linesOf(directory, 'group-bound.trace.jsonl');
  const state = ['-ww', '-g', String(group), '-o', 'pid=,stat='];
  const command = ['-ww', '-g', String(group), '-o', 'pid=,command='];
  const names = pids.map((pid) => ['-p', String(pid), '-o', 'ucomm=']);
  const round = [state, command, ...names, command, state];
  const prefix = [state, ...(phase === 'C2' ? [] : [command]), ...(phase === 'C3-later' ? names.slice(0, 1) : phase === 'C4' || phase === 'C5' ? names : []), ...(phase === 'C5' ? [command] : [])];
  const kill = trace.find(({ operation, target, name, answer }) => operation === 'signal-answer' && target === -group && name === 'SIGKILL' && answer === true);
  assert.ok(kill, 'the phase cut did not reach the group kill');
  const reads = trace.filter(({ operation, tool }, index) => operation === 'read-start' && tool === 'ps' && index < trace.indexOf(kill) && ['-ww', '-p'].includes(trace[index].argv[0]));
  assert.deepEqual(reads.map(({ argv }) => argv), [...(accepted ? round : []), ...round, ...prefix], 'the cut did not reach the exact G3 round and read position');
  const ends = trace.filter(({ operation, tool }, index) => operation === 'read-end' && tool === 'ps' && index < trace.indexOf(kill) && ['-ww', '-p'].includes(trace[index].argv[0]));
  assert.equal(ends[accepted ? 13 : 6].stdout, '', 'the completed unseen round was not rejected at C5');
  assert.equal(read(directory, 'group-clock-jump'), 'J', 'the phase read was not cut at the unchanged 1000 ms bound');
  assert.ok(trace.some(({ operation, phase: reached }) => operation === 'clock-cut' && reached === phase), 'the selected phase cut was not traced');
  const probe = trace.find((entry, index) => index > trace.indexOf(kill) && entry.operation === 'signal-answer' && entry.target === -group && entry.name === 0);
  assert.ok(probe && (probe.answer === true || probe.answer === false || probe.error === 'EPERM'), 'the first post-kill E/O probe was not observed');
  if (accepted) {
    for (const pid of pids) {
      const name = ends.find(({ argv }) => JSON.stringify(argv) === JSON.stringify(['-p', String(pid), '-o', 'ucomm='])).stdout.replace(/ *\n$/, '');
      const cmd = ends[5].stdout.split('\n').map((row) => /^\s*(\d+)\s+(.*)$/.exec(row)).find((row) => Number(row?.[1]) === pid)?.[2];
      assert.ok(name && cmd, 'the accepted round lacked a returned identity');
      assert.deepEqual(events.filter((event) => event.pid === pid).map(({ event, name: foundName, cmd: foundCmd }) => ({ event, name: foundName, cmd: foundCmd })), [{ event: 'survivor.killed', name, cmd }], 'the accepted member was lost at the phase cut');
    }
    assert.equal(events.length, pids.length, 'the retained round invented another event');
  } else {
    assert.deepEqual(events.filter(({ pid }) => pid !== undefined), [], 'a no-last cut invented named members');
    const killed = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
    assert.equal(killed.length, 1, 'the no-last cut did not record exactly one group result');
    assert.match(killed[0].census, /the census's reads named no process of the group while it still had one: .*did not finish within 1000 ms/);
  }
}

// proves R-STATE-9
test('C615 G3 accepted-last C3 first name timeout keeps returned identities', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C3-first', true); });
// proves R-STATE-9
test('C615 G3 accepted-last C3 later name timeout keeps returned identities', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C3-later', true); });
// proves R-STATE-9
test('C615 G3 accepted-last C4 command timeout keeps returned identities', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C4', true); });
// proves R-STATE-9
test('C615 G3 accepted-last C5 state timeout keeps returned identities', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C5', true); });
// proves R-STATE-9
test('C615 G3 no-last C2 command timeout records an unnamed group result', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C2', false); });
// proves R-STATE-9
test('C615 G3 no-last C3 first name timeout records an unnamed group result', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C3-first', false); });
// proves R-STATE-9
test('C615 G3 no-last C3 later name timeout records an unnamed group result', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C3-later', false); });
// proves R-STATE-9
test('C615 G3 no-last C4 command timeout records an unnamed group result', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C4', false); });
// proves R-STATE-9
test('C615 G3 no-last C5 state timeout records an unnamed group result', SETTLES_WITHIN, async (t) => { await groupPhaseCut(t, 'C5', false); });

/** Checks synthetic return boundaries without claiming real process-tool or prepared-cell proof. */
test('C615 preparation streams distinguish absent undefined null and empty returns', SETTLES_WITHIN, () => {
  const values = [
    { label: 'absent', present: false, type: 'absent' },
    { label: 'undefined', present: true, type: 'undefined', value: undefined },
    { label: 'null', present: true, type: 'null', value: null },
    { label: 'empty', present: true, type: 'string', value: '' },
    { label: 'partial', present: true, type: 'string', value: 'partial returned text\n' },
  ];
  for (const name of ['stdout', 'stderr']) {
    for (const boundary of values) {
      const result = { status: 2, signal: null, stdout: 'other returned stdout\n', stderr: 'other returned stderr\n' };
      if (boundary.present) result[name] = boundary.value;
      else delete result[name];
      const directory = syntheticPreparationDirectory(`stream-${name}-${boundary.label}`);
      let calls = 0;
      const reader = (tool, argv) => {
        calls++;
        assert.equal(tool, PS);
        assert.deepEqual(argv, ['-p', '42001', '-o', 'lstart=']);
        return result;
      };
      assert.throws(() => prepareSighting(directory, { reader }), /not a product-equivalent answer/);
      assert.equal(calls, 1, 'a refused return triggered another preparation read');
      assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false);
      const prepared = join(directory, 'sighting-prepared');
      const end = JSON.parse(readFileSync(join(prepared, '001.json'), 'utf8'));
      assert.equal(end.source, 'synthetic-controlled-return');
      assert.deepEqual({ present: end.streams[name].present, type: end.streams[name].type },
        { present: boundary.present, type: boundary.type }, `${name}/${boundary.label}: return boundary was lost`);
      if (boundary.type === 'string') {
        assert.equal(end.streams[name].file, `001.${name}.utf8`);
        assert.equal(readFileSync(join(prepared, end.streams[name].file), 'utf8'), boundary.value);
      } else {
        assert.equal(end.streams[name].file, null);
        assert.equal(existsSync(join(prepared, `001.${name}.utf8`)), false, 'an unreturned stream gained byte originals');
      }
    }
  }
  const directory = syntheticPreparationDirectory('stream-thrown-before-return');
  assert.throws(() => prepareSighting(directory, { reader: () => { throw new Error('synthetic pre-return failure'); } }),
    /threw before returning/);
  const end = JSON.parse(readFileSync(join(directory, 'sighting-prepared', '001.json'), 'utf8'));
  for (const name of ['stdout', 'stderr']) {
    assert.deepEqual(end.streams[name], { present: false, type: 'absent', file: null });
    assert.equal(existsSync(join(directory, 'sighting-prepared', `001.${name}.utf8`)), false);
  }
});


test('C615 preparation refuses a returned read past its configured deadline', SETTLES_WITHIN, () => {
  const directory = syntheticPreparationDirectory('per-read-deadline');
  const birth = 'Mon Oct 11 10:00:00 2026\n';
  const state = '42001 S\n42002 S\n42003 S\n';
  const answers = [birth, birth, birth, state, '42001 sh\n42002 tail\n42003 tail\n',
    'sh\n', 'tail\n', 'tail\n', birth, birth, birth, state];
  let now = 0n;
  let calls = 0;
  const reader = (tool, argv, settings) => {
    assert.equal(tool, PS);
    assert.equal(settings.timeout, 500);
    if (calls === 0) now = 501_000_000n;
    return { status: 0, signal: null, error: undefined, stdout: answers[calls++], stderr: '' };
  };
  assert.throws(() => prepareSighting(directory, { reader, clock: () => now }), /exceeded its 500 ms read bound/);
  assert.equal(calls, 1, 'a late returned read started another preparation read');
  assert.equal(existsSync(join(directory, 'sighting-cache.ready')), false);
  const prepared = join(directory, 'sighting-prepared');
  const receipt = JSON.parse(readFileSync(join(prepared, '001.json'), 'utf8'));
  assert.equal(receipt.clockSource, 'synthetic-clock');
  assert.equal(BigInt(receipt.endedNs) - BigInt(receipt.startedNs), 501_000_000n);
  assert.equal(readFileSync(join(prepared, '001.stdout.utf8'), 'utf8'), birth);
  assert.equal(readFileSync(join(prepared, '001.stderr.utf8'), 'utf8'), '');
});
