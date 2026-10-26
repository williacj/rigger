ABOUTME: Journal for #744 (M6-S1): what measuring launchd with a stub taught us, and how most of the
spike's transcript was lost. The report is `docs/spikes/launchd-as-a-supervisor.md`.

# #744 — launchd as a supervisor, and a lost transcript

**What we learned.** A per-user LaunchAgent under `StartInterval` never overlaps a running job, and
re-launches it one interval after it exits. launchd never signals a process in a group of its own,
so Rigger's exit cleanup is the only thing that ends a dispatch's group. launchd's default
`ExitTimeOut` is 5 s, which is shorter than one cleanup read that runs to its bound. Its default
`PATH` finds no CLI the engine needs. A LaunchAgent's notification reaches Notification Centre, and
a job in `~/Library/LaunchAgents` starts at the next login, not before it. The report has the
measurements.

**What failed.** The spike kept its command transcript, its command outputs and its draft report in
a scratch directory under the worktrees directory. That directory was removed before the report
merged, by whom is not established. Only the job logs survived, because the card had put them under
`~/Library/Logs`, outside every worktree, to survive the reboot. Four cells were lost with the
transcript, and the owner waived four acceptance items that needed it (U50). A spike's transcript
belongs where its logs went, outside anything a sweep reaches, from its first command.

**What was slow.** The reboot Q-l needed ended every session on the host, so it waited four days for
a time when no other card's work was running.
