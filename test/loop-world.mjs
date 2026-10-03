// ABOUTME: The harness L3's loop is proven through: the fake board with ready, redo and other
// cards, L0's handle on it, L2's column changes and next action, a held stand-in maker run through
// L1, and one sink, wired into a loop, with the waits and helpers that drive a run to its end and
// stop one mid-dispatch.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { worktreeTopic } from '../src/config/validate.mjs';
import { topicFor } from '../src/execution/workspace.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { mkdirSync, realpathSync } from 'node:fs';
import { installStandInAgent, standInAgent } from './stub-claude.mjs';
import { sweep } from './process-fixtures.mjs';
import { after } from 'node:test';

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
export const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The columns this repository's config declares, by key, as the read side's column read answers them. */
export const COLUMNS = config.board.columns;

/** A body whose acceptance passes L2's form check under the title `Add a verb`. */
export const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/**
 * An issue numbered `number` that L2 would dispatch, one kind selecting it and its acceptance
 * passing, in the column displayed as `column`, holding `fieldValues`.
 */
export const cardIn = (number, column, fieldValues) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: PASSING, labels: ['type:change'], column, ...(fieldValues && { fieldValues }),
});

/** A ready issue numbered `number` that L2 would dispatch, on a board whose columns are `columns` by key. */
export const readyCard = (number, columns = COLUMNS) => cardIn(number, columns.ready);

/** One turn of the event loop: every step already queued runs before it ends. */
const oneTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * How long a wait in a test that takes no bound waits before it rejects: half of 10,000 ms, the
 * smallest bound `test/settles-within.mjs` holds, so a wait's message prints before any test's
 * own timeout. A wait in a test that takes a bound is handed half that bound instead.
 */
export const WAIT_WITHIN = 5_000;

/**
 * Settles once `condition` holds, checked at once and then once per turn of the event loop, and
 * rejects naming the condition and its bound once `within` milliseconds have passed without it.
 * The clock bounds the wait and is never what it waits on, and it sleeps for no time.
 */
export async function waitFor(condition, within = WAIT_WITHIN) {
  const began = performance.now();
  while (!condition()) {
    if (performance.now() - began >= within) throw new Error(`the condition ${condition} did not hold within ${within} ms`);
    await oneTurn();
  }
}

/**
 * A positive wait: settles once `condition`, what the test next reads or acts on, holds, as
 * `waitFor` waits, within `within` milliseconds.
 */
export const positive = (condition, within) => waitFor(condition, within);

/**
 * A turn wait, for a test that counts the event loop's turns as its own measure while no maker
 * runs: `condition` counts them, and `waitFor`'s bound never passes within the turns it allows.
 */
export const turnWait = (condition) => waitFor(condition);

/**
 * A settling wait over `built`, a world: settles once `done`, the pull or run the test is waiting
 * on, has settled, or once `built` has settled as `settles` says, so a dispatch L3 makes, right or
 * wrong, has started and shows before the test reads. It looks first a turn after it is called, so
 * a pull or run fired just before it has recorded its trigger.
 */
export async function settling(built, done, within) {
  await oneTurn();
  await waitFor(() => done() || built.settles(), within);
}

/** A function answering whether `promise` has settled, fulfilled or rejected, for a wait to read. */
export function settledOf(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  return () => settled;
}

/**
 * The held makers of a world whose stand-in agent is `agent`, run as `role`, over `attempts`, the
 * world's record of every append L3, L2, L1 and L0 tried. Each maker is a stand-in process L1
 * started, which records a started marker and holds until the test releases it. `started` holds
 * each card's number at its maker's L3 `dispatch` event the sink accepted, so a card whose maker
 * never starts still counts there; the markers, not `started`, say that a maker process ran.
 * `most()` is the most makers L1 had running at once, from their `dispatch.start` and
 * `dispatch.end` attempts.
 */
