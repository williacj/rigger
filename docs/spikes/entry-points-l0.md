ABOUTME: Card #1150's measured inventory of L0 outside-value entry points against architecture boundary rule 4.

# L0 entry points for outside values

## Measurement and method

This audit measured commit `f94446e02ce8482b3cbd779db9198a7e9c2c6072` on main, PR #1148's merge for card #1146. It used macOS 27.2, Node 26.5.0, git 2.54.0 and gh 2.103.2. The probe ran against fixture files and injected process answers; it wrote no forge, board or launchd state and called no installed agent CLI. Its source remains in the ignored spike directory.

The [comprehensive search output](https://github.com/williacj/rigger/issues/1150#issuecomment-6513295672), [auxiliary search output](https://github.com/williacj/rigger/issues/1150#issuecomment-6513798475), [probe A](https://github.com/williacj/rigger/issues/1150#issuecomment-6513280298), [probe B](https://github.com/williacj/rigger/issues/1150#issuecomment-6513285649), [structural probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513665824), [forge runner read probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513858720), [board-ID probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513711139), [item extra-field probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513778411), [git push text probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513741135), [launchd byte probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513750924), [Codex config byte probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513761494), [process-table shape probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513679404), and [print probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513582389) are on the card. Probe B repeats A with explicit Buffer and number descriptions. They executed at the measured commit and exited 0. A began at one-minute load 22.42; B at 82.75; the structural probe at 23.43. Each linked comment quotes its exact command, full source and full unfiltered output. Probe identifiers below name its JSONL output records. An [earlier supplemental run](https://github.com/williacj/rigger/issues/1150#issuecomment-6514023016) stalled because its fixture clock did not advance; that comment preserves its exact source, command and all output produced. The bounded structural probe replaces it.

These are the searches over the card's scope. The first returned 143 hits, including imports, comments and forwarding code. The second includes the Linux process-table helper. The other searches returned no direct argument, standard-input or directory-enumeration entry point in L0. A directory path's filesystem metadata and a file's bytes are included below even though no directory is enumerated.

```sh
rg -n 'JSON\.parse|readFileSync|readdirSync|lstatSync|statSync|realpathSync\.native|process\.env|process\.argv|process\.stdin|spawnSync|execFile\(|spawn\(|\.stdout|\.stderr|\.status|\.exit|\.signal' src/substrate -g '*.mjs' -g '*.sh'
rg -n '(/proc/|/bin/ps|/usr/bin/awk|/bin/cat|\$#|\$@)' src/substrate/process-table.sh
rg -n 'process\.env|process\.argv|process\.stdin|readFile|readdir|lstat|stat\(|statSync|realpath|JSON\.parse|spawnSync|execFile|spawn\(' src/substrate -g '*.mjs' -g '*.sh'
rg -n 'JSON\.parse|readFile|readdir|lstat|statSync|realpath|process\.env|process\.argv|process\.stdin|stdin|\.code\b|\.stdout\b|\.stderr\b|execFile|spawn|execSync' src/substrate
rg -n '^export (async )?(function|const|class)' src/substrate
rg -n 'console\.|process\.stderr|process\.stdout|writeSync|\.write\(|log\(' src/substrate -g '*.mjs'
rg -n 'writeWhole\(' src/substrate
rg -n 'function (rowsOf|occupied|answers|live)' src/substrate/process.mjs
rg -n 'function (secondsOf|tipIn|printed)' src/substrate/process.mjs src/substrate/data-ref.mjs
rg -n 'writeWhole|survivor|console|stderr|\.write' src/substrate/process.mjs | tail -70
rg -n 'readdir|opendir|process\.argv|process\.stdin|JSON\.parse|readFile|lstat|statSync|realpath|process\.env' src/substrate -g '*.mjs' -g '*.sh' | wc -l
```

The grep hit ledger is complete as follows; numbers are measured source lines. An inventory identifier means the hit belongs to that row, including all its calls and helpers. An S identifier means it is set aside for the reason after the table. The linked full output permits every line to be checked individually.

| Path | Inventory hits | Set aside hits |
|---|---|---|
| `src/substrate/forge/read.mjs` | F-R: 31, 32, 307, 308, 314, 318, 352, 369, 398, 410, 413, 414, 450, 453, 478, 482, 557, 648 | none |
| `src/substrate/forge/runners.mjs` | F-R/F-S/F-I/F-W: 303, 306, 413, 414, 452, 455 | none |
| `src/substrate/forge/item-write.mjs` | F-I: 37, 38 | none |
| `src/substrate/forge/schema-write.mjs` | none in this command; F-S entry appears in the auxiliary ledger | none |
| `src/substrate/forge/repository-write.mjs` | F-W: 11, 12, 38, 39, 60, 61, 76, 77, 92, 93, 99, 100, 112, 114 | none |
| `src/substrate/process.mjs` | P-C: 1761, 1774, 1794, 1795, 1818, 1819; P-T: 867, 941, 946, 952, 953, 965, 978, 981, 1117, 1118, 1622, 1627, 1927, 1929, 1931, 2001, 2002 | S1: 120, 234, 283, 284, 297, 348 |
| `src/substrate/worktrees.mjs` | W: 125, 126, 143, 144, 147, 205, 206, 207, 208, 312, 317, 318, 319, 356, 361, 370, 372, 375, 385, 437, 458, 459, 474 | S2: 5 |
| `src/substrate/data-ref.mjs` | D: 55, 60, 61, 75, 83, 89, 93, 94, 99 | E-D: 37 |
| `src/substrate/launchd.mjs` | L: 14, 15, 16 | none |
| `src/substrate/providers/claude.mjs` | C-A: 73; C-F: 195, 200, 219, 291, 374, 383; E-C: 370 | S2: 4 |
| `src/substrate/providers/codex.mjs` | X-A: 103; X-P: 198, 252; X-F: 150, 155, 271, 274, 299, 305, 307; E-X: 260 | S2: 5 |
| `src/substrate/git-environment.mjs` | E-G: 48 | S4: 44 |
| `src/substrate/host.mjs` | none | S5: 11, 12, 13, 15, 16 |
| `src/substrate/standard-error.mjs` | T1/T2: 111 | S6: 13, 23, 66, 68, 75, 82, 83, 93 |
| `src/substrate/process-table.sh` | P-T: 5, 6, 7, 10, 12, 19, 20, 26, 48 | none |

S1 is Node's signal and child-state plumbing, not an outside-value admission beyond P-C or P-T. S2 is an import declaration; its actual reads appear in the inventory. S4 is a comment about environment keys, assigned E-G. S5 is the host dependency injection wrapper; the consumer P-C, P-T or W is the admission point. S6 consists of measurements and comments about writing; the actual print sites are T1 and T2. No file under the scope reads process arguments or standard input directly. No L0 source enumerates a directory, so the directory source class's **entry** cases are excluded; filesystem path probes are covered under W, C-F and X-F. The nonnumeric environment kind is inapplicable to every E row: none parses a variable as a number (E-G at line 48, E-D at line 37, E-C at line 119, E-X at line 260).

The [auxiliary search transcript](https://github.com/williacj/rigger/issues/1150#issuecomment-6513798475) adds the following measured line hits beyond the 143 above. Every listed declaration, comment, constant or helper is assigned to an entry row when it participates in admitting an outside answer. The remaining ones are set aside as S7: they define internal arguments, exports, timers or wrappers and read no new outside value. This keeps the search for every code path distinct from claiming every exported function is a separate entry point.

| Path | Extra hits assigned to inventory | Extra hits set aside as S7 |
|---|---|---|
| `src/substrate/data-ref.mjs` | D: 31, 79, 108, 138 | 8, 11 |
| `src/substrate/forge/assets.mjs` | none | 5 |
| `src/substrate/forge/graphql.mjs` | none | 101, 258 |
| `src/substrate/forge/item-write.mjs` | F-I: 27, 29 | none |
| `src/substrate/forge/read.mjs` | F-R: 30, 87, 96, 218, 221, 437, 699, 704, 727, 768, 770 | none |
| `src/substrate/forge/repository-write.mjs` | F-W: 56 | none |
| `src/substrate/forge/runners.mjs` | F-R/F-S/F-I/F-W: 108, 155, 390, 411, 463, 479 | 17, 20, 38, 47, 85, 151, 404 |
| `src/substrate/forge/schema-write.mjs` | F-S: 22, 26 | none |
| `src/substrate/forge/write-made.mjs` | none | 14, 18, 31 |
| `src/substrate/git-environment.mjs` | none | 1, 14, 30 |
| `src/substrate/host.mjs` | none | 8 |
| `src/substrate/launchd.mjs` | L: 10 | none |
| `src/substrate/process-table.sh` | P-T: 29 | none |
| `src/substrate/process.mjs` | P-C/P-T: 27, 42, 61, 74, 103, 112, 319, 325, 356, 357, 487, 488, 607, 713, 724, 761, 763, 852, 877, 926, 968, 982, 1113, 1123, 1141, 1220, 1221, 1280, 1281, 1306, 1316, 1385, 1386, 1396, 1468, 1739, 1760, 1762, 1765, 1771, 1772, 1849, 1891, 1895, 1909, 1912, 1922, 1998, 2027, 2044, 2047, 2049, 2051, 2055, 2067, 2068, 2070, 2079, 2080, 2082, 2083, 2085, 2086, 2087, 2089, 2090, 2093, 2097, 2102, 2135, 2138, 2154; T1/T2: 185, 265, 305 | 123, 129, 192 |
| `src/substrate/providers/adapters.mjs` | none | 8 |
| `src/substrate/providers/claude.mjs` | C-A: 71; E-C: 119 | 50, 56, 81, 87 |
| `src/substrate/providers/codex.mjs` | X-A: 102; X-F: 295 | 66, 72, 75, 81, 141 |
| `src/substrate/standard-error.mjs` | T1/T2: 103, 115, 121 | 5, 18 |
| `src/substrate/worktrees.mjs` | W: 91, 99, 109, 250, 258, 348, 363, 377, 432, 468, 469, 476 | 19, 28, 31, 32, 33, 60 |

## Inventory

The quoted phrases are from `ARCHITECTURE.md`, boundary rule 4, lines 97–131. Layer names are the consumers of the admitted answer. A source named twice in a row has separate cells where its behavior differs.

| ID | Rule 4 phrase | Module and entry function at measured line | Outside source and consumer |
|---|---|---|---|
| F-R | “The forge adapter, for every answer gh gives on any of its sides” | `src/substrate/forge/read.mjs`, readSide 221 and repositoryReads 727; `src/substrate/forge/runners.mjs`, readRunner 155 | gh JSON, diff text, stderr and exit; L2, L3, CLI and L0 write helpers |
| F-S | “The forge adapter, for every answer gh gives on any of its sides” | `src/substrate/forge/schema-write.mjs`, schemaWriteSide 26; `src/substrate/forge/runners.mjs`, schemaWriteRunner 390 | gh read and mutation JSON, stderr and exit; CLI |
| F-I | “The forge adapter, for every answer gh gives on any of its sides” | `src/substrate/forge/item-write.mjs`, itemWriteSide 29; `src/substrate/forge/runners.mjs`, itemWriteRunner 463 | gh issue, board and mutation JSON, stderr and exit; L2 |
| F-W | “The forge adapter, for every answer gh gives on any of its sides” | `src/substrate/forge/repository-write.mjs`, repositoryWriteSide 56; `src/substrate/forge/runners.mjs`, repositoryWriteRunner 479 | gh REST JSON, diff text, stderr and exit; L2 |
| P-C | “The process adapter, for each command's exit code and output, and for its reads of the process table” | `src/substrate/process.mjs`, runCommand 1739 | child exit, stdout and stderr; all L0 adapters and L1 |
| P-T | “The process adapter, for each command's exit code and output, and for its reads of the process table” | `src/substrate/process.mjs`, census 713, run 937, runOnce 978, startOf 1926; `src/substrate/process-table.sh`, line 5 | ps and lsof output, exit and filesystem process rows; L0 cleanup and L1 |
| W | “The workspace adapter and the push side, for what git answers” | `src/substrate/worktrees.mjs`, workspaces 91 | git text and exit, `.git` file and path metadata; L1 |
| D | “The workspace adapter and the push side, for what git answers” | `src/substrate/data-ref.mjs`, pushStream 37 | git text and exit; L5 |
| L | “src/substrate/launchd.mjs, for the loaded job” | `src/substrate/launchd.mjs`, loadedJob 10 | launchctl text and exit; CLI doctor |
| C-A | “Each provider adapter, for the agent file it reads and what its CLI answers” | `src/substrate/providers/claude.mjs`, signedIn 71 | Claude auth JSON and exit supplied by caller; CLI doctor |
| C-F | “Each provider adapter, for the agent file it reads and what its CLI answers” | `src/substrate/providers/claude.mjs`, declaredIn 214 and invocation 370 | settings JSON file and filesystem path of agent; L1 |
| X-A | “Each provider adapter, for the agent file it reads and what its CLI answers” | `src/substrate/providers/codex.mjs`, signedIn 102 | Codex auth status text and exit supplied by caller; CLI doctor |
| X-P | “Each provider adapter, for the agent file it reads and what its CLI answers” | `src/substrate/providers/codex.mjs`, skillsIn 195 and probed 240 | Codex debug JSON, stdout/stderr and exit; L1 |
| X-F | “Each provider adapter, for the agent file it reads and what its CLI answers” | `src/substrate/providers/codex.mjs`, homeFor 270 and invocation 295 | agent file text, TOML config bytes and path metadata; L1 |
| E-C | “Each module that reads the environment, for the variables it reads” | `src/substrate/providers/claude.mjs`, cliFolder 119, invocation 370 | HOME, CLAUDE_CONFIG_DIR and forwarded environment; L1 and Claude CLI |
| E-X | “Each module that reads the environment, for the variables it reads” | `src/substrate/providers/codex.mjs`, ownerHome 260 | CODEX_HOME; L1 |
| E-G | “Each module that reads the environment, for the variables it reads” | `src/substrate/git-environment.mjs`, gitEnvironment 48 | all process environment keys and values, removing redirecting git keys; L0 child calls |
| E-D | “Each module that reads the environment, for the variables it reads” | `src/substrate/data-ref.mjs`, pushStream 37 | process environment forwarded through E-G; git child |

Claude's adapter passes the agent **path** to the CLI at `src/substrate/providers/claude.mjs` line 401; it does not read the agent file's contents. Probe C-claude.agent-missing handed the nonexistent path through. Thus C-F's agent-file bytes have no map; the path and settings file do. The Codex adapter does read its agent file at line 305.

## Value maps and rulings

Each cell uses **B** for a breach and **C** for conformance. Behaviors are **U** handed on unchecked, **R** refused with a Rigger-built failure, **H** checked and handed on as plain data, **T** thrown on with a failure Rigger did not build, and **O** other. A bracketed probe ID refers to the full output linked above; a line number refers to the inventory row's source path unless another path is written. Where U/C appears, rule 4's clause “A contract allows any string where it names text” is the basis. A semicolon separates distinct field or position behaviors for the same kind. “Found” marks a kind beyond the card's source-class table.

### JSON maps

Columns are the JSON class's required missing field, wrong type, null, extra field, oversized value, deep nesting and non-JSON text. The found non-finite number is JSON text such as `1e999`, parsed by Node as Infinity and thus not plain data. F-R's readFields and readDefaultBranch refuse some missing shapes, while the shared answerOf still hands the parsed root on; these are distinct positions, not a single averaged verdict.

| Entry point and field | Missing | Wrong type | Null | Extra | Oversized | Deep | Not JSON | Non-finite (found) |
|---|---|---|---|---|---|---|---|---|
| F-R, answerOf root | U/B [F-read.answerOf.missing] | U/B [F-read.answerOf.wrong-type] | U/B [F-read.answerOf.null] | U/B [F-read.answerOf.extra] | U/B [F-read.answerOf.oversized] | U/B [F-read.answerOf.deep] | T/B [F-read.answerOf.not-json] | U/B [F-read.answerOf.non-finite] |
| F-R, board ID also used by F-S/F-I | U/B [B-board.missing] | U/B [B-board.wrong-type] | U/B [B-board.null] | U/C [B-board.extra] | U/B [B-board.oversized] | U/B [B-board.deep] | T/B [B-board.not-json] | U/B [B-board.non-finite] |
| F-R, repository ID also used by F-S | U/B [B-repository.missing] | U/B [B-repository.wrong-type] | U/B [B-repository.null] | U/C [B-repository.extra] | U/B [B-repository.oversized] | U/B [B-repository.deep] | T/B [B-repository.not-json] | U/B [B-repository.non-finite] |
| F-R, default branch name/head | R/C [R-default.missing] | R/C [R-default.wrong-type] | R/C [R-default.null] | H/C [R-default.extra] | H/C [R-default.oversized] | R/C [R-default.deep] | R/C [R-default.not-json] | R/C [R-default.non-finite] |
| F-R, board field option name | U/B [R-fields.missing] | U/B [R-fields.wrong-type] | U/B [R-fields.null] | U/C [R-fields.extra] | U/C [R-fields.oversized] | U/B [R-fields.deep] | T/B [R-fields.not-json] | U/B [R-fields.non-finite] |
| F-R, missing board/repository root | R/C [F-read.readFields.missing; F-read.readDefaultBranch.missing] | R/C [F-read.readFields.wrong-type] | T/B [second R-fields.null record] | R/C [F-read.readFields.extra] | R/C [F-read.readFields.oversized] | R/C [F-read.readFields.deep] | T/B [F-read.readFields.not-json]; R/C [F-read.readDefaultBranch.not-json] | R/C [F-read.readFields.non-finite] |
| F-S, mutation root | U/B [F-schema.createLabel.missing] | U/B [F-schema.createLabel.wrong-type] | U/B [F-schema.createLabel.null] | U/B [F-schema.createLabel.extra] | U/B [F-schema.createLabel.oversized] | U/B [F-schema.createLabel.deep] | T/B [F-schema.createLabel.not-json] | U/B [F-schema.createLabel.non-finite] |
| F-S, runner's held-options read | R/C [schema.missing] | R/C [schema.wrong-type] | T/B [schema.null] | H/C [schema.extra] | R/C [schema.oversized] | R/C [schema.deep] | T/B [schema.not-json] | R/C [schema.non-finite] |
| F-I, issue node ID | R/C [F-item.addIssue.missing] | R/C [F-item.addIssue.wrong-type] | R/C [F-item.addIssue.null] | H/C [F-I, lines 38–39] | H/C [F-I, lines 38–39] | R/C [F-I, lines 38–39] | R/C [F-item.addIssue.not-json] | R/C [F-item.addIssue.non-finite] |
| F-I, mutation item ID | U/B [I-mutation.missing] | U/B [I-mutation.wrong-type; I-mutation.extra] | U/B [I-mutation.null] | U/C [item extra-field probe] | U/B [I-mutation.oversized] | U/B [I-mutation.deep] | R/C [I-mutation.not-json] | U/B [I-mutation.non-finite] |
| F-I, runner's columns-field read | R/C [item.missing] | R/C [item.wrong-type] | T/B [item.null] | H/C [item.extra] | H/C [item.oversized] | R/C [item.deep] | T/B [item.not-json] | R/C [item.non-finite] |
| F-W, issue comment body | U/B [F-repository.postIssueComment.missing] | U/B [F-repository.postIssueComment.wrong-type] | U/B [F-repository.postIssueComment.null] | U/B [F-repository.postIssueComment.extra] | U/B [F-repository.postIssueComment.oversized] | U/B [F-repository.postIssueComment.deep] | R/C [F-repository.postIssueComment.not-json] | U/B [F-repository.postIssueComment.non-finite] |
| F-W, PR confirmation | R/C [F-W, lines 112–116] | R/C [F-W, line 115] | R/C [F-W, line 115] | H/C [F-W, lines 112–116] | H/C [F-W, lines 112–116] | R/C [F-W, line 115] | R/C [F-W, line 114] | R/C [F-W, line 115] |
| F-W, merge reply SHA | U/B [W-merge.missing] | U/B [W-merge.wrong-type] | U/B [W-merge.null] | U/C [W-merge.extra] | U/C [W-merge.oversized] | U/B [W-merge.deep] | T/B [W-merge.not-json] | U/B [W-merge.non-finite] |
| C-A, loggedIn | U/B [C-claude.auth.missing] | U/B [C-claude.auth.wrong-type] | U/B [C-claude.auth.null] | U/B [C-claude.auth.extra, missing loggedIn]; H/C [C-A, lines 71–78, valid loggedIn] | U/B [C-claude.auth.oversized, missing loggedIn]; H/C [C-A, lines 71–78, ignored extra] | U/B [C-claude.auth.deep, missing loggedIn]; H/C [C-A, lines 71–78, ignored extra] | U/B [C-claude.auth.not-json] | U/B [C-claude.auth.non-finite, missing loggedIn]; H/C [C-A, lines 71–78, ignored extra] |
| C-F, settings root | H/C [C-claude.settings.missing] | R/C [C-claude.settings.wrong-type] | R/C [C-F, line 223] | H/C [C-claude.settings.extra] | H/C [C-F, lines 239–243] | H/C [C-F, lines 239–243] | R/C [C-claude.settings.not-json] | H/C [C-claude.settings.non-finite] |
| C-F, settings nested fields | H/C [C-F, lines 239–243] | H/C [C-claude.settings.nested-wrong-type] | H/C [C-F, lines 239–243] | H/C [C-claude.settings.extra] | H/C [C-F, lines 239–243] | H/C [C-F, lines 239–243] | R/C [C-F, line 219] | H/C [C-F, lines 239–243] |
| X-P, skill probe JSON | R/C [X-skills.missing] | R/C [X-skills.wrong-type] | R/C [X-skills.null] | H/C [X-skills.extra] | H/C [X-skills.oversized] | R/C [X-skills.deep] | R/C [X-skills.not-json] | R/C [X-skills.non-finite] |

For a JSON cell marked H/C, the entry point does not pass the original object; it builds a selected plain result. A missing optional field is distinct from a required field. C-F's missing file becomes an empty settings object at line 216; a missing **field** in a present object is treated by lines 239–243. C-F's nested wrong type is ignored and the adapter constructs its own settings object. F-R's missing board and repository refusals are at lines 89–104 and 295–321. JSON extra data handed through F-W is a breach where it returns the unchecked parsed object, although extra fields by themselves are plain.

### Text maps

The four columns are control characters, terminal escapes, invalid UTF-8 bytes and empty text. Text from a tool is decoded with replacement where a Buffer is converted to UTF-8. It stays a string in memory; U/C relies on rule 4's any-string clause. Paths and identifiers are structural fields, so they use checks or breach markings instead. A printable-output ruling appears separately below.

| Entry point and text field | Control | Escape | Invalid UTF-8 | Empty |
|---|---|---|---|---|
| F-R/F-S/F-I/F-W, runner stdout and stderr | U/C [F-runner.stdout.control; F-runner.stderr.control] | U/C [F-runner.stdout.escape; F-runner.stderr.escape] | U/C [F-runner.stdout.not-utf8; F-runner.stderr.not-utf8] | U/C [F-runner.stdout.empty; F-runner.stderr.empty] |
| P-C, command output | U/B [P-command.bytes] | U/B [P-command.bytes] | U/B [P-command.bytes] | U/B [P-command.bytes] |
| P-T, process names and command lines | U/B [P-table-name.control] | U/B [P-table-name.escape] | U/B [P-table-name.not-utf8] | U/B [P-table-name.empty] |
| W, git free text; structural worktree path | U/C [W-listing.control]; U/B [W-listing.control] | U/C [W-listing.control]; U/B [W-listing.control] | U/C [W-listing.not-utf8]; U/B [W-listing.not-utf8] | H/C [W-listing.empty]; U/B [W-listing.missing-field] |
| D, git diagnostic text; structural SHA | H/C [D, lines 60–61]; U/B [control-parent; control-commit] | H/C [control-stderr]; U/B [escape-parent; escape-commit] | H/C [D, line 55]; U/B [invalid-utf8-parent; invalid-utf8-commit] | H/C [empty-parent]; R/C [D, lines 66–69]; U/B [empty-commit] |
| L, loaded program path | U/B [L-loaded.escape] | U/B [L-loaded.escape] | U/B [launchd byte probe] | R/C [L-loaded.empty] |
| X-A, auth message | U/B [X-codex.auth.control, unmatched]; H/C [X-A, lines 102–108, valid login line] | U/B [X-codex.auth.escape, unmatched]; H/C [X-A, lines 102–108, valid login line] | U/B [X-codex.auth.not-utf8, unmatched]; H/C [X-A, lines 102–108, valid login line] | U/B [X-codex.auth.empty] |
| X-P, skill-probe diagnostic text | R/C [X-P, lines 245–251] | R/C [X-P, lines 245–251] | R/C [X-P, lines 245–251] | R/C [X-P, lines 246–251] |

P-C's output remains Buffer, which is not plain data even when it contains text. P-T's names are strings, but census returns a Map in its sightings field even for an empty table, as the [shape probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513679404) shows. That makes every P-T text cell a breach independent of the name. W has an additional **found** kind: an ordinary valid worktree record with no lock carries an own `locked` property whose value is undefined; [W-listing-detail.valid](https://github.com/williacj/rigger/issues/1150#issuecomment-6513665824) shows it. That is U/B and belongs to FC3. For the F runner, the adapter hands strings to its side and the side's JSON parser may then reject them; the text map is about the runner's admission. The `firstLine` formatter at `src/substrate/forge/runners.mjs` lines 411–416 trims and selects a line, but it does not remove control or escape bytes before a later print.

### Exit maps

Columns are nonzero exit, signal with no code, never started, and no response within the caller's bound. The command-adapter's synthetic signal exit is shown separately from Node's native signal value. An `EVENT_REFUSED` failure is a separate failure-model case, not an outside exit kind.

| Entry point | Nonzero | Signal | Never started | Timeout |
|---|---|---|---|---|
| F-R/F-S/F-I/F-W runner | H/C [F-runner.exit.nonzero] | H/C [F-runner.exit.signal] | R/C [P-command.never-started] | H/C [F-runner.exit.timeout] |
| P-C | U/B [P-command.nonzero] | U/B [P-command.signal] | R/C [P-command.never-started] | U/B [P-command.timeout] |
| P-T | R/C [P-T, lines 941–947] | R/C [P-T, lines 945–947] | R/C [P-T, lines 1113–1148 and 1929–1931] | R/C [P-T, lines 949–956] |
| W | R/C [W-listing.nonzero] | R/C [W, line 491] | R/C [W, lines 97–110] | R/C [W, line 491] |
| D | H/C [D-push.nonzero] | H/C [D, lines 54–61] | R/C [P-command.never-started] | H/C [D-push.timeout] |
| L | R/C [L-exit.nonzero]; H/C [L-exit.absent] | R/C [L, line 15] | R/C [P-command.never-started] | R/C [L-exit.timeout] |
| C-A | H/C [C-A, lines 71–78] | H/C [C-A, lines 71–78] | R/C [P-command.never-started] | R/C [P-C, line 1739] |
| X-A | H/C [X-A, lines 102–108] | H/C [X-A, lines 102–108] | R/C [P-command.never-started] | R/C [P-C, line 1739] |
| X-P | R/C [X-P, lines 244–250] | R/C [X-P, lines 244–250] | R/C [X-P, lines 240–250] | R/C [X-P, line 244] |

The provider auth functions accept a caller-supplied process result and ignore its exit; their output-field cells above show the undefined value from unmatched text. Their real callers obtain the result through P-C, which builds NOT_STARTED on a child that never launches. F-runner.exit.not-started in probe A supplied an impossible result outside P-C's contract; it is excluded from the runner ruling under rule 4 lines 122–128. P-T's native spawn failures are caught and represented in containment's own unread result at lines 1113–1148, or wrapped by startOf at line 1929. D and L also inherit P-C's never-started refusal.

### File, TOML, directory and environment maps

The file class's four columns are missing, empty, truncated and invalid UTF-8. “Truncated” means bytes ending mid-codepoint or incomplete JSON/TOML, not a claim about the filesystem's atomicity. The TOML columns are invalid TOML, missing key and wrong type. Directory source cases are missing, empty, non-file entry, symbolic link and unreadable entry. There is no L0 directory enumeration; the directory cells below concern named paths and are marked inapplicable where an entry cannot occur.

| Entry point and file | Missing | Empty | Truncated | Invalid UTF-8 |
|---|---|---|---|---|
| C-F, settings JSON | H/C [C-claude.settings.missing] | R/C [C-claude.settings.empty] | R/C [C-F, line 219] | R/C [C-F, line 219] |
| X-F, agent file | R/C [X-F, line 305] | H/C [X-codex.files.empty-agent] | U/B [X-codex.files.not-utf8-agent] | U/B [X-codex.files.not-utf8-agent] |
| X-F, config file | H/C [X-F, line 274] | U/B [X-codex.files.empty-agent] | U/B [config truncated] | U/B [config invalid-utf8] |
| W, `.git` pointer file | R/C [W, lines 361–378] | R/C [W, line 372] | R/C [W, line 372] | H/C [W, lines 372–378] |

| TOML at X-F | Invalid TOML | Missing key | Wrong type |
|---|---|---|---|
| Config copied into child home | U/B [X-codex.files.not-toml] | U/B [X-codex.files.empty-agent] | U/B [config wrong-type] |

| Named directory path | Missing | Empty | Non-file entry | Symbolic link | Unreadable entry |
|---|---|---|---|---|---|
| W, repository/worktree path | R/C [W, lines 356–385] | H/C [W, line 356] | not enumerated [W, line 356] | H/C [W, lines 356–385] | R/C [W, lines 356–385] |
| C-F, agent/settings parent | R/C [C-F, lines 193–224] | H/C [C-claude.settings.missing] | not enumerated [C-F, line 214] | H/C [C-F, line 200] | R/C [C-F, lines 193–224] |
| X-F, agent/config parent | R/C [X-F, lines 148–155] | H/C [X-F, line 274] | not enumerated [X-F, line 270] | H/C [X-F, line 155] | R/C [X-F, lines 148–155] |

The environment's required unset and empty kinds apply to every E row. Non-numeric is excluded because the cited functions treat variables as strings and read no number. E-G can also receive keys and values supplied by a caller; those are already inside the boundary under the producing layer's contract, per rule 4 lines 122–128.

| Entry point and variable | Unset | Empty | Non-numeric |
|---|---|---|---|
| E-C, HOME/CLAUDE_CONFIG_DIR | U/B [E-claude.unset] | H/C [E-claude.empty] | inapplicable [C-F, line 119] |
| E-X, CODEX_HOME | H/C [E-X, line 260] | H/C [E-X, line 260] | inapplicable [E-X, line 260] |
| E-G, redirecting git keys/other keys | H/C [E-git.unset] | H/C [E-git.empty] | inapplicable [E-G, line 48] |
| E-D, all forwarded keys | H/C [E-D, lines 37–39] | H/C [E-D, lines 37–39] | inapplicable [E-D, line 37] |

For E-C the missing HOME yields an undefined `home` in probe E-claude.unset; the CLAUDE_CONFIG_DIR absence uses a default path at line 119. That is a breach only for the missing HOME field. No argument or standard-input map exists in this scope: the search found no process argv or stdin read in L0; the CLI maps are #1151's.

## Print sites

Only two calls under L0 write outside-derived text to a person. Both are in `src/substrate/process.mjs`: cleanup's unrecorded-kill message at line 265 (T1), and attempt's failure stack at line 305 (T2). The source can include a process-table name or command line (T1, census lines 795–815), an outside error's message (T1), or a failed cleanup step's error stack (T2). Both are **breaches**: `src/substrate/standard-error.mjs` lines 103–111 writes the supplied bytes without removing control characters or terminal escapes. The any-string clause permits that value inside; the print clause requires it to be made printable at these sites. The [print probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513582389) shows an injected ESC sequence in both full outputs. Its two commands exited 0; they recorded their process IDs before cleanup, and L0 ended the recorded child group. No printable-making line exists.

## Proposed fix cards

Each proposed card is a proposal, not an issue filed. Cell sets below are disjoint: every B cell above and T1/T2 belongs to exactly one set. Estimates are judgments about added production lines after reading the named implementation. The L0 row's 3,000-line limit is in `ARCHITECTURE.md`. At the measured commit, `npm run budget:package` counted 8,384 production lines; summing its `src/substrate/` rows with `awk` counted 2,873 L0 lines, leaving 127. The row's large discrepancy between desired fixes and headroom requires deletion or consolidation as part of the implementation; none of these estimates silently raises the budget. Dependencies are card numbers or “none.”

| Proposed card | Breaching cells owned | Files to change; Self-hosting? | Added-line estimate and dependencies |
|---|---|---|---|
| FC1, forge JSON boundary | All B cells in F-R, F-S, F-I and F-W JSON maps | `src/substrate/forge/read.mjs`, `src/substrate/forge/schema-write.mjs`, `src/substrate/forge/item-write.mjs`, `src/substrate/forge/repository-write.mjs`, `src/substrate/forge/runners.mjs`; read.mjs and runners.mjs are Self-hosting paths | Estimate +90 L0; depends on owner handling of Self-hosting review and FC2's plain process result |
| FC2, process answer and table failures | All B cells in P-C and P-T text and exit maps | `src/substrate/process.mjs`; Self-hosting | Estimate +25 L0; depends on none |
| FC3, git structural answers | All B cells in W and D text, exit and file maps | `src/substrate/worktrees.mjs`, `src/substrate/data-ref.mjs`; worktrees.mjs is Self-hosting | Estimate +35 L0; depends on FC2 |
| FC4, launchd loaded program | All B cells in L text and exit maps | `src/substrate/launchd.mjs`; Self-hosting | Estimate +12 L0; depends on FC2 |
| FC5, provider files and answers | All B cells in C-A, C-F, X-A, X-P and X-F JSON, text, exit, file, TOML and directory maps | `src/substrate/providers/claude.mjs`, `src/substrate/providers/codex.mjs`; both Self-hosting | Estimate +45 L0; depends on FC2 |
| FC6, environment values | E-C missing HOME B cell | `src/substrate/providers/claude.mjs`; Self-hosting | Estimate +3 L0; depends on FC5 |
| FC7, human output | T1 and T2 | `src/substrate/process.mjs`; Self-hosting | Estimate +12 L0; depends on FC2 |

The cell sets in that table expand as follows, using the map's column names. FC1 owns F-R answerOf: missing, wrong type, null, extra, oversized, deep, non-JSON, non-finite; F-R board ID and repository ID: missing, wrong type, null, oversized, deep, non-JSON, non-finite; F-R field option: missing, wrong type, null, deep, non-JSON, non-finite; F-R missing-root: null and non-JSON; F-S mutation: all eight JSON kinds; F-S held-options read: null and non-JSON; F-I mutation ID: missing, wrong type, null, oversized, deep, non-finite; F-I columns-field read: null and non-JSON; F-W issue comment: missing, wrong type, null, extra, oversized, deep, non-finite; and F-W merge SHA: missing, wrong type, null, deep, non-JSON, non-finite. FC2 owns P-C text: control, escape, invalid UTF-8, empty; P-C exit: nonzero, signal, timeout; P-T text: control, escape, invalid UTF-8, empty; and the found ordinary P-T Map shape. FC3 owns W structural worktree text: control, escape, invalid UTF-8, missing field; the found ordinary W undefined lock; D structural parent or commit: control, escape, invalid UTF-8, empty commit and malformed SHA. FC4 owns L loaded program: control, escape, invalid UTF-8. FC5 owns C-A all eight JSON kinds, X-A all four text kinds, X-F agent truncated and invalid UTF-8, X-F config empty, truncated, invalid UTF-8, and all three TOML kinds. FC6 owns E-C unset HOME. FC7 owns T1 and T2. No other row has a B cell.

The recommendation is to card the seven disjoint fixes, with FC2 first, then reconcile their combined estimated +222 lines against the 127-line headroom before implementation. The PM should not assume a parsed JSON value is plain data, a UTF-8 decoding validates bytes, a git commit string is a SHA, or a process adapter's Buffer is plain data. A new source path, an authoritative contract proving a field intentionally unrestricted, a change to boundary rule 4 by the owner, or a budget measurement after other work lands would change the affected recommendation. Nothing in this report changes the architecture or creates a fix card.
