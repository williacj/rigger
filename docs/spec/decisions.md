ABOUTME: Rigger's decision register: every D# id ever allocated, the live decisions in full, and
the rules for allocating, ratifying and retiring them.

# Decision register

**Every entry below binds**, so a reader never has to check a status before trusting one. A
decision proposed and not yet ratified lives in its pull request, never here.
`docs/spec/requirements.md` rules the same for a requirement, and its preamble carries the
reasoning.

The owner ratifies a proposed decision by merging its pull request, and the entry binds from that
merge. A merge by anyone else ratifies nothing. A proposal is therefore written as it will read
once ratified, and the pull request body is what says it is a proposal. `D21` records how the
owner ratifies, and what would reverse it.

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
| D4 | v0 defers the roles it can do without | Superseded by D18 |
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
| D17 | A requirement older than this decision is a counted gap | Ratified |
| D18 | v0 staffs an architect, and the PM decomposes | Ratified |
| D19 | Until M5, a maker merges its own card | Ratified |
| D20 | A card's author survives its writing session | Ratified |
| D21 | The owner's merge is the owner's ratification | Ratified |

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
| A diagram form other than Mermaid | A consumer's forge does not render a fenced `mermaid` block, so a reader there sees source where the binding documents show a diagram. |
| A check that a diagram under `docs/spec/` cites an id for everything it depicts | A judge files a finding for a citation that is missing or does not resolve, where the document-checking extension point could have caught it. |

### Notes

The binding documents drew nothing until now, and prose is still the default. A diagram earns its
place only on rule 1's tests, because every diagram is a second statement of something the
document already holds, and the second statement is what goes stale.

One decision covers two venues because a single rule would be wrong for one of them. Under
`docs/spec/` the rows own the facts, so a diagram there refers to them and owns nothing. In
`ARCHITECTURE.md` the document owns the structure, so a diagram there owns what it depicts. That
is the "own it, refer to it" split in `AGENTS.md`, under "Documents own their facts", applied
to a diagram.

Mermaid is text. It diffs, a judge reads its source rather than an image, and the forge renders
it, so the diagram reviews like the rest of the binding documents. An image file would review as a
blob.

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

The gap: `D8` covers code to document, `AGENTS.md`'s "Documents own their facts" covers document
to document, and neither reaches code that restates what a tool answers.

An authority is a tool or command, and this entry reaches no other kind.
`scripts/package-budget.mjs` and `scripts/instruction-budget.mjs` each read a budget number
out of `ARCHITECTURE.md`. That read depends on a document that owns a fact rather than on a
tool that answers for one, so no rule here reaches that dependency. What the same files take
from a tool is bound as any other code is.

Rule 3 is the half an author drops first, and dropping it leaves rule 1 reading as licence to
depend on anything: an authority's behaviour arrives with its undefined edges attached.
`docs/journal/` records what produced this entry.

Two signals would reverse it, and `report` shows both. One: cards come back because a test that
asks a tool could not run it, or because the tool answered differently between runs, more often
than a restated fact was ever found wrong. Two: a tool changes its answer under code tied to it,
on an upgrade a restated fact would have survived.

## D17 — A requirement older than this decision is a counted gap

**Status:** Ratified.

### Rule

1. `AGENTS.md`, under "When you write a decision or a requirement", obliges whoever adds a
   requirement to claim it with a test. This decision neither widens nor narrows that
   obligation, and adds no check of its own.
2. A **counted gap** is a requirement `docs/spec/requirements.md` held when this decision bound,
   and that no test has claimed since. `docs/derived/test-matrix.md` marks it, the count its
   generator prints includes it, and the build does not red.
3. The set of counted gaps never gains a member. A requirement leaves the set when a test claims
   it, or when the owner withdraws it, and it never returns.
4. Editing a row's `checked by` moves no requirement into the set or out of it.
   `docs/spec/requirements.md`'s preamble states that the column records what *would* catch a
   violation, never what a test has done.
5. A requirement the owner withdraws leaves the set with its row. Only the owner withdraws a
   requirement (`docs/spec/requirements.md`, preamble), so the set loses a member that way only
   where the owner has decided Rigger need not do the thing.
