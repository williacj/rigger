ABOUTME: Card #177 — the two merges that falsified a repository-wide invariant, the mechanism they
share, why the owner chose a merge queue over requiring branches to be up to date, and what the one
workflow trigger this card adds cannot be exercised until the queue exists.

# Card #177: an invariant a sibling branch can falsify

## The mechanism

**A check that quantifies over a set the repository holds is not preserved by merge, even when both
sides are green.** A branch gate reads one branch at a time. Where the invariant is "every member of
this set has property P", one branch can add the sweep and the other can add a member lacking P, and
each is true of the tree it was measured on. The conjunction is false, and it is false for the first
time in a tree that did not exist when either branch was tested. No branch gate can see it, because
the tree nobody ran is the merge result.

Both incidents below are that shape. They differ in what happened next, and the difference is the
more useful half.

## Incident one: the git-spawn sweep, which went red

Verified by running the sweep at each of the three refs, in a worktree of a clone taken from the
GitHub URL.

| Ref | What it holds | The sweep |
|---|---|---|
| `b7465d8` = `c433d57^1` | PR #155's sweep; one git spawn in `test/path-check.test.mjs`, at line 99, carrying `env: gitEnvironment()` | 14 pass, 0 fail, exit 0 |
| `985d74c` = `c433d57^2` | PR #162's head; two git spawns in `test/path-check.test.mjs`; no sweep file at all | the sweep does not exist on this side |
| `c433d57` | both | exit 1 |

The sweep is `every git this repository spawns is handed an environment the call names`, in
`test/git-environment.test.mjs`, which PR #155 added whole — 334 insertions, one file, absent from
`7cc95d1^1`. Its failure at `c433d57` reports
`{ where: 'test/path-check.test.mjs:115', spawns: 'git', hands: 'nothing' }`.

The added member is the second spawn in `test/path-check.test.mjs`, whose options object carries
`encoding` and no `env`. **The pointer is exact, and it is exact about `c433d57`** — the tree the
sweep ran on, which is the only tree it could have reported from. There the call opens on line 115
and its object closes on 117. What the sweep reports is the line the call opens on, which is a
property of the sweep and not of either tree: `everySpawn` builds `where` from `open.line`, and
`open` is the `(` token the loop is standing on, guarded to be exactly that — `if (open.kind !==
'punct' || open.value !== '(') continue;`. Numbered as `c433d57` numbers that file, the assignment
is `test/git-environment.test.mjs:202`, the guard `:204`, and the report `:213`.

The same call sits two lines earlier at `985d74c`, opening on 113, because the first parent added
two lines above it — the `gitEnvironment` import and the `env: gitEnvironment()` on the earlier
spawn. So a reader who checks the report against `985d74c` finds the call itself on 113, and that
is the bait: the pointer then looks two lines off, and the correction it invites is one the tree
that reds does not need — there, at `c433d57`, 113 is a comment. The temptation is worth recording
because this entry fell for it in round 1: it read the spawn on the parent that never ran the sweep,
inferred from the coincidence that the sweep must report the line the object closes on, and wrote a
caveat onto a pointer that was already right. A figure about a failing run belongs to the tree that
failed.

PR #155 merged at `2026-09-24T17:00:57Z` as `7cc95d1`. PR #162 merged 63 seconds later, at
`17:02:00Z`, as `c433d57`. PR #162's last CI run was at `15:45:03Z` — **seventy-five minutes before
#155 landed**, so its green was measured against a `main` that did not yet hold the sweep, and
nothing re-ran it.

## Incident two: the spent exemption, which went red a day late

The second incident has the same shape and a different ending, and transcribing the card's row would
have missed it. **`main` did not go red at `e058738`.** Measured in a worktree at that ref: `npm test`
reports 240 tests, 240 pass, 0 fail, exit 0; `npm run check:paths` reports 0 missing paths and exits
0; and each of the seven other checks the tree defines exits 0. The eighth, `check:headers`, did not
exist yet.

What was false at `e058738` is the invariant, and that is measurable directly. `spentExemptions` in
`scripts/path-check.mjs` reports every exemption prefix the repository now holds, an entry being
written for a place that does not exist yet. Run against each of the three trees:

| Ref | Tracked under `docs/spikes` | Exemption prefixes | Spent |
|---|---|---|---|
| `22686b4` = `e058738^1` | `docs/spikes/reserved-git-indirection.md` | none | none |
| `5a9b734` = `e058738^2` | none | `docs/spikes/` | none |
| `e058738` | the report | `docs/spikes/` | `docs/spikes/` |

Each side holds one half and is correct. The merge holds both, and the entry — "this directory is
absent until that report lands", in `doc-references.json` — is false about a directory the tree
tracks.

