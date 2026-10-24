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

A full candidate run executes ordinary and host tiers concurrently on separate
GitHub-hosted Macs at the same recorded source. Non-main constituent PRs and eligible
direct regular journal additions/edits can receive fast feedback without that full
run; this does not waive their cards' evidence obligations before indirect merge.
Main pushes run portable smoke rather than repeating the full Mac proof.

Demo recording runs for relevant full batches, an explicit owner `ci:demo` PR label
request, and protected-main regression. Its existing Homebrew/VHS setup and artifact
checks remain. A requested demo cannot silently skip and still satisfy the aggregate.

Daily 03:00 UTC and explicit workflow dispatch run full regression of current
protected main on the existing personal Mac, with hosted demo recording. Dispatch
has no custom ref inputs; a non-main dispatch is rejected. No candidate PR is
intentionally routed to the personal runner. An offline personal runner leaves
regression queued; there is no automatic fallback or cancellation.

Candidate jobs use hosted machines and a minimal read token. Repository approval
for external contributors remains the trust boundary: review workflow changes before
approving fork runs. A PR can change workflow routing, so its conditions alone are
not a security boundary protecting a persistent runner.

Check the actual checkout SHA/tree, Node version, runner and selected required-check
result in the run records. A synthetic PR checkout is not the literal PR head.
Local controls and dispatch regression do not substitute for required candidate proof.
