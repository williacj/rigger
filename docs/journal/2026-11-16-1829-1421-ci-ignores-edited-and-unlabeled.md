ABOUTME: Records why CI stopped running on a pull request's edited and unlabeled events (#1421),
the #1420 runs that prompted it, and the retarget consequence the owner accepted.

# CI no longer runs on edited or unlabeled

Card #1421 (M8-28), finished against acceptance revision `0e96dfd133f7`, made against `origin/main`
`c40377da`.

## The rulings

- **M8-U38** ([1293#6930730963](https://github.com/williacj/rigger/issues/1293#issuecomment-6930730963)):
  the owner ordered the trigger change and waived `D35` rule 5 so a maker could make it. The merge
  still needs the owner's marker.
- **M8-U42** ([1293#6933592363](https://github.com/williacj/rigger/issues/1293#issuecomment-6933592363)):
  the card keeps only the trigger change. Same-head cancellation could not have prevented the
  #1420 block, because the deferred run came after the full run.
- **M8-U43** (the same comment): the retarget consequence below is accepted.

## The #1420 runs

All at head `816c4474` of PR #1420 (branch `rigger-1414`), on 2026-11-16, as the card records
them from `gh api`:

| Run | Created (UTC) | Event | Aggregate job |
|---|---|---|---|
| 43932907245 (#4737) | 18:49:40 | | `broad deferred (26)` success |
| 43933168596 (#4738) | 18:51:10 | | `check (26)` success |
| 43938977999 (#4739) | 19:24:18 | `edited` | `broad deferred (26)` success |
| 43960018088 (#4740) | 21:25:54 | `unlabeled` | `broad deferred (26)` success |
| 43960135555 (#4741) | 21:26:37 | `labeled` (`ci:full` again) | `check (26)` success |

The coordinator's account is that the description edit at 19:24 hid the required `check (26)` and
blocked the merge. This card does not diagnose why; it removes the two events.

## What changed

`edited` and `unlabeled` left all three lists in `.github/workflows/ci.yml`: the `pull_request`
trigger types, `CI_POLICY`'s action list and `CI_CANCEL`'s action list. The policy and the
cancellation controller now refuse either action if handed it, so the three lists cannot
disagree. No job-level `if:` was added, because GitHub counts a skipped
job as passing a required check. The gate's own workflows keep `edited`, since the gate must
re-read a pull request whose body changes.

## The retarget consequence

Retargeting a pull request's base branch fires `edited`. After this card a retarget starts no CI
run, so CI no longer re-runs automatically when a base changes. The head gets its `check (26)`
from its next push (`synchronize`), a `reopened` event or a label. Test A20 in
`test/ci-proof-source.test.mjs` now asserts both halves: the policy refuses `edited`, and a
journal-only pull request based on `main` gets `check (26)` from a `synchronize` run.

## Left open

The same class of block stays reachable through a `labeled` event with any label other than
`ci:full`, through `reopened` and through `ready_for_review`, and the engine's read of
`check (26)` reports `passed` where GitHub's merge gate said "Expected — waiting". Both are
carried to their own cards.
