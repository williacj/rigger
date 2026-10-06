ABOUTME: Journal for #489 (M4-14): why the live judge test checks head's markers in the session's
instruction sources rather than anywhere in its rollout.

# #489: what the live judge test means by "loads nothing of head's"

**Why.** The owner's live run at `c65f7f7` failed one test with `OSPREY-c489-head-agentsmd from head
reached the session's rollout` (issuecomment-5984647368 on #489). The judge's prompt is its
instruction plus its evidence, and the evidence ends with the pull request's diff (`R-EVIDENCE-1`).
The test's head commits the very files that carry the markers, so the diff, and the user message
in the rollout, holds all four on every run. The old check asserted that no marker appeared
anywhere in the rollout, so it failed by construction. It came from #519's spike, whose prompts
carried no diff.

**What the run showed of Codex itself.** The checks before it passed: `world_state.agents_md` named
`main` with main's text only, and `host_skills` named nothing under `head`. The judge's first draft
attributed all four markers to "the PR diff" before reading any file.

**What it checks now.** It checks the instruction sources: `session_meta`, `turn_context`,
`world_state`, and every non-assistant message, which is where Codex puts an `AGENTS.md`. The one
handed diff is cut out of them as a contiguous block. Two positive controls keep that cut from
passing vacuously: the diff must be present, and main's marker must survive the cut. The coordinator
granted the retarget under O79 (#489). A throwaway check on synthetic rollouts, outside the
repository, showed it still fails when head's `AGENTS.md` or config marker is loaded.

**One deviation from the granted text.** The granted block named the cut string `handed`. The test
already binds `handed` to `roleDispatch`'s result, so the block is committed with that string named
`given`.
