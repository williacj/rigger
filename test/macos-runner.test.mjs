// ABOUTME: Exercises the macOS CI runner selection and job-hook decision against card 1203's Table R.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciCollectorFixture, ciFacts, ciProof, evaluateCiPolicy, parseWorkflow } from './ci-policy-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const HOSTED = '"macos-latest"';
const MINI = '["self-hosted","macOS","ARM64","rigger-ci"]';

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
    assert.deepEqual(JSON.parse(answer.output.runner), expected === HOSTED ? 'macos-latest' : ['self-hosted', 'macOS', 'ARM64', 'rigger-ci']);
  }
});

// Card 971 infrastructure diagnostic: exact Auto-mode admission for eligible repository CI.
test('Auto admission: trusted full Mac work accepts Auto and defaults to Hosted', async () => {
  const facts = await collected(fullFixture());
  assert.equal(facts.sameRepository, true, 'the collector established a trusted same-repository head');
  assert.deepEqual(await evaluateCiPolicy('policy', facts),
    { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true },
    'the independent full-request fixture is eligible for Mac work');
  let answer;
  await assert.doesNotReject(async () => { answer = await plan(facts, '"auto"'); },
    'the approved Auto value must reach a plan instead of the malformed-value refusal');
  assert.equal(answer.ok, true);
  assert.equal(answer.output.runner, HOSTED, 'without an availability result, Auto defaults to Hosted');
  assert.equal(answer.output.mode, 'BROAD_EXECUTED');
  assert.equal(answer.output.demoNeeded, true);
});

// Card 971 infrastructure diagnostic: one bounded Auto availability table at the actual plan boundary.
test('Auto availability: ready offline busy and missing-secret states select the recorded pool', async () => {
  const facts = await collected(fullFixture());
  assert.equal(facts.sameRepository, true, 'the collector established a trusted same-repository head');
  assert.deepEqual(await evaluateCiPolicy('policy', facts),
    { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true },
    'the independent full-request fixture is eligible for Mac work');
  const rows = [
    { name: 'ready', token: 'fixture-runner-read', status: 'online', busy: false,
      expectedRunner: '["self-hosted","macOS","ARM64","rigger-ci"]', expectedReason: 'auto-mini-ready', expectedReads: 1 },
    { name: 'offline', token: 'fixture-runner-read', status: 'offline', busy: false,
      expectedRunner: '"macos-latest"', expectedReason: 'auto-mini-offline', expectedReads: 1 },
    { name: 'busy', token: 'fixture-runner-read', status: 'online', busy: true,
      expectedRunner: '"macos-latest"', expectedReason: 'auto-mini-busy', expectedReads: 1 },
    { name: 'missing-secret', token: '', status: 'online', busy: false,
      expectedRunner: '"macos-latest"', expectedReason: 'missing-secret', expectedReads: 0 },
  ];
  for (const row of rows) {
    // The complete unique runner record is authored from card 971's accepted API contract.
    // Response methods follow the existing requestJson send/headers/arrayBuffer collaborator.
    const bytes = new TextEncoder().encode(JSON.stringify({
      total_count: 1,
      runners: [{ id: 23, name: 'CJs-Mac-mini', os: 'macOS', status: row.status, busy: row.busy,
        labels: [{ name: 'self-hosted' }, { name: 'macOS' }, { name: 'ARM64' }, { name: 'rigger-ci' }] }],
    }));
    const requests = [], deadlines = [];
    const signal = new AbortController().signal;
    const answer = await evaluateCiPolicy('runPolicy', { action: 'plan', facts, macosRunner: '"auto"' }, {
      token: row.token,
      // AbortSignal.timeout's callable contract returns an AbortSignal; this double arms no timer.
      deadline: (milliseconds) => { deadlines.push(milliseconds); return signal; },
      send: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200,
          headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
          arrayBuffer: async () => bytes.buffer };
      },
    });
    assert.equal(answer.output.runner, row.expectedRunner, row.name);
    assert.equal(answer.output.runnerReason, row.expectedReason, row.name);
    assert.equal(requests.length, row.expectedReads, row.name);
    if (row.expectedReads === 1) {
      assert.equal(requests[0].url, 'https://api.github.com/repos/williacj/rigger/actions/runners?per_page=100', row.name);
      assert.equal(requests[0].options.method, 'GET', row.name);
      assert.equal(requests[0].options.redirect, 'error', row.name);
      assert.equal(requests[0].options.headers.authorization, 'Bearer fixture-runner-read', row.name);
      assert.equal(requests[0].options.signal, signal, row.name);
      assert.deepEqual(deadlines, [30000], row.name);
    } else assert.deepEqual(deadlines, [], row.name);
    assert.equal(answer.ok, true, row.name);
    assert.equal(answer.output.mode, 'BROAD_EXECUTED', row.name);
    assert.equal(answer.output.demoNeeded, true, row.name);
  }
});

