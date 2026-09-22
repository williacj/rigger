ABOUTME: Build plan for Rigger v0: premises, self-hosting, platform, constitution, build order, and the WSL2 spike. Rigger is its own first consumer and macOS is the first host.

# Rigger v0 build plan

**Status:** Ratified by the owner 2026-09-17. This plan ends when v0 ships at M8. M9 and M10 are
sketched here and become cards once v0 is done. Its durable content moves to the register or to
`ARCHITECTURE.md`, the board carries the order, and what is left here is history.

**Audience:** every role dispatched against this repo, and the owner. This describes building
Rigger, not using it; a consumer wants the README.

## 1. Premises

Four premises shape the build order in §4. Where one summarises a fact `ARCHITECTURE.md` owns it
cites it, and the citation is where the binding text lives; a conflict resolves there.

1. **Engine death loses in-flight work.** Restart is redo (`R-STATE-2`), and D10 holds what v0
   therefore does not build.
2. **Concurrency is required.** The engine works N cards at once on one host, where N is the
   `concurrency` setting (`ARCHITECTURE.md`, Extension points).
3. **On a host fault, keep going.** An optional step that fails is recorded and the work proceeds
   (`R-PROV-2`), and survivors are killed and recorded (`R-STATE-5`). A repeated host fault closes
   admission rather than stopping cards (`R-FAIL-3`); L3 owns that hold.
4. **Rigger is its own first consumer.** Every verb's first real use is against this repository. A
   capability is not finished until Rigger uses it on itself, and no short-term script stands in
   for a capability the product will ship. See §1.1.

Two things `ARCHITECTURE.md` fixes drive this plan's order: a fault is handled at the lowest
layer that can handle it, and everything a consumer changes is declared in L4. The
budget check is a build-order deliverable, and the owner has set the numbers.

### 1.1 Self-hosting

Rigger is its own first consumer. Its M0 assets are also this repository's L4 layer: the role
files, the review skill, and the hooks are at once what builds Rigger and what Rigger reads as a
consumer's configuration. Self-hosting therefore costs no production lines, because L4 carries no
budget.

**What gets used when.** Each verb is used against this repository as soon as it exists. The
dispatch loop is last, because it needs the execution core and the roles beneath it:

| From | Rigger builds Rigger by |
|---|---|
| M0 | `rigger init` writes this repository's own config and forks the role templates into it |
| M0 | `rigger doctor` runs against this repository |
| M1 | `rigger setup-board` creates this repository's real board, fields, and labels |
| M1 | `rigger plan` prints this repository's real pull order; read-only, so it is safe long before the loop exists |
| M1 | `rigger report` over whatever events exist by then |
| M3 | worktrees and provisioning steps run against this repository's own cards |
| M4 | the first dispatch Rigger makes itself, under the installation rule below |
| M5 | the first merge through the gate |
| M6 | `rigger pause` and `rigger resume` against this repository's own run |
| M6 | this repository's own runs supervised by launchd, governable with `pause` and `resume` |
| M7 | `rigger report` over this repository's own event stream, for every layer that has landed |

**The installation rule.** A dispatching engine never runs from the checkout it is changing. The
engine that builds Rigger is installed from a packed tarball (`npm pack`, then install the `.tgz`)
or from a published prerelease, lives outside this checkout, and keeps its worktree root outside
both the checkout and the package. `npm link` does not satisfy this rule: it symlinks back into
the source tree, so the runtime and the target are the same files. Packaging is therefore an M0
concern, not an M8 one.

**vN builds vN+1.** The installed engine is always a release behind the checkout it works on. That
is a standing condition, not a transition, and it needs a promote step. That step names when the
installed engine is upgraded, to which version, and what becomes of a card that changes a config
schema or CLI contract the running engine reads. D7 settles it.

**The engine never merges a change to its own live gate.** From M5 the gate is the git hook
`ARCHITECTURE.md` describes, and it binds every route to this repository's main line, Rigger's own
dispatches included. This repository holds the live hook, and `templates/` holds the shipped copy
of the same thing. `AGENTS.md` states which cards are
excluded from self-dispatch as a result, and D7 records the promote step that follows from it.

