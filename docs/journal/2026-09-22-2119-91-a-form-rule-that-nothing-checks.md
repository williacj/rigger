ABOUTME: A journal entry from card #91: A form rule that nothing checks

## 2026-09-22 — A form rule that nothing checks

`AGENTS.md` gained a rule about how a paragraph is written. The two passages that prompted it
broke no rule, and both were delivered by makers who had loaded the skills they were working
under: one in `.claude/skills/tdd/SKILL.md`, one an entry in this file.

`npm run lint:spec-style` prints the documents it reads, and they are `README.md`,
`ARCHITECTURE.md`, `docs/spec/decisions.md` and `docs/spec/requirements.md`. No skill and no
journal is among them, so neither passage was ever in front of it.

Of the four rules the lint's own skill states, it applies two.
`.claude/skills/spec-style/SKILL.md` says rules 3 and 4 are judgments an author applies and a
reviewer reads for, and `test/spec-style-lint.test.mjs` pins that silence: no finding about
voice, and none about whether prose should have been a list.

Nothing therefore checks the new rule on any document, and that is why it went into the file
every session loads rather than into a skill. A rule living in a skill reaches the sessions that
load that skill, and that is the set which produced both passages.

The root instruction file now measures 1,977 words against the 2,000 `ARCHITECTURE.md` allows,
so 23 words of headroom are left for every rule after this one.
