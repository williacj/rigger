// ABOUTME: Tests L3 closing admission on L2's `hold` answer, with one closer and one `admission.close`
// event per card, at the maker's and the judges' asks, through `loop`'s one admission handle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { closerText, moduleOver, removeClosers, seed } from './admission-world.mjs';
import { boardOf, handleOn, waitFor } from './loop-world.mjs';
import { heldCard } from './stop-failure.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The run id the loops here are built under, and their sinks open with. */
const RUN = 'r-hold-close';

/**
 * Everything `loop` takes, over a fake board holding `cards` ready, with no process of any kind:
 * every handle L3 is handed answers from memory. `overrides` replaces any of them.
 */
function handles({ cards = [1], ...overrides } = {}) {
  const state = temporaryDirectory('rigger-hold-close-');
  const fake = boardOf(cards);
  return {
    config,
    board: handleOn(fake),
    decide: () => ({ action: 'none' }),
    facts: async () => () => ({ action: 'none' }),
    l2: { claimed: async () => {}, settled: async () => ({}), escalated: async () => {} },
    sink: openSink({ directory: state, run: RUN, now: () => 1 }),
    kill: async () => {},
    workspace: async () => { throw new Error('no workspace here'); },
    judgeDirectory: async () => { throw new Error('no judge directory here'); },
    removeDirectories: async () => {},
    state,
    environment: {},
    run: RUN,
    ...overrides,
  };
}

// proves R-FAIL-8
test('loop handed no run id, or an empty one, throws when built, naming the run id', () => {
  for (const run of [undefined, '']) {
    assert.throws(() => loop(handles({ run })), (failure) => {
      assert.match(failure.message, /run id/, failure.message);
      assert.ok(failure.message.includes(JSON.stringify(run) ?? 'undefined'), failure.message);
      return true;
    });
  }
});

/** The failures L2 names for a card's two attempts here, each written by hand. */
const FIRST = { workspace: '/nowhere/rigger-1', reason: 'no workspace here', attempt: 1 };
const SECOND = { workspace: '/nowhere/rigger-1', reason: 'no workspace here', attempt: 2 };

/** L2's answer at the pull: a card L3 is to dispatch. */
const DISPATCH = { action: 'dispatch', kind: 'change' };

/**
 * L2 asked within an attempt, as `R-FAIL-8` has it answer a workspace not made the same way twice:
 * `again` after the first, `hold` after the second, carrying the first failure L3 handed it.
 */
const holdingOnWorkspace = (card, outcomes, options = {}) => {
  if (options.workspace === undefined) return { action: 'none' };
  return options.attempt === 1
    ? { action: 'again', attempt: 2, failure: FIRST }
    : { action: 'hold', card: card.number, firstFailure: options.firstFailure, failure: SECOND };
};

/** The `admission.close` events in state directory `state`'s stream. */
const closes = (state) => readEvents(state).filter((event) => event.event === 'admission.close');

/** The closers admission's module reads in state directory `state`. */
const closersIn = (state) => moduleOver(state).read().closers ?? [];

// proves R-FAIL-8
test('a workspace not made the same way on both attempts, answered hold, links one closer and records one admission.close event, and the card ends held', async () => {
  const handed = handles({ facts: async () => () => DISPATCH, decide: holdingOnWorkspace });

  await assert.rejects(loop(handed).pull(), heldCard(1));

  assert.equal(closersIn(handed.state).length, 1, JSON.stringify(closersIn(handed.state)));
  assert.equal(closersIn(handed.state)[0].kind, 'hold');
  assert.equal(closes(handed.state).length, 1);
});

/** A workspace that L1 answers at a path that does not exist, so nothing L3 dispatches there starts. */
const absentWorkspace = async (number) => ({ path: `/nowhere/rigger-${number}`, scratch: '/nowhere/scratch', repository: '/nowhere/repository' });

