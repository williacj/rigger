// ABOUTME: Tests L3's dispatch of a Review card's judges under the card's one claim and slot: after
// the maker in the same claim and for a Review card pulled for them, each in its own directory with
// its steps run in its `head`, concurrently, and how a refused, timed-out or withheld judge ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

test('L2\'s facts call reads a Review card\'s one open pull request, its diff and its comments before L3 takes any claim', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  const pull = at(built, (entry) => appended(entry, 'L3', 'pull'));
  assert.ok(pull > 0, JSON.stringify(built.log));
  const before = built.log.slice(0, pull).filter((entry) => entry.read !== undefined).map((entry) => entry.read);
  for (const read of [['readMergeBase', 1007], ['readDiff', 1007], ['readComments', 1007]]) {
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

test('in that case, the fake forge reads only the settle\'s pull facts and moved card\'s acceptance history before the judges\' dispatch', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });

  await built.loop.pull();

  const settle = built.log.findLastIndex((entry) => entry.read?.[0] === 'readPullRequests' && entry.read[1] === 'rigger-3');
  const judges = at(built, (entry) => appended(entry, 'L3', 'dispatch', (each) => each.fields.role === 'reviewer'));
  assert.ok(settle > 0 && judges > settle, JSON.stringify(built.log));
  const between = built.log.slice(settle + 1, judges).filter((entry) => entry.read !== undefined);
  // The settle reads its pull facts once; the accepted move also reads this card's history.
  assert.deepEqual(between.map((entry) => entry.read).sort(), [['readCheckStates', HEAD], ['readComments', 1003], ['readDiff', 1003], ['readEffectiveRules', 'main'], ['readIssueHistory', 3], ['readMergeBase', 1003], ['readMergeable', 1003]]);
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
  const asked = asks.filter((each) => each.settled === 1 && each.options?.forge !== undefined);
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

test('given a card whose maker L3 dispatches, the maker\'s dispatch.start records the SHA-256 digest of the evidence L2 composed for it', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)] });

  await built.loop.pull();

  const maker = built.decisions.find(({ card, answer }) => card === 3 && answer.action === 'dispatch' && answer.maker !== undefined)?.answer.maker;
  assert.ok(maker !== undefined, 'L2 named no maker, so the test proves nothing');
  const [l3] = recorded(built, 'L3', 'dispatch', (each) => each.card === 3 && each.role === 'engineer');
  const start = built.events().find((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === l3.dispatch);
  assert.equal(start.digest, createHash('sha256').update(maker.evidence, 'utf8').digest('hex'));
});

// proves R-VERDICT-5
test('given L3 dispatching a judge under an id, the instruction that judge\'s stand-in agent received names that id as its marker\'s dispatch', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  for (const role of ['reviewer', 'architect']) {
    const { l3 } = judgeDispatch(built, 7, role);
    assert.match(l3?.dispatch ?? '', /^d-[0-9a-f-]{36}$/, role);
    const [run] = runsOf(built, 7, role);
    assert.ok(run.input.split('\n').includes(`dispatch: ${l3.dispatch}`), `${role} was handed ${run.input}`);
  }
});

// proves R-EVIDENCE-5, R-VERDICT-5
test('the evidence digest the instruction tells a judge its marker must carry equals the digest its dispatch.start records', SETTLES_WITHIN, async () => {
  const built = judgeWorld(reviewed(7));

  await built.loop.pull();

  for (const role of ['reviewer', 'architect']) {
    const start = judgeDispatch(built, 7, role).l1.find((each) => each.event === 'dispatch.start');
    assert.match(start.digest ?? '', /^[0-9a-f]{64}$/, role);
    const [run] = runsOf(built, 7, role);
    assert.ok(run.input.split('\n').includes(`evidence: ${start.digest}`), `${role}'s dispatch.start records ${start.digest}, and it was handed ${run.input}`);
  }
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

// proves R-WORK-35
test('a judge still running when its pull request merges is removed only after the judge ends', SETTLES_WITHIN, async () => {
  const removed = [];
  const built = judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] }, removeDirectories: async (card) => { removed.push(card); } });
  built.agent.plan(7, 'reviewer', { hold: true });
  built.agent.plan(7, 'architect', { hold: true });

  const first = built.loop.pull();
  await waitFor(() => built.agent.held(7, 'reviewer') && built.agent.held(7, 'architect'), 20_000);
  built.repository.update(1007, { merged: true });
  assert.deepEqual(await built.loop.pull(), []);
  assert.deepEqual(removed, []);
  built.agent.release(7, 'reviewer');
  built.agent.release(7, 'architect');
  await first;
  if (removed.length === 0) await built.loop.pull();

  assert.deepEqual(removed, [7]);
  const events = built.events();
  const ends = events.filter(({ layer, event, card }) => layer === 'L1' && event === 'dispatch.end' && card === 7);
  const transition = events.findIndex(({ layer, event, card, to }) => layer === 'L2' && event === 'transition' && card === 7 && to === 'done');
  assert.equal(ends.length, 2);
  assert.ok(transition > events.lastIndexOf(ends.at(-1)), JSON.stringify(events));
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
  const [card] = failure.reached.filter((each) => each.card === 7);
  assert.deepEqual(card.judges.filter(({ outcome }) => outcome !== undefined).map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'architect', exit: 0 }]);
});

