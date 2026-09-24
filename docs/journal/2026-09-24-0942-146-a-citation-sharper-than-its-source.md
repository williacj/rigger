ABOUTME: Card #146's second finding: cutting a restatement leaves a citation behind, and the one
this sweep wrote was more precise than the sentence it replaced, so it was falsifiable where the
restatement had not been.

# 2026-09-24 — A citation sharper than its source

The sweep cut a restatement in `.claude/skills/agent-style/SKILL.md`: four rule names spelled out
inline, where `.claude/skills/spec-style/` already holds each rule and the test behind it. The cut
was right, and the replacement carried a defect the restatement had not. It said a role prompt is
written in "rules 1 through 4" of that skill, "the same form rules as the binding documents" —
which asserts the binding documents have four form rules, where the skill it points at states
five.

A shorter claim about a source is not a weaker one. The replacement compressed the four names into
a range and an equivalence, and both assert a count about text the citing document does not own.
That is what made it checkable, and it failed the moment the owner opened the source. The
restatement it replaced had been wrong in the same direction and had asserted less.

Neither arm of the sweep could have caught it. Both read the six skills as they stood before the
edit, so both were blind by construction to a sentence the edit wrote. `AGENTS.md` already covers
the gap — open the source where it lives as you write the citation down — and it binds a
replacement citation exactly as hard as the passage cut.

The range also hid the reason a rule was left out. `.claude/skills/spec-style/`'s description
scopes its rules, and a role prompt falls outside that scope, so a prompt borrows them rather
than falling under them. The ownership split among them reaches a prompt by the other route, from
`AGENTS.md`, which is where this skill's "The one test" already sends it. A reader handed "1
through 4" has to reconstruct all of that from a missing number.
