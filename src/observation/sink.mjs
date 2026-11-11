// ABOUTME: L5's event sink: it stamps every event with the envelope and appends it to one JSONL
// stream in the consumer's state directory, holding events until the verb names that directory,
// and reads the stream back.

// One event is one synchronous append of one line. The host tests read back returned emits
// after SIGKILL, and check separate writers sharing a stream at 200 bytes and 1 MiB per line.
// There is no explicit disk flush, so power loss can still lose the tail. A reader ignores
// bytes after the last newline and refuses malformed newline-terminated JSON.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { writeWhole } from '../substrate/standard-error.mjs';

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
export const streamPath = (directory) => join(directory, STREAM);

/**
 * Open the sink for one run.
 *
 * `now` is the run's clock, read once per event, and it returns epoch milliseconds. `directory`
 * may be left out: a verb opens the sink before its first spawn, which comes before it knows the
 * state directory, and names it later (delta H5). Until then the sink holds each event, stamped
 * when it was emitted.
 *
 * `end` is idempotent, because the verb and L0's exit cleanup can each call it. A sink never
 * named writes what it held to standard error there, and any event after that as it arrives. A
 * reader of standard error that stops draining it holds either write for no longer than
 * `UNDRAINED_BOUND`, and what it did not take is dropped (`writeWhole`).
 */
export function openSink({ directory, run, now }) {
  required(run, 'run');
  required(now, 'now');
  let named = directory;
  let made = false;
  let ended = false;
  const held = [];

  /** One event onto the stream. The directory is made at the first, so a quiet verb makes none. */
  function append(line) {
    if (!made) mkdirSync(named, { recursive: true });
    made = true;
    appendFileSync(streamPath(named), line);
  }

  /**
   * Name the state directory, and write there first every event held until now.
   *
   * A held event was never an append, so nothing refused it. A refusal here is the first, and the
   * failure carries every held event it left unrecorded, because once it is thrown the sink no
   * longer holds them.
   */
  function name(given) {
    named = given;
    const lines = held.splice(0);
    for (const [index, line] of lines.entries()) {
      try {
        append(line);
      } catch (cause) {
        const unrecorded = lines.slice(index);
        throw new Error(
          `${cause.message}\n${unrecorded.length} held event(s) went unrecorded:\n${unrecorded.join('')}`,
          { cause },
        );
      }
    }
  }

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
        const line = `${JSON.stringify(record)}\n`;
        if (named !== undefined) append(line);
        else if (ended) writeWhole(line);
        else held.push(line);
      },
    };
  }

  /** End the run's sink. One never named writes what it held to standard error. */
  function end() {
    ended = true;
    writeWhole(held.splice(0).join(''));
  }

  return { emitter, name, end };
}

/** The envelope checked at L5's read boundary, before any derivation receives the event. */
function checkEventEnvelope(event) {
  const describe = (value) => {
    let lossy = false;
    const json = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === 'number' && (!Number.isFinite(nested) || Object.is(nested, -0))) lossy = true;
      return nested;
    });
    return lossy ? inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity, compact: true }) : json ?? 'missing';
  };
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error(`its envelope is ${describe(event)}, not a plain object`);
  }
  const refuse = (field, contract) => {
    throw new Error(`its \`${field}\` is ${describe(event[field])}, not ${contract}`);
  };
  const ts = event.ts;
  if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts)) || new Date(ts).toISOString() !== ts) {
    refuse('ts', 'an instant in UTC');
  }
  for (const field of ['run', 'event']) {
    if (typeof event[field] !== 'string' || event[field] === '') {
      refuse(field, 'a non-empty string');
    }
  }
  if (!['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].includes(event.layer)) {
    refuse('layer', 'L0 through L6');
  }
  if (Object.hasOwn(event, 'card') && !(Number.isSafeInteger(event.card) && event.card > 0)) {
    refuse('card', 'a safe integer above zero');
  }
  if (Object.hasOwn(event, 'dispatch') && event.dispatch !== null && (typeof event.dispatch !== 'string' || event.dispatch === '')) {
    refuse('dispatch', 'null or a non-empty string');
  }
  return event;
}

/**
 * Every event in a state directory's stream, in the order it was recorded.
 *
 * The bytes after the last newline have not yet become an event. Every complete line is read
 * separately, so the whole stream needs no single JavaScript string. A malformed complete line
 * is refused by its line number: passing over damage would contradict R-RECORD-6.
 */
export function readEvents(directory) {
  const path = streamPath(directory);
  const stream = readFileSync(path);
  const events = [];
  let start = 0;
  let index = 0;
  for (let end = stream.indexOf(0x0a); end !== -1; end = stream.indexOf(0x0a, start)) {
    const line = stream.toString('utf8', start, end);
    start = end + 1;
    try {
      events.push(checkEventEnvelope(JSON.parse(line)));
    } catch (cause) {
      throw new Error(`${path} line ${index + 1} is not a recorded event`, { cause });
    }
    index += 1;
  }
  return events;
}
