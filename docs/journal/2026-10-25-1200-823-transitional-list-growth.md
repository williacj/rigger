ABOUTME: Records the event comparison and real snapshot proof for the transitional-list growth check.

# Transitional-list growth

Card #823 defines the event table and the no-growth outcomes. The CI script follows that table,
asks the committed suite for both lists, and refuses a new entry with its list and path. Git's
ancestry answer distinguishes a base preceding the list introduction from a later unreadable
base. The introduction is #819's actual merge commit, rather than a test for file absence.

The real read archives the complete committed `test/` directory into a temporary snapshot. The
suite validates every listed file there before producing its list. No checkout, index, worktree
or branch changes during a read.

Focused Node 26 verification on the #823 worktree observed the intended failures and subsequent
passes for the event rows, unavailable history, list-read errors, actual snapshot wiring and
CLI failure propagation. The unchanged and shrinking cases also pass. Retained command receipts
identify their executed source, runtime, host, streams and results; these focused results do not
stand in for final ordinary, affected-host or supported-host evidence.

The host fixture uses the repository's actual suite and establishes its file-validation premises.
It commits two suite snapshots, removes one entry from each transitional list in the second,
and reads both commits through the script's real Git adapter. The same host file executes both
actual worker commands with a refused event and observes their failing exit status. The CI delta
inserts only the two unconditional commands, before `npm test` in `fast` and `nightly`.

The first combined host invocation omitted npm's entry-point environment; its existing forwarding
checks failed. The corrected invocation then exposed the exact host-membership expectation's
missing new member. The card's author adopted G2 after independent review, admitting one literal
expectation addition while retaining the existing members, sort and exact assertion. The new
G1 host entry follows that list's ordering. The failed attempts remain retained with their
original commands and source; later passes do not erase them.
