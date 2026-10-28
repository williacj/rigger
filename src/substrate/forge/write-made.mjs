// ABOUTME: The forge write sides' shared mark: a write call's refused event marked made where its
// result passes the side's own check, and the mark's carry through a side's rewrap of a failure.

import { EVENT_REFUSED } from '../process.mjs';

/**
 * Awaits `call`, a write side's one write call, and answers what it resolves with, unread. A
 * rejection with `EVENT_REFUSED` carrying the call's result means the call ran and only an event
 * of it went unrecorded. Where `check`, the side's own success check, passes on that result, the
 * forge made the write: the failure is marked `made`, holding `check`'s parsed answer as `answer`,
 * and rethrown. `check` is handed the result as the runners hand a resolved call's, its output as
 * text, and throws where the write was not made. Any other rejection passes on unmarked.
 */
export async function written(call, check) {
  try {
    return await call;
  } catch (failure) {
    if (failure?.code === EVENT_REFUSED && failure.result !== undefined) {
      const { exit, timedOut, stdout, stderr } = failure.result;
      try {
        failure.made = { answer: check({ status: exit, timedOut, stdout: String(stdout), stderr: String(stderr) }) };
      } catch {
        // A result the side's check refuses is no write made, so the failure stays unmarked.
      }
    }
    throw failure;
  }
}

/** `failure`, a side's rewrap of `original`, given the original's code, result, unrecorded events and mark. */
export function carried(failure, original) {
  for (const key of ['code', 'result', 'unrecorded', 'made']) {
    if (original?.[key] !== undefined) failure[key] = original[key];
  }
  return failure;
}
