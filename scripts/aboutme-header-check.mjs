// ABOUTME: Refuses a tracked file whose opening header repeats the prefix the rule allows once,
// naming the file and the lines that carry it.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trackedFiles } from './ruled-out-word-check.mjs';

/** The document that states the rule, and so states which files are exempt from it. */
const RULE_SOURCE = 'AGENTS.md';

/**
 * The prefix a header opens with.
 *
 * It is spelled once, and on a line of its own with a blank line above it, because two adjacent
 * lines naming it would be a repeated header in this file by the check's own reading.
 */
export const PREFIX = 'ABOUTME:';

/**
 * The file's first run of consecutive lines carrying the header prefix, or null for a file with
 * none.
 *
 * This reader is told nothing about where a header may sit, and that is the point. The prefix is
 * allowed on the first line, on the line below a shebang, on the line below a frontmatter opener
 * and on the line below a whole frontmatter block, and a reader carrying that list skips a header
 * that sits somewhere the list does not name — which is a clean answer about a file it never
 * read. So the run is found by its position in the sequence of prefixed lines rather than by line
 * number: the first one, wherever it is.
 */
export function headerRun(text) {
  const run = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.includes(PREFIX)) run.push(index + 1);
    else if (run.length > 0) break;
  }
  return run.length > 0 ? run : null;
}

/**
 * The header rule as one line, however `AGENTS.md` happens to wrap it.
 *
 * The rule is a bullet whose sentences wrap across lines, and card #76 rewrapped 46 files, so an
 * anchor pinned to a line break goes stale on the next sweep and goes stale green. Unwrapping the
 * bullet first means the phrases below are matched against the sentence rather than against
 * today's line width.
 */
export function headerRule(agents) {
  const lines = agents.split(/\r?\n/);
  const opens = lines.findIndex((line) => /^-\s+\*\*Every file opens with an/.test(line));
  if (opens < 0) throw new Error('AGENTS.md states no header rule to read the exempt set from');
  const bullet = [lines[opens]];
  for (const line of lines.slice(opens + 1)) {
    if (!/^\s{2,}\S/.test(line)) break;
    bullet.push(line);
  }
  return bullet.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The files and formats the rule exempts from carrying a header, read out of the rule.
 *
 * Typed here, the set would be a second copy free to disagree with the sentence that grants each
 * exemption, and a reader could not trace one back. Read out of the rule, an exemption exists
 * exactly as long as the rule states it. A rule this cannot find throws rather than returning an
 * empty set, because an empty set turns every exempt file into a finding and sends a reader to
 * the files rather than to the parse.
 */
export function exemptions(agents) {
  const rule = headerRule(agents);
  const named = rule.match(/((?:`[^`]+`(?:,\s*|\s+and\s+))+`[^`]+`) are exempt as well/);
  if (!named) throw new Error('the header rule names no exempt files');
  const format = rule.match(/A format with no comment syntax[^.]*?\bmeans ([A-Za-z]+)/);
  if (!format) throw new Error('the header rule names no exempt format');
  return {
    names: new Set([...named[1].matchAll(/`([^`]+)`/g)].map((one) => one[1])),
    formats: new Set([`.${format[1].toLowerCase()}`]),
  };
}

/**
 * Every header finding in a repository, in the order git lists the files.
 *
 * The scope is every file git tracks, decided by the `trackedFiles(root)` call below. The rule is
 * about every file rather than about the binding documents, so a scope narrowed to what a lint
 * reads would leave most of the repository unguarded — and the entry that reached `main` under
 * the old convention is a journal file, which no lint reads. `trackedFiles` is imported rather
 * than spelled again here: it is the same question git answers for the ruled-out-word check, and
 * the three places its answer differs from a walk of the disk are documented where it lives.
 */
export function check(root) {
  const files = trackedFiles(root);
  const rule = exemptions(readFileSync(join(root, RULE_SOURCE), 'utf8'));
  const found = files.flatMap((path) => {
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      return [];
    }
    return headerFindings(path, text, rule);
  });
  return { files, findings: found, failing: found.length > 0 };
}

/**
 * Whether the rule excuses this file from carrying a header at all.
 *
 * The four it names are root files, and the name is matched rather than the path, because the
 * reason each is named travels with the file: a `.gitignore` in a subdirectory is the same file
 * with the same reason, and nothing would be gained by refusing it for having moved.
 */
export function exempt(path, { names, formats }) {
  const name = path.split('/').pop();
  return names.has(name) || [...formats].some((format) => name.endsWith(format));
}

/**
 * Every finding about one file's header.
 *
 * Two findings, because the rule states two things: that the header is there, and that its prefix
 * appears once. Nothing is exempt by default, so a caller that forgets to pass the rule's
 * exemptions gets more findings rather than fewer.
 */
export function headerFindings(path, text, exemptions = { names: new Set(), formats: new Set() }) {
  const run = headerRun(text);
  if (!run) return exempt(path, exemptions) ? [] : [{ path, kind: 'missing' }];
  if (run.length > 1) return [{ path, kind: 'repeated', lines: run }];
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { files, findings, failing } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const { path, kind, lines } of findings) {
    if (kind === 'repeated') console.error(`${path}:${lines.join(',')}  the header repeats the \`${PREFIX}\` prefix`);
    else console.error(`${path}  no \`${PREFIX}\` header, and ${RULE_SOURCE} exempts no such file`);
  }
  console.log(`${String(findings.length).padStart(6)}  header findings, across ${files.length} tracked files`);
  if (failing) {
    console.error(`A header states what a file is once. Carry the prefix on the header's first line only, or, for a file that should carry none, take the exemption to the owner as a change to ${RULE_SOURCE}.`);
    process.exit(1);
  }
}
