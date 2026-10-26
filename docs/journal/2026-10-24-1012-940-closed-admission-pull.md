<!-- ABOUTME: Records card #940's proposal of what a pull answers under a closed or an unreadable admission. -->

# A closed admission's pull

Card #940 (M6-03l) is the structure delta that the Q1 ruling in
[the architect's pre-dispatch attack on #936](https://github.com/williacj/rigger/issues/936#issuecomment-6385791556)
gives the text for, cited here as "the ruling". `ARCHITECTURE.md`, "Failure model", said how a pull
treats an unreadable admission and said nothing of a closed one's pull.

## What the delta proposes

- **A closed admission is no failure of the pull.** `take` claims nothing and answers the closers it
  read. `once` and `run` say whether each closer is the owner's or a hold's, name its reason and
  time, and exit 0.
- **An unreadable admission is a failure of the pull.** `take` claims nothing and rejects, naming
  each unreadable path and its cause, and the verb exits non-zero naming them.

The ruling's text said "name each closer's kind". The delta writes "say whether each closer is the
owner's or a hold's" instead, as the architect's attack on #940 recommends, because "kind" already
names kinds of work and trigger kinds (`spec-style` rule 1).

## The cards that rest on it

- #936 (M6-07b), where L3 claims nothing while admission is closed.
- M6-10, where `plan` reports a closed or an unreadable admission.
- M6-14b, the exit run.

What would reverse it, per the ruling: a ratified requirement that an unattended run surfaces a hold
through its exit status, or the owner ruling that a hold's closed admission exits non-zero. Either
would be an `R-SCHED` row, which the PM proposes.
