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

**An ES module is refused where it spells a loader.** `createRequire` and `getBuiltinModule` were
already refused by name. This card adds `require` and `mainModule`, and refuses an import of
`node:module`, whose `Module.prototype` holds `require`. The list is now matched against fixed
strings as well as names, so `module['require']` and `process['getBuiltinModule']` fail as the
bare names do. A key an object literal or a class defines reads no value, so `{ require: true }`
passes. A computed key such as `{ [require]: 1 }` is an expression, so it still fails.

**A string value spelling a loader still fails, on purpose.** `export const label = 'require'`
fails, and a judge asked whether it should. A string held as a value becomes a key the moment a
module writes `module[label]` or `Reflect.get(m, label)`. Telling that string apart from a label
means following it through aliases, which is the alias tracking the card leaves to review. The
test's own fixture for "through a binding that holds it", `const key = 'require'; module[key]`,
depends on refusing it.

**An ES module can still reach `require` by running code.** The Claude reviewer showed a module
that reads `process` by a key it builds at run time, `['getBuiltin', 'Module'].join('')`, and so
reaches `createRequire` and `child_process` without spelling any of them. On Node v26.5.0 it
loaded `child_process`. That route is a global read by a run-time key and then a function called
away from where it is written, so it sits in #213's review-finding class beside `globalThis` and
`eval`. The test refuses what a module spells; it cannot refuse what a module computes.

**A catch parameter is a declaration with defaults.** The reader gave a catch clause a scope
but declared nothing in it, so a default in its pattern never reached the name it bound. It now
declares the pattern with its defaults. The thrown value stays unread, because a `throw` is in
#213's review-finding class.

**Rule 3 reads `board` through step 7's operators.** The operand check that Hand-ons step 7
defines for sides now finds `board` too. A pattern taking `priority` fails when it takes `board`
as its value, its default, or an argument to a function the call runs. A `priority` member read
from such an expression fails as well. The argument check is positional, so
`((board, { priority }) => …)(deps.board, item)` still passes. A spread widens it: an argument
after a spread may land at any parameter from the spread's position on.

**A named call gives its pattern the value, too.** Codex's first-round finding was
`const take = ({ priority }) => priority; take(config.board ?? {})`, which passed. The reader
had linked an argument to a parameter only for a function written where it is called.

**The first fix matched by name, and that was wrong.** It linked a callee to every function the
module defined under the same name, on the reasoning that this could only fail closed. Both judges
showed that failing closed here breaks the card's own item "Rule 3 bars nothing more". L3 ranks
items by their `priority`. So a module holding an item helper `take({ priority })` beside an
unrelated `take(deps.board)`, or beside `deps.queue.take(deps.board)`, is the ordinary shape. It
failed Rule 3 without reading anything from the board.

**The second fix followed scope but dropped receivers, and that was wrong too.** It resolved a
name the way the language does, but it linked a member call only for a receiver that was a bare
name bound to an object literal, or for `this`. So a method called on an instance, as in
`new Items().take(config.board)`, on `super`, on an inherited `this`, or on a nested object
passed again. It also kept a method after the module had replaced it.

**The reader now follows values, not spellings.** The one rule, which came from the coordinator,
is this: a call resolves to every definition that can reach it, and only those.

The reader first builds the module's lexical scopes, with hoisting and shadowing:
- a `var` belongs to its function, and a function declaration to its block;
- a parameter, a catch parameter, an import and a loop variable shadow the names above them.

A name resolves to the one binding its scope reaches. That binding holds whatever each of its
definitions gives it. A value is one of four things:
- a function;
- a class;
- an instance, which a `new` builds from a class;
- an object literal.

A member read takes the member from each value the receiver can hold, and falls back to the class
extended. `this` holds its own object, or its class together with every subclass the module
defines, because a subclass's instance can run a base class's method and so meet the subclass's
override. `super` holds the class extended.

**What the reader drops.** It drops a definition only where an unconditional replacement
overwrote it first. The replacement has to be an assignment statement written after the
definition, in the same function, and the call has to follow it in the same block. No hoisted
function declaration may stand between that block and the call. Anywhere the reader cannot tell
which definition runs, it keeps them all and fails closed. That covers a conditional or
logical-assignment replacement, a replacement written after the call, and one inside a function
that may run later. It also covers a call inside a function declaration, which could run before
the replacement.

**The third fix still had two holes, one each way.** A write to one instance's own property, as
in `a.take = …`, counted as a member of every instance of the class, so it dropped the class's
method for `b` and for a fresh `new Items()` too. And `this` in a base class took in every
subclass, even one the module never built or handed on. So `new A().rank(deps)` failed on a
subclass's override that could never run.

**The final reader tells instances and classes apart.** An instance now carries the `new` that
built it, so a write through `a` reaches `a` alone. A write replaces what came before it only
where its receiver can be one object and nothing else. That rules out a receiver that may be one
of several, and `this`, which may be any instance. It also rules out one of the objects a loop
builds, because a single `new` or object literal in a loop builds a fresh one each time round.

`this` takes in a subclass only where an instance of it can exist. That means the module names
it somewhere other than its own declaration and another class's `extends`: a `new`, an export, or
a value handed to anything. `super` reads the class's methods and never an instance's own
properties.

**A replacement drops only what it can overwrite.** A replacement may drop a definition written
in module code outside a loop, when the replacement sits in a function expression written after
that definition. Module code runs once, and it has run before such a function can exist. This is
what lets `const a = new Items(); a.take = …; a.take(deps.board)` pass inside a function when
the class is declared at the top.

**What the reader still cannot tell apart.** It still conflates the objects one expression builds
across two calls of its function. A binding outside the function that keeps an earlier call's
object would read that object as the latest one. That is the one place the reader could drop a
definition that still runs. Rule 3 reads only `src/scheduling/`. On 2026-09-25, before this
card merged `main` for the last time, that directory held `pull-order.mjs` alone. A grep for
`new ` and for a member write found neither in it.

**Where values run out.** A parameter, an import, a global and a call's result hold nothing the
reader can see. So a receiver the module does not define, such as `deps.queue`, runs nothing.

**A crash this card met in #274's reader.** `holdings` read `node.id.name` from every function and
class declaration. So a module with an anonymous `export default class` or `export default
function` was refused as unreadable. The test did fail closed, but under the wrong rule, and a
Rule 3 item needs the failure to name Rule 3. It now skips the name a default export does not
have. The export's value was always held under the default binding.

**What the card left where it was.** Two shapes outside its items' words stay missed, and both
are in #213's review-finding class. One is a default in a `for…of` head's assignment pattern,
which is a loop variable. The other is a value thrown and caught in the same `try`.

Rule 3 has five misses of its own, each outside its items' words:
- **A function imported from another module:** the items speak of a pattern in the module under
  `src/scheduling/`.
- **A callback:** a function passed to another that runs it, as in `[config.board].map(take)`.
- **A value a call returns:** `make().take(config.board)`, where `make` returns an object whose
  `take` reads `priority`. A call's result holds nothing the reader can see.
- **A function destructured from an object:** `const { t } = { t: take }; t(config.board)`. Only
  a name bound directly holds what it is given.
- **A pattern given `board` inside a list:** `(([{ priority }]) => …)([config.board])`. A list
  literal is step 6, and the item names step 7's operators.

The reader now follows a plain alias, such as `const t = take`, and a nested object, such as
`a.b.take(...)`. So neither of those is a miss any longer.
