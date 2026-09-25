ABOUTME: Records card #284, which has the forge adapter address the board the config's
`board.owner` holds, or the repository's owner's where it declares none.

# 2026-09-25 — The board owner reaches the adapter

Before this card the adapter found the board among the boards of `repo`'s owner. Where another
account held the board, the read reached a same-numbered board of `repo`'s owner, if there was
one, and worked it without complaint. The owner is now resolved in one function in
`src/substrate/forge/read.mjs`, and every request that finds a board goes through it.

A request finds a board only by its owner and number. Every other request the moves and field
writes send names the board by the ID the finding request answered, so the tests give each
owner's board its own ID. A write that named the other owner's board would show up by that ID.

The failure message keeps its `on board N failed:` prefix, because the existing tests match on it
and the card holds their bodies unedited. The owner goes after the prefix, as `asking for
octo-org's board 6,`. A repository request carries no board owner, so a label read still fails
without one.

Round 1's Codex judge ruled item 14 unmet on a case I had called outside the card. When gh exits 0
with a null board, the write path's lookup said the board had no `Status` field and named no
owner. Item 14 reaches both response forms, a non-zero exit and an exit-zero null board. The
lookup now reports no such board with the owner beside the number, and the exit-zero test covers
`moveItem` beside `readItems`.

The mutation the card asks for makes the owner function return `repo`'s owner whatever the config
declares. It reds the same-numbered-boards test, reading `williacj`'s two cards in place of
`octo-org`'s one. It also reds the three tests that record which owner each request asks for.
