ABOUTME: Journal for #1065 (M7-11): `rigger report`'s L3 section shows the queue carried at each
pull, per run.

# #1065 — report shows the queue carried, per run

The card is at revision `fb04e60e9eab`, read on `main` at `f84bb85b`. "What `report` derives",
L3's section, is the contract: each `pull`'s `queueDepth`, a count at each pull, in line order,
per run.

## The output

Under each run's L3 block, after its throughput and utilization lines, or the line saying it has
none, one line per L3 `pull`, four spaces in: `queue carried at the pull of card #N: Q`. A run with
no L3 `pull` prints `the run recorded no pull, so L3 has no queue carried for it`. Nothing is
printed across the stream.

The derivation (`l3Signals`) answers each run's `queue`: the `card` and `queueDepth` of each L3
event named `pull`, in line order. It filters on layer and event name only, so a merge claim's
pull is listed and L3's `trigger` with `trigger: 'pull'` is not.

## Tests and the tier

The tests are in a new file, `test/report-queue.test.mjs`, kept apart from `test/report.test.mjs`
because #1066 and #1068 are adding to that file at the same time. A new file runs in the
deterministic tier, so it calls `src/cli/report.mjs`'s `report` in process.

The guard's default `ask` runs git in a process group of its own, and the tier refuses to signal
it. The first run failed every test with `deterministic tier: test/report-queue.test.mjs cannot
signal -22154 with 0`, from `src/substrate/process.mjs`'s `occupied`. That failure is not red, so
the tests pass an `ask` that runs git through `spawnSync`, as `test/doctor.test.mjs` injects one.

## The red run (U80)

All nine tests were written before any source changed, and were run at `f84bb85b` with the source
unchanged: `sh test/suite.sh test/report-queue.test.mjs`. It exited 1, with `tests 9`, `pass 0`,
`fail 9`. Each failed on its queue assertion, the queue lines being absent:

| Test | Failing assertion |
|---|---|
| lists each L3 pull … after its throughput and utilization lines | `+ []`, `- ['…card #7: 2', '…card #8: 1', '…card #9: 0']` |
| shows 0 for each pull … queueDepth 0 | `+ []`, `- ['…card #4: 0', '…card #5: 0']` |
| one line saying a run with no L3 pull recorded none | `+ []`, `- ['    the run recorded no pull, so L3 has no queue carried for it']` |
| pulls of a run whose span is zero … | the span-zero line alone, missing `…card #1: 1`, `…card #2: 0` |
| pulls of a run that recorded no N … | the no-N line alone, missing `…card #1: 1`, `…card #2: 0` |
| the pull of a merge claim like any pull | `+ []`, `- ['…card #7: 1', '…card #8: 0']` |
| each run's queue lines from its own pulls only … | `+ []`, `- ['…card #7: 2', '…card #8: 1', '…card #9: 0']` |
| does not read a pull recorded by a layer other than L3 | `+ []`, `- ['    the run recorded no pull, …']` |
| queue lines do not change for an event of another name … | `+ []`, `- ['…card #7: 2', '…card #8: 1', '…card #9: 0']` |

After the change the same command exited 0, `tests 9`, `pass 9`.

## One stream and what report prints for it

The stream the first test writes, run `r-a` under N 2, and the queue lines `rigger report`'s
`report` prints for it, each beside the `pull` it came from:

| Stream line | Queue line printed |
|---|---|
| `{"ts":"2026-01-01T00:00:00.000Z","run":"r-a","layer":"L3","event":"pull","card":7,"kind":"change","queueDepth":2,"inFlight":1}` | `    queue carried at the pull of card #7: 2` |
| `{"ts":"2026-01-01T00:00:00.000Z","run":"r-a","layer":"L3","event":"pull","card":8,"kind":"change","queueDepth":1,"inFlight":2}` | `    queue carried at the pull of card #8: 1` |
| `{"ts":"2026-01-01T00:30:00.000Z","run":"r-a","layer":"L3","event":"pull","card":9,"kind":"change","queueDepth":0,"inFlight":2}` | `    queue carried at the pull of card #9: 0` |

They follow `    L3 throughput: 3 slot releases per hour (3 slot releases over 1 h)` and
`    L3 utilization: 1 (2 h from pull to release, over N 2 x 1 h)`. Over the same stream, the merge
base's output differs from the head's only by those three added lines (`diff`, run 2026-10-27).

## Cases met beyond the table

A run that recorded no N: its queue lines follow "the run recorded no N, so L3 has no
utilization for it". The card's output text covers it ("or the line saying it has none"), and a
test holds it.
