ABOUTME: Card #165 — the hook `git merge` runs, what an absorb of `origin/main` now costs measured
three times, and why `templates/` carries no hook of any name.

# Card #165: the merge commit nothing gated

`git merge` runs `pre-merge-commit`. This repository held no hook of that name, so a merge commit
was the one commit that reached a branch without the suite check every other commit passes, while
`AGENTS.md` says "Never commit or push with a failing suite".

Measured at base `06ca7e6` with `git ls-files .githooks/`: three files — `pre-commit`, `pre-push`
and `refuse-if-suite-red`. The fix is a fourth file that reaches the third.

Every figure below is measured on branch `m0/165-pre-merge-commit`, base `06ca7e6`, in two fresh
clones taken from the GitHub URL with `core.hooksPath` set to `.githooks`, on this host: node
v24.18.0, npm 11.16.0, git 2.55.0.windows.5, Windows 10.0.26200.9550.

## The owner's authorisation

`.githooks/` is this repository's live gate, and `AGENTS.md`'s self-hosting section says the engine
never merges a change to its own live gate — those cards are done by hand. The owner gave explicit
permission for this card to be delivered through the maker-and-judge loop, under `AGENTS.md` rule
#1, which requires the owner's permission before any rule there bends. The owner still merges it.

## What the hook does, and what it deliberately does not

`.githooks/pre-merge-commit` is `.githooks/pre-commit` with one word changed in its header. Both
`exec` the shared script, so the check lives in one file and three hooks reach it.

A hook that refused every merge would not be a fix: absorbing `origin/main` is something this
milestone does constantly, and the tree a green absorb produces is green. `pre-merge-commit` runs
after git has merged the index and the working tree and before the commit is written, so the suite
it runs is the suite of the tree the commit would carry. That is why the same script serves: it
needs no notion of merging at all.

## Both directions, exercised

Both were run in a throwaway clone, on branches that exist only there. The red case reproduces the
shape of `e937d6d`: a guard that enumerates something on one branch, a newly-arrived site it does
not name on the other, each green alone.

| Case | Branches | Result |
|---|---|---|
| red tree | a guard naming four hooks, merged with a fifth hook | exit 1, no commit written |
| green tree | a branch one commit behind main, merged with `origin/main` | exit 0, merge commit `a1856fd` |

The red merge printed the shared script's refusal — "refused: the suite is not green." — above git's
own "Not committing merge; use 'git commit' to complete the merge". `HEAD` stayed at `5e754e5` and
`.git/MERGE_HEAD` held `bc6b684`, so the merge was staged and uncommitted.

That suggested completion is closed too, and it was run rather than reasoned about: `git commit` on
the staged merge exited 1 from `pre-commit`, on the same red suite, with `HEAD` unmoved.
`git merge --abort` then exited 0 and left `git status --short` empty.

The green case is a real absorb rather than a contrivance. `git merge-base --is-ancestor
origin/main HEAD` was false first, so no fast-forward was available, and the commit git wrote has
two parents, `e07622e` and `06ca7e6`.

## What an absorb of `origin/main` now costs

One absorb costs one suite run. Wall-clock for `git merge --no-edit origin/main`, timed with
`date +%s%N` either side of the command, three runs from the same reset point, against the suite's
own `duration_ms` as `node --test` reports it inside the same run:

| Run | Merge, wall | Suite, self-reported |
|---|---|---|
| 1 | 50.4 s | 49.2 s |
| 2 | 49.8 s | 48.6 s |
| 3 | 51.4 s | 50.2 s |

The merge work itself is 0.15 s, measured as the `git merge --no-commit` step below. So the hook's
addition is a suite run and nothing else, and the figure to plan against on this host is 50 s.

**For anyone already following `AGENTS.md`, the cost is unchanged.** The current manual workaround
is `git merge --no-commit` followed by an ordinary `git commit`, which runs `pre-commit` on the same
tree. Measured once: 0.15 s for the merge and 50.2 s for the commit, 50.3 s in total — the same
price as the hook, to two significant figures. What the hook changes is that the price is no longer
optional, and no longer contingent on the person remembering the workaround.

A cold clone costs more. The first `npm test` in the just-made delivery clone self-reported 80.9 s,
against 48.6–50.2 s for every warm run in the same session, so a first absorb after a fresh clone
should be expected to take longer than the table.

Two sessions reached for a bypass at this gap on the day this card was filed, and the gate refused
both. That is the cost the other way, and it is the one this card is about.

## The executable bit, which `core.filemode` hides

`core.filemode` is `false` in these clones, so git reads no executable bit off the disk and `git
add` of a new file under `.githooks/` records mode `100644`. Git skips a hook that is not
executable, so on a POSIX host that mode is a hook that never runs and never says so.

Staged with `git add --chmod=+x`, after which `git ls-files -s .githooks/` reports `100755` for all
four files. Nothing in the suite would have caught the wrong mode: the test reads the file's
content, and `git ls-files` is where the mode lives.

## The bytes

