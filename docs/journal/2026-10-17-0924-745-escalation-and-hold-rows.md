<!-- ABOUTME: Journal for #745: what landing the escalation, hold and admission rows taught, and what the judges should read by hand. -->

# #745 — escalation, hold and admission rows

**A base run must never share a tree with the edit.** I queued the base suite in the clone and began editing while it waited for the slot. Had it started, it would have run against the edited registers and proved nothing about the base. I stopped my own queued wrapper by its recorded pid and ran the base in a separate clean clone. A slot queue is long enough to invite this, so a maker queues the base run in a tree it will not touch.

**"Environment failure" is wider than "infrastructure failure", on purpose.** `R-FAIL-5`'s table covers host failures, which hold, and card-local refusals, which escalate under `R-ESCALATE-12`. `R-FAIL-2`, `R-FAIL-4` and `R-SCHED-4` keep "infrastructure failure" for the host side. The table's lead list defines the three classes, because its Class column uses "host" and "card-local", which no binding document defined before.

**The register names the owner's column one way.** The draft used both "the owner's column" and "Owner". `R-ESCALATE-8` says "the owner's column", as the build plan's M6 bullet already did, so both new tables say it too, for one term per concept. The build plan's new exit line keeps "Owner", as the card wrote it.

**`check:references` does not read the build plan or `ARCHITECTURE.md`.** Its exit 0 says nothing about the five build-plan edits' citations. The judges read those by hand.
