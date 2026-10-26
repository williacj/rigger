// ABOUTME: Tests the forge adapter's write sides against recorded `gh` answers: the column move,
// creating a field, adding a column and creating a label, each one write through its own side's
// runner. It also holds the adapter's operations to the fake board's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBoard } from './fake-board.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { itemWriteRunner, readRunner, schemaWriteRunner } from '../src/substrate/forge/runners.mjs';

/** The board every test here works: this repository's config names it the same way. */
const BOARD = { repo: 'williacj/rigger', project: 6 };

/**
 * The board's `Status` field and options as GitHub answers the board read, with the IDs, colours
 * and descriptions of the throwaway board #212's spike recorded
 * (`docs/spikes/status-option-through-gh.md`) and the option names this repository's config
 * declares.
 */
const BOARD_READ = {
  data: {
    repositoryOwner: {
      projectV2: {
        id: 'PVT_kwHOBzomGc4Bkn7f',
        field: {
          id: 'PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc',
          options: [
            { id: 'f75ad846', name: 'Ready', color: 'GREEN', description: "This item hasn't been started" },
            { id: '47fc9ee4', name: 'Coding', color: 'YELLOW', description: 'This is actively being worked on' },
            { id: '98236657', name: 'Review', color: 'PURPLE', description: 'This has been completed' },
          ],
        },
      },
    },
  },
};

/** What `gh` answered on 2026-09-25, gh 2.99.0, to a write naming an ID that resolves to nothing. */
const REFUSED = { status: 1, stdout: '{"data":{"updateProjectV2ItemFieldValue":null},"errors":[]}', stderr: "gh: Could not resolve to a node with the global id of 'PVT_doesnotexist'\n" };

const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

test('repository-write sends a merge commit only with the expected head SHA', async () => {
  const sent = [];
  const sha = 'a'.repeat(40);
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 0, stdout: JSON.stringify(args.includes('GET') ? { state: 'open', merged: false, mergeable: true, head: { sha } } : { merged: true, sha: 'm'.repeat(40) }), stderr: '' };
  };

  assert.deepEqual(await repositoryWriteSide(BOARD, { send }).mergePullRequest(12, sha), { outcome: 'merged', sha: 'm'.repeat(40) });
  assert.deepEqual(sent[1], ['gh', 'api', 'repos/williacj/rigger/pulls/12/merge', '-X', 'PUT', '-f', `sha=${sha}`, '-f', 'merge_method=merge']);
});

test('repository-write posts a comment only on a pull request', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 0, stdout: JSON.stringify(args.includes('GET') ? { state: 'open', merged: false, mergeable: true, head: { sha: 'a'.repeat(40) } } : { id: 1, body: 'review' }), stderr: '' };
  };

  assert.deepEqual(await repositoryWriteSide(BOARD, { send }).postComment(12, 'review'), { id: 1, body: 'review' });
  assert.deepEqual(sent[1], ['gh', 'api', 'repos/williacj/rigger/issues/12/comments', '-X', 'POST', '-f', 'body=review']);
});

test('repository-write exposes a card-issue comment operation with one exact write and no PR preflight', async () => {
  const body = 'Owner input\n$(printf remains-data); "quoted"';
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 0, stdout: JSON.stringify({ id: 7, body }), stderr: '' };
  };

  assert.deepEqual(await repositoryWriteSide(BOARD, { send }).postIssueComment(214, body), { id: 7, body });
  assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/issues/214/comments', '-X', 'POST', '-f', `body=${body}`]]);
});

test('repository-write adds one issue label with one exact POST', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 0, stdout: '[{"name":"existing"},{"name":"customer:publish"}]', stderr: '' };
  };

  assert.deepEqual(await repositoryWriteSide(BOARD, { send }).addIssueLabel(214, 'customer:publish'), [{ name: 'existing' }, { name: 'customer:publish' }]);
  assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/issues/214/labels', '-X', 'POST', '-f', 'labels[]=customer:publish']]);
});