The report was added by `b66ea12`, PR #126's head, merged as `d5bbbe9`, which `git merge-base
--is-ancestor` confirms is an ancestor of `22686b4`. The exemption entry came from PR #127, whose
merge `e058738` is. `e058738` was written `2026-09-23 21:21:49Z`.

The reader that detects it, `spentExemptions`, was added by `5f56308` — PR #171, "Report an
exemption whose prefix the repository now holds" — at `2026-09-24 17:27:03Z`. **The break was
latent for twenty hours**, because the sweep that would have caught it had not been written when the
merge falsified the invariant.

So the class is worse than two red merges. A merge can falsify an invariant that no check yet
expresses, and the red then arrives with whoever writes the check, attached to a tree they did not
break. Incident one is the visible case; incident two is what the same mechanism does when nothing
is looking.

## Why a merge queue, and not requiring branches to be up to date

Both close the staleness incident one turns on. The owner chose the queue, and the reason is this
repository's own ratified rules rather than a preference.

Requiring a branch to be up to date forces an absorb commit onto the reviewed branch. `R-GATE-7`
requires of the gate that "every one of those verdicts ruled on the work now being merged, and
against the card's current acceptance" — so a verdict read before the absorb no longer rules on the
work being merged, and the gate refuses. `R-LOOP-8` then prices the repair: "A change to the work, or
to the acceptance, sends every judge back. Either spends one round." The absorb is a change to the
work, so it spends one of the rounds `R-LOOP-9` bounds — a count the consumer sets, three unless it
says otherwise, so the ceiling this argument runs into is a default and not a fixed number. In a
burst — several sound pull requests waiting together, which is this milestone's ordinary pattern —
every pull request after the first would need a re-judge before it could merge, and each would pay
a round for a commit that changed nothing anyone reviewed.

A merge queue tests the merge result on a temporary branch it creates and discards, and never writes
to the pull request's head. The verdict stays bound to the commit the judge read, so `R-GATE-7` is
satisfied rather than tripped and `R-LOOP-8` is never engaged. Same protection against the merge
nobody ran, at no cost in rounds.

## What this card delivers, and what it cannot exercise

One trigger: `merge_group:` in `.github/workflows/ci.yml`, among the `push` and `pull_request`
entries that were already there, written as a mapping key with no value because that is the shape
both existing entries use.

The status checks a queue would require are **`CI / check (20)`** and **`CI / check (24)`** —
workflow name, then the check run's own name. **Those names cannot be read off the YAML.** The job
key is `check`, and the job carries `strategy.matrix.node: ['20', '24']`, so what reports is one
check run per matrix leg with the leg appended. Measured on PR #180's head `2e9bbad`: `gh pr checks
180` lists `check (20)` and `check (24)`, and the check-runs API for that commit returns exactly
those two names; `gh api .../actions/runs/36066508120` gives `name=CI`, `path=.github/workflows/ci.yml`.
A name taken from the job key would have been `check`, and a queue configured on it would require a
check that never reports.

**The trigger is unexercised.** A `merge_group` event exists only where a queue exists, this card is
forbidden from creating one, and `actionlint` is not installed on this host. So the verification is
a YAML parse and the suite: `yaml.safe_load` returns `{'push': None, 'pull_request': None,
'merge_group': None}` for the `on` mapping, one job named `check`, matrix node `['20', '24']`. Until
the owner enables the queue, nothing has run on this trigger, and nobody should read the green below
as evidence that it fires.

One thing the parse shows in passing, unchanged by this card: a YAML 1.1 parser reads the bare `on:`
key as the boolean `True`, which is why the parse above names it rather than the string. GitHub's own
parser does not, and `on:` was already bare before this change.

## Ordering

This must land before the queue is enabled, and the reason is asymmetric. A workflow answering
`merge_group` with no queue configured is inert — the event never fires, and nothing changes. A queue
configured to require `CI / check (20)` and `CI / check (24)` against a workflow that does not answer
`merge_group` waits for two checks that never start, and every entry stalls to the queue's timeout.
So the harmless order is this card first, the setting second.

## What was measured, and where

Every figure in this entry is measured on branch `m0/177-merge-group-trigger`, base `275a15a`, in a
clone taken from the GitHub URL with `core.hooksPath` set to `.githooks`, on this host: node
v24.18.0, npm 11.16.0, git 2.55.0.windows.5, Windows 10.0.26200. Historical figures are measured in
worktrees of that clone at the refs each table names.

The base is worth stating precisely, because the card's own figures were measured at `a651895` and
PR #180 merged after them. `275a15a` is that merge. The check names re-measured the same at both.

`core.autocrlf` is `true` here, so the two files this card changes exist in two forms and the hashes
are of the working tree unless said otherwise. Before the change: `.github/workflows/ci.yml` is 1381
bytes on disk with 39 CR, sha256 `daeb36f6`, and its stored blob is 1342 bytes with 0 CR, sha1
`492ab70`; `test/package.test.mjs` is 7176 bytes on disk with 152 CR, sha256 `cd1fb114`, and its
blob is 7024 bytes with 0 CR, sha1 `e6bd984`. CR counts are from `tr -cd '\r' | wc -c`, not
`grep -c`, which counts matching lines and answered 4 on a file with none for a session earlier
today.

## The test, and why it was extended rather than added

`test/package.test.mjs` already read the workflow and already asserted the triggers, in `CI runs on
every push and every pull request`. The third assertion went into that test rather than beside it,
and both existing assertions are kept verbatim. Failing first, before the workflow changed, on
`/\bmerge_group\b/` with `push` and `pull_request` still passing, which is what shows the new
assertion is the one carrying the change.

The assertion reads the `on` block through the file's existing `topLevelBlock` helper, which drops
comment lines, so the comment this card writes inside the block cannot answer for the trigger and a
`merge_group` someone comments out would fail the test.

## What was left alone

Nothing under `.githooks/` is touched, and no repository setting or ruleset was read for change or
written. Card #177 records `main` as carrying neither — 404 from the protection endpoint, an empty
list from `.../rulesets` — measured while `main` stood at `a651895` on 2026-09-24. This entry refers
to that measurement rather than making one of its own, for two reasons: a card forbidden from
changing a setting has no reason to read it, and a repository setting is not a property of a commit,
so a present-state claim about one is stale the moment anybody changes it and the entry cannot know
when that happens.

The workflow change is sufficient for CI to answer a queued merge, so far as a workflow can be: the
event is a first-class trigger and the job has no condition that would skip it. Whether the queue
also needs the two check names configured on it is the owner's setting, not this card's, and this
card asserts nothing about it beyond the ordering above.
