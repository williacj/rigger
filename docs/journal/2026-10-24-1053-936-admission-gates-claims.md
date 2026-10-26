<!-- ABOUTME: Records the admission claim gate and the output of once and run when a pull cannot be admitted. -->

# Admission gates claims (#936)

`take` reads admission after L2 answers the cards and immediately before it takes claims. A closer linked while the facts call is pending therefore stops that pull. A closer linked after the read leaves its already claimed cards to finish, and the next freed-slot trigger reads the closer.

`rigger once` and `rigger run` share the same pull presenter. Under a closed admission, each names every closer's kind, reason and time, keeps L2's refusal lines, prints no "no card was pullable" line, and exits 0.

Under an unreadable admission, each names every unreadable path and cause, keeps L2's refusal lines, prints no "no card was pullable" line, and exits non-zero.

The admission module remains the reader and writer of `.rigger/admission/`. `take` calls its read through one handle built from the state directory `loop` was already handed, and makes no admission write.

The pending-facts test checks L3's claim event before reading the pull's answer. The freed-slot test releases an incorrectly started third maker so the run can finish and expose the extra claim. The resume test checks the second pull's dispatch record if that pull closes instead of waiting for a maker that will never start. Guarded early-read and cached-read mutations reached those assertions before the original source was restored.

The blocked-pull tests inspect claim and board-write events before awaiting a pull that might dispatch work; unexpected work then settles through refusing fixture boundaries. Guarded bypasses of the closed and unreadable gates reached the claim assertion, and the restored gates passed. The no-admission-write test observes path writes and writes through descriptors opened under the admission directory during `take`. Guarded write-and-unlink and descriptor write-and-restore reads both failed its write assertion; the restored source passed. The same test resumes admission and requires the next pull to dispatch its card, so a guarded closed pull that retained a claim failed its claim assertion before the restored source passed.

The declaring no-write test checks L3's claim event before awaiting its first closed pull. A condition-based settling wait releases unexpected maker work. A guarded closed-gate bypass failed that test at `the closed take claimed a card` with one failed test and no cancellation; the restored gate passed.
