ABOUTME: Records retained directory-allocation premises, real replacement checks and unresolved platform/history proof for card 901.

# Distinct replacement directory identities

Card #901's [acceptance and bounded grant](https://github.com/williacj/rigger/issues/901#issuecomment-6351608706)
permit the existing filesystem import and two replacement fixtures in
`test/directory-census.test.mjs`. Done requires independently distinct original and
replacement identities, retained descriptor ownership, the unchanged actual census
outcomes, Linux and macOS boundary proof, and independent review.

The maker base is `06b4bcf71143626d1a55a5ca733ed61614950135`, tree
`5d8a7718b596528c7cb5fd85abf7259cf05cbdc5`. Before any card test-body edit,
ordinary `npm test` passed there: 2,623 tests, 2,614 passed, zero failed or
cancelled, nine skipped, 54,978.808792 ms. The complete original and recorded PID
remain in the private card evidence route as `901/baseline.log` and
`901/baseline.pid`.

Each fixture now opens its original directory and immediately registers the
single owning close callback. A bigint fstat captures its device/inode. After the
real removal/recreation, a named premise assertion requires that descriptor still
be open and name the original device/inode; a separate bigint comparison requires
the current path to name a different device/inode. The recorded-scratch fixture
checks those premises before later-start cleanup. Both descriptors stay owned
until teardown, and the close callback closes an owned descriptor only once.

The command still actually removes and recreates its workspace. Its original
exit-zero and escaped-process-ended assertions remain unchanged. The scratch
fixture still actually removes and recreates its recorded path, starts the real
replacement process, invokes later-start cleanup and checks the untouched process,
exact skipped dispatch/card/directory and reason. Titles, requirement declarations,
bounds and other fixtures remain unchanged. No product behavior is changed.

## Discrimination and real boundaries

For each fixture separately, a guarded mutation calls its owning close callback
before the actual removal/recreation. Each anchor occurs once; disk readback and
retained diffs show the mutation landed. Each single named test reaches a failed
assertion at `the original directory descriptor was not retained across replacement`,
with zero cancellation. The failure is the held-descriptor premise, rather than
teardown or a manufactured filesystem identity. Prepared source is restored
byte-for-byte after each mutation, and each restored target passes. Complete
originals and guard/diff records are retained in the private card evidence route.

On 2026-10-22, Ubuntu WSL2 with Node 26.12.0, against prepared test source
SHA-256 `ef984fc25940991d5ccab4f44e31ebbfd853d213900c0a171670beac9460be7c`, the two named real fixtures pass in both
the original sensitive TMPDIR context and standard `/tmp`: two tests, zero failed,
cancelled or skipped, respectively 283.000939 ms and 253.068173 ms. The complete
affected directory-census file also passes in the sensitive context: 28 tests,
zero failed, cancelled or skipped, 14,839.066914 ms. The commands use
`sh test/suite.sh --host`, with the two named tests selected for the focused runs
and `test/directory-census.test.mjs` for the full run. Exact private TMPDIR, PID,
command and original routes are retained by the coordinator under card 901.

Matrix, package-budget, header and diff checks pass. The final ordinary-suite
result belongs to the normal commit-hook original and resulting published head.
The existing CI workflow runs the real host suite on macOS; macOS results remain
pending and Linux results supply no macOS credit. Independent review remains
required, and this journal does not declare the card complete.

## Historical boundary

The coordinator retains the complete original failing reviewer run at the same
base under the private #879 architect evidence route: 16,795 bytes, SHA-256
`790104abab9e5143cc45f5c881d4155ed87e42ea7e00a9a81200814100dd03f0`.
It reports 137 passed and two failed across directory-census and suite-tiers.
The first failure directly records the same inode, 86678n, before and after
replacement. The second reports missing `directory.skipped`; inode equality was
not separately captured there. The original filesystem type was not measured
contemporaneously; the later filesystem report is only a later observation.

Unchanged standard-/tmp results remain separately attributed: affected-file
original 14,870 bytes, SHA-256
`f4421b2ba09b261bc1aa97e835e3bf76461dca7f36cef2a26898f02c5a0a4b7d`,
and focused original 787 bytes, SHA-256
`cbaa8dc164fd1f26aeaf436ba036a03ae73093f8bcd96e84a222f593876d7141`.
Those green results describe unchanged source, not a repair. The prospective
held-allocation checks address the fixture's distinct-identity precondition;
they establish neither a product ABA defect nor a cause for other historical
occurrences, and promise no behavior for reuse after the original allocation closes.
