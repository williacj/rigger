ABOUTME: Records origin timeout tests that distinguish an elapsed timer from a timeout-ended child.

# Card 783: origin exit premises

The revised card acceptance and independent architect ruling identify the existing command-result
contract in ARCHITECTURE.md: the direct child decides its exit code, and a command L0 ended at
timeout has a nonzero result. The implementation and existing adapter tests distinguish independent
exit after timer expiry from a containment-ended command. This work changes no product contract.

The test worktree is based on 06b4bcf71143626d1a55a5ca733ed61614950135. git diff against
the grant's 55df9e6 source found no change in init or process-adapter tests before this work.
The bounded fixture now permits the affected C3-D1-R1 shell to exit independently after its real
timer fired and before the held process-table read lets containment proceed. The child exit event
provides the expected code and signal independently of runCommand's returned timedOut field.

The controlled exit-3 fixture failed the original unconditional timeout assertion. Its complete
TAP original, own-exit-red.tap, records timer.callback, shell.exit with code 3 and null signal,
then containment's signal attempt and origin.result with status 3 and timedOut false. This is
prospective discrimination of the assertion error, not attribution of the historical occurrence.

The C3 family now selects one exact expectation only from an independent code/null-signal exit
observed before releasing containment, with the timer already fired.
It checks the returned status/timedOut fields, init's origin report/config outcome, absence of
the command's group and exact zero event identities/count when no survivor remains. A signal-ended
branch retains timeout text, group absence and exact timeout.killed identity assertions. The
copied own-exit forcing fixtures suppress irrelevant tail stdout so their empty-origin premise is
known independently; nonzero exit retains its diagnostic. Ordinary C3 stdout is unchanged.
Normal own-exit0 proves the result class and config existence, with exact parsing separately
proved by existing literal initFromAnswer/safePlaceholder and remote-format tests. No production
parser supplies an expected value. Other generated families keep their outcome checks.

## Shared caller map

| Existing callers | Result retained |
|---|---|
| C1-D4 with R0a, R0b, R1 | timeout |
| C2-D0/D1/D2/D3 with R0a, R0b | timeout |
| C3-D0/D1/D2/D3 with R0a, R0b, R1 | exact pre-containment own exit only when independently observed after timer fire; otherwise original timeout proof |
| C4-D0/D1/D2/D3 with R0a, R0b, R1 | timeout |
| C6-F with R0a, R0b, R1 | existing observed ending |
| C7-D2-R0a | exit 7 |

T1a covers the copied fixture/gate changes; T1b covers the independent exit observation and
ordering; T1c covers exact branch assertions. The independently reviewed PM refinement extends T1/T2 only to the source-proved C3 family;
T2 retargets those titles to their observed ending. No adapter line, source implementation or shared fixture changes.

## Validation and limits

On 2026-10-22, Ubuntu 26.04.1 / WSL 2 and Linux Node v26.12.0, the three focused real-child
targets passed with zero failures or cancellations (3,309.374681 ms). Their complete original
is own-exit-green-corrected.tap in the owner's rigger-test-logs/783 evidence directory.
The command used node --test --test-timeout=30000 --test-reporter=tap with the name pattern
'C3-D1-R1 origin|an origin shell that exits (0|3) after timer expiry'.

The first green attempt exposed two fixture/assertion mistakes: multi-file tail stdout did not
satisfy the proposed empty-origin premise, and killsOf requires an event file that a no-kill
execution does not create. own-exit-green.tap remains retained without green credit. Automatic
review refused an initial event-assertion edit as weakening protected proof. Source inspection
of readEvents and the existing no-kill/no-file test supported the corrected implementation,
which retains the independent group/PID checks and additionally asserts zero total events.

The first green attempt briefly overlapped another card's host verification after a coordination
race. No elapsed-time performance claim is made from it. Subsequent focused verification was
serialized. Historical FIFO-interrupt sender and incident causation remain unresolved.

The initial target-only complete affected files passed: 245 tests, zero failures, cancellations
or skips, 92,171.093313 ms (affected-host.log). The reviewed refinement then exercised copied
C3-D0/D1/D2/D3-R1 fixtures with own exit0/3 at the same downstream assertion. Six additional
cases failed exactly at the blanket timeout assertion while the two corrected D1 cases passed;
zero cancellations. family-red-init.test.mjs and family-red-fixture.patch were captured before
that run. family-red.tap retains its complete original. After the shared C3 correction,
family-green.tap reports eight passed, zero failed/cancelled, 8,593.344842 ms.

For each C3-D0/D1/D2/D3 with R0a/R0b/R1, the source-equivalence boundary is the same post-ready,
post-timer origin result and unconditional assertion after the C7/C6-only returns. No intervening
C3-specific guard distinguished their old timeout expectation. The R1 forcing controls supply the
causal own-exit witness for each child recipe; they do not claim that all readiness schedules are
the same fixture setup. A branch without the independently captured pre-release exit keeps its
existing timeout and exact event checks.

The first base fixture was transparently reconstructed from the recorded initial edit and
committed base, not presented as a contemporaneous source snapshot. base-red-fixture.patch and
evidence-receipt.json preserve that provenance and artifact hashes. The later family red source
was captured contemporaneously.

Final expanded complete affected files passed: 251 tests, zero failed, cancelled or skipped,
98,835.488567 ms. The exact npm run test:host -- test/init.test.mjs
test/process-adapter.test.mjs command and complete output are retained in
affected-host-family.log. The executed init test source is retained as family-head-init.test.mjs
with SHA-256 1f02e726f90a94a3ef3ca420d58dd3084e16573e47a5a70e3b6e9f9190f0d99d,
measured by sha256sum before the run. Its explicit same-thread sequence asserts timer callback,
observed exit, then containment release; timestamps or merged streams supply no ordering credit.

Package, matrix, header, reference and path checks passed; static-checks.log retains their output.
The normal commit hook will run the final ordinary suite; its result and committed head are
recorded in the pull request.
Existing unchanged process-adapter witnesses for independent exits 0/3 and timeout-ended commands
supply the real substrate boundary; controlled initFromAnswer tests supply reporting expectations.
Neither a timer callback alone nor concatenated stream output establishes causal order.
