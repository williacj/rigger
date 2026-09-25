// ABOUTME: The forge adapter's read side, as far as its writes need it: the IDs of the board, its
// columns field and the repository that a write names, each read through the read runner.

import { literal } from './graphql.mjs';
import { COLUMNS, firstLine, graphqlRequest, readRunner } from './runners.mjs';

/**
 * The data `gh` answered to a request made for `operation` on `board`. Where `gh` did not answer
 * 0, it throws an error naming the operation, the board number and the first line `gh` said.
 */
export function answerOf(operation, board, said) {
  if (said.status !== 0) throw new Error(`${operation} on board ${board.project} failed: ${firstLine(said)}`);
  return JSON.parse(said.stdout).data;
}

/**
 * The board numbered `board.project` among the boards of `board.repo`'s owner: its ID, and the ID
 * and options of its field holding the columns, each option as `{ id, name }` in board order.
 *
 * The config names a repository and a board number, and no board owner, so the board is read as
 * the repository owner's.
 */
export function boardOf(operation, board, send) {
  if (!Number.isInteger(board.project)) {
    throw new Error(`${operation} failed: the board number is ${board.project}, which is not a board number`);
  }
  const [owner] = board.repo.split('/');
  const query = `query { repositoryOwner(login: ${literal(owner)}) { ... on ProjectV2Owner { projectV2(number: ${board.project}) { id field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id options { id name } } } } } } }`;
  const project = answerOf(operation, board, readRunner(graphqlRequest(query), { send }))?.repositoryOwner?.projectV2;
  if (!project?.field?.options) {
    throw new Error(`${operation} on board ${board.project} failed: the board has no single-select field named ${COLUMNS}`);
  }
  return { id: project.id, columns: project.field };
}

/** The ID of the repository `board.repo` names as `owner/name`. */
export function repositoryOf(operation, board, send) {
  const [owner, name] = board.repo.split('/');
  const query = `query { repository(owner: ${literal(owner)}, name: ${literal(name)}) { id } }`;
  return answerOf(operation, board, readRunner(graphqlRequest(query), { send })).repository.id;
}
