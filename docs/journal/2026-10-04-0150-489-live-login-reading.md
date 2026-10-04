ABOUTME: Journal for #489 (M4-14): why the gated live test now reads `codex login status`'s verdict
as a line anywhere in its output, rather than at the start.

# #489: the live test's reading of `codex login status`

**Why.** Round 1's reviewer found, on Linux, that codex-cli 0.159.2 writes a warning line to standard
error before `Not logged in` when `CODEX_HOME` is under a temporary directory (N2 on #583). The
first gated live test asks an empty home under `TMPDIR`, and read the answer with `startsWith`. So
it would have read no verdict where the adapter reads `false`, and failed on a correct adapter. The
owner makes that run once, before the token expires on 2026-10-06, so a test that fails for the
wrong reason would cost a second run.

**What was measured.** On macOS, `codex login status` was run with `HOME` and `CODEX_HOME` set to
empty directories under the scratch `TMPDIR`. It printed the same `WARNING: … Refusing to create
helper binaries under temporary dir …` line before `Not logged in`, and exited 1. No credential file
was read, and nothing was written in either directory. Over that output, the test's old reading gave
`null` and the adapter `false`. With the new reading, both give `false`.

**Still independent of the adapter.** The test reads the CLI's words line by line itself. It does
not use the module's patterns, so it still ties the adapter's copy to the CLI (`D16` rule 2).
