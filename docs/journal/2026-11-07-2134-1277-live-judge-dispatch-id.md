<!-- ABOUTME: Journal entry for #1277: the live Codex judge test now stamps its judge's dispatch id, as L3 does. -->

# The live Codex judge test fills its judge's dispatch id

`test/provider-codex-live.test.mjs`'s judge test handed `judgeAnswer`'s answer to `roleDispatch`
unstamped, under the id `d-live-judge`. Its judge's instruction kept the slot
`dispatch: <the dispatch id>`, so the judge wrote `dispatch: unavailable` and `parseMarker` read
the posted marker as `unreadable`. The test now mints `d-${randomUUID()}`, fills the instruction
with `dispatched` from `src/workflow/marker.mjs`, runs `roleDispatch` and L1's `dispatch` under
that one id, and asserts the posted marker's `dispatch` equals it.

**When it went red.** One commit added this test's `parseMarker` assertion and the `dispatch`
field's validation, measured with `git log -S` at `a21d172d`:

```
$ git log --format='%h %ad %s' --date=short -S"const parsed = parseMarker(held[0].body, 1);" -- test/provider-codex-live.test.mjs
3e4f1032 2026-10-10 Replace the findings comment with the verdict marker
$ git log --format='%h %ad %s' --date=short -S"DISPATCH = /^d-" -- src/workflow/marker.mjs
3e4f1032 2026-10-10 Replace the findings comment with the verdict marker
```

**L3 instructs a real judge with its dispatch id.** Yes. `dispatchRole` mints the id and hands
`roleDispatch` `stamp(answer, id)`, with `dispatched` as the stamp for a judge
(`src/scheduling/loop.mjs`). `test/judge-dispatch.test.mjs` L354, "given L3 dispatching a judge
under an id, the instruction that judge's stand-in agent received names that id as its marker's
dispatch", shows it, and it passes at this head. The fault was the fixture's alone.

**Cases no acceptance item decides.**

- The card names L386 as the `parseMarker` assertion. At `368e7e17` L383 calls `parseMarker` and
  L384 asserts on its answer; L386 matches the shared skill's marker. Item 8's "L386's
  `parseMarker` check" is read as L384's `deepEqual`, which is where both red runs failed.
- The card's #1237 run counted 7 tests in the file; at `368e7e17` and at this head the file
  holds 6.
- In a live run the new dispatch-equality assertion follows L384's, so an unstamped instruction
  fails at L384 first and the equality assertion cannot red alone there. It guards a marker that
  parses with the wrong id.
- `DISPATCH` is not exported, so the test holds its own copy of the pattern, as the card allows.
