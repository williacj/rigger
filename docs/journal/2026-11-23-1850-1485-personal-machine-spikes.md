ABOUTME: Records where the rules for a spike on a personal machine live, and why no prompt holds them.

# Personal machine spikes

`docs/host-bootstrap.md` owns what a spike on a personal machine may collect and publish. A spike
card that adopts the section binds its maker and its judges.

Pointers in the spike engineer's prompt and two skills were tried first and reverted.
`test/init.test.mjs` holds each file under `.claude/` equal to the template `rigger init` ships, so
a rule for this repository alone has no place there. That test is in the host tier, so a green
`npm test` did not show the failure. A change under `.claude/` owes a host run of that file.
