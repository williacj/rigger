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

## Round 1: the allowlist test pinned its representation

The reviewer's B1 on #1477 found that the allowlist test deep-equalled the sorted array. A duplicate `PATH`, which leaves the `.includes` filter and every record unchanged, turned it red: an implementation test, `tdd` class 1. The test now asserts only what the card asks, that `PATH` is a member and that no name lies outside the permitted set. Receipts at `6c60aa27`: the duplicate-`PATH` mutation survives (5/5 pass), and appending `UNRELATED` is still killed by the allowlist test's outside-the-set assertion. Dropping `PATH` is killed by the PATH-value test and the membership assertion, and the whole-environment record is still killed by the outside-name test.

## Round 2: the same class, fixed at the invariant

Round 2's B1 found that the round-1 fix still compared an intermediate array's prototype, so an array subclass holding the same five names failed. The lesson is that the test should observe the allowlist only through what its consumer depends on, its elements. `.includes('PATH')` checks membership, and enumerating the elements checks that each is permitted; nothing compares a constructed value. Rejecting *any* outside name needs enumeration, since membership alone cannot be asked of an unbounded set of names.

The sweep of the other four tests found two more instances, each shown red at `851b02fb` by a receipt: the PATH test read `record.environment.PATH`, pinning the field name, and the spawn test deep-compared the env object, pinning its prototype. The PATH test now finds PATH with its value anywhere in the parsed record. The spawn test compares the env's own entries.

Receipts at `efa16e99`: duplicate PATH, subclass, reordered, frozen, duplicate-and-reordered, a null-prototype spawn env and a renamed record key all survive. An added forbidden name, a dropped PATH, the whole environment, an outside value under another key, a filtered spawn env and a dropped `cwd` are each killed by the test meant for them.

## Round 4: the card pins the start record, and the tests assert exactly that

An independent attacker at `7227f27c` showed that, with no pinned contract, every record assertion pinned some representation. The author revised the card (K7 `43d0a88ebd53`) to pin the start record:
- the prefix followed by a single-line JSON object;
- exactly five top-level keys;
- an `environment` object holding exactly the recorded names the caller held, each with the caller's value;
- `RECORDED_NAMES` as an array of strings;
- the spawn env as the keys and values a `for...in` yields.

The tests now assert each pinned item once and nothing finer, 12 tests in all.

Before relying on the `for...in` definition, a probe outside the suite on Node v26.13.0 confirmed it. A child started by `spawn` or `spawnSync` with `env = Object.create(base)` received both the inherited key and the own key.

A first commit read the names with `Array.prototype.slice`. That builds its result through the receiver's species, so a subclass of Array still failed an empty-result comparison, the same class once more. The names are now read by index into a plain array, and each element is asserted on directly.

Receipts at `7be1ce89`:
- **Killed by the items they break:** nested record, `args` key, key=value text, entries, a Set, an extra field, indented JSON, a colon prefix, an iterator-overriding subclass and a renamed key.
- **Survive:** `Object.create(environment)` and a Proxy as the spawn env, an extra spawn option, an argv copy, key order, and the duplicate, subclass, reordered, frozen, duplicate-reordered and null-prototype variants.
- **Still killed:** the whole-environment record, a dropped PATH, a forbidden name, and an outside value under another key.

Card #1476 allows one journal file, so this round is a section here, not a new entry.

## Round 5: one redundancy and one constraint beyond the contract

The reviewer found that the two top-level tests for PATH membership and for no outside name were redundant: a dropped PATH already fails the PATH-value test, and a forbidden name already fails the all-names test's premise. Their assertions now sit in the array-of-strings test, so each remaining test has a defect of its own.

The architect found that the exact-names test required the list to hold a name beyond PATH and HOME, which the card does not pin: `['PATH', 'HOME']` failed its premise. The test now checks three literal callers (PATH alone; PATH and HOME; all five permitted names), each beside an outside name. Its premise holds for any list holding PATH and some other permitted name. Because every permitted name is held by some caller, a dropped one is still caught.

The architect also found that the PR body quoted the spawn probe's stdout. Item 23 allows host output only as names, counts and exit status, so the probe is now described by the names it checked and its exit status alone.

## Round 6: a list of PATH alone

The architect found that the exact-names test still required a second list member: with `['PATH']`, no caller can hold a listed name and also lack another, so the premise failed before any record was read. The card permits that list. The premise is now asserted only when the list holds a name besides PATH. The three callers are unchanged, so every permitted name is held by some caller, and a record that drops a held name is still killed. Receipts at the head: `['PATH']` and `['PATH', 'HOME']` survive; the drop-HOME record and M1 to M4 are killed.
