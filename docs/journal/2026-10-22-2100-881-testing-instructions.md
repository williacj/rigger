ABOUTME: Records the testing-instruction proposal and its verification limits for card 881.

# Testing instructions

This proposal aligns AGENTS verification authority with the existing deterministic and host
stages. It retains deterministic hooks, owner control of exceptions and the review/merge gates.
The AGENTS delta still requires owner ratification.

The TDD procedure separates controlled algorithm proof from real boundary and deadline proof.
It preserves the seven mutation obligations and references the existing Mac containment harness.
The acceptance procedure uses finite contract states and independently reviewed exclusions.
Prior owner authorization and a behaviour-to-proof mapping govern redundant live-body removal.

Verification on 2026-10-22 in Ubuntu 26.04.1 / WSL 2, Linux Node v26.12.0, used the
proposal worktree based on 55df9e6fae91b5a026a8ab89c6f56b6a99682a3e. npm test passed:
2,623 total, 2,614 passed, zero failed or cancelled, nine skipped; 54,174.371399 ms.
The complete original is retained as 881-npm-test.log in the owner's rigger-test-logs directory.

The existing budget:package, budget:instructions, lint:spec-style, check:references,
check:paths, check:ids, check:words, check:headers and matrix:check scripts all exited zero.
Their complete output is retained as 881-checks.log. The tracked journal is included in the
normal commit hook's subsequent verification. Both distributed skills match their local source
byte-for-byte. Independent preliminary source review found no blocking defect.

No test, process contract or proof declaration changes here. No new prose-preservation test was
added. This instruction proposal claims no local macOS runtime or containment-mutation result;
the existing supported-host CI and containment harness remain the authorities for those checks.
Final committed-head review and CI remain pending. Owner ratification of the AGENTS proposal
remains required before merge.
