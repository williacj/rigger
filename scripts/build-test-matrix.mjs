// ABOUTME: Builds docs/derived/test-matrix.md from the declarations in Rigger's own tests, and
// ABOUTME: refuses a matrix that has gone stale or been edited by hand.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { endOfQuoted, TEST_FILE } from './package-budget.mjs';

/** The cells of one markdown table row, trimmed. */
function cells(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** Every requirement row in a register, in document order. */
export function register(text) {
  const rows = [];
  let headings = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      headings = null;
      continue;
    }
    const row = cells(trimmed);
    if (!headings) {
      headings = row;
      continue;
    }
    if (row.every((cell) => /^-+$/.test(cell))) continue;
    const cell = (heading) => row[headings.indexOf(heading)] ?? '';
    rows.push({ id: cell('id'), checkedBy: cell('checked by') });
  }
  return rows;
}

// A declaration is a whole line. That keeps a declaration quoted inside a single-line string
// from claiming anything, which this generator's own tests need: they hand it fixture sources,
// and a scan matching anywhere on a line would read every fixture as a claim by the file
// quoting it. It settles nothing on its own about a fixture that spans lines, because the lines
// of a template literal are lines like any other; the scan below is what answers that.
const DECLARATION = /^\/\/ proves (\S.*)$/;
// What the declaration sits above: a line that begins with a call to the runner and a quoted
// title. Beginning the line is what keeps a line merely carrying the text of a call — a fixture,
// or a call commented out — from being named as a test. The ids are not matched against a shape
// here: `docs/spec/requirements.md` says which ids exist, and a declaration naming anything else
// is refused by name rather than passed over in silence.
const TEST_CALL = /^(?:await\s+)?(?:test|it)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;
// An escape, or a backtick that is not escaped. Counting those is how the scan reads whether a
// template literal is open where a declaration sits.
const BACKTICK = /\\.|`/g;

/** How many backticks a line carries that an escape does not swallow. */
function backticks(line) {
  return (line.match(BACKTICK) ?? []).filter((token) => token === '`').length;
}

/**
 * Whether a block comment is open at the end of a line, given whether one was open before it.
 *
 * The scan reads quoted runs, so a marker inside one opens and closes nothing: a fixture written
 * as a single-line string holds the text of a comment opener, not an opener.
 * `scripts/package-budget.mjs` reads a quoted run the same way for the same reason, and this
 * asks it where one ends rather than keeping a second answer.
 */
function commenting(line, open) {
  let at = 0;
  while (at < line.length) {
    if (open) {
      const close = line.indexOf('*/', at);
      if (close < 0) return true;
      open = false;
      at = close + 2;
    } else if (line[at] === '"' || line[at] === "'" || line[at] === '`') {
      const close = endOfQuoted(line, at + 1, line[at]);
      // A run the line never closes carries on past its end, where a marker is text as well.
      if (close < 0) return open;
      at = close;
    } else if (line[at] === '/' && line[at + 1] === '/') {
      // Two slashes, and the rest of the line is a comment that opens no block.
      return open;
    } else if (line[at] === '/' && line[at + 1] === '*') {
      open = true;
      at += 2;
    } else {
      at += 1;
    }
  }
  return open;
}

/**
 * Every declaration in one test file's source, in the order they appear.
 *
 * The scan reads lines, not syntax, so it never guesses at one it cannot read. A claim names
 * only a line that begins with a call to the runner; a declaration standing above anything else,
 * a call commented out among them, is refused. So is one under an odd backtick, where a template
 * literal is open and the line may be the text of a fixture rather than a claim. A declaration
 * inside a block comment is read as commented out, along with the test beneath it.
 *
 * What the scan cannot see is syntax. It reads quoted runs, so a comment marker inside a string
 * is text and opens nothing; what it still cannot tell apart is a backtick inside a string from
 * one opening a template literal, or a comment marker inside a regular expression from one
 * opening a comment. A backtick costs a declaration after it refused by name. A marker costs
 * the file refused where the comment it opens never closes, and a declaration between it and
 * whatever does close it going unread where something does. Reading either apart for certain
 * needs a parser, and this is a scan.
 */
