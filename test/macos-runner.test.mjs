// ABOUTME: Exercises the macOS CI runner selection and job-hook decision against card 1203's Table R.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciCollectorFixture, ciFacts, ciProof, evaluateCiPolicy, parseWorkflow } from './ci-policy-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const HOSTED = '"macos-latest"';
const MINI = '["self-hosted","macOS","ARM64"]';

/** Git/API answers extend the existing recorded collector contract with GitHub's repository IDs. */
function fullFixture(headId = 44) {
  const fixture = ciCollectorFixture();
  Object.assign(fixture.event, { action: 'labeled', sender: { login: 'williacj' }, label: { name: 'ci:full' } });
  fixture.event.repository.id = 44;
  fixture.event.pull_request.head.repo = headId === null ? null : { id: headId };
  fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [{ name: 'ci:full' }];
  fixture.git[JSON.stringify(['diff', '--raw', '-z', '--no-renames', 'c'.repeat(40), 'a'.repeat(40)])] = Buffer.from(':000000 100644 0000000 1234567 A\0src/change.mjs\0').toString('base64');
  return fixture;
}

async function collected(fixture) {
  const { answer } = await evaluateCiPolicy('collect', fixture);
  assert.equal(answer.complete, true, answer.reason);
  return answer;
}

const plan = (facts, macosRunner) => evaluateCiPolicy('runPolicy', { action: 'plan', facts, macosRunner });

test('R1-R3: same-repository full runs emit the selected allowlisted runner as JSON', async () => {
  const facts = await collected(fullFixture());
  for (const [value, expected] of [[undefined, HOSTED], ['', HOSTED], [HOSTED, HOSTED], [MINI, MINI]]) {
    const answer = await plan(facts, value);
    assert.equal(answer.ok, true);
    assert.equal(answer.output.mode, 'BROAD_EXECUTED');
    assert.equal(answer.output.demoNeeded, true);
    assert.equal(answer.output.runner, expected, String(value));
    assert.deepEqual(JSON.parse(answer.output.runner), expected === HOSTED ? 'macos-latest' : ['self-hosted', 'macOS', 'ARM64']);
  }
});

test('R5: every fork variable state plans hosted jobs without changing their eligibility', async () => {
  for (const headId of [99, null]) {
    const facts = await collected(fullFixture(headId));
    for (const value of [undefined, '', HOSTED, MINI, 'malformed']) {
      const answer = await plan(facts, value);
      assert.equal(answer.ok, true, String(value));
      assert.equal(answer.output.runner, HOSTED, String(value));
      assert.equal(answer.output.mode, 'BROAD_EXECUTED');
      assert.equal(answer.output.demoNeeded, true);
    }
  }
});

const malformed = ['macos-latest', 'null', '42', '{}', '[]', '["macos-latest"]', '"ubuntu-latest"',
  '["self-hosted","ARM64","macOS"]', '["self-hosted", "macOS", "ARM64"]', ' ' + MINI, HOSTED + '\n',
  'bad\nrunner=injected', '"quote\\"$`"'];

test('R6: needed macOS jobs refuse every nonallowlisted value and name its exact text', async () => {
  const facts = await collected(fullFixture());
  for (const value of malformed) {
    await assert.rejects(plan(facts, value), (error) => {
      assert.ok(error.message.includes('MACOS_RUNNER'), error.message);
      assert.ok(error.message.includes(JSON.stringify(value)), error.message);
      return true;
    }, value);
  }
});

test('R6a: runs needing no macOS job ignore malformed values and still admit fast', async () => {
  const fixture = fullFixture();
  fixture.event.action = 'synchronize';
  fixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [];
  const facts = await collected(fixture);
  for (const value of malformed) {
    const answer = await plan(facts, value);
    assert.equal(answer.ok, true, value);
    assert.equal(answer.output.runner, HOSTED);
    assert.equal(answer.output.mode, 'BROAD_DEFERRED');
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'worker', facts, proof: ciProof('BROAD_DEFERRED'), worker: 'fast' })).ok, true);
  }
});

test('runner wiring supplies exactly the three macOS jobs from the one plan output', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(ci.jobs.plan.outputs.runner, '${{ steps.policy.outputs.runner }}');
  assert.equal(ci.jobs.plan.steps.find((step) => step.id === 'policy').env.CI_MACOS_RUNNER, '${{ vars.MACOS_RUNNER }}');
  assert.deepEqual(Object.entries(ci.jobs).filter(([, job]) => job['runs-on'] === '${{ fromJSON(needs.plan.outputs.runner) }}').map(([name]) => name).sort(), ['demo', 'full_host', 'full_ordinary']);
});

test('R4: merge groups and MAIN_FULL demo share the same runner choices and refusals', async () => {
  for (const event of ['merge_group', 'schedule', 'workflow_dispatch']) {
    const facts = ciFacts();
    delete facts.pr; delete facts.live;
    Object.assign(facts, { event, ref: 'refs/heads/main', main: { head: 'a'.repeat(40), defaultBranch: 'main' } });
    if (event === 'merge_group') facts.group = { head: 'a'.repeat(40), base: 'a'.repeat(40), baseRef: 'refs/heads/main', baseAncestor: true };
    for (const [value, expected] of [[undefined, HOSTED], ['', HOSTED], [HOSTED, HOSTED], [MINI, MINI]]) {
      const answer = await plan(facts, value);
      assert.equal(answer.ok, true);
      assert.equal(answer.output.runner, expected, event + ':' + value);
      assert.equal(answer.output.mode, event === 'merge_group' ? 'BROAD_EXECUTED' : 'MAIN_FULL');
      assert.equal(answer.output.demoNeeded, true);
    }
    for (const value of malformed) await assert.rejects(plan(facts, value), /MACOS_RUNNER/, event + ':' + value);
  }
});

