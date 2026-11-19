ABOUTME: The dispatch-root path-rule fix, controlled red and green evidence, and owner live-proof handoff for card #1425.

# Dispatch-root path rules

Card #1425, acceptance revision `0d91850d15a3`, places the path-rule change in the Claude provider
adapter and the escalation wording in workflow. M8-U63 on #1293 approved R-SAFE-10 through spec
PR #1427, merged at `6be13718`. The coordinator resumed this maker after that merge and the PM
updated the claim item. This branch claims the registered requirement; it does not author it.

The coordinator's transcript investigation on 2026-11-18, quoted in #1425's Evidence section,
measured Emend #1417's dispatch `d-02d18ec4` for #105 moving its shell into `src-tauri`. Root Edit
and Write calls, including `.rigger-escalation.md`, then received "you haven't granted it yet";
files under `src-tauri` remained writable. Emend #79's session, whose shell stayed at the root,
could edit the root. These are the coordinator's historical measurements, not new live runs by
this maker.

The adapter anchors declared relative Read and Edit allows and denies at the dispatch directory's
real path, using its existing per-rule path mapping. Reached-directory grants and deny copies
remain. A generated rule needs a path inside the existing PLAIN character set. The escalation
instruction names the directory the session started in for both the note and the unchanged
posting command. It names no provider tool.

Before code, the Lands in search covered every listed path. The source-text binding in
`test/network-boundary.test.mjs` admits line shifts and its protected lines stay byte-identical.
The affected prompt comparisons are already in scope under G2. The relative-deny expectation
changes under G1. No additional existing test line needs a grant.

On the branch's base, `npm ci` succeeded and the deterministic baseline reported tests=5958,
pass=5958, fail=0. The suite-slot log recorded load 2.70 at start and 5.91 at end, status 0,
duration 498 seconds. The base was `18e4f016a31c2f2b0bad01914b525afda9e3fcf0`; TMPDIR was the
external `codex-1425-tmp` directory. The affected host baseline reported tests=17, pass=1,
fail=0, skipped=16 with live sessions gated off.

The first root-allow test failed on its missing absolute Edit grant. The next root-deny test
failed on its missing anchored .env and secrets rules. Both passed after their implementation.
The unsafe-path test failed with "Missing expected rejection" before the refusal was added.
Its first subsequent run exposed an incorrect test assumption: the provider's startFailure
adds startCause, while NOT_STARTED belongs to the execution layer. Checking the documented
provider startCause contract then passed. The instruction test failed because the note location
still named the current working directory, and passed after the wording changed.

The affected controlled run reported tests=150, pass=150, fail=0, including the existing
network-boundary source bindings. Complete logs are retained in `codex-1425-tmp` with the
`1425-` prefix. The head's gated host run reported tests=23, pass=1, fail=0, skipped=22; that
is harness evidence only. It supplies no live CLI result.

Six gated live cells in the existing Claude live file cover root Edit, root Write, subdirectory
Edit, outside Write refusal, root .env deny, and the instructed escalation after `cd sub`.
Each records the tool calls and results before target assertions, checks the same session's
`pwd`, and retains raw streams and stand-in forge state outside suite teardown. Each session
uses invocation's environment plus test-made Claude and gh configuration directories and a PATH
beginning with the stand-in gh.

The owner must run the head and merge-base live commands supplied in the PR, with the head's
live file against the base's source for the latter. The maker has not run those sessions: #1385
reserves this authentication boundary for the owner's Terminal. Their dates, Claude Code version,
measured root denial at base and allowed behavior at head remain pending. This card is not
finished until those results are supplied and recorded, the matrix is regenerated against the
merged requirement, and the independent judges rule on the resulting head.

The subsequent full deterministic run, saved as `1425-full-head.log`, reported tests=5964,
pass=5962, fail=2, status 1. The suite-slot log recorded start load 3.05 and end load 3.44,
duration 545 seconds. One failure was the committed-matrix test calling the checker and refusing
the pending R-SAFE-10 declaration. The other was the existing R33 malformed-permission fixture: copying
a rule now happened before the guarded compound-rule read, so its error lost startCause. Guarding
the copy with the same claude-rule-unreadable cause restored the existing boundary. Its focused
run (`1425-rule-cause-green.log`) then reported tests=1, pass=1, fail=0, and the affected controlled
run (`1425-controlled-final.log`) again reported tests=150, pass=150, fail=0. No existing line
in the environment-retry fixture was edited.

