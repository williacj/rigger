ABOUTME: Records the instruction-only receipt retention and child-status guidance for #1121.

# Evidence retention and tested-command status

Inspected base: `0a04fab85373a8d6855d783c991d26fb1a584c1a`, the main snapshot containing
#1118's merged instruction changes. Work followed #1121's revised twenty-two-item acceptance and its
independent pre-implementation attack. This entry makes no claim about what caused historical
receipt loss and does not reconstruct historical test outcomes.

Changed instruction paths are `.claude/skills/acceptance/SKILL.md`,
`.claude/skills/tdd/SKILL.md`, `.claude/skills/code-review/SKILL.md`, their matching
`templates/claude/skills/` copies and `docs/host-bootstrap.md`.

The acceptance skill names the retention event. The shipped TDD skill owns the complete
mandatory receipt procedure, and code-review references its sibling TDD skill. The bootstrap
guide is an optional worked example. The three matching template skills carry identical bytes. Only the granted existing paragraphs changed. The adjacent review denial and
owner-exception procedure remains intact.

The bootstrap procedure separates disposable fixtures from private retained originals, keeps
receipts through the final independent ruling or the card's longer event, and requires readback
after command completion and fixture teardown. Its literal child script records each tested
command's exit before another command can overwrite it. Launcher status is retained separately;
missing child status and unreadable originals receive no proof credit. Private evidence stays
private, with only permitted summaries shared.

Baseline verification on the inspected base used Node v26.12.0 in WSL Ubuntu:

- `npm ci --offline`: actual child exit 0.
- `npm test`: actual child exit 0; 3,964 tests, 3,955 passed, nine skipped, zero failed or cancelled.

The command, ref, output and child-status originals were saved outside the worktree and reopened
after the suite completed. These are baseline results, not final-head or supported-macOS proof.

Handoff verification commands are `npm test`, `npm run matrix:check`,
`npm run budget:instructions`, `npm run check:references` and `git diff --check`. Actual artifact
inspection uses `npm pack --ignore-scripts --json --pack-destination` with private artifact
storage, then reads the changed templates from that tarball and resolves the sibling TDD
reference within the packed provider-skill tree. The packed source ref and artifact identity
are retained with that proof.
Results are retained separately with the reviewed head; this journal does not substitute for
those receipts. A literal child script exiting 7 was used to check the verification wrapper;
the durable tested-child receipt was reopened as 7 rather than credited as wrapper success.
The first portable candidate passed the deterministic and static checks before a compact wording
correction made the maker-report context distinction explicit. Its receipts remain prior-candidate
evidence. The normal commit hook and a fresh final-head run verify the corrected bytes.
No runtime, test body, requirement, architecture, decision or CI workflow changed.
