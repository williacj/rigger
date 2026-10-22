<!-- ABOUTME: Records Ubuntu host-tier portability fixes and their observed validation. -->

# Card 879: Ubuntu host observations

[Card #879](https://github.com/williacj/rigger/issues/879) defines this interactive bootstrap
repair. It follows [#873](https://github.com/williacj/rigger/issues/873) at base
5e4a8374d1c73607889d1d591e1b55ceba657531. Its acceptance received an independent architect's
content review before implementation.

The two direct-child directory tests used signal 0 as their termination observation. On Linux,
a killed child can still answer that probe as a zombie before Node reaps it. The assertions now
accept a positively observed zombie or positive absence. A living, stopped or unknown observable
process still fails. Production containment and the signal-0 fixture helper are unchanged.

The host runner selects uname's kernel release for a local Linux diagnostic key. Darwin retains
its product-version key, and CI retains its image key. These are test diagnostics, not a change
to supported engine hosts.

The case-varied operand check follows the actual filesystem's resolution. An additional real
alias control proves the canonical unlisted-file refusal on a case-sensitive filesystem.
The guard's decisions and tier membership are unchanged.

## Measurements before implementation

On 2026-10-22, npm run test:host at the declared base, Ubuntu 26.04.1 x64 on WSL 2 and Linux
Node v26.12.0, exited 1: 1,731 tests, 1,677 passed, four failed, zero cancelled and 50 skipped.
The runner reported 744,650.472213 ms. The complete local original is
873-full-host-baseline.log in the owner's rigger-test-logs directory.

The guarded directory observer's three numbered attempts retained both existing assertions.
Attempts 1 and 2 failed both checks with recorded survivor.killed events and Zs/Zsl states;
both PIDs were absent after an event-loop turn. Attempt 3 failed the symlink case with the same
zombie observation; the direct-directory case observed absence and passed. These measurements
identify the current observation mismatch; they attribute no older Test quality incident.

An earlier observer used the wrong event-file path for the symlink workspace and failed setup
there. That original remains diagnostic context without causal credit. Its corrected unforced
repeat passed both cases. The initial broad process-kill observer also passed and supplies no
failure reproduction. None of these attempts is erased by later results.

## Test-first and focused validation

The two original suite-tier targets failed before their edits. New controlled Linux identity
and actual Linux identity assertions failed against the unmodified runner; the Darwin control
passed. The first alias control accidentally resolved outside its temporary repository and
failed its own premise. Correcting that setup produced a passing alias check before the runner
edit; it earns no evidence of a guard defect.

After the local-key edit, the six focused identity/path checks passed with zero failures,
cancellations or skips. The complete command npm run test:host --
test/directory-census.test.mjs test/suite-tiers.test.mjs exited zero: 139 passed, zero failed,
zero cancelled and zero skipped; the runner reported 31,938.501165 ms.

This journal's evidence cutoff precedes the final whole-suite runs. Their exact-head results
belong in the PR evidence. Controlled Darwin tool answers do not substitute for macOS runtime
execution. This protected suite-runner change requires the owner's marker before merge.

The first ordinary-suite attempt found the new dynamic version-tool call lacked an explicitly
named environment. The existing git-environment audit rejected that call. It now supplies
process.env explicitly; the failed original remains in 879-npm-test.log without green credit.
