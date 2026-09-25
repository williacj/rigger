// ABOUTME: Tests the forge adapter's write sides against recorded `gh` answers: the column move,
// creating a field and creating a label, each one write through its own side's runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBoard } from './fake-board.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { itemWriteRunner, readRunner, schemaWriteRunner } from '../src/substrate/forge/runners.mjs';

/** The board every test here works: this repository's config names it the same way. */
const BOARD = { repo: 'williacj/rigger', project: 6 };

/**
 * The board's `Status` field and options as GitHub answers the board read, with the IDs of the
 * throwaway board #212's spike recorded (`docs/spikes/status-option-through-gh.md`) and the
 * option names this repository's config declares.
 */
const BOARD_READ = {
  data: {
    repositoryOwner: {
      projectV2: {
        id: 'PVT_kwHOBzomGc4Bkn7f',
        field: {
          id: 'PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc',
          options: [{ id: 'f75ad846', name: 'Ready' }, { id: '47fc9ee4', name: 'Coding' }, { id: '98236657', name: 'Review' }],
        },
      },
    },
  },
};

/** What `gh` answered on 2026-09-25, gh 2.99.0, to a write naming an ID that resolves to nothing. */
const REFUSED = { status: 1, stdout: '{"data":{"updateProjectV2ItemFieldValue":null},"errors":[]}', stderr: "gh: Could not resolve to a node with the global id of 'PVT_doesnotexist'\n" };

const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

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
    const document = documentOf(args) ?? '';
    if (!document.startsWith('query')) return write(document);
    if (document.includes('repositoryOwner')) return ok(BOARD_READ.data);
    if (document.includes('repository(')) return ok({ repository: { id: 'R_kgDOTcdlSg' } });
    return ok({ project: { field: { id: 'PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc' } }, target: { name: 'Status' } });
  };
  send.sent = sent;
  send.writes = () => sent.filter((request) => !(documentOf(request.slice(1)) ?? '').startsWith('query'));
  return send;
}

/** Whether `runner` admits `args`, asked with a forge that answers its reads and records nothing sent on. */
function admits(runner, args) {
  try {
    runner(args.slice(1), { send: forge() });
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
  assert.ok(admits(itemWriteRunner, write));
  assert.ok(!admits(schemaWriteRunner, write));
  assert.ok(!admits(readRunner, write));
  // And it went through that runner, whose own read of the columns field comes just before it.
  assert.match(documentOf(send.sent.at(-2).slice(1)), /field\(name: "Status"\)/);
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
  assert.ok(admits(schemaWriteRunner, writes[0]));
  assert.ok(!admits(itemWriteRunner, writes[0]));
  assert.ok(!admits(readRunner, writes[0]));
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
  assert.ok(admits(schemaWriteRunner, writes[0]));
  assert.ok(!admits(itemWriteRunner, writes[0]));
  assert.ok(!admits(readRunner, writes[0]));
});

test('a write gh refuses fails naming the operation, the board number and gh\'s first line, and writes nothing more', async () => {
  const calls = {
    moveItem: (send) => itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Review'),
    createField: (send) => schemaWriteSide(BOARD, { send }).createField('Priority', ['High']),
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

/**
 * A call of each fake board operation, on a board holding one item and one column, so the test
 * can see which of them add an entry to the fake's write record. An operation missing here fails
 * the parity test by name rather than being passed over.
 */
const FAKE_CALLS = {
  readItems: [],
  readColumns: [],
  readFields: [],
  readLabels: [],
  moveItem: ['item-1', 'Ready'],
  createColumn: ['Owner'],
  createField: ['Priority', ['High']],
  createLabel: ['type:change'],
};

/** The fake board's writes: the operations whose call adds an entry to its write record. */
async function fakeWrites() {
  const writes = [];
  for (const name of Object.keys(createFakeBoard().operations)) {
    assert.ok(Object.hasOwn(FAKE_CALLS, name), `the fake board offers ${name}, which this test does not know how to call`);
    const board = createFakeBoard({ columns: ['Ready'], items: [{ type: 'issue', number: 1, column: 'Ready' }] });
    await board.operations[name](...FAKE_CALLS[name]);
    if (board.writes().length > 0) writes.push(name);
  }
  return writes;
}

test('the adapter\'s writes are exactly the fake board\'s writes, but createColumn, compared both ways', async () => {
  // #216's parity item, for the writes. The fake's reads are #215's, and so is their parity.
  // `createColumn`, the write adding a `Status` option, waits on #217. The defects this catches
  // are an adapter write the fake cannot stand in for, and a fake write the adapter lacks.
  const excepted = ['createColumn'];
  const fake = (await fakeWrites()).filter((name) => !excepted.includes(name));
  const adapter = [...Object.keys(itemWriteSide(BOARD)), ...Object.keys(schemaWriteSide(BOARD))];

  assert.ok(fake.includes('moveItem') && (await fakeWrites()).includes('createColumn'), `the fake's writes were read as ${fake}`);
  assert.deepEqual(adapter.filter((name) => !fake.includes(name)), [], 'the adapter offers a write the fake board lacks');
  assert.deepEqual(fake.filter((name) => !adapter.includes(name)), [], 'the fake board offers a write the adapter lacks');
});

test('every command the forge adapter runs is gh', async () => {
  // The forge adapter's share of `R-SAFE-2`: every call it makes to the forge is handed to the
  // runner's spawn as `gh`, which holds the credentials the owner already gave it. It declares no
  // proof of the requirement, whose other network paths, git and the agent CLIs, it never reaches.
  const send = forge();
  await itemWriteSide(BOARD, { send }).moveItem('PVTI_1', 'Review');
  await schemaWriteSide(BOARD, { send }).createField('Priority', ['High']);
  await schemaWriteSide(BOARD, { send }).createLabel('type:change');
  readRunner(['auth', 'status'], { send });

  assert.ok(send.sent.length >= 7, `only ${send.sent.length} commands were recorded`);
  assert.deepEqual([...new Set(send.sent.map(([command]) => command))], ['gh']);
});
