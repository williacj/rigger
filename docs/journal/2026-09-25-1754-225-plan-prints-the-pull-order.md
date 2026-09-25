ABOUTME: Records card #225, which landed `rigger plan`, and why it shares `doctor`'s source-tree
guard and config load rather than holding its own.

# 2026-09-25 — `plan` prints the pull order

`rigger plan` in `src/cli/plan.mjs` refuses the tree it runs from, then loads and validates the
consumer's config. It reads the board's columns and `readPriority` through L0's read side, and
hands them to #221's `pullOrder` with #219's `nextAction` as the decision. It prints one line per
card, `pull` or `refuse`, then the number, then the kind or the reason. A redo is marked
`(redo)`. It exits 0 whenever it could read the board, refusals or not.

**The guard and the config load moved out of `doctor` into exported functions.**
`layer-boundaries.mjs` allows the consumer's config to be imported dynamically in exactly one
place, `doctor.mjs`, with the argument `pathToFileURL(path)`. A second import in `plan.mjs` would
break that rule, and the rule is not this card's to change. So `consumerConfig` and
`sourceTreeGuard` stay in `doctor.mjs`, and `doctor` calls them too. A later verb that reads the
config can use the same two. If the file name `doctor.mjs` misleads for code that several verbs
share, that is a separate card, because moving the file means changing the boundary rule too.

**No new `gh` command.** `readColumns` and `readPriority` send only queries the fake `gh` already
answers, so its command-coverage test needed nothing added.

**Only the pull-order test failed before the code existed.** The first slice of code covered more
than that test, so the other eight tests passed as soon as they were written. A mutation run shows
that each of them discriminates. Seven
mutations to `plan.mjs` were guarded as the tdd skill requires, and each one redded the test
aimed at it. The PR lists them.
