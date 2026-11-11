// ABOUTME: Tests the forge history read and L2's acceptance records at accepted column changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { fixedCommand } from './in-process-fixtures.mjs';
import { manualClock } from './clock-report-world.mjs';
import { openingTransport } from './opening-transport.mjs';
import { historyWorld } from './acceptance-history-world.mjs';
import { isHistoryRequest } from './acceptance-history-world.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { acceptanceDigest } from '../src/workflow/marker.mjs';
import { acceptanceItems } from '../src/workflow/form-check.mjs';

const BOARD = { repo: 'williacj/rigger', project: 6 };

/** Selected fields by path, independent of whitespace, field order and additional selections. */
function selectedFields(selections, prefix = '') {
  return selections.flatMap((field) => {
    if (field.kind === 'fragment') return selectedFields(field.selections ?? [], prefix);
    const path = prefix === '' ? field.name : `${prefix}.${field.name}`;
    return [[path, field], ...selectedFields(field.selections, path)];
  });
}

// The missing read, a truncated body, a lost editor or a newest-first answer loses the ledger.
// proves R-CARD-6
test('the history read returns every captured body and its editor, edit time and opening through the read runner', async () => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const deadline = 47_000;
  // Unedited stdout of gh api graphql on 2026-11-10 after gh auth status, for #1302:
  // query { repository(owner: "williacj", name: "rigger") { issue(number: 1302) {
  // createdAt author { login } body userContentEdits(first: 100) { pageInfo {
  // hasNextPage endCursor } nodes { editedAt editor { login } deletedAt diff } } } } }
  const printed = readFileSync(new URL('./fixtures/rigger-issue-history-2026-11-10.json', import.meta.url), 'utf8');
  const captured = JSON.parse(printed).data.repository.issue;
  assert.ok([...captured.body].length > 8192, 'the capture exercises a body beyond the old truncation threshold');
  const fixture = fixedCommand({ stdout: printed });
  const transport = openingTransport((args) => fixture.run(args));
  const requests = [];
  const send = async (command, args, options) => {
    requests.push({ command, args, side: options.side, timeout: options.timeout, at: clock.now() });
    return transport.send(command, args, options);
  };
  const reads = repositoryReads(BOARD, { send, emitter: transport.emitter, timeout: deadline });
  assert.equal(typeof reads.readIssueHistory, 'function', 'the repository read side exposes issue body history');

  let answer;
  await assert.doesNotReject(async () => { answer = await reads.readIssueHistory(1302); }, 'the captured issue is answered');

  assert.deepEqual(answer.opened, { at: '2026-11-09T03:05:58Z', by: 'williacj' });
  assert.equal(Buffer.from(answer.body).equals(Buffer.from(captured.body)), true, 'the current body is returned byte for byte');
  assert.deepEqual(answer.revisions.map(({ editedAt }) => editedAt), [
    '2026-11-09T03:05:58Z', '2026-11-09T03:06:19Z',
    '2026-11-09T03:26:16Z', '2026-11-09T03:32:20Z',
  ], 'the four revisions are oldest first');
  for (const revision of answer.revisions) {
    const original = captured.userContentEdits.nodes.find(({ editedAt }) => editedAt === revision.editedAt);
    assert.equal(Buffer.from(revision.body).equals(Buffer.from(original.diff)), true, `the full body at ${revision.editedAt}`);
    assert.equal(revision.editor, 'williacj', `the editor at ${revision.editedAt}`);
    assert.equal(revision.deleted, false, `the content remains available at ${revision.editedAt}`);
  }
  assert.ok(requests.length > 0, 'the history is read from the forge');
  const [{ command, args, side, timeout }] = requests;
  assert.equal(command, 'gh');
  assert.equal(side, 'read', 'the request passed through the read-side runner');
  assert.equal(timeout, deadline, 'the read forwards its caller\'s deadline');
  assert.deepEqual(args.slice(0, 3), ['api', 'graphql', '-f']);
  const query = args[3].slice('query='.length);
  const document = parseDocument(query);
  assert.deepEqual(document.operations.map(({ type }) => type), ['query'], 'the history request is a query, never a mutation');
  const selections = new Map(selectedFields(document.operations[0].selections));
  for (const field of ['createdAt', 'author.login', 'body',
    'userContentEdits.pageInfo.hasNextPage', 'userContentEdits.pageInfo.endCursor',
    'userContentEdits.nodes.editedAt', 'userContentEdits.nodes.editor.login',
    'userContentEdits.nodes.deletedAt', 'userContentEdits.nodes.diff']) {
    assert.ok(selections.has(`repository.issue.${field}`), `the query selects ${field}`);
  }
  const argument = (path, name) => selections.get(path).arguments.find((argument) => argument.name === name)?.value;
  assert.deepEqual(argument('repository', 'owner'), { kind: 'string', value: 'williacj' });
  assert.deepEqual(argument('repository', 'name'), { kind: 'string', value: 'rigger' });
  assert.deepEqual(argument('repository.issue', 'number'), { kind: 'scalar', value: '1302' }, 'the captured answer is requested for the actual issue number');
});

