// ABOUTME: Tests that `npm test` puts a refusing, recording `claude` and `codex` first on the path
// every test inherits, so that no test reaches a real agent session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/** The `name` a spawn finds on `path`, by its absolute path, or null where there is none. */
function found(name, path = '') {
  for (const dir of path.split(delimiter).map((entry) => resolve(entry || '.'))) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {
      // Not here, so the next directory is where a spawn would look.
    }
  }
  return null;
}

for (const cli of ['claude', 'codex']) {
  test(`npm test puts its refusing ${cli} first on the path every test inherits`, () => {
    // As #276 did for `gh` (engineer 6 on #467): a test that fails to pass its own stand-in
    // through reaches the `${cli}` this path resolves. The defect this catches is a suite run with
    // the refusing one gone or behind another, where such a test starts a real agent session.
    const refusing = process.env.RIGGER_REFUSING_AGENT_DIR;
    assert.ok(refusing, `this run put no refusing ${cli} on the path: run the suite with \`npm test\`, which runs test/suite.sh`);
    assert.equal(found(cli, process.env.PATH), resolve(refusing, cli));
  });
}
