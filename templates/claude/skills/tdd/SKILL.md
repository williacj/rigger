---
name: tdd
description: Write code test-first — a failing test, the minimal code that passes it, then refactor while green. Use before the first test body of any change to source, for every bug fix, when claiming that a mutation shows a test discriminates, and when deciding what a test must declare about the requirement it proves.
---

ABOUTME: The failing-test-first loop this repository requires, what counts as a real red, what
makes a test worth keeping, what a mutation claim must show before it is evidence, what a test
declares about the requirement it proves, and the rules on sleeps, deleted tests and spikes.

# Test-driven development

`AGENTS.md`'s "When you write code" section requires this loop. This skill is how to run it.

`AGENTS.md`, "Before you start", governs the state of the suite before you begin work.

## The loop

**Red.** Write one failing test for the next smallest piece of behaviour, and run it. Watch it
fail, and read the failure. A test that has never failed has proved nothing — it may be
asserting on the wrong thing, or on nothing.

Red counts only when the test you meant to write actually ran, or reached the compile-time check
you meant it to reach, and failed because the behaviour you asked for is missing or wrong. A
syntax error, a broken fixture, a missing dependency or an unrelated failure is not red: it is a
test you have not managed to run yet. Clear it, then go and get the failure you meant.

**Green.** Write the minimal code that makes it pass, then rerun that same target and watch it
pass. Minimal is not a style note: anything beyond what the test demands is code no test asked
for. Put it where `ARCHITECTURE.md` says it lives (`AGENTS.md`, "When you write code").

**Refactor.** Improve the code while the suite stays green, rerunning the affected tests after
each step. Extract rather than copy-paste, by the Rule of Three (`AGENTS.md`, "Any role"). Follow
`AGENTS.md`, "Before you start", for deterministic verification before commit and host evidence
before handoff; a focused pass alone does not meet those obligations.

Then the next test, and one slice at a time: finish red, green and refactor for one behaviour
before you write the next test. Never batch the tests and then batch the implementation —
test-first means one test ahead of the code, not the whole suite ahead of it. Small steps, often:
the loop's value is the failure you saw, and a large step throws it away.

## A test worth keeping

The core below implements `AGENTS.md`, "When you write code"; the worked example is craft.

**Name the break before the body.** State the observable behaviour and plausible defect the test
must catch. Test the narrowest stable public or architectural boundary. Private call counts and
source layout are not behaviour unless the contract makes them so.

**Derive the expected value independently.** Use the requirement, a worked example or a checked
literal, never the production algorithm or its helpers. Failing first cannot expose an oracle
that later agrees with the implementation by construction.

**Derive doubles independently too.** Use observed responses or documented collaborator
contracts, never the assertion's expected value. Record that source where the double is defined.

**Separate algorithm and host proof.** Inject clocks to force algorithmic timing decisions.
Retain real-host checks for changed wiring, tool/OS contracts and real deadlines. A logical clock
cannot prove an OS deadline. Identify any boundary left unproved; a fake pass earns no host credit.

**Establish the premise.** Observe fixture readiness with a condition before starting the
behaviour's timer when readiness is its premise. Keep startup within the bound when startup
itself is the contract. A readiness failure is not a failure of behaviour never exercised.

**Keep the authority live.** Where a tool decides a fact (`D16`), assert the relation between its
answer and the code's, rather than pinning today's answer. `test/package-budget.test.mjs` is a
worked example: a fixed answer documents today; asking the tool catches a changed authority.

## A mutation claim

Deleting a line, flipping a condition or breaking a value and watching a test red is how you
learn whether that test discriminates. Acceptance items in this repository have already been
settled on such a claim, which makes the claim evidence — and **a mutation is evidence only once
it is shown to have applied.** An unguarded mutation reports either answer regardless of the
truth, and neither way it lies is visible in the output.

- **A mutation that did not apply** runs the unmodified code and reports green. Read as a result
  it says the test does not discriminate, which is the opposite of the truth, invented.