// M6: a deleted snapshot has no body to hash, but remains between its neighbours.
// proves R-CARD-6
test('a deleted history revision retains its identity and position without digest or item count', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = '## Acceptance\n\n- Retain the available body.\n';
  // UserContentEdit introspection: deletedAt is nullable DateTime and diff nullable String.
  const nodes = [
    { editedAt: '2026-10-01T00:00:02Z', editor: { login: 'last-editor' }, deletedAt: null, diff: body },
    { editedAt: '2026-10-01T00:00:01Z', editor: { login: 'deleted-editor' }, deletedAt: '2026-10-02T00:00:00Z', diff: null },
    { editedAt: '2026-10-01T00:00:00Z', editor: { login: 'rigger-fake' }, deletedAt: null, diff: body },
  ];
  const world = historyWorld(t, { clock, body, history: { userContentEdits: { nodes } } });
  const card = await world.card();
  await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }), 'a deleted body does not prevent recording the available history');
  const records = world.histories();
  assert.equal(records.length, 1, 'the accepted move records one history');
  assert.deepEqual(records[0].revisions.map(({ editedAt, editor, deleted }) => ({ editedAt, editor, deleted })), [
    { editedAt: '2026-10-01T00:00:00Z', editor: 'rigger-fake', deleted: false },
    { editedAt: '2026-10-01T00:00:01Z', editor: 'deleted-editor', deleted: true },
    { editedAt: '2026-10-01T00:00:02Z', editor: 'last-editor', deleted: false },
  ]);
  assert.deepEqual(records[0].revisions[1], { editedAt: '2026-10-01T00:00:01Z', editor: 'deleted-editor', deleted: true }, 'the deleted revision has neither digest nor items');
  assert.equal(records[0].revisions[0].items, 1);
  assert.equal(records[0].revisions[2].items, 1);
});