/** A required step L2 names for an attempt, whose run is never reached here. */
const STEP = { name: 'ready', run: 'true', required: true };

/**
 * L2 asked within an attempt about a required step that never started: it names the step while
 * the attempt has no outcome, then answers `again` after the first attempt's and `hold` after the
 * second's, carrying the first failure L3 handed it.
 */
const holdingOnStep = (card, outcomes, options = {}) => {
  if (outcomes.length === 0) return { action: 'dispatch', step: STEP };
  return options.attempt === 1
    ? { action: 'again', attempt: 2, failure: { ...FIRST, step: 'ready' } }
    : { action: 'hold', card: card.number, firstFailure: options.firstFailure, failure: { ...SECOND, step: 'ready' } };
};

// proves R-FAIL-8
test('a required step that fails the same way on both attempts, answered hold, links one closer and records one admission.close event, and the card ends held', async () => {
  const handed = handles({ facts: async () => () => ({ ...DISPATCH, step: STEP }), decide: holdingOnStep, workspace: absentWorkspace });

  await assert.rejects(loop(handed).pull(), heldCard(1));

  assert.equal(closersIn(handed.state).length, 1, JSON.stringify(closersIn(handed.state)));
  assert.equal(closes(handed.state).length, 1);
  assert.ok(readEvents(handed.state).some((event) => event.event === 'dispatch' && event.step === 'ready' && event.attempt === 2), 'the second attempt dispatched no step');
});

/** A maker L2 names whose provider no adapter is held for, so L1 reports it never started. */
const MAKER = { role: 'engineer', tier: 'standard', provider: 'no-such-provider' };

/**
 * L2 asked within an attempt about a maker that never started: it names the maker until L3 hands
 * it the maker's outcome, then answers `again` after the first attempt's and `hold` after the
 * second's, carrying the first failure L3 handed it.
 */
const holdingOnMaker = (card, outcomes, options = {}) => {
  if (options.maker === undefined) return { action: 'dispatch', maker: MAKER };
  return options.attempt === 1
    ? { action: 'again', attempt: 2, failure: { ...FIRST, maker: options.maker.reason?.message } }
    : { action: 'hold', card: card.number, firstFailure: options.firstFailure, failure: { ...SECOND, maker: options.maker.reason?.message } };
};

// proves R-FAIL-8
test('a maker that never started on both attempts, answered hold, links one closer and records one admission.close event, and the card ends held', async () => {
  const handed = handles({ facts: async () => () => ({ ...DISPATCH, maker: MAKER }), decide: holdingOnMaker, workspace: absentWorkspace });

  await assert.rejects(loop(handed).pull(), heldCard(1));

  assert.equal(closersIn(handed.state).length, 1, JSON.stringify(closersIn(handed.state)));
  assert.equal(closes(handed.state).length, 1);
  assert.equal(readEvents(handed.state).filter((event) => event.event === 'dispatch' && event.role === 'engineer').length, 2);
});

// proves R-FAIL-8
test('a hold\'s closer\'s reason holds #<card>, and each of L2\'s firstFailure and failure as JSON.stringify gives it', async () => {
  const handed = handles({ cards: [7], facts: async () => () => DISPATCH, decide: holdingOnWorkspace });

  await assert.rejects(loop(handed).pull(), heldCard(7));

  const [closer] = closersIn(handed.state);
  assert.ok(closer.reason.includes('#7'), closer.reason);
  assert.ok(closer.reason.includes('{"workspace":"/nowhere/rigger-1","reason":"no workspace here","attempt":1}'), closer.reason);
  assert.ok(closer.reason.includes('{"workspace":"/nowhere/rigger-1","reason":"no workspace here","attempt":2}'), closer.reason);
});

/** The cards L3 recorded a `pull` event for in state directory `state`'s stream, in order. */
const pulled = (state) => readEvents(state).filter((event) => event.layer === 'L3' && event.event === 'pull').map((event) => event.card);

