// ABOUTME: The gate check the forge's required check runs: it reads through L0's read side alone,
// with the job's read-only token, and hands L2's gate rule what it read. It never posts; the
// workflow posts on the head SHA it prints, with a state taken from its exit status alone.

// It is run as one of three modes, each named by its first argument:
// - `card`: the card the event concerns, printed as `card=<number>` for the first job's output;
// - `map`: the open pull requests the event concerns, one number per line;
// - `rule <number>`: the gate's answer for that pull request, exiting 0 where the rule admits.
// The event reaches it through the environment alone: `GITHUB_REPOSITORY`, `NUMBER`, the issue or
// pull request number the event names, `IS_PULL`, `true` where that number is a pull request's,
// and `CARD`, the first job's output.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { consumerConfig } from '../src/cli/doctor.mjs';
import { CONFIG } from '../src/cli/init.mjs';
import { recording } from '../src/cli/recording.mjs';
import { sameLabel, validate, worktreeTopic } from '../src/config/validate.mjs';
import { cardOfBranch, topicFor } from '../src/execution/workspace.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { acceptanceItems, checkAcceptanceForm } from '../src/workflow/form-check.mjs';
import { GATE_CONTEXT, gateAnswer } from '../src/workflow/gate.mjs';
import { acceptanceDigest, undispatchedInstruction } from '../src/workflow/marker.mjs';
import { kindOf, panelOf } from '../src/workflow/next-action.mjs';

/** The exit status of a run that read no pull request to rule on, so the workflow posts nothing. */
const UNREAD = 2;

/** What a failed read says, prefixed with what was being read. */
const failedRead = (what, error) => `the read of ${what} failed: ${error.message}`;

/**
 * The default branch's config, as `{ config, at }`, or `{ problem }` saying why there is none:
 * read from the default branch at the commit read at the run's start, whatever the pull request's
 * base (`ARCHITECTURE.md`, "The required check on the forge"), through `consumerConfig`, from the
 * one file read at that commit, validated, and naming the repository the event names.
 */
