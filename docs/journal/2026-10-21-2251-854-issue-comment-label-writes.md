ABOUTME: Records card 854's issue-comment and one-label repository writes and their verification.

# Card 854: issue comments and label additions

The dispatch base was `72e488ff5fe0ca2ecee7c74b38fe17a807c27d8e`, the committed
#851 baseline repair. The live #854 acceptance admitted M6-04a as a prerequisite for
#849. This work delivers its repository-write operations; it does not complete the
remaining M6 workflow prerequisites.

`postIssueComment` appends a body to an ordinary issue or the issue behind a pull
request. `addIssueLabel` adds one label without replacing existing labels. The
repository runner admits their explicit POST shapes without selecting workflow
labels. The existing `postComment` adapter owns its PR preflight and remains
PR-only. Named failures preserve an originating error's code and cause. The
README Security list names the admitted card-issue writes.

The fake repository and fake `gh` model both writes beside their existing reads.
Comment bodies remain data; label additions preserve unrelated labels and do not
duplicate a held label. Scripted HTTP refusals leave held issue state intact.
The existing runner-only refusal test changes under acceptance grant G1. Fake
state and command-map changes use G2. Other existing test assertions, merge
behavior, verdict fixtures and suite machinery are unchanged.

## TDD evidence

Measurements below used Node v26.12.0 on Ubuntu/WSL, from the dispatch base with
the named test additions and then their minimal implementation. Logs are retained
under this worktree's ignored `.tmp/` directory. They are evidence for this run,
not another source of repository behavior.

| Slice | Observed failure before implementation | Green evidence |
|---|---|---|
| Runner issue comment | `854-comment-red.log`: ordinary issue rejected by PR preflight | `854-comment-green.log` |
| Fake issue comment | `854-fake-comment-red.log`: ordinary issue returned 404 | `854-fake-comment-green.log` |
| Explicit adapter comment | `854-adapter-comment-red.log`: missing operation | `854-adapter-comment-green.log` |
| Runner label addition | `854-label-runner-red-recorded.log`: label POST refused | `854-label-runner-green.log` |
| Explicit adapter label | `854-adapter-label-red.log`: missing operation | `854-adapter-label-green.log` |
| In-process fake operations | `854-model-comment-red.log`, `854-model-label-red.log`: missing operations | Corresponding `-green.log` files |
| Fake label command | `854-fake-label-red.log`: command not modelled | `854-fake-label-green-recorded.log` |
| PR confirmation | `854-preflight-red.log`: malformed SHA incorrectly accepted | `854-preflight-green.log` |
| Thrown transport errors | `854-write-errors-red.log`: missing operation and target | `854-write-errors-green.log` |
| Existing PR-preflight diagnosis | `854-preflight-diagnosis-red.log`: lost the existing did-not-confirm diagnosis | `854-preflight-diagnosis-green.log`, plus unchanged verdict test in `854-verdict-confirmation-green.log` |

One label-form hypothesis was rejected: real `gh` sends `labels[]=` as a one-item
array containing an empty string, while `labels[]` sends an empty array. The
rejected hypothesis is retained in `854-gh-empty-label-hypothesis-rejected.log`
and is not counted as a product defect. The final local proxy probe checks the
observed distinction and refuses the empty-array request shape. The first fake
label handler attempt also stayed red because its command key still retained the
dynamic label value; the green command-map normalization is recorded separately.

## Verification

`npm test -- test/forge-runners.test.mjs test/forge-adapter.test.mjs
test/forge-contract.test.mjs test/fake-gh.test.mjs` measured 246 passing tests,
zero failures, cancellations or skips, in 107219.047636 ms before the subsequent
PR-preflight wording correction. This includes the installed `gh` 2.46.0 probe through the existing isolated
local-only HTTP proxy: both new forms send POST with their intended JSON payload.
No live forge write is used as test proof.

The nine ordinary package/instruction budget, specification style, document
reference, path, ID, wording, header and test-matrix checks each exited zero.
Request-shape and invalid-target tests record no requests on refusals. PR
preflight failure tests record the read but no comment. Returned HTTP refusals,
transport failures, timeouts and thrown errors are distinct test cells.

The first normal full-suite hook measured 4155 tests: 4101 passed, one failed,
53 skipped and none cancelled, in 600052.814224 ms. Its sole failure was the
existing verdict-forge confirmation-read test: moving the preflight had lost the
old runner's did-not-confirm diagnosis. The adapter now retains that diagnosis
and the actual read reason. An additive adapter regression failed before that
correction and then passed; the unchanged existing verdict test also passed.
The refused commit made no commit and no push. Its original hook evidence is
retained as `.tmp/854-first-commit-hook.log` before the complete hook is retried.

The normal commit hook runs the complete ordinary suite under the host's shared
verification lock before this patch can be committed. Its launcher records its
PID before waiting for that lock and retains the hook output and exit status in
`.tmp/854-commit-2-hook.log` and `.tmp/854-commit-2.exit`. The pushed head still needs
the configured independent reviewers, forge checks and the owner's head-bound
marker for its README contract change.
