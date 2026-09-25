ABOUTME: Records card #182's two AGENTS.md edits routing a placement question to the architect,
the subject-term sweep that found them where a sweep for the act of authoring could not, and what
was found and left alone.

# 2026-09-24 — The sentence that names nobody

Three sentences in `AGENTS.md` have now been found by reading rather than by searching. Card #182
is about why, and the answer is that every sweep so far searched for a word the defective sentence
did not contain.

## The defect

`AGENTS.md`'s "When you write code" said a need that fits no extension point "is a design
conversation, not a workaround". It named nobody. "Ask the owner before" then supplied the only
actor on offer: "Any architectural decision, or contradicting a recorded one."

`D18` rule 2 gives the architect which layer, which boundary between two layers, and which
extension point a need lands in. So a maker with a placement question took it to the owner, and
the verdict `D18` rule 5 puts before decomposition never saw the question.

Card #173's maker found both sentences and left them, on the grounds that neither names a wrong
actor because the owner does ratify. That holds for `D18` rule 1, which is about ratifying. Rule 2
is about deciding, and deciding is what these two sentences route.

## Why a sweep for the act of authoring could not reach them

Card #173 searched seventeen stems of the act of authoring — `propose`, `ratify`, `draft`, `amend`
and the rest. `AGENTS.md:139` matches none of them, because it describes a question rather than an
act and names no one performing it. A sweep keyed to a verb can only find a sentence that has one.

The property the three found-by-reading sentences share is not a verb. It is a **subject**: each
one is about something `D18` assigns. So card #182 swept by subject instead, taking the search
terms out of `D18`'s own text rather than out of a vocabulary of authoring: `ARCHITECTURE.md`,
layer, boundary, extension point, `README.md`, requirement, decision, recorded, decompose,
architect, structure, `docs/spec`, promise, "good means", card.

Fifteen stems, run with `grep -n -i -E` over `AGENTS.md` at `01636ab`. Every hit was then read
against one question: does this sentence say who decides the thing `D18` assigns? A sentence
answering "nobody" is a hit, which is the case a verb sweep drops.

That found both sentences this card fixes, and it also reaches `AGENTS.md:145`, the sentence PR
#175's judge found by reading. A method that reaches all three of the sentences reading found is
the first method here that does.

## What was found and left alone

| Sentence | Subject `D18` names | Ruling |
|---|---|---|
| `:78` — changing an authored document needs the owner's agreement | `ARCHITECTURE.md` (rule 1) | Correct. Rule 1 gives the owner the ratification. |
| `:82` — two documents in conflict go to the owner | a gap between binding documents | Correct. `D18` assigns a document conflict to no other role. |
| `:145` — rule 1 for `ARCHITECTURE.md`, rule 7 for a requirement | rules 1 and 7 | Correct, and card #173 wrote it. |
| `:160` — restructuring code, or adding backward compatibility | none | Left. Rule 2 names layer, boundary and extension point, and restructuring is none of the three. |
| `:211` — the pointer to `ARCHITECTURE.md` | rule 2's subject | Left. It refers to a document rather than routing a decision. |

## The shape of the fix, and the fence on the other side

Both edits had to give the architect nothing `D18` rule 2 did not. Rule 3 keeps what must be true
of Rigger, what Rigger promises and what good means away from the architect, and rule 7 leaves the
requirements to the PM proposing and the owner ratifying. A sentence over-granting is card #173's
defect pointed the other way.

So `:139` names the architect only for the case rule 2 names, and cites rule 2 rather than
restating it. And `:159` grants nothing of its own: it narrows the owner's bullet by reference —
"any architectural decision `D18` does not give the architect" — so the architect's scope is
whatever `D18` says it is and never what this file says it is. "Contradicting a recorded one" is
untouched and still the owner's.

Referring rather than enumerating is what keeps the fence standing without a second place to
maintain. A bullet that listed layers, boundaries and extension points would have to be edited
again the next time `D18` moves.
