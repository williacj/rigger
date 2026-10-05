ABOUTME: Journal for #619: retrying a maker that never started and keeping stopped or withheld cards out of later pulls in one run.

# #619 — retry and invocation admission

L2 already counted a workspace, required step, or step start failure as an environment attempt failure. A maker whose dispatch never started instead passed through the settle path without spending an attempt. L3 then released its slot, and `run` could pull the same card again on the next free slot. The same repeat followed a second failed workspace or step attempt, or a judge L2 withheld.

L2 now counts a maker's `NOT_STARTED` outcome with those attempt failures. L3 asks L2 for the retry decision after the maker settles, makes a fresh workspace for the second attempt, and reports a stopped card through a failure carrying its card number and both attempt failures. That failure is the shared `once` and `run` presenter's source for the maker stop wording.

The first full suite exposed an interaction with the test harness's injected fresh verdict: L2 settled the maker, then `nextAction` treated the card as fresh and answered `ignore` instead of counting the failed dispatch. Freshness now applies at the initial attempt's pull, and an ongoing maker failure or later attempt reaches the retry decision.

For this interim M4 behavior, one `run` remembers cards it stopped and cards whose judges L2 withheld. It leaves them out of later pulls in that invocation. A new invocation starts with an empty set. The architect's proposed `ARCHITECTURE.md` passage says M6's hold replaces this memory; the owner ratifies that passage by merging the card.

The new tests exercise a real L1 workspace and process start, the retry decision, a freed slot beside each failure class, a withheld judge, and a later invocation. Base-red runs use the head's new tests over the base source. The pull request carries the run outputs, budget figures, fresh-clone result, and CI evidence.

The judges found that L3 still read `NOT_STARTED` from a maker outcome before asking L2, and that eight retargeted rejection assertions checked only whether something rejected. L3 now hands each maker outcome to L2 unread after settle; L2 alone distinguishes a dispatch that never started from an outcome that ends the attempt. One shared test validator checks the stopped card number, both attempt failures, and the message that carries them. The red tests showed L2 rejecting a completed maker and L3 omitting the handoff before those two changes.

The first full revision run exposed L2's branch for a kind with no `provisioning`: it answered `dispatch` even when handed a completed maker. A focused test went red on that answer. L2 now classifies the maker outcome before that branch, and L3 follows L2's retry or stop action while preserving the attempt's prior reached result for any other action. The coordinator granted updates to existing call-count and forge-facts tests because this handoff adds one L2 call. The updated test matrix and full native suite pass.

The second judge round found stale wording above `loop` and a decision L3 asked L2 to record when the maker settle had failed. A focused test first observed `attempt.failed` for a retry L3 would never make. L3 now asks L2 about the maker outcome only after the settle succeeds. The docs above `loop` and `attempt` describe that boundary.
