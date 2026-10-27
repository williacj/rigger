// ABOUTME: Tests `rigger once`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming one card through L3's single pull, making and provisioning its workspace,
// dispatching its maker through L1 to a stand-in, printing its outcome, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove, seedRepository } from './fake-gh.mjs';
import { headIn, markerComment } from './fake-repository.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { spawn } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import { readdirSync } from 'node:fs';
import { parse } from 'acorn';
import { gitIn } from './git-repository.mjs';
import { detachedWorktreeAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { until } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';
import { installStandInAgent } from './stub-claude.mjs';
import { sweep } from './process-fixtures.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { admissionOf, closerText, seed, TIME } from './admission-world.mjs';

// A bound on a test that waits on the real bin and its maker, so one that never settles fails here.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board that L2 would dispatch: an issue in its repository, selected by the `change` kind. */
const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** The template's kinds, each listing no provisioning step, so a claimed card's attempt runs none. */
const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config: the template's, with its repository, its board and N 3 filled in, and kinds listing no provisioning. */
const config = () => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3, kinds: KINDS });

/**
 * A consumer's repository holding that config, with a local bare `origin` beside it, in a
 * directory of its own, so the workspaces the default root names beside it are its alone.
 */
const consumerRepository = (settings = config()) => {
  const directory = temporaryDirectory('rigger-once-');
  return withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` }), join(directory, 'origin.git'));
};

/**
 * A stand-in for the agent CLI every role in the template's config dispatches through, placed in
 * `dir`, which records each run beside itself. A dispatch in M2 and M4 runs the provider's CLI,
 * so a run of it is what a started dispatch would show.
 * It is run once before this returns (`warmed`), exiting before its body, so its first exec is not
 * held inside a run.
 */
function installAgentCli(dir) {
  const record = join(dir, 'agent-runs');
  const fence = '```';
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\n${EXIT_IF_WARMING}\nprintf '%s\\n' "$*" >> "\${0%/*}/agent-runs"\nif [ "\${RIGGER_TEST_ESCALATE:-}" = 1 ]; then\n  prompt=$(cat)\n  dispatch=$(printf '%s\\n' "$prompt" | awk '/^dispatch: d-/ { print $2; exit }')\n  category=critical\n  if [ "\${RIGGER_TEST_ESCALATE_AMBIGUOUS:-}" = 1 ]; then category=ambiguous; fi\n  body=$(printf '%s\\n' 'I cannot meet acceptance item 1.' '${fence}rigger-escalation' "category: $category" 'item: 1' 'reason: The required condition failed.' "dispatch: $dispatch" '${fence}')\n  gh api repos/acme/widgets/issues/10/comments -X POST -f "body=$body" >/dev/null || exit $?\nfi\nexit 0\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  warmed(join(dir, 'claude'));
  return { runs: () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : []) };
}

/**
 * Runs the real bin's `once` in a fresh consumer repository, with a fake `gh` holding `board`
 * first on PATH, ahead of the refusing one `npm test` puts there, and the agent CLI stand-in
 * beside it. `record` says how the consumer's event stream takes appends: `accepting`, the
 * default; `refusing`, where the stream is a directory before the run, so it refuses every
 * append from the start; or `refusing-after-move`, where the `gh` first on PATH answers as the
 * fake does and makes the stream that directory once it has answered a move.
 */
function once(board, { record = 'accepting', seed, extraEnv = {}, settings, prepare = () => {} } = {}) {
  const consumer = consumerRepository(settings);
  const dir = temporaryDirectory('rigger-once-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  if (seed !== undefined) seedRepository(fake, seed);
  prepare({ consumer, fake });
  const agent = installAgentCli(dir);
  const stream = join(consumer, '.rigger', 'events.jsonl');
  if (record === 'refusing') mkdirSync(stream, { recursive: true });
  const ahead = record === 'refusing-after-move' ? [dirname(installGhRefusingStreamAfterMove(temporaryDirectory('rigger-once-wrap-'), fake.gh, stream))] : [];
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), ...extraEnv, PATH: [...ahead, dir, process.env.PATH].join(delimiter) };
  const invoke = () => {
    const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env });
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, consumer, model: fake.model, agentRuns: agent.runs, fake, rerun: invoke };
  };
  return invoke();
}

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (ran) => Object.fromEntries((await (await ran.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** The events the run recorded in the consumer's state directory, in order. */
const eventsOf = (ran) => readEvents(join(ran.consumer, '.rigger'));

/** The moves in the fake board's write record, each as the item moved and the column it entered. */
const movesOf = async (ran) => (await ran.model()).writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args);

test('once, given N 3 and two ready cards L2 would dispatch and none in coding or review, claims exactly one card, which ends in the coding column', async () => {
  // #10 is the older card, so it is the one pulled first, and #20 stays where it was.
  const ran = once({ items: [card(20, 'Ready'), card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready' }, ran.err);
});

test('once names the card it claimed, its workspace and its maker\'s outcome', () => {
  const ran = once({ items: [card(10, 'Ready')] });

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.ok(line.includes(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees', 'rigger-10')), line);
  assert.match(line, /; its maker exited 0 and opened no pull request from rigger-10, in its workspace, /, line);
});

// proves R-LOOP-2, R-ESCALATE-4
test('once names a maker note escalation, its category and acceptance item ordinal', async () => {
  const ran = once({ items: [card(10, 'Ready')] }, {
    seed: { issues: [{ number: 10, title: 'Card 10', body: ADMITTED, labels: ['type:change'] }] },
    extraEnv: { RIGGER_TEST_ESCALATE: '1' },
  });

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /card #10 escalated critical for acceptance item 1/);
  assert.deepEqual(await columnsOf(ran), { 10: 'Owner' });
  assert.equal(eventsOf(ran).find(({ event }) => event === 'review.escalate').raiser, 'maker');
});

// proves R-ESCALATE-22
test('once sends a maker escalation to the owner where the config has no escalate key or none for its category, recording the owner as its destination', async () => {
  const { escalate: _, ...withoutEscalate } = config();
  for (const [what, settings] of [['no escalate key', withoutEscalate], ['its category\'s key absent', { ...withoutEscalate, escalate: { critical: 'owner' } }]]) {
    const ran = once({ items: [card(10, 'Ready')] }, {
      settings,
      seed: { issues: [{ number: 10, title: 'Card 10', body: ADMITTED, labels: ['type:change'] }] },
      extraEnv: { RIGGER_TEST_ESCALATE: '1', RIGGER_TEST_ESCALATE_AMBIGUOUS: '1' },
    });
    assert.equal(ran.code, 0, `${what}: ${ran.err}`);
    assert.deepEqual(await columnsOf(ran), { 10: 'Owner' }, what);
    const [event] = eventsOf(ran).filter(({ event: name }) => name === 'review.escalate');
    assert.deepEqual({ category: event.category, raiser: event.raiser, destination: event.destination }, { category: 'ambiguous', raiser: 'maker', destination: 'owner' }, what);
    const issue = JSON.parse(readFileSync(join(dirname(ran.fake.gh), 'board.json'), 'utf8')).repository.issues.find(({ number }) => number === 10);
    assert.match(issue.comments.at(-1).body, /^Rigger escalates card #10 to the owner \(ambiguous\)\./, what);
    assert.doesNotMatch(issue.comments.at(-1).body, /Not sent/, what);
  }
});

test('once exits non-zero when the card\'s maker opened no pull request', async () => {
  const ran = once({ items: [card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, ran.err);
  assert.notEqual(ran.code, 0, ran.out);
});

test('once over a board with no pullable card claims nothing, and prints that no card was pullable', async () => {
  // #18 sits in Backlog and #19 in Done, so neither is offered to L2.
  const ran = once({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.deepEqual(await columnsOf(ran), { 18: 'Backlog', 19: 'Done' });
  assert.deepEqual((await ran.model()).writes(), []);
});

test('once over a board with no pullable card exits 0', () => {
  const ran = once({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.equal(ran.code, 0, ran.err);
});

/** A ready card L2 refuses: its body holds no acceptance, so the form check refuses it. */
const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

// proves R-SCHED-3, R-SCHED-16
test('once under owner and hold closers names both, keeps L2 refusals and exits 0 without claiming', async () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] }, { prepare: ({ consumer }) => {
    const state = join(consumer, '.rigger');
    seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' }));
    seed(state, 'hold-b2.json', closerText({ reason: 'environment hold' }));
  } });

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /admission is closed/);
  for (const [kind, reason] of [['owner', 'owner pause'], ['hold', 'environment hold']]) {
    assert.match(ran.out, new RegExp(`${kind}.*${reason}.*${TIME}`), ran.out);
  }
  assert.match(ran.out, /#11.*missing acceptance/, ran.out);
  assert.doesNotMatch(ran.out, /no card was pullable/, ran.out);
  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Ready' });
  assert.deepEqual((await ran.model()).writes(), []);
  assert.deepEqual(ran.agentRuns(), []);
});

// proves R-SCHED-3, R-SCHED-16
test('once under unreadable admission names every path and cause, keeps L2 refusals and exits non-zero', async () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] }, { prepare: ({ consumer }) => {
    const state = join(consumer, '.rigger');
    seed(state, 'not-a-closer');
    seed(state, 'owner-b2.json', '{}');
  } });
  const directory = admissionOf(join(ran.consumer, '.rigger'));

  assert.notEqual(ran.code, 0, ran.out);
  assert.ok(ran.err.includes(`${directory}/not-a-closer (no closer form)`), ran.err);
  assert.ok(ran.err.includes(`${directory}/owner-b2.json (no reason, time or run)`), ran.err);
  assert.match(ran.err, /#11.*missing acceptance/, ran.err);
  assert.doesNotMatch(ran.err, /no card was pullable/, ran.err);
  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Ready' });
  assert.deepEqual((await ran.model()).writes(), []);
  assert.deepEqual(ran.agentRuns(), []);
});

test('once, given a ready card L2 refuses, leaves it in the ready column', async () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Coding' }, ran.err);
});

// proves R-CARD-7
test('once, given a ready card L2 refuses, names the card and the reason', () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] });

  const line = ran.err.split('\n').find((held) => /#11\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /missing acceptance/, ran.err);
});

test('once, given a ready card L2 ignores, leaves it in the ready column', async () => {
  // No kind selects a card carrying no label, so L2 ignores it and it is neither pulled nor refused.
  const ran = once({ items: [card(13, 'Ready', { labels: [] })] });

  assert.deepEqual(await columnsOf(ran), { 13: 'Ready' }, ran.err);
  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.doesNotMatch(ran.out, /#13\b/, ran.out);
});

test('once dispatches the card\'s selected steps and its maker: the agent CLI runs once, as the maker, and every L1 dispatch event is a step\'s or the maker\'s', async () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready' }, ran.err);
  assert.equal(ran.agentRuns().length, 1, JSON.stringify(ran.agentRuns()));
  assert.match(ran.agentRuns()[0], /--append-system-prompt-file \S*\/rigger-10\/\.claude\/agents\/engineer\.md$/);
  const events = eventsOf(ran);
  assert.ok(events.length > 0, 'the run recorded events');
  assert.deepEqual(events.filter((event) => event.layer === 'L1' && event.dispatch !== undefined && !events.some((named) => named.layer === 'L3' && named.event === 'dispatch' && named.dispatch === event.dispatch && (typeof named.step === 'string' || (named.role === 'engineer' && named.tier === 'standard')))), []);
});

test('after once claims a card from the ready column, the state directory\'s event stream holds an L3 event and an L2 transition event', async () => {
  const ran = once({ items: [card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, ran.err);
  const events = eventsOf(ran);
  assert.ok(events.some((event) => event.layer === 'L3'), JSON.stringify(events));
  assert.ok(events.some((event) => event.layer === 'L2' && event.event === 'transition'), JSON.stringify(events));
});

// proves R-ESCALATE-7, R-ESCALATE-8, R-ESCALATE-9, R-ESCALATE-15
test('once completes an owner escalation on its issue and a new invocation neither dispatches nor escalates it again', async () => {
  const head = '6'.repeat(40);
  const marker = markerComment({ card: 10, pull: 11, head, body: ADMITTED, verdict: 'critical', toSound: "Keep the user's files; $(literal) is data." });
  let before;
  const ran = once({ items: [card(10, 'Review')] }, {
    seed: { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, comments: [marker] }] },
    prepare: ({ consumer }) => { before = worktreeList(consumer); },
  });
  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /#10.*escalate.*critical/);
  assert.deepEqual(await columnsOf(ran), { 10: 'Owner' });
  const held = () => JSON.parse(readFileSync(join(dirname(ran.fake.gh), 'board.json'), 'utf8')).repository;
  const issue = held().issues.find(({ number }) => number === 10);
  assert.equal(issue.comments.length, 1);
  assert.equal(issue.comments[0].body, "Rigger escalates card #10 to the owner (critical).\n\nreviewer (critical): Keep the user's files; $(literal) is data.\n\nPull request: #11\nHead: 6666666666666666666666666666666666666666\n");
  assert.deepEqual(issue.labels, ['type:change', 'rigger:escalated']);
  assert.deepEqual(held().pullRequests[0].comments, [marker]);
  assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'transition').map(({ from, to, cause }) => ({ from, to, cause })), [{ from: 'review', to: 'owner', cause: 'escalated' }]);
  const sent = ran.fake.sent().length;
  const again = ran.rerun();
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /no card.*pullable/i);
  assert.equal(held().issues.find(({ number }) => number === 10).comments.length, 1);
  assert.equal(eventsOf(again).filter(({ event }) => event === 'review.escalate').length, 1);
  assert.deepEqual(ran.fake.sent().slice(sent).filter((args) => args[3] === 'POST' || args[3]?.startsWith('query=mutation')), []);
  assert.deepEqual(again.agentRuns(), []);
  assert.deepEqual(worktreeList(ran.consumer), before);
  assert.deepEqual(eventsOf(again).filter(({ layer }) => layer === 'L1'), []);
});

