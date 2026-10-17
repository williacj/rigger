ABOUTME: Records the queued-merge coverage gap and guarded red/green proof for #768's review round.

# A merge behind a waiting merge (#768)

The round-one reviewer found a gap in the `R-SCHED-26` cell about another merge queued behind
one waiting on unknown mergeability. The prior two-card test made its first merge immediately;
the second card waited only after that first merge had ended. It could not detect a lane that
released its turn during an unknown-mergeability pause.

The added test claims both `R-SCHED-26` and `R-SCHED-15`. It holds card 140's injected pause after
the forge answers unknown while card 141 has already been pulled. It reads the stream before
releasing the pause, then reads the final stream and forge calls. Card 141's `merge.start` must
follow card 140's `merge.end`.

At head `f33d812a0095609aa8abbb1f00d06c6fcfbef04e` with this test uncommitted, I applied
one guarded mutation to `src/scheduling/lane.mjs`: the merge released its queue turn before the
unknown pause. All three replacement anchors occurred once. `git diff` showed only that
production file changed, by six added and three removed lines; its mutated SHA-256 was
`4f3d1823f620abe3f0e0b2182039d9e9da55af2c07fbc1a1577bbe47fa2bd027`.

The slot-held `node --test test/lane.test.mjs` run in `queue-mutation-red.log` began and ended at
one-minute loads 7.88 and 7.85 on 2026-10-15 UTC. It ran 69 tests: 68 passed, and only the new
test failed. The observed starts before releasing the pause were `[140, 141]`, where the test
required `[140]`. This is the premature queue release the mutation was intended to model.

I restored `lane.mjs` byte-for-byte to SHA-256
`d09ced015225c656a8d0beec4f88dc82bf921f1df9578274daedaa3ef23f1efc`;
`git diff --exit-code -- src/scheduling/lane.mjs` passed. The slot-held named-file run in
`queue-unmutated-green.log` passed all 69 tests at one-minute loads 7.79 and 6.98. A later
named-file run after tightening the L2-answer assertion passed all 69 in `lane-final-green.log`
at loads 6.24 and 6.13. The original production behavior already held the turn; this revision
closes its missing test cell.
