ABOUTME: Journal for #346 (M2-07c): narrowing the boundary test's `child_process` exception to
the process adapter, once forge, doctor and init all spawn through it.

# #346 — Only the adapter imports `node:child_process`

## What was learned

- **The exception was already empty.** At origin/main 580cb13, `grep -rn child_process src`
  finds one import, in `src/substrate/process.mjs`. The runners module, `doctor.mjs` and
  `init.mjs` all spawn through `runCommand` and friends, so narrowing `SPAWNERS` reddened nothing
  in the real tree.
- **A dynamic `import()` of `child_process` was refused, but not by rule 7.** It resolves to no
  module under `src/`, so the dynamic-import rule caught it and named what it could not follow.
  The card asks for rule 7 to fail by that route too, so the test now reports both. The
  dynamic-import rule keeps its own report, and its existing test is unchanged.
- **Mutating the real tree reds two tests, not one.** Adding the import to `doctor.mjs`,
  `init.mjs` or the runners module fails the whole-tree test, and also the rule 9 test that adds
  a CLI module to the real tree and expects it clean. Both report the same rule 7 message.

## What surprised

The fresh-clone baseline at 580cb13 had one test in `test/exit-cleanup.test.mjs` cancelled at
its 30 s timeout under the full suite. Run alone in the same clone, that file passed 85 of 85.
That looks like load on the shared host rather than this card, and it is outside it.
