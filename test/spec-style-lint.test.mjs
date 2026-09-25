// ABOUTME: Tests spec-style-lint: where its ceiling and its ruled-out terms come from, what it
// reads, what it declines to say, and that the binding documents pass it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HELD,
  check,
  findings,
  lintFiles,
  ruledOutTerms,
  sentenceCeiling,
  sentences,
} from '../scripts/spec-style-lint.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The rules a document is read under, with the numbers and spellings a test cares about. */
const under = (terms, ceiling = 40) => ({ ceiling, terms: new Set(terms) });

// A skill shaped like the real one, written out here so each expectation below is derived from
// the form the lint reads rather than from whatever the binding documents happen to say today.
const SKILL = [
  '---',
  'name: spec-style',
  'description: Four form rules for any diff touching README.md, ARCHITECTURE.md or docs/spec/.',
  '---',
  '',
  '### 1. One term per concept',
  '',
  'A card is **escalated** — never bubbled, parked or forwarded.',
  'A judge returns a **verdict**, never an approval or a sign-off.',
  'The converse binds as hard: where two words name two things, never collapse them.',
  '',
  '### 2. Sentences of about 25 words, and never past 40',
  '',
  'Split a compound, and never nest an aside.',
].join('\n');

test('the sentence ceiling is read from the skill, not typed into the lint', () => {
  const skill = '### 2. Sentences of about 25 words, and never past 40\n';
  assert.equal(sentenceCeiling(skill), 40);
});

test('the ruled-out terms are read from the skill, not typed into the lint', () => {
  assert.deepEqual(
    [...ruledOutTerms(SKILL)].sort(),
    ['approval', 'bubbled', 'forwarded', 'parked', 'sign-off'],
  );
});

test('only the one-term rule supplies terms, so a `never` elsewhere in the skill supplies none', () => {
  // Rule 2 forbids nesting an aside, which is not a word the binding documents may not use.
  assert.ok(!ruledOutTerms(SKILL).has('nest'));
});

test('a prohibition that is a phrase rather than a term supplies nothing', () => {
  // "never collapse them" rules out an act, not a spelling, and a lint that read it as a term
  // would fail every document using the word `collapse`.
  assert.ok(!ruledOutTerms(SKILL).has('collapse'));
});

test('a ruled-out term is a finding, and names the line it sits on', () => {
  const document = ['The gate reads verdict markers.', '', 'A judge returned an approval.', ''].join('\n');
  const found = findings(document, under(['approval']));
  assert.deepEqual(
    found.map((f) => ({ rule: f.rule, line: f.line, term: f.term })),
    [{ rule: 'term', line: 3, term: 'approval' }],
  );
});

test('a ruled-out term is matched at word boundaries, so launchd is not launch', () => {
  assert.deepEqual(findings('The launchd assets that do it are L0.\n', under(['launch'])), []);
});

/** A run of n plain words ending in a full stop: one sentence of exactly n words. */
const sentenceOf = (n) => `${Array.from({ length: n }, () => 'word').join(' ')}.`;

test('a sentence past the ceiling names its word count and the line its paragraph starts on', () => {
  const document = ['A short sentence.', '', sentenceOf(41), ''].join('\n');
  assert.deepEqual(
    findings(document, under([])).map((f) => ({ rule: f.rule, line: f.line, words: f.words })),
    [{ rule: 'sentence', line: 3, words: 41 }],
  );
});

test('a sentence at the ceiling is not past it', () => {
  assert.deepEqual(findings(sentenceOf(40), under([])), []);
});

test('changing the number the skill states changes which sentences the lint flags', () => {
  const raised = SKILL.replace('never past 40', 'never past 45');
  const at = { terms: new Set() };
  assert.equal(findings(sentenceOf(41), { ...at, ceiling: sentenceCeiling(SKILL) }).length, 1);
  assert.equal(findings(sentenceOf(41), { ...at, ceiling: sentenceCeiling(raised) }).length, 0);
});

