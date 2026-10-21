<!-- ABOUTME: Sets up macOS development tools and runs the repository's ordinary test suite. -->

# Run the tests on macOS

The [README prerequisites](../README.md#prerequisites) own the Node floor and host promise.
This procedure covers the ordinary test suite. Engine and agent installation is separate work
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

To test the unmerged compatibility experiment, select its branch explicitly:

```bash
mkdir -p "$HOME/src"
git clone --branch rigger-832 https://github.com/williacj/rigger.git "$HOME/src/rigger"
cd "$HOME/src/rigger"
npm ci
npm test
```

Success means exit status 0, fail 0 and cancelled 0 in the final summary. The ordinary suite
refuses real forge and agent calls. No agent session or forge login is needed for that run;
explicitly gated live tests can report skips with reasons.

## Troubleshooting

| Symptom | Action |
|---|---|
| Missing compiler or invalid developer directory | Complete the Command Line Tools installation and repeat `xcode-select -p` and `cc --version`. |
| Wrong Node version or platform | Check `command -v node npm`, reopen Terminal after installation, and select the intended Node version. |
| Missing gh | Install GitHub CLI and verify `gh --version` in the same Terminal. |
| A test fails or is cancelled | Save the output and record `git rev-parse HEAD`, `node --version` and `sw_vers`. Rerun the named file with `npm test -- test/name.test.mjs`. |

The setup installers above have not been executed on a Mac during this Windows-hosted work.
The [verification journal](journal/2026-10-20-1646-832-linux-tests.md) records the local setup limits.
The experiment's PR records macOS CI results for its exact head; a result from a different
commit is not verification of this branch.
