ABOUTME: Journal for #335 (M2-S1): what a headless Claude CLI session and a cold cargo build left
outside their process group on macOS, and which census found it.

# #335 — What leaves the process group

## What ran

A throwaway Node harness, kept in the gitignored `spikes/`, ran eight runs on macOS 27.0 on
2026-09-27. They were four headless `claude -p` sessions, one cold `cargo build --workspace` of
Tauri's workspace at `tauri-v2.12.0`, and three controls. Every run but one was stated on #335
before it was made. The exception is the second control, under "What failed". The findings, the
readings, the recommendation and every observed process are in
[the report](../spikes/what-leaves-the-process-group.md).

## What we learned

- **Every Bash tool call leaves the group.** Claude Code runs each one in a zsh that leads its own
  process group. A group-only census therefore sees none of a dispatched agent's shell commands.
- **Two routes left survivors.** A `nohup … &` child outlived the group by about 108 s and 114 s
  after a normal exit. A group
  kill during the session left both the background task and that child alive, for 86 s and 119 s.
- **Nothing of a cold cargo build outlived its group.** All 1,571 processes `ps` saw stayed in it.
  One more, seen only by the working-directory census, lived too briefly to read its group.
- **The marker test first read "no environment anywhere".** That was because the first processes I
  read were all `/bin` binaries. The pattern only showed once a `node` process was read beside
  them: `ps -E` returns the environment of a non-Apple binary and withholds that of an Apple
  platform binary. Every survivor the CLI left was an Apple binary.
- **Parent tracking at 50 ms missed the `&` survivor in all three runs that had one.** Its parent
  zsh lived for less than one interval, or was sampled only as a zombie, and the survivor was
  reparented and in a foreign group before its first sample. The working-directory census ran in
  two of those runs, and found the survivor both times.

## What failed

- **My pre-run comment for the second control went up after that run.** A tool guard refused my
  first post, and I ran the control without noticing. The addendum on #335 says so.
- **The first Claude run's prompt used `sleep 120 & …`, which Claude Code's Bash tool refuses
  outright.** That run tested only `run_in_background`.
- **The harness first waited for its mid-run readings before taking the census.** It also read
  `lsof` on a socket fd that had closed and been reused. Both were fixed from run 3, and the report
  discards the affected reading.
- **The first appendix left out the one cargo process only the census saw.** Its generator listed
  a census-only pid only when a named one existed too, and cargo had none. The report now lists
  every entry of every census.