export function heldStandIns(agent, role, attempts) {
  const started = [];
  // The pids of the stand-ins the test has released, whose markers may outlive the release a moment.
  const released = new Set();
  const pidOf = (number) => agent.holder(number, role);
  const heldNow = (number) => {
    const pid = pidOf(number);
    return pid !== undefined && !released.has(pid);
  };
  /** The numbers of the cards whose makers are held now, in the order their latest maker started. */
  const holding = () => [...new Set([...started].reverse())].reverse().filter(heldNow);
  const release = (number) => {
    const pid = pidOf(number);
    if (pid === undefined || released.has(pid)) throw new Error(`card ${number}'s maker stand-in is not held`);
    released.add(pid);
    agent.release(number, role);
  };
  return {
    started,
    heldNow,
    held: () => holding().length,
    holding,
    most: () => {
      const makers = new Set(attempts.filter((each) => each.layer === 'L3' && each.event === 'dispatch' && each.fields.role !== undefined).map((each) => each.dispatch));
      let running = 0;
      let most = 0;
      for (const each of attempts) {
        if (each.layer !== 'L1' || !makers.has(each.dispatch)) continue;
        if (each.event === 'dispatch.start') running += 1;
        if (each.event === 'dispatch.end') running -= 1;
        most = Math.max(most, running);
      }
      return most;
    },
    /** Releases every maker held now, each exiting as the world's `answer` says. */
    releaseAll: () => holding().forEach(release),
    /** Releases the held maker of card `number` alone, exiting as the world's `answer` says. */
    release,
  };
}

/**
 * A live view of the maker runs `agent` made whose working directory lies in `directory`, read
 * from its records each time it is read: an array whose entries are `{ start: { card }, at }`, the
 * card a run was for and the index in `events()` of L1's `dispatch.start` of that card's maker
 * dispatch the run was, matched in order. It holds none while `named` is false, for a world that
 * named no maker behaviour.
 */
export function makerRuns(agent, directory, events, named = true) {
  const read = () => {
    if (!named) return [];
    const root = realpathSync.native(directory);
    const recorded = events();
    const seen = {};
    return agent.runs().filter((run) => existsSync(run.cwd) && realpathSync.native(run.cwd).startsWith(`${root}/`)).map((run) => {
      seen[run.card] = (seen[run.card] ?? 0) + 1;
      const maker = recorded.filter((each) => each.layer === 'L3' && each.event === 'dispatch' && each.role !== undefined && each.card === run.card)[seen[run.card] - 1];
      return { start: { card: { number: run.card } }, at: recorded.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === maker?.dispatch) };
    });
  };
  return new Proxy([], {
    get: (target, key) => {
      const now = read();
      const value = Reflect.get(now, key);
      return typeof value === 'function' ? value.bind(now) : value;
    },
  });
}

/**
 * Every stand-in agent a world installed in a scratch directory its caller gave, so no test owns
 * it: `endStandIns` ends the runs of each.
 */
const unowned = [];

/**
 * Ends every run of every stand-in agent a world in this process installed in a scratch directory
 * its caller gave, for a caller with no test to end them, as `fullRunIn`'s child is.
 */
export function endStandIns() {
  for (const agent of unowned) sweep(agent.dir);
}

/**
 * The fake board whose columns are `columns` by key, holding `cards`: each a number, for a ready
 * card L2 would dispatch, or a board item as `cardIn` makes one.
 */
export const boardOf = (cards, columns = COLUMNS) => createFakeBoard({
  columns: Object.values(columns),
  items: cards.map((card) => (typeof card === 'number' ? readyCard(card, columns) : card)),
});

/**
 * L0's handle on `fake`, as L3 reads it: the column read reads the board's columns and answers
 * `columns` by key, as the read side's does for a config declaring them on a board holding them
 * all, and the priority read answers as the read side's
 * `readPriority` does for a config declaring `priority`, where none declared leaves every card's
 * `priority`, `declared` and `options` null. `beforeRead` runs as each priority read begins, and
 * `onRead` sees the items each one answers.
 */
export function handleOn(fake, { columns = COLUMNS, priority, beforeRead = () => {}, onRead = () => {} } = {}) {
  return {
    readColumns: async () => {
      await fake.operations.readColumns();
      return { ...columns };
    },
    readPriority: async () => {
      beforeRead();
      const answer = await fake.operations.readPriority(priority);
      onRead(answer.items);
      return answer;
    },
  };
}

/**
 * L0's handle on `fake`, as `handleOn` makes it with nothing given, but whose column read answers
 * one turn of the event loop later, as a board read slower than the fake's would.
 */
