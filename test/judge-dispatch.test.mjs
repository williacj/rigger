// ABOUTME: Tests L3's dispatch of a Review card's judges under the card's one claim and slot: after
// the maker in the same claim and for a Review card pulled for them, each in its own directory with
// its steps run in its `head`, concurrently, and how a refused, timed-out or withheld judge ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { WORKSPACE_NOT_MADE } from '../src/execution/workspace.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { BASE, DIFF, HEAD, alive, cardIn, judgeDispatch, judgeWorld, pullFor, recorded } from './judge-world.mjs';
import { COLUMNS, makingJudgeDirectories, waitFor } from './loop-world.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** A Review card numbered `number`, carrying `labels`, whose line of work holds its one open pull request on the forge. */
const reviewed = (number, labels) => ({ cards: [cardIn(number, COLUMNS.review, labels)], forge: { pullRequests: [pullFor(number)] } });

/** The roles L3 dispatched for card `card`, in the order their L3 `dispatch` events were recorded. */
const rolesDispatched = (built, card) => recorded(built, 'L3', 'dispatch', (each) => each.card === card && each.role !== undefined).map((each) => each.role);

/** The real path of the judge directory the stand-in makes for judge `role` of card `card`. */
const judgeDirectoryOf = (built, card, role) => join(built.scratch, 'workspaces', 'judges', `rigger-${card}`, role);

/** The stand-in agent's runs for card `card` in `role`. */
const runsOf = (built, card, role) => built.agent.runs().filter((run) => run.card === card && run.role === role);

/** The index in `built.log` of the first entry `match` holds for. */
const at = (built, match) => built.log.findIndex(match);

/** Whether `entry` of the log is an accepted append of `layer`'s `event` for which `match` holds. */
const appended = (entry, layer, event, match = () => true) => entry.append?.layer === layer && entry.append.event === event && match(entry.append);

test('given a Review card L3 pulls with one open pull request from its line of work, L3 makes no card workspace, dispatches no maker, and dispatches the judges L2 names', SETTLES_WITHIN, async () => {
  const workspaces = [];
  const built = judgeWorld({ ...reviewed(7), workspace: async (card) => { workspaces.push(card); throw new Error('no workspace is made for a Review card pulled for its judges'); } });

  const [reached] = await built.loop.pull();

  assert.deepEqual(workspaces, []);
  assert.deepEqual(rolesDispatched(built, 7).sort(), ['architect', 'reviewer']);
  assert.deepEqual(reached.judges.map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'reviewer', exit: 0 }, { role: 'architect', exit: 0 }]);
});

// proves R-LOOP-11
test('given a kind naming owner beside agent judges, no L3 dispatch event and no L1 dispatch.start names the role owner', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  assert.ok(rolesDispatched(built, 7).length > 0, 'no judge was dispatched, so the test proves nothing');
  assert.deepEqual(built.events().filter((each) => each.role === 'owner' || (each.event === 'dispatch.start' && /\bowner\b/.test(JSON.stringify(each)))), []);
});

test('L2\'s facts call reads a Review card\'s one open pull request, its diff, its comments and the acceptance\'s revision before L3 takes any claim', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  const pull = at(built, (entry) => appended(entry, 'L3', 'pull'));
  assert.ok(pull > 0, JSON.stringify(built.log));
  const before = built.log.slice(0, pull).filter((entry) => entry.read !== undefined).map((entry) => entry.read);
  for (const read of [['readMergeBase', 1007], ['readDiff', 1007], ['readComments', 1007], ['readEditedAt', 7]]) {
    assert.ok(before.some(([operation, what]) => operation === read[0] && what === read[1]), `${read} was not read before the claim: ${JSON.stringify(before)}`);
  }
});

test('given a card whose maker\'s outcome moves it to Review, L3 dispatches the judges L2 names from the facts L2\'s settle answered, under the same claim and with no second pull event', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });

  const [reached] = await built.loop.pull();

  assert.equal(reached.outcome.value.exit, 0);
  assert.equal(reached.settled.status, 'fulfilled');
  const [maker, ...judges] = rolesDispatched(built, 3);
  assert.equal(maker, 'engineer');
  assert.deepEqual(judges.sort(), ['architect', 'reviewer']);
  assert.equal(recorded(built, 'L3', 'pull', (each) => each.card === 3).length, 1);
  assert.deepEqual(recorded(built, 'L3', 'trigger').map((each) => each.trigger), ['pull']);
  const releases = recorded(built, 'L3', 'slot.release', (each) => each.card === 3);
  assert.equal(releases.length, 1);
});

