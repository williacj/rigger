// ABOUTME: Tests which board the forge adapter addresses: the one the config's board owner holds,
// or the repository's owner's where the config names none, for every operation that finds a board.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validate } from '../src/config/validate.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import rigger from '../rigger.config.mjs';

/** The owner this repository's `repo` names, before the slash. */
const REPOSITORY_OWNER = 'williacj';

/** A board owner other than the repository's owner. */
const DECLARED = 'octo-org';

/** This repository's config declaring `owner` as its board's owner, as a consumer would write it. */
const ownedBy = (owner) => ({ ...rigger, board: { ...rigger.board, owner } });

/**
 * The board the forge adapter is handed for `config`: the board a config declares, with the
 * repository it names beside it. A config that validates is the only kind Rigger works.
 */
function boardFor(config) {
  assert.deepEqual(validate(config), [], 'the config handed to the adapter is one Rigger refuses');
  return { repo: config.repo, ...config.board };
}

const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

/** The document a `gh api graphql -f query=` request carries. */
const documentOf = (args) => args[3].slice('query='.length);

/** The owner a request names where it finds a board by its owner and number, or null. */
const ownerAsked = (document) => document.match(/repositoryOwner\(login: "([^"]*)"\)/)?.[1] ?? null;

/**
 * Whether a request finds a board: by its owner and its number, which is the only way the adapter
 * reaches a board it holds no ID for. A request naming a board by the ID such a request answered
 * addresses the board that request found, and is checked by that ID below.
 */
const findsBoard = (document) => document.includes('projectV2(number:');

/** The board ID each owner's board answers with, so a request naming one names whose board it is. */
const boardId = (owner) => `PVT_${owner}`;

/**
 * A forge holding a board numbered 6 under each of two owners, answering every request the
 * adapter's operations make, and recording each. Each answer is shaped as the adapter's own query
 * selects it, as `test/forge-read.test.mjs` and `test/forge-adapter.test.mjs` hold gh's printed
 * answers to be; the IDs are the board's owner, so a request naming one names which board.
 */
function forge() {
  const sent = [];
  const send = (command, args) => {
    const document = documentOf(args);
    sent.push(document);
    if (!document.startsWith('query')) return ok({});
    const owner = ownerAsked(document);
    if (document.includes('items(')) {
      return ok({ repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: 'MA' }, nodes: [] } } } });
    }
    if (document.includes('fields(')) {
      const options = Object.values(rigger.board.columns).map((name) => ({ name }));
      return ok({ repositoryOwner: { projectV2: { fields: { pageInfo: { hasNextPage: false, endCursor: 'MQ' }, nodes: [{}, { name: 'Status', options }] } } } });
    }
    // The item-write runner's own read of the columns field, which names the board by its ID.
    if (document.includes('node(id:')) {
      const projectId = document.match(/node\(id: "([^"]*)"\)/)[1];
      return ok({ project: { field: { id: `PVTSSF_${projectId.slice('PVT_'.length)}` } }, target: { name: 'Status' } });
    }
    if (document.includes('field(name:')) {
      return ok({ repositoryOwner: { projectV2: { id: boardId(owner), field: { id: `PVTSSF_${owner}`, options: [{ id: 'f75ad846', name: 'Review' }] } } } });
    }
    if (document.includes('labels(')) return ok({ repository: { labels: { pageInfo: { hasNextPage: false, endCursor: 'MA' }, nodes: [] } } });
    if (document.includes('repository(')) return ok({ repository: { id: 'R_kgDOTcdlSg' } });
    throw new Error(`the test forge does not answer ${document}`);
  };
  send.sent = sent;
  return send;
}

/** Every operation the forge adapter offers, each called as its caller would call it. */
const OPERATIONS = {
  readItems: (board, send) => readSide(board, { send }).readItems(),
  readColumns: (board, send) => readSide(board, { send }).readColumns(),
  readFields: (board, send) => readSide(board, { send }).readFields(),
  readLabels: (board, send) => readSide(board, { send }).readLabels(),
  moveItem: (board, send) => itemWriteSide(board, { send }).moveItem('PVTI_1', 'Review'),
  createField: (board, send) => schemaWriteSide(board, { send }).createField('Priority', ['High']),
  createLabel: (board, send) => schemaWriteSide(board, { send }).createLabel('type:change'),
};

/** Every document `operation` sends on the board `config` declares. */
async function sentBy(operation, config) {
  const send = forge();
  await OPERATIONS[operation](boardFor(config), send);
  return send.sent;
}

/**
 * Asserts that every request among `documents` addressing the board addresses `owner`'s: each
 * finding a board names `owner`, each naming a board by ID names `owner`'s, and none names the
 * `other` owner or its board. At least one finds the board.
 */
function addressesOnly(owner, other, documents, operation) {
  const finding = documents.filter(findsBoard);
  assert.ok(finding.length > 0, `${operation} sent no request finding the board`);
  for (const document of finding) assert.equal(ownerAsked(document), owner, `${operation} sent ${document}`);
  for (const document of documents) {
    assert.ok(!document.includes(`login: "${other}"`), `${operation} addressed ${other}: ${document}`);
    assert.ok(!document.includes(boardId(other)), `${operation} named ${other}'s board: ${document}`);
  }
}

