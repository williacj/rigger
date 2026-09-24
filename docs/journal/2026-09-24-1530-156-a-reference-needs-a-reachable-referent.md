ABOUTME: Card #156 — two skill passages retyped a fact another document owns, and only one of
them could be cut. What separated them was whether the reader could reach the referent.

# A reference needs a reachable referent

Card #156 named two passages that retype a fact another document owns. Both fail branch 2 of
`.claude/skills/spec-style/` rule 5 on its face — each names a source and restates what it says.
One was cut and one was kept, and what decided it was not the size of the restatement.

## What each site was

`proposal/SKILL.md`, under "Write each row", opens by naming the owner and sending the reader to
it: the preamble of `docs/spec/requirements.md` is the authority on what the two columns mean,
*read it there*. Two lines on, a bullet retyped the meaning of both columns.

`tdd/SKILL.md` carries a table of seventeen call shapes the matrix reader refuses, then declares
the duplication itself — `scripts/build-test-matrix.mjs` states the same set beside the code, in
the block comment above `declarationsIn`.

## Why one was a clean cut

The `proposal` bullet is the strongest form of the fault, because the skill had already done the
right thing one line earlier. Having sent the reader to the source, it then saved them the trip,
and the shorter copy was weaker than the register it summarised. The preamble says `made true by`
names who or what is *supposed to satisfy* the requirement; the bullet said it names who or what
satisfies the row. The preamble also rules that the actor in one column is never the entry in the
other, which the bullet did not carry at all.

That is worth naming precisely, because the danger of a restatement is not that it wastes words.
It is a *second* claim about the source, made without the source open, and a reader who trusts it
never learns it was thinner. A reader who followed the instruction they were given got the full
rule; a reader who took the convenience got less. A convenience that undercuts the instruction
beside it is worse than no convenience.

## Why the other was kept

The `tdd` table is the same fault with a different reader, and the reference offered in its place
does not reach that reader.

A maker loads the tdd skill before the first test body, holding `AGENTS.md` and that skill. It
does not hold `scripts/`. The set it needs is a JSDoc block above an internal function of a build
script, and the skill's pointer names the file but not the function, so a reader who follows it
lands in a parser and hunts for the paragraph that concerns them.

The two copies are also written for different readers in different vocabularies, and that is the
part a word count hides. The script explains the parser to someone reading the parser: *refused:
reaching it is not tokens*, *refused: binding is not static*. The skill explains the consequence
to someone writing a test — the pipe divides the two cells of a matrix row, a matrix row is one
line so it cannot carry the title. Sending the maker to the script hands them a true statement
about the parser in place of the one they came for.

The cost of not knowing is immediate rather than theoretical. A title carrying a `|`, or a
declaration above a call a `describe` encloses, makes the matrix build refuse by file and line. A
maker who does not know writes the test, then debugs the refusal. So the cut would have removed
instruction rather than a duplicate.

## The lesson, stated so it can be reused

**A reference discharges the duty to own a fact only where the reader will open the referent.**
Reachability is not whether the file is in the repository. It is three things together: what the
reader has loaded when the fact bites, the form the owner keeps the fact in, and whether the
owner's wording answers the reader's question or a different one. A pointer to a block comment
inside a script fails all three for a maker mid-test, and a reference nobody follows leaves the
restatement as the only copy the reader gets.

The two sites differ on that axis and on nothing else, which is why one diff line closed one and
a paragraph of argument closed the other.

## What was not settled here

Whether a skill may state a cited `docs/spec/` row at all is still with the owner, raised as
finding 1 of PR #153; this card left all five such statements alone. The `tdd` case does not
answer that question — a script in this repository is not a register, and the problem here is the
*form* the owner keeps the fact in rather than whether a register may be quoted.
