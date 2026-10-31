<!-- ABOUTME: Records1141 restoration lifecycle implementation, classified local evidence and the bounded integration proof still due at this snapshot. -->
# Mutation receipts require literal restoration and a restored named green

This snapshot records local work through the G4 canonical-helper correction on 2026-10-31.
The receipt now captures the literal source preimage and restores it in the same disposable
worktree before a verdict can escape. It checks the restored source before and after the
selected third run, compares the available selected identities, and refuses a verdict after
restoration or owned-cleanup failure. An initiating fault remains visible when restoration
or cleanup also fails. A killed or survived mutation result alone cannot certify restoration.

The card is #1141. Its adopted acceptance body has SHA-256
`8846d68ff977f8d43bc360b08b0e664c7ff108cc41741480ed7871bbd5cb784b`.
All21 acceptance items retain their separately frozen digest
`d7e6e78f00dd68931f003923aaeed953dc78c553cc9c36d9efcce9e9f7898244`.
The original source base is `ad9c93ab8a7cd49962795e7e287a76529248b044`;
the dispatch HEAD `7fa6a79fa4a7e4816ca986e78ab214de148a62c4` has the same committed tree.
The local historical composition also carries the pending upstream merge
`f94446e02ce8482b3cbd779db9198a7e9c2c6072`. None of its uncommitted proof is described
as proof of the later integrated head.

`test/receipt-events.test.mjs` exercises actual receipt lifecycle decisions with controlled
selected producers and operation-boundary failures. Its selected outcomes are controlled
evidence, not purported real Node emissions. `test/mutation-receipt.test.mjs` supplies the
real CLI, Git, filesystem and suite wiring with deterministic counterparts named by its
host declarations. These diagnostics claim the development tool's behavior; they add no
unrelated requirement declaration or generated-matrix claim.

The real CLI witnesses independently observe one source path in one tool-created worktree
holding original bytes, mutant bytes and those exact original bytes again. Their ordered
phase records retain the real original pass, semantic mutant failure or survival, and restored
named pass. Restored assertion failure F7, blocked source path F4 and locked-worktree cleanup
F10 remain real refused boundaries. F11a through F11d are separate controlled partial-write,
readback, diff and launch failures at actual operation boundaries. Their proof records literal
restoration, source-only status and the third named green separately from the overall
no-verdict/nonzero outcome. Cleanup success is never substituted for source restoration.

The S5/S6 cases discriminate raw preimage/hash/status and before/after restored-run checks.
S8 cases cover unavailable, incomplete, duplicate and mismatched restored selection identities
through the existing lifecycle/parser, without a parallel verdict classifier. S10 retains
actual cleanup refusal and distinct causal errors; the fixture observes residual inventory
before recovering only its recorded resources. The conditional G2 observation callback in
`test/proof-repository.mjs` receives the completed CLI result before that recovery. Default
callers retain the existing checkout, registration and temporary-directory assertions.

The common-finally S3 and already-correct operation-boundary cases first passed as honest
characterizations. They are not invented REDs. Earlier F11b native459 failed because nested
mock restoration left the fixture's outer binding installed. That instrumentation failure
remains in `F11b-readback-refusal/handoff-stopped.json`; the bounded descriptor-based fixture
recovery retained the original assertions and did not earn a product-defect RED. Likewise
the local host-F11d native1185 fixture expectation failed and its one observed-contract
recovery native475 passed. All original failing streams remain retained.

The following measurements come from the actual canonical npm Node26.12.0 commands and
completed original stdout/stderr in the local-completion receipt bundle on 2026-10-31.
Each row names its stage to disambiguate reused native PID numbers. Each was at its own
frozen source preimage, with complete source/tool/dependency/context hashes retained in the
stage freeze. The table records raw outcomes, not final-head acceptance credit.

