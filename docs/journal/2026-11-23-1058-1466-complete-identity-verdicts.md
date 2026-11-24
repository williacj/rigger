<!-- ABOUTME: Records the T8 verdict-order correction exposed by the guarded identity mutation. -->

# Card 1466: complete identity verdicts

The first final-head receipt sequence at 536e5afd stopped without credit on identity: its original assertion failed before the newly added child matrix ran, so mutation:receipt reported fewer verdicts. The exact no-verdict receipt, original/native output, load and byte-equal restoration remain in 1466-r5-mutation-identity.json and its log under the external evidence directory. The two preceding receipts passed at that earlier head and are historical only.

The two original stopped-identity assertions now follow the child matrix, retaining their values and intent. A guarded local removal of the stopped identity comparison reaches count=7, pass=6, fail=1, cancelled=0, with SIGKILL instead of SIGCONT on the named parent assertion. All six ancestry cells still run. The source is restored byte-exact with clean source status; 1466-r5-order-guard.log and 1466-r5-order-red.log retain the guard and full output. The restored test passes count=7 in 1466-r5-order-green.log.

Production bytes and deterministic tests are unchanged from the preceding passing full run and commit hook. The correction requires a new head and renewed final-head receipts and verification; earlier-head evidence earns no current-head credit. Acceptance remains f5f416c9b828, with item 27 pending ci:full. This is a test-completeness correction, not a host flake or maker verdict.
