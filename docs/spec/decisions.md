ABOUTME: Rigger's decision register: every D# id ever allocated, the live decisions in full, and
the rules for allocating, ratifying and retiring them.

# Decision register

**Every entry below binds**, so a reader never has to check a status before trusting one. A
decision proposed and not yet ratified lives in its pull request, never here.
`docs/spec/requirements.md` rules the same for a requirement, and its preamble carries the
reasoning.

The owner ratifies a proposed decision by returning a sound verdict on its pull request, and the
entry binds once that pull request merges. A proposal is therefore written as it will read once
ratified, and the pull request body is what says it is a proposal.

Rigger allocates its own `D#` numbers here. One id names one decision. An id is never reused, and
a duplicate id reds the build.

A decision that defers work carries a **Deferred, and what returns it** table. Each row names one
deferred thing and the evidence that returns it, and each row has a rule behind it: the table
records consequences, never decisions of its own. A trigger names a signal `report` can show, or
an event the owner will see. A deferral no evidence can return is a refusal, and is written as one.

A decision records what was chosen, why, and what would reverse it. What must be true as a result
is a requirement, and `docs/spec/requirements.md` holds those.

A decision holds one lifespan. A permanent principle and a boundary that expires never share an
entry, because retiring the entry would discard both.

A ratified decision may be amended when the change adds within its stated scope, and the amendment
records its date in the entry's status. A change to what a ratified rule means is never an
amendment: a later decision supersedes it, so the original stays readable.

An entry's status opens with `Ratified`, or with `Superseded by D#` once a later decision replaces
it. Those two openings are the only ones it takes, and an amendment adds its date after `Ratified`
rather than a third. A superseded decision's body moves to `docs/spec/decisions-retired.md`, and
its row stays in the table below so its id is never reused.

| id | decision | status |
|---|---|---|
| D1 | Redo over resume | Ratified |
| D2 | Every card carries its acceptance | Ratified |
| D3 | Escalation is bounded by configuration | Ratified |
| D4 | v0 defers the roles it can do without | Ratified |
| D5 | v0 detects a conflict when Git does | Ratified |
| D6 | Judges review independently | Ratified |
| D7 | The engine is promoted on a boundary, not per merge | Ratified |
| D8 | A fact the code owns is generated, never typed | Ratified |
| D9 | A judge is handed its evidence | Ratified |
| D10 | v0 builds no resume | Ratified |
| D11 | v0 runs one engine against one repository | Ratified |
| D12 | A provisioning step says whether the work needs it | Ratified |
| D13 | macOS is v0's only host | Ratified |
| D14 | Critical is what a maker revision cannot resolve | Ratified |
| D15 | A diagram is admitted where prose cannot carry the shape | Ratified |
| D16 | Code asks the tool that owns the fact, and says where it can disagree | Ratified |

## D1 — Redo over resume

**Status:** Ratified.

### Rule

1. Rigger recovers by redo. `ARCHITECTURE.md`'s failure model states the mechanism, and this
   decision states the choice.
2. A redo is distinguishable afterwards from a first attempt, so the cost of choosing redo is
   visible rather than assumed. `R-STATE-3` holds it.

### Notes

Redo is cheaper to build than resume, and far cheaper to reason about. A resumed dispatch must
prove what the dead engine had already done. A redone card asks the board, which never died.

## D2 — Every card carries its acceptance

**Status:** Ratified.

### Rule

1. Every card states what done means before work starts, and the loop is judged against that
   statement rather than against a maker's reading of the card. `R-CARD`, `R-LOOP` and `R-GATE`
   hold what follows.
2. The acceptance lives in the issue body as plain bullets, not in a board field and never as a
   task list. The body travels with the issue, `gh issue view` shows it, and an edit to it is in
   the issue's history, which is what makes a revision observable. A ticked box would put a
   disposition on the card, and a disposition belongs in the marker.

### Notes

Without a stated bar, finished means whatever the maker decides it means. A card can close while
the work it named is undone, and no layer sees the difference: the column reads `Done` either way.

The bar is set before any work starts, so the card's author fixes it rather than the maker who
wants to close it.

