// ABOUTME: Runs a clocked consumer's run or once verb over a held stand-in maker and fake forge.

import { dirname, join } from 'node:path';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { positive } from './loop-world.mjs';
import { withFirstOnPath } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';
import { START } from './clock-report-world.mjs';

/**
 * Answers `call()`, a verb's run, with `Date.now` reading `clock.now` until that answer settles, so
 * the verb's sink, which `recording.mjs` opens on `Date.now`, stamps each `ts` on the time base the
 * test injects into L3 ("The envelope"). Nothing else on the verb's path in this process reads
 * `Date.now`: its durations and deadlines read `performance.now` or timers. Where `clock` has no
 * `now`, `call()` is answered as it is.
 */
export function onClock(clock, call) {
  if (clock?.now === undefined) return call();
  const real = Date.now;
  Date.now = clock.now;
  let answer;
  try { answer = call(); }
  catch (failure) {
    Date.now = real;
    throw failure;
  }
  return Promise.resolve(answer).finally(() => { Date.now = real; });
}

/** A real verb invocation held mid-card, so the injected clock can advance before drain. */
export async function clockVerb(verb, clock) {
  const root = temporaryDirectory('rigger-clock-verb-');
  const settings = { ...consumerConfig(1), clock: { poll: 1000, triggers: { hourly: {
    interval: 1000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report',
  } } } };
  const consumer = withOrigin(repositoryAt(join(root, 'consumer'), {
    'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`,
  }), join(root, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-clock-gh-'), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [card(10, 'Ready')] },
  });
  const agent = standInAgent({ 10: { engineer: { hold: true } } });
  const running = onClock(clock, () => withFirstOnPath(dirname(fake.gh), () => withFirstOnPath(agent.dir, () => verb({ target: consumer, clock }))));
  await positive(() => agent.held(10));
  return { agent, consumer, running };
}
