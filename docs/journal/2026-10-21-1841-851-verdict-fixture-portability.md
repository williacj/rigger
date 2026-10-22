ABOUTME: Records the independent PATH and terminal regressions behind the verdict fixture's Ubuntu repair.

# Verdict fixture portability

Card [#851](https://github.com/williacj/rigger/issues/851) repairs test fixtures before the instruction work on #850. The measurements below used `npm test` with Linux Node 26.12.0 on Ubuntu in WSL 2. The starting ref was `75c795b4f6e3e86ed566b8b7383b0f00a9b50619`; the installed system `gh` was retained.

The PATH regression ran `world()` in a child whose executable spelling named a real Node link in a controlled directory, with and without a harmless `gh` beside it. On the base helper, `npm test -- --test-name-pattern="world isolates" test/verdict-world.test.mjs` reported two failed assertions: construction exposed the controlled Node directory and the system bin directories. The sentinel was never executed. After isolating named executable links, `npm test -- test/verdict-world.test.mjs` passed four tests, including detection of an injected sentinel before and after the relay on the actual environment's PATH.

The terminal regression was run after that PATH repair, so it reached the actual terminal utility independently. `npm test -- --test-name-pattern="atTerminal preserves" test/verdict-world.test.mjs` reported two named assertion failures, zero cancellations: Ubuntu's util-linux `script` rejected the BSD arguments, returning 1 instead of the expected child statuses 0 and 23. A test-only spawn observer captured the utility's `unexpected number of arguments` message and closed its input on that rejection.

Changing only the arguments exposed another difference in that launch: util-linux waited while the inherited BSD input-relay `cat` remained its child. A separate real-tool probe with Node's socket stdin directly returned 23, printed `socket-probe`, and wrote no stderr. The repaired Linux launch uses that direct socket and util-linux's `-c` and `-e`; the macOS launch retains its BSD pipe wrapper. With both repairs, the same fixture file passed all six tests, zero failures or cancellations, in 710.932062 ms. The terminal children returned 0 and 23 and preserved plain, spaced, quoted, empty, shell-metacharacter and newline arguments.

The source snapshots retained with those logs identify the intermediate states without committing a red suite. Each row names the SHA-256 of `test/verdict-world.mjs` and the regression file used at that state, measured by `sha256sum`.

| State on the starting ref | Helper SHA-256 | Regression SHA-256 |
|---|---|---|
| PATH red | `d5260ace7d0aca8e8ea6826b4f3f4573fac5bb93d2d9935c93e237b476e0d5b4` | `8255f163c11cbed57f3e8766ac74f9796edbe1016787fd1b52a27b6f9a55b84b` |
| PATH green | `f8767aaebd2487d64fc9d192801e36b882f395cfbdf41ece3d71ac0820096582` | `f1e7200078593fd892ae68a2c40eede2f9b8de2431ed895f099b67f1207d0320` |
| Independent terminal red | `f8767aaebd2487d64fc9d192801e36b882f395cfbdf41ece3d71ac0820096582` | `a46de6ad6fd2e1eba5b113ab605db01a5b2a7433eee1882bfeaf59ddf3ccb4e9` |
| Terminal green | `da76900d52e74bf0c1b2a2e5b7d92e90428066062f5f33e5f0388bfe21dde2b4` | `e47974f84df91fbbf220c3a8164f3f87648f2000369b1e2b6aeabf32d2d41f88` |

The first terminal attempt timed out before the observer was added; the first util-linux argument change retained the BSD input relay and also failed to settle. Neither is counted as the terminal regression's red or green evidence. Their failed logs remain alongside the successful run's evidence.

The focused run of all six verdict test files reported 128 tests, 127 passed, one failed, zero cancelled, in 23150.873647 ms. The unchanged surface-check regression at `test/verdict-surface.test.mjs:455` disagreed about an import spelled `Verdict.mjs` on Linux's case-sensitive filesystem. Running that single test on the untouched starting ref independently reproduced the failure: one test failed in 2289.060598 ms. This is outside #851's existing-line grant and was returned to the card's author before any commit.

The owner then [approved G2](https://github.com/williacj/rigger/issues/851#issuecomment-6331575699), and the [independent architect's revised acceptance attack](https://github.com/williacj/rigger/issues/851#issuecomment-6331618428) distinguished direct unresolved imports from doctor's sanctioned fixed CONFIG filename. The correction removes only the two direct routes' alias metadata and adjusts their adjacent explanation and expectation name; doctor retains its filesystem-identity condition. Every injected source route and the conservative guard remain unchanged. The original surface target then passed one test in 3041.794878 ms; its repaired source SHA-256 is `4e04a11488d1f52b1548b1d65728e7c08b228c5ac66fdcf68fc199781b8c9dab`. All six verdict files then passed 128 tests, zero failures or cancellations, in 23970.080693 ms.

The coordinator's cleanup result recorded SIGTERM only to the three blocked input-relay cats, under the owner's separate permission. Its final inventory held no original process left from either failed probe. That cleanup changes no source scope and is not test-pass evidence.

The retained logs and source snapshots are under `/home/williacj/rigger-851-work/.tmp/851-*`; the untouched-ref surface reproduction is `/home/williacj/rigger-cleanup-baseline/.tmp/851-surface-baseline-red.log`. No local macOS run is claimed. The pull request records its actual macOS CI results separately.
