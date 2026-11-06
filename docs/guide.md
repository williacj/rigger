<!-- ABOUTME: The operating guide: how a person sets up and runs Rigger, section by section, referring to
the documents that own each fact. -->

# Operating Rigger

This guide is how you operate Rigger, in the order you meet it. The [reference](reference.md) is
where you look a fact up, and each section here links to its matching section there. Neither page
owns a verb, a config key or a requirement: they link to [`README.md`](../README.md),
[`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/spec/requirements.md`](spec/requirements.md),
which do, and cite a requirement by its id.

## What Rigger is

[`README.md`](../README.md) owns what Rigger is and what it promises, from [How it
works](../README.md#how-it-works) to [The guarantee](../README.md#the-guarantee).
[`ARCHITECTURE.md`](../ARCHITECTURE.md#birds-eye) owns how it is built, and
[`docs/spec/requirements.md`](spec/requirements.md) owns what must be true of it. Short answers to
common questions are in the reference's [FAQ](reference.md#faq).

## How the loop works

A card moves through the board's columns in the order the "Engine settings" row of
[`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) names them; that row
has your config give each column a display name, so this guide calls each by its key.

1. **`ready`.** You write the card's acceptance, then put the card here. Rigger refuses a card with
   no acceptance ([`R-CARD-7`](spec/requirements.md)), or one whose acceptance only restates its
   title ([`R-CARD-8`](spec/requirements.md)). It pulls ready cards in priority order
   ([`R-SCHED-1`](spec/requirements.md)).
2. **`coding`.** Rigger claims the card and moves it here, keeping the board current as the card
   progresses ([`R-WORK-5`](spec/requirements.md)). One role makes the work, and the maker finishes
   against the acceptance ([`R-LOOP-1`](spec/requirements.md)).
3. **`review`.** The card moves here only once its maker has exited successfully and the forge holds
   an open pull request from the card's line of work ([`R-WORK-18`](spec/requirements.md)). Other
   roles judge it, and no judge is the maker ([`R-LOOP-3`](spec/requirements.md)). The agent judges
   rule without waiting for each other ([`R-LOOP-7`](spec/requirements.md)), and each rules on every
   acceptance item ([`R-LOOP-5`](spec/requirements.md)). A change to the work or to the acceptance
   sends every judge back and spends one round ([`R-LOOP-8`](spec/requirements.md)). The rounds each
   kind of work gets are bounded ([`R-LOOP-9`](spec/requirements.md)); what happens when they run
   out is in [Answering escalations](#answering-escalations).
4. **`owner`.** Where the card's kind of work names you as a judge, the card waits here for you, and
   you are asked only once every agent judge is satisfied ([`R-LOOP-11`](spec/requirements.md)). You
   post your verdict with [`rigger verdict`](../README.md#install-and-usage).
5. **`done`.** Work reaches the main line only through the gate
   ([`R-GATE-1`](spec/requirements.md)). The gate admits it only when every configured judge has
   returned a sound verdict, in the terms of the "Verdict vocabulary" row of [`ARCHITECTURE.md`,
   "Extension points"](../ARCHITECTURE.md#extension-points), on the work being merged, against the
   card's current acceptance, and the consumer's own checks have passed
   ([`R-GATE-4`](spec/requirements.md) to [`R-GATE-8`](spec/requirements.md)). Before Rigger moves
   the card here for its merged pull request, it removes the card's directories
   ([`R-WORK-35`](spec/requirements.md)).

What a verdict holds is in the reference's [marker vocabulary](reference.md#the-marker-vocabulary),
which links [`ARCHITECTURE.md`, "Markers"](../ARCHITECTURE.md#markers).

## Setup

What each verb below does is its line in [`README.md`](../README.md#install-and-usage); this section
gives only the steps, and what to check after each.

1. **Install Rigger** apart from the repository it will work on, since Rigger never runs against the
   source tree it is running from ([`R-SAFE-5`](spec/requirements.md)). Check that the copy you
   installed lies outside that repository, and that your machine meets the
   [prerequisites](../README.md#prerequisites).
2. **Run [`rigger init`](../README.md#install-and-usage)** in your repository, then edit the config.
   Check that your repository holds the config and the role prompts and skills it names: Rigger
   reads none of them from its own package at run time ([`R-SAFE-6`](spec/requirements.md)). The
   keys are in [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points), as the
   reference's [config keys](reference.md#config-keys) says.
3. **Run [`rigger setup-board`](../README.md#install-and-usage).** Check that the board's columns
   carry the display names your config gives them, as the "Engine settings" row of
   [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) declares them, and
   that the labels your kinds of work select by, in the form that table's "Kinds of work" row gives,
   exist in the repository.
4. **Run [`rigger doctor`](../README.md#install-and-usage).** Check that every line it prints
   passes. For a line that fails, see [Troubleshooting](#troubleshooting).

## Daily operation

You put cards in the `ready` column and set their priority, both declared in the "Engine settings"
row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points). Rigger pulls
ready cards in priority order ([`R-SCHED-1`](spec/requirements.md)), and runs no more at once than
the concurrency you set ([`R-SCHED-2`](spec/requirements.md)). A kind of work selects a card by its
labels ([`R-SCHED-13`](spec/requirements.md)). Rigger never pulls a card no kind selects, nor an
epic ([`R-SCHED-11`](spec/requirements.md)), and refuses one that two kinds select
([`R-SCHED-12`](spec/requirements.md)).

1. Run [`rigger plan`](../README.md#install-and-usage) before anything runs.
2. Run [`rigger once`](../README.md#install-and-usage) or
   [`rigger run`](../README.md#install-and-usage).
3. Read the outcome in three places:
   - **the board**, for the column each card is in now, since the board holds every card's workflow
     state ([`R-STATE-1`](spec/requirements.md)), as [How the loop works](#how-the-loop-works)
     follows it;
   - **the card's pull request**, for the work and each judge's marker on it, as [`ARCHITECTURE.md`,
     "Markers"](../ARCHITECTURE.md#markers) defines one;
   - **[`rigger report`](../README.md#install-and-usage)**, for the signals across cards.

A maker that exits successfully without an open pull request leaves its card where it was, and
Rigger names the card and why ([`R-WORK-18`](spec/requirements.md)). The verbs, in the
[README's](../README.md#install-and-usage) order, are in the reference's
[verbs](reference.md#verbs).

### Keeping hand work and the engine apart

While the launchd job is loaded ([Installing the launchd
job](../README.md#installing-the-launchd-job)), three things hold:

- **No Self-hosting card enters `ready`.** A card that changes a path [`AGENTS.md`,
  "Self-hosting"](../AGENTS.md#self-hosting) lists is never dispatched by the engine
  ([`D25`](spec/decisions.md) rule 5), so it does not wait in `ready` for it.
- **No hand dispatch takes a `ready` card that a kind of `rigger.config.mjs` selects.** The engine
  may pull that card at any moment, and at most one actor mutates a card's board state or its
  workspace at a time ([`R-WORK-2`](spec/requirements.md)).
- **The engine works the dedicated target clone, and no hand work happens there.** Keep the target
  and the worktree root that [`rigger once`](../README.md#install-and-usage) and
  [`rigger run`](../README.md#install-and-usage) use apart from the checkouts you work in by hand.

A card Rigger has not claimed is a new card whatever its column
([`R-SCHED-16`](spec/requirements.md)). [`pullOrder`](../src/scheduling/pull-order.mjs) offers L2
the cards in `ready`, `coding`, `review` and `owner`, and no card in another column. So a card you
work by hand stays out of `coding`, `review` and `owner` while the job is loaded
([`R-WORK-2`](spec/requirements.md)), as well as out of `ready`. Not every card in those columns is
pulled: L2 answers no action for a card no kind selects, for an epic, and for one carrying a label
Rigger fixes ([`ARCHITECTURE.md`, "Escalation"](../ARCHITECTURE.md#escalation)), and `pullOrder`
leaves out a card L2 ignores.

With no clock trigger declared, one `rigger run` does not stop after a pull: it settles each claim's
work and pulls again as a slot frees, and ends once the board drains
([`ARCHITECTURE.md`, "Triggers"](../ARCHITECTURE.md#triggers)). Within that process, [`ARCHITECTURE.md`,
"Failure model"](../ARCHITECTURE.md#failure-model) sets which actions it does not repeat, and which
it defers because their start could not be recorded. The next invocation, which launchd starts one
interval later ([`ARCHITECTURE.md`, "Supervising `run`"](../ARCHITECTURE.md#supervising-run)),
starts without that memory, so it may retry or take up what was deferred.

## Answering escalations

Every escalation is in one of the categories Rigger fixes, and a consumer adds none
([`R-ESCALATE-13`](spec/requirements.md)), as the "Escalation categories" row of [`ARCHITECTURE.md`,
"Extension points"](../ARCHITECTURE.md#extension-points) names them. The reference's [escalation
categories and destinations](reference.md#escalation-categories-and-destinations) says where they
are defined and where each one goes. When a card's rounds run out, the
loop escalates it in the category [`R-LOOP-9`](spec/requirements.md) names.

To answer the escalations waiting on you:

1. Find them on the board, and read each escalated card's current column and labels there, since the
   board holds every card's workflow state ([`R-STATE-1`](spec/requirements.md)). Each card carrying
   the escalation label, which [`ARCHITECTURE.md`, "Escalation"](../ARCHITECTURE.md#escalation)
   names, waits, and Rigger dispatches nothing for it, in any column, and escalates it no further,
   whoever added the label ([`R-ESCALATE-10`](spec/requirements.md)).
2. Make the decision the card asks of you, then remove the label [`ARCHITECTURE.md`,
   "Escalation"](../ARCHITECTURE.md#escalation) names from the card; Rigger reads the escalation as
   answered once that label is gone, and never removes it itself
   ([`R-ESCALATE-11`](spec/requirements.md); [`D27`](spec/decisions.md)).

A card carrying the label [`ARCHITECTURE.md`, "Escalation"](../ARCHITECTURE.md#escalation) names,
whose pull request the forge holds as merged, is the exception, which
[`R-WORK-35`](spec/requirements.md) answers ([`R-ESCALATE-10`](spec/requirements.md)).

An escalation to you reaches you in three writes, in this order, as [`ARCHITECTURE.md`,
"Escalation"](../ARCHITECTURE.md#escalation) sets out: a comment on the card's issue, the card's
move to your column, and the escalation label
([`R-ESCALATE-8`](spec/requirements.md)). The comment carries the card, the reason and the work as it
stands ([`R-ESCALATE-7`](spec/requirements.md)), and is on the issue, never on the pull request. Its
first line reads `Rigger escalates card #<number> to the owner (<category>).`, with the card's
number and the category filled in. Rigger never leaves the label on a card without that comment, and
a retried escalation may post the comment again, each copy naming the same category and reason
([`R-ESCALATE-9`](spec/requirements.md)).

Only an ambiguity a maker raised can reach a consumer's role instead of you, and then only where the
consumer named that role ([`R-ESCALATE-15`](spec/requirements.md)); the reference's [escalation
categories and destinations](reference.md#escalation-categories-and-destinations) says where each
category goes. Every escalation the loop raises, every recorded-decision change and every critical
comes to you.

A maker that cannot meet an acceptance item raises an escalation by writing one escalation note on
the card's issue and ending, as the "Escalation categories" row of [`ARCHITECTURE.md`, "Extension
points"](../ARCHITECTURE.md#extension-points) and [`ARCHITECTURE.md`,
"Escalation"](../ARCHITECTURE.md#escalation) say. Rigger then routes it to you or to the role, and
writes the comment above only for an escalation that comes to you.

## Running unattended

What each verb does on one invocation is its line in [`README.md`](../README.md#install-and-usage),
which the reference's [verbs](reference.md#verbs) links, not this page.

### Running under launchd

On macOS, install and load the job with the steps in [Installing the launchd
job](../README.md#installing-the-launchd-job); [`D28`](spec/decisions.md) records why launchd. The
job starts as soon as you load it, and launchd starts it again one interval after each run exits.
After a reboot it starts again at your next login, never at boot ([`ARCHITECTURE.md`, "Supervising
`run`"](../ARCHITECTURE.md#supervising-run); [`D28`](spec/decisions.md)).

To unload the job for good, run `launchctl bootout` for it, then remove its plist from
`~/Library/LaunchAgents/`, as [Installing the launchd
job](../README.md#installing-the-launchd-job) says.

### Pausing and resuming

[`rigger pause`](../README.md#install-and-usage) stops Rigger admitting new cards, and the cards
already running finish ([`R-SCHED-3`](spec/requirements.md)). [`rigger
resume`](../README.md#install-and-usage) reopens admission. [`rigger
doctor`](../README.md#install-and-usage) and [`rigger plan`](../README.md#install-and-usage) each
report a closed admission and name each closer.

### The hold and its status issue

When a card's environment failures close admission ([`R-FAIL-8`](spec/requirements.md)), Rigger opens
an issue titled `Rigger closed admission` in your column, naming the reason and the card
([`R-SCHED-20`](spec/requirements.md)). It carries the status label, which [`ARCHITECTURE.md`,
"Escalation"](../ARCHITECTURE.md#escalation) names. Where one is open already, Rigger comments on it
instead ([`R-SCHED-25`](spec/requirements.md)).

Clear the hold by running `rigger resume`, which also closes every open issue carrying that label
([`R-SCHED-24`](spec/requirements.md)), or by closing the status issue yourself. Closing the issue
never lifts your own `rigger pause`: only `rigger resume` does
([`R-SCHED-23`](spec/requirements.md)).

## Troubleshooting

[`rigger doctor`](../README.md#install-and-usage)'s line in `README.md` names each check it runs.
Where one fails, do this:

| Check | What you do |
|---|---|
| Node | Install the Node.js version the README's [prerequisites](../README.md#prerequisites) name. |
| gh auth | Sign in to GitHub's `gh` on the machine Rigger runs on. Rigger stores no credentials, and uses the ones you gave its tools ([`R-SAFE-1`](spec/requirements.md)). |
| agent CLI auth | Sign in to the agent CLI of each provider your roles name, with that CLI's own login ([`R-SAFE-1`](spec/requirements.md)). |
| config | Correct what the failure names. Rigger refuses a configuration naming anything it does not offer, and says what it refused ([`R-SCHED-10`](spec/requirements.md)). The keys are in [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points). |
| board reachability | Check that the repository, board and board owner your config names, as the "Engine settings" row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) declares them, are right, and that your `gh` login can read that board. |
| board columns | Make each column display name your config gives an option of the board's field that holds the columns, as the "Engine settings" row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) declares it. |
| board priority field | Give the board the priority field and options your config declares, in the form the "Engine settings" row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) gives. |
| board sharing | Remove from the board every issue or pull request of another repository. A board Rigger works holds none ([`R-WORK-8`](spec/requirements.md)). |
| gate check required | Provision the forge settings [What the owner provisions](../ARCHITECTURE.md#what-the-owner-provisions) lists. |
| admission | The line reports admission open, closed or unreadable ([`R-SCHED-17`](spec/requirements.md)). A closed admission passes and names each closer; run [`rigger resume`](../README.md#install-and-usage) to reopen it ([`R-SCHED-23`](spec/requirements.md)). An unreadable one fails and names each path and cause: remove or repair each path, then run `rigger resume`, which changes nothing while a closer is unreadable ([`ARCHITECTURE.md`, "Failure model"](../ARCHITECTURE.md#failure-model)). |
| launchd job | Check the loaded program path and exit timeout against [Installing the launchd job](../README.md#installing-the-launchd-job), then re-install the edited job with those steps. |

A card that seems stuck usually has one of these causes:

- **No acceptance, or one restating the title.** Refused ([`R-CARD-7`](spec/requirements.md),
  [`R-CARD-8`](spec/requirements.md)).
- **No kind selects it, or it is an epic.** Left on the board and not reported as refused
  ([`R-SCHED-11`](spec/requirements.md)).
- **Two kinds select it.** Refused, naming every kind ([`R-SCHED-12`](spec/requirements.md)).
- **Two labels select different tiers, or different providers, for one role.** Refused, naming the
  role and the labels ([`R-LOOP-13`](spec/requirements.md), [`R-LOOP-16`](spec/requirements.md)).
- **The forge already holds its line of work, or a merged pull request from it, when its work would
  start from the beginning.** Refused, naming what the forge holds
  ([`R-WORK-19`](spec/requirements.md)).
- **A directory at its workspace path that Rigger may not replace.** The attempt fails, naming the
  path, and nothing changes ([`R-WORK-13`](spec/requirements.md)).
- **It carries the escalation label** that [`ARCHITECTURE.md`,
  "Escalation"](../ARCHITECTURE.md#escalation) names. It waits for you, as [Answering
  escalations](#answering-escalations) says ([`R-ESCALATE-10`](spec/requirements.md)).

A card's current column and labels are on the board, which holds every card's workflow state
([`R-STATE-1`](spec/requirements.md)); what each column and label is declared as is in the "Engine
settings" and "Kinds of work" rows of [`ARCHITECTURE.md`, "Extension
points"](../ARCHITECTURE.md#extension-points) and in [`ARCHITECTURE.md`,
"Escalation"](../ARCHITECTURE.md#escalation), which the reference's [board columns and
labels](reference.md#board-columns-and-labels) links.
