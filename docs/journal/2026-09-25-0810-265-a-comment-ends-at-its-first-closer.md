ABOUTME: Records card #265, which narrows the form check's comment-only test so a bullet with text
between two HTML comments stays an item, as the owner's (c) ruling says.

# 2026-09-25 — A comment ends at its first closer

`COMMENTS` matched each comment as `<!--.*?-->`. The lazy `.*?` looks like it stops at the first
`-->`, but it stops there only when the rest of the pattern can still match. In
`<!-- a --> real <!-- b -->`, stopping at the first closer leaves ` real`, which the pattern
cannot match. So the engine backtracked and let one comment run on to the last `-->`, taking
the word "real" with it. A lazy quantifier is the shortest match that succeeds, not the shortest
match.

The fix stops a comment's body from holding `-->`: `<!--(?:(?!-->).)*-->`. Each comment now
ends at its first closer whatever follows it, so text between two comments cannot become part of
a comment. A comment still unclosed on its line matches nothing, and the bullet stays text as
before.

The test for that last case is not on `main`. It arrives with PR #263 (card #253). This card
proves it by running #263's test file, unedited, against the fix.
