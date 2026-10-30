// ABOUTME: Ordinary recorded-source CI policy cases, evaluated without child processes or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';
import { evaluateCiPolicy, ciFacts, ciProof, ciFullFixture, ciCollectorFixture } from './ci-policy-fixtures.mjs';
import { ciDiscoveryFixture, ciFullReceiptFixture } from './ci-policy-fixtures.mjs';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { ciReuseFixture, ciRunCollectorFixture, ciArtifactZip, ciBudgetArchive } from './ci-policy-fixtures.mjs';

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


/** Reads the actual literal name; caller scenarios remain an input inventory, not expression execution. */
function aggregateDisplayName(_needs) {
  const job = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs.check;
  assert.equal(typeof job.name, 'string', 'the aggregate job declares its display name');
  return job.name;
}

test('successful deferred plan retains the exact required aggregate display name', () => {
  assert.equal(aggregateDisplayName({ plan: { result: 'success', outputs: { mode: 'BROAD_DEFERRED' } } }), 'check (26)');
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
  assert.equal(aggregateDisplayName(planned), 'check (26)');
  facts.live.head = 'e'.repeat(40);
  const invalidated = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(invalidated.ok, false);
  assert.equal(aggregateDisplayName(planned), 'check (26)', 'the required name remains fixed after source invalidation');
  const eligible = ciFullFixture(); eligible.facts.live.head = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...eligible })).ok, false);
  assert.equal(aggregateDisplayName({ plan: { result: 'success', outputs: { mode: 'BROAD_EXECUTED' } } }), 'check (26)');
});

test('aggregate naming preserves the required job routing matrix and failure boundary', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['cancel_superseded', 'check', 'demo', 'fast', 'full_host', 'full_ordinary', 'nightly', 'plan']);
  assert.deepEqual(ci.jobs.check.needs, ['plan', 'fast', 'full_ordinary', 'full_host', 'demo', 'cancel_superseded']);
  assert.equal(ci.jobs.check.if, "${{ always() && !(needs.plan.result == 'success' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' && needs.plan.outputs.mode == 'MAIN_FULL') }}");
  assert.deepEqual(ci.jobs.check.strategy, { 'fail-fast': 'false', matrix: { node: ['26'] } });
  assert.equal(ci.jobs.check['runs-on'], 'ubuntu-latest');
  assert.equal(ci.jobs.check['continue-on-error'], undefined);
  const policySteps = ci.jobs.check.steps.filter((step) => step.id === 'policy');
  const aggregateSteps = ci.jobs.check.steps.filter((step) => step.env?.CI_POLICY_ACTION === 'aggregate');
  assert.equal(policySteps.length, 1, 'exactly one actual policy-id step');
  assert.equal(aggregateSteps.length, 1, 'exactly one actual aggregate-action step');
  const aggregate = aggregateSteps[0];
  assert.equal(aggregate, policySteps[0], 'policy id and aggregate action identify the same actual step');
  assert.equal(aggregate.run, 'node --input-type=module -e "$CI_POLICY"');
  assert.equal(aggregate.env.CI_POLICY_ACTION, 'aggregate');
  assert.equal(aggregate.if, undefined);
  assert.equal(aggregate['continue-on-error'], undefined);
  const uploads = ci.jobs.check.steps.filter((step) => step.uses === 'actions/upload-artifact@v7');
  assert.equal(uploads.length, 1, 'one separate receipt-upload step');
  assert.notEqual(uploads[0], aggregate, 'receipt upload is not the aggregate');
  assert.ok(ci.jobs.check.steps.indexOf(uploads[0]) > ci.jobs.check.steps.indexOf(aggregate), 'receipt upload follows the actual aggregate');
});

/** A recorded authenticated forward checkout; each case supplies its own provenance premise. */
function forwardFacts() {
  const facts = ciFacts(); facts.pr.testedBase = facts.checkout.parents[0] = 'e'.repeat(40);
  return facts;
}

test('equal PR collector records the authenticated checkout parent as testedBase without ancestry', async () => {
  const fixture = ciCollectorFixture();
  const { answer, calls } = await evaluateCiPolicy('collect', fixture);
  assert.equal(answer.complete, true);
  assert.equal(answer.pr.base, 'c'.repeat(40));
  assert.equal(answer.pr.testedBase, 'c'.repeat(40));
  assert.equal(Object.hasOwn(answer.pr, 'eventBaseAncestor'), false);
  assert.deepEqual(calls, [['rev-parse', 'HEAD'], ['rev-parse', 'HEAD^{tree}'], ['show', '-s', '--format=%P', 'HEAD'], ['diff', '--raw', '-z', '--no-renames', 'c'.repeat(40), 'a'.repeat(40)]]);
});

test('PR snapshots retain explicit eventBase beside the authenticated tested base', async () => {
  const plan = await evaluateCiPolicy('runPolicy', { action: 'plan', facts: ciFacts() });
  assert.deepEqual(JSON.parse(plan.output.snapshot), {
    event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'a'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40),
  });
});

test('PR policy refuses missing malformed or mismatched testedBase', async () => {
  for (const testedBase of [undefined, '', 'invalid', 'e'.repeat(40)]) {
    const facts = ciFacts(); facts.pr.testedBase = testedBase;
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID', String(testedBase));
  }
});

test('main policy accepts only authenticated forward event-base provenance', async () => {
  const facts = ciFacts(); facts.checkout.parents[0] = facts.pr.testedBase = 'e'.repeat(40);
  facts.pr.eventBaseAncestor = true; facts.main.head = facts.live.base = 'f'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'FAST_ELIGIBLE');
  const plan = await evaluateCiPolicy('runPolicy', { action: 'plan', facts });
  assert.deepEqual(JSON.parse(plan.output.snapshot), {
    event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'a'.repeat(40), tree: 'b'.repeat(40),
    parents: ['e'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'e'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40),
  });
});

/** Git's documented --is-ancestor success is empty output with exit zero; native controls verify it.
 * https://git-scm.com/docs/git-merge-base
 */
function forwardCollectorFixture() {
  const fixture = ciCollectorFixture();
  fixture.git[JSON.stringify(['show', '-s', '--format=%P', 'HEAD'])] = Buffer.from('e'.repeat(40) + ' ' + 'd'.repeat(40) + '\n').toString('base64');
  fixture.git[JSON.stringify(['merge-base', '--is-ancestor', 'c'.repeat(40), 'e'.repeat(40)])] = '';
  fixture.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'e'.repeat(40), 'a'.repeat(40)])] = Buffer.from(':000000 100644 0000000 1234567 A\0docs/journal/a.md\0').toString('base64');
  return fixture;
}

test('differing main bases require one forward ancestry command before collector provenance', async () => {
  const { answer, calls } = await evaluateCiPolicy('collect', forwardCollectorFixture());
  assert.equal(answer.complete, true);
  assert.equal(answer.pr.base, 'c'.repeat(40));
  assert.equal(answer.pr.testedBase, 'e'.repeat(40));
  assert.equal(answer.pr.eventBaseAncestor, true);
  assert.deepEqual(calls.filter((args) => args[0] === 'merge-base'), [['merge-base', '--is-ancestor', 'c'.repeat(40), 'e'.repeat(40)]]);
});

test('candidate classification excludes intervening nonjournal changes before testedBase', async () => {
  const fixture = forwardCollectorFixture();
  fixture.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'c'.repeat(40), 'a'.repeat(40)])] = Buffer.from(':000000 100644 0000000 1234567 A\0src/intervening.mjs\0').toString('base64');
  const { answer, calls } = await evaluateCiPolicy('collect', fixture);
  assert.deepEqual(answer.changes, [{ oldMode: '000000', newMode: '100644', status: 'A', path: 'docs/journal/a.md' }]);
  assert.equal((await evaluateCiPolicy('policy', answer)).mode, 'FAST_ELIGIBLE');
  assert.deepEqual(calls.at(-1), ['diff', '--raw', '-z', '--no-renames', 'e'.repeat(40), 'a'.repeat(40)]);
});

test('aggregate visibility distinguishes eventBase from testedBase and compares main to testedBase', async () => {
  const facts = forwardFacts();
  facts.pr.eventBaseAncestor = true; facts.main.head = facts.live.base = 'e'.repeat(40);
  const proof = ciProof(); proof.source.base = proof.source.parents[0] = 'e'.repeat(40);
  const result = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(result.ok, true);
  assert.equal(result.testedBase, 'e'.repeat(40));
  assert.equal(result.eventBase, 'c'.repeat(40));
  assert.equal(result.mainAdvanced, false);
  facts.main.head = 'f'.repeat(40);
  const moved = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(moved.ok, true); assert.equal(moved.mainAdvanced, true);
  assert.deepEqual(moved.source, { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['e'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'e'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) });
});

test('forward main provenance rejects absent false and nonboolean values', async () => {
  for (const provenance of [undefined, false, null, 1, 'true', {}]) {
    const facts = forwardFacts();
    facts.pr.eventBaseAncestor = provenance;
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID', String(provenance));
  }
});

test('collector refuses each ancestry failure without trusting event provenance', async () => {
  // execFileSync throws for nonzero status, launch errors, timeout and signal; no clock or process is patched.
  for (const properties of [{ status: 1 }, { status: 128 }, { code: 'ENOENT' }, { code: 'ETIMEDOUT', signal: 'SIGTERM' }, { status: null, signal: 'SIGKILL' }]) {
    const fixture = forwardCollectorFixture(); fixture.event.pull_request.eventBaseAncestor = true;
    const key = JSON.stringify(['merge-base', '--is-ancestor', 'c'.repeat(40), 'e'.repeat(40)]);
    Object.defineProperty(fixture.git, key, { get() { throw Object.assign(new Error('controlled ancestry failure'), properties); }, enumerable: true });
    const { answer, calls } = await evaluateCiPolicy('collect', fixture);
    assert.equal(answer.complete, false, JSON.stringify(properties));
    assert.match(answer.reason, /controlled ancestry failure/);
    assert.equal((await evaluateCiPolicy('policy', answer)).mode, 'INVALID');
    assert.equal(calls.filter((args) => args[0] === 'merge-base').length, 1);
    assert.equal(answer.pr?.eventBaseAncestor, undefined);
  }
});

test('ancestry provenance cannot authorize malformed or unrelated checkout identities', async () => {
  for (const corrupt of ['sha', 'event-sha', 'tree', 'head-only', 'reversed', 'extra', 'head', 'live-head', 'ref', 'number', 'owner', 'event-base']) {
    const facts = forwardFacts(); facts.pr.eventBaseAncestor = true;
    if (corrupt === 'sha') facts.checkout.sha = 'f'.repeat(40);
    if (corrupt === 'event-sha') facts.eventSha = '';
    if (corrupt === 'tree') facts.checkout.tree = 'invalid';
    if (corrupt === 'head-only') facts.checkout.parents = ['e'.repeat(40)];
    if (corrupt === 'reversed') facts.checkout.parents.reverse();
    if (corrupt === 'extra') facts.checkout.parents.push('f'.repeat(40));
    if (corrupt === 'head') facts.pr.head = 'f'.repeat(40);
    if (corrupt === 'live-head') facts.live.head = 'f'.repeat(40);
    if (corrupt === 'ref') facts.ref = 'refs/heads/main';
    if (corrupt === 'number') facts.pr.number = 8;
    if (corrupt === 'owner') facts.owner = 'other';
    if (corrupt === 'event-base') facts.pr.base = 'invalid';
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID', corrupt);
  }
});

test('complete PR proof refuses mutations or loss of either immutable base', async () => {
  const facts = forwardFacts(); facts.pr.eventBaseAncestor = true;
  const proof = ciProof(); proof.source.base = proof.source.parents[0] = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('guard', facts, proof)), true);
  for (const key of ['base', 'eventBase', 'sha', 'tree', 'head', 'ref', 'parents']) {
    const changed = structuredClone(proof); changed.source[key] = key === 'parents' ? ['f'.repeat(40), 'd'.repeat(40)] : 'f'.repeat(40);
    assert.equal((await evaluateCiPolicy('guard', facts, changed)), false, key);
  }
  const missing = structuredClone(proof); delete missing.source.eventBase;
  assert.equal((await evaluateCiPolicy('guard', facts, missing)), false);
  const changedEvent = structuredClone(facts); changedEvent.pr.base = 'f'.repeat(40);
  assert.equal((await evaluateCiPolicy('guard', changedEvent, proof)), false);
  const changedTested = structuredClone(facts); changedTested.pr.testedBase = changedTested.checkout.parents[0] = 'f'.repeat(40);
  assert.equal((await evaluateCiPolicy('guard', changedTested, proof)), false);
});

test('nonmain retains both base guards and never receives ancestry provenance', async () => {
  const testedMismatch = ciFacts(); testedMismatch.pr.baseRef = testedMismatch.live.baseRef = 'batch';
  testedMismatch.pr.testedBase = testedMismatch.checkout.parents[0] = 'e'.repeat(40); testedMismatch.pr.eventBaseAncestor = true;
  assert.equal((await evaluateCiPolicy('policy', testedMismatch)).mode, 'INVALID');
  const liveMismatch = ciFacts(); liveMismatch.pr.baseRef = liveMismatch.live.baseRef = 'batch'; liveMismatch.live.base = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', liveMismatch)).mode, 'INVALID');
  const fixture = forwardCollectorFixture(); fixture.event.pull_request.base.ref = fixture.api['/repos/williacj/rigger/pulls/7'].base.ref = 'batch';
  fixture.api['/repos/williacj/rigger/git/ref/heads/batch'] = { object: { sha: 'c'.repeat(40) } };
  const { answer, calls } = await evaluateCiPolicy('collect', fixture);
  assert.equal(answer.pr?.eventBaseAncestor, undefined); assert.equal(calls.some((args) => args[0] === 'merge-base'), false);
  assert.equal((await evaluateCiPolicy('policy', answer)).mode, 'INVALID');
  fixture.api['/repos/williacj/rigger/git/ref/heads/batch'].object.sha = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('collect', fixture)).answer.complete, false);
});

