ABOUTME: Records card #1169's hold-notice contract repair: the identities it measured, what each proof run answered, and what stayed unproved.

# Card #1169: hold-notice contract repair

A green over a value no producer can make proves nothing about the notice path. The retired
members handed L3 getters, proxies and marks forged on objects the write side never builds, so
their outcomes stay historical and earn no legal-contract credit here. The replacements take
their values from the producers: L2's `made` comes from the actual `repositoryWriteSide` parsing
the call's output, so a `made` it never parsed cannot pass.

The fault's credit depended on source order. `loop.noticeFailed` emits `unrecorded` only beside
`made`, so removing `made` also removes `unrecorded`, and any earlier read of either would have
redded for another reason. That is why the named assertion is L2's first read of `made`, and why
this fault earns nothing for the unrecorded identity duty.

A JSON `__proto__` key is an own data key after `JSON.parse`, where a plain object literal's
`__proto__` entry sets the prototype instead. L2 reads it through `Object.entries`, so the
expected value is a literal list rather than an object that could not hold the key.

## Source and owner identities

Each hash here is `sha256sum` output, read in the maker's worktree on WSL Ubuntu with Node
26.12.0 on 2026-11-06.

| Identity | Value |
|---|---|
| Base commit and tree | `7dfa63f5ba5d1599cd20936b549cea7cfe2b6e1b`, `5d2b8bfb336110b18f30117416f56c42ec4221b7` |
| Work commit and tree | `f489ccdc405e95094bbaae59a741e2e508ad983b`, `3ef2438ceef1d21c2e9ff40bd38c061c8d8dd01d` |
| Card body | `fb6360bb19881ba197bb880edc9a717bac81049486f2d11e623adf8809356011` |
| Owner-approved original map | `598f6b2af90fd762500df94061afc14ca370827ede0df1d0bb2a6864cb4c796c`, recorded in the card's adoption comments |
| Test preimage at base | `0b7b5bf7e8dc3b18f64fda2258b7c92e0b472800cc3cefb0cf85454fa1cbff1a` |
| Composed patch | `758eac8cedf6c55e6801ea211c9d2f5b06b152804d2431e15525673df152299b` |
| Composed postimage | `5f9f49f23683853e5b82d10605a150992e1e8785772d8bf89b89711cf4f9ddb3` |
| Exact32 patch map | `c450abd6503eb9c57ba41ec01178369165170c36a9e0f959f323890ca430c045` |
| Fault packet | `2584ca0d9392999771c22e928182360fd2bc2342115c0db1b8ee4303c6d8b3cf` |
| Test at the work commit | `645cc60b9f498a94cddddc2179fa535d1af758e2272507b8f5509dc167b7d874` |

The extracted patch, map and fault packet each matched their published hash, and the patch
applied to the preimage reached the postimage hash before any other edit.

These read-only inputs measured the card's values at the work commit:

| Path | SHA-256 |
|---|---|
| `src/workflow/status-issue.mjs` | `f6858ff3656b9ef56de81935b80c68ca349f6b611ef90d7a4e7298991929d256` |
| `src/substrate/forge/repository-write.mjs` | `f9f03740d4c26b7403f8e55aa2f3a05b06312732051c2131d9f4c75f0c098687` |
| `src/substrate/forge/write-made.mjs` | `e4cd57972e939b96a8f504cc0465b5125ac01f488c708e1ddae992eb78b246e9` |
| `src/scheduling/loop.mjs` | `494bb55d50598d67fad8d8bba985a62b0a2892eb52317e01898be2720caadca4` |
| `src/cli/once.mjs` | `e972d52f1188889bc8d3e040fce800ba4bdae38da2450113120739d614796b23` |
| `scripts/mutation-receipt.mjs` | `b748d35de9abb4b473bf8b20f1ac9af052e65b48e1010797103168f8687b1b99` |
| `test/write-made-fixtures.mjs` | `58d3fce9ebaf3ae3b5fb421d68a6102e457a3ef5602c3fbdd66da78338b6dae3` |

## Conservation

Measured by a read-only script comparing the base with the work commit.

Each of the eight map operations' preimages occurs once at base and never at the work commit, and
each matches its `preimageSHA256`. A1's replacement occurs once. `hostileFailed` has no remaining
reference, so its definition and direct explanation went with D1856's rewrite. The three blank
lines at D1858's site stay.

These spans are byte-identical at base and the work commit:

