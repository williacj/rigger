// ABOUTME: The forge adapter's repository-write side: head-guarded merges and comments on pull
// requests, sent through its own runner. Only L2 reaches it.

import { firstLine, readRunner, repositoryWriteRunner } from './runners.mjs';

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

export function repositoryWriteSide(board, { send, emitter, timeout } = {}) {
  const via = { send, emitter, timeout };
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
      const said = await repositoryWriteRunner(args, via);
      if (said.timedOut) throw new Error(`mergePullRequest #${number} failed: ${firstLine(said)}`);
      if (said.status === 0) {
        const body = JSON.parse(said.stdout);
        if (body.merged === true) return { outcome: pull.merged ? 'already merged' : 'merged', sha: body.sha };
      }
      const { status, message } = refusal(said);
      const mapped = mergeRefusal(status, message);
      if (mapped) return { outcome: 'refused', ...mapped };
      if (status === 405) return { outcome: 'refused', reason: 'unclassified', status, message };
      throw new Error(`mergePullRequest #${number} failed: ${Number.isFinite(status) ? `HTTP ${status} ` : ''}${message}`);
    },
    /** Post `body` on a pull request, refusing an issue number that is not a pull request. */
    postComment: async (number, body) => {
      const args = ['api', `repos/${board.repo}/issues/${number}/comments`, '-X', 'POST', '-f', `body=${body}`];
      const said = await repositoryWriteRunner(args, via);
      if (said.status !== 0 || said.timedOut) throw new Error(`postComment on pull request #${number} failed: ${firstLine(said)}`);
      return JSON.parse(said.stdout);
    },
  };
}
