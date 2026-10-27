<!-- ABOUTME: Records the temporary hosted Mac evidence carrier for the #822 bootstrap guide. -->

# Host bootstrap evidence carrier

The continuing #822 acceptance permits a separate unmerged branch for one supported macOS proof run. This commit carries the temporary workflow and this journal. Its parent is the frozen guide head b8618111756dcea584d876ec084728fd9632ee85. These two files are excluded from the final documentation PR.

The workflow checks its source commit, sole parent, guide tree and blob, two-path carrier diff and gate pin before it attempts bootstrap. It runs the guide's ordered clone, hooks, remote-head, install and test commands in isolated homes on a GitHub-hosted Mac. It retains original output and command statuses as an artifact. The source and workflow require independent review before a push; no test or proof result is claimed by creating this commit.

Live account sign-ins, credential-helper push, owner doctor and verdict remain unexercised in this carrier. The final documentation PR will report those limits alongside the actual supported-host receipts.