- **A mutation that stops the run reaching a verdict** — a file it broke, an import that now
  throws, a loop that never ends — is booked by `node --test` as one failing test named after the
  file. Read as a result it says the test discriminates, when nothing was tested at all.

A green suite after a mutation that never landed looks exactly like a green suite after one that
landed uncaught, and a run that never reached a verdict looks exactly like a test failing for the
reason you wanted. So show all of these, for each mutation, before you say what it proved:

1. **The anchor was there.** The pattern you replaced occurred the number of times you expected.
   Zero occurrences is a write that changed nothing and a run that reports green. An anchor from
   an earlier round goes stale when a neighbouring edit rewraps the line it spans, even where the
   rule it names is unchanged. Resolve its whitespace against the file's bytes, which covers the
   rewrap and the line ending together.
2. **The replacement landed.** Read the bytes back off disk rather than trusting the edit, and
   have `git diff` show them.
3. **The mutant still runs.** The run reached a verdict on the tests you aimed at: it reported
   the number of tests that target normally reports, and what it names are tests rather than the
   file. `node --check` is a cheap pre-filter and not this check — a mutant that parses and loads
   can still hang or end the test process another way, and the runner then books the whole file
   as one failing test, named after the file with no assertion under it. That is the same output
   a discriminating red has, so the count is what tells them apart.
4. **The mutation did what it meant.** Read the mutated value or behaviour back and say what it
   now is. A diff proves an edit, never an effect: a replacement can land, parse, and mutate
   something other than what you meant.
5. **The report names the tests and the assertions.** Which tests failed, and on which
   assertion. A pass or fail count is the weakest signal there is, because both failures above
   produce a plausible one, and reading the messages is what tells *redded for the right reason*
   from *redded at all*.
6. **The original is back.** Restored byte-exact, with `git status` for the file clean, before
   the next mutation and before any commit.
7. **A failed guard exits non-zero.** A guard that reports a result it could not vouch for is
   itself the defect.

One mutation removes one behaviour. Batching several reports the union and hides the gap.

`test/verify-mac-containment` guards its bounded Mac claims: anchors, readback/diff, named
assertion verdicts without cancellation, observed effects, restoration and retained artifacts.
Those mechanics do not decide whether a mutation represents the right semantic fault or covers
the claim. The judge still evaluates that scope. `test/mutation-claim.test.mjs` checks the stated
bar, not its use.

Preserve byte-complete originals with command, executed ref and provenance. Concatenated stdout
and stderr are aggregate output, not evidence of cross-stream causal order. Use an ordered
observer or synchronization where the claim depends on that order.

## A bug fix

Reproduce the bug as a test first (`AGENTS.md`, "When you write code"), watch it fail for the
reason you think it fails, and only then fix it. If the test passes before you touch the code,
you have not reproduced the bug and you do not yet know what it is.

Root cause only (`AGENTS.md`, "Any role"). Where a fix did not work, revert it before you test
the next hypothesis.

## Never delete a failing test

A failing test is a claim that something is wrong. Deleting it deletes the claim, not the fault.
Fix the code, or raise the test with the owner (`AGENTS.md`). The same holds for weakening an
assertion until it passes.

With explicit prior owner authorization, remove a redundant live body only with an inspectable
mapping from each protected behaviour to controlled replacement proof and retained real-boundary
coverage. Removed host proof without replacement remains unmet. A failing test's claim must
still be resolved; calling it redundant does not resolve it.

## No sleeps

`AGENTS.md`, "When you write code", bars a sleep in a test. A sleep is either too short, and
the test is flaky, or too long, and the suite is slow — and it is usually both on different
machines. If a component needs the time, it takes a clock.

Prefer fast and deterministic, and log clearly enough that the failure message alone says what
broke.

## What a test declares

Each test declares the requirement it proves. A tool builds `docs/derived/test-matrix.md` from
those declarations, so the matrix is generated and never hand-edited (`D8`). A requirement the
register gains needs a test that claims it (`D17` rule 1). A judge enforces that (`D17` rule 7),
so expect no check to catch it for you. One
the register already held is a counted gap, which the matrix counts and the build does not red
on, and `D17` holds the difference and when each gap closes.

