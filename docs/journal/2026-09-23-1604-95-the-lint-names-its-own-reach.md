ABOUTME: Card #95's finding about the lint's measured scope and the form rules people still check.

# 2026-09-23 — The lint names its own reach

`npm run lint:spec-style` reported four files, while the M0 plan said it covered every document.
The owner chose to correct the plan to the four files the lint reports. The exit check now
compares the lint's reported scope with that statement, and authors and reviewers remain
responsible for form rules outside it. A green lint run proves nothing about a document it does
not name.

The skill's description named `docs/spec/` as a directory, while the lint leaves retired
registers out of that directory. The skill now states that limit in its description and lint
explanation; its four form rules and the lint's parser are unchanged.

The test naming this scope also said “authored files under `docs/spec/`” while its fixture excluded
retired registers. Its title now names the four checked files; the test assertions are unchanged.
