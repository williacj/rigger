ABOUTME: Card #1150's measured inventory of L0 outside-value entry points against architecture boundary rule 4.

# L0 entry points for outside values

## Measurement and method

This audit measured commit `f94446e02ce8482b3cbd779db9198a7e9c2c6072` on main, PR #1148's merge for card #1146. It used macOS 27.2, Node 26.5.0, git 2.54.0 and gh 2.103.2. The probe ran against fixture files and injected process answers; it wrote no forge, board or launchd state and called no installed agent CLI. Its source remains in the ignored spike directory.

The [comprehensive search output](https://github.com/williacj/rigger/issues/1150#issuecomment-6513295672), [auxiliary search output](https://github.com/williacj/rigger/issues/1150#issuecomment-6513798475), [all-hit and REST-position probes](https://github.com/williacj/rigger/issues/1150#issuecomment-6515255546), [probe A](https://github.com/williacj/rigger/issues/1150#issuecomment-6513280298), [probe B](https://github.com/williacj/rigger/issues/1150#issuecomment-6513285649), [structural probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513665824), [forge runner read probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513858720), [board-ID probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513711139), [item extra-field probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513778411), [git push text probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513741135), [launchd byte probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513750924), [Codex config byte probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513761494), [process-table shape probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513679404), and [print probe](https://github.com/williacj/rigger/issues/1150#issuecomment-6513582389) are on the card. Probe B repeats A with explicit Buffer and number descriptions. They used source identical to the measured commit's `src/substrate/` tree and exited 0. A began at one-minute load 22.42; B at 82.75; the structural probe at 23.43. Each linked comment quotes its exact command, full source and full unfiltered output. Probe identifiers below name its JSONL output records. An [earlier supplemental run](https://github.com/williacj/rigger/issues/1150#issuecomment-6514023016) stalled because its fixture clock did not advance; that comment preserves its exact source, command and all output produced. The bounded structural probe replaces it.

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
| `src/substrate/process.mjs` | P-C/P-T: 27, 42, 61, 74, 103, 112, 319, 325, 351, 356, 357, 487, 488, 607, 713, 724, 761, 763, 817, 852, 877, 902, 903, 926, 945, 968, 982, 987, 1113, 1123, 1141, 1170, 1220, 1221, 1280, 1281, 1306, 1316, 1385, 1386, 1396, 1468, 1646, 1656, 1739, 1760, 1762, 1765, 1771, 1772, 1788, 1790, 1811, 1813, 1822, 1823, 1849, 1891, 1895, 1909, 1912, 1922, 1998, 2027, 2044, 2047, 2049, 2051, 2055, 2067, 2068, 2070, 2079, 2080, 2082, 2083, 2085, 2086, 2087, 2089, 2090, 2093, 2097, 2102, 2135, 2138, 2154; T1/T2: 13, 185, 265, 305 | S7: 123, 129, 192; S8: 51, 384, 641, 802, 1598, 1642, 1699, 1712 |
| `src/substrate/providers/adapters.mjs` | none | 8 |
| `src/substrate/providers/claude.mjs` | C-A: 71; E-C: 119 | 50, 56, 81, 87 |
| `src/substrate/providers/codex.mjs` | X-A: 102; X-F: 295 | 66, 72, 75, 81, 141 |
| `src/substrate/standard-error.mjs` | T1/T2: 103, 115, 121 | 5, 18 |
| `src/substrate/worktrees.mjs` | W: 91, 99, 109, 250, 258, 348, 363, 377, 432, 468, 469, 476 | 19, 28, 31, 32, 33, 60 |

S8 consists of comments about measured survivor timing and later containment events; none reads a new outside value. P-C owns its command-result lines 351, 1788, 1790, 1811, 1813, 1822 and 1823. P-T owns the process-table parser and stderr lines 817, 902, 903, 945 and 987, and the survivor-sighting calls at 1170, 1646 and 1656. T1/T2 own the output writer import at line 13. The [all-search-hits comparison](https://github.com/williacj/rigger/issues/1150#issuecomment-6515255546) checks the union of every quoted source search against both ledgers: 338 distinct hits, all 338 assigned, none missing or surplus.

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

The selected-position tables below separate the JSON root, each container and each selected field at the stage that consumes it. They distinguish a resolved write answer, the same answer carried by an EVENT_REFUSED failure, and the read before a write. They replace the earlier combined REST, write-answer and settings rows. The earlier probe receipts remain linked as historical measurements; a root case is not evidence for a different nested field.

These independently callable forge helpers retain their original maps:

| Entry point and field | Missing | Wrong type | Null | Extra | Oversized | Deep | Not JSON | Non-finite (found) |
|---|---|---|---|---|---|---|---|---|
| F-R, answerOf root | U/B [F-read.answerOf.missing] | U/B [F-read.answerOf.wrong-type] | U/B [F-read.answerOf.null] | U/B [F-read.answerOf.extra] | U/B [F-read.answerOf.oversized] | U/B [F-read.answerOf.deep] | T/B [F-read.answerOf.not-json] | U/B [F-read.answerOf.non-finite] |
| F-R, board ID also used by F-S/F-I | U/B [B-board.missing] | U/B [B-board.wrong-type] | U/B [B-board.null] | U/C [B-board.extra] | U/B [B-board.oversized] | U/B [B-board.deep] | T/B [B-board.not-json] | U/B [B-board.non-finite] |
| F-R, repository ID also used by F-S | U/B [B-repository.missing] | U/B [B-repository.wrong-type] | U/B [B-repository.null] | U/C [B-repository.extra] | U/B [B-repository.oversized] | U/B [B-repository.deep] | T/B [B-repository.not-json] | U/B [B-repository.non-finite] |

#### Selected-field and stage method

The new probe's [source and exact commands](https://github.com/williacj/rigger/issues/1150#issuecomment-6523373449), [receipt index](https://github.com/williacj/rigger/issues/1150#issuecomment-6523390941) quote the entire source and unfiltered emitted output at the measured main commit. The run began at 2026-10-30T12:54:44Z with one-minute load 7.05, recorded its PID at start and exited 0. The source comparison against the measured substrate tree also exited 0. The probe's task manifests enumerate 538 field/stage positions, with a valid baseline and the eight JSON variants at each; seven separate file-byte records complete its 4,849 emitted result records. The table generator measures 4,304 ruled JSON cells. These are measurements of this fixture matrix, not a count of all possible JSON values.

Full output parts, in order: [1](https://github.com/williacj/rigger/issues/1150#issuecomment-6523373882); [2](https://github.com/williacj/rigger/issues/1150#issuecomment-6523374416); [3](https://github.com/williacj/rigger/issues/1150#issuecomment-6523374774); [4](https://github.com/williacj/rigger/issues/1150#issuecomment-6523375254); [5](https://github.com/williacj/rigger/issues/1150#issuecomment-6523375684); [6](https://github.com/williacj/rigger/issues/1150#issuecomment-6523376145); [7](https://github.com/williacj/rigger/issues/1150#issuecomment-6523376570); [8](https://github.com/williacj/rigger/issues/1150#issuecomment-6523377078); [9](https://github.com/williacj/rigger/issues/1150#issuecomment-6523377502); [10](https://github.com/williacj/rigger/issues/1150#issuecomment-6523377880); [11](https://github.com/williacj/rigger/issues/1150#issuecomment-6523378273); [12](https://github.com/williacj/rigger/issues/1150#issuecomment-6523378760); [13](https://github.com/williacj/rigger/issues/1150#issuecomment-6523379249); [14](https://github.com/williacj/rigger/issues/1150#issuecomment-6523379716); [15](https://github.com/williacj/rigger/issues/1150#issuecomment-6523380270); [16](https://github.com/williacj/rigger/issues/1150#issuecomment-6523380648); [17](https://github.com/williacj/rigger/issues/1150#issuecomment-6523381128); [18](https://github.com/williacj/rigger/issues/1150#issuecomment-6523381582); [19](https://github.com/williacj/rigger/issues/1150#issuecomment-6523381944); [20](https://github.com/williacj/rigger/issues/1150#issuecomment-6523382252); [21](https://github.com/williacj/rigger/issues/1150#issuecomment-6523382604); [22](https://github.com/williacj/rigger/issues/1150#issuecomment-6523382989); [23](https://github.com/williacj/rigger/issues/1150#issuecomment-6523383348); [24](https://github.com/williacj/rigger/issues/1150#issuecomment-6523383744); [25](https://github.com/williacj/rigger/issues/1150#issuecomment-6523384193); [26](https://github.com/williacj/rigger/issues/1150#issuecomment-6523384651); [27](https://github.com/williacj/rigger/issues/1150#issuecomment-6523385091); [28](https://github.com/williacj/rigger/issues/1150#issuecomment-6523385517); [29](https://github.com/williacj/rigger/issues/1150#issuecomment-6523385907); [30](https://github.com/williacj/rigger/issues/1150#issuecomment-6523386318); [31](https://github.com/williacj/rigger/issues/1150#issuecomment-6523386729); [32](https://github.com/williacj/rigger/issues/1150#issuecomment-6523387161); [33](https://github.com/williacj/rigger/issues/1150#issuecomment-6523387560); [34](https://github.com/williacj/rigger/issues/1150#issuecomment-6523387965); [35](https://github.com/williacj/rigger/issues/1150#issuecomment-6523388310); [36](https://github.com/williacj/rigger/issues/1150#issuecomment-6523388747); [37](https://github.com/williacj/rigger/issues/1150#issuecomment-6523389137); [38](https://github.com/williacj/rigger/issues/1150#issuecomment-6523389628); [39](https://github.com/williacj/rigger/issues/1150#issuecomment-6523390213); [40](https://github.com/williacj/rigger/issues/1150#issuecomment-6523390604).

Each table row's probe prefix plus a dot and its column's kind is the exact output record ID: missing, wrong, null, extra, oversized, deep, nonjson or nonfinite. Each manifest carries the actual JSON path. The root missing variant is an empty object; a missing field is deleted; removing a selected array member produces a valid shorter list. Thus an empty valid list can conform while a present member missing a required field breaches. Extra fields are placed at the nearest containing object. Oversized strings contain 4,096 characters, numeric fields use finite 1e100, containers carry padded valid members or a padded extra field, and the found non-finite variant is parsed from 1e999. Deep means the nested object printed by the source, not an inferred recursion limit. Existing earlier probes also retain their larger and deeper fixtures.

The selection-source names in the tables refer to these exact modules: read is `src/substrate/forge/read.mjs`; repository-write is `src/substrate/forge/repository-write.mjs`; schema-write is `src/substrate/forge/schema-write.mjs`; item-write is `src/substrate/forge/item-write.mjs`; runners is `src/substrate/forge/runners.mjs`; claude is `src/substrate/providers/claude.mjs`. Line numbers are at the measured commit. Read-side sibling rows cite everyPage at line 77; the inventory names their exported sides and the selected path names their distinct consumer. A final-page cursor is not consumed; the active-cursor row exercises its use in the next request. Query-only data discarded by a consumer is distinct from a field handed on.

O/B on a read means the record's displayed derived state, absence, list or acknowledgment was produced from a malformed selected value; it is not a successful check of that value. U/B means the unchecked selected value or unchecked parsed reply crosses the boundary. R/C records a built refusal, including the wrapper around a parser's TypeError; T/B records an escaping TypeError or SyntaxError. O/C on an event-refused row is the documented EVENT_REFUSED rejection carrying an allowed made mark. O/B there means that mark carries an unchecked malformed answer, or that an invalid acknowledgment passed the success check. R/C on that stage rethrows the documented failure without a made mark when the answer fails the side's check. The receipt shows made, cause, call order and simulated writes separately; a built parse failure after one simulated write is never described as a pre-write refusal. No assertion here equates an attempted signal/timeout call with a proven real forge write.

H/C on a discarded optional field relies on the source's explicit selection/default; H/C for an ignored extra field does not claim that arbitrary siblings were validated. Every U/C string cell uses rule 4's “A contract allows any string where it names text” clause. Structural enums, IDs and SHAs do not use that clause. An unused final-page cursor and a single-run ID not used by sorting have their own cells; the competing-run stage exercises the ID comparison.

The REST cases independently show a policy member's missing name becoming an own undefined property, a missing pinned app ID yielding absent with one run or selecting the older failed run with two, and a missing newer run ID selecting that older failed run. Required-check parameters, their list, each member and its fields have separate rows: missing parameters yield an empty result, an object list yields a wrapped TypeError, and classic contexts supplied as the string ci yield separate c and i requirements. A parameter/container failure cannot stand in for a field failure.

The repository-write cases cover every endpoint's parsed reply. openIssue selects number only after checking labels: missing number returns undefined, a string number returns seven and a non-finite number returns Infinity after one simulated POST. closeIssue can return an object containing Infinity after one simulated PATCH. Comment, label-addition, label-removal and close replies are each mapped separately, including nested members. The same replies are driven through written's event-refusal result contract (`src/substrate/forge/write-made.mjs`, lines 19–29): an invalid answer can also be attached to a failure's made mark. Schema and item mutation roots and their selected children are mapped independently at both stages; children ignored by a void-returning operation are not mistaken for an unchecked returned ID. Each write exit family also has separate nonzero, signal, timeout and never-started rows.

#### Selected REST read positions

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| REST-newest-root; $ | read; 0 writes | read, line 648 | R/C | O/B | R/C | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-newest-entry; $[0] | read; 0 writes | read, line 648 | H/C | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-newest-number; $[0].number | read; 0 writes | read, line 648 | O/B | U/B | O/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-permission-root; $ | read; 0 writes | read, line 482 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-permission-role; $.role_name | read; 0 writes | read, line 482 | R/C | R/C | R/C | H/C | U/B | R/C | R/C | R/C | FC1 |
| REST-compare-root; $ | read; 0 writes | read, line 557 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-compare-commit; $.merge_base_commit | read; 0 writes | read, line 557 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-compare-sha; $.merge_base_commit.sha | read; 0 writes | read, line 557 | R/C | U/B | R/C | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-environment-root; $ | read; 0 writes | read, line 324 | R/C | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-environment-bypass; $.can_admins_bypass | read; 0 writes | read, line 324 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-environment-policy; $.deployment_branch_policy | read; 0 writes | read, line 324 | R/C | U/B | H/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| REST-environment-protected; $.deployment_branch_policy.protected_branches | read; 0 writes | read, line 324 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-environment-custom; $.deployment_branch_policy.custom_branch_policies | read; 0 writes | read, line 324 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-policies-root; $ | read; 0 writes | read, line 330 | R/C | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-policies-list; $.branch_policies | read; 0 writes | read, line 330 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-policies-entry; $.branch_policies[0] | read; 0 writes | read, line 330 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| REST-policies-name; $.branch_policies[0].name | read; 0 writes | read, line 330 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| REST-policies-type; $.branch_policies[0].type | read; 0 writes | read, line 330 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-variable-root; $ | read; 0 writes | read, line 752 | R/C | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-variable-value; $.value | read; 0 writes | read, line 752 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-secret-root; $ | read; 0 writes | read, line 762 | R/C | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-secret-name; $.name | read; 0 writes | read, line 762 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| REST-runs-root; $ | read; 0 writes | read, line 366 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-runs-list; $.check_runs | read; 0 writes | read, line 366 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-runs-entry; $.check_runs[1] | read; 0 writes | read, line 366 | H/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-runs-name; $.check_runs[1].name | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | U/B | O/B | R/C | O/B | FC1 |
| REST-runs-id; $.check_runs[1].id | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | O/B | O/B | R/C | O/B | FC1 |
| REST-runs-status; $.check_runs[1].status | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-runs-conclusion; $.check_runs[1].conclusion | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-runs-app; $.check_runs[1].app | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-runs-app-id; $.check_runs[1].app.id | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | O/B | O/B | R/C | O/B | FC1 |
| REST-run-only-id; $.check_runs[0].id | read; 0 writes | read, line 366 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| REST-run-only-app; $.check_runs[0].app | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-run-only-app-id; $.check_runs[0].app.id | read; 0 writes | read, line 366 | O/B | O/B | O/B | H/C | O/B | O/B | R/C | O/B | FC1 |
| REST-statuses-list; $ | read; 0 writes | read, line 368 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-statuses-entry; $[0] | read; 0 writes | read, line 368 | H/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-statuses-context; $[0].context | read; 0 writes | read, line 368 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-statuses-state; $[0].state | read; 0 writes | read, line 368 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-statuses-creator; $[0].creator | read; 0 writes | read, line 368 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-statuses-login; $[0].creator.login | read; 0 writes | read, line 368 | H/C | U/B | H/C | H/C | U/C | U/B | R/C | U/B | FC1 |
| REST-statuses-id; $[0].creator.id | read; 0 writes | read, line 368 | H/C | U/B | H/C | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-rules-list; $ | read; 0 writes | read, line 398 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-rules-entry; $[0] | read; 0 writes | read, line 398 | H/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-rules-type; $[0].type | read; 0 writes | read, line 398 | O/B | O/B | O/B | H/C | U/B | O/B | R/C | O/B | FC1 |
| REST-rules-parameters; $[0].parameters | read; 0 writes | read, line 398 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-rules-checks; $[0].parameters.required_status_checks | read; 0 writes | read, line 398 | O/B | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-rules-check; $[0].parameters.required_status_checks[0] | read; 0 writes | read, line 398 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| REST-rules-context; $[0].parameters.required_status_checks[0].context | read; 0 writes | read, line 398 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| REST-rules-integration; $[0].parameters.required_status_checks[0].integration_id | read; 0 writes | read, line 398 | H/C | U/B | H/C | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-classic-root; $ | read; 0 writes | read, line 414 | H/C | O/B | R/C | H/C | H/C | H/C | R/C | O/B | FC1 |
| REST-classic-required; $.required_status_checks | read; 0 writes | read, line 414 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| REST-classic-checks; $.required_status_checks.checks | read; 0 writes | read, line 414 | H/C | R/C | H/C | H/C | H/C | R/C | R/C | R/C | none |
| REST-classic-check; $.required_status_checks.checks[0] | read; 0 writes | read, line 414 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| REST-classic-context; $.required_status_checks.checks[0].context | read; 0 writes | read, line 414 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| REST-classic-app; $.required_status_checks.checks[0].app_id | read; 0 writes | read, line 414 | H/C | U/B | H/C | H/C | U/B | U/B | R/C | U/B | FC1 |
| REST-classic-contexts; $.required_status_checks.contexts | read; 0 writes | read, line 414 | H/C | O/B | H/C | H/C | H/C | R/C | R/C | R/C | FC1 |
| REST-classic-context-entry; $.required_status_checks.contexts[0] | read; 0 writes | read, line 414 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |

#### Selected GraphQL read positions

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GQL-fields-root; $ | read; 0 writes | read, line 221 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-fields-data; $.data | read; 0 writes | read, line 221 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-fields-owner; $.data.repositoryOwner | read; 0 writes | read, line 221 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-fields-project; $.data.repositoryOwner.projectV2 | read; 0 writes | read, line 221 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-fields-connection; $.data.repositoryOwner.projectV2.fields | read; 0 writes | read, line 221 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-fields-nodes; $.data.repositoryOwner.projectV2.fields.nodes | read; 0 writes | read, line 221 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-fields-field; $.data.repositoryOwner.projectV2.fields.nodes[0] | read; 0 writes | read, line 221 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-fields-name; $.data.repositoryOwner.projectV2.fields.nodes[0].name | read; 0 writes | read, line 221 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-fields-options; $.data.repositoryOwner.projectV2.fields.nodes[0].options | read; 0 writes | read, line 221 | H/C | T/B | H/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-fields-option; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0] | read; 0 writes | read, line 221 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-fields-option-name; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0].name | read; 0 writes | read, line 221 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-fields-pageInfo; $.data.repositoryOwner.projectV2.fields.pageInfo | read; 0 writes | read, line 221 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-fields-hasNextPage; $.data.repositoryOwner.projectV2.fields.pageInfo.hasNextPage | read; 0 writes | read, line 221 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-fields-endCursor; $.data.repositoryOwner.projectV2.fields.pageInfo.endCursor | read; 0 writes | read, line 221 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-types-dataType; $.data.repositoryOwner.projectV2.fields.nodes[0].dataType | read; 0 writes | read, line 221 | U/B | U/B | U/B | H/C | U/B | U/B | T/B | U/B | FC1 |
| GQL-cursor-active; $.data.repositoryOwner.projectV2.fields.pageInfo.endCursor | pagination cursor consumed; 0 writes | read, line 78 | O/B | O/B | O/B | H/C | U/C | O/B | T/B | O/B | FC1 |
| GQL-default-root; $ | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data; $.data | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data-repository; $.data.repository | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data-repository-defaultBranchRef; $.data.repository.defaultBranchRef | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data-repository-defaultBranchRef-name; $.data.repository.defaultBranchRef.name | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data-repository-defaultBranchRef-target; $.data.repository.defaultBranchRef.target | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-default-data-repository-defaultBranchRef-target-oid; $.data.repository.defaultBranchRef.target.oid | read; 0 writes | read, line 609 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-pull-root; $ | read; 0 writes | read, line 665 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-pull-data; $.data | read; 0 writes | read, line 665 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-pull-data-repository; $.data.repository | read; 0 writes | read, line 665 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-pull-data-repository-pullRequest; $.data.repository.pullRequest | read; 0 writes | read, line 665 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-pull-data-repository-pullRequest-number; $.data.repository.pullRequest.number | read; 0 writes | read, line 665 | U/B | U/B | U/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-pull-data-repository-pullRequest-state; $.data.repository.pullRequest.state | read; 0 writes | read, line 665 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-pull-data-repository-pullRequest-headRefOid; $.data.repository.pullRequest.headRefOid | read; 0 writes | read, line 665 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| GQL-pull-data-repository-pullRequest-headRefName; $.data.repository.pullRequest.headRefName | read; 0 writes | read, line 665 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-pull-data-repository-pullRequest-baseRefName; $.data.repository.pullRequest.baseRefName | read; 0 writes | read, line 665 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-pull-data-repository-pullRequest-headRepository; $.data.repository.pullRequest.headRepository | read; 0 writes | read, line 665 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-pull-data-repository-pullRequest-headRepository-nameWithOwner; $.data.repository.pullRequest.headRepository.nameWithOwner | read; 0 writes | read, line 665 | O/B | R/C | O/B | H/C | H/C | R/C | R/C | R/C | FC1 |
| GQL-mergeable-root; $ | read; 0 writes | read, line 572 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergeable-data; $.data | read; 0 writes | read, line 572 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergeable-data-repository; $.data.repository | read; 0 writes | read, line 572 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergeable-data-repository-pullRequest; $.data.repository.pullRequest | read; 0 writes | read, line 572 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergeable-data-repository-pullRequest-mergeable; $.data.repository.pullRequest.mergeable | read; 0 writes | read, line 572 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-mergebase-pre-root; $ | read; 0 writes | read, line 556 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergebase-pre-data; $.data | read; 0 writes | read, line 556 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergebase-pre-data-repository; $.data.repository | read; 0 writes | read, line 556 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-mergebase-pre-data-repository-pullRequest; $.data.repository.pullRequest | read; 0 writes | read, line 556 | R/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-mergebase-pre-data-repository-pullRequest-baseRefName; $.data.repository.pullRequest.baseRefName | read; 0 writes | read, line 556 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-mergebase-pre-data-repository-pullRequest-headRefOid; $.data.repository.pullRequest.headRefOid | read; 0 writes | read, line 556 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| GQL-labels-node; $.data.repository.labels.nodes[0] | read; 0 writes | read, line 221 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-labels-name; $.data.repository.labels.nodes[0].name | read; 0 writes | read, line 221 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-branches-name; $.data.repository.refs.nodes[0].name | read; 0 writes | read, line 541 | O/B | O/B | O/B | H/C | U/B | O/B | R/C | O/B | FC1 |
| GQL-labelled-number; $.data.repository.issues.nodes[0].number | read; 0 writes | read, line 637 | U/B | U/B | U/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-issue-root; $.data.repository.issue | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-issue-number; $.data.repository.issue.number | read; 0 writes | read, line 625 | U/B | U/B | U/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-issue-title; $.data.repository.issue.title | read; 0 writes | read, line 625 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-issue-body; $.data.repository.issue.body | read; 0 writes | read, line 625 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-issue-state; $.data.repository.issue.state | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-issue-author; $.data.repository.issue.author | read; 0 writes | read, line 625 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-issue-author-login; $.data.repository.issue.author.login | read; 0 writes | read, line 625 | H/C | U/B | H/C | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-issue-repository; $.data.repository.issue.repository | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-issue-repository-nameWithOwner; $.data.repository.issue.repository.nameWithOwner | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-issue-labels; $.data.repository.issue.labels | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-issue-labels-nodes; $.data.repository.issue.labels.nodes | read; 0 writes | read, line 625 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-issue-labels-nodes-0; $.data.repository.issue.labels.nodes[0] | read; 0 writes | read, line 625 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-issue-labels-nodes-0-name; $.data.repository.issue.labels.nodes[0].name | read; 0 writes | read, line 625 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-issue-labels-pageInfo; $.data.repository.issue.labels.pageInfo | read; 0 writes | read, line 625 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-issue-labels-pageInfo-hasNextPage; $.data.repository.issue.labels.pageInfo.hasNextPage | read; 0 writes | read, line 625 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-issue-labels-pageInfo-endCursor; $.data.repository.issue.labels.pageInfo.endCursor | read; 0 writes | read, line 625 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readComments-node; $.data.repository.pullRequest.comments.nodes[0] | read; 0 writes | read, line 496 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-readComments-body; $.data.repository.pullRequest.comments.nodes[0].body | read; 0 writes | read, line 496 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-readComments-createdAt; $.data.repository.pullRequest.comments.nodes[0].createdAt | read; 0 writes | read, line 496 | U/B | U/B | O/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-readComments-id; $.data.repository.pullRequest.comments.nodes[0].id | read; 0 writes | read, line 496 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| GQL-readComments-author; $.data.repository.pullRequest.comments.nodes[0].author | read; 0 writes | read, line 496 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readComments-author-login; $.data.repository.pullRequest.comments.nodes[0].author.login | read; 0 writes | read, line 496 | H/C | U/B | H/C | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-readComments-lastEditedAt; $.data.repository.pullRequest.comments.nodes[0].lastEditedAt | read; 0 writes | read, line 496 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readComments-includesCreatedEdit; $.data.repository.pullRequest.comments.nodes[0].includesCreatedEdit | read; 0 writes | read, line 496 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readIssueComments-node; $.data.repository.issue.comments.nodes[0] | read; 0 writes | read, line 496 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-readIssueComments-body; $.data.repository.issue.comments.nodes[0].body | read; 0 writes | read, line 496 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-readIssueComments-createdAt; $.data.repository.issue.comments.nodes[0].createdAt | read; 0 writes | read, line 496 | U/B | U/B | O/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-readIssueComments-id; $.data.repository.issue.comments.nodes[0].id | read; 0 writes | read, line 496 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| GQL-readIssueComments-author; $.data.repository.issue.comments.nodes[0].author | read; 0 writes | read, line 496 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readIssueComments-author-login; $.data.repository.issue.comments.nodes[0].author.login | read; 0 writes | read, line 496 | H/C | U/B | H/C | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-readIssueComments-lastEditedAt; $.data.repository.issue.comments.nodes[0].lastEditedAt | read; 0 writes | read, line 496 | H/C | O/B | H/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-readIssueComments-includesCreatedEdit; $.data.repository.issue.comments.nodes[0].includesCreatedEdit | read; 0 writes | read, line 496 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-items-node; $.data.repositoryOwner.projectV2.items.nodes[0] | read; 0 writes | read, line 132 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-id; $.data.repositoryOwner.projectV2.items.nodes[0].id | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/B | U/B | T/B | U/B | FC1 |
| GQL-items-fieldValues; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-fieldValues-nodes; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-fieldValues-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0] | read; 0 writes | read, line 132 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-fieldValues-nodes-0-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].name | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-items-fieldValues-nodes-0-field; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].field | read; 0 writes | read, line 132 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-fieldValues-nodes-0-field-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].field.name | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-items-fieldValues-pageInfo; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.pageInfo | read; 0 writes | read, line 132 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-fieldValues-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.pageInfo.hasNextPage | read; 0 writes | read, line 132 | O/B | R/C | O/B | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-items-content; $.data.repositoryOwner.projectV2.items.nodes[0].content | read; 0 writes | read, line 132 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-content-__typename; $.data.repositoryOwner.projectV2.items.nodes[0].content.__typename | read; 0 writes | read, line 132 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-content-number; $.data.repositoryOwner.projectV2.items.nodes[0].content.number | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-items-content-title; $.data.repositoryOwner.projectV2.items.nodes[0].content.title | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-items-content-body; $.data.repositoryOwner.projectV2.items.nodes[0].content.body | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-items-content-repository; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-content-repository-nameWithOwner; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository.nameWithOwner | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-content-labels; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-content-labels-nodes; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes | read; 0 writes | read, line 132 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-items-content-labels-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes[0] | read; 0 writes | read, line 132 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-items-content-labels-nodes-0-name; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes[0].name | read; 0 writes | read, line 132 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-items-content-labels-pageInfo; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.pageInfo | read; 0 writes | read, line 132 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-items-content-labels-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.pageInfo.hasNextPage | read; 0 writes | read, line 132 | O/B | R/C | O/B | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-other-type; $.data.repositoryOwner.projectV2.items.nodes[0].type | read; 0 writes | read, line 170 | O/B | O/B | O/B | H/C | U/B | O/B | T/B | O/B | FC1 |
| GQL-other-content; $.data.repositoryOwner.projectV2.items.nodes[0].content | read; 0 writes | read, line 170 | H/C | O/B | H/C | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-other-content-repository; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository | read; 0 writes | read, line 170 | H/C | O/B | H/C | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-other-content-repository-nameWithOwner; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository.nameWithOwner | read; 0 writes | read, line 170 | H/C | T/B | H/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-pulls-node; $.data.repository.pullRequests.nodes[0] | read; 0 writes | read, line 525 | H/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-pulls-number; $.data.repository.pullRequests.nodes[0].number | read; 0 writes | read, line 525 | U/B | U/B | U/B | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-pulls-state; $.data.repository.pullRequests.nodes[0].state | read; 0 writes | read, line 525 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-pulls-headRefOid; $.data.repository.pullRequests.nodes[0].headRefOid | read; 0 writes | read, line 525 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| GQL-pulls-baseRefName; $.data.repository.pullRequests.nodes[0].baseRefName | read; 0 writes | read, line 525 | U/B | U/B | U/B | H/C | U/C | U/B | R/C | U/B | FC1 |
| GQL-pulls-headRepository; $.data.repository.pullRequests.nodes[0].headRepository | read; 0 writes | read, line 525 | H/C | R/C | H/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-pulls-headRepository-nameWithOwner; $.data.repository.pullRequests.nodes[0].headRepository.nameWithOwner | read; 0 writes | read, line 525 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-root; $ | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data; $.data | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data-repository; $.data.repository | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object; $.data.repository.object | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-oid; $.data.repository.object.oid | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file; $.data.repository.object.file | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | H/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-mode; $.data.repository.object.file.mode | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-type; $.data.repository.object.file.type | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-object; $.data.repository.object.file.object | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-object-text; $.data.repository.object.file.object.text | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-object-isBinary; $.data.repository.object.file.object.isBinary | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-object-isTruncated; $.data.repository.object.file.object.isTruncated | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-file-data-repository-object-file-object-byteSize; $.data.repository.object.file.object.byteSize | readFileAt success reply; 0 writes | read, line 699 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-root; $ | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-data; $.data | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-errors; $.errors | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-errors-0; $.errors[0] | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-errors-0-type; $.errors[0].type | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-notfound-issue-errors-0-path; $.errors[0].path | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-notfound-file-root; $ | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-file-data; $.data | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-file-errors; $.errors | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-file-errors-0; $.errors[0] | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-notfound-file-errors-0-type; $.errors[0].type | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-notfound-file-errors-0-path; $.errors[0].path | nonzero NOT_FOUND reply; 0 writes | read, line 453 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| GQL-sibling-readColumns-root; $ | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data; $.data | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner; $.data.repositoryOwner | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields; $.data.repositoryOwner.projectV2.fields | readColumns selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes; $.data.repositoryOwner.projectV2.fields.nodes | readColumns selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes-0; $.data.repositoryOwner.projectV2.fields.nodes[0] | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes-0-name; $.data.repositoryOwner.projectV2.fields.nodes[0].name | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes-0-options; $.data.repositoryOwner.projectV2.fields.nodes[0].options | readColumns selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes-0-options-0; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0] | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-nodes-0-options-0-name; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0].name | readColumns selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-pageInfo; $.data.repositoryOwner.projectV2.fields.pageInfo | readColumns selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.fields.pageInfo.hasNextPage | readColumns selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readColumns-data-repositoryOwner-projectV2-fields-pageInfo-endCursor; $.data.repositoryOwner.projectV2.fields.pageInfo.endCursor | readColumns selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-readFieldTypes-root; $ | readFieldTypes selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readFieldTypes-data; $.data | readFieldTypes selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner; $.data.repositoryOwner | readFieldTypes selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | readFieldTypes selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields; $.data.repositoryOwner.projectV2.fields | readFieldTypes selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-nodes; $.data.repositoryOwner.projectV2.fields.nodes | readFieldTypes selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-nodes-0; $.data.repositoryOwner.projectV2.fields.nodes[0] | readFieldTypes selected reply; 0 writes | read, line 77 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-nodes-0-name; $.data.repositoryOwner.projectV2.fields.nodes[0].name | readFieldTypes selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-pageInfo; $.data.repositoryOwner.projectV2.fields.pageInfo | readFieldTypes selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.fields.pageInfo.hasNextPage | readFieldTypes selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readFieldTypes-data-repositoryOwner-projectV2-fields-pageInfo-endCursor; $.data.repositoryOwner.projectV2.fields.pageInfo.endCursor | readFieldTypes selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-readLabels-root; $ | readLabels selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readLabels-data; $.data | readLabels selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readLabels-data-repository; $.data.repository | readLabels selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readLabels-data-repository-labels; $.data.repository.labels | readLabels selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readLabels-data-repository-labels-nodes; $.data.repository.labels.nodes | readLabels selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readLabels-data-repository-labels-pageInfo; $.data.repository.labels.pageInfo | readLabels selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readLabels-data-repository-labels-pageInfo-hasNextPage; $.data.repository.labels.pageInfo.hasNextPage | readLabels selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readLabels-data-repository-labels-pageInfo-endCursor; $.data.repository.labels.pageInfo.endCursor | readLabels selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-readBranches-root; $ | readBranches selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readBranches-data; $.data | readBranches selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readBranches-data-repository; $.data.repository | readBranches selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readBranches-data-repository-refs; $.data.repository.refs | readBranches selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readBranches-data-repository-refs-nodes; $.data.repository.refs.nodes | readBranches selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readBranches-data-repository-refs-nodes-0; $.data.repository.refs.nodes[0] | readBranches selected reply; 0 writes | read, line 77 | H/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readBranches-data-repository-refs-pageInfo; $.data.repository.refs.pageInfo | readBranches selected reply; 0 writes | read, line 77 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readBranches-data-repository-refs-pageInfo-hasNextPage; $.data.repository.refs.pageInfo.hasNextPage | readBranches selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readBranches-data-repository-refs-pageInfo-endCursor; $.data.repository.refs.pageInfo.endCursor | readBranches selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| GQL-sibling-readLabelledIssues-root; $ | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readLabelledIssues-data; $.data | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readLabelledIssues-data-repository; $.data.repository | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readLabelledIssues-data-repository-issues; $.data.repository.issues | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readLabelledIssues-data-repository-issues-nodes; $.data.repository.issues.nodes | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readLabelledIssues-data-repository-issues-nodes-0; $.data.repository.issues.nodes[0] | readLabelledIssues selected reply; 0 writes | read, line 77 | H/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| GQL-sibling-readLabelledIssues-data-repository-issues-pageInfo; $.data.repository.issues.pageInfo | readLabelledIssues selected reply; 0 writes | read, line 77 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readLabelledIssues-data-repository-issues-pageInfo-hasNextPage; $.data.repository.issues.pageInfo.hasNextPage | readLabelledIssues selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readLabelledIssues-data-repository-issues-pageInfo-endCursor; $.data.repository.issues.pageInfo.endCursor | readLabelledIssues selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| GQL-sibling-readOtherRepositories-root; $ | readOtherRepositories selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readOtherRepositories-data; $.data | readOtherRepositories selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner; $.data.repositoryOwner | readOtherRepositories selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | readOtherRepositories selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items; $.data.repositoryOwner.projectV2.items | readOtherRepositories selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-nodes; $.data.repositoryOwner.projectV2.items.nodes | readOtherRepositories selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0] | readOtherRepositories selected reply; 0 writes | read, line 77 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-nodes-0-id; $.data.repositoryOwner.projectV2.items.nodes[0].id | readOtherRepositories selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/B | U/B | T/B | U/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-pageInfo; $.data.repositoryOwner.projectV2.items.pageInfo | readOtherRepositories selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.pageInfo.hasNextPage | readOtherRepositories selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readOtherRepositories-data-repositoryOwner-projectV2-items-pageInfo-endCursor; $.data.repositoryOwner.projectV2.items.pageInfo.endCursor | readOtherRepositories selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-readItems-root; $ | readItems selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readItems-data; $.data | readItems selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readItems-data-repositoryOwner; $.data.repositoryOwner | readItems selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | readItems selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2-items; $.data.repositoryOwner.projectV2.items | readItems selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2-items-nodes; $.data.repositoryOwner.projectV2.items.nodes | readItems selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2-items-pageInfo; $.data.repositoryOwner.projectV2.items.pageInfo | readItems selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2-items-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.pageInfo.hasNextPage | readItems selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-readItems-data-repositoryOwner-projectV2-items-pageInfo-endCursor; $.data.repositoryOwner.projectV2.items.pageInfo.endCursor | readItems selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-readPullRequests-root; $ | readPullRequests selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readPullRequests-data; $.data | readPullRequests selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readPullRequests-data-repository; $.data.repository | readPullRequests selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readPullRequests-data-repository-pullRequests; $.data.repository.pullRequests | readPullRequests selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readPullRequests-data-repository-pullRequests-nodes; $.data.repository.pullRequests.nodes | readPullRequests selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readPullRequests-data-repository-pullRequests-pageInfo; $.data.repository.pullRequests.pageInfo | readPullRequests selected reply; 0 writes | read, line 77 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readPullRequests-data-repository-pullRequests-pageInfo-hasNextPage; $.data.repository.pullRequests.pageInfo.hasNextPage | readPullRequests selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readPullRequests-data-repository-pullRequests-pageInfo-endCursor; $.data.repository.pullRequests.pageInfo.endCursor | readPullRequests selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| GQL-sibling-readIssue-root; $ | readIssue selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssue-data; $.data | readIssue selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssue-data-repository; $.data.repository | readIssue selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-root; $ | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data; $.data | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data-repository; $.data.repository | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data-repository-pullRequest; $.data.repository.pullRequest | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data-repository-pullRequest-comments; $.data.repository.pullRequest.comments | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data-repository-pullRequest-comments-nodes; $.data.repository.pullRequest.comments.nodes | readComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readComments-data-repository-pullRequest-comments-pageInfo; $.data.repository.pullRequest.comments.pageInfo | readComments selected reply; 0 writes | read, line 77 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readComments-data-repository-pullRequest-comments-pageInfo-hasNextPage; $.data.repository.pullRequest.comments.pageInfo.hasNextPage | readComments selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readComments-data-repository-pullRequest-comments-pageInfo-endCursor; $.data.repository.pullRequest.comments.pageInfo.endCursor | readComments selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| GQL-sibling-readIssueComments-root; $ | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data; $.data | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data-repository; $.data.repository | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data-repository-issue; $.data.repository.issue | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data-repository-issue-comments; $.data.repository.issue.comments | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data-repository-issue-comments-nodes; $.data.repository.issue.comments.nodes | readIssueComments selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| GQL-sibling-readIssueComments-data-repository-issue-comments-pageInfo; $.data.repository.issue.comments.pageInfo | readIssueComments selected reply; 0 writes | read, line 77 | R/C | O/B | R/C | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readIssueComments-data-repository-issue-comments-pageInfo-hasNextPage; $.data.repository.issue.comments.pageInfo.hasNextPage | readIssueComments selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | R/C | O/B | FC1 |
| GQL-sibling-readIssueComments-data-repository-issue-comments-pageInfo-endCursor; $.data.repository.issue.comments.pageInfo.endCursor | readIssueComments selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| GQL-sibling-priority-fields-root; $ | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data; $.data | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner; $.data.repositoryOwner | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields; $.data.repositoryOwner.projectV2.fields | priority-fields selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes; $.data.repositoryOwner.projectV2.fields.nodes | priority-fields selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0; $.data.repositoryOwner.projectV2.fields.nodes[0] | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0-name; $.data.repositoryOwner.projectV2.fields.nodes[0].name | priority-fields selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0-dataType; $.data.repositoryOwner.projectV2.fields.nodes[0].dataType | priority-fields selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0-options; $.data.repositoryOwner.projectV2.fields.nodes[0].options | priority-fields selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0-options-0; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0] | priority-fields selected reply; 0 writes | read, line 77 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-nodes-0-options-0-name; $.data.repositoryOwner.projectV2.fields.nodes[0].options[0].name | priority-fields selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-pageInfo; $.data.repositoryOwner.projectV2.fields.pageInfo | priority-fields selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.fields.pageInfo.hasNextPage | priority-fields selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-fields-data-repositoryOwner-projectV2-fields-pageInfo-endCursor; $.data.repositoryOwner.projectV2.fields.pageInfo.endCursor | priority-fields selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| GQL-sibling-priority-items-root; $ | priority-items selected reply; 0 writes | read, line 77 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data; $.data | priority-items selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner; $.data.repositoryOwner | priority-items selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2; $.data.repositoryOwner.projectV2 | priority-items selected reply; 0 writes | read, line 77 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items; $.data.repositoryOwner.projectV2.items | priority-items selected reply; 0 writes | read, line 77 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes; $.data.repositoryOwner.projectV2.items.nodes | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0] | priority-items selected reply; 0 writes | read, line 77 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-id; $.data.repositoryOwner.projectV2.items.nodes[0].id | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/B | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0] | priority-items selected reply; 0 writes | read, line 77 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-0-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].name | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-0-field; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].field | priority-items selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-0-field-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[0].field.name | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-1; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[1] | priority-items selected reply; 0 writes | read, line 77 | H/C | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-1-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[1].name | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-1-field; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[1].field | priority-items selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-nodes-1-field-name; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.nodes[1].field.name | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-pageInfo; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.pageInfo | priority-items selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-fieldValues-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.nodes[0].fieldValues.pageInfo.hasNextPage | priority-items selected reply; 0 writes | read, line 77 | O/B | R/C | O/B | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content; $.data.repositoryOwner.projectV2.items.nodes[0].content | priority-items selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-__typename; $.data.repositoryOwner.projectV2.items.nodes[0].content.__typename | priority-items selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-number; $.data.repositoryOwner.projectV2.items.nodes[0].content.number | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-title; $.data.repositoryOwner.projectV2.items.nodes[0].content.title | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-body; $.data.repositoryOwner.projectV2.items.nodes[0].content.body | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-repository; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-repository-nameWithOwner; $.data.repositoryOwner.projectV2.items.nodes[0].content.repository.nameWithOwner | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels-nodes; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes | priority-items selected reply; 0 writes | read, line 77 | T/B | T/B | T/B | H/C | H/C | T/B | T/B | T/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels-nodes-0; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes[0] | priority-items selected reply; 0 writes | read, line 77 | H/C | U/B | T/B | H/C | H/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels-nodes-0-name; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.nodes[0].name | priority-items selected reply; 0 writes | read, line 77 | U/B | U/B | U/B | H/C | U/C | U/B | T/B | U/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels-pageInfo; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.pageInfo | priority-items selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-nodes-0-content-labels-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.nodes[0].content.labels.pageInfo.hasNextPage | priority-items selected reply; 0 writes | read, line 77 | O/B | R/C | O/B | H/C | R/C | R/C | T/B | R/C | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-pageInfo; $.data.repositoryOwner.projectV2.items.pageInfo | priority-items selected reply; 0 writes | read, line 77 | T/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-pageInfo-hasNextPage; $.data.repositoryOwner.projectV2.items.pageInfo.hasNextPage | priority-items selected reply; 0 writes | read, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| GQL-sibling-priority-items-data-repositoryOwner-projectV2-items-pageInfo-endCursor; $.data.repositoryOwner.projectV2.items.pageInfo.endCursor | priority-items selected reply; 0 writes | read, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |

