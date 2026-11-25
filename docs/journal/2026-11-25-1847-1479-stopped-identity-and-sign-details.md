<!-- ABOUTME: Card 1479's response to the independent identity, report-proof and inventory findings. -->

# Card 1479: stopped identity and independently named signs

The architect's F1 and F2 and the reviewer's B1 and B2 on PR #1503 identify the work in this revision. Acceptance remains the card author's revision 9bf3ef0a668f. Item 30 stays pending the coordinator's later ci:full run.

The restart now retries a recorded process through the existing sweep. It stops the process and rereads its start time before SIGKILL. The whole-table snapshot no longer sends a destructive signal itself. A refused destructive signal ends that sweep's attempt; the sweep resumes the process and retains its sign.

The controlled regression gives the pid to a replacement immediately after the successful whole-table snapshot. Before the source repair, its named assertion reported that the replacement received SIGKILL. After the repair, it passes and leaves the replacement running. S3 separately requires a stopped identity read before its refused SIGKILL, one attempt, and a resumed process. Its red run reported two attempts before the refusal handling was repaired.

Each R-STATE-37 row now requires the fixture's expected sign details in the printable report. Structured reports and parsed printable reports also require each kind's fields independently: pid/name/cmd, read scope/reason, or path/reason. The tests no longer rely only on comparing output with the event's own object.

The guarded precommit unfinished-write reason mutation fails S15 on the missing write.reason. The printable-details mutation fails all thirteen selected declaring tests and subtests. Both originals are restored byte-for-byte, and their source files have clean Git status. Their full outputs, guards and native exits remain with the card's evidence; final-head receipts and the acceptance ledger are recorded in the PR body.

G4's changed inventory entries now name their actual source coordinates and operations. The removed early-retry reporting site loses its inventory entry, and the moved runCommand statement pin keeps its exact parser range. No inventory policy or Table S check changes. The generated matrix remains unchanged because no declaration was added or removed.

The baseline at round-1 head 485b0e3fd3f0c7c875b5f0f421e608ede6662895, measured by the slotted npm test run passed with tests=6289, pass=6289, fail=0, cancelled=0, skipped=0; one-minute load 3.65 to 6.25. The focused sign run after the new assertions measured tests=98, pass=98, fail=0. Complete logs and load figures are retained under the dispatched scratch directory and /Users/cjwilliams/GitHub/rigger-evidence/1479. The PR carries the subsequent final-head deterministic, host, fresh-clone, mutation, differential and CI evidence.

Linux remains unproved under D13 and M8-U97. The authored architecture cell remains subject to the owner's marker at the final head. No label or TQ/M7 card was mutated, and no merge was attempted.
