ABOUTME: Records how card 702's gate check script and workflow were built, the two L0 facts the
first acceptance lacked, and what the workflow assumes but has not yet run against.

# The gate check and its workflow

The acceptance at its first dispatch had the script map a comment on a pull request to its card
and run the form check, but L0 answered neither a pull request's head branch nor an issue's title.
The `issue_comment` payload names no head ref, and the item reading the card from the forge ruled
out the event's title. The maker escalated as `ambiguous` before writing code. The PM amended the
card with the coordinator's option A: `readPullRequestByNumber` answers `branch`, `readIssue`
answers `title`, each from a capture taken on 2026-10-12 with gh 2.99.0.

The script has three modes, so the workflow's first job can key the concurrency group on the card
while the posting job reads every fact after it starts: `card`, `map` and `rule`. Every pull
request's branch comes from L0, so no step reads `github.event.pull_request.head.*`. The config is
read from the default branch at the commit read at the run's start (P46), written to a temporary
directory and loaded through `consumerConfig`, so the one dynamic import stays doctor's.

The workflow's steps were run under bash in the suite with stand-ins for the gate check and for
curl, and its Node check with a stand-in node. The mint step was not run: nothing in the suite
holds an App key, and no run of this workflow on the forge has happened yet. Its shape follows
#701's `s2-gate.yml`, which minted and posted on all 30 measured runs on ubuntu; this one runs on
`macos-latest`, whose image lists OpenSSL 3.6.4, curl 8.7.1 and Node 24.20.0.

The two scripts were written before their tests, against the TDD rule. The maker offered guarded
mutations instead, logged in the pull request, and the coordinator put that departure to the
judges. One template mutation, taking the state from the reason rather than the exit status,
survived the first posting test; that test now holds a non-zero exit with no reason printed.
