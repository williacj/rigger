ABOUTME: Causal classification, controlled proof and retained evidence for card #1216's closed-before-refill failure.

# #1216 — the live waiter must establish its close premise

Done is the fixed [card acceptance](https://github.com/williacj/rigger/issues/1216).
[K290](https://github.com/williacj/rigger/issues/1216#issuecomment-6664167838) admits exactly the
historical named red, without a baseline waiver, and orders observation, a traced baseline,
then predeclared diagnostics. The observation is a separate commit. This work changes only the
fixture and its controls; no engine repair or candidate promotion is authorized or proposed.

## What the historical evidence establishes

The [original receipt](https://github.com/williacj/rigger/issues/1216#issuecomment-6664129053)
identifies fast job 127344822669, CI run 42056050732, PR head
589bc8eda4b8a2775bd8e86bde42b8edc9beaf6d and merge checkout
1c9ff6f076f4bcebd04f7b3779431d2fe1242642. The original log remains owner-only at
`/Users/cjwilliams/GitHub/rigger-worktrees/coordinator-evidence/1214-ci-flake/fast-127344822669.log`.
The pre-repair `wc -c` and `shasum -a 256` measurements are 1018717 bytes and
`e5f3da1ed282b867ef9e43e3582ec5e370ca933a9fc9ca0b888564a25c171294`.

That log shows sibling #20 exited 1 and the stronger fixture premise failed. It contains neither
the worker exception nor its read bytes. Its assertion cannot distinguish a missing release
from a release before close. The precise historical exception and interleaving remain unknown.
Historical passing runs are context; they prove no cause.

## Evidence before repair

The clean starting base was `6fdf52604066b6150f9a0d2eedf195bc20f36e29`. The diagnostic source was
`c4c2792afdf5e2585f8412ddec9bae174cc30e80`, with clean status throughout the predeclared baseline
and twenty serial target invocations. The [manifest](https://github.com/williacj/rigger/issues/1216#issuecomment-6664481360)
names the exact commands, selected title, host, executable and custody. The full baseline
reported tests=4818, pass=4818, fail=0. All twenty targets reported tests=1, pass=1, fail=0.
These measurements are from Node 26.13.0 on the owner's 12-CPU Darwin arm64 laptop.

Owner-only originals live at `/Users/cjwilliams/GitHub/rigger-worktrees/coordinator-evidence/1216/`,
outside disposable suite roots, through the final independent ruling. Each phase retains raw
stdout/stderr, an unfiltered combined log, actual PID/exit, before/after source status and load,
source bytes/diff and traces. `diagnostic-trace-index.json` indexes the baseline plus the twenty
targets: 23 worlds, 46 sibling waiters and 326715 observed reads, as measured by `audit-traces.py`.
The audit checks event append identity, per-PID continuity, changed read bytes, identical-read
counts/ordinals, actual worker results and run/card/dispatch/PID joins. Both release orders occur.
No native partial-read exception or post-close claim was observed. Those passes satisfy only
K290's no-reproduction evidence route.

The following trace index reports each target's measured before/after one-minute load, actual
suite exit, sibling release order and retained world directory. Every path is beneath
`<evidence-root>/<phase>/traces/<world>/`; `trace-index.json` owns the per-file sizes and hashes.

| Phase | Load before / after | Exit | Release order | World |
| --- | --- | --- | --- | --- |
| `target-01` | 4.554 / 4.509 | 0 | 30/20 | `9ba1bdfa-f4f1-40ae-b705-72e80e8aaa8c` |
| `target-02` | 4.509 / 4.812 | 0 | 20/30 | `c8fc819f-8a81-4c93-8d2d-971636c9a814` |
| `target-03` | 4.812 / 4.986 | 0 | 20/30 | `0041d9c9-def8-4116-9575-cf1300620708` |
| `target-04` | 4.986 / 5.147 | 0 | 20/30 | `725e95e1-df6b-4d7d-81a6-3d23cf464467` |
| `target-05` | 4.975 / 4.657 | 0 | 30/20 | `52aedc03-76a3-491e-8aca-c524e5725181` |
| `target-06` | 4.657 / 4.764 | 0 | 30/20 | `f4e5111c-b7d2-4f7f-90fa-b1d65680e465` |
| `target-07` | 4.764 / 6.689 | 0 | 20/30 | `d1b804ec-6417-49cc-9b8c-a2dc1a897dce` |
| `target-08` | 6.689 / 6.874 | 0 | 20/30 | `82ee00a3-9a1e-4130-8e9a-5b67689af8a4` |
| `target-09` | 6.874 / 7.790 | 0 | 30/20 | `df0bffb0-d2b5-45f2-a743-878e23bca2d3` |
| `target-10` | 7.790 / 7.575 | 0 | 20/30 | `48e80f70-b99a-49f2-ab9d-1e50f519a735` |
| `target-11` | 7.575 / 8.970 | 0 | 20/30 | `b6493cb4-792a-4acd-b6fe-7d6526d3555d` |
| `target-12` | 8.970 / 9.893 | 0 | 30/20 | `a1c17c8b-0e61-407f-ab66-8d1bc518dc51` |
| `target-13` | 9.893 / 9.501 | 0 | 20/30 | `5afb4437-df83-456a-9c0f-58c2a0532895` |
| `target-14` | 9.501 / 8.200 | 0 | 30/20 | `7ce45ff5-b1c4-4dd6-8004-5b1bec54d518` |
| `target-15` | 8.200 / 7.943 | 0 | 20/30 | `2cd17eab-586d-4ec1-a99b-4fbe69e4e11b` |
| `target-16` | 7.943 / 7.744 | 0 | 30/20 | `5e0475c9-556c-4311-9fe3-af18fecbb49b` |
| `target-17` | 7.744 / 7.444 | 0 | 30/20 | `6f71f423-7911-4e5b-bfa5-f4a714cdf7cb` |
| `target-18` | 7.444 / 6.920 | 0 | 30/20 | `bc72dbee-1eac-4ff3-902f-fdecd8b462fa` |
| `target-19` | 6.920 / 6.606 | 0 | 30/20 | `d456ed0b-aee1-43af-8174-a64d9fff3ebd` |
| `target-20` | 6.606 / 6.558 | 0 | 20/30 | `6a8fc312-4e24-42b5-950f-5f736393ad2f` |

## Causal discrimination and its limits

The original observer stripped trailing whitespace, split the live read, and parsed every
fragment. A read ending inside the growing final JSON record therefore throws before a later
read can establish the close. The [corrected pre-repair report](https://github.com/williacj/rigger/issues/1216#issuecomment-6664949266)
classifies this as a fixture-premise defect, rather than an established engine-ordering defect.

The `native-append-red` control runs the actual generated waiter over real file reads. The writer
only appends: it completes the same observed dispatch.start prefix, then appends a close. An
independent prefix assertion and reopened byte comparison verify that all four 320-byte initial
observations remain prefixes of the corresponding 886-byte final streams. These byte counts
are measurements of that Node26 attempt, not a general input limit.

All four sibling/order cells reach the named exit assertion with actual status 1, expected 0,
signal null and `SyntaxError: Unterminated string in JSON at position 111 (line 1 column 112)`.
Each trace orders waiter start, saved read, parse error, read outcome, exception and exit 1,
without a close observation. The first divergence is parsing the unfinished last record. Prior
effects are the actual prefix read and the scripted append's successful completion. The worker
fails before reading the now-complete close. No engine runs in this control, so an engine ordering
defect is unnecessary for this demonstrated failure path.

The control is a forced boundary, not measured native timing and not a reconstruction of the
missing CI trace. The code-grounded cause under that admitted boundary is demonstrated; precise
historical attribution remains limited by the unavailable original worker trace. The native
passes do not exonerate every possible engine defect. The engine's unconditional release after
failed work and its closed-admission claim guard explain why this fixture failure need not breach
`R-SCHED-3`; no production change is justified by this evidence.

The first controller rewrote a prefix instead of appending its completion. Its `native-boundary-red`
and `native-boundary-green` attempts remain retained as noncredit for the append mechanism.
The [correction](https://github.com/williacj/rigger/issues/1216#issuecomment-6664935524) withdrew that
inference, restored original waiter behavior, and predeclared the strictly growing replacement
control before using it. A later passing result does not rehabilitate the discarded witness.

## Fixture repair and preserved proof

The waiter parses only newline-terminated records and validates every complete record before
successful completion. Its existing immediate poll can observe an unfinished tail's completion.
The raw tail remains evidence. A read failure or malformed complete record still throws with
its original exception and actual nonzero exit. No catch fabricates success, no positive-delay
timer or timeout allowance is added, and no sink/parser or scheduling policy changes.

All three original worlds independently require both actual successful worker exits and the
observed close matching the recorded run. They join through the L3 engineer dispatch identity,
then L1 start/end and waiter PID. The existing titles, card sets, N=3, four-trigger count,
no-post-close-pull predicate, sibling-release predicates and #40-Ready assertion are unchanged.

The pure controls execute the fixture's actual generated script in a VM against independently
specified bytes. They start no process or positive timer. `R-SCHED-3` specifies engine admission
and `R-FAIL-8` the hold; neither specifies this private fixture observer, so these are admitted
harness diagnostics with no product declaration or matrix claim. New native cases name those
controlled counterparts and retain real file-read and actual process-exit proof in the existing
conversion-list file.

| Finite case | Controlled observation and retained boundary |
| --- | --- |
| Complete records without close | Barrier remains held; repeated reads preserve first/last ordinals and counts. |
| Incomplete final append | Four native sibling/order cells fail before framing and succeed after a second close observation. |
| Complete close | Both VM siblings observe the actual run/close before completing in either order; native worlds retain original release/refill proof. |
| Read failure | VM preserves original EIO and prior bytes; native directory reads preserve EISDIR, exception and actual exit 1. |
| Complete malformed record | VM/native cases retain bad bytes, SyntaxError and failed premise; complete damage after a close cannot be hidden. |
| Premature sibling failure | Successful-premise guard is independent of the original product oracle; guarded source controls belong in the handoff receipts. |
| Valid waiters and freed-slot poll | Original three worlds retain four triggers and no fourth card; guarded closed-admission deletion belongs in the handoff receipts. |

## Development evidence ledger

Every row names its complete output below the evidence root. Intentional reds remain in the
record; none was committed as a red head. `before.json`, `after.json`, `status.json` and `sources/`
own each attempt's exact command, source, load, actual child result and original bytes.

| Phase | Result and disposition |
| --- | --- |
| `observer-red` / `observer-green` | Named missing-observation assertion red, then green; observational TDD. |
| `instrumentation-commit` | Normal full-suite hook green; pre-commit observations, not streak credit. |
| `baseline` and `target-01` through `target-20` | Clean unchanged diagnostic source; all green, no replacements. |
| `native-boundary-red` / `native-boundary-green` | Rewrite-based controller; retained noncredit for append mechanism. |
| `observer-controls` | Pre-repair no-close/read-error/malformed/both-order controls green. |
| `complete-damage-red` / `complete-damage-green` | Named malformed-after-close assertion red, then complete-record validation green. |
| `affected-green` | Three introduced premise-guard failures: absolute command-path assumption; actual native exits were 0. Fixed through observed dispatch ID. |
| `premise-guard-green` | The three covered worlds pass after that guard repair. |
| `native-append-red` / `native-append-green` | Corrected append-only four-cell witness red, then green; original bytes and actual exits retained. |
| `affected-repaired` | Both complete affected files pass: tests=53, pass=53, fail=0. All 179 emitted original files reconstruct byte-exact with matching SHA-256 after fixture teardown. |
| `repair-commit` | Full hook refused the introduced native-control spawn's implicit environment: tests=4833, pass=4832, fail=1. No commit was created or hook bypassed. |
| `explicit-environment-green` | The exact git-environment census assertion passes after naming the same inherited environment explicitly. |

The fault search is retained in `causal-search.txt`: the live wait-for-close observer is the scoped
fixture. The two loop-test matches read report snapshots after explicit test conditions; other
matches are argv assertions. No outside-path repair is absorbed. The existing-line diff is
bounded to G1's original lines 72, 75, 84 and 89; imports, helper and controls are additive under G2.
All original product assertions remain intact. Packed-path comparison against candidate C
(`f3769f2482ef8cbffb573ee427fd112e68d2515f`) remains required in final verification; no repack or
candidate change follows from a fixture-only diff.
