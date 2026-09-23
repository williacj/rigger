ABOUTME: Records why card #113 extends the document checks to agent prompts and skills, and
ABOUTME: what the widened scan had to distinguish before those files could be checked.

# Instruction paths need a scope

The path check read only three documents from `doc-references.json`. A missing path in an agent
prompt and its template twin therefore passed every check, even though both copies would reach
future users. The config now names every tracked Markdown prompt and skill under `.claude/` and
`templates/claude/`. A test compares that list with git's tracked files, so adding another such
instruction file without listing it is a failing test.

Widening the scan first exposed two JavaScript members in the TDD skill as false paths. Those
two spans are excluded by name; a root file with any short extension remains a path. The first
review caught the distinction with `missing.js`, which a narrower classifier missed. The scan
also found `docs/spikes/` in the spike engineer prompts. The
build plan puts the future WSL2 report there, but no report has landed, so the config exempts that
directory with the reason and stops exempting it once it exists.

With a nonexistent path appended to both engineer prompts, `check:paths` named both files and
the missing path, then exited one. The focused path-check run reached its tests and failed on
those two findings. Restoring both files returned the check to zero findings. This is the
boundary the earlier twin-divergence test did not cover: two matching instructions can still
agree on a path that names nothing.
