// ABOUTME: What every verb that opens L5's sink shares: the state directory's name, and the one way a
// verb opens its sink, hands L0 its end, and ends it on every path the verb returns through.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { openSink } from '../observation/sink.mjs';
import { atExit } from '../substrate/process.mjs';

/**
 * The state directory, where L5's stream lives. `ARCHITECTURE.md`'s Engine settings row names
 * `.rigger/` as its default, and the published config shape offers no key to name another.
 */
export const STATE = '.rigger';

/**
 * What `work` answers, handed the run's sink, opened before `work` makes any spawn, and `name`,
 * which names the state directory in the repository `named` once the guard has settled it.
 *
 * L0 is handed the sink's end when it opens, so an ending the verb does not return through, a
 * signal among them, still ends it after L0's kills. The sink is ended on every path `work`
 * returns or throws through, and ending it twice writes nothing more (the architect's ruling 3,
 * §3, on #332).
 */
export async function recording(work) {
  const sink = openSink({ run: randomUUID(), now: Date.now });
  atExit(sink.end);
  try {
    return await work({ sink, name: (named) => sink.name(join(named, STATE)) });
  } finally {
    sink.end();
  }
}