No check proves an acceptance adequate. The form check is a floor, and a judge catches a bar that
proved too low only after the work is done. What the mechanism buys is visibility: a weak bar is
recorded and sent back instead of passing green. A green marker is never a warranty that the card
asked for the right things.

The rule adds no state. The acceptance lives on the card and the dispositions live in the marker,
so a restart still reads everything it needs from the board (D1).

## D3 — Escalation is bounded by configuration

**Status:** Ratified.

### Rule

1. A decision never adds a path to the owner. It names a category the escalation set already
   carries, and `R-ESCALATE` holds what that set is.
2. What disagreement costs before it reaches the owner is the consumer's to set. `R-LOOP` holds
   the rounds and the routing.

### Notes

Escalation is the failure path, never the default. A consumer can count the ways it will be
interrupted, and an author cannot add one. Without rule 1 each new decision may quietly widen what
interrupts the owner, and nothing would notice.

Rule 2 puts the cost of disagreement in the consumer's hands. A kind of work whose judgements are
cheap can afford more rounds than one whose maker runs for an hour.

Three is the default because three worked in practice. It comes from running the loop, not from
analysis, and the number is the consumer's to change on its own evidence.

## D4 — v0 defers the roles it can do without

**Status:** Ratified.

### Rule

1. v0 gives a maker and its judges no adjudicator. `R-LOOP-9` and `R-LOOP-10` hold what follows:
   disagreement is bounded by rounds rather than settled by a third role.
2. No role owns the requirements: the PM proposes them and the owner ratifies them.
3. v0 has no architect. A delta to `ARCHITECTURE.md` comes from whichever role needs it, and goes
   to the owner.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| An adjudicator role, and the triage lane that routes to it | `report` shows escalation volume the owner cannot absorb, or shows rounds exhausting on disagreements a third role could settle. Adding the lane's column to a board already in use is the first test that board columns can change. |
| An architect role | Decompositions escalate as `ambiguous` on layer-boundary questions, or reviews keep finding boundary violations the lenses missed. |
| A role that owns the requirements, distinct from the PM who proposes them | A judge returns the same card twice for an acceptance that contradicts a requirement, or the owner rejects a proposed requirement that the register already answered. |

### Notes

A role is never free. Each one adds a dispatch, a prompt to maintain, and a path for work to take.
v0 buys the cheaper arrangement first and measures whether it hurts, rather than staffing against a
problem it has not had.

The roles deferred here would do real work. An adjudicator settles a maker and judge who cannot
agree. An architect holds the layer boundaries across cards that no single card shows. v0 gives
both jobs to the owner, who is already in the loop for every architecture delta.

This decision expires. What does not change is elsewhere: D3 holds the escalation rule, and
`ARCHITECTURE.md` holds the maker and judge structure.

## D5 — v0 detects a conflict when Git does

**Status:** Ratified.

### Rule

1. A card declares no conflict domains, and carries no receipt naming its authority base or the
   surfaces it expects to change. Its acceptance says what must be true, and nothing more.
2. Two cards that change the same thing collide at merge, where Git reports it rather than
   machinery preventing it. `R-CONFLICT` holds what follows.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Conflict domains, and the per-card receipt that declares them | `report` shows merge collisions costing more rework than declaring domains up front would cost to maintain. |

### Notes

This decision expires, on the evidence its deferral names.

Declaring the surfaces a card will touch lets the scheduler refuse to run two cards that must
collide. It is not free. It needs a vocabulary of domains, a receipt on every card, and a
decomposition step that fills the receipt in correctly.

v0 runs one engine (D11) at the default concurrency. Git already detects the collision, later than
the machinery that would prevent it and at a fraction of the cost. Detecting late costs rework on
one card, and `report` is where that cost becomes visible.

## D6 — Judges review independently

**Status:** Ratified.

### Rule

1. A judge reaches its verdict without seeing another judge's. `R-LOOP` and `R-EVIDENCE` hold
   what that requires.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Showing a later judge the findings an earlier judge filed | `report` shows judges filing near-duplicate findings often enough that the repeated work costs more than independence is worth. Returning it amends `R-EVIDENCE-4`, so it returns as a decision that says so. |

### Notes

Sharing findings is cheaper. A second judge that has read the first one's list stops looking once
the list is confirmed, and a panel that agrees for that reason has not judged twice.

