ABOUTME: Requirements Rigger no longer holds, kept so a citation to a withdrawn id still resolves and so its id is never allocated again.

# Retired requirements

**Nothing here binds.** A row reaches this file when what it required stopped being true of
Rigger. It is kept for two reasons only:

1. A document still citing its id resolves to an explanation rather than to nothing.
2. The id is never allocated again.

`docs/spec/requirements.md` states when a requirement arrives here, and holds every requirement
that binds. A reader looking for what must be true reads that file and not this one. Only the
owner withdraws a requirement.

**The `requirement` column holds the row's exact text, unchanged.** A citation has to resolve to
what the row said, not to a later summary of it, so this file never paraphrases. `from` comes
across with it, because a withdrawn requirement's decision is the thread back to
`docs/spec/decisions.md`, and that decision may itself have been superseded. `made true by` and
`checked by` are dropped deliberately: a row that binds nobody is made true by nobody and is
checked by nothing.

`replaced by` names the requirement that took over, and is empty when a requirement was withdrawn
outright rather than superseded.

Ids allocated here still count as allocated. The duplicate-id check reads both files.

| id | requirement | from | withdrawn | replaced by |
|---|---|---|---|---|
| R-CARD-15 | — a fenced code block opens at a line indented at most three spaces that opens with three or more backticks or three or more tildes; | D2 | 2026-09-25 | R-CARD-35 |
| R-CARD-16 | — a fenced code block closes at the next line indented at most three spaces that holds only a run of at least as many of the same character; | D2 | 2026-09-25 | R-CARD-26 |
| R-CARD-25 | — a task-list item, whose text opens with `[ ]`, `[x]` or `[X]`, and a bullet whose text is empty or only whitespace, are never items. | D2 | 2026-09-25 | R-CARD-37, R-CARD-38 |
| R-SCHED-9 | Two cards never merge at the same moment. | | 2026-10-11 | R-SCHED-15 |
| R-SCHED-21 | Rigger never works an item carrying the status label as a card: it never claims it, dispatches nothing for it, and never reports it as refused. An issue a person removes the label from is no longer the status issue. | | 2026-10-21 | R-SCHED-27 |
| R-WORK-1 | A card's work happens in a workspace nothing else is using. No two dispatches share one, whether they are working one card or two. | | 2026-09-29 | R-WORK-12 |
| R-WORK-11 | Rigger never removes or changes a directory at a card's workspace path unless that directory is a workspace of the repository Rigger works. Finding one that is not, it fails the attempt and names the path. | | 2026-09-30 | R-WORK-13, R-WORK-14, R-WORK-15, R-WORK-16 |
| R-WORK-30 | Before Rigger moves a card to Done for its merged pull request, whoever merged it, Rigger removes the card's directories. They are its workspace and each directory under `judges/<topic>` and `scratch/<topic>` for the card's topic, whichever role it is named for. Rigger removes each only where `R-WORK-13`, `R-WORK-20` or `R-WORK-26` lets Rigger replace it, and otherwise names the path and leaves it. Rigger moves the card to Done only once no removal failed, and a path left under those rows is no failure. Where a removal failed, the card stays where it is, and Rigger names each path that remains. The states it covers are in `### R-WORK-30 — When a merged card's directories are removed`. | | 2026-10-17 | R-WORK-33 |
| R-ESCALATE-1 | Every escalation to the owner is one of the configured categories. A card escalated to the owner proceeds no further until the owner answers it. | D3 | 2026-10-17 | R-ESCALATE-20 |
| R-ESCALATE-2 | The set of categories is Rigger's. A consumer chooses which of them are the owner's to decide, and adds none. All are the owner's unless the consumer says otherwise. | D3 | 2026-10-17 | R-ESCALATE-13 |
| R-ESCALATE-3 | The set holds exactly three: a change to a recorded decision, a fault that must not merge — the same fault a verdict names — and an ambiguity no role could resolve. | D3 | 2026-10-17 | R-ESCALATE-19 |
| R-STATE-5 | Rigger ends every process it started, and records any it had to end by force. A process that outlives its dispatch never changes a result. | | 2026-09-27 | R-STATE-6, R-STATE-7, R-STATE-8, R-STATE-9, R-STATE-10, R-STATE-11, R-STATE-12, R-STATE-13, R-STATE-14, R-STATE-15, R-STATE-16 |
| R-STATE-6 | A process that has left its process group is outside this rule. Rigger ends every process still in a process group it created, whenever any of these holds: | | 2026-10-01 | R-STATE-17 |
| R-STATE-20 | A process can join a process group Rigger created after Rigger's last read of that group before a kill, be ended by that kill, and be reaped before Rigger reads the group again. No read can show such a process, so Rigger records nothing for it, and `R-STATE-12`, `R-STATE-13` and `R-STATE-19` do not reach it. |  | 2026-10-04 | R-STATE-26 |
| R-FAIL-3 | A second failure of the same kind, without a success between them, closes admission and records why. | D12 | 2026-10-17 | R-FAIL-5 |
| R-FAIL-5 | Rigger closes admission, and records why, when a card's second attempt fails in its environment the same way its first did. The ways are in `### R-FAIL-5 — Environment failures and the hold`. | D12 | 2026-10-22 | R-FAIL-6 |

### R-WORK-30 — When a merged card's directories are removed

