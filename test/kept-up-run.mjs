// ABOUTME: Starts a loop world's `run` kept up by a clock trigger, collecting each hand-over L3
// makes as it settles, and holding the stop that ends the run.

/**
 * Starts `built`'s run with a hand-over function that keeps each hand-over in `handed`, in the
 * order L3 made them, and an `AbortSignal` as its stop. `stop()` fires the stop and answers the
 * run's own settling; `running` is that settling, its rejection already observed so a test that
 * reads it later raises no unhandled rejection.
 */
export function keptUp(built) {
  const handed = [];
  const controller = new AbortController();
  const running = built.loop.run({ handOver: (each) => handed.push(each), stop: controller.signal });
  running.catch(() => {});
  return {
    running,
    handed,
    stop: () => {
      controller.abort();
      return running;
    },
  };
}

/** The drain hand-overs among `handed`: each `{ status, value }` or `{ status, reason }`, in order. */
export const settledIn = (handed) => handed.filter(({ settled }) => settled !== undefined).map(({ settled }) => settled);

/** The reports among `handed`, in the order their firings settled. */
export const reportsIn = (handed) => handed.filter(({ report }) => report !== undefined).map(({ report }) => report);

/** The firings' failures among `handed`, in the order they settled. */
export const failuresIn = (handed) => handed.filter(({ failure }) => failure !== undefined).map(({ failure }) => failure);

/**
 * Starts `verb` through `clockVerb`, as a clocked consumer's verb held mid-card, handing it a writer
 * that keeps each hand-over's text in `written` and an `AbortSignal` as its stop. `stop()` fires
 * the stop and answers the verb's own answer.
 */
export async function keptUpVerb(clockVerb, verb, clock) {
  const written = [];
  const controller = new AbortController();
  const ran = await clockVerb((options) => verb({ ...options, write: (text) => written.push(text), stop: controller.signal }), clock);
  return {
    ...ran,
    written,
    stop: () => {
      controller.abort();
      return ran.running;
    },
  };
}