The trigger is one-directional on purpose. Duplicate findings can be counted. Anchoring cannot be
measured until it has already been allowed, so the evidence only ever argues one way.

## D7 — The engine is promoted on a boundary, not per merge

**Status:** Ratified.

### Rule

1. The installed engine that builds Rigger is upgraded on a declared boundary, to the commit that
   closed it — never per merge and never on a whim. In v0 that boundary is a milestone close.
2. `rigger doctor` passes against this repository's config before the upgraded engine resumes.
3. `AGENTS.md` holds the rule for a card that changes the live gate, the live config, or the CLI
   entry point the running engine reads.

### Notes

The installed engine is always a release behind the checkout it works on, and that gap has to be
closed on a schedule rather than on a whim. Per merge is churn: every card would reinstall the
engine that dispatched it. Never is drift, and the gap grows until an upgrade is its own migration.

A milestone is v0's unit because its exit test is the evidence that the new engine works. What
serves after v0 is not knowable yet, and it is a smaller question than the one this decision
settles: the choice is that a boundary exists at all, and that choice does not expire with any
particular boundary.

## D8 — A fact the code owns is generated, never typed

**Status:** Ratified.

### Rule

1. `docs/derived/` holds generated documents, written by a tool. Every other document is written
   by an author, wherever it lives.
2. A hand edit under `docs/derived/` is a lint failure, not an argument.
3. A fact is generated when the code owns it and an author would otherwise retype it. The role
   roster and the escalation set qualify, because the config states both.
4. `docs/derived/` exists only while it holds a generated document, so it is created by the first
   one and never stands empty.

### Notes

Asking "is this hand-written or produced?" of a document is a judgment call. Asking it of a
directory is not, which is why the split is a path rather than a convention.

Rule 3 is a test, not a list. A list would be wrong today: the layer table looks derivable and is
not, because its `Decides` and `Never decides` columns are judgment that no code emits.

Rule 4 is the cost control. An empty directory teaches nothing, and a directory that outlives its
last generated document is a place for hand-written files to accumulate.

Where a fact rule 3 covers is still typed by hand, it is a copy the first generator replaces, and
rule 3 is what makes replacing it a fix rather than a change.

## D9 — A judge is handed its evidence

**Status:** Ratified.

### Rule

1. A judge is given the evidence it needs rather than gathering it. `R-EVIDENCE` holds what it
   is given and what it may not be.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| The packet's contents as consumer configuration | The loop escalates cards as ambiguous because a judge could not rule on what it was given, often enough that the owner sees the pattern. |

### Notes

The packet exists for efficiency. Every judge on a card needs the same diff against the same base,
and deriving it once costs less than deriving it in each dispatch.

Handing a judge its evidence is a saving, never a cage. A judge that suspects an unchanged file
matters must be able to read it, and evidence that forbade looking further would make judges worse
at the job it exists to speed up. `R-EVIDENCE-2` holds that.

Recording what each judge was given is cheap, and it answers a question that is otherwise
unanswerable later: what did this judge see. A verdict binds to a commit, which fixes the work but
not the view of it. `R-EVIDENCE-5` holds that.

## D10 — v0 builds no resume

**Status:** Ratified.

### Rule

1. v0 builds no resume: it does not continue a part-done card, reattach to a dispatch that
   outlived the engine, prove what a dispatch did from its own output, or reclaim a workspace it
   no longer tracks.
2. This defers the work rather than refusing it, and it returns as a new decision.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Resuming a card part-done when the engine died, rather than doing it again | A production incident shows redo was insufficient. The journal records that incident. |

### Notes

Reattachment exists to make resume safe. It guards nothing while redo is the recovery, so v0 pays
for neither.

The trigger matters more than the deferral. An argument does not return this, and neither does a
near miss in development.

This decision expires. D1 holds the choice of redo, which does not.

## D11 — v0 runs one engine against one repository

**Status:** Ratified.

### Rule

1. One engine runs against one repository, which is how v0 keeps one actor on a card at a time
   (`R-WORK-2`) and forecloses the question entirely (`R-WORK-4`). It builds no lease, no fencing token, and no
   multi-host coordination.
