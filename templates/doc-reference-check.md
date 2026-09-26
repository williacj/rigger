<!-- ABOUTME: Shows a consumer how to run the packaged document reference resolver in its own checks. -->

# Document reference check

Install `@williacj/rigger` in the repository whose documents you want to check. Add
`doc-references.json` at that repository's root. Its `documents` object maps each document path,
relative to that root, to `strict` or `soft`. A strict finding fails the check; a soft finding is
reported without failing it. For example:

```json
{
  "documents": { "docs/decisions.md": "strict" },
  "exempt": { "paths": {} }
}
```

Add this script to that repository's `package.json`:

```json
"check:references": "node ./node_modules/@williacj/rigger/scripts/doc-reference-check.mjs ."
```

Run `npm run check:references` from the repository root in its own checks, after `npm ci`. The
`.` argument makes the installed resolver read that repository's `doc-references.json` and
documents. Without it, the resolver reads the package it was installed from.
