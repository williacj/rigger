// ABOUTME: The gh and board contract cases `D29` rule 12 ties the fake gh and the fake board to real
// gh with: each case runs against the fake in the deterministic tier and against real gh on opt-in.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import config from '../rigger.config.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { FORGE_TIMEOUT, readRunner } from '../src/substrate/forge/runners.mjs';

/** What precedes the document in a GraphQL request, as the fake gh's `commandOf` writes one. */
const GRAPHQL = 'gh api graphql -f query=';

/** The REST methods that change what the forge holds. */
const REST_WRITES = ['POST', 'PATCH', 'PUT', 'DELETE'];

/** The agent subcommands, by `gh pr` subcommand, that read and that write. */
const AGENT = { view: 'read', diff: 'read', create: 'write', comment: 'write' };

/**
 * The class of `command`, a command as the fake gh's `commandOf` writes it: `read` where it changes
 * nothing on the forge, `write` where it does, and null where it is neither or cannot be read. A
 * GraphQL request is its operations' type; a REST request under `repos/` its one named method, as
 * the read runner admits only a named GET; an agent command its `gh pr` subcommand.
 */
export function classify(command) {
  if (command.startsWith(GRAPHQL)) {
    let types;
    try {
      types = parseDocument(command.slice(GRAPHQL.length)).operations.map((operation) => operation.type);
    } catch {
      return null;
    }
    if (types.length > 0 && types.every((type) => type === 'query')) return 'read';
    if (types.length > 0 && types.every((type) => type === 'mutation')) return 'write';
    return null;
  }
  const words = command.split(' ');
  if (words[0] !== 'gh') return null;
  if (words[1] === 'api' && words[2]?.startsWith('repos/')) {
    const methods = words.flatMap((word, index) => (word === '-X' ? [words[index + 1]] : []));
    if (methods.length !== 1) return null;
    if (methods[0] === 'GET') return 'read';
    return REST_WRITES.includes(methods[0]) ? 'write' : null;
  }
  if (words[1] === 'pr') return Object.hasOwn(AGENT, words[2]) ? AGENT[words[2]] : null;
  return null;
}

/**
 * The board and repository both sides read: this repository's own config, `williacj/rigger` and its
 * board 6. The real side reads them read-only (owner ruling U183, #739), so a case ties a value only
 * where it reads a state that does not change.
 */
export const BOARD = { repo: config.repo, ...config.board };

/** The label a card of kind `change` carries, which the live repository holds (`rigger.config.mjs`). */
const LABEL = config.kinds.change.select.labels[0];

/**
 * The live repository's facts that do not change, which the fake is seeded with too. Measured with
 * gh 2.98.0 on 2026-11-08: pull request #1202 is merged from `rigger-1194` into `main` at
 * `d902e65c`, with merge commit `f3769f24`, and is the only pull request from that branch; issue
 * #1194 is closed; `.npmrc` at `52fb8a3d` is a 202-byte regular file; `williacj` holds `admin`;
 * environment `gate` holds variable `GATE_APP_ID` and secret `GATE_APP_PRIVATE_KEY`; `main` has no
 * classic branch protection.
 */
export const FACTS = {
  pull: { number: 1202, branch: 'rigger-1194', head: 'd902e65cecf9ff58de29e48bb55d714704c885ae', base: 'main', mergeCommit: 'f3769f2482ef8cbffb573ee427fd112e68d2515f' },
  issue: { number: 1194 },
  missing: 999999,
  file: {
    commit: '52fb8a3d15a7f6842436a7295edb52c4b7a4ad35',
    path: '.npmrc',
    mode: 0o100644,
    text: '# ABOUTME: npm settings for this repository. engine-strict turns the Node floor in package.json\n# from a warning into a refusal, so an install under an older Node fails and names it.\nengine-strict=true\n',
  },
  login: { name: 'williacj', role: 'admin' },
  environment: { name: 'gate', variable: 'GATE_APP_ID', secret: 'GATE_APP_PRIVATE_KEY' },
  label: LABEL,
};

/** What a form check says of a value at `path` that does not have the form. */
function unlike(path, why) {
  throw new assert.AssertionError({ message: `${path || 'the answer'}: ${why}` });
}

