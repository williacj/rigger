ABOUTME: Card #164: how many places under `test/` built a git repository and by what method, why
two earlier figures disagreed, what the victim comparison found at each ref and what a negative
control had to establish before the zero meant anything, the route a subcommand rule alone cannot
see, and the runner artefact that moved the test count by two where one test was added.

# 2026-09-24 — Seven fixtures, and the route to git a grep cannot see

Every figure below is measured with git 2.55.0.windows.5 and Node v24.18.0 on Windows 11 Pro
10.0.26200.9550, in a fresh clone of `https://github.com/williacj/rigger.git` on branch
`m0/164-shared-git-repository-fixture`, base `06ca7e6` and head `944396f`.

**Seven places under `test/` built a git repository, in five files.** Two earlier figures had
disagreed — the card author's grep for one spelling found four files, card #151's maker reported
eleven fixtures — and they disagreed because they counted different things. A file is not a place,
and a fixture is not a construction: `test/doctor.test.mjs` alone held three constructions, one of
them a clone, and the eleven counted every helper that ran git rather than every one that brought
a repository into being. The figure that means something is the number of calls that hand git
`init`, `clone` or `worktree`, and the method is the reader now in
`test/git-environment.test.mjs`: every call under `test/`, tokenized with the repository's own
tokenizer, classified by the subcommand its argument literals name.

The method matters more than the number, because **four of the seven are invisible to any grep for
`git`**. They read `git('init', '-q')`, where `git` is a local arrow function bound to an
`execFileSync` that forwards a rest parameter. The subcommand is in the call and the command is in
the spawn, and nothing in one line holds both. That is the shape card #152 wrote, so a check built
on the spawn alone would have been blind to the exact defect this card exists to stop recurring.
The reader therefore reads two routes: a spawner call naming `git` outright, and a call to a name
some blind git spawn is reached through — and a name counts as a route only where the spawn it
encloses names no subcommand of its own, because a spawn that names one builds its repository
there and then and no caller can redirect it.

## The fault was structural by the time this card ran, and the zero had to be earned

Cards #151, #155, #167 and #169 had already repaired every live instance, so the victim comparison
found nothing moving at either ref. Run six ways — the suite under a throwaway victim named by
`GIT_DIR` and `GIT_INDEX_FILE`, by `GIT_INDEX_FILE` alone, and under a benign main-checkout
relative index — the victim was unchanged to the byte at `06ca7e6` and at `944396f` alike, with
every file digested by sha256 and nothing excluded, including the `.lock` entries card #167's
fixture omits. That zero is worth exactly as much as the evidence that the probe could have
reported otherwise, which is why a negative control ran before it was believed: the fixture's
`gitEnvironment()` replaced by `{ ...process.env }`, card #152's fault precisely, in a guarded
mutation restored byte-exact afterwards.

| Mutant, environment shape | Victim | Suite |
|---|---|---|
| `GIT_DIR` and an absolute `GIT_INDEX_FILE` | `.git/config` rewritten, `user.name` `victim` → `fixture` | 293 of 331, 38 red |
| an absolute `GIT_INDEX_FILE` alone | `.git/index` rewritten, tracked files took on `docs/journal/bad.md` | 310 of 331, 21 red |
| a main checkout's relative `.git/index` | unchanged to the byte | 330 of 331, 1 red |

The third row is the one that changed how I read the guard. The victim is untouched because the
ambient environment names no second repository, and yet the suite is still red — on exactly one
test, card #167's `a fixture that writes leaves the committing repository alone under either hook
environment`, which supplies the hostile variables itself rather than inheriting them. So the
suite catches an unnamed environment in a fixture **whether or not the run that finds it is a run
that would have been damaged.** A guard that only bit when the damage was already happening would
be a guard that reported the fault to whoever had already paid for it.

## What the card asked for that the acceptance could not have said

Item 4 asks that a new caller be caught by something the repository runs, and the honest shape of
that turned out to need two rules rather than one. A rule about subcommands catches a new
`init` wherever the source names it. It does not catch a wrapper: `const ours = (...args) =>
gitIn(d, ...args)` reaches the shared runner with a subcommand the source cannot read, and every
`ours('init', '-q')` afterwards is a spelling the rule never sees. So the second rule is that
**outside the fixture, no call may reach a git runner with a subcommand the source cannot read.**
Four guarded mutations, one per route, each restored byte-exact with a clean `git status`:

| Route a new caller could take | Reported as |
|---|---|
| `spawnSync('git', ['-C', d, 'init', '-q'], …)` | `through: 'a spawner'`, `subcommand: 'init'` |
| a local helper forwarding its arguments | `through: 'ours'`, `subcommand: 'init'` |
| `gitIn(d, 'init', '-q')` | `through: 'gitIn'`, `subcommand: 'init'` |
| a wrapper around `gitIn` | `through: 'gitIn'`, `subcommand: null` |

One edge is stated rather than closed. The reader reads what the source names, so a git whose
command arrives at run time — `test/doctor.test.mjs`'s `ask`, which spawns whatever command it is
handed — is covered by the older sweep's rule that every spawn name an environment, and not by the
subcommand rule. And a repository conjured by copying a `.git` directory rather than by running
git would be seen by neither; measured at `944396f`, no filesystem call under `test/` names a
`.git` path, so that is a route nothing takes rather than a route that is checked.

## Two smaller things, each of which would have misread as something else

**`node --test` books a helper module in `test/` as a passing test.** The count went 329 at
`06ca7e6` to 331 at `944396f` where one test was added, and the runner's own output says why: line
276 of that run reads `✔ test\git-repository.mjs`. Node's default discovery matches every `.mjs`
under a `test/` directory, whatever its infix, so a module that declares no test is loaded, exits
clean and is counted as one. A reader reconciling 329 and 331 against a one-test diff would look
for a test that had been split.

**Four assertion lines went and none of them was an assertion about Rigger.** Each asserted only
that a construction git exited zero — two `git init` status comparisons and a clone's in
`test/doctor.test.mjs`, and one inside `test/init.test.mjs`'s own git helper. The fixture throws on
the same condition, and a mutation confirmed the condition is carried rather than dropped:
`gitIn(root, 'init', '--no-such-flag')` reds eighteen tests across the two files, each on
`Error: git init --no-such-flag in <root> failed: error: unknown option 'no-such-flag'`. That
message names git's own complaint where the removed assertion at `test/doctor.test.mjs:118` had
carried no message at all. **An assertion inside a fixture is scaffolding, and moving it into the
fixture's own refusal is not the same as weakening it** — but it is the kind of change that reads
as a deletion in a diff, so it is worth saying which four lines moved and what now carries each.
