ABOUTME: Records why card #157's spent exemption granted nothing, what actually stopped the tracked
spike report being read, and the decision that a future spike report carries no exemption.

# The exemption was never what stopped it

Card #157 found that `doc-references.json` exempted `docs/spikes/` from reference resolution on the
stated reason that the directory is absent until a future WSL2 spike report lands, while
`docs/spikes/reserved-git-indirection.md` has been tracked since card #117. The reason was false
when it was written. Removing it was the obvious half. The half worth recording is that removing it
fixed nothing, because the exemption was never the thing keeping the report unread.

## What the exemption actually governed

`exempt.paths` is read by `scripts/path-check.mjs`, not by `scripts/doc-reference-check.mjs`, and it
excuses a path a *checked document names* from existing. It does not decide which documents get
read. So it could never have silenced the references inside a document under `docs/spikes/`; it
could only have excused some checked document from naming a file under that path.

It did not even do that. `path-check.mjs`'s `exempt()` covers a path only while its prefix is
missing from disk, so an exemption lasts exactly as long as the place it names does not exist. With
the directory tracked, the entry granted nothing to anyone. Measured on `origin/main` at `ab368cf`:
the only checked documents naming that path are `.claude/agents/spike-engineer.md` and
`templates/claude/agents/spike-engineer.md`, and both name the directory itself, which exists. `npm
run check:paths` reported 0 missing paths before the entry was removed and 0 after.

That is the shape worth remembering. A spent exemption is not a dormant risk that might bite later
— the mechanism had already retired it. What rotted was the reason a reader traces the entry back
to, and a reason that can never be true again is worse than no entry at all, because it reads as a
live grant over every file that will ever sit under that path.

What actually kept the report unread was plainer: `doc-references.json` did not name it. Measured on
`ab368cf`, the config named 23 documents and the tracked spike report was not among them, so `npm
run check:references` reporting `0 pointers, across the documents doc-references.json names` was a
true statement about 23 files and said nothing whatever about the report. This is card #152's fault
one layer up, and the reason the card's own framing needed correcting before the work could be
finished: had we only deleted the stale entry, the headline harm would have survived the fix intact,
with the acceptance arguably met.

## The decision on a future spike report

A spike's throwaway code never merges, but a report does, and later cards cite it. A reference that
has rotted inside one is precisely what the resolver exists to catch. So spike reports resolve like
any other merged document, and no spike report is exempt — not this one, and not the WSL2 report the
build plan anticipates. The reason that once justified an exemption, an absent directory, cannot
become true again now that the directory is tracked.

Stating that in prose would leave it for the next author to honour or miss, which is what item 4 of
the acceptance forbids. `doc-references.json` is JSON and carries no comment, so the statement is
made where the tooling can hold it: the report is a `strict` checked document, and a test reads the
tracked set under `docs/spikes/` from git rather than from a list. A future report merged without a
config entry now reds the build instead of going quietly unread.

## What checking it surfaced

Reading the report at last turned up two references naming nothing: `marker.log` and `s.sh` were
written as bare repository paths, when both were throwaway files the spike harness wrote under the
gitignored `/spikes/` directory — as the report's own closing paragraph says. Named for where they
actually were, they state the truth and stop claiming a repository file that never existed. The
alternative, an exemption for two filenames, would have been the widening the card forbade: it would
have excused those names in every checked document, permanently, since `exempt()` never expires for
a prefix that will never exist.

The report holds no `path:line` pointer, so it passed the resolver at `strict` the moment it was
read. That is the measurement behind the choice: the exemption was not load-bearing for the resolver
at all, and the only cost of checking the report was two references that were wrong anyway.

## What failed on the way

Writing the test body through a quoted shell heredoc put a real NUL byte into
`test/path-check.test.mjs` where the source meant the two-character `\0` escape. The test passed,
because a NUL splits `git ls-files -z` output exactly as the escape does, and `node --test` reported
11 of 11. Nothing in the suite could see it. What saw it was `git diff --stat`, which reported `Bin
4927 -> 6048 bytes`: git had classified a test file as binary, which would have hidden every future
diff of it. The lesson is narrower than "write scripts to disk", which the card already said: an
escape the shell mangles into a byte with the same runtime meaning leaves the suite green and the
repository wrong, so the check that catches it is reading the committed bytes, not running the test.
