<!-- ABOUTME: Records the bounded proof corrections and real-host verification for card 832. -->

# Containment proof corrections

The owner requested continued work on PR 835 until its independent review is sound. Card 832
records the independently checked G6 amendment before these edits. It permits correction of
the nine named proof defects and targeted real-Mac mutation verification. Existing behavioral
requirements, test assertions and deadlines remain; no merge is authorized.

## Linux baseline and corrected claims

Measured by `npm test` on 6620653bb2f926b4a7f1ad86c84af392925fe78f, Ubuntu 26.04.1 x64
under WSL 2 with Linux Node 26.12.0: 4,004 tests, 3,952 passed, zero failed, zero cancelled,
52 skipped, 573,142 ms. The full baseline passed before implementation edits.

Four controlled census unit tests in process-adapter.test.mjs and the synchronous start-read
deadline case in read-deadline.test.mjs do not observe forced-end recording. Their inaccurate
R-STATE-12 declarations are removed. The original tests and every assertion remain. No
replacement requirement is invented; the generated matrix is rebuilt from the declarations.

The two directory metadata tests retain their metadata assertions and additionally assert that
the escaped fixture is no longer alive after dispatch settlement. The held-output exit-read
test retains its timeout result and additionally checks that its identified command is ended.
The unended-leader helper retains the refusal/result assertions and additionally checks that
its two ordinary children ended. Absent or zombie states count as ended for these last checks;
running and stopped states fail immediately, without a new wait or enlarged deadline.

Measured in a disposable Linux worktree against these edits: omitting ordinary directory
containment makes each metadata case fail its new ending assertion; replacing exit SIGKILL
with signal zero makes the held-output case fail its new ending assertion; targeting only the
unendable leader makes its case fail the new child-ending assertion. Each mutation reached one
named assertion failure, zero cancellations, and restored production bytes exactly. Restored
runs passed both metadata cases, the held-output case and both leader variants, five cases
with no failures or cancellations. Local raw logs and applied diffs are in the session's
proof-fixes evidence directory. An initial missing fixture PID failed to discriminate; the
command identity guard was corrected before the recorded assertion witness was obtained.

## Real Mac verification

The extensionless test/verify-mac-containment is invoked explicitly by the existing macOS
Node 20/24 CI jobs. It creates disposable source/test copies outside the checkout, first
passes each original control, then checks three separate behavior removals: the directory
kill becomes a signal-zero probe; an unobserved forced-end record is added for the directory
control; the same record defect is exercised separately for the group control.

Each case requires one anchor, byte readback, an applied diff, one named assertion failure,
real returned-tool/event evidence of the intended effect, and byte-exact restoration. A bad
guard, skipped target, cancellation, unrelated failure or unobserved effect fails verification.
The original checkout is never mutated. CI retains the raw TAP output, patch, private fixture
evidence and head/host/Node/command records outside the disposable copies.

These Mac cases cannot run on this Windows/WSL host; the helper refuses another platform.
The PR records their actual CI outcomes at the committed head. Fresh independent review
must verify the amended acceptance and actual evidence before returning a sound verdict.
