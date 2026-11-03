// ABOUTME: Clock and status callers retain a made opening and report label and event refusals separately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../rigger.config.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { openingTransport, ok } from './opening-transport.mjs';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { statusNotice } from '../src/workflow/status-issue.mjs';
import { noticeLine } from '../src/cli/once.mjs';
import { forge } from './notice-forge.mjs';

// Treating every made opening as an event refusal throws on an absent unrecorded list and loses its floor.
test('W7a: a clock opening reports its trigger, occurrence, issue and every missing label without inventing a sink refusal', async () => {
  const name = 'nightly "widgets"';
  const occurrence = 1793275200123;
  const template = { title: 'Audit widgets', acceptance: '- The widget is blue.\n', labels: ['one', 'two', 'three'] };
  for (const refuseEnd of [false, true]) {
    for (const [held, missing] of [[[], ['one', 'two', 'three']], [['one'], ['two', 'three']], [['two', 'three'], ['one']]]) {
      const transport = openingTransport(() => ok({ number: 214, labels: held.map((name) => ({ name })) }), { refuseEnd });
      const l2 = columnChanges({ config, ...transport, items: { addIssue: () => assert.fail('no board write follows a refused opening') } });
      await assert.rejects(l2.openClockCard(name, occurrence, template), (failure) => {
        assert.equal(failure.issue, 214, 'the clock failure carries the known issue number');
        for (const named of [name, '2026-10-29T12:00:00.123Z', '#214', ...missing]) assert.ok(failure.message.includes(named), failure.message);
        if (refuseEnd) {
          for (const named of ['call.end', 'call record disk full']) assert.ok(failure.message.includes(named), failure.message);
        } else assert.doesNotMatch(failure.message, /sink|unrecorded/);
        return true;
      });
      assert.equal(transport.sent.length, 1);
    }
  }
});

// A made notice without refused events must be printable, and its body must prevent a second opening.
test('W8 W10: an unlabelled status opening reports made and its cause, prints safely, and is recovered by its body', async () => {
  for (const refuseEnd of [false, true]) {
    const fake = forge();
    const transport = openingTransport((args) => {
      assert.equal(args[1], 'repos/williacj/rigger/issues');
      fake.issues.push({ number: 1, title: args[5].slice(6), body: args[7].slice(5), labels: [], comments: [] });
      return ok({ number: 1, labels: [] });
    }, { refuseEnd });
    const notice = statusNotice({ ...fake, writes: repositoryWriteSide({ repo: config.repo }, transport),
      columns: config.board.columns, sink: transport.sink });
    const closer = { id: 'a1', reason: 'two host failures', run: 'r-1' };
    const first = notice({ closer });
    assert.deepEqual((await first.next()).value, { rename: 'after', number: 0 });
    const result = await first.next({ status: 'fulfilled' });
    assert.equal(result.done, true);
    const { failed } = result.value;
    assert.deepEqual(failed.made, { answer: 1 });
    assert.equal(failed.step, 'open the status issue');
    for (const named of ['openIssue', '#1', 'rigger:status']) assert.ok(failed.cause.includes(named), failed.cause);
    assert.equal(Object.hasOwn(failed, 'unrecorded'), refuseEnd, 'only refused events belong in the notice');
    for (const verb of ['once', 'run']) {
      let line;
      assert.doesNotThrow(() => { line = noticeLine(verb, 'a1', failed); }, 'a made notice without events is printable');
      for (const named of [verb, 'a1', 'made', '#1', 'rigger:status']) assert.ok(line.includes(named), line);
      if (refuseEnd) {
        for (const named of ['call.end', 'call record disk full']) assert.ok(line.includes(named), line);
      } else assert.doesNotMatch(line, /sink|unrecorded/);
    }
    const next = notice({ closer: { ...closer, after: '0' } });
    assert.deepEqual((await next.next()).value, { rename: 'issue', number: 1 });
    assert.deepEqual(await next.next({ status: 'fulfilled' }), { done: true, value: { issue: 1 } });
    assert.equal(fake.issues.length, 1, 'the body scan finds the unlabelled status issue');
    assert.equal(transport.sent.length, 1, 'the next notice makes no second opening');
    assert.deepEqual(fake.onBoard, [{ id: 'item-1', number: 1, column: 'Owner' }]);
  }
});
