// ABOUTME: Runs the gh and board contract cases against the fake gh and the fake board, in
// process, and checks the cases cover every read the fake gh answers and send no write (`D29` rule 12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_ANSWERED, ANSWERED, answerFakeGh, commandOf, seedRepositoryAt } from './fake-gh.mjs';
import { BOARD, BOARD_CASES, FACTS, GH_CASES, classify, contractAsk, liveSides, runBoardCase, unranReads } from './gh-contract-cases.mjs';
import { bareCloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Every command the fake gh answers, as `classify` reads one: the adapter's, and the agent's by subcommand. */
const answered = () => [...ANSWERED, ...AGENT_ANSWERED.map((subcommand) => `gh pr ${subcommand}`)];

/** A command a case ran, written as `answered` writes it: an agent command by its subcommand alone. */
const ranAs = (args) => (args[0] === 'pr' ? `gh pr ${args[1]}` : commandOf(args));

/** What a rule-12.5 record beside an answer in the fake gh opens with. */
const RECORD = 'Where real gh can differ (D29 rule 12.5):';

/**
 * The entries of the object literal `name` in `source`, in order, each with whether the comment
 * block directly above it carries a record: an entry is a line `entry` matches, at the object's
 * own indentation, and its comment block the `//` lines between it and the line before them.
 */
function entriesOf(source, name, entry) {
  const lines = source.split('\n');
  const start = lines.indexOf(`const ${name} = {`);
  const end = lines.indexOf('};', start);
  assert.ok(start >= 0 && end > start, `fake-gh.mjs holds no object literal ${name}`);
  const entries = [];
  for (let at = start + 1; at < end; at += 1) {
    if (!entry.test(lines[at])) continue;
    let above = at - 1;
    while (above > start && lines[above].startsWith('  //')) above -= 1;
    entries.push({ line: at + 1, recorded: lines.slice(above + 1, at).some((line) => line.includes(RECORD)) });
  }
  return entries;
}

/**
 * Whether the fake gh's answer to `command`, as `answered` writes it, carries a record beside it.
 * `COMMANDS` and `AGENT_COMMANDS` list their entries in the order their keys are, so the nth entry
 * in the source answers the nth key; a count that differs fails rather than guesses.
 */
function recordBeside(source, command) {
  const adapter = entriesOf(source, 'COMMANDS', /^ {2}\[(?:graphql|commandOf)\(/);
  const agent = entriesOf(source, 'AGENT_COMMANDS', /^ {2}\w+: async/);
  assert.equal(adapter.length, ANSWERED.length, 'the entries read from COMMANDS are not one per answered command');
  assert.equal(agent.length, AGENT_ANSWERED.length, 'the entries read from AGENT_COMMANDS are not one per agent command');
  const at = ANSWERED.indexOf(command);
  return at >= 0 ? adapter[at].recorded : agent[AGENT_ANSWERED.indexOf(command.slice('gh pr '.length))].recorded;
}

/** The time the fake gh is answered at; no case writes, so nothing it answers carries it. */
const NOW = '2026-11-08T00:00:00Z';

/**
 * A diff of the form the forge serves one, which the fake holds as the pull request's: one file
 * for each that #1202's diff changes, adding and deleting as many lines as it does
 * (`FACTS.pull.numstat`). A file it only adds to is a new file; the lines are placeholders.
 */
const DIFF = FACTS.pull.numstat.map(({ added, deleted, path }) => {
  const lines = (sign, count) => Array.from({ length: count }, (_, at) => `${sign}line ${at + 1}\n`).join('');
  const header = deleted === 0
    ? `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${added} @@\n`
    : `diff --git a/${path} b/${path}\nindex 2222222..3333333 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${deleted} +1,${added} @@\n`;
  return `${header}${lines('-', deleted)}${lines('+', added)}`;
}).join('');

/** A comment as the fake holds one, by `login`, at `createdAt`. */
const comment = (body, login, createdAt) => ({ body, createdAt, author: { login } });

/**
 * The fake board the deterministic side reads, mirroring the live board 6 in kind: the declared
 * columns, the priority field and a field of another type, the repository's cards, a draft and an
 * issue of another repository, and the label a change card carries.
 */
const FAKE_BOARD = {
  columns: Object.values(BOARD.columns),
  fields: [{ name: BOARD.priority.field, options: [...BOARD.priority.options] }, { name: 'Estimate', type: 'NUMBER' }],
  items: [
    { type: 'issue', repository: BOARD.repo, number: FACTS.issue.number, title: 'A closed card', body: '', labels: [FACTS.label], column: BOARD.columns.done, fieldValues: { [BOARD.priority.field]: BOARD.priority.options[0] } },
    { type: 'issue', repository: BOARD.repo, number: 1315, title: 'An open card', body: 'Its body.', labels: [FACTS.label], column: BOARD.columns.coding },
    { type: 'draftIssue' },
    { type: 'issue', repository: 'williacj/elsewhere', number: 3, title: 'Another repository\'s issue', labels: [] },
  ],
  labels: [FACTS.label, 'type:spec'],
};

/** The repository the fake gh answers from, holding the live repository's facts that do not change. */
const FAKE_REPOSITORY = {
  issues: [
    { number: FACTS.issue.number, title: 'A closed card', labels: [FACTS.label, 'maker:codex'], comments: [comment('First.', 'williacj', '2026-11-01T00:00:00Z'), comment('Second.', 'williacj', '2026-11-02T00:00:00Z')] },
    { number: 1315, title: 'An open card', body: 'Its body.', labels: [FACTS.label] },
  ],
  issueStates: { [FACTS.issue.number]: 'closed' },
  pullRequests: [{
    number: FACTS.pull.number, head: FACTS.pull.branch, sha: FACTS.pull.head, base: FACTS.pull.base, merged: true, mergeBase: FACTS.pull.head,
    title: 'A merged pull request', body: 'Its body.', diff: DIFF,
    comments: [comment('A ruling.', 'williacj', '2026-11-04T00:00:00Z'), comment('Another.', 'williacj', '2026-11-05T00:00:00Z')],
  }],
  branches: ['main', FACTS.pull.branch],
  mergeable: { [FACTS.pull.number]: null },
  mainSha: FACTS.pull.mergeCommit,
  permissions: { [FACTS.login.name]: FACTS.login.role },
  checks: { [FACTS.pull.head]: [{ id: 1, name: 'check (26)', status: 'completed', conclusion: 'success', app: { id: 15368 } }] },
  statuses: { [FACTS.pull.head]: [{ context: 'rigger/gate', state: 'success', creator: { login: 'rigger-gate[bot]', id: 341662075 } }] },
  rules: { main: [{ type: 'deletion' }] },
  environments: {
    [FACTS.environment.name]: {
      can_admins_bypass: false,
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      branch_policies: [{ name: 'main', type: 'branch' }],
      variables: { [FACTS.environment.variable]: '1' },
      secrets: [FACTS.environment.secret],
    },
  },
};

/**
 * The fake forge a case reads, in its own directory: the fake gh's state over the fake board and the
 * fake repository, whose `origin` holds `FACTS.file` on `main`. It returns the target the cases read,
 * with the commit that holds the file, and the `send` the read runner and the agent read runner are
 * given, which answers in process through `answerFakeGh`.
 */
function fakeForge(t) {
  const directory = temporaryDirectory('rigger-gh-contract-', { context: t });
  const source = repositoryAt(join(directory, 'source'), { [FACTS.file.path]: FACTS.file.text });
  gitIn(source, 'branch', '-M', 'main');
  const origin = bareCloneInto(source, join(directory, 'origin.git'));
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({ repo: BOARD.repo, project: BOARD.project, model: FAKE_BOARD, origin, writes: [], sent: [] }));
  seedRepositoryAt(statePath, FAKE_REPOSITORY);
  const answer = async (args) => ({ ...(await answerFakeGh(statePath, args, { now: () => NOW, cwd: directory, input: () => '' })), timedOut: false });
  return { target: { ...BOARD, fileCommit: gitIn(origin, 'rev-parse', 'refs/heads/main').trim() }, via: { send: (_gh, args) => answer(args) }, agent: answer, statePath };
}

/** Runs gh case `ghCase` against the fake forge, recording the arguments of each command it sends in `ran`. */
async function onFake(t, ghCase, ran = []) {
  const { target, via, agent } = fakeForge(t);
  await ghCase.run(contractAsk(ghCase.name, { via, agent, ran, commandOf }), target);
  return ran;
}

for (const ghCase of GH_CASES) {
  test(`gh contract against the fake gh: ${ghCase.name}`, (t) => onFake(t, ghCase));
}

for (const boardCase of BOARD_CASES) {
  test(`board contract against the fake board: ${boardCase.name}`, (t) => {
    const { target, via } = fakeForge(t);
    return runBoardCase(boardCase, target, via);
  });
}

test('every command the fake gh answers is classified as a read or a write', () => {
  const unclassified = answered().filter((command) => !['read', 'write'].includes(classify(command)));
  assert.deepEqual(unclassified, [], 'the fake gh answers a command the contract cannot classify as a read or a write');
});

test('a command the contract cannot classify is answered as neither a read nor a write', () => {
  for (const command of ['gh api repos/_/_/issues', 'gh api graphql -f query=subscription { x }', 'gh api graphql -f query={', 'gh pr merge', 'gh pr constructor', 'gh issue list']) {
    assert.equal(classify(command), null, command);
  }
  assert.equal(classify('gh api graphql -f query=mutation { createLabel(input: {name: _}) { label { id } } }'), 'write');
  assert.equal(classify('gh api graphql -f query=query { repository(owner: _, name: _) { id } }'), 'read');
  assert.equal(classify('gh api repos/_/_/issues/_ -X GET'), 'read');
  assert.equal(classify('gh api repos/_/_/issues/_ -X PATCH -f state=closed'), 'write');
  assert.equal(classify('gh pr view 12 --repo a/b'), 'read');
  assert.equal(classify('gh pr comment 12 --body x'), 'write');
});

test('every read command the fake gh answers is run by at least one contract case', async (t) => {
  const ran = [];
  for (const ghCase of GH_CASES) await onFake(t, ghCase, ran);
  assert.deepEqual(unranReads(answered(), ran.map(ranAs)), [], 'the fake gh answers a read no contract case runs');
});

test('a read the fake gh answers and no case runs is named, and a write is not asked for', () => {
  const read = 'gh api repos/_/_/issues/_ -X GET';
  const write = 'gh api repos/_/_/issues/_ -X PATCH -f state=closed';
  assert.deepEqual(unranReads([read, write, 'gh pr view', 'gh pr comment'], ['gh pr view']), [read]);
});

test('every write the fake gh answers carries, beside its answer, a record of where real gh can differ', () => {
  const source = readFileSync(new URL('./fake-gh.mjs', import.meta.url), 'utf8');
  const writes = answered().filter((command) => classify(command) === 'write');
  assert.ok(writes.length > 0, 'found no write, so the check could pass having read nothing');
  assert.deepEqual(writes.filter((command) => !recordBeside(source, command)), [], 'the fake gh answers a write with no rule-12.5 record beside it');
});

test('an answer is read as recorded only where the comment block directly above its entry carries the record', () => {
  const source = [
    'const COMMANDS = {',
    '  // An answer.',
    `  // ${RECORD} it can differ.`,
    '  [first]: one,',
    '  [second]: two,',
    '};',
    'const AGENT_COMMANDS = {',
    '  // An agent answer.',
    '  view: async () => {},',
    `  // ${RECORD} it can differ.`,
    '  diff: async () => {},',
    '};',
  ].join('\n');
  assert.deepEqual(entriesOf(source, 'COMMANDS', /^ {2}\[/).map(({ recorded }) => recorded), [true, false]);
  assert.deepEqual(entriesOf(source, 'AGENT_COMMANDS', /^ {2}\w+: async/).map(({ recorded }) => recorded), [false, true]);
});

/**
 * The files under `test/` that may name the live gh opt-in, each with its role (#1315, item 12):
 * the suite that provides it, the host contract file that reads it, this file, which holds the
 * scan and its fixtures, and the workflow test that asserts `nightly`'s opt-in.
 */
const ADMITTED = ['test/suite.sh', 'test/gh-contract-host.test.mjs', 'test/gh-contract.test.mjs', 'test/workflow-files.test.mjs'];

/**
 * The fragments that name the live gh opt-in, `RIGGER_LIVE_GH` and the `RIGGER_LIVE_GH_DIR` it
 * provides, as they read once a text is normalized. The check is lexical: a reader that never
 * spells either fragment in sequence is outside it, and the item's text is its bar.
 */
const OPT_IN_FRAGMENTS = ['RIGGERLIVEGH', 'LIVEGHDIR'];

/** `text` with every non-alphanumeric character removed and case folded to upper. */
const normalized = (text) => text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Whether `text` names the live gh opt-in: its normalized form holds either fragment. */
const namesOptIn = (text) => OPT_IN_FRAGMENTS.some((fragment) => normalized(text).includes(fragment));

/** The files among `files`, as `{ path, text }`, that name the live gh opt-in and are not admitted. */
const outsideTheOptIn = (files) => files.filter(({ path, text }) => namesOptIn(text) && !ADMITTED.includes(path)).map(({ path }) => path);

/** Every file git tracks under `test/`, as `{ path, text }`. */
function trackedTestFiles() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  return gitIn(root, 'ls-files', '-z', '--', 'test').split('\0').filter(Boolean)
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

test('no tracked file under test/ names the live gh opt-in but the four admitted', () => {
  const files = trackedTestFiles();
  assert.ok(files.length > 100, `git listed ${files.length} tracked files under test/, so the scan read the wrong tree`);
  for (const path of ADMITTED) {
    assert.ok(files.find((file) => file.path === path), `${path} is not tracked, so the admitted list names a file that is not there`);
  }
  assert.ok(namesOptIn(files.find((file) => file.path === 'test/suite.sh').text), 'test/suite.sh does not name the opt-in, so the scan looks for the wrong name');
  assert.ok(namesOptIn(files.find((file) => file.path === 'test/gh-contract-host.test.mjs').text), 'the host contract file does not name the opt-in, so the scan looks for the wrong name');
  assert.deepEqual(outsideTheOptIn(files), [], 'a tracked file under test/ other than the four admitted names the live gh opt-in');
});

test('the two routes past the refusing gh that predate the opt-in do not name it', () => {
  const files = trackedTestFiles();
  for (const path of ['test/forge-runners.test.mjs', 'test/fake-gh.test.mjs']) {
    const file = files.find((held) => held.path === path);
    assert.ok(file && file.text.includes('RIGGER_REFUSING_GH_DIR'), `${path} no longer reads the refusing gh's directory`);
    assert.equal(namesOptIn(file.text), false, `${path} names the live gh opt-in`);
  }
});

test('a file naming the live gh opt-in is named wherever its pieces are written in sequence, and the admitted files are not', () => {
  assert.deepEqual(outsideTheOptIn([
    ...ADMITTED.map((path) => ({ path, text: 'process.env.RIGGER_LIVE_GH_DIR' })),
    { path: 'test/plain.test.mjs', text: 'process.env.RIGGER_LIVE_GH_DIR' },
    { path: 'test/prefixed.test.mjs', text: "const k = 'RIGGER_LIVE_GH_'; const dir = process.env[k + 'DIR'];" },
    { path: 'test/spliced.test.mjs', text: "process.env['RIGGER_LIVE_' + 'GH_DIR']" },
    { path: 'test/joined.test.mjs', text: "process.env[['RIGGER', 'LIVE', 'GH', 'DIR'].join('_')]" },
    { path: 'test/lowered.test.mjs', text: 'process.env[`rigger_live_gh_dir`.toUpperCase()]' },
    { path: 'test/opting-in.test.mjs', text: "env.RIGGER_LIVE_GH === '1'" },
    { path: 'test/refusing.test.mjs', text: 'process.env.RIGGER_REFUSING_GH_DIR' },
    { path: 'test/other-live.test.mjs', text: "process.env.RIGGER_LIVE_CLAUDE === '1'" },
  ]), ['test/plain.test.mjs', 'test/prefixed.test.mjs', 'test/spliced.test.mjs', 'test/joined.test.mjs', 'test/lowered.test.mjs', 'test/opting-in.test.mjs']);
});

test('every real gh call the live side makes is bounded by at most 60 seconds, and a call it ends fails its case', async () => {
  const started = [];
  // What the process adapter rejects with where its timeout ended the command and the emitter
  // refused the kill: the bounded runner settles, and the case fails on it.
  const ended = Object.assign(new Error('the timeout of 60000 ms ended gh, and the sink refused its kill'), { code: 'EVENT_REFUSED' });
  const { via, agent } = liveSides({ emitter: null, run: async (call) => {
    started.push(call);
    throw ended;
  } });
  assert.ok(Number.isInteger(via.timeout) && via.timeout > 0 && via.timeout <= 60_000, `the read runner is given ${via.timeout} ms`);
  const diff = GH_CASES.find((ghCase) => ghCase.name === 'an agent\'s diff of a pull request');
  await assert.rejects(diff.run(contractAsk(diff.name, { via, agent, commandOf }), BOARD), /the timeout of 60000 ms ended gh/);
  assert.equal(started.length, 1);
  assert.equal(started[0].command, 'gh');
  assert.ok(started[0].timeout > 0 && started[0].timeout <= 60_000, `the agent's gh is given ${started[0].timeout} ms`);
});

test('a contract case whose command is a write fails naming the case, and nothing reaches the fake forge', async (t) => {
  const { target, via, agent, statePath } = fakeForge(t);
  const before = readFileSync(statePath, 'utf8');
  // The transports under the guard, observed apart from the guard's own record: what the read
  // runner and the agent read runner were handed to send.
  const transported = [];
  const watched = {
    via: { ...via, send: (gh, args, options) => { transported.push(args); return via.send(gh, args, options); } },
    agent: (args) => { transported.push(args); return agent(args); },
  };
  const ran = [];
  const writing = [
    ['closes an issue', ['api', `repos/${target.repo}/issues/${FACTS.issue.number}`, '-X', 'PATCH', '-f', 'state=closed']],
    ['creates a label', ['api', 'graphql', '-f', 'query=mutation { createLabel(input: {repositoryId: "R_fake", name: "x", color: "ffffff"}) { label { id } } }']],
    ['comments as an agent', ['pr', 'comment', String(FACTS.pull.number), '--repo', target.repo, '--body', 'x']],
  ];
  for (const [name, args] of writing) {
    const ask = contractAsk(name, { ...watched, ran, commandOf });
    await assert.rejects(ask(args), new RegExp(`contract case "${name}" sends .* which is not a read`));
  }
  assert.deepEqual(transported, [], 'a write reached a transport');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).sent, [], 'the fake forge recorded a command');
  assert.equal(readFileSync(statePath, 'utf8'), before, 'the fake forge\'s state changed');
  assert.deepEqual(ran, []);
});
