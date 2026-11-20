ABOUTME: Records the boundary choices proposed by card #1438 for judge failures and provider prompt limits.

# Judge failures and prompt limits

Card #1438 carries the architecture prerequisite for #1437. Its acceptance revision is
9abd0370a3b9, measured by SHA-256 of the card body returned by `gh issue view` on 2026-11-20.
The placement follows the architect's ruling at
https://github.com/williacj/rigger/issues/1437#issuecomment-7051205090.
This delta is a proposal; the owner's marker ratifies it under D35.

At base bbaa0429c1719d2a23774613f9d707f4be10ad39, the failure model's no-survival passage covered
all judge failures. The proposed text confines it to a failure to start under R-FAIL-8.
A started judge's failure instead survives as an L2 event, which L2 counts from the record
L3 hands it unread. Recording a failure before a readable verdict preserves the verdict's
reset of the count. Every review.escalate resets it, regardless of its raiser; a hand-added
label does not create that event.

The other boundary gives L2 one provider fact: the prompt limit. L2 composes the prompt and
its evidence digest, so it measures after the dispatch id is filled and builds paths evidence
there. L1 can then deliver the evidence and record its digest without changing either.
A limit depending on dispatch facts held only by L1 would reverse that placement.
Forge read lag or a costly whole-record read would reopen the failure-count placement.

Before drafting, a search of test/ for ARCHITECTURE and docs/journal found the published-config
checks, budget readers, document checks and path fixtures. No coupled file needs an edit for
these prose changes. The config shape, budgets and runtime code are outside this delta.
No existing test line changes, and this structure card adds no requirement claim or test.
#1437 owns the implementation, tests and numerical provider limit.

The deterministic baseline ran through the host-wide slot with the dispatched TMPDIR.
Measured by npm test at the base on 2026-11-20, it reported 5965 tests, 5965 pass, 0 fail and
0 cancelled. Uptime read one-minute load 23.67 at start and 29.18 at end; the starting process
count was 611 on a 12-CPU host. The full output is retained as 1438-baseline.log in the
card's scratch directory. The PR carries verification at its final head.
