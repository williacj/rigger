ABOUTME: Card #1461's design of the safeguard that keeps a second attempt at a card from running
beside the first, and what drafting it taught.

# One live attempt per card

The design is at `docs/proposals/one-live-attempt-per-card.md`, a proposal for the owner.

What drafting it taught:

- Across hosts, "a second attempt never runs while the first is alive" cannot be guaranteed. A host
  that is unreachable with its supervisor dead cannot be told to stop. What can be guaranteed is that
  its writes take no effect, so the design separates that from the same-host guarantee, and hands the
  wording question to the PM's requirement proposal on #1455.
- Fencing by ordinal needs no clock, and only liveness does.
- A fence the forge holds is no fence while every attempt's agent writes with one credential. Round 1
  put it in branch names, and the judge showed a stale agent writing the current branch. Round 2 moved
  it into the card's workflow, which only accepted results change, and routed what the forge alone
  cannot refuse to the owner.
- The same-host check is itself check-then-act. A host-local lock that every process start takes
  closes the race with an earlier supervisor that is still running.

Every figure in the design came from #1429's and #1430's reports, opened at fbddb4b1; nothing was
measured for this card. Ten claims no spike has measured are named there with the spike for each.