// M2–M5: recording only the current body loses intervening edits and misattributes other editors.
// proves R-CARD-6
test('each accepted move records every intervening editor and revision, and outside edits preserve parsed acceptance metrics', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = (bullets, context = 'Context.') => `${context}\n- Outside the section.\n\n## Acceptance\n\n${bullets}\n- [x] A task is not a plain item.\n\n\`\`\`text\n- A fenced bullet is not an item.\n\`\`\`\n`;
  const bodies = [
    body('- Ship blue.'), body('- Ship blue.\n- Keep logs.'),
    body('- Ship green.\n- Keep logs.'), body('- Ship green.\n- Keep logs.\n- Keep logs.'),
    body('- Ship blue.\n- Keep logs.'), body('- Ship blue.\n- Keep logs.', 'Different context.'),
  ];
  assert.equal(bodies[4], bodies[1], 'the later rewrite repeats an earlier body byte for byte');
  // Same field names/nesting as the captured gh answer; values are this worked history.
  const edits = bodies.map((diff, index) => ({
    editedAt: `2026-10-01T00:00:0${index}Z`,
    editor: { login: index === 2 ? 'null' : 'rigger-fake' }, deletedAt: null, diff,
  }));
  const snapshot = (count) => ({
    createdAt: '2026-10-01T00:00:00Z', author: { login: 'rigger-fake' },
    userContentEdits: { nodes: edits.slice(0, count).toReversed() },
  });
  const world = historyWorld(t, { clock, body: bodies[1], history: snapshot(2) });
  const card = await world.card();
  const began = world.events().length;
  let owner, review, done;
  await assert.doesNotReject(async () => { owner = await world.changes.moved(card, { to: 'owner' }); });
  world.replaceHistory(bodies[4], snapshot(5));
  await clock.advance(clock.now() + 1000);
  await assert.doesNotReject(async () => { review = await world.changes.moved({ ...card, column: owner }, { to: 'review' }); });
  world.replaceHistory(bodies[5], snapshot(6));
  await clock.advance(clock.now() + 1000);
  await assert.doesNotReject(async () => { done = await world.changes.moved({ ...card, column: review }, { to: 'done' }); });
  assert.deepEqual([owner, review, done], ['Owner', 'Review', 'Done']);

  // Independently worked item texts, including the duplicate; no production form reader is the oracle.
  const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  const revisions = [
    { editedAt: '2026-10-01T00:00:00Z', editor: 'rigger-fake', deleted: false, digest: sha('Ship blue.\n'), items: 1 },
    { editedAt: '2026-10-01T00:00:01Z', editor: 'rigger-fake', deleted: false, digest: sha('Ship blue.\nKeep logs.\n'), items: 2 },
    { editedAt: '2026-10-01T00:00:02Z', editor: 'null', deleted: false, digest: sha('Ship green.\nKeep logs.\n'), items: 2 },
    { editedAt: '2026-10-01T00:00:03Z', editor: 'rigger-fake', deleted: false, digest: sha('Ship green.\nKeep logs.\nKeep logs.\n'), items: 3 },
    { editedAt: '2026-10-01T00:00:04Z', editor: 'rigger-fake', deleted: false, digest: sha('Ship blue.\nKeep logs.\n'), items: 2 },
    { editedAt: '2026-10-01T00:00:05Z', editor: 'rigger-fake', deleted: false, digest: sha('Ship blue.\nKeep logs.\n'), items: 2 },
  ];
  const histories = world.histories();
  assert.deepEqual(histories, [2, 5, 6].map((count, index) => ({
    ts: `2026-11-10T00:00:0${index}.000Z`, run: 'r-history', layer: 'L2', event: 'acceptance.history', card: 12,
    opened: { at: '2026-10-01T00:00:00Z', by: 'rigger-fake' }, revisions: revisions.slice(0, count),
  })), 'each move carries the complete oldest-first history with the original identities and independently derived metrics');
  for (const history of histories) for (const revision of history.revisions) {
    const original = edits.find(({ editedAt }) => editedAt === revision.editedAt);
    assert.equal(revision.digest, acceptanceDigest(original.diff), 'each digest is the marker digest for that body');
    assert.equal(revision.items, acceptanceItems(original.diff).length, 'each item count uses the existing source-level form reader');
  }
  assert.equal(histories[2].revisions[5].digest, histories[2].revisions[4].digest, 'the outside edit leaves the acceptance digest unchanged');
  assert.equal(histories[2].revisions[5].items, histories[2].revisions[4].items, 'the outside edit leaves the item count unchanged');
  assert.ok(world.historyRequests().length > 0, 'L2 sends the issue-scoped history read');
  assert.ok(world.historyRequests().every(({ side }) => side === 'read'), 'all history requests use the read runner');
  assert.ok(world.events().slice(began).filter(({ layer, event, side }) => layer === 'L0' && event === 'call.end' && side === 'read')
    .every(({ card }) => card === 12), 'the default cardReads reader records its reads under the moved card');
  assert.equal(histories[1].revisions[2].editor, 'null', 'a login spelled null is a string identity, distinct from an unavailable actor');

  const readCount = world.historyRequests().length;
  const afterLast = body('- An edit after the last move.');
  world.replaceHistory(afterLast, { ...snapshot(6), userContentEdits: { nodes: [
    { editedAt: '2026-10-01T00:00:06Z', editor: { login: 'after-last-editor' }, deletedAt: null, diff: afterLast },
    ...edits.toReversed(),
  ] } });
  await clock.advance(clock.now() + 60_000);
  assert.deepEqual(world.histories(), histories, 'W2: an edit after the final column change is outside the recorded snapshots');
  assert.equal(world.historyRequests().length, readCount, 'W2: advancing the clock without another move sends no history read');
});

