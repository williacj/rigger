// ABOUTME: Verifies the references in the documents doc-references.json names, at the fail level
// it gives each. Today that is one reference it can never verify: a path:line pointer.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The document-checking extension point, which ARCHITECTURE.md puts in a file the config points
// at rather than in the config. This path is the only fact the checks that read it hold of their
// own; every document, every level and every exemption comes out of the file.
export const CONFIG = 'doc-references.json';

/**
 * A pointer into a file at a line: a path with an extension, a colon, and a number.
 *
 * The extension is what keeps `node:fs`, a clock time and a clause opener out. A pointer is a
 * claim about where something sits, and the file it points into moves without telling the
 * document, so the resolver reads one as a finding rather than trying to verify it.
 */
const POINTER = /\b[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z]{1,6}:\d+\b/g;

/** What doc-references.json declares: the checked documents, their levels, and the exemptions. */
export function documentChecking(root) {
  return JSON.parse(readFileSync(join(root, CONFIG), 'utf8'));
}

/** Every hand-typed path:line pointer in one document, with the line it sits on. */
export function pathLineLiterals(text) {
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(POINTER)].map((found) => ({ line: index + 1, literal: found[0] })));
}

/**
 * Every pointer in every checked document, and whether any of them fails the build.
 *
 * A `soft` document is reported and does not fail, which is how a document naming assets that
 * have yet to land is read before they land.
 */
export function check(root) {
  const { documents } = documentChecking(root);
  const findings = Object.entries(documents).flatMap(([path, level]) =>
    pathLineLiterals(readFileSync(join(root, path), 'utf8')).map((found) => ({ path, level, ...found })));
  return { findings, failing: findings.some((found) => found.level === 'strict') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { findings, failing } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const { path, level, line, literal } of findings) {
    console.error(`${path}:${line}  [${level}]  hand-typed pointer \`${literal}\``);
  }
  console.log(`${String(findings.length).padStart(6)}  pointers, across the documents ${CONFIG} names`);
  if (failing) {
    console.error('A strict document points at a line. Name what the source calls the thing, never where it sits.');
    process.exit(1);
  }
}
