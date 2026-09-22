// ABOUTME: L5's event sink: it stamps every event with the envelope and appends it to one JSONL
// ABOUTME: stream in the consumer's state directory, and reads that stream back.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STREAM = 'events.jsonl';

// The envelope's own keys. The sink stamps every one of them, so a layer supplying one would be
// writing a fact about the run or the card that it is not the layer to know.
const ENVELOPE = ['ts', 'run', 'layer', 'event', 'card', 'dispatch'];

/**
 * What the sink cannot invent. An absent value would leave its field out of the JSON, and an
 * event missing one is not the event `R-RECORD-7` asks for, so the sink says so at the call.
 */
function required(value, name) {
  if (value === undefined) throw new Error(`the sink was given no ${name}, which every event carries`);
}

/** The one stream L5 owns, inside the state directory the consumer named. */
const streamPath = (directory) => join(directory, STREAM);

/**
 * Open the sink for one run.
 *
 * `now` is the run's clock, read once per event, and it returns epoch milliseconds.
 */
export function openSink({ directory, run, now }) {
  required(directory, 'directory');
  required(run, 'run');
  required(now, 'now');
  mkdirSync(directory, { recursive: true });
  const path = streamPath(directory);

  /** An emitter for one layer, and the card and dispatch its events arise under. */
  function emitter({ layer, card, dispatch }) {
    required(layer, 'layer');
    return {
      emit(event, fields) {
        required(event, 'event');
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
    };
  }

  return { emitter };
}

/**
 * Every event in a state directory's stream, in the order it was recorded.
 *
 * Anything that is not one event on one line is refused, named by the line it sits on. A reader
 * that passed over it would return the events either side of the damage as though the record
 * were whole, and R-RECORD-6 is the claim that it is.
 */
export function readEvents(directory) {
  const path = streamPath(directory);
  const lines = readFileSync(path, 'utf8').split('\n');
  const events = [];
  for (const [index, line] of lines.entries()) {
    // Every event ends in a newline, so the split's last piece is empty on a whole stream.
    if (line === '' && index === lines.length - 1) continue;
    try {
      events.push(JSON.parse(line));
    } catch (cause) {
      throw new Error(`${path} line ${index + 1} is not a recorded event`, { cause });
    }
  }
  return events;
}
