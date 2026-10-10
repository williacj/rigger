// ABOUTME: Exercises the forge's check, rule, comment and merge answers through the fake gh,
// including the refusals that must leave the repository untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { UNKILLED } from './process-fixtures.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { readRunner, repositoryWriteRunner } from '../src/substrate/forge/runners.mjs';

const BOARD = { repo: 'williacj/rigger', project: 6 };
const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const pull = (facts = {}) => ({ number: 12, head: 'topic', sha: SHA, ...facts });

function fakeWith(seed = {}) {
  const fake = installFakeGh(temporaryDirectory('rigger-forge-contract-'), { ...BOARD });
  seedRepository(fake, seed);
  return fake;
}

async function onFake(fake, operation) {
  const original = process.env.PATH;
  process.env.PATH = `${dirname(fake.gh)}${delimiter}${original}`;
  try { return await operation(); } finally { process.env.PATH = original; }
}

const reads = () => repositoryReads(BOARD, { emitter: UNKILLED });
const writes = () => repositoryWriteSide(BOARD, { emitter: UNKILLED });
const held = (fake) => JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8')).repository;
const mergeSent = (fake) => fake.sent().filter((args) => args[1]?.endsWith('/merge'));
const commentSent = (fake) => fake.sent().filter((args) => args[1]?.endsWith('/comments'));
const expectedMerge = ['api', 'repos/williacj/rigger/pulls/12/merge', '-X', 'PUT', '-f', `sha=${SHA}`, '-f', 'merge_method=merge'];
const expectedComment = (body) => ['api', 'repos/williacj/rigger/issues/12/comments', '-X', 'POST', '-f', `body=${body}`];

for (const [status, conclusion, expected] of [
  ['completed', 'success', 'passed'], ['completed', 'neutral', 'passed'], ['completed', 'skipped', 'passed'],
  ...['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'].map((value) => ['completed', value, 'failed']),
  ...['queued', 'in_progress', 'waiting', 'requested', 'pending'].map((value) => [value, null, 'pending']),
]) {
  test(`check run ${status}/${conclusion ?? 'none'} answers ${expected}`, async () => {
    const fake = fakeWith({ checks: { [SHA]: [{ id: 1, name: 'ci', status, conclusion, app: { id: 15368 } }] } });
    const result = await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: 15368 }]));
    assert.deepEqual(result.ci, { state: expected, creator: null });
  });
}

for (const [state, expected] of [['success', 'passed'], ['failure', 'failed'], ['error', 'failed'], ['pending', 'pending']]) {
  test(`commit status ${state} answers ${expected} and its creator under an integration pin`, async () => {
    const creator = { login: 'gate[bot]', id: 77 };
    const fake = fakeWith({ statuses: { [SHA]: [{ context: 'gate', state, creator }] } });
    const result = await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'gate', integration_id: 991 }]));
    assert.deepEqual(result.gate, { state: expected, creator });
  });
}

test('a commit status under an unpinned context answers its creator without comparing a pin', async () => {
  const creator = { login: 'person', id: 42 };
  const fake = fakeWith({ statuses: { [SHA]: [{ context: 'ci', state: 'success', creator }] } });
  assert.deepEqual((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: null }]))).ci, { state: 'passed', creator });
});

test('a required context never reported answers absent', async () => {
  const fake = fakeWith();
  assert.deepEqual((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'missing', integration_id: null }]))).missing, { state: 'absent', creator: null });
});

test('the later check run of one name governs an earlier failure', async () => {
  const fake = fakeWith({ checks: { [SHA]: [
    { id: 1, name: 'ci', status: 'completed', conclusion: 'failure', app: { id: 15368 } },
    { id: 2, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } },
  ] } });
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: 15368 }]))).ci.state, 'passed');
});

test('a check run from another integration does not satisfy a pinned context', async () => {
  const fake = fakeWith({ checks: { [SHA]: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 55 } }] } });
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: 15368 }]))).ci.state, 'absent');
});

