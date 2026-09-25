ABOUTME: Records card #247, which put the owner's ratified Delta G into ARCHITECTURE.md's boundary
rule 2: the forge adapter has three sides, each behind a runner that refuses what is not its own.

# 2026-09-25 — The adapter has sides

M1's boundary test leaked five times while it rested on sample calls. Each fix enumerated one
more request a layer must not send, and the next review found one the list had missed. A list of
forbidden calls can only be as long as someone's imagination. A runner that knows its own side
refuses everything outside it, including the call nobody thought to list, so the rule moved from
the test into the structure.

The text went in word for word. Read against `.claude/skills/spec-style/`, it needed no change of
form. Its longest sentence is 24 words, counted by hand, and the sentence introducing "side" and
"runner" defines each. `npm run lint:spec-style` reported 0 findings at the base and at the head.

Boundary rule 2's lines were re-wrapped to hold the insertion, and nothing else in the file
moved. The rule already said no other layer changes a card's column. The item-write side is how
that sentence becomes enforceable rather than a promise the reviewer checks by reading.

Nothing else in the file contradicts it. The Forge adapter row among the extension points still
names one interface. The three sides split how that interface sends, not what it offers, so a
second forge would still be an L0 change and nothing else.
