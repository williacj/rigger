ABOUTME: Card #37 — the packaging proof, the measurement that shows why `npm link` cannot satisfy
`R-SAFE-5`, the reviewer session run against card #34's diff, and what M0's own assets got wrong on
first use.

# Card #37: a link that writes to the tree it links

Every figure here is a measurement unless it says otherwise. All of them were taken on
2026-09-24 in a fresh clone of `https://github.com/williacj/rigger.git` at
`01636abdac649e96f8ebb0b7f23286b8d84f63ea`, on Windows 11, with Node 24.18.0, npm 11.16.0 and git
2.55.0.windows.5. The clone, the install root and every probe directory sit under this session's
scratch directory, outside the clone and outside the installed package both.

## The tarball installs outside the checkout and runs there

`npm pack` in the clone wrote `williacj-rigger-0.0.0.tgz`, 361,476 bytes on disk, which npm's own
notice reports as 152 files, 361.5 kB packed and 1.2 MB unpacked.

Installed with `npm install <tgz>` into an install root that is a sibling of the clone rather than
anything beneath it, npm answered `added 1 package`. Run from a third directory that is neither
the clone nor the install root, `rigger --help` printed the nine-verb block the README specifies
and exited 0.

The install is a real tree and not a view of the clone. Asked for the package root it resolves
itself to, the installed `src/cli/doctor.mjs` answers the path under the install root; the clone
is nowhere in it. That is the whole of what `R-SAFE-5` asks for, and it is the same value the
refusal below is decided on, so the two measurements are one question asked twice.

The engine then ran against the clone. From the install root, `rigger doctor` with the clone as its
working directory reported `4 of 4 checks passed` and exited 0. That is M0's exit condition for
`doctor` and the fourth item of card #34's acceptance, measured on the arrangement the build plan's
installation rule describes rather than on a fixture.

## Why `npm link` cannot satisfy it

`docs/v0-build-plan.md`, §1.1, already says that `npm link` "symlinks back into the source tree, so
the runtime and the target are the same files". The card asked for that shown rather than restated.
Three measurements show it, and the third was not what I expected to find.

**The linked package directory is the checkout.** With the clone linked globally and the link taken
in a separate consumer directory, `node_modules/@williacj/rigger` in that consumer is a symlink
whose `realpathSync.native` is the clone. Asked for its package root, the linked
`src/cli/doctor.mjs` answers the clone itself — the same question the tarball install answered with
the install root.

**`--help` does not tell the two apart.** `rigger --help` from the linked install printed the same
nine-verb block and exited 0. An install proved only by `--help` is proved for neither arrangement,
which is why the first acceptance item's tarball and this one need the package root between them.

**The refusal fires on the link and not on the tarball.** `rigger doctor` run in the clone from the
linked install answered with the `R-SAFE-5` refusal, naming the clone as "the source tree this
Rigger is running from", and exited 1. The same verb, same directory, from the tarball install,
exited 0 with four passing checks. The engine tells the two arrangements apart on its own, and what
it tells them apart by is the package root above.

### The mechanism is the package link, not the bin link

`src/cli/doctor.mjs` explains its own choice of `import.meta.url` this way: "an installed bin is
reached through a symlink in `node_modules/.bin`, and Node resolves that symlink before it sets
`import.meta.url` — which is what makes an `npm link`ed engine resolve back to the checkout it was
linked from".

On this host the bin is not a symlink. `lstat` on `node_modules/.bin/rigger` in the tarball install
reports a regular file, because npm on Windows writes a shim rather than a link. The linked engine
still resolved back to the clone, so whatever carried it there, it was not the bin. What carried it
is the measurement above: `npm link` puts the symlink at `node_modules/<name>`, so every module
inside the package is loaded from a path that resolves into the source tree, and `import.meta.url`
is set from that resolved path however the bin was reached.

The comment's conclusion is right and its stated cause is right only on a platform whose bin is a
link. The load-bearing fact is one level up and holds on both.

### The link edited the tree it linked

The clone was clean before `npm link` and carried one modified file after it:

