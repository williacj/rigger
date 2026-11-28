ABOUTME: Card 1480's record of how text that isn't the spikes' own was masked or withheld in the evidence of #1429, #1430 and #1431, under which rulings, and how it was checked.

# Card 1480: masking by a rewrite of main's history

The reports and evidence of #1429, #1430 and #1431 held text that isn't the spikes' own: process, program, service, account and host names, and paths, directory listings and account rows that hold them.

Process, program and service names, and the paths that hold them, were masked under the owner's ruling of 2026-11-23 at [1480#7113575800](https://github.com/williacj/rigger/issues/1480#issuecomment-7113575800). That ruling applies the masking rulings at [1458#7090273806](https://github.com/williacj/rigger/issues/1458#issuecomment-7090273806), [1459#7090274068](https://github.com/williacj/rigger/issues/1459#issuecomment-7090274068) and [1460#7090274317](https://github.com/williacj/rigger/issues/1460#issuecomment-7090274317), and the hash amendment at [1459#7104456293](https://github.com/williacj/rigger/issues/1459#issuecomment-7104456293), to the three spikes' files.

Host and account names were masked, and account rows and listing lines that hold such names were withheld, under the owner's ruling of 2026-11-26 at [1480#7229678618](https://github.com/williacj/rigger/issues/1480#issuecomment-7229678618).

The masks were applied by rewriting main's history, and not by a pull request. The ruling of 2026-11-23 had asked for a pull request and left history as it was; the ruling of 2026-11-26 replaced that with the rewrite, so that no commit on main holds the masked text.

The rewrite's privacy check is recorded at [1480#7229748844](https://github.com/williacj/rigger/issues/1480#issuecomment-7229748844). Its checkers were independent privacy checkers, each a fresh session that made neither the masking nor any of the three spikes. The check covered everything the rewritten commits introduce, every blob, path and commit message, in every historic version and not only the tip: the 159 commits rewritten on 2026-11-26 and #1508's 3 on 2026-11-27, 162 commits from 2026-11-19 on. Its result was CLEAR, before the push of 2026-11-27 that made main 1f317541.

What taught us: masking at the head by a pull request would have left every earlier commit serving the text, so a record that must not be public is cleared from history, not from the tip.
