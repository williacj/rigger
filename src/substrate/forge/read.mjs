// ABOUTME: The forge adapter's read side: the board's cards, columns and single-select fields, the
// repository's labels, branches, pull requests and issue edits, and the IDs a write names, each
// read through the read runner.

import { literal } from './graphql.mjs';
import { COLUMNS, DIFF_HEADER, firstLine, graphqlRequest, readRunner } from './runners.mjs';

/** The most nodes GitHub answers in one page of a connection. */
const PAGE = 100;

/**
 * The user or organisation that holds the board: the `owner` the config declares under `board`,
 * and where it declares none, the repository's owner, named before the slash in `board.repo`.
 * This is the only place the repository's owner stands in for the key (`ARCHITECTURE.md`, below
 * the extension-point table).
 */
const ownerOf = (board) => board.owner ?? board.repo.split('/')[0];

/**
 * What a failure says of a request that found the board by its owner and number, so a board gh
 * says is not there is named as the one asked for, and a wrong owner shows.
 */
const asking = (board) => `asking for ${ownerOf(board)}'s board ${board.project}, `;

/**
 * The data `gh` answered to a request made for `operation` on `board`. Where `gh` did not answer
 * 0, it throws an error naming the operation, the board number, what the request `addressed` if
 * it found the board, and the first line `gh` said.
 */
export function answerOf(operation, board, said, addressed = '') {
  if (said.status !== 0) throw new Error(`${operation} on board ${board.project} failed: ${addressed}${firstLine(said)}`);
  return JSON.parse(said.stdout).data;
}

/**
 * What `gh` answered to the read `query`, made for `operation` on `board` and sent as `via` says:
 * the read runner's `send`, `emitter` and `timeout`.
 */
const asked = async (operation, board, query, via, addressed) =>
  answerOf(operation, board, await readRunner(graphqlRequest(query), via), addressed);

/** Throws the error a read gives when the board answered something it cannot use. */
function fail(operation, board, why) {
  throw new Error(`${operation} on board ${board.project} failed: ${why}`);
}

/**
 * A query selecting `selection` on the board numbered `board.project` among the boards of its
 * owner.
 */
function boardQuery(operation, board, selection) {
  if (!Number.isInteger(board.project)) {
    throw new Error(`${operation} failed: the board number is ${board.project}, which is not a board number`);
  }
  return `query { repositoryOwner(login: ${literal(ownerOf(board))}) { ... on ProjectV2Owner { projectV2(number: ${board.project}) { ${selection} } } } }`;
}

/** A query selecting `selection` on the repository `board.repo` names as `owner/name`. */
function repositoryQuery(board, selection) {
  const [owner, name] = board.repo.split('/');
  return `query { repository(owner: ${literal(owner)}, name: ${literal(name)}) { ${selection} } }`;
}

/**
 * Every node of a connection, read a page at a time. `query` builds a page's document from its
 * `after` argument, and `connectionOf` finds the connection in what `gh` answered. A page that
 * fails fails the whole read, so no part of it is returned. `addressed` is what a failure says of
 * a read that finds the board, and is empty for one that does not.
 */
async function everyPage(operation, board, via, query, connectionOf, addressed = '') {
  const nodes = [];
  let after = '';
  for (;;) {
    const connection = connectionOf(await asked(operation, board, query(`first: ${PAGE}${after}`), via, addressed));
    if (!connection) fail(operation, board, `${addressed}gh answered no such board`);
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    after = `, after: ${literal(connection.pageInfo.endCursor)}`;
  }
}

/**
 * The board numbered `board.project` among the boards of its owner: its ID, and the ID and
 * options of its field holding the columns, each option as `{ id, name, color, description }` in
 * board order, which is all a write adding an option has to send back of it.
 */
export async function boardOf(operation, board, via) {
  const query = boardQuery(operation, board, `id field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id options { id name color description } } }`);
  const project = (await asked(operation, board, query, via, asking(board)))?.repositoryOwner?.projectV2;
  if (!project) fail(operation, board, `${asking(board)}gh answered no such board`);
  if (!project.field?.options) fail(operation, board, `the board has no single-select field named ${COLUMNS}`);
  return { id: project.id, columns: project.field };
}

/** The ID of the repository `board.repo` names as `owner/name`. */
export async function repositoryOf(operation, board, via) {
  return (await asked(operation, board, repositoryQuery(board, 'id'), via)).repository.id;
}

