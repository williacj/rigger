---
name: acceptance
description: Write or revise a card's acceptance — the items that state what done means before any work on the card starts. Use when filing a card, when decomposing larger work into cards, when a spike card needs a bar, and when judging whether an acceptance item is testable.
---

ABOUTME: How an author writes a card's acceptance: one condition per item, testable without
asking the author, and bounded so that work outside it becomes its own card.

# Writing an acceptance

An acceptance states what done means. It is written before any work on the card starts
(`R-CARD-1`), by the card's author — the owner for a card the owner files, the decomposing
role for a card it produced (`R-CARD-3`).

After the card is admitted, only its author changes it. A maker never changes the acceptance
it is judged against (`R-CARD-5`), and every change is recorded with who made it (`R-CARD-6`).
A change costs: it sends every judge back and spends one of the card's rounds (`R-LOOP-8`),
and it stales every verdict already returned (`R-GATE-7`). Get it right before you file.

`D2` holds the choice this skill serves, and rule 2 of it holds where the acceptance lives: in
the issue body as plain bullets, not in a board field and never as a task list. `R-CARD-4`
obliges an author writing an acceptance to load the skill the consumer supplies for it; in this
repository that is this one.

## The one test

**A judge must be able to rule on the item without asking you.** That is `R-CARD-2`, and every
rule below is a way of passing it.

You will not be there when the card is judged. A judge that cannot rule on an item records it
unmet (`R-LOOP-5`), and a verdict leaving any item unmet is not sound (`R-VERDICT-4`). The maker
revises, that change spends one of the card's rounds (`R-LOOP-8`), and a card that exhausts its
rounds escalates as ambiguous (`R-LOOP-9`). An item only you can read is paid for in rounds.

## How to write an item that passes it

**Name the thing, and the observable fact about it.** The judge's ruling should be a reading,
not an opinion. These shapes read:

- a named path exists and states a named thing;
- a named command exits zero, or produces named output;
- a named input is refused, and the refusal names the reason;
- a named document cites a named id.

**Cut the words that hand the ruling back to you.** *Appropriate, clean, properly, robust,
comprehensive, reasonable, as needed, where necessary, good.* Each of these means "ask the
author". Name the condition the word stands for instead. If you cannot name it, you do not yet
know what you are asking for.

**One condition per item** (`R-CARD-2`). An `and` in an item usually hides two conditions, and
every judge records each item as met or unmet with nothing in between (`R-LOOP-5`). An item
that is half true has no ruling.

**Say what done means, never how to do it.** The maker chooses the mechanism. An item that
names one bars a better route and is not a statement about done.

**Bound the card.** Everything you are asking for goes in the acceptance. Work found outside it
becomes its own card rather than joining this one (`R-CARD-11`), and a follow-up may only cover
work outside it — an item left undone means the card is not done (`R-CARD-10`).

## A spike card

A spike card's acceptance states what a complete answer contains, never what the answer is
(`R-CARD-9`). Fixing the answer in advance is not a bar; it is the finding, and it makes the
spike unable to report the one thing it was dispatched to find out.

Write the shape of the report: which options it weighed, what it measured, what it recommends
and on what evidence, and what would reverse the recommendation.

## What is checked, and what is not

Two forms are refused at admission and nothing else is: a card with no acceptance is refused by
name and reason (`R-CARD-7`), and a card whose acceptance only restates the card's title is
refused (`R-CARD-8`). Those two are the whole of the check on an acceptance's form
(`R-CARD-8`).

So the bar being right is yours. `D2`'s notes say what that buys and what it does not: no check
proves an acceptance adequate, and a green marker is never a warranty that the card asked for
the right things. A judge rules on whether the acceptance covered what the card asked, and
returns the card to you with the reason rather than rewriting it (`R-LOOP-6`).

## Before you file

Read each item back and ask, in order:

1. Can a judge rule on this without asking me (`R-CARD-2`)?
2. Is it one condition (`R-CARD-2`)?
3. Does it say what done means rather than how to reach it?
4. Does the set cover everything this card is asking for (`R-CARD-10`, `R-CARD-11`)?
5. For a spike: does it describe a complete answer rather than the answer (`R-CARD-9`)?