#### Repository write positions and stages

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WRITE-comment-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 76 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-comment-id-resolved; $.id | post-write resolved; 1 simulated write | repository-write, line 76 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-comment-body-resolved; $.body | post-write resolved; 1 simulated write | repository-write, line 76 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-comment-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 76 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-comment-id-event-refused; $.id | post-write event-refused; 1 simulated write | repository-write, line 76 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-comment-body-event-refused; $.body | post-write event-refused; 1 simulated write | repository-write, line 76 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-prcomment-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 116 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-prcomment-id-resolved; $.id | post-write resolved; 1 simulated write | repository-write, line 116 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-prcomment-body-resolved; $.body | post-write resolved; 1 simulated write | repository-write, line 116 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-prcomment-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 116 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-prcomment-id-event-refused; $.id | post-write event-refused; 1 simulated write | repository-write, line 116 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-prcomment-body-event-refused; $.body | post-write event-refused; 1 simulated write | repository-write, line 116 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-label-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 122 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-label-0-resolved; $[0] | post-write resolved; 1 simulated write | repository-write, line 122 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-label-0-name-resolved; $[0].name | post-write resolved; 1 simulated write | repository-write, line 122 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-label-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 122 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-label-0-event-refused; $[0] | post-write event-refused; 1 simulated write | repository-write, line 122 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-label-0-name-event-refused; $[0].name | post-write event-refused; 1 simulated write | repository-write, line 122 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-close-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 142 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-close-number-resolved; $.number | post-write resolved; 1 simulated write | repository-write, line 142 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-close-state-resolved; $.state | post-write resolved; 1 simulated write | repository-write, line 142 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-close-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 142 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-close-number-event-refused; $.number | post-write event-refused; 1 simulated write | repository-write, line 142 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-close-state-event-refused; $.state | post-write event-refused; 1 simulated write | repository-write, line 142 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-remove-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 148 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-remove-0-resolved; $[0] | post-write resolved; 1 simulated write | repository-write, line 148 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-remove-0-name-resolved; $[0].name | post-write resolved; 1 simulated write | repository-write, line 148 | U/B | U/B | U/B | U/B | U/B | U/B | R/C | U/B | FC1 |
| WRITE-remove-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 148 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-remove-0-event-refused; $[0] | post-write event-refused; 1 simulated write | repository-write, line 148 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-remove-0-name-event-refused; $[0].name | post-write event-refused; 1 simulated write | repository-write, line 148 | O/B | O/B | O/B | O/B | O/B | O/B | R/C | O/B | FC1 |
| WRITE-open-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| WRITE-open-number-resolved; $.number | post-write resolved; 1 simulated write | repository-write, line 131 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| WRITE-open-labels-resolved; $.labels | post-write resolved; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| WRITE-open-labels-0-resolved; $.labels[0] | post-write resolved; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| WRITE-open-labels-0-name-resolved; $.labels[0].name | post-write resolved; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| WRITE-open-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| WRITE-open-number-event-refused; $.number | post-write event-refused; 1 simulated write | repository-write, line 131 | O/B | O/B | O/B | O/C | O/B | O/B | R/C | O/B | FC1 |
| WRITE-open-labels-event-refused; $.labels | post-write event-refused; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| WRITE-open-labels-0-event-refused; $.labels[0] | post-write event-refused; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| WRITE-open-labels-0-name-event-refused; $.labels[0].name | post-write event-refused; 1 simulated write | repository-write, line 131 | R/C | R/C | R/C | O/C | R/C | R/C | R/C | R/C | none |
| WRITE-merge-root-resolved; $ | post-write resolved; 1 simulated write | repository-write, line 99 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-merged-resolved; $.merged | post-write resolved; 1 simulated write | repository-write, line 99 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-sha-resolved; $.sha | post-write resolved; 1 simulated write | repository-write, line 99 | U/B | U/B | U/B | H/C | U/B | U/B | T/B | U/B | FC1 |
| WRITE-merge-root-event-refused; $ | post-write event-refused; 1 simulated write | repository-write, line 99 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| WRITE-merge-merged-event-refused; $.merged | post-write event-refused; 1 simulated write | repository-write, line 99 | R/C | R/C | R/C | O/C | R/C | R/C | R/C | R/C | none |
| WRITE-merge-sha-event-refused; $.sha | post-write event-refused; 1 simulated write | repository-write, line 99 | O/B | O/B | O/B | O/C | O/B | O/B | R/C | O/B | FC1 |
| WRITE-merge-pre-root; $ | pre-write; 0 or 1 simulated writes | repository-write, line 38 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-pre-head; $.head | pre-write; 0 or 1 simulated writes | repository-write, line 38 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-pre-head-sha; $.head.sha | pre-write; 0 or 1 simulated writes | repository-write, line 38 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-pre-merged; $.merged | pre-write; 0 or 1 simulated writes | repository-write, line 38 | O/B | O/B | O/B | H/C | O/B | O/B | T/B | O/B | FC1 |
| WRITE-merge-pre-state; $.state | pre-write; 0 or 1 simulated writes | repository-write, line 38 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| WRITE-merge-pre-mergeable; $.mergeable | pre-write; 0 or 1 simulated writes | repository-write, line 38 | O/B | O/B | R/C | H/C | O/B | O/B | T/B | O/B | FC1 |
| WRITE-prcomment-pre-root; $ | pre-write; 0 or 1 simulated writes | repository-write, line 114 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| WRITE-prcomment-pre-head; $.head | pre-write; 0 or 1 simulated writes | repository-write, line 114 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| WRITE-prcomment-pre-head-sha; $.head.sha | pre-write; 0 or 1 simulated writes | repository-write, line 114 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| WRITE-merge-refusal-root; $ | post-write refusal; 1 simulated write | repository-write, line 11 | R/C | R/C | T/B | H/C | R/C | R/C | R/C | R/C | FC1 |
| WRITE-merge-refusal-status; $.status | post-write refusal; 1 simulated write | repository-write, line 11 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |
| WRITE-merge-refusal-message; $.message | post-write refusal; 1 simulated write | repository-write, line 11 | R/C | R/C | R/C | H/C | R/C | R/C | R/C | R/C | none |

