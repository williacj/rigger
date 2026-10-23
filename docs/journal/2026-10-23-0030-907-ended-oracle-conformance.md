ABOUTME: Records the local exit-cleanup ended oracle, its real conformance controls and the unresolved historical failure limits.

# Exit-cleanup ended oracle

The phase-two admission on #907 permits changing only the final oracle of the
named exit-cleanup survivor test, with a local helper and finite controls.
The earlier status, exact survivor/name/command and no-group-event assertions,
their requirement declarations and bounds remain unchanged. Shared alive,
processState, CALLER, existing fixtures and product code remain unchanged.

The source-supported contract distinguishes an ended zombie from a process
that can still run: see src/substrate/process.mjs live(state) and its
UNREAPED_BOUND explanation, together with R-STATE-9/R-STATE-19. This work changes
a local test oracle, not that product behavior or its cleanup deadline.

The helper accepts initial actual ESRCH without a state read. Otherwise, for that PID, it
performs at most one PS -p PID -o pid=,stat= read. Only a successful, error-free,
unsignalled, empty-stderr answer containing exactly one matching integer PID
and nonempty Z-prefixed state qualifies. A clean status-1 empty answer needs
one subsequent ESRCH confirmation; a still-reachable PID remains unconfirmed.
Live/stopped, failed, signalled, timed-out, malformed, wrong/multiple-PID,
missing-output and diagnostic-stderr observations reject. Non-ESRCH signal
errors are preserved. No retry or empty-string-alone success was added.

## Actual source and evidence

The original source SHA-256 is
2ea06b9b3881b2d41e7ee88ded3c6981fe4dd9116cad82571c38b61f1e829a10.
The old-oracle controlled-red source SHA-256 is
8a44b97544bd9491e635957094c42b017c7a7028eb691e829c4ee5d6d91ad2d9.
The initial P fixed test source SHA-256 is
ae1230c1e5836b9dabd44036f3f320b2c9652004a7ca683576155409e7f7ddaf.
These identify precommit observations independently of the later journal commit.

The initial work and real red occurred at a39023b478c10bdd33f68989a267ba5d68045f69,
tree 4be5341f5bfe6d516ca1cb7c1de53a02b970d529. Its unchanged ordinary baseline
passed, and extracting the signal-zero-only assertion preserved a passing
focused target. The new actual held-Z control then failed that old helper at
the intended ended assertion, with actual [false,true], after its independent
PS/PID/Z/signal-zero/identity/event premises passed. The strict local helper
made that same control pass.

The prospective base admission avoids depending on the unmerged #778 matrix.
All a390 work/source/diffs and trials were frozen before creating a separate
canonical rigger-907 branch at 728732d47dcbdd408615d594d3c770d86673368f,
tree 21869e037c18e92f5027833e87dd7a3b9e6c8301. This base has the identical
original never-stop and protected fixture/product source, but its new execution
is separate evidence rather than relabeled a390 credit.

The new unchanged S ordinary run, actual PID 492, measures 2645 passes, zero
failures/cancellations and nine skips; Node duration 78.832051434 seconds,
Python monotonic root elapsed 79.010145016 seconds. Before applying the fix
there, the same old-oracle real held-Z source again fails the intended ended
assertion: one test, one failure, zero cancellations/skips. Only then is the
byte-identical frozen fixed source applied in that context.

Nine S-context target/control tests pass, with zero failures/cancellations or
skips. The held-Z fixture is the existing censusExit B/zombie path, requiring
an answered confirmation: a cutoff fails its premise. Real owned running and
SIGSTOP-held tails reject after independent actual state/executable/birth
observations. Teardown resumes or ends the owned stopped process. A recorded
owned child is observed closed/reaped and ESRCH before acceptance. Literal
collaborator controls cover the finite raw-result/error table; they earn no
real-OS credit.

Three separate guarded faults reject a real zombie, accept a real running
tail, or ignore a read error. Each fails its intended named conformance
assertion with one executed failure, zero cancellations and zero skips.
Each unique anchor, written mutant, diff and effect is retained; restoring
the exact fixed bytes makes its same target pass again.

Complete separate streams, actual process IDs, source hashes, ref/tree,
environment/root receipts, prepared raw-returned-read originals and mutation
restorations are retained outside the checkout under rigger-test-logs/907:
phase2 records a390; phase2/a390-frozen preserves its handoff; phase2/S holds
the new baseline, red, finite controls and guarded-fault receipts. Real Linux
proof uses Ubuntu WSL2 and Node 26.12.0 with private persistent C615 roots.

## Boundaries and final verification

The original failed aggregate occurrences 02/03 lack target-state/birth
originals. The later exact-consumed diagnostic records [true,false] and only
afterward observes the true PID as Zl; it does not establish the earlier
signal-zero state or exclude same-second reuse. Those historical causes remain
unknown. This controlled conformance proof is prospective, not their repair.

All earlier diagnostic/preparation failures remain retained at their actual
scope. The first escaping-guard error has only its conversation-tool-history
route, not a separately retained output file; the corrected private report
states that gap. The failed consumed-value syntax preparation is preserved as
a complete version before its explicitly authorized correction and single run.
No reconstructed evidence is presented as an original.

The initial P head ed35cfb4cb2a5079bda1b7de62f6e59bb4b11312 received a
green normal ordinary-suite hook. The coordinator retains its completed green
Linux full-host proof at that exact P; it is prior-head evidence, not proof of
the parser repair below. Supported macOS boundary evidence remains distinct.

## Single-row parser repair after independent review

Independent review found that the initial parser's whitespace separator also
accepted a PID and state on separate physical rows. The permanent malformed
regression uses literal stdout `401\nZ\n`. At unchanged P, a new ordinary
baseline passes 2645 tests with zero failures/cancellations and nine skips.
Adding only that case produces the intended named read-control failure:
Missing expected exception: split row fields, one failure with zero
cancellations/skips. Its test-source SHA-256 is
a19dcc4d9ab0ad2b8bbc3d9571a545245c73d75b2b777719967bfe5ca8283fbe.

Only then does the parser require horizontal field spacing, at most one final
LF, and a match consuming every stdout byte. The same malformed control passes.
All nine real/controlled oracle tests pass again; each of the existing three
Z/live/error faults still fails its intended assertion, followed by a
byte-exact restoration and passing target. The repaired test-source SHA-256 is
38aedbdfd3360059456f0e0b5ae404483512bc8376ee3b78847efff22e4e1edb. Complete separate
outputs, actual PIDs, source versions and fault/restoration receipts are retained
under rigger-test-logs/907/parser-repair. No product/shared fixture or other
decision-table behavior changes, and no historical cause is inferred.

The repaired code and this journal receive a new normal ordinary-suite hook.
The coordinator schedules new exact-head full-host verification and independent
panels after that commit. Results may be recorded on the card without another
journal commit; no unrun new-head full-host or macOS result is claimed here.
