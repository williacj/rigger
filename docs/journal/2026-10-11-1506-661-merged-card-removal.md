ABOUTME: Records card 661's merged-card removal work: what must happen before Done, why a lock
remains a blocker, and what the scratch-rule mutations proved.

# A merge is not the Done move

The lane records `merge.end` before L1 removes the card's directories. A later pull does the same
when it reads a person's merge. L2 moves the card to Done only after removal reports no failure.
That order lets a later pull retry a failed or interrupted removal while the card remains in
Review or Owner.

# A refusal and a failed removal have different effects

L1 checks each on-disk role entry under the judge and scratch topic directories using the same
replace rules as their makes. A path those rules refuse is left and named. A removal that began
and failed is also named, but prevents Done. A person-locked worktree prevents Done even before a
remove command starts; unlocking it belongs to the person who locked it. An `ADDING` lock belongs
to Rigger's interrupted make and can be lifted.

# Gone worktrees can keep registrations

Git can still list a worktree after its directory is gone. L1 prunes these registrations after the
removal pass. Git leaves a person-locked registration in place. A second pass over directories
already gone changes nothing and records no removal event.

A gone judge worktree needs a registration read even when its role directory is absent from disk.
The first removal pass found no child to inspect and let a person-locked registration through to
Done. The test for that state failed; L1 now names the stale locked path and holds the card until
its lock is lifted. It unlocks an interrupted `ADDING` registration before pruning it.

# The scratch clauses each have a discriminating test

Seven guarded mutations of `src/execution/workspace.mjs` each made a `// proves` test in
`test/role-dispatch.test.mjs` fail. They separately removed the checks on the `scratch` directory,
the card directory beneath it, the role path, a checkout above, a checkout inside, a repository
worktree at or above the path, and a repository worktree inside it. Each mutation was restored
before the next run. The PR records the source lines and failure output.
