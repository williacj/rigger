ABOUTME: Why report joins marker reads to dispatch events across a state directory's whole stream.

# Report marker dispatches

`marker.read` is a record that L2 encountered a marker. It is not evidence that Rigger dispatched
its author. L3's `dispatch` identifies the card and role, while L1's `dispatch.start` identifies
the pull, head and evidence digest. The report joins those events on dispatch id across the full
state stream, including starts in earlier runs. It names agent marker reads that do not join and
every distinct marker when two or more name one dispatch id, even if each joins.

Repeated reads of the same recorded marker can occur on later pulls. The event has no marker
comment id, so the report counts one read for each distinct recorded marker shape apart from
the pull, run and `edited` flag. A genuine marker read before and after its comment is edited
remains one marker; the flag alone does not make its dispatch id shared. Two markers carrying the
same dispatch id but different recorded content remain two named markers. The report states its
scope: it sees only L2 reads in this directory and does not check owner markers.

A real `needs revision` marker and a forged `sound` marker can copy the same dispatch id, head
and evidence digest. Both join the dispatch, so checking the join alone misses the forgery. A
test writes both through L5's sink and fails before the shared-id check is added. The test over
the report's full output removes only the required L2 edge line; an injected L1 signal in the
marker section still makes it fail.

The shared-id check first treated a change in `edited` as a second marker. A test that writes
one joining marker read before and after the edit failed with two identical named lines. Leaving
`edited` out of the distinctness key made that test pass while the different-verdict shared-id
test still names both markers.

The first test failed because report printed no marker section. A second focused run exposed the
old whole-output assertion that excluded L2, which the required scope line now mentions. The
assertion still checks every preexisting signal line; the marker section has its own tests. The
join dimension tests failed while the implementation checked only for an L1 start, then passed
after the full join was added.
