ABOUTME: Card #189 records why the PM prompt separates an architect's ruling from cutting cards.

# A ruling before cards exist

The M1 decomposition needed a coordinator brief to tell the PM that decomposition belonged to it.
The PM prompt described only requirements, although D18 rule 4 assigned decomposition to the PM.
The prompt also named the architect's ruling as a handoff without ordering it in the PM's procedure.

The proposed decomposition can be reviewed before the PM cuts cards. Its pull request carries the
proposed division of work for the architect's ruling under D18 rule 5. After that ruling, the PM
can put draft cards and their acceptance in the same proposal before filing them. This order
avoids presenting a set of drafted cards as if it already had a structural ruling.

The prompt change leaves requirement proposals and the PM's existing boundaries intact. The PR
body inventories the obligations at `306d5e9` and compares them with the changed prompt.

The first post-edit `npm test` failed in `test/init.test.mjs`: the forked PM prompt differed from
the source that `init` writes. The same wording now sits in `templates/claude/agents/pm.md` and
`.claude/agents/pm.md`, as that test requires.
