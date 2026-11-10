ABOUTME: #1379 (M7-88): a fresh maker's exit 0 with no open pull request escalates at its settle.

# Maker with no pull request

Done means the acceptance of [#1379](https://github.com/williacj/rigger/issues/1379) at revision
`a13d3128dbef`. L2's `settled` answers a loop-raised `ambiguous` escalation where a maker that
started the card from the beginning exits 0 and L2 reads no open pull request, or cannot read
whether there is one. L3 now reads the workspace's tip for every maker that exits 0 and hands it to
L2 with the workspace's path, so the escalation comment names both.

Once the owner answers and the card starts again, `R-WORK-10` makes its workspace afresh. The
escalation's workspace line, the path and the commit at the tip of its line of work, is then the
owner's only pointer to the commit the maker left.

A fresh attempt is told from a continuing one inside the settle by what L3 hands it: a continuing
maker is handed `expectedHead` or `tipFailure`, and a fresh one `tip` or `tipUnread`. The unit
tests of the continuing path call `settled` with `expectedHead` or `tipFailure` alone, so keeping
that contract left them unchanged.

The new tests run the `once` verb through `test/optional-config-world.mjs`: real git, the fake
forge and a logical maker. The deterministic tier admits only `git` and `tar` as processes
(`test/suite-guard.cjs`), so a new test file cannot start the stand-in agent the transitional
`converting` files start.

Cases met that no acceptance item decides:

- **The issue-comment read fails after a fresh exit 0.** L2 reads the comments before the pull
  requests, to find a maker note. Its failure still rejects, as at the merge base, so the card
  stays in Coding and a later pull dispatches its maker again. No row of Table N names it.
- **The demo's recorded screen.** The demo world seeds no issue, so its card's escalation comment
  is refused and `rigger once` there now says "Rigger escalated it as ambiguous: …". The CI demo
  job's grep in `.github/workflows/ci.yml` still matches the old line, and `test/demo.test.mjs`'s
  `SCREEN` and `docs/demo.gif` still show it. The workflow is a Self-hosting path and the GIF is
  outside this card, so neither changed here.

`src/cli/once.mjs`'s `makerOutcome` and the verb's escalation line now write a loop-raised
escalation at a maker's settle as Rigger's, with its reason on one line and no acceptance item.
The same line serves `R-LOOP-20`, which wrote "acceptance item undefined" at the merge base.
