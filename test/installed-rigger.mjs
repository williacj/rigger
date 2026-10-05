// ABOUTME: This checkout packed into a tarball and installed from it outside the checkout, with a
// path holding only node and git for the installed `rigger` to run under. Test-only, and never
// named from src/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';

/** Runs a shell command in `cwd` and hands back what it printed, refusing a non-zero exit by throwing. */
function ran(command, cwd) {
  // Handed the environment a git child gets, because each command is built at run time, so the
  // suite's sweep of every spawn cannot rule out that it reaches git
  // (`test/git-environment.test.mjs`).
  const done = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: gitEnvironment() });
  if (done.status !== 0) throw new Error(`\`${command}\` in ${cwd} failed: ${done.stdout}${done.stderr}`);
  return done.stdout;
}

/**
 * The checkout at `root` packed into a tarball and installed from it, both under `into`, a
 * directory outside the checkout (`R-SAFE-5`: Rigger never runs from its own source tree).
 * Offline, because the package has no runtime dependencies and so an install that needs the
 * network has gone wrong.
 *
 * It returns `consumer`, the directory the package was installed into; `rigger`, the installed
 * bin; and `path`, a directory holding only node and git, so that a `doctor` run under it finds
 * no agent CLI to ask and no `gh` but the stand-in a caller puts in front of it. Asking the real
 * ones reaches the network, and a caller that must pass without it needs a path this narrow.
 */
export function installFromTarball(root, into) {
  const packs = join(into, 'packs');
  mkdirSync(packs, { recursive: true });
  const [{ filename }] = JSON.parse(ran(`npm pack --json --loglevel=error --logs-dir "${join(into, 'npm-logs')}" --pack-destination "${packs}"`, root));

  const consumer = join(into, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true }));
  ran(`npm install --offline --no-audit --no-fund --loglevel=error --logs-dir "${join(into, 'npm-logs')}" "${join(packs, filename)}"`, consumer);

  const bin = join(into, 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(ran('command -v git', root).trim(), join(bin, 'git'));

  return { consumer, rigger: join(consumer, 'node_modules', '.bin', 'rigger'), path: bin };
}
