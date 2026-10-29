// ABOUTME: Tests the fake forge's multi-label opening in process without starting a fake gh process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { commandOf, main } from './fake-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// The documented create-issue API carries one labels array; gh sends repeated labels[] fields.
test('the fake forge models one opening command and stores and answers all requested labels', async () => {
  const single = ['api', 'repos/acme/widgets/issues', '-X', 'POST', '-f', 'title=T', '-f', 'body=B', '-f', 'labels[]=one'];
  for (const labels of [['one'], ['one', 'two'], ['one', 'two', 'three']]) {
    const args = [...single.slice(0, 8), ...labels.flatMap((name) => ['-f', `labels[]=${name}`])];
    assert.equal(commandOf(args), commandOf(single));
    const statePath = join(temporaryDirectory('rigger-clock-forge-'), 'board.json');
    // The state contract is the one installFakeGh writes, read directly by main(statePath).
    writeFileSync(statePath, JSON.stringify({ repo: 'acme/widgets', project: 3, model: {}, writes: [], sent: [] }));
    const argv = process.argv;
    const write = process.stdout.write;
    let output = '';
    try {
      process.argv = ['node', 'gh', ...args];
      process.stdout.write = (chunk) => { output += String(chunk); return true; };
      await main(statePath);
    } finally {
      process.argv = argv;
      process.stdout.write = write;
    }
    assert.deepEqual(JSON.parse(output), { number: 1, title: 'T', body: 'B', labels: labels.map((name) => ({ name })), node_id: 'I_issue1' });
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).repository.issues,
      [{ number: 1, title: 'T', body: 'B', labels }]);
  }
  const foreign = [...single, '-f', 'milestone=1'];
  assert.equal(commandOf(foreign), 'gh api repos/_/_/issues -X POST -f title=_ -f body=_ -f labels[]=_ -f milestone=1');
});
