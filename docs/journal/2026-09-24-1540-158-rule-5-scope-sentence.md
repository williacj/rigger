ABOUTME: Card #158 — cutting rule 5's own scope sentence from the spec-style skill, and the two
dangles the cut left behind.

# Card #158: rule 5 stated its own scope, which rule 5 forbids

Rule 5 of `.claude/skills/spec-style/SKILL.md` opened by saying which documents it reached. The
frontmatter description already names those documents, and the opening paragraph already says the
rules describe how the binding documents are written. So the sentence named a source and retyped
it — branch 2 of the rule it belonged to. The owner ratified cutting it.

## What the cut left dangling

The sentence was carrying two referents, and both went with it.

1. The next sentence read "splits every sentence **in them** three ways". Its `them` was the cut
   sentence's "the documents this skill's description names". Dropping `in them` leaves the scope
   to the description, which is what the card argues owns it.
2. Two paragraphs down, "one **these documents** already use for that concept" pointed at the same
   noun phrase, through that `them`. It now reads "the binding documents", the term the skill's own
   opening paragraph establishes one section above rule 5.

Neither repair states what rule 5 reaches. The first removes a referent, the second replaces a
deictic one with a term the file owns. Every branch, and the test attached to each, says what it
said before.

## What stayed, and why the file still holds together

The second sentence stays, naming `AGENTS.md`'s "Documents own their facts" as the owner of the
three-way split — without it the branches read as this skill's invention. The bullet under
`## What this skill is not` saying "Rule 5 asks who owns a fact, and holds the same way" needed no
repair; it is about which rules the lint reads, not about which documents rule 5 reaches. It is
also now the only occurrence of the string `Rule 5` in the file, which
`test/spec-style-lint.test.mjs` asserts is present.

## What the tests already pinned

Three assertions read rule 5 off disk: that its section exists, and that it says something about
`owns`, about `restat`, and about a `term`. All three survive, because the cut took a scope
sentence and not a branch. The lint reads its ruled-out terms from rule 1's section alone, matched
on the `### 1.` heading, so it reads exactly what it read before.

## Measurements

Every figure here is measured on branch `m0/158-rule-5-scope-sentence` in a fresh clone taken from
the GitHub URL, against base `926e954`.

| Figure | Tool | Before | After |
|---|---|---|---|
| Pooled live instruction words | `npm run budget:instructions` | 12669 | 12651 |
| `spec-style/SKILL.md` words | `npm run budget:instructions` | 1021 | 1003 |
| Spec-style findings | `npm run lint:spec-style` | 0 | 0 |
| Suite | `npm test` | 307 pass, 0 fail | 307 pass, 0 fail |

## What the round cost, and what it saved

The mutation ran from a script guarded on the blob `5ebb7868` that both copies carry at `926e954`,
which asserted each anchor appeared exactly once and that putting the anchors back reproduced the
file byte for byte. That guard is cheap, and it is the only thing that would have caught an anchor
gone stale under a rewrap.

`.claude/skills/agent-style/SKILL.md` carries the same fault and is PR #153's to fix. It is
untouched here.

## What I left alone

Nothing else in the file dangles. `## Before you hand it off` item 5 asks whether a passage
restates a source it names — that is branch 2 read back as a question, and it needs no referent
from the cut sentence. Rule 2's "that is rule 4" is a cross-reference to a rule, not to a scope.
