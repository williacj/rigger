// ABOUTME: Builds docs/derived/test-matrix.md from the declarations in Rigger's own tests, reading
// ABOUTME: each test file as the syntax it is, and refuses a matrix gone stale or edited by hand.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_FILE } from './package-budget.mjs';

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

/**
 * Whether a character ends a line for JavaScript. All four count, not just the two a text editor
 * shows: a line comment ends at any of them, so a scan that knows only `\n` reads whatever follows
 * a `\u2028` as part of the comment above it.
 */
const terminates = (character) =>
  character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';

/** Whitespace between tokens, which carries nothing and ends nothing. */
const SPACING = new Set([' ', '\t', '\v', '\f', ' ', '﻿']);
// Characters that stand alone as punctuation rather than running together into a word. `/` is
// absent because whether it opens a comment, a regular expression or a division is the one
// question this reader has to think about, and the quotes are absent for the same reason.
const PUNCTUATION = new Set([...'{}()[];,<>+-*%&|^!~?:=.#@\\']);
// After one of these a `/` opens a regular expression, because each of them wants an expression
// next. After any other word — a name, a number, `this`, `true` — the same `/` is a division.
const BEFORE_AN_EXPRESSION = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw',
  'typeof', 'void', 'yield',
]);
// A `(` that one of these opened is a control-flow head, so the `)` closing it is followed by a
// statement: `if (a) /re/.test(b)` is a regular expression where `(a + b) / 2` is a division.
const CONTROL = new Set(['if', 'while', 'for', 'with']);

/** Where each line of a source starts, so any index can be turned into a line number. */
function lineStarts(source) {
  const starts = [0];
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\r' && source[at + 1] === '\n') starts.push(++at + 1);
    else if (terminates(source[at])) starts.push(at + 1);
  }
  return starts;
}

/** The 1-based line a source index sits on. */
function lineOf(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= index) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * The comments and tokens one JavaScript source holds.
 *
 * What it answers, and what it refuses, is the point of reading source as syntax rather than as
 * lines. A comment is a comment, a quoted run is a quoted run, and a marker inside either is
 * neither — so a caller can ask where a comment is without a shape of code being able to fool it.
 * Where the language itself leaves a character ambiguous, or where the source does not tokenize,
 * this throws naming the line rather than choosing: a refusal costs a run, and a guess costs a
 * claim nobody checks.
 *
 * Each comment carries `kind`, its source `text`, the `line` it opens on, whether it `startsLine`
 * — only spacing before it — and `tokensBefore`, the count of tokens read before it, so the token
 * that follows a comment is `tokens[comment.tokensBefore]`.
 *
 * Each token carries `kind` — `word` for a run of name or number characters, `punct`, `string`,
 * `template` for one holding a `${}` substitution, or `regex` — the `line` it opens on, and the
 * `depth` of brackets open around it, and the `endLine` it reaches. A `string` also carries the
 * `value` between its quotes, with the escapes left as the source wrote them.
 *
 * The one thing it cannot tell apart is a `/` directly after a `}`, which is a division after an
 * object literal and a regular expression after a block. Both need the grammar above the token,
 * and this reads tokens, so it refuses instead.
 */