**The manual path stays open.** A Rigger fault must never block Rigger's development. The M0
assets are equally a Claude Code session's assets, so any card can be done by hand in this
repository with no change to the work product.

## 2. Platform

D13 records the choice and what would reverse it; this section is what follows for the build.

**macOS first.** Containment is a POSIX process group: `spawn` with `detached: true`,
`process.kill(-pgid, signal)` for the tree, and a `ps -o lstart= -p` start-time check before
killing a recorded pgid after restart. launchd supervises unattended runs.

**Windows only as the WSL2 spike decides** (§5). If Engineer workloads run under WSL2, Windows
needs nothing native. If not, a Windows containment backend is a separate, budgeted port after v0
is proven on macOS. Consumers' Windows-specific test suites run in their own CI, never on the host
Rigger schedules from.

## 3. Constitution, built from the ground up

Rigger's constitution is written here as the work proceeds: `ARCHITECTURE.md` is already the
architecture of record, and every further decision is recorded when the work needing it arrives,
ratified by the owner before it binds.

The register needs a home and a rule from M0, because the `recorded-decision` escalation category
means nothing without somewhere for a ratified decision to land: `ARCHITECTURE.md` for anything
structural, `docs/spec/decisions.md` for a choice, and `docs/spec/requirements.md` for what must
be true as a result. All are written under the `spec-style` skill.

The register states how ids are allocated and what a duplicate costs.

## 4. Build order

Each milestone is one or more PRs, each independently testable and at most four hours, TDD
throughout, reviewed by a Reviewer agent using this repo's code-review skill. Order is dependency
order; milestones with no edge between them may run concurrently.

**M0. Skeleton, agent assets, consumer contract.**

- Package layout; CI runs the suite, the package budget check, and the instruction-file word
  budget check.
- The config's required core, with this repository's own config — written by `init` — as the
  first fixture.
- The development assets: `ARCHITECTURE.md`, `AGENTS.md` and its `CLAUDE.md` import, the journal,
  the role prompts, the skills — including the acceptance skill `R-CARD-4` requires — the hooks,
  and `settings.json`. Those drawn from a private prototype are starting points, reviewed against
  Rigger's own decisions before they are committed.
- The config declares the consumer extension points `ARCHITECTURE.md` lists, and the validator
  rejects anything outside them. Per kind of work it names one maker role and an ordered
  list of judge roles, with `owner` reserved and allowed only last.
- `docs/derived/test-matrix.md`, one row per requirement, naming the tests that prove it. Each
  test declares the requirement it proves and a tool builds the matrix from those declarations, so
  it is the first generated document and the reason `docs/derived/` exists at all (D8). A row with
  no test is a visible gap, the way `checked by: nothing yet` is in the register. CI reds on a
  requirement the register gains with no test to claim it, and counts the rest as gaps that close
  by M8 (D17). This outlives the plan: at v0 the exit tests below become history, and the matrix
  is what still ties a requirement to its evidence.
- L5's event envelope and JSONL sink. Nothing writes to them yet: L1's dispatch events and L0's
  process events begin at M2, when there is an execution core to emit them.
- Two verbs work, and so does the `--help` flag. `init` writes the starter config and forks each
  template where its provider reads it;
  `doctor` checks Node version, `gh` auth, agent CLI auth, and config validity, one line each; and
  `--help`. The rest print "not yet implemented" and exit non-zero until their milestone.
- The doc-reference resolver and `spec-style-lint`, with Rigger's own
  `doc-references.json`.
- The CI workflow, so the README's CI badge can be added.

The README's "Install and usage" block is the CLI spec: `rigger --help` lists exactly those verbs,
in that order, and no others.

Several checks run in CI. Three of them read the documents, and each covers something the others
do not.

The **resolver** verifies the `path:line` pointers in the documents `doc-references.json` names,
at the fail level that config gives each. It runs whole-file rather than diff-scoped, because
Rigger starts with no backlog to migrate. The register is `strict` from its first commit, because
it names only assets that land here. The root instruction file is `soft` while M0 is open and
`strict` once M0 closes, when the assets it names exist. Writing Rigger's own
`doc-references.json` is the first use of that extension point.

