// ABOUTME: Proves R-LOOP-21 to R-LOOP-24: a maker that starts a card from the beginning, exits 0
// and leaves no open pull request escalates the card to the owner in the invocation that ran it,
// through the `once` verb over real git, the fake forge and a logical maker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

import { createFakeBoard } from './fake-board.mjs';
import { optionalRun, optionalWorld } from './optional-config-world.mjs';
import { minimalConfig } from './optional-config.mjs';
import { START } from './clock-report-world.mjs';
import { postedNote } from './escalation-world.mjs';
import { markerComment } from './fake-repository.mjs';
import { gitIn } from './git-repository.mjs';
import { ADMITTED, card } from './verb-consumer.mjs';
import { streamPath } from '../src/observation/sink.mjs';

const CARD = 10;
const LINE = `rigger-${CARD}`;

/**
 * Card 10 in Ready over the minimal config, its maker acting as `engineer` says (an act the
 * stand-in agent takes) after `beforeMaker({ world, cwd })` has run in its workspace.
 */
function makerWorld(t, { engineer = {}, beforeMaker = () => {}, column = 'Ready', settings } = {}) {
  let world;
  world = optionalWorld(t, 'minimal', {
    ...(settings === undefined ? {} : { settings }),
    items: [card(CARD, column)],
    plan: { [CARD]: { engineer } },
    beforeAgent: async (request) => { await beforeMaker({ world, cwd: request.cwd }); },
  });
  return world;
}

/** The workspace of card 10's line of work. */
const workspaceOf = (world) => join(world.workspaceRoot, world.topic(CARD));

/** The tip of card 10's line of work in its workspace, as git reads it there. */
const tipIn = (path) => gitIn(path, 'rev-parse', `refs/heads/${LINE}`).trim();

/** The maker's commit in its workspace, carrying `note` so a second maker leaves a different one. */
const commitIn = (cwd, note) => gitIn(cwd, 'commit', '-q', '--allow-empty', '-m', `card #${CARD} work ${note}`);

/** Has the fake forge hold `pull`, as `createFakeRepository`'s `PULL_FACTS` describe one, from card 10's line of work. */
function holding(world, pull) {
  const state = world.state();
  (state.repository.pullRequests ??= []).push({ head: LINE, base: 'main', diff: '', comments: [], ...pull });
  writeFileSync(world.statePath, JSON.stringify(state));
}

/** Whether `args`, a `gh` request, is L2's read of the pull requests from card 10's line of work. */
const pullRead = (args) => args.some((arg) => arg.includes(`pullRequests(headRefName: "${LINE}"`));

/** Has `world`'s forge answer each `gh` request as `answer(args, forge)` says, `forge` answering as the fake does. */
function answering(world, answer) {
  const forge = world.store.answer.bind(world.store);
  world.store.answer = async (args, context) => answer(args, () => forge(args, context));
}

/** How many makers the world's verb dispatched. */
const makersRan = (world) => world.agent.runs().filter(({ role }) => role === 'engineer').length;

/** Card 10 as the forge holds it: its column, labels and issue comments. */
async function cardOf(world) {
  const state = world.state();
  // The board the fake `gh` answers from: its model with every write since replayed, as `boardOf` in fake-gh.mjs makes it.
  const board = createFakeBoard(state.model);
  for (const { operation, args } of state.writes) await board.operations[operation](...args);
  const item = (await board.operations.readItems()).find(({ number }) => number === CARD);
  const issue = state.repository.issues.find(({ number }) => number === CARD);
  return { column: item.column, labels: issue.labels, comments: (issue.comments ?? []).map(({ body }) => body) };
}

/** The escalation comment an R-LOOP-21 escalation of card 10 owes: `held` after its reason's opening, and `workspace` as its last line. */
const deliveredNothing = (held, workspace) => `Rigger escalates card #${CARD} to the owner (ambiguous).\n\n`
  + `card #${CARD}'s maker started its work from the beginning and exited 0, and ${held}\n\n`
  + `Line of work: ${LINE}\n${workspace}\n`;

/** What the forge holds where no open pull request is from card 10's line of work. */
const NO_OPEN = `the forge holds no open pull request from its line of work ${LINE}`;

