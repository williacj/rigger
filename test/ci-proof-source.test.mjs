// ABOUTME: Ordinary recorded-source CI policy cases, evaluated without child processes or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';
import { evaluateCiPolicy, ciFacts, ciProof, ciFullFixture, ciCollectorFixture } from './ci-policy-fixtures.mjs';

test('recorded CI Table A equal start and unmoved main retains full proof', async () => {
  const { facts, proof } = ciFullFixture();
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_EXECUTED');
  const aggregate = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.testedBase, 'c'.repeat(40));
  assert.equal(aggregate.mainAdvanced, false);
  assert.deepEqual(aggregate.source, proof.source);
});

test('recorded CI Table A stale start and unmoved main runs full against the recorded candidate', async () => {
  const { facts, proof } = ciFullFixture();
  facts.main.head = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_EXECUTED');
  const plan = (await evaluateCiPolicy('runPolicy', { action: 'plan', facts }));
  assert.deepEqual(JSON.parse(plan.output.snapshot), proof.source);
  for (const worker of ['fast', 'full_ordinary', 'full_host']) {
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker })).ok, true, worker);
  }
  const aggregate = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.testedBase, 'c'.repeat(40));
  assert.equal(aggregate.currentMain, 'e'.repeat(40));
  assert.equal(aggregate.mainAdvanced, true);
  assert.deepEqual(aggregate.source, proof.source);
});

test('recorded CI Table A equal start then main moves retains the planned proof', async () => {
  const { facts, proof } = ciFullFixture();
  const plan = (await evaluateCiPolicy('runPolicy', { action: 'plan', facts }));
  assert.deepEqual(JSON.parse(plan.output.snapshot), proof.source);
  facts.main.head = facts.live.base = 'e'.repeat(40);
  const aggregate = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.testedBase, 'c'.repeat(40));
  assert.equal(aggregate.currentMain, 'e'.repeat(40));
  assert.equal(aggregate.mainAdvanced, true);
  assert.deepEqual(aggregate.source, proof.source);
});

test('recorded CI Table A stale start then main moves retains only the recorded source', async () => {
  const { facts, proof } = ciFullFixture();
  facts.main.head = 'e'.repeat(40);
  const plan = (await evaluateCiPolicy('runPolicy', { action: 'plan', facts }));
  assert.deepEqual(JSON.parse(plan.output.snapshot), proof.source);
  facts.main.head = 'f'.repeat(40);
  const aggregate = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.testedBase, 'c'.repeat(40));
  assert.equal(aggregate.currentMain, 'f'.repeat(40));
  assert.equal(aggregate.mainAdvanced, true);
  assert.deepEqual(aggregate.source, proof.source);
});

test('recorded CI Table A changed head refuses old proof with main moved or unmoved', async () => {
  for (const main of ['c', 'e']) {
    const { facts, proof } = ciFullFixture();
    facts.main.head = main.repeat(40); facts.live.head = 'f'.repeat(40);
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID');
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, false);
  }
});

test('recorded CI Table A nonowner full label runs no full worker', async () => {
  const { facts, proof } = ciFullFixture(); facts.sender = 'contributor';
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
  for (const worker of ['full_ordinary', 'full_host']) {
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker })).ok, false, worker);
  }
});

test('recorded CI Table A draft closed and nonmain remain classified as at base', async () => {
  for (const [change, mode] of [['draft', 'BROAD_DEFERRED'], ['closed', 'INVALID'], ['nonmain', 'FAST_ELIGIBLE']]) {
    const { facts, proof } = ciFullFixture();
    if (change === 'draft') facts.pr.draft = facts.live.draft = true;
    if (change === 'closed') facts.pr.state = facts.live.state = 'closed';
    if (change === 'nonmain') facts.pr.baseRef = facts.live.baseRef = 'batch';
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, mode, change);
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'full_host' })).ok, false, change);
  }
});

test('recorded CI nonmain policy retains the original recorded versus current base guard', async () => {
  const facts = ciFacts(); facts.pr.baseRef = facts.live.baseRef = 'batch';
  facts.live.base = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID', 'updated nonmain PR base remains refused');
});

