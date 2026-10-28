// ABOUTME: Tests the line the claiming verbs print for a hold's notice that did not finish: a step the
// forge made whose events went unrecorded, and a step that failed, for `once` and `run`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { noticeLine } from '../src/cli/once.mjs';

/**
 * A `failed` as `statusNotice` returns one for a write the forge made whose events the sink refused:
 * its step, the refusal's message as `cause`, the side's `made` mark, and the refusal's `unrecorded`
 * events, shaped as `refused` in `src/substrate/process.mjs` builds them.
 */
const MADE = {
  step: 'open the status issue',
  cause: 'the sink refused 2 L0 event(s), so they went unrecorded:\ncall.end {"command":"gh"}: EIO\ncall.output {"command":"gh"}: EIO',
  made: { answer: 101 },
  unrecorded: [{ event: 'call.end', command: 'gh', cause: new Error('EIO') }, { event: 'call.output', command: 'gh', cause: new Error('EIO') }],
};

/** Asserts `verb`'s line for MADE names the hold, the step as made and each unrecorded event, and says no "failed to". */
function saysMade(verb) {
  const line = noticeLine(verb, 'k7q', MADE);

  assert.ok(line.startsWith(`rigger ${verb}: `), line);
  for (const named of ['k7q', 'open the status issue', 'made', 'call.end', 'call.output']) assert.ok(line.includes(named), `${named} in ${line}`);
  assert.ok(!line.includes('failed to'), line);
}

test('for a step the forge made whose events went unrecorded, rigger once\'s notice line names the hold, the step as made and each unrecorded event, and says no "failed to"', () => {
  saysMade('once');
});

test('for a step the forge made whose events went unrecorded, rigger run\'s notice line names the hold, the step as made and each unrecorded event, and says no "failed to"', () => {
  saysMade('run');
});

test('for a step that failed, the notice line of rigger once and of rigger run says the notice failed to take it, and why', () => {
  for (const verb of ['once', 'run']) {
    assert.equal(noticeLine(verb, 'k7q', { step: 'read the board', cause: 'gh: readItems timed out' }), `rigger ${verb}: the notice for hold k7q failed to read the board: gh: readItems timed out`);
  }
});