The matrix dependency also prevents a green npm test, not just matrix:check. AGENTS.md requires
green deterministic verification before committing, so the maker stopped as ambiguous at
that boundary, reporting the dependency on #1425. No commit or push bypassed the green-suite rule. The clone and scratch directory are retained under
the dispatch's cleanup override.

On resumption, `git fetch origin` resolved main to `6be13718` and `git merge --ff-only origin/main`
advanced the branch without a rebase, conflict, or loss of local changes. The source and tests
were unchanged by that dependency merge. `npm run matrix` regenerated the claims and
`npm run matrix:check` passed, reporting 7 of 255 requirements without a test. The live proof
remains reserved for the owner; the PR supplies exact commands for the committed head and for
that head's live file against merge-base source.

After the dependency merge and regeneration, `1425-full-registered.log` reported tests=5964,
pass=5964, fail=0, exit 0. The suite-slot log recorded start load 2.54, end load 4.91 and
duration 465 seconds. This resolves the registration blocker and includes the R33 restoration.
The owner live measurements are still pending and are not represented as passed by a gated run.

## Completed owner live proof

The owner ran both published scripts in their own Terminal on 2026-11-19, authenticated with the exported CLAUDE_CODE_OAUTH_TOKEN. The fixture forwarded only that credential in addition to its invocation/configuration paths, redacted echoes before retention/diagnostics, and omitted it from invocation.json. The maker did not run a live CLI. Measured code/test head: 93f3557825cb18ec2c4c7c341ca5c6a983064f7d; base source: 6be137182f73bb014cf9b5c036d040c8f16115de. The base run used that head's live file and helpers with only src restored from the merge base. The subsequent publication changes only the journal; source and test bytes are identical to this measured head.

Full unfiltered logs, invocation records and session artifacts were copied and reopened at `/Users/cjwilliams/GitHub/rigger-worktrees/1425-evidence/93f3557825cb18ec2c4c7c341ca5c6a983064f7d-owner-live-final`. Its summary.json records byte lengths/SHA256 and all calls/results. A byte scan of both logs and every retained artifact found zero `sk-ant-` markers. The earlier authenticated 989b59e9 attempt remains historical, including its regex-only failure; the owner also retained it at codex-1425-tmp/1425-evidence-989b59e9-kept. These successful head results supersede the earlier live-proof-pending handoff statements in this journal and the credential journal.

### Owner head run

Original output: 1425-owner-head.log in the archive. Measured totals: tests=6, pass=6, fail=0.

```text
 8:45  up 8 days, 51 mins, 2 users, load averages: 1.91 3.02 4.99
 8:46  up 8 days, 51 mins, 2 users, load averages: 2.00 3.02 4.98
Thu Nov 19 14:46:05 UTC 2026
2.1.328 (Claude Code)
 8:46  up 8 days, 52 mins, 2 users, load averages: 2.00 3.02 4.98
user_processes=592
owner_live_exit=0
 8:46  up 8 days, 52 mins, 2 users, load averages: 1.91 2.83 4.78
✔ M8-29 live: Edit changes an existing root file after cd sub (8437.545333ms)
✔ M8-29 live: Write creates a root file after cd sub (7407.334041ms)
✔ M8-29 live: Edit still changes a sub file after cd sub (8199.160625ms)
✔ M8-29 live: Write beside the workspace is denied after cd sub and leaves no file (7504.955542ms)
✔ M8-29 live: the declared root .env deny survives cd sub and leaves its bytes unchanged (10082.699625ms)
✔ M8-29 live: after cd sub the instructed root escalation note reaches only card 42 byte for byte (12007.245291ms)
```

The following are the recorded target calls/results, each same-session pwd result, and independently retained target bytes. Null targetBytes means the requested target was absent. Tool ids and path spellings are kept as observed.

