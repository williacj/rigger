#!/usr/bin/env node
// ABOUTME: Rigger's command line: the verbs it accepts, what `--help` lists, and what a verb
// ABOUTME: whose milestone has not landed says before it exits non-zero.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every verb, in the order the README's "Install and usage" block lists them, each with the help
 * text this command shows for it.
 *
 * The README is the CLI contract (`AGENTS.md`, "What binds"), so it owns which verbs exist and in
 * what order; `test/cli.test.mjs` reads that block and holds this list to it. The help text beside
 * each verb is this command's own, and the check does not match on it.
 */
export const VERBS = [
  ['init', 'write a starter config, fork the role templates'],
  ['doctor', 'check gh auth, agent CLI auth, Node, config, board fields'],
  ['setup-board', 'create the board columns, fields, and labels'],
  ['plan', 'show what the next run would pull, and what it refuses'],
  ['once', 'pull and finish one card, then exit'],
  ['run', 'run until the board drains'],
  ['pause', 'stop admitting new cards; in-flight cards finish'],
  ['resume', 'reopen admission'],
  ['report', 'derive the signals from the event stream'],
];

/** What `--help` prints: one line per verb, the verb first. */
export function help(verbs = VERBS) {
  const width = Math.max(...verbs.map(([verb]) => verb.length));
  return [
    'Usage: rigger <verb>',
    '',
    'Verbs:',
    ...verbs.map(([verb, summary]) => `  ${verb.padEnd(width)}  ${summary}`),
    '',
  ].join('\n');
}

/** What the command prints for these arguments, and the status it exits with. */
export function run(argv) {
  const [first] = argv;
  if (first === '--help') return { text: help(), code: 0 };
  if (!VERBS.some(([verb]) => verb === first)) {
    const said = first === undefined ? 'rigger: a verb is required' : `rigger ${first}: no such verb`;
    return { text: `${said}\n\n${help()}`, code: 1 };
  }
  // Nothing behind any verb has landed yet. Each one gains its behaviour with its own milestone,
  // and until then saying so and failing is the honest answer: a zero exit would read to whoever
  // called it as work that was done.
  return { text: `rigger ${first}: not yet implemented`, code: 1 };
}

// A bin is reached through a symlink once it is installed, so the two paths are compared after
// resolving: `process.argv[1]` is the link and `import.meta.url` is its target.
const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  const { text, code } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}
