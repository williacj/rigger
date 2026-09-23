ABOUTME: Card #114's finding about instruction text outside the current word-budget check.

# 2026-09-23 — A check that counted only the import

The current instruction check counted 1,986 words in `AGENTS.md` at ref `22686b4`, while its own word function counted 12,200 in ten live role prompts and skills. The package check started at `src`; neither check reached those instructions. The ten template twins were byte identical, so charging both copies would double the count without measuring another instruction loaded by this repository's roles. The proposal records the competing scopes and recommends a separate live pool for the owner to judge.
