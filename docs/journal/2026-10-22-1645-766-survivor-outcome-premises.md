ABOUTME: Prospective survivor outcome coverage, its real boundary witnesses, and unresolved historical causes for card 766.

# Survivor outcome premises

Card #766 uses the PM replacement acceptance and source grants recorded at
https://github.com/williacj/rigger/issues/881#issuecomment-6344296225. Its original
incident inventory remains preserved through
https://github.com/williacj/rigger/issues/766#issuecomment-6344286850. The maker base
is `06b4bcf71143626d1a55a5ca733ed61614950135`; the granted process adapter and
fixture sources are unchanged from the reviewed source base.

The two historical directory targets disagree about whether a post-kill read
answered live and whether a read or kill bound selected the result. The third
target concerns a missing leader event under an EPERM stand-in. These remain
separate historical incidents: this work does not establish their causes or
retroactively satisfy their superseded repetition procedures.

## Current proof

| Premise and outcome | Controlled proof | Real boundary witness |
|---|---|---|
| A post-kill live answer followed by LATE keeps the exact live/read-bound reason. | Existing `lateAsyncWait`, reached by the answered-directory test, and retained traced plain-failure controls. | The answered-directory test now retains the real returned `ps` row for the correct PID in T state; its existing final alive/not-stopped assertions prove resumption. |
| A post-kill live answer followed by ETIMEDOUT keeps the same exact live/read-bound reason. | Existing answered-directory held-output test and retained traced started-timeout control. | The real read child reaches its held-output cutoff. Existing identity, exact event and resumption assertions remain. |
| No successful post-kill live answer followed by LATE selects the exact unread reason. | Added async no-live-answer control uses the existing `cutAsyncReading` helper: one plain failed state read arms the clock cut and the next read never starts. | A real outside process receives the signal stand-in's kill request, and remains alive and resumed. This is logical cutoff selection, not a claim about a real deadline's duration. |
| No successful post-kill live answer followed by ETIMEDOUT selects the exact unread reason. | Existing unanswered-directory timeout test and retained traced no-answer started-timeout control. | Its real post-kill read is started and times out; the original exact event and liveness/resumption checks remain. |
| A live state answer at the call's kill bound selects the literal 10000 ms kill-bound reason. | Existing traced answered-at-bound control continues to distinguish answered from unread outcomes under the cleanup's own bound. | The original call test still waits the real KILL_BOUND and checks settlement against the recorded kill; it now retains the terminal real `ps` stdout/status without changing either returned value. |
| A leader refused EPERM with unanswered reads yields exactly one leader unended event with EPERM. | Existing `assertLeaderNotKilled` EPERM caller retains its exact event count, anchored reason, and step diagnostic. | Its real leader remains alive; the existing signal stand-in models refusal because an ordinary same-user fixture cannot require an actual permission refusal. |
| A leader independently observed zombie yields no leader unended event. | Added literal no-leader-unended assertion. | Existing `TRACED_CALLER`, unmodified, records a successful real group state answer identifying that leader as Z during synchronous exit cleanup. The caller subsequently reaps it. |
| A leader independently observed absent yields no leader unended event. | Added separate literal no-leader-unended assertion. | The async call's existing onGroup callback binds the real PID/birth identity; complete short real group state answers omit that leader, and both signal 0 and a fresh state read confirm absence after settlement. |

Synchronous Node exit cleanup cannot reap its direct child while the synchronous
cleanup is running. The zombie witness therefore observes that boundary directly;
the absent witness uses asynchronous containment after the actual child has been
reaped. A synthetic Z row earns no real termination credit here. No old test body,
bound, expected reason, or production behavior was removed or broadened.

## Discrimination and retained evidence

A guarded fixture contrast replaces the new no-live-answer control's first plain
failure with an actual `/bin/ps` answer. Its single executed test fails on the exact
unread-versus-live reason assertion. The fixture source is restored byte-for-byte,
and the original control passes again.

Two guarded temporary adapter mutations check the new leader result assertions.
Treating the real zombie as live leaves the real Z observation intact and fails the
literal no-leader-unended assertion. Adding an unended result for the absent group
leader leaves its real absence observations intact and fails that assertion.
Each mutation has one counted anchor, a read-back check, a retained diff, a named
test/assertion verdict with no cancellation, and byte-exact source restoration.
Neither mutation is a product fix or historical causal evidence.

The initial missing-row receipt run failed because no receipt existed. The first
receipt implementation then exposed the test reader's newline trimming; direct
`readFileSync` corrected that observation. The kill-bound receipt guard likewise
first failed on the missing receipt. These are prospective test-instrumentation
failures, not reproduced production defects. Their originals are retained
alongside the intentional negative controls.

Complete local outputs and mutation diffs are retained under
`rigger-test-logs/766` outside the checkout for independent inspection. They include
the successful restoration runs and all failed runs, rather than only excerpts.
No private historical original was reconstructed or assigned a new cause.

Validation measurements on Ubuntu WSL2 with Node 26.12.0, on 2026-10-22, use
never-stop source SHA-256 `63c454261b2c286d43c5dc3aac24c79bc7426ef92b76595aca2ba95ea3331419`. The final
`node --test --test-name-pattern=...` scoped run executes eleven named affected
and retained contrast tests: eleven pass, zero fail/cancel/skip, in 24757.64944 ms.
The separate real KILL_BOUND plus restored leader run executes three named tests:
three pass, zero fail/cancel/skip, in 10345.208074 ms. Both outputs identify the executed tests and verdicts; the retained evidence
manifest records their exact command selections for the independent judge.

`matrix:check` and `budget:package` pass; the derived matrix was regenerated for
the three new requirement claims. The ordinary suite is run by the normal commit
hook after this source is frozen. Its separate output is part of the handoff.
macOS execution remains an explicit CI boundary; these Linux measurements do not
establish macOS runtime behavior.

## Child-ending proof after independent review

The independent architect found that the new actual-zombie leader witness at
head `851c9506ecc4ab5cc18e5a599f40ae97ae5381f1` also claimed
`R-STATE-9` while never asserting that its two real children ended. A temporary
leader-only kill still produced the real zombie leader observation and passed
the test, with both actual children left live. That was a gap in this new proof;
the earlier mutation that failed before establishing its zombie premise earned
no group-ending outcome credit.

The same test now checks each recorded child's identity and independently reads
its process state after cleanup. A positively observed zombie or signal-0
`ESRCH` establishes that the child ended. A live or stopped state, or an empty
state answer while signal 0 still reaches that PID, fails. No product behavior
or protected pre-existing test body changed.

A guarded temporary mutation again sends the positive leader PID its SIGKILL
instead of signaling the group. The existing successful real-Z premise and
no-leader-unended assertion both pass before the new child-ending assertion
fails. Its preceding observation identifies actual child one, PID 572, in
`Sl` state with signal 0 succeeding. The named test reports one failure with
zero cancellations and zero skips. Restoring the production source byte-for-byte
makes that same test pass. The retained receipt names the counted anchor,
original/mutant/restored hashes, exact diff, complete outputs and observed
effect. This repairs the current test's discrimination and assigns no new cause
to a historical incident.

After this six-line assertion repair, the same twelve affected host controls
measure twelve passes, zero failures, zero cancellations and zero skips in
35000.369142 ms on Ubuntu WSL2 with Node 26.12.0. The exact argv selection is
retained with the complete output. The repaired source passes matrix, package
budget, header and diff checks. The final staged tree receives the ordinary
suite through the normal commit hook; its complete result is retained separately
for the fresh independent panels.