export function readingLater(fake) {
  const handle = handleOn(fake);
  return {
    ...handle,
    readColumns: async () => {
      await oneTurn();
      return handle.readColumns();
    },
  };
}

/**
 * L2's column changes over `fake`, and L3's loop over both under `concurrency` (none declared
 * where it is undefined), for a config whose board declares `columns` by key and whose L0 handle
 * reads priority under `priority`. L2's next action is the real one with freshness injected
 * through its own input: once a card's dispatch has returned in this world, `fresh` says whether
 * L2 has nothing more to do for it, standing in for the verdict marker M5 reads. `board` is L0's
 * handle, and `items` stands in for the board's writes. The sink writes to the state directory
 * `directory`, a new temporary one where none is given, under the run id `run`. A `fresh` given
 * as a function is L2's freshness input itself, answering for each Coding or Review card.
 * `kill` is the start's kill L3 is handed, standing in for L1's kill of recorded groups, and
 * kills nothing where none is given: L1's own dispatch contains each maker's group as it ends.
 *
 * The maker is always L1's real dispatch of the role L2 names, run as a stand-in agent, a
 * `claude` the world puts first on the `PATH` of the environment L3 hands every dispatch.
 * `dispatches` holds the makers, as `heldStandIns` says: each records a started marker and holds
 * until the test releases it. `answer(card)` says what a released maker does, handed the board
 * item as L3 read it: a result `{ exit }` exits with that code, and where it exits 0 the maker has opened a pull
 * request on the world's forge. An answer that is an Error is a maker that never starts: the world
 * answers that card a workspace path that does not exist, so L1 rejects with `NOT_STARTED`, and
 * the outcome L2 receives is still `rejected`.
 *
 * `scratch` is the directory the world makes its workspaces and its stand-in agent in, outside the
 * state directory: a new temporary one where none is given, whose stand-ins the test's teardown
 * ends whether it passed or failed. A caller giving one ends them itself, through `endStandIns`.
 *
 * `decide` hands L2's next action the card, the attempt's outcomes so far, `kinds`, the kinds it
 * selects from, `KINDS` where none are given, this repository's roles, and `provisioning`, the
 * steps those kinds may list, none where none are given, so a card of this world selects no step
 * unless a test lists one. `workspace` is L1's workspace handle L3 is handed, and where none is
 * given a stand-in makes and answers `workspaces/rigger-<card>` under `scratch`, and records
 * nothing. `state` is the state directory L3 hands L1's dispatch, which is `directory`, as in
 * production the stream and L1's record of process groups share one directory.
 *
 * `handed` records, at each maker's L3 `dispatch` event the sink accepted, `{ card }`, the board
 * item as L3 read it at the pull that claimed it, and `decisions` every next action L2 gave L3, as
 * `{ card, action, pull }`, where `pull` counts the pull triggers fired so far.
 *
 * `repository` is the fake repository the forge holds beside the board, seeded with `forge`, and
 * by default it holds nothing for any card. L2's facts call, which L3 awaits before it claims, is
 * the real one over its reads, and L2's column changes read its pull requests to settle a maker's
 * outcome. A card whose maker exited 0 holds an open pull request from its line of work from L1's
 * `dispatch.end` for it on, as a maker that opened one would leave it. Both answer from memory,
 * with no process or file read.
 *
 * `sequence` records, in the one order they happened, each board move once the board has made
 * it, as `{ move, column }` with the item's id and the column's display name, each maker's start,
 * as `{ start }` with the item's id at its L3 `dispatch` event, and each append the sink accepted,
 * as `{ append, layer, card }` with the event's name. `attempts` records every append any layer
 * tried, refused or not, as `{ layer, card, dispatch, event, fields, accepted }`, apart from
 * `sequence`, so a wait reads it even where the sink refuses every append.
 *
 * L2 and L3 share one sink, whose clock ticks once per event, so no two events share a time.
 * `layers` records the layer of every emitter L3 asks the sink for, L1's and L0's included, since
 * L3 hands its sink to every dispatch. `refuseAppends(reason, next)`
 * has the shared sink refuse the next `next` appends, or every append from then on where no
 * count is given, each with an error carrying `reason`, and `acceptAppends()` has it accept
 * again; the sink itself is the real one throughout, and what the two switch is whether an
 * append reaches it.
 */