test('a real nonjournal candidate never inherits journal-only base classification', async () => {
  const fixture = forwardCollectorFixture();
  fixture.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'e'.repeat(40), 'a'.repeat(40)])] = Buffer.from(':000000 100644 0000000 1234567 A\0src/candidate.mjs\0').toString('base64');
  const { answer } = await evaluateCiPolicy('collect', fixture);
  assert.equal((await evaluateCiPolicy('policy', answer)).mode, 'BROAD_DEFERRED');
  assert.deepEqual(answer.changes, [{ oldMode: '000000', newMode: '100644', status: 'A', path: 'src/candidate.mjs' }]);
});

test('non-PR routes preserve literal source shapes without event-base fields', async () => {
  for (const [event, mode, demoNeeded] of [['push', 'MAIN_SMOKE', false], ['schedule', 'MAIN_FULL', true], ['workflow_dispatch', 'MAIN_FULL', true], ['merge_group', 'BROAD_EXECUTED', true]]) {
    const facts = ciFacts(); delete facts.pr; delete facts.live;
    facts.event = event; facts.ref = 'refs/heads/main'; facts.main.head = 'a'.repeat(40);
    facts.after = 'a'.repeat(40);
    if (event === 'merge_group') facts.group = { head: 'a'.repeat(40), base: 'a'.repeat(40), baseRef: 'refs/heads/main', baseAncestor: true };
    assert.deepEqual(await evaluateCiPolicy('policy', facts), { mode, demoNeeded, sourceValid: true }, event);
    const plan = await evaluateCiPolicy('runPolicy', { action: 'plan', facts });
    assert.equal(plan.ok, true, event);
    assert.deepEqual(JSON.parse(plan.output.snapshot), { event, ref: 'refs/heads/main', sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'a'.repeat(40), base: 'a'.repeat(40), baseRef: event === 'merge_group' ? 'refs/heads/main' : 'main' });
  }
});

// Diagnostic CI signal selection/propagation under #1119 Q1/Q2; no product requirement is claimed.
test('discovery uses provided or single default signal for transport and native decode', async (t) => {
  const supplied = new AbortController(), fallback = new AbortController(), cells = [];
  let observing;
  const observer = nativeInflationObserver(t, (record) => observing.signals.push(record.signal));
  try {
    for (const mode of ['provided', 'omitted']) {
      const fixture = ciDiscoveryFixture(), cell = { mode, delays: [], signals: [], native: [], requests: [], sends: [] };
      observing = cell;
      const nativeStart = observer.records.length;
      // Node's documented mock.method replaces the constructor; returning a manual signal arms no deadline.
      const timeout = t.mock.method(AbortSignal, 'timeout', (delay) => { cell.delays.push(delay); return fallback.signal; });
      try {
        cell.answer = await evaluateCiPolicy('discoverFullProof', fixture.facts, {
          ...(mode === 'provided' ? { signal: supplied.signal } : {}), token: 'fixture-token',
          request: async (path) => {
            cell.requests.push(path);
            if (!Object.hasOwn(fixture.api, path)) throw new Error('unexpected discovery fixture request');
            return fixture.api[path];
          },
          send: async (url, options) => {
            cell.sends.push(url); cell.signals.push(options.signal);
            if (cell.sends.length === 1 && url === 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip')
              return new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
            if (cell.sends.length === 2 && url === 'https://account.blob.core.windows.net/receipt')
              return new Response(Buffer.from(fixture.archive, 'base64'));
            throw new Error('unexpected artifact fixture request');
          },
        });
        await observer.wait();
        cell.native = observer.records.slice(nativeStart).map(({ code, returnedBytes, consumedBytes }) => ({ code, returnedBytes, consumedBytes }));
      } finally { timeout.mock.restore(); }
      cells.push(cell);
    }
  } finally {
    await observer.restore();
  }
  t.diagnostic(JSON.stringify(cells.map((cell) => ({ mode: cell.mode, reused: Boolean(cell.answer?.reuse), delays: cell.delays,
    suppliedAtEachStage: cell.signals.map((signal) => signal === supplied.signal), fallbackAtEachStage: cell.signals.map((signal) => signal === fallback.signal), native: cell.native }))));
  // Establish both complete valid reuse premises before the supplied-signal assertion can fail.
  for (const cell of cells) {
    assert.deepEqual(cell.answer?.reuse?.receipt, ciFullReceiptFixture().receipt, cell.mode + ' reaches actual valid full-proof reuse');
    assert.equal(cell.requests.length, 4, cell.mode + ' completed one discovery/detail/job/artifact read sequence');
    assert.equal(cell.sends.length, 2, cell.mode + ' completed both actual transport stages');
    assert.equal(cell.native.length, 1, cell.mode + ' delegated native inflate callback completed');
    assert.equal(cell.native[0].code, undefined, cell.mode + ' native decode succeeded');
    assert.ok(cell.native[0].returnedBytes > 0 && cell.native[0].consumedBytes > 0, cell.mode + ' native output and input observed');
  }
  assert.deepEqual(cells[0].delays, [], 'provided signal constructs no default timeout');
  assert.deepEqual(cells[0].signals.map((signal) => signal === supplied.signal), [true, true, true], 'provided signal spans both sends and actual native inflation');
  assert.deepEqual(cells[1].delays, [30_000], 'omitted signal constructs exactly one 30000ms default');
  assert.deepEqual(cells[1].signals.map((signal) => signal === fallback.signal), [true, true, true], 'default signal spans both sends and actual native inflation');
});


/** Native zlib observation only: delegate, retain callback facts, await completion, then restore named imports. */
function nativeInflationObserver(t, started = () => {}) {
  const native = zlib.inflateRaw, records = [], completed = [];
  const method = t.mock.method(zlib, 'inflateRaw', function (bytes, options, callback) {
    const record = { signal: options.signal, maxOutputLength: options.maxOutputLength, info: options.info };
    records.push(record); started(record);
    let complete;
    completed.push(new Promise((resolve) => { complete = resolve; }));
    try {
      return native.call(this, bytes, options, (error, value) => {
        record.code = error?.code; record.returnedBytes = value?.buffer?.length; record.consumedBytes = value?.engine?.bytesWritten;
        try { callback(error, value); } finally { complete(); }
      });
    } catch (error) { complete(); throw error; }
  });
  syncBuiltinESMExports();
  return { records, wait: () => Promise.all(completed), async restore() { await Promise.all(completed); method.mock.restore(); syncBuiltinESMExports(); } };
}

/** Independent archive bytes enter the actual inline decoder with an unarmed manual signal. */
async function receiptArchiveResult(archive, signal = new AbortController().signal) {
  try { return { receipt: await evaluateCiPolicy('readReceiptZip', Buffer.from(archive, 'base64'), { signal }) }; }
  catch (error) { return { error: error.message }; }
}

/** Literal artifact API/redirect contract from the owned host fixture, without child isolation or a real timer. */
async function artifactTransportResult(facts) {
  const calls = [], signal = new AbortController().signal;
  try {
    const answer = await evaluateCiPolicy('downloadArtifact', facts.id ?? 6001, {
      token: 'fixture-token', signal,
      send: async (url, options) => {
        calls.push({ url, method: options.method, redirect: options.redirect, headers: options.headers ?? {}, deadline: options.signal instanceof AbortSignal });
        if (facts.networkError === calls.length) throw new Error('private signature=private fixture-token');
        if (calls.length === 1) return new Response(null, { status: facts.apiStatus ?? 302, headers: facts.noLocation ? {} : { location: facts.location } });
        const bytes = facts.oversized ? Buffer.alloc(2097153) : Buffer.from(facts.archive, 'base64');
        return new Response(bytes, { status: facts.downloadStatus ?? 200, headers: facts.headers });
      },
    });
    return { archive: Buffer.from(answer).toString('base64'), calls };
  } catch (error) { return { error: error.message, calls }; }
}

/** Observe one controlled pending transport stage before manually aborting its shared operation. */
async function artifactDeadlineResult(phase) {
  const controller = new AbortController(); let calls = 0;
  const work = evaluateCiPolicy('downloadArtifact', 6001, { token: 'fixture-token', signal: controller.signal, send: async () => {
    calls++;
    if (phase === calls) { queueMicrotask(() => controller.abort()); return new Promise(() => {}); }
    if (calls === 1) return new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
    return new Response(new ReadableStream({ pull() { queueMicrotask(() => controller.abort()); }, cancel() {} }));
  } }).then(() => ({ error: 'unexpected-success' }), (error) => ({ error: error.message }));
  // A logical settlement check for controlled pending work, not evidence of native elapsed time.
  return Promise.race([work, new Promise((resolve) => setImmediate(() => resolve({ error: 'aborted operation remained pending' })))]);
}

/** Real native resource outcomes are retained separately from declared metadata limits. */
async function zipBudgetResult(t, facts) {
  const fixture = ciBudgetArchive(facts), observer = nativeInflationObserver(t);
  const result = { archiveBytes: fixture.archive.length, expandedBytes: fixture.expanded, expectedTextLength: fixture.textLength };
  try {
    try { result.receiptLength = (await evaluateCiPolicy('readReceiptZip', fixture.archive, { signal: new AbortController().signal })).data.length; }
    catch (error) { result.error = error.message; }
    await observer.wait();
    result.probe = { calls: observer.records.length, limited: observer.records.filter((record) => record.code === 'ERR_BUFFER_TOO_LARGE').length,
      largestReturned: Math.max(0, ...observer.records.map((record) => record.returnedBytes ?? 0)) };
    t.diagnostic(JSON.stringify({ fixture: facts, native: observer.records.map(({ signal, ...record }) => record) }));
    return result;
  } finally { await observer.restore(); }
}

/** Cancellation distinguishes an actual delegated native callback from deliberately stalled/error controls. */
async function zipDeadlineResult(t, mode) {
  const fixture = ciBudgetArchive({ expandedBytes: 2 * 1024 * 1024 }), controller = new AbortController();
  const probe = { calls: 0, pending: false, startedBeforeAbort: false, nativeAbortErrors: 0 };
  if (mode === 'preaborted') controller.abort();
  const begin = () => {
    probe.calls++; probe.pending = true;
    if (mode !== 'callback-error') queueMicrotask(() => { probe.startedBeforeAbort = probe.pending; controller.abort(); });
  };
  let observer, synthetic;
  if (mode === 'native' || mode === 'preaborted') observer = nativeInflationObserver(t, begin);
  else {
    synthetic = t.mock.method(zlib, 'inflateRaw', (bytes, options, callback) => {
      begin();
      if (mode === 'callback-error') queueMicrotask(() => callback(new Error('private fixture signature=secret')));
    });
    syncBuiltinESMExports();
  }
  try {
    const work = evaluateCiPolicy('readReceiptZip', fixture.archive, { signal: controller.signal })
      .then(() => ({ accepted: true }), (error) => ({ error: error.message }));
    const answer = await Promise.race([work, new Promise((resolve) => setImmediate(() => resolve({ error: 'aborted inflation remained pending' })))]);
    if (observer) {
      await observer.wait();
      probe.nativeAbortErrors = observer.records.filter((record) => record.code === 'ABORT_ERR').length;
      probe.pending = false;
      t.diagnostic(JSON.stringify({ mode, native: observer.records.map(({ signal, ...record }) => record) }));
    }
    return { ...answer, probe };
  } finally {
    if (observer) await observer.restore();
    if (synthetic) { synthetic.mock.restore(); syncBuiltinESMExports(); }
  }
}

/** Complete recorded API/run/job/archive collaborators feed the actual discovery export. */
async function discoveryResult(t, fixture, { providedSignal = true } = {}) {
  const signal = new AbortController().signal, signals = [], calls = [], downloads = [];
  const observer = nativeInflationObserver(t, (record) => signals.push(record.signal));
  let answer, error;
  try {
    try {
      answer = await evaluateCiPolicy('discoverFullProof', fixture.facts, {
        token: 'fixture-token', ...(providedSignal ? { signal } : {}),
        request: async (path) => { calls.push(path); if (!Object.hasOwn(fixture.api, path)) throw new Error('unexpected API lookup'); return fixture.api[path]; },
        send: async (url, options) => {
          downloads.push(url); signals.push(options.signal);
          if (options.method !== 'GET' || options.redirect !== 'manual' || !(options.signal instanceof AbortSignal)) throw new Error('unexpected archive options');
          if (url === 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip' &&
              JSON.stringify(options.headers) === JSON.stringify({ authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' }))
            return new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
          if (url === 'https://account.blob.core.windows.net/receipt' && Object.keys(options.headers).length === 0)
            return new Response(Buffer.from(fixture.archive, 'base64'));
          throw new Error('unexpected archive request');
        },
      });
    } catch (failure) { error = failure.message; }
    await observer.wait();
    return { answer, error, calls, downloads, signals, native: observer.records, sharedDeadline: signals.length === 3 && signals.every((observed) => observed === signal) };
  } finally { await observer.restore(); }
}

/** Independent stream chunks expose byte consumption and observed pending fetch/read cancellation. */
async function apiReadBoundsResult(mode) {
  const controller = new AbortController(), limit = 2 * 1024 * 1024;
  const probe = { calls: 0, produced: 0, cancelled: false, sharedSignal: false, pending: false, startedBeforeAbort: false };
  if (mode === 'preaborted') controller.abort();
  const abortPending = () => queueMicrotask(() => { probe.startedBeforeAbort = probe.pending; controller.abort(); });
  const work = evaluateCiPolicy('requestJson', '/repos/williacj/rigger', { token: 'fixture-token', signal: controller.signal,
    send: async (url, options) => {
      probe.calls++; probe.sharedSignal = options.signal === controller.signal;
      if (mode === 'fetch-error') throw new Error('synthetic network failure');
      if (mode === 'fetch-stalled') { probe.pending = true; abortPending(); return new Promise(() => {}); }
      const size = mode === 'overflow' ? 4 * 1024 * 1024 : limit;
      const body = Buffer.from('{"data":"' + 'x'.repeat(size - 11) + '"}');
      assert.equal(body.length, size, 'independent JSON fixture length');
      return new Response(new ReadableStream({
        pull(stream) {
          if (mode === 'body-error') throw new Error('synthetic body failure');
          if (mode === 'body-stalled') { probe.pending = true; abortPending(); return new Promise(() => {}); }
          if (probe.produced === body.length) { stream.close(); return; }
          const end = Math.min(probe.produced + 65536, body.length);
          stream.enqueue(body.subarray(probe.produced, end)); probe.produced = end;
        },
        cancel() { probe.cancelled = true; },
      }, { highWaterMark: 0 }));
    },
  }).then((value) => ({ accepted: value.data.length === limit - 11 }), (error) => ({ error: error.message }));
  const answer = await Promise.race([work, new Promise((resolve) => setImmediate(() => resolve({ error: 'API read remained pending' })))]);
  return { ...answer, probe };
}

test('candidate aggregate keeps its required name while refusing an unproved broad profile', async (t) => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(ci.jobs.check.name, 'check (26)');
  const facts = ciFacts(); facts.changes[0].path = 'src/changed.mjs';
  assert.equal((await evaluateCiPolicy('guard', facts, ciProof('BROAD_DEFERRED'))), false);
});

test('successful owner full aggregate produces an exact candidate-bound receipt with checkout provenance', async (t) => {
  const { facts, proof, receipt } = ciFullReceiptFixture();
  const result = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  assert.equal(result.ok, true, 'the full-run prerequisite itself succeeds');
  assert.deepEqual(result.receipt, receipt);
});

test('equivalent full candidates retain ordered parents and tree while synthetic checkout SHAs remain provenance', async (t) => {
  const { facts, proof, receipt } = ciFullReceiptFixture();
  const later = structuredClone(facts);
  later.checkout.sha = later.eventSha = 'e'.repeat(40);
  const laterProof = structuredClone(proof);
  laterProof.source.sha = 'e'.repeat(40);
  const first = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof }));
  const second = (await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts: later, proof: laterProof }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.receipt?.candidate, receipt.candidate);
  assert.deepEqual(second.receipt?.candidate, receipt.candidate);
  assert.deepEqual(first.receipt.checkout, { sha: 'a'.repeat(40), eventSha: 'a'.repeat(40) });
  assert.deepEqual(second.receipt.checkout, { sha: 'e'.repeat(40), eventSha: 'e'.repeat(40) });
});

