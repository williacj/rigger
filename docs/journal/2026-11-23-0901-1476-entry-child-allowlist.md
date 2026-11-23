<!-- ABOUTME: Records #1476's move of the host fixture test's entryChild into test/entry-child.mjs, the start record's environment allowlist and why, and the mutation that shows its test discriminates. -->
# #1476: the entry-child start record carries only allowlisted names

## What landed

`entryChild` moved from `test/in-process-fixtures-host.test.mjs` into `test/entry-child.mjs`, which the host file imports. Its `entry-child-start` diagnostic now records the caller's environment through `RECORDED_NAMES`. The child is still spawned with the caller's whole environment, and `entry-child-end` is unchanged. `test/entry-child.test.mjs` checks the record through a spawn stand-in, because the deterministic tier lets no other command start.

## Why these names

The allowlist is `PATH`, `HOME`, `LANG`, `CODEX_HOME` and `RIGGER_STAND_IN_VALUE`: the names this file's callers set by name for a reason its witnesses rely on. `PATH` is what tells a reader of a failed run which `gh`, `git` and `node` the child resolved. `UNRELATED` stays out, because it exists to prove the stand-in does not record it. Every other inherited name stays out because `gitEnvironment()` hands on the whole session, and that may hold a secret.

## Verification

- Before the move, a stand-in spawn showed the start record carrying a name outside the allowlist and its value; the outside-the-allowlist test was red on that, and green once the record passed through the allowlist.
- Mutation, by `npm run mutation:receipt` at `e518300e`: restoring the start record to the whole environment (anchor found once) turns the outside-the-allowlist test red on its name assertion, with the other four tests passing, and the restored file passes all five. The receipt is quoted in the pull request.
- The deterministic spawn census in `test/git-environment.test.mjs` caught a first draft that called the injected spawn under another name; the parameter is now named `spawn`, so the census sees the call and that it hands an environment.
- In the host run's own log, all 214 `entry-child-start` records carry only `PATH`, `LANG`, `HOME`, `RIGGER_STAND_IN_VALUE` and `CODEX_HOME` (counted by name; no value read out).
- `npm run test:host -- test/in-process-fixtures-host.test.mjs` exits 0 and reports 22 tests, the 22 top-level `test(` registrations the file held at `3e325ab8`. Only names, counts and exit status from that run are quoted anywhere.
