ABOUTME: Records how card #965 wrote the README's launchd installation steps and bound them to the
shipped template.

# The README's launchd installation steps

`D28` has a per-user LaunchAgent re-launch `rigger run`, and #963 shipped its template. The README
said only that unattended runs on macOS use launchd. The steps now sit under
`### Installing the launchd job`, after the verb block, because `test/cli.test.mjs` reads the
section's first fenced block as the verb contract.

Each claim about launchd rests on a cell the card's Table A marks in. The exit statuses come from
the S2 report, `docs/spikes/launchd-lost-cells.md`: 3 for a `bootout` of a label not loaded and 113
for its `print` (Q-o2), 5 for a repeated `bootstrap` (Q-o1), 0 for a first `bootstrap` (Q-a2).
The notice and the Login Items listing come from the S1 report's Q-k3, given as an observation on
the owner's host, with nothing said of its form or of a re-install. A `bootout` of a loaded label
exits 0, and `print` then exits 113 (Q-o1, Q-o2). The steps call that unloading the label, and
say nothing of a running process or of the next login with the plist left in
`~/Library/LaunchAgents`, since no spike measured either.

The S1 report's Q-m2 is a judgment, not a measurement: it attributes the missing log directory to
launchd from timing and mode, and its transcript is lost. The steps tell the owner to make no
directory on that reading, and say it is a judgment.

`test/launchd-install-steps.test.mjs` reads only `README.md` and the shipped template and spawns
nothing. It binds the placeholders both ways, the label in every command and plist path, the
template's path in the package, and the log paths. A template path is compared through
`realpathSync.native`, so the test holds whatever the checkout's casing.

## Red runs

- `node --test test/launchd-install-steps.test.mjs`, 2026-10-26T21:37Z, before any README text:
  all 9 failed, the first on `"Install and usage" holds 0 \`### Installing the launchd job\`
  headings`, the rest on `"Install and usage" has no \`### Installing the launchd job\` heading`.
- The same command, 2026-10-26T21:37:49Z, with the heading alone: the placeholders test failed on
  `actual: []` against the template's six; the launchctl, plist and label tests on `the steps hold
  no launchctl command`, `the steps name no plist under LaunchAgents` and `the steps name no
  label`; the template-path and log-path tests on `actual: []`.
- Nine guarded README mutations, each restored byte-exact, each redding the test named for it: a
  dropped or an extra placeholder, a stale label in `bootout`, a drifted log path, a wrong
  template path, a `doctor` launchd claim, `bootstrap` before `bootout`, another plist name, and
  the heading above the verb block.

## Round 2: unload, not stop

The reviewer on #993 found the first draft said a `bootout` stops the job "until your next login",
a case the card marks unmeasured. The PM revised the card to `d02c0fbaa459`: a `bootout` unloads
the label, and unloading it for good is that `bootout` followed by removing the plist.

- `node --test test/launchd-install-steps.test.mjs`, 2026-10-26T22:38:12Z, with the new test
  "the steps unload the label rather than claim to stop its process" against the first draft: it
  failed on `the steps claim a bootout stops the job`, and the other nine passed.
- At 22:38:17Z, with the README rewritten, it failed again on two defects of the test's own
  reading, not of the steps: a `launchctl print` named without its target, and a sentence match
  that stopped at the first dot of the plist's name. The README now says "step 4's `print`", and
  the test reads the sentence to a dot that ends it.
- Three guarded mutations, each restored byte-exact, red that test: "To stop the job", "Until
  your next login", and the "for good" sentence without the removal.