test('in that case, the fake forge records no read of that card between the settle\'s read and the judges\' dispatch', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });

  await built.loop.pull();

  const settle = built.log.findLastIndex((entry) => entry.read?.[0] === 'readPullRequests' && entry.read[1] === 'rigger-3');
  const judges = at(built, (entry) => appended(entry, 'L3', 'dispatch', (each) => each.fields.role === 'reviewer'));
  assert.ok(settle > 0 && judges > settle, JSON.stringify(built.log));
  const between = built.log.slice(settle + 1, judges).filter((entry) => entry.read !== undefined);
  // The settle's one read is the pull requests and, of the one open, what the judge answer reads.
  assert.deepEqual(between.map((entry) => entry.read).sort(), [['readComments', 1003], ['readDiff', 1003], ['readEditedAt', 3], ['readMergeBase', 1003]]);
  const dispatched = at(built, (entry) => appended(entry, 'L3', 'dispatch', (each) => each.fields.role === 'engineer'));
  assert.ok(built.log.slice(dispatched, settle).some((entry) => appended(entry, 'L1', 'dispatch.end')), 'the settle read came before the maker ended');
});

test('in that case, the ask after the settle carries exactly the facts the settle answered, its review reads fulfilled, and the judges are dispatched at the head and base the forge served', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });
  const settles = [];
  const asks = [];
  const { handed } = built;
  const watched = loop({
    ...handed,
    l2: { ...handed.l2, settled: async (card, outcome) => { const facts = await handed.l2.settled(card, outcome); settles.push(facts); return facts; } },
    decide: (card, outcomes, options) => { asks.push({ settled: settles.length, options }); return handed.decide(card, outcomes, options); },
  });

  await watched.pull();

  assert.equal(settles.length, 1);
  const [settled] = settles;
  // The settle's review reads are fulfilled with what the forge served, each value written by hand.
  assert.deepEqual(settled.pull, { status: 'fulfilled', value: { number: 1003, base: BASE, head: HEAD } });
  assert.deepEqual(settled.diff, { status: 'fulfilled', value: DIFF });
  assert.equal(settled.comments.status, 'fulfilled');
  assert.equal(settled.editedAt.status, 'fulfilled');
  const asked = asks.filter((each) => each.settled === 1);
  assert.ok(asked.length > 0, 'L3 asked L2 nothing after the settle, so the test proves nothing');
  for (const { options } of asked) assert.deepEqual(options.forge, settled);
  for (const role of ['reviewer', 'architect']) {
    const start = judgeDispatch(built, 3, role).l1.find((each) => each.event === 'dispatch.start');
    assert.deepEqual({ base: start.facts.base, head: start.facts.head }, { base: BASE, head: HEAD }, role);
  }
});

test('no judge\'s stand-in reads on its standard input any text of the maker stand-in\'s output', SETTLES_WITHIN, async () => {
  const marker = 'MAKER-OUTPUT-MARKER-6f1c';
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });
  built.agent.plan(3, 'engineer', { print: marker });

  const [reached] = await built.loop.pull();

  assert.match(reached.outcome.value.stdout.toString(), new RegExp(marker), 'the maker stand-in did not print its marker, so the test proves nothing');
  const judges = [...runsOf(built, 3, 'reviewer'), ...runsOf(built, 3, 'architect')];
  assert.equal(judges.length, 2);
  for (const run of judges) assert.doesNotMatch(run.input, new RegExp(marker), run.role);
});

