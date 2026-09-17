ABOUTME: Rigger's decision register: every D# id ever allocated, the live decisions in full, and
the rules for allocating, ratifying and retiring them.

# Decision register

Rigger allocates its own `D#` numbers here. One id names one decision. An id is never reused, and
a duplicate id reds the build.

A decision holds one lifespan. A permanent principle and a boundary that expires never share an
entry, because retiring the entry would discard both.

A decision is `Proposed`, then `Ratified`, then `Superseded by D#` when a later decision replaces
it. A superseded decision's body moves to `docs/spec/decisions-retired.md`, and its row stays in
the table below so its id is never reused.

A ratified decision may be amended when the change adds within its stated scope, and the amendment
records its date in the entry's status. A change to what a ratified rule means is never an
amendment: a later decision supersedes it, so the original stays readable.

| id | decision | status |
|---|---|---|
| D1 | Redo over resume | Ratified 2026-09-17 |
| D2 | Every card carries its acceptance | Ratified 2026-09-17 |
| D3 | Escalation is bounded by configuration | Ratified 2026-09-17 |
| D4 | v0 defers the roles it can do without | Ratified 2026-09-17 |
| D5 | v0 detects a conflict when Git does | Ratified 2026-09-17 |
| D6 | Judges review independently | Ratified 2026-09-17 |
| D7 | The engine is promoted at milestone close | Ratified 2026-09-17 |
| D8 | A fact the code owns is generated, never typed | Ratified 2026-09-17 |
| D9 | A judge is handed its evidence | Ratified 2026-09-17 |
| D10 | v0 builds no resume | Ratified 2026-09-17 |
| D11 | v0 runs one engine against one repository | Ratified 2026-09-17 |

## D1 — Redo over resume

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. Rigger recovers by redo. `ARCHITECTURE.md`'s failure model states the mechanism, and this
   decision states the choice.
2. L3 records a redo when it re-dispatches a card after an engine death. `report` separates redone
   work from work done at the first attempt.

### Notes

Redo is cheaper to build than resume, and far cheaper to reason about. A resumed dispatch must
prove what the dead engine had already done. A redone card asks the board, which never died.

## D2 — Every card carries its acceptance

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. Every card carries an `## Acceptance` section in the issue body, written as plain bullets. Each
   item states exactly one condition a judge can test.
2. The card's author writes the acceptance before the card reaches `Ready`. The PM writes it for a
   card the PM decomposes. The owner writes it for a card the owner files. The author loads the
   `.claude/skills/acceptance/` skill first.
3. The engine does not admit a card that carries no acceptance. `rigger plan` lists that card and
   names the reason.
4. The engine also refuses a card whose acceptance has an item repeating the card's title. That is
   the whole of the form check, and it is a floor rather than a finding of adequacy. What else
   makes an item vacuous is the skill's to teach and rule 8's to catch.
5. A spike card's acceptance states what a complete answer contains, never what the answer is. The
   question it asks is not an acceptance item.
6. The maker finishes against the acceptance, never against its own reading of the card.
7. Each judge records every acceptance item in its marker, as met or unmet. A marker that leaves an
   item unmet is not sound, and the gate refuses the merge.
8. Each judge also records whether the acceptance was sufficient for what the card asked. A judge
   that finds it insufficient returns the card to its author with the reason, and never rewrites
   the acceptance itself.
9. L2 records a revised acceptance as an event, and a verdict written before the latest revision is
   stale exactly as one written before the head commit is. Every judge reviews again. The card
   spends the kind's rounds, and exhausting them escalates it as `ambiguous` (D3).
10. A follow-up issue may not carry an acceptance item of the card that filed it.
11. A maker that cannot meet an item escalates the card as `ambiguous`, naming the item. The maker
    never closes the card.

### Notes

Without a stated bar, finished means whatever the maker decides it means. A card can close while
the work it named is undone, and no layer sees the difference: the column reads `Done` either way.

Rule 3 sets the bar before any work starts, so the card's author fixes it rather than the maker who
wants to close it. Rule 7 makes an unmet item visible in the marker and in `report`.

The acceptance is content, and the board holds state, so it lives in the issue body rather than in
a board field. The body travels with the issue, `gh issue view` shows it, and an edit to it is in
the issue's history. Plain bullets, never a task list: a ticked box would put disposition on the
card, and the marker is where a disposition belongs.

