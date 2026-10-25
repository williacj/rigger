<!-- ABOUTME: Records the environment read's L0 vocabulary and the test-first evidence for card #925. -->

# Environment policy facts at the forge boundary

`readEnvironment` now answers `canAdminsBypass`, `deploymentBranchPolicy`, and `policies`. When a branch policy exists, `deploymentBranchPolicy` holds the separate `protectedBranches` and `customBranchPolicies` facts. It is `null` when GitHub sets no branch policy. L0 carries the flag values unchanged, and `doctor` decides whether those facts and the policy list admit only the default branch.

The first red run was `npm test -- test/forge-read.test.mjs`. The new test, “readEnvironment answers every deployment policy shape without forge field names,” failed on the default branch case: it received `protected_branches` and `custom_branch_policies` where it expected `protectedBranches` and `customBranchPolicies`. After the L0 change and the G1 fixture retargets, that named file passed 90 tests. The new test then moved to `test/doctor.test.mjs`, the dispatch's home for new tests.

The second red run was `npm test -- test/doctor.test.mjs`. The new test, “gate line keeps its whole verdict for every deployment policy answer,” failed on its default branch case: the gate line said the policy must admit only `main` instead of passing. The other failures in that run were existing `doctor` tests reaching the same old flag lookup. After `doctor` read L0's fields, the affected three files passed 234 tests.

The new gate test fixes the complete line for each policy answer in Table A, and the read test crosses the real adapter over the fake `gh`, including null and unreadable policies. The missing GitHub policy field still fails its read; the other cases return a policy answer whose keys have no underscores at any depth.