for (const { action, ruling, merged, expectedColumn, line } of [
  { action: 'move', merged: true, expectedColumn: 'Done', line: /#10.*move.*done/ },
  { action: 'return', ruling: { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' }, expectedColumn: 'Review', line: /#10.*return.*#11/ },
  { action: 'escalate', ruling: { verdict: 'critical', toSound: 'Keep the user files.' }, expectedColumn: 'Owner', line: /#10.*escalate.*critical/ },
]) {
  test(`once prints the ${action} it carried out for a Review card and exits zero`, async () => {
    const head = '6'.repeat(40);
    const comments = ruling === undefined ? [] : [markerComment({ card: 10, pull: 11, head, body: ADMITTED, ...ruling })];
    const seed = { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: '7'.repeat(40), comments, merged: merged ?? false }] };

    const ran = once({ items: [card(10, 'Review')] }, { seed });

    assert.equal(ran.code, 0, ran.err);
    assert.match(ran.out, line);
    assert.deepEqual(await columnsOf(ran), { 10: expectedColumn });
    if (action === 'return') {
      const view = spawnSync(ran.fake.gh, ['pr', 'view', '11', '--json', 'comments'], { encoding: 'utf8', env: gitEnvironment() });
      assert.equal(JSON.parse(view.stdout).comments.length, 2);
    }
    if (action === 'escalate') assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'review.escalate').map(({ category }) => category), ['critical']);
  });
}

// proves R-WORK-35
test('once removes a person-merged card’s real worktrees and scratch before moving it to Done', async () => {
  const temporary = temporaryDirectory('rigger-once-removal-');
  const worktrees = join(temporary, 'workspaces');
  const settings = { ...config(), worktrees: { ...config().worktrees, root: worktrees } };
  let paths;
  const ran = once({ items: [card(10, 'Review')] }, {
    settings,
    seed: { pullRequests: [{ number: 11, head: 'rigger-10', sha: '6'.repeat(40), merged: true }] },
    prepare: ({ consumer }) => {
      const workspace = join(worktrees, 'rigger-10');
      const judge = join(worktrees, 'judges', 'rigger-10', 'reviewer');
      const scratch = join(worktrees, 'scratch', 'rigger-10', 'reviewer');
      mkdirSync(judge, { recursive: true });
      mkdirSync(scratch, { recursive: true });
      mkdirSync(join(worktrees, 'unrelated'));
      worktreeAt(consumer, workspace, 'rigger-10');
      detachedWorktreeAt(consumer, join(judge, 'main'), 'HEAD');
      detachedWorktreeAt(consumer, join(judge, 'head'), 'HEAD');
      paths = { workspace, judge, scratch };
    },
  });

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(await columnsOf(ran), { 10: 'Done' });
  for (const path of Object.values(paths)) assert.equal(existsSync(path), false, path);
  assert.deepEqual(readdirSync(worktrees), ['judges', 'scratch', 'unrelated']);
  assert.equal(worktreeList(ran.consumer).includes(paths.workspace), false);
  const events = eventsOf(ran);
  const done = events.findIndex(({ layer, event, to }) => layer === 'L2' && event === 'transition' && to === 'done');
  assert.ok(done > 0, JSON.stringify(events));
  assert.ok(events.filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed').every((event) => events.indexOf(event) < done), JSON.stringify(events));
});

// proves R-WORK-35
test('once retains a workspace when an open line snapshot meets a closed merge preflight', async () => {
  const temporary = temporaryDirectory('rigger-once-closed-');
  const worktrees = join(temporary, 'workspaces');
  const settings = { ...config(), worktrees: { ...config().worktrees, root: worktrees } };
  const head = '6'.repeat(40);
  let workspace;
  const ran = once({ items: [card(10, 'Review')] }, {
    settings,
    seed: {
      pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: '7'.repeat(40), comments: [markerComment({ card: 10, pull: 11, head, body: ADMITTED })] }],
      mergeable: { 11: 'MERGEABLE' }, pullStates: { 11: 'closed' },
    },
    prepare: ({ consumer }) => {
      mkdirSync(worktrees);
      workspace = join(worktrees, 'rigger-10');
      worktreeAt(consumer, workspace, 'rigger-10');
    },
  });

  assert.notEqual(ran.code, 0);
  assert.deepEqual(await columnsOf(ran), { 10: 'Review' });
  assert.equal(existsSync(workspace), true);
  assert.equal(eventsOf(ran).some(({ layer, event }) => layer === 'L1' && event === 'workspace.removed'), false);
});

test('once moves an Owner card to Review, then dispatches its owed reviewer on the next invocation', async () => {
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['reviewer', 'owner'] } } };
  const prepare = ({ consumer, fake }) => {
    const base = gitIn(consumer, 'rev-parse', 'HEAD').trim();
    const initialBranch = gitIn(consumer, 'symbolic-ref', '--short', 'HEAD').trim();
    gitIn(consumer, 'checkout', '-q', '-b', 'rigger-10');
    gitIn(consumer, 'commit', '-q', '--allow-empty', '-m', 'work for review');
    const head = gitIn(consumer, 'rev-parse', 'HEAD').trim();
    gitIn(consumer, 'push', '-q', 'origin', 'rigger-10');
    gitIn(consumer, 'checkout', '-q', initialBranch);
    const reviewer = markerComment({ card: 10, pull: 11, head, body: ADMITTED });
    const oldReviewer = { ...reviewer, body: reviewer.body.replace(/digest: [0-9a-f]{64}/, `digest: ${'f'.repeat(64)}`) };
    const owner = markerComment({ card: 10, pull: 11, head, body: ADMITTED, role: 'owner', createdAt: '2026-10-01T11:05:00Z' });
    seedRepository(fake, { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: base, mergeable: 'mergeable', comments: [oldReviewer, owner] }] });
  };
  const first = once({ items: [card(10, 'Owner')] }, {
    settings,
    prepare,
  });

  assert.equal(first.code, 0, first.err);
  assert.deepEqual(await columnsOf(first), { 10: 'Review' });
  assert.deepEqual(first.agentRuns(), []);
  const second = first.rerun();
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /claimed #10.*judges alone/);
  assert.equal(second.agentRuns().length, 1);
  assert.deepEqual(eventsOf(second).filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role !== undefined).map(({ role }) => role), ['reviewer']);
});

for (const { action, ruling, merged, board, seedExtra, record, extraEnv, error } of [
  { action: 'move', merged: true, board: { refuseMoves: true }, error: /card #10.*review.*done/ },
  { action: 'move transition', merged: true, record: 'refusing-after-move', error: /card #10.*review.*done.*refused to record/ },
  { action: 'return', ruling: { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' }, seedExtra: { commentReplies: { 11: { status: '403', message: 'the forge refuses the comment' } } }, error: /card #10.*pull request #11.*forge refuses the comment/ },
  { action: 'escalate', ruling: { verdict: 'critical', toSound: 'Keep the user files.' }, extraEnv: () => ({ NODE_OPTIONS: `--import ${refusingAppend("event.layer === 'L2' && event.event === 'review.escalate'", 'review.escalate')}` }), error: /card #10.*critical.*review.escalate/ },
]) {
  test(`once exits non-zero when its ${action} write fails`, async () => {
    const head = '6'.repeat(40);
    const comments = ruling === undefined ? [] : [markerComment({ card: 10, pull: 11, head, body: ADMITTED, ...ruling })];
    const seed = { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: '7'.repeat(40), comments, merged: merged ?? false }], ...seedExtra };
    const ran = once({ items: [card(10, 'Review')], ...board }, { seed, record, extraEnv: extraEnv?.() });

    assert.notEqual(ran.code, 0, ran.out);
    assert.match(ran.err, error);
    if (action === 'return') assert.deepEqual(await columnsOf(ran), { 10: 'Review' });
    if (action === 'move') assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'transition'), []);
  });
}

/** One unclaimed card in review that L2 would dispatch, and one in ready, under N 3. */
const REDO_AND_READY = { items: [card(30, 'Ready'), card(40, 'Review')] };

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, claims the review card', () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  assert.doesNotMatch(ran.err, /#30\b/, ran.err);
  assert.notEqual(ran.code, 0);
});

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, the forge holding nothing for either, moves the review card to coding and leaves the ready card unmoved in the fake board\'s write record', async () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  assert.deepEqual(await movesOf(ran), [['item-2', 'Coding']]);
  assert.deepEqual(await columnsOf(ran), { 30: 'Ready', 40: 'Coding' });
});

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, the forge holding nothing for either, records one L2 transition event in the state directory\'s stream, for the review card, from review to coding', () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  const events = eventsOf(ran);
  assert.ok(events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === 40), JSON.stringify(events));
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event === 'transition').map(({ event, card, from, to }) => ({ event, card, from, to })), [{ event: 'transition', card: 40, from: 'review', to: 'coding' }]);
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event !== 'transition').map(({ event, card }) => ({ event, card })), [{ event: 'review.withheld', card: 40 }]);
});

