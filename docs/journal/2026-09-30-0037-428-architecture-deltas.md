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

## Round 1: ruling 8

The reviewer's round 1 found one blocking breach, B1. Delta 8's three environment failures were a
rule with three conditions carried in one sentence, against spec-style rule 4. Architect ruling 8
on #423 gave the text for two changes, and they are applied as given.

- Delta 8's paragraph is now a lead sentence ending in a colon, the three failures as a list, and
  its last sentence as a paragraph of its own. The words are unchanged.
- Delta 3's clause ", as `worktrees` in the form given below the table" had attached to the topic
  rule alone, though `worktrees` declares the root too. The Engine settings row's Declared-by cell
  is reordered so the clause covers both, and the long sentence it made is split in two.
