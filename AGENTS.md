ABOUTME: Repo-wide rules for every agent working in Rigger, whatever its role. Loaded into
every session, so it holds only what is true in every session.

# AGENTS.md

Rules for **every** session in this repository.

A dispatched session has a role, and its authority comes from that role's agent prompt; this
file never assigns one. Where a role prompt is narrower than a rule here, the role prompt wins
for that role.

A session with no agent prompt has no role and no narrowing: every rule here applies as
written. The operative difference is that the owner is present, so "ask the owner" means ask
now and wait, where a dispatched session escalates, leaving the card with the reason and the
work as it stands.

**Rule #1 — no self-granted exceptions.** Bending any rule here needs the owner's explicit
permission first.

## How we work

- **Simple beats clever. Right beats fast. Evidence beats assumption.**
- **Verify before you recommend.** "We should add X" is a claim about the current code. Read it
  first.
- **Build the smallest thing that covers today's behaviour.** No machinery for hypothetical
  futures. If you think generality will be needed later, say so and leave it out.
- **Say "I don't know" when it is true.** Speak up when you are missing something.
- **Never self-ratify, never review your own work, and merge your own work only where "Review
  and merge" permits it.** Proposer, ratifier and reviewer are three people. This holds in an
  interactive session too: if you did the work, dispatch an independent reviewer rather than
  reading it back to yourself.
- **Never delete or rewrite existing work without the owner's permission.** Ask unless you
  added it in this same piece of work, or your change orphaned it.
- **Finished means finished.** Every piece of work states what done means before it starts, and
  you finish against that. A follow-up issue may only cover what falls outside it. Anything
  inside it that you left undone means the work is not done, and a defect you introduced is
  never a follow-up. Finishing includes deleting what is obsolete and updating the references
  and the docs. If you cannot finish, say what is left and leave the card open. Where you are
  making the thing, escalate it. Name which of three categories it is, because that is how the
  engine routes it: `recorded-decision` for a change to a decision the owner recorded,
  `critical` for a fault that must not merge, `ambiguous` for a question no role could resolve.
  Where you are judging it, you return a verdict and never an escalation; the loop raises one
  if your verdict calls for it.
- **Write the acceptance before the work.** A card states what done means before anything
  starts, and whoever files it writes that, loading the acceptance skill first. Only its author
  changes it afterwards — never the maker, who is judged against it. Work you find outside it
  becomes its own card, with its own acceptance.
- **Answer the question asked.** If the owner is asking rather than instructing, answer it and
  stop.
- **Honest disagreement beats fake consensus.** Call out bad ideas — the owner depends on it.
  Give a technical reason, or say it is intuition. If you are uncomfortable pushing back, say
  "Strange things are afoot at the Circle K."
- **Write to be acted on.** A paragraph states one thing: what to do, a fact needed to do it,
  or — in the decision register and the journal — the reasoning those documents exist to hold.
  A paragraph doing two of those is split. Where a passage is a set a reader looks one thing up
  in, write it as a list or a table; where it is an argument, write it as prose, because a list
  asserts its items are independent.

## What binds

The first four read in this order, and the order is the argument: what Rigger promises, what
must be true of it, the structure that satisfies that, and the choices made along the way.
Reading them out of order costs you, because each is written in the vocabulary the one before
it established.

| Document | Authority | Cite as |
|---|---|---|
| `README.md` | The CLI contract — the verb list is the spec | verb |
| `docs/spec/requirements.md` | What must be true, grouped by subject | `R-GROUP-#` |
| `ARCHITECTURE.md` | The structure that satisfies them — everything in it | `L#`, extension point, section |
| `docs/spec/decisions.md` | What was chosen, and what would reverse it | `D#` |
| `docs/v0-build-plan.md` | Order and exit tests, until v0 ships | `M#` |
| `docs/spec/requirements-retired.md` | Withdrawn requirements. Binds nothing; keeps their ids allocated | `R-GROUP-#` |
| `docs/spec/decisions-retired.md` | Superseded decisions. Binds nothing; kept for the reasoning | `D#` |
| `docs/derived/test-matrix.md` | Which tests prove which requirement. Generated; never hand-edited | `R-GROUP-#` |
| `AGENTS.md` | Rules for every session in this repository | section |

Where a requirement and the architecture disagree, the requirement is right. This file states
only what a session must do about any of them. Changing an authored document in the table above
needs the owner's agreement. The generated one is not edited at all — it regenerates, and a
hand edit there is a lint failure rather than an argument (D8). A change to a recorded decision
is written in the register; a change to the others is written where it lives. Two documents in
conflict, or a gap neither resolves, goes to the owner — never to whoever noticed it.

## Documents own their facts

Every sentence takes one of three treatments: **own it** — intent, decisions, prohibitions;
**refer to it** — a fact owned elsewhere, written as a reference and never retyped; or **do not
say it** — neither owned nor referenceable. A binding document has no business asserting a line
count or a grep result. An unresolvable reference reds the build wherever the resolver is set
strict, exactly like a broken import.

A citation is a claim about its source, so open the source where it lives as you write the
citation down. A reference can resolve while the claim attached to it is invented, so the
resolver passing is no evidence the citation is sound. An unverified citation reaches the maker
as an instruction rather than a doubt, and `R-LOOP-1` has them build against it.

When a session asserts a figure in prose, it says whether the figure is a measurement or a
judgment. A measured figure names the tool or source that produced it, the ref or date and scope
measured, and the result. A claim about the present state is measured on the state it describes.
A historical figure names its historical state. A judgment names its premise and is not dressed
as a measurement.

Instruction files take the same split. This file holds what is true whatever you touch; a
directory's `AGENTS.md` holds what is true only in that directory; anything else takes the
third treatment.