6. Three things shrink the set, and they run at once:
   1. The card that makes a requirement true claims it with a test in the same work. That
      obligation is an acceptance item: the card's author writes it before the work starts
      (`R-CARD-1`), the maker finishes against it (`R-LOOP-1`), and every judge rules on it
      (`R-LOOP-5`).
   2. A milestone closes only when a test claims every requirement its exit list cites.
   3. v0 ships with the set empty. `docs/v0-build-plan.md`'s M8 holds that, and this decision
      ends there.
7. A judge enforces the rules above. No tool holds the set, and the notes record what the
   generator answers instead.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| A test claiming each requirement `docs/spec/requirements.md` held when this decision bound | The card that makes that requirement true runs and claims it. A milestone whose exit list cites the requirement returns it by that milestone's close, and M8 returns every one still open. |

### Notes

The claim that a requirement no test claims reds the build was written of every requirement in
four places: `docs/v0-build-plan.md` twice, `docs/spec/requirements.md`'s preamble, and
`.claude/skills/tdd/SKILL.md`, which cited `AGENTS.md` for it. `AGENTS.md` states it of a
requirement being added, and that narrower rule is the only one an author could satisfy.

Redding on every unclaimed row is the first failure. `npm run matrix:check` reported 99 of 99
requirements with no test when this entry was drafted. A check redding on each would therefore
have redded the build on the commit that landed it, and forced tests written to move a number.
The generator owns the live figure (`D8`), and 99 is the measurement this reasoning rests on
rather than a number the register keeps current.

Counting every unclaimed row and redding on none is the other failure. It makes the gap visible
and leaves nothing acting on it, and a number nobody is obliged to move does not move. Rule 6 is
the answer: the set carries a closing schedule, and its three parts bite at three distances.

Dating the set is what makes both halves true at once. A requirement added from here is added by
someone who can write its test, because the behaviour is being built in the same work. A
requirement the register already held waits on code that does not exist, and no test could claim
it honestly. The date is the only line that separates those two.

**What the generator answers, and where that differs from the set.** `D16` rule 3 asks for the
difference to be measured rather than estimated. Running the generator over a scratch copy of the
register measured four things.

1. The printed count is every live requirement no declaration claims, and it holds no date. It
   therefore counts a requirement added after this entry alongside a counted gap. Adding one
   unclaimed row moved the count from 99 of 99 to 100 of 100 while the set gained no member.
2. Retiring an unclaimed requirement moved the count from 99 of 99 to 98 of 98 and dropped the
   row from the matrix. Both numbers fell by one, and no test was written.
3. Editing a row's `checked by` left the count untouched in both directions. It did move how the
   matrix marks the row: under `the test suite` the mark reads **gap**, and under `nothing yet`
   it reads `nothing yet`. So the column moves the mark, while rule 4 holds the membership.
4. Nothing records which requirements the set held. Deleting the test that claimed one redded
   only the staleness check, and regenerating the matrix cleared that red and returned the row
   to **gap**. Rule 3 is what forbids the return, and rule 7 names who holds it.

Rule 4 closes the route that would otherwise open. `checked by` is prospective, and an author
edits it freely, so a set defined by that column could be emptied by editing cells. Membership is
by id, and the column says nothing about it.

Rule 5 closes the other one. A withdrawal moves the number with no test written, and that is
honest: a requirement that binds nothing has nothing left to prove. Only the owner withdraws one,
so the set cannot be shrunk that way by the maker whose card it would flatter.

This decision names no escalation category and opens no route to the owner (`D3` rule 1). Rule 5
cites a withdrawal the owner already performs, and rule 6 cites a judge already ruling on an
acceptance item.

Two signals would reverse it. One: the count does not fall across a milestone's close, so rule 6's
schedule is not what closes the set, and the owner is reading a number nothing acts on. Two: the
count falls while the suite proves no more than before, because cards close with tests written to
claim a row rather than to prove a behaviour. CI's printed count shows the first, and `report`
shows the second as work that came back (`R-RECORD-3`).

This decision holds one lifespan. It begins with the set and ends when the set is empty. The
obligation `AGENTS.md` carries for a requirement being added outlives it.

## D18 — v0 staffs an architect, and the PM decomposes

**Status:** Ratified.

### Rule

1. v0 has an architect. The architect owns Rigger's structure: it proposes every delta to
   `ARCHITECTURE.md`, and the owner ratifies that delta.