- `git status --porcelain` answered nothing before, and ` M src/cli/rigger.mjs` after;
- the index's cached size for that path is 612 bytes; the file on disk after the link is 611;
- reading the bytes, line 1 — the shebang — ends `LF`, and lines 2 through 12 end `CRLF`. The link
  rewrote exactly one line ending;
- the file's mode on disk is 755.

The change is invisible to `git diff`, which printed no hunk: `git hash-object src/cli/rigger.mjs`
answers `dbabd62fd0a29968489807c166c0d6a2e9ab07ef`, the blob `HEAD` holds, because the clean filter
normalises the line ending away. `git hash-object --no-filters` answers
`fddef300a2a84e4abe02a5c7c8216c824156319c`. The working tree was modified and the diff was empty.

This is the sharpest form of the reason. `npm link` does not merely point the runtime at the source
tree; setting the link up **writes to the source tree**, and it writes to the one file the package
declares as its entry point. An engine installed that way is running out of files that the install
itself has already edited, and an agent it dispatches works on those same files. The tarball
install wrote nothing to the clone: `git status --porcelain` was empty after `npm pack` and empty
again after the install.

The global link was removed afterwards (`npm rm -g @williacj/rigger`), and `src/cli/rigger.mjs` was
restored from the index.

## The reviewer session

One session, run by hand in this repository with `.claude/skills/code-review/` loaded, against PR
#145 — card #34, `rigger doctor` — base `7efec22`, head `7e5a016`, 1,090 insertions and 5 deletions
across 7 files. Card #34's acceptance is five items and readable; none of the work is this
session's.

Every acceptance item ruled on, and the findings, are in the pull request for card #37. What
belongs here is the one blocking finding and how it was reached, because the route is reusable.

**`configValidity` guards the import and not the validation.** The check wraps
`await import(pathToFileURL(path))` in `try`/`catch` and then calls `validate(config)` outside it.
The file's own comment names the hazard a few lines up — the config "is a module the consumer
wrote, so importing it runs their code and can throw" — and the guard stops one call short of where
the consumer's code is still running.

Two configs reproduce it, both run through the tarball-installed engine against throwaway git
repositories:

- `export default 10n;` — `validate` reaches `holdsNothing`, whose message interpolates
  `JSON.stringify(value)`, and `JSON.stringify` throws `TypeError: Do not know how to serialize a
  BigInt`;
- `export default { get repo() { throw new Error(...); } };` — `readShape` reads `value[key]` and
  the consumer's getter throws.

In both runs the report printed **no check lines at all** and a Node stack trace, and exited 1. Card
#34's first acceptance item asks for four checks reported one line each and its second asks for
each line to say which check it is "without a stack trace"; a consumer holding either config gets
neither.

The route worth keeping: the defect was found by reading the maker's own comment about a hazard and
asking whether the guard it justified reaches as far as the hazard does. The test file covers eight
kinds of thrown value, every one of them thrown from the import. A guard and its test can agree
with each other perfectly and still stop short of the same line.

**The proof declarations hold.** `test/doctor.test.mjs` declares `// proves R-SAFE-5` on five tests.
Removing the refusal branch from `doctor()` in a disposable clone — guarded on the file normalising
to `cbb8e81336cdc1ad0ef3dcd56b3a1a3783d52feb`, the blob at the PR head, and reported as applied with
the 302 characters it removed — took `node --test test/doctor.test.mjs` from 22 of 22 to 20 of 22.
The two that red do so on an assertion about the refusal text. The three that stay green prove the
other halves of the same requirement: that the check does not over-refuse a sibling directory or a
second spelling, and that a tree git cannot name is refused by the branch this mutation left alone.
The file was restored and re-hashed to `cbb8e81` before the suite was re-run green.

## What the M0 assets got wrong on first use

The card asks what the assets M0-1 and M0-2 committed got wrong. Something did, repeatedly. What
follows is what the journal and this repository support, and then where the list I was handed does
not hold.

### An acceptance item whose falsifier is narrower than the sentence above it

This is real, and it is the acceptance skill's own failure rather than a maker's. Two shapes are
evidenced.

