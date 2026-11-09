// ABOUTME: L5's serialized stream pushes at drains and normal returns, their recorded outcomes,
// and the shared line naming a push that did not succeed ("Pushing the stream").

import { readFileSync } from 'node:fs';

import { DATA_REF, pushStream } from '../substrate/data-ref.mjs';
import { EVENT_REFUSED } from '../substrate/process.mjs';
import { writeWhole } from '../substrate/standard-error.mjs';
import { streamPath } from './sink.mjs';

/**
 * What the push uses where its caller hands nothing else: L0's push side, the write to standard
 * error L5's sink makes, and the clock `ms` is read on.
 */
export const PUSH_DEFAULTS = { side: pushStream, write: writeWhole, now: Date.now };

/**
 * The push `recording` makes as a verb returns normally, handed `{ sink, run, config, repository,
 * directory, answer }`: the run's sink and id, the config the verb read and the validator admitted,
 * the repository it named, that repository's state directory and the verb's answer. It answers the
 * answer the verb then gives.
 *
 * It pushes only where `telemetry.push` is exactly `true`, since `R-SAFE-3` keeps the copy off
 * until the owner plainly turns it on, and only where the stream holds a line stamped with this
 * run's id, so a verb whose sink appended nothing makes no push ("When L5 pushes"). The push side is
 * handed the stream's bytes as they stand at the push's start, and an `L0` emitter on the sink.
 *
 * A push that did not succeed leaves the verb's answer as it was, and `write` says so in one line.
 * An event the sink refused is no push that failed ("Failure model"): the verb exits 1, its own text
 * kept and followed by one line naming what went unrecorded. `side`, `spawn`, `write` and `now`
 * stand in for L0's push side, its spawn, the write to standard error and the clock in tests.
 *
 * A drain supplies `handOver` instead of `answer`: its unsuccessful push goes there as `{ push }`,
 * and a refused event as `{ failure }`, once the push settles. One closure belongs to one verb
 * invocation. It holds one active copy and at most one waiting request; drains coalesce, and a
 * return replaces a waiting drain and waits for its own copy. Bytes are read only when a request
 * leaves the queue.
 */
export function pushAtReturn({ side = PUSH_DEFAULTS.side, spawn, write = PUSH_DEFAULTS.write, now = PUSH_DEFAULTS.now } = {}) {
  let flying = false;
  let queued;
  /** Starts one copy; a queued return replaces the one drain follow-up it serves. */
  const start = ({ given, resolve, reject }) => {
    flying = true;
    perform(given).then(resolve, reject).then(() => {
      flying = false;
      const next = queued;
      queued = undefined;
      if (next !== undefined) start(next);
    });
  };
  const perform = async ({ sink, run, config, repository, directory, answer, handOver }) => {
    if (config?.telemetry?.push !== true) return answer;
    const start = now();
    let stream;
    try {
      stream = readFileSync(streamPath(directory));
    } catch {
      // A stream absent, or one L5 cannot read, holds no line it can show is this run's own.
      return answer;
    }
    // Every line the sink writes opens with `ts` and then `run`, as `JSON.stringify` orders the
    // envelope, so a line of this run's own holds this text.
    if (!stream.includes(`"run":${JSON.stringify(run)}`)) return answer;
    let answered;
    try {
      answered = await side({ repository, stream, emitter: sink.emitter({ layer: 'L0' }), now, ...(spawn === undefined ? {} : { spawn }) });
    } catch (failure) {
      if (failure?.code === EVENT_REFUSED) return handOver === undefined ? refused(answer, failure.message) : handOver({ failure });
      answered = { outcome: 'failed', reason: failure?.message ?? String(failure) };
    }
    const { outcome, ...fields } = answered;
    try {
      sink.emitter({ layer: 'L5', dispatch: null }).emit('push.end', { ref: DATA_REF, outcome, ms: now() - start, ...fields });
    } catch (refusal) {
      const said = `the sink refused push.end, so it went unrecorded: ${refusal.message}`;
      return handOver === undefined ? refused(answer, said) : handOver({ failure: new Error(said, { cause: refusal }) });
    }
    if (outcome !== 'pushed') {
      if (handOver === undefined) write(failedPushLine(answered));
      else handOver({ push: answered });
    }
    return answer;
  };
  return (given) => new Promise((resolve, reject) => {
    const request = { given, resolve, reject };
    if (!flying) start(request);
    else if (given.handOver === undefined) queued = request;
    else {
      if (queued === undefined || queued.given.handOver !== undefined) queued = request;
      resolve();
    }
  });
}

/** The failure line shared by a return's push and a drain's hand-over. */
export const failedPushLine = ({ outcome, reason }) => `rigger: the push of the event stream to ${DATA_REF} ended ${outcome}: ${oneLine(reason)}\n`;

/** The verb's answer where the sink refused an event of the push's: its own text, then the refusal. */
const refused = (answer, said) => ({ text: `${answer.text}\nrigger: ${oneLine(said)}`, code: 1 });

/** `text` on one line, its line breaks read as separators. */
const oneLine = (text) => String(text).split(/\r?\n/).filter(Boolean).join('; ');