// proves R-SAFE-5
test('once run against the source tree it is running from exits non-zero, names R-SAFE-5, and claims nothing', async () => {
  // The consumer's repository stands as the package too, so the two are one tree. Git alone may be
  // asked, because naming the tree is the refusal's own work. Every forge call goes through
  // `send`, which records rather than answers, so a board read or a move shows as a call.
  const consumer = consumerRepository();
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    throw new Error(`once ran \`${command}\` before refusing`);
  };
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args].join(' '));
    return { status: 1, stdout: '', stderr: 'no board here' };
  };

  const ran = await onceVerb({ target: consumer, packageRoot: consumer, ask: asked, send });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/);
  assert.deepEqual(sent, []);
  assert.ok(!existsSync(join(consumer, '.rigger')), 'no state directory was opened');
});

// The halt: with the record refusing, `once` starts nothing and says loudly what went unrecorded
// (`ARCHITECTURE.md`, "Failure model").

test('given an event stream that refuses every append from the start, once exits non-zero', () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given an event stream that refuses every append from the start, once leaves every card in the ready column', async () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Ready', 20: 'Ready' }, ran.err);
  assert.deepEqual(await movesOf(ran), []);
});

test('given an event stream that refuses every append from the start, once says in a line of its own which card it did not start, and the sink\'s error', () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /^rigger once: /);
  assert.match(line, /not started/);
  assert.match(line, /EISDIR/, 'the sink\'s own error is named');
});

