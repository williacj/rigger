// ABOUTME: Ordinary controls for fixture-owned child lifetime and raw process observations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processIds, reaped } from './process-fixtures.mjs';

// These are repository fixture diagnostics, outside deployment requirements' Scope.
// Raw fields follow Node's spawnSync contract; STAT Z/S follow the PS producer contract.
const observation = (status, stdout, extra = {}) => ({ status, stdout, stderr: '', signal: null, error: undefined, ...extra });

test('PS observation distinguishes a successful zombie row from a live row', () => {
  assert.equal(reaped(observation(0, 'Z\n')), true);
  assert.equal(reaped(observation(0, 'S\n')), false);
});

test('PS observation refuses an unsupported nonzero status with empty output', () => {
  assert.equal(reaped(observation(2, '')), false, 'an unsupported PS status cannot prove absence');
});

test('PS observation refuses failed malformed contradictory and live raw results', () => {
  const cases = [
    observation(null, '', { signal: 'SIGTERM' }),
    observation(0, 'Z\n', { error: new Error('failed PS') }),
    observation(0, 'Z\n', { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }),
    observation(0, 'Z\n', { signal: 'SIGTERM' }),
    observation(0, 'Z\n', { stderr: 'warning\n' }),
    observation(0, ''), observation(0, '   '), observation(0, 'Zombie\n'),
    observation(0, 'Z\nS\n'), observation(0, 'Z\nZ\n'), observation(0, 'Z\n\n'),
    observation(0, 'R\n'), observation(0, 'S+\n'), observation(0, 'T\n'),
    observation(1, 'Z\n'), observation(2, 'Z\n'), observation(255, ''),
    observation('0', 'Z\n'), observation(0.5, 'Z\n'),
    observation(0, undefined), observation(0, null), observation(0, Buffer.from('Z\n')),
    observation(0, 'Z\n', { stderr: undefined }),
    observation(0, 'Z\n', { signal: undefined }), undefined, null,
  ];
  for (const result of cases) assert.equal(reaped(result), false, 'unqualified PS observation: ' + String(result?.stdout));
});

// Linux ps(1) STAT modifiers and Apple's adv_cmds/ps/print.c define these rows.
// Native PS absence is separately qualified against an independently reaped child.
test('PS observation accepts qualified no-match and single zombie states', () => {
  assert.equal(reaped(observation(1, '')), true);
  for (const state of ['Z', 'Z<', 'ZN', 'ZL', 'Zs', 'Zl', 'Z+', 'Z<Lsl+', 'ZX', 'ZV', 'ZNXVLs+']) {
    assert.equal(reaped(observation(0, state + '\n')), true, state);
  }
});

// pgrep manuals define 0 as PID matches and 1 as no matches, with newline-separated PIDs.
// Missing/nonstring fields below are refusal diagnostics, not asserted native producer answers.
test('pgrep observation preserves valid PID strings and only qualified no-match is empty', () => {
  assert.deepEqual(processIds(observation(0, '4242\n')), ['4242']);
  assert.deepEqual(processIds(observation(0, '4242\n8484\n')), ['4242', '8484']);
  assert.deepEqual(processIds(observation(1, '')), []);
  for (const result of [
    observation(0, ''), observation(0, 'not-a-pid\n'), observation(0, '42\nno\n'),
    observation(0, '0\n'), observation(0, '-42\n'), observation(0, ' 42\n'),
    observation(0, '42\n\n'), observation(0, '9007199254740992\n'),
    observation(1, '42\n'), observation(2, ''), observation(3, ''), observation(255, ''),
    observation(null, '', { signal: 'SIGTERM' }),
    observation(0, '42\n', { error: new Error('failed') }),
    observation(0, '42\n', { error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
    observation(0, '42\n', { signal: 'SIGTERM' }),
    observation(0, '42\n', { stderr: 'warning' }),
    observation('0', '42\n'), observation(0.5, '42\n'),
    observation(0, undefined), observation(0, null), observation(0, Buffer.from('42\n')),
    observation(0, '42\n', { signal: undefined }), observation(0, '42\n', { stderr: undefined }),
    undefined, null,
  ]) assert.throws(() => processIds(result), /unqualified pgrep observation/);
});
