ABOUTME: Records why card 661 treats git's definite answer as a refusal while an unanswered check holds Done back.

# A negative answer is a refusal

Strict recognition treated every nonzero git exit as an unanswered check. That kept a workspace
in Review after its registration was dropped but its .git entry remained. Every later pull got
the same answer, so retrying could never remove the path or move the card.

The PM's C1 ruling on #661 distinguishes a completed check that answers no from a check that
gives no answer. The revised table makes the leftover workspace a refusal under R-WORK-13.
Git's explicit exit-128 answer that the path is not a repository now reads as no worktree in
either recognition mode. Other recognition errors and timeouts retain the failed-check path.

The counterexample uses git's actual administrative directory, drops it, and asks the real git
the recognition question before two pulls. Both pulls settle, the first moves the card to Done,
and the leftover directory's bytes, modes and branch stay unchanged. L1 names it once. This
ties the copied diagnostic to git's own answer rather than giving a stand-in that answer.

The filesystem test gives scratch replacement a file where a directory is required. That
completed check leaves the file and its modes unchanged, names the role path and the nonempty
topic, and permits Done. Taking away the refusal tag makes the test reject, so it distinguishes
a refusal from a failed removal. The tests for unanswered git and filesystem checks and for a
timeout remain unchanged.