test('given the board takes a claim move and the sink then refuses its transition event, once exits non-zero', async () => {
  const ran = once({ items: [card(10, 'Ready')] }, { record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given the board takes a claim move and the sink then refuses its transition event, once names the card, the column left, the column entered, and says the move went unrecorded', async () => {
  const ran = once({ items: [card(10, 'Ready')] }, { record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /^rigger once: /);
  assert.match(line, /from ready to coding/);
  assert.match(line, /refused to record/, 'the move went unrecorded');
  assert.match(line, /EISDIR/, 'the sink\'s own error is named');
});

test('--help\'s line for once says it claims one card, provisions its workspace and dispatches its maker', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*once\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /claim one card, provision its workspace and dispatch its maker, then exit/, line);
  assert.doesNotMatch(line, /before M4/, line);
});

// The maker, dispatched through L1 to the stand-in agent (#486).

/**
 * A consumer's repository holding `settings`, its main line on `main`, with a local bare `origin`
 * beside it, in a directory of its own; `files` are committed with the config.
 */
function consumerHolding(settings, files = {}) {
  const directory = temporaryDirectory('rigger-once-maker-');
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`, ...files });
  gitIn(repository, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  return { consumer: withOrigin(repository, origin), origin };
}

/**
 * Starts the real bin's `once` in a consumer's repository holding `settings` and `files`, with the
 * stand-in agent `agent` first on PATH, then a fake `gh` holding `board` over the consumer's
 * `origin`, ahead of the refusing ones `npm test` puts there. `env` is added to the bin's
 * environment. Answers the consumer, its origin, the fake, and `ran`, which settles on the bin's
 * status and what it printed; the bin is ended at the test's teardown if it is still running.
 */
function onceWithAgent(t, agent, board, { settings = config(), files = {}, env = {}, prepare = () => {} } = {}) {
  const { consumer, origin } = consumerHolding(settings, files);
  const dir = temporaryDirectory('rigger-once-maker-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board }, origin });
  prepare({ consumer, origin, fake });
  const child = spawn(process.execPath, [bin, 'once'], { cwd: consumer, env: { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), ...env, PATH: [agent.dir, dir, process.env.PATH].join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const ran = onceEvent(child, 'close').then(([code]) => ({ code, out, err }));
  return { consumer, origin, fake, ran };
}

/** The line `once` prints for card `number` claimed from the consumer's board, with `outcome` and the workspace at its end. */
const makerLine = (consumer, number, outcome) => `rigger once: claimed #${number} from board ${PROJECT}; ${outcome}, in its workspace, ${join(dirname(realpathSync(consumer)), 'widgets-worktrees', `rigger-${number}`)}`;

test('given once over a fake board with one ready card and a stand-in maker exiting 0 with no pull request, once prints one line for the card in the verbs\' form, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent();
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.deepEqual(err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 0 and opened no pull request from rigger-10')]);
});

// proves R-WORK-6
test('given once where the stand-in maker exits 0 and opens a pull request on the fake forge, the card ends in Review, once prints that it is in review naming the pull request, and exits 0', SETTLES_WITHIN, async (t) => {
  // The kind's only judge is the owner, so no later card's judges reach this card.
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.equal(code, 0, err);
  const columns = Object.fromEntries((await (await fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Review' });
  assert.deepEqual(out.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')]);
});

test('given a stand-in that opens a pull request, the world\'s local origin holds the pull request\'s head SHA afterwards', SETTLES_WITHIN, async (t) => {
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { origin, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  await ran;

  const view = spawnSync(fake.gh, ['pr', 'view', '11', '--json', 'headRefOid'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(view.status, 0, view.stderr);
  const { headRefOid } = JSON.parse(view.stdout);
  assert.match(headRefOid, /^[0-9a-f]{40}$/);
  assert.doesNotThrow(() => gitIn(origin, 'cat-file', '-e', headRefOid));
});

/** Put a governed pull request at a local head that a continuing maker can check out. */
const prepareContinuation = ({ ruling = 'reviewer', owner = false, conflicting = false } = {}) => ({ consumer, fake }) => {
  const base = gitIn(consumer, 'rev-parse', 'HEAD').trim();
  const initialBranch = gitIn(consumer, 'symbolic-ref', '--short', 'HEAD').trim();
  gitIn(consumer, 'checkout', '-q', '-b', 'rigger-10');
  gitIn(consumer, 'commit', '-q', '--allow-empty', '-m', 'work for review');
  const oldHead = gitIn(consumer, 'rev-parse', 'HEAD').trim();
  gitIn(consumer, 'push', '-q', 'origin', 'rigger-10');
  gitIn(consumer, 'checkout', '-q', initialBranch);
  const sound = markerComment({ card: 10, pull: 11, head: oldHead, body: ADMITTED });
  const revision = markerComment({ card: 10, pull: 11, head: oldHead, body: ADMITTED, role: ruling, verdict: 'needs revision', items: ['unmet'], toSound: 'Print a help line.' });
  const comments = [owner || conflicting ? sound : revision, ...(owner ? [revision] : [])];
  seedRepository(fake, {
    pullRequests: [{ number: 11, head: 'rigger-10', sha: oldHead, mergeBase: base, diff: 'diff --git a/help b/help\n', comments, mergeable: conflicting ? 'conflicting' : 'mergeable' }],
    mergeable: { 11: conflicting ? 'CONFLICTING' : 'MERGEABLE' },
  });
  return oldHead;
};

// proves R-FAIL-8
test('once names a continuing fetch hold with both failures in order', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent();
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.match(git, /^\//);
  const fixture = join(agent.dir, 'git');
  writeFileSync(fixture, `#!/bin/sh\nif [ "$1" = fetch ]; then echo 'fetch refused by fixture' >&2; exit 128; fi\nexec '${git}' "$@"\n`);
  chmodSync(fixture, 0o755);
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Review')] }, { prepare: prepareContinuation() });

  const { code, err } = await ran;

  assert.notEqual(code, 0, err);
  assert.match(err, /rigger once: card #10 was held after 2 attempts/);
  const failures = err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.equal(failures.length, 2, err);
  assert.ok(failures.every((line) => /fetch refused by fixture/.test(line)), err);
  assert.deepEqual(agent.runs(), []);
});

for (const { column, ruling, owner, conflicting } of [
  { column: 'Review', ruling: 'reviewer' },
  { column: 'Owner', ruling: 'owner', owner: true },
  { column: 'Coding', ruling: 'reviewer' },
  { column: 'Coding', conflicting: true },
]) {
  test(`once continues a ${column} card ${conflicting ? 'with conflicting mergeability' : `on a ${ruling} ruling`} at L2's head`, SETTLES_WITHIN, async (t) => {
    const agent = standInAgent({ 10: { engineer: { push: true } } });
    let oldHead;
    const prepare = (given) => { oldHead = prepareContinuation({ ruling, owner, conflicting })(given); };
    const settings = owner ? { ...config(), kinds: { change: { ...KINDS.change, judges: ['reviewer', 'owner'] } } } : config();
    const { origin, fake, ran } = onceWithAgent(t, agent, { items: [card(10, column)] }, { prepare, settings });

    const { code, out, err } = await ran;
    const head = headIn(origin, 'rigger-10');
    const pull = spawnSync(fake.gh, ['pr', 'view', '11', '--json', 'headRefOid'], { encoding: 'utf8', env: gitEnvironment() });

    assert.equal(code, 0, err);
    assert.match(out, /continued #10 on pull request #11/);
    assert.notEqual(head, oldHead);
    assert.equal(JSON.parse(pull.stdout).headRefOid, head);
    assert.deepEqual((await (await fake.model()).operations.readItems()).map(({ column: held }) => held), ['Review']);
    const maker = agent.runs().find(({ role }) => role === 'engineer');
    assert.ok(maker, JSON.stringify(agent.runs()));
    assert.match(maker.input, /continuing attempt on its open pull request #11/);
    assert.ok(maker.input.includes(oldHead), maker.input);
    if (conflicting) assert.match(maker.input, /reads pull request #11 as conflicting/);
    else {
      assert.match(maker.input, /item 1 unmet: The widget turns blue when pressed\./);
      assert.match(maker.input, /Print a help line\./);
    }
  });
}

test('once exits non-zero when a continuing maker exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { exit: 4 } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Review')] }, { prepare: prepareContinuation() });

  const { code, out, err } = await ran;
  assert.notEqual(code, 0, out);
  assert.match(err, /continued #10 on pull request #11/);
  assert.match(err, /exited 4/);
});

// proves R-WORK-34
test('once names a continuing card whose maker left no checked-out line tip and keeps it in Coding', SETTLES_WITHIN, async (t) => {
  const script = join(temporaryDirectory('rigger-no-tip-'), 'detach.sh');
  writeFileSync(script, '#!/bin/sh\ngit checkout --detach -q HEAD\n');
  chmodSync(script, 0o755);
  const agent = standInAgent({ '*': { engineer: { exec: [script] } } });
  const { fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Review')] }, { prepare: prepareContinuation() });

  const { code, err } = await ran;

  assert.notEqual(code, 0);
  assert.match(err, /card #10.*no readable tip/);
  assert.deepEqual((await (await fake.model()).operations.readItems()).map(({ column }) => column), ['Coding']);
});

test('given once where the maker exits non-zero, once exits non-zero, and prints the card and the exit code', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { exit: 4 } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.deepEqual(err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 4')]);
});

test('given once where the maker does not start, once exits non-zero, and prints the card and why', SETTLES_WITHIN, async (t) => {
  // A settings file the Claude Code adapter cannot read, committed so the workspace holds it.
  const agent = standInAgent();
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { files: { '.claude/settings.json': 'not json' } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const lines = err.split('\n').filter((line) => /#10\b/.test(line));
  assert.equal(lines.length, 1, err);
  assert.match(lines[0], /^rigger once: claimed #10 from board 3; its maker did not start: .*settings\.json is no JSON/);
  assert.match(lines[0], /card was held after 2 attempts/);
  assert.deepEqual(agent.runs(), []);
  const attempts = err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.deepEqual(attempts.map((line) => /^attempt (\d+): /.exec(line)?.[1]), ['1', '2']);
  assert.ok(attempts.every((line) => /settings\.json is no JSON/.test(line)), err);
});

/**
 * The stand-in agent acting as `plan` says, installed in a directory of its own that also holds a
 * `git` answering as the git first on this process's PATH does and, once it has answered a command
 * naming a judge's directory under the consumer's worktree root, replacing the consumer's event
 * stream with a directory of that name, which no append can open: L1 has made the judge's
 * directory, and the record then refuses its event. The consumer is `consumer` beside the root,
 * as `consumerHolding` and the default root place them.
 * The `git` is run once before this returns (`warmed`), exiting before its body, so its first exec
 * is not held inside a run.
 */
function standInRefusingStreamAfterJudgeMake(plan) {
  const dir = temporaryDirectory('rigger-once-judge-git-', { beforeRemoval: () => sweep(dir) });
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.match(git, /^\//, 'no git was found on PATH');
  writeFileSync(join(dir, 'git'), [
    '#!/bin/sh',
    EXIT_IF_WARMING,
    `'${git}' "$@"`,
    'status=$?',
    'for arg in "$@"; do',
    '  case "$arg" in */widgets-worktrees/judges/*) stream="${arg%%/widgets-worktrees/judges/*}/consumer/.rigger/events.jsonl"; rm -f "$stream"; mkdir -p "$stream" ;; esac',
    'done',
    'exit $status',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'git'), 0o755);
  warmed(join(dir, 'git'));
  return installStandInAgent(dir, plan);
}

test('given once where the stand-in maker exits 0 and opens a pull request, and the judge then dispatched under the same claim fails, once prints the claimed line with the maker\'s outcome and the judge\'s failure naming the card and the judge, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The template's `change` kind names `reviewer` as its one judge.
  const agent = standInRefusingStreamAfterJudgeMake({ 10: { engineer: { pr: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const columns = Object.fromEntries((await (await fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Review' }, err);
  const lines = err.split('\n');
  assert.ok(lines.includes(makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')), err);
  assert.ok(lines.some((line) => /^rigger once: card #10's judge `reviewer` handed back no outcome: /.test(line)), err);
});

// proves R-WORK-2
test('while a card\'s maker runs, the fake board\'s write record shows no move of that card by anything but L2, and the stand-in\'s run writes nothing to the board', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { hold: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  await until(() => agent.held(10), t);
  const writesHeld = (await fake.model()).writes();
  const sentHeld = fake.sent().length;
  const transitions = eventsOf({ consumer }).filter((event) => event.layer === 'L2' && event.event === 'transition');
  agent.release(10);
  await ran;

  assert.deepEqual(writesHeld.map(({ operation, args: [, column] }) => ({ operation, column })), [{ operation: 'moveItem', column: 'Coding' }]);
  assert.deepEqual(transitions.map(({ card: number, from, to }) => ({ card: number, from, to })), [{ card: 10, from: 'ready', to: 'coding' }]);
  const run = agent.runs()[0];
  const during = fake.sent().slice(sentHeld);
  assert.deepEqual(during.filter((args) => args.join(' ').includes('mutation')), [], `the stand-in's run (pid ${run.pid}) sent a write`);
  assert.deepEqual((await fake.model()).writes(), writesHeld, 'a move was written after the maker ran');
});

test('once hands loop the process\'s own environment, which reaches the maker, as a variable set only in the bin\'s environment shows', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent();
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { RIGGER_STAND_IN_MARK: 'from-the-bin' } });

  await ran;

  assert.deepEqual(agent.runs().map((run) => run.env), [{ RIGGER_STAND_IN_MARK: 'from-the-bin' }]);
});

/** Every module under src/cli/, by its path from the repository's root. */
const cliModules = () => readdirSync(join(root, 'src', 'cli')).filter((name) => name.endsWith('.mjs')).map((name) => join('src', 'cli', name));

test('no verb hands loop a maker: every loop built under src/cli/ takes no dispatch option', () => {
  const built = [];
  const visit = (node, file) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'loop') {
      const [options] = node.arguments;
      assert.equal(options?.type, 'ObjectExpression', `${file}: loop is handed something other than an object literal`);
      built.push({ file, keys: options.properties.map((property) => property.key?.name ?? property.type) });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((each) => visit(each, file));
      else if (value && typeof value.type === 'string') visit(value, file);
    }
  };
  for (const file of cliModules()) visit(parse(readFileSync(join(root, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), file);

  assert.ok(built.length > 0, 'no loop is built under src/cli/');
  assert.deepEqual(built.filter(({ keys }) => keys.includes('dispatch') || keys.includes('SpreadElement')), []);
});

test('no source file under src/ prints that no maker runs before M4', () => {
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  const saying = files(join(root, 'src')).filter((file) => readFileSync(file, 'utf8').includes('no maker runs before M4'));

  assert.deepEqual(saying, []);
});

// The judges, dispatched through L1 to the stand-in agent under the card's one claim (#490).

/** The line `once` prints for card `number`'s judge `role`, saying `outcome`. */
const judgeLine = (number, role, outcome) => `rigger once: card #${number}'s judge \`${role}\` ${outcome}`;

/** The comments on the fake forge's pull request `number`, and the SHA of its head. */
function pullComments(fake, number) {
  const view = spawnSync(fake.gh, ['pr', 'view', String(number), '--json', 'comments,headRefOid'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(view.status, 0, view.stderr);
  const { comments, headRefOid } = JSON.parse(view.stdout);
  return { head: headRefOid, bodies: comments.map((comment) => comment.body) };
}

test('given once where the maker opens a pull request and the card\'s kind names one agent judge, once prints the judge\'s role and outcome after the card\'s line, and the judge stand-in posts its findings comment on the fake forge', SETTLES_WITHIN, async (t) => {
  // The template's `change` kind names `reviewer` as its one judge.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.deepEqual([...out.split('\n'), ...err.split('\n')].filter((line) => /#10\b/.test(line)), [
    makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
    judgeLine(10, 'reviewer', 'exited 0'),
  ], `${code}\n${err}`);
  const { head, bodies } = pullComments(fake, 11);
  assert.deepEqual(bodies.map((body) => body.split('\n').filter((line) => /^(head|role): /.test(line))), [[`head: ${head}`, 'role: reviewer']]);
});

test('given once where every agent judge exits 0, once exits 0', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, err } = await ran;

  assert.equal(code, 0, err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
});

test('given once where a judge exits non-zero, once prints that judge\'s role and exit code, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { exit: 3 } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'exited 3')), err);
});

test('given once where a judge runs past its time, once prints that judge\'s role and that its time ran out, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The reviewer's time is one second, and its stand-in never exits, so the time ends it.
  const settings = { ...config(), roles: { ...template.roles, reviewer: { ...template.roles.reviewer, timeout: 1000 } } };
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { forever: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'ran past its time, 1000 ms, and was ended')), err);
});

test('given once where a judge is not dispatched because a required step failed in its head, once prints the judge\'s role, the step and the failure, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The step fails only where the newest commit is the stand-in maker's: in the judge's `head`,
  // and never in the maker's workspace, which is made before the maker commits.
  const settings = {
    ...config(),
    kinds: { ...KINDS, change: { ...KINDS.change, provisioning: ['check'] } },
    provisioning: { check: { run: '! git log -1 --format=%s | grep -q "stand-in"', required: true } },
  };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'was not dispatched, because its required step `check` failed in its head: it exited 1')), err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

/**
 * A module the bin's Node process loads first, through `NODE_OPTIONS`, under which the consumer's
 * event stream refuses the appends alone of each event `condition`, JavaScript over `event`, holds
 * for, saying it refuses `what`. It changes `node:fs` itself, and `syncBuiltinESMExports` carries
 * the change to the sink, which imports `appendFileSync` by name, so the sink refuses those appends
 * without knowing it is under test.
 */
function refusingAppend(condition, what) {
  const path = join(temporaryDirectory('rigger-once-refuse-append-'), 'refuse-append.mjs');
  writeFileSync(path, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const { appendFileSync } = fs;',
    'fs.appendFileSync = (path, data, ...rest) => {',
    "  const event = String(path).endsWith('/.rigger/events.jsonl') ? JSON.parse(String(data)) : {};",
    `  if (${condition}) {`,
    `    throw Object.assign(new Error(\`EACCES: the test refuses \${${JSON.stringify(what)}} on \${path}\`), { code: 'EACCES' });`,
    '  }',
    '  return appendFileSync(path, data, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  return path;
}

/** `refusingAppend` for L3's `dispatch` event, its start, of the judge `role` alone. */
const refusingJudgeStart = (role) => refusingAppend(`event.layer === 'L3' && event.event === 'dispatch' && event.role === ${JSON.stringify(role)}`, `L3's dispatch of ${role}`);

test('given once where a judge\'s start event is refused, once prints the judge\'s role and the refused event, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { NODE_OPTIONS: `--import ${refusingJudgeStart('reviewer')}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const lines = err.split('\n');
  assert.ok(lines.includes(makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')), err);
  assert.ok(lines.includes(judgeLine(10, 'reviewer', 'handed back no outcome: card #10\'s role `reviewer` was not started, because the event sink refused to record its start: EACCES: the test refuses L3\'s dispatch of reviewer on '
    + `${join(realpathSync(consumer), '.rigger', 'events.jsonl')}`)), err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once over a Review card whose every agent judge has findings at the head, once dispatches nothing for it, and prints nothing for it but that no card was pullable', SETTLES_WITHIN, async (t) => {
  // The first `once` leaves #10 in Review with the reviewer's findings at its head; the second
  // runs over the same repository and the same fake forge, as the first left them.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const first = await ran;
  assert.equal(first.code, 0, first.err);
  const { head, bodies } = pullComments(fake, 11);
  assert.deepEqual(bodies.map((body) => body.split('\n').filter((line) => /^(head|role): /.test(line))), [[`head: ${head}`, 'role: reviewer']], 'the first once left no marker at the head, so the test proves nothing');
  const before = eventsOf({ consumer }).length;

  const again = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });

  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual([...again.stdout.split('\n'), ...again.stderr.split('\n')].filter(Boolean), [`rigger once: from board ${PROJECT}, no card was pullable`]);
  const later = eventsOf({ consumer }).slice(before);
  assert.ok(later.some((event) => event.layer === 'L3' && event.event === 'trigger'), 'the second once recorded nothing, so the test proves nothing');
  assert.deepEqual(later.filter((event) => (event.layer === 'L3' && event.event === 'dispatch') || (event.layer === 'L1' && event.event === 'dispatch.start')), []);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
});

/** The roles of every L3 `dispatch` event in `events` that names one, in order. */
const rolesDispatched = (events) => events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role !== undefined).map((event) => event.role);

test('given once over a board holding one ready type:spike card, the maker dispatched is spikeEngineer\'s agent file and its judge reviewer\'s, as the stand-in\'s recorded prompt and arguments show', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { 'spike-engineer': { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready', { labels: ['type:spike'] })] });

  const { code, err } = await ran;

  assert.equal(code, 0, err);
  const runs = agent.runs().map(({ args, input, cwd }) => ({ agentFile: args[args.indexOf('--append-system-prompt-file') + 1], input, cwd }));
  assert.equal(runs.length, 2, JSON.stringify(runs));
  const [maker, judge] = runs;
  assert.equal(maker.agentFile, join(maker.cwd, '.claude', 'agents', 'spike-engineer.md'));
  assert.match(maker.input, /^Rigger dispatched this session, unattended, as the maker for card #10\./);
  assert.equal(judge.agentFile, join(judge.cwd, '.claude', 'agents', 'reviewer.md'));
  assert.match(judge.input, /^Rigger dispatched this session, unattended, as the judge `reviewer` of pull request #11, /);
});

// proves R-LOOP-11
test('given once over a type:spec card whose kind names owner beside its agent judges, no L3 dispatch event and no L1 dispatch.start names the role owner, and once prints that the owner judges last', SETTLES_WITHIN, async (t) => {
  // The template's `spec` kind names `reviewer`, `engineer` and `architect`, then `owner`.
  const agent = standInAgent({ 10: { pm: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready', { labels: ['type:spec'] })] });

  const { code, out, err } = await ran;

  assert.equal(code, 0, err);
  const events = eventsOf({ consumer });
  assert.deepEqual(rolesDispatched(events).sort(), ['architect', 'engineer', 'pm', 'reviewer']);
  const starts = events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start');
  assert.equal(starts.length, 4, JSON.stringify(starts));
  assert.deepEqual(starts.filter((event) => /\bowner\b/.test(JSON.stringify(event))), []);
  assert.ok(out.split('\n').includes(judgeLine(10, 'owner', 'judges last, once every agent judge is satisfied, and Rigger never dispatches it')), out);
});

test('given once over a Review card whose agent judge has no findings at the head, once pulls it for its judges alone, prints that and the judge\'s line, and exits 0 once the judge exits 0', SETTLES_WITHIN, async (t) => {
  // The first `once` leaves #10 in Review with a reviewer that exited 3 and wrote no findings; the
  // second runs over the same repository and the same fake forge, its reviewer writing them.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { exit: 3 } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const first = await ran;
  assert.ok(first.err.split('\n').includes(judgeLine(10, 'reviewer', 'exited 3')), first.err);
  agent.plan(10, 'reviewer', { findings: true });

  const again = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });

  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.stdout.split('\n').filter((line) => /#10\b/.test(line)), [
    `rigger once: claimed #10 from board ${PROJECT} for its judges alone`,
    judgeLine(10, 'reviewer', 'exited 0'),
  ]);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer', 'reviewer']);
});

test('given once where a judge does not start, once prints the judge\'s role and why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // A Bash rule for a compound command line admits nothing, and the Claude Code adapter refuses it
  // only for a role that reaches a directory, as a judge reaches its `head` and the maker reaches none.
  const files = { '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm ci && npm test)'] } }) };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { files });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'did not start: the role\'s dispatch did not start: the claude adapter answered no invocation for role reviewer: ')), line);
  assert.match(line, /Bash\(npm ci && npm test\), a rule for a compound command line/, line);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once where a judge is dispatched and its dispatch then fails, once prints the judge\'s role and the failure, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // L1's start of the judge's dispatch is refused: of the role dispatches, only a judge's carries the facts of the head it rules on.
  const preload = refusingAppend("event.layer === 'L1' && event.event === 'dispatch.start' && event.facts !== undefined", 'L1\'s start of a judge\'s dispatch');
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { NODE_OPTIONS: `--import ${preload}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'was dispatched, and its dispatch failed: ')), line);
  // L1's failure names the refused event on the lines after its first.
  assert.match(line, /the sink refused 1 L1 event\(s\) of dispatch d-[0-9a-f-]+, card #10, so they went unrecorded:$/, line);
  assert.match(err, /EACCES: the test refuses L1's start of a judge's dispatch on /, err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once where a judge\'s directory cannot be made, once prints the judge\'s role and why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // A plain file where the judges' directories go, beside the workspaces under the default root.
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const root = join(dirname(consumer), 'widgets-worktrees');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'judges'), 'not a directory');

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'was not dispatched, because its directory could not be made: ')), line);
  assert.match(line, /judges\/rigger-10\/reviewer/, line);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

// A card whose judges are mixed, one handing back beside one whose start event is refused (#612).

/** The config with the `change` kind naming `judges`, in that order, each run with no provisioning step unless `provisioning` names one. */
const judgedBy = (judges, { provisioning, roles } = {}) => ({
  ...config(),
  ...(roles === undefined ? {} : { roles: { ...template.roles, ...roles } }),
  ...(provisioning === undefined ? {} : { provisioning }),
  kinds: { ...KINDS, change: { ...KINDS.change, judges, provisioning: provisioning === undefined ? [] : Object.keys(provisioning) } },
});

/** The start of the line `once` prints for card #10's judge `role` whose start event the preload refused. */
const refusedLine = (role) => judgeLine(10, role, `handed back no outcome: card #10's role \`${role}\` was not started, because the event sink refused to record its start: EACCES: the test refuses L3's dispatch of ${role} on `);

/**
 * Every line `once` printed naming card #10, each line that starts as `starts` holds being read as
 * that start, so a line naming the consumer's own path is compared without it.
 */
const linesOf10 = (out, err, starts = []) => [...out.split('\n'), ...err.split('\n')]
  .filter((line) => /#10\b/.test(line))
  .map((line) => starts.find((start) => line.startsWith(start)) ?? line);

for (const [judges, first, second] of [[['reviewer', 'architect'], 'handed back', 'refused'], [['architect', 'reviewer'], 'refused', 'handed back']]) {
  test(`given once over a card whose judges are ${judges.join(' then ')}, the reviewer exiting 0 and the architect's start event refused, once prints a line for each judge in the order L2 named them, the ${first} one first and the ${second} one second, and exits non-zero`, SETTLES_WITHIN, async (t) => {
    const agent = standInAgent({ 10: { engineer: { pr: true } } });
    const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(judges), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

    const { code, out, err } = await ran;

    assert.notEqual(code, 0, out);
    const judgeLines = { reviewer: judgeLine(10, 'reviewer', 'exited 0'), architect: refusedLine('architect') };
    assert.deepEqual(linesOf10(out, err, [refusedLine('architect')]), [
      makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
      ...judges.map((role) => judgeLines[role]),
    ], err);
  });
}

test('given once over a card whose judges are reviewer, architect and pm, the reviewer exiting 0, the architect\'s start event refused and the pm withheld for a required step failing in its head, once prints each judge\'s line in that order, the failure and the withholding each with why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The step fails only in the head of the judge directory named `pm`: `<root>/judges/rigger-10/pm/head`.
  const provisioning = { check: { run: 'test "$(basename "$(dirname "$PWD")")" != pm', required: true } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(['reviewer', 'architect', 'pm'], { provisioning }), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  // The preload refuses every L3 dispatch naming the architect, so the step in its head is the start refused.
  const architect = judgeLine(10, 'architect', 'handed back no outcome: card #10\'s step `check` was not started, because the event sink refused to record its start: EACCES: the test refuses L3\'s dispatch of architect on ');
  assert.deepEqual(linesOf10(out, err, [architect]), [
    makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
    judgeLine(10, 'reviewer', 'exited 0'),
    architect,
    judgeLine(10, 'pm', 'was not dispatched, because its required step `check` failed in its head: it exited 1'),
  ], err);
});

for (const [plan, roles, said] of [
  [{ exit: 3 }, undefined, 'exited 3'],
  [{ forever: true }, { reviewer: { ...template.roles.reviewer, timeout: 1000 } }, 'ran past its time, 1000 ms, and was ended'],
]) {
  test(`given once over a card whose reviewer hands back, ${said}, beside an architect whose start event is refused, once prints the reviewer's line as it says that outcome, and exits non-zero`, SETTLES_WITHIN, async (t) => {
    const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: plan } });
    const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(['reviewer', 'architect'], { roles }), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

    const { code, out, err } = await ran;

    assert.notEqual(code, 0, out);
    assert.deepEqual(linesOf10(out, err, [refusedLine('architect')]), [
      makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
      judgeLine(10, 'reviewer', said),
      refusedLine('architect'),
    ], err);
  });
}

test('the agent CLI stand-in, once installed, has recorded no run, and its directory holds only itself', () => {
  const dir = temporaryDirectory('rigger-warming-agent-');

  const agent = installAgentCli(dir);

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(dir).sort(), ['claude']);
});

test('the stand-in that refuses the stream once a judge\'s directory is made, once made, has recorded no run, and its directory holds only its git, itself and its plan', () => {
  const agent = standInRefusingStreamAfterJudgeMake({});

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(agent.dir).sort(), ['claude', 'git', 'plan.json']);
});

for (const { row, extra, code, column, line } of [
  { row: 'the forge merges it', extra: {}, code: 0, column: 'Done', line: /card #10 merged pull request #11\b/ },
  { row: 'the forge answers it closed', extra: { pullStates: { 11: 'closed' } }, code: 1, column: 'Review', line: /card #10 did not merge pull request #11: refused, closed/ },
]) {
  test(`once, given a Review card whose judge is sound and whose pull request is mergeable, makes the merge, and where ${row} prints so and exits ${code}`, async () => {
    const head = '6'.repeat(40);
    const comments = [markerComment({ card: 10, pull: 11, head, body: ADMITTED })];
    const seed = { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: '7'.repeat(40), comments }], mergeable: { 11: 'MERGEABLE' }, ...extra };

    const ran = once({ items: [card(10, 'Review')] }, { seed });

    assert.equal(ran.code, code, `${ran.out}\n${ran.err}`);
    // A verb exiting non-zero says what it did on standard error.
    assert.match(code === 0 ? ran.out : ran.err, line);
    assert.deepEqual(await columnsOf(ran), { 10: column });
    assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'merge.end').map(({ card: number, outcome }) => ({ number, outcome })), [{ number: 10, outcome: code === 0 ? 'merged' : 'refused' }]);
  });
}

test('once, given two Review cards each ready to merge, finishes one card: it merges the first in pull order and leaves the other in Review', async () => {
  const head = (card) => String(card).padStart(40, '6');
  const pullRequest = (card, number) => ({ number, head: `rigger-${card}`, sha: head(card), mergeBase: '7'.repeat(40), comments: [markerComment({ card, pull: number, head: head(card), body: ADMITTED })] });
  const seed = { pullRequests: [pullRequest(10, 11), pullRequest(20, 21)], mergeable: { 11: 'MERGEABLE', 21: 'MERGEABLE' } };

  const ran = once({ items: [card(10, 'Review'), card(20, 'Review')] }, { seed });

  assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
  assert.deepEqual(await columnsOf(ran), { 10: 'Done', 20: 'Review' });
  assert.match(ran.out, /card #10 merged pull request #11\b/);
  assert.doesNotMatch(ran.out, /#20/);
});

test('once dispatches and writes nothing for labelled unmerged cards across active stages and selection conflicts', SETTLES_WITHIN, async () => {
  const cases = [
    { labels: ['type:change'], body: ADMITTED },
    { labels: ['type:change'], body: '' },
    { labels: ['type:change'], title: 'Paint a widget', body: '## Acceptance\n\n- Paint a widget.\n' },
    { labels: ['area:other'], body: ADMITTED },
    { labels: ['type:change', 'type:spec'], body: ADMITTED },
    { labels: ['type:change', 'type:epic'], body: ADMITTED },
    { labels: ['type:change', 'tier:standard', 'tier:high'], body: ADMITTED },
    { labels: ['type:change', 'provider:claude', 'provider:codex'], body: ADMITTED },
  ];
  const settings = config();
  settings.roles = { ...settings.roles, engineer: { ...settings.roles.engineer,
    labels: { 'tier:standard': 'standard', 'tier:high': 'high' },
    providerLabels: { 'provider:claude': 'claude', 'provider:codex': 'codex' } } };
  const items = [];
  for (const column of ['Ready', 'Coding', 'Review', 'Owner']) {
    for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
      for (const each of cases) items.push(card(items.length + 1, column, { ...each, labels: [...each.labels, label] }));
    }
  }
  const ran = once({ items }, { settings,
    seed: { branches: items.filter((item) => item.number % 2).map((item) => `rigger-${item.number}`) } });
  assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
  assert.match(ran.out, /no card was pullable/);
  assert.deepEqual(ran.agentRuns(), []);
  assert.deepEqual((await ran.model()).writes(), []);
  assert.deepEqual(await columnsOf(ran), Object.fromEntries(items.map((item) => [item.number, item.column])));
  assert.equal(existsSync(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees')), false);
  const events = existsSync(join(ran.consumer, '.rigger', 'events.jsonl')) ? eventsOf(ran) : [];
  assert.deepEqual(events.filter(({ event }) => /dispatch|escalat|transition/.test(event)), []);
  for (const args of ran.fake.sent()) {
    assert.equal(args[0], 'api', JSON.stringify(args));
    if (args[1] === 'graphql') {
      assert.ok(parseDocument(args[3].slice('query='.length)).operations.every(({ type }) => type === 'query'), JSON.stringify(args));
    } else {
      assert.equal(args[args.indexOf('-X') + 1], 'GET', JSON.stringify(args));
    }
  }
});

// proves R-ESCALATE-11
test('once reads the owner removing an escalation label before its next invocation and resumes ordinary work', async () => {
  const ran = once({ items: [card(151, 'Ready', { labels: ['type:change', 'RIGGER:ESCALATED'] })] });
  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(ran.agentRuns(), []);
  setEscalationLabel(ran.fake);

  const resumed = ran.rerun();

  assert.equal(resumed.code, 1, `${resumed.out}\n${resumed.err}`);
  assert.match(resumed.err, /claimed #151.*maker exited 0 and opened no pull request/, resumed.err);
  assert.equal(resumed.agentRuns().length, 1);
  assert.deepEqual(await columnsOf(resumed), { 151: 'Coding' });
  assert.equal(existsSync(join(dirname(realpathSync(resumed.consumer)), 'widgets-worktrees', 'rigger-151')), true);
  const after = await (await resumed.model()).operations.readItems();
  assert.deepEqual(after[0].labels, ['type:change']);
});

/** A labelled card with a merged PR and a real workspace holding an uncommitted marker. */
function labelledMerge(column, branch, label) {
  const worktrees = temporaryDirectory('rigger-once-escalated-merge-');
  const path = join(worktrees, 'rigger-161');
  const settings = { ...config(), worktrees: { root: worktrees } };
  const ran = once({ items: [card(161, column, { labels: ['type:change', label] })] }, {
    settings,
    seed: { branches: branch ? ['rigger-161'] : [], pullRequests: [{ number: 162, head: 'rigger-161', sha: '6'.repeat(40), merged: true }] },
    prepare: ({ consumer }) => {
      worktreeAt(consumer, path, 'rigger-161');
      writeFileSync(join(path, 'marker'), 'uncommitted fixture\n');
    },
  });
  return { ran, path };
}

// proves R-ESCALATE-10
test('once cleans a labelled merged Review or Owner card before moving it to Done', async () => {
  for (const column of ['Review', 'Owner']) {
    for (const branch of [false, true]) {
      for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
        const { ran, path } = labelledMerge(column, branch, label);
        assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
        assert.deepEqual(await columnsOf(ran), { 161: 'Done' });
        assert.equal(existsSync(path), false, path);
        assert.equal(worktreeList(ran.consumer).includes(path), false);
        assert.deepEqual(ran.agentRuns(), []);
        const events = eventsOf(ran);
        const removed = events.findIndex(({ event, path: at }) => event === 'workspace.removed' && at === path);
        const done = events.findIndex(({ event, to }) => event === 'transition' && to === 'done');
        assert.ok(removed >= 0 && done > removed, JSON.stringify(events));
      }
    }
  }
});

// proves R-ESCALATE-10
test('once preserves a labelled merged Ready or Coding card workspace under its existing forge refusal', async () => {
  for (const column of ['Ready', 'Coding']) {
    for (const branch of [false, true]) {
      for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
        const { ran, path } = labelledMerge(column, branch, label);
        assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
        assert.match(`${ran.out}\n${ran.err}`, /forge holds pull request #162, merged/);
        assert.equal(readFileSync(join(path, 'marker'), 'utf8'), 'uncommitted fixture\n');
        assert.ok(worktreeList(ran.consumer).includes(path));
        assert.deepEqual(await columnsOf(ran), { 161: column });
        assert.deepEqual((await ran.model()).writes(), []);
        assert.deepEqual(ran.agentRuns(), []);
        const events = existsSync(join(ran.consumer, '.rigger', 'events.jsonl')) ? eventsOf(ran) : [];
        assert.equal(events.some(({ event }) => event === 'workspace.removed'), false);
      }
    }
  }
});

test('once leaves merged labelled epics and unselected cards unpulled in every active stage', async () => {
  const items = ['Ready', 'Coding', 'Review', 'Owner'].map((column, at) =>
    card(171 + at, column, { labels: [...(at % 2 ? ['type:change', 'type:epic'] : ['area:other']), 'rigger:escalated'] }));
  const ran = once({ items }, { seed: { pullRequests: items.map(({ number }) => ({ number: number + 100, head: `rigger-${number}`, sha: '6'.repeat(40), merged: true })) } });
  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /no card was pullable/);
  assert.deepEqual(ran.agentRuns(), []);
  assert.deepEqual((await ran.model()).writes(), []);
  assert.equal(existsSync(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees')), false);
});

/** Checks a labelled card against the fresh maker that starts once a person clears its label. */
async function withheldDispatch(column) {
    for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
      const ran = once({ items: [card(181, column, { labels: ['type:change', label] })] });
      assert.equal(ran.code, 0, `${column}: ${ran.out}\n${ran.err}`);
      assert.match(ran.out, /no card was pullable/);
      assert.deepEqual(ran.agentRuns(), []);
      assert.deepEqual((await ran.model()).writes(), []);
      assert.deepEqual(await columnsOf(ran), { 181: column });
      assert.equal(existsSync(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees')), false);
      setEscalationLabel(ran.fake);

      const resumed = ran.rerun();

      assert.equal(resumed.code, 1, `${column}: ${resumed.out}\n${resumed.err}`);
      assert.match(resumed.err, /claimed #181.*maker exited 0 and opened no pull request/);
      assert.equal(resumed.agentRuns().length, 1);
      assert.deepEqual(await columnsOf(resumed), { 181: 'Coding' });
      assert.equal(existsSync(join(dirname(realpathSync(resumed.consumer)), 'widgets-worktrees', 'rigger-181')), true);
    }
}

/** Checks a labelled card against a governed continuation that starts once its label is cleared. */
async function withheldContinuation(t, column) {
    for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
      const agent = standInAgent({ 10: { engineer: { push: true }, reviewer: { exit: 3 } } });
      const owner = column === 'Owner';
      const settings = owner ? { ...config(), kinds: { change: { ...KINDS.change, judges: ['reviewer', 'owner'] } } } : config();
      const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, column, { labels: ['type:change', label] })] },
        { settings, prepare: prepareContinuation({ ruling: owner ? 'owner' : 'reviewer', owner }) });
      const invoke = () => spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8',
        env: { ...process.env, PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });

      const waiting = await ran;

      assert.equal(waiting.code, 0, `${column}: ${waiting.out}\n${waiting.err}`);
      assert.match(waiting.out, /no card was pullable/);
      assert.deepEqual(agent.runs(), []);
      assert.deepEqual((await fake.model()).writes(), []);
      assert.equal((await (await fake.model()).operations.readItems())[0].column, column);
      assert.deepEqual(eventsOf({ consumer }).filter(({ event }) => /dispatch|escalat|transition/.test(event)), []);
      setEscalationLabel(fake);

      const resumed = invoke();

      assert.equal(resumed.status, 1, `${column}: ${resumed.stdout}\n${resumed.stderr}`);
      assert.match(resumed.stderr, /continued #10 on pull request #11/);
      assert.match(resumed.stderr, /judge `reviewer` exited 3/);
      assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
      assert.equal((await (await fake.model()).operations.readItems())[0].column, 'Review');
    }
}

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise dispatchable labelled Ready card until its label is removed', SETTLES_WITHIN, () => withheldDispatch('Ready'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise dispatchable labelled Coding card until its label is removed', SETTLES_WITHIN, () => withheldDispatch('Coding'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise dispatchable labelled Review card until its label is removed', SETTLES_WITHIN, () => withheldDispatch('Review'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise continuing labelled Coding card until its label is removed', SETTLES_WITHIN, (t) => withheldContinuation(t, 'Coding'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise continuing labelled Review card until its label is removed', SETTLES_WITHIN, (t) => withheldContinuation(t, 'Review'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise continuing labelled Owner card until its label is removed', SETTLES_WITHIN, (t) => withheldContinuation(t, 'Owner'));


/** Changes only the label whose removal is the owner's acknowledgement. */
function setEscalationLabel(fake, label) {
  const state = join(dirname(fake.gh), 'board.json');
  const held = JSON.parse(readFileSync(state, 'utf8'));
  const item = held.model.items[0];
  item.labels = ['type:change', ...(label === undefined ? [] : [label])];
  const repository = (item.repository ?? held.repo).toLowerCase();
  const issue = held.repository?.issues?.find((candidate) => candidate.number === item.number
    && (candidate.repository ?? held.repo).toLowerCase() === repository);
  if (issue !== undefined) issue.labels = [...item.labels];
  writeFileSync(state, JSON.stringify(held));
}

/** Checks a genuinely mergeable or critical Owner card before and after the owner clears its label. */
async function withheldOpenPullAction(action) {
  for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
    const head = '6'.repeat(40);
    const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['reviewer', 'owner'] } } };
    const owner = action === 'merge' ? {} : { verdict: 'critical', toSound: 'Keep the user files.' };
    const comments = [markerComment({ card: 10, pull: 11, head, body: ADMITTED }),
      markerComment({ card: 10, pull: 11, head, body: ADMITTED, role: 'owner', ...owner })];
    const seed = { pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: '7'.repeat(40), comments }],
      mergeable: { 11: 'MERGEABLE' } };
    const ran = once({ items: [card(10, 'Owner', { labels: ['type:change', label] })] }, { settings, seed });

    assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
    assert.match(ran.out, /no card was pullable/);
    assert.deepEqual(ran.agentRuns(), []);
    assert.deepEqual((await ran.model()).writes(), []);
    assert.deepEqual(await columnsOf(ran), { 10: 'Owner' });
    assert.deepEqual(ran.fake.sent().filter(([verb, path]) => verb === 'api' && path === 'repos/acme/widgets/pulls/11/merge'), []);
    assert.equal(existsSync(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees')), false);
    assert.deepEqual(eventsOf(ran).filter(({ event }) => /dispatch|escalat|transition|workspace|merge/.test(event)), []);
    setEscalationLabel(ran.fake);

    const resumed = ran.rerun();

    assert.equal(resumed.code, 0, `${resumed.out}\n${resumed.err}`);
    if (action === 'merge') {
      assert.match(resumed.out, /card #10 merged pull request #11/);
      assert.deepEqual(resumed.fake.sent().filter(([verb, path]) => verb === 'api' && path === 'repos/acme/widgets/pulls/11/merge'),
        [['api', 'repos/acme/widgets/pulls/11/merge', '-X', 'PUT', '-f', `sha=${head}`, '-f', 'merge_method=merge']]);
      assert.deepEqual(eventsOf(resumed).filter(({ event }) => event === 'merge.end').map(({ outcome }) => outcome), ['merged']);
      assert.deepEqual(await columnsOf(resumed), { 10: 'Done' });
    } else {
      assert.match(resumed.out, /#10.*escalate.*critical/);
      assert.deepEqual(eventsOf(resumed).filter(({ event }) => event === 'review.escalate').map(({ category }) => category), ['critical']);
      assert.deepEqual(await columnsOf(resumed), { 10: 'Owner' });
    }
  }
}

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise owed Review judge on an open pull until its label is removed', SETTLES_WITHIN, async (t) => {
  for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
    const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { exit: 3 } } });
    const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
    const made = await ran;
    assert.equal(made.code, 1, `${made.out}\n${made.err}`);
    assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
    assert.equal((await (await fake.model()).operations.readItems())[0].column, 'Review');
    const writesBefore = (await fake.model()).writes();
    const eventsBefore = eventsOf({ consumer });
    const invoke = () => spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8',
      env: { ...process.env, PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });
    setEscalationLabel(fake, label);

    const waiting = invoke();

    assert.equal(waiting.status, 0, `${waiting.stdout}\n${waiting.stderr}`);
    assert.match(waiting.stdout, /no card was pullable/);
    assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
    assert.deepEqual((await fake.model()).writes(), writesBefore);
    assert.equal((await (await fake.model()).operations.readItems())[0].column, 'Review');
    assert.deepEqual(eventsOf({ consumer }).slice(eventsBefore.length).filter(({ event }) => /dispatch|escalat|transition|workspace|merge/.test(event)), []);
    setEscalationLabel(fake);

    const resumed = invoke();

    assert.equal(resumed.status, 1, `${resumed.stdout}\n${resumed.stderr}`);
    assert.match(resumed.stderr, /judge `reviewer` exited 3/);
    assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer', 'reviewer']);
    assert.deepEqual(eventsOf({ consumer }).slice(eventsBefore.length).filter(({ event, role }) => event === 'dispatch' && role !== undefined).map(({ role }) => role), ['reviewer']);
  }
});

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise admitted Owner merge on an open pull until its label is removed', SETTLES_WITHIN, () => withheldOpenPullAction('merge'));

