ABOUTME: Records #1237's repository-only Codex mode, test-first evidence, grants and live proof order.

# Repository Codex mode

Card #1237, acceptance revision e3dfa826b598, was read at merge base
368e7e1789af4bb3877dcb4225cdde081199cd8e, which contains #1230's merge.
M7-U42 authorizes this repository's declaration; the consumer template remains byte-identical.
The changed Self-hosting path, `.codex/config.toml`, requires the owner's marker.

This repository's engine-run Codex makers and judges run unsandboxed. They no longer exercise
the shipped declaration. The template's existing live runs continue to exercise workspace-write.
Process-table reads and setuid execution becoming available under workspace-write would reverse
this repository's choice. The workspace-write table is inert under danger-full-access.

## Test-first sequence

The deterministic baseline ran first through the host-wide slot. Its saved output measured
5,154 tests, all passing, at the merge base. The affected host file then exited 0 with its six
live tests skipped. Originals are retained on the Mini under
`/Users/cjwilliams/Library/Logs/rigger/1237-evidence`; the PR supplies the commands and summaries.

The new diagnostic ran before the declaration changed. On 2026-11-08 at 02:52 UTC,
`RIGGER_LIVE_CODEX=1 npm test -- --host --test-name-pattern='repository Codex declaration' test/provider-codex-live.test.mjs`
failed on `/bin/ps must exit 0 under this repository declaration`. Its child result held
`exit: null` and `error: "spawnSync /bin/ps EPERM"`, and its rollout held workspace-write.
The retained originals are `process-table-e6baf4db-38ff-42cd-8e90-eda74b361635`.

The same diagnostic next took danger-full-access as its input. Its rollout recorded that mode,
and its real `/bin/ps` child exited 0. Thus S1 and S2 passed before S3 could start.
The retargeted declaration test then failed against the original repository configuration on
`../.codex/config.toml must declare one danger-full-access sandbox`.
After the configuration edit, the diagnostic passed without an input override, and all 33
maker-git tests passed. These figures are measurements from the named local output files,
not estimates of coverage.

For the reviewed-head evidence, the live run order is S1/S2, S3, S4, S5, then S6.
The driver runs from an installed tarball outside the target clone. The maker runs `npm ci`
before S3's full suite, then commits through the active repository pre-commit hook for S4,
then pushes through pre-push to a local bare origin for S5 in the same session.
The judge reads the declaration in `main`, provisions `head` with `npm ci`, and tests in `head`
for S6. Full suites and the hooked git operations use the host-wide slot. The PR records the
reviewed head, exact commands, child exits, load figures, invocation arguments and retained
rollouts. Original command output, rather than a session's answer, supplies the evidence.

## Scope and grants

Before code, a search through `test/` for every Lands in path found the declaration check and
the existing path-only Self-hosting and suite-tier checks. No additional coupled path needed
an edit. At the merge base, grant class 1 covers the changed existing lines 349, 350, 351 and
356 in `test/maker-git.test.mjs`: the comment, title, path/value pairs and assertion.
Both files retain an exact, single active top-level sandbox-mode check.
The other test changes are insertions only.

The new test carries no proves declaration: it diagnoses this repository's own configuration,
which the requirements preamble places outside product requirements. R-WORK-42 concerns the
consumer settings and remains covered by the existing template-based maker test.
The new diagnostic observes OS behaviour, rather than a decision Rigger makes; its guarded
mode-reversion mutation and receipt belong in the PR evidence.

No case outside Table S was met under S13 during implementation. Final-head verification and
any failed or unavailable attempt remain explicitly accounted for in the PR's evidence ledger.


## Continuation after the main-line fixture repair

The affected live host run at the initial card commit stopped on the existing judge fixture's
unstamped dispatch id. Its complete output and missing raw-rollout status remain in the attempt
ledger. The coordinator routed that failure to #1277, whose PR #1278 merged as
95b40c383b8b53ff06d51c1328d0ee9ca2386da9, then explicitly instructed this maker to continue.

The branch incorporates that main line with a normal merge commit. Both sides added the same
randomUUID import; the merge keeps the main line's import and removes this card's duplicate.
The diagnostic's body and the declaration checks do not change. The merged main line also
strengthens mutation receipts to retain the selected suite's native ending (#1270).
Consequently, all seven mutation receipts are rerun at the merge head rather than carried
forward as final-head proof. The original failing-test-first runs remain historical evidence.
The affected live host file is rerun before S3 starts, then S3, S4, S5 and S6 follow in order.
