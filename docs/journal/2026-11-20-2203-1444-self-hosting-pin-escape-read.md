ABOUTME: Why #1444 moves the self-hosting check's pin to 1e8bdd8e, and what of the move the check reaches.

# Move the self-hosting pin to the escape-reading diff read

[Card #1444](https://github.com/williacj/rigger/issues/1444) moves `SELF_HOSTING_COMMIT` in
`.github/workflows/self-hosting.yml` from `c1e4833f` to `1e8bdd8e`, the merge of #1441's fix
through PR #1443. At the old pin the check's diff read sends no `--allow-escape-sequences`, so
gh refuses a pull request diff holding an ESC byte and the check refuses that pull request. The
fix reaches the check only through this pin move (`D35` rule 6).

The move brings every change between the two commits into the enforcer, not only the fix. The
card's table "What the move brings" sorts them, and this entry keeps its verdict on each row:

- **B1**, `readDiff` sending `--allow-escape-sequences` after the diff header, is the reason
  for the move. The check reaches it on every pull request: a diff holding an ESC byte is read
  rather than refused, and a diff holding none is read as before.
- **B2**, the read runner admitting the flagged diff form and the versioned `-X GET` form, is
  reached through B1 for the first form; no read the check makes sends the second.
- **B3**, `repositoryReads` gaining `readIssueHistory`, `readVisibility` and
  `readEventPolicies`, is not reached: neither entry point calls them.
- **B4**, the L5 sink's append and envelope changes, is not reached: the check never names its
  sink, so it writes to standard error as at the old pin, and reads no record.
- **B5**, `doctor`'s Actions event-policy axis, is not reached: `scripts/gate-check.mjs`
  imports only the unchanged `consumerConfig` from it.
- **B6**, L2's escalate and merge answers and the maker's escalation note, is not reached:
  `scripts/gate-check.mjs` calls only the unchanged `kindOf` and `panelOf`.
- **B7**, the Claude Code and Codex adapters' permission copying, is not reached: the check
  dispatches no provider.
- **B8**, comment-only edits, changes no behaviour.

No pull request diff held an ESC byte when the card was filed, so B1 is shown on a scratch pull
request into this card's branch, closed unmerged, with its head branch kept for the owner to
rule on. The pull request for this card quotes the forge refusing that diff without the flag,
the check at the old pin refusing it, and the check at the new pin reading it.

Whether the deployed workflow gives such a pull request a verdict depends on this card's merge,
so the PM reports that after the merge on record #1293, from a fresh event rather than a re-run.
