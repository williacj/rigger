ABOUTME: Records the acceptance-scoped correction to card 615's pre-kill sighting fixture.

# Card 615: keep the protected liveness probe

An independent reviewer of `fc2816a8497ff237ec255184ba6653bd2877f204` found that it removed selected-base `test/census-sightings.mjs:45–46`. The filed #615 acceptance permits removal of only the separately granted selected-base fixture lines 10, 21 and 52. That code was locally green but out of scope and was not pushed or offered as completion proof.

This revision restores both protected original lines. It adds one check of the same, uncut, real `/bin/ps -g <group> -o pid=,stat=` answer that precedes the group kill. The selected-base `-p <member> -o stat=` check remains and can still mark the member live. The additive check can also mark it when the group read returned a non-zombie row but the later per-PID read did not. The prepared cache applies only to `-ww -g` and name reads; the last `-g` answer comes from the real tool. This is one hypothesis for the hosted A0 failure, not an established account of the old runner's missing inner original.

`git diff -U0 3669df48014d4e1a1062f8745f74abab14549eed -- test/census-sightings.mjs` now removes only selected-base lines 10, 21 and 52, whose current-base grants were posted on #615. The reviewer must rule this new diff independently. The old hosted jobs remain failed and noncredit, including their separate D6, D8, read-deadline and CPU-ratio symptoms.

Before retesting, an escalated `ps -p $$` succeeded and `pgrep -fl 'test/suite.sh'` found no running suite. Both focused A0 paths passed: two tests, zero failures, complete stdout 6,423 bytes, SHA-256 `350db113a1435a9e05622c20c4cfb30f772bda8409019383f3b2d43aee084456`. The complete local `npm test` passed 3,309 tests, 3,292 passes, zero failures and 17 skips; its stdout is 1,012,613 bytes, SHA-256 `07d237b717cf63730b85d49d4d4a8ddd758bc217690221ab167da81816cf89ae`; both stderr streams are empty. The private originals are under `/private/tmp/c615-a0-additive.4wLSv8TB`. `npm run matrix:check`, `git diff --check` and `node --check test/census-sightings.mjs` passed.

The local pass is not a hosted verdict. The candidate needs an ordinary commit hook, independent code review, a fresh exact-head hosted run and a fresh judge verdict before merge.

The first ordinary commit hook was refused because I reused that same evidence root for a second full suite. Fifty-six tests tried to create fixed-name evidence children that the earlier suite had already created; `EEXIST` was the visible setup failure. The hook reported 3,309 tests, 3,236 passes, 56 failures and 17 skips, and made no commit. Its complete 1,081,833-byte standard-error original, SHA-256 `1f3df33e52f1c44742b0fd5d9bac6a428c63624565ee72e68e836d37ecd929ad`, is retained under the same private root as `commit.stderr`; standard output was empty. This result remains failed and noncredit. The unchanged staged code requires a new unique root for its ordinary hook run.
