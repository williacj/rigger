// ABOUTME: Reads every workflow file this repository holds and the gate workflow's template: what
// each job is named, what the gate workflow triggers on, the token it holds, the order its posting
// job mints and posts in, and, run with stand-ins for node and curl, what its steps post.

import { test } from 'node:test';
import { ciFacts, ciProof, ciFullFixture, ciCollectorFixture, parseWorkflow } from './ci-policy-fixtures.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE_CONTEXT } from '../src/workflow/gate.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import rigger from '../rigger.config.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryAt, repositoryIn } from './git-repository.mjs';
import { fixture } from './process-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = join(ROOT, '.github', 'workflows', 'rigger-gate.yml');
const TEMPLATE = join(ROOT, 'templates', 'github', 'workflows', 'rigger-gate.yml');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('CI assigns portable, concurrent hosted candidate and protected-main regression lanes with Node 26', () => {
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['cancel_superseded', 'check', 'demo', 'fast', 'full_host', 'full_ordinary', 'nightly', 'plan']);
  for (const name of ['plan', 'fast', 'check']) assert.equal(ci.jobs[name]['runs-on'], 'ubuntu-latest', name);
  for (const name of ['full_ordinary', 'full_host', 'demo']) assert.equal(ci.jobs[name]['runs-on'], 'macos-latest', name);
  assert.deepEqual(ci.jobs.nightly['runs-on'], ['self-hosted', 'macOS', 'ARM64']);
  assert.deepEqual(ci.jobs.check.strategy.matrix.node, ['26']);
  for (const name of ['plan', 'fast', 'full_ordinary', 'full_host', 'check', 'demo', 'nightly']) {
    const setup = ci.jobs[name].steps.find((step) => step.uses === 'actions/setup-node@v5');
    assert.ok(setup, name + ' has no setup-node step');
    assert.equal(setup.with['node-version'], name === 'check' ? '${{ matrix.node }}' : '26');
  }
});

