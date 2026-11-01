// ABOUTME: Runs a clocked consumer's `run` verb, kept up by a clock trigger, over a fake forge and
// planned stand-in agents, with a writer the test reads and a stop the test fires.

import { dirname, join } from 'node:path';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { withFirstOnPath } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, consumerConfig } from './verb-consumer.mjs';
import { START } from './clock-report-world.mjs';
import { run as runVerb } from '../src/cli/run.mjs';

/** A report trigger whose first occurrence is an hour after `START`. */
export const HOURLY_REPORT = { hourly: { interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' } };

/**
 * Starts the `run` verb in a consumer declaring `triggers` and a poll of 1000 ms, over a board
 * holding `items` and stand-in agents planned by `plan`, on `clock`. Answers the consumer, the
 * agent, `written`, each text the verb wrote through its writer, `running`, the verb's answer,
 * `fake`, the forge, and `stop()`, which fires the verb's stop and answers its answer.
 */
export function keptUpRunVerb({ items = [], plan = {}, clock, triggers = HOURLY_REPORT, concurrency = 1 }) {
  const root = temporaryDirectory('rigger-kept-up-verb-');
  const settings = { ...consumerConfig(concurrency), clock: { poll: 1000, triggers } };
  const consumer = withOrigin(repositoryAt(join(root, 'consumer'), {
    'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`,
  }), join(root, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-kept-up-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items },
  });
  const agent = standInAgent(plan);
  const written = [];
  const controller = new AbortController();
  const running = withFirstOnPath(dirname(fake.gh), () => withFirstOnPath(agent.dir, () => runVerb({
    target: consumer, clock, write: (text) => written.push(text), stop: controller.signal,
  })));
  running.catch(() => {});
  return {
    consumer, agent, written, running, fake,
    stop: () => {
      controller.abort();
      return running;
    },
  };
}