**A bar no work could pass.** Card #57 carried an item requiring every behaviour above it to have a
test that fails at one ref and passes after, where two of those behaviours were unchanged at that
ref by their own wording: "An acceptance that pins something still and also demands its test move
is asking for opposite evidence in one sentence"
(`docs/journal/2026-09-23-1256-57-a-non-zero-exit-is-not-a-refusal.md`). Card #109's acceptance
required a live `ARCHITECTURE.md` section chosen by tracing each dissolved clause, and the trace
proved no live section could satisfy it
(`docs/journal/2026-09-23-1701-109-a-source-that-outlives-its-document.md`).

Card #109 is the instructive one, because it cuts the other way: "The item that made the acceptance
unsatisfiable is the same item that made the unsatisfiability provable." The narrow falsifier is
what made the fault visible in a day rather than shipping a green that compared nothing.

**A bar satisfiable while the harm survived.** Card #157 was written against a stale exemption
whose deletion would have changed nothing, because the exemption was read by a different script
than the one leaving the report unread: "had we only deleted the stale entry, the headline harm
would have survived the fix intact, with the acceptance arguably met"
(`docs/journal/2026-09-24-1038-157-the-exemption-was-never-what-stopped-it.md`).

The finding underneath all three is not that the acceptance skill lacks a rule. It has one: it has
required a named falsifier since well before any of these cards. Every one of these defects
happened under that rule, and none of them produced a change to the skill. The asset that went
wrong on first use is the acceptance skill, and what went wrong is that stating the rule did not
make it run.

### False greens

The best-evidenced category, and the one with the most instances.

**A check reporting a clean answer about a file it never read.** Card #152 is the canonical entry,
and it names the shape: "A reader given a list of allowed placements does not report that a header
sat somewhere odd; it reports nothing, which is indistinguishable from a file that is fine". The
same entry records the second half — the read wrapped in `catch { return []; }`, so a tracked file
the disk did not hold "became no finding at all", with the check reporting `0 header findings,
across 3 tracked files` and exiting 0 while the absent file was the offending one
(`docs/journal/2026-09-24-0827-152-a-clean-answer-about-a-file-it-never-read.md`).

**A mutation that silently did not apply.** Card #148: with the occurrence count removed, "the same
write at `28209b6` was a no-op: `git status --porcelain` reported nothing, and `node --test` on the
test the mutation aimed at reported 18 of 18 passing. Read as a result, that run says the test does
not discriminate, which is the opposite of the truth"
(`docs/journal/2026-09-23-2223-148-an-anchor-that-outlived-its-line-break.md`).

**A negative fixture the repository grew into.** Card #161: a test stood an unknown maker up as
`architect`, and declaring that role made the test pass on a config it no longer described. "A
negative fixture wants a name the repository is committed to not having, and a deferred role is a
name a decision keeps free"
(`docs/journal/2026-09-24-1340-161-a-sweep-for-a-citation-misses-the-routing.md`).

Unlike the acceptance defects, these did reach the assets: the mutation-claim bar and the reason an
anchor goes stale are both in `.claude/skills/tdd/SKILL.md` now, written by the cards that were
bitten.

### Measurement traps

**`grep -c` counts lines, not bytes.** Card #165: "I ran `grep -c $'\r'` over the file and it
answered 4 on a file with no CR byte in it, because `grep -c` counts matching lines and that pattern
matched every line under this shell. Re-measured with `tr -cd '\r' | wc -c`: zero"
(`docs/journal/2026-09-24-1559-165-the-merge-commit-nothing-gated.md`).

**`git hash-object` applies the clean filter.** Card #161 states it as a reason for not using it as
a byte guard: it "applies the clean filter and a pure line-ending change passes it unchanged". This
card met the same property from the other side, in the `npm link` measurement above, where the
filter is what made a modified file show an empty diff. The property is real; neither entry records
anyone believing a wrong answer because of it.