test('a paragraph broken across lines is read as the sentences it holds, not as its lines', () => {
  // Read line by line neither line passes a ceiling of six: the first holds six words and the
  // second two. Read as the paragraph it is, the one sentence holds eight and does.
  const document = ['The gate reads verdict markers and', 'nothing else.', ''].join('\n');
  assert.deepEqual(findings(document, under([], 6)).map((f) => ({ line: f.line, words: f.words })), [
    { line: 1, words: 8 },
  ]);
});

/** A run of n plain words with no full stop, so anything that joins them makes one sentence. */
const wordsOf = (n) => Array.from({ length: n }, () => 'word').join(' ');

test('the splitter reads a full stop wrongly in both directions, and neither way is silent', () => {
  // A capital after the stop ends the sentence, so an abbreviation splits one into two.
  assert.deepEqual(sentences('A maker, e.g. Rigger, reads the card.'), [
    'A maker, e.g.',
    'Rigger, reads the card.',
  ]);
  // A lowercase word after the stop does not, so two sentences run on as one.
  assert.deepEqual(sentences('The card is pulled. v0 dispatches a maker.'), [
    'The card is pulled. v0 dispatches a maker.',
  ]);
});

test('an abbreviation can carry a sentence past the ceiling without a finding', () => {
  // The cost of the split above, stated as what it hides. The two documents differ by one word,
  // `e.g.` against `from`, and both hold one sentence of forty-one words.
  const abbreviated = `${wordsOf(5)} e.g. Rigger ${wordsOf(34)}.`;
  const control = abbreviated.replace('e.g.', 'from');

  assert.deepEqual(findings(`${abbreviated}\n`, under([])), []);
  assert.deepEqual(findings(`${control}\n`, under([])).map((f) => f.words), [41]);
});

test('a bulleted list produces no sentence finding, however many words its items hold together', () => {
  const document = ['- ', '- ', '- '].map((bullet) => bullet + wordsOf(20)).join('\n');
  assert.deepEqual(findings(`${document}\n`, under([])), []);
});

test('a numbered list produces no sentence finding either', () => {
  const document = ['1. ', '2. ', '3. '].map((number) => number + wordsOf(20)).join('\n');
  assert.deepEqual(findings(`${document}\n`, under([])), []);
});

/** A two-column register table whose one row holds `cell` beside the id `R-LOOP-1`, on line 3. */
const tableOf = (cell) => ['| id | requirement |', '|---|---|', `| R-LOOP-1 | ${cell} |`, ''].join('\n');

test('a sentence in a table cell past the ceiling is a finding naming its line and its row', () => {
  // The registers hold every requirement and decision in a row, so a ceiling read only off prose
  // is never applied where the binding text lives.
  assert.deepEqual(
    findings(tableOf(sentenceOf(41)), under([])).map(({ rule, line, words, row }) => ({ rule, line, words, row })),
    [{ rule: 'sentence', line: 3, words: 41, row: 'R-LOOP-1' }],
  );
});

test('a sentence in a table cell at the ceiling is not past it', () => {
  assert.deepEqual(findings(tableOf(sentenceOf(40)), under([])), []);
});

test('a table row inside a fenced block produces no sentence finding', () => {
  // A fence shows what a row looks like rather than binding anything, so it stays code.
  const document = ['```markdown', tableOf(sentenceOf(41)).trimEnd(), '```', ''].join('\n');
  assert.deepEqual(findings(document, under([])), []);
});

test('a ruled-out term in a table cell is a finding', () => {
  assert.deepEqual(
    findings(tableOf('A judge returns an approval.'), under(['approval'])).map(({ rule, line, term }) => ({ rule, line, term })),
    [{ rule: 'term', line: 3, term: 'approval' }],
  );
});