test('full receipt producer refuses incomplete identity unauthenticated origin and unproved full workers', async (t) => {
  for (const defect of ['repository', 'pr', 'workflow', 'run', 'actor', 'event', 'ordinary', 'host', 'controller', 'source']) {
    const { facts, proof } = ciFullReceiptFixture();
    if (defect === 'repository') delete facts.repository;
    if (defect === 'pr') delete facts.pr.id;
    if (defect === 'workflow') facts.workflow.blob = '';
    if (defect === 'run') facts.run.attempt = 0;
    if (defect === 'actor') facts.run.actor = 'contributor';
    if (defect === 'event') facts.run.event = 'push';
    if (defect === 'ordinary') proof.results.full_ordinary = 'skipped';
    if (defect === 'host') proof.results.full_host = 'failure';
    if (defect === 'controller') proof.results.cancel_superseded = 'failure';
    if (defect === 'source') proof.source.tree = '0'.repeat(40);
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).receipt, undefined, defect);
  }
});

test('metadata aggregate reuses an equivalent full candidate only with completed actual owner run and required per-attempt jobs', async (t) => {
  const { facts, proof } = ciReuseFixture();
  assert.equal((await evaluateCiPolicy('guard', facts, proof)), true);
});

test('reused full proof refuses every candidate identity mismatch and unproved current worker', async (t) => {
  for (const [field, value] of [
    ['repositoryId', 43], ['repository', 'foreign/rigger'], ['prId', 7002], ['prNumber', 8],
    ['workflowId', 9131], ['workflowPath', '.github/workflows/other.yml'], ['workflowBlob', '0'.repeat(40)],
    ['head', '0'.repeat(40)], ['base', '0'.repeat(40)], ['baseRef', 'other'], ['tree', '0'.repeat(40)],
    ['parents', ['d'.repeat(40), 'c'.repeat(40)]], ['profile', { ordinary: true, host: true, demo: true }],
  ]) {
    const { facts, proof } = ciReuseFixture(); proof.reuse.receipt.candidate[field] = value;
    assert.equal((await evaluateCiPolicy('guard', facts, proof)), false, field);
  }
  for (const job of ['plan', 'fast', 'cancel_superseded']) {
    const { facts, proof } = ciReuseFixture(); proof.results[job] = 'failure';
    assert.equal((await evaluateCiPolicy('guard', facts, proof)), false, job);
  }
});

test('reused full proof refuses missing duplicate nonsuccess or wrong-attempt required jobs and inconsistent run identity', async (t) => {
  for (const name of ['plan', 'fast', 'full_ordinary', 'full_host', 'cancel_superseded', 'check (26)']) {
    for (const defect of ['missing', 'duplicate', 'failure', 'cancelled', 'skipped', 'attempt']) {
      const { facts, proof } = ciReuseFixture(); const jobs = proof.reuse.jobs.jobs;
      const index = jobs.findIndex((job) => job.name === name);
      if (defect === 'missing') jobs.splice(index, 1);
      else if (defect === 'duplicate') jobs.push({ ...jobs[index], id: 9999 });
      else if (defect === 'attempt') jobs[index].run_attempt = 1;
      else jobs[index].conclusion = defect;
      proof.reuse.jobs.total_count = jobs.length;
      assert.equal((await evaluateCiPolicy('guard', facts, proof)), false, name + ':' + defect);
    }
  }
  for (const [field, value] of [
    ['id', 4100], ['run_attempt', 1], ['workflow_id', 9131], ['path', '.github/workflows/other.yml'],
    ['event', 'push'], ['status', 'in_progress'], ['conclusion', 'failure'], ['actor', { login: 'contributor' }],
    ['repository', { id: 43, full_name: 'foreign/rigger' }], ['head_sha', '0'.repeat(40)], ['pull_requests', []],
  ]) {
    const { facts, proof } = ciReuseFixture(); proof.reuse.run[field] = value;
    assert.equal((await evaluateCiPolicy('guard', facts, proof)), false, field);
  }
});

// Diagnostic CI current demo and fresh full obligations under #1119 C6/C7; no product requirement is claimed.
test('current demo and fresh full requests retain their own proof obligations despite reusable prior full evidence', async (t) => {
  const positive = ciReuseFixture();
  positive.facts.changes[0].path = 'src/changed.mjs';
  Object.assign(positive.facts, { action: 'labeled', sender: 'williacj', label: 'ci:demo' });
  positive.facts.live.labels = ['ci:demo']; positive.facts.run.actor = 'williacj';
  positive.proof.demoNeeded = true; positive.proof.results.demo = 'success';
  positive.proof.reuse.receipt.candidate.profile = { ordinary: true, host: true, demo: true };
  positive.proof.reuse.jobs.jobs.find((job) => job.name === 'demo').conclusion = 'success';
  assert.deepEqual(await evaluateCiPolicy('policy', positive.facts), { mode: 'BROAD_DEFERRED', demoNeeded: true, sourceValid: true }, 'current owner demo is independently required');
  assert.equal(await evaluateCiPolicy('guard', positive.facts, positive.proof), true, 'complete current demo and compatible prior full proof establish reuse first');
  const expectedSource = { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) };
  const observed = [];
  for (const name of ['valid-demo', 'demo-failure', 'demo-cancelled', 'demo-skipped', 'demo-missing', 'prior-profile', 'invalid-source', 'fresh-full-success', 'fresh-full-skipped']) {
    const fixture = structuredClone(positive), { facts, proof } = fixture;
    if (name === 'demo-failure') proof.results.demo = 'failure';
    if (name === 'demo-cancelled') proof.results.demo = 'cancelled';
    if (name === 'demo-skipped') proof.results.demo = 'skipped';
    if (name === 'demo-missing') delete proof.results.demo;
    if (name === 'prior-profile') proof.reuse.receipt.candidate.profile.demo = false;
    if (name === 'invalid-source') facts.live.head = 'f'.repeat(40);
    if (name.startsWith('fresh-full-')) {
      facts.label = 'ci:full'; facts.live.labels = ['ci:full']; proof.mode = 'BROAD_EXECUTED';
      proof.results.full_ordinary = proof.results.full_host = name === 'fresh-full-success' ? 'success' : 'skipped';
      assert.equal(proof.reuse.receipt.origin.runId, 4101, 'usable offered prior proof remains present on a fresh full request');
      assert.deepEqual(await evaluateCiPolicy('policy', facts), { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true }, 'fresh owner full still routes current full work');
    }
    const guard = await evaluateCiPolicy('guard', facts, proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
    const demo = await evaluateCiPolicy('runPolicy', { action: 'worker', worker: 'demo', facts, proof });
    const ordinary = await evaluateCiPolicy('runPolicy', { action: 'worker', worker: 'full_ordinary', facts, proof });
    const host = await evaluateCiPolicy('runPolicy', { action: 'worker', worker: 'full_host', facts, proof });
    assert.deepEqual(aggregate.source, name === 'invalid-source' ? undefined : expectedSource, name + ' current source remains independently bound');
    if (name === 'fresh-full-success') assert.deepEqual(aggregate.receipt?.origin,
      { runId: 4102, attempt: 1, event: 'pull_request', actor: 'williacj', action: 'labeled', label: 'ci:full' }, 'only successful fresh full proof creates a current-run receipt');
    else assert.equal(aggregate.receipt, undefined, name + ' does not create a fresh owner-full receipt');
    observed.push({ name, guard, aggregate: aggregate.ok, demo: demo.ok, ordinary: ordinary.ok, host: host.ok, receipt: Boolean(aggregate.receipt) });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { name: 'valid-demo', guard: true, aggregate: true, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'demo-failure', guard: false, aggregate: false, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'demo-cancelled', guard: false, aggregate: false, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'demo-skipped', guard: false, aggregate: false, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'demo-missing', guard: false, aggregate: false, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'prior-profile', guard: false, aggregate: false, demo: true, ordinary: false, host: false, receipt: false },
    { name: 'invalid-source', guard: false, aggregate: false, demo: false, ordinary: false, host: false, receipt: false },
    { name: 'fresh-full-success', guard: true, aggregate: true, demo: true, ordinary: true, host: true, receipt: true },
    { name: 'fresh-full-skipped', guard: false, aggregate: false, demo: true, ordinary: true, host: true, receipt: false },
  ], 'prior proof never replaces current requested worker results or current source authentication');
});

// Diagnostic CI prior-run PR attribution under #1119 C3; no product requirement is claimed.
test('reused full proof binds each prior run PR association field to the proved candidate', async (t) => {
  const positive = ciReuseFixture();
  const expectedAssociation = { id: 7001, number: 7, head: { sha: 'd'.repeat(40) }, base: { ref: 'main', sha: 'c'.repeat(40) } };
  const expectedSource = { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) };
  assert.deepEqual(positive.proof.reuse.run.pull_requests, [expectedAssociation]);
  const positiveGuard = await evaluateCiPolicy('guard', positive.facts, positive.proof);
  const positiveAggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...positive });
  assert.equal(positiveGuard, true, 'literal complete association grants actual reuse before any attribution changes');
  assert.equal(positiveAggregate.ok, true); assert.deepEqual(positiveAggregate.source, expectedSource);
  const observed = [{ field: 'valid', guard: positiveGuard, aggregate: positiveAggregate.ok }];
  for (const [field, value] of [['id', 7002], ['number', 8], ['head', 'e'.repeat(40)], ['base', 'e'.repeat(40)], ['baseRef', 'batch']]) {
    const fixture = structuredClone(positive), run = fixture.proof.reuse.run, association = run.pull_requests[0];
    if (field === 'head') association.head.sha = value;
    else if (field === 'base') association.base.sha = value;
    else if (field === 'baseRef') association.base.ref = value;
    else association[field] = value;
    assert.deepEqual({ ...run, pull_requests: [expectedAssociation] }, positive.proof.reuse.run, field + ' changes only prior-run association');
    assert.deepEqual(fixture.proof.reuse.receipt, positive.proof.reuse.receipt, field + ' leaves the offered receipt unchanged');
    const guard = await evaluateCiPolicy('guard', fixture.facts, fixture.proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...fixture });
    assert.deepEqual(aggregate.source, expectedSource); assert.equal(aggregate.receipt, undefined);
    observed.push({ field, guard, aggregate: aggregate.ok });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { field: 'valid', guard: true, aggregate: true },
    { field: 'id', guard: false, aggregate: false }, { field: 'number', guard: false, aggregate: false },
    { field: 'head', guard: false, aggregate: false }, { field: 'base', guard: false, aggregate: false },
    { field: 'baseRef', guard: false, aggregate: false },
  ], 'receipt claims cannot substitute for actual prior-run PR attribution');
});

// Diagnostic CI receipt authority independent of internal consistency under #1119 C3; no product requirement is claimed.
test('reused full proof refuses coherent foreign actor and event claims independently of receipt run consistency', async (t) => {
  const expectedSource = { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) };
  const observed = [];
  for (const name of ['valid', 'coherent-foreign-actor', 'coherent-foreign-event']) {
    const { facts, proof } = ciReuseFixture(), { origin } = proof.reuse.receipt, { run } = proof.reuse;
    if (name === 'coherent-foreign-actor') origin.actor = run.actor.login = 'contributor';
    if (name === 'coherent-foreign-event') origin.event = run.event = 'push';
    assert.equal(origin.actor, run.actor.login, name + ' receipt and API run actor remain internally consistent');
    assert.equal(origin.event, run.event, name + ' receipt and API run event remain internally consistent');
    assert.equal(facts.owner, 'williacj'); assert.equal(facts.event, 'pull_request');
    if (name === 'valid') assert.deepEqual(origin,
      { runId: 4101, attempt: 2, event: 'pull_request', actor: 'williacj', action: 'labeled', label: 'ci:full' });
    const guard = await evaluateCiPolicy('guard', facts, proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
    if (name === 'valid') { assert.equal(guard, true, 'authorized complete control succeeds before foreign authority rows'); assert.equal(aggregate.ok, true); }
    assert.deepEqual(aggregate.source, expectedSource, name + ' keeps independent current source authentication');
    assert.equal(aggregate.receipt, undefined, name + ' metadata cannot mint owner-full evidence');
    observed.push({ name, actor: origin.actor, event: origin.event, guard, aggregate: aggregate.ok });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { name: 'valid', actor: 'williacj', event: 'pull_request', guard: true, aggregate: true },
    { name: 'coherent-foreign-actor', actor: 'contributor', event: 'pull_request', guard: false, aggregate: false },
    { name: 'coherent-foreign-event', actor: 'williacj', event: 'push', guard: false, aggregate: false },
  ], 'matching receipt and run claims never replace the hard owner and pull-request authority boundary');
});

