ABOUTME: Card #166 — why `npm install` rewrote `package-lock.json` in every fresh clone, and the
two measurements that decided the lock was the stale artifact rather than `package.json`.

# Card #166: the lock file predated the `bin` key

`npm install` in a fresh clone added three lines to `package-lock.json`, so every maker in this
milestone opened with a dirty working tree it did not create. The added lines were the `bin` block
that `package.json` already carried.

## Which artifact was wrong

The lock file. `package.json` was right throughout, and the fix is a regeneration rather than an
edit.

The lock's root entry, `packages[""]`, is npm's projection of `package.json`'s own metadata — name,
version, license, engines, `bin`. A current lock mirrors what the manifest declares. This one did
not, so it was generated against a manifest that differed.

Git says exactly which manifest. At base `ab368cf`, `package-lock.json` had one commit in its whole
history — `fb510ce`, the commit that created it — and `package.json` at `fb510ce` declares no `bin`.
That count is measured with `git log --follow -- package-lock.json` at `ab368cf`; on this branch it
is 2, this change being the second.

The `bin` key arrived in `0840197`, whose own message says "package.json gains the bin key alone".
That commit touched `package.json`, `src/cli/rigger.mjs` and `test/cli.test.mjs`, never the lock.
So the lock had been stale since `0840197`, and nothing regenerated it between then and this card.
That is the claim the single-commit history carries on its own, without any arithmetic about how
long the span was.

## Ruling out the other candidate

The card offered a second explanation worth testing: a different npm version wrote the lock. One
experiment discriminates. Given `package.json` as it stood at `fb510ce`, npm 11.16.0 reproduced the
committed lock **byte for byte** — sha256 `c3ee99b6`, `cmp` exit 0. Given `package.json` at
`ab368cf`, the same npm produced the lock with `bin`.

So the committed content is fully explained by the manifest it was generated against, and no
version difference needs to be invoked to explain any byte of it. `lockfileVersion` is 3 in the
committed lock and 3 in both regenerations, so the format did not move either.

## What the regeneration was checked against

Regenerating a lock is the operation that quietly bumps a transitive dependency, so the dependency
set was compared as a set rather than trusted. This repository declares no dependencies at all: the
lock holds one package entry, the root project, and no `resolved` or `integrity` field exists
anywhere in it to change. Both sides of the comparison are the same single root entry at version
`0.0.0`. The claim "no resolved version changed" is therefore true over an empty dependency set,
which is a weaker statement than it sounds and is worth saying plainly.

Two regeneration paths were run and both produced the same bytes — sha256 `ba9d69cb`: `npm install`
over the stale lock, and `npm install` with the lock deleted first. That the in-place update and
the from-scratch generation converge means the committed artifact does not depend on which way a
maker reaches it.

## What npm inherits from the manifest, and the trap it sets

The from-scratch regeneration in the clone and the same regeneration in a scratch directory
produced different hashes, and the whole difference was line endings: 19 CR bytes against none,
identical under `diff --strip-trailing-cr`. **npm mirrors `package.json`'s newline style into the
lock it writes.** This host has `core.autocrlf=true`, so the working-tree manifest is CRLF and npm
writes a CRLF lock.

That is harmless here only because git normalizes it: the staged blob carries 0 CR bytes, as the
previous blob did, and git compares normalized content, so the diff stays clean whatever a maker's
`core.autocrlf` is set to. It is recorded because a lock whose bytes track the manifest's newlines
is a plausible way for this same item-1 fault to come back on a differently configured host, and
because `.gitattributes` pins `.githooks/*` and `docs/derived/**` for related reasons and pins
neither manifest nor lock.

The suite would not have caught a byte-level mistake here. `git diff --stat` reporting three
insertions on a text file, and the staged blob still parsing as JSON, are what was checked.

## Measurements

Every figure is measured on branch `m0/166-lock-file-bin-drift` in a fresh clone taken from the
GitHub URL, base `ab368cf`, with node v24.18.0 and npm 11.16.0.

| Figure | Tool | Before | After |
|---|---|---|---|
| `package-lock.json` after `npm install` | `git status --short` | ` M package-lock.json` | clean |
| Package entries in the lock | `Object.keys(lock.packages)` | 1, the root | 1, the root |
| Entries carrying a `resolved` field | `Object.keys(lock.packages)` | 0 | 0 |
| `lockfileVersion` | `grep` on the file | 3 | 3 |
| Suite | `npm test` | 307 pass, 0 fail | 307 pass, 0 fail |

No source file changed, so TDD does not apply and no test was written.

## What this says about generated artifacts here

`D8` rule 3 gives a test rather than a list: a fact is generated when the code owns it and an
author would otherwise retype it. A lock file passes that test. But `D8`'s other rules are scoped
to a path — rule 2 makes a hand edit a lint failure under `docs/derived/`, and a lock file does not
live there. What this card met is in neither place: not a hand edit, but a generated artifact with
nothing checking that it is still current. `docs/derived/test-matrix.md` has `npm run matrix:check`
standing behind it. The lock file had nothing, so it drifted unnoticed across the whole span from
the commit that wrote it to this card.

How long that span was, measured on this branch with `git rev-list --count <range>` and
`git rev-list --count --merges <range>`:

| Span | Commits | Merge commits |
|---|---|---|
| `fb510ce..0840197` — lock written, then `bin` added | 95 | 19 |
| `0840197..ab368cf` — `bin` added, then this card | 250 | 73 |

Six of those 95 touched `package.json`, `0840197` itself among them
(`git log fb510ce..0840197 -- package.json`), and none of the 250 touched the lock
(`git log 0840197..ab368cf -- package-lock.json`). In wall-clock terms `fb510ce` is 2026-09-17,
`0840197` is 2026-09-22 and `ab368cf` is 2026-09-24.

My round-1 entry put "two commits and two pull requests" here, and the error is worth keeping
rather than quietly correcting. It understated the one thing this section exists to record: a
reader would have concluded the drift was caught almost at once, where it survived 95 commits to
the `bin` key and 73 merged pull requests after it. The card's remark that two makers had spent
pull-request words on the drift is a count of who noticed it, not of how long it ran, and I
carried the number across from one to the other.

Whether the lock should gain the same kind of check is outside this card's acceptance and is left
for its author to decide.
