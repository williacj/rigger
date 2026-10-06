// ABOUTME: Shows how L0 and L2 handle a maker that exits while a child still runs and has no PR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { repositoryAt } from './git-repository.mjs';
import { alive, fixture, leaveWorking, read, scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const { 20_000: SETTLES_WITHIN } = BOUNDS;

// proves R-WORK-18
test('a maker exiting 0 with a child running and no PR has the child killed, review withheld, and its card left in Coding', SETTLES_WITHIN, async (t) => {
  const root = scratch(t);
  const workspace = join(root, 'workspace');
  const base = join(root, 'scratch', 'rigger-671');
  const state = join(root, 'state');
  mkdirSync(workspace);
  mkdirSync(base, { recursive: true });
  repositoryAt(join(root, 'repository'));
  writeFileSync(join(root, 'hold'), '');
  const agent = fixture(root, 'maker', `${leaveWorking('scratch/rigger-671/engineer/work', 'child')}\nexit 0`);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const adapter = { invocation: async () => ({ command: agent, args: [], input: Buffer.alloc(0), unset: [], env: {} }) };
  const answer = { role: 'engineer', agent: '.claude/agents/engineer.md', provider: 'stand-in', tier: 'standard', timeout: 60_000, instruction: '', evidence: '' };
  const handed = await roleDispatch({ answer, cwd: workspace, directory: workspace, scratch: base, repository: join(root, 'repository'), reach: [], env: process.env, sink, id: 'd-maker', card: 671, adapters: { 'stand-in': adapter } });
  const result = await dispatch({ id: 'd-maker', card: 671, directory: state, sink, ...handed });
  const child = Number(read(root, 'child.pid'));

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(alive(child), false, `child ${child} is alive`);

  const board = createFakeBoard({ columns: Object.values(config.board.columns), items: [{ type: 'issue', repository: config.repo, number: 671, title: 'Card 671', column: config.board.columns.coding }] });
  const l2 = columnChanges({ config, sink, items: board.operations, reads: createFakeRepository().operations });
  const [card] = await board.operations.readItems();
  await assert.rejects(l2.settled(card, { status: 'fulfilled', value: result }), /card #671.*no open pull request/);

  const events = readEvents(state);
  assert.ok(events.some(({ layer, event, pid, card: number }) => layer === 'L0' && event === 'survivor.killed' && pid === child && number === 671), 'L0 did not record the child kill');
  assert.ok(events.some(({ layer, event, card: number, reason }) => layer === 'L2' && event === 'review.withheld' && number === 671 && /no open pull request/.test(reason)), 'L2 did not record the withheld review');
  assert.equal((await board.operations.readItems())[0].column, config.board.columns.coding);
  assert.deepEqual(board.writes(), []);
});