// Diagnostic CI authenticated receipt-origin admission under #1119 C3; no product requirement is claimed.
test('reused full proof requires complete owner-full receipt origin matching its proved run attempt', async (t) => {
  const positive = ciReuseFixture();
  const expectedOrigin = { runId: 4101, attempt: 2, event: 'pull_request', actor: 'williacj', action: 'labeled', label: 'ci:full' };
  const expectedSource = { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) };
  assert.deepEqual(positive.proof.reuse.receipt.origin, expectedOrigin, 'literal owner-full receipt origin identifies the proved run attempt');
  const positiveGuard = await evaluateCiPolicy('guard', positive.facts, positive.proof);
  const positiveAggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...positive });
  assert.equal(positiveGuard, true, 'complete owner-full origin grants actual reuse before origin changes');
  assert.equal(positiveAggregate.ok, true, 'positive premise reaches the actual aggregate');
  assert.deepEqual(positiveAggregate.source, expectedSource);
  assert.equal(positiveAggregate.receipt, undefined, 'metadata reuse does not mint owner-full evidence');
  const observed = [{ origin: 'valid', guard: positiveGuard, aggregate: positiveAggregate.ok }];
  const defects = [
    ['missing-origin', null, undefined], ['null-origin', null, null],
    ['missing-runId', 'runId', undefined], ['missing-attempt', 'attempt', undefined],
    ['missing-event', 'event', undefined], ['missing-actor', 'actor', undefined],
    ['missing-action', 'action', undefined], ['missing-label', 'label', undefined],
    ['changed-runId', 'runId', 4100], ['changed-attempt', 'attempt', 1],
    ['changed-event', 'event', 'push'], ['changed-actor', 'actor', 'contributor'],
    ['changed-action', 'action', 'edited'], ['changed-label', 'label', 'ci:demo'],
  ];
  for (const [name, field, value] of defects) {
    const fixture = structuredClone(positive), receipt = fixture.proof.reuse.receipt;
    if (field === null && value === undefined) delete receipt.origin;
    else if (field === null) receipt.origin = null;
    else if (value === undefined) delete receipt.origin[field];
    else receipt.origin[field] = value;
    assert.deepEqual({ ...receipt, origin: expectedOrigin }, positive.proof.reuse.receipt, name + ' changes only receipt origin');
    const guard = await evaluateCiPolicy('guard', fixture.facts, fixture.proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...fixture });
    assert.deepEqual(aggregate.source, expectedSource, name + ' preserves independently verified current source');
    assert.equal(aggregate.receipt, undefined, name + ' cannot mint owner-full evidence');
    observed.push({ origin: name, guard, aggregate: aggregate.ok });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { origin: 'valid', guard: true, aggregate: true },
    { origin: 'missing-origin', guard: false, aggregate: false },
    { origin: 'null-origin', guard: false, aggregate: false },
    { origin: 'missing-runId', guard: false, aggregate: false },
    { origin: 'missing-attempt', guard: false, aggregate: false },
    { origin: 'missing-event', guard: false, aggregate: false },
    { origin: 'missing-actor', guard: false, aggregate: false },
    { origin: 'missing-action', guard: false, aggregate: false },
    { origin: 'missing-label', guard: false, aggregate: false },
    { origin: 'changed-runId', guard: false, aggregate: false },
    { origin: 'changed-attempt', guard: false, aggregate: false },
    { origin: 'changed-event', guard: false, aggregate: false },
    { origin: 'changed-actor', guard: false, aggregate: false },
    { origin: 'changed-action', guard: false, aggregate: false },
    { origin: 'changed-label', guard: false, aggregate: false },
  ], 'readiness requires every receipt-origin authority and run-attempt obligation');
});

// Diagnostic CI known receipt-schema admission under #1119 C2; no product requirement is claimed.
test('reused full proof accepts only the known numeric receipt schema without changing current source proof', async (t) => {
  const positive = ciReuseFixture();
  const expectedSource = { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'b'.repeat(40),
    parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) };
  assert.equal(positive.proof.reuse.receipt.schema, 1, 'literal supported receipt uses numeric schema 1');
  const positiveGuard = await evaluateCiPolicy('guard', positive.facts, positive.proof);
  const positiveAggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...positive });
  assert.equal(positiveGuard, true, 'known-schema complete proof grants actual reuse before schema changes');
  assert.equal(positiveAggregate.ok, true, 'positive premise reaches the actual aggregate');
  assert.deepEqual(positiveAggregate.source, expectedSource);
  assert.equal(positiveAggregate.receipt, undefined, 'metadata reuse does not mint owner-full evidence');
  const observed = [{ schema: 'known', guard: positiveGuard, aggregate: positiveAggregate.ok }];
  for (const [name, schema] of [['missing', undefined], ['unsupported', 2], ['wrong-type', '1'], ['null', null]]) {
    const fixture = structuredClone(positive);
    if (name === 'missing') delete fixture.proof.reuse.receipt.schema;
    else fixture.proof.reuse.receipt.schema = schema;
    assert.deepEqual({ ...fixture.proof.reuse.receipt, schema: 1 }, positive.proof.reuse.receipt, name + ' changes only the receipt schema field');
    const guard = await evaluateCiPolicy('guard', fixture.facts, fixture.proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...fixture });
    assert.deepEqual(aggregate.source, expectedSource, name + ' preserves independently verified current source');
    assert.equal(aggregate.receipt, undefined, name + ' cannot mint owner-full evidence');
    observed.push({ schema: name, guard, aggregate: aggregate.ok });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { schema: 'known', guard: true, aggregate: true },
    { schema: 'missing', guard: false, aggregate: false },
    { schema: 'unsupported', guard: false, aggregate: false },
    { schema: 'wrong-type', guard: false, aggregate: false },
    { schema: 'null', guard: false, aggregate: false },
  ], 'only supported numeric receipt schema receives readiness credit');
});

// Diagnostic CI required prior-demo evidence under #1119 C3/C4; no product requirement is claimed.
test('reused full proof requires exactly one successful demo job from the proved prior run attempt when its profile requires demo', async (t) => {
  const positive = ciReuseFixture();
  positive.facts.changes[0].path = 'src/changed.mjs';
  positive.proof.reuse.receipt.candidate.profile = { ordinary: true, host: true, demo: true };
  const demo = positive.proof.reuse.jobs.jobs.find((job) => job.name === 'demo');
  demo.conclusion = 'success';
  assert.deepEqual(demo, { id: 5106, run_id: 4101, run_attempt: 2, name: 'demo', status: 'completed', conclusion: 'success' }, 'literal prior demo belongs to the completed proved run attempt');
  assert.equal(positive.proof.results.demo, 'skipped', 'the later metadata run has no independent demo request');
  assert.equal(await evaluateCiPolicy('guard', positive.facts, positive.proof), true, 'complete demo-required prior proof grants actual reuse');
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...positive })).ok, true, 'positive premise reaches the actual aggregate');
  const observed = [{ defect: 'none', guard: true, aggregate: true }];
  for (const defect of ['missing', 'duplicate', 'failure', 'cancelled', 'skipped', 'wrong-attempt', 'wrong-run']) {
    const fixture = structuredClone(positive), page = fixture.proof.reuse.jobs;
    const index = page.jobs.findIndex((job) => job.name === 'demo');
    if (defect === 'missing') page.jobs.splice(index, 1);
    else if (defect === 'duplicate') page.jobs.push({ ...page.jobs[index], id: 9999 });
    else if (defect === 'wrong-attempt') page.jobs[index].run_attempt = 1;
    else if (defect === 'wrong-run') page.jobs[index].run_id = 4102;
    else page.jobs[index].conclusion = defect;
    page.total_count = page.jobs.length;
    const guard = await evaluateCiPolicy('guard', fixture.facts, fixture.proof);
    const aggregate = await evaluateCiPolicy('runPolicy', { action: 'aggregate', ...fixture });
    observed.push({ defect, guard, aggregate: aggregate.ok });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { defect: 'none', guard: true, aggregate: true },
    { defect: 'missing', guard: false, aggregate: false },
    { defect: 'duplicate', guard: false, aggregate: false },
    { defect: 'failure', guard: false, aggregate: false },
    { defect: 'cancelled', guard: false, aggregate: false },
    { defect: 'skipped', guard: false, aggregate: false },
    { defect: 'wrong-attempt', guard: false, aggregate: false },
    { defect: 'wrong-run', guard: false, aggregate: false },
  ], 'required prior demo has independent cardinality outcome and run-attempt obligations');
});

test('receipt collector authenticates current attempt repository PR and exact checked-out workflow identity', async (t) => {
  const fixture = ciRunCollectorFixture();
  const { answer } = (await evaluateCiPolicy('collect', fixture));
  assert.equal(answer.complete, true);
  assert.deepEqual(answer.repository, { id: 42, fullName: 'williacj/rigger' });
  assert.equal(answer.pr.id, 7001);
  assert.deepEqual(answer.workflow, { id: 9130, path: '.github/workflows/ci.yml', blob: 'f'.repeat(40) });
  assert.deepEqual(answer.run, { id: 4102, attempt: 1, event: 'pull_request', actor: 'contributor' });
});

test('receipt collector refuses inconsistent current attempt workflow repository PR and head facts', async (t) => {
  for (const [field, value] of [
    ['id', 4103], ['run_attempt', 2], ['workflow_id', 0], ['path', '.github/workflows/foreign.yml'],
    ['event', 'push'], ['actor', { login: '' }], ['repository', { id: 43, full_name: 'foreign/rigger' }],
    ['head_sha', '0'.repeat(40)], ['pull_requests', [{ id: 7002, number: 8 }]],
  ]) {
    const fixture = ciRunCollectorFixture(); fixture.api['/repos/williacj/rigger/actions/runs/4102/attempts/1'][field] = value;
    assert.equal((await evaluateCiPolicy('collect', fixture)).answer.complete, false, field);
  }
});

test('artifact transport downloads one bounded producer-compatible ZIP through a credential-free approved redirect', async (t) => {
  for (const location of ['https://results-receiver.actions.githubusercontent.com/receipt?signature=private', 'https://account.blob.core.windows.net/receipt?signature=private']) {
    const result = (await artifactTransportResult({ location, archive: ciArtifactZip }));
    assert.equal(result.error, undefined);
    assert.equal(result.archive, ciArtifactZip);
    assert.equal(result.calls.length, 2);
    assert.deepEqual(result.calls[0], { url: 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip', method: 'GET', redirect: 'manual', headers: { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' }, deadline: true });
    assert.deepEqual(result.calls[1], { url: location, method: 'GET', redirect: 'manual', headers: {}, deadline: true });
  }
});

test('artifact transport refuses invalid scope redirect download resource and transport classes without secrets', async (t) => {
  const valid = { location: 'https://account.blob.core.windows.net/receipt?signature=private', archive: ciArtifactZip };
  const cases = [
    { id: 0 }, { id: '6001/other' }, { apiStatus: 200 }, { apiStatus: 301 }, { apiStatus: 307 }, { noLocation: true },
    ...['http://account.blob.core.windows.net/a', 'https://account.blob.core.windows.net:444/a', 'https://user:pass@account.blob.core.windows.net/a', 'https://account.blob.core.windows.net/a#fragment', 'https://blob.core.windows.net/a', 'https://evilblob.core.windows.net/a', 'https://account.blob.core.windows.net.evil/a', 'https://results-receiver.actions.githubusercontent.com.evil/a', 'https://.blob.core.windows.net/a', 'https://a..blob.core.windows.net/a', 'https://account.blob.core.windows.net/a, https://evil.test/a', '/relative'].map((location) => ({ location })),
    { downloadStatus: 302 }, { downloadStatus: 201 }, { downloadStatus: 403 },
    { oversized: true }, { headers: { 'content-length': '999' } }, { headers: { 'content-length': '2097153' } },
    { networkError: 1 }, { networkError: 2 },
  ];
  for (const defect of cases) {
    const result = (await artifactTransportResult({ ...valid, ...defect }));
    assert.match(result.error ?? '', /^artifact (scope|redirect|download|size|transport)/, JSON.stringify(defect));
    assert.doesNotMatch(result.error, /fixture-token|signature=private/);
    assert.equal(result.archive, undefined);
    assert.ok(result.calls.length <= 2);
    if (result.calls[1]) assert.deepEqual(result.calls[1].headers, {});
  }
});

test('artifact transport stops nonreturning requests and stalled body reads at the injected deadline', async (t) => {
  for (const phase of [1, 2, 'body']) {
    const result = (await artifactDeadlineResult(phase));
    assert.match(result.error, /^artifact (transport|download) refused$/, String(phase));
  }
});

