<!-- ABOUTME: Sets up a supported macOS host for both Rigger test tiers and agent dispatch. -->

# Bootstrap a Rigger macOS host

This guide sets up a macOS host to run `npm test` and `npm run test:host` and to run makers and judges. The coordinator remains on the primary host, and owner markers are posted from the primary host ([K31](https://github.com/williacj/rigger/issues/740#issuecomment-6290234702)). The product route for an owner verdict is `rigger verdict` from an installed, promoted engine version that implements that verb. The live gate pin below is the installation reference for the existing engine steps; a version at that pin does not thereby supply `verdict`. Do not promote the pin silently.

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

Set up only these host-local entries; the repository does not carry them:

| Entry | Supplier |
|---|---|
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
npm ci
npm test
npm run test:host
~~~

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
