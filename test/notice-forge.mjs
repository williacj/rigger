// ABOUTME: An in-memory forge for the tests of a hold's notice: the reads, repository writes, board
// read and item writes L2's notice function makes, each call logged, and any one refused by name.

/**
 * An in-memory forge: `issues`, each `{ number, title, body, state, author, labels, comments }`,
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
    },
    writes: {
      openIssue: async (title, body, label) => call('openIssue', [title, body, label], () => {
        const number = newest() + 1;
        issues.push({ number, title, body, labels: [label], comments: [] });
        return number;
      }),
      postIssueComment: async (number, body) => call('postIssueComment', [number, body], () => {
        held(number).comments = [...(held(number).comments ?? []), body];
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
