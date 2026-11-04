// ABOUTME: Executes the protected cancellation literal with independent bounded API scripts and checks its isolated job.
import { test } from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow, evaluateCiPolicy, ciFacts, ciProof } from './ci-policy-fixtures.mjs';
const ci = parseWorkflow(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));

const readOnlyPermissions = permissions => permissions === undefined || permissions === 'read-all' || permissions !== null && typeof permissions === 'object' && !Array.isArray(permissions) && Object.values(permissions).every(value => value === 'read' || value === 'none');

test('cancellation controller isolates Node 26 and grants Actions write only to its own job', () => {
  const job = ci.jobs.cancel_superseded;
  assert.ok(job, 'missing guarded cancellation controller');
  assert.deepEqual(job.needs, ['plan']);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.deepEqual(job.permissions, { actions: 'write', 'pull-requests': 'read' });
  assert.deepEqual(ci.permissions, { contents: 'read', 'pull-requests': 'read' });
  for (const [name, other] of Object.entries(ci.jobs)) if (name !== 'cancel_superseded') assert.ok(readOnlyPermissions(other.permissions), name);
  assert.ok(job.if.includes("github.event_name == 'pull_request'"));
  assert.ok(job.if.includes('github.event.pull_request.head.repo.full_name == github.repository'));
  assert.ok(job.if.includes("needs.plan.outputs.snapshot != ''"));
  assert.deepEqual(job.steps.map(s => s.uses ?? s.run), ['actions/setup-node@v5', 'node --input-type=module -e "$CI_CANCEL"']);
  assert.equal(job.steps[0].with['node-version'], '26');
  assert.equal(job.steps[1].env.CI_CANCEL_ACTION, 'run');
  assert.equal(job.steps[1].env.CI_EXPECTED_SOURCE, '${{ needs.plan.outputs.snapshot }}');
  assert.deepEqual(ci.jobs.check.needs, ['plan', 'fast', 'full_ordinary', 'full_host', 'demo', 'cancel_superseded']);
  assert.equal(ci.concurrency, undefined);
  for (const j of Object.values(ci.jobs)) assert.equal(j.concurrency, undefined);
});

test('permission fence rejects GitHub write-all scalar and preserves read-only forms', () => {
  // GitHub workflow-syntax jobs.<job_id>.permissions accepts read-all/write-all or a map.
  // This is a parsed workflow property, not a map-shaped substitute for the scalar form.
  const jobs = parseWorkflow('jobs:\n  plan:\n    permissions: write-all\n').jobs;
  assert.equal(jobs.plan.permissions, 'write-all');
  assert.equal(readOnlyPermissions(jobs.plan.permissions), false, 'write-all grants write authority');
  for (const permission of [undefined, 'read-all', {}, { actions: 'read' }, { actions: 'none', contents: 'read' }]) assert.equal(readOnlyPermissions(permission), true);
  for (const permission of ['write-all', { actions: 'write' }, null, [], 'unknown']) assert.equal(readOnlyPermissions(permission), false);
});

// API doubles follow GitHub REST workflow-run/PR response fields and the retained observed
// immutable-run/mutable-PR-association shape; synthetic IDs are deliberately independent.
// https://docs.github.com/en/rest/actions/workflow-runs
// https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
const saved = process.env.CI_CANCEL_ACTION;
const had = Object.hasOwn(process.env, 'CI_CANCEL_ACTION');
let controller;
try {
  delete process.env.CI_CANCEL_ACTION;
  controller = await import('data:text/javascript;base64,' + Buffer.from(ci.jobs.cancel_superseded.env.CI_CANCEL).toString('base64'));
} finally {
  if (had) process.env.CI_CANCEL_ACTION = saved; else delete process.env.CI_CANCEL_ACTION;
}

// CI_CANCEL requestApi supplies AbortSignal.timeout's returned signal to send; its
// configured delay is asserted while the test supplies a signal with no host deadline.
async function requestWithAbort(path, { send, ...options }) {
  const signal = new AbortController().signal;
  const timeout = mock.method(AbortSignal, 'timeout', delay => {
    assert.equal(delay, 30_000);
    return signal;
  });
  try {
    return await controller.requestApi(path, { ...options, send: (url, request) => {
      assert.equal(request.signal, signal);
      return send(url, request);
    } });
  } finally {
    timeout.mock.restore();
  }
}

