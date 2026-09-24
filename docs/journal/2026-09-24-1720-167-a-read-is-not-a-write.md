ABOUTME: Card #167: which surfaces `GIT_ALTERNATE_OBJECT_DIRECTORIES` and
`GIT_CEILING_DIRECTORIES` move, why neither reaches a write, where the starting hypothesis was
too generous to one of them, what the readability finding does and does not bear on, the red
that stood on `main` while this was measured, and how round 1's own tests reinstated the fault
the module under test exists to prevent.

# 2026-09-24 — A read is not a write, and a withheld repository is not a redirected one

Neither variable is added to `REDIRECTING`, and the measurement that settles it separates two
questions card #151 had no reason to separate. Every figure below is measured with git
2.55.0.windows.5 and Node v24.18.0 on Windows 11 Pro 10.0.26200, against a fresh clone of
`origin/main` at `8dd7950` on branch `m0/167-alternate-objects-ceiling-dirs`, with each candidate
set to a throwaway second repository's paths and the surfaces of `git -C <named>` compared against
the same surfaces with nothing set. The six surfaces are the ones
`src/substrate/git-environment.mjs` names — the git dir, the common dir, the top level, the object
store, `HEAD` and the index — read off that docstring's claims rather than from a list card #151
wrote down, because the card recorded the results of the comparison and not the comparison's
inventory. That reconstruction is a judgment about which six were meant, and it is worth a reader
checking it against the docstring before leaning on the word "six" here.

`GIT_ALTERNATE_OBJECT_DIRECTORIES` moves none of the six and does move a seventh. Set to the
second repository's `.git/objects`, all six surfaces of the named repository answered exactly as
they did with nothing set. Outside them, object readability moves: `git cat-file -e` naming a blob
only the second repository holds exits 1 with nothing set and exits 0 with the variable set, and
`git cat-file -p` on that blob prints the second repository's content. So PR #155's judge was
right that this one reaches past the six, and right about where.

`GIT_CEILING_DIRECTORIES` moves nothing at all in the shape the card prescribes, and that is a
correction to the starting hypothesis rather than a confirmation of it. Set to a second
repository's paths it moved none of the six, and it moved no surface outside them either —
readability did not move, and repository discovery did not move. It bites only when it names an
ancestor of the directory git runs in, and what it does there is stop the upward search, so git
names no repository rather than a different one. Measured across a repository nested inside
another, which is the arrangement where a redirect would have had somewhere to go: from
`inner/a/b`, with nothing set and with the ceiling at `outer`, git resolved `inner/.git`; with the
ceiling at `inner` or at `inner/a`, git exited 128 with `not a git repository`. A ceiling can only
shorten the walk, so its reachable outcomes are the nearest repository or none — never a farther
one. The judge's observation holds for the first variable and not for this one, and the card was
right to ask for the measurement rather than the inheritance of the note.

Neither reaches a write, which is the separate question and the one the decision turns on. With
each variable set to a throwaway second repository, that repository was fingerprinted
file-by-file with a sha256 per file before and after each of fifteen write shapes — `commit`,
`gc --prune=now`, `prune -v --expire=now`, `repack -a -d`, `fsck`, `checkout HEAD -- .`,
`reset -q --hard HEAD`, `commit-graph write --reachable`, `multi-pack-index write`,
`gc --auto --force`, `pack-refs --all`, `update-ref`, `fetch --no-tags`, `count-objects -v` and
`worktree add`. Fourteen of the fifteen exited zero under each variable; `multi-pack-index write`
exited 255 with `no pack files to index` and so is an attempt rather than a run, under both. In
every case the second repository was unchanged to the byte, no path added, removed or altered.
The mechanism behind that result is worth more than the count: `git hash-object -w` run in the
named repository with the alternate set wrote `92d5444`, which `git cat-file -e` then found in the
named repository and did not find in the second one, so an alternate is a read path and new
objects land in the primary store. For the ceiling the mechanism is simpler still — its worst
outcome is a refusal, and a command that exits 128 without running writes nothing anywhere.

