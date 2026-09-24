ABOUTME: Card #148's finding: a mutation anchor written in one round stopped matching in the next
because a neighbouring edit rewrapped the line it spanned.

# 2026-09-23 — An anchor that outlived its line break

Every other way a mutation has lied on this milestone is a property of one run. This one is a
property of time. Card #80 took two rounds, and the anchor its maker wrote in round 1 named a
rule that round 2 left alone — but round 2's own edit rewrapped the line that anchor spanned, so
the text it named no longer existed as written. The anchor was stale while the rule it pointed at
was not, which is why re-reading the rule tells an author nothing about whether the anchor still
matches.

Measured with a guard implementing requirement 1 of the tdd skill's mutation claim, over
`.claude/skills/spec-style/SKILL.md` in a checkout of each round's head:

- The round-1 judge's anchor joined two lines with `\n`. That file holds 108 CRLF line endings
  and no bare LF at `a085b9d`, so the anchor occurred 0 times; the same anchor written with
  `\r\n` occurred once.
- The maker's round-1 anchor, `passage that names a source and restates what it says fails,
  however short the restatement.`, occurred once at `a085b9d` and 0 times at `28209b6`. Round 2
  cut an earlier sentence from the same list item, and the reflow moved the break from before
  "passage" to after "restates what".
- That same anchor, resolved with each whitespace run matched loosely, occurred once at
  `28209b6`, and the span it matched carried the CRLF and the moved break together.

Both guards refused to write, and both refused on requirement 1. The check was never missing —
what was missing was the reason, so each agent diagnosed the same hazard from scratch a round
apart. `.claude/skills/tdd/SKILL.md` now carries that reason inside the requirement.

The counterfactual is what makes the requirement worth its words. With the count check removed,
the same write at `28209b6` was a no-op: `git status --porcelain` reported nothing, and
`node --test` on the test the mutation aimed at reported 18 of 18 passing. Read as a result, that
run says the test does not discriminate, which is the opposite of the truth. Resolved against the
bytes instead, the write landed and the same test failed on `the fifth rule says nothing about
restating a cited source`, 17 of 18.