The **path check** asserts that every backticked repository path in an instruction file, or in the
register, exists on disk. The resolver never looks at bare paths, so this covers what it misses.
Those two documents are in scope because they name only assets that land here, where the others
name code that arrives later. The path check keeps its own exemptions, and `docs/derived/` is on
that list until D8 rule 4 creates it.

The **lint** covers every document in the repository, including `AGENTS.md` and the README.

Exit:

- The verbs, and their order, match the README's block. Their help text is not part of the
  match; the verbs gain checks and behaviour as later milestones land.
- `init` and `doctor` pass on a fresh clone.
- `npm pack` produces a tarball that installs outside this checkout and runs `--help` from there
  (§1.1) (`R-SAFE-5`).
- The validator rejects a missing required key (`R-SCHED-10`).
- A hand-typed `path:line` literal in a `strict` document reds the build.
- Every requirement id appears in `docs/derived/test-matrix.md`, and the matrix regenerates
  byte-identical from the tests. A requirement the register gains with no test to claim it reds
  the build, and the requirements the register already held are counted gaps (D17).
- A duplicate decision id reds the build, and so does a duplicate requirement id. The
  requirement check reads `docs/spec/requirements.md` and `docs/spec/requirements-retired.md`
  together, because a retired id stays allocated.
- A backticked path in an instruction file or in the register that does not exist reds the build.
- One Reviewer session, run by hand against this repo, reviews a diff and produces findings.
  Nothing dispatches until M4 and no gate exists until M5, so this exercises the role prompt, the
  skill and the hooks, and nothing downstream of them.

**M1. Board client and scheduler.**

- Read every column the config declares — Ready, Coding, Review, Owner and Done — from the
  Projects v2 board.
- Pull in priority order with N in flight, claim synchronously in memory before any await, and
  settle after each completion.
- Cold start reads the board and treats every Coding or Review card with no PR, or no fresh
  verdict, as re-dispatchable.
- L3 implements the pull and drain triggers and emits its event family.
- Verbs: `setup-board` creates columns, fields, and labels; `plan` prints the pull order; `once`
  and `run` drive the loop; `report` derives whatever signals the events so far support. `doctor`
  gains board reachability and field checks.
- `docs/demo.tape` records `rigger once` against the fake board with `vhs`. The GIF it produces is
  embedded in the README where the placeholder comment sits, and the tape is re-run for every
  release.

Exit:

- A fake board drives pull, complete, and cold restart with no persisted state
  (`R-STATE-1`, `R-STATE-2`).
- A card carrying no acceptance, or one failing the acceptance form check, is not admitted, and
  `plan` names the reason (`R-CARD-7`, `R-CARD-8`).
- `setup-board` creates this repository's real board, fields, and labels.
- `plan` prints its real pull order (`R-SCHED-1`).
- Concurrency comes from config. With `concurrency: 1` the engine works one card at a time; with
  `concurrency: 3` it works three at once (`R-SCHED-2`).
- The column display names come from config: a board whose columns are named differently drives
  the same loop.
- The demo GIF regenerates from the tape in CI.

**M2. Execution core.**

- `run(command, {cwd, env, timeout})` returns an exit code and captured output.
- One process group per dispatch, a pgid registry on disk, kill-all on exit, kill-recorded on start
  with start-time verification, and a survivor census logged by name.

This is the budgeted module.

Exit:

- A tree with a lingering grandchild whose parent exits 0 yields result 0, and the grandchild is
  dead and named in the log (`R-STATE-5`).
- SIGKILL of Rigger mid-dispatch, then restart, kills the recorded group before scheduling
  (`R-STATE-4`).

**M3. Worktrees and provisioning.**

- One worktree per card under the consumer's topic rule.
- Provisioning steps come from consumer config and run as M2 runs. Each step may declare the card
  labels that select it, and whether the work requires it (D12).
- Rigger's config: `npm ci` for every card, and `vhs` only for cards labelled `area:demo`, which
  are the ones that re-record the demo tape.

Exit:

