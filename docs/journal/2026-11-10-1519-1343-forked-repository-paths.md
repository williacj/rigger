ABOUTME: Records the repository paths found in init's forked assets and how card #1343 handles them.

# Forked repository paths

Card #1343, acceptance revision `21f660ff3dbb`, bounds the class and permits no requirement
claim under M8-K16. The content check reads the full pinned `init` plan in process, including
the forge workflow. It uses the passage units already used by the command check.

An in-process scan of every planned file at base
`4998448daf34ed545a803e557d08527d59ecc84e` found these members. The new test's first run
against those unchanged assets failed on all nine, before any template or mirror was edited.

| Forked file | Member at the base | Treatment |
|---|---|---|
| `.claude/skills/spec-style/SKILL.md` | `scripts/spec-style-lint.mjs` | Conditioned on the repository defining it. The paragraph still specifies the lint's scope and which rules it checks. |
| `.claude/skills/tdd/SKILL.md` | `test/package-budget.test.mjs` | Conditioned; the tool-authority rule and worked example remain. |
| `.claude/skills/tdd/SKILL.md` | `test/verify-mac-containment` | Conditioned; the bounded mechanics and the judge's scope decision remain. |
| `.claude/skills/tdd/SKILL.md` | `test/mutation-claim.test.mjs` | Conditioned in the same passage; its distinction between the stated bar and its use remains. |
| `.claude/skills/tdd/SKILL.md` | `scripts/build-test-matrix.mjs` | Conditioned; the reader's precedence over the description remains. |
| `.claude/skills/tdd/SKILL.md` | `test/build-test-matrix.test.mjs` | Conditioned in the same passage; the parser-case location remains. |
| `.claude/skills/tdd/SKILL.md` | `docs/journal/2026-09-23-1638-119-matrix-refusals.md` | Removed with the historical measurement sentence. The parser's limits and precedence remain. |
| `.claude/agents/spike-engineer.md` | `docs/v0-build-plan.md` | Reworded without the path or Rigger's spike history. The report still belongs under `docs/spikes/` in a docs-only PR and carries the same contents. |
| `.claude/skills/code-review/SKILL.md` | `docs/v0-build-plan.md` | Conditioned; the document order and the instruction to read the current milestone and exit conditions remain. |

The three bare directory names remain conventions, outside this class. The diagnostic fixtures
check that exemption and distinguish conditions in paragraphs, list items and table rows;
fenced examples carry no members. Every edited template is copied byte for byte to its live
mirror. No existing test line changes.

The instruction-budget tool measured the base pool at 15,291 words and the edited pool at
15,287. Removing the repeated paragraph/cell phrase in the lint description and the historical
references pays for the conditions without changing the rules. Verification receipts belong in the PR: run metadata, guarded mutations, final-head checks,
and the base/head text of each changed passage.