// Card 971 infrastructure diagnostic: runner-read failures and untrustworthy inventories cannot choose Mini.
test('Auto read guards: failed incomplete malformed and ambiguous reads choose Hosted', async () => {
  const facts = await collected(fullFixture());
  assert.equal(facts.sameRepository, true);
  assert.deepEqual(await evaluateCiPolicy('policy', facts),
    { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true });
  // Independent literal records follow card 971's accepted GitHub runner response fields.
  const mini = { id: 23, name: 'CJs-Mac-mini', os: 'macOS', status: 'online', busy: false,
    labels: [{ name: 'self-hosted' }, { name: 'macOS' }, { name: 'ARM64' }, { name: 'rigger-ci' }] };
  const other = { id: 44, name: 'Unrelated-Linux', os: 'Linux', status: 'online', busy: false,
    labels: [{ name: 'self-hosted' }, { name: 'Linux' }, { name: 'X64' }] };
  const withMini = (fields) => ({ total_count: 1, runners: [{ ...mini, ...fields }] });
  const rows = [
    // Fetch permits arbitrary error-response bodies: status must win even over parseable ready data.
    { name: 'http401', httpStatus: 401, expectedReason: 'denied' },
    { name: 'http403', httpStatus: 403, expectedReason: 'denied' },
    { name: 'http500', httpStatus: 500, expectedReason: 'http-error' },
    { name: 'network-rejection', networkError: true, expectedReason: 'network-error' },
    { name: 'body-rejection', bodyError: true, expectedReason: 'network-error' },
    { name: 'malformed-json', text: '{', expectedReason: 'malformed' },
    { name: 'malformed-utf8', rawBytes: new Uint8Array([0xff]), expectedReason: 'malformed' },
    { name: 'null-root', payload: null, expectedReason: 'malformed' },
    { name: 'runners-not-array', payload: { total_count: 1, runners: {} }, expectedReason: 'malformed' },
    { name: 'null-runner', payload: { total_count: 1, runners: [null] }, expectedReason: 'malformed' },
    { name: 'count-not-number', payload: { total_count: '1', runners: [mini] }, expectedReason: 'malformed' },
    { name: 'count-negative', payload: { total_count: -1, runners: [mini] }, expectedReason: 'malformed' },
    { name: 'count-not-integer', payload: { total_count: 1.5, runners: [mini] }, expectedReason: 'malformed' },
    { name: 'count-unsafe', payload: { total_count: Number.MAX_SAFE_INTEGER + 1, runners: [mini] }, expectedReason: 'malformed' },
    { name: 'count-mismatch', payload: { total_count: 2, runners: [mini] }, expectedReason: 'incomplete' },
    { name: 'page-overflow', payload: { total_count: 101, runners: [mini,
      ...Array.from({ length: 100 }, (_, index) => ({ ...other, id: 1000 + index }))] }, expectedReason: 'incomplete' },
    { name: 'next-page', headers: { link: '<https://api.github.com/repos/williacj/rigger/actions/runners?per_page=100&page=2>; rel="next"' },
      expectedReason: 'incomplete' },
    { name: 'body-length-mismatch', headers: { 'content-length': '1' }, expectedReason: 'incomplete' },
    { name: 'body-over-limit', payload: { total_count: 1, runners: [mini], padding: 'x'.repeat(2 * 1024 * 1024) },
      expectedReason: 'incomplete' },
    { name: 'empty-inventory', payload: { total_count: 0, runners: [] }, expectedReason: 'missing-id' },
    { name: 'missing-id', payload: { total_count: 1, runners: [other] }, expectedReason: 'missing-id' },
    ...['self-hosted', 'macOS', 'ARM64', 'rigger-ci'].map((label) => ({
      name: 'missing-label-' + label, payload: withMini({ labels: mini.labels.filter((entry) => entry.name !== label) }),
      expectedReason: 'missing-label',
    })),
    { name: 'wrong-name', payload: withMini({ name: 'Another-Mac' }), expectedReason: 'identity-mismatch' },
    { name: 'wrong-os', payload: withMini({ os: 'Linux' }), expectedReason: 'identity-mismatch' },
    { name: 'duplicate-mini-id', payload: { total_count: 2, runners: [mini, structuredClone(mini)] }, expectedReason: 'ambiguous' },
    { name: 'duplicate-unrelated-id', payload: { total_count: 3, runners: [mini, other, structuredClone(other)] },
      expectedReason: 'ambiguous' },
    { name: 'second-dedicated-label-owner', payload: { total_count: 2,
      runners: [mini, { ...other, labels: [{ name: 'self-hosted' }, { name: 'rigger-ci' }] }] }, expectedReason: 'ambiguous' },
    { name: 'unknown-status', payload: withMini({ status: 'unknown' }), expectedReason: 'malformed' },
    { name: 'nonboolean-busy', payload: withMini({ busy: 'false' }), expectedReason: 'malformed' },
    { name: 'unreadable-name', payload: withMini({ name: null }), expectedReason: 'malformed' },
    { name: 'unreadable-os', payload: withMini({ os: null }), expectedReason: 'malformed' },
    { name: 'labels-not-array', payload: withMini({ labels: {} }), expectedReason: 'malformed' },
    { name: 'unreadable-label-name', payload: { total_count: 2,
      runners: [mini, { ...other, labels: [{ name: false }] }] }, expectedReason: 'malformed' },
    { name: 'nonpositive-id', payload: withMini({ id: 0 }), expectedReason: 'malformed' },
    { name: 'unsafe-id', payload: withMini({ id: Number.MAX_SAFE_INTEGER + 1 }), expectedReason: 'malformed' },
    { name: 'nonnumeric-id', payload: withMini({ id: '23' }), expectedReason: 'malformed' },
    { name: 'valid-ready-control', payload: { total_count: 2, runners: [other, mini] },
      expectedRunner: '["self-hosted","macOS","ARM64","rigger-ci"]', expectedReason: 'auto-mini-ready' },
  ];
  for (const row of rows) {
    const payload = Object.hasOwn(row, 'payload') ? row.payload : { total_count: 1, runners: [mini] };
    const bytes = row.rawBytes ?? new TextEncoder().encode(Object.hasOwn(row, 'text') ? row.text : JSON.stringify(payload));
    const headers = { 'content-length': String(bytes.length), ...row.headers };
    const requests = [], deadlines = [];
    const signal = new AbortController().signal;
    let answer;
    // Deliberately malformed remote data is the subject; its fallback must resolve as a plan.
    await assert.doesNotReject(async () => {
      answer = await evaluateCiPolicy('runPolicy', { action: 'plan', facts, macosRunner: '"auto"' }, {
        token: 'fixture-runner-read',
        deadline: (milliseconds) => { deadlines.push(milliseconds); return signal; },
        // Response.ok/status/header/body methods follow the existing requestJson fetch collaborator.
        send: async (url, options) => {
          requests.push({ url, options });
          assert.equal(requests.length, 1, row.name + ': no retry or second page');
          if (row.networkError) throw new Error('transport-private fixture-runner-read');
          const status = row.httpStatus ?? 200;
          return { ok: status >= 200 && status < 300, status,
            headers: { get: (name) => headers[name.toLowerCase()] ?? null },
            arrayBuffer: async () => {
              if (row.bodyError) throw new Error('transport-private fixture-runner-read');
              return bytes.buffer;
            } };
        },
      });
    }, row.name + ': a failed read falls back instead of rejecting the plan');
    assert.equal(answer.output.runner, row.expectedRunner ?? '"macos-latest"', row.name);
    assert.equal(answer.output.runnerReason, row.expectedReason, row.name);
    assert.equal(requests.length, 1, row.name);
    assert.equal(requests[0].url, 'https://api.github.com/repos/williacj/rigger/actions/runners?per_page=100', row.name);
    assert.equal(requests[0].options.method, 'GET', row.name);
    assert.equal(requests[0].options.redirect, 'error', row.name);
    assert.equal(requests[0].options.headers.authorization, 'Bearer fixture-runner-read', row.name);
    assert.equal(requests[0].options.signal, signal, row.name);
    assert.deepEqual(deadlines, [30000], row.name);
    assert.equal(answer.ok, true, row.name);
    assert.equal(answer.output.mode, 'BROAD_EXECUTED', row.name);
    assert.equal(answer.output.demoNeeded, true, row.name);
    assert.equal(JSON.stringify(answer).includes('fixture-runner-read'), false, row.name);
    assert.equal(JSON.stringify(answer).includes('transport-private'), false, row.name);
  }
});