**A clone whose `origin` is a local path reds two `init` tests.** The journal records this nowhere.
The repository does, and it is measured here for the first time. A clone taken with `git clone`
from a local path, at `01636ab`, runs `node --test test/init.test.mjs` to 15 passing and 2 failing.
The two are the divergence checks, and both fail on the same refusal: "`rigger.config.mjs` is not
what `init` would write here." The mechanism is `repoSlug`, whose `SLUG` pattern matches the tail of
any path: against that clone it answers `"c37/repo"` — the last two segments of the local origin —
where against a clone whose `origin` is the GitHub URL it answers `"williacj/rigger"`. So `init`
writes a config naming a repository nobody has, and the forked config diverges from the committed
one.

Two things make this worth the words. First, `test/doctor.test.mjs`'s own `freshClone` already
carries the workaround — it clones the checkout and then runs `git remote set-url origin` with the
published URL — so the trap was met, worked around in one fixture, and written down nowhere, which
is why it keeps arriving fresh. Second, the figure it produces is `15 pass, 2 fail in
test/init.test.mjs`, and cards #52 and #161 record that same figure with an entirely different
cause: a template role prompt with no matching live config. Same two tests, same count, two
mechanisms. A session that reads the figure out of the journal diagnoses the wrong one.

**`wc -w` disagrees with this repository's `countWords`.** Measured at `01636ab` over the eleven
live instruction files `scripts/instruction-budget.mjs` names: `countWords` totals 13,703 and GNU
`wc -w` 8.32 totals 13,611, and the two differ on every one of the eleven files, `countWords` always
the larger. The script's own comment gives the cause — `wc -w` does not count a token made only of
non-ASCII punctuation, and these files use em dashes and arrows.

This one needs correcting in both directions. Card #176 asserts the disagreement without measuring
it ("`wc -w` disagrees with the script's `countWords` over punctuation tokens, so it cannot be used
to check these"), and card #80 reports the opposite result from the only comparison the journal ran:
"`countWords` and `wc -w` both returned 191 for `D16`'s Notes". Both are right. Card #80 measured a
prose extract with no standalone punctuation token in it; card #176 was talking about whole
instruction files, which have them on nearly every line. The honest statement is the one nobody had
made: on the files the budget governs, the two tools disagree everywhere, and the live pool at
`01636ab` sits 92 words nearer its 14,000 ceiling than `wc -w` would report.

**Figures pinned to the wrong ref.** The most frequent measurement fault in the milestone, and the
one that did reach an asset: card #115 proposed the rule and card #139 records the owner ratifying
it into `AGENTS.md`, which at `01636ab` requires a measured figure to name its source, scope and
ref. The
rule landed and the fault continued — card #177's round one read a failure pointer against a parent
tree that never ran the sweep. A rule about naming a ref does not by itself make anyone check that
the ref is still the one being ruled on.

### The pattern the list did not name

Two branches, each green, whose merge is red. Card #120 is the first: "One branch had the offence
and no detector; the other had the detector and nothing to detect"
(`docs/journal/2026-09-23-1558-120-two-green-branches-one-red-merge.md`). Cards #152, #167 and #168
hit it again, and card #177 names the class and the worse case: "A merge can falsify an invariant
that no check yet expresses, and the red then arrives with whoever writes the check, attached to a
tree they did not break"
(`docs/journal/2026-09-24-1756-177-an-invariant-a-sibling-branch-can-falsify.md`).

Six cards is more instances than any single item in the list I was given. It is worth naming here
because it is the one M0 failure that no reviewer, no acceptance and no maker could have caught:
every party was reading a tree that was green.

### Where the list I was given does not hold

Two claims did not survive being checked, and saying so is the point of the retrospective.

**"A bar no work in this repository could trip" has no instance as an acceptance item.** Nothing in
the journal describes an acceptance bar that could not be tripped. Three artefacts fit the shape and
none of them is an acceptance bar: card #33's four checks that could not have failed, card #176's
guard list that had gone quiet, and card #161's negative fixture. All three are tests or fixtures.
The distinction matters, because a test that cannot fail is caught by a mutation and an acceptance
item that cannot be tripped is not.

**The `origin` claim is right and the journal is not where it is written.** It is recorded above as
a measurement taken by this card, not as a citation, because there was nothing to cite.