const root = '/repos/williacj/rigger';
const current = 'd'.repeat(40), old = 'a'.repeat(40);
const repo = { id: 44, full_name: 'williacj/rigger' };
const assoc = () => ({ id: 70, number: 7, head: { repo: { id: 44 }, sha: current }, base: { repo: { id: 44 } } });
const run = (id = 80, head_sha = current, run_number = 20) => ({
  id, workflow_id: 55, path: '.github/workflows/ci.yml', event: 'pull_request',
  repository: { ...repo }, head_repository: { ...repo }, head_sha, run_number,
  run_attempt: 1, status: 'queued', actor: { login: 'contributor' }, pull_requests: [assoc()],
});
function input() {
  const pr = { id: 70, number: 7, state: 'open', head: { sha: current, ref: 'rigger-903', repo: { ...repo } }, base: { ref: 'main', sha: 'c'.repeat(40), repo: { ...repo } } };
  return {
    event: { action: 'synchronize', number: 7, repository: { ...repo }, sender: { login: 'contributor' }, pull_request: structuredClone(pr) },
    context: { sha: 'e'.repeat(40), repositoryId: 44, eventName: 'pull_request', repository: 'williacj/rigger', actor: 'contributor', runId: 80, runNumber: 20, runAttempt: 1, workflowRef: 'williacj/rigger/.github/workflows/ci.yml@refs/pull/7/merge', ref: 'refs/pull/7/merge' },
    plan: { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'e'.repeat(40), tree: 'f'.repeat(40), parents: ['c'.repeat(40), current], head: current, base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) },
    pr,
  };
}
const get = (path, body) => ['GET', path, { status: 200, body, link: null }];
function start(f) {
  return [get(root + '/actions/runs/80', run()), get(root + '/actions/workflows/ci.yml', { id: 55, path: '.github/workflows/ci.yml' }), get(root + '/pulls/7', f.pr)];
}
const list = (status, runs = []) => get(root + '/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=' + status + '&per_page=100&page=1', { total_count: runs.length, workflow_runs: runs });
const pages = () => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].map(status => list(status));
const preflight = (...runs) => runs.map(target => get(root + '/actions/runs/' + target.id, target));
async function execute(f, script, failure = false) {
  const calls = [], logs = [];
  let result, error;
  try { result = await controller.cancelSuperseded({ ...f, request: async (path, options = {}) => {
    const actual = [options.method ?? 'GET', path]; calls.push(actual);
    const next = script.shift(); assert.ok(next, 'unexpected request ' + JSON.stringify(actual));
    assert.deepEqual(actual, next.slice(0, 2));
    if (actual[0] === 'POST') { assert.equal(logs.at(-1)?.action, 'cancel-request'); assert.equal(logs.at(-1)?.target, Number(path.split('/').at(-2))); }
    if (next[2] instanceof Error) throw next[2];
    return typeof next[2] === 'function' ? next[2]({ calls, logs }) : structuredClone(next[2]);
  }, log: entry => logs.push(structuredClone(entry)) }); } catch (caught) { error = caught; }
  if (failure) assert.ok(error, "expected refusal"); else if (error) throw error;
  assert.deepEqual(script, [], 'required calls omitted');
  return { result, calls, logs, error: error?.message };
}

test('cancellation validates its source and all five complete empty status pages before returning', async () => {
  const f = input();
  const { result } = await execute(f, [...start(f), ...pages()]);
  assert.deepEqual(result, { accepted: [], completed: [] });
});

const recheck = (f, target) => [get(root + '/pulls/7', f.pr), get(root + '/actions/runs/' + target.id, target), get(root + '/actions/runs/80', run())];
const post = id => ['POST', root + '/actions/runs/' + id + '/cancel', { status: 202, body: null, link: null }];

test('cancellation accepts a main event base preceding the tested merge parent', async () => {
  // The plan job has already authenticated ancestry. This controller receives that plan as data.
  const f = input(), target = run(60, old, 10);
  f.plan.base = f.plan.parents[0] = 'b'.repeat(40);
  assert.notEqual(f.plan.base, f.plan.eventBase, 'fixture must exercise main drift');
  const script = [...start(f), list('queued', [target]), ...pages().slice(1), ...preflight(target), ...recheck(f, target), post(60)];
  const { result, calls } = await execute(f, script);
  assert.deepEqual(result, { accepted: [60], completed: [] });
  assert.deepEqual(calls.filter(([method]) => method === 'POST'), [['POST', root + '/actions/runs/60/cancel']]);
});

test('cancellation refuses missing or wrong event base and a false tested parent before API reads', async () => {
  for (const change of [
    f => { delete f.plan.eventBase; },
    f => { f.plan.eventBase = 'b'.repeat(40); },
    f => { f.plan.eventBase = 'C'.repeat(40); },
    f => { f.plan.parents[0] = 'b'.repeat(40); },
  ]) {
    const f = input(); change(f);
    const { error, calls } = await execute(f, [], true);
    assert.match(error, /controller source plan invalid/);
    assert.deepEqual(calls, []);
  }
});

test('cancellation requests each older active head once using immutable run source and final rereads', async () => {
  const f = input();
  const targets = ['queued', 'in_progress', 'waiting', 'pending', 'requested'].map((status, i) => ({ ...run(60 + i, old, 10 + i), status }));
  const script = [...start(f), ...targets.map(t => list(t.status, [t])), ...preflight(...targets), ...targets.flatMap(t => [...recheck(f, t), post(t.id)])];
  const { result, logs } = await execute(f, script);
  assert.deepEqual(result, { accepted: [60, 61, 62, 63, 64], completed: [] });
  assert.equal(logs.filter(l => l.action === 'cancel-request').length, 5);
  assert.deepEqual(logs[0], { action: 'cancel-request', target: 60, targetHead: old, targetAttempt: 1, targetRunNumber: 10, status: 'queued', ownRun: 80, ownAttempt: 1, ownRunNumber: 20, liveHead: current, repository: 'williacj/rigger', repositoryId: 44, workflowId: 55, workflowPath: '.github/workflows/ci.yml', prNumber: 7, prId: 70, prState: 'open', baseRef: 'main', ownHead: current });
});

