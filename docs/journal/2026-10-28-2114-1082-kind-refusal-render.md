ABOUTME: Journal for #1082 (M7-57): a kind's maker or a judge's role with no string form now
earns a refusal naming it, where `validate` threw before.

# #1082: a kind refusal that cannot write its value

**Merge base:** `b85fd3845756` (`origin/main`, #1113's merge as PR #1114), which holds #1077's
merge `fe715a47`. `src/config/validate.mjs` is byte-identical between the card's `8bb1e80a` and
this base (`git diff --stat 8bb1e80a b85fd384 -- src/config/validate.mjs` printed nothing), so
every Table K line sits at the same number at the merge base, with the same text. No site moved,
changed or is gone.

## Table K's lines at the merge base

| Card's line | At `b85fd384` | What it is |
|---|---|---|
| L322–376 | L322–376 | `readKinds` |
| L329 | L329 | `roles.owner` is reserved |
| L333 | L333 | the maker's guard, `Object.hasOwn(roles, kind.maker)` |
| L334 | L334 | the maker that is no role |
| L349 | L349 | `makerProviders(roles[kind.maker])` |
| L354 | L354 | the maker also a judge |
| L362 | L362 | a judge named more than once |
| L367 | L367 | a judge that is no role |
| L372 | L372 | the owner judges last |
| L410–440 | L410–440 | `readJudgeEntry` |
| L413, L422, L423, L425, L427, L431 | the same | `readJudgeEntry`'s `inspect` renderings |
| L435 | L435 | a provider map holding no key for the maker's provider |
| L633–653 | L633–653 | `readKindSteps` |
| L643 | L643 | the steps are no list of names |
| L649 | L649 | a step `provisioning` does not declare |

At the head, the two helpers `written` and `declaresRole` sit above `names`, so each `readKinds`
line moves 19 lines down, and L349 becomes two lines: the maker's providers are read once into
`providers` before the judges are mapped.

## The fix

- `declaresRole(roles, name)` is `Object.hasOwn` with a conversion that throws read as "no role".
  L333's guard uses it, and L349 reads `roles[kind.maker]` only where it holds.
- `written(value)` is the template's own rendering, falling back to `inspect` where the template
  throws. L334, L354, L362 and L367 write their value through it. Every value whose string form
  does not throw keeps its merge-base text (option (a) of the attack, finding 3).

## Red runs, each before its code

Each command ran in this worktree, with only the tests named so far written and the code for the
earlier ones in place. Each red is a throw from `validate`, which the test's `answer` turns into
an assertion naming it.

1. K5 and K1, before any code: `node --test test/config-unrenderable.test.mjs` exited 1.
   - `✖ unrenderable values at one kind's maker and at another kind's judge earn the refusals their string twin earns, never a throw`
     `AssertionError [ERR_ASSERTION]: validate threw for a Symbol: Cannot convert a Symbol value to a string`
   - `✖ a kind's maker that cannot be made a string earns one refusal naming the maker and the value as inspect renders it`
     `AssertionError [ERR_ASSERTION]: validate threw for a Symbol at kinds.change.maker: Cannot convert a Symbol value to a string`
2. K2, after the maker's fix and before L367's: `node --test --test-name-pattern="judge's role that cannot" test/config-unrenderable.test.mjs` exited 1.
   - `AssertionError [ERR_ASSERTION]: validate threw for a Symbol at kinds.change.judges.0.role: Cannot convert a Symbol value to a string`
   - K5 was still red here, on the same throw, and went green with L367's fix.
3. K3, before L354's fix: `node --test --test-name-pattern="both a kind's maker" test/config-unrenderable.test.mjs` exited 1.
   - `AssertionError [ERR_ASSERTION]: validate threw for a Symbol: Cannot convert a Symbol value to a string`
4. K4, before L362's fix: `node --test --test-name-pattern="role of two judges" test/config-unrenderable.test.mjs` exited 1.
   - `AssertionError [ERR_ASSERTION]: validate threw for a Symbol: Cannot convert a Symbol value to a string`

With all eight tests written, the merge base's `validate.mjs` restored in place and uncommitted,
the file failed K1 to K5 and passed K6 to K8. The head's file was then copied back, `cmp` found
it byte-identical, and `git status` showed only this card's changes.

## The merge base's answers K6, K7 and K8 pin

Measured with a scratch probe calling `validate` in process on `rigger.config.mjs` at
`b85fd384`, `node` v26.5.0, 2026-10-28. Each text below is what the tests assert.

### K6, where a judge entry is read with `inspect`

- `kinds.change.judges[0]` set to the value (L413):
  - a Symbol: "`kinds.change.judges[0]` is neither a role name nor `{ role, provider }`, and the config gives Symbol(s)";
  - a null-prototype object: "`kinds.change.judges[0].role` is required, and the config does not name it", "`kinds.change.judges[0].provider` is required, and the config does not name it", "`kinds.change.judges` names `undefined`, which is no role the config declares";
  - an object whose `toString` throws: the same three, with "`kinds.change.judges[0].toString` is not a declaration Rigger offers" third.
- `kinds.change.judges[0].provider` set to the value (L427): "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives X", with X `Symbol(s)`, `[Object: null prototype] {}` and `{ toString: [Function: toString] }`.
- `kinds.change.judges[0].provider.claude` set to the value (L427): the same refusal, with X `{ claude: Symbol(s), codex: 'codex' }`, `{ claude: [Object: null prototype] {}, codex: 'codex' }` and `{ claude: { toString: [Function: toString] }, codex: 'codex' }`.

### K7, where a kind refusal writes a constant, a count or a checked name

- `roles.owner` (L329): a Symbol earns "`roles.owner` holds no declarations, and Rigger reads Symbol(s) as none" then "`roles.owner` is reserved: `owner` names the owner, who is never dispatched". The two objects earn "`roles.owner.agent` is required, …", "`roles.owner.provider` is required, …", "`roles.owner.tier` is required, …" (each ending "and the config does not name it"), "`roles.owner.toString` is not a declaration Rigger offers" for the throwing object only, then the reserved refusal.
- `kinds.structure.judges` as `['owner', value]` (L372): a Symbol earns "`kinds.structure.judges[1]` is neither a role name nor `{ role, provider }`, and the config gives Symbol(s)" then "`kinds.structure.judges` names `owner` at position 1 of 2, and the owner judges last". The two objects earn the `role` and `provider` required refusals at `judges[1]`, the `toString` refusal for the throwing object, the owner-last refusal, then "`kinds.structure.judges` names `undefined`, which is no role the config declares".
- `roles.engineer.providerLabels['maker:codex']` set to the value, with `kinds.change.judges[0].provider` as `{ codex: 'codex' }` (L435): "`roles.engineer.providerLabels` must map label names to providers, and the config gives { 'maker:codex': X }", X rendered by `inspect`, then "`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind's maker can run on".
- `kinds.change.provisioning` set to the value (L643), and set to `['npm-ci', value]` (L649's path): "`kinds.change.provisioning` must be a list of step names" for each value. L649 itself is unreachable for these values: `holdsUnnamed` refuses the list at L643 first.
- `kinds.change.select.labels` as `[value]` (`readSelectorLabel`): "`kinds.change.select.labels` must list label names, and holds something else" for each value.

### K8, values whose string form names no declared role

For each of `'nobody'`, `3`, `1n`, `{}`, `['nobody']` and `function nobody() {}`, written by the
template as `nobody`, `3`, `1`, `[object Object]`, `nobody` and `function nobody() {}`:

- the maker of `change` (L334): "`kinds.change.maker` names `S`, which is no role the config declares";
- `change`'s first judge's role (L367): "`kinds.change.judges` names `S`, which is no role the config declares";
- one value as both (L354): the maker refusal, then "`kinds.change` names `S` as both its maker and one of its judges, and no judge is the maker", then the judge refusal;
- one value as both judges' roles (L362): "`kinds.change.judges` names `S` more than once, and each judge of a card has a directory of its own", then the judge refusal twice.

## Row K12: the cases I met

Each compared the merge base's `validate` with the head's on `rigger.config.mjs` changed at the
path named, in process.

- **The same answer at both:** a maker `'constructor'`, `'__proto__'` or `'toString'`, which
  L349 read from `Object.prototype` at the base and the head reads as no role, both giving the
  maker no providers; the same with `change`'s first judge's provider map lacking `claude`; a
  maker `null` or `undefined`; a judge's role `['engineer']`; and K9's two values, `['engineer']`
  and an object whose `toString` returns `'engineer'`, which both accept.
- **A throw at the base, a refusal at the head:** a maker whose `toString` returns a Symbol. The
  key conversion gives that Symbol, so L333 finds no role, and the template throws. The head writes
  "`kinds.change.maker` names `{ toString: [Function: toString] }`, which is no role the config
  declares".
- `test/clock-config.test.mjs`'s parity test, which compares `validate` with `fe715a47^1` over
  every path, passes at the head.