/** The fields of an item the read asks for: its field values, and an issue's facts. */
const ITEM = `id fieldValues(first: ${PAGE}) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: ${PAGE}) { pageInfo { hasNextPage } nodes { name } } } }`;

/**
 * Whether the repository an item read answered as `nameWithOwner` is the board's repository,
 * `board.repo`. GitHub reads an owner and repository name alike whatever their case, so the names
 * are compared that way too. Every read deciding whether an item is the repository's asks this.
 */
const ofRepository = (board, nameWithOwner) => nameWithOwner.toLowerCase() === board.repo.toLowerCase();

/**
 * Whether the item read answered `node` as a card: an issue in the board's repository. A draft
 * issue, a pull request and another repository's issue are items and not cards.
 */
const isCard = (board, { content }) => content?.__typename === 'Issue' && ofRepository(board, content.repository.nameWithOwner);

/** The option an item read's `node` holds in the single-select field named `field`, or null. */
const valueIn = (node, field) => node.fieldValues.nodes.find((value) => value.field?.name === field)?.name ?? null;

/**
 * The card an item read answered as `node`: its board item ID, which a move names, the issue's
 * number, title, body and labels, and the column, which is the option it holds in the field
 * holding the columns, or null where it holds none.
 */
function cardOf(operation, board, node) {
  const { content, fieldValues } = node;
  if (content.labels.pageInfo.hasNextPage || fieldValues.pageInfo.hasNextPage) {
    fail(operation, board, `issue #${content.number} holds more than ${PAGE} labels or field values, and a card is read whole or not at all`);
  }
  return {
    id: node.id,
    number: content.number,
    title: content.title,
    body: content.body,
    labels: content.labels.nodes.map((label) => label.name),
    column: valueIn(node, COLUMNS),
  };
}

/**
 * Every node of the board's items connection, each item selected as `item`, in board order, each
 * once. The board can change between one page and the next, so an item moved meanwhile can be
 * answered on both: it is kept where it first appeared.
 */
async function itemNodes(operation, board, via, item) {
  const query = (page) => boardQuery(operation, board, `items(${page}) { pageInfo { hasNextPage endCursor } nodes { ${item} } }`);
  const nodes = await everyPage(operation, board, via, query, (data) => data?.repositoryOwner?.projectV2?.items, asking(board));
  const seen = new Set();
  return nodes.filter((node) => !seen.has(node.id) && seen.add(node.id));
}

/** The board's item nodes that are cards, in board order, each once. */
const cardNodes = async (operation, board, via) => (await itemNodes(operation, board, via, ITEM)).filter((node) => isCard(board, node));

/**
 * What the report of other repositories selects of an item: its type, and the repository of an
 * issue or a pull request. A draft issue answers its content as an empty object, and an item the
 * reader cannot see answers the type `REDACTED` (`ProjectV2ItemType`).
 */
const OWNED_ITEM = 'id type content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } }';

/** The type GitHub gives a board item whose content the reader cannot see. */
const REDACTED = 'REDACTED';

/**
 * What the board holds that is not the repository's: `repositories`, every other repository an
 * issue or pull request on it belongs to, as `owner/name` in the order first met, and
 * `unreadable`, the count of items whose content GitHub withheld.
 */
async function otherRepositories(operation, board, via) {
  const repositories = [];
  let unreadable = 0;
  for (const { type, content } of await itemNodes(operation, board, via, OWNED_ITEM)) {
    if (type === REDACTED) unreadable += 1;
    const named = content?.repository?.nameWithOwner;
    if (named && !ofRepository(board, named) && !repositories.includes(named)) repositories.push(named);
  }
  return { repositories, unreadable };
}

/**
 * Every field on the board, whatever its type, as GitHub answers it: its `name` and `dataType`,
 * and a single-select field's `options` too. Listed rather than asked for by name, because `gh`
 * answers a field name the board does not hold by exiting 1 (measured with gh 2.99.0 on board 6,
 * 2026-09-25).
 */
function typedFields(operation, board, via) {
  const query = (page) => boardQuery(operation, board, `fields(${page}) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } }`);
  return everyPage(operation, board, via, query, (data) => data?.repositoryOwner?.projectV2?.fields, asking(board));
}

/**
 * The options of the board's single-select field named `name`, in board order. Every field is
 * read with its name and type, so a field that is not on the board and a field of another type
 * each fail the read, naming the field, and the type where it has one.
 */
