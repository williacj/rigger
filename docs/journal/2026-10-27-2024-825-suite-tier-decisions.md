ABOUTME: Records the source and verification of the suite-tier decision proposal for #825.

# #825 suite-tier decisions

The accepted proposal on #825 separates the permanent two-tier rule from the transitional exemption lists. I placed them in D29 and D30, the lowest unused IDs in the live and retired registers and open proposal diffs at the local drafting check. I will repeat that inventory when the pull request opens, as #825 requires.

The hook header now cites D29 rule 6 for what the hooks run. This proposal changes no executable hook command, suite classification, workflow, requirement, architecture, README contract, or AGENTS instruction. AGENTS.md's "Before you start" remains the current verification authority. Its present wording takes precedence over historical revision 4 sentences, so I did not re-add them.

The proposal text comes from the current #825 acceptance body, which records Part 3, §8 revision 5, U17, U18, the owner's #816 rulings, U33/U36, the staged policy in #921, and #906's protected-head owner ratification. D29 and D30 keep the permanent and transitional lifespans separate. The owner must ratify the proposal by a sound marker at the reviewed head under D25 rule 4.

On the branch base, the coordinator's Node 26 deterministic baseline passed 3,670 tests with nine skips and no failures. On this proposal head, the seven required static commands exited 0. The matrix check reported 62 of 244 requirements have no test. On the proposal worktree, Node 26 npm test passed 3,670 tests with nine skips and no failures. Supported-host CI evidence remains for the configured gates.
