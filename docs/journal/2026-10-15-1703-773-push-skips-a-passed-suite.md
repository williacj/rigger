ABOUTME: Records card #773, under P61: the commit and merge hooks record each tree a green suite
passed, and the push hook skips the suite when every pushed tip's tree is recorded.

# The push hook skips a suite the commit hook already passed

`refuse-if-suite-red` now takes the tree the hook's index holds when the working tree equals it, before and after `npm test`. It appends that tree to `rigger-suite-green-trees` under `git rev-parse --git-dir` only when the suite is green and both trees agree. That rules out a working tree with an unstaged change, an untracked file `.gitignore` does not exclude, or a change made or staged while the suite runs. A file git ignores still counts as equal.

`pre-push` collects every update's object while it runs the default-branch refusal, and reads the record only once that refusal has passed. It peels each tip to a commit and its tree, skips deletions, and treats a tip that peels to no commit, such as a tag naming a tree, as unrecorded. It passes `--no-record` to the shared check, so a push never writes the record.

The tag-pointing-at-a-tree case matters because a failed peel yields an empty name, and `grep -F ""` matches any non-empty record. A mutation that drops the empty check and the whole-line match turned that one test red and no other. A second mutation took the tree only after the suite, which is the architect's finding 1 on #773. It recorded a tree staged during the suite, and only the staged-during-the-suite test caught it.

The card reads P61's "every pushed commit" as the tip of each updated ref, never each commit under it. That narrows P61's literal words. The suite at push has only ever run on the working tree, so checking tips weakens nothing that held before.

The record lives in each worktree's own git dir. A commit in one worktree and a push from another therefore runs the suite, which is safe.