test('the splitter reads a cell with the same bias it reads a paragraph with', () => {
  // The same pair as the paragraph test above: `e.g.` splits one sentence of forty-one words into
  // two, which hides it, and `from` in its place leaves it whole, which does not.
  const abbreviated = `${wordsOf(5)} e.g. Rigger ${wordsOf(34)}.`;
  assert.deepEqual(findings(tableOf(abbreviated), under([])), []);
  assert.deepEqual(findings(tableOf(abbreviated.replace('e.g.', 'from')), under([])).map((f) => f.words), [41]);
  // And a lowercase word after a stop runs two cell sentences on as one, which can only add one:
  // twenty words, then `v0` and twenty more, read as a single sentence of forty-one.
  const merged = `${wordsOf(20)}. v0 ${wordsOf(20)}.`;
  assert.deepEqual(findings(tableOf(merged), under([])).map((f) => f.words), [41]);
});

test('a fenced code block produces no sentence finding', () => {
  const document = ['```js', `const rule = '${wordsOf(60)}';`, '```', ''].join('\n');
  assert.deepEqual(findings(document, under([])), []);
});

test('the lint reports no finding about voice', () => {
  // Rule 3 turns on whether the actor is genuinely unknown, which is a judgment no lint makes.
  assert.deepEqual(findings('A verdict was returned.\n', under([])), []);
});

test('the lint reports no finding about whether prose should have been a list', () => {
  // Rule 4 turns on whether a structure fits its meaning, which is the same kind of judgment.
  const prose = 'First the engine pulls, then it dispatches, then it judges, then it merges.\n';
  assert.deepEqual(findings(prose, under([])), []);
});

test('the lint reads README.md, ARCHITECTURE.md, docs/spec/decisions.md and docs/spec/requirements.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-lint-'));
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  mkdirSync(join(root, 'docs', 'derived'), { recursive: true });
  mkdirSync(join(root, 'docs', 'journal'), { recursive: true });
  for (const path of [
    ['README.md'],
    ['ARCHITECTURE.md'],
    ['AGENTS.md'],
    // The journal's own README is the sharpest case: the scope entry is a root-relative path
    // rather than a basename, so a nested `README.md` is not the one the lint reads.
    ['docs', 'journal', 'README.md'],
    ['docs', 'v0-build-plan.md'],
    ['docs', 'derived', 'test-matrix.md'],
    ['docs', 'spec', 'decisions.md'],
    ['docs', 'spec', 'decisions-retired.md'],
    ['docs', 'spec', 'requirements.md'],
    ['docs', 'spec', 'requirements-retired.md'],
  ]) writeFileSync(join(root, ...path), 'A document.\n');

  assert.deepEqual(lintFiles(root, SKILL), [
    'README.md',
    'ARCHITECTURE.md',
    'docs/spec/decisions.md',
    'docs/spec/requirements.md',
  ]);
});

test('the lint reads only scope roots named by the skill', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-scope-'));
  writeFileSync(join(root, 'README.md'), 'A document.\n');
  writeFileSync(join(root, 'ARCHITECTURE.md'), 'A document.\n');

  const narrowed = SKILL.replace(', ARCHITECTURE.md or docs/spec/', '');
  assert.deepEqual(lintFiles(root, narrowed), ['README.md']);
});

test('the four linted documents pass the lint', () => {
  // The lint guards documents it did not write. A finding here is a claim about the binding
  // documents, which only the owner may change, so a red here means the lint is wrong until they
  // say otherwise. The message carries every finding, because one at a time would cost a round
  // each.
  const reported = check(repository).findings
    .map((f) => `${f.path}:${f.line}  ${f.rule}  ${f.term ?? `${f.words} words`}  ${f.text}`);
  assert.deepEqual(reported, []);
});