/** Runs the actual protected literal; fixture outcomes below are independent policy expectations. */
function ciPolicy(operation, facts, extra = {}) {
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const source = ci.env.CI_POLICY;
  assert.equal(typeof source, 'string', 'the protected workflow has no inline CI_POLICY');
  const runner = `const input = JSON.parse(process.env.CI_CONTROL);
    const policy = await import('data:text/javascript;base64,' + Buffer.from(process.env.CI_SOURCE).toString('base64'));
    if (input.operation === 'requestJson') {
      const calls = [];
      try {
        const answer = await policy.requestJson('/repos/williacj/rigger', {
          base: 'https://api.github.test', token: 'fixture-token',
          send: async (url, options) => { calls.push({ url, method: options.method, authorization: options.headers.authorization }); if (input.facts.networkError) throw new Error('controlled network failure'); return new Response(input.facts.body, { status: input.facts.status ?? 200, headers: input.facts.headers }); },
        });
        console.log(JSON.stringify({ answer, calls }));
      } catch (error) { console.log(JSON.stringify({ error: String(error.message), calls })); }
    } else if (input.operation === 'collect') {
      const calls = [];
      const answer = await policy.collect({
        event: input.facts.event, context: input.facts.context,
        run: (args) => { const key = JSON.stringify(args); calls.push(args); if (!Object.hasOwn(input.facts.git, key)) throw new Error('unexpected Git command ' + key); return Buffer.from(input.facts.git[key], 'base64'); },
        request: async (path) => { if (!Object.hasOwn(input.facts.api, path)) throw new Error('unavailable API page'); return input.facts.api[path]; },
      });
      console.log(JSON.stringify({ answer, calls }));
    } else console.log(JSON.stringify(await policy[input.operation](input.facts, input.extra)));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    encoding: 'utf8',
    env: { ...process.env, CI_POLICY_ACTION: '', CI_SOURCE: source, CI_CONTROL: JSON.stringify({ operation, facts, extra }) },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}


test('inline CI policy admits only complete regular direct journal changes or nonmain constituents to fast-only readiness', () => {
  assert.equal(ciPolicy('policy', ciFacts()).mode, 'FAST_ELIGIBLE');
  const modified = ciFacts(); Object.assign(modified.changes[0], { status: 'M', oldMode: '100644' });
  assert.equal(ciPolicy('policy', modified).mode, 'FAST_ELIGIBLE');
  for (const change of [
    { status: 'D', oldMode: '100644', newMode: '000000' },
    { status: 'R', oldMode: '100644', newMode: '100644' },
    { status: 'T', oldMode: '100644', newMode: '120000' },
    { newMode: '120000' }, { newMode: '160000' }, { newMode: '100755' },
    { path: 'docs/journal/nested/a.md' }, { path: 'docs/journal/.hidden.md' },
    { path: 'docs/derived/test-matrix.md' }, { path: 'ARCHITECTURE.md' },
  ]) {
    const facts = ciFacts(); Object.assign(facts.changes[0], change);
    assert.equal(ciPolicy('policy', facts).mode, 'BROAD_DEFERRED', JSON.stringify(change));
  }
  const mixed = ciFacts(); mixed.changes.push({ status: 'M', oldMode: '100644', newMode: '100644', path: 'src/workflow/gate.mjs' });
  assert.equal(ciPolicy('policy', mixed).mode, 'BROAD_DEFERRED');
  const nonmain = structuredClone(mixed); nonmain.pr.baseRef = nonmain.live.baseRef = 'batch';
  assert.equal(ciPolicy('policy', nonmain).mode, 'FAST_ELIGIBLE');
  nonmain.action = 'edited'; nonmain.pr.baseRef = nonmain.live.baseRef = 'main';
  assert.equal(ciPolicy('policy', nonmain).mode, 'BROAD_DEFERRED');
  for (const main of [undefined, { head: '' }, { head: 'e'.repeat(40), defaultBranch: 'other' }]) {
    const unavailable = ciFacts(); unavailable.main = main;
    assert.equal(ciPolicy('policy', unavailable).mode, 'INVALID', 'unavailable actual main');
  }
  const advanced = ciFacts(); advanced.live.base = 'e'.repeat(40);
  assert.equal(ciPolicy('policy', advanced).mode, 'FAST_ELIGIBLE', 'a fresh PR base does not replace the recorded base');
  for (const corrupt of ['complete', 'head', 'base', 'tree', 'parents', 'path-list']) {
    const facts = ciFacts();
    if (corrupt === 'complete') facts.complete = false;
    if (corrupt === 'head') facts.live.head = 'e'.repeat(40);
    if (corrupt === 'base') facts.pr.base = 'e'.repeat(40);
    if (corrupt === 'tree') facts.checkout.tree = '';
    if (corrupt === 'parents') facts.checkout.parents.reverse();
    if (corrupt === 'path-list') delete facts.changes;
    assert.equal(ciPolicy('policy', facts).mode, 'INVALID', corrupt);
  }
});

test('inline CI policy schedules broad proof only on the fresh owner full-label event and treats demo as a separate request', () => {
  const full = ciFacts();
  Object.assign(full, { action: 'labeled', sender: 'williacj', label: 'ci:full' });
  full.live.labels = ['ci:full'];
  full.changes[0].path = 'src/workflow/action.mjs';
  assert.equal(ciPolicy('policy', full).mode, 'BROAD_EXECUTED');
  assert.equal(ciPolicy('policy', full).demoNeeded, true);
  for (const change of [
    { action: 'synchronize' }, { action: 'ready_for_review' }, { sender: 'contributor' }, { label: 'unrelated' },
  ]) {
    const facts = structuredClone(full); Object.assign(facts, change);
    assert.equal(ciPolicy('policy', facts).mode, 'BROAD_DEFERRED', JSON.stringify(change));
  }
  const draft = structuredClone(full); draft.pr.draft = draft.live.draft = true;
  assert.equal(ciPolicy('policy', draft).mode, 'BROAD_DEFERRED');
  const removed = structuredClone(full); removed.live.labels = [];
  assert.equal(ciPolicy('policy', removed).mode, 'BROAD_DEFERRED');
  const journal = structuredClone(full); journal.changes[0].path = 'docs/journal/a.md';
  assert.equal(ciPolicy('policy', journal).mode, 'BROAD_EXECUTED', 'an owner full request precedes journal eligibility');
  const nonmain = structuredClone(full); nonmain.pr.baseRef = nonmain.live.baseRef = 'batch';
  assert.equal(ciPolicy('policy', nonmain).mode, 'FAST_ELIGIBLE');
  const irrelevant = structuredClone(full); irrelevant.changes[0].path = 'test/package-budget.test.mjs';
  assert.equal(ciPolicy('policy', irrelevant).demoNeeded, false);
  const demo = ciFacts(); Object.assign(demo, { action: 'labeled', sender: 'williacj', label: 'ci:demo' }); demo.live.labels = ['ci:demo'];
  assert.equal(ciPolicy('policy', demo).mode, 'FAST_ELIGIBLE');
  assert.equal(ciPolicy('policy', demo).demoNeeded, true);
  demo.changes[0].path = 'src/other.mjs';
  assert.equal(ciPolicy('policy', demo).mode, 'BROAD_DEFERRED');
  assert.equal(ciPolicy('policy', demo).demoNeeded, true);
  demo.sender = 'contributor';
  assert.equal(ciPolicy('policy', demo).demoNeeded, false);
});

test('inline CI policy keeps smoke and protected-main regression distinct and handles real merge groups as broad', () => {
  const main = ciFacts(); delete main.pr; delete main.live;
  Object.assign(main, { event: 'push', ref: 'refs/heads/main', after: 'a'.repeat(40), main: { head: 'a'.repeat(40), defaultBranch: 'main' } });
  assert.deepEqual(ciPolicy('policy', main), { mode: 'MAIN_SMOKE', demoNeeded: false, sourceValid: true });
  for (const event of ['schedule', 'workflow_dispatch']) {
    const nightly = structuredClone(main); nightly.event = event;
    assert.deepEqual(ciPolicy('policy', nightly), { mode: 'MAIN_FULL', demoNeeded: true, sourceValid: true });
    for (const change of [{ ref: 'refs/heads/feature' }, { ref: 'refs/pull/7/merge' }, { main: { head: 'e'.repeat(40), defaultBranch: 'main' } }, { main: { head: 'a'.repeat(40), defaultBranch: 'other' } }, { inputs: { ref: 'untrusted' } }]) {
      assert.equal(ciPolicy('policy', { ...nightly, ...change }).mode, 'INVALID', event + JSON.stringify(change));
    }
  }
  const group = structuredClone(main);
  Object.assign(group, { event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/batch', main: { head: 'c'.repeat(40), defaultBranch: 'main' }, group: { head: 'a'.repeat(40), base: 'c'.repeat(40), baseRef: 'refs/heads/main', baseAncestor: true } });
  assert.deepEqual(ciPolicy('policy', group), { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true });
  group.group.baseAncestor = false;
  assert.equal(ciPolicy('policy', group).mode, 'INVALID');
  assert.equal(ciPolicy('policy', { ...main, event: 'pull_request_target' }).mode, 'INVALID');
});

test('inline CI policy requires demo for unknown full-batch impact while retaining exact known exemptions', () => {
  for (const [paths, expectedDemo] of [
    [['unclassified-tool.py'], true],
    [['docs/journal/a.md'], false],
    [['test/package-budget.test.mjs'], false],
    [['docs/journal/a.md', 'unclassified-tool.py'], true],
    [['test/package-budget.test.mjs', 'unclassified-tool.py'], true],
    [['docs/journal/a.md', 'test/package-budget.test.mjs'], true],
    [['src/workflow/action.mjs'], true],
  ]) for (const status of ['A', 'M']) {
    const facts = ciFacts();
    Object.assign(facts, { action: 'labeled', sender: 'williacj', label: 'ci:full' });
    facts.live.labels = ['ci:full'];
    facts.changes = paths.map((path) => ({ path, status, oldMode: status === 'A' ? '000000' : '100644', newMode: '100644' }));
    assert.deepEqual(ciPolicy('policy', facts), { mode: 'BROAD_EXECUTED', demoNeeded: expectedDemo, sourceValid: true }, status + ':' + paths.join(','));
    const proof = ciProof('BROAD_EXECUTED');
    proof.demoNeeded = expectedDemo;
    proof.results.full_ordinary = proof.results.full_host = 'success';
    proof.results.demo = expectedDemo ? 'success' : 'skipped';
    assert.equal(ciPolicy('guard', facts, proof), true, 'required demo result:' + paths.join(','));
    if (expectedDemo) for (const result of ['failure', 'cancelled', 'skipped', '', undefined]) {
      const rejected = structuredClone(proof);
      rejected.results.demo = result;
      assert.equal(ciPolicy('guard', facts, rejected), false, 'missing demo credit:' + paths.join(',') + ':' + result);
    }
  }
});


test('inline aggregate requires fresh equal source mode and every literally required result, including explicit demo', () => {
  const safe = ciFacts();
  assert.equal(ciPolicy('guard', safe, ciProof()), true);
  for (const mode of ['BROAD_DEFERRED', 'INVALID', 'MAIN_FULL', '', undefined]) {
    const proof = ciProof(mode); if (mode === undefined) delete proof.mode;
    assert.equal(ciPolicy('guard', safe, proof), false, String(mode));
  }
  for (const key of ['sha', 'tree', 'head', 'base', 'baseRef']) {
    const proof = ciProof(); proof.source[key] = 'changed';
    assert.equal(ciPolicy('guard', safe, proof), false, key);
  }
  const invalidSource = ciProof(); invalidSource.sourceValid = false;
  assert.equal(ciPolicy('guard', safe, invalidSource), false);
  for (const name of ['plan', 'fast']) for (const result of ['failure', 'cancelled', 'skipped', '', undefined]) {
    const proof = ciProof(); proof.results[name] = result;
    assert.equal(ciPolicy('guard', safe, proof), false, name + ':' + result);
  }
  for (const name of ['full_ordinary', 'full_host', 'demo']) for (const result of ['success', 'failure', 'cancelled', '', undefined]) {
    const proof = ciProof(); proof.results[name] = result;
    assert.equal(ciPolicy('guard', safe, proof), false, name + ':' + result);
  }
  const full = ciFacts(); Object.assign(full, { action: 'labeled', sender: 'williacj', label: 'ci:full' }); full.live.labels = ['ci:full']; full.changes[0].path = 'test/package-budget.test.mjs';
  const broad = ciProof('BROAD_EXECUTED'); broad.results.full_ordinary = broad.results.full_host = 'success';
  assert.equal(ciPolicy('guard', full, broad), true);
  for (const name of ['plan', 'fast', 'full_ordinary', 'full_host']) for (const result of ['failure', 'cancelled', 'skipped', '', undefined]) {
    const proof = structuredClone(broad); proof.results[name] = result;
    assert.equal(ciPolicy('guard', full, proof), false, name + ':' + result);
  }
  full.changes[0].path = 'src/workflow/action.mjs'; broad.demoNeeded = true; broad.results.demo = 'success';
  assert.equal(ciPolicy('guard', full, broad), true);
  for (const result of ['failure', 'cancelled', 'skipped', '', undefined]) {
    const proof = structuredClone(broad); proof.results.demo = result;
    assert.equal(ciPolicy('guard', full, proof), false, 'required demo:' + result);
  }
  full.live.labels = [];
  assert.equal(ciPolicy('guard', full, broad), false, 'removed full label');
  const demo = ciFacts(); Object.assign(demo, { action: 'labeled', sender: 'williacj', label: 'ci:demo' }); demo.live.labels = ['ci:demo'];
  const demoProof = ciProof(); demoProof.demoNeeded = true; demoProof.results.demo = 'success';
  assert.equal(ciPolicy('guard', demo, demoProof), true);
  demoProof.results.demo = 'skipped';
  assert.equal(ciPolicy('guard', demo, demoProof), false);
  const deferred = ciFacts(); deferred.changes[0].path = 'src/other.mjs';
  assert.equal(ciPolicy('guard', deferred, ciProof('BROAD_DEFERRED')), false);
});


test('candidate aggregate condition cannot be skipped by a forged MAIN_FULL plan mode', () => {
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const condition = ci.jobs.check.if.slice(3, -2).trim();
  const actual = new Function('github', 'needs', 'always', 'return (' + condition + ')');
  const needs = { plan: { result: 'success', outputs: { mode: 'MAIN_FULL' } } };
  for (const event_name of ['pull_request', 'push', 'merge_group']) {
    assert.equal(actual({ event_name, ref: 'refs/heads/main' }, needs, () => true), true, event_name);
  }
  for (const event_name of ['schedule', 'workflow_dispatch']) {
    assert.equal(actual({ event_name, ref: 'refs/heads/main' }, needs, () => true), false, event_name);
    assert.equal(actual({ event_name, ref: 'refs/heads/feature' }, needs, () => true), true, event_name);
    assert.equal(actual({ event_name, ref: 'refs/heads/main' }, { plan: { result: 'failure', outputs: {} } }, () => true), true);
  }
});

test('inline CI policy reads actual raw Git mode and status bytes completely and refuses malformed or non-UTF8 facts', () => {
  // Header-NUL-path-NUL is observed in git-raw-observed-original.bin at the recorded a23/T refs.
  const raw = ':000000 100644 0000000 1234567 A\0docs/journal/a.md\0';
  const facts = ciFacts(); delete facts.changes; facts.rawBase64 = Buffer.from(raw).toString('base64');
  assert.equal(ciPolicy('policy', facts).mode, 'FAST_ELIGIBLE');
  for (const bytes of [
    Buffer.from(raw.slice(0, -1)), Buffer.from(':000000 100644 0000000 1234567 A\0\0'),
    Buffer.from(':000000 100644 0000000 1234567 Q\0docs/journal/a.md\0'),
    Buffer.concat([Buffer.from(':000000 100644 0000000 1234567 A\0docs/journal/'), Buffer.from([255]), Buffer.from('.md\0')]),
    Buffer.from(raw + ':broken\0extra\0'),
  ]) {
    assert.equal(ciPolicy('policy', { ...facts, rawBase64: bytes.toString('base64') }).mode, 'INVALID');
  }
  for (const row of [
    ':100644 000000 1234567 0000000 D\0docs/journal/a.md\0',
    ':100644 120000 1234567 2345678 T\0docs/journal/a.md\0',
    ':000000 160000 0000000 2345678 A\0docs/journal/a.md\0',
  ]) {
    assert.equal(ciPolicy('policy', { ...facts, rawBase64: Buffer.from(row).toString('base64') }).mode, 'BROAD_DEFERRED');
  }
});


test('actual inline collector binds Git checkout parents and raw diff to fresh repository PR and base facts', () => {
  const fixture = ciCollectorFixture();
  const { answer, calls } = ciPolicy('collect', fixture);
  assert.equal(answer.complete, true);
  assert.deepEqual(answer.checkout, ciFacts().checkout);
  assert.deepEqual(answer.pr, ciFacts().pr);
  assert.deepEqual(answer.live, ciFacts().live);
  assert.deepEqual(answer.changes, ciFacts().changes);
  assert.ok(calls.some((args) => JSON.stringify(args) === JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'c'.repeat(40), 'a'.repeat(40)])));
  assert.equal(ciPolicy('policy', answer).mode, 'FAST_ELIGIBLE');
  const drifted = ciCollectorFixture();
  drifted.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = 'e'.repeat(40);
  const drift = ciPolicy('collect', drifted).answer;
  assert.equal(drift.complete, true, 'live main alone does not invalidate the recorded checkout');
  assert.deepEqual(drift.pr, ciFacts().pr);
  assert.equal(drift.main.head, 'e'.repeat(40));
  assert.equal(drift.live.base, 'c'.repeat(40), 'the current PR base is independent of live main');
  const batch = ciCollectorFixture();
  batch.event.pull_request.base.ref = batch.api['/repos/williacj/rigger/pulls/7'].base.ref = 'batch';
  batch.api['/repos/williacj/rigger/git/ref/heads/batch'] = { object: { sha: 'c'.repeat(40) } };
  batch.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = 'e'.repeat(40);
  const nonmain = ciPolicy('collect', batch).answer;
  assert.equal(nonmain.complete, true);
  assert.equal(nonmain.main.head, 'e'.repeat(40), 'current main is not the batch branch head');
  assert.equal(ciPolicy('policy', nonmain).mode, 'FAST_ELIGIBLE');
  for (const corrupt of ['unavailable-api', 'wrong-recorded-base', 'wrong-checkout', 'wrong-owner', 'wrong-repository']) {
    const bad = ciCollectorFixture();
    if (corrupt === 'unavailable-api') delete bad.api['/repos/williacj/rigger/pulls/7'];
    if (corrupt === 'wrong-recorded-base') {
      bad.event.pull_request.base.sha = 'e'.repeat(40);
      bad.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'e'.repeat(40), 'a'.repeat(40)])] = bad.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'c'.repeat(40), 'a'.repeat(40)])];
    }
    if (corrupt === 'wrong-checkout') bad.git[JSON.stringify(['rev-parse', 'HEAD'])] = Buffer.from('e'.repeat(40) + '\n').toString('base64');
    if (corrupt === 'wrong-owner') bad.context.owner = 'fork-owner';
    if (corrupt === 'wrong-repository') bad.event.repository.full_name = 'fork-owner/rigger';
    const current = ciPolicy('collect', bad).answer;
    assert.equal(ciPolicy('policy', current).mode, 'INVALID', corrupt);
  }
});

test('actual inline collector accepts only current protected-main regression source and verified merge-group ancestry', () => {
  for (const eventName of ['schedule', 'workflow_dispatch', 'push']) {
    const fixture = ciCollectorFixture();
    Object.assign(fixture.context, { eventName, ref: 'refs/heads/main' });
    fixture.event = { repository: { full_name: 'williacj/rigger' }, sender: { login: 'williacj' }, before: 'c'.repeat(40), after: 'a'.repeat(40) };
    fixture.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = 'a'.repeat(40);
    const result = ciPolicy('collect', fixture).answer;
    assert.equal(ciPolicy('policy', result).mode, eventName === 'push' ? 'MAIN_SMOKE' : 'MAIN_FULL', eventName);
    const wrongRef = structuredClone(fixture); wrongRef.context.ref = 'refs/heads/feature';
    assert.equal(ciPolicy('policy', ciPolicy('collect', wrongRef).answer).mode, 'INVALID');
    const fork = structuredClone(fixture); fork.context.owner = 'fork-owner';
    assert.equal(ciPolicy('policy', ciPolicy('collect', fork).answer).mode, 'INVALID');
  }
  const group = ciCollectorFixture(); group.context.eventName = 'merge_group'; group.context.ref = 'refs/heads/gh-readonly-queue/main/batch';
  group.event = { repository: { full_name: 'williacj/rigger' }, merge_group: { head_sha: 'a'.repeat(40), base_sha: 'c'.repeat(40), base_ref: 'refs/heads/main' } };
  const ancestry = JSON.stringify(['merge-base', '--is-ancestor', 'c'.repeat(40), 'a'.repeat(40)]);
  group.git[ancestry] = '';
  assert.equal(ciPolicy('policy', ciPolicy('collect', group).answer).mode, 'BROAD_EXECUTED');
  delete group.git[ancestry];
  assert.equal(ciPolicy('policy', ciPolicy('collect', group).answer).mode, 'INVALID');
});

test('actual inline API reader accepts complete read-only JSON and rejects pagination truncation status and transport errors', () => {
  const answer = ciPolicy('requestJson', { body: '{"full_name":"williacj/rigger"}' });
  assert.equal(answer.error, undefined);
  assert.deepEqual(answer.answer, { full_name: 'williacj/rigger' });
  assert.deepEqual(answer.calls, [{ url: 'https://api.github.test/repos/williacj/rigger', method: 'GET', authorization: 'Bearer fixture-token' }]);
  for (const bad of [
    { status: 403, body: '{}' }, { body: '{' },
    { body: '{}', headers: { link: '<https://api.github.test/next>; rel="next"' } },
    { body: '{}', headers: { 'content-length': '200' } }, { body: '{}', networkError: true },
  ]) assert.equal(typeof ciPolicy('requestJson', bad).error, 'string', JSON.stringify(bad));
});

test('actual inline runtime routes plan worker and aggregate through the same source and result decisions', () => {
  const facts = ciFacts(), proof = ciProof();
  const planned = ciPolicy('runPolicy', { action: 'plan', facts });
  assert.equal(planned.ok, true);
  assert.equal(planned.output.mode, 'FAST_ELIGIBLE');
  assert.equal(planned.output.sha, 'a'.repeat(40));
  assert.equal(planned.output.tree, 'b'.repeat(40));
  assert.deepEqual(JSON.parse(planned.output.snapshot), proof.source);
  const worker = ciPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'fast' });
  assert.equal(worker.ok, true);
  assert.equal(worker.source.sha, 'a'.repeat(40));
  assert.equal(ciPolicy('runPolicy', { action: 'aggregate', facts, proof }).ok, true);
  const visible = ciPolicy('runPolicy', { action: 'aggregate', facts, proof });
  assert.equal(visible.testedBase, 'c'.repeat(40));
  assert.equal(visible.currentMain, 'c'.repeat(40));
  assert.equal(visible.mainAdvanced, false);
  assert.deepEqual(visible.source, proof.source);

  const forged = ciProof('MAIN_FULL');
  assert.equal(ciPolicy('runPolicy', { action: 'worker', facts, proof: forged, worker: 'nightly' }).ok, false);
  assert.equal(ciPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'full_host' }).ok, false);
  assert.equal(ciPolicy('runPolicy', { action: 'worker', facts, proof, worker: 'demo' }).ok, false);
  const stale = ciProof(); stale.source.tree = 'e'.repeat(40);
  assert.equal(ciPolicy('runPolicy', { action: 'worker', facts, proof: stale, worker: 'fast' }).ok, false);
  assert.equal(ciPolicy('runPolicy', { action: 'aggregate', facts, proof: stale }).ok, false);
  const deferred = ciFacts(); deferred.changes[0].path = 'src/other.mjs';
  const result = ciPolicy('runPolicy', { action: 'aggregate', facts: deferred, proof: ciProof('BROAD_DEFERRED') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing-current-batch-proof/);
  assert.equal(ciPolicy('runPolicy', { action: 'unknown', facts, proof }).ok, false);
});

test('actual CI aggregate JSON exposes recorded base and current main without changing its source', (t) => {
  const directory = temporaryDirectory('ci-runtime-', { context: t }), bin = join(directory, 'bin'); mkdirSync(bin);
  const eventPath = join(directory, 'event.json'), gitRecord = join(directory, 'git-calls'), apiRecord = join(directory, 'api-calls');
  const git = join(bin, 'git');
  // The Git answers are the literal collaborator contract in ciCollectorFixture, never a real forge.
  writeFileSync(git, '#!' + process.execPath + '\n' + `
    const fs = require('node:fs');
    const args = process.argv.slice(2), key = JSON.stringify(args);
    const answers = JSON.parse(process.env.CI_RUNTIME_FIXTURE).git;
    fs.appendFileSync(process.env.CI_GIT_RECORD, key + '\\n');
    if (!Object.hasOwn(answers, key)) throw new Error('unrecorded Git command ' + key);
    process.stdout.write(Buffer.from(answers[key], 'base64'));
  `);
  chmodSync(git, 0o755);
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const { facts, proof } = ciFullFixture();
  for (const main of ['c', 'e']) {
    const fixture = ciCollectorFixture();
    Object.assign(fixture.event, { action: 'labeled', sender: { login: 'williacj' }, label: { name: 'ci:full' } });
    fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [{ name: 'ci:full' }];
    fixture.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = main.repeat(40);
    fixture.api['/repos/williacj/rigger/pulls/7'].base.sha = main.repeat(40);
    writeFileSync(eventPath, JSON.stringify(fixture.event));
    writeFileSync(gitRecord, ''); writeFileSync(apiRecord, '');
    const prefix = `globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname + new URL(url).search;
      const fixture = JSON.parse(process.env.CI_RUNTIME_FIXTURE);
      const fs = await import('node:fs');
      fs.appendFileSync(process.env.CI_API_RECORD, JSON.stringify({ path, method: options.method }) + '\\n');
      if (!Object.hasOwn(fixture.api, path)) throw new Error('unrecorded API request ' + path);
      return new Response(JSON.stringify(fixture.api[path]), { status: 200 });
    };`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', prefix + ci.env.CI_POLICY], {
      encoding: 'utf8', cwd: directory,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GH_TOKEN: 'fixture-token', GITHUB_API_URL: 'https://api.github.test',
        GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/7/merge', GITHUB_SHA: facts.eventSha,
        GITHUB_REPOSITORY: 'williacj/rigger', GITHUB_REPOSITORY_OWNER: 'williacj', CI_POLICY_ACTION: 'aggregate',
        CI_EXPECTED_SOURCE: JSON.stringify(proof.source), CI_EXPECTED_MODE: proof.mode, CI_EXPECTED_DEMO: 'false',
        CI_RESULTS: JSON.stringify(Object.fromEntries(Object.entries(proof.results).map(([name, result]) => [name, { result }]))),
        CI_RUNTIME_FIXTURE: JSON.stringify(fixture), CI_GIT_RECORD: gitRecord, CI_API_RECORD: apiRecord },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.testedBase, 'c'.repeat(40));
    assert.equal(output.eventBase, 'c'.repeat(40));
    assert.equal(output.currentMain, main.repeat(40));
    assert.equal(output.mainAdvanced, main === 'e');
    assert.deepEqual(output.source, proof.source);
    assert.equal(output.mode, 'BROAD_EXECUTED');
    assert.equal(readFileSync(gitRecord, 'utf8').trim().split('\n').length, 4);
    assert.equal(readFileSync(apiRecord, 'utf8').trim().split('\n').length, 4);
  }
});

test('inline CI policy refuses unknown event authority and malformed Git records before any fast eligibility', () => {
  for (const corrupt of ['action', 'owner', 'sender', 'status', 'path', 'mode']) {
    const facts = ciFacts();
    if (corrupt === 'action') facts.action = 'unknown';
    if (corrupt === 'owner') facts.owner = 'fork-owner';
    if (corrupt === 'sender') delete facts.sender;
    if (corrupt === 'status') facts.changes[0].status = 'Q';
    if (corrupt === 'path') facts.changes[0].path = '';
    if (corrupt === 'mode') facts.changes[0].newMode = 'unknown';
    assert.equal(ciPolicy('policy', facts).mode, 'INVALID', corrupt);
  }
});

test('staged CI preserves finite events, independent full lanes, every command and protected-main personal checkout', () => {
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  assert.deepEqual(ci.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review', 'labeled', 'unlabeled']);
  assert.deepEqual(ci.on.push.branches, ['main']);
  assert.ok(Object.hasOwn(ci.on, 'merge_group'));
  assert.deepEqual(ci.on.schedule, [{ cron: '0 3 * * *' }]);
  assert.equal(ci.on.workflow_dispatch, null, 'dispatch must expose no arbitrary ref/input selector');
  assert.deepEqual(ci.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(ci.jobs.check.needs, ['plan', 'fast', 'full_ordinary', 'full_host', 'demo', 'cancel_superseded']);
  for (const name of ['full_ordinary', 'full_host']) assert.deepEqual(ci.jobs[name].needs, ['plan']);
  const commands = (name) => ci.jobs[name].steps.map((step) => step.run).filter(Boolean);
  const stats = ['budget:package', 'budget:instructions', 'lint:spec-style', 'check:references', 'check:paths', 'check:ids', 'check:words', 'check:headers', 'matrix:check'].map((name) => 'npm run ' + name);
  for (const command of ['npm ci', 'npm test', ...stats]) {
    assert.ok(commands('fast').includes(command), 'fast omits ' + command);
    assert.ok(commands('nightly').includes(command), 'nightly omits ' + command);
  }
  assert.ok(commands('full_ordinary').includes('npm ci'));
  assert.ok(commands('full_ordinary').includes('npm test'));
  assert.ok(commands('full_host').includes('npm ci'));
  assert.ok(commands('full_host').includes('npm run test:host'), 'full host command missing');
  assert.equal(commands('full_ordinary').includes('npm run test:host'), false);
  assert.equal(commands('fast').includes('npm run test:host'), false);
  assert.ok(commands('nightly').includes('npm run test:host'));
  for (const name of ['full_host', 'nightly']) {
    assert.ok(commands(name).includes('node test/verify-mac-containment "$RUNNER_TEMP/containment-proof-26"'));
    const upload = ci.jobs[name].steps.find((step) => step.uses === 'actions/upload-artifact@v7');
    assert.equal(upload.if, 'always()');
    assert.equal(upload.with.name, 'containment-proof-26');
    assert.equal(upload.with.path, '${{ runner.temp }}/containment-proof-26');
    assert.equal(upload.with['if-no-files-found'], 'ignore');
  }
  for (const name of ['plan', 'fast', 'full_ordinary', 'full_host', 'check', 'demo', 'nightly']) {
    const checkout = ci.jobs[name].steps.find((step) => step.uses === 'actions/checkout@v5');
    assert.equal(checkout.with['fetch-depth'], '0', name);
    if (name !== 'plan') assert.equal(checkout.with.ref, name === 'nightly' ? '${{ github.sha }}' : '${{ needs.plan.outputs.sha }}', name);
    const policy = ci.jobs[name].steps.find((step) => step.env?.CI_POLICY_ACTION);
    assert.equal(policy.run, 'node --input-type=module -e "$CI_POLICY"', name);
    assert.equal(policy.env.CI_POLICY_ACTION, name === 'plan' ? 'plan' : name === 'check' ? 'aggregate' : 'worker');
  }
  const condition = new Function('github', 'needs', 'return (' + ci.jobs.nightly.if.slice(3, -2).trim() + ')');
  const needs = { plan: { result: 'success', outputs: { mode: 'MAIN_FULL' } } };
  for (const event_name of ['pull_request', 'merge_group', 'push']) assert.equal(condition({ event_name, ref: 'refs/heads/main' }, needs), false);
  assert.equal(condition({ event_name: 'schedule', ref: 'refs/heads/main' }, needs), true);
  assert.equal(condition({ event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, needs), false);
});

test('actual inline collector uses the complete current issue-label read rather than an embedded PR label snapshot', () => {
  // https://docs.github.com/en/rest/issues/labels#list-labels-for-an-issue owns the paginated label-array shape.
  const fixture = ciCollectorFixture();
  fixture.event.action = 'labeled'; fixture.event.sender.login = 'williacj'; fixture.event.label = { name: 'ci:full' };
  fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [{ name: 'ci:full' }];
  const current = ciPolicy('collect', fixture).answer;
  assert.deepEqual(current.live.labels, ['ci:full']);
  assert.equal(ciPolicy('policy', current).mode, 'BROAD_EXECUTED');
  fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [];
  fixture.api['/repos/williacj/rigger/pulls/7'].labels = [{ name: 'ci:full' }];
  assert.deepEqual(ciPolicy('collect', fixture).answer.live.labels, []);
  delete fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'];
  assert.equal(ciPolicy('policy', ciPolicy('collect', fixture).answer).mode, 'INVALID');
});

test('actual inline CLI plans and verifies real Git source through a local read-only API contract and rejects a changed head', { timeout: 15_000 }, async (t) => {
  const directory = repositoryAt(temporaryDirectory('rigger-ci-policy-', { context: t }), { 'docs/journal/base.md': 'base\n' });
  gitIn(directory, 'branch', '-M', 'main');
  const base = gitIn(directory, 'rev-parse', 'HEAD').trim();
  gitIn(directory, 'checkout', '-qb', 'change');
  writeFileSync(join(directory, 'docs/journal/a.md'), 'change\n');
  gitIn(directory, 'add', '-A'); gitIn(directory, 'commit', '-qm', 'change');
  const head = gitIn(directory, 'rev-parse', 'HEAD').trim();
  gitIn(directory, 'checkout', '-qb', 'synthetic', base);
  gitIn(directory, 'merge', '--no-ff', '-qm', 'synthetic', head);
  const sha = gitIn(directory, 'rev-parse', 'HEAD').trim(), tree = gitIn(directory, 'rev-parse', 'HEAD^{tree}').trim();
  const fixture = ciCollectorFixture();
  Object.assign(fixture.event.pull_request.head, { sha: head }); Object.assign(fixture.event.pull_request.base, { sha: base });
  Object.assign(fixture.api['/repos/williacj/rigger/pulls/7'].head, { sha: head });
  Object.assign(fixture.api['/repos/williacj/rigger/pulls/7'].base, { sha: base });
  fixture.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = base;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.writeHead(Object.hasOwn(fixture.api, request.url) ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(fixture.api[request.url] ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const eventPath = join(directory, 'event.json'), outputPath = join(directory, 'outputs');
  writeFileSync(eventPath, JSON.stringify(fixture.event)); writeFileSync(outputPath, '');
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const { NODE_TEST_CONTEXT, ...env } = gitEnvironment();
  const execute = (action, extra = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', ci.env.CI_POLICY], {
      cwd: directory, signal: t.signal,
      env: { ...env, GH_TOKEN: 'fixture-token', GITHUB_API_URL: 'http://127.0.0.1:' + server.address().port, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/7/merge', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'williacj/rigger', GITHUB_REPOSITORY_OWNER: 'williacj', GITHUB_OUTPUT: outputPath, CI_POLICY_ACTION: action, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(JSON.stringify({ ciPolicyChild: child.pid, action, sha, tree }));
    let out = '', err = '';
    child.stdout.on('data', (bytes) => { out += bytes; }); child.stderr.on('data', (bytes) => { err += bytes; });
    child.on('error', reject); child.on('close', (status, signal) => resolve({ status, signal, out, err }));
  });
  const plan = await execute('plan'); assert.equal(plan.status, 0, plan.out + plan.err);
  const outputs = Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(outputs.mode, 'FAST_ELIGIBLE'); assert.equal(outputs.sha, sha); assert.equal(outputs.tree, tree);
  const proof = { CI_EXPECTED_SOURCE: outputs.snapshot, CI_EXPECTED_MODE: outputs.mode, CI_EXPECTED_DEMO: outputs.demoNeeded };
  const worker = await execute('worker', { ...proof, CI_WORKER: 'fast' }); assert.equal(worker.status, 0, worker.out + worker.err);
  const results = { plan: { result: 'success' }, fast: { result: 'success' }, full_ordinary: { result: 'skipped' }, full_host: { result: 'skipped' }, demo: { result: 'skipped' }, cancel_superseded: { result: 'success' } };
  const aggregate = await execute('aggregate', { ...proof, CI_RESULTS: JSON.stringify(results) });
  assert.equal(aggregate.status, 0, aggregate.out + aggregate.err);
  fixture.api['/repos/williacj/rigger/pulls/7'].head.sha = 'e'.repeat(40);
  const changed = await execute('aggregate', { ...proof, CI_RESULTS: JSON.stringify(results) });
  assert.notEqual(changed.status, 0, changed.out + changed.err);
  assert.match(changed.err, /current source or required tier result did not verify/);
  assert.ok(requests.length > 0); assert.ok(requests.every((request) => request.method === 'GET'));
});


const live = parseWorkflow(readFileSync(LIVE, 'utf8'));
const template = parseWorkflow(readFileSync(TEMPLATE, 'utf8'));

/** Every job of a parsed workflow, with its id. */
const jobsOf = (workflow) => Object.entries(workflow.jobs).map(([id, job]) => ({ id, ...job }));

/** Every step of every job, with its job's id. */
const stepsOf = (workflow) => jobsOf(workflow).flatMap((job) => job.steps.map((step) => ({ job: job.id, ...step })));

/** The posting job: the one that declares the `gate` environment. */
const posting = (workflow) => jobsOf(workflow).find((job) => job.environment === 'gate');

/** The step of `job` named `name`, asserted to be there once. */
function stepNamed(job, name) {
  const found = job.steps.filter((step) => step.name === name);
  assert.equal(found.length, 1, `${job.id} holds ${found.length} steps named ${name}`);
  return found[0];
}

test('the reader parses a workflow it is handed, and refuses a form it does not read rather than misreading it', () => {
  assert.deepEqual(parseWorkflow('a: b\nc:\n  - d: e\n    f: [g, \'h\']\n  - i\nj: |\n  k\n    l\n'), { a: 'b', c: [{ d: 'e', f: ['g', 'h'] }, 'i'], j: 'k\n  l\n' });
  for (const text of ['a: {b: c}\n', 'a: b\n   c: d\n', 'a: [b,\n  c]\n', 'a b\n', 'a: b\na: c\n']) {
    assert.throws(() => parseWorkflow(text), /line \d+/, text);
  }
});

test('no job in any file under .github/workflows/ or templates/github/workflows/ has an id or name equal to rigger/gate or self-hosting', () => {
  const files = ['.github/workflows', 'templates/github/workflows'].flatMap((directory) => readdirSync(join(ROOT, directory)).map((name) => join(ROOT, directory, name)));
  assert.ok(files.length >= 3, files.join(', '));
  for (const file of files) {
    for (const job of jobsOf(parseWorkflow(readFileSync(file, 'utf8')))) {
      for (const named of [job.id, job.name]) assert.ok(!['rigger/gate', 'self-hosting'].includes(named), `${file}: ${named}`);
    }
  }
});

test('the template differs from this repository\'s workflow only in the pinned commit, line by line', () => {
  const ours = readFileSync(LIVE, 'utf8').split('\n');
  const theirs = readFileSync(TEMPLATE, 'utf8').split('\n');
  assert.equal(ours.length, theirs.length);
  const differing = ours.map((line, at) => [line, theirs[at]]).filter(([one, other]) => one !== other);
  assert.equal(differing.length, 1, JSON.stringify(differing));
  assert.equal(differing[0][1], '  RIGGER_COMMIT: PINNED_COMMIT');
  assert.match(differing[0][0], /^ {2}RIGGER_COMMIT: [0-9a-f]{40}$/);
});

test('the posting step names the context GATE_CONTEXT, in the template and in this repository\'s workflow', () => {
  for (const workflow of [template, live]) {
    assert.equal(stepNamed(posting(workflow), 'Post rigger/gate on each head the check read').env.CONTEXT, GATE_CONTEXT);
  }
});

test('the workflow triggers on each event and type the events table names, and on no pull_request event', () => {
  for (const workflow of [template, live]) {
    assert.deepEqual(workflow.on, {
      pull_request_target: { types: ['opened', 'synchronize', 'reopened', 'edited'] },
      issue_comment: { types: ['created', 'edited', 'deleted'] },
      issues: { types: ['edited', 'labeled', 'unlabeled'] },
    });
  }
});

test('the workflow\'s permissions grant its GITHUB_TOKEN read scopes only, at the top level and in every job', () => {
  for (const workflow of [template, live]) {
    for (const [where, permissions] of [['top level', workflow.permissions], ...jobsOf(workflow).map((job) => [job.id, job.permissions])]) {
      assert.ok(permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0, `${where} declares no permissions`);
      for (const [scope, granted] of Object.entries(permissions)) assert.equal(granted, 'read', `${where}: ${scope}`);
    }
  }
});

test('the posting job declares environment gate, and after the script runs, an inline step mints the App\'s token from GATE_APP_ID and GATE_APP_PRIVATE_KEY, and the post step posts with it', () => {
  for (const workflow of [template, live]) {
    const job = posting(workflow);
    const names = job.steps.map((step) => step.name);
    const ruled = names.indexOf('Run the gate check on each pull request');
    const minted = names.indexOf('Mint the gate App\'s token');
    const posted = names.indexOf('Post rigger/gate on each head the check read');
    assert.ok(ruled !== -1 && ruled < minted && minted < posted, names.join(', '));
    const mint = job.steps[minted];
    assert.equal(mint.uses, undefined);
    assert.deepEqual(mint.env, { GATE_APP_ID: '${{ vars.GATE_APP_ID }}', GATE_APP_PRIVATE_KEY: '${{ secrets.GATE_APP_PRIVATE_KEY }}' });
    assert.match(mint.run, /openssl dgst -sha256 -sign/);
    assert.match(mint.run, /app\/installations\/\$\{installation\}\/access_tokens/);
    assert.match(mint.run, /"statuses\\":\\"write\\"/);
    assert.equal(job.steps[posted].env.TOKEN, `\${{ steps.${mint.id}.outputs.token }}`);
    assert.match(job.steps[posted].run, /Authorization: Bearer \$\{TOKEN\}/);
  }
});

test('the template\'s posting job names the environment gate, the variable GATE_APP_ID and the secret GATE_APP_PRIVATE_KEY, and holds no App id or key', () => {
  const text = readFileSync(TEMPLATE, 'utf8');
  assert.equal(posting(template).environment, 'gate');
  assert.match(text, /\$\{\{ vars\.GATE_APP_ID \}\}/);
  assert.match(text, /\$\{\{ secrets\.GATE_APP_PRIVATE_KEY \}\}/);
  assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY/);
  for (const step of stepsOf(template)) {
    for (const value of Object.values(step.env ?? {})) assert.doesNotMatch(value, /^\d+$/, `${step.name} holds a literal id`);
  }
});

test('the private key and the minted token appear only in the mint and post steps\' env, and in no other step', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) {
      const env = Object.values(step.env ?? {}).join('\n');
      const named = `${env}\n${step.run ?? ''}\n${step.if ?? ''}`;
      const holdsKey = /secrets\.GATE_APP_PRIVATE_KEY/.test(named);
      const holdsToken = /steps\.mint\.outputs\.token/.test(named);
      if (step.name === 'Mint the gate App\'s token') assert.ok(holdsKey && !holdsToken && /secrets\./.test(env), step.name);
      else if (step.name === 'Post rigger/gate on each head the check read') assert.ok(holdsToken && !holdsKey && /steps\.mint\.outputs\.token/.test(env), step.name);
      else assert.ok(!holdsKey && !holdsToken && !/secrets\./.test(named), step.name);
    }
    // Nothing above the steps hands either on: no job or workflow env, and no job output.
    const above = JSON.stringify([workflow.env, ...jobsOf(workflow).map((job) => [job.env, job.outputs])]);
    assert.doesNotMatch(above, /secrets\.|steps\.mint/);
  }
});

test('no step in any job of the workflow has a uses:', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) assert.equal(step.uses, undefined, `${step.job}: ${step.name}`);
  }
});

test('every job in the workflow runs on ubuntu-latest', () => {
  for (const workflow of [template, live]) {
    for (const job of jobsOf(workflow)) assert.equal(job['runs-on'], 'ubuntu-latest', job.id);
  }
});

test('the workflow names one Node major, one engines admits, and before the script runs a step prints node --version and fails the run, naming both, where the runner\'s is below it', () => {
  const major = template.env.NODE_MAJOR;
  assert.match(major, /^\d+$/);
  const pinned = spawnSync('git', ['show', `${live.env.RIGGER_COMMIT}:package.json`], { cwd: ROOT, encoding: 'utf8', env: gitEnvironment() });
  assert.equal(pinned.status, 0, pinned.stderr);
  const pinnedManifest = JSON.parse(pinned.stdout);
  assert.ok(Number(major) >= Number(pinnedManifest.engines.node.match(/^>=\s*(\d+)/)[1]), `${major} is below engines ${pinnedManifest.engines.node}`);
  for (const job of jobsOf(template)) {
    const names = job.steps.map((step) => step.name);
    const checked = names.indexOf('Check the Node version');
    const script = job.steps.findIndex((step) => /GATE_CHECK/.test(step.run ?? ''));
    assert.ok(checked !== -1 && checked < script, `${job.id}: ${names.join(', ')}`);
  }
  const check = stepNamed(posting(template), 'Check the Node version');
  for (const [version, status] of [['v22.11.0', 1], [`v${major}.0.0`, 0], ['v26.1.0', 0]]) {
    const ran = runStep(check, { NODE_MAJOR: major }, { node: `#!/bin/sh\necho ${version}\n` });
    assert.equal(ran.status, status, `${version}: ${ran.stdout}${ran.stderr}`);
    assert.ok(ran.stdout.includes(version) && ran.stdout.includes(`Node ${major}`), ran.stdout);
  }
});

