ABOUTME: A journal entry from card #33: Four of this card's own checks could not have failed

## 2026-09-22 — Four of this card's own checks could not have failed

`init` forks the templates, and this repository's `.claude/` is what it forked, so the card came
down to one question: what refuses a divergence between the two. That part was easy to write and
easy to trust once each kind of divergence had been made and watched red. The expensive part was
everything around it: four checks were written that could not have moved, and the one that could
redded on a file that was never an asset.

The first was a tautology. The second-run test compared the files on disk with the files on disk,
and passed whatever `init` had done to them. Capturing the bytes before the second run and reading
them back afterwards is what made it a test.

The second passed vacuously, and writing it up is how the worst version of the same mistake got
made. Two tests looped over what `plan` said `init` would write and asserted each file had
arrived. Deleting the fork entirely left `plan` naming the config and nothing else, and the loops
agreed: one file, present, green. An expectation derived from the production algorithm agrees with
that algorithm whatever it says. Four paths written out by hand fixed **one** of the two, and this
entry then said the vacuity was fixed — of a class, in the singular, while the second member of
it stayed exactly as it was and a judge found it. A fix written up as a lesson reads as a fix
applied everywhere it was found, so the count belongs in the sentence: two tests had the shape,
one was fixed.

The third was a guard nothing could move. `repoSlug` reads git's status before its output, and
removing that read moved no test either way: git run and refusing prints nothing, so the parse
answers with nothing too. The guard earns its line for a case that is not that one — a host with
no git to run answers with no stdout at all, which throws on being read — and reaching it needed
`PATH` emptied. Two edges that look like one case, told apart only by asking.

Two smaller things. A refusal written in the same breath as the walk it guards had to be removed
again to see its test fail, which is the cost of writing more than the test demanded. And the
report dropped its own count when the count was zero, because the heading was built with the list
it headed; a second run said what it had skipped and never said it had written nothing.

The check itself had the defect it was written to prevent, one layer up. It asked the filesystem
what this repository holds under `.claude/`, so `.claude/settings.local.json` — which Claude Code
writes by itself the moment a permission is approved — read as an asset with no template and
redded the suite. A red suite is a commit and a push refused by the pre-commit hook, so the check
would have stopped work in this repository while blaming a drift that did not exist. No ignore
rule can fix it, and that is the instructive part: a walk consults none, and the file is ignored
only in the owner's personal ignore file, which is itself evidence it turns up here routinely.
Git owns what a repository holds, so `git ls-files` is the question to ask; the index rather than
`HEAD`, so a staged asset counts and the answer is true at the moment the hook runs.

A `D16` record carried a number nobody ran. The entry beside `repoSlug` listed git's status at
four edges, and one of them was wrong: a repository with no `origin` answers **2**, not the 128 a
directory that is no repository answers. One edge was measured and its neighbour's number written
beside it, in the record whose whole purpose is that a bound is measured rather than guessed. It
reached the pull request and a report as measured, twice. Anything with a digit in it is a claim
about a run, and a run takes one command.

And one dodged. A mutation run to prove a test discriminates silently did not apply, so the
experiment reported green for the reason it always would have and the conclusion drawn from it
would have been invented. Asserting that the mutation landed costs one line and is the difference
between an experiment and a story about one.

The standing consequence is a routing one, and it is the owner's to settle rather than this
card's: an edit to a role prompt, a skill or a hook now belongs in `templates/`, and the copy
under `.claude/` follows from it. Cards #76, #80, #85, #91 and #93 all edit assets under
`.claude/`. Nothing about them was changed here, and the check names both files when they
disagree.