/** A form: a check of a value at a path. Each below is one. */
const str = (value, path) => typeof value === 'string' || unlike(path, `${JSON.stringify(value)} is not a string`);
const num = (value, path) => typeof value === 'number' || unlike(path, `${JSON.stringify(value)} is not a number`);
const bool = (value, path) => typeof value === 'boolean' || unlike(path, `${JSON.stringify(value)} is not a boolean`);
const nul = (value, path) => value === null || unlike(path, `${JSON.stringify(value)} is not null`);
const exactly = (expected) => (value, path) => {
  try {
    assert.deepEqual(value, expected);
  } catch {
    unlike(path, `${JSON.stringify(value)} is not ${JSON.stringify(expected)}`);
  }
};
const sha = (value, path) => (typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)) || unlike(path, `${JSON.stringify(value)} is not a full SHA`);

/**
 * An object holding `fields`, each of its form. A GraphQL answer holds exactly what its selection
 * names, so an object holds no other key; a REST answer is `open`, holding more than the fields the
 * fake gives, as GitHub answers every REST resource whole.
 */
const obj = (fields, { open = false } = {}) => (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unlike(path, `${JSON.stringify(value)} is not an object`);
  const extra = Object.keys(value).filter((key) => !Object.hasOwn(fields, key));
  const missing = Object.keys(fields).filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) unlike(path, `holds no ${missing.join(', ')}`);
  if (!open && extra.length > 0) unlike(path, `holds ${extra.join(', ')}, which the selection does not name`);
  for (const [key, form] of Object.entries(fields)) form(value[key], `${path}.${key}`);
};
const rest = (fields) => obj(fields, { open: true });

/** A list of at least `min` elements, each of `form`. */
const list = (form, { min = 0 } = {}) => (value, path) => {
  if (!Array.isArray(value)) unlike(path, `${JSON.stringify(value)} is not a list`);
  if (value.length < min) unlike(path, `holds ${value.length} elements, fewer than ${min}`);
  value.forEach((element, index) => form(element, `${path}[${index}]`));
};

/** A value of one of `forms`. */
const either = (...forms) => (value, path) => {
  const misses = [];
  for (const form of forms) {
    try {
      form(value, path);
      return;
    } catch (miss) {
      misses.push(miss.message);
    }
  }
  unlike(path, `matches none of its forms: ${misses.join('; ')}`);
};

/** Asserts `value` has `form`. */
const tie = (value, form) => form(value, '');

/** A page of a connection, of nodes of `node`, holding at least `min`. */
const PAGE_INFO = obj({ hasNextPage: bool, endCursor: either(str, nul) });
const page = (node, min = 0) => obj({ pageInfo: PAGE_INFO, nodes: list(node, { min }) });

/** The GraphQL data under the board, and under the repository, holding `fields`. */
const onBoard = (fields) => obj({ repositoryOwner: obj({ projectV2: obj(fields) }) });
const onRepository = (fields) => obj({ repository: obj(fields) });

/** A GraphQL value written as the adapter writes one. */
const quoted = (value) => JSON.stringify(String(value));

/** A `gh api graphql` request carrying `document`, as the adapter's runners send one. */
const graphql = (document) => ['api', 'graphql', '-f', `query=${document}`];

/** A board query selecting `selection`, and a repository query, written as `read.mjs` writes each. */
const boardQuery = (target, selection) => `query { repositoryOwner(login: ${quoted(target.repo.split('/')[0])}) { ... on ProjectV2Owner { projectV2(number: ${target.project}) { ${selection} } } } }`;
const repositoryQuery = (target, selection) => {
  const [owner, name] = target.repo.split('/');
  return `query { repository(owner: ${quoted(owner)}, name: ${quoted(name)}) { ${selection} } }`;
};

/** The data a GraphQL answer printed, where gh answered 0, of `form`. */
function data(answer, form) {
  assert.equal(answer.status, 0, `gh answered ${answer.status}: ${answer.stderr}`);
  const printed = JSON.parse(answer.stdout);
  tie(printed, obj({ data: form }));
  return printed.data;
}

/** The JSON a REST answer printed, where gh answered 0, of `form`. */
function printed(answer, form) {
  assert.equal(answer.status, 0, `gh answered ${answer.status}: ${answer.stderr}`);
  const body = JSON.parse(answer.stdout);
  tie(body, form);
  return body;
}

/**
 * What gh answers where GitHub resolves nothing at `path` in a GraphQL read: exit 1, the response
 * on stdout holding `data` and a `NOT_FOUND` error at that path, and its message on stderr.
 */
function unresolved(answer, dataForm, path) {
  assert.equal(answer.status, 1, `gh answered ${answer.status}`);
  const body = JSON.parse(answer.stdout);
  const error = obj({ type: exactly('NOT_FOUND'), path: exactly(path), locations: list(obj({ line: num, column: num })), message: str });
  tie(body, obj({ data: dataForm, errors: list(error, { min: 1 }) }));
  assert.equal(answer.stderr.split('\n')[0], `gh: ${body.errors[0].message}`);
}

