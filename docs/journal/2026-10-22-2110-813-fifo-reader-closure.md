ABOUTME: Records the bounded notification-reader closure repair and the limits of its causal evidence.

# FIFO notification after reader closure

The current #813 branch failed a writer-liveness assertion in macOS Node 24 CI run
39825701973, job 119988292227, at 75af5864e2a08b86618fa522b4bf2585cb249274.
The writer exited 1 while the waiter returned 5. That occurrence did not retain the writer
stderr or operation trace, so its cause remains unknown.

Under the PM's reviewed P1c grant, an actual-code preload stops the writer after successful
notification-FIFO open. Two independently owned gates establish that the real waiter settles
on its first file read and removes its FIFO before the writer's original write proceeds.
The unchanged stub then throws actual EPIPE and exits 1. The named regression fails the
writer-liveness assertion; the complete original, source snapshot and per-process traces
remain retained. These synchronized observations prove this controlled schedule, not the
cause of the earlier macOS occurrence.

The reviewed P3 grant permits only the local announce correction. A failed write is tolerated
only when its error is EPIPE and lstat independently reports ENOENT for the FIFO name.
A present object or any other observation error retains the original write error.
The descriptor still closes in the original finally. The contract comment states this
absence condition; the trace comment no longer claims timestamps establish causal order.

The real missing-FIFO regression now passes while still observing the actual write EPIPE.
A separate real reader closes without removing its FIFO, and the writer still fails EPIPE.
Two finite preload controls check error mapping only: an actual EPIPE survives an injected
EACCES observation, and an explicitly injected EIO survives without an absence probe.
An uncaught-exception monitor compares the propagated error with the actual saved object and
reports the final probe count. Those injected cases prove mapping, not real permission or
device-error behavior. Existing EACCES, EISDIR, EMFILE, malformed notification and SIGTERM
assertions remain unchanged. Original liveness assertions now include captured writer stderr
so a future failure retains that diagnostic.

Measured on Ubuntu WSL2 with Node 26.12.0: the unchanged ordinary baseline at the declared
head passed 2,614 tests with nine skips and no failures; its runner reported 56,206.5518 ms.
The final complete affected host file passed 23 tests with no failures, cancellations or skips;
its runner reported 2,454.780565 ms. Executed test-source SHA-256: 02b1eee0f63891915bd4e695f03dcea3f08b4c205130c84a71f21696a4b3308c;
stub-source SHA-256: 7a3b9d5d91e4d53ccd848f0eadb84a44a21686ab3491e319690cfb448e03073f. Complete originals and source snapshots remain retained.
Matrix, package-budget and header checks passed. No local macOS proof or historical repair
credit is claimed.

The acceptance author admitted the exact delta and finite controls in #813 comments
6351198068, 6351284780 and 6351339459 after independent scope review. A changed head and
acceptance require fresh implementation verdicts and supported-host checks before merging.