2. The architect decides where a change lives — which layer, which boundary between two layers,
   and which extension point a need lands in. It decides that across cards, where no single card
   shows the boundary.
3. The architect never decides what must be true of Rigger, what Rigger promises, or what good
   means for a kind of work. The PM proposes the first, `README.md` holds the second, and
   `ARCHITECTURE.md` gives the third to the owner.
4. The PM decomposes larger work into cards, so `R-CARD-3`'s decomposing role is the PM.
5. The architect rules before the cards are cut. A consumer names the architect a judge on the
   kind of work that proposes requirements, so a decomposition follows a ratified structure.
6. v0 gives a maker and its judges no adjudicator. `R-LOOP-9` and `R-LOOP-10` hold what follows:
   disagreement is bounded by rounds rather than settled by a third role.
7. No role owns the requirements: the PM proposes them and the owner ratifies them.

### Deferred, and what returns it

| Deferred | Returns when |
|---|---|
| An adjudicator role, and the triage lane that routes to it | `report` shows escalation volume the owner cannot absorb, or shows rounds exhausting on disagreements a third role could settle. Adding the lane's column to a board already in use is the first test that board columns can change. |
| A role that owns the requirements, distinct from the PM who proposes them | A judge returns the same card twice for an acceptance that contradicts a requirement, or the owner rejects a proposed requirement that the register already answered. |

### Notes

`D4` deferred the architect on a trigger that fires after the pain: a decomposition escalating as
`ambiguous`, or reviews finding boundary violations the lenses missed. The owner's intake puts the
architect's verdict before every decomposition, which is a different rule rather than that trigger
firing. So the deferral is replaced rather than waited out, and this decision supersedes `D4`
whole. Rules 6 and 7 are `D4` rules 1 and 2 carried forward unchanged, because superseding an
entry retires everything in it.

A role is still never free, and what buys this one is the order. A boundary question caught before
the cards are cut costs one verdict. The same question caught afterwards costs every card built on
the wrong boundary, and the rework is invisible until a reviewer finds it.

What reverses this is the mirror of that claim. `report` shows the architect's verdicts on
proposed requirements, and where those verdicts leave no item unmet across a milestone the gate is
buying nothing. A later decision removes it on that evidence.

The PM decomposes because the PM already files cards and already writes their acceptance. A new
intake role would split one job across two prompts, and the architect is the only role this
decision adds.

Rules 2 and 3 are written as what the architect decides and never decides, so the lane reads
against `ARCHITECTURE.md`'s layer table rather than beside it. Rule 3 is the load-bearing half: L4
is the owner's, so what good means for a kind of work stays the owner's however much structure the
architect holds.

## D19 — Until M5, a maker merges its own card

**Status:** Ratified.

### Rule

1. Until M5, a maker merges its own card once `R-GATE-4`'s evidence is in hand, and never
   otherwise. `AGENTS.md`, under "Review and merge", holds it.
2. The permission reaches the merge alone. This decision leaves self-ratifying and judging one's
   own work exactly where it found them, so every verdict the merge rests on is another role's.
3. M5 reverses this decision. `docs/v0-build-plan.md` installs the git gate hook there, and the
   permission ends with it.

### Notes

`AGENTS.md` forbade a maker merging its own work in words carrying no exception, and rule #1 of
that file forbids a session granting itself one. So a dispatched maker read the prohibition and
stopped, which is the behaviour the file exists to produce.

That behaviour is why the permission could not live in a dispatch brief. Card #187 records what M0
saw: sessions met the gate refusing `--no-verify`, and refusing `-c core.hooksPath=` at its
correct value, and each surfaced the refusal rather than routing around it. A brief telling a
maker it may merge, against a binding document saying it may not, asks the session to take the
brief over the document.

The end was settled before this entry was written. `AGENTS.md`'s "Version control" gives the gate
rule to the owner to waive until M5, and `docs/v0-build-plan.md`'s M5 is where the hook arrives.
So rule 3 reads a reversal the binding documents already carried, rather than inventing one.

A forge ruleset is a backstop under the permission rather than a substitute for a verdict.
Measured with `gh api repos/williacj/rigger/rulesets/23968611` on 2026-09-24, `main`
carried an active ruleset. It required a pull request and the `check (20)` and `check (24)`
status checks, blocked non-fast-forward and deletion, and held `bypass_actors` empty. So a maker
merging through the forge could not merge a red branch or rewrite history. What no ruleset reads
is a verdict, which is what rule 1 asks for.

