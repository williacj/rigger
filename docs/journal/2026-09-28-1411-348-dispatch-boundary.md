ABOUTME: Journal for #348 (M2-08b): the boundary test's rule 9, which bars every module outside
src/scheduling/ from binding L1's dispatching function and nothing else L1 exports.

# #348 — Only `src/scheduling/` may import L1's dispatch

## What was built

- `test/layer-boundaries.mjs` held one function outside src/scheduling/'s reach, L3's entry point,
  under rule 8. That check became a list, `HELD`, and rule 9 is its second row: the function
  `src/execution/run.mjs` exports as `dispatch`. Both rows share the resolution rule 8 already
  had, so rule 9 follows re-exports, aliases, namespace and dynamic imports to where the function
  is defined, exactly as far as rule 8 does.
- The refusal of a tree without the held function is per row, and names the file, the export it
  looked for and the rule, as rule 8's did.
- The test fixture gained a stand-in `src/execution/run.mjs` exporting `dispatch` and
  `killRecordedGroups`, since every report now needs the module present.

## What we learned

- **The rule has to name one export, not a module.** The architect's ruling 1, P1, on #332 has
  the CLI import L1's kill of recorded groups from the same module as the dispatch. A rule over
  `src/execution/run.mjs` whole would refuse that import. Rule 8's shape, one exported name
  resolved to its definition, already fits.
- **Mutations shown to discriminate** (anchor found once, `git diff --stat` shown, the file
  restored byte-exact, run on `test/layer-boundaries.test.mjs`'s 89 tests at `3a2625b`):
  - Rule 9's row dropped from `HELD`: three rule 9 tests failed, the named import, the
    re-exports and the refusal.
  - Rule 9 resolving every export of `run.mjs` instead of `dispatch`: only the kill-of-recorded
    groups test failed.
  - The refusal of an absent module dropped: rule 8's and rule 9's absence tests failed.
  - The refusal of a module with no such export dropped: rule 8's two refusal tests and rule 9's
    failed.
