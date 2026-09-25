ABOUTME: Records card #285, the PM's proposal of R-WORK-7: why the board a consumer names became
a requirement, and why four of #284's tests claim it rather than one.

# 2026-09-25 — The board the config names

Card #285 proposes `R-WORK-7`: Rigger works the board the consumer's configuration names, and no
other, whoever owns it. The row travels in the pull request until the owner merges it (`D21`).

The owner's ruling came first and the row second. The ruling settled a structural question, where
a board's owner comes from, and #283 placed the answer in `ARCHITECTURE.md`. What that answer
protects is observable from outside: a consumer names a board, and Rigger reaches that board and
not a same-numbered one elsewhere. With no row, a redesign of the config could drop the
declaration and nothing in the register would notice.

Four of #284's tests claim the row, not one. Three show a declared owner's board being read,
moved on and given a field while the repository's owner holds a board with the same number. The
fourth shows the default: with no owner declared, the same forge answers for the repository
owner's board only. A row about "the board the configuration names" covers both readings of the
configuration, so a test for each is what claims it.

Two mutations of the one place the adapter resolves the owner show the split. Ignoring a declared
owner reds the first three. Taking the wrong half of `repo` as the default reds only the fourth.

The shared-board question the card left out of scope was answered the same day. It became
`R-WORK-8` on #290, and nothing here depends on it.
