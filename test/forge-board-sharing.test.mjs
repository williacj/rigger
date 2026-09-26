// ABOUTME: Tests the forge adapter's report of what else a board holds: the other repositories
// whose issues or pull requests are on it, and the items it cannot read, read through the fake gh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { installFakeGh } from './fake-gh.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';

/** The repository and board the fake `gh` answers for, and the config names. */
const WHERE = { repo: 'octo/widgets', project: 3 };

/** The board the adapter is handed, as a config names it. */
const BOARD = { ...WHERE, columns: { ready: 'Ready' } };

/** One of the repository's own issues on the board. */
const ours = (number) => ({ type: 'issue', repository: WHERE.repo, number, title: `Card ${number}`, column: 'Ready' });

/**
 * What the read side reports of a fake board holding `items`, read with the fake `gh` first on
 * `PATH`, as ruling 1 (U9) places it, so the read runner's own spawn of `gh` reaches it.
 */
async function reported(items) {
  const fake = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-sharing-gh-')), { ...WHERE, board: { columns: ['Ready'], items } });
  const held = process.env.PATH;
  process.env.PATH = `${dirname(fake.gh)}${delimiter}${held}`;
  try {
    return await readSide(BOARD).readOtherRepositories();
  } finally {
    process.env.PATH = held;
  }
}

test("given a board holding the repository's issue and another repository's issue, the read reports that other repository by its owner/name", async () => {
  const report = await reported([ours(1), { type: 'issue', repository: 'someone/else', number: 7, title: 'Theirs', column: 'Ready' }]);

  assert.deepEqual(report, { repositories: ['someone/else'], unreadable: 0 });
});

test("given a board holding the repository's issue and another repository's pull request, the read reports that other repository by its owner/name", async () => {
  const report = await reported([ours(1), { type: 'pullRequest', repository: 'someone/else', number: 8, title: 'Their PR', column: 'Ready' }]);

  assert.deepEqual(report, { repositories: ['someone/else'], unreadable: 0 });
});

test("given a board holding the repository's issues and pull request and a draft issue, the read reports no other repository", async () => {
  const report = await reported([
    ours(1),
    { type: 'pullRequest', repository: WHERE.repo, number: 2, title: 'Our PR', column: 'Ready' },
    { type: 'draftIssue', title: 'A thought', column: 'Ready' },
    ours(3),
  ]);

  assert.deepEqual(report, { repositories: [], unreadable: 0 });
});

test('given a board holding an issue of a repository whose owner/name differs from repo only in letter case, the read reports no other repository', async () => {
  const report = await reported([ours(1), { type: 'issue', repository: 'Octo/Widgets', number: 2, title: 'Ours, spelled otherwise', column: 'Ready' }]);

  assert.deepEqual(report, { repositories: [], unreadable: 0 });
});

test("given a board holding a redacted item beside the repository's issues, the read reports an item it cannot read", async () => {
  // The fake gh's answer for the redacted item is constructed from the schema, not captured:
  // `ProjectV2ItemType` holds `REDACTED`, and no redacted item has been seen on a real board.
  const report = await reported([ours(1), { type: 'redacted' }, ours(2)]);

  assert.deepEqual(report, { repositories: [], unreadable: 1 });
});

test('given a board whose only item from another repository lies beyond the first page the read requests, the read reports that repository', async () => {
  // The read asks for a hundred items a page, so the hundred and first is on the second.
  const items = [...Array.from({ length: 100 }, (_, i) => ours(i + 1)), { type: 'issue', repository: 'someone/else', number: 7, title: 'Theirs', column: 'Ready' }];

  const report = await reported(items);

  assert.deepEqual(report, { repositories: ['someone/else'], unreadable: 0 });
});
