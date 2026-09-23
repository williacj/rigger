ABOUTME: Records the measurement and enforcement of Rigger's ratified live instruction budget.

# 2026-09-23 — The live instruction pool has its own check

The owner ratified a separate 13,000-word limit for Rigger's live role prompts and skill
instructions. At base `729dcca`, applying `countWords` from `scripts/instruction-budget.mjs` to
the four `.claude/agents/*.md` prompts and six `.claude/skills/*/SKILL.md` files measured 12,452
words. The existing `AGENTS.md` pool measured 1,991 words under its 2,500-word limit.

The command now reads both limits from `ARCHITECTURE.md`. A constructed repository with 13,001
live words and one `AGENTS.md` word demonstrated that the old check exited zero. After the change,
it exits non-zero and names the live total and limit. A 13,000-word live pool exits zero even
when distribution twins under `templates/claude/` contain more words.
