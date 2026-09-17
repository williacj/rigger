ABOUTME: Repo-wide rules for every agent working in Rigger, whatever its role. Loaded into every
session, so it holds only what is true in every session.

# AGENTS.md

Rules for **every** session in this repository.

A dispatched session has a role, and its authority comes from that role's agent prompt; this file
never assigns one. Where a role prompt is narrower than a rule here, the role prompt wins for that
role.

A session with no agent prompt has no role and no narrowing: every rule here applies as written.
The operative difference is that the owner is present, so "ask the owner" means ask now and wait,
where a dispatched session parks the work with the reason and the evidence.

**Rule #1 — no self-granted exceptions.** Bending any rule here needs the owner's explicit
permission first.

## How we work

- **Simple beats clever. Right beats fast. Evidence beats assumption.**
- **Verify before you recommend.** "We should add X" is a claim about the current code. Read it
  first.
- **Build the smallest thing that covers today's behaviour.** No machinery for hypothetical
  futures. If you think generality will be needed later, say so and leave it out.
- **Say "I don't know" when it is true.** Speak up when you are missing something.
- **Never self-ratify, never review your own work, never merge it.** Proposer, ratifier and
  reviewer are three people. This holds in an interactive session too: if you did the work,
  dispatch an independent reviewer rather than reading it back to yourself.
- **Never delete or rewrite existing work without the owner's permission.** Ask unless you added
  it in this same piece of work, or your change orphaned it.
- **Finished means finished.** Every piece of work states what done means before it starts, and
  you finish against that. A follow-up issue may only cover what falls outside it. Anything inside
  it that you left undone means the work is not done, and a defect you introduced is never a
  follow-up. Finishing includes deleting what is obsolete and updating the references and the docs.
  If you cannot finish, say what is left and park the work — never close it.
- **Answer the question asked.** If the owner is asking rather than instructing, answer it and stop.
- **Honest disagreement beats fake consensus.** Call out bad ideas — the owner depends on it. Give a
  technical reason, or say it is intuition. If you are uncomfortable pushing back, say "Strange
  things are afoot at the Circle K."

## What binds

| Document | Authority | Cite as |
|---|---|---|
| `ARCHITECTURE.md` | Layers, boundaries, extension points, failure model, budgets, invariants | `L#`, extension point |
| `docs/spec/decisions.md` | Recorded decisions | `D#` |
| `README.md` | The CLI contract — the verb list is the spec | verb |
| `docs/v0-build-plan.md` | Order and exit tests, until v0 ships | `M#` |

Read `ARCHITECTURE.md`'s invariants before you change anything. They bind every layer; this file
states only what a session must do about them. Changing anything in the table above needs the
owner's agreement. A change to a recorded decision is written in the register; a change to the
others is written where it lives. Two documents in conflict, or a gap neither resolves, goes to
the owner — never to whoever noticed it.

## Documents own their facts

Every sentence takes one of three treatments: **own it** — intent, decisions, prohibitions;
**refer to it** — a fact owned elsewhere, written as a reference and never retyped; or **do not say
it** — neither owned nor referenceable. A binding document has no business asserting a line count
or a grep result. An unresolvable reference is a red build, exactly like a broken import.

Instruction files take the same split. This file holds what is true whatever you touch; a
directory's `AGENTS.md` holds what is true only in that directory; anything else takes the third
treatment.

## Before you start

`npm test` green before you begin. Red means stop: fix it, commit the fix on its own, then start
the work. Never commit or push with a failing suite, and never reach for `--no-verify` without
the owner's approval. `npm run` lists every script.

## Any role

- **Smallest reasonable change, shaped like what is already there.** Read how this repository
  handles the same kind of problem. Extend what it built — a module, a utility, a decision, a
  document — rather than adding a parallel one.
- **Never copy-paste — extract and import.** Rule of Three.
- **Every file opens with an `ABOUTME:` header** saying what it is, on as few lines as that takes.
  `README.md`, `CLAUDE.md`, `.gitignore` and `LICENSE` are exempt: the first two are the front door
  and an import, and the others are not ours to caption.
- **Name what a thing does, never its history.** No `New`, `Legacy`, `V2`, `enhanced`. Comments
  say what and why, never what changed.
- **Root cause only.** One hypothesis at a time, smallest test that discriminates. Never stack
  fixes.

## When you write code

- **TDD.** Failing test, then the minimal code, then refactor while green; load the
  `.claude/skills/tdd/` skill before the first test body. Spike cards are exempt: throwaway work in
  a gitignored spikes directory, never merged.
- **Every bug fix starts with the failing test.** Never delete a failing test — raise it with the
  owner.
- **No sleeps in tests.** Injectable clocks and condition-based waits.
- **Put code where `ARCHITECTURE.md` says it lives.** A need that fits no extension point is a
  design conversation, not a workaround.
- **Fail fast, log clearly, never log a secret.**

## When you write a decision

A delta to `ARCHITECTURE.md` or to `docs/spec/` is a **proposal**. It parks for the owner; you never
ratify your own. Allocate its id as the register says. Load the
`.claude/skills/spec-style/` skill before you write. Resolve the ambiguity inside the delta or
escalate it, never leave it for the implementer to guess.

## Ask the owner before

Ask before any of these.

- Any architectural decision, or contradicting a recorded one.
- Restructuring code, or adding backward compatibility.
- Choosing between approaches where the choice matters.
- Force-pushing, deleting a branch, or writing to an issue or pull request that is not your card's.
- Any time you do not understand the task.

Otherwise act autonomously and finish, including the obvious follow-ups.

## Review and merge

Every PR gets the `.claude/skills/code-review/` pass before merge, run by someone other than its
author. Review the branch diff **before** opening the PR: a later commit stales the verdict, on the
terms `ARCHITECTURE.md`'s invariants set. Never work around a hook — if a gate stops you,
review.

## Self-hosting

Rigger builds Rigger, so two rules have teeth here. **Never run Rigger from this checkout.** The
engine runs from a tarball installed outside the source tree, because an agent it dispatches can
delete the runtime it is running under. **The engine never merges a change to its own live gate,
config, or CLI entry point** — those cards are done by hand.

## Version control

Working by hand, create your own worktree; a dispatched session is already in one. The main
checkout is not a workspace. Branch for every piece of work; never commit to `main` without the
owner's permission. Commit atomically and often, with messages that say why. `git status` before
`git add -A`. Commit journal entries with the work that produced them.

## Pointers

- What each layer decides, and may never decide → `ARCHITECTURE.md`
- What is being built next, and its exit test → `docs/v0-build-plan.md`
- What we learned, and what failed → `docs/journal.md`
