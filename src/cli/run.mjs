// ABOUTME: The `run` verb: claims cards through L3's claim-only call until the slots are full or
// nothing is left to pull, dispatches nothing, and says so. It is `once` with no claim limit.

import { claimVerb } from './once.mjs';

/**
 * What the command prints for a `run` run, and the status it exits with. No limit is given, so
 * the call claims until the slots are full: L3 reads N from the config it is handed.
 */
export const run = (options) => claimVerb('run', undefined, options);
