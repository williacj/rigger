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
- **Mutations shown to discriminate.** Each was run on 2026-09-28, at the head after the merge of
  `origin/main` (`ca86596`) plus the items 24 and 25 tests, against `test/guard-probe-kill.test.mjs`
  through `npm test -- test/guard-probe-kill.test.mjs` with TMPDIR outside any checkout. Unmutated,
  that target reports 19 tests, 19 pass. For each mutation:
  - the anchor was counted in the file's bytes, and it occurred exactly once;
  - after the write, the file was read back off disk. It held the replacement, the anchor 0 times,
    and `git diff` showed the one hunk;
  - the run reported 19 tests, each by its own name, so the mutant loaded and reached a verdict;
  - the file was restored with `git checkout`, and `git status` then showed no change to it.

  Each row below gives the file, the anchor, what replaced it, and each test that failed with the
  assertion it failed on.

  1. `src/cli/doctor.mjs`, `settled`: `{ ...options, emitter: sink.emitter({ layer: 'L0' }) }`
     became `{ ...options, emitter: { emit() {} } }`, so the guard's kills went nowhere. 12 of 19
     failed:
     - the stream-order, source-tree and no-repository tests failed in `holdsChildKill` on
       `assert.equal(kills.length, 1)`, with actual 0. The refused-config test failed where it
       reads the stream, `readEvents(state)`, with `ENOENT`, because no event was ever written
       there. That is a failure of the claim, and not a mutant that failed to load: the other
       tests in the run reached their own assertions;
     - the SIGTERM test failed on its per-process `assert.equal(of.length, 1)`, with actual 0;
     - the `once` refusing-directory test and the six per-verb tests each failed at their first
       reading of the run. `once`, `run`, `report` and `doctor` failed on
       `assert.match(ran.err, /went unrecorded/)`: the verb went on and failed later for another
       reason (`the event sink refused to record the pull trigger`, `EISDIR ... so no signal is
       derived`, `11 of 12 checks passed`). `plan` and `setup-board` failed on
       `assert.notEqual(ran.code, 0)`, because they exited 0 (`the next run would pull 1 card`,
       `7 writes to board 3`).
  2. `src/cli/doctor.mjs`, `checking`: the line `return { text: \`rigger doctor: ${failure.message}\`,
     code: 1 };` became `results.push({ name: 'refused', ok: false, detail: 'x' });`, so the refused
     kill was folded into a failed line. 2 of 19 failed: the refusing-sink agent probe test and the
     board-read refusal test, each on `assert.match(ran.err, /went unrecorded/)`. The report printed
     `10 of 12` and `3 of 6 checks passed` instead.
  3. `src/cli/doctor.mjs`, `agentAuth`: `if (said.timedOut) {` became `if (false) {`. 1 of 19
     failed: the probe timeout test, on `assert.match(said.detail, /timeout of 1000 ms ended \`claude /)`.
     The detail read `` `claude auth status --json` exited 137 and stated no `loggedIn` ``.
  4. `src/cli/doctor.mjs`, `repoRoot`: `if (said.timedOut) return { root: null, why:` became
     `if (false) return { root: null, why:`. 1 of 19 failed: the guard timeout test, on
     `assert.match(refusal?.text ?? '', /timeout of 1000 ms ended \`git /)`. The refusal named git's
     exit instead.
  5. `src/cli/doctor.mjs`, `failedRead`: the line `if (threw?.code === EVENT_REFUSED) throw threw;`
     was deleted. 1 of 19 failed: the board-read refusal test, on
     `assert.ok(ran.err.includes('/usr/bin/tail -f <directory>/hold'))`, with actual false. The report
     printed `3 of 12 checks passed` and named no kill.
  6. `src/cli/doctor.mjs`, `settled`: the line
     `return { refusal: { text: \`rigger ${verb}: ${refused.message}\`, code: 1 } };` became
     `return guarded;`, so a refused naming was passed over. 7 of 19 failed: the `once`
     refusing-directory test and all six per-verb tests, each on the same first assertion and with
     the same output as in mutation 1.
  7. `src/cli/report.mjs`: `recording((opened) => reporting(opened, options));` became
     `recording((opened) => reporting({ ...opened, name: () => {} }, options));`, so `report` never
     named its state directory. 1 of 19 failed: the per-verb `report` test, on
     `assert.match(ran.err, /went unrecorded/)`. The held kill was written to standard error as a
     bare event line, which says nothing went unrecorded.
