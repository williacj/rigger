// ABOUTME: The `run` verb: fires one pull through L3's dispatching entry point, which claims cards until
// the slots are full or nothing is left to pull, has L1 make and provision each one's workspace,
// dispatches each one's maker, and says what each maker did. It is `once` with no claim limit.

import { claimVerb } from './once.mjs';

/**
 * What the command prints for a `run` run, and the status it exits with. No limit is given, so
 * the pull claims until the slots are full: L3 reads N from the config it is handed.
 */
export const run = (options) => claimVerb('run', undefined, options);