/**
 * A connection read one page of one node at a time, twice: the first page, and the page after the
 * cursor the first answered, so a cursor the answer gives is one the request for it accepts.
 * `query` builds the document from its page arguments, `form` is the data's form given the
 * connection's, and `at` finds the connection in the data. It returns the first page.
 */
async function paged(ask, query, form, at, node) {
  const first = at(data(await ask(graphql(query('first: 1'))), form(page(node, 1))));
  at(data(await ask(graphql(query(`first: 1, after: ${quoted(first.pageInfo.endCursor)}`))), form(page(node))));
  return first;
}

/** What a comment read selects of each comment. */
const COMMENT_FIELDS = 'body createdAt id author { login } lastEditedAt includesCreatedEdit';
const COMMENT = { body: str, createdAt: str, id: str, author: either(nul, obj({ login: str })), lastEditedAt: either(str, nul), includesCreatedEdit: bool };

/** What the item read selects of an item, and the form of each. */
const ITEM = 'id fieldValues(first: 100) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 100) { pageInfo { hasNextPage } nodes { name } } } }';
const ITEM_NODE = obj({
  id: str,
  // A value of a field of another type matches no fragment, and answers as an empty object.
  fieldValues: obj({ pageInfo: obj({ hasNextPage: bool }), nodes: list(either(obj({}), obj({ name: str, field: obj({ name: str }) }))) }),
  content: either(
    nul,
    obj({ __typename: exactly('DraftIssue') }),
    obj({ __typename: exactly('PullRequest') }),
    obj({ __typename: exactly('Issue'), number: num, title: str, body: str, repository: obj({ nameWithOwner: str }), labels: obj({ pageInfo: obj({ hasNextPage: bool }), nodes: list(obj({ name: str })) }) }),
  ),
});

/** What the report of other repositories selects of an item, and its form. */
const OWNED_ITEM = 'id type content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } }';
const OWNED_NODE = obj({
  id: str,
  type: either(exactly('ISSUE'), exactly('PULL_REQUEST'), exactly('DRAFT_ISSUE'), exactly('REDACTED')),
  content: either(nul, obj({}), obj({ repository: obj({ nameWithOwner: str }) })),
});

/** What the typed field read selects of a field, and its form. */
const TYPED_FIELD = '... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } }';
const TYPED_NODE = either(obj({ name: str, dataType: str }), obj({ name: str, dataType: str, options: list(obj({ name: str })) }));

/** The Status field as the board read selects it: its ID and its options' IDs, names, colours and descriptions. */
const STATUS = `id field(name: ${quoted('Status')}) { ... on ProjectV2SingleSelectField { id options { id name color description } } }`;
const OPTION = obj({ id: str, name: str, color: str, description: str });
const STATUS_DATA = onBoard({ id: str, field: obj({ id: str, options: list(OPTION, { min: 1 }) }) });

/** What the timeline read selects of each entry, and the form of each. */
const TIMELINE = `__typename ... on IssueComment { ${COMMENT_FIELDS} } ... on LabeledEvent { createdAt actor { login } label { name } } ... on UnlabeledEvent { createdAt actor { login } label { name } } ... on ClosedEvent { createdAt actor { login } } ... on ReopenedEvent { createdAt actor { login } }`;
const ACTOR = either(nul, obj({ login: str }));
const TIMELINE_NODE = either(
  obj({ __typename: exactly('IssueComment'), ...COMMENT }),
  obj({ __typename: exactly('LabeledEvent'), createdAt: str, actor: ACTOR, label: obj({ name: str }) }),
  obj({ __typename: exactly('UnlabeledEvent'), createdAt: str, actor: ACTOR, label: obj({ name: str }) }),
  obj({ __typename: exactly('ClosedEvent'), createdAt: str, actor: ACTOR }),
  obj({ __typename: exactly('ReopenedEvent'), createdAt: str, actor: ACTOR }),
);

/** The issue read's selection given its labels' page arguments. */
const ISSUE = (number, labelPage) => `issue(number: ${number}) { number title body state author { login } repository { nameWithOwner } labels(${labelPage}) { pageInfo { hasNextPage endCursor } nodes { name } } }`;

/** A REST read under the repository, with an explicit GET, as the read runner admits one. */
const restGet = (target, path, ...headers) => ['api', `repos/${target.repo}/${path}`, '-X', 'GET', ...headers];

/** The header asking GitHub for a pull request's diff. */
const DIFF = 'Accept: application/vnd.github.diff';