export function declarationsIn(source, file) {
  const lines = source.split(/\r?\n/);
  const found = [];
  let quoting = false;
  let commented = false;
  for (const [index, line] of lines.entries()) {
    const declaration = commented ? null : line.trim().match(DECLARATION);
    if (declaration) {
      const at = `${file} line ${index + 1}: \`${line.trim()}\``;
      if (quoting) {
        throw new Error(
          `${at} follows a backtick the scan never saw closed, so it cannot tell a declaration ` +
          `of ${declaration[1]} from the text of a fixture. A fixture that spans lines goes in ` +
          'a single-line string with \\n escapes.',
        );
      }
      const next = (lines[index + 1] ?? '').trim();
      const call = next.startsWith('//') ? null : next.match(TEST_CALL);
      if (!call) {
        throw new Error(
          `${at} stands above no test, so nothing proves ${declaration[1]}. A declaration goes ` +
          'on the line directly above the test it speaks for.',
        );
      }
      found.push({
        ids: declaration[1].split(',').map((id) => id.trim()),
        title: call[2].replace(/\\(.)/g, '$1'),
      });
    }
    if (!commented && backticks(line) % 2 === 1) quoting = !quoting;
    commented = commenting(line, commented);
  }
  if (commented) {
    // Source that parses cannot leave a block comment open, so the scan has misread a marker
    // somewhere — inside a regular expression, or inside a fixture that spans lines. Everything
    // after it went unread, and a claim nobody hears about is worse than a refusal.
    throw new Error(
      `${file}: a block comment opens and never closes, so the scan lost the rest of the file ` +
      'and any declaration in it. Source that parses does not end inside a comment, so a marker ' +
      'in it has been read as one; putting that text in a single-line string clears it.',
    );
  }
  return found;
}

const PREAMBLE = [
  'ABOUTME: Which tests prove which requirement, built from the declarations the tests carry.',
  'ABOUTME: Generated by `scripts/build-test-matrix.mjs`; never hand-edited (D8).',
  '',
  '# Test matrix',
  '',
  'One row per requirement in `docs/spec/requirements.md`, naming the tests that prove it. A test',
  'declares what it proves in a `// proves R-GROUP-#` comment on the line above it, and this file',
  'is built from those declarations, so what it says cannot drift from what the suite asserts.',
  'Regenerate it with `npm run matrix`; editing it by hand fails the build (D8).',
  '',
  '**gap** marks a requirement no test claims. `nothing yet` and `nothing could` mark one whose',
  '`checked by` in the register already records that nothing catches a violation, so the matrix',
  'reports no gap of its own; the register carries the reason.',
  '',
];

/**
 * What a requirement's row says when no test claims it. `docs/spec/requirements.md` already
 * records, in `checked by`, the requirements nothing observes; where it does, the matrix repeats
 * that rather than reporting a gap the register has already accounted for. A `nothing could`
 * carrying no reason is read as `nothing yet`, which is the reading the register's preamble
 * gives it.
 */
function unchecked(checkedBy) {
  if (checkedBy.startsWith('nothing could')) {
    return checkedBy.slice('nothing could'.length).trim() === '' ? 'nothing yet' : 'nothing could';
  }
  return checkedBy.startsWith('nothing yet') ? 'nothing yet' : '**gap**';
}

/** The matrix document for a set of requirements and the claims the tests make on them. */
export function render(requirements, claims) {
  const rows = requirements.map((requirement) => {
    const proofs = claims
      .filter((claim) => claim.ids.includes(requirement.id))
      .map((claim) => `\`${claim.file}\` ${claim.title}`);
    const cell = proofs.length > 0 ? proofs.join('<br>') : unchecked(requirement.checkedBy);
    return `| ${requirement.id} | ${cell} |`;
  });
  return [...PREAMBLE, '| requirement | proved by |', '|---|---|', ...rows, ''].join('\n');
}

const REQUIREMENTS = 'docs/spec/requirements.md';
const RETIRED = 'docs/spec/requirements-retired.md';
const TESTS = 'test';
// Directories no run reads: the one npm installs into, which `node --test` does not descend
// into either, and git's own.
const UNREAD = new Set(['node_modules', '.git']);
// Inside a directory named `test` the runner runs any JavaScript file, whatever it is called,
// so the spelling is all there is left to ask about there.
const JAVASCRIPT = /\.(?:m|c)?js$/;
// D8 rule 4: this directory exists only while it holds a generated document, so the write below
// creates it. Everything in it is written here, which is what makes a file the tool does not
// recognise a hand edit rather than a mystery.
const DERIVED = 'docs/derived';
const MATRIX = `${DERIVED}/test-matrix.md`;

