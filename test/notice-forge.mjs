// ABOUTME: An in-memory forge for the tests of a hold's notice: the reads, repository writes, board
// read and item writes L2's notice function makes, each call logged, and any one refused by name;
// and, for `rigger resume`'s close, a consumer config and a stand-in `gh` holding its issues.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { consumerConfig } from './verb-consumer.mjs';

/** The time every timeline entry here carries: the timeline's order is what it models. */
const AT = '2026-10-01T00:00:00Z';

/** A comment by the engine's account, which holds write access, as the timeline read answers it. */
const comment = (body) => ({ kind: 'comment', body, createdAt: AT, id: `IC_${body.length}`, author: 'rigger-bot', permission: 'write', edited: false });

/**
 * Issue `issue`'s timeline as the timeline read answers it: its own `timeline` where it was given
 * or a write has begun one, and otherwise a label event for each label it carries, as at its
 * opening, then a comment for each of its comments.
 */
const timelineOf = (issue) => structuredClone(issue.timeline ?? [
  ...issue.labels.map((label) => ({ kind: 'labeled', createdAt: AT, actor: 'rigger-bot', label })),
  ...(issue.comments ?? []).map(comment),
]);

/**
 * An in-memory forge: `issues`, each `{ number, title, body, state, author, labels, comments, timeline }`,
 * `pulls`, the numbers pull requests hold, and `items`, the board's, each `{ id, number, column }`,
 * held as `onBoard`.
 * `refuse` names calls that throw, by name, and `permissions` the role each login holds. Every call
 * is logged, in order, by name and argument.
 */
export function forge({ issues = [], pulls = [], items = [], refuse = {}, permissions = {} } = {}) {
  const calls = [];
  const call = (name, args, act) => {
    calls.push([name, ...args]);
    if (refuse[name]) throw new Error(refuse[name]);
    return act();
  };
  const held = (number) => issues.find((issue) => issue.number === number);
  const newest = () => Math.max(0, ...issues.map(({ number }) => number), ...pulls);
  return {
    calls,
    issues,
    onBoard: items,
    reads: {
      readIssue: async (number) => call('readIssue', [number], () => {
        const issue = held(number);
        return issue === undefined ? null : { number, title: issue.title, body: issue.body, state: issue.state ?? 'open', author: issue.author === undefined ? 'rigger-bot' : issue.author, labels: [...issue.labels] };
      }),
      readLabelledIssues: async (label) => call('readLabelledIssues', [label], () => issues.filter((issue) => (issue.state ?? 'open') === 'open' && issue.labels.includes(label)).map(({ number }) => number)),
      readNewestNumber: async () => call('readNewestNumber', [], newest),
      readPermission: async (login) => call('readPermission', [login], () => permissions[login] ?? 'write'),
      readIssueTimeline: async (number) => call('readIssueTimeline', [number], () => timelineOf(held(number))),
    },
    writes: {
      openIssue: async (title, body, label) => call('openIssue', [title, body, label], () => {
        const number = newest() + 1;
        issues.push({ number, title, body, labels: [label], comments: [] });
        return number;
      }),
      postIssueComment: async (number, body) => call('postIssueComment', [number, body], () => {
        held(number).comments = [...(held(number).comments ?? []), body];
        held(number).timeline?.push(comment(body));
      }),
      removeIssueLabel: async (number, label) => call('removeIssueLabel', [number, label], () => {
        held(number).timeline ??= timelineOf(held(number));
        held(number).labels = held(number).labels.filter((name) => name !== label);
        held(number).timeline.push({ kind: 'unlabeled', createdAt: AT, actor: 'rigger-bot', label });
      }),
      closeIssue: async (number) => call('closeIssue', [number], () => {
        held(number).timeline ??= timelineOf(held(number));
        held(number).state = 'closed';
        held(number).timeline.push({ kind: 'closed', createdAt: AT, actor: 'rigger-bot' });
      }),
    },
    board: { readItems: async () => call('readItems', [], () => structuredClone(items)) },
    items: {
      addIssue: async (number) => call('addIssue', [number], () => {
        const id = `item-${number}`;
        items.push({ id, number, column: null });
        return id;
      }),
      moveItem: async (id, column) => call('moveItem', [id, column], () => {
        items.find((item) => item.id === id).column = column;
      }),
    },
  };
}

