ABOUTME: Records card #985: L2 withholding a judge whose scratch directory L1 could not make for a
host cause, and the red runs, mutations and suite runs behind it.

# A judge whose scratch directory was not made is withheld

Card #985 claims `R-FAIL-7`'s row for a judge's scratch directory not made because the file system gave no answer, or none in time. #932 added that row with no test, under [U10](https://github.com/williacj/rigger/issues/740#issuecomment-6255716663), which lets a spec card land rows as gaps when it names the card that claims them. [U43](https://github.com/williacj/rigger/issues/740#issuecomment-6377288414) set the row's outcome: no second attempt in the invocation, and the next invocation tries again. [Finding 6 of the architect's attack on #920](https://github.com/williacj/rigger/issues/920#issuecomment-6377073780) bound this card to make that path real. That attack read the path at the merge base, without running it, and found the judge dispatched again at once.

The merge base `069c200` behaved as that finding read it. The run test for the "gave no answer" row was first written without a bound on pulls. Against the base it timed out at 60 s, pulling card 7 without end. With the board refusing its ninth priority read, the same test failed on its assertion instead.

## What changed

L1 (`src/execution/role.mjs`) still rejects a scratch directory it could not make with `NOT_STARTED`. When the make answered `WORKSPACE_NOT_MADE`, the rejection now also names that directory as `missing`. A refusal under `R-WORK-26`, and every other dispatch that never started, carries no `missing`.

L3 (`src/scheduling/loop.mjs`) hands a judge's `NOT_STARTED` outcome to L2 unread, as the role's entry in `directories`. Where L2's answer no longer names the judge, `judged` returns `{ role, withheld: { scratch } }`, and `ask` marks the card through `remember`, as it does for a judge whose directory was not made.

L2 (`src/workflow/judges.mjs`) decides. A report naming `missing` withholds the judge and records `judge.withheld` with the role, `scratch` (the directory), `reason` and class `environment`. A report without `missing` withholds nothing, and the judge's outcome stands as at the merge base.