test('a finding names the file it sits in, alongside the line and the word count', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-names-'));
  mkdirSync(join(root, '.claude', 'skills', 'spec-style'), { recursive: true });
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'spec-style', 'SKILL.md'), SKILL);
  writeFileSync(join(root, 'README.md'), 'The engine runs the loop.\n');
  writeFileSync(join(root, 'ARCHITECTURE.md'), `${sentenceOf(41)}\n`);
  writeFileSync(join(root, 'docs', 'spec', 'decisions.md'), 'A decision was chosen.\n');

  assert.deepEqual(
    check(root).findings.map(({ path, line, words }) => ({ path, line, words })),
    [{ path: 'ARCHITECTURE.md', line: 1, words: 41 }],
  );
});

/** A repository holding the fixture skill and a decisions register whose one row holds `cell`. */
function repositoryWithRow(cell) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-row-'));
  mkdirSync(join(root, '.claude', 'skills', 'spec-style'), { recursive: true });
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'spec-style', 'SKILL.md'), SKILL);
  writeFileSync(join(root, 'README.md'), 'The engine runs the loop.\n');
  writeFileSync(join(root, 'ARCHITECTURE.md'), 'Eight layers, each with one job.\n');
  writeFileSync(join(root, 'docs', 'spec', 'decisions.md'), tableOf(cell).replace('R-LOOP-1', 'D1'));
  return root;
}

/** Runs the lint the way `npm run lint:spec-style` does, against another repository. */
const lintCommand = (root) =>
  spawnSync(process.execPath, [join(repository, 'scripts', 'spec-style-lint.mjs'), root], { encoding: 'utf8' });

test('the lint exits non-zero on a row whose cell holds a 41-word sentence, and names the row', () => {
  const run = lintCommand(repositoryWithRow(sentenceOf(41)));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /docs\/spec\/decisions\.md:3 {2}sentence of 41 words in row D1\n/);
});

test('the lint exits zero on the same row with that sentence at 40 words', () => {
  const run = lintCommand(repositoryWithRow(sentenceOf(40)));
  assert.equal(run.status, 0, run.stderr);
});

test('a held finding is reported apart from the findings, and does not fail the lint', () => {
  const root = repositoryWithRow(sentenceOf(41));
  const held = [{ path: 'docs/spec/decisions.md', row: 'D1', words: 41, why: 'the owner is ruling on it' }];
  const result = check(root, held);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.held.map(({ path, line, row, words }) => ({ path, line, row, words })), [
    { path: 'docs/spec/decisions.md', line: 3, row: 'D1', words: 41 },
  ]);
  assert.equal(result.failing, false);
});

test('a hold covers only the length it names, so a rewording that changes it is read afresh', () => {
  const root = repositoryWithRow(sentenceOf(42));
  const held = [{ path: 'docs/spec/decisions.md', row: 'D1', words: 41, why: 'the owner is ruling on it' }];
  assert.deepEqual(check(root, held).findings.map(({ row, words }) => ({ row, words })), [{ row: 'D1', words: 42 }]);
});

test('the lint prints each held finding with why it is held, and exits zero on this repository', () => {
  // A hold is a question put to the owner, so it stays in view on every run rather than going quiet.
  const run = lintCommand(repository);
  assert.equal(run.status, 0, run.stderr);
  for (const hold of HELD) {
    assert.ok(run.stdout.includes(`${hold.path}:`), `${hold.path} is not printed`);
    assert.ok(run.stdout.includes(`sentence of ${hold.words} words in row ${hold.row}, held: ${hold.why}`));
  }
});

test('every held finding is still raised by the document it names', () => {
  // A hold outliving its finding would go on excusing whatever that row says next, so a hold the
  // documents no longer raise is a stale one to delete.
  const { held } = check(repository);
  const stale = HELD.filter((hold) => !held.some((one) => one.path === hold.path && one.row === hold.row));
  assert.deepEqual(stale, []);
});

test('a retired register row past the ceiling is not read', () => {
  // A retired row keeps the exact text it bound with, so a finding against it asks for a
  // rewording the register forbids.
  const root = repositoryWithRow(sentenceOf(40));
  writeFileSync(join(root, 'docs', 'spec', 'decisions-retired.md'), tableOf(sentenceOf(41)));
  assert.deepEqual(check(root).findings, []);
});

