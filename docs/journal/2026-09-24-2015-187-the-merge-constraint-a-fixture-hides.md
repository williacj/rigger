ABOUTME: Records card #187's permission for a maker to merge its own card until M5, the decision
that carries its reversal, the sweep and reading that enumerated every merge constraint in
AGENTS.md, and why a permission granted there did not reach the maker's role prompt.

# 2026-09-24 — The merge constraint a fixture hides

Card #182 proved that a subject sweep reaches a sentence naming nobody, where a verb sweep
cannot. Card #187 swept a second subject and found the method's own floor: a sweep takes its
terms from documents, so a sentence written in a vocabulary those documents never use stays
invisible however many stems the sweep carries.

## What the card settles

`AGENTS.md:28` said "never merge it" in words carrying no exception, and rule #1 of the same file
forbids a session granting itself one. A dispatched maker read the prohibition and stopped, which
is the behaviour the file exists to produce and why the permission could not live in a dispatch
brief.

So `D19` records the permission and `AGENTS.md` carries it: until M5, a maker merges its own card
once `R-GATE-4`'s evidence is in hand, and never otherwise. The reversal was not invented for this
card. `AGENTS.md`'s "Version control" already gave the gate rule to the owner to waive until M5,
and `docs/v0-build-plan.md`'s M5 is where the hook arrives.

## Referring rather than restating, twice

Both edits name the condition by reference. `:28` now points at "Review and merge" rather than
enumerating what that section permits, and "Review and merge" points at `R-GATE-4` rather than
retyping the four conditions `R-GATE-5` through `R-GATE-8` hold.

That is PR #184's shape applied to a second subject, and it buys the same thing: the panel's
composition and the freshness rule stay owned in one place, so a change to `R-GATE` moves the
permission with it and no second copy goes stale. It also closes the failure the card warned
about, because a reference to `R-GATE-4` cannot be read as one sound verdict standing for a
configured panel of three.

## The sweep, and what it could not reach

Twenty-eight stems, run with `grep -n -i -E` over `AGENTS.md` at `306d5e9`, taking their terms
from the four places merging is already ruled on: this file's "Review and merge" and "Version
control", `R-GATE-1` through `R-GATE-8`, and `R-LOOP-11`. Fifty-four lines matched. Every hit was
read against one question — does this sentence constrain who may merge? — where a sentence
answering "nobody" is a hit.

That found thirteen sentences. Reading all 214 lines of the file found a fourteenth the sweep had
no term for, and round 2 added a fifteenth the sweep did return and the reading failed to rule on.

`AGENTS.md:194-196` says a card changing `templates/rigger.config.mjs` changes the live config,
whichever file it opens, because `test/init.test.mjs` compares the two byte for byte. That
sentence extends the class of cards `:186-188` says the engine never merges. It matches zero of
the twenty-eight stems, because its subject is a test fixture rather than merging, and its whole
work is done by the sentence three lines above it.

The shape is worth keeping as a risk rather than a law. A constraint stated as a scope extension
*may* carry none of its own subject's vocabulary, taking it instead from the rule it extends, and
this one does. It is not a third class of blind spot: it is a named mechanism by which a sentence
ends up in the foreign vocabulary the paragraph above already describes. A scope extension that
repeated its rule's subject would be reached by the sweep like anything else.

## The sentence the enumeration stopped one short of

Round 1's enumeration missed `AGENTS.md:8-15`, and missing it was not a third failure of the
sweep. The sweep reached line 8 — the stem `author` matches inside "authority" — and the reading
passed over it without ruling either way. A hit read and not ruled on is worse than a hit never
returned, because the sweep's own output records that the sentence was seen.

It belongs in the enumeration on the enumeration's own standard. `:17-18` and `:78-79` were both
counted, and neither names merging; both are counted because they govern which prohibition binds
whom. `:8-15` does the same and more: *"Where a role prompt is narrower than a rule here, the role
prompt wins for that role."* It is the sentence under which a role prompt takes a merge permission
away from the maker `AGENTS.md` grants it to.

## A permission is not delivered by the document that grants it

That is the round's real lesson, and `:8-15` is why. Round 1 changed `AGENTS.md` so that a maker
may merge its own card, and every check it ran passed. The permission still did not reach a
dispatched Engineer, because `.claude/agents/engineer.md` said *"You never judge your own work,
and you never merge it"* — narrower than the amended rule, and `:8-15` resolves that conflict in
the prompt's favour.

So the card's opening behaviour survived the card's own fix, one file over. A change to a rule in
`AGENTS.md` is finished only once every prompt that narrows that rule has been read, because a
role prompt is where a repo-wide rule goes to be overridden.

`.claude/skills/agent-style/`'s one test says why the clause was there to begin with: *"Restating
a repo-wide rule in a prompt does not emphasise it. It re-scopes it."* The Engineer's clause was a
restatement of the old repo-wide rule, correct on the day it was written and a contradiction the
moment the rule moved. The fix is to delete the restatement rather than to replace it with a
narrower one, because `AGENTS.md` binds every session already and the prompt's opening says so.

Only the Engineer's clause conflicted. The Reviewer's *"You never change the work, and you never
merge it"* and the spike engineer's *"You never merge the spike's code"* look identical and are
not: a judge is not the maker, and spike code merges for nobody under `AGENTS.md:135`, which this
change leaves standing.

## What was found and left alone

| Sentence | Why it was left |
|---|---|
| `:40` — `critical` for a fault that must not merge | Constrains what may merge, never who. |
| `:171-173` — a later commit or a revised acceptance stales the verdict | Constrains when evidence counts. `R-GATE-7` owns it. |
| `:175-177` — a judge returns the card to its author rather than rewriting it | Constrains what a judge does with an acceptance. |
| `:44-45` — only a card's author changes its acceptance | Feeds `R-GATE-7` staleness, and names no merge. |
| `:201` — branch for every piece of work | A precondition to any merge, naming nobody who may perform one. |
| `:34` — a 41-word sentence, and `:111` — the term "approval" | Two pre-existing `lint:spec-style` findings in a file outside that lint's scope roots. Neither is this card's. |

The two lint findings are the clearest case of leaving something alone. `AGENTS.md` is not in
`lint:spec-style`'s scope roots, so its form rules hold because an author applies them. Calling
`findings()` over the file anyway reports the same two before and after this change.
