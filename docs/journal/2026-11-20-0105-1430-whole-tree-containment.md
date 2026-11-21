ABOUTME: Journal for #1430: whether cgroup v2 under WSL2 and Job Objects on Windows end an agent's whole
process tree, against the macOS baseline and today's route.

# #1430 — Whole-tree containment on Linux under WSL2 and on Windows

## What ran

On 2026-11-20 a throwaway fixture ran on three hosts: macOS on the laptop, Ubuntu 26.04 under WSL2,
and native Windows. The fixture was six sleeping members, two of which left the session and one of
which moved to `/`. Each host ran it under each ending the card names. The code stayed in the
gitignored `spikes/`. Its source, every listing and the transcript are in
[the report](../spikes/whole-tree-containment.md).

## What we learned

- **A cgroup cost nothing on this WSL2 host.** systemd was pid 1, and the user manager handed an
  unprivileged user a writable cgroup through `systemd-run --user -p Delegate=yes`. `cgroup.kill`
  ended every member in 1.66 ms. An orphaned cgroup stayed reachable by its path after the
  supervisor died.
- **The shell `wsl.exe -e` starts is outside systemd's tree.** It sits in `/non-systemd`, owned by
  root. A delegated cgroup needs the user manager to start the process, or a scope to move it.
- **A Windows job's name dies with its last handle, not with the job.** Without kill-on-job-close,
  the members outlived the supervisor in a job that no fresh process could open.
  `OpenJobObjectW` failed with error 2.
- **Today's route misses a process that leaves the session and the dispatch directory together.**
  M6 survived the group kill and the census on macOS and on Linux alike.
- **The SSH session is itself a job on Windows,** and it ended every survivor on disconnect.
  Windows readings taken over SSH must finish inside one session.
- **systemd's default `KillMode` sends `SIGTERM`,** which the member that ignores it survived.

## What failed

- **`cmd.exe` ate the arguments of the first WSL run,** and broke one inspection command at its
  pipes. After that, every WSL command went in as a script on stdin.
- **A polling loop waited for `populated 0` from a cgroup that systemd had removed,** and spun until
  I ended it. WSL's pid counter advanced by about 101,000 while it ran (2377 to 103714). The rerun's loop also stops when the
  cgroup is gone.
- **`supervisor.js` would not load,** because the repository's `package.json` sets
  `"type": "module"`. Throwaway CommonJS in `spikes/` needs the `.cjs` extension.
- **A non-elevated Windows run could not be made.** `runas /trustlevel` failed over SSH, so every
  Windows reading is from an elevated supervisor.

## Round 2

- **"Every process" means every pid, and that has to be designed in before the run.**
  - Round 1 recorded only the long-lived processes, and the judge was right that synchronous
    helpers and M4's parent are processes too.
  - Round 2 recorded each spawn in Node, made the fixture write its own pids, and ran a WMI
    process-start watcher on Windows.
  - Even so, the measuring sessions themselves cannot be fully recorded, and the report names what
    is left.
- **A watcher must outlive the events it is meant to catch.** Check A stopped the Windows watcher
  before WMI had delivered check A's own start events.
- **A command log is cheapest to produce from the session record.** Round 1's hand-kept
  appendix could only give time windows. The retained tool-call record gives exact inputs, times
  and outputs.
