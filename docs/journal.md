ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — Three probes that passed, and proved nothing

Card #71 taught the command gate that card #28 built to skip a here-document body. A judge then
found it permitted a reserved command bash runs, whenever a `<<` sat where bash reads no command
word — in a comment, or in an arithmetic command. Asking bash for the whole set of regions turned up
five more: a backtick substitution, three spellings of parameter expansion, and the old `$[ ]`
form. Seven live spellings, not two.

**The judge's probe missed those five because of how it was spelled.** Each probe wrote
`<<W`, the reserved command, then a closing line `W`. But bash reads a delimiter word to the next
metacharacter, and a backtick, `}` and `]` are not metacharacters, so the delimiter was really
``W` `` or `W}` and no line matched it. The gate refused — for the wrong reason, by accident.
Spelling the closing line ``W` `` or `W}` makes the same five permit. A probe has to be spelled
the way the tool under test reads it, or a refusal by accident reads exactly like a control.

**A mutation that deleted three guards at once said the same thing about its own suite.** Three
guards catch an unterminated here-document body, reached by three different shapes. One mutation
replaced all three, the suite went red on the two that were covered, and the mutation was
recorded as caught. The third had no test at all, and deleting it alone left the suite green.
A mutation is only evidence about the one behaviour it removes; batching them reports the union
and hides the gap.

**And a measurement that contradicted its own earlier run.** Payloads passed to `node -e` inside
a quoted shell string were altered by the shell, and the verdicts disagreed with a run made
minutes earlier. The contradiction is what caught it; nothing in either run looked wrong on its
own. Redone from a script file with no shell quoting, the numbers changed — five classes moved
from "refused" to "permitted", which was the finding. A measurement that no other measurement
disagrees with is not thereby correct, and a harness that reshapes its own input is the quietest
way to be confidently wrong.

## 2026-09-22 — The lint arrived after the corpus, and the corpus barely cleared it

Writing `spec-style-lint` against documents already written showed how little headroom the
sentence ceiling has: the longest sentence the lint reads is 39 words against a ceiling of 40.
The next compound sentence anyone writes into the README or the register reds the build.

Two of the four register rules turned out to be unlintable, and the reason is worth keeping.
Rule 3 asks whether an actor is genuinely unknown and rule 4 asks whether a structure fits its
meaning. Both are judgments about intent, and a lint that guessed at either would file findings
an author has to argue with rather than fix.

The sentence splitter asks the word after a full stop whether the stop ended a sentence, and it
is wrong both ways. A lowercase word keeps two sentences joined, as `v0 buys` does, and the
count comes out high. A capital after an abbreviation splits one sentence into two, the way
`e.g. Rigger` does, and the count comes out low.

The second of those cost a review round, because this entry first claimed it could not happen.
A bias in a check is worth disclosing, and a bias described as absent is worse than one nobody
mentioned: a reader then draws a conclusion the check cannot support. A green lint says no
sentence the splitter reads is past the ceiling, which is narrower than it sounds.
