ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — The architecture already held the config, so the validator had nothing to invent

The config core looked like a design job and turned out to be a transcription job.
`ARCHITECTURE.md` publishes a config shape under its extension-point table, and that shape is
the only place the corpus spells any of these keys. Taking it as the offer left nothing for this
card to name: the test runs that block as a module and compares its key paths against the
validator's, in both directions, so a key the architecture does not spell cannot be offered and
one it does spell cannot be missed.

What the shape does not spell is the interesting part. The table names three engine settings the
shape leaves out — the worktree root, the state directory and the topic rule — and two rows
marked `Yes` that the config points at rather than contains. A config naming any of those five
is refused today, because Rigger offers no spelling for them yet. That is a real bound on the
refusal, not a completeness claim, and the card that lands each setting is what adds its key.

Three tests could not have failed first, because each generalises a test that already had. Each
was instead watched failing with its own defect mutated into the validator: the required-key
refusal stubbed out, the unknown-key sweep stubbed out, and a key the architecture does not
publish added to this repository's config. A fourth test — that the validator accepts this
repository's own config — can only fail by that config changing, which is what it is for.

One fixture was wrong in a way that would have passed for the wrong reason. The owner-order test
named the kind's own maker among its judges, so it earned two refusals, and it would have gone
green off the maker-and-judge separation rule rather than the order rule it tests. Asserting the
refusal count rather than a match is what caught it.

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