test('the skill names which of its rules the lint covers', () => {
  const skill = readFileSync(join(repository, '.claude/skills/spec-style/SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /Nothing checks these mechanically/i);
  assert.match(skill, /spec-style-lint/);
  assert.match(skill, /rules 1 and 2/i);
  assert.match(skill, /rules 3 and 4/i);
  assert.match(skill, /Rule 5/);
});

/** The shipped spec-style skill, read off disk rather than the fixture above. */
const shipped = () => readFileSync(join(repository, '.claude/skills/spec-style/SKILL.md'), 'utf8');

/**
 * One numbered rule section of the skill, heading and body, or undefined where it states none.
 *
 * The split takes `##` as well as `###`, so a rule section ends where the next section of the
 * skill begins. Splitting on `###` alone would run the last rule to the end of the file, and
 * every assertion about that rule could then be satisfied by text belonging to another.
 */
const ruleOf = (skill, number) => skill.split(/^#{2,3}\s+/m).find((part) => part.startsWith(`${number}.`));

test('the skill says the lint reads table cells, and says nothing of skipping rows', () => {
  // The break is the passage going on describing the lint as it read before cells were read, so
  // an author trusts a green run to have measured the rows it never measured.
  const passage = shipped().split(/^- /m).find((part) => part.startsWith('**Not all of it lintable'));
  assert.ok(passage, 'the skill has no "Not all of it lintable" passage');
  assert.match(passage, /every table cell/);
  assert.doesNotMatch(passage, /\bskips?\s+(?:\w+\s+)?(?:rows|tables)\b|\b(?:rows|tables)\s+(?:are|is)\s+skipped/i);
});

test('rule 4 gives a register table its own form for a rule with three or more conditions', () => {
  // A register table cannot hold a list, so a rule 4 naming only lists leaves a register author
  // one long cell, which is the form the sentence ceiling refuses.
  const rule = ruleOf(shipped(), 4);
  assert.match(rule, /lead\s+row/);
  assert.match(rule, /continuation\s+rows\s+each\s+holding\s+one\s+condition/);
  assert.match(rule, /`R-GATE-4`\s+to\s+`R-GATE-8`/);
});

test('the skill states the ownership rule a passage is read against', () => {
  // The break this names is the ordinary one for a shipped instruction file: the rule dropped in
  // a later edit, or reduced to a note about length. What the skill states is the whole of what
  // it does, so each of the rule's three conditions is asserted on its own. `templates/` is not
  // read here — `test/init.test.mjs` is what holds the two copies identical.
  const rule = ruleOf(shipped(), 5);

  assert.ok(rule, 'the skill states no fifth rule');
  assert.match(rule, /owns/, 'the fifth rule says nothing about who owns a fact');
  assert.match(rule, /restat/i, 'the fifth rule says nothing about restating a cited source');
  assert.match(rule, /\bterm\b/, 'the fifth rule says nothing about a term nothing defines');
});

test('the skill states as many rules as it holds', () => {
  // The break this names is a rule added or dropped while a count elsewhere in the file goes on
  // stating the old number. The count is written in four places and nothing tied any of them to
  // the sections, so the skill could ship saying it holds one number of rules and hold another.
  const skill = shipped();
  const words = { three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const held = [...skill.matchAll(/^### (\d+)\./gm)].map((found) => Number(found[1]));
  const counted = [...skill.matchAll(/\b(three|four|five|six|seven)\s+(?:form\s+)?rules\b/gi)]
    .map((found) => words[found[1].toLowerCase()]);

  assert.deepEqual(held, held.map((_, index) => index + 1), `the rule sections run ${held}`);
  assert.ok(counted.length > 0, 'the skill states no number of rules for the sections to match');
  assert.deepEqual(counted, counted.map(() => held.length), `${held.length} sections, counted ${counted}`);
});
