// ABOUTME: A gated live check of `rigger doctor`'s agent CLI check against the installed `claude`'s own
// answer to whether it is signed in. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { agentAuth } from '../src/cli/doctor.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import * as claudeAdapter from '../src/substrate/providers/claude.mjs';
import { LIVE, pastRefusing } from './claude-live.mjs';
import { UNKILLED } from './process-fixtures.mjs';

/*
 * What this run reaches. It asks the installed `claude` its `auth` argv twice, once directly and
 * once through the check. Asking whether it is signed in starts no session and makes no tool
 * call; it reads the host owner's Claude Code login and nothing else these tests start.
 */
const skip = LIVE ? false : 'this asks the installed claude whether it is signed in; set RIGGER_LIVE_CLAUDE=1 to run it';

test('the agent CLI check answers the `loggedIn` the installed claude states', { skip }, async () => {
  // `D16` rules 1 and 2: Claude Code owns whether Claude Code is signed in. The relation is
  // asserted against the real CLI rather than the answer it gives here today, and the expected
  // value is parsed in this test rather than taken from the check's own reader, which would
  // agree with it by construction.
  //
  // The command comes out of `AGENT_CLI`, so the source does not name it and cannot rule out a
  // git. It is asked under `gitEnvironment()` because the check it is compared against asks it
  // that way, and a relation measured under a different environment from the one production uses
  // is a relation between two different questions.
  //
  // The check asks it through L0's process adapter, so it is handed an emitter: `UNKILLED`, which
  // fails the test on any kill, since the CLI answering this question leaves no process behind.
  //
  // Both ask the installed `claude`, past the refusing one `npm test` puts first on the path
  // (`test/suite.sh`), by taking the directory it exports for that one off the path. Asking
  // whether it is signed in starts no session.
  const inherited = process.env.PATH;
  process.env.PATH = pastRefusing();
  try {
    const [command, ...args] = claudeAdapter.auth;
    const tool = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    let stated;
    try {
      stated = JSON.parse(tool.stdout).loggedIn;
    } catch {
      stated = undefined;
    }

    const here = await agentAuth({ emitter: UNKILLED, adapters: { claude: claudeAdapter } });

    assert.equal(here.ok, typeof stated === 'boolean' ? stated : null, `${here.detail} against ${tool.stdout}`);
  } finally {
    process.env.PATH = inherited;
  }
});
