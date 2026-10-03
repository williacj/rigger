ABOUTME: Journal for #525: seven census, chain-kill and restart tests that failed only at loads
above 24 ran past a read bound and gave up as designed. The owner accepted this under O48, and the
risk is carried to M6.

# #525 — seven failures above the load bar are read bounds running out

**The failures.** Seven tests failed only in #515's hunt suites, at base `4f017db`. Each line
below is given at `4f017db`, and then at this card's base `01c4ad0` where it differs:

- `test/directory-census.test.mjs:360`, `:370`, `:382` and `:393`: the four successor tests. In
  each, a process the census listed forks Q in the dispatch's directory, and Q is found alive.
- `test/directory-census.test.mjs:449`: the test of a directory removed and made again.
- `test/process-adapter.test.mjs:2013`, which is `:2055` at `01c4ad0`: the chain-depth
  read-count test.
- `test/restart-kill.test.mjs:260`: the restart's kill of a process that left its group.

**The cause is the same for all seven.** At extreme load, a census or a kill ran past its read
bound, gave up, and recorded that it had given up. That is the outcome the code specifies.

- **The five directory-census tests and the restart test** ran past one `READ_TIMEOUT` of
  5,000 ms. That deadline covers every read a census of a directory makes, the restart's census
  of a recorded directory included. The census then records `directory.unread`, naming the
  directory. It resumes any process it had stopped but not yet listed again, so that process
  survives.
  - In the successor tests, that process is Q. A successor test needs four `lsof` runs inside the
    deadline. The remake and restart tests need three.
  - In the restart test, the start's census gave up, so the process that left its group was
    still alive at the first board read.
- **The chain-depth test** ran past the kill's `readTimeout` of 10,000 ms per step. The kill
  makes about 200 `ps` reads in that step. It then records `group.killed` in place of each
  survivor's kill.

**The evidence for each test, from #515's hunt logs.** The logs are in the coordinator's
scratchpad, in `c515-hunt-logs/` and `c515-hunt3-logs/`.

Each hunt ran two lanes of whole `npm test` suites, one suite after another. When a suite ended,
the lane wrote one line to `c515-hunt-logs/runs-hunt2` or `c515-hunt3-logs/runs`. That line holds
the suite's exit status and the `vm.loadavg` at that moment. So a suite's starting one-minute load
is the one recorded when the same lane's previous suite ended. These are measured figures, read
from those two files on 2026-10-02.

| Test at `4f017db` | Failing suite log | One-minute load at that suite's start |
|---|---|---|
| `directory-census.test.mjs:360` | `c515-hunt-logs/lane2-run4.log` | 32.56 |
| `directory-census.test.mjs:370` | `c515-hunt-logs/lane1-run2.log`, `lane2-run2.log`, `lane2-run3.log`; `c515-hunt3-logs/lane2-run1.log` | 42.40, 42.40, 34.71; not recorded |
| `directory-census.test.mjs:382` | `c515-hunt-logs/lane1-run2.log`, `lane1-run4.log`, `lane2-run2.log`; `c515-hunt3-logs/lane1-run1.log` | 42.40, 33.22, 42.40; not recorded |
| `directory-census.test.mjs:393` | `c515-hunt-logs/lane1-run2.log`, `lane2-run2.log`, `lane2-run3.log`, `lane2-run4.log` | 42.40, 42.40, 34.71, 32.56 |
| `directory-census.test.mjs:449` | `c515-hunt-logs/lane2-run3.log` | 34.71 |
| `process-adapter.test.mjs:2013` | `c515-hunt-logs/lane1-run3.log`; `c515-hunt3-logs/lane1-run1.log`, `lane2-run1.log` | 35.81; not recorded, not recorded |
| `restart-kill.test.mjs:260` | `c515-hunt-logs/lane1-run3.log` | 35.81 |

**A suite that was first in its lane has no recorded start.** For those two suites, the load
recorded at their end was 28.09 in both lanes, from `c515-hunt3-logs/runs`. #515's maker reported
that every hunt suite started at a one-minute load between 28 and about 100. Both figures come
from that maker, not from my measurement.

**The two kinds of failure in the hunt logs.**
- The chain-depth failures print their cause verbatim: *"the kill could not read how every
  survivor ended: the process-table read timed out after 10000 ms"*, with `group.killed` where
  `survivor.killed` was expected.
- The census failures each took the census's 5 s, plus `gone`'s 10 s wait, before the assertion
  failed. The test durations of 15.4 to 19.7 s show it.

**The evidence that shows the cause directly: diagnostic runs at `01c4ad0`.** I ran a diagnostic
copy at `01c4ad0`, in the coordinator's scratchpad under `c525-diag/`. It logged each census
read's duration and outcome, and printed the test's `L0` events. I raised the load by running
copies of the test files alongside it. The loads are `vm.loadavg` one-minute figures, read with
`sysctl`.

- **A batch that started at 30.64 and stood at 72.62 fifty seconds in.** Its successor tests
  failed four times at their asserted lines.
  - In `logs/sc1-1.log` and `logs/reads1-1.txt`: the stand-in's first `lsof` took 1,814 ms. The
    next full `lsof` took 2,466 ms, and a `ps` took 28 ms. The relist `lsof -p` of Q was then
    killed at the deadline. The stream held `directory.unread`, with *"the process-table read
    timed out after 5000 ms"*. Q was alive in state `SN`, so it had been resumed.
  - One run in that batch failed the other way. Q had been killed unnamed, so the events
    assertion saw no `survivor.killed` for Q.
- **Two batches, one starting at 31.42 and standing at 67.08 sixty seconds in, the other starting
  at 47.21 and standing at 49.12 forty-five seconds in.** Ten more runs recorded the same `directory.unread`
  after Q had already been killed, so they passed.
- **A batch that stood at 61.29 fifty seconds in.** The tests passed, but they used most of their
  bounds:
  - the remake test's census made three `lsof` runs of 1,409, 949 and 1,684 ms, out of 5,000 ms;
  - the restart's census made runs of 1,618, 486 and 1,250 ms, out of 5,000 ms;
  - the chain-depth kill made about 407 reads totalling about 15 s, across steps bounded at
    10,000 ms each.

**Each was seen only above the load bar.** Each of the seven failed only in runs that started
above O46's bar of twice the host's logical CPU count. That bar is 24 on this host, which has 12
logical CPUs (`sysctl -n hw.logicalcpu`). None has failed in a counted run.

**The risk.** At extreme load, a process working in a dispatch's directory can survive a census.
The census records that as `directory.unread`, naming the directory. A successor forked after the
census listed its parent survives only in that case. Otherwise the census lists the directory
again: a listed process that has gone before the stop does not end the census. So the census
then stops and kills the successor. The owner carries this risk to M6, supervision, as a known
limit (O48).

**What changed.** No code changed. This entry is the card's only change, and the test-line grant
under O47 was not used.

**Other failures in the diagnostic runs.** Two other tests failed in my diagnostic runs, at
one-minute loads of 61 to 67 and with the read-logging diagnostic applied. Their runner output is
in `c525-diag/logs/hi*.log`.
- `test/process-adapter.test.mjs:1436` failed four times: *"no read of the kill was cut, so the
  test proves nothing"*.
- `:1464` failed once: *"no read of the group by the kill listed the zombie while the leader
  answered signal 0, so the test proves nothing"*.
