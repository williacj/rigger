ABOUTME: Journal for #347 (M2-08): L1 records each dispatch's start, its timeout and one end, and
reports every event it could not record, and what building that taught.

# #347 — one end for every recorded start

## What the choices were

- **The event names.** `dispatch.start`, `dispatch.timeout` and `dispatch.end`, all under `L1`.
  `ARCHITECTURE.md`, "Telemetry", shows `dispatch.end` and says field names are not yet fixed.
  The end carries `exit` and `ms` where the command ran, and `reason` and `ms` where it never
  started, so an end holds an exit code or a reason, never both (ruling 2, §4, on #332).
- **The timeout is its own event, appended after L0 settles.** L1 learns of the timeout only
  from L0's result, which carries `timedOut`. So the event's timestamp is the settle, not the
  kill. The acceptance needs an event of its own, because a sink refusing only that event has to
  be told apart from one refusing the end.
- **A record that cannot be written now rejects as `NOT_STARTED`.** Ruling 2, §4, counts "a state
  directory the record could not be written into" among the reasons a command did not start, so
  the caller reads it as the same kind as a missing command.
- **One refusal, however many events went unrecorded.** Where L0 already rejected as a refused
  event, L1's unrecorded events join its `unrecorded` list and its message. Where the dispatch
  had any other failure, such as a command that never started, a refused end turns the rejection
  into a refused event, with that failure as its `cause`. A refused event is what stops L3's
  starts, so it wins.

## What I learned

- Every test through L1 of an event refused after the start needs a sink that refuses by layer
  and event, not one under a regular file. Once L1 appends a start, a sink that refuses everything refuses the start, and
  the command never runs. The earlier test of a refused kill went red that way, never reaching the
  kill, and now refuses `L0` events alone.
- The duration needs its own clock. The sink's clock stamps `ts` and is the run's; the dispatch's
  duration reads a monotonic one, injectable, so a test states the exact `ms` without a sleep.
