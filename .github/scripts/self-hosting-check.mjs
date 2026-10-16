// ABOUTME: This repository's self-hosting check, which its own workflow runs: a pull request
// touching a path `AGENTS.md` lists under "Self-hosting", or an authored document its "What binds"
// table names, passes only with the owner's sound marker at its head. It reads through L0 alone.

// It is run with one argument, the number of the pull request to rule on, and exits 0 where the
// pull request passes, 1 where it is refused, and 2 where it read no head to post on. It prints
// the head SHA it read and every refusal, and never posts: its workflow posts on that SHA. The
// event reaches it through `GITHUB_REPOSITORY` alone.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defaultConfig } from '../../scripts/gate-check.mjs';
import { recording } from '../../src/cli/recording.mjs';
import { worktreeTopic } from '../../src/config/validate.mjs';
import { cardOfBranch } from '../../src/execution/workspace.mjs';
import { repositoryReads } from '../../src/substrate/forge/read.mjs';
import { acceptanceItems } from '../../src/workflow/form-check.mjs';
import { OWNER, gateAnswer } from '../../src/workflow/gate.mjs';
import { acceptanceDigest } from '../../src/workflow/marker.mjs';

/** The status context the workflow posts this check's answer under. */
export const CONTEXT = 'self-hosting';

/** The file whose lists the check rules by. */
const AGENTS = 'AGENTS.md';

/** The exit status of a run that read no head to rule on, so the workflow posts nothing. */
const UNREAD = 2;

/** What a failed read says, prefixed with what was being read. */
const failedRead = (what, error) => `the read of ${what} failed: ${error.message}`;

/** The lines of the section of `markdown` headed `## <heading>`, up to the next such heading, or null. */
function sectionOf(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The backticked spans of `text`, in order. */
const spansOf = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/**
 * The paths the bullets of "Self-hosting" backtick. A bullet starts a line with `- ` and runs on
 * over the indented lines after it. Nothing else in the section is read.
 */
function selfHostingPaths(section) {
  const bullets = [];
  let open = false;
  for (const line of section) {
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2));
      open = true;
    } else if (open && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else open = false;
  }
  return bullets.flatMap(spansOf);
}

/** The cells of a table row: the text between its pipes, trimmed. */
const cellsOf = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

/**
 * The documents the "What binds" table names as authored, or `{ problem }`: the backticked span of
 * the Document cell of each row whose Authority cell does not hold the word `Generated`, the rule
 * `AGENTS.md` applies to its generated document under the table.
 */
function authoredDocuments(section) {
  const at = section.findIndex((line, index) => line.startsWith('|') && /^\|[\s:|-]+\|$/.test(section[index + 1]?.trim() ?? ''));
  const header = at === -1 ? [] : cellsOf(section[at]);
  const [document, authority] = [header.indexOf('Document'), header.indexOf('Authority')];
  if (document === -1 || authority === -1) return { problem: '`AGENTS.md`\'s "What binds" section holds no table with a Document and an Authority column' };
  const rows = [];
  for (let index = at + 2; index < section.length && section[index].startsWith('|'); index += 1) rows.push(cellsOf(section[index]));
  if (rows.length === 0) return { problem: '`AGENTS.md`\'s "What binds" table holds no row' };
  const documents = [];
  for (const [index, cells] of rows.entries()) {
    const spans = spansOf(cells[document] ?? '');
    if (spans.length !== 1) return { problem: `\`AGENTS.md\`'s "What binds" row ${index + 1}'s Document cell backticks no one path` };
    if (!/\bGenerated\b/.test(cells[authority] ?? '')) documents.push(spans[0]);
  }
  return { documents };
}

/**
 * The lists `AGENTS.md`'s `markdown` holds, as `{ paths, documents }`, or `{ problem }` saying why
 * either cannot be read: `paths` the backticked spans of each bullet under "Self-hosting", and
 * `documents` the authored documents "What binds" names.
 */
export function listsOf(markdown) {
  const hosting = sectionOf(markdown, 'Self-hosting');
  if (hosting === null) return { problem: '`AGENTS.md` holds no "Self-hosting" section' };
  const paths = selfHostingPaths(hosting);
  if (paths.length === 0) return { problem: '`AGENTS.md`\'s "Self-hosting" section holds no bullet naming a path' };
  const binds = sectionOf(markdown, 'What binds');
  if (binds === null) return { problem: '`AGENTS.md` holds no "What binds" section' };
  const { documents, problem } = authoredDocuments(binds);
  return problem === undefined ? { paths, documents } : { problem };
}

/** What each of git's one-letter escapes in a quoted path stands for. */
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * The path a C-quoted span of `text` from `at` spells, as git quotes a path holding a non-ASCII
 * character, a quote, a backslash or a control character, and the index after its closing quote;
 * or null where no quoted path starts there. An octal escape is one byte of the path's UTF-8.
 */
