// ABOUTME: Checks Rigger's binding documents against the two spec-style rules a machine can
// read: the ruled-out terms, and the sentence ceiling. Both come from the skill. `--hints` adds
// advisory hints for rules 4 and 5, which change neither the findings nor the exit.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countWords } from './instruction-budget.mjs';

// The skill owns the lint rules and scope roots. The document walk excludes retired registers.
const SKILL = '.claude/skills/spec-style/SKILL.md';

/**
 * A document's lines, trimmed, with every line of a fenced block — its fences included — blanked.
 *
 * A fenced block is code rather than a sentence at all, and a blank line is what every reader
 * below already treats as ending whatever ran before it.
 */
function unfenced(text) {
  let fence = null;
  return text.split('\n').map((raw) => {
    const line = raw.trim();
    const marker = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (marker && line.startsWith(fence)) fence = null;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line;
  });
}

/**
 * The prose paragraphs of a markdown document, each with the line its first word sits on.
 *
 * A list and a diagram are rule 4's answer to a structure prose carries badly, so measuring one
 * as a sentence would fail a document for doing the thing the register asks of it. A table row
 * is not prose either, and `rows` reads it instead.
 */
export function paragraphs(text) {
  const found = [];
  let open = null;
  const close = () => {
    if (open) found.push(open);
    open = null;
  };
  unfenced(text).forEach((line, index) => {
    // A blank line, a table row, a heading, a block quote and a list marker all end the prose
    // that ran before them, and none of them opens prose of its own. A line under a list marker
    // belongs to the item and ends with it, which is why nothing reopens until the next
    // paragraph.
    if (/^$|^[|#>]|^(?:[-*+]|\d+[.)])\s/.test(line)) {
      close();
      return;
    }
    if (open) open.text += ` ${line}`;
    else open = { line: index + 1, text: line };
  });
  close();
  return found;
}

/**
 * The table rows of a markdown document, each with its line and the text of its cells.
 *
 * The registers hold every requirement and decision in a row, so each cell is read for its
 * sentences exactly as a paragraph is. A row is one line, and a cell ends at the next pipe.
 *
 * An escaped pipe, `\|`, ends a cell here where markdown would not. That splits one cell's text
 * in two, so its count comes out low, the direction `sentences` discloses as hiding a finding.
 */
export function rows(text) {
  const found = [];
  unfenced(text).forEach((line, index) => {
    if (!line.startsWith('|')) return;
    const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    found.push({ line: index + 1, cells });
  });
  return found;
}

/**
 * The sentences in one paragraph, or in one table cell.
 *
 * A sentence ends at a full stop, question mark or exclamation, once whatever closes the sentence
 * is past — a quote, a bracket, a backtick, an emphasis marker. The next word settles whether the
 * stop ended a sentence or abbreviated a word: a capital or a digit says it ended one, through
 * whatever opens the next word.
 *
 * That test is wrong in both directions, and a reader of a finding needs both.
 *
 * It **merges** where a sentence genuinely ends and the next word is lowercase — `take. v0 buys`
 * — and reads the two as one. The count comes out high, so a merge can only add a finding.
 *
 * It **splits** where a full stop abbreviates a word and the next word is capitalised — `e.g.
 * Rigger` — and reads the one as two. The count comes out low, so a split can hide a sentence
 * that is past the ceiling. A green run therefore says that no sentence the splitter reads is
 * past the ceiling, which is a narrower claim than no sentence being past it.
 *
 * Telling an abbreviation from a full stop needs a list of abbreviations, and no document here
 * owns one. A shape rule would catch `e.g.` and leave `vs.`, narrowing the bias without removing
 * it, and a narrower bias is harder to state than this one. So the bias is disclosed instead,
 * and `test/spec-style-lint.test.mjs` pins both directions, which makes changing either a
 * decision someone took rather than a drift.
 */
export function sentences(paragraph) {
  const found = [];
  let run = [];
  const tokens = paragraph.split(/\s+/).filter(Boolean);
  tokens.forEach((token, index) => {
    run.push(token);
    if (!/[.!?][*_"')\]`]*$/.test(token)) return;
    const next = tokens[index + 1];
    // A backticked span opens a sentence whatever its case, because the case is the code's and
    // not the author's: `rigger report` starts a sentence exactly as `Rigger` would.
    const starts = next === undefined || /^`/.test(next) || /^[*_"'([]*[A-Z0-9]/.test(next);
    if (starts) {
      found.push(run.join(' '));
      run = [];
    }
  });
  if (run.length) found.push(run.join(' '));
  return found;
}

/** Every way one document breaks the two rules a machine can read, in the order they appear. */
export function findings(text, { ceiling, terms }) {
  const found = [];
  const lines = text.split('\n');
  for (const paragraph of paragraphs(text)) {
    // A paragraph runs across lines, so a sentence inside one starts at a line the paragraph no
    // longer knows. The finding names the paragraph's own line and carries the sentence, which
    // is what takes a reader the rest of the way.
    for (const sentence of sentences(paragraph.text)) {
      const words = countWords(sentence);
      if (words > ceiling) found.push({ rule: 'sentence', line: paragraph.line, words, text: sentence });
    }
  }
  // A row's first cell is its id wherever a register has one, so it is what takes a reader to the
  // row a finding is about.
  for (const { line, cells } of rows(text)) {
    for (const sentence of cells.flatMap(sentences)) {
      const words = countWords(sentence);
      if (words > ceiling) found.push({ rule: 'sentence', line, row: cells[0], words, text: sentence });
    }
  }
  // Every line is read for a term, a table row and a fenced block included. A fenced block carries
  // no sentence, but it does carry words, and rule 1 is about which words the binding documents use.
  for (const term of terms) {
    const boundary = new RegExp(`\\b${term}\\b`, 'i');
    lines.forEach((line, index) => {
      if (boundary.test(line)) found.push({ rule: 'term', line: index + 1, term, text: line.trim() });
    });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** How many whole-word, case-blind occurrences of `words` one sentence holds. */
const occurrences = (sentence, words) =>
  (sentence.match(new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi')) ?? []).length;

// What a sentence names a source by: an `R-` id, a `D#`, or a backticked path.
const SOURCE = /(?<![\w-])R-[A-Z][A-Z0-9]*-\d+(?![\w-])|(?<![\w-])D\d+\b|`[\w.-]*\/[\w./-]*`|`[\w-]+\.\w+`/;
// One run inside straight or curly double quotes.
const QUOTED = /"([^"]*)"|\u201c([^\u201d]*)\u201d/g;

/** The rules, 4 and 5, a sentence shows a sign of failing: none, one or both. */
function hinting(sentence) {
  const rules = [];
  // A sequence of four steps holds three `then`. `and where` holds one `where`, so it counts once.
  const steps = occurrences(sentence, ['then']) >= 3;
  if (steps || occurrences(sentence, ['where', 'if', 'unless']) >= 3) rules.push(4);
  // Runs are measured one at a time, so two short quotes are not one restatement.
  const quotes = [...sentence.matchAll(QUOTED)].map((run) => countWords(run[1] ?? run[2]));
  if (SOURCE.test(sentence) && quotes.some((words) => words >= 8)) rules.push(5);
  return rules;
}

/**
 * The lines, numbered from 1, on which a list item's text goes on past its marker line.
 *
 * `paragraphs` trims indentation, so it reads such a line as prose, and the hints leave it alone
 * here instead: a list item is rule 4's answer, however many lines it runs onto. The extent is
 * CommonMark's. With no blank line between, a line goes on with the item's text, indented or not.
 * After a blank line, a line stays in an item only when indented to that item's content column,
 * which its marker and the spaces after it set. A line indented less ends every item it falls short of.
 */
function listContinuations(text) {
  const found = new Set();
  const raw = text.split('\n');
  // The content column of each open item, outermost first.
  let open = [];
  let blank = true;
  unfenced(text).forEach((line, index) => {
    if (line === '') {
      blank = true;
      return;
    }
    const indent = raw[index].match(/^\s*/)[0].length;
    const marker = line.match(/^(?:[-*+]|\d+[.)])\s+/);
    const after = blank;
    blank = false;
    if (marker) {
      open = open.filter((column) => column <= indent);
      open.push(indent + marker[0].length);
      return;
    }
    if (open.length === 0) return;
    // A heading, a table row or a block quote opens no paragraph, so only its indent matters.
    if (!after && !/^[|#>]/.test(line)) found.add(index + 1);
    else if (indent >= open[0]) {
      open = open.filter((column) => column <= indent);
      if (!/^[|#>]/.test(line)) found.add(index + 1);
    } else open = [];
  });
  return found;
}

/**
 * Advisory hints for rules 4 and 5, which are judgments: each points at a sentence a reader
 * should look at, and none is a finding. `findings` and the lint's exit never read them.
 *
 * A hint reads what `findings` reads for the ceiling, prose paragraphs and table cells, and not a
 * list item, since a list is already rule 4's answer.
 */
export function hints(text) {
  const found = [];
  const continued = listContinuations(text);
  for (const paragraph of paragraphs(text).filter(({ line }) => !continued.has(line))) {
    for (const sentence of sentences(paragraph.text)) {
      for (const rule of hinting(sentence)) found.push({ rule, line: paragraph.line, text: sentence });
    }
  }
  for (const { line, cells } of rows(text)) {
    for (const sentence of cells.flatMap(sentences)) {
      for (const rule of hinting(sentence)) found.push({ rule, line, row: cells[0], text: sentence });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * What the skill names for the lint: a root document or a directory of documents.
 *
 * The skill names its scope roots, so the lint asks it rather than carrying a second copy that
 * can disagree with the first.
 */
export function lintScope(skill) {
  const stated = skill.match(/for any diff touching ([^\n]+?)\.(?:\s|$)/);
  if (!stated) throw new Error('the spec-style skill names no documents for the lint to read');
  return stated[1].split(/,\s*|\s+or\s+/).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * The documents the lint reads, in the order the skill names them.
 *
 * A retired register is left out: its rows carry the exact text they carried when they bound, so
 * a finding against one asks for a rewording the register forbids.
 */
export function lintFiles(root, skill) {
  return lintScope(skill).flatMap((entry) => {
    if (!entry.endsWith('/')) return [entry];
    return readdirSync(join(root, entry))
      .filter((name) => name.endsWith('.md') && !/-retired\.md$/.test(name))
      .sort()
      .map((name) => `${entry}${name}`);
  });
}

/**
 * Every rule the documents the lint reads break, in the order it reads them, and the hints those
 * documents draw. Only the findings decide `failing`.
 */
export function check(root) {
  const skill = readFileSync(join(root, SKILL), 'utf8');
  const rules = { ceiling: sentenceCeiling(skill), terms: ruledOutTerms(skill) };
  const documents = lintFiles(root, skill);
  const texts = documents.map((path) => [path, readFileSync(join(root, path), 'utf8')]);
  const found = texts.flatMap(([path, text]) => findings(text, rules).map((one) => ({ path, ...one })));
  const hinted = texts.flatMap(([path, text]) => hints(text).map((one) => ({ path, ...one })));
  return { documents, findings: found, hints: hinted, failing: found.length > 0 };
}

/**
 * The words the skill's one-term rule rules out, read from the skill rather than typed here.
 *
 * The rule names them the one way it can: a sentence saying what the binding documents use, then
 * `never` and the spellings it does not. Only that rule's own section is read, because `never`
 * carries other work elsewhere in the skill. A prohibition of more than one word rules out an act
 * rather than a spelling — "never collapse them" — and this returns spellings, so those are
 * dropped.
 */
export function ruledOutTerms(skill) {
  const section = skill.split(/^###\s+/m).find((part) => /^1\./.test(part));
  if (!section) throw new Error('the spec-style skill states no one-term rule to read terms from');
  const terms = new Set();
  for (const prohibition of section.matchAll(/\bnever\s+([^.;:\n]+)/g)) {
    for (const item of prohibition[1].split(/,|\bor\b|\band\b/)) {
      const term = item.trim().replace(/^\*+|\*+$/g, '').replace(/^(?:an?|the)\s+/i, '').trim();
      if (/^[A-Za-z][A-Za-z-]*$/.test(term)) terms.add(term.toLowerCase());
    }
  }
  return terms;
}

/** The sentence ceiling, read from the spec-style skill rather than typed here. */
export function sentenceCeiling(skill) {
  const stated = skill.match(/never past (\d+)/i);
  if (!stated) throw new Error('the spec-style skill states no sentence ceiling to check against');
  return Number(stated[1]);
}

const USAGE = 'usage: node scripts/spec-style-lint.mjs [--hints] [root]';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the lint refuse one. `--hints` adds the advisory hints.
  const args = process.argv.slice(2);
  const showHints = args.includes('--hints');
  const positional = args.filter((arg) => arg !== '--hints');
  if (positional.length > 1 || positional.some((arg) => arg.startsWith('-'))) {
    console.error(USAGE);
    process.exit(2);
  }
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { documents, findings: found, hints: hinted, failing } = check(positional[0] ? resolve(positional[0]) : here);
  for (const { path, line, rule, term, words, row, text } of found) {
    const where = row === undefined ? '' : ` in row ${row}`;
    const why = rule === 'term' ? `ruled-out term \`${term}\`` : `sentence of ${words} words${where}`;
    console.error(`${path}:${line}  ${why}\n        ${text}`);
  }
  for (const path of documents) {
    console.log(`${String(found.filter((one) => one.path === path).length).padStart(6)}  ${path}`);
  }
  console.log(`${String(found.length).padStart(6)}  findings, against the rules ${SKILL} states`);
  if (showHints) {
    for (const { path, line, rule, row, text } of hinted) {
      const where = row === undefined ? '' : ` in row ${row}`;
      console.log(`${path}:${line}  rule ${rule} hint${where}\n        ${text}`);
    }
    console.log(`${String(hinted.length).padStart(6)}  hints, advisory: rules 4 and 5 hold by judgment, and no hint changes the exit`);
  }
  if (failing) {
    console.error(`Rules 1 and 2 of ${SKILL} bind every document above. A finding is a form to fix, never a rule to loosen.`);
    process.exit(1);
  }
}
