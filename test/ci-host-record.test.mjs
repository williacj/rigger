// ABOUTME: Drives the workflow's actual scheduled host writer with independent Issues responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { ci, hostInvocationCommand, hostRecordInput, observeHostRecord, observeIssueTransport, publicationInvocation, reportInvocation, captureHostScenario, observeHostStep, observeWorkerTransport, observeRuntimeRecordInput, hostIssueStore, hostOutputFields } from './ci-host-fixtures.mjs';

// Break: no matching open labelled issue must create exactly one issue carrying the complete record.
test('no matching open issue creates a body record once', async () => {
  const requests = [];
  const result = await observeHostRecord(hostRecordInput(), async (path, options = {}) => {
    requests.push([path, options]);
    if (!options.method) return { status: 200, body: [], link: null };
    return { status: 201, body: { number: 71, html_url: 'https://github.com/williacj/rigger/issues/71' } };
  });
  assert.equal(result.state, 'created', 'the actual workflow must create the missing host record');
  assert.equal(requests.length, 2);
  assert.equal(requests[0][0], '/repos/williacj/rigger/issues?state=open&labels=host-tier&per_page=100');
  assert.equal(requests[1][0], '/repos/williacj/rigger/issues');
  assert.equal(requests[1][1].method, 'POST');
  assert.equal(requests[1][1].body.title, 'Host tier: t4-fixture-macos-arm64-node26');
  assert.deepEqual(requests[1][1].body.labels, ['host-tier']);
  assert.ok(requests[1][1].body.body.includes('https://github.com/williacj/rigger/actions/runs/123'));
  assert.ok(requests[1][1].body.body.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  assert.ok(requests[1][1].body.body.includes('["A & B","line\\nvalue","A & B"]'));
  assert.equal(result.issue, 71);
});

// Break: a host or later job failure must not grant a non-scheduled or unverified writer.
test('recording ignores non-scheduled non-current and successful or unstarted host routes', async () => {
  const cases = [
    { event: 'workflow_dispatch' }, { event: 'push' }, { event: 'pull_request' }, { event: 'merge_group' },
    { ref: 'refs/heads/topic' }, { eligible: 'false' }, { host_outcome: 'success', host_exit_code: '0' },
    { host_invoked: 'false', host_outcome: '' },
  ];
  for (const change of cases) {
    const requests = [];
    const result = await observeHostRecord({ ...hostRecordInput(), ...change }, async path => {
      requests.push(path);
      return path.includes('?') ? { status: 200, body: [] } : { status: 201, body: { number: 71 } };
    });
    assert.equal(requests.length, 0, JSON.stringify(change));
    assert.equal(result.state, 'skipped');
  }
  assert.equal(ci.jobs['host-record'].if, "${{ always() && github.event_name == 'schedule' && needs.nightly.result == 'failure' }}");
});

// REST issue list/read/comments doubles retain raw body fields; titles and labels are literal independent premises.
test('one exact open labelled issue receives a distinct record and closed matches do not', async () => {
  const key = 'Host tier: t4-fixture-macos-arm64-node26';
  const issue = { number: 71, title: key, state: 'open', labels: [{ name: 'host-tier' }], body: 'Existing record', comments: 0 };
  for (const matches of [[issue], [{ ...issue, state: 'closed' }]]) {
    const requests = [];
    const result = await observeHostRecord(hostRecordInput(), async (path, options = {}) => {
      requests.push([path, options]);
      if (path.includes('?state=open')) return { status: 200, body: [...matches, { ...issue, number: 72, title: key + ' other' }, { ...issue, number: 73, labels: [] }, { ...issue, number: 74, pull_request: {} }] };
      if (!options.method) return { status: 200, body: path.endsWith('/comments?per_page=100') ? [] : issue };
      return { status: 201, body: path.endsWith('/comments') ? { id: 901, html_url: 'https://github.com/williacj/rigger/issues/71#issuecomment-901' } : { number: 75, html_url: 'https://github.com/williacj/rigger/issues/75' } };
    });
    const posts = requests.filter(([, options]) => options.method === 'POST');
    assert.equal(posts.length, 1);
    if (matches[0].state === 'open') {
      assert.equal(result.state, 'commented', 'an exact existing issue receives the record');
      assert.equal(posts[0][0], '/repos/williacj/rigger/issues/71/comments');
      assert.deepEqual(requests.slice(1, 3).map(([path]) => path), ['/repos/williacj/rigger/issues/71', '/repos/williacj/rigger/issues/71/comments?per_page=100']);
      assert.ok(posts[0][1].body.body.includes('["A & B","line\\nvalue","A & B"]'));
    } else {
      assert.equal(result.state, 'created');
      assert.equal(posts[0][0], '/repos/williacj/rigger/issues');
    }
  }
});

// Break: selecting an arbitrary duplicate loses a host record's store identity.
test('duplicate matches fail with every issue identifier before any mutation', async t => {
  for (const numbers of [[71, 72], [71, 72, 73]]) {
    const posts = [];
    await assert.rejects(observeHostRecord(hostRecordInput(), async (path, options = {}) => {
      if (options.method) { posts.push(path); t.diagnostic(JSON.stringify({ fixture: 'duplicate-write-observation', path, method: options.method })); }
      return { status: options.method ? 201 : 200, body: path.includes('?state=open')
        ? numbers.map(number => ({ number, title: 'Host tier: t4-fixture-macos-arm64-node26', state: 'open', labels: [{ name: 'host-tier' }] }))
        : path.includes('/comments?') ? [] : { number: 71, id: 901, title: 'Host tier: t4-fixture-macos-arm64-node26', state: 'open', labels: [{ name: 'host-tier' }], body: '', comments: 0 } };
    }), error => {
      assert.match(error.message, /duplicate/i);
      for (const number of numbers) assert.ok(error.message.includes(String(number)));
      return true;
    });
    assert.deepEqual(posts, [], 'duplicate lookup must not mutate an arbitrary issue');
  }
});

// Break: a partial or failed list is never evidence that the store is empty.
test('incomplete or failed issue lookup refuses every mutation with a lookup diagnostic', async t => {
  for (const reply of [
    { status: 500, body: [] }, { status: 200, body: [], link: '<https://api.github.com/next>; rel="next"' },
    { status: 200, body: undefined }, { status: 200, body: {} }, { status: 200, body: [null] },
    { status: 200, body: [{ number: 71, state: 'open', title: 'Host tier: t4-fixture-macos-arm64-node26' }] },
    new Error('controlled disconnected lookup'),
  ]) {
    const posts = [];
    await assert.rejects(observeHostRecord(hostRecordInput(), async (path, options = {}) => {
      if (options.method) { posts.push(path); t.diagnostic(JSON.stringify({ fixture: 'lookup-fault-write', cause: reply instanceof Error ? 'transport' : reply.link ? 'paginated' : 'other', path, method: options.method })); return { status: 201, body: { number: 71 } }; }
      if (reply instanceof Error) throw reply;
      return reply;
    }), /lookup/i);
    assert.deepEqual(posts, [], 'failed lookup must not continue to a create or comment');
  }
  const store = hostIssueStore(), calls = [];
  let failed = false;
  const request = async (path, options = {}) => {
    calls.push([path, options.method ?? 'GET']);
    if (!failed) { failed = true; return { status: 503, body: [] }; }
    return store.request(path, options);
  };
  await assert.rejects(observeHostRecord(hostRecordInput(), request), /lookup/i);
  assert.equal((await observeHostRecord(hostRecordInput(), request)).state, 'created', 'a later admitted attempt must perform its own fresh lookup');
  assert.deepEqual(calls.map(([path, method]) => [path.replace('/repos/williacj/rigger', ''), method]), [
    ['/issues?state=open&labels=host-tier&per_page=100', 'GET'],
    ['/issues?state=open&labels=host-tier&per_page=100', 'GET'], ['/issues', 'POST'],
  ]);

});

// Break: unavailable startup keys cannot be replaced by metadata or a guessed title.
test('eligible failure with missing key fails before lookup without guessing', async () => {
  for (const key of ['""', 'null', '', undefined, '{']) {
    const requests = [];
    await assert.rejects(observeHostRecord({ ...hostRecordInput(), host_key: key }, async (path, options = {}) => {
      requests.push(path);
      return { status: options.method ? 201 : 200, body: options.method ? { number: 71 } : [] };
    }), /missing host key/i);
    assert.deepEqual(requests, []);
  }
});

// Break: an unsuccessful or uncertain creation cannot be reported as a completed record or retried blindly.
test('creation failure identifies create and never continues or blindly replays', async () => {
  for (const failure of [{ status: 403, body: {} }, { status: 422, body: {} }, new Error('lost response')]) {
    const posts = [];
    await assert.rejects(observeHostRecord(hostRecordInput(), async (path, options = {}) => {
      if (!options.method) return { status: 200, body: [] };
      posts.push(path);
      if (failure instanceof Error) throw failure;
      return failure;
    }), /create/i);
    assert.deepEqual(posts, ['/repos/williacj/rigger/issues']);
  }
});

// AC13's authored sequence: A creates; distinct B's comment fails; replay A must not duplicate its body record.
test('distinct comment failure preserves the created body and replay suppresses duplicate records', async () => {
  let issue;
  const posts = [];
  const request = async (path, options = {}) => {
    if (!options.method) return { status: 200, body: path.includes('?state=open') ? (issue ? [issue] : []) : path.includes('/comments?') ? [] : issue };
    posts.push([path, options.body]);
    if (path.endsWith('/comments')) return { status: 503, body: {} };
    issue = { number: 71, title: options.body.title, labels: [{ name: 'host-tier' }], state: 'open', body: options.body.body, comments: 0 };
    return { status: 201, body: { number: 71, html_url: 'https://github.com/williacj/rigger/issues/71' } };
  };
  assert.equal((await observeHostRecord(hostRecordInput(), request)).state, 'created');
  const firstBody = issue.body;
  const second = { ...hostRecordInput(), runId: 124, invocation: '{"repository":"williacj/rigger","runId":124,"runAttempt":1,"job":"nightly"}' };
  await assert.rejects(observeHostRecord(second, request), /(?:71.*comment|comment.*71)/i);
  assert.equal(issue.body, firstBody);
  assert.equal(posts.length, 2);
  assert.ok(posts[1][1].body.includes('/runs/124'));
  assert.equal(posts[1][1].body.includes('/runs/123'), false);
  assert.equal((await observeHostRecord(hostRecordInput(), request)).state, 'already-recorded');
  assert.equal(posts.length, 2, 'A replay must not append its persisted body as a comment');
});

// Independent report-state literals: unusable XML changes the record description, never its scheduled-failure trigger.
test('scheduled verified host failure records zero absent and unparsable report states', async () => {
  for (const row of [
    { report_state: 'valid', names_state: 'available', failed_names: '[]', text: 'Host step failed without a reported test failure.' },
    { report_state: 'absent', names_state: 'unavailable', failed_names: 'null', text: 'JUnit report is absent; failed-test names are unavailable.' },
    { report_state: 'unparsable', names_state: 'unavailable', failed_names: 'null', text: 'JUnit report is unparsable; failed-test names are unavailable.' },
  ]) {
    const posts = [];
    const result = await observeHostRecord({ ...hostRecordInput(), ...row }, async (path, options = {}) => {
      if (!options.method) return { status: 200, body: [] };
      posts.push(options.body);
      return { status: 201, body: { number: 71 } };
    });
    assert.equal(result.state, 'created');
    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.includes(row.text), row.report_state);
    assert.ok(posts[0].body.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    assert.ok(posts[0].body.includes('t4-fixture-macos-arm64-node26'));
  }
});

// Break: missing/redacted or malformed job outputs cannot silently become an empty failure record.
test('missing malformed and redacted transport fails before every issue request', async () => {
  const cases = [
    { eligible: undefined }, { host_invoked: '' }, { host_outcome: '' }, { host_exit_code: '0' },
    { source: '' }, { source: '{}' }, { source: hostRecordInput().source.replace('"schedule"', '"workflow_dispatch"') },
    { invocation: '' }, { invocation: '{}' }, { runAttempt: 2 },
    { report_state: '' }, { names_state: '' }, { names_state: 'unavailable:output-size' },
    { failed_names: '' }, { failed_names: 'null' }, { failed_names: '{}' }, { failed_names: '[4]' },
    { report_state: 'absent', names_state: 'available' }, { repository: 'someone/else' },
  ];
  for (const change of cases) {
    const requests = [];
    await assert.rejects(observeHostRecord({ ...hostRecordInput(), ...change }, async (path, options = {}) => {
      requests.push(path);
      return { status: options.method ? 201 : 200, body: options.method ? { number: 71 } : [] };
    }), /transport/i, JSON.stringify(change));
    assert.deepEqual(requests, [], JSON.stringify(change));
  }
});

// Break: replay suppression requires complete raw body/comment identity lookup, including after a body match.
test('identity lookup refuses malformed or incomplete originals before replay or comment', async () => {
  const marker = '<!-- t4-host-invocation {"repository":"williacj/rigger","runId":123,"runAttempt":1,"job":"nightly"} -->';
  const original = { number: 71, title: 'Host tier: t4-fixture-macos-arm64-node26', labels: [{ name: 'host-tier' }], state: 'open', body: marker, comments: 0 };
  for (const row of [
    { detail: original, comments: undefined }, { detail: { ...original, body: undefined }, comments: [] },
    { detail: { ...original, comments: 1 }, comments: [] }, { detail: original, comments: [null] },
    { detail: { ...original, body: '<!-- t4-host-invocation {bad} -->' }, comments: [] },
    { detail: { ...original, body: '<!-- t4-host-invocation {' }, comments: [] },
    { detail: { ...original, comments: 1 }, comments: [{ id: 901, body: '<!-- t4-host-invocation {} -->' }] },
  ]) {
    const posts = [];
    await assert.rejects(observeHostRecord(hostRecordInput(), async (path, options = {}) => {
      if (options.method) { posts.push(path); return { status: 201, body: { id: 901 } }; }
      return { status: 200, body: path.includes('?state=open') ? [original] : path.includes('/comments?') ? row.comments : row.detail };
    }), /lookup/i);
    assert.deepEqual(posts, []);
  }
  const posts = [];
  const result = await observeHostRecord(hostRecordInput(), async (path, options = {}) => {
    if (options.method) posts.push(path);
    return { status: 200, body: path.includes('?state=open') ? [original] : path.includes('/comments?') ? [{ id: 901, body: marker }] : { ...original, body: 'Existing record', comments: 1 } };
  });
  assert.equal(result.state, 'already-recorded');
  assert.deepEqual(posts, []);
});

// Service admission is the declared fixed store group; the two admitted orders drive the actual writer, not a scheduler copy.
test('both admitted writer orders fresh-read one store and preserve two distinct invocation records', async () => {
  assert.deepEqual(ci.jobs['host-record'].concurrency, { group: 'ci-host-record', 'cancel-in-progress': 'false', queue: 'max' });
  assert.deepEqual(ci.jobs['host-record'].permissions, { issues: 'write' });
  assert.equal(ci.concurrency, undefined);
  for (const [name, job] of Object.entries(ci.jobs)) if (name !== 'host-record') assert.equal(job.concurrency, undefined);
  assert.equal(ci.jobs['host-record'].steps.some(step => /checkout|download-artifact/.test(step.uses ?? '')), false);
  for (const order of [[123, 124], [124, 123]]) for (const existing of [false, true]) {
    const initial = existing ? { number: 71, title: 'Host tier: t4-fixture-macos-arm64-node26', state: 'open', labels: [{ name: 'host-tier' }], body: 'Earlier host record', comments: 0 } : undefined;
    const store = hostIssueStore(initial);
    const inputs = order.map(runId => ({ ...hostRecordInput(), runId, invocation: '{"repository":"williacj/rigger","runId":' + runId + ',"runAttempt":1,"job":"nightly"}' }));
    assert.equal((await observeHostRecord(inputs[0], store.request)).state, existing ? 'commented' : 'created');
    assert.equal((await observeHostRecord(inputs[1], store.request)).state, 'commented');
    if (existing) {
      assert.equal(store.issue.body, 'Earlier host record');
      assert.ok(store.comments[0].body.includes('/runs/' + order[0]));
      assert.ok(store.comments[1].body.includes('/runs/' + order[1]));
    } else {
      assert.ok(store.issue.body.includes('/runs/' + order[0]));
      assert.ok(store.comments[0].body.includes('/runs/' + order[1]));
    }
    assert.equal(store.comments.length, existing ? 2 : 1);
    const first = existing ? [
      ['/issues?state=open&labels=host-tier&per_page=100', 'GET'], ['/issues/71', 'GET'],
      ['/issues/71/comments?per_page=100', 'GET'], ['/issues/71/comments', 'POST'],
    ] : [['/issues?state=open&labels=host-tier&per_page=100', 'GET'], ['/issues', 'POST']];
    assert.deepEqual(store.requests.map(([path, options]) => [path.replace('/repos/williacj/rigger', ''), options.method ?? 'GET']), [...first,
      ['/issues?state=open&labels=host-tier&per_page=100', 'GET'], ['/issues/71', 'GET'],
      ['/issues/71/comments?per_page=100', 'GET'], ['/issues/71/comments', 'POST'],
    ]);
    assert.equal((await observeHostRecord(inputs[0], store.request)).state, 'already-recorded');
    assert.equal(store.comments.length, existing ? 2 : 1, 'restart cannot duplicate a persisted body or comment');
  }
});

// Fetch's Response and AbortSignal contracts are native collaborators, with no process, network or timer.
test('actual Issues HTTP transport authenticates scoped complete JSON without logging the token', async () => {
  const calls = [], logs = [];
  const signal = new AbortController().signal;
  const result = await observeIssueTransport('/repos/williacj/rigger-ci-fixture/issues', {
    method: 'POST', body: { title: 'Host tier: literal', body: 'T4 proof' }, token: 'fixture-token', signal,
    log: value => logs.push(value),
    send: async (url, options) => {
      calls.push([url, options]);
      return new Response('{"number":71}', { status: 201, headers: { 'content-length': '13' } });
    },
  });
  assert.equal(result.status, 201, 'the actual writer must expose the completed API response');
  assert.deepEqual(result.body, { number: 71 });
  assert.equal(calls[0][0], 'https://api.github.com/repos/williacj/rigger-ci-fixture/issues');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].headers.authorization, 'Bearer fixture-token');
  assert.equal(calls[0][1].headers.accept, 'application/vnd.github.raw+json');
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][1].body, '{"title":"Host tier: literal","body":"T4 proof"}');
  assert.equal(JSON.stringify(logs).includes('fixture-token'), false);
  assert.equal(logs[0].status, 201);
});