#### Schema write answer stages

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCHEMA-field-root-resolved; $ | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-field-data-resolved; $.data | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-field-data-createProjectV2Field-resolved; $.data.createProjectV2Field | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-field-data-createProjectV2Field-projectV2Field-resolved; $.data.createProjectV2Field.projectV2Field | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-field-data-createProjectV2Field-projectV2Field-id-resolved; $.data.createProjectV2Field.projectV2Field.id | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-field-root-event-refused; $ | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-field-data-event-refused; $.data | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-field-data-createProjectV2Field-event-refused; $.data.createProjectV2Field | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | O/B | R/C | O/C | O/C | O/B | R/C | O/B | FC1 |
| SCHEMA-field-data-createProjectV2Field-projectV2Field-event-refused; $.data.createProjectV2Field.projectV2Field | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| SCHEMA-field-data-createProjectV2Field-projectV2Field-id-event-refused; $.data.createProjectV2Field.projectV2Field.id | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| SCHEMA-column-root-resolved; $ | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-column-data-resolved; $.data | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-column-data-updateProjectV2Field-resolved; $.data.updateProjectV2Field | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-column-data-updateProjectV2Field-projectV2Field-resolved; $.data.updateProjectV2Field.projectV2Field | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-column-data-updateProjectV2Field-projectV2Field-id-resolved; $.data.updateProjectV2Field.projectV2Field.id | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-column-root-event-refused; $ | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-column-data-event-refused; $.data | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-column-data-updateProjectV2Field-event-refused; $.data.updateProjectV2Field | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | O/B | R/C | O/C | O/C | O/B | R/C | O/B | FC1 |
| SCHEMA-column-data-updateProjectV2Field-projectV2Field-event-refused; $.data.updateProjectV2Field.projectV2Field | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| SCHEMA-column-data-updateProjectV2Field-projectV2Field-id-event-refused; $.data.updateProjectV2Field.projectV2Field.id | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| SCHEMA-label-root-resolved; $ | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-label-data-resolved; $.data | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-label-data-createLabel-resolved; $.data.createLabel | post-write resolved; 1 simulated write | schema-write, line 35 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| SCHEMA-label-data-createLabel-label-resolved; $.data.createLabel.label | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-label-data-createLabel-label-id-resolved; $.data.createLabel.label.id | post-write resolved; 1 simulated write | schema-write, line 35 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| SCHEMA-label-root-event-refused; $ | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-label-data-event-refused; $.data | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| SCHEMA-label-data-createLabel-event-refused; $.data.createLabel | post-write event-refused; 1 simulated write | schema-write, line 35 | R/C | O/B | R/C | O/C | O/C | O/B | R/C | O/B | FC1 |
| SCHEMA-label-data-createLabel-label-event-refused; $.data.createLabel.label | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| SCHEMA-label-data-createLabel-label-id-event-refused; $.data.createLabel.label.id | post-write event-refused; 1 simulated write | schema-write, line 35 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |

