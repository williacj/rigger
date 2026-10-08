ABOUTME: Records the live gh probe's PATH fix and its eleven cell checks for card #627.

# Real gh behind the fake

The live D16 probe selected the first executable `gh` after the suite's refusing directory. In the fake forge used by #493, that executable is `installFakeGh`, whose `api rate_limit -X GET` failure is not an observation about the real CLI's HTTP method. The locator now recognizes that fixture's executable and continues searching for a real `gh`.

The eleven cell tests run the existing live probe under explicit PATH orders through nested `npm test` invocations. Success cells retain the real CLI and local proxy method/body relation. Spawn and proxy failure cells keep the attempted form and underlying error visible. The two no-real cells require the exact TAP skip and run the rest of this test file to check it remains green. The fake's sent record is empty in every cell containing it.

Measured with `npm test` on a fresh GitHub clone at `e770812ca43c395c980fd45081695d0ad1179812`: 2,511 tests, 2,494 passed, 17 skipped and none failed. Measured with `npm test -- test/forge-runners.test.mjs` in the working tree before commit: 51 tests passed and none failed. The P1-S test first failed because the live probe called the fake; after the locator change it passed. The P1-X and P1-Y tests each failed before their respective failure condition was wired into the local probe, then passed.
