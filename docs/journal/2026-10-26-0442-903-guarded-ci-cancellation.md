ABOUTME: Records offline preparation of guarded older-head CI cancellation and its local proof limits.

# Guarded older-head CI cancellation

The admitted preparation starts at reviewed #953 head
`0c58ff2cc51f6fe07756524790d961fd1ad69f26`, tree
`1ed16654e4f9bb5267e173afa6a03e216355354f`. This prerequisite was the actual
local source, not a claim that #953 had already landed on main. The #903 author
admitted two meaningful offline commits: a complete controller with Actions read,
then a test-first change enabling Actions write only on that job. Publication and
service actions require separate exact-source admission.

The controller lives as the actual protected workflow literal. It reads no checkout,
package, artifact or PR executable. Five bounded workflow-scoped status pages must
validate before any mutation. It binds repository, PR, workflow, immutable run head,
original run number and frozen positive attempt. Agreeing cross-status duplicates
are one target; mutable PR-association SHAs are not immutable run source. Every POST
follows fresh PR, target and own-attempt reads and an inspectable intended-target
record. A 202 records acceptance only; a 409 permits one completed-target read.
Failures stop further requests and leave earlier accepted actions recorded.

A final GET cannot supply a server compare-and-cancel precondition. Head reuse or a
new attempt after that read remains possible. Controlled cases expose that window;
there is no atomic current-head safety or required-context precedence claim. Same-head
ordinary, full, demo and rerun attempts stay independent without native concurrency.
The owner/workflow-review trust boundary remains; this is not a sandbox for hostile
same-repository workflow authors or a reduced-token/fork readiness guarantee.

Node 26.12.0 local baseline measurements at the stated source were 2,896 ordinary
passes with nine skips and 64 affected workflow-host passes, without failure or
cancellation. Retained red/green originals cover missing job wiring, empty discovery,
active target requests, exclusions, controller source, own/live identity, complete
bounded discovery, stable-ID deduplication, final rereads, response outcomes, bounded
HTTP transport, runtime data mapping and the PR aggregate dependency. Additional
literal cases expose late-window races and failures after an accepted request.
Ordinary cases execute the actual inline module with in-process collaborators under
the unchanged deterministic guard; they make no network or subprocess calls.

G1 adds only the controller job key, appended aggregate dependency and controller
success in the existing CLI result literal. G2 adds only controller success to the
existing PR proof fixture. All old assertions and worker steps remain. Package and
suite configuration stay identical to the admitted base.

This is historical offline preparation with Actions read only. Actual L1 scoped
cancellation, cancelled service conclusion, L2 same-head full preservation, hosted
Node/Mac/demo outcomes, complete forge listings and final merge-base/source delivery
remain unproved. Their original evidence belongs to actual service/API/log records
retained through the #903 card, eventual PR and coordinating owner receipt route;
no future run or outcome is invented here. Local originals are retained by the
coordinator. Owner exact-head ratification and independent judgment remain required.

The initial unpublished pair remains historical source, retained as
`bee7007b0f716e475eb832a255e5580e1a4c8949` and
`884281ea511f571a2d88ac5b5107acdad1b41349` with its original receipts. A source
review found that this card's permission assertion treated a scalar as an object's
characters and therefore missed GitHub's valid `write-all` form. The actual workflow
permissions were already safe; no controller logic needed correction.

The own permission test now distinguishes inherited permissions, `read-all`, and
read/none mappings from write authority or malformed forms. A parsed workflow
`write-all` property produced a named red, then all 17 focused cases passed after
the minimal guard correction. A one-anchor mutation of the actual workflow's plan
job to `permissions: write-all` was parsed and the named configuration fence failed
on that job. Exact workflow bytes were restored and the focused cases passed.
Original sources, outputs, mutation guards and old commit identities remain retained;
none of those observations is relabeled as a run of this rebuilt source.

The corrected offline pair restarts from the same admitted #953 head. This first
stage retains Actions read and the complete identical controller. Its normal local
verification and source records belong to the rebuilt tree. Service evidence and
publication remain held under the original two-stage admission.

The next independent coverage check found that the parsed-request algorithm doubles
and standalone transport test did not compose the actual outgoing HTTP method. The
controller's real method was already correct; only this card's new test needed an
additional boundary case. The prior scalar-hardened pair remains historical source:
`ad04abd6ee1e692e1a180afcf963d8dc812af0e1` and
`e3af15a3f5c32dd7b0643c66d3d71d5e82995e0d`, with its original receipts retained.

