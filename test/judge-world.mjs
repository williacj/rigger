// ABOUTME: The harness L3's dispatch of a card's judges is proven through: a fake board and fake
// repository, L2's real facts call, next action and column changes, the stand-in agent every role
// runs as through L1, and one sink that can refuse the appends a test names, wired into a loop.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after } from 'node:test';

import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { COLUMNS, PASSING, boardOf, handleOn, makingJudgeDirectories, makingWorkspaces, waitFor } from './loop-world.mjs';
import { sweep } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The head SHA, merge base and diff of every pull request this harness opens or seeds, each written by hand. */
export const HEAD = '4'.repeat(40);
export const BASE = '5'.repeat(40);
export const DIFF = 'diff --git a/src/verb.mjs b/src/verb.mjs\n+export const verb = 1;\n';

/** The kind every card here is selected by: `engineer` makes it, and `reviewer` and `architect` judge it beside the owner. */
export const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect', 'owner'] } };

/** An issue numbered `number` in the column displayed as `column`, one kind selecting it and its acceptance passing, carrying `labels` beside it. */
export const cardIn = (number, column, labels = []) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: PASSING, labels: ['type:change', ...labels], column,
});

/** The one open pull request from card `number`'s line of work, numbered `1000 + number`, at `HEAD` over `BASE`. */
export const pullFor = (number) => ({ number: 1000 + number, head: `rigger-${number}`, sha: HEAD, diff: DIFF, mergeBase: BASE });

/**
 * A loop over a fake board holding `cards`, each a board item as `cardIn` makes one, under `kinds`
 * and `roles`, with `provisioning` the steps those kinds may list, at `concurrency`. The forge holds
 * `forge` as the fake repository's seed, and, once a maker exits 0, the pull request `pullFor` names
 * for its card, as a maker that opened one would leave it, and once a judge exits 0, its findings
 * comment on that pull request at `HEAD`, as a judge that wrote its findings would leave it. L2 is the real one throughout, with no
 * freshness injected, and every role runs as the stand-in agent `agent` through L1.
 *
 * `workspace` and `judgeDirectory` are the plain-directory stand-ins `makingWorkspaces` and
 * `makingJudgeDirectories` under the harness's scratch, unless a test gives its own. `refuse(append)`
 * says whether the sink refuses an append, `{ layer, card, dispatch, event, fields }`, and refuses
 * none by default; `attempts` records every append tried. `readsOf(card)` lists the reads the forge
 * served for card `card`'s line of work and pull request, in order, as `[operation, what]`. `log`
 * holds, in the one order they happened, each read the forge served, as `{ read: [operation, what] }`,
 * each append the sink accepted, as `{ append }` with the append, and each judge directory made, as
 * `{ made: { card, role } }`. `decisions` holds every answer L2 gave L3, as `{ card, answer }`.
 *
 * The test's teardown ends every stand-in run still alive and waits out every L1 dispatch still in
 * flight before any directory of the harness is removed.
 */
export function judgeWorld({
  cards, forge = {}, kinds = KINDS, roles = config.roles, provisioning = {}, concurrency = 1, workspace, judgeDirectory, refuse = () => false,
} = {}) {
  after(async () => {
    sweep(agent.dir);
    await waitFor(() => attempts.filter((each) => each.layer === 'L1' && each.event === 'dispatch.start').length
      <= attempts.filter((each) => each.layer === 'L1' && each.event === 'dispatch.end').length);
  });
  const log = [];
  const decisions = [];
  const scratch = temporaryDirectory('rigger-judges-scratch-');
  const directory = temporaryDirectory('rigger-judges-');
  const agent = standInAgent();
  const fake = boardOf(cards);
  const repository = createFakeRepository(forge);
  const served = [];
  const reads = Object.fromEntries(Object.entries(repository.operations).map(([operation, read]) => [operation, (what) => {
    served.push([operation, what]);
    log.push({ read: [operation, what] });
    return read(what);
  }]));
  const settings = { ...config, concurrency, roles, kinds };
  const attempts = [];
  const makers = new Set();
  const judging = new Map();
  const real = openSink({ directory, run: 'r-judges', now: Date.now });
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          const attempt = { layer: context.layer, card: context.card, dispatch: context.dispatch, event, fields };
          attempts.push(attempt);
          if (refuse(attempt)) throw new Error(`the test refuses ${context.layer}'s ${event}`);
          emitter.emit(event, fields);
          log.push({ append: attempt });
          // A maker's dispatch is the role dispatch that carries an attempt number, and a judge's the
          // one that carries neither an attempt nor a step.
          if (context.layer === 'L3' && event === 'dispatch' && fields.role !== undefined && fields.step === undefined) {
            if (fields.attempt === undefined) judging.set(context.dispatch, fields.role);
            else makers.add(context.dispatch);
          }
          if (context.layer === 'L1' && event === 'dispatch.end' && fields.exit === 0) {
            if (makers.has(context.dispatch)) repository.open(pullFor(context.card));
            if (judging.has(context.dispatch)) repository.comment(1000 + context.card, `Findings at ${HEAD} by ${judging.get(context.dispatch)}\n\nSound.`, new Date().toISOString());
          }
        },
      };
    },
  };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads });
  const decide = (card, outcomes, options = {}) => {
    const answer = nextAction(card, kinds, undefined, { columns: COLUMNS, roles, provisioning, outcomes, sink, ...options });
    decisions.push({ card: card.number, answer });
    return answer;
  };
  const facts = factsCall({ config: settings, reads, decide });
  const making = judgeDirectory ?? makingJudgeDirectories(join(scratch, 'workspaces'));
  const directories = async (card, role, head) => {
    const made = await making(card, role, head);
    log.push({ made: { card, role } });
    return made;
  };
  const handed = {
    config: settings, board: handleOn(fake), decide, facts, l2, sink, kill: async () => {}, workspace: workspace ?? makingWorkspaces(join(scratch, 'workspaces')), judgeDirectory: directories, state: directory, environment: { ...process.env, PATH: agent.first() },
  };
  const events = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  const pid = (card, role) => Number(readFileSync(join(agent.dir, `left-pid-${card}-${role}`), 'utf8'));
  return {
    fake,
    agent,
    log,
    decisions,
    repository,
    attempts,
    directory,
    scratch,
    directories,
    events,
    /** The pid of the process the run for `card` in `role` left, as its `leaveIn` act wrote it. */
    pid,
    readsOf: (card) => served.filter(([operation, what]) => what === card || what === 1000 + card || what === `rigger-${card}`),
    /** What the loop was built from, for a test building another from it. */
    handed,
    loop: loop(handed),
  };
}

/** The events of `events` for which `match` holds, by layer and name, among those `built` recorded. */
export const recorded = (built, layer, event, match = () => true) => built.events().filter((each) => each.layer === layer && each.event === event && match(each));

/** The L3 `dispatch` event of role `role` of card `card`, and L1's and L0's events under its dispatch id, in order. */
export function judgeDispatch(built, card, role) {
  const [l3] = recorded(built, 'L3', 'dispatch', (each) => each.card === card && each.role === role && each.step === undefined);
  return { l3, l1: l3 === undefined ? [] : built.events().filter((each) => each.layer !== 'L3' && each.dispatch === l3.dispatch) };
}

/** Whether a process `pid` is alive, by signal 0. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    if (failure.code === 'ESRCH') return false;
    throw failure;
  }
}
