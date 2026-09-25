// ABOUTME: Preloaded with `--import` to record every `gh` request the forge adapter's sides issue
// while a test file runs, written as JSON to the path after the file when the process exits.

import { writeFileSync } from 'node:fs';
import { register } from 'node:module';

// Called by name, not as a namespace's members, so a request still reaches the spawn from the
// runner itself, which `forge-read.test.mjs` reads off the stack.
import { itemWriteRunner as itemWrite, readRunner as read, schemaWriteRunner as schemaWrite } from '../src/substrate/forge/runners.mjs';

export * from '../src/substrate/forge/runners.mjs';

/** Every request recorded, each the command's arguments, JSON-encoded so each is kept once. */
const requests = new Set();

const record = (args) => requests.add(JSON.stringify(args));

/** The read runner, recording each request a side hands it. */
export const readRunner = (args, options) => {
  record(args);
  return read(args, options);
};

/**
 * A write runner recording each request it sends: the write, and the runner's own read of what it
 * checks the write against, which it sends itself and hands no other runner.
 */
const recordingSends = (runner) => (args, options = {}) => {
  const { send } = options;
  const recorded = send && ((command, sent) => {
    record(sent);
    return send(command, sent);
  });
  return runner(args, { ...options, send: recorded });
};

/** The schema-write runner, recording each write and its read of the options an options write names. */
export const schemaWriteRunner = recordingSends(schemaWrite);

/** The item-write runner, recording each move and its read of which field holds the columns. */
export const itemWriteRunner = recordingSends(itemWrite);

// Run as `node --import gh-recording.mjs <test file> <record path>`. `node --test` also runs this
// file, as it runs every module under test/, and names no record path, so it records nothing.
const [, , into] = process.argv;
if (into) {
  // Each side's import of the runners is given this module in their place.
  register('./gh-recording-hooks.mjs', import.meta.url);
  process.on('exit', () => writeFileSync(into, JSON.stringify([...requests].map((request) => JSON.parse(request)))));
}
