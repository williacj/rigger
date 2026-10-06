ABOUTME: Records why card #680 teaches judges the executable shapes for reading and testing a pull request.

# Judges reaching the head

Card #680 follows the live judge refusals in #495's second run. The judge's working directory holds the repository history, while its sibling `head` holds the provisioned pull request. The old instruction named the destination but gave no usable command shape. The Claude judges tried git in `head`, `git -C`, package prefixes and shell status expansions; those commands were refused, and one judge tested the unprovisioned working directory.

The instruction now supplies the pull request's two SHAs in a `git diff` command for the working directory. It gives `cd ../head && <command>` for a command in the provisioned head, bars git there, and points the judge to the tool result for the exit status. It also asks for one command per tool call. These are L2 directions; the provider adapter's grants did not change.

The new instruction tests went red against `origin/main` before the instruction changed. A gated live test uses two detached worktrees of a local fixture repository, the composed L2 prompt, the Claude adapter at the standard tier, and a stand-in `gh`. In one guarded run with the source instruction restored to `origin/main`, Claude attempted git in `head` and `git -C`, and the test failed because no Bash diff with both SHAs succeeded. The updated instruction's live run then succeeded in three consecutive trials after it explicitly required the diff as its own tool call.

The first baseline full suite run failed a process cleanup test's assertion that its fixture leader had ended. That test passed alone, and the next full suite run passed without a code change. The first live test assertion missed denials using `../head`; it was corrected to inspect both relative and absolute forms before the instruction was judged. A later live run skipped `git diff` because the evidence already carried the diff; the instruction now orders the command even in that case.
