<!-- ABOUTME: Records card 1466's shared tracker correction following PR 1475's architect finding B1. -->

# Card 1466 — shared tracker service

The architect's round-one probe at head 62a3c2ca reproduced B1: B's ending
cancelled the shared timer, moved its period to the final read, and withheld
that read's ancestry from A. The maker reran the unchanged probe before the
fix. It failed on the postponed one-second read, with no signal or event for
A's escaped descendant. The full output is 1466-r2-architect-red.log in the
external codex-1466-tmp directory.

Periodic reads now own their cadence. Stopping B cancels the timer only when
no dispatch remains active. A final read queues behind any pending read,
serves the ending dispatch and every still-running dispatch, and neither
moves the periodic start nor arms another timer. Synchronous final reads
also serve the dispatches the exit cleanup has not yet reached.

T11's controlled invariant now includes B ending at 500, 1000 and 1500 ms.
Each case checks A's unchanged cadence, a descendant visible only to B's
final read, and one visible to the next periodic read before its parent
exits. All three were red before the implementation change. The unchanged
architect probe is green after it, retained as 1466-r2-architect-green.log.

The same invariant includes synchronous final-read sharing and a final read
held past the next periodic deadline. Those cases first failed respectively
on the lost peer descendant and an extra read at 1500 ms. The complete red
outputs are 1466-r2-exit-sharing-red.log and 1466-r2-slow-final-red.log;
1466-r2-slow-final-green.log holds all five passing cases. No case sleeps or
adds a requirement declaration.

The whole-head tracker search and consumer inventory are retained in
1466-r2-fault-search.txt and 1466-r2-consumers.txt. Both async and synchronous
final reads were instances of B1's observation fault; no other implementation
or required outside-scope change was found. G2's network sites and the
runCommand pin follow the source. T11 changes only lines added by this card,
so no additional existing-line grant is needed. The matrix is unchanged.

The initial network retarget helper refused a removed armTracker site before
writing its output. The subsequently invoked named network/budget run caught
that stale inventory and pin; its complete output remains
1466-r2-network-green.log despite that premature filename. After retargeting,
1466-r2-network-retargeted.log reports the complete files green. No failed
attempt is claimed as passing evidence.

Final-head serial receipts, host checks, the unchanged Mac containment
verifier, slot-wrapped hook and fresh-clone verification, and CI evidence
are recorded in PR 1475. Acceptance revision K7 f5f416c9b828 still governs all
30 items. Item 27 remains pending the owner's ci:full sequence. The maker
changes no label, judges no verdict and performs no merge.
