// ABOUTME: The `verdict` verb: the owner's verdict on a pull request, built against the round the gate
// reads, shown whole, and posted as one comment once the owner confirms it on the terminal at
// standard input. It never edits or deletes a comment, and nothing it reads skips the question.

import { createInterface } from 'node:readline';

import { validate, worktreeTopic } from '../config/validate.mjs';
import { cardOfBranch } from '../execution/workspace.mjs';
import { repositoryReads } from '../substrate/forge/read.mjs';
import { repositoryWriteSide } from '../substrate/forge/repository-write.mjs';
import { acceptanceItems, checkAcceptanceForm } from '../workflow/form-check.mjs';
import { OWNER } from '../workflow/gate.mjs';
import { acceptanceDigest, composeMarker } from '../workflow/marker.mjs';
import { unrecordedNamed } from '../workflow/transitions.mjs';
import { PACKAGE, consumerConfig, settled } from './doctor.mjs';
import { CONFIG } from './init.mjs';
import { recording } from './recording.mjs';

/** The verdict each word the owner gives names, among the three `R-VERDICT-2` fixes. */
const VERDICTS = { sound: 'sound', 'needs-revision': 'needs revision', critical: 'critical' };

/** The options the verb names, each taking one value. */
const OPTIONS = ['--to-sound', '--unmet', '--insufficient'];

/** What a value the marker writes on one line may not hold: the line endings its parse splits on and those `.` does not match. */
const BREAK = /[\n\r\u2028\u2029]/;

/** What the verb prints and exits with where it posts nothing, for `why`. */
const refused = (why) => ({ text: `rigger verdict: ${why}, so nothing is posted`, code: 1 });

/**
 * The owner's verdict as `args` give it, `{ pull, verdict, unmet, toSound, insufficient }`, or `{
 * refusal }` naming why it is none. Item numbers past the acceptance's count are checked once the
 * card is read.
 */
function ruling(args) {
  const [pull, word, ...rest] = args;
  if (pull === undefined) return { refusal: 'it was given no pull request number' };
  if (!/^[1-9][0-9]*$/.test(pull) || !Number.isSafeInteger(Number(pull))) return { refusal: `${JSON.stringify(pull)} is not a pull request number` };
  if (word === undefined) return { refusal: `it was given no verdict: give one of ${Object.keys(VERDICTS).join(', ')}` };
  if (!Object.hasOwn(VERDICTS, word)) return { refusal: `${JSON.stringify(word)} is no verdict: give one of ${Object.keys(VERDICTS).join(', ')} (\`R-VERDICT-2\`)` };
  const given = {};
  for (let at = 0; at < rest.length; at += 2) {
    const option = rest[at];
    if (!OPTIONS.includes(option)) {
      return { refusal: option.startsWith('-') ? `${JSON.stringify(option)} is an option it does not name` : `${JSON.stringify(option)} is an argument past those it names` };
    }
    if (Object.hasOwn(given, option)) return { refusal: `${option} is given twice` };
    const value = rest[at + 1];
    if (value === undefined || OPTIONS.includes(value)) return { refusal: `${option} is given no value` };
    if (option !== '--unmet' && value.trim() === '') return { refusal: `${option}'s value is empty` };
    if (option !== '--unmet' && BREAK.test(value)) return { refusal: `${option}'s value holds a line break, and it is written on one line` };
    given[option] = value;
  }
  const verdict = VERDICTS[word];
  if (verdict === 'sound' && given['--unmet'] !== undefined) return { refusal: 'a sound verdict rules no item unmet (`R-VERDICT-4`)' };
  if (verdict === 'sound' && given['--to-sound'] !== undefined) return { refusal: 'a sound verdict names nothing that would make it sound' };
  if (verdict !== 'sound' && given['--to-sound'] === undefined) return { refusal: `a ${verdict} verdict names what would make the work sound, with --to-sound (\`R-VERDICT-3\`)` };
  const listed = given['--unmet'];
  if (listed !== undefined && !/^[0-9]+(?:,[0-9]+)*$/.test(listed)) return { refusal: `--unmet ${JSON.stringify(listed)} is not item numbers, as <n>[,<n>...]` };
  const unmet = listed === undefined ? [] : listed.split(',').map(Number);
  if (unmet.includes(0)) return { refusal: '--unmet names item 0, and the items are numbered from 1' };
  const twice = unmet.find((item, at) => unmet.indexOf(item) !== at);
  if (twice !== undefined) return { refusal: `--unmet names item ${twice} twice` };
  return { pull: Number(pull), verdict, unmet, toSound: given['--to-sound'], insufficient: given['--insufficient'] };
}

/** The first line `input` gives, without its ending, or null where it ends before one. */
function lineFrom(input) {
  const lines = createInterface({ input, terminal: false });
  return new Promise((resolve) => {
    lines.once('line', (line) => {
      resolve(line);
      lines.close();
    });
    lines.once('close', () => resolve(null));
  });
}

/**
 * What the command prints for a `verdict` run, and the status it exits with. `args` are the words
 * after the verb. It asks only on a terminal at its standard input, and reads the answer there
 * (`R-VERDICT-10`).
 */
export async function verdict({ args = [], push } = {}) {
  const given = ruling(args);
  if (given.refusal) return refused(given.refusal);
  if (process.stdin.isTTY !== true) return refused('its standard input is no terminal, so it has no terminal to ask on');
  return recording((opened) => posting(opened, given), push);
}

