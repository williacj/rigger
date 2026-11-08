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

The normal commit hook runs the full deterministic tier for this repair. Guarded dependency and
copied-configuration controls, full host verification and final evidence reconciliation remain
pending at this initial repair commit. The card remains unfinished until those obligations pass.
