<!-- ABOUTME: Records the admission claim gate and the output of once and run when a pull cannot be admitted. -->

# Admission gates claims (#936)

`take` reads admission after L2 answers the cards and immediately before it takes claims. A closer linked while the facts call is pending therefore stops that pull. A closer linked after the read leaves its already claimed cards to finish, and the next freed-slot trigger reads the closer.

`rigger once` and `rigger run` share the same pull presenter. Under a closed admission, each names every closer's kind, reason and time, keeps L2's refusal lines, prints no "no card was pullable" line, and exits 0.

Under an unreadable admission, each names every unreadable path and cause, keeps L2's refusal lines, prints no "no card was pullable" line, and exits non-zero.

The admission module remains the reader and writer of `.rigger/admission/`. `take` calls its read through one handle built from the state directory `loop` was already handed, and makes no admission write.

The pending-facts test checks L3's claim event before reading the pull's answer. The freed-slot test releases an incorrectly started third maker so the run can finish and expose the extra claim. The resume test checks the second pull's dispatch record if that pull closes instead of waiting for a maker that will never start. Guarded early-read and cached-read mutations reached those assertions before the original source was restored.

The blocked-pull test observes admission write operations during `take`, so a temporary entry removed before the answer still fails it. A guarded read that wrote and unlinked `.tmp-judge-probe` made that test fail on both operations; with the source restored, the named loop file passed.
