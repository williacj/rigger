// ABOUTME: The `run` verb: hands L3 the board drain, which refills freed slots and dispatches
// each card's work through L1 and L2, with the shared claiming-verb presenter.

import { claimVerb } from './once.mjs';

/**
 * What the command prints and exits with. L3 reads N and the clock declaration from the config,
 * drains the board without a clock trigger, and otherwise keeps the run up until stopped.
 */
export const run = (options) => claimVerb('run', undefined, options);