```json
[
  {
    "cell": "root Edit",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-iG8daU/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-iG8daU/repository/root.txt",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "tool_use_id": "toolu_012VZyrxPjg4bMH6Y9Kjttcx",
        "type": "tool_result",
        "content": "The file /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-iG8daU/repository/root.txt has been updated successfully. (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": "after-1425\n"
  },
  {
    "cell": "root Write",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-ZB1xzh/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-ZB1xzh/repository/created.txt",
        "content": "after-1425\n"
      },
      "result": {
        "tool_use_id": "toolu_01JEwRKU3BW9ehcfCG2hGvmQ",
        "type": "tool_result",
        "content": "File created successfully at: /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-ZB1xzh/repository/created.txt (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": "after-1425\n"
  },
  {
    "cell": "sub Edit",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-sNUpFX/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-sNUpFX/repository/sub/existing.txt",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "tool_use_id": "toolu_01KbGT2k3ZFGybHTTFsCSj8J",
        "type": "tool_result",
        "content": "The file /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-sNUpFX/repository/sub/existing.txt has been updated successfully. (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": "after-1425\n"
  },
  {
    "cell": "beside Write",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-9NHt0l/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-9NHt0l/beside/outside.txt",
        "content": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "Claude requested permissions to write to /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-9NHt0l/beside/outside.txt, but you haven't granted it yet.",
        "is_error": true,
        "tool_use_id": "toolu_01NcG7m9n39FxubLHbg4aBgc"
      }
    },
    "targetBytes": null
  },
  {
    "cell": "root .env deny",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-lmmOHI/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-lmmOHI/repository/.env",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>",
        "is_error": true,
        "tool_use_id": "toolu_01H4ynmePnBBGoaaQRuoW7Ge"
      }
    },
    "targetBytes": "before-1425\n"
  },
  {
    "cell": "root escalation note",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-rDZOcc/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-rDZOcc/repository/.rigger-escalation.md",
        "content": "```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: The fixture needs its author to choose \"blue\" or 'green'; preserve $HOME and \\.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n"
      },
      "result": {
        "tool_use_id": "toolu_019YppkSTGrmhfWSPUhGTafz",
        "type": "tool_result",
        "content": "File created successfully at: /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-rDZOcc/repository/.rigger-escalation.md (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": "```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: The fixture needs its author to choose \"blue\" or 'green'; preserve $HOME and \\.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n",
    "postingCalls": [
      {
        "name": "Bash",
        "input": {
          "command": "cd /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-head-tmp/rigger-suite.cmOfEy/rigger-claude-live-rDZOcc/repository && gh issue comment 42 --body-file .rigger-escalation.md"
        },
        "result": {
          "tool_use_id": "toolu_01FdFzctgDSJrQpwp2F1MRm2",
          "type": "tool_result",
          "content": "https://github.com/acme/widgets/issues/42#issuecomment-1",
          "is_error": false
        }
      }
    ],
    "forge": {
      "sent": [
        [
          "issue",
          "comment",
          "42",
          "--body-file",
          ".rigger-escalation.md"
        ]
      ],
      "comments": [
        [
          42,
          [
            "```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: The fixture needs its author to choose \"blue\" or 'green'; preserve $HOME and \\.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n"
          ]
        ],
        [
          43,
          []
        ]
      ]
    }
  }
]
```

### Owner base run

Original output: 1425-owner-base.log in the archive. Measured totals: tests=6, pass=3, fail=3.

```text
 8:53  up 8 days, 59 mins, 2 users, load averages: 1.65 2.04 3.63
 8:53  up 8 days, 59 mins, 2 users, load averages: 1.60 2.03 3.62
Thu Nov 19 14:53:54 UTC 2026
2.1.328 (Claude Code)
 8:53  up 8 days, 59 mins, 2 users, load averages: 1.71 2.04 3.61
user_processes=590
owner_live_exit=1
 8:54  up 8 days, 1 hr, 2 users, load averages: 2.08 2.11 3.55
