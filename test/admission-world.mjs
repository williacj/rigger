// ABOUTME: The shared ground of the admission tests: a state directory of the test's own, closers
// seeded into it by hand, a sink that records or refuses, and a byte-for-byte picture of the directory.

import * as fs from 'node:fs';
import { join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';
import { admission } from '../src/scheduling/admission.mjs';

/** The time every closer here is written at: a fixed epoch-millisecond value, read off no clock. */
export const TIME = 1_760_000_000_123;

/** The run id every module here is made under. */
export const RUN = 'r-admission-test';

/** A state directory, `.rigger`, under the test's own temporary directory, not yet made. */
export const stateOf = () => join(temporaryDirectory('admission-'), '.rigger');

/** The admission directory inside state directory `state`. */
export const admissionOf = (state) => join(state, 'admission');

/** The content a readable closer holds, written by hand rather than by the module. */
export const closerText = ({ reason = 'paused by hand', time = TIME, run = RUN } = {}) => JSON.stringify({ reason, time, run });

/** Writes `content` as entry `name` of the admission directory in `state`, making the directory. */
export function seed(state, name, content = closerText()) {
  fs.mkdirSync(admissionOf(state), { recursive: true });
  fs.writeFileSync(join(admissionOf(state), name), content);
}

/**
 * A sink that records each event it is handed, with the layer its emitter was made for, and
 * calls `onEmit` with each first, which may throw to refuse it.
 */
export function recordingSink(onEmit = () => {}) {
  const events = [];
  const sink = {
    emitter: ({ layer }) => ({
      emit(event, fields) {
        onEmit(event, fields);
        events.push({ layer, event, ...fields });
      },
    }),
  };
  return { sink, events };
}

/** A sink refusing every event, as one whose append fails does. */
export const refusingSink = () => recordingSink((event) => {
  throw new Error(`the stream refused ${event}`);
});

/** An admission module over `state`, its clock at `TIME`, its run `RUN`, and a recording sink unless one is handed. */
export function moduleOver(state, options = {}) {
  const recording = options.sink ? { sink: options.sink, events: undefined } : recordingSink();
  const made = admission({ directory: state, run: RUN, now: () => TIME, ...options, sink: recording.sink });
  return { ...made, events: recording.events };
}

/**
 * Every entry in `directory` by name: a symbolic link as its target, a directory as `dir`, and a
 * file as its bytes, so two pictures are equal only where no entry changed.
 */
export function picture(directory) {
  const entries = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = fs.lstatSync(path);
    if (stat.isSymbolicLink()) entries[name] = `link:${fs.readlinkSync(path)}`;
    else if (stat.isDirectory()) entries[name] = 'dir';
    else entries[name] = fs.readFileSync(path).toString('hex');
  }
  return entries;
}

/** The names in the admission directory of `state`. */
export const namesIn = (state) => fs.readdirSync(admissionOf(state)).sort();

/** The node:fs calls the module makes, each replaced where `overrides` names it. */
export const fsWith = (overrides) => ({ ...fs, ...overrides });

/** Whether this process runs as root, which reads and writes past every permission bit. */
export const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