test('cancellation excludes same-head profiles and known foreign self or non-older runs', async () => {
  const mutations = [
    t => { t.head_sha = current; t.profile = 'ordinary'; },
    t => { t.head_sha = current; t.profile = 'full'; },
    t => { t.head_sha = current; t.profile = 'demo'; },
    t => { t.id = 80; t.run_number = 20; t.head_sha = current; },
    t => { t.run_number = 20; }, t => { t.run_number = 21; },
    t => { t.event = 'push'; }, t => { t.event = 'schedule'; },
    t => { t.event = 'workflow_dispatch'; }, t => { t.event = 'merge_group'; },
    t => { t.workflow_id = 56; t.path = '.github/workflows/other.yml'; },
    t => { t.repository = { id: 45, full_name: 'other/repo' }; },
    t => { t.head_repository = { id: 45, full_name: 'fork/rigger' }; },
    t => { t.pull_requests[0].number = 8; t.pull_requests[0].id = 71; },
    t => { t.status = 'completed'; },
  ];
  for (const change of mutations) {
    const f = input(), target = run(60, old, 10); change(target);
    const candidate = target.id !== f.context.runId && target.head_sha !== current && target.run_number < f.context.runNumber;
    const { result, calls, logs } = await execute(f, [...start(f), list('queued', [target]), ...pages().slice(1), ...(candidate ? preflight(target) : [])]);
    assert.deepEqual(result.accepted, []); assert.ok(calls.every(([method]) => method === 'GET'));
    assert.deepEqual(logs, [{ action: 'exclude', target: target.id, reason: 'scope/order/head/status' }]);
  }
});

test('cancellation refuses malformed fork non-PR actor context and planned source before API reads', async () => {
  const changes = [
    f => { f.context.eventName = 'push'; }, f => { f.context.eventName = 'schedule'; },
    f => { f.context.eventName = 'workflow_dispatch'; }, f => { f.context.eventName = 'merge_group'; },
    f => { f.event.action = 'deleted'; }, f => { f.context.actor = 'other'; },
    f => { f.event.sender.login = ''; }, f => { f.event.repository.id = 0; },
    f => { f.context.repositoryId = 45; }, f => { f.context.repository = 'other/repo'; },
    f => { f.event.pull_request.head.repo.id = 45; }, f => { f.event.pull_request.base.repo.full_name = 'other/repo'; },
    f => { f.event.pull_request.number = 8; }, f => { f.event.pull_request.id = NaN; },
    f => { f.event.pull_request.state = 'closed'; }, f => { f.event.pull_request.head.sha = 'D'.repeat(40); },
    f => { f.context.runId = Number.MAX_SAFE_INTEGER + 1; }, f => { f.context.runAttempt = 0; },
    f => { f.context.runNumber = -1; }, f => { f.context.workflowRef = 'other/repo/.github/workflows/ci.yml@main'; },
    f => { f.plan.head = old; }, f => { f.plan.sha = old; }, f => { f.plan.tree = 'bad'; },
    f => { f.plan.parents = [current]; }, f => { f.plan.baseRef = 'other'; },
  ];
  for (const change of changes) {
    const f = input(); change(f);
    const answer = await execute(f, [], true);
    assert.match(answer.error, /controller source/); assert.deepEqual(answer.calls, []);
  }
});

test('cancellation freezes attributable own run workflow and live PR without requiring unmoved main', async () => {
  const badOwn = [r => { r.id = 81; }, r => { r.run_number = 21; }, r => { r.run_attempt = 2; }, r => { r.head_sha = old; }, r => { r.workflow_id = 0; }, r => { r.repository.id = 45; }, r => { r.head_repository.id = 45; }, r => { r.pull_requests = []; }, r => { r.pull_requests.push(assoc()); }, r => { r.actor.login = 'other'; }, r => { r.path = '.github/workflows/other.yml'; }];
  for (const change of badOwn) {
    const f = input(), own = run(); change(own);
    const answer = await execute(f, [get(root + '/actions/runs/80', own)], true);
    assert.match(answer.error, /own run/);
  }
  const f = input(), wrong = start(f); wrong[1][2].body.id = 56;
  assert.match((await execute(f, wrong.slice(0, 2), true)).error, /workflow/);
  for (const change of [p => { p.head.sha = old; }, p => { p.state = 'closed'; }, p => { p.base.ref = 'other'; }, p => { p.head.ref = 'other'; }, p => { p.id = 71; }, p => { p.number = 8; }, p => { p.head.repo.id = 45; }, p => { p.base.repo.id = 45; }]) {
    const f = input(), initial = start(f); change(initial[2][2].body);
    assert.match((await execute(f, initial, true)).error, /live PR/);
  }
  const moved = input(); moved.pr.base.sha = 'b'.repeat(40);
  assert.deepEqual((await execute(moved, [...start(moved), ...pages()])).result.accepted, []);
});

test('cancellation resolves a sparse list association through the detailed run before any POST', async () => {
  // GitHub's workflow-run list can omit PR associations that its detailed run response supplies.
  const f = input(), target = run(60, old, 10);
  const sparse = { ...structuredClone(target), pull_requests: [] };
  const script = [...start(f), list('queued', [sparse]), ...pages().slice(1), ...preflight(target), ...recheck(f, target), post(60)];
  const { result, calls } = await execute(f, script);
  assert.deepEqual(result, { accepted: [60], completed: [] });
  assert.deepEqual(calls.filter(([method]) => method === 'POST'), [['POST', root + '/actions/runs/60/cancel']]);
});

