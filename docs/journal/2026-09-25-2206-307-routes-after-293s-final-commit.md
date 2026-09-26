ABOUTME: Records card #307, which closes the boundary-test routes #293's judges found after
`c2f3107`, and what each one taught about the reader.

# 2026-09-25 — The routes after #293's final commit

**One `new` is not one object.** The reader named an instance by the `new` that built it, so a
write through one instance reached no other. That holds only where the `new` runs once. A `new`
inside a function builds an instance on every call, and all of them share the name. A write to
this call's instance therefore replaced the method on an instance an earlier call had kept outside
the function. The fix reads where the value was stored, not where it was built. An instance read out
of a binding or an object that outlives the call is marked `earlier`. A write through this call's
instance still reaches it, but replaces nothing on it.

**A destructuring pattern is a property read.** The reader followed a callee through a plain
alias and an object's member, but a name a pattern binds held nothing. Treating each name a pattern
binds as a member read of what the pattern destructures reuses the member reader whole. Lists
needed a value kind of their own, and a numeric index needed `keyOf` to return a key. After that,
defaults, rest elements, assignments and parameters all came from the same function.

**Rule 3's patterns read literals structurally.** Before this card, "`board` reaches the pattern"
meant `board` was the whole value. Matching the pattern against the literal it is given, position
by position and key by key, keeps `[{ priority }, board] = [item, deps.board]` passing. A test that
only looked for `board` anywhere inside the literal would have refused it.

**The entry point is an export, not a name.** Rule 8's guard read the exported name while the rule
matched the local one, so a rename passed both. The rule now resolves the export and matches
whatever it resolves to. That also covers a re-export from another module.

**Fail-closed left in place.** A per-call instance assigned to an outer binding and then written
and called through that same binding within one call now keeps the class's method, a false
positive. Telling the two apart needs flow order within a call, which this reader does not have.

**Round 1: age travels with the container.** Marking an instance `earlier` only where it was read
out of an outer binding missed an instance held in `{ first: x }` or `[x]`, a container built on
the same call and then kept outside. What a container outlives, its contents outlive too. So a
container read as `earlier` now passes that on to every value read out of it. Object and list
literals built inside a function are per-call values on the same terms as a `new`, which also
closes the object-literal sibling. A spread of `board` into an object literal gives that object
`board`'s `priority`, so such a literal now counts as `board` wherever Rule 3 looks for it.