/** Asserts card 10 escalated to the owner as R-LOOP-21 says, in the owner's column with the label, with one comment `body`. */
async function escalatedWith(world, body) {
  const { column, labels, comments } = await cardOf(world);
  assert.deepEqual({ column, escalated: JSON.stringify(labels).includes('rigger:escalated') }, { column: 'Owner', escalated: true }, JSON.stringify(labels));
  assert.deepEqual(comments, [body]);
  const escalations = world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.escalate');
  assert.deepEqual(escalations.map(({ category, raiser, destination }) => ({ category, raiser, destination })), [{ category: 'ambiguous', raiser: 'loop', destination: 'owner' }]);
  assert.equal(world.events().some(({ layer, event }) => layer === 'L2' && event === 'review.withheld'), false, 'nothing was withheld');
}

// proves R-LOOP-21
test('N1: a fresh maker that commits, pushes nothing and exits 0 escalates ambiguous to the owner, and no later invocation dispatches a maker or remakes its workspace', async (t) => {
  let left;
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => { commitIn(cwd, 'first'); left = tipIn(cwd); } });

  await world.start();

  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
  assert.equal(makersRan(world), 1);

  await world.start();

  assert.equal(makersRan(world), 1, 'no later invocation dispatched a maker');
  assert.equal(tipIn(workspaceOf(world)), left, 'the workspace still holds the commit the maker left');
  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
});

// proves R-LOOP-21
test('N2: a fresh maker that commits and pushes its branch, opens no pull request and exits 0 escalates ambiguous to the owner, and no later invocation dispatches a maker or remakes its workspace', async (t) => {
  const world = makerWorld(t, { engineer: { push: true } });

  await world.start();

  const left = gitIn(world.origin, 'rev-parse', `refs/heads/${LINE}`).trim();
  assert.equal(tipIn(workspaceOf(world)), left, 'the forge holds the branch the maker pushed');
  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));

  await world.start();

  assert.equal(makersRan(world), 1, 'no later invocation dispatched a maker');
  assert.equal(tipIn(workspaceOf(world)), left, 'the workspace still holds the commit the maker left');
  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
});

// proves R-LOOP-21
test('N3: a fresh maker that exits 0 where the forge holds only a closed pull request from its line of work escalates ambiguous to the owner', async (t) => {
  let left;
  const world = makerWorld(t, { beforeMaker: ({ world: here, cwd }) => {
    commitIn(cwd, 'closed');
    left = tipIn(cwd);
    holding(here, { number: 120, sha: left, closed: true });
  } });

  await world.start();

  assert.equal(makersRan(world), 1);
  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
});

// proves R-LOOP-21
test('N4: a fresh maker that exits 0 where the forge holds a merged pull request from its line of work and none open escalates ambiguous to the owner, naming the merged pull request', async (t) => {
  let left;
  const world = makerWorld(t, { beforeMaker: ({ world: here, cwd }) => {
    commitIn(cwd, 'merged');
    left = tipIn(cwd);
    holding(here, { number: 120, sha: left, merged: true });
  } });

  await world.start();

  assert.equal(makersRan(world), 1);
  await escalatedWith(world, deliveredNothing(`${NO_OPEN}, and it holds merged pull request #120 from it`, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
});

// proves R-LOOP-21
test('N5: a pull request the maker opened that L2\'s one read after the exit does not show escalates the card, after one read and no read again', async (t) => {
  let left;
  let exited = false;
  const reads = [];
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => {
    commitIn(cwd, 'lagging');
    left = tipIn(cwd);
    exited = true;
  } });
  // The forge shows the maker's pull request only after L2's first read since the exit: a read that lags the write.
  answering(world, async (args, forge) => {
    if (!exited || !pullRead(args)) return forge();
    reads.push(world.events().some(({ event }) => event === 'review.escalate') ? 'after the escalation' : 'before the escalation');
    const answer = await forge();
    if (reads.length === 1) holding(world, { number: 120, sha: left });
    return answer;
  });

  await world.start();

  assert.deepEqual(reads, ['before the escalation'], 'one read of the line of work between the exit and the escalation, and none after it');
  assert.equal(makersRan(world), 1);
  await escalatedWith(world, deliveredNothing(NO_OPEN, `Workspace: ${workspaceOf(world)}, its line of work at ${left}`));
});

