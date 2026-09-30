ABOUTME: Spike findings for card #426 (M3-S1): which local git operations on one repository fail
when run at once or against a held commit, and what making and removing a worktree costs.

# Local git operations at once, and what a worktree costs

## The answer

Three of the six operations fail when several run at once on one repository. Fetching the main
line fails in every round once the remote has moved. Creating a worktree with upstream tracking
fails in every round, on the shared config file. Pruning worktrees fails in some rounds. Creating
a worktree without tracking also failed, rarely: 6 of 2,160 creations. Removing a worktree,
resetting a branch and deleting a branch never failed.

No operation failed while a `git commit` in another worktree held its ref locks, and no held
commit failed. So nothing measured puts the A4 table's fourth row in play.

A fetch did fail against another fetch made from an agent's worktree, in every round, and no
in-process queue can cover that. This report recommends a bounded retry for that one failure,
which the A4 table does not provide for. It is a proposal for the architect, not a ruling.

A worktree costs about 57 ms to make and 51 ms to remove on a clone of this repository, so
queuing costs little.

No run left the repository broken by `git fsck` or `git worktree list --porcelain`. A failed
creation did leave its new branch behind, as "Broken state" says.

## Host and method

| | |
|---|---|
| git | 2.54.0 (Apple Git-157), `git --version` |
| macOS | 27.0, build 26A428, `sw_vers` |
| Logical CPUs | 12, `sysctl -n hw.logicalcpu` |
| Node, running the harness | v26.5.0 |
| Ref storage | `files`, `git rev-parse --show-ref-format` in a new repository |
| Source | a fresh clone of `https://github.com/williacj/rigger.git` at `7cee007`, 348 tracked files |
| Dates | 2026-09-29 and 2026-09-30 |

**No run reaches the network.** Every set of runs starts from a new local bare repository cloned
from the fresh clone's local path. The repository under test and a second clone, which pushes new
commits, both have that bare repository as `origin`. I read `git remote -v` in them after the
runs, and both name only the bare repository's path. The fresh clone was the only step that
reached github.com, and it came before every run.

**Directories.** Every run worked under the session scratchpad, in c426-probe/ with `TMPDIR` at
c426-tmp/, as the maker's comment on #426 named before the first run. None lies inside a git
checkout. The harness scoped `git branch -D` to c426-probe/ under the owner's grant on #426,
and refused the call anywhere else.

**The harness.** A throwaway Node script in the gitignored spikes directory starts each process
with child_process.spawn, with every `GIT_` variable removed from its environment. It records
each process's exit code, the first non-empty line of its standard error, and its start and end
times. In a round, all N processes start in one tick. In every round of every series of more
than one process, the earliest end came after the latest start, so all of them ran at once. After each round the harness ran
`git fsck --no-progress` and `git worktree list --porcelain`, then removed what the round made,
one step at a time.

**Load.** The host is shared with other sessions, and the harness never ran more than six git
processes at once. The one-minute load average (`sysctl -n vm.loadavg`) is given beside each
figure. It lay between 3.7 and 11.7 through every run.

**What counts as a failure.** A non-zero exit code.

**The operations, and the command each process ran.** Each process in a round worked on its own
branch and its own worktree path.

| Operation | Command | Set up before the round, untimed |
|---|---|---|
| Fetch from a local bare repository | `git fetch origin main` | a new commit pushed to the bare repository |
| Create a worktree, tracking | `git worktree add -q -b <branch> <path> origin/main` | none |
| Create a worktree, no tracking | `git worktree add -q --no-track -b <branch> <path> origin/main` | none |
| Create a worktree, no tracking, branch existing | `git worktree add -q --no-track -B <branch> <path> origin/main` | the branch at the main line's parent |
| Remove a worktree | `git worktree remove <path>` | N worktrees |
| Prune worktrees | `git worktree prune` | N worktrees whose directories were deleted without git |
| Reset a branch no worktree holds | `git branch -f --no-track <branch> origin/main` | N branches at the main line's parent, loose or packed |
| Delete a branch no worktree holds | `git branch -D <branch>` | N branches, loose or packed |

"Packed" means `git pack-refs --all` ran after the branches were made, so that each reset or
delete must rewrite the shared packed-refs file.

## Six operations at once

Each series is 20 rounds at the concurrency named. The rounds column counts rounds in which at
least one process failed. The processes column counts failed processes out of all started.

