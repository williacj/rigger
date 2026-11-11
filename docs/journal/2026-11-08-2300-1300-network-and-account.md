ABOUTME: Records card 1300's proof of the network and dispatched-account boundaries and their explicit limits.

# Network and account boundaries

The historical sections below record issue #1300 at revision `5ade1c5d2381`, before its value-tracking guard was retired. The current acceptance is `124f2c3a8c06`; its deny-by-default revision and current-base outcomes are recorded at the end. The earlier source at the merge base,
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
| N8 | Failed at the base: the N8 guard rejected two reader option spreads in process.mjs. Expanding them to explicit fields was required; the reviewed process sites then resolve to the closed program set and the shell line is the configured step.run. |
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


## Static invocation and write correction, 2026-11-09

[M8-K13 on #1293](https://github.com/williacj/rigger/issues/1293#issuecomment-6754371451)
places n02/n08, n17, n15 and n20 in sight at acceptance revision 5ade1c5d2381.
It leaves n21's caller-selected target directory outside this guard. The requested merge of
origin/main at 76d33f169c180ee08abfde405ea05e16b59e57ae applied without conflict;
its hooked commit is 9ad24711818ae8012d1994140224aa266aa03c48. The following TDD runs name
that head and retain the complete uncommitted diff beside each output in the maker's scratch.

1300-r3-invocation-red.log names the missing call/apply/Reflect.apply/bind forms and literal
import/alias origins. Static origins now include literal import namespaces, destructuring,
arrays, objects and conditional/logical/sequence aliases. Invocation normalization follows
the actual Function.prototype method receiver, bound this/prefix arguments and static apply
arrays. Effective arguments still have to match the reviewed program input. The first green
attempt missed the native literal-import default namespace; green-2 passes after canonicalizing
it to the same child_process namespace. invocation-receiver-red.log then exposes nested call
receivers; invocation-receiver-green.log passes with cycle detection on the entire invocation
state instead of rejecting a repeated method alone. An uncalled bound function is not booked
as an invocation.

1300-r3-shadow-red.log misses all twelve parameter/catch/inner-declaration shadow cells at
the four native sites. shadow-green.log passes after comparing the actual program argument's
lexical binding with the reviewed function parameter, including runCommand's command field.
A closure retaining that binding remains admitted. Native program parameters are also protected
against writes. 1300-r3-writes-red.log exposes loop heads and destructuring targets;
writes-green-2.log passes after walking assignment targets, rather than arbitrary pattern
expressions. The first implementation attempt wrongly treated a fresh lexical loop declaration
as a write to an existing input; writes-green.log retains that positive-control failure.
A loop's var head can write an existing function binding; its let/const head declares a fresh
binding. Native shadows remain checked independently by identity.

1300-r3-globals-red.log exposes admitted-global/prototype writes and their aliases.
globals-green.log passes after protecting their static origin identities, including node:url's
URL export, whose identity with the real global constructor the matrix observes directly.
The shared write walker handles loop heads, destructuring, delete and resolved Object/Reflect
mutators, including call/apply/bound invocations. It preserves member origins across module
exports. Locally shadowed globals remain local; caller-selected config targets remain admitted.
The only existing direct global-member write found in the production search is the gate's
complete conditional process.exitCode statement. Exactly that reviewed statement is admitted;
a changed or duplicated copy fails. No new global or built-in is admitted.

The pre-code coupling searches, complete call arguments and static-write inventory are retained
in 1300-r3-lands-in-search.log, 1300-r3-static-forms-search.log,
1300-r3-global-writes-search.log and 1300-r3-inventory-precode.json. Acorn measured 57 modules,
6015 call/new expressions, 618 static write forms and 277 import/re-export sites in the two-root
production closure, before guard implementation at 7f515453 with the pending main merge.
No additional production change or Lands-in path is needed. The final PR records committed-head
receipts for each of the five in-sight survivors and a separate program-loop mutation for the
write matrix's R-SAFE-2 claim, plus full deterministic/fresh-clone/host verification. All raw
outputs, including failed attempts, are retained; no failure is erased by a later pass.

The first correction commit, 3653977846739d512681e8406f87746b5ad7998b, passed its full
hook. The subsequent ordinary-alias check, 1300-r3-alias-store-red.log, exposes the same
static-origin class when a guarded function is assigned after declaration. The resolver now
unions static assignment sources, projects destructuring-assignment paths and follows static
object/namespace spreads. Its matrix includes all four forms and retains the effective-input
checks. It does not cache an incomplete traversal beneath an assigned alias cycle. These are
ordinary static alias origins under K13, within the same guard file; no new edge or production
path is introduced. Additional assigned/spread alias receipts accompany the five supplied
survivors at the final head.

The complete host tier at 860472911190cb4d43391c558483e134f0820629 then passed:
measured by npm run test:host in 1300-r3-host-final.log, tests 2780, pass 2752, fail 0,
skipped 28. That output is retained as a predecessor-head result. Before publication, the
same alias class needs the builtin default-export namespace too: Node v26.13.0 observes
node:url's default export URL equal to globalThis.URL. The matrix checks that identity live.
1300-r3-r4-default-red.log records four misses: default import, named default import,
literal-import default namespace and nested literal-import destructure. The matching green
is 1300-r3-r4-default-green.log. The existing builtin-default rule now applies to each
already-admitted builtin namespace, preserving the canonical URL member identity through
all four forms; it admits no additional builtin or global. No production default import
exists in the measured closure. This stays within K13's static-alias/global-member class.
The PR repeats all required verification and guarded receipts at the subsequent head.


## Static member-store revision, 2026-11-10

The [architect](https://github.com/williacj/rigger/pull/1331#issuecomment-6772894455)
and [reviewer](https://github.com/williacj/rigger/pull/1331#issuecomment-6775081920)
found that member assignment discarded the same protected identities that identifier assignment
retained. Their process, environment and prototype probes are ordinary static stores under
M8-K13. The architect also found that L3 could replace the configured step before its reviewed
forwarding call. These findings concern the guard introduced by this card, at
bf963af638f6b64b7e3677f35fafc30caad7f3fd; they do not claim a production network call.

The static-store matrix crosses literal/dotted assignments, object fields, nested members,
receiver/container aliases, destructuring/defaults, array rest, logical assignment, spread,
getters, arrays and a cyclic receiver with process, environment and admitted-global/prototype
origins. Ordinary local stores are positive controls. It parses counterexamples without
executing them. The first red, 1300-r6-store-red.log, fails dotted assignment/process starter/call.
The adjacent projection reds are 1300-r6-store-default-red.log and
1300-r6-store-rest-red.log. Each names the unchanged committed head above and retains the exact
uncommitted input separately. The rest run's producer log records exit 1; its execution-monitor
handle was unavailable after context compaction, a retained monitoring limitation.

The resolver collects member stores and resolves reads by the receiver's canonical origin.
Unknown lexical values keep their binding identity, so a dispatch environment remains the same
protected value after storage. Default and rest projections use the same path reader as
identifier assignment. Recursive stores do not populate caches from incomplete traversals.
This extends the existing static resolver instead of adding separate process/environment/global
alias lists. No additional production path is changed.

Private command, ref, input and output originals are retained outside scratch/temp roots in
/Users/cjwilliams/Github/rigger-worktrees/retained-evidence/1300/engineer-round-1-20261110.
The PR records completed verification and final-head mutation receipts; historical runs keep
their original heads and failed attempts remain in the ledger.

The configured-step matrix's [valid red](https://github.com/williacj/rigger/issues/1300#issuecomment-6779438946)
exposed forty substitutions at the same committed head. It crosses reassignment, spread/run
replacement, identifier/member/object aliases and mutators with the forwarding parameter, the
attempt's answer and the judge's selection. Parameter, catch and local shadows exercise the
actual operand bindings. Container and pure-reader replacements cover the path from L2's
answer to the reviewed forwarding call. Three closures retaining the original binding are
positive controls. An earlier fixture wrapped an inner call and changed the outer pinned
argument expression; that failed positive control remains recorded without red credit.

L3's local dispatchStep now belongs to the closed call inventory. Forwarded operands and
selected initializers must refer to their canonical pinned declarations. The configured
step, its answer/judge container and the local readers cannot be rewritten. The four existing
answer updates and the judge update remain admitted once, at their reviewed expressions and
reader bindings. Linked source pins protect the configured container rather than its unrelated
index dependency. No production loop or L2 policy is changed.

The first implementation refused thirty-eight cells; storing answer.step in another object
still lost the protected parent. Static members of opaque bindings now retain canonical parent
identity, and write protection follows that identity through further storage. The
[matching green](https://github.com/williacj/rigger/issues/1300#issuecomment-6780386675),
1300-r6-step-member-green.log, passes all forty cells and the unchanged-binding controls.
The PR keeps the exact command/input hashes and native results for each attempt.

The adjacent binding search found the same identity loss at a function declaration's own
identifier. The [copier-reassignment red](https://github.com/williacj/rigger/issues/1300#issuecomment-6782373025),
1300-r6-declaration-red.log, leaves gitEnvironment's reviewed declaration intact but conditionally
reassigns its binding to a copier that adds an environment key. The lexical model now records
the declaration identifier in its containing scope, so the existing protected-write check sees
that reassignment. This changes the shared binding model rather than adding a special ban for
that function name. The counterexample belongs to the existing bound-input matrix.


The receiver extension of the same store matrix exposed two further gaps before their fixes.
A [call-result receiver](https://github.com/williacj/rigger/issues/1300#issuecomment-6784593680)
lost a stored process origin. Unresolved call values now remain explicit possible receivers,
including conditional branches, so a known literal-member store cannot disappear at a read.
The subsequent [L3-environment red](https://github.com/williacj/rigger/issues/1300#issuecomment-6786152232)
showed that loop's incoming environment also needed a protected parameter identity. The shared
origin table now supplies that pin. The [focused green](https://github.com/williacj/rigger/issues/1300#issuecomment-6786317645)
reached all 360 refusal cells and 24 local-store controls; the measurement belongs to the
recorded dirty input, not to a later committed head.

Parsed modules are reused only while their source bytes match, and lexical models are reused
only for the same immutable parsed tree. The [full guard-file run](https://github.com/williacj/rigger/issues/1300#issuecomment-6786502691)
passes all twelve named cases after that cache refactor. These caches retain syntax and
bindings, not a prior policy verdict for changed source.


The upstream-carrier search extended that same configured-step matrix to eligibility, fresh
and cached claims, work, judge handoff/batch/retry, and the trigger's claimed input. Its
[red](https://github.com/williacj/rigger/issues/1300#issuecomment-6786823742) identifies all
fifty-six added substitutions as missed. The guard now pins the reviewed eligibility and
claim reader bodies and protects the selected work/judge/claim carriers. The existing
next.following transition remains admitted at its single reviewed expression.

A [planned green](https://github.com/williacj/rigger/issues/1300#issuecomment-6787166474)
instead failed the unchanged-package control: following every initializer argument protected
the shared undefined sentinel and unrelated writes. It earns no missing-behavior red credit.
Destructured carrier pins now select only judge or claimed and the reader binding; sibling
failures and notices remain mutable. The [matching green](https://github.com/williacj/rigger/issues/1300#issuecomment-6787202823)
passes all ninety-six configured-step refusal cases and the positive controls. No production
L3 function was changed.

Export lookup examines the module body's declarations, where JavaScript permits exports,
rather than walking every function body for each imported name. This retains the same export
and re-export policy while avoiding repeated searches of syntax that cannot declare exports.
The PR records the full guard-file verification after that refactor, final-head mutation
receipts, and all failed attempts in a separate evidence ledger.


Repeated source-shape comparisons now reuse the shape of the same immutable AST node or
expression text. Arrays and other mutable values are not cached. The
[full guard-file verification](https://github.com/williacj/rigger/issues/1300#issuecomment-6788072476)
passes all twelve named cases after that refactor. The cache stores syntax, not origin or
policy verdicts; each counterexample still parses its changed source and evaluates its own
protected-origin checks.


The first commit hook stopped at the repository-wide child-process census, which reads an
import inside the new native-origin fixture as a real import. The full output and the missed
pre-code coupling are retained in the [escalation](https://github.com/williacj/rigger/issues/1300#issuecomment-6788402164).
[M8-K19](https://github.com/williacj/rigger/issues/1293#issuecomment-6788445046) resolves that
conflict in this new fixture and leaves the census unchanged. The fixture now builds the
module specifier from parts. An independent syntax check confirms the emitted import is
byte-identical: native execFile from node:child_process, locally named fieldCommand. The
[affected-file run](https://github.com/williacj/rigger/issues/1300#issuecomment-6788651753) passes the unchanged census and all guard cases. This spelling
change preserves the native-origin matrix column; it admits no additional process boundary.

## Configured-step forwarding revision, 2026-11-11

The [argument-boundary counterexample](https://github.com/williacj/rigger/issues/1300#issuecomment-6790718404)
kept the reviewed carrier declaration but replaced its value in the call to attempt. The
[M8-K21 ruling](https://github.com/williacj/rigger/issues/1293#issuecomment-6792414299)
admits each existing bare carrier or exact reviewed selector at its forwarding position.
The dispatch also admits the exact existing producer expressions. Neither ruling changes
loop.mjs or puts it in Lands in. The correction remains in the guard introduced by this card.

The guard now inventories the upstream work, attempt, judge and claim forwarding calls,
including retry, callback and return transports. Each argument keeps its exact reviewed
expression and canonical source binding. Receiving parameters and destructures cannot supply
replacement defaults. The returned claim factory, mapped collections, retry iterator, local
L2 readers and their captured input bindings retain their reviewed forms and identities.
These are pins on the existing configured-value path, not additional production behavior.

The existing configured-step matrix crosses each forwarding site with replacement arguments
and modifies each admitted selector or producer. It also exercises parameter/destructuring
defaults, changed collection sources, returned transports and shadows of the reviewed reader
and built-in producers. A closure retaining its original binding and unrelated local Map
remain positive controls. The PR carries the complete source-hop inventory with file lines;
the search examines arguments and return expressions as well as callee names.

The precommit TDD runs name c96e6812e5faf0a32480c9e8bc571cce321e2011 and retain each
uncommitted input and its SHA-256. The forwarding red is 1300-r6-r8-forwarding-red.log;
the receiving-default red is 1300-r6-r9-defaults-red.log. The further transfer reds are
1300-r6-r9-transfers-red.log, transfer-bindings-red.log, factory-return-red.log,
return-boundary-red-2.log and iterator-return-red.log, with the same 1300-r6-r9 prefix.
The corresponding valid greens and full affected-file run are linked in the PR evidence
ledger. A failed implementation lookup, a positive-control failure and the first malformed
return-boundary fixture remain in that ledger without missing-behavior red credit.

The adjacent local-helper probe, 1300-r6-r9-helper-red.log, shows that a carrier passed to
a statically resolved local function could be rewritten through its parameter. The shared
write walker now propagates protection into that function's parameter bindings before
checking writes. This uses the existing invocation and binding models. Its matrix cells and
matching green belong to this correction; no reflective route or production helper is added.

Immutable AST entries and parent links are cached by parsed-tree identity. Changed source
still gets its own tree, origin computation and policy verdict. The final-head receipts,
proof comparison, hooks, host, fresh clone and CI are evidence owned by the PR; predecessor
verification is never relabeled as verification of the corrective commit.


## Deny by default, acceptance 124f2c3a8c06

[M8-U21](https://github.com/williacj/rigger/issues/1293#issuecomment-6802068956)
retires value tracking after six static alias and producer edits escaped it.
[M8-U22](https://github.com/williacj/rigger/issues/1293#issuecomment-6802465097)
sets the protected-name floor and the future inventory-row grant class. The rewritten card
supersedes K19 and K21 where they differ. Historical origin and forwarding tables, models,
matrices and their evidence above describe the retired implementation; none is retained as a
second admission route.

The merge of current main, e53b07ef, applied without conflicts. The ordinary pre-merge hook
measured tests 5893, pass 5893, fail 0, skipped 0 before committing b33b0c03. Its unfiltered
output is 1300-r6-deny-merge-main.log; uptime measured one-minute load 5.19 at start and
6.90 at end. npm ci then passed. Those are baseline measurements, not final-head figures.

The independent source scan at that merged input measured 58 closure modules and 499 Table P
mentions on 358 source lines. The earlier estimate of about 386 rows was a judgment from the
attack prototype. This inventory uses the final trimmed Table P and counts each source token
once, including shorthand/import/export nodes exposed twice by Acorn. Every row now holds its
exact decoded source-line text, mention count and a reviewed purpose. Identical lines use
separate rows. The line-number field is only a missing-entry diagnostic: it never admits a
mention, and a relocation control proves that unchanged text can move. An unlisted occurrence
is reported at its actual line. A missing entry reports its last reviewed position and text;
S11 removes its final protected mention without moving the line, and the fixture asserts that
changed position explicitly.

There is one literal reviewed-site table. Admission reads only file, exact line text, actual
mention count and an unused matching row. All identifiers, static property names, module names
and cooked string/no-substitution template values enter the same scan. No alias, invocation,
assignment, return or member-origin value is followed. N4 retains lexical scope analysis solely
to distinguish bound identifiers from unbound globals. The process-program fields are reviewed
declarations in N8's closed set, not inferred provenance claims.

The two process.mjs reader-option expansions belonged to the retired spread check. They are
removed: the revised N8 row needs no production repair, so production source now equals main.
The inventory pins the existing reader calls with their original option spreads. Ordinary
edits introducing protected mentions or changing reviewed lines still require visible rows.
The host observer and its real boundary proof remain unchanged.

### Table N at the current merge base e53b07ef

| Row | Held or needed a change under the revised card |
|---|---|
| N1 | Held: reviewed local built-ins only; native child_process is confined to host.mjs. Needed a new deterministic tripwire, not a source repair. |
| N2 | Held: static, re-export and literal-import closure is traversable from the two roots. Needed guard proof only. |
| N3 | Held: the sole nonliteral site is consumerConfig. Needed its named exception proof only. |
| N4 | Held: globals have the reviewed local purposes; lexical local bindings remain distinct. Needed guard proof only. |
| N5 | Held: no named hidden loader is used. Needed refusal fixtures only. |
| N6 | Held: no named eval or Function constructor is used. Needed refusal fixtures only. |
| N8 | Held under deny by default: the existing programs and configured shell input need no source change. The earlier reader expansions are obsolete and removed. Needed the literal inventory and closed-declaration check. |
| N9 | Out at base and head: credentialed tool internals, as the card states. No change. |
| N10 | Out at base and head: consumer provisioning contents under M8-U2 Q8 a. No change. |
| N11 | Held at the boundary: only the target config is loaded, and it is not traversed. Needed parsed-value, absent-root and special-path proof only. |
| N12 | Out at base and head: native addons; the card's package bound applies. No change. |
| N13 | Out at base and head: the card's runtime-computed, reflective and data-driven replacements. No value tracker is reintroduced. |
| N14 | Out at base and head: the account's NODE_OPTIONS under M8-U3. No change. |

### Table P at the current merge base e53b07ef

Each source row is reviewed, but the base has no protected-mention guard. Each class needed
the new deny-by-default proof and inventory; no class needed a production change.

| Row | Held or needed a change |
|---|---|
| P1 | Needed the runCommand mention gate, independent of its binding or later invocation. |
| P2 | Needed the native namespace/specifier/member mention gates; exec and its removed noise names are not protected. |
| P3 | Needed the env, environment and gitEnvironment mention gates. |
| P4 | Needed the engine environment gate through its env member, including cooked literal access. |
| P5 | Needed URL and __proto__ gates; prototype and the reflective helper names are not protected. |
| P6 | Needed configured producer, provisioning, step, run and command gates, including otherwise unrelated uses of those names. |

### Table S at the current merge base e53b07ef

All rows needed deterministic refusal proof: the base has no such guard. The fixtures are
copied literally from the revised card; each works on a copy of the actual closure. Checks use
independently specified changed-line offsets and names, including the missing-entry refusal
when S11 removes a line's last protected name. The guard never executes an attack's program.

| Row | Needed change and controlled counterexample |
|---|---|
| S1 | New refusal proof for the exact RA return/callback/class/Map/promise/environment/prototype fixture. |
| S2 | New refusal proof for the exact RB environment-return, for-of and Object.assign fixture. |
| S3 | New refusal proof for the exact RC step for-of, Object.assign and constructor fixture. |
| S4 | New refusal proof for the exact RD configured run declaration replacement. |
| S5 | New refusal proof for the exact RE native namespace returned by a function. |
| S6 | New refusal proof for the exact RF judge step-producer replacement. |
| S7 | New refusal proof for both given member-store and destructuring-default statements. |
| S8 | New refusal proof for the given spread step replacement before dispatch. |
| S9 | New refusal proof for the given template-member and both URL prototype routes. |
| S10 | New refusal proof for the given step producer return-line replacement. |
| S11 | New refusal proof for the given shell argument replacement, leaving no protected name on that line. |
| S12 | New refusal proof for the given shell program replacement. |
| S13 | New refusal proof for an exact native getter duplicated in a second exported object. |
| S14 | New refusal proof for both given escaped templates, matched on cooked env. |

### Table A at the current merge base e53b07ef

The real-dispatch observer is retained without changing its existing body. The final PR owns
the measured current-head host runs and guarded mutation receipts for that observer.

| Row | Held or needed a change |
|---|---|
| A1 | Held: both real/effective uid values come from the engine account. No source change. |
| A2 | Held: both real/effective gid values come from the engine account. No source change. |
| A3 | Held: supplementary groups equal the engine set. No source change. |
| A4 | Held: real native start options have no uid or gid. No source change. |
| A5 | Held: the four adapter path variables have the sources documented in the PR; other values are inherited. No source change. |
| A6 | Held: observed written work/scratch files have neither permission bit. No source change. |
| A7 | Out at base and head: the account's own grants. No change. |
| A8 | Out at base and head: the account's existing Codex auth link. No change. |

The first mention matrix red at command-start head b33b0c03 is
1300-r6-deny-mentions-red-2.log: all 395 in-scope name/form cells lacked the required P
refusal. The first invocation, deny-mentions-red.log, put a runner flag after the filename;
it was refused before a verdict and earns no red credit. Exact-count admission, missing-entry
refusal and one-occurrence capacity each have their own named red and matching green, in
1300-r6-deny-reviewed-, deny-missing- and deny-duplicate-{red,green}.log. The real-closure
positive test also failed while the inventory was empty in deny-real-closure-red.log, then
passed with the literal reviewed rows. These are dirty-input measurements at b33b0c03, not
final-head receipts. Exact input bytes, diffs, commands and producer/tee exits are retained.

The full affected-file run, 1300-r6-deny-affected-green.log, measured 29 named verdicts with
zero failures or skips, covering all eleven guard cases and the unchanged git spawn census.
No existing test line at e53b07ef is altered. The native import's literal uses ordinary
JavaScript quote escapes, so its decoded line is exact without the census's raw-text pattern
mistaking the fixture for a real import. No census or runner edit is required. The final PR
records the head-bound receipts, proof comparison, hook, whole-host, named-host, fresh-clone,
CI and body-check results. Earlier receipts keep their original heads and revised acceptance.


## M8-U23 and M8-U24: wrappers, process access and whole-text pins

The current acceptance is d9f71b0b31f5. The ordinary merge of main at 7a2c8f95
produced d2bd7d50 without conflicts. Its hook measured 5896 passing deterministic cases,
zero failures and zero skips (1300-r6-u24-merge-main.log). These revisions authorize
changes to this guard, not production repairs or a return to value tracking.

P7 derives enclosing functions from reviewed starter calls, then reviewed wrapper calls,
until no function or exported name is added. Declaration/import bindings distinguish a local
identifier from a wrapper. The exemption does not apply to keys, member names, module names
or cooked strings/templates. Thus terminal `.once` and signalling `.kill` candidates are
conservatively included when their spelling collides with a derived wrapper. N8 labels are
closed program-family declarations, not a claim that those terminal or signal calls start a
process. The actual empty set of starts at such a collision lies within its declared bound.

The diagnostic AST search at dirty d2bd7d50 measured 58 closure modules, 98 named wrapper
records, 923 reviewed lines and 1330 mentions. It found 177 call/new candidates on 168
physical lines; the retained search includes every complete argument expression, including
nested calls. The PR records the same measurements and line references at the committed head.
All added inventory lines were read and given a reason. The inventory is still literal and
its admission keys are file, exact line text, mention count and unused entry capacity.

P8 admits only listed literal members of process. Bare process, aliases, destructuring,
reflective reads and unknown members fail. N4 continues to refuse computed access on the
global object itself. P9 protects the seven carrier names the owner listed. Four pins cover
exact parser statement ranges, including export and internal comments, excluding leading
comments. The packaged process-table.sh has a whole-file pin. A duplicate is diagnosed even
when duplicate exports make the JavaScript module invalid; copies inside comments do not
consume a pin. The character matrix changes each character of a fixture statement and file,
and samples every real pin against independently checked parser ranges.

The first semantic reds at dirty d2bd7d50 are u24-P9-red, u24-P8-mentions-red,
u24-P7-red, u24-N8-wrappers-red, u24-pins-red's changed-character assertion and
u24-S28-red's S15 assertion. Their complete 1300-r6-prefixed logs, exact input bytes,
commands, diffs and producer/tee exits remain retained. The duplicate-export SyntaxError in
the first pin run earns no semantic red credit. u24-P8-access-red used an invalid positive
fixture against N4, and u24-P8-access-green exposed an old bare-global.process positive;
neither earns red credit. They were corrected to the card's P8/N4 contract. The first pin
green attempt exposed an unchanged x-to-x script fixture byte; the corrected fixture changes
every byte. No failing test body was deleted. The final affected-file run measured 31
passing named verdicts, zero failures and zero skips (1300-r6-u24-final-named.log).

### Row disposition against the current merge base 7a2c8f95

"Needed guard" means new tripwire/refusal proof, with production source holding at the base.
No row needed a production change under the current card. Prior source changes and evidence
remain historical; the current PR has no production delta.

| Row | Held or needed a change |
|---|---|
| N1 | Held local built-ins and host-only native import; needed guard. |
| N2 | Held traversable static and literal-import closure; needed guard. |
| N3 | Held the one consumerConfig exception; needed guard. |
| N4 | Held the named globals and lexical distinction; needed guard. |
| N5 | Held absence of hidden loaders; needed guard. |
| N6 | Held absence of eval and Function; needed guard. |
| N8 | Held closed tool families and configured shell input; needed wrapper-call declarations and the new guard/pins, with no source repair. |
| N9 | Out: tool internals, unchanged. |
| N10 | Out: consumer step contents, unchanged. |
| N11 | Held target-only consumer loading; needed parsed-value, absent-root and special-path proof. |
| N12 | Out: no shipped native addons; unchanged. |
| N13 | Out: the card’s computed/reflective/data routes; unchanged. |
| N14 | Out: account NODE_OPTIONS; unchanged. |
| P1 | Needed guard for runCommand. |
| P2 | Needed guard for native starter names and namespace. |
| P3 | Needed guard for dispatch environment names. |
| P4 | Needed guard for the engine env member. |
| P5 | Needed guard for URL and __proto__. |
| P6 | Needed guard for configured producers and step/program names. |
| P7 | Needed fixed-point wrapper derivation and scoped identifier exemption. |
| P8 | Needed listed literal process-member checks. |
| P9 | Needed guard for all seven named program/options carriers. |
| S1 | Needed exact fixture refusal proof for RA returned/callback/class/Map/promise origins; no production change. |
| S2 | Needed exact fixture refusal proof for RB environment carriers; no production change. |
| S3 | Needed exact fixture refusal proof for RC step carriers; no production change. |
| S4 | Needed exact fixture refusal proof for RD configured run declaration; no production change. |
| S5 | Needed exact fixture refusal proof for RE native namespace return; no production change. |
| S6 | Needed exact fixture refusal proof for RF judge step producer; no production change. |
| S7 | Needed exact fixture refusal proof for member store and default; no production change. |
| S8 | Needed exact fixture refusal proof for spread step replacement; no production change. |
| S9 | Needed exact fixture refusal proof for template env and URL prototype routes; no production change. |
| S10 | Needed exact fixture refusal proof for step producer return replacement; no production change. |
| S11 | Needed exact fixture refusal proof for shell argument replacement; no production change. |
| S12 | Needed exact fixture refusal proof for shell program replacement; no production change. |
| S13 | Needed exact fixture refusal proof for native getter object; no production change. |
| S14 | Needed exact fixture refusal proof for escaped templates; no production change. |
| S15 | Needed exact fixture refusal proof for duplicate step args; no production change. |
| S16 | Needed exact fixture refusal proof for pre-merge set environment write; no production change. |
| S17 | Needed exact fixture refusal proof for new asked caller; no production change. |
| S18 | Needed exact fixture refusal proof for runCommand args rewrite; no production change. |
| S19 | Needed exact fixture refusal proof for process.execve; no production change. |
| S20 | Needed exact fixture refusal proof for process.loadEnvFile; no production change. |
| S21 | Needed exact fixture refusal proof for new startsIn caller; no production change. |
| S22 | Needed exact fixture refusal proof for host lsof program; no production change. |
| S23 | Needed exact fixture refusal proof for yield tool replacement; no production change. |
| S24 | Needed exact fixture refusal proof for spread host ps override; no production change. |
| S25 | Needed exact fixture refusal proof for PS_ENV preload; no production change. |
| S26 | Needed exact fixture refusal proof for dispatch args rewrite; no production change. |
| S27 | Needed exact fixture refusal proof for process alias; no production change. |
| S28 | Needed exact fixture refusal proof for process destructuring; no production change. |
| A1 | Held real/effective uid equality; no source change. |
| A2 | Held real/effective gid equality; no source change. |
| A3 | Held supplementary group equality; no source change. |
| A4 | Held absence of uid/gid native options; no source change. |
| A5 | Held adapter paths and inherited values; no source change. |
| A6 | Held absence of either set-id file bit; no source change. |
| A7 | Out: account grants, unchanged. |
| A8 | Out: existing owner auth link, unchanged. |

### Adjacent search and the owner’s stop rule

U24 Q56 accepts a value reaching a reviewed sink through an unprotected carrier as a known
limit. The search found mutable git/args carriers immediately before the reviewed workspace
runCommand call; reader returns options spread into reviewed census starts; and forge runner
send parameters default to throughL0 but are distinct declarations. These are recorded limits,
not value-flow claims or reasons to add names or pins beyond the card. The PR records their
current source lines and guarded guard-only observations. Attack code is parsed, never called.

The final-head receipts, proof comparison, hook, full and named host checks, fresh-clone
verification, CI, and body checker are recorded in the PR after the one implementation push.