/** What `failure`, a pull's rejection, holds as messages, every AggregateError in it opened, however deep. */
const messagesIn = (failure) => failure.errors.flatMap(function flat(error) { return error instanceof AggregateError ? error.errors.flatMap(flat) : [error.message]; });

/** The maker's result for card `card` among `reached`, a pull's answer, as its workspace, its exit code and its settle's status. */
const makerOf = (reached, card) => reached.filter((each) => each.card === card).map(({ workspace, outcome, settled }) => ({ workspace, exit: outcome?.value?.exit, settled: settled?.status }));

test('given a claim in which the maker exits 0 and opens a pull request, and a judge\'s L3 dispatch event is then refused under the same claim, the pull rejects, its failure\'s reached holds the card with the maker\'s result, and its failure names the card and the judge', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)], refuse: ({ layer, event, fields }) => layer === 'L3' && event === 'dispatch' && fields.role === 'reviewer' });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled with no failure'), (error) => error);

  assert.deepEqual(built.fake.writes().map(({ args: [, column] }) => column), [COLUMNS.coding, COLUMNS.review], 'the maker did not move the card to Review, so the test proves nothing');
  assert.deepEqual(makerOf(failure.reached, 3), [{ workspace: join(built.scratch, 'workspaces', 'rigger-3'), exit: 0, settled: 'fulfilled' }]);
  assert.ok(messagesIn(failure).some((message) => /card #3/.test(message) && /\breviewer\b/.test(message) && /refused/.test(message)), JSON.stringify(messagesIn(failure)));
  const [card] = failure.reached.filter((each) => each.card === 3);
  assert.deepEqual(card.judges.filter(({ outcome }) => outcome !== undefined).map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'architect', exit: 0 }]);
});

test('given that claim where L2\'s judge answer throws for one judge, on a directory outcome that is not L1\'s failure to make it, the pull rejects, its failure\'s reached holds the card with the maker\'s result, and its failure names the card and the judge', SETTLES_WITHIN, async () => {
  let built;
  const judgeDirectory = async (card, role, head) => {
    if (role === 'reviewer') throw new Error('the test fails the make of reviewer\'s directory with no code of L1\'s');
    return makingJudgeDirectories(join(built.scratch, 'workspaces'))(card, role, head);
  };
  built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready)], judgeDirectory });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled with no failure'), (error) => error);

  assert.deepEqual(makerOf(failure.reached, 3), [{ workspace: join(built.scratch, 'workspaces', 'rigger-3'), exit: 0, settled: 'fulfilled' }]);
  assert.ok(messagesIn(failure).some((message) => /card #3's judge `reviewer`/.test(message) && /not L1's failure to make it/.test(message)), JSON.stringify(messagesIn(failure)));
  const [card] = failure.reached.filter((each) => each.card === 3);
  assert.deepEqual(card.judges.filter(({ outcome }) => outcome !== undefined).map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'architect', exit: 0 }]);
});