One positive older-head case now runs the actual controller through its actual HTTP
adapter and injected raw Responses. Independent literal full URL/method vectors
cover all discovery and final reads plus the POST cancel; authentication, manual
redirect handling and the abort signal are checked at send. Undeclared calls fail,
the response script must be consumed and only the intended ID is accepted. A
one-anchor mutation making outgoing fetch use GET failed this new named assertion
on the actual cancel URL and method. The workflow was restored byte for byte and
all 18 focused cases passed. These are local in-process observations, not service
cancellation or deadline proof.

The pair is rebuilt again from the same admitted #953 source with complete guards
and Actions read in this first stage. Only own new tests and this journal differ
from the previous preparation; all controller and existing test bytes are retained.
No original result is relabeled as a verification of these rebuilt commits.

A bounded follow-up audit found two HTTP fixtures whose malformed JSON could mask
missing response guards. This was one fixture-isolation defect in own new tests;
the controller's decoded size limit and strict UTF-8 behavior were already correct.
The prior HTTP-composed pair remains historical source at
`70555993e043af4cf01c4f2d21efe8cc1279a93e` and
`1878ea8a5b2cd3fadf485e524211af4dc1656779`, with its originals and earlier pairs
retained rather than relabeled.

Dedicated cases now accept valid JSON at exactly the decoded 2 MiB bound and reject
valid JSON one byte above it with consistent length headers and the body-incomplete
error. The strict UTF-8 case places an invalid byte inside otherwise-valid JSON and
requires a TypeError, with valid Unicode as its positive control. Removing only the
decoded cap and disabling only fatal decoding each produced its own named red;
restoring each exact source made that case green. All 20 focused cases passed,
including the composed actual HTTP method case. No production or controller change
was needed and no network, process or timing exception was introduced.

The final offline pair again starts from the same admitted #953 head. This first
stage keeps Actions read; only own new tests and this journal have been hardened.
Actual new commits and normal receipts remain distinct from every earlier attempt.
Publication and all live outcomes remain held under the existing #903 bar.

## Integration with the final #953 source

This local integration starts at reviewed #953 head
`1f3fc6c0a1297b431f32cb735ba82b4fa8eef368`, tree
`1b7ddf409f15bfdc4026bebd0dcdda5d5937d458`. The earlier
`0c58ff2`-based #903 commits and their receipts above remain historical.
No merge of #953 to main or live #903 event is inferred from this worktree.

The #953 plan records the tested merge parent as `base` and the event PR
base as `eventBase`. The old controller compared `base` to the event base,
which refused a valid forward-main event before any API read. One new
actual-controller test at this integration source first failed with
`controller source plan invalid` after the test gave it distinct literal
tested/event bases. The controller now checks the tested parent against
`parents[0]` and the event base against the PR event base. A separate
negative case requires malformed or missing event-base and false-parent
sources to stop before an API read.

The #953 source also added a CI job-key assertion outside original G1/G2.
The first combined focused run showed 49 passing tests and that single
routing assertion failure. The continuing PM adopted bounded G3; the
coordinator's [O79 grant](https://github.com/williacj/rigger/issues/903#issuecomment-6424950416)
allowed only the controller job key and appended aggregate dependency in
that assertion. All prior key, dependency and failure-boundary assertions
remain. The resulting focused run passed 52 tests with no failure.

A controlled one-line restoration of the old source predicate was verified
on disk and made both new named tests fail: the drift case refused a valid
plan, and the missing event-base case reached an undeclared GET. The
workflow bytes were restored exactly, and all 22 controller tests passed.
The complete test output was retained under SHA-256
`8007136d2a87f5e399343c3e104b71e0d8d90a34af318d6bfae3f64de36e23c6`.

At the exact #953 base, after a lockfile install, `npm test` recorded
2,914 passes, nine skips and no failures; the affected workflow host file
recorded 65 passes. The first baseline attempt lacked the locked `acorn`
package and is retained as invalid setup, not a source failure. At this
uncommitted read-only controller source, `npm test` recorded 2,936 passes,
nine skips and no failures (output SHA-256
`dd3f5de04d4a758ff35dc644560a983fa11963a0fb4e1b0629f3194d57e42397`);
the affected host file recorded 65 passes (output SHA-256
`819aa0de048db1ca8fa5892f733a087570e8b57f05491cdbac4fae6867659152`).
These are Linux local measurements only. Hosted Mac, actual H1/H2
cancellation, same-head full preservation, exact-head judges and owner
marker remain unproved.