// Diagnostic CI decoded receipt payload admission under #1119 C2; no product requirement is claimed.
test('receipt payload parsing refuses malformed JSON and invalid UTF8 after successful native archive decoding', async (t) => {
  // Frozen independently with Python zipfile on a nonseekable stream, one Unix 0100644 root file.
  // APPNOTE streamed-descriptor layout: data48..61, descriptor62..77, central78..141, end142..163.
  const rows = [{"name":"valid","archive":"UEsDBBQACAAIAAAAIVwAAAAAAAAAAAAAAAASAAAAY2ktZnVsbC1wcm9vZi5qc29uq1YqTs5IzU1UsjKsBQBQSwcIjMH7iQ4AAAAMAAAAUEsBAhQDFAAIAAgAAAAhXIzB+4kOAAAADAAAABIAAAAAAAAAAAAAAKSBAAAAAGNpLWZ1bGwtcHJvb2YuanNvblBLBQYAAAAAAQABAEAAAABOAAAAAAA=","payloadHex":"7b22736368656d61223a317d","checksum":2314977676,"accepted":true},{"name":"malformed-json","archive":"UEsDBBQACAAIAAAAIVwAAAAAAAAAAAAAAAASAAAAY2ktZnVsbC1wcm9vZi5qc29uq1YqTs5IzU1UsqqoBQBQSwcIwDVAqA4AAAAMAAAAUEsBAhQDFAAIAAgAAAAhXMA1QKgOAAAADAAAABIAAAAAAAAAAAAAAKSBAAAAAGNpLWZ1bGwtcHJvb2YuanNvblBLBQYAAAAAAQABAEAAAABOAAAAAAA=","payloadHex":"7b22736368656d61223a787d","checksum":2822780352,"accepted":false},{"name":"invalid-utf8","archive":"UEsDBBQACAAIAAAAIVwAAAAAAAAAAAAAAAASAAAAY2ktZnVsbC1wcm9vZi5qc29uq1ZKSSxJVLJS+q9UCwBQSwcItiBi+g4AAAAMAAAAUEsBAhQDFAAIAAgAAAAhXLYgYvoOAAAADAAAABIAAAAAAAAAAAAAAKSBAAAAAGNpLWZ1bGwtcHJvb2YuanNvblBLBQYAAAAAAQABAEAAAABOAAAAAAA=","payloadHex":"7b2264617461223a22ff227d","checksum":4200734902,"accepted":false}];
  const observed = [];
  for (const row of rows) {
    const archive = Buffer.from(row.archive, 'base64'), payload = Buffer.from(row.payloadHex, 'hex');
    assert.equal(archive.length, 164); assert.equal(payload.length, 12);
    assert.equal(zlib.crc32(payload), row.checksum, row.name + ' independent payload checksum');
    assert.equal(archive.readUInt32LE(62), 0x08074b50); assert.equal(archive.readUInt32LE(78), 0x02014b50);
    assert.equal(archive.readUInt32LE(66), row.checksum); assert.equal(archive.readUInt32LE(94), row.checksum);
    assert.equal(archive.readUInt32LE(70), 14); assert.equal(archive.readUInt32LE(98), 14);
    assert.equal(archive.readUInt32LE(74), 12); assert.equal(archive.readUInt32LE(102), 12);
    if (row.name === 'invalid-utf8') assert.deepEqual(JSON.parse(payload.toString('utf8')), { data: '\ufffd' }, 'replacement decoding would otherwise accept this JSON');
    const observer = nativeInflationObserver(t); let receipt, error;
    try {
      try { receipt = await evaluateCiPolicy('readReceiptZip', archive, { signal: new AbortController().signal }); }
      catch (failure) { error = failure.message; }
      await observer.wait();
      const native = observer.records.map(({ code, returnedBytes, consumedBytes }) => ({ code, returnedBytes, consumedBytes }));
      assert.deepEqual(native, [{ code: undefined, returnedBytes: 12, consumedBytes: 14 }], row.name + ' reaches genuine successful complete native inflation');
      if (row.accepted) assert.deepEqual(receipt, { schema: 1 }, 'valid independently specified JSON control is accepted first');
      observed.push({ name: row.name, receipt, error, native });
    } finally { await observer.restore(); }
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { name: 'valid', receipt: { schema: 1 }, error: undefined, native: [{ code: undefined, returnedBytes: 12, consumedBytes: 14 }] },
    { name: 'malformed-json', receipt: undefined, error: 'artifact archive refused', native: [{ code: undefined, returnedBytes: 12, consumedBytes: 14 }] },
    { name: 'invalid-utf8', receipt: undefined, error: 'artifact archive refused', native: [{ code: undefined, returnedBytes: 12, consumedBytes: 14 }] },
  ], 'well-framed archive success does not substitute for valid UTF8 JSON payload admission');
});

// Diagnostic CI archive metadata refusal under #1119 C8; no product requirement is claimed.
test('receipt ZIP reader refuses inconsistent local and central general purpose flags', async (t) => {
  // PKWARE APPNOTE 6.3.10 sections 4.3.7, 4.3.12 and 4.4.4 define both flag fields.
  // https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
  const original = Buffer.from(ciArtifactZip, 'base64'), observed = [];
  assert.equal(original.length, 164);
  assert.equal(original.readUInt16LE(6), 8);
  assert.equal(original.readUInt16LE(86), 8);
  for (const row of [{ name: 'valid', centralFlags: 8 }, { name: 'inconsistent', centralFlags: 12 }]) {
    const archive = Buffer.from(original), controller = new AbortController();
    archive.writeUInt16LE(row.centralFlags, 86);
    assert.equal(archive.readUInt16LE(6), 8);
    assert.equal(archive.readUInt16LE(86), row.centralFlags);
    assert.deepEqual(archive.subarray(0, 86), original.subarray(0, 86));
    assert.deepEqual(archive.subarray(88), original.subarray(88), 'payload CRC sizes names and framing remain unchanged');
    const observer = nativeInflationObserver(t);
    let result;
    try {
      result = await receiptArchiveResult(archive.toString('base64'), controller.signal);
      await observer.wait();
      const native = observer.records.map(({ code, returnedBytes, consumedBytes }) => ({ code, returnedBytes, consumedBytes }));
      t.diagnostic(JSON.stringify({ name: row.name, localFlags: 8, centralFlags: row.centralFlags, result, native }));
      if (row.name === 'valid') {
        assert.deepEqual(result, { receipt: { schema: 1 } }, 'unchanged producer-compatible archive is accepted first');
        assert.deepEqual(native, [{ code: undefined, returnedBytes: 12, consumedBytes: 14 }], 'valid control genuinely completes native decompression');
        assert.equal(observer.records[0].signal, controller.signal);
      }
    } finally { await observer.restore(); }
    observed.push({ name: row.name, ...result });
  }
  assert.deepEqual(observed, [
    { name: 'valid', receipt: { schema: 1 } },
    { name: 'inconsistent', error: 'artifact archive refused' },
  ], 'matching decompressed payload cannot authorize inconsistent ZIP metadata');
});

test('receipt ZIP reader accepts one regular root JSON file from the complete streamed descriptor archive', async (t) => {
  const bytes = Buffer.from(ciArtifactZip, 'base64');
  // Independently fixed oracle: flag 3, signed descriptor, then central directory and exact EOF.
  assert.equal(bytes.length, 164);
  assert.equal(bytes.readUInt16LE(6), 8);
  assert.equal(bytes.readUInt32LE(62), 0x08074b50);
  assert.equal(bytes.readUInt32LE(78), 0x02014b50);
  const result = (await receiptArchiveResult(ciArtifactZip));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.receipt, { schema: 1 });
});

test('receipt ZIP reader refuses a missing end-of-central-directory signature', async (t) => {
  const archive = Buffer.from(ciArtifactZip, 'base64');
  // APPNOTE 4.3.16: the final record's mandatory four-byte signature is 0x06054b50.
  assert.equal(archive.readUInt32LE(142), 0x06054b50);
  archive.writeUInt32LE(0, 142);
  assert.equal(archive.readUInt32LE(142), 0);
  const result = (await receiptArchiveResult(archive.toString('base64')));
  assert.equal(result.receipt, undefined);
  assert.equal(result.error, 'artifact archive refused');
});

test('receipt ZIP reader refuses malformed archive framing and inconsistent directory metadata', async (t) => {
  // APPNOTE 4.3.7, 4.3.12 and 4.3.16 define these independent literal field offsets.
  const fields = [
    ['local signature', 0, 4, 0x04034b50, 0],
    ['central signature', 78, 4, 0x02014b50, 0],
    ['end disk', 146, 2, 0, 1],
    ['central disk', 148, 2, 0, 1],
    ['entries on disk', 150, 2, 1, 0],
    ['total entries', 152, 2, 1, 2],
    ['central extent', 154, 4, 64, 63],
    ['central offset', 158, 4, 78, 79],
    ['local offset', 120, 4, 0, 1],
    ['central entry disk', 112, 2, 0, 1],
    ['end comment extent', 162, 2, 0, 1],
  ];
  const vectors = fields.map(([name, offset, width, before, after]) => {
    const archive = Buffer.from(ciArtifactZip, 'base64');
    assert.equal(archive.readUIntLE(offset, width), before, name + ' fixture premise');
    archive.writeUIntLE(after, offset, width);
    assert.equal(archive.readUIntLE(offset, width), after, name + ' mutation readback');
    return [name, archive];
  });
  const complete = Buffer.from(ciArtifactZip, 'base64');
  vectors.push(['empty', Buffer.alloc(0)], ['short header', complete.subarray(0, 21)],
    ['truncated EOF', complete.subarray(0, 163)], ['trailing byte', Buffer.concat([complete, Buffer.from([0])])]);
  const actual = await Promise.all(vectors.map(async ([name, archive]) => {
    const result = (await receiptArchiveResult(archive.toString('base64')));
    return { name, receipt: result.receipt, error: result.error };
  }));
  assert.deepEqual(actual, vectors.map(([name]) => ({ name, receipt: undefined, error: 'artifact archive refused' })));
});

test('receipt ZIP reader refuses foreign entry identities special file types and encryption', async (t) => {
  // APPNOTE 4.4.4/4.4.15/4.4.17; archiver ZipArchiveEntry.setUnixMode supplies upper Unix mode bits.
  const vectors = [];
  for (const [name, replacement, offsets] of [
    ['foreign file', 'other-proof.json', [30, 124]],
    ['traversal', '../proof.json', [30, 124]],
    ['absolute', '/proof.json', [30, 124]],
    ['backslash', 'dir\\proof.json', [30, 124]],
    ['directory name', 'ci-full-proof.jso/', [30, 124]],
    ['local identity differs', 'other-proof.json', [30]],
    ['central identity differs', 'other-proof.json', [124]],
  ]) {
    const archive = Buffer.from(ciArtifactZip, 'base64');
    for (const offset of offsets) {
      assert.equal(archive.subarray(offset, offset + 18).toString('utf8'), 'ci-full-proof.json');
      const renamed = Buffer.from(replacement.padEnd(18, 'x'));
      assert.equal(renamed.length, 18, name + ' preserves framing');
      renamed.copy(archive, offset);
      assert.deepEqual(archive.subarray(offset, offset + 18), renamed);
    }
    vectors.push([name, archive]);
  }
  for (const [name, mode] of [['symlink', 0xa1ff], ['directory', 0x41ed], ['FIFO', 0x11a4],
    ['socket', 0xc1a4], ['character device', 0x21a4], ['block device', 0x61a4]]) {
    const archive = Buffer.from(ciArtifactZip, 'base64');
    assert.equal(archive.readUInt32LE(116), 0x81a40000);
    archive.writeUInt32LE(mode * 0x10000, 116);
    assert.equal(archive.readUInt32LE(116), mode * 0x10000);
    vectors.push([name, archive]);
  }
  const dosDirectory = Buffer.from(ciArtifactZip, 'base64');
  dosDirectory.writeUInt32LE(0x81a40010, 116);
  vectors.push(['DOS directory attribute', dosDirectory]);
  for (const [name, flags, offsets] of [
    ['local encryption', 9, [6]], ['central encryption', 9, [86]],
    ['both encrypted', 9, [6, 86]], ['strong encryption', 73, [6, 86]],
    ['masked metadata', 0x2008, [6, 86]],
  ]) {
    const archive = Buffer.from(ciArtifactZip, 'base64');
    for (const offset of offsets) {
      assert.equal(archive.readUInt16LE(offset), 8);
      archive.writeUInt16LE(flags, offset);
      assert.equal(archive.readUInt16LE(offset), flags);
    }
    vectors.push([name, archive]);
  }
  const actual = await Promise.all(vectors.map(async ([name, archive]) => {
    const result = (await receiptArchiveResult(archive.toString('base64')));
    return { name, receipt: result.receipt, error: result.error };
  }));
  assert.deepEqual(actual, vectors.map(([name]) => ({ name, receipt: undefined, error: 'artifact archive refused' })));
});

test('receipt ZIP reader refuses inconsistent checksums descriptors and compressed data', async (t) => {
  // APPNOTE 4.3.9 and 4.4.7-9 define signed descriptor, CRC32, and both byte sizes.
  const fields = [
    ['descriptor signature', [[62, 4, 0x08074b50, 0]]],
    ['central CRC', [[94, 4, 0x89fbc18c, 0]]],
    ['descriptor CRC', [[66, 4, 0x89fbc18c, 0]]],
    ['matching wrong CRCs', [[94, 4, 0x89fbc18c, 0], [66, 4, 0x89fbc18c, 0]]],
    ['central compressed size', [[98, 4, 14, 15]]],
    ['descriptor compressed size', [[70, 4, 14, 15]]],
    ['central expanded size', [[102, 4, 12, 13]]],
    ['descriptor expanded size', [[74, 4, 12, 13]]],
    ['matching wrong expanded sizes', [[102, 4, 12, 13], [74, 4, 12, 13]]],
    ['local CRC with descriptor', [[14, 4, 0, 1]]],
    ['local compressed size with descriptor', [[18, 4, 0, 1]]],
    ['local expanded size with descriptor', [[22, 4, 0, 1]]],
    ['local method', [[8, 2, 8, 0]]],
    ['central method', [[88, 2, 8, 0]]],
    ['matching false methods', [[8, 2, 8, 0], [88, 2, 8, 0]]],
    ['local descriptor flag', [[6, 2, 8, 0]]],
    ['central descriptor flag', [[86, 2, 8, 0]]],
    ['matching false descriptor flags', [[6, 2, 8, 0], [86, 2, 8, 0]]],
  ];
  const vectors = fields.map(([name, changes]) => {
    const archive = Buffer.from(ciArtifactZip, 'base64');
    for (const [offset, width, before, after] of changes) {
      assert.equal(archive.readUIntLE(offset, width), before, name + ' fixture premise');
      archive.writeUIntLE(after, offset, width);
      assert.equal(archive.readUIntLE(offset, width), after, name + ' mutation readback');
    }
    return [name, archive];
  });
  const changedPayload = Buffer.from(ciArtifactZip, 'base64');
  // Independently derived with Python zlib: same-length {"schema":2}, CRC32 0xa2d6924f.
  const alternateDeflate = Buffer.from('ab562a4ece48cd4d54b232aa0500', 'hex');
  assert.equal(alternateDeflate.length, 14);
  alternateDeflate.copy(changedPayload, 48);
  assert.deepEqual(changedPayload.subarray(48, 62), alternateDeflate);
  vectors.push(['changed payload with stale checksum', changedPayload]);
  const original = Buffer.from(ciArtifactZip, 'base64');
  const trailingDeflate = Buffer.concat([original.subarray(0, 62), Buffer.from([0]), original.subarray(62)]);
  // Preserve correct framing and agreement of declared sizes while adding an unconsumed compressed byte.
  trailingDeflate.writeUInt32LE(15, 71);
  trailingDeflate.writeUInt32LE(15, 99);
  trailingDeflate.writeUInt32LE(79, 159);
  assert.equal(trailingDeflate.readUInt32LE(79), 0x02014b50);
  assert.equal(trailingDeflate.readUInt32LE(143), 0x06054b50);
  vectors.push(['unconsumed compressed byte', trailingDeflate]);
  const actual = await Promise.all(vectors.map(async ([name, archive]) => {
    const result = (await receiptArchiveResult(archive.toString('base64')));
    return { name, receipt: result.receipt, error: result.error };
  }));
  assert.deepEqual(actual, vectors.map(([name]) => ({ name, receipt: undefined, error: 'artifact archive refused' })));
});

