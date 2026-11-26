<!-- ABOUTME: Sets up a supported macOS host for both Rigger test tiers and agent dispatch, and
     states what a spike may collect and publish from a host it uses, on any operating system. -->

# Bootstrap a Rigger macOS host, and use any host for a spike

This guide sets up a macOS host to run `npm test` and `npm run test:host` and to run makers and judges, and it states what a spike may collect and publish on a host it uses that is a personal machine, whatever that host's operating system. A host without the private list can push nothing but a deletion through the hook; see [The pre-push content check](#the-pre-push-content-check). The coordinator remains on the primary host, and owner markers are posted from the primary host ([K31](https://github.com/williacj/rigger/issues/740#issuecomment-6290234702)). The product route for an owner verdict is `rigger verdict` from an installed, promoted engine version that implements that verb. The live gate pin below is the installation reference for the existing engine steps; a version at that pin does not thereby supply `verdict`. Do not promote the pin silently.

The [README prerequisites](../README.md#prerequisites) own the Node floor and supported host. Use a supported Node 26 runtime for this repository's verification. The historical versions in the next table were measured on 2026-10-19 on host key `macos-27.0.1-arm64-node26`, as recorded in [#816 Part 4, §9](https://github.com/williacj/rigger/issues/816#issuecomment-6291030802). They are observations of that host on that date, not current prerequisites.

| Tool | Use on this host | Historical measurement on that date and host |
|---|---|---|
| macOS | The supported v0 host (D13). | 27.0.1 (26A434), arm64. |
| Xcode Command Line Tools, including `git` and `/usr/bin/perl` | Git clones and hooks; the test runner's reaper uses Perl. | Apple Git 2.54.0 (Apple Git-157); Perl 5.34.1. |
| `/bin/ps`, `/usr/sbin/lsof`, `/usr/bin/mkfifo`, `/usr/bin/pgrep` and `/usr/bin/which` | Process inspection and host test fixtures. | Present; no versions recorded. |
| Node.js and npm | Install dependencies and run both test tiers and the engine. | Node 26.5.0; npm 11.17.0. |
| `gh` | Forge and board operations; authentication and Git's HTTPS credential helper. | 2.102.0. |
| Claude Code | Claude makers and judges. | 2.1.303. |
| Codex CLI | Codex makers and judges through the repository launchers. | 0.162.1. |
| Homebrew | Install tools such as `gh` and `vhs` where chosen. | No version recorded. |
| `vhs` | Demo cards labelled `area:demo`, through `rigger.config.mjs`. | Installed; no version recorded. |
| `/bin/bash` | Run `tools/coordinator/suite-slot.sh`. | No version recorded. |
| `caffeinate` | Keep a long local host test or dispatch awake when needed. | No version recorded. |
| `sysctl` | Supply the one-minute load read by the suite slot. | No version recorded. |
| `shasum` | Record a packed engine tarball's digest for an install receipt. | No version recorded. |

The historical `gh` token held `gist`, `project`, `read:org`, `repo` and `workflow`. `repo` serves the forge, `workflow` permits workflow-file pushes, `project` serves the board, and `read:org` was requested by `gh auth login`. No step here needs `gist`. The minimum sufficient scope set was not measured. The owner signs in to `gh`, Claude Code and Codex CLI as the owner's account; do not put their credentials in the repository.

## Turn off system sleep on AC power

A host running CI, a suite or agents unattended must have system sleep off on AC power. Have the
owner run:

~~~sh
sudo pmset -c sleep 0
~~~

`-c` sets the AC profile, so this setting does not cover battery. Read the setting back with
`pmset -g custom`; a held host shows `sleep` 0 under "AC Power".

The [owner's account on #1207](https://github.com/williacj/rigger/issues/1207) says the setting
alone did not stop an existing DarkWake cycle on the Mini. Logging in at the machine with its
keyboard and mouse ended that cycle ([M7-U34](https://github.com/williacj/rigger/issues/1009#issuecomment-6666909633)).
That account does not establish which other actions would end the cycle.

The Mini's `pmset -g log`, read on 2026-11-05 by the coordinator and PM and
[recorded on #1207](https://github.com/williacj/rigger/issues/1207), shows only the cycle ending
at a `Wake` line. A full wake shows in that log as a `Wake` line, not a `DarkWake` line.

## Lay out the checkout and local state

The main checkout belongs at `~/GitHub/rigger` and is never a workspace (AGENTS.md, “Version control”). With that checkout, the engine's default worktrees.root is `../rigger-worktrees`, relative to the checkout, as [ARCHITECTURE.md, “Engine settings”](../ARCHITECTURE.md#extension-points) defines. The engine's worktree root must stay outside both the checkout and the installed package.

The coordinator launchers use `RIGGER_WORKTREE_ROOT`, defaulting to `$HOME/GitHub/rigger-worktrees`. The two defaults coincide only when the checkout is at `~/GitHub/rigger`. If the checkout is elsewhere, set `RIGGER_WORKTREE_ROOT` to the resolved engine worktrees.root before running the launchers. This guide uses the canonical layout.

Install the tools above, then make a full-history clone. Do not use `--depth`, `--filter` or `--single-branch` for this clone.

~~~sh
mkdir -p ~/GitHub/rigger
git clone https://github.com/williacj/rigger.git ~/GitHub/rigger
cd ~/GitHub/rigger
git config core.hooksPath .githooks
git remote set-head origin -a
~~~

That `core.hooksPath` step runs the repository's hooks, so a host without the private list can push nothing but a deletion ([The pre-push content check](#the-pre-push-content-check)).

Set up only these host-local entries; the repository does not carry them:

| Entry | Supplier |
|---|---|
| System sleep off on AC power | Owner |
| User-level Codex configuration under `~/.codex/`, including project trust | Owner |
| Suite slot directory beneath `$HOME/GitHub/rigger-worktrees` | `tools/coordinator/suite-slot.sh` on first use |
| `gh` Git credential helper for HTTPS pushes | Host setup operator, by `gh auth setup-git` after owner sign-in |
| Git user.name and user.email | Owner supplies their values |
| `gh` sign-in as the owner's account with the scopes above | Owner |
| Claude Code sign-in as the owner's account | Owner |
| Codex CLI sign-in as the owner's account | Owner |

After the owner supplies Git identity values, set them using `git config --global user.name` and `git config --global user.email`. For an isolated proof HOME only, use the non-personal placeholders below; never substitute these for the owner's real identity on the host.

~~~sh
git config --global user.name Example
git config --global user.email example@example.com
~~~

## Verify both test tiers in a separate clone

Use an unused clone under the engine worktree root. This clone is separate from the main checkout and uses full history. Keep this order; the hooks and remote default are configured before dependencies and tests.

~~~sh
mkdir -p "$HOME/GitHub/rigger-worktrees"
git clone https://github.com/williacj/rigger.git "$HOME/GitHub/rigger-worktrees/bootstrap-check"
cd "$HOME/GitHub/rigger-worktrees/bootstrap-check"
git config core.hooksPath .githooks
git remote set-head origin -a
~~~

### Retained verification receipts

The shipped [TDD skill](../.claude/skills/tdd/SKILL.md) owns the mandatory reusable receipt
procedure. This section is an optional worked example; using the shipped skill does not require
this repository's bootstrap guide.

Keep fixtures disposable and required receipts durable. Store byte-complete originals in a
private directory outside the checkout, scratch clones, mutation worktrees, suite run roots and
OS temporary directories. Choose storage whose cleanup policy preserves them through the final
independent ruling on the claim, or the card's longer retention event. A path or digest without
readable original bytes is not retention. These rules also apply to reviewer-owned verification.

Run the following literal script setup in `sh` on macOS or WSL, from the test clone above.
The private evidence directory is separate from that clone and its fixtures. The example retains
command, executed ref, provenance, aggregate output and the actual tested-command exit for each
step. Aggregate output does not establish ordering between stdout and stderr.

~~~sh
umask 077
evidence_root="$HOME/.local/state/rigger/evidence/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$evidence_root"
cat > "$evidence_root/verify.sh" <<'SH'
#!/bin/sh
# ABOUTME: Retains bootstrap command outputs and tested-command exits outside disposable roots.
set -u
evidence_root=$1
git rev-parse HEAD > "$evidence_root/ref.txt" || exit 1
pwd > "$evidence_root/source.txt" || exit 1
node --version > "$evidence_root/node.txt" || exit 1
for step in dependencies deterministic host; do
  case "$step" in
    dependencies) set -- npm ci ;;
    deterministic) set -- npm test ;;
    host) set -- npm run test:host ;;
  esac
  printf '%s\n' "$*" > "$evidence_root/$step.command" || exit 1
  "$@" > "$evidence_root/$step.log" 2>&1
  tested_status=$?
  printf '%s\n' "$tested_status" > "$evidence_root/$step.exit" || exit 1
  test "$tested_status" -eq 0 || exit "$tested_status"
done
SH
sh "$evidence_root/verify.sh" "$evidence_root"
launcher_status=$?
printf '%s\n' "$launcher_status" > "$evidence_root/launcher.exit"
cat "$evidence_root/ref.txt" "$evidence_root/source.txt" "$evidence_root/node.txt"
cat "$evidence_root/"*.command "$evidence_root/"*.exit "$evidence_root/"*.log
~~~

Capture each tested-command status immediately, before another command overwrites it; retain it
separately from the launcher, transport or tool status. Missing or ambiguous tested-child status
earns no pass credit from green-looking text or wrapper success. The single-quoted heredoc keeps
`$?`, `$@` and other child expressions intact until the child shell executes them. Cross-shell
callers must pass the literal script file and its arguments directly, never interpolate its body
through the outer shell.

After the command and fixture teardown, reopen every required original before citing it as
retained. Repeat readback after removing a scratch clone if that cleanup occurs before ruling.
Keep receipts readable through the declared retention event. Report unreadable required originals
as missing evidence, never reconstruct their result from a prior pass summary. Do not put secrets
in receipts; give reviewers a private-safe access route and publish only permitted summaries,
never raw private logs or private paths.

The host key is the first line `sh test/suite.sh --host` prints. `npm run test:host` prints npm's own lines first, so its first line is not the key. The host tier uses real process and filesystem behavior; retain its actual outcome and test totals.

The repository ignores Claude Code's checkout-local permission allowlist through `**/.claude/settings.local.json`. Confirm the rule for both the checkout root and a nested directory with `git check-ignore -v .claude/settings.local.json x/.claude/settings.local.json`. The rule belongs to this repository's `.gitignore`, including when the per-run HOME has no user-level excludes.

## Install the pinned engine outside every checkout

Read `RIGGER_COMMIT` from the live [gate workflow](../.github/workflows/rigger-gate.yml). Its value identifies the installed engine source; this guide does not duplicate the hash. Keep both the install source clone and the installed package outside the main and test checkouts. The package goes under `~/rigger-builds`, outside the engine's worktree root. Never use `npm link` ([the installation rule](v0-build-plan.md#the-installation-rule)).

From the test clone above, run these commands in order:

~~~sh
RIGGER_COMMIT="$(sed -n 's/^  RIGGER_COMMIT: //p' .github/workflows/rigger-gate.yml)"
test -n "$RIGGER_COMMIT"
git clone https://github.com/williacj/rigger.git "$HOME/GitHub/rigger-worktrees/engine-source"
git -C "$HOME/GitHub/rigger-worktrees/engine-source" checkout --detach "$RIGGER_COMMIT"
mkdir -p ~/rigger-builds/engine
(cd "$HOME/GitHub/rigger-worktrees/engine-source" && npm pack --pack-destination ~/rigger-builds)
shasum -a 256 ~/rigger-builds/williacj-rigger-0.0.0.tgz
(cd ~/rigger-builds/engine && npm install ../williacj-rigger-0.0.0.tgz)
cat ~/rigger-builds/engine/node_modules/@williacj/rigger/src/package-commit.json
~~~

The `commit` in the installed src/package-commit.json must equal the gate's `RIGGER_COMMIT`. The owner then runs `~/rigger-builds/engine/node_modules/.bin/rigger doctor` against the main checkout, from the installed package, as [D7](spec/decisions.md#d7--the-engine-is-promoted-on-a-boundary-not-per-merge) requires. The owner changes to the main checkout first:

~~~sh
cd ~/GitHub/rigger
~/rigger-builds/engine/node_modules/.bin/rigger doctor
~~~

This is an owner step; a test-tier run does not prove it happened.

## Run the coordinator launchers

Start a Codex maker with `tools/coordinator/codex-maker.sh` and a Codex judge with `tools/coordinator/codex-judge.sh` from the main checkout. Their headers give the required card, branch, PR and round arguments and the supported environment variables. The related resume, retry, suite-slot and sweep scripts also carry their usage in their headers. The role prompts live under `.claude/agents/`. At dispatch, the coordinator supplies a Claude maker's or judge's start command and brief.

Run these launchers from the main checkout, never a card clone or any directory under the engine worktree root. Before pulling that checkout, use a read-only process-table check for every executable script under `tools/coordinator/`; matching each script's file name also finds a relative-path launch:

~~~sh
ps -axo pid=,command= | grep -E '([c]odex-(maker|judge|resume|retry)[.]sh|[s]uite-slot([.]test)?[.]sh|[s]weep[.]mjs)'
~~~

No matching script may be running when you pull. From `~/GitHub/rigger`, run `git pull --ff-only` only after that check shows no matches. A process the session did not start belongs to the owner; do not stop it to make a pull possible.

## The pre-push content check

`.githooks/pre-push` runs `.githooks/refuse-private-content.mjs`, which refuses a push that would publish content of four shapes or an entry of the private list. Its header names what it reads.

The list is one UTF-8 file, private-list in the .config/rigger directory under `HOME`, outside every checkout, on the owner's laptop, held by the owner. Each line is an entry; blank lines and lines that open with `#` are skipped, and an entry has at least four characters. It holds no name or handle the owner lets a commit carry. Only the owner edits it.

**Hosts.** The list is on the laptop only, so only the laptop can push through the hook. Any other host that runs the hook refuses every push with an update that is no deletion. A worktree of the laptop's checkout has that checkout's absolute path as `core.hooksPath`, so it runs that checkout's copy: a branch's edit has no effect there, and merging is not enough until that checkout holds the change. A clone whose `core.hooksPath` is relative, as the Codex launchers set it, runs its own branch's copy.

**Limits.** The check does not see past any of these:

- the web editor, API commits, the forge's own merge commit, CI logs, the engine's data-ref push, which uses `--no-verify`, a push to another repository or gist, and a host without the hook;
- a clone that runs its own branch's copy, where that branch edits the check or was cut before it;
- a default-branch tracking ref that did not come from that remote, which can pass content unread;
- `HOME`, `PATH`, `GIT_*` and `core.hooksPath`, which can redirect it;
- base64, hexadecimal, an image, an archive, a listing with no header or a translated one, a file split to stay under the evidence size limit, and a list that is out of date.

A clean result is no privacy check under the next section.

## Spikes on a personal machine

A spike card that adopts this section is what binds: its maker finishes against that card's
acceptance, and its judges rule on it. This guide binds nobody by itself.

1. **Terms.** A personal machine is a host a person signs in to. Private content is an identifier
   of a person, account, device, network or organisation, and any record of a process, service,
   file or setting the spike did not start or make. An identifier is private inside the spike's
   own rows and paths too. These are publishable:
   - operating-system and tool versions, and the architecture;
   - the host key `npm run test:host` prints;
   - facts the card predeclares;
   - this repository's owner and name, the logins that work on it, and the commit identity the
     owner configured;
   - the owner's laptop login name, and paths under its home directory, in citations and evidence;
   - public product and vendor names.

   The entry for the owner's laptop login name and home paths makes no other account, device or
   name publishable, in such a path or elsewhere. Work may link a comment of this repository that
   was public before #1485's rules, as linking it is not publishing. Copying private content out of
   such a comment stays barred.
2. **Collection.** This rule binds the output of a command run to make evidence or to look at the
   host. The filter runs inside the command, so nothing unfiltered reaches a file, the terminal or
   the agent's context. A private identifier in the spike's own record becomes a fixed placeholder
   as it is captured. That breaks no acceptance item that asks for a command or an output exactly.
   No listing of a host's processes, services, accounts or directories is captured at all.
3. **Leftover check.** It reports a count of matches. It also reports the recorded pid, start time
   and exit of each process the spike recorded at its start.
4. **Archive.** The spike's captured records are kept on the owner's laptop, held by the owner,
   with owner-only permissions, in no repository.
   - A capture on the laptop goes straight to the archive.
   - A capture on another host waits in a private directory outside every checkout. It is copied
     to the archive and read back there. The maker then removes it from that host, before the
     first push.
   - The archive is kept until the card's final independent ruling or the card's longer event.
   - Verification receipts stay under the [TDD skill](../.claude/skills/tdd/SKILL.md).
5. **Limit of the permissions.** Agents run as the owner's account (`R-SAFE-4`), so the
   permissions do not hold them out. The maker opens the archive only to write and read back its
   own capture. A checker or judge opens it only for an item it was given. A judge may ask, by
   rule 11's channel, for any other item of that card's (`R-EVIDENCE-2`).
6. **A judge's access.** The owner grants it through the coordinator. It is never posted, and it is
   shown to work before judging. A card that uses private material is judged by hand, on the laptop.
7. **Private material.** It is captured records, never an agent session's transcript or its log
   (`R-EVIDENCE-4`). A maker, checker or judge who finds that a file in the archive is an agent
   session's transcript or its log sets it aside: it stops using the file, and tells the coordinator
   in a message that is not posted. It goes on with the rest of its work, whether or not that file
   holds private content. Rule 11 does not apply to that file. Until the owner rules, no maker,
   checker or judge removes such a file or opens it as evidence. No claim rests on such a file.
8. **Naming it.** The report lists each private item by a sequential id and the acceptance items it
   supports, and by nothing else. A verdict cites that entry by its path at the head, and gives the
   id, the acceptance item's ordinal, and "establishes" or "does not establish". That is what a
   judge gives for private material under the [code-review skill](../.claude/skills/code-review/SKILL.md)'s
   step 7, "Findings", and "What you return", item 2. The report lists each file rule 7 sets aside
   by an id of the private items' sequence, as found barred, and as removed if the owner has it
   removed, and by nothing else.
9. **Privacy check.** Someone who is neither the maker nor a judge of the card makes it, before the
   branch's first push. An image, archive or encoded blob is opened or removed. The checker reads
   each of these, for each class of private content in rule 1:
   - every file as committed;
   - each commit message, and the branch name;
   - the author, committer and tagger fields, of which only the configured identity passes;
   - the drafts of the pull request's title, body and report.
10. **Its result.** The result is a comment on the card, posted only on a pass. It gives the head's
    SHA and the reader's role. Each later head has a result before it is pushed, which reads what
    is new since the head that last passed. The pull request's text as posted equals the draft. A
    push's time is read from the forge's activity record, `gh api repos/{owner}/{repo}/activity`.
    For a card that adopts this section, a head does not meet the card where:
    - it has no result;
    - its result has another SHA;
    - its result was posted after the push; or
    - its result was edited since.
11. **Private channel.** A maker, checker or judge who finds private content stops, and tells the
    coordinator in a message that is not posted. The coordinator takes it to the owner's
    interactive session.
    - A maker's message is its escalation, category `critical`. A maker never redacts and continues.
    - A judge's message is no escalation (`R-ESCALATE-4`). The judge returns its verdict in full in
      that message, and the verdict is posted when the owner rules.
    - Until the owner rules, nothing is pushed, posted, edited, deleted, closed, force-pushed or
      re-run.

    A maker, the privacy checker or a judge may read a comment of this repository that was public
    before #1485's rules and go on. Such comments themselves are left for the owner's separate
    cleanup decision. A maker, the privacy checker or a judge who finds content copied out of such a
    comment still stops.
12. **Posts.** A post about such a spike by its card's author, maker, checker, judges or coordinator
    holds the published set or a neutral sentence. No spike evidence is produced in a CI job.
13. **Adoption.** A spike card that uses a personal machine says that it adopts this section, names
    its checker, and predeclares its publishable facts and the private items an acceptance item
    rests on. It carries three acceptance items, one condition each:
    - the judged head has a rule 10 result, posted before that head was pushed and not edited since;
    - the report lists each private item, and each file rule 7 sets aside, as rule 8 says;
    - the pull request's text and files hold no private content as rule 1 defines it.
