ABOUTME: Journal for #528 (M4-F10): the fixture's clones ran git's automatic maintenance, which
detaches, and L0's census can stop a detached one for good; and gc.auto=1 does not keep one alive.

# #528 — the fixture's clones ran git maintenance

**Only the clones had maintenance on.** `repositoryAt` already set `maintenance.auto=false` and
`gc.auto=0`, but `cloneInto` and `bareCloneInto` set nothing. Every scratch repository a test
cloned, and every bare `origin.git` it pushed to, ran git's automatic maintenance. With git 2.54.0
(Apple Git-157) on macOS 27.0 on 2026-10-02, `GIT_TRACE=1` showed `git fetch` starting
`git maintenance run --auto --no-quiet --detach`. `git commit`, and the receiving side of a push,
each started `git maintenance run --auto --quiet --detach`. `git worktree add` and `git clone`
started none. A fetch that brought nothing still started one, and `GIT_TRACE2_EVENT` showed its
`detach` region every time. So `--auto` detaches first and decides afterwards whether there is
work, and a detached maintenance is started on every such call, not only when there is work.

**`maintenance.auto=false` is what stops it; `gc.auto=0` alone does not.** With
`maintenance.auto=false` in the clone, the same fetch traced no maintenance, under `-c gc.auto=1`
too. The fix gives the clones the settings `repositoryAt` gives, through `git clone -c`, which
writes them into the new repository before its first fetch.

**Where they came from.** Each of the base's 65 test files was run alone at `5bddd58`, with
`trace2.eventTarget` set to a directory in the run's global configuration. Five files started
maintenance: `fake-gh` 10, `judge-directory` 98, `retry` 34, `workspace` 61 and `worktrees` 91.
Each test of those five was then run alone the same way: 294 starts in 111 of 215 tests. Two
sources started them. One was L0's own fetches in `src/substrate/worktrees.mjs`: the main line's
fetch and the fetch of a commit. The other was a test's own commit or push in a repository that
came from `cloneInto` or `bareCloneInto`. The orphans the coordinator cleared were all
`--no-quiet`, so all fetches, and all in `rigger-process-*/repository`, the clone those tests make.

**Why they were stopped: L0's census, racing the detach.** L0 runs git in a process group of its
own and contains the group when git exits: its census sends the group `SIGSTOP`, reads it, and
kills what it found. Git's `--detach` forks, and the child calls `setsid` to leave the group. A
probe ran `git fetch` 300 times through `runCommand` in an unconfigured clone, at a one-minute
load of about 38. It left 2 `git maintenance` processes stopped (`Ts`), parented to pid 1, each its
own process group (`pgid` equal to its pid), so each had left the fetch's group. The same probe at
a load of about 25 left none in 300, and so did 300 fetches through a plain `spawnSync` and 300 in
a clone with `maintenance.auto=false`. Only a group-wide `SIGSTOP` reaches a process in the
fetch's group, and none reaches one that already has its own group. So the reading is that the
census's stop reached the child while it was still in the group, and took effect once `setsid` had
taken it out. The census's read of the group then no longer listed it, and the kill missed it.
This part is an inference, not a measurement: the kernel was not traced, and 2 in 300 at one load
is a small sample. The load is what widens the window between the fork and the `setsid`. The
`N` in most of the cleared orphans' `TNs` is a lowered priority, which widens it too.

**That race is L0's, and is outside this card.** The fix removes every detached maintenance from
the fixture's repositories. A consumer's own repository still runs git's maintenance as the
consumer configures it, and L0's census can still leave one stopped there. The card's acceptance
leaves `src/` alone, so this is reported, not fixed; it is #539.

**`gc.auto=1` does not make a detached maintenance outlive a run.** The card proposed it as the
forcing for items 2 and 3. With it in the run's global configuration, 49 of 50 runs at the base,
ten of each of the five files, left 0 `git maintenance` processes under the run's `TMPDIR`; the
figures are in the pull request. The fiftieth, a run of `retry` started at a load of 48, left one,
stopped (`Ts`), under pid 1, its own process group: the census race above, in a real test. The
maintenance still starts on every call that checks for one, as the trace above shows, but it finds
nothing to do in these repositories and exits on its own. One outlives the run only where a census
stopped it, and at these loads that was far rarer than once a run. So item 2 could not be met
with that forcing, and no other setting was found that keeps a detached maintenance alive. The
maker escalated items 2 and 3 to the card's author.

**Counting starts rather than survivors met the restated items.** The author restated both items
on the number of `git maintenance run --auto` starts a run records in git's trace2 events. A run
that starts none can leave none behind, whatever the census does. Each named file was run ten
times at the base and ten at the head, each run starting at a one-minute load of 24 or less, with
`GIT_TRACE2_EVENT` naming a directory beside the run's `TMPDIR`. Every base run recorded starts,
the same number in each run of a file: `fake-gh` 10, `judge-directory` 98, `retry` 34,
`workspace` 61, `worktrees` 91. Every head run recorded none. The base runs also left 45 stopped
maintenance processes under their `TMPDIR`s, in 19 of the 50 runs, against 1 in 50 without
trace2. A reasonable reading is that trace2's writes slow each git and widen the race's window,
but that is a judgment, not a measurement. The race is #539.
