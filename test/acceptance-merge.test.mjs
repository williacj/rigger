// ABOUTME: Proves once cannot merge acceptance with an unmet or unruled item.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manualClock } from './clock-report-world.mjs';
import { optionalWorld } from './optional-config-world.mjs';
import { minimalConfig } from './optional-config.mjs';
import { card } from './verb-consumer.mjs';
import { gitIn, worktreeAt } from './git-repository.mjs';
import { seedRepositoryAt } from './fake-gh.mjs';
import { standInFindings, standInRecord } from './stub-claude.mjs';

/** The executable stand-in's documented findings contract, with one controlled faulty ruling. */
async function judged(t, fault) {
  const settings = minimalConfig();
  settings.kinds.change.judges = ['reviewer'];
  const posted = [];
  const world = optionalWorld(t, 'minimal', {
    settings, clock: manualClock(),
    items: [card(10, 'Review', { body: '## Acceptance\n- Paint the widget blue.\n- Print its receipt.\n' })],
    plan: { 10: { engineer: { push: true }, reviewer: {} } },
    beforeAgent: async (request, store, now) => {
      if (standInRecord(request).role !== 'reviewer') return;
      assert.ok(request.input.includes('```rigger-marker\n'), 'the agent judge must receive a marker instruction');
      const args = standInFindings({ findings: true }, { card: 10, role: 'reviewer', input: request.input });
      const at = args.indexOf('--body') + 1;
      const anchor = 'item 2: met\n';
      assert.equal(args[at].split(anchor).length - 1, 1, 'the judge must receive two acceptance items');
      if (fault === 'unmet') args[at] = args[at].replace(anchor, 'item 2: unmet\n');
      if (fault === 'unruled') args[at] = args[at].replace(anchor, '');
      posted.push(args[at]);
      const answer = await store.answer(args, { now, cwd: request.cwd });
      assert.equal(answer.status, 0, answer.stderr);
      // Comment storage retains the repository model, so restore this forge response knob.
      seedRepositoryAt(world.statePath, { ...world.state().repository, mergeable: { 11: 'MERGEABLE' } });
    },
  });
  const base = gitIn(world.consumer, 'rev-parse', 'HEAD').trim();
  mkdirSync(world.workspaceRoot, { recursive: true });
  const workspace = worktreeAt(world.consumer, join(world.workspaceRoot, 'rigger-10'), 'rigger-10');
  writeFileSync(join(workspace, 'widget.txt'), 'blue\nreceipt\n');
  gitIn(workspace, 'add', 'widget.txt');
  gitIn(workspace, 'commit', '-q', '-m', 'Deliver the fixture widget');
  gitIn(workspace, 'push', '-q', 'origin', 'rigger-10');
  const head = gitIn(workspace, 'rev-parse', 'HEAD').trim();
  const diff = gitIn(world.consumer, 'diff', base, head);
  assert.notEqual(head, base, 'the reviewed branch must hold its own commit');
  assert.ok(diff.includes('widget.txt'), 'the reviewed pull must carry the fixture change');
  seedRepositoryAt(world.statePath, {
    pullRequests: [{ number: 11, head: 'rigger-10', sha: head, mergeBase: base, diff }],
    mergeable: { 11: 'MERGEABLE' },
  });

  // The first invocation dispatches the judge; the next can act on the returned marker.
  const answers = [];
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const answer = await world.start();
    answers.push(answer);
    assert.deepEqual(world.fixtureErrors, [], 'the logical collaborators must complete');
    assert.equal(answer.code, 0, answer.text);
  }
  assert.ok(posted.length > 0, 'the agent judge must actually return a marker');
  const pulls = world.state().repository.pullRequests;
  assert.equal(pulls.length, 1, 'the fixture must retain exactly its reviewed pull request');
  if (fault === undefined && !pulls[0].merged) t.diagnostic(JSON.stringify({ answers, posted, state: world.state(), events: world.events() }));
  return { pull: pulls[0], posted };
}

// A blanket refusal cannot pass: the identical all-met control must merge.
// proves R-CARD-10
test('once leaves the pull unmerged when a judge leaves an item unmet', { timeout: 60000 }, async (t) => {
  assert.equal((await judged(t)).pull.merged, true, 'the all-met control must merge');
  const held = await judged(t, 'unmet');
  assert.match(held.posted[0], /verdict: sound\nitem 1: met\nitem 2: unmet\n/);
  assert.equal(held.pull.merged, false, 'an unmet acceptance item must prevent the merge');
});

// A sound label cannot replace a ruling on every acceptance item.
// proves R-CARD-10
test('once leaves the pull unmerged when a sound judge counts too few items', { timeout: 60000 }, async (t) => {
  assert.equal((await judged(t)).pull.merged, true, 'the all-met control must merge');
  const held = await judged(t, 'unruled');
  assert.match(held.posted[0], /verdict: sound\nitem 1: met\ncoverage:/);
  assert.doesNotMatch(held.posted[0], /item 2:/);
  assert.equal(held.pull.merged, false, 'an unruled acceptance item must prevent the merge');
});
