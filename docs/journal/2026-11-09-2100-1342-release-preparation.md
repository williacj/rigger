ABOUTME: Records card #1342's preparation of package.json for the 0.1.0 release: the version, public access, and the narrowed scripts the tarball carries.

# Release preparation for 0.1.0

The manifest now carries version `0.1.0`, `publishConfig.access` `public`, and a `files` list naming `src/`, `templates/` and the four scripts `ARCHITECTURE.md` sanctions, in place of the whole of `scripts/`. M8-U2 Q9 a ruled the version and Q14 ruled the narrowing (the card's edge E9).

Measured with `npm pack --dry-run --json` under npm 11.20.0. The "before" column is at the merge base `1e7e3ce0`, and the "after" column is at this card's head.

| | Before | After |
|---|---|---|
| Version | `0.0.0` | `0.1.0` |
| Entries | 97 | 84 |
| Under `scripts/` | 17 | 4 |

Paths under `scripts/` before: `aboutme-header-check.mjs`, `absorption-check.mjs`, `build-test-matrix.mjs`, `card-check.mjs`, `doc-reference-check.mjs`, `duplicate-id-check.mjs`, `gate-check.mjs`, `instruction-budget.mjs`, `lib/pack-result.mjs`, `mutation-receipt.mjs`, `package-budget.mjs`, `path-check.mjs`, `preflight.mjs`, `proof-diff.mjs`, `record-commit.mjs`, `ruled-out-word-check.mjs` and `spec-style-lint.mjs`.

Paths under `scripts/` after: `doc-reference-check.mjs`, `gate-check.mjs`, `lib/pack-result.mjs` and `record-commit.mjs`.

The bump touched `.github/workflows/ci.yml`. Its host startup check qualifies the npm 11.20.0 banner only for the exact manifest version, so its two version literals now name `0.1.0`. The architect's pre-dispatch attack chose that over deriving the banner from the manifest, until a second bump hits the same file.

The in-process fixtures' host test compares the installed package's code with the source tree's code under `scripts/`. Once `files` narrows, the installed tree holds four scripts and the source tree holds seventeen, so that comparison needed a line outside the card's first grant classes. The coordinator ruled it under M8-K12 as grant class G5 before it was pushed.

The PM, as the card's author, added `package-lock.json`'s two root `version` fields to the card's "Lands in". M8-K12 did not rule that point; it sent it to the PM. The lockfile follows the bump so that the next `npm install` leaves the tree clean, and nothing else in the lockfile changes.

The reviewer's first round found that narrowing `files` broke the prepack recorder's completeness check. That check took every `files` entry as a directory, so a file named on its own never entered it. A deleted shipped script then dropped silently out of the pack, and the recorder still wrote `HEAD`. The PM widened the card to the recorder's completeness check: an entry now also covers the one path it names exactly. A test appended to `test/record-commit.test.mjs` commits an exactly named file and deletes it, and the recorder now writes no commit.