async function priorityField(operation, board, via, name) {
  const field = (await typedFields(operation, board, via)).find((held) => held.name === name);
  if (!field) fail(operation, board, `the board has no field named ${name}`);
  if (!field.options) fail(operation, board, `the board's field ${name} is a ${field.dataType} field, not a single-select field`);
  return field.options.map((option) => option.name);
}

/**
 * The board's single-select fields, each as `{ name, options }` with its option names in board
 * order. A field of any other type answers as an empty object, and is left out.
 */
async function singleSelectFields(operation, board, via) {
  const query = (page) => boardQuery(operation, board, `fields(${page}) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } }`);
  return (await everyPage(operation, board, via, query, (data) => data?.repositoryOwner?.projectV2?.fields, asking(board)))
    .filter((field) => field.options)
    .map((field) => ({ name: field.name, options: field.options.map((option) => option.name) }));
}

/**
 * The reads on `board`, which names its `repo`, its `project` number, its `columns`, the display
 * names the config declares by key, and, where the config declares one, its `owner`. Every read is
 * sent through the read runner with `emitter`, the `L0` emitter its kills are recorded through, and
 * `timeout`, the runner's own where it is not given. `send` stands in for the runners' spawn in
 * tests.
 */
export function readSide(board, { send, emitter, timeout } = {}) {
  const via = { send, emitter, timeout };
  return {
    /**
     * The columns the config declares, by its keys, each the option of the field holding the
     * columns that the config names. This is where a declared column the board lacks is caught:
     * the read fails naming every one, by key and display name.
     */
    readColumns: async () => {
      const status = (await singleSelectFields('readColumns', board, via)).find((field) => field.name === COLUMNS);
      if (!status) fail('readColumns', board, `the board has no single-select field named ${COLUMNS}`);
      const missing = Object.entries(board.columns).filter(([, name]) => !status.options.includes(name));
      if (missing.length > 0) {
        const named = missing.map(([key, name]) => `${key} (${name})`).join(', ');
        fail('readColumns', board, `its ${COLUMNS} field has no option for the declared column${missing.length > 1 ? 's' : ''} ${named}`);
      }
      return { ...board.columns };
    },
    /** The board's single-select fields but the one holding the columns, as `{ name, options }`. */
    readFields: async () => (await singleSelectFields('readFields', board, via)).filter((field) => field.name !== COLUMNS),
    /** Every field on the board, whatever its type, as `{ name, type }`, the type as GitHub's `dataType` names it. */
    readFieldTypes: async () => (await typedFields('readFieldTypes', board, via)).map((field) => ({ name: field.name, type: field.dataType })),
    /** The names of the labels the board's repository holds. */
    readLabels: async () => {
      const query = (page) => repositoryQuery(board, `labels(${page}) { pageInfo { hasNextPage endCursor } nodes { name } }`);
      return (await everyPage('readLabels', board, via, query, (data) => data?.repository?.labels)).map((label) => label.name);
    },
    /**
     * What the board holds from outside the repository: every other repository whose issue or
     * pull request is on it, and how many items it holds that cannot be read. Its own read of the
     * items, so the item read `readItems` sends is left as it is.
     */
    readOtherRepositories: async () => otherRepositories('readOtherRepositories', board, via),
    /** Every card on the board, in board order, each once. */
    readItems: async () => (await cardNodes('readItems', board, via)).map((node) => cardOf('readItems', board, node)),
    /**
     * What L0 hands L3 to rank the board's cards by, from the config's priority declaration, a
     * field and its options highest rank first. It returns `items`, every card as `readItems`
     * reads it with its `priority` as `{ value, declared }`: the option it holds in the declared
     * field, or null, and whether the declaration names that option. Beside them, `declared` is
     * the declared order and `options` the field's own options in board order. Where the config
     * declares no priority, no field is read, and every card's `priority`, `declared` and
     * `options` are null.
     */
    readPriority: async () => {
      const declaration = board.priority;
      const options = declaration ? await priorityField('readPriority', board, via, declaration.field) : null;
      const priorityOf = (node) => {
        if (!declaration) return null;
        const value = valueIn(node, declaration.field);
        return { value, declared: declaration.options.includes(value) };
      };
      const items = (await cardNodes('readPriority', board, via)).map((node) => ({ ...cardOf('readPriority', board, node), priority: priorityOf(node) }));
      return { items, declared: declaration ? [...declaration.options] : null, options };
    },
  };
}

