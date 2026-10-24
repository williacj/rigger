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
[`docs/spec/requirements.md`](spec/requirements.md) owns what must be true of it. Short answers to
common questions are in the reference's [FAQ](reference.md#faq).

## How the loop works

A card moves through the board's columns in the order the "Engine settings" row of
[`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) names them. Your
config gives each its display name, so this guide calls each by its key.

1. **`ready`.** You put the card here, with its acceptance written before work starts. Rigger
   refuses a card with no acceptance (`R-CARD-7`), or one whose acceptance only restates its title
   (`R-CARD-8`). It pulls ready cards in priority order (`R-SCHED-1`).
2. **`coding`.** Rigger claims the card and moves it here, keeping the board current as the card
   progresses (`R-WORK-5`). One role makes the work, and the maker finishes against the
   acceptance (`R-LOOP-1`).
3. **`review`.** The card moves here only once its maker has exited successfully and the forge
   holds an open pull request from the card's line of work (`R-WORK-18`). Other roles judge it, and
   no judge is the maker (`R-LOOP-3`). The agent judges rule without waiting for each other
   (`R-LOOP-7`), and each rules on every acceptance item (`R-LOOP-5`). A change to the work or to
   the acceptance sends every judge back and spends one round (`R-LOOP-8`). While the maker
   revises, the card is back in `coding`. The rounds each kind of work gets are bounded
   (`R-LOOP-9`); what happens when they run out is in
   [Answering escalations](#answering-escalations).
4. **`owner`.** Where the card's kind of work names you as a judge, the card waits here for you,
   and you are asked only once every agent judge is satisfied (`R-LOOP-11`). You post your
   verdict with [`rigger verdict`](../README.md#install-and-usage).
5. **`done`.** Work reaches the main line only through the gate (`R-GATE-1`). The gate admits it
   only when every configured judge has returned a sound verdict on the work being merged, against
   the card's current acceptance, and the consumer's own checks have passed (`R-GATE-4` to
   `R-GATE-8`). Before Rigger moves the card here for its merged pull request, it removes the
   card's directories (`R-WORK-33`).

What a verdict holds is in the reference's
[marker vocabulary](reference.md#the-marker-vocabulary).

## Setup

What each verb below does is its line in [`README.md`](../README.md#install-and-usage); this
section gives only the steps, and what to check after each.

1. **Install Rigger** apart from the repository it will work on, since Rigger never runs against
   the source tree it is running from (`R-SAFE-5`). Check that the copy you installed lies outside
   that repository, and that your machine meets the
   [prerequisites](../README.md#prerequisites).
2. **Run [`rigger init`](../README.md#install-and-usage)** in your repository, then edit the
   config. Check that your repository holds the config and the role prompts and skills it names:
   Rigger reads none of them from its own package at run time (`R-SAFE-6`). The keys are in the
   reference's [config keys](reference.md#config-keys).
3. **Run [`rigger setup-board`](../README.md#install-and-usage).** Check that the board's columns
   carry the display names your config gives them, as the "Engine settings" row of
   [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) declares them,
   and that the labels your kinds of work select by exist in the repository.
4. **Run [`rigger doctor`](../README.md#install-and-usage).** Check that every line it prints
   passes. For a line that fails, see [Troubleshooting](#troubleshooting).

## Daily operation

You put cards in the `ready` column and set their priority. Rigger pulls ready cards in priority
order (`R-SCHED-1`), and runs no more at once than the concurrency you set (`R-SCHED-2`). A kind
of work selects a card by its labels (`R-SCHED-13`). Rigger never pulls a card no kind selects,
nor an epic (`R-SCHED-11`), and refuses one that two kinds select (`R-SCHED-12`).

1. Run [`rigger plan`](../README.md#install-and-usage) before anything runs.
2. Run [`rigger once`](../README.md#install-and-usage) or
   [`rigger run`](../README.md#install-and-usage).
3. Read the outcome in three places:
   - **the board**, for the column each card is in, as [How the loop works](#how-the-loop-works)
     follows it;
   - **the card's pull request**, for the work and each judge's verdict on it;
   - **[`rigger report`](../README.md#install-and-usage)**, for the signals across cards.

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
escalates it no further, whoever added the label (`R-ESCALATE-10`). A labelled card whose pull
request the forge holds as merged is the exception, which `R-WORK-33` answers (`R-ESCALATE-10`).

You answer an escalation by removing the label (`R-ESCALATE-11`; `D27`). Rigger reads the
escalation as answered once the label is gone, and never removes the label itself
(`R-ESCALATE-11`).

> **Placeholder.** The owner operation: how an escalation reaches you, with its comment on the
> card's issue, the move to the owner's column and the label. Written by M6-D2, from M6-04 and
> M6-05.

## Running unattended

What each verb does on one invocation is its line in the reference's
[verbs](reference.md#verbs), not this page.

> **Placeholder.** Running under launchd, [`pause` and `resume`](../README.md#install-and-usage),
> and the hold and its status issue, with how to clear it. Written by M6-D2, from M6-12a, M6-12b,
> M6-09, M6-08b, M6-11a and M6-11c.

## Troubleshooting

[`rigger doctor`](../README.md#install-and-usage)'s line in `README.md` names each check it runs.
Where one fails, do this:

| Check | What you do |
|---|---|
| Node | Install the Node.js version the README's [prerequisites](../README.md#prerequisites) name. |
| gh auth | Sign in to GitHub's `gh` on the machine Rigger runs on. Rigger stores no credentials, and uses the ones you gave its tools (`R-SAFE-1`). |
| agent CLI auth | Sign in to the agent CLI of each provider your roles name, with that CLI's own login (`R-SAFE-1`). |
| config | Correct what the failure names. Rigger refuses a configuration naming anything it does not offer, and says what it refused (`R-SCHED-10`). The keys are in the reference's [config keys](reference.md#config-keys). |
| board reachability | Check that the repository, board and board owner your config names are right, and that your `gh` login can read that board. |
| board columns | Make each column display name your config gives an option of the board's field that holds the columns, as the "Engine settings" row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) declares it. |
| board priority field | Give the board the priority field and options your config declares, in the form the same row gives. |
| board sharing | Remove from the board every issue or pull request of another repository. A board Rigger works holds none (`R-WORK-8`). |
| gate check required | Provision the forge settings [What the owner provisions](../ARCHITECTURE.md#what-the-owner-provisions) lists. |

A card that seems stuck usually has one of these causes:

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
