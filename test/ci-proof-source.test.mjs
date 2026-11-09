// ABOUTME: Ordinary recorded-source CI policy cases, evaluated without child processes or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';
import { evaluateCiPolicy, ciFacts, ciProof, ciFullFixture, ciCollectorFixture } from './ci-policy-fixtures.mjs';
import { ciNodeMajor } from './ci-policy-fixtures.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { gateAnswer } from '../src/workflow/gate.mjs';

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
  return new Function('needs', 'github', 'return (' + job.name.slice(3, -2).trim() + ')')(context, needs.github ?? { event_name: 'pull_request', base_ref: 'main' });
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

test('deferred naming verifies at its own name and later source invalidation supplies no proof', async () => {
  const facts = ciFacts(); facts.changes[0].path = 'src/workflow/action.mjs';
  const proof = ciProof('BROAD_DEFERRED');
  const planned = { plan: { result: 'success', outputs: { mode: 'BROAD_DEFERRED' } } };
  const verified = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.source, proof.source);
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
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['cancel_superseded', 'check', 'demo', 'fast', 'full_host', 'full_ordinary', 'host-record', 'nightly', 'plan']);
  assert.deepEqual(ci.jobs.check.needs, ['plan', 'fast', 'full_ordinary', 'full_host', 'demo', 'cancel_superseded']);
  assert.equal(ci.jobs.check.if, "${{ always() && !(needs.plan.result == 'success' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' && needs.plan.outputs.mode == 'MAIN_FULL') }}");
  assert.deepEqual(ci.jobs.check.strategy, { 'fail-fast': 'false', matrix: { node: ['26'] } });
  assert.equal(ci.jobs.check['runs-on'], 'ubuntu-latest');
  assert.equal(ci.jobs.check['continue-on-error'], undefined);
  assert.equal(ci.jobs.check.steps.at(-1).run, 'node --input-type=module -e "$CI_POLICY"');
  assert.equal(ci.jobs.check.steps.at(-1).env.CI_POLICY_ACTION, 'aggregate');
  assert.equal(ci.jobs.check.steps.at(-1).if, undefined);
  assert.equal(ci.jobs.check.steps.at(-1)['continue-on-error'], undefined);
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

test('inline CI worker admits exactly major 26 and restores the fixture Node version', async (t) => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const policyJobs = Object.entries(ci.jobs).filter(([, job]) => job.steps.some((step) => step.env?.CI_POLICY_ACTION));
  assert.ok(policyJobs.length > 0, 'the workflow runs the inline policy');
  for (const [name, job] of policyJobs) {
    const installed = job.steps.find((step) => step.uses === 'actions/setup-node@v5').with['node-version'];
    const majors = installed === '${{ matrix.node }}' ? job.strategy.matrix.node : [installed];
    assert.deepEqual(majors, [ciNodeMajor], name + ' installs the shared fixture major');
  }
  const original = Object.getOwnPropertyDescriptor(process.versions, 'node');
  t.diagnostic(JSON.stringify({ node: process.version, descriptor: original }));
  assert.equal(original.configurable, true, 'the fixture can temporarily state the CI Node version');
  const facts = ciFacts(), proof = ciProof();
  for (const [major, expected] of [['24', false], ['25', false], ['26', true], ['27', false]]) {
    const worker = await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'fast' }, {}, major);
    assert.equal(worker.ok, expected, 'worker major ' + major);
    assert.deepEqual(Object.getOwnPropertyDescriptor(process.versions, 'node'), original, 'restored after major ' + major);
  }
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'fast' })).ok, true, 'default CI major');
  assert.deepEqual(Object.getOwnPropertyDescriptor(process.versions, 'node'), original, 'restored after the default major');
  await assert.rejects(evaluateCiPolicy('runPolicy', null, {}, '25'), TypeError);
  assert.deepEqual(Object.getOwnPropertyDescriptor(process.versions, 'node'), original, 'restored after the inline policy throws');
});

/** A main-targeting code pull request: `policy` defers it unless a fresh owner event requests more. */
function deferredFacts(change = () => {}) {
  const facts = ciFacts(); facts.changes[0].path = 'src/workflow/action.mjs'; change(facts); return facts;
}

const plannedAs = (mode) => ({ plan: { result: 'success', outputs: { mode } } });