// A complete arrayBuffer is still not faithful when the declared identity-encoding length disagrees.
test('actual Issues transport rejects truncated invalid UTF8 malformed JSON and redirected responses', async () => {
  const options = { token: 'fixture-token', signal: new AbortController().signal, log: () => {} };
  await assert.rejects(observeIssueTransport('/repos/williacj/rigger/issues?state=open&labels=host-tier&per_page=100', {
    ...options, send: async () => new Response('[]', { status: 200, headers: { 'content-length': '4' } }),
  }), /incomplete/i);
  for (const bytes of [new Uint8Array([0xff]), '{"incomplete":']) {
    await assert.rejects(observeIssueTransport('/repos/williacj/rigger/issues?state=open&labels=host-tier&per_page=100', {
      ...options, send: async () => new Response(bytes, { status: 200 }),
    }));
  }
  await assert.rejects(observeIssueTransport('/repos/williacj/rigger/issues?state=open&labels=host-tier&per_page=100', {
    ...options, send: async () => ({ status: 200, redirected: true, url: 'https://elsewhere.test/', headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode('[]').buffer }),
  }), /redirect/i);
  const calls = [];
  for (const path of ['https://elsewhere.test/', '/repos/someone/else/issues']) {
    await assert.rejects(observeIssueTransport(path, { ...options, send: async url => calls.push(url) }), /scope/i);
  }
  assert.deepEqual(calls, []);
  const paginated = await observeIssueTransport('/repos/williacj/rigger/issues?state=open&labels=host-tier&per_page=100', {
    ...options, send: async () => new Response('[]', { status: 200, headers: { link: '<https://api.github.com/next>; rel="next"' } }),
  });
  assert.equal(paginated.link, '<https://api.github.com/next>; rel="next"', 'writer must receive incompleteness metadata');
});

