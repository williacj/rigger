ABOUTME: Proposal for a repository rule on measured figures asserted in prose, outside D16's code scope.

# Evidence for figures in prose

This is card #115's proposal for the owner to ratify or reject. It changes no binding document.

The [card](https://github.com/williacj/rigger/issues/115) records three M0 uses of D16 outside its scope. A reader then has to work backward from a memorable rule 3 sentence to discover that rule 1 binds only a tool-owned fact used by code. A prose figure can remain stale or misattributed while its author and judge have no figure-specific instruction to cite.

## The existing boundaries

`docs/spec/decisions.md`, D16 rule 1, says: “A tool or command outside Rigger is an authority for a fact it owns, and this entry binds that class alone.” Rule 2 begins “Code carrying a copy of an authority's answer,” and rule 3 begins “Code depending on an authority.” The scope is correct as written: D16 governs Rigger code depending on a tool's answer, not a number in a PR body or journal. D16's Notes make the edge explicit: “That read depends on a document that owns a fact rather than on a tool that answers for one, so no rule here reaches that dependency.” The read named there is the budget scripts' read from `ARCHITECTURE.md`.

Three existing passages assign nearby duties without stating how a session supports a measured figure in prose:

| Source | Its own words | Ground it covers |
|---|---|---|
| `docs/spec/decisions.md`, D8 rule 3 | “A fact is generated when the code owns it and an author would otherwise retype it.” | A code-owned fact moving into a document. |
| `AGENTS.md`, “Documents own their facts” | “Every sentence takes one of three treatments: **own it** — intent, decisions, prohibitions; **refer to it** — a fact owned elsewhere, written as a reference and never retyped; or **do not say it** — neither owned nor referenceable.” | A document referring to a fact another document owns, and its own claims. Its next sentence bars line counts and grep results in a binding document. |
| `docs/spec/decisions.md`, D16 rules 1–3 | “Code carrying a copy of an authority's answer — a pattern, a threshold, a list — ties that copy to the authority with a test that asks it.” | Code depending on an outside tool or command, with a measured account of where their answers can differ. |
| `ARCHITECTURE.md`, “Budgets” | The “Production lines” table states “**Package**” at “**12,000**”; the instruction paragraph says “Instruction files carry one budget of their own, covering the root `AGENTS.md` and every nested one together” and “The budget is 2,500 words.” | The separate figures read by `scripts/package-budget.mjs` and `scripts/instruction-budget.mjs`, respectively; neither governs how a prose report supports its own numbers. |

`AGENTS.md`, “How we work”, also says “Evidence beats assumption” and “Verify before you recommend.” Those words govern every session's conduct, but they do not say what source, ref, or scope a figure in a PR body, card, journal entry, or verdict must carry. No explicit obligation with that form exists today. This is a proposal to make the expected evidence visible, not a claim that numerical assertions are presently permitted without evidence.

## Evidence that D16 was stretched

The current [PR #110 body](https://github.com/williacj/rigger/pull/110), under “Round 2,” says:

> This body cited `D16` for "every count was run at the ref it is named at".

Its “Verification” section now names `AGENTS.md`, “Evidence beats assumption,” and says the earlier revision cited D16. This surviving body is evidence of the correction; the earlier edited body is unavailable. The claim concerns measured figures in PR prose, so D16 rule 1 does not reach it.

Issue [#115](https://github.com/williacj/rigger/issues/115) reports two coordinator briefs: one on PR #110 used D16 for a stale journal figure; an earlier one used D16 for the budget scripts reading `ARCHITECTURE.md`. The original briefs are unavailable. These are the issue author's incident descriptions, **not quotations from the briefs**. A journal figure is prose and outside D16's code-and-tool class. The scripts' budget read is code depending on a document, and D16's Notes expressly exclude it. Both uses reached past D16's scope as the card describes, but their exact wording cannot be checked against an original brief.

## Two places for the obligation

**A rule in `AGENTS.md`.** “Every session” is the population that writes PR bodies, cards, verdicts, and journal entries. A new paragraph beside “Documents own their facts” would reach each without changing D16 or imposing a product requirement on a Rigger deployment. The cost is another instruction for every session, and one that humans must review rather than a mechanical test. It gives a reader a section to cite, but no D#.

**A new D#.** A decision entry would give the obligation a durable id and record why it was chosen and what would reverse it. It would also place a session-writing rule in a register whose preamble says a decision records a choice among structures that satisfy requirements. No choice about the product's structure is needed here. Its rule would still need the role prompts or `AGENTS.md` to tell sessions to apply it. That duplication raises the chance of a citation to a memorable sentence outside its scope—the failure that led to this card.

**Recommend the `AGENTS.md` rule**, subject to the owner's ratification. Proposed wording for a paragraph beside “Documents own their facts”:

> When a session asserts a figure in prose, it says whether the figure is a measurement or a judgment. A measured figure names the tool or source that produced it, the ref or date and scope measured, and the result. A claim about the present state is measured on the state it describes. A historical figure names its historical state. A judgment names its premise and is not dressed as a measurement.

This wording asks an author to show a reader what was counted, where, and when. It does not make every number a machine-checked import or require a command transcript inside a binding document. A PR body can carry the measurement; a binding document can refer to it while owning only its rule or decision.

The owner should reverse or narrow this choice if repeated reviews show that the added provenance costs more than the inaccurate figures it catches, or if a product-level structural choice emerges that deserves a D# and a test. The first would weaken the rule; the second would move that distinct choice to the register.

## Application to the three cited instances

| Incident | Read the proposed wording against it | Would the proposed rule catch it? |
|---|---|---|
| Coordinator brief on PR #110, described by issue #115 as citing D16 for a stale journal figure | A journal count presented as current must be measured on the state it describes. A historic count must name its historic state. The brief's unavailable words cannot establish which claim it actually made. | **Yes for the stale-current-state defect the issue describes.** A clearly marked historical figure would pass; the original brief cannot be independently classified. |
| PR #110 body, quoted from its surviving “Round 2” account above | Its claim says the counts were run at named refs. If so, the proposed rule accepts the measurement. D16 still cannot support that prose claim. | **No refusal of the figure on the surviving evidence.** This rule supplies the proper `AGENTS.md` home; the existing citation-verification paragraph rejects the D16 citation. |
| Earlier coordinator brief, described by issue #115 as crediting D16 for scripts reading `ARCHITECTURE.md` | The budget scripts read a document-owned figure. That code dependency is outside a rule for figures asserted in prose. D16's own Notes say no rule there reaches it. | **No.** The proposed prose rule would not govern this read. The existing D16 scope and citation-verification rule already answer the misattribution. The original brief is unavailable. |

## Boundary and cost

This proposal leaves D16's scope and wording intact because its rule and Notes are correct. It does not add a generic provenance checker: a command can print a number without proving the prose describes it honestly. It does not move code-owned generated facts out of D8. It does not choose a source of truth for the budget scripts; `ARCHITECTURE.md` already owns their figures.

The cost is author effort to preserve a measurement's command, scope, and state, and reviewer effort to open that source. That is proportionate to a figure on which a decision or acceptance ruling rests. There is no new CLI verb, product requirement, or architecture layer implied by this repository instruction.