| Historical stage | Native PID | Direct exit | Tests/pass/fail/skip | Executed script SHA-256 |
|---|---:|---:|---|---|
| `availability-characterization` | 472 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `before-hash-green` | 677 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `before-hash-red` | 551 | 1 | 1/0/1/0 | `4b9d4d82ce545d22e698484aa9e8b8dd77f9d4f31bd678977581ab7b4b0a0bca` |
| `causes-green` | 465 | 0 | 1/1/0/0 | `4b9d4d82ce545d22e698484aa9e8b8dd77f9d4f31bd678977581ab7b4b0a0bca` |
| `causes-red` | 470 | 1 | 1/0/1/0 | `8f4ef05076395425bbfaecc8c4c0d0dddcbef766a344325ca0749bdcd0dc7153` |
| `cleanup-characterization` | 459 | 0 | 1/1/0/0 | `8f4ef05076395425bbfaecc8c4c0d0dddcbef766a344325ca0749bdcd0dc7153` |
| `f11c-characterization` | 475 | 0 | 1/1/0/0 | `9f789b13881f1460eb7759b8d82dae4ef407c075ff52021c66793575c51a2660` |
| `f11d-characterization` | 572 | 0 | 1/1/0/0 | `9f789b13881f1460eb7759b8d82dae4ef407c075ff52021c66793575c51a2660` |
| `final-deterministic` | 474 | 1 | 4060/4049/2/9 | `acb99bdddfbc5273d768640ec0dec39db3e981c02f2afe4291a75e7f9ff1ff09` |
| `final-identity-coverage` | 461 | 0 | 1/1/0/0 | `acb99bdddfbc5273d768640ec0dec39db3e981c02f2afe4291a75e7f9ff1ff09` |
| `fixture-refactor` | 467 | 0 | 25/25/0/0 | `1722e802348cf54555cfa6d3892e00c163194d5127022166b8861277b131439e` |
| `host-F11a-characterization` | 465 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-F11b-characterization` | 700 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-F11c-characterization` | 945 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-F11d-characterization` | 1185 | 1 | 1/0/1/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-F11d-fixture-recovery` | 475 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-f10-characterization` | 498 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-f7-characterization` | 1065 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-survived-characterization` | 480 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `host-third-characterization` | 774 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |
| `identity-green` | 562 | 0 | 1/1/0/0 | `8f4ef05076395425bbfaecc8c4c0d0dddcbef766a344325ca0749bdcd0dc7153` |
| `identity-red` | 469 | 1 | 1/0/1/0 | `9f789b13881f1460eb7759b8d82dae4ef407c075ff52021c66793575c51a2660` |
| `source-change-green` | 484 | 0 | 1/1/0/0 | `d68d4647fdeec7dc0f7a75db305b50fcc76ac09f8652f6467eb70a9e26669980` |
| `source-change-red` | 472 | 1 | 1/0/1/0 | `1722e802348cf54555cfa6d3892e00c163194d5127022166b8861277b131439e` |
| `status-after-fix-green` | 472 | 0 | 1/1/0/0 | `9f789b13881f1460eb7759b8d82dae4ef407c075ff52021c66793575c51a2660` |
| `status-green` | 569 | 1 | 1/0/1/0 | `d68d4647fdeec7dc0f7a75db305b50fcc76ac09f8652f6467eb70a9e26669980` |
| `status-red` | 474 | 1 | 1/0/1/0 | `d68d4647fdeec7dc0f7a75db305b50fcc76ac09f8652f6467eb70a9e26669980` |
| `survived-characterization` | 561 | 0 | 1/1/0/0 | `909800005003dac1edd63bbe6e0bcb7dd525788bf14d1c3436186f0f8c8b9200` |

`status-green` is explicitly a failed attempted planned-green execution after an administrative
patch transport error; it is not passing evidence. Its original, the earlier source-status RED,
and the later changed-source GREEN are all retained. No failing diagnostic was deleted.
Product RED/GREEN pairs for pre-run hash, post-run source change, source-only dirty status,
identity uniqueness and multiple-cause retention remain separate from first-GREEN cases.

The historical final-deterministic native474 command exited1 with4060 tests:4049 passed,
two failed, nine skipped and none cancelled. Both failures were introduced by this card's
own raw fixture routes/interception, including its earlier S3 helper code; they were not an
unrelated baseline. Its original stdout SHA-256 is
`4696c4a0a4074cffb20bce2c011f81eb70ee4c31a1ddd974c127fada537adff6`.
No old matrix or host result is offered to turn that failed qualification green.

The author-adopted G3 correction extends only two existing fixture helpers.
`removeWorktreeAt(repository, path, force = false)` keeps ordinary refusal and permits dirty
removal only when explicitly requested. `worktreeList(repository, nul = false)` preserves
native ordinary porcelain by default and requests Git's native NUL form only explicitly.
Both keep their existing Git environment, default argument vector, return and error behavior.
The unchanged prior maintenance diagnostic remains alongside two additive diagnostics.

The force diagnostic's native550 meaningful missing-force RED was followed by native672
GREEN and native809 whole-helper two-pass verification. The NUL diagnostic's native482
meaningful missing-NUL RED was followed by native584 GREEN and native680 whole-helper
three-pass verification. Their default omitted/false controls, real dirty bytes, canonical
paths and literal lock reason were independently checked. The successful NUL producer's
actual320-byte output contained nine NUL bytes and no LF, retained as binary/base64 with
readback SHA-256 `b3d0f10efea2ef19a32cb263b75c53e3d05f9c154645b9032f8504832c55d3c6`.
Ordinary text was never converted and offered as native NUL output.

G4 replaces the ten enumerated raw Git routes with these canonical helpers and changes four
interceptors to delegate actual unmatched calls through captured original execFileSync values,
with their actual command, arguments, options and named environment. No dummy process,
recursive live ESM binding, guard allowlist or guard edit was introduced. The unchanged three
environment/importer/fixture guards passed at native451, the ordinary-plus-helper selection
passed38 tests at native523, and the real F10 CLI witness passed at native1060. Each command
exited0 with no skips or cancellation. The inner F10 CLI still exited1 and reported its real
lock refusal before canonical fixture recovery; the successful outer diagnostic did not
rewrite that failed CLI evidence. Its actual304-byte native NUL inventory, nine NUL bytes
and two records, has SHA-256 `fc819704efac280b867053bebd23a48504aa79491efde1c4dec47df3b1ddc4b2`.

The retained bundle manifests are content-addressed:

| Historical bundle | Manifest SHA-256 | Recorded entries |
|---|---|---:|
| Stopped local-completion proof | `fc05f0e6dcf4ee1c3034aeb7872fd2351c93a0b41c2d0fe5a8ad84ebd6773050` |361|
| Force helper TDD | `0811a135c84053ed667d3245cafa5218dbf9179adf84594b44d0925db8b99240` |77|
| NUL helper TDD | `6982b948285e6736110480ab934817694ce07f57855c90903e79bf814d7365b0` |82|
| G4 canonical correction | `ff0bd94eb5419d4ae3cb13fbea7ac955305b753d92bab1bb6d67a4268cfc156c` |90|

The integration preflight reopened every file named by those four manifests and checked its
SHA-256. Earlier lifecycle, S3, S7, S8 and F11b receipts remain separately retained; a manifest
is custody evidence and never substitutes for the raw independent witness or semantic cause.
The coordinator holds the private-safe original access route. Required originals remain
outside disposable test roots through independent ruling.

At this journal snapshot, committed-head integration, the original five guarded script
defects and four auxiliary helper defects, final direct deterministic/matrix/whole-host
qualification, supported-host CI and independent delivered-work reviews remain unproved.
The outer driver for those nine claims must be an immutable copy of the same proposed-head
committed tree outside its distinct mutated subjects, with actual runtime closure and
source/anchor/selection manifests. No driver has been run as part of this snapshot.

The local source census found54 host-listed files and33 literal helper-import routes at
suite SHA-256 `c8dce2d375945301ac9287b247e8cc648d8a0b9c2bce001b3ac1db9496f15e42`.
That measurement does not discharge generated imports, source readers and copied-fixture
reach. Whole-host qualification is retained; neither a five-test subset nor literal imports
alone justifies exclusions. Configured supported-host CI remains required, and an opt-in
agent skip or unavailable supported host is explicitly unproved.

The normal authenticated fetch native469 exited0 and advanced only origin/main from
`48d96ee315549fde5407048b3529eab230c207d3` to
`fe4782a370e96ebc3bfbadb8b1bd468cb79bd5b1` (V). It preserved the index, pending merge,
HEAD and all six maker source/test hashes plus the unchanged architectural guard. The actual
f944-to-V38-path delta changes none of those six paths, the guard, suite, package, hooks or
TDD skill. This is static applicability evidence, not an integrated runtime result.

The delivery route stages the complete six-file maker change and this one journal alongside
the already staged upstream merge, then completes that pending merge normally. It next
merges V normally and records factual integration here before committing the integrated head.
Both commits retain required deterministic hooks. Final direct qualification and the immutable
guarded cohort use their own retained command receipts; future results are not guessed here.
The journal will retain this timestamped historical scope rather than invent a circular
self-hash or require another source-head edit to transcribe future proof.

## Normal integration observed on 2026-10-31

The normal M1 commit is `998c2781d8d91e40d0ed4e3f46472f6b8d1e84e2`, tree
`004aa4112037d96086ecf9bf7d650852ffed027c`, with parents
`7fa6a79fa4a7e4816ca986e78ab214de148a62c4` and
`f94446e02ce8482b3cbd779db9198a7e9c2c6072`. Native Git493 exited0. Its real
pre-commit hook child498 exited0, as independently retained Git trace2 records.
The unchanged hook's deterministic output reports4062 tests:4053 passed, none failed
or cancelled and nine skipped. These are hook-output measurements, not a claim to have
captured the nested npm PID or its direct process status separately.

The private recorder initially parsed only Git stdout, but Git delivered the hook's complete
output to stderr. Its bookkeeping wrapper therefore exited1 after the successful commit.
A completed-original readback recovered the actual counts and hook child status without
rerunning the commit, tests or source change. The original result and both streams remain
retained; this is an administrative capture correction, not a test failure or passing replay.

The normal `git merge --no-commit --no-ff` of
`fe4782a370e96ebc3bfbadb8b1bd468cb79bd5b1` exited0 at native Git501. Its actual
automatic result had no unmerged entries and exactly the recorded38 upstream changed paths
staged. Every one of the six maker source/test hashes and the unchanged guard hash remained
identical. No conflict resolution, upstream source edit, hook bypass or cache injection was
needed. This continuation is the only maker journal change before the final integration
commit. The integrated H hash is not guessed, and its forthcoming hook, final direct checks
and nine immutable-driver claims remain future evidence at this timestamp.