for (const [runConclusion, statusState, expected] of [['failure', 'success', 'failed'], ['success', 'pending', 'pending'], ['success', 'success', 'passed']]) {
  test(`a check run ${runConclusion} and commit status ${statusState} under one context answer ${expected}`, async () => {
    const fake = fakeWith({ checks: { [SHA]: [{ id: 1, name: 'ci', status: 'completed', conclusion: runConclusion, app: { id: 15368 } }] }, statuses: { [SHA]: [{ context: 'ci', state: statusState, creator: { login: 'person', id: 1 } }] } });
    assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: 15368 }]))).ci.state, expected);
  });
}

for (const kind of ['checks', 'statuses']) {
  test(`check states read a required ${kind} record on the second page`, async () => {
    const filler = kind === 'checks' ? { id: 1, name: 'other', status: 'completed', conclusion: 'success', app: { id: 15368 } } : { context: 'other', state: 'success', creator: { login: 'bot', id: 1 } };
    const target = kind === 'checks' ? { id: 101, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } } : { context: 'ci', state: 'success', creator: { login: 'bot', id: 1 } };
    const fake = fakeWith({ [kind]: { [SHA]: [...Array.from({ length: 100 }, () => filler), target] } });
    assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, [{ context: 'ci', integration_id: 15368 }]))).ci.state, 'passed');
    assert.equal(fake.sent().filter((args) => args[1]?.includes(`/${kind === 'checks' ? 'check-runs' : 'statuses'}?`)).length, 2);
  });
}

const requiredRule = (context, integration_id = null, enforcement = 'active') => ({ type: 'required_status_checks', enforcement, parameters: { required_status_checks: [{ context, ...(integration_id === null ? {} : { integration_id }) }] } });
const protection = (context) => ({ required_status_checks: { checks: [{ context, app_id: null }], contexts: [context] } });

for (const [title, seed, expected] of [
  ['ruleset only', { rules: { main: [requiredRule('ruleset')] } }, [{ context: 'ruleset', integration_id: null }]],
  ['classic protection only', { protections: { main: protection('classic') } }, [{ context: 'classic', integration_id: null }]],
  ['ruleset and classic protection union', { rules: { main: [requiredRule('ruleset')] }, protections: { main: protection('classic') } }, [{ context: 'ruleset', integration_id: null }, { context: 'classic', integration_id: null }]],
  ['evaluate and disabled rules ignored', { rules: { main: [requiredRule('a', null, 'evaluate'), requiredRule('b', null, 'disabled')] } }, []],
  ['integration pin retained', { rules: { main: [requiredRule('gate', 991)] } }, [{ context: 'gate', integration_id: 991 }]],
  ['rules on a second page', { rules: { main: [...Array.from({ length: 100 }, () => ({ type: 'pull_request', enforcement: 'active' })), requiredRule('later')] } }, [{ context: 'later', integration_id: null }]],
]) {
  test(`effective rules: ${title}`, async () => {
    const fake = fakeWith(seed);
    assert.deepEqual(await onFake(fake, () => reads().readEffectiveRules('main')), expected);
  });
}

test('a ruleset pin survives classic protection allowing any App for the same context', async () => {
  const fake = fakeWith({ rules: { main: [requiredRule('gate', 991)] }, protections: { main: protection('gate') } });
  assert.deepEqual(await onFake(fake, () => reads().readEffectiveRules('main')), [{ context: 'gate', integration_id: 991 }]);
});

test('a passing run from another App cannot satisfy an overlapping ruleset pin', async () => {
  const fake = fakeWith({ rules: { main: [requiredRule('gate', 991)] }, protections: { main: protection('gate') }, checks: { [SHA]: [{ id: 1, name: 'gate', status: 'completed', conclusion: 'success', app: { id: 55 } }] } });
  const required = await onFake(fake, () => reads().readEffectiveRules('main'));
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, required))).gate.state, 'absent');
});

test('a pinned classic check carries its App id', async () => {
  const fake = fakeWith({ protections: { main: { required_status_checks: { checks: [{ context: 'ci', app_id: 15368 }], contexts: ['ci'] } } } });
  assert.deepEqual(await onFake(fake, () => reads().readEffectiveRules('main')), [{ context: 'ci', integration_id: 15368 }]);
});

