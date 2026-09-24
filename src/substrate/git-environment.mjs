// ABOUTME: The environment a git child is given, so a git Rigger spawns acts on the repository
// the call names rather than one an inherited variable names.

/**
 * The variables by which an inherited environment redirects git away from the repository a call
 * names.
 *
 * Measured rather than read off a list: each candidate was set to a second repository's paths and
 * six surfaces of `git -C <fixture>` compared against the same surfaces with nothing set, with
 * git 2.55.0 on Windows 11. These five moved at least one surface — `GIT_DIR` moved the git dir,
 * `HEAD`, the index and the object store; `GIT_COMMON_DIR` and `GIT_OBJECT_DIRECTORY` the object
 * store; `GIT_WORK_TREE` the top level; `GIT_INDEX_FILE` the index.
 * `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES` and `GIT_PREFIX`
 * moved none of them, in either call shape this repository spawns git in, and so are left alone.
 * The run is in `docs/journal/2026-09-24-0745-151-the-hook-exported-the-branch-it-was-committing.md`.
 *
 * Card #167 took `GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_CEILING_DIRECTORIES` further, on the
 * ground that moving none of the six does not by itself settle whether a variable is safe to
 * inherit. The first does move a surface outside them: set to a second repository's object store,
 * that repository's objects become readable here, where with nothing set `git cat-file -e` on one
 * exits 1. The second moves no surface at all in that shape; it bites only on an ancestor of the
 * directory git runs in, and there it withholds the repository git would have found rather than
 * naming a different one — measured across a repository nested inside another, so that a redirect
 * had a second repository to reach. Neither reaches a write: with each set to a throwaway second
 * repository, that repository is unchanged to the byte after fifteen write shapes. Card #151's
 * fault was a write to a repository nobody named, so on that test neither is added, and a
 * variable that widens a read is a divergence this list does not claim to cover. The run is in
 * `docs/journal/2026-09-24-1720-167-a-read-is-not-a-write.md`.
 */
export const REDIRECTING = [
  'GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
];

/** The same names, for the case-folded comparison below. */
const REMOVED = new Set(REDIRECTING);

/**
 * `from` with every redirecting variable removed, for a git child to inherit. Everything else is
 * handed on, because git reads its own configuration, credential helper and proxy out of the
 * environment.
 *
 * The comparison folds case because the host may. Measured on the same host: `git_dir` and
 * `Git_Dir` redirect git exactly as `GIT_DIR` does, Windows folding environment names, while
 * `Object.keys(process.env)` reports each key in the case it was written — so deleting the
 * upper-case spelling alone leaves the redirect standing. No variable git honours is spelled in
 * lower case on a host that distinguishes them, so folding costs nothing there.
 */
export function gitEnvironment(from = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(from)) {
    if (!REMOVED.has(name.toUpperCase())) env[name] = value;
  }
  return env;
}
