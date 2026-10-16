<!-- ABOUTME: Records the restored sighting guard and the bounded diagnostic for hosted failures. -->

# #615 sighting diagnostic

The independent review of c2e75fd found that its second writer could create
the sighted-live marker after the original per-PID state check rejected the
process. I removed that writer. The selected-base state assignment and case
remain the only route to the marker. A prepared fixture now keeps the status
and exact returned state of that original read in a separate private file. On
a missing marker, the test emits only a fixed state category and numeric
status before the unchanged assertion.

The first focused diagnostic at
/private/tmp/c615-sighting-probe-r813h1j1 failed two tests because I inserted
the probe line into the strict READ/PHASE/ROW/END trace. This was a diagnostic
setup error, not a finding about the hosted failure. I moved the line to its
own file. The next focused attempt at
/private/tmp/c615-sighting-probe-n1gfn0sx passed both tests; both preserved
per-PID states were S with exit status zero. It did not reproduce the hosted
failure.

The guarded local full suite at
/private/tmp/c615-sighting-probe-1i9w6jmb exited zero: 3,309 tests,
3,292 passes, zero failures, 17 skips. Its stdout SHA-256 is
c313a354b03cbac96a011ee764fd3536f6bc74f1043d82c280fdfb6df861fbbe;
stderr is empty. The full-suite gate recorded 12 logical CPUs, one-minute
load 2.93, 471 current-user processes, and no live suite. All three
original roots were copied byte-for-byte to
/Users/cjwilliams/GitHub/rigger-worktrees/tq-tools/615-f190-evidence/private-originals/,
as checked with rsync -ani --checksum.

The failed #730 hosted jobs remain failed and uncredited. Their inner
per-PID state was not present in the standard logs. This diagnostic is meant
to classify that state in any later authorized hosted run; it is not a claim
that the hosted failure is fixed.

After the independent reviewer requested a fixed-category TAP projection,
the corrected two-case run at /private/tmp/c615-sighting-probe-nmnwm1nt
passed two tests. The exact-source full suite at
/private/tmp/c615-sighting-probe-1cs_kwxh exited zero: 3,309 tests, 3,292
passes, zero failures, 17 skips; stdout SHA-256
0cc77b70cb89f8a2a57cdf276a837b3c97a4eac75494f6e7b0822349a097aa35
and empty stderr. Its gate recorded 12 logical CPUs, one-minute load 3.63,
478 current-user processes, and no live suite. Both roots were copied to the
same private-originals directory and compared byte-for-byte with
rsync -ani --checksum.