- A card whose labels select no step beyond the first provisions with that step only.
- An optional step exiting non-zero logs, and the card proceeds (`R-PROV-2`).
- A required step exiting non-zero dispatches no maker, and the card retries once in a fresh
  worktree (`R-FAIL-1`, `R-FAIL-2`).

**M4. Roles.**

- Maker and judges as headless dispatches of the configured provider CLI through M2, with the
  Claude Code adapter as the default.
- Role names, prompts, and skills owned by the consumer; model tier per role from the card's label.
- The judges for a card run concurrently, each in its own dispatch, and none receives the maker's
  session or another judge's output. Each writes its own findings, named by head SHA and judge
  role; M5 fixes the schema they are written into.
- L2 composes a review packet for each judge dispatch and L1 delivers it. `R-EVIDENCE` states
  what it carries.
- Rigger binds three kinds of work against its own board: a code change (maker engineer, judge
  reviewer), a spec proposal (maker PM, judges reviewer and engineer, then owner), and a spike
  (maker spike-engineer, judge reviewer). The proposal is the panel case — two agent judges
  running concurrently, with the owner last.

Exit:

- A real maker dispatch on a throwaway Rigger card opens a PR (`R-WORK-6`).
- A two-judge panel runs for one head, each judge in its own dispatch, and neither receives the
  maker's session or the other judge's output. Each writes its findings; the marker schema they
  write into is M5's.
- The judge configured as `owner` is not dispatched (`R-LOOP-11`).
- Two judges at one head receive the same card, base SHA and diff, and what each was given is in
  the event stream. What they write their findings into is M5's.

**M5. Gate and merge.**

- Verdict marker schema and git gate hook, and `init` grows to install the hook.
- The marker records every acceptance item of its card as met or unmet (`R-LOOP-5`), and whether
  the acceptance covered what the card asked (`R-LOOP-6`).
- The gate admits a merge only when every configured judge's verdict is sound and fresh for both
  the head commit and the card's latest acceptance, none is Critical, and the consumer's CI is
  green.
- The owner's verdict uses the same vocabulary as any judge's, requested only after every agent
  judge is sound.
- Any judge asking for changes returns the work to the maker. A new commit invalidates every marker
  and the whole panel re-reviews.
- Merges serialize through L3's repo lane.

Exit, against a fixture configured with three agent judges:

- One stale marker among three blocks (`R-GATE-2`).
- Three fresh sound markers merge (`R-GATE-4`).
- A Critical from one judge blocks regardless of the other two (`R-GATE-6`).
- The owner is not asked while any agent judge is unsatisfied (`R-LOOP-11`).
- A marker leaving one acceptance item unmet is not sound, and the gate refuses it
  (`R-VERDICT-4`).
- A judge ruling the acceptance insufficient returns the card to its author instead of merging it
  (`R-LOOP-6`).
- A red CI blocks a merge that every judge has passed (`R-GATE-8`).
- A verdict written before the card's latest acceptance is stale, and the gate refuses it.
- Two merges at once serialize (`R-SCHED-9`).

**M6. Escalation and infrastructure hold.**

- The configured escalation set routes to the owner's column, with a comment carrying the reason
  and the evidence.
- Infrastructure-class failures — a required provisioning step, a spawn failure, a worktree that
  cannot be created — retry the same card once. A worktree that cannot be created is retried in
  place rather than in a fresh one.
- A second identical failure in one run pauses admission with a logged reason and one telemetry
  event, leaving every card in its column.
- Verbs: `pause` and `resume` set and clear admission; `doctor` reports a hold and its reason.
- The launchd assets that keep the engine alive across a reboot, which L0 owns.

Exit:

- A card that fails on infrastructure twice yields two attempts, one hold, and zero escalations.
  Admission is paused, so a third attempt never starts (`R-FAIL-2`, `R-FAIL-3`, `R-FAIL-4`).
- `pause` during a run finishes in-flight cards and admits none (`R-SCHED-3`).

**M7. Report complete, clock triggers.**

- Every layer that has landed is emitting its event family, and `report` derives that layer's
  signals from `ARCHITECTURE.md`'s set. L6's signals arrive with M9 and M10.
