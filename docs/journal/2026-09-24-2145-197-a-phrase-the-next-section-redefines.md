ABOUTME: Records card #197, which carries D19's merge permission to the cards AGENTS.md's
"Self-hosting" section lists, and why the fix replaced "done by hand" rather than defining it.

# 2026-09-24 — A phrase the next section redefines

`D19` let a maker merge its own card until M5, and `AGENTS.md`'s "Self-hosting" section still said
the cards changing the engine's own gate, config or entry point "are done by hand". Card #197
asked for the permission to reach those cards while the engine's own bar stays permanent.

## The first draft defined the phrase, and the file already had

The obvious fix was a definition: "by hand means by the owner, or by a session the engine did not
dispatch". It passed the lint and the budget. A search of `AGENTS.md` for "by hand" found the
sentence that sank it. "Version control" opens "Working by hand, create your own worktree; a
dispatched session is already in one." There, by hand is the opposite of dispatched, by anyone.

So the definition would have given one phrase two meanings in one file, which is spec-style rule 1's
defect. Worse, the second meaning is the one that explains the stop the card predicted: a
dispatched maker reading "done by hand" beside "Version control" has a textual reason to think the
card is not its to finish.

## Replacing the phrase with what it meant

`docs/v0-build-plan.md`'s self-hosting premise says `AGENTS.md` states which cards are excluded
from self-dispatch. The only sentence doing that was "done by hand". So the new wording says it
directly: the engine never merges such a change, and never dispatches a card that makes one. Then
it names `D19`'s permission as reaching those cards on the same evidence as any other.

## What generalises

A term defined for one section is read by a session across the whole file. Before defining a
phrase in a binding document, search the file for every other use of it, because a reader will
carry the other meaning in. Where the phrase already means something else nearby, replace it with
the thing it stood for rather than defining it.

The form was an amendment rather than a supersession. `D19` rule 1 already reached every card a
maker owns, and "Self-hosting" was the sentence that failed to say so. Naming those cards adds
within the stated scope, which the register's preamble permits as an amendment.
