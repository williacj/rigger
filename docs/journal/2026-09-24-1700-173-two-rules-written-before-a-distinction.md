ABOUTME: Records card #173's two AGENTS.md edits — the self-hosting rule's paths and the
ARCHITECTURE.md routing — the two enumerations behind them, and what was found and left alone.

# 2026-09-24 — Two rules written before the distinction that governs them

Card #173 fixed the same defect twice in one file. Both sentences were written before a
distinction existed, and both are now read by sessions the distinction governs.

## The self-hosting rule named roles and never named files

`AGENTS.md`'s "Self-hosting" said the engine never merges a change to its own live gate, config or
CLI entry point, and left a reader to infer which files those are. Card #52's maker inferred that
the live `rigger.config.mjs` was beyond reach while `templates/rigger.config.mjs` was fair game,
then measured that `test/init.test.mjs` binds the two byte for byte. It escalated as `ambiguous`
and the card lost its item 10.

The rule now names the three by path and puts the template in the list, because that is the answer
the measurement gives: a change to the template is a change to the live config whichever file the
card opens. Naming the live file alone and adding a caveat was the other admissible answer, and it
was not taken — the list is what a reader acts on, and a caveat beside a list is the thing a reader
skips.

What the rule forbids is unchanged. Nothing was subtracted, and the exception mechanism is still
`AGENTS.md` rule #1, which the owner used twice on 2026-09-24.

### Which files the suite binds, and how that was found

Exactly one: `templates/rigger.config.mjs`, bound to `rigger.config.mjs` by `test/init.test.mjs`.

Found by two methods rather than one, because the first cannot prove a negative. A sweep of every
whole-file comparison in `test/` found one comparison of two repository files — `divergences` in
`test/init.test.mjs`, which reads a file and compares it against what `plan` would write. Then a
mutation probe on each of the three paths, each guarded on a named blob and restored byte-exact:

| Probe, at `06ca7e6` | Command | Result |
|---|---|---|
| `templates/rigger.config.mjs` alone | `node --test test/init.test.mjs` | exit 1, naming `rigger.config.mjs` |
| `rigger.config.mjs` alone | `node --test test/init.test.mjs` | 15 pass, 2 fail |
| `.githooks/pre-commit` alone | `npm test` | exit 0 |
| `src/cli/rigger.mjs` alone | `npm test` | exit 0 |

So the binding is two-way on the config and absent on the other two paths. The enumeration lives in
the pull request rather than in `AGENTS.md`: a binding document has no business asserting a sweep's
result, and the sweep would age.

## The other sentence routed an `ARCHITECTURE.md` delta to whoever read it

"When you write a decision or a requirement" opened by telling every session that a delta to
`ARCHITECTURE.md` or `docs/spec/` was its to propose. `D18` rule 1 gives every such delta to the
architect, which became dispatchable when PR #175 merged as `06ca7e6`.

The sentence was split rather than patched. A first sentence routes: `D18` rule 1 for
`ARCHITECTURE.md`, rule 7 for a requirement. A second sentence carries the obligation without
re-opening the routing — a delta is a proposal whoever wrote it, it goes to the owner, and nobody
ratifies their own.

Splitting was the point. One sentence could route `ARCHITECTURE.md` to the architect only by also
saying something about `docs/spec/`, and `D18` ratified nothing that hands either register to the
architect: rule 7 says no role owns the requirements, and the decisions register `D18` reaches only
by implication through rule 2. Card #161's maker flagged that implication as a reading rather than a
clause, and PR #175's judge ruled only the narrow version sound. Two sentences assert exactly what
was ratified and no more.

### The transitional fact, and why it is here rather than in `AGENTS.md`

`D18` rule 1 bound before the architect could be dispatched, and card #176's delta to
`ARCHITECTURE.md` was written inside that window. The window shut when PR #175 merged. That fact is
recorded here because `AGENTS.md` holds what is true in every session, and a closed window is not.

## Found and left alone

Two sentences route a structural question to an actor chosen before `D18`: "A need that fits no
extension point is a design conversation, not a workaround", and "Any architectural decision, or
contradicting a recorded one" under "Ask the owner before". Neither names a wrong actor — the owner
still ratifies — and neither tells a session that an `ARCHITECTURE.md` delta is its to write, so
neither carries this card's defect. Both sit in sections card #173's acceptance fenced off, and both
were left untouched.

The search that found them looked for the act of authoring rather than for a document's name:
`propose`, `ratify`, `author`, `write`, `draft`, `edit`, `change`, `amend`, `allocate`, `retire`,
`delta`, `rewrite`, `withdraw`, `record`, `file`. That is the method card #161's maker needed, whose
find at `proposal/SKILL.md` never named the document it routed.