test('no run: step interpolates a github.event expression, and event fields reach the script through env', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\$\{\{/, `${step.job}: ${step.name}`);
    assert.equal(workflow.env.NUMBER, '${{ github.event.pull_request.number || github.event.issue.number }}');
    assert.equal(workflow.env.IS_PULL, '${{ github.event.pull_request != null || github.event.issue.pull_request != null }}');
  }
});

test('no step checks out, or runs code from, the pull request\'s head', () => {
  for (const workflow of [template, live]) {
    const text = JSON.stringify(workflow);
    assert.doesNotMatch(text, /github\.event\.pull_request\.head|github\.head_ref|GITHUB_HEAD_REF/);
    for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\bgit (clone|checkout|fetch|switch)\b/, step.name);
  }
});

test('a first job resolves the card\'s number and hands the posting job that number alone as its output', () => {
  for (const workflow of [template, live]) {
    const [first] = jobsOf(workflow);
    assert.deepEqual(first.outputs, { card: '${{ steps.card.outputs.card }}' });
    assert.match(stepNamed(first, 'Resolve the card').run, /^node "\$\{RUNNER_TEMP\}\/\$\{GATE_CHECK\}" card >> "\$\{GITHUB_OUTPUT\}"$/);
    assert.equal(posting(workflow).needs, first.id);
  }
});