// proves R-ESCALATE-10, R-ESCALATE-11
test('once withholds an otherwise critical Owner escalation on an open pull until its label is removed', SETTLES_WITHIN, () => withheldOpenPullAction('escalate'));


test('the owner label control updates seeded issue facts by repository and issue identity', () => {
  // #860's seedRepository/boardOf at bb41bb5 shares these actual issue facts with board reads.
  const fake = installFakeGh(temporaryDirectory('rigger-owner-label-control-'), {
    repo: REPO, project: PROJECT,
    board: { columns: COLUMNS, items: [card(10, 'Owner', { labels: ['type:change', 'RIGGER:ESCALATED'] })] },
  });
  seedRepository(fake, { issues: [
    { number: 10, repository: 'ACME/WIDGETS', labels: ['type:change', 'RIGGER:ESCALATED'], body: 'Keep the owner evidence.' },
    { number: 10, repository: 'someone/widgets', labels: ['foreign', 'rigger:escalated'] },
    { number: 11, repository: REPO, labels: ['other', 'rigger:escalated'] },
  ] });
  const state = join(dirname(fake.gh), 'board.json');
  const before = JSON.parse(readFileSync(state, 'utf8'));

  setEscalationLabel(fake);

  const cleared = JSON.parse(readFileSync(state, 'utf8'));
  assert.deepEqual(cleared.repository.issues, [
    { ...before.repository.issues[0], labels: ['type:change'] },
    before.repository.issues[1], before.repository.issues[2],
  ]);
  assert.deepEqual(cleared.model.items[0].labels, ['type:change']);
  assert.deepEqual({ ...cleared, model: before.model, repository: before.repository }, before);

  setEscalationLabel(fake, 'rigger:escalated');

  const labelled = JSON.parse(readFileSync(state, 'utf8'));
  assert.deepEqual(labelled.repository.issues[0], { ...before.repository.issues[0], labels: ['type:change', 'rigger:escalated'] });
  assert.deepEqual(labelled.repository.issues.slice(1), before.repository.issues.slice(1));
  assert.deepEqual(labelled.model.items[0].labels, ['type:change', 'rigger:escalated']);
});


