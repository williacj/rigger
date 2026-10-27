<!-- ABOUTME: Records the observed GitHub run-list gap and test-first repair of #903 cancellation discovery. -->

# #903 sparse run attribution

The first live read-only controller run at [40396241081](https://github.com/williacj/rigger/actions/runs/40396241081) failed while validating a workflow-run discovery row. It made no cancellation request. The original response body was not retained, so that run alone does not identify the invalid field and earns no L1 credit.

A later GitHub API read on 2026-10-26 at 20:36 UTC showed the difference this repair addresses: the active workflow-run list represented the same PR run with an empty pull_requests array, while its detailed run endpoint supplied one PR association. The original list and detail responses and their hashes are retained with the acceptance evidence. This observation is a current API measurement, not a reconstruction of the earlier failed response.

The [continuing acceptance for #903](https://github.com/williacj/rigger/issues/903#issuecomment-6426803279) admits sparse list rows as transport envelopes. The list's immutable source fields and any association it does carry must agree across duplicate pages and with a detailed GET. Every older, different-head run is resolved before the first cancellation request; a detailed run without one valid association still fails closed. The existing final live-PR, target-run and own-run rereads remain at the action boundary.

The focused test for a sparse list row failed with run attribution invalid before the change and passed after it. A second test failed because an earlier target received a POST before a later target's invalid detail was discovered; it passed after the owner-approved discovery refactor. The affected controller file then passed 26 tests. On this repair worktree, npm test measured 2,940 pass, 9 skip and 0 fail with Node 26.12.0. The private original test outputs and hashes remain retained.

The implementation at this stage still has read-only Actions permission. Fresh meaningful H1/H2 live overlap, same-head full-run preservation, configured hosted Mac proof, independent final reviews, and the protected exact-head owner marker remain required before #903 can merge.