// The expected ten-field map is the independently frozen complete selected-output schema, not the production estimator.
test('complete producer transport preserves every selected field and decoded names', async () => {
  const xml = '<testsuites><testcase name="A &amp; B"><failure/></testcase><testcase name="line&#10;value"><failure/></testcase><testcase name="A &amp; B"><error/></testcase></testsuites>';
  const { observed, outputWrites } = await publicationInvocation(Buffer.from(xml), { exitCode: 1 });
  const fields = hostOutputFields(outputWrites);
  const input = hostRecordInput();
  const expected = Object.fromEntries(['host_outcome', 'host_exit_code', 'host_invoked', 'host_key', 'report_state', 'names_state', 'failed_names', 'source', 'invocation', 'eligible'].map(key => [key, input[key]]));
  assert.deepEqual(fields, expected, 'every selected job field must be published without losing decoded LF or duplicates');
  assert.equal(observed.reporting.state, 'valid');
  assert.equal(observed.transport.state, 'available');
  assert.deepEqual(observed.reporting.failedNames, ['A & B', 'line\nvalue', 'A & B']);
});

// Independent literal full-map framing was frozen before this body:580 UTF16 code units with an empty failed name.
test('complete output budget counts every field and accepts equality without truncation', async () => {
  const fixed = "host_outcome=failure\nhost_exit_code=1\nhost_invoked=true\nhost_key=\"t4-fixture-macos-arm64-node26\"\nreport_state=valid\nnames_state=available\nfailed_names=[\"\"]\nsource={\"event\":\"schedule\",\"ref\":\"refs/heads/main\",\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"tree\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"parents\":[\"cccccccccccccccccccccccccccccccccccccccc\"],\"head\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"base\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"baseRef\":\"main\"}\ninvocation={\"repository\":\"williacj/rigger\",\"runId\":123,\"runAttempt\":1,\"job\":\"nightly\"}\neligible=true\n";
  assert.equal(fixed.length, 580);
  assert.equal(Buffer.byteLength(fixed, 'utf16le'), 1160);
  for (const row of [
    { length: 500000, estimate: 1001160, state: 'unavailable' },
    { length: 499420, estimate: 1000000, state: 'available' },
    { length: 499421, estimate: 1000002, state: 'unavailable' },
  ]) {
    const name = 'x'.repeat(row.length);
    const literal = fixed.replace('failed_names=[""]', 'failed_names=["' + name + '"]');
    assert.equal(Buffer.byteLength(literal, 'utf16le'), row.estimate, 'independent complete literal establishes the budget premise');
    const xml = '<testsuites><testcase name="' + name + '"><failure/></testcase></testsuites>';
    const { observed, outputWrites, summaryWrites } = await publicationInvocation(Buffer.from(xml), { exitCode: 1 });
    assert.equal(observed.transport.state, row.state, 'complete mapped outputs exceeding the budget must be explicitly unavailable');
    assert.equal(observed.transport.estimate, row.estimate);
    assert.equal(observed.reporting.state, 'valid');
    assert.deepEqual(observed.reporting.failedNames, [name], 'budget refusal does not corrupt XML truth or retain partial names');
    assert.equal(observed.host.outcome, 'failure');
    assert.ok(summaryWrites.every(([, bytes]) => Buffer.byteLength(bytes) < 1048576));
    const fields = hostOutputFields(outputWrites);
    assert.equal(fields.report_state, 'valid');
    assert.equal(fields.names_state, row.state === 'available' ? 'available' : 'unavailable:output-size');
    assert.equal(fields.failed_names, row.state === 'available' ? '["' + name + '"]' : 'null');
    assert.equal(observed.message, row.state === 'available' ? undefined : 'Host job outputs exceed 1000000 estimated UTF-16 bytes');
  }
});