test('given a pull claiming two cards whose makers both run, one with a judge whose L3 dispatch event is refused and one whose judges all hand back, the pull rejects, and its failure\'s reached holds both cards, the second with its judges', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(3, COLUMNS.ready), cardIn(4, COLUMNS.ready)], concurrency: 2, refuse: ({ layer, card, event, fields }) => layer === 'L3' && card === 3 && event === 'dispatch' && fields.role === 'reviewer' });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled with no failure'), (error) => error);

  assert.deepEqual(failure.reached.map((each) => each.card).sort(), [3, 4]);
  assert.deepEqual(makerOf(failure.reached, 3), [{ workspace: join(built.scratch, 'workspaces', 'rigger-3'), exit: 0, settled: 'fulfilled' }]);
  assert.deepEqual(makerOf(failure.reached, 4), [{ workspace: join(built.scratch, 'workspaces', 'rigger-4'), exit: 0, settled: 'fulfilled' }]);
  const [four] = failure.reached.filter((each) => each.card === 4);
  assert.deepEqual(four.judges.map(({ role, outcome }) => ({ role, exit: outcome.value?.exit })), [{ role: 'reviewer', exit: 0 }, { role: 'architect', exit: 0 }]);
  assert.equal(failure.errors.length, 1, JSON.stringify(messagesIn(failure)));
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

import { optionalWorld } from './optional-config-world.mjs';
import { minimalConfig } from './optional-config.mjs';
import { card as consumerCard } from './verb-consumer.mjs';
import { gitIn } from './git-repository.mjs';
import { seedRepositoryAt } from './fake-gh.mjs';
import { spentRounds } from './judge-world.mjs';

/** A new verb invocation over the existing logical-agent and forge contracts, with no judge marker. */
function failingJudgeInvocation(t, options = {}) {
  const settings = minimalConfig();
  settings.kinds.change.judges = ['reviewer'];
  const built = optionalWorld(t, 'minimal', {
    settings,
    items: [consumerCard(10, 'Review')],
    plan: { 10: { reviewer: { exit: 7 } } },
    ...options,
  });
  const head = gitIn(built.consumer, 'rev-parse', 'HEAD').trim();
  gitIn(built.consumer, 'push', '-q', 'origin', 'HEAD:refs/heads/rigger-10');
  const { number, title, body, labels } = consumerCard(10, 'Review');
  seedRepositoryAt(built.statePath, { issues: [{ number, title, body, labels }], pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: head, diff: '' }] });
  return { ...built, head };
}

