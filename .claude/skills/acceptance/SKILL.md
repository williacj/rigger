---
name: acceptance
description: Write or revise a card's acceptance — the items that state what done means before any work on the card starts. Use when filing a card, when decomposing larger work into cards, when a spike card needs a bar, and when judging whether an acceptance item is testable.
---

ABOUTME: How an author writes a card's acceptance: work out what the card is really asking for,
then state it as standalone conditions a judge can rule on without asking the author.

# Writing an acceptance

An acceptance states what done means. It lives in the issue body as plain bullets — not in a
board field, and never as a task list (`D2` rule 2).

## The one test

**A judge must be able to rule on the item without asking you.** That is `R-CARD-2`'s test, and
every rule below is a way of passing it. Its other half — one condition per item — is under
"Write each item".

You will not be there when the card is judged. A judge that cannot rule on an item records it
unmet (`R-LOOP-5`), and a verdict leaving any item unmet is not sound (`R-VERDICT-4`). An item
only you can read is paid for in rounds, by the maker, later.

## Start from the card, not from the bullets

Bullets written first tend to restate the title, which is one of the two shapes admission
refuses outright (`R-CARD-8`). Work these out before you write any:

- **The outcome.** What actor, stakeholder, or system outcome is this card meant to enable? That
  context belongs in the card's description. The acceptance holds the observable conditions that
  prove the outcome was reached; it never becomes a second brief.
- **The proof.** What observable change shows it was reached? That is what the items assert.
- **The constraints that already bind.** Where something outside the card fixes part of the
  answer, cite it: a requirement id, a `D#`, an `AGENTS.md` section. A constraint with no source
  behind it is you prescribing the implementation. Write each citation as `AGENTS.md`,
  "Documents own their facts", requires.
- **The boundary and failure states that apply.** Empty input, invalid input, limits,
  permissions, a dependency failing, partial completion. Consider each; carry over only the ones
  this card can actually reach. A documentation card owes no error criterion, and one invented to
  fill out the list is filler a judge still has to rule on.

## Write each item

**One condition per item.** That is `R-CARD-2`'s first half; an `and` usually hides two.

**Each item stands on its own.** Each names enough subject and context to be ruled on by itself.
A judge reconstructing an item from the bullet above it is one misreading away from ruling on
the wrong thing.

**Name the thing, and the observable fact about it.** The ruling should be a reading, not an
opinion. Name the concrete thing that would prove the item false as well — the output, the file,
the exit code whose presence or value settles it. An item with no falsifier gives a judge nothing
to look for but your wording, and your wording will always agree with itself.

**Cut the words that hand the ruling back to you.** *Appropriate, clean, properly, robust,
comprehensive, reasonable, as needed, where necessary, good.* Each of these means "ask the
author". Name the condition the word stands for instead. If you cannot name it, you do not yet
know what you are asking for.

**A list of instances is evidence for a class, never the class itself.** Where an item names
members of a class, say that they are instances, and ask for the positive check instead: only
sanctioned members may appear. An item enumerating what must not appear is met exactly by the
absence of what it listed — the list under "Cut the words that hand the ruling back to you",
written into one, is satisfied by any synonym.

**Name the threshold, where there is one.** Where the card turns on quantity, duration, capacity,
compatibility or another threshold, name the value and how it is measured. Never invent a number
to look precise — derive it from the card, or from a source you cite.

**Say what done means, never how to do it.** The maker chooses the mechanism. An item that names
one bars a better route and is not a statement about done.

Every item is mandatory — one left unmet is not sound (`R-VERDICT-4`) — so order them for reading
rather than for priority.

## Choose a format

An ordinary rule bullet by default: a named path exists and states a named thing; a named command
exits zero, or produces named output; a named input is refused, and the refusal names the reason;
a named document cites a named id.

A **Given/When/Then** bullet where the ruling needs its context to make sense. `R-CARD-2` still
holds, so one item carries one independently ruleable outcome, never a scenario with several
`Then`s. Split a compound result instead:

