ABOUTME: Records the init divergence fixture failure and its bounded red/green repair for #840.

# Init divergence fixture

At base `57a350c9dcde67f6f1ab54119c4a7bddcc87c8c7`, the named test cloned `HEAD` but compared that clone with the current init plan. To reproduce [#840](https://github.com/williacj/rigger/issues/840), I staged only the already tracked `.claude/agents/engineer.md` and `templates/claude/agents/engineer.md` with matching new bytes; `git diff --cached --name-only` named exactly those two paths and `cmp -s` confirmed equal working-tree bytes. `HEAD` still held their old bytes.

Before the fix, `npm test -- --test-name-pattern='one changed byte in a planned .claude asset' test/init.test.mjs` exited 1: one named test failed at its initial zero-divergence assertion, which reported `.claude/agents/engineer.md` before the intentional byte mutation. I changed only the two bounded-grant fixture setup lines to create its temporary repository from every file in `forThisRepository()`'s current plan.

With the same two staged asset edits, the same focused command exited 0: one named test passed. Its planned-asset guard, first-byte guard, and exact single-message assertion still run. Seeding the initial fixture from the plan makes the later one-byte edit the only divergence, so the assertion still detects that edit.

This test-only repair is prerequisite to [#839](https://github.com/williacj/rigger/issues/839). It changes no product, template, gate, or owner ruling.
