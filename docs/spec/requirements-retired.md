ABOUTME: Requirements Rigger no longer holds, kept so a citation to a withdrawn id still resolves and so its id is never allocated again.

# Retired requirements

**Nothing here binds.** A row reaches this file when what it required stopped being true of
Rigger. It is kept for two reasons only:

1. A document still citing its id resolves to an explanation rather than to nothing.
2. The id is never allocated again.

`docs/spec/requirements.md` states when a requirement arrives here, and holds every requirement
that binds. A reader looking for what must be true reads that file and not this one. Only the
owner withdraws a requirement.

**The `requirement` column holds the row's exact text, unchanged.** A citation has to resolve to
what the row said, not to a later summary of it, so this file never paraphrases. `from` comes
across with it, because a withdrawn requirement's decision is the thread back to
`docs/spec/decisions.md`, and that decision may itself have been superseded. `made true by` and
`checked by` are dropped deliberately: a row that binds nobody is made true by nobody and is
checked by nothing.

`replaced by` names the requirement that took over, and is empty when a requirement was withdrawn
outright rather than superseded.

Ids allocated here still count as allocated. The duplicate-id check reads both files.

| id | requirement | from | withdrawn | replaced by |
|---|---|---|---|---|
| R-CARD-16 | — a fenced code block closes at the next line indented at most three spaces that holds only a run of at least as many of the same character; | D2 | 2026-09-25 | R-CARD-26 |