test('one malformed list association cannot masquerade as a sparse array', async () => {
  const f = input(), target = run(60, old, 10);
  const malformed = { ...structuredClone(target), pull_requests: [null] };
  const routes = new Map([
    [root + '/actions/runs/80', run()],
    [root + '/actions/workflows/ci.yml', { id: 55, path: '.github/workflows/ci.yml' }],
    [root + '/pulls/7', f.pr],
    [root + '/actions/runs/60', target],
  ]);
  const calls = [];
  await assert.rejects(controller.cancelSuperseded({ ...f, request: async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push([method, path]);
    if (method === 'POST') return { status: 202, body: null, link: null };
    if (path.includes('/actions/workflows/55/runs?')) {
      const status = new URL('https://api.github.com' + path).searchParams.get('status');
      return list(status, status === 'queued' ? [malformed] : [])[2];
    }
    assert.ok(routes.has(path), 'unexpected API route ' + path);
    return { status: 200, body: structuredClone(routes.get(path)), link: null };
  }, log: () => {} }), /run attribution invalid/);
  assert.deepEqual(calls.filter(([method]) => method === 'POST'), []);
});

test('cancellation refuses incomplete discovery and malformed attribution before any POST', async () => {
  const corruptions = [
    r => { r.link = '<https://api.github.com/next>; rel="next"'; },
    r => { r.link = '<https://evil.test/page>; rel="last"'; },
    r => { r.body.total_count = 101; }, r => { r.body.total_count = 1; },
    r => { r.body.total_count = -1; }, r => { r.body.total_count = 0.5; },
    r => { r.body.workflow_runs = null; }, r => { r.body = {}; },
    r => { r.status = 403; },
  ];
  for (const corrupt of corruptions) {
    const f = input(), script = [...start(f), list('queued', [run(60, old, 10)]), ...pages().slice(1)];
    corrupt(script.at(-1)[2]);
    const answer = await execute(f, script, true);
    assert.match(answer.error, /discovery/); assert.ok(answer.calls.every(([method]) => method === 'GET'));
  }
  for (const change of [t => { t.event = ''; }, t => { t.event = 'unknown-event'; }, t => { t.repository.full_name = ''; }, t => { t.path = 'unknown'; }, t => { t.id = 0; }, t => { t.head_sha = 'BAD'; }, t => { delete t.path; }, t => { t.workflow_id = '55'; }, t => { t.run_attempt = 0; }, t => { t.pull_requests.push(assoc()); }, t => { delete t.head_repository; }, t => { delete t.pull_requests[0].base.repo.id; }]) {
    const f = input(), target = run(60, old, 10); change(target);
    const answer = await execute(f, [...start(f), list('queued', [target])], true);
    assert.match(answer.error, /attribution/); assert.ok(answer.calls.every(([method]) => method === 'GET'));
  }
  const f = input(), target = run(60, old, 10);
  const sparse = { ...structuredClone(target), pull_requests: [] };
  const unresolved = await execute(f, [...start(f), list('queued', [sparse]), ...pages().slice(1), ...preflight(sparse)], true);
  assert.match(unresolved.error, /attribution/);
  assert.ok(unresolved.calls.every(([method]) => method === 'GET'));
});

test('cancellation resolves every older target attribution before its first POST', async () => {
  const f = input(), first = run(60, old, 10), second = run(61, old, 11);
  const route = new Map([
    [root + '/actions/runs/80', run()],
    [root + '/actions/workflows/ci.yml', { id: 55, path: '.github/workflows/ci.yml' }],
    [root + '/pulls/7', f.pr],
    [root + '/actions/runs/60', first],
    [root + '/actions/runs/61', { ...second, pull_requests: [] }],
  ]);
  const calls = [];
  await assert.rejects(controller.cancelSuperseded({ ...f, request: async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push([method, path]);
    if (method === 'POST') return { status: 202, body: null, link: null };
    if (path.includes('/actions/workflows/55/runs?')) {
      const status = new URL('https://api.github.com' + path).searchParams.get('status');
      return list(status, status === 'queued' ? [first, second] : [])[2];
    }
    assert.ok(route.has(path), 'unexpected API route ' + path);
    return { status: 200, body: structuredClone(route.get(path)), link: null };
  }, log: () => {} }), /attribution/);
  assert.ok(calls.some(([method, path]) => method === 'GET' && path === root + '/actions/runs/61'));
  assert.deepEqual(calls.filter(([method]) => method === 'POST'), []);
});

test('cancellation accepts exactly 100 complete records and deduplicates status drift but refuses conflicting identity', async () => {
  const f = input();
  const hundred = Array.from({ length: 100 }, (_, i) => run(1000 + i, current, 1));
  assert.deepEqual((await execute(f, [...start(f), list('queued', hundred), ...pages().slice(1)])).result.accepted, []);
  const queued = run(60, old, 10), active = { ...structuredClone(queued), status: 'in_progress', updated_at: 'later' };
  active.pull_requests[0].head.sha = 'b'.repeat(40);
  const script = [...start(f), list('queued', [queued]), list('in_progress', [active]), ...pages().slice(2), ...preflight(active), ...recheck(f, active), post(60)];
  assert.deepEqual((await execute(f, script)).result.accepted, [60]);
  for (const change of [t => { t.head_sha = current; }, t => { t.run_attempt = 2; }, t => { t.run_number = 11; }, t => { t.workflow_id = 56; }, t => { t.repository.id = 45; }, t => { t.head_repository.id = 45; }, t => { t.pull_requests[0].id = 71; }, t => { t.pull_requests[0].number = 8; }]) {
    const other = structuredClone(queued); change(other);
    const answer = await execute(f, [...start(f), list('queued', [queued]), list('in_progress', [other])], true);
    assert.match(answer.error, /conflicting/); assert.ok(answer.calls.every(([m]) => m === 'GET'));
  }
});

