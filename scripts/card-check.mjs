// ABOUTME: An author's check of a card body before filing: a new requirement id with no line naming
// a claim, and spec-style findings inside a pinned `markdown` fence. It refuses no card.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { idRows, retiredIds } from './duplicate-id-check.mjs';
import { findings, ruledOutTerms, sentenceCeiling } from './spec-style-lint.mjs';

const REQUIREMENTS = 'docs/spec/requirements.md';
const RETIRED = ['docs/spec/requirements-retired.md', 'docs/spec/decisions-retired.md'];
const SKILL = '.claude/skills/spec-style/SKILL.md';

/**
 * `read`'s answer, with the path it read named in any error. A missing file's error names its
 * path already; a directory's does not.
 */
function named(paths, read) {
  try {
    return read();
  } catch (error) {
    if (paths.some((path) => error.message.includes(path))) throw error;
    throw new Error(`${paths.join(' or ')}: ${error.message}`);
  }
}

// A card body's lines and fences are read as `R-CARD-13`, `R-CARD-35`, `R-CARD-26` and
// `R-CARD-17` read one. `src/workflow/form-check.mjs` is the engine's reader of the same rules,
// and a script under `scripts/` imports nothing from `src/`, so the few patterns are written here.
const SPLIT = /\r?\n/;
const OPENS = /^ {0,3}(`{3,}|~{3,})(.*)$/s;
const CLOSES = /^ {0,3}(`+|~+)[ \t]*$/;
const ID = /(?<![\w-])R-[A-Z][A-Z0-9]*-\d+(?![\w-])/g;
// What makes a line a claim for the id it names: a path under `test/`, an issue, an owner ruling.
const CLAIM = /(?<![\w./-])test\/[\w.-]|(?<![\w&])#\d+\b|(?<![\w-])U\d+\b/;

/** Every fenced block of the body: its opening line's index, its info string, and its content. */
export function fences(lines) {
  const found = [];
  let open = null;
  lines.forEach((line, index) => {
    if (open) {
      const run = CLOSES.exec(line)?.[1];
      if (run && run[0] === open.run[0] && run.length >= open.run.length) {
        found.push(open);
        open = null;
      } else open.content.push(line);
      return;
    }
    const opening = OPENS.exec(line);
    if (opening) open = { at: index, run: opening[1], info: opening[2].trim(), content: [] };
  });
  if (open) found.push(open);
  return found;
}

/** Whether a fence is pinned text for a binding document: its info string's first word is `markdown`. */
const pinned = (fence) => fence.info.split(/\s+/)[0] === 'markdown';

/** What the check reads under `root`: the allocated ids and the skill's two lintable rules. */
export function inputs(root) {
  const live = join(root, REQUIREMENTS);
  const allocated = new Set([
    ...named([live], () => idRows(readFileSync(live, 'utf8'))),
    ...named(RETIRED.map((path) => join(root, path)), () => retiredIds(root)),
  ]);
  const skill = join(root, SKILL);
  return named([skill], () => {
    const text = readFileSync(skill, 'utf8');
    return { allocated, rules: { ceiling: sentenceCeiling(text), terms: ruledOutTerms(text) } };
  });
}

/**
 * What the body holds: each new id, with the first line naming it and the first line covering it,
 * and each finding the lint makes in a pinned fence, its line moved to the body line it falls on.
 */
export function check(body, root, { allocated, rules } = inputs(root)) {
  const lines = body.split(SPLIT);
  const named = new Map();
  lines.forEach((line, index) => {
    for (const [id] of line.matchAll(ID)) {
      if (allocated.has(id)) continue;
      const entry = named.get(id) ?? { id, line: index + 1 };
      if (!entry.covered && CLAIM.test(line)) entry.covered = { line: index + 1, text: line.trim() };
      named.set(id, entry);
    }
  });
  const pinnedFindings = fences(lines).filter(pinned).flatMap((fence) =>
    findings(fence.content.join('\n'), rules).map((one) => ({ ...one, line: one.line + fence.at + 1 })));
  return { ids: [...named.values()], pinned: pinnedFindings };
}

/**
 * The command: `args` are what follows `npm run check:card --`. It prints its answer through `out`
 * and a run that cannot answer through `err`, and returns the exit code: 0 for nothing found, 1
 * for a finding, 2 for a run that cannot answer.
 */
export function main(args, { out: print = console.log, err = console.error } = {}) {
  const [file, rootArgument] = args;
  if (!file) {
    err('usage: npm run check:card -- <body-file> [root]');
    return 2;
  }
  // No root reads this repository, as `scripts/duplicate-id-check.mjs` does.
  const root = rootArgument ? resolve(rootArgument) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let result;
  try {
    const path = resolve(file);
    result = check(named([path], () => readFileSync(path, 'utf8')), root);
  } catch (error) {
    err(`check:card cannot answer: ${error.message}`);
    return 2;
  }
  let count = 0;
  for (const { id, line, covered } of result.ids) {
    if (covered) {
      print(`${id} is new, and line ${covered.line} names a claim for it: ${covered.text}`);
    } else {
      count += 1;
      print(`line ${line}  ${id} is new, and has no claiming test or exception on any line naming it`);
    }
  }
  for (const { line, rule, term, words, text } of result.pinned) {
    count += 1;
    const why = rule === 'term' ? `ruled-out term \`${term}\`` : `sentence of ${words} words`;
    print(`line ${line}  ${why} in pinned text: ${text}`);
  }
  print(count ? `${count} findings` : 'nothing found');
  return count ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
