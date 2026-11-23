// ABOUTME: The host fixture test's recorded entry child: spawns it with the caller's whole
// environment, and records its start with only the environment names the diagnostic allows.

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';

/**
 * The environment names a start record may carry: those the host fixture test's callers set by
 * name for a reason its witnesses rely on. `PATH` shows a reader which `gh`, `git` and `node` the
 * child resolved. Every other inherited name stays out of the log, since it may hold a secret.
 */
export const RECORDED_NAMES = ['PATH', 'HOME', 'LANG', 'CODEX_HOME', 'RIGGER_STAND_IN_VALUE'];

const recorded = (environment) => Object.fromEntries(Object.entries(environment).filter(([name]) => RECORDED_NAMES.includes(name)));

/** A real recorded child used by the five entry witnesses, with finite explicitly ended input. */
export async function entryChild(t, command, argv, cwd, environment, input = '', spawn = childProcess.spawn) {
  const child = spawn(command, argv, { cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  const started = { pid: child.pid ?? null, command, argv, cwd, environment: recorded(environment) };
  t.diagnostic(`entry-child-start ${JSON.stringify(started)}`);
  let stdout = '';
  let stderr = '';
  let failure;
  let inputFailure;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => { failure = error; });
  child.stdin.once('error', (error) => { inputFailure = error; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(input);
  const ended = await closed;
  const completed = { pid: child.pid ?? null, ...ended, stdinFinished: child.stdin.writableFinished, stdout, stderr };
  t.diagnostic(`entry-child-end ${JSON.stringify(completed)}`);
  assert.ifError(failure);
  assert.ifError(inputFailure);
  assert.ok(Number.isSafeInteger(started.pid) && started.pid > 0, 'the witness recorded its actual child PID at start');
  assert.equal(completed.pid, started.pid);
  assert.equal(completed.signal, null);
  assert.equal(completed.stdinFinished, true);
  return completed;
}