function quotedAt(text, at) {
  if (text[at] !== '"') return null;
  const bytes = [];
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') return { path: Buffer.from(bytes).toString('utf8'), end: index + 1 };
    if (char !== '\\') {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const next = text[index + 1];
    if (/^[0-7]{3}$/.test(text.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 4), 8));
      index += 3;
    } else if (Object.hasOwn(ESCAPES, next ?? '')) {
      bytes.push(ESCAPES[next]);
      index += 1;
    } else return null;
  }
  return null;
}

/** The path one side of a header or an extended header line names, quoted or not, or null. */
function pathOf(text) {
  if (!text.startsWith('"')) return text;
  const quoted = quotedAt(text, 0);
  return quoted !== null && quoted.end === text.length ? quoted.path : null;
}

/**
 * The two paths a `diff --git` header's `rest` names, without their `a/` and `b/`, or null where
 * it cannot be read. An unquoted pair is split where its two halves name one path, or at its one
 * ` b/`; a header naming two paths with spaces is read from its rename or copy lines instead.
 */
function headerPaths(rest) {
  const strip = (one, two) => (one?.startsWith('a/') && two?.startsWith('b/') ? [one.slice(2), two.slice(2)] : null);
  if (rest.startsWith('"')) {
    const first = quotedAt(rest, 0);
    if (first === null || rest[first.end] !== ' ') return null;
    return strip(first.path, pathOf(rest.slice(first.end + 1)));
  }
  const quoted = rest.lastIndexOf(' "');
  if (rest.endsWith('"') && quoted !== -1) return strip(rest.slice(0, quoted), pathOf(rest.slice(quoted + 1)));
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) return strip(rest.slice(0, half), rest.slice(half + 1));
  const splits = [...rest.matchAll(/ b\//g)];
  return splits.length === 1 ? strip(rest.slice(0, splits[0].index), rest.slice(splits[0].index + 1)) : null;
}

/** The extended header lines that name a path of their own, as git writes a rename or a copy. */
const NAMING = /^(?:rename|copy) (?:from|to) (.*)$/;

/**
 * Every path `diff` names, as `{ paths }`, or `{ problem }` where a file header in it cannot be
 * read or it holds text and no header. Each file's header names its path before and after, and a
 * rename's or copy's extended header names each again; a hunk's lines are never read as headers.
 */
export function pathsIn(diff) {
  const paths = [];
  let header = false;
  let pending = null;
  const settle = () => {
    if (pending === null) return null;
    const { line, named, pair } = pending;
    pending = null;
    if (pair === null && named.length === 0) return `the diff's header ${JSON.stringify(line)} names no a/ and b/ path this check can read`;
    paths.push(...(pair ?? []), ...named);
    return null;
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const problem = settle();
      if (problem) return { problem };
      pending = { line, named: [], pair: headerPaths(line.slice('diff --git '.length)) };
      header = true;
    } else if (header && line.startsWith('@@')) header = false;
    else if (header && NAMING.test(line)) {
      const named = pathOf(NAMING.exec(line)[1]);
      if (named === null) return { problem: `the diff's line ${JSON.stringify(line)} names no path this check can read` };
      pending.named.push(named);
    }
  }
  const problem = settle();
  if (problem) return { problem };
  if (paths.length === 0 && diff.trim() !== '') return { problem: 'the diff holds no file header this check can read' };
  return { paths: [...new Set(paths)] };
}

/**
 * Whether `path` touches `listed`, comparing without regard to letter case (`D13`): a listed
 * directory, ending in `/`, is touched by any path under it and by an entry at its own path; a
 * listed file only by its own path.
 */
function touches(path, listed) {
  const [one, other] = [path.toLowerCase(), listed.toLowerCase()];
  return other.endsWith('/') ? one.startsWith(other) || one === other.slice(0, -1) : one === other;
}

/** The entries of `listed` that `diff` touches, in `listed`'s order, as `{ touched }`, or `{ problem }`. */
export function touchedIn(diff, listed) {
  const { paths, problem } = pathsIn(diff);
  if (problem) return { problem };
  return { touched: listed.filter((entry) => paths.some((path) => touches(path, entry))) };
}

/**
 * The check's answer for pull request `number`, read after the run starts: `{ unread }` where it
 * read no head to post on, or `{ head, said, refusals }`, the head it read, the facts it read, and
 * why it refuses, none where it passes. The lists are read from `AGENTS.md` at the default-branch
 * commit the config was read at. A pull request touching nothing listed passes whatever its card
 * says; one touching a listed path or an authored document needs the owner's sound marker.
 */
