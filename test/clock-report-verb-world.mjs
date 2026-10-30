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
  const running = withFirstOnPath(dirname(fake.gh), () => withFirstOnPath(agent.dir, () => verb({ target: consumer, clock })));
  await positive(() => agent.held(10));
  return { agent, consumer, running };
}
