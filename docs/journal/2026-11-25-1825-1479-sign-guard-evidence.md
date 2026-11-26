<!-- ABOUTME: Card 1479's response to the independent second-round guard and sign-field attack. -->

# Card 1479: sign guard evidence

The completion bar remains the card author's acceptance revision 9bf3ef0a668f. This revision addresses note-1479-r4.md; it must finish with independent review, final-head verification and the PR's complete evidence ledger. Item 30 remains pending the coordinator's ci:full run, and the authored architecture cell still needs the owner's marker at the final head.

The input head was d5406a7a88a456e63335273a3a6d767eb7c92625. The slotted npm test baseline measured tests=6290, pass=6290, fail=0, cancelled=0 and skipped=0, with one-minute load 1.70 to 3.72. Its complete output is 1479-r4-baseline.log in the dispatched scratch directory and retained evidence directory.

I independently applied each of the attacker's twenty-six guard faults, the two fallback-field faults and the ignored stopped-read result. Each applied once, reached all 98 named sign tests without failure, and restored the source byte-exact. Those observations confirm the coverage gaps; they are not mutation kills.

The stopped-process regression replaces the identity at SIGSTOP. It fails with “SIGKILL sent to the replacement” both when the stopped identity result is ignored and when the destructive signal moves ahead of that read. Its unmodified and restored runs pass.

S20 now checks every sign in its printed reports against the independently expected write path and reason. A correct initial write sign cannot mask an incorrect exit fallback. Each fallback field mutation fails alone. R8 also checks the startingGroups producer's record path and parse reason independently, in the structured stop and the error handed to the verb.

The new guard witnesses cover invalid persisted fields, a settled entry's cleanup scope, retained dispatch censuses, an omitted group leader and absent entry at exit, cleared writes, partial-file consumption and field union, rejected dispatch outcomes, gone identities at a claim, provisioning attempt accounting and a clock-kept run's ending. Their guarded working runs reached named assertions, with equal phase counts and native exits zero, one and zero. The final-head receipts belong in the PR ledger.

Four surviving faults preserve the card's required behaviour. Removing g14's memory maintenance retains empty failure objects, but each object's process list was already replaced by its filtered list; an empty list cannot regain an identity or produce a standing sign. The maintenance remains to release that memory. Removing h11 or h20 changes duplicate multiplicity, rather than the identities retained, refusal or dispatch decisions; deduplication remains to avoid repeated durable identities and reports. Removing p18's ownership guard only repeats the final callback after exit took the call: on the supported L1 path its group was recorded, onExit has set ended, and the callback can only replace containmentSigns which the ended return never uses. The guard remains to avoid that redundant handoff. The PR must name these as equivalent against the card's behaviours, not killed mutations.

The placement reread's omitted host is not a reachable failed-write defect. The first startingGroups read either refuses a standing failed write, or clears its memory. A successful path reaches placement synchronously, without an await or another omitted-process write. A refused writability probe exits before placement. An external record change can affect the second file read, but cannot create in-process failed-write memory there. No production change is warranted by that finding.

G4's three unchanged-text entries retain their corrected source coordinates and regain their baseline reasons. The shared cwd answer is an added fixture export; its existing consumers reuse it, and no existing fixture export changes. No declaration is added, removed or retargeted in this revision.

The first expanded sign-file control measured tests=123, pass=121 and fail=2. Its two failures were fixture mistakes: the exit-only premise still included its setup command's signals, and the provisioning assertion assumed every initial workflow call had an outcomes array. Clearing the setup trace and accepting the observed absent outcomes fix those premises. The focused rerun passed all three exit/provisioning cases. These failures remain in 1479-r4-coverage-control.log, with their native exit and load figures.

The affected named run measured tests=269, pass=269, fail=0, cancelled=0 and skipped=0, with one-minute load 1.88 to 2.14. Its full output is 1479-r4-affected.log. The subsequent full, host, fresh-clone, containment, differential and CI results must be recorded against the published head in the PR. Linux remains unproved under D13 and M8-U97. No label, TQ/M7 card or merge is changed.
