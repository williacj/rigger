ABOUTME: Card #92's finding about declarations that a syntax reader cannot judge for honesty.

# 2026-09-23 — A declaration could pass with its behaviour gone

The matrix reader at #119's head could identify a `// proves` comment above a runnable test, but it could not know whether the assertion proved the named requirement. In a disposable clone, a false `R-PROV-1` declaration entered the generator's claim list. Replacing `workRequires` with a function that always returned true removed the optional-step behavior. The false test still passed, while the real optional-step test failed on `true !== false`. The source and test were restored clean.

The cheapest reliable judgment is for the reviewer to remove the claimed behavior and run the declaring test. A single production-line mutation, a declared assertion name, or a generic broken build would not tell the reviewer that the requirement's behavior was the one removed. The review skill now asks for the deletion experiment for each declaration in the work read, using the existing mutation-claim bar for evidence. It leaves the generator's syntactic job unchanged.

An existing positive-only test declared `R-ESCALATE-2` while its companion negative test held the refusal half. Removing the unknown-category refusal made the positive-only test pass and the negative one fail. The PR names that declaration unverified, rather than treating the row in the generated matrix as evidence by itself. No declaration or requirement row was removed; matrix regeneration produced no diff and still reported 92 of 99 requirements unclaimed.