/** What the forge holds of one aggregate run: its evaluated job name and the policy's answer. */
async function aggregateCheckRun(id, needs, facts, proof) {
  const { ok } = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  return { id, name: aggregateDisplayName(needs), status: 'completed', conclusion: ok ? 'success' : 'failure', app: { id: 15368 } };
}

/** The `Main` ruleset's Actions context, as `gh api repos/williacj/rigger/rules/branches/main` gave it on 2026-11-05. */
const REQUIRED_CHECK = { context: 'check (26)', integration_id: 15368 };

/** The engine's own read of `check (26)` at a head holding `runs`; the double answers GitHub's REST commit pages. */
async function requiredCheckAt(runs) {
  const send = async (_tool, args) => ({ status: 0, stdout: JSON.stringify(args[1].includes('/check-runs') ? { check_runs: runs } : []), stderr: '' });
  const states = await repositoryReads({ repo: 'williacj/rigger', project: 6 }, { send }).readCheckStates('d'.repeat(40), [REQUIRED_CHECK]);
  return states;
}

const gateRefusals = (checks) => gateAnswer({ comments: [], card: 1, pull: 2, head: 'd'.repeat(40), digest: 'e'.repeat(12), count: 1, judges: [], checks }).refusals.filter(({ check }) => check !== undefined);

test('Table A A1, A7, A8 and A9: a deferred run with its tiers skipped verifies, under the name no rule requires', async () => {
  for (const [name, change] of [
    ['A1 synchronize', () => {}],
    ['A7 another account adds ci:full', (facts) => { Object.assign(facts, { action: 'labeled', label: 'ci:full' }); facts.live.labels = ['ci:full']; }],
    ['A8 draft', (facts) => { facts.pr.draft = facts.live.draft = true; }],
    ['A8 draft with ci:full', (facts) => { Object.assign(facts, { action: 'labeled', sender: 'williacj', label: 'ci:full' }); facts.pr.draft = facts.live.draft = true; facts.live.labels = ['ci:full']; }],
    ['A9 ci:full removed', (facts) => { Object.assign(facts, { action: 'unlabeled', sender: 'williacj', label: 'ci:full' }); }],
    ['A9 edited', (facts) => { facts.action = 'edited'; }],
  ]) {
    const facts = deferredFacts(change), proof = ciProof('BROAD_DEFERRED');
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED', name);
    assert.equal(await evaluateCiPolicy('guard', facts, proof), true, name);
    const run = await aggregateCheckRun(1, plannedAs('BROAD_DEFERRED'), facts, proof);
    assert.deepEqual([run.name, run.conclusion], ['broad deferred (26)', 'success'], name);
    assert.deepEqual([...new Set(Object.values(proof.results))].sort(), ['skipped', 'success'], name + ': no job of the run fails');
  }
});

test('Table A A3: a green deferred run leaves check (26) absent at its head, and the engine\'s gate refuses absent', async () => {
  const facts = deferredFacts(), proof = ciProof('BROAD_DEFERRED');
  const run = await aggregateCheckRun(1, plannedAs('BROAD_DEFERRED'), facts, proof);
  assert.equal(run.conclusion, 'success');
  const states = await requiredCheckAt([run]);
  assert.deepEqual(states, { 'check (26)': { state: 'absent', creator: null } });
  assert.deepEqual(gateRefusals(states), [{ check: 'check (26)', reason: 'absent' }]);
});

test('Table A A11: a deferred run with an owner ci:demo request verifies only with demo success', async () => {
  const facts = deferredFacts((held) => { Object.assign(held, { action: 'labeled', sender: 'williacj', label: 'ci:demo' }); held.live.labels = ['ci:demo']; });
  assert.deepEqual(await evaluateCiPolicy('policy', facts), { mode: 'BROAD_DEFERRED', demoNeeded: true, sourceValid: true });
  const proof = ciProof('BROAD_DEFERRED'); proof.demoNeeded = true;
  proof.results.demo = 'success';
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, true, 'demo success');
  for (const demo of ['failure', 'cancelled', 'skipped']) {
    proof.results.demo = demo;
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, false, demo);
  }
});

test('Table A A12: a deferred run verifies only with both full tiers skipped', async () => {
  const facts = deferredFacts();
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: ciProof('BROAD_DEFERRED') })).ok, true, 'both skipped');
  for (const tier of ['full_ordinary', 'full_host']) for (const result of ['success', 'failure', 'cancelled']) {
    const proof = ciProof('BROAD_DEFERRED'); proof.results[tier] = result;
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, false, tier + ':' + result);
  }
});

