// ABOUTME: The forge adapter's repository-write side: merges, issue and PR comments, labels,
// and issue opening and closing, sent through its own runner. Only L2 reaches it.

import { firstLine, readRunner, repositoryWriteRunner } from './runners.mjs';
import { carried, written } from './write-made.mjs';
import { sameLabel } from '../../config/validate.mjs';

/** The HTTP status and message `gh api` printed for a refused write. */
function refusal(said) {
  let body = {};
  try { body = JSON.parse(said.stdout); } catch { /* gh can fail before receiving an HTTP body. */ }
  return { status: Number(body.status ?? /HTTP (\d+)/.exec(said.stderr ?? '')?.[1]), message: body.message ?? firstLine(said) };
}

/** The mapped refusal named by the merge API, or null for a message the forge has not named. */
function mergeRefusal(status, message) {
  if (status === 409 && /Head branch was modified/.test(message)) return { reason: 'head moved' };
  if (status !== 405) return null;
  if (/Pull Request has merge conflicts/.test(message)) return { reason: 'conflict' };
  const check = /Required status check "([^"]+)" (is failing|is pending|is expected|was not set by the expected GitHub app)\./.exec(message);
  if (check) {
    const reasons = { 'is failing': 'failing', 'is pending': 'pending', 'is expected': 'no record', 'was not set by the expected GitHub app': 'set by another app' };
    return { reason: reasons[check[2]], context: check[1] };
  }
  if (/Base branch was modified/.test(message)) return { reason: 'base modified' };
  if (/out of date|behind/i.test(message)) return { reason: 'behind' };
  if (/merge commit.*not allowed|merge method.*not allowed/i.test(message)) return { reason: 'method' };
  if (/already merged/i.test(message)) return { reason: 'already merged' };
  if (/closed/i.test(message)) return { reason: 'closed' };
  if (/mergeability.*unknown|mergeable.*unknown/i.test(message)) return { reason: 'unknown' };
  return null;
}

/** The read gives a pull request's state and head before a merge. */
async function pullOf(board, number, via) {
  if (!Number.isInteger(number) || number < 1) throw new Error(`pull request #${number} is not a pull request number`);
  const said = await readRunner(['api', `repos/${board.repo}/pulls/${number}`, '-X', 'GET'], via);
  if (said.status !== 0) throw new Error(`reading pull request #${number} failed: ${firstLine(said)}`);
  return JSON.parse(said.stdout);
}

/**
 * Name an issue write's target and reason, keeping transport and event-refusal codes, and an event
 * refusal's result, unrecorded events and mark.
 */
async function issueWrite(operation, kind, number, write) {
  const named = `${operation} on ${kind} #${number} failed: `;
  try {
    return await write();
  } catch (error) {
    if (error.message.startsWith(named)) throw error;
    throw carried(new Error(`${named}${error.message}`, { cause: error }), error);
  }
}

