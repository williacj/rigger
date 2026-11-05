ABOUTME: Records card #1200's exact owner-authorized absorption-test retirements and retained proof.

# Five absorption assertions covered by stronger retained oracles

[Card #1200](https://github.com/williacj/rigger/issues/1200) fixes the acceptance before this work.
Its public body SHA-256 at admission is
d8bbeab88a79d11efa31031556648ace4d5303ca69589c37bc031f55e3e28a45.
The [coordinator's owner-decision record](https://github.com/williacj/rigger/issues/1200#issuecomment-6620467823)
records the actual owner's permission for patch SHA-256
fd27f9730e2f1985d296348173f6abe14a5d3e60de6fb939c465d88a232db021.
That permission supersedes #816 T16's body-preservation obligation only for these five declarations.
The [fresh acceptance ruling](https://github.com/williacj/rigger/issues/1200#issuecomment-6620520336)
covers this exact filed body. Neither record supplies implementation or baseline credit.

Admission used a normal GitHub clone and an isolated rigger-1200 worktree at
233bb948bd16597e12f002e836dc0c3277367b74, tree e52e6af223e86705854136b76600f1008ce25fda.
Python SHA-256 measurements at that ref found the test preimage
396852da9f56cec02afb7cecfdf67ae9f66b1304aece5bf8a79d806c40357f07
and script preimage
6a18e2f4a15312aa7ab989ea5eda618616bb339d567e79f20c568048396792ea,
matching the approved source. Applying the exact patch produced test SHA-256
4f00761aae4c516604dcefa1d91ed054430f74e031261c181085cfdaadcbfcdd.
All other test/helper bytes and the complete script are preserved.

The implication below concerns observations on the same command answer. Each retained refusal
iteration uses run() with the same executable, ordered argv, encoding and inherited environment
as its retired declaration. In the unchanged script, these vectors reach the refusal before
document reads. The self-test branch enters its fixed cases and exits directly.

| Retired declaration | Retained stronger oracle |
|---|---|
| a bare invocation is refused rather than exiting 0 having compared nothing | REFUSED includes []; the companion checks nonzero status, refusal reason, both usage forms and empty stdout. |
| a single document path is refused, because one document compares against nothing | REFUSED includes ['ARCHITECTURE.md']; the same companion preserves nonzero status and adds the stream and usage checks. |
| --self-test carrying a further argument is refused rather than silently ignoring it | REFUSED includes ['--self-test', 'ARCHITECTURE.md']; the companion preserves refusal and document usage, and adds self-test usage and empty stdout. |
| three document paths are refused rather than comparing the first two | REFUSED includes all original paths in order; the companion preserves nonzero status and refusal, and adds both usage forms and empty stdout. |
| --self-test prints one result line per case | The retained --self-test companion checks status zero and stdout exactly SELF_TEST_OUTPUT, whose independent literal contains two PASS lines. |

The six-vector REFUSED table and complete companion assertions, SELF_TEST_OUTPUT, and exact-output
self-test companion retain their bytes. The unchanged script retains both algorithm input pairs,
independent expect values reach and finding, and failed-count exit logic. All other comparison,
error and git-ref tests remain. The conversion-list placement stays as admitted. No proves
declaration is removed or added; the matrix renderer emits file, title, IDs and tier rather than
line positions. The generated matrix is checked without editing it.

Before deletion, ordinary npm test at the admitted source exited 0 under Linux Node v26.12.0
(x64) and npm 12.2.2, measured by execution receipts r1200-runtime-01 and r1200-npm-version-01,
with the clone's own npm ci dependencies. Its measured summary was 4,640 tests, 4,631 passes,
zero failures, zero cancellations and nine skips. Raw stdout, stderr, native PID, direct exit,
literal command/environment and source identities remain under private access receipt
r1200-private-access-01, outside the worktree and disposable suite roots.
The baseline-full-deterministic receipt records its actual UTC start and end.

A Python exact-title search of the admitted tracked source found references outside this test
only in historical journals; those records remain. The only delivered paths are this journal
and test/absorption-check.test.mjs. This checkpoint precedes the normal commit hook and final
committed-head verification. Their complete receipts are retained externally so recording final
proof does not change the head being proved.

Host applicability is a judgment from the bounded diff: production code, real-process wiring,
host-listed files and suite placement are unchanged. The ordinary focused run still exercises
the retained real CLI boundaries through the conversion-list file. No separate affected host-tier
check is identified. Supported macOS execution is unproved locally until CI supplies evidence;
the local WSL result does not establish that host's result.