export function world({
  cards = [1, 2, 3, 4], columns = COLUMNS, priority, fake = boardOf(cards, columns), concurrency, fresh = true, answer = () => ({ exit: 0, output: '' }), run = 'r-test',
  items = fake.operations, board = handleOn(fake, { columns, priority }), directory = temporaryDirectory('rigger-loop-'),
  kill = async () => {}, kinds = KINDS, provisioning = {}, forge = {}, scratch,
  workspace,
} = {}) {
  // Whether the test that made this world has ended. From then on the sink refuses every append
  // and no workspace is answered, so a run the test left going starts nothing and records
  // nothing, and teardown ends its stand-ins and waits out every L1 dispatch still in flight
  // before any directory of the world is removed. A world in a caller's scratch has no test.
  let stopped = false;
  if (scratch === undefined) {
    after(async () => {
      stopped = true;
      sweep(agent.dir);
      await waitFor(() => inFlight() === 0);
    });
  }
  const under = scratch ?? temporaryDirectory('rigger-loop-scratch-');
  const own = scratch === undefined ? undefined : join(scratch, `stand-in-${unowned.length}`);
  if (own !== undefined) mkdirSync(own, { recursive: true });
  const agent = own === undefined ? standInAgent() : installStandInAgent(own);
  if (own !== undefined) unowned.push(agent);
  const makers = [...new Set(Object.values(kinds).map((kind) => kind.maker))];
  if (makers.length !== 1) throw new Error(`a world's kinds name one maker role, and these name ${makers.join(', ')}`);
  const [role] = makers;
  const making = workspace ?? (async (card) => {
    const path = join(under, 'workspaces', `rigger-${card}`);
    mkdirSync(path, { recursive: true });
    return { path };
  });
  const attempts = [];
  const settings = { ...config, board: { ...config.board, columns } };
  delete settings.concurrency;
  if (concurrency !== undefined) settings.concurrency = concurrency;
  const sequence = [];
  // No stream is a stream holding no event: the sink writes the file at its first accepted append.
  const recorded = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  const moving = {
    ...items,
    moveItem: async (id, column) => {
      await items.moveItem(id, column);
      sequence.push({ move: id, column });
    },
  };
  let tick = 0;
  const real = openSink({ directory, run, now: () => (tick += 1) });
  /** Why the sink refuses an append now, or null while it accepts them, and how many more it refuses. */
  let refusing = null;
  let refusals = Infinity;
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          const attempt = { layer: context.layer, card: context.card, dispatch: context.dispatch, event, fields, accepted: false };
          attempts.push(attempt);
          observe(attempt);
          if (stopped) throw new Error('the test that made this world has ended, so it records nothing more');
          if (refusing !== null && refusals > 0) {
            refusals -= 1;
            throw new Error(refusing);
          }
          emitter.emit(event, fields);
          attempt.accepted = true;
          sequence.push({ append: event, layer: context.layer, card: context.card });
          accepted(attempt);
        },
      };
    },
  };
  const layers = [];
  const l3Sink = {
    emitter: (context) => {
      layers.push(context.layer);
      return sink.emitter(context);
    },
  };
  const repository = createFakeRepository(forge);
  const l2 = columnChanges({ config: settings, sink, items: moving, pullRequests: repository.operations.readPullRequests });
  const returned = new Set();
  const freshness = typeof fresh === 'function' ? fresh : (held) => fresh && returned.has(held.number);
  const decisions = [];
  const pulls = () => recorded().filter((event) => event.run === run && event.trigger === 'pull').length;
  const decide = (card, outcomes) => {
    const action = nextAction(card, kinds, undefined, { columns, fresh: freshness, roles: settings.roles, provisioning, outcomes, sink });
    decisions.push({ card: card.number, action, pull: pulls() });
    return action;
  };
  const facts = factsCall({ config: settings, reads: repository.operations, decide });
  /** Opens a pull request from card `number`'s line of work, where none is open from it yet. */
  const openFrom = (number) => {
    const head = topicFor(worktreeTopic(settings), number);
    const { pullRequests } = repository.held();
    if (pullRequests.some((pull) => pull.head === head && !pull.merged)) return;
    repository.open({ number: 1000 + pullRequests.length, head, sha: String(number).padStart(40, '0') });
  };
  const dispatches = heldStandIns(agent, role, attempts);
  const handed = [];
  // The dispatch ids of the makers L3 started, by card.
  const makerIds = new Map();
  // Each card as L3 last read it from the board, which is what L3 claimed it as.
  const read = new Map();
  // Each attempt's answer is read as L3 asks for its workspace, so the stand-in holds and then exits
  // as `answer` says, or, for an Error, the maker is handed a workspace that does not exist.
  workspace = async (number) => {
    if (stopped) throw new Error(`the test that made this world has ended, so card ${number} gets no workspace`);
    const given = answer(read.get(number) ?? { number });
    if (given instanceof Error) {
      // Answered as the handle answers, so a maker that never starts reaches L3's dispatch event
      // in the same turn one that starts would.
      return (async () => ({ path: join(under, 'never-made', `rigger-${number}`) }))();
    }
    agent.plan(number, role, { hold: true, exit: given.exit });
    return making(number);
  };
  /** What a maker's L3 `dispatch` attempt and L1 `dispatch.end` attempt record, whether or not the sink accepts them. */
  const observe = ({ layer, card, dispatch, event, fields }) => {
    if (layer === 'L3' && event === 'dispatch' && fields.role !== undefined) makerIds.set(dispatch, card);
    if (layer === 'L1' && event === 'dispatch.end' && makerIds.has(dispatch) && fields.exit === 0) openFrom(card);
  };
  // A card's maker has returned in this world once L3 hands L2 its outcome, however it ended.
  const settle = l2.settled;
  l2.settled = (card, outcome) => {
    returned.add(card.number);
    return settle(card, outcome);
  };
  /** What a maker's L3 `dispatch` event records once the sink has accepted it. */
  const accepted = ({ layer, card, dispatch, event }) => {
    if (layer !== 'L3' || event !== 'dispatch' || !makerIds.has(dispatch)) return;
    const item = read.get(card);
    dispatches.started.push(card);
    handed.push({ card: item });
    sequence.push({ start: item?.id });
  };
  // Each pull trigger L3 fires reads the board, then awaits L2's facts call and claims in the same
  // step as the call answers. The facts call here reads from memory alone, so a trigger whose
  // priority read has settled, or whose read failed, has made its claims by the next turn.
  let readsEnded = 0;
  const ending = (read) => async (...args) => {
    try {
      return await read(...args);
    } catch (failure) {
      readsEnded += 1;
      throw failure;
    }
  };
  const watched = board;
  board = {
    readColumns: ending((...args) => watched.readColumns(...args)),
    readPriority: async (...args) => {
      try {
        const answer = await watched.readPriority(...args);
        for (const item of answer.items) read.set(item.number, structuredClone(item));
        return answer;
      } finally {
        readsEnded += 1;
      }
    },
  };
  /** How many dispatches L1 has recorded the start of and not yet tried to record the end of. */
  const inFlight = () => attempts.filter((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.accepted).length
    - attempts.filter((each) => each.layer === 'L1' && each.event === 'dispatch.end').length;
  const triggered = () => attempts.filter((each) => each.layer === 'L3' && each.event === 'trigger' && each.fields.trigger === 'pull').length;
  /** The cards whose claims L3 holds: an accepted `pull` with no `slot.release` tried for it since. */
  const claimed = () => {
    const open = new Set();
    for (const each of attempts) {
      if (each.layer !== 'L3') continue;
      if (each.event === 'pull' && each.accepted) open.add(each.card);
      if (each.event === 'slot.release') open.delete(each.card);
    }
    return [...open];
  };
  return {
    fake, l2, dispatches, sequence, layers, handed, decisions, directory,
    repository,
    attempts,
    agent,
    sink: l3Sink,
    /**
     * Whether the world has settled: every claim L3 holds is held at a stand-in that has started
     * and is unreleased, and no pull trigger is between its trigger event and its claims.
     */
    settles: () => triggered() === readsEnded && claimed().every(dispatches.heldNow),
    /** Has the shared sink refuse the next `next` appends, or every one from now on, each with an error carrying `reason`. */
    refuseAppends: (reason = 'the event sink refuses every append', next = Infinity) => {
      refusing = reason;
      refusals = next;
    },
    /** Has the shared sink accept appends again. */
    acceptAppends: () => { refusing = null; },
    /** Every event the run has recorded so far, in the order recorded. */
    events: recorded,
    /** The events L3 recorded so far, in order. */
    l3Events: () => recorded().filter((event) => event.layer === 'L3'),
    loop: loop({ config: settings, board, decide, facts, l2, sink: l3Sink, kill, workspace, state: directory, environment: { ...process.env, PATH: agent.first() } }),
  };
}

