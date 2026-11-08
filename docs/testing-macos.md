<!-- ABOUTME: Sets up macOS development and CI tools and runs the repository's test tiers. -->

# Run the tests on macOS

The [README prerequisites](../README.md#prerequisites) own the Node floor and host promise.
This procedure covers repository development and both test tiers. Engine and agent installation is separate work
in [#822](https://github.com/williacj/rigger/issues/822). For the Windows experiment, see
[testing with WSL](testing-windows.md).

## Install the tools

In Terminal, request Apple's Command Line Tools and complete the installer:

```bash
xcode-select --install
```

[Apple's command line tools instructions](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
describe this installation. If the tools are already installed, use Software Update for updates.
Verify that the developer directory, compiler and Git are available:

```bash
xcode-select -p
cc --version
git --version
```

Install Node and npm from the [official Node download page](https://nodejs.org/en/download),
choosing the macOS installer for the version you intend to test and meeting the README floor.
Open a new Terminal after installation and verify:

```bash
command -v node npm
node -p 'JSON.stringify({version:process.version, platform:process.platform, arch:process.arch, executable:process.execPath})'
npm --version
```

The platform must be darwin. To reproduce a CI result, use that job's Node version from the
[CI workflow](../.github/workflows/ci.yml).

Install GitHub CLI using its [macOS installation instructions](https://github.com/cli/cli/blob/trunk/docs/install_macos.md).
If Homebrew is already installed, that procedure includes:

```bash
brew install gh
gh --version
```

The fixtures also use the system Bash, Perl, ps, lsof and lockf. Check their presence:

```bash
/bin/bash --version
/usr/bin/perl -e 'print "$^V\n"'
test -x /bin/ps && test -x /usr/sbin/lsof && test -x /usr/bin/lockf
```

## Clone and run

Check out `main` to test the merged repository:

```bash
mkdir -p "$HOME/src"
git clone --branch main https://github.com/williacj/rigger.git "$HOME/src/rigger"
cd "$HOME/src/rigger"
npm ci
npm test
npm run test:host
```

Use `npm test` for the ordinary deterministic tier. Run both commands above for the complete
check. The [host tier](../test/suite.sh) exercises real local processes and tools.

The runner refuses real forge and agent calls; neither command requires an agent session or
forge login. Explicitly gated live tests can report skips with reasons.

Complete-check success requires both commands to exit 0, each with fail 0 and cancelled 0 in
its final summary. A skip count alone does not establish success.

## Troubleshooting

| Symptom | Action |
|---|---|
| Missing compiler or invalid developer directory | Complete the Command Line Tools installation and repeat `xcode-select -p` and `cc --version`. |
| Wrong Node version or platform | Check `command -v node npm`, reopen Terminal after installation, and select the intended Node version. |
| Missing gh | Install GitHub CLI and verify `gh --version` in the same Terminal. |
| A test fails or is cancelled | Save the output and record `git rev-parse HEAD`, `node --version` and `sw_vers`. For a deterministic file, use `npm test -- test/name.test.mjs`; for a host-listed file, use `npm run test:host -- test/name.test.mjs`. Replace the illustrative path with the failing file. |
| File refused for being in the wrong test tier | Follow the runner's diagnostic; list current host files with `sh test/suite.sh --list host`. |

The setup installers above have not been executed on a Mac during this Windows-hosted work.
The [verification journal](journal/2026-10-20-1646-832-linux-tests.md) records the local setup limits.
The experiment's PR records historical macOS CI results for that PR's head. To verify the
checkout you are testing, inspect CI results for its exact commit; a result from a different
commit does not verify it.

## Staged CI

The [CI workflow](../.github/workflows/ci.yml) owns the job commands and event routing.
PR updates get ordinary tests and static checks on GitHub-hosted Ubuntu. Main-targeting
code PRs remain deferred at the required check until the repository owner explicitly
adds `ci:full` to an open, non-draft PR. Readiness and an existing label do not request
another full run. After updating the head or base, remove and re-add the label only
when the coherent batch is ready and hosted capacity is available.

A full candidate run executes ordinary and host tiers on the pool selected by its
plan, at the same recorded source. Jobs on the single Mini wait their turn. Non-main constituent PRs and eligible
direct regular journal additions/edits can receive fast feedback without that full
run; this does not waive their cards' evidence obligations before indirect merge.
Main pushes run portable smoke rather than repeating the full Mac proof.

Demo recording runs for relevant full batches, an explicit owner `ci:demo` PR label
request, and protected-main regression. Its existing Homebrew/VHS setup and artifact
checks remain. A requested demo cannot silently skip and still satisfy the aggregate.
Only regular additions/edits confined to direct journal files or to
`test/package-budget.test.mjs` are known recording exemptions; unknown and
mixed impact requires the demo.

Daily 03:00 UTC and explicit workflow dispatch run full regression of current
protected main. Dispatch has no custom ref inputs; a non-main dispatch is rejected.
Nightly and the candidate Mac jobs consume the same plan runner output.

Candidate jobs default to GitHub-hosted machines. Repository approval for external
contributors remains the trust boundary: review workflow changes before approving
fork runs. A PR can change workflow routing, so its conditions alone do not protect
a persistent runner from a malicious workflow writer.

Check the actual checkout SHA/tree, Node version, runner and selected required-check
result in the run records. A synthetic PR checkout is not the literal PR head.
Local controls and dispatch regression do not substitute for required candidate proof.

## Owner-enabled Mac routing

The owner sets the repository Actions variable `MACOS_RUNNER`. Enter the serialized
value, including the quotation marks shown here. Only the owner changes it; Auto
adds no delegation to a coordinator.

Before merge, coordinate Auto proof within a full-Mac quiet window across older
candidates and scheduled/dispatch consumers. The
[pre-Auto workflow at `93a24132`](https://github.com/williacj/rigger/blob/93a24132c9272670473ed576aa5efd00f8759e20/.github/workflows/ci.yml)
refuses `"auto"` for full/demo work. The repository variable affects those consumers
too, so only the owner enables Auto for the proof window and restores Hosted outside
it when proof is deferred or an older workflow needs CI. Coordinate the window
before any full-Mac request; a workflow condition is no substitute for that procedure.

After merge, inspect each candidate's actual workflow version before authorizing
more full-Mac work. Cached merge refs and older heads can retain the earlier
allowlist; merging this change does not update every candidate automatically.
Keep the same owner-controlled quiet-window procedure while such consumers remain.

| Value | Routing |
|---|---|
| Unset or empty | Hosted default. |
| `"macos-latest"` | Explicit Hosted. |
| `["self-hosted","macOS","ARM64","rigger-ci"]` | Explicit dedicated Mini; unavailable capacity leaves work queued. |
| `"auto"` | Mini when the bounded runner read establishes eligibility and availability; otherwise Hosted. |

Other values retain the workflow's refusal for trusted eligible Mac work. A fork or
unknown PR head stays Hosted before lookup. Invalid source, no Mac work and explicit
modes make no credentialed runners read. Routing never requests extra Mac work.
The [workflow](../.github/workflows/ci.yml) owns eligibility and accepted response details.

Auto reads the fixed repository runners endpoint once, with redirects refused and
no retries. Its signal covers fetch and body with the requested 30,000 ms deadline;
the response must be complete, unpaginated and within 2 MiB. Only the identified
Mini with its dedicated labels, online and idle, qualifies. Missing credentials,
busy/offline state, identity ambiguity and read errors choose Hosted with a fixed
`runnerReason`. Plan logs contain the serialized `selectedRunner` and reason;
`runner`, `runnerOS` and `runnerArch` still describe the executing machine.

The plan emits one snapshot for `full_ordinary`, `full_host`, `demo` and `nightly`.
A later busy/offline observation or network completion does not migrate queued jobs.
An explicit Mini selection can therefore wait after its initial observation. Auto
observes availability and does not reserve either pool or guarantee immediate service.

### Owner setup

Complete these private setup steps only after reviewing the concrete workflow.
The [D32 proposal](spec/decisions.md#d32--the-owner-may-enable-automatic-macos-ci-routing)
records the trust choice; `AGENTS.md` owns ratification and the protected-head marker.

1. Confirm that only the owner and the owner's agents can write repository workflows.
   Keep fork approval at `all_external_contributors`, approve no fork run, and verify
   the existing job-started hook on each self-hosted runner before selecting it.
2. In repository Settings → Actions → Runners, open `CJs-Mac-mini` and confirm its
   identity against runner id 23. Preserve `self-hosted`, `macOS` and `ARM64`; add
   custom label `rigger-ci` to that runner alone. Follow GitHub's
   [runner-label procedure](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels).
3. In personal Settings → Developer settings → Personal access tokens → Fine-grained
   tokens, create a dedicated token. Select resource owner `williacj`, repository
   access **Only select repositories**, and only `rigger`. Choose a finite expiry and
   repository **Administration: Read-only**, with unavoidable Metadata read and no
   write permissions. GitHub's [token procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
   owns the UI; the [repository runners endpoint](https://docs.github.com/en/rest/actions/self-hosted-runners#list-self-hosted-runners-for-a-repository)
   requires this read capability. Actions read alone does not supply it.
4. Store the value privately as repository Actions secret `CI_RUNNER_READ_TOKEN`
   under Settings → Secrets and variables → Actions → Secrets. Use GitHub's
   [secret procedure](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
   Do not place it in chat, a journal, command arguments, traces or captured headers.
   Do not reuse a registration token or the gate App key.
5. In a private terminal, authenticate one GET to
   `https://api.github.com/repos/williacj/rigger/actions/runners?per_page=100` with
   that dedicated credential. Use private input rather than a token literal in
   history; disable shell tracing and HTTP debug output. Retain the response and
   date, HTTP success, selected repository, permission and expiry metadata only.
   Confirm the complete runner list has id 23 with the expected identity and labels,
   and `rigger-ci` appears on no other runner. A read using another credential does
   not prove this credential's capability.
6. Once the authorized candidate procedure is ready, the owner may set the repository
   Actions variable to `"auto"`. Keep Hosted by removing the variable or selecting
   `"macos-latest"` when that is the intended mode. No setup step above changes it.

The dedicated secret reaches only the plan policy step under its own name. Ordinary
source collection still uses `GH_TOKEN`; worker jobs receive no dedicated credential.
Missing or withheld secrets choose Hosted. GitHub normally withholds repository
secrets from fork PRs and Dependabot runs. A step environment limits routine
propagation but does not isolate the secret from trusted repository workflow writers.

### Submission and candidate proof

Before an authorized label, dispatch or rerun submission, the coordinator records the
mode, dated queued/running work in both pools, and the intended run or attempt.
Observe current workflow runs and their jobs through the GitHub API; observe runner
status through the complete repository runners GET. Stop further submissions to a
pool observed backed up. Existing work finishes under the existing workflow policy.

If Auto could fall back into an occupied Hosted pool, wait or obtain an owner-authorized
explicit pool choice. The coordinator does not change `MACOS_RUNNER`. A Mini state
change, an independent schedule or new hosted work can race the observation. Record
performed submissions separately from the selector result; neither proves a global
capacity limit or an atomic reservation. Add no cancellation or concurrency policy.

For the card's final proof, retain separate Auto Mini and Auto Hosted full candidate
runs at the reviewed head, including required demo and `check (26)`. Record each
run's source SHA/tree, current candidate head, plan reason and actual API runner
names. The runs need not share a synthetic merge SHA or freeze main. Observe a
natural busy/read-unavailable fallback; do not shut down the runner or revoke a token
to manufacture one. Local controls and main dispatch do not replace candidate proof.

### Persistent state outside checkout

For each Mac job, record the exact source, pool, runner name and measurement time.
Run these path-only measurements before and after the job in an authorized runner
session; do not dump the environment or credential files. Treat the commands below
as a procedure, not a measurement already performed on the owner's Mac.

| Job | Outside-checkout inventory commands | Later reads to record |
|---|---|---|
| `full_ordinary` | `npm config get cache`; `printf '%s\n' "$RUNNER_TOOL_CACHE" "$RUNNER_TEMP" "$RUNNER_WORKSPACE"`; bounded `find` listings of those paths | setup-node tool cache, npm cache and any retained workspace state on the next job. |
| `full_host` | The same path inventory; inspect `$RUNNER_TEMP/containment-proof-26` and per-test temporary roots named by its output | Which host-test state survives teardown and whether a later job reads it; record missing paths as missing. |
| `demo` | `brew --prefix`; `brew list --versions vhs ffmpeg ttyd`; the same tool/temp/workspace path inventory | Installed Homebrew tools and their later reuse; distinguish exported demo artifacts from external state. |
| `nightly` | The ordinary and host inventories, plus package-budget temporary roots actually emitted by its commands | Tool/cache/workspace reuse and cleanup across the combined regression. |

Bound each `find` to an observed directory, for example
`find "$RUNNER_TEMP" -mindepth 1 -maxdepth 2 -type d -print`. Preserve the exact
command, native result and path listing. A checkout cleanup alone says nothing
about those caches, tool installations or temporary roots. Hosted images and a
persistent Mini have different lifetimes; record what the actual run establishes.
