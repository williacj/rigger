<!-- ABOUTME: Records the stage traces and unresolved causes of the five stand-in agent timeouts. -->

# The five stand-in timeouts remain unforced

Card #813 takes route N for `:177`, `:208`, `:225`, `:267` and `:389`. The new trace wraps the existing steps of both `:208` variants and `:267`. Their calls, order and assertions remain the same. The two skips at `:225` and `:389` remain because no cause was reproduced by an eligible forcing that leaves the step under test intact.

| Test | Route | What remains unknown |
|---|---|---|
| `:177` | N | Which await timed out in its hook occurrence and why. |
| `:208` | N | Which await timed out in the still-alive variant's fresh clone and why. |
| `:225` | N | Why the new S5 diagnostic's gate read did not return, and whether the older cancellations stopped there. |
| `:267` | N | Which await timed out in the reviewer's fresh clone and why. |
| `:389` | N | Which await timed out in its retained full-suite occurrences or its hook occurrence, and why. |

A diagnostic lone-file run with both skips lifted cancelled at `:225` under load above the eligibility bar. Its trace puts the test at S5: the gate's open had returned, the waiter was live, and the waiter's exit had not returned. The waiter's trace recorded `gate read starting` but no `gate read returned`. A passing trace records that return before the waiter's exit. This is evidence for where that attempt stopped, not proof that the gate caused the historical timeouts. An eligible forcing stopped the waiter around the original gate open and then resumed it; the test passed. The suspected gate-read timing has therefore not been forced as the card requires for route R.

The historical failing outputs name the timed-out test and its 60-second bound. They carry no per-step trace, so they cannot identify the pending await, the state of the waiter or writer at the bound, or one shared mechanism. The #826 `:389` occurrence has no retained runner output; only its note and PR description survive. The five tests could stop at different stages. The `:225` and `:389` lone-file cancellations show that those tests do not require full-suite concurrency, while the dependence of `:177`, `:208` and `:267` remains unknown.