export function repositoryWriteSide(board, { send, emitter, timeout } = {}) {
  const via = { send, emitter, timeout };
  /** The parsed answer of an issue write's call `said`, where it exited 0 within its timeout. */
  const issueAnswer = (said) => {
    if (said.status !== 0 || said.timedOut) throw new Error(firstLine(said));
    return JSON.parse(said.stdout);
  };
  /**
   * Sends the issue write `args` and answers what `accept` makes of its parsed answer. A refused
   * event on the call is marked made where that same check passes on the call's result.
   */
  const sendIssue = async (args, accept = (answer) => answer) => {
    const check = (said) => accept(issueAnswer(said));
    return check(await written(repositoryWriteRunner(args, via), check));
  };
  const postIssue = (number, endpoint, value, operation, kind = 'issue') => issueWrite(operation, kind, number, async () => {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${operation} on ${kind} #${number} failed: not an ${kind} number`);
    const args = ['api', `repos/${board.repo}/issues/${number}/${endpoint}`, '-X', 'POST', '-f', value];
    // The error names its operation here, so `issueWrite` passes it on as it stands, whatever gh said.
    const posted = (said) => {
      if (said.status !== 0 || said.timedOut) throw new Error(`${operation} on ${kind} #${number} failed: ${firstLine(said)}`);
      return JSON.parse(said.stdout);
    };
    return posted(await written(repositoryWriteRunner(args, via), posted));
  });
  return {
    /** Merge by merge commit only at `expectedHead`, or answer why the forge refused it. */
    mergePullRequest: async (number, expectedHead) => {
      if (!/^[0-9a-f]{40}$/.test(expectedHead ?? '')) throw new Error('mergePullRequest requires an expected head SHA');
      const pull = await pullOf(board, number, via);
      if (pull.head?.sha !== expectedHead) return { outcome: 'refused', reason: 'head moved' };
      if (!pull.merged && pull.state !== 'open') return { outcome: 'refused', reason: 'closed' };
      if (!pull.merged && pull.mergeable === null) return { outcome: 'refused', reason: 'unknown' };
      if (!pull.merged && pull.mergeable === false) return { outcome: 'refused', reason: 'conflict' };
      const args = ['api', `repos/${board.repo}/pulls/${number}/merge`, '-X', 'PUT', '-f', `sha=${expectedHead}`, '-f', 'merge_method=merge'];
      const merged = (made) => {
        if (made.status !== 0 || made.timedOut) throw new Error(firstLine(made));
        const body = JSON.parse(made.stdout);
        if (body.merged !== true) throw new Error(`mergePullRequest #${number} answered merged ${body.merged}`);
        return { outcome: pull.merged ? 'already merged' : 'merged', sha: body.sha };
      };
      const said = await written(repositoryWriteRunner(args, via), merged);
      if (said.timedOut) throw new Error(`mergePullRequest #${number} failed: ${firstLine(said)}`);
      if (said.status === 0) {
        const body = JSON.parse(said.stdout);
        if (body.merged === true) return { outcome: pull.merged ? 'already merged' : 'merged', sha: body.sha };
      }
      const { status, message } = refusal(said);
      const mapped = mergeRefusal(status, message);
      if (mapped) return { outcome: 'refused', ...mapped };
      throw new Error(`mergePullRequest #${number} failed: ${Number.isFinite(status) ? `HTTP ${status} ` : ''}${message}`);
    },
    /** Post `body` on a pull request, refusing an issue number that is not a pull request. */
    postComment: (number, body) => issueWrite('postComment', 'pull request', number, async () => {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(`postComment on pull request #${number} failed: not a pull request number`);
      const confirmed = await readRunner(['api', `repos/${board.repo}/pulls/${number}`, '-X', 'GET'], via);
      if (confirmed.status !== 0 || confirmed.timedOut) throw new Error(`postComment on pull request #${number} failed: the forge did not confirm a pull request: ${firstLine(confirmed)}`);
      let pull;
      try { pull = JSON.parse(confirmed.stdout); } catch { /* An unreadable response cannot confirm a PR. */ }
      if (typeof pull?.head?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(pull.head.sha)) throw new Error(`postComment on pull request #${number} failed: the forge did not confirm a pull request`);
      return postIssue(number, 'comments', `body=${body}`, 'postComment', 'pull request');
    }),
    /** Append `body` to an issue, including the issue behind a pull request. */
    postIssueComment: (number, body) => postIssue(number, 'comments', `body=${body}`, 'postIssueComment'),
    /** Add one label without replacing the issue's existing labels. */
    addIssueLabel: async (number, label) => {
      if (typeof label !== 'string' || label.length === 0) throw new Error(`addIssueLabel on issue #${number} failed: requires one label name`);
      return postIssue(number, 'labels', `labels[]=${label}`, 'addIssueLabel');
    },
    /** Open one issue with all its labels in the same request, and return its issue number. */
    openIssue: async (title, body, ...labels) => issueWrite('openIssue', 'repository', board.repo, async () => {
      if (typeof title !== 'string' || !title || typeof body !== 'string' || !body || labels.length === 0 || labels.some((label) => typeof label !== 'string' || !label)) {
        throw new Error('requires a title, body and one or more label names');
      }
      const args = ['api', `repos/${board.repo}/issues`, '-X', 'POST', '-f', `title=${title}`, '-f', `body=${body}`, ...labels.flatMap((label) => ['-f', `labels[]=${label}`])];
      return sendIssue(args, (opened) => {
        const missing = labels.filter((name) => !opened.labels?.some((held) => sameLabel(held.name, name)));
        if (missing.length > 0) {
          throw new Error(`openIssue created issue #${opened.number} without label ${missing.join(', ')}`);
        }
        return opened.number;
      });
    }),
    /** Close one issue. */
    closeIssue: (number) => issueWrite('closeIssue', 'issue', number, async () => {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error('not an issue number');
      return sendIssue(['api', `repos/${board.repo}/issues/${number}`, '-X', 'PATCH', '-f', 'state=closed']);
    }),
    /** Remove one label from one issue. */
    removeIssueLabel: (number, label) => issueWrite('removeIssueLabel', 'issue', number, async () => {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error('not an issue number');
      if (typeof label !== 'string' || !label) throw new Error('requires one label name');
      return sendIssue(['api', `repos/${board.repo}/issues/${number}/labels/${encodeURIComponent(label)}`, '-X', 'DELETE']);
    }),
  };
}