// M7: stopping at one page, reversing pages separately or deduplicating rewrites loses history.
// proves R-CARD-6
test('history spans every page and preserves same-second identical-body revisions in forge order', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = '## Acceptance\n\n- Keep every revision.\n';
  // The captured newest-first connection shape, with three pages and tied edit times.
  const edits = Array.from({ length: 201 }, (_, index) => ({
    editedAt: '2026-10-01T00:00:00Z', editor: { login: index === 0 ? 'rigger-fake' : `editor-${index}` },
    deletedAt: null, diff: body,
  }));
  const world = historyWorld(t, { clock, body, history: { userContentEdits: { nodes: edits.toReversed() } } });
  const card = await world.card();
  await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }));
  const records = world.histories();
  assert.equal(records.length, 1, 'one accepted move produces one complete history');
  assert.equal(records[0].revisions.length, 201, 'no page or identical-body rewrite is lost');
  assert.deepEqual(records[0].revisions, Array.from({ length: 201 }, (_, index) => ({
    editedAt: '2026-10-01T00:00:00Z', editor: index === 0 ? 'rigger-fake' : `editor-${index}`, deleted: false,
    // Python hashlib on 2026-11-11: UTF-8 "Keep every revision." followed by LF.
    digest: '2a6743ed408e25a9a617f0ab7571192c45a24f9f61ffba13eddd877424350c9b', items: 1,
  })), 'reversing the whole connection retains the order of revisions sharing a timestamp');
  const cursors = world.historyRequests().map(({ args }) => {
    const selected = new Map(selectedFields(parseDocument(args[3].slice('query='.length)).operations[0].selections));
    return selected.get('repository.issue.userContentEdits').arguments.find(({ name }) => name === 'after')?.value.value;
  });
  assert.deepEqual(cursors, [undefined, '100', '200'], 'each continuation uses the cursor answered by the previous page');
});

// M8: a failed page is optional evidence; a refused L0 record remains the halt.
// proves R-CARD-6
test('a failed history page leaves its accepted transition without partial history, while a refused read record reaches the caller', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = '## Acceptance\n\n- Keep the accepted work.\n';
  const nodes = Array.from({ length: 101 }, () => ({
    editedAt: '2026-10-01T00:00:00Z', editor: { login: 'rigger-fake' }, deletedAt: null, diff: body,
  }));
  for (const failedPage of [1, 2]) {
    let page = 0;
    const world = historyWorld(t, { clock, body, history: { userContentEdits: { nodes } },
      reply: (args, options, answer) => isHistoryRequest(args) && ++page === failedPage
        ? { status: 1, stdout: '', stderr: 'gh: history unavailable (HTTP 502)' } : answer(),
    });
    const card = await world.card();
    await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }), `history page ${failedPage} cannot undo the accepted move`);
    assert.equal(page, failedPage, 'the failing page was actually requested');
    assert.equal((await world.card()).column, 'Done');
    assert.deepEqual(world.events().filter(({ layer }) => layer === 'L2').map(({ event, cause }) => ({ event, cause })),
      [{ event: 'transition', cause: 'merged' }], 'a failed page records only the accepted transition');
    assert.deepEqual(world.histories(), []);
  }

  const world = historyWorld(t, { clock, body });
  const card = await world.card();
  const refusal = new Error('history read record disk full');
  world.refuseEvents(({ layer, event, side }) => layer === 'L0' && event === 'call.end' && side === 'read'
    && world.historyRequests().length > 0, refusal);
  await assert.rejects(() => world.changes.moved(card, { to: 'done' }), (error) => {
    assert.equal(error.code, EVENT_REFUSED, 'a recording refusal is not swallowed as an optional read failure');
    assert.equal(error.column, 'Done');
    assert.ok(error.message.includes(refusal.message));
    return true;
  });
  assert.equal((await world.card()).column, 'Done');
  assert.equal(world.events().filter(({ event }) => event === 'transition').length, 1);
  assert.deepEqual(world.histories(), []);
});

