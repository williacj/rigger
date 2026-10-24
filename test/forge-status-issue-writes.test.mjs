// ABOUTME: Tests the forge write sides and runners that open, close, unlabel and place a status issue.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { repositoryWriteRunner, itemWriteRunner, graphqlRequest } from '../src/substrate/forge/runners.mjs';

const BOARD = { repo: 'williacj/rigger', project: 6 };
const ok = (body) => ({ status: 0, stdout: JSON.stringify(body), stderr: '' });
const boardRead = () => ok({ data: { repositoryOwner: { projectV2: { id: 'PVT_board', field: { id: 'PVTSSF_status', options: [{ id: 'opt_owner', name: 'Owner' }] } } } } });

test('opening one issue sends its title, body and one label together and answers its number', async () => {
  const title = 'Rigger closed admission';
  const body = 'Host failure\n$(printf stays-data) "quoted"';
  const label = 'rigger:status';
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return ok({ number: 214, labels: [{ name: label }] });
  };

  assert.equal(await repositoryWriteSide(BOARD, { send }).openIssue(title, body, label), 214);
  assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/issues', '-X', 'POST', '-f', `title=${title}`, '-f', `body=${body}`, '-f', `labels[]=${label}`]]);
});

test('an opening whose answer dropped the requested label rejects with the new number and label', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return ok({ number: 215, labels: [] });
  };

  await assert.rejects(repositoryWriteSide(BOARD, { send }).openIssue('Status', 'Hold', 'rigger:status'),
    /openIssue.*215.*rigger:status/);
  assert.equal(sent.length, 1);
});

test('closing one issue sends only a closed state patch', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return ok({ number: 214, state: 'closed' });
  };

  await repositoryWriteSide(BOARD, { send }).closeIssue(214);
  assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/issues/214', '-X', 'PATCH', '-f', 'state=closed']]);
});

test('removing one label encodes it as one path segment and sends no field', async () => {
  const label = 'customer/a? #\n';
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return ok([]);
  };

  await repositoryWriteSide(BOARD, { send }).removeIssueLabel(214, label);
  assert.deepEqual(sent, [['gh', 'api', `repos/williacj/rigger/issues/214/labels/${encodeURIComponent(label)}`, '-X', 'DELETE']]);
});

test('adding an issue reads its node id by number, adds it to the board and answers the item id', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    if (args[1] === 'repos/williacj/rigger/issues/214') return ok({ node_id: 'I_issue214' });
    if (args.at(-1).startsWith('query=query')) return boardRead();
    return ok({ data: { addProjectV2ItemById: { item: { id: 'PVTI_added' } } } });
  };

  assert.equal(await itemWriteSide(BOARD, { send }).addIssue(214), 'PVTI_added');
  assert.deepEqual(sent[0], ['gh', 'api', 'repos/williacj/rigger/issues/214', '-X', 'GET']);
  assert.match(sent[1].at(-1), /repositoryOwner/);
  assert.match(sent[2].at(-1), /addProjectV2ItemById\(input: \{projectId: "PVT_board", contentId: "I_issue214"\}\)/);
});

test('the opening runner refuses missing, empty, multiple or foreign fields without sending', async () => {
  const path = 'repos/williacj/rigger/issues';
  const fields = ['-f', 'title=Status', '-f', 'body=Hold', '-f', 'labels[]=rigger:status'];
  const refused = [
    fields.slice(2),
    [...fields.slice(0, 2), ...fields.slice(4)],
    fields.slice(0, 4),
    ['-f', 'title=', ...fields.slice(2)],
    [...fields.slice(0, 2), '-f', 'body=', ...fields.slice(4)],
    [...fields, '-f', 'labels[]=second'],
    [...fields, '-f', 'milestone=1'],
  ];
  for (const tail of refused) {
    const sent = [];
    await assert.rejects(repositoryWriteRunner(['api', path, '-X', 'POST', ...tail], {
      send: (command, args) => { sent.push([command, ...args]); return ok({}); },
    }), /repository-write runner refuses/, JSON.stringify(tail));
    assert.deepEqual(sent, [], JSON.stringify(tail));
  }
});