test("every request a full read sends that addresses the board names the declared board owner, and never the repository's owner", async () => {
  for (const operation of ['readItems', 'readColumns', 'readFields']) {
    addressesOnly(DECLARED, REPOSITORY_OWNER, await sentBy(operation, ownedBy(DECLARED)), operation);
  }
});

test("the request moveItem sends to find the board names the declared board owner, and never the repository's owner", async () => {
  const sent = await sentBy('moveItem', ownedBy(DECLARED));

  addressesOnly(DECLARED, REPOSITORY_OWNER, sent, 'moveItem');
  // The move itself names the board that request found.
  assert.match(sent.at(-1), new RegExp(`updateProjectV2ItemFieldValue\\(input: \\{projectId: "${boardId(DECLARED)}"`));
});

test("the request createField sends to find the board names the declared board owner, and never the repository's owner", async () => {
  const sent = await sentBy('createField', ownedBy(DECLARED));

  addressesOnly(DECLARED, REPOSITORY_OWNER, sent, 'createField');
  assert.match(sent.at(-1), new RegExp(`createProjectV2Field\\(input: \\{projectId: "${boardId(DECLARED)}"`));
});

test("with no board owner declared, every request that addresses the board names the owner of the repository repo names", async () => {
  assert.ok(!Object.hasOwn(rigger.board, 'owner'), 'this repository declares a board owner, so its absence went untested');
  for (const operation of ['readItems', 'readColumns', 'readFields', 'moveItem', 'createField']) {
    addressesOnly(REPOSITORY_OWNER, DECLARED, await sentBy(operation, rigger), operation);
  }
});

test('the operations the tests above record are every forge adapter operation that addresses the board', async () => {
  // An operation the adapter gains, or one that starts finding a board, is caught here rather
  // than going unrecorded by the four tests above.
  const board = boardFor(rigger);
  const adapter = [...Object.keys(readSide(board)), ...Object.keys(itemWriteSide(board)), ...Object.keys(schemaWriteSide(board))];
  assert.deepEqual([...adapter].sort(), Object.keys(OPERATIONS).sort(), 'an adapter operation has no row here');

  const addressing = [];
  for (const operation of adapter) {
    for (const config of [rigger, ownedBy(DECLARED)]) {
      if ((await sentBy(operation, config)).some(findsBoard) && !addressing.includes(operation)) addressing.push(operation);
    }
  }
  assert.deepEqual(addressing.sort(), ['createField', 'moveItem', 'readColumns', 'readFields', 'readItems']);
});

test("with a board owner declared, readLabels and createLabel address the repository repo names, and no board", async () => {
  for (const operation of ['readLabels', 'createLabel']) {
    const sent = await sentBy(operation, ownedBy(DECLARED));
    const reads = sent.filter((document) => document.startsWith('query'));
    assert.ok(reads.length > 0, `${operation} read nothing`);
    for (const document of reads) {
      assert.match(document, /^query \{ repository\(owner: "williacj", name: "rigger"\) \{/, `${operation} sent ${document}`);
    }
    assert.ok(!sent.some((document) => document.includes(DECLARED) || findsBoard(document)), `${operation} addressed a board: ${sent.join('\n')}`);
  }
});

/** What gh 2.99.0 printed on 2026-09-25 to a read naming a board number that is not there. */
const NO_SUCH_BOARD = { status: 1, stdout: '', stderr: 'gh: Could not resolve to a ProjectV2 with the number 6.\n' };

test('when gh answers no such board, the failure names the board owner the request addressed beside the board number', async () => {
  const calls = {
    readItems: (board, send) => readSide(board, { send }).readItems(),
    moveItem: (board, send) => itemWriteSide(board, { send }).moveItem('PVTI_1', 'Review'),
  };
  const cases = [[ownedBy(DECLARED), DECLARED, REPOSITORY_OWNER], [rigger, REPOSITORY_OWNER, DECLARED]];
  for (const [operation, call] of Object.entries(calls)) {
    for (const [config, owner, other] of cases) {
      const sent = [];
      const send = (command, args) => {
        sent.push(documentOf(args));
        return NO_SUCH_BOARD;
      };
      await assert.rejects(call(boardFor(config), send), (error) => {
        assert.ok(error.message.includes(`${owner}'s board 6`), `${operation} with ${owner}: ${error.message}`);
        assert.ok(!error.message.includes(other), `${operation} with ${owner} names ${other}: ${error.message}`);
        assert.ok(error.message.includes('Could not resolve to a ProjectV2 with the number 6.'), error.message);
        return true;
      });
      assert.equal(ownerAsked(sent[0]), owner, `${operation} asked ${sent[0]}`);
    }
  }
});

test('when gh answers a paged read with no board at all, the failure names the board owner the request addressed beside the board number', async () => {
  // Constructed: an answer holding no board where the read looks for one, which the read reports
  // as no such board however gh came to print it.
  const empty = { status: 0, stdout: JSON.stringify({ data: { repositoryOwner: { projectV2: null } } }), stderr: '' };
  for (const [config, owner] of [[ownedBy(DECLARED), DECLARED], [rigger, REPOSITORY_OWNER]]) {
    await assert.rejects(readSide(boardFor(config), { send: () => empty }).readItems(), (error) => {
      assert.ok(error.message.includes(`${owner}'s board 6`), `with ${owner}: ${error.message}`);
      assert.ok(error.message.includes('no such board'), error.message);
      return true;
    });
  }
});