/**
 * Repository writes that refuse each write a hold's notice makes, naming it, for a world whose
 * subject is not the notice: its notice then ends at the first write with `notice.failed`, and no
 * write reaches `gh`.
 */
export const refusingWrites = () => Object.fromEntries(['openIssue', 'postIssueComment', 'addIssueLabel', 'closeIssue', 'removeIssueLabel', 'postComment', 'mergePullRequest']
  .map((name) => [name, async () => { throw new Error(`this world's forge refuses ${name}`); }]));

/**
 * Writes the verb consumer's config into `repository`, so `rigger resume`, which reads it only once
 * it has removed a closer, reaches L2's notice function for its close.
 */
export const configure = (repository) => writeFileSync(join(repository, 'rigger.config.mjs'), `export default ${JSON.stringify(consumerConfig(1))};\n`);

/**
 * A spawn standing in for `gh` under `rigger resume`'s close, over `issues`, each `{ number, state,
 * labels, repository }` as GitHub holds it, `state` open where none is given and `repository` this
 * one where none is given. It answers the four requests the close makes, each shaped as gh prints
 * it for the read side and the repository-write side: the read of the open issues carrying a
 * label, the read of one issue, a label's removal and a close, the last two changing what it holds.
 * `refuse(args)` names a request it refuses, answering what gh says for it, and any request it does
 * not model it refuses, naming it. Each request is kept in `sent`, and the issues it holds in `issues`.
 */
export function statusGh({ issues = [], refuse = () => undefined } = {}) {
  const held = structuredClone(issues).map((issue) => ({ state: 'open', repository: 'acme/widgets', title: 'T', body: '', ...issue }));
  const sent = [];
  const printed = (data) => ({ status: 0, stdout: `${JSON.stringify({ data })}\n`, stderr: '' });
  const notFound = (number) => ({ status: 1, stdout: JSON.stringify({ data: { repository: { issue: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'issue'], message: `Could not resolve to an Issue with the number of ${number}.` }] }), stderr: `gh: Could not resolve to an Issue with the number of ${number}.\n` });
  const answer = (args) => {
    const [, path, , method] = args;
    if (path === 'graphql') {
      const query = args[3];
      const label = /issues\(states: \[OPEN\], labels: \["([^"]+)"\]/.exec(query)?.[1];
      if (label !== undefined) {
        const nodes = held.filter((issue) => issue.state === 'open' && issue.repository === 'acme/widgets' && issue.labels.includes(label)).map(({ number }) => ({ number }));
        return printed({ repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
      }
      const number = Number(/issue\(number: ([0-9]+)\) \{ number /.exec(query)?.[1]);
      const issue = held.find((each) => each.number === number);
      if (!Number.isInteger(number)) return undefined;
      if (issue === undefined) return notFound(number);
      return printed({ repository: { issue: { number, title: issue.title, body: issue.body, state: issue.state.toUpperCase(), author: { login: 'rigger-bot' }, repository: { nameWithOwner: issue.repository }, labels: { pageInfo: { hasNextPage: false, endCursor: 'MQ' }, nodes: issue.labels.map((name) => ({ name })) } } } });
    }
    const [, number, , label] = /^repos\/acme\/widgets\/issues\/([0-9]+)(\/labels\/(.+))?$/.exec(path) ?? [];
    const issue = held.find((each) => each.number === Number(number));
    if (issue === undefined) return undefined;
    if (method === 'DELETE' && label !== undefined) {
      const name = decodeURIComponent(label);
      if (!issue.labels.includes(name)) return { status: 1, stdout: '', stderr: 'gh: Label does not exist (HTTP 404)\n' };
      issue.labels = issue.labels.filter((each) => each !== name);
      return { status: 0, stdout: JSON.stringify(issue.labels.map((each) => ({ name: each }))), stderr: '' };
    }
    if (method === 'PATCH' && args.includes('state=closed')) {
      issue.state = 'closed';
      return { status: 0, stdout: JSON.stringify({ number: issue.number, state: 'closed' }), stderr: '' };
    }
    return undefined;
  };
  const send = (command, args) => {
    sent.push([command, ...args]);
    return refuse(args) ?? answer(args) ?? { status: 1, stdout: '', stderr: `this stand-in for gh answers no ${args.join(' ')}\n` };
  };
  return Object.assign(send, { sent, issues: held });
}
