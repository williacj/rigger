---
name: tdd
description: Write code test-first — a failing test, the minimal code that passes it, then refactor while green. Use before the first test body of any change to source, for every bug fix, and when deciding what a test must declare about the requirement it proves.
---

ABOUTME: The failing-test-first loop this repository requires, what a test declares about the
requirement it proves, and the rules on sleeps, deleted tests and spikes.

# Test-driven development

`AGENTS.md`'s "When you write code" section requires this loop. This skill is how to run it.

Before you start anything, `npm test` is green. Red means stop: fix it, commit the fix on its
own, then start the work (`AGENTS.md`, "Before you start").

## The loop

**Red.** Write one failing test for the next smallest piece of behaviour, and run it. Watch it
fail, and read the failure. A test that has never failed has proved nothing — it may be
asserting on the wrong thing, or on nothing.

**Green.** Write the minimal code that makes it pass. Minimal is not a style note: anything
beyond what the test demands is code no test asked for. Put it where `ARCHITECTURE.md` says it
lives; a need that fits no extension point is a design conversation, not a workaround.

**Refactor.** Improve the code while the suite stays green, then commit. Extract rather than
copy-paste, by the Rule of Three (`AGENTS.md`, "Any role").

Then the next test. Small steps, often — the loop's value is the failure you saw, and a large
step throws it away.

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

Tests are outside the package line budget (`ARCHITECTURE.md`, "Budgets"). Thoroughness in the
suite costs nothing against it.

## Spikes

A spike card is exempt from this loop (`AGENTS.md`). Its work is throwaway, lives in the
gitignored spikes directory, and is never merged. What the spike produces is the report its
acceptance describes, not the code that got there.