## Before you start

`npm test` green before you begin. Red means stop: fix it, commit the fix on its own, then
start the work. Never commit or push with a failing suite, and never reach for `--no-verify`
without the owner's approval. `npm run` lists every script.

## Any role

- **Smallest reasonable change, shaped like what is already there.** Read how this repository
  handles the same kind of problem. Extend what it built — a module, a utility, a decision, a
  document — rather than adding a parallel one.
- **Never copy-paste — extract and import.** Rule of Three.
- **Every file opens with an `ABOUTME:` header** saying what it is, on as few lines as that
  takes. The prefix appears once, on the first line; a continuation line carries whatever
  comment marker its format needs and no prefix. Where the format reserves the first line — a
  shebang, YAML frontmatter — the header goes on the line below it, or below the block that
  line opens. A format with no comment syntax to carry one is exempt, which in this repository
  means JSON. `README.md`, `CLAUDE.md`, `.gitignore` and `LICENSE` are exempt as well: the first
  two are the front door and an import, and the others are not ours to caption.
- **Name what a thing does, never its history.** No `New`, `Legacy`, `V2`, `enhanced`. Comments
  say what and why, never what changed.
- **Root cause only.** One hypothesis at a time, smallest test that discriminates. Never stack
  fixes.

## When you write code

- **TDD.** Failing test, then the minimal code, then refactor while green; load the
  `.claude/skills/tdd/` skill before the first test body. Spike cards are exempt: throwaway
  work in a gitignored spikes directory, never merged.
- **Every bug fix starts with the failing test.** Never delete a failing test — raise it with
  the owner.
- **No sleeps in tests.** Injectable clocks and condition-based waits.
- **Put code where `ARCHITECTURE.md` says it lives.** A need that fits no extension point goes
  to the architect (`D18` rule 2), not into a workaround.
- **Fail fast, log clearly, never log a secret.**

## When you write a decision or a requirement

`D18` rule 1 has the architect propose every delta to `ARCHITECTURE.md`, and rule 7 has the PM
propose a requirement. A delta to `ARCHITECTURE.md` or to `docs/spec/` is a **proposal** whoever
wrote it: it goes to the owner, and you never ratify your own. A choice and what would reverse
it is a decision; what must be true as a result is a requirement. Allocate its id as its own
register says: neither reuses one, a retired id stays allocated, and a decision's row stays
behind where a requirement's row leaves. A new requirement needs a test that claims it; a judge
enforces this (`D17` rules 1 and 7). Load the `.claude/skills/spec-style/` skill before you
write. Resolve the ambiguity inside the delta or escalate it, never leave it for the implementer
to guess.

## Ask the owner before

Ask before any of these.

- Any architectural decision `D18` does not give the architect, or contradicting a recorded one.
- Restructuring code, or adding backward compatibility.
- Choosing between approaches where the choice matters.
- Force-pushing, deleting a branch, or writing to an issue or pull request that is not your
  card's.
- Any time you do not understand the task.

Otherwise act autonomously and finish, including the obvious follow-ups.

## Review and merge

Every PR gets the `.claude/skills/code-review/` pass before merge, run by someone other than
its author. Dispatch the reviewer once the branch is ready, not once it is perfect: a later
commit stales the verdict, and so does a revised acceptance (`R-GATE-7`), so every extra commit
costs a round. Never work around a hook — if a gate stops you, review.

A judge rules on every acceptance item and records each met or unmet, rules on whether the
acceptance covered what the card asked, and returns the card to its author rather than
rewriting it. Its verdict goes in a marker bound to the work it read. From M5 the gate reads
those markers against the card's judge list, and admits nothing until the consumer's own checks
have passed too.

Until M5, a maker merges its own card once `R-GATE-4`'s evidence is in hand, and never
otherwise. The permission reaches the merge alone: every verdict in that evidence is another
role's. `D19` records it and what ends it.

## Self-hosting

Rigger builds Rigger, so two rules have teeth here. **Never run Rigger from this checkout**
(`R-SAFE-5`). The engine runs from a tarball installed outside the source tree, because an
agent it dispatches can delete the runtime it is running under. `npm link` does not satisfy
this, and the worktree root belongs outside both the checkout and the package. **The engine
never merges a change to its own live gate, config, or CLI entry point**, and never dispatches a
card that makes one. `D19`'s permission, under "Review and merge", reaches a card changing any
path listed below, on the same evidence as any other card. Those three, by path:

- The live gate: `.githooks/`.
- The live config: `rigger.config.mjs`, and `templates/rigger.config.mjs` with it.
- The CLI entry point: `src/cli/rigger.mjs`, which `package.json` declares as its `bin`.

The template is in that list because `test/init.test.mjs` compares this repository's config
against what `init` would write from the template, byte for byte. So a card that changes the
template changes the live config, whichever file it opens.

## Version control

Working by hand, create your own worktree; a dispatched session is already in one. The main
checkout is not a workspace. Branch for every piece of work. Nothing reaches `main` except
through the gate. Until M5 installs it here that rule is yours to keep and the owner's to
waive; from M5 it is the hook's, it refuses on missing or stale evidence whoever you are, and
nobody can wave it through. Commit atomically and often, with messages that say why. `git
status` before `git add -A`. Commit a journal entry with the work that produced it, as its own
file in `docs/journal/` named `<date>-<time>-<card>-<slug>.md`.

## Pointers

- What must be true of Rigger → `docs/spec/requirements.md`
- What each layer decides, and may never decide → `ARCHITECTURE.md`
- What was chosen, and what would reverse it → `docs/spec/decisions.md`
- What is being built next, and its exit test → `docs/v0-build-plan.md`
- What we learned, and what failed → `docs/journal/`
