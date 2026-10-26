ABOUTME: Records the file-backed candidate patch repair and its large-overlay regression proof.

# Doctor clone candidate transport

The original #949 delivery applied tracked candidate patches through captured Git stdout and
stdin. The current author-adopted repair acceptance records the pending #820 integration failure
and its source. This repair keeps Git as the patch authority and stores its binary diff in an
owned temporary file. The helper tests file size for an empty diff and passes the file to Git
apply. Its existing error, signal, exit and published-origin checks stay in place.

The new regression first clones an unchanged committed fixture. It then overlays independently
literal tracked text, a staged addition and binary bytes. It measures the real binary patch
through file output before calling the helper, and compares clone contents with those literals.
Bounded Git identities, staged content and direct file reads establish source invariance without
capturing a large diff.

On the current base a8484080476ff123c9c05030291c238aa08f1db7, the Node 26.12.0 Linux/WSL
unchanged ordinary baseline passed 2,860 tests with nine skips. The separate actual-Git doctor
baseline passed all 101 tests. The existing command observer retained their complete streams,
source/runtime/host receipts and process IDs.

The focused regression measured 2,500,500 patch bytes using Git diff file output and filesystem
stat. Its first actual test run reached the named regression and failed at freshClone's existing
assert.ifError with spawnSync Git ENOBUFS. The minimal file-backed repair made that same named
regression pass, including its empty-patch and source-invariance assertions. Complete red and
green originals retain their actual working-source fingerprints and process identities.

One recorder environment setup failed before any test process started. It earns no regression
credit; the corrected recorder invocation produced the actual behavioral red above. The original
#820 failures and original #949 first-delivery evidence remain attributed to their recorded refs.
Supported-macOS proof remains separate from these local observations.
