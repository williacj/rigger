ABOUTME: Journal for #1017 (M7-01): "Telemetry" fixes the envelope, the events each signal
derivation reads, and `report`'s output shape.

# #1017 — the telemetry contract `report` derives from

At `66e5b7c9`, "Telemetry" closed its abbreviated example with "Field names are not yet fixed".
It also said L2 records a tier correction, which no code does. M7's report cards each need one
input contract and one output shape, or each will invent its own. The r1 review on #1009
(1009#6433591635) found that as S1. It also gave the derivations: S2 for L1, S3 for the redo after
an interruption, and S4 for the tier correction L2 cannot see.

The delta fixes only the events a derivation reads. Naming every event the code emits would
retype a fact the code owns (`D8` rule 3, S1). A closing rule leaves every other event with the
fields the card that adds it gives it.

The redo after an interruption is not S3's. The attack on this card (1017#6440697354, finding 1)
showed that L1's `dispatch.end` recorded as Rigger exits carries an exit code, as a normal end
does. The redo ruling (1009#6440744086) derives it from L3's claim events instead: `pull`,
`slot.release`, `merge.start` and L3's `dispatch`. The delta quotes the ruling's definitions, its
residual and what would reverse it.

The tier correction follows the owner's M7-U2 item 7 (1009#6434513387), Q8 (a). L5 derives it from
L3's `dispatch` events, which carry each dispatch's role and tier. The layer table's L4 row now says
so, in place of naming L2.

`report` shows no L6 section until L6 emits events, as M7-K4 (1009#6434590678) places L6 in M9 and
M10. L0's substrate fault rate waits on M7-08, which places L0's call events.

Choices the card left to the maker, each a judgment on the code at `66e5b7c9`:

- **Host faults** count `maker.failed`, `judge.withheld`, and `attempt.failed` carrying
  `class: 'environment'` and no `maker`. A maker that never started records both a `maker.failed`
  (`src/workflow/transitions.mjs`, `settled`) and an `attempt.failed` carrying `maker`
  (`src/workflow/next-action.mjs`, `within`), so counting both would count one fault twice. The
  denominator is work claims, as the redo derivation defines them.
- **Escalation rate** is cards escalated over cards pulled, so an escalation a later invocation
  repeats counts once ("Escalation").
- **Survivor rate** leaves out a `dispatch.end` carrying `reason`, which L1 records where it got
  no result for the command. That end can still follow a group L0 killed, as where L0 could
  not read the leader's start (`src/substrate/process.mjs`, `startOf`).
- **Tier accuracy** is over pairs of a card and a role. It leaves out a step's L3 `dispatch`, which
  can name a judge's `role` but carries no `tier`.

The abbreviated example now shows only events and fields the code emits. It keeps the two instants
`test/event-sink.test.mjs` reads off it.
