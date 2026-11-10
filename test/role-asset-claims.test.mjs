// ABOUTME: Claims the role instructions carried by the assets init plans for a consumer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/cli/init.mjs';

/** Read the consumer's planned copy, refusing an absent or duplicate destination. */
function forked(path) {
  const files = plan({ repo: 'acme/widgets' }).filter((file) => file.path === `.claude/${path}`);
  assert.equal(files.length, 1, `init must plan exactly one consumer copy of ${path}`);
  return files[0].content.replace(/\s+/g, ' ');
}

// Losing either verdict boundary leaves a judge without the rule for choosing its verdict.
// proves R-VERDICT-6
test('init forks the boundary between maker revision and an owner decision', () => {
  assert.ok(forked('skills/code-review/SKILL.md').includes(
    'Use `critical` only for a fault no maker revision could resolve without an owner decision; a fault a maker revision could resolve is `needs revision`.',
  ), 'the planned review skill must carry both halves of the verdict boundary');
});

// Dropping either instruction permits compound or unjudgeable acceptance items.
// proves R-CARD-2
test('init forks the rules for one independently judgeable condition per item', () => {
  const skill = forked('skills/acceptance/SKILL.md');
  assert.ok(skill.includes('**One condition per item.**'), 'one condition per item is required');
  assert.ok(skill.includes('**A judge must be able to rule on the item without asking you.**'), 'independent judgeability is required');
});

// A spike's acceptance must leave its answer open to the investigation.
// proves R-CARD-9
test('init forks the rule that spike acceptance describes a complete answer', () => {
  assert.ok(forked('skills/acceptance/SKILL.md').includes(
    "A spike card's acceptance states what a complete answer contains, never what the answer is",
  ), 'spike acceptance must describe completeness without prescribing the answer');
});

// The authoring role must receive the instruction to load the consumer's skill.
// proves R-CARD-4
test('init instructs the PM to load the acceptance skill before writing a card', () => {
  assert.ok(forked('agents/pm.md').includes(
    'Load `.claude/skills/acceptance/` before you write the acceptance of a card you file',
  ), 'the PM must load the acceptance skill before authoring acceptance');
});

// Dropping either half allows unfinished acceptance to be displaced into a follow-up.
// proves R-CARD-10
test('init keeps follow-ups outside acceptance and undone items on their card', () => {
  const skill = forked('skills/acceptance/SKILL.md');
  assert.ok(skill.includes('follow-ups cover only outside work'), 'follow-ups must cover only outside work');
  assert.ok(skill.includes('An undone item leaves this card unfinished'), 'an undone item must keep its card unfinished');
});

// A title or a maker's interpretation cannot replace the stated acceptance.
// proves R-LOOP-1
test('init tells the engineer to finish against the stated acceptance', () => {
  assert.ok(forked('agents/engineer.md').includes(
    "The card's acceptance is the definition of done — not its title, and not your reading of it.",
  ), 'the engineer must finish against the acceptance rather than its own interpretation');
});
