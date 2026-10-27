ABOUTME: Records how card #1026 added `src/substrate/forge/runners.mjs` to `AGENTS.md`'s
"Self-hosting" list, and that the card placed its test file in a tier it is not in.

# runners.mjs joins the Self-hosting list

The owner ruled in [M7-U2](https://github.com/williacj/rigger/issues/1009#issuecomment-6434513387)
item 15 that `src/substrate/forge/runners.mjs` joins the list, so M7-14 needs the owner's marker.
[The r1 review](https://github.com/williacj/rigger/issues/1009#issuecomment-6433591635) gave the
evidence: S5 found that every read `read.mjs` makes is sent through `runners.mjs`, and O5 asked for
the file to be listed. The bullet naming the gate's code now names it, with that reason.

The new test in `test/self-hosting-check.test.mjs` holds the section as it stood at `66e5b7c9`,
this card's merge base, byte for byte, beside `SELF_HOSTING_AT_B94E3F72`. A diff touching
`runners.mjs` touches no listed path under that section, and touches one under `AGENTS.md` at the
head.

The card placed `test/self-hosting-check.test.mjs` on `test/suite.sh`'s `host_tests` list. It is on
`converting_tests`, at `6af97ea5` and at `66e5b7c9` (`git show <ref>:test/suite.sh`, read), so
`npm run test:host` refuses it and `npm test -- test/self-hosting-check.test.mjs` runs it. A tier
claim on a card is worth reading off `test/suite.sh` at the ref the card reads at.

`AGENTS.md` holds 2,358 words at the head, against its budget (`npm run budget:instructions`,
measured 2026-10-27 on this branch).