export function tokensIn(source, file) {
  const starts = lineStarts(source);
  const at = (index) => `${file} line ${lineOf(starts, index)}`;
  const tokens = [];
  const comments = [];
  // What is open around the current token: a bracket, or a `${}` substitution inside a template.
  const open = [];
  let index = 0;

  const word = (from) => {
    let end = from;
    while (end < source.length && !terminates(source[end]) && !SPACING.has(source[end])
      && !PUNCTUATION.has(source[end]) && source[end] !== '/' && source[end] !== '"'
      && source[end] !== "'" && source[end] !== '`') end++;
    return end;
  };

  /** Where a quoted run ends, one past its closing quote. A line inside one is source that would not parse. */
  const quoted = (from, quote) => {
    for (let end = from; end < source.length; end++) {
      if (source[end] === '\\') {
        // An escaped line terminator is a continuation, and `\r\n` is one terminator in two characters.
        end += source[end + 1] === '\r' && source[end + 2] === '\n' ? 2 : 1;
      } else if (source[end] === quote) return end + 1;
      else if (terminates(source[end])) break;
    }
    throw new Error(`${at(from - 1)}: a ${quote === '"' ? 'double' : 'single'}-quoted run opens and never closes, so this is not source that parses.`);
  };

  /** Where the raw text of a template ends: at its closing backtick, or at the `${` that interrupts it. */
  const template = (from) => {
    for (let end = from; end < source.length; end++) {
      if (source[end] === '\\') end++;
      else if (source[end] === '`') return { end: end + 1, closed: true };
      else if (source[end] === '$' && source[end + 1] === '{') return { end: end + 2, closed: false };
    }
    throw new Error(`${at(from - 1)}: a template literal opens and never closes, so this is not source that parses.`);
  };

  /** Where a regular expression literal ends, flags and all. A `/` inside a character class does not close it. */
  const expression = (from) => {
    let inClass = false;
    for (let end = from; end < source.length; end++) {
      if (source[end] === '\\') end++;
      else if (terminates(source[end])) break;
      else if (source[end] === '[') inClass = true;
      else if (source[end] === ']') inClass = false;
      else if (source[end] === '/' && !inClass) return word(end + 1);
    }
    throw new Error(`${at(from - 1)}: a regular expression opens and never closes, so this is not source that parses.`);
  };

  /** Whether a `/` here opens a regular expression rather than dividing what came before it. */
  const opensExpression = (slash) => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.kind === 'word') return BEFORE_AN_EXPRESSION.has(previous.value);
    if (previous.kind !== 'punct') return false;
    if (previous.value === ')') return previous.control;
    if (previous.value === ']' || previous.value === '++' || previous.value === '--') return false;
    if (previous.value === '}') {
      throw new Error(
        `${at(slash)}: a \`/\` directly after a \`}\` is a regular expression after a block and a ` +
        'division after an object literal, and telling those apart needs the grammar above the ' +
        'token rather than the token. Put the expression in parentheses, or the division on its own line.',
      );
    }
    return true;
  };

  const push = (kind, end, rest = {}) => {
    tokens.push({ kind, line: lineOf(starts, index), endLine: lineOf(starts, end - 1), depth: open.length, ...rest });
    index = end;
  };

  if (source.startsWith('#!')) {
    let end = 0;
    while (end < source.length && !terminates(source[end])) end++;
    comments.push({ kind: 'hashbang', text: source.slice(0, end), line: 1, startsLine: true, tokensBefore: 0 });
    index = end;
  }

  while (index < source.length) {
    const character = source[index];
    if (terminates(character) || SPACING.has(character)) {
      index++;
    } else if (character === '/' && source[index + 1] === '/') {
      let end = index;
      while (end < source.length && !terminates(source[end])) end++;
      comments.push({
        kind: 'line',
        text: source.slice(index, end),
        line: lineOf(starts, index),
        startsLine: source.slice(starts[lineOf(starts, index) - 1], index).trim() === '',
        tokensBefore: tokens.length,
      });
      index = end;
    } else if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) {
        throw new Error(
          `${at(index)}: a block comment opens and never closes, so the rest of the file is inside ` +
          'it and no declaration in it can be read. Source that parses does not end inside a comment.',
        );
      }
      comments.push({
        kind: 'block',
        text: source.slice(index, close + 2),
        line: lineOf(starts, index),
        startsLine: source.slice(starts[lineOf(starts, index) - 1], index).trim() === '',
        tokensBefore: tokens.length,
      });
      index = close + 2;
    } else if (character === '"' || character === "'") {
      const end = quoted(index + 1, character);
      push('string', end, { value: source.slice(index + 1, end - 1) });
    } else if (character === '`') {
      const run = template(index + 1);
      if (run.closed) push('string', run.end, { value: source.slice(index + 1, run.end - 1) });
      else {
        push('template', run.end);
        open.push({ bracket: '${' });
      }
    } else if (character === '/') {
      if (opensExpression(index)) push('regex', expression(index + 1));
      else push('punct', index + 1, { value: '/' });
    } else if (character === '}' && open[open.length - 1]?.bracket === '${') {
      open.pop();
      // The `}` closes a substitution, so what follows is the template again rather than code. A
      // template carrying one is no plain title, so it holds no value for a caller to read.
      const run = template(index + 1);
      push('template', run.end);
      if (!run.closed) open.push({ bracket: '${' });
    } else if (PUNCTUATION.has(character)) {
      const doubled = (character === '+' || character === '-') && source[index + 1] === character;
      if (character === '(' || character === '[' || character === '{') {
        const previous = tokens[tokens.length - 1];
        push('punct', index + 1, { value: character });
        open.push({ bracket: character, control: previous?.kind === 'word' && CONTROL.has(previous.value) });
      } else if (character === ')' || character === ']' || character === '}') {
        const closed = open.pop();
        push('punct', index + 1, { value: character, control: closed?.control === true });
      } else {
        push('punct', index + (doubled ? 2 : 1), { value: doubled ? character + character : character });
      }
    } else {
      const end = word(index);
      push('word', end, { value: source.slice(index, end) });
    }
  }

  return { tokens, comments };
}

