<!-- ABOUTME: Records #606's source-bound proof fixture at its fresh base, what ran before this commit, and what stays unproved. -->

# Source-bound proof fixture on a fresh base

This work starts from `7dfa63f5ba5d1599cd20936b549cea7cfe2b6e1b`, tree `5d2b8bfb336110b18f30117416f56c42ec4221b7`, on a new `rigger-606`. Seven files arrived from the unpublished local integration as content, not history. Codex makers wrote those bytes. Claude wrote everything added here.

## What changed after the carry

- `test/process-proof-fixture.test.mjs` gained the fourth diagnostic, `606 proof fixture: native Git binding checks both frozen source maps`.
- `test/process-proof-fixture.mjs` gained the native `readGitFacts` reader. Each snapshot reads identity, both trees, every `src/` blob at both refs and every `test/` blob at H, and it refuses a nonselected source map that differs from Git.
- `test/census-retention.test.mjs` and `test/contain-now.test.mjs` now import the product through the binding. A recorded run names a frozen manifest in `RIGGER_606_STRICT_MANIFEST`. Otherwise ordinary capture binds the working bytes.
- `test/exit-cleanup.test.mjs` no longer selects a historical source. The own606 worker binds ordinary working bytes and never reads Git, so it needs no Git configuration isolation of its own. Two runtime refusals joined its two positives.

## What ran before this commit

Both baselines ran at the fresh base on Linux under WSL, Node 26.12.0: deterministic 5,140 tests, 0 failed, 9 skipped; affected host 1,832 tests, 0 failed, 47 skipped. Twenty-four of those skips are macOS controls this card depends on, and they earn nothing here.

- [`TDD-NATIVE-RED`](https://github.com/williacj/rigger/issues/606#issuecomment-6699968544): one run, failing on `native Git binding must accept the valid frozen manifest`, with both requests refused `strict request malformed` and no native child.
- [`TDD-NATIVE-GREEN`](https://github.com/williacj/rigger/issues/606#issuecomment-6700106120): one run, passing, with the valid manifest accepted over 52 native children and the changed map refused before import.

Those two runs bind the helper as it then stood and the unchanged test. They ran before the consumer and worker changes above, so they say nothing about those changes.

## What stays unproved

- The changed consumers and worker had not run when this entry was written.
- No result here applies to macOS, and no paired base and head proof, mutation or worker boundary run is recorded here.
- The earlier failed host attempt's cause stays UNKNOWN.
- `PROCESS_PROOF_SOURCE_HASHES`, which nothing read, left `test/process-proof-fixture.mjs` after the `TDD-NATIVE-GREEN` run, so that run says nothing about its removal.

Fifteen original EX inputs and every other family on the card remain due.