test('recorded CI Table A label removal and another-label events remain deferred', async () => {
  for (const change of ['removed', 'unlabeled', 'other-label']) {
    const { facts, proof } = ciFullFixture();
    if (change === 'removed') facts.live.labels = [];
    if (change === 'unlabeled') facts.action = 'unlabeled';
    if (change === 'other-label') { facts.label = 'unrelated'; facts.live.labels.push('unrelated'); }
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED', change);
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'full_host' })).ok, false, change);
  }
});

test('recorded CI proof refuses each changed immutable identity despite legitimate main drift', async () => {
  const { facts, proof } = ciFullFixture(); facts.main.head = facts.live.base = 'e'.repeat(40);
  for (const [key, value] of [
    ['sha', 'f'.repeat(40)], ['tree', 'f'.repeat(40)], ['parents', ['e'.repeat(40), 'd'.repeat(40)]],
    ['parents', ['d'.repeat(40), 'c'.repeat(40)]], ['head', 'f'.repeat(40)], ['base', 'e'.repeat(40)],
    ['baseRef', 'batch'], ['ref', 'refs/pull/8/merge'], ['event', 'push'],
  ]) {
    const changed = structuredClone(proof); changed.source[key] = value;
    assert.equal((await evaluateCiPolicy('guard', facts, changed)), false, key + ':' + JSON.stringify(value));
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: changed })).ok, false, key);
  }
  const nonmain = structuredClone(facts); nonmain.pr.baseRef = nonmain.live.baseRef = 'batch'; nonmain.live.base = 'c'.repeat(40);
  const nonmainProof = ciProof(); nonmainProof.source.baseRef = 'batch';
  const aggregate = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts: nonmain, proof: nonmainProof }));
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.testedBase, 'c'.repeat(40));
  assert.equal(aggregate.currentMain, 'e'.repeat(40));
  assert.equal(aggregate.mainAdvanced, null, 'main advancement is inapplicable to a nonmain base');
});

test('recorded CI nonmain collector retains the original live base branch guard', async () => {
  const fixture = ciCollectorFixture();
  fixture.event.pull_request.base.ref = fixture.api['/repos/williacj/rigger/pulls/7'].base.ref = 'batch';
  fixture.api['/repos/williacj/rigger/git/ref/heads/batch'] = { object: { sha: 'e'.repeat(40) } };
  const collected = (await evaluateCiPolicy('collect', fixture)).answer;
  assert.equal(collected.complete, false, 'a moved nonmain base branch remains refused');
  assert.equal((await evaluateCiPolicy('policy', collected)).mode, 'INVALID');
});

test('recorded CI collector fails closed on unavailable visibility and malformed source facts', async () => {
  for (const change of ['missing-main', 'malformed-main', 'missing-current-base', 'changed-current-head', 'wrong-recorded-parent']) {
    const fixture = ciCollectorFixture();
    if (change === 'missing-main') delete fixture.api['/repos/williacj/rigger/git/ref/heads/main'];
    if (change === 'malformed-main') fixture.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = 'invalid';
    if (change === 'missing-current-base') delete fixture.api['/repos/williacj/rigger/pulls/7'].base.sha;
    if (change === 'changed-current-head') fixture.api['/repos/williacj/rigger/pulls/7'].head.sha = 'e'.repeat(40);
    if (change === 'wrong-recorded-parent') fixture.git[JSON.stringify(['show', '-s', '--format=%P', 'HEAD'])] = Buffer.from('e'.repeat(40) + ' ' + 'd'.repeat(40) + '\n').toString('base64');
    const facts = (await evaluateCiPolicy('collect', fixture)).answer;
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID', change);
  }
});


/** Reads the real name expression; this evaluator covers only the admitted canonical producer domain.
 * GitHub missing properties are empty strings. String equality is case-insensitive there; all
 * compared strings in this bounded fixture domain already have their canonical spelling.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
 * https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
 */
