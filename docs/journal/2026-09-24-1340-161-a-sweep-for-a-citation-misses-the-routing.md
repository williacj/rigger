ABOUTME: Card #161 — staffing the architect `D18` names, and the two sweeps the instruction pool
needed, because searching for a retired citation never finds the instruction that routes without
citing anything.

# Card #161: a sweep for a citation misses the routing

`D18` gave v0 an architect and `ARCHITECTURE.md` published a config shape naming it. Neither
config file declared the role, no prompt existed at the path the shape names, and six live
instruction sites still cited the decision `D18` superseded. Four pieces that only work together,
and the card said so.

## Two defects, two sweeps, and only one of them is a search for `D4`

The card's table listed six live sites citing `D4`, in two classes: three citing rule 3, which
told a role that a structure delta comes from whichever role needs it, and three citing rule 2,
which is now `D18` rule 7 carried forward unchanged.

The enumeration confirmed all six and found no seventh. It was run as a script over every file
under `.claude/` and `templates/claude/`, matching four spellings — `D4` with a non-digit right
boundary so `D40`-`D49` cannot masquerade as it, `D-4`, `D04`, and "decision 4" or "decision four"
in words — and then printing every decision id cited anywhere in both trees so the result could be
checked rather than trusted. Six live sites, six twins, and every other id cited is `Ratified`.

That sweep is complete for what it searches and blind to half the defect. Acceptance item 8 bars a
live instruction from routing an `ARCHITECTURE.md` delta to a role other than the architect, and
two sites did exactly that while citing nothing at all:

| Site | What it said | Why the `D4` search missed it |
|---|---|---|
| `.claude/agents/pm.md:66` | The engineer "writes the `ARCHITECTURE.md` deltas you do not" | Names a role and a document, cites no decision |
| `.claude/skills/proposal/SKILL.md:59` | "the owner and the engineer write it" | Names two roles, cites no decision, and never names the document in that clause |

Finding them took a second sweep with a different subject: every mention of `ARCHITECTURE.md`
anywhere in the live pool, twenty-three lines, read one at a time and sorted into reading the
document and authoring a delta to it. Twenty-one were reading. Two were authoring.

The general shape is worth keeping. A citation sweep finds the sentences that name the thing that
changed. A defect that predates the citation, or that was written in plain English beside it, is
invisible to that search and needs a sweep whose subject is the artifact being routed.

## A negative fixture stops testing anything when the repository grows into its stand-in

`test/config.test.mjs` asserted that a kind whose maker is no declared role earns a refusal naming
it, and stood the unknown maker up as `architect`. Declaring the `architect` role made that test
pass on a config it no longer described: the fixture named something the config now has, so the
assertion proved nothing and said nothing about it.

The test was not deleted and the behaviour it proves did not change. The stand-in did, to
`adjudicator` — the role `D18` defers and names what returns. A negative fixture wants a name the
repository is committed to not having, and a deferred role is a name a decision keeps free.

## The live config was derived rather than typed

`test/init.test.mjs` compares this repository's root config against what `init` would write from
the template, byte for byte. So the live file was not edited by hand: it was written as the content
`init`'s own `plan` produces from the template with `repo` and the board number filled in. The
comparison then passes by construction rather than by careful typing.

The run was guarded on the file starting as the blob whose LF form hashes to `f063a853`, on each
anchor `init` fills appearing exactly once in the template, and on a re-read of what was written
matching it byte for byte. `git hash-object` was not the guard, because it applies the clean filter
and a pure line-ending change passes it unchanged; the hash above is of the LF form, taken after
normalising, and the file on disk is CRLF like everything else here.

Card #52's measurement of the ordering held exactly. Template role added with the prompt forked
both sides and no live config: 15 pass, 2 fail in `test/init.test.mjs`. The two failures are the
divergence checks, and only the live config closes them.

## What this card could not finish, and who it belongs to now

The prompt does not fit. The live pool was 12,551 words of 13,000 before and is 13,683 after, so
it is over by 683. The card ruled the budget reported rather than fitted, and barred trimming
another instruction file to make room, so nothing was trimmed.

Raising the figure is a delta to `ARCHITECTURE.md:300`. Which is to say: the first thing the
architect this card staffs could be dispatched for is the budget change its own prompt caused. The
role is not a formality standing between the PM and a card — it has work waiting the moment it
exists.

## Measurements

Every figure is measured in a fresh clone taken from the GitHub URL, with `core.hooksPath` set to
`.githooks`. Before is branch base `2261203`; after is `cc8205e` on branch
`m0/161-architect-prompt-and-config`, which is the last commit that changes anything measured
here. The commit carrying this entry adds a journal file and nothing else, so it spends none of
the instruction pool and changes no count in the table.

| Figure | Tool | Before (`2261203`) | After (`cc8205e`) |
|---|---|---|---|
| Suite | `npm test` | 325 tests, 325 pass, 0 fail | 325 tests, 325 pass, 0 fail |
| Live instruction pool | `npm run budget:instructions` | 12,551 of 13,000 | 13,683 of 13,000 |
| `AGENTS.md` pool | `npm run budget:instructions` | 2,084 of 2,500 | 2,084 of 2,500 |
| `.claude/agents/architect.md` | `npm run budget:instructions` | absent | 1,078 words |
| Live sites citing `D4` | the sweep script below | 6 | 0 |
| Spec-style findings | `npm run lint:spec-style` | 0 | 0 |
| Broken references | `npm run check:references` | 0 | 0 |
| Missing backticked paths | `npm run check:paths` | 0 | 0 |
| Ids allocated twice | `npm run check:ids` | 0 | 0 |
| Ruled-out word findings | `npm run check:words` | 0 | 0 |
| `ABOUTME:` header findings | `npm run check:headers` | 0 | 0 |
| Requirements with no test | `npm run matrix:check` | 91 of 99 | 91 of 99 |

The sweep script is throwaway and was not merged. It walked `.claude/` and `templates/claude/`,
applied the four spellings above line by line, and printed every decision id it saw with a count.
The matrix figure is unchanged because this card adds no requirement row: what must be true of
Rigger did not change, only who does the work, which is configuration and a ratified decision.
