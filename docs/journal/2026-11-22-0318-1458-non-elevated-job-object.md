ABOUTME: Journal for #1458: whether a Windows supervisor below High Mandatory Level can end an agent's whole process
tree through a Job Object, by ending the job and after being killed outright.

# #1458 — A non-elevated Windows supervisor and a Job Object

## What ran

On 2026-11-22 a throwaway supervisor ran on the Windows machine as a dedicated standard account,
`fx1458`, at Medium Mandatory Level. The owner's ruling allowed the account, and it was deleted at
the end. The supervisor held #1430's fixture in a Job Object, and ended it by `TerminateJobObject`
(two runs) and by being killed with `taskkill /F` under kill-on-job-close (two runs). The code stayed
in the gitignored `spikes/`. Its final form, the transcript and the process record are with
[the report](../spikes/non-elevated-job-object.md).

## What we learned

- **Elevation was never what made Job Objects work.** At Medium, every call returned success:
  creating the job, setting kill-on-job-close and assigning the root. Both endings ended every
  member, as they did elevated in #1430.
- **Nested jobs are the normal case.** The supervisor was already in a job before it made its own,
  in every run, and the assignment still succeeded.
- **This host's sshd admits one key-holding administrator only.** `AllowUsers cj`, public key only.
  A second account cannot log in over SSH without a host-configuration change, so the account
  was reached through the secondary logon service instead.
- **A process started as another account in an SSH session cannot use that session's window
  station.** It died at once with `0xC0000142`. A window station and desktop that the launcher
  made, with a DACL naming the account, fixed it.

## What failed

- **`GetTokenInformation` refuses a fixed-size class unless given its exact size.** The first
  launcher passed 1024 bytes for `TokenElevation` and threw before it started anything.
- **koffi's `package.json` is not exported,** so `require('koffi/package.json')` fails. Read the file
  from the package's directory instead.
- **A listing that prints process names leaks what the owner runs.** The first laptop sweep was
  redacted and rerun with pids and start times only. In a public repository, a sweep should print
  only what it is asked to show.
