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

## GitHub-hosted CI

The [CI workflow](../.github/workflows/ci.yml) selects GitHub-hosted `macos-latest`
runners for `check` and `demo`. The `check (26)` job runs the test tiers and budget
and document checks. The demo job installs `vhs` with Homebrew when needed; its
recording uses `vhs`, `ttyd` and `ffmpeg` on the job's `PATH`. These jobs do not
require the owner's personal Mac to be online or configured as a runner.
