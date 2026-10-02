// ABOUTME: The suite's one maker of temporary directories under TMPDIR, each removed when the test
// that made it ends, passed or failed, after that test's own teardown, or, made at a file's top
// level, once the file's tests have ended.

import { after } from 'node:test';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A new directory under `TMPDIR`, its name `prefix` and six random characters, removed when the
 * test that made it ends. No test under `test/` names `mkdtempSync` but this one
 * (test/bare-mkdtemp-check.test.mjs).
 *
 * The removal is registered on the running test: on `context` where the caller passes one, and
 * otherwise through `node:test`'s own `after`, which registers it on whichever test is running,
 * made in its body or in a function it awaited. Made at a test file's top level, outside every
 * test, the directory is the file's, and is removed once all of the file's tests have ended. Made
 * in a suite's `before` hook, it is removed before the suite's tests run, so none is made there.
 * `beforeRemoval` runs before the removal, at the start of the test's teardown and again just
 * before the removal, and where it throws, the directory is left.
 */
export function temporaryDirectory(prefix, { context, beforeRemoval = () => {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  let ran = false;
  const removal = () => {
    if (ran) return;
    ran = true;
    beforeRemoval();
    removed(directory);
  };
  const register = context ? (hook) => context.after(hook) : after;
  register((running) => {
    const t = context ?? running;
    beforeRemoval();
    // The test's own teardown, registered after this, may still need the directory, as one giving
    // back a permission it took does. `node:test` runs a hook added during teardown after every
    // other, so the removal waits for theirs. A suite's context takes no hook, and its tests have
    // all ended by its teardown, so the removal runs there.
    if (typeof t?.after !== 'function') return removal();
    t.after(removal);
    // A hook of the test's own that throws stops every hook after it, this removal's included.
    // `node:test` aborts the test's signal once its hooks have run, however they ended, so the
    // removal runs then where its hook did not. A signal a timeout already aborted never fires
    // again, so the removal never runs before the hooks. A stand-in context with no signal, which
    // runs the hooks it holds itself, has only the hook.
    t.signal?.addEventListener('abort', removal, { once: true });
  });
  return directory;
}

/**
 * Removes `directory` and everything in it, after giving its owner write permission on every
 * directory inside it, which a test may have taken away. Neither step follows a symbolic link: each
 * is removed as a link, and what it points to is left alone. A `directory` already gone is left so.
 */
function removed(directory) {
  if (!existsSync(directory)) return;
  writable(directory);
  rmSync(directory, { recursive: true });
}

/** Gives the owner read, write and search permission on `directory` and every directory in it. */
function writable(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error(`${directory} is no longer a directory, so its teardown removes nothing through it`);
  chmodSync(directory, lstatSync(directory).mode | 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) writable(join(directory, entry.name));
  }
}