2. This defers the work rather than refusing it, and it returns as a new decision.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| Multi-host coordination, and the leases and fencing tokens it needs | A consumer must run two engines against one repository. Every claim and lock in L3 changes with it, and the leases and fencing tokens that replace one engine keep `R-WORK-2` by a different mechanism. |

### Notes

Leases and fencing tokens exist to make two engines safe against one repository. One engine needs
neither, and a lease without fencing gives the appearance of exclusion without the guarantee.

This decision expires, and it expires on its own evidence. Demand for a second host is not evidence
that redo failed, and the two deferrals do not return together. What it protects does not expire: a second
engine keeps one actor on a card by a lease rather than by being the only engine.

## D12 — A provisioning step says whether the work needs it

**Status:** Ratified.

### Rule

1. Provisioning covers two different things, and a step declares which it is. `R-PROV` holds what
   follows for each.

### Notes

A warmup and a setup are not the same event. Priming a build cache can fail and cost nothing. A
dependency install failing means the maker is dispatched into a worktree that cannot run the work,
so it fails at its first command, spends the kind's rounds, and escalates with a reason that never
mentions the install. That is the most expensive route to discovering a failed step, and it
reaches the owner carrying a wrong diagnosis.

Calling all provisioning best-effort models only the warmup. Rigger's own config has one of each:
`npm ci` is required, and `vhs` is not.

The default is optional, so a step that declares nothing is a warmup, which is the commoner case
and the safer one to get by silence.

## D13 — macOS is v0's only host

**Status:** Ratified.

### Rule

1. v0 runs the engine on macOS, and writes no Windows-specific code before the WSL2 spike
   reports. WSL2 is the route it tries first.
2. What Rigger builds is unconstrained by this. A consumer on macOS can build software that runs
   anywhere.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| A native Windows host, with its own containment backend | The WSL2 spike reports that Engineer workloads do not run under WSL2, or a consumer needs a host Rigger cannot reach through WSL2. |

### Notes

One host keeps the containment mechanics to one process model. Process groups, survivor kills and
worktree paths each behave differently on Windows, and every one of them sits in the core, where a
bug costs a stray process or a lost result.

WSL2 is the cheaper route because it reuses the macOS model rather than adding a second one. The
spike exists because that reuse is an assumption, not a finding.

## D14 — Critical is what a maker revision cannot resolve

**Status:** Ratified.

### Rule

1. A judge returns critical only where no maker revision could resolve the fault without an owner
   decision. Every other fault that blocks the merge is needs revision. `R-VERDICT-6` holds it.
2. The test is the loop behaviour the verdict triggers, never the subject matter of the fault. No
   class of defect is critical by its kind.

### Notes

The two verdicts that block a merge differ only in what the loop then does. Needs revision spends a
round. Critical spends none: the loop escalates the card at once, under `R-ESCALATE-6`. A judge
choosing between them is choosing that behaviour, so the rule asks about the behaviour rather than
about the defect.

A subject-matter rule reads well and routes badly. Security is the tempting example: a judge met
real holes in a permission surface, ruled needs revision, and two maker rounds closed them. Under a
rule making security critical by its kind, that fault would have reached the owner on the first
round, carrying a question the loop was already answering.

This decision names no category beyond the three `R-ESCALATE-3` fixes. It says which fault reaches
an existing category, and opens no further route to the owner.

Two signals would reverse it, and `report` shows both. One: the loop escalates cards as critical,
and a maker revision then closes them without an owner decision, so the rule sends too much. Two:
rounds exhaust and the loop escalates as ambiguous over a fault the owner had to decide anyway, so
the rule sends too little.
## D15 — A diagram is admitted where prose cannot carry the shape

**Status:** Ratified.

### Rule

1. An author draws a diagram for a subject only when both tests hold. The subject is a set of
   things and the relations between them. No single passage states those relations, so a reader
   assembles the shape from two or more passages or not at all.
2. An author adds a diagram beside the prose and the rows it depicts, never in place of them.
3. A diagram under `docs/spec/` owns nothing. It depicts only what the rows already state, it
   cites the id of every row it depicts, and it loses to the row where the two disagree.
