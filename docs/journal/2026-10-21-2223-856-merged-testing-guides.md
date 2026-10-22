<!-- ABOUTME: Records completion of the merged compatibility work's Windows and macOS checkout instructions. -->

# Testing guides after the compatibility merge

This completes the guide work delivered by [#835](https://github.com/williacj/rigger/pull/835)
for [#832](https://github.com/williacj/rigger/issues/832), against the acceptance in
[#856](https://github.com/williacj/rigger/issues/856). The two guides still selected the old
compatibility branch after it merged. Both now select `main`; the Windows troubleshooting
instruction uses that checkout, and the Mac verification paragraph distinguishes historical
experiment results from CI evidence for the exact commit being tested.

The change is limited to those passages. Installation commands, tool selection, platform checks
and test-success criteria remain as written. The experimental WSL test route still makes no
engine-host support promise.

No new Windows or Mac setup was executed for this documentation correction. The historical
verification journal remains the record of the setup and tests it measured.
