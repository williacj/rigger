ABOUTME: Card #82's finding about source suffixes, hidden test names, and the test runner's answer.

# 2026-09-23 — The runner passed over the name

The budget walk had two ways to miss production code. Its source suffix check ignored extensions
whose case changed, and its test-name check treated `.test.mjs` as a test even though the runner
passed over it. One runner comparison, in both directions, now carries each of the measured
undercount names. Removing either fix makes it fail on the name that fix owns.

The follow-on was `a.TEST.MJS`. The case-folded glob selected it on Node 24 for Windows, but the
loader refused the uppercase extension before any test ran. The budget must charge that file;
the test-name predicate now checks whether the extension can load before exempting it. That case
gets its own assertion because a relation fixture containing a file the loader refuses would
make the runner measurement fail before it could answer the other names.
