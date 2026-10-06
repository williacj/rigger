ABOUTME: Journal for #674: an amended decision's status names the pull requests that amended it,
in place of the dates.

# #674 — an amendment cites its pull request, not its date

The owner asked what the amendment dates in the decision register were for, and ruled (P18) that
they go. Git already holds the date of every change. A pull request number leads further: to the
change itself, its judges' verdicts and the owner's ratifying merge.

The register's preamble now says an amendment adds `Amended in #NNN` after `Ratified`, and that a
later amendment joins its pull request after the earlier ones with `and`. `D7`, `D16` and `D21`
carried dates, and each now names its pull requests: #498 and #666, #282, and #319. Each number
came from `git log -S` on the dated text, then from the forge's answer for that commit's pull
request. #498 merged on 2026-10-01 and #666 on 2026-10-06, so `D7` lists them in that order.
