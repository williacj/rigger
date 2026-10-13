// ABOUTME: The prepack script: records the commit the package is packed from in
// src/package-commit.json, which `init` pins the gate workflow to, and only where the pack holds
// exactly that commit's files; otherwise it removes any record, so nothing pins code not packed.

import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';

/** The package this script ships in: the directory above `scripts/`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The record, as a path relative to the package. `.gitignore` names it, and `files` carries it. */
const RECORD = 'src/package-commit.json';

/**
 * What `command` printed on stdout run in the package under `env`, or null where it did not exit
 * 0. git is handed the environment `gitEnvironment` gives, so a pack run under a git hook asks
 * about this package and not the repository the hook names.
 */
function answer(command, args, env = command === 'git' ? gitEnvironment() : process.env) {
  try {
    return execFileSync(command, args, { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/**
 * The commit to record: `HEAD`'s full SHA, or null where the package is outside a git repository,
 * has no commit, or the pack would not hold exactly `HEAD`'s files. npm is asked what the pack
 * carries (`D16`), with scripts off so this script does not run again; git is asked what `HEAD`
 * holds. The pack holds `HEAD`'s files where:
 * 1. every path the pack carries is a file `HEAD` holds, whatever git's ignore rules say of it;
 * 2. every file `HEAD` holds under a directory `files` names is one the pack carries;
 * 3. no path the pack carries differs from `HEAD` in the tree.
 */
function commitToRecord() {
  const head = answer('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])?.trim();
  if (!head) return null;
  const listed = answer('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error']);
  if (listed === null) return null;
  const packed = JSON.parse(listed)[0].files.map((file) => file.path).filter((path) => path !== RECORD);
  const held = answer('git', ['ls-tree', '-r', '-z', '--name-only', head]);
  if (held === null) return null;
  const atHead = new Set(held.split('\0').filter(Boolean));
  if (!packed.every((path) => atHead.has(path))) return null;
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).files ?? [];
  const under = [...atHead].filter((path) => declared.some((directory) => path.startsWith(directory.endsWith('/') ? directory : `${directory}/`)));
  if (!under.every((path) => packed.includes(path))) return null;
  return answer('git', ['diff', '--quiet', head, '--', ...packed]) === null ? null : head;
}

const commit = commitToRecord();
const record = join(ROOT, RECORD);
if (commit === null) {
  rmSync(record, { force: true });
} else {
  // Written whole and then moved into place, so a pack running beside this one never reads half.
  const written = `${record}.${process.pid}`;
  writeFileSync(written, `${JSON.stringify({ commit })}\n`);
  renameSync(written, record);
}
