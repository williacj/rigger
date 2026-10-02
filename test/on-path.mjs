// ABOUTME: Finds an executable the way a spawn finds it on a PATH, for tests that need to know
// which of several same-named executables a child would run.

import { accessSync, constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/**
 * The executable `name` a spawn finds on `path`, by its absolute path, passing over the directory
 * `skipping`, or null where there is none. An empty entry is the working directory to a spawn.
 */
export function onPath(name, path = '', skipping = null) {
  for (const dir of path.split(delimiter).map((entry) => resolve(entry || '.'))) {
    if (skipping !== null && dir === resolve(skipping)) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {
      // Not here, so the next directory is where a spawn would look.
    }
  }
  return null;
}
