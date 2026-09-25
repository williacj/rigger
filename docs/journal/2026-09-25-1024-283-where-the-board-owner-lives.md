ABOUTME: Records card #283, which places in ARCHITECTURE.md the consumer's declaration of the
board's owner: `board.owner`, optional, read by L0's forge adapter.

# 2026-09-25 — Where the board's owner lives

The board's owner is an engine setting, because it says which board Rigger talks to, and the
Engine settings row already gives the board to L0. It sits under `board`, beside `project`,
because the two together name one board and neither names it alone.

The absence rule lives in L0's forge adapter and nowhere else. A default filled in by the
validator would put a derived value into the loaded config, and every reader would then take it
for a declaration. Keeping it in the adapter leaves one place that computes the board's owner.

The word "owner" already means L7, and `board.columns.owner` names the Owner column. So every
added sentence says the board's owner or the repository's owner, never the bare word.

The published config shape's line shows `owner: 'williacj'`, while #284 leaves Rigger's own
config without the key. The shape already differs from that config, naming board 1 where
`rigger.config.mjs` names board 6, so the two need not match. What would reverse the placement: a second forge whose boards belong to
the repository rather than to an account, which would make the key that forge's adapter's alone.
