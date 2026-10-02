ABOUTME: Journal for #530: dispatched Claude Code sessions are not given `Workflow` unless the
repository declares it, after the owner's O52.

# #530 — withholding `Workflow`

**`Workflow` joins the agent tool among the withheld tools.** #480 classified it as acting within
the session, since its definition reads "Execute a workflow script that orchestrates multiple
subagents" and those subagents are the session's own. O45 had already withheld the agent tool so
that a dispatched agent gets no subagents, and #522's engineer judge found that `Workflow` still
gave it some. O52 closes that gap for the same reason O45 gave: no flag limits what a workflow's
agents may do. The change is one entry in `OWNERS` and its reason beside it. The declaration route
is the one the other withheld tools use, a repository's own `permissions.allow` naming the tool.

**Only the first new unit test could fail at the base.** The base never withheld `Workflow`, so
the test that a declared `Workflow` is not withheld passed there by construction. A mutation that
withholds `Workflow` whatever the directory declares shows that test discriminates instead.

**The live runs on Claude Code 2.1.287 show it gone.** Each start record's `tools` omits
`Workflow`, and `--disallowedTools` names it after `Task`. Nothing else in the records moved: the
tools offered are the fifteen built-ins `CLASSIFIED` lists, with `ToolSearch` absent from the
background-task run, whose settings turn tool search off.
