ABOUTME: Records card #227, which gave L3 its loop: N cards at once, each claimed before any
await, and the seams it leaves for the event family (#229), the halt (#280) and settling (#228).

# 2026-09-25 — L3 claims before it awaits

`loop` in `src/scheduling/loop.mjs` is L3's dispatching entry point. Its `pull()` fires the pull
trigger once. It reads the board, takes the pull order over the cards nobody holds a claim on,
claims up to the free slots, and works each claimed card. That work is L2's claim move, the
injected dispatch, and L2's handling of the outcome, which L3 hands over unread.

**The claim is taken in the same synchronous step as the pull order it follows.** The first
mutation I tried put an `await` before the unclaimed filter. The two-trigger test stayed green,
and rightly: the filter and the claim still had no await between them. The defect worth catching
is an await between computing the pull order and claiming from it. That mutant hands card 7 to
the dispatch twice, and the test reds on `[7, 7]`.

**A redo gets no claim move.** `pullOrder` returns a card already in Coding or Review as a redo.
L2's `claimed` move goes from ready to coding, so L3 asks for it only for a card pulled from Ready.
The redo still takes a slot and a claim. The "pulled again" item needs this. A card whose slot was
released while it was not fresh sits in Review, so its next pull is a redo.

**The board handle is L0's read side, whole.** `readColumns()` is how #215's missing-column error
reaches L3 unchanged, and #224's `readPriority()` answers the `{ items, declared }` hand-off
`pullOrder` reads. The first version called `readItems()` and expected that shape from it, so
passing the read side itself made `pull()` throw. One test now passes `readSide(...)` whole over
the fake `gh`, and the declared priority decides which card goes first.

**A test that could hang now fails instead.** The refused-claim test first awaited `pull()`
before it released any dispatch. So the mutant that swallowed the refusal dispatched the card, held
it open, and hung the run with no verdict. The test now asserts before it releases, and the mutant
reds on `[8]`.

**A freed slot does not fire the next pull yet.** Starting the next card when one finishes is
#228's acceptance, so here each `pull()` claims once and settles when its cards are done. The
concurrency tests fire the triggers themselves until a round starts nothing. No event is written
either. #229 writes the pull event, and #280 puts it between the claim and the claim move.

**Rule 8 reads bindings, not calls.** No call to `loop` reaches it without a binding, so barring
the binding outside `src/scheduling/` bars every call. This is how #213 already reads the write
sides. The rule throws on a tree with no `loop` export, so a rename cannot pass it vacuously.
