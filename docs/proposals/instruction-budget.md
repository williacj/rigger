ABOUTME: Proposal for measuring and limiting the role prompts and skills Rigger uses as its own consumer.

# A budget for live role instructions

This is a proposal for card #114. It changes no binding document, ceiling, or check.
The owner can ratify, revise, or reject the proposed budget before an implementation card changes those files.

## Problem and evidence

At ref `22686b4de11adb2fa1cc299b1de4d521cbeee32c`, `npm run budget:instructions` reports 1,986 words against 2,500 and passes. The check's own `countWords` function reports another 12,200 words in ten live `.claude/` role prompts and skills. An author can therefore add words to those ten files without spending the instruction budget. The cost is that a growing review or TDD procedure can enter every relevant dispatch without a budget refusal. This is a measured scope gap, not evidence that a dispatch has already failed because of prompt length.

`scripts/instruction-budget.mjs:12` selects only `AGENTS.md`; its `instructionFiles` walk at line 45 matches that name. `scripts/package-budget.mjs:13` begins at `src`, so its production-line check does not charge prompts or skills either. The root `CLAUDE.md` imports `AGENTS.md` and adds no instruction of its own; the instruction-budget script records that reason at lines 8–11.

The following counts come from `countWords` exported by `scripts/instruction-budget.mjs:31`, run over each listed file at the named ref. That function counts whitespace-separated tokens, including standalone punctuation. The ten template files had byte-identical live counterparts at this ref.

| Instruction file | Live words | Template twin words |
|---|---:|---:|
| `AGENTS.md` | 1,986 | — |
| `.claude/agents/engineer.md` | 308 | 308 |
| `.claude/agents/pm.md` | 964 | 964 |
| `.claude/agents/reviewer.md` | 321 | 321 |
| `.claude/agents/spike-engineer.md` | 753 | 753 |
| `.claude/skills/acceptance/SKILL.md` | 1,485 | 1,485 |
| `.claude/skills/agent-style/SKILL.md` | 854 | 854 |
| `.claude/skills/code-review/SKILL.md` | 2,328 | 2,328 |
| `.claude/skills/proposal/SKILL.md` | 1,723 | 1,723 |
| `.claude/skills/spec-style/SKILL.md` | 819 | 819 |
| `.claude/skills/tdd/SKILL.md` | 2,645 | 2,645 |
| **Live `.claude/` / template totals** | **12,200** | **12,200** |

## What the architecture settles

The `ARCHITECTURE.md` layer table assigns L4 **“roles, review procedure, provisioning steps”** to **“The owner, in the consumer's repository”** and says **“Rigger ships templates under `templates/`.”** Its Role skills extension row says **“Nothing in Rigger reads them; the role does.”** Those rows locate ownership and use; they do not set an instruction-word ceiling.

The Budgets section says production-code budgets **“bound Rigger's own production code”** and **“L4 has no budget: the roles, review procedure, and provisioning steps are the consumer's, live in the consumer's repository, and are theirs to size.”** It excludes templates from that production-line count. Its separate instruction paragraph says the 2,500-word budget covers **“the root `AGENTS.md` and every nested one together”**. Read together, these rows do not put `.claude/` under either existing budget. A new limit for Rigger's own live L4 files needs the owner's decision; it cannot be inferred from the 2,500-word `AGENTS.md` rule. This proposed repository check would govern Rigger as its own consumer, not impose a ceiling on other consumers' L4 assets.

## Measured choices

I ran each scope below against the same current tree using the script's `countWords`, including all ten live files. “Refuses” means a check with the stated ceiling would return failure today. The candidate 13,000-word ceiling is a policy choice: it leaves 800 words, about 6.6% of today's live total, for small edits before an owner-approved budget change. No runtime measurement proves that 13,000 is an optimal prompt size.

| Choice | Scope and ceiling | Result today | What it refuses today |
|---|---|---|---|
| Keep current check | `AGENTS.md` files pooled at 2,500; no `.claude/` ceiling | 1,986 / 2,500 passes; ten live files unbounded | No current file or `.claude/` growth |
| One existing pool | Root plus ten live files at 2,500 | 14,186 / 2,500 fails | This tree, by 11,686 words |
| Separate per-file cap | Root pool at 2,500; each live file at 2,500 | Root and nine live files pass | `.claude/skills/tdd/SKILL.md`, by 145 words |
| Separate live pool | Root pool at 2,500; ten live files pooled at 13,000 | 1,986 / 2,500 and 12,200 / 13,000 pass | No current file; future live growth beyond 800 words |

**Recommend a separate 13,000-word live `.claude/` pool.** It gives the owner an explicit limit on the instructions Rigger controls without retroactively rejecting a procedure the repo currently uses. A single live pool permits moving text between a role prompt and its skill without changing the count, matching the existing `AGENTS.md` pool's property. Its cost is that a need to add more than 800 net words requires deletion elsewhere or a ratified ceiling change. It also does not identify an individual skill that has grown too large; an independent reviewer must still judge clarity.

Do not charge `templates/claude/` to this pool. `src/cli/init.mjs:21–32` says `init` forks templates into a consumer's provider directory, while this repository's `.claude/` files are its live consumer assets. Charging both identical copies would count the same instruction text twice in this repository: 24,400 / 13,000 would fail by 11,400 today. Maintain twin parity as a separate question; the measurement here found all ten twins byte identical. If a template diverges, review whether its content is intentional rather than silently treating its words as live instructions.

### Ratifiable architecture delta

If the owner accepts the choice, append a paragraph to `ARCHITECTURE.md`'s Budgets section with this meaning:

> Rigger, as its own consumer, gives its live `.claude/` role prompts and skills a separate pooled budget of 13,000 words. The check counts each live role agent file and skill instruction file once. The templates under `templates/` are distribution copies, outside this pool. This budget does not set a limit for another consumer's L4 instructions.

An implementation card would then extend `scripts/instruction-budget.mjs` to check that second pool using its existing word definition, and add tests for the live-file scope and refusal. `README.md` needs no new verb. The proposal adds no product requirement: `docs/spec/requirements.md` says its rows bind a Rigger deployment, while this limit governs work in this repository. `R-IMPROVE-4` already requires a proposal crossing a budget to name that budget and be refused; this choice would give that rule one more recorded budget to read.

## Boundary and reversal

This proposal does not limit consumers' own role files; L4 leaves their size to their owner. It does not change the current 2,500-word `AGENTS.md` ceiling; that pool answers a different scope. It does not charge distribution templates; `init` forks those into a consumer's live tree. It does not alter the package line budget; the source walk begins at `src`. It does not select a per-dispatch token limit, because no measured dispatch-size data is in this card.

The owner should reverse or revise the 13,000-word choice if repeated sound instruction changes hit it while independent reviews find no shorter clear wording, or if measured per-dispatch costs show a total live-tree pool misses the actual constraint. Those observations would support a larger pool or a different unit. The present evidence supports introducing a boundary, but cannot prove the exact ceiling from runtime behavior.
