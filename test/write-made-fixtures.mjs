// ABOUTME: The failures the write-made tests hand a forge side or a caller: an `EVENT_REFUSED`
// rejection shaped as the process adapter's `refused` shapes it, and the same marked made.

import { EVENT_REFUSED } from '../src/substrate/process.mjs';

/**
 * The events a refusal here names: one survivor kill, with the fields `killsOf` gives a named
 * member, its pid, name and command line, and the error an append to a stream that is a directory raises.
 */
export const unrecordedKill = () => [{ event: 'survivor.killed', pid: 4243, name: 'tail', cmd: '/usr/bin/tail -f /tmp/hold', cause: new Error('EISDIR: illegal operation on a directory, open') }];

/**
 * The rejection of a call whose kill event the sink refused, as `runCommand` gives it: `code`
 * `EVENT_REFUSED`, the `unrecorded` events, and the call's `result`, its output as the bytes the
 * adapter read. `answer` is what the call printed, as JSON unless it is a string already.
 */
export function refusedCall(answer, { exit = 0, timedOut = false, stderr = '', unrecorded = unrecordedKill() } = {}) {
  const stdout = typeof answer === 'string' ? answer : JSON.stringify(answer);
  const lines = unrecorded.map(({ event, cause, ...fields }) => `${event} ${JSON.stringify(fields)}: ${cause.message}`);
  const failure = new Error(`the sink refused ${unrecorded.length} L0 event(s), so they went unrecorded:\n${lines.join('\n')}`);
  return Object.assign(failure, { code: EVENT_REFUSED, unrecorded, result: { exit, timedOut, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) } });
}

/** A rejection a write side marked made, with `answer` as its parsed answer, wrapped as `message` says. */
export function madeFailure(message, answer, unrecorded = unrecordedKill()) {
  const original = refusedCall({}, { unrecorded });
  return Object.assign(new Error(`${message}: ${original.message}`, { cause: original }), { code: EVENT_REFUSED, unrecorded, result: original.result, made: { answer } });
}

/** The same rejection, unmarked: a refused event on a read before the write, as a side hands it on. */
export function unmarkedFailure(message, unrecorded = unrecordedKill()) {
  const original = refusedCall({ data: {} }, { unrecorded });
  return Object.assign(new Error(`${message}: ${original.message}`, { cause: original }), { code: EVENT_REFUSED, unrecorded, result: original.result });
}