#### Item write answer stages

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ITEM-add-root-resolved; $ | post-write resolved; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| ITEM-add-data-resolved; $.data | post-write resolved; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| ITEM-add-data-addProjectV2ItemById-resolved; $.data.addProjectV2ItemById | post-write resolved; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| ITEM-add-data-addProjectV2ItemById-item-resolved; $.data.addProjectV2ItemById.item | post-write resolved; 1 simulated write | item-write, line 43 | R/C | U/B | R/C | H/C | H/C | U/B | R/C | U/B | FC1 |
| ITEM-add-data-addProjectV2ItemById-item-id-resolved; $.data.addProjectV2ItemById.item.id | post-write resolved; 1 simulated write | item-write, line 43 | U/B | U/B | U/B | H/C | U/B | U/B | R/C | U/B | FC1 |
| ITEM-add-root-event-refused; $ | post-write event-refused; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| ITEM-add-data-event-refused; $.data | post-write event-refused; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| ITEM-add-data-addProjectV2ItemById-event-refused; $.data.addProjectV2ItemById | post-write event-refused; 1 simulated write | item-write, line 43 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| ITEM-add-data-addProjectV2ItemById-item-event-refused; $.data.addProjectV2ItemById.item | post-write event-refused; 1 simulated write | item-write, line 43 | R/C | O/B | R/C | O/C | O/C | O/B | R/C | O/B | FC1 |
| ITEM-add-data-addProjectV2ItemById-item-id-event-refused; $.data.addProjectV2ItemById.item.id | post-write event-refused; 1 simulated write | item-write, line 43 | O/B | O/B | O/B | O/C | O/B | O/B | R/C | O/B | FC1 |
| ITEM-move-root-resolved; $ | post-write resolved; 1 simulated write | item-write, line 77 | O/B | O/B | T/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| ITEM-move-data-resolved; $.data | post-write resolved; 1 simulated write | item-write, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| ITEM-move-data-updateProjectV2ItemFieldValue-resolved; $.data.updateProjectV2ItemFieldValue | post-write resolved; 1 simulated write | item-write, line 77 | O/B | O/B | O/B | H/C | H/C | O/B | T/B | O/B | FC1 |
| ITEM-move-data-updateProjectV2ItemFieldValue-projectV2Item-resolved; $.data.updateProjectV2ItemFieldValue.projectV2Item | post-write resolved; 1 simulated write | item-write, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| ITEM-move-data-updateProjectV2ItemFieldValue-projectV2Item-id-resolved; $.data.updateProjectV2ItemFieldValue.projectV2Item.id | post-write resolved; 1 simulated write | item-write, line 77 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| ITEM-move-root-event-refused; $ | post-write event-refused; 1 simulated write | item-write, line 77 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| ITEM-move-data-event-refused; $.data | post-write event-refused; 1 simulated write | item-write, line 77 | R/C | R/C | R/C | O/C | O/C | R/C | R/C | R/C | none |
| ITEM-move-data-updateProjectV2ItemFieldValue-event-refused; $.data.updateProjectV2ItemFieldValue | post-write event-refused; 1 simulated write | item-write, line 77 | R/C | O/B | R/C | O/C | O/C | O/B | R/C | O/B | FC1 |
| ITEM-move-data-updateProjectV2ItemFieldValue-projectV2Item-event-refused; $.data.updateProjectV2ItemFieldValue.projectV2Item | post-write event-refused; 1 simulated write | item-write, line 77 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |
| ITEM-move-data-updateProjectV2ItemFieldValue-projectV2Item-id-event-refused; $.data.updateProjectV2ItemFieldValue.projectV2Item.id | post-write event-refused; 1 simulated write | item-write, line 77 | O/C | O/C | O/C | O/C | O/C | O/C | R/C | O/C | none |

