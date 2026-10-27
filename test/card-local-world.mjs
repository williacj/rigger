// ABOUTME: Gives a judge world the fake repository's owner writes and keeps its board labels current.

import { columnChanges } from '../src/workflow/transitions.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { createFakeRepository } from './fake-repository.mjs';

/**
 * Wires the repository-write contract implemented by `createFakeRepository` into `built`'s real
 * L2 transitions. `refuse` names a write to reject before it acts; `before` observes each write.
 * The fake board reads labels from its own issue view, as the executable fake does.
 */
export function ownerWrites(built, { refuse, before = () => {} } = {}) {
  const repository = createFakeRepository({ issues: built.fake.issues().map((issue) => ({ ...issue, comments: [] })), repo: built.handed.config.repo });
  const invoke = (name, operation) => async (...args) => {
    before(name, ...args);
    if (refuse === name && (name !== 'move' || args[1] === built.handed.config.board.columns.owner)) throw new Error(`the forge refused ${name}`);
    return operation(...args);
  };
  const writes = {
    postIssueComment: invoke('comment', repository.postIssueComment),
    addIssueLabel: invoke('label', async (number, label) => {
      const answer = await repository.addIssueLabel(number, label);
      built.fake.setIssueLabels(built.handed.config.repo, number, answer.map(({ name }) => name));
      return answer;
    }),
  };
  const items = { ...built.fake.operations, moveItem: invoke('move', built.fake.operations.moveItem) };
  built.handed.l2 = columnChanges({ config: built.handed.config, sink: built.handed.sink, items, reads: built.repository.operations, repositoryWrites: writes });
  built.loop = loop(built.handed);
  built.owner = repository;
  return built;
}
