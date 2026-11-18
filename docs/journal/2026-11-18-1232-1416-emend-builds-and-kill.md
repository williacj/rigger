ABOUTME: Records M8-B2 on Emend: three concurrent cold cargo builds, and a SIGKILL of the engine during three live engineers.

# M8-B2: concurrent cargo builds and an engine SIGKILL on Emend

The Emend session (`cowrite-7f`) ran [card #1416](https://github.com/williacj/rigger/issues/1416)
by hand on the owner's Mac on 2026-11-18, from A00 at 17:26:05Z to Z7 at 18:09:19Z, under
acceptance revision `6145f6899e58`. The run covers M8's items 1 and 2 (`docs/v0-build-plan.md`,
M8), using Emend #119, #120 and #121.

- **Plan.** [Pre-action comment](https://github.com/williacj/rigger/issues/1416#issuecomment-6981560600),
  re-cited to `6145f6899e58` by the [citation update](https://github.com/williacj/rigger/issues/1416#issuecomment-6983688947).
- **Rulings before A0.** [Linked on the card](https://github.com/williacj/rigger/issues/1416#issuecomment-6981960502):
  [M8-U49–U51](https://github.com/williacj/rigger/issues/1293#issuecomment-6981953095).
- **Outcome.** [Outcome comment](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307123),
  [appendix 1, the run log](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772),
  [appendix 2, `kill.out` and `claims.jsonl`](https://github.com/williacj/rigger/issues/1416#issuecomment-6987308401),
  [appendix 3, `item1.jsonl`](https://github.com/williacj/rigger/issues/1416#issuecomment-6987309026),
  and the [evidence addendum](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).
- **Rulings after the run.** [M8-U55](https://github.com/williacj/rigger/issues/1293#issuecomment-6984845435),
  [M8-U56–U57](https://github.com/williacj/rigger/issues/1293#issuecomment-6987800265) and
  [M8-K38](https://github.com/williacj/rigger/issues/1293#issuecomment-6987944281).

## The commit under test

The commit under test was `c40377dac3143f6ca3d51c99622ded2a8d61888f`, the same commit as #1415.
The installed package is at `/Users/cjwilliams/rigger-builds/emend-c40377da`, and the engine clone
was at `080eff372e1cb6417a2ada712a5eca9675ee561f` (A5).

A1 at 17:26:16Z and Z5 at 18:09:12Z each read the installed package's `src/package-commit.json` as:

```
{"commit":"c40377dac3143f6ca3d51c99622ded2a8d61888f"}
```

#1415 quotes the same text at its A1 and H1.
[A1 and Z5, appendix 1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772),
[#1415's results table](https://github.com/williacj/rigger/issues/1415#issuecomment-6981099473),
[addendum R1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).

The engine that K1 killed was this build's `rigger run`, pid 29355, per `kill.out`'s `ps` line in
[appendix 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987308401).

## Custody, workflows and the board

- **Sessions.** The pre-action comment named `cowrite-7f` as the only actor and `rigger-d1` as
  read-only on Emend, and listed the idle, Remote Control and cloud sessions. The owner's go,
  M8-U49, keeps custody as in #1415 (M8-U45). Other sessions stay off Emend, and GitHub Desktop,
  VS Code and the ChatGPT/Codex app stay quit. A0 and A0b each printed no match and `exit 1`, at
  17:26:08Z and 17:26:11Z.
  [Custody roster](https://github.com/williacj/rigger/issues/1416#issuecomment-6981560600),
  [M8-U49](https://github.com/williacj/rigger/issues/1293#issuecomment-6981953095).
- **The enrolment check, corrected.** The pre-action comment said enrolment was "re-checked by
  ListAgents before posting". No read backs that claim. The Emend session's last ListAgents call
  before the run was on 2026-11-17 at 04:35:02Z. The custody basis for the run is the owner's
  confirmation under M8-U49. The addendum quotes a ListAgents read taken at about 18:35Z, after
  the run. That read shows the state after the run, not at 17:26Z, and no longer lists
  `Rigger M7 Coordinator`. K38 records the correction.
  [Addendum R2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366),
  [M8-K38](https://github.com/williacj/rigger/issues/1293#issuecomment-6987944281).
- **Workflows page.** Board 13's Workflows page rests on the owner's statement "done, all
  workflows are off" (M8-U48), as #1415 left it.
  [M8-U48](https://github.com/williacj/rigger/issues/1293#issuecomment-6980863747).
- **A2, the API cross-check.** At 17:26:16Z, A2 ran
  `gh api graphql -f query='{ user(login: "williacj") { projectV2(number: 13) { workflows(first: 30) { nodes { number name enabled } } } } }'`,
  #1415's step A2 query, and printed:

  ```
  {"data":{"user":{"projectV2":{"workflows":{"nodes":[{"number":4,"name":"Auto-add sub-issues to project","enabled":false},{"number":3,"name":"Auto-close issue","enabled":false},{"number":6,"name":"Item added to project","enabled":false},{"number":1,"name":"Item closed","enabled":false},{"number":5,"name":"Pull request linked to issue","enabled":false},{"number":2,"name":"Pull request merged","enabled":false}]}}}}}
  ```

  The API lists 6 of the page's 11 workflows, each `"enabled":false`. The other 5 rest on the
  owner's statement (M8-U48). Appendix 1 cuts this line at 400 characters, so the whole line is
  quoted from the addendum's G1.
  [Addendum G1–G2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).
- **Ready.** P1 moved #119, #120 and #121 to Ready at 17:26:51Z, 17:26:56Z and 17:27:02Z, each
  with `exit 0`, under M8-U49's approval. P2 at 17:27:07Z printed exactly `119`, `120` and `121`.
- **Admission and the preview.** `rigger plan` is a preview and changes no card. P3 at 17:27:12Z
  showed admission closed by the owner's pause. P4's `rigger resume` removed that closer. P5's
  preview at 17:27:24Z said `the next run would pull 3 cards`, then `pull    #119  change`,
  `pull    #120  change` and `pull    #121  change`. The actual pulls came after S2's launch,
  as L3 `pull` events at 17:29:30.694Z, 17:29:30.697Z and 17:29:30.699Z (`claims.jsonl`).
  [P1–P5, appendix 1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772),
  [`claims.jsonl`, appendix 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987308401).

## Item 1: three concurrent cold `cargo build --workspace` dispatches

**No workspace existed before the run.** A6 at 17:26:32Z listed the worktree root whole:

```
total 0
drwxr-xr-x@  4 cjwilliams  staff  128 Nov 16 22:16 .
drwxr-xr-x@ 21 cjwilliams  staff  672 Nov 12 15:48 ..
drwxr-xr-x@  2 cjwilliams  staff   64 Nov 16 22:34 judges
drwxr-xr-x@  2 cjwilliams  staff   64 Nov 16 22:34 scratch
```

**No shared cache.** S4 at 17:29:41Z read the job's environment from `launchctl print`. It has
`GGML_CCACHE => OFF` and neither `CARGO_TARGET_DIR` nor `RUSTC_WRAPPER`:

```
	environment = {
		OSLogRateLimit => 64
		PATH => /Users/cjwilliams/.cargo/bin:/opt/homebrew/bin:/Users/cjwilliams/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin
		GGML_CCACHE => OFF
		XPC_SERVICE_NAME => com.williacj.rigger
	}
```

**The step.** A5 read Emend's `rigger.config.mjs` at `080eff37…`:

```
      provisioning: ['npm-ci', 'cargo-build'],
    'cargo-build': { run: 'cargo build --workspace', cwd: 'src-tauri', timeout: 2700000 },
```

**The stream.** These are the three cards' `cargo-build` dispatches in the first run,
`4d757b17-95c6-4cf7-b984-6715e7b11e7f`, from `item1.jsonl`. Each L3 `dispatch` names
`"step":"cargo-build"`. Each is matched by dispatch id to an L1 `dispatch.start` and a
`dispatch.end` with `"exit":0`:

```
{"ts":"2026-11-18T17:29:38.910Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":121,"dispatch":"d-286f18e1-20eb-4ae6-aab8-c88c61676152","step":"cargo-build","attempt":1}
{"ts":"2026-11-18T17:29:38.910Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.start","card":121,"dispatch":"d-286f18e1-20eb-4ae6-aab8-c88c61676152","command":"/bin/sh","timeout":2700000,"workspace":"/Users/cjwilliams/GitHub/emend-engine-worktrees/rigger-121"}
{"ts":"2026-11-18T17:29:39.910Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":119,"dispatch":"d-dbc679e6-f8e5-48a1-81fd-2a69915c5077","step":"cargo-build","attempt":1}
{"ts":"2026-11-18T17:29:39.910Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.start","card":119,"dispatch":"d-dbc679e6-f8e5-48a1-81fd-2a69915c5077","command":"/bin/sh","timeout":2700000,"workspace":"/Users/cjwilliams/GitHub/emend-engine-worktrees/rigger-119"}
{"ts":"2026-11-18T17:29:39.926Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":120,"dispatch":"d-6cf7ed67-e3ea-4345-a31f-8fb611680549","step":"cargo-build","attempt":1}
{"ts":"2026-11-18T17:29:39.926Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.start","card":120,"dispatch":"d-6cf7ed67-e3ea-4345-a31f-8fb611680549","command":"/bin/sh","timeout":2700000,"workspace":"/Users/cjwilliams/GitHub/emend-engine-worktrees/rigger-120"}
{"ts":"2026-11-18T17:31:47.302Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.end","card":119,"dispatch":"d-dbc679e6-f8e5-48a1-81fd-2a69915c5077","exit":0,"ms":127392}
{"ts":"2026-11-18T17:31:47.559Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.end","card":120,"dispatch":"d-6cf7ed67-e3ea-4345-a31f-8fb611680549","exit":0,"ms":127633}
{"ts":"2026-11-18T17:31:47.802Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L1","event":"dispatch.end","card":121,"dispatch":"d-286f18e1-20eb-4ae6-aab8-c88c61676152","exit":0,"ms":128892}
```

The outcome's table of those lines, quoted verbatim:

> | Card | Dispatch | Start | End | Exit | ms |
> |---|---|---|---|---|---|
> | 121 | d-286f18e1-20eb-4ae6-aab8-c88c61676152 | 17:29:38.910Z | 17:31:47.802Z | 0 | 128892 |
> | 119 | d-dbc679e6-f8e5-48a1-81fd-2a69915c5077 | 17:29:39.910Z | 17:31:47.302Z | 0 | 127392 |
> | 120 | d-6cf7ed67-e3ea-4345-a31f-8fb611680549 | 17:29:39.926Z | 17:31:47.559Z | 0 | 127633 |

All three ran together from 17:29:39.926Z to 17:31:47.302Z, about 127.4 s.

**Survivors.** `item1.jsonl` holds no `survivor.killed` or `group.killed` event. S6 read it at
18:03:21Z from S1's offset, after the three builds had ended at 17:31:47Z.
[`item1.jsonl`, appendix 3](https://github.com/williacj/rigger/issues/1416#issuecomment-6987309026),
[A5, A6, S4 and S6, appendix 1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772).

**Journal note on the later builds.** In the journal's own count from appendix 3, `item1.jsonl`
holds 12 more `cargo-build` dispatches under the restarted run, each with `"exit":0`. Three are
the redo builds, and they also overlap: 119 at 17:32:17.162–17:34:26.685Z, 120 at
17:32:17.212–17:34:26.875Z, and 121 at 17:32:17.215–17:34:26.767Z. Three are later attempt
builds, one for #119 and two for #121. Six are reviewer-role builds: two for #119, one for #120
and three for #121. The outcome mentions the redo builds and the later attempt builds but not
the reviewer-role builds.

## Item 2: SIGKILL with three engineers live

**K0, the trigger.** The S5 read at 17:31:53Z showed three L3 engineer dispatches in run
`4d757b17…`, each with an L1 `dispatch.start` and no `dispatch.end`. Their `dispatch.start`
lines are at 17:31:47.327Z, 17:31:47.572Z and 17:31:47.813Z.

```
{"ts":"2026-11-18T17:31:47.305Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":119,"dispatch":"d-e0f6846a-e963-4274-8a6f-182e62a1878b","role":"engineer","tier":"standard","attempt":1}
{"ts":"2026-11-18T17:31:47.559Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":120,"dispatch":"d-1777e016-8585-48ea-8948-3ca5d3e4d116","role":"engineer","tier":"standard","attempt":1}
{"ts":"2026-11-18T17:31:47.802Z","run":"4d757b17-95c6-4cf7-b984-6715e7b11e7f","layer":"L3","event":"dispatch","card":121,"dispatch":"d-4155e546-4697-4ca0-bbe2-9621f9f5691d","role":"engineer","tier":"standard","attempt":1}
```

**K1, the kill and the restart.** This excerpt is the outcome's, from `kill.out`. The whole file,
with `groups.at-kill.json` and the census listing, is in
[appendix 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987308401).

```
2026-11-18T17:32:00.030+00:00 launchctl print gui/501/com.williacj.rigger exit 0; its pid line, raw:
	pid = 29355
29355 29355 Wed Nov 18 11:29:24 2026     node /Users/cjwilliams/rigger-builds/emend-c40377da/node_modules/.bin/rigger run
2026-11-18T17:32:00.094+00:00 kill -KILL 29355 exit 0 (time read before the kill: epoch ms 1795023120057; after: 1795023120075)
2026-11-18T17:32:00.311+00:00 recorded process groups: 82096 82114 82126
2026-11-18T17:32:00.642+00:00 launchctl kickstart -k gui/501/com.williacj.rigger exit 0 (at most 605 ms after the kill)
2026-11-18T17:32:10.257+00:00 check at least 10204 ms after the kill
2026-11-18T17:32:10.299+00:00 survivors of the recorded groups (expected: none):
2026-11-18T17:32:10.324+00:00 survivors from the census (expected: none):
2026-11-18T17:32:10.360+00:00 done
```

- **Engine pid.** The script read pid 29355 from `launchctl print` and quoted its raw `pid =`
  line. `kill -KILL 29355` exited 0 at 17:32:00.094Z.
- **Groups before the restart.** `groups.json` at the kill held groups 82096 (#119), 82114 (#120)
  and 82126 (#121). Each was a `claude -p` engineer whose dispatch id matches K0's.
- **Census before the restart.** The census of every process whose working directory lay under
  the three workspaces or their scratch directories found the same three pids. `census.pids`
  reads `82096`, `82114` and `82126`.
- **Restart.** `launchctl kickstart -k` exited 0 at most 605 ms after the kill.
- **No survivor.** The check ran at least 10204 ms after the kill. No line follows either
  survivor heading.
- **The restarted engine.** R1 at 17:32:16Z read `state = running`, `runs = 2` and `pid = 82440`.
  The restarted engine's L0 `recorded.killed` events for pids 82096 (#119), 82114 (#120) and
  82126 (#121), in run `3826fd61-cb99-48c0-a578-20433850d1a5`, are at 17:32:01.076Z,
  17:32:01.334Z and 17:32:01.587Z. Addendum 2 quotes them uncut, from a read-only rerun at
  18:59:10Z disclosed under U56. The outcome reports no `recorded.unended`, `directory.skipped`
  or `record.partial-kept` event.
  [Addendum 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6988498235),
  [outcome, item 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307123).

**R3, the claim lines.** R3 wrote `claims.jsonl` at 17:32:30Z. It is quoted whole in
[appendix 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6987308401). The
outcome's table of it, quoted verbatim:

> | Card | Killed run `4d757b17…` | Later run `3826fd61…` |
> |---|---|---|
> | 119 | `pull` 17:29:30.694Z, then dispatches npm-ci, cargo-build and engineer (last at 17:31:47.305Z). No `slot.release` or `merge.start` | `pull` 17:32:06.818Z, then `dispatch` npm-ci 17:32:14.135Z and cargo-build 17:32:17.162Z. No `merge.start` |
> | 120 | `pull` 17:29:30.697Z, then npm-ci, cargo-build and engineer (17:31:47.559Z). None after | `pull` 17:32:06.819Z, then npm-ci 17:32:14.316Z and cargo-build 17:32:17.212Z |
> | 121 | `pull` 17:29:30.699Z, then npm-ci, cargo-build and engineer (17:31:47.802Z). None after | `pull` 17:32:06.819Z, then npm-ci 17:32:14.506Z and cargo-build 17:32:17.215Z |

**R3's pattern was defective.** This is the journal's correction of the table above. R3's
predeclared pattern ended `"card":(119|120|121),`. An L3 `slot.release` event ends with
`"card":N}`, so the pattern could never match one. The table's "No `slot.release`" for the
killed run was therefore vacuous. Under M8-U51, M8-K38 ruled it a defect in a predeclared
command. The evidence for the redo item is a read-only rerun over the finished stream, with the
card clause ending `[,}]`, disclosed under U56:

```
cd /Users/cjwilliams/GitHub/emend-engine && tail -c +547678 .rigger/events.jsonl | command grep -E '"layer":"L3","event":"(pull|dispatch|slot\.release|merge\.start)","card":(119|120|121)[,}]'
```

It printed 66 event lines at 18:35:08Z. Rerunning R3's pattern as posted printed 59, and they
are the 66 without the 7 `slot.release` lines. All 7 `slot.release` lines are under the later
run `3826fd61…`, and none is under the killed run `4d757b17…`:

```
{"ts":"2026-11-18T17:39:56.677Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":119}
{"ts":"2026-11-18T17:42:36.217Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":121}
{"ts":"2026-11-18T17:48:18.318Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":119}
{"ts":"2026-11-18T17:51:01.183Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":121}
{"ts":"2026-11-18T17:58:06.638Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":121}
{"ts":"2026-11-18T17:58:19.485Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":121}
{"ts":"2026-11-18T18:07:19.921Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"slot.release","card":120}
```

The only `merge.start` lines are under `3826fd61…`, for #119 and #120. #121 has none.

```
{"ts":"2026-11-18T18:07:28.009Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"merge.start","card":119,"pull":137,"head":"d3197bbc44bfba75eefb01a698f002d00e880480"}
{"ts":"2026-11-18T18:07:42.330Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L3","event":"merge.start","card":120,"pull":139,"head":"c9da7b5388e30fb3cf20aeb39dab2094672c8d96"}
```

So, in the killed run, each card's last claim is a `pull` then a `dispatch`, with no
`slot.release` or `merge.start` after it. Each card then has a claim under the later run: a
`pull` at 17:32:06Z, then a `dispatch`, before any `merge.start`. That is a redo after an
interruption as `ARCHITECTURE.md`, "Redos after an interruption", defines it (`R-STATE-3`). The
corrected rerun's 66 lines are quoted whole in the addendum's G5.
[Addendum G5](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366),
[M8-K38](https://github.com/williacj/rigger/issues/1293#issuecomment-6987944281).

**R4 and R4b, the redo counts.** `rigger report` counts the three redos apart from first-attempt
work. R4's `report.out` at 17:32:35Z exited 0:

```
    redos after an interruption: 3, first attempts: 14
    redo after an interruption: card #119, run 3826fd61-cb99-48c0-a578-20433850d1a5
    redo after an interruption: card #120, run 3826fd61-cb99-48c0-a578-20433850d1a5
    redo after an interruption: card #121, run 3826fd61-cb99-48c0-a578-20433850d1a5
```

R4b's `report-final.out` at 18:08:28Z exited 0:

```
    redos after an interruption: 3, first attempts: 17
    redo after an interruption: card #119, run 3826fd61-cb99-48c0-a578-20433850d1a5
    redo after an interruption: card #120, run 3826fd61-cb99-48c0-a578-20433850d1a5
    redo after an interruption: card #121, run 3826fd61-cb99-48c0-a578-20433850d1a5
```

[R4 and R4b, appendix 1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772).

## The cards' ends

The restarted run took every card to its end and exited at 18:08:16Z. R1's read at 18:08:24Z
showed `state = not running`, `runs = 2` and `last exit code = 0`. No C2 launch was needed.

- **#119: merged.** `gh pr view 137 -R williacj/emend --json state,mergedAt` at 18:08:44Z printed
  `{"mergedAt":"2026-11-18T18:07:35Z","state":"MERGED"}`.
- **#120: merged.** `gh pr view 139 -R williacj/emend --json state,mergedAt` at 18:08:44Z printed
  `{"mergedAt":"2026-11-18T18:08:00Z","state":"MERGED"}`.
- **#121: escalated.** Its PR 138 is open. `report-final.out`'s escalation lines, from the
  addendum's G4:

  ```
  608:    card #121, category ambiguous, raiser loop, destination "owner": 3 of 3 rounds spent.
  609-      reviewer (needs revision): Reject scheme-less host sources that permit HTTP(S) network origins, and preserve the example.com case in the existing CSP invariant tests while keeping the required suites green.; unmet item 2: A test fails when any directive of the production `app.security.csp` admits an `http:`, `https:`, `ws:` or `wss:` origin.
  ```

  #121's L2 `review.escalate` is at 17:58:14.628Z. It carries no `class` field, so
  `report-final.out` counts it as `unclassified 1`, with 0 infrastructure-caused. Its L2
  `transition` follows:

  ```
  {"ts":"2026-11-18T17:58:18.074Z","run":"3826fd61-cb99-48c0-a578-20433850d1a5","layer":"L2","event":"transition","card":121,"dispatch":null,"from":"review","to":"owner","cause":"escalated"}
  ```

  Addendum 2 quotes both lines uncut. It also quotes the L3 `merge.end` lines for #119 (pull
  137, at 18:07:36.451Z) and #120 (pull 139, at 18:08:01.312Z), each with `"outcome":"merged"`.
  [Addendum 2](https://github.com/williacj/rigger/issues/1416#issuecomment-6988498235).
  Z4 at 18:09:08Z read `121 Owner` on board 13.
- **#121 under M8-U57.** It stays in Owner until after M8, and stays out of the canary and the
  window. [M8-U57](https://github.com/williacj/rigger/issues/1293#issuecomment-6987800265).

[R5, appendix 1](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307772),
[addendum G3–G4](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).

The run ended with admission paused (Z1), the job unloaded (Z3: bootout `exit 0`, then `print`
`exit 113`), Ready empty, `119 Done`, `120 Done` and `121 Owner` (Z4), and
`.rigger/groups.json` reading `[]` (Z6).

## Stops and their disposition

No step's result stopped the run, so no disposition was needed during it.

R3's pattern defect was found after the run, by the coordinator's evidence check. The addendum
was posted at 18:35:47Z, and M8-K38 was posted at 18:36:15Z. Both came after Z7 at 18:09:19Z, so
no step of the run followed the defect.
[Addendum](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366),
[M8-K38](https://github.com/williacj/rigger/issues/1293#issuecomment-6987944281).

## Departures from the command list and their disposition

M8-U56 ratifies, on #1416–#1418, any command not on the predeclared list that only reads and is
disclosed in the card's outcome. It names the six deviations the outcome disclosed:

1. **Unlisted read-only watchers.** These were `1416-k0watch.mjs`, which polled the stream from
   offset 547677, and `1416-rwatch.sh`, which tailed the stream and ran `launchctl print` every
   5 s. Every result acted on was confirmed by a listed S5, R1 or R2 read first. Disposed by U56.
2. **Read-only steps issued in one batch.** A5a, A5b, A6 and A7 ran at 17:26:32Z, and Z3b and
   Z4a ran at 18:09:01Z. Disposed by U56.
3. **R5's three `gh pr list` calls in one shell `for` loop.** Disposed by U56.
4. **Extra reads of listed commands.** These were an R1-form read at 18:08:24Z and an R2 read at
   18:08:13Z. Disposed by U56.
5. **The timestamp and `tee` wrapper on each command.** It wrote only to the session's run log.
   Disposed by U56 and M8-U55.
6. **A label error.** R4's second command is labelled `R4b-grep` in the run log. Disposed by U56.

[Deviations, outcome](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307123),
[M8-U56](https://github.com/williacj/rigger/issues/1293#issuecomment-6987800265).

The addendum disclosed more departures:

- **R5's escalation read.** The plan's R5 said "the escalation lines in `report-final.out`" and
  gave no command. The command was a line-numbered `grep -n -i -E 'escalat|#121'` of that file,
  piped through `tee` and `cut`. It only reads and is disclosed under U56.
  [Addendum G3](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).
- **The unlogged source of #121's reviewer line.** The outcome's reviewer line came from
  `sed -n '600,650p'` on the Z7 copy at 18:09:50Z, which was not logged. The logged
  `grep -n -A1` at 18:34:58Z gives the same lines. Both only read and are disclosed under U56.
  [Addendum G4](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).
- **The evidence check's reruns.** G1–G5 and R2 were read-only, run after the outcome was posted,
  and disclosed under U56. The ListAgents read is one of them.
  [Addendum](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).
- **R3's defective pattern.** This was a predeclared command with a defect, not an unlisted one.
  Disposed by M8-K38, as "Item 2" records.

**Bookkeeping writes.** Under M8-U55, the session's writes to its own scratchpad needed no
predeclaration. These were the run log and its condensed copy, the two watcher scripts (with
`1416-rwatch.sh` edited by `sed -i` at 18:03Z to fix its buffering), the plan copy, the comment
bodies, the Z7 evidence copy and the Monitor tool's output. The session made no write to its
memory files during the run.
[Bookkeeping writes, outcome](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307123),
[M8-U55](https://github.com/williacj/rigger/issues/1293#issuecomment-6984845435).

**Z7's removal.** `/Users/cjwilliams/rigger-scratch/1416` is outside the session scratchpad, so
removing it is not bookkeeping. `rm -rf /Users/cjwilliams/rigger-scratch/1416` is posted as its
own amendment, ahead of the command. It runs only once this card's journal PR has merged.
[Addendum R3](https://github.com/williacj/rigger/issues/1416#issuecomment-6987932366).

## Recorded outcomes

The table is the outcome comment's, quoted verbatim, without corrections. Where its rows say
"below", they point to sections of the
[outcome comment](https://github.com/williacj/rigger/issues/1416#issuecomment-6987307123). This
entry quotes those sections under "Item 1", "Item 2" and "The cards' ends". The journal corrects
one claim the table relies on: R3's "no `slot.release`", recorded under "Item 2" as M8-K38.

> | Step | Time (UTC) | Result |
> |---|---|---|
> | A00 | 17:26:05 | `544775 .rigger/events.jsonl` |
> | A0 / A0b | 17:26:08 / :11 | no output, `exit 1` / no output, `exit 1` |
> | A1 | 17:26:16 | `{"commit":"c40377dac3143f6ca3d51c99622ded2a8d61888f"}` |
> | A2 | 17:26:16 | 6 nodes, each `"enabled":false` |
> | A3 | 17:26:23 | `58ec77e2a63ecc2066840a65e551083985ddafb8e061d129dd715b319f0612e7` |
> | A4 | 17:26:23 | `Could not find service "com.williacj.rigger" …`, `exit 113` |
> | A5 | 17:26:32 | `080eff372e1cb6417a2ada712a5eca9675ee561f`; the two expected `cargo-build` lines |
> | A6 | 17:26:32 | only `judges` and `scratch`; no `rigger-119/120/121` |
> | A7 | 17:26:32 | `[]` |
> | A8 | 17:26:37 | `exit 0` |
> | A9 | 17:26:40–46 | cp `exit 0`; sha256 `7d71427cc28b568308b0ac4d28d5900b4abe72188dd2fbd6a9da4aeec26449f6`, equal to the posted hash; `bash -n` `exit 0` |
> | P1 | 17:26:51 / :56 / 17:27:02 | #119, #120, #121 → Ready, each `exit 0` |
> | P2 | 17:27:07 | `119` `120` `121` |
> | P3 | 17:27:12 | `nothing would be pulled`; `admission is closed by owner: the owner's pause; time 1795010986736` |
> | P4 | 17:27:20 | `removed the owner closer …/owner-22c6afd8222c1acbdfd37db2e6c4ff4c.json`, `exit 0` |
> | P5 | 17:27:24 | `the next run would pull 3 cards`: `#119 change`, `#120 change`, `#121 change` |
> | S1 | 17:27:32 | `547677 .rigger/events.jsonl` |
> | S2 (O2) | ~17:29:24 | the owner bootstrapped the job. The coordinator relayed "It is run". Engine pid 29355 started at 11:29:24 CST, per K2's `ps` |
> | S3 | 17:29:38 | `state = running`, `runs = 1`, `pid = 29355` |
> | S4 | 17:29:41 | `PATH => /Users/cjwilliams/.cargo/bin:/opt/homebrew/bin:/Users/cjwilliams/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, `GGML_CCACHE => OFF`; no `CARGO_TARGET_DIR` or `RUSTC_WRAPPER` |
> | K0 | S5 at 17:31:53 | all three engineers live (below) |
> | K1 | 17:31:59–17:32:10 | `exit 0` |
> | R1 | 17:32:16 | `state = running`, `runs = 2`, `pid = 82440` |
> | R3 / R4 | 17:32:30 / :35 | below |
> | S6 | 18:03:21 | below |
> | run exit | 18:08:16 | the restarted run drained and exited. `launchctl print` at 18:08:24: `state = not running`, `runs = 2`, `last exit code = 0` |
> | R4b | 18:08:28 | `exit 0` (below) |
> | R5 | 18:08:35–45 | #119: PR 137 `MERGED` 18:07:35Z. #120: PR 139 `MERGED` 18:08:00Z. #121: PR 138 `OPEN`, escalated (below) |
> | C | — | no C2 was needed. The restarted run took every card to its end before it drained |
> | Z1 | 18:08:49 | `closed admission as the owner at …/owner-58bafc23b56778fab1c95e9b300c463d.json`, `exit 0` |
> | Z2 | 18:08:52 | `state = not running`, `last exit code = 0`, no `pid =` line |
> | Z3 | 18:08:56 / 18:09:01 | bootout `exit 0`; print `exit 113` |
> | Z4 | 18:09:01 / :08 | Ready empty; `119 Done`, `120 Done`, `121 Owner` |
> | Z5 | 18:09:12 | `{"commit":"c40377dac3143f6ca3d51c99622ded2a8d61888f"}` |
> | Z6 | 18:09:15 | `[]` |
> | Z7 | 18:09:19 | `cp -R` `exit 0`. `/Users/cjwilliams/rigger-scratch/1416` is kept until the journal entry is committed |
