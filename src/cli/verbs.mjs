// ABOUTME: The CLI surface: the verbs Rigger accepts, which of them have landed, what `--help`
// ABOUTME: lists for them, and what one whose milestone has not landed answers.

import { init } from './init.mjs';

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

/**
 * The verbs whose milestone has landed, each with what running it does.
 *
 * A verb is here or it is not, and the answer for one that is not is below. Exported because
 * `test/cli.test.mjs` holds every other verb to that answer, and a list of landed verbs kept in
 * the test would drift from this one the day a verb lands.
 */
export const LANDED = { init };

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
  if (Object.hasOwn(LANDED, first)) return LANDED[first]();
  // The rest gain their behaviour with their own milestone, and until then saying so and failing
  // is the honest answer: a zero exit would read to whoever called it as work that was done.
  return { text: `rigger ${first}: not yet implemented`, code: 1 };
}
