ABOUTME: Journal for #488's round-1 revision: a test that the settle's fulfilled facts reach
`decide` and the judges' dispatches exactly as the settle answered them.

# #488 — the settle's facts, unread

**The decide tests proved "unread" only on rejected facts.** The reviewer's round-1 verdict on
#590 found item 5 unmet. The extended decide tests in `test/attempt.test.mjs` compare the ask after
the settle against a settle answer whose fake repository holds no pull request, so its `pull`,
`diff` and `comments` are all rejected. The one world that serves fulfilled facts asserted only
which roles were dispatched. A loop that rewrote the pull request's head before `decide` saw it
(the reviewer's mutation B) passed every test.

**The new test watches both sides of the hand-over in the judge world.** It builds a second loop
over the world's own handles, wrapping `l2.settled` to keep what the settle answered and `decide`
to keep every ask with how many settles had answered before it. It then asserts the settle's
review reads are fulfilled with the head, base and diff written by hand in `judge-world.mjs`,
every ask after the settle carries a `forge` deep-equal to that answer, and both judges'
`dispatch.start` name that base and head. No existing test line changed.

**Both mutations red on the hand-over assertion.** Mutation B, the reviewer's head rewrite, and a
second that drops the fulfilled `diff` from the facts, each fail the new test at its
`deepEqual(options.forge, settled)`, with the anchor matching once, the mutant parsing, the one
targeted test reaching a verdict and the file restored clean. Their logs are on #590.
