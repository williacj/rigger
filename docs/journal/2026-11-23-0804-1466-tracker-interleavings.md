<!-- ABOUTME: Records card 1466's tracker state machine and controlled concurrency proof after PR 1475's second review. -->

# Card 1466 — tracker interleavings

PR 1475's second review found two defects in shared tracker concurrency: a dispatch
admitted during a read missed its answer, and turnover during an in-flight read
could arm two periodic timers. Both unchanged judge probes failed at faacc08a.
Their full outputs and exact probe bodies are retained outside the checkout in
codex-1466-tmp as 1466-r3-architect-red.log and 1466-r3-reviewer-red.log.

The tracker now has one state machine owning its read queue, in-flight state and
periodic timer. Reads finish serially; only settlement advances the queue and arms
periodic service. A final read preserves an existing peer timer and the periodic
start time. Each read delivers its answer to both its starting recipients and
all dispatches tracking when it settles. The invariant is stated beside the
controller in src/substrate/process.mjs.

T11 retains its slow-periodic and synchronous exit-sharing checks and replaces
the individual asynchronous interleavings with a generated matrix. Its axes are
periodic or final read, B admitted before/during/after that read, success/failure,
A ending before/after settlement, and release before/after the next deadline.
A final read belongs to C so A's ending can vary independently. Every cell checks
read serialization, a single periodic timer, cadence, peer cancellation,
descendant attribution, retained earlier identity and descendants.unread.

The first matrix run exposed an oracle mistake for a new dispatch starting after
a genuinely idle interval. Later runs exposed the fixture's injected cleanup time
between a held read's release and overdue periodic service. The corrected oracle
uses the observed overdue read's start, without moving a future deadline. All
failed originals remain in the 1466-r3-matrix logs; none earns passing credit.
The unchanged judge probes passed after the source correction.

The late-release cells also put A's end after the periodic deadline, before B
starts while the final read remains held. Both success and failure cases first
reported five reads where four were required (1466-r3-queue-red.log). The state
machine now coalesces queued periodic service with a newly admitted first read.
The expanded matrix passes in 1466-r3-queue-green.log. This closes the queue's
turnover boundary as well as the timer's ownership boundary before publication.

The renewed fault search enumerated every tracker scheduling and observation
path, including synchronous exit reads. Consumer inventories cover suite lists,
network pins, fake-gh, in-process fixtures and the generated matrix. No required
change outside Lands in was found. G2 retargets the network sites and parser pin;
existing site reasons and program declarations are preserved from the merge base. T11 changes only lines
this card added, so no additional existing-line grant is needed. No requirement
declaration changes and no matrix regeneration is needed.

Final-head serial mutation receipts, affected host checks, the unchanged Mac
containment verifier, fresh-clone deterministic verification and CI evidence are
recorded in PR 1475. Acceptance revision K7 f5f416c9b828 remains the bar. Item 27
stays pending the owner's ci:full sequence. Local host proof is macOS only;
Linux remains unproved under D13. The maker changes no label and does not merge.

The grant audit also restored existing program declarations that the earlier
inventory generator had replaced with a blanket local-reader list. G2 permits
retargeting text, mentions and coordinates and adding /bin/ps; it does not permit
replacing the other declared programs. The original declarations now remain
intact, including configured role CLIs. This changes inventory metadata only.
The complete network and exit-budget files verify the correction in
1466-r3-grants-green.log before the final metadata commit.
