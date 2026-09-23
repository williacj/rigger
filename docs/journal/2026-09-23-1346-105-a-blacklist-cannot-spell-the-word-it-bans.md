ABOUTME: A journal entry from card #105: A blacklist cannot spell the word it bans, and a rewrap
ABOUTME: guarded on words alone is not guarded on structure

## 2026-09-23 — A blacklist cannot spell the word it bans

The card asked for a word gone and for something to stop it returning, and the second half has a
shape the first does not. A check that refuses a spelling has to hold that spelling, and it reads
every tracked file, so the list is its own first finding. The way out that suggests itself —
exempting the check's own file by path — makes the one place the word is allowed the one place
nobody reads, which is where a word comes back from.

So the list holds patterns rather than spellings, and each brackets one character: `wid[g]et`
finds `widget` and never the text declaring it. No exemption, and a case-insensitive search across
every tracked file still returns nothing. A test asserts the property, because the next person to
add an entry will reach for the plain spelling.

Which check to extend was settled by running both rather than reading either. The spec-style lint
reads four documents, so with the prohibition added to its rule 1 it named the word in
`docs/spec/decisions.md` and `README.md` and missed it in eight other files — an instruction file,
a template twin, a journal entry, a script, a source file, a test and an agent prompt. Widening
that rule's existing term list to every tracked file instead reds on six files at `71928f5`, for
words legitimately there: the rule declaring them, `AGENTS.md` on the owner's approval, the hook
that refuses a red suite, and two tests' fixtures. Two lists, two scopes, and one rule each.

The word also reached a file name, and a check reading contents passes a file whose name still
says it. The new check reads the name git lists as well as the bytes.

The rewrap is what cost a round. Replacing a six-letter word with three ran the paragraphs past
the width the files already used, so a script rewrapped them and guarded the rewrap on the words
being unchanged. They were unchanged, and two blocks were still wrong: a bullet list in
`.claude/agents/pm.md` and a numbered list in the spec-style skill each came back as one run of
prose with the markers stranded mid-line. A guard on words is not a guard on structure, and the
one that would have caught it is cheap — count the lines that open a list item, a heading or a
table row, before and against after.

What this card does not reach: a stale backticked path inside an agent prompt is still caught by
nothing. Appending one to both `.claude/agents/engineer.md` and its template twin leaves `npm
test` at 202 passing and `check:paths`, `check:references`, `lint:spec-style` and `check:words`
all at exit 0, because `doc-references.json` names three documents and no agent prompt is among
them. Appending it to one twin alone reds, but on the divergence rather than on the path.