/**
 * What a failure of a repository read says it was reading: `what`, in the configured repository,
 * so a failure names the branch, issue or pull request asked for.
 */
const reading = (board, what) => `reading ${what} in ${board.repo}, `;

/**
 * `number`, where it is an issue or pull request number, or the failure of `operation`: a number
 * is written into a query and a path, so anything else is refused before a request is made.
 */
function numbered(operation, board, number) {
  if (!Number.isInteger(number) || number < 1) fail(operation, board, `${number} is not an issue or pull request number`);
  return number;
}

/** What gh answered of `field` under the repository, or the failure naming what was read. */
function heldIn(operation, board, data, field, addressed) {
  const held = data?.repository?.[field];
  if (!held) fail(operation, board, `${addressed}gh answered no ${data?.repository ? field : 'repository'}`);
  return held;
}

/**
 * What gh printed to the REST read `path` under the repository, sent with `headers`, or the
 * failure naming what was read and the first line gh said.
 */
async function restRead(operation, board, via, path, headers, addressed) {
  const said = await readRunner(['api', `repos/${board.repo}/${path}`, '-X', 'GET', ...headers], via);
  if (said.status !== 0) fail(operation, board, `${addressed}${firstLine(said)}`);
  return said.stdout;
}

/** Every REST page of a commit's checks or statuses. */
async function commitPages(operation, board, via, sha, kind, addressed) {
  const records = [];
  for (let page = 1;; page += 1) {
    const body = JSON.parse(await restRead(operation, board, via, `commits/${encodeURIComponent(sha)}/${kind}?per_page=${PAGE}&page=${page}`, [], addressed));
    const batch = kind === 'check-runs' ? body.check_runs : body;
    if (!Array.isArray(batch)) fail(operation, board, `${addressed}gh answered no ${kind}`);
    records.push(...batch);
    if (batch.length < PAGE) return records;
  }
}

/** GitHub's state of each required context at `sha`, with each commit status's creator. */
async function checkStates(board, via, sha, required, addressed) {
  const runs = await commitPages('readCheckStates', board, via, sha, 'check-runs', addressed);
  const statuses = await commitPages('readCheckStates', board, via, sha, 'statuses', addressed);
  const result = {};
  for (const { context, integration_id: pin = null } of required) {
    const matching = runs.filter((run) => run.name === context && (pin === null || run.app?.id === pin));
    const run = matching.sort((a, b) => b.id - a.id)[0];
    const status = statuses.find((record) => record.context === context);
    const runState = !run ? null : run.status !== 'completed' ? 'pending'
      : ['success', 'neutral', 'skipped'].includes(run.conclusion) ? 'passed' : 'failed';
    const statusState = !status ? null : status.state === 'success' ? 'passed'
      : status.state === 'pending' ? 'pending' : 'failed';
    const states = [runState, statusState];
    const state = states.includes('failed') ? 'failed' : states.includes('pending') ? 'pending' : states.includes('passed') ? 'passed' : 'absent';
    const prior = result[context]?.state;
    const combined = [prior, state].includes('failed') ? 'failed' : [prior, state].includes('pending') ? 'pending'
      : [prior, state].includes('absent') ? 'absent' : 'passed';
    result[context] = { state: combined, creator: status ? { login: status.creator?.login ?? null, id: status.creator?.id ?? null } : null };
  }
  return result;
}

