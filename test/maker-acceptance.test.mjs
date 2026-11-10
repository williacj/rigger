// ABOUTME: Proves once hands the maker its source acceptance through the agent input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualClock } from './clock-report-world.mjs';
import { optionalWorld } from './optional-config-world.mjs';
import { card } from './verb-consumer.mjs';

/** Capture the logical agent's consumed input through the real once and dispatch wiring. */
async function makerInput(t, body) {
  const world = optionalWorld(t, 'minimal', {
    clock: manualClock(), items: [card(10, 'Ready', { body })],
  });
  const answer = await world.start();
  assert.deepEqual(world.fixtureErrors, [], 'the logical collaborators must complete');
  assert.equal(answer.code, 0, answer.text);
  const makers = world.agent.runs().filter(({ role }) => role === 'engineer');
  assert.equal(makers.length, 1, 'once must actually dispatch one maker');
  return makers[0].input;
}

// Omitting or reordering an item changes the acceptance the maker receives.
// proves R-LOOP-1
test('once hands the maker every source acceptance item in order', { timeout: 60000 }, async (t) => {
  const input = await makerInput(t, [
    '# Deliver the widget', '- Outside the acceptance.',
    '## Acceptance', '- Preserve `quotes`, $HOME, and \\ in the output.',
    '* Record **every** result.', '### Details', '+ Keep the final record.',
    '## Notes', '- Outside the section.', '## Acceptance', '  - Print the receipt.', '',
  ].join('\n'));

  const opening = '\nAcceptance:\n';
  assert.ok(input.includes(opening), 'the consumed input must introduce the acceptance');
  assert.deepEqual(input.slice(input.indexOf(opening) + opening.length).trimEnd().split('\n'), [
    '- Preserve `quotes`, $HOME, and \\ in the output.',
    '- Record **every** result.',
    '- Keep the final record.',
    '- Print the receipt.',
  ], 'the consumed input must preserve every item, its source text, and its order');
});

// A checklist or a fenced example must never become work assigned to the maker.
// proves R-LOOP-1
test('once excludes task-list and fenced bullets from the maker input', { timeout: 60000 }, async (t) => {
  const input = await makerInput(t, [
    '## Acceptance', '- Keep the real item.', '- [ ] TASK_ONLY',
    '```text', '- FENCED_ONLY', '```', '- Keep the other real item.', '',
  ].join('\n'));

  assert.ok(input.includes('- Keep the real item.\n'), 'the first real item must reach the maker');
  assert.ok(input.includes('- Keep the other real item.\n'), 'the second real item must reach the maker');
  assert.ok(!input.includes('TASK_ONLY'), 'task-list text must not reach the maker');
  assert.ok(!input.includes('FENCED_ONLY'), 'fenced bullet text must not reach the maker');
});
