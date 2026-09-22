// ABOUTME: Counts the words in Rigger's instruction files and refuses a set that has grown past
// ABOUTME: the budget ARCHITECTURE.md records. One number, one check, all the files together.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The budget covers the root `AGENTS.md` and every nested one together, which is
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

/** What the instruction files spend, file by file, and what they are allowed. */
export function check(root) {
  const budget = instructionBudget(readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8'));
  const files = instructionFiles(root).map((path) => ({
    path,
    words: countWords(readFileSync(path, 'utf8')),
  }));
  const total = files.reduce((sum, file) => sum + file.words, 0);
  return { budget, files, total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is measured. A path measures that repository
  // instead, which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { budget, files, total } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const file of files) console.log(`${String(file.words).padStart(6)}  ${file.path}`);
  console.log(`${String(total).padStart(6)}  words, against a budget of ${budget}`);
  if (total > budget) {
    console.error(`OVER BUDGET by ${total - budget} words. Moving text between instruction files spends nothing; deleting it is what spends less.`);
    process.exit(1);
  }
}
