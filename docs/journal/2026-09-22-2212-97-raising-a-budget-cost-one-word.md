ABOUTME: A journal entry from card #97: Raising a budget cost one word, because the document owned the figure

## 2026-09-22 — Raising a budget cost one word, because the document owned the figure

The instruction-file ceiling moved from 2,000 to 2,500 words, and the whole change is one number
in `ARCHITECTURE.md`'s `Budgets` section. `scripts/instruction-budget.mjs` reads the figure out of
that sentence rather than carrying a copy, so no script, no test and no second document had to be
edited to agree with it.

No test asserts against this repository's own ceiling, which is why raising it was a one-word
edit. `test/instruction-budget.test.mjs` writes an architecture fixture stating the figure it
wants, and so do five of the six tests in `test/budget-checks.test.mjs`. A test holding a
hard-coded 2,000 would have turned a one-word proposal into a multi-file edit, and would have made
the test the authority instead of the document.

The sixth test is the one a later reader should open. `neither check states a budget of its own`
builds no fixture: it reads the two budget scripts out of this repository and asserts that four
spellings — `12000`, `12,000`, `2000`, `2,000` — appear in neither source. That is the falsifier
for a figure typed into a script, and the two spellings it names for the instruction ceiling are
the old one rather than 2,500. This card left the list untouched.

No recorded decision governs that read, and `D16` says so itself. Its Notes name
`scripts/instruction-budget.mjs` reading a budget out of `ARCHITECTURE.md`, and state that no rule
of `D16` reaches the dependency, because a document owns the fact rather than a tool. The
arrangement is easy to credit to `D16` and is not its.

Neither figure is derived. Nothing in the corpus says why two thousand rather than one or three,
and 2,500 is a judgement in the same way. The card was explicit that it could not compute a
replacement and should not pretend to.

What can be measured is the property the budget rests on, so it was run rather than asserted.
Appending 600 words to `AGENTS.md` took the check to 2,577 against 2,500 and exit 1, and moving
those same words into a nested instruction file under `src/` left the total at 2,577 and the
refusal identical. One number, one check, and the move spent nothing.
