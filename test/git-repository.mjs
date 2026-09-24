// ABOUTME: The one fixture a test that needs a git repository builds it through — a git runner
// that names the environment every child runs under, a repository built at a root, and a clone.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';

/**
 * Runs git in the repository at `root` and returns what it printed, refusing anything it did not
 * answer.
 *
 * The environment is named rather than inherited, which is the whole reason this is one function
 * and not one per test file. A suite runs from `.githooks/pre-commit`, `AGENTS.md` requires a
 * worktree for every piece of work, and a linked worktree's hook exports `GIT_DIR` and an absolute
 * `GIT_INDEX_FILE` naming the repository being committed. A git spawned under that environment
 * writes there rather than here: card #151 measured five commits titled `fixture`, four tracked
 * files and an overwritten `user.name` landing in a repository nobody named, and card #152 wrote
 * the same spawn back in afterwards.
 *
 * It refuses by throwing rather than by asserting, so the fixture carries no runner of its own and
 * the caller reads git's own complaint. A throw fails the test that called it exactly as the
 * status comparison each call site made for itself used to.
 */
export function gitIn(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment() });
  } catch (refused) {
    throw new Error(`git ${args.join(' ')} in ${root} failed: ${refused.stderr ?? refused.message}`);
  }
}

/**
 * A repository at `root` holding `files`, each key a relative posix-spelled path, with an identity
 * of its own so that a commit needs none from the host.
 *
 * The files are committed where there are any and not where there are none, because `commit`
 * refuses an empty tree and a repository with no commit is what three of the call sites wanted.
 * Taking the root as an argument is what lets a caller put one repository inside another, which is
 * the arrangement a search that walks past one has to be measured against.
 */
export function repositoryAt(root, files = {}) {
  mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 'fixture@example.invalid');
  gitIn(root, 'config', 'user.name', 'fixture');
  if (Object.keys(files).length > 0) {
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-qm', 'fixture');
  }
  return root;
}

/**
 * The same repository in a temporary directory of its own, under a name the caller chooses so that
 * a directory left behind says which suite wanted it.
 */
export function repositoryIn(prefix, files = {}) {
  return repositoryAt(mkdtempSync(join(tmpdir(), prefix)), files);
}

/**
 * A clone of the repository at `from`, made at `into`, with no hard links so that the two share no
 * object file.
 *
 * The second route a repository comes into being by, and the reason this fixture has two
 * functions rather than one: a clone is built by a git run outside any repository, so it takes no
 * root and `gitIn` cannot carry it.
 */
export function cloneInto(from, into) {
  try {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', from, into], {
      encoding: 'utf8', env: gitEnvironment(),
    });
  } catch (refused) {
    throw new Error(`cloning ${from} into ${into} failed: ${refused.stderr ?? refused.message}`);
  }
  return into;
}
