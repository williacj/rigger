ABOUTME: Records card #223, the fake `gh` that answers the forge adapter from the fake board, and
what deciding which commands it answers, and recording them, turned on.

# 2026-09-25 — A command is its shape

Ruling 1 (U9) reaches the fake board below L0, at the `gh` process boundary: a fake `gh` placed
first on `PATH`, and no production line knowing it is there. This card built it in
`test/fake-gh.mjs`. The adapter's own spawn finds it, and nothing under `src/` changed.

**A command is its document's shape.** The card asks for the set of commands the fake answers to
equal the set the adapter issues. Two requests for different boards, cursors or item IDs have to
count as one command, or the set would be a list of test values. So a `gh api graphql -f query=`
request is keyed by its document with every string and number written as `_` and every list as
`[]`. The list rule is what lets `createField` with one option and with three be one command.
Aliases and argument names survive, so a page with `after` is a different command from the first
page. The fake answers exactly eleven shapes. A later page of fields is not among them, because no
adapter test asks for one. A fake board with more than a hundred fields would fail closed there
rather than answer something nobody recorded.

**The board lives in a file, because `gh` is a process.** The runners spawn `gh` synchronously,
so a test process cannot answer its own child while it waits for it. The fake `gh` reads the
model's arguments and its write record from a file beside it, rebuilds the fake board, replays
every write through the board's own operations, answers, and saves the record again. So a write
the adapter sends lands in the model's own write record rather than in a copy the fake keeps.

**Recording had to leave the stack as it was.** The adapter's tests inject `send`, so recording
at the spawn sees nothing. Wrapping `send` put a frame between the read runner and the spawn, and
`forge-read.test.mjs` reads that frame to prove every request reaches the spawn from the read
runner. That test failed under recording. A namespace call (`runners.readRunner`) failed it too,
because V8 names that frame `Module.readRunner`. What works is a module hook that gives each side's
import of the runners a wrapper, which records the arguments and calls the real runner by name.
The item-write runner's own read of the columns field goes through a local binding the hook cannot
reach, so for that runner alone the wrapper records at `send`. No test reads that runner's frames.

**Every module under `test/` is a test file to `node --test`.** The recorder first wrote its
record to fd 3 at exit. Run by the suite as a test file, it crashed on a descriptor nobody had
opened. It now records only when given a path after the test file on its command line, and does
nothing when the suite runs it bare.

**`module.register` is deprecated on Node 26 (DEP0205) and is the only hook API on Node 20.**
CI runs Node 20 and 24, and `module.registerHooks` arrived in 22.15. So the recorder uses
`register`, and a recorded run on Node 26 prints the deprecation warning into the child's stderr.
`node --test` in this worktree on 2026-09-25 ran 489 tests and passed 489 on both Node 20.20.2
(through `npx node@20`) and Node 26.5.0.

**Item 2 went back to the card's author.** Reading the model directly and reading it through the
adapter give different shapes. The model's `readColumns` answers the board's whole option list,
and the adapter's answers the config's keys mapped to display names. The model's `readItems`
answers every item with its type and repository, and the adapter's answers only this repository's
issues, with fewer facts. "The same cards and columns" did not say which projection makes them
comparable, and choosing one is choosing what the item proves. The PM ruled for projecting the
model onto the adapter's read contract, and split the item into three: the card read, the column
read that succeeds, and the column read that fails. The fake already met all three when they were
written, so each test's worth rests on mutations of the fake instead of a first red. Presenting
another repository's issue as this one's, answering ids other than the model's, reversing the
order, answering fixed column names and renaming the `Status` field each redded the test it aimed
at.