| Operation | 3 at once: rounds | processes | 6 at once: rounds | processes | Load, 1 min |
|---|---|---|---|---|---|
| Fetch, the remote advanced before each round | 20 of 20 | 40 of 60 | 20 of 20 | 100 of 120 | 11.7 to 10.4 |
| Create, tracking | 20 of 20 | 38 of 60 | 20 of 20 | 99 of 120 | 10.4 to 9.4 |
| Create, no tracking | 1 of 20 | 1 of 60 | 0 of 20 | 0 of 120 | 9.4 to 8.0 |
| Create, no tracking, branch existing | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 8.0 to 6.7 |
| Remove | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 6.7 to 7.3 |
| Prune | 2 of 20 | 2 of 60 | 8 of 20 | 13 of 120 | 7.3 to 6.5 |
| Reset, loose | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 6.5 |
| Reset, packed | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 6.4 to 6.1 |
| Delete, loose | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 6.1 to 5.8 |
| Delete, packed | 0 of 20 | 0 of 60 | 0 of 20 | 0 of 120 | 5.8 to 5.3 |

**Creation without tracking fails rarely, so I ran it longer.** Twenty rounds cannot tell a rare
failure from none, so I ran both no-tracking forms for 100 rounds at each concurrency. The load
ran from 4.7 to 8.0.

| Form | 3 at once, 100 rounds | 6 at once, 100 rounds |
|---|---|---|
| `--no-track -b` | 0 of 300 | 0 of 600 |
| `--no-track -B`, branch existing | 0 of 300 | 5 of 600, in 4 rounds |

Across every no-tracking series, 6 of 2,160 creations failed, all with the `commondir` error
quoted below.

**In every fetch round at least one fetch succeeded.** After the 20th round, the repository's
origin/main equalled the pusher's last commit in both series. A losing fetch fails because
another fetch moved the ref first.

## Creating a worktree: the two forms

With tracking, 137 of 180 creations failed across both series. Every failure was on the lock of
the repository's shared config file, which the tracking setup writes. Without tracking, 6 of
2,160 creations failed, on the race described under "Failures, quoted".

**#430 (M3-04) should create with `--no-track`.** Tracking gives Rigger nothing it uses. It also
writes the one config file every worktree shares, which an agent's own `git push -u` or
`git config` writes too. That last point is a judgment from what git writes, and I did not
measure it.