/** `verdict`'s work once the owner's verdict is read, recording through the sink `opened` holds. */
async function posting(opened, given) {
  const { named, refusal } = await settled('verdict', opened, { target: process.cwd(), packageRoot: PACKAGE });
  if (refusal) return refusal;
  const { config, problem } = await consumerConfig(named);
  if (problem) return refused(problem);
  let refusals;
  try {
    refusals = validate(config);
  } catch (error) {
    return refused(`\`${CONFIG}\` in ${named} could not be validated: ${error.message}`);
  }
  if (refusals.length > 0) return refused(`\`${CONFIG}\` in ${named} is refused: ${refusals.join('; ')}`);
  opened.admitted(config);
  const emitter = opened.sink.emitter({ layer: 'L0' });
  // The verb reads the repository its config names and no board, so its reads name none.
  const forge = { repo: config.repo, project: 'none' };
  const reads = repositoryReads(forge, { emitter });
  const read = async (what, reading) => {
    try {
      return { value: await reading() };
    } catch (error) {
      return { problem: `the read of ${what} failed: ${error.message}` };
    }
  };

  // The gate's own read of the default branch's config, loaded here rather than with the verb
  // table, so no other verb's start loads the gate check script.
  const { defaultConfig } = await import('../../scripts/gate-check.mjs');
  const main = await defaultConfig(reads, config.repo);
  if (main.problem) return refused(`the config in ${named} names ${config.repo}, whose default branch's config answers: ${main.problem}`);
  const number = given.pull;
  const pulled = await read(`pull request #${number}`, () => reads.readPullRequestByNumber(number));
  if (pulled.problem) return refused(pulled.problem);
  const pull = pulled.value;
  if (!pull.fromRepository) return refused(`pull request #${number}'s head is in ${pull.headRepository ?? 'a deleted repository'}, not ${config.repo}`);
  if (pull.state !== 'open') return refused(`pull request #${number} is ${pull.state}, not open`);
  const topic = worktreeTopic(main.config);
  const card = cardOfBranch(topic, pull.branch);
  if (card === null) return refused(`pull request #${number}'s branch ${pull.branch} names no card under the default branch's topic rule \`${topic}\``);
  const issued = await read(`issue #${card}`, () => reads.readIssue(card));
  if (issued.problem) return refused(issued.problem);
  const issue = issued.value;
  if (issue === null) return refused(`pull request #${number}'s branch ${pull.branch} names #${card}, which is no issue in ${config.repo}`);
  const form = checkAcceptanceForm(issue);
  if (!form.admitted) return refused(`card #${card}'s acceptance fails the form check: ${form.reason}`);
  const items = acceptanceItems(issue.body);
  const past = given.unmet.find((item) => item > items.length);
  if (past !== undefined) return refused(`--unmet names item ${past}, and card #${card}'s acceptance holds ${items.length} items`);

  const marker = {
    card,
    pull: number,
    head: pull.head,
    digest: acceptanceDigest(issue.body),
    role: OWNER,
    verdict: given.verdict,
    items: items.map((_, at) => (given.unmet.includes(at + 1) ? 'unmet' : 'met')),
    coverage: given.insufficient === undefined ? 'covered' : 'insufficient',
    coverageReason: given.insufficient,
    toSound: given.toSound,
  };
  const body = composeMarker(marker, `The owner's verdict on pull request #${number}: ${given.verdict}.`);
  process.stdout.write([
    `rigger verdict: the comment it posts on pull request #${number} once you confirm it:`,
    '',
    body,
    `The acceptance items of card #${card}, each with its ruling:`,
    ...items.map((item, at) => `  ${at + 1}. ${marker.items[at]}: ${item}`),
    '',
    `Post this comment as your verdict on pull request #${number}? [y/N] `,
  ].join('\n'));
  const answer = await lineFrom(process.stdin);
  if (answer === null) return refused('standard input ended before an answer');
  if (!/^(?:y|yes)$/i.test(answer)) return refused(`the answer was ${JSON.stringify(answer)}, not y or yes`);

  // The round is read again, so a verdict shown against one head or acceptance never lands on another.
  const again = await read(`pull request #${number}`, () => reads.readPullRequestByNumber(number));
  if (again.problem) return refused(again.problem);
  if (again.value.state !== 'open') return refused(`pull request #${number} is ${again.value.state}, not open, after the verdict was shown`);
  if (again.value.head !== pull.head) return refused(`pull request #${number}'s head moved from ${pull.head} to ${again.value.head} after the verdict was shown`);
  const reissued = await read(`issue #${card}`, () => reads.readIssue(card));
  if (reissued.problem) return refused(reissued.problem);
  if (reissued.value === null || acceptanceDigest(reissued.value.body) !== marker.digest) return refused(`card #${card}'s acceptance changed after the verdict was shown`);

  let posted;
  try {
    posted = await repositoryWriteSide(forge, { emitter }).postComment(number, body);
  } catch (error) {
    // A post the repository-write side marked made is on the pull request; only its record was refused.
    if (error.made) return { text: `rigger verdict: posted the owner's verdict on pull request #${number}: ${error.made.answer.html_url}, and the event sink refused to record it: ${unrecordedNamed(error)}`, code: 1 };
    return { text: `rigger verdict: the post failed, and it is not tried again: ${error.message}`, code: 1 };
  }
  return { text: `rigger verdict: posted the owner's verdict on pull request #${number}: ${posted.html_url}`, code: 0 };
}
