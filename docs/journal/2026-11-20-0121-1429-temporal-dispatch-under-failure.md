ABOUTME: What spike #1429 learned about a card dispatched as a Temporal activity when its worker dies, its host is lost, or its workflow code changes.

# Temporal dispatch under failure

The report is [`docs/spikes/temporal-dispatch-under-failure.md`](../spikes/temporal-dispatch-under-failure.md).

## What we learned

- **Temporal recovers the attempt, not the agent.** It restarted a dead worker's dispatch within
  5 s to 6 s, and moved a lost host's dispatch to another macOS host in 37 s. On macOS and Linux,
  though, the orphaned agent tree ran to its natural end while the second attempt worked the same
  card. On Windows the tree died with the worker.
- **The event history keeps only the final attempt's start.** A heartbeat's details are the one
  place that records where an orphan is, so a dispatch activity should write its process group
  and worktree there.
- **An unguarded workflow code change strands in-flight cards in `Running`, with no failure.**
  `patched()` avoided it.

## What failed

- **The spike's own workflow code** imported `TimeoutType` from `@temporalio/workflow`, which does
  not export it, and broke the first re-route run.
- **Stopping a background task in the spike's session also stopped a worker** that the task had
  started. Long-lived processes need starting outside any task that might be stopped.
- **Two of three `claude -p` runs failed to authenticate.** The first ran under a test-made
  `CLAUDE_CONFIG_DIR` with no credential. The second ran under the owner's `~/.claude`, with the
  environment stripped to `PATH` and `HOME`. Both printed `Not logged in`. The third, granted
  with the worker's full login environment, authenticated through the owner's stored Keychain
  login. A dispatched agent can log in only when its worker's environment carries what that
  login needs. The third run also resolved a different `claude` binary, so the cause is not
  isolated.
- **An SSH local forward through Windows OpenSSH stalled after about five minutes.** A fresh one
  worked, and the cause was not chased.
