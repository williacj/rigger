ABOUTME: Journal for #493 (M4-S2): what running Rigger's own maker and judges unattended, under its
own settings, taught us, and what failed on the way. The report is
`docs/spikes/what-unattended-sessions-are-refused.md`.

# #493 — what an unattended maker and judge are refused

**What we learned.** Under the settings as the adapter carries them, nothing a maker or a judge
must do to finish is allowed. A maker cannot write a file in its own worktree, by `Edit`, `Write` or
a shell redirection, and a judge cannot post its verdict. Every one of the six sessions still exited
0. So the engine's only signal was the missing pull request or findings comment. Two allow entries,
`Edit(./**)` and `Bash(gh pr comment:*)`, were enough for a `type:change` maker and judge to finish.
The report has the measurements.

**What surprised us.** The base's `Bash(git push:*)` lets a session push onto `main`, and nothing
stops it. The `deny` rules and the hook cover force-pushes and deletes, not a push's destination. A
probe session did it. Since a fast-forward push is a merge, that is also the one route to a merge.
#494 may change only the allow list, so it cannot close this. The report hands it to #494 as a
finding.

**What round 1 of review caught.** The report first said `Edit(./**)` could not widen the four acts,
on the strength of one refused edit of `.claude/settings.json`. The hook script lies under `./**` too,
and that was unmeasured. Measured on review, Claude Code refuses every write to the script tried.
`Edit`, `Write`, redirection and `cp` were refused as "a sensitive file", and `tee` as needing
approval. Round 2 asked the same of
`.claude/settings.json` by shell. `>`, `>>` and `cp` were refused as not granted, and `tee` as
needing approval. So the entry stands, but the first claim had outrun its evidence.

**What the judges did instead.** Refused one route, a judge tried the next. They tried
`npm --prefix`, `git -C`, `git worktree add`, `git checkout` in `main` and `git archive | tar`, each
an attempt to reach or rebuild `head`. Only `cd <head> && npm test`, which #531 measured, got
through. The engineer judge on the `type:spec` card never reached `head`. It read the
base's `docs/spec/requirements.md` from `main`, with the diff beside it. A judge that cannot reach
`head` easily will judge from whatever tree it can reach.

**What failed on the way.**
- The first world named its bare repository origin.git, and `test/init.test.mjs`, which reads the
  repository's name from `origin`, reddened the suite. I rebuilt the world.
- The suite is red on any fake forge, because one test takes the first non-refusing `gh` on `PATH`
  to be the real one. Filed as #627.
- The first iteration changed the settings without the template, and reddened the suite again.
- Sessions save oversized tool output under `~/.claude/projects/`, outside the dispatch's directory.
  Filed as #629.
- The host's load stayed above 24, from other sessions' suites, for most of the evening. So every
  run waited at its start until the one-minute load fell below 24. Several ran while it rose again.
