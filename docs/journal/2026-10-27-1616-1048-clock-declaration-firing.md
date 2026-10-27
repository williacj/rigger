ABOUTME: Journal for #1048 (M7-04a): "Triggers" places the clock declaration's keys, arming, how a
clock trigger fires, its in-process job and the guard against a second card for one occurrence.

# #1048 — the clock declaration and how a clock trigger fires

The placements come from the architect's reviews on #1009. The r1 review (1009#6433591635) gave S6,
the interval-and-anchor schedule, the parser in `src/config/` and the in-process `report`; S7, the
last firing read from the record; S8, card creation in L2 under a new cause; O2, the first firing;
and O3, the unreadable record. The r2 review (1009#6434658018) gave §2, F3, the duplicate guard on
the hold's `after-<k>` pattern, and §3, F4, arming as a `trigger.armed` event.

The owner's answers placed are M7-U2 (1009#6434513387): Q3 (a), another card while the previous
one is open; Q4, the card created and the job run under closed admission; Q6 (a), `report` the only
job; Q12, `run` only; Q13, a newly declared trigger first fires at its next scheduled time; and
Q14, an unreadable record fires nothing and pulls continue. M7-U3 (1009#6440291524) item 1, Q15 (b),
names the card's author in the trigger's config.

The pre-dispatch attack (1048#6453553453) and its recheck (1048#6453619442) placed four cells the
card then carried: arming compares against the newest arming, step 5 opens nothing for an
undeclared or re-armed trigger, L3 hands the verb `report`'s output unread, and a failed read in
step 5 leaves the firing pending.

Choices the card left to the maker:

- **The catch-up firing carries the newest missed occurrence.** That occurrence is the guard's key,
  and the newest is the one the consumer would see as current.
- **`skip` needs no event.** An occurrence due at a start is missed. After the start, only an
  occurrence later than the start fires, so a skipped one never fires in that run.
- **A firing is never in flight.** It holds no claim and no slot, so neither the poll nor the drain
  waits for it, and it fires while claims are held.
- **Firings run one at a time**, by occurrence and then by name, as L3's notice calls do.
- **A pending `report` firing is abandoned, not run again.** The next report shows every event the
  lost one would have.
- **A failed read of `k` records no start**, and L3 tries again one `poll` interval later.
- **An unreadable record holds for the run's life.** A line that does not parse stays so until a
  person mends it.
- **The config keys** are `interval`, `anchor`, `card` or `job`, and `catchUp`, with `card` holding
  `title`, `labels`, `acceptance` and `author`. Every key but `author` is required. Live rows
  already refuse a template with no acceptance (`R-SCHED-40`), and one whose labels select no kind,
  as missing labels do (`R-SCHED-41`). No row refuses a missing `interval`, `anchor`, `catchUp`,
  `title`, or both `card` and `job`, so M7-20's refusal of those rests on this placement.

A schedule changed back to one an earlier arming holds re-arms the trigger, as `R-SCHED-37` reads.
The owner ruled so in M7-U7 Q31 (a) (1009#6454836792), once #1020's rows had landed in PR #1045.

The round-1 review of PR #1050 (1050#6454802746) found the settling order wrong. Recording a found
card's outcome before placing it in Ready let a failed placing leave it on no board. A closed marked
issue in no column was also moved to Ready. The outcome now follows the placing, and only an open
issue is placed.

The round-2 review (1050#6456002565) found the re-arm exclusion lost across a second crash. A start
that re-armed and then crashed left the next start seeing no re-arm, so settling opened a card for
the old schedule. Settling now compares against the record: a `trigger.armed` of the name after the
pending start excludes a card, at whichever start settles it.
