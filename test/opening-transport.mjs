// ABOUTME: A controlled gh transport that records calls and models a refused call.end using
// the process adapter's documented EVENT_REFUSED result and event shape.

import assert from 'node:assert/strict';
import { recordingSink } from './admission-world.mjs';
import { refusedCall } from './write-made-fixtures.mjs';

export const ok = (answer) => ({ status: 0, stdout: JSON.stringify(answer), stderr: '' });

/** reply answers the runner's status/text contract; only repository-write call.end can be refused. */
export function openingTransport(reply, { refuseEnd = false } = {}) {
  const sent = [];
  const { sink, events } = recordingSink((event, fields) => {
    if (refuseEnd && event === 'call.end' && fields.side === 'repository-write') throw new Error('call record disk full');
  });
  const emitter = sink.emitter({ layer: 'L0' });
  const send = async (command, args, { emitter: record = emitter, side, timeout } = {}) => {
    assert.equal(command, 'gh');
    assert.ok(timeout > 0, 'the runner supplies its timeout');
    sent.push(args);
    const said = await reply(args);
    const fields = { system: 'forge', side, ms: 0, outcome: said.timedOut ? 'timed-out' : said.status === 0 ? 'ok' : 'failed' };
    try { record.emit('call.end', fields); }
    catch (cause) {
      throw refusedCall(said.stdout, { exit: said.status, timedOut: said.timedOut, stderr: said.stderr,
        unrecorded: [{ event: 'call.end', ...fields, cause }] });
    }
    return said;
  };
  return { send, emitter, sink, events, sent };
}