- L3 adds clock triggers from config: card-shaped work creates a card, internal jobs dispatch
  directly, and a missed window fires once on the next start when the trigger says so.
- Telemetry push to a data ref in the consumer's repository is a config option, off by default.

Exit:

- A clock trigger creates a card that goes through the whole loop (`R-SCHED-5`).
- A missed trigger fires once on restart (`R-SCHED-8`).
- A card re-dispatched after an engine death is recorded as a redo, and `report` counts it apart
  from first-attempt work (D1) (`R-STATE-3`).
- `report` on this repository's own event stream shows the signals of every layer that has
  landed (`R-RECORD-2`, `R-RECORD-3`, `R-RECORD-4`).
- Telemetry push comes from config: off by default writes nothing to the data ref, and on writes
  the stream there (`R-SAFE-3`).

**M8. Acceptance on Emend.**

In order:

1. Three concurrent cold `cargo build --workspace` dispatches in three real worktrees return 0,
   with survivors logged.
2. SIGKILL of Rigger during three live Engineers leaves no descendant within ten seconds, and the
   restart re-dispatches all three.
3. A bounded canary of ten Emend cards, including one requirements proposal judged by Emend's
   panel and then the owner. That panel needs two Emend assets that do not exist yet,
   a PM reviewer role and an architecture-review skill; both are Emend cards and both land first.
4. A thirty-card window with zero infrastructure-caused escalations, and every merge carrying a
   fresh verdict from every configured judge. Judged from `report`, not by hand.
5. Telemetry push is on for the whole window, and the pushed stream reads back complete
   afterwards. M9 and M10 have no other source of data.

Then:

- No counted gap is left: a test claims every requirement in `docs/spec/requirements.md` (D17).
- First tagged release and npm publish.
- The README's Status section and the "nothing is published yet" note are updated.
- The Telemetry and Security sections are checked against the shipped behaviour.
- Emend's CLAUDE.md points at Rigger, and Emend's `harness/` directory is deleted.

**M9. Object-level improvement loop.**

- L6 runs the consumer's configured improvement role at its cadence, with the report as input.
- It may reorder the backlog and correct tiers within L3 and L4. Anything touching a recorded
  decision goes to the owner.
- Emend binds the Re-planner, reading review rounds, rework, and tier accuracy.

Exit:

- Reading M8's thirty cards of recorded telemetry, one drain-time run produces a reordering with a
  cited signal for every move (`R-IMPROVE-3`).
- No move changes code, in any layer (`R-IMPROVE-1`).

**M10. Meta-level improvement loop.**

- L6 runs the retrospective role and files proposals with a target layer.
- A proposal against L0 through L3 cites that layer's own signal and passes the budget check, or is
  refused before it reaches the owner.
- Every proposal goes to the owner. L6 applies nothing.
- Proposals are themselves events, so the report shows acceptance and effect.

Exit:

- One run produces at least one proposal per populated layer, each with its signal
  (`R-IMPROVE-3`, `R-IMPROVE-5`).
- A proposal that would push the package over its budget is refused, with the budget named
  (`R-IMPROVE-4`).

## 5. Spike: Engineer workloads under WSL2 (`type:spike`)

Run before any Windows containment code. Docs-only PR under `docs/spikes/`.

1. `wsl --status`, `wsl -l -v`; record distro and version.
2. In the distro, on the Linux filesystem (not `/mnt/c`): rustup, pinned Node, `gh`, Claude CLI,
   authenticated. Record versions.
3. Tauri Linux build libraries (webkit2gtk 4.1, gtk3, libsoup3, librsvg2, ayatana-appindicator);
   clone Emend.
4. Run `cargo test` in `src-tauri/`, `npm test`, `npm run test:harness`, `npm run test:e2e` under
   WSLg or headless. Record pass/fail per suite and cold `cargo build --workspace` time, against a
   Windows native baseline measured in the same run.
5. One real `claude -p` dispatch started with `setsid`; kill the parent; `pgrep` proves nothing
   survives.
6. List every test that passes on Windows native and fails under WSL2.

Verdict: "WSL2 hosts provisioning and Engineer dispatch for all cards except <list>", or "no,
because <suite or tool>".
