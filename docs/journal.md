ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — The code stated two facts it did not own

Card #29 built `scripts/package-budget.mjs`, the check CI runs against the package line budget.
Two review rounds on PR #40 found two defects in it, and the gap both sat in had no rule.

The round 1 review found the scan entering block-comment state on a `/*` inside a string. The doc
comment above it bounded the cost at "an undercount of one line". Nobody had measured that bound:
the real undercount ran to the next `*/` or to the end of the file, in the check that decides
whether an over-budget package merges.

The round 2 review found the file excluding tests by a list of spellings it had thought of itself.
Three shapes `node --test` executes were charged to the production budget — `test.mjs`,
`test-*.mjs`, and every file under a `test` directory — where `ARCHITECTURE.md` puts tests outside
it. `npm test` is `node --test`, so what counts as a test was never that script's question.

What the two share is not the fix but the mistake: code asserting a fact it did not own. Both
passed a green suite, because an assertion the code derives from itself agrees with itself. The
second fix found the authority and read from it. The first measured the disagreement it had
guessed at, and stated what it really costs.

The second half is the one an author drops. Reading from an authority couples the code to that
authority's behaviour, including where that behaviour is undefined. Measured on this repository's
own checkout — Windows, NTFS, Node v24.18.0 — `node --test` runs `a.TEST.mjs` and declines
`TEST.mjs`, two spellings one case-insensitive filesystem holds as one name. The exclusion on
`main` is case-sensitive, so it charges `a.TEST.mjs` to the production budget while the runner
runs it as a test. The test that asks the runner does not catch it, because its fixture is all
lower case. `D16` records both halves: ask the authority, and record where the authority can
disagree with you.