test('Table A A2: a deferred run whose fast tier did not succeed fails with a reason that names no missing proof', async () => {
  const facts = deferredFacts();
  for (const fast of ['failure', 'cancelled', 'skipped']) {
    const proof = ciProof('BROAD_DEFERRED'); proof.results.fast = fast;
    const answer = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
    assert.equal(answer.ok, false, fast);
    assert.equal(answer.reason, 'current source or required tier result did not verify', fast);
    assert.equal((await aggregateCheckRun(1, plannedAs('BROAD_DEFERRED'), facts, proof)).name, 'broad deferred (26)', fast);
  }
});

/** The aggregate's name in a run of `event_name` against `base_ref`; GitHub gives `base_ref` only on pull request events. */
const nameOn = (needs, event_name, base_ref) => aggregateDisplayName({ ...needs, github: { event_name, base_ref } });

/** A pull request constituent of the branch `batch`, with facts and proof as `policy` reads them there. */
function constituent() {
  const facts = ciFacts(), proof = ciProof();
  facts.pr.baseRef = facts.live.baseRef = 'batch'; proof.source.baseRef = 'batch'; facts.changes[0].path = 'src/workflow/action.mjs';
  return { facts, proof };
}

test('Table A A20: a pull request run against another base is never named check (26), whatever its plan answered', () => {
  for (const mode of ['FAST_ELIGIBLE', 'BROAD_DEFERRED', 'BROAD_EXECUTED', 'INVALID', '']) for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const needs = { plan: { result, outputs: { mode } } };
    assert.equal(nameOn(needs, 'pull_request', 'batch'), 'broad deferred (26)', mode + ':' + result);
  }
  assert.equal(nameOn({ plan: { result: 'success', outputs: { mode: 'FAST_ELIGIBLE' } } }, 'pull_request', 'main'), 'check (26)', 'a main-targeting run keeps the required name');
  for (const [event, mode] of [['push', 'MAIN_SMOKE'], ['merge_group', 'BROAD_EXECUTED'], ['schedule', 'MAIN_FULL'], ['workflow_dispatch', 'MAIN_FULL']]) {
    assert.equal(nameOn(plannedAs(mode), event, ''), 'check (26)', event);
  }
});

test('Table A A20: a head green on another base holds no check (26) when retargeted, and a failed plan there fails under the other name', async () => {
  const { facts, proof } = constituent(), github = { event_name: 'pull_request', base_ref: 'batch' };
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'FAST_ELIGIBLE');
  const green = await aggregateCheckRun(1, { ...plannedAs('FAST_ELIGIBLE'), github }, facts, proof);
  assert.deepEqual([green.name, green.conclusion], ['broad deferred (26)', 'success']);
  assert.equal((await requiredCheckAt([green]))['check (26)'].state, 'absent', 'a retarget to main finds no check (26) at the head');
  const failed = structuredClone(proof); failed.results.plan = 'failure';
  const red = await aggregateCheckRun(2, { plan: { result: 'failure', outputs: {} }, github }, facts, failed);
  assert.deepEqual([red.name, red.conclusion], ['broad deferred (26)', 'failure']);
});

test('Table A A20: a journal-only pull request retargeted to main gets check (26) from its edited run', async () => {
  const facts = ciFacts(); facts.action = 'edited';
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'FAST_ELIGIBLE');
  const run = await aggregateCheckRun(1, plannedAs('FAST_ELIGIBLE'), facts, ciProof());
  assert.deepEqual([run.name, run.conclusion], ['check (26)', 'success']);
  assert.equal((await requiredCheckAt([run]))['check (26)'].state, 'passed');
});

test('Table A A30: policy refuses a base that differs from main only in letter case, and the run fails', async () => {
  for (const baseRef of ['MAIN', 'Main', 'mAiN']) {
    const { facts, proof } = constituent(); facts.pr.baseRef = facts.live.baseRef = proof.source.baseRef = baseRef;
    assert.deepEqual(await evaluateCiPolicy('policy', facts), { mode: 'INVALID', demoNeeded: false, sourceValid: false }, baseRef);
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, false, baseRef);
  }
  for (const baseRef of ['batch', 'mainline', 'Mainline']) {
    const { facts } = constituent(); facts.pr.baseRef = facts.live.baseRef = baseRef;
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'FAST_ELIGIBLE', baseRef);
  }
});

