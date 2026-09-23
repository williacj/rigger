ABOUTME: Card #95's finding about the lint's measured scope and the form rules people still check.

# 2026-09-23 — The lint names its own reach

`npm run lint:spec-style` reported four files, while the M0 plan said it covered every document.
The owner chose to correct the plan to the scope the skill gives the lint. The exit check now
compares the lint's reported scope with that statement, and authors and reviewers remain
responsible for form rules outside it. A green lint run proves nothing about a document it does
not name.