test('sparse queued and running rows resolve one detailed run and one cancel route', async () => {
  const f = input(), queued = run(60, old, 10), active = { ...structuredClone(queued), status: 'in_progress' };
  const sparse = target => ({ ...structuredClone(target), pull_requests: [] });
  const script = [...start(f), list('queued', [sparse(queued)]), list('in_progress', [sparse(active)]), ...pages().slice(2), ...preflight(active), ...recheck(f, active), post(60)];
  const { result, calls } = await execute(f, script);
  assert.deepEqual(result.accepted, [60]);
  assert.equal(calls.filter(([method, path]) => method === 'GET' && path === root + '/actions/runs/60').length, 2);
  assert.deepEqual(calls.filter(([method]) => method === 'POST'), [['POST', root + '/actions/runs/60/cancel']]);
});

test('sparse older run belonging to another PR is excluded after detailed attribution', async () => {
  const f = input(), target = run(60, old, 10), foreign = structuredClone(target);
  foreign.pull_requests[0].id = 71;
  foreign.pull_requests[0].number = 8;
  const sparse = { ...structuredClone(target), pull_requests: [] };
  const { result, calls } = await execute(f, [...start(f), list('queued', [sparse]), ...pages().slice(1), ...preflight(foreign)]);
  assert.deepEqual(result, { accepted: [], completed: [] });
  assert.ok(calls.every(([method]) => method === 'GET'));
});

test('cancellation rechecks frozen attempts and stops on live or target changes while completed targets receive no write', async () => {
  const f = input(), target = run(60, old, 10), done = { ...target, status: 'completed' };
  const before = () => [...start(f), list('queued', [target]), ...pages().slice(1), ...preflight(target)];
  assert.deepEqual((await execute(f, [...before(), ...recheck(f, done)])).result, { accepted: [], completed: [60] });
  for (const change of [p => { p.head.sha = old; }, p => { p.state = 'closed'; }, p => { p.base.ref = 'elsewhere'; }, p => { p.head.repo.id = 45; }]) {
    const live = structuredClone(f.pr); change(live);
    const answer = await execute(f, [...before(), get(root + '/pulls/7', live)], true);
    assert.match(answer.error, /live PR/);
  }
  for (const change of [t => { t.run_attempt = 2; }, t => { t.head_sha = current; }, t => { t.workflow_id = 56; }, t => { t.repository.id = 45; }, t => { t.pull_requests[0].id = 71; }, t => { t.run_number = 21; }]) {
    const changed = structuredClone(target); change(changed);
    const answer = await execute(f, [...before(), get(root + '/pulls/7', f.pr), get(root + '/actions/runs/60', changed)], true);
    assert.match(answer.error, /target identity/);
  }
  const check = recheck(f, target); check[2][2].body.run_attempt = 2;
  assert.match((await execute(f, [...before(), ...check], true)).error, /own run/);
  const twice = input(); twice.context.runAttempt = 2;
  const t2 = { ...target, run_attempt: 2 }, initial = start(twice); initial[0][2].body.run_attempt = 2;
  const final = recheck(twice, t2); final[2][2].body.run_attempt = 2;
  assert.deepEqual((await execute(twice, [...initial, list('queued', [t2]), ...pages().slice(1), ...preflight(t2), ...final, post(60)])).result.accepted, [60]);
});

test('cancellation treats 202 as acceptance only and handles 409 once without retry or rollback', async () => {
  const f = input(), first = run(60, old, 10), second = run(61, old, 11);
  const before = () => [...start(f), list('queued', [first, second]), ...pages().slice(1), ...preflight(first, second)];
  const conflict = ['POST', root + '/actions/runs/60/cancel', { status: 409, body: {}, link: null }];
  const done = { ...first, status: 'completed' };
  const benign = await execute(f, [...before(), ...recheck(f, first), conflict, get(root + '/actions/runs/60', done), ...recheck(f, second), post(61)]);
  assert.deepEqual(benign.result, { accepted: [61], completed: [60] });
  assert.ok(!benign.logs.some(l => l.action === 'cancel-accepted' && l.target === 60));
  const active = await execute(f, [...before(), ...recheck(f, first), conflict, get(root + '/actions/runs/60', first)], true);
  assert.match(active.error, /cancel request/);
  for (const failure of [{ status: 403, body: {}, link: null }, { status: 429, body: {}, link: null }, new Error('controlled transport failure')]) {
    const answer = await execute(f, [...before(), ...recheck(f, first), post(60), ...recheck(f, second), ['POST', root + '/actions/runs/61/cancel', failure]], true);
    assert.deepEqual(answer.logs.filter(l => l.action === 'cancel-accepted'), [{ action: 'cancel-accepted', target: 60, status: 202 }]);
    assert.deepEqual(answer.calls.filter(([m]) => m === 'POST'), [['POST', root + '/actions/runs/60/cancel'], ['POST', root + '/actions/runs/61/cancel']]);
  }
});

