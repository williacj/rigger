<!-- ABOUTME: Records card 1466's retention of tracker answers for a dispatch ending during an in-flight read. -->

# Card 1466 — read recipient lifetime

The coordinator's pre-round-three attack found a dispatch that started and ended
while another dispatch's tracker read was in flight. It was absent from both the
starting recipient snapshot and the still-running recipients at settlement.
Success lost its escaped descendant; failure lost its descendants.unread event.
The retained P1 and P2 probes reproduced both assertions at e281b7dd; their
control passed. Originals are in codex-1466-tmp/1466-r4-attack-red.log.

Read eligibility now lasts until the dispatch's own final read has settled.
Stopping periodic service leaves that eligibility intact. Both asynchronous and
synchronous final reads close it explicitly. The shared tracker still owns its
single read queue and periodic timer; a dispatch ending never moves its peer's
cadence. The invariant comment states the recipient lifetime beside that owner.

T11 adds B ending before settlement to the existing generated interleavings,
for admissions before or during the read. An admission after settlement cannot
end before it. Each case retains descendant attribution and unread assertions,
read serialization, timer uniqueness and peer-cancellation checks. An all-ended
case requires no periodic timer; a live peer retains the deadline checks.
The expanded matrix first failed twenty child assertions and then passed all
100 cells plus the slow-read and exit-sharing cases. P1, its control and P2 then
passed, as did both unchanged round-two judge probes. Complete originals and
restoration records use the 1466-r4 prefix outside the checkout.

The consumer and fault searches include synchronous exit reads, network
inventories, suite lists, fake-gh, in-process fixtures and the generated matrix.
No outside-scope edit is required. G2 covers network coordinates and statement
pins; the matrix changes only lines this card added. No proves declaration
changes. Existing reasons, program lists and assertions remain under their grants.

PR 1475 records serial final-head verification, guarded receipts, the unchanged
Mac containment verifier, a fresh clone and CI. Acceptance K7 f5f416c9b828 is
unchanged. Item 27 stays pending the authorized ci:full sequence; local host
proof is macOS only, and Linux remains unproved under D13. The coordinator
arranges independent judgments. No label changes or merge are made.