/** The lines `gh pr view` prints of a pull request to a reader that is not a terminal, in order. */
const VIEW_LINES = ['title', 'state', 'author', 'labels', 'assignees', 'reviewers', 'projects', 'milestone', 'number', 'url', 'additions', 'deletions', 'auto-merge'];

/**
 * The gh contract cases: each a `name` and a `run` given `ask`, which sends one command and hands
 * back what gh answered as `{ status, stdout, stderr }`, and the `target` read. Every command a case
 * sends is a read (rule 12.4); each ties the answer's form, and its value where the state it reads
 * does not change (rule 12.2).
 */
export const GH_CASES = [
  {
    name: 'the board item read, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => boardQuery(target, `items(${args}) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`), (items) => onBoard({ items }), (held) => held.repositoryOwner.projectV2.items, ITEM_NODE),
  },
  {
    name: 'the other-repository item read, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => boardQuery(target, `items(${args}) { pageInfo { hasNextPage endCursor } nodes { ${OWNED_ITEM} } }`), (items) => onBoard({ items }), (held) => held.repositoryOwner.projectV2.items, OWNED_NODE),
  },
  {
    name: 'the single-select field read',
    run: async (ask, target) => {
      const held = data(await ask(graphql(boardQuery(target, 'fields(first: 100) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } }'))),
        onBoard({ fields: page(either(obj({}), obj({ name: str, options: list(obj({ name: str })) })), 1) }));
      assert.ok(held.repositoryOwner.projectV2.fields.nodes.some((field) => field.name === 'Status'), 'the board answers no Status field');
    },
  },
  {
    name: 'the typed field read, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => boardQuery(target, `fields(${args}) { pageInfo { hasNextPage endCursor } nodes { ${TYPED_FIELD} } }`), (fields) => onBoard({ fields }), (held) => held.repositoryOwner.projectV2.fields, TYPED_NODE),
  },
  {
    name: 'the label read, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `labels(${args}) { pageInfo { hasNextPage endCursor } nodes { name } }`), (labels) => onRepository({ labels }), (held) => held.repository.labels, obj({ name: str })),
  },
  {
    name: 'the repository ID read',
    run: async (ask, target) => {
      data(await ask(graphql(repositoryQuery(target, 'id'))), onRepository({ id: str }));
    },
  },
  {
    name: 'the board ID and Status field read',
    run: async (ask, target) => {
      const held = data(await ask(graphql(boardQuery(target, STATUS))), STATUS_DATA);
      const names = held.repositoryOwner.projectV2.field.options.map((option) => option.name);
      assert.deepEqual(Object.values(target.columns).filter((name) => !names.includes(name)), [], 'the Status field lacks a declared column');
    },
  },
  {
    name: 'the schema-write side reads the Status field by the ID the board read answers',
    run: async (ask, target) => {
      const { field } = data(await ask(graphql(boardQuery(target, STATUS))), STATUS_DATA).repositoryOwner.projectV2;
      const held = data(await ask(graphql(`query { field: node(id: ${quoted(field.id)}) { ... on ProjectV2SingleSelectField { name options { id name color description } } } }`)),
        obj({ field: obj({ name: exactly('Status'), options: list(OPTION, { min: 1 }) }) }));
      assert.deepEqual(held.field.options, field.options);
    },
  },
  {
    name: 'the item-write side reads the board and the field by the IDs the board read answers',
    run: async (ask, target) => {
      const { id, field } = data(await ask(graphql(boardQuery(target, STATUS))), STATUS_DATA).repositoryOwner.projectV2;
      const held = data(await ask(graphql(`query { project: node(id: ${quoted(id)}) { ... on ProjectV2 { field(name: ${quoted('Status')}) { ... on ProjectV2SingleSelectField { id } } } } target: node(id: ${quoted(field.id)}) { ... on ProjectV2FieldCommon { name } } }`)),
        obj({ project: obj({ field: obj({ id: exactly(field.id) }) }), target: obj({ name: exactly('Status') }) }));
      assert.ok(held);
    },
  },
  {
    name: 'the pull requests from a branch, a page and the page after it',
    run: async (ask, target) => {
      const node = obj({ number: num, state: str, headRefOid: sha, baseRefName: str, headRepository: either(nul, obj({ nameWithOwner: str })) });
      const first = await paged(ask, (args) => repositoryQuery(target, `pullRequests(headRefName: ${quoted(FACTS.pull.branch)}, states: [OPEN, MERGED, CLOSED], ${args}) { pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } } }`),
        (pullRequests) => onRepository({ pullRequests }), (held) => held.repository.pullRequests, node);
      assert.deepEqual(first.nodes, [{ number: FACTS.pull.number, state: 'MERGED', headRefOid: FACTS.pull.head, baseRefName: FACTS.pull.base, headRepository: { nameWithOwner: target.repo } }]);
    },
  },
  {
    name: 'the branch read, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `refs(refPrefix: "refs/heads/", ${args}) { pageInfo { hasNextPage endCursor } nodes { name } }`), (refs) => onRepository({ refs }), (held) => held.repository.refs, obj({ name: str })),
  },
  {
    name: 'a pull request\'s comments, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `pullRequest(number: ${FACTS.pull.number}) { comments(${args}) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } }`),
      (comments) => onRepository({ pullRequest: obj({ comments }) }), (held) => held.repository.pullRequest.comments, obj(COMMENT)),
  },
  {
    name: 'an issue\'s comments, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `issue(number: ${FACTS.issue.number}) { comments(${args}) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } }`),
      (comments) => onRepository({ issue: obj({ comments }) }), (held) => held.repository.issue.comments, obj(COMMENT)),
  },
  {
    name: 'a pull request\'s base branch and head',
    run: async (ask, target) => {
      const held = data(await ask(graphql(repositoryQuery(target, `pullRequest(number: ${FACTS.pull.number}) { baseRefName headRefOid }`))), onRepository({ pullRequest: obj({ baseRefName: str, headRefOid: sha }) }));
      assert.deepEqual(held.repository.pullRequest, { baseRefName: FACTS.pull.base, headRefOid: FACTS.pull.head });
    },
  },
  {
    name: 'a pull request by its number',
    run: async (ask, target) => {
      const held = data(await ask(graphql(repositoryQuery(target, `pullRequest(number: ${FACTS.pull.number}) { number state headRefOid headRefName baseRefName headRepository { nameWithOwner } }`))),
        onRepository({ pullRequest: obj({ number: num, state: str, headRefOid: sha, headRefName: str, baseRefName: str, headRepository: either(nul, obj({ nameWithOwner: str })) }) }));
      assert.deepEqual(held.repository.pullRequest, { number: FACTS.pull.number, state: 'MERGED', headRefOid: FACTS.pull.head, headRefName: FACTS.pull.branch, baseRefName: FACTS.pull.base, headRepository: { nameWithOwner: target.repo } });
    },
  },
  {
    name: 'an issue with its labels, a page and the page after it',
    run: async (ask, target) => {
      const issue = (labels) => onRepository({ issue: obj({ number: exactly(FACTS.issue.number), title: str, body: str, state: either(exactly('OPEN'), exactly('CLOSED')), author: either(nul, obj({ login: str })), repository: obj({ nameWithOwner: exactly(target.repo) }), labels }) });
      await paged(ask, (args) => repositoryQuery(target, ISSUE(FACTS.issue.number, args)), issue, (held) => held.repository.issue.labels, obj({ name: str }));
    },
  },
  {
    name: 'an issue the repository does not hold',
    run: async (ask, target) => {
      unresolved(await ask(graphql(repositoryQuery(target, ISSUE(FACTS.missing, 'first: 100')))), onRepository({ issue: nul }), ['repository', 'issue']);
    },
  },
  {
    name: 'an issue\'s state',
    run: async (ask, target) => {
      data(await ask(graphql(repositoryQuery(target, `issue(number: ${FACTS.issue.number}) { state repository { nameWithOwner } }`))),
        onRepository({ issue: obj({ state: either(exactly('OPEN'), exactly('CLOSED')), repository: obj({ nameWithOwner: exactly(target.repo) }) }) }));
    },
  },
  {
    name: 'an issue\'s timeline, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `issue(number: ${FACTS.issue.number}) { timelineItems(itemTypes: [ISSUE_COMMENT, LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT], ${args}) { pageInfo { hasNextPage endCursor } nodes { ${TIMELINE} } } }`),
      (timelineItems) => onRepository({ issue: obj({ timelineItems }) }), (held) => held.repository.issue.timelineItems, TIMELINE_NODE),
  },
  {
    name: 'the open issues carrying a label, a page and the page after it',
    run: (ask, target) => paged(ask, (args) => repositoryQuery(target, `issues(states: [OPEN], labels: [${quoted(FACTS.label)}], ${args}) { pageInfo { hasNextPage endCursor } nodes { number } }`),
      (issues) => onRepository({ issues }), (held) => held.repository.issues, obj({ number: num })),
  },
  {
    name: 'the newest issue or pull request',
    run: async (ask, target) => {
      printed(await ask(restGet(target, 'issues?state=all&sort=created&direction=desc&per_page=1')), list(rest({ number: num }), { min: 1 }));
    },
  },
  {
    name: 'the default branch',
    run: async (ask, target) => {
      const held = data(await ask(graphql(repositoryQuery(target, 'defaultBranchRef { name target { oid } }'))), onRepository({ defaultBranchRef: obj({ name: str, target: obj({ oid: sha }) }) }));
      assert.equal(held.repository.defaultBranchRef.name, 'main');
    },
  },
  {
    name: 'a file at a commit, and a path the commit holds nothing at',
    run: async (ask, target) => {
      const read = (path) => ask(graphql(repositoryQuery(target, `object(oid: ${quoted(target.fileCommit)}) { ... on Commit { oid file(path: ${quoted(path)}) { mode type object { ... on Blob { text isBinary isTruncated byteSize } } } } }`)));
      const held = data(await read(FACTS.file.path), onRepository({ object: obj({ oid: str, file: obj({ mode: num, type: str, object: obj({ text: str, isBinary: bool, isTruncated: bool, byteSize: num }) }) }) }));
      assert.deepEqual(held.repository.object, { oid: target.fileCommit, file: { mode: FACTS.file.mode, type: 'blob', object: { text: FACTS.file.text, isBinary: false, isTruncated: false, byteSize: Buffer.byteLength(FACTS.file.text) } } });
      unresolved(await read('nonesuch/missing.txt'), onRepository({ object: obj({ oid: exactly(target.fileCommit), file: nul }) }), ['repository', 'object', 'file']);
    },
  },
  {
    name: 'a pull request\'s mergeability',
    run: async (ask, target) => {
      data(await ask(graphql(repositoryQuery(target, `pullRequest(number: ${FACTS.pull.number}) { mergeable }`))), onRepository({ pullRequest: obj({ mergeable: either(exactly('MERGEABLE'), exactly('CONFLICTING'), exactly('UNKNOWN')) }) }));
    },
  },
  {
    name: 'a pull request\'s diff over REST',
    run: async (ask, target) => {
      const answer = await ask(restGet(target, `pulls/${FACTS.pull.number}`, '-H', DIFF));
      assert.equal(answer.status, 0, answer.stderr);
      assert.match(answer.stdout, /^diff --git a\//);
    },
  },
  {
    name: 'the merge base of a pull request\'s base branch and head',
    run: async (ask, target) => {
      const body = printed(await ask(restGet(target, `compare/${FACTS.pull.base}...${FACTS.pull.head}`)), rest({ merge_base_commit: rest({ sha }) }));
      assert.equal(body.merge_base_commit.sha, FACTS.pull.head, 'a merged head is its own merge base with the branch it was merged into');
    },
  },
  {
    name: 'an account\'s permission on the repository',
    run: async (ask, target) => {
      const body = printed(await ask(restGet(target, `collaborators/${FACTS.login.name}/permission`)), rest({ permission: str, role_name: str }));
      assert.deepEqual([body.permission, body.role_name], [FACTS.login.role, FACTS.login.role]);
    },
  },
  {
    name: 'the check runs at a commit',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `commits/${FACTS.pull.head}/check-runs?per_page=100&page=1`)),
        rest({ total_count: num, check_runs: list(rest({ id: num, name: str, status: str, conclusion: either(str, nul), app: either(nul, rest({ id: num })) }), { min: 1 }) }));
    },
  },
  {
    name: 'the commit statuses at a commit',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `commits/${FACTS.pull.head}/statuses?per_page=100&page=1`)),
        list(rest({ context: str, state: str, creator: either(nul, rest({ login: str, id: num })) }), { min: 1 }));
    },
  },
  {
    name: 'the rules in force on a branch',
    run: async (ask, target) => {
      printed(await ask(restGet(target, 'rules/branches/main?per_page=100&page=1')), list(rest({ type: str }), { min: 1 }));
    },
  },
  {
    name: 'the classic protection of a branch that has none',
    run: async (ask, target) => {
      const answer = await ask(restGet(target, 'branches/main/protection'));
      assert.equal(answer.status, 1);
      tie(JSON.parse(answer.stdout), rest({ message: exactly('Branch not protected'), status: exactly('404') }));
      assert.equal(answer.stderr.split('\n')[0], 'gh: Branch not protected (HTTP 404)');
    },
  },
  {
    name: 'an environment',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `environments/${FACTS.environment.name}`)),
        rest({ can_admins_bypass: bool, deployment_branch_policy: either(nul, rest({ protected_branches: bool, custom_branch_policies: bool })) }));
    },
  },
  {
    name: 'an environment\'s deployment-branch policies',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `environments/${FACTS.environment.name}/deployment-branch-policies?per_page=100&page=1`)),
        rest({ total_count: num, branch_policies: list(rest({ name: str, type: str })) }));
    },
  },
  {
    name: 'an environment\'s variable',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `environments/${FACTS.environment.name}/variables/${FACTS.environment.variable}`)), rest({ name: exactly(FACTS.environment.variable), value: str }));
    },
  },
  {
    name: 'an environment\'s secret, without its value',
    run: async (ask, target) => {
      const body = printed(await ask(restGet(target, `environments/${FACTS.environment.name}/secrets/${FACTS.environment.secret}`)), rest({ name: exactly(FACTS.environment.secret), created_at: str, updated_at: str }));
      assert.equal(Object.hasOwn(body, 'value'), false);
    },
  },
  {
    name: 'a pull request over REST',
    run: async (ask, target) => {
      const body = printed(await ask(restGet(target, `pulls/${FACTS.pull.number}`)), rest({ state: str, merged: bool, mergeable: either(bool, nul), head: rest({ sha }), merge_commit_sha: either(sha, nul) }));
      assert.deepEqual([body.state, body.merged, body.head.sha, body.merge_commit_sha], ['closed', true, FACTS.pull.head, FACTS.pull.mergeCommit]);
    },
  },
  {
    name: 'an issue over REST',
    run: async (ask, target) => {
      printed(await ask(restGet(target, `issues/${FACTS.issue.number}`)), rest({ number: exactly(FACTS.issue.number), node_id: str }));
    },
  },
  {
    name: 'an agent\'s view of a pull request, as JSON',
    run: async (ask, target) => {
      const answer = await ask(['pr', 'view', String(FACTS.pull.number), '--repo', target.repo, '--json', 'number,state,headRefName,headRefOid,baseRefName,url,title,body']);
      assert.equal(answer.status, 0, answer.stderr);
      assert.match(answer.stdout, /^\{.*\}\n$/);
      const body = JSON.parse(answer.stdout);
      tie(body, obj({ baseRefName: str, body: str, headRefName: str, headRefOid: sha, number: num, state: str, title: str, url: str }));
      assert.deepEqual(Object.keys(body), Object.keys(body).sort(), 'gh prints the fields in name order');
      assert.deepEqual([body.number, body.state, body.headRefName, body.headRefOid, body.baseRefName, body.url],
        [FACTS.pull.number, 'MERGED', FACTS.pull.branch, FACTS.pull.head, FACTS.pull.base, `https://github.com/${target.repo}/pull/${FACTS.pull.number}`]);
    },
  },
  {
    name: 'an agent\'s view of a pull request, as text',
    run: async (ask, target) => {
      const answer = await ask(['pr', 'view', String(FACTS.pull.number), '--repo', target.repo]);
      assert.equal(answer.status, 0, answer.stderr);
      const [head] = answer.stdout.split('\n--\n');
      const lines = head.split('\n').map((line) => line.split('\t'));
      assert.deepEqual(lines.map(([name]) => name), VIEW_LINES.map((name) => `${name}:`));
      const value = Object.fromEntries(lines.map(([name, held]) => [name.slice(0, -1), held]));
      assert.deepEqual([value.state, value.number, value.url], ['MERGED', String(FACTS.pull.number), `https://github.com/${target.repo}/pull/${FACTS.pull.number}`]);
      assert.match(`${value.additions} ${value.deletions}`, /^\d+ \d+$/);
    },
  },
  {
    name: 'an agent\'s diff of a pull request',
    run: async (ask, target) => {
      const answer = await ask(['pr', 'diff', String(FACTS.pull.number), '--repo', target.repo]);
      assert.equal(answer.status, 0, answer.stderr);
      assert.match(answer.stdout, /^diff --git a\//);
    },
  },
];

