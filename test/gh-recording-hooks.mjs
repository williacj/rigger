// ABOUTME: The module hook `gh-recording.mjs` registers: a forge adapter side's import of the
// runners resolves to `gh-recording.mjs`, which records each request before it runs them.

/** The forge adapter's sides, which reach `gh` only through the runners. */
const SIDES = ['read.mjs', 'item-write.mjs', 'schema-write.mjs'].map((file) => `/src/substrate/forge/${file}`);

const RUNNERS = '/src/substrate/forge/runners.mjs';

const RECORDING = new URL('./gh-recording.mjs', import.meta.url).href;

/** Whether `url` is a file URL whose path ends in `path`. */
const at = (url, path) => url?.startsWith('file:') && new URL(url).pathname.endsWith(path);

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const fromSide = SIDES.some((side) => at(context.parentURL, side));
  return fromSide && at(resolved.url, RUNNERS) ? { url: RECORDING, shortCircuit: true } : resolved;
}
