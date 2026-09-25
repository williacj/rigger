// ABOUTME: A recording stand-in for the `gh` executable, for a test that has to put one on a path,
// and the environment a child runs under once the test runner's marker is taken out of it.

import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * A directory holding an executable named `gh` that records every call it receives and answers
 * `answer`: its `stdout`, its `stderr` and its exit `status`.
 *
 * Each call is recorded as its arguments joined by spaces, one line per call, so an argument
 * holding a line break would read as two calls. None this repository sends holds one.
 */
export function stubGh({ status = 0, stdout = '', stderr = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-stub-gh-'));
  const record = join(dir, 'calls');
  const [out, err] = [join(dir, 'stdout'), join(dir, 'stderr')];
  writeFileSync(out, stdout);
  writeFileSync(err, stderr);
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${record}'`,
    `cat '${out}'`,
    `cat '${err}' >&2`,
    `exit ${status}`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  return {
    dir,
    /** `path` with this stub's directory first on it. */
    first: (path = process.env.PATH) => `${dir}${delimiter}${path}`,
    /** Every call the stub received, oldest first. */
    calls: () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : []),
  };
}

/**
 * `env` without the variable `node --test` marks a test file's process with, so a child a test
 * spawns acts as it would outside the suite. The forge runners refuse to spawn `gh` for a caller
 * that passed no stand-in wherever that variable is set, so a test that clears it has to put a
 * stand-in `gh` first on the child's path itself.
 */
export function untested(env) {
  const { NODE_TEST_CONTEXT, ...rest } = env;
  return rest;
}