/**
 * The board contract cases: each a `name` and a `run` given the forge adapter's read side on the
 * target board, `readSide(BOARD, ...)`, and the target. The deterministic tier hands it the fake
 * board behind the fake gh; the host tier, the live board through real gh.
 */
export const BOARD_CASES = [
  {
    name: 'the declared columns',
    run: async (side, target) => assert.deepEqual(await side.readColumns(), target.columns),
  },
  {
    name: 'the single-select fields but the columns',
    run: async (side, target) => {
      const fields = await side.readFields();
      tie(fields, list(obj({ name: str, options: list(str) }), { min: 1 }));
      const priority = fields.find((field) => field.name === target.priority.field);
      assert.ok(priority, `the board holds no ${target.priority.field} field`);
      assert.deepEqual(target.priority.options.filter((option) => !priority.options.includes(option)), []);
      assert.equal(fields.some((field) => field.name === 'Status'), false);
    },
  },
  {
    name: 'every field with its type',
    run: async (side) => {
      const fields = await side.readFieldTypes();
      tie(fields, list(obj({ name: str, type: str }), { min: 1 }));
      assert.ok(fields.some((field) => field.name === 'Status' && field.type === 'SINGLE_SELECT'));
    },
  },
  {
    name: 'the repository\'s labels',
    run: async (side) => {
      const labels = await side.readLabels();
      tie(labels, list(str, { min: 1 }));
      assert.ok(labels.includes(FACTS.label), `the repository holds no ${FACTS.label} label`);
    },
  },
  {
    name: 'what the board holds from other repositories',
    run: async (side) => tie(await side.readOtherRepositories(), obj({ repositories: list(str), unreadable: num })),
  },
  {
    name: 'every card',
    run: async (side) => tie(await side.readItems(), list(obj({ id: str, number: num, title: str, body: str, labels: list(str), column: either(str, nul) }), { min: 1 })),
  },
  {
    name: 'an issue\'s state, and the state of one the repository does not hold',
    run: async (side) => {
      tie(await side.readIssueState(FACTS.issue.number), obj({ state: either(exactly('open'), exactly('closed')) }));
      assert.deepEqual(await side.readIssueState(FACTS.missing), { state: 'none' });
    },
  },
  {
    name: 'the cards by priority',
    run: async (side, target) => {
      const read = await side.readPriority();
      const card = obj({ id: str, number: num, title: str, body: str, labels: list(str), column: either(str, nul), priority: obj({ value: either(str, nul), declared: bool }) });
      tie(read, obj({ items: list(card, { min: 1 }), declared: exactly(target.priority.options), options: list(str, { min: 1 }) }));
      assert.deepEqual(target.priority.options.filter((option) => !read.options.includes(option)), []);
    },
  },
];