- Given a Ready card has no acceptance, when `rigger plan` evaluates it, then the card is not
  pulled.
- Given a Ready card has no acceptance, when `rigger plan` evaluates it, then `plan` names the
  card and identifies missing acceptance as the reason.

Those are `R-CARD-7`'s two halves, one apiece; `plan` is the verb the README gives for showing
what a run refuses. Each bullet repeats its own context rather than borrowing it from the one
above: standing alone is worth the words it costs.

## A spike card

A spike card's acceptance states what a complete answer contains, never what the answer is
(`R-CARD-9`). Fixing the answer in advance is not a bar; it is the finding, and it leaves the
spike unable to report the one thing it was dispatched to find out.

Write the shape of the report: which options it weighed, what it measured, what it recommends
and on what evidence, and what would reverse the recommendation.

## Scope, and what a change costs

**Bound the card.** Everything you are asking for goes in the acceptance. Work found outside it
becomes its own card rather than joining this one (`R-CARD-11`), and a follow-up may only cover
work outside it — an item left undone means the card is not done (`R-CARD-10`).

**Split work into cards.** Map every part of the larger work to a card's acceptance item, not
merely its title or description.

**Name dependencies.** In the dependent card, name the prerequisite card and its required result.
Its acceptance covers its own work.

**Exhausting one axis is not covering the card.** An item can hold along every value of the axis
it names and still miss a defect on an axis it never named. Every command exits zero; every one
of them writes to the wrong path. Where the card varies on more than one axis, name each of
them, an item apiece (`R-CARD-2`).

**Changing it after admission is expensive, and it stays yours.** Only its author changes an
acceptance after admission, never the maker it is judged against (`R-CARD-5`), and every change
is recorded with who made it (`R-CARD-6`). A change to the acceptance, like a change to the work,
sends every judge back and spends one of the card's rounds (`R-LOOP-8`); a card that exhausts its
rounds escalates as ambiguous (`R-LOOP-9`); and the change stales every verdict already returned
(`R-GATE-7`). Settle the bar with whoever will help you before you file.

## Work outside the repository

For a card acting on a system outside the repository where undo is not obvious, require the maker
to state its intended action before acting, with inspectable evidence of what it said and when.

Require proof on a fake for every behaviour a fake can prove. A real-system run cannot replace
that proof. Make each requirement a separate acceptance item.

## What is checked, and what is not

Two forms are refused at admission and nothing else is: a card with no acceptance is refused by
name and reason (`R-CARD-7`), and a card whose acceptance only restates the card's title is
refused (`R-CARD-8`). Those two are the whole of the check on an acceptance's form (`R-CARD-8`).

So the bar being right is yours. `D2`'s notes say what that buys and what it does not: no check
proves an acceptance adequate, and a green marker is never a warranty that the card asked for
the right things. A judge rules on whether the acceptance covered what the card asked, and
returns the card to you with the reason rather than rewriting it (`R-LOOP-6`).

## Before you file

1. Did you start from the outcome, the proof, the constraints and the failure states that apply?
2. Did you write every citation as `AGENTS.md`, "Documents own their facts", requires?
3. Can a judge rule on each item without asking you (`R-CARD-2`)?
4. Is each one condition (`R-CARD-2`)?
5. Does each stand on its own?
6. Does each name the concrete thing that would prove it false?
7. Does each say what done means rather than how to reach it?
8. Where an item lists instances of a class, does it ask for the positive check instead?
9. Where the card turns on a threshold, is the value named and its source cited?
10. Does the set cover everything this card is asking for (`R-CARD-10`, `R-CARD-11`)?
11. Does the set name every axis this card varies on, rather than exhausting one of them?
12. For a spike: does it describe a complete answer rather than the answer (`R-CARD-9`)?
13. When splitting work, is each part mapped to an acceptance item?
14. Are each dependency's card and required result named?
15. Must a maker state an outside-system action before acting if undo is unclear?
16. Must every fake-provable behaviour be proven on a fake?
