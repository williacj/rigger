ABOUTME: Build plan for Rigger v0: failure model, size budget, platform, self-hosting,
constitution, milestones, and copy-over rules. Rigger is its own first consumer and macOS is the
first host.

# Rigger v0 build plan

**Status:** Ratified by the owner 2026-09-16. This plan ends when v0 ships at M8. M9 and M10 are
sketched here and become cards once v0 is done. Its durable content moves to the register or to
`ARCHITECTURE.md`, the board carries the order, and what is left here is history.

**Audience:** every role dispatched against this repo, and the owner. This describes building
Rigger, not using it; a consumer wants the README.

## 1. Premises

Four premises shape the build order in §4. Each summarises a fact `ARCHITECTURE.md` owns and cites
it; the citation is where the binding text lives, and a conflict resolves there.

1. **Engine death loses in-flight work.** Restart is redo. Resume is not built until a production
   incident shows redo was insufficient, and that incident is recorded in the journal.
   (`ARCHITECTURE.md`, Failure model.)
2. **Concurrency is required.** The engine works N cards at once on one host, where N is the
   `concurrency` setting.
3. **On a host fault, keep going.** Provisioning is best-effort and survivors are killed and
   logged (`ARCHITECTURE.md`, Failure model). Only a repeated identical host fault pauses
   admission, and it pauses admission rather than cards; L2 owns that hold.
4. **Rigger is its own first consumer.** Every verb's first real use is against this repository. A
   capability is not finished until Rigger uses it on itself, and no short-term script stands in
   for a capability the product will ship. See §1.1.

Two of `ARCHITECTURE.md`'s boundary rules drive this plan's order: a fault is handled at the
lowest layer that can handle it, and everything a consumer changes is declared in L4. The
per-layer budget check is a build-order deliverable, and the owner has set the numbers.

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
| M7 | `rigger report` over this repository's own event stream, complete across every layer |

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

**The engine never merges a change to its own live gate.** `rigger init` installs the gate as a
git hook under `.githooks/`, pointed at by `core.hooksPath`. It binds every ref update alike: a
dispatch, a human `git merge`, a second provider's session. This repository holds the live hook,
and `templates/` holds the shipped copy of the same thing. A card editing the template is ordinary
work. A card editing the live hook, the live config, or the CLI entry point the running engine
executes is changing the thing that adjudicates its own merge. Those cards carry a label that
excludes them from self-dispatch, and are done by hand.

**The manual path stays open.** A Rigger fault must never block Rigger's development. The M0
assets are equally a Claude Code session's assets, so any card can be done by hand in this
repository with no change to the work product.

## 2. Platform

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
structural, `docs/spec/` for the rest, both written under the `spec-style` skill.

The register states how ids are allocated and what a duplicate costs.

## 4. Build order

Each milestone is one or more PRs, each independently testable and at most four hours, TDD
throughout, reviewed by a Reviewer agent using this repo's code-review skill. Order is dependency
order; milestones with no edge between them may run concurrently.

**M0. Skeleton, agent assets, consumer contract.**

- Package layout; CI runs the suite and the §1 budget check.
- `HarnessConfig` required core, with this repository's own config — written by `init` — as the
  first fixture.
- The development assets: `ARCHITECTURE.md`, `AGENTS.md` and its `CLAUDE.md` import, the journal,
  the role prompts for engineer, reviewer, spike-engineer and PM, the skills, the hooks, and
  `settings.json`. Those drawn from a private prototype are starting points, reviewed against
  Rigger's own decisions before they are committed.
- The config declares the consumer extension points `ARCHITECTURE.md` lists, and the validator
  rejects anything outside them. Per kind of work it names one maker role and an ordered
  list of judge roles, with `owner` reserved and allowed only last.
- L5's event envelope and JSONL sink. The first events recorded are L1's dispatch events and L0's
  process events, from the Reviewer session in this milestone's exit test.
- Three verbs work: `init` writes the starter config and forks each template where its provider
  reads it;
  `doctor` checks Node version, `gh` auth, agent CLI auth, and config validity, one line each; and
  `--help`. The rest print "not yet implemented" and exit non-zero until their milestone.
- The doc-reference resolver and `spec-style-lint`, with Rigger's own
  `doc-references.json`.
- The CI workflow, so the README's CI badge can be added.

The README's "Install and usage" block is the CLI spec: `rigger --help` lists exactly those verbs,
in that order, and no others.

Three checks run in CI, and each covers something the others do not.

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
  match; `doctor` gains checks as later milestones land.
- `init` and `doctor` pass on a fresh clone.
- `npm pack` produces a tarball that installs outside this checkout and runs `--help` from there
  (§1.1).
- The validator rejects a missing required key.
- A hand-typed `path:line` literal in a `strict` document reds the build.
- A duplicate decision id reds the build.
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

- A fake board drives pull, complete, and cold restart with no persisted state.
- A card carrying no acceptance, or one failing the acceptance form check, is not admitted, and
  `plan` names the reason (D2).
- `setup-board` creates this repository's real board, fields, and labels.
- `plan` prints its real pull order.
- Concurrency comes from config. With `concurrency: 1` the engine works one card at a time; with
  `concurrency: 3` it works three at once.
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
  dead and named in the log.
- SIGKILL of Rigger mid-dispatch, then restart, kills the recorded group before scheduling.

