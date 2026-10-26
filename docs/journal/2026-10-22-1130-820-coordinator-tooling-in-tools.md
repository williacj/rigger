<!-- ABOUTME: Records card 820's move of the coordinator's launchers and slot into tools/coordinator/, and the sweep. -->

# The coordinator's tooling moves into the checkout

[#820](https://github.com/williacj/rigger/issues/820) moves the Codex launchers, the suite slot
and the two prompts into `tools/coordinator/`. It configures them per host, and adds the sweep
that removes a judge's or maker's directory once its pull requests have ended. The acceptance is
revision `d320ddf79da3`.

## The source copy

The source files were rebuilt from the tooling manifest on #816 (comment 6281534309, parts 2 and
3) by its rule: each block's lines between its `~~~~` fences, each ending in a newline, except
`codex-judge-prompt.md`. Measured with `shasum -a 256` on 2026-10-22, all eight rebuilt files
match the manifest's sha256.

## Choices the card left to the maker

- **The differential test's source copy.** The four source launchers and both source prompts are
  embedded in `test/coordinator-source.mjs`, each with the manifest's sha256. The test checks that
  sha256 before it runs anything, so the comparison also runs in CI. The prompts' slot lines spell
  the coordinator's home with a tilde, which no added line may name, so the fixture holds `$HOME`
  there and puts the tilde back at run time. The sha256 check shows the restored text is the
  manifest's. Round 1 found the first version fed the moved prompts to both copies, which could
  not see a prompt drift.
- **Which launcher a test runs.** Each launcher test, and each sweep test, reads its directory
  from `CODEX_TOOLS_DIR`, defaulting to `tools/coordinator/`. A judge can then rerun them
  against the rebuilt source copy.
- **No network.** Every tooling test runs git with `GIT_ALLOW_PROTOCOL=file`. A copy of a
  launcher that still names the GitHub URL fails at once, and never clones from it.
- **The sweep's exit statuses.** 0, 1 and 3 are its outcomes; 2 means it could not run at all.
- **What round 1 on #888 changed in the sweep.** It reads status with
  `--untracked-files=all`, because a clone's own config can hide untracked files. It keeps an
  entry whose pull request list fills the read's limit of 1000, because an open one may lie past
  it. It removes through `rm` on `PATH`, so a test can see each path printed before removal starts.
- **What round 2 on #888 changed in the sweep.** A clone marking any tracked file
  assume-unchanged or skip-worktree is kept, because `git status` trusts both bits and an edit
  under either is invisible to it. Where the clone's commits are not reached by a forge tip it
  holds, the sweep fetches the tips it lacks into a bare repository under its own temporary
  directory. That repository borrows the clone's objects through an alternate, so nothing is
  written into the clone or the root. A failed fetch keeps the clone, naming why.
- **`suite-slot.test.sh`** differs from the source only where it names the default slot
  directory. The check of `RIGGER_WORKTREE_ROOT` lives in `test/coordinator-suite-slot.test.mjs`.
- **The sweep's read timeout.** `SWEEP_READ_TIMEOUT`, default 60 seconds, bounds each read of the
  forge, `gh` and `git ls-remote` alike. A sweep test sets it to 1 second to reach the rows where
  a read does not answer. The sweep ends only the read it started and timed out.

## Measured

On this host, on 2026-10-22, the full deterministic suite was green before the work began: 2654
tests, 0 failing, from `npm test` at `origin/main` `e33b400`. The tooling's three host test files
ran under `npm run test:host` with 40 tests and 0 failing. Seven guarded mutations of a copy of
`sweep.mjs` each redded the test aimed at its row. The launcher tests run against the rebuilt
source copy fail for each launcher on an assertion about where it writes.

## Left to others

`ARCHITECTURE.md`'s sentence placing `tools/` under no layer rides on T5, as the owner ratified.
The clones `tq-tools/codex-session.sh` makes get their own card after this one merges.

## Owner-approved baseline integration

The unchanged published source `9b71e0ab` failed its Node 26.12.0 Linux ordinary baseline
on 2026-10-26: `npm test` reported 2647 passes, three failures and nine skips. Each outer
failure recorded a forge-runner child whose twenty-six failures all required the macOS
`sw_vers` tool. Main already fixes that unconditional prerequisite in `d1a7c9b`; no local
replacement or test weakening is needed.

The owner explicitly approved one clean baseline integration of exact main `85e597f2` into
that published source before the bounded G2 continuation. The normal no-commit merge is
conflict-free and brings the existing Linux conditional through its original history. The
coordinator tools and their test/fixture files retain their published bytes. This integration
is separate from the later three literal host-oracle expectations; no G2 expectation has
been added at this preparation stage.

At the prepared exact-85 merge source, Node 26.12.0 `npm test` passed with 2889 passes and
nine skips. The targeted host oracle's sole failure was its exact expected-list assertion:
the three coordinator files were present in the suite output but absent from the literal
expectations. That is the admitted G2 red, not a green host baseline. The baseline integration
is committed separately through the normal deterministic hook before those expectations change.

## G2 host-oracle continuation

G2 adds only the three literal expected host members for the launchers, suite slot and sweep
before the existing sort. Every prior member, including the independently admitted list-growth
host file, and the exact deep-equality assertion remain. The same targeted host test file that
showed the three missing members now passes under Node 26.12.0 on Linux. The coordinator's
launcher, slot, sweep and fixture source bytes are unchanged; their required prospective
Node 26 macOS execution remains separate from this local oracle result. No sweep was run
against this host's real worktree root.
