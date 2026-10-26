// ABOUTME: Ordinary recorded-source CI policy cases, evaluated without child processes or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

