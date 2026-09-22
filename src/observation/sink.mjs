// ABOUTME: L5's event sink: it stamps every event with the envelope and appends it to one JSONL
// ABOUTME: stream in the consumer's state directory, and reads that stream back.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STREAM = 'events.jsonl';

// The envelope's own keys. The sink stamps every one of them, so a layer supplying one would be
// writing a fact about the run or the card that it is not the layer to know.
const ENVELOPE = ['ts', 'run', 'layer', 'event', 'card', 'dispatch'];

/** The one stream L5 owns, inside the state directory the consumer named. */
const streamPath = (directory) => join(directory, STREAM);

/**
 * Open the sink for one run.
 *
 * `now` is the run's clock, read once per event, and it returns epoch milliseconds.
 */
export function openSink({ directory, run, now }) {
  mkdirSync(directory, { recursive: true });
  const path = streamPath(directory);

  return {
    /** An emitter for one layer, and the card and dispatch its events arise under. */
    emitter: ({ layer, card, dispatch }) => ({
      emit(event, fields) {
        const stamped = Object.keys(fields ?? {}).filter((key) => ENVELOPE.includes(key));
        if (stamped.length > 0) {
          throw new Error(`${event} supplied ${stamped.join(', ')}, which the sink stamps`);
        }
        const record = {
          ts: new Date(now()).toISOString(),
          run,
          layer,
          event,
          card,
          dispatch,
          ...fields,
        };
        appendFileSync(path, `${JSON.stringify(record)}\n`);
      },
    }),
  };
}

/** Every event in a state directory's stream, in the order it was recorded. */
export function readEvents(directory) {
  return readFileSync(streamPath(directory), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}
