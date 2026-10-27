// ABOUTME: A card, fake forge and real L2 transitions for escalation dispatch tests.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

export const DISPATCH = 'd-11111111-2222-3333-4444-555555555555';
export const HEAD = 'a'.repeat(40);
export const BODY = '## Acceptance\n\n- The widget prints "ready".\n- A second press stops it.\n';
export const REASON = 'Choose `blue` or "green"; preserve $HOME and \\.';
export const selected = { action: 'escalate', raiser: 'maker', destination: 'pm', category: 'ambiguous', item: 2, reason: REASON, dispatch: DISPATCH, line: 'rigger-12' };

/** A writer's unedited note in the documented fenced form, independent of the production parser. */
export const postedNote = (dispatch = DISPATCH, category = 'ambiguous') => ({
  body: ['```rigger-escalation', `category: ${category}`, 'item: 2', `reason: ${REASON}`, `dispatch: ${dispatch}`, '```'].join('\n'),
  permission: 'write', edited: false, author: { login: 'maker' },
});

/** The fake contracts are createFakeBoard and createFakeRepository; only their public operations reach L2. */
export async function escalationWorld({ pull = false, comments = [], labels = [], roles = {}, refuse } = {}) {
  const settings = { ...config, escalate: { ambiguous: 'pm' }, roles: { ...config.roles, ...roles }, kinds: {
    change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] },
  } };
  const fake = createFakeBoard({ columns: Object.values(settings.board.columns), items: [{
    type: 'issue', repository: settings.repo, number: 12, title: 'Choose a widget colour', body: BODY,
    labels: ['type:change', ...labels], column: settings.board.columns.coding,
  }] });
  const repository = createFakeRepository({ repo: settings.repo, issues: [{ number: 12, body: BODY, comments }],
    pullRequests: pull ? [{ number: 77, head: 'rigger-12', sha: HEAD, comments: [{ body: 'PRIVATE JUDGE VERDICT', permission: 'write' }] }] : [],
  });
  const directory = temporaryDirectory('rigger-escalation-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const writes = { ...repository, ...(refuse ? { postIssueComment: async () => { throw new Error(refuse); } } : {}) };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: repository.operations, repositoryWrites: writes });
  return { settings, card: (await fake.operations.readItems())[0], fake, repository, sink, directory, l2,
    events: () => existsSync(join(directory, 'events.jsonl')) ? readEvents(directory) : [], next: { ...selected, ...(pull ? { pull: 77, head: HEAD } : {}) } };
}