test('the PR-only comment operation writes nothing for failed, timed-out, unreadable or unconfirmed PR preflights', async () => {
  const cases = [
    { name: 'ordinary issue', said: { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }, reason: /Not Found/ },
    { name: 'transport failure', said: { status: 1, stdout: '', stderr: 'network unavailable' }, reason: /network unavailable/ },
    { name: 'timeout', said: { status: 0, timedOut: true, timeout: 42, stdout: '', stderr: '' }, reason: /timeout of 42 ms/ },
    { name: 'unreadable response', said: { status: 0, stdout: 'not JSON', stderr: '' }, reason: /did not confirm/ },
    { name: 'unconfirmed response', said: { status: 0, stdout: '{}', stderr: '' }, reason: /did not confirm/ },
    { name: 'malformed PR head', said: { status: 0, stdout: '{"head":{"sha":"not-a-head-sha"}}', stderr: '' }, reason: /did not confirm/ },
  ];
  for (const { name, said, reason } of cases) {
    const sent = [];
    const send = (command, args) => { sent.push([command, ...args]); return said; };

    await assert.rejects(repositoryWriteSide(BOARD, { send }).postComment(12, 'Review'), (error) => /postComment on pull request #12 failed/.test(error.message) && reason.test(error.message), name);
    assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/pulls/12', '-X', 'GET']], name);
  }
});

test('a failed PR preflight retains the did-not-confirm diagnosis and the underlying read reason', async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return { status: 1, stdout: '', stderr: 'gh: the read failed' };
  };
  await assert.rejects(repositoryWriteSide(BOARD, { send }).postComment(12, 'Review'), /postComment on pull request #12.*did not confirm.*the read failed/);
  assert.deepEqual(sent, [['gh', 'api', 'repos/williacj/rigger/pulls/12', '-X', 'GET']]);
});

test('issue writes name their operation, issue and reason for HTTP refusals, transport failures and timeouts', async () => {
  const failures = [
    { status: 1, stdout: '{"message":"Validation Failed","status":422}', stderr: 'gh: Validation Failed (HTTP 422)' },
    { status: 1, stdout: '', stderr: 'network unavailable' },
    { status: 0, timedOut: true, timeout: 42, stdout: '', stderr: '' },
  ];
  for (const operation of ['postIssueComment', 'addIssueLabel']) {
    for (const [index, said] of failures.entries()) {
      const sent = [];
      const send = (command, args) => { sent.push([command, ...args]); return said; };
      await assert.rejects(repositoryWriteSide(BOARD, { send })[operation](214, 'payload'), (error) =>
        error.message.includes(`${operation} on issue #214 failed:`)
        && [/Validation Failed/, /network unavailable/, /timeout of 42 ms/][index].test(error.message));
      assert.equal(sent.length, 1);
    }
  }
});

test('comment and label operations contextualize thrown transport errors without losing their code or cause', async () => {
  for (const operation of ['postIssueComment', 'addIssueLabel', 'postComment']) {
    const original = Object.assign(new Error('spawn unavailable'), { code: 'EVENT_REFUSED' });
    const sent = [];
    const send = (command, args) => { sent.push([command, ...args]); throw original; };
    await assert.rejects(repositoryWriteSide(BOARD, { send })[operation](214, 'payload'), (error) =>
      error.message.includes(`${operation} on ${operation === 'postComment' ? 'pull request' : 'issue'} #214 failed: spawn unavailable`)
      && error.code === original.code && error.cause === original, operation);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][4], operation === 'postComment' ? 'GET' : 'POST');
  }
});

test('issue writes and PR comments refuse invalid target numbers before sending', async () => {
  for (const operation of ['postIssueComment', 'addIssueLabel', 'postComment']) {
    for (const target of [undefined, 0, -1, '214', '214/extra', 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const sent = [];
      const send = (command, args) => { sent.push([command, ...args]); return { status: 0, stdout: '{}', stderr: '' }; };
      await assert.rejects(repositoryWriteSide(BOARD, { send })[operation](target, 'payload'), (error) =>
        error.message.includes(operation) && error.message.includes(`#${target}`));
      assert.deepEqual(sent, [], `${operation} target ${target}`);
    }
  }
});

test('the label adapter refuses absent or multiple label names before sending', async () => {
  for (const label of [undefined, '', [], ['one', 'two']]) {
    const sent = [];
    const send = (command, args) => { sent.push([command, ...args]); return { status: 0, stdout: '[]', stderr: '' }; };
    await assert.rejects(repositoryWriteSide(BOARD, { send }).addIssueLabel(214, label), /addIssueLabel on issue #214.*one label name/);
    assert.deepEqual(sent, []);
  }
});

/** The document a `gh api graphql -f query=` request carries, or null for any other request. */
const documentOf = (sent) => (sent[3]?.startsWith('query=') ? sent[3].slice('query='.length) : null);

/**
 * A forge answering every read these sides make, and every write with `write`, recording each
 * request. Reads are told from writes by their document's first word, which is how GitHub tells
 * them apart too.
 */
function forge(write = () => ok({})) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    if (args[1] === 'repos/williacj/rigger/issues/214' && args[3] === 'GET') return { status: 0, stdout: JSON.stringify({ node_id: 'I_issue214' }), stderr: '' };
    const document = documentOf(args) ?? '';
    if (!document.startsWith('query')) return write(document);
    if (document.includes('repositoryOwner')) return ok(BOARD_READ.data);
    if (document.includes('repository(')) return ok({ repository: { id: 'R_kgDOTcdlSg' } });
    // The schema-write runner's own read of the options the field holding the columns holds.
    if (document.includes('field: node(')) return ok({ field: { name: 'Status', options: BOARD_READ.data.repositoryOwner.projectV2.field.options } });
    return ok({ project: { field: { id: 'PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc' } }, target: { name: 'Status' } });
  };
  send.sent = sent;
  send.writes = () => sent.filter((request) => !(documentOf(request.slice(1)) ?? '').startsWith('query'));
  return send;
}

