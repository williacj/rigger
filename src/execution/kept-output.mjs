// ABOUTME: L1 keeps each role dispatch's output bytes locally, separately from the event stream.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Keeps both streams exactly as L1 returned them, under the dispatch's id. */
export function keepOutput({ directory, id, card, sink, result }) {
  for (const stream of ['stdout', 'stderr']) {
    const path = join(directory, 'output', id, stream);
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, result[stream], { mode: 0o600 });
    } catch (cause) {
      try {
        sink.emitter({ layer: 'L1', card, dispatch: id }).emit('output.failed', { path, reason: cause.message });
      } catch {
        // An unavailable sink cannot record this failure either; keeping never changes the dispatch's outcome.
      }
    }
  }
}
