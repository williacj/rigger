ABOUTME: Journal for #951 (M6-S2): what re-measuring #744's lost launchd cells on the Mac mini taught us,
and what kept its transcript alive. The report is `docs/spikes/launchd-lost-cells.md`.

# #951 — launchd's lost cells, re-measured on the Mac mini

**What we learned.** launchd accepts a job whose program does not exist. The bootstrap exits 0, and
the only signs are `last exit code = 78: EX_CONFIG` in `launchctl print` and an error line in the
system log, so a check for a missing program has to look at the path itself. A second bootstrap of
a loaded label exits 5 and leaves the old job in place, edits and all ignored, so a re-install is
always a `bootout` then a `bootstrap`. Commands run over SSH, in a `Background` session, got the
same answers from launchd as the same commands run at the console, in `Aqua`. `codex login status`
never says which `auth.json` it read.

**What worked.** Every command the cells rest on went through one wrapper, which wrote a numbered
transcript entry on the mini, under `~/Library/Logs`. The scripts that ran over SSH and in the
owner's session were the same file with one argument changed, so each pair of readings compared
like with like. The raw outputs were posted on the card as the run went, so a judge never needs a
route to the mini.

**What failed.** Not every command went through the wrapper:
- The first commands, and the setup writes over SSH, ran before the wrapper existed or beside it.
  They were recorded after the fact, grouped, with hand-typed, approximate times.
- The four script invocations were never entries of their own.
- Later laptop commands and read-only SSH reads were recorded in grouped notes.

So the transcript is not one entry per command. The wrapper should exist before the first command,
and each command, including each script's own start, should be its own entry.

The owner's one-key answers in batch 3b were taken from keys already typed, because the script
never flushed its input. A prompt should flush input and accept a key only after the event it asks
about.
