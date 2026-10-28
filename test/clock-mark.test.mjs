// ABOUTME: Tests a clock firing's mark over Table M's names, time values and exact body lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeClockMark, parseClockMark, carriesClockMark } from '../src/workflow/clock-mark.mjs';
import { acceptanceItems } from '../src/workflow/form-check.mjs';

// Card #1083's eleven name cases and three literal time values, independent of the mark codec.
const NAMES = ['nightly', 'night ly', 'night`ly', '#nightly', '- nightly', '```nightly',
  'night\nly', 'night\rly', 'night-->ly', '夜間', ''];
const OCCURRENCES = [0, 1793178000123, -60589296000000];
const PAIRS = NAMES.flatMap((name) => OCCURRENCES.map((occurrence) => ({ name, occurrence })));

// M1, M2, M5: raw names can split a mark or open Markdown syntax; mutable state can vary it.
test('every pair composes one safe deterministic mark line', () => {
  for (const { name, occurrence } of PAIRS) {
    const mark = composeClockMark(name, occurrence);
    assert.equal(typeof mark, 'string');
    assert.doesNotMatch(mark, /[\r\n]/, JSON.stringify({ name, occurrence }));
    assert.doesNotMatch(mark, /^ {0,3}(?:#{1,6}(?: |$)|`{3,}|~{3,}|[-*+] )/);
    // The real form reader must see the same items with the mark before or inside the section.
    const section = '## Acceptance\n\n- The widget turns blue.\n';
    const expected = ['The widget turns blue.'];
    assert.deepEqual(acceptanceItems(`${mark}\n${section}`), expected);
    assert.deepEqual(acceptanceItems(`${section}${mark}\n`), expected);
    assert.equal(composeClockMark(name, occurrence), mark);
  }
  const short = Date.parse('2026-10-28T09:00Z');
  const long = Date.parse('2026-10-28T09:00:00.000Z');
  assert.equal(short, long);
  for (const name of NAMES) assert.equal(composeClockMark(name, short), composeClockMark(name, long));
});

// M3, M4, M6: a lossy codec conflates pairs; a parser treating ordinary prose as JSON can throw.
test('marks parse to their exact pairs without collisions and ordinary lines name no pair', () => {
  const marks = PAIRS.map(({ name, occurrence }) => composeClockMark(name, occurrence));
  for (let at = 0; at < PAIRS.length; at += 1) {
    assert.deepEqual(parseClockMark(marks[at]), PAIRS[at]);
    for (let other = at + 1; other < PAIRS.length; other += 1) {
      assert.notEqual(marks[at], marks[other], JSON.stringify([PAIRS[at], PAIRS[other]]));
    }
  }
  for (const line of ['', '## Acceptance', '**Author:** owner']) {
    assert.doesNotThrow(() => assert.equal(parseClockMark(line), null));
  }
});

// M7–M12, M15: substring matching, first-line-only scans or broader line splitting misidentify cards.
test('a body carries precisely the pairs whose complete mark lines it holds', () => {
  for (const [at, { name, occurrence }] of PAIRS.entries()) {
    const mark = composeClockMark(name, occurrence);
    for (const body of [mark, `${mark}\n`, `Context\n${mark}\nAfter`,
      `Context\r\n${mark}\r\nAfter`, `\n${mark}\n${mark}`, ['```', mark, '```'].join('\n')]) {
      assert.equal(carriesClockMark(body, name, occurrence), true, JSON.stringify(body));
    }
    const otherOccurrence = OCCURRENCES[(OCCURRENCES.indexOf(occurrence) + 1) % OCCURRENCES.length];
    assert.equal(carriesClockMark(composeClockMark(name, otherOccurrence), name, occurrence), false);
    if (name.toUpperCase() !== name) {
      assert.equal(carriesClockMark(composeClockMark(name.toUpperCase(), occurrence), name, occurrence), false);
    }
    for (const body of ['', '## Acceptance\n\n- The widget turns blue.']) {
      assert.doesNotThrow(() => assert.equal(carriesClockMark(body, name, occurrence), false));
    }
    // Each position, not merely the prefix, is susceptible to a one-character edit (M10).
    for (let index = 0; index < mark.length; index += 1) {
      const changed = mark.slice(0, index) + (mark[index] === 'x' ? 'y' : 'x') + mark.slice(index + 1);
      assert.doesNotThrow(() => assert.equal(carriesClockMark(changed, name, occurrence), false, changed));
    }
    for (const [other, next] of PAIRS.entries()) {
      if (other === at) continue;
      const body = `${mark}\n${composeClockMark(next.name, next.occurrence)}`;
      for (const [index, pair] of PAIRS.entries()) {
        assert.equal(carriesClockMark(body, pair.name, pair.occurrence), index === at || index === other);
      }
    }
    // M15: only LF and CRLF delimit lines; matching never trims, normalizes or scans substrings.
    for (const separator of ['\r', '\u2028', '\u2029', '\v', '\f']) {
      for (const body of [`Context${separator}${mark}\n`, `${mark}${separator}After`]) {
        assert.equal(carriesClockMark(body, name, occurrence), false, JSON.stringify(body));
      }
    }
    for (const body of [` ${mark}`, `${mark} `, `> ${mark}`, `prefix${mark}`, `${mark}suffix`, `${mark}${mark}`]) {
      assert.equal(carriesClockMark(body, name, occurrence), false, body);
    }
  }
});

// M13 (plus M15's range edges): string coercion, fractional times or clipping can change identity.
test('composition accepts time-value boundaries and refuses other occurrences naming the value', () => {
  for (const occurrence of [-8640000000000000, 8640000000000000]) {
    for (const name of NAMES) {
      assert.deepEqual(parseClockMark(composeClockMark(name, occurrence)), { name, occurrence });
    }
  }
  for (const occurrence of ['2026-10-28T09:00Z', 1.5, NaN, 8640000000000001,
    -8640000000000001, Infinity, -Infinity, undefined, null]) {
    assert.throws(() => composeClockMark('nightly', occurrence),
      (error) => error instanceof Error && error.message.includes(String(occurrence)), String(occurrence));
  }
});

// M14: implicit string coercion conflates a non-string name with a configured string name.
test('composition refuses non-string names and names the value it received', () => {
  for (const name of [undefined, null, 3]) {
    for (const occurrence of OCCURRENCES) {
      assert.throws(() => composeClockMark(name, occurrence),
        (error) => error instanceof Error && error.message.includes(String(name)), String(name));
    }
  }
});
