ABOUTME: Card 767's bounded prepared-name byte relation, regression evidence and unresolved historical incident.

# Prepared name byte provenance

Card #767 uses the PM's replacement acceptance and exact source grant. The maker base is
06b4bcf; git diff from reviewed 55df9e6 to that base reports no change to the two scoped test
sources. This work adds coverage and does not claim a product fix or explain the historical
padding mismatch.

The controlled preparation retains raw stdout and stderr separately. The cache retains the
raw name bytes. At consumption, the existing shell command substitution removes terminal
newlines and the existing printf supplies one line terminator. Neither operation removes
trailing spaces. The ROW log retains that framed value before its END record. Expected values
in the regression are literal byte relations for an unpadded name, three trailing spaces and a
terminal newline; no command-name trimming is introduced.

A second controlled table reaches the name read before returning empty success, status-one
empty, nonzero error or a timeout error. Each rejects admission, retains separate complete
stream originals and leaves no valid cache. The existing state-corruption control remains;
an additional copied-log mutation changes a consumed name in substance and must be rejected
without altering its retained original. Existing identity, birth, timeout and read-count
guards remain unchanged.

Measured with Node 26.12.0 on Ubuntu WSL at the maker base plus the new tests, the focused
name-byte and preparation-outcome target passed two tests with zero failures or cancellations.
The complete original is retained as 767/name-baseline.tap in the private test-log collection.

The discrimination experiment replaced only the prepared name read with a sed operation that
removes trailing spaces. A unique-anchor check preceded the write, readback confirmed the
replacement and the retained 767/strip-spaces.diff records it. Both target tests reached
verdicts: the byte test failed at the named spaces assertion, returning tail plus LF instead
of tail plus three spaces and LF; the preparation-outcome test passed. The complete original
is 767/strip-spaces.tap. The fixture was restored byte-for-byte, and git status for it was clean.
This proves the added assertion rejects space loss at that boundary. It assigns no cause to
the old occurrence.

The first affected-host invocation omitted TMPDIR, which the existing sighting observer
requires to validate its scratch authority. Four selected real-host/wrapper tests failed
during setup; no cache assertion was reached in those cases. The complete original remains
767/affected-host.tap. Setting TMPDIR to a separate scratch directory corrected the invocation;
no code changed. The same target then passed eleven tests with zero failures, cancellations
or skips, as measured by node --test in 767/affected-host-corrected.tap. The invocation set
EXIT_SIGHTING_REQUIRES=answered, so a cleanup deadline cutoff could not earn real-cache proof
credit. The actual real-ps binding and both corruption controls reached answered observations.

Final deterministic and budget verification is recorded with the reviewed head
in the pull request. macOS execution remains a separate CI result, not a WSL measurement.
