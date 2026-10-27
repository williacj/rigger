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
