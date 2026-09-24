ABOUTME: Spike findings for card #117 on command text the reserved-git hook cannot resolve.

# Indirect commands at the reserved-git gate

## Question and method

Should the PreToolUse hook refuse command forms whose executed Git command is absent from the command tokens it reads, or keep permitting those forms? This report proposes a choice; it changes no hook or recorded decision.

On 2026-09-23, I ran Git for Windows Bash 5.3.15(2), Node 24.18.0, and the live `.claude/hooks/refuse-reserved-git-commands.mjs` on this branch. A disposable `git` script was first on Bash's `PATH`; it appended its arguments to `/spikes/marker.log` and could not contact a remote. For each payload, the harness sent `{ "tool_name": "Bash", "tool_input": { "command": payload } }` to the hook and ran the payload separately under `bash -c`. The observation is the marker's output, not a guess from the shell text. The two controls passed first: bare `git push --force` wrote `git push --force` and the hook exited 2; bare `git status` wrote `git status` and the hook exited 0. All Bash runs below exited 0.

## What the hook missed

| Class | Payload, abbreviated | Bash marker | Live hook | Is the reserved Git spelling a command token the gate lexes? |
|---|---|---|---|---|
| Program expansion | `g=git; { $g push --force; }` | `git push --force` | 0, permit | No. `$g` is a token; its value `git` is not. |
| Command expansion through `eval` | `c='git push --force'; { eval "$c"; }` | `git push --force` | 0, permit | No. The assignment carries data, and the command runs `eval` with `$c`. |
| Flag expansion | `f=--force; { git push $f; }` | `git push --force` | 0, permit | No. `git` and `push` are tokens, but `--force` is supplied by `$f`. |
| Sourcing with `.` | `printf 'git push --force\n' > s.sh; { . s.sh; }` | `git push --force` | 0, permit | No. The executable Git command is in `/spikes/s.sh`; the payload's quoted spelling is `printf` data. |
| Sourcing with `source` | `printf 'git push --force\n' > s.sh; { source s.sh; }` | `git push --force` | 0, permit | No, for the same reason. |
| Interpreter one-liner | `{ perl -e 'system("git push --force")'; }` | `git push --force` | 0, permit | No. The Git spelling is inside a Perl source argument. |
| Third nested shell | `bash -c 'bash -c "bash -c \"git push --force\""'` | `git push --force` | 0, permit | Yes, if the inner `-c` argument is lexed. `objectionTo` stops recursing at `depth === 2`. At two levels, the same marker ran and the hook exited 2. |

The first six rows need values or another program's execution to decide what Bash will run. The last row is a finite reading limit. A raw substring match is not a substitute: the source rows contain the reserved bytes as data, and ordinary quotes or here-documents can contain the same bytes without executing Git.

## Two measured policies

**A. Keep the current text gate and state its limit.** It refuses directly readable reserved invocations and permits the rows above. It refuses no additional ordinary command. Its production count is **408** from `countProductionLines` over the live hook source. This keeps the current ordinary shell workflow, but the hook cannot be described as complete enforcement of `AGENTS.md`'s reservations.

**B. Refuse the unresolved forms before their values are known.** I built a throwaway variant that refuses raw text containing a variable expansion, `eval`, `source`, dot sourcing, or an interpreter `-e`/`-c` one-liner, and refuses a shell `-c` at the recursion limit. It is deliberately coarse: the raw scan does not distinguish quoted data from active syntax. Its production count is **410** from `countProductionLines` over that variant. The variant made the hook exit 2 on every row above, and still permitted bare `git status`. It is evidence for the immediate tradeoff, not a complete shell security design.

| Class | A: ordinary commands newly refused | B: ordinary commands newly refused, measured with Bash and the variant |
|---|---|---|
| Program expansion | None | `g=git; $g status` ran `git status`; variant refused. |
| Command expansion through `eval` | None | `eval 'echo ready'` printed `ready`; variant refused. |
| Flag expansion | None | `f=--dry-run; git push $f` ran `git push --dry-run`; variant refused. |
| Sourcing, both spellings | None | `printf 'echo ready\n' > s.sh; source s.sh` ran; variant refused. `printf 'echo ready\n' > s.sh; . s.sh` printed `ready` and was refused too. |
| Interpreter one-liner | None | `perl -e 'print 1'` ran; variant refused. |
| Third nested shell | None | Three nested `bash -c` invocations of `git status` ran; variant refused. |

I computed both counts by importing `countProductionLines` from `scripts/package-budget.mjs` and passing it the original hook text and the candidate text. The variant added two counted lines: a raw regular expression refusal just before `commandsIn(command)`, and a `depth >= 2` shell `-c` refusal in `objectionTo`. The throwaway files and marker remain under the gitignored `/spikes/` directory and are not part of this PR.

## Relation to card #84

The same Bash marker measured `echo $(git push --force)`, ``echo `git push --force` ``, and `( git push --force )`. Each wrote `git push --force`; both the live hook and option B exited 0 for all three. Closing this card's measured forms with option B therefore **does not close #84**. The substitution and subshell forms need their own reading or refusal policy.

## Recommendation and reversal

I recommend **A for now**, with an owner decision to narrow the hook's claim from complete control to a guard for command forms it can actually read. The evidence is six successful indirect executions under the current hook, one finite-depth bypass, the ordinary commands option B refused in every class, and the three #84 forms it still permits. A two-line raw refusal looks cheap in production lines while imposing a broad, fragile shell policy; its count does not measure that workflow cost.

Reverse this recommendation if the owner chooses to make the command gate fail closed on indirect shell execution and accepts the ordinary commands that must then be rewritten or routed for approval. That choice should cover #84 too and be tested against Bash with marker commands before a gate change claims complete enforcement. A separate execution or credential boundary that proves reserved Git operations cannot run would also reverse the need to choose between these two text policies.
