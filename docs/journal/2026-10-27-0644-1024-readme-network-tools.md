ABOUTME: The evidence for naming git in README's network-tools sentence, for card #1024.

# README's network tools

[M7-U2 item 10](https://github.com/williacj/rigger/issues/1009#issuecomment-6434513387)
authorizes this sentence correction through a card the owner marks. The README now names `git`
beside `gh` and the agent CLI, retaining its prohibition on network calls through other tools.

Measured on 2026-10-27 in the proposed tree based on `66e5b7c941e2`, whose `src/` is unchanged:
`git grep -nE "['\"]git['\"]|git =|gitAnswer" -- src/` identifies the git command boundary and
its wrappers. Reading their arguments, checked with
`git grep -nE "['\"](fetch|ls-remote|push|clone|pull|remote)['\"]" -- src/`, finds these lines
passing git a subcommand that contacts a remote:

| File and line | Arguments |
|---|---|
| `src/substrate/worktrees.mjs:116` | `fetch --no-write-fetch-head origin refs/heads/${branch}` |
| `src/substrate/worktrees.mjs:168` | `ls-remote --symref origin HEAD` |
| `src/substrate/worktrees.mjs:180` | `ls-remote --exit-code origin refs/heads/${branch}` |
| `src/substrate/worktrees.mjs:289` | `fetch --no-write-fetch-head --end-of-options origin ${commit}` |

The `ORIGIN` constant at `src/substrate/worktrees.mjs:63` supplies `origin`. The `call` and
`answer` wrappers pass those arguments through `runCommand` at line 94. The CLI's other git
calls read repository state or configure local hooks. In particular,
`src/cli/init.mjs:120` reads `remote get-url origin`, which contacts no remote.

The scratch acceptance probe failed before the edit because the sentence omitted `git`.
Its expected sentence comes from the card's first three acceptance items. The probe is kept
outside the checkout so the committed paths remain the README and this journal entry.