So the honest result is that the list does not grow, and the reason is a distinction rather than
an absence of effort. "Moves a surface" and "reaches a write to a repository nobody named" are
different questions, and card #151's fault was the second: a fixture's `git init` and `commit`
landing in the committing worktree. A variable that makes a read wider is a divergence, and
adding it here would have put a line in `REDIRECTING` that no damage path stands behind — which
is what the card warned would make the list harder to justify next time. This is the item 4
outcome the acceptance was written to allow.

One finding falls outside item 2's question and is recorded rather than folded in, because it is
about disclosure and not about a write. An alternate's readability propagates outward: a commit
built in the named repository over the second repository's tree, which only the alternate makes
readable, pushed to a third bare repository at exit 0, and that third repository could then read
the second repository's blob and print its tree. Nothing was written to the second repository at
any point — the objects travelled out of it, not into it. Whether an inherited alternate is a
disclosure concern for a consumer is a question about what Rigger spawns git for, and it is not
this card's; `R-SAFE-3` is the clause it would be argued under.

The measurement bears on the denylist-versus-allowlist question in one narrow way, and naming it
is as far as this card goes. `gitEnvironment()` names what to remove, so `GIT_CEILING_DIRECTORIES`
is inherited, and the failure it can produce in a consumer is that every Rigger git call under an
ancestor-naming ceiling exits 128 rather than acting on the wrong repository. That is a liveness
failure and not damage, so this card's damage test does not reach it and the variable stays out —
but it is an example of a whole class a denylist admits and an allowlist would not, which is
precisely the trade the shape question turns on. The stronger evidence about the mechanism arrived
from outside the measurement: while this card was being worked, `main` stood red at `8dd7950`
because PR #155's own sweep test reported `test/path-check.test.mjs:115` spawning git with no
environment, a site PR #162 added. Both branches were green on their own trees, and `main` went
red only at the merge `c433d57`. A sweep that enumerates every spawn site caught a real
unenvironmented git that no list of variable names could have caught, because the defect was a
missing `env:` and not a wrong one. That argues the per-site sweep is carrying more weight than
the denylist is, which is a fact for whoever takes the shape card and not a decision taken here.

Two tests were added, and what they are is worth stating plainly, because neither had a red to
show. The card's outcome is that no production code changes, so there was no failing test to
drive: these are characterization tests over git's behaviour, and their value is that the claim
"neither reaches a write" is executable rather than prose that would go stale green under a future
git. Each was shown to discriminate by a guarded mutation instead. Letting a write land in the
second repository redded `an alternate object store the environment names is read from and never
written to` on its byte-for-byte assertion; moving the ceiling to a path that is not an ancestor
of the working directory redded `a ceiling the environment names refuses a repository rather than
naming another one` on `Missing expected exception`. Both mutations were checked to have occurred
exactly once in the file's bytes, to have been read back off disk, to have left a file that still
reported this file's normal sixteen tests, and to have been restored byte-exact — sha256
`a3c35f48…` over the working tree's CRLF bytes, the form `core.autocrlf=true` leaves on disk,
which is not the LF the blob `5a695e2` hashes.

What generalises is the shape of the second question. A variable that moves a surface is easy to
find and easy to over-read, because the comparison that finds it says nothing about whether the
movement can hurt anything. The test that discriminates is a throwaway victim fingerprinted to the
byte before and after, and it is cheap enough that there is no reason to argue the point instead.
Card #151 built its list on a surface comparison because the surface comparison was what it had;
this card's contribution is that the comparison is a filter and not a verdict, and that a list
built only on it would have grown by two members for no reason anybody could defend later.

## Round 2 — the tests proving the guard's limits reinstated the fault above it

The answer above survived review. The tests that established it did not, and the way they failed
is worth more than the answer. Both built their environment as `{ ...process.env, VAR: value }`,
so a git they spawned inherited whatever redirecting variables were already set. Under a linked
worktree's hook those are `GIT_DIR` and an absolute `GIT_INDEX_FILE` naming the repository being
committed; `.githooks/pre-commit` runs `npm test` with that environment unscrubbed, and
`AGENTS.md` requires a worktree for every piece of work. So the fixtures' `add -A`, `commit` and
`gc --prune=now` ran against the committing repository. Measured on a throwaway one fingerprinted
file-by-file, with git 2.55.0.windows.5, running the whole suite at the published head `e784e28`:
**15 files changed** — `refs/heads/master` and three loose objects **deleted**, `.git/index`,
`COMMIT_EDITMSG` and both reflogs rewritten, and a pack, `packed-refs`, `info/refs` and a
commit-graph added. At the base `6eeaa58` the same probe reported 14 of 14 passing and **0 files
altered**, so this change introduced it. After the fix: **328 of 328 passing and 0 files altered**
under every shape.