// proves R-LOOP-13
test('given a Review card carrying two labels that select different tiers for one of its judge roles, L3 dispatches no judge for it, and the refusal names that role and both labels', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, architect: { ...config.roles.architect, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const built = judgeWorld({ ...reviewed(7, ['tier:high', 'tier:low']), roles });

  assert.deepEqual(await built.loop.pull(), []);

  assert.deepEqual(rolesDispatched(built, 7), []);
  assert.deepEqual(recorded(built, 'L3', 'pull'), []);
  const refusals = built.decisions.filter(({ answer }) => answer.action === 'refuse').map(({ answer }) => answer);
  assert.equal(refusals.length, 1, JSON.stringify(built.decisions));
  for (const named of [/\barchitect\b/, /tier:high/, /tier:low/]) assert.match(refusals[0].reason, named);
});

// proves R-LOOP-14
test('each judge\'s dispatch runs with its working directory in the judge directory\'s main, and with head as the directory it may reach, both as the judge directory make answered them', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  for (const role of ['reviewer', 'architect']) {
    const [run] = runsOf(built, 7, role);
    const directory = realpathSync.native(judgeDirectoryOf(built, 7, role));
    assert.equal(realpathSync.native(run.cwd), join(directory, 'main'), role);
    const settings = JSON.parse(run.args[run.args.indexOf('--settings') + 1]);
    assert.ok(settings.permissions.allow.includes(`Read(/${join(directory, 'head')}/**)`), JSON.stringify(settings));
    assert.ok(!settings.permissions.allow.some((rule) => rule.includes(`${directory}/main`)), JSON.stringify(settings));
  }
});

test('where L1 cannot make one judge\'s directory, L2 classifies the failure as the environment\'s and withholds that judge, and the other judges\' dispatches proceed', SETTLES_WITHIN, async () => {
  let built;
  const judgeDirectory = async (card, role, head) => {
    if (role === 'reviewer') throw Object.assign(new Error('L1 could not make judge reviewer\'s directory: the disk is full'), { code: WORKSPACE_NOT_MADE, path: join(built.scratch, 'judges', 'reviewer') });
    return makingJudgeDirectories(join(built.scratch, 'workspaces'))(card, role, head);
  };
  built = judgeWorld({ ...reviewed(7), judgeDirectory });

  const [reached] = await built.loop.pull();

  assert.deepEqual(rolesDispatched(built, 7), ['architect']);
  assert.deepEqual(reached.judges.map(({ role }) => role), ['architect']);
  const withheld = recorded(built, 'L2', 'judge.withheld', (each) => each.card === 7);
  assert.deepEqual(withheld.map(({ role, class: classed, reason }) => ({ role, class: classed, reason })), [{ role: 'reviewer', class: 'environment', reason: 'L1 could not make judge reviewer\'s directory: the disk is full' }]);
});

test('for each judge, L3 has L1 make the judge\'s directory before any of that judge\'s dispatches start', SETTLES_WITHIN, async () => {
  const provisioning = { prepare: { run: 'true', required: true } };
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect'], provisioning: ['prepare'] } };
  const built = judgeWorld({ ...reviewed(7), kinds, provisioning });

  await built.loop.pull();

  for (const role of ['reviewer', 'architect']) {
    const made = at(built, (entry) => entry.made?.role === role);
    const ids = new Set(recorded(built, 'L3', 'dispatch', (each) => each.role === role).map((each) => each.dispatch));
    const first = at(built, (entry) => appended(entry, 'L3', 'dispatch', (each) => each.fields.role === role));
    assert.ok(made >= 0 && first > made, `${role}: ${JSON.stringify(built.log)}`);
    assert.ok(ids.size === 2, `${role} had its step and itself dispatched: ${[...ids]}`);
  }
});

