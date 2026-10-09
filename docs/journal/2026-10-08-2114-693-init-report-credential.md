ABOUTME: Records the controlled init report cause and the bounded credential tests for card #693.

# A target path can satisfy a credential component assertion

The complete controlled run on observed source `f992429cf6af6f27cf4c62aef3221bcbacd6297d` reproduced I1's old report assertion. Its ordered trace classified the match in the target header alone. Git returned synthetic userinfo, while the written config and other report fields omitted it. A disjoint target with the same production source passed. The historical Actions log identifies only the assertion, so this local cause is not attributed to the historical host.

The revised fixture chooses and checks a target disjoint from both fixture strings before reading the remote. The old production source passes with that fixture. A guarded mutation that deliberately appended the remote answer to the report made the revised I1 assertion fail, showing that the disjoint target still leaves remote-derived material detectable. The mutation was removed after the controlled run.

The failure-result tests exposed a separate report path: git can echo a credential-bearing URL in a nonzero or not-started reason. `init` now removes URL userinfo before printing that reason while retaining its exit class. The affected file passed 51 of 51 tests before the final full-suite gate. Complete local originals and traces are kept privately when their byte audit blocks public upload; the public ledger identifies each by hash and cause.