function aggregateDisplayName(needs) {
  const job = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs.check;
  assert.equal(typeof job.name, 'string', 'the aggregate job declares its display name');
  assert.match(job.name, /^\$\{\{[\s\S]*\}\}$/);
  const context = { plan: { result: needs.plan?.result ?? '', outputs: { mode: needs.plan?.outputs?.mode ?? '' } } };
  return new Function('needs', 'return (' + job.name.slice(3, -2).trim() + ')')(context);
}

test('successful deferred plan uses a nonrequired aggregate display name', () => {
  assert.equal(aggregateDisplayName({ plan: { result: 'success', outputs: { mode: 'BROAD_DEFERRED' } } }), 'broad deferred (26)');
});

test('canonical nondeferred or unsuccessful plans retain the exact required aggregate name', () => {
  for (const needs of [
    { plan: { result: 'success', outputs: { mode: 'FAST_ELIGIBLE' } } },
    { plan: { result: 'success', outputs: { mode: 'BROAD_EXECUTED' } } },
    { plan: { result: 'success', outputs: { mode: 'MAIN_SMOKE' } } },
    { plan: { result: 'success', outputs: { mode: 'MAIN_FULL' } } },
    { plan: { result: 'success', outputs: { mode: 'INVALID' } } },
    { plan: { result: 'success', outputs: { mode: 'UNKNOWN' } } },
    { plan: { result: 'failure', outputs: { mode: 'BROAD_DEFERRED' } } },
    { plan: { result: 'cancelled', outputs: { mode: 'BROAD_DEFERRED' } } },
    { plan: { result: 'skipped', outputs: { mode: 'BROAD_DEFERRED' } } },
    { plan: { outputs: { mode: 'BROAD_DEFERRED' } } },
    { plan: { result: 'success', outputs: {} } },
    { plan: { result: 'success' } },
    {},
  ]) assert.equal(aggregateDisplayName(needs), 'check (26)', JSON.stringify(needs));
});

test('deferred naming preserves refusal and later source invalidation supplies no proof', async () => {
  const facts = ciFacts(); facts.changes[0].path = 'src/workflow/action.mjs';
  const proof = ciProof('BROAD_DEFERRED');
  const planned = { plan: { result: 'success', outputs: { mode: 'BROAD_DEFERRED' } } };
  const refused = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'missing-current-batch-proof: explicitly request full proof for the current head and base');
  assert.equal(aggregateDisplayName(planned), 'broad deferred (26)');
  facts.live.head = 'e'.repeat(40);
  const invalidated = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(invalidated.ok, false);
  assert.equal(aggregateDisplayName(planned), 'broad deferred (26)', 'a selected name does not change after planning');
  const eligible = ciFullFixture(); eligible.facts.live.head = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...eligible })).ok, false);
  assert.equal(aggregateDisplayName({ plan: { result: 'success', outputs: { mode: 'BROAD_EXECUTED' } } }), 'check (26)');
});

test('aggregate naming preserves the required job routing matrix and failure boundary', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['check', 'demo', 'fast', 'full_host', 'full_ordinary', 'nightly', 'plan']);
  assert.deepEqual(ci.jobs.check.needs, ['plan', 'fast', 'full_ordinary', 'full_host', 'demo']);
  assert.equal(ci.jobs.check.if, "${{ always() && !(needs.plan.result == 'success' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' && needs.plan.outputs.mode == 'MAIN_FULL') }}");
  assert.deepEqual(ci.jobs.check.strategy, { 'fail-fast': 'false', matrix: { node: ['26'] } });
  assert.equal(ci.jobs.check['runs-on'], 'ubuntu-latest');
  assert.equal(ci.jobs.check['continue-on-error'], undefined);
  assert.equal(ci.jobs.check.steps.at(-1).run, 'node --input-type=module -e "$CI_POLICY"');
  assert.equal(ci.jobs.check.steps.at(-1).env.CI_POLICY_ACTION, 'aggregate');
  assert.equal(ci.jobs.check.steps.at(-1).if, undefined);
  assert.equal(ci.jobs.check.steps.at(-1)['continue-on-error'], undefined);
});
