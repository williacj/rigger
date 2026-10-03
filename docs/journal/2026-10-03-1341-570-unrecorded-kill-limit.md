ABOUTME: Journal for #570 (M4-02e): the Failure model now states the one kill no read can record,
and that the code records that limit, after #553's engineer judge.

# #570 — the one kill no read can record

**Why.** #553's engineer judge found a window no read of the process table can see. A process joins
a group after L0's last read before the kill, the kill ends it, and a parent outside the group reaps
it at once. No read ever shows it, so nothing records it. Recording the group's kill on every kill
would cover it, but that record would be false wherever the read before the kill found only zombies.
The base code already recorded that limit under `D16` rule 3. The Failure model, though, said without
limit that such a process "is recorded as the kill of the group".

**What changed.** The sentence now says the group's kill is recorded wherever a later read finds the
process, and names the one case no read finds, with the code's record of the limit. The requirements
side is #569 (M4-01d), which proposes `R-STATE-20` as an exception to `R-STATE-12`, `R-STATE-13` and
`R-STATE-19`. It merges with or before this card.

**Order.** This is a proposal, and the owner's merge ratifies it (`D21`).
