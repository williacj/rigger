// ABOUTME: Table W's repository-write opening answers and the marks retained across call refusals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { openingTransport, ok } from './opening-transport.mjs';

const BOARD = { repo: 'williacj/rigger' };

// Invalid input is refused before the transport, without inventing either a write or a call event.
test('W6: invalid titles, bodies and labels are refused without sending or recording a call', async () => {
  const invalid = [undefined, null, '', 0, [], {}];
  const cases = [
    ...invalid.map((title) => [title, 'Body', 'one']),
    ...invalid.map((body) => ['Title', body, 'one']),
    ...[[], [''], [undefined], [null], [0], [['one']], ['one', ''], ['', 'two']].map((labels) => ['Title', 'Body', ...labels]),
  ];
  for (const args of cases) {
    const transport = openingTransport(() => ok({ number: 214, labels: [{ name: 'one' }] }));
    await assert.rejects(repositoryWriteSide(BOARD, transport).openIssue(...args), (failure) => {
      assert.match(failure.message, /openIssue.*requires a title, body and one or more label names/);
      assert.equal(Object.hasOwn(failure, 'made'), false);
      return true;
    });
    assert.deepEqual(transport.sent, [], 'argument refusal sends no request');
    assert.deepEqual(transport.events, [], 'argument refusal records no call');
  }
});

// A parsed response without a usable issue number, like an unreadable response, proves no made issue.
test('W5: unreadable answers and absent or invalid issue numbers never acquire a made mark', async () => {
  const answers = ['{not json', 'null', ...[undefined, null, 0, -1, 1.5, '214', Number.MAX_SAFE_INTEGER + 1]
    .map((number) => JSON.stringify({ number, labels: [] }))];
  for (const stdout of answers) {
    for (const refuseEnd of [false, true]) {
      const transport = openingTransport(() => ({ status: 0, stdout, stderr: '' }), { refuseEnd });
      await assert.rejects(repositoryWriteSide(BOARD, transport).openIssue('Status', 'Hold', 'rigger:status'), (failure) => {
        assert.equal(Object.hasOwn(failure, 'made'), false, `no made mark for ${stdout}`);
        assert.match(failure.message, /openIssue/);
        return true;
      });
      assert.equal(transport.sent.length, 1);
    }
  }
});

// Losing the number on either refusal lets a caller mistake an existing issue for an undone write.
test('W1 W2: each missing-label answer is made with its number, labels and only genuinely unrecorded events', async () => {
  const labels = ['one', 'two', 'three\n"$(data)"'];
  const cases = [
    [labels, [], labels],
    [labels, ['two', labels[2]], ['one']],
    [labels, ['one', labels[2]], ['two']],
    [labels, ['ONE', 'two'], [labels[2]]],
    [labels, undefined, labels],
    [labels, null, labels],
    [['rigger:status'], [], ['rigger:status']],
    [labels, {}, labels, true],
    [labels, [null, { name: 'one' }], ['two', labels[2]], true],
  ];
  for (const refuseEnd of [false, true]) {
    for (const [requested, held, missing, raw] of cases) {
      const answer = { number: 214, ...(held === undefined ? {} : { labels: raw ? held : held?.map((name) => ({ name })) ?? null }) };
      const transport = openingTransport(() => ok(answer), { refuseEnd });
      const side = repositoryWriteSide(BOARD, transport);
      await assert.rejects(side.openIssue('Status', 'Hold', ...requested), (failure) => {
        assert.deepEqual(failure.made, { answer: 214 }, 'a missing-label refusal retains the opened number');
        for (const named of ['openIssue', '#214', ...missing]) assert.ok(failure.message.includes(named), failure.message);
        assert.equal(Object.hasOwn(failure, 'unrecorded'), refuseEnd);
        if (refuseEnd) {
          assert.equal(failure.code, 'EVENT_REFUSED');
          assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['call.end']);
          assert.match(failure.message, /call record disk full/);
        }
        return true;
      });
      assert.equal(transport.sent.length, 1, 'the refusal makes no second write');
      assert.deepEqual(transport.sent[0], ['api', 'repos/williacj/rigger/issues', '-X', 'POST', '-f', 'title=Status', '-f', 'body=Hold',
        ...requested.flatMap((label) => ['-f', `labels[]=${label}`])]);
    }
  }
});

// A successful-looking body cannot make a refused or timed-out transport a made opening.
test('W4: refused and timed-out openings stay unmarked even with an issue-shaped body and a refused event', async () => {
  for (const result of [{ status: 1, stderr: 'gh: forbidden (HTTP 403)' }, { status: 0, timedOut: true, timeout: 42 }]) {
    for (const refuseEnd of [false, true]) {
      const transport = openingTransport(() => ({ ...ok({ number: 214, labels: [] }), ...result }), { refuseEnd });
      await assert.rejects(repositoryWriteSide(BOARD, transport).openIssue('Status', 'Hold', 'rigger:status'), (failure) => {
        assert.equal(Object.hasOwn(failure, 'made'), false, 'a refused or timed-out write is not made');
        assert.match(failure.message, /openIssue/);
        if (refuseEnd) assert.equal(failure.code, 'EVENT_REFUSED');
        return true;
      });
      assert.equal(transport.sent.length, 1);
    }
  }
});

// A complete, possibly case-folded answer must keep the existing success and EVENT_REFUSED marks.
test('W3: complete label answers resolve normally or retain their number with a refused call.end', async () => {
  for (const [requested, held] of [[['one'], ['one']], [['one', 'two', 'three'], ['THREE', 'ONE', 'TWO']], [['one', 'ONE'], ['One']]]) {
    for (const refuseEnd of [false, true]) {
      const transport = openingTransport(() => ok({ number: 214, labels: held.map((name) => ({ name })) }), { refuseEnd });
      const opened = repositoryWriteSide(BOARD, transport).openIssue('Title\n"$(data)"', 'Body\r\n&|<>', ...requested);
      if (refuseEnd) await assert.rejects(opened, (failure) => {
        assert.deepEqual(failure.made, { answer: 214 }, 'a complete opening retains its made answer');
        assert.equal(failure.code, 'EVENT_REFUSED');
        assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['call.end']);
        return true;
      });
      else assert.equal(await opened, 214);
      assert.deepEqual(transport.sent, [['api', 'repos/williacj/rigger/issues', '-X', 'POST', '-f', 'title=Title\n"$(data)"',
        '-f', 'body=Body\r\n&|<>', ...requested.flatMap((label) => ['-f', `labels[]=${label}`])]]);
    }
  }
});
