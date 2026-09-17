---
name: spec-style
description: Write a delta to docs/spec/ or ARCHITECTURE.md — a new or changed requirement row, a decision entry, an architecture section — or retire one. Use before drafting any requirement or decision, and before allocating, changing or withdrawing an R- or D- id.
---

ABOUTME: The four rules the decision register and the requirements were written under, and the
shape a row or entry takes, for anyone proposing a delta to them.

# Writing a requirement or a decision

A delta to `ARCHITECTURE.md` or to anything under `docs/spec/` is a **proposal**. `AGENTS.md`'s
"When you write a decision or a requirement" section holds what that obliges you to do; this
skill holds how the corpus is written, so that what you propose reads like what is already
there.

Read the file you are changing before you draft. Both registers state their own rules in their
preambles, and those preambles are the authority. What follows is those rules, gathered.

## The four rules

### 1. Each register owns one kind of sentence

A **decision** records what was chosen, why, and what would reverse it. A **requirement**
states what must be true as a result: observable from outside, naming no mechanism, so that it
survives a redesign of the structure that satisfies it. Where a requirement follows from a
decision it cites it in its `from` column, and the decision is where the reasoning lives.
`ARCHITECTURE.md` holds the structure, and never repeats what must be true.

Rules that bind work *in this repository* rather than *the product* are neither: `AGENTS.md`
holds those, and `docs/spec/decisions.md` holds the ones about building Rigger.

So: before you write a sentence, decide which document owns it. `AGENTS.md`'s "Documents own
their facts" gives the three treatments — own it, refer to it, or do not say it — and a
sentence that no document owns is the third.

### 2. One id names one thing, and an id is never reused

Each register allocates its own ids. Requirement ids group by subject, and a new requirement
takes a new id in its group. `D#` numbers are allocated in the register itself, one id to one
decision. A duplicate id reds the build.

Whether an edit keeps its id is a test, not a preference:

- **A requirement** keeps its id when the edit does not change what must be true of Rigger,
  read across the whole document, however much the words moved. Change that, and the edit takes
  a new id and withdraws the old one. A split withdraws and allocates one new id per part; a
  merge withdraws and allocates one. A change to `made true by` or to `checked by` is never a
  change to what must be true, and never takes a new id.
- **A decision** may be amended when the change adds within its stated scope, and the amendment
  records its date in the entry's status. A change to what a ratified rule *means* is never an
  amendment: a later decision supersedes it, so the original stays readable.

### 3. Retirement keeps the citation resolvable and the id allocated

Nothing is deleted, and the two registers retire differently:

- A withdrawn **requirement's row leaves** `docs/spec/requirements.md` for
  `docs/spec/requirements-retired.md`, carrying its exact text and its `from`. Only the owner
  withdraws one.
- A superseded **decision's row stays** in the register's table, marked `Superseded by D#`,
  while its body moves to `docs/spec/decisions-retired.md`.

Either way the id stays allocated and never comes round again, and a document citing it still
resolves to an explanation rather than to nothing. The duplicate-id check reads the live file
and the retired one together.

### 4. Ratification is the owner's, and each register records it differently

Each register carries the date the owner ratified it. A change to it is ratified as a whole and
moves that date; an amendment to one decision records its own date in that entry's status. You
never ratify your own (`AGENTS.md`, "When you write a decision or a requirement").

How a register shows what is ratified differs between the two, so read the preamble of the one
you are writing before you place a proposal:

- **`docs/spec/requirements.md`** has no status column: every row in it binds, so a reader never
  has to check one before trusting a row, and a row proposed and not yet ratified lives in its
  pull request and never there.
- **`docs/spec/decisions.md`** carries the state on the entry instead. A decision is `Proposed`,
  then `Ratified`, then `Superseded by D#`, and the entry's status is where that state is
  recorded.

## The shape of an entry

Match what is there rather than inventing a shape.

- **A requirement row** is `id | requirement | made true by | checked by | from`. The
  requirements preamble states the five forms `checked by` takes and requires the derivation
  alongside the observer — use one of them. The actor in `made true by` is never the entry in
  `checked by`: Rigger doing a thing is not a check that Rigger did it. A gap is written as
  `nothing yet`, or as `nothing could` *with its reason*.
- **A decision entry** is `Status`, then `Rule` as numbered rules, then, where it defers work, a
  `Deferred, and what returns it` table, then `Notes`. Each deferral row names one deferred
  thing and the evidence that returns it; a deferral no evidence can return is a refusal and is
  written as one. One entry holds one lifespan, because retiring an entry discards all of it.

## Before you propose it

1. Is this a decision, a requirement, an architecture change, or a repository rule? Write it
   where that document lives, and refer to it from everywhere else.
2. Does the id you allocated exist in the live register or the retired one? Neither reuses one.
3. If you edited an existing row, apply rule 2's test and say in the proposal which way it came
   out.
4. Does the new requirement have a test that claims it? Without one the build reds
   (`AGENTS.md`).
5. Did you resolve the ambiguity inside the delta, or escalate it? Never leave it for the
   implementer to guess.
