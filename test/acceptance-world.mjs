// ABOUTME: Drives acceptance refusals through the claiming verbs over the fake forge and a real
// consumer worktree, with a manual clock and a valid sibling whose stand-in maker exits 7.

import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEvents } from '../src/observation/sink.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin, worktreeList } from './git-repository.mjs';
import { withFirstOnPath } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';
import { onClock } from './clock-report-verb-world.mjs';

// C4's three items independently compare to "paint the widget" under R-CARD-32 and R-CARD-33:
// lowercasing, deleting punctuation, and collapsing whitespace leave the title's same words.
const SHAPES = {
  C1: { body: 'Context.\n\n```markdown\n## Acceptance\n- The widget turns blue.\n```\n', reason: 'missing acceptance' },
  C2: { body: '## Acceptance\n\n- [ ] The widget turns blue.\n- [x] The widget turns blue.\n- [X] The widget turns blue.\n', reason: 'missing acceptance' },
  C3: { body: '## Acceptance\n\n```markdown\n- The widget turns blue.\n```\n', reason: 'missing acceptance' },
  C4: { body: '## Acceptance\n\n- PAINT THE WIDGET!\n* Paint, the widget.\n+ paint   the widget\n', reason: 'restated title' },
};

export const refusalReason = (row) => SHAPES[row].reason;
export const acceptanceBoard = (row) => [
  card(11, 'Ready', { title: 'Paint the widget', body: SHAPES[row].body }),
  card(12, 'Ready'),
];

/** Real L0/L1 work and stand-in execution distinguish refusal from a verb that stalls. */
export async function acceptanceFirst(t, verb, row, manual) {
  const root = realpathSync.native(temporaryDirectory('rigger-acceptance-', { context: t }));
  const settings = consumerConfig(1);
  settings.worktrees = { ...settings.worktrees, root: join(root, 'worktrees') };
  const consumer = repositoryAt(join(root, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  withOrigin(consumer, join(root, 'origin.git'));
  const fake = installFakeGh(temporaryDirectory('rigger-acceptance-gh-', { context: t }), {
    repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: acceptanceBoard(row) },
  });
  // Acts are keyed by card; the sibling's engineer exits 7 without opening a pull request.
  const agent = standInAgent({ 12: { engineer: { exit: 7 } } });
  const refusedPath = join(settings.worktrees.root, 'rigger-11');
  assert.equal(existsSync(refusedPath), false, 'the refused workspace is absent before the verb');
  assert.deepEqual((await (await fake.model()).operations.readItems()).map(({ number, column }) => [number, column]), [[11, 'Ready'], [12, 'Ready']]);
  const clock = { ...manual, pause: async () => {} };
  const former = realHost.clock;
  const written = [];
  let ran;
  realHost.clock = clock;
  try {
    ran = await onClock(clock, () => withFirstOnPath(dirname(fake.gh), () => withFirstOnPath(agent.dir, () => verb({
      target: consumer, clock, host: { ...realHost, clock }, write: (text) => written.push(text),
    }))));
  } finally { realHost.clock = former; }
  const events = readEvents(join(consumer, '.rigger'));
  const model = await fake.model();
  const items = await model.operations.readItems();
  const item = items.find(({ number }) => number === 11);
  const registered = worktreeList(consumer, true).split('\0').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9));
  const pulls = (number) => events.filter((event) => event.layer === 'L3' && event.event === 'pull' && event.card === number);
  const starts = (number) => events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start' && event.card === number);

  // Each observable has its own verdict, so one failed assertion cannot hide another mutation's effect.
  await t.test('no claim or move out of Ready', () => {
    assert.deepEqual({ pulls: pulls(11).map(({ card }) => card), column: item.column,
      moves: model.writes().filter(({ operation, args }) => operation === 'moveItem' && args[0] === item.id && args[1] !== 'Ready') },
    { pulls: [], column: 'Ready', moves: [] });
  });
  await t.test('no worktree made or registered', () => {
    assert.deepEqual({ exists: existsSync(refusedPath), registered: registered.includes(refusedPath),
      made: events.filter((event) => event.layer === 'L1' && event.event === 'workspace.made' && event.card === 11).map(({ card }) => card) },
    { exists: false, registered: false, made: [] });
  });
  await t.test('no dispatch start', () => { assert.deepEqual(starts(11).map(({ card }) => card), []); });
  await t.test('valid sibling is claimed and dispatched on the same board', () => {
    assert.deepEqual({ code: ran.code, claimed: pulls(12).length > 0, dispatched: starts(12).length > 0,
      executed: agent.runs().some(({ card, role }) => card === 12 && role === 'engineer'),
      makerExit: events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.end' && event.card === 12).map(({ exit }) => exit),
      registered: registered.includes(join(settings.worktrees.root, 'rigger-12')) },
    { code: 1, claimed: true, dispatched: true, executed: true, makerExit: [7], registered: true }, [ran.text, ...written].join('\n'));
  });
}
