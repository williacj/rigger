// ABOUTME: A real repository-write missing-label opening keeps the clock firing's same-run floor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { firingWorld, cardTrigger, START, outcomes } from './clock-firing-world.mjs';
import { failuresIn } from './kept-up-run.mjs';
import { openingTransport, ok } from './opening-transport.mjs';

// A lagging newest-number read must not open a second issue after the producer refused its labels.
// proves R-SCHED-32
test('W7 W10: a real missing-label opening floors the zero-newest scan, finds its mark and leaves exactly one card in Ready', async () => {
  const card = { title: 'Audit widgets', acceptance: '- The widget is blue.\n', labels: ['type:change', 'tier:high'] };
  for (const held of [[], ['tier:high'], ['type:change']]) {
    const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000, card }) } });
    const scanned = [];
    const read = world.reads.readIssue;
    world.reads.readIssue = async (number) => { scanned.push(number); return read(number); };
    world.reads.readNewestNumber = async () => 0;
    const transport = openingTransport((args) => {
      assert.equal(args[1], `repos/${world.settings.repo}/issues`);
      const number = world.fake.issues.length + 1;
      const labels = number === 1 ? held : card.labels;
      world.fake.issues.push({ number, title: args[5].slice(6), body: args[7].slice(5), labels: [...labels], comments: [] });
      return ok({ number, labels: labels.map((name) => ({ name })) });
    });
    world.writes.openIssue = repositoryWriteSide({ repo: world.settings.repo }, transport).openIssue;
    const run = await world.start();
    try {
      await world.clock.advance(START + 10_000);
      await world.clock.advance(START + 11_000);
      assert.equal(world.fake.issues.length, 1, 'the recovery must not open a second clock card');
      assert.equal(failuresIn(run.handed).at(-1)?.cause?.issue, 1, 'the made opening hands its number to the firing floor');
      assert.deepEqual(scanned, [1], 'the floor forces the scan through the known issue despite newest=0');
      assert.equal(transport.sent.length, 1);
      assert.deepEqual(outcomes(world).map(({ outcome, issue }) => ({ outcome, issue })), [{ outcome: 'card', issue: 1 }]);
      assert.deepEqual(world.fake.onBoard, [{ id: 'item-1', number: 1, column: 'Ready' }]);
    } finally { await run.stop(); }
  }
});
