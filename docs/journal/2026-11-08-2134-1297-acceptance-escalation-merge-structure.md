<!-- ABOUTME: Where M8-06a's ARCHITECTURE.md delta placed each row of the card's Table P. -->

# Acceptance changes, escalation cause, merge freshness and holds placed

M8-06a (#1297) turns the architect's r1 and r2 reviews on #1293 (§1a, §3 "Q-G") and M8-U2 Q10 and
Q11 into one `ARCHITECTURE.md` delta. Each row of the card's Table P, and the section it landed in:

| Row | Section of `ARCHITECTURE.md` |
|---|---|
| P1 | Boundary rules, rule 2, the read side |
| P2 | Boundary rules, rule 2, the read side (rule 4's forge-adapter entry point covers it as written) |
| P3 | Telemetry, "L2's acceptance, escalation and merge events", `acceptance.history` |
| P4 | Telemetry, "L2's acceptance, escalation and merge events", `acceptance.history` |
| P5 | "Acceptance changes and who made them", listed under "What `report` derives", L2's section |
| P6 | "Acceptance changes and who made them" |
| P7 | "Acceptance changes and who made them" |
| P8 | "Acceptance changes and who made them" |
| P9 | "Acceptance changes and who made them" |
| P10 | Telemetry, "L2's acceptance, escalation and merge events", "The fallback"; its loss in "Acceptance changes and who made them", "Residuals" |
| P11 | Telemetry, "L2's acceptance, escalation and merge events", `review.escalate` |
| P12 | Telemetry, "L2's acceptance, escalation and merge events", `review.escalate`, the sites table |
| P13 | "What `report` derives", L2's section, "Escalations by cause" |
| P14 | Telemetry, "L2's acceptance, escalation and merge events", `merge.decided` |
| P15 | "What `report` derives", L2's section, "Merges with fresh verdicts" |
| P16 | "What `report` derives", L3's section, "Admission holds" |
| P17 | none |
| P18 | "Acceptance changes and who made them", "Residuals" |
| P19 | "Acceptance changes and who made them", "Residuals" |
| P20 | "Acceptance changes and who made them", "Residuals" |
| P21 | "Acceptance changes and who made them", "Residuals" |
| P21a | "Acceptance changes and who made them", "Residuals" |
| P21b | "Acceptance changes and who made them", "A window with no end" |
| P22 | none |

Three choices the reviews left to the architect, and made here:

- A role's escalation directory refused under `R-WORK-32` takes `class` `card-local`. `R-FAIL-8`'s
  table has no row for it, and "Failure model" groups it with the refusals the table classes
  card-local.
- `merge.decided` is recorded before the merge call, and a refusal of it stops the call, so a lane
  merge never lacks its record.
- A window with no `dispatch.end` ends at the next `run.start`, because a start kills every
  recorded group before L3 records anything.

The card's item 4 originally cited "boundary rule 2" for the one digest function, which is placed in
"Markers". After the reviewer's round-1 verdict, the PM revised item 4 to cite "Markers"
(1297#6741657336, acceptance revision b8838b416ac6). The delta cites "Markers".