test('for each judge, L3 hands roleDispatch the card\'s scratch base from the judge directory make, and L1 makes <scratch>/<role> fresh after L3\'s dispatch event and before the judge\'s dispatch.start, which L1\'s record names as its scratch directory', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));
  const entries = [];
  built.agent.plan(7, 'reviewer', { hold: true });

  const pulled = built.loop.pull();
  await waitFor(() => built.agent.held(7, 'reviewer'), 20_000);
  entries.push(...readGroups(built.directory));
  built.agent.release(7, 'reviewer');
  await pulled;

  const scratch = join(built.scratch, 'workspaces', 'scratch', 'rigger-7', 'reviewer');
  const events = built.events();
  const { l3 } = judgeDispatch(built, 7, 'reviewer');
  const dispatched = events.indexOf(events.find((each) => each.layer === 'L3' && each.dispatch === l3.dispatch));
  const made = events.findIndex((each) => each.layer === 'L1' && each.event === 'workspace.made' && each.role === 'reviewer' && each.path === scratch);
  const start = events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === l3.dispatch);
  assert.ok(dispatched >= 0 && dispatched < made && made < start, JSON.stringify(events));
  assert.deepEqual(entries.filter((entry) => entry.dispatch === l3.dispatch).map((entry) => entry.scratch?.path), [realpathSync.native(scratch)]);
});

// proves R-EVIDENCE-6
test('for each judge, L3 dispatches the steps L2 named in that judge\'s head, one at a time, before the judge', SETTLES_WITHIN, async () => {
  const provisioning = { first: { run: 'pwd -P > first.out', required: true }, second: { run: 'test -e first.out && pwd -P > second.out', required: true } };
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect'], provisioning: ['first', 'second'] } };
  const built = judgeWorld({ ...reviewed(7), kinds, provisioning });

  await built.loop.pull();

  for (const role of ['reviewer', 'architect']) {
    const head = join(realpathSync.native(judgeDirectoryOf(built, 7, role)), 'head');
    const steps = recorded(built, 'L3', 'dispatch', (each) => each.card === 7 && each.role === role && each.step !== undefined);
    assert.deepEqual(steps.map((each) => each.step), ['first', 'second'], role);
    const events = built.events();
    const endOf = (dispatch) => events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.end' && each.dispatch === dispatch);
    const startOf = (dispatch) => events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === dispatch);
    const judge = recorded(built, 'L3', 'dispatch', (each) => each.card === 7 && each.role === role && each.step === undefined)[0];
    assert.ok(endOf(steps[0].dispatch) < startOf(steps[1].dispatch) && endOf(steps[1].dispatch) < startOf(judge.dispatch), `${role}: ${JSON.stringify(events)}`);
    assert.ok(steps.every((each) => endOf(each.dispatch) >= 0 && events[endOf(each.dispatch)].exit === 0), `${role}'s steps failed`);
  }
  // Each step ran in its judge's own head, which its output there shows.
  for (const role of ['reviewer', 'architect']) {
    const head = join(realpathSync.native(judgeDirectoryOf(built, 7, role)), 'head');
    assert.equal(readFileSync(join(head, 'second.out'), 'utf8').trim(), head, role);
  }
});

test('given a required step failing in one judge\'s head, that judge is not dispatched, and the other judges\' dispatches proceed', SETTLES_WITHIN, async () => {
  const provisioning = { check: { run: 'test ! -e broken', required: true } };
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect'], provisioning: ['check'] } };
  let built;
  const judgeDirectory = async (card, role, head) => {
    const made = await makingJudgeDirectories(join(built.scratch, 'workspaces'))(card, role, head);
    if (role === 'reviewer') writeFileSync(join(made.head, 'broken'), '');
    return made;
  };
  built = judgeWorld({ ...reviewed(7), kinds, provisioning, judgeDirectory });

  const [reached] = await built.loop.pull();

  assert.deepEqual(recorded(built, 'L3', 'dispatch', (each) => each.step === undefined).map((each) => each.role), ['architect']);
  assert.deepEqual(reached.judges.map(({ role }) => role), ['architect']);
  assert.deepEqual(recorded(built, 'L2', 'judge.withheld').map(({ role, step, exit, class: classed }) => ({ role, step, exit, class: classed })), [{ role: 'reviewer', step: 'check', exit: 1, class: 'environment' }]);
});

