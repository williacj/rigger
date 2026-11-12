ABOUTME: Maker journal for card #1337’s forge history read and L2 acceptance records.

# Card #1337 — acceptance history

Acceptance revision: `2d6e454633d0`. The base is
`39c8d7c4b91f24ab59f84eac4320d0a783395ae8`.

The entries below are a pre-code inspection of the base, not completed verification.
The source inspected is `src/substrate/forge/read.mjs`, `src/workflow/transitions.mjs`
and `src/workflow/clock-mark.mjs`, read with `sed`, `cat` and `git show` on 2026-11-10.

| Row | Base premise and required work |
|---|---|
| M1 | Needed the history read and the synthetic opening revision for an unedited issue. |
| M2 | Needed chronological revision records for edits by the opener. |
| M3 | Needed preservation of another editor’s login. |
| M4 | Needed a whole-history read at each move, including intervening edits. |
| M5 | Needed revision digests and item counts derived from acceptance only. |
| M6 | Needed a deleted revision record that carries neither digest nor item count. |
| M7 | Needed pagination of the history read. |
| M8 | The transition-only outcome existed; no history read existed to exercise its failure. |
| M9 | The shared runner already had a deadline; the history read needed to use it. |
| M10 | Needed parsing of the opening body’s clock author and recording that author. |
| M11 | Needed an acceptance.history event that omits author for an unmarked opening body. |
| M12 | Needed emission of acceptance.history so a refusal could reach the caller. |
| M13 | Held by inspection: a refused item move exits before any successful-move record. |
| M15 | Needed refusal of an opening or revision with no login, naming issue and revision. |
| M16 | Held by inspection: made-write refusal and transition refusal already exit their paths. |
| M14 | Needed the history event on the common change path, reached by every declared cause. |

M8-K17 resolves the attack’s miscount: M14 binds the 13 causes declared at this
base. They are created, claimed, redone, returned, sound, continued,
continuedFromOwner, rejudged, merged, mergedFromOwner, conflicted,
conflictedFromOwner and escalated. The author’s G3 revision admits only the
history cases and adapter-file registration in the two fake-command inventories.

The live measurement on 2026-11-10 followed `gh auth status`, which reported the
active williacj account with repo scope. The command was:

```sh
gh api graphql -f query='query { repository(owner: "williacj", name: "rigger") { issue(number: 1302) { createdAt author { login } body userContentEdits(first: 100) { pageInfo { hasNextPage endCursor } nodes { editedAt editor { login } deletedAt diff } } } } }'
```

The comparison used Buffer byte equality, the returned times and acceptanceItems:

```json
{
  "date": "2026-11-10",
  "issue": 1302,
  "createdAt": "2026-11-09T03:05:58Z",
  "author": {
    "login": "williacj"
  },
  "bodyCharacters": 10021,
  "bodyBytes": 10027,
  "revisions": 4,
  "newestEqualsBody": true,
  "oldestEqualsOpening": true,
  "each": [
    {
      "editedAt": "2026-11-09T03:32:20Z",
      "editor": {
        "login": "williacj"
      },
      "deletedAt": null,
      "characters": 10021,
      "acceptanceHeading": true,
      "items": 19,
      "sha256": "8c45e3b5dc76cf10ad2431c18642345173a09b01f4789d1b8de64cd27248d4cc"
    },
    {
      "editedAt": "2026-11-09T03:26:16Z",
      "editor": {
        "login": "williacj"
      },
      "deletedAt": null,
      "characters": 9926,
      "acceptanceHeading": true,
      "items": 19,
      "sha256": "bcba290481c20d35012da285698488b16b4b2ce589ebfe85dee5dab7fc4cf701"
    },
    {
      "editedAt": "2026-11-09T03:06:19Z",
      "editor": {
        "login": "williacj"
      },
      "deletedAt": null,
      "characters": 8192,
      "acceptanceHeading": true,
      "items": 20,
      "sha256": "1599c873c339f273c73f6389ecad1cade1515b37be2e33395404e7b99ecd30fd"
    },
    {
      "editedAt": "2026-11-09T03:05:58Z",
      "editor": {
        "login": "williacj"
      },
      "deletedAt": null,
      "characters": 8209,
      "acceptanceHeading": true,
      "items": 20,
      "sha256": "8907ab7656427ebbee2a05294f57543965a40b8457a192ac8b15e8992c2da3d9"
    }
  ]
}
```

