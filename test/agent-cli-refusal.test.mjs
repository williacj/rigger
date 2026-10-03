// ABOUTME: Tests that `npm test` puts a refusing, recording `claude` and `codex` first on the path
// every test inherits, so that no test reaches a real agent session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { onPath } from './on-path.mjs';

for (const cli of ['claude', 'codex']) {
  test(`npm test puts its refusing ${cli} first on the path every test inherits`, () => {
    // As #276 did for `gh` (engineer 6 on #467): a test that fails to pass its own stand-in
    // through reaches the `${cli}` this path resolves. The defect this catches is a suite run with
    // the refusing one gone or behind another, where such a test starts a real agent session.
    const refusing = process.env.RIGGER_REFUSING_AGENT_DIR;
    assert.ok(refusing, `this run put no refusing ${cli} on the path: run the suite with \`npm test\`, which runs test/suite.sh`);
    assert.equal(onPath(cli, process.env.PATH), resolve(refusing, cli));
  });
}
