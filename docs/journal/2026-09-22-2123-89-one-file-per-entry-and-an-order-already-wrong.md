ABOUTME: A journal entry from card #89: One file per entry, and an order that was already wrong

## 2026-09-22 — One file per entry, and an order that was already wrong

Five pull requests conflicted on `docs/journal.md` during M0, and every resolution was the same
two words: keep both. Splitting the file per card removes the class outright, because two cards
then never name one file. What the split found on the way is the part worth keeping.

The single file's order was already wrong, and nothing could have told a reader. Taking the
commit that added each of the seven entries the file held at `5083fb9` and reading it upwards
from its oldest, the times run 16:52, 17:00, 17:25, 17:06, 18:39, 18:51 and 19:59. One pair is inverted: the entry
written at 17:06 sat **above** the entry written at 17:25, and the file was newest first, so it
claimed the earlier of the two was the later one.

Where that happened is on the record. `e3a6d15`, "Merge origin/main into m0/36-test-matrix",
took a branch whose top entry was the 17:25 one and a `main` whose top entry was the 17:06 one,
and resolved the conflict by putting `main`'s on top. The rule the resolution followed was
"whatever arrives from `main` is newer", which is a claim about where a change came from and not
about when it was written. Nineteen minutes of the order the file existed to keep were spent on
that, and no reader could have caught it: every heading carries a date and no time, so the only
record fine enough to contradict the order was the commit log.

So the newest-first rule those five conflicts were paid to preserve had already lost a piece of
what it was preserving. Every migrated entry's file name now carries the time of the commit that
wrote it, measured rather than inferred from where the entry sat.

That measurement is available only to a migration, and saying so is the honest bound. An entry
written from here on is named before the commit that carries it exists, so its time is chosen by
hand and cannot be the commit's — this entry is named `2123` against a commit stamped 21:27. The
name claims the time the entry was written, which is what a writer can know, and nothing checks
it.

The migration surface the card measured was one reference short, and the check that would have
caught it is the one the card named as its own falsifier. `docs/spec/decisions.md` ends `D16`
with "`docs/journal.md` records what produced this entry" — a strict checked document, so
deleting the file reds `check:paths` at that line. The card's table listed four sites and not
that one. Grepping for the string rather than reading the table found it in a second, which is
the cheaper order. A measured list in a card is evidence about the moment it was measured, and
this one had drifted repeatedly: the card counts three entries at `0df465b` where that commit
holds four, the file held seven at `5083fb9` where this work started, and eleven at `a2eee65`.
A count of that file is only ever a claim about one commit, which is why each of these names one.

The fix there is a one-word path, and it is still a diff inside `docs/spec/`. A reference that
resolves is not the same as a claim that holds: leaving `docs/journal.md` in place as a stub
would have kept `check:paths` green while making `D16`'s last sentence false, and that is the
failure `AGENTS.md` names when it says the resolver passing is no evidence the citation is
sound. Green was available and wrong.

The split had to survive further conflicts on the file it was deleting, and their shape is worth
recording because it is the shape every card open at the cut will meet. Card #91 merged an entry
into `docs/journal.md` while this branch had already deleted it, so `git` raised a modify/delete
rather than a text conflict: it left `main`'s whole file in the tree and refused to guess. That
is the right refusal, because the resolution is not mechanical — the incoming entry has to be
migrated into the new form, with its own measured time, before the file goes.

Then cards #97, #73 and #71 did it again, which is the more useful half. The first draft of the
paragraph above called the cost "one migration per branch, paid once". That was a prediction
dressed as a measurement, and it has now been falsified three times over: this branch has paid
the migration on three separate merges, for four incoming entries. The cost is one migration per
entry that lands while a branch is open, and what bounds it is how long the branch stays open
rather than anything this card can do. A card that ends journal conflicts is itself blocked by
journal conflicts, so the number is settled by where it sits in the merge order.

The sentence describing that bound has been rewritten at every merge, and that is the entry worth
reading. Each absorption falsified the count in the paragraph reporting the absorptions — "paid
once" became twice, then twice became three times, and "nine hand-moves" has been eight, nine and
eleven. A number that counts events of a kind still occurring is stale from the moment it is
written, and the only stable form is the rule that generates it. This entry is the record of a
card learning that about its own record, four times, which is a slower lesson than it sounds.

The entries were moved by a script and checked by a second one, because eleven hand-moves are
eleven chances to reflow a paragraph. The checker asserts each new file's body appears verbatim
in `docs/journal.md` as it stood before the split, and it failed every one on its first run: the
working tree is CRLF under `core.autocrlf`, `git show` hands out LF, and the comparison was
between the two. The entry at `2026-09-22-1700-36-a-generated-document-and-crlf.md` is about
that exact difference costing a check a false red. It cost this one too, four hours later,
in a script written to prove nothing had been altered.
