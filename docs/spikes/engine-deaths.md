ABOUTME: Spike findings for card #1462: how often the engine and hosts running Rigger's work died, counted from the
Emend engine's event records and this repository's public records, for the owner's go or no-go on E3.

# How often the engine and its hosts died

## The answer

**The records do not support a rate.** They hold one engine death. A rate needs several.

| What the Emend event records hold | Count |
|---|---|
| Engine deaths with a dispatch in flight | 1, a D1 |
| Dispatches that death interrupted | 3, all makers |
| D2, an end through the engine's exit cleanup | 0 |
| Host losses told apart from engine deaths | none can be: see "What the records cannot show" |
| Dispatch time the death cost, the three added | 0.7 to 42.0 s |
| Redo dispatches that followed, the three added | 580.4 s |
| Engine hours | 9.6267, over 32 runs that pulled a card |
| Work claims | 78, of which 60 dispatched and 3 were interrupted |
| Dispatches | 317, of which 37 were makers |
| Dispatch hours | 15.4452, plus 0.0002 to 0.0117 for the three with no end |

Counts are from run 017. The two sums are from run 029.

- **The stream records no cause for that death.** It may have been deliberate.
- **The public records hold two engine deaths with a dispatch in flight, and both were deliberate.** One of them, a planned
  kill, interrupted three dispatches during the Emend run. The stream's one death also interrupted three. This report does
  not match the two, because the card publishes no event's time or id ("Public records").
- **No public record found names an engine death that nobody intended.**
- **The recommendation is that this evidence leaves E3 open.** It neither supports going ahead nor rules it out. 9.6 engine
  hours are too few to show that deaths are rare ("What the owner can rule").

This report hands over evidence. It records no decision and changes no code, requirement or architecture.

## What ran

1. The card's one command, `docs/spikes/engine-deaths/source/count.mjs`, read every events.jsonl under the state
   directory of Rigger's Emend engine. It kept only the card's listed fields, and only events at or before
   2026-11-24T15:35:09Z.