This is card #151's fault, in card #151's own test file, with a `gc --prune=now` attached that the
original fault never had. The general shape is worth naming because it will recur: **a guard's own
tests are written in the environment the guard exists to neutralise, and the test that
demonstrates the guard's limits is the one most likely to re-enter through them.** Round 1 reached
for the ambient environment precisely because the point was to show a variable the scrub leaves
behind, and the scrub was the thing being characterised, so using it felt like assuming the
conclusion. It was not: the variables this card measures are exactly the ones `gitEnvironment()`
does not remove, so the scrub and the variable under measurement are separable and scrubbing costs
the measurement nothing. That separability is what made the fix one line inside a new `carrying`
helper rather than a redesign.

Carrying the redirect was also a measurement error and not only a hazard, which is the part that
would have been missed by fixing the danger alone. Damage recorded under an inherited `GIT_DIR`
would have been that variable's damage and not the variable's under test, so the assertion
`assert.deepEqual(fingerprint(victim), before)` was reading a repository that a second, unrelated
redirect had already taken git away from. The scrub makes the tests correct as well as safe, and
the read-versus-write distinction this card established of git's variables turned out to apply to
its own fixtures: every spawn here built from the ambient environment is a read, and a read under
a redirect gets the wrong answer, which is the point of a premise assertion, while a write under
one lands in the wrong repository.

The quieter shape is the one that should change how a fix like this is checked. With only an
absolute `GIT_INDEX_FILE` inherited and no `GIT_DIR`, the published head reported **16 of 16
passing, exit 0** while the committing repository's `.git/index` was overwritten with the
fixtures' paths. A green suite is not the safety property, and a fix validated against the
failing test alone would have looked finished while the silent half survived. So the regression
test drives both shapes in one loop and keeps a benign main-checkout shape beside them as a
control, which is what shows the fault is specific to the arrangement and not an artefact of the
probe.

The regression test then red on CI and not on the host that wrote it, and what it caught was the
fingerprint rather than the repository. The entry that moved was
`.git/objects/maintenance.lock`, digest `e3b0c44298fc…`, which is sha256 of the empty string: a
zero-byte lock that git's automatic maintenance creates and removes around a commit. The snapshot
taken before the fixtures ran caught it and the one after did not, so a comparison over every file
reported a repository as altered while nothing it holds had changed. Measured on a macOS runner in
GitHub Actions at `fe3a060`, where the host that developed the test — Windows 11, git
2.55.0.windows.5 — never observed the lock in either snapshot. A lock records that a git was
running, not what the repository holds, so it is now left out, and the exclusion was checked
against the mutation rather than assumed harmless: reverting the scrub still reds the test naming
all fifteen paths, none of which is spelled `.lock`. The transferable part is that **a
byte-for-byte comparison is only as good as its account of what counts as content**, and a lock
file is the standing counterexample — it is a fact about the tool, not the data.

That red also cost a round trip for a reason worth removing: comparing the two digest maps with
`deepEqual` truncates, and the CI log showed `Lines skipped` where the differing path should have
been. The comparison now reduces to a sorted list of paths and what happened to each, so a failure
names every one of them. Diagnostics that survive a remote log are part of a test's value, not a
convenience, because the run that matters most is the one you cannot attach a debugger to.

One last thing generalises, about the sentence that licensed the pattern. The spawner sweep's
docstring said the premise assertions spawn git under the inherited environment deliberately, and
that was sound reasoning about reads written when every such spawn was a read. It carried no
clause about writes, so it silently licensed one, and it asserted a count of two that the file had
already outgrown. A licence in a comment ages against the code it licenses, and a count in prose
ages faster; the sentence now states the read-versus-write rule and carries no figure to go stale.
