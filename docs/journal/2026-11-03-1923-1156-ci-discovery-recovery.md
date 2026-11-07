ABOUTME: Records card 1156's bounded discovery recovery and the controlled evidence prepared before its checkpoint commit.

# Bounded CI discovery recovery

[Card #1156](https://github.com/williacj/rigger/issues/1156) owns the finite discovery policy and acceptance. The [owner-policy adoption](https://github.com/williacj/rigger/issues/1156#issuecomment-6619546846) records approval of the bounded choice before maker admission. The earlier pending-owner wording in the card is historical. The protected workflow's terminal owner marker remains a separate merge requirement.

The inline cancellation controller now discards a count/list-inconsistent discovery epoch and permits one replacement epoch. Recovery requires an otherwise valid bounded page, including every supplied source and association identity. Pagination, invalid counts or lists, malformed or conflicting identities, and HTTP or transport failures still refuse immediately. The existing discovery map is cleared at the start of each epoch. The bound is ten listing GETs, with no change to detailed-attribution reads, final per-target reads, POST handling or the aggregate policy.

The original count/list diagnostic remains observable. Separate bounded records identify replacement discovery starting and completing. These records contain no API body, token, returned URL or header. The timer-free request helper integrated by #1136 is unchanged.

## Controlled evidence before this checkpoint

Measurements below were made through the repository's ordinary npm runner on WSL with Node 26.12.0, on 2026-11-04 UTC. The admitted source and fetched merge base were `74ede5012738c3d3f1f6cafda47dc78851173724`. The frozen current card body's SHA256 was `ea1e931ce76301480601d4fe028378112980c7d13714a6a0e02131a2951668b9`.

The clean-source baseline used one normal npm ci, which exited 0. Full npm test reported 4,594 tests, 4,585 passing and nine skipped, with no failures or cancellations. The affected existing workflow-files host command reported 65 passing tests. Current-body check:card and clean-source preflight both exited 0.

The first additive test, `discovery recovers from observed queued count one list zero with a complete fresh empty epoch`, ran against the unchanged inline controller. It reported one named failing test, no skipped or cancelled tests, and a strict-equality assertion requiring recovery completion: actual `Error: discovery incomplete`, expected `undefined`. This was the intended behavior RED, rather than an import or fixture failure. The same selected test then passed after the discovery change. Its literal request vector contains three initial reads, the queued count1/list0 observation and five fresh empty listing reads, with no POST or post-discovery live reread.

The first focused regression reported 35 passing tests. The subsequent additive cases characterized behavior already satisfied by that repair and the existing guards; they are not claimed as further behavior REDs. Each selected characterization reported one passing named test. The coherent focused regression then reported 45 passing tests, no failures, skips or cancellations. Its workflow SHA256 was `957eee4d374984218781b2dd8cb05908ea707f8f744ef4225d2b35da33a7a87d`; its test-file SHA256 was `9e004620713702bc27c091ddfc4ddd744a5d54a21a69fae51754ec1459a2416c`. Those results describe the uncommitted source bytes, not this journal or a resulting commit.

| Finite cells | Named executed proof |
|---|---|
| C0 | `cancellation validates its source and all five complete empty status pages before returning`; existing successful cancellation traces |
| C1 | `discovery recovers from observed queued count one list zero with a complete fresh empty epoch` |
| C2, C2a, C2b | `fresh discovery discards earlier candidates and immutable identities before its sole cancellation` |
| C3 | `a second discovery disagreement refuses after exactly ten listing reads without a third epoch` |
| C4, C5 | `non-cardinality discovery failures remain immediate before and after the sole recovery opportunity`; retained existing discovery refusal tests |
| C5b | `bounded cardinality disagreement recovers at every status for counts above and below list length` |
| C6 | `fresh discovery preserves same-head profile self source order and completed exclusions`; retained original exclusion variants |
| C7 | `fresh discovery still refuses final live PR target and own attempt changes before any POST`; C1's complete no-target vector; retained late-observation tests |
| C8 | `fresh discovery resolves sparse agreeing status drift once before a single scoped POST`; the C4/C5 immutable-source and association-conflict traces |
| C9 | `fresh complete discovery accepts zero one and one hundred rows without target rechecks`; `replacement discovery composes the timer-free HTTP adapter and refuses incomplete decode JSON and foreign pagination`; C4/C5 bound and pagination refusals |
| C10 | `recovered cancellation preserves completion acceptance conflict and later-failure outcomes without write retry`; retained original POST-error variants |

The discard trace supplies an earlier candidate that receives no detail read, then a different valid immutable identity for another run ID in the fresh epoch. Its complete expected call vector permits only the fresh identity's attribution, final checks and sole POST. The persistent requested-page trace observes ten listing reads and thirteen total reads before refusal, preserving the distinction between listing and total requests. Error traces assert the actual named refusal and complete vector, so an unexpected setup request cannot substitute for the required failure.

Existing test edits are confined to G1: the requested count1/list0 corruption now receives a persistent fresh queued mismatch, and the waiting mismatch diagnostic sample receives the same persistent replacement response and its bounded recovery diagnostic. Their ultimate failure, named mismatch reason and zero-write assertions remain. Every other existing test line is unchanged. New recovery tests use the injected request boundary and the existing timer-free helper; they start no process, network call or real timer under the deterministic runner.

Byte-complete command arguments, starts, recorded child PIDs, direct child exits, raw outputs, card/source/dependency originals and runtime identities are retained in private maker evidence outside the worktree and suite scratch roots. The originals were reopened after the runs. No hosted action was performed for these proofs.

## Proof still pending

The official guarded semantic mutation must run from a normal tracked checkpoint because its runner snapshots HEAD. Its sole planned change replaces the unique `if (epoch === 0)` recovery condition with `if (false)`. The expected effect is the original immediate mismatch refusal, with C1 reaching the same named assertion failure at its normal selected count. No mutation result is claimed here.

A normal pre-commit hook, verification of the resulting head, affected host checks at that head, preflight, independent review, guarded mutation receipt and final protected-workflow owner marker remain pending. Supported macOS execution and normal hosted controller wiring remain explicitly unproved by these WSL controlled results. The card remains open until its delivery obligations are met.

Run41145716306 remains observed pre-repair failure evidence and earns no credit for repaired behavior. The complete API response at the actual execution time and GitHub's underlying cause remain unknown. The controlled replacement responses make no claim that GitHub will converge or that the service was repaired.