#### Write preflight positions

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PRE-schema-column-board-container; $.data.repositoryOwner.projectV2 | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-schema-column-board-id; $.data.repositoryOwner.projectV2.id | pre-write; observed count 0 or 1 | read, line 89 | O/B | O/B | O/B | H/C | O/B | O/B | T/B | O/B | FC1 |
| PRE-schema-column-board-field; $.data.repositoryOwner.projectV2.field | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-schema-column-board-field-id; $.data.repositoryOwner.projectV2.field.id | pre-write; observed count 0 or 1 | read, line 89 | O/B | O/B | O/B | H/C | O/B | O/B | T/B | O/B | FC1 |
| PRE-schema-column-board-field-options; $.data.repositoryOwner.projectV2.field.options | pre-write; observed count 0 or 1 | read, line 89 | R/C | T/B | R/C | H/C | R/C | T/B | T/B | T/B | FC1 |
| PRE-schema-column-board-field-options-0-id; $.data.repositoryOwner.projectV2.field.options[0].id | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-column-board-field-options-0-name; $.data.repositoryOwner.projectV2.field.options[0].name | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-column-board-field-options-0-color; $.data.repositoryOwner.projectV2.field.options[0].color | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-column-board-field-options-0-description; $.data.repositoryOwner.projectV2.field.options[0].description | pre-write; observed count 0 or 1 | read, line 89 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-container; $.data.field | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-name; $.data.field.name | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-options; $.data.field.options | pre-write; observed count 0 or 1 | runners, line 306 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| PRE-schema-held-options-0; $.data.field.options[0] | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | T/B | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-options-0-id; $.data.field.options[0].id | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-options-0-name; $.data.field.options[0].name | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-options-0-color; $.data.field.options[0].color | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-schema-held-options-0-description; $.data.field.options[0].description | pre-write; observed count 0 or 1 | runners, line 306 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-item-move-board-id; $.data.repositoryOwner.projectV2.id | pre-write; observed count 0 or 1 | read, line 66 | O/B | O/B | O/B | H/C | O/B | O/B | T/B | O/B | FC1 |
| PRE-item-move-board-field-id; $.data.repositoryOwner.projectV2.field.id | pre-write; observed count 0 or 1 | read, line 66 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-item-move-board-field-options; $.data.repositoryOwner.projectV2.field.options | pre-write; observed count 0 or 1 | read, line 66 | R/C | T/B | R/C | H/C | H/C | T/B | T/B | T/B | FC1 |
| PRE-item-move-board-field-options-0-id; $.data.repositoryOwner.projectV2.field.options[0].id | pre-write; observed count 0 or 1 | read, line 66 | O/B | O/B | O/B | H/C | O/B | O/B | T/B | O/B | FC1 |
| PRE-item-move-board-field-options-0-name; $.data.repositoryOwner.projectV2.field.options[0].name | pre-write; observed count 0 or 1 | read, line 66 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-item-columns-container; $.data | pre-write; observed count 0 or 1 | runners, line 455 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-item-columns-project; $.data.project | pre-write; observed count 0 or 1 | runners, line 455 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-item-columns-project-field; $.data.project.field | pre-write; observed count 0 or 1 | runners, line 455 | R/C | R/C | R/C | H/C | H/C | R/C | T/B | R/C | FC1 |
| PRE-item-columns-project-field-id; $.data.project.field.id | pre-write; observed count 0 or 1 | runners, line 455 | R/C | R/C | R/C | H/C | R/C | R/C | T/B | R/C | FC1 |
| PRE-item-columns-target; $.data.target | pre-write; observed count 0 or 1 | runners, line 455 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| PRE-item-columns-target-name; $.data.target.name | pre-write; observed count 0 or 1 | runners, line 455 | H/C | H/C | H/C | H/C | H/C | H/C | T/B | H/C | FC1 |
| PRE-item-issue-container; $ | pre-write; observed count 0 or 1 | item-write, line 38 | R/C | R/C | R/C | H/C | O/B | R/C | R/C | R/C | FC1 |
| PRE-item-issue-node_id; $.node_id | pre-write; observed count 0 or 1 | item-write, line 38 | R/C | R/C | R/C | H/C | O/B | R/C | R/C | R/C | FC1 |

