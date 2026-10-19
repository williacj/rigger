<!-- ABOUTME: Records the structure proposed for the owner's verdict verb, and what the architect checked before writing it. -->

# Structure for the owner's verdict verb

M6-22 proposes four deltas to `ARCHITECTURE.md` so that M6-24 has a place to build the `verdict` verb: a second writer on the repository-write side, the verb building the owner's round itself, the L7 row's last verdict, and a budget move. The draft came from #801 at acceptance revision `aca0ef276329`, under U7.4.

The sentence that no process L0 starts has a terminal at its standard input was checked against the code at `2eb2167`. `src/substrate/process.mjs` is the one file under `src/` that imports `node:child_process`. Its `runCommand` gives the child `ignore` or `pipe` at standard input, in a new process group and session. Its reads of the process table use `execFile` and `spawnSync` with Node's default, a pipe. So the sentence holds as the card drafted it.

The budget move rests on `npm run budget:package` at `2eb2167`: `src/cli/` and `src/config/` hold 1,467 production lines, against a row of 1,500. L6 holds none. Moving 300 lines from L6 leaves the package total at 12,000.

"Only L2 reaches it" became "L2 is the one layer that reaches it". The old wording would contradict the next sentence, in which a verb reaches the same side. The residual and the confirmation rule each took a paragraph of their own, because each states one thing.
