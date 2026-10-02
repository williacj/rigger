ABOUTME: Journal for #532 (M4-02b): ARCHITECTURE.md's provider adapter paragraph gains one exception,
for the reach grants #520 makes, as architect ruling 10 on #467 proposes.

# #532 — one exception to "no setting that widens"

**Why the sentence changed.** #520 gives a Claude Code judge its `head` by route B of #519's report.
The adapter's `--settings` gains a `Read` rule, an `Edit` rule and a `cd` rule for each reached
directory, and the consumer's own settings declare none of them. Ruling 10 found that the sentence
"The adapter passes the CLI no setting that widens what the consumer's own provider settings allow"
forbids those grants as written. The sentence was meant to cover command permissions, and ruling 1
gave `reach` to `--add-dir` in the same ruling. But the text binds, and it named no exception.

**What the exception allows, and what it does not.** It allows reading, editing and changing into
a directory a dispatch reaches. It allows no command there that the consumer's settings do not
allow. So `head` gets the access a judge needs to build and test it, and every command run there
still rests on a rule the consumer declared.

**Order.** This is a proposal, and the owner's merge ratifies it (`D21`). #520's PR #531 merges only
after it, because merging #531 first would put code on `main` that contradicts `ARCHITECTURE.md`.

**Tightened under O55.** Both judges ruled the first wording sound and flagged two ambiguities
(PR #534). "A directory a dispatch reaches" was defined nowhere, so the sentence now defines it: one
Rigger gives the dispatch beside the directory it runs in, which today is only a judge's `head`
(`R-LOOP-14`, O3). "It allows no command there" could be read to forbid the `cd` grant, so the text
now says that changing into the directory is entry and allows no command. A reviewer of #531 noted
that `R-SAFE-8` lets a repository withhold a tool. The text therefore says the consumer's deny rules
still apply in a reached directory, so it cannot be read as overriding them. #531's revised code,
which refuses a reached real path outside a safe character set and a declared compound Bash rule,
stays within this wording.
