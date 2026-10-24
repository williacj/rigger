<!-- ABOUTME: The operating guide: how a person sets up and runs Rigger, section by section, referring to
the documents that own each fact. -->

# Operating Rigger

This guide is how you operate Rigger, in the order you meet it. The [reference](reference.md) is
where you look a fact up, and each section here links to its matching section there. Neither page
owns a verb, a config key or a requirement: they link to [`README.md`](../README.md),
[`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/spec/requirements.md`](spec/requirements.md),
which do, and cite a requirement by its id. A part marked **Placeholder** is behaviour a later card
writes; it names that card.

## What Rigger is

[`README.md`](../README.md) owns what Rigger is and what it promises, from
[How it works](../README.md#how-it-works) to [The guarantee](../README.md#the-guarantee).
[`ARCHITECTURE.md`](../ARCHITECTURE.md#birds-eye) owns how it is built, and
[`docs/spec/requirements.md`](spec/requirements.md) owns what must be true of it. Short answers to common
questions are in the reference's [FAQ](reference.md#faq).

## How the loop works

A card states its acceptance before work starts, and Rigger refuses a card with none
(`R-CARD-7`) or one whose acceptance only restates its title (`R-CARD-8`). One role makes the
work, and the maker finishes against that acceptance (`R-LOOP-1`). Other roles judge it, and no
judge is the maker (`R-LOOP-3`). The agent judges rule without waiting for each other
(`R-LOOP-7`), and each rules on every acceptance item (`R-LOOP-5`).

A change to the work or to the acceptance sends every judge back, and spends one round
(`R-LOOP-8`). The rounds each kind of work gets are bounded (`R-LOOP-9`); what happens when they
run out is in [Answering escalations](#answering-escalations).

Work reaches the main line only through the gate (`R-GATE-1`). The gate admits it only when every
configured judge has returned a sound verdict on the work being merged, against the card's current
acceptance, and the consumer's own checks have passed (`R-GATE-4` to `R-GATE-8`). Where a kind of
work names you as a judge, you judge last (`R-LOOP-11`). You post your verdict with
`rigger verdict`, and it posts only once you confirm the whole verdict it shows you
(`R-VERDICT-8`, `R-VERDICT-9`). What a verdict holds is in the reference's
[marker vocabulary](reference.md#the-marker-vocabulary).

## Setup

1. Meet the [prerequisites](../README.md#prerequisites).
2. Install Rigger apart from the repository it will work on, since Rigger never runs against the
   source tree it is running from (`R-SAFE-5`).
3. Run `rigger init` in your repository. The role prompts and skills you use then live in your
   repository, and Rigger reads none of them from its own package at run time (`R-SAFE-6`).
4. Edit the config. The keys and their shapes are in the reference's
   [config keys](reference.md#config-keys); Rigger refuses a configuration naming anything it does
   not offer, and says what it refused (`R-SCHED-10`).
5. Run `rigger setup-board`.
6. Provision the forge settings the gate needs, as
   [What the owner provisions](../ARCHITECTURE.md#what-the-owner-provisions) lists them.
7. Run `rigger doctor` until it passes.

What each of these verbs does is its line in [`README.md`](../README.md#install-and-usage).

## Daily operation

You put cards in the ready column your config names, and set their priority. Rigger pulls ready
cards in priority order (`R-SCHED-1`), and runs no more at once than the concurrency you set
(`R-SCHED-2`). A kind of work selects a card by its labels (`R-SCHED-13`). Rigger never pulls a
card no kind selects, nor an epic (`R-SCHED-11`), and refuses one that two kinds select
(`R-SCHED-12`).

1. Run `rigger plan` before anything runs.
2. Run `rigger once` or `rigger run`.
3. Run `rigger report` afterwards.
4. Post your verdict with `rigger verdict` where a card waits on you, as
   [How the loop works](#how-the-loop-works) says.

What each verb does is its line in [`README.md`](../README.md#install-and-usage), not this page.

A maker that exits successfully without an open pull request leaves its card where it was, and
Rigger names the card and why (`R-WORK-18`). The verbs, in the README's order, are in the
reference's [verbs](reference.md#verbs).

> **Placeholder.** Keeping hand work and the engine apart (Q10's rule). Written by M6-D2, from
> M6-15.

## Answering escalations

Every escalation is in one of the categories Rigger fixes, and a consumer adds none
(`R-ESCALATE-13`). The reference's
[escalation categories and destinations](reference.md#escalation-categories-and-destinations)
says where they are defined, and where each one goes is still a placeholder there. When a card's
rounds run out, the loop escalates it as ambiguous (`R-LOOP-9`).

A card carrying the escalation label waits: Rigger dispatches nothing for it, in any column, and
escalates it no further, whoever added the label (`R-ESCALATE-10`). `rigger plan` names such a
card as escalated, never as refused (`R-ESCALATE-10`). A labelled card whose pull request the
forge holds as merged is the exception, which `R-WORK-33` answers (`R-ESCALATE-10`).

You answer an escalation by removing the label (`R-ESCALATE-11`; `D27`). Rigger reads the
escalation as answered once the label is gone, and never removes the label itself
(`R-ESCALATE-11`).

> **Placeholder.** The owner operation: how an escalation reaches you, with its comment on the
> card's issue, the move to the owner's column and the label. Written by M6-D2, from M6-04 and
> M6-05.

## Running unattended

What `rigger run` does on each invocation is its line in the reference's
[verbs](reference.md#verbs), not this page.

> **Placeholder.** Running under launchd, `pause` and `resume`, and the hold and its status issue,
> with how to clear it. Written by M6-D2, from M6-12a, M6-12b, M6-09, M6-08b, M6-11a and M6-11c.

## Troubleshooting

Start with `rigger doctor`, then `rigger plan`; what each checks or shows is its line in the
README's [verb list](../README.md#install-and-usage). A card that seems stuck usually has one of these causes:

- **No acceptance, or one restating the title.** Refused (`R-CARD-7`, `R-CARD-8`).
- **No kind selects it, or it is an epic.** Left on the board and not reported as refused
  (`R-SCHED-11`).
- **Two kinds select it.** Refused, naming every kind (`R-SCHED-12`).
- **Two labels select different tiers, or different providers, for one role.** Refused, naming
  the role and the labels (`R-LOOP-13`, `R-LOOP-16`).
- **The forge already holds its line of work, or a merged pull request from it, when its work
  would start from the beginning.** Refused, naming what the forge holds (`R-WORK-19`).
- **A directory at its workspace path that Rigger may not replace.** The attempt fails, naming the
  path, and nothing changes (`R-WORK-13`).
- **It carries the escalation label.** It waits for you, as
  [Answering escalations](#answering-escalations) says (`R-ESCALATE-10`).

Which column a card is in, and which labels it carries, are in the reference's
[board columns and labels](reference.md#board-columns-and-labels).