No check proves an acceptance adequate. Rule 4 is a floor that catches a vacuous item, and rule 8
catches a bar that proved too low only after the work is done. What the mechanism buys is
visibility: a weak bar is recorded and sent back instead of passing green. A green marker is never
a warranty that the card asked for the right things.

The rule adds no state. The acceptance lives on the card and the dispositions live in the marker,
so a restart still reads everything it needs from the board (D1).

## D3 — Escalation is bounded by configuration

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. Every escalation to the owner is a category in the consumer's configured escalation set. A kind
   of work may also name the owner as its last judge; that is the loop running, not an escalation.
2. A decision never adds a path to the owner. It names a category the consumer already configured,
   and the escalation set decides who sees it.
3. The review round count is consumer configuration, per kind of work. The default is three
   rounds.

### Notes

Escalation is the failure path, never the default. Every path to the owner is a category the
consumer configured, so a consumer can count them and an author cannot add one. Without rule 2 each
new decision may quietly widen what interrupts the owner, and nothing would notice.

Rule 3 puts the cost of disagreement in the consumer's hands. A kind of work whose judgements are
cheap can afford more rounds than one whose maker runs for an hour.

Three is the default because three worked in practice. It comes from running the loop, not from
analysis, and the number is the consumer's to change on its own evidence.

## D4 — v0 defers the roles it can do without

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. v0 gives a maker and its judges no adjudicator. No role settles a disagreement between them.
2. A maker and a judge who disagree spend the kind's rounds. Exhausting them escalates the card as
   `ambiguous` (D3).
3. v0 has no architect. A delta to `ARCHITECTURE.md` comes from whichever role needs it, and parks
   for the owner.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| An adjudicator role, and the triage lane that routes to it | `report` shows escalation volume the owner cannot absorb, or shows rounds exhausting on disagreements a third role could settle. Adding the lane's column to a board already in use is the first test that board columns can change. |
| An architect role | Decompositions escalate as `ambiguous` on layer-boundary questions, or reviews keep finding boundary violations the lenses missed. |

### Notes

A role is never free. Each one adds a dispatch, a prompt to maintain, and a path for work to take.
v0 buys the cheaper arrangement first and measures whether it hurts, rather than staffing against a
problem it has not had.

The two deferred here would do real work. An adjudicator settles a maker and judge who cannot
agree. An architect holds the layer boundaries across cards that no single card shows. v0 gives
both jobs to the owner, who is already in the loop for every architecture delta.

This decision expires. What does not change is elsewhere: D3 holds the escalation rule, and
`ARCHITECTURE.md` holds the maker and judge structure.

## D5 — v0 detects a conflict when Git does

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. A card declares no conflict domains, and carries no receipt naming its authority base or the
   surfaces it expects to change. Its acceptance says what must be true, and nothing more.
2. Two cards that change the same code collide at merge, where Git reports it. The card that loses
   the race returns to its maker.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Conflict domains, and the per-card receipt that declares them | `rigger report` shows merge collisions costing more rework than declaring domains up front would cost to maintain. |

### Notes

Declaring the surfaces a card will touch lets the scheduler refuse to run two cards that must
collide. It is not free. It needs a vocabulary of domains, a receipt on every card, and a
decomposition step that fills the receipt in correctly.

v0 runs one engine (D11) at the default concurrency. Git already detects the collision, later than
the machinery that would prevent it and at a fraction of the cost. Detecting late costs rework on
one card, and `report` is where that cost becomes visible.

## D6 — Judges review independently

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. The agent judges for a card run concurrently, and the owner, when configured as a judge, is
   last. No judge sees another judge's findings or verdict, and none sees the maker's session.
2. `ARCHITECTURE.md`'s invariants state the independence. This decision states the choice.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Showing a later judge the findings an earlier judge filed | `report` shows judges filing near-duplicate findings often enough that the repeated work costs more than independence is worth. Returning it amends `ARCHITECTURE.md`'s independence invariant, so it returns as a decision that says so. |

### Notes

Sharing findings is cheaper. A second judge that has read the first one's list stops looking once
the list is confirmed, and a panel that agrees for that reason has not judged twice.

The trigger is one-directional on purpose. Duplicate findings can be counted. Anchoring cannot be
measured until it has already been allowed, so the evidence only ever argues one way.

