ABOUTME: Records card #293, which closed the routes #213's judges found in the boundary test after
its final commit, and why the test refuses CommonJS rather than following it.

# 2026-09-25 — The routes after the final commit

#213's judges found five routes past `test/layer-boundaries.mjs` at `5ecb4d9`. The author kept
four for this card and ruled the fifth, a `gh` built at run time, a review finding. This card
closes the four in the one test and its test file.

**The test refuses CommonJS rather than following it.** The card let the test either follow a
load through `require` or refuse it. Following it is a losing race. A CommonJS module's wrapper
hands it `require`, `module` and `arguments`, and each reaches the loader. `arguments[1]` is
`require`. So is `module[key]` for a key built at run time, and so is `f.caller.arguments[1]` from
a sloppy function. No list of names closes that. So a `.cjs` module is refused whole. A
`package.json` under `src/` is refused too, because it can make the `.js` modules beside it
CommonJS, and `sourceTree` now carries one so the whole-tree run meets it.

**An ES module can reach `require` only by naming it.** In an ES module `require` exists only if
the module builds it. `createRequire` and `getBuiltinModule` were already refused by name. This
card adds `require` and `mainModule` to that list, and refuses an import of `node:module`, whose
`Module.prototype` holds `require` under a key a string could spell at run time. The list is now
matched against fixed strings as well as names, so `module['require']` and
`process['getBuiltinModule']` fail as the bare names do.

**A catch parameter is a declaration with defaults.** The reader gave a catch clause a scope
but declared nothing in it, so a default in its pattern never reached the name it bound. It now
declares the pattern with its defaults. The thrown value stays unread, because a `throw` is in
#213's review-finding class.

**Rule 3 reads `board` through step 7's operators.** The operand check that Hand-ons step 7
defines for sides now finds `board` too. A pattern taking `priority` fails when it takes `board`
as its value, its default, or an argument to a function called where it is written. A `priority`
member read from such an expression fails as well. The argument check is positional, so
`((board, { priority }) => …)(deps.board, item)` still passes. A spread widens it: an argument
after a spread may land at any parameter from the spread's position on.

**What the card left where it was.** Two shapes outside its items' words stay missed, and both
are in #213's review-finding class. One is a default in a `for…of` head's assignment pattern,
which is a loop variable. The other is a value thrown and caught in the same `try`.
