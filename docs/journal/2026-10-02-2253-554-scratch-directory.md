ABOUTME: Journal for #554 (M4-02d): each role's dispatch gains a scratch directory outside every
worktree, and an adapter's set variables may name it, as architect ruling 18 on #467 proposes.

# #554 — a scratch directory for each role's dispatch

**Why.** #489 runs Codex under a per-dispatch `CODEX_HOME`. #473's report found that only such a home
kept the owner's plugins, connectors, command rules and model choice out of a session, and kept its
rollouts out of the owner's home. That home holds a link to the owner's `auth.json`, so it must lie
outside every worktree. A maker's dispatch directory is the card's worktree, the tree it stages and
opens a pull request from. Ruling 9's limit 3 also allowed a set variable to name only the
dispatch's directory.

**What changed.** The Failure model now gives each role's dispatch a scratch directory,
`scratch/<topic>/<role>` under the worktree root and outside every worktree, which L1 makes fresh
before L3 dispatches the role. No topic can derive `scratch`, because every topic holds a digit. The
provider adapter paragraph now lets a set variable name a path under that directory too. Every other
limit of ruling 9 stands: no key L1 removes, and no credential variable.

**Order.** This is a proposal, and the owner's merge ratifies it (`D21`). The L1 scratch-directory
card and #489 merge only after it.

**The sweep reaches the scratch directory too.** #557's reviewer found that the inserted sentence put
the scratch directory right before "it also kills every process … whose working directory is that
directory", so "that directory" could be read as the scratch directory. `R-STATE-17`'s scope puts out
of the rule only a process "working in no directory Rigger made for a dispatch", and the scratch
directory is one Rigger makes for a dispatch. So the census sweeps it as well. The paragraph now names
the dispatch's directory and its scratch directory where it has one. L1 records each in the
dispatch's entry, and a later start checks each one's identity before sweeping it. #555 builds that
(ruling 20).