A declaration is a `// proves R-GROUP-#` comment on the line directly above the test it speaks
for, naming as many ids as that test proves, separated by commas. `npm run matrix` rebuilds the
matrix and `npm run matrix:check` refuses one that has gone stale, so the declarations a piece of
work adds are regenerated and committed with it. A declaration naming an id
`docs/spec/requirements.md` does not hold is refused by name, and so is one standing above no
test — a call that is commented out is not a test.

The scan reads the source as the syntax it is, so a fixture in a test claims nothing whatever
shape it takes, and no shape needs working around:

| A fixture written as | What the scan makes of it |
|---|---|
| a single-line string, with `\n` escapes | one string token; claims nothing |
| a template literal spanning lines | one token, lines and all; claims nothing |
| a string continued with a trailing backslash | one token; claims nothing |
| the text inside a block comment | a comment; claims nothing |
| a run of line comments | a comment — except that a `// proves` line among them is still a declaration, and is refused for standing above a comment rather than above a call |

Shapes it refuses rather than claims, each naming the file and the line:

| Shape | Why it is refused |
|---|---|
| a declaration above a call the file nests, a `describe` block included | whether the runner reaches an enclosed call is not a question about tokens |
| a call to a `test` or `it` the file binds itself, or never binds at all | `node --test` installs no global, so only a name imported from `node:test` reaches the runner |
| a title the call builds from more than one quoted run — a `+`, a `${}` | the title is then not that string, and half a title names no test |
| a title carrying an escape the scan does not decode | the string the runner registers is not known |
| a title carrying a line ending | a matrix row is one line, so it cannot carry the title |
| a title carrying a `\|` | the pipe divides the two cells of a matrix row |
| a title carrying `U+2028` or `U+2029` | each is a JavaScript line separator, so a matrix row cannot carry it |
| a runner import through a re-export chain | the local import names the bridge, so proving its identity would require tracing another file |
| `test(...args)` | the title is in the spread value, not in a quoted argument the reader can see |
| `(test)('x', …)` | the callee is an expression rather than the directly bound name the reader checks |
| a dynamic `import('node:test')` binding | the reader does not establish which name the awaited import binds |
| `require('node:test')` in a .cjs file | `require` can be rebound, so its call alone does not establish the runner binding |
| a namespace member call | the reader does not establish both the namespace binding and member identity |
| `?.()` on a runner binding | an optional call can be skipped, so the direct-call rule cannot prove it ran |
| a `String.raw` title | the tag determines the registered string, which the plain-title decoder does not read |
| a `/` directly after a `}` | a division after an object literal and a regular expression after a block are one token apart, and the grammar above them decides which |
| a quoted run or a comment the source leaves open | it is not source that parses |

What it gets wrong: a declaration above a top-level call the module never finishes reaching is
claimed all the same. A `throw`, a `process.exit`, a rejected top-level `await` and a hang all land
there, because in each the source is complete and it is the run that stops. That is a question
about running the module rather than reading it. A wrong claim is a defect; a source-decidable
refusal in the table is a visible cost of keeping the reader bounded.
`scripts/build-test-matrix.mjs` states the same set beside the code, in the block comment above
`declarationsIn`. That copy governs where the two disagree, because it is the reader that refuses.
The existing parser cases live in `test/build-test-matrix.test.mjs`; the added call shapes were
measured with the runner and recorded in `docs/journal/2026-09-23-1638-119-matrix-refusals.md`.

So when you add a requirement, the test that claims it is part of the same work. Where your card
is what makes an older requirement true, its test closes that requirement's counted gap in the
same work (`D17` rule 6). And when you write a test, name the requirement it proves rather than
leaving the matrix to guess.

Tests do not count toward the package line budget (`ARCHITECTURE.md`, "Budgets"). That is not a
licence to write more of them: every test costs execution time and maintenance, so each one
still has to protect a concrete behaviour.

## Spikes

A spike card is exempt from this loop (`AGENTS.md`, "When you write code"). What the spike
produces is the report its acceptance describes, not the code that got there.
