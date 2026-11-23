ABOUTME: Journal for #1459: whether an unprivileged Linux supervisor under WSL2 ends an agent's whole tree with cgroup.kill
when its user has no login session.

# #1459: Whole-tree containment with no login session

## What ran

On 2026-11-22, #1430's fixture ran under WSL2 for a dedicated user created for the card, `rigger-spike`. It ran under
three routes: R0 (no linger), RL (linger set) and RS (a system unit). It ran three cases: no session at start (N1), the
last session closing while the tree runs (N2), and the supervisor killed outright with no session, followed by a fresh
writer (N3). The code stayed in the gitignored `spikes/`. Its source, every listing, the transcript and the process
record are in [the report](../spikes/whole-tree-without-a-session.md).

## What we learned

- **No linger and no system unit means no containment once the user logs out.** With no session, the supervisor sits in a
  root-owned cgroup. If it started under a session, the user manager's stop kills the whole tree about 10 s after the
  last session closes. That is systemd acting, not Rigger.
- **Linger or a system unit makes `cgroup.kill` work with no session,** in N1, N2 and N3 alike, in under 2 ms. Under a
  system unit, only the child cgroup the supervisor makes is the user's. The unit's own `cgroup.kill` stays root's.
- **WSL2 stops the distro 10 to 20 s after its last `wsl.exe` client exits,** whatever runs inside it. An SSH login into
  WSL does not keep it up, and neither does linger.
- **A WSL login session outlives the command that opened it.** It stays open until something terminates it, or until
  the distro stops.
- **A host the owner uses is not empty.** A tool of the owner's logs into WSL at every distro start. A spike that needs a
  user with no session needs a user of its own, and that needs the owner's ruling first.
- **A full process listing is the owner's private data.** Quoting whole listings from the owner's machines in a public
  repository published every program running there. Evidence needs each row's pid and creation time, and the names only
  of the spike's own processes. Mask by what may stay, before anything is pushed.

## What failed

- **An interop `powershell.exe` ate the rest of a script fed to `bash -s`.** Every script now runs its body as a function
  with stdin from `/dev/null`.
- **After one `terminate-session`, WSL opened no new login session for that user in the same distro instance.** Two N2
  runs therefore did not count, and were rerun in fresh instances. That meant deleting the user too early, then
  recreating it.
- **A process scan by cgroup recorded someone else's processes.** Scanning by the spike's own tree fixed it, and the bad
  lines were voided with a note rather than deleted.
- **Four Windows listings that fed PowerShell a long stdin hung** and left their sessions running. Those sessions were
  not recorded at start, so they went to the owner instead of being ended.

Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is
withheld for privacy (1459#7104456293).