/**
 * L2's facts call over the board `config` names, handing `decide` each card with what the forge
 * holds of it: through a fake repository holding nothing for any card, so the forge holds nothing
 * for any card. It answers from memory, with no process or file read.
 */
export const factsOverNothing = (config, decide) => factsCall({ config, reads: createFakeRepository().operations, decide });

/** The SHA the pull request `oneOpenFromEveryLine` answers is at. */
const OPEN_HEAD = '0'.repeat(40);

/**
 * A pull-request read, standing in for the read side's, that answers one open pull request, #1,
 * from every line of work it is asked about, from memory.
 */
export const oneOpenFromEveryLine = async () => ({ open: [{ number: 1, head: OPEN_HEAD, base: 'main' }], merged: [] });

/**
 * A workspace stand-in that makes the directory it answers, `rigger-<card>` under `under`, and
 * answers it as L1's workspace handle does, recording in its `made` each card and path it made.
 */
export function makingWorkspaces(under) {
  const made = [];
  const handle = async (card) => {
    const path = join(under, `rigger-${card}`);
    await mkdir(path, { recursive: true });
    made.push({ card, path });
    return { path };
  };
  return Object.assign(handle, { made });
}

/** Each card on `fake` by number, with the display name of the column it is in now. */
export const columnsOf = async (fake) => Object.fromEntries((await fake.operations.readItems()).map((item) => [item.number, item.column]));