async function rule({ env, reads, number }) {
  let pull;
  try {
    pull = await reads.readPullRequestByNumber(number);
  } catch (error) {
    return { unread: failedRead(`pull request #${number}`, error) };
  }
  const said = [`base: ${pull.base}`];
  const answer = (...refusals) => ({ head: pull.head, said, refusals });
  if (!pull.fromRepository) {
    return answer(pull.headRepository === null
      ? `pull request #${number}'s head repository was deleted, so its head is not ${env.GITHUB_REPOSITORY}'s`
      : `pull request #${number} is from ${pull.headRepository}, not ${env.GITHUB_REPOSITORY}`);
  }
  const { config, at, commit, problem } = await defaultConfig(reads, env.GITHUB_REPOSITORY);
  if (problem) return answer(problem);
  said.push(`config: the default branch, ${at}`);
  let text;
  try {
    text = await reads.readFileAt(commit, AGENTS);
  } catch (error) {
    return answer(failedRead(`\`${AGENTS}\` on the default branch, ${at}`, error));
  }
  if (text === null) return answer(`\`${AGENTS}\` is absent from the default branch, ${at}`);
  const lists = listsOf(text);
  if (lists.problem) return answer(`${lists.problem}, on the default branch, ${at}`);
  said.push(`self-hosting paths: ${lists.paths.join(', ')}`, `authored documents: ${lists.documents.join(', ')}`);
  let diff;
  try {
    diff = await reads.readDiff(number);
  } catch (error) {
    return answer(failedRead(`pull request #${number}'s diff`, error));
  }
  let again;
  try {
    again = await reads.readPullRequestByNumber(number);
  } catch (error) {
    return { unread: failedRead(`pull request #${number}, after its diff`, error) };
  }
  if (again.head !== pull.head) {
    return { unread: `pull request #${number}'s head moved from ${pull.head} to ${again.head} while its diff was read, so nothing is posted for this event; the run for the new head rules on it` };
  }
  const { touched, problem: unreadable } = touchedIn(diff, [...lists.paths, ...lists.documents]);
  if (unreadable) return answer(unreadable);
  said.push(`touches: ${touched.length === 0 ? 'nothing listed' : touched.join(', ')}`);
  if (touched.length === 0) return answer();
  const topic = worktreeTopic(config);
  const cardNumber = cardOfBranch(topic, pull.branch);
  if (cardNumber === null) return answer(`pull request #${number} touches ${touched.join(', ')} and matches no card: the topic rule \`${topic}\` names no card's branch ${pull.branch}`);
  said.push(`card: #${cardNumber}`);
  let issue;
  try {
    issue = await reads.readIssue(cardNumber);
  } catch (error) {
    return answer(failedRead(`issue #${cardNumber}`, error));
  }
  if (issue === null) return answer(`pull request #${number}'s branch ${pull.branch} names #${cardNumber}, which is no issue in ${env.GITHUB_REPOSITORY}`);
  let comments;
  try {
    comments = await reads.readComments(number);
  } catch (error) {
    return answer(failedRead(`pull request #${number}'s comments`, error));
  }
  for (const [author, permission] of new Map(comments.map((comment) => [comment.author, comment.permission]))) said.push(`permission: ${author ?? '(a deleted account)'} ${permission}`);
  const round = { card: cardNumber, pull: number, head: pull.head, digest: acceptanceDigest(issue.body), count: acceptanceItems(issue.body).length };
  const ruled = gateAnswer({ comments, ...round, judges: [{ role: OWNER }], checks: {} });
  return ruled.admit ? answer() : answer(...ruled.refusals.map((refusal) => `${refusal.judge}: ${refusal.reason}`));
}

/** Rules on the pull request `argv` names, in the repository the environment names, and answers the exit status. */
async function main(argv, env) {
  const log = (line) => process.stderr.write(`${line}\n`);
  const out = (line) => process.stdout.write(`${line}\n`);
  const number = Number(argv[0]);
  if (!Number.isInteger(number) || number < 1) {
    log(`self-hosting-check: it was given ${JSON.stringify(argv[0])}, which is no pull request number`);
    return UNREAD;
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    log(`self-hosting-check: GITHUB_REPOSITORY is ${JSON.stringify(env.GITHUB_REPOSITORY)}, which names no repository as owner/name`);
    return UNREAD;
  }
  return recording(async ({ sink }) => {
    // The check reads the repository the event names and no board, so its reads name none.
    const reads = repositoryReads({ repo: env.GITHUB_REPOSITORY, project: 'none' }, { emitter: sink.emitter({ layer: 'L0' }) });
    let answered;
    try {
      answered = await rule({ env, reads, number });
    } catch (error) {
      log(`self-hosting-check: ${error.message}`);
      return UNREAD;
    }
    out(`# ${CONTEXT} on pull request #${number}`);
    out('');
    if (answered.unread !== undefined) {
      log(answered.unread);
      return UNREAD;
    }
    out(`head: ${answered.head}`);
    for (const line of answered.said) out(line);
    for (const reason of answered.refusals) out(`refused: ${reason}`);
    if (answered.refusals.length > 0) return 1;
    out('passed');
    return 0;
  });
}

// Run as a script, it rules on the pull request its argument names; imported, it runs nothing. The
// path it was run by is resolved first, because the module's own is.
const ranDirectly = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (ranDirectly) process.exitCode = await main(process.argv.slice(2), process.env);
