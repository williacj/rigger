// ABOUTME: A recording stand-in for the `claude` executable, for a test that runs a verb asking
// whether Claude Code is signed in, which must never reach the real one under `npm test`.

import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { stubGh } from './stub-gh.mjs';

/**
 * A directory holding an executable named `claude` that records every call it receives and
 * answers `answer`, as `stubGh` builds one named `gh`: `first(path)` puts it ahead of `path`,
 * and `calls()` lists what it was asked.
 *
 * It is `stubGh`'s stand-in under the other name, because the stand-in reads its record and its
 * answer beside its own path, whatever it is called.
 */
export function stubClaude(answer) {
  const stub = stubGh(answer);
  renameSync(join(stub.dir, 'gh'), join(stub.dir, 'claude'));
  return stub;
}
