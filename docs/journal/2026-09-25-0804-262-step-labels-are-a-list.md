ABOUTME: Records card #262, which has the config validator refuse a provisioning step's
`select.labels` that is not a list of label names, through the check a kind's labels already use.

# 2026-09-25 — A step's labels are a list too

#258 left a gap on purpose. A provisioning step's `select.labels` has a kind's shape, and nothing
refused a malformed one. Nothing reads it yet, so today it crashes nothing. The first card that
reads it would have inherited a throw where a refusal at config load belongs.

The fix reuses `readLabels`, the check #258 wrote for kinds, rather than adding a second one
beside it. A new `readProvisioning` walks the steps and hands each step's `select` to it. A step
with no `select` is skipped, because a step that selects nothing is selected by the kinds that
name it. That state is legitimate, not a gap.

Sharing the check changed one message. The empty-list refusal said "the kind `name` selects no
card", which is wrong for a step. It now says the key selects no card, and the key names the
kind or the step already. The `name` parameter went with it.

The card was amended before work started to refuse a label holding only whitespace. The shared
entry check now tests `label.trim() === ''` in place of `label === ''`, so the refusal reaches
kinds and steps from one line. A kind with such a label would select no card while the config
was accepted.

The tests for a step's empty list and a step's non-name entry passed on their first run. They
went through the shared check, which already refused those shapes for kinds. The mutations in
the pull request are what show each test discriminates. Removing the call to `readProvisioning`
reds all four step tests, and removing each refusal inside `readLabels` reds its kind test and
its step test together.

The priority options check still uses `option === ''`, so it accepts an option holding only
whitespace. The card covers labels only, so that is reported with the pull request rather than
changed here.