// proves R-WORK-36
test('once reports the ordinary refusal after closed cleanup exactly once with the existing refusal exit status', async () => {
  const directory = temporaryDirectory('rigger-once-closed-refusal-');
  const settings = config();
  settings.worktrees = { ...settings.worktrees, root: directory };
  const scratch = join(directory, 'scratch', 'rigger-91', 'reviewer');
  const ran = once({ items: [card(91, 'Review', { body: 'No acceptance.' })] }, { settings,
    seed: { pullRequests: [{ number: 1091, head: 'rigger-91', sha: 'a'.repeat(40), closed: true }] },
    prepare: () => {
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, 'cleanup-witness.txt'), 'closed card scratch');
      assert.equal(existsSync(scratch), true, 'actual scratch exists before once');
    },
  });
  assert.equal(existsSync(scratch), false, 'closed cleanup removes actual scratch before the ordinary once refusal');
  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, /rigger once: card #91 refused: missing acceptance/);
  assert.equal((ran.out.match(/missing acceptance/g) ?? []).length, 1, ran.out);
  assert.doesNotMatch(ran.out, /undefined|no card was pullable|judges alone/);
  assert.deepEqual(ran.agentRuns(), []);
  assert.deepEqual((await ran.model()).writes(), []);
  assert.deepEqual((await (await ran.model()).operations.readItems()).map(({ number, column }) => [number, column]), [[91, 'Review']]);
  const state = JSON.parse(readFileSync(join(dirname(ran.fake.gh), 'board.json'), 'utf8'));
  assert.equal((state.repository.issues[0].comments ?? []).length, 0);
  assert.deepEqual(state.repository.issues[0].labels, ['type:change']);
});