// M9: a timed-out read must not turn its otherwise usable stdout into a history record.
// proves R-CARD-6
test('the history runner deadline rejects a timed-out reply and leaves the accepted transition standing', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  let deadline;
  const world = historyWorld(t, { clock, body: '## Acceptance\n\n- Keep accepted work after a timeout.\n',
    reply: async (args, options, answer) => {
      if (!isHistoryRequest(args)) return answer();
      const said = await answer();
      // M8 pre-dispatch attack finding 11 admits this runner status contract for M9.
      deadline = options.timeout;
      await clock.advance(clock.now() + deadline);
      return { ...said, status: 1, timedOut: true, timeout: deadline };
    },
  });
  const card = await world.card();
  const began = clock.now();
  await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }));
  assert.equal(world.historyRequests().length, 1, 'the history actually reached the runner');
  assert.ok(deadline > 0, 'the runner supplied a deadline');
  assert.equal(clock.now(), began + deadline, 'the controlled reply arrived at the runner deadline');
  assert.deepEqual(world.histories(), [], 'usable stdout from a timed-out read is not history');
  assert.deepEqual(world.events().filter(({ layer }) => layer === 'L2').map(({ event, cause }) => ({ event, cause })),
    [{ event: 'transition', cause: 'merged' }]);
  assert.equal((await world.card()).column, 'Done');
  const ended = world.events().findLast(({ layer, event, outcome }) => layer === 'L0' && event === 'call.end' && outcome === 'timed-out');
  assert.ok(ended, 'the runner timeout has its L0 call.end');
  assert.equal(ended.card, 12);
  assert.equal(ended.side, 'read');
  assert.equal(ended.ts, new Date(began + deadline).toISOString());

  const reading = repositoryReads({ ...world.settings.board, repo: world.settings.repo },
    { send: world.send, emitter: world.sink.emitter({ layer: 'L0', card: 12 }) });
  await assert.rejects(() => reading.readIssueHistory(12), (error) => {
    assert.ok(error.message.includes(`timeout of ${deadline} ms`), 'the adapter reports the deadline rejection rather than a JSON failure');
    return true;
  });
});

// M10: the current body's author is mutable; the marked opening's exact name is authoritative.
// proves R-CARD-6
test('a clock card records the exact author beside its opening mark despite later author edits', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const mark = 'Rigger clock: ["nightly",1793178000123]';
  const author = 'pm\\n\\r "quoted" café\u2028🛠  ';
  for (const newline of ['\n', '\r\n']) {
    const opening = [mark, '', `**Author:** ${author}`, '', '## Acceptance', '', '- Keep the opening author.', ''].join(newline);
    const current = [mark, '', '**Author:** replacement-role', '', '## Acceptance', '', '- Keep the edited body.', ''].join(newline);
    const world = historyWorld(t, { clock, body: current, history: { userContentEdits: { nodes: [
      { editedAt: '2026-10-01T00:00:01Z', editor: { login: 'another-editor' }, deletedAt: null, diff: current },
      { editedAt: '2026-10-01T00:00:00Z', editor: { login: 'rigger-fake' }, deletedAt: null, diff: opening },
    ] } } });
    const card = await world.card();
    await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }));
    const records = world.histories();
    assert.equal(records.length, 1, 'the clock card has one history record');
    assert.equal(records[0].author, author, 'the opening author preserves backslashes, Unicode and trailing spaces');
    assert.equal(records[0].revisions.length, 2);
    assert.notEqual(records[0].author, 'replacement-role', 'a later body cannot replace the opening author');
  }
});

// M15/M8: unavailable identities or undeleted bodies cannot support a complete history.
// proves R-CARD-6
test('unavailable opening or revision facts refuse the whole read with issue and revision identified and preserve the accepted transition', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = '## Acceptance\n\n- Record only attributable revisions.\n';
  const failureOf = async (read) => { try { await read(); } catch (error) { return error; } };
  const cases = [
    { name: 'opening author', revision: 'opening revision', opening: true },
    { name: 'available revision editor', revision: 'revision 1 at 2026-10-01T00:00:00Z', index: 0 },
    { name: 'deleted revision editor', revision: 'revision 2 at 2026-10-01T00:00:01Z', index: 1, deleted: true },
    { name: 'unavailable undeleted body', revision: 'revision 1 at 2026-10-01T00:00:00Z', index: 0, bodyMissing: true },
  ];
  const observations = [];
  for (const each of cases) {
    const history = { ...(each.opening && { author: null }), userContentEdits: { nodes: [0, 1].map((index) => ({
      editedAt: `2026-10-01T00:00:0${index}Z`, editor: index === each.index && !each.bodyMissing ? null : { login: 'rigger-fake' },
      deletedAt: each.deleted && index === each.index ? '2026-10-02T00:00:00Z' : null,
      diff: (each.deleted || each.bodyMissing) && index === each.index ? null : body,
    })).toReversed() } };
    const world = historyWorld(t, { clock, body, history });
    const card = await world.card();
    const reading = repositoryReads({ ...world.settings.board, repo: world.settings.repo },
      { send: world.send, emitter: world.sink.emitter({ layer: 'L0', card: 12 }) });
    const refused = await failureOf(() => reading.readIssueHistory(12));
    const fake = createFakeRepository({ issues: [{ number: 12, body, history }] });
    const fakeRefused = await failureOf(() => fake.operations.readIssueHistory(12));
    const before = world.historyRequests().length;
    await assert.doesNotReject(() => world.changes.moved(card, { to: 'done' }), `${each.name}: the unusable read cannot undo the accepted move`);
    observations.push({
      case: each.name,
      adapterNamesIssue: refused?.message.includes('issue #12') ?? false,
      adapterNamesRevision: refused?.message.includes(each.revision) ?? false,
      fakeNamesIssue: fakeRefused?.message.includes('issue #12') ?? false,
      fakeNamesRevision: fakeRefused?.message.includes(each.revision) ?? false,
      attempted: world.historyRequests().length - before,
      histories: world.histories().length,
      transitions: world.events().filter(({ event }) => event === 'transition').map(({ cause }) => cause),
      column: (await world.card()).column,
    });
  }
  assert.deepEqual(observations, cases.map(({ name }) => ({
    case: name, adapterNamesIssue: true, adapterNamesRevision: true, fakeNamesIssue: true, fakeNamesRevision: true,
    attempted: 1, histories: 0, transitions: ['merged'], column: 'Done',
  })), 'every unavailable fact refuses with issue and revision context, and L2 keeps only its accepted transition');
});