/** L2 asked about a workspace not made twice, failing in different ways, so it answers `stop`. */
const stoppingOnWorkspace = (card, outcomes, options = {}) => {
  if (options.workspace === undefined) return { action: 'none' };
  return options.attempt === 1
    ? { action: 'again', attempt: 2, failure: FIRST }
    : { action: 'stop', card: card.number, failure: { ...SECOND, reason: 'another way' } };
};

/**
 * The cards claimed in a `loop().run()` whose first pull's facts call answers `first`, L2's next
 * action for card 1, which then holds, for a workspace not made twice where `first` names no hold of
 * its own, and whose second pull's facts call removes every closer before L3 reads admission. Later
 * pulls answer a dispatch that stops, and after the third none. The run fails as `held` validates.
 */
async function claimedAfterRemoval(first, held = heldCard(1)) {
  let pulls = 0;
  const handed = handles({
    facts: async () => {
      pulls += 1;
      if (pulls === 2) removeClosers(handed.state);
      // Pulls after the third answer no card, so a run that never stops claiming still ends.
      return pulls === 1 ? first : () => (pulls <= 3 ? DISPATCH : { action: 'none' });
    },
    decide: (...args) => (pulls === 1 ? holdingOnWorkspace : stoppingOnWorkspace)(...args),
  });
  handed.config = { ...config, concurrency: 1 };

  await assert.rejects(loop(handed).run(), held);

  return pulled(handed.state);
}

// proves R-FAIL-8
test('given a hold in loop().run() whose closer is removed before that run\'s next pull, that pull claims the held card', async () => {
  assert.deepEqual(await claimedAfterRemoval(() => DISPATCH), [1, 1]);
});

/** L2's answer at the pull for a card whose maker continues on its open pull request. */
const CONTINUE = { action: 'continue', kind: 'change', pull: 101, head: 'b'.repeat(40) };

// proves R-FAIL-8
test('given a continuing card held in loop().run() whose closer is removed before that run\'s next pull, that pull claims the held card', async () => {
  assert.deepEqual(await claimedAfterRemoval(() => CONTINUE), [1, 1]);
});

// proves R-FAIL-8
test('given a card whose directories are removed and whose maker then continues, held in loop().run() with its closer removed before the next pull, that pull claims the held card', async () => {
  assert.deepEqual(await claimedAfterRemoval(() => ({ action: 'remove', kind: 'change', following: CONTINUE })), [1, 1]);
});

// proves R-FAIL-8
test('given a card pulled for its judges alone, held in loop().run() with its closer removed before the next pull, that pull claims the held card', async () => {
  assert.deepEqual(await claimedAfterRemoval(holdingJudges(['reviewer'], ['reviewer']), heldJudge(1, 'reviewer')), [1, 1]);
});

// proves R-FAIL-8
test('given a stop after two attempts that failed in different ways in loop().run(), a later pull in that run does not claim the card', async () => {
  let pulls = 0;
  // Pulls after the third answer no card, so a run that kept no memory still ends.
  const handed = handles({ cards: [1, 2], facts: async () => { pulls += 1; return () => (pulls <= 3 ? DISPATCH : { action: 'none' }); }, decide: stoppingOnWorkspace });
  handed.config = { ...config, concurrency: 1 };

  await assert.rejects(loop(handed).run());

  assert.deepEqual(pulled(handed.state), [1, 2]);
  assert.deepEqual(closersIn(handed.state), []);
});

/** The individual failures inside a pull's or a run's failure. */
const leaves = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leaves) : [failure]);

/** The two failures L2 names for a judge's pair here, each written by hand. */
const JUDGE_FIRST = { role: 'reviewer', reason: 'the judge did not start', dispatch: 1 };
const JUDGE_SECOND = { role: 'reviewer', reason: 'the judge did not start', dispatch: 2 };

