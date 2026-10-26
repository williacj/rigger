<!-- ABOUTME: Records how doctor and plan report admission, and the one function the three verbs name a closer with. -->

# `doctor` and `plan` report a closed admission (#962)

`doctor` gains an `admission` check, last in `CHECKS`. It reads `.rigger/admission/` through L3's module, needs only the state directory, and so reports where the config cannot be read or is refused. Open and closed answer `ok`, so a closed admission leaves the heading's count and the exit status as they are with the directory absent; unreadable answers `failed` and names each path and cause (`R-SCHED-17`).

`plan` reads admission before anything else, so it names admission's state beside any other read it fails. Closed, it prints no `pull` line of any action, names each closer, and exits 0. Unreadable, it prints no `pull` line, names each path and cause, and exits non-zero. In both it still reports its refusals and escalated cards, so one run shows everything to fix (`R-SCHED-18`).

`plan`'s exit status follows the architect's Q1 ruling on #962, which rests on the Q1 ruling on #936 that #940 put in `ARCHITECTURE.md`'s "Failure model": a closed admission is no failure of the pull, and an unreadable one is.

`closedBy` in `src/cli/doctor.mjs` holds the words that name a closer. `once` imports it in place of its inline copy, and a test pins `once`'s output to the words it printed at a4edcfb, #944's merge. The unreadable wording is shared the same way, between `doctor` and `plan`.

Each new test failed before its code existed for the reason it names: the `doctor` tests on a missing admission line, the `plan` tests on pull lines still printed and on failures that named no closer, and the `once` test on the closer words still written in `once.mjs`.

The test that compares `doctor`'s check names both ways gains `admission` last, under the card's grant class G2, as `CHECKED` and `UNREAD` do.

`src/cli/verbs.mjs` also changes, outside the card's "Lands in": `test/cli.test.mjs` holds `--help`'s `doctor` summary equal to the README's comment beside `doctor`, so the README line the card asks for cannot land green without the same words in `--help`. That is escalated to the card's author as `ambiguous` against the "Lands in" item.