test('classic app id -1 means any App and admits a successful run from an App', async () => {
  const fake = fakeWith({ protections: { main: { required_status_checks: { checks: [{ context: 'ci', app_id: -1 }], contexts: ['ci'] } } }, checks: { [SHA]: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } }] } });
  const required = await onFake(fake, () => reads().readEffectiveRules('main'));
  assert.deepEqual(required, [{ context: 'ci', integration_id: null }]);
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, required))).ci.state, 'passed');
});

test('different ruleset and classic App pins for one context are both required', async () => {
  const fake = fakeWith({ rules: { main: [requiredRule('ci', 991)] }, protections: { main: { required_status_checks: { checks: [{ context: 'ci', app_id: 15368 }], contexts: ['ci'] } } }, checks: { [SHA]: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } }] } });
  const required = await onFake(fake, () => reads().readEffectiveRules('main'));
  assert.deepEqual(required, [{ context: 'ci', integration_id: 991 }, { context: 'ci', integration_id: 15368 }]);
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, required))).ci.state, 'absent');
});

test('different App pins for one context pass when both matching runs pass', async () => {
  const fake = fakeWith({ rules: { main: [requiredRule('ci', 991)] }, protections: { main: { required_status_checks: { checks: [{ context: 'ci', app_id: 15368 }] } } }, checks: { [SHA]: [
    { id: 1, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 991 } },
    { id: 2, name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } },
  ] } });
  const required = await onFake(fake, () => reads().readEffectiveRules('main'));
  assert.equal((await onFake(fake, () => reads().readCheckStates(SHA, required))).ci.state, 'passed');
});

test('the fake effective-rules answer omits enforcement and non-active rules', async () => {
  const fake = fakeWith({ rules: { main: [requiredRule('active'), requiredRule('evaluate', null, 'evaluate'), requiredRule('disabled', null, 'disabled')] } });
  const said = await onFake(fake, () => readRunner(['api', 'repos/williacj/rigger/rules/branches/main?per_page=100&page=1', '-X', 'GET'], { emitter: UNKILLED }));
  assert.deepEqual(JSON.parse(said.stdout), [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'active' }] } }]);
});

for (const status of ['403', '404']) {
  test(`effective rules rejects the rules read's HTTP ${status} answer`, async () => {
    const fake = fakeWith({ ruleFailures: { main: { status, message: 'Rules unavailable' } } });
    await assert.rejects(onFake(fake, () => reads().readEffectiveRules('main')), (error) => /readEffectiveRules/.test(error.message) && error.message.includes(`HTTP ${status}`));
  });
}

for (const [name, seed, run] of [
  ['readCheckStates', { checkFailures: { [SHA]: { status: '403', message: 'Checks unavailable' } } }, (side) => side.readCheckStates(SHA, [{ context: 'ci' }])],
  ['readMergeable', {}, (side) => side.readMergeable(12)],
  ['readComments', {}, (side) => side.readComments(12)],
]) {
  test(`${name} rejects naming the read and the forge answer`, async () => {
    const fake = fakeWith(seed);
    await assert.rejects(onFake(fake, () => run(reads())), (error) => error.message.includes(name) && (/HTTP 403|Could not resolve/.test(error.message)));
  });
}

for (const state of ['MERGEABLE', 'CONFLICTING', 'UNKNOWN']) {
  test(`mergeable read answers ${state.toLowerCase()}`, async () => {
    const fake = fakeWith({ pullRequests: [pull()], mergeable: { 12: state } });
    assert.equal(await onFake(fake, () => reads().readMergeable(12)), state.toLowerCase());
  });
}