test('cancellation HTTP adapter uses fixed scoped routes manual redirects and configured abort', async () => {
  const calls = [];
  const send = async (url, options) => { calls.push({ url, options }); return new Response('{"id":80}', { status: 200 }); };
  assert.deepEqual(await requestWithAbort(root + '/actions/runs/80', { send, token: 'synthetic-token' }), { status: 200, body: { id: 80 }, link: null });
  assert.equal(calls[0].url, 'https://api.github.com/repos/williacj/rigger/actions/runs/80');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.authorization, 'Bearer synthetic-token');
  assert.ok(calls[0].options.signal instanceof AbortSignal); assert.equal(calls[0].options.signal.aborted, false);
  const accepted = await requestWithAbort(root + '/actions/runs/60/cancel', { method: 'POST', token: 'synthetic-token', send: async () => new Response('', { status: 202 }) });
  assert.deepEqual(accepted, { status: 202, body: null, link: null });
  for (const response of [
    () => new Response('{}', { status: 302, headers: { location: 'https://evil.test' } }),
    () => new Response('{}', { status: 200, headers: { link: '<https://evil.test/page>; rel="last"' } }),
    () => new Response('{}', { status: 200, headers: { link: '<https://api.github.com/next>; rel="next"' } }),
    () => new Response('{}', { status: 200, headers: { 'content-length': '10' } }),
    () => new Response('{', { status: 200 }),
  ]) await assert.rejects(requestWithAbort(root + '/actions/runs/80', { token: 'synthetic-token', send: async () => response() }));
  for (const path of ['https://evil.test/run', root + '/actions/runs/60/force-cancel', '/repos/other/repo/actions/runs/60', root + '/actions/runs/0/cancel']) {
    await assert.rejects(requestWithAbort(path, { method: 'POST', token: 'synthetic-token', send: async () => assert.fail('unsafe route reached transport') }), /API scope/);
  }
  await assert.rejects(requestWithAbort(root + '/actions/runs/80', { token: '', send }), /API scope/);
  assert.ok(ci.jobs.cancel_superseded.env.CI_CANCEL.includes('AbortSignal.timeout(30_000)'));
});

test('cancellation runtime reads event and planned source as data with immutable run context', () => {
  const f = input(), env = {
    GITHUB_EVENT_PATH: '/synthetic/event.json', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'williacj/rigger', GITHUB_REPOSITORY_ID: '44',
    GITHUB_ACTOR: 'contributor', GITHUB_RUN_ID: '80', GITHUB_RUN_NUMBER: '20', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: f.context.workflowRef, GITHUB_REF: f.context.ref, GITHUB_SHA: f.context.sha, CI_EXPECTED_SOURCE: JSON.stringify(f.plan),
  };
  const actual = controller.runtimeInput(env, path => { assert.equal(path, '/synthetic/event.json'); return JSON.stringify(f.event); });
  assert.deepEqual(actual, { event: f.event, context: f.context, plan: f.plan });
  assert.ok(ci.jobs.cancel_superseded.env.CI_CANCEL.includes("if (process.env.CI_CANCEL_ACTION === 'run')"));
  assert.ok(!ci.jobs.cancel_superseded.env.CI_CANCEL.includes('${{'));
});

test('PR aggregate requires controller success and non-PR aggregate retains its existing result contract', async () => {
  const facts = ciFacts(), proof = ciProof(); proof.results.cancel_superseded = 'success';
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof })).ok, true);
  for (const result of [undefined, 'failure', 'cancelled', 'skipped']) {
    const bad = structuredClone(proof);
    if (result === undefined) delete bad.results.cancel_superseded; else bad.results.cancel_superseded = result;
    assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts, proof: bad })).ok, false, String(result));
  }
  const main = ciFacts(); main.event = 'push'; main.ref = 'refs/heads/main'; main.eventSha = main.checkout.sha = main.main.head; main.after = main.main.head;
  const planned = await evaluateCiPolicy('runPolicy', { action: 'plan', facts: main });
  const mainProof = { ...ciProof(), mode: 'MAIN_SMOKE', source: JSON.parse(planned.output.snapshot) }; delete mainProof.results.cancel_superseded;
  assert.equal((await evaluateCiPolicy('runPolicy', { action: 'aggregate', facts: main, proof: mainProof })).ok, true);
});

test('stale delayed or rerun controllers refuse live head changes and a later race preserves prior accepted requests', async () => {
  for (const attempt of [1, 2]) {
    const f = input(); f.context.runAttempt = attempt; f.event.pull_request.head.sha = f.plan.head = f.plan.parents[1] = old;
    const own = run(80, old); own.run_attempt = attempt;
    const answer = await execute(f, [get(root + '/actions/runs/80', own), get(root + '/actions/workflows/ci.yml', { id: 55, path: '.github/workflows/ci.yml' }), get(root + '/pulls/7', f.pr)], true);
    assert.match(answer.error, /live PR/); assert.deepEqual(answer.logs, []);
  }
  const f = input(), a = run(60, old, 10), b = run(61, old, 11), changed = structuredClone(f.pr); changed.head.sha = old;
  const answer = await execute(f, [...start(f), list('queued', [a, b]), ...pages().slice(1), ...preflight(a, b), ...recheck(f, a), post(60), get(root + '/pulls/7', changed)], true);
  assert.match(answer.error, /live PR/);
  assert.deepEqual(answer.logs.filter(l => l.action === 'cancel-accepted'), [{ action: 'cancel-accepted', target: 60, status: 202 }]);
  assert.equal(answer.calls.filter(([m]) => m === 'POST').length, 1);
});

test('discovery collaborator transport abort decode and body failures all stop before writes', async () => {
  for (const message of ['transport unavailable', 'request aborted', 'invalid UTF-8', 'body incomplete', 'rate limit']) {
    const f = input(); const broken = list('requested'); broken[2] = new Error(message);
    const answer = await execute(f, [...start(f), list('queued', [run(60, old, 10)]), ...pages().slice(1, 4), broken], true);
    assert.equal(answer.error, message); assert.ok(answer.calls.every(([m]) => m === 'GET')); assert.deepEqual(answer.logs, []);
  }
});