test('R7: aggregate still requires every original result under all runner variable states', async () => {
  for (const value of [undefined, '', HOSTED, MINI, ...malformed]) {
    for (const full of [false, true]) {
      const facts = ciFacts();
      if (full) {
        Object.assign(facts, { action: 'labeled', sender: 'williacj', label: 'ci:full' });
        facts.live.labels = ['ci:full']; facts.changes[0].path = 'src/change.mjs';
      }
      const proof = ciProof(full ? 'BROAD_EXECUTED' : 'FAST_ELIGIBLE');
      proof.demoNeeded = full;
      if (full) proof.results.full_ordinary = proof.results.full_host = proof.results.demo = 'success';
      assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof, macosRunner: value })).ok, true);
      for (const name of Object.keys(proof.results)) for (const result of ['success', 'skipped', 'failure', 'cancelled', '', undefined]) {
        const changed = structuredClone(proof); changed.results[name] = result;
        assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: changed, macosRunner: value })).ok, result === proof.results[name], name + ':' + result);
      }
    }
  }
});

test('R8: unrelated jobs keep their literal base runners', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  for (const name of ['plan', 'fast', 'check', 'cancel_superseded']) assert.equal(ci.jobs[name]['runs-on'], 'ubuntu-latest', name);
  assert.deepEqual(ci.jobs.nightly['runs-on'], ['self-hosted', 'macOS', 'ARM64']);
});

test('R9: hook allows only the named trusted events and a same-repository pull request', async (t) => {
  const { jobAllowed } = await import('../.github/scripts/self-hosted-job-guard.cjs');
  const path = join(temporaryDirectory('rigger-hook-event-', { context: t }), 'event.json');
  writeFileSync(path, JSON.stringify({ repository: { id: 44 }, pull_request: { head: { repo: { id: 44 } } } }));
  for (const event of ['schedule', 'workflow_dispatch', 'push', 'merge_group', 'pull_request']) assert.equal(jobAllowed(event, path), true, event);
});

test('R9: hook refuses unknown events forks deleted heads and unavailable event files', async (t) => {
  const { jobAllowed } = await import('../.github/scripts/self-hosted-job-guard.cjs');
  const directory = temporaryDirectory('rigger-hook-refusal-', { context: t });
  const path = join(directory, 'event.json');
  writeFileSync(path, JSON.stringify({ repository: { id: 44 }, pull_request: { head: { repo: { id: 44 } } } }));
  for (const event of ['pull_request_target', 'pull_request_review', 'release', '', undefined]) assert.equal(jobAllowed(event, path), false, String(event));
  for (const repo of [{ id: 99 }, null, {}, { id: '44' }]) {
    writeFileSync(path, JSON.stringify({ repository: { id: 44 }, pull_request: { head: { repo } } }));
    assert.equal(jobAllowed('pull_request', path), false, JSON.stringify(repo));
  }
  for (const event of ['schedule', 'workflow_dispatch', 'push', 'merge_group', 'pull_request']) {
    for (const unavailable of [undefined, join(directory, 'missing.json'), directory]) assert.equal(jobAllowed(event, unavailable), false, event + ':' + unavailable);
    writeFileSync(path, '{malformed');
    assert.equal(jobAllowed(event, path), false, event + ':malformed');
  }
  writeFileSync(path, '{}');
  assert.equal(jobAllowed('pull_request', path), false, 'missing identity');
  assert.equal(readFileSync(path, 'utf8'), '{}', 'a refusal leaves the event file unchanged');
});

test('worker stop signals only the exact Runner.Worker in its own parent chain', async () => {
  const { stopWorker } = await import('../.github/scripts/self-hosted-job-guard.cjs');
  // ps -p PID -o ppid= -o comm= returns a parent PID followed by the executable path.
  // Local ps contract was observed on 2026-11-04; synthetic identities are independent literals.
  const rows = new Map([[701, ' 702 /runner/externals/node/bin/node\n'],
    [702, ' 703 /runner/Runner.Worker-helper\n'], [703, ' 704 /runner with spaces/bin/Runner.Worker\n']]);
  const reads = [], signals = [];
  const answer = stopWorker({ parent: 701, read: pid => { reads.push(pid); return rows.get(pid); },
    signal: (pid, name) => signals.push([pid, name]) });
  assert.equal(answer, 703);
  assert.deepEqual(signals, [[703, 'SIGKILL']]);
});

test('worker stop refuses missing malformed cyclic and changed ancestor identities without a signal', async () => {
  const { stopWorker } = await import('../.github/scripts/self-hosted-job-guard.cjs');
  for (const rows of [
    ['1 /runner/bin/Runner.Listener\n'], ['malformed'], ['701 /usr/bin/node\n'],
    ['1 /runner/bin/Runner.Worker\n', '1 /unrelated/node\n'],
    ['1 /runner/bin/Runner.Worker\n', '2 /runner/bin/Runner.Worker\n'],
  ]) {
    let index = 0;
    const signals = [];
    assert.throws(() => stopWorker({ parent: 701, read: () => rows[Math.min(index++, rows.length - 1)],
      signal: (...args) => signals.push(args) }));
    assert.deepEqual(signals, [], JSON.stringify(rows));
  }
  const signals = [];
  assert.throws(() => stopWorker({ parent: 701, read: () => { throw new Error('ps refused'); }, signal: (...args) => signals.push(args) }), /ps refused/);
  assert.deepEqual(signals, []);
});