/** Whether `runner` admits `args`, asked with a forge that answers its reads and records nothing sent on. */
async function admits(runner, args) {
  try {
    await runner(args.slice(1), { send: forge() });
    return true;
  } catch {
    return false;
  }
}

test('moving a card issues exactly one write, through the item-write runner, naming its board item and its column\'s option', async () => {
  const send = forge();

  await itemWriteSide(BOARD, { send }).moveItem('PVTI_lADOBzomGc4Bkn7fzgd', 'Review');

  const writes = send.writes();
  assert.equal(writes.length, 1, JSON.stringify(send.sent));
  const [write] = writes;
  assert.match(documentOf(write.slice(1)), /updateProjectV2ItemFieldValue/);
  assert.match(documentOf(write.slice(1)), /itemId: "PVTI_lADOBzomGc4Bkn7fzgd"/);
  assert.match(documentOf(write.slice(1)), /singleSelectOptionId: "98236657"/);
  // It is the item side's: the item-write runner admits it, and neither other runner does.
  assert.ok(await admits(itemWriteRunner, write));
  assert.ok(!(await admits(schemaWriteRunner, write)));
  assert.ok(!(await admits(readRunner, write)));
  // And it went through that runner, whose own read of the columns field comes just before it.
  assert.match(documentOf(send.sent.at(-2).slice(1)), /field\(name: "Status"\)/);
});

test('adding an issue uses its node read and the item-write runner for one board add', async () => {
  const send = forge(() => ok({ addProjectV2ItemById: { item: { id: 'PVTI_added' } } }));

  assert.equal(await itemWriteSide(BOARD, { send }).addIssue(214), 'PVTI_added');

  assert.deepEqual(send.sent[0], ['gh', 'api', 'repos/williacj/rigger/issues/214', '-X', 'GET']);
  const writes = send.writes();
  assert.equal(writes.length, 2, JSON.stringify(send.sent));
  const add = writes.at(-1);
  assert.match(documentOf(add.slice(1)), /addProjectV2ItemById\(input: \{projectId: "PVT_kwHOBzomGc4Bkn7f", contentId: "I_issue214"\}\)/);
  assert.ok(await admits(itemWriteRunner, add));
  assert.ok(!(await admits(schemaWriteRunner, add)));
  assert.ok(!(await admits(readRunner, add)));
});

test('moving a card to a column the board does not hold fails naming the column, and writes nothing', async () => {
  const send = forge();
  await assert.rejects(itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Owner'), /Owner/);
  assert.deepEqual(send.writes(), []);
});

test('creating a single-select field issues exactly one write, through the schema-write runner, naming it and its options in order', async () => {
  const send = forge();
  // Out of alphabetical order, so an order the side imposed would show.
  const options = ['Normal', 'High', 'Low'];

  await schemaWriteSide(BOARD, { send }).createField('Priority', options);

  const writes = send.writes();
  assert.equal(writes.length, 1, JSON.stringify(send.sent));
  const document = documentOf(writes[0].slice(1));
  assert.match(document, /createProjectV2Field/);
  assert.match(document, /projectId: "PVT_kwHOBzomGc4Bkn7f"/);
  assert.match(document, /name: "Priority"/);
  assert.match(document, /dataType: SINGLE_SELECT/);
  const at = options.map((option) => document.indexOf(`name: "${option}"`));
  assert.ok(at.every((index) => index > 0), document);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `the options are not in the order given: ${document}`);
  assert.ok(await admits(schemaWriteRunner, writes[0]));
  assert.ok(!(await admits(itemWriteRunner, writes[0])));
  assert.ok(!(await admits(readRunner, writes[0])));
});

test('creating a label issues exactly one write, through the schema-write runner, naming the label', async () => {
  const send = forge();

  await schemaWriteSide(BOARD, { send }).createLabel('type:change');

  const writes = send.writes();
  assert.equal(writes.length, 1, JSON.stringify(send.sent));
  const document = documentOf(writes[0].slice(1));
  assert.match(document, /createLabel/);
  assert.match(document, /repositoryId: "R_kgDOTcdlSg"/);
  assert.match(document, /name: "type:change"/);
  assert.ok(await admits(schemaWriteRunner, writes[0]));
  assert.ok(!(await admits(itemWriteRunner, writes[0])));
  assert.ok(!(await admits(readRunner, writes[0])));
});

