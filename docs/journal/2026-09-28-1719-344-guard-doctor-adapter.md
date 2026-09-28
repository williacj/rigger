ABOUTME: Journal for #344 (M2-07b): the source-tree guard's `git` and `doctor`'s agent CLI probe
sending through L0's process adapter, and every verb stopping at a kill its sink could not record.

# #344 — The guard and doctor's probes through the adapter

## What was built

- `doctor.mjs`'s own spawn is now `runCommand`, with the verb's `L0` emitter and the forge
  adapter's `FORGE_TIMEOUT`, which ruling 2 (g) makes the one constant every non-dispatch call
  passes. `repoRoot`, `sourceTreeGuard` and `agentAuth` became asynchronous. `repoRoot` now answers
  `{ root }` or `{ root: null, why }`, so the guard's refusal says what git answered, a timeout
  included.
- `settled` in `doctor.mjs` is the one step every guarded verb takes: the guard, then naming the
  state directory, and where that naming is refused, a refusal naming each held event. `report`
  now opens a sink through `recording`, because its guard spawns too.
- `doctor` stops at an `EVENT_REFUSED` failure from any check, and the board checks throw it on
  rather than fold it into a failed line.

## What we learned

- **The first red was a hang.** Given a `git` stand-in whose child held the output pipe, the
  base's synchronous guard never settled. The run ended once an outside `kill` ended the child,
  and then recorded no kill.
- **A test of "Rigger's own source tree" needs no run from this checkout.** The bin resolves its
  package from its own location, so a copy of `src/`, `templates/` and `package.json` committed
  into a fixture repository is a source tree whose own bin refuses it. Its
  `git status --porcelain --ignored` is then measured on a tree nothing else writes to.
- **Mutations shown to discriminate** (anchor found once, the diff read back, the file restored
  with `git checkout`, `git status` clean), each run against the 13 tests in
  `test/guard-probe-kill.test.mjs`, which all reported:
  - `settled` handing the guard an emitter that drops events: 6 failed — the stream order, the
    source tree, no repository, the refused config and the refusing state directory tests on
    their kill-event assertions, and the SIGTERM test on its assertion that each kill is on
    standard error.
  - `doctor` pushing a failed line for a refused kill instead of stopping: the two refusing-sink
    `doctor` tests failed, each on its assertion that the output names the unrecorded kill.
  - `agentAuth` passing over `timedOut`: the probe timeout test failed.
  - `repoRoot` passing over `timedOut`: the guard timeout test failed.
  - `failedRead` folding a refused kill: the board-read refusal test failed.