## D7 — The engine is promoted at milestone close

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. The installed engine that builds Rigger is upgraded when a milestone closes, to the commit that
   closed it.
2. `rigger doctor` passes against this repository's config before the upgraded engine resumes.
3. `AGENTS.md` holds the rule for a card that changes the live gate, the live config, or the CLI
   entry point the running engine reads.

### Notes

The installed engine is always a release behind the checkout it works on, and that gap has to be
closed on a schedule rather than on a whim. Per merge is churn: every card would reinstall the
engine that dispatched it. Never is drift, and the gap grows until an upgrade is its own migration.

A milestone is the natural unit because its exit test is the evidence that the new engine works.

## D8 — A fact the code owns is generated, never typed

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. `docs/derived/` holds generated documents, written by a tool. Every other document is written
   by an author, wherever it lives.
2. A hand edit under `docs/derived/` is a lint failure, not an argument.
3. A fact is generated when the code owns it and an author would otherwise retype it. The role
   roster and the escalation set qualify, because the config states both.
4. `docs/derived/` is created when the first generated document exists, never before.

### Notes

Asking "is this hand-written or produced?" of a document is a judgment call. Asking it of a
directory is not, which is why the split is a path rather than a convention.

Rule 3 is a test, not a list. A list would be wrong today: the layer table looks derivable and is
not, because its `Decides` and `Never decides` columns are judgment that no code emits.

Rule 4 is the cost control. An empty directory teaches nothing, and the rule binds from the day it
is written whether or not the directory exists.

Until a generator exists, the roster and the escalation set are typed: in `ARCHITECTURE.md`'s
config sample, and in the build plan's milestones. Those are the copies the first generator
replaces, and the rule is what makes replacing them a fix rather than a change.

## D9 — A judge is handed its evidence

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. L2 composes a review packet for each judge dispatch. It reaches L1 with the dispatch L3
   schedules, so it crosses no boundary the layer map does not already carry.
2. The packet carries the card and its acceptance, the pull request number, the head SHA, the base
   SHA, the diff between them, the list of changed files, the kind of work, and which role this
   judge is. On a re-review it also carries what the maker changed since the last round.
3. The packet carries no other judge's findings or verdict, and no part of the maker's session
   (D6).
4. A judge may read beyond the packet. The packet is a floor, never a limit.
5. L2 records each packet's digest in the event stream.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| The packet's contents as consumer configuration | Judges routinely read the same material beyond the packet, which `report` sees as repeated work the packet could have carried. |

### Notes

The packet exists for efficiency. Every judge on a card needs the same diff against the same base,
and deriving it once costs less than deriving it in each dispatch.

Rule 4 is what keeps that a saving rather than a cage. A judge that suspects an unchanged file
matters must be able to read it, and a packet that forbade looking further would make judges worse
at the job the packet exists to speed up.

Rule 5 is cheap and answers a question that is otherwise unanswerable later: what did this judge
see. A verdict binds to a SHA, which fixes the commit but not the view of it; the digest fixes the
view.

## D10 — v0 builds no resume

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. v0 builds no resume, no runner reattachment, no terminal proof, and no reclamation.
2. This defers the work rather than refusing it, and it returns as a new decision.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Resume, runner reattachment, terminal proof, reclamation | A production incident shows redo was insufficient. The journal records that incident. |

### Notes

Reattachment exists to make resume safe. It guards nothing while redo is the recovery, so v0 pays
for neither.

The trigger matters more than the deferral. An argument does not return this, and neither does a
near miss in development.

This decision expires. D1 holds the choice of redo, which does not.

## D11 — v0 runs one engine against one repository

**Status:** Ratified by the owner 2026-09-17.

### Rule

1. One engine runs against one repository. v0 builds no lease, no fencing token, and no multi-host
   coordination.
2. This defers the work rather than refusing it, and it returns as a new decision.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Multi-host coordination, and the leases and fencing tokens it needs | A consumer must run two engines against one repository. Every claim and lock in L3 changes with it. |

### Notes

Leases and fencing tokens exist to make two engines safe against one repository. One engine needs
neither, and a lease without fencing gives the appearance of exclusion without the guarantee.

This decision expires, and it expires on its own evidence. Demand for a second host is not evidence
that redo failed, and the two deferrals do not return together.
