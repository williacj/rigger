ABOUTME: Records how the installed document resolver was shown to check a consumer repository.

# The installed resolver needed a consumer invocation

The resolver already accepted a repository path, but no shipped file told a consumer to pass it.
Without the path, its default root was the installed package. I added a packaged instruction file
that gives a `check:references` script with `.` as that path.

The test reads the script from the installed tarball's instruction file and runs it in the
consumer repository. It first reports zero findings, then exits non-zero and names a strict
pointer placed in that consumer's document. The test failed before the instruction file existed,
with “the tarball does not ship consumer document-checking instructions”; the focused `npm test --
test/package.test.mjs` run passed after the file was added.

Measured on base `8972ab1` in a fresh GitHub clone with `npm test` and a writable isolated npm
cache: 754 tests passed and none failed. Measured on the worktree before commit with the same
command: 755 tests passed and none failed. `npm run check:references`, `check:paths`, `check:ids`
and `check:headers` each exited zero on that worktree. `npm pack --dry-run --json` listed
`templates/doc-reference-check.md` there.

`ARCHITECTURE.md` still calls the resolver a template, while U30 has it shipped under `scripts/`.
That sentence needs an architect's proposal and the owner's ratification; this change does not
rewrite it.