// M12/M13/M16: recording history must preserve every existing move/refusal boundary.
// proves R-CARD-6
test('a refused history event reaches the caller after its move stands, and refused or unrecorded moves send no history read', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const body = '## Acceptance\n\n- Preserve the move and its recording boundaries.\n';
  const control = historyWorld(t, { clock, body });
  await assert.doesNotReject(async () => control.changes.moved(await control.card(), { to: 'done' }));
  assert.equal(control.histories().length, 1, 'the same accepted move normally records history');

  const history = historyWorld(t, { clock, body });
  const historyCard = await history.card();
  const historyRefusal = new Error('acceptance history disk full');
  history.refuseEvents(({ layer, event }) => layer === 'L2' && event === 'acceptance.history', historyRefusal);
  await assert.rejects(() => history.changes.moved(historyCard, { to: 'done' }), (error) => {
    assert.equal(error.halt, true, 'a refused history event is the recording halt');
    assert.equal(error.column, 'Done');
    assert.equal(error.cause, historyRefusal);
    return true;
  });
  assert.equal((await history.card()).column, 'Done', 'the sink cannot undo the forge move');
  assert.equal(history.events().filter(({ event }) => event === 'transition').length, 1);
  assert.equal(history.historyRequests().length, 1);
  assert.deepEqual(history.histories(), []);

  const refused = historyWorld(t, { clock, body,
    reply: (args, options, answer) => options.side === 'item-write'
      ? { status: 1, stdout: '', stderr: 'gh: controlled move refusal' } : answer(),
  });
  const refusedCard = await refused.card();
  const before = refused.held();
  await assert.rejects(() => refused.changes.moved(refusedCard, { to: 'done' }), /was refused:.*controlled move refusal/);
  assert.equal((await refused.card()).column, 'Review');
  assert.deepEqual(refused.held().model, before.model, 'a refused move leaves the board model unchanged');
  assert.deepEqual(refused.held().writes, before.writes, 'a refused move makes no forge write');
  assert.equal(refused.historyRequests().length, 0, 'a refused board move sends no history read');
  assert.deepEqual(refused.events().filter(({ layer }) => layer === 'L2'), []);

  for (const boundary of ['L0 move record', 'transition record']) {
    const world = historyWorld(t, { clock, body });
    const card = await world.card();
    const refusal = new Error(`${boundary} disk full`);
    world.refuseEvents(({ layer, event, side }) => boundary === 'L0 move record'
      ? layer === 'L0' && event === 'call.end' && side === 'item-write'
      : layer === 'L2' && event === 'transition', refusal);
    await assert.rejects(() => world.changes.moved(card, { to: 'done' }), (error) => {
      assert.equal(error.column, 'Done', `${boundary}: the caller retains the accepted column`);
      assert.ok(error.message.includes(refusal.message), `${boundary}: the existing refusal reaches the caller`);
      if (boundary === 'L0 move record') {
        assert.ok(error.message.includes('call.end'));
        assert.ok(error.message.includes('item-write'));
      } else assert.equal(error.cause, refusal);
      return true;
    });
    assert.equal((await world.card()).column, 'Done');
    assert.equal(world.historyRequests().length, 0, `${boundary}: an earlier recording refusal sends no history read`);
    assert.deepEqual(world.histories(), []);
    assert.equal(world.events().filter(({ event }) => event === 'transition').length, boundary === 'L0 move record' ? 1 : 0);
  }
});

