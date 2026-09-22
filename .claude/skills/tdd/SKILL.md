---
name: tdd
description: Write code test-first — a failing test, the minimal code that passes it, then refactor while green. Use before the first test body of any change to source, for every bug fix, and when deciding what a test must declare about the requirement it proves.
---

ABOUTME: The failing-test-first loop this repository requires, what counts as a real red, what
makes a test worth keeping, what a test declares about the requirement it proves, and the rules
on sleeps, deleted tests and spikes.

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
assumption by construction, and the argument there carries over unchanged. Take the value from
the real collaborator — a recorded response, a shape its interface guarantees, a literal you
read from the real thing — and never from what makes the test pass. Failing first misses this
one for the reason it gives there.

**Something exercises the real wiring.** A suite where every unit is green against doubles can
compose into software that has never run, and each unit test will go on passing while it does.
Preferring real collaborators is the rule above; this is its floor. Where you substitute across a
boundary, one test crosses that boundary for real, and it belongs to the same work rather than to
a follow-up. Where the boundary cannot be crossed in a test, say so where the substitute is
defined, so that the next reader knows what is unproven rather than discovering it in production.

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
those declarations, so the matrix is generated and never hand-edited (`D8`), and a requirement
no test claims reds the build (`AGENTS.md`; `docs/v0-build-plan.md`, M0).

So when you add a requirement, the test that claims it is part of the same work. And when you
write a test, name the requirement it proves rather than leaving the matrix to guess.

Tests do not count toward the package line budget (`ARCHITECTURE.md`, "Budgets"). That is not a
licence to write more of them: every test costs execution time and maintenance, so each one
still has to protect a concrete behaviour.

## Spikes

A spike card is exempt from this loop (`AGENTS.md`). Its work is throwaway, lives in the
gitignored spikes directory, and is never merged. What the spike produces is the report its
acceptance describes, not the code that got there.
