ABOUTME: Journal for #491 (M4-10b): concurrency holds across a restart of the installed `run`, with
makers that never exit and grandchildren left outside their groups.

# #491 — concurrency across a restart

**`run` records no `run.start`.** The verb fires one pull through `trigger`, so L3's `run.start`
event, which only the loop's `run` entry records, never appears in the verb's stream. The test reads
each run's record by its `run` id, in the order each id first appears. The killed run is the first
id, and the restart the second.

**The dispatch's directory census also reaches the stand-in.** The stand-in works in its card's
workspace root, which is the dispatch's recorded directory. So the restart's sweep of that directory
would end the stand-in even if the group kill did not. A mutation that removes only the group kill
therefore says nothing about item 10. The mutations that discriminate are listed in the pull request:
skipping the restart's kill of recorded groups altogether, narrowing "works in" to the directory
alone, and dropping the kill events.

**The grandchild chain needed a stand-in mode.** The existing `leaveIn` mode starts its process
straight from the stand-in, so its parent is still alive. The new `orphanIn` mode puts an intermediate
`node -e` between them. The intermediate stays in the stand-in's group, starts `tail` detached (a new
session, so a new group), writes the grandchild's pid, and exits. The stand-in, a Node process waiting
in its hold, reaps it, so the intermediate does not linger as a zombie. The grandchild's command line
names the stand-in's directory, so that directory's sweep ends it.

**A zombie is told by `ps` state.** `process-fixtures.mjs`'s `alive` uses signal 0, and a zombie
answers that. So the test reads `ps -o stat=` for every point that asks whether a process is alive,
and the restart's recording `gh` does the same at its first call.