/** The `check` job's run at a labeled head: every tier passed, so it verifies under the required name. */
async function fullRunAt(id) {
  const { facts, proof } = ciFullFixture();
  return aggregateCheckRun(id, plannedAs('BROAD_EXECUTED'), facts, proof);
}

/** Moves a pull request to a later head by a push, the event that carries no label. */
function pushedHead(facts) {
  facts.pr.head = facts.live.head = facts.checkout.parents[1] = 'e'.repeat(40);
  facts.action = 'synchronize'; delete facts.label;
  return facts;
}

const jobRuns = (job, needs, github) => {
  const condition = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs[job].if;
  return new Function('needs', 'github', 'return (' + condition.slice(3, -2).trim() + ')')(needs, github);
};

test('Table A A4: the owner\'s ci:full labeled event with every tier passing puts a green check (26) at that head', async () => {
  const { facts } = ciFullFixture();
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_EXECUTED');
  const run = await fullRunAt(1);
  assert.deepEqual([run.name, run.conclusion], ['check (26)', 'success']);
  assert.equal((await requiredCheckAt([run]))['check (26)'].state, 'passed');
});

test('Table A A5: a push after a green check (26) leaves the new head deferred and blocked', async () => {
  const prior = await fullRunAt(1);
  assert.equal((await requiredCheckAt([prior]))['check (26)'].state, 'passed', 'the earlier head');
  const facts = pushedHead(deferredFacts()), proof = ciProof('BROAD_DEFERRED'); proof.source.head = proof.source.parents[1] = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
  const states = await requiredCheckAt([await aggregateCheckRun(2, plannedAs('BROAD_DEFERRED'), facts, proof)]);
  assert.deepEqual(gateRefusals(states), [{ check: 'check (26)', reason: 'absent' }]);
});

test('Table A A6: a push with ci:full already on the pull request is deferred and runs no full tier', async () => {
  const { facts, proof } = ciFullFixture(); pushedHead(facts); proof.source.head = proof.source.parents[1] = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
  proof.mode = 'BROAD_DEFERRED';
  for (const worker of ['full_ordinary', 'full_host']) assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker })).ok, false, worker);
});

test('Table A A7: ci:full added by any account but the owner\'s is deferred', async () => {
  const { facts } = ciFullFixture(); facts.sender = 'rigger-bot';
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
});

test('Table A A8: a draft code pull request is deferred with or without the owner\'s ci:full', async () => {
  for (const labeled of [true, false]) {
    const facts = labeled ? ciFullFixture().facts : deferredFacts();
    facts.pr.draft = facts.live.draft = true;
    assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED', String(labeled));
  }
});

test('Table A A9: a green check (26) stays green through a deferred run at its head', async () => {
  const prior = await fullRunAt(1);
  for (const [name, change] of [['unlabeled', (facts) => { Object.assign(facts, { action: 'unlabeled', sender: 'williacj', label: 'ci:full' }); }], ['edited', (facts) => { facts.action = 'edited'; }]]) {
    const facts = deferredFacts(change), proof = ciProof('BROAD_DEFERRED');
    const later = await aggregateCheckRun(2, plannedAs('BROAD_DEFERRED'), facts, proof);
    assert.equal(later.name, 'broad deferred (26)', name);
    assert.equal((await requiredCheckAt([prior, later]))['check (26)'].state, 'passed', name);
  }
});

test('Table A A10: a failed check (26) stays failed through a deferred run at its head, so the merge stays blocked', async () => {
  const { facts: labeled, proof: failing } = ciFullFixture(); failing.results.full_host = 'failure';
  const prior = await aggregateCheckRun(1, plannedAs('BROAD_EXECUTED'), labeled, failing);
  assert.deepEqual([prior.name, prior.conclusion], ['check (26)', 'failure']);
  const later = await aggregateCheckRun(2, plannedAs('BROAD_DEFERRED'), deferredFacts(), ciProof('BROAD_DEFERRED'));
  assert.deepEqual(gateRefusals(await requiredCheckAt([prior, later])), [{ check: 'check (26)', reason: 'failed' }]);
});

