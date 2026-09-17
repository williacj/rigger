# Rigger

**Rigger is the engine that lets your AI agents deliver work you defined, to a standard you set,
while you do something else.** Agents pull cards from your board and do the work in isolation.
Different agents review it against a procedure you define, and nothing merges without their verdict.
A feature, writing a doc, website change or even deep analysis: the loop is the same.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/Status-pre--alpha-orange.svg)](#status)

It decides which of your cards to work on next, keeps the agent that made a change from being the
agent that approves it, and recognizes the decisions that are not its to make. Everything else it
finishes on its own, or stops and says why.

It is not a kanban UI where a person reviews every diff, and it is not a methodology plugin that
improves one agent's session. It runs with nobody watching, and the merge gate is enforced by a
hook, not by a prompt.

## Table of contents

- [Background](#background)
- [How it works](#how-it-works)
- [A piece of work, start to finish](#a-piece-of-work-start-to-finish)
- [The guarantee](#the-guarantee)
- [Security](#security)
- [Status](#status)
- [Prerequisites](#prerequisites)
- [Install and usage](#install-and-usage)
- [Configuration](#configuration)
- [Support](#support)
- [Architecture](#architecture)
- [What Rigger learns](#what-rigger-learns)
- [Telemetry](#telemetry)
- [Contributing](#contributing)
- [Maintainers](#maintainers)
- [License](#license)

## Background

One agent can do one task, and do it well. Doing it a hundred times, unattended, to a standard that
holds up, is a different problem. Something has to choose the next piece of work, isolate each piece of work,
get it reviewed by someone other than its author, merge it only when the review is fresh, and know
when to stop and ask. Rigger is that something.

## How it works

| | |
|---|---|
| **You describe, Rigger decomposes** | Work arrives as cards: you write them, a clock trigger creates them, or an intake role breaks a larger need down into cards and puts them on the board. Every card runs the same loop from there. |
| **The board is the truth** | A GitHub Projects v2 board holds every card and its column. Rigger reads it, moves cards, and keeps no workflow state of its own. If it stops mid-card, the restart re-reads the board and picks the card up again; half-finished work never merges. |
| **Every card carries its acceptance** | Before any work starts, a card states what done means, as items a judge can test. The maker finishes against that acceptance, each judge rules on every item in it, and a card carrying none is not admitted. |
| **One worktree per card** | Each card gets an isolated git worktree and a deterministic branch. Agents never share a checkout, so multiple cards run at once on a host, with the local git operations that need serializing serialized. |
| **One maker, one or more judges** | One agent produces the work and opens a pull request. One or more different agents, each in its own dispatch, review it against the card's acceptance and your procedure, and write a verdict bound to the exact head SHA. A new commit stales it, and so does a revised acceptance. |
| **The gate is mechanical** | A git hook refuses any merge that lacks a verdict fresh for both the head commit and the card's current acceptance. No prompt can talk it out of that. |
| **Escalates only what you must decide** | Everything else Rigger finishes. When a card needs a decision only you can make, Rigger escalates it with the reason and the evidence, and nothing proceeds until you answer. Rigger's own documents call you the **owner**. |

## A piece of work, start to finish

<!-- demo: docs/demo.tape, a vhs recording regenerated each release. Arrives with M1. -->

1. A piece of work starts as a **card**: an issue on your board. You write it, a clock trigger
   creates it, or an intake role breaks a larger need into several — ex. a product manager
   drafting requirements, judged by a designer and an architect, then by you. Whoever writes the
   card also writes its **acceptance** — what done means, as items a judge can test. Whatever its
   origin, it lands in **Ready**, in priority order.
2. Rigger claims it, creates a worktree on a branch derived from the card by a rule you set, and
   runs your
   provisioning steps. A step you marked required must succeed; an optional one that fails is
   logged, and the work proceeds.
3. The **maker** runs in that worktree, commits, and opens a pull request. The card moves to
   **Review**.
4. Each **judge** you configured for that kind of work runs in its own dispatch and reviews the
   pull request against the card's acceptance and your procedure. It posts its findings and writes
   a marker bound to the head SHA, holding its verdict and every acceptance item, met or unmet. A
   judge that finds the acceptance did not cover what the card asked returns the card to whoever
   wrote it, rather than rewriting the acceptance. Judges do not see each other's verdicts.
5. If any judge asks for changes, the maker revises and every judge reviews the new commit. That
   continues until every verdict is sound or the loop reaches its limit.
6. If you named yourself the last judge for this kind of work, you are asked now, and not before.
   When every verdict is sound and your CI is green, the gate admits the merge. The card moves to
   **Done**.
7. At any step, anything only you can decide is escalated to you with the reason and the evidence.
   The card moves to **Owner** and waits.

Every piece of work ends in one of three places: merged, escalated to you with the reason
attached, or back with whoever wrote the card, because its acceptance did not cover what the work
asked for.

## The guarantee

**The role that makes a thing never judges it.**

There is one maker and at least one judge, and no judge is the maker. Each judge runs in its own
dispatch, only judges write verdicts, every verdict binds to the exact commit it reviewed, and a
new commit stales all of them — as does a revised acceptance. When there is a panel, the merge
needs every judge's verdict.
No configuration removes that separation. An engine that could approve its own work would be a
faster way to merge mistakes.

The pairing is yours to name, and the same loop runs each one:

- an engineer and a code reviewer;
- a designer and a design reviewer;
- a spike engineer answering a question and a reviewer judging whether the writeup answers it;
- a writer and an editor;
- a product manager proposing requirements, judged by a designer and an architect, and then by
  you.

Sometimes the last judge is you. Where you named yourself last for a kind of work, the agent
judges rule first, so what reaches you has already been vetted.

## Security

Rigger merges code without a person in the loop, so this section is explicit.

**What Rigger does on its own:**

- creates cards on your board, from a clock trigger or from a role decomposing larger work;
- creates the board's columns, fields and labels, when you run `setup-board`;
- creates branches and worktrees, and runs the provisioning steps you configured;
- dispatches your agent CLI;
- opens and comments on pull requests, and merges the ones that pass the gate;
- files follow-up issues, and moves cards between columns;
- pushes the event stream to a data ref in your repository, if you turn that on.

**What Rigger never does:**

- approve its own work;
- merge without a verdict fresh for both the head commit and the card's acceptance;
- ratify a change to one of your recorded decisions;
- push to the default branch except through a gated merge;
- continue past an ambiguity it cannot resolve.

**Credentials.** Rigger stores none. It calls `gh` and your agent CLI, each authenticated by you,
and inherits exactly the permissions you gave them. Scope those permissions with each tool's own
settings.

**Agents run as you.** A maker or judge runs with your user's access to the machine and to the
repository. Rigger contains every process it starts and kills the whole tree on exit, but it
cannot make an agent more restricted than the account it runs under.

**Telemetry is yours.** See [Telemetry](#telemetry).

## Status

**Pre-alpha, built in the open.** Rigger is being built fresh in this repository. There have been
several private versions of Rigger to prove out the concept and identify key requirements.

Milestones, in order:

| | Milestone |
|---|---|
| M0 | Skeleton, agent assets, consumer contract |
| M1 | Board client and scheduler |
| M2 | Execution core |
| M3 | Worktrees and provisioning |
| M4 | Roles |
| M5 | Gate and merge |
| M6 | Escalation and infrastructure hold |
| M7 | Report complete, clock triggers |
| M8 | Acceptance on Emend |
| M9 | Object-level improvement loop |
| M10 | Meta-level improvement loop |

Emend is a separate project that is built using Rigger; M8 is where Rigger proves itself on a repository that is not
its own. Each milestone's exit test is in `docs/v0-build-plan.md`, which owns them. v0 is M0
through M8.
The improvement loops follow as M9 and M10. Not planned for v0: an adjudicator role and the
triage lane that routes to it, an architect role, conflict domains declared per card, resume,
multi-host coordination, and native Windows. `docs/spec/decisions.md` records each one and the
evidence that would bring it back.

## Prerequisites

- A GitHub repository with a Projects v2 board. `rigger setup-board` creates the columns, fields
  and labels.
- [`gh`](https://cli.github.com/), authenticated with access to that repository and board.
- One coding-agent CLI, authenticated. Claude Code is the shipped adapter; Codex is next.
- Node.js 20 or later.
- **macOS** today. **Windows** is planned through WSL2, pending a spike; native Windows is not in
  v0. Linux is untested as a host in its own right, though the WSL2 route runs on it.

## Install and usage

> Nothing is published yet. The commands below are the target interface. They become true as the
> milestones in [Status](#status) land, and the first milestone's exit test is that
> `rigger --help` lists exactly these verbs, in this order.

```bash
npx @williacj/rigger init          # write a starter config, fork the role templates
npx @williacj/rigger doctor        # check gh auth, agent CLI auth, Node, config, board fields
npx @williacj/rigger setup-board   # create the board columns, fields, and labels
npx @williacj/rigger plan          # show what the next run would pull, and what it refuses
npx @williacj/rigger once          # pull and finish one card, then exit
npx @williacj/rigger run           # run until the board drains
npx @williacj/rigger pause         # stop admitting new cards; in-flight cards finish
npx @williacj/rigger resume        # reopen admission
npx @williacj/rigger report        # derive the signals from the event stream
```

Elsewhere in this document the commands are written in short form; `rigger <verb>` means
`npx @williacj/rigger <verb>`.

Unattended runs on macOS use launchd, whose assets are part of the substrate Rigger ships.

## Configuration

One config file names the repository, the board, the column display names, the provider and model
tier per role, the concurrency, the worktree root, and the rule that derives a branch from a card.
It names the provisioning steps, each with the card labels that select it and whether the work
requires it. And for each kind of work it names one maker role, the judges that review it, and how
many review rounds that kind gets before a standing disagreement escalates — three by default. A
code change might have one judge. A requirements proposal might have three, with you last. Which
outcomes are yours to decide is also configuration. You choose from a fixed set of categories and
add none to it. The default is all three: a change to a recorded decision, a critical finding, and
an ambiguity no role could resolve. Scheduled work is declared the same way: a clock trigger
creates a card on your board, and that card goes through the loop like any other.
[`ARCHITECTURE.md`](ARCHITECTURE.md) lists every extension point; there are no others.

Almost every feature is optional. A project with a dozen roles and binding decision documents runs
the full set. A project with one command that checks its work runs the minimum, and an absent
block is a tested state, not a degraded one. The exception is acceptance: no card is admitted
without one. Role
prompts, the review skill, and the gate hook are forked into your repository by `rigger init` and
are yours from then on. Rigger ships them as templates and never reads them at runtime from the
package.

## Support

[GitHub Issues](https://github.com/williacj/rigger/issues) for bugs and questions. There is no
chat channel yet.

## Architecture

Rigger is eight layers, each with one job and one boundary: adapters at the bottom, you at the
top, and between them execution, workflow, scheduling, the roles and procedures you supply,
observation, and the improvement loops. A fault is handled at the lowest layer that can handle it,
so a card reaches you only through an escalation category you configured.

Three documents hold the rest, and they read in this order:

1. [`docs/spec/requirements.md`](docs/spec/requirements.md) — what must be true of Rigger.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the structure that satisfies them: what each layer
   decides, what it may never decide, what it emits, who may change it, and every extension point
   a consumer has.
3. [`docs/spec/decisions.md`](docs/spec/decisions.md) — what was chosen, why, and what would
   reverse it.

Read them before changing anything.

## What Rigger learns

Rigger measures from the first dispatch. How long work takes, how many review rounds each kind of
work needs, how often it escalates and why, how often a host fault interrupts it, and how well the
model tier matched the card. `rigger report` shows those signals per layer.

Two loops read the report. The first reorders and re-tiers your backlog from the evidence, using
a role you name. The second runs a retrospective and proposes changes: to your roles, your review
procedure, or to Rigger itself. Every proposal comes to you with the signal it would improve, and
a proposal against Rigger's core must also fit the size budget. Neither loop applies anything to
the engine on its own. The improvement loops land after v0; the measurement is there from day one.

## Telemetry

Rigger writes one JSONL event stream to your repository's state directory: dispatches, verdicts,
merges, escalations, holds, and every other layer's events. It is sent to nobody. If you turn it
on, Rigger also pushes that stream to a data ref in your own repository so it survives the machine.
Rigger makes no network calls except through `gh` and your agent CLI.

## Contributing

Rigger is not accepting pull requests during v0. Open an issue if you have found a bug or want
to discuss a direction. When contributions open, the process will be: discuss in an issue first,
then a PR that follows this repository's TDD and review rules.

**Developing Rigger.** Clone, `npm ci`, `npm test`. One rule specific to agent tooling: never run
Rigger against the checkout it is running from, and never point a consumer's worktree root inside
this package. An agent dispatched by Rigger can delete the runtime it is running under.

## Maintainers

[@williacj](https://github.com/williacj).

## License

MIT. See [LICENSE](LICENSE).
