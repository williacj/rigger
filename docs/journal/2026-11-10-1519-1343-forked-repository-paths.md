ABOUTME: Records the repository paths found in init's forked assets and how card #1343 handles them.

# Forked repository paths

Card #1343, acceptance revision `d68d29f15466`, bounds the class and permits no requirement
claim under M8-K16. The content check reads the full pinned `init` plan in process, including
the forge workflow. It uses the passage units already used by the command check.

An in-process scan of every planned file at the proposed head's merge base,
`cd181d6f7a75f0c549106d24c390635cc60f6758`, found these eight members. The unchanged new test
ran against that base and failed on all eight before resolving the integration conflict.

| Forked file | Member at the base | Treatment |
|---|---|---|
| `.claude/skills/spec-style/SKILL.md` | `scripts/spec-style-lint.mjs` | Conditioned on the repository defining it. The paragraph still specifies the lint's scope and which rules it checks. |
| `.claude/skills/tdd/SKILL.md` | `test/package-budget.test.mjs` | Conditioned; the tool-authority rule and worked example remain. |
| `.claude/skills/tdd/SKILL.md` | `test/verify-mac-containment` | Conditioned; the bounded mechanics and the judge's scope decision remain. |
| `.claude/skills/tdd/SKILL.md` | `test/mutation-claim.test.mjs` | Conditioned in the same passage; its distinction between the stated bar and its use remains. |
| `.claude/skills/tdd/SKILL.md` | `scripts/build-test-matrix.mjs` | Conditioned in the condensed passage; the reference to the reader's source-shape limits remains. |
| `.claude/skills/tdd/SKILL.md` | `test/build-test-matrix.test.mjs` | Conditioned in the same passage; the parser-case location remains. |
| `.claude/agents/spike-engineer.md` | `docs/v0-build-plan.md` | Reworded without the path or Rigger's spike history. The report still belongs under `docs/spikes/` in a docs-only PR and carries the same contents. |
| `.claude/skills/code-review/SKILL.md` | `docs/v0-build-plan.md` | Conditioned; the document order, its reason, and the instruction to read the current milestone and exit conditions remain. |

The initial test-first red at dispatched base `4998448daf34ed545a803e557d08527d59ecc84e`
named nine members. Upstream PR #1147 removed the historical parser-journal reference and
condensed the parser guidance. The author re-based item 2; the dispatched-base run is context,
not credit for that item. Integration preserves the upstream suite-health admission and
conditions its condensed parser paragraph.

The three bare directory names remain conventions, outside this class. The diagnostic fixtures
check that exemption and distinguish conditions in paragraphs, list items and table rows;
fenced examples carry no members. Every edited template is copied byte for byte to its live
mirror. No existing test line changes.

The instruction-budget counter measured the merge-base pool at 15,285 words and the resolved
pool at 15,284. Removing the repeated paragraph/cell phrase and spike history, and shortening
the already-changed review passage without dropping its instructions, pays for the conditions.
Verification receipts belong in the PR: run metadata, guarded mutations, final-head checks,
per-test defect records, and the base/head text of each changed passage.

A guarded reporting probe at intermediate commit `507ab6d1239f8aa1713f6cd1c2e4974b12842d5b`
used `mutation:receipt` to replace the helper's list assertion with a count assertion while
keeping the same rejection rule and missing-path names. Only the rejection fixture failed,
on the assertion error's metadata fields. Its four invalid passage contexts are now checked
separately, with a valid/fenced control, without pinning those fields. Final-head receipts
include that reporting control and the independent semantic fault for each added test.

Round 1 reviewer finding F1 showed that a text-prefix classifier misses a repository path
spelled with `./`. At cbcdf47c, extending the existing rejection diagnostic first produced
`Missing expected exception` on `./scripts/consumer-check.mjs`. Its single matrix holds 19
literal path cells across five spellings, each checked in three passage forms. Parent-prefixed
cells re-enter the repository by its observed directory name; the expected rejection follows
from the path's destination, independently of the membership predicate. The valid/fenced
control and three bare-directory fixture are unchanged.

The checker resolves each span from the repository root and compares its relative path with
the member prefixes. This normalizes dot segments, repeated separators and trailing directory
separators without requiring the referenced file to exist. Bare directories resolve to the
prefix itself and remain excluded. Running the revised inventory at merge base cd181d6f
still names exactly the same eight members above; both other diagnostics pass there. No
forked instruction passage changes in this revision.