/** Required contexts enforced on `branch` by active rulesets and classic protection. */
async function effectiveRules(board, via, branch, addressed) {
  const checks = new Map();
  const requireCheck = (context, integration) => {
    const pin = integration === -1 ? null : integration ?? null;
    const held = checks.get(context) ?? new Set();
    if (pin === null && held.size === 0) held.add(null);
    if (pin !== null) {
      held.delete(null);
      held.add(pin);
    }
    checks.set(context, held);
  };
  for (let page = 1;; page += 1) {
    const path = `rules/branches/${encodeURIComponent(branch)}?per_page=${PAGE}&page=${page}`;
    const rules = JSON.parse(await restRead('readEffectiveRules', board, via, path, [], addressed));
    if (!Array.isArray(rules)) fail('readEffectiveRules', board, `${addressed}gh answered no rules`);
    for (const rule of rules) {
      if (rule.type !== 'required_status_checks') continue;
      for (const check of rule.parameters?.required_status_checks ?? []) {
        requireCheck(check.context, check.integration_id);
      }
    }
    if (rules.length < PAGE) break;
  }
  const path = `repos/${board.repo}/branches/${encodeURIComponent(branch)}/protection`;
  const said = await readRunner(['api', path, '-X', 'GET'], via);
  if (said.status !== 0 && !/Branch not protected \(HTTP 404\)/.test(firstLine(said))) {
    fail('readEffectiveRules', board, `${addressed}${firstLine(said)}`);
  }
  if (said.status === 0) {
    const classic = JSON.parse(said.stdout).required_status_checks;
    for (const check of classic?.checks ?? []) {
      requireCheck(check.context, check.app_id);
    }
    for (const context of classic?.contexts ?? []) {
      requireCheck(context, null);
    }
  }
  return [...checks].flatMap(([context, pins]) => [...pins].map((integration_id) => ({ context, integration_id })));
}

/**
 * What `read` answers, or a failure naming `operation`, what was `addressed` and why: a failure
 * the read gave already names them, and any other, such as a request that never reached `gh` or
 * an answer that is not JSON, is given them, keeping its `code` and carrying it as its cause.
 */
async function labelled(operation, board, addressed, read) {
  try {
    return await read();
  } catch (error) {
    const named = `${operation} on board ${board.project} failed: `;
    if (error.message.startsWith(named)) throw error;
    const failure = new Error(`${named}${addressed}${error.message}`, { cause: error });
    if (error.code !== undefined) failure.code = error.code;
    throw failure;
  }
}

/** A pull request as the reads answer it: its number, head SHA and base branch. */
const pullRequestOf = ({ number, headRefOid, baseRefName }) => ({ number, head: headRefOid, base: baseRefName });

/**
 * The reads of a card's facts held in the repository `board.repo` names: its line of work's
 * branch and pull requests, a pull request's diff, merge base and comments, and an issue's last
 * edit. Each is sent through the read runner, as `readSide`'s reads are, with `send`, `emitter`
 * and `timeout`. Each is given what it reads, and what a failure says it was reading. A read that
 * fails rejects naming what it read and why, and never answers none in its place.
 */
