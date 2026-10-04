ABOUTME: Journal for #586's round-1 revision: the signal-0 fallback applies only where every read
after the kill failed, and the four cases' tests pin how the member the kill ended is recorded.

# #586 — a later read decides

**Why.** Reviewer B found a regression in the first round (N1). `ended` kept `unread` from the first
failed read after the kill, even where later reads succeeded. So `reachedUnread` recorded a member a
later read had listed as a zombie as `*.unended`, where `main` recorded it as killed. The card's
condition is a table that fails every read after the kill, and nothing else.

**What changed.** `ended` now also hands back `unlisted`: why reads failed, where every read after
the kill failed. `reachedUnread` acts on that alone. `unread` still sets the group's kill in place
of what the reads could not list, as on `main`. Two tests reproduce N1 with a `ps` stand-in that
fails only the first read after the kill. At `1acb41f` both recorded the zombie as `*.unended`.

**The other half (N3).** With `&& answers(pid, kill)` dropped, every named member under a failed
read was recorded as unended, and the four cases' tests still passed. They checked only that the
member the kill ended was recorded once. They now check that it is recorded as killed, and that
mutation reds all four.

**What is left.** Where a read after the kill succeeds and every later one fails, a member the kill
left alive that no later read listed is still recorded as killed, as on `main`. That case is outside
the card. The code states it under `D16` rule 3.
