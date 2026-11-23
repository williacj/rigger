ABOUTME: Card #1461's design of the safeguard that keeps a later attempt at a card from starting on a
host beside an earlier one, and what three rounds of drafting it taught.

# One live attempt per card

The design is at `docs/proposals/one-live-attempt-per-card.md`, a proposal for the owner. Since the
owner's split it covers one host, and #1474 carries the fence.

What drafting it taught:

- A fence the forge holds is no fence while every attempt's agent writes with one credential. Round 1
  put it in branch names. Round 2 moved it to a workflow, and the judge showed that a current id does
  not authenticate its writer. Both halves left with #1474.
- A check that announces before it lists needs no lock. With a lock, its holder's death and reused pid
  are states of their own.
- A record that is removed when a dispatch settles cannot refuse the next attempt. Keeping the entry
  until the tree is shown gone makes a refused write fail closed, because the entry is already there.
- A check that lists entries before it reads events takes a panel's sibling for a missing record.
  Reading the events first closes that.

Rounds 1 and 2 said every citation had been opened at fbddb4b1. That was not true: #1431's report and
part of #1430's had not been, nor all of `ARCHITECTURE.md`. The proposal now lists what was opened and
what was not. Nothing was measured on a host for this card.
