ABOUTME: A journal entry from card #89: One file per entry, and an order that was already wrong

## 2026-09-22 — One file per entry, and an order that was already wrong

Five pull requests conflicted on `docs/journal.md` during M0, and every resolution was the same
two words: keep both. Splitting the file per card removes the class outright, because two cards
then never name one file. What the split found on the way is the part worth keeping.

The single file's order was already wrong, and nothing could have told a reader. Taking the
commit that added each of the seven entries, the times run 16:52, 17:00, 17:25, 17:06, 18:39,
18:51 and 19:59 against the order the file listed them in. One pair is inverted: the entry at
17:06 sat below the entry at 17:25, put there by a hand resolving a conflict with no time to
compare. So the newest-first rule those five conflicts were paid to preserve had already lost
what it was preserving, in the one place a reader would have had to open the file to check. The
file names now carry the time, which is measured from the commit rather than inferred from where
an entry sat.

The migration surface the card measured was one reference short, and the check that would have
caught it is the one the card named as its own falsifier. `docs/spec/decisions.md` ends `D16`
with "`docs/journal.md` records what produced this entry" — a strict checked document, so
deleting the file reds `check:paths` at that line. The card's table listed four sites and not
that one. Grepping for the string rather than reading the table found it in a second, which is
the cheaper order. A measured list in a card is evidence about the moment it was measured, and
this one had drifted twice over: the card counts three entries at `0df465b` where that commit
holds four, and the branch it lands on holds seven.

The fix there is a one-word path, and it is still a diff inside `docs/spec/`. A reference that
resolves is not the same as a claim that holds: leaving `docs/journal.md` in place as a stub
would have kept `check:paths` green while making `D16`'s last sentence false, and that is the
failure `AGENTS.md` names when it says the resolver passing is no evidence the citation is
sound. Green was available and wrong.

The entries were moved by a script and checked by a second one, because seven hand-moves are
seven chances to reflow a paragraph. The checker asserts each new file's body appears verbatim
in `docs/journal.md` as it stood at `5083fb9`, and it failed all seven on the first run: the
working tree is CRLF under `core.autocrlf`, `git show` hands out LF, and the comparison was
between the two. The entry at `2026-09-22-1700-36-a-generated-document-and-crlf.md` is about
that exact difference costing a check a false red. It cost this one too, four hours later,
in a script written to prove nothing had been altered.