**M3. Worktrees and provisioning.**

- One worktree per card under the consumer's topic rule.
- Provisioning steps come from consumer config and run as best-effort M2 runs. Each step may
  declare the card labels that select it.
- Rigger's config: `npm ci` for every card, and `vhs` only for cards labelled `area:demo`, which
  are the ones that re-record the demo tape.

Exit:

- A card whose labels select no step beyond the first provisions with that step only.
- A step exiting non-zero logs, and the card proceeds.

**M4. Roles.**

- Maker and judges as headless dispatches of the configured provider CLI through M2, with the
  Claude Code adapter as the default.
- Role names, prompts, and skills owned by the consumer; model tier per role from the card's label.
- The judges for a card run concurrently, each in its own dispatch, and none receives the maker's
  session or another judge's output. Each writes its own verdict marker, named by head SHA and
  judge role.
- L2 composes a review packet for each judge dispatch and L1 delivers it (D9). It carries the card
  and its acceptance, the pull request, the head and base SHAs, the diff, the changed files, the
  kind of work, and the judge's role. A judge may read beyond it.
- Rigger binds two kinds of work against its own board: a code change (maker engineer, judge
  reviewer) and a decision proposal (maker PM, judges reviewer and engineer, then owner). The
  second is the panel case — two agent judges running concurrently, with the owner last.

Exit:

- A real maker dispatch on a throwaway Rigger card opens a PR.
- A two-judge panel writes two markers for one head, each judge in its own dispatch, and neither
  receives the maker's session or the other judge's output.
- The judge configured as `owner` is not dispatched.
- Two judges at one head receive the same card, base SHA and diff, and each packet's digest is in
  the event stream.

**M5. Gate and merge.**

- Verdict marker schema and git gate hook.
- The marker records every acceptance item of its card as met or unmet (D2).
- The gate admits a merge only when every configured judge has a fresh verdict for the head, none
  is Critical, and all are sound.
- The owner's verdict is the existing ratified-or-rejected disposition, requested only after every
  agent judge is sound.
- Any judge asking for changes returns the work to the maker. A new commit invalidates every marker
  and the whole panel re-reviews.
- Merges serialize through L3's repo lane.

Exit:

- One stale marker among three blocks.
- Three fresh sound markers merge.
- A Critical from one judge blocks regardless of the other two.
- The owner is not asked while any agent judge is unsatisfied.
- A marker leaving one acceptance item unmet is not sound, and the gate refuses it.
- A judge ruling the acceptance insufficient escalates the card instead of merging it.
- Two finalizations at once serialize.

**M6. Escalation and infrastructure hold.**

- The configured escalation set routes to the owner's column, with a comment carrying the reason
  and the evidence.
- Infrastructure-class failures — provisioning, spawn failure, worktree creation — retry the same
  card once in a fresh worktree.
- A second identical failure in one run pauses admission with a logged reason and one telemetry
  event, leaving every card in its column.
- Verbs: `pause` and `resume` set and clear admission; `doctor` reports a hold and its reason.

Exit:

- Six identical infrastructure failures yield two attempts, one hold, and zero escalations.
- `pause` during a run finishes in-flight cards and admits none.

**M7. Report complete, clock triggers.**

- Every layer that has landed is emitting its event family, and `report` derives that layer's
  signals from `ARCHITECTURE.md`'s set. L6's signals arrive with M9 and M10.
- L3 adds clock triggers from config: card-shaped work creates a card, internal jobs dispatch
  directly, and a missed window fires once on the next start when the trigger says so.
- Telemetry push to a data ref in the consumer's repository is a config option, off by default.

Exit:

- A clock trigger creates a card that goes through the whole loop.
- A missed trigger fires once on restart.
- A card re-dispatched after an engine death is recorded as a redo, and `report` counts it apart
  from first-attempt work (D1).
- `report` on this repository's own event stream shows the signals of every layer that has
  landed.
- Telemetry push comes from config: off by default writes nothing to the data ref, and on writes
  the stream there.

**M8. Acceptance on Emend.**

In order:

1. Three concurrent cold `cargo build --workspace` dispatches in three real worktrees return 0,
   with survivors logged.
2. SIGKILL of Rigger during three live Engineers leaves no descendant within ten seconds, and the
   restart re-dispatches all three.
3. A bounded canary of ten Emend cards, including one requirements proposal judged by the
   three-role panel and then the owner. That panel needs two Emend assets that do not exist yet,
   a PM reviewer role and an architecture-review skill; both are Emend cards and both land first.
4. A thirty-card window with zero infrastructure-caused escalations, and every merge carrying a
   fresh verdict from every configured judge. Judged from `report`, not by hand.
5. Telemetry push is on for the whole window, and the pushed stream reads back complete
   afterwards. M9 and M10 have no other source of data.

Then:

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
  cited signal for every move.
- No move touches L0 through L3.

**M10. Meta-level improvement loop.**

- L6 runs the retrospective role and files proposals with a target layer.
- A proposal against L0 through L3 cites that layer's own signal and passes the budget check, or is
  refused before it reaches the owner.
- Every proposal goes to the owner. L6 applies nothing.
- Proposals are themselves events, so the report shows acceptance and effect.

Exit:

- One run produces at least one proposal per populated layer, each with its signal.
- A proposal that would exceed a layer's budget is refused, with the budget named.

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
