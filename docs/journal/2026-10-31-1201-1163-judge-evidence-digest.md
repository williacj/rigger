ABOUTME: The actual-evidence digest oracle added to the existing judge-answer regression test and its bounded discrimination evidence.

# The digest needs the evidence as its input

Card [#1163](https://github.com/williacj/rigger/issues/1163) owns this existing-test strengthening. Its ten acceptance items have SHA-256 `42c7b01c8ba7e7446c9a6104deb2fbb08c0af87c2be029310b4698cde8a55fa4`; the admitted body has SHA-256 `40a9169875f31bdbd18c4bd58216d3f8fea141743a4d5375a040f0aaad84c12b`.

The existing digest test now supplies two independently written nonempty diffs, including a Unicode greeting, and compares every returned judge digest with independent `node:crypto` SHA-256 over that judge's actual evidence UTF-8 bytes. Assertions establish the returned panel size, nonempty evidence, inclusion of the supplied diff and distinct evidence across fixtures. The original digest-shape, instruction-line equality and absence-of-raw-evidence assertions remain.

## Measurements and custody

The private JED-1163 packet contains the complete originals. Its baseline evidence index has SHA-256 `001efd260bb744c132402bb6ac45d23cae311b9acd90ac75af9afbb38f24989e`; its phase 1 index has SHA-256 `e7a7c27f39ee6ed9f8dd494634fdd578812a05e28c6f82f4437492d917bd3d20`. The coordinator supplies the packet access route privately to independent judges. `baseline-predeclare.json` records the admitted source tree, runtime and verified dependencies; `JED-B-D.receipt.json` identifies the complete separate baseline streams. `phase1/` holds each manual invocation's frozen inputs, exact argv, PID at start, UTC times, direct exit, full separate streams, hashes and before/after guards. Its originals include the original and strengthened test bytes, original production bytes, applied diff, independent fixture-packet reconstruction, red qualification and restoration record.

These measurements used main `ca55219d3aad9967c6aaa01b09e97b016c561d66`, tree `e35a54bf889841d1d6f58fe0d977baed15783f2a`, Node v26.12.0 and npm 11.20.0. The actual runtime paths and byte hashes are in the predeclaration. The dependency copy matched the recorded lock and contained eleven regular files and the `.bin/acorn` symlink.

| Receipt | Tool and measured scope | Result |
|---|---|---|
| JED-B-D | Real npm `test` at admission N, PID 460 | Exit 0; 4247 tests, 4238 passed, 9 skipped, no failures/cancellations/todos |
| JED-original-G | Ordinary isolated suite, exact existing title, original source/test, PID 537 | Exit 0; one named test passed |
| JED-input-old-G | Same selection/copy, sole applied empty-input hash fault, original test, PID 623 | Exit 0; one named test passed |
| JED-input-new-R | Same selection/copy/fault, strengthened test, PID 704 | Exit 1; one named test failed at actual-evidence digest equality |
| JED-restored-new-G | Same selection/copy, byte-exact original production restoration, strengthened test, PID 474 | Exit 0; one named test passed |

Every manual invocation reported zero skips, cancellations and todos. The single replacement anchor was `const digest = evidenceDigest(evidence);`; its sole replacement was `const digest = evidenceDigest('');`. Readback and git diff established its application. The original test passed its absence-of-raw-evidence assertion, which cannot pass for an empty evidence string. The strengthened test reached digest equality after its nonempty and supplied-diff premises. Its actual value was the independently confirmed SHA-256 of empty UTF-8, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; its expected value was `a33dc623e4596d024a8eb94c3436abecb4140eca16f0b5236323af3d8c7cd09e`. Python `hashlib` independently reconstructed and hashed the first fixture packet to that expected value. The executed assertion computed it from actual returned evidence through `node:crypto`.

Production bytes in that same disposable copy were restored to SHA-256 `89baa1665570c9c841120019ed31ef461ff1471191908d9ec987fa840ce26b46`, with its source path clean before and after the restored run. The retained change contains the strengthened test and this journal.

## Remaining head-bound evidence

Before review handoff, the complete official `JED-mutation-receipt`, `JED-F-D` and `JED-F-matrix` originals and exact executed commit identities must be supplied in `final-head-index.json` in that private packet. Those executions belong to the committed head and are separate from these admission/manual measurements.

The actual retained code diff adds a built-in crypto import and in-process fixture/oracle assertions at the existing L2 answer boundary. Its existing fixture supplies settled facts and a temporary observation sink. It changes no process, provider, forge or worktree wiring, and its file is absent from the suite's host list. No affected host boundary was identified from this diff/import closure. Unavailable supported-host verification remains unproved until CI supplies it.