// These two independent literal sizes distinguish a summary refusal from a complete-output refusal.
test('summary and output limits preserve their distinct failure causes and valid report truth', async () => {
  const unicode = '\u0800'.repeat(350000);
  const xml = '<testsuites><testcase name="' + unicode + '"><failure/></testcase></testsuites>';
  const published = await publicationInvocation(Buffer.from(xml), { exitCode: 1 });
  assert.equal(published.observed.transport.estimate, 701160);
  assert.equal(published.observed.transport.state, 'available');
  assert.equal(published.observed.message, 'Host summary exceeds 1048576 UTF-8 bytes');
  assert.equal(published.observed.reporting.state, 'valid');
  assert.deepEqual(published.observed.reporting.failedNames, [unicode]);
  assert.deepEqual(published.summaryWrites, []);
  const oneOver = 'x'.repeat(1048534);
  const summary = '## Failed host tests\n\n```json\n[\n  "' + oneOver + '"\n]\n```\n';
  assert.equal(Buffer.byteLength(summary), 1048577);
  const report = await reportInvocation(Buffer.from('<testsuites><testcase name="' + oneOver + '"><failure/></testcase></testsuites>'), { exitCode: 1 });
  assert.equal(report.observed.message, 'Host summary exceeds 1048576 UTF-8 bytes');
  assert.equal(report.observed.reporting.state, 'valid');
  assert.deepEqual(report.summaryWrites, []);
});