// A declaration is a line comment of its own, with nothing but spacing before it. It is read out
// of the source's syntax rather than matched against the text of a line, so a declaration written
// inside a string or a template literal is the text of a fixture and claims nothing, and one
// inside a comment is commented out along with the test beneath it. The ids are not matched
// against a shape here: `docs/spec/requirements.md` says which ids exist, and a declaration naming
// anything else is refused by name rather than passed over in silence.
const DECLARATION = /^\/\/ proves (\S.*)$/;
// The module a call has to reach to be a test. `npm test` is `node --test`, which installs no
// global of its own, so a call named `test` runs a test only where the file imported it from here
// (`D16` rule 1). A file that binds the name itself, or never binds it at all, registers nothing
// whatever it calls — and which name is bound to what is a question about the source.
const RUNNER_MODULE = 'node:test';
// What binds a name at the top level of a module, beside an import.
const BINDERS = new Set(['const', 'let', 'var', 'function', 'class']);
// The escapes a quoted title can carry, and the character each one stands for. `\0` is here and
// the other digits are not: a legacy octal escape is a syntax error in a module, so no file the
// runner loads holds one, and one met here is refused rather than decoded.
const ESCAPED = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' };

/**
 * Which names a source binds to the runner at its top level, and which names it has taken for
 * something else.
 *
 * Only the top level matters: a call the runner reaches is one nothing encloses, which the reader
 * already requires. A name in both sets is refused, because the later binding is the one in force
 * at a line this cannot order without the grammar.
 */
function bindings(tokens) {
  const runner = new Set();
  const taken = new Set();
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at];
    if (token.depth > 0 || token.kind !== 'word') continue;
    if (token.value === 'import') {
      // A dynamic `import(...)` and an `import.meta` bind nothing, and neither carries a `from`.
      const next = tokens[at + 1];
      if (next?.kind === 'punct' && (next.value === '(' || next.value === '.')) continue;
      // The module is the specifier, which is the token after `from` — never the first string in
      // the statement. An import name may itself be a string (`{ 'a' as b }`), so a reader taking
      // the first string it meets reads that name as the module, and a module whose string export
      // name is spelled `node:test` then passes for the runner.
      let from = at + 1;
      while (from < tokens.length && !(tokens[from].kind === 'word' && tokens[from].value === 'from')
        && !(tokens[from].kind === 'punct' && tokens[from].value === ';')) from++;
      const specifier = tokens[from]?.kind === 'word' ? tokens[from + 1] : null;
      // A side-effect `import 'm'` binds nothing, and a specifier that is not a string is not
      // source that parses; either way there is nothing here to bind.
      if (specifier?.kind !== 'string') {
        at = from;
        continue;
      }
      // The name each comma-separated group binds is its last word: `a` in `{ a }`, `b` in
      // `{ a as b }`, `b` again in `{ 'a' as b }`, `n` in `* as n`, and the whole of a default `x`.
      const groups = [[]];
      for (const piece of tokens.slice(at + 1, from)) {
        if (piece.kind === 'punct' && piece.value === ',') groups.push([]);
        else if (piece.kind === 'word') groups[groups.length - 1].push(piece.value);
      }
      for (const group of groups) {
        const bound = group[group.length - 1];
        if (bound) (specifier.value === RUNNER_MODULE ? runner : taken).add(bound);
      }
      at = from + 1;
    } else if (BINDERS.has(token.value)) {
      // A `function` or a `class` names one thing. A `const`, `let` or `var` may destructure, so
      // every name in the pattern counts, and the walk stops at the initialiser so that the keys
      // of an object on the right-hand side are not read as bindings.
      if (token.value === 'function' || token.value === 'class') {
        if (tokens[at + 1]?.kind === 'word') taken.add(tokens[at + 1].value);
        continue;
      }
      for (let end = at + 1; end < tokens.length; end++) {
        const piece = tokens[end];
        if (piece.depth > token.depth + 1) continue;
        if (piece.kind === 'punct' && (piece.value === '=' || piece.value === ';')) break;
        if (piece.kind === 'word') taken.add(piece.value);
      }
    }
  }
  return { runner, taken };
}