// A started nonzero judge must leave an observable failure, rather than disappearing between runs.
// proves R-LOOP-25
test('1437 A1: a judge exiting nonzero without a verdict records one failure at its dispatched head and acceptance', async (t) => {
  const built = failingJudgeInvocation(t);
  const round = { number: 10, pull: 11, body: consumerCard(10, 'Review').body };
  const spent = () => spentRounds(built.state().repository.pullRequests[0].comments ?? [], round);
  const before = spent();
  await built.start();
  assert.deepEqual(built.fixtureErrors, []);
  const events = built.events();
  const start = events.find(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer');
  assert.ok(start, 'the reviewer must actually be dispatched');
  const input = built.starts.find(({ command }) => command === 'claude').input;
  const failures = events.filter(({ event }) => event === 'judge.failed');
  assert.equal(failures.length, 1, 'one started judge without a readable verdict must record exactly one judge.failed');
  assert.equal(spent(), before, 'the failure itself spends no round');
  assert.deepEqual(failures.map(({ card, dispatch, role, pull, head, digest, outcome }) => ({ card, dispatch, role, pull, head, digest, outcome })), [{
    card: 10, dispatch: start.dispatch, role: 'reviewer', pull: 11, head: built.head,
    digest: input.match(/^digest: ([0-9a-f]{64})$/m)[1], outcome: { exit: 7, timedOut: false },
  }]);
});

// Each start calls the same once export the CLI calls; each invocation constructs a fresh loop.
// The consumer's forge and append-only event record are the only workflow history between them.
// proves R-LOOP-26, R-LOOP-27
test('1437 B1: two fresh once invocations escalate the second failure naming the judge and both dispatches', async (t) => {
  const built = failingJudgeInvocation(t);
  await built.start();
  assert.equal(built.events().filter(({ event }) => event === 'judge.failed').length, 1);
  assert.deepEqual(built.events().filter(({ event }) => event === 'review.escalate'), []);
  const second = await built.start();
  assert.deepEqual(built.fixtureErrors, []);
  const failures = built.events().filter(({ event }) => event === 'judge.failed');
  assert.equal(failures.length, 2);
  assert.notEqual(failures[0].dispatch, failures[1].dispatch);
  const raised = built.events().filter(({ event }) => event === 'review.escalate');
  assert.equal(raised.length, 1, 'the second once invocation escalates the judge failure pair');
  assert.equal(raised[0].category, 'ambiguous');
  assert.equal(raised[0].raiser, 'loop');
  for (const text of ['reviewer', ...failures.map(({ dispatch }) => dispatch)]) assert.ok(raised[0].reason.includes(text), text);
  assert.deepEqual(built.state().writes.filter(({ operation }) => operation === 'moveItem').map(({ args }) => args), [['item-1', 'Owner']], second.text);
  assert.ok(built.state().repository.issues[0].labels.includes('rigger:escalated'));
});

import { acceptanceDigest, composeMarker } from '../src/workflow/marker.mjs';
import { KINDS } from './judge-world.mjs';

/** Fresh L3 handles share only the record reader and stand-in forge; no loop handle is reused. */
const freshJudges = (built, options = {}) => loop({ ...built.handed, readRecord: built.events, ...options });
const oneJudgeKind = { change: { ...KINDS.change, judges: ['reviewer'] } };
const judgeVerdict = (body = cardIn(7, COLUMNS.review).body) => composeMarker({
  card: 7, pull: 1007, head: HEAD, digest: acceptanceDigest(body), role: 'reviewer', provider: config.roles.reviewer.provider,
  verdict: 'sound', items: ['met'], coverage: 'covered',
}, 'Sound');

// A verdict read in an intervening invocation breaks the pair even after that comment is edited.
// proves R-LOOP-28
test('1437 B6: a readable verdict between two fresh failure invocations restarts the count', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  await freshJudges(built).pull();
  built.repository.comment(1007, judgeVerdict(), '2026-11-21T01:00:00Z');
  await freshJudges(built).pull();
  assert.ok(recorded(built, 'L2', 'marker.read').some(({ verdict }) => verdict === 'sound'), 'the intervening invocation actually read the verdict');
  built.repository.update(1007, { comments: built.repository.pull(1007).comments.map((comment) => ({ ...comment, lastEditedAt: '2026-11-21T01:01:00Z' })) });
  const failure = await freshJudges(built).pull().then(() => undefined, (error) => error);
  assert.equal(recorded(built, 'L2', 'judge.failed').length, 2);
  assert.deepEqual(recorded(built, 'L2', 'review.escalate'), [], 'a verdict between failures resets the count');
  assert.equal(failure, undefined);
});

import { columnChanges } from '../src/workflow/transitions.mjs';

// Both engine escalation routes restart the count; the label is only the owner's stop signal.
// proves R-LOOP-29
test('1437 B8: a recorded loop or maker escalation separates fresh judge failure invocations', SETTLES_WITHIN, async (t) => {
  for (const raiser of ['loop', 'maker']) await t.test(raiser, async () => {
    const issue = cardIn(7, COLUMNS.review);
    const built = judgeWorld({ cards: [issue], kinds: oneJudgeKind,
      forge: { pullRequests: [pullFor(7)], issues: [{ number: 7, title: issue.title, body: issue.body, labels: issue.labels }] } });
    built.agent.plan(7, 'reviewer', { exit: 7 });
    await freshJudges(built).pull();
    const [card] = await built.fake.operations.readItems();
    const changes = columnChanges({ config: built.handed.config, sink: built.handed.sink, items: built.fake.operations,
      reads: built.repository.operations, repositoryWrites: built.repository });
    await changes.escalated(card, { category: 'ambiguous', raiser, destination: 'owner', reason: 'An earlier question for the owner.' });
    built.fake.setIssueLabels(config.repo, 7, [...issue.labels, 'rigger:escalated']);
    built.fake.setIssueLabels(config.repo, 7, issue.labels);
    await built.fake.operations.moveItem(card.id, COLUMNS.review);
    const failed = await freshJudges(built).pull().then(() => undefined, (error) => error);
    assert.equal(recorded(built, 'L2', 'judge.failed').length, 2);
    assert.equal(recorded(built, 'L2', 'review.escalate').length, 1, `${raiser}: no escalation after the owner's answer`);
    assert.equal(failed, undefined);
  });
});