| Situation | Scope |
|---|---|
| a merge the engine's lane makes, answered merged or already merged | in: removed before the Done move |
| a merge the engine's lane makes, answered refused or not merged | in: nothing removed; removed once a later pull reads the pull request as merged |
| a merge the engine's lane makes that fails | in: nothing removed; removed once a later pull reads the pull request as merged |
| Rigger cannot record the end of a merge the engine's lane makes | in: nothing removed; removed once a later pull reads the merge |
| merged by a person while the engine runs, or while it is stopped | in: removed at the next pull that reads the merge |
| the engine killed between the merge and the removal | in: the card stays where it is; removed at a later pull that reads the merge |
| a removal failing after another of the card's directories was removed | in: the card stays where it is; each remaining path named; a later pull removes them |
| a removal failing partway through one directory | in: the card stays where it is; the path named; a later pull removes it where its row still lets Rigger replace it, and otherwise leaves and names it |
| a check `R-WORK-13`, `R-WORK-20` or `R-WORK-26` asks for that Rigger cannot make, because git or the file system gives no answer to it, or does not answer in time | in: a failed removal, not a refusal: the path left and named; the card stays where it is; a later pull removes again |
| a check `R-WORK-13`, `R-WORK-20` or `R-WORK-26` asks for that git or the file system answers, finding that the condition does not hold | in: a refusal: the path left and named; it does not hold back the Done move |
| a workspace directory whose `.git` entry is still there after git dropped its registration, as a removal failing partway leaves it | in: a refusal under `R-WORK-13`: the path left and named; it does not hold back the Done move |
| Rigger cannot record an event of the removal | in: the card stays where it is; Rigger says what went unrecorded; a later pull removes again |
| a second removal pass over a card already removed | in: nothing changes, and nothing fails |
| none of the card's directories exists | in: nothing changes, and nothing fails |
| a directory of the card already gone, with or without its registration | in: nothing fails; git then lists no registration of the card's whose directory is gone, unless a person locked it |
| a worktree of the card's that a person locked | in: left as it is, its lock kept, and named; the card stays where it is until the lock is lifted |
| a person moved the card to Done before Rigger read the merge | out: Rigger reads no Done card, and its directories stay |
| a Ready or Coding card whose pull request is merged | out: Rigger refuses it under `R-WORK-19`, and its directories stay |
| a pull request closed without merging | in: nothing removed |
| a judge's dispatch of the card still running when its pull request merges | in: removed at the first pull that reads the merge once no dispatch of the card runs |
| a process Rigger did not start working in a directory | out: removal proceeds, as it does when Rigger replaces the directory |
| a process Rigger started and could not end, working in a directory | out: removal proceeds, as for a process Rigger did not start |
| a workspace with uncommitted changes or commits not on the forge | in: removed, as `R-WORK-13` replaces it |
| a workspace path named through a symbolic link to the card's worktree, or anything else `R-WORK-13` refuses | in: as `R-WORK-13` answers it: the worktree and the link removed, or the path left and named |
| a symbolic link at a judge's or a scratch directory's path, or anything else `R-WORK-20` or `R-WORK-26` refuses | in: left and named |
| `judges/<topic>` and `scratch/<topic>`, once empty | in: removed where each is a directory and not a symbolic link, and so is `judges` or `scratch` above it; otherwise left and named |
| the card's local branch | out: kept |
| output an agent CLI other than Claude Code writes outside the scratch base | out: until that adapter's spike measures it. Claude Code's lies under the dispatch's directory |

### R-FAIL-5 — Environment failures and the hold

Each failure is one of three classes:

- **a host failure:** a second attempt that fails the same way closes admission;
- **card-local:** it escalates under `R-ESCALATE-12` at once, and an attempt pair that includes one escalates rather than stops;
- **out:** neither.

| Failure | Class | The same way when | Scope |
|---|---|---|---|
| the workspace not made, because git or the file system gave no answer, or none in time | host | always | in |
| a continuing workspace's fetch failing or timing out (`R-WORK-25`) | host | always | in |
| a required provisioning step that never started | host | it is the same step | in |
| a required step that exited non-zero or ran past its time | host | it is the same step | in |
| the maker's dispatch never started, its scratch directory made | host | always | in |
| the directory at the card's workspace path, refused under `R-WORK-13` | card-local | — | in: `R-ESCALATE-12` |
| a role's scratch directory refused under `R-WORK-26`, the maker's or a judge's | card-local | — | in: `R-ESCALATE-12` |
| a judge's directory refused under `R-WORK-20` | card-local | — | in: `R-ESCALATE-12` |
| the card's branch checked out in a worktree elsewhere (`R-WORK-25`) | card-local | — | in: `R-ESCALATE-12` |
| the forge holding the card's line of work, or a merged pull request from it, under `R-WORK-19` | card-local | — | in: `R-ESCALATE-12` |
| more than one open pull request from the card's line of work | card-local | — | in: `R-ESCALATE-12` |
| a card in the owner's column with no pull request from its line of work | card-local | — | in: `R-ESCALATE-12` |
| a host failure on one attempt and a card-local refusal on the other | card-local | — | in: `R-ESCALATE-12`, never a hold |
| the line of work moved, or deleted, since L2 read it (`R-WORK-25`) | out | — | out: the next pull reads the forge again |
| two attempts failing in different host ways | out | — | out: the card stops, and admission stays open |
| an optional step that failed or never started | out | — | out: `R-PROV-2` |
| a judge's directory not made, or a required step in a judge's `head` that failed or never started | out | — | out: no second attempt is made in that invocation, and the next invocation tries again |
| a maker that ran its first command and then failed | out | — | out: the work's failure, not the environment's |
| two cards each failing once | out | — | out: counted per card |
| a card refused for its acceptance's form (`R-CARD-7`, `R-CARD-8`) | out | — | out: it stays a refusal `rigger plan` reports |
| a card refused for its kinds (`R-SCHED-12`) | out | — | out: it stays a refusal `rigger plan` reports |
| a card refused for its labels' tiers or providers (`R-LOOP-13`, `R-LOOP-16`) | out | — | out: it stays a refusal `rigger plan` reports |