This decision adds no requirement. It binds the sessions working in this repository rather than
Rigger's behaviour, and `docs/spec/requirements.md` holds only the second.

One signal ends the permission before M5. Where a maker merges on evidence a judge later rules
incomplete, the permission is costing more than the round it saves, and the owner withdraws it.

## D20 — A card's author survives its writing session

**Status:** Ratified.

### Rule

1. Authorship belongs to the owner or role that wrote a card's initial acceptance, not to one
   dispatch or session. For a decomposed card, the decomposing role is the author.
2. Filing a card written by another role does not transfer authorship to the filer. A later
   session acting as the author may revise the acceptance, subject to `R-CARD-5`.
3. The identity recorded for each acceptance change distinguishes the authoring owner or role
   from the session that made the change. `R-CARD-6` holds the record obligation.

### Notes

`R-CARD-3` names the decomposing role, and `R-CARD-5` reserves revisions to the card's author.
A session ends, but the role can be dispatched again. Keeping authorship with that role lets
`R-LOOP-6` return an insufficient acceptance to someone who can revise it. It also means a
different session can file the card without taking over its acceptance.

The event record must let a reader distinguish a role's continuing authority from the particular
session that acted. The actor on an acceptance change still matters: two sessions of one role
must not become one indistinguishable writer. This choice uses the identities `R-CARD-3` and
`R-CARD-6` already require; it adds no requirement.

The cost is that a filer cannot fix an acceptance merely because it filed the card. It must
return the card to the authoring role, even when that means another dispatch.

Two observations would reverse this choice. First, `report` shows cards repeatedly waiting for
an authoring role that can no longer be dispatched. Second, the event record cannot identify
the authoring role independently of the filing session without adding state beyond the card and
its history. Either would require a later decision on reassignment or a different authorship
rule.

## D21 — The owner's merge is the owner's ratification

**Status:** Ratified.

### Rule

1. The owner ratifies a proposal by merging its pull request, and needs no separate verdict to do
   so. Each register's preamble holds it.
2. On a card whose kind names `owner` among its judges, the owner's merge is the owner's sound
   verdict. The owner returns any other verdict on the pull request, and leaves it unmerged.
3. So the maker of such a card never holds `R-GATE-4`'s evidence before the card merges, and under
   `D19` the owner merges it rather than the maker. `AGENTS.md`, under "Review and merge", holds
   it.
4. A merge by anyone but the owner ratifies nothing. This decision leaves every other judge's
   verdict where it found it, and leaves self-ratifying forbidden.

### Notes

The owner stated on 2026-09-24 that merging a proposal's pull request ratifies it. That is how
#193, which added `D20`, and #194, #196, #199 and #200 were ratified. The owner merged each one,
and none carries a posted owner verdict (card #203).

The preambles described two events where the owner performs one. They had the owner ratify by
returning a sound verdict, and the entry bind once the pull request merged. A reader holding that
wording waits for a verdict nobody posts. On 2026-09-24 the M1 coordinator flagged `D20` as merged
with no verdict. It later relayed a needs revision onto #196 after the owner's merge had ratified
it. Under rule 2, a verdict returned after the owner's merge rules on nothing.

Rule 3 follows from `D19` rather than changing it. `D19` rule 1 lets a maker merge once
`R-GATE-4`'s evidence is in hand, and that evidence holds every configured judge's verdict. Where
the owner is one of those judges and the merge is the owner's verdict, the evidence is complete
only once the card has merged.

The forge cannot tell the owner's merge from a session's. Sessions here act through the owner's
account, so rules 3 and 4 hold because sessions honour them, and nothing observes a breach.

This decision adds no requirement. It binds how the owner and the sessions working in this
repository ratify and merge, and `docs/spec/requirements.md` holds only what binds Rigger.

Two observations would reverse it. First, M5 installs the gate hook here, and that hook admits a
merge only once every configured judge has returned a verdict (`R-GATE-5`). Where the hook cannot
read the owner's merge as the owner's verdict, a later decision supersedes this one. Second, a
merge recorded as the owner's proves to be a session's. A merge alone is then too weak a record of
ratification, and a posted owner verdict returns.