✖ M8-29 live: Edit changes an existing root file after cd sub (10101.44975ms)
✖ M8-29 live: Write creates a root file after cd sub (6789.690917ms)
✔ M8-29 live: Edit still changes a sub file after cd sub (8787.114833ms)
✔ M8-29 live: Write beside the workspace is denied after cd sub and leaves no file (6921.94425ms)
✔ M8-29 live: the declared root .env deny survives cd sub and leaves its bytes unchanged (9604.940375ms)
✖ M8-29 live: after cd sub the instructed root escalation note reaches only card 42 byte for byte (9807.363125ms)
```

The following are the recorded target calls/results, each same-session pwd result, and independently retained target bytes. Null targetBytes means the requested target was absent. Tool ids and path spellings are kept as observed.

```json
[
  {
    "cell": "root Edit",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-nXQsz8/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-nXQsz8/repository/root.txt",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "Claude requested permissions to write to /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-nXQsz8/repository/root.txt, but you haven't granted it yet.",
        "is_error": true,
        "tool_use_id": "toolu_01KKkrBQ8iLJXApK1Zuu1TJv"
      }
    },
    "targetBytes": "before-1425\n"
  },
  {
    "cell": "root Write",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2busje/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2busje/repository/created.txt",
        "content": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "Claude requested permissions to write to /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2busje/repository/created.txt, but you haven't granted it yet.",
        "is_error": true,
        "tool_use_id": "toolu_01JshUeX4DDVWc9mP9wWqns2"
      }
    },
    "targetBytes": null
  },
  {
    "cell": "sub Edit",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-PBesu1/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-PBesu1/repository/sub/existing.txt",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "tool_use_id": "toolu_011P7oPai4Pr9nDyJLTvosku",
        "type": "tool_result",
        "content": "The file /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-PBesu1/repository/sub/existing.txt has been updated successfully. (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": "after-1425\n"
  },
  {
    "cell": "beside Write",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-wezTzy/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-wezTzy/beside/outside.txt",
        "content": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "Claude requested permissions to write to /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-wezTzy/beside/outside.txt, but you haven't granted it yet.",
        "is_error": true,
        "tool_use_id": "toolu_015wh269Mwmj5Rf8o8EWYsqn"
      }
    },
    "targetBytes": null
  },
  {
    "cell": "root .env deny",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-m2JDYA/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Edit",
      "input": {
        "replace_all": false,
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-m2JDYA/repository/.env",
        "old_string": "before-1425\n",
        "new_string": "after-1425\n"
      },
      "result": {
        "type": "tool_result",
        "content": "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>",
        "is_error": true,
        "tool_use_id": "toolu_01JTmfzUUQMwQt6VfRWoBXsk"
      }
    },
    "targetBytes": "before-1425\n"
  },
  {
    "cell": "root escalation note",
    "cd": {
      "command": "cd sub",
      "result": "(Bash completed with no output)",
      "is_error": false
    },
    "pwd": {
      "command": "pwd",
      "result": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2H9P3y/repository/sub",
      "is_error": false
    },
    "targetCall": {
      "name": "Write",
      "input": {
        "file_path": "/Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2H9P3y/repository/sub/.rigger-escalation.md",
        "content": "```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: The fixture needs its author to choose \"blue\" or 'green'; preserve $HOME and \\.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n"
      },
      "result": {
        "tool_use_id": "toolu_01MYLuAoE9Df8DWcNn48GPVE",
        "type": "tool_result",
        "content": "File created successfully at: /Users/cjwilliams/GitHub/rigger-worktrees/codex-1425-tmp/1425-owner-base-tmp/rigger-suite.mAoW6A/rigger-claude-live-2H9P3y/repository/sub/.rigger-escalation.md (file state is current in your context — no need to Read it back)"
      }
    },
    "targetBytes": null,
    "postingCalls": [
      {
        "name": "Bash",
        "input": {
          "command": "gh issue comment 42 --body-file .rigger-escalation.md"
        },
        "result": {
          "tool_use_id": "toolu_0146H8hWgJaL5vsuHRDZxDMf",
          "type": "tool_result",
          "content": "https://github.com/acme/widgets/issues/42#issuecomment-1",
          "is_error": false
        }
      }
    ],
    "forge": {
      "sent": [
        [
          "issue",
          "comment",
          "42",
          "--body-file",
          ".rigger-escalation.md"
        ]
      ],
      "comments": [
        [
          42,
          [
            "```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: The fixture needs its author to choose \"blue\" or 'green'; preserve $HOME and \\.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n"
          ]
        ],
        [
          43,
          []
        ]
      ]
    }
  }
]
```

The head passed every live cell, including root note creation and a byte-identical comment on only issue 42. The base failed exactly the root Edit, root Write and root escalation cells; the first two returned “you haven't granted it yet”, while the escalation wrote under sub/ and left the requested root note absent. The base still passed sub Edit, outside refusal and .env deny. These three expected counterexamples are not flakes and do not earn a green base verdict. The head .env deny now matches its observed denied-by-permission-settings result and leaves before-1425 bytes unchanged.

All product live acceptance rows now have measured owner proof. Item 28 remains unmet as written: two owner-requested controlled credential/evidence harness diagnostics omit product proves declarations because they assert neither R-SAFE-10 nor R-ESCALATE-27. The existing ambiguous report on #1425 asks the author to reconcile that blanket wording; no source, test or acceptance was changed in this journal-only completion. Independent judges and coordinator ci:full remain separate review gates.