// Break: later report/publication errors cannot erase the saved invocation's native truth or separate byte originals.
test('producer retains direct native outcome and separate complete invocation and report originals', async () => {
  const stdout = Buffer.from('t4-fixture-macos-arm64-node26\nworker stdout\n');
  const stderr = Buffer.from('separate stderr\n');
  const report = Buffer.from('<testsuites><testcase name="pass"/></testsuites>');
  const { observed, originals } = await publicationInvocation(report, {
    child: { pid: 4321, exitCode: 0, signal: null, stdout, stderr, stdoutCapture: { state: 'complete' } },
  });
  const files = new Map(originals);
  assert.deepEqual(files.get('/runner-temp/host-report-evidence/host.stdout'), stdout, 'complete stdout is retained from command start');
  assert.deepEqual(files.get('/runner-temp/host-report-evidence/host.stderr'), stderr);
  assert.deepEqual(files.get('/runner-temp/host-report-evidence/host.junit.xml'), report);
  const native = JSON.parse(files.get('/runner-temp/host-report-evidence/host-native.json'));
  assert.equal(native.pid, 4321);
  assert.equal(native.exitCode, 0);
  assert.equal(native.signal, null);
  assert.deepEqual(native.stdoutCapture, { state: 'complete' });
  assert.equal(observed.host.outcome, 'success');
});

