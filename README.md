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
- [Requirements](#requirements)
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
holds up, is a different problem. Something has to choose the next card, isolate each piece of work,
get it reviewed by someone other than its author, merge it only when the review is fresh, and know
when to stop and ask. Rigger is that something.

## How it works

| | |
|---|---|
| **You describe, Rigger decomposes** | Work arrives as cards: you write them, a clock trigger creates them, or an intake role breaks a larger need down into cards and puts them on the board. Every card runs the same loop from there. |
| **The board is the truth** | A GitHub Projects v2 board holds every card and its column. Rigger reads it, moves cards, and keeps no workflow state of its own. If it stops mid-card, the restart re-reads the board and picks the card up again; half-finished work never merges. |
| **One worktree per card** | Each card gets an isolated git worktree and a deterministic branch. Agents never share a checkout, so multiple cards run at once on a host, with the local git operations that need serializing serialized. |
| **One maker, one or more judges** | One agent produces the work and opens a pull request. One or more different agents, each in its own dispatch, review it against your procedure and write a verdict bound to the exact head SHA. A new commit invalidates it. |
| **The gate is mechanical** | A git hook refuses any merge that lacks a fresh verdict for the head. No prompt can talk it out of that. |
| **Escalates only what you must decide** | Everything else Rigger finishes. When a card needs a decision or direction from you, it is set aside with the reason and the evidence, and nothing proceeds until you answer. |

## A piece of work, start to finish

<!-- demo: docs/demo.tape, a vhs recording regenerated each release. Arrives with M1. -->

1. A piece of work is an issue on your board, a card. You write it, a clock trigger creates it, or
   an intake role breaks a larger piece of work into multiple cards — ex. a product manager
   drafting requirements, judged by a designer and an architect, then by you. Whatever its origin,
   it lands in **Ready**, in priority order.
2. Rigger claims it, creates a worktree on a branch derived from the issue number, and runs your
   provisioning steps. A failed step is logged; the work proceeds.
3. The **maker** runs in that worktree, commits, and opens a pull request. The card moves to
   **Review**.
4. Each **judge** you configured for that kind of work runs in its own dispatch, reviews the pull
   request against your procedure, posts its findings, and writes a verdict bound to the head SHA.
   Judges do not see each other's verdicts.
5. If any judge asks for changes, the maker revises and every judge reviews the new commit. That
   continues until every verdict is sound or the loop reaches its limit.
6. If you named yourself the last judge for this kind of work, you are asked now, and not before.
   When every verdict is sound and your CI is green, the gate admits the merge. The card moves to
   **Done**.
7. At any step, anything only you can decide sets the work aside for you with the reason and the
   evidence.

Every piece of work ends in one of two places: merged, or waiting on you with the reason attached.

## The guarantee

**The role that makes a thing never judges it.**

There is one maker and at least one judge, and no judge is the maker. Each judge runs in its own
dispatch, only judges write verdicts, every verdict binds to the exact commit it reviewed, and a
new commit invalidates all of them. When there is a panel, the merge needs every judge's verdict.
No configuration removes that separation. An engine that could approve its own work would be a
faster way to merge mistakes.

The pairing is yours to name, and the same loop runs each one:

- an engineer and a code reviewer;
- a designer and a design reviewer;
- a spike engineer answering a question and a reviewer judging whether the writeup answers it;
- a writer and an editor;
- a product manager proposing requirements, judged by a second product manager, a designer, and
  an architect, and then by you.

Sometimes the last judge is you. A change to one of your recorded decisions reaches you only after
the agent judges are satisfied, so what you read has already been vetted.

## Security

Rigger merges code without a person in the loop, so this section is explicit.

**What Rigger does on its own:** creates branches and worktrees, runs the provisioning steps you
configured, dispatches your agent CLI, opens and comments on pull requests, moves cards between
columns, and merges pull requests that pass the gate.

**What Rigger never does:** approve its own work, merge without a fresh SHA-bound verdict, ratify a
change to one of your recorded decisions, push to the default branch except through a gated merge,
or continue past an ambiguity it cannot resolve.

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

| | Milestone | Done when |
|---|---|---|
| M0 | Skeleton, agent assets, consumer contract | `rigger --help`, `init`, and `doctor` work; the config validator rejects a missing key |
| M1 | Board client and scheduler | A fake board drives pull, complete, and cold restart with no persisted state |
| M2 | Execution core | A lingering grandchild is killed and named; SIGKILL then restart kills the recorded group |
| M3 | Worktrees and provisioning | Steps come from config; a failed step logs and the card proceeds |
| M4 | Roles | A real maker opens a PR; a real judge writes a verdict |
| M5 | Gate and merge | A stale marker blocks; a fresh one merges; two finalizations serialize |
| M6 | Escalation and infrastructure hold | Six identical host failures yield two attempts, one hold, zero escalations |
| M7 | Report complete, clock triggers | Every layer reports; scheduled work creates cards |
| M8 | Acceptance on emend | A thirty-card window with zero infrastructure-caused escalations; first tagged release |
| M9 | Object-level improvement loop | The backlog is reordered from evidence, every move with its signal |
| M10 | Meta-level improvement loop | Proposals against any layer, each with its signal, none self-applied |

v0 is M0 through M8. The improvement loops follow as M9 and M10. Not planned for v0: the triage
and ratifier lanes, a Slack surface, native Windows. Each arrives as a capability block, if at all.

## Requirements

- A GitHub repository with a Projects v2 board. `rigger setup-board` creates the columns and
  fields.
- [`gh`](https://cli.github.com/), authenticated with access to that repository and board.
- One coding-agent CLI, authenticated. Claude Code and OpenAI Codex the current supported adapters.
- Node.js 20 or later.
- **macOS** today. Linux is expected to work but initially will be untested. **Windows** is
  planned through WSL2, pending a spike; native Windows is not in v0.

## Install and usage

> Nothing is published yet. The commands below are the target interface. They become true as the
> milestones in [Status](#status) land, and the first milestone's acceptance test is that
> `rigger --help` lists exactly these verbs.

```bash
npx @williacj/rigger init          # write a starter config and fork the role templates into .rigger/
npx @williacj/rigger doctor        # check gh auth, agent CLI auth, Node, config, board fields
npx @williacj/rigger setup-board   # create the board columns, fields, and labels
npx @williacj/rigger plan          # show what the next run would pull, in order
npx @williacj/rigger once          # pull and finish one card, then exit
npx @williacj/rigger run           # run until the board drains
npx @williacj/rigger pause         # stop admitting new cards; in-flight cards finish
npx @williacj/rigger resume        # reopen admission
```

Elsewhere in this document the commands are written in short form; `rigger <verb>` means
`npx @williacj/rigger <verb>`.

Unattended runs on macOS use launchd; the plist and the start and stop skills ship with the
package.

## Configuration

One config file names the repository, the board, the column display names, the provider per role,
the concurrency, the provisioning steps with the card labels that select each one, and, for each
kind of work, one maker role and the judges that review it. A code change might have one judge. A
requirements proposal might have three, with you last. Which outcomes are yours to decide is also
configuration; the default set is a change to a recorded decision, a critical finding, and
ambiguity. Scheduled work is declared the same way: a clock trigger creates a card on your board,
and that card goes through the loop like any other. [`ARCHITECTURE.md`](ARCHITECTURE.md) lists every
extension point; there are no others.

Every feature beyond the core is a capability block you switch on. A project with a dozen roles
and binding decision documents runs the full set. A project with one command that checks its
work runs the core and nothing else, and an absent block is a tested state, not a degraded one. Role
prompts, the review skill, and the gate hook are forked into your repository by `rigger init` and
are yours from then on. Rigger ships them as templates and never reads them at runtime from the
package.

## Support

[GitHub Issues](https://github.com/williacj/rigger/issues) for bugs and questions. There is no
chat channel yet.

## Architecture

Rigger is eight layers, each with one job and one boundary. From the bottom: **substrate**
adapters for GitHub, git, the operating system, and each agent CLI; **execution**, which runs one
dispatch in one workspace and returns an exit code; **workflow**, the state machine that decides
what happens to a card; **scheduling**, which decides which card and when; **quality**, your
roles, procedures, and kinds of work, living in your repository rather than in Rigger;
**observation**, the event stream and the report; **improvement**, the two loops; and **you**.

The core is execution plus the substrate's process adapter: the code that owns every process
Rigger starts. It is the smallest layer and carries the tightest size budget, enforced in CI,
because it is the layer where a bug means a stray process or a lost result. Everything above it is
rules, and rules are cheap to test.

Three rules shape the core. A command's result is its exit code and captured output; a stray
process is killed and logged and never changes the answer. Rigger keeps no in-flight state: if it
dies mid-card, the restart redoes the card from its column, and recovery machinery is added only
after a production incident proves redo was insufficient. And a fault is handled at the lowest
layer that can handle it, so a card reaches you only through workflow's escalation categories,
never through a substrate event.

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the map: what each layer decides, what it may never
decide, what it emits, who may change it, and every extension point a consumer has. Read it before
changing anything.

## What Rigger learns

Rigger measures from the first dispatch: how long work takes, how many review rounds each kind of
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