/** A judge L2 names, whose provider no adapter is held for, so L1 reports its dispatch never started. */
const judgeNamed = (role) => ({ role, tier: 'standard', provider: 'no-such-provider', facts: { head: 'a'.repeat(40) }, steps: [], instruction: 'judge it\ndispatch: {dispatch}' });

/** L1's make of a judge's directory, answered from memory under a directory that does not exist. */
const absentJudgeDirectory = async (card, role) => ({ path: `/nowhere/judges/${role}`, main: '/nowhere/main', head: '/nowhere/head', scratch: '/nowhere/scratch', repository: '/nowhere/repository' });

/**
 * L2 asked about card's judges `roles`: it names them all until L3 hands it a judge's dispatch that
 * never started, and then answers `hold` for each role in `holds`, with that judge's role, and the
 * judge answer naming the rest otherwise.
 */
const holdingJudges = (roles, holds) => (card, outcomes, options = {}) => {
  const [role] = Object.keys(options.directories ?? {});
  if (role !== undefined && holds.includes(role)) {
    return { action: 'hold', card: card.number, role, firstFailure: { ...JUDGE_FIRST, role }, failure: { ...JUDGE_SECOND, role } };
  }
  return { action: 'judge', kind: 'change', judges: roles.map(judgeNamed) };
};

/**
 * An assert.rejects validator for card `number`'s judge `role` held: its failure names the card,
 * the role, that it was held and both failures, and does not say the failures came before the maker.
 */
const heldJudge = (number, role) => (failure) => {
  const held = leaves(failure).filter((each) => each?.decision === 'hold' && each.role === role);
  assert.equal(held.length, 1, failure?.stack);
  const [{ message }] = held;
  assert.ok(message.includes(`#${number}`), message);
  assert.ok(message.includes(`\`${role}\``), message);
  assert.ok(message.includes('held'), message);
  assert.ok(message.includes(JSON.stringify({ ...JUDGE_FIRST, role })), message);
  assert.ok(message.includes(JSON.stringify({ ...JUDGE_SECOND, role })), message);
  assert.ok(!message.includes('each failing before the maker'), message);
  return true;
};

/**
 * L2 asked within the attempt after a maker that never started: it names the maker, then, handed
 * its outcome, answers so that L3 asks it about the judges, which `judging` then answers.
 */
const afterMaker = (judging) => (card, outcomes, options = {}) => {
  if (options.forge !== undefined || options.directories !== undefined || options.judged !== undefined) return judging(card, outcomes, options);
  if (options.maker === undefined) return { action: 'dispatch', maker: MAKER };
  return { action: 'dispatch', maker: MAKER, settled: true };
};

// proves R-FAIL-8
test('a judge\'s dispatch that did not start, L2 answering hold to judged\'s ask after the maker, links one closer and one event, and the card ends held once every judge it dispatched hands back', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const handed = handles({
    facts: async () => () => ({ ...DISPATCH, maker: MAKER }),
    decide: afterMaker(holdingJudges(['reviewer', 'architect'], ['reviewer'])),
    workspace: absentWorkspace,
    // The architect's directory is made only once the test releases it, so it hands back last.
    judgeDirectory: async (card, role, head) => { if (role === 'architect') await waiting; return absentJudgeDirectory(card, role, head); },
  });

  let settled = false;
  const pull = loop(handed).pull().finally(() => { settled = true; });
  pull.catch(() => {});
  await waitFor(() => closersIn(handed.state).length === 1);

  assert.equal(settled, false, 'the card ended before its architect handed back');
  release();
  await assert.rejects(pull, heldJudge(1, 'reviewer'));
  assert.equal(closersIn(handed.state).length, 1);
  assert.equal(closes(handed.state).length, 1);
  assert.ok(readEvents(handed.state).some((event) => event.event === 'dispatch' && event.role === 'architect'), 'the architect was never dispatched');
});

