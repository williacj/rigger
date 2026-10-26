// ABOUTME: Tests check:card, the author's pre-filing check of a card body: new requirement ids with
// no claiming line, and spec-style findings in pinned `markdown` fences. Also the retired-id reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { check as checkCard, main } from '../scripts/card-check.mjs';
import { retiredIds } from '../scripts/duplicate-id-check.mjs';
import { findings, ruledOutTerms, sentenceCeiling } from '../scripts/spec-style-lint.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** A repository holding the two retired registers, as `docs/spec` writes them. */
function retiredRegisters({ requirements, decisions }) {
  const root = temporaryDirectory('rigger-card-check-');
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  writeFileSync(join(root, 'docs', 'spec', 'requirements-retired.md'), requirements);
  writeFileSync(join(root, 'docs', 'spec', 'decisions-retired.md'), decisions);
  return root;
}

test('the retired-id reader returns the rows of the retired requirements and the headings of the retired decisions', () => {
  const root = retiredRegisters({
    requirements: [
      '# Retired requirements',
      '',
      'A withdrawn id such as R-PROSE-1 named in prose is no row.',
      '',
      '| id | requirement | from | withdrawn | replaced by |',
      '|---|---|---|---|---|',
      '| R-CARD-15 | — a fence opens. | D2 | 2026-09-25 | R-CARD-35 |',
      '| R-SCHED-9 | Two cards never merge at once. | | 2026-10-11 | R-SCHED-15 |',
      '',
    ].join('\n'),
    decisions: [
      '# Retired decisions',
      '',
      '## D4 — v0 defers the roles it can do without',
      '',
      'Superseded by D18.',
      '',
      '### D77 — a lower heading is no retired decision',
      '',
      '## D19 — Until M5, a maker merges its own card',
      '',
    ].join('\n'),
  });
  assert.deepEqual([...retiredIds(root)].sort(), ['D19', 'D4', 'R-CARD-15', 'R-SCHED-9']);
});

// --- check:card, run as an author runs it: a body file, and a root holding what it reads ---

// The skill states its rules the way the real one does: a one-term rule naming the spellings it
// rules out, and a ceiling. A ceiling of 12 keeps a sentence past it short enough to read here.
const SKILL = [
  '# The register',
  '',
  '### 1. One term per concept',
  '',
  'A card is escalated — never bubbled, parked or forwarded.',
  '',
  '### 2. Short sentences',
  '',
  'Sentences of about 8 words, and never past 12.',
  '',
].join('\n');

// A sentence of 15 words, past the fixture's ceiling of 12.
const LONG = 'The engine reads every card on the board before it claims any one of them.';

/**
 * A repository root holding the live and retired requirement registers, the retired decisions,
 * and the spec-style skill. `R-CARD-1` is live, `R-OLD-1` and `D4` are retired. A key set to
 * `null` leaves that file out; a string replaces it.
 */
