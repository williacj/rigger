ABOUTME: Records card 1300's proof of the network and dispatched-account boundaries and their explicit limits.

# Network and account boundaries

The acceptance is issue #1300, revision `5ade1c5d2381`. The source at the merge base,
`52fb8a3d15a7f6842436a7295edb52c4b7a4ad35`, already supplies the required behaviour.
The initial revision added proof and a guard without changing a production module.
The correction below strengthens that guard and makes native reader options explicit. The card's test-first
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
a production change under the initial guard. The correction below records the stricter
native-option rule and its two source edits. The guard checks the code as syntax; it does not execute its modules.

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
the runner's tier lists and the package manifest remain intact. The initial revision changed no Self-hosting path; the correction touches process.mjs.

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


## Independent attack correction, 2026-11-09

The coordinator's attack at the initial committed head, 211221cfced59d324fe8ef2cd36a56811562163b,
found ordinary import/member and input-reassignment edits escaping N8. The correction resolves
lexical import bindings through module exports, namespaces, destructuring and member reads.
It inventories callers of reviewed process definitions regardless of the importer's local name.
Pinned program and environment inputs now refuse reassignment and member mutations, including
through ordinary local aliases. The one adapter invocation assignment and the documented
inherited-environment copy/merge are explicitly admitted. Origins also refuse sibling spreads
or computed keys that could override the pinned property.

The TDD red for the five process-binding rows is 1300-r2-m14-red.log; the next green is
1300-r2-call-bindings-green-1.log. Reassignment red/green is recorded in
1300-r2-program-reassignment-{red,green}.log. All these measurements name head 211221cf and
retain the exact uncommitted test diff beside each subsequent run. Each source counterexample
is also submitted separately to the guarded mutation runner before handoff.

N3/N11 now pins doctor's actual CONFIG binding to init's exported literal, the const target
path and the imported path/URL helpers, and refuses writes to the filename, target or path.
The behavioural case with an absent root file and a nested decoy must report absence. It runs
before the static assertions, so a fallback mutation must fail on its actual parsed result.
1300-r2-config-binding-red.log records both missed counterexamples before the fix;
1300-r2-config-binding-green.log records their admission checks passing after it.

The requested native-option rule rejects every spread and computed key, and any shell, uid or
gid field. This made the two benign reader spreads fail at process.mjs:984 and :1024;
1300-r2-native-reader-spreads-red.log preserves that result. Their fields are now destructured
from the same reader and passed explicitly. The asynchronous timeout remains zero; the
synchronous timeout retains reader's bound. This is the only production change, inside the
card's permitted Self-hosting scope, so an owner marker is required. N8's programs and step
input held at the base; its strengthened option shape needed this change.

Conditional account options and environment additions are in sight under A4/A5. They are
Rigger's own constructed values, unlike the consumer's excluded NODE_OPTIONS. The guard pins
adapter keys and their path sources, the inherited-environment copier and dispatch handoffs,
and refuses writes to the engine environment. The A5 conditional rows went red in
1300-r2-conditional-environment-red-valid.log and green after the pinned-origin checks.
A1/A2/A3/A6 and the out-of-sight rows retain the base outcomes in the tables above.

The native observer now checks options in the two-argument overload as well as the three-
argument form. Its premise starts a warming stand-in through spawn, spawnSync and execFile
with the account's own uid/gid, observes both keys and clears those observations before real
Claude/Codex role dispatch. 1300-r2-account-overload-red.log fails the spawn premise before
the observer fix; 1300-r2-account-overload-green.log passes afterwards. The affected host files
then passed 205 tests with zero failures or skips in 1300-r2-affected-process-and-account.log.
These are measured results at head 211221cf with local changes; the PR records committed-head
verification and its counts separately.

Failed implementation attempts are retained: conditional-environment-green.log raised a
ReferenceError in the guard's mapper before its corrected green-2 run; origin-container-red.log
contained an invalid fixture before red-valid corrected it. The first conditional-environment
red used an unbound Codex environment name; red-valid substitutes process.env before the fix.
None of those malformed attempts is offered as a discriminating red. The valid return-wrapper
counterexample was already refused by the origin inventory and gets a guarded receipt under
the card's base-passing-test exception.


The whole-class check at committed fix head 12a1339b6fd2709b6966d04480cd4458f0fe4df4
added three ordinary binding variants. An Object.assign alias could mutate a pinned
local environment without the direct callee spelling. A built-in star export encountered
before an explicit or package star re-export could mask dispatch's actual origin. Each
variant went red in 1300-r2-aliased-mutator-red.log or
1300-r2-reexport-priority-red{-star}.log before its fix. Mutator aliases now resolve through
their lexical binding; explicit exports take priority and a built-in's unknown export set
cannot mask a package re-export. The whole guard passed after both changes. These are
ordinary named bindings in sight under N2/N8/A5, and require no additional write path.
The initial correction's complete set of 23 guarded receipts was killed at that fix head;
the PR records fresh receipts after the final merge for the enlarged counterexample set.


The exported-input check at merge head 7735c56758329c47c2907116eac1f07ee30b0f20
found two more instances of the same declaration-only premise. An importer could mutate the
exported auth array, and init's filename could become a let with a conditional reassignment.
The named reds are 1300-r2-imported-input-write-red.log and
1300-r2-exported-filename-red.log. Program-origin identities are now protected across module
bindings, including arrays and their containing objects; N11 separately checks that the
producer's filename is an immutable literal. Both are ordinary input bindings in sight under
N8/N11; no reflective call route or additional production path is introduced. The whole guard
then passed in 1300-r2-exported-filename-green.log. The PR records receipts at the subsequent
committed head, including these cases.

The nested commit and merge loggers initially shared each action's output filename. Their
complete unfiltered stdout was also teed, independently, to 1300-r2-tdd-session.log before any
inspection. The cited commit-fix-complete and merge-main-complete files are exact byte ranges
of that retained original, with offsets and SHA-256 digests in
1300-r2-hook-log-provenance.json. No output was lost. Later action and inner-step log filenames
are distinct. The first TDD driver released its slot at its idle bound between completed runs;
no verification was interrupted, and the subsequent green ran after reacquiring the slot.


N11's operand bindings also need their own pin. At head
7d6025c6831e5f23317828d868bbde484abbc271, a local CONFIG or target, or a path parameter on
an immediate arrow, kept the expected expression names while changing what they referenced.
1300-r2-config-scope-binding-red.log records all three intended misses before the fix.
N11 now compares the actual target/CONFIG/path reference bindings with the factory parameter,
module import and constant path declaration. The whole guard then passed in
1300-r2-config-scope-binding-green.log. These are ordinary local bindings at the same named
import boundary, within N11; no reflective route or production file is added. The completed
host run at that predecessor is retained separately, and final-head verification is repeated.
