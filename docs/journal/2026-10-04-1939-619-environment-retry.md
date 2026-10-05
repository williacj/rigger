ABOUTME: Journal for #619: retrying a maker that never started and keeping stopped or withheld cards out of later pulls in one run.

# #619 — retry and invocation admission

L2 already counted a workspace, required step, or step start failure as an environment attempt failure. A maker whose dispatch never started instead passed through the settle path without spending an attempt. L3 then released its slot, and `run` could pull the same card again on the next free slot. The same repeat followed a second failed workspace or step attempt, or a judge L2 withheld.

L2 now counts a maker's `NOT_STARTED` outcome with those attempt failures. L3 asks L2 for the retry decision after the maker settles, makes a fresh workspace for the second attempt, and reports a stopped card through a failure carrying its card number and both attempt failures. That failure is the shared `once` and `run` presenter's source for the maker stop wording.

The first full suite exposed an interaction with the test harness's injected fresh verdict: L2 settled the maker, then `nextAction` treated the card as fresh and answered `ignore` instead of counting the failed dispatch. Freshness now applies at the initial attempt's pull, and an ongoing maker failure or later attempt reaches the retry decision.

For this interim M4 behavior, one `run` remembers cards it stopped and cards whose judges L2 withheld. It leaves them out of later pulls in that invocation. A new invocation starts with an empty set. The architect's proposed `ARCHITECTURE.md` passage says M6's hold replaces this memory; the owner ratifies that passage by merging the card.

The new tests exercise a real L1 workspace and process start, the retry decision, a freed slot beside each failure class, a withheld judge, and a later invocation. Base-red runs use the head's new tests over the base source. The pull request carries the run outputs, budget figures, fresh-clone result, and CI evidence.
