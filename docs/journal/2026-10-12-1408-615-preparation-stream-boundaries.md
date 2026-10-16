<!-- ABOUTME: Records #615 preparation return-boundary repair and its measured regression checks. -->

# Preserve preparation return boundaries (#615)

Preparation records distinguish a missing stream property, an own `undefined` value, `null`, and a returned string. Empty and partial strings keep their complete returned UTF-8 files; a nonstring return creates no byte file. The synthetic regression also checks that a refused first read starts no later preparation read and never creates the ready cache marker.

Measured on 2026-10-12 by the O240 coordinator's bounded Node test capture, the exact `C615 preparation streams distinguish absent undefined null and empty returns` target failed once before the helper repair in attempt `c615-metadata-0oywg5e7`, at `stdout/absent: return boundary was lost`. The same target passed once after the repair in `c615-metadata-e6qcbi5x`. The captured tracked inputs remained unchanged during each run. These are synthetic return-boundary checks, with no real process-tool or product-repair credit.

The broader prepared-fixture target was measured by the same capture in `c615-prepared-8o46fdjb`: 44 tests passed, none failed or were skipped, and the tracked inputs remained unchanged. This target does not replace the separately required base/head product proof, exact-head normal suite or focused directory/group Mac smoke. Its retained private originals include the deliberate validator countermodels.

Before this repair, `npm test` at head `1f7265f65cb55c96f25c3eaaf74bf01f15c800f5` was measured by the gated coordinator in `c615-candidate-suite-v96kxkji`: 3,157 tests, 3,140 passed, zero failed, 17 skipped and zero cancelled. This is the pre-edit baseline, not an exact-head result for the eventual integration commit.

The PM selected current base `054d54b249145841aeee73620e9e0d9ba0101282` under [O253](https://github.com/williacj/rigger/issues/467#issuecomment-6119125321), with [different filed-live architect review](https://github.com/williacj/rigger/issues/615#issuecomment-6125152632) and separately posted current-base grants. The local integration record `c615-054-integration-e24570oj` measured a conflict-free pending merge and verified that both preexisting maker-edited files remained byte-identical during replacement of this session's earlier pending merge. Integration does not grant test or merge credit.
