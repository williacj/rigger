// ABOUTME: The one definition of how long a test that waits may run before it fails rather than
// holding the suite, for each bound a test file here takes, in milliseconds.

/**
 * `test`'s options bounding a test at each bound a test file here takes, by its milliseconds:
 * `SETTLES_WITHIN[60_000]` is `{ timeout: 60_000 }`. A file takes its bound by name, as
 * `const { 60_000: SETTLES_WITHIN } = BOUNDS`, so the bound it gives stays on its own line.
 */
export const SETTLES_WITHIN = Object.freeze(Object.fromEntries(
  [10_000, 20_000, 60_000].map((milliseconds) => [milliseconds, Object.freeze({ timeout: milliseconds })]),
));