`.gitattributes` pins `.githooks/*` to `text eol=lf`, because a shell hook checked out with CRLF
fails on its own shebang. The new file is 144 bytes with 4 LF and 0 CR, measured with `wc -c` and
`tr -cd`, and `git ls-files --eol` reports `i/lf w/lf attr/text eol=lf` for it.

A CRLF working tree cannot be committed here, which is worth knowing before trusting a hash.
Rewritten CRLF on disk, the file still hashed to `39f4c2b` — the LF blob — because `git
hash-object` applies the attribute. So the index is safe whatever a maker's `core.autocrlf` says,
and it is the checked-out bytes, not the committed ones, that the test's byte-exact equality
guards.

## Why `templates/` carries no hook

`templates/` at `06ca7e6` holds 14 files, measured with `git ls-files templates/`:
`templates/rigger.config.mjs` and 13 under `templates/claude/`. One of the 13 is a hook —
`templates/claude/hooks/refuse-reserved-git-commands.mjs` — and it is a Claude Code hook that
`init` forks to `.claude/hooks/`, not a git hook. No git hook of any name is shipped. The divergence this card's item 5 asks about
therefore predates this card: neither `pre-commit` nor `pre-push` is shipped to a consumer either.

There is nowhere for a hook to go, and that was measured rather than argued. Creating
`templates/githooks/pre-merge-commit` in the throwaway clone made 13 of the 17 tests in
`test/init.test.mjs` fail, every one on the same error raised by `forks()` in `src/cli/init.mjs`:

> `templates/githooks/` ships assets for `githooks`, which is no provider Rigger reads assets for,
> so there is nowhere to fork them to.

`templates/` is a tree of provider asset directories, keyed by `PROVIDER_ASSETS`, and `init` forks
each one into the directory its provider reads. A git hook belongs to no provider, so the refusal
is the design working.

A consumer does not need this hook for a second reason, which is what it enforces. These three
hooks enforce an `AGENTS.md` rule about this repository's own suite, and `AGENTS.md` binds sessions
here rather than in a consumer's repository. The gate `ARCHITECTURE.md` describes under a consumer's
`.githooks/` reads verdict markers and holds no opinion of its own; it is a different hook, it
arrives with `M5`, and `R-SAFE-6` places it in the consumer's repository when it does.

## Two mutation claims

The presence test failed for real before the hook existed, naming `git merge` as the ungated
operation, so it needs no mutation. The delegation test passed from the moment it was written — the
two existing hooks already delegate — so it had never failed, and a test that has never failed has
proved nothing.

Both mutations were applied to `.githooks/pre-merge-commit`, one at a time, each restored before
the next. The anchor `exec "$(dirname "$0")/refuse-if-suite-red"` was confirmed present exactly
once by `grep -F -c` before each, and the file hashed `39f4c2b` before and after each.

| Mutation | What the bytes became | Run | Result |
|---|---|---|---|
| the delegation replaced by an inline `npm test \|\| exit 1` | body read back as `npm test \|\| exit 1` | 2 tests, both named | the delegation test failed on `deepEqual(restated, [])` with actual `['pre-merge-commit']`; the presence test still passed |
| every line ending rewritten to CRLF | 4 CR bytes where there were 0 | 2 tests, both named | the same test failed the same way |

The second is the one worth having: it shows the byte-exact equality is what catches a line ending,
and the presence test staying green in both shows the two tests discriminate different defects.

## A guard that reported a figure it could not vouch for

Checking the restore, I ran `grep -c $'\r'` over the file and it answered 4 on a file with no CR
byte in it, because `grep -c` counts matching lines and that pattern matched every line under this
shell. Re-measured with `tr -cd '\r' | wc -c`: zero.

The tdd skill's seventh requirement is that a failed guard exits non-zero, and this is the softer
version of the same fault — a guard that answers confidently about something it did not measure.
The byte counts in this entry are all from `tr -cd` and `od -c`.

## What the hook does not reach

A fresh clone carries no `core.hooksPath`. Measured in a clone taken from the GitHub URL with
`git config --get core.hooksPath`: the answer is empty. Until someone sets it, none of the four
hooks runs, this one included.

Nothing in this repository's instructions says to set it. `grep -rn hooksPath` over `AGENTS.md`,
`.claude/`, `docs/spec/` and `README.md` at `06ca7e6` finds it only inside
`.claude/hooks/refuse-reserved-git-commands.mjs`, which is the gate that refuses turning it off.
Every session this milestone arms it because its own task says to.

So what this card closes is the gap in an armed repository, which is what its acceptance asks
about. Whether arming it should be written down, or done by something, is outside that.

## What was left alone

Git leaves a refused merge staged, with `MERGE_HEAD` set, and tells the person to `git commit`.
The shared script's refusal says "Fix it and commit the fix on its own before you go on", which was
written for a commit and reads slightly off in that state — the commit it names is the one git has
just refused. Both routes are closed, so nothing merges wrongly; it is the wording that could say
more. That is outside this card's acceptance and is left for the card's author to decide on.
