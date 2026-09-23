---
name: tdd
description: Write code test-first — a failing test, the minimal code that passes it, then refactor while green. Use before the first test body of any change to source, for every bug fix, when claiming that a mutation shows a test discriminates, and when deciding what a test must declare about the requirement it proves.
---

ABOUTME: The failing-test-first loop this repository requires, what counts as a real red, what
makes a test worth keeping, what a mutation claim must show before it is evidence, what a test
declares about the requirement it proves, and the rules on sleeps, deleted tests and spikes.

# Test-driven development

`AGENTS.md`'s "When you write code" section requires this loop. This skill is how to run it.

Before you start anything, `npm test` is green. Red means stop: fix it, commit the fix on its
own, then start the work (`AGENTS.md`, "Before you start").

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
for. Put it where `ARCHITECTURE.md` says it lives; a need that fits no extension point is a
design conversation, not a workaround.

**Refactor.** Improve the code while the suite stays green, rerunning the affected tests after
each step. Extract rather than copy-paste, by the Rule of Three (`AGENTS.md`, "Any role"). Run
the whole `npm test` suite before you commit — `AGENTS.md`'s "Before you start" forbids
committing or pushing with a failing suite, and one focused target passing is not that.

Then the next test, and one slice at a time: finish red, green and refactor for one behaviour
before you write the next test. Never batch the tests and then batch the implementation —
test-first means one test ahead of the code, not the whole suite ahead of it. Small steps, often:
the loop's value is the failure you saw, and a large step throws it away.

## A test worth keeping

None of this binds. `AGENTS.md` states the loop; this is the craft that decides whether running
it bought anything.

**Test behaviour at the narrowest stable interface** — a public entry point, or a boundary
`ARCHITECTURE.md` names. A refactor that preserves the behaviour should not need the test
changed. Assertions about private structure, or about which collaborator was called how, are
assertions about today's implementation, unless that interaction is itself the contract. Prefer
real collaborators, and substitute only what is slow, nondeterministic, or across an external
boundary.

**Name the break before you write the body.** What plausible production defect should make this
test fail? If the only answer is that someone renamed a private method, moved the source text
around, or called a mock differently, the test guards an implementation detail and will cost
more than it catches.

**Derive the expected value independently** — from the requirement, from a worked example, or
from a literal you checked by hand. Never compute it with the production algorithm or one of its
helpers: a test that asks the code what the answer should be agrees with the code by
construction, and passes just as happily once the code is wrong. Failing first does not catch
this one, because such a test fails before the code exists and passes for ever after.

**Derive what a double returns, too.** "Derive the expected value independently" is the rule
above; this is its other half. A double returning what the assertion expects agrees with your
assumption by construction, and that argument carries over unchanged. Take the value from the
real collaborator — a recorded response, a shape its interface guarantees, a literal you read
from the real thing — never from what makes the test pass. Failing first misses this one for the
same reason.

**Something exercises the real wiring.** A suite green against doubles everywhere can compose
into software that has never run, and every unit test goes on passing while it does.
"Prefer real collaborators" is a preference; this is the floor under it. Where you substitute
across a boundary, one test crosses it for real, in the same work rather than a follow-up. Where
it cannot be crossed in a test, say so where the substitute is defined, so the next reader knows
what is unproven.

**Assert the relation to an authority, not the answer it gives today.** Where code depends on a
tool or command outside it, `D16` has that tool decide the fact and the code carry at most a copy.
Write the test that ties the two so that it asks the tool and asserts the relation between its
answer and the code's. A test pinning the answer the tool gives today goes stale the moment the
tool changes it, and it goes stale green. Nothing in such a test is tied to the tool, so it agrees
with the copy it was written beside for ever.

For a worked example, read `test/package-budget.test.mjs`, which covers one fact both ways. Look
for the difference the two kinds make. A test that pins the tool's answer is the readable one and
says what that answer is today, while a test that asks the tool is the one that fails when the
answer moves.

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
   Zero occurrences is a write that changed nothing and a run that reports green.
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

No check can tell whether you ran any of this, and none is coming: requirement 4 is a different
question for every mutation, which is why there is no helper here to reach for.
`test/mutation-claim.test.mjs` holds this bar in place and enforces nothing about its use, so it
is a bar you hold yourself to and a judge reads your claim against.

## A bug fix

Every bug fix starts with the failing test (`AGENTS.md`). Reproduce the bug as a test first,
watch it fail for the reason you think it fails, and only then fix it. If the test passes before
you touch the code, you have not reproduced the bug and you do not yet know what it is.

One hypothesis at a time, and the smallest test that discriminates between it and the next one.
Root cause only: never stack a second fix on a first that did not work — revert it and test the
next hypothesis (`AGENTS.md`, "Any role").

## Never delete a failing test

A failing test is a claim that something is wrong. Deleting it deletes the claim, not the fault.
Fix the code, or raise the test with the owner (`AGENTS.md`). The same holds for weakening an
assertion until it passes.

## No sleeps

Tests use injectable clocks and condition-based waits, never a sleep (`AGENTS.md`). A sleep is
either too short, and the test is flaky, or too long, and the suite is slow — and it is usually
both on different machines. If a component needs the time, it takes a clock.

Prefer fast and deterministic: fail fast, and log clearly enough that the failure message alone
says what broke. Never log a secret (`AGENTS.md`).

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

Eight shapes it refuses rather than reads, and each refusal names the file and the line:

| Shape | Why it is refused |
|---|---|
| a declaration above a call the file nests, a `describe` block included | whether the runner reaches an enclosed call is not a question about tokens |
| a call to a `test` or `it` the file binds itself, or never binds at all | `node --test` installs no global, so only a name imported from `node:test` reaches the runner |
| a title the call builds from more than one quoted run — a `+`, a `${}` | the title is then not that string, and half a title names no test |
| a title carrying an escape the scan does not decode | the string the runner registers is not known |
| a title carrying a line ending or a `\|` | `docs/derived/test-matrix.md` is a pipe table: a row is one line, and its cells are what the `\|` characters divide, so no row can carry either |
| a call reached any way but through a plain name a `node:test` import bound — a dynamic `import`, a `require`, a namespace member, `?.()`, or a `String.raw` title | reading those would take more of the grammar than this does; each is measured, and each costs a refusal rather than a claim |
| a `/` directly after a `}` | a division after an object literal and a regular expression after a block are one token apart, and the grammar above them decides which |
| a quoted run or a comment the source leaves open | it is not source that parses |

What it gets wrong: a declaration above a top-level call the module never finishes reaching is
claimed all the same. A `throw`, a `process.exit`, a rejected top-level `await` and a hang all land
there, because in each the source is complete and it is the run that stops. That is a question
about running the module rather than reading it; what the source decides is decided, and a shape
the source decides that the scan reads wrongly is a defect rather than a limit.
`scripts/build-test-matrix.mjs` states the same set beside the code, and
`test/build-test-matrix.test.mjs` puts every row of it to a constructed input.

So when you add a requirement, the test that claims it is part of the same work. Where your card
is what makes an older requirement true, its test closes that requirement's counted gap in the
same work (`D17` rule 6). And when you write a test, name the requirement it proves rather than
leaving the matrix to guess.

Tests do not count toward the package line budget (`ARCHITECTURE.md`, "Budgets"). That is not a
licence to write more of them: every test costs execution time and maintenance, so each one
still has to protect a concrete behaviour.

## Spikes

A spike card is exempt from this loop (`AGENTS.md`). Its work is throwaway, lives in the
gitignored spikes directory, and is never merged. What the spike produces is the report its
acceptance describes, not the code that got there.
