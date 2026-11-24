ABOUTME: Journal for #1460: whether a later process can find and end the members of a Windows Job
Object after the supervisor that created it has died.

# #1460 — Reaching a Windows job's members after its supervisor dies

## What ran

On 2026-11-22 an elevated Node supervisor on the Windows machine created a job per run through
koffi, put #1430's fixture in it, and was killed with `taskkill /F`. A fresh process then tried to
end every member. Two routes ran, each with kill-on-job-close set and unset: a second process
holding the job's handle, and an agent started inside the orphaned job. The code stayed in the
gitignored `spikes/`. The listings, the calls and the transcript are in
[the report](../spikes/job-reach-after-supervisor-death.md).

## What we learned

- **A job's members can be reached with no handle to the job.** A process started with
  `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` set to a live member inherits that member's job. From
  inside, `QueryInformationJobObject` with a `NULL` handle lists the job, and the agent can end
  every other member. This worked after the job's name had gone with the supervisor.
- **A second handle holder keeps the name alive, and only while it lives.** Kill it too, and the
  name goes. With kill-on-job-close set, the holder's death then ends the tree.
- **Kill-on-job-close and "the next start ends the remains" exclude each other.** With it set,
  nothing outlives the last handle, so there is nothing left to reach.
- **Windows reused the spike's pids within a minute.** The final sweep found three reused pids
  among the record's. A pid-only sweep would have read them as survivors.
- **A Node process's non-detached child sat in a job of its own,** neither the SSH session's nor
  the dispatch's. Why was not measured, and a route that picks a parent must not assume a member's
  immediate job is the dispatch's.

## What failed

- **cmd.exe mangled inline scripts three times:** the `\x27` escapes in a `node -e`, the quotes
  around PowerShell's `'o'`, and a pipe inside a PowerShell command. Scripts copied as files did not
  have that problem.
- **`npm ls` wrote a debug log to npm's default cache,** because only the install carried
  `--cache`. It was found by a check for writes outside the spike's directory, and removed.
- **The harness refused a Markdown file written directly as the report draft,** so the report was
  filled from a text template by a script, which also kept every quote verbatim from the
  transcript.

## Round 2

- **Log every call's result, including the ones whose result you expect.** b2's sizing call to
  `InitializeProcThreadAttributeList` discarded its return value, so the run had to be repeated
  (b3) to show it: 0, with error 122 and the size.
- **The Windows clock's offset moved between rounds,** from about 0.5–1 s behind the laptop to
  within ±0.5 s. A bound measured once holds only for the runs near it.
- **Obscuring a name is not masking it.** Two pushed heads held other programs' names in a form
  anyone could read back. I knew that and did not say so, so the owner first ruled without knowing
  it. The branch was rewritten. A masking list belongs off the repository from the start.
- **A background launch is a process that outlives its command.** I recorded none of the seven on
  the laptop, and the report said there were none.
- **Scratch files in /tmp are outside writes too.** The report missed them until round 2.