// proves R-FAIL-8
test('a judge\'s dispatch that did not start, L2 answering hold to judged\'s ask for a card pulled for its judges alone, links one closer and one event, and the card ends held once every judge it dispatched hands back', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const judging = holdingJudges(['reviewer', 'architect'], ['reviewer']);
  const handed = handles({
    facts: async () => judging,
    workspace: async () => assert.fail('a card pulled for its judges alone makes no workspace'),
    judgeDirectory: async (card, role, head) => { if (role === 'architect') await waiting; return absentJudgeDirectory(card, role, head); },
  });

  let settled = false;
  const pull = loop(handed).pull().finally(() => { settled = true; });
  pull.catch(() => {});
  await waitFor(() => closersIn(handed.state).length === 1);

  assert.equal(settled, false, 'the card ended before its architect handed back');
  release();
  await assert.rejects(pull, heldJudge(1, 'reviewer'));
  assert.equal(closersIn(handed.state).length, 1);
  assert.equal(closes(handed.state).length, 1);
  assert.equal(readEvents(handed.state).filter((event) => event.event === 'dispatch' && event.role === 'engineer').length, 0);
});

// proves R-FAIL-8
test('two judges of one card, each answered hold, link one closer and record one admission.close event for the card', async () => {
  const judging = holdingJudges(['reviewer', 'architect'], ['reviewer', 'architect']);
  const handed = handles({ facts: async () => judging, judgeDirectory: absentJudgeDirectory });

  const failure = await loop(handed).pull().then(() => assert.fail('the pull settled, though both judges held'), (thrown) => thrown);

  assert.ok(heldJudge(1, 'reviewer')(failure) && heldJudge(1, 'architect')(failure));
  assert.equal(closersIn(handed.state).length, 1, JSON.stringify(closersIn(handed.state)));
  assert.equal(closes(handed.state).length, 1);
});

// proves R-FAIL-8
test('one judge answered hold and the other\'s refusal escalated: the closer is linked, then the escalation is written', async () => {
  const holdingReviewer = holdingJudges(['reviewer', 'architect'], ['reviewer']);
  const ESCALATION = { action: 'escalate', category: 'critical', reason: 'the architect\'s directory was refused' };
  const judging = (card, outcomes, options = {}) => (Object.hasOwn(options.directories ?? {}, 'architect') ? ESCALATION : holdingReviewer(card, outcomes, options));
  const written = [];
  const handed = handles({
    facts: async () => judging,
    judgeDirectory: absentJudgeDirectory,
    l2: { claimed: async () => {}, escalated: async (card, answer) => { written.push({ card: card.number, answer, closers: closersIn(handed.state).length }); } },
  });

  await assert.rejects(loop(handed).pull(), heldJudge(1, 'reviewer'));

  assert.deepEqual(written, [{ card: 1, answer: ESCALATION, closers: 1 }]);
  assert.equal(closes(handed.state).length, 1);
});

// proves R-FAIL-8
test('a judge\'s directory not made, L2 answering hold to judged\'s ask, links one closer and one event, and the card ends held', async () => {
  const handed = handles({ facts: async () => holdingJudges(['reviewer'], ['reviewer']), judgeDirectory: async () => { throw new Error('no judge directory here'); } });

  await assert.rejects(loop(handed).pull(), heldJudge(1, 'reviewer'));

  assert.equal(closersIn(handed.state).length, 1);
  assert.equal(closes(handed.state).length, 1);
});

