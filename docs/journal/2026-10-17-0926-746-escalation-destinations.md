ABOUTME: Journal entry for #746, the proposal that lets an escalation go to a configured role:
what the draft missed, and what the reference check does not verify.

# Escalation destinations, proposed

#746 proposes `D26`, eleven `R-ESCALATE` rows, two `R-WORK` rows and the destinations table. It
withdraws `R-ESCALATE-1` to `-3` and `R-WORK-30`. The pull request is the proposal; the owner
ratifies it under `D25` rule 4.

**The draft missed one citation of the row it withdrew.** The card's sweep listed the tests and
documents citing `R-WORK-30`, but not the cell in `### R-SCHED-26 — Unknown mergeability at a
merge` that answers a merge read while mergeability is unknown. Its grep item caught it. The cell
now cites `R-WORK-33`, which keeps everything `R-WORK-30` required, so `R-SCHED-26` keeps its id.
A withdrawal's sweep should grep the register itself, tables included, not only the files around
it.

**`npm run check:references` verifies `path:line` pointers and nothing else.** It reads no
requirement id. `D26` rule 3 cites `R-ESCALATE-12`, which only #745 adds, and the check passes
with that id absent from both registers. The attack on #746 read the check's pass as evidence for
`D26`'s citations; it is not. A citation of an id another open card allocates resolves only once
that card merges, so the merge order is the evidence, and the pull request names it.

**A row's table may be headed by a sibling row's id.** The card heads the destinations table
`### R-ESCALATE-14`, and `R-ESCALATE-13` is the row that cites it. The preamble has the heading
begin with the citing row's id. The heading is the card's acceptance, so it stands, and the pull
request names the gap for the card's author.
