ABOUTME: The dispatch-root path-rule fix, controlled red and green evidence, and owner live-proof handoff for card #1425.

# Dispatch-root path rules

Card #1425, acceptance revision `0d91850d15a3`, places the path-rule change in the Claude provider
adapter and the escalation wording in workflow. M8-U63 on #1293 approved R-SAFE-10 through spec
PR #1427, merged at `6be13718`. The coordinator resumed this maker after that merge and the PM
updated the claim item. This branch claims the registered requirement; it does not author it.

The coordinator's transcript investigation on 2026-11-18, quoted in #1425's Evidence section,
measured Emend #1417's dispatch `d-02d18ec4` for #105 moving its shell into `src-tauri`. Root Edit
and Write calls, including `.rigger-escalation.md`, then received "you haven't granted it yet";
files under `src-tauri` remained writable. Emend #79's session, whose shell stayed at the root,
could edit the root. These are the coordinator's historical measurements, not new live runs by
this maker.

The adapter anchors declared relative Read and Edit allows and denies at the dispatch directory's
real path, using its existing per-rule path mapping. Reached-directory grants and deny copies
remain. A generated rule needs a path inside the existing PLAIN character set. The escalation
instruction names the directory the session started in for both the note and the unchanged
posting command. It names no provider tool.

Before code, the Lands in search covered every listed path. The source-text binding in
`test/network-boundary.test.mjs` admits line shifts and its protected lines stay byte-identical.
The affected prompt comparisons are already in scope under G2. The relative-deny expectation
changes under G1. No additional existing test line needs a grant.

On the branch's base, `npm ci` succeeded and the deterministic baseline reported tests=5958,
pass=5958, fail=0. The suite-slot log recorded load 2.70 at start and 5.91 at end, status 0,
duration 498 seconds. The base was `18e4f016a31c2f2b0bad01914b525afda9e3fcf0`; TMPDIR was the
external `codex-1425-tmp` directory. The affected host baseline reported tests=17, pass=1,
fail=0, skipped=16 with live sessions gated off.

The first root-allow test failed on its missing absolute Edit grant. The next root-deny test
failed on its missing anchored .env and secrets rules. Both passed after their implementation.
The unsafe-path test failed with "Missing expected rejection" before the refusal was added.
Its first subsequent run exposed an incorrect test assumption: the provider's startFailure
adds startCause, while NOT_STARTED belongs to the execution layer. Checking the documented
provider startCause contract then passed. The instruction test failed because the note location
still named the current working directory, and passed after the wording changed.

The affected controlled run reported tests=150, pass=150, fail=0, including the existing
network-boundary source bindings. Complete logs are retained in `codex-1425-tmp` with the
`1425-` prefix. The head's gated host run reported tests=23, pass=1, fail=0, skipped=22; that
is harness evidence only. It supplies no live CLI result.

Six gated live cells in the existing Claude live file cover root Edit, root Write, subdirectory
Edit, outside Write refusal, root .env deny, and the instructed escalation after `cd sub`.
Each records the tool calls and results before target assertions, checks the same session's
`pwd`, and retains raw streams and stand-in forge state outside suite teardown. Each session
uses invocation's environment plus test-made Claude and gh configuration directories and a PATH
beginning with the stand-in gh.

The owner must run the head and merge-base live commands supplied in the PR, with the head's
live file against the base's source for the latter. The maker has not run those sessions: #1385
reserves this authentication boundary for the owner's Terminal. Their dates, Claude Code version,
measured root denial at base and allowed behavior at head remain pending. This card is not
finished until those results are supplied and recorded, the matrix is regenerated against the
merged requirement, and the independent judges rule on the resulting head.

The subsequent full deterministic run, saved as `1425-full-head.log`, reported tests=5964,
pass=5962, fail=2, status 1. The suite-slot log recorded start load 3.05 and end load 3.44,
duration 545 seconds. One failure was the committed-matrix test calling the checker and refusing
the pending R-SAFE-10 declaration. The other was the existing R33 malformed-permission fixture: copying
a rule now happened before the guarded compound-rule read, so its error lost startCause. Guarding
the copy with the same claude-rule-unreadable cause restored the existing boundary. Its focused
run (`1425-rule-cause-green.log`) then reported tests=1, pass=1, fail=0, and the affected controlled
run (`1425-controlled-final.log`) again reported tests=150, pass=150, fail=0. No existing line
in the environment-retry fixture was edited.

The matrix dependency also prevents a green npm test, not just matrix:check. AGENTS.md requires
green deterministic verification before committing, so the maker stopped as ambiguous at
that boundary, reporting the dependency on #1425. No commit or push bypassed the green-suite rule. The clone and scratch directory are retained under
the dispatch's cleanup override.

On resumption, `git fetch origin` resolved main to `6be13718` and `git merge --ff-only origin/main`
advanced the branch without a rebase, conflict, or loss of local changes. The source and tests
were unchanged by that dependency merge. `npm run matrix` regenerated the claims and
`npm run matrix:check` passed, reporting 7 of 255 requirements without a test. The live proof
remains reserved for the owner; the PR supplies exact commands for the committed head and for
that head's live file against merge-base source.

After the dependency merge and regeneration, `1425-full-registered.log` reported tests=5964,
pass=5964, fail=0, exit 0. The suite-slot log recorded start load 2.54, end load 4.91 and
duration 465 seconds. This resolves the registration blocker and includes the R33 restoration.
The owner live measurements are still pending and are not represented as passed by a gated run.