// proves R-FAIL-8, R-SCHED-3
test('a card already claimed when another card\'s hold is linked finishes its work', async () => {
  // Card 2's judge withheld for its directory: L2 names no judge once handed that.
  const judging = (card, outcomes, options = {}) => (options.directories === undefined ? { action: 'judge', kind: 'change', judges: [judgeNamed('reviewer')] } : { action: 'judge', kind: 'change', judges: [], withheld: ['reviewer'] });
  const handed = handles({
    cards: [1, 2],
    facts: async () => (card) => (card.number === 1 ? DISPATCH : judging(card)),
    decide: holdingOnWorkspace,
    // Card 2's judge's directory is made only once card 1's closer is linked, and is not made.
    judgeDirectory: async () => {
      await waitFor(() => closersIn(handed.state).length === 1);
      throw new Error('no judge directory here');
    },
  });
  handed.config = { ...config, concurrency: 2 };

  const failure = await loop(handed).pull().then(() => assert.fail('the pull settled, though card 1 held'), (thrown) => thrown);

  assert.ok(heldCard(1)(failure));
  assert.deepEqual(failure.reached, [{ card: 2, judges: [] }]);
  const events = readEvents(handed.state);
  const closed = events.findIndex((event) => event.event === 'admission.close');
  const releasedTwo = events.findIndex((event) => event.event === 'slot.release' && event.card === 2);
  assert.ok(closed >= 0 && releasedTwo > closed, JSON.stringify(events.map(({ event, card }) => [event, card])));
});

// proves R-FAIL-8
test('after a hold, the next pull in the same loop().run() claims nothing, and the run answers the closer', async () => {
  const handed = handles({ cards: [1, 2], facts: async () => () => DISPATCH, decide: holdingOnWorkspace });
  handed.config = { ...config, concurrency: 1 };

  const failure = await loop(handed).run().then(() => assert.fail('the run settled, though card 1 held'), (thrown) => thrown);

  assert.ok(heldCard(1)(failure));
  assert.deepEqual(pulled(handed.state), [1]);
  assert.equal(readEvents(handed.state).filter((event) => event.event === 'trigger' && event.trigger === 'pull').length, 2, 'the run fired no second pull');
  assert.equal(failure.admission?.state, 'closed', `the run answered admission ${JSON.stringify(failure.admission)}`);
  assert.deepEqual(failure.admission.closers.map(({ name }) => name), closersIn(handed.state).map(({ name }) => name));
});

/**
 * Card 2's L2 at the pull: a card pulled for its judges, whose judge is withheld once L1 cannot make
 * its directory, so its work ends with no process.
 */
const withheldJudge = (card, outcomes, options = {}) => (options.directories === undefined ? { action: 'judge', kind: 'change', judges: [judgeNamed('reviewer')] } : { action: 'judge', kind: 'change', judges: [], withheld: ['reviewer'] });

/** Makes the admission directory in `state` one nobody may write in, so a close cannot save its closer. */
const unwritableAdmission = (state, t) => {
  mkdirSync(join(state, 'admission'), { recursive: true });
  chmodSync(join(state, 'admission'), 0o555);
  t.after(() => chmodSync(join(state, 'admission'), 0o755));
};

// proves R-FAIL-8
test('where a hold\'s close rejects and its closer is not saved, loop().run() claims no card after it, claims held finish, and the failure names the close\'s', async (t) => {
  let pulls = 0;
  const handed = handles({
    cards: [1, 2, 3],
    // Pulls after the third answer no card, so a run that never stops claiming still ends.
    facts: async () => { pulls += 1; return (card) => (pulls > 3 ? { action: 'none' } : card.number === 2 ? withheldJudge(card) : DISPATCH); },
    decide: holdingOnWorkspace,
    // Card 2's judge's directory is not made, and only once card 1's slot is released.
    judgeDirectory: async () => {
      await waitFor(() => readEvents(handed.state).some((event) => event.event === 'slot.release' && event.card === 1));
      throw new Error('no judge directory here');
    },
  });
  handed.config = { ...config, concurrency: 2 };
  unwritableAdmission(handed.state, t);

  const failure = await loop(handed).run().then(() => assert.fail('the run settled, though card 1 held'), (thrown) => thrown);

  assert.deepEqual(closersIn(handed.state), []);
  assert.ok(leaves(failure).some((each) => /^admission cannot write .*\.tmp-/.test(each.message)), failure.stack);
  assert.ok(leaves(failure).some((each) => each.decision === 'hold' && each.card === 1), failure.stack);
  // The first pull failed for card 1, so card 2 is carried in that pull's own failure.
  assert.deepEqual(failure.errors.flatMap((each) => each.reached ?? []), [{ card: 2, judges: [] }]);
  assert.deepEqual(pulled(handed.state), [1, 2]);
});