test('receipt ZIP reader bounds archive bytes and actual native expansion at the two MiB boundary', async (t) => {
  const limit = 2 * 1024 * 1024;
  const rows = [
    ['expanded boundary', { expandedBytes: limit }, true, 1, 0],
    ['declared expansion overflow', { expandedBytes: limit + 1 }, false, 0, 0],
    ['hidden actual expansion overflow', { expandedBytes: limit + 1, declaredExpanded: limit }, false, 1, 1],
    ['archive boundary', { archiveBytes: limit }, true, 1, 0],
    ['archive overflow', { archiveBytes: limit + 1 }, false, 0, 0],
  ];
  const results = [];
  for (const [name, fixture, accepted, calls, limited] of rows) {
    const result = (await zipBudgetResult(t, fixture));
    if (fixture.archiveBytes) assert.equal(result.archiveBytes, fixture.archiveBytes, name + ' fixture premise');
    else assert.equal(result.expandedBytes, fixture.expandedBytes, name + ' fixture premise');
    results.push({ name, accepted: result.receiptLength === result.expectedTextLength, error: result.error,
      calls: result.probe.calls, limited: result.probe.limited, withinBudget: result.probe.largestReturned <= limit });
  }
  assert.deepEqual(results, rows.map(([name, fixture, accepted, calls, limited]) => ({
    name, accepted, error: accepted ? undefined : 'artifact archive refused', calls, limited, withinBudget: true,
  })));
});

test('receipt ZIP reader observes cancellation before work and while native or stalled inflation is pending', async (t) => {
  const modes = ['preaborted', 'native', 'stalled', 'callback-error'];
  const actual = [];
  for (const mode of modes) {
    const result = (await zipDeadlineResult(t, mode));
    actual.push({ mode, accepted: result.accepted === true, error: result.error, calls: result.probe.calls,
      startedBeforeAbort: result.probe.startedBeforeAbort, nativeAbortErrors: result.probe.nativeAbortErrors });
  }
  assert.deepEqual(actual, modes.map((mode) => ({ mode, accepted: false, error: 'artifact archive refused',
    calls: mode === 'preaborted' ? 0 : 1, startedBeforeAbort: ['native', 'stalled'].includes(mode),
    nativeAbortErrors: mode === 'native' ? 1 : 0 })));
});