import { manualClock } from './clock-report-world.mjs';
import { realHost } from '../src/substrate/host.mjs';

/** The native stand-in establishes readiness; only the injected clock expires its judge deadline. */
async function timedJudge(built, { verdict = false } = {}) {
  const clock = { ...manualClock(), pause: async () => {} };
  const prior = realHost.clock;
  realHost.clock = clock;
  try {
    built.agent.plan(7, 'reviewer', { hold: true });
    const running = freshJudges(built, { clock }).pull();
    const result = running.then((value) => ({ value }), (error) => ({ error }));
    await waitFor(() => built.agent.held(7, 'reviewer'), 20_000);
    if (verdict) built.repository.comment(1007, judgeVerdict(), '2026-11-21T02:00:00Z');
    await clock.advance(clock.now() + 1001);
    return await result;
  } finally { realHost.clock = prior; }
}

// An exited first failure and a timed-out second dispatch form the same bounded failure pair.
// proves R-LOOP-26, R-LOOP-27
test('1437 B2: a fresh timeout invocation completes an earlier exit failure pair', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, timeout: 1000 } };
  const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind, roles });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  await freshJudges(built).pull();
  await timedJudge(built);
  const failures = recorded(built, 'L2', 'judge.failed');
  assert.equal(failures.length, 2);
  assert.equal(failures[1].outcome.timedOut, true, 'the second dispatch really exceeded its injected deadline');
  assert.equal(recorded(built, 'L2', 'review.escalate').length, 1);
});

// A single failure must remain retryable, without spending the pair's second failure in advance.
// proves R-LOOP-27
test('1437 B3: one failure dispatches the judge again in a fresh invocation without escalation', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
  assert.deepEqual(recorded(built, 'L2', 'review.escalate'), []);
  built.agent.plan(7, 'reviewer', { exit: 0 });
  await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
  assert.equal(recorded(built, 'L3', 'dispatch').length, 2, 'the next invocation dispatches the judge again');
  assert.equal(recorded(built, 'L2', 'judge.failed').length, 1);
  assert.deepEqual(recorded(built, 'L2', 'review.escalate'), []);
});

// Failures at different heads or acceptances cannot be paired by a role alone.
// proves R-LOOP-27
test('1437 B4 B5: fresh invocations at a changed head or acceptance do not complete a failure pair', SETTLES_WITHIN, async (t) => {
  for (const changed of ['head', 'acceptance']) await t.test(changed, async () => {
    const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind });
    built.agent.plan(7, 'reviewer', { exit: 7 });
    await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
    const options = {};
    if (changed === 'head') built.repository.update(1007, { sha: '6'.repeat(40) });
    else {
      const prior = built.handed.board;
      options.board = { ...prior, readPriority: async () => {
        const read = await prior.readPriority();
        return { ...read, items: read.items.map((card) => ({ ...card, body: card.body.replace('prints its help', 'prints its usage') })) };
      } };
    }
    await assert.doesNotReject(freshJudges(built, options).pull(), 'the non-escalating invocation must settle successfully');
    const failures = recorded(built, 'L2', 'judge.failed');
    assert.equal(failures.length, 2);
    assert.notEqual(failures[0][changed === 'head' ? 'head' : 'digest'], failures[1][changed === 'head' ? 'head' : 'digest']);
    assert.deepEqual(recorded(built, 'L2', 'review.escalate'), [], `${changed}: these failures are not at one pair`);
  });
});

// A timeout's readable verdict resets earlier failures, including its own failure event.
// proves R-LOOP-28
test('1437 B7 B12: a readable timeout verdict separates failures in either position', SETTLES_WITHIN, async (t) => {
  for (const firstTimeout of [false, true]) await t.test(firstTimeout ? 'B12' : 'B7', async () => {
    const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, timeout: 1000 } };
    const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind, roles });
    if (!firstTimeout) {
      built.agent.plan(7, 'reviewer', { exit: 7 });
      await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
    }
    const ended = await timedJudge(built, { verdict: true });
    assert.equal(ended.error, undefined);
    if (firstTimeout) {
      built.repository.update(1007, { comments: built.repository.pull(1007).comments.map((comment) => ({ ...comment, lastEditedAt: '2026-11-21T02:01:00Z' })) });
      built.agent.plan(7, 'reviewer', { exit: 7 });
      await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
    }
    assert.equal(recorded(built, 'L2', 'judge.failed').length, 2);
    assert.ok(recorded(built, 'L2', 'marker.read').some(({ verdict }) => verdict === 'sound'));
    assert.deepEqual(recorded(built, 'L2', 'review.escalate'), [], 'the timeout verdict breaks the failure pair');
  });
});

