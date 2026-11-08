<!-- ABOUTME: Bounded operational findings on two unavailable manual-review sources, with retained-evidence and causal limits. -->
# Manual review-source custody

The historical cause is **inconclusive**. SC1 and SC2 establish different observations of unavailable review sources; no approved original identifies a remover, a matching cleanup action or an incident-spanning restart. Current temporary storage was measured as tmpfs, which makes a storage-lifetime explanation plausible. It does not prove that explanation for either incident.

This report answers [issue #1220](https://github.com/williacj/rigger/issues/1220), under its [adopted registration correction](https://github.com/williacj/rigger/issues/1220#issuecomment-6667277782). The [machine-readable record](review-workspace-custody.json) separates measurements, source-derived reachability, documented contracts, hypotheses and unavailable evidence.

## What was inspected

The investigation used public commit **24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9**, tree **35aa3d4130256093da7256f6439c2956c383e591**, in a coordinator-created persistent home clone. This is a deliberately fixed snapshot, not an assertion about a later moving main branch. The maker did not create that clone and has no creator-cleanup authority over it.

On 2026-11-05, retained acquisition guards and a maker SHA-256 recheck identified the eight allowed cleanup/ownership files at that source. Their hashes matched the earlier f6 snapshot; their applicable definitions were reopened at the actual investigation commit. The cleanup inspection stopped at those eight surfaces. Imported definitions outside that set were not traced. Neither cleanup tools nor their list modes were run.

The current measurements used installed Node **26.12.0**, npm **12.2.2**, Python **3.14.4** and Git **2.53.0**. The locked install and dependency listing exited zero with **acorn 8.18.0**. Selected executable/manifest hashes and actual version outputs identify an **installed trusted-tool boundary**. They do not establish complete transitive executable, shared-library, npm-module or OS-utility closure integrity. The same narrower boundary applies to the recorded findmnt and systemctl executables. Exact private paths, commands and identities remain in custody index C1220.

## The two historical observations

Both reviews concerned PR #1208 at **465bd0a112b641ce3548305645ccd1ce42d4e1ae**. The approved originals were retained outside their disposable source roots. They were reopened and rehashed for this report; their selected fingerprints match the previously recorded custody fingerprints.

| Record | Retained observation | Supported timing and limit |
|---|---|---|
| SC1 | Its custody note reports the original source unavailable after verification/preflight completed. The original preflight stream identifies the reviewed head and reports a clean source. | Original preflight metadata records 2026-11-05 **14:23:27.744882?14:23:28.466229 UTC**, exit **0**. Detection is reported after completion; no independently retained last filesystem-presence observation, first missing UTC or actual deletion interval is available. Detection stage does not prove deletion happened after command completion. |
| SC2 | The primary record reports the original source absent, direct Git exit **128**, and **0** Node commands before its admission guard. | The retained absence observation is **2026-11-05 14:28:17.755709 UTC**. The last original-source presence and disappearance interval are unavailable from the approved originals. |

The SC1 preflight output includes these exact nonprivate lines:

```text
preflight head 465bd0a112b641ce3548305645ccd1ce42d4e1ae merge-base 233bb948bd16597e12f002e836dc0c3277367b74
clean: passed
```

SC1 separately records a later static clone at the same reviewed head, tree **45b279eefdc1f8215a55bbbaae800081f289dd41**, and says no tests ran in that later clone. Its current filesystem availability was not probed. SC2's four additionally approved raw clone/Git streams concern a separate durable source destination and matching merge-tree outputs. Those streams supply no missing original temporary-source command exit, PID or existence interval.

The later copies do not repair custody of the earlier directories or change the source that supplied an earlier command result. Neither historical primary records a boot identity. No common disappearance time, shared boot generation or responsible actor can be inferred from these records.

## Repository cleanup and ownership map

Every row below is **source-derived reachability at the fixed investigation commit**, not evidence that the route ran against SC1 or SC2. The root names are source variables or generic roles; they disclose no private source location.

| Surface | Input root and selection/ownership checks | Trigger and exact target relationship | Exclusions and evidence limits |
|---|---|---|---|
| [test/suite.sh](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/test/suite.sh) | Canonical caller temporary root; newly created suite run directory. Exact mktemp run result, canonicalized before being exported as the suite temporary root. | Early EXIT trap, or normal finish closes the completion FIFO and waits for the reaper. The exact suite run tree; separately, rmdir of its own automatically created evidence directory. | No arbitrary review-source scan. Nonempty auto evidence is not removed by rmdir. The current script is source evidence, not proof of historical execution. |
| [test/suite-reaper](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/test/suite-reaper) | Explicit run-directory and completion-FIFO arguments; run realpath. Own-user process rows matching run text, runner descendants or cwd containment; remembered targets must be confirmed ended. | Completion FIFO reaches EOF; cleanup reaches no selected or remembered targets. removeTemporaryDirectory of that exact run root. | Failure to confirm ending keeps the run. Imported process helper definitions outside the eight-file scope were not traced. No cleanup tool or process census was executed by this investigation. |
| [test/temporary-directory.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/test/temporary-directory.mjs) | mkdtemp result under tmpdir with caller prefix. Exact fixture path captured by temporaryDirectory; exported remover takes an explicit caller path. | Registered test/file teardown or abort fallback, after beforeRemoval. Owner-writable directories followed by recursive removal of that exact fixture. | Links are not followed. beforeRemoval failure retains the fixture. The exported remover has no independent creator registry; no historical call or argument was recovered. |
| [src/execution/workspace.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/src/execution/workspace.mjs) ? card workspace | Worktree root plus card-derived topic. Absolute root, accepted branch, linked worktree of the served repository, exact card branch; exclude handed/main worktree and nested registered worktrees; realpath comparisons. | Workspace replacement, or card-directory removal selected by workflow. Validated real workspace through adapter.remove; remove remaining path link after worktree removal. | A standalone manual clone does not satisfy linked-worktree membership. Unanswered checks fail. Person locks are retained by card-directory removal. No historical engine registration or action was recovered. |
| [src/execution/workspace.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/src/execution/workspace.mjs) ? judge/escalation and scratch | Judges/escalations/scratch family, card topic, then role. Detached role directory: nonlink directory with only registered detached linked children, not handed/nested foreign paths, acceptable locks. Scratch: nonlink ancestors, no checkout above/within and no served-repository worktree overlap. | Role-directory replacement or card-directory removal. Validated detached children then role rmdir; exact validated scratch role tree; empty family topic directories. | Only initialization locks are unlocked. Scratch source documents a detection limit for another repository's worktree whose .git entry was moved aside. No such historical premise was established. |
| [src/execution/workspace.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/src/execution/workspace.mjs) ? CLI folder | Absolute configuration home, projects, one named folder segment. Pre-command listing plus unchanged realpath/device/inode of existing folder or initially absent folder's parent. | Caller invokes sweepCliFolder after command. Only newly added entries, children first; folder root only when initially absent. | Unreadable or replaced anchors refuse cleanup; links are not followed. No historical listing or invocation against either review source was recovered. |
| [src/substrate/worktrees.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/src/substrate/worktrees.mjs) | Exact path supplied by L1. remove delegates to Git; membership helper distinguishes linked worktree from main clone by top/common/admin directories. | Adapter remove call after caller checks. git worktree remove --force of the explicit path; prune/unlock affect registrations. | Removal method does not independently implement card ownership. Git refuses the main working tree. No historical removal command was recovered. |
| [tools/coordinator/sweep.mjs](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/tools/coordinator/sweep.mjs) | Canonical configured worktree root's immediate entries. Whole-name patterns judge-PR-codex-rROUND, judge-PR-codex-ROLE-rROUND, judge-PR-claude-ROLE-rROUND, codex-CARD or codex-CARD-tmp. ROLE is architect/engineer/pm/reviewer/spike-engineer. Nonlink directory; serving PRs ended; no process use or foreign worktree; maker also no uncommitted/stashed/flag-hidden/local-only work. | Manual non-list invocation after every applicable check. rm -rf -- of that exact matching entry. Forge-reachability helper also removes only its own newly made scratch in finally. | Open, no-serving-PR, unreadable, unsafe or in-use entries are kept. TMP entry is retained when its maker clone was kept. Incident clone basenames do not match these entry patterns; historical root configuration/realpath relationships were not recovered. Not executed, even in list mode. |
| [tools/coordinator/codex-judge.sh](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/tools/coordinator/codex-judge.sh) | Derived judge round directory, with clone in its repo child. Exact work variable; clone attempted only when it does not exist. | A failed clone followed by an allowed retry. rm -rf of that exact work path before retry. | No normal-success final clone-removal route in this file. Incident temporary clone names differ from this naming scheme, without proving any external remover absent. |
| [AGENTS.md](https://github.com/williacj/rigger/blob/24f5bccb861edde9e0d10e9ef7e7ae5da6ebedb9/AGENTS.md) | Worktrees and scratch clones created by the session. Creator ownership, process-use restriction and forge custody; owner permission for uncommitted/unpublished work. | After merge/closure, or when finishing a handoff under the stated retention rule. Only permitted creator-owned worktrees/clones. | An instruction is not execution evidence. This maker did not create the investigation clone and has no creator-cleanup authority over it. |

This distinguishes a manual standalone clone, an engine-linked card workspace, a suite-owned run directory and a per-test fixture. The incident clone names do not match the coordinator sweep's direct-entry patterns. Historical root settings, realpath relationships and actual execution were not recovered, so that mismatch excludes only the direct named-entry match. It does not prove that no external remover exists.

## Current OS observation O1

The independently admitted finite observation ran on **2026-11-05, 21:07:36.408554?21:07:36.828193 UTC**, with the same fixed source guards. The report reads its retained originals; it performs no replacement OS query.

The reader attempted exactly seven declared files: kernel type/release, distribution release, current boot identity, uptime, vendor temporary policy and system temporary-policy override. It also made exactly four declared queries: selected findmnt fields for the temporary and home locations, and selected public status fields for the temporary-cleanup timer and service. Full private originals retain exact argv, reader/child identity, timing, outcomes, bytes and digests.

| Measurement | Actual retained outcome | What it establishes |
|---|---|---|
| Kernel type/release | Linux; **6.18.54.1-microsoft-standard-WSL2** | Current kernel identity at O1. |
| Distribution release | ID **ubuntu**, VERSION_ID **26.04**, PRETTY_NAME **Ubuntu 26.04.1 LTS** | Only these allowed distribution fields are published. |
| Current boot identity | Read successfully; public opaque label **O1-generation** | Raw identity stays private. No historical identity exists for comparison. |
| Uptime | **687.47 seconds**; aggregate idle counter **19561.97 seconds** | Counters from the retained uptime read; they identify no incident-spanning restart. |
| Temporary filesystem | findmnt exit **0**, filesystem **tmpfs** | Current storage class. Private mount/device/source identifiers are withheld. |
| Home filesystem | findmnt exit **0**, filesystem **ext4** | Current storage class at the selected home location. |
| Vendor temporary policy | Read successfully; selected lines reproduced below | Text of one selected file, not a full effective-policy enumeration. |
| System temporary-policy override | **FileNotFoundError, errno 2** | This exact file was unavailable. No broader configuration absence is inferred. |
| Temporary-cleanup timer | systemctl exit **0**; loaded / active / waiting; next-elapse and last-trigger fields empty | Selected current state only; empty fields give no historical execution time. |
| Temporary-cleanup service | systemctl exit **0**; loaded / inactive / dead; Result=success, ExecMainCode=0, ExecMainStatus=0 | Selected current state only; these values do not identify an earlier cleanup target or run. |

The vendor policy file's selected lines were:

```text
q /tmp 1777 root root 10d
q /var/tmp 1777 root root 30d
```

The [Linux kernel tmpfs documentation](https://docs.kernel.org/filesystems/tmpfs.html) states that unmounting a tmpfs instance loses its contents. [Microsoft's WSL configuration reference](https://learn.microsoft.com/en-us/windows/wsl/wsl-config) documents VM and distribution idle-shutdown settings. Together with the O1 storage measurement, these support a **plausible lifetime mechanism**, not a demonstrated historical deletion. Actual host idle settings were not read. Neither incident-time mount state nor an incident-spanning boot transition was retained.

Current policy text, service status, short uptime and low process IDs cannot identify a historical remover or establish when either incident crossed a restart. No private WSL settings, journals, history, process command-line census, other-user files or unapproved logs were read.

## Verification and optional observation

The coordinator's sole admitted pre-work deterministic baseline ran at the fixed investigation source, with unchanged before/after source guards. Its recorded command was the fixed installed Node and npm CLI running npm test. Metadata records **2026-11-05 21:06:49.421485?21:08:48.226546 UTC**, exit **0**. Its retained summary was:

```text
tests 4847
pass 4838
fail 0
cancelled 0
skipped 9
todo 0
```

These are measurements from that command's own stdout and metadata. They establish the pre-work deterministic baseline at G, not historical cause or final report-head verification. No host-suite success is claimed: the report changes no external product boundary, and supported-host checks unavailable locally remain unproved. Final-head checks and independent review remain delivery requirements.

The optional sentinel/control observation is **UNEXECUTED**. No sentinel or control was created; no observation outcome is claimed. No extra verification run, idle interval, sleep, monitoring, keepalive, forced shutdown, unmount, service change or cleanup was performed to manufacture evidence. A natural idle transition is unproved. Plain-sentinel survival would in any event establish only survival of those exact sentinels in their observed interval, not an old Git clone's lifecycle or a historical actor.

## Explanation and next proposal

| Explanation | Classification | Evidence needed to resolve the limit |
|---|---|---|
| The two original sources were unavailable at their separately recorded stages. | **Supported** by SC1/SC2 originals. | No common deletion time follows. |
| Temporary tmpfs unmount/restart caused either historical loss. | **Unresolved**; current storage and documented lifetime make it plausible. | Incident-time mount/boot identities and a matching transition interval. |
| Temporary-policy cleanup removed either source. | **Unresolved**. | Historical execution, age/eligibility and the actual matching target/interval. |
| An inspected repository route removed either source. | **Unresolved**. | Matching historical root/registration/argument and actual execution. |
| Another tool or actor removed either source. | **Unresolved**. | Primary action/target/interval evidence; the inspected map cannot exclude external removers. |

The smallest next proposal is to qualify creator-owned durable-home source custody for the **next already-required manual review**, retaining source identity and boot/mount generation at its existing readiness/end observations, with command originals outside the source. If loss recurs, compare that finite interval before proposing wider inspection. This is a proposal, not a permanent policy, product repair, new test campaign or implemented prevention.

A primary matching historical action/target/interval, or a separately admitted reproducible interval with identity continuity, would reopen the causal conclusion. A fresh passing suite alone would not. No product defect, historical actor or repair is established by this report.

## Evidence custody and delivery scope

C1220 is the finite private custody index available from the coordinator to the independent reviewer through final ruling. It preserves the approved SC1/SC2 original retention locations, selected original fingerprints and the new acquisition/inventory/install/baseline/OS records: actual source, argv, tool identities, PID at start, start/end, status, separate raw streams, byte lengths and digests. It includes no judge findings or sessions. Unavailable originals earn no credit; no original is moved or removed to complete this report.

Public content uses SC1, SC2 and O1 labels. Exact private source/evidence paths, raw boot and mount identifiers, identifying process data, raw private logs and credentials remain private. Public command placeholders are deliberate; exact commands remain reopenable in C1220.

The only existing registry change is adding this report Markdown as a strict checked document, applying existing policy. All prior values and exemptions, including the immutable historical-audit qualifier, are preserved. Consumer/runtime configuration, test assertions and cleanup behavior are unchanged.