test('adding a column issues exactly one write, through the schema-write runner, sending every held option with its id and the new one without', async () => {
  const send = forge();

  await schemaWriteSide(BOARD, { send }).createColumn('Owner');

  const writes = send.writes();
  assert.equal(writes.length, 1, JSON.stringify(send.sent));
  // Way B, as #212's report sent it (`docs/spikes/status-option-through-gh.md`, "The ways tried"),
  // written out by hand from BOARD_READ, with the new option given the neutral grey.
  assert.equal(
    documentOf(writes[0].slice(1)),
    'mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc", singleSelectOptions: ['
      + '{id: "f75ad846", name: "Ready", color: GREEN, description: "This item hasn\'t been started"}, '
      + '{id: "47fc9ee4", name: "Coding", color: YELLOW, description: "This is actively being worked on"}, '
      + '{id: "98236657", name: "Review", color: PURPLE, description: "This has been completed"}, '
      + '{name: "Owner", color: GRAY, description: ""}'
      + ']}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }',
  );
  assert.ok(await admits(schemaWriteRunner, writes[0]));
  assert.ok(!(await admits(itemWriteRunner, writes[0])));
  assert.ok(!(await admits(readRunner, writes[0])));
  // And it went through that runner, whose own read of the field's options comes just before it.
  assert.match(documentOf(send.sent.at(-2).slice(1)), /field: node\(id: "PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc"\)/);
});

test('a write gh refuses fails naming the operation, the board number and gh\'s first line, and writes nothing more', async () => {
  const calls = {
    moveItem: (send) => itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Review'),
    createField: (send) => schemaWriteSide(BOARD, { send }).createField('Priority', ['High']),
    createColumn: (send) => schemaWriteSide(BOARD, { send }).createColumn('Owner'),
    createLabel: (send) => schemaWriteSide(BOARD, { send }).createLabel('type:change'),
  };
  for (const [operation, call] of Object.entries(calls)) {
    const send = forge(() => REFUSED);
    await assert.rejects(call(send), (error) => {
      assert.ok(error.message.includes(operation), error.message);
      assert.ok(error.message.includes('board 6'), error.message);
      assert.ok(error.message.includes("Could not resolve to a node with the global id of 'PVT_doesnotexist'"), error.message);
      return true;
    });
    assert.equal(send.writes().length, 1, `${operation} wrote again after gh refused`);
  }
});

test('a read gh fails before a write fails naming the operation, the board number and gh\'s first line, and writes nothing', async () => {
  // gh 2.99.0 answered this, on 2026-09-25, to the board read naming a board number that is not there.
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    return { status: 1, stdout: '', stderr: 'gh: Could not resolve to a ProjectV2 with the number 6.\n' };
  };
  await assert.rejects(itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Review'), /moveItem.*board 6.*Could not resolve to a ProjectV2/);
  assert.equal(sent.length, 1);
});

test('the adapter\'s operations, reads and writes alike, are exactly the fake board\'s, compared both ways', async () => {
  // The defects this catches are an adapter operation the fake cannot stand in for, and a fake
  // operation the adapter lacks.
  const fake = Object.keys(createFakeBoard().operations);
  const adapter = [...Object.keys(readSide(BOARD)), ...Object.keys(itemWriteSide(BOARD)), ...Object.keys(schemaWriteSide(BOARD))];

  assert.ok(fake.length > 0, 'the fake board offers no operation, so the comparison is vacuous');
  assert.deepEqual(adapter.filter((name) => !fake.includes(name)), [], 'the adapter offers an operation the fake board lacks');
  assert.deepEqual(fake.filter((name) => !adapter.includes(name)), [], 'the fake board offers an operation the adapter lacks');
});

test('every command the forge adapter runs is gh', async () => {
  // The forge adapter's share of `R-SAFE-2`: every call it makes to the forge is handed to the
  // runner's spawn as `gh`, which holds the credentials the owner already gave it. It declares no
  // proof of the requirement, whose other network paths, git and the agent CLIs, it never reaches.
  const send = forge();
  await itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Review');
  await schemaWriteSide(BOARD, { send }).createField('Priority', ['High']);
  await schemaWriteSide(BOARD, { send }).createColumn('Owner');
  await schemaWriteSide(BOARD, { send }).createLabel('type:change');
  readRunner(['auth', 'status'], { send });

  assert.ok(send.sent.length >= 10, `only ${send.sent.length} commands were recorded`);
  assert.deepEqual([...new Set(send.sent.map(([command]) => command))], ['gh']);
});