#### Write exit failure positions

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EXIT-comment-nonzero; $ | post-call exit; see call/write counts | repository-write, line 76 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-comment-signal; $ | post-call exit; see call/write counts | repository-write, line 76 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-comment-timeout; $ | post-call exit; see call/write counts | repository-write, line 76 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-comment-not-started; $ | post-call exit; see call/write counts | repository-write, line 76 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-prcomment-nonzero; $ | post-call exit; see call/write counts | repository-write, line 116 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-prcomment-signal; $ | post-call exit; see call/write counts | repository-write, line 116 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-prcomment-timeout; $ | post-call exit; see call/write counts | repository-write, line 116 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-prcomment-not-started; $ | post-call exit; see call/write counts | repository-write, line 116 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-label-nonzero; $ | post-call exit; see call/write counts | repository-write, line 122 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-label-signal; $ | post-call exit; see call/write counts | repository-write, line 122 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-label-timeout; $ | post-call exit; see call/write counts | repository-write, line 122 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-label-not-started; $ | post-call exit; see call/write counts | repository-write, line 122 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-close-nonzero; $ | post-call exit; see call/write counts | repository-write, line 142 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-close-signal; $ | post-call exit; see call/write counts | repository-write, line 142 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-close-timeout; $ | post-call exit; see call/write counts | repository-write, line 142 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-close-not-started; $ | post-call exit; see call/write counts | repository-write, line 142 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-remove-nonzero; $ | post-call exit; see call/write counts | repository-write, line 148 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-remove-signal; $ | post-call exit; see call/write counts | repository-write, line 148 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-remove-timeout; $ | post-call exit; see call/write counts | repository-write, line 148 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-remove-not-started; $ | post-call exit; see call/write counts | repository-write, line 148 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-open-nonzero; $ | post-call exit; see call/write counts | repository-write, line 131 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-open-signal; $ | post-call exit; see call/write counts | repository-write, line 131 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-open-timeout; $ | post-call exit; see call/write counts | repository-write, line 131 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-open-not-started; $ | post-call exit; see call/write counts | repository-write, line 131 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-merge-nonzero; $ | post-call exit; see call/write counts | repository-write, line 99 | R/C | R/C | T/B | R/C | R/C | R/C | R/C | R/C | FC1 |
| EXIT-merge-signal; $ | post-call exit; see call/write counts | repository-write, line 99 | R/C | R/C | T/B | R/C | R/C | R/C | R/C | R/C | FC1 |
| EXIT-merge-timeout; $ | post-call exit; see call/write counts | repository-write, line 99 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |
| EXIT-merge-not-started; $ | post-call exit; see call/write counts | repository-write, line 99 | R/C | R/C | R/C | R/C | R/C | R/C | R/C | R/C | none |