const REPOSITORY_READS = {
  /**
   * The pull requests whose head is `branch` in the repository, as `{ open, merged }`, each a list
   * of `{ number, head, base }` in the order gh answers them. A fork's branch of the same name is
   * another repository's, and is left out.
   */
  readPullRequests: {
    reading: (branch) => `the pull requests from branch ${branch}`,
    read: async (board, via, branch, addressed) => {
      const query = (page) => repositoryQuery(board, `pullRequests(headRefName: ${literal(branch)}, states: [OPEN, MERGED], ${page}) { pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } } }`);
      const nodes = (await everyPage('readPullRequests', board, via, query, (data) => heldIn('readPullRequests', board, data, 'pullRequests', addressed), addressed))
        .filter((node) => node.headRepository && ofRepository(board, node.headRepository.nameWithOwner));
      const inState = (state) => nodes.filter((node) => node.state === state).map(pullRequestOf);
      return { open: inState('OPEN'), merged: inState('MERGED') };
    },
  },
  /**
   * For each of `names`, whether the repository holds a branch of that name, as an object keyed by
   * name, read from the repository's branches a page at a time.
   */
  readBranches: {
    reading: (names) => `the branches ${names.join(', ')}`,
    read: async (board, via, names, addressed) => {
      const query = (page) => repositoryQuery(board, `refs(refPrefix: "refs/heads/", ${page}) { pageInfo { hasNextPage endCursor } nodes { name } }`);
      const held = new Set((await everyPage('readBranches', board, via, query, (data) => heldIn('readBranches', board, data, 'refs', addressed), addressed)).map((ref) => ref.name));
      return Object.fromEntries(names.map((name) => [name, held.has(name)]));
    },
  },
  /**
   * Pull request `number`'s diff, as the forge serves it under the diff's media type. A diff the
   * forge declines to serve rejects with the forge's reason.
   */
  readDiff: {
    reading: (number) => `pull request #${number}'s diff`,
    read: (board, via, number, addressed) => restRead('readDiff', board, via, `pulls/${numbered('readDiff', board, number)}`, ['-H', DIFF_HEADER], addressed),
  },
  /**
   * The merge base the forge computes pull request `number`'s diff from, as `{ base, head,
   * mergeBase }`: its base branch and head SHA, read first, and the merge base of the two the
   * forge's comparison answers, which is what a pull request's diff is taken against.
   */
  readMergeBase: {
    reading: (number) => `pull request #${number}'s merge base`,
    read: async (board, via, number, addressed) => {
      const query = repositoryQuery(board, `pullRequest(number: ${numbered('readMergeBase', board, number)}) { baseRefName headRefOid }`);
      const { baseRefName: base, headRefOid: head } = heldIn('readMergeBase', board, await asked('readMergeBase', board, query, via, addressed), 'pullRequest', addressed);
      const compared = JSON.parse(await restRead('readMergeBase', board, via, `compare/${base}...${head}`, [], addressed));
      const mergeBase = compared?.merge_base_commit?.sha;
      if (!mergeBase) fail('readMergeBase', board, `${addressed}gh answered no merge base`);
      return { base, head, mergeBase };
    },
  },
  /** The forge's current mergeability answer for pull request `number`. */
  readMergeable: {
    reading: (number) => `pull request #${number}'s mergeability`,
    read: async (board, via, number, addressed) => {
      const query = repositoryQuery(board, `pullRequest(number: ${numbered('readMergeable', board, number)}) { mergeable }`);
      const pull = heldIn('readMergeable', board, await asked('readMergeable', board, query, via, addressed), 'pullRequest', addressed);
      const states = { MERGEABLE: 'mergeable', CONFLICTING: 'conflicting', UNKNOWN: 'unknown' };
      if (!Object.hasOwn(states, pull.mergeable)) fail('readMergeable', board, `${addressed}gh answered mergeable ${pull.mergeable}`);
      return states[pull.mergeable];
    },
  },
  /** Every comment on pull request `number`, oldest first, with its author, edit and permission. */
  readComments: {
    reading: (number) => `pull request #${number}'s comments`,
    read: async (board, via, number, addressed) => {
      const query = (page) => repositoryQuery(board, `pullRequest(number: ${numbered('readComments', board, number)}) { comments(${page}) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } }`);
      const nodes = await everyPage('readComments', board, via, query, (data) => heldIn('readComments', board, data, 'pullRequest', addressed).comments, addressed);
      const permissions = new Map();
      const permissionOf = async (author) => {
        if (author === null) return 'none';
        if (!permissions.has(author)) {
          const path = `repos/${board.repo}/collaborators/${encodeURIComponent(author)}/permission`;
          permissions.set(author, (async () => {
            const said = await readRunner(['api', path, '-X', 'GET'], via);
            if (said.status !== 0) {
              if (/\b404\b/.test(firstLine(said))) return 'none';
              fail('readComments', board, `${addressed}permission for ${author}: ${firstLine(said)}`);
            }
            const role = JSON.parse(said.stdout).role_name;
            if (typeof role !== 'string') fail('readComments', board, `${addressed}permission for ${author}: gh answered no role_name`);
            return role;
          })());
        }
        return permissions.get(author);
      };
      const comments = [];
      for (const node of nodes) {
        const author = node.author?.login ?? null;
        comments.push({ body: node.body, createdAt: node.createdAt, id: node.id, author, permission: await permissionOf(author), edited: node.lastEditedAt != null || node.includesCreatedEdit === true });
      }
      return comments;
    },
  },
};

/**
 * `REPOSITORY_READS` on `board`, each taking what it reads, sent as `send`, `emitter` and
 * `timeout` say.
 */
export function repositoryReads(board, { send, emitter, timeout } = {}) {
  const via = { send, emitter, timeout };
  const reads = Object.fromEntries(Object.entries(REPOSITORY_READS).map(([operation, { reading: what, read }]) => [
    operation,
    (target) => {
      const addressed = reading(board, what(target));
      return labelled(operation, board, addressed, () => read(board, via, target, addressed));
    },
  ]));
  reads.readCheckStates = (sha, required) => {
    const addressed = reading(board, `checks at ${sha}`);
    return labelled('readCheckStates', board, addressed, () => checkStates(board, via, sha, required, addressed));
  };
  reads.readEffectiveRules = (branch) => {
    const addressed = reading(board, `effective rules for branch ${branch}`);
    return labelled('readEffectiveRules', board, addressed, () => effectiveRules(board, via, branch, addressed));
  };
  return reads;
}
