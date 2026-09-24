ABOUTME: Card #52 — the decision that staffs an architect and names the PM as the decomposer, and
the two config files the repository's own test makes one artifact.

# Card #52: the register could be changed, and the configuration could not

The card asked for one decision settling three things: which role decomposes larger work, whether
v0 has an architect, and what that architect decides that no other role may. The owner had already
ruled the architect gate design intent rather than a response to pain, so `D4` rule 3 was replaced
rather than waited out.

The decision was the easy half. The configuration that makes it do anything is the half this
repository cannot merge.

## Superseding an entry retires everything in it

`D4` held three rules. Rule 3 was the one being replaced; rules 1 and 2 still hold. The register's
preamble is strict that a change to what a ratified rule means is a supersede rather than an
amendment, and a supersede moves the whole body out. So `D18` had to carry `D4` rules 1 and 2
forward unchanged, and both of `D4`'s surviving deferred rows with them, or superseding it would
have silently unbound an adjudicator deferral nobody asked about.

That is worth noticing about the preamble's lifespan rule — "a permanent principle and a boundary
that expires never share an entry". `D4` complied: all three of its rules were deferrals, so its
lifespan was uniform. The cost landed one entry later, on the decision that ends only one of the
three deferrals.

## The live config and the template are one artifact, by test

The card's item 10 asked for `templates/rigger.config.mjs` to staff the roles the decision adds.
The task's instruction, and `AGENTS.md`, "Self-hosting", said the live `rigger.config.mjs` at the
root is the owner's by hand. Those read as two separable files. They are not.

`test/init.test.mjs`, "this repository holds exactly what init produces for it, and nothing else",
compares this repository's root config against what `init` would write from the template, byte for
byte once `repo` and the board number are filled in. So a change to the template with no matching
change to the live config reds the suite, and a red suite is a commit `.githooks/pre-commit`
refuses. The rule that the engine never merges a change to its own live config therefore reaches
the template too, which no document states.

Measured on branch `m0/52-who-decomposes-and-the-architect` in a fresh clone taken from the GitHub
URL, base `ab368cf`. One line added to `templates/rigger.config.mjs` naming an `architect` role,
nothing else changed:

| Probe | Tool | Result |
|---|---|---|
| Template role added, no prompt, no live config | `node --test test/init.test.mjs` | 14 pass, 3 fail |
| Template role added, prompt forked both sides, no live config | `node --test test/init.test.mjs` | 15 pass, 2 fail |

The third failure in the first row is `init.test.mjs:157`, which asks that every role the written
config names reads a prompt `init` put in the repository. Forking the prompt to both
`templates/claude/agents/` and `.claude/agents/` closes it. The two that survive both rows are the
divergence checks, and only the live config closes those.

So item 10 is not deferrable work and not maker work either. It is one edit spanning a file the
maker may write and a file only the owner may, and the suite refuses either half alone. The card
was escalated rather than guessed.

## The prompt was tight on budget before anyone wrote a word

Item 12 let the prompt be deferred to a named card, and the measurement says that was the right
call for a second reason nobody had raised. Measured with `npm run budget:instructions` in the same
fresh clone at `ab368cf`: the live instruction pool is 12,572 words against a budget of 13,000, so
428 words of headroom. `.claude/agents/pm.md` is 960 words at that ref. An architect prompt of
comparable weight does not fit, and the check charges `.claude/` while exempting `templates/`, so
the fork is free and the live copy is not. Card #161 carries the figure and the two ways out.

## What the proposal did not add

No requirement row. What must be true of Rigger did not change: `README.md` already promised
decomposition and `R-CARD-3` already obliged the decomposing role to write each card's acceptance,
naming the duty rather than the role. What changed is who does the work, which is a role and a kind
of work — L4 configuration and a recorded decision, not a condition observable from outside.

## Measurements

Every figure below is measured on branch `m0/52-who-decomposes-and-the-architect` in a fresh clone
taken from the GitHub URL, against base `ab368cf`.

| Figure | Tool | Before | After |
|---|---|---|---|
| Suite | `npm test` | 307 pass, 0 fail | 307 pass, 0 fail |
| Spec-style findings | `npm run lint:spec-style` | 0 | 0 |
| Ids allocated twice | `npm run check:ids` | 0 | 0 |
| Requirements with no test | `npm run matrix:check` | 91 of 99 | 91 of 99 |
| Ruled-out word findings | `npm run check:words` | 0 | 0 |
| Live instruction pool | `npm run budget:instructions` | 12,572 of 13,000 | 12,572 of 13,000 |

The pool is unchanged because nothing here touches `.claude/`. The matrix figure is unchanged
because the decision adds no requirement row.
