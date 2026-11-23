// ABOUTME: Checks the host fixture test's entry-child start record: only allowlisted environment
// names reach it, while the spawned child still receives the caller's whole environment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { RECORDED_NAMES, entryChild } from './entry-child.mjs';

/**
 * A stand-in for `child_process.spawn` that records its call and answers with a child that exits
 * 0 once its input ends. Its shape follows Node's documented ChildProcess contract
 * (https://nodejs.org/api/child_process.html#class-childprocess): `pid`, readable `stdout` and
 * `stderr`, writable `stdin`, and a `close` event carrying `(code, signal)` after the stdio
 * streams have ended.
 */
function standInSpawn() {
  const calls = [];
  const start = (command, argv, options) => {
    calls.push({ command, argv, options });
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.stdin.once('finish', () => {
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', 0, null));
    });
    return child;
  };
  return { start, calls };
}

/** Runs entryChild over the stand-in and returns the start diagnostic's text and the spawn calls. */
async function recordedStart(environment) {
  const diagnostics = [];
  const spawned = standInSpawn();
  await entryChild({ diagnostic: (message) => diagnostics.push(message) },
    '/fixture/bin/tool', ['plan', '--flag'], '/fixture/consumer', environment, '', spawned.start);
  // Matched without the trailing space, so a misspelt prefix fails the "Line" test's own assertion.
  const starts = diagnostics.filter((message) => message.startsWith('entry-child-start'));
  assert.equal(starts.length, 1, 'entryChild emits exactly one start diagnostic');
  return { text: starts[0], calls: spawned.calls };
}

const PREFIX = 'entry-child-start ';
const OUTSIDE = { RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' };
const PERMITTED = new Set(['PATH', 'HOME', 'LANG', 'CODEX_HOME', 'RIGGER_STAND_IN_VALUE']);

/** The start record parsed from its JSON, which the "Line" test checks is all that follows the prefix. */
const parsed = (text) => JSON.parse(text.slice(PREFIX.length));

/**
 * The names `RECORDED_NAMES` holds, read by index into a plain array: no iterator or species of
 * its own decides what is read, and no value it constructs is compared.
 */
function recordedNames() {
  const names = [];
  for (let at = 0; at < RECORDED_NAMES.length; at++) names.push(RECORDED_NAMES[at]);
  return names;
}

test('the start diagnostic is the entry-child-start prefix followed by a single-line JSON object', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin' });
  assert.ok(text.startsWith(PREFIX), 'the diagnostic carries the prefix with its one trailing space');
  const rest = text.slice(PREFIX.length);
  assert.equal(/[\r\n]/.test(rest), false, 'the JSON after the prefix is on one line');
  const record = JSON.parse(rest);
  assert.ok(record !== null && typeof record === 'object' && !Array.isArray(record), 'what follows the prefix is a JSON object');
});

test('the start record\'s top-level keys are exactly pid, command, argv, cwd and environment', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin' });
  assert.deepEqual(Object.keys(parsed(text)).sort(), ['argv', 'command', 'cwd', 'environment', 'pid']);
});

test('the start record\'s environment.PATH is the value the caller passed', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/gh-dir:/fixture/installed', ...OUTSIDE });
  assert.equal(parsed(text).environment.PATH, '/fixture/gh-dir:/fixture/installed');
});

test('the entry-child start record omits an environment name outside the allowlist and its value', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin:/fixture/tools', ...OUTSIDE });
  assert.equal(text.includes('RIGGER_ENTRY_OUTSIDE'), false, `the outside name reached the start record: ${text}`);
  assert.equal(text.includes('outside-value-5d1c'), false, `the outside value reached the start record: ${text}`);
});

test('the start record\'s command, argv and cwd are what the caller passed', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin' });
  const record = parsed(text);
  assert.equal(record.command, '/fixture/bin/tool');
  assert.deepEqual(record.argv, ['plan', '--flag']);
  assert.equal(record.cwd, '/fixture/consumer');
});

test('the start record\'s pid is the PID the spawn reported', async () => {
  const { text } = await recordedStart({ PATH: '/fixture/bin' });
  assert.equal(parsed(text).pid, 4242);
});

test('each recorded environment name maps to the value the caller passed for it', async () => {
  const caller = { PATH: '/fixture/bin', HOME: '/fixture/home', LANG: 'C.fixture', CODEX_HOME: '/fixture/codex', RIGGER_STAND_IN_VALUE: 'stand-in-fixture' };
  for (const name of recordedNames()) assert.ok(Object.hasOwn(caller, name), `premise: the caller holds the recorded name ${name}`);
  const { environment } = parsed((await recordedStart(caller)).text);
  assert.ok(environment !== null && typeof environment === 'object' && !Array.isArray(environment), 'environment is a JSON object');
  for (const [name, value] of Object.entries(environment)) assert.equal(value, caller[name], `${name} is recorded with the caller's value`);
});

test('the recorded environment\'s names are exactly the recorded names the caller held', async () => {
  // Callers holding PATH alone, PATH and HOME, and all five permitted names, each beside an outside
  // name: whichever permitted names the list holds, one caller meets the item's premises, and every
  // name the list holds is held by some caller, so a dropped one is seen.
  const callers = [
    { PATH: '/fixture/bin', ...OUTSIDE },
    { PATH: '/fixture/bin', HOME: '/fixture/home', ...OUTSIDE },
    { PATH: '/fixture/bin', HOME: '/fixture/home', LANG: 'C.fixture', CODEX_HOME: '/fixture/codex', RIGGER_STAND_IN_VALUE: 'stand-in-fixture', ...OUTSIDE },
  ];
  const heldBy = (caller) => Object.keys(caller).filter((name) => RECORDED_NAMES.includes(name)).sort();
  assert.ok(callers.some((caller) => Object.keys(caller).some((name) => !RECORDED_NAMES.includes(name))
    && heldBy(caller).length > 0 && recordedNames().some((name) => !Object.hasOwn(caller, name))),
  'premise: some caller holds a name outside the list, a name inside it, and lacks another inside it');
  for (const caller of callers) {
    const { environment } = parsed((await recordedStart(caller)).text);
    assert.ok(environment !== null && typeof environment === 'object' && !Array.isArray(environment), 'environment is a JSON object');
    assert.deepEqual(Object.keys(environment).sort(), heldBy(caller));
  }
});

test('entryChild hands spawn the caller\'s whole environment, outside names included', async () => {
  const { calls } = await recordedStart({ PATH: '/fixture/bin', HOME: '/fixture/home', ...OUTSIDE });
  assert.equal(calls.length, 1, 'entryChild starts exactly one child');
  // Node delivers every key a for...in over `env` yields, inherited ones included; that set is the contract.
  const delivered = {};
  for (const name in calls[0].options.env) delivered[name] = calls[0].options.env[name];
  assert.deepEqual(delivered, { PATH: '/fixture/bin', HOME: '/fixture/home', RIGGER_ENTRY_OUTSIDE: 'outside-value-5d1c' });
});

test('RECORDED_NAMES is an exported array of strings holding PATH and no name outside the permitted five', () => {
  assert.ok(Array.isArray(RECORDED_NAMES), 'RECORDED_NAMES is an array');
  for (const name of recordedNames()) assert.equal(typeof name, 'string', 'every element is a string');
  assert.ok(RECORDED_NAMES.includes('PATH'), 'RECORDED_NAMES holds PATH');
  for (const name of recordedNames()) assert.ok(PERMITTED.has(name), `RECORDED_NAMES holds ${name}, outside the permitted set`);
});
