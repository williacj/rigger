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
 * What `work` answers, handed the run's sink, opened before `work` makes any spawn; `run`, the run
 * id the sink stamps on every event, which a verb hands what it writes rather than drawing an id of
 * its own (the architect's placement ruling, finding 4, on #937); `name`, which names the state
 * directory in the repository `named` once the guard has settled it; and `admitted`, by which the
 * verb names the config it read once the validator admitted it.
 *
 * L0 is handed the sink's end when it opens, so an ending the verb does not return through, a
 * signal among them, still ends it after L0's kills. The sink is ended on every path `work`
 * returns or throws through, and ending it twice writes nothing more (the architect's ruling 3,
 * §3, on #332).
 *
 * `push`, where given, is L5's push, which `src/cli/verbs.mjs` hands each verb: once `work` returns
 * normally, having named both a repository and a config, and before the sink ends, it is handed
 * the sink, the run, that config, that repository and its state directory, and the verb's answer,
 * and answers the answer the verb gives. A path that throws, a signal and exit cleanup never reach
 * it, and a caller handing none, as the gate script does, never pushes (the architect's attack on
 * #1122, placement A).
 */
export async function recording(work, push) {
  const run = randomUUID();
  const sink = openSink({ run, now: Date.now });
  atExit(sink.end);
  let repository;
  let config;
  const name = (named) => {
    sink.name(join(named, STATE));
    repository = named;
  };
  try {
    const answer = await work({ sink, run, name, admitted: (read) => { config = read; } });
    if (push === undefined || repository === undefined || config === undefined) return answer;
    return await push({ sink, run, config, repository, directory: join(repository, STATE), answer });
  } finally {
    sink.end();
  }
}
