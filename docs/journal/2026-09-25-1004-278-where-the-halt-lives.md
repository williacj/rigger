ABOUTME: Records card #278, which places in ARCHITECTURE.md the halt on starts while L5's sink
refuses an event: the layer, the order of record and action, and what the emitter receives.

# 2026-09-25 — Where the halt lives

The halt is L3's, because L3 is the only layer that starts work. A halt anywhere else would have
to reach into L3's decision, which boundary rule 2 forbids.

It keeps no state. L3 appends each start's event before acting on the start, so that append is
already the probe that finds the sink recovered. A latch in L5 would be new state and a new
interface that only L3 reads, and it would still need an append to learn of recovery.

It is not the admission hold, for two reasons. `R-SCHED-4` lets only the owner reopen admission,
while the halt must lift once the sink accepts again. The hold is also persisted in `.rigger/`,
beside the stream that just refused a write, so the same disk is likely to refuse the hold.

The ruling on #277 records what reverses this: a sink that stops appending synchronously, an owner
ruling that no action at all runs while the sink refuses, or a start that cannot be recorded
before it is made.
