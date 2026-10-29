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
contracts, never the assertion's expected value.

**Separate algorithm and host proof.** Inject clocks to force algorithmic timing decisions.
Retain real-host checks for changed wiring, tool/OS contracts and real deadlines. A logical clock
cannot prove an OS deadline. Identify any boundary left unproved; a fake pass earns no host credit.

**Establish the premise.** Observe fixture readiness with a condition before starting the
behaviour's timer when readiness is its premise. Keep startup within the bound when startup
itself is the contract. A readiness failure is not a failure of behaviour never exercised.

**Keep the authority live.** Where a tool decides a fact (`D16`), assert the relation between its
answer and the code's, rather than pinning today's answer. `test/package-budget.test.mjs` is a
worked example: a fixed answer documents today; asking the tool catches a changed authority.

## A test a change adds

A test a change adds is a top-level test whose file and title the merge base of the head with
`main` does not hold. Before handoff, check each one against these classes, and record in the
pull request body the defect each one catches. A test in any class is unhealthy.

1. **Implementation.** An assertion's result can change under a change that keeps every
   behaviour the card, a requirement or the test's title names. That change may be to the code,
   to its layout or line positions, or to state the head does not fix, such as another ref.
2. **Redundancy.** The pull request records no defect for it, or each defect it records is
   also caught by another test the change adds, or by another test in its file. A test the
   change adds may be removed before merge.
3. **A fake not shared.** It adds a double for a boundary that a module under `test/`, usable
   from the test's tier at the head, already doubles, instead of extending that module.
4. **A fake without its source.** An answer the change adds to or changes in a double records
   no source where the double is defined: a recaptured unedited answer naming its command, or
   a cited documented contract.
5. **A fake leaving its source.** A double the change adds or changes answers a request its
   recorded source admits differently, in form or value, or refuses a continuation, cursor or
   state it has itself advertised.
6. **A host claim untrue.** Its `D29` rule 11 declaration fails in any of these ways:
   - its reason is not what its assertions claim (`D29` rule 2);
   - the test arms a timer with a delay above zero itself, without naming a real deadline
     (`D29` rule 11);
   - the deterministic test it names stays green with that decision removed;
   - its claim to depend on no decision is untrue.
7. **Real time.** In the deterministic tier, its outcome depends on real elapsed time,
   scheduling or load where an injected clock or a seam could carry it (`AGENTS.md`, "When you
   write code"). The class covers a route the deterministic runner and the added-timer steps at
   the head do not refuse. A test added to a file on `D30`'s conversion list may still read the real
   clock (`D30` rule 2), so this class does not bind its clock reads.

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

Attach `npm run mutation:receipt` output to each mutation claim.

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

Tests proving product requirements declare them. `docs/derived/test-matrix.md` is
generated from declarations, never hand-edited (`D8`). New requirements need claiming tests
(`D17` rule 1), enforced by judges (`D17` rule 7), not automated checks. Older requirements
without claims are counted gaps, not build failures; `D17` governs when they close.

A harness diagnostic may omit `// proves` only under author acceptance naming its infrastructure
behaviour, why checked registered product requirements describe none of its assertions, and a
bounded semantic mutation discriminating the defect. Neither its path, helper nor missing
declaration establishes classification. Never borrow an unrelated requirement for a declaration.
It still owes an independent oracle, meaningful red/green and guarded diagnostic mutation evidence
under "A mutation claim"; declarations retain every proof obligation. Omission adds no
matrix claim.

A declaration is a `// proves R-GROUP-#` comment on the line directly above the test it speaks
for, naming as many ids as that test proves, separated by commas. `npm run matrix` rebuilds the
matrix and `npm run matrix:check` refuses one that has gone stale, so the declarations a piece of
work adds are regenerated and committed with it. A declaration naming an id
`docs/spec/requirements.md` does not hold is refused by name, and so is one standing above no
test — a call that is commented out is not a test.

The block comment above `declarationsIn` in `scripts/build-test-matrix.mjs` lists the source
shapes the scan claims nothing for, the ones it refuses by file and line, and the one it wrongly
claims. `test/build-test-matrix.test.mjs` holds the parser cases.

So when you add a requirement, the test that claims it is part of the same work. Where your card
is what makes an older requirement true, its test closes that requirement's counted gap in the
same work (`D17` rule 6). Name each requirement a test actually proves; the diagnostic admission
above never reclassifies existing tests or waives those obligations.

Tests do not count toward the package line budget (`ARCHITECTURE.md`, "Budgets"). That is not a
licence to write more of them: every test costs execution time and maintenance, so each one
still has to protect a concrete behaviour.

## Spikes

A spike card is exempt from this loop (`AGENTS.md`, "When you write code"). What the spike
produces is the report its acceptance describes, not the code that got there.
