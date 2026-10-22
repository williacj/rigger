<!-- ABOUTME: Sets up Windows with Ubuntu on WSL 2 to run the experimental Linux test suite. -->

# Run the tests on Windows with WSL

Use Ubuntu on WSL 2 and keep the checkout, Node and dependencies in Linux. The
[README prerequisites](../README.md#prerequisites) own the Node floor and supported-host
promise. This is the test-only experiment in [#832](https://github.com/williacj/rigger/issues/832).
Engine and agent setup is separate work in [#822](https://github.com/williacj/rigger/issues/822).

## Install Ubuntu on WSL 2

[Microsoft's installation instructions](https://learn.microsoft.com/en-us/windows/wsl/install)
require Windows 11 or Windows 10 version 2004, build 19041 or later for these commands.
Open PowerShell as Administrator:

```powershell
wsl --install -d Ubuntu
```

Restart if requested. Open Ubuntu and create a Linux username and password. Password entry
does not display characters. Check the distribution in PowerShell:

```powershell
wsl --list --verbose
```

Its VERSION must be 2. If an existing Ubuntu distribution shows 1, convert it with
`wsl --set-version Ubuntu 2`. Use the exact distribution name printed by the list command.
Run every remaining command in Ubuntu's Bash terminal.

## Install the Linux tools

```bash
sudo apt update
sudo apt install -y bash build-essential ca-certificates curl git gh lsof perl procps psmisc util-linux xz-utils
```

These provide the C compiler and process tools the fixtures exercise. Ubuntu's lsof belongs
at /usr/bin/lsof; use the branch's host selection rather than making a /usr/sbin/lsof symlink.

## Install Linux Node

The following uses the official [Node downloads](https://nodejs.org/en/download) and verifies
the archive against the published checksum. It pins the version used for this experiment.
The x64 installation was exercised on Ubuntu 26.04.1; the arm64 selection has not been tested.

```bash
(
  set -eu
  node_version=v26.12.0
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64) node_arch=arm64 ;;
    *) echo 'No archive selected for this architecture.' >&2; exit 1 ;;
  esac
  node_archive="node-$node_version-linux-$node_arch.tar.xz"
  node_download=$(mktemp -d)
  cd "$node_download"
  curl -fsSLO "https://nodejs.org/dist/$node_version/$node_archive"
  curl -fsSLO "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
  awk -v archive="$node_archive" '$2 == archive { print }' SHASUMS256.txt | sha256sum -c -
  mkdir -p "$HOME/.local/opt"
  tar -xJf "$node_archive" -C "$HOME/.local/opt"
  printf '\nAdd this line once to ~/.bashrc, then open a new Ubuntu terminal:\n'
  printf 'export PATH="%s:$PATH"\n' "$HOME/.local/opt/node-$node_version-linux-$node_arch/bin"
)
```

After adding the printed export and opening that terminal, verify the tools:

```bash
command -v node npm git gh cc lsof
node -p 'JSON.stringify({version:process.version, platform:process.platform, arch:process.arch, executable:process.execPath})'
npm --version
```

The platform must be linux. Node must resolve inside your Linux home, with no Windows .exe
or /mnt/c installation supplying Node or npm.

## Clone and run

While #832 is unmerged, check out its experimental branch explicitly:

```bash
mkdir -p "$HOME/src"
git -c core.autocrlf=false clone --branch rigger-832 https://github.com/williacj/rigger.git "$HOME/src/rigger"
cd "$HOME/src/rigger"
git config core.autocrlf false
npm ci
npm test
```

Use a fresh Linux clone, with its own node_modules. The ordinary suite refuses calls to a real
forge or agent; running it requires no agent session or forge login. Explicitly gated live tests
can report skips with reasons. Success means exit status 0, fail 0 and cancelled 0 in the final
summary. A skip count alone does not establish success.

## Troubleshooting

| Symptom | Action |
|---|---|
| Node reports win32, or a command resolves under /mnt/c | Put the Linux Node bin first on PATH, reopen Ubuntu, and repeat the tool checks. |
| Shell reports `sh\r`, `bash\r` or bad interpreter | Clone in Linux with the command above. Keep Linux files as LF and install dependencies there. |
| Missing cc, lsof, pgrep or flock | Repeat the Linux tools installation and check command resolution. |
| Missing lockf on Ubuntu | Confirm the branch is rigger-832. Its Linux fixtures use flock; do not alias lockf. |
| A test fails or is cancelled | Keep the full output and record `git rev-parse HEAD`, `node --version`, `uname -a` and `cat /etc/os-release`. Rerun the named test using `npm test -- test/name.test.mjs`. |

The [verification journal](journal/2026-10-20-1646-832-linux-tests.md) records the measured WSL run.

For the native Mac procedure, see [testing on macOS](testing-macos.md).