// M14/M8-K17: the common hook must cover every declared cause, including both creation/return routes.
// proves R-CARD-6
test('every declared change cause records one history after its transition under the moved card and dispatch', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  const acceptance = '- Retain every accepted move.\n';
  const body = `## Acceptance\n\n${acceptance}`;
  const occurrence = 1793178000123;
  const marked = `Rigger clock: ["ledger",1793178000123]\n\n**Author:** owner\n\n${body}`;
  const template = { title: 'Periodic ledger', labels: ['type:change'], acceptance };
  // Promise.allSettled's fulfilled L1 result contract, as handed to L2 by L3.
  const returned = { status: 'fulfilled', value: { exit: 0, stdout: '', stderr: '' } };
  const cases = [
    { name: 'created by opening', cause: 'created', from: 'Review', to: 'Ready', number: 13, dispatch: null,
      run: (world) => world.changes.openClockCard('ledger', occurrence, template) },
    { name: 'created by recovery', cause: 'created', from: null, to: 'Ready', marked: true, dispatch: null,
      run: (world) => world.changes.clockCardAfter('ledger', occurrence, 11) },
    { name: 'claimed', cause: 'claimed', from: 'Ready', to: 'Coding',
      run: (world, card) => world.changes.claimed(card) },
    { name: 'redone', cause: 'redone', from: 'Review', to: 'Coding',
      run: (world, card) => world.changes.claimed(card) },
    { name: 'returned by maker', cause: 'returned', from: 'Coding', to: 'Review', pull: true, dispatch: 'd-maker',
      run: (world, card) => world.changes.settled(card, returned, { dispatch: 'd-maker' }) },
    { name: 'returned by role', cause: 'returned', from: 'Coding', to: 'Review', pull: true, dispatch: 'd-role',
      run: (world, card) => world.changes.roleSettled(card, { line: 'rigger-12', destination: 'engineer' }, returned, { dispatch: 'd-role' }) },
    { name: 'sound', cause: 'sound', from: 'Review', to: 'Owner',
      run: (world, card) => world.changes.moved(card, { to: 'owner' }) },
    { name: 'continued', cause: 'continued', from: 'Review', to: 'Coding',
      run: (world, card) => world.changes.claimed(card, { action: 'continue' }) },
    { name: 'continuedFromOwner', cause: 'continuedFromOwner', from: 'Owner', to: 'Coding',
      run: (world, card) => world.changes.claimed(card, { action: 'continue' }) },
    { name: 'rejudged', cause: 'rejudged', from: 'Owner', to: 'Review',
      run: (world, card) => world.changes.moved(card, { to: 'review' }) },
    { name: 'merged', cause: 'merged', from: 'Review', to: 'Done', pull: true,
      run: (world, card) => world.changes.mergeEnded(card, { pull: 21 }, { outcome: 'merged' }) },
    { name: 'mergedFromOwner', cause: 'mergedFromOwner', from: 'Owner', to: 'Done', pull: true,
      run: (world, card) => world.changes.mergeEnded(card, { pull: 21 }, { outcome: 'already merged' }) },
    { name: 'conflicted', cause: 'conflicted', from: 'Review', to: 'Coding', pull: true,
      run: (world, card) => world.changes.mergeEnded(card, { pull: 21 }, { outcome: 'refused', reason: 'conflict' }) },
    { name: 'conflictedFromOwner', cause: 'conflictedFromOwner', from: 'Owner', to: 'Coding', pull: true,
      run: (world, card) => world.changes.mergeEnded(card, { pull: 21 }, { outcome: 'refused', reason: 'conflict' }) },
    { name: 'escalated', cause: 'escalated', from: 'Coding', to: 'Owner', dispatch: null,
      run: (world, card) => world.changes.escalated(card, { category: 'ambiguous', reason: 'Controlled acceptance-history proof.' }) },
  ];
  assert.deepEqual([...new Set(cases.map(({ cause }) => cause))].sort(), [
    'created', 'claimed', 'redone', 'returned', 'sound', 'continued', 'continuedFromOwner', 'rejudged',
    'merged', 'mergedFromOwner', 'conflicted', 'conflictedFromOwner', 'escalated',
  ].sort(), 'the worked cases contain the thirteen causes bound by M8-K17');
  const observations = [];
  for (const each of cases) {
    const world = historyWorld(t, { clock, body: each.marked ? marked : body, column: each.from,
      repository: each.pull ? {
        pullRequests: [{ number: 21, head: 'rigger-12', sha: 'a'.repeat(40), mergeBase: 'b'.repeat(40), diff: '', comments: [], merged: each.cause.startsWith('merged') }],
        mergeable: { 21: each.cause.startsWith('conflicted') ? 'CONFLICTING' : each.cause.startsWith('merged') ? 'UNKNOWN' : 'MERGEABLE' }, rules: { main: [] },
      } : {},
    });
    const card = await world.card();
    await assert.doesNotReject(() => each.run(world, card), `${each.name}: the fixture reaches its accepted move`);
    const number = each.number ?? 12;
    const placed = await world.card(number);
    assert.ok(placed, `${each.name}: the moved card exists on the board`);
    const events = world.events();
    const transitions = events.filter(({ layer, event }) => layer === 'L2' && event === 'transition');
    const histories = events.filter(({ layer, event }) => layer === 'L2' && event === 'acceptance.history');
    const between = transitions.length === 1 && histories.length === 1
      ? events.slice(events.indexOf(transitions[0]) + 1, events.indexOf(histories[0])) : [];
    observations.push({
      name: each.name, causes: transitions.map(({ cause }) => cause), column: placed.column,
      histories: histories.length, card: histories[0]?.card, dispatch: histories[0]?.dispatch,
      revisions: histories[0]?.revisions.length, author: histories[0]?.author,
      ordered: transitions.length === 1 && histories.length === 1 && events.indexOf(transitions[0]) < events.indexOf(histories[0]),
      readContext: between.filter(({ layer, event, side }) => layer === 'L0' && event === 'call.end' && side === 'read')
        .map(({ card, dispatch }) => ({ card, dispatch })),
    });
  }
  assert.deepEqual(observations, cases.map((each) => ({
    name: each.name, causes: [each.cause], column: each.to, histories: 1, card: each.number ?? 12, dispatch: each.dispatch,
    revisions: 1, author: each.cause === 'created' ? 'owner' : undefined, ordered: true,
    readContext: [{ card: each.number ?? 12, dispatch: each.dispatch }],
  })), 'each of the fifteen accepted moves across thirteen causes carries one following history and its contextual read');
});