/**
 * Sends only `gh pr view` and `gh pr diff`, the agent's reads, as `send` sends a command, and refuses
 * every other agent command before it is sent: the agent side's read runner for the contract.
 */
export function agentReadRunner(args, send) {
  if (args[0] !== 'pr' || !['view', 'diff'].includes(args[1])) {
    throw new Error(`the contract's agent read runner refuses \`gh ${args.join(' ')}\`, and did not send it`);
  }
  return send(args);
}

/**
 * The `ask` a contract case named `name` is given: it refuses a write before it is sent, naming the
 * case (rule 12.4), records the arguments of every command in `ran`, and sends an adapter command
 * through the read runner, with `via`, and an agent command through `agentReadRunner`, with `agent`.
 * `commandOf`, the fake gh's, writes the arguments as the command `classify` reads.
 */
export function contractAsk(name, { via, agent, ran = [], commandOf }) {
  return async (args) => {
    if (classify(commandOf(args)) !== 'read') throw new Error(`contract case "${name}" sends \`gh ${args.join(' ')}\`, which is not a read (D29 rule 12.4)`);
    ran.push(args);
    return args[0] === 'pr' ? agentReadRunner(args, agent) : readRunner(args, via);
  };
}

/**
 * What the live side sends real gh with: `via`, the read runner's options, recording through
 * `emitter`, and `agent`, which runs an agent's read with `spawn`, Node's `spawnSync` by default.
 * Each real call is bounded by the read runner's own `FORGE_TIMEOUT`, a minute, so a hung gh is
 * ended and fails its case rather than stalling the host run; an agent read so ended throws the
 * spawn's error.
 */
export function liveSides({ emitter, spawn = spawnSync }) {
  return {
    via: { emitter, timeout: FORGE_TIMEOUT },
    agent: (args) => {
      const ran = spawn('gh', args, { encoding: 'utf8', timeout: FORGE_TIMEOUT });
      if (ran.error) throw ran.error;
      return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, timedOut: false };
    },
  };
}

/** Runs board case `boardCase` on `target`, through the read side given `via`. */
export const runBoardCase = (boardCase, target, via) => boardCase.run(readSide(target, via), target);

/**
 * The read commands among `answered`, each written as `classify` reads one, that no command in
 * `ran`, written the same way, is.
 */
export const unranReads = (answered, ran) => answered.filter((command) => classify(command) === 'read' && !ran.includes(command));