test('the write sides refuse invalid inputs before sending any request', async () => {
  const sent = [];
  const send = (command, args) => { sent.push([command, ...args]); return ok({}); };
  const repository = repositoryWriteSide(BOARD, { send });
  for (const args of [[undefined, 'body', 'label'], ['title', undefined, 'label'], ['title', 'body', undefined], ['title', 'body', ['one', 'two']]]) {
    await assert.rejects(repository.openIssue(...args), /openIssue/);
  }
  for (const target of [undefined, 0, -1, '214', 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(repository.closeIssue(target), /closeIssue/);
    await assert.rejects(repository.removeIssueLabel(target, 'label'), /removeIssueLabel/);
    await assert.rejects(itemWriteSide(BOARD, { send }).addIssue(target), /addIssue/);
  }
  for (const label of [undefined, '', ['one', 'two']]) {
    await assert.rejects(repository.removeIssueLabel(214, label), /removeIssueLabel/);
  }
  assert.deepEqual(sent, []);
});

test('a refused board add names the issue and leaves the opened issue intact', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    if (args[1] === 'repos/williacj/rigger/issues' && args[3] === 'POST') return ok({ number: 214, labels: [{ name: 'rigger:status' }] });
    if (args[1] === 'repos/williacj/rigger/issues/214') return ok({ node_id: 'I_issue214' });
    if (args.at(-1).startsWith('query=query')) return boardRead();
    return { status: 1, stderr: 'gh: Resource not accessible (HTTP 403)', stdout: '' };
  };
  const opened = await repositoryWriteSide(BOARD, { send }).openIssue('Status', 'Hold', 'rigger:status');

  await assert.rejects(itemWriteSide(BOARD, { send }).addIssue(opened), /addIssue.*issue #214.*403/);
  assert.equal(sent.filter((request) => request[2] === 'graphql' && request.at(-1).startsWith('query=mutation')).length, 1);
  assert.equal(sent.filter((request) => request.includes('DELETE')).length, 0);
});

test('the close and remove runners refuse other state, other fields, whole-set deletion and extra segments', async () => {
  const base = 'repos/williacj/rigger/issues/214';
  const refused = [
    ['api', base, '-X', 'PATCH', '-f', 'state=open'],
    ['api', base, '-X', 'PATCH', '-f', 'state=closed', '-f', 'title=changed'],
    ['api', `${base}/labels`, '-X', 'DELETE'],
    ['api', `${base}/labels/`, '-X', 'DELETE'],
    ['api', `${base}/labels/one/two`, '-X', 'DELETE'],
    ['api', `${base}/labels/one`, '-X', 'DELETE', '-f', 'other=value'],
    ...['', '0', '-1', 'not-a-number', '1.5', '214/extra'].map((target) => ['api', `repos/williacj/rigger/issues/${target}`, '-X', 'PATCH', '-f', 'state=closed']),
  ];
  for (const args of refused) {
    const sent = [];
    await assert.rejects(repositoryWriteRunner(args, { send: (command, request) => { sent.push([command, ...request]); return ok({}); } }), /repository-write runner refuses/, JSON.stringify(args));
    assert.deepEqual(sent, [], JSON.stringify(args));
  }
});

test('the item runner admits one content add and refuses a second item or foreign input without sending', async () => {
  const mutation = (input) => graphqlRequest(`mutation { addProjectV2ItemById(input: {${input}}) { item { id } } }`);
  const valid = mutation('projectId: "PVT_board", contentId: "I_issue214"');
  const sent = [];
  await itemWriteRunner(valid, { send: (command, args) => { sent.push([command, ...args]); return ok({}); } });
  assert.deepEqual(sent, [['gh', ...valid]]);
  for (const input of [
    'projectId: "PVT_board"',
    'contentId: "I_issue214"',
    'projectId: 6, contentId: "I_issue214"',
    'projectId: "PVT_board", contentId: 214',
    'projectId: "PVT_board", contentId: "I_issue214", itemId: "PVTI_other"',
    'projectId: "PVT_board", contentId: "I_issue214", contentId: "I_other"',
  ]) {
    const refused = [];
    await assert.rejects(itemWriteRunner(mutation(input), { send: (command, args) => { refused.push([command, ...args]); return ok({}); } }), /item-write runner refuses/, input);
    assert.deepEqual(refused, [], input);
  }
});

