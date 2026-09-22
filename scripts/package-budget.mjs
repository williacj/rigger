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
// A test is whatever `npm test` runs, and `npm test` is `node --test`, so these are that
// command's own default patterns: `test.js`, `test-*.js`, and the `.test.`, `-test.` and
// `_test.` infixes, in any of the three extensions. Naming a narrower set here would charge a
// file the runner executes to a budget that ARCHITECTURE.md puts tests outside of.
//
// The split is by case, and it is the runner's, not a convention of ours. From Node 21 the runner
// matches its default pattern with `fs.glob`, and that glob sets `nocaseMagicOnly`: a pattern
// component holding glob magic is matched without regard to case, and a wholly literal one is
// compared exactly. Which alternatives are literal changed once, at Node 22.10, and only in how
// the extension is spelled:
//
//   21.0.0 to 22.9.x    `**/{test,test/**/*,test-*,*[._-]test}.?(c|m)js`
//   22.10.0 onwards     `**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs}`, the list growing
//                       to `{js,mjs,cjs,ts,mts,cts}` by 22.23.2
//
// The extglob `?(c|m)js` is magic, so before 22.10 no alternative is wholly literal and the
// runner folds `TEST.mjs` along with the rest. The brace list expands to plain `test.mjs`, so
// from 22.10 that one alternative alone answers to its exact case, while every other keeps a `*`
// or a character class. Hence two regexes and two answers rather than one.
const TEST_LITERAL = /^test\.(?:m|c)?js$/;
const TEST_LITERAL_FOLDED = new RegExp(TEST_LITERAL.source, 'i');
const TEST_PATTERNED = /(?:[.\-_]test|^test-.*)\.(?:m|c)?js$/;
const TEST_PATTERNED_FOLDED = new RegExp(TEST_PATTERNED.source, 'i');
// Whether the runner folds is the runner's answer, and it turns on two things. Which Node is
// running, because the runner only began matching by glob in 21. And which platform, because that
// glob sets `nocase` for Windows and macOS and for nowhere else — on the platform, not on the
// filesystem, so a case-sensitive volume on either still folds.
//
// Measured, not reasoned, each name in a directory of its own so that a case-insensitive
// filesystem folded none of them onto another. Of `a.TEST.mjs`, `TEST-b.mjs` and `c_Test.mjs`,
// `node --test` ran:
//
//   Windows 11 10.0.26200, NTFS:  none under 20.20.2; all three under 21.7.3, 22.9.0, 22.10.0,
//                                 22.23.2, 23.11.1 and 24.18.0
//   macos-latest, `darwin`:       none under 20.20.2; all three under 24.20.0. The CI log names
//                                 the platform and the Node version, so neither the filesystem
//                                 nor any other Node version is measured there.
//
// `TEST.mjs` ran under 21.7.3 and 22.9.0 and was declined under 20.20.2, 22.10.0, 22.23.2,
// 23.11.1 and 24.18.0, which is the extension respelling above.
//
// Where this answer differs from the runner's, and where it is reasoned rather than measured.
//
// Node 21 folds and this does not, so a case-varied spelling is charged there: an overcount, and
// never an undercount. Closing it is not this check's job, because 21's matcher differs from
// 22's in ways that have nothing to do with case — it spells the class as the range `[.-_]`,
// 0x2E to 0x5F, so under `nocase` it also runs `latest.mjs` and does not run `b-TEST.mjs`.
// Agreeing with 21 is its own card, and the suite reds there on `645eeec` too.
//
// Linux is reasoned from node's own `nocase: isWindows || isMacOS` and not measured, because D13
// makes macOS v0's only host and CI runs nowhere else. If that reasoning is wrong it charges a
// test rather than passing over production code, which is the safe way to be wrong: this check
// overcounting cannot admit a package that is over budget, where undercounting could. Nor would
// it pass quietly — the relation test in `test/package-budget.test.mjs` asks the real runner, in
// both directions, on whatever host the suite runs, and reds there.
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
const RUNNER_FOLDS_CASE =
  NODE_MAJOR >= 22 && (process.platform === 'win32' || process.platform === 'darwin');
// Before 22.10 the extension is still an extglob, so the bare `test` alternative folds as well.
const RUNNER_FOLDS_BARE_TEST = RUNNER_FOLDS_CASE && NODE_MAJOR === 22 && NODE_MINOR < 10;

/**
 * Whether `node --test` runs a file of this name. `foldsCase` says whether it folds the
 * alternatives carrying glob magic, and `foldsBareTest` whether the bare `test` one folds too.
 */
function runsAsTest(name, foldsCase, foldsBareTest) {
  return (
    (foldsBareTest ? TEST_LITERAL_FOLDED : TEST_LITERAL).test(name) ||
    (foldsCase ? TEST_PATTERNED_FOLDED : TEST_PATTERNED).test(name)
  );
}
// Directories the budget never charges for, wherever they sit rather than only at the root: a
// directory of templates under `src/` is still templates, and `node --test` runs every file
// under a `test` directory whatever it is called.
const UNCHARGED = new Set(['templates', 'test']);

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
export function productionFiles(root, foldsCase = RUNNER_FOLDS_CASE, foldsBareTest = RUNNER_FOLDS_BARE_TEST) {
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
        if (entry.isDirectory()) return UNCHARGED.has(entry.name) ? [] : walk(path);
        if (!SOURCE_SUFFIX.test(entry.name)) return [];
        if (runsAsTest(entry.name, foldsCase, foldsBareTest)) return [];
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
