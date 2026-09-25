ABOUTME: Records card #201, which carried the owner's six M1 rulings into the build plan's M1, and
why a keyword sweep was the wrong way to find the sentences they contradict.

# 2026-09-24 — Sentences without the keyword

Card #201 wrote six owner rulings into `docs/v0-build-plan.md` §4 M1. The rulings came out of
cutting M1 into cards, and until now they lived only in the decomposition draft. The reviewer
judging that draft found M1's closing card could not be ruled met against a plan that still said
`setup-board` creates the real board.

## Reading, not searching

The card asked for every M1 sentence the rulings contradict, with the method named. A search for
the verbs the rulings name finds the obvious ones. It misses "the engine works one card at a time",
which contradicts the ruling that `once` and `run` dispatch nothing but names neither verb. Run over
M1 at `5f759b4`, the sweep caught that exit bullet's second line only because "at once" contains
"once", and missed its first line. So the sweep was a cross-check, and the method was a
sentence-by-sentence read of M1 against each ruling in turn.

## Where the verbs first dispatch

The ruling gave its reason as "dispatch arrives with M2 and work with M4". M2 brings the execution
core a dispatch runs through, but nothing in M2 or M3 gives a card a role to dispatch. M0's exit
already says nothing dispatches until M4, and §1.1 places Rigger's first dispatch there. So the
plan names M4 as where `once` and `run` first dispatch a card.

## One gap the rulings left

"`run` claims until every slot is full" never ends on a board with fewer pullable cards than
`concurrency`. The plan adds "or until no card is left to pull", and the pull request marks that
clause as proposed rather than ruled.