const comment = (changes = {}) => ({ id: 'IC_1', body: 'marker', createdAt: '2026-10-09T10:00:00Z', author: { login: 'writer' }, lastEditedAt: null, includesCreatedEdit: false, ...changes });
for (const permission of ['admin', 'maintain', 'write', 'triage', 'read']) {
  test(`comment author permission ${permission} is read from the forge`, async () => {
    const fake = fakeWith({ pullRequests: [pull({ comments: [comment()] })], permissions: { writer: permission } });
    const [read] = await onFake(fake, () => reads().readComments(12));
    assert.deepEqual(read, { body: 'marker', createdAt: '2026-10-09T10:00:00Z', id: 'IC_1', author: 'writer', permission, edited: false });
  });
}

for (const [role, legacy] of [['maintain', 'write'], ['triage', 'read']]) {
  test(`the fake permission answer gives role_name ${role} beside legacy permission ${legacy}`, async () => {
    const fake = fakeWith({ permissions: { writer: role } });
    const said = await onFake(fake, () => readRunner(['api', 'repos/williacj/rigger/collaborators/writer/permission', '-X', 'GET'], { emitter: UNKILLED }));
    assert.deepEqual(JSON.parse(said.stdout), { permission: legacy, role_name: role });
  });
}

for (const [title, changes, edited] of [
  ['never edited', {}, false], ['edited once', { lastEditedAt: '2026-10-09T11:00:00Z', includesCreatedEdit: true }, true],
  ['edited twice', { lastEditedAt: '2026-10-09T12:00:00Z', includesCreatedEdit: true }, true],
  ['edited back to its first text', { body: 'marker', lastEditedAt: '2026-10-09T13:00:00Z', includesCreatedEdit: true }, true],
  ['minimized', { isMinimized: true }, false],
]) {
  test(`comment ${title} answers edited ${edited}`, async () => {
    const fake = fakeWith({ pullRequests: [pull({ comments: [comment(changes)] })], permissions: { writer: 'write' } });
    const [read] = await onFake(fake, () => reads().readComments(12));
    assert.equal(read.edited, edited);
    assert.deepEqual(Object.keys(read).sort(), ['author', 'body', 'createdAt', 'edited', 'id', 'permission']);
  });
}

test('a deleted comment is absent from the read', async () => {
  const fake = fakeWith({ pullRequests: [pull({ comments: [] })] });
  assert.deepEqual(await onFake(fake, () => reads().readComments(12)), []);
});

test('a deleted author is null with permission none', async () => {
  const fake = fakeWith({ pullRequests: [pull({ comments: [comment({ author: null })] })] });
  const [read] = await onFake(fake, () => reads().readComments(12));
  assert.equal(read.author, null);
  assert.equal(read.permission, 'none');
});

test('a non-collaborator permission 404 answers none', async () => {
  const fake = fakeWith({ pullRequests: [pull({ comments: [comment()] })], permissions: {} });
  const [read] = await onFake(fake, () => reads().readComments(12));
  assert.equal(read.permission, 'none');
});

test('two comments by one author cost one permission read', async () => {
  const fake = fakeWith({ pullRequests: [pull({ comments: [comment(), comment({ id: 'IC_2' })] })], permissions: { writer: 'write' } });
  await onFake(fake, () => reads().readComments(12));
  assert.equal(fake.sent().filter((args) => args[1]?.includes('/collaborators/writer/permission')).length, 1);
});

test('a permission read failure rejects naming the read and the forge answer', async () => {
  const fake = fakeWith({ pullRequests: [pull({ comments: [comment()] })], permissionFailures: { writer: { status: '403', message: 'Resource not accessible by integration' } } });
  await assert.rejects(onFake(fake, () => reads().readComments(12)), /readComments.*permission for writer.*HTTP 403/);
});

// Behind, method and closed 405 messages are unmeasured examples, not #643 Q-f captures.
const refusedMerge = [
  ['conflict', 'Pull Request has merge conflicts', 'conflict'],
  ['failing check', 'Repository rule violations found\n\nRequired status check "ci" is failing.', 'failing'],
  ['pending check', 'Repository rule violations found\n\nRequired status check "ci" is pending.', 'pending'],
  ['expected check', 'Repository rule violations found\n\nRequired status check "ci" is expected.', 'no record'],
  ['wrong app', 'Repository rule violations found\n\nRequired status check "ci" was not set by the expected GitHub app.', 'set by another app'],
  ['base modified', 'Base branch was modified. Review and try the merge again.', 'base modified'],
  ['behind base', 'Head branch is out of date', 'behind'],
  ['method', 'Merge commit is not allowed', 'method'],
  ['closed', 'Pull Request is closed', 'closed'],
];