/**
 * The string a quoted run's raw text stands for, or `null` where it carries an escape this does
 * not decode.
 *
 * The runner registers the string the language decodes, so a title is decoded the same way or not
 * recorded at all. Dropping the backslash and keeping the letter — which is what a single
 * substitution does — turns `\t` into a `t` and records a title no runner ever registered.
 */
function decoded(raw) {
  let out = '';
  for (let at = 0; at < raw.length; at++) {
    if (raw[at] !== '\\') {
      out += raw[at];
      continue;
    }
    const escape = raw[++at];
    if (escape === undefined) return null;
    // A line continuation stands for nothing at all, and `\r\n` is one line ending in two
    // characters.
    if (escape === '\r') {
      if (raw[at + 1] === '\n') at++;
      continue;
    }
    if (escape === '\n' || escape === '\u2028' || escape === '\u2029') continue;
    if (escape === 'x' || escape === 'u') {
      const brace = escape === 'u' && raw[at + 1] === '{';
      const close = brace ? raw.indexOf('}', at + 2) : at + (escape === 'x' ? 3 : 5);
      if (brace && close < 0) return null;
      const digits = raw.slice(at + (brace ? 2 : 1), close);
      const wide = brace ? /^[0-9a-fA-F]{1,6}$/ : /^[0-9a-fA-F]+$/;
      if (!wide.test(digits) || (!brace && digits.length !== (escape === 'x' ? 2 : 4))) return null;
      const code = parseInt(digits, 16);
      if (code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
      at = brace ? close : close - 1;
      continue;
    }
    if (escape >= '1' && escape <= '9') return null;
    if (escape === '0' && raw[at + 1] >= '0' && raw[at + 1] <= '9') return null;
    out += ESCAPED[escape] ?? escape;
  }
  return out;
}

/**
 * Every declaration in one test file's source, in the order they appear.
 *
 * What this reports is a claim that a test exists, so the bar is that `node --test` would execute
 * the test named. `tokensIn` above reads the source into the comments and tokens it holds, and
 * every part of the bar is then a question about those rather than about the shape of a line. A
 * declaration is a line comment of its own, which no marker inside a string or a regular
 * expression can forge and no commented-out line can be. The test it speaks for is the run of
 * tokens directly after it, which the text of a call inside a fixture cannot be, because a fixture
 * is one string token however many lines it spans. And the call sits at the top level of the file,
 * because a call the runner reaches is one that nothing encloses.
 *
 * What it tells apart and what it does not. `test/build-test-matrix.test.mjs` exercises the
 * parser; `docs/journal/2026-09-23-1638-119-matrix-refusals.md` records runner measurements
 * for the additional call shapes. Every row but the last costs a refusal naming the file and
 * the line, never a claim:
 *
 *   a marker or a quote inside a string, a template or a regex   the character it is; no claim
 *   a declaration or a call inside a comment of either kind      commented out; no claim
 *   a `// proves` line commented out among other line comments   refused: it stands above a comment
 *   a `/` directly after a `}`                                   refused: the grammar decides it
 *   a declaration above a call the file nests, `describe` too    refused: reaching it is not tokens
 *   a call to a name the file binds itself, or never binds       refused: that reaches no runner
 *   a title built from anything but one quoted run               refused: no plain quoted title
 *   a title carrying an escape with no decoding here             refused: the string is not known
 *   a title carrying a line ending (also U+2028/U+2029)          refused: no row spans lines
 *   a title carrying a `|`                                      refused: it divides row cells
 *   an import through a re-export chain                          refused: the binding is indirect
 *   `test(...args)`                                               refused: the title is in a spread
 *   `(test)('x', ...)`                                             refused: the callee is an expression
 *   a dynamic `import('node:test')` binding                       refused: binding is not static
 *   `require('node:test')` in a `.cjs` file                       refused: require can be rebound
 *   a namespace member call                                      refused: the member needs binding
 *   `?.()` on a runner binding                                   refused: the call can be skipped
 *   a `String.raw` title                                         refused: the tag decides its value
 *   a quoted run or a comment the source leaves open             refused: it does not tokenize
 *   a top-level call the module never finishes reaching          claimed all the same
 *
 * The last row is the one wrong claim, and what puts it there is its kind rather than the length
 * of the list above it: whether a module reaches its own top-level calls is a question about
 * running it. A `throw`, a `process.exit`, a rejected top-level `await` and a hang all land there,
 * because in each the source is complete and it is the run that stops, and refusing every file
 * whose top level might not finish would refuse every test file there is. A wrong claim is a
 * defect; a source-decidable refusal above is a visible cost of keeping this reader bounded.
 */
export function declarationsIn(source, file) {
  const { tokens, comments } = tokensIn(source, file);
  const bound = bindings(tokens);
  const found = [];
  for (const comment of comments) {
    if (comment.kind !== 'line' || !comment.startsLine) continue;
    const declaration = comment.text.trimEnd().match(DECLARATION);
    if (!declaration) continue;
    const at = `${file} line ${comment.line}: \`${comment.text.trimEnd()}\``;
    const head = tokens[comment.tokensBefore];
    if (!head || head.line !== comment.line + 1) {
      throw new Error(
        `${at} stands above no test, so nothing proves ${declaration[1]}. A declaration goes ` +
        'on the line directly above the test it speaks for.',
      );
    }
    if (head.depth > 0) {
      throw new Error(
        `${at} sits inside brackets the file has left open, so whether the runner ever reaches ` +
        `the call below it is not something the source says. A declaration of ${declaration[1]} ` +
        'goes above a call at the top level of the file.',
      );
    }
    const first = comment.tokensBefore + (head.kind === 'word' && head.value === 'await' ? 1 : 0);
    const [name, opener, title, after] = tokens.slice(first, first + 4);
    if (!(name?.kind === 'word') || opener?.value !== '(' || title?.kind !== 'string') {
      throw new Error(
        `${at} stands above no test, so nothing proves ${declaration[1]}. A declaration goes ` +
        'on the line directly above the test it speaks for.',
      );
    }
    if (!bound.runner.has(name.value) || bound.taken.has(name.value)) {
      throw new Error(
        `${at} sits above a call to \`${name.value}\`, which nothing at the top level of the file `
        + (bound.taken.has(name.value)
          ? `binds to the runner: the file binds it itself. A call to \`${name.value}\` runs a test `
          : `binds at all. A call to \`${name.value}\` runs a test `)
        + `only where the file imports it from \`${RUNNER_MODULE}\`, so nothing proves `
        + `${declaration[1]}.`,
      );
    }
    // The token after the title says whether the title is that string: an argument separator or
    // the closing paren, and nothing else. A `+` after it is the same fact a `${}` inside it is.
    if (!(after?.kind === 'punct' && (after.value === ',' || after.value === ')'))) {
      throw new Error(
        `${at} sits above a call whose title the source builds from more than one quoted run, so `
        + 'the scan cannot say what the runner registers. A declaration goes above a call carrying '
        + `a plain quoted title, and nothing proves ${declaration[1]} until it does.`,
      );
    }
    const registered = decoded(title.value);
    if (registered === null) {
      throw new Error(
        `${at} sits above a call whose title carries an escape this does not decode, so the `
        + `string the runner registers is not known here and nothing proves ${declaration[1]}.`,
      );
    }
    const unwritable = [...registered].find((character) => terminates(character) || character === '|');
    if (unwritable !== undefined) {
      throw new Error(
        `${at} sits above a call whose title carries ${terminates(unwritable) ? 'a line ending' : 'a `|`'}`
        + `, which a matrix row cannot carry: a row is one line, and its cells are what the \`|\` `
        + `characters divide. Rendering it would malform \`${MATRIX}\`, so nothing proves `
        + `${declaration[1]} until the title loses it.`,
      );
    }
    found.push({
      ids: declaration[1].split(',').map((id) => id.trim()),
      title: registered,
    });
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
