ABOUTME: A journal entry from card #120: Two green branches, one red merge, and the merge test
ABOUTME: nobody ran

## 2026-09-23 — Two green branches, one red merge

Two pull requests merged seventy-nine seconds apart and the second one turned `main` red without
either branch having been wrong. PR #106 added `test/absorption-check.test.mjs`, whose line 99
carried a word. PR #112 removed that word everywhere and added `scripts/ruled-out-word-check.mjs`
to refuse its return in any tracked file. Neither branch carried the other's half, so neither
suite could see the collision, and `git merge-tree --write-tree` of the two tips exits 0 with no
conflict message and writes tree `4c32c12`: there is no textual overlap to conflict over. The
collision is behavioural. A file one branch wrote met a check the other branch wrote, in a tree
neither branch ever had.

The measurements say how invisible it was. At PR #106's tip `df7ef1c`, `npm test` exits 0 at
`tests 189 / pass 189 / fail 0`; there is no `scripts/ruled-out-word-check.mjs` in the tree, and
the word sits on 43 lines across 17 files, line 99 being one of them and in no way remarkable
among them. At PR #112's tip `1dd61a1`, `npm test` exits 0 at `tests 203 / pass 203 / fail 0`;
the check is there, `git grep -i` finds the word on zero lines tree-wide, and
`test/absorption-check.test.mjs` does not exist. One branch had the offence and no detector; the
other had the detector and nothing to detect. Merge them and `c94aa30` reports
`tests 235 / pass 234 / fail 1`.

**So a branch tested against `main` is not tested against the branch merging beside it.** Both of
these were merge-tested against `main` as it stood, which is the discipline as written, and the
discipline as written does not cover a batch whose members interact. Four pull requests went in
together and two of them did. What would have caught it is not a stronger per-branch test but a
different question asked once: merge the batch into one tree and run the suite there. `git
merge-tree` already answers whether the batch conflicts; nothing yet answers whether it passes.
A textually clean merge of green branches is not a green merge, and the cheap version of that
check is the merged tree's own `npm test`.

The check itself did exactly what it was built for, and the fix is proof of it rather than the
other way round. Revert the one comment and `check:words` exits 1 naming
`test/absorption-check.test.mjs:99`, the spelling it found, the line's own text and what to write
instead; `node --test test/ruled-out-word-check.test.mjs` reaches a verdict at
`tests 10 / pass 9 / fail 1` with the failing assertion printing the file and the line. Card #105
built the detector on a branch cut before that test file existed at all, so the word it was built
for arrived from the one direction #105 could not see. That is the argument for a check over a
cleanup: the cleanup was complete and correct at the moment it was made.

One note on the replacement, because it is the part a general rule would have got wrong. #105
settled that each site takes the phrase its own file already uses for its own subject, and named
"the binding documents" for a sentence about the set. This sentence is not about the set: it
justifies a fixture by saying `ARCHITECTURE.md` really does lack the heading the fixture omits,
after `755c809`. Reaching for the general phrase would have widened the claim from one file to
every binding document — a sentence that lints clean and says something the author did not
check. The narrower word the file already uses is `document`, and it is the whole fix.
