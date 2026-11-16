ABOUTME: Records the four README passages #1414 replaced with the release wording, and the
rulings that set when and how it lands.

# The README says v0 is released

Card #1414 (M8-B5), finished against acceptance revision `96f7baba6530`, made against `origin/main`
`2a581bde`.

## The rulings

- **M8-U32** ([1293#6841692405](https://github.com/williacj/rigger/issues/1293#issuecomment-6841692405)):
  the release wording lands before M8's exit run and the tag, and `D7` rule 4 stands as written.
  `npm pack` always packs `README.md`, so a later change would move the closing commit.
- **M8-U36** ([1293#6924511063](https://github.com/williacj/rigger/issues/1293#issuecomment-6924511063)):
  the README does not type the version; `package.json` and the tag carry it.
- **M8-U35** (the same comment): the contribution line P4 carries.

## The four replaced passages

At `2a581bde`, by line:

- **P1, L10:** the Status badge, "pre-alpha" in orange, now "v0" in blue. Its `#status` target is kept.
- **P2, L164–L165:** the Status section's first paragraph, "Pre-alpha, built in the open", now
  "v0, released on npm". The heading is unchanged, so the `#status` anchor resolves.
- **P3, L210–L212:** the note under "Install and usage", "Nothing is published yet", now names the
  npm package. The fenced verb block `test/cli.test.mjs` reads is untouched.
- **P4, L354–L356:** the first sentence of "Contributing", "during v0", now "until the improvement
  loops land (M9 and M10)". Its second and third sentences keep their words, rewrapped.

The text names no commit, so it becomes true when #1419 publishes.
