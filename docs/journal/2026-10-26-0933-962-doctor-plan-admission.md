<!-- ABOUTME: Records how doctor and plan report admission, and the one function the three verbs name a closer with. -->

# `doctor` and `plan` report a closed admission (#962)

`doctor` gains an `admission` check, last in `CHECKS`. It reads `.rigger/admission/` through L3's module, needs only the state directory, and so reports where the config cannot be read or is refused. Open and closed answer `ok`, so a closed admission leaves the heading's count and the exit status as they are with the directory absent; unreadable answers `failed` and names each path and cause (`R-SCHED-17`).

`plan` reads admission before anything else, so it names admission's state beside any other read it fails. Closed, it prints no `pull` line of any action, names each closer, and exits 0. Unreadable, it prints no `pull` line, names each path and cause, and exits non-zero. In both it still reports its refusals and escalated cards, so one run shows everything to fix (`R-SCHED-18`).

`plan`'s exit status follows the architect's Q1 ruling on #962, which rests on the Q1 ruling on #936 that #940 put in `ARCHITECTURE.md`'s "Failure model": a closed admission is no failure of the pull, and an unreadable one is.

`closedBy` in `src/cli/doctor.mjs` holds the words that name a closer. `once` imports it in place of its inline copy, and a test pins `once`'s output to the words it printed at a4edcfb, #944's merge. The unreadable wording is shared the same way, between `doctor` and `plan`.

Each new test failed before its code existed for the reason it names: the `doctor` tests on a missing admission line, the `plan` tests on pull lines still printed and on failures that named no closer, and the `once` test on the closer words still written in `once.mjs`.

The test that compares `doctor`'s check names both ways gains `admission` last, under the card's grant class G2, as `CHECKED` and `UNREAD` do.

`src/cli/verbs.mjs` changes its `doctor` summary alone, because `test/cli.test.mjs` holds it equal to the README's comment beside `doctor`. The card's revision 558d98362f76 added it to "Lands in" after round 1 escalated it.

Round 1's judges found three gaps.

- A closer's reason is any non-empty string, and an entry's name any the file system allows, so either can carry a line break. Printed raw, a reason ending in a line `  pull    #999  change` printed a pull line under a closed admission. `doctor` and `plan` now print each reason, path and cause through `printable`, which escapes the C0 and C1 controls, DEL and the two Unicode separators, and leaves every other character as it is. An ordinary reason so still reads in `once`'s words exactly. `once` itself prints them raw as it did at #944's head, which the card requires unchanged.
- The no-write tests compared names and bytes, so a rewrite of identical bytes passed them. They now pin the directory's and each entry's modification time to 2020 before the run, and compare inode and nanosecond modification time beside the bytes. Pinning rather than comparing two recent times keeps the check deterministic on a file system whose clock ticks coarsely.
- Three declarations survived the removal of what they named: the `once` wording test, the `closedBy`-only test, and the open-admission tests. Those declarations are gone. The no-write tests now also assert the closed or unreadable report, so they fail when admission reporting is removed.

Round 2's judges ran on a host where `~/Github` and `~/GitHub` name one directory. The new tests spelled expected paths with `realpathSync`, which keeps the casing it is handed, while the verbs name paths with `doctor.mjs`'s `real`, which answers the file system's own casing. So seven tests rejected correct output. They now spell paths with `real` itself, and pass with `TMPDIR` spelled in a casing other than the one on disk. Their stamp also missed a permission change, so it now carries each entry's mode, link count and owner beside the inode and modification time.

Round 3's reviewer found the no-write and no-event tests checked an existing admission directory only when closed or unreadable. A read that wrote `.read-note` into an empty or dot-only directory, or that recorded an `admission.read` event while open, passed them. Both tests now run every Table A state on a consumer of its own: absent, empty, dot-only, closed and unreadable. Each run stamps any directory that exists whole, dotfiles included, and reads that run's own stream for any event whose name starts with `admission`. Under each of the two mutants, both tests failed on the intended assertion before the round's commit.