#### Settings selected positions

| Probe prefix and selected path | Stage | Selection source | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SETTINGS-root-local; $ | settings without reach; 0 commands | claude, line 219 | H/C | R/C | R/C | H/C | H/C | H/C | R/C | R/C | none |
| SETTINGS-root-reach; $ | settings with reach; 0 commands | claude, line 219 | H/C | R/C | R/C | H/C | H/C | H/C | R/C | R/C | none |
| SETTINGS-permissions-local; $.permissions | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-reach; $.permissions | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-allow-local; $.permissions.allow | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-allow-reach; $.permissions.allow | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-allow-0-local; $.permissions.allow[0] | settings without reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-permissions-allow-0-reach; $.permissions.allow[0] | settings with reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-permissions-deny-local; $.permissions.deny | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-deny-reach; $.permissions.deny | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-deny-0-local; $.permissions.deny[0] | settings without reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-permissions-deny-0-reach; $.permissions.deny[0] | settings with reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-permissions-ask-local; $.permissions.ask | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-ask-reach; $.permissions.ask | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-permissions-ask-0-local; $.permissions.ask[0] | settings without reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-permissions-ask-0-reach; $.permissions.ask[0] | settings with reach; 0 commands | claude, line 219 | H/C | U/B | U/B | H/C | U/C | U/B | R/C | O/B | FC5 |
| SETTINGS-enabledPlugins-local; $.enabledPlugins | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-reach; $.enabledPlugins | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-agents-md@builtin-local; $.enabledPlugins.cc-plugin-agents-md@builtin | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-agents-md@builtin-reach; $.enabledPlugins.cc-plugin-agents-md@builtin | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-telemetry@builtin-local; $.enabledPlugins.cc-plugin-telemetry@builtin | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-telemetry@builtin-reach; $.enabledPlugins.cc-plugin-telemetry@builtin | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-plugin-authoring@builtin-local; $.enabledPlugins.cc-plugin-plugin-authoring@builtin | settings without reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SETTINGS-enabledPlugins-cc-plugin-plugin-authoring@builtin-reach; $.enabledPlugins.cc-plugin-plugin-authoring@builtin | settings with reach; 0 commands | claude, line 219 | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |


