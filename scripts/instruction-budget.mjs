// ABOUTME: Checks the separate AGENTS.md and live .claude/ instruction pools against the word
// budgets ARCHITECTURE.md records.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The AGENTS.md pool covers the root file and every nested one together, which is
// ARCHITECTURE.md's Budgets section. Weighing them together is what makes moving text between
// them cost nothing; only deleting text spends less. `CLAUDE.md` is an import of the root file
// and carries no instructions of its own, so counting it would charge the same words twice.
const INSTRUCTION_FILE = 'AGENTS.md';
const SKIP = new Set(['.git', 'node_modules']);

/** The instruction-file word budget, read from ARCHITECTURE.md rather than typed here. */
export function instructionBudget(architecture) {
  const stated = architecture.match(/budget is ([\d,]+) words/i);
  if (!stated) throw new Error('ARCHITECTURE.md states no instruction-file word budget to check against');
  return Number(stated[1].replace(/,/g, ''));
}

/** Rigger's live role and skill budget, read from ARCHITECTURE.md. */
export function liveBudget(architecture) {
  const stated = architecture.match(/live instruction pool[\s\S]*?budget is ([\d,]+) words/i);
  if (!stated) throw new Error('ARCHITECTURE.md states no live instruction pool budget to check against');
  return Number(stated[1].replace(/,/g, ''));
}

/**
 * The words in one instruction file: whatever whitespace separates, and nothing else.
 *
 * This is not what GNU `wc -w` reports, and the difference matters before anyone quotes one
 * number against the other. `wc -w` does not count a token made only of non-ASCII punctuation,
 * so a standalone em dash or arrow is a word here and is not a word there. These instruction
 * files use both, which is the whole of why this count runs above `wc -w`'s. The budget is
 * enforced against this count.
 */
export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Every instruction file under a repository root, the root's own first. */
export function instructionFiles(root) {
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const sorted = entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const here = sorted.filter((e) => e.isFile() && e.name === INSTRUCTION_FILE).map((e) => join(dir, e.name));
    const below = sorted
      .filter((e) => e.isDirectory() && !SKIP.has(e.name))
      .flatMap((e) => walk(join(dir, e.name)));
    return [...here, ...below];
  };
  return walk(root);
}

/** Live role prompts and skill entry points; distribution templates are separate assets. */
export function liveFiles(root) {
  const agents = join(root, '.claude', 'agents');
  const skills = join(root, '.claude', 'skills');
  const walk = (dir, include) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path, include);
      return entry.isFile() && include(entry.name) ? [path] : [];
    });
  };
  return [...walk(agents, (name) => name.endsWith('.md')),
    ...walk(skills, (name) => name === 'SKILL.md')];
}

/** What the instruction files spend, file by file, and what they are allowed. */
export function check(root) {
  const architecture = readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8');
  const budget = instructionBudget(architecture);
  const liveLimit = liveBudget(architecture);
  const files = instructionFiles(root).map((path) => ({
    path,
    words: countWords(readFileSync(path, 'utf8')),
  }));
  const total = files.reduce((sum, file) => sum + file.words, 0);
  const live = liveFiles(root).map((path) => ({ path, words: countWords(readFileSync(path, 'utf8')) }));
  const liveTotal = live.reduce((sum, file) => sum + file.words, 0);
  return { budget, files, total, liveLimit, live, liveTotal };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is measured. A path measures that repository
  // instead, which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { budget, files, total, liveLimit, live, liveTotal } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const file of files) console.log(`${String(file.words).padStart(6)}  ${file.path}`);
  console.log(`${String(total).padStart(6)}  words, against a budget of ${budget}`);
  for (const file of live) console.log(`${String(file.words).padStart(6)}  ${file.path}`);
  console.log(`${String(liveTotal).padStart(6)}  live words, against a budget of ${liveLimit}`);
  if (total > budget) {
    console.error(`OVER BUDGET by ${total - budget} words. Moving text between instruction files spends nothing; deleting it is what spends less.`);
  }
  if (liveTotal > liveLimit) console.error(`LIVE OVER BUDGET by ${liveTotal - liveLimit} words.`);
  if (total > budget || liveTotal > liveLimit) process.exit(1);
}
