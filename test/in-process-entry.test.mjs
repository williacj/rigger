// ABOUTME: Tests callable plan decisions with independent boards and the shared forge core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULLING, PULLING_HELD, UNREADABLE, card, matrixRepository, planInProcess, planWorld, proving, pullLines, pulled, refusalOf } from './in-process-entry.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate, check } from '../scripts/build-test-matrix.mjs';
import { admissionOf, closerText, seed } from './admission-world.mjs';

test('plan prints the pull order one card per line, highest declared priority first, then oldest', async () => {
  // The config's declared order is High, Normal, Low, which is not the board field's own order,
  // and a card holding no value ranks below every option. So by hand: #20 (High), #30 (Normal),
  // #10 (Low), #40 (none). #5 sits in Backlog and is never offered.
  const ran = await planInProcess({
    items: [
      card(30, 'Ready', { fieldValues: { Priority: 'Normal' } }),
      card(10, 'Ready', { fieldValues: { Priority: 'Low' } }),
      card(5, 'Backlog', { fieldValues: { Priority: 'High' } }),
      card(20, 'Ready', { fieldValues: { Priority: 'High' } }),
      card(40, 'Ready'),
    ],
  });

  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual(pulled(ran.text), [20, 30, 10, 40], ran.text);
});

// proves R-CARD-7
test('plan prints a card with no acceptance with missing acceptance as the reason, and does not pull it', async () => {
  const ran = await planInProcess({ items: [card(11, 'Ready', { body: 'Why this matters, and nothing more.' }), card(12, 'Ready')] });

  assert.equal(ran.code, 0, ran.text);
  assert.match(refusalOf(ran.text, 11) ?? '', /missing acceptance/, ran.text);
  assert.deepEqual(pulled(ran.text), [12], ran.text);
});

// proves R-CARD-8
test('plan prints a card whose acceptance only restates its title with a restated title as the reason', async () => {
  const ran = await planInProcess({ items: [card(13, 'Ready', { title: 'Paint the widget', body: '## Acceptance\n\n- Paint the widget.\n' })] });

  assert.equal(ran.code, 0, ran.text);
  assert.match(refusalOf(ran.text, 13) ?? '', /restated title/, ran.text);
  assert.deepEqual(pulled(ran.text), [], ran.text);
});

test('plan prints that nothing would be pulled, given an empty Ready column and no redo', async () => {
  const ran = await planInProcess({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.equal(ran.code, 0, ran.text);
  assert.match(ran.text, /nothing would be pulled/, ran.text);
  assert.deepEqual(pulled(ran.text), [], ran.text);
});

// proves R-SCHED-18
test('plan under an unreadable admission shows no pull line, names each path and cause, and exits non-zero', async () => {
  const cases = [
    ...UNREADABLE.map(({ name, cause, make }) => [make, (dir) => [`${join(dir, name)} (${cause})`]]),
    [(state) => { seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' })); seed(state, 'stray.json', closerText()); }, (dir) => [`${join(dir, 'stray.json')} (no closer form)`]],
    [(state) => { mkdirSync(state, { recursive: true }); writeFileSync(admissionOf(state), 'a file'); }, (dir) => [`${dir} (not a directory)`]],
  ];
  for (const [prepare, named] of cases) {
    const world = planWorld(PULLING, { held: PULLING_HELD });
    const open = await world.run();
    assert.equal(open.code, 0, open.text);
    assert.deepEqual(pulled(open.text), [32, 31], 'the prepared admission fixture has both original pull candidates');
    prepare(world.state);
    const ran = await world.run();
    assert.notEqual(ran.code, 0, ran.text);
    assert.deepEqual(pullLines(ran.text), [], ran.text);
    assert.doesNotMatch(ran.text, /^\s*pull\b/m, ran.text);
    assert.match(ran.text, /admission cannot be read/, ran.text);
    for (const said of named(world.unread)) assert.ok(ran.text.includes(said), `${said} is not in:\n${ran.text}`);
  }
});


test('a written matrix regenerates byte for byte, and the check admits it', () => {
  const dir = matrixRepository();
  const matrix = join(dir, 'docs', 'derived', 'test-matrix.md');
  generate(dir, { write: true });
  assert.equal(existsSync(matrix), true, 'requested generation writes the matrix before any read');
  const first = readFileSync(matrix);
  generate(dir, { write: true });
  assert.deepEqual(readFileSync(matrix), first);
  assert.equal(check(dir).stale, false, 'the check admits the matrix its own write produced');
});

test('a matrix edited by hand fails the check, naming the file', () => {
  const dir = matrixRepository();
  generate(dir, { write: true });
  const matrix = join(dir, 'docs', 'derived', 'test-matrix.md');
  assert.equal(existsSync(matrix), true, 'the generated matrix is ready before the independent edit');
  appendFileSync(matrix, '| R-ONE-2 | by hand |\n');
  assert.equal(check(dir).stale, true, 'the independent hand edit is stale');
});

test('a matrix that no longer matches the tests fails the check', () => {
  const dir = matrixRepository();
  generate(dir, { write: true });
  assert.equal(existsSync(join(dir, 'docs', 'derived', 'test-matrix.md')), true);
  writeFileSync(join(dir, 'test', 'second.test.mjs'), proving('// proves R-ONE-2', 'the second thing holds'));
  assert.equal(check(dir).stale, true, 'the independently added second declaration makes the matrix stale');
});

test('a file under docs/derived that no tool writes fails the check, naming it', () => {
  const dir = matrixRepository();
  generate(dir, { write: true });
  const stray = join(dir, 'docs', 'derived', 'notes.md');
  writeFileSync(stray, 'typed by hand\n');
  assert.deepEqual(check(dir).strays, ['notes.md']);
  assert.equal(readFileSync(stray, 'utf8'), 'typed by hand\n', 'the check preserves the independently written stray');
});