// Break: the actual child PID must be recorded at start, before output/termination, rather than invented after capture.
test('actual collector records its selected child PID and argv before producer output', async () => {
  let produced = false;
  const starts = [];
  const { result } = await captureHostScenario({
    childPid: 4321, stdout: new PassThrough(), stderr: new PassThrough(),
    onStart: info => { assert.equal(produced, false); starts.push(info); },
    produce: child => {
      produced = true;
      const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
      child.stdout.end(Buffer.from('literal parent key\n')); child.stderr.end();
      closed.then(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
    },
  });
  assert.equal(starts.length, 1, 'selected child start must be observed before it produces output');
  assert.equal(starts[0].pid, 4321);
  assert.deepEqual(starts[0].argv, ['bash', '-e', process.argv[1]]);
  assert.equal(result.pid, 4321);
});

// Break: status-output failure can happen before parsing, so the JUnit original must already be retained.
test('reporting channel failure retains native truth and report original before any publication', async () => {
  const originals = [];
  const report = Buffer.from('<testsuites><testcase name="pass"/></testsuites>');
  await assert.rejects(observeHostStep({
    publish: true, startup: { stdoutPrefix: '', capture: { state: 'complete' } },
    runnerEnvironment: { RUNNER_TEMP: '/runner-temp', CI_HOST_REPORT_NAME: 'host-tests.junit.xml', GITHUB_OUTPUT: '/step-output', GITHUB_STEP_SUMMARY: '/step-summary' },
    execute: async () => ({ pid: 4321, exitCode: 0, signal: null, stdout: Buffer.from('literal key\n'), stderr: Buffer.from('separate stderr') }),
    read: async () => report,
    save: async (path, bytes) => originals.push([path, Buffer.from(bytes)]),
    append: async () => { throw new Error('controlled output publication failure'); },
  }), /controlled output publication failure/);
  const files = new Map(originals);
  assert.equal(JSON.parse(files.get('/runner-temp/host-report-evidence/host-native.json')).exitCode, 0);
  assert.deepEqual(files.get('/runner-temp/host-report-evidence/host.junit.xml'), report, 'later output failure cannot prevent retention of the produced report');
  assert.deepEqual(files.get('/runner-temp/host-report-evidence/host.stdout'), Buffer.from('literal key\n'));
});

// Break: a valid report cannot earn an artifact binding when the qualified startup key is unavailable.
test('unavailable startup key fails artifact reporting without changing saved host success', async () => {
  for (const options of [
    { stdout: '' }, { stdout: 'partial key' },
    { startup: { stdoutPrefix: '', capture: { state: 'incomplete', reason: 'truncated' } } },
  ]) {
    const { observed } = await publicationInvocation(Buffer.from('<testsuites/>'), options);
    assert.equal(observed.host.outcome, 'success');
    assert.equal(observed.reporting.state, 'valid');
    assert.equal(observed.stepOutcome, 'failure', 'artifact reporting requires the exact available startup key');
    assert.equal(observed.message, 'Missing host key for host JUnit artifact');
    assert.equal(observed.transport.fields.host_key, 'null');
  }
});

// Wiring and actual formatter use the existing verified worker result; the issues-only consumer performs no second source read.
test('both actual host jobs bind JUnit artifacts and all ten outputs to their verified invocation', async () => {
  const names = ['host_outcome', 'host_exit_code', 'host_invoked', 'host_key', 'report_state', 'names_state', 'failed_names', 'source', 'invocation', 'eligible'];
  for (const name of ['full_host', 'nightly']) {
    const job = ci.jobs[name], host = job.steps.find(step => step.id === 'host_tests');
    const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v7' && step.with.name.startsWith('host-junit-'));
    assert.ok(upload, name + ' must upload that invocation JUnit with its exact printed host key');
    assert.equal(host.id, 'host_tests');
    assert.equal(host.env.CI_HOST_SOURCE, '${{ steps.host_source.outputs.host_source }}');
    assert.equal(host.env.CI_HOST_ELIGIBLE, '${{ steps.host_source.outputs.host_eligible }}');
    assert.equal(host.env.CI_HOST_REPORT_NAME, 'host-tests.junit.xml');
    assert.equal(host.run, hostInvocationCommand);
    assert.equal(Object.hasOwn(host.env, 'NODE_OPTIONS'), false);
    assert.equal(host.shell, "node --input-type=module -e \"await import('data:text/javascript;base64,' + Buffer.from(process.env.CI_HOST).toString('base64'))\" {0}");
    const source = job.steps.find(step => step.id === 'host_source');
    assert.equal(source.env.CI_POLICY_ACTION, 'worker');
    assert.equal(source.env.CI_WORKER, '${{ github.job }}');
    assert.ok(job.steps.indexOf(source) < job.steps.findIndex(step => step.run === 'npm ci'));
    assert.ok(job.steps.findIndex(step => step.run === 'npm ci') < job.steps.indexOf(host));
    assert.equal(upload.with.name, 'host-junit-${{ fromJSON(steps.host_tests.outputs.host_key) }}');
    assert.equal(upload.with.path, '${{ runner.temp }}/host-tests.junit.xml');
    assert.equal(upload.with['if-no-files-found'], 'error');
    assert.equal(upload.if, "${{ always() && steps.host_tests.outputs.report_state == 'valid' && steps.host_tests.outputs.host_key != 'null' && steps.host_tests.outputs.host_key != '' }}");
    assert.deepEqual(Object.keys(job.outputs), names);
    for (const key of names) assert.equal(job.outputs[key], key === 'host_invoked'
      ? "${{ steps.host_tests.outcome != '' && steps.host_tests.outcome != 'skipped' }}"
      : '${{ steps.host_tests.outputs.' + key + ' }}');
    const originals = job.steps.find(step => step.uses === 'actions/upload-artifact@v7' && step.with.name.startsWith('host-invocation-'));
    assert.ok(originals, 'complete separate invocation originals must survive runner teardown');
    assert.equal(originals.with.path, '${{ runner.temp }}/host-report-evidence');
    assert.equal(originals.with['if-no-files-found'], 'error');
  }
  const source = JSON.parse(hostRecordInput().source);
  assert.deepEqual(await observeWorkerTransport({ ok: true, source }, 'nightly'), { host_source: JSON.stringify(source), host_eligible: 'true' });
  assert.deepEqual(await observeWorkerTransport({ ok: false, source }, 'nightly'), {});
  assert.deepEqual(await observeWorkerTransport({ ok: true, source: { ...source, event: 'workflow_dispatch' } }, 'nightly'), { host_source: JSON.stringify({ ...source, event: 'workflow_dispatch' }), host_eligible: 'false' });
  assert.deepEqual(await observeWorkerTransport({ ok: true, source }, 'full_host'), { host_source: JSON.stringify(source), host_eligible: 'false' });
});

// Context binds run/attempt/repository/event while the worker's exact tested-source output survives a later main advance.
test('issues-only runtime consumes verified transport and authentic workflow context without source rereads', async () => {
  const input = hostRecordInput();
  const env = { CI_RECORD_INPUT: JSON.stringify({ ...input, event: 'push', runId: 999 }),
    GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'williacj/rigger',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', GITHUB_JOB: 'host-record' };
  const actual = await observeRuntimeRecordInput(env);
  assert.equal(actual.event, 'schedule'); assert.equal(actual.runId, 123); assert.equal(actual.runAttempt, 1); assert.equal(actual.job, 'nightly');
  assert.equal(actual.source, input.source, 'later context SHA must not replace the source already verified by the host worker');
  const job = ci.jobs['host-record'];
  assert.deepEqual(job.needs, ['nightly']);
  assert.equal(job.if, "${{ always() && github.event_name == 'schedule' && needs.nightly.result == 'failure' }}");
  assert.deepEqual(job.permissions, { issues: 'write' });
  assert.equal(job.steps.at(-1).run, 'node --input-type=module -e "$CI_RECORD"');
  assert.equal(job.steps.at(-1).env.CI_RECORD_INPUT, '${{ toJSON(needs.nightly.outputs) }}');
  assert.equal(job.steps.at(-1).env.CI_RECORD_ACTION, 'run');
  const manual = await observeRuntimeRecordInput({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' });
  const requests = [];
  assert.equal((await observeHostRecord(manual, async path => requests.push(path))).state, 'skipped');
  assert.deepEqual(requests, []);
  await assert.rejects(observeRuntimeRecordInput({ ...env, CI_RECORD_INPUT: '' }), /transport/i);
});

// Native stream contracts make a failed start-receipt observable without confusing it with child success.
test('failed capture-start receipt retains consumed stdout and direct child outcome as a reporting failure', async () => {
  const { result } = await captureHostScenario({
    childPid: 4321, stdout: new PassThrough(), stderr: new PassThrough(),
    onStart: async () => { throw new Error('controlled capture-start write failure'); },
    produce: child => {
      const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
      child.stdout.end(Buffer.from('literal key\n')); child.stderr.end();
      closed.then(() => child.emit('close', 0, null));
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutCapture, { state: 'complete' });
  assert.deepEqual(result.ioFailures, [{ stream: 'capture', operation: 'start' }]);
  assert.deepEqual(result.stdout, Buffer.from('literal key\n'));
});

// Compose the actual producer publication, runtime transport consumer and writer; expected descriptions are independent literals.
test('actual report publication composes scheduled records for every report state and preserves host success refusal', async () => {
  for (const row of [
    { bytes: '<testsuites><testcase name="A &amp; B"><failure/></testcase><testcase name="line&#10;value"><error/></testcase><testcase name="A &amp; B"><failure/></testcase></testsuites>', exitCode: 1, text: '["A & B","line\\nvalue","A & B"]' },
    { bytes: '<testsuites/>', exitCode: 1, text: 'Host step failed without a reported test failure.' },
    { bytes: undefined, exitCode: 1, text: 'JUnit report is absent; failed-test names are unavailable.' },
    { bytes: '<testsuites><testcase name="tentative"><failure/></testcase>', exitCode: 1, text: 'JUnit report is unparsable; failed-test names are unavailable.' },
    { bytes: undefined, exitCode: 0, text: null },
  ]) {
    const published = await publicationInvocation(row.bytes === undefined ? undefined : Buffer.from(row.bytes), { exitCode: row.exitCode });
    const fields = hostOutputFields(published.outputWrites);
    const input = await observeRuntimeRecordInput({ CI_RECORD_INPUT: JSON.stringify(fields), GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'williacj/rigger', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' });
    const posts = [];
    const result = await observeHostRecord(input, async (path, options = {}) => {
      if (!options.method) return { status: 200, body: [] };
      posts.push(options.body);
      return { status: 201, body: { number: 71 } };
    });
    assert.equal(posts.length, row.text === null ? 0 : 1);
    if (row.text !== null) {
      assert.equal(result.state, 'created');
      assert.ok(posts[0].body.includes(row.text));
      assert.equal(posts[0].title, 'Host tier: t4-fixture-macos-arm64-node26');
      assert.ok(posts[0].body.includes('/actions/runs/123'));
      assert.ok(posts[0].body.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    } else assert.equal(result.state, 'skipped', 'report failure cannot turn host success into a host-failure issue');
  }
});

// A response can be lost after the service persisted a POST; only a fresh complete read may reconcile it.
test('uncertain create or comment responses reconcile persisted identity without blind replay', async () => {
  for (const operation of ['create', 'comment']) {
    const initial = operation === 'comment' ? { number: 71, title: 'Host tier: t4-fixture-macos-arm64-node26', state: 'open', labels: [{ name: 'host-tier' }], body: 'Earlier host record', comments: 0 } : undefined;
    const store = hostIssueStore(initial);
    let lost = false;
    const request = async (path, options = {}) => {
      const response = await store.request(path, options);
      if (options.method === 'POST' && !lost) { lost = true; throw new Error('controlled response lost after persisted write'); }
      return response;
    };
    await assert.rejects(observeHostRecord(hostRecordInput(), request), /uncertain; reconcile/i);
    assert.equal(store.requests.filter(([, options]) => options.method === 'POST').length, 1);
    assert.equal((await observeHostRecord(hostRecordInput(), request)).state, 'already-recorded');
    assert.equal(store.requests.filter(([, options]) => options.method === 'POST').length, 1, 'reconciliation must not blindly repeat the uncertain mutation');
  }
});

test('a new real run attempt contributes a distinct record to the existing issue', async () => {
  const store = hostIssueStore();
  assert.equal((await observeHostRecord(hostRecordInput(), store.request)).state, 'created');
  const body = store.issue.body;
  const second = { ...hostRecordInput(), runAttempt: 2, invocation: '{"repository":"williacj/rigger","runId":123,"runAttempt":2,"job":"nightly"}' };
  assert.equal((await observeHostRecord(second, store.request)).state, 'commented');
  assert.equal(store.issue.body, body);
  assert.equal(store.comments.length, 1);
  assert.ok(store.comments[0].body.includes('"runAttempt":2'));
  assert.equal((await observeHostRecord(second, store.request)).state, 'already-recorded');
  assert.equal(store.comments.length, 1);
});
