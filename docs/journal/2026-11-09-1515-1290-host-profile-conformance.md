<!-- ABOUTME: Records #1290's test-only collector refusal proof after delivered source-pin repair. -->
# #1290: repository-source observations at the actual collector

The continuing PM acceptance is the live #1290 body with SHA-256
`2919866f26254a8cd5be7bc19de2ffed38a7b091af04b26d0250e7221d8c9d5d`.
This work starts from delivered #1323/PR #1326 at
`4a184132dbec66c5ca0118b4b2836c22ef3b8ea4`, tree
`076418331ca7108967ec9e4de99bbcf8d42da966`. Its fixture and source-pin guard remain intact.

Python SHA-256 measurements of actual checkout bytes at that source match CI_HOST's
three repository pins: .npmrc, test/suite.sh and test/suite-guard.cjs. The earlier
#1290 source-only STOP belongs to `52fb8a3d15a7f6842436a7295edb52c4b7a4ad35`;
its stale-pin finding and original evidence remain historical records. The original
acceptance's default-reader redesign and prescribed old-fixture RED were withdrawn,
not completed by this residual.

The positive wrapper/test is conserved from `f488e41bde2491ca152e5fa18f61bfc28f0e547f`.
Its actual-byte observations and literal argv/version/prefix/parent-key expectations
pass on the delivered source. The local wrapper's optional byte view supplies the
new negative cases; external npm/tool/config observations still delegate to the
existing retained fixtures. Their npm12.2.2 and npm11.20.0 profiles certify no
installed npm or Mac invocation.

Each of the three source paths receives an independently changed single-byte view
under both profiles. Original bytes are opened, copied and demonstrably changed;
the checkout is never overwritten. The controlled ENOENT case opens the existing
.npmrc first, then rejects its observation under both profiles. It claims no real
missing file. Every negative case separately checks successful child exit,
complete capture, exact stdout/stderr and forwarding, no I/O failures, and valid
successful reporting before checking unavailable startup and parent key.

The existing c27 Python capture records direct native PID/endings and complete,
separate stdout/stderr through EOF. Originals remain outside the checkout and
suite/temp roots in `/home/cj/rigger-evidence/1290-maker-20261109/` through independent
review. Its source SHA-256 is
`c27c3ca156f7e321be16d3b3c1cce74d9b1d2a43e3f1105a5c469f329795499c`.
Commands use the ordinary shared FIFO and the selected Node26.12.0 binary
`caa24debe02770c92a70677e2a62ca98890150e7ac1c17bcfe31bcc98cc89943`,
with npm12.2.2 CLI
`8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`.
These are filesystem identity measurements; no new installed-tool probe was run.

At the clean delivered source, the admitted baseline measured 5,491 deterministic
tests: 5,482 passed, nine skipped and none failed. The complete report file passed
45 tests. At additive report-file SHA-256
`a53514c1b4d31d99fc55f81fe58b16e2d798fa9af3364b2ee488872b657cf50c`,
each newly added behavior passed its first focused characterization, and the
complete file passed all 50 tests. Those are characterization GREEN results,
not a reproduced production defect or a replay of historical stale-pin failure.
`residual-*-characterization` retains each command, native ending and output.

Pre-control verification through the same capture measured 5,496 deterministic
tests: 5,487 passed, nine skipped and none failed (direct native PID645, exit0).
The complete report file passed all 50 tests (direct native PID167858, exit0).
Both captures observed stdout/stderr EOF, and before/after source, tracked-byte,
Git-flag and staged-entry records agree. The ignored package record remained absent.
The normal commit-hook result and official guarded control are recorded as they occur.
The official control is currently unexecuted and awaits coordinator admission.
Its proposed fault removes only repository inequality refusal, retaining all
fingerprint calls and external checks. No transient workflow edit belongs in this
card's delivered diff.

This is ordinary deterministic repository-harness proof, not host-tier or product
requirement coverage. The independently checked existing selected-main file bytes
remain unchanged outside additive imports/helper/declarations. The separately
scoped #1128 integration still owns future suite-source/pin maintenance; this
card grants no workflow change, new host certification or historical incident repair.
