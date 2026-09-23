// ABOUTME: Refuses any tracked file carrying a word this repository has ruled out everywhere,
// ABOUTME: naming the file, the line, the spelling it found and what to write instead.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The words ruled out in every tracked file, each with what to write instead.
 *
 * A pattern rather than a spelling, and each brackets one character so that it never matches
 * the line declaring it: `wid[g]et` finds `widget` and not itself. A list spelled plainly would
 * be the first thing the check found, and the alternative — exempting this file by path — would
 * make the one place the word is allowed the one place nobody reads.
 */
export const RULED_OUT = [
  { pattern: 'corp[u]s', instead: 'the binding documents, or the narrower set the sentence means' },
];

/** Every line of one file carrying a ruled-out word, with the line it sits on. */
export function findings(text, ruledOut) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    for (const word of ruledOut) {
      const match = line.match(new RegExp(`\\b${word.pattern}\\b`, 'i'));
      if (match) found.push({ line: index + 1, match: match[0], instead: word.instead, text: line.trim() });
    }
  });
  return found;
}

/**
 * Every file git tracks under a repository root.
 *
 * git owns what this repository tracks, so the check asks it rather than walking the tree
 * (`D16` rule 1). Three places its answer differs from a walk of the disk, each measured
 * against this repository at the commit that added this file. It omits an untracked file, so a
 * throwaway spike in a gitignored directory is never a finding and a new file is unchecked
 * until it is staged. It lists a file the index holds and the working tree no longer does, so
 * `check` skips one it cannot read rather than failing the suite on a delete mid-work. And it
 * needs a git checkout at all: a source tree with no `.git` directory throws here rather than
 * reporting nothing. It lists a binary file no differently from a text one, and this repository
 * tracks none, so nothing is skipped by type.
 */
export function trackedFiles(root) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/**
 * Every ruled-out word in every tracked file, in the order git lists them.
 *
 * A name and a line are reported apart because they are fixed apart: a line is rewritten where
 * it sits, and a name is a rename that takes every reference to it with it.
 */
export function check(root, ruledOut = RULED_OUT) {
  const files = trackedFiles(root);
  const names = files.flatMap((path) =>
    findings(path, ruledOut).map(({ match, instead }) => ({ path, match, instead })));
  const found = files.flatMap((path) => {
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      return [];
    }
    return findings(text, ruledOut).map((one) => ({ path, ...one }));
  });
  return { files, names, findings: found };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is measured. A path measures that repository
  // instead, which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { files, names, findings: found } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const one of names) {
    console.log(`${one.path}  ruled-out word \`${one.match}\` in the name itself`);
    console.log(`        write instead: ${one.instead}`);
  }
  for (const one of found) {
    console.log(`${one.path}:${one.line}  ruled-out word \`${one.match}\``);
    console.log(`        ${one.text}`);
    console.log(`        write instead: ${one.instead}`);
  }
  console.log(`${String(names.length + found.length).padStart(6)}  findings, across ${files.length} tracked files`);
  if (names.length + found.length > 0) {
    console.error('A ruled-out word names no one thing, so the sentence carrying it says less than it looks like. Write what the sentence means.');
    process.exit(1);
  }
}