test('final-GET observations permit a request despite head reuse or a new attempt only after those reads', async () => {
  for (const late of ['head-reuse', 'new-attempt']) {
    const f = input(), target = run(60, old, 10);
    let serviceHead = current, serviceAttempt = 1;
    const request = ['POST', root + '/actions/runs/60/cancel', ({ logs }) => {
      // GitHub has no compare-and-cancel precondition. This service change occurs after the
      // frozen GET answers, so the permitted request is observation-based, never atomic safety.
      if (late === 'head-reuse') serviceHead = old; else serviceAttempt = 2;
      assert.equal(logs.at(-1).liveHead, current); assert.equal(logs.at(-1).targetAttempt, 1);
      return { status: 202, body: null, link: null };
    }];
    const answer = await execute(f, [...start(f), list('queued', [target]), ...pages().slice(1), ...preflight(target), ...recheck(f, target), request]);
    assert.deepEqual(answer.result.accepted, [60]);
    assert.equal(serviceHead, late === 'head-reuse' ? old : current); assert.equal(serviceAttempt, late === 'new-attempt' ? 2 : 1);
  }
});

test('older-head cancellation composes its actual HTTP adapter and sends the exact POST request', async () => {
  const f = input(), target = run(60, old, 10);
  const script = [
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/runs/80', 200, run()],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/ci.yml', 200, { id: 55, path: '.github/workflows/ci.yml' }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/pulls/7', 200, f.pr],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=queued&per_page=100&page=1', 200, { total_count: 1, workflow_runs: [target] }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=in_progress&per_page=100&page=1', 200, { total_count: 0, workflow_runs: [] }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=waiting&per_page=100&page=1', 200, { total_count: 0, workflow_runs: [] }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=pending&per_page=100&page=1', 200, { total_count: 0, workflow_runs: [] }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/workflows/55/runs?event=pull_request&exclude_pull_requests=false&status=requested&per_page=100&page=1', 200, { total_count: 0, workflow_runs: [] }],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/runs/60', 200, target],
    ['GET', 'https://api.github.com/repos/williacj/rigger/pulls/7', 200, f.pr],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/runs/60', 200, target],
    ['GET', 'https://api.github.com/repos/williacj/rigger/actions/runs/80', 200, run()],
    ['POST', 'https://api.github.com/repos/williacj/rigger/actions/runs/60/cancel', 202, null],
  ];
  const send = async (url, options) => {
    const expected = script.shift(); assert.ok(expected, 'undeclared HTTP request');
    assert.deepEqual([options.method, url], expected.slice(0, 2));
    assert.deepEqual(options.headers, { authorization: 'Bearer synthetic-composed-token', accept: 'application/vnd.github+json' });
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
    return new Response(expected[3] === null ? '' : JSON.stringify(expected[3]), { status: expected[2] });
  };
  const result = await controller.cancelSuperseded({ ...f, request: (path, options) => requestWithAbort(path, { ...options, send, token: 'synthetic-composed-token' }), log: () => {} });
  assert.deepEqual(result, { accepted: [60], completed: [] }); assert.deepEqual(script, []);
});

test('decoded CI response budget accepts exact bound and rejects oversized valid JSON', async () => {
  const limit = 2 * 1024 * 1024;
  const exact = JSON.stringify('x'.repeat(limit - 2));
  const oversized = JSON.stringify('x'.repeat(limit - 1));
  assert.equal(Buffer.byteLength(exact), limit);
  assert.equal(Buffer.byteLength(oversized), limit + 1);
  assert.equal(JSON.parse(oversized).length, limit - 1, 'oversized fixture must remain valid JSON');
  const response = body => new Response(body, { status: 200, headers: { 'content-length': String(Buffer.byteLength(body)) } });
  const accepted = await requestWithAbort(root + '/actions/runs/80', { token: 'synthetic-token', send: async () => response(exact) });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.length, limit - 2);
  await assert.rejects(requestWithAbort(root + '/actions/runs/80', { token: 'synthetic-token', send: async () => response(oversized) }), { message: 'API body incomplete' });
});

test('CI response decoding rejects invalid UTF8 inside valid JSON syntax', async () => {
  const invalid = new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(invalid)), { x: '\uFFFD' }, 'lossy decoding would leave valid JSON');
  const valid = JSON.stringify({ x: '\uFFFD' });
  const accepted = await requestWithAbort(root + '/actions/runs/80', { token: 'synthetic-token', send: async () => new Response(valid, { status: 200 }) });
  assert.deepEqual(accepted.body, { x: '\uFFFD' });
  await assert.rejects(requestWithAbort(root + '/actions/runs/80', { token: 'synthetic-token', send: async () => new Response(invalid, { status: 200 }) }), TypeError);
});

async function diagnosed(f, script, failure = false) {
  const diagnostics = [], previous = console.error;
  console.error = line => diagnostics.push(JSON.parse(line));
  try { return { ...await execute(f, script, failure), diagnostics }; }
  finally { console.error = previous; }
}

test('discovery HTTP refusal logs its status query and numeric code without response content or a cancel write', async () => {
  const f = input(), page = list('in_progress', []);
  page[2] = { status: 403, body: { secret: 'synthetic-api-body' }, link: null };
  const answer = await diagnosed(f, [...start(f), list('queued', [run(60, old, 10)]), page], true);
  assert.match(answer.error, /discovery incomplete/);
  assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), []);
  assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'in_progress', reason: 'HTTP status', httpStatus: 403 }]);
  assert.doesNotMatch(JSON.stringify(answer.diagnostics), /synthetic-api-body/);
});

