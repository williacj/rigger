// ABOUTME: Runs the gh and board contract cases against real gh and the live board 6, read-only,
// where the run opts in for gh (`D29` rule 12.3); every case skips in a run that does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';

import { commandOf } from './fake-gh.mjs';
import { BOARD, BOARD_CASES, FACTS, GH_CASES, contractAsk, liveSides, runBoardCase } from './gh-contract-cases.mjs';
import { UNKILLED } from './process-fixtures.mjs';

/**
 * The directory of the real gh, which `test/suite.sh` sets only where the run opts in with
 * `RIGGER_LIVE_GH=1`. Put first on this file's own PATH, it is what the read runner's `gh` and the
 * agent read runner's resolve, in front of the suite's refusing gh (#276), so this file alone reads
 * the forge. Its token needs the `repo` and `read:project` scopes.
 */
const live = process.env.RIGGER_LIVE_GH_DIR;
if (live) process.env.PATH = `${live}${delimiter}${process.env.PATH}`;
const skip = live ? false : 'the run did not opt in for gh with RIGGER_LIVE_GH=1 (D29 rule 12.3)';

/** The live repository and board, with the commit whose file a case reads. */
const target = { ...BOARD, fileCommit: FACTS.file.commit };

/**
 * The read runner's options and the agent read for the live side, each real gh call bounded by a
 * minute (`liveSides`), the read runner's spawn recording through `UNKILLED`.
 */
const { via, agent } = liveSides({ emitter: UNKILLED });

// Host reason: wiring.
// Ordinary decision counterpart: test/gh-contract.test.mjs :: every read command the fake gh answers is run by at least one contract case.
for (const ghCase of GH_CASES) {
  test(`gh contract against real gh: ${ghCase.name}`, { skip }, () => ghCase.run(contractAsk(ghCase.name, { via, agent, commandOf }), target));
}

// Host reason: OS behaviour.
// Ordinary decision counterpart: test/gh-contract.test.mjs :: every real gh call the live side makes is bounded by at most 60 seconds, and a call it ends fails its case.
test('an agent read whose gh ignores SIGTERM is ended at its bound, and its case fails', async (t) => {
  // A gh that ignores SIGTERM and never exits, as a hung one would. It runs whether or not the run
  // opts in, as it reaches no forge. The bound is shortened here, the mechanism being what is
  // proved; the live side's own bound is the read runner's minute.
  const directory = temporaryDirectory('rigger-gh-contract-hung-', { context: t });
  const hung = join(directory, 'gh');
  writeFileSync(hung, '#!/bin/sh\ntrap "" TERM\nwhile :; do sleep 1; done\n');
  chmodSync(hung, 0o755);
  const bound = 500;
  const sides = liveSides({ emitter: UNKILLED, timeout: bound, gh: hung });
  const diff = GH_CASES.find((ghCase) => ghCase.name === 'an agent\'s diff of a pull request');
  await assert.rejects(diff.run(contractAsk(diff.name, { ...sides, commandOf }), target), (error) => {
    assert.match(error.message, new RegExp(`the timeout of ${bound} ms ended `));
    return true;
  });
});

// Host reason: wiring.
// Ordinary decision counterpart: test/gh-contract.test.mjs :: every read command the fake gh answers is run by at least one contract case.
for (const boardCase of BOARD_CASES) {
  test(`board contract against the live board: ${boardCase.name}`, { skip }, () => runBoardCase(boardCase, target, via));
}