// Card 971 infrastructure diagnostic: one deadline signal covers the actual header and body reads.
test('Auto deadlines: aborted header and body reads retain one Hosted snapshot', async () => {
  const facts = await collected(fullFixture());
  assert.equal(facts.sameRepository, true);
  assert.deepEqual(await evaluateCiPolicy('policy', facts),
    { mode: 'BROAD_EXECUTED', demoNeeded: true, sourceValid: true });
  for (const row of [
    { name: 'header-timeout', stage: 'headers', expectedRunner: '"macos-latest"', expectedReason: 'timed-out' },
    { name: 'body-timeout', stage: 'body', expectedRunner: '"macos-latest"', expectedReason: 'timed-out' },
    { name: 'ready-before-deadline', stage: 'ready',
      expectedRunner: '["self-hosted","macOS","ARM64","rigger-ci"]', expectedReason: 'auto-mini-ready' },
  ]) {
    // Card 971 owns this literal ready identity; fetch abort rejects its promise and unread body
    // with the signal reason (WHATWG Fetch, #abort-fetch). A producer may finish after cancellation,
    // but this abort-respecting adapter never fulfils a previously rejected read with those bytes.
    const mini = { id: 23, name: 'CJs-Mac-mini', os: 'macOS', status: 'online', busy: false,
      labels: [{ name: 'self-hosted' }, { name: 'macOS' }, { name: 'ARM64' }, { name: 'rigger-ci' }] };
    const bytes = new TextEncoder().encode(JSON.stringify({ total_count: 1, runners: [mini] }));
    const requests = [], deadlines = [];
    const controller = new AbortController();
    let readReady, finishProducer, acknowledgeProducer;
    const readiness = new Promise((resolve) => { readReady = resolve; });
    const producerFinished = new Promise((resolve) => { acknowledgeProducer = resolve; });
    let producerCompletions = 0, bodyReads = 0, requestSignal;
    const pendingRead = (value, signal) => new Promise((resolve, reject) => {
      // AbortController's documented event/reason contract; no timer or sleeping fixture.
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      finishProducer = () => {
        producerCompletions += 1;
        resolve(value);
        acknowledgeProducer();
      };
      readReady();
    });
    const response = { ok: true, status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
      arrayBuffer: () => {
        bodyReads += 1;
        return row.stage === 'body' ? pendingRead(bytes.buffer, requestSignal) : Promise.resolve(bytes.buffer);
      } };
    const pendingPlan = evaluateCiPolicy('runPolicy', { action: 'plan', facts, macosRunner: '"auto"' }, {
      token: 'fixture-runner-read',
      deadline: (milliseconds) => { deadlines.push(milliseconds); return controller.signal; },
      send: (url, options) => {
        requests.push({ url, options });
        requestSignal = options.signal;
        return row.stage === 'headers' ? pendingRead(response, requestSignal) : Promise.resolve(response);
      },
    });
    if (row.stage !== 'ready') {
      await readiness;
      assert.equal(requests.length, 1, row.name + ': read readiness precedes the deadline');
      assert.equal(controller.signal.aborted, false, row.name);
      controller.abort(new DOMException('transport-private fixture-runner-read', 'TimeoutError'));
    }
    const answer = await pendingPlan;
    assert.equal(answer.output.runner, row.expectedRunner, row.name);
    assert.equal(answer.output.runnerReason, row.expectedReason, row.name + ': deadline has a distinct fixed reason');
    assert.equal(answer.ok, true, row.name);
    assert.equal(answer.output.mode, 'BROAD_EXECUTED', row.name);
    assert.equal(answer.output.demoNeeded, true, row.name);
    assert.equal(requests.length, 1, row.name);
    assert.equal(requests[0].url, 'https://api.github.com/repos/williacj/rigger/actions/runners?per_page=100', row.name);
    assert.equal(requests[0].options.method, 'GET', row.name);
    assert.equal(requests[0].options.redirect, 'error', row.name);
    assert.equal(requests[0].options.headers.authorization, 'Bearer fixture-runner-read', row.name);
    assert.equal(requests[0].options.signal, controller.signal, row.name);
    assert.deepEqual(deadlines, [30000], row.name);
    assert.equal(bodyReads, row.stage === 'headers' ? 0 : 1, row.name);
    const snapshot = JSON.stringify(answer.output);
    if (row.stage === 'ready') {
      mini.status = 'offline';
      mini.busy = true;
      controller.abort(new DOMException('transport-private fixture-runner-read', 'TimeoutError'));
    } else {
      // Deliver the late producer event through the collaborator actually passed to the selector.
      // Observe the real returned plan after producer completion, rather than asserting promise identity.
      finishProducer();
      await producerFinished;
      assert.equal(producerCompletions, 1, row.name);
    }
    assert.equal(JSON.stringify(answer.output), snapshot, row.name + ': later events cannot revise the plan snapshot');
    assert.equal(answer.output.runner, row.expectedRunner, row.name + ': selected pool is retained');
    assert.equal(answer.output.runnerReason, row.expectedReason, row.name + ': selected reason is retained');
    assert.equal(requests.length, 1, row.name + ': later events never cause another lookup');
    assert.deepEqual(deadlines, [30000], row.name);
    assert.equal(JSON.stringify(answer).includes('fixture-runner-read'), false, row.name);
    assert.equal(JSON.stringify(answer).includes('transport-private'), false, row.name);
  }
});