/** `sink`, refusing every `admission.close` event it is handed and passing on every other. */
const refusingCloses = (sink) => ({
  emitter: (context) => {
    const emitter = sink.emitter(context);
    return { emit: (event, fields) => { if (event === 'admission.close') throw new Error('the stream refused admission.close'); emitter.emit(event, fields); } };
  },
});

// proves R-FAIL-8
test('where a hold\'s closer is linked and the sink refuses its admission.close event, the closer stands, loop().run() claims no card after it, claims held finish, and the failure names the refused event', async () => {
  let pulls = 0;
  const handed = handles({
    cards: [1, 2, 3],
    // Pulls after the third answer no card, so a run that never stops claiming still ends.
    facts: async () => { pulls += 1; return (card) => (pulls > 3 ? { action: 'none' } : card.number === 2 ? withheldJudge(card) : DISPATCH); },
    decide: holdingOnWorkspace,
    judgeDirectory: async () => {
      await waitFor(() => readEvents(handed.state).some((event) => event.event === 'slot.release' && event.card === 1));
      throw new Error('no judge directory here');
    },
  });
  handed.sink = refusingCloses(handed.sink);
  handed.config = { ...config, concurrency: 2 };

  const failure = await loop(handed).run().then(() => assert.fail('the run settled, though card 1 held'), (thrown) => thrown);

  assert.equal(closersIn(handed.state).length, 1);
  assert.ok(leaves(failure).some((each) => /the sink refused its admission\.close event/.test(each.message)), failure.stack);
  assert.ok(leaves(failure).some((each) => each.decision === 'hold' && each.card === 1), failure.stack);
  assert.deepEqual(failure.errors.flatMap((each) => each.reached ?? []), [{ card: 2, judges: [] }]);
  assert.deepEqual(pulled(handed.state), [1, 2]);
});

// proves R-FAIL-8
test('two cards held in one invocation link two closers and record two admission.close events', async () => {
  const handed = handles({ cards: [1, 2], facts: async () => () => DISPATCH, decide: holdingOnWorkspace });
  handed.config = { ...config, concurrency: 2 };

  const failure = await loop(handed).pull().then(() => assert.fail('the pull settled, though both cards held'), (thrown) => thrown);

  assert.deepEqual(leaves(failure).filter((each) => each.decision === 'hold').map((each) => each.card).sort(), [1, 2]);
  assert.equal(closersIn(handed.state).length, 2);
  assert.deepEqual(closersIn(handed.state).map(({ reason }) => reason.match(/^card #(\d+)/)[1]).sort(), ['1', '2']);
  assert.equal(closes(handed.state).length, 2);
});

// proves R-FAIL-8
test('a hold while an owner closer stands links its own closer beside it', async () => {
  const handed = handles({
    facts: async () => () => DISPATCH,
    decide: holdingOnWorkspace,
    // The owner pauses once the card is claimed, before its first attempt's workspace is asked for.
    workspace: async () => {
      if (closersIn(handed.state).length === 0) seed(handed.state, 'owner-a1.json', closerText({ reason: 'paused by hand' }));
      throw new Error('no workspace here');
    },
  });

  await assert.rejects(loop(handed).pull(), heldCard(1));

  assert.deepEqual(closersIn(handed.state).map(({ kind }) => kind).sort(), ['hold', 'owner']);
  assert.equal(closersIn(handed.state).find(({ kind }) => kind === 'owner').name, 'owner-a1.json');
  assert.equal(closes(handed.state).length, 1);
});
