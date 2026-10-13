ABOUTME: Journal for #662 (M5-13): this repository's `self-hosting` check, the gate script's exports
it is built from, and the conflict between P52's ratified sentence and the spec-style lint.

# #662 — The self-hosting check

## What changed

- `.github/workflows/self-hosting.yml` triggers on the gate workflow's event set. Each job fetches
  this repository's tree at `GITHUB_WORKFLOW_SHA` with an inline `curl | tar` step, and runs both
  scripts by their paths in that tree. No step has a `uses:`.
- The first job runs `scripts/gate-check.mjs card`. The posting job runs `gate-check.mjs map`, then
  `.github/scripts/self-hosting-check.mjs` on each pull request. It mints the gate App's token with
  the gate workflow's mint step, byte for byte, and posts `self-hosting` on each head the script
  printed.
- `scripts/gate-check.mjs` exports `defaultConfig`, `card` and `map`, and runs a mode only when it
  is the script node was started on. `defaultConfig` also answers `commit`, the default-branch
  commit it read the config at, because the self-hosting check reads `AGENTS.md` there.
- `test/layer-boundaries.mjs` parses both scripts, under the card's one grant class.

## How the script rules

The script reads the pull request, refuses a fork, and reads the config through `defaultConfig`.
It then reads `AGENTS.md` at that config's commit, the diff, and the pull request again. Where the
head moved during those reads, it prints no head and exits 2, so the workflow posts nothing for the
event. Nothing is printed until every read is done, so a run that throws also leaves no head.

A pull request touching nothing listed passes, and the card is never read for it. Where it touches
a listed path or an authored document, the script resolves the card from the branch by the default
branch's topic rule. It then hands `gateAnswer` the owner as the one judge.

The diff is read from its `diff --git` headers and from its `rename` and `copy` lines. A C-quoted
path is unquoted byte by byte. An unquoted pair with spaces is split where its halves name one
path. A header the script cannot read, or a diff with text and no header, is refused rather than
read as touching nothing.

## Why the main guard resolves the path

Node hands the module its real path, but `process.argv[1]` is the path as it was typed. A plain
comparison, as in `scripts/path-check.mjs`, makes a symlinked path run no mode and exit 0. The
guard resolves `argv[1]` first. This is judgment, not measured on a runner.

## Evidence that the new tests discriminate

Ten guarded mutations of the script each applied once, ran to a verdict with 42 tests reported, and
failed the test aimed at. They removed the second head read, the fork refusal, the lists' commit,
the early pass, the diff-read refusal, case folding, unquoting, the bare-directory entry, the
`Generated` rule and the rename lines. The file was restored byte for byte after each. The log is
in the pull request.

## What went wrong on the way

One test of the post step first handed it the fake forge's `PATH`, which put the real `curl` ahead
of the stand-in. One local run therefore had the real `curl` attempt two POSTs to `api.github.com`
with the token `minted`. The post step now gets no `PATH` from its caller.

P52's ratified sentence, "An inline step fetches the tree at the commit the run's workflow file was
read from, …", is 42 words long. `npm run lint:spec-style` refuses a sentence past 40, so the suite
reds with the text as ratified. That conflict between two acceptance items went to the card as
`ambiguous`.
