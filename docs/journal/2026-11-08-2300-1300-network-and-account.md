ABOUTME: Records card 1300's proof of the network and dispatched-account boundaries and their explicit limits.

# Network and account boundaries

The acceptance is issue #1300, revision `5ade1c5d2381`. The source at the merge base,
`52fb8a3d15a7f6842436a7295edb52c4b7a4ad35`, already supplies the required behaviour.
This work adds proof and a guard; it changes no production module. The card's test-first
exception admits those claiming tests that pass against that source, with guarded mutation
receipts required for each.

Measured by `npm test` at that base on 2026-11-08: tests 5486, pass 5486, fail 0, skipped 0.
The one-minute load from `uptime` was 5.87 at start and 6.54 at end; the start line count
from `ps -U | wc -l` was 645, including its header. Full output is retained in `1300-baseline-deterministic.log` in the
dispatch's scratch directory. The initial guard red at that same HEAD is retained in
`1300-network-red.log`: the named N1/N2 test failed its assertion that `node:https` must be
refused. The guard had no built-in check at that point.

The import inventory at the base followed static imports, re-exports and literal imports
from the two card-named roots with acorn. It measured 57 modules and one nonliteral import,
consumerConfig's. The program inventory also examined arguments and defaulted runner/spawn
aliases; the data-ref and launchd calls and synchronous process reads are included.
The PR carries the commands, guarded counterexamples and completed verification receipts.

## Table N at the merge base

The in-scope base judgments below follow that inventory and the code it names. No row needs
a production change. The guard checks the code as syntax; it does not execute its modules.

| Row | Base outcome and proof boundary |
|---|---|
| N1 | Held: the reviewed built-ins supply local operations; child_process is confined to host.mjs. The guard gives each admission a reason. |
| N2 | Held: literal imports are followed, including verdict's import of gate-check. Import, re-export and literal-import fixtures protect traversal. |
| N3 | Held: consumerConfig alone imports a nonliteral specifier. Its named exception carries its consumer-code reason. |
| N4 | Held: allowed globals have individual reasons; lexical bindings keep worktrees' local fetch distinct from a network global. |
| N5 | Held: no hidden loader or process native-loader entry is used. The guard refuses named loader routes. |
| N6 | Held: no named eval or Function route is used. |
| N8 | Held: the reviewed process sites resolve to the closed program set; the shell line is the configured step.run. |
| N9 | Out of sight at base and head: the owner's credentialed tools' internals, as the card rules. |
| N10 | Out of sight at base and head: consumer provisioning lines, under M8-U2 Q8 a. |
| N11 | Held at the boundary: consumerConfig loads the target's rigger.config.mjs; that consumer module is out of the guard's sight under M8-U3 Q15 a. |
| N12 | Out of sight at base and head: native addons; the package declares no runtime dependency and ships none, as the card records. |
| N13 | Out of sight at base and head: runtime-computed or reflective routes except on the global object. This is a tripwire on reviewed code. |
| N14 | Out of sight at base and head: the account's NODE_OPTIONS, under M8-U3 Q15 a. |

## Table A at the merge base

Measured with the appended account test against the unchanged base source on
`macos-27.2-arm64-node26`, through real roleDispatch, dispatch and the native OS host.
The stand-ins read Node's real account APIs. They read no credential and start no child.
Environment values are hashed before reporting, so assertion output cannot expose one.
The focused run in `1300-account-base.log` exited 0 with tests 1, pass 1, fail 0, skipped 0;
`uptime` reported 5.15 at both ends and `ps -U | wc -l` counted 633 lines at start,
including its header.

| Row | Base outcome and whether a change was needed |
|---|---|
| A1 | Held for both providers: real and effective uid equal the engine's. No change. |
| A2 | Held for both providers: real and effective gid equal the engine's. No change. |
| A3 | Held for both providers: supplementary groups equal the engine's set. No change. |
| A4 | Held at the real host, including the Codex probe: options carry neither uid nor gid. No change. |
| A5 | Held: Claude adds CLAUDE_CODE_TMPDIR under the workspace; Codex adds CODEX_HOME, TMPDIR and TMPPREFIX under the role scratch directory. Other retained values come from the engine. No change. |
| A6 | Held: all observed work/scratch entries have neither permission bit. The test observes L1's written process record and Codex's written scratch config. No change. |
| A7 | Out of sight at base and head: account-level grants, as the card rules. No change. |
| A8 | Out of sight at base and head: Codex's link to the account's own auth.json. The mode walk uses lstat and follows no link. No change. |

The source of the four adapter values is path construction, not a credential: Claude's
workspace plus `.claude-tmp`; Codex's role scratch plus `codex-home`, plus `tmp`, and the
`zsh` prefix under that temporary directory. The test establishes that all four keys are
absent from its engine environment before observing the additions.

The named tests and their claims are recorded by the generated matrix. Existing test lines,
the runner's tier lists and the package manifest remain intact. No Self-hosting path changes.

The second guard red is measured at the same source HEAD in `1300-network-routes-red.log`:
its N3-to-N6 fixture test failed the assertion that an unknown nonliteral import must name
its site. After implementing those checks, `1300-network-routes-green.log` records tests 3,
pass 3, fail 0, skipped 0 on 2026-11-09. These checks time nothing and need no clock.

The strengthened account observer wraps the native child-process API, so an option added
inside host.mjs is visible too. Its unchanged-base run on 2026-11-08 is measured in
`1300-account-native-green.log`: tests 1, pass 1, fail 0, skipped 0, with `uptime` load 8.76
at both ends and 640 lines from `ps -U | wc -l` at start, including its header.
Later receipts use `ps -U <uid> -o pid=` so their process counts exclude the header.

N8 uses the card's explicit test-first exception. Its inventory includes the native-method
reads, defaulted aliases, upstream program origins and internal process-reader forwarding.
The shell's input is checked as syntax against the configured step expression. The guard
parses these paths; it never executes the programs or the injected network counterexamples.

The first N8 run at the base source HEAD, retained in `1300-network-program-red.log`,
failed the inventory assertion because the new test attributed the yielded lsof program to
sweeping. The source holds it in sweeping's nested list generator. Correcting those two
owner keys fixes the guard's inventory; no production change follows from this failed run.
The run's measured load was 4.28 at both ends, with 626 header-free process rows at start.
