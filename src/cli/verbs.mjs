// ABOUTME: The CLI surface: the verbs Rigger accepts, which of them have landed, what `--help`
// lists for them, and how a word that is no verb is refused.

import { doctor } from './doctor.mjs';
import { init } from './init.mjs';
import { once } from './once.mjs';
import { pause } from './pause.mjs';
import { plan } from './plan.mjs';
import { report } from './report.mjs';
import { resume } from './resume.mjs';
import { run as runVerb } from './run.mjs';
import { setupBoard } from './setup-board.mjs';
import { verdict } from './verdict.mjs';

/**
 * Every verb, in the order the README's "Install and usage" block lists them, each with the help
 * text this command shows for it.
 *
 * The README is the CLI contract (`AGENTS.md`, "What binds"), so it owns which verbs exist and in
 * what order; `test/cli.test.mjs` reads that block and holds this list to it. The help text beside
 * each verb is this command's own, except `doctor`'s, which that test holds to the README's comment
 * beside `doctor`, so that `--help` names every check `doctor` runs.
 */
export const VERBS = [
  ['init', 'write a starter config, fork the role templates'],
  [
    'doctor',
    'check Node, gh auth, agent CLI auth, config, board reachability, board columns, board priority field, board sharing, gate check required, admission',
  ],
  ['setup-board', 'create the board columns, fields, and labels'],
  ['plan', 'show what the next run would pull, and what it refuses'],
  ['once', 'claim one card, provision its workspace and dispatch its maker, then exit'],
  ['run', 'claim cards until the slots are full, provision their workspaces and dispatch their makers, then exit'],
  ['pause', 'stop admitting new cards; in-flight cards finish'],
  ['resume', 'reopen admission'],
  ['report', 'derive the signals from the event stream'],
  ['verdict', 'post your verdict on a pull request, once you confirm it'],
];

/**
 * The verbs whose milestone has landed, each with what running it does.
 *
 * Every verb the README lists is here. Exported because `test/cli.test.mjs` holds this list to the
 * README's both ways, and a list of landed verbs kept in the test would drift from this one.
 */
export const LANDED = { init, doctor, 'setup-board': setupBoard, plan, once, run: runVerb, pause, resume, report, verdict };

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

/**
 * What the command prints for these arguments, and the status it exits with.
 *
 * Awaited, because a landed verb may have to wait for something: `doctor` imports the consumer's
 * config, which is an ES module and so cannot be read any other way. A verb that answers without
 * waiting is awaited here too and costs nothing.
 */
export async function run(argv) {
  const [first] = argv;
  if (first === '--help') return { text: help(), code: 0 };
  if (!VERBS.some(([verb]) => verb === first)) {
    const said = first === undefined ? 'rigger: a verb is required' : `rigger ${first}: no such verb`;
    return { text: `${said}\n\n${help()}`, code: 1 };
  }
  // A verb is handed the words after it; those that take none read nothing from them.
  if (Object.hasOwn(LANDED, first)) return LANDED[first]({ args: argv.slice(1) });
}
