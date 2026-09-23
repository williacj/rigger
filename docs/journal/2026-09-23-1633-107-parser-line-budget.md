ABOUTME: Records the budget count and syntax cases established while adopting the existing source reader.

# Package line count from syntax

The package counter treated `/*` inside a regular expression and a multiline template as a block comment. Both constructed cases failed before the change because the scanner threw for an unclosed comment. The source reader built for the test matrix already distinguishes those tokens and refuses ambiguous source, so the counter now uses its token spans to charge every line carrying code.

`npm run budget:package` reported 285 production lines against 12,000 before the change. The same command reported 284 against 12,000 after it. The one-line decrease is the CLI shebang: the old character scanner counted it as code, while the source reader classifies a hashbang as a comment.
