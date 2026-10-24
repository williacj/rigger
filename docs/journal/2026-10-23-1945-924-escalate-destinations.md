<!-- ABOUTME: Records #924's move of escalate to a destination per category, what it left to M6-20a, and what testing it taught. -->

# Escalate names a destination per category

`escalate` is now an object whose keys are the three categories and whose values are
destinations: `'owner'`, or the name of a role the config declares. Every key is optional. The
config validator refuses a key that is no category, a destination that is not a string, a role
the config does not declare, and a role as the destination of critical or a recorded-decision
change. It refuses `escalate` itself where it is a list or any other value that is not an object.
The template and `ARCHITECTURE.md`'s published shape spell all three categories as `'owner'`.

Rigger's own `rigger.config.mjs` drops its `escalate` line rather than spell the object (U42).
The live gate runs the validator pinned at `b1222c9`, which requires a list, and an absent key
passes both validators. Spelling the three as `'owner'` there moves to the M6-close promotion.

The validator rules on the shape only. Two rows of `### R-ESCALATE-13` are runtime rules and are
M6-20a's: a maker-raised ambiguity reaching its role, and an ambiguity whose role is the kind's
own maker or one of its judges going to the owner (`R-ESCALATE-17`). So is `R-ESCALATE-22`, a
category given no destination going to the owner (K66).

`SHAPES.config.escalate` is `{ type: 'object' }`, not a `keys` shape. Two suite-wide tests walk
every `keys` site and assert this repository's config holds something there. A `keys` shape
would have made `escalate` such a site, and the live config holds none.

The first probe for a destination that is not a string survived a guarded mutation removing
that refusal. Each probe value was then refused instead as a role the config does not declare.
A list holding a declared role's name, `['engineer']`, is what tells the two refusals apart,
because `Object.hasOwn` reads it as that name. Three rows could not go red before the code, since
the validator at the base already met them: no `escalate`, and `escalate` as a list or as another
value that is not an object. Guarded mutations show each test discriminates.
