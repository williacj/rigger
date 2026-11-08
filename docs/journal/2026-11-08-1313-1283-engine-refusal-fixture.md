<!-- ABOUTME: Records the engine-refusal fixture repair and its independently observable verification. -->

# Engine-refusal install fixture

The real-npm engine checks need the package's declared engines and copied strict configuration.
Copying unrelated development dependencies into their lockfile-free fixture made registry metadata
availability a premise of those checks. The fixture now projects the real name, version and engines,
raises only the Node floor, and gives each install an empty offline cache and private empty
user/global configuration. It filters inherited npm configuration case-insensitively while
preserving the deliberately quiet parent loglevel input.

Measurement on the source based at 2ca75663eef3a2b7a31d364c5b7b8985bbbdf5df, with
Node v26.12.0/npm 12.2.2 on experimental WSL, ran the two existing tests against the unchanged helper
with an observed empty private offline cache. Both named engine assertions failed with ENOTCACHED
for Acorn metadata: tests 2, pass 0, fail 2, cancelled 0, skipped 0, todo 0. The direct npm Node
process exited 1 with no native signal. The recorder expected that failure and itself exited zero;
that zero is not a test pass.

After the fixture repair, the same selected pair reported tests 2, pass 2, fail 0, cancelled 0,
skipped 0, todo 0. Its direct npm Node process exited zero with no native signal. Both existing test
names, executable bodies and assertions remain intact. The older 208-test host red remains failed;
this local pair earns no macOS proof.

Measurement on repair commit c505c6c780cd37d8cae7a06e867b4bdcd14c61e7 used the same
Node v26.12.0/npm 12.2.2 on WSL. Its unmodified deterministic commit hook reported:

    tests 5392
    pass 5383
    fail 0
    cancelled 0
    skipped 9
    todo 0

The committing Git process exited zero with no native signal. The hook's direct npm/native ending
is not separately exposed; the complete hook summary and Git native result are distinct evidence.
The nine case-fold skips establish no unavailable case-fold behavior.

Two separate guarded npm run mutation:receipt controls at that repair commit each reported
"status": "killed". In both receipts, unmutated/mutant/restored counts were 2/2/2, their helper
exit fields were 0/1/0, timedOut was false, and fileVerdicts was empty. Those helper exit fields
are not invented separate native exit/signal observations. Each anchor was found exactly once;
both receipts retained the readback and diff. Both restoration records reported the following
same value for preimageHash, beforeRunHash and afterRunHash, and an empty source status:

    65ec69876950a7a7cce87faaba0a7e08ff719e38abd32e5ebd0c0c3c7c8799c7

The dependency control restored only the real manifest's development dependencies to the minimal
fixture. Both named tests reached their existing engine-error assertion and failed with ENOTCACHED
for Acorn metadata. That causal ordering is measured only on npm 12.2.2, not promised for future
npm versions. The copied-configuration control removed only the fixture's copy operation and ran
with explicit inherited NPM_CONFIG_ENGINE_STRICT=true. Both named tests failed their existing
nonzero-status assertion because the install actually exited zero. The repository .npmrc
remained unchanged. These observations discriminate both cache independence and the copied
configuration's enforcement without weakening or replacing either test.

The full npm run test:host, with no file filter, then reported at the same repair commit:

    tests 2342
    pass 2290
    fail 0
    cancelled 0
    skipped 52
    todo 0
    duration_ms 935931.70762

Its direct npm Node process, PID 167919, exited zero with no native signal at
2026-11-08T13:30:14.993408Z. Its Windows transport exited zero separately. The 52 skips remain
unproved host/live-fixture behavior, and this experimental WSL result supplies no macOS proof.
Byte-complete private originals for the red, green, controls and complete baselines are retained
through final independent review and supplied to the judges.

This journal-only follow-up preserves the repair's executable source. The repaired head's normal
deterministic hook and affected engine pair still require their own recorded verification.
The final reviewed head's supported macOS full-host result remains pending actual configured CI;
neither this journal update nor source equivalence transfers the earlier host result to that head.
