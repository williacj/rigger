// ABOUTME: Places a stream's refusal at the command or event boundary a call-event test exercises.

import { renameSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, shellQuote } from './process-fixtures.mjs';

/** Wraps a fixture command, preserving its result and running an action after its answer. */
function afterCommand(directory, command, action) {
  const original = join(directory, `${command}-answer`);
  renameSync(join(directory, command), original);
  return fixture(directory, command, [shellQuote(original) + ' "$@"', 'status=$?', action, 'exit $status'].join('\n'));
}

/** Makes the stream unappendable after the target command has answered, before its kills are recorded. */
export function refuseAfterCommand(directory, command, stream, { apiOnly = false } = {}) {
  const block = `rm -f ${shellQuote(stream)}; mkdir -p ${shellQuote(stream)}`;
  return afterCommand(directory, command, apiOnly ? `if [ "$1" = api ]; then ${block}; fi` : block);
}

/** Installs a child-only append failure at an event, with every later append refused by the filesystem. */
function eventRefusal(directory, stream, event, armed) {
  const module = join(directory, 'refuse-stream.mjs');
  writeFileSync(module, `// ABOUTME: Starts this fixture's real filesystem refusal at its selected event.
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const stream = ${JSON.stringify(stream)};
    const append = fs.appendFileSync;
    let blocked = false;
    fs.appendFileSync = function(path, content, ...rest) {
      if (!blocked && path === stream) {
        const row = JSON.parse(String(content));
        if (row.event === ${JSON.stringify(event)} && ${armed ? `fs.existsSync(${JSON.stringify(armed)})` : 'true'}) {
          fs.rmSync(stream, { force: true });
          fs.mkdirSync(stream, { recursive: true });
          blocked = true;
        }
      }
      return append.call(this, path, content, ...rest);
    };
    syncBuiltinESMExports();
  `);
  return [process.env.NODE_OPTIONS, `--import=${pathToFileURL(module).href}`].filter(Boolean).join(' ');
}

/** Runs the real verb with a refusal beginning at the selected append, leaving its assertions intact. */
export async function withRefusedEvent(directory, stream, event, work) {
  const held = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = eventRefusal(directory, stream, event);
  try { return await work(); }
  finally {
    if (held === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = held;
  }
}

/** Arms at the board read; its dependent facts finish before the pull's first start append is refused. */
export function refuseAfterBoardRead(directory, gh, stream) {
  const armed = join(directory, 'board-read');
  afterCommand(dirname(gh), 'gh', `case "$*" in *'items('*) : > ${shellQuote(armed)} ;; esac`);
  return eventRefusal(directory, stream, 'pull', armed);
}