// proves R-LOOP-21
test('N6: where L1 cannot read the workspace\'s tip and L2 reads no open pull request, the card escalates ambiguous to the owner, naming the workspace and why its tip was not read', async (t) => {
  // The maker deletes its workspace's branch, leaving it checked out with no commit for L1 to read.
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => gitIn(cwd, 'update-ref', '-d', `refs/heads/${LINE}`) });

  await world.start();

  assert.equal(makersRan(world), 1);
  const { comments } = await cardOf(world);
  assert.equal(comments.length, 1, 'the card\'s issue holds one escalation comment');
  const [body] = comments;
  const last = body.trimEnd().split('\n').at(-1);
  assert.match(last, new RegExp(`^Workspace: ${workspaceOf(world)}, its tip not read: card #${CARD}'s line of work has no readable tip in workspace ${workspaceOf(world)}: `));
  await escalatedWith(world, deliveredNothing(NO_OPEN, last));
});

// proves R-LOOP-21
test('N7: where L2\'s read of the card\'s pull requests fails after the exit, the card escalates ambiguous to the owner, naming the failed read in place of what the forge holds', async (t) => {
  let left;
  let exited = false;
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => {
    commitIn(cwd, 'unread');
    left = tipIn(cwd);
    exited = true;
  } });
  answering(world, async (args, forge) => (exited && pullRead(args) ? { status: 1, stdout: '', stderr: 'gh: HTTP 502: the forge is unavailable' } : forge()));

  await world.start();

  assert.equal(makersRan(world), 1);
  const { comments } = await cardOf(world);
  assert.equal(comments.length, 1, 'the card\'s issue holds one escalation comment');
  const [body] = comments;
  const reason = body.split('\n\n')[1];
  assert.match(reason, new RegExp(`^card #${CARD}'s maker started its work from the beginning and exited 0, and the forge's open pull requests from its line of work ${LINE} could not be read: .*HTTP 502: the forge is unavailable`));
  assert.doesNotMatch(reason, /holds no open pull request/);
  assert.equal(body, `Rigger escalates card #${CARD} to the owner (ambiguous).\n\n${reason}\n\nLine of work: ${LINE}\nWorkspace: ${workspaceOf(world)}, its line of work at ${left}\n`);
  await escalatedWith(world, body);
});

// proves R-LOOP-21
test('N8: a maker note under the dispatch escalates the card in the note\'s category, as at the merge base', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ world: here }) => {
    const { dispatch } = here.events().findLast(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'engineer');
    const state = here.state();
    const issue = state.repository.issues.find(({ number }) => number === CARD);
    issue.comments = [...(issue.comments ?? []), { ...postedNote(dispatch, 'critical'), body: postedNote(dispatch, 'critical').body.replace('item: 2', 'item: 1'), createdAt: '2026-10-29T12:00:00Z' }];
    writeFileSync(here.statePath, JSON.stringify(state));
  } });

  await world.start();

  assert.equal(makersRan(world), 1);
  const { column, labels } = await cardOf(world);
  assert.deepEqual({ column, escalated: labels.includes('rigger:escalated') }, { column: 'Owner', escalated: true });
  const escalations = world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.escalate');
  assert.deepEqual(escalations.map(({ category, raiser }) => ({ category, raiser })), [{ category: 'critical', raiser: 'maker' }]);
});

// proves R-LOOP-21
test('N9: a fresh maker that exits 0 where the forge holds two open pull requests from its line of work is withheld, and the next pull refuses and escalates it, as at the merge base', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ world: here, cwd }) => {
    commitIn(cwd, 'twice');
    holding(here, { number: 120, sha: tipIn(cwd) });
    holding(here, { number: 121, sha: tipIn(cwd) });
  } });

  await world.start();

  const withheld = world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.withheld');
  assert.equal(withheld.length, 1);
  assert.match(withheld[0].reason, /more than one open pull request.*#120, #121/);
  assert.equal((await cardOf(world)).column, 'Coding');

  await world.start();

  assert.equal(makersRan(world), 1);
  const { column, labels } = await cardOf(world);
  assert.deepEqual({ column, escalated: labels.includes('rigger:escalated') }, { column: 'Owner', escalated: true });
  assert.equal(world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.escalate').length, 1);
});