for (const [title, message, reason] of refusedMerge) {
  test(`merge refusal ${title} leaves main unchanged`, async () => {
    const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], mergeReplies: { 12: { status: '405', message } } });
    const answer = await onFake(fake, () => writes().mergePullRequest(12, SHA));
    assert.equal(answer.outcome, 'refused');
    assert.equal(answer.reason, reason);
    if (message.includes('Required status check')) assert.equal(answer.context, 'ci');
    assert.equal(held(fake).mainSha, BASE);
    assert.deepEqual(mergeSent(fake), [expectedMerge]);
  });
}

test('a moved head refuses the merge and leaves main unchanged', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull({ sha: 'c'.repeat(40) })] });
  assert.deepEqual(await onFake(fake, () => writes().mergePullRequest(12, SHA)), { outcome: 'refused', reason: 'head moved' });
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), []);
});

test('the merge API 409 head-moved answer refuses and leaves main unchanged', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], mergeReplies: { 12: { status: '409', message: 'Head branch was modified. Review and try the merge again.' } } });
  assert.deepEqual(await onFake(fake, () => writes().mergePullRequest(12, SHA)), { outcome: 'refused', reason: 'head moved' });
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), [expectedMerge]);
});

test('an already merged pull request answers already merged without changing main', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull({ merged: true })] });
  assert.equal((await onFake(fake, () => writes().mergePullRequest(12, SHA))).outcome, 'already merged');
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), [expectedMerge]);
});

test('a successful merge sends the expected SHA and merge method', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()] });
  const answer = await onFake(fake, () => writes().mergePullRequest(12, SHA));
  assert.deepEqual(answer, { outcome: 'merged', sha: 'm'.repeat(40) });
  assert.equal(held(fake).mainSha, 'm'.repeat(40));
  assert.deepEqual(mergeSent(fake), [expectedMerge]);
});

test('a mergeability unknown pull request is refused without changing main', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], mergeable: { 12: null } });
  assert.equal((await onFake(fake, () => writes().mergePullRequest(12, SHA))).reason, 'unknown');
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), []);
});

test('a closed pull request is refused without changing main', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], pullStates: { 12: 'closed' } });
  assert.equal((await onFake(fake, () => writes().mergePullRequest(12, SHA))).reason, 'closed');
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), []);
});

test('an unknown 405 answers an unclassified refusal without changing main', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], mergeReplies: { 12: { status: '405', message: 'An answer the adapter does not know' } } });
  assert.deepEqual(await onFake(fake, () => writes().mergePullRequest(12, SHA)), { outcome: 'refused', reason: 'unclassified', status: 405, message: 'An answer the adapter does not know' });
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), [expectedMerge]);
});

test('a nonzero gh exit rejects naming the merge call and leaves main unchanged', async () => {
  const fake = fakeWith({ mainSha: BASE, pullRequests: [pull()], mergeReplies: { 12: { message: 'transport failure' } } });
  await assert.rejects(onFake(fake, () => writes().mergePullRequest(12, SHA)), /mergePullRequest #12 failed: transport failure/);
  assert.equal(held(fake).mainSha, BASE);
  assert.deepEqual(mergeSent(fake), [expectedMerge]);
});

test('a timed out merge call rejects naming it', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    return args[1].endsWith('/merge') ? { status: 1, timedOut: true, timeout: 60_000, stderr: 'timed out', stdout: '' }
      : { status: 0, timedOut: false, stderr: '', stdout: JSON.stringify({ head: { sha: SHA }, state: 'open', merged: false, mergeable: true }) };
  };
  await assert.rejects(repositoryWriteSide(BOARD, { send, timeout: 60_000 }).mergePullRequest(12, SHA), /mergePullRequest #12 failed: gh ran past its timeout of 60000 ms/);
  assert.deepEqual(sent[1], expectedMerge);
  assert.equal(sent.length, 2);
});