test('Table A A13: a mode, source or head differing between plan and the aggregate fails under the name plan selected', async () => {
  const facts = deferredFacts();
  const planMode = ciProof('BROAD_EXECUTED');
  assert.equal(await evaluateCiPolicy('guard', facts, planMode), false, 'mode');
  assert.equal((await aggregateCheckRun(1, plannedAs('BROAD_EXECUTED'), facts, planMode)).name, 'check (26)');
  const journal = ciFacts();
  assert.equal(await evaluateCiPolicy('guard', journal, ciProof('BROAD_DEFERRED')), false, 'mode the other way');
  assert.equal((await aggregateCheckRun(2, plannedAs('BROAD_DEFERRED'), journal, ciProof('BROAD_DEFERRED'))).name, 'broad deferred (26)');
  const stale = ciProof('BROAD_DEFERRED'); stale.source.tree = 'e'.repeat(40);
  assert.equal(await evaluateCiPolicy('guard', facts, stale), false, 'source');
  const moved = deferredFacts(); moved.live.head = 'e'.repeat(40);
  assert.equal(await evaluateCiPolicy('guard', moved, ciProof('BROAD_DEFERRED')), false, 'head');
});

test('Table A A14: a main-targeting run whose plan did not succeed fails as check (26)', async () => {
  const facts = deferredFacts();
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const proof = ciProof('BROAD_DEFERRED'); proof.results.plan = result;
    const run = await aggregateCheckRun(1, { plan: { result, outputs: { mode: 'BROAD_DEFERRED' } } }, facts, proof);
    assert.deepEqual([run.name, run.conclusion], ['check (26)', 'failure'], result);
  }
});

const RESULTS = ['success', 'failure', 'cancelled', 'skipped', '', undefined];
const JOBS = ['plan', 'fast', 'full_ordinary', 'full_host', 'demo', 'cancel_superseded'];

/** Every assignment of `RESULTS` to `JOBS`. */
function* resultCombinations(held = {}, at = 0) {
  if (at === JOBS.length) { yield { ...held }; return; }
  for (const result of RESULTS) yield* resultCombinations({ ...held, [JOBS[at]]: result }, at + 1);
}

/** A route's facts with no pull request, as the non-PR route test states them. */
function mainFacts(event) {
  const facts = ciFacts(); delete facts.pr; delete facts.live;
  Object.assign(facts, { event, ref: 'refs/heads/main', after: 'a'.repeat(40) }); facts.main.head = 'a'.repeat(40);
  return facts;
}

test('Table A A15: every other mode answers every result combination as at the merge base', async () => {
  const success = 'success', skipped = 'skipped';
  const closed = ciFacts(); closed.pr.state = closed.live.state = 'closed';
  // The combinations each mode's guard admitted at the merge base, written out from that source.
  for (const [mode, facts, passing] of [
    ['FAST_ELIGIBLE', ciFacts(), { plan: success, fast: success, full_ordinary: skipped, full_host: skipped, demo: skipped, cancel_superseded: success }],
    ['MAIN_SMOKE', mainFacts('push'), { plan: success, fast: success, full_ordinary: skipped, full_host: skipped, demo: skipped }],
    ['BROAD_EXECUTED', ciFullFixture().facts, { plan: success, fast: success, full_ordinary: success, full_host: success, demo: skipped, cancel_superseded: success }],
    ['MAIN_FULL', mainFacts('schedule'), null],
    ['INVALID', closed, null],
  ]) {
    const planned = await evaluateCiPolicy('runPolicy', { action: 'plan', facts });
    assert.equal(planned.output.mode, mode);
    const proof = { mode, demoNeeded: mode === 'MAIN_FULL', sourceValid: true, source: planned.output.snapshot === '' ? ciProof().source : JSON.parse(planned.output.snapshot) };
    for (const results of resultCombinations()) {
      const expected = passing !== null && Object.entries(passing).every(([job, result]) => results[job] === result);
      const held = { ...proof, results };
      assert.equal(await evaluateCiPolicy('guard', facts, held), expected, mode + ':' + JSON.stringify(results));
      const answer = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: held });
      assert.deepEqual([answer.ok, answer.reason], [expected, 'current source or required tier result did not verify'], mode + ':' + JSON.stringify(results));
    }
  }
});

test('Table A A15: a journal-only head gets a green check (26) with no ci:full', async () => {
  const facts = ciFacts();
  assert.equal(facts.live.labels.includes('ci:full'), false);
  const run = await aggregateCheckRun(1, plannedAs('FAST_ELIGIBLE'), facts, ciProof());
  assert.deepEqual([run.name, run.conclusion], ['check (26)', 'success']);
});