/**
 * The most rounds a run is driven before the test gives up on it. A judgment, whose premise is a
 * measurement with stand-in maker processes: across three full `npm test` runs with Node 26.5.0 on
 * macOS 27.0 on this 12-CPU host on 2026-10-03, at one-minute loads of 20.85, 19.38 and 20.00 as
 * each began, every one of the 30 drives a run made ended within 6 rounds. A round waits until the
 * world has settled, so a run still going after this many never ends.
 */
export const DRIVEN_ROUNDS = 100;

/**
 * Starts one run of `built`'s loop, and releases every held maker each time the loop has made
 * every start it can, as a settling wait says, until the run ends. Answers the run's own settling,
 * so a run that fails rejects here with its failure unchanged. A run still going after
 * `DRIVEN_ROUNDS` rounds rejects here, naming the dispatches it started.
 */
export async function drive(built) {
  let ended = false;
  const run = built.loop.run().finally(() => {
    ended = true;
  });
  run.catch(() => {});
  for (let round = 0; !ended; round += 1) {
    if (round === DRIVEN_ROUNDS) throw new Error(`the run had not ended after ${DRIVEN_ROUNDS} rounds, having started dispatches ${built.dispatches.started}`);
    await settling(built, () => ended);
    built.dispatches.releaseAll();
  }
  return run;
}

/**
 * A first engine's run over a new fake board holding ready cards 1, 2 and 3, at concurrency 2,
 * stopped while the makers of cards 1 and 2 are unfinished: they are held and never released,
 * so nothing more of that engine reaches the board, which is left with 1 and 2 in the coding
 * column and 3 in the ready column. Its sink writes to the state directory `directory`, and its
 * world makes its stand-ins in `scratch`, as `world` says. The test's teardown ends them, or, where
 * `scratch` is given, `endStandIns`. Answers the board, the only thing a second engine is to share
 * with the first.
 */
export async function stoppedRun({ directory, scratch } = {}) {
  const fake = boardOf([1, 2, 3]);
  const first = world({ fake, concurrency: 2, directory, run: 'r-first', scratch });
  first.loop.run().catch(() => {});
  // Positive: until cards 1 and 2 are held.
  await positive(() => first.dispatches.held() === 2);
  if (first.dispatches.holding().join() !== '1,2') throw new Error(`the first run was not stopped mid-dispatch of cards 1 and 2: ${first.dispatches.holding()}`);
  return fake;
}
