ABOUTME: Records that a path exemption's prose reason is not machine-readable in general, that
every reason ever written here nonetheless asserted the one proposition the mechanism acts on, and
why card #169 checked that proposition rather than the sentence carrying it.

# The reason asserts one thing a check can read

Card #169 asked whether an exemption's stated reason can be checked at all. The answer is mixed,
and the useful half was not obvious before measuring.

## What was there

Measured with `git show 8dd7950:doc-references.json` parsed by `node`, at `origin/main` `8dd7950`:
`exempt.paths` holds **zero** entries, and `documents` holds 24. So there was no live exemption to
read a reason off, and a check written today runs against an empty set.

The population worth measuring was therefore the historical one. `git log --follow` over
`doc-references.json` shows two exemptions have ever existed, and both are retired:

| Prefix | Stated reason | Retired by |
|---|---|---|
| `docs/derived/` | `D8` rule 4; the directory is created by the first generated document, so nothing under it exists until the test matrix lands | `98523dd`, by hand, once the directory arrived |
| `docs/spikes/` | `docs/v0-build-plan.md` section 5 places a future WSL2 spike report here; the directory is absent until that report lands | `9e1a2a4`, card #157, after a judge read the prose |

Neither was retired by a check. The first was noticed by whoever happened to create the directory;
the second was false from the day it was written and survived until a judge read it.

## The half that cannot be checked, and the half that can

A reason is a prose sentence, and no check parses one. Both reasons above carry clauses nothing
could evaluate: a citation to `D8`, a claim about what another document places somewhere, a
commitment that the entry goes when the condition lifts. Reading those is a reader's job and
staying a reader's job is the honest finding.

What both reasons also did was restate the single proposition the mechanism acts on. `exempt()`
covers a path while its prefix is missing from disk, and nothing else retires an entry, so **the
absence of the prefix is the whole of what an exemption can mean**, whatever sentence sits beside
it. That proposition is a filesystem question. Both retired reasons went false in exactly that way,
which makes it the class of falseness that has actually occurred here rather than one imagined for
the occasion.

So `spentExemptions()` reports an exemption whose prefix the repository now holds, and reports
nothing else. It reads the keys, never the sentences. The prose remains unread, and the obligation
the prose carries remains a reader's.

## Why it is not allowed to flag a correct entry

An exemption whose prefix is still absent is doing its job, and a check that complained about it
would pay the next author to delete a legitimate entry to quieten the build — the failure card #157
was told to avoid. That is why the predicate is prefix-exists rather than anything softer, and why
a test asserts the quiet direction alongside the loud one.

## Where the check lives, and what that costs

It lives in `test/path-check.test.mjs`, beside the two tests that already assert properties of
`doc-references.json`, rather than in the `check:paths` command. Two reasons. The findings
`check()` returns are document coordinates and a spent exemption has no line to report, so wiring
it there meant widening that shape and its failure message for a population of zero. And card #157
recorded its own decision in a test for the same underlying reason: the config is JSON, which
`AGENTS.md` exempts from the `ABOUTME:` rule because it has no comment syntax to carry one, so a
test is where a statement about that file can live.

The cost is real and worth naming: `npm run check:paths` exits zero with a spent exemption present.
Only `npm test` reports one. Since `npm test` is what the gate runs, the obligation is enforced
where it counts, but an author running the check alone after adding an exemption will not hear
about it.

## A verdict count proves nothing here

The demonstration injected a false reason for `scripts/`, a directory that plainly exists. Both
that run and a deliberately corrupted `doc-references.json` let all 14 tests in the file reach a
verdict. The corrupted config produced four failures and no `AssertionError`; the false reason
produced one failure, named, as an `AssertionError` reporting `scripts/`. The count was identical
and useless. What separated them was parsing the config, confirming the injected key, and reading
which test failed and on what.

## Left alone

`exempt.paths` bounds nothing on its own: an exemption can only ever excuse a path that one of the
24 checked documents names. So today's empty set is partly a fact about how narrow that set is, not
only about the repository's paths being sound. Which documents belong in the set is card #157's
other finding and still nobody's card.
