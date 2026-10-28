<!-- ABOUTME: Records the #1106 native matrix reply-readiness repair and its bounded regression evidence. -->
# #1106 - native matrix reply readiness

The repair base is `c045f0fdfa6d10e548198540ce02ccfcd4b2e732`. The original `test/build-test-matrix-host.test.mjs` blob is `30981a33bce248cc1655536956acdbf37b6bfd33`; the repaired, locally verified file blob is `482c5388c1ace50506945afc4deeae8874d222b4`. The commit containing this journal is the branch head for review. These are Git object IDs measured with `git rev-parse` and `git hash-object` in the #1106 worktree on 2026-10-28.

The retained hosted macOS `full_host` job `123045845237` for #1102 had one failing outer test: the native matrix timeout witness read an empty reply after observing the reply path. Its private log has SHA-256 `c6ef8851d572412ca752f06699c28c085543c20cd3ae8cf1a0bc88368bcba906` (measured by `Get-FileHash` on 2026-10-28). The teardown observation later held `termReply: "survived"`. This establishes an observation race in the test; it does not attribute the failure to #1092 or claim repair of the historical #824 incidents.

The controlled test first observes an absent reply, then publishes empty, `surv`, and `survived` states through completed Node child processes, then asks the same `replyComplete` observer used by the native timeout witness whether it may proceed. The old `existsSync` observer on the original file blob accepted the empty state: `node --test --test-name-pattern=native.reply.observation test/build-test-matrix-host.test.mjs` exited 1 with one failed named test and `an empty reply was accepted`. After the minimal observer change, the named test passed. The child writers are needed because this file belongs to the host tier, whose guard requires each test to start a real process. The first full WSL host run exposed that rule with one outer failure, `started no process`; the child writers made the controlled stages a real process/file boundary.

The final bounded mutation replaced the one exact `replyComplete` return line with `return existsSync(path);`. Readback and a one-line diff confirmed the applied mutant. The named controlled test then exited 1 at the empty-reply assertion, one test failed, and the original file bytes were restored exactly (SHA-256 `53d800ac5d54f46d218d2c7f917d2422ac20b371ec28c9f6f51332def82ce750`). An intentionally absent anchor had count zero and its guard exited 1 without changing the source. The private mutation log is `/tmp/rigger-1106-mutation.txt` in the WSL environment.

Verification on WSL Linux `6.18.54.1-microsoft-standard-WSL2`, x86_64, Node `v26.12.0` at the repaired source blob:

| Check | Result |
|---|---|
| Focused controlled test | 1 passed, 0 failed |
| Guarded affected host file, `npm run test:host -- test/build-test-matrix-host.test.mjs` | 11 passed, 0 failed; native witness retained its real 5000 ms timeout, `SIGKILL`, direct-process reap, and original matrix bytes |
| `npm test` | 3849 passed, 0 failed, 9 skipped |
| Full `npm run test:host` | 2113 passed, 0 failed, 49 skipped; exit 0; 847997 ms |
| `npm run matrix:check` | Passed at final source state; existing output: 56 of 244 requirements have no test |

The first deterministic attempt in this fresh worktree failed 13 file loads because `node_modules` was absent and declared `acorn` could not resolve. `npm ci` installed the lockfile package; the next full deterministic run passed. No product or generated matrix source changed.