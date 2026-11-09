ABOUTME: Records what card #1336 learned about reading a repository's Actions event policies for `doctor`.

# Actions event policies in `doctor`

GitHub's list of a repository's Actions policies does not carry their conditions or rules. A read of `williacj/rigger`'s list at API version 2026-03-10, made on 2026-11-09, answered each policy's id, name, `source_type` and `enforcement` only. Its `workflow_path` and `allowed_events` came from the policy's own detail read. So `doctor` reads every page of the list, then makes one detail read for each policy of the repository's own.

The read runner admitted no header but the diff's, so the version header the policy endpoints are read at could not be sent. The first version of the card did not list `src/substrate/forge/runners.mjs`, and the maker escalated it as `ambiguous`. The architect ruled that the runner admits that one header as a fixed literal, after `-X GET` only. The live probe in `test/forge-runners.test.mjs` now asks `gh` about that form as well, and gh 2.98.0 sends it as a GET with no body.

The gate line had two verdicts. It now has a third, `not asked`, for the case where only the event policy could not be judged. That covers a public repository an organization owns with no policy of its own, since an organization's policy is outside the read, and a `workflow_path` glob that coverage turns on. A failed read stays `failed`, as every other read on the line does.

The test fakes for every other `doctor` test answer the new reads as a public repository a user owns, holding option 1's policy. Their answers were added beside the gate fake's, and no existing line changed.