// Card 971 infrastructure diagnostic: excluded plans do not use the privileged runner-read transport.
test('Auto read admission: excluded plans never contact the runner endpoint', async () => {
  const trusted = await collected(fullFixture());
  const fork = await collected(fullFixture(99));
  const unknown = await collected(fullFixture(null));
  const invalid = { ...structuredClone(trusted), complete: false };
  const noMacFixture = fullFixture();
  noMacFixture.event.action = 'synchronize';
  noMacFixture.api['/repos/williacj/rigger/issues/7/labels?per_page=100'] = [];
  const noMac = await collected(noMacFixture);
  for (const row of [
    { name: 'fork-auto', facts: fork, value: '"auto"', expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'unknown-head-auto', facts: unknown, value: '"auto"', expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'fork-malformed', facts: fork, value: 'malformed', expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'unknown-head-malformed', facts: unknown, value: 'malformed', expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'invalid-source-auto', facts: invalid, value: '"auto"', expectedRunner: HOSTED,
      expectedMode: 'INVALID', expectedDemo: false, expectedSource: false },
    { name: 'no-mac-auto', facts: noMac, value: '"auto"', expectedRunner: HOSTED,
      expectedMode: 'BROAD_DEFERRED', expectedDemo: false, expectedSource: true },
    { name: 'unset', facts: trusted, value: undefined, expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'empty', facts: trusted, value: '', expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'explicit-hosted', facts: trusted, value: HOSTED, expectedRunner: HOSTED,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
    { name: 'explicit-mini', facts: trusted, value: MINI, expectedRunner: MINI,
      expectedMode: 'BROAD_EXECUTED', expectedDemo: true, expectedSource: true },
  ]) {
    assert.deepEqual(await evaluateCiPolicy('policy', row.facts),
      { mode: row.expectedMode, demoNeeded: row.expectedDemo, sourceValid: row.expectedSource }, row.name);
    // A complete documented fetch response lets an accidental call return normally, so a caught
    // throwing double cannot hide the forbidden privileged request from the counter assertion.
    const bytes = new TextEncoder().encode(JSON.stringify({ total_count: 1,
      runners: [{ id: 23, name: 'CJs-Mac-mini', os: 'macOS', status: 'online', busy: false,
        labels: [{ name: 'self-hosted' }, { name: 'macOS' }, { name: 'ARM64' }, { name: 'rigger-ci' }] }] }));
    const requests = [], deadlines = [];
    const signal = new AbortController().signal;
    const answer = await evaluateCiPolicy('runPolicy', { action: 'plan', facts: row.facts, macosRunner: row.value }, {
      token: 'fixture-runner-read',
      deadline: (milliseconds) => { deadlines.push(milliseconds); return signal; },
      send: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200,
          headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
          arrayBuffer: async () => bytes.buffer };
      },
    });
    assert.equal(requests.length, 0, row.name + ': no privileged runner read');
    assert.deepEqual(deadlines, [], row.name + ': no runner-read deadline');
    assert.equal(answer.ok, true, row.name);
    assert.equal(answer.output.runner, row.expectedRunner, row.name);
    assert.equal(answer.output.runnerReason, undefined, row.name);
    assert.equal(answer.output.mode, row.expectedMode, row.name);
    assert.equal(answer.output.demoNeeded, row.expectedDemo, row.name);
    if (!row.expectedSource) {
      assert.equal(answer.output.sha, '', row.name);
      assert.equal(answer.output.tree, '', row.name);
      assert.equal(answer.output.snapshot, '', row.name);
    }
    assert.equal(JSON.stringify(answer).includes('fixture-runner-read'), false, row.name);
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

// Card 971 infrastructure diagnostic: only the plan selection step receives the dedicated runner-read secret.
test('Auto credential wiring: only plan selection receives the dedicated runner secret', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const selection = ci.jobs.plan.steps.find((step) => step.id === 'policy');
  assert.ok(selection, 'the actual plan policy step exists before inspecting credential propagation');
  // Independent literals follow card 971's dedicated-secret and unchanged ordinary-token contract.
  assert.equal(selection.env.CI_RUNNER_READ_TOKEN, '${{ secrets.CI_RUNNER_READ_TOKEN }}',
    'plan selection receives the dedicated runner-read secret under its own name');
  assert.equal(selection.env.GH_TOKEN, '${{ github.token }}', 'source collection keeps the ordinary token');
  assert.deepEqual(ci.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(Object.hasOwn(ci.env ?? {}, 'CI_RUNNER_READ_TOKEN'), false, 'no workflow-wide runner credential');
  const declarations = [];
  for (const [name, job] of Object.entries(ci.jobs)) {
    assert.equal(Object.hasOwn(job.env ?? {}, 'CI_RUNNER_READ_TOKEN'), false, name + ': no job-wide runner credential');
    for (const step of job.steps ?? []) {
      if (name === 'plan' && step === selection) {
        declarations.push({ job: name, step: step.id });
      } else {
        assert.equal(Object.hasOwn(step.env ?? {}, 'CI_RUNNER_READ_TOKEN'), false,
          name + ':' + (step.id ?? step.name ?? step.run ?? step.uses) + ': no runner credential outside selection');
      }
    }
  }
  assert.deepEqual(declarations, [{ job: 'plan', step: 'policy' }]);
});

// Card 971 infrastructure diagnostic: the plan job exposes the reason its actual selection step already emits.
test('Auto reason wiring: plan publishes the selected runner reason', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(ci.jobs.plan.outputs.runnerReason, '${{ steps.policy.outputs.runnerReason }}',
    'the plan job forwards the existing selection reason without another writer');
});

test('runner wiring supplies exactly the four macOS jobs from the one plan output', () => {
  const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(ci.jobs.plan.outputs.runner, '${{ steps.policy.outputs.runner }}');
  assert.equal(ci.jobs.plan.steps.find((step) => step.id === 'policy').env.CI_MACOS_RUNNER, '${{ vars.MACOS_RUNNER }}');
  assert.deepEqual(Object.entries(ci.jobs).filter(([, job]) => job['runs-on'] === '${{ fromJSON(needs.plan.outputs.runner) }}').map(([name]) => name).sort(), ['demo', 'full_host', 'full_ordinary', 'nightly']);
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
  assert.deepEqual(ci.jobs.nightly['runs-on'], '${{ fromJSON(needs.plan.outputs.runner) }}');
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