/** Every file under a directory, as paths relative to it, in a stable order. */
function filesUnder(root, directory, prefix = '') {
  let entries;
  try {
    entries = readdirSync(join(root, directory), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => (entry.isDirectory()
      ? filesUnder(root, `${directory}/${entry.name}`, `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]));
}

/**
 * Every file in a repository that `node --test` would run, as repository-relative paths in a
 * stable order.
 *
 * `npm test` is `node --test`, which runs a name it recognises wherever that file sits and every
 * JavaScript file under a directory named `test`. Both are read, because a declaration in a file
 * the runner runs is a claim a test made whatever directory holds it — and a declaration the
 * scan never reaches is a claim nothing checks. `scripts/package-budget.mjs` owns the names,
 * having the same question to answer about its budget.
 */
export function testFiles(root, directory = '', tests = false) {
  let entries;
  try {
    entries = readdirSync(join(root, directory), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return UNREAD.has(entry.name) ? [] : testFiles(root, path, tests || entry.name === TESTS);
      }
      return JAVASCRIPT.test(entry.name) && (tests || TEST_FILE.test(entry.name)) ? [path] : [];
    });
}

/** Every claim the tests in a repository make, in file order and then in line order. */
export function declarations(root) {
  return testFiles(root).flatMap((file) => declarationsIn(readFileSync(join(root, file), 'utf8'), file)
    .map((declaration) => ({ file, ...declaration })));
}

/** What a run finds in one repository. */
export function check(root) {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const requirements = register(read(REQUIREMENTS));
  const live = new Set(requirements.map((row) => row.id));
  const withdrawn = new Set(register(read(RETIRED)).map((row) => row.id));
  const claims = declarations(root);

  for (const claim of claims) {
    for (const id of claim.ids) {
      if (live.has(id)) continue;
      // A withdrawn id is still allocated, so it resolves; what it no longer does is bind.
      // Either way the claim cannot be true, and the message says which of the two it is.
      throw new Error(withdrawn.has(id)
        ? `${claim.file}: \`${claim.title}\` declares ${id}, which ${RETIRED} records as ` +
          'withdrawn. A withdrawn requirement binds nothing, so no test proves it.'
        : `${claim.file}: \`${claim.title}\` declares ${id}, which is in neither ` +
          `${REQUIREMENTS} nor ${RETIRED}. No test can prove a requirement that does not exist.`);
    }
  }

  const document = render(requirements, claims);
  const claimed = new Set(claims.flatMap((claim) => claim.ids));
  // A matrix that is not there at all is as stale as one that has fallen behind: either way,
  // what is committed is not what the tests say.
  let written = null;
  try {
    written = readFileSync(join(root, MATRIX), 'utf8');
  } catch { /* not written yet */ }

  return {
    document,
    total: requirements.length,
    untested: requirements.filter((row) => !claimed.has(row.id)).length,
    stale: written !== document,
    strays: filesUnder(root, DERIVED).filter((name) => `${DERIVED}/${name}` !== MATRIX),
  };
}

/** Write the matrix, creating the directory D8 rule 4 says the first generated document creates. */
export function write(root, document) {
  mkdirSync(join(root, DERIVED), { recursive: true });
  writeFileSync(join(root, MATRIX), document);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no path and this repository is measured. A path reads that repository instead,
  // which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const root = resolve(args.find((argument) => !argument.startsWith('--')) ?? here);
  const report = check(root);

  if (args.includes('--write')) write(root, report.document);
  console.log(`${report.untested} of ${report.total} requirements have no test.`);

  // A stray is refused whichever way the tool was run: it is a file no generator wrote, and
  // this one removes nothing it did not write.
  for (const stray of report.strays) {
    console.error(`${DERIVED}/${stray} is under ${DERIVED}/ and no tool writes it. Everything there is generated (D8).`);
  }
  if (report.stale && !args.includes('--write')) {
    console.error(`${MATRIX} is not what the tests and the register say. Run \`npm run matrix\` and commit the result.`);
  }
  if (report.strays.length > 0 || (report.stale && !args.includes('--write'))) process.exit(1);
}