`-B` rather than `-b` fits #430's item about a branch that already exists locally. Every creation
failure measured here, with `-b`, left the new branch behind, so a retry with `-b` would then
meet "already exists". `-B` resets a branch even when the add then fails ("Existing non-empty
directory" below). #431 (M3-05) and its item on a failed attempt's branch already own that.

## Against a held commit

**How the commit was held.** The repository under test had a second worktree, `holder`. For
these runs only, it had a `reference-transaction` hook that waits in the `prepared` state until
a release file appears. The hook waits only when the committing process sets `C426_HOLD`, so
every other git process passes through it at once. The holder staged a change and ran
`git commit -q -m …` with `C426_HOLD` set.

**Why that holds the locks.** At `prepared`, git has taken every lock of the transaction and not
yet committed it. Once the hook signalled, the harness listed every file ending in ".lock" under
the repository's common git directory. It then started the operation and listed again when the
operation ended. It then released the commit and waited for it.

**What the listings showed.** In all 200 runs, both listings, at the operation's start and at its
end, held exactly the commit's two locks: refs/heads/holder.lock and
worktrees/holder/HEAD.lock. Both paths are relative to the common git directory. So every run
counts under the item, and the commit held its ref lock for the whole of every operation.

The operations below ran one at a time against the held commit, 20 runs each. The fetch runs
advanced the remote before each run. The load ran from 5.3 to 4.3.

| Operation | Runs counted | Operation failed | Commit failed | Median operation, ms |
|---|---|---|---|---|
| Fetch | 20 | 0 | 0 | 57.2 |
| Create, tracking | 20 | 0 | 0 | 170.2 |
| Create, no tracking | 20 | 0 | 0 | 167.6 |
| Create, no tracking, branch existing | 20 | 0 | 0 | 169.8 |
| Remove | 20 | 0 | 0 | 52.5 |
| Prune | 20 | 0 | 0 | 9.3 |
| Reset, loose | 20 | 0 | 0 | 26.6 |
| Reset, packed | 20 | 0 | 0 | 27.2 |
| Delete, loose | 20 | 0 | 0 | 33.0 |
| Delete, packed | 20 | 0 | 0 | 43.9 |

Creation takes about three times its usual time here, because the hook runs as a process on every
ref transaction. That is a cost of the probe, not of git.

No run saw packed-refs.lock. Automatic maintenance never ran during these runs.

## Beyond the acceptance: an agent's fetch, and operations mixed

These runs answer questions the recommendation depends on. The acceptance does not ask for them.

**An agent's fetch.** An agent in another worktree fetching while Rigger fetches is the case the
queue cannot cover. The repository had a second worktree, `agent`. In each of 20 rounds, the
remote advanced, then `git fetch origin main` in the main working tree and `git fetch origin` in
`agent` ran at once. Every round overlapped. The load was 5.3.

| Rigger's fetch | Rigger's fetch failed | The agent's fetch failed |
|---|---|---|
| `git fetch origin main` | 12 of 20 | 8 of 20 |
| `git fetch origin +refs/heads/main:refs/rigger/main` | 19 of 20 | 1 of 20 |

In every round exactly one of the two failed, always on refs/remotes/origin/main. Fetching
into a ref only Rigger writes did not avoid it. Fetching from a named remote also updates that
remote's tracking ref, so both processes still wrote it. I did not measure a fetch by URL into
a Rigger-owned ref.

**Two operations mixed.** Each run below is 20 rounds of three processes of one operation and
three of another, all at once, with no tracking. The load ran from 3.7 to 9.9.

| Pair | Failed |
|---|---|
| Create and prune (three adds and three prunes) | 0 of 120 |
| Create and remove | 0 of 120 |
| Remove and prune | 0 of 120 |
| Create and reset, loose | 0 of 120 |
| Create and delete, packed | 1 of 120 |
| Create and fetch | 40 of 120, every one a fetch |
| Remove and delete, packed | 0 of 120 |

The create-and-delete failure is described under "Failures, quoted". It needs two branch names
that share a directory, such as p/15a-1 and p/15b-0. #429 (M3-03) refuses a topic holding
`/`, so Rigger's own branches never share one.

The create-and-prune pair did not fail. A prune never removed a worktree another process was
still making. I read that as git marking a worktree that is still being made as locked, which
prune skips. That reading is a judgment, and I did not measure it.

## Failures, quoted

These are every failure the counts above include: git's exit code, and the first line of its
standard error. Where lines differ only in commit ids or a round's name, the ids are shown as
`<sha>` and one instance is given.

| Operation | Count | Exit | First line of standard error |
|---|---|---|---|
| Fetch, at once | 140 | 1 | `error: cannot lock ref 'refs/remotes/origin/main': is at <sha> but expected <sha>` |
| Fetch, against an agent's fetch | 40 | 1 | the same line |
| Fetch, in the create-and-fetch pair | 40 | 1 | the same line |
| Create, tracking | 137 | 255 | `error: could not lock config file .git/config: File exists` |
| Create, no tracking, `-b` | 1 | 128 | `fatal: failed to read .git/worktrees/0-0/commondir: Result too large` |
| Create, no tracking, `-B` | 5 | 128 | the same line, naming another process's worktree: `20-5`, `32-4`, `44-5` and twice `72-4` |
| Prune | 15 | 128 | `fatal: Invalid path '<repository>/.git/worktrees': No such file or directory` |
| Create, in the create-and-delete pair | 1 | 255 | `fatal: cannot update the ref 'refs/heads/p/15a-1': unable to append to '.git/logs/refs/heads/p/15a-1': Invalid argument` |

The commit never failed.

**What each failure means.**

- **Fetch.** Each fetch updates refs/remotes/origin/main, expecting the value it read first. The
  loser finds that another fetch has already moved the ref, usually to the same commit.
- **Create, tracking.** The upstream setting is written to the shared config under a lock that is
  never waited for.
- **Create, the `commondir` race.** One add read the administrative directory of another add's
  worktree before that add had written its `commondir` file. A worktree add checks every existing
  worktree for the branch it is about to check out.
- **Prune.** One prune removed the emptied administrative directory while another prune was
  reading it.
- **Create, against a delete.** The delete removed the empty reflog directory the add was about to
  write into.

## Broken state

No run left the repository in a state that `git fsck` or `git worktree list --porcelain` reports as
broken. The checks ran after each of the 1,220 rounds and runs in the tables above, including the
100-round series, the pairs and the agent's fetches.

- `git fsck --no-progress` exited 0 every time. Its only output was one `dangling commit 3b98ae2`,
  present from the start. That is a commit of a remote-tracking branch in the fresh clone, which
  a bare clone does not copy as a ref.
- `git worktree list --porcelain` never listed a `prunable` or `locked` entry after a round.
- After a failed prune, every stale entry was gone anyway, since another prune had removed it.

**A failed creation leaves its branch.** git reports this as nothing broken, but the branch
remains. Every failed tracking creation left the new branch and nothing else: 99 of 99 at 6 at
once, with no directory, no registration and no upstream. The one `commondir` failure with `-b`
left its new branch behind the same way. The five with `-B` left no directory and no
registration. Where their existing branch then pointed, I did not record.

## What a worktree costs

I timed 15 sequential creations, each followed by its removal, for each form, on a clone of this
repository at `7cee007`. Nothing else ran in the repository. The load ran from 4.3 to 4.2.

| Form | Create, median of 15 | Remove, median of 15 |
|---|---|---|
| `git worktree add -q -b … origin/main`, tracking | 56.9 ms | 50.9 ms |
| `git worktree add -q --no-track -b … origin/main` | 56.3 ms | 51.5 ms |

Every creation took between 53.9 and 60.5 ms, and every removal between 43.2 and 54.0 ms.

## Existing non-empty directory

The commands below ran in a clone where `side` was at `origin/main~3` (`6e5f976`) and
origin/main was `7cee007`. The directory `occupied` held one file, `f`, and was not a worktree.

| Command | Exit | What it printed | Where the branch pointed afterwards |
|---|---|---|---|
| `git worktree add -B side occupied origin/main` | 128 | `Preparing worktree (resetting branch 'side'; was at 6e5f976)`, then `branch 'side' set up to track 'origin/main'.`, then `fatal: '…/occupied' already exists` | `side` at `7cee007`, moved from `6e5f976` |
| `git worktree add -b fresh occupied origin/main` | 128 | `Preparing worktree (new branch 'fresh')`, then the tracking line, then the same `fatal` | `fresh` created, at `7cee007` |
| `git worktree add --no-track -B side occupied origin/main`, `side` reset to `6e5f976` first | 128 | `Preparing worktree (resetting branch 'side'; was at 6e5f976)`, then the same `fatal` | `side` at `7cee007` |

In all three, `occupied` still held `f` with its content unchanged, and no worktree was
registered. So git moves or creates the named branch, and with tracking writes its upstream,
before it refuses the directory.

## A worktree's directory deleted without git

The commands below ran in the same clone. A worktree `gone` was made on branch `gone`, and its
directory was then deleted with `rm -rf`.

| Command | Exit | Result |
|---|---|---|
| `git worktree list` | 0 | Lists `…/gone 7cee007 [gone] prunable` |
| `git worktree list --porcelain` | 0 | Lists the entry with `prunable gitdir file points to non-existent location` |
| `git worktree add --no-track -B gone …/gone2 origin/main` | 128 | `fatal: 'gone' is already used by worktree at '…/gone'` |
| `git worktree prune -v` | 0 | `Removing worktrees/gone: gitdir file points to non-existent location` |
| `git worktree list --porcelain` | 0 | Lists the main working tree only |
| `git worktree add -q --no-track -B gone …/gone origin/main` | 0 | The worktree is back, listed once, on `gone` |
| `git fsck --no-progress` | 0 | Only the dangling commit named above |

## The A4 table, row by row

The table is in the architect's ruling on #423, A4.

| Row | Condition | Met? | Evidence |
|---|---|---|---|
| 1 | No failure and no broken state for an operation at 3 and 6 at once, so it leaves the queue | **Met for** remove, reset and delete, loose and packed: 0 failures at 3 and at 6, and no broken state. **Not met for** fetch, creation in any form, or prune. | "Six operations at once"; "Broken state" |
| 2 | No failure for any operation, so nothing is queued and the queue is not built | **Not met.** Fetch, creation and prune failed. | "Six operations at once" |
| 3 | Median worktree add or remove over about 5 s, so re-weigh and queue only what failed | **Not met.** The medians are 56.9 ms to create and 50.9 ms to remove. | "What a worktree costs" |
| 4 | Failures of Rigger's operation against a commit in another worktree, so L0 also retries a lock-file failure, bounded, and names it | **Not met.** 0 of 20 for every operation, and 0 of 20 for the commit, with its ref lock shown held in every run. | "Against a held commit" |

## Recommendation for #430 (M3-04)

1. **The queue holds three operations.** They are fetching the main line, creating a worktree, and
   pruning worktrees. Each failed at 3 and at 6 at once (row 1 not met).
2. **Removing a worktree, resetting a branch and deleting a branch leave the queue**, under row 1.
   Each had 0 failures at 3 and 6, loose and packed.
   - Mixed with creation, removal and reset still had 0 failures in 120 each.
   - Deletion's one failure against creation needs two branch names that share a directory, which
     #429 (M3-03)'s refusal of `/` in a topic rules out.
   - Holding all six in the queue instead would cost about 50 ms per operation, and it is the
     simpler choice if the architect prefers one rule to three exceptions.
3. **Create with `--no-track`.** Tracking failed 137 of 180 creations on the shared config's lock.
   Without tracking, 6 of 2,160 failed.
4. **L0 retries nothing on account of a held commit.** Row 4 is not met, and #430's item for that
   case applies: the pull request cites row 4 and the module retries nothing.
5. **A fetch failing on refs/remotes/origin/main is outside that item, and outside the queue.**
   An agent's own fetch in its worktree made Rigger's fetch fail in 12 of 20 rounds. That is the
   case A4 says no in-process queue covers.
   - I recommend L0 retry that one failure, bounded and named: a fetch exiting 1 whose standard
     error names a lock on the remote-tracking ref. The evidence for it is "An agent's fetch".
   - #430's acceptance does not provide for this, because its retry items follow row 4, which
     concerns a commit.
   - This is a proposal for the architect and #430's author. The other route is a fetch that
     writes no ref an agent writes, which is unmeasured.

**What #430 must not assume.**

- **The queue makes creation safe from failures it does not cause.** Six processes in one engine
  never contend under the queue. An agent's own `git worktree add` or `git worktree prune`, or
  another tool's, still could.
- **A failed creation leaves nothing behind.** A failed `-b` leaves its new branch. A failed `-B`
  onto an occupied directory has already moved the branch.
- **20 clean repetitions prove a form race-free.** No-tracking creation passed 20 rounds at 6 and
  failed 5 times in the next 600. #430's item on three workspaces made at once, in each of 20
  repetitions, holds by the queue, not by git.

## Proposed text for delta 9

This is for #428 (M3-02). It is a proposal: the architect words the delta, and the owner ratifies
it. For the bracket in delta 9, "[A4: the operations M3-S1 shows need it]", I propose:

> fetching the main line, making a workspace, and pruning worktrees

If the architect adopts recommendation 5, delta 9 would also need a sentence for it, such as "It
retries once a fetch that another process's fetch beat to the remote-tracking ref." That wording
is the architect's.

## What would reverse this

| Recommendation | Reversed by |
|---|---|
| Fetch in the queue | 0 fetch failures at 3 and 6 at once, with the remote advancing before each round, on a later git. |
| Creation in the queue | 0 failures of `--no-track` creation over at least 2,000 creations at 6 at once. The 20-round bar is too weak for a failure measured at about 0.3%. |
| Prune in the queue | 0 prune failures at 3 and 6 at once, over at least 100 rounds, with stale entries present. |
| Remove, reset and delete outside the queue | Any failure of one of them at 3 or 6 at once, or mixed with a queued operation, under names #429 (M3-03) admits. Or a topic form that admits `/`. |
| `--no-track` | A need for Rigger to read a workspace's upstream. Creation with tracking would then need the queue and a retry, since an agent can write the same config. |
| No retry for a held commit | Any failure of an operation, or of the commit, while the commit's ref lock is shown held. A second worktree committing during automatic maintenance, which holds packed-refs.lock, is the case not measured here. |
| The fetch retry, recommendation 5 | A fetch form that writes no ref an agent's fetch writes, shown to fail 0 of 20 against an agent's fetch. The retry is then unnecessary. |
| The queue costs little | A consumer repository where the median creation exceeds about 5 s (A4 row 3). The queue then serializes checkouts that cost seconds, and the architect re-weighs. |

## Found on the way

These are outside the acceptance. The card's brief has the maker name them rather than file
them.

- **A failed creation leaves its new branch, and a failed `-B` moves an existing one.** This holds
  in the non-empty-directory case (as engineer 11 measured) and in every concurrent failure.
  #431 (M3-05)'s item that a failed attempt leaves the card's branch where it was cannot hold if
  it relies on git.
- **Tracking writes its upstream even when the add then fails.** The `-B` and `-b` rows under
  "Existing non-empty directory" print `set up to track` before the `fatal`.
- **Two fetches on one repository fail about half the time once the remote has moved,** whichever
  worktree each runs in. From M4, makers fetch while Rigger does.

## The throwaway code

The harness, the edge-case script and every result file lie in the gitignored spikes directory
of the maker's worktree and in c426-probe/ under the session scratchpad. None of it is in this
pull request.
