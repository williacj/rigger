<!-- ABOUTME: Maps the frozen once fixture-readiness defect to its guarded preparation repair and causal proof. -->

# Prepare the judge-directory blocker before the CLI

This repair addresses only frozen source identity S:dc1be536f5817a35c5004450, family D-2846,
from docs/spikes/existing-suite-audit.json at source
2e2640702a328b2e4dd705bd0858aeb414002a6b. It changes the fixture ordering of the existing
judge-directory refusal test. It supplies no blanket once-file conversion or parent #1134
completion credit.

The unchanged onceWithAgent helper invokes its synchronous prepare callback before spawning the
fixture CLI. The original test created its deliberately non-directory judges blocker after that
helper returned. The repair moves only the existing root declaration, directory creation and
blocker write into that callback, and permanently asserts that the expected blocker exists and
lstatSync reports a regular file before launch. A symlink cannot satisfy that premise. The test
title, bound, stand-in configuration, awaited result and all original outcome assertions remain.

Measurement on selected base 6d62c1ca8f198f01f93db30a66a3ff8a267f3169, Node v26.12.0/npm 12.2.2
on experimental WSL, established an untouched full deterministic baseline: tests 5392, pass 5383,
fail 0, cancelled 0, skipped 9, todo 0. The untouched selected real CLI target also passed once.
Those passes establish neither a failure rate nor that the original preparation order is safe.

Before moving setup, the permanent callback guard was added while the three original preparation
operations remained after the helper call. The identical selected target reported tests 1,
pass 0, fail 1, cancelled 0, skipped 0, todo 0, failing the literal assertion:

    judge-directory blocker is a regular file before CLI launch

The assertion's actual value was false and expected value true. The stack reached prepare and
then the helper's synchronous prepare invocation. The runner Node process, PID 579, exited 1
with no native signal. This fixture-premise RED stopped before the helper's CLI spawn; a runner
process did execute, but no fixture CLI execution or refusal is claimed for RED. The expected-red
recorder and Windows transport exited zero separately; those zeros are not test success.

After moving the same three preparation operations into the callback before that unchanged guard,
the identical target reported tests 1, pass 1, fail 0, cancelled 0, skipped 0, todo 0. Its runner
Node process, PID 538, exited zero with no native signal. The existing test's assertions verified
the actual fixture CLI's nonzero result, reviewer refusal/path and engineer-only agent runs.
The helper does not expose a separate retained fixture-CLI PID or exact native exit number;
none is invented from the runner result.

Measurement on repair commit 58f677de521e395e281d65c438b9b2c406d8a5b7, with the same
Node v26.12.0/npm 12.2.2 on WSL, obtained the following complete normal deterministic hook result:

    tests 5392
    pass 5383
    fail 0
    cancelled 0
    skipped 9
    todo 0

The committing Git process, PID 588, exited zero with no native signal. The hook's direct npm
native ending is not separately exposed; the complete hook summary and Git native result are
distinct evidence. The nine case-fold skips establish no unavailable case-fold behavior.

At that repair commit, the separate guarded npm run mutation:receipt late-preparation control
reported:

    "status": "killed"

The single exact fixture anchor was found once; the receipt retains the applied readback and diff.
The fault moved only the original root declaration, mkdir and blocker write after the helper call,
preserving the callback guard and every original outcome assertion. The same named test failed the
literal readiness assertion with actual false and expected true. The fault's callback therefore
stopped before fixture CLI spawn, by the unchanged helper order; this claims no CLI refusal for
the fault. Before/fault/restored each reported one selected named test, helper exits 0/1/0, no
file-only verdict and no timeout. Those helper exit fields are not invented separate native
exit/signal observations.

The receipt's preimageHash, beforeRunHash and afterRunHash all reported the following value;
its restored source status was empty, and the restored selected target passed:

    d23453a99650fc7ac1bf3977d1a68997508d4e88e4db5466349fc31a7fbf72ee

The receipt's supervising npm Node process, PID 646, exited zero with no native signal.
Its byte-complete retained stdout SHA-256 is
25120c367b01ea91745a8162c08c733ca5071be0ed8388a5bf4ce41101bd54a7.
These are separate measurements from the selected helper exit fields.

This evidence follow-up changes only this journal. Final reviewed-head deterministic and identical
selected real CLI results are recorded separately at that head in the delivery evidence; earlier
results remain bound to the repair commit named above. All source/command/ref/native/raw-stream
originals are retained privately outside suite scratch through final independent ruling and
supplied to the judges. Experimental WSL proof establishes no unavailable supported macOS behavior;
actual configured full_ordinary CI must supply that supported-host proof because it selects this
ordinary test. A full_host job does not select this target and earns it no execution credit.
