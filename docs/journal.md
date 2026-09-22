ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A fixture that proved nothing, in a test that passed

The CLI check reads the README's command block for the verb list. Its fixture named a stray
invocation outside the block, to prove the reader keeps to the block, and the stray was written
as backticked prose. A line anchored on `npx` never matches backticked prose whatever its scope,
so widening the reader to the whole document left the test green. The fixture was documenting an
intention rather than testing one.

What caught it was asking what implementation each line would fail. Writing the stray as a bare
invocation, once in another section and once beside the block, made both scopings fail when
widened, and both failures were watched. A fixture line that cannot fail is worth less than no
line, because it reads as cover.

This card also created `src/`, so the package budget moved from `0 production lines` to a real
number for the first time. The CLI sits under it because the budget table gives the CLI a row and
`scripts/package-budget.mjs` counts what is under `src/` and nothing else. That is a reading of
two sections, not something either one states, and the layer table still names no directory for
the CLI.

## 2026-09-22 — The lint arrived after the corpus, and the corpus barely cleared it

Writing `spec-style-lint` against documents already written showed how little headroom the
sentence ceiling has: the longest sentence the lint reads is 39 words against a ceiling of 40.
The next compound sentence anyone writes into the README or the register reds the build.

Two of the four register rules turned out to be unlintable, and the reason is worth keeping.
Rule 3 asks whether an actor is genuinely unknown and rule 4 asks whether a structure fits its
meaning. Both are judgments about intent, and a lint that guessed at either would file findings
an author has to argue with rather than fix.

The sentence splitter asks the word after a full stop whether the stop ended a sentence, and it
is wrong both ways. A lowercase word keeps two sentences joined, as `v0 buys` does, and the
count comes out high. A capital after an abbreviation splits one sentence into two, the way
`e.g. Rigger` does, and the count comes out low.

The second of those cost a review round, because this entry first claimed it could not happen.
A bias in a check is worth disclosing, and a bias described as absent is worse than one nobody
mentioned: a reader then draws a conclusion the check cannot support. A green lint says no
sentence the splitter reads is past the ceiling, which is narrower than it sounds.
