ABOUTME: Journal for #494: the starter settings admit the maker's edit and the judge's verdict comment.

# #494 — starter permissions for unattended work

The spike for #493 measured file edits and pull request comments refused in unattended sessions.
The live settings and the template now add only the two permissions that answered those refusals.
The exact allow list has a test, and `init`'s existing comparison keeps the live file aligned with
the template consumers receive.

The spike's direct-write probes do not establish a boundary against code a session can edit and
run. Card #638 owns the forge boundary for the default branch; this change does not settle it.
