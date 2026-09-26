ABOUTME: Records card #237, which landed `rigger report` over L3's events, and the three places
the work met an existing check or an acceptance item it could not meet as written.

# 2026-09-25 — `report` derives L3's signals

`rigger report` in `src/cli/report.mjs` refuses the tree it runs from, using the guard that
`doctor` and `plan` share. It then asks L5's report in `src/observation/report.mjs` for the
signals of each run in `.rigger/events.jsonl`. Each value is printed beside the facts it was
computed from: the span, the slot-release count, the summed pull-to-release time and the recorded N.

**Per run, because the definitions are per run.** The card defines both signals over "the run's
first event to its last" and "the recorded N". A stream holds one run per `run` id, so the report
prints one block per run. A test records two runs into one stream and shows that merging them
would give neither run's figures.

**A run with no `run.start` has no N.** A pull fired through `loop.pull()` records no `run.start`.
Without a guard the utilization printed as `NaN`. The report now says the run recorded no N and
prints its throughput alone.

**The CLI reaches the stream through L5's report, not the sink.** `test/event-sink.test.mjs` holds
that no production file outside `src/observation/` imports the sink. `ARCHITECTURE.md`,
"Telemetry", gives L5 both the sink and the report. So the reader call lives in L5's report
module, and the CLI imports only that module. The sink gained one export, `streamPath`, so that the
report names the path the sink writes rather than retyping it.

**Two ways to record every command were refused by an existing check.** The first attempt was a
preload that wrapped `node:child_process` in the bin's process. The check in
`test/git-environment.test.mjs` failed on it: a file that imports `node:child_process` must call
a spawner by name, and a wrapper forwarding to the original does not. That check is not this
card's to change. The test now runs the bin with a PATH that holds only two stand-ins, `git` and
`gh`. Each stand-in records its call; `git` then forwards to the real git and `gh` refuses. So
any command the run starts by name is either recorded or not found, and the test holds the run to
its full output. A command started by absolute path is outside the record's reach, and the test
says so.

**The acceptance's `main` SHA cannot hold a verb that has not merged.** One item requires the
engine for the run over this repository to come from `npm pack` at a `main` SHA. `main` has no
`report` until this card merges, and a tarball from `main` answers `not yet implemented`. The
run used a tarball packed at this branch's head instead. The pull request names that head and
leaves the item unmet as written.
