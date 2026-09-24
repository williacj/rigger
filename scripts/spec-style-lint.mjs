// ABOUTME: Checks Rigger's binding documents against the two spec-style rules a machine can
// read: the ruled-out terms, and the sentence ceiling. Both come from the skill.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countWords } from './instruction-budget.mjs';

// The skill owns the lint rules and scope roots. The document walk excludes retired registers.
const SKILL = '.claude/skills/spec-style/SKILL.md';

/**
 * The prose paragraphs of a markdown document, each with the line its first word sits on.
 *
 * Only prose is read for sentence length, and the skill is what decides that: a list, a table and
 * a diagram are rule 4's answer to a structure prose carries badly, so measuring one as a
 * sentence would fail a document for doing the thing the register asks of it. A fenced block is
 * code rather than a sentence at all.
 */
export function paragraphs(text) {
  const found = [];
  let open = null;
  let fence = null;
  const close = () => {
    if (open) found.push(open);
    open = null;
  };
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const marker = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (marker && line.startsWith(fence)) fence = null;
      return;
    }
    if (marker) {
      close();
      fence = marker[1];
      return;
    }
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
 * The sentences in one paragraph.
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
  // Every line is read for a term, a table row and a fenced block included. Those two carry no
  // sentence, but they do carry words, and rule 1 is about which words the binding documents use.
  for (const term of terms) {
    const boundary = new RegExp(`\\b${term}\\b`, 'i');
    lines.forEach((line, index) => {
      if (boundary.test(line)) found.push({ rule: 'term', line: index + 1, term, text: line.trim() });
    });
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

/** Every rule the documents the lint reads break, in the order it reads them. */
export function check(root) {
  const skill = readFileSync(join(root, SKILL), 'utf8');
  const rules = { ceiling: sentenceCeiling(skill), terms: ruledOutTerms(skill) };
  const documents = lintFiles(root, skill);
  const found = documents.flatMap((path) =>
    findings(readFileSync(join(root, path), 'utf8'), rules).map((one) => ({ path, ...one })));
  return { documents, findings: found, failing: found.length > 0 };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the lint refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { documents, findings: found, failing } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const { path, line, rule, term, words, text } of found) {
    const why = rule === 'term' ? `ruled-out term \`${term}\`` : `sentence of ${words} words`;
    console.error(`${path}:${line}  ${why}\n        ${text}`);
  }
  for (const path of documents) {
    console.log(`${String(found.filter((one) => one.path === path).length).padStart(6)}  ${path}`);
  }
  console.log(`${String(found.length).padStart(6)}  findings, against the rules ${SKILL} states`);
  if (failing) {
    console.error(`Rules 1 and 2 of ${SKILL} bind every document above. A finding is a form to fix, never a rule to loosen.`);
    process.exit(1);
  }
}