The full unedited response is retained outside the checkout as
`1337-live-history.json` in the dispatched scratch directory. The PR will carry
that response with its command and the controlled verification receipts.

The deterministic baseline ran on `CJs-Mac-mini.local` at the base above on
2026-11-11 UTC. The command was `npm test`, under the shared slot and with
`TMPDIR=/Users/cjwilliams/Github/rigger-worktrees/codex-1337-tmp`.
Its start/end one-minute loads were 3.94 and 7.87. The saved output was:

```text
ℹ tests 5743
ℹ pass 5743
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
CHILD_EXIT=0
```

The affected host baseline used the same base and host, beginning at
2026-11-11 00:46:45 UTC. Its command was `npm run test:host --
test/forge-runners.test.mjs test/forge-spawn.test.mjs test/read-deadline.test.mjs`,
under the shared slot and the same TMPDIR. Start/end loads were 7.66 and 11.21;
656 user processes were measured at start with `ps -U uid -o pid= | wc -l`.
The saved output was:

```text
ℹ tests 95
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
CHILD_EXIT=0
```

The implementation puts the read in repositoryReads and uses the existing paged read
runner. It reverses the whole connection, retaining identical rewrites and the order
of edits sharing one-second timestamps. Unavailable logins and unavailable undeleted
bodies refuse the whole read before L2 uses them.

L2 reads through cardReads after the item write and transition both recorded
successfully. A failed read leaves the accepted transition standing; an L0 recording
refusal still reaches the caller. The history event uses the existing digest and
form reader, omits metrics for deleted revisions, and reads a clock author's exact
text from the opening body. The marker and form modules are unchanged.

The controlled target ran on 2026-11-11 at 06:54:58 UTC on the host above:
`npm test -- --test-timeout=120000 test/acceptance-history.test.mjs`.
Its start/end loads were 1.78/1.78 and it measured 607 user processes at start.
The retained output, 1337-history-refactor-01.log, reported:

```text
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
CHILD_EXIT=0
```

Those cases cover every Table M row, with fifteen accepted moves across the thirteen
declared causes. They include both opening and recovering a clock card, and both
maker and role returns. The default reader records its call under each moved card
and dispatch. An edit after the last move produced no new read or snapshot, the
accepted W2 residual.

The test-first run receipts retain the base head and candidate patch hashes. Head
verification, fresh-clone figures and guarded mutation receipts belong to the PR.


The late binding-search discovery was disclosed in
[the combined request](https://github.com/williacj/rigger/issues/1337#issuecomment-6791244920).
[M8-K20](https://github.com/williacj/rigger/issues/1293#issuecomment-6791276254)
records it as a disclosed dispatch-process miss needing no owner exception. The
card author admitted the five areas under G4–G7; its current acceptance admits
G1–G7. The PR's attempts ledger retains the original miss and failed runs.

The additional local changes retain the repository-read inventory, inject the
existing repository into the escalation fixture, account for the history method
in normalized read lists, and consume the failed-maker fixture's one-shot fault
only when its selected failing method executes. The judge-dispatch ordering
assertions are unchanged.

The complete local candidate ran on 2026-11-11 at 08:30:27 UTC, before this
journal update and before commit. `npm test` under the shared slot, with the same
TMPDIR and host above, reported 5757 tests, 5757 pass, 0 fail, 0 cancelled and
0 skipped, exit 0. Start/end one-minute loads were 3.46/5.40; 603 user processes
were measured at start. The full output is 1337-candidate-full-02.log. Earlier
candidate failures remain in their original logs and are reported with their
corrections in the PR's attempts ledger.
