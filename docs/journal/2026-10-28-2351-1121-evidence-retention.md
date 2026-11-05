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


## Continuation of 2026-10-31

Inspected baseline: `fe4782a370e96ebc3bfbadb8b1bd468cb79bd5b1`. Ordinary integration commit: `b99443445a4feea6f7380357e8e6a462dd259ef7`. This continuation preserves the historical entry above and the existing eight instruction and journal paths. The adopted twenty-two-item acceptance and G1-G4 remain the boundary.

The current-main instruction text outside the admitted receipt paragraphs is preserved. Live and template acceptance, TDD and code-review skills remain byte-identical. The measured candidate live instruction pool is 15,300 words using the instruction-budget whitespace definition on the actual candidate bytes; this measurement gives no credit to unmerged work.

Verification uses `npm ci --offline`, `npm test`, `npm run matrix:check`, `npm run budget:instructions`, `npm run check:references`, `npm run check:headers`, `npm run check:words`, `npm run preflight -- --body-file <retained adopted body>`, `git diff --check`, and `npm run test:host -- test/init.test.mjs test/package.test.mjs`. The standalone pre-integration-commit deterministic command exited zero. Final-head outcomes belong to retained receipts at their actual source, not this entry.

Actual artifact inspection uses default `npm pack --json --pack-destination <private retained artifact directory>`, including the package prepack procedure. The proof checks the recorded package commit, changed template bytes, complete mandatory procedure and sibling-reference closure within the packed provider-skill tree without repository-only documents. The tarball and complete command/ref/status originals remain in private custody through final independent ruling and are reopened after producing commands and disposable inspection teardown.

Historical receipt-loss causes and Mac failures remain unresolved historical context; this continuation supplies no repair or retroactive pass credit. Local unsupported-host limits remain explicit until current supported-host CI supplies proof. No runtime, test body, requirement, architecture, decision or CI workflow changes.
