// ABOUTME: Counts Rigger's production lines and refuses a package that has grown past the budget
// ABOUTME: ARCHITECTURE.md records. One check, against the package total.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// What a production line is, and what it is not, is ARCHITECTURE.md's Budgets section. This
// file implements that section and decides nothing of its own: production code is what runs
// while a card is being worked, so tests, `templates/`, the checks Rigger ships for a
// consumer's own CI, blank lines and comment lines are all outside the count. Everything
// outside `src/` is one of those, which is why the walk starts there.
const SOURCES = 'src';
const SOURCE_SUFFIX = /\.(?:m|c)?js$/;
const TEST_SUFFIX = /(?:\.|-|_)test\.(?:m|c)?js$/;
// A template is outside the budget wherever it sits, rather than only at the root, so a
// directory of them under `src/` does not quietly start counting.
const SHIPPED = 'templates';

/**
 * The package's line budget, read from ARCHITECTURE.md's Budgets table rather than typed here,
 * so a ratified change to the number moves this check with it.
 */
export function packageBudget(architecture) {
  const row = architecture.match(/^\|\s*\*\*Package\*\*\s*\|\s*\*\*([\d,]+)\*\*\s*\|/m);
  if (!row) throw new Error('ARCHITECTURE.md states no package budget row to check against');
  return Number(row[1].replace(/,/g, ''));
}

/** Where a quoted run ends on this line, just past its closing quote, or -1 if it runs on. */
function endOfQuoted(line, start, quote) {
  for (let i = start; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === quote) return i + 1;
  }
  return -1;
}

/**
 * The production lines in one source file's text.
 *
 * A line counts when it carries code. It does not when it is blank, when it is a line comment,
 * or when it falls inside a block comment. A line carrying both code and a comment counts once,
 * because the code on it can carry a bug.
 *
 * The scan reads quoted runs, so a comment opener inside a string or a template literal opens
 * no comment. Two shapes still fool it, both needing a parser to tell apart: a block-comment
 * opener inside a regular expression literal, as in the character class for `/` and `*`, and
 * one inside a template literal that spans lines. What either costs is bounded and never
 * silent. The lines between a false opener and the next closer are undercounted, and an opener
 * the scan never closes throws rather than swallowing the rest of the file, because source
 * that parses cannot leave a block comment open.
 */
export function countProductionLines(source) {
  let count = 0;
  let inBlock = false;
  for (const line of source.split('\n')) {
    // Only a block comment carries across lines. A quoted run does not, because the scan
    // cannot tell a backtick opening a template from one inside a regular expression, and
    // `scripts/absorption-check.mjs` holds a regex with an odd number of them. Ending every
    // quoted run at the line end costs nothing a line count can see: what a line holds after
    // a mis-read quote does not change that the line holds code.
    let inTemplate = false;
    let code = false;
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const close = line.indexOf('*/', i);
        if (close < 0) break;
        inBlock = false;
        i = close + 2;
      } else if (inTemplate) {
        code = true;
        const close = endOfQuoted(line, i, '`');
        if (close < 0) break;
        inTemplate = false;
        i = close;
      } else if (line[i] === ' ' || line[i] === '\t' || line[i] === '\r') {
        i++;
      } else if (line[i] === '/' && line[i + 1] === '/') {
        break;
      } else if (line[i] === '/' && line[i + 1] === '*') {
        inBlock = true;
        i += 2;
      } else if (line[i] === '`') {
        code = true;
        inTemplate = true;
        i++;
      } else if (line[i] === '"' || line[i] === "'") {
        code = true;
        const close = endOfQuoted(line, i + 1, line[i]);
        if (close < 0) break;
        i = close;
      } else {
        code = true;
        i++;
      }
    }
    if (code) count++;
  }
  if (inBlock) throw new Error('a block comment opens and never closes, so the scan lost the rest of the file');
  return count;
}

/** Every production source file under a repository root, in a stable order. */
export function productionFiles(root) {
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === SHIPPED ? [] : walk(path);
        if (!SOURCE_SUFFIX.test(entry.name)) return [];
        if (TEST_SUFFIX.test(entry.name)) return [];
        return [path];
      });
  };
  return walk(join(root, SOURCES));
}

/** What the package spends, file by file, and what it is allowed. */
export function check(root) {
  const budget = packageBudget(readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8'));
  const files = productionFiles(root).map((path) => {
    try {
      return { path, lines: countProductionLines(readFileSync(path, 'utf8')) };
    } catch (cause) {
      throw new Error(`${path}: ${cause.message}`, { cause });
    }
  });
  const total = files.reduce((sum, file) => sum + file.lines, 0);
  return { budget, files, total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is measured. A path measures that repository
  // instead, which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { budget, files, total } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const file of files) console.log(`${String(file.lines).padStart(6)}  ${file.path}`);
  console.log(`${String(total).padStart(6)}  production lines, against a budget of ${budget}`);
  if (total > budget) {
    console.error(`OVER BUDGET by ${total - budget} lines. Delete as much as you add, or carry a ratified budget change.`);
    process.exit(1);
  }
}