// Diagnostic CI artifact-operation ordering under #1119 P3; no product requirement is claimed.
test('full proof discovery retains one artifact lifetime across aborts and completed native work', async (t) => {
  // Mode, permitted artifact sends, genuine native callback outcomes, completed reuse credit.
  const rows = [
    ['completed-before-abort', 2, ['success'], true], ['preaborted-gate', 0, [], false],
    ['redirect-then-abort', 1, [], false], ['pending-redirect', 1, [], false],
    ['pending-download', 2, [], false], ['pending-body', 2, [], false],
    ['download-before-decode-abort', 2, [], false], ['native-pending-abort', 2, ['ABORT_ERR'], false],
    ['native-completed-before-acceptance-abort', 2, ['success'], false],
  ];
  const observed = [];
  for (const [name, expectedSends, expectedNative, expectedReuse] of rows) {
    const fixture = ciDiscoveryFixture(), controller = new AbortController(), fallback = new AbortController();
    const calls = [], downloads = [], delays = [], unexpected = [], headerSpies = [];
    const probe = { pending: false, cancelled: false, lateCompleted: false, settlements: 0, downloadComplete: false,
      nativePendingAtAbort: false, redirectAbort: false, decoderAbort: false, nativeFinalAbort: false, completedResultPreserved: false };
    let ready, releaseLate, observer, checkpoint;
    const readiness = new Promise((resolve) => { ready = resolve; });
    if (name === 'preaborted-gate') controller.abort();
    observer = nativeInflationObserver(t, (record) => {
      if (name === 'native-pending-abort') queueMicrotask(() => {
        probe.nativePendingAtAbort = !Object.hasOwn(record, 'returnedBytes'); controller.abort();
      });
    });
    if (name === 'download-before-decode-abort' || name === 'native-completed-before-acceptance-abort') {
      const nativeThrow = controller.signal.throwIfAborted;
      checkpoint = t.mock.method(controller.signal, 'throwIfAborted', function () {
        if (name === 'download-before-decode-abort' && probe.downloadComplete && observer.records.length === 0) {
          probe.decoderAbort = true; controller.abort();
        }
        if (name === 'native-completed-before-acceptance-abort' && observer.records.some((record) => record.code === undefined && record.returnedBytes > 0)) {
          probe.nativeFinalAbort = true; controller.abort();
        }
        return nativeThrow.call(this);
      });
    }
    const timeout = t.mock.method(AbortSignal, 'timeout', (delay) => { delays.push(delay); return fallback.signal; });
    const redirectResponse = () => {
      const response = new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
      if (name === 'redirect-then-abort') {
        const nativeGet = response.headers.get;
        headerSpies.push(t.mock.method(response.headers, 'get', function (field) {
          const value = nativeGet.call(this, field);
          if (field === 'location') { probe.redirectAbort = true; controller.abort(); }
          return value;
        }));
      }
      return response;
    };
    const downloadResponse = () => {
      let sent = false;
      return new Response(new ReadableStream({
        pull(stream) {
          if (name === 'pending-body') {
            probe.pending = true; ready();
            return new Promise((resolve) => { releaseLate = () => { probe.lateCompleted = true; resolve(); }; });
          }
          if (!sent) { sent = true; stream.enqueue(Buffer.from(fixture.archive, 'base64')); }
          else { probe.downloadComplete = true; stream.close(); }
        },
        cancel() { probe.cancelled = true; },
      }, { highWaterMark: 0 }));
    };
    let answer, native;
    try {
      const work = evaluateCiPolicy('discoverFullProof', fixture.facts, {
        signal: controller.signal, token: 'fixture-token',
        request: async (path) => {
          calls.push(path);
          if (!Object.hasOwn(fixture.api, path)) { unexpected.push(path); throw new Error('unexpected metadata fixture request'); }
          return fixture.api[path];
        },
        send: async (url, options) => {
          downloads.push({ url, method: options.method, redirect: options.redirect, headers: options.headers, signal: options.signal });
          if (calls.length !== 4) unexpected.push('artifact work before complete metadata reads');
          const first = url === 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip';
          const second = url === 'https://account.blob.core.windows.net/receipt';
          if (!first && !second) { unexpected.push(url); throw new Error('unexpected archive fixture request'); }
          if (name === 'pending-redirect' && first || name === 'pending-download' && second) {
            probe.pending = true; ready();
            return new Promise((resolve) => { releaseLate = () => { probe.lateCompleted = true; resolve(first ? redirectResponse() : downloadResponse()); }; });
          }
          return first ? redirectResponse() : downloadResponse();
        },
      }).then((result) => {
        probe.settlements++; probe.nativeCallbackAtLogicalSettlement = observer.records.some((record) => Object.hasOwn(record, 'returnedBytes'));
        return result;
      });
      if (['pending-redirect', 'pending-download', 'pending-body'].includes(name)) {
        assert.equal(await Promise.race([readiness.then(() => true), work.then(() => false)]), true, name + ' reaches actual pending artifact work');
        assert.equal(probe.pending, true); assert.equal(probe.settlements, 0); controller.abort();
        // A logical settlement guard only; native completion is awaited separately below.
        answer = await Promise.race([work, new Promise((resolve) => setImmediate(() => resolve({ reason: 'pending artifact operation remained unsettled' })))]);
        assert.equal(probe.settlements, 1, name + ' settles after manual abort of observed pending work');
        if (name === 'pending-body') assert.equal(probe.cancelled, true, 'actual archive reader cancellation is observed');
        releaseLate(); await new Promise((resolve) => setImmediate(resolve));
        assert.equal(probe.lateCompleted, true); assert.equal(probe.settlements, 1);
        assert.equal(await work, answer, name + ' late collaborator completion cannot upgrade the settled refusal');
      } else answer = await work;
      await observer.wait();
      native = observer.records.map(({ signal, code, returnedBytes, consumedBytes }) => ({ sharedSignal: signal === controller.signal, code, returnedBytes, consumedBytes }));
      if (name === 'completed-before-abort') {
        assert.deepEqual(answer.reuse?.receipt, ciFullReceiptFixture().receipt, 'all native and final proof guards completed before abort');
        const completed = JSON.stringify(answer); controller.abort();
        assert.equal(await work, answer); assert.equal(JSON.stringify(answer), completed); probe.completedResultPreserved = true;
      }
    } finally {
      await observer.restore();
      for (const spy of headerSpies) spy.mock.restore();
      if (checkpoint) checkpoint.mock.restore();
      timeout.mock.restore();
    }
    assert.deepEqual(unexpected, [], name + ' stays within literal complete metadata and archive collaborators');
    assert.equal(calls.length, 4, name + ' retains the accepted pre-artifact metadata reads');
    assert.equal(new Set(calls).size, 4, name + ' does not retry metadata');
    assert.equal(downloads.length, expectedSends);
    for (const [at, call] of downloads.entries()) {
      assert.equal(call.url, at === 0 ? 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip' : 'https://account.blob.core.windows.net/receipt');
      assert.equal(call.method, 'GET'); assert.equal(call.redirect, 'manual'); assert.equal(call.signal, controller.signal);
      assert.deepEqual(call.headers, at === 0 ? { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' } : {});
    }
    assert.deepEqual(native.map((record) => record.code ?? 'success'), expectedNative, name + ' preserves genuine native callback outcomes');
    assert.ok(native.every((record) => record.sharedSignal), name + ' native work keeps the artifact signal');
    if (expectedNative.includes('success')) assert.ok(native[0].returnedBytes > 0 && native[0].consumedBytes > 0, 'successful native callback records actual input and output lengths');
    if (name === 'redirect-then-abort') assert.equal(probe.redirectAbort, true);
    if (name === 'download-before-decode-abort') { assert.equal(probe.downloadComplete, true); assert.equal(probe.decoderAbort, true); }
    if (name === 'native-pending-abort') assert.equal(probe.nativePendingAtAbort, true, 'manual abort preceded genuine native callback completion');
    if (name === 'native-completed-before-acceptance-abort') assert.equal(probe.nativeFinalAbort, true);
    if (name === 'completed-before-abort') assert.equal(probe.completedResultPreserved, true);
    assert.equal(controller.signal.aborted, true); assert.deepEqual(delays, [], name + ' no fresh fallback budget rescues an aborted step');
    const proof = ciReuseFixture().proof; proof.reuse = answer.reuse;
    const readinessGranted = await evaluateCiPolicy('guard', fixture.facts, proof);
    assert.equal(Boolean(answer.reuse), expectedReuse, name + ' actual discovery credit');
    assert.equal(readinessGranted, expectedReuse, name + ' actual readiness remains bound to artifact completion order');
    assert.equal(answer.reason, expectedReuse ? undefined : 'full proof discovery refused');
    assert.equal(probe.settlements, 1);
    observed.push({ name, reused: Boolean(answer.reuse), ready: readinessGranted, metadataReads: calls.length, archiveSends: downloads.length,
      native, defaultCalls: delays.length, pendingObserved: probe.pending, cancelled: probe.cancelled, lateCompleted: probe.lateCompleted,
      nativePendingAtAbort: probe.nativePendingAtAbort, nativeCallbackAtLogicalSettlement: probe.nativeCallbackAtLogicalSettlement,
      redirectAbort: probe.redirectAbort, decoderAbort: probe.decoderAbort, nativeFinalAbort: probe.nativeFinalAbort,
      completedResultPreserved: probe.completedResultPreserved, reason: answer.reason });
  }
  t.diagnostic(JSON.stringify(observed));
});

// Diagnostic CI actual metadata-read failure projection under #1119 C5; no product requirement is claimed.
test('full proof discovery grants no readiness after bounded metadata reader faults or incomplete API pages', async (t) => {
  const prefix = '/repos/williacj/rigger/actions', limit = 2 * 1024 * 1024;
  const routes = {
    discovery: prefix + '/workflows/9130/runs?event=pull_request&head_sha=' + 'd'.repeat(40) + '&status=success&per_page=100',
    detail: prefix + '/runs/4101/attempts/2', jobs: prefix + '/runs/4101/attempts/2/jobs?per_page=100',
    artifacts: prefix + '/runs/4101/artifacts?per_page=100',
  };
  const readOrder = [routes.discovery, routes.detail, routes.jobs, routes.artifacts];
  const refused = 'full proof discovery refused';
  // Name, affected metadata stage, independent collaborator fault, permitted read prefix, refusal class.
  const rows = [
    ['valid', null, 'none', 4, undefined],
    ['discovery status', 'discovery', 'status', 1, refused],
    ['detail malformed JSON', 'detail', 'malformed-json', 2, refused],
    ['jobs truncated body', 'jobs', 'truncated', 3, refused],
    ['artifacts next page', 'artifacts', 'next-page', 4, refused],
    ['discovery oversized body', 'discovery', 'oversized', 1, refused],
    ['detail fetch error', 'detail', 'fetch-error', 2, refused],
    ['jobs pending fetch', 'jobs', 'pending-fetch', 3, refused],
    ['artifacts pending body', 'artifacts', 'pending-body', 4, refused],
    ['jobs body error', 'jobs', 'body-error', 3, refused],
    ['discovery incomplete', 'discovery', 'incomplete', 1, 'discovery page incomplete'],
    ['detail inconsistent identity', 'detail', 'incomplete', 2, 'no verified full proof'],
    ['jobs incomplete', 'jobs', 'incomplete', 3, 'no verified full proof'],
    ['artifacts incomplete', 'artifacts', 'incomplete', 4, 'artifact page incomplete'],
    ['discovery over one hundred', 'discovery', 'over-one-hundred', 1, 'discovery page incomplete'],
    ['jobs over one hundred', 'jobs', 'over-one-hundred', 3, 'no verified full proof'],
    ['artifacts over one hundred', 'artifacts', 'over-one-hundred', 4, 'artifact page incomplete'],
  ];
  const observed = [];
  for (const [name, stage, fault, expectedReads, reason] of rows) {
    const fixture = ciDiscoveryFixture(), affected = routes[stage];
    if (fault === 'incomplete') {
      if (stage === 'detail') {
        fixture.api[affected] = { ...fixture.api[affected], id: 4100 };
        assert.equal(fixture.api[routes.discovery].workflow_runs[0].id, 4101, 'offered identity remains independent of inconsistent detail');
      } else fixture.api[affected].total_count++;
    }
    if (fault === 'over-one-hundred') {
      const page = fixture.api[affected];
      if (stage === 'discovery') {
        const run = page.workflow_runs[0];
        page.workflow_runs = Array.from({ length: 101 }, (_, at) => ({ ...run, id: 4101 + at }));
        assert.equal(page.workflow_runs.length, 101);
      } else if (stage === 'jobs') {
        page.jobs.push(...Array.from({ length: 94 }, (_, at) => ({ id: 6000 + at, run_id: 4101, run_attempt: 2,
          name: 'other-job-' + at, status: 'completed', conclusion: 'success' })));
        assert.equal(page.jobs.length, 101); assert.equal(new Set(page.jobs.map((job) => job.id)).size, 101);
      } else {
        const artifact = page.artifacts[0];
        page.artifacts.push(...Array.from({ length: 100 }, (_, at) => ({ ...artifact, id: 7000 + at, name: 'other-proof-' + at })));
        assert.equal(page.artifacts.length, 101); assert.equal(new Set(page.artifacts.map((artifact) => artifact.id)).size, 101);
      }
      page.total_count = 101;
    }
    const calls = [], downloads = [], delays = [], unexpected = [], produced = {}, cancelled = [];
    const archiveSignal = new AbortController().signal, fallback = new AbortController();
    const probe = { pending: false, abortedAfterReadiness: false, lateCompleted: false, settlements: 0 };
    let ready, pendingController, releaseLate;
    const readiness = new Promise((resolve) => { ready = resolve; });
    const responseFor = (path) => {
      const target = path === affected, headers = {};
      let bytes = Buffer.from(JSON.stringify(fixture.api[path]));
      if (target && fault === 'malformed-json') bytes = Buffer.from('{');
      if (target && fault === 'oversized') bytes = Buffer.from('{"data":"' + 'x'.repeat(limit) + '"}');
      assert.ok(target && fault === 'oversized' ? bytes.length > limit : bytes.length <= limit, name + ' independent body-size premise');
      if (target && fault === 'truncated') headers['content-length'] = String(bytes.length + 1);
      if (target && fault === 'next-page') headers.link = '<https://api.github.com' + path + '&page=2>; rel="next"';
      let offset = 0;
      return new Response(new ReadableStream({
        pull(stream) {
          if (target && fault === 'body-error') throw new Error('private fixture-token signature=private');
          if (target && fault === 'pending-body') {
            probe.pending = true; ready();
            return new Promise((resolve) => { releaseLate = () => { probe.lateCompleted = true; resolve(); }; });
          }
          if (offset === bytes.length) { stream.close(); return; }
          const end = Math.min(offset + 65536, bytes.length);
          stream.enqueue(bytes.subarray(offset, end)); produced[path] = (produced[path] ?? 0) + end - offset; offset = end;
        },
        cancel() { cancelled.push(path); },
      }, { highWaterMark: 0 }), { status: target && fault === 'status' ? 403 : 200, headers });
    };
    const observer = nativeInflationObserver(t);
    const timeout = t.mock.method(AbortSignal, 'timeout', (delay) => { delays.push(delay); return fallback.signal; });
    let answer, native;
    try {
      const work = evaluateCiPolicy('discoverFullProof', fixture.facts, {
        signal: archiveSignal, token: 'fixture-token',
        request: async (path) => {
          if (!Object.hasOwn(fixture.api, path)) { unexpected.push(path); throw new Error('unexpected metadata fixture route'); }
          const controller = new AbortController();
          if (path === affected) pendingController = controller;
          return evaluateCiPolicy('requestJson', path, { signal: controller.signal, token: 'fixture-token',
            send: async (url, options) => {
              calls.push({ path, url, method: options.method, headers: options.headers, expectedSignal: options.signal === controller.signal });
              if (url !== 'https://api.github.com' + path) { unexpected.push(url); throw new Error('unexpected metadata fixture URL'); }
              if (path === affected && fault === 'fetch-error') throw new Error('private fixture-token signature=private');
              if (path === affected && fault === 'pending-fetch') {
                probe.pending = true; ready();
                return new Promise((resolve) => { releaseLate = () => { probe.lateCompleted = true; resolve(responseFor(path)); }; });
              }
              return responseFor(path);
            },
          });
        },
        send: async (url, options) => {
          downloads.push({ url, method: options.method, redirect: options.redirect, headers: options.headers, signal: options.signal });
          if (url === 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip')
            return new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
          if (url === 'https://account.blob.core.windows.net/receipt') return new Response(Buffer.from(fixture.archive, 'base64'));
          unexpected.push(url); throw new Error('unexpected archive fixture URL');
        },
      }).then((result) => { probe.settlements++; return result; });
      if (fault === 'pending-fetch' || fault === 'pending-body') {
        assert.equal(await Promise.race([readiness.then(() => true), work.then(() => false)]), true, name + ' reaches the actual pending collaborator');
        assert.equal(probe.pending, true); assert.equal(probe.settlements, 0);
        probe.abortedAfterReadiness = true; pendingController.abort();
        // Logical settlement guard only; no elapsed-time or native-completion claim.
        answer = await Promise.race([work, new Promise((resolve) => setImmediate(() => resolve({ reason: 'controlled pending read remained pending' })))]);
        assert.equal(probe.settlements, 1, name + ' settles refusal after observed readiness and manual abort');
        if (fault === 'pending-body') assert.ok(cancelled.includes(affected), 'actual JSON reader cancels its pending body');
        releaseLate(); await new Promise((resolve) => setImmediate(resolve));
        assert.equal(probe.lateCompleted, true); assert.equal(probe.settlements, 1, name + ' late completion cannot resettle discovery');
        assert.equal(await work, answer, name + ' retains its settled refusal after late completion');
      } else answer = await work;
      await observer.wait();
      native = observer.records.map(({ signal, code, returnedBytes, consumedBytes }) => ({ sharedSignal: signal === archiveSignal, code, returnedBytes, consumedBytes }));
    } finally { await observer.restore(); timeout.mock.restore(); }
    assert.deepEqual(unexpected, [], name + ' uses only literal recorded routes');
    assert.deepEqual(calls.map(({ path }) => path), readOrder.slice(0, expectedReads), name + ' permits only its independent bounded read prefix');
    for (const call of calls) {
      assert.equal(call.method, 'GET'); assert.equal(call.expectedSignal, true);
      assert.deepEqual(call.headers, { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' });
    }
    assert.ok(Object.values(produced).every((bytes) => bytes <= limit + 65536), name + ' streaming consumption stays within one final chunk of its byte bound');
    if (fault === 'oversized') assert.ok(cancelled.includes(affected), 'oversized JSON consumption cancels its actual reader');
    if (name === 'valid') {
      assert.deepEqual(answer.reuse?.receipt, ciFullReceiptFixture().receipt, 'complete actual JSON-reader pipeline reaches the independent literal receipt');
      assert.deepEqual(downloads.map(({ url }) => url), ['https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip', 'https://account.blob.core.windows.net/receipt']);
      assert.deepEqual(downloads.map(({ method, redirect, signal }) => ({ method, redirect, sharedSignal: signal === archiveSignal })),
        [{ method: 'GET', redirect: 'manual', sharedSignal: true }, { method: 'GET', redirect: 'manual', sharedSignal: true }]);
      assert.deepEqual(downloads[0].headers, { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' });
      assert.deepEqual(downloads[1].headers, {});
      assert.equal(native.length, 1); assert.equal(native[0].code, undefined);
      assert.ok(native[0].sharedSignal && native[0].returnedBytes > 0 && native[0].consumedBytes > 0, 'actual native callback completes before restoration');
    } else { assert.deepEqual(downloads, [], name + ' grants no artifact sends'); assert.deepEqual(native, [], name + ' grants no native decode'); }
    assert.deepEqual(delays, [], name + ' manual API and artifact signals arm no default timers');
    const proof = ciReuseFixture().proof; proof.reuse = answer.reuse;
    const readinessGranted = await evaluateCiPolicy('guard', fixture.facts, proof);
    assert.doesNotMatch(answer.reason ?? '', /fixture-token|signature=private/, name + ' public refusal never exposes collaborator secrets');
    observed.push({ name, reused: Boolean(answer.reuse), ready: readinessGranted, apiReads: calls.length,
      archiveSends: downloads.length, nativeCalls: native.length, reason: answer.reason, defaultCalls: delays.length,
      pendingObserved: probe.pending, abortedAfterReadiness: probe.abortedAfterReadiness, lateCompleted: probe.lateCompleted });
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, rows.map(([name, stage, fault, apiReads, reason]) => ({ name, reused: name === 'valid', ready: name === 'valid', apiReads,
    archiveSends: name === 'valid' ? 2 : 0, nativeCalls: name === 'valid' ? 1 : 0, reason, defaultCalls: 0,
    pendingObserved: fault === 'pending-fetch' || fault === 'pending-body',
    abortedAfterReadiness: fault === 'pending-fetch' || fault === 'pending-body', lateCompleted: fault === 'pending-fetch' || fault === 'pending-body' })),
  'only complete bounded metadata reads may supply full-proof readiness');
});

// Diagnostic CI one-page read bound under #1119 C5; no product requirement is claimed.
test('full proof discovery refuses a next-page API link with an unquoted relation token', async (t) => {
  const fixture = ciDiscoveryFixture(), controller = new AbortController(), fallback = new AbortController();
  const listing = '/repos/williacj/rigger/actions/workflows/9130/runs?event=pull_request&head_sha=' + 'd'.repeat(40) + '&status=success&per_page=100';
  // RFC 8288 section 3: token and quoted-string link parameter values are equivalent.
  // https://www.rfc-editor.org/rfc/rfc8288.html#section-3
  const link = '<https://api.github.com' + listing + '&page=2>; rel=next';
  assert.equal(fixture.api[listing].total_count, 1);
  assert.equal(fixture.api[listing].workflow_runs.length, 1, 'otherwise complete usable discovery fixture');
  const calls = [], bodyReads = [], downloads = [], delays = [], unexpected = [];
  const observer = nativeInflationObserver(t);
  const timeout = t.mock.method(AbortSignal, 'timeout', (delay) => { delays.push(delay); return fallback.signal; });
  let answer;
  try {
    answer = await evaluateCiPolicy('discoverFullProof', fixture.facts, {
      signal: controller.signal, token: 'fixture-token',
      request: async (path) => {
        if (!Object.hasOwn(fixture.api, path)) { unexpected.push(path); throw new Error('unexpected metadata fixture route'); }
        return evaluateCiPolicy('requestJson', path, { signal: controller.signal, token: 'fixture-token',
          send: async (url, options) => {
            calls.push({ path, url, method: options.method, headers: options.headers, signal: options.signal });
            if (url !== 'https://api.github.com' + path) { unexpected.push(url); throw new Error('unexpected metadata fixture URL'); }
            const bytes = Buffer.from(JSON.stringify(fixture.api[path]));
            return new Response(new ReadableStream({
              pull(stream) { bodyReads.push(path); stream.enqueue(bytes); stream.close(); },
            }, { highWaterMark: 0 }), { status: 200, headers: path === listing ? { link } : {} });
          },
        });
      },
      send: async (url, options) => {
        downloads.push({ url, method: options.method, redirect: options.redirect, headers: options.headers, signal: options.signal });
        if (url === 'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip')
          return new Response(null, { status: 302, headers: { location: 'https://account.blob.core.windows.net/receipt' } });
        if (url === 'https://account.blob.core.windows.net/receipt') return new Response(Buffer.from(fixture.archive, 'base64'));
        unexpected.push(url); throw new Error('unexpected archive fixture URL');
      },
    });
    await observer.wait();
  } finally { await observer.restore(); timeout.mock.restore(); }
  const native = observer.records.map(({ code, returnedBytes, consumedBytes }) => ({ code, returnedBytes, consumedBytes }));
  t.diagnostic(JSON.stringify({ reused: Boolean(answer?.reuse), reason: answer?.reason, calls: calls.map(({ path }) => path),
    bodyReads, downloads: downloads.map(({ url }) => url), delays, native }));
  assert.deepEqual(unexpected, [], 'only independent literal fixture routes were exercised');
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.deepEqual(call.headers, { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' });
    assert.equal(call.signal, controller.signal);
  }
  assert.equal(Boolean(answer?.reuse), false, 'next-page indication cannot grant full-proof reuse');
  assert.equal(answer?.reason, 'full proof discovery refused');
  assert.deepEqual(calls.map(({ path }) => path), [listing], 'paginated discovery refuses before later metadata reads');
  assert.deepEqual(bodyReads, [], 'pagination is refused before consuming the JSON body');
  assert.deepEqual(downloads, [], 'pagination grants no artifact transport');
  assert.deepEqual(native, [], 'pagination grants no native decoding');
  assert.deepEqual(delays, [], 'supplied manual signals arm no default deadlines');
});

// Diagnostic CI pagination refusal under #1119 C5; no product requirement is claimed.
test('API reader accepts a complete GitHub page only when pagination Link is absent', async (t) => {
  // GitHub omits Link when results fit one page or the endpoint has no pagination.
  // https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
  const rows = [
    { name: 'complete', rel: undefined, refused: false },
    { name: 'other relations', rel: '"prev last"', refused: true },
    { name: 'next after prev', rel: '"prev next"', refused: true },
    { name: 'mixed-case next before prev', rel: '"NeXt prev"', refused: true },
    { name: 'space before equals', rel: 'next', parameter: 'rel =next', refused: true },
    { name: 'space after equals', rel: 'next', parameter: 'rel= next', refused: true },
    { name: 'tabs around equals', rel: '"NeXt prev"', parameter: 'rel\t=\t"NeXt prev"', refused: true },
    { name: 'quoted pair next', rel: '"ne\\xt"', refused: true },
  ];
  const observed = [];
  for (const row of rows) {
    if (row.name === 'quoted pair next') assert.equal(Buffer.from(row.rel).toString('hex'), '226e655c787422', 'literal header retains its quoted-pair backslash');
    const controller = new AbortController(), calls = [];
    let value, error;
    try {
      value = await evaluateCiPolicy('requestJson', '/repos/williacj/rigger/actions/runs', {
        signal: controller.signal, token: 'fixture-token',
        send: async (url, options) => {
          calls.push({ url, options });
          return new Response('{"total_count":0,"workflow_runs":[]}', {
            headers: row.rel === undefined ? {} : { link: '<https://api.github.com/repos/williacj/rigger/actions/runs?page=2>; ' + (row.parameter ?? ('rel=' + row.rel)) },
          });
        },
      });
    } catch (failure) { error = failure.message; }
    assert.equal(calls.length, 1, row.name + ' one actual GET without retries');
    assert.equal(calls[0].url, 'https://api.github.com/repos/williacj/rigger/actions/runs');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.signal, controller.signal, row.name + ' supplied unarmed signal');
    assert.deepEqual(calls[0].options.headers, { authorization: 'Bearer fixture-token', accept: 'application/vnd.github+json' });
    observed.push({ name: row.name, refused: error !== undefined, value, error });
    if (!row.refused) assert.deepEqual(value, { total_count: 0, workflow_runs: [] }, row.name + ' valid actual reader premise');
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, [
    { name: 'complete', refused: false, value: { total_count: 0, workflow_runs: [] }, error: undefined },
    { name: 'other relations', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'next after prev', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'mixed-case next before prev', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'space before equals', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'space after equals', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'tabs around equals', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
    { name: 'quoted pair next', refused: true, value: undefined, error: 'API status or pagination is incomplete' },
  ], 'any pagination Link refuses the complete-looking GitHub page');
});

// Diagnostic CI repeated-candidate read/decode bound under #1119 C5; no product requirement is claimed.
test('full proof discovery processes a repeated run attempt only once after a decoded candidate refusal', async (t) => {
  const fixture = ciDiscoveryFixture('candidate-mismatch');
  const listing = '/repos/williacj/rigger/actions/workflows/9130/runs?event=pull_request&head_sha=' + 'd'.repeat(40) + '&status=success&per_page=100';
  const page = fixture.api[listing];
  page.workflow_runs.push(structuredClone(page.workflow_runs[0])); page.total_count = 2;
  assert.deepEqual(page.workflow_runs.map((run) => [run.id, run.run_attempt]), [[4101, 2], [4101, 2]], 'complete page independently repeats the same run attempt');
  const fallback = new AbortController(), delays = [];
  const timeout = t.mock.method(AbortSignal, 'timeout', (delay) => { delays.push(delay); return fallback.signal; });
  let result;
  try { result = await discoveryResult(t, fixture, { providedSignal: false }); }
  finally { timeout.mock.restore(); }
  const native = result.native.map(({ code, returnedBytes, consumedBytes }) => ({ code, returnedBytes, consumedBytes }));
  t.diagnostic(JSON.stringify({ reused: Boolean(result.answer?.reuse), reason: result.answer?.reason, error: result.error,
    calls: result.calls, downloads: result.downloads, delays, native, sharedSignal: result.signals.every((signal) => signal === fallback.signal) }));
  assert.equal(result.error, undefined, 'actual discovery completes normally');
  assert.equal(Boolean(result.answer?.reuse), false, 'decoded candidate mismatch refuses readiness');
  assert.equal(result.answer?.reason, 'no verified full proof', 'refusal comes from final proof guards');
  assert.ok(native.length > 0 && native.every((record) => record.code === undefined && record.returnedBytes > 0 && record.consumedBytes > 0), 'candidate refusal follows genuine completed native decoding');
  assert.ok(result.signals.every((signal) => signal === fallback.signal), 'all observed transport and native stages use the safe fallback');
  assert.deepEqual(result.calls, [listing, '/repos/williacj/rigger/actions/runs/4101/attempts/2',
    '/repos/williacj/rigger/actions/runs/4101/attempts/2/jobs?per_page=100',
    '/repos/williacj/rigger/actions/runs/4101/artifacts?per_page=100'], 'repeated identity permits only one detail jobs artifact sequence');
  assert.deepEqual(result.downloads, ['https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip',
    'https://account.blob.core.windows.net/receipt'], 'repeated identity permits only two artifact transport sends');
  assert.equal(native.length, 1, 'repeated identity permits only one actual native decode');
  assert.deepEqual(delays, [30_000], 'repeated identity permits only one default deadline construction');
});

test('full proof discovery joins actual receipt transport and decode with candidate and prior-job verification', async (t) => {
  const modes = ['usable', 'candidate-mismatch', 'host-failed'];
  const results = [];
  for (const mode of modes) {
    const fixture = ciDiscoveryFixture(mode), result = (await discoveryResult(t, fixture));
    results.push({ mode, fixture, result });
  }
  assert.deepEqual(results.map(({ mode, result }) => ({ mode, accepted: Boolean(result.answer?.reuse), error: result.error })),
    modes.map((mode) => ({ mode, accepted: mode === 'usable', error: undefined })));
  for (const { mode, fixture, result } of results) {
    const allowed = Object.keys(fixture.api);
    assert.ok(result.calls.every((path) => allowed.includes(path)), mode + ' repository-scoped bounded reads');
    assert.equal(new Set(result.calls).size, result.calls.length, mode + ' no repeated lookup');
    if (mode === 'host-failed') {
      assert.ok(result.calls.includes('/repos/williacj/rigger/actions/runs/4101/attempts/2/jobs?per_page=100'), 'actual prior jobs are consulted');
      // A known failed prior job can refuse proof before artifact lookup/download; either path fails closed.
      if (result.downloads.length === 0) continue;
    } else assert.deepEqual(result.calls.sort(), allowed.sort(), mode + ' complete one-page read path');
    assert.deepEqual(result.downloads, [
      'https://api.github.com/repos/williacj/rigger/actions/artifacts/6001/zip',
      'https://account.blob.core.windows.net/receipt',
    ]);
    assert.equal(result.sharedDeadline, true, mode + ' one signal spans both GETs and actual native decode');
  }
  assert.deepEqual(results[0].result.answer.reuse.receipt, ciFullReceiptFixture().receipt);
  assert.equal(results[0].result.answer.reuse.run.id, 4101);
  assert.equal(results[0].result.answer.reuse.jobs.jobs.find((job) => job.name === 'full_host').conclusion, 'success');
});

test('full proof discovery refuses absent ambiguous expired foreign and oversized artifact metadata before download', async (t) => {
  const prefix = '/repos/williacj/rigger/actions/runs/4101/artifacts?per_page=100';
  const vectors = [
    ['absent', (page) => { page.artifacts = []; page.total_count = 0; }, 'artifact receipt absent'],
    ['wrong receipt name', (page) => { page.artifacts[0].name = 'other-proof'; }, 'artifact receipt absent'],
    ['duplicate receipt', (page) => { page.artifacts.push({ ...page.artifacts[0], id: 6002 }); page.total_count = 2; }, 'artifact receipt ambiguous'],
    ['expired', (page) => { page.artifacts[0].expired = true; }, 'artifact expired'],
    ['unknown expiration', (page) => { delete page.artifacts[0].expired; }, 'artifact metadata refused'],
    ['invalid ID', (page) => { page.artifacts[0].id = 0; }, 'artifact metadata refused'],
    ['non-numeric ID', (page) => { page.artifacts[0].id = '6001'; }, 'artifact metadata refused'],
    ['foreign run', (page) => { page.artifacts[0].workflow_run.id = 4102; }, 'artifact metadata refused'],
    ['foreign repository', (page) => { page.artifacts[0].workflow_run.repository_id = 43; }, 'artifact metadata refused'],
    ['foreign head', (page) => { page.artifacts[0].workflow_run.head_sha = '0'.repeat(40); }, 'artifact metadata refused'],
    ['oversized', (page) => { page.artifacts[0].size_in_bytes = 2 * 1024 * 1024 + 1; }, 'artifact size refused'],
    ['unknown size', (page) => { delete page.artifacts[0].size_in_bytes; }, 'artifact size refused'],
    ['negative size', (page) => { page.artifacts[0].size_in_bytes = -1; }, 'artifact size refused'],
    ['non-numeric size', (page) => { page.artifacts[0].size_in_bytes = '164'; }, 'artifact size refused'],
  ];
  const observed = [];
  for (const [name, change] of vectors) {
    const fixture = ciDiscoveryFixture();
    change(fixture.api[prefix]);
    const result = (await discoveryResult(t, fixture));
    observed.push({ name, accepted: Boolean(result.answer?.reuse), reason: result.answer?.reason, error: result.error, downloads: result.downloads.length });
  }
  // GitHub REST schema artifact.workflow_run is optional/nullable; the run-scoped endpoint binds membership.
  // github/rest-api-description c66e298030d4070b70a569dcd4268b3a041b5380, components.schemas.artifact.
  const optionalOrigins = [];
  for (const [name, origin] of [['omitted', undefined], ['null', null], ['partial', { id: 4101 }]]) {
    const fixture = ciDiscoveryFixture();
    if (origin === undefined) delete fixture.api[prefix].artifacts[0].workflow_run;
    else fixture.api[prefix].artifacts[0].workflow_run = origin;
    const result = (await discoveryResult(t, fixture));
    optionalOrigins.push({ name, accepted: Boolean(result.answer?.reuse), error: result.error, downloads: result.downloads.length, sharedDeadline: result.sharedDeadline });
  }
  t.diagnostic(JSON.stringify({ refusals: observed, optionalOrigins }));
  assert.deepEqual(observed, vectors.map(([name, change, reason]) => ({ name, accepted: false, reason, error: undefined, downloads: 0 })));
  assert.deepEqual(optionalOrigins, ['omitted', 'null', 'partial'].map((name) => ({ name, accepted: true, error: undefined, downloads: 2, sharedDeadline: true })));
});

test('actual inline API reader bounds streamed JSON consumption and settles observed pending reads on cancellation', async (t) => {
  const modes = ['boundary', 'overflow', 'preaborted', 'fetch-stalled', 'body-stalled', 'fetch-error', 'body-error'];
  const observed = await Promise.all(modes.map(async (mode) => {
    const result = (await apiReadBoundsResult(mode));
    return { mode, accepted: result.accepted === true, error: result.error,
      calls: result.probe.calls, sharedSignal: result.probe.sharedSignal, startedBeforeAbort: result.probe.startedBeforeAbort,
      withinReadBudget: result.probe.produced <= 2 * 1024 * 1024 + 65536, cancelled: result.probe.cancelled };
  }));
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, modes.map((mode) => ({ mode, accepted: mode === 'boundary',
    error: mode === 'boundary' ? undefined : 'API read refused', calls: mode === 'preaborted' ? 0 : 1,
    sharedSignal: mode !== 'preaborted', startedBeforeAbort: ['fetch-stalled', 'body-stalled'].includes(mode),
    withinReadBudget: true, cancelled: ['overflow', 'body-stalled'].includes(mode) })));
});

test('aggregate proof reads have exact job-scoped Actions authority while cancellation alone retains write authority', async (t) => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  // GitHub workflow-syntax#permissions: a job mapping replaces workflow scopes; unspecified scopes become none.
  // Artifact list/download and run/job detail reads require Actions read, independently of upload's runtime token.
  const effective = (job) => job.permissions ?? ci.permissions;
  const ordinary = { contents: 'read', 'pull-requests': 'read' };
  assert.deepEqual(ci.permissions, ordinary, 'new Actions authority is not global');
  assert.deepEqual(effective(ci.jobs.check), { contents: 'read', 'pull-requests': 'read', actions: 'read' },
    'aggregate collection, prior-run jobs and artifact reads need only their exact read scopes');
  assert.deepEqual(ci.jobs.cancel_superseded.permissions, { actions: 'write', 'pull-requests': 'read' },
    'guarded cancellation retains its existing isolated write scope');
  for (const [name, job] of Object.entries(ci.jobs)) {
    if (name === 'check' || name === 'cancel_superseded') continue;
    assert.deepEqual(effective(job), ordinary, name + ' gains no Actions scope or other authority');
  }
});
