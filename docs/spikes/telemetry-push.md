ABOUTME: Spike findings for card #1018 (M7-03): whether Rigger's telemetry push to a data ref goes
better through `git push` or `gh api`, to a branch or to a refs/rigger/ ref, measured on a probe.

# Telemetry push to a data ref

## Question and method

`README.md` ("Telemetry") and `docs/v0-build-plan.md` §4 M7 promise that, once the owner turns it
on, Rigger pushes the event stream to a data ref in the consumer's own repository. Card #1018 asks
four things the repository cannot settle by reasoning:

- whether that write goes better through `git push` or through `gh`'s git data API;
- what the consumer's repository rules do to it;
- whether it starts the consumer's workflows;
- what it costs at the stream's present size.

The architect's r1 review, S9 (1009#6433591635), places the push's L0 side by this answer. If it
goes through `gh`'s git data API, the side sits in `src/substrate/forge/`. If it goes through
`git push`, it sits in a new module in `src/substrate/`. This report hands over evidence for M7-07,
and it changes no code, requirement or recorded decision.

Everything was measured on 2026-10-27, from 21:08Z to 21:25Z, against the owner-made public
repository williacj/rigger-spike-1018-probe (M7-U4 Q23 (c), 1009#6449422492). Every stream
written there was synthetic. The owner's M7-U5 Q26 (a) (1009#6453120551) let me add one workflow
file and the rulesets the card names. The card's revision is `fb80b755b755`.

The throwaway scripts lived in the gitignored `/spikes/` directory of the card's worktree, and none
of them is in this pull request. Their command sequences are quoted below, so a reader can repeat
every cell.

## Host, probe and transcript

| Fact | Read | Transcript entry |
|---|---|---|
| macOS | `sw_vers`: ProductVersion 27.0.1, BuildVersion 26A434 | #0002 |
| git | `git --version`: `git version 2.54.0 (Apple Git-157)` | #0003 |
| gh | `gh --version`: `gh version 2.103.2 (2026-10-23)` | #0004 |
| Time measured | `date -u`: `2026-10-27T21:09:00Z`. The cells ran from 21:13:13Z to 21:23:30Z | #0005 |
| Sign-in | `gh auth status`: account `williacj` (keyring). Token scopes `gist`, `project`, `read:org`, `repo`, `workflow`; there is no `delete_repo` | #0006 |
| git's credential | `git config --global --get-all 'credential.https://github.com.helper'`: `!/opt/homebrew/bin/gh auth git-credential`. Read before the wrapper existed, so it is in the session record, not the transcript (see "Commands outside the wrapper") | session call 17 |
| Probe before any write | `gh repo view williacj/rigger-spike-1018-probe --json isEmpty,visibility,createdAt,defaultBranchRef,pushedAt` → `{"createdAt":"2026-10-27T17:46:01Z","defaultBranchRef":{"name":""},"isEmpty":true,"pushedAt":"2026-10-27T17:46:03Z","visibility":"PUBLIC"}` | #0007 |
| Probe visibility | `gh api repos/williacj/rigger-spike-1018-probe --jq .visibility` → `public` | #0008 |
| Probe's rulesets, Actions and workflows before any write | `rulesets` → `[]`. actions/permissions → `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`. actions/workflows → `{"total_count":0,"workflows":[]}`. `gh run list` → `[]`. git/refs → 409 "Git Repository is empty." | #0010 to #0014 |

- **The probe's `createdAt` comes before the transcript.** It is 2026-10-27T17:46:01Z. The
  transcript's first entry is #0001, a self-test of the wrapper at 2026-10-27T21:08:07.104Z.
- **The probe's first write came after the emptiness read.** The read is #0007, at 21:09:01Z. The
  first write is the seed push, #0033, at 21:13:13Z.
- **The full transcript** is `~/Library/Logs/rigger-spike-1018/transcript.txt`, with a one-line
  index at `~/Library/Logs/rigger-spike-1018/index.tsv`, and each entry's stdout and stderr in
  `~/Library/Logs/rigger-spike-1018/out/`. All of it is outside any worktree or scratch directory.
  - **What it holds.** Every command against the probe, and every comment I posted on #1018, ran
    through a wrapper. The wrapper recorded the command's start and end in UTC to the millisecond,
    its wall time, its exit status and its full stdout and stderr, and numbered each entry. A
    script's own entry is written after the entries of the commands it ran, so the index is ordered
    by entry number and not by line. Its 945 entries end at #0945.
  - **Where it is kept, and its hashes.** It is retained on two hosts at that same path, read-only
    for the judges: on this host, where it was written, and on the mini, where the coordinator
    copied the whole `~/Library/Logs/rigger-spike-1018/` tree after round 1. Measured on this host
    with `shasum -a 256` on 2026-10-27, after the last entry:
    - transcript.txt: `e427be13d0fe71c60ddcc8c52afdcad5b11482109b19a68fa203248dcff5fdeb`;
    - index.tsv: `d93854b5efb55ac1c791551ca8ec01380ac41c981db580d72714c187ddaa8d0f`.

    The coordinator reported the mini's copy with hashes beginning `e427be13` and ending `5fdeb`,
    and beginning `d93854b5` and ending `8d0f`. I did not read the mini myself.
  - **What it does not hold** is the commands I ran outside the wrapper. "Commands outside the
    wrapper" below gives each one that reached GitHub, from the session record.

## Writes

Before the first write to the probe I posted its name, its visibility and the writes I intended
(1018#6453697601). My first try at that comment failed with a GraphQL error and posted nothing
(#0026), and the REST retry posted it (#0027).

I posted every probe write the transcript records on #1018, each with its time, command and exit
status:

- 1018#6453811573 covers entries #0028 to #0619: the seed, the write crossing and the size
  crossing.
- 1018#6453933369 covers entries #0622 to #0940: the workflow file, the workflows crossing and the
  rules crossing.

Every write the transcript records went to the probe, except these comments on #1018:

- the intent comment (#0027), and its failed first try (#0026), which posted nothing;
- the two writes comments above (#0620, #0945), and one edit of 1018#6453811573 to correct an entry
  number (#0621);
- the block comment, 1018#6453927183 (#0941).

The push of branch `rigger-1018` and its pull request ran outside the wrapper. They are in the
session record (session call 99), and no other write to GitHub is.

Every write to the probe is one of these:

- a synthetic stream on a ref;
- a git object that carries one: a blob, tree or commit made through `gh api`, or the objects
  `git push` sent;
- the one `push` workflow file;
- a ruleset the card's rules row names.

### Unplanned writes, with their reasons

- **refs/heads/w2-api and refs/rigger/w2-api** (entries #0236 to #0329) were not in the intent
  list. My harness lost the API mechanism's commit sha. The ref-create answer has no trailing
  newline, so my `COMMIT=` marker was not read. As a result the first run's `update-parent` cells
  on `refs/<ns>/w-api` sent `parents[]=update`, which the forge refused with 422 (#0113, #0206),
  after it had already made that cell's blob and tree.
  - The later cells on `w-api` then updated from the first commit and not from an update with a
    parent, so they do not measure what they are named for. They are void.
  - I fixed the harness and reran all four API write cells on the fresh refs `w2-api`. Those reruns
    are the cells reported below.
- **The second copy of "Main"** (#0783). The forge refused the copy as read (#0779). The retry kept
  everything except the three `integration_id`s, which is what was left out. The input to #0779
  came from a read of ruleset 23968611 that ran outside the wrapper, in the same shell command as
  #0779. That read is session call 53, started 21:21:35.421Z, and it exited 0: the command chained
  it with `&&` to the `cat` and the post, and both ran. #0781 is a second, separate read under the
  wrapper, not the original. Its output is what #0783 was built from.
- **The `jq` call** (#0782), which stripped those `integration_id`s from the copy. It is a host
  tool, used for the experiment's setup and in neither mechanism.

### The blocked step

After the forge refused every ruleset for `refs/rigger/*` (see "Rules" below), I tried one more,
which was not in the intent list. It was a `branch` ruleset with `include: ["~ALL"]` and a
`creation` rule, followed by a first write to `refs/heads/r3-<m>` and `refs/rigger/r3-<m>`. The
host's permission classifier refused the command: "Permission for this action was denied by the
Claude Code auto mode classifier. Reason: [Modify Shared Resources]."

None of it ran. The transcript's last probe write is #0939, and #0940 is a read. My next action was
the block comment, 1018#6453927183 (#0941), which escalated the card `ambiguous`. After it the
transcript holds only reads of the probe (#0942 to #0944) and the second writes post (#0945).

The owner then ruled, in M7-U7 Q32 (a) (1009#6454836792), that this report is written from the
cells measured, with that check listed as not measured.

## The streams

Every stream written to the probe was synthetic. Each was made by one `gen` entry in the
transcript, 71 in all, every one with exit 0. Every one of them ran this exact command, with only
`<label>` and `<bytes>` varying:

```
node /Users/cjwilliams/GitHub/rigger-worktrees/1018-spike/spikes/bin/gen-stream.mjs /Users/cjwilliams/GitHub/rigger-worktrees/1018-spike/spikes/streams/<label>.jsonl <bytes> <label>
```

The first, #0028, is
`node /Users/cjwilliams/GitHub/rigger-worktrees/1018-spike/spikes/bin/gen-stream.mjs /Users/cjwilliams/GitHub/rigger-worktrees/1018-spike/spikes/streams/seed.jsonl 1243 seed`.
"Each stream's generating command" below gives each call's two varying arguments and the write
that sent it. The generator writes JSON lines shaped like Rigger's envelope, with keys `ts`, `run`,
`layer`, `event`, `card` and `dispatch`. Every value is invented from the label and a counter. The
last line is padded so that the file is exactly `<bytes>` long. Each write used its own label, so
no two writes sent the same blob, except where noted.

**Real size: 1,243 bytes.** That is the size of the largest Rigger events.jsonl on the host,
`/Users/cjwilliams/GitHub/rigger-worktrees/judge-944-codex-r4/tmp/rigger-suite.ZWAFxy/admission-43FRoA/.rigger/events.jsonl`.
I read its size with `stat -f "%z %m %N"` (#0015) and never read its content. A
`find /Users/cjwilliams /private/var/folders/86 -name events.jsonl -path "*.rigger*"` (#0016) found
four Rigger streams, all left by test runs. There is no .rigger state directory anywhere else
on the host. That fits `src/observation/sink.mjs`, whose header says "nothing emits yet". So the
stream's present size is a test fixture's size, not a working engine's.

**10 MB: 10,485,760 bytes**, made the same way.

## The mechanisms

Every measured commit's tree holds events.jsonl alone. Its parent is none on a first write or on
an update with no shared history. On an update with a parent, it is the previous stream commit.

**`push`** (`spikes/bin/push-write.zsh <ref> <file> <parent|none> <plain|force>`). It ran in a
scratch repository made with `git init`, which had no remote, and it pushed to
`$PROBE_URL`, meaning `https://github.com/williacj/rigger-spike-1018-probe.git`:

```
blob=$(git hash-object -w <file>)
tree=$(printf '100644 blob %s\tevents.jsonl\n' $blob | git mktree)
commit=$(git commit-tree $tree [-p <parent>] -m "synthetic stream <ref>")
git push --porcelain $PROBE_URL [+]$commit:<ref>
```

**`api`** (`spikes/bin/api-write.zsh <ref> <file> <parent|none> <create|update|update-force>`):

```
blob=$(gh api repos/williacj/rigger-spike-1018-probe/git/blobs -F content=@<file> -f encoding=utf-8 --jq .sha)
tree=$(gh api repos/williacj/rigger-spike-1018-probe/git/trees -f 'tree[][path]=events.jsonl' -f 'tree[][mode]=100644' -f 'tree[][type]=blob' -f "tree[][sha]=$blob" --jq .sha)
commit=$(gh api repos/williacj/rigger-spike-1018-probe/git/commits -f "message=synthetic stream <ref>" -f "tree=$tree" -f 'parents[]' --jq .sha)   # or -f "parents[]=<parent>"
gh api repos/williacj/rigger-spike-1018-probe/git/refs -f "ref=<ref>" -f "sha=$commit"                  # create
gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/<ref> -f "sha=$commit" -F force=false     # update (force=true where forced)
```

**Read-back** (`spikes/bin/readback.zsh <ref> <file>`), in a second scratch repository:

```
git ls-remote $PROBE_URL <ref>
git fetch --no-tags $PROBE_URL +<ref>:refs/readback/<ref without refs/>
git ls-tree -r <fetched commit>
git cat-file blob <fetched commit>:events.jsonl > readback.tmp
cmp readback.tmp <file>
```

### Host tools each mechanism needed (`R-SAFE-2`)

| Mechanism | Tools | Beyond `gh`, `git` and the agent CLI? |
|---|---|---|
| `push` | `git` (`hash-object`, `mktree`, `commit-tree`, `push`); `gh`, as git's credential helper for github.com; the shell, to pass shas between commands | No |
| `api` | `gh` (`gh api`) alone. `-F content=@<file> -f encoding=utf-8` sends the file as a UTF-8 string, so no base64 step is needed. The 10 MB blobs went through it, and their bytes read back identical. The shell passed shas between calls | No |

The harness used more tools than the mechanisms did: `node` for the generator, `zsh` for the
wrapper and scripts, `stat`, `find`, `cmp` and `awk` for reads, and `jq` once (#0782). None of
them is part of either mechanism.

### Whether an update needed a forced write

| Mechanism | Update with a parent | Update with no shared history |
|---|---|---|
| `push` | No: a plain push was accepted on both namespaces | Yes, on both namespaces. The unforced push was rejected as `[rejected] (non-fast-forward)`, which is git's own client-side check, and `+<sha>:<ref>` was accepted |
| `api` | No: `force=false` was accepted on both namespaces | On refs/heads/, yes: `force=false` got 422 "Update is not a fast forward", and `force=true` was accepted. **On refs/rigger/, no: `force=false` was accepted** (#0312 in the `w2` rerun, and #0218 in the void first run). The forge does not check fast-forward on that ref through the API |

## Order run, and the combinations skipped

The crossings ran in the order the card fixes:

1. **Seed** (#0028 to #0049). `git push` of one stream-only commit, `122d7130`, to
   refs/heads/main. Afterwards `gh repo view` read `defaultBranchRef` `main` and `isEmpty` false
   (#0037).
2. **The write crossing** (#0050 to #0329), with the `w2-api` rerun at the end, and **the size
   crossing** (#0330 to #0617). Both ran with no workflow file and no ruleset on the probe.
3. **The workflow file and its positive control** (#0622 to #0632), then **the workflows crossing**
   (#0633 to #0682).
4. **The rules crossing** (#0683 to #0940): first rules none, then the copy of "Main", then the
   refusing rulesets.

The skipped combinations are these:

- **Any crossing outside Table B's four.** The card puts these out under Table A's last row.
- **A push that times out.** Not measured; M7-31's fake carries that cell.
- **A refusing ruleset on refs/rigger/.** The forge admits none (see "Rules"), so the refused
  write on that namespace could not be tried.
- **Update with a parent through `api` on `refs/<ns>/w-api`**, in the void first run. The `w2-api`
  rerun covers it.

Beyond the card's cells:

- **The size crossing ran three repetitions per cell**, on refs `s-<m>-<size>-<k>`, to show the
  spread of wall times. The write crossing's real-size first write is the same combination as the
  size crossing's real-size cell, and both are reported.
- **The `~ALL` branch ruleset was blocked** before it ran (see "The blocked step").

## williacj/rigger as read at the run

These are reads only, and nothing was set there.

| Read | Command | Output | Entry |
|---|---|---|---|
| Rulesets | `gh api repos/williacj/rigger/rulesets` | one ruleset, `23968611` "Main", target `branch`, enforcement `active` | #0017 |
| "Main" | `gh api repos/williacj/rigger/rulesets/23968611` | `ref_name.include` `["~DEFAULT_BRANCH","refs/heads/main"]`, `exclude` `[]`. Rules: `deletion`; `non_fast_forward`; `pull_request` (`required_approving_review_count` 0, `require_extra_approval_for_unattributed_changes` true, `allowed_merge_methods` merge, squash, rebase, every other flag false); `required_status_checks` (`check (26)` with `integration_id` 15368, rigger/gate and `self-hosting` with 5291719; `strict_required_status_checks_policy` false, `do_not_enforce_on_create` false). `bypass_actors` `[]`, `current_user_can_bypass` `never` | #0018 |
| Branch protection | `gh api repos/williacj/rigger/branches/main/protection` | `{"message":"Branch not protected",…,"status":"404"}`, exit 1 | #0019 |
| Rules on `main` | `gh api repos/williacj/rigger/rules/branches/main` | the four rules of 23968611 and no others | #0020 |
| Visibility | `gh api repos/williacj/rigger --jq .visibility` | `public` | #0021 |
| Workflow files | `gh api "repos/williacj/rigger/contents/.github/workflows?ref=main" --jq ".[].path"` | `.github/workflows/ci.yml`, `.github/workflows/rigger-gate.yml`, `.github/workflows/self-hosting.yml` | #0022 |

The workflow `on:` blocks were read with
`gh api -H "Accept: application/vnd.github.raw" "repos/williacj/rigger/contents/.github/workflows/<file>?ref=main"`,
cut to the `on:` block with `awk` (#0023 to #0025):

```yaml
# ci.yml
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review, labeled, unlabeled]
  merge_group:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

# rigger-gate.yml, and self-hosting.yml the same
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types: [created, edited, deleted]
  issues:
    types: [edited, labeled, unlabeled]
```

Only `.github/workflows/ci.yml` has a `push` trigger, and it is filtered to `main`.

## Results

### The write crossing (real size, no rules, no workflows)

| Namespace | Mechanism | First write | Update with a parent | No shared history, unforced | No shared history, forced |
|---|---|---|---|---|---|
| refs/heads/ | `push` | exit 0, 1.960 s | exit 0, 1.548 s | exit 1, 0.630 s, non-fast-forward | exit 0, 1.418 s |
| refs/heads/ | `api` (`w2`) | exit 0, 4.166 s | exit 0, 2.564 s | exit 1, 2.921 s, 422 "Update is not a fast forward" | exit 0, 3.125 s |
| refs/rigger/ | `push` | exit 0, 1.661 s | exit 0, 1.614 s | exit 1, 0.925 s, non-fast-forward | exit 0, 2.008 s |
| refs/rigger/ | `api` (`w2`) | exit 0, 3.287 s | exit 0, 3.342 s | **exit 0, 2.927 s, accepted** | exit 0, 2.367 s |

The wall time is the whole write: building the commit and pushing it, or the four API calls. Each
cell's commands, read-back and byte comparison are in "Every cell" below.

### The size crossing (first write, no rules, no workflows)

Whole-write wall time in seconds, for repetitions 1, 2 and 3, with the median:

| Size | Namespace | `push` | `api` |
|---|---|---|---|
| 1,243 B | refs/heads/ | 1.909, 1.510, 1.643; median 1.643 | 2.624, 2.299, 3.044; median 2.624 |
| 1,243 B | refs/rigger/ | 1.694, 1.620, 1.779; median 1.694 | 2.347, 2.379, 2.621; median 2.379 |
| 10 MB | refs/heads/ | 2.181, 3.335, 2.447; median 2.447 | 5.563, 4.585, 6.162; median 5.563 |
| 10 MB | refs/rigger/ | 3.280, 3.420, 3.286; median 3.286 | 6.034, 5.470, 5.734; median 5.734 |

All 24 of these writes exited 0, and every stream read back byte-identical. At 10 MB the
`git push` command alone took 2.008 to 3.176 s. The API's blob call alone took 2.827 to 4.041 s,
and each of its other three calls took about 0.4 to 0.9 s at either size.

My judgment of why `push` is cheaper at 10 MB, which I did not measure: git sends a compressed
pack, and these JSON lines compress well, while the API sends the stream as a JSON-escaped string.

### Workflows

**The workflow file**, committed to the probe as .github/workflows/probe-push.yml in commit
`a19538891ceac6adfa46f6c60cd475bbf7ef79ac` (child of the seed `122d7130`, pushed to
refs/heads/main by `git push`, #0628), read back from the probe with
`gh api -H "Accept: application/vnd.github.raw" "repos/williacj/rigger-spike-1018-probe/contents/.github/workflows/probe-push.yml?ref=a19538891ceac6adfa46f6c60cd475bbf7ef79ac"`
(#0631):

```yaml
# ABOUTME: Probe workflow for rigger spike 1018: runs on every push to any branch or tag, and prints what fired it.
name: probe-push
on: push
jobs:
  record:
    runs-on: ubuntu-latest
    steps:
      - run: echo "event=$GITHUB_EVENT_NAME ref=$GITHUB_REF sha=$GITHUB_SHA"
```

That commit's `git ls-tree -r` (#0632) is .github/workflows/probe-push.yml (blob `e857df16`) and
events.jsonl (the seed's blob `a04de4c7`).

**The positive control.** The push of that commit ended at 21:19:03.919Z (#0628). Its run,
40585753864, has `created_at` and `run_started_at` both at 2026-10-27T21:19:09Z. It ran on event
`push`, head branch `main` and head sha `a1953889`, and it ended `completed`, `success` (#0629,
#0630). So the workflow fires, about **5.1 s** after the push ended. The forge gives that figure to
the second, so the delay lies between 5.08 and 6.08 s. A poll every 2 s found the run 5.5 s after
polling began.

**The wait used.** Each run-list read came at least 14 s after the last write it covers, and the
two after the workflow file existed came 61 s after. Both are past that delay:

| Read | Entry, time | Last write it covers | Wait |
|---|---|---|---|
| after the write and size crossings, before the workflow file existed | #0618, 21:18:05Z | S/rigger/api/10m/3, ended 21:17:51Z | about 14 s, with no workflow on the probe |
| after the workflows crossing | #0681, 21:20:41Z | F/rigger/api, ended 21:19:40Z | 61 s |
| after the rules crossing | #0942, 21:24:31Z | R/r2 last write #0939, ended 21:23:30Z | 61 s |

**What each list held.** Every list read was
`gh run list -R williacj/rigger-spike-1018-probe --json event,headBranch,headSha,createdAt`.

- #0618: `[]`.
- #0681 and #0942: only
  `{"createdAt":"2026-10-27T21:19:09Z","event":"push","headBranch":"main","headSha":"a19538891ceac6adfa46f6c60cd475bbf7ef79ac"}`.
  That is the control's run, by its event, ref and head commit.
- #0682: the API's actions/runs read the same single run.

**So no measured write started a workflow run**, in any crossing, on either namespace, by either
mechanism. That includes the four workflows-crossing writes, `refs/<ns>/f-<m>` (#0633 to #0680),
which pushed stream-only commits while the unfiltered `push` workflow sat on `main`. #0942 also
read after the rules crossing's writes, including the refs/heads/ writes under the copied "Main".

My reading of this, a judgment: GitHub looks for workflow files in the pushed commit's own tree
(GitHub's documentation, quoted in the r3 attack's B1, 1018#6453338755), and a stream-only commit
has none. The measurement covers only the fixed stream-only tree. It does not show what a stream
commit carrying the consumer's `.github/` would do.

### Rules

**Rules none** (`r0`, #0683 to #0778). All eight writes exited 0: the first write and the update
with a parent, for each mechanism on each namespace.

**The copy of williacj/rigger's "Main".** Branch protection on `main` read 404, so the ruleset
was all there was to copy.

- **Copy as read** (#0779): `gh api -X POST repos/williacj/rigger-spike-1018-probe/rulesets --input ruleset-main-copy.json`,
  with the input being `{name,target,enforcement,conditions,rules,bypass_actors}` of 23968611.
  The forge refused it:
  `{"message":"Validation Failed","errors":["Invalid rule 'required_status_checks': Invalid parameter required_status_checks: Invalid integration ids"],…,"status":"422"}`,
  exit 1. Read back (#0780): `[]`.
- **Copy without the three `integration_id`s** (#0783). Everything else was as read, so the
  contexts `check (26)`, rigger/gate and `self-hosting` stayed. The forge accepted it as ruleset
  **25993857** "Main": target `branch`, `active`, include `["~DEFAULT_BRANCH","refs/heads/main"]`,
  the four rules, and `bypass_actors` `[]`.
- **Read back.** `gh api repos/williacj/rigger-spike-1018-probe/rulesets` (#0784) listed 25993857
  alone. `…/rulesets/25993857` (#0785) gave the body above. `…/rules/branches/main` (#0786) gave
  `["deletion","non_fast_forward","pull_request","required_status_checks"]`, and
  `…/rules/branches/r1-push` (#0787) gave `[]`.

**Under the copy** (`r1`, #0788 to #0883), all eight writes exited 0: the first write and the
update with a parent, for each mechanism on each namespace. The copy covers `main` only, and no
measured cell writes `main`.

**A refusing ruleset on refs/heads/.** First I pre-created `refs/<ns>/r2-u-<m>` with a first
write each (#0884 to #0907), so that an update had a ref to act on. Then I created this ruleset
(#0908):

```json
{"name":"deny-heads-r2","target":"branch","enforcement":"active","bypass_actors":[],
 "conditions":{"ref_name":{"include":["refs/heads/r2-*"],"exclude":[]}},
 "rules":[{"type":"creation"},{"type":"update","parameters":{"update_allows_fetch_and_merge":false}},{"type":"non_fast_forward"}]}
```

The forge accepted it as ruleset **25993929**. Read back: `rulesets` (#0909) listed 25993857 and
25993929, and rules/branches/r2-u-push (#0912) gave `creation`, `update` and `non_fast_forward`,
each from 25993929.

| Refused write | Mechanism | Exit | Error text (in full under "Error texts") |
|---|---|---|---|
| first write, refs/heads/r2-c-push | `push` | 1 | `[remote rejected] (push declined due to repository rule violations)`; `remote: error: GH013: Repository rule violations found for refs/heads/r2-c-push.` … `- Cannot create ref due to creations being restricted.` |
| update with a parent, refs/heads/r2-u-push | `push` | 1 | the same GH013, with `- Cannot update this protected ref.` |
| first write, refs/heads/r2-c-api | `api` | 1 | 422 `{"message":"Reference update failed",…}`. **The rule is not named.** |
| update with a parent, refs/heads/r2-u-api | `api` | 1 | 422 `{"message":"Repository rule violations found\n\nCannot update this protected ref.\n\n",…}` |

After the four refusals, `git ls-remote $PROBE_URL "refs/heads/r2-*"` (#0940) showed only
`r2-u-api` at `18aec62d` and `r2-u-push` at `bf930ebf`, which are their pre-created commits.
Neither `r2-c-*` ref exists.

**A refusing ruleset on refs/rigger/. The forge admits none.**

- A `branch` ruleset, the one above with `include: ["refs/rigger/r2-*"]` (#0910), was refused:
  `{"message":"Validation Failed","errors":["Invalid target patterns: 'refs/rigger/r2-*'"],…,"status":"422"}`.
  Read back (#0911): 25993857 and 25993929 only.
- A `tag` ruleset with the same include (#0913) got the same answer. Read back (#0914): the same
  two rulesets.

So the rules a forge admits cannot take in a refs/rigger/ ref by name. Whether a ruleset that
names no ref, such as a `branch` ruleset over `~ALL`, reaches one was the blocked step, and it is
not measured.

**After every ruleset create**, the probe's rulesets were read back with
`gh api repos/williacj/rigger-spike-1018-probe/rulesets`: #0780, #0784, #0909, #0911 and #0914.
The last read, #0943, lists 25993857 "Main" and 25993929 `deny-heads-r2`.

## Each stream's generating command

Each row is one `gen` entry. Its command is the one under "The streams", with the `<label>` and
`<bytes>` given here. The last column names the write script, and its transcript entry, that sent
the file to the probe. The workflow commit (#0622) reused the seed's stream and generated none.

| Gen entry | Start (UTC) | Exit | `<label>` | `<bytes>` | Written to the probe by |
|---|---|---|---|---|---|
| #0028 | 2026-10-27T21:13:09.224Z | 0 | seed | 1243 | seed (#0029) |
| #0050 | 2026-10-27T21:13:42.715Z | 0 | w-heads-push-1 | 1243 | W/heads/push/first (#0051) |
| #0062 | 2026-10-27T21:13:45.727Z | 0 | w-heads-push-2 | 1243 | W/heads/push/update-parent (#0063) |
| #0074 | 2026-10-27T21:13:48.233Z | 0 | w-heads-push-3 | 1243 | W/heads/push/update-unrelated-unforced (#0075); W/heads/push/update-unrelated-forced (#0086) |
| #0097 | 2026-10-27T21:13:52.150Z | 0 | w-heads-api-1 | 1243 | W/heads/api/first (#0098) |
| #0109 | 2026-10-27T21:13:55.761Z | 0 | w-heads-api-2 | 1243 | W/heads/api/update-parent (#0110) |
| #0120 | 2026-10-27T21:13:58.320Z | 0 | w-heads-api-3 | 1243 | W/heads/api/update-unrelated-unforced (#0121); W/heads/api/update-unrelated-forced (#0132) |
| #0143 | 2026-10-27T21:14:06.053Z | 0 | w-rigger-push-1 | 1243 | W/rigger/push/first (#0144) |
| #0155 | 2026-10-27T21:14:09.073Z | 0 | w-rigger-push-2 | 1243 | W/rigger/push/update-parent (#0156) |
| #0167 | 2026-10-27T21:14:11.973Z | 0 | w-rigger-push-3 | 1243 | W/rigger/push/update-unrelated-unforced (#0168); W/rigger/push/update-unrelated-forced (#0179) |
| #0190 | 2026-10-27T21:14:19.033Z | 0 | w-rigger-api-1 | 1243 | W/rigger/api/first (#0191) |
| #0202 | 2026-10-27T21:14:24.214Z | 0 | w-rigger-api-2 | 1243 | W/rigger/api/update-parent (#0203) |
| #0213 | 2026-10-27T21:14:27.177Z | 0 | w-rigger-api-3 | 1243 | W/rigger/api/update-unrelated-unforced (#0214); W/rigger/api/update-unrelated-forced (#0225) |
| #0236 | 2026-10-27T21:14:54.775Z | 0 | w2-heads-api-1 | 1243 | W/heads/api/w2/first (#0237) |
| #0248 | 2026-10-27T21:15:01.411Z | 0 | w2-heads-api-2 | 1243 | W/heads/api/w2/update-parent (#0249) |
| #0260 | 2026-10-27T21:15:05.509Z | 0 | w2-heads-api-3 | 1243 | W/heads/api/w2/update-unrelated-unforced (#0261); W/heads/api/w2/update-unrelated-forced (#0272) |
| #0283 | 2026-10-27T21:15:14.647Z | 0 | w2-rigger-api-1 | 1243 | W/rigger/api/w2/first (#0284) |
| #0295 | 2026-10-27T21:15:20.430Z | 0 | w2-rigger-api-2 | 1243 | W/rigger/api/w2/update-parent (#0296) |
| #0307 | 2026-10-27T21:15:25.039Z | 0 | w2-rigger-api-3 | 1243 | W/rigger/api/w2/update-unrelated-unforced (#0308); W/rigger/api/w2/update-unrelated-forced (#0319) |
| #0330 | 2026-10-27T21:15:50.453Z | 0 | s-heads-push-real-1 | 1243 | S/heads/push/real/1 (#0331) |
| #0342 | 2026-10-27T21:15:53.667Z | 0 | s-heads-api-real-1 | 1243 | S/heads/api/real/1 (#0343) |
| #0354 | 2026-10-27T21:15:58.929Z | 0 | s-rigger-push-real-1 | 1243 | S/rigger/push/real/1 (#0355) |
| #0366 | 2026-10-27T21:16:03.881Z | 0 | s-rigger-api-real-1 | 1243 | S/rigger/api/real/1 (#0367) |
| #0378 | 2026-10-27T21:16:07.330Z | 0 | s-heads-push-10m-1 | 10485760 | S/heads/push/10m/1 (#0379) |
| #0390 | 2026-10-27T21:16:10.980Z | 0 | s-heads-api-10m-1 | 10485760 | S/heads/api/10m/1 (#0391) |
| #0402 | 2026-10-27T21:16:18.236Z | 0 | s-rigger-push-10m-1 | 10485760 | S/rigger/push/10m/1 (#0403) |
| #0414 | 2026-10-27T21:16:23.013Z | 0 | s-rigger-api-10m-1 | 10485760 | S/rigger/api/10m/1 (#0415) |
| #0426 | 2026-10-27T21:16:30.730Z | 0 | s-heads-push-real-2 | 1243 | S/heads/push/real/2 (#0427) |
| #0438 | 2026-10-27T21:16:33.286Z | 0 | s-heads-api-real-2 | 1243 | S/heads/api/real/2 (#0439) |
| #0450 | 2026-10-27T21:16:36.690Z | 0 | s-rigger-push-real-2 | 1243 | S/rigger/push/real/2 (#0451) |
| #0462 | 2026-10-27T21:16:39.481Z | 0 | s-rigger-api-real-2 | 1243 | S/rigger/api/real/2 (#0463) |
| #0474 | 2026-10-27T21:16:43.459Z | 0 | s-heads-push-10m-2 | 10485760 | S/heads/push/10m/2 (#0475) |
| #0486 | 2026-10-27T21:16:48.320Z | 0 | s-heads-api-10m-2 | 10485760 | S/heads/api/10m/2 (#0487) |
| #0498 | 2026-10-27T21:16:54.983Z | 0 | s-rigger-push-10m-2 | 10485760 | S/rigger/push/10m/2 (#0499) |
| #0510 | 2026-10-27T21:17:00.398Z | 0 | s-rigger-api-10m-2 | 10485760 | S/rigger/api/10m/2 (#0511) |
| #0522 | 2026-10-27T21:17:07.931Z | 0 | s-heads-push-real-3 | 1243 | S/heads/push/real/3 (#0523) |
| #0534 | 2026-10-27T21:17:10.990Z | 0 | s-heads-api-real-3 | 1243 | S/heads/api/real/3 (#0535) |
| #0546 | 2026-10-27T21:17:16.763Z | 0 | s-rigger-push-real-3 | 1243 | S/rigger/push/real/3 (#0547) |
| #0558 | 2026-10-27T21:17:19.999Z | 0 | s-rigger-api-real-3 | 1243 | S/rigger/api/real/3 (#0559) |
| #0570 | 2026-10-27T21:17:25.083Z | 0 | s-heads-push-10m-3 | 10485760 | S/heads/push/10m/3 (#0571) |
| #0582 | 2026-10-27T21:17:29.722Z | 0 | s-heads-api-10m-3 | 10485760 | S/heads/api/10m/3 (#0583) |
| #0594 | 2026-10-27T21:17:37.950Z | 0 | s-rigger-push-10m-3 | 10485760 | S/rigger/push/10m/3 (#0595) |
| #0606 | 2026-10-27T21:17:45.617Z | 0 | s-rigger-api-10m-3 | 10485760 | S/rigger/api/10m/3 (#0607) |
| #0633 | 2026-10-27T21:19:27.507Z | 0 | f-heads-push | 1243 | F/heads/push (#0634) |
| #0645 | 2026-10-27T21:19:30.469Z | 0 | f-heads-api | 1243 | F/heads/api (#0646) |
| #0657 | 2026-10-27T21:19:33.938Z | 0 | f-rigger-push | 1243 | F/rigger/push (#0658) |
| #0669 | 2026-10-27T21:19:37.664Z | 0 | f-rigger-api | 1243 | F/rigger/api (#0670) |
| #0683 | 2026-10-27T21:20:58.174Z | 0 | r0-heads-push-1 | 1243 | R/r0/heads/push/first (#0684) |
| #0695 | 2026-10-27T21:21:02.152Z | 0 | r0-heads-push-2 | 1243 | R/r0/heads/push/update-parent (#0696) |
| #0707 | 2026-10-27T21:21:05.958Z | 0 | r0-heads-api-1 | 1243 | R/r0/heads/api/first (#0708) |
| #0719 | 2026-10-27T21:21:09.965Z | 0 | r0-heads-api-2 | 1243 | R/r0/heads/api/update-parent (#0720) |
| #0731 | 2026-10-27T21:21:14.986Z | 0 | r0-rigger-push-1 | 1243 | R/r0/rigger/push/first (#0732) |
| #0743 | 2026-10-27T21:21:19.716Z | 0 | r0-rigger-push-2 | 1243 | R/r0/rigger/push/update-parent (#0744) |
| #0755 | 2026-10-27T21:21:22.908Z | 0 | r0-rigger-api-1 | 1243 | R/r0/rigger/api/first (#0756) |
| #0767 | 2026-10-27T21:21:27.357Z | 0 | r0-rigger-api-2 | 1243 | R/r0/rigger/api/update-parent (#0768) |
| #0788 | 2026-10-27T21:21:57.847Z | 0 | r1-heads-push-1 | 1243 | R/r1/heads/push/first (#0789) |
| #0800 | 2026-10-27T21:22:01.455Z | 0 | r1-heads-push-2 | 1243 | R/r1/heads/push/update-parent (#0801) |
| #0812 | 2026-10-27T21:22:05.804Z | 0 | r1-heads-api-1 | 1243 | R/r1/heads/api/first (#0813) |
| #0824 | 2026-10-27T21:22:10.050Z | 0 | r1-heads-api-2 | 1243 | R/r1/heads/api/update-parent (#0825) |
| #0836 | 2026-10-27T21:22:14.134Z | 0 | r1-rigger-push-1 | 1243 | R/r1/rigger/push/first (#0837) |
| #0848 | 2026-10-27T21:22:17.745Z | 0 | r1-rigger-push-2 | 1243 | R/r1/rigger/push/update-parent (#0849) |
| #0860 | 2026-10-27T21:22:20.939Z | 0 | r1-rigger-api-1 | 1243 | R/r1/rigger/api/first (#0861) |
| #0872 | 2026-10-27T21:22:25.399Z | 0 | r1-rigger-api-2 | 1243 | R/r1/rigger/api/update-parent (#0873) |
| #0884 | 2026-10-27T21:22:37.082Z | 0 | r2-u-heads-push-1 | 1243 | R/r2/heads/push/precreate (#0885) |
| #0890 | 2026-10-27T21:22:40.196Z | 0 | r2-u-heads-api-1 | 1243 | R/r2/heads/api/precreate (#0891) |
| #0896 | 2026-10-27T21:22:42.920Z | 0 | r2-u-rigger-push-1 | 1243 | R/r2/rigger/push/precreate (#0897) |
| #0902 | 2026-10-27T21:22:46.320Z | 0 | r2-u-rigger-api-1 | 1243 | R/r2/rigger/api/precreate (#0903) |
| #0915 | 2026-10-27T21:23:22.091Z | 0 | r2-c-heads-push-1 | 1243 | R/r2/heads/push/first-refused (#0916) |
| #0921 | 2026-10-27T21:23:23.807Z | 0 | r2-u-heads-push-2 | 1243 | R/r2/heads/push/update-parent-refused (#0922) |
| #0928 | 2026-10-27T21:23:25.946Z | 0 | r2-c-heads-api-1 | 1243 | R/r2/heads/api/first-refused (#0929) |
| #0934 | 2026-10-27T21:23:28.181Z | 0 | r2-u-heads-api-2 | 1243 | R/r2/heads/api/update-parent-refused (#0935) |

## Commands outside the wrapper

The wrapper did not record the commands I ran before it existed, nor those I ran to read the card,
to set up the worktree or to deliver. Claude Code keeps its own record of every command this
session ran, as JSON lines:
`~/.claude/projects/-Users-cjwilliams-GitHub-rigger/8b20709e-597c-4245-af66-aa286847e27e/subagents/agent-a648ffe445ced5c04.jsonl`.
It is on this host only. It still grows while the session runs, and it only appends, so I hashed
a fixed prefix. Its first 439 lines run through the round-1 pr-body-check.sh call, and their
SHA-256 (`head -n 439 <file> | shasum -a 256`) is
`ee83ab66e8066baa07a1512d656d8e061163e5864e84bccc0d68c0dc4a9ae1ba`.

For each call the record gives two times and one flag:

- **Issued:** when the call was issued.
- **Returned:** when its result came back.
- **Status:** the flag the record sets on an error. "ok" means the whole shell command exited 0.
  Where one call ran several commands, the record holds the status of the whole command, not of
  each part.

Every call through the round-1 delivery whose command reached GitHub outside the wrapper is listed
below. A command that ran wholly inside the wrapper is in the transcript instead. No command
against the probe ran outside the wrapper. The only writes are session call 99.

| Session call | Issued (UTC) | Returned (UTC) | Status | What reached GitHub |
|---|---|---|---|---|
| 1 | 21:03:04.854Z | 21:03:06.386Z | ok | read: `gh issue view 1018 --json body` (twice) |
| 2 | 21:03:10.585Z | 21:03:12.685Z | ok | read: `gh api repos/williacj/rigger/issues/1018/comments --paginate` |
| 4 | 21:03:25.528Z | 21:03:27.553Z | ok | read: `gh api repos/williacj/rigger/issues/comments/<id>` for the three #1009 rulings |
| 5 | 21:03:32.713Z | 21:03:33.998Z | ok | read: `git fetch origin -q` in the main checkout |
| 6 | 21:03:38.044Z | 21:03:39.354Z | ok | read: `git ls-remote origin 'refs/heads/rigger-1018'`, which printed nothing, then the local `git worktree add` |
| 17 | 21:07:42.748Z | 21:07:44.713Z | ok | read: `gh auth status`, `gh --version`. The same call also ran `git config --global --get-all credential.helper`, `git config --system --get-all credential.helper`, `git config --global --get-all 'credential.https://github.com.helper'`, `sw_vers`, `git --version` and `node --version`, which are local reads. Each part's own exit status was not recorded, and it is unrecoverable. The output shows the third `git config` printing `!/opt/homebrew/bin/gh auth git-credential`, and the first two printing nothing |
| 32 | 21:12:48.172Z | 21:12:55.884Z | ok | read: `gh api repos/williacj/rigger/issues/1018/comments --jq '.[-1] \| .id, .created_at'`, which showed that #0026 had posted nothing. The same call then ran #0027 under the wrapper |
| 53 | 21:21:35.421Z | 21:21:39.449Z | ok | read: `gh api repos/williacj/rigger/rulesets/23968611 --jq '{name,target,enforcement,conditions,rules,bypass_actors}' > ruleset-main-copy.json`, the original copy-input read, chained with `&&` to #0779 and #0780 under the wrapper |
| 67 | 22:10:45.785Z | 22:10:48.259Z | ok | read: the M7-U7 ruling, 1009#6454836792; `git fetch -q origin` |
| 71, 72 | 22:11:09.676Z, 22:11:11.702Z | 22:11:13.245Z, 22:11:14.227Z | ok | read: the r1 and r2 reviews on #1009, to quote S9 and the r2 reversal |
| 97 | 22:21:28.753Z | 22:21:29.569Z (background start) | ok | none. `suite-slot.sh 1018-spike -- npm test`, the suite run that the PR body cites |
| 99 | 22:48:18.894Z | 22:48:24.895Z | ok | **write:** `git push -u origin rigger-1018`; **write:** `gh pr create -R williacj/rigger --base main --head rigger-1018 …`, which opened #1054 |
| 100 | 22:48:28.326Z | 22:48:30.135Z | ok | read: `pr-body-check.sh 1054 1018 spikes/suite-head.log` |

Before the wrapper existed, I also ran local reads that reached no network:

- `find` searches for events.jsonl;
- generator test runs, writing to the system temporary directory, whose files were removed and
  never sent anywhere;
- `npm ci`;
- the baseline `npm test`, which exited 0 with 3415 tests.

The session record holds these too.

## Every cell

One row per write the cells made, in the order they ran. Each row gives:

- **Cell:** the crossing, then namespace, mechanism and write. `W` is the write crossing, `S` the
  size crossing (`real` or `10m`, then the repetition), `F` the workflows crossing and `R` the
  rules crossing (`r0` none, `r1` the copied "Main", `r2` the refusing ruleset).
- **#:** the script's transcript entry.
- **Exit and wall time:** of the whole write, and of its ref-writing command alone.
- **Ref write command:** that command, exactly as run. `$PROBE_URL` is
  `https://github.com/williacj/rigger-spike-1018-probe.git`.
- **Read-back:** `git ls-remote` and `git ls-tree -r` of the ref's commit after the write, and the
  `cmp` of the stream read back.

On a refused write the read-back compares against the stream the ref held before, so "identical"
there shows that the ref did not move. The rows `W/heads/api/*` and `W/rigger/api/*` without `w2`
are the void first run (see "Unplanned writes"). On W/rigger/api/w2/update-unrelated-unforced,
"differ" shows that the unforced update was accepted. The blob read back there, `b826a001`, is the
blob that the forced cell after it read back identical to the stream written.

The `r2` pre-creates are setup writes, not cells, and were not read back one by one. #0940 and
#0944 show them at their commits.

| Cell | # | Exit | Wall s (whole write / ref write) | Ref write command | `git ls-remote` | `git ls-tree -r` | Bytes read back |
|---|---|---|---|---|---|---|---|
| seed | #0029 | 0 | 1.634 / 1.426 | `git push --porcelain $PROBE_URL 122d7130617b5d5557c8baee23d0dd6960362dd7:refs/heads/main` | `122d7130617b5d5557c8baee23d0dd6960362dd7 refs/heads/main` | `100644 blob a04de4c7189a1d4f14ab6008a04ad90cce03334f events.jsonl` | identical (`cmp` exit 0, #0049) |
| W/heads/push/first | #0051 | 0 | 1.960 / 1.766 | `git push --porcelain $PROBE_URL 0f202ae60765ceb0aaa697fa007fe84bd12a9871:refs/heads/w-push` | `0f202ae60765ceb0aaa697fa007fe84bd12a9871 refs/heads/w-push` | `100644 blob a8380daff25f74aeacf4dd82dc70078369587de7 events.jsonl` | identical (`cmp` exit 0, #0061) |
| W/heads/push/update-parent | #0063 | 0 | 1.548 / 1.430 | `git push --porcelain $PROBE_URL 118a9a0625be5b1859a43a7cca05f951dfe23391:refs/heads/w-push` | `118a9a0625be5b1859a43a7cca05f951dfe23391 refs/heads/w-push` | `100644 blob c5900eeed713ab5d2208600a2adce5bbb9cd9622 events.jsonl` | identical (`cmp` exit 0, #0073) |
| W/heads/push/update-unrelated-unforced | #0075 | 1 | 0.630 / 0.519 | `git push --porcelain $PROBE_URL cfb7b1df18faa7e871c18f27ad21ad45d25fa769:refs/heads/w-push` | `118a9a0625be5b1859a43a7cca05f951dfe23391 refs/heads/w-push` | `100644 blob c5900eeed713ab5d2208600a2adce5bbb9cd9622 events.jsonl` | identical (`cmp` exit 0, #0085) |
| W/heads/push/update-unrelated-forced | #0086 | 0 | 1.418 / 1.306 | `git push --porcelain $PROBE_URL +19cec275fe3ec505d0efcf13c888972a3d516b0b:refs/heads/w-push` | `19cec275fe3ec505d0efcf13c888972a3d516b0b refs/heads/w-push` | `100644 blob 44d6a22ea11cb7e904b0fe1954835d025e659dab events.jsonl` | identical (`cmp` exit 0, #0096) |
| W/heads/api/first | #0098 | 0 | 2.533 / 0.646 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/w-api -f sha=e5361ec5f00d80815efd2c4a4b78f15659de1f91` | `e5361ec5f00d80815efd2c4a4b78f15659de1f91 refs/heads/w-api` | `100644 blob e52002bbd69f8af047e94cd7e91704afde2db4cc events.jsonl` | identical (`cmp` exit 0, #0108) |
| W/heads/api/update-parent | #0110 | 1 | 1.629 /  | `(no ref write: an earlier step failed)` | `e5361ec5f00d80815efd2c4a4b78f15659de1f91 refs/heads/w-api` | `100644 blob e52002bbd69f8af047e94cd7e91704afde2db4cc events.jsonl` | differ (`cmp` exit 1, #0119) |
| W/heads/api/update-unrelated-unforced | #0121 | 1 | 2.253 / 0.440 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w-api -f sha=627b69fa45ba58226d0e5d39104eceaa7ed0f195 -F force=false` | `e5361ec5f00d80815efd2c4a4b78f15659de1f91 refs/heads/w-api` | `100644 blob e52002bbd69f8af047e94cd7e91704afde2db4cc events.jsonl` | differ (`cmp` exit 1, #0131) |
| W/heads/api/update-unrelated-forced | #0132 | 0 | 2.993 / 0.762 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w-api -f sha=229a1bdff5e9c13ec7c66cc8331bf6df7c758246 -F force=true` | `229a1bdff5e9c13ec7c66cc8331bf6df7c758246 refs/heads/w-api` | `100644 blob 360caa0cc2fe4c2d9ea2f6f57e547e45e471d930 events.jsonl` | identical (`cmp` exit 0, #0142) |
| W/rigger/push/first | #0144 | 0 | 1.661 / 1.469 | `git push --porcelain $PROBE_URL 48ea426d119f1e268591bb5e7bd76432bc233be2:refs/rigger/w-push` | `48ea426d119f1e268591bb5e7bd76432bc233be2 refs/rigger/w-push` | `100644 blob ab509217b1027a1dbfbb4cd83f6c0c760700473b events.jsonl` | identical (`cmp` exit 0, #0154) |
| W/rigger/push/update-parent | #0156 | 0 | 1.614 / 1.389 | `git push --porcelain $PROBE_URL 7002ddd003e998a59148b440d2d2d28eac4a24b8:refs/rigger/w-push` | `7002ddd003e998a59148b440d2d2d28eac4a24b8 refs/rigger/w-push` | `100644 blob 624e861ed07b76abb84326570276705a9c1549f7 events.jsonl` | identical (`cmp` exit 0, #0166) |
| W/rigger/push/update-unrelated-unforced | #0168 | 1 | 0.925 / 0.634 | `git push --porcelain $PROBE_URL c8520c726c7407ebb10f572351179785617b11cb:refs/rigger/w-push` | `7002ddd003e998a59148b440d2d2d28eac4a24b8 refs/rigger/w-push` | `100644 blob 624e861ed07b76abb84326570276705a9c1549f7 events.jsonl` | identical (`cmp` exit 0, #0178) |
| W/rigger/push/update-unrelated-forced | #0179 | 0 | 2.008 / 1.764 | `git push --porcelain $PROBE_URL +bfd3903d5f474464a0cbe93e8b7b0c9924ce9df3:refs/rigger/w-push` | `bfd3903d5f474464a0cbe93e8b7b0c9924ce9df3 refs/rigger/w-push` | `100644 blob c798fe98d5b827cbe7f586832e0f5af355dfe463 events.jsonl` | identical (`cmp` exit 0, #0189) |
| W/rigger/api/first | #0191 | 0 | 3.690 / 0.813 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/w-api -f sha=d049d441a22996039820e4f1239a139748b11b27` | `d049d441a22996039820e4f1239a139748b11b27 refs/rigger/w-api` | `100644 blob 3687d3c7437a40b6ede9739e5fee114c302eac3d events.jsonl` | identical (`cmp` exit 0, #0201) |
| W/rigger/api/update-parent | #0203 | 1 | 1.733 /  | `(no ref write: an earlier step failed)` | `d049d441a22996039820e4f1239a139748b11b27 refs/rigger/w-api` | `100644 blob 3687d3c7437a40b6ede9739e5fee114c302eac3d events.jsonl` | differ (`cmp` exit 1, #0212) |
| W/rigger/api/update-unrelated-unforced | #0214 | 0 | 3.101 / 0.904 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/w-api -f sha=84654d96b2e0dfbe3b9100edadd7237e0951db3a -F force=false` | `84654d96b2e0dfbe3b9100edadd7237e0951db3a refs/rigger/w-api` | `100644 blob 584057f9ad958b68000a54739419cc000d076020 events.jsonl` | differ (`cmp` exit 1, #0224) |
| W/rigger/api/update-unrelated-forced | #0225 | 0 | 2.883 / 0.864 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/w-api -f sha=ac08c3a49feb198fdce727702ece158c24dd410f -F force=true` | `ac08c3a49feb198fdce727702ece158c24dd410f refs/rigger/w-api` | `100644 blob 584057f9ad958b68000a54739419cc000d076020 events.jsonl` | identical (`cmp` exit 0, #0235) |
| W/heads/api/w2/first | #0237 | 0 | 4.166 / 0.790 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/w2-api -f sha=e02a6fd1777ab48220671f899e0719fb777fe3f1` | `e02a6fd1777ab48220671f899e0719fb777fe3f1 refs/heads/w2-api` | `100644 blob c283b0bc0679f9504ac7fea4d3b57cfdcf361e42 events.jsonl` | identical (`cmp` exit 0, #0247) |
| W/heads/api/w2/update-parent | #0249 | 0 | 2.564 / 0.703 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w2-api -f sha=99cefe306fdf286394804a544c8a01a72f0bf5de -F force=false` | `99cefe306fdf286394804a544c8a01a72f0bf5de refs/heads/w2-api` | `100644 blob 34ea34f850295ce1a9ded99443ba46099edab610 events.jsonl` | identical (`cmp` exit 0, #0259) |
| W/heads/api/w2/update-unrelated-unforced | #0261 | 1 | 2.921 / 0.579 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w2-api -f sha=3bb691bc00e21ffb942cbf8b72f743087de76bde -F force=false` | `99cefe306fdf286394804a544c8a01a72f0bf5de refs/heads/w2-api` | `100644 blob 34ea34f850295ce1a9ded99443ba46099edab610 events.jsonl` | identical (`cmp` exit 0, #0271) |
| W/heads/api/w2/update-unrelated-forced | #0272 | 0 | 3.125 / 0.872 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w2-api -f sha=2a7a24e5ea708701d1944e93cd2e756c08ce2067 -F force=true` | `2a7a24e5ea708701d1944e93cd2e756c08ce2067 refs/heads/w2-api` | `100644 blob 2fec13494dd16cc0f6cf6b85ef6fba14d6e0cbfc events.jsonl` | identical (`cmp` exit 0, #0282) |
| W/rigger/api/w2/first | #0284 | 0 | 3.287 / 1.067 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/w2-api -f sha=dada0022ef62b477badbe482385e8ff297eff657` | `dada0022ef62b477badbe482385e8ff297eff657 refs/rigger/w2-api` | `100644 blob e17c4ec3626d9093d91be9e53316d7fe6847377f events.jsonl` | identical (`cmp` exit 0, #0294) |
| W/rigger/api/w2/update-parent | #0296 | 0 | 3.342 / 1.228 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/w2-api -f sha=d37f54e0253396d82b67924a2b6604def835e4bc -F force=false` | `d37f54e0253396d82b67924a2b6604def835e4bc refs/rigger/w2-api` | `100644 blob 45364f0788efc981bb2300d26d6719bed6649baa events.jsonl` | identical (`cmp` exit 0, #0306) |
| W/rigger/api/w2/update-unrelated-unforced | #0308 | 0 | 2.927 / 0.813 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/w2-api -f sha=833d267cd5f5faef85cc068a1a55c911574c4b88 -F force=false` | `833d267cd5f5faef85cc068a1a55c911574c4b88 refs/rigger/w2-api` | `100644 blob b826a00167ec8ac3fc9713c2fe46cc35d2ed719a events.jsonl` | differ (`cmp` exit 1, #0318) |
| W/rigger/api/w2/update-unrelated-forced | #0319 | 0 | 2.367 / 0.681 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/w2-api -f sha=b816985d275878e8bf027a310871c6cc6dcd485e -F force=true` | `b816985d275878e8bf027a310871c6cc6dcd485e refs/rigger/w2-api` | `100644 blob b826a00167ec8ac3fc9713c2fe46cc35d2ed719a events.jsonl` | identical (`cmp` exit 0, #0329) |
| S/heads/push/real/1 | #0331 | 0 | 1.909 / 1.713 | `git push --porcelain $PROBE_URL 3c942348b2563b2e6f1ded482d15321bccaea07c:refs/heads/s-push-real-1` | `3c942348b2563b2e6f1ded482d15321bccaea07c refs/heads/s-push-real-1` | `100644 blob bc506cab13d4f6cf01cf38020cc32535117cbab2 events.jsonl` | identical (`cmp` exit 0, #0341) |
| S/heads/api/real/1 | #0343 | 0 | 2.624 / 0.746 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-real-1 -f sha=079772fea0b15768783dabe62919aeb37f80fe84` | `079772fea0b15768783dabe62919aeb37f80fe84 refs/heads/s-api-real-1` | `100644 blob 1baa0ead5dd881049482eedad651b2383ebed45c events.jsonl` | identical (`cmp` exit 0, #0353) |
| S/rigger/push/real/1 | #0355 | 0 | 1.694 / 1.537 | `git push --porcelain $PROBE_URL 05989e568bd82105c9ad634e98a38073d2783f9b:refs/rigger/s-push-real-1` | `05989e568bd82105c9ad634e98a38073d2783f9b refs/rigger/s-push-real-1` | `100644 blob 8895fca1395319e5b17d161e813e5bc1b898f1b8 events.jsonl` | identical (`cmp` exit 0, #0365) |
| S/rigger/api/real/1 | #0367 | 0 | 2.347 / 0.644 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-real-1 -f sha=b7c3e137322631ac0b140d5bf22c706cb0589b93` | `b7c3e137322631ac0b140d5bf22c706cb0589b93 refs/rigger/s-api-real-1` | `100644 blob 3633df66aedf963a893d7537ef3a57c4578dfc86 events.jsonl` | identical (`cmp` exit 0, #0377) |
| S/heads/push/10m/1 | #0379 | 0 | 2.181 / 2.008 | `git push --porcelain $PROBE_URL 96ea52ceab2aca0353b4b88fe397b959ef356319:refs/heads/s-push-10m-1` | `96ea52ceab2aca0353b4b88fe397b959ef356319 refs/heads/s-push-10m-1` | `100644 blob c41166e9c79af434331b196880d77da6716fac03 events.jsonl` | identical (`cmp` exit 0, #0389) |
| S/heads/api/10m/1 | #0391 | 0 | 5.563 / 0.620 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-10m-1 -f sha=e13862b4f3510e8163d08f592b60daf8809e44e6` | `e13862b4f3510e8163d08f592b60daf8809e44e6 refs/heads/s-api-10m-1` | `100644 blob 3ccc093d3a51d9b6caf8ce9ff377706080f36325 events.jsonl` | identical (`cmp` exit 0, #0401) |
| S/rigger/push/10m/1 | #0403 | 0 | 3.280 / 3.112 | `git push --porcelain $PROBE_URL 4695a6af7df0bc3cdfe67909c0c67a59608cbeac:refs/rigger/s-push-10m-1` | `4695a6af7df0bc3cdfe67909c0c67a59608cbeac refs/rigger/s-push-10m-1` | `100644 blob f7c3e2842457cf584182a8a6134e96d80a2d57f6 events.jsonl` | identical (`cmp` exit 0, #0413) |
| S/rigger/api/10m/1 | #0415 | 0 | 6.034 / 0.763 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-10m-1 -f sha=48499e6fb9ed797412ef0cf8b960fb4bdddf2104` | `48499e6fb9ed797412ef0cf8b960fb4bdddf2104 refs/rigger/s-api-10m-1` | `100644 blob 96d7a8286f4171f689003cd8d6ea9c891b20cfe4 events.jsonl` | identical (`cmp` exit 0, #0425) |
| S/heads/push/real/2 | #0427 | 0 | 1.510 / 1.394 | `git push --porcelain $PROBE_URL 34cb8e862da4bbf066174ce79e72bc1c4b091f47:refs/heads/s-push-real-2` | `34cb8e862da4bbf066174ce79e72bc1c4b091f47 refs/heads/s-push-real-2` | `100644 blob d825e15e5d65783cea56a54c91055e4c87abc84b events.jsonl` | identical (`cmp` exit 0, #0437) |
| S/heads/api/real/2 | #0439 | 0 | 2.299 / 0.647 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-real-2 -f sha=ff2f0c0d459f83288df05712e208238f7ff1907a` | `ff2f0c0d459f83288df05712e208238f7ff1907a refs/heads/s-api-real-2` | `100644 blob 99cfe68d6de73e448e4d891502a71b8574ab1b09 events.jsonl` | identical (`cmp` exit 0, #0449) |
| S/rigger/push/real/2 | #0451 | 0 | 1.620 / 1.503 | `git push --porcelain $PROBE_URL f6edb3d8fbcdb7a50358a0c755c7ccc33e5beb48:refs/rigger/s-push-real-2` | `f6edb3d8fbcdb7a50358a0c755c7ccc33e5beb48 refs/rigger/s-push-real-2` | `100644 blob 3172001786e6f80779ae492404bb1d62c8a82dca events.jsonl` | identical (`cmp` exit 0, #0461) |
| S/rigger/api/real/2 | #0463 | 0 | 2.379 / 0.698 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-real-2 -f sha=90711f915502854a98c3ea7326f921b729ca6b15` | `90711f915502854a98c3ea7326f921b729ca6b15 refs/rigger/s-api-real-2` | `100644 blob 2501722e8b3fcf1c9dbc0cdd97b46b43f7553e03 events.jsonl` | identical (`cmp` exit 0, #0473) |
| S/heads/push/10m/2 | #0475 | 0 | 3.335 / 3.176 | `git push --porcelain $PROBE_URL 793858b14158b9dbf1ea7f02aa7fcc888fd4f817:refs/heads/s-push-10m-2` | `793858b14158b9dbf1ea7f02aa7fcc888fd4f817 refs/heads/s-push-10m-2` | `100644 blob f02cdf35b28d57850e162ad9e4db54d4de22d61f events.jsonl` | identical (`cmp` exit 0, #0485) |
| S/heads/api/10m/2 | #0487 | 0 | 4.585 / 0.656 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-10m-2 -f sha=e016eb810b566a73a075562425d27fe49bf2adf2` | `e016eb810b566a73a075562425d27fe49bf2adf2 refs/heads/s-api-10m-2` | `100644 blob 18005f208bfb472d3532c0103c71506f4fd271ea events.jsonl` | identical (`cmp` exit 0, #0497) |
| S/rigger/push/10m/2 | #0499 | 0 | 3.420 / 3.036 | `git push --porcelain $PROBE_URL 22167b556813f6f768c6469a6f1e5a0a7f9c01fb:refs/rigger/s-push-10m-2` | `22167b556813f6f768c6469a6f1e5a0a7f9c01fb refs/rigger/s-push-10m-2` | `100644 blob 12f99d9a009e6b308c31d189832e60fdb85ed051 events.jsonl` | identical (`cmp` exit 0, #0509) |
| S/rigger/api/10m/2 | #0511 | 0 | 5.470 / 0.722 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-10m-2 -f sha=3e984de8de18375f15ded455dc4b29031798aa40` | `3e984de8de18375f15ded455dc4b29031798aa40 refs/rigger/s-api-10m-2` | `100644 blob 91aa59608a0cdf94d5f2525d3dc7a166769f138a events.jsonl` | identical (`cmp` exit 0, #0521) |
| S/heads/push/real/3 | #0523 | 0 | 1.643 / 1.386 | `git push --porcelain $PROBE_URL 1980867995c5cda08d3f541654e19e1420699945:refs/heads/s-push-real-3` | `1980867995c5cda08d3f541654e19e1420699945 refs/heads/s-push-real-3` | `100644 blob a752a3e08a15ef90505ca577b2d3e1d6702ec800 events.jsonl` | identical (`cmp` exit 0, #0533) |
| S/heads/api/real/3 | #0535 | 0 | 3.044 / 0.694 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-real-3 -f sha=3d0719a2c7d4552b1ccfe45784aba019b66bfcdd` | `3d0719a2c7d4552b1ccfe45784aba019b66bfcdd refs/heads/s-api-real-3` | `100644 blob 648116a77df35d90a2db494443e19eb163330a46 events.jsonl` | identical (`cmp` exit 0, #0545) |
| S/rigger/push/real/3 | #0547 | 0 | 1.779 / 1.562 | `git push --porcelain $PROBE_URL 8c1ed0a94f0cea224b4c3ba962de901d7abd5bc7:refs/rigger/s-push-real-3` | `8c1ed0a94f0cea224b4c3ba962de901d7abd5bc7 refs/rigger/s-push-real-3` | `100644 blob ebe4fed94806c79089d67343c004d1101c438c23 events.jsonl` | identical (`cmp` exit 0, #0557) |
| S/rigger/api/real/3 | #0559 | 0 | 2.621 / 0.700 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-real-3 -f sha=cb683107a2f20c6e5cff1595adfed1ba8fb73d02` | `cb683107a2f20c6e5cff1595adfed1ba8fb73d02 refs/rigger/s-api-real-3` | `100644 blob 35d1dc63a33a6ea053f5d63a8dd2b384754c7583 events.jsonl` | identical (`cmp` exit 0, #0569) |
| S/heads/push/10m/3 | #0571 | 0 | 2.447 / 2.173 | `git push --porcelain $PROBE_URL 2ccb0e8ecb003356076d47f671d03ce592f3fb78:refs/heads/s-push-10m-3` | `2ccb0e8ecb003356076d47f671d03ce592f3fb78 refs/heads/s-push-10m-3` | `100644 blob e31ed603783abb129821f2298fd313d86d78aa5f events.jsonl` | identical (`cmp` exit 0, #0581) |
| S/heads/api/10m/3 | #0583 | 0 | 6.162 / 0.714 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/s-api-10m-3 -f sha=2e86c294720a3d4d88b9bbc92e0d4fb47db039be` | `2e86c294720a3d4d88b9bbc92e0d4fb47db039be refs/heads/s-api-10m-3` | `100644 blob a8038a3b25b1a5bdcab7af8d3fbcd2ca6218360a events.jsonl` | identical (`cmp` exit 0, #0593) |
| S/rigger/push/10m/3 | #0595 | 0 | 3.286 / 2.975 | `git push --porcelain $PROBE_URL a5abec0c26c00b9076f5fe7fec9884872214a1ba:refs/rigger/s-push-10m-3` | `a5abec0c26c00b9076f5fe7fec9884872214a1ba refs/rigger/s-push-10m-3` | `100644 blob 0b7e1e3f280d5530f2ed4318ca2a5416e7685178 events.jsonl` | identical (`cmp` exit 0, #0605) |
| S/rigger/api/10m/3 | #0607 | 0 | 5.734 / 0.734 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/s-api-10m-3 -f sha=229d52866e16896be22f69fbb8048aac0c71a149` | `229d52866e16896be22f69fbb8048aac0c71a149 refs/rigger/s-api-10m-3` | `100644 blob 9609db6f6f5083fc3dabc4956b819a5d8ec2ce3a events.jsonl` | identical (`cmp` exit 0, #0617) |
| F/heads/push | #0634 | 0 | 1.526 / 1.410 | `git push --porcelain $PROBE_URL cb38f56146bde15d3e9fbf1ae87d2adbb6ecab8b:refs/heads/f-push` | `cb38f56146bde15d3e9fbf1ae87d2adbb6ecab8b refs/heads/f-push` | `100644 blob 488bbdc5822aa8fd7c21b1c3e70ae68844d30b3d events.jsonl` | identical (`cmp` exit 0, #0644) |
| F/heads/api | #0646 | 0 | 2.293 / 0.641 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/f-api -f sha=be79355c260f31a5c3ba9baaeaafafa7bea6bc87` | `be79355c260f31a5c3ba9baaeaafafa7bea6bc87 refs/heads/f-api` | `100644 blob 46d971651677b1993c10576918d12e5cfdefd965 events.jsonl` | identical (`cmp` exit 0, #0656) |
| F/rigger/push | #0658 | 0 | 1.512 / 1.395 | `git push --porcelain $PROBE_URL 3a558a3caa9c5e5749a2a315254e870f8aaf945e:refs/rigger/f-push` | `3a558a3caa9c5e5749a2a315254e870f8aaf945e refs/rigger/f-push` | `100644 blob 637b5e974ed4598a4d599d124e33809b363eecff events.jsonl` | identical (`cmp` exit 0, #0668) |
| F/rigger/api | #0670 | 0 | 2.265 / 0.696 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/f-api -f sha=0d8080c39e5ebb4b6c9214a09d94b4469be189a0` | `0d8080c39e5ebb4b6c9214a09d94b4469be189a0 refs/rigger/f-api` | `100644 blob a1d9b71f3bbff11ec94a423f7d8c733b041ced92 events.jsonl` | identical (`cmp` exit 0, #0680) |
| R/r0/heads/push/first | #0684 | 0 | 1.642 / 1.526 | `git push --porcelain $PROBE_URL c9632606f581db348768db7be027afffeba473da:refs/heads/r0-push` | `c9632606f581db348768db7be027afffeba473da refs/heads/r0-push` | `100644 blob d1ab868580f7ec926e8efb895d5f39dff6a53ed4 events.jsonl` | identical (`cmp` exit 0, #0694) |
| R/r0/heads/push/update-parent | #0696 | 0 | 1.640 / 1.531 | `git push --porcelain $PROBE_URL 2064456518240f4e39faf3ed42c07882d0800d52:refs/heads/r0-push` | `2064456518240f4e39faf3ed42c07882d0800d52 refs/heads/r0-push` | `100644 blob ded44ba4929e8a681f0da77754e3d2feb1667fe5 events.jsonl` | identical (`cmp` exit 0, #0706) |
| R/r0/heads/api/first | #0708 | 0 | 2.468 / 0.821 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/r0-api -f sha=c1b168dada3f03e106cd72a005ec8b0a2ce55943` | `c1b168dada3f03e106cd72a005ec8b0a2ce55943 refs/heads/r0-api` | `100644 blob d9ca42ccf2110fce1ce13037f141ae2e342ce34d events.jsonl` | identical (`cmp` exit 0, #0718) |
| R/r0/heads/api/update-parent | #0720 | 0 | 3.596 / 1.605 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/r0-api -f sha=be5639892b17fe2e84fa485dd6673ab66ed53cd5 -F force=false` | `be5639892b17fe2e84fa485dd6673ab66ed53cd5 refs/heads/r0-api` | `100644 blob b2e1bb8863cb02045cce529600bfe265733d0c6e events.jsonl` | identical (`cmp` exit 0, #0730) |
| R/r0/rigger/push/first | #0732 | 0 | 2.802 / 2.539 | `git push --porcelain $PROBE_URL e5395d7b31de4133048b15dffa26da4cd0b33b8a:refs/rigger/r0-push` | `e5395d7b31de4133048b15dffa26da4cd0b33b8a refs/rigger/r0-push` | `100644 blob 3ec5086675c56f3ae2b2ac32083c25d41f3bbdcf events.jsonl` | identical (`cmp` exit 0, #0742) |
| R/r0/rigger/push/update-parent | #0744 | 0 | 1.726 / 1.485 | `git push --porcelain $PROBE_URL 25b453ab1196c2b5423fc14ff8c5ddf863e165ad:refs/rigger/r0-push` | `25b453ab1196c2b5423fc14ff8c5ddf863e165ad refs/rigger/r0-push` | `100644 blob d8af16df76e9e8a099a96f909b7a2de8f71f8270 events.jsonl` | identical (`cmp` exit 0, #0754) |
| R/r0/rigger/api/first | #0756 | 0 | 2.741 / 0.761 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/r0-api -f sha=e4207dc8d8858db197484fdbca5dfc3a7c8e74aa` | `e4207dc8d8858db197484fdbca5dfc3a7c8e74aa refs/rigger/r0-api` | `100644 blob ae641a31713935ee4fa817cb892d63f27998ec26 events.jsonl` | identical (`cmp` exit 0, #0766) |
| R/r0/rigger/api/update-parent | #0768 | 0 | 3.112 / 1.280 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/r0-api -f sha=0c341f61456eba5d0c15213ad31ceb4d4d411a33 -F force=false` | `0c341f61456eba5d0c15213ad31ceb4d4d411a33 refs/rigger/r0-api` | `100644 blob dee6a2c6fb0b804a35fc7bae6040dfdf8a6edb05 events.jsonl` | identical (`cmp` exit 0, #0778) |
| R/r1/heads/push/first | #0789 | 0 | 1.906 / 1.682 | `git push --porcelain $PROBE_URL 00d3a786e72079fa894766bb21870fc1e3f344cf:refs/heads/r1-push` | `00d3a786e72079fa894766bb21870fc1e3f344cf refs/heads/r1-push` | `100644 blob ae13beab1a4ba658a2742b769417d8f62a1ffea5 events.jsonl` | identical (`cmp` exit 0, #0799) |
| R/r1/heads/push/update-parent | #0801 | 0 | 2.855 / 2.578 | `git push --porcelain $PROBE_URL d41a3c96929ada7bd0827194b4dd91babe79cd77:refs/heads/r1-push` | `d41a3c96929ada7bd0827194b4dd91babe79cd77 refs/heads/r1-push` | `100644 blob f6469e1901cd0513a9731e74f87fee072628a68b events.jsonl` | identical (`cmp` exit 0, #0811) |
| R/r1/heads/api/first | #0813 | 0 | 2.597 / 0.755 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/r1-api -f sha=853bba3b742aee3cd510fd9f9cad3a0972259033` | `853bba3b742aee3cd510fd9f9cad3a0972259033 refs/heads/r1-api` | `100644 blob 16653ad07cd9e28e389b5b1636160d502f84bbcf events.jsonl` | identical (`cmp` exit 0, #0823) |
| R/r1/heads/api/update-parent | #0825 | 0 | 2.577 / 0.738 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/r1-api -f sha=7eaa6fed73263271e231a1c436959cb5a398e03f -F force=false` | `7eaa6fed73263271e231a1c436959cb5a398e03f refs/heads/r1-api` | `100644 blob 2dfc8c618c8fffc40fba2402b1b2c3d3ed6ad43c events.jsonl` | identical (`cmp` exit 0, #0835) |
| R/r1/rigger/push/first | #0837 | 0 | 1.945 / 1.706 | `git push --porcelain $PROBE_URL 103fa76e0683e5dfb91d3c7395c499b13558dc16:refs/rigger/r1-push` | `103fa76e0683e5dfb91d3c7395c499b13558dc16 refs/rigger/r1-push` | `100644 blob 945a007e9a687c6ebcfa371b922122ab336ece8f events.jsonl` | identical (`cmp` exit 0, #0847) |
| R/r1/rigger/push/update-parent | #0849 | 0 | 1.686 / 1.447 | `git push --porcelain $PROBE_URL 7813cf0c01460b1c9ba2b121ab4db6ef7315669e:refs/rigger/r1-push` | `7813cf0c01460b1c9ba2b121ab4db6ef7315669e refs/rigger/r1-push` | `100644 blob c1dc0b0c0ed3da0306ac27d137adf12b17b32f35 events.jsonl` | identical (`cmp` exit 0, #0859) |
| R/r1/rigger/api/first | #0861 | 0 | 2.485 / 0.691 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/r1-api -f sha=9fa005023a86485682bfcbf5c551c9d1bb7cea3b` | `9fa005023a86485682bfcbf5c551c9d1bb7cea3b refs/rigger/r1-api` | `100644 blob 9cd869fc25870a1dc2dd765821339525e4ebf72a events.jsonl` | identical (`cmp` exit 0, #0871) |
| R/r1/rigger/api/update-parent | #0873 | 0 | 2.605 / 0.713 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/rigger/r1-api -f sha=023eb23e6273227b65710e3b0eb1e18fa94f6b13 -F force=false` | `023eb23e6273227b65710e3b0eb1e18fa94f6b13 refs/rigger/r1-api` | `100644 blob d532b1a4683c01e6fd15ca95d603eb025b2203ca events.jsonl` | identical (`cmp` exit 0, #0883) |
| R/r2/heads/push/precreate | #0885 | 0 | 2.942 / 2.626 | `git push --porcelain $PROBE_URL bf930ebfc4c2472bb2848e90ae1e245aacca27db:refs/heads/r2-u-push` | — | — | — |
| R/r2/heads/api/precreate | #0891 | 0 | 2.550 / 0.670 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/r2-u-api -f sha=18aec62da9f816535eea87b16b49a9ff8a1d7c41` | — | — | — |
| R/r2/rigger/push/precreate | #0897 | 0 | 3.263 / 3.051 | `git push --porcelain $PROBE_URL d1ebb991507fdff59ca86473c57b0ba7958a45e2:refs/rigger/r2-u-push` | — | — | — |
| R/r2/rigger/api/precreate | #0903 | 0 | 2.648 / 0.730 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/rigger/r2-u-api -f sha=55908fd8457742428c6d16536fc3128969302971` | — | — | — |
| R/r2/heads/push/first-refused | #0916 | 1 | 1.622 / 1.496 | `git push --porcelain $PROBE_URL a9299bd8e090160dd2b31a4d7fec0ed7569c5e8f:refs/heads/r2-c-push` | — | — | — |
| R/r2/heads/push/update-parent-refused | #0922 | 1 | 1.619 / 1.490 | `git push --porcelain $PROBE_URL 099eb68dd6bc47e2f2fafda61aff653ab86f088b:refs/heads/r2-u-push` | — | — | — |
| R/r2/heads/api/first-refused | #0929 | 1 | 2.154 / 0.520 | `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/r2-c-api -f sha=ccb59a64e11cfbb5611d422ccf4024d73c26b134` | — | — | — |
| R/r2/heads/api/update-parent-refused | #0935 | 1 | 2.248 / 0.556 | `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/r2-u-api -f sha=275dd8c307e248c01787212b5146b40a3715a26f -F force=false` | — | — | — |

### Error texts

The full stdout and stderr of every failed command a cell ran, as the transcript holds it.
The forge's trailing spaces on `remote:` lines are trimmed.

**W/heads/push/update-unrelated-unforced** (#0079): `git push --porcelain $PROBE_URL cfb7b1df18faa7e871c18f27ad21ad45d25fa769:refs/heads/w-push`

```
To $PROBE_URL
!	cfb7b1df18faa7e871c18f27ad21ad45d25fa769:refs/heads/w-push	[rejected] (non-fast-forward)
Done

error: failed to push some refs to '$PROBE_URL'
hint: Updates were rejected because a pushed branch tip is behind its remote
hint: counterpart. If you want to integrate the remote changes, use 'git pull'
hint: before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

**W/heads/api/update-parent** (#0113): `gh api repos/williacj/rigger-spike-1018-probe/git/commits -f message=synthetic stream refs/heads/w-api -f tree=83fb4618936d5a8c6cbfbef2120e7d0e13388e8d -f parents[]=update --jq .sha`

```
{"message":"Each SHA in the 'parents' parameter must be exactly 40 characters and contain only [0-9a-f].","documentation_url":"https://docs.github.com/rest/git/commits#create-a-commit","status":"422"}
gh: Each SHA in the 'parents' parameter must be exactly 40 characters and contain only [0-9a-f]. (HTTP 422)
```

**W/heads/api/update-unrelated-unforced** (#0125): `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w-api -f sha=627b69fa45ba58226d0e5d39104eceaa7ed0f195 -F force=false`

```
{"message":"Update is not a fast forward","documentation_url":"https://docs.github.com/rest/git/refs#update-a-reference","status":"422"}
gh: Update is not a fast forward (HTTP 422)
```

**W/rigger/push/update-unrelated-unforced** (#0172): `git push --porcelain $PROBE_URL c8520c726c7407ebb10f572351179785617b11cb:refs/rigger/w-push`

```
To $PROBE_URL
!	c8520c726c7407ebb10f572351179785617b11cb:refs/rigger/w-push	[rejected] (non-fast-forward)
Done

error: failed to push some refs to '$PROBE_URL'
hint: Updates were rejected because a pushed branch tip is behind its remote
hint: counterpart. If you want to integrate the remote changes, use 'git pull'
hint: before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

**W/rigger/api/update-parent** (#0206): `gh api repos/williacj/rigger-spike-1018-probe/git/commits -f message=synthetic stream refs/rigger/w-api -f tree=96a62ff4ac5da870acf27390f4f6618c97dca912 -f parents[]=update --jq .sha`

```
{"message":"Each SHA in the 'parents' parameter must be exactly 40 characters and contain only [0-9a-f].","documentation_url":"https://docs.github.com/rest/git/commits#create-a-commit","status":"422"}
gh: Each SHA in the 'parents' parameter must be exactly 40 characters and contain only [0-9a-f]. (HTTP 422)
```

**W/heads/api/w2/update-unrelated-unforced** (#0265): `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/w2-api -f sha=3bb691bc00e21ffb942cbf8b72f743087de76bde -F force=false`

```
{"message":"Update is not a fast forward","documentation_url":"https://docs.github.com/rest/git/refs#update-a-reference","status":"422"}
gh: Update is not a fast forward (HTTP 422)
```

**R/r2/heads/push/first-refused** (#0920): `git push --porcelain $PROBE_URL a9299bd8e090160dd2b31a4d7fec0ed7569c5e8f:refs/heads/r2-c-push`

```
To $PROBE_URL
!	a9299bd8e090160dd2b31a4d7fec0ed7569c5e8f:refs/heads/r2-c-push	[remote rejected] (push declined due to repository rule violations)
Done

remote: error: GH013: Repository rule violations found for refs/heads/r2-c-push.
remote: Review all repository rules at https://github.com/williacj/rigger-spike-1018-probe/rules?ref=refs%2Fheads%2Fr2-c-push
remote:
remote: - Cannot create ref due to creations being restricted.
remote:
error: failed to push some refs to '$PROBE_URL'
```

**R/r2/heads/push/update-parent-refused** (#0926): `git push --porcelain $PROBE_URL 099eb68dd6bc47e2f2fafda61aff653ab86f088b:refs/heads/r2-u-push`

```
To $PROBE_URL
!	099eb68dd6bc47e2f2fafda61aff653ab86f088b:refs/heads/r2-u-push	[remote rejected] (push declined due to repository rule violations)
Done

remote: error: GH013: Repository rule violations found for refs/heads/r2-u-push.
remote: Review all repository rules at https://github.com/williacj/rigger-spike-1018-probe/rules?ref=refs%2Fheads%2Fr2-u-push
remote:
remote: - Cannot update this protected ref.
remote:
error: failed to push some refs to '$PROBE_URL'
```

**R/r2/heads/api/first-refused** (#0933): `gh api repos/williacj/rigger-spike-1018-probe/git/refs -f ref=refs/heads/r2-c-api -f sha=ccb59a64e11cfbb5611d422ccf4024d73c26b134`

```
{"message":"Reference update failed","documentation_url":"https://docs.github.com/rest/git/refs#create-a-reference","status":"422"}
gh: Reference update failed (HTTP 422)
```

**R/r2/heads/api/update-parent-refused** (#0939): `gh api -X PATCH repos/williacj/rigger-spike-1018-probe/git/refs/heads/r2-u-api -f sha=275dd8c307e248c01787212b5146b40a3715a26f -F force=false`

```
{"message":"Repository rule violations found\n\nCannot update this protected ref.\n\n","documentation_url":"https://docs.github.com/rest/git/refs#update-a-reference","status":"422"}
gh: Repository rule violations found

Cannot update this protected ref.

 (HTTP 422)
```


## The reversals the architect named

The two reversals are these:

- S9 (1009#6433591635): "M7-03 measuring a whole-stream push too slow at the stream's present size.
  The push then becomes incremental."
- The r2 review (1009#6434658018): "M7-03 measuring a push too slow to run once per idle period."

What follows is my reasoning on the measured times. The ruling is M7-07's.

| Mechanism | Real size (1,243 B), median whole write | 10 MB, median whole write | S9's reversal | The r2 review's reversal |
|---|---|---|---|---|
| `push` | 1.64 s (refs/heads/), 1.69 s (refs/rigger/) | 2.45 s, 3.29 s | Not met, on my reasoning | Not met, unless an idle period can be shorter than a few seconds |
| `api` | 2.62 s, 2.38 s | 5.56 s, 5.73 s | Not met, on my reasoning | Not met, unless an idle period can be shorter than about six seconds |

My reasoning for S9. At the present size almost all of the time is fixed round trips:

- for `push`, the push command, which took 1.3 to 1.8 s while the local object commands took about
  0.01 s each;
- for `api`, four HTTP calls at about 0.4 to 0.9 s each.

Making the push incremental would shrink the bytes sent, not the round trips. So at this size an
incremental push would cost about the same, and the whole-stream push is not "too slow" in the
sense S9's remedy addresses. At 10 MB the whole stream adds about 1 to 1.6 s to `push` and about
3 s to `api` over the real-size medians. That is the size at which S9's remedy would start to buy
something.

My reasoning for the r2 review. The push runs once at each drain, which is the start of an idle
period, and never in exit cleanup (r2 review F1, S9). An idle period lasts at least the board
poll's interval, and `ARCHITECTURE.md` ("Clock triggers") leaves that interval to the consumer's
config. I did not measure an idle period, so the comparison rests on one premise: the poll
interval is set in tens of seconds or more. If it is, every measured time is a small fraction of
one period. If a consumer can set it to a few seconds, the 10 MB `api` push would take longer than
the period.

## Recommendation

**Push the stream with `git push` to a ref outside refs/heads/, such as `refs/rigger/<name>`.
Write each update as a commit whose parent is the previous stream commit, with a plain (unforced)
push.** On S9's table, that puts the L0 side in a new module in `src/substrate/`. The table is
S9's, and M7-07 rules on the placement.

What this rests on:

- **Time.** `push` was faster in every size cell. At real size the medians were 1.64 and 1.69 s
  against 2.62 and 2.38 s. At 10 MB they were 2.45 and 3.29 s against 5.56 and 5.73 s.
- **Refusals that name their rule.** A ruleset's refusal through `git push` names the rule for both
  a create and an update (GH013, "Cannot create ref due to creations being restricted.", "Cannot
  update this protected ref."). The API's refused create answered only "Reference update failed".
  `R-RECORD-15` asks Rigger to say so "naming the failure", and `push` gives it more to name.
- **No forced write needed.** An update with a parent needed no forced write through `push` on
  either namespace.
- **A guard against clobbering the copy.** `push` refused an unrelated update on refs/rigger/
  unless forced. The API accepted one there with `force=false`. git's check is on the client,
  against the remote tip it reads during the push. It still stops one writer from replacing a copy
  that another wrote.
- **No ruleset can name the ref.** The forge refused every ruleset naming `refs/rigger/*`, as a
  `branch` and as a `tag` target. So no rule a consumer writes for a named pattern can refuse the
  push. A branch, by contrast, was refused by a pattern ruleset on create and on update, for both
  mechanisms.
- **The two namespaces did not differ in workflows.** No run started from any stream-only write on
  either namespace, so on this measurement workflows do not favour either one.

What would reverse it:

- **The `~ALL` check.** Measuring that a `branch` ruleset over `~ALL`, or any ruleset a consumer
  can write, refuses a write to `refs/rigger/*` would undo the namespace half, because the
  namespace would then gain nothing over a branch. That was the blocked step, and it is not
  measured.
- **A required stream commit carrying `.github/`.** If M7-07 must have stream commits carry the
  consumer's `.github/` tree, the workflow result no longer holds and must be measured again.
- **The 10 MB gap closing.** If a `push` at 10 MB is measured at or above the API's time on the
  host Rigger runs on, the mechanism half falls back to the other grounds alone. Those are the
  named refusal and the fast-forward guard.
- **The forge's handling of refs/rigger/ changing.** If the forge starts refusing pushes to refs
  outside refs/heads/ and refs/tags/, or hiding them from `git fetch`, the namespace half is
  undone. The cells show it accepts both today.

## What M7-07 must not assume

- **That 1,243 bytes is the stream's working size.** It is a test fixture's size. No Rigger
  stream on this host comes from a working engine, because nothing emits yet.
- **That the forge enforces fast-forward on refs/rigger/.** Through the API it does not (#0312).
  Through `push`, the refusal comes from git's client, against the remote tip read at push time.
- **That the previous stream commit is in the local object store.** My push-mechanism scratch
  repository made every commit it pushed, so each parent was local. A real push must build the
  update on the remote's current tip, and nothing measured here says where that tip comes from.
- **That a refused API create names its rule.** It answered only "Reference update failed".
- **That a stream commit whose tree carries `.github/workflows/` starts no run.** Only stream-only
  trees were measured.
- **Anything about a push that times out.** It was not measured; M7-31's fake carries it.

## What I could not measure

- **Whether a ruleset that names no ref reaches `refs/rigger/*`**, for example a `branch` ruleset
  over `~ALL`. The host's permission classifier blocked the step (1018#6453927183), and the owner
  ruled that the report go ahead without it (M7-U7 Q32 (a), 1009#6454836792). To settle it, create
  on a probe a `branch` ruleset with `include: ["~ALL"]` and a `creation` rule. Then try a first
  write to `refs/rigger/<fresh>` and to `refs/heads/<fresh>` with each mechanism, and read the
  rulesets back.
- **The length of an idle period** on a working engine. The r2 reversal's comparison rests on it.
- **A push that times out.** Out of scope by the card.
- **A stream commit that carries the consumer's tree.** Out of scope by the card's fixed tree.

## Incidental findings

None to file. Two defects showed up on the way, and both were in my throwaway harness, which does
not merge:

- the lost API commit sha, which voided the first `w-api` update cells;
- `zsh` reading `$ref:r…` and `$c:e…` as history modifiers in the first read-backs, #0036 and
  #0043. Each read-back was rerun, and the cells cite the reruns.

Nothing in Rigger's own code was exercised.

## The probe, left for the owner

The probe williacj/rigger-spike-1018-probe is left for the owner, who deletes it. The transcript
holds no deletion of it, and the host token has no `delete_repo` scope (#0006).

At the end it holds:

- refs/heads/main at `a1953889`, the seed plus the workflow file;
- every stream ref listed by `git ls-remote $PROBE_URL` (#0944);
- rulesets 25993857 ("Main", copied) and 25993929 (`deny-heads-r2`);
- one workflow run, 40585753864.