test('each judge\'s dispatch.start and its record entry name its judge directory, <root>/judges/<topic>/<role>, as the dispatch\'s directory', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));
  const entries = [];
  built.agent.plan(7, 'reviewer', { hold: true });
  built.agent.plan(7, 'architect', { hold: true });

  const pulled = built.loop.pull();
  await waitFor(() => built.agent.held(7, 'reviewer') && built.agent.held(7, 'architect'), 20_000);
  entries.push(...readGroups(built.directory));
  built.agent.release(7, 'reviewer');
  built.agent.release(7, 'architect');
  await pulled;

  for (const role of ['reviewer', 'architect']) {
    const { l3, l1 } = judgeDispatch(built, 7, role);
    const [start] = l1.filter((each) => each.event === 'dispatch.start');
    assert.equal(start.workspace, judgeDirectoryOf(built, 7, role), role);
    assert.deepEqual(entries.filter((entry) => entry.dispatch === l3.dispatch).map((entry) => realpathSync.native(entry.workspace)), [realpathSync.native(judgeDirectoryOf(built, 7, role))], role);
  }
});

test('given a judge stand-in that leaves a process of Rigger\'s own user working in its head after it exits, that process is not alive when the judge\'s dispatch settles', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));
  built.agent.plan(7, 'reviewer', { leaveIn: '../head' });

  await built.loop.pull();

  const pid = built.pid(7, 'reviewer');
  const { l1 } = judgeDispatch(built, 7, 'reviewer');
  const killed = l1.findIndex((each) => each.pid === pid && each.event === 'survivor.killed');
  const ended = l1.findIndex((each) => each.event === 'dispatch.end');
  assert.ok(killed >= 0 && killed < ended, JSON.stringify(l1));
  assert.equal(alive(pid), false);
});

// proves R-LOOP-7
test('given two judges, their dispatch intervals overlap, each stand-in waiting on a file only the other writes', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));
  built.agent.plan(7, 'reviewer', { write: true, await: 'architect' });
  built.agent.plan(7, 'architect', { write: true, await: 'reviewer' });

  const [reached] = await built.loop.pull();

  assert.deepEqual(reached.judges.map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'reviewer', exit: 0 }, { role: 'architect', exit: 0 }]);
  assert.ok(built.agent.wrote(7, 'reviewer') && built.agent.wrote(7, 'architect'));
});

test('each judge\'s dispatch has its own dispatch id, and its L3 dispatch event names its role and tier', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  const judges = recorded(built, 'L3', 'dispatch', (each) => each.card === 7).sort((a, b) => a.role.localeCompare(b.role));
  assert.deepEqual(judges.map(({ role, tier }) => ({ role, tier })), [{ role: 'architect', tier: config.roles.architect.tier }, { role: 'reviewer', tier: config.roles.reviewer.tier }]);
  assert.equal(new Set(judges.map((each) => each.dispatch)).size, 2);
});

test('given two judges at one head, their dispatch.start events carry the same card, base SHA, head SHA and evidence digest', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  const starts = ['reviewer', 'architect'].map((role) => judgeDispatch(built, 7, role).l1.find((each) => each.event === 'dispatch.start'));
  const read = starts.map(({ card, facts, digest }) => ({ card, facts: { card: facts.card, base: facts.base, head: facts.head }, digest }));
  assert.match(read[0].digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(read[0], { card: 7, facts: { card: 7, base: BASE, head: HEAD }, digest: read[0].digest });
  assert.deepEqual(read[1], read[0]);
});

// proves R-SCHED-2
test('given N of 1, two pullable cards and loop().run(), card B is not claimed until every one of card A\'s judge dispatches has handed back its outcome', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(7, COLUMNS.review), cardIn(8, COLUMNS.ready)], forge: { pullRequests: [pullFor(7)] }, concurrency: 1 });
  built.agent.plan(7, 'reviewer', { hold: true });
  built.agent.plan(7, 'architect', { hold: true });

  const ran = built.loop.run();
  await waitFor(() => built.agent.held(7, 'reviewer') && built.agent.held(7, 'architect'), 20_000);
  built.agent.release(7, 'reviewer');
  await waitFor(() => judgeDispatch(built, 7, 'reviewer').l1.some((each) => each.event === 'dispatch.end'), 20_000);
  assert.deepEqual(recorded(built, 'L3', 'pull', (each) => each.card === 8), [], 'card B was claimed while one of card A\'s judges still ran');
  built.agent.release(7, 'architect');
  await ran;

  const events = built.events();
  const ends = ['reviewer', 'architect'].map((role) => events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.end' && each.dispatch === judgeDispatch(built, 7, role).l3.dispatch));
  const claimB = events.findIndex((each) => each.layer === 'L3' && each.event === 'pull' && each.card === 8);
  assert.ok(claimB > Math.max(...ends), JSON.stringify(events));
});

