<!-- ABOUTME: Records the Ubuntu restricted-PATH forge fixture repair and its verification. -->

# Card 873: Ubuntu forge fixture tools

[Card #873](https://github.com/williacj/rigger/issues/873) bounds this test-only repair.
Its [independent acceptance ruling](https://github.com/williacj/rigger/issues/873#issuecomment-6342233847)
was posted before the implementation. The owner authorized fixing the Ubuntu suite failure.

The restricted-PATH fixture required macOS sw_vers on Ubuntu before reaching its forge
assertions. Its tool list now selects sw_vers only on Darwin. The existing behavioral assertions
are unchanged. Engine host support and the suite's tier selection are outside this card.

## Verification

These measurements used Ubuntu 26.04.1 x64 on WSL 2 with Linux Node v26.12.0, npm 11.20.0
and installed /usr/bin/gh. The base was 4a2cba91d7c9ae1c7af1c099d6f070c2d1fa4c7c;
the green measurements describe that base plus this card's fixture edit.

Before the edit, npm run test:host -- --test-name-pattern='P3-A3: an inner first lookup'
test/forge-runners.test.mjs ran one test and exited 1 with the assertion
"sw_vers is needed by npm test". After the edit, the same command exited 0 with one passed,
zero failed, zero cancelled and zero skipped.

npm run test:host -- test/forge-runners.test.mjs exited 0: 70 passed, zero failed, zero
cancelled and zero skipped. This includes the installed-real-gh families and the child-PATH
cases without real gh.

npm test exited 0: 2,623 tests, 2,614 passed, zero failed, zero cancelled and nine skipped.
The runner reported 53,941.844528 ms.

The host runner still prints a sw_vers warning when constructing its local diagnostic host
key on Ubuntu. That warning does not fail these commands. Repairing that runner behavior is
outside this card's bounded fixture grant. No macOS runtime measurement was made.
