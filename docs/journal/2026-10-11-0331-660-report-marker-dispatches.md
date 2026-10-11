ABOUTME: Why report joins marker reads to dispatch events across a state directory's whole stream.

# Report marker dispatches

`marker.read` is a record that L2 encountered a marker. It is not evidence that Rigger dispatched
its author. L3's `dispatch` identifies the card and role, while L1's `dispatch.start` identifies
the pull, head and evidence digest. The report joins those events on dispatch id across the full
state stream, including starts in earlier runs, and names agent marker reads that do not join.

Repeated reads of the same recorded marker can occur on later pulls. The event has no marker
comment id, so the report counts one read for each distinct recorded marker shape apart from
the pull and run. Two markers carrying the same dispatch id but different recorded content remain
two named markers. The report states its scope: it sees only L2 reads in this directory and does
not check owner markers.

The first test failed because report printed no marker section. A second focused run exposed the
old whole-output assertion that excluded L2, which the required scope line now mentions. The
assertion still checks every preexisting signal line; the marker section has its own tests. The
join dimension tests failed while the implementation checked only for an L1 start, then passed
after the full join was added.
