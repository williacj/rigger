// ABOUTME: Builds an L3 loop whose sink and clock share one injected time base, over a state
// directory whose event record a test writes as a stream file, for clock-trigger arming tests.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { KINDS, boardOf, factsOverNothing, handleOn, makingJudgeDirectories } from './loop-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The run id each arming world's loop records under. */
export const RUN = 'r-arming';

/**
 * One line of a recorded stream, as the sink writes it: `ts` at epoch milliseconds `at`, under an
 * earlier run, at L3, carrying `event` and its `fields`.
 */
export const line = (at, event, fields = {}) => `${JSON.stringify({ ts: new Date(at).toISOString(), run: 'r-earlier', layer: 'L3', event, ...fields })}\n`;

/**
 * A loop over the board `cards` makes, with `triggers` declared under `clock`, whose state
 * directory holds `record` as its stream where one is given, and holds no stream where it is not.
 * The sink and L3 read `clock.now`, so every `ts` and every occurrence share one time base. Where
 * `named` is false the sink holds its events until `name()`, so the start finds no stream.
 *
 * `refuse(when, count)` has the sink refuse the next `count` appends, or every one from then on,
 * for which `when(event, fields)` holds; `accept()` ends that. A workspace asked for is refused
 * once `releaseWorkspaces()` is called, so a pulled card starts no process. `emitted` holds each event the sink accepted, named or not, and
 * `events()` reads the stream back.
 */
export function armingWorld(clock, { triggers, cards = [], record, named = true } = {}) {
  const directory = temporaryDirectory('rigger-arming-');
  if (record !== undefined) {
    mkdirSync(dirname(streamPath(directory)), { recursive: true });
    writeFileSync(streamPath(directory), record);
  }
  const settings = { ...config, kinds: KINDS, concurrency: 1, clock: { poll: 1000, triggers } };
  const real = openSink({ ...(named && { directory }), run: RUN, now: clock.now });
  let refusing;
  const emitted = [];
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          if (refusing !== undefined && refusing.count > 0 && refusing.when(event, fields ?? {})) {
            refusing.count -= 1;
            throw new Error(`the sink refuses ${event}`);
          }
          emitter.emit(event, fields);
          emitted.push({ event, card: context.card, ...fields });
        },
      };
    },
  };
  const fake = boardOf(cards);
  const decide = (card, outcomes, options = {}) => nextAction(card, KINDS, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: createFakeRepository().operations });
  const scratch = temporaryDirectory('rigger-arming-scratch-');
  // Each workspace asked for is held until `releaseWorkspaces()`, then refused, so a pulled card
  // starts no process and its claim ends once the test lets it.
  let releaseWorkspaces;
  const workspacesReleased = new Promise((resolve) => { releaseWorkspaces = resolve; });
  const workspace = async (card) => {
    await workspacesReleased;
    throw new Error(`card ${card} gets no workspace in an arming world`);
  };
  return {
    directory,
    emitted,
    loop: loop({ config: settings, board: handleOn(fake), decide, facts: factsOverNothing(settings, decide), l2, sink, kill: async () => {}, workspace, judgeDirectory: makingJudgeDirectories(join(scratch, 'judges')), removeDirectories: async () => {}, state: directory, environment: process.env, run: RUN, clock }),
    releaseWorkspaces,
    refuse: (when, count = Infinity) => { refusing = { when, count }; },
    accept: () => { refusing = undefined; },
    name: () => real.name(directory),
    events: () => readEvents(directory),
  };
}
