// ABOUTME: A recording stand-in for the `gh` executable, for a test that has to put one on a path.

import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * A directory holding an executable named `gh` that records every call it receives and answers
 * `answer`: its `stdout`, its `stderr` and its exit `status`.
 *
 * Each call is recorded as its arguments joined by spaces, one line per call, so an argument
 * holding a line break would read as two calls. None this repository sends holds one.
 *
 * It answers through `/bin/cat` by its path, because a test can put it on a path too narrow to
 * hold `cat`, as `test/package.test.mjs` does.
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
    `/bin/cat '${out}'`,
    `/bin/cat '${err}' >&2`,
    `exit ${status}`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  return {
    dir,
    /**
     * `path` with this stub's directory first on it, ahead of the refusing `gh` `npm test` puts
     * first on the path this suite runs under (`test/suite.sh`).
     */
    first: (path = process.env.PATH) => `${dir}${delimiter}${path}`,
    /** Every call the stub received, oldest first. */
    calls: () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : []),
  };
}