// proves R-LOOP-21
test('N12: where L1 cannot read the workspace\'s tip and L2 reads one open pull request, the card moves to review, as at the merge base', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ world: here, cwd }) => {
    commitIn(cwd, 'opened');
    holding(here, { number: 120, sha: tipIn(cwd) });
    gitIn(cwd, 'update-ref', '-d', `refs/heads/${LINE}`);
  } });

  await world.start();

  assert.equal(makersRan(world), 1);
  assert.ok(world.events().some(({ layer, event, cause, to }) => layer === 'L2' && event === 'transition' && cause === 'returned' && to === 'review'));
  assert.equal(world.events().some(({ event }) => event === 'review.escalate' || event === 'review.withheld'), false);
});

// proves R-LOOP-21
test('N10: a maker outcome refused as unrecorded while carrying exit 0 escalates nothing and starts no further work, as at the merge base', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => commitIn(cwd, 'unrecorded') });
  const append = fs.appendFileSync;
  let refused = 0;
  // The record refuses L1's end of the maker's dispatch, which carries its exit 0.
  fs.appendFileSync = (path, data, ...rest) => {
    if (String(path) === streamPath(join(world.consumer, '.rigger')) && refused === 0) {
      const event = JSON.parse(String(data));
      if (event.layer === 'L1' && event.event === 'dispatch.end' && event.exit === 0) {
        refused += 1;
        throw Object.assign(new Error('EIO: the test refuses this append'), { code: 'EIO' });
      }
    }
    return append(path, data, ...rest);
  };
  syncBuiltinESMExports();
  let answer;
  try { answer = await world.start(); }
  finally { fs.appendFileSync = append; syncBuiltinESMExports(); }

  assert.equal(refused, 1, 'the maker\'s end was refused');
  assert.notEqual(answer.code, 0, answer.text);
  assert.match(answer.text, /EIO: the test refuses this append/);
  assert.equal(makersRan(world), 1);
  assert.equal((await cardOf(world)).column, 'Coding');
  assert.equal(world.events().some(({ event }) => event === 'review.escalate' || event === 'review.withheld'), false);
});

/**
 * Card 10 in Review, whose line of work the forge holds at a head a reviewer ruled needs revision on
 * its pull request #77, and whose continuing maker does as `makerWorld` says. Answers the world and that head.
 */
function continuingWorld(t, options) {
  const world = makerWorld(t, { ...options, column: 'Review' });
  const base = gitIn(world.consumer, 'rev-parse', 'HEAD').trim();
  gitIn(world.consumer, 'switch', '-qc', LINE);
  gitIn(world.consumer, 'commit', '-qm', 'work for review', '--allow-empty');
  const head = gitIn(world.consumer, 'rev-parse', 'HEAD').trim();
  gitIn(world.consumer, 'push', '-q', 'origin', LINE);
  gitIn(world.consumer, 'switch', '-q', 'main');
  gitIn(world.consumer, 'branch', '-qD', LINE);
  holding(world, { number: 77, sha: head, mergeBase: base, diff: 'diff --git a/widget b/widget\n', mergeable: 'mergeable',
    comments: [markerComment({ card: CARD, pull: 77, head, body: ADMITTED, verdict: 'needs revision', items: ['unmet'], toSound: 'The widget must turn blue.' })] });
  return { world, head };
}

// proves R-LOOP-22
test('a continuing maker that exits 0 and leaves no open pull request is not escalated under R-LOOP-21, and its card stays in Coding', async (t) => {
  const { world } = continuingWorld(t, { beforeMaker: ({ world: here }) => {
    const state = here.state();
    state.repository.pullRequests.find(({ number }) => number === 77).closed = true;
    writeFileSync(here.statePath, JSON.stringify(state));
  } });

  await world.start();

  assert.ok(world.events().some(({ layer, event, cause }) => layer === 'L2' && event === 'transition' && cause === 'continued'), 'the maker continued');
  assert.equal(makersRan(world), 1);
  assert.equal((await cardOf(world)).column, 'Coding');
  const withheld = world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.withheld');
  assert.equal(withheld.length, 1);
  assert.match(withheld[0].reason, /no open pull request/);
  assert.equal(world.events().some(({ event }) => event === 'review.escalate'), false);
});

