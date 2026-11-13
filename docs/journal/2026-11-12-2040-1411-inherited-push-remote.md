ABOUTME: Card 1411's inherited-config refusal and the scratch-bare measurements that reproduced
its second destination and redirect.

# Refusing an inherited push remote

Card #1411, acceptance revision `ba52afc0dbf2`, places the real-git config cells in
`test/worktrees.test.mjs`. The architect's placement addendum is comment 6842075475. The
strict deterministic guard removes those config variables; the host file lets them reach git.
The deterministic counterpart tests the decision from step 2's scripted answers.

The push side reads `git config --get-regexp ^remote\.rigger-data-push\.` before its first
network operation. A matching key refuses the push, naming the reserved remote. No match permits
the push. An error ends it in git's words. `ARCHITECTURE.md` receives only the architect's pinned
P1 replacement from comment 6841821407. The PR needs the owner's marker for that authored delta.

## Reproducing the writes

These are measurements made on 2026-11-12 with `git version 2.56.0`, while this checkout's HEAD
was `c1f6c41eb5b67fee5800c3786560146481fda694`. The measurement script ran only against fresh bare
repositories under the dispatched TMPDIR, never against a real remote. Each cell had separate
pushing, origin and injected repositories, initially holding no refs. Global config was
`/dev/null`, system config was disabled, and automatic maintenance was disabled in every repo.

The script made an event-stream commit with `hash-object`, `mktree` and `commit-tree`. It set
`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=remote.rigger-data-push.<key>` and
`GIT_CONFIG_VALUE_0=<injected repository>`. It then ran:

```text
git -c remote.rigger-data-push.url=<origin> push --porcelain --no-signed rigger-data-push <commit>:refs/rigger/events
```

Neither scratch pushing repository held a hook. The command used no hook-bypass flag.

| Injected key | Push exit | Origin after push | Injected repository after push | Pushing repository after push |
|---|---|---|---|---|
| `url` | 0 | data ref names the commit | data ref names the same commit | no refs |
| `pushurl` | 0 | no refs | data ref names the commit | no refs |

The `url` cell reproduced a second destination. The `pushurl` cell reproduced the redirect.
In both cells, `git remote get-url --push --all rigger-data-push` exited 2 and printed no URL.
`git config --get-regexp ^remote\.rigger-data-push\.` exited 0 and printed the injected key.

The complete command, exit, stdout, stderr and before/after ref records are retained in
`/Users/cjwilliams/Github/rigger-worktrees/codex-1411-tmp/1411-measurements.log`. The script and
all six bare repositories remain beside that log for the coordinator's cleanup.

## Verification before commit

The deterministic baseline at the base head passed 5,948 cases. The affected host baseline passed
53 cases. The scripted decision test first failed because exit 128 continued to a successful
push. After failing closed on that answer, the nine-cell host test failed in every cell while
the old remote lookup remained. Its diff exposed the unintended network calls and changed refs.
The config lookup then made all nine cells pass.

The final affected-file runs passed 72 deterministic cases and 64 host cases, including the nine
nested cells. Each cell first checks that real git reads its injected key, then compares the
push's outcome, named reason, network calls and complete ref inventories. The unrelated-config
control also covers similarly named remotes. Each added host test declares wiring and names the
deterministic counterpart. Existing P26 and P27 are unchanged and pass.

Every suite run retained unfiltered output under the dispatched TMPDIR and ran through the
host-wide slot. The PR will hold the committed-head, fresh-clone, mutation and CI receipts.
