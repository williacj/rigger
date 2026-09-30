ABOUTME: Journal for #428 (M3-02): the architect's M3 deltas 1 to 10 carried into `ARCHITECTURE.md`
as settled, the five `SHAPES` declarations, and the `worktrees` line in both live configs.

# #428 — the M3 deltas to `ARCHITECTURE.md`

## What was done

The deltas are copied, not drafted. The source is the architect's first ruling's §2.2 on #423, with
the fills rulings 2, 3, 4 and 6 settled, as the decomposition's §2.2 table gives them. Delta 9 is
the text ruling 7 gives it, which makes A4 final on #426's report (PR #442).

- `src/config/validate.mjs` gains the five declarations ruling 3's P1 names, and nothing else. The
  refusals are #429's.
- `rigger.config.mjs` and `templates/rigger.config.mjs` each gain `worktrees: { topic:
  'rigger-{number}' },`, because `worktrees` is now a shape site the live config must hold
  (ruling 4).
- Three paragraphs were re-wrapped where a delta lengthened a line. No word outside a delta moved.

## Where the ruled text needed placing

Two deltas say "add" without saying where in the sentence.

- Delta 3's v0 cell reads "Yes, N defaults to 3. [O1 …] [O2 …]". Each filled bracket became its own
  sentence, capitalised.
- Delta 10 goes straight after the sentence it names. That puts it between the sentence allocating a
  dispatch's id and the sentence on why no two ids repeat, which the ruling asked for.

## What to watch

The Engine settings row's first sentence is now 35 words, under rule 2's ceiling of 40 but past its
aim of about 25. The words are delta 3's, so a shorter form is the architect's to propose.

Delta 8's three environment failures sit in one sentence, not a list. Spec-style rule 4 asks for a
list at three conditions or more. The words are ruled, so this too is left to the architect.