// A hand-added label is not a recorded Rigger escalation and therefore cannot reset failures.
// proves R-LOOP-29
test('1437 B9: an owner label added and removed between fresh failures does not reset their pair', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
  built.fake.setIssueLabels(config.repo, 7, ['type:change', 'rigger:escalated']);
  built.fake.setIssueLabels(config.repo, 7, ['type:change']);
  await freshJudges(built).pull().catch(() => {});
  assert.equal(recorded(built, 'L2', 'judge.failed').length, 2);
  assert.equal(recorded(built, 'L2', 'review.escalate').length, 1, 'the unrecorded label does not forgive the first failure');
});

// A second role's failure cannot complete the first role's pair on the same card.
// proves R-LOOP-27
test('1437 B10: two judges failing in separate invocations each have only one failure', SETTLES_WITHIN, async () => {
  const kinds = { change: { ...oneJudgeKind.change, judges: ['reviewer', 'architect'] } };
  const built = judgeWorld({ ...reviewed(7), kinds });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
  const comments = built.repository.pull(1007).comments.map((comment) => ({ ...comment, lastEditedAt: '2026-11-21T02:01:00Z' }));
  built.repository.update(1007, { comments });
  built.repository.comment(1007, judgeVerdict(), '2026-11-21T02:02:00Z');
  built.agent.plan(7, 'architect', { exit: 7 });
  await assert.doesNotReject(freshJudges(built).pull(), 'the non-escalating invocation must settle successfully');
  assert.deepEqual(recorded(built, 'L2', 'judge.failed').map(({ role }) => role), ['reviewer', 'architect']);
  assert.deepEqual(recorded(built, 'L2', 'review.escalate'), []);
});

// Clock-held runs have no per-invocation judge memory; the event record still bounds retries.
// proves R-LOOP-26, R-LOOP-27
test('1437 B11: two judge failures in one clock-held run escalate once', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ ...reviewed(7), kinds: oneJudgeKind });
  built.agent.plan(7, 'reviewer', { exit: 7 });
  const clock = { ...manualClock(Date.now()), pause: async () => {} };
  const config = { ...built.handed.config, clock: { poll: 1000, triggers: { later: {
    interval: 3600000, anchor: new Date(clock.now()).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const stop = new AbortController();
  const running = freshJudges(built, { config, clock }).run({ stop: stop.signal });
  const result = running.then((value) => ({ value }), (error) => ({ error }));
  try { await waitFor(() => recorded(built, 'L2', 'review.escalate').length === 1, 20_000); }
  finally { stop.abort(); await result; }
  assert.equal(recorded(built, 'L2', 'judge.failed').length, 2);
  assert.equal(recorded(built, 'L2', 'review.escalate')[0].category, 'ambiguous');
});

import { appendFileSync } from 'node:fs';

// Losing the event history must preserve the current failure without inventing a pair.
// proves R-LOOP-26
test('1437 unreadable record: once records the second failure without escalation and names the unreadable stream', async (t) => {
  let calls = 0;
  let built;
  built = failingJudgeInvocation(t, { beforeAgent: async () => {
    if (++calls === 2) appendFileSync(join(built.consumer, '.rigger', 'events.jsonl'), 'unreadable event\n');
  } });
  await built.start();
  const result = await built.start();
  const stream = join(built.consumer, '.rigger', 'events.jsonl');
  const events = readFileSync(stream, 'utf8').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  assert.equal(events.filter(({ event }) => event === 'judge.failed').length, 2, 'the current failure is still recorded');
  assert.deepEqual(events.filter(({ event }) => event === 'review.escalate'), []);
  assert.ok(result.text.includes(stream), 'the verb names the record it could not read');
});