function repository(overrides = {}) {
  const root = temporaryDirectory('rigger-card-check-');
  const files = {
    'docs/spec/requirements.md': '| id | requirement |\n|---|---|\n| R-CARD-1 | A card has an acceptance. |\n',
    'docs/spec/requirements-retired.md': '| id | requirement | withdrawn |\n|---|---|---|\n| R-OLD-1 | Gone. | 2026-09-25 |\n',
    'docs/spec/decisions-retired.md': '# Retired\n\n## D4 — v0 defers roles\n',
    '.claude/skills/spec-style/SKILL.md': SKILL,
    ...overrides,
  };
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Runs check:card on `body`, written to a file, against `root`. */
function cardCheck(body, root = repository()) {
  const file = join(temporaryDirectory('rigger-card-body-'), 'body.md');
  writeFileSync(file, body);
  return run([file, root]);
}

/** Runs the command as `npm run check:card -- ...args` runs it, collecting what it prints. */
function run(args) {
  const printed = [];
  const collect = (line) => printed.push(line);
  const status = main(args, { out: collect, err: collect });
  return { status, out: `${printed.join('\n')}\n` };
}

const lines = (...all) => `${all.join('\n')}\n`;

test('a body with no new id and no pinned fence: nothing found, exit 0', () => {
  const { status, out } = cardCheck(lines('# A card', '', 'It rests on R-CARD-1 and D4.', '', '## Acceptance', '', '- A thing holds.'));
  assert.equal(status, 0, out);
  assert.match(out, /nothing found/);
  assert.doesNotMatch(out, /R-CARD-1/);
});

for (const [form, cover] of [
  ['a `test/` path', 'claimed by `test/card.test.mjs`'],
  ['an issue reference', 'claimed by #412'],
  ['an owner ruling', 'excepted by U10'],
]) {
  test(`a new id named beside ${form} is reported with the line that covered it, exit 0`, () => {
    const { status, out } = cardCheck(lines('# A card', '', 'It adds R-NEW-1.', '', `- R-NEW-1 is ${cover}.`));
    assert.equal(status, 0, out);
    assert.match(out, /R-NEW-1/);
    assert.match(out, /line 5/);
    assert.ok(out.includes(cover), out);
  });
}

test('a new id with no line naming it beside a claim is a finding, exit 1', () => {
  // The cover sits on another line than the id, so it covers nothing.
  const { status, out } = cardCheck(lines('# A card', '', 'It adds R-NEW-1.', '', 'Tested in `test/card.test.mjs`, filed from #12 under U10.'));
  assert.equal(status, 1, out);
  assert.match(out, /line 3\b.*R-NEW-1.*no claiming test or exception/);
});

test('an id that only extends a live id is still new: R-CARD-12 is not R-CARD-1', () => {
  const { status, out } = cardCheck(lines('It adds R-CARD-12.'));
  assert.equal(status, 1, out);
  assert.match(out, /R-CARD-12.*no claiming test or exception/);
});

test('a `test/` path must be a path: a word ending in test/ covers nothing', () => {
  const { status, out } = cardCheck(lines('R-NEW-1 goes in latest/notes.'));
  assert.equal(status, 1, out);
});

test('a new id inside any fence is found as anywhere else', () => {
  const bare = cardCheck(lines('# A card', '', '```', '| R-NEW-2 | A row. |', '```'));
  assert.equal(bare.status, 1, bare.out);
  assert.match(bare.out, /line 4\b.*R-NEW-2/);
  const covered = cardCheck(lines('# A card', '', '```markdown', '| R-NEW-2 | A row. |', '```', '', 'R-NEW-2 is claimed by #900.'));
  assert.equal(covered.status, 0, covered.out);
  assert.match(covered.out, /R-NEW-2.*line 7/);
});

test('an id allocated only in the retired register is not new, exit 0', () => {
  const { status, out } = cardCheck(lines('It cites R-OLD-1, withdrawn.'));
  assert.equal(status, 0, out);
  assert.match(out, /nothing found/);
});

test('a pinned fence the lint finds nothing in: nothing found, exit 0', () => {
  const { status, out } = cardCheck(lines('# A card', '', '```markdown', 'The engine reads the board.', '```'));
  assert.equal(status, 0, out);
  assert.match(out, /nothing found/);
});

test('a pinned fence with a lint finding reports it on the body line it falls on, exit 1', () => {
  const { status, out } = cardCheck(lines('# A card', '', '```markdown', 'The engine reads the board.', '', 'A card is never parked.', '', LONG, '```'));
  assert.equal(status, 1, out);
  assert.match(out, /line 6\b.*ruled-out term `parked`/);
  assert.match(out, /line 8\b.*sentence of 15 words/);
});

test('the same prose outside a pinned fence is not linted', () => {
  const { status, out } = cardCheck(lines('# A card', '', 'A card is never parked.', '', LONG));
  assert.equal(status, 0, out);
});

for (const [name, open, close] of [
  ['a tilde fence with info string `markdown`', '~~~markdown', '~~~'],
  ['info string `markdown title`', '``` markdown title', '```'],
]) {
  test(`${name} is pinned`, () => {
    const { status, out } = cardCheck(lines('# A card', '', open, 'A card is never parked.', close));
    assert.equal(status, 1, out);
    assert.match(out, /line 4\b.*`parked`/);
  });
}

for (const info of ['md', 'text', '', 'markdownish', 'title markdown']) {
  test(`info string \`${info}\` is not pinned, exit 0 for its prose`, () => {
    const { status, out } = cardCheck(lines('# A card', '', `\`\`\`${info}`, 'A card is never parked.', '', LONG, '```'));
    assert.equal(status, 0, out);
    assert.match(out, /nothing found/);
  });
}

test('a `markdown` fence never closed is pinned to the end of the body', () => {
  const { status, out } = cardCheck(lines('# A card', '', '```markdown', 'The engine reads.', '', '', 'A card is never parked.'));
  assert.equal(status, 1, out);
  assert.match(out, /line 7\b.*`parked`/);
});

test('a fence closes only on a run of its own character at least as long, with nothing after it', () => {
  // Each line in the middle would close a shorter or other fence, so the text after it is still
  // inside the pinned one.
  const { status, out } = cardCheck(lines('````markdown', '```', '~~~~', '```` trailing', 'A card is never parked.', '````', 'Never parked here.'));
  assert.equal(status, 1, out);
  assert.match(out, /line 5\b.*`parked`/);
  assert.doesNotMatch(out, /line 7\b/);
});

test('a fence indented four spaces opens nothing', () => {
  const { status, out } = cardCheck(lines('    ```markdown', 'A card is never parked.'));
  assert.equal(status, 0, out);
});

test('a body with CRLF line endings gets the same answer as with LF', () => {
  const body = ['# A card', '', 'It adds R-NEW-1.', '', '```markdown', 'A card is never parked.', '', LONG, '```', ''];
  const lf = cardCheck(body.join('\n'));
  const crlf = cardCheck(body.join('\r\n'));
  assert.equal(lf.status, 1, lf.out);
  assert.equal(crlf.status, lf.status);
  assert.equal(crlf.out, lf.out);
});

test('a lone carriage return splits no line, as R-CARD-13 splits a body', () => {
  // Read as two lines, the id would sit on line 2 with no cover; read as one, the cover is on its line.
  const { status, out } = cardCheck('R-NEW-1 is new.\rClaimed by #5.\n');
  assert.equal(status, 0, out);
});

test('a body with both a new-id defect and a pinned-fence finding reports both, exit 1', () => {
  const { status, out } = cardCheck(lines('It adds R-NEW-1.', '', '```markdown', 'A card is never parked.', '```'));
  assert.equal(status, 1, out);
  assert.match(out, /line 1\b.*R-NEW-1.*no claiming test or exception/);
  assert.match(out, /line 4\b.*`parked`/);
});

test('no body-file argument prints usage, exit 2', () => {
  const { status, out } = run([]);
  assert.equal(status, 2, out);
  assert.match(out, /usage: npm run check:card -- <body-file> \[root\]/i);
});

test('a body file that is missing names the path and the cause, exit 2', () => {
  const missing = join(temporaryDirectory('rigger-card-body-'), 'absent.md');
  const { status, out } = run([missing, repository()]);
  assert.equal(status, 2, out);
  assert.ok(out.includes(missing), out);
  assert.match(out, /ENOENT|no such file/);
});

test('a body path that is a directory names the path and the cause, exit 2', () => {
  const directory = temporaryDirectory('rigger-card-body-');
  const { status, out } = run([directory, repository()]);
  assert.equal(status, 2, out);
  assert.ok(out.includes(directory), out);
  assert.match(out, /EISDIR/);
});

for (const path of [
  'docs/spec/requirements.md',
  'docs/spec/requirements-retired.md',
  'docs/spec/decisions-retired.md',
  '.claude/skills/spec-style/SKILL.md',
]) {
  test(`${path} missing under root names the path and the cause, exit 2`, () => {
    const root = repository({ [path]: null });
    const { status, out } = cardCheck(lines('Nothing new.'), root);
    assert.equal(status, 2, out);
    assert.ok(out.includes(join(root, path)), out);
    assert.match(out, /ENOENT|no such file/);
  });
}

for (const [what, skill] of [
  ['no ceiling', SKILL.replace('never past 12', 'kept short')],
  ['no terms', SKILL.replace('### 1. One term per concept', '### One term per concept')],
]) {
  test(`the spec-style skill stating ${what} names the path and the cause, exit 2`, () => {
    const root = repository({ '.claude/skills/spec-style/SKILL.md': skill });
    const { status, out } = cardCheck(lines('Nothing new.'), root);
    assert.equal(status, 2, out);
    assert.ok(out.includes(join(root, '.claude/skills/spec-style/SKILL.md')), out);
    assert.match(out, /states no/);
  });
}

test('the pinned-fence check reports what `findings` reports for the same content, and nothing more', () => {
  const content = ['The engine reads the board.', '', 'A card is never parked or bubbled.', '', LONG, '', '| R-CARD-1 | ' + LONG + ' |'];
  const body = lines('# A card', '', '```markdown', ...content, '```');
  const rules = { ceiling: sentenceCeiling(SKILL), terms: ruledOutTerms(SKILL) };
  // The content opens on body line 4, so each finding's line moves by three.
  const expected = findings(content.join('\n'), rules).map((one) => ({ ...one, line: one.line + 3 }));
  assert.ok(expected.length >= 4, 'the content should break both rules more than once');
  assert.deepEqual(checkCard(body, repository()).pinned, expected);
  const { out } = cardCheck(body);
  const reported = out.split('\n').filter((line) => /^line \d+/.test(line));
  assert.equal(reported.length, expected.length, out);
});

test('a register under root that cannot be read names its path and the cause, exit 2', () => {
  const root = repository({ 'docs/spec/requirements.md': null });
  mkdirSync(join(root, 'docs/spec/requirements.md'));
  const { status, out } = cardCheck(lines('Nothing new.'), root);
  assert.equal(status, 2, out);
  assert.ok(out.includes(join(root, 'docs/spec/requirements.md')), out);
  assert.match(out, /EISDIR/);
});

test('a spec-style skill keeping its one-term rule but ruling out no term names the path and the cause, exit 2', () => {
  // The rule's heading stays, so the reader finds the section; with no `never` in it, it reads
  // an empty set, and an empty set would let every pinned term through as nothing found.
  const skill = SKILL.replace('A card is escalated — never bubbled, parked or forwarded.', 'Use one term for each concept.');
  const root = repository({ '.claude/skills/spec-style/SKILL.md': skill });
  const { status, out } = cardCheck(lines('```markdown', 'A card is never parked.', '```'), root);
  assert.equal(status, 2, out);
  assert.ok(out.includes(join(root, '.claude/skills/spec-style/SKILL.md')), out);
  assert.match(out, /states no ruled-out term/);
});
