// ABOUTME: Tests the forge adapter's three runners: what each admits from its own side, what it
// refuses by name, and that a refused request sends nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRunner } from '../src/substrate/forge/runners.mjs';

/**
 * A stand-in for the one spawn a runner makes, recording every command it is handed and answering
 * `answer` for each. A refusal is shown by what this never received.
 */
function recording(answer = () => ({ status: 0, stdout: '{}', stderr: '' })) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return answer(command, args);
  };
  send.sent = sent;
  return send;
}

test('the read runner sends `gh auth status`, which its read allowlist names', () => {
  const send = recording(() => ({ status: 0, stdout: 'Logged in', stderr: '' }));

  const said = readRunner(['auth', 'status'], { send });

  assert.deepEqual(send.sent, [['gh', 'auth', 'status']]);
  assert.equal(said.stdout, 'Logged in');
});

test('the read runner refuses a subcommand its read allowlist does not name, naming it, and sends nothing', () => {
  // The defect this catches is a read runner that admits any `gh` subcommand it does not
  // recognise as `api`, which sends `gh issue close` and `gh project item-archive` as reads.
  for (const args of [['issue', 'close', '12'], ['project', 'item-archive', '6'], ['auth', 'status', '--show-token']]) {
    const send = recording();
    assert.throws(() => readRunner(args, { send }), (error) => error.message.includes(args.join(' ')), args.join(' '));
    assert.deepEqual(send.sent, [], args.join(' '));
  }
});
