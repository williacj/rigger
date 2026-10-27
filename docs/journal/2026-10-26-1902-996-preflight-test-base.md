ABOUTME: Records card #996's fix to preflight's prompt test, which measured a merge base and so
failed on main.

# Preflight test base

Done for #996 means its acceptance revision `f511da620b59`: the prompt test reads no git ref,
and bounds the one `engineer.md` line naming `npm run preflight` at 40 words by `countWords`.

The test #978 added measured the words `engineer.md` gained since its merge base with
`origin/main`. That holds only on a pull request branch; once the card merged, the merge base
on `main` is `HEAD`, the delta is 0, and the `added > 0` bound failed (main CI run 40420952843).
A check written for pull-request time has to measure something that stays true after merge, so
it now bounds the preflight line itself, which no other card's edits to the prompt move.