test('discovery page shape refusals explain the bounded count and list failure before any cancel write', async () => {
  const cases = [
    { name: 'missing count', change: p => { delete p.body.total_count; }, reason: 'count invalid' },
    { name: 'fractional count', change: p => { p.body.total_count = 0.5; }, reason: 'count invalid' },
    { name: 'negative count', change: p => { p.body.total_count = -1; }, reason: 'count invalid' },
    { name: 'over cap', change: p => { p.body.total_count = 101; }, reason: 'page limit reached', count: 101 },
    { name: 'missing list', change: p => { delete p.body.workflow_runs; }, reason: 'list invalid', count: 0 },
    { name: 'non-array list', change: p => { p.body.workflow_runs = null; }, reason: 'list invalid', count: 0 },
    { name: 'mismatched list', change: p => { p.body.total_count = 1; }, reason: 'count/list mismatch', count: 1, length: 0 },
  ];
  for (const sample of cases) {
    const f = input(), page = list('waiting', []);
    sample.change(page[2]);
    const answer = await diagnosed(f, [...start(f), list('queued', [run(60, old, 10)]), list('in_progress'), page], true);
    assert.match(answer.error, /discovery incomplete/, sample.name);
    assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), [], sample.name);
    assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'waiting', reason: sample.reason, ...(sample.count === undefined ? {} : { count: sample.count }), ...(sample.length === undefined ? {} : { length: sample.length }) }], sample.name);
  }
});

test('discovery pagination refusals name the status and preserve zero writes', async () => {
  for (const link of [
    '<https://api.github.com/next>; rel="next"',
    '<https://evil.test/page>; rel="last"',
    'synthetic-secret-link',
  ]) {
    const f = input(), page = list('pending', []);
    page[2].link = link;
    const answer = await diagnosed(f, [...start(f), ...pages().slice(0, 3), page], true);
    assert.match(answer.error, /pagination incomplete/);
    assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), []);
    assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'pending', reason: 'pagination incomplete' }]);
    assert.doesNotMatch(JSON.stringify(answer.diagnostics), /synthetic-secret/);
  }
});

test('pre-page API failures name the active query and a safe refusal class once', async () => {
  const route = list('requested')[1];
  const samples = [
    { reason: 'transport failed', response: async () => { throw new Error('synthetic-remote-exception-secret'); } },
    { reason: 'decode failed', response: async () => new Response(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])) },
    { reason: 'body incomplete', response: async () => new Response('{"secret":"synthetic-api-body"}', { headers: { 'content-length': '1' } }) },
    { reason: 'JSON invalid', response: async () => new Response('{"secret":"synthetic-api-body"', { status: 200 }) },
    { reason: 'pagination incomplete', response: async () => new Response('{}', { headers: { link: '<https://api.github.com/next>; rel="next"' } }) },
  ];
  for (const sample of samples) {
    const f = input(), request = ['GET', route, () => requestWithAbort(route, { token: 'synthetic-token-secret', send: sample.response })];
    const answer = await diagnosed(f, [...start(f), ...pages().slice(0, 4), request], true);
    assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), [], sample.reason);
    assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'requested', reason: sample.reason }], sample.reason);
    assert.doesNotMatch(JSON.stringify(answer.diagnostics) + answer.error, /synthetic-(remote|api|token)/, sample.reason);
  }
});

test('discovery refuses a malformed HTTP status without echoing untrusted status text', async () => {
  const f = input(), page = list('requested', []);
  page[2] = { status: 'synthetic-status-secret', body: {}, link: null };
  const answer = await diagnosed(f, [...start(f), ...pages().slice(0, 4), page], true);
  assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), []);
  assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'requested', reason: 'HTTP status' }]);
  assert.doesNotMatch(JSON.stringify(answer.diagnostics), /synthetic-status-secret/);
});

test('complete discovery pages with zero one and one hundred rows produce no refusal diagnostic', async () => {
  const f = input(), one = [run(61, current, 10)];
  const hundred = Array.from({ length: 100 }, (_, index) => run(1000 + index, current, 10));
  const script = [...start(f), list('queued'), list('in_progress', one), list('waiting', hundred), list('pending'), list('requested', one)];
  const answer = await diagnosed(f, script);
  assert.deepEqual(answer.result, { accepted: [], completed: [] });
  assert.deepEqual(answer.diagnostics.filter(entry => entry.action === 'discovery-refused'), []);
  assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), []);
});

test('discovery records numeric redirect and malformed error statuses before parsing untrusted bodies', async () => {
  const route = list('requested')[1];
  const samples = [
    new Response('<html>synthetic-redirect-body-secret', { status: 302, headers: { location: 'https://evil.test/synthetic-location-secret' } }),
    new Response('<html>synthetic-error-body-secret', { status: 403 }),
  ];
  for (const response of samples) {
    const f = input();
    const request = ['GET', route, () => requestWithAbort(route, { token: 'synthetic-token-secret', send: async () => response })];
    const answer = await diagnosed(f, [...start(f), list('queued', [run(60, old, 10)]), ...pages().slice(1, 4), request], true);
    assert.match(answer.error, /discovery incomplete/);
    assert.deepEqual(answer.diagnostics, [{ action: 'discovery-refused', query: 'requested', reason: 'HTTP status', httpStatus: response.status }]);
    assert.deepEqual(answer.calls.filter(([method]) => method === 'POST'), []);
    assert.doesNotMatch(JSON.stringify(answer.diagnostics) + answer.error, /synthetic-(redirect|location|error|token)/);
  }
});