test('Table A A16: no job named check (26) succeeds in a deferred run, whatever its results', async () => {
  const facts = deferredFacts();
  const names = new Map(RESULTS.map((result) => [result, aggregateDisplayName({ plan: { result, outputs: { mode: 'BROAD_DEFERRED' } } })]));
  for (const results of resultCombinations()) {
    const { ok } = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: { ...ciProof('BROAD_DEFERRED'), results } });
    assert.notDeepEqual([names.get(results.plan), ok], ['check (26)', true], JSON.stringify(results));
  }
});

test('Table A A21: a fork\'s deferred run skips the cancellation job and the aggregate refuses', async () => {
  const github = { event_name: 'pull_request', repository: 'williacj/rigger', event: { pull_request: { head: { repo: { full_name: 'contributor/rigger' } } } } };
  const needs = { plan: { outputs: { snapshot: '{}' } } };
  assert.equal(jobRuns('cancel_superseded', needs, github), false);
  const proof = ciProof('BROAD_DEFERRED'); proof.results.cancel_superseded = 'skipped';
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts: deferredFacts(), proof })).ok, false);
});

test('Table A A23: a rerun of a labeled run with the label still on runs the real tiers', async () => {
  const { facts, proof } = ciFullFixture(); const needs = plannedAs('BROAD_EXECUTED');
  const planned = await evaluateCiPolicy('runPolicy', { action: 'plan', facts });
  assert.equal(planned.output.mode, 'BROAD_EXECUTED');
  for (const worker of ['full_ordinary', 'full_host']) {
    assert.equal(jobRuns(worker, needs, {}), true, worker);
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof, worker })).ok, true, worker);
  }
});

test('Table A A24: a rerun of a labeled run with the label removed plans deferred and leaves a prior check (26) as it was', async () => {
  const prior = await fullRunAt(1);
  const { facts } = ciFullFixture(); facts.live.labels = [];
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
  const later = await aggregateCheckRun(2, plannedAs('BROAD_DEFERRED'), facts, ciProof('BROAD_DEFERRED'));
  assert.equal(later.name, 'broad deferred (26)');
  assert.equal((await requiredCheckAt([prior, later]))['check (26)'].state, 'passed');
});

test('Table A A25: a rerun of only the aggregate with the label removed turns check (26) red at that head', async () => {
  const prior = await fullRunAt(1);
  const { facts, proof } = ciFullFixture(); facts.live.labels = [];
  const later = await aggregateCheckRun(2, plannedAs('BROAD_EXECUTED'), facts, proof);
  assert.deepEqual([later.name, later.conclusion], ['check (26)', 'failure']);
  assert.equal((await requiredCheckAt([prior, later]))['check (26)'].state, 'failed');
});

test('Table A A26: a rerun of a deferred run after the label was added stays deferred', async () => {
  const facts = deferredFacts((held) => { held.sender = 'williacj'; held.live.labels = ['ci:full']; });
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
});

test('Table A A27: a rerun at a head that has moved answers INVALID and fails check (26) at the old head', async () => {
  const prior = await fullRunAt(1);
  const { facts, proof } = ciFullFixture(); facts.live.head = 'e'.repeat(40);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'INVALID');
  const later = await aggregateCheckRun(2, plannedAs('INVALID'), facts, { ...proof, mode: 'INVALID' });
  assert.deepEqual([later.name, later.conclusion], ['check (26)', 'failure']);
  assert.equal((await requiredCheckAt([prior, later]))['check (26)'].state, 'failed');
});

test('Table A A28: the label removed while a run is in flight fails its aggregate on the mode', async () => {
  const { facts, proof } = ciFullFixture(); facts.live.labels = [];
  const run = await aggregateCheckRun(1, plannedAs('BROAD_EXECUTED'), facts, proof);
  assert.deepEqual([run.name, run.conclusion], ['check (26)', 'failure']);
  assert.equal((await evaluateCiPolicy('policy', facts)).mode, 'BROAD_DEFERRED');
});

test('Table A A29: check (26) stands at its head after main advances, and the later aggregate still verifies', async () => {
  const { facts, proof } = ciFullFixture(); facts.main.head = facts.live.base = 'e'.repeat(40);
  const answer = await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.deepEqual([answer.ok, answer.mainAdvanced], [true, true]);
  assert.equal((await requiredCheckAt([await fullRunAt(1)]))['check (26)'].state, 'passed');
});
