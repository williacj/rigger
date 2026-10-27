ABOUTME: Records card 976's disposable mutation receipts, per-test proof reports and verification procedure.

# Mutation receipts and proof comparisons

Card [#976](https://github.com/williacj/rigger/issues/976), acceptance revision
`956283da600f`, asks for mechanical evidence of a mutation and a new test's distinction between
the merge base and the committed head. The coordinator confirmed a manual dispatch. The PM's
G1 permits the host-list additions needed to exercise real child processes.

`mutation:receipt` checks an unmutated run before applying a literal, counted replacement in a
temporary worktree. It reports source readback, the Git diff, reported test counts, named errors
and assertion failures. A timeout, missing test verdict, file-only verdict, skip or cancellation
cannot become a successful mutation claim. Check 4 remains the maker's statement.

`proof:diff` overlays the committed head's whole test tree on the merge base, then compares
individual outcomes with the committed head. A base failure can prove a distinction; a base
import failure cannot. Repeated test titles retain separate outcomes. Both scripts resolve
packages through the caller's installation and report parsed dependency declaration differences.

The scripts share worktree execution and a Node event reporter through `mutation-receipt.mjs`.
They invoke the actual suite, including its host placement and refusing forge tools. The existing
process adapter bounds execution and contains its children. Each integration invocation compares
the fixture checkout's files, including dirty and untracked files, its worktree registrations
and its temporary directory before and after the command.

Tests were added one behaviour at a time. Complete named-run logs are retained outside the
checkout under the dispatched TMPDIR. The first cancellation fixture hung instead of producing
a cancellation; an explicitly aborted runner signal supplies the corrected premise. A Buffer
conversion error and an empty-pattern diagnostic regression were also exposed and corrected.
The PR retains those attempts alongside the intended reds and the guarded mutation evidence.

The commit hook caught two worktree-list reads outside the canonical Git fixture. An independent
review confirmed the minimal correction: reuse its existing `worktreeList` helper at both sites.
The guard remains unchanged; the corrected fixture and full hook are verified before delivery.

Measured with the repository tools on 2026-10-26: the deterministic baseline at
`5ebc4f04cd2f9e4ea63d0cf4fd30e51452c0f034` passed with tests=2955, pass=2955 and fail=0.
`npm run budget:instructions` measured the base live pool at 14,778 words and the completed
working-tree additions at 14,806, a delta of 28. The maker prompt adds 19 words and its tdd
instruction adds nine. The two distribution copies remain byte-identical to their live files.

The final-head full-suite, affected-host, fresh-clone, CI and guarded mutation evidence belongs
in the PR body. No requirement declaration is added: the card's Claims field is none. G1 changes
only the host list and its expected enumeration; neither transitional list grows.

## Round 2: assertion evidence at the base

The [architect](https://github.com/williacj/rigger/pull/992#issuecomment-6434959017)
and [reviewer](https://github.com/williacj/rigger/pull/992#issuecomment-6435082258)
found the same classification fault: a named runner failure was enough to claim a red base.
A dynamic import can fail before its assertion; a setup hook can fail before the body runs.
The original top-level missing-import test did not distinguish these named failures.

The module-not-found regression was written and observed red first, then its minimal fix went
green. The failed-hook regression followed, using an AssertionError in the hook around a constant
body assertion; it too was observed red and then green. An unfamiliar prerequisite error gave
the no-verdict row's catch-all its own red. A separate red showed that an ordinary Error carrying
ERR_ASSERTION was still insufficient evidence. The final policy requires testCodeFailure with
an AssertionError cause carrying ERR_ASSERTION. Other named failures preserve their runner type,
error class, code and message in baseReason. A missing named result has an explicit reason.
The per-test classification keeps a neighboring genuine assertion proof independent.

The inventory script parses the executing Node runtime's embedded sources with Acorn. It searches
all ERR_TEST_FAILURE constructions and failureType assignments, including constructor arguments,
conditional status selection, and the process-event handler callers. On 2026-10-27, Node v26.12.1
exposed 12 concrete failure types. The retained inventory includes source hashes and line numbers;
the PR quotes the script, search and output. Skips, todos, absent named results, file-only verdicts,
setup/cleanup exceptions, harness refusals and outer timeouts are also traced through both scripts.
Only the named assertion case is eligible; an unknown type or cause defaults to non-proving.
Table A's explicit non-assertion receipt behavior is unchanged.

The affected host baseline at cda56d0b070906211a572370f65452fb1f79c42d passed with tests=27,
pass=27 and fail=0. After the five added cases, the affected files passed with tests=32,
pass=32 and fail=0. Full unfiltered red and green outputs, commands and load observations remain
in the dispatched scratch directory. No existing test body was rewritten. Final-head suites,
guarded mutation receipts and fresh-clone results are recorded in the PR rather than predicted here.

## Round 3: registration identity and original assertion class

The [architect](https://github.com/williacj/rigger/pull/992#issuecomment-6436265778)
showed that title and occurrence can pair a passing constant test with a different registration's
base assertion failure. The [reviewer](https://github.com/williacj/rigger/pull/992#issuecomment-6436525365)
found the same assertion-classification fault still present in mutation receipts. Both findings
are within the existing tables; their fixes share the runner metadata already collected here.

Before editing, a script searched both tools and the executing Node runtime for identity fields,
directives, failure constructors and error serialization. The PR preserves the script, hashes,
search hits and the ten requested input classes. Node v26.12.1 transports test and parent ids,
source files and positions. It serializes Error getters before replacing custom prototypes with
ordinary Error prototypes. A comparison of the transported code or name therefore cannot prove
that the worker threw an AssertionError.

Each comparison now uses its entry file and an array of registration names, files, lines and
columns through its entire ancestry. Runner ids connect parents within one run, never across
refs. A missing source position, missing ancestry, repeated leaf identity or repeated ancestor
identity supplies an explicit non-proving reason. A unique leaf alone is insufficient: two
indistinguishable parent registrations can each supply that leaf at different refs.

A per-run private property key lets the worker's Error getter record the original
`instanceof AssertionError` result before Node serializes it. The reporter combines that result
with the testCodeFailure stage. Both tools consume that one classification, so copied code,
name, actual and expected fields do not earn assertion credit. Non-Error causes are rendered by
type and inspected value, including null, symbols and cycles. A hook, interrupted runner or
other non-test failure cannot become a successful receipt. Empty skip and todo reasons retain
their directives rather than becoming completed verdicts.

The duplicate-title, nested-suite, colliding-registration, duplicate-parent, forged-fields,
empty-todo, empty-skip, hook, null-throw and missing-location cases each exposed a named assertion
red before its fix. Already protected load, runner-timeout and cancellation cases were added
individually, observed green, and deliberately broken by guarded mutations before proceeding.
The closing catch-all has its own unknown-value and non-test-status coverage; separate identity
cases discriminate file, parent-name and parent-position matching. Development guards restore
the exact pre-guard working bytes; the PR separates those records from final committed-head
mutation receipts and retains every failed run.

Measured on 2026-10-27 through the prescribed slot: the starting head
6289b435b2f656c082b2661e04593463fdd0b7b1 passed the deterministic baseline with tests=3331,
pass=3331 and fail=0. Its affected host baseline passed with tests=32, pass=32 and fail=0.
After these appended cases, the affected working-tree files passed with tests=48, pass=48 and
fail=0. No existing test body, instruction, template, tier or package entry changes this round.
Final-head full-suite, fresh-clone and guarded mutation results are recorded in the PR.
