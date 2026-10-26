ABOUTME: Records the finite cleanup-ended oracle rollout, protected behavior mapping and actual bounded proof.

# Cleanup-ended oracle rollout

The reviewed #908 P2 admission permits only the fifteen recorded ended-only
sites below. The base is ae0c8a191742f873639256eab003338887c5e497,
tree bc8d7b7f09ca1b5ed39e87f4d49404a137299517. The original
test/never-stop.test.mjs SHA-256 is
38aedbdfd3360059456f0e0b5ae404483512bc8376ee3b78847efff22e4e1edb.
The rollout source SHA-256 is
7b880a3de0a345bff4dcdbd0a15f17e686ed35c203130938a3864b9e5841715f.
These identify the precommit observations independently of the journal commit.

R-STATE-9 and R-STATE-19 distinguish cleanup obligations from recording
processes that cannot be ended. The existing live(state) predicate in
src/substrate/process.mjs excludes Z-prefixed states. The local strict helper
already proves actual ESRCH or an error-free, single matching PID/Z row;
it rejects runnable, stopped and unconfirmed observations. Its implementation
and original nine-test cohort are unchanged, with protected-region SHA-256
b4e80e701165ce9c77c4c2b9e37e9c5c127e6c5e158f5ed46bbcc74fe3527a1e.

## Finite replacement mapping

The following P2 line coordinates identify old source, not future coordinates.
Each expression passes the same recorded PID(s) as its old ended-only check.
The measured source guard verifies all fifteen old-text hashes against the
author's P2 map and reconstructs the exact original whole-file bytes by
reversing only these replacements. All other existing bytes remain unchanged.

| P2 old line(s) | Replacement |
|---|---|
| 522 | assertExitTargetsEnded(['one', 'two'].map((name) => pidIn(directory, name))); |
| 538 | assertExitTargetsEnded([started.leader, started.member]); |
| 3508 | assertExitTargetsEnded([one, two]); |
| 3569 | assertExitTargetsEnded([started.leader, started.member]); |
| 3584–3589 | assertExitTargetsEnded([one, two]); |
| 3644 | assertExitTargetsEnded([two]); |
| 3664 | assertExitTargetsEnded([started.leader]); |
| 3681 | assertExitTargetsEnded([two]); |
| 3698 | assertExitTargetsEnded([two]); |
| 4351 | assertExitTargetsEnded(['one', 'two'].map((name) => pidIn(directory, name))); |
| 4430 | assertExitTargetsEnded([group]); |
| 7164 | assertExitTargetsEnded([one, two]); |
| 7183–7189 | assertExitTargetsEnded(['one', 'two'].map((name) => pidIn(directory, name))); |
| 7290 | assertExitTargetsEnded([started.leader, started.member]); |
| 7421 | assertExitTargetsEnded([ended]); |

The two adoption blocks at P2 3584–3589 and 7183–7189 now positively prove
the same owned processes ended. Their successful status, cleanup code,
event and original time-bound assertions remain. These titles claim cleanup,
not reaping by a foreign adopter; #908 explicitly admits these replacements.
The successful exact-leader-Z read, member identity/nonlive guard and absence
of a group-unended event around P2 4430 remain unchanged. The actual held-Z
joiner premise and group-event proof around P2 7290 remain unchanged.

The shared assertUnendedUnread replacement changes only its ended PID check.
All eight callers retain stuck-live/EPERM, read-order, literal reason, killed
count and event assertions. Explicit reaping/absence, direct child close,
unknown teardown and protocol liveness assertions outside the fifteen sites
remain byte-identical, as do shared alive/processState, product code, CALLER
and existing fixture implementations.

## Actual bounded checks

Complete originals and receipts are privately retained outside the checkout
under /home/cj/rigger-test-logs/908. baseline-preflight.json,
baseline.receipt.json and baseline.stdout.log/baseline.stderr.log identify
the unchanged P2 ordinary run before any rollout edit: actual runner PID 496,
exit zero, 2645 passes, nine skips, zero failures/cancellations. Node reports
79341.963465 milliseconds; the Python monotonic root elapsed measurement is
79521118410 nanoseconds. This is P2 evidence, not a future-head timing result.

maker-replacement-map.json contains exact old/new text, old hashes and owning
declarations; shared-callers.json names all eight shared callers.
scope-check.json records the whole-source and protected-region hashes above,
the reverse-delta check, fourteen directly changed declarations and eight
shared callers. These source counts are guard results, not elapsed-time claims.
The only earlier preparation error was a read-only AST command with Node absent
from that invocation's PATH. Its original is conversation tool chunk 9af627;
no test ran and no separately retained stderr file is claimed.

affected.receipt.json and its separate stdout/stderr originals identify the
anchored real host selection at the rollout source hash above. Actual runner
PID 476 executed all twenty-two affected declarations plus the unchanged
nine-test helper cohort: 31 passes, zero failures/cancellations/skips.
Node duration is 28821.017528 milliseconds. Actual leader-Z and held-Z joiner
witnesses, call/start/exit boundaries and all eight shared callers execute in
that selection. The retained command lists every actual selected title.

The three finite wiring faults substitute independently observed actual owned
live tails at the changed call point. Each retains earlier protected assertions,
records actual PID, birth observation, successful raw PS status/state/executable
and then reaches the strict helper's intended running-or-stopped assertion.
list-mapping-red records target PID 591 as Ssl; single-pid-red records target
PID 766 as Sl; shared-ended-red records target PID 984 as Sl. Actual runner
PIDs are 496, 710 and 927 respectively. Each executes one test, one intended
failure, zero skips/cancellations. These are actual live-target faults, not
synthetic PID or empty-read models.

For each shape, the .mutant.mjs, .delta.diff, .git.diff, .receipt.json and
separate .stdout.log/.stderr.log retain the written source and observations.
The .guard.json records unique-anchor and exact candidate/mutant/restoration
hashes. Each restoration is byte-exact and its same target then passes:
list-mapping-restored-green PID 607, single-pid-restored-green PID 818,
shared-ended-restored-green PID 1108. wiring-driver.stdout.log records the
finite driver sequence; its actual PID was 492.

The unchanged helper's real held-Z old-oracle red, real running/STOP rejection,
actual reaped-child ESRCH, finite malformed/error controls and three semantic
faults remain #907 proof at their actual sources. The #907 journal and retained
907/phase2/S and 907/parser-repair receipts distinguish the original controlled
red from the repaired P2 parser proof. This rollout reuses that unchanged
classifier and additionally executes its nine-test cohort; it does not
relabel old trials as new-head proof.

matrix, budget, headers and diffcheck receipt/original pairs record exit zero
for npm run matrix:check, npm run budget:package, npm run check:headers and
git diff --check at this rollout source. The Linux boundary runs use Ubuntu
WSL2, Node 26.12.0, unset TMPDIR and precreated private persistent C615 roots
recorded in each runtime receipt. Baseline has its own recorded environment.

## Limits and final checks

Historical aggregate incidents 02/03 still lack causal target-state/birth
originals. This finite contract-conformance rollout does not establish their
cause or claim all negative alive assertions are wrong. The existing stronger
absence/reaping checks remain deliberate.

The code and this journal receive the normal ordinary-suite commit hook.
Exact committed-head ordinary and full-host results must be retained on #908;
none is invented here. The coordinator holds the long full-host run until its
exact-head observer protocol is declared, so potential #778 baseline reuse
requires that separate prospective admission. Linux measurements do not prove
macOS boundaries. No supported-platform result is inferred from another.
