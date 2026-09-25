ABOUTME: Records card #270, which gives the consumer's epic-label declaration a place in
ARCHITECTURE.md: the extension point, the key, the layer that reads it, and what absence means.

# 2026-09-25 — Where the epic label lives

The declaration belongs to Kinds of work, because that row already names L2 as the reader for
which kind selects a card (Delta D). Excluding an epic is part of that same decision, so a new
extension point would split one decision across two rows.

The key is top-level, `epicLabel`, beside `kinds` rather than inside it. Every key under `kinds`
names a kind, so a key there would read as a kind called `epic`. Its value is one string, because
the owner ruled on one label and #271 validates one non-empty name.

Absence means no label marks an epic. `R-SCHED-11` speaks of work the consumer marked, and a
consumer that declares no label has marked nothing. An engine default of `type:epic` would put a
label name in `src/`, which #271's acceptance forbids. Once #271 lands, the template declares
`type:epic`, so a consumer that runs `init` starts with it. That choice reverses if the owner rules that an absent
key means `type:epic`.

The ```js config shape is untouched. `test/config.test.mjs` checks that shape against the
validator in both directions, so the line lands with #271's validator.
