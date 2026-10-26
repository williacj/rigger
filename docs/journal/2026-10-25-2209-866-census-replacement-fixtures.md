ABOUTME: Records reused directory-replacement fixtures and measured filesystem proof for card #866.

# Directory replacement fixture proof

The fixture repair already landed as #901's commit
`e20c049e5455caf8adc8ce52e8aab3a265a7f6b5`, delivered through merged #906
(`64b59222afde01bdd8fb1b2811e04a9caec7aa5e`). It retains an original directory
descriptor across replacement and asserts the held identity and distinct replacement identity.
Card #866 reuses that implementation; this work adds no duplicate fixture or production change.

The root cause is a fixture premise: removing and recreating a directory can reuse its device
and inode. Retaining the original allocation makes the replacement distinct by construction.
The runtime's identity comparison and documented reuse limitation remain unchanged.

## Measured current cases

On 2026-10-26 UTC, the six prospectively admitted runs used unchanged source
`335cea32e19bfb11b3468a72d3f71ea79f23c6dc`, tree
`ff8063c150e1d843cf316960728e2817b408edde`, with Node 26.12.0 on Linux/WSL.
Actual `findmnt` measurements established ext4 and tmpfs before and after each run.
A read-only observer delegated the original filesystem calls unchanged and recorded their
numerical results. Its incidental observation overhead is real; no zero-perturbation claim is made.

The case labels below refer to these existing test names:

- **Workspace replacement:** `given a dispatch whose command removes its own directory and makes it again at the same path, leaving there a process outside its group, that process is not alive when the dispatch settles`.
- **Scratch replacement:** `given a recorded dispatch whose scratch directory was replaced at its path, a later start sweeps nothing there, leaves a process working there alive, and records the directory skipped and why`.
- **Unchanged scratch:** `given a recorded dispatch whose scratch directory is still the one recorded, a later start ends a process working there, and records its kill under the dispatch's id and card`.

Each row ran its one named test exactly once and passed, with no failure, cancellation or skip.
These are measured fixture identities, not temporary-container identities.

| Filesystem | Case | Device | Original inode | Observed replacement/control inode | Result |
|---|---|---:|---:|---:|---|
| ext4 | Workspace replacement | 2096 | 561728 | 561733 | Pass |
| ext4 | Scratch replacement | 2096 | 561764 | 561767 | Pass |
| ext4 | Unchanged scratch | 2096 | 561774 | 561774 | Pass |
| tmpfs | Workspace replacement | 43 | 107 | 112 | Pass |
| tmpfs | Scratch replacement | 43 | 160 | 163 | Pass |
| tmpfs | Unchanged scratch | 43 | 188 | 188 | Pass |

Both replacement cases retained their original descriptor through the identity assertions and
closed it during test-local teardown. Actual open, fstat, stat and close observations agree;
every observer exit reported no outstanding fixture descriptor. Post-run process inventories
found no fixture processes. Failure cleanup retains the existing registered teardown ownership;
these six successful runs do not claim a new injected-failure cleanup witness.

Post-source, runtime, filesystem and retained-original guards were persisted before residue
classification for every current cell. Owned Node/npm compile-cache files were listed and
retained as incidental runtime output. No cache, unknown path or fixture resource was deleted
by the proof coordinator.

## Separate pre-fix observation

The original 2026-10-22 retained evidence route was unavailable on this host. One admitted
pre-fix attempt therefore ran the existing scratch-replacement test at
`6ea199d09adc8a132f032a95caeb0d30e0a66449`, tree
`2f8be5d6ee9708f69639e4157f2fd853c62c0b11`, on measured ext4. Actual filesystem
calls observed device 2096 and inode 555754 both before and after replacement. The named test
failed its existing missing-`directory.skipped` assertion; its process-liveness assertion passed.

This is a fresh equivalent fixture-premise red, not a reproduction of the unavailable historical
liveness failure. Equal recorded and current identities explain why the runtime omitted the
skip event. The historical attempt was not repeated or replaced with allocator sampling.

An outer inventory guard then rejected Node's compile-cache directory as nonempty. The
historical command's complete streams, result and clean source status were retained, but the
immediate full post-guard receipt was not persisted. A later inventory is recorded only at its
actual later time. It does not reconstruct that missing receipt. The corrected, separately
admitted six-cell continuation preserved post-guards before classifying retained runtime cache.

The unchanged-source ordinary baseline passed 2,883 tests with nine skips, and the affected
host-file baseline passed all 28 tests. Their original source-bound receipts were reused;
neither baseline nor the historical attempt was rerun in the continuation. These measurements
supply no Mac/APFS or new operating-system support credit. Final-head verification follows
`AGENTS.md`, "Before you start".

Complete original commands, streams, identities, source guards and cleanup observations remain
in the coordinator's private evidence route for author audit and independent review. This journal
contains no final acceptance verdict and claims no production fix.