test('repository-write posts a comment on a pull request through the fake forge', async () => {
  const fake = fakeWith({ pullRequests: [pull()] });
  assert.deepEqual(await onFake(fake, () => writes().postComment(12, 'Review complete')), { id: 1, body: 'Review complete' });
  assert.equal(held(fake).pullRequests[0].comments[0].body, 'Review complete');
  assert.deepEqual(commentSent(fake), [expectedComment('Review complete')]);
});

test('repository-write refuses a comment target that is not a pull request', async () => {
  const fake = fakeWith();
  await assert.rejects(onFake(fake, () => writes().postComment(12, 'Review complete')), /pull request #12.*Not Found/);
  assert.deepEqual(commentSent(fake), []);
});

test('repository-write runner directly refuses an issue comment without sending a write', async () => {
  const fake = fakeWith();
  const args = expectedComment('Review complete');
  await assert.rejects(onFake(fake, () => repositoryWriteRunner(args, { emitter: UNKILLED })), /repository-write runner refuses.*pull request #12/);
  assert.deepEqual(commentSent(fake), []);
  assert.deepEqual(fake.sent(), [['api', 'repos/williacj/rigger/pulls/12', '-X', 'GET']]);
});

for (const sha of ['', 'main', 'HEAD']) {
  test(`repository-write runner refuses sha=${sha || '(empty)'} despite the merge argument positions`, async () => {
    const fake = fakeWith();
    const args = ['api', 'repos/williacj/rigger/pulls/12/merge', '-X', 'PUT', '-f', `sha=${sha}`, '-f', 'merge_method=merge'];
    await assert.rejects(onFake(fake, () => repositoryWriteRunner(args, { emitter: UNKILLED })), /repository-write runner refuses/);
    assert.deepEqual(fake.sent(), []);
  });
}

test('a refused comment rejects naming the forge reason', async () => {
  const fake = fakeWith({ pullRequests: [pull()], commentReplies: { 12: { status: '403', message: 'Resource not accessible by integration' } } });
  await assert.rejects(onFake(fake, () => writes().postComment(12, 'Review complete')), /postComment.*Resource not accessible by integration/);
  assert.equal(held(fake).pullRequests[0].comments?.length ?? 0, 0);
  assert.deepEqual(commentSent(fake), [expectedComment('Review complete')]);
});

for (const [name, args] of [
  ['a query', ['api', 'graphql', '-f', 'query=query { viewer { login } }']],
  ['an item mutation', ['api', 'graphql', '-f', 'query=mutation { updateProjectV2ItemFieldValue(input: {projectId: "P"}) { projectV2Item { id } } }']],
  ['a schema mutation', ['api', 'graphql', '-f', 'query=mutation { createLabel(input: {name: "x"}) { label { id } } }']],
  ['mergeBranch', ['api', 'graphql', '-f', 'query=mutation { mergeBranch(input: {base: "main"}) { clientMutationId } }']],
  ...['updateRef', 'createCommitOnBranch', 'updatePullRequestBranch', 'enablePullRequestAutoMerge'].map((name) => [name, ['api', 'graphql', '-f', `query=mutation { ${name}(input: {clientMutationId: "x"}) { clientMutationId } }`]]),
  ['a commit status', ['api', 'repos/williacj/rigger/statuses/abc', '-X', 'POST', '-f', 'state=success']],
  ['another REST call', ['api', 'repos/williacj/rigger/branches/main', '-X', 'DELETE']],
  ['a merge with no SHA', ['api', 'repos/williacj/rigger/pulls/12/merge', '-X', 'PUT', '-f', 'merge_method=merge']],
]) {
  test(`repository-write runner refuses ${name} before sending`, async () => {
    const fake = fakeWith();
    await assert.rejects(onFake(fake, () => repositoryWriteRunner(args)), /repository-write runner refuses/);
    assert.deepEqual(fake.sent(), []);
  });
}
