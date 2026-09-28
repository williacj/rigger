ABOUTME: Journal for #359 (M2-S1a): two corrections to the merged M2-S1 report,
`docs/spikes/what-leaves-the-process-group.md`, from NB1 and NB2 of #355's round-2 review.

# #359 — the M2-S1 report's unnamed census entries, and its cargo heading

## What changed

- **NB1.** The sentence on the 36 and 40 unnamed census entries in Claude runs 3 and 4 said no
  `ps` sample held those pids, and judged them to be `sleep 1` children. The census names an entry
  from the latest `ps` sample only, so an unnamed entry means only that its pid was absent from
  that sample. The sentence now says so, and gives the measured counts: 35 of 36 in run 3 and
  38 of 40 in run 4 appear under a name in another census entry, one of run 4's being the
  survivor 6371. It no longer calls them a judgment.
- **NB2.** The cargo appendix heading now reads "of which 1 is a pid".

## Where the counts come from

The runs' raw records (`spikes/c335/`, gitignored) lived in #335's maker worktree, which was
removed after merge, so they could not be re-read. The counts are the ones
[#355's round-2 reviewer](https://github.com/williacj/rigger/pull/355#issuecomment-5861640410)
measured with `node -e` readers over those records, and the report cites that verdict.

As a cross-check, I parsed the report's own appendix census tables at base `061ee47` with a
throwaway script. Among entries with an empty name and "`ps` tracked this pid: no", run 3 has 36,
of which 35 share a pid with a named entry (the exception is 97588). Run 4 has 40, of which 38 do
(the exceptions are 36764 and 41178), and 6371 is among the 38. The appendix was generated from
the same records, so this agrees with the verdict without replacing it.
