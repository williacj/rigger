<!-- ABOUTME: Records the isolation mutation that exposed a zombie-permitting premise in card 1466's added tests. -->

# Card 1466 — reject zombie premises

The guarded isolation-all mutation ended the concurrent dispatch's M6, but new T5
stayed green: assertUntouched checks signal 0 and excludes stopped processes, and
an unreaped zombie satisfies both. The retained receipt is
1466-mutation-isolation-all.json in the external codex-1466-tmp directory. This
survival earns no isolation proof credit.

The new T5 assertion now rejects a zombie explicitly. The same added assertion
protects the live-process premises in new T1, T3 and T6. The command
rg -n 'assertUntouched\(' test/ enumerated the helper's consumers; its existing
callers and implementation remain outside this card's bounded test grants.
The PR names that existing limitation for the coordinator.

On 2026-11-23, the four strengthened host cases passed in
1466-zombie-green.log. With the cross-dispatch cleanup fault applied and read
back, T5 failed by named assertion, “the other dispatch M6 was ended”, in
1466-zombie-red.log. Its guarded source restoration was byte-exact and the
source's git status clean (1466-zombie-red-guard.log). No production change was
needed. The final-head receipts and suites accompany the PR.
