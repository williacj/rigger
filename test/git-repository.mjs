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
  // No commit here starts git's maintenance in the background, which writes under `.git` on its
  // own time, so a test comparing what is under a repository races nothing but what it runs.
  gitIn(root, 'config', 'maintenance.auto', 'false');
  gitIn(root, 'config', 'gc.auto', '0');
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

/**
 * A bare clone of the repository at `from`, made at `into`, as the remote a test pushes to and
 * fetches from is. Git runs in the directory `into` will be made in, which already exists.
 */
export function bareCloneInto(from, into) {
  gitIn(dirname(into), 'clone', '--quiet', '--bare', '--no-hardlinks', from, into);
  return into;
}

/**
 * Gives the repository at `repository` a local `origin`: a bare clone of it made at `into`, as the
 * forge's main line a workspace starts from. Hands back `repository`.
 */
export function withOrigin(repository, into) {
  bareCloneInto(repository, into);
  gitIn(repository, 'remote', 'add', 'origin', into);
  return repository;
}

/**
 * The arrangement a test of workspaces made from the forge's main line starts from, under
 * `directory`: a repository at `source` holding one committed `README` on `main`, its local
 * `origin`, a bare clone of it at `origin.git` given as `withOrigin` gives one, and a clone of that
 * `origin` at `repository`. Answers the three paths.
 */
export function clonedFromOrigin(directory) {
  const source = repositoryAt(join(directory, 'source'), { README: 'one\n' });
  gitIn(source, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(source, origin);
  const repository = cloneInto(origin, join(directory, 'repository'));
  return { source, origin, repository };
}

/**
 * A worktree of the repository at `repository`, made at `path` on a new branch `branch` by git
 * itself, for a test whose subject is what it finds there rather than how it was made. `flags`
 * go to `git worktree add` as they are, such as `--lock`.
 */
export function worktreeAt(repository, path, branch, ...flags) {
  gitIn(repository, 'worktree', 'add', '--quiet', ...flags, '-b', branch, path);
  return path;
}

/**
 * A worktree of the repository at `repository`, made at `path` by git itself with its `HEAD`
 * detached at `commit`, making no branch, as a judge's directory holds them. `flags` go to `git
 * worktree add` as they are, such as `--lock`.
 */
export function detachedWorktreeAt(repository, path, commit, ...flags) {
  gitIn(repository, 'worktree', 'add', '--quiet', ...flags, '--detach', path, commit);
  return path;
}

/**
 * Makes `branch` the previous checkout in the repository at `repository`, holding a commit its
 * current branch does not, and checks the current branch out again, so `@{-1}` names `branch`.
 * Hands back the commit `branch` holds.
 */
export function previousCheckout(repository, branch) {
  const current = gitIn(repository, 'symbolic-ref', '--short', 'HEAD').trim();
  gitIn(repository, 'switch', '-q', '-c', branch);
  gitIn(repository, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', `${branch}'s own commit`);
  const held = gitIn(repository, 'rev-parse', 'HEAD').trim();
  gitIn(repository, 'switch', '-q', current);
  return held;
}

/** What `git worktree list --porcelain` prints in the repository at `repository`. */
export const worktreeList = (repository) => gitIn(repository, 'worktree', 'list', '--porcelain');