4. A diagram in `ARCHITECTURE.md` owns the structure it depicts, as that document's prose does.
   It may therefore depict a relation no sentence there states, and it owes no citation — both
   denied to a diagram under `docs/spec/`. A diagram there and a sentence there that disagree
   are a fault in the document, and the owner resolves it.
5. An author draws in Mermaid, in a fenced `mermaid` block, and this decision admits no other
   form.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| A diagram form other than Mermaid | A consumer's forge does not render a fenced `mermaid` block, so a reader there sees source where the corpus shows a diagram. |
| A check that a diagram under `docs/spec/` cites an id for everything it depicts | A judge files a finding for a citation that is missing or does not resolve, where the document-checking extension point could have caught it. |

### Notes

The corpus drew nothing until now, and prose is still the default. A diagram earns its place only
on rule 1's tests, because every diagram is a second statement of something the document already
holds, and the second statement is what goes stale.

One decision covers two venues because a single rule would be wrong for one of them. Under
`docs/spec/` the rows own the facts, so a diagram there refers to them and owns nothing. In
`ARCHITECTURE.md` the document owns the structure, so a diagram there owns what it depicts. That
is the "own it, refer to it" split in `AGENTS.md`, under "Documents own their facts", applied
to a diagram.

Mermaid is text. It diffs, a judge reads its source rather than an image, and the forge renders
it, so the diagram reviews like the rest of the corpus. An image file would review as a blob.

Whether the resolver checks a diagram's citations is declared at the document-checking extension
point, and this decision does not declare it. The table above records the question rather than
answering it.

What would reverse this is drift the reader sees: `report` showing judges filing findings against
diagrams that disagree with what they depict, or the owner reading a diagram the document has
outgrown. On that evidence a later decision withdraws the admission, and the prose stands alone.

## D16 — Code asks the tool that owns the fact, and says where it can disagree

**Status:** Ratified.

### Rule

1. A tool or command outside Rigger is an authority for a fact it owns, and this entry binds that
   class alone. An authority decides the fact it owns, and Rigger's code never decides it instead.
   `npm test` is `node --test`, so what counts as a test is that command's answer rather than a
   list of spellings a script thought of.
2. Code carrying a copy of an authority's answer — a pattern, a threshold, a list — ties that copy
   to the authority with a test that asks it. The copy is never what decides.
3. Code depending on an authority records where the authority's answer can differ from its own,
   beside the code that depends on it. The record is measured, never estimated, because a bound
   nobody measured is a guess carrying a number.

### Notes

The corpus had written this rule twice and left one direction out. `D8` covers code to document:
a fact the code owns is generated, never typed. `AGENTS.md`, under "Documents own their facts",
covers document to document: a fact owned elsewhere is written as a reference and never retyped.
Neither reaches code that restates what a tool would have answered.

An authority is a tool or command, and this entry reaches no other kind.
`scripts/package-budget.mjs` and `scripts/instruction-budget.mjs` each read a budget number
out of `ARCHITECTURE.md`. That read depends on a document that owns a fact rather than on a
tool that answers for one, so no rule here reaches that dependency. What the same files take
from a tool is bound as any other code is.

Two defects in `scripts/package-budget.mjs` lived in that gap, and no lens in
`.claude/skills/code-review/` asked the question that would have caught either. `docs/journal.md`
records both. In each, a green suite proved nothing, because code asserting a fact it does not own
agrees with itself.

Rule 3 is the half an author drops first, and dropping it leaves rule 1 reading as licence to
depend on anything. An authority's behaviour arrives with its undefined edges attached.
`node --test` decides what a test is by filename, and on one case-insensitive filesystem it runs
`a.TEST.mjs` and declines `TEST.mjs`, which `docs/journal.md` records. No filename pattern tracks
that everywhere, so the code carrying one says where it stops.

This decision sits beside `D8` rather than replacing it, and changes nothing `D8` says. `D8`
governs a document an author would otherwise type. This governs code that would otherwise restate
what a tool answers. Neither reads onto the other's subject.

Two signals would reverse it, and `report` shows both. One: cards come back because a test that
asks a tool could not run it, or because the tool answered differently between runs, more often
than a restated fact was ever found wrong. Two: a tool changes its answer under code tied to it,
on an upgrade a restated fact would have survived.
