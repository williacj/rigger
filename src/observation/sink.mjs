// ABOUTME: L5's event sink: it stamps every event with the envelope and appends it to one JSONL
// stream in the consumer's state directory, holding events until the verb names that directory,
// and reads the stream back.

// One event is one synchronous append of one line. The host tests read back returned emits
// after SIGKILL, and check separate writers sharing a stream at 200 bytes and 1 MiB per line.
// There is no explicit disk flush, so power loss can still lose the tail. A reader ignores
// bytes after the last newline, passes over the fragment a torn append left before a whole event
// on the same line, and refuses any other newline-terminated line that is not one event
// (ARCHITECTURE.md, "A torn tail").

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeWhole } from '../substrate/standard-error.mjs';

const STREAM = 'events.jsonl';

// Where every line of the sink's form begins, because the envelope's `ts` comes first.
const LINE_START = '{"ts":"';

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
 * An event leaves the hold only once the append of its whole line returns, and every later append
 * first appends what is still held, in emit order.
 *
 * `end` is idempotent, because the verb and L0's exit cleanup can each call it. A named sink first
 * appends what it still holds there. A sink never named, or one whose state directory refuses that
 * append, writes what it held to standard error there, and a sink never named writes any event
 * after that to standard error as it arrives. A reader of standard error that stops draining it
 * holds either write for no longer than `UNDRAINED_BOUND`, and what it did not take is dropped
 * (`writeWhole`).
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

  /** Every held event onto the stream, in emit order, each leaving the hold once its append returns. */
  function release() {
    while (held.length > 0) {
      append(held[0]);
      held.shift();
    }
  }

  /**
   * Name the state directory, and write there first every event held until now.
   *
   * A held event was never an append, so nothing refused it. A refusal here is the first, and the
   * failure names every held event its append did not write, the one it tore included, each
   * indented: the sink still holds them, so its next append, or its end, writes each as a record
   * line of its own, and the failure is no second copy of one.
   */
  function name(given) {
    named = given;
    try {
      release();
    } catch (cause) {
      throw new Error(
        `${cause.message}\n${held.length} held event(s) went unrecorded at this naming, and the sink still holds them:\n${held.map((line) => `  ${line}`).join('')}`,
        { cause },
      );
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
        if (named !== undefined) {
          release();
          append(line);
        } else if (ended) writeWhole(line);
        else held.push(line);
      },
    };
  }

  /**
   * End the run's sink. A named one appends what it still holds; what it cannot append, and what a
   * sink never named held, goes to standard error.
   */
  function end() {
    ended = true;
    if (named !== undefined) {
      try {
        release();
      } catch {
        // What the state directory refused is still held, and standard error is left for it.
      }
    }
    writeWhole(held.splice(0).join(''));
  }

  return { emitter, name, end };
}

/** The envelope checked at L5's read boundary, before any derivation receives the event. */
function checkEventEnvelope(event) {
  const describe = (value) => {
    const maximumDepth = 4;
    const maximumLength = 256;
    const elision = '…';
    // Quote only a bounded string, never an entire input object or an unbounded key/value.
    const quote = (text) => JSON.stringify(text.slice(0, maximumLength));
    function* members(container) {
      if (Array.isArray(container)) {
        for (let index = 0; index < container.length; index += 1) yield [undefined, container[index]];
      } else {
        for (const key in container) if (Object.hasOwn(container, key)) yield [key, container[key]];
      }
    }
    const pending = [{ value, depth: 0 }];
    let shown = '';
    while (pending.length > 0 && shown.length < maximumLength) {
      const part = pending.pop();
      if (typeof part === 'string') {
        shown += part;
      } else if (part.iterator) {
        const next = part.iterator.next();
        if (next.done) {
          shown += part.close;
          continue;
        }
        if (!part.first) shown += ',';
        part.first = false;
        pending.push(part);
        const [key, member] = next.value;
        pending.push({ value: member, depth: part.depth });
        if (key !== undefined) pending.push(`${quote(key)}:`);
      } else {
        const { value, depth } = part;
        if (value !== null && typeof value === 'object') {
          if (depth >= maximumDepth) {
            shown += elision;
            continue;
          }
          const array = Array.isArray(value);
          shown += array ? '[' : '{';
          pending.push({ iterator: members(value), first: true, depth: depth + 1, close: array ? ']' : '}' });
        } else if (typeof value === 'string') {
          shown += quote(value);
        } else if (typeof value === 'number') {
          shown += Object.is(value, -0) ? '-0' : String(value);
        } else {
          shown += JSON.stringify(value) ?? 'missing';
        }
      }
    }
    return pending.length > 0 || shown.length > maximumLength ? shown.slice(0, maximumLength - elision.length) + elision : shown;
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
 * The event a line holds after its fragments: the one from the leftmost offset past the line's
 * start where a sink line begins and the rest of the line is one event, or `undefined` for none.
 */
function afterFragment(line) {
  for (let offset = line.indexOf(LINE_START, 1); offset !== -1; offset = line.indexOf(LINE_START, offset + 1)) {
    try {
      return checkEventEnvelope(JSON.parse(line.slice(offset)));
    } catch {
      // Not one event from here; a later offset may be.
    }
  }
  return undefined;
}

/**
 * Every event in a state directory's stream, in the order it was recorded.
 *
 * The bytes after the last newline have not yet become an event. Every complete line is read
 * separately, so the whole stream needs no single JavaScript string. A complete line that is not
 * one event, but begins with `{` and holds one from a later offset where a sink line begins, is a
 * torn append's fragment followed by that event: the event is returned and the fragment passed
 * over (ARCHITECTURE.md, "A torn tail", rule 3). Any other such line is refused by its line number:
 * passing over damage would contradict R-RECORD-6.
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
      const event = line.startsWith('{') ? afterFragment(line) : undefined;
      if (event === undefined) throw new Error(`${path} line ${index + 1} is not a recorded event`, { cause });
      events.push(event);
    }
    index += 1;
  }
  return events;
}