test('an issue node-id read refusal or timeout sends no board mutation', async () => {
  for (const said of [
    { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
    { status: 0, timedOut: true, timeout: 42, stdout: '', stderr: '' },
  ]) {
    const sent = [];
    const send = (command, args) => { sent.push([command, ...args]); return said; };
    await assert.rejects(itemWriteSide(BOARD, { send }).addIssue(214), (error) =>
      /addIssue.*issue #214/.test(error.message) && /404|timeout of 42 ms/.test(error.message));
    assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/issues/214', '-X', 'GET']]);
  }
});

test('HTTP refusals and timeouts name each repository operation and target', async () => {
  for (const said of [
    { status: 1, stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)' },
    { status: 0, timedOut: true, timeout: 42, stdout: '', stderr: '' },
  ]) {
    const sent = [];
    const side = repositoryWriteSide(BOARD, { send: (command, args) => { sent.push([command, ...args]); return said; } });
    for (const [operation, call, target] of [
      ['openIssue', () => side.openIssue('Status', 'Hold', 'rigger:status'), 'williacj/rigger'],
      ['closeIssue', () => side.closeIssue(214), '#214'],
      ['removeIssueLabel', () => side.removeIssueLabel(214, 'rigger:status'), '#214'],
    ]) {
      await assert.rejects(call(), (error) => error.message.includes(operation) && error.message.includes(target) && /403|timeout of 42 ms/.test(error.message));
    }
    assert.equal(sent.length, 3);
  }
});

test('removing an absent label rejects with the forge refusal and sends no further request', async () => {
  const sent = [];
  await assert.rejects(repositoryWriteSide(BOARD, { send: (command, args) => {
    sent.push([command, ...args]);
    return { status: 1, stdout: '', stderr: 'gh: Label does not exist (HTTP 404)' };
  } }).removeIssueLabel(214, 'rigger:status'), /removeIssueLabel.*#214.*Label does not exist.*404/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][4], 'DELETE');
});

test('the newly added item id can be handed to the existing move into Owner', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    if (args[1] === 'repos/williacj/rigger/issues/214') return ok({ node_id: 'I_issue214' });
    if (args.at(-1).startsWith('query=query') && args.at(-1).includes('repositoryOwner')) return boardRead();
    if (args.at(-1).startsWith('query=query')) return ok({ data: { project: { field: { id: 'PVTSSF_status' } }, target: { name: 'Status' } } });
    if (args.at(-1).includes('addProjectV2ItemById')) return ok({ data: { addProjectV2ItemById: { item: { id: 'PVTI_added' } } } });
    return ok({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_added' } } } });
  };
  const side = itemWriteSide(BOARD, { send });
  const itemId = await side.addIssue(214);
  await side.moveItem(itemId, 'Owner');

  const move = sent.at(-1).at(-1);
  assert.match(move, /itemId: "PVTI_added"/);
  assert.match(move, /singleSelectOptionId: "opt_owner"/);
});

test('the opening runner admits arbitrary title, body and label data by shape alone', async () => {
  for (const data of ['line\nbreak', '"quoted"', '$(printf data); &|<>']) {
    const args = ['api', 'repos/williacj/rigger/issues', '-X', 'POST', '-f', `title=${data}`, '-f', `body=${data}`, '-f', `labels[]=${data}`];
    const sent = [];
    await repositoryWriteRunner(args, { send: (command, request) => { sent.push([command, ...request]); return ok({}); } });
    assert.deepEqual(sent, [['gh', ...args]]);
  }
});

test('a timed-out board add names its issue and the timeout', async () => {
  const send = (command, args) => {
    if (args[1] === 'repos/williacj/rigger/issues/214') return ok({ node_id: 'I_issue214' });
    if (args.at(-1).startsWith('query=query')) return boardRead();
    return { status: 0, timedOut: true, timeout: 42, stdout: '', stderr: '' };
  };
  await assert.rejects(itemWriteSide(BOARD, { send }).addIssue(214), /addIssue.*issue #214.*timeout of 42 ms/);
});
