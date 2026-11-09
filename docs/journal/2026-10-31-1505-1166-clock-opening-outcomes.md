<!-- ABOUTME: Records card 1166's bounded clock-opening stand-in repair and its source-pinned proof custody. -->

# Clock opening outcomes

Card [#1166](https://github.com/williacj/rigger/issues/1166) defines the acceptance. Work began
from frozen `8c09daa75413f6eb67233fd91eb7b92f3f7e5037`, tree
`72107b21becf40f45128e3a9b660d964b65dfa3e`. The filed body SHA-256 is
`586d9efa9f82c95f3ca6099492b8e0ff43c8b01a9da3d49bd1e7219dab0dc714`.

The local opening transport now evaluates its supplied result before recording its end.
Its status and timeout projection follows `ARCHITECTURE.md`, "L0's call events", and
`src/substrate/forge/runners.mjs`, `throughL0`. Independent literal expectations in the existing
refused-opening test require `failed` for its status-1 envelope and `timed-out` for its
status-0 timeout envelope. The test observes that neither end existed when the supplied result
was evaluated. Its original three failure inputs, diagnostic checks, one attempted opening,
no board writes and no L2 transitions remain in the same declaration.

These are measurements from the ordinary suite on 2026-10-31, using Node v26.12.0 and npm
11.20.0. The receipt collection is `1166-clock-opening-outcomes`; each named receipt retains
its source archive and working diff, test bytes, literal argv, environment, start PID,
original standard-output and standard-error streams, and exit status.

| Receipt | Executed scope | Observed result |
|---|---|---|
| `admission-baseline` | Clean frozen base, `npm test` | Exit 0; 4,247 tests, 4,238 passed, 9 skipped, no failures or cancellations |
| `focused-original` | Initial maker command with incorrect quoting | Exit 1 before tests ran; setup error, no proof credit |
| `focused-original-corrected-command` | Unchanged named refusal test | Exit 0; one test passed, zero skipped/cancelled/todo |
| `focused-outcome-red` | Extended same body, unchanged local world | Exit 1; one named test failed at `EVENT-OUTCOME`, actual `ok`, expected `failed`; zero skipped/cancelled/todo |
| `focused-corrected-green` | Same target after local-world correction | Exit 0; one test passed, zero skipped/cancelled/todo |

The three meaningful focused executions use the same literal command:

```sh
npm test -- '--test-name-pattern=^a refused opening names its trigger, occurrence and forge reason and makes no board write$' test/clock-card.test.mjs
```

The earlier green establishes only the old assertions. The red exposes the existing double's
hardcoded successful end; it is not a product-code regression or retrospective execution
credit. The corrected green exercises both returned cells and the original thrown case.
No mutation, real forge, process-start, real deadline or truthful thrown-callback end claim
is made. The existing product test and its other requirement declaration retain their identity;
this change adds no requirement claim and no host-tier declaration.

The source-backed affected-host determination is that no host boundary changes: the diff is
this deterministic file's local in-process opening stand-in, its existing assertion body and
this journal. The opening uses its injected `send` and in-memory sink; production imports,
runner wiring, add/move doubles, process code, suite placement and deadlines are unchanged.
`import-closure` retains the measured static closure and `final-head-index` binds that
judgment to the exact committed diff. No supported-host execution is credited by this repair;
other supported-host results remain unproved here.

Final verification originals are resolved by `1166-clock-opening-outcomes/final-head-index`,
which binds `normal-hook-commit`, `final-deterministic` and `final-matrix` to the committed
head and tree. That external index supplies the final results without a journal-only commit
changing the head it describes. Receipt custody and the private access route travel with the
maker handoff; private machine paths and raw logs are excluded from this journal.