2. rigger-ae posted that rigger-d1's terms were given
   ([1462#7139235069](https://github.com/williacj/rigger/issues/1462#issuecomment-7139235069)), before the first read (created 17:27:56Z, run 040).
3. The privacy checker read the command, checked every filtered line, and passed it
   ([1462#7139559927](https://github.com/williacj/rigger/issues/1462#issuecomment-7139559927), created 17:41:19Z, run 040).
4. At 17:41:51Z run 017 ran the same command with the archive and the digest that comment's reader passed. It wrote the
   extract only because the digests were equal. Its counts are `docs/spikes/engine-deaths/counts.txt`.
5. Run 018 ran the same command over the extract, and its counts equalled run 017's (run 032).
6. Runs 019 to 025 read the public records.

The command record is `docs/spikes/engine-deaths/command-record.txt`. It holds every command its recorder ran, as it ran.
"Run N" below names its entry there. The commands the recorder did not run are whole in
`docs/spikes/engine-deaths/session-commands.txt`. The last text of each script is under
`docs/spikes/engine-deaths/source/`, and each earlier text a run executed is under `docs/spikes/engine-deaths/source/versions/`
("Script versions").

The command was built test-first over invented streams. The final text passes 38 of 38 tests (run 014). Each of 32
deliberate edits of it fails at least one test by a failed assertion, and the text passes all 38 before and after them (run
035). `docs/spikes/engine-deaths/mutation-evidence.txt` gives each edit's changed lines, and each failing test by name, place
and assertion.

## Sources

| Id | Source, by kind | Read (UTC) | Window its records cover (UTC) |
|---|---|---|---|
| S1 | The event stream of Rigger's Emend engine, under M8-U126 ([1293#7138680301](https://github.com/williacj/rigger/issues/1293#issuecomment-7138680301)) | 2026-11-24T17:41:51Z (run 017), by the maker | 2026-11-12T21:48Z to 2026-11-24T15:34Z |
| S2 | This repository's journal entries at a0f5a970 | 2026-11-24T17:44:00Z to 17:48:09Z (runs 022, 024) | entries named 2026-09-22 to 2026-11-24 (run 030) |
| S3 | This repository's issue and pull request comments | 2026-11-24T17:42:16Z to 17:43:39Z (run 019) | 2026-08-14T23:58:46Z to 2026-11-24T17:41:19Z (run 019) |
| S4 | #1429's published evidence at a0f5a970, for the two times quoted under "The line proposed" | 2026-11-24T21:20:42Z (run 038) | 2026-11-20T00:47Z to 00:48Z |
| S5 | The maker's own session record, for the script texts and commands the recorder did not keep | 2026-11-24T21:20:41Z to 2026-11-24T21:20:55Z (runs 036, 037, 043) and 2026-11-24T21:34:24Z (runs 044, 045) | this spike's phases, 2026-11-24 |

S4 gives two times and no count. S5 gives no count and no figure. S3 was read again by comment at 2026-11-24T21:20:42Z to 2026-11-24T21:20:44Z (runs 039, 040, 042).

S1's window is shortened to the minute. The privacy checker read S1 before, at a time its own comment bounds.

**Lines of S1** (run 017): 13,307 read, 0 later than the selector, 0 unparsed, 13,307 kept. The extract has 13,307 lines,
which equals the kept total. One stream was read. No other file whose name opens `events` was found. No value fell outside
its field's shape.

**Builds of S1.** The stream names no build. Public records place these commits as the Emend pins in its window: `2a581bde`
([1293#6924408008](https://github.com/williacj/rigger/issues/1293#issuecomment-6924408008)), `c40377da`
([1293#6938462261](https://github.com/williacj/rigger/issues/1293#issuecomment-6938462261)), `ebe7949e`
([1293#7022061397](https://github.com/williacj/rigger/issues/1293#issuecomment-7022061397)) and `3e325ab8`
([1293#7104703998](https://github.com/williacj/rigger/issues/1293#issuecomment-7104703998)). At those four and at b23d656d,
the source lines that emit the events the conditions read are the same (run 027), with one difference. b23d656d has three
sites that record recorded.killed and the four builds have two. I found no public record of the build that ran before
the first pin.

### Sources considered and not read

| Source | Why not | What its absence leaves unmeasured |
|---|---|---|
| The Emend engine's dispatch output, groups.json and agent logs | M8-U126 grants event records alone | what an agent was doing when its engine died |
| The Emend board and repository | the card forbids them | whether a death left a card's work wrong on the forge |
| The event streams of Rigger's own supervised windows on this board | under M8's custody and not granted | the engine's deaths there, apart from what comments say |
| Host logs: power, sleep, boot and crash records | not granted, and private content | whether any death was a host's, and every sleep |
| The Mac mini, WSL2 and Windows | the card forbids them | any engine death there |
| Coordinators' session logs and launcher logs | not granted (`R-EVIDENCE-4`) | most deaths of sessions coordinators launch by hand |
| Pull request review comments and review bodies, and issue and pull request bodies, in S3 | not fetched: run 019 reads issue comments, which include pull request conversations | a death named only there |

## What each ending counts as

Conditions are over the filtered fields of S1. A claim, as "Redos after an interruption" defines it, is **released** where
its card's slot.release follows its `pull` in the same run before the card's next `pull`. The **closing stretch** of a run
is its last lines that hold only containment events, call.end and dispatch.end events. All counts are from run 017.

| Row | Counted as | Condition applied | Count |
|---|---|---|---|
| D1 | a worker death and a host loss, counted together | dispatch.start, no dispatch.end, the claim not released and the card not pulled again in that run | 3 dispatches, in 1 run |
| D2 | a worker death, counted with deliberate stops, so an upper bound | an end with `exit` or `unread`, the claim not released, and either in the closing stretch or carrying `unread` or `kept`; none in a run that holds a D1 | 0 |
| D3 | neither | an end with `exit` other than 0, no timeout, and not D2 | 1, an agent's, exit at most 128, its claim released |
| D4 | neither | dispatch.timeout and an end | 0 |
| D5 | neither | an end carrying `reason` | 0 |
| D6 | cannot see it | none: gaps in `ts` within a run are printed, and they prove nothing | 22 gaps of 10 minutes or more, all with a dispatch in flight; 0 of an hour or more; 0 steps backward |
| D7 | cannot see it, as a death: a network drop is not a death, and is not told from a forge or git fault | call.end by `system` and `outcome`, and `class: 'environment'` events | forge: 7,843 `ok`, 509 `failed`, 0 `timed-out`; git: 2,424 `ok`, 0 `failed`, 0 `timed-out`; `environment`: 0 |

Also counted: 313 dispatches completed with exit 0, 0 starts that fit no ending, 0 closing-stretch ends beside the D1, and 0
L3 dispatches with no dispatch.start. 3 + 1 + 313 is the 317 dispatches.

recorded.killed from a later run: 3 of the 3 D1 dispatches. It suggests the processes outlived the engine, so the host had
not rebooted. It is indicative only, because a later start also records one for any process it finds in the dispatch's
directories (`src/substrate/process.mjs`, `killRecordedGroup`).

### How each count's definition differs from `report`'s

| Count | From "was interrupted" ("Redos after an interruption") | From "Host faults" ("What `report` derives") |
|---|---|---|
| D1, D2 dispatches | "Was interrupted" counts claims, not dispatches, and reads no dispatch.start or dispatch.end. It also takes a refused slot.release. Here 3 D1 dispatches sit in the 3 interrupted claims, one each | "Host faults" counts L2's maker.failed, judge.withheld and environment-class attempt.failed events. A dead engine writes none of them, so the two share no event |
| Engine deaths | counts runs, where "was interrupted" counts claims: 1 run held 3 | as above |
| Work claims interrupted: 3 | matches | differs, as above |
| Redos: 3; first attempts: 57 | matches | not a fault count |
| Host faults: 0 | different: no claim or interruption is read | matches |
| D3, D4, D5 | different: an engine that outlived the dispatch releases its slot, so none of these is an interruption | different: the event read is L1's, and not the L2 event "Host faults" counts |
| D6, D7 | different: no claim is read | different: call.end is L0's substrate fault rate, and `class: 'environment'` is one part of "Host faults" |
| Public records' counts | different: they count events that people wrote down, whatever the stream holds | different, for the same reason |

## The denominators

From run 017, over S1:

- **Work claims**, as "Redos after an interruption" defines them: 78. Of these 60 dispatched.
- **Dispatches started:** 317: 37 makers, 87 judges or other roles, 193 provisioning steps.
- **Card attempts**, read here as maker dispatches: 37.
- **Dispatch hours:** 15.4452, from `ms` of every dispatch with an end, none missing. A missing end is bounded below by the
  run's last event and above by the next run's first run.start or `trigger`: 0.0002 to 0.0117 hours for the three.
- **Engine hours:** 9.6267, the spans from first event to last of the 32 runs that pulled a card. No two of those spans
  overlap. 148 runs are in the stream, and most are verbs that pull nothing. 28 have a run.start, all at concurrency 3. The
  death's run has one, so it was `run` and not `once`.

A death's denominator here is engine hours. It is the denominator the proposal below uses.

## The counted events

One engine death ended all three dispatches. The stream records no cause for any of them, and no event's time is
published, so a row matches no public record.

| Row | Ending | Kind | Cause | Elapsed dispatch time lost | Redo |
|---|---|---|---|---|---|
| 1 | D1 | maker | the source records none | 0.486 to 14.260 s | pulled 19.005 s after the run's last event; its maker ran 61.701 s |
| 2 | D1 | maker | the source records none | 0.241 to 14.015 s | pulled 19.006 s after; its maker ran 426.022 s |
| 3 | D1 | maker | the source records none | 0 to 13.774 s | pulled 19.006 s after; its maker ran 92.670 s |

Figures are run 017's. Each lower figure runs to the dead run's last event, so it is a floor on the time lost. Each upper
figure runs to the next run's start. The redo's own time is what the work took again, and not all of it is loss.

## Public records

Two searches read S2 and S3 for sentences that could tell of a death (runs 022 to 025). I read each candidate line, and
opened the comments I counted. **Every count in this section is a judgment.** Its premise is that a line neither search
matched tells of no death. The searches skip sentences that name a test, a rule or a possibility, so they can miss a
death. I reached the first record below by following a link from a candidate.

| Category | Count | Where | Cause recorded | What it cost |
|---|---|---|---|---|
| The engine ended with a dispatch in flight, on purpose | 2 | [1255#6772570010](https://github.com/williacj/rigger/issues/1255#issuecomment-6772570010), an owner's planned job stop that cut short 1 maker; [1416#6988498235](https://github.com/williacj/rigger/issues/1416#issuecomment-6988498235), a planned kill with 3 engineers live | a deliberate stop, each | the first: one maker's work, with no redo shown; the second: 3 redos, as its outcome reports |
| The engine ended with a dispatch in flight, unplanned | 0 | none found | | |
| A host slept | 3 | [740#6253482345](https://github.com/williacj/rigger/issues/740#issuecomment-6253482345) once; [1417#7031053495](https://github.com/williacj/rigger/issues/1417#issuecomment-7031053495) twice | host sleep, each | the first: a stalled suite run; the other two: a launchd interval each |
| A host rebooted, on purpose | 2 | [642#6113790223](https://github.com/williacj/rigger/issues/642#issuecomment-6113790223); [744#6302218636](https://github.com/williacj/rigger/issues/744#issuecomment-6302218636) | an owner's ruling; a planned step | neither record shows lost dispatch time |
| A host rebooted, cause not stated | 1 | [1331#6797885425](https://github.com/williacj/rigger/issues/1331#issuecomment-6797885425) | none | an incomplete suite run ended before it |
| A session a coordinator launched by hand ended early | 7 | [1032#6442880637](https://github.com/williacj/rigger/issues/1032#issuecomment-6442880637), 1; [467#6073475444](https://github.com/williacj/rigger/issues/467#issuecomment-6073475444), 1; [740#6294566349](https://github.com/williacj/rigger/issues/740#issuecomment-6294566349), 2; [577#5974508763](https://github.com/williacj/rigger/issues/577#issuecomment-5974508763), 1; [578#5974508889](https://github.com/williacj/rigger/issues/578#issuecomment-5974508889), 1; `docs/journal/2026-10-03-2350-489-codex-adapter.md`, 1 | not stated; its launcher exited; model at capacity; the owner's usage limit, three times | an interrupted suite; a resumed judge; two re-dispatches; unfinished work resumed later |

No Rigger process ran any row of the last category, so none is a worker death or a host loss. Rows of the sleep and reboot
categories are host events, and neither says a dispatch Rigger ran was in flight, so none is counted as a host loss. The
first row is worker deaths, deliberate. Deaths made by tests and spikes are outside the card and are not counted.

**One thing the owner may be able to settle.** The planned kill of the Emend engine was on purpose, and it interrupted three
dispatches. The stream holds one death, which interrupted three dispatches and had three redos. The equal numbers are
not a match, and the card publishes nothing that would make one. If the two are one event, the stream holds **no** death
that nobody intended.

## Is there a rate?

**No.** The test was: the exact 95% Poisson interval for the count of engine deaths spans no more than a factor of ten.
Fewer than four deaths cannot meet it (run 029: four gives a ratio of 9.4, three gives 14.2). Choosing ten is judgment. Its
premise is that a wider interval cannot say which side of a threshold the rate is on.

- The stream holds one death. Its interval is 0.025 to 5.572 deaths over the same exposure, a ratio of 220.1 (run 029).
- The cause of that death is not recorded, so it cannot be told from a deliberate stop.

More records would support a rate where they hold at least four deaths, each with a cause, or enough engine hours with
none to bound it. At the proposed line below, a window of at least 59.9 engine hours with no unintended death would put
the line outside the one-sided 95% bound (run 029).

What further records would help: the cause of each engine end, written by the engine; the host's boot identity in
run.start, which would tell a host loss from an engine's death; and the host's own sleep and boot records.

## The line proposed for the owner to rule against

**Judgment:** automatic resume is worth running a new always-on service at or above **5 unintended engine deaths with a
dispatch in flight per 100 engine hours.**

The premises, each a judgment apart from the measured figure it names:

- **Resume saves the wait, not the work.** #1429 found that Temporal recovers the attempt, not the agent
  (`docs/journal/2026-11-20-0121-1429-temporal-dispatch-under-failure.md`). The redo happens either way, so a death's cost
  that resume removes is the time until something starts the engine again.
- **That wait is at most about an hour now,** by the interval alone. The Emend job restarts `run` 3600 s after a run exits
  ([1416#6981560600](https://github.com/williacj/rigger/issues/1416#issuecomment-6981560600), as run 039 read it). Temporal
  started the next attempt 4.85 to 6.18 s after the kill. Run 038 recomputed both from #1429's published transcript and event
  histories (`docs/spikes/temporal-dispatch-under-failure.md`, "The worker killed outright, mid-dispatch"; macOS gave 5.53 s).
- **At 5 per 100 hours, resume would return about 5% of engine time**, at an hour a death. Below that, an always-on service
  that must itself be installed, watched and upgraded likely costs more attention than it returns.
- **A shorter interval is the cheaper rival.** If `StartInterval` were 60 s, most of the saving would be had without a
  service, and the line would rise.

No measured rate exists to compare with it, so this report makes no comparison.

## Recommendation

**The evidence leaves E3 open.** I recommend the owner neither goes ahead on it nor drops E3 for it.

- **It does not support going ahead.** Its one death has no recorded cause, and the public records found no unintended
  death. The dispatch time lost was at most 42 s.
- **It does not rule E3 out.** It covers 9.6 engine hours on one laptop, over runs a coordinator supervised. With no
  unintended death in that time, the 95% bound is still up to 31.1 per 100 engine hours, 6.2 times the line (run 041, from
  runs 029 and 017). A fault of the kind an unattended engine meets overnight may never have had a chance to
  happen.
- **Its host-loss question is unanswered.** The stream cannot tell one, and public records name sleeps and reboots, none
  shown to have had a dispatch in flight.

### What the owner can rule

- **Go:** accepts that the case for automatic resume rests on judgment, as no measured rate backs it.
- **No-go:** accepts that 9.6 supervised hours stand for the unattended operation to come.
- **Wait:** counts again after enough more engine hours, with the same command and a record of each end's cause. That
  costs a window, and the engine needs one small event to make it decisive.

### What would reverse this

- **Toward go** (the numbers here and below are judgment, from the test in "Is there a rate?"): four or more unintended engine deaths in a window whose rate is at or above the line; or one host loss
  that stranded dispatches for longer than the launchd interval.
- **Toward no-go:** 60 engine hours or more, unattended, with none.
- **Against this report's reading of the stream:** a build that wrote the events otherwise; a second stream the granted
  place did not hold; or a proof that the D1's death was, or was not, the planned kill.

### What it would change

Going ahead or not changes no recorded decision here. Two **proposals**, for the PM, the architect and the owner, follow
from what could not be counted. Neither is made in this pull request:

- `ARCHITECTURE.md`, "Telemetry" and "What `report` derives": an event, or a field on run.start, that names the host's
  boot and a run's deliberate stop, so `report` can tell a host loss and a planned stop from a fault.
- `R-RECORD-2`: whether "how often a host fault interrupted it" takes in an engine death, which "Host faults" does not.

Every other proposal in #1453 stands as it was.

## What the records cannot show

- **D1's recorded.killed is indicative only**, as above, so "the host had not rebooted" is not shown.
- **D1's dead engine is not told from a host loss.** Both leave the same start with no end.
- **D2 is an upper bound.** A deliberate stop and a fault look the same, and so does a normal end that is the run's last
  event. A handled signal the owner sends to stop a run would be D2. No D2 exists here, so this did not matter.
- **A death with no dispatch in flight leaves nothing.** A claim interrupted with none in flight would show only as an
  interrupted claim, and here every interrupted claim held a D1 dispatch.
- **A sleep leaves nothing of its own.** 22 gaps of ten minutes or more all had a dispatch in flight, which an agent at
  work also makes.
- **Forge `failed` calls are not read as drops.** 509 of 8,352 forge calls failed (run 017), and the stream holds no
  `environment` event. A non-zero exit can be an answer its caller expects, and the listed fields name no reason, so how
  many were faults is unknown.
- **More than one stream.** None was found. Had there been, the extract would hold them as one sequence, because the listed
  fields hold no stream id, and D1's upper bound would have compared across them.
- **A start that fits no ending.** A run with an `unread` end in a released claim would count here as "no ending fits", and
  a start with no end in a released claim would too. The count is 0.
- **The builds before the first pin** are unknown.

## Private items

| Id | Acceptance items it supports |
|---|---|
| p1 | 5, 6, 18 |
| p2 | 17 |
| p3 | 17 |
| p4 | 19 |
| p5 | 19 |
| p6 | 22 |
| p7 | 22 |
| p8 | 22 |
| p9 | 22 |
| p10 | 22 |
| p11 | 22 |
| p12 | 22 |
| p13 | 22 |
| p14 | 22 |
| p15 | 22 |
| p16 | 22 |
| p17 | 22 |
| p18 | 22 |
| p19 | 22 |
| p20 | 22 |
| p21 | 22 |
| p22 | 22 |
| p23 | 22 |
| p24 | 22 |
| p25 | 22 |
| p26 | 22 |
| p27 | 22 |
| p28 | 22 |
| p29 | 22 |
| p30 | 22 |
| p31 | 22 |
| p32 | 22 |
| p33 | 22 |
| p34 | 22 |
| p35 | 22 |
| p36 | 22 |
| p37 | 22 |
| p38 | 22 |
| p39 | 22 |
| p40 | 22 |
| p41 | 22 |
| p42 | 22 |
| p43 | 22 |
| p44 | 22 |
| p45 | 22 |
| p46 | 22 |
| p47 | 22 |
| p48 | 22 |
| p49 | 22 |
| p50 | 22 |
| p51 | 22 |
| p52 | 22 |
| p53 | 22 |
| p54 | 22 |
| p55 | 22 |
| p56 | 22 |
| p57 | 22 |
| p58 | 22 |
| p59 | 22 |
| p60 | 22 |
| p61 | 22 |
| p62 | 22 |
| p63 | 22 |
| p64 | 22 |
| p65 | 22 |
| p66 | 22 |
| p67 | 22 |

The extract the Emend counts ran over is p1.

### Failed, abandoned and repeated runs

| Run | Why | Its full output |
|---|---|---|
| 001 | intended: the tests ran before the command existed | p6 |
| 002 | three faults in the tests | p7 |
| 003 | a fault in the command: a reader that closed the pipe early | p8 |
| 004 | the tests, repeated after the fix to 003's fault | p9 |
| 005 | a mutation run; three mutants survived, so tests were added | p10 |
| 006 | the tests, repeated with those additions | p11 |
| 007 | the mutation run, repeated; one mutant survived | p12 |
| 008 | the tests, repeated with one more | p13 |
| 009 | the mutation run, repeated; all killed | p14 |
| 010 | intended: the revised tests, before the command was revised | p15 |
| 011 | the command, revised for the PM's points: one fault, in a digest | p16 |
| 012 | the tests, repeated after that fix | p17 |
| 013 | the mutation run; one mutant survived, so a test was strengthened | p18 |
| 014 | the tests, repeated at the final text | p19 |
| 015 | the mutation run, repeated at the final text | p20 |
| 018 | run 017's counts repeated over the extract, to show them equal | p21 |
| 020 | the journal search listed no place, because its path was relative | p22 |
| 021 | the comment search, repeated as run 023 with a narrower filter | p23 |
| 022 | the journal search, repeated with its path fixed | p24 |
| 023 | the comment search, repeated | p25 |
| an unrecorded one | a slow `jq` search of the comments, stopped for speed and replaced by runs 024 and 025 | p26 |
| an unrecorded one | this report's first commit, refused: the suite discovers test files anywhere in the tree, so it ran the published test file and the spike's own copy, and the reference check read event names in code marks as paths | p27 |
| an unrecorded one | this report's amended commit, refused by one test, L7 in `test/loop.test.mjs`, whose wait of 5 s ran out (p28); M8-U109 ([1293#7112776030](https://github.com/williacj/rigger/issues/1293#issuecomment-7112776030)) names that test as flaky under load (run 042), and the change is docs only | p28 |
| 034 | a fault in the new mutation script: it could not remove a directory a test had shut | p29 |
| 034's one child, the tests over the unedited text | repeated by 035's | p30 |
| 035 | the mutation run, repeated after that fix, with every child's output kept | p31 |
| 035's children | the unedited text (p32); edits 1 to 32, each failing as meant (p33 to p64, in the order of `docs/spikes/engine-deaths/mutation-evidence.txt`); the text restored (p65) | p32 to p65 |
| 036 | the recovery of the script texts, which wrongly went on to number later runs | p66 |
| 044 | that recovery, repeated and stopped at run 032 | p67 |
| 037 and 043 | prints of the unrecorded commands; 037 left an id and a scratch path unmasked, and 043 the archive's path | not kept: see below |
| 045 | that print, repeated with them masked | published whole as `docs/spikes/engine-deaths/session-commands.txt` |

Runs 016, 017, 019, 024, 025, 027 to 030, 032, 038 to 042 and 046 ran once and did not fail. Runs 026, 031 and 033 do not
exist, because the recorder counts the files in its output directory, and some had been added there by hand.

Runs 037 and 043 printed text copied from the maker's session record, which rule 7 bars as private material. Their outputs were removed from
the archive for that, on the coordinator's word. Run 045 repeated them, and its whole output is the published file.

### What cannot be recovered

**The maker deleted evidence that the card required it to keep. That is a defect of this spike.** The owner's standing rule
on unrecoverable gaps ([1453#7087640218](https://github.com/williacj/rigger/issues/1453#issuecomment-7087640218)) asks for each
to be listed exactly. They are these:

1. **The full output of every child test run of five mutation runs, 113 in all** (run 046 counts the printed lines): run 005, 16
   children; run 007, 16; run 009, 17; run 013, 32; run 015, 32. Each child ran the tests over one edit, named in that run's
   version of the mutation script: versions 1, 1, 2, 3 and 3. The script sent each child's output to a temporary file, and the
   maker deleted those files before any ruling. Each run's own printed lines, one a child, are p10, p12, p14, p18 and p20.
   Three children of run 005, one of run 007 and one of run 013 survived, and the others failed as they were meant to.
   **No claim rests on them.** Run 035 ran the 32 edits of version 3 again, with every output kept.
2. **The output of these unrecorded commands, which failed or found nothing, and whose output was not kept.** Nothing rests
   on them, and each time is the call's, in UTC, on 2026-11-24:
   - the process listing that ended the timing call, at 17:22:24, which found no process and exited 1;
   - a listing of a pattern that matched nothing, at 17:27:13, and two more while the second commit was made and after it;
   - the last part of the call at 17:48:54, which read a file that did not exist;
   - a `grep` at 17:50:20, which the shell refused for its pattern;
   - a look-up of a comment at 17:51:01, under a number that is none, whose output was discarded;
   - a run of the reference check with a wrong argument, at 17:52:21;
   - a look through the session record at 21:14:41, which ended in an error.

Every other run that failed, was abandoned or was repeated is in the table above.

### Script versions

Each earlier text came from the maker's session record. Run 044 applied the file-writing parts of the maker's own tool
calls, as that record holds them, in an empty directory. It typed nothing from memory. `docs/spikes/engine-deaths/versions.txt` gives the
text each of runs 001 to 032 had beside it, by version and sha256. Three checks bear on it:

- The last text it recovers of each script is, byte for byte, the one first published.
- The maker had printed the sha256 of eight texts while it worked, and the recovered ones match. A judge can check one of
  them without the maker: the command's, which the privacy checker passed.
- The texts between two such are fixed by the recorded edits that join them.

Run 036 ran the recovery script as `docs/spikes/engine-deaths/source/versions/recover.py.v1.txt`, and run 044 as the text under
`docs/spikes/engine-deaths/source/`. Run 034 ran the mutation script as `docs/spikes/engine-deaths/source/versions/mutation.mjs.v1.txt`, and run 035 as the text under
`docs/spikes/engine-deaths/source/`. Runs 037 and 043 ran the command-printing script as `docs/spikes/engine-deaths/source/versions/session.py.v1.txt` and
`docs/spikes/engine-deaths/source/versions/session.py.v2.txt`, and run 045 as the text under `docs/spikes/engine-deaths/source/`. In all three, a
placeholder stands for one device's name, which the script masks. Runs 038 to 042 and 046 ran the published texts or no script. The
recorder was `docs/spikes/engine-deaths/source/versions/rec.sh.v1.txt` to run 015,
`docs/spikes/engine-deaths/source/versions/rec.sh.v2.txt` from run 016 to run 043, and `docs/spikes/engine-deaths/source/rec.sh` from run 044.

Commands the recorder did not run, and no figure rests on them: a timing of the first version, Python look-ups in the public
records, the abandoned search, and the refused and made commits up to 247f9b50. They are whole in `docs/spikes/engine-deaths/session-commands.txt`, from the
session record. The script replaces six kinds of text where one stands: a digest, a session's id, its scratch path, the archive's path, an
archive file's name beside a private item's id, and one device's name. The editing of files, and the maker's reading of the
repository and the card, are not there.

## Disclosures

- The spike made no install or host-configuration change. `npm ci` filled the worktree's own `node_modules`, for the
  repository's checks alone.
- No process outlived the command that started it. The stopped `jq` search was the spike's own, and the tool that started
  it recorded it and ended it.
- The archive is `<archive>`, owner-only. The maker's own writes there were the directory, the extract, the runs' and the
  mutation children's outputs, a file of digests and an index of the private items.
- The spike wrote nothing in the source's place, and read it only through the command.