import { lockWorktreeAt } from './git-repository.mjs';

// proves R-WORK-36, R-WORK-38
test('once and run report the ordinary Owner result plus every real remaining cleanup path and wait for label acknowledgement', SETTLES_WITHIN, async () => {
  const number = 92;
  const directory = temporaryDirectory('rigger-once-closed-remaining-');
  const settings = config();
  settings.worktrees = { ...settings.worktrees, root: directory };
  const workspace = join(directory, `rigger-${number}`);
  const escalation = join(directory, 'escalations', `rigger-${number}`, 'reviewer', 'main');
  const ran = once({ items: [card(number, 'Owner')] }, { settings,
    seed: { pullRequests: [{ number: 1092, head: `rigger-${number}`, sha: 'a'.repeat(40), closed: true }] },
    prepare: ({ consumer }) => {
      worktreeAt(consumer, workspace, `rigger-${number}`, '--lock', '--reason', 'workspace held by a person');
      detachedWorktreeAt(consumer, escalation, gitIn(consumer, 'rev-parse', 'HEAD').trim());
      lockWorktreeAt(consumer, escalation, 'escalation held by a person');
    },
  });
  assert.equal(ran.code, 1);
  const text = ran.out + ran.err;
  assert.match(text, /rigger once: card #92 escalated ambiguous/);
  for (const path of [workspace, escalation]) assert.ok(text.includes(path), `lost remaining path ${path}: ${text}`);
  assert.match(text, /workspace held by a person/);
  assert.match(text, /escalation held by a person/);
  assert.doesNotMatch(text, /undefined/);
  assert.deepEqual(ran.agentRuns(), []);
  assert.equal(existsSync(workspace), true);
  assert.equal(existsSync(escalation), true);
  const before = JSON.parse(readFileSync(join(dirname(ran.fake.gh), 'board.json'), 'utf8')).repository;
  assert.equal(before.issues[0].comments.length, 1);
  assert.deepEqual(before.issues[0].labels, ['type:change', 'rigger:escalated']);
  const waiting = ran.rerun();
  assert.equal(waiting.code, 0, waiting.err);
  assert.match(waiting.out, /no card was pullable/);
  setEscalationLabel(ran.fake, undefined);
  const run = spawnSync(process.execPath, [bin, 'run'], { cwd: ran.consumer, encoding: 'utf8', env: { ...gitEnvironment(), CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-run-closed-home-'), PATH: `${dirname(ran.fake.gh)}${delimiter}${process.env.PATH}` } });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 1);
  const runText = run.stdout + run.stderr;
  assert.match(runText, /rigger run: card #92 escalated ambiguous/);
  for (const path of [workspace, escalation]) assert.ok(runText.includes(path), `run lost ${path}`);
  assert.doesNotMatch(runText, /undefined/);
  const after = JSON.parse(readFileSync(join(dirname(ran.fake.gh), 'board.json'), 'utf8')).repository;
  assert.equal(after.issues[0].comments.length, 2, 'the fresh eligible run really attempted its ordinary action');
  assert.deepEqual(after.issues[0].labels, ['type:change', 'rigger:escalated']);
  assert.equal(existsSync(workspace), true);
  assert.equal(existsSync(escalation), true);
  assert.deepEqual(ran.agentRuns(), []);
});


// proves R-WORK-36
test('once removes closed history directories before Coding and a normal redo opens its new pull without removing that new workspace', SETTLES_WITHIN, async (t) => {
  const number = 93;
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const agent = standInAgent({ [number]: { engineer: { pr: true } } });
  let path;
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(number, 'Review')] }, { settings,
    prepare: ({ consumer, fake }) => {
      path = join(dirname(consumer), 'widgets-worktrees', `rigger-${number}`);
      worktreeAt(consumer, path, `rigger-${number}`);
      writeFileSync(join(path, 'old-attempt.txt'), 'closed attempt content');
      seedRepository(fake, { pullRequests: [{ number: 1093, head: `rigger-${number}`, sha: gitIn(consumer, 'rev-parse', 'HEAD').trim(), closed: true }] });
    },
  });
  const result = await ran;
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /its maker exited 0 and pull request #1094 is open from rigger-93/);
  assert.doesNotMatch(result.out + result.err, /undefined/);
  assert.equal(existsSync(path), true);
  assert.equal(existsSync(join(path, 'old-attempt.txt')), false);
  assert.deepEqual(agent.runs().map(({ card, role }) => [card, role]), [[number, 'engineer']]);
  const events = readEvents(join(consumer, '.rigger'));
  const removed = events.findIndex((event) => event.layer === 'L1' && event.event === 'workspace.removed' && event.path === path);
  const coding = events.findIndex((event) => event.event === 'transition' && event.to === 'coding');
  const made = events.findIndex((event) => event.layer === 'L1' && event.event === 'workspace.made' && event.path === path);
  assert.ok(removed >= 0 && removed < coding && coding < made, JSON.stringify({ removed, coding, made }));
  const state = JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8'));
  assert.equal(state.repository.pullRequests.find(({ number }) => number === 1093).closed, true);
  assert.equal(state.repository.pullRequests.find(({ number }) => number === 1094).closed, false);
  assert.equal((await (await fake.model()).operations.readItems())[0].column, 'Review');
});


// proves R-SCHED-11, R-WORK-36
test('once ignores closed cards without a kind or carrying the epic label while selected equivalents remove their old directories', SETTLES_WITHIN, async () => {
  for (const column of ['Review', 'Owner']) for (const branch of [false, true]) {
    for (const labels of [[], ['type:epic', 'type:change'], ['type:change']]) {
      const selected = labels.length === 1;
      let marker;
      const ran = once({ items: [card(95, column, { labels })] }, {
        seed: { branches: branch ? ['rigger-95'] : [], pullRequests: [{ number: 1095, head: 'rigger-95', sha: 'a'.repeat(40), closed: true }] },
        prepare: ({ consumer }) => {
          marker = join(dirname(consumer), 'widgets-worktrees', 'scratch', 'rigger-95', 'reviewer', 'kept');
          mkdirSync(dirname(marker), { recursive: true });
          writeFileSync(marker, 'closed card content');
        },
      });
      const redo = selected && column === 'Review' && !branch;
      assert.equal(ran.code, redo ? 1 : 0, ran.out + ran.err);
      if (selected) {
        assert.equal(existsSync(marker), false, JSON.stringify({ column, branch, labels }));
        assert.equal(ran.agentRuns().length, redo ? 1 : 0);
        assert.equal((await columnsOf(ran))[95], redo ? 'Coding' : 'Owner');
      } else {
        assert.match(ran.out, /no card was pullable/, ran.out + ran.err);
        assert.equal(readFileSync(marker, 'utf8'), 'closed card content');
        assert.deepEqual(ran.agentRuns(), []);
        assert.deepEqual((await ran.model()).writes(), []);
        assert.equal((await columnsOf(ran))[95], column);
      }
    }
  }
});

// proves R-SCHED-4
test('once after the bin\'s pause claims nothing, and after its resume claims as it does where no pause was', async () => {
  // The defect this catches is a `pause` that `take` does not read as closed, or a `resume` that
  // leaves admission closed, through the verbs the owner runs rather than closers seeded by hand.
  const items = [card(20, 'Ready'), card(10, 'Ready')];
  const owner = (verb, consumer) => {
    const done = spawnSync(process.execPath, [bin, verb], { cwd: consumer, encoding: 'utf8' });
    assert.equal(done.status, 0, `${done.stdout}${done.stderr}`);
    assert.doesNotMatch(`${done.stdout}${done.stderr}`, /not yet implemented/);
  };
  const base = once({ items });
  const paused = once({ items }, { prepare: ({ consumer }) => owner('pause', consumer) });

  assert.equal(paused.code, 0, paused.err);
  assert.match(paused.out, /admission is closed by owner: the owner's pause/, paused.out);
  assert.deepEqual(await columnsOf(paused), { 10: 'Ready', 20: 'Ready' });
  assert.deepEqual((await paused.model()).writes(), []);
  assert.deepEqual(paused.agentRuns(), []);

  owner('resume', paused.consumer);
  const resumed = paused.rerun();
  assert.deepEqual(await columnsOf(resumed), await columnsOf(base), resumed.err);
  assert.deepEqual(await columnsOf(resumed), { 10: 'Coding', 20: 'Ready' });
});

test('once prints each closer in the words it printed at #944\'s head, and those words are written in one function under src/', async () => {
  // The words are written out by hand, as `once` printed them at a4edcfb, so a change to the one
  // function `doctor` and `plan` now share with `once` shows here as a change to `once`'s output.
  const ran = once({ items: [REFUSED, card(12, 'Ready')] }, { prepare: ({ consumer }) => {
    const state = join(consumer, '.rigger');
    seed(state, 'owner-a1.json', closerText({ reason: 'owner pause' }));
    seed(state, 'hold-b2.json', closerText({ reason: 'environment hold' }));
  } });

  assert.equal(ran.code, 0, ran.err);
  const lines = ran.out.split('\n').filter(Boolean);
  assert.deepEqual(lines.filter((line) => line.startsWith('rigger once: admission')).sort(), [
    `rigger once: admission is closed by hold: environment hold; time ${TIME}`,
    `rigger once: admission is closed by owner: owner pause; time ${TIME}`,
  ], ran.out);
  assert.equal(lines.length, 3, ran.out);
  assert.match(lines[2], /^ {2}refuse {2}#11 {2}missing acceptance/, ran.out);

  const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? sources(join(dir, entry.name)) : entry.name.endsWith('.mjs') ? [join(dir, entry.name)] : []));
  const writing = sources(join(root, 'src')).filter((file) => readFileSync(file, 'utf8').includes('admission is closed by'));
  assert.deepEqual(writing.map((file) => file.slice(root.length + 1)), ['src/cli/doctor.mjs']);
});

// proves R-SCHED-27
test('once leaves every status-labelled table row unclaimed with no writes, dispatch or directory removal', SETTLES_WITHIN, async () => {
  const directory = temporaryDirectory('rigger-once-status-');
  const settings = { ...config(), worktrees: { ...config().worktrees, root: directory } };
  const rows = [
    card(960, 'Ready', { labels: ['type:change', 'rigger:status'] }),
    card(961, 'Coding', { labels: ['type:change', 'rigger:status'] }),
    card(962, 'Review', { labels: ['type:change', 'rigger:status'] }),
    card(963, 'Owner', { labels: ['type:change', 'rigger:status'] }),
    card(964, 'Done', { labels: ['type:change', 'rigger:status'] }),
    card(965, 'Elsewhere', { labels: ['type:change', 'rigger:status'] }),
    card(966, null, { labels: ['type:change', 'rigger:status'] }),
    card(967, 'Ready', { labels: ['type:change', 'type:spec', 'rigger:status'], body: '' }),
    card(968, 'Ready', { labels: ['type:change', 'rigger:escalated', 'rigger:status'] }),
    card(969, 'Review', { labels: ['type:change', 'rigger:escalated', 'rigger:status'] }),
    card(970, 'Review', { labels: ['type:change', 'rigger:status'] }),
    card(971, 'Review', { labels: ['type:change', 'rigger:status'] }),
    card(972, 'Owner', { labels: ['type:change', 'rigger:status'] }),
    card(973, 'Review', { labels: ['type:change', 'rigger:status'] }),
    card(974, 'Owner', { labels: ['type:change', 'rigger:status'] }),
    card(975, 'Ready', { labels: ['type:change', 'RIGGER:STATUS'] }),
  ];
  const pull = (number, at, facts = {}) => ({ number: at, head: `rigger-${number}`, sha: '6'.repeat(40), ...facts });
  const seed = { pullRequests: [
    pull(969, 1969, { merged: true }),
    pull(970, 1970, { merged: true }),
    pull(971, 1971),
    pull(972, 1972), pull(972, 2072),
    pull(973, 1973, { closed: true }),
    pull(974, 1974, { closed: true }),
  ] };
  const markers = rows.map(({ number }) => join(directory, 'scratch', `rigger-${number}`, 'reviewer', 'kept'));
  const ran = once({ columns: [...COLUMNS, 'Elsewhere'], items: rows }, { settings, seed,
    prepare: () => {
      for (const marker of markers) {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, 'status issue directory\n');
      }
    },
  });

  assert.equal(ran.code, 0, `${ran.out}\n${ran.err}`);
  assert.match(ran.out, /no card was pullable/);
  assert.doesNotMatch(ran.out + ran.err, /refus|#96\d\b|#97\d\b/);
  assert.deepEqual(ran.agentRuns(), []);
  assert.deepEqual((await ran.model()).writes(), []);
  const after = await (await ran.model()).operations.readItems();
  for (const row of rows) {
    assert.deepEqual(after.find(({ number }) => number === row.number).labels, row.labels, `labels on #${row.number}`);
    assert.equal((await columnsOf(ran))[row.number], row.column, `column of #${row.number}`);
  }
  for (const marker of markers) assert.equal(readFileSync(marker, 'utf8'), 'status issue directory\n', marker);
  assert.deepEqual(eventsOf(ran).filter(({ event }) => /dispatch|escalat|transition|workspace|merge/.test(event)), []);
  for (const args of ran.fake.sent()) {
    assert.equal(args[0], 'api', JSON.stringify(args));
    if (args[1] === 'graphql') {
      assert.ok(parseDocument(args[3].slice('query='.length)).operations.every(({ type }) => type === 'query'), JSON.stringify(args));
    } else {
      assert.equal(args[args.indexOf('-X') + 1], 'GET', JSON.stringify(args));
    }
  }
});

// proves R-SCHED-27
test('once works a Ready issue on its next read after the status label is removed', async () => {
  const ran = once({ items: [card(980, 'Ready', { labels: ['type:change', 'rigger:status'] })] });
  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(ran.agentRuns(), []);
  assert.deepEqual((await ran.model()).writes(), []);

  // The fixture control updates both the board item and its issue to carry only type:change.
  setEscalationLabel(ran.fake);
  const resumed = ran.rerun();

  assert.equal(resumed.code, 1, `${resumed.out}\n${resumed.err}`);
  assert.match(resumed.err, /claimed #980.*maker exited 0 and opened no pull request/);
  assert.equal(resumed.agentRuns().length, 1);
  assert.deepEqual(await columnsOf(resumed), { 980: 'Coding' });
  assert.deepEqual((await (await resumed.model()).operations.readItems())[0].labels, ['type:change']);
});