// proves R-LOOP-21
test('the verb\'s hand-over line for an R-LOOP-21 escalation names Rigger as raising it, its category and its reason, and no acceptance item', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => commitIn(cwd, 'said') });

  const answer = await world.start();

  assert.equal(answer.text, `rigger once: card #${CARD} escalated ambiguous by Rigger: card #${CARD}'s maker started its work from the beginning and exited 0, and ${NO_OPEN}`);
});

// proves R-LOOP-21
test('where the escalation\'s comment is refused, the verb\'s hand-over line for the card names Rigger as raising it, its category and its reason, and no acceptance item', async (t) => {
  const world = makerWorld(t, { beforeMaker: ({ cwd }) => commitIn(cwd, 'unsaid') });
  answering(world, async (args, forge) => (args.includes(`repos/acme/widgets/issues/${CARD}/comments`) && args.includes('POST')
    ? { status: 1, stdout: '', stderr: 'gh: HTTP 502: the forge is unavailable' } : forge()));

  const answer = await world.start();

  const [line] = answer.text.split('\n');
  assert.equal(line, `rigger once: claimed #${CARD} from board 3; Rigger escalated it as ambiguous: card #${CARD}'s maker started its work from the beginning and exited 0, and ${NO_OPEN}, in its workspace, ${workspaceOf(world)}`);
  assert.doesNotMatch(answer.text, /acceptance item/);
});

// proves R-LOOP-20
test('the verb\'s hand-over line for an R-LOOP-20 escalation names Rigger as raising it, its category and its reason, and no acceptance item', async (t) => {
  const { world, head } = continuingWorld(t);

  const answer = await world.start();

  assert.equal(world.events().filter(({ layer, event }) => layer === 'L2' && event === 'review.escalate').length, 1, 'the unchanged head escalated');
  assert.equal(answer.text, `rigger once: card #${CARD} escalated ambiguous by Rigger: card #${CARD}'s continuing maker exited 0 at head ${head}, the head it was given, so it answered nothing. reviewer (needs revision): The widget must turn blue.; unmet item 1: The widget turns blue when pressed.`);
});

// proves R-LOOP-23
test('a fresh maker that exits non-zero with nothing of its line of work on the forge is not escalated under R-LOOP-21, and is set aside under R-LOOP-19', async (t) => {
  // A clock-held run, its one trigger an hour away, so its slot release fires a later pull in the same invocation.
  const settings = { ...minimalConfig(), clock: { poll: 1000, triggers: { report: { interval: 3_600_000, anchor: new Date(START + 3_600_000).toISOString(), catchUp: 'skip', job: 'report' } } } };
  const world = makerWorld(t, { engineer: { exit: 3 }, settings });

  await world.start(optionalRun, { stopAtDrain: true });

  const pulls = world.events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'pull');
  assert.ok(pulls.length >= 2, `a later pull ran in the invocation: ${pulls.length}`);
  assert.equal(makersRan(world), 1, 'the later pull dispatched no maker for the set-aside card');
  assert.equal((await cardOf(world)).column, 'Coding');
  assert.equal(world.events().some(({ event }) => event === 'review.escalate' || event === 'review.withheld'), false);
});

// proves R-LOOP-24
test('a fresh maker that exits 0 where L2 reads one open pull request from its line of work is not escalated under R-LOOP-21, and its card moves to review', async (t) => {
  const world = makerWorld(t, { engineer: { pr: true } });

  await world.start();

  assert.equal(makersRan(world), 1);
  assert.ok(world.events().some(({ layer, event, cause, to }) => layer === 'L2' && event === 'transition' && cause === 'returned' && to === 'review'));
  assert.equal(world.events().some(({ event }) => event === 'review.escalate' || event === 'review.withheld'), false);
});
