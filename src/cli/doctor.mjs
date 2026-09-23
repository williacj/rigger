// ABOUTME: The `doctor` verb: what it asks the tool that owns each fact, what it reports one line
// ABOUTME: at a time, and the source tree it refuses to run against.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runs a command and hands back what it answered, which is every authority this verb asks. */
const asked = (command, args) => spawnSync(command, args, { encoding: 'utf8' });

/**
 * The package this code is part of, which is the source tree `R-SAFE-5` is about.
 *
 * Taken from this module's own location rather than from `process.argv[1]` or the working
 * directory, because neither answers where the running code lives: an installed bin is reached
 * through a symlink in `node_modules/.bin`, and Node resolves that symlink before it sets
 * `import.meta.url` — which is what makes an `npm link`ed engine resolve back to the checkout it
 * was linked from, as `AGENTS.md`'s "Self-hosting" section says it must.
 */
export const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The same directory, spelled the way the filesystem spells it.
 *
 * Every comparison below is between real paths, because a path is a name and two names for one
 * directory are what a string comparison reads as two directories. Measured rather than reasoned,
 * each on the host it occurs on:
 *
 * - `git rev-parse --show-toplevel` answers `C:/Users/...` on Windows where `process.cwd()`
 *   answers `C:\Users\...`, so the two never compare equal unless both are resolved. Measured
 *   with git 2.55.0 on Windows 11;
 * - `realpathSync.native` answers the canonical casing on Windows, so a `c:\users\...` spelling
 *   of the checkout resolves to the `C:\Users\...` the same directory is listed under. Measured
 *   on the same host, where the lowercased path answered with the canonical one;
 * - on macOS `os.tmpdir()` answers `/var/folders/...` while a directory created under it answers
 *   `/private/var/folders/...` from within, `/var` being a symlink. Not measured here: this host
 *   is Windows, and the point is why the resolution happens rather than what it answers there.
 *
 * A path that is not there cannot be resolved, and is compared as written: a target that does not
 * exist is a fault the checks below report, not one to refuse the run over.
 */
export const real = (dir) => { try { return realpathSync.native(dir); } catch { return resolve(dir); } };

/**
 * Whether one directory is another or sits beneath it.
 *
 * `relative` rather than a prefix comparison, because a prefix reads a sibling whose name starts
 * with the same characters as a child: this repository's worktrees live in `rigger-worktrees/`
 * beside the `rigger/` checkout, and `'rigger-worktrees/card-34'.startsWith('rigger')` is true.
 * A worktree is where a dispatched maker works, so a check that refused one would refuse every
 * card this engine is built by.
 */
function within(outer, inner) {
  const step = relative(outer, inner);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
}

/**
 * Whether the tree being checked and the package doing the checking are one tree.
 *
 * Containment either way, because the two arrangements `R-SAFE-5` forbids sit either way about.
 * A run from inside the checkout — its root, or `docs/` beneath it — has the target within the
 * package. An engine installed into the target's own `node_modules` has the package within the
 * target, which is the arrangement where an agent clearing that directory deletes the runtime
 * mid-run. Equal paths are the plain case, and `within` reads them as either.
 */
export function sameTree(target, packageRoot = PACKAGE) {
  const [here, there] = [real(target), real(packageRoot)];
  return within(there, here) || within(here, there);
}

/**
 * The root of the repository a directory sits in, or the directory itself where git names none.
 *
 * Git owns what a repository is, so it is asked (`D16` rule 1). Where its answer can differ from
 * the directory handed in, measured by asking it rather than reasoned about: it walks up, so a
 * run from `docs/` inside a checkout answers the checkout, and a run from anywhere inside no
 * repository at all answers 128 and nothing on stdout, which falls through to the directory.
 * Measured with git 2.55.0.
 */
export function repoRoot(dir, ask = asked) {
  const said = ask('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  return real(said.status === 0 ? said.stdout.trim() : dir);
}

/** What the command prints for a `doctor` run, and the status it exits with. */
export async function doctor({ target = process.cwd(), packageRoot = PACKAGE, ask = asked } = {}) {
  const repository = repoRoot(target, ask);
  if (sameTree(repository, packageRoot)) {
    return {
      text: `rigger doctor: ${repository} is the source tree this Rigger is running from, and Rigger `
        + 'never runs against that (`R-SAFE-5`). Install the package outside this tree and run it '
        + 'from there.',
      code: 1,
    };
  }
  return { text: '', code: 0 };
}
