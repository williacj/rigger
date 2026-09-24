ABOUTME: Card #146's finding: the known restatement in the code-review skill shared no wording
with the rule it restates, so the lexical arm of the sweep scored it zero while the arm that
looked for a named source found it first.

# 2026-09-24 — The restatement a lexical sweep cannot see

Card #146 came with two fixtures, and the card said why: a sweep is evidence only once it has
found the instance already known to be there. The method that ran had two arms. Arm A listed
every block in the six skills that names a source document — `AGENTS.md`, `ARCHITECTURE.md`, a
`D#`, an `R-GROUP-#`, another skill's path — on the grounds that branch 2 of the ownership rule
fails a passage that names a source and restates it. Arm B ranked every block by four-word
shingle overlap against each sentence of `AGENTS.md`, to catch a retyping that names nothing.

Measured over the six live skills at `f4c2ba1`, with a throwaway two-arm script:

- Arm A listed 101 blocks and found both fixtures: `.claude/skills/code-review/SKILL.md` at lines
  119–120, and the reference in the spec-style skill's fifth rule that card #80 put there instead
  of a restatement.
- Arm B's top score was 1.000, and three blocks reached it, all of them near-verbatim retypings of
  `AGENTS.md` that nobody had named as defects before. It ranked 132 blocks in all.
- Arm B scored the code-review fixture **0.000**. Its wording — "assert something another document
  owns, rather than referring to it" — shares no four-word run with the section it restates, which
  says "own it", "refer to it" and "do not say it".

So the arm that reads like the better tool is the one that would have reported a clean sweep over
the file the defect was already known to sit in. A restatement is a paraphrase by nature: the
author retyped the rule in their own words, which is exactly what makes it a second copy and
exactly what makes it lexically invisible. What located it was the structural fact that the
passage names its source, which any restatement of a cited rule has to do.

The counterfactual is the whole of the lesson. Arm B alone, over these six files, reports four
findings and misses the one the card handed it. Arm A alone reports 101 candidates that a reader
then has to judge one at a time, and reading is what the card asked for. The arms are not
alternatives — the cheap one is a cross-check, and the expensive one is the method.