// proves R-SCHED-2
test('the card\'s slot is released only once every judge dispatch under its claim has handed back its outcome: slot.release follows every judge\'s dispatch.end', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });
  built.agent.plan(3, 'architect', { write: true, await: 'reviewer' });
  built.agent.plan(3, 'reviewer', { write: true });

  await built.loop.pull();

  const events = built.events();
  const release = events.findIndex((each) => each.layer === 'L3' && each.event === 'slot.release' && each.card === 3);
  for (const role of ['engineer', 'reviewer', 'architect']) {
    const { l3 } = judgeDispatch(built, 3, role);
    const end = events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.end' && each.dispatch === l3.dispatch);
    assert.ok(end >= 0 && end < release, `${role}: ${JSON.stringify(events)}`);
  }
});

// proves R-SCHED-2
test('given one judge whose stand-in leaves a process in its group after it exits, slot.release follows L0\'s record of that process', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));
  built.agent.plan(7, 'architect', { leaveInGroup: '.' });

  await built.loop.pull();

  const pid = built.pid(7, 'architect');
  const events = built.events();
  const ended = events.findIndex((each) => ['survivor.killed', 'survivor.unended'].includes(each.event) && each.pid === pid);
  const release = events.findIndex((each) => each.layer === 'L3' && each.event === 'slot.release' && each.card === 7);
  assert.ok(ended >= 0 && ended < release, JSON.stringify(events));
});

test('given one judge\'s dispatch refused at its start event, the other judges\' outcomes still reach L3, and the pull\'s failure names the refused judge and the card', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ ...reviewed(7), refuse: ({ layer, event, fields }) => layer === 'L3' && event === 'dispatch' && fields.role === 'reviewer' });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled with no failure'), (error) => error);

  const messages = JSON.stringify(failure.errors.flatMap(function flat(error) { return error instanceof AggregateError ? error.errors.flatMap(flat) : [error.message]; }));
  assert.match(messages, /card #7/);
  assert.match(messages, /\breviewer\b/);
  const { l1 } = judgeDispatch(built, 7, 'architect');
  assert.equal(l1.find((each) => each.event === 'dispatch.end')?.exit, 0);
  const [card] = failure.errors;
  assert.deepEqual(card.judges.map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'architect', exit: 0 }]);
});

test('given one judge\'s dispatch that runs past its time, the other judges\' outcomes still reach L3, and the pull\'s answer names that judge and its timeout', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, timeout: 2_000 } };
  const built = judgeWorld({ ...reviewed(7), roles });
  built.agent.plan(7, 'reviewer', { forever: true });

  const [reached] = await built.loop.pull();

  const judges = Object.fromEntries(reached.judges.map(({ role, outcome }) => [role, outcome.value]));
  assert.equal(judges.reviewer.timedOut, true);
  assert.equal(judges.architect.exit, 0);
  assert.equal(judges.architect.timedOut, false);
});

test('the card\'s column is unchanged by any judge\'s outcome, which the fake board\'s write record shows', SETTLES_WITHIN, async () => {
  const pulled = judgeWorld(reviewed(7));
  pulled.agent.plan(7, 'reviewer', { exit: 3 });
  await pulled.loop.pull();
  assert.deepEqual(pulled.fake.writes(), []);

  const made = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });
  made.agent.plan(3, 'architect', { exit: 5 });
  await made.loop.pull();
  assert.deepEqual(made.fake.writes().map(({ args: [, column] }) => column), [COLUMNS.coding, COLUMNS.review]);
});

test('loop is refused when built where judgeDirectory is not a function, naming it, as a workspace handle that is not one is refused', () => {
  const built = judgeWorld(reviewed(7));
  for (const judgeDirectory of [undefined, null, 'judges', {}]) {
    assert.throws(() => loop({ ...built.handed, judgeDirectory }), /\bjudgeDirectory\b/, String(judgeDirectory));
  }
});