| Span | SHA-256 | Bytes |
|---|---|---|
| The loop holding D1820-D1823's bodies | `8448f6eb88ea8e2c62313dfc401d0d6e076d82cf2e5761c913977ee95ecf5ea1` | 3901 |
| D1806 | `f545c349428da580c7486fe17b5fbb919245dc9b9f7d977e5a89bd94dc010a55` | 1621 |
| D1807 | `1d5617ded1e15a32261d9162a0ab1600999ded6aff981d570d0ed4cef206fce9` | 1068 |
| L1, the combined opening, state-read and board-read control | `f6e0a469d7ff92ae87a3661da75ebb38836c8af8f9fa22b1a33a2da6ba222072` | 1410 |
| L4, the P6 claimed-move control | `b562ebf331cbddb1f24a12f7baf3039df9b15545d67f8d1e528417fc2abb0e37` | 1288 |
| PR1196's no-clock control | `1f9035f7117ac227c229a474bedecc674aa24ba33bf9874278b964df1d306235` | 1806 |

The generated matrix holds 245 rows at both refs, and 216 claim a test at both. No id was lost or
gained, and R-SCHED-23's is the only row changed: seven of this file's titles left it and three
arrived, D1856's and D1892's new titles and L2's. This file's `// proves` ids are the same six at
both refs.

The suite's count fell from 5140 tests (baseline B1, PID 1358, at the base) to 5108 at the work
commit. That is the map's arithmetic: 26 generated members and 6 registrations retired, D1858's
empty envelope removed, and L2 added.

## Fixtures

L2's double follows `repositoryWriteRunner`'s `send(command, args, options)` seam. It verifies
the exact `gh api repos/acme/widgets/issues/12/comments -X POST -f body=...` route, applies
`forge`'s own comment once, then throws `refusedCall` with a saved `unrecordedKill()` list, and
refuses any other call. Nothing in it is already marked made, and no real `gh`, network or agent
runs.

## Guarded discrimination

The one official `mutation:receipt` ran at the work commit, PID 207653, exit 0, stdout SHA-256
`c1842a0721b28c454a115a4464a1ddecbf5786cc1a32c11f73b701015c753424`, stderr SHA-256
`226eccf051650be30b04585c12a51ca9d27b2f77cf9d355550d3e66b161e0fce`.

| Receipt field | Value |
|---|---|
| Anchor | expected 1, found 1 |
| Original selected run | exit 0, 1 test, passed |
| Mutant selected run | exit 1, 1 test, failed, not timed out |
| `failures[0].kind` | `assertion` |
| `failures[0].error.message` | `MADE-JSON actual made answer retained` |
| Restored selected run | exit 0, 1 test, passed |
| Restoration | preimage, before-run and after-run hashes all `f6858ff3656b9ef56de81935b80c68ca349f6b611ef90d7a4e7298991929d256`, status empty |

Check 4, the mutation's effect: the receipt's diff shows only `made,` gone from the return at
`status-issue.mjs` line 182, with `step`, `cause` and the whole optional `unrecorded` expression
left, and the failure's stack names the named assertion's line. `made` then read undefined in the
notice, as the fault intended. The worktree's own source hash was unchanged afterwards, because
the tool mutates its own copy.

## Final results

Each ran once through the recorder, which keeps complete separate streams and the direct child
exit outside the worktree, for the judges.

| Run | Ref | PID | Exit | Result | stdout SHA-256 |
|---|---|---|---|---|---|
| Focused `npm test -- test/hold-notice-loop.test.mjs` | work tree before commit | 804 | 0 | 85 tests, 85 pass, 0 fail | `35de88e86d063c027136eddfc3ba7620c6044b4330a3b3a67267c9ebc6b0edf1` |
| `npm run matrix` | work tree before commit | 1029 | 0 | 29 of 245 requirements have no test | `77b48507babe92ba94c857bdf028ce97884a401bd2adf9462709d17a3298aa9d` |
| `npm run matrix:check` | work tree before commit | 1147 | 0 | 29 of 245 requirements have no test | `77b48507babe92ba94c857bdf028ce97884a401bd2adf9462709d17a3298aa9d` |
| Commit hook | work commit | 1321 | 0 | 5108 tests, 5099 pass, 0 fail, 9 skipped | stderr `6943a7b49e4322b1e5bf8f3d56aeba34f37f1f16c56b00b1ae66f53e54befe80` |
| `npm test` | work commit | 301159 | 0 | 5108 tests, 5099 pass, 0 fail, 9 skipped | `2845d6a677d6be2b6b05d78675d778d465cc7ed894c3db51b689b2a4336d15f0` |

The full run reports the four Error controls, D1806, L1 and L4 passing by name. The hook run on the
commit holding this entry is the full deterministic run at the reviewed head; the pull request
carries it, because an entry cannot name the commit that holds it.

## Host impact

No source under `src/` changed, and the retained delta is this test, its generated matrix row and
this entry. `sh test/suite.sh --list host` does not list the test, and L2's double runs no process.
So this card crosses no new host boundary, and no host check was run on that premise. The
architect is asked to attack that determination. macOS and any other supported host unavailable
here stay unproved until CI supplies evidence.
