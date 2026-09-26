ABOUTME: Records card #290, which proposes `R-WORK-8`, and why its claiming tests were already on
`main` before the row was written.

# 2026-09-25 — One board, one repository

#290 proposes `R-WORK-8`: two engines never share one board, and a board Rigger works holds no
issue or pull request of another repository. The owner ruled both halves on 2026-09-25 on #285.
The row's wording is the proposal; the rulings are recorded, not proposed.

**The test came first, from another card.** A `// proves` line naming an id the register does not
hold is refused by `npm run matrix:check`. So #289 landed `doctor`'s board-sharing tests with no
declaration, and this card adds the row and the declarations together. Three of #289's tests
claim the row: the failing board, the passing board, and the exit status across both.

**Two mutations, because each removes a different behaviour.** Stopping the board reader from
recording another repository turned the failing-board and exit-status tests red. The pass-case
test stayed green under it, because a board holding only `repo`'s items has nothing to detect.
Removing the comparison with `repo`, the mutation the architect named on #285, turned all three
red: `repo` itself was then reported as another repository. The PR carries both guarded runs.