#### Provider JSON sibling positions

The [provider sibling receipt](https://github.com/williacj/rigger/issues/1150#issuecomment-6523656015) quotes its full source, exact command and all 100 result records. It ran at the same measured main source, beginning 2026-10-30T13:11:01Z at one-minute load 7.37, and exited 0. C-A's source is signedIn at line 71 of `src/substrate/providers/claude.mjs`; X-P's sources are skillsIn at line 195 and probed at line 240 of `src/substrate/providers/codex.mjs`. The selected message, content container, part and text have separate cells, both alone and beside another valid skill block. There cannot be two JSON roots in one tool answer, so the companion-root position is excluded by JSON.parse at line 198; companion-message rows exercise the first member instead. A malformed selected member can be discarded when another block is valid, whereas an answer with no readable block is refused. Raw 1e999 text is preserved while adding that companion, so the non-finite cases are parsed as numbers, not null inserted by JSON.stringify.

Each prefix plus its kind column names an exact output record. H/C here is the adapter's explicit array/string selection and construction; it does not mean it validates ignored fields. O/B for C-A is its documented unknown answer, undefined, which is neither plain data nor a built failure under rule 4. The probe's stdout representation of that return is the word undefined; the function does not return that string. FC5 alone owns the 13 O/B cells in these two auth rows. The last receipt record also demonstrates Read(�) passed through the allow list with reach, completing the settings-byte stage's local/reached comparison without executing Claude.

| Selected provider prefix | Stage and position | Missing | Wrong | Null | Extra | Oversized | Deep | Not JSON | Non-finite | B owner |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-root | Claude auth answer; $ | O/B | O/B | O/B | H/C | H/C | O/B | O/B | O/B | FC5 |
| AUTH-loggedIn | Claude auth answer; $.loggedIn | O/B | O/B | O/B | H/C | O/B | O/B | O/B | O/B | FC5 |
| SKILL-single-root | only selected message; $ | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| SKILL-single-message | only selected message; $[0] | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| SKILL-single-content | only selected message; $[0].content | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| SKILL-single-part | only selected message; $[0].content[0] | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| SKILL-single-text | only selected message; $[0].content[0].text | R/C | R/C | R/C | H/C | H/C | R/C | R/C | R/C | none |
| SKILL-companion-message | with another valid skill block; $[0] | R/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SKILL-companion-content | with another valid skill block; $[0].content | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SKILL-companion-part | with another valid skill block; $[0].content[0] | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |
| SKILL-companion-text | with another valid skill block; $[0].content[0].text | H/C | H/C | H/C | H/C | H/C | H/C | R/C | H/C | none |

An [intermediate provider fixture run](https://github.com/williacj/rigger/issues/1150#issuecomment-6523656414) reused existing scratch homes and caught EEXIST before reaching Codex's parser. Its complete source and output are preserved, and it supplies no ruling. The corrected receipt uses a fresh retained directory and makes an unexpected setup failure exit nonzero.

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
| C-F, settings JSON | H/C [C-claude.settings.missing] | R/C [C-claude.settings.empty] | R/C [SETTINGS-bytes.truncated-string] | U/C [SETTINGS-bytes.invalid-byte-string; SETTINGS-bytes.deny-local; SETTINGS-bytes.deny-reach; SETTINGS-bytes.ask-local; SETTINGS-bytes.ask-reach; SETTINGS-bytes.allow-reach]; R/C [SETTINGS-bytes.invalid-byte-json] |
| X-F, agent file | R/C [X-F, line 305] | H/C [X-codex.files.empty-agent] | U/B [X-codex.files.not-utf8-agent] | U/B [X-codex.files.not-utf8-agent] |
| X-F, config file | H/C [X-F, line 274] | U/B [X-codex.files.empty-agent] | U/B [config truncated] | U/B [config invalid-utf8] |
| W, `.git` pointer file | R/C [W, lines 361–378] | R/C [W, line 372] | R/C [W, line 372] | H/C [W, lines 372–378] |

| TOML at X-F | Invalid TOML | Missing key | Wrong type |
|---|---|---|---|
| Config copied into child home | U/B [X-codex.files.not-toml] | U/B [X-codex.files.empty-agent] | U/B [config wrong-type] |

The settings-file invalid-byte cell has two parse paths. Byte ff inside the JSON string Read(…) is decoded to the replacement character by the UTF-8 read, then JSON.parse succeeds and invocation passes Read(�) in its CLI settings. That is U/C under rule 4's any-string text clause, not a refusal or a claim that UTF-8 was validated. The deny and ask lists are measured both with and without a reached directory. A bare ff byte outside a JSON string instead makes JSON.parse fail and is R/C; a truncated JSON string is also R/C. The selected-stage receipt quotes the exact input hex and resulting settings or failure. No provider command ran. The JSON list-member maps separately expose numbers, nulls and nested objects being passed as permission rules, and Infinity becoming null during JSON.stringify; those B cells belong to FC5.

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
| FC1, forge JSON boundary | All B cells in the direct F-R helper maps and the selected-field/stage tables whose B owner is FC1 | `src/substrate/forge/read.mjs`, `src/substrate/forge/schema-write.mjs`, `src/substrate/forge/item-write.mjs`, `src/substrate/forge/repository-write.mjs`, `src/substrate/forge/runners.mjs`; read.mjs and runners.mjs are Self-hosting paths | Estimate +220 L0; depends on owner handling of Self-hosting review and FC2's plain process result |
| FC2, process answer and table failures | All B cells in P-C and P-T text and exit maps | `src/substrate/process.mjs`; Self-hosting | Estimate +25 L0; depends on none |
| FC3, git structural answers | All B cells in W and D text, exit and file maps | `src/substrate/worktrees.mjs`, `src/substrate/data-ref.mjs`; worktrees.mjs is Self-hosting | Estimate +35 L0; depends on FC2 |
| FC4, launchd loaded program | All B cells in L text and exit maps | `src/substrate/launchd.mjs`; Self-hosting | Estimate +12 L0; depends on FC2 |
| FC5, provider files and answers | All B cells in C-A, C-F, X-A, X-P and X-F JSON, text, exit, file, TOML and directory maps | `src/substrate/providers/claude.mjs`, `src/substrate/providers/codex.mjs`; both Self-hosting | Estimate +55 L0; depends on FC2 |
| FC6, environment values | E-C missing HOME B cell | `src/substrate/providers/claude.mjs`; Self-hosting | Estimate +3 L0; depends on FC5 |
| FC7, human output | T1 and T2 | `src/substrate/process.mjs`; Self-hosting | Estimate +12 L0; depends on FC2 |

The table's cell sets are a partition. In the selected-field/stage matrices, each B cell belongs to the one owner in its row's B owner column: FC1 for every forge row and FC5 for every settings row; none belongs to another proposed card. The generator's explicit row-and-column ledger measured 1,488 B cells in that matrix: 1,464 assigned to FC1 and 24 to FC5, with no unowned B cell. The source and summary are in the linked receipt; these counts describe the fixture matrix at the named main commit.

Outside that matrix, FC1 owns direct answerOf missing, wrong type, null, extra, oversized, deep, non-JSON and non-finite; and direct board ID and repository ID missing, wrong type, null, oversized, deep, non-JSON and non-finite. FC2 owns P-C text control, escape, invalid UTF-8 and empty; P-C exit nonzero, signal and timeout; P-T text control, escape, invalid UTF-8 and empty; and the found ordinary P-T Map shape. FC3 owns W structural worktree text control, escape, invalid UTF-8 and missing field; the found ordinary W undefined lock; and D structural parent or commit control, escape, invalid UTF-8, empty commit and malformed SHA. FC4 owns L loaded program control, escape and invalid UTF-8. FC5 also owns the 13 B cells in the provider auth addendum, X-A all four text kinds, X-F agent truncated and invalid UTF-8, X-F config empty, truncated and invalid UTF-8, and all three TOML kinds. FC6 owns E-C unset HOME. FC7 alone owns print sites T1 and T2. No other row has a B cell.

FC1's estimate is a judgment based on shared checks at the seven REST parser sites, the GraphQL selectors, the write-answer selectors and their event-refusal checks. FC5's estimate includes permission-list members and their settings serialization. Both estimates are for L0 additions against the measured main row, not measured implementation sizes. Their dependencies in the table still apply; the expanded cells create no additional proposed fix card.

The recommendation is to card the seven disjoint fixes, with FC2 first, then reconcile their combined estimated +362 lines against the 127-line headroom before implementation. The PM should not assume a parsed JSON value is plain data, a UTF-8 decoding validates bytes, a git commit string is a SHA, or a process adapter's Buffer is plain data. A new source path, an authoritative contract proving a field intentionally unrestricted, a change to boundary rule 4 by the owner, or a budget measurement after other work lands would change the affected recommendation. Nothing in this report changes the architecture or creates a fix card.