test('every job that posts runs in a concurrency group keyed on the workflow and the first job\'s output, never cancelled in progress, and logs that group with its start and end times', () => {
  for (const workflow of [template, live]) {
    const posters = jobsOf(workflow).filter((job) => job.steps.some((step) => /\/statuses\//.test(step.run ?? '')));
    assert.deepEqual(posters.map((job) => job.id), [posting(workflow).id]);
    for (const job of posters) {
      assert.deepEqual(job.concurrency, { group: '${{ github.workflow }}-${{ needs.card.outputs.card }}', 'cancel-in-progress': 'false' });
      assert.equal(job.env.GROUP, job.concurrency.group);
      const [start] = job.steps;
      const end = job.steps.at(-1);
      assert.match(start.run, /concurrency group \$\{GROUP\}; started \$\(date -u/);
      assert.equal(end.if, 'always()');
      assert.match(end.run, /concurrency group \$\{GROUP\}; ended \$\(date -u/);
    }
  }
});

test('no step or condition depends on a run being cancelled', () => {
  for (const workflow of [template, live]) {
    const text = JSON.stringify(workflow);
    assert.doesNotMatch(text, /cancelled\(\)|cancel-in-progress":"true/);
  }
});

test('the workflow installs Rigger at the pinned commit from its codeload tarball, outside any checkout, and runs the script by its path inside the installed package', () => {
  assert.deepEqual(manifest.bin, { rigger: 'src/cli/rigger.mjs' });
  for (const workflow of [template, live]) {
    assert.equal(workflow.env.GATE_CHECK, `rigger/node_modules/${manifest.name}/scripts/gate-check.mjs`);
    for (const job of jobsOf(workflow)) {
      const install = stepNamed(job, 'Install Rigger at the pinned commit');
      assert.match(install.run, /npm install --prefix "\$\{RUNNER_TEMP\}\/rigger" --ignore-scripts .*"https:\/\/codeload\.github\.com\/williacj\/rigger\/tar\.gz\/\$\{RIGGER_COMMIT\}"/);
      for (const step of job.steps.filter((each) => /gate-check|GATE_CHECK/.test(each.run ?? ''))) {
        assert.match(step.run, /node "\$\{RUNNER_TEMP\}\/\$\{GATE_CHECK\}" (card|map|rule)/, step.name);
      }
    }
  }
});

test('the post and mint steps run only where every step before them succeeded and the event concerns a pull request, so a failed read of the card\'s pull requests or of a pull request posts nothing', () => {
  for (const workflow of [template, live]) {
    const job = posting(workflow);
    for (const name of ['Mint the gate App\'s token', 'Post rigger/gate on each head the check read']) {
      assert.equal(stepNamed(job, name).if, 'success() && steps.map.outputs.pulls != \'\'');
    }
    // The map and the gate check run with no condition of their own, so either failing skips both.
    for (const name of ['Map the event to its pull requests', 'Run the gate check on each pull request']) assert.equal(stepNamed(job, name).if, undefined);
  }
});

test('no file under scripts/, .github/ or templates/ holds the marker\'s syntax', () => {
  const grep = spawnSync('git', ['grep', '-n', 'rigger-marker', '--', 'scripts', '.github', 'templates'], { cwd: ROOT, encoding: 'utf8', env: gitEnvironment() });
  assert.equal(grep.status, 1, grep.stdout);
});

/**
 * Runs `step`'s script as the runner does, under bash with `-eo pipefail`, with `env` beside the
 * runner's own variables, and with `stand-ins`, each a name and its script, first on PATH. Answers
 * its status, what it printed, and the runner's files: its temporary directory, output and summary.
 */
function runStep(step, env = {}, standIns = {}, runner = temporaryDirectory('rigger-workflow-runner-')) {
  const bin = join(runner, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, script] of Object.entries(standIns)) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  const files = { RUNNER_TEMP: join(runner, 'temp'), GITHUB_OUTPUT: join(runner, 'output'), GITHUB_STEP_SUMMARY: join(runner, 'summary') };
  mkdirSync(files.RUNNER_TEMP, { recursive: true });
  for (const file of [files.GITHUB_OUTPUT, files.GITHUB_STEP_SUMMARY]) if (!existsSync(file)) writeFileSync(file, '');
  writeFileSync(join(runner, 'step.sh'), step.run);
  const ran = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(runner, 'step.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: [bin, process.env.PATH].join(delimiter), GITHUB_REPOSITORY: 'acme/widgets', GATE_CHECK: template.env.GATE_CHECK, ...files, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, runner, ...files };
}

/**
 * A stand-in gate check under `runner`'s temporary directory, at the path the workflow runs it by,
 * printing for each pull request what `answers` gives it and exiting with its status.
 */
function standInCheck(runner, answers) {
  const path = join(runner, 'temp', template.env.GATE_CHECK);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `const answers = ${JSON.stringify(answers)};\nconst [, number] = process.argv.slice(2);\nconst { printed, status } = answers[number];\nprocess.stdout.write(printed);\nprocess.exitCode = status;\n`);
}

/** A stand-in curl that records each call's URL and body, one JSON line each, and prints `{}`. */
const curlRecording = (runner) => `#!/bin/sh\nnode -e 'const a = process.argv.slice(1); require("fs").appendFileSync(${JSON.stringify(join(runner, 'posts'))}, JSON.stringify({ url: a.find((w) => w.startsWith("https://")), body: a[a.indexOf("-d") + 1] }) + "\\n")' -- "$@"\necho '{}'\n`;

/** What the stand-in curl was asked to post, one entry per call. */
const postsOf = (runner) => (existsSync(join(runner, 'posts')) ? readFileSync(join(runner, 'posts'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);

/** Runs the posting job's gate step for `answers`, then, where it succeeded, its post step. */
function gateAndPost(answers) {
  const job = posting(template);
  const runner = temporaryDirectory('rigger-workflow-runner-');
  standInCheck(runner, answers);
  const gate = runStep(stepNamed(job, 'Run the gate check on each pull request'), { PULLS: Object.keys(answers).join(' ') }, {}, runner);
  const post = gate.status === 0
    ? runStep(stepNamed(job, 'Post rigger/gate on each head the check read'), { CONTEXT: GATE_CONTEXT, TOKEN: 'minted' }, { curl: curlRecording(runner) }, runner)
    : null;
  return { gate, post, posts: postsOf(runner), summary: readFileSync(gate.GITHUB_STEP_SUMMARY, 'utf8') };
}

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const THIRD = 'c'.repeat(40);

test('the workflow posts one status under rigger/gate on the SHA the script printed: success where it exited 0, failure otherwise, with the first reason, cut to 140 characters, as its description', () => {
  const long = `reviewer: ${'é'.repeat(200)}`;
  const { gate, post, posts, summary } = gateAndPost({
    12: { printed: `head: ${SHA}\nadmitted\n`, status: 0 },
    13: { printed: `head: ${OTHER}\nrefused: ${long}\nrefused: owner: no marker\n`, status: 1 },
    // A non-zero exit with no reason printed is a failure all the same: the state is the status's.
    14: { printed: `head: ${THIRD}\n`, status: 1 },
  });

  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.equal(post.status, 0, post.stdout + post.stderr);
  assert.deepEqual(posts.map((each) => each.url), [SHA, OTHER, THIRD].map((sha) => `https://api.github.com/repos/acme/widgets/statuses/${sha}`));
  const [admitted, refused, unexplained] = posts.map((each) => JSON.parse(each.body));
  assert.equal(unexplained.state, 'failure');
  assert.deepEqual({ state: admitted.state, context: admitted.context }, { state: 'success', context: 'rigger/gate' });
  assert.deepEqual(refused, { state: 'failure', context: 'rigger/gate', description: [...long].slice(0, 140).join('') });
  assert.equal([...refused.description].length, 140);
  assert.ok(summary.includes(`head: ${OTHER}`), summary);
});

test('where a run of the script read no pull request, it printed no head, so the gate step fails and no post step runs for that event', () => {
  const { gate, post, posts } = gateAndPost({
    12: { printed: `head: ${SHA}\nadmitted\n`, status: 0 },
    13: { printed: '', status: 2 },
  });

  assert.notEqual(gate.status, 0);
  assert.match(gate.stdout, /pull request #13 could not be read, so nothing is posted for this event/);
  assert.equal(post, null);
  assert.deepEqual(posts, []);
});

test('the post goes on the SHA the script read, whatever the head is by the time it posts', () => {
  // The post step reads no head of its own: the only SHA it is handed is the one the check printed.
  const { posts } = gateAndPost({ 12: { printed: `head: ${SHA}\nrefused: reviewer: no marker\n`, status: 1 } });
  assert.deepEqual(posts.map((each) => each.url), [`https://api.github.com/repos/acme/widgets/statuses/${SHA}`]);
  assert.doesNotMatch(stepNamed(posting(template), 'Post rigger/gate on each head the check read').run, /pulls\/|gh /);
});

// This repository's own self-hosting workflow, which posts `self-hosting` as the gate workflow
// posts `rigger/gate`, from the tree fetched at the commit its own file was read from.

const SELF_HOSTING = join(ROOT, '.github', 'workflows', 'self-hosting.yml');

/** The self-hosting workflow, parsed when a test reads it. */
const selfHosting = () => parseWorkflow(readFileSync(SELF_HOSTING, 'utf8'));

test('every gate and self-hosting job runs on ubuntu-latest', () => {
  for (const workflow of [template, live, selfHosting()]) {
    for (const job of jobsOf(workflow)) assert.equal(job['runs-on'], 'ubuntu-latest', `${workflow.name}: ${job.id}`);
  }
});

test('plain issue comments skip the card job in every gate and self-hosting workflow', () => {
  for (const workflow of [template, live, selfHosting()]) {
    assert.equal(workflow.jobs.card.if, "github.event_name != 'issue_comment' || github.event.issue.pull_request", workflow.name);
  }
});

test('every gate and self-hosting job selects the newest cached Node 24 before checking its version', () => {
  for (const workflow of [template, live, selfHosting()]) {
    for (const job of jobsOf(workflow)) {
      const names = job.steps.map((step) => step.name);
      const select = stepNamed(job, 'Select Node 24 from the runner tool cache');
      assert.ok(names.indexOf(select.name) < names.indexOf('Check the Node version'), `${workflow.name}: ${job.id}`);
      assert.equal(select.uses, undefined);
      assert.doesNotMatch(select.run, /\bcurl\b|\bwget\b|\bnpm install\b|https?:\/\//);

      const runner = temporaryDirectory('rigger-workflow-node-cache-');
      const cache = join(runner, 'tool-cache');
      for (const version of ['22.99.0', '24.1.0', '24.9.9', '24.21.9', '24.21.10']) mkdirSync(join(cache, 'node', version, 'x64', 'bin'), { recursive: true });
      const path = join(runner, 'github-path');
      const ran = runStep(select, { RUNNER_TOOL_CACHE: cache, GITHUB_PATH: path }, {}, runner);
      assert.equal(ran.status, 0, `${workflow.name}: ${job.id}: ${ran.stdout}${ran.stderr}`);
      assert.equal(readFileSync(path, 'utf8'), `${join(cache, 'node', '24.21.10', 'x64', 'bin')}\n`, `${workflow.name}: ${job.id}`);
    }
  }
});

test('every gate and self-hosting job refuses a cache without Node 24', () => {
  for (const workflow of [template, live, selfHosting()]) {
    for (const job of jobsOf(workflow)) {
      const runner = temporaryDirectory('rigger-workflow-node-cache-');
      const cache = join(runner, 'tool-cache');
      mkdirSync(join(cache, 'node', '22.99.0', 'x64', 'bin'), { recursive: true });
      const path = join(runner, 'github-path');
      const select = stepNamed(job, 'Select Node 24 from the runner tool cache');
      const ran = runStep(select, { RUNNER_TOOL_CACHE: cache, GITHUB_PATH: path }, {}, runner);
      assert.equal(ran.status, 1, `${workflow.name}: ${job.id}: ${ran.stdout}${ran.stderr}`);
      assert.match(ran.stdout, /Node 24 is absent from the runner tool cache/, `${workflow.name}: ${job.id}`);
      assert.equal(existsSync(path), false, `${workflow.name}: ${job.id}`);
    }
  }
});

/** The scripts the self-hosting workflow runs, by their paths inside the tree it fetched. */
const TREE_SCRIPTS = /node "\$\{RUNNER_TEMP\}\/\$\{TREE\}\/(scripts\/gate-check\.mjs|\.github\/scripts\/self-hosting-check\.mjs)"/;

/** The self-hosting workflow's step names, which the tests below find its steps by. */
const FETCH = 'Fetch the tree this workflow was read from';
const CHECK = 'Run the self-hosting check on each pull request';
const MINT = 'Mint the gate App\'s token';
const POST = 'Post self-hosting on each head the check read';

test('the self-hosting workflow triggers on the gate workflow\'s event set, and on no pull_request event', () => {
  assert.deepEqual(selfHosting().on, live.on);
  assert.deepEqual(Object.keys(selfHosting().on), ['pull_request_target', 'issue_comment', 'issues']);
});

test('no step in any job of the self-hosting workflow has a uses:', () => {
  const steps = stepsOf(selfHosting());
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.uses, undefined, `${step.job}: ${step.name}`);
});

test('the self-hosting workflow runs the self-hosting script and the gate script by their paths in the tree an inline step of the same job fetched, and never from the head\'s tree, the base ref or a pinned install', () => {
  const workflow = selfHosting();
  assert.match(workflow.env.TREE, /^[a-z-]+$/);
  const ran = new Set();
  for (const job of jobsOf(workflow)) {
    const fetched = job.steps.findIndex((step) => step.name === FETCH);
    for (const [at, step] of job.steps.entries()) {
      const run = step.run ?? '';
      // The version check is the gate workflow's own, which names node only to ask its version.
      if (step.name === 'Check the Node version') {
        assert.equal(run, stepNamed(posting(live), step.name).run);
        continue;
      }
      assert.doesNotMatch(run, /npm (install|ci)|RIGGER_COMMIT|node_modules|GITHUB_BASE_REF|github\.base_ref|\bgit (clone|checkout|fetch|switch|worktree)\b/, `${job.id}: ${step.name}`);
      // Every node it runs is the version check, an inline script, or one of the two scripts in the tree.
      for (const call of run.match(/\bnode [^|;\n]*/g) ?? []) {
        if (/^node (--version|-e )/.test(call)) continue;
        const script = TREE_SCRIPTS.exec(call);
        assert.ok(script, `${job.id}: ${step.name} runs ${call}`);
        assert.ok(fetched !== -1 && fetched < at, `${job.id}: ${step.name} runs before the tree is fetched`);
        ran.add(script[1]);
      }
    }
  }
  assert.deepEqual([...ran].sort(), ['.github/scripts/self-hosting-check.mjs', 'scripts/gate-check.mjs']);
});

test('the fetch step names GITHUB_WORKFLOW_SHA as the commit it fetches, and never GITHUB_SHA, github.sha, a github.event field or a branch name, and nothing redefines GITHUB_WORKFLOW_SHA', () => {
  const workflow = selfHosting();
  for (const job of jobsOf(workflow)) {
    const fetch = stepNamed(job, FETCH);
    assert.match(fetch.run, /"https:\/\/codeload\.github\.com\/\$\{GITHUB_REPOSITORY\}\/tar\.gz\/\$\{GITHUB_WORKFLOW_SHA\}"/);
    assert.doesNotMatch(fetch.run, /\bGITHUB_SHA\b|github\.sha|github\.event|GITHUB_REF|GITHUB_HEAD_REF|GITHUB_BASE_REF|github\.ref|refs\/|\bmain\b|\$\{\{/, job.id);
    assert.equal(fetch.env, undefined, job.id);
  }
  const envs = [workflow.env, ...jobsOf(workflow).flatMap((job) => [job.env, ...job.steps.map((step) => step.env)])];
  for (const env of envs) assert.ok(!Object.hasOwn(env ?? {}, 'GITHUB_WORKFLOW_SHA'), JSON.stringify(env));
});

test('run as the runner runs it, the fetch step unpacks the tarball the forge serves for that commit into the tree the scripts run from', () => {
  const fetch = stepNamed(posting(selfHosting()), FETCH);
  const runner = temporaryDirectory('rigger-workflow-runner-');
  const source = join(runner, 'source', 'rigger-0123456');
  mkdirSync(join(source, '.github', 'scripts'), { recursive: true });
  writeFileSync(join(source, '.github', 'scripts', 'self-hosting-check.mjs'), 'the script\n');
  const tarball = join(runner, 'tree.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', tarball, '-C', join(runner, 'source'), 'rigger-0123456']).status, 0);
  const curl = `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(join(runner, 'curl-args'))}\ncat ${JSON.stringify(tarball)}\n`;

  const ran = runStep(fetch, { TREE: selfHosting().env.TREE, GITHUB_WORKFLOW_SHA: '0123456789abcdef0123456789abcdef01234567', GITHUB_SHA: 'f'.repeat(40) }, { curl }, runner);

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(readFileSync(join(runner, 'curl-args'), 'utf8').split('\n').includes('https://codeload.github.com/acme/widgets/tar.gz/0123456789abcdef0123456789abcdef01234567'));
  assert.equal(readFileSync(join(ran.RUNNER_TEMP, selfHosting().env.TREE, '.github', 'scripts', 'self-hosting-check.mjs'), 'utf8'), 'the script\n');
});

test('no step of the self-hosting workflow checks out, or runs code from, the pull request\'s head', () => {
  const workflow = selfHosting();
  assert.doesNotMatch(JSON.stringify(workflow), /github\.event\.pull_request\.head|github\.head_ref|GITHUB_HEAD_REF/);
  for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\bgit (clone|checkout|fetch|switch)\b/, step.name);
});

test('the self-hosting workflow\'s permissions grant its GITHUB_TOKEN read scopes only, at the top level and in every job', () => {
  const workflow = selfHosting();
  for (const [where, permissions] of [['top level', workflow.permissions], ...jobsOf(workflow).map((job) => [job.id, job.permissions])]) {
    assert.ok(permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0, `${where} declares no permissions`);
    for (const [scope, granted] of Object.entries(permissions)) assert.equal(granted, 'read', `${where}: ${scope}`);
  }
});

test('the self-hosting posting job declares environment gate, and after the script runs, an inline step mints the App\'s token from GATE_APP_ID and GATE_APP_PRIVATE_KEY, and the post step posts self-hosting with it', () => {
  const job = posting(selfHosting());
  const names = job.steps.map((step) => step.name);
  const [checkedAt, mintedAt, postedAt] = [CHECK, MINT, POST].map((name) => names.indexOf(name));
  assert.ok(checkedAt !== -1 && checkedAt < mintedAt && mintedAt < postedAt, names.join(', '));
  const mint = job.steps[mintedAt];
  assert.equal(mint.uses, undefined);
  assert.deepEqual(mint.env, { GATE_APP_ID: '${{ vars.GATE_APP_ID }}', GATE_APP_PRIVATE_KEY: '${{ secrets.GATE_APP_PRIVATE_KEY }}' });
  const post = job.steps[postedAt];
  assert.equal(post.env.CONTEXT, 'self-hosting');
  assert.equal(post.env.TOKEN, `\${{ steps.${mint.id}.outputs.token }}`);
  assert.match(post.run, /Authorization: Bearer \$\{TOKEN\}/);
});

test('the self-hosting mint step\'s run: is identical to the gate workflow\'s', () => {
  assert.equal(stepNamed(posting(selfHosting()), MINT).run, stepNamed(posting(live), MINT).run);
});

test('in the self-hosting workflow, the private key and the minted token appear only in the mint and post steps\' env, and in no other step', () => {
  const workflow = selfHosting();
  for (const step of stepsOf(workflow)) {
    const env = Object.values(step.env ?? {}).join('\n');
    const named = `${env}\n${step.run ?? ''}\n${step.if ?? ''}`;
    const holdsKey = /secrets\.GATE_APP_PRIVATE_KEY/.test(named);
    const holdsToken = /steps\.mint\.outputs\.token/.test(named);
    if (step.name === MINT) assert.ok(holdsKey && !holdsToken && /secrets\./.test(env), step.name);
    else if (step.name === POST) assert.ok(holdsToken && !holdsKey && /steps\.mint\.outputs\.token/.test(env), step.name);
    else assert.ok(!holdsKey && !holdsToken && !/secrets\./.test(named), step.name);
  }
  const above = JSON.stringify([workflow.env, ...jobsOf(workflow).map((job) => [job.env, job.outputs])]);
  assert.doesNotMatch(above, /secrets\.|steps\.mint/);
});

test('no run: step of the self-hosting workflow interpolates a github.event expression, and event fields reach the scripts through env', () => {
  const workflow = selfHosting();
  for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\$\{\{/, `${step.job}: ${step.name}`);
  assert.equal(workflow.env.NUMBER, live.env.NUMBER);
  assert.equal(workflow.env.IS_PULL, live.env.IS_PULL);
});

test('the self-hosting workflow\'s first job runs the gate script\'s card mode by its path in the fetched tree, and hands the posting job that card\'s number alone as its output', () => {
  const workflow = selfHosting();
  const [first] = jobsOf(workflow);
  assert.deepEqual(first.outputs, { card: '${{ steps.card.outputs.card }}' });
  assert.equal(stepNamed(first, 'Resolve the card').run, 'node "${RUNNER_TEMP}/${TREE}/scripts/gate-check.mjs" card >> "${GITHUB_OUTPUT}"');
  assert.equal(posting(workflow).needs, first.id);
  assert.equal(first.environment, undefined);
});

test('the self-hosting posting job\'s mapping step runs the gate script\'s map mode by its path in the fetched tree', () => {
  assert.match(stepNamed(posting(selfHosting()), 'Map the event to its pull requests').run, /^node "\$\{RUNNER_TEMP\}\/\$\{TREE\}\/scripts\/gate-check\.mjs" map > /);
});

test('every self-hosting posting job runs in a concurrency group keyed on the workflow and the first job\'s output, never cancelled in progress, whose key for one card differs from the gate workflow\'s', () => {
  const workflow = selfHosting();
  const posters = jobsOf(workflow).filter((job) => job.steps.some((step) => /\/statuses\//.test(step.run ?? '')));
  assert.deepEqual(posters.map((job) => job.id), [posting(workflow).id]);
  const group = '${{ github.workflow }}-${{ needs.card.outputs.card }}';
  for (const job of posters) {
    assert.deepEqual(job.concurrency, { group, 'cancel-in-progress': 'false' });
    assert.equal(job.env.GROUP, group);
  }
  // For one card, the group each workflow's run waits in is the expression with its own name in it.
  const keyed = (named) => posting(named).concurrency.group.replace('${{ github.workflow }}', named.name).replace('${{ needs.card.outputs.card }}', '662');
  assert.equal(posting(live).concurrency.group, group);
  assert.notEqual(keyed(workflow), keyed(live));
});

test('no step or condition of the self-hosting workflow depends on a run being cancelled, and each run reads its facts at its start and posts on the SHA it read', () => {
  const workflow = selfHosting();
  assert.doesNotMatch(JSON.stringify(workflow), /cancelled\(\)|cancel-in-progress":"true/);
  // The facts are read by the script, which the check step runs once the job has started; the post step reads none.
  const post = stepNamed(posting(workflow), POST);
  assert.doesNotMatch(post.run, /pulls\/|gh |node "\$\{RUNNER_TEMP\}\/\$\{TREE\}/);
  assert.match(post.run, /statuses\/\$\{head\}/);
});

test('the self-hosting mint and post steps run only where every step before them succeeded and the event concerns a pull request, so a failed read of the card\'s pull requests or of a pull request posts nothing', () => {
  const job = posting(selfHosting());
  for (const name of [MINT, POST]) assert.equal(stepNamed(job, name).if, 'success() && steps.map.outputs.pulls != \'\'');
  for (const name of ['Map the event to its pull requests', CHECK]) assert.equal(stepNamed(job, name).if, undefined);
});

test('no job of the self-hosting workflow has an id or name equal to rigger/gate or self-hosting', () => {
  for (const job of jobsOf(selfHosting())) {
    for (const named of [job.id, job.name]) assert.ok(!['rigger/gate', 'self-hosting'].includes(named), named);
  }
});

/**
 * Runs the self-hosting posting job's check step on `pulls` with the scripts in `tree` and `env`
 * beside, then, where it succeeded, its post step, with stand-in curl first on PATH recording what
 * it posts. `env` is not handed to the post step, so no PATH it names can put the real curl first.
 */
function checkAndPost(pulls, tree, env = {}) {
  const job = posting(selfHosting());
  const runner = temporaryDirectory('rigger-workflow-runner-');
  mkdirSync(join(runner, 'temp'), { recursive: true });
  symlinkSync(tree, join(runner, 'temp', selfHosting().env.TREE));
  const check = runStep(stepNamed(job, CHECK), { TREE: selfHosting().env.TREE, PULLS: pulls.join(' '), ...env }, {}, runner);
  const post = check.status === 0
    ? runStep(stepNamed(job, POST), { CONTEXT: 'self-hosting', TOKEN: 'minted', GITHUB_REPOSITORY: env.GITHUB_REPOSITORY ?? 'acme/widgets' }, { curl: curlRecording(runner) }, runner)
    : null;
  return { check, post, posts: postsOf(runner) };
}

/** A tree holding a stand-in self-hosting script that prints, for each pull request, what `answers` gives it, and exits with its status. */
function standInTree(answers) {
  const tree = temporaryDirectory('rigger-workflow-tree-');
  mkdirSync(join(tree, '.github', 'scripts'), { recursive: true });
  writeFileSync(join(tree, '.github', 'scripts', 'self-hosting-check.mjs'), `const answers = ${JSON.stringify(answers)};\nconst { printed, status } = answers[process.argv[2]];\nprocess.stdout.write(printed);\nprocess.exitCode = status;\n`);
  return tree;
}

test('the self-hosting workflow posts self-hosting on the SHA the script printed: success where it exited 0, failure otherwise, with its first refusal reason, cut to 140 characters, as the description', () => {
  const long = `owner: ${'é'.repeat(200)}`;
  const { check, post, posts } = checkAndPost([12, 13], standInTree({
    12: { printed: `head: ${SHA}\npassed\n`, status: 0 },
    13: { printed: `head: ${OTHER}\nrefused: ${long}\nrefused: another\n`, status: 1 },
  }));

  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.equal(post.status, 0, post.stdout + post.stderr);
  assert.deepEqual(posts.map((each) => each.url), [SHA, OTHER].map((sha) => `https://api.github.com/repos/acme/widgets/statuses/${sha}`));
  const [passed, refused] = posts.map((each) => JSON.parse(each.body));
  assert.deepEqual({ state: passed.state, context: passed.context }, { state: 'success', context: 'self-hosting' });
  assert.deepEqual(refused, { state: 'failure', context: 'self-hosting', description: [...long].slice(0, 140).join('') });
});

/**
 * A fake forge whose `main` holds this repository's config and an `AGENTS.md` listing
 * `.githooks/`, with card 7's issue and pull request 12 from `rigger-7` at that branch's head,
 * holding `pull`'s facts beside.
 */
function selfHostingForge(pull) {
  const agents = '## What binds\n\n| Document | Authority |\n|---|---|\n| `README.md` | The CLI contract |\n\n## Self-hosting\n\n- The live gate: `.githooks/`.\n';
  const origin = repositoryIn('rigger-workflow-origin-', { 'rigger.config.mjs': `export default ${JSON.stringify(rigger)};\n`, 'AGENTS.md': agents });
  gitIn(origin, 'branch', '-M', 'main');
  gitIn(origin, 'switch', '--quiet', '-c', 'rigger-7');
  gitIn(origin, 'commit', '--allow-empty', '-qm', 'the card\'s work');
  gitIn(origin, 'switch', '--quiet', 'main');
  const head = gitIn(origin, 'rev-parse', 'rigger-7').trim();
  const issues = [{ number: 7, title: 'Card seven', body: '## Acceptance\n\n- The verb prints its help.\n', labels: ['type:change'] }];
  const fake = installFakeGh(temporaryDirectory('rigger-workflow-gh-'), { repo: 'williacj/rigger', project: 6, board: { columns: ['Review'], items: [] }, origin });
  seedRepository(fake, { repo: 'williacj/rigger', issues, pullRequests: [{ number: 12, head: 'rigger-7', sha: head, base: 'main', ...pull }] });
  return { origin, head, fake };
}

/**
 * The environment the workflow's steps run the real scripts under against `forge`: a `gh` first on
 * PATH handing the fake every request, failing one holding `failing` as gh does on a 502, and
 * running `then` once one holding `after` is answered.
 */
function onForge(forge, { failing = 'no request', after = 'no request', then = ':' } = {}) {
  const directory = temporaryDirectory('rigger-workflow-wrapped-gh-');
  fixture(directory, 'gh', [
    'unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY',
    `case "$*" in *'${failing}'*) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;; esac`,
    `'${forge.fake.gh}' "$@"`,
    'status=$?',
    `case "$*" in *'${after}'*) ${then} ;; esac`,
    'exit $status',
  ].join('\n'));
  return { PATH: [directory, dirname(forge.fake.gh), process.env.PATH].join(delimiter), GITHUB_REPOSITORY: 'williacj/rigger' };
}

/** A diff changing `.githooks/pre-commit`, as the forge serves it. */
const HOOK_DIFF = 'diff --git a/.githooks/pre-commit b/.githooks/pre-commit\nindex 3b18e51..8c7e5a6 100644\n--- a/.githooks/pre-commit\n+++ b/.githooks/pre-commit\n@@ -1 +1 @@\n-one\n+two\n';

test('given the forge answers another head when the script reads the pull request again after its diff, the workflow running the script on it posts no self-hosting status for that event', () => {
  const forge = selfHostingForge({ diff: HOOK_DIFF });
  const moved = gitIn(forge.origin, 'commit-tree', '-p', forge.head, '-m', 'moved', `${forge.head}^{tree}`).trim();
  const env = onForge(forge, { after: 'vnd.github.diff', then: `git -C '${forge.origin}' update-ref refs/heads/rigger-7 ${moved}` });

  const { check, post, posts } = checkAndPost([12], ROOT, env);

  assert.notEqual(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stderr, new RegExp(`head moved from ${forge.head} to ${moved}`));
  assert.match(check.stdout, /pull request #12 could not be read, so nothing is posted for this event/);
  assert.equal(post, null);
  assert.deepEqual(posts, []);
});

test('given the diff read fails, or the forge refuses the diff as too large, the workflow running the script posts failure on the head the script read, with a description naming the diff read', () => {
  for (const [pull, failing, named] of [[{ diff: HOOK_DIFF }, 'vnd.github.diff', /HTTP 502/], [{ declined: 'Sorry, the diff exceeded the maximum number of lines (20000)' }, undefined, /maximum number of lines/]]) {
    const forge = selfHostingForge(pull);

    const { check, posts } = checkAndPost([12], ROOT, onForge(forge, { failing }));

    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.deepEqual(posts.map((each) => each.url), [`https://api.github.com/repos/williacj/rigger/statuses/${forge.head}`]);
    const posted = JSON.parse(posts[0].body);
    assert.equal(posted.state, 'failure');
    assert.equal(posted.context, 'self-hosting');
    assert.match(posted.description, /^the read of pull request #12's diff failed: /);
    assert.ok([...posted.description].length <= 140);
    assert.match(check.stdout, named);
  }
});

test('actual local Git authenticates forward tested bases and refuses nonancestors and missing objects', async (t) => {
  const directory = repositoryAt(temporaryDirectory('rigger-ci-forward-', { context: t }), { 'docs/journal/base.md': 'base\n' });
  gitIn(directory, 'branch', '-M', 'main');
  const eventBase = gitIn(directory, 'rev-parse', 'HEAD').trim();
  gitIn(directory, 'checkout', '-qb', 'change');
  writeFileSync(join(directory, 'docs/journal/candidate.md'), 'candidate\n');
  gitIn(directory, 'add', '-A'); gitIn(directory, 'commit', '-qm', 'candidate');
  const head = gitIn(directory, 'rev-parse', 'HEAD').trim();
  gitIn(directory, 'checkout', '-q', 'main');
  mkdirSync(join(directory, 'src')); writeFileSync(join(directory, 'src/intervening.mjs'), 'export {};\n');
  gitIn(directory, 'add', '-A'); gitIn(directory, 'commit', '-qm', 'intervening base');
  const testedBase = gitIn(directory, 'rev-parse', 'HEAD').trim();
  gitIn(directory, 'merge', '--no-ff', '-qm', 'synthetic candidate', head);
  const sha = gitIn(directory, 'rev-parse', 'HEAD').trim(), tree = gitIn(directory, 'rev-parse', 'HEAD^{tree}').trim();
  assert.deepEqual(gitIn(directory, 'show', '-s', '--format=%P', 'HEAD').trim().split(' '), [testedBase, head]);
  assert.equal(gitIn(directory, 'merge-base', '--is-ancestor', eventBase, testedBase), '');
  const ci = parseWorkflow(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  assert.equal(process.env.CI_POLICY_ACTION, undefined);
  const actual = await import('data:text/javascript;base64,' + Buffer.from(ci.env.CI_POLICY).toString('base64'));
  const fixture = ciCollectorFixture();
  fixture.context.sha = sha;
  fixture.event.pull_request.head.sha = fixture.api['/repos/williacj/rigger/pulls/7'].head.sha = head;
  fixture.event.pull_request.base.sha = eventBase;
  fixture.api['/repos/williacj/rigger/pulls/7'].base.sha = testedBase;
  fixture.api['/repos/williacj/rigger/git/ref/heads/main'].object.sha = testedBase;
  const calls = [];
  const collect = () => actual.collect({ context: fixture.context, event: fixture.event,
    run(args) {
      calls.push(args);
      if (args[0] === 'rev-parse') {
        assert.ok(['HEAD', 'HEAD^{tree}'].includes(args[1])); assert.equal(args.length, 2);
        return Buffer.from(gitIn(directory, 'rev-parse', args[1]));
      }
      if (args[0] === 'show') {
        assert.deepEqual(args, ['show', '-s', '--format=%P', 'HEAD']);
        return Buffer.from(gitIn(directory, 'show', '-s', '--format=%P', 'HEAD'));
      }
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', fixture.event.pull_request.base.sha, testedBase]);
        return Buffer.from(gitIn(directory, 'merge-base', '--is-ancestor', fixture.event.pull_request.base.sha, testedBase));
      }
      if (args[0] === 'diff') {
        assert.deepEqual(args, ['diff', '--raw', '-z', '--no-renames', testedBase, sha]);
        return Buffer.from(gitIn(directory, 'diff', '--raw', '-z', '--no-renames', testedBase, sha));
      }
      throw new Error('unexpected native Git command ' + JSON.stringify(args));
    },
    request: async (path) => { assert.ok(Object.hasOwn(fixture.api, path), path); return fixture.api[path]; },
  });
  const facts = await collect();
  assert.equal(facts.complete, true, facts.reason);
  assert.equal(facts.pr.eventBaseAncestor, true);
  assert.deepEqual(calls.filter((args) => args[0] === 'merge-base'), [['merge-base', '--is-ancestor', eventBase, testedBase]]);
  assert.deepEqual(calls.at(-1), ['diff', '--raw', '-z', '--no-renames', testedBase, sha]);
  assert.deepEqual(facts.changes, [{ oldMode: '000000', newMode: '100644', status: 'A', path: 'docs/journal/candidate.md' }]);
  assert.equal(actual.policy(facts).mode, 'FAST_ELIGIBLE');
  assert.deepEqual(actual.source(facts), { event: 'pull_request', ref: 'refs/pull/7/merge', sha, tree, parents: [testedBase, head], head, base: testedBase, baseRef: 'main', eventBase });
  for (const refused of [head, sha, 'f'.repeat(40)]) {
    calls.length = 0; fixture.event.pull_request.base.sha = refused;
    const rejected = await collect();
    assert.equal(rejected.complete, false, refused);
    assert.equal(actual.policy(rejected).mode, 'INVALID', refused);
    assert.deepEqual(calls.filter((args) => args[0] === 'merge-base'), [['merge-base', '--is-ancestor', refused, testedBase]]);
    assert.equal(calls.some((args) => args[0] === 'diff'), false);
  }
});