async function defaultConfig(reads, repository) {
  let branch;
  let text;
  try {
    branch = await reads.readDefaultBranch();
    text = await reads.readFileAt(branch.head, CONFIG);
  } catch (error) {
    return { problem: failedRead(`the default branch's \`${CONFIG}\``, error) };
  }
  const at = `${branch.name} at ${branch.head}`;
  if (text === null) return { problem: `\`${CONFIG}\` is absent from the default branch, ${at}` };
  const directory = mkdtempSync(join(tmpdir(), 'rigger-gate-config-'));
  let loaded;
  try {
    writeFileSync(join(directory, CONFIG), text);
    loaded = await consumerConfig(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (loaded.problem) return { problem: `${loaded.problem}, on the default branch, ${at}` };
  let refusals;
  try {
    refusals = validate(loaded.config);
  } catch (error) {
    return { problem: `\`${CONFIG}\` on the default branch, ${at}, could not be validated: ${error.message}` };
  }
  if (refusals.length > 0) return { problem: `\`${CONFIG}\` on the default branch, ${at}, is refused: ${refusals.join('; ')}` };
  const named = loaded.config.repo;
  if (typeof named !== 'string' || named.toLowerCase() !== repository.toLowerCase()) {
    return { problem: `\`${CONFIG}\` on the default branch, ${at}, names the repository ${named}, and the event names ${repository}` };
  }
  return { config: loaded.config, at };
}

/** The event's number from `NUMBER`, or a throw naming it. */
function eventNumber(env) {
  const number = Number(env.NUMBER);
  if (!Number.isInteger(number) || number < 1) throw new Error(`NUMBER is ${JSON.stringify(env.NUMBER)}, which is no issue or pull request number`);
  return number;
}

/**
 * The `card` mode: the card the event concerns. An issue's is its own number. A pull request's is
 * the number the default branch's topic rule names for its head branch, and where none is named,
 * or the config cannot be read, the pull request's own number, so its runs still share one group.
 */
async function card({ env, reads, out, log }) {
  const number = eventNumber(env);
  if (env.IS_PULL !== 'true') {
    out(`card=${number}`);
    return 0;
  }
  let pull;
  try {
    pull = await reads.readPullRequestByNumber(number);
  } catch (error) {
    log(failedRead(`pull request #${number}`, error));
    return UNREAD;
  }
  const { config, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);
  if (problem) log(problem);
  const resolved = config === undefined ? null : cardOfBranch(worktreeTopic(config), pull.branch);
  if (resolved === null) log(`pull request #${number}'s branch ${pull.branch} names no card, so its own number keys its runs`);
  out(`card=${resolved ?? number}`);
  return 0;
}

/**
 * The `map` mode: the open pull requests the event concerns, one per line. A pull request's event
 * concerns that pull request. An issue's concerns the open pull requests from the branch the
 * default branch's topic rule names for it, which may be none.
 */
async function map({ env, reads, out, log }) {
  const number = eventNumber(env);
  if (env.IS_PULL === 'true') {
    out(String(number));
    return 0;
  }
  const { config, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);
  if (problem) {
    log(problem);
    return 1;
  }
  const branch = topicFor(worktreeTopic(config), number);
  let open;
  try {
    ({ open } = await reads.readPullRequests(branch));
  } catch (error) {
    log(failedRead(`the pull requests from ${branch}`, error));
    return 1;
  }
  if (open.length === 0) log(`issue #${number} has no open pull request from ${branch}, so nothing is posted`);
  for (const pull of open) out(String(pull.number));
  return 0;
}

/**
 * The `rule` mode: reads pull request `number` and everything the rule rules on, after the run
 * starts, and prints its head SHA, the facts it read and every refusal. A judge the rule still
 * needs has the marker block it must post printed beside its required provider.
 */
async function rule({ env, reads, number, out, log }) {
  out(`# ${GATE_CONTEXT} on pull request #${number}`);
  out('');
  let pull;
  try {
    pull = await reads.readPullRequestByNumber(number);
  } catch (error) {
    log(failedRead(`pull request #${number}`, error));
    return UNREAD;
  }
  out(`head: ${pull.head}`);
  out(`base: ${pull.base}`);
  const refuse = (...reasons) => {
    for (const reason of reasons) out(`refused: ${reason}`);
    return 1;
  };
  if (!pull.fromRepository) {
    return refuse(pull.headRepository === null
      ? `pull request #${number}'s head repository was deleted, so its head is not ${env.GITHUB_REPOSITORY}'s`
      : `pull request #${number} is from ${pull.headRepository}, not ${env.GITHUB_REPOSITORY}`);
  }
  if (pull.state !== 'open') return refuse(`pull request #${number} is ${pull.state}, not open`);
  const { config, at, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);
  if (problem) return refuse(problem);
  out(`config: \`${CONFIG}\` on the default branch, ${at}`);
  const topic = worktreeTopic(config);
  const cardNumber = cardOfBranch(topic, pull.branch);
  if (cardNumber === null) return refuse(`pull request #${number} matches no card: the topic rule \`${topic}\` names no card's branch ${pull.branch}`);
  out(`card: #${cardNumber}`);
  let issue;
  try {
    issue = await reads.readIssue(cardNumber);
  } catch (error) {
    return refuse(failedRead(`issue #${cardNumber}`, error));
  }
  if (issue === null) return refuse(`pull request #${number}'s branch ${pull.branch} names #${cardNumber}, which is no issue in ${env.GITHUB_REPOSITORY}`);
  const held = { number: issue.number, title: issue.title, body: issue.body, labels: issue.labels };
  const { kind, answer } = kindOf(held, config.kinds, config.epicLabel);
  if (answer?.action === 'ignore') {
    return refuse(issue.labels.some((label) => sameLabel(label, config.epicLabel))
      ? `card #${cardNumber} carries the epic label ${config.epicLabel}, so no kind selects it`
      : `no kind selects card #${cardNumber}`);
  }
  if (answer !== undefined) return refuse(`card #${cardNumber} is ${answer.reason}`);
  const form = checkAcceptanceForm(held);
  if (!form.admitted) return refuse(`card #${cardNumber}'s acceptance fails the form check: ${form.reason}`);
  const judges = panelOf(held, config.kinds[kind], config.roles);
  out(`judges: ${judges.map((judge) => (judge.conflict !== undefined ? `(conflict: ${judge.conflict})` : judge.provider === undefined ? judge.role : `${judge.role} on ${judge.provider}`)).join(', ')}`);
  let comments;
  try {
    comments = await reads.readComments(number);
  } catch (error) {
    return refuse(failedRead(`pull request #${number}'s comments`, error));
  }
  const authors = new Map(comments.map((comment) => [comment.author, comment.permission]));
  for (const [author, permission] of authors) out(`permission: ${author ?? '(a deleted account)'} ${permission}`);
  const items = acceptanceItems(issue.body);
  const round = { card: cardNumber, pull: number, head: pull.head, digest: acceptanceDigest(issue.body), count: items.length };
  // The forge enforces the required checks itself, so the rule is handed none.
  const ruled = gateAnswer({ comments, ...round, judges, checks: {} });
  if (ruled.admit) {
    out('admitted');
    return 0;
  }
  refuse(...ruled.refusals.map((refusal) => `${refusal.judge ?? refusal.check}: ${refusal.reason}`));
  const needed = new Set(ruled.refusals.map((refusal) => refusal.judge));
  for (const judge of judges.filter((entry) => entry.conflict === undefined && needed.has(entry.role))) {
    out('');
    out(judge.provider === undefined ? `## The marker ${judge.role} must post` : `## The marker ${judge.role} must post, on provider ${judge.provider}`);
    out('');
    out(undispatchedInstruction({ ...round, role: judge.role, provider: judge.provider, items }));
  }
  return 1;
}

const MODES = { card, map, rule };

/** Runs the mode `argv` names, against the repository the environment names, and answers its exit status. */
async function main(argv, env) {
  const [mode, given] = argv;
  const log = (line) => process.stderr.write(`${line}\n`);
  const out = (line) => process.stdout.write(`${line}\n`);
  if (!Object.hasOwn(MODES, mode)) {
    log(`gate-check: the mode is ${JSON.stringify(mode)}, and it is one of ${Object.keys(MODES).join(', ')}`);
    return UNREAD;
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    log(`gate-check: GITHUB_REPOSITORY is ${JSON.stringify(env.GITHUB_REPOSITORY)}, which names no repository as owner/name`);
    return UNREAD;
  }
  const number = Number(given);
  if (mode === 'rule' && (!Number.isInteger(number) || number < 1)) {
    log(`gate-check: rule was given ${JSON.stringify(given)}, which is no pull request number`);
    return UNREAD;
  }
  return recording(async ({ sink }) => {
    // The gate reads the repository the event names and no board, so its reads name none.
    const reads = repositoryReads({ repo: env.GITHUB_REPOSITORY, project: 'none' }, { emitter: sink.emitter({ layer: 'L0' }) });
    try {
      return await MODES[mode]({ env, reads, number, out, log });
    } catch (error) {
      log(`gate-check: ${error.message}`);
      return UNREAD;
    }
  });
}

process.exitCode = await main(process.argv.slice(2), process.env);
