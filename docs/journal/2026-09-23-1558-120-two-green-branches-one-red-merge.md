ABOUTME: A journal entry from card #120: Two green branches, one red merge, and the merge test
ABOUTME: nobody ran

## 2026-09-23 — Two green branches, one red merge

Four pull requests merged inside seventy-nine seconds — at `20:19:50Z`, `20:20:22Z`, `20:20:42Z`
and `20:21:09Z` — and the first and the last of them turned `main` red without either branch
having been wrong. PR #106 added `test/absorption-check.test.mjs`, whose line 99 carried a word.
PR #112 removed that word everywhere and added `scripts/ruled-out-word-check.mjs` to refuse its
return in any tracked file. Neither branch carried the other's half, so neither suite could see
the collision, and `git merge-tree --write-tree` of the two tips exits 0 with no conflict message
and writes tree `4c32c12`: there is no textual overlap to conflict over. The collision is
behavioural. A file one branch wrote met a check the other branch wrote, in a tree neither branch
ever had.

The measurements say how invisible it was. At PR #106's tip `df7ef1c`, `npm test` exits 0 at
`tests 189 / pass 189 / fail 0`; there is no `scripts/ruled-out-word-check.mjs` in the tree, and
the word sits on 43 lines across 17 files, line 99 being one of them and in no way remarkable
among them. At PR #112's tip `1dd61a1`, `npm test` exits 0 at `tests 203 / pass 203 / fail 0`; the
check is there, `git grep -i` finds the word on zero lines tree-wide, and
`test/absorption-check.test.mjs` does not exist. PR #106 was cut at `c7804c5` and PR #112 later,
at `a727d51`, a descendant of it, so the two diverged at `c7804c5` and neither was stale work. One
branch had the offence and no detector; the other had the detector and nothing to detect.

The clean merge of just those two is already red, and running it is the fact worth having rather
than the `git grep` that suggested it. `git commit-tree 4c32c12`, with the two tips as parents,
materialises as `2752750`; `npm test` there exits 1 at `tests 215 / pass 214 / fail 1`, on
`✖ no tracked file in this repository carries a ruled-out word` naming
`test/absorption-check.test.mjs:99`. Two green suites, no conflict, and a red tree between them —
and the count is what says the run reached a verdict rather than falling over. The four-way merge
is no worse: `c94aa30` reports `tests 235 / pass 234 / fail 1`, the same single failure.

**So a branch tested against `main` is not tested against the branch merging beside it.** Both of
these were merge-tested against `main` as it stood, which is the discipline as written, and the
discipline as written does not cover a batch whose members interact. Four pull requests went in
together and two of them did. What would have caught it is not a stronger per-branch test but a
different question asked once: merge the batch into one tree and run the suite there. `git
merge-tree` already answers whether the batch conflicts; nothing yet answers whether it passes.
A textually clean merge of green branches is not a green merge, and the cheap version of that
check is the merged tree's own `npm test` — `2752750` above is that check, run after the fact.

**The red was cleared by a change made outside this card, and the timing is the lesson.** PR #122
changed line 99 by hand and merged as `8e25750` at `20:45:22Z`, twenty-four minutes after the
merge that went red, touching that one line and nothing else. Card #120 had already dispatched a
maker, whose branch was written to change the same line; by the time it came back sound, the line
was `main`'s and the branch conflicted on the only hunk it had. That resolution takes `main`'s
wording whole, and what is left of the branch is this entry. **So a fast fix and a carded fix
raced for one line, and the record is what nearly went with the loser:** PR #122 wrote no journal
entry and no account of the collision, and this entry exists only because the card that lost the
race was still open. Cheap to fix, cheap to write down, and the second is the part with no other
owner.

The catch itself was measured, on the branch before it was superseded, at `c834815`: revert the
comment and `check:words` exits 1 naming `test/absorption-check.test.mjs:99`, the spelling it
found, the line's own text and what to write instead, while
`node --test test/ruled-out-word-check.test.mjs` reaches a verdict at `tests 10 / pass 9 / fail 1`
against the 10 that target reports green. Card #105 built that detector on a branch cut before the
offending test file existed at all, so the word it was built for arrived from the one direction
#105 could not see. That is the argument for a check over a cleanup: #105's cleanup was complete
and correct at the moment it was made.

One note on the wording, because it is the part a general rule would have got wrong. #105 settled
that each site takes the phrase its own file already uses for its own subject, and named "the
binding documents" for a sentence about the set. This sentence is not about the set: it justifies
a fixture by saying `ARCHITECTURE.md` really does lack the heading the fixture omits, after
`755c809`. Reaching for the general phrase would widen the claim from one file to every binding
document — a sentence that lints clean and says something its author did not check — and a
mutation confirmed both halves of that during review. The wording that landed is `main`'s, from
PR #122, which carried no card and no acceptance, so nothing ruled on it; card #120's author has
recorded the shift its wording makes as an observation for the owner rather than as a card. What
survives here is the rule, not the sentence: a phrase wide enough to lint clean everywhere is wide
enough to say something nobody checked.