[K88](https://github.com/williacj/rigger/issues/740#issuecomment-6423418486) ruling 2 has an error answer (`EACCES`, `ENOSPC`, an unresolvable path) classed "not made", as the merge base classes the maker's. The code follows that ruling, so every `WORKSPACE_NOT_MADE` from `makeScratch` is withheld. K88 ruling 1 has this card land before #984, which escalates the refusal row. The refusal tests here pin the merge-base outcome that #984 changes.

## How each row is faked

| Row | Fake |
|---|---|
| made it | nothing spoiled |
| gave no answer | `<base>/reviewer` at mode 000, so L1 cannot list it (`scandir` `EACCES`); `role-dispatch.test.mjs` fakes the maker's row the same way |
| an error answer: `EACCES` on the scratch base | the base at mode 000 |
| an error answer: an error on `mkdir` | the base under a directory at mode 500 |
| an error answer: a path L1 cannot resolve | the base under a symbolic link to itself (`ELOOP`) |
| git's listing past its time | a `git` stand-in whose `worktree list` never ends, with `setTimeout` mocked and ticked past `GIT_TIMEOUT` |
| one judge of two | the reviewer spoiled as "gave no answer"; the architect's marker is kept |
| refused (`R-WORK-26`) | a file at `<base>/reviewer` |
| another cause | the judge's agent file outside its working directory, which the Claude adapter refuses (`R-SAFE-6`) after the scratch directory is made |

`makeScratch` passes `workspaces` no timeout, so `GIT_TIMEOUT` (300,000 ms) bounds git's listing. A test cannot wait that long. The timeout test mocks `setTimeout` and ticks the clock past `GIT_TIMEOUT` once the stand-in has started. It then ticks in 50 ms steps, one event-loop turn each, until the run settles. A throwaway spike on `roleDispatch` (measured 2026-10-26, Node 26.5.0, macOS 27.0) settled in 181 ms with the real L0 message "ran past its timeout of 300000 ms, and L0 ended it". No `tail` from the spike was left running.

## Where the tests live

The tests first lived in a new file, `test/judge-scratch-withheld.test.mjs`. The first full `npm test` refused it. Its deterministic tier lets a file outside `test/suite.sh`'s lists start only `git` and `tar`, and these tests start stand-in agents, shell fixtures and the bin. Listing a new file there changes `test/suite.sh` and the lists `test/suite-tiers.test.mjs` pins, which lie outside this card's "Lands in". So the tests were appended to two files `test/suite.sh` already lists as converting:

- `test/environment-retry.test.mjs` takes the 16 L1 and loop tests and their helpers.
- `test/verbs-judges.test.mjs` takes the `rigger run` test, built on its own `world`.

Only lines were added to either file, so no existing line under `test/` changed.

## Red runs

Measured in `/Users/cjwilliams/GitHub/rigger-worktrees/985-engineer`, with the tests still in their first file:

- 18:12:41Z, `node --test test/judge-scratch-withheld.test.mjs`, before any source change: the L1 report test failed on `assert.equal(failure.missing, path)` with `actual: undefined`.
- 18:15:22Z, same command, after the L1 change alone: the run test for "gave no answer" failed on the `judge.withheld` deep-equal with `actual: []`.
- 18:19:50Z: the `rigger run` test, with every source change stashed (`git stash push -- src`), failed on the same deep-equal with `actual: []`. The bin said "exited 1: rigger run: claimed #40 from board 3 for its judges alone".

After the move, at 18:35:12Z, `node --test test/environment-retry.test.mjs test/verbs-judges.test.mjs` ran with every source change stashed. It reported 52 tests, 39 passed and 13 failed. The 13 are the new tests for behaviour this card adds. The 4 new tests that passed pin outcomes kept from the merge base: a judge made, a refusal, an adapter rejection, and the L1 report of the last two. The mutations below red each of them.

The first two tests drove the code. The other row tests share that one code path, so each was seen red against the merge-base source rather than before code of its own.

## Mutations

Each was guarded, over both files (52 tests): the anchor found once, the replacement read back off disk, all 52 tests reaching a verdict, and the file restored byte-identical (sha checked).

| Mutation | New tests red |
|---|---|
| M1 `judges.mjs`: withhold every `NOT_STARTED` report | refusal, adapter rejection, L2 handed apart (and the existing "a judge scratch refusal remains NOT_STARTED") |
| M2a `role.mjs`: name `missing` on an `R-WORK-26` refusal | L1 neither, refusal, L2 handed apart (and the same existing test) |
| M2b `role.mjs`: name `missing` on an adapter's rejection | L1 neither, adapter rejection, L2 handed apart |
| M3 `loop.mjs`: hand L2 a fulfilled judge outcome as well | made, two judges, L3 carries, next invocation (and the existing "run withholds a failed judge only once") |
| M4 `role.mjs`: drop `missing` | all 13 that are red at the merge base |
| M5 `loop.mjs`: return the outcome, not `withheld` | L3 carries |
| M6 `judges.mjs`: drop `scratch` from `judge.withheld` | the 7 run row tests, L2 handed apart, and the `rigger run` test |

Every one of the 17 new tests is red under at least one mutation. M5 first survived every test, so the test "L3 carries a judge withheld … among none of the judges it dispatched" was added. It was red under M5 at 18:22:28Z and green once the source was restored.

## Suite

Base `069c200`, through `suite-slot.sh 985-maker -- npm test` before any change: exit 0, 2,970 tests, 2,970 passed, none skipped. At the change: exit 0, 2,987 tests, 2,987 passed, none skipped, 17 of them new. `npm run matrix` regenerated `docs/derived/test-matrix.md`, and `npm run matrix:check` passed.

## Left out

`rigger run` says a judge withheld for its scratch directory "was not dispatched, because its directory could not be made: …". The text after the colon names the scratch directory. `src/cli/once.mjs` is outside this card's "Lands in", so the wording stays as it is.
