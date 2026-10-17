<!-- ABOUTME: Records the pinned engine promotion and the test closing R-GATE-1 during the M5 gate go-live. -->

# Gate go-live evidence

The owner merged the pin in #782 before requiring `rigger/gate` and `self-hosting`, then merged M5-02 in #728 as the first pull request through both checks. The P62 freeze holds other merges until #665's evidence pull request completes. The owner applied ruleset `23968611`; its read-back requires both contexts with the gate App's integration id and leaves the bypass list empty.

The M5-14 pin is `b1222c909562c4519666ac043e31b6d03c502149`. A clean checkout of that commit produced an `npm pack` tarball whose `src/package-commit.json` names the same commit. Its SHA-256 is `cb671a9bbb4a28fb0cdbfc097039ce2cd1e3be414e3bfedeffe22bd59e9a4075`, the package hash reported in M5-14's exit evidence. I installed that tarball at `/Users/cjwilliams/rigger-builds/engine/node_modules/@williacj/rigger`, outside the target checkout. The installed `rigger doctor` passed 13 of 13 checks against this repository, including `gate check required`.

`R-GATE-1` had no test declaration in the generated matrix. The added test reads the ten event and action pairs in `.github/workflows/rigger-gate.yml`. For each pair and both a human actor and a bot, it writes the event payload, projects the workflow's `NUMBER` and `IS_PULL`, and runs `card`, `map`, then `rule` against the same admitting and refusing marker sets. It compares exact stdout and exit status across those inputs. Guarded mutations that made the rule refuse a labeled payload, an issue event, or the bot actor each turned the named test red on its admitting assertion. I restored the script byte for byte between runs. The generated matrix names the test for `R-GATE-1`.

The evidence pull request carries the exact commands, times, read-backs, full test-run inventory and pending judge and owner steps for the gate's final merge.
