ABOUTME: Card 1159's CI Node fixture cause, test-first evidence and bounded policy mutations.

# CI policy fixtures state the installed Node major

The policy reads `process.versions.node`, while its fixtures inherited the Node running the
tests. CI installs its own major. The fixtures now derive that major from the parsed workflow's
plan job. The diagnostic compares it with every policy-running job, including the aggregate's
matrix. In-process calls can state another major and restore the original descriptor in `finally`.
The two child helpers prepend the shared version statement to their existing scripts. None
rewrites the workflow's policy text.

Measured locally on macOS at base `48d96ee315549fde5407048b3529eab230c207d3`, Node 26.5.0
passed the full deterministic baseline and the affected host file. Node 24.22.2 reproduced the
unchanged recorded worker's `fast` failure and both predicted child worker failures. The new
diagnostic first failed on Node 26.5.0 at `worker major 24`, before the fixture override existed.
After the fixture changes, the diagnostic and recorded cases passed on Node 24.22.2, as did the
affected host file. These are named-file development runs; final clean-head receipts belong to
the pull request.

Both releases reported a non-writable, enumerable, configurable `process.versions.node` property.
The preliminary descriptor probe restored it after normal return and throw. The diagnostic
checks descriptor restoration after each explicit major, the default major, and a TypeError
thrown by the actual inline policy when called with null.

The mutation receipt command is `npm run mutation:receipt`, targeting the diagnostic in
`test/ci-proof-source.test.mjs`. Three separate replacements of the worker's major comparison
admit any major, refuse only 24, and admit every major at least 26. The diagnostic's independent
literal expectations refuse 24, 25 and 27 and admit 26. Each receipt runs in a disposable
worktree and retains its control, applied anchor, readback, diff and named assertion verdict.
The pull request records their results and source-restoration evidence at the committed head.

Existing test-line changes use card 1159's G1 and G2 classes. Assertions and existing titles
stay as authored. The diagnostic adds no product requirement declaration, under the card's
explicit harness-diagnostic admission.
