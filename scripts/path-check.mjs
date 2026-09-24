// ABOUTME: Asserts that every backticked repository path in a checked document exists on disk.
// The resolver never looks at a path carrying no line number, so this covers those.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG, documentChecking } from './doc-reference-check.mjs';

/** A backticked span, which a checked document uses for a path, an id, a column name and a command alike. */
const SPAN = /`([^`\n]+)`/g;
const CODE_MEMBERS = new Set(['String.raw', 'process.exit']);

/**
 * Whether a backticked span names something on disk.
 *
 * A checked document backticks far more than paths, so this asks what a path looks like rather
 * than what exists: a span that exists is a path either way, and a span that does not is the whole
 * point. A path carries no whitespace and names a directory, a dotfile, or a file with a short
 * extension. The checked instructions also name two JavaScript members whose dots name no files.
 */
function looksLikePath(span) {
  if (CODE_MEMBERS.has(span)) return false;
  if (!/^\.?[\w@][\w.@/-]*$/.test(span)) return false;
  return span.includes('/') || /\.[A-Za-z]{1,6}$/.test(span) || /^\.[\w-]+$/.test(span);
}

/** Every backticked repository path in one document, with the line it sits on. */
export function backtickedPaths(text) {
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(SPAN)]
      .map((found) => found[1])
      .filter(looksLikePath)
      .map((path) => ({ line: index + 1, path })));
}

/**
 * Whether an exemption still covers a path.
 *
 * An exemption is written for a place that does not exist yet, and it lasts exactly that long.
 * Once the place exists, a path under it that is still missing is a broken reference like any
 * other, and the entry in the config is spent.
 */
function exempt(root, path, exemptions) {
  return Object.keys(exemptions).some((prefix) => path.startsWith(prefix) && !existsSync(join(root, prefix)));
}

/**
 * Every backticked path in every checked document that exists nowhere and no exemption covers.
 *
 * The fail level belongs to the resolver, and this check reads past it: a missing path fails the
 * build wherever it sits, a `soft` document included. A pointer at a line is a form to rewrite,
 * and a level says when the rewrite is due. A path nothing answers to is wrong now, so what
 * excuses one here is an exemption naming its reason, never a level.
 */
export function check(root) {
  const { documents, exempt: exemptions } = documentChecking(root);
  const findings = Object.keys(documents).flatMap((document) =>
    backtickedPaths(readFileSync(join(root, document), 'utf8'))
      .filter(({ path }) => !existsSync(join(root, path)) && !exempt(root, path, exemptions.paths))
      .map(({ line, path }) => ({ path: document, line, missing: path })));
  return { findings, failing: findings.length > 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { findings, failing } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const { path, line, missing } of findings) {
    console.error(`${path}:${line}  no such path \`${missing}\``);
  }
  console.log(`${String(findings.length).padStart(6)}  missing paths, across the documents ${CONFIG} names`);
  if (failing) {
    console.error(`A document names a path nothing answers to. Add the asset, fix the name, or exempt it in ${CONFIG} with the reason.`);
    process.exit(1);
  }
}