// M1/M11: a caller's card body can be stale; an Author line alone is not a clock author.
// proves R-CARD-6
test('an unedited issue records the live body as its opening revision and omits author without a valid opening clock mark', async (t) => {
  const clock = manualClock(Date.parse('2026-11-10T00:00:00Z'));
  for (const prefix of ['**Author:** stray-role\n', 'Rigger clock: ["nightly","0"]\n\n**Author:** stray-role\n']) {
    const body = `${prefix}\n## Acceptance\n\n- Use the fresh body.\n`;
    const world = historyWorld(t, { clock, body, column: 'Ready' });
    const card = await world.card();
    await assert.doesNotReject(() => world.changes.claimed({ ...card, body: '## Acceptance\n\n- A stale input body.\n' }));

    assert.deepEqual(world.histories(), [{
      ts: '2026-11-10T00:00:00.000Z', run: 'r-history', layer: 'L2', event: 'acceptance.history', card: 12,
      opened: { at: '2026-10-01T00:00:00Z', by: 'rigger-fake' },
      revisions: [{ editedAt: '2026-10-01T00:00:00Z', editor: 'rigger-fake', deleted: false,
        digest: createHash('sha256').update('Use the fresh body.\n', 'utf8').digest('hex'), items: 1 }],
    }], 'the synthetic opening uses the live body and opening identity, with no author for an absent or invalid mark');
    assert.equal((await world.card()).column, 'Coding', 'the accepted column is retained');
    assert.ok(world.historyRequests().length > 0, 'the unedited body comes from the history read');
  }
});
